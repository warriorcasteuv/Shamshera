import { Link } from 'react-router-dom'
import { formatVc, liability, potentialWin } from './money'
import type { SlipItem, SportEvent } from './types'
import { sideLabel, useSherabet } from './store'

type OddsButtonsProps = {
  event: SportEvent
  market: SportEvent['markets'][number]
  runner: SportEvent['markets'][number]['runners'][number]
}

export function RunnerOddsRow({ event, market, runner }: OddsButtonsProps) {
  const slip = useSherabet((s) => s.slip)
  const bets = useSherabet((s) => s.bets)
  const user = useSherabet((s) => s.user)
  const addToSlip = useSherabet((s) => s.addToSlip)
  const updateStake = useSherabet((s) => s.updateStake)
  const placeBets = useSherabet((s) => s.placeBets)
  const marketSlip = slip.filter((item) => item.marketId === market.id)
  const marketBets = bets.filter((bet) => bet.marketId === market.id && bet.status === 'open'
    && bet.customerName === (user ?? 'Player'))
  const marketPositions = [...marketSlip, ...marketBets]
  const backItem = slip.find((item) => item.key === `${market.id}-${runner.id}-back`)
  const layItem = slip.find((item) => item.key === `${market.id}-${runner.id}-lay`)
  const selectedItems = [backItem, layItem].filter((item): item is SlipItem => Boolean(item))
  const backOdds = backItem?.odds ?? runner.back
  const layOdds = layItem?.odds ?? runner.lay
  const outcomePnl = marketPositions.reduce((total, item) => {
    const stake = Number(item.stake) || 0
    const wins = item.side === 'back'
      ? item.runnerId === runner.id
      : item.runnerId !== runner.id
    return total + (wins
      ? potentialWin(item.side, item.odds, stake)
      : -liability(item.side, item.odds, stake))
  }, 0)

  return (
    <div className="runner-entry">
      <div className="runner-row">
        <span className="runner-name">
          <span>{runner.name}{market.settledRunnerId === runner.id ? ' · Winner' : ''}</span>
          {marketPositions.length > 0 && (
            <small className={`runner-pnl ${outcomePnl >= 0 ? 'positive' : 'negative'}`}>
              {outcomePnl >= 0 ? 'Profit +' : 'Loss -'}{formatVc(Math.abs(outcomePnl))} coins
            </small>
          )}
        </span>
        <button
          className={`odds back${backItem ? ' selected' : ''}`}
          type="button"
          disabled={Boolean(market.settledRunnerId)}
          aria-label={`Back ${runner.name} at ${backOdds.toFixed(2)}`}
          onClick={() =>
            addToSlip({
              eventId: event.id,
              eventName: event.name,
              marketId: market.id,
              marketName: market.name,
              runnerId: runner.id,
              runnerName: runner.name,
              side: 'back',
              odds: runner.back,
            })
          }
        >
          {backOdds.toFixed(2)}
          <small>Back</small>
        </button>
        <button
          className={`odds lay${layItem ? ' selected' : ''}`}
          type="button"
          disabled={Boolean(market.settledRunnerId)}
          aria-label={`Lay ${runner.name} at ${layOdds.toFixed(2)}`}
          onClick={() =>
            addToSlip({
              eventId: event.id,
              eventName: event.name,
              marketId: market.id,
              marketName: market.name,
              runnerId: runner.id,
              runnerName: runner.name,
              side: 'lay',
              odds: runner.lay,
            })
          }
        >
          {layOdds.toFixed(2)}
          <small>Lay</small>
        </button>
      </div>
      {selectedItems.map((item) => {
        const stake = Number(item.stake) || 0
        const invested = liability(item.side, item.odds, stake)
        const winLabel = item.side === 'back' ? `${runner.name} wins` : `${runner.name} loses`
        const loseLabel = item.side === 'back' ? `${runner.name} loses` : `${runner.name} wins`
        return (
          <div className="stake-editor" key={item.key}>
            <label>
              {sideLabel(item.side)} stake (coins)
              <input
                inputMode="decimal"
                value={item.stake}
                onChange={(e) => updateStake(item.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const error = placeBets()
                    if (error) window.alert(error)
                  }
                }}
                aria-label={`${sideLabel(item.side)} stake for ${runner.name}`}
              />
            </label>
            <div className="stake-breakdown">
              <div><span>Invested</span><strong>{formatVc(invested)} coins</strong></div>
              <div className="positive"><span>{winLabel}</span><strong>+{formatVc(potentialWin(item.side, item.odds, stake))} coins</strong></div>
              <div className="negative"><span>{loseLabel}</span><strong>-{formatVc(invested)} coins</strong></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EventList({ events }: { events: SportEvent[] }) {
  if (!events.length) return <div className="empty">No markets in this list.</div>
  return (
    <div>
      {events.map((event) => {
        const primary = event.markets[0]
        return (
          <article className="event-card" key={event.id}>
            <div className="event-top">
              <div>
                <div className="comp">{event.competition}</div>
                <Link to={`/event/${event.id}`}><strong>{event.name}</strong></Link>
              </div>
              <div>
                {event.inPlay ? <span className="inplay">IN-PLAY</span> : <span className="tiny">{event.startLabel}</span>}
              </div>
            </div>
            {primary.runners.map((runner) => (
              <RunnerOddsRow key={runner.id} event={event} market={primary} runner={runner} />
            ))}
          </article>
        )
      })}
    </div>
  )
}