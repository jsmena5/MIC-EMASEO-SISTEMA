/**
 * notificationWorker.js
 *
 * Worker de push notifications para EMASEO EP.
 *
 * Flujo:
 *   1. Cada POLL_INTERVAL_MS consulta notificaciones PENDIENTES con
 *      proximo_intento_at <= NOW() y intentos < MAX_INTENTOS.
 *   2. Para cada notificación obtiene los device_tokens del usuario desde
 *      app_auth.device_tokens.
 *   3. Envía vía Firebase Admin SDK (FCM v1).
 *   4. Actualiza estado a ENVIADA (al menos un token OK) o FALLIDA (todos
 *      los tokens fallaron y se agotaron los reintentos), con backoff
 *      exponencial entre intentos.
 *
 * Variables de entorno requeridas:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — JSON completo de la service account de
 *                                   Firebase (comprimido en una sola línea).
 *                                   Si no está definida el worker arranca en
 *                                   modo stub (log de advertencia, sin crash).
 */

import { pool } from "../db.js"
import { logger } from "../utils/logger.js"

// ─── Configuración ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15_000   // cada 15 s
const MAX_INTENTOS     = 3
const BATCH_SIZE       = 20       // notificaciones por ciclo

/** Backoff exponencial en segundos: intento 1→30s, 2→120s, 3→FALLIDA */
const BACKOFF_SECS = [30, 120]

// ─── Inicialización Firebase ──────────────────────────────────────────────────
// firebase-admin es CJS; se importa dinámicamente en setupFirebase() para
// compatibilidad con el módulo ESM del proyecto ("type": "module").
let firebaseApp = null
let messaging   = null

// En ESM el await top-level no está disponible en módulos secundarios; usamos
// una variable de inicialización que se resuelve en startNotificationWorker().
let firebaseReady = false

async function setupFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    logger.warn(
      "[notifWorker] FIREBASE_SERVICE_ACCOUNT_JSON no definida. " +
      "El worker arranca en modo stub — las notificaciones se marcarán como FALLIDA.",
    )
    return false
  }

  try {
    const admin = (await import("firebase-admin")).default
    const serviceAccount = JSON.parse(raw)

    // Evitar inicialización duplicada si el módulo se recarga
    if (admin.apps.length === 0) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      })
    } else {
      firebaseApp = admin.apps[0]
    }

    messaging = admin.messaging(firebaseApp)
    logger.info("[notifWorker] Firebase Admin SDK inicializado correctamente")
    return true
  } catch (err) {
    logger.error({ err: err.message }, "[notifWorker] Error al inicializar Firebase Admin SDK")
    return false
  }
}

// ─── Helpers de DB ────────────────────────────────────────────────────────────

/** Devuelve hasta BATCH_SIZE notificaciones listas para enviar. */
async function fetchPendientes() {
  const { rows } = await pool.query(
    `SELECT id, usuario_id, titulo, mensaje, intentos
     FROM notifications.notifications
     WHERE estado = 'PENDIENTE'
       AND intentos < $1
       AND (proximo_intento_at IS NULL OR proximo_intento_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [MAX_INTENTOS, BATCH_SIZE],
  )
  return rows
}

/** Obtiene los FCM tokens registrados para un usuario. */
async function getTokensForUser(userId) {
  const { rows } = await pool.query(
    `SELECT token, platform
     FROM app_auth.device_tokens
     WHERE user_id = $1`,
    [userId],
  )
  return rows
}

/** Marca la notificación como ENVIADA. */
async function markEnviada(id) {
  await pool.query(
    `UPDATE notifications.notifications
     SET estado            = 'ENVIADA',
         enviada_at        = NOW(),
         ultimo_intento_at = NOW(),
         intentos          = intentos + 1,
         error_detalle     = NULL
     WHERE id = $1`,
    [id],
  )
}

/**
 * Marca la notificación para reintento (backoff) o como FALLIDA si se agotaron
 * los intentos.
 */
async function markFallidaOReintento(id, intentoActual, errorMsg) {
  const nuevoIntento = intentoActual + 1
  const esFinal      = nuevoIntento >= MAX_INTENTOS

  if (esFinal) {
    await pool.query(
      `UPDATE notifications.notifications
       SET estado            = 'FALLIDA',
           ultimo_intento_at = NOW(),
           intentos          = $2,
           error_detalle     = $3,
           proximo_intento_at = NULL
       WHERE id = $1`,
      [id, nuevoIntento, errorMsg],
    )
  } else {
    const backoffSec      = BACKOFF_SECS[intentoActual] ?? 120
    const proximoIntento  = new Date(Date.now() + backoffSec * 1000)
    await pool.query(
      `UPDATE notifications.notifications
       SET estado            = 'PENDIENTE',
           ultimo_intento_at = NOW(),
           intentos          = $2,
           error_detalle     = $3,
           proximo_intento_at = $4
       WHERE id = $1`,
      [id, nuevoIntento, errorMsg, proximoIntento],
    )
  }
}

// ─── Envío FCM ────────────────────────────────────────────────────────────────

/**
 * Envía el mensaje a un token FCM.
 * Retorna true si el envío fue exitoso, false si falló.
 * Lanza en caso de error no recuperable.
 */
async function sendFcmMessage(token, titulo, mensaje) {
  if (!firebaseReady || !messaging) {
    // Modo stub: simular fallo para que el worker registre el error sin crashear
    throw new Error("Firebase no inicializado (modo stub)")
  }

  const message = {
    token,
    notification: { title: titulo, body: mensaje },
    android: {
      priority: "high",
      notification: { sound: "default", channelId: "emaseo_notif" },
    },
    apns: {
      payload: { aps: { sound: "default", badge: 1 } },
    },
  }

  await messaging.send(message)
  return true
}

// ─── Ciclo principal ──────────────────────────────────────────────────────────

async function processBatch() {
  let rows
  try {
    rows = await fetchPendientes()
  } catch (err) {
    logger.error({ err: err.message }, "[notifWorker] Error al consultar pendientes")
    return
  }

  if (rows.length === 0) return

  logger.info({ count: rows.length }, "[notifWorker] Procesando lote de notificaciones")

  for (const notif of rows) {
    const { id, usuario_id, titulo, mensaje, intentos } = notif

    let tokens
    try {
      tokens = await getTokensForUser(usuario_id)
    } catch (err) {
      logger.error({ err: err.message, notifId: id }, "[notifWorker] Error al obtener tokens")
      await markFallidaOReintento(id, intentos, `DB error: ${err.message}`)
      continue
    }

    if (tokens.length === 0) {
      // Sin dispositivos registrados — marcar FALLIDA con mensaje descriptivo
      logger.warn({ notifId: id, usuario_id }, "[notifWorker] Usuario sin device_tokens registrados")
      await markFallidaOReintento(id, intentos, "Sin device_tokens registrados para el usuario")
      continue
    }

    let alMenosUnoOk = false
    const errores    = []

    for (const { token, platform } of tokens) {
      try {
        await sendFcmMessage(token, titulo, mensaje)
        alMenosUnoOk = true
        logger.debug({ notifId: id, platform }, "[notifWorker] Push enviado OK")
      } catch (err) {
        errores.push(`${platform}: ${err.message}`)
        logger.warn({ notifId: id, platform, err: err.message }, "[notifWorker] Fallo al enviar push")
      }
    }

    try {
      if (alMenosUnoOk) {
        await markEnviada(id)
      } else {
        const errorResumen = errores.join(" | ")
        await markFallidaOReintento(id, intentos, errorResumen)
      }
    } catch (dbErr) {
      logger.error({ err: dbErr.message, notifId: id }, "[notifWorker] Error al actualizar estado")
    }
  }
}

// ─── Arranque ────────────────────────────────────────────────────────────────

export async function startNotificationWorker() {
  firebaseReady = await setupFirebase()

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, maxIntentos: MAX_INTENTOS },
    "[notifWorker] Worker de notificaciones iniciado",
  )

  // Primera ejecución inmediata al arrancar
  await processBatch()

  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      await processBatch()
    } catch (err) {
      logger.error({ err: err.message }, "[notifWorker] Error inesperado en ciclo")
    } finally {
      running = false
    }
  }, POLL_INTERVAL_MS)
}
