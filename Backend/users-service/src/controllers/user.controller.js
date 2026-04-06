import { pool } from "../db.js"

export const registerUser = async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      cedula,
      username,
      email,
      password
    } = req.body

    const result = await pool.query(
      `INSERT INTO auth.users 
      (nombre, apellido, cedula, username, email, password_hash)
      VALUES ($1,$2,$3,$4,$5, crypt($6, gen_salt('bf')))
      RETURNING id, nombre, apellido, username, email, rol`,
      [nombre, apellido, cedula, username, email, password]
    )

    res.json(result.rows[0])

  } catch (error) {
    console.error(error)

    // error de duplicados
    if (error.code === "23505") {
      return res.status(400).json({
        message: "Cédula, email o username ya existe"
      })
    }

    res.status(500).json({ message: "Error en servidor" })
  }
}