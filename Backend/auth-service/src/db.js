import "dotenv/config"
import pkg from "pg"
import { logger } from "./utils/logger.js"
const { Pool } = pkg

export const pool = new Pool({
  user:                    process.env.DB_USER_AUTH,
  host:                    process.env.DB_HOST,
  database:                process.env.DB_NAME,
  password:                process.env.DB_PASSWORD_AUTH,
  port:                    Number(process.env.DB_PORT) || 5432,
  max:                     5,
  connectionTimeoutMillis: 8_000,
  // Supabase cierra conexiones idle en ~300 s. Usamos 60 s para descartar
  // clientes del pool antes de que el servidor los mate silenciosamente.
  idleTimeoutMillis:       20_000,
  // keepAlive envía paquetes TCP periódicos para detectar conexiones muertas
  // antes de que la siguiente consulta falle con "Connection terminated".
  keepAlive:               true,
  keepAliveInitialDelayMillis: 10_000,
  ssl:                     process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
})

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg.Pool idle client error")
})