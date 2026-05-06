import { API_URL } from '../config/env'

const API = `${API_URL}/supervisores`

// token desde localStorage
const getHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`
})

// ===============================
// GET ALL
// ===============================
export const getSupervisores = async () => {
  const res = await fetch(API, { headers: getHeaders() })
  if (!res.ok) throw new Error("Error al obtener supervisores")
  return res.json()
}

// ===============================
// GET BY ID
// ===============================
export const getSupervisorById = async (id: string) => {
  const res = await fetch(`${API}/${id}`, { headers: getHeaders() })
  if (!res.ok) throw new Error("Error")
  return res.json()
}

// ===============================
// CREATE
// ===============================
export const createSupervisor = async (data: any) => {
  const res = await fetch(API, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error creando")
  return res.json()
}

// ===============================
// UPDATE
// ===============================
export const updateSupervisor = async (id: string, data: any) => {
  const res = await fetch(`${API}/${id}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error actualizando")
  return res.json()
}

// ===============================
// DELETE
// ===============================
export const deleteSupervisor = async (id: string) => {
  const res = await fetch(`${API}/${id}`, {
    method: "DELETE",
    headers: getHeaders()
  })

  if (!res.ok) throw new Error("Error eliminando")
  return res.json()
}

// ===============================
// MAPA DE ZONAS
// ===============================

export interface ZonaProperties {
  id: string
  codigo: string
  nombre: string
  supervisor: string | null
  incidentes_activos: number
  pendientes: number
  en_atencion: number
  criticas: number
  ultimas_24h: number
  nivel: 'critico' | 'alto' | 'medio' | 'bajo' | 'sin_actividad'
}

export interface IncidenteMapa {
  id: string
  estado: string
  prioridad: string | null
  descripcion: string | null
  zona_id: string | null
  zona_nombre: string | null
  created_at: string
  latitud: number
  longitud: number
}

export interface ZonaFeature {
  type: 'Feature'
  geometry: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  properties: ZonaProperties
}

export interface MapaZonasResponse {
  zonas: {
    type: 'FeatureCollection'
    features: ZonaFeature[]
  }
  incidentes: IncidenteMapa[]
  generado_at: string
}

export async function getMapaZonas(): Promise<MapaZonasResponse> {
  const res = await fetch(`${API_URL}/supervisor/zonas/mapa`, { headers: getHeaders() })
  if (!res.ok) throw new Error('Error al obtener mapa de zonas')
  return res.json()
}