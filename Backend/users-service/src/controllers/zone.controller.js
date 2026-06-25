import { pool } from "../db.js"

// ─── GET /api/users/zonas ─────────────────────────────────────────────────────

export const listZonas = async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        z.id, z.codigo, z.nombre, z.descripcion, z.activa, z.created_at,
        z.supervisor_id,
        u.nombre || ' ' || u.apellido   AS supervisor_nombre,
        u.email                         AS supervisor_email,
        ST_AsGeoJSON(z.geom)::json      AS geom
      FROM operations.zones z
      LEFT JOIN app_auth.users u ON u.id = z.supervisor_id
      ORDER BY z.nombre
    `)
    // Listado mutable: el admin edita asignaciones y debe verlas de inmediato.
    // Sin esto el navegador/Cloudflare sirve una respuesta cacheada y obliga a
    // hacer hard refresh (Ctrl+Shift+R) para ver el supervisor recién asignado.
    res.set("Cache-Control", "no-store")
    return res.json({ zonas: rows })
  } catch (err) {
    console.error("[zone] listZonas:", err.message)
    return res.status(500).json({ error: "Error al obtener zonas" })
  }
}

// ─── GET /api/users/zonas/:id/supervisores ────────────────────────────────────
// Lista todos los supervisores asignados a una zona (relación N:M).

export const listZonaSupervisores = async (req, res) => {
  const { id } = req.params
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.apellido, u.email, sz.asignado_at
      FROM operations.supervisor_zones sz
      JOIN app_auth.users u ON u.id = sz.supervisor_id
      WHERE sz.zona_id = $1
      ORDER BY u.nombre
    `, [id])
    return res.json({ supervisores: rows })
  } catch (err) {
    console.error("[zone] listZonaSupervisores:", err.message)
    return res.status(500).json({ error: "Error al obtener supervisores de zona" })
  }
}

// ─── PUT /api/users/zonas/:id ─────────────────────────────────────────────────
// Mantiene sincronizadas operations.zones.supervisor_id y
// operations.supervisor_zones (junction 1:N) en una sola transacción.

export const updateZona = async (req, res) => {
  const { id } = req.params
  const body = req.body

  const sets = []
  const values = []
  let idx = 1

  const supervisorCambia = "supervisor_id" in body
  let newSupId = null
  if (supervisorCambia) {
    newSupId = body.supervisor_id === "" ? null : (body.supervisor_id ?? null)
    sets.push(`supervisor_id = $${idx++}`)
    values.push(newSupId)
  }
  if ("nombre" in body)       { sets.push(`nombre = $${idx++}`);       values.push(body.nombre) }
  if ("descripcion" in body)  { sets.push(`descripcion = $${idx++}`);  values.push(body.descripcion ?? null) }
  if ("activa" in body)       { sets.push(`activa = $${idx++}`);       values.push(body.activa) }

  if (sets.length === 0) return res.status(400).json({ error: "No hay campos para actualizar" })

  sets.push(`updated_at = NOW()`)
  values.push(id)

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Leer supervisor anterior de esta zona
    const { rows: prev } = await client.query(
      "SELECT supervisor_id FROM operations.zones WHERE id = $1",
      [id]
    )
    const oldSupId = prev[0]?.supervisor_id ?? null

    // Actualizar la zona
    const { rows, rowCount } = await client.query(
      `UPDATE operations.zones SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, codigo, nombre, supervisor_id, activa, descripcion`,
      values
    )
    if (rowCount === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Zona no encontrada" })
    }

    if (supervisorCambia) {
      // Quitar de la junction al supervisor anterior si cambió
      if (oldSupId && oldSupId !== newSupId) {
        await client.query(
          "DELETE FROM operations.supervisor_zones WHERE supervisor_id = $1 AND zona_id = $2",
          [oldSupId, id]
        )
      }
      // Agregar al nuevo supervisor en la junction (acepta múltiples zonas)
      if (newSupId) {
        await client.query(
          `INSERT INTO operations.supervisor_zones (supervisor_id, zona_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [newSupId, id]
        )
      }
    }

    await client.query("COMMIT")
    return res.json({ zona: rows[0] })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[zone] updateZona:", err.message)
    return res.status(500).json({ error: "Error al actualizar zona" })
  } finally {
    client.release()
  }
}

// ─── POST /api/users/zonas/import ─────────────────────────────────────────────
// Body: { features: GeoJSON Feature[] }

export const importZonas = async (req, res) => {
  const { feature, features } = req.body
  const items = features ?? (feature ? [feature] : null)

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Se requiere un array 'features' con al menos un Feature GeoJSON" })
  }

  // Validar geometrías antes de abrir la transacción para no dejarla a medias.
  for (const f of items) {
    const geomType = f.geometry?.type
    if (geomType !== "Polygon" && geomType !== "MultiPolygon") {
      return res.status(400).json({ error: `Geometría no soportada: ${geomType}. Solo Polygon y MultiPolygon` })
    }
  }

  const results = []
  const client  = await pool.connect()

  try {
    await client.query("BEGIN")

    const zonaIds = []
    for (const f of items) {
      const props   = f.properties ?? {}
      const codigo  = (props.codigo ?? props.CODIGO ?? props.CODE ?? `ZN-IMPORT-${Date.now()}`).slice(0, 20)
      const nombre  = (props.nombre ?? props.NOMBRE ?? props.name ?? props.NAME ?? "Zona importada").slice(0, 150)
      const desc    = props.descripcion ?? props.DESCRIPCION ?? props.description ?? null

      const { rows } = await client.query(
        `INSERT INTO operations.zones (codigo, nombre, descripcion, geom)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
         ON CONFLICT (codigo) DO UPDATE SET
           nombre      = EXCLUDED.nombre,
           descripcion = EXCLUDED.descripcion,
           geom        = EXCLUDED.geom,
           updated_at  = NOW()
         RETURNING id, codigo, nombre, activa`,
        [codigo, nombre, desc, JSON.stringify(f.geometry)]
      )
      results.push(rows[0])
      zonaIds.push(rows[0].id)
    }

    // ── Re-zonificación de incidentes existentes ────────────────────────────────
    // La zona_id de un incidente se congela al crearlo (trigger fn_assign_zone, que
    // solo dispara en INSERT o UPDATE OF ubicacion). Al importar/ampliar una zona,
    // los incidentes que AHORA caen dentro de su polígono siguen apuntando a la zona
    // vieja, así que no le aparecen al supervisor correcto. Aquí los reasignamos.
    //
    // Usamos la MISMA regla canónica que el trigger: zona más específica que CUBRE
    // el punto (ST_Covers + ORDER BY ST_Area ASC). Limitado a incidentes que caen en
    // alguna de las zonas recién importadas — recalculamos su zona objetivo entre
    // TODAS las zonas activas (no solo las importadas) para no asignar una zona
    // importada grande cuando ya existe otra más específica que también lo cubre.
    // Se excluyen los de ubicación aproximada (deben quedar sin zona, revisión manual).
    const { rowCount: reassigned } = await client.query(
      `UPDATE incidents.incidents i
          SET zona_id = (
                SELECT z.id FROM operations.zones z
                WHERE z.activa = TRUE AND ST_Covers(z.geom, i.ubicacion)
                ORDER BY ST_Area(z.geom) ASC
                LIMIT 1
              ),
              updated_at = NOW()
        WHERE i.ubicacion_aproximada = FALSE
          -- solo incidentes que caen en alguna de las zonas recién importadas
          AND EXISTS (
            SELECT 1 FROM operations.zones zi
            WHERE zi.id = ANY($1::uuid[])
              AND zi.activa = TRUE
              AND ST_Covers(zi.geom, i.ubicacion)
          )
          -- y cuya zona objetivo (la más específica entre TODAS) difiere de la actual
          AND i.zona_id IS DISTINCT FROM (
                SELECT z.id FROM operations.zones z
                WHERE z.activa = TRUE AND ST_Covers(z.geom, i.ubicacion)
                ORDER BY ST_Area(z.geom) ASC
                LIMIT 1
              )`,
      [zonaIds]
    )

    await client.query("COMMIT")

    if (reassigned > 0) {
      console.warn(`[zone] importZonas: ${reassigned} incidente(s) re-zonificado(s) a las zonas importadas`)
    }

    return res.status(201).json({ zonas: results, imported: results.length, incidentes_rezonificados: reassigned })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[zone] importZonas:", err.message)
    return res.status(500).json({ error: "Error al importar zonas: " + err.message })
  } finally {
    client.release()
  }
}

// ─── POST /api/users/zonas/rezonificar ────────────────────────────────────────
// Recalcula la zona_id de TODOS los incidentes según la geometría actual de las
// zonas activas, replicando EXACTAMENTE la lógica canónica del trigger
// incidents.fn_assign_zone (la fuente de verdad del sistema):
//   • zona más específica que CUBRE el punto: ST_Covers + ORDER BY ST_Area(geom) ASC
//   • respeta ubicacion_aproximada = TRUE → zona_id queda NULL (revisión manual)
//   • sin fallback por proximidad: un punto fuera de toda zona queda huérfano (NULL),
//     igual que al insertarlo.
//
// Por qué se necesita: el trigger trg_auto_assign_zone solo dispara en INSERT o en
// UPDATE OF ubicacion. Editar/importar/mover polígonos de zonas NO re-evalúa los
// incidentes existentes, que conservan la zona_id congelada. Esto los realinea de
// una pasada — útil cuando el re-zonificado acotado de importZonas no basta (p.ej.
// zonas ya existentes cuyo polígono se editó después).
//
// NOTA: este UPDATE escribe zona_id directamente; el trigger fn_assign_zone NO se
// dispara (solo reacciona a cambios de `ubicacion`), así que no hay recálculo que
// pise nuestro valor.
//
// Flags (query o body):
//   solo_huerfanos (default false) — true: solo toca incidentes con zona_id NULL
//                                     (rescata huérfanos sin re-mover el resto).
//   dry_run        (default false) — true: no escribe; solo cuenta cuántos cambiarían.

export const rezonificarIncidentes = async (req, res) => {
  const src = { ...req.query, ...req.body }
  const soloHuerfanos = String(src.solo_huerfanos ?? "false") === "true"
  const dryRun        = String(src.dry_run ?? "false") === "true"

  // Subquery que, por cada incidente, resuelve la zona que le tocaría HOY según
  // fn_assign_zone. Filtra a los que realmente cambian. Los de ubicación aproximada
  // se excluyen del recálculo: deben permanecer sin zona (revisión manual).
  const filtroHuerfanos = soloHuerfanos ? "AND i.zona_id IS NULL" : ""

  const cambios = `
    SELECT
      i.id,
      (SELECT z.id FROM operations.zones z
        WHERE z.activa = TRUE AND ST_Covers(z.geom, i.ubicacion)
        ORDER BY ST_Area(z.geom) ASC
        LIMIT 1) AS zona_objetivo,
      i.zona_id AS zona_actual
    FROM incidents.incidents i
    WHERE i.ubicacion_aproximada = FALSE
      ${filtroHuerfanos}`

  // Solo aplicamos filas donde el objetivo difiere del actual. Incluye el caso
  // "objetivo NULL y actual no-NULL" (incidente que ya no cae en ninguna zona)
  // para que no quede pegado a una zona que ya no lo cubre.
  const cambiosReales = `
    SELECT id, zona_objetivo FROM (${cambios}) s
    WHERE s.zona_actual IS DISTINCT FROM s.zona_objetivo`

  const client = await pool.connect()
  try {
    if (dryRun) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM (${cambiosReales}) c`)
      return res.json({ dry_run: true, solo_huerfanos: soloHuerfanos, incidentes_a_rezonificar: rows[0].n })
    }

    await client.query("BEGIN")
    const { rowCount } = await client.query(
      `UPDATE incidents.incidents i
          SET zona_id    = c.zona_objetivo,
              updated_at = NOW()
         FROM (${cambiosReales}) c
        WHERE c.id = i.id`
    )
    await client.query("COMMIT")

    if (rowCount > 0) {
      console.warn(`[zone] rezonificarIncidentes: ${rowCount} incidente(s) re-zonificado(s) (solo_huerfanos=${soloHuerfanos})`)
    }
    return res.json({ solo_huerfanos: soloHuerfanos, incidentes_rezonificados: rowCount })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("[zone] rezonificarIncidentes:", err.message)
    return res.status(500).json({ error: "Error al re-zonificar incidentes: " + err.message })
  } finally {
    client.release()
  }
}

// ─── DELETE /api/users/zonas/:id ──────────────────────────────────────────────
// Elimina una zona. La BD se encarga de las referencias:
//   • incidents.incidents.zona_id → ON DELETE SET NULL (los incidentes quedan sin
//     zona, no se borran; pueden re-zonificarse luego).
//   • operations.supervisor_zones.zona_id → ON DELETE CASCADE (se limpia la junction).
//
// GUARD: se bloquea el borrado si la zona tiene incidentes ACTIVOS
// (PENDIENTE, VALIDO, EN_ATENCION) para no perder seguimiento de trabajo en curso.
// Los incidentes en estados terminales no bloquean (quedarían sin zona, que es
// aceptable para datos históricos).

export const deleteZona = async (req, res) => {
  const { id } = req.params

  try {
    const { rows: zona } = await pool.query(
      "SELECT id, codigo, nombre FROM operations.zones WHERE id = $1",
      [id]
    )
    if (zona.length === 0) {
      return res.status(404).json({ error: "Zona no encontrada" })
    }

    // Guard: no borrar si hay incidentes activos en la zona.
    const { rows: activos } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM incidents.incidents
        WHERE zona_id = $1
          AND estado IN ('PENDIENTE', 'VALIDO', 'EN_ATENCION')`,
      [id]
    )
    if (activos[0].n > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: la zona tiene ${activos[0].n} incidente(s) activo(s). ` +
               `Reasígnalos o ciérralos primero (puedes usar Re-zonificar tras ajustar las zonas).`,
        incidentes_activos: activos[0].n,
      })
    }

    // El borrado dispara ON DELETE SET NULL (incidents) y CASCADE (supervisor_zones).
    await pool.query("DELETE FROM operations.zones WHERE id = $1", [id])

    console.warn(`[zone] deleteZona: eliminada ${zona[0].codigo} (${zona[0].nombre})`)
    return res.json({ deleted: true, zona: zona[0] })
  } catch (err) {
    console.error("[zone] deleteZona:", err.message)
    return res.status(500).json({ error: "Error al eliminar zona: " + err.message })
  }
}

// ─── GET /api/users/config/:clave ─────────────────────────────────────────────

export const getConfig = async (req, res) => {
  const { clave } = req.params
  try {
    const { rows } = await pool.query(
      "SELECT valor FROM operations.config WHERE clave = $1",
      [clave]
    )
    if (rows.length === 0) return res.status(404).json({ error: "Clave de configuración no encontrada" })
    return res.json({ clave, valor: rows[0].valor })
  } catch (err) {
    console.error("[config] getConfig:", err.message)
    return res.status(500).json({ error: "Error al obtener configuración" })
  }
}

// ─── PUT /api/users/config/:clave ─────────────────────────────────────────────

export const setConfigValue = async (req, res) => {
  const { clave } = req.params
  const { valor }  = req.body
  if (valor === undefined || valor === null) return res.status(400).json({ error: "Falta el campo 'valor'" })

  try {
    await pool.query(
      `INSERT INTO operations.config (clave, valor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [clave, String(valor)]
    )
    return res.json({ clave, valor: String(valor) })
  } catch (err) {
    console.error("[config] setConfig:", err.message)
    return res.status(500).json({ error: "Error al guardar configuración" })
  }
}
