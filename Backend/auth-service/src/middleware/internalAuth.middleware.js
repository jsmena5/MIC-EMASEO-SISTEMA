const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN

export function internalAuth(req, res, next) {
  if (!INTERNAL_TOKEN) {
    console.error("[auth-service] INTERNAL_TOKEN no configurado — rechazando petición interna")
    return res.status(503).json({ error: "Servicio mal configurado" })
  }
  const token = req.headers["x-internal-token"]
  if (!token || token !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: "Forbidden: acceso interno no autorizado" })
  }
  next()
}
