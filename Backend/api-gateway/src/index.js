import express from "express"
import cors from "cors"
import morgan from "morgan"
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use(cors())
app.use(morgan("dev"))

// ✅ AUTH (CORRECTO)
app.use("/api/auth", createProxyMiddleware({
  target: "http://localhost:3002",
  changeOrigin: true,
  logLevel: "debug",
  pathRewrite: (path, req) => {
    return "/api/auth" + path   // 🔥 CLAVE ABSOLUTA
  }
}))

// ✅ USERS (CORRECTO)
app.use("/api/users", createProxyMiddleware({
  target: "http://localhost:3000",
  changeOrigin: true,
  logLevel: "debug",
  pathRewrite: (path, req) => {
    return "/api/users" + path
  }
}))

app.listen(4000, () => {
  console.log("API Gateway running on port 4000")
})