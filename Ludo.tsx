import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatVc } from './money'
import { useSherabet } from './store'

type LudoPlayer = { playerId: string; name: string; tokens: number[] }
type LudoState = {
  players: LudoPlayer[]
  currentPlayerIndex: number
  dice: number | null
  legalTokens: number[]
  winnerId: string | null
  payout: number
}
type Room = {
  id: string
  hostPlayerId: string
  maxPlayers: number
  stake: number
  status: 'waiting' | 'playing' | 'finished'
  gameState: LudoState | null
  players: { playerId: string; name: string }[]
  viewerPlayerId: string
}

const TRACK_LENGTH = 56
const COLORS = ['red', 'green', 'yellow', 'blue']

async function ludoRequest<T>(url: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'Could not connect to the Ludo room.')
  return result
}

function newTokens() {
  return [-1, -1, -1, -1]
}

export function Ludo() {
  const user = useSherabet((state) => state.user)
  const balance = useSherabet((state) => state.balance)
  const isUnlimited = useSherabet((state) => state.isUnlimited)
  const stakeOptions = useSherabet((state) => state.stakeOptions)
  const payEntry = useSherabet((state) => state.payLudoEntry)
  const refundEntry = useSherabet((state) => state.refundLudoEntry)
  const awardPrize = useSherabet((state) => state.awardLudoPrize)
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState<'computer' | 'live'>(searchParams.has('room') ? 'live' : 'computer')
  const [playerCount, setPlayerCount] = useState<2 | 4>(2)
  const [entryFee, setEntryFee] = useState('100')
  const [room, setRoom] = useState<Room | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [computerState, setComputerState] = useState<LudoState | null>(null)
  const [computerName] = useState('Computer')
  const roomId = searchParams.get('room')

  const refreshRoom = useCallback(async () => {
    if (!roomId) return
    try {
      const response = await ludoRequest<{ room: Room }>(`/api/ludo/rooms/${encodeURIComponent(roomId)}`)
      setRoom(response.room)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load this room.')
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      return
    }
    void refreshRoom()
    const interval = window.setInterval(() => void refreshRoom(), 1200)
    return () => window.clearInterval(interval)
  }, [refreshRoom, roomId])

  useEffect(() => {
    if (!room?.gameState?.winnerId || room.gameState.winnerId !== room.viewerPlayerId) return
    const prizeKey = `ludo-prize-${room.id}`
    if (localStorage.getItem(prizeKey)) return
    const prize = room.gameState.payout
    if (prize > 0) {
      awardPrize(prize)
      localStorage.setItem(prizeKey, 'claimed')
      setMessage(`You won ${formatVc(prize)} coins after the 10% fee.`)
    }
  }, [awardPrize, room])

  function numericEntry() {
    const amount = Number(entryFee)
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0
  }

  async function createRoom() {
    const stake = numericEntry()
    if (!stake) {
      setMessage('Enter a valid entry fee.')
      return
    }
    if (stake > balance) {
      setMessage('Not enough coins for this entry fee.')
      return
    }
    setBusy(true)
    setMessage('')
    const paymentError = payEntry(stake)
    if (paymentError) {
      setMessage(paymentError)
      setBusy(false)
      return
    }
    try {
      const response = await ludoRequest<{ room: Room }>('/api/ludo/rooms', 'POST', { maxPlayers: playerCount, stake })
      setRoom(response.room)
      setSearchParams({ room: response.room.id })
      setMode('live')
    } catch (error) {
      refundEntry(stake)
      setMessage(error instanceof Error ? error.message : 'Could not create a room.')
    } finally {
      setBusy(false)
    }
  }

  async function joinRoom() {
    if (!room || room.players.some((player) => player.playerId === room.viewerPlayerId)) return
    if (room.stake > balance) {
      setMessage('Not enough coins for this entry fee.')
      return
    }
    setBusy(true)
    setMessage('')
    const paymentError = payEntry(room.stake)
    if (paymentError) {
      setMessage(paymentError)
      setBusy(false)
      return
    }
    try {
      await ludoRequest(`/api/ludo/rooms/${encodeURIComponent(room.id)}/join`, 'POST')
      await refreshRoom()
    } catch (error) {
      refundEntry(room.stake)
      setMessage(error instanceof Error ? error.message : 'Could not join this room.')
    } finally {
      setBusy(false)
    }
  }

  async function startRoom() {
    if (!room) return
    setBusy(true)
    setMessage('')
    try {
      await ludoRequest(`/api/ludo/rooms/${encodeURIComponent(room.id)}/start`, 'POST')
      await refreshRoom()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start this game.')
    } finally {
      setBusy(false)
    }
  }

  async function rollOnline() {
    if (!room) return
    setBusy(true)
    setMessage('')
    try {
      const response = await ludoRequest<{ dice: number; legalTokens: number[] }>(
        `/api/ludo/rooms/${encodeURIComponent(room.id)}/roll`, 'POST',
      )
      setMessage(response.legalTokens.length ? `You rolled ${response.dice}. Choose a token.` : `You rolled ${response.dice}; no token can move.`)
      await refreshRoom()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not roll the dice.')
    } finally {
      setBusy(false)
    }
  }

  async function moveOnline(tokenIndex: number) {
    if (!room) return
    setBusy(true)
    setMessage('')
    try {
      await ludoRequest(`/api/ludo/rooms/${encodeURIComponent(room.id)}/move`, 'POST', { tokenIndex })
      await refreshRoom()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not move that token.')
    } finally {
      setBusy(false)
    }
  }

  async function copyInvite() {
    if (!room) return
    const invite = new URL(window.location.href)
    invite.searchParams.set('room', room.id)
    try {
      await navigator.clipboard.writeText(invite.toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setMessage('Could not copy the invite link. Copy the URL from your browser address bar.')
    }
  }

  function startComputerGame() {
    const stake = numericEntry()
    if (!stake) {
      setMessage('Enter a valid entry fee.')
      return
    }
    if (stake > balance) {
      setMessage('Not enough coins for this entry fee.')
      return
    }
    const paymentError = payEntry(stake)
    if (paymentError) {
      setMessage(paymentError)
      return
    }
    setMessage('')
    setComputerState({
      players: [
        { playerId: 'you', name: user ?? 'You', tokens: newTokens() },
        { playerId: 'computer', name: computerName, tokens: newTokens() },
      ],
      currentPlayerIndex: 0,
      dice: null,
      legalTokens: [],
      winnerId: null,
      payout: 0,
    })
  }

  function rollComputer() {
    if (!computerState || computerState.dice !== null || computerState.winnerId) return
    const dice = Math.floor(Math.random() * 6) + 1
    const current = computerState.players[computerState.currentPlayerIndex]
    const legalTokens = current.tokens.flatMap((position, index) =>
      (position === -1 ? dice === 6 : position + dice <= TRACK_LENGTH) ? [index] : [],
    )
    if (legalTokens.length) {
      setComputerState({ ...computerState, dice, legalTokens })
      setMessage(`${current.name} rolled ${dice}.`)
    } else {
      setComputerState({ ...computerState, dice: null, legalTokens: [], currentPlayerIndex: (computerState.currentPlayerIndex + 1) % 2 })
      setMessage(`${current.name} rolled ${dice}; no token can move.`)
    }
  }

  function moveComputer(tokenIndex: number) {
    if (!computerState || computerState.dice === null || !computerState.legalTokens.includes(tokenIndex)) return
    const players = computerState.players.map((player, index) => {
      if (index !== computerState.currentPlayerIndex) return player
      const tokens = [...player.tokens]
      tokens[tokenIndex] = tokens[tokenIndex] === -1 ? 0 : tokens[tokenIndex] + computerState.dice!
      return { ...player, tokens }
    })
    const winner = players.find((player) => player.tokens.every((position) => position === TRACK_LENGTH))
    const payout = Math.round(2 * numericEntry() * 0.9 * 100) / 100
    const nextState = {
      ...computerState,
      players,
      dice: null,
      legalTokens: [],
      winnerId: winner?.playerId ?? null,
      payout: winner?.playerId === 'you' ? payout : 0,
      currentPlayerIndex: winner || computerState.dice === 6 ? computerState.currentPlayerIndex : (computerState.currentPlayerIndex + 1) % 2,
    }
    setComputerState(nextState)
    if (winner?.playerId === 'you') {
      awardPrize(payout)
      setMessage(`You won ${formatVc(payout)} coins after the 10% fee.`)
    } else if (winner) {
      setMessage('The computer won this round.')
    } else {
      setMessage(`${computerState.players[computerState.currentPlayerIndex].name} moved a token.`)
    }
  }

  useEffect(() => {
    if (!computerState || computerState.winnerId || computerState.currentPlayerIndex !== 1) return
    const timeout = window.setTimeout(() => {
      if (computerState.dice === null) {
        const dice = Math.floor(Math.random() * 6) + 1
        const legalTokens = computerState.players[1].tokens.flatMap((position, index) =>
          (position === -1 ? dice === 6 : position + dice <= TRACK_LENGTH) ? [index] : [],
        )
        if (!legalTokens.length) {
          setComputerState({ ...computerState, currentPlayerIndex: 0 })
          setMessage(`Computer rolled ${dice}; no token can move.`)
        } else {
          setComputerState({ ...computerState, dice, legalTokens })
          setMessage(`Computer rolled ${dice}.`)
        }
      } else {
        const tokenIndex = computerState.legalTokens[0]
        if (tokenIndex !== undefined) moveComputer(tokenIndex)
      }
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [computerState])

  const activeGame = room?.gameState ?? computerState
  const currentPlayer = activeGame?.players[activeGame.currentPlayerIndex]
  const isMyTurn = room
    ? currentPlayer?.playerId === room.viewerPlayerId
    : currentPlayer?.playerId === 'you'

  return (
    <section className="ludo-page">
      <div className="page-head">
        <div><h2>Ludo</h2><p>Play a fair race against the computer or invite friends to a live room.</p></div>
        <span className="casino-demo-badge">10% winner fee</span>
      </div>
      <div className="ludo-intro">
        <span aria-hidden="true">🎲</span>
        <div><strong>Roll a six to leave your yard.</strong><p>First player to bring all four tokens home wins. All dice rolls are fair and random.</p></div>
      </div>

      {!activeGame && !room && (
        <>
          <div className="ludo-mode-tabs" role="tablist" aria-label="Ludo game mode">
            <button type="button" role="tab" aria-selected={mode === 'computer'} className={mode === 'computer' ? 'active' : ''} onClick={() => { setMode('computer'); setMessage('') }}>Play computer</button>
            <button type="button" role="tab" aria-selected={mode === 'live'} className={mode === 'live' ? 'active' : ''} onClick={() => { setMode('live'); setMessage('') }}>Live friends</button>
          </div>
          {mode === 'computer' ? (
            <section className="ludo-panel">
              <h3>Play against the computer</h3>
              <p>Both sides have the same rules. The winner receives 90% of the 2-player coin pot.</p>
              <StakePresets options={stakeOptions} value={entryFee} onSelect={setEntryFee} />
              <label className="ludo-field">Entry fee per player (coins)
                <input type="number" min="1" step="1" value={entryFee} onChange={(event) => setEntryFee(event.target.value)} />
              </label>
              <p className="ludo-balance">Your balance: <strong>{isUnlimited ? 'Unlimited coins' : `${formatVc(balance)} coins`}</strong></p>
              <button className="primary" type="button" onClick={startComputerGame}>Start match</button>
            </section>
          ) : (
            <section className="ludo-panel">
              <h3>Create a live lobby</h3>
              <p>Invite a friend with a room link. Choose a 2-player match or a 4-player room (maximum 4).</p>
              <div className="ludo-options">
                <label className="ludo-field">Players
                  <select value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value) as 2 | 4)}>
                    <option value={2}>2 players</option><option value={4}>4 players</option>
                  </select>
                </label>
                <StakePresets options={stakeOptions} value={entryFee} onSelect={setEntryFee} />
                <label className="ludo-field">Entry fee per player (coins)
                  <input type="number" min="1" step="1" value={entryFee} onChange={(event) => setEntryFee(event.target.value)} />
                </label>
              </div>
              <p className="ludo-balance">Your balance: <strong>{isUnlimited ? 'Unlimited coins' : `${formatVc(balance)} coins`}</strong></p>
              <button className="primary" type="button" disabled={busy} onClick={() => void createRoom()}>{busy ? 'Creating…' : 'Create invite lobby'}</button>
            </section>
          )}
        </>
      )}

      {room && room.status === 'waiting' && (
        <section className="ludo-panel">
          <div className="ludo-lobby-heading"><div><span className="casino-eyebrow">LIVE LOBBY</span><h3>Room {room.id.slice(0, 8).toUpperCase()}</h3></div><span>{room.players.length}/{room.maxPlayers} players</span></div>
          <p>Entry: <strong>{formatVc(room.stake)} coins each</strong> · Winner receives 90% of the pot.</p>
          <div className="ludo-player-list">
            {room.players.map((player, index) => <div key={player.playerId}><span className={`ludo-seat ${COLORS[index]}`}>{index + 1}</span><strong>{player.name}</strong>{player.playerId === room.hostPlayerId && <small>Host</small>}</div>)}
            {Array.from({ length: room.maxPlayers - room.players.length }, (_, index) => <div className="ludo-empty-seat" key={index}><span>＋</span><span>Waiting for player</span></div>)}
          </div>
          <div className="ludo-lobby-actions">
            {!room.players.some((player) => player.playerId === room.viewerPlayerId) && <button className="primary" disabled={busy} type="button" onClick={() => void joinRoom()}>Join lobby · {formatVc(room.stake)} coins</button>}
            <button className="ghost" type="button" onClick={() => void copyInvite()}>{copied ? 'Invite link copied' : 'Copy invite link'}</button>
            {room.hostPlayerId === room.viewerPlayerId && <button className="primary" disabled={busy || room.players.length !== room.maxPlayers} type="button" onClick={() => void startRoom()}>Start match</button>}
          </div>
        </section>
      )}

      {activeGame && (
        <section className="ludo-game">
          <div className="ludo-game-heading">
            <div><span className="casino-eyebrow">{room ? 'LIVE MATCH' : 'COMPUTER MATCH'}</span><h3>{currentPlayer?.name ?? 'Ludo match'} {activeGame.winnerId ? '· Match over' : isMyTurn ? '· Your turn' : '· Waiting for turn'}</h3></div>
            {room && <button className="ghost" type="button" onClick={() => void copyInvite()}>{copied ? 'Copied' : 'Invite'}</button>}
          </div>
          <div className="ludo-scoreboard">
            {activeGame.players.map((player, index) => <div className={`ludo-player-card ${COLORS[index]}${player.playerId === currentPlayer?.playerId ? ' current' : ''}`} key={player.playerId}>
              <div><strong>{player.name}</strong><small>{player.tokens.filter((position) => position === TRACK_LENGTH).length}/4 home</small></div>
              <div className="ludo-tokens">{player.tokens.map((position, tokenIndex) => <button key={tokenIndex} type="button" disabled={!isMyTurn || activeGame.winnerId !== null || busy || (room ? !activeGame.legalTokens.includes(tokenIndex) : computerState?.dice === null || !computerState?.legalTokens.includes(tokenIndex))} onClick={() => room ? void moveOnline(tokenIndex) : moveComputer(tokenIndex)} title={`Token ${tokenIndex + 1}: ${position < 0 ? 'in yard' : `${position}/${TRACK_LENGTH}`}`}>
                {position < 0 ? '🏠' : position === TRACK_LENGTH ? '★' : '●'}
              </button>)}</div>
              <small>{player.tokens.filter((position) => position === -1).length} in yard · {player.tokens.filter((position) => position === TRACK_LENGTH).length} home</small>
            </div>)}
          </div>
          <div className="ludo-board" aria-label="Ludo token race board">
            {activeGame.players.map((player, playerIndex) => <div className={`ludo-lane ${COLORS[playerIndex]}`} key={player.playerId}>
              <strong>{player.name}</strong>
              <div className="ludo-lane-cells">
                {Array.from({ length: 12 }, (_, cellIndex) => {
                  const tokensHere = player.tokens.flatMap((position, tokenIndex) => {
                    const cell = position < 0 ? 0 : position === TRACK_LENGTH ? 11 : Math.min(10, Math.floor(position / TRACK_LENGTH * 10) + 1)
                    return cell === cellIndex ? [tokenIndex + 1] : []
                  })
                  return <span className={cellIndex === 11 ? 'home' : ''} key={cellIndex}>{tokensHere.join('') || (cellIndex === 0 ? 'Yard' : cellIndex === 11 ? '★' : '')}</span>
                })}
              </div>
            </div>)}
          </div>
          <div className="ludo-action-bar">
            <div className="ludo-die" aria-live="polite">{activeGame.dice ?? '🎲'}</div>
            {activeGame.winnerId ? <strong>{activeGame.players.find((player) => player.playerId === activeGame.winnerId)?.name} wins!</strong>
              : room
                ? <button className="primary" type="button" disabled={busy || !isMyTurn || activeGame.dice !== null} onClick={() => void rollOnline()}>{busy ? 'Please wait…' : isMyTurn ? 'Roll dice' : 'Waiting for turn…'}</button>
                : <button className="primary" type="button" disabled={busy || !isMyTurn || computerState?.dice !== null} onClick={rollComputer}>{isMyTurn ? computerState?.dice === null ? 'Roll dice' : 'Choose a highlighted token' : 'Computer turn…'}</button>}
          </div>
          <p className="ludo-rules">A six releases a token. Exact count is required to reach home. The first player to finish all four tokens wins.</p>
        </section>
      )}

      {message && <p className="ludo-message" role="status">{message}</p>}
      <Link className="ludo-back" to="/casino">← Back to all games</Link>
    </section>
  )
}

function StakePresets({ options, value, onSelect }: {
  options: number[]
  value: string
  onSelect: (amount: string) => void
}) {
  return <div className="ludo-stake-presets" aria-label="Choose an entry fee preset">
    <span>Entry presets</span>
    <div>{options.map((amount) => <button
      className={`ghost${value === String(amount) ? ' selected' : ''}`}
      key={amount}
      type="button"
      aria-pressed={value === String(amount)}
      onClick={() => onSelect(String(amount))}
    >{amount}</button>)}</div>
  </div>
}
