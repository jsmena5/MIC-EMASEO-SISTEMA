import { pool } from "../db.js"
import { sendOtpEmail } from "../utils/mailer.js"
import { validarCedula } from "../utils/cedula.js"
import { validatePassword } from "../utils/passwordValidator.js"
import jwt from "jsonwebtoken"
import crypto from "crypto"
import dotenv from "dotenv"
dotenv.config()

const generateOtp = () => String(crypto.randomInt(100000, 999999))
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex")
const generateOpaqueToken = () => crypto.randomBytes(64).toString("hex")

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10)

// ─── Helper para generar contraseña temporal ──────────────────────────────────
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$"
function tempPassword(len = 12) {
  return Array.from({ length: len }, () =>
    CHARS[crypto.randomInt(CHARS.length)]
  ).join("")
}

// ─── Helpers de validación ────────────────────────────────────────────────────

// Apellidos: una sola palabra sin espacios; guiones permitidos (al final del class)
const RE_APELLIDO  = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ][a-zA-ZáéíóúÁÉÍÓÚñÑüÜ-]*$/
// Palabras individuales de nombre/apellido: solo letras
const RE_PALABRA   = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+$/
const RE_TELEFONO  = /^\+?[0-9\s()-]{7,20}$/
const SEXO_VALIDOS = ["Masculino", "Femenino", "Otro", "Prefiero no decir"]

function validarNombre(v, campo) {
  const t = v?.trim() ?? ""
  if (!t) return `${campo} es requerido`
  if (t.length > 30) return `${campo} no puede superar 30 caracteres`
  const words = t.split(/\s+/)
  if (words.length > 2) return `${campo} no puede tener más de 2 palabras`
  for (const w of words) {
    if (w.length < 2)        return `Cada palabra de ${campo} debe tener al menos 2 letras`
    if (!RE_PALABRA.test(w)) return `${campo} solo puede contener letras`
  }
  return null
}

function validarApellido(v, campo) {
  const t = v?.trim() ?? ""
  if (!t) return `${campo} es requerido`
  if (t.length < 2)  return `${campo} debe tener al menos 2 caracteres`
  if (t.length > 30) return `${campo} no puede superar 30 caracteres`
  if (!RE_APELLIDO.test(t)) return `${campo} debe ser una sola palabra (sin espacios)`
  return null
}

// ============================================================================
// POST /api/users/register  — Paso 1: datos básicos + envío de OTP
// Body: { primer_nombre, segundo_nombre?, primer_apellido, segundo_apellido, cedula, email }
// ============================================================================
export const registerUser = async (req, res) => {
  const client = await pool.connect()
  try {
    const {
      primer_nombre, segundo_nombre,
      primer_apellido, segundo_apellido,
      cedula, email,
    } = req.body

    // Validar nombres
    const errores = []
    const e1 = validarNombre(primer_nombre, "El primer nombre")
    const e2 = validarApellido(primer_apellido, "El primer apellido")
    const e3 = validarApellido(segundo_apellido, "El segundo apellido")
    if (e1) errores.push(e1)
    if (e2) errores.push(e2)
    if (e3) errores.push(e3)
    if (segundo_nombre?.trim()) {
      const e4 = validarNombre(segundo_nombre, "El segundo nombre")
      if (e4) errores.push(e4)
    }
    if (!cedula || !email) errores.push("Cédula y correo son requeridos")
    if (errores.length) return res.status(400).json({ message: errores[0] })

    // Validar cédula ecuatoriana (algoritmo módulo 10)
    if (!validarCedula(cedula)) {
      return res.status(400).json({ message: "Número de cédula inválido" })
    }

    // Para compatibilidad con el JWT y la tabla, nombre = primer_nombre, apellido = primer_apellido
    const nombre   = primer_nombre.trim()
    const apellido = primer_apellido.trim()

    // Verificar que el email y la cédula no estén ya registrados en app_auth.users
    const existe = await client.query(
      `SELECT 1 FROM app_auth.users u
       JOIN public.ciudadanos c ON c.user_id = u.id
       WHERE u.email = $1 OR c.cedula = $2
       LIMIT 1`,
      [email, cedula]
    )
    if (existe.rows.length > 0) {
      return res.status(400).json({ message: "Email o cédula ya registrados" })
    }

    const otp        = generateOtp()
    const otpHash    = hashToken(otp)          // solo el hash va a la BD
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000) // + 10 min

    // Guardar o reemplazar el registro pendiente para este email
    await client.query(
      `INSERT INTO app_auth.pending_registrations
         (nombre, apellido, segundo_nombre, segundo_apellido, cedula, email, otp_code, otp_expires_at, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
       ON CONFLICT (email) DO UPDATE SET
         nombre          = EXCLUDED.nombre,
         apellido        = EXCLUDED.apellido,
         segundo_nombre  = EXCLUDED.segundo_nombre,
         segundo_apellido = EXCLUDED.segundo_apellido,
         cedula          = EXCLUDED.cedula,
         otp_code        = EXCLUDED.otp_code,
         otp_expires_at  = EXCLUDED.otp_expires_at,
         is_verified     = FALSE,
         created_at      = NOW()`,
      [nombre, apellido, segundo_nombre?.trim() || null, segundo_apellido?.trim() || null, cedula, email, otpHash, otpExpires]
    )

    // En desarrollo, imprimir OTP en consola para testing sin SMTP
    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV] OTP para ${email}: ${otp}`)
    }

    try {
      await sendOtpEmail(email, otp)
    } catch (emailErr) {
      console.error("Error enviando OTP (no fatal):", emailErr.message)
      return res.status(201).json({
        email,
        emailSent: false,
        message: "Registro iniciado pero hubo un problema enviando el email. Contacta soporte."
      })
    }

    res.status(201).json({
      email,
      emailSent: true,
      message: "Código enviado a tu correo."
    })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error en servidor" })
  } finally {
    client.release()
  }
}

// ============================================================================
// POST /api/users/verify-email  — Paso 2: validar OTP
// Body: { email, otp }
// ============================================================================
export const verifyOtp = async (req, res) => {
  const client = await pool.connect()
  try {
    const { email, otp } = req.body

    if (!email || !otp) {
      return res.status(400).json({ message: "Email y código son requeridos" })
    }

    const result = await client.query(
      `SELECT otp_code, otp_expires_at, is_verified
       FROM app_auth.pending_registrations
       WHERE email = $1`,
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No hay un registro pendiente para este email" })
    }

    const reg = result.rows[0]

    if (reg.is_verified) {
      return res.status(400).json({ message: "El código ya fue verificado. Crea tu contraseña." })
    }

    if (!reg.otp_code || !reg.otp_expires_at) {
      return res.status(400).json({ message: "Código no disponible. Inicia el registro de nuevo." })
    }

    if (new Date() > new Date(reg.otp_expires_at)) {
      return res.status(400).json({ message: "El código expiró. Inicia el registro de nuevo." })
    }

    // Comparar hashes SHA-256 (64 hex chars, longitud fija → timingSafeEqual es seguro)
    const inputHash  = hashToken(otp.trim())
    const storedHash = reg.otp_code
    const a = Buffer.from(inputHash,  "hex")
    const b = Buffer.from(storedHash, "hex")
    const match = crypto.timingSafeEqual(a, b)

    if (!match) {
      return res.status(400).json({ message: "Código incorrecto" })
    }

    // Marcar como verificado — el OTP ya cumplió su función
    await client.query(
      `UPDATE app_auth.pending_registrations
       SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL
       WHERE email = $1`,
      [email]
    )

    res.json({ email, verified: true })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error en servidor" })
  } finally {
    client.release()
  }
}

// ============================================================================
// POST /api/users/set-password  — Paso 3: crear contraseña y completar registro
// Body: { email, password }
// ============================================================================
export const setPassword = async (req, res) => {
  const client = await pool.connect()
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" })
    }

    const pwCheck = validatePassword(password)
    if (!pwCheck.valid) {
      return res.status(400).json({ message: pwCheck.message })
    }

    // Leer datos del registro pendiente — debe estar verificado
    const result = await client.query(
      `SELECT nombre, apellido, segundo_nombre, segundo_apellido, cedula
       FROM app_auth.pending_registrations
       WHERE email = $1 AND is_verified = TRUE`,
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Email no verificado o registro no encontrado" })
    }

    const { nombre, apellido, segundo_nombre, segundo_apellido, cedula } = result.rows[0]

    const username = `usr_${crypto.randomBytes(8).toString("hex")}`

    await client.query("BEGIN")

    // 1. Crear cuenta en app_auth.users
    const userResult = await client.query(
      `INSERT INTO app_auth.users
         (username, email, password_hash, estado, is_verified)
       VALUES
         ($1, $2, crypt($3, gen_salt('bf', $4)), 'ACTIVO', TRUE)
       RETURNING id, username, email, rol`,
      [username, email, password, BCRYPT_ROUNDS]
    )
    const user = userResult.rows[0]

    // 2. Crear perfil en public.ciudadanos
    await client.query(
      `INSERT INTO public.ciudadanos (user_id, nombre, apellido, segundo_nombre, segundo_apellido, cedula)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, nombre, apellido, segundo_nombre ?? null, segundo_apellido ?? null, cedula]
    )

    // 3. Registrar consentimiento LOPDP (art. 8 — consentimiento libre, específico e informado)
    const ipOrigen   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null
    const userAgent  = req.headers['user-agent'] || null
    await client.query(
      `INSERT INTO app_auth.user_consents (user_id, version_politica, ip_origen, user_agent)
       VALUES ($1, $2, $3::inet, $4)`,
      [user.id, '1.0', ipOrigen, userAgent]
    )

    // 4. Eliminar el registro temporal
    await client.query(
      `DELETE FROM app_auth.pending_registrations WHERE email = $1`,
      [email]
    )

    // 5. Crear refresh token para sesión persistente tras el registro
    const rawRefreshToken = generateOpaqueToken()
    const refreshHash = hashToken(rawRefreshToken)
    const refreshExpires = new Date(Date.now() + 7 * 86_400_000)
    await client.query(
      `INSERT INTO app_auth.refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshHash, refreshExpires]
    )

    await client.query("COMMIT")

    // 4. Emitir JWT (mismo payload que auth-service/login)
    const token = jwt.sign(
      {
        id:          user.id,
        username:    user.username,
        rol:         user.rol,
        nombre,
        tipo_perfil: "ciudadano"
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
    )

    res.json({ token, refreshToken: rawRefreshToken })

  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)

    if (error.code === "23505") {
      return res.status(400).json({ message: "Email o cédula ya registrados" })
    }

    res.status(500).json({ message: "Error en servidor" })
  } finally {
    client.release()
  }
}

// ============================================================================
// GET /api/users/profile  — Perfil completo del ciudadano autenticado
// Header: x-user-id (inyectado por el gateway)
// ============================================================================
const PROFILE_QUERY = `
  SELECT
    c.nombre            AS primer_nombre,
    c.segundo_nombre,
    c.apellido          AS primer_apellido,
    c.segundo_apellido,
    c.telefono,
    c.fecha_nacimiento,
    c.sexo,
    u.email,
    u.username,
    u.created_at,
    CASE
      WHEN length(c.cedula) = 10
      THEN substring(c.cedula, 1, 3) || '****' || substring(c.cedula, 8)
      ELSE '**********'
    END AS cedula_masked
  FROM public.ciudadanos c
  JOIN app_auth.users u ON u.id = c.user_id
  WHERE c.user_id = $1
`

export const getProfile = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ message: "No autenticado." })

  try {
    const { rows } = await pool.query(PROFILE_QUERY, [userId])
    if (!rows.length) return res.status(404).json({ message: "Perfil no encontrado." })
    return res.json(rows[0])
  } catch (err) {
    console.error("[users-controller] getProfile:", err.message)
    return res.status(500).json({ message: "Error al obtener el perfil." })
  }
}

// ============================================================================
// PUT /api/users/profile  — Actualizar datos editables del perfil
// Body: { telefono?, fecha_nacimiento?, sexo? }
// Header: x-user-id (inyectado por el gateway)
// ============================================================================
export const updateProfile = async (req, res) => {
  const userId = req.headers["x-user-id"]
  if (!userId) return res.status(401).json({ message: "No autenticado." })

  const { telefono, fecha_nacimiento, sexo } = req.body

  // Validar sexo
  if (sexo !== undefined && sexo !== null && !SEXO_VALIDOS.includes(sexo)) {
    return res.status(400).json({ message: `Valor de sexo inválido. Opciones: ${SEXO_VALIDOS.join(", ")}.` })
  }

  // Validar fecha de nacimiento
  if (fecha_nacimiento) {
    const d = new Date(fecha_nacimiento)
    if (isNaN(d.getTime())) {
      return res.status(400).json({ message: "Fecha de nacimiento inválida." })
    }
    const edadAnios = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (edadAnios < 13 || edadAnios > 120) {
      return res.status(400).json({ message: "Fecha de nacimiento fuera de rango (13–120 años)." })
    }
  }

  // Validar teléfono
  if (telefono !== undefined && telefono !== null && telefono !== "") {
    if (!RE_TELEFONO.test(telefono.trim())) {
      return res.status(400).json({ message: "Número de teléfono inválido (7–20 dígitos)." })
    }
  }

  try {
    await pool.query(
      `UPDATE public.ciudadanos SET
         telefono         = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE telefono END,
         fecha_nacimiento = CASE WHEN $3::date IS NOT NULL THEN $3::date ELSE fecha_nacimiento END,
         sexo             = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE sexo END,
         updated_at       = NOW()
       WHERE user_id = $1`,
      [
        userId,
        telefono?.trim() ?? null,
        fecha_nacimiento ?? null,
        sexo ?? null,
      ]
    )

    // Devolver perfil actualizado
    const { rows } = await pool.query(PROFILE_QUERY, [userId])
    return res.json(rows[0])
  } catch (err) {
    console.error("[users-controller] updateProfile:", err.message)
    return res.status(500).json({ message: "Error al actualizar el perfil." })
  }
}

// ============================================================================
// GET /api/users/ciudadanos  — Lista paginada de ciudadanos (ADMIN)
// Query: page, limit, search, estado
// ============================================================================
export const listCiudadanos = async (req, res) => {
  const { search = "", estado = "", page = 1, limit = 20 } = req.query
  const pageNum  = Math.max(1, Number(page))
  const pageSize = Math.min(50, Math.max(1, Number(limit)))
  const offset   = (pageNum - 1) * pageSize

  const conditions = ["u.rol = 'CIUDADANO'"]
  const params     = []

  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`)
    const p = params.length
    conditions.push(
      `(LOWER(c.nombre) LIKE $${p}
       OR LOWER(c.segundo_nombre) LIKE $${p}
       OR LOWER(c.apellido) LIKE $${p}
       OR LOWER(c.segundo_apellido) LIKE $${p}
       OR LOWER(u.email) LIKE $${p}
       OR c.cedula LIKE $${p}
       OR LOWER(c.nombre || ' ' || c.apellido) LIKE $${p})`
    )
  }
  if (estado) {
    params.push(estado)
    conditions.push(`u.estado = $${params.length}`)
  }

  const where = "WHERE " + conditions.join(" AND ")

  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT
           u.id,
           c.nombre          AS primer_nombre,
           c.segundo_nombre,
           c.apellido        AS primer_apellido,
           c.segundo_apellido,
           u.email,
           u.estado,
           u.ultimo_login,
           u.created_at,
           CASE WHEN length(c.cedula) = 10
             THEN substring(c.cedula,1,3)||'****'||substring(c.cedula,8)
             ELSE '**********' END AS cedula_masked,
           (SELECT COUNT(*) FROM incidents.incidents i WHERE i.reportado_por = u.id) AS total_reportes
         FROM app_auth.users u
         JOIN public.ciudadanos c ON c.user_id = u.id
         ${where}
         ORDER BY u.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM app_auth.users u
         JOIN public.ciudadanos c ON c.user_id = u.id
         ${where}`,
        params
      ),
    ])

    const total = parseInt(countRows[0].total, 10)
    return res.json({
      ciudadanos: rows,
      pagination: { total, page: pageNum, limit: pageSize, pages: Math.ceil(total / pageSize) },
    })
  } catch (err) {
    console.error("[users-controller] listCiudadanos:", err.message)
    return res.status(500).json({ message: "Error al obtener ciudadanos." })
  }
}

// ============================================================================
// PUT /api/users/ciudadanos/:id/estado  — Cambiar estado de ciudadano (ADMIN)
// Body: { estado: 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO' }
// ============================================================================
export const updateCiudadanoEstado = async (req, res) => {
  const { id }     = req.params
  const { estado } = req.body

  const ESTADOS_VALIDOS = ["ACTIVO", "INACTIVO", "SUSPENDIDO"]
  if (!ESTADOS_VALIDOS.includes(estado))
    return res.status(400).json({ message: `Estado inválido. Opciones: ${ESTADOS_VALIDOS.join(", ")}` })

  try {
    const { rowCount } = await pool.query(
      `UPDATE app_auth.users SET estado = $1, updated_at = NOW()
       WHERE id = $2 AND rol = 'CIUDADANO'`,
      [estado, id]
    )
    if (!rowCount) return res.status(404).json({ message: "Ciudadano no encontrado." })
    return res.json({ message: "Estado actualizado.", id, estado })
  } catch (err) {
    console.error("[users-controller] updateCiudadanoEstado:", err.message)
    return res.status(500).json({ message: "Error al actualizar estado." })
  }
}

// ============================================================================
// POST /api/users/ciudadanos/:id/reset-password  — Genera contraseña temporal (ADMIN)
// Devuelve la contraseña en claro para que el admin la comparta con el ciudadano.
// ============================================================================
export const resetCiudadanoPassword = async (req, res) => {
  const { id } = req.params

  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM app_auth.users WHERE id = $1 AND rol = 'CIUDADANO'`,
      [id]
    )
    if (!rowCount) return res.status(404).json({ message: "Ciudadano no encontrado." })

    const nuevaPassword = tempPassword(12)
    await pool.query(
      `UPDATE app_auth.users
       SET password_hash = crypt($1, gen_salt('bf', $2)), updated_at = NOW()
       WHERE id = $3`,
      [nuevaPassword, BCRYPT_ROUNDS, id]
    )

    return res.json({
      message:      "Contraseña restablecida. Compártela con el ciudadano de forma segura.",
      nueva_password: nuevaPassword,
    })
  } catch (err) {
    console.error("[users-controller] resetCiudadanoPassword:", err.message)
    return res.status(500).json({ message: "Error al restablecer contraseña." })
  }
}

// ============================================================================
// POST /api/users/push-token  — Registrar/actualizar token de push notification
// Body: { token, platform, app_version? }
// Header: x-user-id (inyectado por el gateway)
// ============================================================================
export const registerPushToken = async (req, res) => {
  const userId = req.headers["x-user-id"]

  if (!userId) {
    return res.status(401).json({ message: "No se pudo identificar al usuario." })
  }

  const { token, platform, app_version } = req.body

  if (!token || !platform) {
    return res.status(400).json({ message: "Los campos 'token' y 'platform' son requeridos." })
  }

  if (!["ios", "android", "web"].includes(platform)) {
    return res.status(400).json({ message: "Platform debe ser 'ios', 'android' o 'web'." })
  }

  try {
    await pool.query(
      `INSERT INTO app_auth.device_tokens (user_id, token, platform, app_version, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (token) DO UPDATE SET
         user_id      = EXCLUDED.user_id,
         platform     = EXCLUDED.platform,
         app_version  = EXCLUDED.app_version,
         last_seen_at = NOW()`,
      [userId, token, platform, app_version ?? null]
    )
    return res.status(200).json({ message: "Token registrado correctamente." })
  } catch (err) {
    console.error("[users-controller] registerPushToken:", err.message)
    return res.status(500).json({ message: "Error al registrar el token de notificaciones." })
  }
}
