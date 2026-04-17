import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import imageRoutes from "./routes/image.routes.js"

const app = express()

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

app.listen(5000, () => {
  console.log("image-ms corriendo en puerto 5000")
})