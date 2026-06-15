import api from "../utils/api"

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
  const { data } = await api.get("/operario/asignaciones")
  return data.asignaciones
}

export const getAsignacionDetalle = async (id: string): Promise<Asignacion> => {
  const { data } = await api.get(`/operario/asignaciones/${id}`)
  return data
}

export const completarAsignacion = async (
  id: string,
  payload: { cierre_lat: number; cierre_lon: number; foto_cierre_url?: string },
): Promise<{ message: string; distancia_cierre_m: number }> => {
  const { data } = await api.put(`/operario/asignaciones/${id}/completar`, payload)
  return data
}

export const noAtendible = async (id: string, motivo: string): Promise<void> => {
  await api.put(`/operario/asignaciones/${id}/no-atendible`, { motivo })
}
