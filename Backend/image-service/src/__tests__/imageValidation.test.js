import { describe, it, expect } from "vitest"
import {
  getImageDimensions,
  validateImageBuffer,
  MIN_FILE_BYTES,
  MIN_SIDE_PX,
} from "../utils/imageValidation.js"

// Construye un buffer PNG sintético con width/height dados en el IHDR
function makePngBuffer(width, height, size = MIN_FILE_BYTES + 100) {
  const buf = Buffer.alloc(size)
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a
  buf.writeUInt32BE(width,  16)
  buf.writeUInt32BE(height, 20)
  return buf
}

// Construye un buffer JPEG sintético con un marcador SOF0
function makeJpegBuffer(width, height, size = MIN_FILE_BYTES + 100) {
  const buf = Buffer.alloc(size)
  buf[0] = 0xff; buf[1] = 0xd8  // SOI
  buf[2] = 0xff; buf[3] = 0xc0  // SOF0
  buf.writeUInt16BE(11, 4)       // longitud del segmento
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width,  9)
  return buf
}

describe("getImageDimensions", () => {
  it("extrae width/height de un PNG desde el IHDR", () => {
    const result = getImageDimensions(makePngBuffer(1280, 960))
    expect(result).toEqual({ format: "PNG", width: 1280, height: 960 })
  })

  it("devuelve null para un PNG más corto que 24 bytes", () => {
    const buf = Buffer.alloc(20)
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
    expect(getImageDimensions(buf)).toBeNull()
  })

  it("extrae width/height de un JPEG con marcador SOF0", () => {
    const result = getImageDimensions(makeJpegBuffer(1280, 960))
    expect(result).toMatchObject({ format: "JPEG", width: 1280, height: 960 })
  })

  it("devuelve null para un formato no reconocido", () => {
    expect(getImageDimensions(Buffer.alloc(200, 0x00))).toBeNull()
  })
})

describe("validateImageBuffer", () => {
  it("rechaza un buffer por debajo del tamaño mínimo", () => {
    const buf = makePngBuffer(MIN_SIDE_PX, MIN_SIDE_PX, MIN_FILE_BYTES - 1)
    const result = validateImageBuffer(buf)
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/pequeña/i)
  })

  it("rechaza un buffer con magic bytes no reconocidos", () => {
    const result = validateImageBuffer(Buffer.alloc(MIN_FILE_BYTES + 100, 0xab))
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/Formato/i)
  })

  it("rechaza un PNG con dimensiones por debajo del mínimo", () => {
    const result = validateImageBuffer(makePngBuffer(100, 100))
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/Acércate/i)
  })

  it("acepta un PNG con dimensiones correctas", () => {
    const result = validateImageBuffer(makePngBuffer(MIN_SIDE_PX, MIN_SIDE_PX))
    expect(result.valid).toBe(true)
    expect(result.width).toBe(MIN_SIDE_PX)
    expect(result.height).toBe(MIN_SIDE_PX)
  })

  it("acepta un JPEG con dimensiones correctas", () => {
    const result = validateImageBuffer(makeJpegBuffer(MIN_SIDE_PX, MIN_SIDE_PX))
    expect(result.valid).toBe(true)
  })
})
