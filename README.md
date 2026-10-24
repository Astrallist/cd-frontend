# FunCards frontend

Фронтенд для карточной игры FunCards. Сейчас репозиторий содержит стартовую страницу Vite и готовый клиентский слой для
связи с бекэндом: авторизацию, HTTP API, лобби и игровые команды через SignalR, а также локальную реплику состояния по
протоколу StateSync. Игровой интерфейс в `src/main.ts` пока не реализован.

## Стек

- TypeScript 6 и Vite 8; интерфейс — обычные DOM и CSS, без UI-фреймворка.
- `@microsoft/signalr` для realtime-соединения с `/hubs/game`.
- Нативный `fetch` для HTTP и `localStorage` для токена сессии.

## Запуск

```bash
npm install
npm run dev
```

Vite открывает сайт на `http://localhost:3000`. Перед запуском нужен работающий бекэнд. По умолчанию его адрес
в [.env](.env) — `http://localhost:443/`:

```dotenv
VITE_BACKEND_URL=http://localhost:443/
```

Адрес можно поменять в `.env` или переопределить в `.env.local` (образец — [.env.example](.env.example)). После
изменения перезапустите Vite. В режиме разработки Vite проксирует `/api`, `/health`, `/hubs` и `/cards` на бекэнд, в том
числе WebSocket для SignalR. В production браузер обращается напрямую к `VITE_BACKEND_URL`: сервер должен разрешать
origin сайта, а после смены адреса требуется новая сборка.

Другие команды: `npm run build` — проверка типов и production сборка, `npm run preview` — просмотр сборки, `npm test` —
проверки HTTP-клиента и StateSync.

## Клиентское API

Все публичные объекты и типы экспортируются из `src/api/index.ts`:

| Объект         | Назначение                                                                                                                                           |
|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `client`       | Общий вход: `initialize()`, `signIn()`, `signUp()`, `logout()`, `reconnectUntilAvailable()`; доступны `client.api`, `client.game`, `client.session`. |
| `api`          | Типизированные HTTP-вызовы: пользователи, карты, наборы, колоды, локализации, изображения, REST-лобби и `/health`.                                   |
| `game`         | SignalR-лобби и команды матча, события подключения, лобби и состояния игры.                                                                          |
| `session`      | Текущий токен и пользователь; токен хранится под ключом `funcards.session`.                                                                          |
| `StateReplica` | Применение snapshot и упорядоченных patch-ей StateSync.                                                                                              |

Типы запросов, ответов и игрового состояния находятся в [`contracts.ts`](src/api/contracts.ts). Если нужны отдельные
HTTP-методы, доступны `api.get<T>()`, `post<T>()`, `put<T>()` и `delete()`.

### Пример

```ts
import {client, ApiError} from './api'

const unsubscribe = client.game.subscribe(event => {
    if (event.type === 'status') console.log('Соединение:', event.status)
    if (event.type === 'lobbies') console.log('Лобби:', event.lobbies)
    if (event.type === 'game') console.log('Есть матч:', event.game.hasGame)
    if (event.type === 'state') console.log('Версия:', event.snapshot.version, event.snapshot.state)
    if (event.type === 'finished') console.log('Победитель:', event.result.winnerPlayerId)
    if (event.type === 'error') console.error(event.error)
})

// При старте приложения восстановить сессию и подключиться к SignalR.
const user = await client.initialize()

// Если сессии нет, после входа клиент сохранит токен и подключится к hub.
if (!user) await client.signIn({username: 'alice', password: 'password'})
const decks = await client.api.decks()
if (decks.length > 0) await client.game.createLobby({deckId: decks[0].id})

if ((await client.game.getCurrentGame()).hasGame) {
    const result = await client.game.pass()
    if (!result.success) console.error(result.error)
}

try {
    if (decks.length > 0) await client.api.deck(decks[0].id)
} catch (error) {
    if (error instanceof ApiError) console.error(error.status, error.body)
}

unsubscribe()
await client.logout()
```

Пример предполагает существующие учётную запись, игровую колоду и матч. После успешного входа защищённые HTTP-запросы
получают заголовок `X-FunCards-Session`, а SignalR получает тот же токен через `accessTokenFactory`. Ответ `401` на
обычный защищённый запрос очищает сессию. При временной недоступности сервера можно вызвать
`client.reconnectUntilAvailable(signal)`.

Когда сервер сообщает об изменении игры, `game` загружает patch-и и применяет их по порядку. После reconnect клиент
повторно вступает в группу матча и получает свежий snapshot. Текущее состояние доступно через
`client.game.replica.snapshot`; UI должен только читать его и отправлять действия через методы `game`.

## Документы

- [Подробная инструкция по интеграции](docs/FrontendIntegration.md)
- [Жизненный цикл клиента и список серверных маршрутов](docs/ClientLifecycle.md)
- [Протокол StateSync JSON](docs/StateSyncJsonProtocol.md)
- [Правила игры](docs/GameRules.md)
