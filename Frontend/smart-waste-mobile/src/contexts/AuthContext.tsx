import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { jwtDecode } from "jwt-decode"
import { logoutUser } from "../services/auth.service"
import axios from "axios"
import { API_URL } from "../config/env"
import { subscribeAuthSession } from "../utils/authSessionEvents"
import { saveSecure, getSecure, deleteSecure } from "../utils/secureStorage"

/**
 * Tiempo mínimo que el splash permanece visible (ms).
 *
 * 1000 ms permite que las animaciones principales del splash (logo spring-in
 * + FadeInDown de la marca a los 350 ms) sean perceptibles, a la vez que
 * la app con sesión activa llega a Home en < 1.5 s en producción.
 *
 * Desglose típico en producción (Expo build):
 *   ~300 ms — arranque del motor JS + boot de la app
 *   ~100 ms — lectura de SecureStore + jwtDecode
 *   1000 ms — MIN_SPLASH_MS (este valor)
 *   ──────────────────────────────────────────
 *   ~1.4 s  — total hasta Home  ✓
 */
const MIN_SPLASH_MS = 1000

export interface DecodedToken {
  id: number
  username: string
  rol: string
  nombre: string
  tipo_perfil: "operario" | "ciudadano"
  iat: number
  exp: number
}

// Roles permitidos en la app móvil.
// CIUDADANO: reporta incidentes (flujo principal).
// OPERARIO:  recibe asignaciones y las resuelve en campo.
// Supervisores y admins usan los paneles web.
const ROLES_APP: ReadonlySet<string> = new Set(["CIUDADANO", "OPERARIO"])

/** Error lanzado cuando un usuario no autorizado intenta entrar a la app móvil. */
export class RolNoPermitidoError extends Error {
  code = "ROL_NO_PERMITIDO"
  constructor() {
    super("Esta aplicación es para ciudadanos y operarios. Si eres supervisor o administrador, ingresa desde el panel web.")
    this.name = "RolNoPermitidoError"
  }
}

interface AuthContextType {
  user: DecodedToken | null
  token: string | null
  isLoading: boolean
  login: (token: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// One-time migration: move tokens from plain AsyncStorage to SecureStore.
// Runs before any token read so no session is lost on first upgrade.
async function migrateTokensToSecureStore(): Promise<void> {
  const migrated = await AsyncStorage.getItem("emaseo_tokens_migrated")
  if (migrated) return

  const accessToken = await AsyncStorage.getItem("token")
  const refreshToken = await AsyncStorage.getItem("refreshToken")

  if (accessToken) await saveSecure("emaseo_access_token", accessToken)
  if (refreshToken) await saveSecure("emaseo_refresh_token", refreshToken)

  await AsyncStorage.removeItem("token")
  await AsyncStorage.removeItem("refreshToken")
  await AsyncStorage.setItem("emaseo_tokens_migrated", "true")
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<DecodedToken | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const restoreSession = async () => {
      const t0 = Date.now()
      try {
        await migrateTokensToSecureStore()

        const stored = await getSecure("emaseo_access_token")
        if (stored) {
          const decoded = jwtDecode<DecodedToken>(stored)
          if (!ROLES_APP.has(decoded.rol)) {
            // Sesión de un rol no permitido (supervisor/admin) → descartar
            await deleteSecure("emaseo_access_token")
            await deleteSecure("emaseo_refresh_token")
          } else if (decoded.exp * 1000 > Date.now()) {
            setToken(stored)
            setUser(decoded)
          } else {
            // Access token expirado — intentar refresh silencioso antes de pedir login
            const refreshToken = await getSecure("emaseo_refresh_token")
            if (refreshToken) {
              try {
                const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken })
                await saveSecure("emaseo_access_token", data.token)
                await saveSecure("emaseo_refresh_token", data.refreshToken)
                const newDecoded = jwtDecode<DecodedToken>(data.token)
                setToken(data.token)
                setUser(newDecoded)
              } catch {
                await deleteSecure("emaseo_access_token")
                await deleteSecure("emaseo_refresh_token")
              }
            } else {
              await deleteSecure("emaseo_access_token")
            }
          }
        }
      } catch {
        await deleteSecure("emaseo_access_token")
        await deleteSecure("emaseo_refresh_token")
      } finally {
        // Respetar el tiempo mínimo del splash para que la animación
        // de entrada tenga tiempo de reproducirse completamente.
        const elapsed = Date.now() - t0
        const remaining = MIN_SPLASH_MS - elapsed
        if (remaining > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remaining))
        }
        setIsLoading(false)
      }
    }

    restoreSession()
  }, [])

  useEffect(() => {
    return subscribeAuthSession((sessionToken) => {
      if (!sessionToken) {
        setToken(null)
        setUser(null)
        return
      }

      try {
        const decoded = jwtDecode<DecodedToken>(sessionToken)
        if (!ROLES_APP.has(decoded.rol)) {
          setToken(null)
          setUser(null)
          return
        }
        setToken(sessionToken)
        setUser(decoded)
      } catch {
        setToken(null)
        setUser(null)
      }
    })
  }, [])

  const login = async (newToken: string) => {
    const decoded = jwtDecode<DecodedToken>(newToken)
    if (!ROLES_APP.has(decoded.rol)) {
      // loginUser ya guardó los tokens — limpiarlos para no dejar sesión a medias
      await deleteSecure("emaseo_access_token")
      await deleteSecure("emaseo_refresh_token")
      throw new RolNoPermitidoError()
    }
    await saveSecure("emaseo_access_token", newToken)
    setToken(newToken)
    setUser(decoded)
  }

  const logout = async () => {
    try {
      await logoutUser()
    } finally {
      // Garantiza que el estado local siempre se limpia,
      // incluso si el backend o SecureStore falla.
      setToken(null)
      setUser(null)
    }
  }

  const contextValue = useMemo(
    () => ({ user, token, isLoading, login, logout }),
    [user, token, isLoading, login, logout],
  )

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
