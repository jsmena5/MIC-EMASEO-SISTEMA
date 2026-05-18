/**
 * push-worker — envía notificaciones push pendientes a dispositivos móviles.
 *
 * Flujo:
 *   1. Lee notifications.notifications WHERE estado='PENDIENTE' AND canal='PUSH'
 *   2. Obtiene el token Expo del usuario desde auth.device_tokens
 *   3. Envía via Expo Push API (https://exp.host/--/api/v2/push/send)
 *   4. Actualiza el estado a 'ENVIADA' o 'FALLIDA' con backoff exponencial
 *
 * Pasos pendientes para producción:
 *   - Registrar token en la app: llamar POST /api/users/push-token tras login
 *     con el token obtenido de expo-notifications (Notifications.getExpoPushTokenAsync)
 *   - Solicitar permisos en la app: Notifications.requestPermissionsAsync()
 *   - Agregar expo-notifications al package.json del frontend y configurar
 *     el plugin en app.json (https://docs.expo.dev/push-notifications/overview/)
 *   - Levantar este worker como servicio Docker o proceso pm2 junto al resto
 */

import "dotenv/config"
import pg from "pg"
import { Expo } from "expo-server-sdk"

const POLL_INTERVAL_MS = 30_000   // verificar cada 30 s
const BATCH_SIZE       = 50       // max notificaciones por ciclo
const MAX_ATTEMPTS     = 5        // tras 5 fallos, dejar de reintentar

const expo = new Expo()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// ──────────────────────────────────────────────────────────────────────────────

async function processPendingNotifications() {
  const client = await pool.connect()
  try {
    // Seleccionar notificaciones pendientes de envío push (con backoff)
    const { rows: notifications } = await client.query(
      `SELECT n.id, n.usuario_id, n.titulo, n.mensaje, n.incident_id, n.intentos
       FROM notifications.notifications n
       WHERE n.canal  = 'PUSH'
         AND n.estado IN ('PENDIENTE', 'FALLIDA')
         AND n.intentos < $1
         AND (n.proximo_intento_at IS NULL OR n.proximo_intento_at <= NOW())
       ORDER BY n.created_at ASC
       LIMIT $2`,
      [MAX_ATTEMPTS, BATCH_SIZE]
    )

    if (notifications.length === 0) return

    console.log(`[push-worker] ${notifications.length} notificación(es) a despachar`)

    for (const notif of notifications) {
      // Obtener tokens del usuario
      const { rows: tokenRows } = await client.query(
        `SELECT token FROM auth.device_tokens WHERE user_id = $1`,
        [notif.usuario_id]
      )

      // Sin token registrado — marcar como enviada para no reintentar
      if (tokenRows.length === 0) {
        await client.query(
          `UPDATE notifications.notifications
           SET estado = 'ENVIADA', enviada_at = NOW(),
               intentos = intentos + 1, ultimo_intento_at = NOW(),
               error_detalle = 'Sin token registrado para el usuario'
           WHERE id = $1`,
          [notif.id]
        )
        continue
      }

      // Filtrar solo tokens Expo válidos
      const messages = tokenRows
        .filter(({ token }) => Expo.isExpoPushToken(token))
        .map(({ token }) => ({
          to:    token,
          sound: "default",
          title: notif.titulo,
          body:  notif.mensaje,
          data:  { incident_id: notif.incident_id },
        }))

      if (messages.length === 0) {
        await client.query(
          `UPDATE notifications.notifications
           SET estado = 'ENVIADA', enviada_at = NOW(),
               intentos = intentos + 1, ultimo_intento_at = NOW(),
               error_detalle = 'Tokens registrados no son tokens Expo válidos'
           WHERE id = $1`,
          [notif.id]
        )
        continue
      }

      try {
        const chunks = expo.chunkPushNotifications(messages)
        for (const chunk of chunks) {
          const receipts = await expo.sendPushNotificationsAsync(chunk)
          // Registrar errores por ticket (no críticos para el estado global)
          for (const receipt of receipts) {
            if (receipt.status === "error") {
              console.warn(`[push-worker] ticket error: ${receipt.message}`)
            }
          }
        }
        await client.query(
          `UPDATE notifications.notifications
           SET estado = 'ENVIADA', enviada_at = NOW(),
               intentos = intentos + 1, ultimo_intento_at = NOW()
           WHERE id = $1`,
          [notif.id]
        )
        console.log(`[push-worker] ✓ notif id=${notif.id} enviada a ${messages.length} token(s)`)
      } catch (err) {
        // Backoff exponencial: 1min, 2min, 4min, 8min…
        const backoffMs = Math.min(60_000 * Math.pow(2, notif.intentos), 3_600_000)
        await client.query(
          `UPDATE notifications.notifications
           SET estado = 'FALLIDA',
               intentos = intentos + 1,
               ultimo_intento_at = NOW(),
               error_detalle = $2,
               proximo_intento_at = NOW() + ($3 || ' milliseconds')::interval
           WHERE id = $1`,
          [notif.id, err.message, backoffMs]
        )
        console.error(`[push-worker] ✗ notif id=${notif.id} falló: ${err.message} (reintento en ${backoffMs / 1000}s)`)
      }
    }
  } catch (err) {
    console.error("[push-worker] Error en ciclo de envío:", err.message)
  } finally {
    client.release()
  }
}

// ──────────────────────────────────────────────────────────────────────────────

const requiredEnv = ["DATABASE_URL"]
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`[push-worker] FATAL: Variable de entorno obligatoria no definida: ${key}`)
    process.exit(1)
  }
}

console.log(`[push-worker] Iniciado — ciclo cada ${POLL_INTERVAL_MS / 1000}s`)
processPendingNotifications()
setInterval(processPendingNotifications, POLL_INTERVAL_MS)
