import { Router } from "express"
import { getMyIncidents } from "../services/image.service.js"

const router = Router()

router.get("/me", getMyIncidents)

export default router
