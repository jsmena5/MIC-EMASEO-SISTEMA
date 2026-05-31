import "dotenv/config"
import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import userRoutes from "./routes/user.routes.js"
import operariosRoutes from "./routes/operarios.routes.js"
import supervisorRoutes from "./routes/supervisor.routes.js"
import zoneRoutes from "./routes/zone.routes.js"
import { internalAuth } from "./middleware/internalAuth.middleware.js"
import { requestId } from "./middleware/requestId.middleware.js"
import { logger } from "./utils/logger.js"

// Validar variables obligatorias antes de arrancar.
// Si alguna falta el contenedor termina con código 1 y un mensaje claro.
const REQUIRED_ENV = ["JWT_SECRET", "INTERNAL_TOKEN", "DB_PASSWORD_USERS"]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ missingEnv: key }, `Variable de entorno obligatoria no definida: ${key}`)
    process.exit(1)
  }
}

const app = express()

// Servicio interno — solo el gateway (server-to-server) debe acceder.
app.use(cors({ origin: false }))
app.use(express.json())
app.use(requestId)

// Healthcheck para docker-compose — sin autenticación interna.
app.get("/health", (_req, res) => res.json({ status: "ok" }))

// Todas las rutas /api/* requieren el token interno inyectado por el gateway.
app.use("/api", internalAuth)

// Defensa en profundidad: 5 registros por IP por hora
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Límite de registros alcanzado. Inténtalo de nuevo en 1 hora.", status: 429 },
})

app.use("/api/users/register", registerLimiter)
app.use("/api/users", userRoutes)
app.use("/api/users", operariosRoutes)
app.use("/api/users", supervisorRoutes)
app.use("/api/users", zoneRoutes)


app.listen(3000, () => {
  logger.info({ port: 3000 }, "Users service started")
})
