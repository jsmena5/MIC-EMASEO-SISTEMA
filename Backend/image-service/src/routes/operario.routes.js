import { Router } from "express"
import { getAsignaciones, completarAsignacion } from "../controllers/operario.controller.js"
import { submitFeedback, getFeedback } from "../controllers/feedback.controller.js"

const router = Router()

router.get("/asignaciones",               getAsignaciones)
router.put("/asignaciones/:id/completar", completarAsignacion)

// Feedback sobre análisis IA — accesible a OPERARIO, SUPERVISOR y ADMIN (requireStaff en GW)
router.post("/feedback/:incident_id", submitFeedback)
router.get("/feedback/:incident_id",  getFeedback)

export default router
