import { useCallback } from 'react'
import { Dimensions } from 'react-native'
import { useFrameProcessor } from 'react-native-vision-camera'
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core'

import type { DistanceHint } from '../types/incident'

const { width: SW, height: SH } = Dimensions.get('window')

// Fracción del lado menor del frame que define la región de interés (espejo del scan overlay)
const FRAME_REGION_FRAC = 0.78
// Submuestreo: 1 de cada STEP píxeles en x e y (reduce carga de cómputo)
const STEP = 4
// Gradiente mínimo para contar un píxel como "borde" (igual al EDGE_GRAD_THRESHOLD del server)
const EDGE_GRAD_THRESHOLD = 20
// Normalización: edgeFraction * NORM_FACTOR, luego clamp a [0, 1] (igual al server)
const NORM_FACTOR = 3.0
// Umbrales para mapear coverage → hint (idénticos a coverage_to_distance_hint en ml_utils.py)
const TOO_FAR_MAX   = 0.15
const TOO_CLOSE_MIN = 0.65
// Throttle: mínimo ms entre actualizaciones de estado (5 fps máximo de UI updates)
const THROTTLE_MS = 200

export type { DistanceHint }

export interface DistanceGuidanceResult {
  hint:     DistanceHint
  coverage: number
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
 * @param onUpdate  Callback llamado en el hilo JS con (hint, coverage) cuando hay cambio.
 * @returns         frameProcessor listo para pasar a <Camera frameProcessor={...} />
 */
export function useLiveDistanceGuidance(
  onUpdate: (hint: DistanceHint, coverage: number) => void,
) {
  // Tiempo del último update (ms, worklet shared value para acceso thread-safe)
  const lastUpdateMs = useSharedValue(0)

  // useRunOnJS creates a worklet-callable wrapper that hops back to the JS thread
  const callOnJS = useRunOnJS(
    (hint: DistanceHint, coverage: number) => { onUpdate(hint, coverage) },
    [onUpdate],
  )

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'

    const now = performance.now()
    if (now - lastUpdateMs.value < THROTTLE_MS) return
    lastUpdateMs.value = now

    try {
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

      // Detectar stride (bytes por píxel) según pixelFormat
      // VisionCamera típicamente entrega 'rgb' (3 bytes) o 'rgba'/'bgra' (4 bytes)
      const bpp = buffer.byteLength / (FW * FH) > 3.5 ? 4 : 3

      let edgeCount = 0
      let totalSampled = 0

      for (let y = startY; y < endY - STEP; y += STEP) {
        for (let x = startX; x < endX - STEP; x += STEP) {
          const idx  = (y * FW + x) * bpp
          const idxR = (y * FW + x + STEP) * bpp       // píxel derecho
          const idxB = ((y + STEP) * FW + x) * bpp     // píxel inferior

          // Luminancia ≈ 0.299R + 0.587G + 0.114B (aproximación entera para velocidad)
          const L  = (77 * pixels[idx]  + 150 * pixels[idx + 1]  + 29 * pixels[idx + 2])  >> 8
          const LR = (77 * pixels[idxR] + 150 * pixels[idxR + 1] + 29 * pixels[idxR + 2]) >> 8
          const LB = (77 * pixels[idxB] + 150 * pixels[idxB + 1] + 29 * pixels[idxB + 2]) >> 8

          const grad = (L - LR < 0 ? LR - L : L - LR) + (L - LB < 0 ? LB - L : L - LB)
          if (grad > EDGE_GRAD_THRESHOLD) edgeCount++
          totalSampled++
        }
      }

      if (totalSampled === 0) return

      const edgeFraction = edgeCount / totalSampled
      const coverage = edgeFraction * NORM_FACTOR > 1.0 ? 1.0 : edgeFraction * NORM_FACTOR

      let hint: DistanceHint
      if (coverage < TOO_FAR_MAX) {
        hint = 'TOO_FAR'
      } else if (coverage > TOO_CLOSE_MIN) {
        hint = 'TOO_CLOSE'
      } else {
        hint = 'OPTIMAL'
      }

      callOnJS(hint, coverage)
    } catch {
      // Silenciar errores en el worklet — no afectan la UI
    }
  }, [callOnJS, lastUpdateMs])

  return frameProcessor
}
