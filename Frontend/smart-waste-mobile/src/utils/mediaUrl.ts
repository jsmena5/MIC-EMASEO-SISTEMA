import { API_URL } from "../config/env"

const MEDIA_BASE = `${API_URL}/media`

/**
 * Rewrites any image_url returned by the backend so it always resolves through
 * the HTTPS gateway media proxy (GET /api/media/<bucket>/<key>), regardless of
 * how S3_PUBLIC_URL was configured server-side (localhost, LAN IP, http://, …).
 *
 * Examples:
 *   http://localhost:9000/emaseo-incidents/incidents/uuid.jpg
 *     → https://micemaseo.duckdns.org/api/media/emaseo-incidents/incidents/uuid.jpg
 *   https://micemaseo.duckdns.org/api/media/emaseo-incidents/…  (already correct)
 *     → unchanged
 *   null / undefined → null
 */
export function toPublicMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith(MEDIA_BASE)) return url
  // Strip scheme + host to get the path portion
  const path = url.replace(/^https?:\/\/[^/]+/, "")
  if (!path || path === "/") return null
  return `${MEDIA_BASE}/${path.replace(/^\/+/, "")}`
}
