import { Router } from "express"
import {
  getOperarios,
  getOperarioById,
  createOperario,
  updateOperario,
  deleteOperario
} from "../controllers/operarios.controller.js"

const router = Router()

router.get("/operarios", getOperarios)
router.get("/operarios/:id", getOperarioById)
router.post("/operarios", createOperario)
router.put("/operarios/:id", updateOperario)
router.delete("/operarios/:id", deleteOperario)

export default router