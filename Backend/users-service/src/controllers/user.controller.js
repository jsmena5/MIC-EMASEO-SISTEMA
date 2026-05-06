import { pool } from "../db.js"
import { sendOtpEmail } from "../utils/mailer.js"
import { validarCedula } from "../utils/cedula.js"
import jwt from "jsonwebtoken"
import crypto from "crypto"
import dotenv from "dotenv"
dotenv.config()

const generateOtp = () => String(crypto.randomInt(100000, 999999))

// ============================================================================
// POST /api/users/register  — Paso 1: datos básicos + envío de OTP
// Body: { nombre, apellido, cedula, email }
// ============================================================================
export const registerUser = async (req, res) => {
  const client = await pool.connect()
  try {
    const { nombre, apellido, cedula, email } = req.body

    if (!nombre?.trim() || !apellido?.trim() || !cedula || !email) {
      return res.status(400).json({ message: "Todos los campos son requeridos" })
    }

    // Validar cédula ecuatoriana (algoritmo módulo 10)
    if (!validarCedula(cedula)) {
      return res.status(400).json({ message: "Número de cédula inválido" })
    }

    // Verificar que el email y la cédula no estén ya registrados en auth.users
    const existe = await client.query(
      `SELECT 1 FROM auth.users u
       JOIN public.ciudadanos c ON c.user_id = u.id
       WHERE u.email = $1 OR c.cedula = $2
       LIMIT 1`,
      [email, cedula]
    )
    if (existe.rows.length > 0) {
      return res.status(400).json({ message: "Email o cédula ya registrados" })
    }

    const otp        = generateOtp()
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000) // + 10 min

    // Guardar o reemplazar el registro pendiente para este email
    await client.query(
      `INSERT INTO auth.pending_registrations
         (nombre, apellido, cedula, email, otp_code, otp_expires_at, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       ON CONFLICT (email) DO UPDATE SET
         nombre         = EXCLUDED.nombre,
         apellido       = EXCLUDED.apellido,
         cedula         = EXCLUDED.cedula,
         otp_code       = EXCLUDED.otp_code,
         otp_expires_at = EXCLUDED.otp_expires_at,
         is_verified    = FALSE,
         created_at     = NOW()`,
      [nombre.trim(), apellido.trim(), cedula, email, otp, otpExpires]
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
       FROM auth.pending_registrations
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

    // Comparación segura
    const a = Buffer.from(otp.trim().padEnd(6))
    const b = Buffer.from(reg.otp_code.padEnd(6))
    const match = crypto.timingSafeEqual(a, b) && otp.trim() === reg.otp_code

    if (!match) {
      return res.status(400).json({ message: "Código incorrecto" })
    }

    // Marcar como verificado — el OTP ya cumplió su función
    await client.query(
      `UPDATE auth.pending_registrations
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

    if (password.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" })
    }

    // Leer datos del registro pendiente — debe estar verificado
    const result = await client.query(
      `SELECT nombre, apellido, cedula FROM auth.pending_registrations
       WHERE email = $1 AND is_verified = TRUE`,
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Email no verificado o registro no encontrado" })
    }

    const { nombre, apellido, cedula } = result.rows[0]

    // Username = cédula (único, sin requerir que el usuario lo elija)
    const username = cedula

    await client.query("BEGIN")

    // 1. Crear cuenta en auth.users
    const userResult = await client.query(
      `INSERT INTO auth.users
         (username, email, password_hash, estado, is_verified)
       VALUES
         ($1, $2, crypt($3, gen_salt('bf')), 'ACTIVO', TRUE)
       RETURNING id, username, email, rol`,
      [username, email, password]
    )
    const user = userResult.rows[0]

    // 2. Crear perfil en public.ciudadanos
    await client.query(
      `INSERT INTO public.ciudadanos (user_id, nombre, apellido, cedula)
       VALUES ($1, $2, $3, $4)`,
      [user.id, nombre, apellido, cedula]
    )

    // 3. Registrar consentimiento LOPDP (art. 8 — consentimiento libre, específico e informado)
    const ipOrigen   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null
    const userAgent  = req.headers['user-agent'] || null
    await client.query(
      `INSERT INTO auth.user_consents (user_id, version_politica, ip_origen, user_agent)
       VALUES ($1, $2, $3::inet, $4)`,
      [user.id, '1.0', ipOrigen, userAgent]
    )

    // 4. Eliminar el registro temporal
    await client.query(
      `DELETE FROM auth.pending_registrations WHERE email = $1`,
      [email]
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
      { expiresIn: "1h" }
    )

    res.json({ token })

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
