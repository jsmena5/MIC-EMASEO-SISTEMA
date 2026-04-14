import express from "express"
import cors from "cors"
import imageRoutes from "./routes/image.routes.js"

const app = express()

app.use(cors())
app.use(express.json({ limit: "50mb" }))

app.use("/api/image", imageRoutes)

app.listen(5000, () => {
  console.log("image-ms corriendo en puerto 5000")
})