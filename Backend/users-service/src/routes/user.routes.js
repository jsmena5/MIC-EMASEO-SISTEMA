import { Router } from "express"
import { registerUser, verifyOtp, setPassword } from "../controllers/user.controller.js"

const router = Router()

router.post("/register",     registerUser)  // Paso 1: datos + OTP
router.post("/verify-email", verifyOtp)     // Paso 2: validar OTP
router.post("/set-password", setPassword)   // Paso 3: crear contraseña → JWT

export default router
