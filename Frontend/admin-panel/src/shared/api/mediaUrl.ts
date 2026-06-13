import { API_URL } from "../../config/env"

const MEDIA_BASE = `${API_URL}/media`

/**
 * Normaliza cualquier image_url devuelta por el backend para que sea accesible
 * desde el panel web.
 *
 * Vive en shared/api porque resolver URLs de media es parte de cómo el front
 * habla con el mismo API Gateway (el proxy GET /api/media/<bucket>/<key>), igual
 * que authenticatedFetch. No es un helper genérico de "utils".
 *
 * Estrategia (idéntica a la del móvil, idempotente):
 *  - Si la URL ya usa el proxy del gateway → sin cambios.
 *  - Si la URL es privada (localhost, IP LAN, http://, minio interno) →
 *    reescribir al proxy del gateway, que SÍ necesita el bucket en el path.
 *  - Si la URL es pública HTTPS (R2/S3/CDN) → usarla directa, quitando el bucket
 *    duplicado del path si está presente (URLs antiguas persistidas en BD).
 *
 * Ejemplos:
 *   https://pub-xxx.r2.dev/emaseo-incidents/incidents/uuid.jpg → https://pub-xxx.r2.dev/incidents/uuid.jpg
 *   https://pub-xxx.r2.dev/incidents/uuid.jpg                  → sin cambios (ya correcta)
 *   http://localhost:9000/emaseo-incidents/incidents/uuid.jpg  → gateway proxy (mantiene bucket)
 *   https://micemaseo.duckdns.org/api/media/…                 → sin cambios (ya es proxy)
 */
export function toPublicMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Ya usa el proxy del gateway → sin cambios
  if (url.startsWith(MEDIA_BASE)) return url

  const lower = url.toLowerCase()

  // URL privada: localhost, IPs de red local, esquema http, hostname interno
  const isPrivate =
    lower.startsWith("http://") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("minio") ||
    /https?:\/\/10\./.test(lower) ||
    /https?:\/\/192\.168\./.test(lower) ||
    /https?:\/\/172\.(1[6-9]|2d|3[01])\./.test(lower)

  if (isPrivate) {
    // URL privada → reescribir al proxy del gateway. El proxy
    // (GET /api/media/<bucket>/<key>) necesita el bucket en el path, así que NO
    // se quita aquí; se conserva el path completo.
    const path = url.replace(/^https?:\/\/[^/]+/, "")
    if (!path || path === "/") return null
    return `${MEDIA_BASE}/${path.replace(/^\/+/, "")}`
  }

  // ── URL pública (R2/S3/CDN) → usar directamente ────────────────────────────
  // Fix del bucket duplicado: el image-service antiguo construía la URL como
  // `${S3_PUBLIC_URL}/${BUCKET}/${key}`, pero el dominio público de R2
  // (pub-xxx.r2.dev) YA está ligado al bucket. Como todas las keys empiezan con
  // "incidents/", si hay un segmento extra antes de "incidents/" lo quitamos.
  // Idempotente: si la URL ya es correcta, el regex no aplica.
  return url.replace(/(:\/\/[^/]+)\/[^/]+\/(incidents\/)/, "$1/$2")
}
