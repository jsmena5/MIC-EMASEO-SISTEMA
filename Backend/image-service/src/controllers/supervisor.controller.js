import { pool } from "../db.js"

// ─── Transiciones de estado permitidas ────────────────────────────────────────
//
// Máquina de estados completa (migración 032):
//
//  Pipeline ML (automático):
//    PROCESANDO → PENDIENTE    (has_waste=true, INCIDENTE_VALIDO)
//    PROCESANDO → EN_REVISION  (has_waste=false, confianza < umbral, REVISION_REQUERIDA)
//    PROCESANDO → DESCARTADO   (has_waste=false, confianza ≥ umbral, RECHAZO_CONFIABLE)
//    PROCESANDO → FALLIDO      (error técnico, ERROR_TECNICO)
//
//  Supervisor (manual):
//    PENDIENTE    → EN_ATENCION | RECHAZADA
//    EN_ATENCION  → RESUELTA | RECHAZADA | PENDIENTE
//    EN_REVISION  → PENDIENTE (supervisor valida) | RECHAZADA (supervisor rechaza)
//    DESCARTADO   → PENDIENTE (supervisor anula el rechazo automático)
//    RESUELTA     → (terminal)
//    RECHAZADA    → (terminal)
//    FALLIDO      → (terminal)

const TRANSICIONES_VALIDAS = {
  PENDIENTE:   ["REVISADO", "EN_ATENCION", "RECHAZADA"],
  REVISADO:    [],                           // terminal en el alcance actual del supervisor
  EN_ATENCION: ["RESUELTA", "RECHAZADA", "PENDIENTE"],
  EN_REVISION: ["PENDIENTE", "RECHAZADA"],   // supervisor valida o descarta
  DESCARTADO:  ["PENDIENTE"],                // supervisor puede anular rechazo automático
  RESUELTA:    [],
  RECHAZADA:   [],
  PROCESANDO:  [],
  FALLIDO:     [],
}

// ─── GET /api/supervisor/incidents ───────────────────────────────────────────
// Lista paginada de incidentes con filtros opcionales.
// Query params:
//   estado, prioridad, zona_id             — filtros estándar
//   decision_automatica                    — filtro por tipo de decisión ML
//   fecha_desde, fecha_hasta               — rango de fechas (ISO date, ej. 2026-01-15)
//   ia_incorrecta=true                     — solo incidentes donde supervisor marcó IA incorrecta
//   sin_supervisar=true                    — solo incidentes con análisis ML no revisados aún
//   page (default 1), limit (default 20)

export const listIncidents = async (req, res) => {
  const {
    estado, prioridad, zona_id,
    decision_automatica,
    fecha_desde, fecha_hasta,
    ia_incorrecta, sin_supervisar,
    sort = 'priority',
    page = 1, limit = 20,
  } = req.query

  const pageNum  = Math.max(1, Number(page))
  const pageSize = Math.min(50, Math.max(1, Number(limit)))
  const offset   = (pageNum - 1) * pageSize

  const conditions = []
  const params     = []

  if (estado)              { params.push(estado);              conditions.push(`i.estado = $${params.length}`) }
  if (prioridad)           { params.push(prioridad);           conditions.push(`i.prioridad = $${params.length}`) }
  if (zona_id)             { params.push(zona_id);             conditions.push(`i.zona_id = $${params.length}`) }
  if (decision_automatica) { params.push(decision_automatica); conditions.push(`i.decision_automatica = $${params.length}`) }

  if (fecha_desde) {
    params.push(fecha_desde)
    conditions.push(`i.created_at >= $${params.length}::date`)
  }
  if (fecha_hasta) {
    params.push(fecha_hasta)
    conditions.push(`i.created_at < ($${params.length}::date + INTERVAL '1 day')`)
  }
  if (ia_incorrecta === 'true') {
    conditions.push(`ar.ia_fue_correcta = FALSE`)
  }
  if (sin_supervisar === 'true') {
    conditions.push(`ar.id IS NOT NULL AND ar.supervisado_por IS NULL`)
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""

  params.push(pageSize, offset)

  try {
    // COUNT(*) OVER() devuelve el total en cada fila sin una query separada,
    // eliminando la posible inconsistencia entre COUNT y SELECT en lecturas concurrentes.
    const { rows } = await pool.query(
      `SELECT
         i.id, i.estado, i.prioridad, i.nota_fallo, i.descripcion, i.direccion,
         i.decision_automatica, i.confianza_decision, i.imagen_auditoria_url,
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
         ar.ia_fue_correcta,
         ar.supervisado_at,
         jsonb_array_length(ar.detecciones) AS num_detecciones,
         (SELECT COUNT(*) FROM incidents.assignments a
          WHERE a.incident_id = i.id AND a.completada = FALSE) AS asignaciones_activas,
         COUNT(*) OVER() AS total_count
       FROM incidents.incidents i
       LEFT JOIN operations.zones z      ON z.id = i.zona_id
       LEFT JOIN public.ciudadanos c     ON c.user_id = i.reportado_por
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar  ON ar.incident_id = i.id
       ${where}
       ORDER BY
         ${sort === 'newest'
           ? 'i.created_at DESC'
           : `CASE i.prioridad
                WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2
                WHEN 'MEDIA'   THEN 3 WHEN 'BAJA' THEN 4
                ELSE 5 END,
              i.created_at DESC`
         }
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0
    const incidents = rows.map(({ total_count, ...row }) => row)

    return res.json({
      incidents,
      pagination: {
        total,
        page:  pageNum,
        limit: pageSize,
        pages: Math.ceil(total / pageSize),
      },
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
         i.decision_automatica, i.confianza_decision, i.imagen_auditoria_url,
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
         ar.tiempo_inferencia_ms, ar.created_at AS analizado_at,
         ar.nivel_acumulacion_supervisor, ar.tipo_residuo_supervisor,
         ar.ia_fue_correcta, ar.nota_supervision,
         ar.supervisado_por, ar.supervisado_at,
         NULL::TEXT AS supervisado_por_username,
         jsonb_array_length(ar.detecciones) AS num_detecciones
       FROM incidents.incidents i
       LEFT JOIN operations.zones z       ON z.id = i.zona_id
       LEFT JOIN public.ciudadanos c      ON c.user_id = i.reportado_por
       LEFT JOIN app_auth.users u         ON u.id = i.reportado_por
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar   ON ar.incident_id = i.id
       WHERE i.id = $1`,
      [id],
    )

    if (!rows.length) return res.status(404).json({ error: "Incidente no encontrado." })

    // Historial de estados
    const { rows: historial } = await pool.query(
      `SELECT
         sh.estado_anterior, sh.estado_nuevo, sh.observaciones, sh.motivo_rechazo, sh.created_at,
         COALESCE(op.nombre || ' ' || op.apellido, sh.cambiado_por::TEXT) AS actor,
         NULL::TEXT AS actor_rol
       FROM incidents.status_history sh
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

    // Feedback de IA: consenso y lista de respuestas de operarios/supervisores
    // Permite al supervisor ver si el personal de campo validó la decisión automática.
    const { rows: feedbackRows } = await pool.query(
      `SELECT
         af.id,
         af.es_correcta,
         af.comentario,
         af.created_at,
         af.updated_at,
         af.reportado_por AS reportado_por_id,
         NULL::TEXT AS reportado_por_username,
         NULL::TEXT AS reportado_por_rol
       FROM ai.analysis_feedback af
       JOIN ai.analysis_results ar ON ar.id = af.analysis_result_id
       WHERE ar.incident_id = $1
       ORDER BY af.created_at DESC`,
      [id],
    )

    const totalFeedback    = feedbackRows.length
    const correctos        = feedbackRows.filter((r) => r.es_correcta).length
    const feedbackResumen  = {
      total:             totalFeedback,
      correctos,
      incorrectos:       totalFeedback - correctos,
      consenso_correcto: totalFeedback > 0 ? correctos / totalFeedback >= 0.5 : null,
      detalle:           feedbackRows,
    }

    return res.json({ ...rows[0], historial, asignaciones, feedback_ia: feedbackResumen })
  } catch (err) {
    console.error("[supervisor] getIncidentDetail:", err.message)
    return res.status(500).json({ error: "Error al obtener el detalle del incidente." })
  }
}

// ─── PUT /api/supervisor/incidents/:id/estado ─────────────────────────────────
// Cambia el estado del incidente con validación de transición y trazabilidad.
// Body: { estado: string, observaciones? }
//
// Transiciones disponibles (migración 032):
//   EN_REVISION → PENDIENTE  (supervisor valida el reporte dudoso)
//   EN_REVISION → RECHAZADA  (supervisor rechaza el reporte dudoso)
//   DESCARTADO  → PENDIENTE  (supervisor anula rechazo automático)

const MOTIVOS_RECHAZO_VALIDOS = ["NO_ES_BASURA", "MUY_LEJOS_PEQUENO", "IMAGEN_BORROSA", "DUPLICADO", "OTRO"]

// Valida el body de cambiarEstado. Devuelve un mensaje de error (400) o null si es válido.
function validarCambioEstado({ estado, motivo_rechazo }) {
  if (!estado) return "El campo 'estado' es requerido."
  if (estado === "RECHAZADA" && !motivo_rechazo)
    return "El campo 'motivo_rechazo' es requerido al rechazar."
  if (motivo_rechazo && !MOTIVOS_RECHAZO_VALIDOS.includes(motivo_rechazo))
    return `motivo_rechazo inválido. Valores aceptados: ${MOTIVOS_RECHAZO_VALIDOS.join(", ")}.`
  return null
}

// Actualiza observaciones/motivo_rechazo en la última fila de status_history del incidente.
// No-op si no se proveyó ninguno de los dos campos.
async function actualizarObservacionesHistorial(client, { id, estado, observaciones, motivo_rechazo }) {
  if (!observaciones && !motivo_rechazo) return
  const sets = []
  const vals = []
  let idx = 1
  if (observaciones)  { sets.push(`observaciones = $${idx++}`);  vals.push(observaciones) }
  if (motivo_rechazo) { sets.push(`motivo_rechazo = $${idx++}`); vals.push(motivo_rechazo) }
  vals.push(id, estado)
  await client.query(
    `UPDATE incidents.status_history
     SET ${sets.join(", ")}
     WHERE incident_id = $${idx++} AND estado_nuevo = $${idx++}
       AND created_at = (
         SELECT MAX(created_at) FROM incidents.status_history
         WHERE incident_id = $${idx - 2} AND estado_nuevo = $${idx - 1}
       )`,
    vals,
  )
}

export const cambiarEstado = async (req, res) => {
  const { id }                                          = req.params
  const { estado, observaciones, motivo_rechazo, cierre_lat, cierre_lon } = req.body
  const userId = req.headers["x-user-id"]

  const errEntrada = validarCambioEstado({ estado, motivo_rechazo })
  if (errEntrada) return res.status(400).json({ error: errEntrada })

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Leer estado actual + distancia al punto de cierre si se provee GPS
    const { rows } = await client.query(
      `SELECT estado,
              CASE WHEN $2::double precision IS NOT NULL
                   THEN ST_Distance(
                     ubicacion::geography,
                     ST_SetSRID(ST_MakePoint($3::double precision, $2::double precision), 4326)::geography
                   )
                   ELSE NULL END AS distancia_cierre_m
       FROM incidents.incidents WHERE id = $1 FOR UPDATE`,
      [id, cierre_lat ?? null, cierre_lon ?? null],
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

    // ── Validación de geocerca al cerrar ──────────────────────────────────────
    let distanciaM = null
    if (estado === "RESUELTA") {
      if (cierre_lat == null || cierre_lon == null) {
        await client.query("ROLLBACK")
        return res.status(400).json({
          error: "Se requiere ubicación GPS (cierre_lat, cierre_lon) para marcar el incidente como RESUELTA.",
        })
      }

      distanciaM = Number.parseFloat(rows[0].distancia_cierre_m ?? 0)

      const { rows: cfg } = await client.query(
        "SELECT valor FROM operations.config WHERE clave = 'geofence_tolerancia_m'"
      )
      const tolerancia = Number.parseFloat(cfg[0]?.valor ?? "10")

      if (distanciaM > tolerancia) {
        await client.query("ROLLBACK")
        return res.status(422).json({
          error: `Debes estar a menos de ${tolerancia} m del punto reportado para cerrarlo. Distancia actual: ${Math.round(distanciaM)} m.`,
          distancia_m:  Math.round(distanciaM),
          tolerancia_m: tolerancia,
        })
      }
    }

    // Inyectar actor para que el trigger fn_log_status_change use el UUID del supervisor.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId])

    // El trigger fn_log_status_change crea la fila en status_history durante este UPDATE.
    await client.query(
      `UPDATE incidents.incidents
       SET estado              = $1,
           updated_at          = NOW(),
           cierre_lat          = COALESCE($3::double precision,  cierre_lat),
           cierre_lon          = COALESCE($4::double precision,  cierre_lon),
           cierre_distancia_m  = COALESCE($5::numeric,           cierre_distancia_m)
       WHERE id = $2`,
      [estado, id, cierre_lat ?? null, cierre_lon ?? null,
       distanciaM != null ? distanciaM.toFixed(2) : null],
    )

    await actualizarObservacionesHistorial(client, { id, estado, observaciones, motivo_rechazo })

    await client.query("COMMIT")

    return res.json({
      message:     `Incidente actualizado a ${estado}.`,
      incident_id: id,
      estado,
      ...(distanciaM != null && { distancia_cierre_m: Math.round(distanciaM) }),
    })
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
      `SELECT estado, created_at FROM incidents.incidents WHERE id = $1`, [id],
    )
    if (!inc.length) return res.status(404).json({ error: "Incidente no encontrado." })
    if (!["PENDIENTE", "EN_ATENCION"].includes(inc[0].estado)) {
      return res.status(422).json({
        error: `Solo se pueden asignar incidentes en estado PENDIENTE o EN_ATENCION. Estado actual: ${inc[0].estado}.`,
      })
    }

    // Verificar que el operario exista
    const { rows: op } = await pool.query(
      `SELECT o.user_id FROM operations.operarios o WHERE o.user_id = $1`,
      [operario_id],
    )
    if (!op.length) return res.status(404).json({ error: "Operario no encontrado." })

    const { rows } = await pool.query(
      `INSERT INTO incidents.assignments
         (incident_id, incident_created_at, operario_id, asignado_por, fecha_esperada, notas)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT uq_assignment_activa DO UPDATE
         SET notas = EXCLUDED.notas, fecha_esperada = EXCLUDED.fecha_esperada,
             updated_at = NOW()
       RETURNING id, created_at`,
      [id, inc[0].created_at, operario_id, supervisorId, fecha_esperada || null, notas || null],
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

// ─── PUT /api/supervisor/incidents/:id/revision-ia ───────────────────────────
//
// Registra el veredicto supervisado del análisis IA de un incidente.
// Operación idempotente: puede llamarse varias veces para actualizar la revisión.
//
// Body:
//   es_correcta_ia               boolean  — ¿la decisión automática fue correcta?
//   comentario                   string?  — nota libre de auditoría
//   nivel_acumulacion_supervisor string?  — severidad real (BAJO|MEDIO|ALTO|CRITICO)
//   tipo_residuo_supervisor      string?  — tipo real (DOMESTICO|ORGANICO|...|OTRO)
//
// Efectos:
//   1. Upsert en ai.analysis_feedback (pipeline de drift + consenso de campo)
//   2. UPDATE en ai.analysis_results: columnas de corrección supervisora (migración 033)
//      Los valores ML originales NO se modifican — las correcciones son aditivas.
//
// Auditoría: supervisado_por + supervisado_at quedan registrados en analysis_results.
// El historial completo de feedback se consulta vía GET /supervisor/incidents/:id.

const VALID_NIVELES = new Set(['BAJO', 'MEDIO', 'ALTO', 'CRITICO'])
const VALID_TIPOS   = new Set(['DOMESTICO', 'ORGANICO', 'RECICLABLE', 'ESCOMBROS', 'PELIGROSO', 'MIXTO', 'OTRO'])

export const revisionIA = async (req, res) => {
  const { id } = req.params
  const {
    es_correcta_ia,
    comentario = null,
    nivel_acumulacion_supervisor = null,
    tipo_residuo_supervisor      = null,
  } = req.body
  const userId = req.headers["x-user-id"]

  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  if (es_correcta_ia === undefined || es_correcta_ia === null) {
    return res.status(400).json({ error: "El campo 'es_correcta_ia' (boolean) es requerido." })
  }
  if (typeof es_correcta_ia !== "boolean") {
    return res.status(400).json({ error: "El campo 'es_correcta_ia' debe ser true o false." })
  }
  if (nivel_acumulacion_supervisor && !VALID_NIVELES.has(nivel_acumulacion_supervisor)) {
    return res.status(400).json({
      error: `nivel_acumulacion_supervisor inválido: '${nivel_acumulacion_supervisor}'. Valores permitidos: ${[...VALID_NIVELES].join(', ')}.`,
    })
  }
  if (tipo_residuo_supervisor && !VALID_TIPOS.has(tipo_residuo_supervisor)) {
    return res.status(400).json({
      error: `tipo_residuo_supervisor inválido: '${tipo_residuo_supervisor}'. Valores permitidos: ${[...VALID_TIPOS].join(', ')}.`,
    })
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Verificar que el incidente exista
    const { rows: incRows } = await client.query(
      `SELECT id FROM incidents.incidents WHERE id = $1`,
      [id],
    )
    if (!incRows.length) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Incidente no encontrado." })
    }

    // Obtener el analysis_result del incidente (puede no existir en casos FALLIDO sin ML)
    const { rows: arRows } = await client.query(
      `SELECT id FROM ai.analysis_results WHERE incident_id = $1`,
      [id],
    )

    let analysisResultId = null

    if (arRows.length) {
      analysisResultId = arRows[0].id

      // 1. Upsert en ai.analysis_feedback (pipeline de drift y consenso de campo)
      await client.query(
        `INSERT INTO ai.analysis_feedback
           (analysis_result_id, es_correcta, comentario, reportado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_feedback_per_user
         DO UPDATE SET
           es_correcta = EXCLUDED.es_correcta,
           comentario  = EXCLUDED.comentario,
           updated_at  = NOW()`,
        [analysisResultId, es_correcta_ia, comentario, userId],
      )

      // 2. Actualizar correcciones estructuradas en analysis_results (migración 033)
      //    CASE WHEN ... IS NOT NULL THEN ... permite pasar NULL sin romper el cast a enum.
      await client.query(
        `UPDATE ai.analysis_results
         SET ia_fue_correcta              = $1,
             nota_supervision             = $2,
             nivel_acumulacion_supervisor = CASE WHEN $3::text IS NOT NULL
                                                 THEN $3::ai.accumulation_level END,
             tipo_residuo_supervisor      = CASE WHEN $4::text IS NOT NULL
                                                 THEN $4::ai.waste_type END,
             supervisado_por              = $5,
             supervisado_at               = NOW()
         WHERE id = $6`,
        [
          es_correcta_ia,
          comentario,
          nivel_acumulacion_supervisor,
          tipo_residuo_supervisor,
          userId,
          analysisResultId,
        ],
      )
    }
    // Si no hay analysis_result (FALLIDO sin ML), la revisión queda registrada
    // en ai.analysis_feedback si se crea ese registro más adelante, o solo queda
    // como nota en los logs. La operación es igualmente exitosa.

    await client.query("COMMIT")

    return res.json({
      message:                      "Revisión IA registrada correctamente.",
      incident_id:                  id,
      analysis_result_id:           analysisResultId,
      es_correcta_ia,
      nivel_acumulacion_supervisor: nivel_acumulacion_supervisor ?? null,
      tipo_residuo_supervisor:      tipo_residuo_supervisor      ?? null,
    })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[supervisor] revisionIA:", err.message)
    return res.status(500).json({ error: "Error al registrar la revisión IA." })
  } finally {
    client.release()
  }
}

// ─── GET /api/supervisor/zonas/estadisticas ───────────────────────────────────
// Estadísticas por zona para los últimos 30 días.
// Incluye conteos para todos los estados del ciclo de vida (migración 032).

export const estadisticasZonas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         z.id, z.codigo, z.nombre,
         COUNT(i.id)                                              AS total,
         COUNT(*) FILTER (WHERE i.estado = 'PENDIENTE')          AS pendientes,
         COUNT(*) FILTER (WHERE i.estado = 'EN_ATENCION')        AS en_atencion,
         COUNT(*) FILTER (WHERE i.estado = 'RESUELTA')           AS resueltas,
         COUNT(*) FILTER (WHERE i.estado = 'RECHAZADA')          AS rechazadas,
         COUNT(*) FILTER (WHERE i.estado = 'FALLIDO')            AS fallidas,
         COUNT(*) FILTER (WHERE i.estado = 'EN_REVISION')        AS en_revision,
         COUNT(*) FILTER (WHERE i.estado = 'DESCARTADO')         AS descartadas,
         COUNT(*) FILTER (WHERE i.prioridad = 'CRITICA')         AS criticas,
         ROUND(AVG(ar.volumen_estimado_m3)::numeric, 2)          AS volumen_promedio_m3,
         ROUND(AVG(ar.confianza)::numeric, 3)                    AS confianza_promedio,
         op.nombre || ' ' || op.apellido                         AS supervisor_nombre
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
       LEFT JOIN operations.zones z ON z.id = o.zona_id
       LEFT JOIN incidents.assignments a ON a.operario_id = o.user_id
       GROUP BY o.user_id, o.nombre, o.apellido, o.cedula, o.cargo, o.telefono, z.nombre
       ORDER BY o.nombre`,
    )
    return res.json({ operarios: rows })
  } catch (err) {
    console.error("[supervisor] listOperarios:", err.message)
    return res.status(500).json({ error: "Error al obtener operarios." })
  }
}

// ─── GET /api/supervisor/zonas/mapa ──────────────────────────────────────────
// GeoJSON de zonas activas + markers de incidentes activos para mapa en tiempo real.
// Query params:
//   page     (default 1)
//   limit    (default 100, máx 500)
//   sw_lat, sw_lon, ne_lat, ne_lon  — rectángulo geográfico del viewport del mapa
//     Si se proporcionan los 4 valores se filtra con ST_MakeEnvelope y solo se
//     devuelven incidentes dentro del viewport, reduciendo el payload al mínimo útil.
//
// Estados "activos" en el mapa: PENDIENTE, EN_ATENCION, EN_REVISION.
// FALLIDO, DESCARTADO, RESUELTA, RECHAZADA no aparecen como markers activos
// (no requieren atención operativa inmediata).

export const mapaZonas = async (req, res) => {
  const pageNum  = Math.max(1, Number(req.query.page  ?? 1))
  const pageSize = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)))
  const offset   = (pageNum - 1) * pageSize

  const { sw_lat, sw_lon, ne_lat, ne_lon } = req.query
  const hasBounds = [sw_lat, sw_lon, ne_lat, ne_lon].every(v => v !== undefined && v !== "")

  try {
    const client = await pool.connect()
    try {

      // A. Zonas como GeoJSON con conteos en tiempo real
      const { rows: zonas } = await client.query(`
        SELECT
          z.id,
          z.codigo,
          z.nombre,
          NULL::TEXT                 AS supervisor_nombre,
          -- Simplificar geometría para el mapa: reduce vértices sin perder forma
          -- 0.001° ≈ 100m — suficiente para visualización, elimina fragmentos diminutos
          ST_AsGeoJSON(
            ST_SimplifyPreserveTopology(z.geom, 0.001)
          )::json AS geometry,
          COUNT(i.id) FILTER (
            WHERE i.estado IN ('PENDIENTE', 'EN_ATENCION', 'EN_REVISION')
          ) AS incidentes_activos,
          COUNT(i.id) FILTER (
            WHERE i.estado = 'PENDIENTE'
          ) AS pendientes,
          COUNT(i.id) FILTER (
            WHERE i.estado = 'EN_ATENCION'
          ) AS en_atencion,
          COUNT(i.id) FILTER (
            WHERE i.estado = 'EN_REVISION'
          ) AS en_revision,
          COUNT(i.id) FILTER (
            WHERE i.prioridad = 'CRITICA'
              AND i.estado IN ('PENDIENTE', 'EN_ATENCION', 'EN_REVISION')
          ) AS criticas,
          COUNT(i.id) FILTER (
            WHERE i.created_at >= NOW() - INTERVAL '24 hours'
          ) AS ultimas_24h
        FROM operations.zones z
        LEFT JOIN incidents.incidents i ON i.zona_id = z.id
        WHERE z.activa = TRUE
        GROUP BY z.id, z.codigo, z.nombre
        ORDER BY z.nombre
      `)

      // B. Incidentes activos para markers (excluye terminales y en-proceso-interno)
      //    EN_REVISION se incluye porque requiere atención del supervisor.
      let incidentesQuery
      let incidentesParams

      if (hasBounds) {
        // ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid) — SW=(lon,lat), NE=(lon,lat)
        incidentesQuery = `
          SELECT
            i.id,
            i.estado,
            i.prioridad,
            i.descripcion,
            i.zona_id,
            i.created_at,
            ST_Y(i.ubicacion::geometry) AS latitud,
            ST_X(i.ubicacion::geometry) AS longitud,
            z.nombre AS zona_nombre,
            COUNT(*) OVER() AS total_count
          FROM incidents.incidents i
          LEFT JOIN operations.zones z ON z.id = i.zona_id
          WHERE i.estado IN ('PENDIENTE', 'EN_ATENCION', 'EN_REVISION')
            AND ST_Within(
              i.ubicacion::geometry,
              ST_MakeEnvelope($1::float, $2::float, $3::float, $4::float, 4326)
            )
          ORDER BY i.created_at DESC
          LIMIT $5 OFFSET $6`
        // ST_MakeEnvelope(xmin=sw_lon, ymin=sw_lat, xmax=ne_lon, ymax=ne_lat)
        incidentesParams = [Number(sw_lon), Number(sw_lat), Number(ne_lon), Number(ne_lat), pageSize, offset]
      } else {
        incidentesQuery = `
          SELECT
            i.id,
            i.estado,
            i.prioridad,
            i.descripcion,
            i.zona_id,
            i.created_at,
            ST_Y(i.ubicacion::geometry) AS latitud,
            ST_X(i.ubicacion::geometry) AS longitud,
            z.nombre AS zona_nombre,
            COUNT(*) OVER() AS total_count
          FROM incidents.incidents i
          LEFT JOIN operations.zones z ON z.id = i.zona_id
          WHERE i.estado IN ('PENDIENTE', 'EN_ATENCION', 'EN_REVISION')
          ORDER BY i.created_at DESC
          LIMIT $1 OFFSET $2`
        incidentesParams = [pageSize, offset]
      }

      const { rows: incidentesRaw } = await client.query(incidentesQuery, incidentesParams)

      const total      = incidentesRaw.length > 0 ? Number(incidentesRaw[0].total_count) : 0
      const incidentes = incidentesRaw.map(({ total_count, ...row }) => row)

      // C. Calcular nivel de actividad por zona
      const calcNivel = (z) => {
        if (Number(z.criticas) > 0)            return 'critico'
        if (Number(z.incidentes_activos) > 10) return 'alto'
        if (Number(z.incidentes_activos) > 3)  return 'medio'
        if (Number(z.incidentes_activos) > 0)  return 'bajo'
        return 'sin_actividad'
      }

      return res.status(200).json({
        zonas: {
          type: 'FeatureCollection',
          features: zonas.map(z => ({
            type: 'Feature',
            geometry: z.geometry,
            properties: {
              id:                 z.id,
              codigo:             z.codigo,
              nombre:             z.nombre,
              supervisor:         z.supervisor_nombre,
              incidentes_activos: Number(z.incidentes_activos),
              pendientes:         Number(z.pendientes),
              en_atencion:        Number(z.en_atencion),
              en_revision:        Number(z.en_revision),
              criticas:           Number(z.criticas),
              ultimas_24h:        Number(z.ultimas_24h),
              nivel:              calcNivel(z),
            },
          })),
        },
        incidentes: incidentes.map(i => ({
          id:          i.id,
          estado:      i.estado,
          prioridad:   i.prioridad,
          descripcion: i.descripcion,
          zona_id:     i.zona_id,
          zona_nombre: i.zona_nombre,
          created_at:  i.created_at,
          latitud:     Number(i.latitud),
          longitud:    Number(i.longitud),
        })),
        pagination: {
          total,
          page:  pageNum,
          limit: pageSize,
          pages: Math.ceil(total / pageSize),
        },
        generado_at: new Date().toISOString(),
      })

    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[mapaZonas]', err)
    return res.status(500).json({ error: 'Error al obtener datos del mapa' })
  }
}
