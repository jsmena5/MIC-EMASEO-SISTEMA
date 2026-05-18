import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { v4 as uuidv4 } from "uuid"
import retry from "async-retry"
import { pool } from "../db.js"
import { mlBreaker, ML_DEGRADED_CODE, pollMlTask, checkMlTaskStatus, POLL_TIMEOUT_MS } from "../mlCircuitBreaker.js"
import { MIN_FILE_BYTES, MIN_SIDE_PX, getImageDimensions, validateImageBufferDeep } from "../utils/imageValidation.js"
export { validateImageBuffer, validateImageBufferDeep } from "../utils/imageValidation.js"

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

const BUCKET        = process.env.S3_BUCKET      ?? "emaseo-incidents"
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
  region:   process.env.S3_REGION ?? "us-east-1",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ──────────────────────────────────────────────────────────────────────────────

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

function createHttpError(message, httpStatus, cause = null) {
  const error = new Error(message)
  error.httpStatus = httpStatus
  if (cause) error.cause = cause
  return error
}

// Marca el incidente como FALLIDO y limpia columnas temporales de async-ML.
async function markIncidentAsFailed(incidentId, reason, logError) {
  try {
    await pool.query(
      `UPDATE incidents.incidents
       SET estado         = 'FALLIDO',
           nota_fallo     = $2,
           celery_task_id = NULL,
           pending_s3_key = NULL,
           updated_at     = NOW()
       WHERE id = $1`,
      [incidentId, reason]
    )
  } catch (dbErr) {
    logError(`No se pudo marcar como FALLIDO: ${dbErr.message}`)
  }
}

// Sube la imagen a S3 y guarda la clave en pending_s3_key para que
// recoverCeleryTasks() pueda referenciarla si el polling se interrumpe.
async function uploadPendingImage(incidentId, buffer, logError) {
  const s3Key = `incidents/${uuidv4()}.jpg`
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    Body:        buffer,
    ContentType: "image/jpeg",
  }))
  await pool.query(
    `UPDATE incidents.incidents SET pending_s3_key = $2 WHERE id = $1`,
    [incidentId, s3Key]
  )
  return s3Key
}

// Elimina la imagen pendiente de S3 y borra pending_s3_key en BD.
// Llamar en cualquier rama de fallo que ocurra después de uploadPendingImage.
async function cleanupPendingS3(incidentId, s3Key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key })).catch(() => {})
  await pool.query(
    `UPDATE incidents.incidents SET pending_s3_key = NULL WHERE id = $1`,
    [incidentId]
  ).catch(() => {})
}

// ──────────────────────────────────────────────────────────────────────────────
// finalizeIncident — transacción atómica de cierre
// ──────────────────────────────────────────────────────────────────────────────
//
// Transiciona el incidente de PROCESANDO → PENDIENTE, registra la imagen en
// incident_images y guarda el resultado IA en ai.analysis_results.
// Usado tanto en el flujo principal como en recoverCeleryTasks().
//
// Si el incidente ya no está en PROCESANDO (race con otro proceso) cancela
// silenciosamente sin error; eso es el comportamiento correcto.

async function finalizeIncident(incidentId, s3Key, mlResult, logError) {
  const imageUrl = `${S3_PUBLIC_URL}/${BUCKET}/${s3Key}`

  await retry(
    async () => {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const { rows: updRows, rowCount: updCount } = await client.query(
          `UPDATE incidents.incidents
           SET estado         = 'PENDIENTE',
               prioridad      = $2,
               celery_task_id = NULL,
               pending_s3_key = NULL,
               updated_at     = NOW()
           WHERE id = $1 AND estado = 'PROCESANDO'
           RETURNING created_at`,
          [incidentId, mlResult.prioridad]
        )

        if (updCount === 0) {
          await client.query("ROLLBACK")
          logError("Incidente ya no está en PROCESANDO — descartando resultado ML (race con otro proceso)")
          return
        }

        const incidentCreatedAt = updRows[0].created_at

        await client.query(
          `INSERT INTO incidents.incident_images
             (incident_id, incident_created_at, image_url, es_principal)
           VALUES ($1, $2, $3, TRUE)`,
          [incidentId, incidentCreatedAt, imageUrl]
        )

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
      } catch (dbErr) {
        await client.query("ROLLBACK").catch(() => {})
        throw dbErr
      } finally {
        client.release()
      }
    },
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) => logError(`DB finalizeIncident retry ${attempt}: ${err.message}`),
    }
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// runMlAnalysis — Pipeline principal en background
// ──────────────────────────────────────────────────────────────────────────────
//
// Flujo asíncrono (desacoplado del CB):
//   1. Health check del servicio ML
//   2. Upload de imagen a S3 → guarda pending_s3_key en BD
//   3. Submit de la tarea al ML vía CB → guarda celery_task_id en BD
//   4. Polling del resultado (fuera del CB, presupuesto 120 s)
//      • Timeout → deja PROCESANDO para recoverCeleryTasks()
//      • Fallo duro → limpia S3 y marca FALLIDO
//   5. has_waste=false → limpia S3 y marca FALLIDO
//   6. Éxito → finalizeIncident (transacción atómica)

async function runMlAnalysis(incidentId, { buffer, image }) {
  const log      = (msg) => console.log(`[image-service] [incident=${incidentId}] ${msg}`)
  const logError = (msg) => console.error(`[image-service] [incident=${incidentId}] ${msg}`)

  try {
    // 1. Health check (3 s timeout)
    log("Verificando salud del servicio ML...")
    try {
      await checkMlHealth()
      log("✓ Health check OK")
    } catch (err) {
      await markIncidentAsFailed(incidentId, `health check: ${err.cause?.message ?? err.message}`, logError)
      logError("✗ FALLIDO — Servicio ML no disponible")
      return
    }

    // 2. Upload imagen a S3 antes de invocar al ML.
    //    Esto permite que recoverCeleryTasks() complete el incidente si el polling
    //    muere antes de que el worker termine la inferencia.
    log("Subiendo imagen a S3 (pending)...")
    let pendingS3Key
    try {
      pendingS3Key = await uploadPendingImage(incidentId, buffer, logError)
      log(`✓ Imagen subida: key=${pendingS3Key}`)
    } catch (err) {
      await markIncidentAsFailed(incidentId, `upload S3: ${err.message}`, logError)
      logError(`✗ FALLIDO — Error al subir imagen: ${err.message}`)
      return
    }

    // 3. Submit de la tarea al ML vía Circuit Breaker (solo el POST, ~1-5 s)
    log("Enviando tarea al servicio ML...")
    let celeryTaskId
    try {
      const dims = getImageDimensions(buffer)
      const { task_id } = await mlBreaker.fire({
        image_base64: image,
        image_width:  dims?.width  ?? 0,
        image_height: dims?.height ?? 0,
      })
      celeryTaskId = task_id

      // Persistir task_id inmediatamente; si muere el proceso, recoverCeleryTasks
      // puede re-asumir este incidente.
      await pool.query(
        `UPDATE incidents.incidents SET celery_task_id = $2 WHERE id = $1`,
        [incidentId, celeryTaskId]
      )
      log(`✓ Tarea enviada — celery_task_id=${celeryTaskId}`)
    } catch (err) {
      await cleanupPendingS3(incidentId, pendingS3Key)
      const reason = err.code === ML_DEGRADED_CODE
        ? `circuit breaker abierto: ${err.message}`
        : `ML submit: ${err.message}`
      await markIncidentAsFailed(incidentId, reason, logError)
      logError(`✗ FALLIDO — ${reason}`)
      return
    }

    // 4. Polling del resultado fuera del CB (120 s de presupuesto)
    //    Un timeout aquí NO indica que el servicio esté degradado — solo que la
    //    inferencia tardó más de lo esperado. No se abre el circuito.
    log(`Esperando resultado de celery_task_id=${celeryTaskId}...`)
    let mlResult
    try {
      mlResult = await pollMlTask(celeryTaskId)
      log(`✓ ML result — has_waste=${mlResult.has_waste}, nivel=${mlResult.nivel_acumulacion}, t=${mlResult.tiempo_inferencia_ms}ms`)
    } catch (err) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError"
      if (isTimeout) {
        // El worker Celery sigue corriendo. Dejar PROCESANDO para que
        // recoverCeleryTasks() complete el incidente cuando el worker termine.
        log(`⏳ Polling timeout — celery_task_id=${celeryTaskId} queda en PROCESANDO para recovery automático`)
        return
      }
      // Fallo duro del ML (status "failed") — limpiar y marcar FALLIDO
      await cleanupPendingS3(incidentId, pendingS3Key)
      await markIncidentAsFailed(incidentId, `ML polling: ${err.message}`, logError)
      logError(`✗ FALLIDO — ${err.message}`)
      return
    }

    // 5. Validar detección de residuos
    if (!mlResult.has_waste) {
      await cleanupPendingS3(incidentId, pendingS3Key)
      await markIncidentAsFailed(incidentId, "ML no detectó residuos en la imagen", logError)
      logError("✗ FALLIDO — No se detectaron residuos")
      return
    }

    // 6. Transacción atómica de cierre
    try {
      await finalizeIncident(incidentId, pendingS3Key, mlResult, logError)
      log(`✓ Incidente finalizado — PENDIENTE prioridad=${mlResult.prioridad}`)
    } catch (dbErr) {
      await cleanupPendingS3(incidentId, pendingS3Key)
      await markIncidentAsFailed(incidentId, `DB transaction: ${dbErr.message}`, logError)
      logError(`✗ FALLIDO — Error en transacción DB: ${dbErr.message}`)
    }
  } catch (err) {
    logError(`✗ Error no controlado: ${err.message}`)
    await markIncidentAsFailed(incidentId, `error no controlado: ${err.message}`, logError)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// analyzeImage — Endpoint principal
// ──────────────────────────────────────────────────────────────────────────────

export async function analyzeImage({ image, latitude, longitude, descripcion = "", direccion = "", ubicacion_aproximada = false, userId }) {

  if (!image) {
    throw createHttpError("El campo 'image' (base64) es requerido.", 400)
  }
  if (latitude === undefined || longitude === undefined) {
    throw createHttpError("Los campos 'latitude' y 'longitude' son requeridos.", 400)
  }
  if (!userId) {
    throw createHttpError("No se pudo identificar al usuario. Token inválido o ausente.", 401)
  }

  if (!isValidEcuadorLocation(latitude, longitude)) {
    throw createHttpError(
      "No se pudo obtener tu ubicación GPS en Ecuador. Activa el GPS e intenta de nuevo.",
      422
    )
  }

  if (image.length > 10 * 1024 * 1024) {
    throw createHttpError("La imagen excede el tamaño máximo permitido (10 MB en base64).", 413)
  }

  let buffer
  try {
    buffer = Buffer.from(image, "base64")
  } catch {
    throw createHttpError("Imagen base64 inválida o corrupta.", 400)
  }

  const validation = await validateImageBufferDeep(buffer)
  if (!validation.valid) {
    throw createHttpError(validation.message, 422)
  }

  const lat = Number(latitude)
  const lon = Number(longitude)

  const { rows } = await retry(
    () => pool.query(
      `INSERT INTO incidents.incidents
       (reportado_por, descripcion, ubicacion, direccion, estado, prioridad, ubicacion_aproximada)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, 'PROCESANDO', $6, $7)
       RETURNING id`,
      [userId, descripcion || null, lon, lat, direccion || null, TEMP_PRIORIDAD, ubicacion_aproximada]
    ),
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) =>
        console.warn(`[image-service] INSERT incidents retry ${attempt}: ${err.message}`),
    }
  )

  const incidentId = rows[0].id
  console.log(`[image-service] ✅ Incidente creado id=${incidentId} estado=PROCESANDO prioridad_temp=${TEMP_PRIORIDAD}`)

  setImmediate(() => {
    runMlAnalysis(incidentId, { buffer, image }).catch((err) => {
      console.error(`[image-service] Error no controlado en runMlAnalysis incident=${incidentId}:`, err.message)
    })
  })

  return {
    httpStatus: 202,
    task_id:   incidentId,
    estado:    "PROCESANDO",
    message:   "Imagen recibida. El análisis está en progreso.",
    poll_url:  `/api/image/status/${incidentId}`,
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

// ──────────────────────────────────────────────────────────────────────────────
// recoverStaleIncidents — Recuperación en arranque (sin celery_task_id)
// ──────────────────────────────────────────────────────────────────────────────
//
// Solo marca FALLIDO incidentes que nunca llegaron a enviar la tarea al ML
// (celery_task_id IS NULL). Los incidentes con celery_task_id son gestionados
// por recoverCeleryTasks() y NO deben tocarse aquí.

export async function recoverStaleIncidents() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE incidents.incidents
       SET estado     = 'FALLIDO',
           nota_fallo = 'Proceso interrumpido — recuperación en arranque',
           updated_at = NOW()
       WHERE estado          = 'PROCESANDO'
         AND celery_task_id  IS NULL
         AND updated_at      < NOW() - INTERVAL '10 minutes'`
    )
    if (rowCount > 0) {
      console.warn(`[image-service] recoverStaleIncidents: ${rowCount} incidente(s) sin task_id marcados como FALLIDO`)
    }
  } catch (err) {
    console.error("[image-service] recoverStaleIncidents error:", err.message)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// recoverCeleryTasks — Recuperación periódica de tareas Celery huérfanas
// ──────────────────────────────────────────────────────────────────────────────
//
// Consulta incidentes PROCESANDO que tienen celery_task_id y pending_s3_key
// (imagen ya en S3 esperando resultado ML). Para cada uno hace una comprobación
// puntual del estado Celery:
//   • completed  → finalizeIncident (transición PENDIENTE)
//   • failed     → cleanupPendingS3 + markIncidentAsFailed
//   • pending/processing → no hacer nada (próxima iteración)
//
// Solo aplica a incidentes con más de 2 minutos de antigüedad (updated_at)
// para evitar colisiones con runMlAnalysis en curso.
//
// Llamar en startup y cada 30 s desde index.js.

export async function recoverCeleryTasks() {
  let rows
  try {
    const result = await pool.query(
      `SELECT id, celery_task_id, pending_s3_key
       FROM incidents.incidents
       WHERE estado          = 'PROCESANDO'
         AND celery_task_id  IS NOT NULL
         AND pending_s3_key  IS NOT NULL
         AND updated_at      < NOW() - INTERVAL '2 minutes'`
    )
    rows = result.rows
  } catch (err) {
    console.error("[image-service] recoverCeleryTasks query error:", err.message)
    return
  }

  if (!rows.length) return

  console.log(`[image-service] recoverCeleryTasks: revisando ${rows.length} tarea(s) Celery pendiente(s)`)

  for (const { id: incidentId, celery_task_id, pending_s3_key } of rows) {
    const log      = (msg) => console.log(`[image-service] [recovery=${incidentId}] ${msg}`)
    const logError = (msg) => console.error(`[image-service] [recovery=${incidentId}] ${msg}`)

    try {
      const { status, result, error } = await checkMlTaskStatus(celery_task_id)

      if (status === "pending" || status === "processing") {
        log(`Tarea Celery aún en progreso (${status}) — próxima iteración`)
        continue
      }

      if (status === "failed") {
        logError(`Tarea Celery FALLIDA: ${error ?? "unknown"}`)
        await cleanupPendingS3(incidentId, pending_s3_key)
        await markIncidentAsFailed(
          incidentId,
          `recovery: ML inference failed: ${error ?? "unknown"}`,
          logError
        )
        continue
      }

      if (status === "completed") {
        if (!result.has_waste) {
          log("ML recuperado — sin residuos detectados")
          await cleanupPendingS3(incidentId, pending_s3_key)
          await markIncidentAsFailed(incidentId, "recovery: ML no detectó residuos en la imagen", logError)
          continue
        }
        await finalizeIncident(incidentId, pending_s3_key, result, logError)
        log(`✓ Incidente recuperado exitosamente — PENDIENTE prioridad=${result.prioridad}`)
        continue
      }

      logError(`Estado Celery desconocido: '${status}' — se reintentará en próxima iteración`)
    } catch (err) {
      logError(`Error en recovery check: ${err.message} — se reintentará en próxima iteración`)
    }
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

  const rawPage  = parseInt(req.query.page,  10)
  const rawLimit = parseInt(req.query.limit, 10)
  const page   = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage                : 1
  const limit  = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20
  const offset = (page - 1) * limit

  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
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
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM incidents.incidents WHERE reportado_por = $1`,
        [userId]
      ),
    ])

    const total = parseInt(countRows[0].total, 10)
    const pages = Math.ceil(total / limit)

    return res.json({
      incidents:  rows,
      pagination: { page, limit, total, pages },
    })
  } catch (err) {
    console.error("[image-service] getMyIncidents error:", err.message)
    return res.status(500).json({ error: "Error al obtener el historial de incidentes." })
  }
}
