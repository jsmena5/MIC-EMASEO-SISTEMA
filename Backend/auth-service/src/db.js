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
  min:                     1,
  connectionTimeoutMillis: 8_000,
  // Supabase/PgBouncer cierra conexiones idle a nivel de aplicación ~30s.
  // idleTimeoutMillis < 30s asegura que el pool descarta la conexión
  // antes de que Supabase la cierre por su cuenta.
  idleTimeoutMillis:       20_000,
  keepAlive:               true,
  keepAliveInitialDelayMillis: 5_000,
  ssl:                     process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
})

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg.Pool idle client error")
})

// Ping activo cada 25 s para evitar que Supabase cierre conexiones inactivas.
// El PgBouncer de Supabase tiene un timeout de ~30 s a nivel de aplicación
// que no respeta TCP keepalive — un SELECT 1 periódico lo previene.
setInterval(() => {
  pool.query("SELECT 1").catch((err) => {
    logger.warn({ err: err.message }, "pg.Pool keepalive ping failed")
  })
}, 25_000)