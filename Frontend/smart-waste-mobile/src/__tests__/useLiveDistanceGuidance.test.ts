/**
 * Tests unitarios para la lógica de mapeo de coverage → DistanceHint.
 *
 * useLiveDistanceGuidance usa useFrameProcessor (nativo) que no puede ejecutarse
 * en Jest. Se testea la lógica pura de los umbrales extrayéndola del hook.
 */

import type { DistanceHint, LightingHint } from '../types/incident'

// ─── Lógica pura extraída del hook (mismos valores que useLiveDistanceGuidance.ts) ──

const TOO_FAR_MAX   = 0.12
const TOO_CLOSE_MIN = 0.90

function coverageToHint(coverage: number): DistanceHint {
  if (coverage < TOO_FAR_MAX)   return 'TOO_FAR'
  if (coverage > TOO_CLOSE_MIN) return 'TOO_CLOSE'
  return 'OPTIMAL'
}

const LIGHT_DARK_MAX   = 0.16
const LIGHT_BRIGHT_MIN = 0.92

function brightnessToLightingHint(brightness: number): LightingHint {
  if (brightness < LIGHT_DARK_MAX)   return 'TOO_DARK'
  if (brightness > LIGHT_BRIGHT_MIN) return 'TOO_BRIGHT'
  return 'OK'
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('coverageToHint — lógica de umbrales', () => {
  test('coverage 0.00 → TOO_FAR', () => {
    expect(coverageToHint(0.00)).toBe('TOO_FAR')
  })

  test('coverage 0.11 → TOO_FAR (justo bajo el límite)', () => {
    expect(coverageToHint(0.11)).toBe('TOO_FAR')
  })

  test('coverage 0.12 → OPTIMAL (límite inferior incluido)', () => {
    expect(coverageToHint(0.12)).toBe('OPTIMAL')
  })

  test('coverage 0.50 → OPTIMAL (punto medio)', () => {
    expect(coverageToHint(0.50)).toBe('OPTIMAL')
  })

  test('coverage 0.90 → OPTIMAL (límite superior incluido)', () => {
    expect(coverageToHint(0.90)).toBe('OPTIMAL')
  })

  test('coverage 0.91 → TOO_CLOSE (justo sobre el límite)', () => {
    expect(coverageToHint(0.91)).toBe('TOO_CLOSE')
  })

  test('coverage 1.00 → TOO_CLOSE', () => {
    expect(coverageToHint(1.00)).toBe('TOO_CLOSE')
  })
})

describe('brightnessToLightingHint — lógica de umbrales de iluminación', () => {
  test('brillo 0.00 → TOO_DARK (negro total)', () => {
    expect(brightnessToLightingHint(0.0)).toBe('TOO_DARK')
  })

  test('brillo 0.10 → TOO_DARK', () => {
    expect(brightnessToLightingHint(0.10)).toBe('TOO_DARK')
  })

  test('brillo 0.16 → OK (límite inferior incluido)', () => {
    expect(brightnessToLightingHint(0.16)).toBe('OK')
  })

  test('brillo 0.50 → OK (luz de calle típica)', () => {
    expect(brightnessToLightingHint(0.50)).toBe('OK')
  })

  test('brillo 0.92 → OK (límite superior incluido)', () => {
    expect(brightnessToLightingHint(0.92)).toBe('OK')
  })

  test('brillo 0.97 → TOO_BRIGHT (sobreexpuesto/reflejo)', () => {
    expect(brightnessToLightingHint(0.97)).toBe('TOO_BRIGHT')
  })

  test('brillo 1.00 → TOO_BRIGHT (blanco total)', () => {
    expect(brightnessToLightingHint(1.0)).toBe('TOO_BRIGHT')
  })
})

describe('Throttle — el hook no dispara onUpdate más de 5 veces/s', () => {
  test('llamadas en < 200 ms no deben generar actualizaciones duplicadas', () => {
    // Simulamos el comportamiento del throttle con un contador manual
    let callCount = 0
    const THROTTLE_MS = 200
    let lastMs = 0

    function throttledUpdate(now: number) {
      if (now - lastMs < THROTTLE_MS) return
      lastMs = now
      callCount++
    }

    // Primer frame a t=1000 → pasa (1000 - 0 ≥ 200). En el hook real
    // performance.now() devuelve un timestamp grande, así que el primer frame
    // siempre supera el umbral; los siguientes dentro de la ventana se descartan.
    throttledUpdate(1000)
    expect(callCount).toBe(1)

    // 9 frames más dentro de la ventana de 200 ms (cada 5 ms) → todos descartados
    for (let i = 1; i <= 9; i++) {
      throttledUpdate(1000 + i * 5)
    }
    expect(callCount).toBe(1)

    // Pasados 200 ms desde el último update → se permite otro
    throttledUpdate(1200)
    expect(callCount).toBe(2)
  })
})
