import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { v4 as uuidv4 } from "uuid"
import retry from "async-retry"
import { pool } from "../db.js"
import { mlBreaker, ML_DEGRADED_CODE } from "../mlCircuitBreaker.js"

const DB_RETRY_OPTS = { retries: 3, factor: 2, minTimeout: 500 }

// ── Configuración ─────────────────────────────────────────────────────────────

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000/predict"
const ML_HEALTH_URL  = (() => {
  try { return `${new URL(ML_SERVICE_URL).origin}/health` } catch { return "http://localhost:8000/health" }
})()
const BUCKET      = process.env.S3_BUCKET      ?? "emaseo-incidents"
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL

const s3 = new S3Client({
  endpoint:    process.env.S3_ENDPOINT,
  region:      process.env.S3_REGION ?? "us-east-1",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

// ── Helpers privados ──────────────────────────────────────────────────────────

function getImageDimensions(buf) {
  // PNG: IHDR en offset 16-23
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null
    return { format: "PNG", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: recorrer segmentos buscando marcador SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) break
      const m = buf[i + 1]
      if (
        (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) ||
        (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
      ) {
        return { format: "JPEG", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return { format: "JPEG", width: 0, height: 0 }
  }
  return null
}

const MIN_FILE_BYTES = 1_000
const MIN_SIDE_PX   = 320

async function checkMlHealth() {
  try {
    const res = await fetch(ML_HEALTH_URL, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (cause) {
    const err = new Error("El servicio de análisis visual está temporalmente fuera de servicio.")
    err.cause = cause
    throw err
  }
}

// ── runMlAnalysis — tarea pesada ejecutada en background ─────────────────────
//
// Progresión de estado:
//   PROCESANDO → PENDIENTE  si todo el pipeline tiene éxito
//   PROCESANDO → FALLIDO    en cualquier error (health, ML, S3, DB)

async function runMlAnalysis(taskId, { buffer, image }) {
  const log  = (msg) => console.log(`[image-service]  [task=${taskId}] ${msg}`)
  const logE = (msg) => console.error(`[image-service] [task=${taskId}] ${msg}`)

  const markFailed = async (reason) => {
    try {
      await pool.query(
        `UPDATE incidents.incidents SET estado = 'FALLIDO', updated_at = NOW() WHERE id = $1`,
        [taskId],
      )
    } catch (dbErr) {
      logE(`No se pudo marcar como FALLIDO: ${dbErr.message}`)
    }
    logE(`FALLIDO — ${reason}`)
  }

  try {
    // 1. Health check rápido (3 s) — evita enviar el payload base64 si el ML está caído
    try {
      await checkMlHealth()
      log("health check ok")
    } catch (err) {
      return await markFailed(`health check: ${err.cause?.message ?? err.message}`)
    }

    // 2. Inferencia ML vía Circuit Breaker (timeout 15 s, umbral 50 %)
    let mlResult
    try {
      mlResult = await mlBreaker.fire({ image_base64: image, image_width: 1280, image_height: 960 })
      log(`ML ok — has_waste=${mlResult.has_waste} nivel=${mlResult.nivel_acumulacion} t=${mlResult.tiempo_inferencia_ms}ms`)
    } catch (err) {
      const reason = err.code === ML_DEGRADED_CODE
        ? `circuit breaker abierto: ${err.message}`
        : `ML predict: ${err.message}`
      return await markFailed(reason)
    }

    // 3. ML no detectó residuos → incidente sin valor, cerrar como FALLIDO
    if (!mlResult.has_waste) {
      return await markFailed("ML no detectó residuos en la imagen")
    }

    // 4. Subir imagen a MinIO/S3
    const s3Key   = `incidents/${uuidv4()}.jpg`
    const imageUrl = `${S3_PUBLIC_URL}/${BUCKET}/${s3Key}`

    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: s3Key, Body: buffer, ContentType: "image/jpeg",
      }))
      log(`MinIO ok — key=${s3Key}`)
    } catch (err) {
      return await markFailed(`upload S3: ${err.message}`)
    }

    // 5. Transacción: actualizar incidente + imagen + resultado IA
    // La compensación S3 solo ocurre si se agotan todos los reintentos.
    try {
      await retry(
        async () => {
          const client = await pool.connect()
          try {
            await client.query("BEGIN")

            await client.query(
              `UPDATE incidents.incidents
               SET estado = 'PENDIENTE', prioridad = $2, updated_at = NOW()
               WHERE id = $1`,
              [taskId, mlResult.prioridad],
            )
            await client.query(
              `INSERT INTO incidents.incident_images (incident_id, image_url, es_principal)
               VALUES ($1, $2, TRUE)`,
              [taskId, imageUrl],
            )
            await client.query(
              `INSERT INTO ai.analysis_results
                 (incident_id, modelo_nombre, tipo_residuo, nivel_acumulacion,
                  volumen_estimado_m3, confianza, detecciones, tiempo_inferencia_ms)
               VALUES ($1, $2, $3::ai.waste_type, $4::ai.accumulation_level, $5, $6, $7::jsonb, $8)`,
              [
                taskId,
                mlResult.modelo_nombre,   mlResult.tipo_residuo,
                mlResult.nivel_acumulacion, mlResult.volumen_estimado_m3,
                mlResult.confianza,         JSON.stringify(mlResult.detecciones),
                mlResult.tiempo_inferencia_ms,
              ],
            )

            await client.query("COMMIT")
          } catch (dbErr) {
            await client.query("ROLLBACK").catch(() => {})
            throw dbErr
          } finally {
            client.release()
          }
        },
        {
          ...DB_RETRY_OPTS,
          onRetry: (err, attempt) => logE(`DB transacción retry ${attempt}: ${err.message}`),
        },
      )
      log(`COMPLETADO — incidente PENDIENTE prioridad=${mlResult.prioridad}`)
    } catch (dbErr) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key })).catch(() => {})
      throw dbErr // lo atrapa el catch externo → markFailed
    }
  } catch (err) {
    await markFailed(err.message).catch(() => {})
  }
}

// ── validateImageBuffer ───────────────────────────────────────────────────────
// Valida un Buffer decodificado; retorna { valid, message, ...dims }.
// Sin req/res: el controller decide el HTTP status.

export function validateImageBuffer(buffer) {
  if (buffer.length < MIN_FILE_BYTES) {
    return { valid: false, message: "Imagen demasiado pequeña o vacía. Vuelve a intentarlo." }
  }

  const dims = getImageDimensions(buffer)
  if (!dims) {
    return { valid: false, message: "Formato no soportado. Se aceptan JPEG y PNG." }
  }

  if (dims.width > 0 && dims.height > 0 && (dims.width < MIN_SIDE_PX || dims.height < MIN_SIDE_PX)) {
    return { valid: false, message: "Acércate más al objeto para capturar una imagen de mayor resolución." }
  }

  return { valid: true, message: "Imagen lista para análisis.", ...dims }
}

// ── analyzeImage ──────────────────────────────────────────────────────────────
// 1. Valida parámetros (lanza error tipado con httpStatus si algo falla).
// 2. INSERT en incidents con estado PROCESANDO.
// 3. Despacha runMlAnalysis en background con setImmediate.
// 4. Retorna { httpStatus: 202, task_id, poll_url } — sin tocar res.

export async function analyzeImage({ image, latitude, longitude, descripcion = "", userId }) {
  // Validación de parámetros — los errores incluyen httpStatus para el controller
  if (!image)
    throw Object.assign(new Error("El campo 'image' (base64) es requerido."), { httpStatus: 400 })
  if (latitude === undefined || longitude === undefined)
    throw Object.assign(new Error("Los campos 'latitude' y 'longitude' son requeridos."), { httpStatus: 400 })
  if (!userId)
    throw Object.assign(new Error("No se pudo identificar al usuario. Token inválido o ausente."), { httpStatus: 401 })

  let buffer
  try {
    buffer = Buffer.from(image, "base64")
  } catch {
    throw Object.assign(new Error("Imagen base64 inválida o corrupta."), { httpStatus: 400 })
  }

  // INSERT inmediato — prioridad y resultado IA llegan en background
  const { rows } = await retry(
    () => pool.query(
      `INSERT INTO incidents.incidents (reportado_por, descripcion, ubicacion, estado)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'PROCESANDO')
       RETURNING id`,
      [userId, descripcion || null, longitude, latitude],
    ),
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) =>
        console.warn(`[image-service] INSERT incidents retry ${attempt}: ${err.message}`),
    },
  )
  const taskId = rows[0].id
  console.log(`[image-service] Incidente creado id=${taskId} estado=PROCESANDO`)

  // Despachar pipeline pesado sin bloquear la respuesta HTTP
  setImmediate(() => runMlAnalysis(taskId, { buffer, image }))

  return {
    httpStatus: 202,
    task_id:    taskId,
    estado:     "PROCESANDO",
    message:    "Imagen recibida. El análisis está en progreso.",
    poll_url:   `/api/image/status/${taskId}`,
  }
}

// ── getTaskStatus ─────────────────────────────────────────────────────────────
// Busca el incidente en PostgreSQL y retorna un objeto con httpStatus.
// Caso 404: lanza un error tipado (el controller lo captura en catch).

export async function getTaskStatus(taskId, userId) {
  const { rows } = await pool.query(
    `SELECT
       i.id, i.estado, i.prioridad, i.descripcion, i.created_at, i.updated_at,
       ST_Y(i.ubicacion::geometry) AS latitud,
       ST_X(i.ubicacion::geometry) AS longitud,
       ii.image_url,
       ar.nivel_acumulacion, ar.volumen_estimado_m3, ar.tipo_residuo,
       ar.confianza, ar.tiempo_inferencia_ms,
       jsonb_array_length(ar.detecciones) AS num_detecciones
     FROM incidents.incidents i
     LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
     LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
     WHERE i.id = $1 AND i.reportado_por = $2`,
    [taskId, userId],
  )

  if (!rows.length) {
    throw Object.assign(new Error("Tarea no encontrada."), { httpStatus: 404 })
  }

  const row = rows[0]

  if (row.estado === "PROCESANDO") {
    return {
      httpStatus: 202,
      task_id: row.id,
      estado:  "PROCESANDO",
      message: "En proceso, vuelve a consultar en unos segundos.",
    }
  }

  if (row.estado === "FALLIDO") {
    return {
      httpStatus: 200,
      task_id: row.id,
      estado:  "FALLIDO",
      message: "No se detectaron residuos en la imagen o el análisis falló. Intenta con otra foto.",
    }
  }

  // PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA — datos completos del incidente
  return {
    httpStatus:          200,
    task_id:             row.id,
    estado:              row.estado,
    incident_id:         row.id,
    prioridad:           row.prioridad,
    descripcion:         row.descripcion,
    latitud:             row.latitud,
    longitud:            row.longitud,
    image_url:           row.image_url,
    nivel_acumulacion:   row.nivel_acumulacion,
    volumen_estimado_m3: row.volumen_estimado_m3,
    tipo_residuo:        row.tipo_residuo,
    confianza:           row.confianza,
    tiempo_inferencia_ms: row.tiempo_inferencia_ms,
    num_detecciones:     row.num_detecciones,
    created_at:          row.created_at,
    updated_at:          row.updated_at,
  }
}

// ── getMyIncidents — handler legacy (usado por incident.routes.js) ─────────────

export const getMyIncidents = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  try {
    const { rows } = await pool.query(
      `SELECT
         i.id, i.estado, i.prioridad, i.descripcion, i.created_at,
         ST_Y(i.ubicacion::geometry) AS latitud,
         ST_X(i.ubicacion::geometry) AS longitud,
         ii.image_url,
         ar.nivel_acumulacion, ar.volumen_estimado_m3, ar.tipo_residuo,
         ar.confianza,
         jsonb_array_length(ar.detecciones) AS num_detecciones
       FROM incidents.incidents i
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
       WHERE i.reportado_por = $1
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [userId],
    )
    return res.json({ incidents: rows })
  } catch (err) {
    console.error("[image-service] getMyIncidents error:", err.message)
    return res.status(500).json({ error: "Error al obtener el historial de incidentes." })
  }
}
