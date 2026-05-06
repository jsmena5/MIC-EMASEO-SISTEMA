import { API_URL } from '../config/env'
import { authenticatedFetch } from '../shared/api/authenticatedFetch'

const API = `${API_URL}/users/operarios`
type UserPayload = Record<string, unknown>

// ===============================
// GET ALL
// ===============================
export const getOperarios = async () => {
  const res = await authenticatedFetch(API)
  if (!res.ok) throw new Error("Error al obtener operarios")
  return res.json()
}

// ===============================
// GET BY ID
// ===============================
export const getOperarioById = async (id: string) => {
  const res = await authenticatedFetch(`${API}/${id}`)
  if (!res.ok) throw new Error("Error")
  return res.json()
}

// ===============================
// CREATE
// ===============================
export const createOperario = async (data: UserPayload) => {
  const res = await authenticatedFetch(API, {
    method: "POST",
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error creando")
  return res.json()
}

// ===============================
// UPDATE
// ===============================
export const updateOperario = async (id: string, data: UserPayload) => {
  const res = await authenticatedFetch(`${API}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error actualizando")
  return res.json()
}

// ===============================
// DELETE
// ===============================
export const deleteOperario = async (id: string) => {
  const res = await authenticatedFetch(`${API}/${id}`, { method: "DELETE" })

  if (!res.ok) throw new Error("Error eliminando")
  return res.json()
}
