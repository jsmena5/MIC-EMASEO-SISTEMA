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
  getMiZona,
} from "../controllers/supervisor.controller.js"
import { iaEstadisticas, iaDataset, listarImagenes, etiquetarImagen, hardExamples } from "../controllers/ia.controller.js"

const router = Router()

router.get("/incidents",                  listIncidents)
router.get("/incidents/:id",              getIncidentDetail)
router.put("/incidents/:id/estado",       cambiarEstado)
router.post("/incidents/:id/asignar",     asignarIncidente)
router.put("/incidents/:id/revision-ia",  revisionIA)
router.get("/zonas/mapa",                 mapaZonas)
router.get("/mi-zona",                    getMiZona)
router.get("/zonas/estadisticas",         estadisticasZonas)
router.get("/operarios",                  listOperarios)
router.get("/ia/estadisticas",                          iaEstadisticas)
router.get("/ia/dataset",                               iaDataset)
router.get("/ia/hard-examples",                         hardExamples)
router.get("/ia/imagenes",                              listarImagenes)
router.put("/ia/imagenes/:incident_id/etiqueta",        etiquetarImagen)

export default router
