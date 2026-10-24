# Интеграция фронтенда с FunCards

Проект использует Vite 8, TypeScript 6 и обычный DOM/CSS. Слой сервера находится
в `src/api`; UI-фреймворк ему не нужен. `src/main.ts` пока содержит стартовую
страницу Vite.

## Адрес сервера

Адрес задаётся одной переменной `VITE_BACKEND_URL` в корневом `.env`:

```dotenv
VITE_BACKEND_URL=http://localhost:443/
```

Для локального переопределения используйте `.env.local`. После изменения
перезапустите Vite. В режиме `npm run dev` Vite проксирует `/api`, `/health`,
`/hubs` (включая WebSocket) и `/cards` на этот адрес. Браузер обращается к
своему origin, поэтому локальная разработка не зависит от настройки CORS
бекэнда. В production сборке браузер обращается напрямую к
`VITE_BACKEND_URL`; этот адрес должен быть доступен пользователю, а сервер
должен разрешать origin опубликованного сайта. Переменная встраивается при
сборке, поэтому после её смены production надо пересобрать.

## Начало работы

```ts
import { client } from './api'

try {
  const user = await client.initialize() // /api/auth/me, затем SignalR при наличии сессии
  console.log(user)
} catch (error) {
  // При временном сетевом сбое можно ждать восстановления с AbortSignal.
  console.error(error)
  await client.reconnectUntilAvailable()
}

const unsubscribe = client.game.subscribe(event => {
  if (event.type === 'status') console.log('Соединение:', event.status)
  if (event.type === 'lobbies') console.log('Лобби:', event.lobbies)
  if (event.type === 'game' && event.game.hasGame) console.log('Матч активен')
  if (event.type === 'state') console.log('Состояние:', event.snapshot.state)
  if (event.type === 'finished') console.log('Победитель:', event.result.winnerPlayerId)
  if (event.type === 'error') console.error(event.error)
})

await client.signIn({ username: 'alice', password: 'secret' })
const decks = await client.api.decks()
const lobby = await client.game.createLobby({ deckId: decks[0].id })
const action = await client.game.pass()
if (!action.success) console.error(action.error)

unsubscribe()
await client.logout()
```

`client` связывает авторизацию, HTTP и realtime. `client.api` предоставляет
типизированные методы для всех текущих маршрутов: карты, наборы, колоды,
стартовые колоды, локализации, изображения и REST-лобби. `client.game`
предоставляет hub-методы и события. Типы запросов, ответов и игровой модели
описаны в `src/api/contracts.ts` по серверным C#-контрактам. При изменении
контрактов бекэнда их нужно обновить и здесь.

Токен хранится в `localStorage` под ключом `funcards.session`. Защищённые HTTP
запросы посылают `X-FunCards-Session`; SignalR использует `accessTokenFactory`.
Получив `401` на обычный запрос, клиент удаляет токен и закрывает hub.
`client.logout()` очищает сессию даже при ошибке HTTP.

После подключения и reconnect клиент получает лобби и `GetCurrentGame`.
При активном матче вызывает `JoinGame`, затем `GetGameSnapshot` и
`GetGamePatches`. `GameChanged` и успешная команда запускают загрузку patch-ей.
При рассинхронизации реплика сбрасывается и запрашивается новый snapshot.
После `GameFinished` загрузка состояния прекращается. Данные текущей реплики
доступны через `client.game.replica.snapshot` и не должны изменяться из UI.

HTTP-ошибки представлены `ApiError` с полями `status` и `body`; ошибка
`GameActionResult` приходит в `error`. Правила обмена состоянием описаны в
[StateSyncJsonProtocol.md](StateSyncJsonProtocol.md), жизненный цикл — в
[ClientLifecycle.md](ClientLifecycle.md).
