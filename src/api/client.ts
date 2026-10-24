import { api, session } from './http'
import { game } from './game'
import type { AuthResult, LoginRequest, RegisterUserRequest, UserDto } from './contracts'

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class FunCardsClient {
  readonly api = api
  readonly game = game
  readonly session = session

  async initialize(): Promise<UserDto | null> {
    const user = await api.restore()
    if (user) await game.connect()
    return user
  }

  async signIn(credentials: LoginRequest): Promise<AuthResult> {
    await game.disconnect()
    const result = await api.signIn(credentials)
    await game.connect()
    return result
  }

  async signUp(details: RegisterUserRequest): Promise<AuthResult> {
    await game.disconnect()
    const result = await api.signUp(details)
    await game.connect()
    return result
  }

  async logout(): Promise<void> {
    try { await api.logout() }
    finally { await game.disconnect() }
  }

  // Для запуска после сетевого сбоя. Между попытками проверяется HTTP и токен.
  async reconnectUntilAvailable(signal?: AbortSignal): Promise<void> {
    let attempt = 0
    while (session.get()) {
      if (signal?.aborted) throw signal.reason
      try {
        await api.health()
        const user = await api.restore()
        if (!user) return
        await game.connect()
        return
      } catch (error) {
        if (!session.get()) throw error
        await delay([5000, 15000][attempt++] ?? 30000, signal)
      }
    }
  }
}

export const client = new FunCardsClient()
