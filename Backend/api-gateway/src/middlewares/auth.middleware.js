import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

if (!process.env.JWT_SECRET) {
  throw new Error("La variable de entorno JWT_SECRET es obligatoria — el gateway no puede arrancar sin ella.")
}

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]

  if (!authHeader) {
    return res.status(403).json({ message: "Token requerido" })
  }

  try {
    const token = authHeader.split(" ")[1]

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    req.user = decoded
    next()

  } catch {

    return res.status(401).json({ message: "Token inválido" )
  }
}