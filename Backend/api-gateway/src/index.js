import "dotenv/config"
import express from "express"
import cors from "cors"
import morgan from "morgan"
import { createProxyMiddleware } from "http-proxy-middleware"
import { fileURLToPath } from "url"
import path from "path"
import { verifyToken } from "./middlewares/auth.middleware.js"
import { requireCiudadano, requireAdmin } from "./middlewares/rbac.middleware.js"
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

const app = express()

// Cloudflare Tunnel actúa como proxy inverso — confiar en 1 nivel de proxy
// elimina ERR_ERL_UNEXPECTED_X_FORWARDED_FOR de express-rate-limit y permite
// que req.ip refleje la IP real del cliente (no la del túnel).
app.set("trust proxy", 1)

app.use(cors())
app.use(morgan("dev"))
app.use(globalLimiter)

// ── Documentación API (Swagger UI) ────────────────────────────────────────────
app.use("/docs", express.static(path.join(__dirname, "../public")))

// ── Helper: reenvío POST directo al microservicio ─────────────────────────────
// http-proxy-middleware v3 no hace pipe correcto del response cuando se usa como
// route handler (app.post) en Express 5 — usamos fetch nativo como workaround.
const parseJson = express.json()

const forwardPost = (targetUrl) => [
  parseJson,
  async (req, res) => {
    console.log(`[GW] → ${targetUrl}`, JSON.stringify(req.body))
    try {
      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      })
      const data = await upstream.json()
      console.log(`[GW] ← ${upstream.status}`, JSON.stringify(data))
      res.status(upstream.status).json(data)
    } catch (err) {
      console.error(`[GW] ERROR en fetch a ${targetUrl}:`, err.message)
      res.status(502).json({ message: "Error de conexión con el servicio: " + err.message })
    }
  }
]

// ── Rutas PÚBLICAS (sin token) ────────────────────────────────────────────────

// Recuperación de contraseña — limitadores separados por propósito:
// • forgot-password usa forgotPasswordLimiter (5/hora) para evitar spam de emails
//   sin penalizar al usuario que abandona y vuelve a pedir un código.
// • verify-reset-otp y reset-password usan passwordResetLimiter (5/15 min)
//   para bloquear fuerza bruta sobre el código OTP de 6 dígitos.
app.post("/api/auth/forgot-password",  forgotPasswordLimiter, ...forwardPost("http://localhost:3002/api/auth/forgot-password"))
app.post("/api/auth/verify-reset-otp", passwordResetLimiter,  ...forwardPost("http://localhost:3002/api/auth/verify-reset-otp"))
app.post("/api/auth/reset-password",   passwordResetLimiter,  ...forwardPost("http://localhost:3002/api/auth/reset-password"))

// Login / Refresh / Logout para cualquier tipo de usuario
app.use("/api/auth", authLimiter, createProxyMiddleware({
  target: "http://localhost:3002",
  changeOrigin: true,
  pathRewrite: (path) => "/api/auth" + path
}))

// Registro de ciudadanos — endpoint público (auto-registro desde la app móvil)
app.post("/api/users/register",     registrationLimiter, ...forwardPost("http://localhost:3000/api/users/register"))

// Verificación OTP — público (el ciudadano no tiene token todavía)
app.post("/api/users/verify-email", otpLimiter,          ...forwardPost("http://localhost:3000/api/users/verify-email"))

// Creación de contraseña — público (paso 3 del wizard de registro)
app.post("/api/users/set-password", otpLimiter,          ...forwardPost("http://localhost:3000/api/users/set-password"))

// ── Rutas PROTEGIDAS ──────────────────────────────────────────────────────────

// Análisis de imagen: solo ciudadanos pueden reportar incidencias
// on.proxyReq inyecta el user del JWT como headers HTTP al image-service.
// proxyTimeout/timeout en 120 s porque la primera inferencia del modelo ML
// puede tardar 30-90 s en frío (carga de pesos en GPU/CPU).
app.use("/api/image", imageLimiter, verifyToken, requireCiudadano, createProxyMiddleware({
  target: "http://localhost:5000",
  changeOrigin: true,
  pathRewrite: (path) => "/api/image" + path,
  proxyTimeout: 120_000,
  timeout: 120_000,
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      console.error(`[GW] Proxy error en ${req.method} ${req.path} → code=${err.code} msg=${err.message}`)
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Historial de incidentes del ciudadano autenticado — lee desde el image-service
// Sin imageLimiter porque es una consulta de solo lectura (no consume el modelo ML)
app.use("/api/incidents", verifyToken, requireCiudadano, createProxyMiddleware({
  target: "http://localhost:5000",
  changeOrigin: true,
  pathRewrite: (path) => "/api/incidents" + path,
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
      }
    },
    error: (err, req, res) => {
      console.error(`[GW] Proxy error en ${req.method} ${req.path} → code=${err.code} msg=${err.message}`)
      if (!res.headersSent) {
        res.status(502).json({ error: "Error de proxy al image-service.", code: err.code })
      }
    },
  },
}))

// Gestión de usuarios (consulta, edición, desactivación): solo ADMIN
// El registro público ya fue capturado arriba antes de llegar aquí
app.use("/api/users", verifyToken, requireAdmin, createProxyMiddleware({
  target: "http://localhost:3000",
  changeOrigin: true,
  pathRewrite: (path) => "/api/users" + path
}))

app.listen(4000, () => {
  console.log("API Gateway running on port 4000")
})
