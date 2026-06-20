type AuthSessionListener = (token: string | null) => void

const listeners = new Set<AuthSessionListener>()

export function subscribeAuthSession(listener: AuthSessionListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyAuthTokenUpdated(token: string) {
  listeners.forEach((listener) => listener(token))
}

export function notifyAuthSessionExpired() {
  listeners.forEach((listener) => listener(null))
}
