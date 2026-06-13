import CircuitBreaker from "opossum"

// ML_SERVICE_URL se valida en index.js al arrancar. Aquí lo leemos de forma
// tolerante para no romper la importación del módulo en los tests.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL
const ML_ORIGIN = ML_SERVICE_URL ? new URL(ML_SERVICE_URL).origin : undefined

export const ML_DEGRADED_CODE = "ML_SERVICE_DEGRADED"
const DEGRADED_MESSAGE =
  "El servicio de análisis visual está temporalmente degradado. Intenta nuevamente en unos minutos."

const POLL_BASE_MS      = 500
const POLL_MAX_MS       = 2_000     // era 8000 — techo bajo para detectar completitud más rápido
const CB_SUBMIT_TIMEOUT = 15_000    // timeout solo del POST de envío de la tarea
export const POLL_TIMEOUT_MS = 180_000  // era 120000 — 3 min para cubrir CLIP cold-start (~90s)

// ─── submitMlTask ─────────────────────────────────────────────────────────────
// Encola la tarea en el ML-service y retorna { task_id } de inmediato.
// Envuelto en CircuitBreaker para detectar indisponibilidad del servicio.
// El polling se hace por separado (ver pollMlTask) para no mantener el CB abierto
// durante la inferencia (30-120 s con cold-start del modelo).
async function submitMlTask({ image_base64, image_width, image_height, client_coverage_ratio }) {
  const body = { image_base64, image_width, image_height }
  if (client_coverage_ratio !== undefined) body.client_coverage_ratio = client_coverage_ratio
  const postRes = await fetch(ML_SERVICE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(CB_SUBMIT_TIMEOUT),
  })

  if (!postRes.ok) {
    const body = await postRes.text()
    const err  = new Error(`ML HTTP ${postRes.status}`)
    err.mlStatusCode = postRes.status
    err.mlBody       = body
    throw err
  }

  return postRes.json()
}

export const mlBreaker = new CircuitBreaker(submitMlTask, {
  timeout:                  CB_SUBMIT_TIMEOUT,
  errorThresholdPercentage: 50,
  volumeThreshold:          10,     // mínimo 10 peticiones antes de evaluar apertura
  rollingCountTimeout:      60_000, // ventana de evaluación: 1 minuto
  rollingCountBuckets:      6,      // 6 buckets de 10 s cada uno
  resetTimeout:             30_000,
  name:                    "ml-inference",
})

// Fallback: respuesta amigable cuando el circuito está abierto o hay timeout.
mlBreaker.fallback(() => {
  const err = new Error(DEGRADED_MESSAGE)
  err.code       = ML_DEGRADED_CODE
  err.statusCode = 503
  throw err
})

mlBreaker.on("open",     () => console.warn("[circuit-breaker] ABIERTO — ML Service degradado; rechazando solicitudes sin llamar al servicio"))
mlBreaker.on("halfOpen", () => console.log("[circuit-breaker] HALF-OPEN — enviando solicitud de prueba al ML Service"))
mlBreaker.on("close",    () => console.log("[circuit-breaker] CERRADO — ML Service recuperado correctamente"))
mlBreaker.on("timeout",  () => console.error("[circuit-breaker] TIMEOUT — ML Service no respondió al submit en 15 s"))
mlBreaker.on("reject",   () => console.warn("[circuit-breaker] RECHAZADA — circuito abierto, llamada cortocircuitada"))

// ─── pollMlTask ───────────────────────────────────────────────────────────────
// Espera el resultado de una tarea ya enviada haciendo backoff exponencial.
// NO está envuelto en CB: los timeouts de polling son específicos de una tarea y
// no indican que el servicio esté degradado globalmente.
//
// @param {string} task_id          - ID de tarea Celery devuelto por submitMlTask
// @param {{ timeoutMs?: number }}   - Presupuesto total; por defecto POLL_TIMEOUT_MS
// @returns {Promise<object>}        - Resultado ML cuando status === "completed"
// @throws Si el servicio devuelve status "failed" o si se agota el timeout
export async function pollMlTask(task_id, { timeoutMs = POLL_TIMEOUT_MS } = {}) {
  const statusUrl = `${ML_ORIGIN}/predict/status/${task_id}`
  const signal    = AbortSignal.timeout(timeoutMs)
  let   pollDelay = POLL_BASE_MS

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay))
    pollDelay = Math.min(pollDelay * 2, POLL_MAX_MS)

    const pollRes = await fetch(statusUrl, { signal })
    if (!pollRes.ok) throw new Error(`ML status HTTP ${pollRes.status}`)

    const { status, result, error } = await pollRes.json()

    if (status === "completed") return result
    if (status === "failed")    throw new Error(`ML inference failed: ${error ?? "unknown"}`)
    // "pending" | "processing" | otros estados intermedios → seguir esperando
  }
}

// ─── checkMlTaskStatus ────────────────────────────────────────────────────────
// Consulta el estado de una tarea Celery una sola vez (sin loop).
// Usada por recoverCeleryTasks() para verificar tareas huérfanas en cada ciclo.
//
// @param {string} task_id
// @returns {Promise<{ status: string, result?: object, error?: string }>}
export async function checkMlTaskStatus(task_id) {
  const statusUrl = `${ML_ORIGIN}/predict/status/${task_id}`
  const res = await fetch(statusUrl, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`ML status HTTP ${res.status}`)
  return res.json()
}
