/**
 * cropToScanFrame.ts
 *
 * Calcula el recorte exacto de la foto de cámara que corresponde al recuadro
 * visible en ScanOverlay y lo aplica con expo-image-manipulator.
 *
 * ## Geometría del problema
 *
 * El CameraView de expo-camera llena la pantalla en modo "cover" (como
 * `object-fit: cover` en CSS): la imagen del sensor se escala para cubrir la
 * pantalla completa, recortando los bordes que sobren. El usuario ve una
 * versión centrada y recortada del sensor.
 *
 * Al mismo tiempo, ScanOverlay dibuja un recuadro de FRAME px cuadrados en el
 * centro-superior de la pantalla (OVERLAY_V desde arriba). El usuario encuadra
 * la basura DENTRO de ese recuadro, esperando que sea esa región la que se
 * analice — pero sin este módulo, se enviaba la foto completa.
 *
 * ## Cálculo
 *
 * Dado que la pantalla tiene SW × SH px y la foto tiene photoW × photoH px:
 *
 *   displayScale = max(SW/photoW, SH/photoH)  → factor cover
 *   visibleW     = SW / displayScale           → ancho foto visible
 *   visibleH     = SH / displayScale           → alto foto visible
 *   offsetX      = (photoW - visibleW) / 2     → desplazamiento horizontal
 *   offsetY      = (photoH - visibleH) / 2     → desplazamiento vertical
 *
 * Coordenadas del recuadro en la foto:
 *   cropX = offsetX + frameLeft_screen / displayScale
 *   cropY = offsetY + frameTop_screen  / displayScale
 *   cropW = FRAME_SIZE / displayScale
 *   cropH = FRAME_SIZE / displayScale
 *
 * Estos valores se pasan a ImageManipulator.manipulateAsync para producir la
 * imagen recortada. Si el cálculo produce coordenadas fuera del rango de la
 * foto, se aplica clamp para evitar errores de ImageManipulator.
 *
 * ## Constantes compartidas
 *
 * FRAME_SIZE y OVERLAY_V deben mantenerse sincronizadas con ScanOverlay.tsx y
 * CapturedFrameOverlay.tsx. Si cambias el tamaño o posición del recuadro,
 * actualiza las tres constantes.
 */

import { ImageManipulator, SaveFormat as IMSaveFormat } from "expo-image-manipulator"
import { Dimensions } from "react-native"

const { width: SW, height: SH } = Dimensions.get("window")

// ─── Constantes del recuadro (deben coincidir con ScanOverlay.tsx) ────────────
/** Lado del recuadro cuadrado en píxeles de pantalla */
export const SCAN_FRAME_SIZE = Math.min(SW * 0.78, 300)
/** Distancia desde el tope de la pantalla hasta el borde superior del recuadro */
export const SCAN_OVERLAY_V  = (SH - SCAN_FRAME_SIZE) / 2 - 60

// ─── Función principal ────────────────────────────────────────────────────────

export interface CropResult {
  /** URI local del recorte (puede usarse como fuente de <Image />) */
  uri: string
  /** Base64 JPEG del recorte, listo para enviar al backend */
  base64: string
}

/**
 * Recorta la foto capturada para que coincida exactamente con la región
 * visible dentro del recuadro de ScanOverlay.
 *
 * @param uri       URI local de la foto completa (resultado de takePictureAsync)
 * @param photoWidth  Ancho de la foto en píxeles del sensor
 * @param photoHeight Alto de la foto en píxeles del sensor
 * @returns  { uri, base64 } del recorte
 * @throws  Si ImageManipulator falla (p.ej. archivo no legible)
 */
export async function cropToScanFrame(
  uri: string,
  photoWidth: number,
  photoHeight: number,
): Promise<CropResult> {
  // Paso 1: escala cover → ¿cuántos px de pantalla ocupa cada px de foto?
  const displayScale = Math.max(SW / photoWidth, SH / photoHeight)

  // Paso 2: región de la foto que es visible en pantalla
  const visibleW = SW / displayScale
  const visibleH = SH / displayScale

  // Paso 3: desplazamiento de la foto bajo la pantalla (centrado)
  const photoOffsetX = (photoWidth  - visibleW) / 2
  const photoOffsetY = (photoHeight - visibleH) / 2

  // Paso 4: posición del recuadro en pantalla → convertir a coords de foto
  const frameLeft = (SW - SCAN_FRAME_SIZE) / 2
  const frameTop  = SCAN_OVERLAY_V

  const rawCropX = photoOffsetX + frameLeft / displayScale
  const rawCropY = photoOffsetY + frameTop  / displayScale
  const rawCropS = SCAN_FRAME_SIZE          / displayScale

  // Paso 5: clamp para no salir de los límites de la foto
  const cropX = Math.max(0, Math.round(rawCropX))
  const cropY = Math.max(0, Math.round(rawCropY))
  const cropW = Math.min(Math.round(rawCropS), photoWidth  - cropX)
  const cropH = Math.min(Math.round(rawCropS), photoHeight - cropY)

  // Paso 6: recortar y comprimir
  const cropCtx = ImageManipulator.manipulate(uri)
  cropCtx.crop({ originX: cropX, originY: cropY, width: cropW, height: cropH })
  const cropRef = await cropCtx.renderAsync()
  const result = await cropRef.saveAsync({
    compress: 0.85,
    format:   IMSaveFormat.JPEG,
    base64:   true,
  }
  )

  return { uri: result.uri, base64: result.base64! }
}
