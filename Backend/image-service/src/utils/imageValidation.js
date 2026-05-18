import sharp from "sharp"

export const MIN_FILE_BYTES = 1_000
export const MIN_SIDE_PX   = 320

export function getImageDimensions(buf) {
  // PNG: IHDR en offset 16-23
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null
    return { format: "PNG", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: recorrer segmentos buscando marcador SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) break
      const m = buf[i + 1]
      if (
        (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) ||
        (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
      ) {
        return { format: "JPEG", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return { format: "JPEG", width: 0, height: 0 }
  }
  return null
}

// Filtro rápido basado solo en magic bytes y tamaño (sin I/O de decodificación).
// Úsalo como guardia de primer nivel antes de llamar a validateImageBufferDeep.
export function validateImageBuffer(buffer) {
  if (buffer.length < MIN_FILE_BYTES) {
    return { valid: false, message: "Imagen demasiado pequeña o vacía. Vuelve a intentarlo." }
  }

  const dims = getImageDimensions(buffer)
  if (!dims) {
    return { valid: false, message: "Formato no soportado. Se aceptan JPEG y PNG." }
  }

  if (dims.width > 0 && dims.height > 0 && (dims.width < MIN_SIDE_PX || dims.height < MIN_SIDE_PX)) {
    return { valid: false, message: "Acércate más al objeto para capturar una imagen de mayor resolución." }
  }

  return { valid: true, message: "Imagen lista para análisis.", ...dims }
}

// Validación profunda con decodificación real vía sharp.
// Rechaza polyglots y archivos con magic bytes válidos pero contenido corrupto.
export async function validateImageBufferDeep(buffer) {
  // Filtro rápido primero — descarta basura sin pasar por sharp
  const quick = validateImageBuffer(buffer)
  if (!quick.valid) return quick

  try {
    const meta = await sharp(buffer).metadata()

    // El formato real del decodificador debe coincidir con el declarado por los magic bytes
    const expectedFormats = { JPEG: "jpeg", PNG: "png" }
    if (meta.format !== expectedFormats[quick.format]) {
      return { valid: false, message: "Formato no soportado. Se aceptan JPEG y PNG." }
    }

    // Dimensiones reales del decodificador (más confiables que los magic bytes)
    if (!meta.width || !meta.height || meta.width < MIN_SIDE_PX || meta.height < MIN_SIDE_PX) {
      return { valid: false, message: "Acércate más al objeto para capturar una imagen de mayor resolución." }
    }

    return {
      valid:   true,
      message: "Imagen lista para análisis.",
      format:  quick.format,
      width:   meta.width,
      height:  meta.height,
    }
  } catch {
    // sharp lanzó error → el buffer no es una imagen decodificable (polyglot, truncado, etc.)
    return { valid: false, message: "Imagen corrupta o inválida. Vuelve a intentarlo." }
  }
}
