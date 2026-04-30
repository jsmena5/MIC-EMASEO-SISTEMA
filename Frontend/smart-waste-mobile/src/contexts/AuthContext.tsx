import React, { createContext, useContext, useEffect, useState, ReactNode } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { jwtDecode } from "jwt-decode"
import { logoutUser } from "../services/auth.service"

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DecodedToken | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const stored = await AsyncStorage.getItem("token")
        if (stored) {
          const decoded = jwtDecode<DecodedToken>(stored)
          if (decoded.exp * 1000 > Date.now()) {
            setToken(stored)
            setUser(decoded)
          } else {
            await AsyncStorage.multiRemove(["token", "refreshToken"])
          }
        }
      } catch {
        await AsyncStorage.multiRemove(["token", "refreshToken"])
      } finally {
        setIsLoading(false)
      }
    }

    restoreSession()
  }, [])

  const login = async (newToken: string) => {
    const decoded = jwtDecode<DecodedToken>(newToken)
    await AsyncStorage.setItem("token", newToken)
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
