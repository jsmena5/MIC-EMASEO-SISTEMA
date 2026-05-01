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
const DEV_API_URL  = 'http://192.168.1.151:4000/api'
const PROD_API_URL = 'https://api.emaseo.gob.ec/api'

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? DEV_API_URL : PROD_API_URL)

export const ENV = {
  API_URL,
  isDev: __DEV__,
} as const
