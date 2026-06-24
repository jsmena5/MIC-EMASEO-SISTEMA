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

  const results = []

  try {
    for (const f of items) {
      const geomType = f.geometry?.type
      if (geomType !== "Polygon" && geomType !== "MultiPolygon") {
        return res.status(400).json({ error: `Geometría no soportada: ${geomType}. Solo Polygon y MultiPolygon` })
      }

      const props   = f.properties ?? {}
      const codigo  = (props.codigo ?? props.CODIGO ?? props.CODE ?? `ZN-IMPORT-${Date.now()}`).slice(0, 20)
      const nombre  = (props.nombre ?? props.NOMBRE ?? props.name ?? props.NAME ?? "Zona importada").slice(0, 150)
      const desc    = props.descripcion ?? props.DESCRIPCION ?? props.description ?? null

      const { rows } = await pool.query(
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
    }

    return res.status(201).json({ zonas: results, imported: results.length })
  } catch (err) {
    console.error("[zone] importZonas:", err.message)
    return res.status(500).json({ error: "Error al importar zonas: " + err.message })
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
