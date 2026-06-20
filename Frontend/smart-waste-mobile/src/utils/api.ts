import axios, { InternalAxiosRequestConfig } from "axios"
import { API_URL } from "../config/env"
import { notifyAuthSessionExpired, notifyAuthTokenUpdated } from "./authSessionEvents"
import { saveSecure, getSecure, deleteSecure } from "./secureStorage"

const BASE_URL = API_URL

const api = axios.create({
  baseURL: BASE_URL,
  // 125 s > proxyTimeout de 120 s en el gateway; el cliente espera más que el proxy.
  timeout: 125000,
})

// ─── Request interceptor — adjunta el access token automáticamente ────────────
api.interceptors.request.use(async (config) => {
  const token = await getSecure("emaseo_access_token")
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ─── Response interceptor — auto-refresh en 401 con cola de peticiones ────────
//
// Si múltiples peticiones fallan simultáneamente con 401 solo se emite UNA
// llamada de refresh; el resto se encolan y reciben el nuevo token cuando llegue.

interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean
}

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error)
    else prom.resolve(token!)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryableRequest

    // No intentar refresh si:
    //   • No fue un 401
    //   • Ya intentamos hacer refresh para esta petición
    //   • La petición que falló ES la de auth (evita bucle infinito)
    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      originalRequest.url?.includes("/auth/")
    ) {
      throw error
    }

    // Encolar si ya hay un refresh en curso
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            resolve(api(originalRequest))
          },
          reject,
        })
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const refreshToken = await getSecure("emaseo_refresh_token")
      if (!refreshToken) throw new Error("no_refresh_token")

      // Usamos axios directamente (no la instancia `api`) para que esta
      // llamada no pase por el interceptor de respuesta y cause un bucle.
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken })

      await saveSecure("emaseo_access_token", data.token)
      await saveSecure("emaseo_refresh_token", data.refreshToken)
      notifyAuthTokenUpdated(data.token)

      processQueue(null, data.token)

      originalRequest.headers.Authorization = `Bearer ${data.token}`
      return api(originalRequest)

    } catch (refreshError) {
      processQueue(refreshError, null)
      await deleteSecure("emaseo_access_token")
      await deleteSecure("emaseo_refresh_token")
      notifyAuthSessionExpired()

      throw refreshError

    } finally {
      isRefreshing = false
    }
  }
)

export default api
