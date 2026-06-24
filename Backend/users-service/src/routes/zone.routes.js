import { Router } from "express"
import {
  listZonas,
  updateZona,
  importZonas,
  rezonificarIncidentes,
  getConfig,
  setConfigValue,
} from "../controllers/zone.controller.js"

const router = Router()

router.get("/zonas",             listZonas)
router.put("/zonas/:id",         updateZona)
router.post("/zonas/import",     importZonas)
router.post("/zonas/rezonificar", rezonificarIncidentes)

router.get("/config/:clave",     getConfig)
router.put("/config/:clave",     setConfigValue)

export default router
