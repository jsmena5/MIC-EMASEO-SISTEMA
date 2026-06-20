// ──────────────────────────────────────────────────────────────────────────────
// Fuente de verdad para URLs de entorno en la app móvil.
//
// EXPO_PUBLIC_API_URL es obligatoria en TODOS los entornos:
//   • .env.development → URL del túnel Cloudflare o IP LAN del gateway
//   • .env.production  → URL pública (https://api.emaseo.ec/api)
//
// No hay fallbacks ni IPs hardcodeadas — si falta, el build falla.
// ──────────────────────────────────────────────────────────────────────────────

const normalizeApiUrl = (value: string) => value.replace(/\/+$/, '')

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim()

if (!configuredApiUrl) {
  throw new Error(
    'Falta EXPO_PUBLIC_API_URL. Crea .env.development o .env.production con la URL del API Gateway.'
  )
}

export const API_URL: string = normalizeApiUrl(configuredApiUrl)

export const ENV = {
  API_URL,
  isDev: __DEV__,
} as const
