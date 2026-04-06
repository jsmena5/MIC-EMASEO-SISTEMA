import express from "express"
import cors from "cors"
import authRoutes from "./routes/auth.routes.js"
import dotenv from "dotenv"

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

app.use("/api/auth", authRoutes)

app.listen(process.env.PORT, () => {
  console.log("Auth service running on port 3002")
})