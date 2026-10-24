import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr'
import { api, session } from './http'
import { StateReplica, StateSyncError } from './stateSync'
import type { StateSnapshot } from './stateSync'
import type {
  CardPlayPreparation, CardPlayTargetSelection, CurrentGameDto, GameActionResult,
  GameFinishedDto, GameStartedDto, GameState, LobbyDto, LobbyRequest,
} from './contracts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
export type GameEvent =
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'lobbies'; lobbies: LobbyDto[] }
  | { type: 'game'; game: CurrentGameDto }
  | { type: 'state'; snapshot: StateSnapshot<GameState> }
  | { type: 'finished'; result: GameFinishedDto }
  | { type: 'error'; error: unknown }

export class FunCardsGame {
  readonly replica = new StateReplica<GameState>()
  private readonly listeners = new Set<(event: GameEvent) => void>()
  private readonly hub = new HubConnectionBuilder()
    .withUrl(api.url('/hubs/game'), { accessTokenFactory: () => session.get() || '' })
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: context =>
      [5000, 15000][context.previousRetryCount] ?? 30000 })
    .build()
  private status: ConnectionStatus = 'disconnected'
  private activeGame = false
  private syncTask: Promise<void> | null = null
  private connectTask: Promise<void> | null = null
  private disconnectTask: Promise<void> | null = null
  private connectionToken: string | null = null
  private pending = false
  private generation = 0

  constructor() {
    this.hub.on('LobbiesChanged', (lobbies: LobbyDto[]) => this.emit({ type: 'lobbies', lobbies }))
    this.hub.on('GameStarted', (_started: GameStartedDto) => {
      const generation = ++this.generation
      this.activeGame = true
      this.emit({ type: 'game', game: { hasGame: true } })
      void this.joinAndSync(generation).catch(error => this.fail(error))
    })
    this.hub.on('GameChanged', () => this.queuePatches())
    this.hub.on('GameFinished', (result: GameFinishedDto) => {
      this.generation++
      this.activeGame = false
      this.pending = false
      this.replica.clear()
      this.emit({ type: 'finished', result })
      this.emit({ type: 'game', game: { hasGame: false } })
    })
    this.hub.onreconnecting(() => {
      this.generation++
      this.replica.clear()
      this.setStatus('reconnecting')
    })
    this.hub.onreconnected(() => {
      void this.refresh().catch(error => this.fail(error))
    })
    this.hub.onclose(error => {
      this.generation++
      this.replica.clear()
      this.setStatus('disconnected')
      if (error) this.fail(error)
    })
    session.subscribe(token => {
      if (!token) void this.disconnect()
      else if (this.connectionToken && token !== this.connectionToken) {
        void this.disconnect().then(() => this.connect()).catch(error => this.fail(error))
      }
    })
  }

  subscribe(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: GameEvent): void { this.listeners.forEach(listener => listener(event)) }
  private fail(error: unknown): void { this.emit({ type: 'error', error }) }
  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.emit({ type: 'status', status })
  }

  get connectionStatus(): ConnectionStatus { return this.status }

  async connect(): Promise<void> {
    if (!session.get()) throw new Error('Сначала требуется авторизация')
    if (this.disconnectTask) await this.disconnectTask
    if (this.connectTask) return this.connectTask
    if (this.hub.state !== HubConnectionState.Disconnected) return
    this.connectTask = this.startConnection()
    try {
      await this.connectTask
    } finally { this.connectTask = null }
  }

  private async startConnection(): Promise<void> {
    this.setStatus('connecting')
    try {
      await this.hub.start()
      this.connectionToken = session.get()
      await this.refresh()
    } catch (error) {
      this.connectionToken = null
      this.setStatus('disconnected')
      await this.hub.stop()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask
    this.disconnectTask = (async () => {
      this.generation++
      this.activeGame = false
      this.connectionToken = null
      this.pending = false
      this.replica.clear()
      if (this.connectTask) await this.connectTask.catch(() => undefined)
      await this.hub.stop()
      this.setStatus('disconnected')
    })()
    try { await this.disconnectTask }
    finally { this.disconnectTask = null }
  }

  private invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    return this.hub.invoke<T>(method, ...args)
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation
    const lobbies = await this.invoke<LobbyDto[]>('GetLobbies')
    if (generation !== this.generation) return
    this.emit({ type: 'lobbies', lobbies })
    const game = await this.invoke<CurrentGameDto>('GetCurrentGame')
    if (generation !== this.generation) return
    this.activeGame = game.hasGame
    this.emit({ type: 'game', game })
    if (game.hasGame) await this.joinAndSync(generation)
    else this.replica.clear()
    if (generation === this.generation) this.setStatus('connected')
  }

  async joinAndSync(generation = this.generation): Promise<void> {
    if (!this.activeGame) return
    await this.invoke('JoinGame')
    if (generation !== this.generation) return
    await this.resync(generation)
  }

  private async resync(generation: number): Promise<void> {
    const snapshot = await this.invoke<unknown>('GetGameSnapshot')
    if (generation !== this.generation) return
    this.emit({ type: 'state', snapshot: this.replica.replace(snapshot) })
    this.queuePatches()
  }

  private queuePatches(): void {
    if (!this.activeGame) return
    this.pending = true
    if (this.syncTask) return
    const generation = this.generation
    this.syncTask = this.drainPatches(generation)
      .catch(error => this.fail(error))
      .finally(() => {
        this.syncTask = null
        if (this.pending && this.activeGame) this.queuePatches()
      })
  }

  private async drainPatches(generation: number): Promise<void> {
    let resyncAttempts = 0
    while (this.pending && generation === this.generation && this.activeGame) {
      this.pending = false
      if (!this.replica.snapshot) return
      const patches = await this.invoke<unknown>('GetGamePatches')
      if (generation !== this.generation || !this.activeGame) return
      if (!Array.isArray(patches)) throw new StateSyncError('Неверный ответ GetGamePatches')
      try {
        for (const patch of patches) this.emit({ type: 'state', snapshot: this.replica.apply(patch) })
      } catch (error) {
        this.replica.clear()
        if (++resyncAttempts > 3) {
          this.pending = false
          throw error
        }
        this.fail(error)
        await this.resync(generation)
      }
    }
  }

  getLobbies(): Promise<LobbyDto[]> { return this.invoke('GetLobbies') }
  createLobby(request: LobbyRequest): Promise<LobbyDto> { return this.invoke('CreateLobby', request) }
  joinLobby(id: string, request: LobbyRequest): Promise<LobbyDto> { return this.invoke('JoinLobby', id, request) }
  leaveLobby(id: string): Promise<void> { return this.invoke('LeaveLobby', id) }
  disbandLobby(id: string): Promise<void> { return this.invoke('DisbandLobby', id) }
  startGame(id: string): Promise<GameStartedDto> { return this.invoke('StartGame', id) }
  getCurrentGame(): Promise<CurrentGameDto> { return this.invoke('GetCurrentGame') }

  prepareCardPlay(cardId: string): Promise<CardPlayPreparation> { return this.invoke('PrepareCardPlay', cardId) }
  playCard(cardId: string, targetCellId: string | null = null, declaredTargetIds: string[] | null = null,
    targetSelections: CardPlayTargetSelection[] | null = null): Promise<GameActionResult> {
    return this.action('PlayCard', cardId, targetCellId, declaredTargetIds, targetSelections)
  }
  pass(): Promise<GameActionResult> { return this.action('Pass') }
  replaceMulliganCard(cardId: string): Promise<GameActionResult> { return this.action('ReplaceMulliganCard', cardId) }
  finishMulligan(): Promise<GameActionResult> { return this.action('FinishMulligan') }
  chooseTriggerTargets(stackItemId: string, targetIds: string[], declined: boolean): Promise<GameActionResult> {
    return this.action('ChooseTriggerTargets', stackItemId, targetIds, declined)
  }
  concede(): Promise<GameActionResult> { return this.action('Concede') }

  async refreshVisibility(): Promise<StateSnapshot<GameState>> {
    if (!this.activeGame) throw new StateSyncError('Нет активной игры')
    const generation = ++this.generation
    this.replica.clear()
    this.pending = false
    await this.syncTask
    await this.invoke('RefreshGameVisibility')
    await this.joinAndSync(generation)
    if (!this.replica.snapshot) throw new StateSyncError('Не удалось восстановить состояние игры')
    return this.replica.snapshot
  }

  private async action(method: string, ...args: unknown[]): Promise<GameActionResult> {
    const result = await this.invoke<GameActionResult>(method, ...args)
    if (result.success) this.queuePatches()
    return result
  }
}

export const game = new FunCardsGame()
