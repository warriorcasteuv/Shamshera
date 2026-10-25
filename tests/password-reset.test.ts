import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function post(origin: string, path: string, body: Record<string, string>) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('customer and admin password resets email codes and revoke existing sessions', async () => {
  let emailPayload: { from: string; to: string[]; subject: string; text: string } | undefined
  const resend = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer re_test_key')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    emailPayload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof emailPayload
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id: 'test-email-id' }))
  })

  const resendPort = await listen(resend)
  const probe = createServer()
  const apiPort = await listen(probe)
  await close(probe)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'lasersport-password-reset-'))
  const output: string[] = []
  let api: ChildProcess | undefined

  try {
    api = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: String(apiPort),
        DB_PATH: join(temporaryDirectory, 'lasersport.sqlite'),
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM: 'LaserSport <passwords@lasersport.online>',
        RESEND_API_URL: `http://127.0.0.1:${resendPort}/emails`,
        ADMIN_EMAIL: 'support@lasersport.online',
        ADMIN_USERNAME: 'test-admin',
        ADMIN_PASSWORD: 'Initial-admin-password-123',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    api.stdout?.setEncoding('utf8').on('data', (chunk: string) => output.push(chunk))
    api.stderr?.setEncoding('utf8').on('data', (chunk: string) => output.push(chunk))
    const origin = `http://127.0.0.1:${apiPort}`
    const deadline = Date.now() + 10_000
    let ready = false
    while (Date.now() < deadline) {
      if (api.exitCode !== null) throw new Error(`Test API exited early: ${output.join('')}`)
      try {
        const health = await fetch(`${origin}/api/health`)
        if (health.ok) {
          ready = true
          break
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    assert.equal(ready, true, `Test API did not start: ${output.join('')}`)

    const signup = await post(`${origin}`, '/api/auth/signup', {
      method: 'email',
      identifier: 'reset@example.com',
      password: 'Old-password-123',
      name: 'Reset Test',
    })
    assert.equal(signup.status, 201)
    const sessionCookie = signup.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(sessionCookie)

    const requestReset = await post(`${origin}`, '/api/auth/password-reset/request', { email: 'reset@example.com' })
    assert.equal(requestReset.status, 200)
    assert.deepEqual(await requestReset.json(), {
      message: 'If an account uses that email, a password reset code has been sent.',
    })
    const unknownEmail = await post(`${origin}`, '/api/auth/password-reset/request', { email: 'missing@example.com' })
    assert.equal(unknownEmail.status, 200)
    assert.deepEqual(await unknownEmail.json(), {
      message: 'If an account uses that email, a password reset code has been sent.',
    })
    assert.equal(emailPayload?.from, 'LaserSport <passwords@lasersport.online>')
    assert.deepEqual(emailPayload?.to, ['reset@example.com'])
    assert.equal(emailPayload?.subject, 'Your LaserSport password reset code')
    const codeMatch = emailPayload?.text.match(/reset code is (\d{6})/)
    assert.ok(codeMatch, 'Resend message should contain the reset code')

    const completeReset = await post(`${origin}`, '/api/auth/password-reset/complete', {
      email: 'reset@example.com',
      code: codeMatch[1],
      password: 'New-password-456',
    })
    assert.equal(completeReset.status, 200, await completeReset.text())

    const oldSession = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: sessionCookie } })
    assert.equal(oldSession.status, 401)
    const oldLogin = await post(`${origin}`, '/api/auth/login', {
      method: 'email',
      identifier: 'reset@example.com',
      password: 'Old-password-123',
    })
    assert.equal(oldLogin.status, 401)
    const newLogin = await post(`${origin}`, '/api/auth/login', {
      method: 'email',
      identifier: 'reset@example.com',
      password: 'New-password-456',
    })
    assert.equal(newLogin.status, 200)

    const reusedToken = await post(`${origin}`, '/api/auth/password-reset/complete', {
      email: 'reset@example.com',
      code: codeMatch[1],
      password: 'Another-password-789',
    })
    assert.equal(reusedToken.status, 400)

    const adminLogin = await post(`${origin}`, '/api/admin/login', {
      username: 'test-admin',
      password: 'Initial-admin-password-123',
    })
    assert.equal(adminLogin.status, 200)
    const adminSessionCookie = adminLogin.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(adminSessionCookie)

    const requestAdminReset = await post(`${origin}`, '/api/admin/password-reset/request', {})
    assert.equal(requestAdminReset.status, 200)
    assert.deepEqual(await requestAdminReset.json(), {
      message: 'If the admin account is configured, a reset code has been sent to its recovery email.',
    })
    assert.deepEqual(emailPayload?.to, ['support@lasersport.online'])
    assert.equal(emailPayload?.subject, 'LaserSport main admin password reset code')
    const adminCodeMatch = emailPayload?.text.match(/reset code is (\d{6})/)
    assert.ok(adminCodeMatch, 'Admin reset message should contain the reset code')

    const completeAdminReset = await post(`${origin}`, '/api/admin/password-reset/complete', {
      code: adminCodeMatch[1],
      password: 'Replacement-admin-password-456',
    })
    assert.equal(completeAdminReset.status, 200, await completeAdminReset.text())
    const revokedAdminSession = await fetch(`${origin}/api/auth/session`, {
      headers: { Cookie: adminSessionCookie },
    })
    assert.equal(revokedAdminSession.status, 401)
    const oldAdminLogin = await post(`${origin}`, '/api/admin/login', {
      username: 'test-admin',
      password: 'Initial-admin-password-123',
    })
    assert.equal(oldAdminLogin.status, 401)
    const newAdminLogin = await post(`${origin}`, '/api/admin/login', {
      username: 'test-admin',
      password: 'Replacement-admin-password-456',
    })
    assert.equal(newAdminLogin.status, 200)
    const reusedAdminCode = await post(`${origin}`, '/api/admin/password-reset/complete', {
      code: adminCodeMatch[1],
      password: 'Another-admin-password-789',
    })
    assert.equal(reusedAdminCode.status, 400)
  } finally {
    if (api && api.exitCode === null) {
      api.kill('SIGTERM')
      await new Promise<void>((resolve) => api?.once('exit', () => resolve()))
    }
    await close(resend)
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
