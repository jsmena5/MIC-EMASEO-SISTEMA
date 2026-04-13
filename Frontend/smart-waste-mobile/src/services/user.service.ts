// src/services/user.service.ts
import AsyncStorage from "@react-native-async-storage/async-storage"
import { OtpVerify, PreRegisterUser, SetPasswordData } from "../types/user.types"
import api from "../utils/api"

/** Paso 1: envía datos básicos y dispara el OTP al correo */
export const registerUser = (data: PreRegisterUser) => {
  return api.post("/users/register", data)
}

/** Paso 2: valida el OTP de 6 dígitos */
export const verifyOtp = (data: OtpVerify) => {
  return api.post("/users/verify-email", data)
}

/** Paso 3: crea la contraseña, completa el registro y retorna JWT */
export const setPassword = async (data: SetPasswordData) => {
  const res = await api.post("/users/set-password", data)

  const token: string = res.data.token

  await AsyncStorage.setItem("token", token)
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`

  return res
}
