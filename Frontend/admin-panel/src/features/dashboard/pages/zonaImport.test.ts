import { describe, it, expect } from 'vitest'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { analizarPreview, normCodigo, TEMPLATE_GEOJSON } from './zonaImport'
import type { Zona } from '../../../services/zona.service'

const POLY: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }

const feat = (props: Record<string, unknown>): Feature<Polygon | MultiPolygon> => ({
  type: 'Feature',
  geometry: POLY,
  properties: props,
})

const zona = (codigo: string, nombre: string): Zona => ({
  id: codigo, codigo, nombre, descripcion: null, activa: true,
  created_at: '2024-01-01', supervisor_id: null, supervisor_nombre: null,
  supervisor_email: null, geom: null,
})

describe('normCodigo', () => {
  it('recorta a 20 caracteres y quita espacios', () => {
    expect(normCodigo('  ZN-MUY-LARGO-QUE-SUPERA-EL-LIMITE  ')).toBe('ZN-MUY-LARGO-QUE-SUP')
    expect(normCodigo('ZN-MUY-LARGO-QUE-SUP')).toHaveLength(20)
  })
  it('maneja null/undefined', () => {
    expect(normCodigo(null)).toBe('')
    expect(normCodigo(undefined)).toBe('')
  })
})

describe('analizarPreview', () => {
  const existentes = [zona('ZN-LOS-CHILLOS', 'Los Chillos'), zona('ZN-TUMBACO', 'Tumbaco')]

  it('marca como NUEVA un código que no existe en la BD', () => {
    const filas = analizarPreview([feat({ codigo: 'ZN-SANGOLQUI', nombre: 'Valle de Sangolquí' })], existentes)
    expect(filas).toHaveLength(1)
    expect(filas[0].existe).toBeUndefined()
    expect(filas[0].errores).toEqual([])
  })

  it('detecta colisión con una zona existente (→ actualizará)', () => {
    const filas = analizarPreview([feat({ codigo: 'ZN-LOS-CHILLOS', nombre: 'Otro nombre' })], existentes)
    expect(filas[0].existe?.nombre).toBe('Los Chillos')
  })

  it('la comparación de código es insensible a mayúsculas', () => {
    const filas = analizarPreview([feat({ codigo: 'zn-tumbaco', nombre: 'x' })], existentes)
    expect(filas[0].existe?.codigo).toBe('ZN-TUMBACO')
  })

  it('reporta error cuando falta el código', () => {
    const filas = analizarPreview([feat({ nombre: 'Sin código' })], existentes)
    expect(filas[0].errores.some((e) => e.includes("Falta 'codigo'"))).toBe(true)
    expect(filas[0].existe).toBeUndefined()
  })

  it('reporta error cuando falta el nombre', () => {
    const filas = analizarPreview([feat({ codigo: 'ZN-NUEVA' })], existentes)
    expect(filas[0].errores.some((e) => e.includes("Falta 'nombre'"))).toBe(true)
  })

  it('avisa cuando el código supera 20 caracteres y muestra el recorte', () => {
    const filas = analizarPreview([feat({ codigo: 'ZN-CODIGO-DEMASIADO-LARGO', nombre: 'x' })], existentes)
    expect(filas[0].codigo).toHaveLength(20)
    expect(filas[0].errores.some((e) => e.includes('20 caracteres'))).toBe(true)
  })

  it('detecta códigos duplicados dentro del mismo archivo', () => {
    const filas = analizarPreview(
      [feat({ codigo: 'ZN-DUP', nombre: 'A' }), feat({ codigo: 'ZN-DUP', nombre: 'B' })],
      existentes,
    )
    expect(filas[0].errores).toEqual([])
    expect(filas[1].errores.some((e) => e.includes('repetido'))).toBe(true)
  })

  it('una zona limpia y nueva no produce errores', () => {
    const filas = analizarPreview([feat({ codigo: 'ZN-NUEVA', nombre: 'Nueva' })], existentes)
    expect(filas[0].errores).toEqual([])
    expect(filas[0].existe).toBeUndefined()
  })
})

describe('TEMPLATE_GEOJSON', () => {
  it('es un FeatureCollection válido que pasa su propio análisis sin errores', () => {
    const features = TEMPLATE_GEOJSON.features as Feature<Polygon | MultiPolygon>[]
    const filas = analizarPreview(features, [])
    expect(TEMPLATE_GEOJSON.type).toBe('FeatureCollection')
    expect(filas[0].errores).toEqual([])
    expect(filas[0].codigo).toBe('ZN-EJEMPLO')
  })
})
