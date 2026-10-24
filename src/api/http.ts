import { apiUrl } from './config'
import type {
  AuthResult, CardImageDto, CardSetDto, CardSetRequest, CardTemplateDto, CardTemplateRequest,
  CardTextDefinitionDto, DeckConstructionRulesDto, DeckDto, DeckRequest, GameStartedDto,
  LobbyDto, LobbyRequest, LocalizationEntryDto, LocalizationRequest, LoginRequest,
  RegisterUserRequest, StarterDeckDto, StarterDeckRequest, UserDto, UserExistsResponse,
} from './contracts'

const SESSION_KEY = 'funcards.session'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export class SessionStore {
  private token = localStorage.getItem(SESSION_KEY)
  private user: UserDto | null = null
  private initialized = false
  private listeners = new Set<(token: string | null) => void>()

  constructor() {
    window.addEventListener('storage', event => {
      if (event.key === SESSION_KEY) this.set(event.newValue)
    })
  }

  get(): string | null { return this.token }
  get currentUser(): UserDto | null { return this.user }
  get isInitialized(): boolean { return this.initialized }

  set(token: string | null, user: UserDto | null = null): void {
    this.token = token
    this.user = user
    this.initialized = true
    if (token) localStorage.setItem(SESSION_KEY, token)
    else localStorage.removeItem(SESSION_KEY)
    this.listeners.forEach(listener => listener(token))
  }

  setUser(user: UserDto): void { this.user = user; this.initialized = true }
  markInitialized(): void { this.initialized = true }

  subscribe(listener: (token: string | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const session = new SessionStore()

type RequestOptions = { auth?: boolean; signal?: AbortSignal; clearOnUnauthorized?: boolean }

export class FunCardsApi {
  url(path: `/${string}`): string { return apiUrl(path) }

  async request<T>(method: string, path: `/${string}`, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers()
    const isForm = body instanceof FormData
    if (body !== undefined && !isForm) headers.set('Content-Type', 'application/json')
    if (options.auth !== false && session.get()) headers.set('X-FunCards-Session', session.get()!)
    const response = await fetch(this.url(path), {
      method, headers, signal: options.signal,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
    if (response.status === 401 && options.clearOnUnauthorized !== false && options.auth !== false) session.set(null)
    const raw = response.status === 204 ? '' : await response.text()
    let data: unknown = raw || undefined
    if (raw && response.headers.get('content-type')?.includes('json')) {
      try { data = JSON.parse(raw) as unknown } catch { if (response.ok) throw new Error('Неверный JSON-ответ сервера') }
    }
    if (!response.ok) throw new ApiError(response.status, data)
    return data as T
  }

  health(): Promise<{ status: string }> { return this.request('GET', '/health', undefined, { auth: false }) }
  login(credentials: LoginRequest): Promise<AuthResult> {
    return this.request('POST', '/api/auth/login', credentials, { auth: false })
  }
  register(details: RegisterUserRequest): Promise<AuthResult> {
    return this.request('POST', '/api/users', details, { auth: false })
  }
  async usernameExists(username: string): Promise<boolean> {
    const result = await this.request<UserExistsResponse>('GET', `/api/users/${encodeURIComponent(username)}/exists`, undefined, { auth: false })
    return result.exists
  }
  me(): Promise<UserDto> { return this.request('GET', '/api/auth/me') }
  async restore(): Promise<UserDto | null> {
    if (!session.get()) { session.markInitialized(); return null }
    try {
      const user = await this.me()
      session.setUser(user)
      return user
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  }
  async signIn(credentials: LoginRequest): Promise<AuthResult> {
    const result = await this.login(credentials)
    session.set(result.token, result.user)
    return result
  }
  async signUp(details: RegisterUserRequest): Promise<AuthResult> {
    const result = await this.register(details)
    session.set(result.token, result.user)
    return result
  }
  async logout(): Promise<void> {
    try { await this.request('POST', '/api/auth/logout', undefined, { clearOnUnauthorized: false }) }
    finally { session.set(null) }
  }

  get<T>(path: `/${string}`, signal?: AbortSignal): Promise<T> { return this.request('GET', path, undefined, { signal }) }
  post<T>(path: `/${string}`, body?: unknown): Promise<T> { return this.request('POST', path, body) }
  put<T>(path: `/${string}`, body: unknown): Promise<T> { return this.request('PUT', path, body) }
  delete(path: `/${string}`): Promise<void> { return this.request('DELETE', path) }

  cardTemplates(): Promise<CardTemplateDto[]> { return this.get('/api/card-templates') }
  cardTemplate(id: string): Promise<CardTemplateDto> { return this.get(`/api/card-templates/${encodeURIComponent(id)}`) }
  createCardTemplate(request: CardTemplateRequest): Promise<CardTemplateDto> { return this.post('/api/card-templates', request) }
  updateCardTemplate(id: string, request: CardTemplateRequest): Promise<CardTemplateDto> {
    return this.put(`/api/card-templates/${encodeURIComponent(id)}`, request)
  }
  deleteCardTemplate(id: string): Promise<void> { return this.delete(`/api/card-templates/${encodeURIComponent(id)}`) }
  cardTexts(): Promise<CardTextDefinitionDto[]> { return this.get('/api/card-texts') }
  deckConstructionRules(): Promise<DeckConstructionRulesDto> { return this.get('/api/deck-construction-rules') }

  cardSets(): Promise<CardSetDto[]> { return this.get('/api/card-sets') }
  createCardSet(request: CardSetRequest): Promise<CardSetDto> { return this.post('/api/card-sets', request) }
  updateCardSet(id: string, request: CardSetRequest): Promise<CardSetDto> { return this.put(`/api/card-sets/${encodeURIComponent(id)}`, request) }
  deleteCardSet(id: string): Promise<void> { return this.delete(`/api/card-sets/${encodeURIComponent(id)}`) }

  decks(): Promise<DeckDto[]> { return this.get('/api/decks') }
  deck(id: string): Promise<DeckDto> { return this.get(`/api/decks/${encodeURIComponent(id)}`) }
  createDeck(request: DeckRequest): Promise<DeckDto> { return this.post('/api/decks', request) }
  updateDeck(id: string, request: DeckRequest): Promise<DeckDto> { return this.put(`/api/decks/${encodeURIComponent(id)}`, request) }
  deleteDeck(id: string): Promise<void> { return this.delete(`/api/decks/${encodeURIComponent(id)}`) }

  starterDecks(): Promise<StarterDeckDto[]> { return this.get('/api/admin/starter-decks') }
  createStarterDeck(request: StarterDeckRequest): Promise<StarterDeckDto> { return this.post('/api/admin/starter-decks', request) }
  updateStarterDeck(id: string, request: StarterDeckRequest): Promise<StarterDeckDto> {
    return this.put(`/api/admin/starter-decks/${encodeURIComponent(id)}`, request)
  }
  deleteStarterDeck(id: string): Promise<void> { return this.delete(`/api/admin/starter-decks/${encodeURIComponent(id)}`) }

  localizations(culture?: string): Promise<LocalizationEntryDto[]> {
    return this.get(culture ? `/api/localizations/${encodeURIComponent(culture)}` : '/api/localizations')
  }
  upsertLocalization(request: LocalizationRequest): Promise<LocalizationEntryDto> { return this.put('/api/localizations', request) }
  deleteLocalization(culture: string, key: string): Promise<void> {
    return this.delete(`/api/localizations/${encodeURIComponent(culture)}/${encodeURIComponent(key)}`)
  }

  cardImageKeys(): Promise<string[]> { return this.get('/api/card-images') }
  cardImageUrl(key: string): string { return this.url(`/api/card-images/${encodeURIComponent(key)}`) }
  uploadCardImage(image: File, key?: string): Promise<CardImageDto> {
    const form = new FormData()
    form.append('image', image, image.name)
    if (key) form.append('key', key)
    return this.post('/api/card-images', form)
  }
  deleteCardImage(key: string): Promise<void> { return this.delete(`/api/card-images/${encodeURIComponent(key)}`) }

  lobbies(): Promise<LobbyDto[]> { return this.get('/api/lobbies') }
  createLobby(request: LobbyRequest): Promise<LobbyDto> { return this.post('/api/lobbies', request) }
  joinLobby(id: string, request: LobbyRequest): Promise<LobbyDto> { return this.post(`/api/lobbies/${encodeURIComponent(id)}/join`, request) }
  startGame(id: string): Promise<GameStartedDto> { return this.post(`/api/lobbies/${encodeURIComponent(id)}/start`) }
  leaveLobby(id: string): Promise<void> { return this.post(`/api/lobbies/${encodeURIComponent(id)}/leave`) }
  disbandLobby(id: string): Promise<void> { return this.post(`/api/lobbies/${encodeURIComponent(id)}/disband`) }
}

export const api = new FunCardsApi()
