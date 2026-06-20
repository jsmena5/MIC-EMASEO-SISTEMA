import { clearAuthTokens, getValidAccessToken, refreshStoredSession } from "../../features/auth/authSession"

const buildAuthHeaders = (init: RequestInit, token: string) => {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  return headers
}

export const authenticatedFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const token = await getValidAccessToken()
  if (!token) throw new Error("Sesion expirada")

  let headers = buildAuthHeaders(init, token)
  let res = await fetch(input, { ...init, headers })

  if (res.status !== 401) return res

  const refreshedTokens = await refreshStoredSession()
  if (!refreshedTokens) {
    clearAuthTokens()
    return res
  }

  headers = buildAuthHeaders(init, refreshedTokens.token)
  res = await fetch(input, { ...init, headers })

  if (res.status === 401) clearAuthTokens()

  return res
}
