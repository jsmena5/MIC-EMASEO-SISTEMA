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
       LEFT JOIN app_auth.users sup ON sup.id = a.asignado_por
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

// ─── GET /api/operario/asignaciones/:id ──────────────────────────────────────
// Detalle completo de una asignación específica del operario.

export const getAsignacionDetalle = async (req, res) => {
  const { id } = req.params
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
         z.codigo      AS zona_codigo,
         ii.image_url,
         ar.nivel_acumulacion, ar.tipo_residuo, ar.volumen_estimado_m3,
         ar.confianza,
         sup.nombre || ' ' || sup.apellido AS asignado_por_nombre
       FROM incidents.assignments a
       JOIN incidents.incidents i        ON i.id = a.incident_id
       LEFT JOIN operations.zones z      ON z.id = i.zona_id
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar  ON ar.incident_id = i.id
       LEFT JOIN app_auth.users sup ON sup.id = a.asignado_por
       WHERE a.id = $1 AND a.operario_id = $2 AND a.completada = FALSE`,
      [id, userId],
    )

    if (!rows.length) {
      return res.status(404).json({ error: "Asignación no encontrada o ya completada." })
    }

    return res.json(rows[0])
  } catch (err) {
    console.error("[operario] getAsignacionDetalle:", err.message)
    return res.status(500).json({ error: "Error al obtener el detalle de la asignación." })
  }
}

// ─── PUT /api/operario/asignaciones/:id/completar ────────────────────────────
// El operario resuelve la asignación en campo.
//
// Body: { cierre_lat, cierre_lon, foto_cierre_url? }
//
// Valida geocerca contra `geofence_tolerancia_m` de operations.config.
// Actualiza cierre_lat/lon/foto_url en incidents.incidents.
// Marca assignments.completada = TRUE.
// Cambia el incidente a RESUELTA → trigger notifica al ciudadano.

export const completarAsignacion = async (req, res) => {
  const { id }   = req.params
  const userId   = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  const { cierre_lat, cierre_lon, foto_cierre_url } = req.body

  if (cierre_lat == null || cierre_lon == null) {
    return res.status(400).json({
      error: "Se requiere la ubicación GPS (cierre_lat, cierre_lon) para resolver el caso.",
    })
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Verificar que la asignación pertenezca al operario y esté activa.
    // Calcular distancia desde la posición del operario hasta el incidente.
    const { rows } = await client.query(
      `SELECT
         a.id, a.incident_id, i.estado,
         ST_Distance(
           i.ubicacion::geography,
           ST_SetSRID(ST_MakePoint($3::double precision, $2::double precision), 4326)::geography
         ) AS distancia_cierre_m
       FROM incidents.assignments a
       JOIN incidents.incidents i ON i.id = a.incident_id
       WHERE a.id = $1 AND a.operario_id = $4 AND a.completada = FALSE
       FOR UPDATE OF a`,
      [id, cierre_lat, cierre_lon, userId],
    )

    if (!rows.length) {
      await client.query("ROLLBACK")
      return res.status(404).json({
        error: "Asignación no encontrada, ya completada o no te pertenece.",
      })
    }

    const { incident_id, estado, distancia_cierre_m } = rows[0]
    const distanciaM = Number.parseFloat(distancia_cierre_m ?? 0)

    if (estado === "RESUELTA") {
      await client.query("ROLLBACK")
      return res.status(422).json({ error: "El incidente ya está marcado como RESUELTA." })
    }

    // Leer tolerancia de geocerca configurada por el administrador
    const { rows: cfg } = await client.query(
      "SELECT valor FROM operations.config WHERE clave = 'geofence_tolerancia_m'",
    )
    const tolerancia = Number.parseFloat(cfg[0]?.valor ?? "10")

    if (distanciaM > tolerancia) {
      await client.query("ROLLBACK")
      return res.status(422).json({
        error: `Debes estar a menos de ${tolerancia} m del punto reportado para resolver el caso. Distancia actual: ${Math.round(distanciaM)} m.`,
        distancia_m:  Math.round(distanciaM),
        tolerancia_m: tolerancia,
      })
    }

    // Inyectar actor para que fn_log_status_change registre al operario
    await client.query("SELECT set_config($1, $2, true)", ["app.current_user_id", userId])

    // Actualizar la posición de cierre y foto en el incidente
    await client.query(
      `UPDATE incidents.incidents
       SET estado              = 'RESUELTA',
           cierre_lat          = $2,
           cierre_lon          = $3,
           cierre_foto_url     = $4,
           cierre_distancia_m  = $5,
           updated_at          = NOW()
       WHERE id = $1`,
      [incident_id, cierre_lat, cierre_lon, foto_cierre_url ?? null, distanciaM.toFixed(2)],
    )

    // Marcar la asignación como completada
    await client.query(
      `UPDATE incidents.assignments
       SET completada = TRUE, completada_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    )

    await client.query("COMMIT")

    return res.json({
      message:          "Caso resuelto correctamente. El ciudadano será notificado.",
      asignacion_id:    id,
      incident_id,
      distancia_cierre_m: Math.round(distanciaM),
    })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[operario] completarAsignacion:", err.message)
    return res.status(500).json({ error: "Error al completar la asignación." })
  } finally {
    client.release()
  }
}

// ─── PUT /api/operario/asignaciones/:id/no-atendible ─────────────────────────
// El operario indica que no puede atender el caso (obstáculo, acceso denegado, etc.).
// Devuelve el incidente a VALIDO para que el supervisor reasigne.
// Body: { motivo }

export const noAtendible = async (req, res) => {
  const { id }   = req.params
  const userId   = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  const { motivo } = req.body
  if (!motivo?.trim()) {
    return res.status(400).json({ error: "El campo 'motivo' es obligatorio." })
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

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
      return res.status(404).json({ error: "Asignación no encontrada o ya completada." })
    }

    const { incident_id } = rows[0]

    // Cancelar la asignación activa
    await client.query(
      `UPDATE incidents.assignments
       SET completada = TRUE, completada_at = NOW(),
           notas = COALESCE(notas || E'\n', '') || 'NO ATENDIBLE: ' || $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, motivo.trim()],
    )

    // Regresar el incidente a VALIDO para reasignación
    await client.query("SELECT set_config($1, $2, true)", ["app.current_user_id", userId])
    await client.query(
      `UPDATE incidents.incidents
       SET estado = 'VALIDO', updated_at = NOW()
       WHERE id = $1`,
      [incident_id],
    )

    await client.query("COMMIT")

    return res.json({
      message:       "Caso devuelto al supervisor para reasignación.",
      asignacion_id: id,
      incident_id,
    })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[operario] noAtendible:", err.message)
    return res.status(500).json({ error: "Error al marcar el caso como no atendible." })
  } finally {
    client.release()
  }
}
