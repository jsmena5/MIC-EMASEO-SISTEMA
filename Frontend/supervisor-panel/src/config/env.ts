// ──────────────────────────────────────────────────────────────────────────────
// Fuente de verdad para URLs de entorno en el panel web.
//
// Cadena de prioridad:
//   1. VITE_API_URL  →  valor del archivo .env (dev) / .env.production
//   2. Fallback automático  →  localhost si dev, dominio de producción si no
//
// Vite expone las vars con prefijo VITE_* a través de import.meta.env
// ──────────────────────────────────────────────────────────────────────────────

const DEV_API_URL  = 'http://localhost:4000/api'
const PROD_API_URL = 'https://api.emaseo.gob.ec/api'

export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? DEV_API_URL : PROD_API_URL)

export const ENV = {
  API_URL,
  isDev: import.meta.env.DEV,
} as const
