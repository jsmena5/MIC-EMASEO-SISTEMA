import "dotenv/config"
import pkg from "pg"
import { logger } from "./utils/logger.js"
const { Pool } = pkg

// node-postgres deserializa NUMERIC/DECIMAL como string para no perder precisión.
// Convertimos a float en el driver para que el frontend reciba números JS directamente.
// OID 1700 = NUMERIC/DECIMAL  (columnas numéricas de operaciones/zonas)
// OID 701  = FLOAT8/DOUBLE PRECISION  (resultado de ST_X / ST_Y → latitud, longitud)
pkg.types.setTypeParser(1700, Number.parseFloat)
pkg.types.setTypeParser(701,  Number.parseFloat)

export const pool = new Pool({
  user:                    process.env.DB_USER_USERS,
  host:                    process.env.DB_HOST,
  database:                process.env.DB_NAME,
  password:                process.env.DB_PASSWORD_USERS,
  port:                    Number(process.env.DB_PORT) || 5432,
  max:                     5,
  min:                     1,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis:       20_000,
  keepAlive:               true,
  keepAliveInitialDelayMillis: 5_000,
  ssl:                     process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
})

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg.Pool idle client error")
})

setInterval(() => {
  pool.query("SELECT 1").catch((err) => {
    logger.warn({ err: err.message }, "pg.Pool keepalive ping failed")
  })
}, 25_000)