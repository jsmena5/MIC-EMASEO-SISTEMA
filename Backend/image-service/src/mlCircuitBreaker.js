import CircuitBreaker from "opossum"

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000/predict"
const ML_ORIGIN = (() => {
  try { return new URL(ML_SERVICE_URL).origin } catch { return "http://localhost:8000" }
})()

export const ML_DEGRADED_CODE = "ML_SERVICE_DEGRADED"
const DEGRADED_MESSAGE =
  "El servicio de análisis visual está temporalmente degradado. Intenta nuevamente en unos minutos."

const POLL_INTERVAL_MS = 500
const CB_TIMEOUT_MS    = 60_000

// Encola la tarea en el ML service, luego hace polling hasta obtener el resultado.
// El AbortSignal compartido garantiza que toda la operación (POST + polls) aborte
// antes de que el timeout del Circuit Breaker expire.
async function callMlInference({ image_base64, image_width, image_height }) {
  const signal = AbortSignal.timeout(CB_TIMEOUT_MS - 500)

  const postRes = await fetch(ML_SERVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64, image_width, image_height }),
    signal,
  })

  if (!postRes.ok) {
    const body = await postRes.text()
    const err = new Error(`ML HTTP ${postRes.status}`)
    err.mlStatusCode = postRes.status
    err.mlBody = body
    throw err
  }

  const { task_id } = await postRes.json()
  const statusUrl = `${ML_ORIGIN}/predict/status/${task_id}`

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const pollRes = await fetch(statusUrl, { signal })
    if (!pollRes.ok) throw new Error(`ML status HTTP ${pollRes.status}`)

    const { status, result, error } = await pollRes.json()

    if (status === "completed") return result
    if (status === "failed") throw new Error(`ML inference failed: ${error ?? "unknown"}`)
    // "pending" | "processing" | otros estados intermedios → seguir esperando
  }
}

export const mlBreaker = new CircuitBreaker(callMlInference, {
  timeout: CB_TIMEOUT_MS,         // 60 s — cubre inferencia real en CPU
  errorThresholdPercentage: 50,   // % de fallos para abrir el circuito
  resetTimeout: 30_000,           // ms en OPEN antes de pasar a HALF-OPEN
  name: "ml-inference",
})

// Fallback: respuesta amigable cuando el circuito está abierto o hay timeout.
// Lanzar desde el fallback hace que mlBreaker.fire() rechace con este error.
mlBreaker.fallback(() => {
  const err = new Error(DEGRADED_MESSAGE)
  err.code = ML_DEGRADED_CODE
  err.statusCode = 503
  throw err
})

mlBreaker.on("open",     () => console.warn("[circuit-breaker] ABIERTO — ML Service degradado; rechazando solicitudes sin llamar al servicio"))
mlBreaker.on("halfOpen", () => console.log("[circuit-breaker] HALF-OPEN — enviando solicitud de prueba al ML Service"))
mlBreaker.on("close",    () => console.log("[circuit-breaker] CERRADO — ML Service recuperado correctamente"))
mlBreaker.on("timeout",  () => console.error("[circuit-breaker] TIMEOUT — ML Service no respondio en 60 s"))
mlBreaker.on("reject",   () => console.warn("[circuit-breaker] RECHAZADA — circuito abierto, llamada cortocircuitada"))
