// ──────────────────────────────────────────────────────────────────────────────
// Fuente de verdad para URLs de entorno en el panel web.
//
// VITE_API_URL es obligatoria en TODOS los entornos:
//   • .env.development → http://localhost:4000/api (o túnel)
//   • .env.production  → URL pública (https://api.emaseo.ec/api)
//
// Sin fallbacks: si falta, vite build falla.
// ──────────────────────────────────────────────────────────────────────────────

const normalizeApiUrl = (value: string) => value.replace(/\/+$/, '')

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

if (!configuredApiUrl) {
  throw new Error(
    'Falta VITE_API_URL. Crea .env.development o .env.production con la URL del API Gateway.'
  )
}

export const API_URL: string = normalizeApiUrl(configuredApiUrl)

export const ENV = {
  API_URL,
  isDev: import.meta.env.DEV,
} as const
