import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completedOvers, normalizeCricketMatch, sessionOvers } from '../cricket.ts'

test('normalizes current cricket matches and skips malformed entries', () => {
  const match = normalizeCricketMatch({
    id: 'match-123',
    name: 'Home vs Away',
    matchType: 't20',
    status: 'Home need 20 runs',
    venue: 'Ground',
    dateTimeGMT: '2026-10-23T12:00:00',
    teams: ['Home', 'Away'],
    score: [{ inning: 'Home 1st Innings', r: '180', w: '5', o: '20' }],
    matchStarted: true,
    matchEnded: false,
  })

  assert.deepEqual(match, {
    id: 'match-123',
    name: 'Home vs Away',
    matchType: 't20',
    status: 'Home need 20 runs',
    venue: 'Ground',
    series: '',
    dateTime: '2026-10-23T12:00:00',
    teams: ['Home', 'Away'],
    scores: [{ innings: 'Home 1st Innings', runs: 180, wickets: 5, overs: '20' }],
    matchStarted: true,
    matchEnded: false,
  })
  assert.equal(normalizeCricketMatch({ name: 'No ID' }), null)
  assert.equal(normalizeCricketMatch(null), null)
})

test('selects session checkpoints for short, one-day, and test matches', () => {
  assert.deepEqual(sessionOvers('t20'), [6, 10, 15, 20])
  assert.deepEqual(sessionOvers('ODI'), [10, 20, 30, 40, 50])
  assert.deepEqual(sessionOvers('Test'), [10, 20, 30, 50])
})

test('parses cricket overs using six-ball overs and rejects invalid ball counts', () => {
  assert.equal(completedOvers('5.4'), 5 + 4 / 6)
  assert.equal(completedOvers('20'), 20)
  assert.equal(completedOvers('19.6'), null)
  assert.equal(completedOvers('unknown'), null)
})
