import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { v4 as uuidv4 } from "uuid"
import retry from "async-retry"
import { pool } from "../db.js"
import { mlBreaker, ML_DEGRADED_CODE } from "../mlCircuitBreaker.js"
import { MIN_FILE_BYTES, MIN_SIDE_PX, getImageDimensions } from "../utils/imageValidation.js"
export { validateImageBuffer } from "../utils/imageValidation.js"

// ──────────────────────────────────────────────────────────────────────────────
// Constantes y configuración
// ──────────────────────────────────────────────────────────────────────────────

const DB_RETRY_OPTS = { 
  retries: 3, 
  factor: 2, 
  minTimeout: 500 
}

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000/predict"
const ML_HEALTH_URL = (() => {
  try { 
    return `${new URL(ML_SERVICE_URL).origin}/health` 
  } catch { 
    return "http://localhost:8000/health" 
  }
})()

const BUCKET = process.env.S3_BUCKET ?? "emaseo-incidents"
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL

// Límites geográficos de Ecuador (WGS84)
const ECUADOR_BBOX = {
  lat: { min: -5.02, max: 1.45 },
  lon: { min: -92.01, max: -75.18 }
}

// Valor temporal para prioridad mientras el ML procesa
const TEMP_PRIORIDAD = 'BAJA'

// ──────────────────────────────────────────────────────────────────────────────
// Cliente S3 (MinIO / AWS)
// ──────────────────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Verifica que el servicio ML esté saludable
 * @throws {Error} Si el servicio no responde en 3 segundos
 */
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

/**
 * Valida que las coordenadas estén dentro del territorio ecuatoriano
 */
function isValidEcuadorLocation(lat, lon) {
  const latNum = Number(lat)
  const lonNum = Number(lon)
  
  if (isNaN(latNum) || isNaN(lonNum)) return false
  
  return (
    latNum >= ECUADOR_BBOX.lat.min && 
    latNum <= ECUADOR_BBOX.lat.max &&
    lonNum >= ECUADOR_BBOX.lon.min && 
    lonNum <= ECUADOR_BBOX.lon.max
  )
}

/**
 * Crea un error con código HTTP para el controller
 */
function createHttpError(message, httpStatus, cause = null) {
  const error = new Error(message)
  error.httpStatus = httpStatus
  if (cause) error.cause = cause
  return error
}

/**
 * Marca un incidente como FALLIDO en la base de datos
 */
async function markIncidentAsFailed(incidentId, reason, logError) {
  try {
    await pool.query(
      `UPDATE incidents.incidents 
       SET estado = 'FALLIDO', nota_fallo = $2, updated_at = NOW() 
       WHERE id = $1`,
      [incidentId, reason]
    )
  } catch (dbErr) {
    logError(`No se pudo marcar como FALLIDO: ${dbErr.message}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// runMlAnalysis — Pipeline principal en background
// ──────────────────────────────────────────────────────────────────────────────
//
// Progresión de estado:
//   PROCESANDO → PENDIENTE  → Éxito (ML detectó basura, todo OK)
//   PROCESANDO → FALLIDO    → Error (health check, ML, S3, o DB)
//
// @param {string} incidentId - ID del incidente (taskId)
// @param {Object} params - { buffer: Buffer, image: string (base64) }

async function runMlAnalysis(incidentId, { buffer, image }) {
  const log = (msg) => console.log(`[image-service] [incident=${incidentId}] ${msg}`)
  const logError = (msg) => console.error(`[image-service] [incident=${incidentId}] ${msg}`)

  try {
    // 1. Health check del servicio ML (timeout 3s)
    log("Verificando salud del servicio ML...")
    try {
      await checkMlHealth()
      log("✓ Health check OK")
    } catch (err) {
      await markIncidentAsFailed(incidentId, `health check: ${err.cause?.message ?? err.message}`, logError)
      logError(`✗ FALLIDO — Servicio ML no disponible`)
      return
    }

    // 2. Inferencia ML vía Circuit Breaker
    log("Enviando imagen al servicio ML...")
    let mlResult
    try {
      mlResult = await mlBreaker.fire({ 
        image_base64: image, 
        image_width: 1280, 
        image_height: 960 
      })
      log(`✓ ML response — has_waste=${mlResult.has_waste}, ` +
          `nivel=${mlResult.nivel_acumulacion}, ` +
          `prioridad=${mlResult.prioridad}, ` +
          `t=${mlResult.tiempo_inferencia_ms}ms`)
    } catch (err) {
      const reason = err.code === ML_DEGRADED_CODE
        ? `circuit breaker abierto: ${err.message}`
        : `ML predict: ${err.message}`
      await markIncidentAsFailed(incidentId, reason, logError)
      logError(`✗ FALLIDO — ${reason}`)
      return
    }

    // 3. Validar que ML haya detectado residuos
    if (!mlResult.has_waste) {
      await markIncidentAsFailed(incidentId, "ML no detectó residuos en la imagen", logError)
      logError(`✗ FALLIDO — No se detectaron residuos`)
      return
    }

    // 4. Subir imagen a MinIO/S3
    const s3Key = `incidents/${uuidv4()}.jpg`
    const imageUrl = `${S3_PUBLIC_URL}/${BUCKET}/${s3Key}`

    log(`Subiendo imagen a S3: ${s3Key}`)
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: "image/jpeg",
      }))
      log(`✓ Imagen subida correctamente`)
    } catch (err) {
      await markIncidentAsFailed(incidentId, `upload S3: ${err.message}`, logError)
      logError(`✗ FALLIDO — Error al subir imagen: ${err.message}`)
      return
    }

    // 5. Transacción atómica: actualizar incidente + imagen + resultados IA
    try {
      await retry(
        async () => {
          const client = await pool.connect()
          try {
            await client.query("BEGIN")

            // Obtener created_at original y actualizar estado + prioridad
            const { rows: updRows } = await client.query(
              `UPDATE incidents.incidents
               SET estado = 'PENDIENTE', 
                   prioridad = $2, 
                   updated_at = NOW()
               WHERE id = $1
               RETURNING created_at`,
              [incidentId, mlResult.prioridad]
            )

            const incidentCreatedAt = updRows[0].created_at

            // Insertar imagen del incidente
            await client.query(
              `INSERT INTO incidents.incident_images
                 (incident_id, incident_created_at, image_url, es_principal)
               VALUES ($1, $2, $3, TRUE)`,
              [incidentId, incidentCreatedAt, imageUrl]
            )

            // Insertar resultados del análisis IA
            await client.query(
              `INSERT INTO ai.analysis_results
                 (incident_id, incident_created_at, modelo_nombre, tipo_residuo,
                  nivel_acumulacion, volumen_estimado_m3, confianza, detecciones,
                  tiempo_inferencia_ms)
               VALUES ($1, $2, $3, $4::ai.waste_type, 
                       $5::ai.accumulation_level, $6, $7, $8::jsonb, $9)`,
              [
                incidentId,
                incidentCreatedAt,
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
            log(`✓ Transacción completada — incidente PENDIENTE con prioridad=${mlResult.prioridad}`)
          } catch (dbErr) {
            await client.query("ROLLBACK").catch(() => {})
            throw dbErr
          } finally {
            client.release()
          }
        },
        {
          ...DB_RETRY_OPTS,
          onRetry: (err, attempt) => logError(`DB transacción retry ${attempt}: ${err.message}`),
        }
      )
    } catch (dbErr) {
      // Si falla la DB, limpiar la imagen subida (compensación)
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key })).catch(() => {})
      await markIncidentAsFailed(incidentId, `DB transaction: ${dbErr.message}`, logError)
      logError(`✗ FALLIDO — Error en transacción DB: ${dbErr.message}`)
    }
  } catch (err) {
    // Catch general por si algo no manejado explota
    logError(`✗ Error no controlado: ${err.message}`)
    await markIncidentAsFailed(incidentId, `error no controlado: ${err.message}`, logError)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// analyzeImage — Endpoint principal
// ──────────────────────────────────────────────────────────────────────────────
//
// 1. Valida parámetros de entrada (lanza error con httpStatus)
// 2. Valida coordenadas en Ecuador
// 3. Valida formato de imagen base64
// 4. INSERT en incidents con estado PROCESANDO y prioridad temporal
// 5. Despacha runMlAnalysis en background (setImmediate)
// 6. Retorna 202 Accepted con task_id para polling

export async function analyzeImage({ image, latitude, longitude, descripcion = "", direccion = "", userId }) {
  
  // 1. Validar campos requeridos
  if (!image) {
    throw createHttpError("El campo 'image' (base64) es requerido.", 400)
  }
  
  if (latitude === undefined || longitude === undefined) {
    throw createHttpError("Los campos 'latitude' y 'longitude' son requeridos.", 400)
  }
  
  if (!userId) {
    throw createHttpError("No se pudo identificar al usuario. Token inválido o ausente.", 401)
  }

  // 2. Validar coordenadas de Ecuador
  if (!isValidEcuadorLocation(latitude, longitude)) {
    throw createHttpError(
      "No se pudo obtener tu ubicación GPS en Ecuador. Activa el GPS e intenta de nuevo.",
      422
    )
  }

  // 3. Validar formato base64
  if (image.length > 10 * 1024 * 1024) {
    throw createHttpError("La imagen excede el tamaño máximo permitido (10 MB en base64).", 413)
  }

  let buffer
  try {
    buffer = Buffer.from(image, "base64")
  } catch {
    throw createHttpError("Imagen base64 inválida o corrupta.", 400)
  }

  // 4. Insertar incidente con estado PROCESANDO y prioridad temporal
  const lat = Number(latitude)
  const lon = Number(longitude)
  
  const { rows } = await retry(
    () => pool.query(
      `INSERT INTO incidents.incidents 
       (reportado_por, descripcion, ubicacion, direccion, estado, prioridad)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, 'PROCESANDO', $6)
       RETURNING id`,
      [userId, descripcion || null, lon, lat, direccion || null, TEMP_PRIORIDAD]
    ),
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) =>
        console.warn(`[image-service] INSERT incidents retry ${attempt}: ${err.message}`),
    }
  )

  const incidentId = rows[0].id
  console.log(`[image-service] ✅ Incidente creado id=${incidentId} estado=PROCESANDO prioridad_temp=${TEMP_PRIORIDAD}`)

  // 5. Despachar pipeline pesado en background (no bloquear respuesta HTTP)
  setImmediate(() => {
    runMlAnalysis(incidentId, { buffer, image }).catch((err) => {
      console.error(`[image-service] Error no controlado en runMlAnalysis incident=${incidentId}:`, err.message)
    })
  })

  // 6. Respuesta inmediata para polling
  return {
    httpStatus: 202,
    task_id: incidentId,
    estado: "PROCESANDO",
    message: "Imagen recibida. El análisis está en progreso.",
    poll_url: `/api/image/status/${incidentId}`,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// getTaskStatus — Polling para obtener estado del incidente
// ──────────────────────────────────────────────────────────────────────────────

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
    [taskId, userId]
  )

  if (!rows.length) {
    throw createHttpError("Tarea no encontrada.", 404)
  }

  const row = rows[0]

  // Incidente aún en procesamiento
  if (row.estado === "PROCESANDO") {
    return {
      httpStatus: 202,
      task_id: row.id,
      estado: "PROCESANDO",
      message: "En proceso, vuelve a consultar en unos segundos.",
    }
  }

  // Incidente fallido (sin residuos detectados o error)
  if (row.estado === "FALLIDO") {
    return {
      httpStatus: 200,
      task_id: row.id,
      estado: "FALLIDO",
      message: "No se detectaron residuos en la imagen o el análisis falló. Intenta con otra foto.",
    }
  }

  // Incidente completado exitosamente (PENDIENTE, EN_ATENCION, RESUELTA, RECHAZADA)
  return {
    httpStatus: 200,
    task_id: row.id,
    estado: row.estado,
    incident_id: row.id,
    prioridad: row.prioridad,
    descripcion: row.descripcion,
    latitud: row.latitud,
    longitud: row.longitud,
    image_url: row.image_url,
    nivel_acumulacion: row.nivel_acumulacion,
    volumen_estimado_m3: row.volumen_estimado_m3,
    tipo_residuo: row.tipo_residuo,
    confianza: row.confianza,
    tiempo_inferencia_ms: row.tiempo_inferencia_ms,
    num_detecciones: row.num_detecciones,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// recoverStaleIncidents — Recuperación de incidentes huérfanos
// ──────────────────────────────────────────────────────────────────────────────
//
// Marca como FALLIDO cualquier incidente en estado PROCESANDO que tenga más de
// 10 minutos de antigüedad (el proceso que lo procesaba probablemente murió).
// Llamar una vez al arrancar el servicio.

export async function recoverStaleIncidents() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE incidents.incidents
       SET estado = 'FALLIDO', 
           nota_fallo = 'Proceso interrumpido — recuperación en arranque', 
           updated_at = NOW()
       WHERE estado = 'PROCESANDO' AND updated_at < NOW() - INTERVAL '10 minutes'`
    )
    if (rowCount > 0) {
      console.warn(`[image-service] recoverStaleIncidents: ${rowCount} incidente(s) marcados como FALLIDO`)
    }
  } catch (err) {
    console.error("[image-service] recoverStaleIncidents error:", err.message)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// getMyIncidents — Handler legacy para historial de ciudadano
// ──────────────────────────────────────────────────────────────────────────────

export const getMyIncidents = async (req, res) => {
  const userId = req.headers["x-user-id"]
  
  if (!userId) {
    return res.status(401).json({ error: "No se pudo identificar al usuario." })
  }

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
      [userId]
    )
    
    return res.json({ incidents: rows })
  } catch (err) {
    console.error("[image-service] getMyIncidents error:", err.message)
    return res.status(500).json({ error: "Error al obtener el historial de incidentes." })
  }
}