import { getUserFromToken, hasAllowedRole, isTokenExpired } from "../../shared/utils/jwt"
import type { AuthUser } from "../../shared/utils/jwt"
import { logoutRequest, refreshRequest } from "./authService"

const ACCESS_TOKEN_KEY  = "admin_token"
const REFRESH_TOKEN_KEY = "admin_refreshToken"
const REFRESH_SKEW_SECONDS = 60

export const AUTH_SESSION_CLEARED_EVENT = "auth:session-cleared"

export type AuthTokens = {
  token: string
  refreshToken: string
}

let refreshPromise: Promise<AuthTokens | null> | null = null

const emitSessionCleared = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT))
  }
}

export const getAccessToken  = () => localStorage.getItem(ACCESS_TOKEN_KEY)
export const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY)

export const storeAuthTokens = ({ token, refreshToken }: AuthTokens) => {
  localStorage.setItem(ACCESS_TOKEN_KEY,  token)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export const clearAuthTokens = () => {
  const hadSession = Boolean(getAccessToken() || getRefreshToken())
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  if (hadSession) emitSessionCleared()
}

export const getStoredUser = (): AuthUser | null => {
  const token = getAccessToken()
  if (!token) return null
  try {
    if (isTokenExpired(token)) {
      if (!getRefreshToken()) { clearAuthTokens(); return null }
      return getUserFromToken(token)
    }
    return getUserFromToken(token)
  } catch {
    clearAuthTokens()
    return null
  }
}

export const refreshStoredSession = async () => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) { clearAuthTokens(); return null }

  if (!refreshPromise) {
    refreshPromise = refreshRequest(refreshToken)
      .then((tokens) => { storeAuthTokens(tokens); return tokens })
      .catch(() => { clearAuthTokens(); return null })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

export const getValidAccessToken = async () => {
  const token = getAccessToken()
  try {
    if (token && !isTokenExpired(token, REFRESH_SKEW_SECONDS)) return token
  } catch {
    clearAuthTokens()
    return null
  }
  const refreshedTokens = await refreshStoredSession()
  return refreshedTokens?.token ?? null
}

export const getAuthenticatedUser = async (allowedRoles: string[]) => {
  const token = await getValidAccessToken()
  if (!token) return null
  try {
    const user = getUserFromToken(token)
    if (!hasAllowedRole(user, allowedRoles)) { await logoutStoredSession(); return null }
    return user
  } catch {
    clearAuthTokens()
    return null
  }
}

export const logoutStoredSession = async () => {
  const refreshToken = getRefreshToken()
  clearAuthTokens()
  if (!refreshToken) return
  try { await logoutRequest(refreshToken) } catch { /* sesion local cerrada */ }
}
