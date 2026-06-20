import { CitizenProfile, OtpVerify, PreRegisterUser, SetPasswordData, UpdateProfileData } from "../types/user.types"
import api from "../utils/api"
import { saveSecure } from "../utils/secureStorage"

/** Paso 1: envía datos básicos y dispara el OTP al correo */
export const registerUser = (data: PreRegisterUser) =>
  api.post("/users/register", data)

/** Paso 2: valida el OTP de 6 dígitos */
export const verifyOtp = (data: OtpVerify) =>
  api.post("/users/verify-email", data)

/** Paso 3: crea la contraseña, completa el registro y retorna JWT */
export const setPassword = async (data: SetPasswordData) => {
  const res = await api.post("/users/set-password", data)
  const token: string        = res.data.token
  const refreshToken: string = res.data.refreshToken
  await saveSecure("emaseo_access_token", token)
  if (refreshToken) await saveSecure("emaseo_refresh_token", refreshToken)
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`
  return res
}

/** Obtiene el perfil completo del ciudadano autenticado */
export const getProfile = async (): Promise<CitizenProfile> => {
  const res = await api.get<CitizenProfile>("/users/profile")
  return res.data
}

/** Actualiza los campos editables del perfil (teléfono, fecha_nacimiento, sexo) */
export const updateProfile = async (data: UpdateProfileData): Promise<CitizenProfile> => {
  const res = await api.put<CitizenProfile>("/users/profile", data)
  return res.data
}

/**
 * Registra o actualiza el token FCM del dispositivo actual.
 *
 * Llama a POST /api/users/push-token que ya existe en users-service.
 * Falla silenciosamente para no interrumpir el flujo de autenticación.
 */
export const registerDeviceToken = async (
  token: string,
  platform: "ios" | "android" | "web",
  appVersion?: string,
): Promise<void> => {
  try {
    await api.post("/users/push-token", { token, platform, app_version: appVersion })
  } catch {
    // No propagamos — un fallo en el registro de push no debe bloquear la sesión
  }
}
