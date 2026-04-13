import nodemailer from "nodemailer"
import dotenv from "dotenv"
dotenv.config()

// Singleton transport — reutilizado entre requests
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false, // STARTTLS en puerto 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

/**
 * Envía el email de verificación OTP al ciudadano recién registrado.
 * @param {string} toEmail  - Dirección de email del destinatario
 * @param {string} otpCode  - Código OTP de 6 dígitos
 */
export const sendOtpEmail = async (toEmail, otpCode) => {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || "EMASEO EP <noreply.emaseo@gmail.com>",
    to:      toEmail,
    subject: "Código de verificación — EMASEO EP",
    text:    `Tu código de verificación es: ${otpCode}\n\nExpira en 10 minutos.\nSi no creaste esta cuenta, ignora este mensaje.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <h2 style="color:#005BAC;margin-bottom:8px">Verificación de cuenta</h2>
        <p style="color:#1E1E1E">Gracias por registrarte en la app de <strong>EMASEO EP</strong>.</p>
        <p style="color:#1E1E1E">Tu código de verificación de 6 dígitos es:</p>
        <div style="font-size:40px;font-weight:bold;letter-spacing:10px;
                    text-align:center;padding:24px;background:#F4F6F9;
                    border-radius:12px;color:#00A859;margin:20px 0">
          ${otpCode}
        </div>
        <p style="color:#6B7280;font-size:13px">
          Este código expira en <strong>10 minutos</strong>.<br>
          Si no creaste esta cuenta, puedes ignorar este mensaje.
        </p>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0">
        <p style="color:#6B7280;font-size:11px">
          EMASEO EP — Sistema de Gestión de Residuos Inteligente
        </p>
      </div>
    `
  })
}
