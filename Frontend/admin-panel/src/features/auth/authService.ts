import { API_URL } from "../../config/env"
import type { AuthTokens } from "./authSession"

export const loginRequest = async (email: string, password: string): Promise<AuthTokens> => {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tipo: "staff" }),
  })
  if (!res.ok) throw new Error("Credenciales incorrectas")
  const data = await res.json()
  if (!data.token || !data.refreshToken) throw new Error("Respuesta de login incompleta")
  return data
}

export const refreshRequest = async (refreshToken: string): Promise<AuthTokens> => {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) throw new Error("Refresh error")
  const data = await res.json()
  if (!data.token || !data.refreshToken) throw new Error("Respuesta de refresh incompleta")
  return data
}

export const logoutRequest = async (refreshToken: string) => {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })
}

export const forgotPasswordRequest = async (email: string): Promise<void> => {
  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message ?? "Error al enviar el correo")
  }
}

export const changePasswordRequest = async (
  currentPassword: string,
  newPassword: string,
  token: string,
): Promise<void> => {
  const res = await fetch(`${API_URL}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message ?? "Error al cambiar la contraseña")
  }
}
