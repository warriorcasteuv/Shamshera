import { formatVc } from './money'
import { sideLabel, useSherabet } from './store'
export function MyBets() {
  const user = useSherabet((s) => s.user)
  const allBets = useSherabet((s) => s.bets)
  const bets = allBets.filter((bet) => bet.customerName === (user ?? 'Player'))
  return (
    <section>
      <div className="page-head">
        <div>
          <h2>My bets</h2>
          <p>Open positions settle when you pick a result on the event page.</p>
        </div>
      </div>
      <div className="card pad">
        {bets.length === 0 ? (
          <div className="empty">No bets yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Selection</th>
                <th>Side</th>
                <th>Odds</th>
                <th>Stake</th>
                <th>Status</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <tr key={bet.id}>
                  <td>
                    <strong>{bet.runnerName}</strong>
                    <div className="tiny">{bet.eventName} · {bet.marketName}</div>
                  </td>
                  <td>{sideLabel(bet.side)}</td>
                  <td>{bet.odds.toFixed(2)}</td>
                  <td>{formatVc(bet.stake)}</td>
                  <td className={bet.status}>{bet.status}</td>
                  <td className={bet.pnl > 0 ? 'won' : bet.pnl < 0 ? 'lost' : ''}>
                    {bet.status === 'open' ? '—' : `${bet.pnl > 0 ? '+' : ''}${formatVc(bet.pnl)} coins`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}