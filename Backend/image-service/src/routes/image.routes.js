import { Router } from "express"
import { validateImage, analyzeImage } from "../services/image.service.js"

const router = Router()

router.post("/validate-image", validateImage)
router.post("/analyze", analyzeImage)

export default router