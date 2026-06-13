// useCallback removed — not needed after refactor
import { Dimensions } from 'react-native'
import { useFrameProcessor } from 'react-native-vision-camera'
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core'

import type { DistanceHint, LightingHint } from '../types/incident'

const { width: SW, height: SH } = Dimensions.get('window')

// Fracción del lado menor del frame que define la región de interés (espejo del scan overlay)
const FRAME_REGION_FRAC = 0.78
// Submuestreo: 1 de cada STEP píxeles en x e y (reduce carga de cómputo)
const STEP = 4
// Gradiente mínimo para contar un píxel como "borde" (igual al EDGE_GRAD_THRESHOLD del server)
const EDGE_GRAD_THRESHOLD = 20
// Normalización: edgeFraction * NORM_FACTOR, luego clamp a [0, 1] (igual al server)
const NORM_FACTOR = 3
// Umbrales para mapear coverage → hint. SOLO afectan la etiqueta de guía en vivo y
// el armado de la auto-captura — NO el valor de coverage que se envía al server como
// client_coverage_ratio (ese sale de NORM_FACTOR, no lo tocar). Lenientes a propósito:
// el heurístico de bordes se satura en escenas con textura (basura real), así que
// ensanchamos OPTIMAL para no marcar "aléjate" todo el tiempo. La validación real de
// basura/coverage la hace el server (coverage_to_distance_hint allí es solo otra pista).
const TOO_FAR_MAX   = 0.12
const TOO_CLOSE_MIN = 0.90
// Throttle por conteo de frames: procesa 1 de cada FRAME_STRIDE (~5 fps a 30 fps de cámara).
// Evitamos performance.now()/Date.now(): no están garantizados en el runtime del worklet.
const FRAME_STRIDE = 6

// Umbrales de iluminación (brillo promedio del encuadre, normalizado 0–1).
// Lenientes a propósito: solo marcan condiciones genuinamente problemáticas para
// no molestar en exteriores con luz normal (calle típica ~0.3–0.7).
export const LIGHT_DARK_MAX   = 0.16  // < esto → muy oscuro
export const LIGHT_BRIGHT_MIN = 0.92  // > esto → sobreexpuesto / reflejo

export type { DistanceHint, LightingHint }

export interface DistanceGuidanceResult {
  hint:       DistanceHint
  coverage:   number
  brightness: number
}

/**
 * Mapea el brillo promedio del encuadre (0–1) a una pista de iluminación.
 * Función pura, sin worklet — testeable y reutilizable en la UI.
 */
export function brightnessToLightingHint(brightness: number): LightingHint {
  if (brightness < LIGHT_DARK_MAX)   return 'TOO_DARK'
  if (brightness > LIGHT_BRIGHT_MIN) return 'TOO_BRIGHT'
  return 'OK'
}

// Recorre la región de interés submuestreando cada STEP px y acumula bordes (gradiente
// L1 de luminancia) y luminancia total. Worklet: corre en el hilo C++ junto al frame
// processor. Devuelve los acumuladores para que el caller calcule coverage y brillo.
function sampleFrameRegion(
  pixels: Uint8Array, FW: number,
  region: { startX: number; startY: number; endX: number; endY: number },
  isYuv: boolean, stride: number,
): { edgeCount: number; lumaSum: number; totalSampled: number } {
  'worklet'
  const { startX, startY, endX, endY } = region
  let edgeCount = 0
  let lumaSum = 0
  let totalSampled = 0
  for (let y = startY; y < endY - STEP; y += STEP) {
    for (let x = startX; x < endX - STEP; x += STEP) {
      let L: number, LR: number, LB: number
      if (isYuv) {
        // El canal Y es luminancia directa; sin multiplicación
        L  = pixels[y * FW + x]
        LR = pixels[y * FW + x + STEP]
        LB = pixels[(y + STEP) * FW + x]
      } else {
        const idx  = (y * FW + x) * stride
        const idxR = (y * FW + x + STEP) * stride
        const idxB = ((y + STEP) * FW + x) * stride
        // Luminancia ≈ 0.299R + 0.587G + 0.114B (aproximación entera)
        L  = (77 * pixels[idx]  + 150 * pixels[idx + 1]  + 29 * pixels[idx + 2])  >> 8
        LR = (77 * pixels[idxR] + 150 * pixels[idxR + 1] + 29 * pixels[idxR + 2]) >> 8
        LB = (77 * pixels[idxB] + 150 * pixels[idxB + 1] + 29 * pixels[idxB + 2]) >> 8
      }
      const grad = Math.abs(L - LR) + Math.abs(L - LB)
      if (grad > EDGE_GRAD_THRESHOLD) edgeCount++
      lumaSum += L
      totalSampled++
    }
  }
  return { edgeCount, lumaSum, totalSampled }
}

// Mapea coverage → DistanceHint con los mismos umbrales que ml_utils.py. Worklet.
function coverageToHint(coverage: number): DistanceHint {
  'worklet'
  if (coverage < TOO_FAR_MAX)   return 'TOO_FAR'
  if (coverage > TOO_CLOSE_MIN) return 'TOO_CLOSE'
  return 'OPTIMAL'
}

/**
 * Frame processor hook que estima en tiempo real cuánto ocupa el área de interés
 * (equivalente al scan overlay) en el frame de la cámara, sin enviar datos a red.
 *
 * Algoritmo (worklet, ejecuta en hilo de C++):
 *   1. Extrae región central del frame (FRAME_REGION_FRAC × min(W, H))
 *   2. Submuestrea cada STEP píxeles
 *   3. Calcula gradiente L1 de luminancia (Gx = |L - L_right|, Gy = |L - L_bottom|)
 *   4. coverage = min(1, edgeFraction × 3)  — misma normalización que el server
 *   5. Mapea coverage → DistanceHint con los mismos umbrales de ml_utils.py
 *
 * El resultado se throttlea a ≤5 actualizaciones/s para no sobrecargar el render.
 *
 * @param onUpdate  Callback llamado en el hilo JS con (hint, coverage, brightness) cuando hay cambio.
 * @returns         frameProcessor listo para pasar a <Camera frameProcessor={...} />
 */
export function useLiveDistanceGuidance(
  onUpdate: (hint: DistanceHint, coverage: number, brightness: number) => void,
  onDebug?: (info: string) => void,
) {
  // Contador de frames (shared value): procesamos 1 de cada FRAME_STRIDE.
  const frameCounter = useSharedValue(0)

  // useRunOnJS creates a worklet-callable wrapper that hops back to the JS thread
  const callOnJS = useRunOnJS(
    (hint: DistanceHint, coverage: number, brightness: number) => {
      onUpdate(hint, coverage, brightness)
    },
    [onUpdate],
  )

  // Reporta a JS cualquier error del worklet (para diagnóstico en pantalla).
  const reportDebug = useRunOnJS(
    (info: string) => { onDebug?.(info) },
    [onDebug],
  )

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'

    try {
      frameCounter.value = frameCounter.value + 1
      if (frameCounter.value % FRAME_STRIDE !== 0) return

      const FW = frame.width
      const FH = frame.height

      // Región central proporcional al scan overlay
      const minDim    = FW < FH ? FW : FH
      const regionSz  = Math.round(minDim * FRAME_REGION_FRAC)
      const startX    = Math.round((FW - regionSz) / 2)
      const startY    = Math.round((FH - regionSz) / 2)
      const endX      = startX + regionSz
      const endY      = startY + regionSz

      const buffer = frame.toArrayBuffer()
      const pixels = new Uint8Array(buffer)

      // Detect pixel format by bytes-per-pixel ratio:
      //   YUV_420 (NV12/NV21):  ~1.5  bytes/px  → Y plane is first FW*FH bytes at stride 1
      //   RGB:                   3     bytes/px
      //   RGBA/BGRA:             4     bytes/px
      const bytesPerPixel = buffer.byteLength / (FW * FH)
      const isYuv = bytesPerPixel < 2.5
      const rgbaStride = bytesPerPixel > 3.5 ? 4 : 3
      const stride = isYuv ? 1 : rgbaStride

      const { edgeCount, lumaSum, totalSampled } =
        sampleFrameRegion(pixels, FW, { startX, startY, endX, endY }, isYuv, stride)

      if (totalSampled === 0) return

      const edgeFraction = edgeCount / totalSampled
      const coverage = Math.min(1, edgeFraction * NORM_FACTOR)

      // Brillo promedio del encuadre normalizado a [0, 1]
      const brightness = (lumaSum / totalSampled) / 255

      const hint = coverageToHint(coverage)

      callOnJS(hint, coverage, brightness)
    } catch (e: any) {
      // Reporta el error a JS para diagnóstico (no rompe la UI).
      reportDebug('worklet: ' + (e?.message ?? String(e)))
    }
  }, [callOnJS, reportDebug, frameCounter])

  return frameProcessor
}
