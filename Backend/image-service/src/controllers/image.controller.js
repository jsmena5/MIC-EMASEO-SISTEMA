import {
  validateImageBuffer,
  analyzeImage   as analyzeImageService,
  getTaskStatus  as getTaskStatusService,
} from "../services/image.service.js"

// Manejador de respuesta estándar — único punto donde se toca res
const reply = (res, httpStatus, body) => res.status(httpStatus).json(body)

// ── POST /api/image/validate-image ────────────────────────────────────────────

export const validateImage = async (req, res) => {
  const { image } = req.body

  if (!image) {
    return reply(res, 400, { valid: false, message: "El campo 'image' (base64) es requerido." })
  }

  let buffer
  try {
    buffer = Buffer.from(image, "base64")
  } catch {
    return reply(res, 400, { valid: false, message: "Imagen corrupta o inválida." })
  }

  try {
    return reply(res, 200, validateImageBuffer(buffer))
  } catch (err) {
    console.error("[image-controller] validateImage:", err.message)
    return reply(res, 500, { valid: false, message: "Error interno al validar la imagen." })
  }
}

// ── POST /api/image/analyze ───────────────────────────────────────────────────
// Delega toda la lógica al service; sólo extrae parámetros de req y mapea
// el resultado (o error tipado) a una respuesta HTTP.

export const analyzeImage = async (req, res) => {
  const { image, latitude, longitude, descripcion } = req.body
  const userId = req.headers["x-user-id"]

  console.log(`[image-controller] POST /analyze userId=${userId} lat=${latitude} lon=${longitude}`)

  try {
    const result = await analyzeImageService({ image, latitude, longitude, descripcion, userId })
    const { httpStatus, ...body } = result
    return reply(res, httpStatus, body)
  } catch (err) {
    console.error(`[image-controller] analyzeImage: ${err.message}`)
    return reply(res, err.httpStatus ?? 500, { error: err.message })
  }
}

// ── GET /api/image/status/:taskId ─────────────────────────────────────────────
// El service retorna { httpStatus, ...data } o lanza un error con httpStatus.
// El controller sólo separa el código de estado del cuerpo y llama a reply.

export const getTaskStatus = async (req, res) => {
  const { taskId } = req.params
  const userId = req.headers["x-user-id"]

  if (!userId) {
    return reply(res, 401, { error: "No se pudo identificar al usuario." })
  }

  try {
    const result = await getTaskStatusService(taskId, userId)
    const { httpStatus, ...body } = result
    return reply(res, httpStatus, body)
  } catch (err) {
    console.error(`[image-controller] getTaskStatus: ${err.message}`)
    return reply(res, err.httpStatus ?? 500, { error: err.message })
  }
}
