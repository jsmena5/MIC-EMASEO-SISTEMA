import { describe, it, expect, vi } from "vitest"

// El módulo env lanza si falta VITE_API_URL; lo mockeamos para aislar el test.
vi.mock("../../config/env", () => ({ API_URL: "https://micemaseo.duckdns.org/api" }))

import { toPublicMediaUrl } from "./mediaUrl"

const MEDIA_BASE = "https://micemaseo.duckdns.org/api/media"

describe("toPublicMediaUrl", () => {
  it("devuelve null para valores vacíos", () => {
    expect(toPublicMediaUrl(null)).toBeNull()
    expect(toPublicMediaUrl(undefined)).toBeNull()
    expect(toPublicMediaUrl("")).toBeNull()
  })

  it("pasa sin cambios una URL que ya es del proxy del gateway", () => {
    const url = `${MEDIA_BASE}/emaseo-incidents/incidents/abc.jpg`
    expect(toPublicMediaUrl(url)).toBe(url)
  })

  it("quita el bucket duplicado en URLs públicas de R2", () => {
    expect(
      toPublicMediaUrl("https://pub-xxx.r2.dev/emaseo-incidents/incidents/abc.jpg"),
    ).toBe("https://pub-xxx.r2.dev/incidents/abc.jpg")
  })

  it("es idempotente: una URL pública ya correcta no cambia", () => {
    const url = "https://pub-xxx.r2.dev/incidents/abc.jpg"
    expect(toPublicMediaUrl(url)).toBe(url)
  })

  it("reescribe URL privada de MinIO (localhost:9000) al proxy conservando el bucket", () => {
    expect(
      toPublicMediaUrl("http://localhost:9000/emaseo-incidents/incidents/abc.jpg"),
    ).toBe(`${MEDIA_BASE}/emaseo-incidents/incidents/abc.jpg`)
  })

  it("reescribe URL privada de IP LAN al proxy", () => {
    expect(
      toPublicMediaUrl("http://192.168.1.50:9000/emaseo-incidents/incidents/abc.jpg"),
    ).toBe(`${MEDIA_BASE}/emaseo-incidents/incidents/abc.jpg`)
  })
})
