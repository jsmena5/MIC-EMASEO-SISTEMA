import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import imageRoutes from "./routes/image.routes.js"
import incidentRoutes from "./routes/incident.routes.js"

const REQUIRED_ENV = ["S3_PUBLIC_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[image-service] Variable de entorno obligatoria no definida: ${key}. El servicio no puede iniciar.`)
    process.exit(1)
  }
}

const app = express()

app.set("trust proxy", 1)
app.use(cors())
app.use(express.json({ limit: "50mb" }))

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

app.listen(5000, () => {
  console.log("image-ms corriendo en puerto 5000")
})