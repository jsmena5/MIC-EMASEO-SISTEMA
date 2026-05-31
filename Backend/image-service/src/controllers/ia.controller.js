import { pool } from "../db.js"

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
