const API = "http://localhost:4000/api/users/operarios"

// token desde localStorage (login)
const getHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`
})

// ===============================
// GET ALL
// ===============================
export const getOperarios = async () => {
  const res = await fetch(API, { headers: getHeaders() })
  if (!res.ok) throw new Error("Error al obtener operarios")
  return res.json()
}

// ===============================
// GET BY ID
// ===============================
export const getOperarioById = async (id: string) => {
  const res = await fetch(`${API}/${id}`, { headers: getHeaders() })
  if (!res.ok) throw new Error("Error")
  return res.json()
}

// ===============================
// CREATE
// ===============================
export const createOperario = async (data: any) => {
  const res = await fetch(API, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error creando")
  return res.json()
}

// ===============================
// UPDATE
// ===============================
export const updateOperario = async (id: string, data: any) => {
  const res = await fetch(`${API}/${id}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data)
  })

  if (!res.ok) throw new Error("Error actualizando")
  return res.json()
}

// ===============================
// DELETE
// ===============================
export const deleteOperario = async (id: string) => {
  const res = await fetch(`${API}/${id}`, {
    method: "DELETE",
    headers: getHeaders()
  })

  if (!res.ok) throw new Error("Error eliminando")
  return res.json()
}