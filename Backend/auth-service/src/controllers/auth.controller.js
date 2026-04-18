import { pool } from "../db.js"
import jwt from "jsonwebtoken"
import crypto from "crypto"
import { sendPasswordResetEmail } from "../utils/mailer.js"

const PASSWORD_RESET_OTP_TTL_MIN = 15

// Access token de vida corta: con refresh token podemos usar ventanas pequeñas
const ACCESS_TOKEN_TTL       = "15m"
const REFRESH_TOKEN_TTL_DAYS = 7

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function generateOpaqueToken() {
  return crypto.randomBytes(64).toString("hex") // 128 chars, 512 bits de entropía
}

async function issueRefreshToken(userId) {
  const raw       = generateOpaqueToken()
  const hash      = hashToken(raw)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000)

  await pool.query(
    `INSERT INTO auth.refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  )

  return raw
}

// ─── Login ───────────────────────────────────────────────────────────────────

export const login = async (req, res) => {
  try {
    const { username, password } = req.body

    // JOIN con ambas tablas de perfil para recuperar nombre sin importar el rol.
    // COALESCE toma el primer valor no-NULL: ciudadano o operario.
    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.password_hash,
         u.rol,
         u.estado,
         COALESCE(c.nombre,   o.nombre)   AS nombre,
         COALESCE(c.apellido, o.apellido) AS apellido
       FROM auth.users u
       LEFT JOIN public.ciudadanos    c ON c.user_id = u.id
       LEFT JOIN operations.operarios o ON o.user_id = u.id
       WHERE u.username = $1`,
      [username]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario no existe" })
    }

    const user = result.rows[0]

    // Bloquear cuentas inactivas o suspendidas antes de verificar contraseña
    if (user.estado !== "ACTIVO") {
      return res.status(403).json({ message: "Cuenta suspendida o inactiva" })
    }

    // Verificación de contraseña con pgcrypto (bcrypt en PostgreSQL)
    const validPasswordResult = await pool.query(
      `SELECT $1 = crypt($2, $1) AS valid`,
      [user.password_hash, password]
    )

    if (!validPasswordResult.rows[0].valid) {
      return res.status(401).json({ message: "Contraseña incorrecta" })
    }

    // tipo_perfil permite al gateway y al frontend distinguir en qué tabla
    // vive el perfil del usuario sin consultar la BD en cada request.
    const tipo_perfil = ["OPERARIO", "SUPERVISOR", "ADMIN"].includes(user.rol)
      ? "operario"
      : "ciudadano"

    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre, tipo_perfil },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    )

    const refreshToken = await issueRefreshToken(user.id)

    res.json({ token, refreshToken })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error en login" })
  }
}

// ─── Refresh ─────────────────────────────────────────────────────────────────
// Valida el refresh token, lo revoca y emite un par nuevo (rotación segura).
// Si el mismo token se usa dos veces → la segunda llamada falla con 401.

export const refresh = async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ message: "refreshToken requerido" })
  }

  try {
    const hash = hashToken(refreshToken)

    const result = await pool.query(
      `SELECT
         rt.id,
         rt.user_id,
         u.username,
         u.rol,
         u.estado,
         COALESCE(c.nombre,   o.nombre)   AS nombre,
         COALESCE(c.apellido, o.apellido) AS apellido
       FROM auth.refresh_tokens rt
       JOIN auth.users u ON u.id = rt.user_id
       LEFT JOIN public.ciudadanos    c ON c.user_id = u.id
       LEFT JOIN operations.operarios o ON o.user_id = u.id
       WHERE rt.token_hash = $1
         AND rt.revoked    = FALSE
         AND rt.expires_at > NOW()`,
      [hash]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Refresh token inválido o expirado" })
    }

    const row = result.rows[0]

    // Revocar si la cuenta fue suspendida tras emitir el token
    if (row.estado !== "ACTIVO") {
      await pool.query(
        `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
        [hash]
      )
      return res.status(403).json({ message: "Cuenta suspendida o inactiva" })
    }

    // Rotación: revocar el token actual e emitir un par nuevo
    await pool.query(
      `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
      [hash]
    )

    const tipo_perfil = ["OPERARIO", "SUPERVISOR", "ADMIN"].includes(row.rol)
      ? "operario"
      : "ciudadano"

    const token = jwt.sign(
      { id: row.user_id, username: row.username, rol: row.rol, nombre: row.nombre, tipo_perfil },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    )

    const newRefreshToken = await issueRefreshToken(row.user_id)

    res.json({ token, refreshToken: newRefreshToken })

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error al renovar sesión" })
  }
}

// ─── Forgot Password ─────────────────────────────────────────────────────────
// Genera un OTP de 6 dígitos, lo almacena hasheado y envía el email.
// Responde siempre 200 para no revelar si el email existe (enumeración).

export const forgotPassword = async (req, res) => {
  const { email } = req.body

  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Email requerido" })
  }

  try {
    const userResult = await pool.query(
      `SELECT id FROM auth.users WHERE email = $1 AND estado = 'ACTIVO'`,
      [email.toLowerCase().trim()]
    )

    // Respuesta genérica: no revelar si el email está registrado
    if (userResult.rows.length === 0) {
      return res.json({ message: "Si el email está registrado recibirás un código en breve." })
    }

    const userId = userResult.rows[0].id

    // Eliminar tokens previos del mismo usuario para evitar acumulación
    await pool.query(
      `DELETE FROM auth.password_reset_tokens WHERE user_id = $1`,
      [userId]
    )

    // Generar OTP de 6 dígitos criptográficamente seguro
    const otp      = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
    const otpHash  = crypto.createHash("sha256").update(otp).digest("hex")
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MIN * 60_000)

    await pool.query(
      `INSERT INTO auth.password_reset_tokens (user_id, otp_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, otpHash, expiresAt]
    )

    try {
      await sendPasswordResetEmail(email, otp)
    } catch (emailError) {
      console.error("[forgotPassword] Error enviando email:", emailError)
    }

    res.json({ message: "Si el email está registrado recibirás un código en breve." })
  } catch (error) {
    console.error("[forgotPassword]", error)
    res.status(500).json({ message: "Error al procesar la solicitud" })
  }
}

// ─── Verify Reset OTP ────────────────────────────────────────────────────────
// Pre-validación del OTP para dar feedback inmediato antes de que el usuario
// escriba su nueva contraseña. No marca el token como usado todavía.

export const verifyResetOtp = async (req, res) => {
  const { email, otp } = req.body

  if (!email || !otp) {
    return res.status(400).json({ message: "Email y código requeridos" })
  }

  try {
    const userResult = await pool.query(
      `SELECT id FROM auth.users WHERE email = $1`,
      [email.toLowerCase().trim()]
    )

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Código incorrecto o expirado" })
    }

    const userId  = userResult.rows[0].id
    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex")

    const tokenResult = await pool.query(
      `SELECT id FROM auth.password_reset_tokens
       WHERE user_id   = $1
         AND otp_hash  = $2
         AND expires_at > NOW()
         AND used       = FALSE`,
      [userId, otpHash]
    )

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ message: "Código incorrecto o expirado" })
    }

    res.json({ message: "Código válido" })
  } catch (error) {
    console.error("[verifyResetOtp]", error)
    res.status(500).json({ message: "Error al verificar el código" })
  }
}

// ─── Reset Password ───────────────────────────────────────────────────────────
// Valida OTP, actualiza password_hash y emite un JWT listo para usar.
// Operación atómica: el token se marca como usado solo si todo sale bien.

export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, código y nueva contraseña son requeridos" })
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" })
  }

  try {
    const userResult = await pool.query(
      `SELECT
         u.id, u.username, u.rol,
         COALESCE(c.nombre,   o.nombre)   AS nombre,
         COALESCE(c.apellido, o.apellido) AS apellido
       FROM auth.users u
       LEFT JOIN public.ciudadanos    c ON c.user_id = u.id
       LEFT JOIN operations.operarios o ON o.user_id = u.id
       WHERE u.email = $1 AND u.estado = 'ACTIVO'`,
      [email.toLowerCase().trim()]
    )

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Código incorrecto o expirado" })
    }

    const user    = userResult.rows[0]
    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex")

    const tokenResult = await pool.query(
      `SELECT id FROM auth.password_reset_tokens
       WHERE user_id   = $1
         AND otp_hash  = $2
         AND expires_at > NOW()
         AND used       = FALSE`,
      [user.id, otpHash]
    )

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ message: "Código incorrecto o expirado" })
    }

    const tokenId = tokenResult.rows[0].id

    // Transacción con cliente dedicado para garantizar que BEGIN/COMMIT
    // se ejecutan en la misma conexión del pool.
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        `UPDATE auth.users
         SET password_hash = crypt($1, gen_salt('bf')),
             updated_at    = NOW()
         WHERE id = $2`,
        [newPassword, user.id]
      )

      await client.query(
        `UPDATE auth.password_reset_tokens SET used = TRUE WHERE id = $1`,
        [tokenId]
      )

      // Revocar todos los refresh tokens activos por seguridad
      await client.query(
        `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE user_id = $1`,
        [user.id]
      )

      await client.query("COMMIT")
    } catch (txError) {
      await client.query("ROLLBACK")
      throw txError
    } finally {
      client.release()
    }

    // Emitir un nuevo par de tokens para que el usuario quede logueado
    const tipo_perfil = ["OPERARIO", "SUPERVISOR", "ADMIN"].includes(user.rol)
      ? "operario"
      : "ciudadano"

    const token        = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre, tipo_perfil },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    )
    const refreshToken = await issueRefreshToken(user.id)

    res.json({ message: "Contraseña actualizada correctamente", token, refreshToken })
  } catch (error) {
    console.error("[resetPassword]", error)
    res.status(500).json({ message: "Error al restablecer la contraseña" })
  }
}

// ─── Logout ──────────────────────────────────────────────────────────────────
// Revoca el refresh token en la BD. El access token expira solo (15 min).

export const logout = async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ message: "refreshToken requerido" })
  }

  try {
    const hash = hashToken(refreshToken)
    await pool.query(
      `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
      [hash]
    )
    res.status(204).send()
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error al cerrar sesión" })
  }
}
