import { Router } from "express"
import { login, refresh, logout, forgotPassword, verifyResetOtp, resetPassword } from "../controllers/auth.controller.js"

const router = Router()

router.post("/login",              login)
router.post("/refresh",            refresh)
router.post("/logout",             logout)
router.post("/forgot-password",    forgotPassword)
router.post("/verify-reset-otp",   verifyResetOtp)
router.post("/reset-password",     resetPassword)

export default router
