import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]

  if (!authHeader) {
    return res.status(403).json({ message: "Token requerido" })
  }

  try {
    const token = authHeader.split(" ")[1]

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "mic_emaseo_secret_2025")

    req.user = decoded
    next()

  } catch (error) {
    return res.status(401).json({ message: "Token inválido" })
  }
}