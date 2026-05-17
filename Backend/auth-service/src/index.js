import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import authRoutes from "./routes/auth.routes.js"
import { internalAuth } from "./middleware/internalAuth.middleware.js"

// Validar variables obligatorias antes de arrancar.
// Si alguna falta el contenedor termina con código 1 y un mensaje claro.
const REQUIRED_ENV = ["JWT_SECRET", "INTERNAL_TOKEN", "DB_PASSWORD_AUTH"]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[auth-service] FATAL: Variable de entorno obligatoria no definida: ${key}. El servicio no puede iniciar.`)
    process.exit(1)
  }
}

const app = express()

// Servicio interno — solo el gateway (server-to-server) debe acceder.
// Cualquier petición directa desde un browser (con cabecera Origin) es rechazada.
app.use(cors({ origin: false }))
app.use(express.json())

// Healthcheck para docker-compose — sin autenticación interna.
app.get("/health", (_req, res) => res.json({ status: "ok" }))

// Todas las rutas /api/* requieren el token interno inyectado por el gateway.
app.use("/api", internalAuth)

// Defensa en profundidad: 5 intentos de login por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos de login. Inténtalo de nuevo en 15 minutos.", status: 429 },
})

app.use("/api/auth/login", loginLimiter)
app.use("/api/auth", authRoutes)

app.listen(process.env.PORT || 3002, () => {
  console.log("Auth service running on port 3002")
})
