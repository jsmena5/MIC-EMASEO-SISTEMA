import pkg from "pg"
const { Pool } = pkg

export const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "MIC-EMASEO",
  password: "1234",
  port: 5432,
  max: 10
})