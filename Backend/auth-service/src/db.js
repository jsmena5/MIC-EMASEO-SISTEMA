import "dotenv/config"
import pkg from "pg"
const { Pool } = pkg

export const pool = new Pool({
  user:                    process.env.DB_USER_AUTH,
  host:                    process.env.DB_HOST,
  database:                process.env.DB_NAME,
  password:                process.env.DB_PASSWORD_AUTH,
  port:                    Number(process.env.DB_PORT) || 5432,
  max:                     10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis:       30_000,
})