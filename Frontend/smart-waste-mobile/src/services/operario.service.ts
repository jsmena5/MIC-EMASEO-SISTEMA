import axios from "axios"
import api from "../utils/api"

function apiError(err: unknown, fallback: string): Error {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as Record<string, unknown> | undefined
    const msg = body?.error ?? body?.message
    if (typeof msg === "string") return new Error(msg)
  }
  return new Error(fallback)
}

export interface Asignacion {
  asignacion_id: string
  incident_id: string
  estado: string
  prioridad: string | null
  descripcion: string | null
  direccion: string | null
  incidente_creado_at: string
  asignado_el: string
  fecha_esperada: string | null
  notas: string | null
  latitud: number
  longitud: number
  zona_nombre: string | null
  image_url: string | null
  nivel_acumulacion: string | null
  tipo_residuo: string | null
  volumen_estimado_m3: number | null
  asignado_por_nombre: string | null
}

export const getAsignaciones = async (): Promise<Asignacion[]> => {
  try {
    const { data } = await api.get("/operario/asignaciones")
    return data.asignaciones
  } catch (err) {
    throw apiError(err, "No se pudieron cargar las asignaciones.")
  }
}

export const getAsignacionDetalle = async (id: string): Promise<Asignacion> => {
  try {
    const { data } = await api.get(`/operario/asignaciones/${id}`)
    return data
  } catch (err) {
    throw apiError(err, "No se pudo cargar el detalle de la asignación.")
  }
}

export const completarAsignacion = async (
  id: string,
  payload: { cierre_lat: number; cierre_lon: number; foto_cierre_url?: string },
): Promise<{ message: string; distancia_cierre_m: number }> => {
  try {
    const { data } = await api.put(`/operario/asignaciones/${id}/completar`, payload)
    return data
  } catch (err) {
    throw apiError(err, "No se pudo completar la asignación.")
  }
}

export const noAtendible = async (id: string, motivo: string): Promise<void> => {
  try {
    await api.put(`/operario/asignaciones/${id}/no-atendible`, { motivo })
  } catch (err) {
    throw apiError(err, "No se pudo marcar como no atendible.")
  }
}
