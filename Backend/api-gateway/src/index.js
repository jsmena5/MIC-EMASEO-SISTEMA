import express from "express"
import cors from "cors"
import morgan from "morgan"
import { createProxyMiddleware } from "http-proxy-middleware"
import { verifyToken } from "./middlewares/auth.middleware.js"
import { requireCiudadano, requireAdmin } from "./middlewares/rbac.middleware.js"

const app = express()

app.use(cors())
app.use(morgan("dev"))

// ── Rutas PÚBLICAS (sin token) ────────────────────────────────────────────────

// Login para cualquier tipo de usuario
app.use("/api/auth", createProxyMiddleware({
  target: "http://localhost:3002",
  changeOrigin: true,
  pathRewrite: (path) => "/api/auth" + path
}))

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

// Registro de ciudadanos — endpoint público (auto-registro desde la app móvil)
app.post("/api/users/register",     ...forwardPost("http://localhost:3000/api/users/register"))

// Verificación OTP — público (el ciudadano no tiene token todavía)
app.post("/api/users/verify-email", ...forwardPost("http://localhost:3000/api/users/verify-email"))

// Creación de contraseña — público (paso 3 del wizard de registro)
app.post("/api/users/set-password", ...forwardPost("http://localhost:3000/api/users/set-password"))

// ── Rutas PROTEGIDAS ──────────────────────────────────────────────────────────

// Análisis de imagen: solo ciudadanos pueden reportar incidencias
// on.proxyReq inyecta el user del JWT como headers HTTP al image-service
app.use("/api/image", verifyToken, requireCiudadano, createProxyMiddleware({
  target: "http://localhost:5000",
  changeOrigin: true,
  pathRewrite: (path) => "/api/image" + path,
  proxyTimeout: 60000,
  timeout: 60000,
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader("x-user-id",  req.user.id)
        proxyReq.setHeader("x-user-rol", req.user.rol)
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