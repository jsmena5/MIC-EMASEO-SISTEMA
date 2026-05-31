import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

export type ImageAuditLabel = "PENDIENTE" | "VALIDA_ENTRENAMIENTO" | "DUDOSA" | "EXCLUIR"

export interface ImagenAuditoria {
  incident_id:                   string
  estado:                        string
  image_url:                     string | null
  created_at:                    string
  nivel_acumulacion:             string | null
  tipo_residuo:                  string | null
  confianza:                     number | null
  ia_fue_correcta:               boolean | null
  nivel_acumulacion_supervisor:  string | null
  tipo_residuo_supervisor:       string | null
  etiqueta:                      ImageAuditLabel
  comentario:                    string | null
  etiquetado_at:                 string | null
  etiquetado_por_email:          string | null
}

export interface ListImagenesResponse {
  imagenes:   ImagenAuditoria[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const listImagenes = async (params: {
  page?: number
  limit?: number
  etiqueta?: ImageAuditLabel | ""
  ia_correcta?: "true" | "false" | ""
}): Promise<ListImagenesResponse> => {
  const q = new URLSearchParams()
  if (params.page)        q.set("page",        String(params.page))
  if (params.limit)       q.set("limit",       String(params.limit))
  if (params.etiqueta)    q.set("etiqueta",    params.etiqueta)
  if (params.ia_correcta) q.set("ia_correcta", params.ia_correcta)

  const res = await authenticatedFetch(`${API_URL}/supervisor/ia/imagenes?${q}`)
  if (!res.ok) throw new Error("Error al cargar imágenes")
  return res.json()
}

export const etiquetarImagen = async (
  incident_id: string,
  etiqueta: ImageAuditLabel,
  comentario?: string,
): Promise<void> => {
  const res = await authenticatedFetch(
    `${API_URL}/supervisor/ia/imagenes/${incident_id}/etiqueta`,
    { method: "PUT", body: JSON.stringify({ etiqueta, comentario }) },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al etiquetar imagen")
  }
}
