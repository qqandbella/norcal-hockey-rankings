import { describe, expect, it } from 'vitest'
import { GOAL_CAP, collectTrajectory } from './ratingTrajectory'
import type { AgeGroupRatings, GameRecord } from './types'

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

function ageGroups(ratings: Record<string, number>): Record<string, AgeGroupRatings> {
  const teams = Object.fromEntries(Object.entries(ratings).map(([name, rating]) => [name, { rating, gamesPlayed: 5 }]))
  return { '10U': { teams, tierOffsets: {}, experimentalTeams: {}, experimentalTierOffsets: {} } }
}

describe('collectTrajectory', () => {
  it('computes margin from this team perspective and implied value from the opponent current rating', () => {
    const game = makeGame({ away: 'Us', home: 'Opponent', awayGoals: 5, homeGoals: 2 })
    const trajectory = collectTrajectory([game], 'Us', ageGroups({ Opponent: 3 }), 6)
    expect(trajectory).toHaveLength(1)
    // implied = opponentRating(3) + margin(5-2=3) = 6; calibrated to equal finalRating (6) exactly.
    expect(trajectory[0].opponentRating).toBe(3)
    expect(trajectory[0].runningRating).toBeCloseTo(6, 5)
  })

  it('computes margin correctly when the team is home instead of away', () => {
    const game = makeGame({ away: 'Opponent', home: 'Us', awayGoals: 1, homeGoals: 4 })
    const trajectory = collectTrajectory([game], 'Us', ageGroups({ Opponent: -2 }), 1)
    expect(trajectory[0].opponentRating).toBe(-2)
    expect(trajectory[0].runningRating).toBeCloseTo(1, 5) // implied = -2 + 3 = 1, calibration no-op
  })

  it('caps the margin at +/-GOAL_CAP', () => {
    // A 20-0 blowout should rate identically to a capped 7-0 win.
    const blowout = makeGame({ away: 'Us', home: 'Opponent', awayGoals: 20, homeGoals: 0 })
    const capped = makeGame({ away: 'Us', home: 'Opponent', awayGoals: 7, homeGoals: 0 })
    const t1 = collectTrajectory([blowout], 'Us', ageGroups({ Opponent: 0 }), 0)
    const t2 = collectTrajectory([capped], 'Us', ageGroups({ Opponent: 0 }), 0)
    expect(t1[0].runningRating).toBeCloseTo(t2[0].runningRating, 5)
    expect(GOAL_CAP).toBe(7)
  })

  it('skips unplayed games and games this team is not actually in', () => {
    const unplayed = makeGame({ away: 'Us', home: 'Opponent', played: false, awayGoals: null, homeGoals: null })
    const notMine = makeGame({ away: 'X', home: 'Y' })
    const trajectory = collectTrajectory([unplayed, notMine], 'Us', ageGroups({ Opponent: 0 }), 0)
    expect(trajectory).toHaveLength(0)
  })

  it('skips a game when the opponent has no known current rating', () => {
    const game = makeGame({ away: 'Us', home: 'Mystery Team' })
    const trajectory = collectTrajectory([game], 'Us', ageGroups({}), 0)
    expect(trajectory).toHaveLength(0)
  })

  it('preserves chronological input order', () => {
    const g1 = makeGame({ away: 'Us', home: 'A', date: '09/01/26' })
    const g2 = makeGame({ away: 'Us', home: 'B', date: '09/08/26' })
    const trajectory = collectTrajectory([g1, g2], 'Us', ageGroups({ A: 0, B: 0 }), 0)
    expect(trajectory.map((t) => t.game.gameId)).toEqual([g1.gameId, g2.gameId])
  })

  it('returns an empty trajectory for no eligible games', () => {
    expect(collectTrajectory([], 'Us', ageGroups({}), 5)).toEqual([])
  })

  it('calibrates so the final point exactly equals the known final rating', () => {
    const games = [
      makeGame({ away: 'Us', home: 'A', awayGoals: 5, homeGoals: 1 }),
      makeGame({ away: 'Us', home: 'B', awayGoals: 2, homeGoals: 2 }),
      makeGame({ away: 'Us', home: 'C', awayGoals: 1, homeGoals: 4 }),
    ]
    const trajectory = collectTrajectory(games, 'Us', ageGroups({ A: 1, B: 2, C: -1 }), 7.5)
    expect(trajectory).toHaveLength(3)
    expect(trajectory[trajectory.length - 1].runningRating).toBeCloseTo(7.5, 5)
  })

  it('gives different running ratings for identical score/opponent at different points in a small sample', () => {
    // The reported scenario: the SAME opponent, SAME scoreline, as both
    // the first and last played game -- the running mean at n=1 and n=3
    // must differ, since the 2nd game shifts the average in between.
    const g1 = makeGame({ away: 'Us', home: 'Cougars', date: '09/01/26', awayGoals: 10, homeGoals: 2 })
    const g2 = makeGame({ away: 'Us', home: 'Other', date: '09/08/26', awayGoals: 12, homeGoals: 0 })
    const g3 = makeGame({ away: 'Us', home: 'Cougars', date: '09/15/26', awayGoals: 10, homeGoals: 2 })
    const trajectory = collectTrajectory([g1, g2, g3], 'Us', ageGroups({ Cougars: 24, Other: 20 }), 28.542)
    expect(trajectory[0].runningRating).not.toBeCloseTo(trajectory[2].runningRating, 2)
    // Both should be close to the naive "opponent rating + margin" ballpark
    // (24 + 7 = 31), not shrunk to a small fraction of it.
    expect(trajectory[0].runningRating).toBeGreaterThan(20)
  })
})
