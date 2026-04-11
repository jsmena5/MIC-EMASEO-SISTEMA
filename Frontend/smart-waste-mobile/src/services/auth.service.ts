import { LoginUser } from "../types/user.types"
import api from "../utils/api"

import AsyncStorage from "@react-native-async-storage/async-storage"

export const loginUser = async (data: LoginUser) => {
  const res = await api.post("/auth/login", data)

  const token = res.data.token

  // guardar token
  await AsyncStorage.setItem("token", token)

  api.defaults.headers.common["Authorization"] = `Bearer ${token}`

  return res
}