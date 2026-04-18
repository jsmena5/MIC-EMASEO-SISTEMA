import AsyncStorage from "@react-native-async-storage/async-storage"
import { LoginUser, PasswordResetData } from "../types/user.types"
import api from "../utils/api"

export const loginUser = async (data: LoginUser) => {
  const res = await api.post("/auth/login", data)

  const { token, refreshToken } = res.data

  await AsyncStorage.multiSet([
    ["token",        token],
    ["refreshToken", refreshToken],
  ])

  return res
}

/** Paso 1 — solicita el OTP de recuperación; siempre responde 200 (no revela si el email existe) */
export const requestPasswordReset = (email: string) =>
  api.post("/auth/forgot-password", { email })

/** Paso 2 — valida el OTP antes de mostrar el formulario de nueva contraseña */
export const verifyPasswordResetOtp = (email: string, otp: string) =>
  api.post("/auth/verify-reset-otp", { email, otp })

/** Paso 3 — actualiza la contraseña y devuelve un nuevo par de tokens */
export const resetPassword = async (data: PasswordResetData) => {
  const res = await api.post("/auth/reset-password", data)
  const { token, refreshToken } = res.data
  await AsyncStorage.multiSet([
    ["token",        token],
    ["refreshToken", refreshToken],
  ])
  return res
}

// Notifica al backend para revocar el refresh token y limpia el almacenamiento local.
// Si el backend falla igual limpiamos (el token expirará solo en 7 días).
export const logoutUser = async () => {
  try {
    const refreshToken = await AsyncStorage.getItem("refreshToken")
    if (refreshToken) await api.post("/auth/logout", { refreshToken })
  } finally {
    await AsyncStorage.multiRemove(["token", "refreshToken"])
  }
}
