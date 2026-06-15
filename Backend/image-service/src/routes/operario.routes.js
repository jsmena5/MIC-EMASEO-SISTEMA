import { Router } from "express"
import {
  getAsignaciones,
  getAsignacionDetalle,
  completarAsignacion,
  noAtendible,
} from "../controllers/operario.controller.js"
import { submitFeedback, getFeedback } from "../controllers/feedback.controller.js"

const router = Router()

// Listado de asignaciones activas del operario autenticado
router.get("/asignaciones",                         getAsignaciones)

// Detalle de una asignación específica
router.get("/asignaciones/:id",                     getAsignacionDetalle)

// Resolver en campo (requiere GPS + valida geocerca)
router.put("/asignaciones/:id/completar",           completarAsignacion)

// No atendible (obstáculo, acceso denegado, etc.) — devuelve a VALIDO
router.put("/asignaciones/:id/no-atendible",        noAtendible)

// Feedback sobre análisis IA — accesible a OPERARIO, SUPERVISOR y ADMIN
router.post("/feedback/:incident_id", submitFeedback)
router.get("/feedback/:incident_id",  getFeedback)

export default router
