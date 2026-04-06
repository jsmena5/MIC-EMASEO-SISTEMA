import { pool } from "../db.js"
import jwt from "jsonwebtoken"

export const login = async (req, res) => {
  try {
    const { username, password } = req.body

    const result = await pool.query(
      `SELECT id, username, password_hash, rol 
       FROM auth.users 
       WHERE username = $1`,
      [username]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario no existe" })
    }

    const user = result.rows[0]

    // VALIDACIÓN CORRECTA CON POSTGRES
    const validPasswordResult = await pool.query(
      `SELECT $1 = crypt($2, $1) AS valid`,
      [user.password_hash, password]
    )

    const validPassword = validPasswordResult.rows[0].valid

    if (!validPassword) {
      return res.status(401).json({ message: "Contraseña incorrecta" })
    }

    // TOKEN
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        rol: user.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    )

    res.json({ token })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error en login" })
  }
}