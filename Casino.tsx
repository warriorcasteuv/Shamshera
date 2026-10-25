import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSherabet } from './store'

const SYMBOLS = ['⭐', '🔔', '🍒', '🍋', '💎', '🍀']
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const CARD_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 11]
const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'A']

type Card = { rank: string; value: number }
type Flight = { startedAt: number; crashAt: number }

const GAMES = [
  { id: 'slots', name: 'Golden Reels', category: 'Slots', icon: '🎰', description: 'Spin three reels and look for a matching line.', mood: 'gold' },
  { id: 'roulette', name: 'Roulette', category: 'Table games', icon: '🎡', description: 'Choose red or black, then spin the single-zero wheel.', mood: 'green' },
  { id: 'blackjack', name: 'Blackjack', category: 'Card games', icon: '🂡', description: 'Draw cards, then hold before you go over 21.', mood: 'blue' },
  { id: 'baccarat', name: 'Baccarat', category: 'Card games', icon: '🃏', description: 'Deal two hands and see which total is closer to nine.', mood: 'purple' },
  { id: 'sic-bo', name: 'Sic Bo', category: 'Dice games', icon: '🎲', description: 'Roll three dice; triples are the rare result.', mood: 'red' },
  { id: 'plinko', name: 'Plinko', category: 'Arcade', icon: '🔵', description: 'Drop a ball and watch its random path through the pegs.', mood: 'pink' },
  { id: 'aviator', name: 'Aviator', category: 'Crash game', icon: '✈️', description: 'Watch the flight multiplier and cash out before it crashes.', mood: 'blue' },
  { id: 'ludo', name: 'Ludo', category: 'Board game', icon: '🎲', description: 'Race your tokens against the computer or invite friends to a 2–4 player lobby.', mood: 'red' },
]

function drawCard(): Card {
  const index = Math.floor(Math.random() * CARD_VALUES.length)
  return { rank: CARD_RANKS[index], value: CARD_VALUES[index] }
}

function handTotal(cards: Card[]) {
  let total = cards.reduce((sum, card) => sum + card.value, 0)
  let aces = cards.filter((card) => card.rank === 'A').length
  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }
  return total
}

function baccaratTotal(cards: Card[]) {
  return cards.reduce((sum, card) => sum + (card.value === 11 ? 1 : card.value === 10 ? 0 : card.value), 0) % 10
}

function makeBlackjackHand() {
  return { player: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()] }
}

function rouletteColor(number: number) {
  return number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black'
}

export function Casino() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [result, setResult] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [rouletteChoice, setRouletteChoice] = useState<'red' | 'black'>('red')
  const [rouletteNumber, setRouletteNumber] = useState<number | null>(null)
  const [blackjack, setBlackjack] = useState<{ player: Card[]; dealer: Card[] } | null>(null)
  const [blackjackOver, setBlackjackOver] = useState(false)
  const [baccarat, setBaccarat] = useState<{ player: Card[]; banker: Card[] } | null>(null)
  const [dice, setDice] = useState<number[] | null>(null)
  const [plinkoPath, setPlinkoPath] = useState<string | null>(null)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [flightMultiplier, setFlightMultiplier] = useState(1)
  const stakeOptions = useSherabet((state) => state.stakeOptions)
  const [selectedStake, setSelectedStake] = useState('100')
  const activeGame = GAMES.find((game) => game.id === gameId && game.id !== 'ludo')

  useEffect(() => {
    if (!stakeOptions.some((stake) => String(stake) === selectedStake)) {
      setSelectedStake(String(stakeOptions[0] ?? 100))
    }
  }, [stakeOptions, selectedStake])

  useEffect(() => {
    if (!flight) return
    const intervalId = window.setInterval(() => {
      const multiplier = Math.exp((Date.now() - flight.startedAt) / 5000)
      if (multiplier >= flight.crashAt) {
        setFlightMultiplier(flight.crashAt)
        setFlight(null)
        setResult(`The plane crashed at ${flight.crashAt.toFixed(2)}×. No points or coins were used.`)
      } else {
        setFlightMultiplier(multiplier)
      }
    }, 60)
    return () => window.clearInterval(intervalId)
  }, [flight])

  function selectGame(selectedGameId: string) {
    if (selectedGameId === 'ludo') {
      navigate('/casino/ludo')
      return
    }
    navigate(`/casino/${selectedGameId}`)
  }

  useEffect(() => {
    setResult('')
    setSlots([])
    setRouletteNumber(null)
    setBlackjack(null)
    setBlackjackOver(false)
    setBaccarat(null)
    setDice(null)
    setPlinkoPath(null)
    setFlight(null)
    setFlightMultiplier(1)
  }, [gameId])

  function spinSlots() {
    const reels = Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)])
    setSlots(reels)
    setResult(reels.every((symbol) => symbol === reels[0])
      ? 'Three matching symbols! That is a line match (1 in 36 with these six symbols).'
      : 'No match this spin. Each reel is an independent random draw.')
  }

  function spinRoulette() {
    const number = Math.floor(Math.random() * 37)
    setRouletteNumber(number)
    const color = rouletteColor(number)
    setResult(`The wheel landed on ${number} ${color}. ${color === rouletteChoice ? 'Your color matched!' : 'Your color did not match this time.'}`)
  }

  function dealBlackjack() {
    setBlackjack(makeBlackjackHand())
    setBlackjackOver(false)
    setResult('')
  }

  function hitBlackjack() {
    if (!blackjack || blackjackOver) return
    const player = [...blackjack.player, drawCard()]
    setBlackjack({ ...blackjack, player })
    if (handTotal(player) > 21) {
      setBlackjackOver(true)
      setResult(`Bust at ${handTotal(player)}. The dealer wins this hand.`)
    }
  }

  function standBlackjack() {
    if (!blackjack || blackjackOver) return
    const dealer = [...blackjack.dealer]
    while (handTotal(dealer) < 17) dealer.push(drawCard())
    setBlackjack({ ...blackjack, dealer })
    setBlackjackOver(true)
    const playerTotal = handTotal(blackjack.player)
    const dealerTotal = handTotal(dealer)
    setResult(
      playerTotal > 21 || (dealerTotal <= 21 && dealerTotal > playerTotal)
        ? `Dealer wins: you ${playerTotal}, dealer ${dealerTotal}.`
        : dealerTotal > 21 || playerTotal > dealerTotal
          ? `You win this hand: you ${playerTotal}, dealer ${dealerTotal}.`
          : `Push: both hands total ${playerTotal}.`,
    )
  }

  function dealBaccarat() {
    const player = [drawCard(), drawCard()]
    const banker = [drawCard(), drawCard()]
    const playerTotal = baccaratTotal(player)
    const bankerTotal = baccaratTotal(banker)
    setBaccarat({ player, banker })
    setResult(
      playerTotal > bankerTotal
        ? `Player wins: ${playerTotal} to ${bankerTotal}.`
        : bankerTotal > playerTotal
          ? `Banker wins: ${bankerTotal} to ${playerTotal}.`
          : `Tie: both hands total ${playerTotal}.`,
    )
  }

  function rollDice() {
    const roll = Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1)
    setDice(roll)
    setResult(roll.every((die) => die === roll[0])
      ? `Triple ${roll[0]}! Any specific triple has a 1 in 216 chance.`
      : `Total ${roll.reduce((sum, die) => sum + die, 0)}. Any specific triple has a 1 in 216 chance.`)
  }

  function dropPlinko() {
    const path = Array.from({ length: 8 }, () => Math.random() < 0.5 ? 'L' : 'R')
    setPlinkoPath(path.join(' → '))
    setResult(`The ball landed in bin ${path.filter((step) => step === 'R').length + 1} of 9.`)
  }

  function launchAviator() {
    const random = Math.random()
    const crashAt = Math.max(1.01, Math.floor((0.99 / (1 - random)) * 100) / 100)
    setResult('')
    setFlightMultiplier(1)
    setFlight({ startedAt: Date.now(), crashAt })
  }

  function cashOutAviator() {
    if (!flight || flightMultiplier >= flight.crashAt) return
    setResult(`Demo cash-out at ${flightMultiplier.toFixed(2)}×. No points or coins were used.`)
    setFlight(null)
  }

  return (
    <section className="casino-page">
      <div className="page-head">
        <div>
          <h2>Casino</h2>
          <p>Take a break from the markets with a few games of chance.</p>
        </div>
        <span className="casino-demo-badge">Selectable demo stakes</span>
      </div>

      {!activeGame && <div className="casino-banner">
        <div>
          <span className="casino-eyebrow">THE CASINO LOUNGE</span>
          <h3>Pick a game. Play for fun.</h3>
          <p>Try a free demo, or play Ludo with friends using coins.</p>
        </div>
        <span className="casino-banner-icon" aria-hidden="true">♠</span>
      </div>}

      {!activeGame && <div className="casino-section-heading">
        <div>
          <h3>All games</h3>
          <p>Choose a table or try a free round. Rules and chances are shown in each game.</p>
        </div>
        <span>{GAMES.length} games</span>
      </div>}

      {!activeGame && <div className="casino-grid">
        {GAMES.map((game) => (
          <article className={`casino-card casino-card-${game.mood}`} key={game.id}>
            <div className="casino-art" aria-hidden="true">
              <span className="casino-game-icon">{game.icon}</span>
              <span className="casino-art-label">{game.category}</span>
            </div>
            <div className="casino-card-content">
              <div>
                <h4>{game.name}</h4>
                <p>{game.description}</p>
              </div>
              <button
                className="casino-play-button"
                type="button"
                onClick={() => selectGame(game.id)}
              >
                {game.id === 'ludo' ? 'Play Ludo' : 'Open game'} <span aria-hidden="true">→</span>
              </button>
            </div>
          </article>
        ))}
      </div>}

      {activeGame && (
        <section className={`casino-table casino-card-${activeGame.mood}`} aria-labelledby="casino-table-title">
          <div className="casino-table-heading">
            <div>
              <span className="casino-eyebrow">FREE DEMO TABLE</span>
              <h3 id="casino-table-title">{activeGame.icon} {activeGame.name}</h3>
            </div>
            <Link className="ghost" to="/casino">All games</Link>
          </div>
          <p className="casino-rules">{activeGame.description} Stake presets are display-only; no coins or prizes are used.</p>
          <div className="casino-stake-picker" aria-label="Select a demo stake">
            <strong>Demo stake: {selectedStake} coins</strong>
            <div className="casino-stake-options">
              {stakeOptions.map((stake) => (
                <button
                  key={stake}
                  className={`ghost${selectedStake === String(stake) ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={selectedStake === String(stake)}
                  onClick={() => setSelectedStake(String(stake))}
                >
                  {stake}
                </button>
              ))}
            </div>
          </div>

          {activeGame.id === 'slots' && (
            <div className="casino-controls">
              <div className="slot-reels" aria-label={slots.length ? `Reels: ${slots.join(', ')}` : 'Three empty reels'}>
                {(slots.length ? slots : ['❔', '❔', '❔']).map((symbol, index) => <span key={index}>{symbol}</span>)}
              </div>
              <p className="casino-rules">Each of 6 symbols is equally likely on each reel. A three-symbol match is 1 in 36.</p>
              <button className="primary" type="button" onClick={spinSlots}>Spin reels</button>
            </div>
          )}

          {activeGame.id === 'roulette' && (
            <div className="casino-controls">
              <div className="casino-choice-row" aria-label="Choose a roulette color">
                {(['red', 'black'] as const).map((color) => (
                  <button key={color} type="button" className={`casino-color-choice ${color}${rouletteChoice === color ? ' selected' : ''}`} aria-pressed={rouletteChoice === color} onClick={() => setRouletteChoice(color)}>
                    {color}
                  </button>
                ))}
              </div>
              <div className={`roulette-result ${rouletteNumber === null ? '' : rouletteColor(rouletteNumber)}`} aria-live="polite">
                {rouletteNumber === null ? '—' : rouletteNumber}
              </div>
              <p className="casino-rules">European wheel: 18 red, 18 black, 1 green zero. A chosen color matches on 18 of 37 numbers.</p>
              <button className="primary" type="button" onClick={spinRoulette}>Spin wheel</button>
            </div>
          )}

          {activeGame.id === 'blackjack' && (
            <div className="casino-controls">
              {!blackjack ? (
                <button className="primary" type="button" onClick={dealBlackjack}>Deal hand</button>
              ) : (
                <div className="blackjack-table">
                  <div className="blackjack-hand">
                    <strong>Dealer {blackjackOver ? `(${handTotal(blackjack.dealer)})` : '(one card hidden)'}</strong>
                    <div className="playing-cards">
                      {blackjack.dealer.map((card, index) => <span className="playing-card" key={index}>{!blackjackOver && index === 1 ? '🂠' : card.rank}</span>)}
                    </div>
                  </div>
                  <div className="blackjack-hand">
                    <strong>You ({handTotal(blackjack.player)})</strong>
                    <div className="playing-cards">{blackjack.player.map((card, index) => <span className="playing-card" key={index}>{card.rank}</span>)}</div>
                  </div>
                  {!blackjackOver && <div className="casino-choice-row">
                    <button className="primary" type="button" onClick={hitBlackjack}>Hit</button>
                    <button className="ghost" type="button" onClick={standBlackjack}>Stand</button>
                  </div>}
                  {blackjackOver && <button className="ghost" type="button" onClick={dealBlackjack}>Deal again</button>}
                  <p className="casino-rules">Aces count as 1 or 11. Dealer draws to 17. Bust means over 21.</p>
                </div>
              )}
            </div>
          )}

          {activeGame.id === 'baccarat' && (
            <div className="casino-controls">
              {baccarat && <div className="baccarat-hands">
                {(['player', 'banker'] as const).map((side) => (
                  <div className="blackjack-hand" key={side}>
                    <strong>{side === 'player' ? 'Player' : 'Banker'} ({baccaratTotal(baccarat[side])})</strong>
                    <div className="playing-cards">{baccarat[side].map((card, index) => <span className="playing-card" key={index}>{card.rank}</span>)}</div>
                  </div>
                ))}
              </div>}
              <p className="casino-rules">Demo rule: deal two cards to each side; 10/J/Q/K count as 0, ace as 1. Closest to 9 wins. No wagers.</p>
              <button className="primary" type="button" onClick={dealBaccarat}>Deal cards</button>
            </div>
          )}

          {activeGame.id === 'sic-bo' && (
            <div className="casino-controls">
              <div className="dice-row" aria-live="polite">{(dice ?? [0, 0, 0]).map((die, index) => <span key={index}>{die || '⚀'}</span>)}</div>
              <p className="casino-rules">Three fair six-sided dice. There are 216 equally likely outcomes; any specific triple has a 1 in 216 chance.</p>
              <button className="primary" type="button" onClick={rollDice}>Roll dice</button>
            </div>
          )}

          {activeGame.id === 'plinko' && (
            <div className="casino-controls">
              <div className="plinko-board" aria-label="Plinko demo board">
                {Array.from({ length: 7 }, (_, row) => <div className="plinko-row" key={row}>{Array.from({ length: row + 1 }, (_, peg) => <span key={peg}>•</span>)}</div>)}
                {plinkoPath && <p className="plinko-path">Ball path: {plinkoPath}</p>}
                <div className="plinko-bins">{Array.from({ length: 9 }, (_, bin) => <span key={bin}>{bin + 1}</span>)}</div>
              </div>
              <p className="casino-rules">Each peg sends the ball left or right with equal probability. There are no prize bins.</p>
              <button className="primary" type="button" onClick={dropPlinko}>Drop ball</button>
            </div>
          )}

          {activeGame.id === 'aviator' && (
            <div className="casino-controls aviator-board">
              <div className={`aviator-flight${flight ? ' flying' : ''}`} aria-live="polite">
                <svg className="aviator-chart" viewBox="0 0 640 180" preserveAspectRatio="none" aria-hidden="true">
                  <path className="aviator-grid-line" d="M0 145H640M0 100H640M0 55H640" />
                  <path className="aviator-line" d="M8 164C92 160 114 148 170 144S254 140 292 123 355 116 394 92 452 77 482 53 545 41 632 6" />
                </svg>
                <span className="aviator-plane" aria-hidden="true">✈️</span>
                <strong>{flightMultiplier.toFixed(2)}×</strong>
                <span>{flight ? 'IN FLIGHT' : result.startsWith('The plane crashed') ? 'FLIGHT ENDED' : 'READY'}</span>
              </div>
              <p className="casino-rules">A demo crash point is generated each round. About half of flights end before 2×; there is no stake or payout.</p>
              {flight
                ? <button className="primary" type="button" onClick={cashOutAviator}>End demo flight at {flightMultiplier.toFixed(2)}×</button>
                : <button className="primary" type="button" onClick={launchAviator}>Launch plane</button>}
            </div>
          )}

          {result && <p className="casino-result" role="status">{result}</p>}
        </section>
      )}
    </section>
  )
}
