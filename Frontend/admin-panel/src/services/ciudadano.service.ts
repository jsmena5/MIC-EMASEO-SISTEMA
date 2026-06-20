import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

const BASE = `${API_URL}/users/ciudadanos`

export interface Ciudadano {
  id: string
  primer_nombre: string
  segundo_nombre: string | null
  primer_apellido: string
  segundo_apellido: string | null
  email: string
  cedula_masked: string
  estado: "ACTIVO" | "INACTIVO" | "SUSPENDIDO"
  total_reportes: number
  ultimo_login: string | null
  created_at: string
}

export interface CiudadanosResponse {
  ciudadanos: Ciudadano[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export async function getCiudadanos(params: {
  search?: string
  estado?: string
  page?: number
  limit?: number
}): Promise<CiudadanosResponse> {
  const qs = new URLSearchParams()
  if (params.search) qs.set("search", params.search)
  if (params.estado) qs.set("estado", params.estado)
  if (params.page)   qs.set("page",   String(params.page))
  if (params.limit)  qs.set("limit",  String(params.limit))
  const res = await authenticatedFetch(`${BASE}?${qs}`)
  if (!res.ok) throw new Error(`Error ${res.status}`)
  return res.json()
}

export async function setCiudadanoEstado(
  id: string,
  estado: "ACTIVO" | "INACTIVO" | "SUSPENDIDO",
): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/${id}/estado`, {
    method: "PUT",
    body: JSON.stringify({ estado }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message ?? `Error ${res.status}`)
  }
}

export async function resetCiudadanoPassword(id: string): Promise<{ nueva_password: string }> {
  const res = await authenticatedFetch(`${BASE}/${id}/reset-password`, { method: "POST" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message ?? `Error ${res.status}`)
  }
  return res.json()
}
