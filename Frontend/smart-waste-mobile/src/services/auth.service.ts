import { LoginUser } from "../types/user.types"
import api from "../utils/api"

export const loginUser = async (data: LoginUser) => {
  const res = await api.post("/auth/login", data)

  const token = res.data.token

  api.defaults.headers.common["Authorization"] = `Bearer ${token}`

  return res
}