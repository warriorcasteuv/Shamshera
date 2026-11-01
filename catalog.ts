import type { SportEvent, SportId } from './types.ts'
export const SPORTS: { id: SportId; label: string; hint: string }[] = [
  { id: 'cricket', label: 'Cricket', hint: 'T20 & ODIs' },
  { id: 'football', label: 'Football', hint: 'Leagues' },
  { id: 'tennis', label: 'Tennis', hint: 'Singles' },
  { id: 'basketball', label: 'Basketball', hint: 'Pro cups' },
]
const m = (
  id: string,
  name: string,
  runners: { id: string; name: string; back: number; lay: number }[],
) => ({ id, name, runners })
export const EVENTS: SportEvent[] = [
  {
    id: 'c1',
    sport: 'cricket',
    competition: 'Shera Premier League',
    name: 'Mumbai Titans vs Bengaluru Strikers',
    startLabel: 'In-play',
    inPlay: true,
    markets: [
      m('c1-mo', 'Match Odds', [
        { id: 'mt', name: 'Mumbai Titans', back: 1.84, lay: 1.86 },
        { id: 'bs', name: 'Bengaluru Strikers', back: 2.12, lay: 2.16 },
      ]),
      m('c1-toss', 'Toss Winner', [
        { id: 'mt-t', name: 'Mumbai Titans', back: 1.92, lay: 1.96 },
        { id: 'bs-t', name: 'Bengaluru Strikers', back: 1.92, lay: 1.96 },
      ]),
    ],
  },
  {
    id: 'c2',
    sport: 'cricket',
    competition: 'Shera Premier League',
    name: 'Delhi Hawks vs Hyderabad Blaze',
    startLabel: 'In-play',
    inPlay: true,
    markets: [
      m('c2-mo', 'Match Odds', [
        { id: 'dh', name: 'Delhi Hawks', back: 2.38, lay: 2.44 },
        { id: 'hb', name: 'Hyderabad Blaze', back: 1.62, lay: 1.66 },
      ]),
    ],
  },
  {
    id: 'c3',
    sport: 'cricket',
    competition: 'Continental Cup',
    name: 'India A vs Australia A',
    startLabel: 'Today 19:30',
    inPlay: false,
    markets: [
      m('c3-mo', 'Match Odds', [
        { id: 'ind', name: 'India A', back: 1.72, lay: 1.75 },
        { id: 'aus', name: 'Australia A', back: 2.22, lay: 2.28 },
      ]),
      m('c3-top', 'Top Batter Special', [
        { id: 'p1', name: 'R. Mehta', back: 4.5, lay: 4.8 },
        { id: 'p2', name: 'J. Walker', back: 5.2, lay: 5.6 },
        { id: 'p3', name: 'A. Khan', back: 6.0, lay: 6.4 },
      ]),
    ],
  },
  {
    id: 'c4',
    sport: 'cricket',
    competition: 'Island T20',
    name: 'Colombo Kings vs Kandy Lions',
    startLabel: 'Tomorrow 15:00',
    inPlay: false,
    markets: [
      m('c4-mo', 'Match Odds', [
        { id: 'ck', name: 'Colombo Kings', back: 1.95, lay: 1.99 },
        { id: 'kl', name: 'Kandy Lions', back: 1.9, lay: 1.94 },
      ]),
    ],
  },
  {
    id: 'f1',
    sport: 'football',
    competition: 'Euro Club Cup',
    name: 'Northgate FC vs Riverport United',
    startLabel: 'In-play 62’',
    inPlay: true,
    markets: [
      m('f1-1x2', 'Full Time', [
        { id: 'ng', name: 'Northgate FC', back: 2.7, lay: 2.78 },
        { id: 'dr', name: 'Draw', back: 3.25, lay: 3.35 },
        { id: 'ru', name: 'Riverport United', back: 2.64, lay: 2.72 },
      ]),
      m('f1-btts', 'Both Teams To Score', [
        { id: 'yes', name: 'Yes', back: 1.78, lay: 1.82 },
        { id: 'no', name: 'No', back: 2.1, lay: 2.16 },
      ]),
    ],
  },
  {
    id: 'f2',
    sport: 'football',
    competition: 'Metro League',
    name: 'City Wolves vs East End Athletic',
    startLabel: 'Today 21:00',
    inPlay: false,
    markets: [
      m('f2-1x2', 'Full Time', [
        { id: 'cw', name: 'City Wolves', back: 1.68, lay: 1.71 },
        { id: 'd', name: 'Draw', back: 3.8, lay: 3.95 },
        { id: 'ee', name: 'East End Athletic', back: 5.2, lay: 5.4 },
      ]),
    ],
  },
  {
    id: 'f3',
    sport: 'football',
    competition: 'Metro League',
    name: 'Harbour SC vs Hillside Town',
    startLabel: 'Sat 18:00',
    inPlay: false,
    markets: [
      m('f3-1x2', 'Full Time', [
        { id: 'hs', name: 'Harbour SC', back: 2.14, lay: 2.2 },
        { id: 'd', name: 'Draw', back: 3.3, lay: 3.4 },
        { id: 'ht', name: 'Hillside Town', back: 3.45, lay: 3.55 },
      ]),
    ],
  },
  {
    id: 't1',
    sport: 'tennis',
    competition: 'Coast Open',
    name: 'N. Alvarez vs P. Singh',
    startLabel: 'In-play Set 2',
    inPlay: true,
    markets: [
      m('t1-mw', 'Match Winner', [
        { id: 'na', name: 'N. Alvarez', back: 1.55, lay: 1.58 },
        { id: 'ps', name: 'P. Singh', back: 2.56, lay: 2.62 },
        ]),
    ],
  },
  {
    id: 't2',
    sport: 'tennis',
    competition: 'Coast Open',
    name: 'M. Rossi vs K. Berg',
    startLabel: 'Tomorrow 11:00',
    inPlay: false,
    markets: [
      m('t2-mw', 'Match Winner', [
        { id: 'mr', name: 'M. Rossi', back: 1.9, lay: 1.94 },
        { id: 'kb', name: 'K. Berg', back: 2.0, lay: 2.04 },
      ]),
    ],
  },
  {
    id: 'b1',
    sport: 'basketball',
    competition: 'Pacific Cup',
    name: 'Seaboard Jets vs Metro Owls',
    startLabel: 'In-play Q3',
    inPlay: true,
    markets: [
      m('b1-ml', 'Moneyline', [
        { id: 'sj', name: 'Seaboard Jets', back: 1.7, lay: 1.74 },
        { id: 'mo', name: 'Metro Owls', back: 2.2, lay: 2.26 },
      ]),
    ],
  },
  {
    id: 'b2',
    sport: 'basketball',
    competition: 'Pacific Cup',
    name: 'Canyon Foxes vs Lake Lions',
    startLabel: 'Tonight 08:30',
    inPlay: false,
    markets: [
      m('b2-ml', 'Moneyline', [
        { id: 'cf', name: 'Canyon Foxes', back: 1.48, lay: 1.51 },
        { id: 'll', name: 'Lake Lions', back: 2.72, lay: 2.8 },
      ]),
    ],
  },
]
export function sportLabel(id: SportId) {
  return SPORTS.find((s) => s.id === id)?.label ?? id
}