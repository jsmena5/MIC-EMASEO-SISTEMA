import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

const BASE = `${API_URL}/users/operarios`

export interface Operario {
  id: string
  nombre: string
  apellido: string
  cedula: string
  telefono: string
  zona_id: string | null
  cargo: string | null
  email: string
  rol: string
  estado: "ACTIVO" | "INACTIVO" | "SUSPENDIDO"
}

export interface CreateOperarioPayload {
  nombre: string
  apellido: string
  cedula: string
  telefono: string
  email: string
  cargo?: string
  password?: string
}

export interface UpdateOperarioPayload {
  nombre?: string
  apellido?: string
  telefono?: string
  cargo?: string
  estado?: "ACTIVO" | "INACTIVO" | "SUSPENDIDO"
  zona_id?: string | null
}

export const getOperarios = async (): Promise<Operario[]> => {
  const res = await authenticatedFetch(BASE)
  if (!res.ok) throw new Error("Error al obtener operarios")
  return res.json()
}

export const createOperario = async (
  data: CreateOperarioPayload,
): Promise<{ message: string; password_temporal?: string }> => {
  const res = await authenticatedFetch(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? "Error al crear operario")
  }
  return res.json()
}

export const updateOperario = async (id: string, data: UpdateOperarioPayload) => {
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

export const deleteOperario = async (id: string) => {
  const res = await authenticatedFetch(`${BASE}/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error("Error al desactivar operario")
  return res.json()
}

// TODO P1: resetear contraseña de operario (endpoint pendiente en users-service)
