import { API_URL } from "../config/env"

const MEDIA_BASE = `${API_URL}/media`

/**
 * Normaliza cualquier image_url devuelta por el backend para que sea accesible
 * desde la app móvil.
 *
 * Estrategia:
 *  - Si la URL ya usa el proxy del gateway → sin cambios.
 *  - Si la URL es pública HTTPS (R2, S3, CDN) → usarla directamente; el
 *    objeto ya es accesible desde internet sin necesidad del proxy.
 *  - Si la URL es privada (localhost, IP LAN, http://, minio interno) →
 *    reescribir al proxy HTTPS del gateway para que sea accesible.
 *
 * Ejemplos:
 *   https://pub-xxx.r2.dev/emaseo-incidents/uuid.jpg  → sin cambios (R2 público)
 *   http://localhost:9000/emaseo-incidents/uuid.jpg   → gateway proxy
 *   http://minio:9000/emaseo-incidents/uuid.jpg       → gateway proxy
 *   https://micemaseo.duckdns.org/api/media/…        → sin cambios (ya es proxy)
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
    /https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./.test(lower)

  if (!isPrivate) {
    // URL pública HTTPS (R2, S3, CloudFront, etc.) → usar directamente
    return url
  }

  // URL privada → reescribir al proxy HTTPS del gateway
  const path = url.replace(/^https?:\/\/[^/]+/, "")
  if (!path || path === "/") return null
  return `${MEDIA_BASE}/${path.replace(/^\/+/, "")}`
}
