import { LoginUser } from "../types/user.types"
import api from "../utils/api"

export const loginUser = (data: LoginUser) => {
  return api.post(":3002/api/auth/login", data)
}