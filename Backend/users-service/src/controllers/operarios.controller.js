import { pool } from "../db.js"

// ===============================
// GET /api/users/operarios
// ===============================
export const getOperarios = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        o.user_id,
        o.nombre,
        o.apellido,
        o.cedula,
        o.telefono,
        o.zona_id,
        o.cargo,
        u.email,
        u.username,
        u.rol,
        u.estado
      FROM operations.operarios o
      JOIN auth.users u ON u.id = o.user_id
      ORDER BY o.created_at DESC
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
      SELECT o.*, u.email, u.username, u.rol, u.estado
      FROM operations.operarios o
      JOIN auth.users u ON u.id = o.user_id
      WHERE o.id = $1
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
// POST /api/users/operarios
// ===============================
export const createOperario = async (req, res) => {
  const client = await pool.connect()

  try {
    const { nombre, apellido, cedula, telefono, email, rol, cargo } = req.body

    await client.query("BEGIN")

    // 1. Crear user
    const userResult = await client.query(`
      INSERT INTO auth.users (username, email, password_hash, rol)
      VALUES ($1, $2, crypt('123456', gen_salt('bf')), $3)
      RETURNING id
    `, [cedula, email, rol])

    const userId = userResult.rows[0].id

    // 2. Crear perfil
    await client.query(`
      INSERT INTO operations.operarios 
      (user_id, nombre, apellido, cedula, telefono, cargo)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, nombre, apellido, cedula, telefono, cargo])

    await client.query("COMMIT")

    res.status(201).json({ message: "Operario creado" })

  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)
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
  const { nombre, apellido, telefono, cargo, estado } = req.body

  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const op = await client.query(
      `SELECT user_id FROM operations.operarios WHERE id = $1`,
      [id]
    )

    if (op.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    const userId = op.rows[0].user_id

    await client.query(`
      UPDATE operations.operarios
      SET nombre=$1, apellido=$2, telefono=$3, cargo=$4
      WHERE id=$5
    `, [nombre, apellido, telefono, cargo, id])

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
// DELETE /api/users/operarios/:id
// ===============================
export const deleteOperario = async (req, res) => {
  const { id } = req.params

  try {
    const op = await pool.query(
      `SELECT user_id FROM operations.operarios WHERE id=$1`,
      [id]
    )

    if (op.rows.length === 0) {
      return res.status(404).json({ message: "No encontrado" })
    }

    const userId = op.rows[0].user_id

    // elimina todo por cascade
    await pool.query(`DELETE FROM auth.users WHERE id=$1`, [userId])

    res.json({ message: "Eliminado" })

  } catch (error) {
    res.status(500).json({ message: "Error eliminando" })
  }
}