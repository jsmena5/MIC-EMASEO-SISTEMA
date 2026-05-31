import "dotenv/config"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import { createProxyMiddleware } from "http-proxy-middleware"
import { fileURLToPath } from "url"
import path from "path"
import swaggerUi from "swagger-ui-express"
import { swaggerSpec } from "./swagger.js"
import { verifyToken } from "./middlewares/auth.middleware.js"
import { requireCiudadano, requireAdmin, requireSupervisor, requireStaff } from "./middlewares/rbac.middleware.js"
import { requestId } from "./middlewares/requestId.middleware.js"
import { logger } from "./utils/logger.js"
import {
  globalLimiter,
  authLimiter,
  registrationLimiter,
  otpLimiter,
  imageLimiter,
  forgotPasswordLimiter,
  passwordResetLimiter,
} from "./middlewares/rateLimiter.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Fail-fast: variables obligatorias para arrancar. En cloud, un default a localhost
// silenciaría errores de configuración y el gateway terminaría apuntando a sí mismo.
const REQUIRED_ENV = [
  "AUTH_SERVICE_URL",
  "USERS_SERVICE_URL",
  "IMAGE_SERVICE_URL",
  "ML_SERVICE_URL",
  "MINIO_INTERNAL_URL",
  "JWT_SECRET",
  "INTERNAL_TOKEN",
  "CORS_ORIGINS",
]
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k])
if (missingEnv.length) {
  logger.error({ missing: missingEnv }, "Variables de entorno obligatorias ausentes")
  process.exit(1)
}

const app = express()

const AUTH_SERVICE_URL    = process.env.AUTH_SERVICE_URL
const USERS_SERVICE_URL   = process.env.USERS_SERVICE_URL
const IMAGE_SERVICE_URL   = process.env.IMAGE_SERVICE_URL
const ML_SERVICE_URL      = process.env.ML_SERVICE_URL
const MINIO_INTERNAL_URL  = process.env.MINIO_INTERNAL_URL

// Cloudflare Tunnel actúa como proxy inverso — confiar en 1 nivel de proxy
// elimina ERR_ERL_UNEXPECTED_X_FORWARDED_FOR de express-rate-limit y permite
// que req.ip refleje la IP real del cliente (no la del túnel).
app.set("trust proxy", 1)

const allowedOrigins = [
  ...process.env.CORS_ORIGINS.split(",").map((o) => o.trim()),
  "https://mic-emaseo-admin.pages.dev",  // panel administrador (Cloudflare Pages)
]

app.use(helmet())
app.use(cors({
  origin: (origin, cb) => {
    // Sin origin → petición server-to-server o herramienta CLI → permitir
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    // Permitir cualquier origen localhost para desarrollo local contra producción
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
    cb(new Error(`CORS: origen no permitido — ${origin}`))
  },
  credentials: true,
}))
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))
app.use(requestId)
app.use(globalLimiter)

// Health — responde antes de cualquier middleware de autenticación
app.get("/health", (_req, res) => res.json({ status: "ok" }))

// ── Proxy de medios — público (sin autenticación) ─────────────────────────────
// Evita que el navegador/móvil necesite acceso directo al puerto de MinIO.
// GET /api/media/<bucket>/<key>  →  internamente: http://minio:9000/<bucket>/<key>
//
// El bucket "emaseo-incidents" ya tiene lectura anónima (mc anonymous set download),
// por eso esta ruta no exige token. Las imágenes son inmutables (UUID), por eso
// enviamos Cache-Control: immutable.
//
// Para acceso desde la LAN / app móvil: basta con que el celular llegue al gateway
// en el puerto 4000 (siempre expuesto). No se necesita exponer MinIO (9000).
app.use("/api/media", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Método no permitido." })
  }

  // req.path ya viene sin el prefijo /api/media gracias a app.use
  // Ej.: req.path = "/emaseo-incidents/incidents/uuid.jpg"
  const mediaPath = req.path.replace(/^\/+/, "") // quitar "/" inicial(es)
  if (!mediaPath) return res.status(400).json({ error: "Path de media requerido." })

  const url = `${MINIO_INTERNAL_URL}/${mediaPath}`

  try {
    const upstream = await fetch(url, {
      method: req.method,
      signal: AbortSignal.timeout(15_000),
    })

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Media no encontrado." })
    }

    const contentType   = upstream.headers.get("content-type")   ?? "application/octet-stream"
    const contentLength = upstream.headers.get("content-length")
    const etag          = upstream.headers.get("etag")
    res.setHeader("Content-Type",  contentType)
    res.setHeader("Cache-Control", "public, max-age=3600, immutable")
    res.setHeader("Access-Control-Allow-Origin", "*")
    // Helmet fija CORP: same-origin en todas las rutas; sobrescribimos aquí para
    // que navegadores (React/Expo) puedan cargar imágenes cross-origin (distinto puerto).
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    if (contentLength) res.setHeader("Content-Length", contentLength)
    if (etag)          res.setHeader("ETag",           etag)

    if (req.method === "HEAD") return res.end()

    const body = await upstream.arrayBuffer()
    res.send(Buffer.from(body))
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return res.status(504).json({ error: "Timeout al obtener media." })
    }
    logger.error({ url, err: err.message }, "Media proxy error")
    if (!res.headersSent) res.status(502).json({ error: "Error al obtener media." })
  }
})

// ── Documentación API ─────────────────────────────────────────────────────────
// /docs  — Swagger UI estático (archivos legacy)
app.use("/docs", express.static(path.join(__dirname, "../public")))
// /api-docs — OpenAPI generado con swagger-jsdoc (spec vivo)
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: "MIC-EMASEO API Docs",
}))

// ── Helper: reenvío POST directo al microservicio ─────────────────────────────
// http-proxy-middleware v3 no hace pipe correcto del response cuando se usa como
// route handler (app.post) en Express 5 — usamos fetch nativo como workaround.
const parseJson = express.json({ limit: "10mb" })

const FORWARD_TIMEOUT_MS = 10_000
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN

const SENSITIVE_KEYS = new Set(["password", "otp", "token", "refreshToken"])
const sanitizeBody = (body) => {
  if (!body || typeof body !== "object") return body
  return Object.fromEntries(
    Object.entries(body).map(([k, v]) => [k, SENSITIVE_KEYS.has(k) ? "[REDACTED]" : v])
  )
}

const forwardPost = (targetUrl) => [
  parseJson,
  async (req, res) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS)
    try {
      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": INTERNAL_TOKEN,
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      })
      const data = await upstream.json()
      res.status(upstream.status).json(data)
    } catch (err) {
      if (err.name === "AbortError") {
        logger.error({ targetUrl, timeoutMs: FORWARD_TIMEOUT_MS }, "Gateway Timeout en fetch")
        return res.status(504).json({ message: "Gateway Timeout: el servicio no respondió a tiempo." })
      }
      logger.error({ targetUrl, err: err.message }, "Error en fetch al microservicio")
      res.status(502).json({ message: "Error de conexión con el servicio: " + err.message })
    } finally {
      clearTimeout(timer)
    }
  }
]

// ── Rutas PÚBLICAS (sin token) ────────────────────────────────────────────────

// Recuperación de contraseña — limitadores separados por propósito:
// • forgot-password usa forgotPasswordLimiter (5/hora) para evitar spam de emails
//   sin penalizar al usuario que abandona y vuelve a pedir un código.
// • verify-reset-otp y reset-password usan passwordResetLimiter (5/15 min)
//   para bloquear fuerza bruta sobre el código OTP de 6 dígitos.
app.post("/api/auth/forgot-password",  forgotPasswordLimiter, ...forwardPost(`${AUTH_SERVICE_URL}/api/auth/forgot-password`))
app.post("/api/auth/verify-reset-otp", passwordResetLimiter,  ...forwardPost(`${AUTH_SERVICE_URL}/api/auth/verify-reset-otp`))
app.post("/api/auth/reset-password",   passwordResetLimiter,  ...forwardPost(`${AUTH_SERVICE_URL}/api/auth/reset-password`))

// Cambio de contraseña — requiere JWT válido. Debe ir ANTES del proxy general
// /api/auth para que Express lo capture aquí y no en el proxy sin autenticación.
// El gateway inyecta x-user-id para que el auth-service no necesite re-validar el JWT.
app.post(
  "/api/auth/change-password",
  verifyToken,
  parseJson,
  async (req, res) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS)
    try {
      const upstream = await fetch(`${AUTH_SERVICE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "X-Internal-Token":  INTERNAL_TOKEN,
          "x-user-id":         req.user.id,
          "x-forwarded-for":   req.ip,
          "x-user-agent":      req.headers["user-agent"] ?? "",
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      })
      const data = await upstream.json()
      res.status(upstream.status).json(data)
    } catch (err) {
      if (err.name === "AbortError") {
        return res.status(504).json({ message: "Gateway Timeout" })
      }
      res.status(502).json({ message: "Error de conexión con el servicio" })
    } finally {
      clearTimeout(timer)
    }
  }
)

// Login / Refresh / Logout para cualquier tipo de usuario
app.use("/api/auth", authLimiter, createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/auth" + path,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
}))

// Registro de ciudadanos — endpoint público (auto-registro desde la app móvil)
app.post("/api/users/register",     registrationLimiter, ...forwardPost(`${USERS_SERVICE_URL}/api/users/register`))

// Verificación OTP — público (el ciudadano no tiene token todavía)
app.post("/api/users/verify-email", otpLimiter,          ...forwardPost(`${USERS_SERVICE_URL}/api/users/verify-email`))

// Creación de contraseña — público (paso 3 del wizard de registro)
app.post("/api/users/set-password", otpLimiter,          ...forwardPost(`${USERS_SERVICE_URL}/api/users/set-password`))

// ── Rutas PROTEGIDAS ──────────────────────────────────────────────────────────

// Pre-check ML — ciudadanos autenticados. Respuesta síncrona (<200 ms), sin Celery.
// Recibe thumbnail (~15 KB) y devuelve {garbage_score, is_garbage, threshold}.
// Usa forwardPost (fetch nativo, timeout 10 s) igual que las otras rutas POST simples.
// imageLimiter comparte cuota con /api/image para evitar abuso del endpoint.
app.post(
  "/api/ml/pre-check",
  imageLimiter,
  verifyToken,
  requireCiudadano,
  ...forwardPost(`${ML_SERVICE_URL}/pre-check`),
)

// Análisis de imagen: solo ciudadanos pueden reportar incidencias
// on.proxyReq inyecta el user del JWT como headers HTTP al image-service.
// proxyTimeout/timeout en 120 s porque la primera inferencia del modelo ML
// puede tardar 30-90 s en frío (carga de pesos en GPU/CPU).
app.use("/api/image", imageLimiter, verifyToken, requireCiudadano, createProxyMiddleware({
  target: IMAGE_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/image" + path,
  proxyTimeout: 120_000,
  timeout: 120_000,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      logger.error({ method: req.method, path: req.path, code: err.code, err: err.message }, "Proxy error")
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Historial de incidentes del ciudadano autenticado — lee desde el image-service
// Sin imageLimiter porque es una consulta de solo lectura (no consume el modelo ML)
app.use("/api/incidents", verifyToken, requireCiudadano, createProxyMiddleware({
  target: IMAGE_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/incidents" + path,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      logger.error({ method: req.method, path: req.path, code: err.code, err: err.message }, "Proxy error")
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Gestión de incidentes — supervisores y admins
// Incluye: listado, detalle, cambio de estado, asignación, estadísticas por zona
app.use("/api/supervisor", verifyToken, requireSupervisor, createProxyMiddleware({
  target: IMAGE_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/supervisor" + path,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      logger.error({ method: req.method, path: req.path, code: err.code, err: err.message }, "Proxy error")
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Asignaciones del operario autenticado (OPERARIO, SUPERVISOR, ADMIN)
app.use("/api/operario", verifyToken, requireStaff, createProxyMiddleware({
  target: IMAGE_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/operario" + path,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      logger.error({ method: req.method, path: req.path, code: err.code, err: err.message }, "Proxy error")
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Gestión de usuarios (consulta, edición, desactivación): solo ADMIN
// El registro público ya fue capturado arriba antes de llegar aquí
app.use("/api/users", verifyToken, requireAdmin, createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: (path) => "/api/users" + path,
  headers: { "X-Internal-Token": INTERNAL_TOKEN },
}))

app.listen(4000, () => {
  logger.info({ port: 4000 }, "API Gateway started")
})
