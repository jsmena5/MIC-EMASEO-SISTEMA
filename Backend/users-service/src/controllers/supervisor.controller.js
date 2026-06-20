import { pool } from "../db.js"
import crypto from "node:crypto"

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10)

// ===============================
// GET /api/users/supervisores
// ===============================
export const getSupervisores = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.nombre,
        u.apellido,
        u.cedula,
        u.telefono,
        u.zona_id,
        u.email,
        u.rol,
        u.estado
      FROM app_auth.users u
      WHERE u.rol = 'SUPERVISOR' AND u.estado = 'ACTIVO'
      ORDER BY u.created_at DESC
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
      SELECT u.id, u.nombre, u.apellido, u.cedula, u.telefono,
             u.zona_id, u.email, u.rol, u.estado
      FROM app_auth.users u
      WHERE u.id = $1 AND u.rol = 'SUPERVISOR'
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
const ROL_LABEL = {
  CIUDADANO: "ciudadana",
  SUPERVISOR: "supervisor",
  OPERARIO:   "operario",
  ADMIN:      "administrador",
}

export const createSupervisor = async (req, res) => {
  const client = await pool.connect()

  try {
    const { nombre, apellido, cedula, telefono, email, password } = req.body

    const conflicto = await client.query(
      `SELECT
         (email = $1)                             AS email_conflicto,
         (cedula IS NOT NULL AND cedula = $2)     AS cedula_conflicto
       FROM app_auth.users
       WHERE rol = 'SUPERVISOR'
         AND (email = $1 OR (cedula IS NOT NULL AND cedula = $2))
       LIMIT 1`,
      [email, cedula ?? null]
    )
    if (conflicto.rows.length > 0) {
      const { email_conflicto, cedula_conflicto } = conflicto.rows[0]
      const campos = [...(email_conflicto ? ["correo"] : []), ...(cedula_conflicto ? ["cédula"] : [])].join(" y ")
      return res.status(409).json({
        message: `El ${campos} ya está registrado en otra cuenta supervisor.`,
      })
    }

    await client.query("BEGIN")

    const isProvidedPassword = password && password.length >= 8
    const initialPassword = isProvidedPassword
      ? password
      : crypto.randomBytes(12).toString("base64url")

    await client.query(`
      INSERT INTO app_auth.users
        (email, password_hash, rol, nombre, apellido, cedula, telefono)
      VALUES ($1, crypt($2, gen_salt('bf', $3)), 'SUPERVISOR', $4, $5, $6, $7)
    `, [email, initialPassword, BCRYPT_ROUNDS, nombre, apellido, cedula, telefono])

    await client.query("COMMIT")

    const response = { message: "Supervisor creado" }
    if (!isProvidedPassword) response.password_temporal = initialPassword

    res.status(201).json(response)

  } catch (error) {
    console.error(error)
    await client.query("ROLLBACK")
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email o cédula ya registrados" })
    }
    res.status(500).json({ message: "Error creando supervisor" })
  } finally {
    client.release()
  }
}

// ===============================
export const updateSupervisor = async (req, res) => {
  const { id } = req.params
  const { nombre, apellido, telefono, estado } = req.body

  try {
    const { rowCount } = await pool.query(`
      UPDATE app_auth.users
      SET nombre=$1, apellido=$2, telefono=$3, estado=$4, updated_at=NOW()
      WHERE id=$5 AND rol = 'SUPERVISOR'
    `, [nombre, apellido, telefono, estado, id])

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
export const deleteSupervisor = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE app_auth.users
       SET estado = 'INACTIVO', updated_at = NOW()
       WHERE id = $1 AND rol = 'SUPERVISOR'
       RETURNING id`,
      [req.params.id]
    )

    if (rowCount === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    res.json({ message: "Supervisor desactivado" })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error eliminando supervisor" })
  }
}
