import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { completedOvers, sessionOvers, type CricketFeed, type CricketMatch } from './cricket'

type CricketFeedState = {
  feed: CricketFeed | null
  error: string | null
  loading: boolean
}

function useCricketFeed(): CricketFeedState {
  const [state, setState] = useState<CricketFeedState>({ feed: null, error: null, loading: true })
  const requestInProgress = useRef(false)

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      if (requestInProgress.current) return
      requestInProgress.current = true
      try {
        const response = await fetch('/api/cricket/matches', { cache: 'no-store' })
        const result = await response.json() as CricketFeed & { error?: string }
        if (!response.ok) throw new Error(result.error || 'The live cricket feed could not be loaded.')
        if (mounted) setState({ feed: result, error: null, loading: false })
      } catch (error) {
        if (mounted) {
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : 'The live cricket feed could not be loaded.',
            loading: false,
          }))
        }
      } finally {
        requestInProgress.current = false
      }
    }

    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [])

  return state
}

function scoreLabel(match: CricketMatch) {
  return match.scores.length
    ? match.scores.map((score) => `${score.innings}: ${score.runs ?? '-'}${score.wickets === null ? '' : `/${score.wickets}`}${score.overs ? ` (${score.overs} ov)` : ''}`)
    : ['Score not available yet']
}

function MatchCard({ match }: { match: CricketMatch }) {
  const inPlay = match.matchStarted && !match.matchEnded
  return (
    <article className="event-card cricket-match-card">
      <div className="event-top">
        <div>
          <div className="comp">{match.series || match.matchType}</div>
          <Link to={`/event/cricket-${encodeURIComponent(match.id)}`}><strong>{match.name}</strong></Link>
        </div>
        <span className={inPlay ? 'inplay' : 'tiny'}>{inPlay ? 'LIVE' : match.status}</span>
      </div>
      <div className="cricket-match-score">
        {scoreLabel(match).map((score) => <div key={score}>{score}</div>)}
        {match.venue && <small>{match.venue}</small>}
      </div>
      <div className="cricket-match-link">
        <Link to={`/event/cricket-${encodeURIComponent(match.id)}`}>Open live score &amp; sessions →</Link>
      </div>
    </article>
  )
}

export function LiveCricketBoard() {
  const { feed, error, loading } = useCricketFeed()
  const matches = feed?.matches ?? []
  const inPlay = matches.filter((match) => match.matchStarted && !match.matchEnded)
  const upcoming = matches.filter((match) => !match.matchStarted && !match.matchEnded)

  return (
    <section className="cricket-board">
      <div className="page-head">
        <div>
          <h2>Cricket · Live &amp; upcoming</h2>
          <p>Scores refresh automatically. Latest feed update: {feed ? new Date(feed.updatedAt).toLocaleTimeString() : 'not available'}.</p>
        </div>
        <span className="pill back">Live score feed</span>
      </div>
      {error && <p className="warn" role="alert">{error}{feed ? ' Showing the last successful update.' : ''}</p>}
      {loading && <div className="empty">Loading cricket matches…</div>}
      {!loading && !error && matches.length === 0 && (
        <div className="empty">The provider has no live or upcoming matches right now.</div>
      )}
      {inPlay.length > 0 && (
        <>
          <h3 className="cricket-list-heading">In-play <span>{inPlay.length}</span></h3>
          {inPlay.map((match) => <MatchCard key={match.id} match={match} />)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <h3 className="cricket-list-heading">Upcoming <span>{upcoming.length}</span></h3>
          {upcoming.map((match) => <MatchCard key={match.id} match={match} />)}
        </>
      )}
    </section>
  )
}

export function LiveCricketEvent({ matchId }: { matchId: string }) {
  const { feed, error, loading } = useCricketFeed()
  const match = feed?.matches.find((item) => item.id === matchId)
  const currentInnings = match?.scores.at(-1)
  const overs = currentInnings ? completedOvers(currentInnings.overs) : null
  const targets = match ? sessionOvers(match.matchType) : []

  if (loading) return <div className="empty">Loading live match…</div>
  if (!match) {
    return (
      <section>
        <div className="page-head"><div><h2>Live match unavailable</h2></div></div>
        {error && <p className="warn" role="alert">{error}</p>}
        {!error && <p className="empty">This match is no longer in the current or upcoming feed.</p>}
        <Link className="ghost" to="/sport/cricket">Back to cricket</Link>
      </section>
    )
  }

  const inPlay = match.matchStarted && !match.matchEnded
  return (
    <section className="live-cricket-detail">
      <div className="page-head">
        <div>
          <p className="comp">{match.series || match.matchType} · {match.matchType}</p>
          <h2>{match.name}</h2>
          <p>{match.status}{match.venue ? ` · ${match.venue}` : ''}</p>
        </div>
        <span className={inPlay ? 'inplay' : 'tiny'}>{inPlay ? 'LIVE' : match.status}</span>
      </div>
      {error && <p className="warn" role="alert">{error} Showing the last successful update.</p>}

      <article className="market live-score-panel">
        <header><h3>Live score</h3><span>Updated {feed ? new Date(feed.updatedAt).toLocaleTimeString() : '—'}</span></header>
        {match.scores.length > 0 ? match.scores.map((score) => (
          <div className="live-innings-row" key={score.innings}>
            <span>{score.innings}</span>
            <strong>{score.runs ?? '-'}{score.wickets === null ? '' : `/${score.wickets}`}</strong>
            {score.overs && <span>{score.overs} overs</span>}
          </div>
        )) : <p className="tiny">The provider has not published an innings score yet.</p>}
      </article>

      <article className="market session-panel">
        <header>
          <h3>Session progress</h3>
          <span>{currentInnings?.innings ?? 'Waiting for first innings'}</span>
        </header>
        <p className="tiny">Over checkpoints update with the live feed; checkpoint scores are shown only when supplied by the provider.</p>
        {currentInnings && (
          <div className="current-innings-score">
            <strong>{currentInnings.runs ?? '-'}{currentInnings.wickets === null ? '' : `/${currentInnings.wickets}`}</strong>
            <span>{currentInnings.overs || 'Overs unavailable'} overs · {currentInnings.innings}</span>
          </div>
        )}
        <div className="session-checkpoints">
          {targets.map((target) => {
            const reached = overs !== null && overs >= target
            return (
              <div className={`session-checkpoint${reached ? ' reached' : ''}`} key={target}>
                <strong>{target} ov</strong>
                <span>{reached ? 'Reached' : 'Upcoming'}</span>
                {reached && <small>Checkpoint score not supplied</small>}
              </div>
            )
          })}
        </div>
      </article>

      <p className="demo-notice">
        Live score is supplied by the cricket feed. This free score feed does not provide verified Back/Lay prices or session market odds; those must come from a separate authorized odds provider before they can be shown as live.
      </p>
      <Link className="ghost" to="/sport/cricket">Back to cricket</Link>
    </section>
  )
}
