export type CricketInnings = {
  innings: string
  runs: number | null
  wickets: number | null
  overs: string
}

export type CricketMatch = {
  id: string
  name: string
  matchType: string
  status: string
  venue: string
  series: string
  dateTime: string
  teams: string[]
  scores: CricketInnings[]
  matchStarted: boolean
  matchEnded: boolean
}

export type CricketFeed = {
  updatedAt: string
  matches: CricketMatch[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrNull(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export function normalizeCricketMatch(value: unknown): CricketMatch | null {
  const match = record(value)
  if (!match) return null

  const id = text(match.id)
  const name = text(match.name)
  if (!id || !name) return null

  const scores = Array.isArray(match.score)
    ? match.score.flatMap((value) => {
        const score = record(value)
        if (!score) return []
        const innings = text(score.inning)
        if (!innings) return []
        return [{
          innings,
          runs: numberOrNull(score.r),
          wickets: numberOrNull(score.w),
          overs: text(score.o),
        }]
      })
    : []

  return {
    id,
    name,
    matchType: text(match.matchType) || 'Cricket',
    status: text(match.status) || 'Status unavailable',
    venue: text(match.venue),
    series: text(match.series),
    dateTime: text(match.dateTimeGMT) || text(match.date),
    teams: Array.isArray(match.teams) ? match.teams.filter((team): team is string => typeof team === 'string') : [],
    scores,
    matchStarted: match.matchStarted === true,
    matchEnded: match.matchEnded === true,
  }
}

export function sessionOvers(matchType: string) {
  const format = matchType.toLowerCase()
  if (format.includes('t20')) return [6, 10, 15, 20]
  if (format.includes('odi') || format.includes('one day')) return [10, 20, 30, 40, 50]
  if (format.includes('test')) return [10, 20, 30, 50]
  return [6, 10, 15, 20, 50]
}

export function completedOvers(overs: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(overs.trim())
  if (!match) return null
  const completed = Number(match[1])
  const balls = Number(match[2] ?? 0)
  if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(balls) || balls > 5) return null
  return completed + balls / 6
}
