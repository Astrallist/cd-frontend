export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface StateSnapshot<T = JsonValue> {
  version: number
  state: T
}

interface PatchBase {
  fromVersion: number
  toVersion: number
  path: string
}

export type StatePatch =
  | (PatchBase & { kind: 'replaceValue'; value: JsonValue })
  | (PatchBase & { kind: 'insertListItem' | 'replaceListItem'; index: number; value: JsonValue })
  | (PatchBase & { kind: 'removeListItem'; index: number })
  | (PatchBase & { kind: 'moveListItem'; fromIndex: number; toIndex: number })
  | (PatchBase & { kind: 'clearList' })

export class StateSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateSyncError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function version(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function index(value: unknown, length: number, allowEnd = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= length + Number(allowEnd)) {
    throw new StateSyncError('Индекс списка вне границ')
  }
  return value as number
}

function segments(path: unknown): string[] {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new StateSyncError('Неверный путь')
  if (path === '/') return []
  const parts = path.slice(1).split('/')
  if (parts.some(part => !part || /~(?![01])/.test(part))) throw new StateSyncError('Неверный путь')
  return parts.map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function resolve(root: unknown, parts: string[]): unknown {
  let current = root
  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(part)) throw new StateSyncError('Неверный индекс в пути')
      current = current[index(Number(part), current.length)]
    } else if (record(current) && Object.hasOwn(current, part)) {
      current = current[part]
    } else {
      throw new StateSyncError('Путь не существует')
    }
  }
  return current
}

function requiredValue(patch: Record<string, unknown>): JsonValue {
  if (!Object.hasOwn(patch, 'value')) throw new StateSyncError('Отсутствует value')
  return patch.value as JsonValue
}

// Схему state задаёт игра. Этот слой проверяет структуру операции и путь.
export class StateReplica<T = JsonValue> {
  private current: StateSnapshot<T> | null = null

  get snapshot(): StateSnapshot<T> | null { return this.current }

  clear(): void { this.current = null }

  replace(snapshot: unknown): StateSnapshot<T> {
    if (!record(snapshot) || !version(snapshot.version) || !Object.hasOwn(snapshot, 'state')) {
      throw new StateSyncError('Неверный snapshot')
    }
    this.current = { version: snapshot.version, state: snapshot.state as T }
    return this.current
  }

  apply(raw: unknown): StateSnapshot<T> {
    if (!this.current) throw new StateSyncError('Сначала нужен snapshot')
    if (!record(raw) || !version(raw.fromVersion) || !version(raw.toVersion) ||
      raw.fromVersion !== this.current.version || raw.toVersion < raw.fromVersion) {
      throw new StateSyncError('Неверная версия patch')
    }
    const parts = segments(raw.path)
    const root = structuredClone(this.current.state) as unknown
    let updated: unknown = root

    if (raw.kind === 'replaceValue') {
      const value = requiredValue(raw)
      if (parts.length === 0) {
        updated = value
      } else {
        const parent = resolve(root, parts.slice(0, -1))
        const key = parts.at(-1)!
        if (!record(parent) || !Object.hasOwn(parent, key)) throw new StateSyncError('Свойство не существует')
        parent[key] = value
      }
    } else {
      const list = resolve(root, parts)
      if (!Array.isArray(list)) throw new StateSyncError('Путь не указывает на список')
      switch (raw.kind) {
        case 'insertListItem':
          list.splice(index(raw.index, list.length, true), 0, requiredValue(raw))
          break
        case 'removeListItem':
          list.splice(index(raw.index, list.length), 1)
          break
        case 'replaceListItem':
          list[index(raw.index, list.length)] = requiredValue(raw)
          break
        case 'moveListItem': {
          const from = index(raw.fromIndex, list.length)
          const to = index(raw.toIndex, list.length)
          list.splice(to, 0, list.splice(from, 1)[0])
          break
        }
        case 'clearList':
          list.length = 0
          break
        default:
          throw new StateSyncError('Неизвестный kind')
      }
    }
    this.current = { version: raw.toVersion, state: updated as T }
    return this.current
  }
}
