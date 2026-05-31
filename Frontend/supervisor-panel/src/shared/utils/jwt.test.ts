import { describe, it, expect } from 'vitest'
import { getUserFromToken, isTokenExpired, hasAllowedRole } from './jwt'
import type { AuthUser } from './jwt'

const makeJwt = (payload: object): string => {
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.fakesig`
}

const NOW = Math.floor(Date.now() / 1000)
const VALID_TOKEN   = makeJwt({ id: '1', nombre: 'Ana', rol: 'supervisor', exp: NOW + 3600 })
const EXPIRED_TOKEN = makeJwt({ id: '2', nombre: 'Bob', rol: 'operador',   exp: NOW - 3600 })
const NO_EXP_TOKEN  = makeJwt({ nombre: 'X', rol: 'supervisor' })

describe('getUserFromToken', () => {
  it('decodes payload correctly', () => {
    const user = getUserFromToken(VALID_TOKEN)
    expect(user.nombre).toBe('Ana')
    expect(user.rol).toBe('supervisor')
  })
})

describe('isTokenExpired', () => {
  it('returns false for a valid token', () => {
    expect(isTokenExpired(VALID_TOKEN)).toBe(false)
  })

  it('returns true for an expired token', () => {
    expect(isTokenExpired(EXPIRED_TOKEN)).toBe(true)
  })

  it('returns true when exp is absent', () => {
    expect(isTokenExpired(NO_EXP_TOKEN)).toBe(true)
  })

  it('applies skewSeconds: token expiring in 30s is expired with 60s skew', () => {
    const token = makeJwt({ nombre: 'X', rol: 'y', exp: NOW + 30 })
    expect(isTokenExpired(token, 60)).toBe(true)
    expect(isTokenExpired(token, 0)).toBe(false)
  })
})

describe('hasAllowedRole', () => {
  const user: AuthUser = { nombre: 'Ana', rol: 'supervisor' }

  it('returns true when role is in the allowed list', () => {
    expect(hasAllowedRole(user, ['supervisor', 'admin'])).toBe(true)
  })

  it('returns false when role is not in the allowed list', () => {
    expect(hasAllowedRole(user, ['admin', 'operador'])).toBe(false)
  })

  it('returns false for an empty allowed list', () => {
    expect(hasAllowedRole(user, [])).toBe(false)
  })
})
