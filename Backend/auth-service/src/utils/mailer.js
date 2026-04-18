import nodemailer from "nodemailer"
import dotenv from "dotenv"

dotenv.config()

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  throw new Error("SMTP_USER y SMTP_PASS deben estar configurados en el auth-service")
}

// Singleton — se crea una sola vez al arrancar el servicio
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false, // STARTTLS en puerto 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

/**
 * Envía el email de recuperación de contraseña con el código OTP.
 * @param {string} toEmail  - Dirección del destinatario
 * @param {string} otpCode  - Código OTP de 6 dígitos
 */
export const sendPasswordResetEmail = async (toEmail, otpCode) => {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || "EMASEO EP <noreply.emaseo@gmail.com>",
    to:      toEmail,
    subject: "Recuperación de contraseña — EMASEO EP",
    text: `Tu código para restablecer la contraseña es: ${otpCode}\n\nExpira en 15 minutos.\nSi no solicitaste esto, ignora este mensaje.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <h2 style="color:#005BAC;margin-bottom:8px">Recuperación de contraseña</h2>
        <p style="color:#1E1E1E">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>EMASEO EP</strong>.</p>
        <p style="color:#1E1E1E">Ingresa el siguiente código en la aplicación:</p>
        <div style="font-size:40px;font-weight:bold;letter-spacing:10px;
                    text-align:center;padding:24px;background:#F4F6F9;
                    border-radius:12px;color:#005BAC;margin:20px 0">
          ${otpCode}
        </div>
        <p style="color:#6B7280;font-size:13px">
          Este código expira en <strong>15 minutos</strong>.<br>
          Si no solicitaste restablecer tu contraseña, puedes ignorar este mensaje.
        </p>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0">
        <p style="color:#6B7280;font-size:11px">
          EMASEO EP — Sistema de Gestión de Residuos Inteligente
        </p>
      </div>
    `,
  })
}
