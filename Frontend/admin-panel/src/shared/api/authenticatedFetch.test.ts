import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../features/auth/authSession', () => ({
  getValidAccessToken:  vi.fn(),
  refreshStoredSession: vi.fn(),
  clearAuthTokens:      vi.fn(),
}))

import { authenticatedFetch } from './authenticatedFetch'
import { getValidAccessToken, refreshStoredSession, clearAuthTokens } from '../../features/auth/authSession'

const makeRes = (status: number, body: object = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => vi.clearAllMocks())

describe('authenticatedFetch', () => {
  it('throws "Sesion expirada" when no valid token', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue(null)
    await expect(authenticatedFetch('https://api.example.com')).rejects.toThrow('Sesion expirada')
  })

  it('adds Authorization Bearer header', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('admin-token')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeRes(200))

    await authenticatedFetch('https://api.example.com')

    const headers = spy.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer admin-token')
  })

  it('sets Content-Type application/json when body is not FormData', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeRes(200))

    await authenticatedFetch('https://api.example.com', { method: 'POST', body: '{}' })

    const headers = spy.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('does not set Content-Type when body is FormData', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeRes(200))

    await authenticatedFetch('https://api.example.com', { method: 'POST', body: new FormData() })

    const headers = spy.mock.calls[0][1]?.headers as Headers
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('returns response directly when status is not 401', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeRes(200))

    const res = await authenticatedFetch('https://api.example.com')
    expect(res.status).toBe(200)
  })

  it('retries with refreshed token on 401', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('old-token')
    vi.mocked(refreshStoredSession).mockResolvedValue({ token: 'new-token', refreshToken: 'rt' })

    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeRes(401))
      .mockResolvedValueOnce(makeRes(200))

    const res = await authenticatedFetch('https://api.example.com')

    expect(spy).toHaveBeenCalledTimes(2)
    const retryHeaders = spy.mock.calls[1][1]?.headers as Headers
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-token')
    expect(res.status).toBe(200)
  })

  it('clears tokens and returns 401 when refresh fails', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token')
    vi.mocked(refreshStoredSession).mockResolvedValue(null)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeRes(401))

    const res = await authenticatedFetch('https://api.example.com')

    expect(vi.mocked(clearAuthTokens)).toHaveBeenCalled()
    expect(res.status).toBe(401)
  })
})
