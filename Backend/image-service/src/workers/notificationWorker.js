/**
 * notificationWorker.js
 *
 * Procesa la cola de push notifications (notifications.notifications WHERE
 * estado='PENDIENTE' AND canal='PUSH') usando la Expo Push API.
 *
 * No requiere credenciales Firebase — Expo actúa de intermediario hacia
 * FCM (Android) y APNs (iOS). Los tokens almacenados en app_auth.device_tokens
 * son Expo Push Tokens con formato ExponentPushToken[...].
 */

import { pool }   from "../db.js"
import { logger } from "../utils/logger.js"
import { Expo }   from "expo-server-sdk"

const POLL_INTERVAL_MS = 15_000
const MAX_INTENTOS     = 3
const BATCH_SIZE       = 20
const BACKOFF_SECS     = [30, 120]   // intento 1→30 s, 2→120 s, 3→FALLIDA

const expo = new Expo({ useFcmV1: true })

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function fetchPendientes() {
  const { rows } = await pool.query(
    `SELECT id, usuario_id, titulo, mensaje, intentos
     FROM notifications.notifications
     WHERE estado = 'PENDIENTE'
       AND canal  = 'PUSH'
       AND intentos < $1
       AND (proximo_intento_at IS NULL OR proximo_intento_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [MAX_INTENTOS, BATCH_SIZE],
  )
  return rows
}

async function getTokensForUser(userId) {
  const { rows } = await pool.query(
    `SELECT token, platform
     FROM app_auth.device_tokens
     WHERE user_id = $1`,
    [userId],
  )
  return rows.map(r => r.token).filter(t => Expo.isExpoPushToken(t))
}

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

async function markFallidaOReintento(id, intentoActual, errorMsg) {
  const nuevoIntento = intentoActual + 1
  const esFinal      = nuevoIntento >= MAX_INTENTOS

  if (esFinal) {
    await pool.query(
      `UPDATE notifications.notifications
       SET estado             = 'FALLIDA',
           ultimo_intento_at  = NOW(),
           intentos           = $2,
           error_detalle      = $3,
           proximo_intento_at = NULL
       WHERE id = $1`,
      [id, nuevoIntento, errorMsg],
    )
  } else {
    const backoffSec     = BACKOFF_SECS[intentoActual] ?? 120
    const proximoIntento = new Date(Date.now() + backoffSec * 1000)
    await pool.query(
      `UPDATE notifications.notifications
       SET estado             = 'PENDIENTE',
           ultimo_intento_at  = NOW(),
           intentos           = $2,
           error_detalle      = $3,
           proximo_intento_at = $4
       WHERE id = $1`,
      [id, nuevoIntento, errorMsg, proximoIntento],
    )
  }
}

// ─── Ciclo ────────────────────────────────────────────────────────────────────

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
      logger.warn({ notifId: id, usuario_id }, "[notifWorker] Sin Expo tokens válidos para el usuario")
      await markFallidaOReintento(id, intentos, "Sin ExponentPushToken registrados para el usuario")
      continue
    }

    // Expo permite enviar en lotes; agrupamos todos los tokens del usuario
    const messages = tokens.map(token => ({
      to:    token,
      title: titulo,
      body:  mensaje,
      sound: "default",
      data:  {},
    }))

    let alMenosUnoOk = false
    const errores    = []

    try {
      const chunks   = expo.chunkPushNotifications(messages)
      for (const chunk of chunks) {
        const tickets = await expo.sendPushNotificationsAsync(chunk)
        for (const ticket of tickets) {
          if (ticket.status === "ok") {
            alMenosUnoOk = true
          } else {
            errores.push(ticket.message ?? "error desconocido")
            logger.warn({ notifId: id, ticket }, "[notifWorker] Ticket con error de Expo")
          }
        }
      }
    } catch (err) {
      errores.push(err.message)
      logger.error({ err: err.message, notifId: id }, "[notifWorker] Error al enviar a Expo Push API")
    }

    try {
      if (alMenosUnoOk) {
        await markEnviada(id)
      } else {
        await markFallidaOReintento(id, intentos, errores.join(" | "))
      }
    } catch (dbErr) {
      logger.error({ err: dbErr.message, notifId: id }, "[notifWorker] Error al actualizar estado")
    }
  }
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

export async function startNotificationWorker() {
  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, maxIntentos: MAX_INTENTOS },
    "[notifWorker] Worker Expo Push iniciado",
  )

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
