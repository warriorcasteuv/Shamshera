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

test('API proxy forwards requests and cookies and enforces method and body limits', async () => {
  const forwarded: { method?: string; url?: string; cookie?: string; body?: string } = {}
  const upstream = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      forwarded.method = request.method
      forwarded.url = request.url
      forwarded.cookie = request.headers.cookie
      forwarded.body = Buffer.concat(chunks).toString()
      response.statusCode = 201
      response.setHeader('Set-Cookie', 'sherabet_session=test; HttpOnly; SameSite=Strict; Secure')
      response.end(JSON.stringify({ ok: true }))
    })()
  })
  const upstreamPort = await listen(upstream)
  const originalApiOrigin = process.env.API_ORIGIN
  process.env.API_ORIGIN = `http://127.0.0.1:${upstreamPort}`
  const proxy = createServer((request, response) => {
    void handler(request, response)
  })

  try {
    const proxyPort = await listen(proxy)
    const proxyOrigin = `http://127.0.0.1:${proxyPort}`
    const getResponse = await fetch(`${proxyOrigin}/api/auth/session?source=test`, {
      headers: { Cookie: 'sherabet_session=client-token' },
    })
    assert.equal(getResponse.status, 201)
    assert.equal(getResponse.headers.get('set-cookie'), 'sherabet_session=test; HttpOnly; SameSite=Strict; Secure')
    assert.deepEqual(await getResponse.json(), { ok: true })
    assert.equal(forwarded.method, 'GET')
    assert.equal(forwarded.url, '/api/auth/session?source=test')
    assert.equal(forwarded.cookie, 'sherabet_session=client-token')

    const postResponse = await fetch(`${proxyOrigin}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Proxy Test' }),
    })
    assert.equal(postResponse.status, 201)
    assert.equal(forwarded.method, 'POST')
    assert.equal(forwarded.body, JSON.stringify({ name: 'Proxy Test' }))

    const unsupportedResponse = await fetch(`${proxyOrigin}/api/session`, { method: 'PUT' })
    assert.equal(unsupportedResponse.status, 405)

    const oversizedResponse = await fetch(`${proxyOrigin}/api/session`, {
      method: 'POST',
      body: 'x'.repeat(32 * 1024 + 1),
    })
    assert.equal(oversizedResponse.status, 413)
  } finally {
    if (originalApiOrigin === undefined) delete process.env.API_ORIGIN
    else process.env.API_ORIGIN = originalApiOrigin
    await Promise.all([close(proxy), close(upstream)])
  }
})
