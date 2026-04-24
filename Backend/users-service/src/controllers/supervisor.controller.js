import { pool } from "../db.js"

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
      FROM operations.supervisores s
      JOIN auth.users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
    `)

    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo supervisores" })
  }
}

// ===============================
export const getSupervisorById = async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      SELECT s.*, u.email, u.username, u.rol, u.estado
      FROM operations.supervisores s
      JOIN auth.users u ON u.id = s.user_id
      WHERE s.id = $1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ message: "Error" })
  }
}

// ===============================
export const createSupervisor = async (req, res) => {
  const client = await pool.connect()

  try {
    const { nombre, apellido, cedula, telefono, email } = req.body

    await client.query("BEGIN")

    // USER
    const userResult = await client.query(`
      INSERT INTO auth.users (username, email, password_hash, rol)
      VALUES ($1, $2, crypt('123456', gen_salt('bf')), 'SUPERVISOR')
      RETURNING id
    `, [cedula, email])

    const userId = userResult.rows[0].id

    // PERFIL
    await client.query(`
      INSERT INTO operations.supervisores 
      (user_id, nombre, apellido, cedula, telefono)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, nombre, apellido, cedula, telefono])

    await client.query("COMMIT")

    res.status(201).json({ message: "Supervisor creado" })

  } catch (error) {
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
      `SELECT user_id FROM operations.supervisores WHERE id = $1`,
      [id]
    )

    if (op.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    const userId = op.rows[0].user_id

    await client.query(`
      UPDATE operations.supervisores
      SET nombre=$1, apellido=$2, telefono=$3
      WHERE id=$4
    `, [nombre, apellido, telefono, id])

    await client.query(`
      UPDATE auth.users
      SET estado=$1
      WHERE id=$2
    `, [estado, userId])

    await client.query("COMMIT")

    res.json({ message: "Actualizado" })

  } catch (error) {
    await client.query("ROLLBACK")
    res.status(500).json({ message: "Error actualizando" })
  } finally {
    client.release()
  }
}

// ===============================
export const deleteSupervisor = async (req, res) => {
  const { id } = req.params

  try {
    const op = await pool.query(
      `SELECT user_id FROM operations.supervisores WHERE id=$1`,
      [id]
    )

    if (op.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    const userId = op.rows[0].user_id

    await pool.query(`DELETE FROM auth.users WHERE id=$1`, [userId])

    res.json({ message: "Eliminado" })

  } catch (error) {
    res.status(500).json({ message: "Error eliminando" })
  }
}