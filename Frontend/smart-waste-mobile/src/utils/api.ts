import AsyncStorage from "@react-native-async-storage/async-storage"
import axios, { InternalAxiosRequestConfig } from "axios"
import { API_URL } from "../config/env"
import { navigationRef } from "./navigationService"

const BASE_URL = API_URL

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 50000, // necesario para DB + SMTP (Gmail puede tardar 8s+)
})

// ─── Request interceptor — adjunta el access token automáticamente ────────────
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("token")
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
      return Promise.reject(error)
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
      const refreshToken = await AsyncStorage.getItem("refreshToken")
      if (!refreshToken) throw new Error("no_refresh_token")

      // Usamos axios directamente (no la instancia `api`) para que esta
      // llamada no pase por el interceptor de respuesta y cause un bucle.
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken })

      await AsyncStorage.multiSet([
        ["token", data.token],
        ["refreshToken", data.refreshToken],
      ])

      processQueue(null, data.token)

      originalRequest.headers.Authorization = `Bearer ${data.token}`
      return api(originalRequest)

    } catch (refreshError) {
      processQueue(refreshError, null)
      await AsyncStorage.multiRemove(["token", "refreshToken"])

      // Redirigir a Login solo si el navegador ya está montado
      if (navigationRef.isReady()) navigationRef.navigate("Login")

      return Promise.reject(refreshError)

    } finally {
      isRefreshing = false
    }
  }
)

export default api
