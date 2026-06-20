import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  storeAuthTokens,
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  AUTH_SESSION_CLEARED_EVENT,
} from './authSession'

vi.mock('./authService', () => ({
  refreshRequest: vi.fn(),
  logoutRequest:  vi.fn(),
}))

const makeJwt = (payload: object): string => {
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.fakesig`
}

const NOW = Math.floor(Date.now() / 1000)
const VALID_JWT   = makeJwt({ id: '1', nombre: 'Admin', rol: 'admin', exp: NOW + 3600 })
const EXPIRED_JWT = makeJwt({ id: '2', nombre: 'Old',   rol: 'admin', exp: NOW - 3600 })

const TOKENS = { token: VALID_JWT, refreshToken: 'rt-admin-abc' }

beforeEach(() => localStorage.clear())

describe('storeAuthTokens / getAccessToken / getRefreshToken', () => {
  it('persists both tokens under admin-specific keys', () => {
    storeAuthTokens(TOKENS)
    expect(getAccessToken()).toBe(VALID_JWT)
    expect(getRefreshToken()).toBe('rt-admin-abc')
  })

  it('does not leak into supervisor-panel keys', () => {
    storeAuthTokens(TOKENS)
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })
})

describe('clearAuthTokens', () => {
  it('removes both tokens', () => {
    storeAuthTokens(TOKENS)
    clearAuthTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('emits AUTH_SESSION_CLEARED_EVENT when a session existed', () => {
    storeAuthTokens(TOKENS)
    const listener = vi.fn()
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
    clearAuthTokens()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
  })

  it('does NOT emit event when no session existed', () => {
    const listener = vi.fn()
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
    clearAuthTokens()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
  })
})

describe('getStoredUser', () => {
  it('returns null when no token is stored', () => {
    expect(getStoredUser()).toBeNull()
  })

  it('returns decoded user from a valid token', () => {
    storeAuthTokens(TOKENS)
    const user = getStoredUser()
    expect(user?.nombre).toBe('Admin')
    expect(user?.rol).toBe('admin')
  })

  it('clears tokens and returns null on an invalid JWT', () => {
    storeAuthTokens({ token: 'not.a.jwt', refreshToken: 'rt' })
    expect(getStoredUser()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('returns user from expired token when refresh token exists', () => {
    storeAuthTokens({ token: EXPIRED_JWT, refreshToken: 'rt-xyz' })
    const user = getStoredUser()
    expect(user?.nombre).toBe('Old')
  })

  it('clears tokens and returns null for expired token without refresh', () => {
    storeAuthTokens({ token: EXPIRED_JWT, refreshToken: '' })
    expect(getStoredUser()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })
})
