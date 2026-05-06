import crypto from "crypto"

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export function generateOpaqueToken() {
  return crypto.randomBytes(64).toString("hex")
}
