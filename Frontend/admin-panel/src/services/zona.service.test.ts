import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/env', () => ({
  API_URL: 'https://api.example.com/api',
}))

vi.mock('../shared/api/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn(),
}))

import { listZonas, updateZona, importZonas } from './zona.service'
import { authenticatedFetch } from '../shared/api/authenticatedFetch'
import type { Feature, Polygon } from 'geojson'

const makeRes = (body: object, ok = true) =>
  new Response(JSON.stringify(body), { status: ok ? 200 : 500 })

const ZONA = {
  id: 'z1', codigo: 'Z01', nombre: 'Norte', descripcion: null,
  activa: true, created_at: '2024-01-01', supervisor_id: null,
  supervisor_nombre: null, supervisor_email: null, geom: null,
}

beforeEach(() => vi.clearAllMocks())

describe('listZonas', () => {
  it('returns zonas array on success', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({ zonas: [ZONA] }))
    const result = await listZonas()
    expect(result.zonas).toHaveLength(1)
    expect(result.zonas[0].codigo).toBe('Z01')
  })

  it('throws on HTTP error', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({}, false))
    await expect(listZonas()).rejects.toThrow('Error al obtener zonas')
  })
})

describe('updateZona', () => {
  it('sends PUT to the correct URL', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({ zona: { ...ZONA, nombre: 'Sur' } }))
    await updateZona('z1', { nombre: 'Sur' })
    expect(vi.mocked(authenticatedFetch)).toHaveBeenCalledWith(
      expect.stringContaining('/zonas/z1'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('throws error message from response body on HTTP error', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      makeRes({ error: 'Zona no encontrada' }, false),
    )
    await expect(updateZona('z99', { nombre: 'X' })).rejects.toThrow('Zona no encontrada')
  })

  it('falls back to generic message when body has no error field', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({}, false))
    await expect(updateZona('z99', {})).rejects.toThrow('Error al actualizar zona')
  })
})

describe('importZonas', () => {
  const FEATURES: Feature<Polygon>[] = [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {},
    },
  ]

  it('returns imported count on success', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({ zonas: [ZONA], imported: 1 }))
    const result = await importZonas(FEATURES)
    expect(result.imported).toBe(1)
  })

  it('throws on HTTP error', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeRes({}, false))
    await expect(importZonas(FEATURES)).rejects.toThrow('Error al importar zonas')
  })
})
