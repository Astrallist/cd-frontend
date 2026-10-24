import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

test('HTTP client uses the proxy paths, session header and backend response shapes', async () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  globalThis.window = { addEventListener() {} }
  const server = await createServer({ server: { middlewareMode: true, open: false } })
  const originalFetch = globalThis.fetch
  try {
    const { api, session, ApiError } = await server.ssrLoadModule('/src/api/http.ts')
    const calls = []
    const responses = [
      Response.json({ exists: false }),
      Response.json({ token: 'test-token', user: { id: 'u', username: 'a', email: 'a@b.c' } }),
      Response.json([]),
      Response.json({ error: 'expired' }, { status: 401 }),
      Response.json({ token: 'new-token', user: { id: 'u', username: 'a', email: 'a@b.c' } }),
      new Response(null, { status: 401 }),
    ]
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options })
      return responses.shift()
    }

    assert.equal(await api.usernameExists('a b'), false)
    assert.equal(calls[0].url, '/api/users/a%20b/exists')
    assert.equal(calls[0].options.headers.has('X-FunCards-Session'), false)
    await api.signIn({ username: 'a', password: 'pw' })
    assert.equal(session.get(), 'test-token')
    assert.equal(session.currentUser.username, 'a')
    assert.deepEqual(await api.decks(), [])
    assert.equal(calls[2].options.headers.get('X-FunCards-Session'), 'test-token')
    await assert.rejects(api.me(), error => error instanceof ApiError && error.status === 401)
    assert.equal(session.get(), null)
    assert.equal(values.has('funcards.session'), false)
    await api.signIn({ username: 'a', password: 'pw' })
    await assert.rejects(api.logout(), error => error instanceof ApiError && error.status === 401)
    assert.equal(calls[5].options.headers.get('X-FunCards-Session'), 'new-token')
    assert.equal(session.get(), null)
  } finally {
    globalThis.fetch = originalFetch
    await server.close()
  }
})
