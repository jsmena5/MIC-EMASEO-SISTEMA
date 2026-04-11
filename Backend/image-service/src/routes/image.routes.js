import { Router } from "express"
import { validateImage } from "../services/image.service.js"

const router = Router()

router.post("/validate-image", validateImage)

export default router