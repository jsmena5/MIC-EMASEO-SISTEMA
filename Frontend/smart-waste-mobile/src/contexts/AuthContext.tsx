import React, { createContext, useContext, useEffect, useState, ReactNode } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { jwtDecode } from "jwt-decode"
import { logoutUser } from "../services/auth.service"
import { subscribeAuthSession } from "../utils/authSessionEvents"
import { saveSecure, getSecure, deleteSecure } from "../utils/secureStorage"

export interface DecodedToken {
  id: number
  username: string
  rol: string
  nombre: string
  tipo_perfil: "operario" | "ciudadano"
  iat: number
  exp: number
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DecodedToken | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const restoreSession = async () => {
      try {
        await migrateTokensToSecureStore()

        const stored = await getSecure("emaseo_access_token")
        if (stored) {
          const decoded = jwtDecode<DecodedToken>(stored)
          if (decoded.exp * 1000 > Date.now()) {
            setToken(stored)
            setUser(decoded)
          } else {
            await deleteSecure("emaseo_access_token")
            await deleteSecure("emaseo_refresh_token")
          }
        }
      } catch {
        await deleteSecure("emaseo_access_token")
        await deleteSecure("emaseo_refresh_token")
      } finally {
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
    await saveSecure("emaseo_access_token", newToken)
    setToken(newToken)
    setUser(decoded)
  }

  const logout = async () => {
    await logoutUser()
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
