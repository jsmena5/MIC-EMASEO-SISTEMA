import { pool } from "../db.js"

// ─── Transiciones de estado permitidas ────────────────────────────────────────
const TRANSICIONES_VALIDAS = {
  PENDIENTE:   ["EN_ATENCION", "RECHAZADA"],
  EN_ATENCION: ["RESUELTA", "RECHAZADA", "PENDIENTE"],
  RESUELTA:    [],
  RECHAZADA:   [],
  PROCESANDO:  [],
  FALLIDO:     [],
}

// ─── GET /api/supervisor/incidents ───────────────────────────────────────────
// Lista paginada de incidentes con filtros opcionales.
// Query params: estado, prioridad, zona_id, page (default 1), limit (default 20)

export const listIncidents = async (req, res) => {
  const { estado, prioridad, zona_id, page = 1, limit = 20 } = req.query
  const offset = (Math.max(1, Number(page)) - 1) * Math.min(50, Number(limit))
  const pageSize = Math.min(50, Number(limit))

  const conditions = []
  const params     = []

  if (estado)   { params.push(estado);   conditions.push(`i.estado = $${params.length}`) }
  if (prioridad) { params.push(prioridad); conditions.push(`i.prioridad = $${params.length}`) }
  if (zona_id)  { params.push(zona_id);  conditions.push(`i.zona_id = $${params.length}`) }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""

  params.push(pageSize, offset)

  try {
    const { rows } = await pool.query(
      `SELECT
         i.id, i.estado, i.prioridad, i.nota_fallo, i.descripcion, i.direccion,
         i.created_at, i.updated_at, i.resuelto_at,
         ST_Y(i.ubicacion::geometry) AS latitud,
         ST_X(i.ubicacion::geometry) AS longitud,
         i.zona_id,
         z.nombre  AS zona_nombre,
         c.nombre  || ' ' || c.apellido AS ciudadano_nombre,
         c.cedula  AS ciudadano_cedula,
         ii.image_url,
         ar.nivel_acumulacion, ar.tipo_residuo,
         ar.volumen_estimado_m3, ar.confianza,
         (SELECT COUNT(*) FROM incidents.assignments a
          WHERE a.incident_id = i.id AND a.completada = FALSE) AS asignaciones_activas
       FROM incidents.incidents i
       LEFT JOIN operations.zones z      ON z.id = i.zona_id
       LEFT JOIN public.ciudadanos c     ON c.user_id = i.reportado_por
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar  ON ar.incident_id = i.id
       ${where}
       ORDER BY
         CASE i.prioridad
           WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2
           WHEN 'MEDIA'   THEN 3 WHEN 'BAJA' THEN 4
           ELSE 5 END,
         i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )

    const { rows: total } = await pool.query(
      `SELECT COUNT(*) FROM incidents.incidents i ${where}`,
      params.slice(0, -2),
    )

    return res.json({
      incidents: rows,
      total:     Number(total[0].count),
      page:      Number(page),
      limit:     pageSize,
    })
  } catch (err) {
    console.error("[supervisor] listIncidents:", err.message)
    return res.status(500).json({ error: "Error al obtener los incidentes." })
  }
}

// ─── GET /api/supervisor/incidents/:id ───────────────────────────────────────
// Detalle completo: datos del incidente + análisis IA + historial de estados

export const getIncidentDetail = async (req, res) => {
  const { id } = req.params

  try {
    const { rows } = await pool.query(
      `SELECT
         i.id, i.estado, i.prioridad, i.nota_fallo, i.descripcion, i.direccion,
         i.created_at, i.updated_at, i.resuelto_at,
         ST_Y(i.ubicacion::geometry) AS latitud,
         ST_X(i.ubicacion::geometry) AS longitud,
         z.id AS zona_id, z.nombre AS zona_nombre, z.codigo AS zona_codigo,
         c.nombre || ' ' || c.apellido AS ciudadano_nombre,
         c.cedula AS ciudadano_cedula,
         u.email AS ciudadano_email,
         ii.image_url,
         ar.modelo_nombre, ar.tipo_residuo, ar.nivel_acumulacion,
         ar.volumen_estimado_m3, ar.confianza, ar.detecciones,
         ar.tiempo_inferencia_ms, ar.created_at AS analizado_at
       FROM incidents.incidents i
       LEFT JOIN operations.zones z       ON z.id = i.zona_id
       LEFT JOIN public.ciudadanos c      ON c.user_id = i.reportado_por
       LEFT JOIN auth.users u             ON u.id = i.reportado_por
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar   ON ar.incident_id = i.id
       WHERE i.id = $1`,
      [id],
    )

    if (!rows.length) return res.status(404).json({ error: "Incidente no encontrado." })

    // Historial de estados
    const { rows: historial } = await pool.query(
      `SELECT
         sh.estado_anterior, sh.estado_nuevo, sh.observaciones, sh.created_at,
         COALESCE(op.nombre || ' ' || op.apellido, u.username) AS actor,
         u.rol AS actor_rol
       FROM incidents.status_history sh
       JOIN auth.users u ON u.id = sh.cambiado_por
       LEFT JOIN operations.operarios op ON op.user_id = sh.cambiado_por
       WHERE sh.incident_id = $1
       ORDER BY sh.created_at ASC`,
      [id],
    )

    // Asignaciones activas
    const { rows: asignaciones } = await pool.query(
      `SELECT
         a.id, a.completada, a.fecha_esperada, a.notas, a.created_at,
         op.nombre || ' ' || op.apellido AS operario_nombre,
         op.cedula AS operario_cedula
       FROM incidents.assignments a
       JOIN operations.operarios op ON op.user_id = a.operario_id
       WHERE a.incident_id = $1
       ORDER BY a.created_at DESC`,
      [id],
    )

    return res.json({ ...rows[0], historial, asignaciones })
  } catch (err) {
    console.error("[supervisor] getIncidentDetail:", err.message)
    return res.status(500).json({ error: "Error al obtener el detalle del incidente." })
  }
}

// ─── PUT /api/supervisor/incidents/:id/estado ─────────────────────────────────
// Cambia el estado del incidente con validación de transición y trazabilidad.
// Body: { estado: "EN_ATENCION" | "RESUELTA" | "RECHAZADA" | "PENDIENTE", observaciones? }

export const cambiarEstado = async (req, res) => {
  const { id }          = req.params
  const { estado, observaciones } = req.body
  const userId          = req.headers["x-user-id"]

  if (!estado) return res.status(400).json({ error: "El campo 'estado' es requerido." })

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Leer estado actual
    const { rows } = await client.query(
      `SELECT estado FROM incidents.incidents WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!rows.length) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Incidente no encontrado." })
    }

    const estadoActual = rows[0].estado
    const permitidos   = TRANSICIONES_VALIDAS[estadoActual] ?? []
    if (!permitidos.includes(estado)) {
      await client.query("ROLLBACK")
      return res.status(422).json({
        error: `Transición inválida: ${estadoActual} → ${estado}.`,
        permitidos,
      })
    }

    // Inyectar actor para que el trigger fn_log_status_change use el UUID del supervisor
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`)

    // Agregar observaciones al registro de historial si se proporcionaron
    if (observaciones) {
      await client.query(
        `UPDATE incidents.status_history SET observaciones = $1
         WHERE incident_id = $2 AND estado_nuevo = $3
           AND created_at = (
             SELECT MAX(created_at) FROM incidents.status_history
             WHERE incident_id = $2 AND estado_nuevo = $3
           )`,
        [observaciones, id, estadoActual],
      )
    }

    await client.query(
      `UPDATE incidents.incidents SET estado = $1, updated_at = NOW() WHERE id = $2`,
      [estado, id],
    )

    await client.query("COMMIT")

    return res.json({ message: `Incidente actualizado a ${estado}.`, incident_id: id, estado })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[supervisor] cambiarEstado:", err.message)
    return res.status(500).json({ error: "Error al cambiar el estado del incidente." })
  } finally {
    client.release()
  }
}

// ─── POST /api/supervisor/incidents/:id/asignar ───────────────────────────────
// Crea una asignación del incidente a un operario.
// Body: { operario_id, fecha_esperada?, notas? }

export const asignarIncidente = async (req, res) => {
  const { id }                              = req.params
  const { operario_id, fecha_esperada, notas } = req.body
  const supervisorId                        = req.headers["x-user-id"]

  if (!operario_id) return res.status(400).json({ error: "El campo 'operario_id' es requerido." })

  try {
    // Verificar que el incidente exista y esté en un estado asignable
    const { rows: inc } = await pool.query(
      `SELECT estado FROM incidents.incidents WHERE id = $1`, [id],
    )
    if (!inc.length) return res.status(404).json({ error: "Incidente no encontrado." })
    if (!["PENDIENTE", "EN_ATENCION"].includes(inc[0].estado)) {
      return res.status(422).json({
        error: `Solo se pueden asignar incidentes en estado PENDIENTE o EN_ATENCION. Estado actual: ${inc[0].estado}.`,
      })
    }

    // Verificar que el operario exista y esté activo
    const { rows: op } = await pool.query(
      `SELECT o.user_id FROM operations.operarios o
       JOIN auth.users u ON u.id = o.user_id
       WHERE o.user_id = $1 AND u.estado = 'ACTIVO'`,
      [operario_id],
    )
    if (!op.length) return res.status(404).json({ error: "Operario no encontrado o inactivo." })

    const { rows } = await pool.query(
      `INSERT INTO incidents.assignments
         (incident_id, operario_id, asignado_por, fecha_esperada, notas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT uq_assignment_activa DO UPDATE
         SET notas = EXCLUDED.notas, fecha_esperada = EXCLUDED.fecha_esperada,
             updated_at = NOW()
       RETURNING id, created_at`,
      [id, operario_id, supervisorId, fecha_esperada || null, notas || null],
    )

    return res.status(201).json({
      message:      "Incidente asignado correctamente.",
      assignment_id: rows[0].id,
      incident_id:   id,
      operario_id,
      created_at:    rows[0].created_at,
    })
  } catch (err) {
    console.error("[supervisor] asignarIncidente:", err.message)
    return res.status(500).json({ error: "Error al asignar el incidente." })
  }
}

// ─── GET /api/supervisor/zonas/estadisticas ───────────────────────────────────
// Estadísticas por zona para los últimos 30 días.

export const estadisticasZonas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         z.id, z.codigo, z.nombre,
         COUNT(i.id)                                          AS total,
         COUNT(*) FILTER (WHERE i.estado = 'PENDIENTE')      AS pendientes,
         COUNT(*) FILTER (WHERE i.estado = 'EN_ATENCION')    AS en_atencion,
         COUNT(*) FILTER (WHERE i.estado = 'RESUELTA')       AS resueltas,
         COUNT(*) FILTER (WHERE i.estado = 'RECHAZADA')      AS rechazadas,
         COUNT(*) FILTER (WHERE i.estado = 'FALLIDO')        AS fallidas,
         COUNT(*) FILTER (WHERE i.prioridad = 'CRITICA')     AS criticas,
         ROUND(AVG(ar.volumen_estimado_m3)::numeric, 2)      AS volumen_promedio_m3,
         ROUND(AVG(ar.confianza)::numeric, 3)                AS confianza_promedio,
         op.nombre || ' ' || op.apellido                     AS supervisor_nombre
       FROM operations.zones z
       LEFT JOIN incidents.incidents i
         ON i.zona_id = z.id AND i.created_at >= NOW() - INTERVAL '30 days'
       LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN operations.operarios op ON op.user_id = z.supervisor_id
       WHERE z.activa = TRUE
       GROUP BY z.id, z.codigo, z.nombre, op.nombre, op.apellido
       ORDER BY total DESC`,
    )
    return res.json({ zonas: rows })
  } catch (err) {
    console.error("[supervisor] estadisticasZonas:", err.message)
    return res.status(500).json({ error: "Error al obtener estadísticas por zona." })
  }
}

// ─── GET /api/supervisor/operarios ───────────────────────────────────────────
// Lista de operarios activos para el dropdown de asignación.

export const listOperarios = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.user_id AS id,
         o.nombre || ' ' || o.apellido AS nombre_completo,
         o.cedula, o.cargo, o.telefono,
         z.nombre AS zona_nombre,
         COUNT(a.id) FILTER (WHERE a.completada = FALSE) AS asignaciones_activas
       FROM operations.operarios o
       JOIN auth.users u ON u.id = o.user_id
       LEFT JOIN operations.zones z ON z.id = o.zona_id
       LEFT JOIN incidents.assignments a ON a.operario_id = o.user_id
       WHERE u.rol = 'OPERARIO' AND u.estado = 'ACTIVO'
       GROUP BY o.user_id, o.nombre, o.apellido, o.cedula, o.cargo, o.telefono, z.nombre
       ORDER BY o.nombre`,
    )
    return res.json({ operarios: rows })
  } catch (err) {
    console.error("[supervisor] listOperarios:", err.message)
    return res.status(500).json({ error: "Error al obtener operarios." })
  }
}
