import "dotenv/config"
import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import userRoutes from "./routes/user.routes.js"
import operariosRoutes from "./routes/operarios.routes.js"

import supervisorRoutes from "./routes/supervisor.routes.js"

const app = express()

app.use(cors())
app.use(express.json())

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


app.listen(3000, () => {
  console.log("Users service running on port 3000")
})