import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import authRoutes from "./routes/auth.routes.js"

const app = express()

// Servicio interno — solo el gateway (server-to-server) debe acceder.
// Cualquier petición directa desde un browser (con cabecera Origin) es rechazada.
app.use(cors({ origin: false }))
app.use(express.json())

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