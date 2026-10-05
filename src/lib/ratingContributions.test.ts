import { describe, expect, it } from 'vitest'
import { GOAL_CAP, collectGameContributions, collectTrajectory } from './ratingContributions'
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

describe('collectGameContributions', () => {
  it('computes margin from this team perspective and implied value from the opponent current rating', () => {
    const game = makeGame({ away: 'Us', home: 'Opponent', awayGoals: 5, homeGoals: 2 })
    const result = collectGameContributions([game], 'Us', ageGroups({ Opponent: 3 }))
    expect(result).toHaveLength(1)
    expect(result[0].margin).toBe(3) // 5 - 2
    expect(result[0].opponentRating).toBe(3)
    expect(result[0].implied).toBe(6)
  })

  it('computes margin correctly when the team is home instead of away', () => {
    const game = makeGame({ away: 'Opponent', home: 'Us', awayGoals: 1, homeGoals: 4 })
    const result = collectGameContributions([game], 'Us', ageGroups({ Opponent: -2 }))
    expect(result[0].margin).toBe(3) // 4 - 1
    expect(result[0].implied).toBe(1) // -2 + 3
  })

  it('caps the margin at +/-GOAL_CAP', () => {
    const game = makeGame({ away: 'Us', home: 'Opponent', awayGoals: 20, homeGoals: 0 })
    const result = collectGameContributions([game], 'Us', ageGroups({ Opponent: 0 }))
    expect(result[0].margin).toBe(GOAL_CAP)
  })

  it('skips unplayed games and games this team is not actually in', () => {
    const unplayed = makeGame({ away: 'Us', home: 'Opponent', played: false, awayGoals: null, homeGoals: null })
    const notMine = makeGame({ away: 'X', home: 'Y' })
    const result = collectGameContributions([unplayed, notMine], 'Us', ageGroups({ Opponent: 0 }))
    expect(result).toHaveLength(0)
  })

  it('skips a game when the opponent has no known current rating', () => {
    const game = makeGame({ away: 'Us', home: 'Mystery Team' })
    const result = collectGameContributions([game], 'Us', ageGroups({}))
    expect(result).toHaveLength(0)
  })

  it('preserves chronological input order', () => {
    const g1 = makeGame({ away: 'Us', home: 'A', date: '09/01/26' })
    const g2 = makeGame({ away: 'Us', home: 'B', date: '09/08/26' })
    const result = collectGameContributions([g1, g2], 'Us', ageGroups({ A: 0, B: 0 }))
    expect(result.map((c) => c.game.gameId)).toEqual([g1.gameId, g2.gameId])
  })
})

describe('collectTrajectory', () => {
  it('returns an empty trajectory for no contributions', () => {
    expect(collectTrajectory([], 5)).toEqual([])
  })

  it('calibrates so the final point exactly equals the known final rating', () => {
    const games = [
      makeGame({ away: 'Us', home: 'A', awayGoals: 5, homeGoals: 1 }),
      makeGame({ away: 'Us', home: 'B', awayGoals: 2, homeGoals: 2 }),
      makeGame({ away: 'Us', home: 'C', awayGoals: 1, homeGoals: 4 }),
    ]
    const contributions = collectGameContributions(games, 'Us', ageGroups({ A: 1, B: 2, C: -1 }))
    const trajectory = collectTrajectory(contributions, 7.5)
    expect(trajectory).toHaveLength(3)
    expect(trajectory[trajectory.length - 1].runningRating).toBeCloseTo(7.5, 5)
  })

  it('keeps one trajectory point per contribution, in the same order', () => {
    const games = [
      makeGame({ away: 'Us', home: 'A' }),
      makeGame({ away: 'Us', home: 'B' }),
    ]
    const contributions = collectGameContributions(games, 'Us', ageGroups({ A: 0, B: 0 }))
    const trajectory = collectTrajectory(contributions, 0)
    expect(trajectory.map((t) => t.contribution.game.gameId)).toEqual(contributions.map((c) => c.game.gameId))
  })
})
