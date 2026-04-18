import rateLimit from "express-rate-limit"

const message429 = (msg) => ({
  message: msg,
  status: 429,
})

// ── Limitador global — protección base para todas las rutas ──────────────────
// 300 peticiones por IP cada 15 minutos es suficiente para uso normal
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Demasiadas peticiones. Inténtalo de nuevo en 15 minutos."),
})

// ── Login / Refresh / Logout — protección anti fuerza bruta ─────────────────
// 10 intentos por IP cada 15 minutos
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Demasiados intentos de autenticación. Inténtalo de nuevo en 15 minutos."),
})

// ── Registro de ciudadanos — previene creación masiva de cuentas ─────────────
// 5 registros por IP por hora
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Límite de registros alcanzado. Inténtalo de nuevo en 1 hora."),
})

// ── Verificación OTP — previene enumeración / fuerza bruta de códigos ────────
// 10 intentos por IP cada 15 minutos
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Demasiados intentos de verificación. Inténtalo de nuevo en 15 minutos."),
})

// ── Análisis de imagen — protege operación costosa de ML ─────────────────────
// 20 análisis por IP por hora
export const imageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Límite de análisis de imágenes alcanzado. Inténtalo de nuevo en 1 hora."),
})

// ── Recuperación de contraseña — previene abuso de envío de emails ────────────
// 5 solicitudes por IP cada 15 minutos
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: message429("Demasiadas solicitudes de recuperación. Inténtalo de nuevo en 15 minutos."),
})
