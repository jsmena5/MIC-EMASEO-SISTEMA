import { Router } from "express"
import { registerUser, verifyOtp, setPassword, registerPushToken } from "../controllers/user.controller.js"

const router = Router()

router.post("/register",     registerUser)       // Paso 1: datos + OTP
router.post("/verify-email", verifyOtp)          // Paso 2: validar OTP
router.post("/set-password", setPassword)        // Paso 3: crear contraseña → JWT
router.post("/push-token",   registerPushToken)  // Registrar/actualizar token de push

export default router
