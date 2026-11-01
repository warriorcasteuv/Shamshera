import express, { type Request, type Response } from 'express'
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import nodemailer from 'nodemailer'
import { EVENTS } from './catalog.ts'
import { normalizeCricketMatch, type CricketFeed } from './cricket.ts'
import { liability, potentialWin, round2 } from './money.ts'
import type { Bet, LedgerEntry, Side } from './types.ts'

type PlayerRow = { id: string; name: string; balance: number; bonus_day: string | null }
type RoleRow = {
  player_id: string
  role: 'main_admin' | 'ceo' | 'manager' | 'employee'
  status: 'active' | 'disabled'
  employee_id: string | null
  activation_salt: string | null
  activation_hash: string | null
  permissions: string
}
type BetRow = {
  id: string; player_id: string; placed_at: string; event_id: string; event_name: string
  market_id: string; market_name: string; runner_id: string; runner_name: string
  side: Side; odds: number; stake: number; liability: number; status: Bet['status']; pnl: number
}
type LudoPlayer = { playerId: string; name: string; tokens: number[] }
type LudoGameState = {
  players: LudoPlayer[]
  currentPlayerIndex: number
  dice: number | null
  legalTokens: number[]
  winnerId: string | null
  payout: number
}
type LudoRoomRow = {
  id: string; host_player_id: string; max_players: number; stake: number
  status: 'waiting' | 'playing' | 'finished'; game_state: string | null
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const dataDirectory = process.env.DATA_DIR ?? (process.env.VERCEL ? '/tmp/lasersport-data' : join(process.cwd(), 'data'))
mkdirSync(dataDirectory, { recursive: true })
const database = new DatabaseSync(process.env.DB_PATH ?? join(dataDirectory, 'sherabet.sqlite'))
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL,
    bonus_day TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customer_auth (
    player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    email TEXT UNIQUE, mobile TEXT UNIQUE, password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS account_roles (
    player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('main_admin', 'ceo', 'manager', 'employee')),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    employee_id TEXT UNIQUE,
    activation_salt TEXT,
    activation_hash TEXT,
    permissions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT,
    password_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), placed_at TEXT NOT NULL,
    event_id TEXT NOT NULL, event_name TEXT NOT NULL, market_id TEXT NOT NULL, market_name TEXT NOT NULL,
    runner_id TEXT NOT NULL, runner_name TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('back', 'lay')),
    odds REAL NOT NULL, stake REAL NOT NULL, liability REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost')), pnl REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bets_market_status_idx ON bets(market_id, status);
  CREATE INDEX IF NOT EXISTS bets_player_placed_idx ON bets(player_id, placed_at);
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
    at TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS market_settlements (
    market_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, winner_id TEXT NOT NULL, settled_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ludo_rooms (
    id TEXT PRIMARY KEY, host_player_id TEXT NOT NULL REFERENCES players(id),
    max_players INTEGER NOT NULL CHECK (max_players IN (2, 4)), stake REAL NOT NULL CHECK (stake > 0),
    status TEXT NOT NULL CHECK (status IN ('waiting', 'playing', 'finished')),
    game_state TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ludo_room_players (
    room_id TEXT NOT NULL REFERENCES ludo_rooms(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id), seat INTEGER NOT NULL,
    PRIMARY KEY (room_id, player_id), UNIQUE (room_id, seat)
  );
`)
const systemAdminColumns = database.prepare('PRAGMA table_info(system_admin)').all() as { name: string }[]
if (!systemAdminColumns.some((column) => column.name === 'password_salt')) {
  database.exec('ALTER TABLE system_admin ADD COLUMN password_salt TEXT')
}
if (!systemAdminColumns.some((column) => column.name === 'password_hash')) {
  database.exec('ALTER TABLE system_admin ADD COLUMN password_hash TEXT')
}
const resetTokenColumns = database.prepare('PRAGMA table_info(password_reset_tokens)').all() as { name: string }[]
if (!resetTokenColumns.some((column) => column.name === 'attempts')) {
  database.exec('ALTER TABLE password_reset_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0')
}

const app = express()
app.use(express.json({ limit: '32kb' }))

let cricketCache: { expiresAt: number; feed: CricketFeed } | null = null
const cricketCacheSeconds = (() => {
  const configured = Number(process.env.CRICKET_CACHE_SECONDS ?? 60)
  return Number.isFinite(configured) ? Math.max(30, Math.min(configured, 900)) : 60
})()

async function currentCricketFeed(): Promise<CricketFeed> {
  const apiKey = process.env.CRICKETDATA_API_KEY
  if (!apiKey) throw new HttpError(503, 'Live cricket data is not configured. Add CRICKETDATA_API_KEY on the API server.')
  if (cricketCache && cricketCache.expiresAt > Date.now()) return cricketCache.feed

  const url = new URL('https://api.cricapi.com/v1/currentMatches')
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('offset', '0')
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new HttpError(502, 'The cricket data provider could not return matches.')

  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(502, 'The cricket data provider returned an invalid response.')
  }
  const body = payload as { status?: unknown; data?: unknown }
  if (body.status !== 'success' || !Array.isArray(body.data)) {
    throw new HttpError(502, 'The cricket data provider rejected the request or returned no match list.')
  }

  const feed = {
    updatedAt: new Date().toISOString(),
    matches: body.data.flatMap((match) => {
      const normalized = normalizeCricketMatch(match)
      return normalized ? [normalized] : []
    }).filter((match) => !match.matchEnded),
  }
  cricketCache = { feed, expiresAt: Date.now() + cricketCacheSeconds * 1000 }
  return feed
}

function requirePlayer(id: unknown): PlayerRow {
  if (typeof id !== 'string' || !id) throw new HttpError(400, 'Player profile is required.')
  const player = database.prepare('SELECT id, name, balance, bonus_day FROM players WHERE id = ?').get(id) as PlayerRow | undefined
  if (!player) throw new HttpError(404, 'Player profile not found.')
  return player
}

function roleFor(playerId: string): RoleRow | undefined {
  return database.prepare('SELECT * FROM account_roles WHERE player_id = ?').get(playerId) as RoleRow | undefined
}

function publicRole(role: RoleRow | undefined) {
  if (!role || role.status !== 'active') return 'customer'
  return role.role
}

function snapshot(playerId: string) {
  const player = requirePlayer(playerId)
  const role = roleFor(playerId)
  const betRows = database.prepare('SELECT * FROM bets WHERE player_id = ? ORDER BY placed_at DESC').all(playerId) as BetRow[]
  const ledger = database.prepare('SELECT id, at, label, amount FROM ledger WHERE player_id = ? ORDER BY at DESC, rowid DESC').all(playerId) as LedgerEntry[]
  const settledRows = database.prepare('SELECT market_id, winner_id FROM market_settlements').all() as { market_id: string; winner_id: string }[]
  const settled = Object.fromEntries(settledRows.map((row) => [row.market_id, row.winner_id]))
  const bets: Bet[] = betRows.map((bet) => ({
    id: bet.id, placedAt: bet.placed_at, eventId: bet.event_id, eventName: bet.event_name,
    marketId: bet.market_id, marketName: bet.market_name, runnerId: bet.runner_id,
    runnerName: bet.runner_name, side: bet.side, odds: bet.odds, stake: bet.stake,
    liability: bet.liability, status: bet.status, pnl: bet.pnl,
  }))
  return {
    playerId: player.id, user: player.name,
    balance: publicRole(role) === 'main_admin' ? Number.MAX_SAFE_INTEGER : player.balance,
    role: publicRole(role),
    isUnlimited: publicRole(role) === 'main_admin',
    employeeId: role?.employee_id ?? null,
    staffStatus: role?.status ?? null,
    permissions: role ? JSON.parse(role.permissions) as Record<string, boolean> : {},
    lastBonusDay: player.bonus_day, bets,
    ledger: ledger.map((entry) => ({ ...entry, accountName: player.name })),
    settled,
  }
}

function transaction<T>(run: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function endpoint(handler: (request: Request, response: Response) => void | Promise<void>) {
  return (request: Request, response: Response) => {
    void Promise.resolve().then(() => handler(request, response)).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected server error.'
      if (status === 500) console.error(error)
      if (!response.headersSent) response.status(status).json({ error: message })
      else response.end()
    })
  }
}

function requestObject(request: Request): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'A JSON object is required.')
  }
  return request.body as Record<string, unknown>
}

function normalizeContact(method: unknown, value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a valid email or mobile number.')
  if (method === 'email') {
    const email = value.trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'Enter a valid email address.')
    }
    return { email, mobile: null }
  }
  if (method === 'mobile') {
    const mobile = value.trim().replace(/[\s()-]/g, '')
    if (!/^\+?[1-9]\d{7,14}$/.test(mobile)) throw new HttpError(400, 'Enter a valid mobile number with country code.')
    return { email: null, mobile }
  }
  throw new HttpError(400, 'Choose email or mobile login.')
}

function issueSession(playerId: string, response: Response) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  database.prepare('INSERT INTO auth_sessions (token_hash, player_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, playerId, expiresAt)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `sherabet_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`)
}

function resetMailer() {
  const resendApiKey = process.env.RESEND_API_KEY
  const resendFrom = process.env.RESEND_FROM
  if (resendApiKey || resendFrom) {
    if (!resendApiKey || !resendFrom) {
      throw new HttpError(503, 'Resend email is only partially configured. Set both RESEND_API_KEY and RESEND_FROM on the API server.')
    }
    const apiUrl = process.env.NODE_ENV === 'test' && process.env.RESEND_API_URL
      ? process.env.RESEND_API_URL
      : 'https://api.resend.com/emails'
    return {
      send: async (to: string, code: string, subject = 'Your LaserSport password reset code', text = `Your LaserSport password reset code is ${code}.\n\nEnter this code within 10 minutes to choose a new password. If you did not request this, you can ignore this email.`) => {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [to],
            subject,
            text,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error(`Resend API request failed with status ${response.status}.`)
        const result: unknown = await response.json()
        if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
          throw new Error('Resend API returned an invalid response.')
        }
      },
    }
  }

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from
    || Boolean(user) !== Boolean(password)) {
    throw new HttpError(503, 'Password reset email is not configured. Set RESEND_API_KEY and RESEND_FROM, or configure SMTP_HOST, SMTP_PORT, and SMTP_FROM on the API server.')
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: process.env.NODE_ENV === 'production' && port !== 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  })
  return {
    send: async (to: string, code: string, subject = 'Your LaserSport password reset code', text = `Your LaserSport password reset code is ${code}.\n\nEnter this code within 10 minutes to choose a new password. If you did not request this, you can ignore this email.`) => {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
      })
    },
  }
}

function sessionPlayer(request: Request) {
  const token = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('sherabet_session='))?.slice('sherabet_session='.length)
  if (!token) throw new HttpError(401, 'Sign in to continue.')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = database.prepare('SELECT player_id, expires_at FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as { player_id: string; expires_at: string } | undefined
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash)
    throw new HttpError(401, 'Your session expired. Sign in again.')
  }
  const player = requirePlayer(session.player_id)
  if (roleFor(player.id)?.status === 'disabled') throw new HttpError(403, 'This staff account is disabled.')
  return player
}

function requireMainAdmin(request: Request) {
  const player = sessionPlayer(request)
  if (publicRole(roleFor(player.id)) !== 'main_admin') throw new HttpError(403, 'Only the main admin can manage team accounts.')
  return player
}

function requireTransferRole(playerId: string) {
  const role = roleFor(playerId)
  if (publicRole(role) === 'customer') throw new HttpError(403, 'Your account cannot transfer coins.')
  if (role?.status !== 'active') throw new HttpError(403, 'This staff account is disabled.')
  return role
}

function transferRank(role: string) {
  if (role === 'main_admin') return 0
  if (role === 'ceo') return 1
  if (role === 'manager') return 2
  if (role === 'employee') return 3
  return 4
}

function adminCredentials() {
  const username = process.env.ADMIN_USERNAME ?? (process.env.NODE_ENV === 'production' ? '' : 'admin')
  const password = process.env.ADMIN_PASSWORD ?? (process.env.NODE_ENV === 'production' ? '' : 'admin123')
  if (!username || !password || (process.env.NODE_ENV === 'production' && password.length < 12)) {
    throw new HttpError(503, 'Configure ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters on the server.')
  }
  return { username, password }
}

function findMarket(eventId: unknown, marketId: unknown) {
  if (typeof eventId !== 'string' || typeof marketId !== 'string') {
    throw new HttpError(400, 'Event and market are required.')
  }
  const event = EVENTS.find((candidate) => candidate.id === eventId)
  const market = event?.markets.find((candidate) => candidate.id === marketId)
  if (!event || !market) throw new HttpError(404, 'Market not found.')
  return { event, market }
}

function ludoRoomSnapshot(roomId: string, viewerPlayerId: string) {
  const room = database.prepare('SELECT * FROM ludo_rooms WHERE id = ?').get(roomId) as LudoRoomRow | undefined
  if (!room) throw new HttpError(404, 'Ludo room not found.')
  const players = database.prepare(`
    SELECT p.id AS player_id, p.name, rp.seat
    FROM ludo_room_players rp JOIN players p ON p.id = rp.player_id
    WHERE rp.room_id = ? ORDER BY rp.seat
  `).all(roomId) as { player_id: string; name: string; seat: number }[]
  if (!players.some((player) => player.player_id === viewerPlayerId) && room.status !== 'waiting') {
    throw new HttpError(403, 'Join this Ludo room to view its match.')
  }
  return {
    id: room.id,
    hostPlayerId: room.host_player_id,
    maxPlayers: room.max_players,
    stake: room.stake,
    status: room.status,
    gameState: room.game_state ? JSON.parse(room.game_state) as LudoGameState : null,
    players: players.map((player) => ({ playerId: player.player_id, name: player.name })),
    viewerPlayerId,
  }
}

function legalLudoTokens(player: LudoPlayer, dice: number) {
  return player.tokens.flatMap((position, index) =>
    (position === -1 ? dice === 6 : position + dice <= 56) ? [index] : [],
  )
}

function ludoGameState(roomId: string) {
  const row = database.prepare('SELECT game_state FROM ludo_rooms WHERE id = ?').get(roomId) as { game_state: string | null } | undefined
  if (!row?.game_state) throw new HttpError(409, 'The Ludo match has not started.')
  return JSON.parse(row.game_state) as LudoGameState
}

app.get('/api/health', (_request, response) => response.json({ ok: true }))

app.get('/api/cricket/matches', async (_request, response) => {
  try {
    response.json(await currentCricketFeed())
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502
    if (status === 502 && !(error instanceof HttpError)) console.error('Could not fetch the cricket match feed.', error)
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Could not fetch the cricket match feed.',
    })
  }
})

app.post('/api/ludo/rooms', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const body = requestObject(request)
  const maxPlayers = Number(body.maxPlayers)
  const stake = Number(body.stake)
  if (maxPlayers !== 2 && maxPlayers !== 4) throw new HttpError(400, 'Choose a 2-player or 4-player lobby.')
  if (!Number.isFinite(stake) || stake < 1 || stake > 100_000) throw new HttpError(400, 'Enter a valid coin entry fee.')
  const id = randomUUID()
  transaction(() => {
    database.prepare(`
      INSERT INTO ludo_rooms (id, host_player_id, max_players, stake, status, created_at)
      VALUES (?, ?, ?, ?, 'waiting', ?)
    `).run(id, player.id, maxPlayers, round2(stake), new Date().toISOString())
    database.prepare('INSERT INTO ludo_room_players (room_id, player_id, seat) VALUES (?, ?, 0)')
      .run(id, player.id)
  })
  response.status(201).json({ room: ludoRoomSnapshot(id, player.id) })
}))

app.get('/api/ludo/rooms/:roomId', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const roomId = request.params.roomId
  if (typeof roomId !== 'string') throw new HttpError(400, 'Ludo room is required.')
  response.json({ room: ludoRoomSnapshot(roomId, player.id) })
}))

app.post('/api/ludo/rooms/:roomId/join', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const roomId = request.params.roomId
  if (typeof roomId !== 'string') throw new HttpError(400, 'Ludo room is required.')
  transaction(() => {
    const room = database.prepare('SELECT * FROM ludo_rooms WHERE id = ?').get(roomId) as LudoRoomRow | undefined
    if (!room) throw new HttpError(404, 'Ludo room not found.')
    if (room.status !== 'waiting') throw new HttpError(409, 'This Ludo match has already started.')
    const existing = database.prepare('SELECT 1 FROM ludo_room_players WHERE room_id = ? AND player_id = ?')
      .get(roomId, player.id)
    if (existing) return
    const count = database.prepare('SELECT COUNT(*) AS count FROM ludo_room_players WHERE room_id = ?')
      .get(roomId) as { count: number }
    if (count.count >= room.max_players) throw new HttpError(409, 'This lobby is full.')
    database.prepare('INSERT INTO ludo_room_players (room_id, player_id, seat) VALUES (?, ?, ?)')
      .run(roomId, player.id, count.count)
  })
  response.json({ room: ludoRoomSnapshot(roomId, player.id) })
}))

app.post('/api/ludo/rooms/:roomId/start', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const roomId = request.params.roomId
  if (typeof roomId !== 'string') throw new HttpError(400, 'Ludo room is required.')
  transaction(() => {
    const room = database.prepare('SELECT * FROM ludo_rooms WHERE id = ?').get(roomId) as LudoRoomRow | undefined
    if (!room) throw new HttpError(404, 'Ludo room not found.')
    if (room.host_player_id !== player.id) throw new HttpError(403, 'Only the room host can start this match.')
    if (room.status !== 'waiting') throw new HttpError(409, 'This match has already started.')
    const participants = database.prepare(`
      SELECT p.id AS player_id, p.name FROM ludo_room_players rp
      JOIN players p ON p.id = rp.player_id WHERE rp.room_id = ? ORDER BY rp.seat
    `).all(roomId) as { player_id: string; name: string }[]
    if (participants.length !== room.max_players) {
      throw new HttpError(409, `All ${room.max_players} seats must be filled before starting.`)
    }
    const gameState: LudoGameState = {
      players: participants.map((participant) => ({
        playerId: participant.player_id, name: participant.name, tokens: [-1, -1, -1, -1],
      })),
      currentPlayerIndex: 0,
      dice: null,
      legalTokens: [],
      winnerId: null,
      payout: 0,
    }
    database.prepare("UPDATE ludo_rooms SET status = 'playing', game_state = ? WHERE id = ?")
      .run(JSON.stringify(gameState), roomId)
  })
  response.json({ room: ludoRoomSnapshot(roomId, player.id) })
}))

app.post('/api/ludo/rooms/:roomId/roll', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const roomId = request.params.roomId
  if (typeof roomId !== 'string') throw new HttpError(400, 'Ludo room is required.')
  const roll = transaction(() => {
    const room = database.prepare('SELECT status FROM ludo_rooms WHERE id = ?').get(roomId) as { status: string } | undefined
    if (!room) throw new HttpError(404, 'Ludo room not found.')
    if (room.status !== 'playing') throw new HttpError(409, 'This Ludo match is not in progress.')
    const state = ludoGameState(roomId)
    const currentPlayer = state.players[state.currentPlayerIndex]
    if (currentPlayer.playerId !== player.id) throw new HttpError(409, 'It is another player’s turn.')
    if (state.dice !== null) throw new HttpError(409, 'Move a token before rolling again.')
    const dice = randomInt(1, 7)
    const legalTokens = legalLudoTokens(currentPlayer, dice)
    if (legalTokens.length) {
      state.dice = dice
      state.legalTokens = legalTokens
    } else {
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length
    }
    database.prepare('UPDATE ludo_rooms SET game_state = ? WHERE id = ?')
      .run(JSON.stringify(state), roomId)
    return { dice, legalTokens }
  })
  response.json(roll)
}))

app.post('/api/ludo/rooms/:roomId/move', endpoint((request, response) => {
  const player = sessionPlayer(request)
  const roomId = request.params.roomId
  if (typeof roomId !== 'string') throw new HttpError(400, 'Ludo room is required.')
  const body = requestObject(request)
  const tokenIndex = Number(body.tokenIndex)
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
    throw new HttpError(400, 'Choose a valid token.')
  }
  transaction(() => {
    const room = database.prepare('SELECT * FROM ludo_rooms WHERE id = ?').get(roomId) as LudoRoomRow | undefined
    if (!room) throw new HttpError(404, 'Ludo room not found.')
    if (room.status !== 'playing') throw new HttpError(409, 'This Ludo match is not in progress.')
    const state = ludoGameState(roomId)
    const currentPlayer = state.players[state.currentPlayerIndex]
    if (currentPlayer.playerId !== player.id) throw new HttpError(409, 'It is another player’s turn.')
    if (state.dice === null || !state.legalTokens.includes(tokenIndex)) {
      throw new HttpError(409, 'That token cannot move with this roll.')
    }
    const lastRoll = state.dice
    const tokenPosition = currentPlayer.tokens[tokenIndex]
    currentPlayer.tokens[tokenIndex] = tokenPosition === -1 ? 0 : tokenPosition + state.dice
    const winner = currentPlayer.tokens.every((position) => position === 56)
    state.dice = null
    state.legalTokens = []
    if (winner) {
      const participantCount = database.prepare('SELECT COUNT(*) AS count FROM ludo_room_players WHERE room_id = ?')
        .get(roomId) as { count: number }
      state.winnerId = currentPlayer.playerId
      state.payout = round2(room.stake * participantCount.count * 0.9)
      database.prepare("UPDATE ludo_rooms SET status = 'finished', game_state = ? WHERE id = ?")
        .run(JSON.stringify(state), roomId)
    } else {
      if (lastRoll !== 6) state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length
      database.prepare('UPDATE ludo_rooms SET game_state = ? WHERE id = ?')
        .run(JSON.stringify(state), roomId)
    }
  })
  response.json({ room: ludoRoomSnapshot(roomId, player.id) })
}))

app.post('/api/auth/signup', endpoint((request, response) => {
  const body = requestObject(request)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 48) : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (name.length < 2) throw new HttpError(400, 'Enter a name with at least 2 characters.')
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Password must be 8 to 128 characters.')
  const { email, mobile } = normalizeContact(body.method, body.identifier)
  const duplicate = email
    ? database.prepare('SELECT 1 FROM customer_auth WHERE email = ?').get(email)
    : database.prepare('SELECT 1 FROM customer_auth WHERE mobile = ?').get(mobile)
  if (duplicate) throw new HttpError(409, 'An account already uses this email or mobile number.')
  const playerId = randomUUID()
  const at = new Date().toISOString()
  const salt = randomBytes(16).toString('hex')
  const passwordHash = scryptSync(password, salt, 64).toString('hex')
  transaction(() => {
    database.prepare('INSERT INTO players (id, name, balance, created_at) VALUES (?, ?, 0, ?)')
      .run(playerId, name, at)
    database.prepare('INSERT INTO customer_auth (player_id, email, mobile, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(playerId, email, mobile, salt, passwordHash)
  })
  issueSession(playerId, response)
  response.status(201).json(snapshot(playerId))
}))

app.post('/api/auth/login', endpoint((request, response) => {
  const body = requestObject(request)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || password.length > 128) throw new HttpError(400, 'Enter your password.')
  const { email, mobile } = normalizeContact(body.method, body.identifier)
  const account = email
    ? database.prepare(`SELECT p.id, a.password_salt, a.password_hash FROM customer_auth a
        JOIN players p ON p.id = a.player_id WHERE a.email = ?`).get(email) as { id: string; password_salt: string; password_hash: string } | undefined
    : database.prepare(`SELECT p.id, a.password_salt, a.password_hash FROM customer_auth a
        JOIN players p ON p.id = a.player_id WHERE a.mobile = ?`).get(mobile) as { id: string; password_salt: string; password_hash: string } | undefined
  if (!account) throw new HttpError(401, 'Email/mobile or password is incorrect.')
  const attempt = scryptSync(password, account.password_salt, 64)
  if (!timingSafeEqual(attempt, Buffer.from(account.password_hash, 'hex'))) {
    throw new HttpError(401, 'Email/mobile or password is incorrect.')
  }
  issueSession(account.id, response)
  response.json(snapshot(account.id))
}))

const passwordResetAttempts = new Map<string, number[]>()

app.post('/api/admin/password-reset/request', endpoint(async (_request, response) => {
  const configuredAddress = process.env.ADMIN_EMAIL
  if (!configuredAddress) {
    throw new HttpError(503, 'Configure ADMIN_EMAIL on the API server before requesting an admin password reset.')
  }
  const { email } = normalizeContact('email', configuredAddress)
  if (!email) throw new HttpError(503, 'Configure a valid ADMIN_EMAIL on the API server.')
  const mailer = resetMailer()
  const now = Date.now()
  for (const [address, attempts] of passwordResetAttempts) {
    if (!attempts.some((at) => now - at < 15 * 60 * 1000)) passwordResetAttempts.delete(address)
  }
  const key = `admin:${email}`
  if (passwordResetAttempts.size >= 10_000 && !passwordResetAttempts.has(key)) {
    throw new HttpError(503, 'Password reset is temporarily unavailable. Please try again later.')
  }
  const recentAttempts = (passwordResetAttempts.get(key) ?? []).filter((at) => now - at < 15 * 60 * 1000)
  if (recentAttempts.length >= 3) throw new HttpError(429, 'Too many reset requests. Please try again later.')
  recentAttempts.push(now)
  passwordResetAttempts.set(key, recentAttempts)

  const admin = database.prepare('SELECT player_id FROM system_admin WHERE id = 1')
    .get() as { player_id: string } | undefined
  if (admin) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const tokenHash = createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString()
    database.prepare(`
      INSERT INTO admin_password_reset_tokens (id, token_hash, expires_at, attempts)
      VALUES (1, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash,
        expires_at = excluded.expires_at, attempts = 0
    `).run(tokenHash, expiresAt)
    try {
      await mailer.send(
        email,
        code,
        'LaserSport main admin password reset code',
        `Your LaserSport main admin password reset code is ${code}.\n\nEnter this code within 10 minutes to set a new admin password. If you did not request this, you can ignore this email.`,
      )
    } catch (error) {
      database.prepare('DELETE FROM admin_password_reset_tokens WHERE id = 1').run()
      console.error('Could not send the main admin password reset email.', error)
      throw new HttpError(502, 'Could not send the reset email. Please try again later.')
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - now))))
  response.json({ message: 'If the admin account is configured, a reset code has been sent to its recovery email.' })
}))

app.post('/api/admin/password-reset/complete', endpoint((request, response) => {
  const body = requestObject(request)
  const code = typeof body.code === 'string' ? body.code : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit reset code from your email.')
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'Admin password must be 12 to 128 characters.')
  }
  const tokenHash = createHash('sha256').update(code).digest('hex')
  const resetSucceeded = transaction(() => {
    const reset = database.prepare('SELECT token_hash, expires_at, attempts FROM admin_password_reset_tokens WHERE id = 1')
      .get() as { token_hash: string; expires_at: string; attempts: number } | undefined
    if (!reset || Date.parse(reset.expires_at) <= Date.now() || reset.attempts >= 5) return false
    if (reset.token_hash !== tokenHash) {
      database.prepare('UPDATE admin_password_reset_tokens SET attempts = attempts + 1 WHERE id = 1').run()
      return false
    }
    const admin = database.prepare('SELECT player_id FROM system_admin WHERE id = 1').get() as { player_id: string } | undefined
    if (!admin) return false
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    database.prepare('UPDATE system_admin SET password_salt = ?, password_hash = ? WHERE id = 1')
      .run(salt, passwordHash)
    database.prepare('DELETE FROM admin_password_reset_tokens WHERE id = 1').run()
    database.prepare('DELETE FROM auth_sessions WHERE player_id = ?').run(admin.player_id)
    return true
  })
  if (!resetSucceeded) throw new HttpError(400, 'The reset code is invalid or expired. Request a new one.')
  response.json({ message: 'Admin password updated. Sign in with your new password.' })
}))

app.post('/api/auth/password-reset/request', endpoint(async (request, response) => {
  const body = requestObject(request)
  const { email } = normalizeContact('email', body.email)
  if (!email) throw new HttpError(400, 'Enter the email address on your account.')
  const mailer = resetMailer()
  const now = Date.now()
  for (const [address, attempts] of passwordResetAttempts) {
    if (!attempts.some((at) => now - at < 15 * 60 * 1000)) passwordResetAttempts.delete(address)
  }
  if (passwordResetAttempts.size >= 10_000 && !passwordResetAttempts.has(email)) {
    throw new HttpError(503, 'Password reset is temporarily unavailable. Please try again later.')
  }
  const recentAttempts = (passwordResetAttempts.get(email) ?? []).filter((at) => now - at < 15 * 60 * 1000)
  if (recentAttempts.length >= 3) throw new HttpError(429, 'Too many reset requests. Please try again later.')
  recentAttempts.push(now)
  passwordResetAttempts.set(email, recentAttempts)

  database.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(new Date(now).toISOString())
  const account = database.prepare('SELECT player_id FROM customer_auth WHERE email = ?')
    .get(email) as { player_id: string } | undefined
  if (account) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const tokenHash = createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString()
    database.prepare('DELETE FROM password_reset_tokens WHERE player_id = ?').run(account.player_id)
    database.prepare('INSERT INTO password_reset_tokens (token_hash, player_id, expires_at, attempts) VALUES (?, ?, ?, 0)')
      .run(tokenHash, account.player_id, expiresAt)
    try {
      await mailer.send(email, code)
    } catch (error) {
      database.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash)
      console.error('Could not send a password reset email.', error)
      throw new HttpError(502, 'Could not send the reset email. Please try again later.')
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - now))))
  response.json({ message: 'If an account uses that email, a password reset code has been sent.' })
}))

app.post('/api/auth/password-reset/complete', endpoint((request, response) => {
  const body = requestObject(request)
  const { email } = normalizeContact('email', body.email)
  const code = typeof body.code === 'string' ? body.code : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit reset code from your email.')
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Password must be 8 to 128 characters.')
  }

  const tokenHash = createHash('sha256').update(code).digest('hex')
  const resetSucceeded = transaction(() => {
    const reset = database.prepare(`
      SELECT r.player_id, r.token_hash, r.expires_at, r.attempts FROM password_reset_tokens r
      JOIN customer_auth a ON a.player_id = r.player_id WHERE a.email = ?
    `).get(email) as { player_id: string; token_hash: string; expires_at: string; attempts: number } | undefined
    if (!reset || Date.parse(reset.expires_at) <= Date.now() || reset.attempts >= 5) return false
    if (reset.token_hash !== tokenHash) {
      database.prepare('UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE player_id = ?')
        .run(reset.player_id)
      return false
    }
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    database.prepare('UPDATE customer_auth SET password_salt = ?, password_hash = ? WHERE player_id = ?')
      .run(salt, passwordHash, reset.player_id)
    database.prepare('DELETE FROM password_reset_tokens WHERE player_id = ?').run(reset.player_id)
    database.prepare('DELETE FROM auth_sessions WHERE player_id = ?').run(reset.player_id)
    return true
  })
  if (!resetSucceeded) throw new HttpError(400, 'The reset code is invalid or expired. Request a new one.')
  response.json({ message: 'Password updated. Sign in with your new password.' })
}))

app.get('/api/auth/session', endpoint((request, response) => {
  response.json(snapshot(sessionPlayer(request).id))
}))

app.post('/api/admin/login', endpoint((request, response) => {
  const body = requestObject(request)
  const configured = adminCredentials()
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const usernameMatches = createHash('sha256').update(username).digest()
  const configuredUsername = createHash('sha256').update(configured.username).digest()
  if (!timingSafeEqual(usernameMatches, configuredUsername)) {
    throw new HttpError(401, 'Admin username or password is incorrect.')
  }
  const existing = database.prepare('SELECT player_id, username, password_salt, password_hash FROM system_admin WHERE id = 1')
    .get() as { player_id: string; username: string; password_salt: string | null; password_hash: string | null } | undefined
  if (existing && existing.username !== configured.username) {
    throw new HttpError(409, 'The server admin username changed. Update the server admin account before signing in.')
  }
  const passwordMatches = existing?.password_salt && existing.password_hash
    ? timingSafeEqual(
      scryptSync(password, existing.password_salt, 64),
      Buffer.from(existing.password_hash, 'hex'),
    )
    : (() => {
      const attempted = createHash('sha256').update(password).digest()
      const expected = createHash('sha256').update(configured.password).digest()
      return timingSafeEqual(attempted, expected)
    })()
  if (!passwordMatches) throw new HttpError(401, 'Admin username or password is incorrect.')
  const playerId = existing?.player_id ?? randomUUID()
  if (!existing) {
    transaction(() => {
      const at = new Date().toISOString()
      const passwordSalt = randomBytes(16).toString('hex')
      const passwordHash = scryptSync(configured.password, passwordSalt, 64).toString('hex')
      database.prepare('INSERT INTO players (id, name, balance, created_at) VALUES (?, ?, 0, ?)')
        .run(playerId, 'Main Admin', at)
      database.prepare(`INSERT INTO account_roles
        (player_id, role, status, permissions, created_at) VALUES (?, 'main_admin', 'active', '{}', ?)`)
        .run(playerId, at)
      database.prepare('INSERT INTO system_admin (id, player_id, username, password_salt, password_hash) VALUES (1, ?, ?, ?, ?)')
        .run(playerId, configured.username, passwordSalt, passwordHash)
    })
  } else if (!existing.password_salt || !existing.password_hash) {
    const passwordSalt = randomBytes(16).toString('hex')
    database.prepare('UPDATE system_admin SET password_salt = ?, password_hash = ? WHERE id = 1')
      .run(passwordSalt, scryptSync(configured.password, passwordSalt, 64).toString('hex'))
  }
  issueSession(playerId, response)
  response.json(snapshot(playerId))
}))

app.post('/api/staff/login', endpoint((request, response) => {
  const body = requestObject(request)
  if (body.role !== 'ceo' && body.role !== 'manager' && body.role !== 'employee') {
    throw new HttpError(400, 'Choose a valid staff designation.')
  }
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim().toUpperCase() : ''
  const activationCode = typeof body.activationCode === 'string' ? body.activationCode.trim().toUpperCase() : ''
  if (!employeeId || !activationCode) throw new HttpError(400, 'Enter your employee ID and activation code.')
  const staff = database.prepare(`
    SELECT r.player_id, r.status, r.activation_salt, r.activation_hash
    FROM account_roles r WHERE r.employee_id = ? AND r.role = ?
  `).get(employeeId, body.role) as Pick<RoleRow, 'player_id' | 'status' | 'activation_salt' | 'activation_hash'> | undefined
  if (!staff || !staff.activation_salt || !staff.activation_hash) {
    throw new HttpError(401, 'Employee ID or activation code is incorrect.')
  }
  if (staff.status !== 'active') throw new HttpError(403, 'This staff account is disabled.')
  const attemptedHash = scryptSync(activationCode, staff.activation_salt, 64)
  if (!timingSafeEqual(attemptedHash, Buffer.from(staff.activation_hash, 'hex'))) {
    throw new HttpError(401, 'Employee ID or activation code is incorrect.')
  }
  issueSession(staff.player_id, response)
  response.json(snapshot(staff.player_id))
}))

app.get('/api/admin/staff', endpoint((request, response) => {
  requireMainAdmin(request)
  const rows = database.prepare(`
    SELECT p.id, p.name, p.balance, r.role, r.status, r.employee_id, r.permissions
    FROM account_roles r JOIN players p ON p.id = r.player_id
    WHERE r.role != 'main_admin' ORDER BY r.created_at
  `).all() as {
    id: string; name: string; balance: number; role: string; status: string
    employee_id: string | null; permissions: string
  }[]
  response.json({ staff: rows.map((row) => ({
    id: row.id, name: row.name, balance: row.balance, role: row.role, status: row.status,
    employeeId: row.employee_id, permissions: JSON.parse(row.permissions) as Record<string, boolean>,
  })) })
}))

app.post('/api/admin/staff', endpoint((request, response) => {
  requireMainAdmin(request)
  const body = requestObject(request)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 48) : ''
  const role = body.role
  if (name.length < 2) throw new HttpError(400, 'Enter a name with at least 2 characters.')
  if (role !== 'ceo' && role !== 'manager' && role !== 'employee') throw new HttpError(400, 'Choose a valid staff role.')
  const exists = database.prepare('SELECT 1 FROM players WHERE lower(name) = lower(?)').get(name)
  if (exists) throw new HttpError(409, 'An account already uses this name.')
  const employeeId = `SHR-${randomUUID().slice(0, 8).toUpperCase()}`
  const activationCode = randomBytes(8).toString('hex').toUpperCase()
  const salt = randomBytes(16).toString('hex')
  const activationHash = scryptSync(activationCode, salt, 64).toString('hex')
  const permissions = body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions)
    ? body.permissions as Record<string, unknown>
    : {}
  const safePermissions = {
    reviewDeposits: permissions.reviewDeposits === true,
    reviewWithdrawals: permissions.reviewWithdrawals === true,
    manageQrs: permissions.manageQrs === true,
  }
  const playerId = randomUUID()
  const at = new Date().toISOString()
  transaction(() => {
    database.prepare('INSERT INTO players (id, name, balance, created_at) VALUES (?, ?, ?, ?)')
      .run(playerId, name, role === 'ceo' ? 100_000_000 : 0, at)
    database.prepare(`INSERT INTO account_roles
      (player_id, role, status, employee_id, activation_salt, activation_hash, permissions, created_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`)
      .run(playerId, role, employeeId, salt, activationHash, JSON.stringify(safePermissions), at)
  })
  response.status(201).json({
    staffMember: { id: playerId, name, role, status: 'active', employeeId, permissions: safePermissions,
      balance: role === 'ceo' ? 100_000_000 : 0 },
    activationCode,
  })
}))

app.patch('/api/admin/staff/:playerId/status', endpoint((request, response) => {
  requireMainAdmin(request)
  const playerId = request.params.playerId
  if (typeof playerId !== 'string') throw new HttpError(400, 'Staff account is required.')
  const body = requestObject(request)
  if (body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'Choose active or disabled status.')
  const result = database.prepare("UPDATE account_roles SET status = ? WHERE player_id = ? AND role != 'main_admin'")
    .run(body.status, playerId)
  if (result.changes !== 1) throw new HttpError(404, 'Staff account not found.')
  if (body.status === 'disabled') database.prepare('DELETE FROM auth_sessions WHERE player_id = ?').run(playerId)
  response.json({ ok: true })
}))

app.patch('/api/admin/staff/:playerId/permissions', endpoint((request, response) => {
  requireMainAdmin(request)
  const playerId = request.params.playerId
  if (typeof playerId !== 'string') throw new HttpError(400, 'Staff account is required.')
  const body = requestObject(request)
  const permissions = body.permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new HttpError(400, 'Staff permissions are required.')
  }
  const values = permissions as Record<string, unknown>
  const safePermissions = {
    reviewDeposits: values.reviewDeposits === true,
    reviewWithdrawals: values.reviewWithdrawals === true,
    manageQrs: values.manageQrs === true,
  }
  const result = database.prepare("UPDATE account_roles SET permissions = ? WHERE player_id = ? AND role != 'main_admin'")
    .run(JSON.stringify(safePermissions), playerId)
  if (result.changes !== 1) throw new HttpError(404, 'Staff account not found.')
  response.json({ ok: true })
}))

app.delete('/api/admin/staff/:playerId', endpoint((request, response) => {
  requireMainAdmin(request)
  const playerId = request.params.playerId
  if (typeof playerId !== 'string') throw new HttpError(400, 'Staff account is required.')
  const result = database.prepare("UPDATE account_roles SET status = 'disabled' WHERE player_id = ? AND role != 'main_admin'")
    .run(playerId)
  if (result.changes !== 1) throw new HttpError(404, 'Staff account not found.')
  database.prepare('DELETE FROM auth_sessions WHERE player_id = ?').run(playerId)
  response.json({ ok: true })
}))

app.get('/api/coin-transfers/recipients', endpoint((request, response) => {
  const sender = sessionPlayer(request)
  const role = requireTransferRole(sender.id)
  const senderRole = publicRole(role)
  const senderRank = transferRank(senderRole)
  const rows = database.prepare(`
    SELECT p.id, p.name, p.balance, r.role, r.status
    FROM players p LEFT JOIN account_roles r ON r.player_id = p.id
    WHERE p.id != ? AND (r.player_id IS NULL OR (r.status = 'active' AND r.role != 'main_admin'))
    ORDER BY p.name COLLATE NOCASE
  `).all(sender.id) as { id: string; name: string; balance: number; role: string | null; status: string | null }[]
  const recipients = rows.filter((row) => transferRank(row.role ?? 'customer') > senderRank)
    .map((row) => ({ playerId: row.id, name: row.name, role: row.role ?? 'customer', balance: row.balance }))
  response.json({ recipients, senderRole })
}))

app.post('/api/coin-transfers', endpoint((request, response) => {
  const sender = sessionPlayer(request)
  const senderRole = requireTransferRole(sender.id)
  const body = requestObject(request)
  const recipientId = typeof body.recipientId === 'string' ? body.recipientId : ''
  const amount = Number(body.amount)
  if (!recipientId) throw new HttpError(400, 'Choose a recipient account.')
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    throw new HttpError(400, 'Enter an amount greater than 0 and no more than 1,000,000,000,000 coins.')
  }
  const roundedAmount = round2(amount)
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) throw new HttpError(400, 'Enter a valid coin amount.')
  const at = new Date().toISOString()
  const recipient = transaction(() => {
    if (recipientId === sender.id) throw new HttpError(400, 'You cannot transfer coins to your own account.')
    const target = database.prepare('SELECT * FROM players WHERE id = ?').get(recipientId) as PlayerRow | undefined
    if (!target) throw new HttpError(404, 'Recipient account not found.')
    const recipientRole = roleFor(target.id)
    if (recipientRole && recipientRole.status !== 'active') {
      throw new HttpError(403, 'Coins cannot be transferred to a disabled staff account.')
    }
    const senderRank = transferRank(publicRole(senderRole))
    const recipientRank = transferRank(publicRole(recipientRole))
    if (recipientRank <= senderRank || recipientRank === 0) {
      throw new HttpError(403, 'You can only transfer coins to accounts below your role.')
    }
    if (!Number.isSafeInteger(Math.floor(target.balance + roundedAmount))
      || target.balance + roundedAmount > Number.MAX_SAFE_INTEGER) {
      throw new HttpError(400, 'The recipient balance would exceed the supported limit.')
    }
    if (publicRole(senderRole) !== 'main_admin') {
      const debit = database.prepare('UPDATE players SET balance = balance - ? WHERE id = ? AND balance >= ?')
        .run(roundedAmount, sender.id, roundedAmount)
      if (debit.changes !== 1) throw new HttpError(400, 'Not enough coins available to transfer.')
    }
    database.prepare('UPDATE players SET balance = balance + ? WHERE id = ?').run(roundedAmount, target.id)
    database.prepare('INSERT INTO ledger (id, player_id, at, label, amount) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), sender.id, at, `Coin transfer sent to ${target.name}`, publicRole(senderRole) === 'main_admin' ? 0 : -roundedAmount)
    database.prepare('INSERT INTO ledger (id, player_id, at, label, amount) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), target.id, at, `Coin transfer received from ${sender.name}`, roundedAmount)
    return requirePlayer(target.id)
  })
  response.json({
    profile: snapshot(sender.id),
    recipient: { playerId: recipient.id, user: recipient.name, balance: recipient.balance },
  })
}))

app.post('/api/auth/logout', endpoint((request, response) => {
  const token = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('sherabet_session='))?.slice('sherabet_session='.length)
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash)
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `sherabet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`)
  response.json({ ok: true })
}))

app.post('/api/session', endpoint((request, response) => {
  const body = requestObject(request)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : ''
  if (name.length < 2) throw new HttpError(400, 'Enter a name with at least 2 characters.')
  const requestedId = typeof body.playerId === 'string' ? body.playerId : null
  let player = requestedId
    ? database.prepare('SELECT id FROM players WHERE id = ?').get(requestedId) as { id: string } | undefined
    : undefined
  if (player) {
    database.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, player.id)
  } else {
    const id = randomUUID()
    const at = new Date().toISOString()
    transaction(() => {
      database.prepare('INSERT INTO players (id, name, balance, created_at) VALUES (?, ?, ?, ?)')
          .run(id, name, 0, at)
    })
    player = { id }
  }
  response.json(snapshot(player.id))
}))

app.get('/api/state/:playerId', endpoint((request, response) => {
  const playerId = request.params.playerId
  if (typeof playerId !== 'string') throw new HttpError(400, 'Player profile is required.')
  response.json(snapshot(playerId))
}))

app.post('/api/bets', endpoint((request, response) => {
  const body = requestObject(request)
  const player = requirePlayer(body.playerId)
  if (!Array.isArray(body.selections) || body.selections.length === 0 || body.selections.length > 20) {
    throw new HttpError(400, 'Select between 1 and 20 bets.')
  }
  const prepared = body.selections.map((selection) => {
    if (!selection || typeof selection !== 'object') throw new HttpError(400, 'Invalid selection.')
    const item = selection as Record<string, unknown>
    const { event, market } = findMarket(item.eventId, item.marketId)
    const runner = market.runners.find((candidate) => candidate.id === item.runnerId)
    if (!runner) throw new HttpError(400, 'Runner not found.')
    if (item.side !== 'back' && item.side !== 'lay') throw new HttpError(400, 'Invalid bet side.')
    const odds = Number(item.odds)
    const stake = Number(item.stake)
    if (!Number.isFinite(odds) || odds < 1.01 || odds > 100) throw new HttpError(400, 'Odds are invalid.')
    if (!Number.isFinite(stake) || stake <= 0 || stake > 1_000_000) throw new HttpError(400, 'Enter a valid stake.')
    if (database.prepare('SELECT 1 FROM market_settlements WHERE market_id = ?').get(market.id)) {
      throw new HttpError(409, `${market.name} is already settled.`)
    }
    const side = item.side as Side
    return {
      id: randomUUID(), placedAt: new Date().toISOString(), eventId: event.id, eventName: event.name,
      marketId: market.id, marketName: market.name, runnerId: runner.id, runnerName: runner.name,
      side, odds, stake: round2(stake), liability: liability(side, odds, stake),
    }
  })
  const totalLocked = round2(prepared.reduce((sum, item) => sum + item.liability, 0))
  if (totalLocked > player.balance) {
    throw new HttpError(400, `Need ${totalLocked.toFixed(2)} coins locked. Balance is ${player.balance.toFixed(2)} coins.`)
  }
  const at = new Date().toISOString()
  transaction(() => {
    const update = database.prepare('UPDATE players SET balance = balance - ? WHERE id = ? AND balance >= ?')
      .run(totalLocked, player.id, totalLocked)
    if (update.changes !== 1) throw new HttpError(400, 'Insufficient credits.')
    const insertBet = database.prepare(`
      INSERT INTO bets (id, player_id, placed_at, event_id, event_name, market_id, market_name,
        runner_id, runner_name, side, odds, stake, liability, status, pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)
    `)
    for (const bet of prepared) {
      insertBet.run(bet.id, player.id, bet.placedAt, bet.eventId, bet.eventName, bet.marketId,
        bet.marketName, bet.runnerId, bet.runnerName, bet.side, bet.odds, bet.stake, bet.liability)
    }
    database.prepare('INSERT INTO ledger (id, player_id, at, label, amount) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), player.id, at, `Placed ${prepared.length} bet${prepared.length > 1 ? 's' : ''}`, -totalLocked)
  })
  response.json(snapshot(player.id))
}))

app.post('/api/settle', endpoint((request, response) => {
  const body = requestObject(request)
  const player = requirePlayer(body.playerId)
  const { event, market } = findMarket(body.eventId, body.marketId)
  if (typeof body.winnerId !== 'string' || !market.runners.some((runner) => runner.id === body.winnerId)) {
    throw new HttpError(400, 'Winning runner is invalid.')
  }
  if (database.prepare('SELECT 1 FROM market_settlements WHERE market_id = ?').get(market.id)) {
    throw new HttpError(409, 'This market is already settled.')
  }
  const at = new Date().toISOString()
  transaction(() => {
    database.prepare('INSERT INTO market_settlements (market_id, event_id, winner_id, settled_at) VALUES (?, ?, ?, ?)')
      .run(market.id, event.id, body.winnerId as string, at)
    const openBets = database.prepare("SELECT * FROM bets WHERE market_id = ? AND status = 'open'").all(market.id) as BetRow[]
    for (const bet of openBets) {
      const won = bet.side === 'back' ? bet.runner_id === body.winnerId : bet.runner_id !== body.winnerId
      const pnl = won ? potentialWin(bet.side, bet.odds, bet.stake) : -bet.liability
      if (won) {
        const returned = round2(bet.liability + pnl)
        database.prepare('UPDATE players SET balance = balance + ? WHERE id = ?').run(returned, bet.player_id)
        database.prepare('INSERT INTO ledger (id, player_id, at, label, amount) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), bet.player_id, at, `Won ${bet.runner_name} @ ${bet.odds}`, returned)
      } else {
        database.prepare('INSERT INTO ledger (id, player_id, at, label, amount) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), bet.player_id, at, `Lost ${bet.runner_name} @ ${bet.odds}`, 0)
      }
      database.prepare('UPDATE bets SET status = ?, pnl = ? WHERE id = ?')
        .run(won ? 'won' : 'lost', pnl, bet.id)
    }
  })
  response.json(snapshot(player.id))
}))

const webDirectory = join(process.cwd(), 'dist')
if (existsSync(webDirectory)) {
  app.use(express.static(webDirectory))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next()
    response.sendFile(join(webDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}

export default app

if (!process.env.VERCEL && process.argv[1]?.endsWith('/server.ts')) {
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
  app.listen(port, '0.0.0.0', () => console.log(`Credits API listening on ${port}`))
}
