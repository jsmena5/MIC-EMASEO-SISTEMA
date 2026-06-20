import crypto from "node:crypto"

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex")
}

export function generateOpaqueToken() {
  return crypto.randomBytes(64).toString("hex")
}

// OTP numérico de 6 dígitos (100000–999999, sin ceros a la izquierda)
export function generateOtp() {
  return String(crypto.randomInt(100_000, 1_000_000))
}
