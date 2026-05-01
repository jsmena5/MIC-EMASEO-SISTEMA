import { Router } from "express"
import { validateImage, analyzeImage, getTaskStatus } from "../controllers/image.controller.js"

const router = Router()

router.post("/validate-image", validateImage)
router.post("/analyze", analyzeImage)
router.get("/status/:taskId", getTaskStatus)

export default router