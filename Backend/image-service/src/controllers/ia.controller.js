import { pool } from "../db.js"

// ─── GET /api/supervisor/ia/imagenes ─────────────────────────────────────────
// Lista paginada de imágenes con sus resultados ML y etiqueta de auditoría.
// Query params: page, limit, etiqueta, ia_correcta

export const listarImagenes = async (req, res) => {
  const page      = Math.max(1, Number.parseInt(req.query.page  ?? "1"))
  const limit     = Math.min(50, Math.max(1, Number.parseInt(req.query.limit ?? "20")))
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
    const total = Number.parseInt(countQ.rows[0].total)

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
         ia.etiquetado_por AS etiquetado_por_id
       FROM incidents.incidents i
       JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN ai.image_audit  ia ON ia.incident_id = i.id
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
        ar.nivel_acumulacion            AS nivel_ml,
        ar.tipo_residuo                 AS tipo_ml,
        ar.confianza,
        ar.nivel_acumulacion_supervisor AS nivel_real,
        ar.tipo_residuo_supervisor      AS tipo_real,
        ar.nota_supervision,
        ar.supervisado_at,
        ar.supervisado_por              AS supervisor_id,
        i.imagen_auditoria_url          AS image_url
      FROM ai.analysis_results ar
      JOIN incidents.incidents i ON i.id = ar.incident_id
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
        i.imagen_auditoria_url                          AS image_url,
        ar.detecciones                                  AS detecciones_ml,
        ar.nivel_acumulacion                            AS nivel_ml,
        ar.tipo_residuo                                 AS tipo_ml,
        ar.confianza,
        ar.ia_fue_correcta,
        ar.nivel_acumulacion_supervisor                 AS nivel_correcto,
        ar.tipo_residuo_supervisor                      AS tipo_correcto,
        ar.nota_supervision,
        ar.supervisado_at,
        i.created_at                                    AS incidente_created_at
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

// ─── GET /api/supervisor/ia/hard-examples ────────────────────────────────────
// Exporta imágenes de "hard examples" para active learning.
//
// Vía 2 de la estrategia de reentrenamiento: en vez de etiquetar las 5k imágenes,
// se anotan solo los casos donde la IA se equivocó (ia_fue_correcta=false) o es
// ambigua (confianza baja o ia_fue_correcta IS NULL + EN_REVISION).
// Esos son los de mayor valor para reentrenar RT-DETR con bounding boxes.
//
// También incluye rechazos manuales por motivo: "NO_ES_BASURA" → falsos positivos
// del detector; "MUY_LEJOS_PEQUENO" → casos donde el gate de cobertura era correcto.
//
// Query params:
//   limit      (default 200, max 1000)
//   min_confianza (default 0.0) — filtrar por confianza máxima del modelo
//   solo_incorrectos (true/false, default false) — solo ia_fue_correcta=false

export const hardExamples = async (req, res) => {
  const limit           = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit ?? "200")))
  const minConfianza    = Number.parseFloat(req.query.min_confianza ?? "0")
  const soloIncorrectos = req.query.solo_incorrectos === "true"
  const confianzaUmbral = minConfianza > 0 ? minConfianza : 1.0

  try {
    const { rows } = await pool.query(
      `SELECT
         i.id              AS incident_id,
         i.estado,
         i.imagen_auditoria_url AS image_url,
         i.created_at,
         ar.nivel_acumulacion                            AS nivel_ia,
         ar.tipo_residuo                                 AS tipo_ia,
         ar.confianza,
         ar.decision_automatica,
         ar.ia_fue_correcta,
         ar.nivel_acumulacion_supervisor                 AS nivel_correcto,
         ar.tipo_residuo_supervisor                      AS tipo_correcto,
         ar.nota_supervision,
         -- Motivo del rechazo manual más reciente (si existe)
         sh.motivo_rechazo,
         sh.observaciones AS observaciones_rechazo,
         -- Señal de prioridad para anotación: cuánto se aleja el nivel supervisado del IA
         CASE
           WHEN ar.ia_fue_correcta = FALSE THEN 'IA_INCORRECTA'
           WHEN i.estado = 'EN_REVISION' AND ar.ia_fue_correcta IS NULL THEN 'AMBIGUO'
           WHEN sh.motivo_rechazo = 'NO_ES_BASURA' THEN 'FALSO_POSITIVO'
           WHEN sh.motivo_rechazo = 'MUY_LEJOS_PEQUENO' THEN 'COBERTURA_BAJA'
           ELSE 'BAJA_CONFIANZA'
         END AS prioridad_anotacion
       FROM incidents.incidents i
       JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN LATERAL (
         SELECT motivo_rechazo, observaciones
         FROM incidents.status_history
         WHERE incident_id = i.id AND estado_nuevo = 'RECHAZADA'
         ORDER BY created_at DESC LIMIT 1
       ) sh ON TRUE
       WHERE i.imagen_auditoria_url IS NOT NULL
         AND ar.confianza <= $1
         AND (
           $2 = FALSE
           OR ar.ia_fue_correcta = FALSE
           OR (i.estado = 'EN_REVISION' AND ar.ia_fue_correcta IS NULL)
           OR sh.motivo_rechazo IN ('NO_ES_BASURA', 'MUY_LEJOS_PEQUENO')
         )
       ORDER BY
         CASE WHEN ar.ia_fue_correcta = FALSE THEN 0
              WHEN sh.motivo_rechazo IS NOT NULL THEN 1
              ELSE 2 END,
         ar.confianza ASC
       LIMIT $3`,
      [soloIncorrectos ? 1.0 : confianzaUmbral, soloIncorrectos, limit],
    )

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="emaseo_hard_examples_${new Date().toISOString().slice(0,10)}.json"`,
    )
    res.setHeader("Content-Type", "application/json")
    return res.json({
      total:         rows.length,
      generado_at:   new Date().toISOString(),
      instrucciones: "Importar en Label Studio / Roboflow / CVAT. Anotar bounding boxes para reentrenar RT-DETR-L. Priorizar prioridad_anotacion=IA_INCORRECTA y FALSO_POSITIVO.",
      hard_examples: rows,
    })
  } catch (err) {
    console.error("[ia] hardExamples:", err.message)
    return res.status(500).json({ error: "Error al exportar hard examples" })
  }
}
