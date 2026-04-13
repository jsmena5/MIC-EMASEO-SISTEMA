import { pool } from "../db.js"
import jwt from "jsonwebtoken"

export const login = async (req, res) => {
  try {
    const { username, password } = req.body

    // JOIN con ambas tablas de perfil para recuperar nombre sin importar el rol.
    // COALESCE toma el primer valor no-NULL: ciudadano o operario.
    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.password_hash,
         u.rol,
         u.estado,
         COALESCE(c.nombre,   o.nombre)   AS nombre,
         COALESCE(c.apellido, o.apellido) AS apellido
       FROM auth.users u
       LEFT JOIN public.ciudadanos    c ON c.user_id = u.id
       LEFT JOIN operations.operarios o ON o.user_id = u.id
       WHERE u.username = $1`,
      [username]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario no existe" })
    }

    const user = result.rows[0]

    // Bloquear cuentas inactivas o suspendidas antes de verificar contraseña
    if (user.estado !== "ACTIVO") {
      return res.status(403).json({ message: "Cuenta suspendida o inactiva" })
    }

    // Verificación de contraseña con pgcrypto (bcrypt en PostgreSQL)
    const validPasswordResult = await pool.query(
      `SELECT $1 = crypt($2, $1) AS valid`,
      [user.password_hash, password]
    )

    const validPassword = validPasswordResult.rows[0].valid

    if (!validPassword) {
      return res.status(401).json({ message: "Contraseña incorrecta" })
    }

    // tipo_perfil permite al gateway y al frontend distinguir en qué tabla
    // vive el perfil del usuario sin consultar la BD en cada request.
    const tipo_perfil = ["OPERARIO", "SUPERVISOR", "ADMIN"].includes(user.rol)
      ? "operario"
      : "ciudadano"

    const token = jwt.sign(
      {
        id:          user.id,
        username:    user.username,
        rol:         user.rol,
        nombre:      user.nombre,
        tipo_perfil
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