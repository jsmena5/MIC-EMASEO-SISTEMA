import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

const BASE = `${API_URL}/users/supervisores`

export interface Supervisor {
  id: string
  nombre: string
  apellido: string
  cedula: string
  telefono: string
  zona_id?: string | null
  email: string
  rol: string
  estado: "ACTIVO" | "INACTIVO" | "SUSPENDIDO"
}

export interface CreateSupervisorPayload {
  nombre: string
  apellido: string
  cedula: string
  telefono: string
  email: string
  password?: string
}

export interface UpdateSupervisorPayload {
  nombre?: string
  apellido?: string
  telefono?: string
  estado?: "ACTIVO" | "INACTIVO" | "SUSPENDIDO"
}

export const getSupervisores = async (): Promise<Supervisor[]> => {
  const res = await authenticatedFetch(BASE)
  if (!res.ok) throw new Error("Error al obtener supervisores")
  return res.json()
}

export const getSupervisorById = async (id: string): Promise<Supervisor> => {
  const res = await authenticatedFetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error("Supervisor no encontrado")
  return res.json()
}

export const createSupervisor = async (
  data: CreateSupervisorPayload,
): Promise<{ message: string; password_temporal?: string }> => {
  const res = await authenticatedFetch(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? "Error al crear supervisor")
  }
  return res.json()
}

export const updateSupervisor = async (id: string, data: UpdateSupervisorPayload) => {
  const res = await authenticatedFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? "Error al actualizar")
  }
  return res.json()
}

export const deleteSupervisor = async (id: string) => {
  const res = await authenticatedFetch(`${BASE}/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error("Error al desactivar supervisor")
  return res.json()
}
