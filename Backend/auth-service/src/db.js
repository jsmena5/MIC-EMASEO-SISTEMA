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
  max:                     20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis:       30_000,
  ssl:                     process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
})

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg.Pool idle client error")
})