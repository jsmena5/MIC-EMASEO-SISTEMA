import { describe, it, expect } from "vitest"
import { hashToken, generateOpaqueToken } from "../utils/crypto.js"

describe("hashToken", () => {
  it("produce el mismo hash para el mismo input", () => {
    const token = "test-token-abc"
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it("devuelve una cadena hex de 64 caracteres (SHA-256)", () => {
    expect(hashToken("any-token")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("genera hashes distintos para inputs distintos", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"))
  })

  it("no devuelve el token en claro", () => {
    const raw = "super-secret-token"
    expect(hashToken(raw)).not.toBe(raw)
  })
})

describe("generateOpaqueToken", () => {
  it("devuelve una cadena hex de 128 caracteres (64 bytes)", () => {
    expect(generateOpaqueToken()).toMatch(/^[0-9a-f]{128}$/)
  })

  it("cada llamada genera un token único", () => {
    expect(generateOpaqueToken()).not.toBe(generateOpaqueToken())
  })
})
