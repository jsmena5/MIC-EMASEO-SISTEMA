import AsyncStorage from "@react-native-async-storage/async-storage"
import { LoginUser } from "../types/user.types"
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
