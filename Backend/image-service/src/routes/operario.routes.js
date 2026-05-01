import { Router } from "express"
import { getAsignaciones, completarAsignacion } from "../controllers/operario.controller.js"

const router = Router()

router.get("/asignaciones",               getAsignaciones)
router.put("/asignaciones/:id/completar", completarAsignacion)

export default router
