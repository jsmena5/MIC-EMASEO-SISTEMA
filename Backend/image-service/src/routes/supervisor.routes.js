import { Router } from "express"
import {
  listIncidents,
  getIncidentDetail,
  cambiarEstado,
  asignarIncidente,
  estadisticasZonas,
  listOperarios,
  mapaZonas,
} from "../controllers/supervisor.controller.js"

const router = Router()

router.get("/incidents",               listIncidents)
router.get("/incidents/:id",           getIncidentDetail)
router.put("/incidents/:id/estado",    cambiarEstado)
router.post("/incidents/:id/asignar",  asignarIncidente)
router.get("/zonas/mapa",             mapaZonas)
router.get("/zonas/estadisticas",      estadisticasZonas)
router.get("/operarios",               listOperarios)

export default router
