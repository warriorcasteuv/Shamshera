export function round2(n: number) {
  return Math.round(n * 100) / 100
}
export function formatVc(n: number) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
export function liability(side: 'back' | 'lay', odds: number, stake: number) {
  if (side === 'back') return round2(stake)
  return round2(stake * (odds - 1))
}
export function potentialWin(side: 'back' | 'lay', odds: number, stake: number) {
  if (side === 'back') return round2(stake * (odds - 1))
  return round2(stake)
}
export function jitterOdds(n: number) {
  const delta = (Math.random() - 0.5) * 0.06
  return Math.max(1.01, round2(n + delta))
}