import { pool } from "../db.js"
import crypto from "node:crypto"

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10)

// ===============================
// GET ALL
// ===============================
export const getSupervisores = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.user_id,
        s.nombre,
        s.apellido,
        s.cedula,
        s.telefono,
        s.zona_id,
        u.email,
        u.username,
        u.rol,
        u.estado
      FROM operations.operarios s
      JOIN app_auth.users u ON u.id = s.user_id
      WHERE u.rol = 'SUPERVISOR' AND u.estado = 'ACTIVO'
      ORDER BY s.created_at DESC
    `)

    res.json(result.rows)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error obteniendo supervisores" })
  }
}

// ===============================
export const getSupervisorById = async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      SELECT s.*, u.email, u.username, u.rol, u.estado
      FROM operations.operarios s
      JOIN app_auth.users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.rol = 'SUPERVISOR'
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
export const createSupervisor = async (req, res) => {
  const client = await pool.connect()

  try {
    const { nombre, apellido, cedula, telefono, email, password } = req.body

    await client.query("BEGIN")
    const isProvidedPassword = password && password.length >= 8
    const initialPassword = isProvidedPassword
      ? password
      : crypto.randomBytes(12).toString("base64url")

    // USER
    const userResult = await client.query(`
      INSERT INTO app_auth.users (username, email, password_hash, rol)
      VALUES ($1, $2, crypt($3, gen_salt('bf', $4)), 'SUPERVISOR')
      RETURNING id
    `, [cedula, email, initialPassword, BCRYPT_ROUNDS])

    const userId = userResult.rows[0].id

    // PERFIL
    await client.query(`
      INSERT INTO operations.operarios
      (user_id, nombre, apellido, cedula, telefono)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, nombre, apellido, cedula, telefono])

    await client.query("COMMIT")

    const response = { message: "Supervisor creado" }
    if (!isProvidedPassword) response.password_temporal = initialPassword

    res.status(201).json(response)

  } catch (error) {
    console.error(error)
    await client.query("ROLLBACK")
    res.status(500).json({ message: "Error creando supervisor" })
  } finally {
    client.release()
  }
}

// ===============================
export const updateSupervisor = async (req, res) => {
  const { id } = req.params
  const { nombre, apellido, telefono, estado } = req.body

  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const op = await client.query(
      `SELECT o.user_id
       FROM operations.operarios o
       JOIN app_auth.users u ON u.id = o.user_id
       WHERE o.id = $1 AND u.rol = 'SUPERVISOR'`,
      [id]
    )

    if (op.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ message: "No encontrado" })
    }

    const userId = op.rows[0].user_id

    await client.query(`
      UPDATE operations.operarios
      SET nombre=$1, apellido=$2, telefono=$3
      WHERE id=$4
    `, [nombre, apellido, telefono, id])

    await client.query(`
      UPDATE app_auth.users
      SET estado=$1
      WHERE id=$2
    `, [estado, userId])

    await client.query("COMMIT")

    res.json({ message: "Actualizado" })

  } catch (error) {
    console.error(error)
    await client.query("ROLLBACK")
    res.status(500).json({ message: "Error actualizando" })
  } finally {
    client.release()
  }
}

// ===============================
export const deleteSupervisor = async (req, res) => {
  const { id } = req.params
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { rowCount } = await client.query(
      `UPDATE app_auth.users
       SET estado = 'INACTIVO', updated_at = NOW()
       WHERE id = (
         SELECT o.user_id
         FROM operations.operarios o
         JOIN app_auth.users u ON u.id = o.user_id
         WHERE o.id = $1 AND u.rol = 'SUPERVISOR'
       )
       RETURNING id`,
      [id]
    )

    if (rowCount === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ message: "No encontrado" })
    }

    await client.query("COMMIT")
    res.json({ message: "Supervisor desactivado" })

  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)
    res.status(500).json({ message: "Error eliminando supervisor" })
  } finally {
    client.release()
  }
}
