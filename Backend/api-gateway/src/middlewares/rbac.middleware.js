// ============================================================================
// RBAC Middleware — MIC-EMASEO API Gateway
// Depende de verifyToken: debe aplicarse DESPUÉS de que req.user esté poblado.
// ============================================================================

/**
 * Factory que genera un middleware de control de acceso por rol.
 * @param {...string} roles - Roles permitidos para acceder a la ruta.
 * @returns Express middleware que retorna 403 si el rol no está en la lista.
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.rol)) {
    return res.status(403).json({
      message: `Acceso denegado. Se requiere uno de: ${roles.join(", ")}`
    })
  }
  next()
}

// Atajos semánticos — usar directamente como middleware en las rutas
export const requireCiudadano  = requireRole("CIUDADANO")
export const requireStaff      = requireRole("OPERARIO", "SUPERVISOR", "ADMIN")
export const requireSupervisor = requireRole("SUPERVISOR", "ADMIN")
export const requireAdmin      = requireRole("ADMIN")
