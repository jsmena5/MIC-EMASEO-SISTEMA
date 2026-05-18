import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import authRoutes from "./routes/auth.routes.js"
import { internalAuth } from "./middleware/internalAuth.middleware.js"
import { requestId } from "./middleware/requestId.middleware.js"
import { logger } from "./utils/logger.js"

// Validar variables obligatorias antes de arrancar.
// Si alguna falta el contenedor termina con código 1 y un mensaje claro.
const REQUIRED_ENV = ["JWT_SECRET", "INTERNAL_TOKEN", "DB_PASSWORD_AUTH"]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ missingEnv: key }, `Variable de entorno obligatoria no definida: ${key}`)
    process.exit(1)
  }
}

const app = express()

// Servicio interno — solo el gateway (server-to-server) debe acceder.
// Cualquier petición directa desde un browser (con cabecera Origin) es rechazada.
app.use(cors({ origin: false }))
app.use(express.json())
app.use(requestId)

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

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  logger.info({ port: PORT }, "Auth service started")
})
