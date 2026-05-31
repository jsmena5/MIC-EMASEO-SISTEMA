import { pool } from "../db.js"

// ─── GET /api/supervisor/ia/imagenes ─────────────────────────────────────────
// Lista paginada de imágenes con sus resultados ML y etiqueta de auditoría.
// Query params: page, limit, etiqueta, ia_correcta

export const listarImagenes = async (req, res) => {
  const page      = Math.max(1, parseInt(req.query.page  ?? "1"))
  const limit     = Math.min(50, Math.max(1, parseInt(req.query.limit ?? "20")))
  const offset    = (page - 1) * limit
  const etiqueta  = req.query.etiqueta   ?? null   // PENDIENTE | VALIDA_ENTRENAMIENTO | DUDOSA | EXCLUIR
  const iaCorrecta = req.query.ia_correcta ?? null  // "true" | "false"

  const conditions = ["i.imagen_auditoria_url IS NOT NULL"]
  const params     = []
  let   idx        = 1

  if (etiqueta === "PENDIENTE") {
    conditions.push("(ia.etiqueta = 'PENDIENTE' OR ia.id IS NULL)")
  } else if (etiqueta) {
    conditions.push(`ia.etiqueta = $${idx++}`)
    params.push(etiqueta)
  }

  if (iaCorrecta === "true")  { conditions.push(`ar.ia_fue_correcta = TRUE`) }
  if (iaCorrecta === "false") { conditions.push(`ar.ia_fue_correcta = FALSE`) }

  const WHERE = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

  try {
    const countQ = await pool.query(
      `SELECT COUNT(*) AS total
       FROM incidents.incidents i
       JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN ai.image_audit  ia ON ia.incident_id = i.id
       ${WHERE}`,
      params,
    )
    const total = parseInt(countQ.rows[0].total)

    const dataQ = await pool.query(
      `SELECT
         i.id              AS incident_id,
         i.estado,
         i.imagen_auditoria_url AS image_url,
         i.created_at,
         ar.nivel_acumulacion,
         ar.tipo_residuo,
         ar.confianza,
         ar.ia_fue_correcta,
         ar.nivel_acumulacion_supervisor,
         ar.tipo_residuo_supervisor,
         COALESCE(ia.etiqueta, 'PENDIENTE') AS etiqueta,
         ia.comentario,
         ia.etiquetado_at,
         u.email AS etiquetado_por_email
       FROM incidents.incidents i
       JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN ai.image_audit  ia ON ia.incident_id = i.id
       LEFT JOIN app_auth.users   u ON u.id = ia.etiquetado_por
       ${WHERE}
       ORDER BY i.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    )

    return res.json({
      imagenes:   dataQ.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error("[ia] listarImagenes:", err.message)
    return res.status(500).json({ error: "Error al listar imágenes" })
  }
}

// ─── PUT /api/supervisor/ia/imagenes/:incident_id/etiqueta ────────────────────
// Asigna o actualiza la etiqueta de auditoría de una imagen.

export const etiquetarImagen = async (req, res) => {
  const { incident_id }     = req.params
  const { etiqueta, comentario } = req.body
  const userId              = req.headers["x-user-id"]

  const VALIDAS = ["PENDIENTE","VALIDA_ENTRENAMIENTO","DUDOSA","EXCLUIR"]
  if (!VALIDAS.includes(etiqueta)) {
    return res.status(400).json({ error: `Etiqueta inválida. Valores aceptados: ${VALIDAS.join(", ")}` })
  }

  try {
    await pool.query(
      `INSERT INTO ai.image_audit (incident_id, etiqueta, comentario, etiquetado_por, etiquetado_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (incident_id) DO UPDATE SET
         etiqueta       = EXCLUDED.etiqueta,
         comentario     = EXCLUDED.comentario,
         etiquetado_por = EXCLUDED.etiquetado_por,
         etiquetado_at  = NOW()`,
      [incident_id, etiqueta, comentario ?? null, userId],
    )
    return res.json({ incident_id, etiqueta })
  } catch (err) {
    console.error("[ia] etiquetarImagen:", err.message)
    return res.status(500).json({ error: "Error al etiquetar imagen" })
  }
}


// ─── GET /api/supervisor/ia/estadisticas ──────────────────────────────────────
// Métricas de calidad del modelo IA para el dashboard de administrador.

export const iaEstadisticas = async (_req, res) => {
  try {
    const { rows: [totales] } = await pool.query(`
      SELECT
        COUNT(*)                                                     AS total_analizados,
        COUNT(*) FILTER (WHERE supervisado_por IS NOT NULL)          AS total_supervisados,
        COUNT(*) FILTER (WHERE ia_fue_correcta = TRUE)               AS correctos,
        COUNT(*) FILTER (WHERE ia_fue_correcta = FALSE)              AS incorrectos,
        COUNT(*) FILTER (WHERE supervisado_por IS NULL
                           AND incident_id IN (
                             SELECT id FROM incidents.incidents
                             WHERE estado IN ('PENDIENTE','EN_ATENCION','EN_REVISION')
                           ))                                        AS pendientes_revision,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ia_fue_correcta = TRUE)
          / NULLIF(COUNT(*) FILTER (WHERE ia_fue_correcta IS NOT NULL), 0),
          1
        )                                                            AS precision_pct
      FROM ai.analysis_results
    `)

    const { rows: erroresTipo } = await pool.query(`
      SELECT
        tipo_residuo          AS tipo_ml,
        tipo_residuo_supervisor AS tipo_real,
        COUNT(*)              AS total
      FROM ai.analysis_results
      WHERE ia_fue_correcta = FALSE AND tipo_residuo IS NOT NULL
      GROUP BY tipo_residuo, tipo_residuo_supervisor
      ORDER BY total DESC
      LIMIT 20
    `)

    const { rows: erroresNivel } = await pool.query(`
      SELECT
        nivel_acumulacion            AS nivel_ml,
        nivel_acumulacion_supervisor AS nivel_real,
        COUNT(*)                     AS total
      FROM ai.analysis_results
      WHERE ia_fue_correcta = FALSE AND nivel_acumulacion IS NOT NULL
      GROUP BY nivel_acumulacion, nivel_acumulacion_supervisor
      ORDER BY total DESC
    `)

    const { rows: ultimasCorrecciones } = await pool.query(`
      SELECT
        ar.incident_id,
        ar.nivel_acumulacion          AS nivel_ml,
        ar.tipo_residuo               AS tipo_ml,
        ar.confianza,
        ar.nivel_acumulacion_supervisor AS nivel_real,
        ar.tipo_residuo_supervisor      AS tipo_real,
        ar.nota_supervision,
        ar.supervisado_at,
        u.email                         AS supervisor_email,
        i.imagen_auditoria_url          AS image_url
      FROM ai.analysis_results ar
      JOIN incidents.incidents i  ON i.id  = ar.incident_id
      JOIN app_auth.users u       ON u.id  = ar.supervisado_por
      WHERE ar.ia_fue_correcta = FALSE
      ORDER BY ar.supervisado_at DESC
      LIMIT 25
    `)

    return res.json({
      totales,
      errores_por_tipo:  erroresTipo,
      errores_por_nivel: erroresNivel,
      ultimas_correcciones: ultimasCorrecciones,
    })
  } catch (err) {
    console.error("[ia] iaEstadisticas:", err.message)
    return res.status(500).json({ error: "Error al obtener estadísticas IA" })
  }
}

// ─── GET /api/supervisor/ia/dataset ──────────────────────────────────────────
// Exporta el dataset de correcciones supervisadas para reentrenamiento del modelo.
// Devuelve los análisis donde el supervisor firmó un veredicto (correcta o no).

export const iaDataset = async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ar.incident_id,
        i.imagen_auditoria_url                AS image_url,
        ar.detecciones                        AS detecciones_ml,
        ar.nivel_acumulacion                  AS nivel_ml,
        ar.tipo_residuo                       AS tipo_ml,
        ar.confianza,
        ar.coverage_ratio,
        ar.volumen_estimado_m3,
        ar.ia_fue_correcta,
        ar.nivel_acumulacion_supervisor       AS nivel_correcto,
        ar.tipo_residuo_supervisor            AS tipo_correcto,
        ar.nota_supervision,
        ar.supervisado_at,
        i.created_at                          AS incidente_created_at
      FROM ai.analysis_results ar
      JOIN incidents.incidents i ON i.id = ar.incident_id
      WHERE ar.supervisado_por IS NOT NULL
      ORDER BY ar.supervisado_at DESC
    `)

    res.setHeader("Content-Disposition", `attachment; filename="emaseo_ia_dataset_${new Date().toISOString().slice(0,10)}.json"`)
    res.setHeader("Content-Type", "application/json")
    return res.json({ total: rows.length, generado_at: new Date().toISOString(), registros: rows })
  } catch (err) {
    console.error("[ia] iaDataset:", err.message)
    return res.status(500).json({ error: "Error al exportar dataset" })
  }
}
