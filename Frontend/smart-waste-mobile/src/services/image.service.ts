import api from "../utils/api"

export const validateImage = async (imageBase64: string) => {
  try {
    const res = await api.post("/image/validate-image", {
      image: imageBase64,
    })
    return res.data
  } catch (error) {
    console.error("Error validando imagen", error)
    throw error
  }
}

export interface AnalysisResult {
  success: boolean
  incident_id: string
  zona_id: string | null
  nivel_acumulacion: "BAJO" | "MEDIO" | "ALTO" | "CRITICO"
  volumen_estimado_m3: number
  prioridad: "BAJA" | "MEDIA" | "ALTA" | "CRITICA"
  tipo_residuo: string
  confianza: number
  num_detecciones: number
  coverage_ratio: number
  tiempo_inferencia_ms: number
  estado: string
  message: string
  scale_penalty_applied?: boolean
}

export interface Incident {
  id: string
  estado: "PENDIENTE" | "EN_ATENCION" | "RESUELTA" | "RECHAZADA"
  prioridad: "BAJA" | "MEDIA" | "ALTA" | "CRITICA"
  descripcion: string | null
  created_at: string
  image_url: string | null
  nivel_acumulacion: "BAJO" | "MEDIO" | "ALTO" | "CRITICO" | null
  tipo_residuo: string | null
  confianza: number | null
  num_detecciones: number | null
  latitud?: number | null
  longitud?: number | null
}

export const getMyIncidents = async (): Promise<Incident[]> => {
  const res = await api.get("/incidents/me")
  return res.data.incidents
}

export const analyzeImage = async (
  imageBase64: string,
  latitude: number,
  longitude: number,
  descripcion?: string,
  options?: {
    signal?: AbortSignal
    onUploadProgress?: (percentage: number) => void
  }
): Promise<AnalysisResult> => {
  const res = await api.post(
    "/image/analyze",
    { image: imageBase64, latitude, longitude, descripcion: descripcion ?? "" },
    {
      signal: options?.signal,
      onUploadProgress: options?.onUploadProgress
        ? (e) => {
            const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
            options.onUploadProgress!(pct)
          }
        : undefined,
    }
  )
  return res.data
}
