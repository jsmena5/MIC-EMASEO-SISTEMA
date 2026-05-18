import "dotenv/config"
import pkg from "pg"
import { logger } from "./utils/logger.js"
const { Pool } = pkg

export const pool = new Pool({
  user:                    process.env.DB_USER_USERS,
  host:                    process.env.DB_HOST,
  database:                process.env.DB_NAME,
  password:                process.env.DB_PASSWORD_USERS,
  port:                    Number(process.env.DB_PORT) || 5432,
  max:                     20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis:       30_000,
})

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg.Pool idle client error")
})