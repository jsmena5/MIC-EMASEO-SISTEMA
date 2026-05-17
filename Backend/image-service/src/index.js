import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import imageRoutes from "./routes/image.routes.js"
import incidentRoutes from "./routes/incident.routes.js"
import supervisorRoutes from "./routes/supervisor.routes.js"
import operarioRoutes from "./routes/operario.routes.js"
import { recoverStaleIncidents } from "./services/image.service.js"
import { internalAuth } from "./middleware/internalAuth.middleware.js"

// Validar variables obligatorias antes de arrancar.
// Si alguna falta el contenedor termina con código 1 y un mensaje claro.
const REQUIRED_ENV = [
  "INTERNAL_TOKEN",
  "DB_PASSWORD_IMAGE",
  "S3_PUBLIC_URL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[image-service] FATAL: Variable de entorno obligatoria no definida: ${key}. El servicio no puede iniciar.`)
    process.exit(1)
  }
}

const app = express()

app.set("trust proxy", 1)
// Servicio interno — solo el gateway (server-to-server) debe acceder.
app.use(cors({ origin: false }))
app.use(express.json({ limit: "15mb" }))

// Healthcheck para docker-compose — sin autenticación interna.
app.get("/health", (_req, res) => res.json({ status: "ok" }))

// Todas las rutas /api/* requieren el token interno inyectado por el gateway.
app.use("/api", internalAuth)

// Defensa en profundidad: 20 análisis por IP por hora
const imageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Límite de análisis de imágenes alcanzado. Inténtalo de nuevo en 1 hora.", status: 429 },
})

app.use("/api/image", imageLimiter)
app.use("/api/image", imageRoutes)
app.use("/api/incidents", incidentRoutes)
app.use("/api/supervisor", supervisorRoutes)
app.use("/api/operario", operarioRoutes)

app.listen(5000, () => {
  console.log("image-ms corriendo en puerto 5000")
  recoverStaleIncidents()
})
