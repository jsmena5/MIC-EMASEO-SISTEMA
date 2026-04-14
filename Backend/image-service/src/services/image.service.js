import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { v4 as uuidv4 } from "uuid"
import { pool } from "../db.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads")
const ML_SERVICE_URL = "http://localhost:8000/predict"

// Crear directorio de uploads si no existe
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

// ── Stub original — se mantiene para no romper el flujo actual ─────────────────
export const validateImage = async (req, res) => {
  try {
    const { image } = req.body

    if (!image) {
      return res.status(400).json({ valid: false })
    }

    const randomDistance = Math.random()

    if (randomDistance > 0.5) {
      return res.json({ valid: true, message: "Distancia correcta" })
    }

    return res.json({ valid: false, message: "Acércate más al objeto" })
  } catch (error) {
    res.status(500).json({ valid: false })
  }
}

// ── Endpoint principal: análisis ML + creación de incidente ──────────────────
export const analyzeImage = async (req, res) => {
  const { image, latitude, longitude, descripcion = "" } = req.body
  const userId = req.headers["x-user-id"]

  // Validación de campos requeridos
  if (!image) {
    return res.status(400).json({ error: "El campo 'image' (base64) es requerido." })
  }
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: "Los campos 'latitude' y 'longitude' son requeridos." })
  }
  if (!userId) {
    return res.status(401).json({ error: "No se pudo identificar al usuario. Token inválido o ausente." })
  }

  // 1. Guardar imagen en disco
  const imageId = uuidv4()
  const fileName = `${imageId}.jpg`
  const filePath = path.join(UPLOADS_DIR, fileName)
  const imageUrl = `uploads/${fileName}`

  try {
    const buffer = Buffer.from(image, "base64")
    await fs.promises.writeFile(filePath, buffer)
  } catch (err) {
    return res.status(400).json({ error: "Imagen base64 inválida o corrupta." })
  }

  // 2. Llamar al microservicio Python de inferencia
  let mlResult
  try {
    const mlResponse = await fetch(ML_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: image,
        image_width: 1280,
        image_height: 960,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!mlResponse.ok) {
      const errText = await mlResponse.text()
      console.error("[image-service] ML Service respondió con error:", mlResponse.status, errText)
      return res.status(502).json({ error: "Error en el servicio de análisis.", detail: errText })
    }

    mlResult = await mlResponse.json()
  } catch (err) {
    if (err.name === "AbortError" || err.code === "ECONNREFUSED" || err.code === "UND_ERR_CONNECT_TIMEOUT") {
      return res.status(503).json({
        error: "Servicio de análisis no disponible.",
        detail: "Asegúrate de que el ML Service esté corriendo en el puerto 8000.",
      })
    }
    console.error("[image-service] Error al llamar ML Service:", err.message)
    return res.status(503).json({ error: "Servicio de análisis no disponible.", detail: err.message })
  }

  // 3. Transacción en base de datos
  const client = await pool.connect()
  let incidentId, zonaId

  try {
    await client.query("BEGIN")

    // a) Crear incidente
    const incidentResult = await client.query(
      `INSERT INTO incidents.incidents
         (reportado_por, descripcion, ubicacion, estado, prioridad)
       VALUES
         ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'PENDIENTE', $5)
       RETURNING id, zona_id`,
      [userId, descripcion || null, longitude, latitude, mlResult.prioridad]
    )
    incidentId = incidentResult.rows[0].id
    zonaId = incidentResult.rows[0].zona_id

    // b) Guardar referencia de imagen
    await client.query(
      `INSERT INTO incidents.incident_images (incident_id, image_url, es_principal)
       VALUES ($1, $2, TRUE)`,
      [incidentId, imageUrl]
    )

    // c) Guardar resultado de análisis IA
    await client.query(
      `INSERT INTO ai.analysis_results
         (incident_id, modelo_nombre, tipo_residuo, nivel_acumulacion,
          volumen_estimado_m3, confianza, detecciones, tiempo_inferencia_ms)
       VALUES ($1, $2, $3::ai.waste_type, $4::ai.accumulation_level, $5, $6, $7::jsonb, $8)`,
      [
        incidentId,
        mlResult.modelo_nombre,
        mlResult.tipo_residuo,
        mlResult.nivel_acumulacion,
        mlResult.volumen_estimado_m3,
        mlResult.confianza,
        JSON.stringify(mlResult.detecciones),
        mlResult.tiempo_inferencia_ms,
      ]
    )

    await client.query("COMMIT")
  } catch (dbErr) {
    await client.query("ROLLBACK")
    console.error("[image-service] Error en transacción DB:", dbErr.message)
    // Limpiar imagen guardada si la DB falló
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return res.status(500).json({ error: "Error al registrar el incidente en la base de datos.", detail: dbErr.message })
  } finally {
    client.release()
  }

  // 4. Respuesta exitosa
  return res.status(201).json({
    success: true,
    incident_id: incidentId,
    zona_id: zonaId,
    nivel_acumulacion: mlResult.nivel_acumulacion,
    volumen_estimado_m3: mlResult.volumen_estimado_m3,
    prioridad: mlResult.prioridad,
    tipo_residuo: mlResult.tipo_residuo,
    confianza: mlResult.confianza,
    num_detecciones: mlResult.num_detecciones,
    coverage_ratio: mlResult.coverage_ratio,
    tiempo_inferencia_ms: mlResult.tiempo_inferencia_ms,
    estado: "PENDIENTE",
    message: "Incidente registrado exitosamente.",
  })
}
