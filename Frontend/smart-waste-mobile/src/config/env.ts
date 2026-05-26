// ──────────────────────────────────────────────────────────────────────────────
// Fuente de verdad para URLs de entorno en la app móvil.
//
// Cadena de prioridad:
//   1. EXPO_PUBLIC_API_URL  →  valor del archivo .env.development / .env.production
//   2. Fallback automático  →  IP local si __DEV__, dominio de producción si no
//
// Para desarrollo: crea .env.development con EXPO_PUBLIC_API_URL=<url>
// Para producción: crea .env.production  con EXPO_PUBLIC_API_URL=<url>
// ──────────────────────────────────────────────────────────────────────────────

// Reemplaza esta IP con la de tu máquina de desarrollo en la red local
const DEV_API_URL = 'http://192.168.1.151:4000/api'

const normalizeApiUrl = (value: string) => value.replace(/\/+$/, '')

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim()

if (!configuredApiUrl && !__DEV__) {
  throw new Error(
    'Falta EXPO_PUBLIC_API_URL en producción. Configura una URL pública válida del API Gateway.'
  )
}

export const API_URL: string = normalizeApiUrl(
  configuredApiUrl || DEV_API_URL
)

export const ENV = {
  API_URL,
  isDev: __DEV__,
} as const
