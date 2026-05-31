import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

export interface IATotales {
  total_analizados:   string
  total_supervisados: string
  correctos:          string
  incorrectos:        string
  pendientes_revision: string
  precision_pct:      string | null
}

export interface ErrorTipo {
  tipo_ml:   string | null
  tipo_real: string | null
  total:     string
}

export interface ErrorNivel {
  nivel_ml:   string | null
  nivel_real: string | null
  total:      string
}

export interface Correccion {
  incident_id:    string
  nivel_ml:       string | null
  tipo_ml:        string | null
  confianza:      number | null
  nivel_real:     string | null
  tipo_real:      string | null
  nota_supervision: string | null
  supervisado_at: string
  supervisor_email: string
  image_url:      string | null
}

export interface IAEstadisticasResponse {
  totales:              IATotales
  errores_por_tipo:     ErrorTipo[]
  errores_por_nivel:    ErrorNivel[]
  ultimas_correcciones: Correccion[]
}

export const getIAEstadisticas = async (): Promise<IAEstadisticasResponse> => {
  const res = await authenticatedFetch(`${API_URL}/supervisor/ia/estadisticas`)
  if (!res.ok) throw new Error("Error al obtener estadísticas IA")
  return res.json()
}

export const downloadIADataset = async (): Promise<void> => {
  const res = await authenticatedFetch(`${API_URL}/supervisor/ia/dataset`)
  if (!res.ok) throw new Error("Error al exportar dataset")
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href     = url
  a.download = `emaseo_ia_dataset_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
