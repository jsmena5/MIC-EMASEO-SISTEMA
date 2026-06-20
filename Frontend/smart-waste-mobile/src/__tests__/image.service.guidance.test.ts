/**
 * Tests unitarios para los nuevos campos de guidance en image.service.ts:
 *   - preCheckImage con guidanceMode=true → body incluye guidance_mode: true
 *   - preCheckImage sin opciones → body NO incluye guidance_mode
 *   - analyzeImage con clientCoverageRatio → body incluye client_coverage_ratio
 */

jest.mock('../utils/api', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}))

import api from '../utils/api'
import { preCheckImage, analyzeImage } from '../services/image.service'

const mockPost = api.post as jest.Mock

const THUMB_B64 = 'dGVzdA=='   // base64 de "test"
const IMAGE_B64 = 'aW1hZ2U='  // base64 de "image"

beforeEach(() => {
  mockPost.mockReset()
})

// ─── preCheckImage ────────────────────────────────────────────────────────────

describe('preCheckImage', () => {
  test('sin opciones → body NO contiene guidance_mode', async () => {
    mockPost.mockResolvedValueOnce({
      data: { garbage_score: 0.5, is_garbage: true, threshold: 0.35 },
    })

    await preCheckImage(THUMB_B64)

    expect(mockPost).toHaveBeenCalledWith(
      '/ml/pre-check',
      { image_base64: THUMB_B64 },
      expect.objectContaining({ timeout: 12_000 }),
    )
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('guidance_mode')
  })

  test('guidanceMode=true → body contiene guidance_mode: true', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        garbage_score: 0.72,
        is_garbage: true,
        threshold: 0.35,
        coverage_ratio: 0.42,
        distance_hint: 'OPTIMAL',
      },
    })

    const result = await preCheckImage(THUMB_B64, { guidanceMode: true })

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).toHaveProperty('guidance_mode', true)
    expect(result.coverage_ratio).toBe(0.42)
    expect(result.distance_hint).toBe('OPTIMAL')
  })

  test('guidanceMode=false → body NO contiene guidance_mode', async () => {
    mockPost.mockResolvedValueOnce({
      data: { garbage_score: 0.3, is_garbage: false, threshold: 0.35 },
    })

    await preCheckImage(THUMB_B64, { guidanceMode: false })

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('guidance_mode')
  })
})

// ─── analyzeImage ─────────────────────────────────────────────────────────────

describe('analyzeImage', () => {
  test('sin clientCoverageRatio → body NO contiene client_coverage_ratio', async () => {
    mockPost.mockResolvedValueOnce({
      data: { task_id: 'abc', estado: 'PROCESANDO', message: 'ok', poll_url: '/status/abc' },
    })

    await analyzeImage(IMAGE_B64, -0.1807, -78.4678)

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('client_coverage_ratio')
  })

  test('clientCoverageRatio=0.42 → body contiene client_coverage_ratio: 0.42', async () => {
    mockPost.mockResolvedValueOnce({
      data: { task_id: 'xyz', estado: 'PROCESANDO', message: 'ok', poll_url: '/status/xyz' },
    })

    await analyzeImage(IMAGE_B64, -0.1807, -78.4678, undefined, {
      clientCoverageRatio: 0.42,
    })

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).toHaveProperty('client_coverage_ratio', 0.42)
  })

  test('clientCoverageRatio=0 (falsy) → body contiene client_coverage_ratio: 0', async () => {
    mockPost.mockResolvedValueOnce({
      data: { task_id: 'xyz', estado: 'PROCESANDO', message: 'ok', poll_url: '/status/xyz' },
    })

    await analyzeImage(IMAGE_B64, -0.1807, -78.4678, undefined, {
      clientCoverageRatio: 0,
    })

    // 0 es un valor válido de cobertura (imagen en negro)
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).toHaveProperty('client_coverage_ratio', 0)
  })
})
