import { Link, useParams } from 'react-router-dom'
import { sportLabel } from './catalog'
import { RunnerOddsRow } from './Eventlist'
import { LiveCricketEvent } from './LiveCricket'
import { useSherabet } from './store'
export function EventPage() {
  const { eventId } = useParams()
  if (eventId?.startsWith('cricket-')) {
    return <LiveCricketEvent matchId={eventId.slice('cricket-'.length)} />
  }
  return <CatalogEventPage eventId={eventId} />
}

function CatalogEventPage({ eventId }: { eventId: string | undefined }) {
  const event = useSherabet((s) => s.events.find((e) => e.id === eventId))
  const settleMarket = useSherabet((s) => s.settleMarket)
  if (!event) {
    return (
      <section>
        <p>Event not found.</p>
        <Link to="/">Back to in-play</Link>
      </section>
    )
  }
  return (
    <section>
      <div className="page-head">
        <div>
          <p className="comp">{sportLabel(event.sport)} · {event.competition}</p>
          <h2>{event.name}</h2>
          <p>{event.inPlay ? 'In-play' : event.startLabel}. Settle markets below to see P&amp;L.</p>
        </div>
      </div>
      {event.markets.map((market) => (
        <article className="market" key={market.id}>
          <h3>{market.name}</h3>
          {market.runners.map((runner) => (
            <RunnerOddsRow key={runner.id} event={event} market={market} runner={runner} />
          ))}
          <div className="row-actions">
            {market.settledRunnerId ? (
              <span className="tiny">This market is settled.</span>
            ) : (
              market.runners.map((runner) => (
                <button
                  key={runner.id}
                  className="ghost"
                  type="button"
                  onClick={() => settleMarket(event.id, market.id, runner.id)}
                >
                  Set result: {runner.name}
                </button>
              ))
            )}
          </div>
        </article>
      ))}
    </section>
  )
}