import express from "express"
import cors from "cors"
import imageRoutes from "./routes/image.routes.js"
import incidentRoutes from "./routes/incident.routes.js"
import supervisorRoutes from "./routes/supervisor.routes.js"
import operarioRoutes from "./routes/operario.routes.js"
import { recoverStaleIncidents, recoverCeleryTasks } from "./services/image.service.js"
import { startNotificationWorker } from "./workers/notificationWorker.js"
import { internalAuth } from "./middleware/internalAuth.middleware.js"
import { requestId } from "./middleware/requestId.middleware.js"
import { logger } from "./utils/logger.js"

// Validar variables obligatorias antes de arrancar.
// Si alguna falta el contenedor termina con código 1 y un mensaje claro.
const REQUIRED_ENV = [
  "INTERNAL_TOKEN",
  "DB_PASSWORD_IMAGE",
  "ML_SERVICE_URL",
  "S3_PUBLIC_URL",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ missingEnv: key }, `Variable de entorno obligatoria no definida: ${key}`)
    process.exit(1)
  }
}

const app = express()
app.disable('x-powered-by')

app.set("trust proxy", 1)
// Servicio interno — solo el gateway (server-to-server) debe acceder.
app.use(cors({ origin: false }))
app.use(express.json({ limit: "15mb" }))
app.use(requestId)

// Healthcheck para docker-compose — sin autenticación interna.
app.get("/health", (_req, res) => res.json({ status: "ok" }))

// Todas las rutas /api/* requieren el token interno inyectado por el gateway.
app.use("/api", internalAuth)

app.use("/api/image", imageRoutes)
app.use("/api/incidents", incidentRoutes)
app.use("/api/supervisor", supervisorRoutes)
app.use("/api/operario", operarioRoutes)

app.listen(5000, () => {
  logger.info({ port: 5000 }, "Image service started")

  // Ejecución inmediata al arrancar
  recoverStaleIncidents()
  recoverCeleryTasks()

  // Worker de push notifications (polling con reintentos + backoff)
  startNotificationWorker().catch((err) =>
    logger.error({ err: err.message }, "[notifWorker] Error al iniciar el worker de notificaciones"),
  )

  // Guarda de concurrencia: evita solapamiento si un ciclo tarda más que el intervalo
  let staleRecovering  = false
  let celeryRecovering = false

  // Cada 5 min barre incidentes PROCESANDO sin celery_task_id
  setInterval(async () => {
    if (staleRecovering) return
    staleRecovering = true
    try { await recoverStaleIncidents() } finally { staleRecovering = false }
  }, 5 * 60 * 1000)

  // Cada 30 s retoma tareas Celery que completaron mientras el polling estaba muerto
  setInterval(async () => {
    if (celeryRecovering) return
    celeryRecovering = true
    try { await recoverCeleryTasks() } finally { celeryRecovering = false }
  }, 30_000)
})
