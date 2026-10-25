import { formatVc, liability, potentialWin } from './money'
import { sideLabel, useSherabet } from './store'
export function BetSlip() {
  const slip = useSherabet((s) => s.slip)
  const removeSlip = useSherabet((s) => s.removeSlip)
  const clearSlip = useSherabet((s) => s.clearSlip)
  const placeBets = useSherabet((s) => s.placeBets)
  const totalLock = slip.reduce((sum, item) => {
    const stake = Number(item.stake) || 0
    return sum + liability(item.side, item.odds, stake)
  }, 0)
  return (
    <aside className="slip">
      <h3>Bet slip</h3>
      <p className="tiny">Stakes use coins. Deposit requests need proof and admin approval.</p>
      {slip.length === 0 && <div className="empty">Tap Back or Lay to add a selection.</div>}
      {slip.map((item) => {
        const stake = Number(item.stake) || 0
        return (
          <div className="slip-item" key={item.key}>
            <header>
              <div>
                <span className={`tag ${item.side}`}>{sideLabel(item.side)}</span>
                <div>{item.runnerName}</div>
                <div className="tiny">{item.eventName} · {item.marketName}</div>
              </div>
              <button className="x" type="button" onClick={() => removeSlip(item.key)} aria-label="Remove">
                ×
              </button>
            </header>
            <div className="meta">
              <span>Odds {item.odds.toFixed(2)}</span>
              <span>Stake {formatVc(stake)} coins</span>
            </div>
            <div className="meta">
              <span>To win {formatVc(potentialWin(item.side, item.odds, stake))} coins</span>
              <span>Liability {formatVc(liability(item.side, item.odds, stake))} coins</span>
            </div>
          </div>
        )
      })}
      {slip.length > 0 && (
        <>
          <div className="meta"><span>Total to lock</span><strong>{formatVc(totalLock)} coins</strong></div>
          <div className="row-actions">
            <button className="primary" type="button" onClick={() => {
              const err = placeBets()
              if (err) window.alert(err)
            }}>
              Place bet
            </button>
            <button className="ghost" type="button" onClick={clearSlip}>Clear</button>
          </div>
        </>
      )}
    </aside>
  )
}