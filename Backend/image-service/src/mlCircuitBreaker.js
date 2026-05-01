import CircuitBreaker from "opossum"

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000/predict"

export const ML_DEGRADED_CODE = "ML_SERVICE_DEGRADED"
const DEGRADED_MESSAGE =
  "El servicio de análisis visual está temporalmente degradado. Intenta nuevamente en unos minutos."

// Función pura que realiza la llamada de inferencia al ML Service.
// El AbortSignal cancela la petición HTTP antes de que el timeout de opossum
// expire, evitando que el fetch quede huérfano en background.
async function callMlInference({ image_base64, image_width, image_height }) {
  const res = await fetch(ML_SERVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64, image_width, image_height }),
    signal: AbortSignal.timeout(14_500), // cancela el fetch justo antes del timeout del CB (15 s)
  })

  if (!res.ok) {
    const body = await res.text()
    const err = new Error(`ML HTTP ${res.status}`)
    err.mlStatusCode = res.status
    err.mlBody = body
    throw err
  }

  return res.json()
}

export const mlBreaker = new CircuitBreaker(callMlInference, {
  timeout: 15_000,                // ms antes de considerar la llamada fallida
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
mlBreaker.on("timeout",  () => console.error("[circuit-breaker] TIMEOUT — ML Service no respondio en 15 s"))
mlBreaker.on("reject",   () => console.warn("[circuit-breaker] RECHAZADA — circuito abierto, llamada cortocircuitada"))
