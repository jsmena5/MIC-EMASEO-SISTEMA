import { pool } from "../db.js"

// ─── GET /api/operario/asignaciones ──────────────────────────────────────────
// Retorna las asignaciones activas del operario autenticado,
// ordenadas por prioridad del incidente (CRITICA primero).

export const getAsignaciones = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  try {
    const { rows } = await pool.query(
      `SELECT
         a.id          AS asignacion_id,
         a.fecha_esperada,
         a.notas,
         a.created_at  AS asignado_el,
         i.id          AS incident_id,
         i.estado,
         i.prioridad,
         i.descripcion,
         i.direccion,
         i.created_at  AS incidente_creado_at,
         ST_Y(i.ubicacion::geometry) AS latitud,
         ST_X(i.ubicacion::geometry) AS longitud,
         z.nombre      AS zona_nombre,
         ii.image_url,
         ar.nivel_acumulacion, ar.tipo_residuo, ar.volumen_estimado_m3,
         sup.nombre || ' ' || sup.apellido AS asignado_por_nombre
       FROM incidents.assignments a
       JOIN incidents.incidents i        ON i.id = a.incident_id
       LEFT JOIN operations.zones z      ON z.id = i.zona_id
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar  ON ar.incident_id = i.id
       LEFT JOIN operations.operarios sup ON sup.user_id = a.asignado_por
       WHERE a.operario_id = $1 AND a.completada = FALSE
       ORDER BY
         CASE i.prioridad
           WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2
           WHEN 'MEDIA'   THEN 3 WHEN 'BAJA' THEN 4
           ELSE 5 END,
         a.fecha_esperada ASC NULLS LAST,
         a.created_at DESC`,
      [userId],
    )

    return res.json({ asignaciones: rows })
  } catch (err) {
    console.error("[operario] getAsignaciones:", err.message)
    return res.status(500).json({ error: "Error al obtener tus asignaciones." })
  }
}

// ─── PUT /api/operario/asignaciones/:id/completar ────────────────────────────
// El operario marca su asignación como completada.
// La transacción también cambia el incidente a RESUELTA y activa los triggers
// de status_history y notifications automáticamente.

export const completarAsignacion = async (req, res) => {
  const { id }   = req.params
  const userId   = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Verificar que la asignación pertenezca al operario y esté activa
    const { rows } = await client.query(
      `SELECT a.id, a.incident_id, i.estado
       FROM incidents.assignments a
       JOIN incidents.incidents i ON i.id = a.incident_id
       WHERE a.id = $1 AND a.operario_id = $2 AND a.completada = FALSE
       FOR UPDATE OF a`,
      [id, userId],
    )

    if (!rows.length) {
      await client.query("ROLLBACK")
      return res.status(404).json({
        error: "Asignación no encontrada, ya completada o no te pertenece.",
      })
    }

    const { incident_id, estado } = rows[0]

    if (estado === 'RESUELTA') {
      await client.query("ROLLBACK")
      return res.status(422).json({ error: "El incidente ya está marcado como RESUELTA." })
    }

    // Marcar la asignación como completada
    await client.query(
      `UPDATE incidents.assignments
       SET completada = TRUE, completada_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    )

    // Inyectar actor para el trigger de status_history
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`)

    // Cambiar el incidente a RESUELTA — el trigger fn_log_status_change
    // escribe en status_history y setea resuelto_at automáticamente.
    // El trigger fn_notify_citizen inserta la notificación PUSH al ciudadano.
    await client.query(
      `UPDATE incidents.incidents
       SET estado = 'RESUELTA', updated_at = NOW()
       WHERE id = $1`,
      [incident_id],
    )

    await client.query("COMMIT")

    return res.json({
      message:       "Asignación completada. El incidente fue marcado como RESUELTA.",
      asignacion_id: id,
      incident_id,
    })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[operario] completarAsignacion:", err.message)
    return res.status(500).json({ error: "Error al completar la asignación." })
  } finally {
    client.release()
  }
}
