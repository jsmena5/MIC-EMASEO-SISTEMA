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

// ── Helpers: parseo de dimensiones desde cabeceras binarias (sin deps extra) ──

/**
 * Lee ancho y alto directamente de los bytes del buffer sin librerías externas.
 * Soporta JPEG (busca marcadores SOF) y PNG (lee IHDR).
 * Retorna null si el formato no es reconocido.
 */
function getImageDimensions(buf) {
  // PNG: firma 8 bytes + chunk IHDR → width en offset 16, height en offset 20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null
    return {
      format: "PNG",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    }
  }

  // JPEG: recorrer segmentos buscando marcador SOF (FF C0–C3, C5–C7, C9–CB, CD–CF)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) break
      const marker = buf[i + 1]
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSOF) {
        return {
          format: "JPEG",
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        }
      }
      // segLen incluye los 2 bytes del propio campo de longitud
      const segLen = buf.readUInt16BE(i + 2)
      i += 2 + segLen
    }
    // JPEG válido (magic bytes OK) pero SOF no encontrado (imagen truncada)
    return { format: "JPEG", width: 0, height: 0 }
  }

  return null // formato no reconocido
}

// Imagen < 1 KB imposible en fotos reales; rechaza payloads vacíos o mal codificados
const MIN_FILE_BYTES = 1_000
// Dimensión mínima que el modelo RT-DETR necesita para detectar objetos con fiabilidad
const MIN_SIDE_PX = 320

export const validateImage = async (req, res) => {
  try {
    const { image } = req.body
    if (!image) {
      return res.status(400).json({ valid: false, message: "El campo 'image' (base64) es requerido." })
    }

    // 1. Decodificar base64 — falla si el string está malformado
    let buf
    try {
      buf = Buffer.from(image, "base64")
    } catch {
      return res.status(400).json({ valid: false, message: "Imagen corrupta o inválida." })
    }

    if (buf.length < MIN_FILE_BYTES) {
      return res.json({ valid: false, message: "Imagen demasiado pequeña o vacía. Vuelve a intentarlo." })
    }

    // 2. Verificar formato por magic bytes
    const dims = getImageDimensions(buf)
    if (!dims) {
      return res.json({ valid: false, message: "Formato no soportado. Se aceptan JPEG y PNG." })
    }

    // 3. Validar dimensiones mínimas (proxy de distancia: foto muy pequeña = sujeto muy lejos)
    if (dims.width > 0 && dims.height > 0) {
      if (dims.width < MIN_SIDE_PX || dims.height < MIN_SIDE_PX) {
        return res.json({
          valid: false,
          message: "Acércate más al objeto para capturar una imagen de mayor resolución.",
        })
      }
    }

    return res.json({
      valid: true,
      message: "Imagen lista para análisis.",
      width: dims.width,
      height: dims.height,
      format: dims.format,
    })
  } catch (error) {
    console.error("[image-service] validateImage error:", error.message)
    res.status(500).json({ valid: false, message: "Error interno al validar la imagen." })
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
