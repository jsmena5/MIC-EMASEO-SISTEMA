import { jwtDecode } from "jwt-decode"

export type AuthUser = {
  id?: string
  username?: string
  nombre: string
  rol: string
  tipo_perfil?: string
  exp?: number
  iat?: number
}

export const getUserFromToken = (token: string) => jwtDecode<AuthUser>(token)

export const isTokenExpired = (token: string, skewSeconds = 0) => {
  const { exp } = getUserFromToken(token)
  if (!exp) return true
  return Date.now() >= (exp - skewSeconds) * 1000
}

export const hasAllowedRole = (user: AuthUser, allowedRoles: string[]) =>
  allowedRoles.includes(user.rol)
