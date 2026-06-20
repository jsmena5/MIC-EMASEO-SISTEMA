const normalizeApiUrl = (value: string) => value.replace(/\/+$/, "").trim()

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

if (!configuredApiUrl) {
  throw new Error(
    "Falta VITE_API_URL. Crea .env.development o .env.production con la URL del API Gateway."
  )
}

export const API_URL: string = normalizeApiUrl(configuredApiUrl)

export const ENV = {
  API_URL,
  isDev: import.meta.env.DEV,
} as const
