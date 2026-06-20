import { pool } from "../db.js"

// ─── POST /api/operario/feedback/:incident_id ─────────────────────────────────
//
// Registra (o actualiza) el feedback del usuario autenticado sobre el análisis IA
// de un incidente. Accesible para OPERARIO, SUPERVISOR y ADMIN (requireStaff en GW).
//
// Body: { es_correcta: boolean, comentario?: string }
//
// • Si ya existe feedback del mismo usuario para ese análisis → UPDATE (upsert).
// • Un incidente solo tiene un analysis_result (1:1); busca por incident_id.

export const submitFeedback = async (req, res) => {
  const { incident_id }                   = req.params
  const { es_correcta, comentario = null } = req.body
  const userId                            = req.headers["x-user-id"]

  if (!userId) {
    return res.status(401).json({ error: "No se pudo identificar al usuario." })
  }

  if (es_correcta === undefined || es_correcta === null) {
    return res.status(400).json({ error: "El campo 'es_correcta' (boolean) es requerido." })
  }

  if (typeof es_correcta !== "boolean") {
    return res.status(400).json({ error: "El campo 'es_correcta' debe ser true o false." })
  }

  try {
    // Obtener el analysis_result_id del incidente
    const { rows: arRows } = await pool.query(
      `SELECT id FROM ai.analysis_results WHERE incident_id = $1`,
      [incident_id]
    )

    if (!arRows.length) {
      return res.status(404).json({
        error: "No se encontró análisis de IA para este incidente. Solo se puede dar feedback sobre incidentes con análisis completado.",
      })
    }

    const analysisResultId = arRows[0].id

    // Upsert: INSERT o UPDATE si el usuario ya había dado feedback
    const { rows } = await pool.query(
      `INSERT INTO ai.analysis_feedback
         (analysis_result_id, es_correcta, comentario, reportado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT uq_feedback_per_user
       DO UPDATE SET
         es_correcta = EXCLUDED.es_correcta,
         comentario  = EXCLUDED.comentario,
         updated_at  = NOW()
       RETURNING id, es_correcta, comentario, created_at, updated_at`,
      [analysisResultId, es_correcta, comentario, userId]
    )

    return res.status(201).json({
      message:            "Feedback registrado correctamente.",
      feedback_id:        rows[0].id,
      incident_id,
      analysis_result_id: analysisResultId,
      es_correcta:        rows[0].es_correcta,
      comentario:         rows[0].comentario,
      created_at:         rows[0].created_at,
      updated_at:         rows[0].updated_at,
    })
  } catch (err) {
    console.error("[feedback] submitFeedback:", err.message)
    return res.status(500).json({ error: "Error al registrar el feedback." })
  }
}

// ─── GET /api/operario/feedback/:incident_id ──────────────────────────────────
// Consulta el feedback existente para un incidente (todos los usuarios).
// Útil para que el supervisor vea el consenso antes de reentrenar.

export const getFeedback = async (req, res) => {
  const { incident_id } = req.params

  try {
    const { rows } = await pool.query(
      `SELECT
         af.id,
         af.es_correcta,
         af.comentario,
         af.created_at,
         af.updated_at,
         u.nombre || ' ' || u.apellido AS reportado_por_nombre,
         u.rol                         AS reportado_por_rol
       FROM ai.analysis_feedback af
       JOIN ai.analysis_results ar ON ar.id = af.analysis_result_id
       JOIN app_auth.users u           ON u.id  = af.reportado_por
       WHERE ar.incident_id = $1
       ORDER BY af.created_at DESC`,
      [incident_id]
    )

    const total    = rows.length
    const correctos = rows.filter((r) => r.es_correcta).length

    return res.json({
      incident_id,
      total_feedback:    total,
      correctos,
      incorrectos:       total - correctos,
      consenso_correcto: total > 0 ? correctos / total >= 0.5 : null,
      feedback:          rows,
    })
  } catch (err) {
    console.error("[feedback] getFeedback:", err.message)
    return res.status(500).json({ error: "Error al obtener el feedback." })
  }
}
