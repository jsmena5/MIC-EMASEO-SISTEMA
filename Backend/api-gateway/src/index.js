import express from "express"
import cors from "cors"
import morgan from "morgan"
import { createProxyMiddleware } from "http-proxy-middleware"

import { verifyToken } from "./middlewares/auth.middleware.js"

const app = express()

app.use(cors())
app.use(express.json())
app.use(morgan("dev"))

/**
 *  PUBLICAS
 */
app.use("/api/auth", createProxyMiddleware({
  target: "http://localhost:3002",
  changeOrigin: true,
  pathRewrite: {
    "^/api": ""
  }
}))

app.use("/api/users", createProxyMiddleware({
  target: "http://localhost:3000",
  changeOrigin: true,
  pathRewrite: {
    "^/api": ""
  }
}))


app.listen(4000, () => {
  console.log("API Gateway running on port 4000")
})