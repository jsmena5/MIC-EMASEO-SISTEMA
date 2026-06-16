import { pool } from "../db.js"
import crypto from "node:crypto"

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10)

// ===============================
// GET /api/users/operarios
// ===============================
export const getOperarios = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.nombre,
        u.apellido,
        u.cedula,
        u.telefono,
        u.zona_id,
        u.cargo,
        u.email,
        u.rol,
        u.estado
      FROM app_auth.users u
      WHERE u.rol = 'OPERARIO'
      ORDER BY u.created_at DESC
    `)

    res.json(result.rows)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error obteniendo operarios" })
  }
}

// ===============================
// GET /api/users/operarios/:id
// ===============================
export const getOperarioById = async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      SELECT u.id, u.nombre, u.apellido, u.cedula, u.telefono,
             u.zona_id, u.cargo, u.email, u.rol, u.estado
      FROM app_auth.users u
      WHERE u.id = $1 AND u.rol = 'OPERARIO'
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error" })
  }
}

// ===============================
// POST /api/users/operarios
// ===============================
export const createOperario = async (req, res) => {
  const client = await pool.connect()

  try {
    const { nombre, apellido, cedula, telefono, email, cargo, password, zona_id } = req.body

    await client.query("BEGIN")
    const isProvidedPassword = password && password.length >= 8
    const initialPassword = isProvidedPassword
      ? password
      : crypto.randomBytes(12).toString("base64url")

    await client.query(`
      INSERT INTO app_auth.users
        (email, password_hash, rol, nombre, apellido, cedula, telefono, cargo, zona_id)
      VALUES ($1, crypt($2, gen_salt('bf', $3)), 'OPERARIO', $4, $5, $6, $7, $8, $9)
    `, [email, initialPassword, BCRYPT_ROUNDS, nombre, apellido, cedula, telefono, cargo, zona_id ?? null])

    await client.query("COMMIT")

    const response = { message: "Operario creado" }
    if (!isProvidedPassword) response.password_temporal = initialPassword

    res.status(201).json(response)

  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)
    if (error.code === "23505") {
      return res.status(400).json({ message: "Email o cédula ya registrados" })
    }
    res.status(500).json({ message: "Error creando operario" })
  } finally {
    client.release()
  }
}

// ===============================
// PUT /api/users/operarios/:id
// ===============================
export const updateOperario = async (req, res) => {
  const { id } = req.params
  const { nombre, apellido, telefono, cargo, estado, zona_id } = req.body

  try {
    const { rowCount } = await pool.query(`
      UPDATE app_auth.users
      SET nombre=$1, apellido=$2, telefono=$3, cargo=$4, estado=$5, zona_id=$6, updated_at=NOW()
      WHERE id=$7 AND rol = 'OPERARIO'
    `, [nombre, apellido, telefono, cargo, estado, zona_id ?? null, id])

    if (rowCount === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    res.json({ message: "Actualizado" })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error actualizando" })
  }
}

// ===============================
// DELETE /api/users/operarios/:id
// ===============================
export const deleteOperario = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE app_auth.users
       SET estado = 'INACTIVO', updated_at = NOW()
       WHERE id = $1 AND rol = 'OPERARIO'
       RETURNING id`,
      [req.params.id]
    )

    if (rowCount === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    res.json({ message: "Operario desactivado" })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error eliminando operario" })
  }
}
