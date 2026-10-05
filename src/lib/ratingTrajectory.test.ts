import { describe, expect, it } from 'vitest'
import { collectWalkForwardTrajectory } from './ratingTrajectory'
import type { GameRecord, RankingsData } from './types'

let nextGameId = 1

function makeGame(overrides: Partial<GameRecord>): GameRecord {
  return {
    gameId: String(nextGameId++),
    date: '10/10/26',
    day: 'Sat',
    time: '10:00AM',
    rink: 'Rink',
    type: 'Regular',
    away: 'Us',
    home: 'Opponent',
    awayGoals: 3,
    homeGoals: 2,
    played: true,
    ageLabel: '10U',
    levelLabel: 'A',
    ...overrides,
  }
}

function makeData(divisionsGames: GameRecord[][]): RankingsData {
  return {
    scraped_at: '2026-10-01T00:00:00Z',
    source: 'test',
    ageGroups: {},
    divisions: divisionsGames.map((games, i) => ({
      levelId: i,
      ageLabel: '10U',
      levelLabel: 'A',
      ratingsByType: {},
      teamLinks: {},
      games,
    })),
  }
}

describe('collectWalkForwardTrajectory', () => {
  it('uses only games up to and including each cutoff date, not later ones', () => {
    // Us beats A early (big win), then Opponent-of-interest (B) only ever
    // plays Us once, on an early date -- its rating as of THAT date must
    // not be influenced by games that happen after it.
    const early = makeGame({ away: 'Us', home: 'B', date: '09/01/26', awayGoals: 10, homeGoals: 0 })
    const later = makeGame({ away: 'Us', home: 'C', date: '09/08/26', awayGoals: 10, homeGoals: 0 })
    const data = makeData([[early, later]])
    const trajectory = collectWalkForwardTrajectory(data, 'Us', [early, later])

    expect(trajectory).toHaveLength(2)
    // First point solved from `early` alone (B, Us only) -- C never enters it.
    expect(trajectory[0].opponent).toBe('B')
    // Second point solved from both games -- now includes C's evidence too.
    expect(trajectory[1].opponent).toBe('C')
    expect(trajectory[0].runningRating).not.toEqual(trajectory[1].runningRating)
  })

  it('gives the identical score against the identical opponent different values depending on sample size', () => {
    // The exact scenario reported: same opponent, same scoreline, first
    // and last game of a small season -- must NOT produce identical
    // running ratings, because the first point is a 1-game walk-forward
    // snapshot and the last reflects the team's full (if still small)
    // season to that point.
    const g1 = makeGame({ away: 'Us', home: 'Cougars', date: '09/01/26', awayGoals: 10, homeGoals: 2 })
    const g2 = makeGame({ away: 'Us', home: 'Other', date: '09/08/26', awayGoals: 12, homeGoals: 0 })
    const g3 = makeGame({ away: 'Us', home: 'Cougars', date: '09/15/26', awayGoals: 10, homeGoals: 2 })
    const data = makeData([[g1, g2, g3]])
    const trajectory = collectWalkForwardTrajectory(data, 'Us', [g1, g2, g3])

    expect(trajectory).toHaveLength(3)
    expect(trajectory[0].opponent).toBe('Cougars')
    expect(trajectory[2].opponent).toBe('Cougars')
    expect(trajectory[0].runningRating).not.toBeCloseTo(trajectory[2].runningRating, 2)
  })

  it('resolves each game from the division that actually contains it, by game id', () => {
    const inDivA = makeGame({ away: 'Us', home: 'A', date: '09/01/26' })
    const inDivB = makeGame({ away: 'Us', home: 'B', date: '09/08/26' })
    const data = makeData([[inDivA], [inDivB]])
    const trajectory = collectWalkForwardTrajectory(data, 'Us', [inDivA, inDivB])
    expect(trajectory.map((t) => t.opponent)).toEqual(['A', 'B'])
  })

  it('skips unplayed games and games this team is not in', () => {
    const unplayed = makeGame({ away: 'Us', home: 'A', played: false, awayGoals: null, homeGoals: null })
    const notMine = makeGame({ away: 'X', home: 'Y' })
    const data = makeData([[unplayed, notMine]])
    const trajectory = collectWalkForwardTrajectory(data, 'Us', [unplayed, notMine])
    expect(trajectory).toHaveLength(0)
  })

  it('returns points in chronological order regardless of input order', () => {
    const g1 = makeGame({ away: 'Us', home: 'A', date: '09/01/26' })
    const g2 = makeGame({ away: 'Us', home: 'B', date: '09/08/26' })
    const data = makeData([[g1, g2]])
    const trajectory = collectWalkForwardTrajectory(data, 'Us', [g2, g1])
    expect(trajectory.map((t) => t.game.gameId)).toEqual([g1.gameId, g2.gameId])
  })
})
