/**
 * mlCircuitBreaker.js
 *
 * Cliente gRPC para el ml-service.
 * Reemplaza la comunicación REST (HTTP) por gRPC binario para máxima eficiencia.
 *
 * Cambios principales respecto a la versión HTTP:
 *   - Se envía s3_key (string) en lugar de la imagen completa en Base64.
 *     La imagen ya fue subida a S3 en el paso 2 del pipeline (uploadPendingImage),
 *     por lo que el ml-service la descarga directamente desde Cloudflare R2.
 *   - El Circuit Breaker (opossum) sigue protegiendo el submit, igual que antes.
 *   - pollMlTask y checkMlTaskStatus ahora hacen streaming gRPC unario
 *     en lugar de HTTP polling al endpoint /predict/status/{task_id}.
 *
 * Variables de entorno:
 *   ML_GRPC_HOST — Hostname del ml-service (default: ml-service)
 *   ML_GRPC_PORT — Puerto gRPC del ml-service (default: 50051)
 *   ML_SERVICE_URL — Se sigue usando para el health check HTTP (/health)
 */

import { createRequire } from "module"
import CircuitBreaker from "opossum"
import path from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)

// ── Cargar definición gRPC desde el .proto ───────────────────────────────────
// En el contenedor, ml_service.proto se copia a /app/proto/ml_service.proto.
// En desarrollo local, se busca también en Backend/proto/ (dos niveles arriba de src/).
const __dirname = path.dirname(fileURLToPath(import.meta.url))

let grpc, protoLoader, packageDefinition, mlProto, mlServiceStub

try {
  grpc        = require("@grpc/grpc-js")
  protoLoader = require("@grpc/proto-loader")

  // /app/proto/ml_service.proto (Docker: src/ → ../proto/)
  const PROTO_PATH = path.resolve(__dirname, "../proto/ml_service.proto")
  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase:     true,
    longs:        String,
    enums:        String,
    defaults:     true,
    oneofs:       true,
  })
  const loaded = grpc.loadPackageDefinition(packageDefinition)
  mlProto = loaded.emaseo?.ml ?? loaded
} catch (err) {
  console.error("[mlCircuitBreaker] Error cargando stubs gRPC:", err.message)
  console.error("[mlCircuitBreaker] Asegúrate de instalar @grpc/grpc-js y @grpc/proto-loader")
  process.exit(1)
}

// ── Configuración del canal gRPC ─────────────────────────────────────────────

const ML_GRPC_HOST = process.env.ML_GRPC_HOST ?? "ml-service"
const ML_GRPC_PORT = process.env.ML_GRPC_PORT ?? "50051"
const ML_GRPC_ADDRESS = `${ML_GRPC_HOST}:${ML_GRPC_PORT}`

// Se mantiene para el health check HTTP (/health) que usa checkMlHealth() en image.service.js
const ML_SERVICE_URL = process.env.ML_SERVICE_URL
export const ML_DEGRADED_CODE = "ML_SERVICE_DEGRADED"

const DEGRADED_MESSAGE =
  "El servicio de análisis visual está temporalmente degradado. Intenta nuevamente en unos minutos."

const CB_SUBMIT_TIMEOUT = 15_000   // timeout del submit (Predict RPC)
const POLL_BASE_MS      = 500
const POLL_MAX_MS       = 2_000
export const POLL_TIMEOUT_MS = 180_000  // 3 min (igual que antes, cubre CLIP cold-start)

// ── Singleton del cliente gRPC ────────────────────────────────────────────────

let _client = null

function getGrpcClient() {
  if (!_client) {
    _client = new mlProto.MLService(
      ML_GRPC_ADDRESS,
      grpc.credentials.createInsecure(),
      {
        "grpc.max_send_message_length":    10 * 1024 * 1024,
        "grpc.max_receive_message_length": 10 * 1024 * 1024,
        "grpc.keepalive_time_ms":          30_000,
        "grpc.keepalive_timeout_ms":       10_000,
      },
    )
    console.log(`[mlCircuitBreaker] Cliente gRPC conectado a ${ML_GRPC_ADDRESS}`)
  }
  return _client
}

// ── Helper: convierte una llamada gRPC unaria en Promise ─────────────────────

function grpcUnary(method, request, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const client = getGrpcClient()
    const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined
    const callOpts = deadline ? { deadline } : {}

    client[method](request, callOpts, (err, response) => {
      if (err) {
        reject(err)
      } else {
        resolve(response)
      }
    })
  })
}

// ── submitMlTask — envía s3_key al ml-service vía gRPC ───────────────────────
// Reemplaza el POST HTTP /predict. Ya NO se transfiere Base64.

async function submitMlTask({ s3_key, image_width, image_height, client_coverage_ratio }) {
  const request = {
    s3_key,
    image_width:  image_width  ?? 0,
    image_height: image_height ?? 0,
  }
  if (client_coverage_ratio !== undefined && client_coverage_ratio !== null) {
    request.client_coverage_ratio = client_coverage_ratio
  }

  const response = await grpcUnary("Predict", request, { timeoutMs: CB_SUBMIT_TIMEOUT })
  return { task_id: response.task_id }
}

export const mlBreaker = new CircuitBreaker(submitMlTask, {
  timeout:                  CB_SUBMIT_TIMEOUT,
  errorThresholdPercentage: 50,
  volumeThreshold:          10,
  rollingCountTimeout:      60_000,
  rollingCountBuckets:      6,
  resetTimeout:             30_000,
  name:                    "ml-inference-grpc",
})

mlBreaker.fallback(() => {
  const err = new Error(DEGRADED_MESSAGE)
  err.code       = ML_DEGRADED_CODE
  err.statusCode = 503
  throw err
})

mlBreaker.on("open",     () => console.warn("[circuit-breaker] ABIERTO — ML Service degradado"))
mlBreaker.on("halfOpen", () => console.log("[circuit-breaker] HALF-OPEN — enviando prueba al ML Service"))
mlBreaker.on("close",    () => console.log("[circuit-breaker] CERRADO — ML Service recuperado"))
mlBreaker.on("timeout",  () => console.error("[circuit-breaker] TIMEOUT — ML Service no respondió al submit en 15 s"))
mlBreaker.on("reject",   () => console.warn("[circuit-breaker] RECHAZADA — circuito abierto"))

// ── pollMlTask — polling de estado via gRPC ───────────────────────────────────

export async function pollMlTask(task_id, { timeoutMs = POLL_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  let pollDelay  = POLL_BASE_MS

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay))
    pollDelay = Math.min(pollDelay * 2, POLL_MAX_MS)

    if (Date.now() >= deadline) {
      const err = new Error(`Poll timeout after ${timeoutMs}ms`)
      err.name = "TimeoutError"
      throw err
    }

    const response = await grpcUnary("PredictStatus", { task_id }, { timeoutMs: 5_000 })

    if (response.status === "completed") {
      return JSON.parse(response.result_json)
    }
    if (response.status === "failed") {
      throw new Error(`ML inference failed: ${response.error_message ?? "unknown"}`)
    }
    // "pending" | "processing" → seguir esperando
  }
}

// ── checkMlTaskStatus — consulta puntual (sin loop) ──────────────────────────

export async function checkMlTaskStatus(task_id) {
  const response = await grpcUnary("PredictStatus", { task_id }, { timeoutMs: 5_000 })
  const out = { status: response.status }
  if (response.status === "completed") {
    out.result = JSON.parse(response.result_json)
  }
  if (response.status === "failed") {
    out.error = response.error_message
  }
  return out
}
