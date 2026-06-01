import { Router } from "express"
import {
  registerUser, verifyOtp, setPassword, registerPushToken,
  getProfile, updateProfile,
} from "../controllers/user.controller.js"

const router = Router()

router.post("/register",     registerUser)       // Paso 1: datos + OTP
router.post("/verify-email", verifyOtp)          // Paso 2: validar OTP
router.post("/set-password", setPassword)        // Paso 3: crear contraseña → JWT
router.post("/push-token",   registerPushToken)  // Registrar/actualizar token de push

// Perfil del ciudadano — requieren x-user-id inyectado por el gateway
router.get("/profile",  getProfile)
router.put("/profile",  updateProfile)

export default router
