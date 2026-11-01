import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import handler from '../api/[...path].ts'

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not read the test server address.'))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: Server) {
  server.closeAllConnections()
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

test('Vercel API function serves authentication routes directly', async () => {
  const server = createServer((request, response) => {
    void handler(request, response)
  })

  try {
    const port = await listen(server)
    const origin = `http://127.0.0.1:${port}`
    const sessionResponse = await fetch(`${origin}/api/auth/session`)
    assert.equal(sessionResponse.status, 401)
    assert.deepEqual(await sessionResponse.json(), { error: 'Sign in to continue.' })

    const signupResponse = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'email',
        identifier: `api-test-${Date.now()}@example.com`,
        password: 'test-password-123',
        name: 'API Test',
      }),
    })
    assert.equal(signupResponse.status, 201)
    assert.equal(signupResponse.headers.get('set-cookie')?.includes('sherabet_session='), true)
  } finally {
    await close(server)
  }
})
