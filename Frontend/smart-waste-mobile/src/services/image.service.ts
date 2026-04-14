import AsyncStorage from "@react-native-async-storage/async-storage"
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
}

export const analyzeImage = async (
  imageBase64: string,
  latitude: number,
  longitude: number,
  descripcion?: string
): Promise<AnalysisResult> => {
  // Asegurar que el token JWT esté en el header
  const token = await AsyncStorage.getItem("token")
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`
  }

  const res = await api.post("/image/analyze", {
    image: imageBase64,
    latitude,
    longitude,
    descripcion: descripcion ?? "",
  })
  return res.data
}
