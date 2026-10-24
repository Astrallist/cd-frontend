// Поля DTO сериализуются сервером через System.Text.Json с JsonSerializerDefaults.Web.
export type Guid = string
export type MoralAlignment = 'good' | 'neutral' | 'evil'
export type OrderAlignment = 'lawful' | 'neutral' | 'chaotic'
export type CardRarity = 'common' | 'rare' | 'mythic'
export type CardType = 'unit' | 'slow' | 'fast' | 'instant'
export type CardStatus = 'regeneration' | 'piercing' | 'shield' | 'cleave' | 'fleeting'
export type GamePhase = 'created' | 'init' | 'mulligan' | 'playing' | 'combat' | 'finished'
export type RoundPhase = 'none' | 'startRound' | 'roundDraw' | 'play' | 'combat' | 'endRound'
export type TriggerSelectionKind = 'cardList' | 'battlefield' | 'battlefieldCell' | 'hand' | 'stack'
export type TriggerStackItemKind = 'card' | 'trigger'

export interface UserDto { id: Guid; username: string; email: string }
export interface LoginRequest { username: string; password: string }
export interface RegisterUserRequest extends LoginRequest { email: string }
export interface AuthResult { token: string; user: UserDto }
export interface UserExistsResponse { exists: boolean }

export interface CardTextDto { key: string }
export interface CardTemplateDto {
  id: Guid; key: string; version: number; setKey: string | null
  moralAlignment: MoralAlignment | null; orderAlignment: OrderAlignment | null
  manaCost: number; rarity: string; type: string; imageKey: string | null
  tags: string[]; health: number; attack: number; texts: CardTextDto[]; isTechnical: boolean
}
export type CardTemplateRequest = Omit<CardTemplateDto, 'id' | 'isTechnical'> & { isTechnical?: boolean }
export interface CardTextDefinitionDto { key: string }
export interface CardSetDto { id: Guid; key: string }
export interface CardSetRequest { key: string }
export interface DeckCardDto { cardTemplateId: Guid; cardTemplateKey: string; quantity: number }
export interface DeckCardRequest { cardTemplateId: Guid; quantity: number }
export interface DeckDto {
  id: Guid; ownerUserId: Guid; name: string; isPlayable: boolean
  moralAlignment: MoralAlignment | null; orderAlignment: OrderAlignment | null; cards: DeckCardDto[]
}
export interface DeckRequest {
  name: string; cards: DeckCardRequest[]
  moralAlignment: MoralAlignment; orderAlignment: OrderAlignment
}
export interface DeckRarityCopyLimitDto { rarity: string; maxCopies: number }
export interface DeckConstructionRulesDto { minimumCardCount: number; rarityCopyLimits: DeckRarityCopyLimitDto[] }
export interface StarterDeckDto {
  id: Guid; name: string; isEnabled: boolean; isPlayable: boolean; cards: DeckCardDto[]
}
export interface StarterDeckRequest { name: string; isEnabled: boolean; cards: DeckCardRequest[] }
export interface LocalizationEntryDto { culture: string; key: string; value: string }
export type LocalizationRequest = LocalizationEntryDto
export interface CardImageDto { key: string; url: string }

export interface LobbyPlayerDto {
  userId: Guid; username: string; deckId: Guid; deckName: string; isOwner: boolean
  moralAlignment: MoralAlignment | null; orderAlignment: OrderAlignment | null
}
export interface LobbyDto { id: Guid; name: string; status: string; players: LobbyPlayerDto[] }
export interface LobbyRequest { deckId: Guid }
export interface GameStartedDto { lobbyId: Guid }
export interface CurrentGameDto { hasGame: boolean }
export interface GameFinishedDto { winnerPlayerId: Guid }
export interface GameActionResult { success: boolean; error: string | null }
export interface CardPlayTargetSelection { declined: boolean; targetIds: Guid[] }
export interface CardPlayTargetRequest {
  kind: TriggerSelectionKind; minCount: number; maxCount: number
  allowDecline: boolean; targetIds: Guid[]
}
export interface CardPlayPreparation { result: GameActionResult; targetRequests: CardPlayTargetRequest[] }

// StateSync хранит имена свойств модели как есть (PascalCase), в отличие от DTO выше.
export interface CardState {
  Id: Guid; OwnerPlayerId: Guid; TemplateKey: string
  BaseManaCost: number; ManaCostGain: number; Rarity: CardRarity; Type: CardType
  ImageKey: string | null; Tags: string[]; Texts: { Id: Guid; Key: string }[]
  Statuses: CardStatus[]; BaseHealth: number; HealthGain: number; RoundHealthGain: number
  BaseAttack: number; AttackGain: number; RoundAttackGain: number
  ContinuousAttackGain: number; ContinuousHealthGain: number
}
export interface BattlefieldCell { Id: Guid; Card: CardState | null }
export interface Battlefield { Left: BattlefieldCell[]; Right: BattlefieldCell[] }
export interface PlayerState {
  Id: Guid; DisplayName: string; Health: number; CurrentMana: number; MaxMana: number
  NextActionManaDiscount: number; PlayedCardThisTurn: boolean; PassedWithoutPlaying: boolean
  MulliganReplacementsRemaining: number; MulliganCompleted: boolean
  Hand: (CardState | null)[]; Library: (CardState | null)[]
  Battlefield: Battlefield; Discard: (CardState | null)[]
}
export interface TriggerSelectionRequest {
  Kind: TriggerSelectionKind; PlayerId: Guid; MinCount: number; MaxCount: number
  AllowDecline: boolean; TargetIds: Guid[]
}
export interface TriggerStackItem {
  Id: Guid; Kind: TriggerStackItemKind; PlayerId: Guid; TargetCellId: Guid | null
  Card: CardState | null; SourceCardId: Guid | null; SourceTextId: Guid | null
  TriggerKey: string; SelectionRequest: TriggerSelectionRequest | null
  SelectedTargetIds: Guid[]; DeclaredTargetIds: Guid[]; SelectionDeclined: boolean
}
export interface GameState {
  Id: Guid; ModeKey: string; Phase: GamePhase; RoundPhase: RoundPhase
  RoundNumber: number; ActivePlayerId: Guid; AttackingPlayerId: Guid; WinnerPlayerId: Guid | null
  Players: PlayerState[]; TriggerStack: TriggerStackItem[]
}
