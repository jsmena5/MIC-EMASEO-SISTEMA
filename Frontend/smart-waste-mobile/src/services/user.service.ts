// src/services/user.service.ts
import { RegisterUser } from "../types/user.types"
import api from "../utils/api"

export const registerUser = (data: RegisterUser) => {
  return api.post("users/register", data)
}