import rateLimit, { ipKeyGenerator } from "express-rate-limit"
import jwt from "jsonwebtoken"

// ── keyGenerator por usuario (no por IP) ──────────────────────────────────────
// Agrupa el conteo por userId del JWT en lugar de por IP. Es CRÍTICO para redes
// compartidas (laboratorios, aulas, CGNAT móvil) donde decenas de personas salen
// con la MISMA IP pública: con key por IP, 60 usuarios comparten una sola cuota y
// se bloquean entre sí aunque cada uno reporte poco.
// jwt.decode (sin verificar firma) basta para agrupar — verifyToken valida el
// token de verdad en el siguiente middleware. Sin token → cae a la IP (con el
// helper ipKeyGenerator que normaliza IPv6).
const keyByUserOrIp = (req /*, res */) => {
  const auth = req.headers["authorization"]
  if (auth) {
    try {
      const decoded = jwt.decode(auth.split(" ")[1])
      if (decoded?.id) return `u:${decoded.id}`
    } catch { /* token ilegible → cae a IP */ }
  }
  return ipKeyGenerator(req.ip)
}

// ── Store Redis opcional ──────────────────────────────────────────────────────
// Si REDIS_URL está definida, cada instancia del gateway comparte contadores
// en Redis → el rate limiting es efectivo en despliegues multi-réplica/K8s.
// Sin REDIS_URL el store cae a memoria local (comportamiento anterior).

let makeStore = () => undefined // undefined → express-rate-limit usa memoria

if (process.env.REDIS_URL) {
  try {
    const { RedisStore } = await import("rate-limit-redis")
    const { createClient } = await import("redis")
    const redisClient = createClient({ url: process.env.REDIS_URL })
    await redisClient.connect()
    console.log("[rate-limit] Store Redis conectado:", process.env.REDIS_URL)
    makeStore = (prefix) => new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix,
    })
  } catch (err) {
    console.warn("[rate-limit] Redis no disponible, usando store en memoria:", err.message)
  }
}

const message429 = (msg) => ({
  message: msg,
  status: 429,
})

// ── Limitador global — protección base para todas las rutas ──────────────────
// Por USUARIO (no por IP). 1000/15min cubre el polling intensivo: cada reporte
// hace ~30 consultas GET /image/status mientras el ML procesa, más navegación.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: keyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:global:"),
  message: message429("Demasiadas peticiones. Inténtalo de nuevo en 15 minutos."),
})

// ── Login / Refresh / Logout — protección anti fuerza bruta ─────────────────
// Por IP (anti fuerza bruta). 100/15min: un login exitoso es 1 request y dura
// 7 días (refresh token), así que el límite real solo lo tocan los reintentos.
// Subido de 10 para soportar decenas de personas logueándose desde la misma red
// compartida (lab/CGNAT) sin bloquearse entre sí; 100 sigue frenando un bot.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:auth:"),
  message: message429("Demasiados intentos de autenticación. Inténtalo de nuevo en 15 minutos."),
})

// ── Registro de ciudadanos — previene creación masiva de cuentas ─────────────
// 5 registros por IP por hora
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:register:"),
  message: message429("Límite de registros alcanzado. Inténtalo de nuevo en 1 hora."),
})

// ── Verificación OTP — previene enumeración / fuerza bruta de códigos ────────
// 10 intentos por IP cada 15 minutos
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:otp:"),
  message: message429("Demasiados intentos de verificación. Inténtalo de nuevo en 15 minutos."),
})

// ── Análisis de imagen — protege operación costosa de ML ─────────────────────
// Por USUARIO, 60/hora. Solo cuenta el POST /analyze + pre-check (~2 por reporte),
// NO el polling (eximido en index.js) → ~30 reportes/hora por persona.
export const imageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: keyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:image:"),
  message: message429("Límite de análisis de imágenes alcanzado. Inténtalo de nuevo en 1 hora."),
})

// ── Solicitud de código de recuperación — previene spam de emails ─────────────
// 5 solicitudes por IP por hora; el usuario puede volver a pedir código si
// abandona el flujo sin que esto penalice los intentos de verificación OTP.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:forgot:"),
  message: message429("Demasiadas solicitudes de código de recuperación. Inténtalo de nuevo en 1 hora."),
})

// ── Verificación y uso del código OTP — bloquea fuerza bruta ─────────────────
// 5 intentos por IP cada 15 minutos; penaliza exclusivamente el ingreso
// repetido de códigos incorrectos, no la solicitud de nuevos códigos.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rl:reset:"),
  message: message429("Demasiados intentos de verificación. Inténtalo de nuevo en 15 minutos."),
})
