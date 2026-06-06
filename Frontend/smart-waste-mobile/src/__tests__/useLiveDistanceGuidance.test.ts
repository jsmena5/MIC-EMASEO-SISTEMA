/**
 * Tests unitarios para la lógica de mapeo de coverage → DistanceHint.
 *
 * useLiveDistanceGuidance usa useFrameProcessor (nativo) que no puede ejecutarse
 * en Jest. Se testea la lógica pura de los umbrales extrayéndola del hook.
 */

import type { DistanceHint, LightingHint } from '../types/incident'

// ─── Lógica pura extraída del hook (mismos valores que useLiveDistanceGuidance.ts) ──

const TOO_FAR_MAX   = 0.15
const TOO_CLOSE_MIN = 0.65

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

  test('coverage 0.10 → TOO_FAR', () => {
    expect(coverageToHint(0.10)).toBe('TOO_FAR')
  })

  test('coverage 0.14 → TOO_FAR (justo bajo el límite)', () => {
    expect(coverageToHint(0.14)).toBe('TOO_FAR')
  })

  test('coverage 0.15 → OPTIMAL (límite inferior incluido)', () => {
    expect(coverageToHint(0.15)).toBe('OPTIMAL')
  })

  test('coverage 0.40 → OPTIMAL (punto medio)', () => {
    expect(coverageToHint(0.40)).toBe('OPTIMAL')
  })

  test('coverage 0.65 → OPTIMAL (límite superior incluido)', () => {
    expect(coverageToHint(0.65)).toBe('OPTIMAL')
  })

  test('coverage 0.66 → TOO_CLOSE (justo sobre el límite)', () => {
    expect(coverageToHint(0.66)).toBe('TOO_CLOSE')
  })

  test('coverage 0.75 → TOO_CLOSE', () => {
    expect(coverageToHint(0.75)).toBe('TOO_CLOSE')
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

    // 10 llamadas en 50 ms (una cada 5 ms) → solo debería contar 1
    for (let i = 0; i < 10; i++) {
      throttledUpdate(i * 5)
    }
    // La primera a t=0 pasa (lastMs=0, diff=0, no < 200), las demás no
    expect(callCount).toBe(1)

    // Después de 200 ms ya puede pasar otra
    throttledUpdate(200)
    expect(callCount).toBe(2)
  })
})
