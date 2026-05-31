import { Router } from "express"
import {
  listIncidents,
  getIncidentDetail,
  cambiarEstado,
  asignarIncidente,
  revisionIA,
  estadisticasZonas,
  listOperarios,
  mapaZonas,
} from "../controllers/supervisor.controller.js"
import { iaEstadisticas, iaDataset } from "../controllers/ia.controller.js"

const router = Router()

router.get("/incidents",                  listIncidents)
router.get("/incidents/:id",              getIncidentDetail)
router.put("/incidents/:id/estado",       cambiarEstado)
router.post("/incidents/:id/asignar",     asignarIncidente)
router.put("/incidents/:id/revision-ia",  revisionIA)
router.get("/zonas/mapa",                 mapaZonas)
router.get("/zonas/estadisticas",         estadisticasZonas)
router.get("/operarios",                  listOperarios)
router.get("/ia/estadisticas",            iaEstadisticas)
router.get("/ia/dataset",                 iaDataset)

export default router
