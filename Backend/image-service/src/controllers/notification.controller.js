import { pool } from "../db.js"

export const getNotifications = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No autenticado." })

  try {
    const { rows } = await pool.query(
      `SELECT id, incident_id, titulo, mensaje, estado, created_at
       FROM notifications.notifications
       WHERE usuario_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    )
    return res.json({ notifications: rows })
  } catch (err) {
    console.error("[getNotifications]", err.message)
    return res.status(500).json({ error: "Error al obtener notificaciones." })
  }
}

export const markNotificationRead = async (req, res) => {
  const userId = req.headers["x-user-id"]
  const { id } = req.params
  if (!userId) return res.status(401).json({ error: "No autenticado." })

  try {
    await pool.query(
      `UPDATE notifications.notifications
       SET estado = 'LEIDA', leida_at = NOW()
       WHERE id = $1 AND usuario_id = $2`,
      [id, userId]
    )
    return res.status(204).send()
  } catch (err) {
    console.error("[markNotificationRead]", err.message)
    return res.status(500).json({ error: "Error al actualizar notificación." })
  }
}

export const markAllNotificationsRead = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No autenticado." })

  try {
    await pool.query(
      `UPDATE notifications.notifications
       SET estado = 'LEIDA', leida_at = NOW()
       WHERE usuario_id = $1 AND estado <> 'LEIDA'`,
      [userId]
    )
    return res.status(204).send()
  } catch (err) {
    console.error("[markAllNotificationsRead]", err.message)
    return res.status(500).json({ error: "Error al actualizar notificaciones." })
  }
}
