import { Router } from "express"
import {
  getSupervisores,
  getSupervisorById,
  createSupervisor,
  updateSupervisor,
  deleteSupervisor
} from "../controllers/supervisor.controller.js"

const router = Router()

router.get("/supervisores", getSupervisores)
router.get("/supervisores/:id", getSupervisorById)
router.post("/supervisores", createSupervisor)
router.put("/supervisores/:id", updateSupervisor)
router.delete("/supervisores/:id", deleteSupervisor)

export default router