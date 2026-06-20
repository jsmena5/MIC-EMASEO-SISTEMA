import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { v4 as uuidv4 } from "uuid"
import retry from "async-retry"
import { pool } from "../db.js"
import { mlBreaker, ML_DEGRADED_CODE, pollMlTask, checkMlTaskStatus} from "../mlCircuitBreaker.js"
import { getImageDimensions, validateImageBufferDeep } from "../utils/imageValidation.js"
export { validateImageBuffer, validateImageBufferDeep } from "../utils/imageValidation.js"

// ──────────────────────────────────────────────────────────────────────────────
// Constantes y configuración
// ──────────────────────────────────────────────────────────────────────────────

const DB_RETRY_OPTS = {
  retries: 3,
  factor: 2,
  minTimeout: 500
}

// La validación de variables obligatorias vive en index.js (entry point real),
// no aquí, para que los tests puedan importar este módulo sin reventar el runner.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL
const ML_HEALTH_URL  = ML_SERVICE_URL ? `${new URL(ML_SERVICE_URL).origin}/health` : undefined

const BUCKET        = process.env.S3_BUCKET
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL

// Límites geográficos de Ecuador (WGS84)
const ECUADOR_BBOX = {
  lat: { min: -5.02, max: 1.45 },
  lon: { min: -92.01, max: -75.18 }
}

// Valor temporal para prioridad mientras el ML procesa
const TEMP_PRIORIDAD = 'BAJA'

// Umbral de confianza para rechazo automático confiable.
// Si confianza del ML < umbral → EN_REVISION (caso ambiguo, requiere supervisor).
// Si confianza del ML ≥ umbral → DESCARTADO (rechazo automático confiable).
// Configurable vía variable de entorno; por defecto 0.70 (70%).
const AUTO_REJECT_CONFIDENCE = Number.parseFloat(process.env.ML_AUTO_REJECT_CONFIDENCE ?? "0.70")

// Techos de volumen por nivel (en m³) — deben estar en sync con _BANDS de
// Backend/ml-service/ml_utils.py. Sirven para detectar inconsistencias volumen/nivel
// (p.ej. MiDaS infla el volumen pero la banda dice MEDIO). Si volumen > techo×tolerancia
// el incidente se marca EN_REVISION en lugar de PENDIENTE para que el supervisor lo valide.
// Actualizados (2026-06-10) al subir las bandas de volumen (ALTO 1.3–1.9, CRÍTICO 1.9–6.0).
// Con el clamp medir+acotar de tasks.py el volumen ya nunca excede vol_max de su banda,
// así que este chequeo queda como segunda red de seguridad (debe coincidir con vol_max).
const VOLUME_CEILING_BY_NIVEL = { BAJO: 0.5, MEDIO: 1.3, ALTO: 1.9, CRITICO: 6 }
const VOLUME_COHERENCE_TOLERANCE = 1.1  // +10% sobre el techo

// Formato UUID (cualquier versión) para validar la clave de idempotencia del
// cliente. Una clave malformada se ignora y el reporte se trata como sin clave.
const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) return false
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

// ──────────────────────────────────────────────────────────────────────────────
// markIncidentAsFailed
// ──────────────────────────────────────────────────────────────────────────────
//
// Marca el incidente como FALLIDO (error técnico real).
// Opciones:
//   s3Key             — Si ya había imagen en S3, la conserva como evidencia de auditoría.
//                       NOTA: ya no se borra S3; la imagen queda como imagen_auditoria_url.
//   decisionAutomatica — Código estructurado de la razón de fallo (siempre ERROR_TECNICO aquí).

async function markIncidentAsFailed(incidentId, reason, logError, { s3Key = null, decisionAutomatica = "ERROR_TECNICO" } = {}) {
  const imageUrl = s3Key ? `${S3_PUBLIC_URL}/${s3Key}` : null
  try {
    await pool.query(
      `UPDATE incidents.incidents
       SET estado                = 'FALLIDO',
           nota_fallo            = $2,
           decision_automatica   = $3,
           imagen_auditoria_url  = COALESCE($4, imagen_auditoria_url),
           celery_task_id        = NULL,
           pending_s3_key        = NULL,
           updated_at            = NOW()
       WHERE id = $1`,
      [incidentId, reason, decisionAutomatica, imageUrl]
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

// ──────────────────────────────────────────────────────────────────────────────
// finalizeIncident — transacción atómica de cierre para incidentes válidos
// ──────────────────────────────────────────────────────────────────────────────
//
// Transiciona el incidente de PROCESANDO → PENDIENTE, registra la imagen en
// incident_images y guarda el resultado IA en ai.analysis_results.
// Usado tanto en el flujo principal como en recoverCeleryTasks().
//
// Si el incidente ya no está en PROCESANDO (race con otro proceso) cancela
// silenciosamente sin error; eso es el comportamiento correcto.

async function finalizeIncident(incidentId, s3Key, mlResult, logError) {
  const imageUrl = `${S3_PUBLIC_URL}/${s3Key}`

  await retry(
    async () => {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const { rows: updRows, rowCount: updCount } = await client.query(
          `UPDATE incidents.incidents
           SET estado               = 'PENDIENTE',
               prioridad            = $2,
               decision_automatica  = 'INCIDENTE_VALIDO',
               celery_task_id       = NULL,
               pending_s3_key       = NULL,
               updated_at           = NOW()
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
            // Constraint chk_inferencia_positiva: NULL o > 0 (nunca 0)
            mlResult.tiempo_inferencia_ms > 0 ? mlResult.tiempo_inferencia_ms : null,
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
// finalizeNegativeCase — cierre para casos where has_waste=false
// ──────────────────────────────────────────────────────────────────────────────
//
// Lógica de ramificación según confianza del ML:
//   confianza ≥ AUTO_REJECT_CONFIDENCE → DESCARTADO + RECHAZO_CONFIABLE
//   confianza < AUTO_REJECT_CONFIDENCE → EN_REVISION + REVISION_REQUERIDA
//   confianza == null                  → EN_REVISION + REVISION_REQUERIDA (conservador)
//
// La imagen SIEMPRE se conserva en S3 (ya no se elimina).
// Los metadatos ML se guardan en ai.analysis_results para trazabilidad completa.
// Permite que el supervisor vea la imagen y los datos aunque la decisión sea negativa.

async function finalizeNegativeCase(incidentId, s3Key, mlResult, logError) {
  const confianza   = mlResult.confianza ?? null
  const isAmbiguous = confianza === null || confianza < AUTO_REJECT_CONFIDENCE
  const nuevoEstado = isAmbiguous ? "PENDIENTE" : "DESCARTADO"
  const decision    = isAmbiguous ? "REVISION_REQUERIDA" : "RECHAZO_CONFIABLE"
  const imageUrl    = `${S3_PUBLIC_URL}/${s3Key}`
  // Construir nota de auditoría con toda la info disponible de los gates
  const motivoBase = mlResult.rechazo_motivo
    ? `motivo: ${mlResult.rechazo_motivo}`
    : "ML no detectó residuos"
  const motivoLabel = mlResult.semantic_top_label
    ? ` — top_label: ${mlResult.semantic_top_label}`
    : ""
  const motivoConf = confianza === null
    ? " (confianza no disponible)"
    : ` (confianza: ${(confianza * 100).toFixed(1)} %)`
  const notaFallo = `${motivoBase}${motivoLabel}${motivoConf}`

  await retry(
    async () => {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        // Transición PROCESANDO → PENDIENTE | DESCARTADO
        const { rowCount } = await client.query(
          `UPDATE incidents.incidents
           SET estado                = $2,
               decision_automatica   = $3,
               confianza_decision    = $4,
               imagen_auditoria_url  = $5,
               nota_fallo            = $6,
               celery_task_id        = NULL,
               pending_s3_key        = NULL,
               updated_at            = NOW()
           WHERE id = $1 AND estado = 'PROCESANDO'`,
          [incidentId, nuevoEstado, decision, confianza, imageUrl, notaFallo]
        )

        if (rowCount === 0) {
          await client.query("ROLLBACK")
          logError("Incidente ya no está en PROCESANDO — descartando resultado ML negativo (race condition)")
          return
        }

        // Guardar resultado ML parcial en ai.analysis_results para trazabilidad.
        // tipo_residuo y nivel_acumulacion son nullable desde la migración 032,
        // por lo que los resultados negativos son igualmente válidos para auditoría.
        if (mlResult.modelo_nombre) {
          await client.query(
            `INSERT INTO ai.analysis_results
               (incident_id, incident_created_at, modelo_nombre,
                tipo_residuo, nivel_acumulacion,
                volumen_estimado_m3, confianza, detecciones, tiempo_inferencia_ms)
             SELECT $1, i.created_at, $2,
                    CASE WHEN $3::text IS NOT NULL THEN $3::ai.waste_type      END,
                    CASE WHEN $4::text IS NOT NULL THEN $4::ai.accumulation_level END,
                    $5, $6, $7::jsonb, $8
             FROM incidents.incidents i
             WHERE i.id = $1
             ON CONFLICT (incident_id) DO NOTHING`,
            [
              incidentId,
              mlResult.modelo_nombre,
              mlResult.tipo_residuo       ?? null,
              mlResult.nivel_acumulacion  ?? null,
              mlResult.volumen_estimado_m3 ?? null,
              confianza ?? 0,
              JSON.stringify(mlResult.detecciones ?? []),
              // El constraint chk_inferencia_positiva exige NULL o > 0. El ML
              // devuelve 0 cuando rechaza temprano (p. ej. blur), así que
              // normalizamos 0 → NULL para no violar el constraint.
              mlResult.tiempo_inferencia_ms > 0 ? mlResult.tiempo_inferencia_ms : null,
            ]
          )
        }

        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) => logError(`DB finalizeNegativeCase retry ${attempt}: ${err.message}`),
    }
  )

  return { nuevoEstado, imageUrl }
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
//      • Fallo duro → imagen se conserva en S3 como auditoría, marca FALLIDO (ERROR_TECNICO)
//   5. has_waste=false → finalizeNegativeCase:
//      • confianza ≥ umbral → DESCARTADO (imagen conservada en S3)
//      • confianza < umbral → EN_REVISION (imagen conservada en S3)
//   6. has_waste=true → finalizeIncident (transacción atómica, PENDIENTE)
//
// IMPORTANTE: Las imágenes ya subidas a S3 NUNCA se eliminan.
// Se conservan siempre como imagen_auditoria_url para auditoría de decisiones.

// Cierra el incidente como caso negativo (DESCARTADO/EN_REVISION) vía finalizeNegativeCase.
// Centraliza el try/catch repetido de los pasos 5-7: si el guardado en BD falla, cae a
// FALLIDO técnico conservando la imagen en S3. Devuelve el resultado de finalizeNegativeCase,
// o null si hubo fallo (el incidente ya quedó marcado como FALLIDO).
async function tryFinalizeNegative(incidentId, pendingS3Key, mlResultLike, logError, failLabel) {
  try {
    return await finalizeNegativeCase(incidentId, pendingS3Key, mlResultLike, logError)
  } catch (dbErr) {
    await markIncidentAsFailed(incidentId, `${failLabel}: ${dbErr.message}`, logError, { s3Key: pendingS3Key })
    logError(`✗ FALLIDO — ${failLabel}: ${dbErr.message}`)
    return null
  }
}

// Pasos 1-3 del pipeline: health check ML, subida de la imagen a S3 y submit de la
// tarea vía Circuit Breaker. Si algo falla, marca el incidente como FALLIDO y devuelve
// null. En éxito devuelve { pendingS3Key, celeryTaskId }.
async function prepareMlTask(incidentId, { buffer, image, client_coverage_ratio }, log, logError) {
  // 1. Health check (3 s timeout)
  log("Verificando salud del servicio ML...")
  try {
    await checkMlHealth()
    log("✓ Health check OK")
  } catch (err) {
    await markIncidentAsFailed(incidentId, `health check: ${err.cause?.message ?? err.message}`, logError)
    logError("✗ FALLIDO — Servicio ML no disponible")
    return null
  }

  // 2. Upload imagen a S3 antes de invocar al ML. Permite que recoverCeleryTasks()
  //    complete el incidente si el polling muere antes de que el worker termine.
  log("Subiendo imagen a S3 (pending)...")
  let pendingS3Key
  try {
    pendingS3Key = await uploadPendingImage(incidentId, buffer, logError)
    log(`✓ Imagen subida: key=${pendingS3Key}`)
  } catch (err) {
    await markIncidentAsFailed(incidentId, `upload S3: ${err.message}`, logError)
    logError(`✗ FALLIDO — Error al subir imagen: ${err.message}`)
    return null
  }

  // 3. Submit de la tarea al ML vía Circuit Breaker (solo el envío, ~1-5 s)
  log("Enviando tarea al servicio ML (gRPC)...")
  try {
    const dims = getImageDimensions(buffer)
    // Enviamos la s3_key al ml-service en lugar del Base64 completo.
    // El worker Celery descarga la imagen directamente desde S3/R2.
    // Esto elimina el cuello de botella de transferir ~10 MB por la red interna.
    const mlPayload = {
      s3_key:       pendingS3Key,
      image_width:  dims?.width  ?? 0,
      image_height: dims?.height ?? 0,
    }
    if (client_coverage_ratio !== undefined) {
      mlPayload.client_coverage_ratio = client_coverage_ratio
    }
    const { task_id } = await mlBreaker.fire(mlPayload)

    // Persistir task_id inmediatamente; si muere el proceso, recoverCeleryTasks
    // puede re-asumir este incidente.
    await pool.query(
      `UPDATE incidents.incidents SET celery_task_id = $2 WHERE id = $1`,
      [incidentId, task_id]
    )
    log(`✓ Tarea enviada vía gRPC — celery_task_id=${task_id}`)
    return { pendingS3Key, celeryTaskId: task_id }
  } catch (err) {
    // Imagen ya en S3 → se conserva como auditoría (no se elimina)
    const reason = err.code === ML_DEGRADED_CODE
      ? `circuit breaker abierto: ${err.message}`
      : `ML submit (gRPC): ${err.message}`
    await markIncidentAsFailed(incidentId, reason, logError, { s3Key: pendingS3Key })
    logError(`✗ FALLIDO — ${reason}`)
    return null
  }
}

async function runMlAnalysis(incidentId, { buffer, image, client_coverage_ratio }) {
  const log      = (msg) => console.log(`[image-service] [incident=${incidentId}] ${msg}`)
  const logError = (msg) => console.error(`[image-service] [incident=${incidentId}] ${msg}`)

  try {
    // Pasos 1-3: health check + subida S3 + submit ML (marca FALLIDO y null si fallan)
    const prep = await prepareMlTask(incidentId, { buffer, image, client_coverage_ratio }, log, logError)
    if (!prep) return
    const { pendingS3Key, celeryTaskId } = prep

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
      // Fallo duro del ML (status "failed") — imagen ya en S3, se conserva como auditoría
      await markIncidentAsFailed(incidentId, `ML polling: ${err.message}`, logError, { s3Key: pendingS3Key })
      logError(`✗ FALLIDO — ${err.message}`)
      return
    }

    // 5. Validar detección de residuos
    //    has_waste=false → NO siempre es FALLIDO. Según la confianza del ML:
    //      • confianza ≥ AUTO_REJECT_CONFIDENCE → DESCARTADO (rechazo confiable)
    //      • confianza < AUTO_REJECT_CONFIDENCE → EN_REVISION (caso ambiguo, supervisor decide)
    //    La imagen SIEMPRE se conserva en S3 para auditoría.
    if (!mlResult.has_waste) {
      const neg = await tryFinalizeNegative(incidentId, pendingS3Key, mlResult, logError, "error al registrar resultado negativo")
      if (neg) log(`⚠ Sin residuos detectados — estado=${neg.nuevoEstado} confianza=${mlResult.confianza ?? "N/A"}`)
      return
    }

    // 6. Sanity-check de coherencia volumen/nivel
    //    Si el ML dice BAJO/MEDIO pero el volumen excede el techo de su banda,
    //    es señal de inconsistencia (típicamente MiDaS inflando vol en interiores).
    //    Se trata como caso ambiguo (EN_REVISION) para que el supervisor lo valide,
    //    no se acepta directo como PENDIENTE.
    const ceiling = VOLUME_CEILING_BY_NIVEL[mlResult.nivel_acumulacion]
    const volume  = mlResult.volumen_estimado_m3 ?? 0
    if (ceiling != null && volume > ceiling * VOLUME_COHERENCE_TOLERANCE) {
      log(`⚠ Incoherencia vol/nivel: ${volume}m³ excede techo de ${mlResult.nivel_acumulacion} (${ceiling}m³) → EN_REVISION`)
      // Fuerza EN_REVISION (no DESCARTADO) bajando la confianza al límite del auto-reject.
      // Reusa finalizeNegativeCase para mantener un solo punto de cierre negativo.
      await tryFinalizeNegative(incidentId, pendingS3Key, {
        ...mlResult,
        has_waste: false,
        confianza: Math.min(mlResult.confianza ?? 0, AUTO_REJECT_CONFIDENCE - 0.01),
        rechazo_motivo: "volume_nivel_incoherence",
      }, logError, "coherence-check")
      return
    }

    // 7. Gate semántico CLIP: el ML marcó has_waste=true pero con ambigüedad semántica.
    //    requiere_revision=true significa que CLIP no pudo confirmar que sea basura real
    //    (zona gris: podría ser personas + basura, escena compleja, etc.).
    //    En ese caso se ruta a EN_REVISION para que un supervisor valide la decisión,
    //    sin publicar ninguna prioridad automática. Se completa la clasificación por
    //    bandas igual para que el supervisor tenga contexto (nivel, volumen).
    if (mlResult.requiere_revision === true) {
      const motivo = mlResult.rechazo_motivo ?? "verificacion_semantica_ambigua"
      log(`⚠ Gate semántico (CLIP) ambiguo: requiere_revision=true motivo=${motivo} → EN_REVISION`)
      const rev = await tryFinalizeNegative(incidentId, pendingS3Key, {
        ...mlResult,
        has_waste: false,
        // Forzar EN_REVISION (no DESCARTADO): confianza justo bajo el umbral de auto-rechazo
        confianza: Math.min(mlResult.confianza ?? 0, AUTO_REJECT_CONFIDENCE - 0.01),
        rechazo_motivo: motivo,
      }, logError, "semantic-gate-revision")
      if (rev) log(`⚠ Incidente marcado EN_REVISION por gate semántico`)
      return
    }

    // 8. Transacción atómica de cierre (incidente válido → PENDIENTE)
    //    Solo llegamos aquí si has_waste=true Y CLIP confirmó basura real.
    try {
      await finalizeIncident(incidentId, pendingS3Key, mlResult, logError)
      log(`✓ Incidente finalizado — PENDIENTE prioridad=${mlResult.prioridad}`)
    } catch (dbErr) {
      // Imagen ya en S3, se conserva como auditoría
      await markIncidentAsFailed(incidentId, `DB transaction: ${dbErr.message}`, logError, { s3Key: pendingS3Key })
      logError(`✗ FALLIDO — Error en transacción DB: ${dbErr.message}`)
    }
  } catch (err) {
    logError(`✗ Error no controlado: ${err.message}`)
    await markIncidentAsFailed(incidentId, `error no controlado: ${err.message}`, logError)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Idempotencia — creación de incidente sin duplicados
// ──────────────────────────────────────────────────────────────────────────────
//
// El cliente envía una clave UUID estable entre reintentos del mismo reporte.
// Con red lenta, un POST /analyze puede hacer timeout en el cliente aunque el
// servidor ya haya creado el incidente; el reintento traería la misma clave.
// Sin esto, cada reintento crea un incidente nuevo (duplicado).

function normalizeIdempotencyKey(raw) {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim().toLowerCase()
  return IDEMPOTENCY_KEY_RE.test(trimmed) ? trimmed : null
}

const INSERT_INCIDENT_SQL =
  `INSERT INTO incidents.incidents
   (reportado_por, descripcion, ubicacion, direccion, zona_id, estado, prioridad, ubicacion_aproximada, idempotency_key)
   SELECT $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5,
          COALESCE(
            -- 1) Zona que contiene el punto
            (SELECT id FROM operations.zones
             WHERE ST_Within(ST_SetSRID(ST_MakePoint($3, $4), 4326), geom)
               AND activa = TRUE
             LIMIT 1),
            -- 2) Fallback: zona más cercana (para puntos en bordes o fuera de polígonos)
            (SELECT id FROM operations.zones
             WHERE activa = TRUE
             ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, geom::geography)
             LIMIT 1)
          ),
          'PROCESANDO', $6, $7, $8
   RETURNING id`

// Crea el incidente. Sin clave de idempotencia usa el camino clásico (INSERT
// directo). Con clave, delega en createIncidentIdempotent (transacción + lock).
// Devuelve { incidentId, replay } — replay=true significa que ya existía.
async function createIncident({ userId, descripcion, direccion, lat, lon, ubicacion_aproximada, idempotencyKey }) {
  const insertParams = [userId, descripcion || null, lon, lat, direccion || null, TEMP_PRIORIDAD, ubicacion_aproximada, idempotencyKey]

  if (!idempotencyKey) {
    const { rows } = await retry(
      () => pool.query(INSERT_INCIDENT_SQL, insertParams),
      {
        ...DB_RETRY_OPTS,
        onRetry: (err, attempt) =>
          console.warn(`[image-service] INSERT incidents retry ${attempt}: ${err.message}`),
      }
    )
    return { incidentId: rows[0].id, replay: false }
  }

  return retry(
    () => createIncidentIdempotent(insertParams, userId, idempotencyKey),
    {
      ...DB_RETRY_OPTS,
      onRetry: (err, attempt) =>
        console.warn(`[image-service] INSERT incidents idempotente retry ${attempt}: ${err.message}`),
    }
  )
}

// Transacción que deduplica por (reportado_por, idempotency_key).
//
// pg_advisory_xact_lock serializa los requests concurrentes con la misma clave:
// el segundo espera a que el primero termine su transacción, luego el SELECT ya
// ve el incidente creado → replay. El lock se libera solo al COMMIT/ROLLBACK.
// (La tabla está particionada y no admite un UNIQUE sin created_at — ver
// migración 046 — por eso la unicidad se garantiza con el lock, no con un índice.)
async function createIncidentIdempotent(insertParams, userId, idempotencyKey) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${userId}:${idempotencyKey}`]
    )

    const existing = await client.query(
      `SELECT id FROM incidents.incidents
       WHERE reportado_por = $1 AND idempotency_key = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, idempotencyKey]
    )

    if (existing.rows.length > 0) {
      await client.query("COMMIT")
      return { incidentId: existing.rows[0].id, replay: true }
    }

    const { rows } = await client.query(INSERT_INCIDENT_SQL, insertParams)
    await client.query("COMMIT")
    return { incidentId: rows[0].id, replay: false }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// analyzeImage — Endpoint principal
// ──────────────────────────────────────────────────────────────────────────────

export async function analyzeImage({ image, latitude, longitude, descripcion = "", direccion = "", ubicacion_aproximada = false, userId, client_coverage_ratio, idempotency_key }) {

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
  const idempotencyKey = normalizeIdempotencyKey(idempotency_key)

  const { incidentId, replay } = await createIncident({
    userId, descripcion, direccion, lat, lon, ubicacion_aproximada, idempotencyKey,
  })

  // Replay idempotente: el cliente reintentó un reporte que el servidor ya había
  // recibido (timeout por red lenta). El incidente y su pipeline ML ya existen;
  // solo devolvemos el task_id para que el cliente siga el polling. NO se relanza
  // runMlAnalysis (evita una segunda inferencia sobre el mismo reporte).
  if (replay) {
    console.log(`[image-service] ♻️ Replay idempotente — key=${idempotencyKey} → incidente id=${incidentId} (ML no se relanza)`)
    return {
      httpStatus: 202,
      task_id:   incidentId,
      estado:    "PROCESANDO",
      message:   "Reporte ya recibido; el análisis continúa en progreso.",
      poll_url:  `/api/image/status/${incidentId}`,
      idempotent_replay: true,
    }
  }

  console.log(`[image-service] ✅ Incidente creado id=${incidentId} estado=PROCESANDO prioridad_temp=${TEMP_PRIORIDAD}`)

  setImmediate(() => {
    runMlAnalysis(incidentId, { buffer, image, client_coverage_ratio }).catch((err) => {
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
       i.id, i.estado, i.prioridad, i.descripcion, i.nota_fallo,
       i.decision_automatica, i.confianza_decision, i.imagen_auditoria_url,
       i.created_at, i.updated_at,
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

  // ── Estado: en proceso ────────────────────────────────────────────────────
  if (row.estado === "PROCESANDO") {
    return {
      httpStatus: 202,
      task_id: row.id,
      estado:  "PROCESANDO",
      message: "En proceso, vuelve a consultar en unos segundos.",
    }
  }

  // ── Estado: error técnico ──────────────────────────────────────────────────
  if (row.estado === "FALLIDO") {
    return {
      httpStatus:           200,
      task_id:              row.id,
      estado:               "FALLIDO",
      decision_automatica:  row.decision_automatica ?? null,
      nota_fallo:           row.nota_fallo          ?? null,
      imagen_auditoria_url: row.imagen_auditoria_url ?? null,
      message: "El análisis falló por un error técnico. Intenta de nuevo más tarde.",
    }
  }

  // ── Estado: pendiente de validación por supervisor ────────────────────────
  if (row.estado === "PENDIENTE") {
    return {
      httpStatus:           200,
      task_id:              row.id,
      estado:               "PENDIENTE",
      prioridad:            row.prioridad,
      decision_automatica:  row.decision_automatica  ?? null,
      confianza_decision:   row.confianza_decision   ?? null,
      imagen_auditoria_url: row.imagen_auditoria_url ?? null,
      created_at:           row.created_at,
      updated_at:           row.updated_at,
      message: "Tu reporte está siendo revisado por un supervisor. Recibirás una notificación cuando se tome una decisión.",
    }
  }

  // ── Estado: requiere revisión manual por supervisor ────────────────────────
  if (row.estado === "EN_REVISION") {
    return {
      httpStatus:           200,
      task_id:              row.id,
      estado:               "EN_REVISION",
      decision_automatica:  row.decision_automatica  ?? null,
      confianza_decision:   row.confianza_decision   ?? null,
      nota_fallo:           row.nota_fallo           ?? null,
      imagen_auditoria_url: row.imagen_auditoria_url ?? null,
      created_at:           row.created_at,
      updated_at:           row.updated_at,
      message: "Tu reporte requiere revisión por un supervisor. Recibirás una notificación cuando se tome una decisión.",
    }
  }

  // ── Estado: descartado automáticamente ────────────────────────────────────
  if (row.estado === "DESCARTADO") {
    return {
      httpStatus:           200,
      task_id:              row.id,
      estado:               "DESCARTADO",
      decision_automatica:  row.decision_automatica  ?? null,
      confianza_decision:   row.confianza_decision   ?? null,
      nota_fallo:           row.nota_fallo           ?? null,
      imagen_auditoria_url: row.imagen_auditoria_url ?? null,
      created_at:           row.created_at,
      updated_at:           row.updated_at,
      message: "El análisis automático no detectó acumulación de residuos en tu imagen. Si crees que es incorrecto, envía un nuevo reporte con una foto más clara.",
    }
  }

  // ── Estado: incidente válido (VALIDO / EN_ATENCION / RESUELTA / RECHAZADO)
  return {
    httpStatus:          200,
    task_id:             row.id,
    estado:              row.estado,
    incident_id:         row.id,
    prioridad:           row.prioridad,
    descripcion:         row.descripcion,
    latitud:             row.latitud,
    longitud:            row.longitud,
    decision_automatica: row.decision_automatica ?? null,
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
       SET estado              = 'FALLIDO',
           nota_fallo          = 'Proceso interrumpido — recuperación en arranque',
           decision_automatica = 'ERROR_TECNICO',
           updated_at          = NOW()
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
//   • completed + has_waste=true  → finalizeIncident (transición PENDIENTE)
//   • completed + has_waste=false → finalizeNegativeCase (EN_REVISION o DESCARTADO)
//   • failed                      → markIncidentAsFailed (imagen conservada en S3)
//   • pending/processing          → no hacer nada (próxima iteración)
//
// NOTA: la imagen ya está en S3 (pending_s3_key). En todos los casos de fallo
// la imagen se conserva como imagen_auditoria_url — NO se elimina.

// Completa una tarea Celery recuperada cuyo estado Celery es "completed".
async function finalizeRecoveredTask(incidentId, pending_s3_key, result, log, logError) {
  if (!result.has_waste) {
    log(`ML recuperado — sin residuos detectados (confianza: ${result.confianza ?? "N/A"})`)
    try {
      const { nuevoEstado } = await finalizeNegativeCase(incidentId, pending_s3_key, result, logError)
      log(`✓ Caso negativo recuperado — estado=${nuevoEstado}`)
    } catch (dbErr) {
      await markIncidentAsFailed(incidentId, `recovery: error en caso negativo: ${dbErr.message}`, logError, { s3Key: pending_s3_key })
    }
    return
  }
  await finalizeIncident(incidentId, pending_s3_key, result, logError)
  log(`✓ Incidente recuperado exitosamente — PENDIENTE prioridad=${result.prioridad}`)
}

// Procesa una sola tarea Celery huérfana. La imagen ya está en S3 (pending_s3_key)
// y se conserva como auditoría en todos los casos de fallo — NO se elimina.
async function recoverSingleCeleryTask(incidentId, celery_task_id, pending_s3_key) {
  const log      = (msg) => console.log(`[image-service] [recovery=${incidentId}] ${msg}`)
  const logError = (msg) => console.error(`[image-service] [recovery=${incidentId}] ${msg}`)

  try {
    const { status, result, error } = await checkMlTaskStatus(celery_task_id)

    if (status === "pending" || status === "processing") {
      log(`Tarea Celery aún en progreso (${status}) — próxima iteración`)
      return
    }

    if (status === "failed") {
      logError(`Tarea Celery FALLIDA: ${error ?? "unknown"}`)
      // Imagen ya en S3 → se conserva como auditoría
      await markIncidentAsFailed(incidentId, `recovery: ML inference failed: ${error ?? "unknown"}`, logError, { s3Key: pending_s3_key })
      return
    }

    if (status === "completed") {
      await finalizeRecoveredTask(incidentId, pending_s3_key, result, log, logError)
      return
    }

    logError(`Estado Celery desconocido: '${status}' — se reintentará en próxima iteración`)
  } catch (err) {
    logError(`Error en recovery check: ${err.message} — se reintentará en próxima iteración`)
  }
}

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
    await recoverSingleCeleryTask(incidentId, celery_task_id, pending_s3_key)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// getMyIncidentById — Detalle de un incidente del ciudadano por ID
// Usado por la pantalla de alertas para navegar directamente al incidente.
// ──────────────────────────────────────────────────────────────────────────────

export const getMyIncidentById = async (req, res) => {
  const userId = req.headers["x-user-id"]
  const { id } = req.params

  if (!userId) return res.status(401).json({ error: "No se pudo identificar al usuario." })

  try {
    const { rows } = await pool.query(
      `SELECT
         i.id, i.estado, i.prioridad, i.descripcion, i.created_at,
         i.decision_automatica, i.confianza_decision, i.imagen_auditoria_url,
         ST_Y(i.ubicacion::geometry) AS latitud,
         ST_X(i.ubicacion::geometry) AS longitud,
         ii.image_url,
         ar.nivel_acumulacion, ar.volumen_estimado_m3, ar.tipo_residuo,
         ar.confianza,
         jsonb_array_length(ar.detecciones) AS num_detecciones,
         sh.motivo_rechazo, sh.observaciones AS observaciones_rechazo,
         z.nombre  AS zona_nombre,
         i.direccion,
         i.resuelto_at
       FROM incidents.incidents i
       LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
       LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
       LEFT JOIN operations.zones z ON z.id = i.zona_id
       LEFT JOIN LATERAL (
         SELECT motivo_rechazo, observaciones
         FROM incidents.status_history
         WHERE incident_id = i.id AND estado_nuevo = 'RECHAZADO'
         ORDER BY created_at DESC LIMIT 1
       ) sh ON TRUE
       WHERE i.id = $1 AND i.reportado_por = $2`,
      [id, userId],
    )

    if (!rows.length) return res.status(404).json({ error: "Incidente no encontrado." })
    return res.json(rows[0])
  } catch (err) {
    console.error("[image-service] getMyIncidentById error:", err.message)
    return res.status(500).json({ error: "Error al obtener el incidente." })
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

  const rawPage  = Number.parseInt(req.query.page,  10)
  const rawLimit = Number.parseInt(req.query.limit, 10)
  const page   = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage                : 1
  const limit  = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20
  const offset = (page - 1) * limit

  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT
           i.id, i.estado, i.prioridad, i.descripcion, i.created_at,
           i.decision_automatica, i.confianza_decision, i.imagen_auditoria_url,
           ST_Y(i.ubicacion::geometry) AS latitud,
           ST_X(i.ubicacion::geometry) AS longitud,
           ii.image_url,
           ar.nivel_acumulacion, ar.volumen_estimado_m3, ar.tipo_residuo,
           ar.confianza,
           jsonb_array_length(ar.detecciones) AS num_detecciones,
           -- Motivo de rechazo para mostrar al ciudadano cuando el incidente es RECHAZADA
           sh.motivo_rechazo, sh.observaciones AS observaciones_rechazo,
           z.nombre  AS zona_nombre,
           i.direccion,
           i.resuelto_at
         FROM incidents.incidents i
         LEFT JOIN incidents.incident_images ii ON ii.incident_id = i.id AND ii.es_principal = TRUE
         LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
         LEFT JOIN operations.zones z ON z.id = i.zona_id
         LEFT JOIN LATERAL (
           SELECT motivo_rechazo, observaciones
           FROM incidents.status_history
           WHERE incident_id = i.id AND estado_nuevo = 'RECHAZADO'
           ORDER BY created_at DESC LIMIT 1
         ) sh ON TRUE
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

    const total = Number.parseInt(countRows[0].total, 10)
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
