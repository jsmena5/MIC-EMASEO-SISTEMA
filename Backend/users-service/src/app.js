import "dotenv/config"
import express from "express"
import cors from "cors"
import userRoutes from "./routes/user.routes.js"

const app = express()

app.use(cors())
app.use(express.json())

app.use("/api/users", userRoutes)

app.listen(3000, () => {
  console.log("Users service running on port 3000")
})