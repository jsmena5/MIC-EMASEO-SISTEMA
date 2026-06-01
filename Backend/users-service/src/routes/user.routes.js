import { Router } from "express"
import {
  registerUser, verifyOtp, setPassword, registerPushToken,
  getProfile, updateProfile,
  listCiudadanos, updateCiudadanoEstado, resetCiudadanoPassword,
} from "../controllers/user.controller.js"

const router = Router()

// Registro público (sin auth)
router.post("/register",      registerUser)
router.post("/verify-email",  verifyOtp)
router.post("/set-password",  setPassword)
router.post("/push-token",    registerPushToken)

// Perfil del ciudadano (x-user-id inyectado por el gateway)
router.get("/profile",  getProfile)
router.put("/profile",  updateProfile)

// Gestión de ciudadanos (rol ADMIN — verificado en el gateway)
router.get( "/ciudadanos",                    listCiudadanos)
router.put( "/ciudadanos/:id/estado",         updateCiudadanoEstado)
router.post("/ciudadanos/:id/reset-password", resetCiudadanoPassword)

export default router
