/**
 * TypeScript port of `compute_ratings` in scripts/ratings.py -- used ONLY
 * by the season-trajectory chart (see ratingTrajectory.ts) to re-solve a
 * division's ratings as of an earlier date, so an early-season point
 * reflects what was actually knowable then rather than today's fully-
 * matured opponent ratings. The site's own real ratings (shipped in
 * latest.json) are computed exclusively by the Python original; this
 * never feeds back into them. Keep in sync with ratings.py's
 * compute_ratings if its math changes -- cross-checked in
 * computeRatings.test.ts against real Python output for a fixed fixture
 * (scripts/test_ratings.py's TEN_U_B_GAMES).
 *
 * Deliberately omits rank/tier assignment (_assign_tiers) -- the
 * trajectory only needs the numeric rating.
 */

export const GOAL_CAP = 7
const SHRINKAGE_K = 3.0
const MIN_SHRINKAGE_RATIO = 0.1
const MAX_SHRINKAGE_RATIO = 8.0
const REFERENCE_VARIANCE = (2 * GOAL_CAP) ** 2 / 12
const MAX_ITERS = 300
const CONVERGENCE_EPS = 1e-9

export interface RatingGame {
  home: string
  away: string
  homeGoals: number
  awayGoals: number
}

function cappedMargin(homeGoals: number, awayGoals: number): number {
  return Math.max(-GOAL_CAP, Math.min(GOAL_CAP, homeGoals - awayGoals))
}

function pvariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
}

/** Centered, shrinkage-regularized rating for every team appearing in
 * `games` -- same Jacobi iteration as the Python original, same
 * convergence criteria, same rounding (3 decimals). */
export function computeRatings(games: RatingGame[]): Record<string, number> {
  const teams = new Set<string>()
  for (const g of games) {
    teams.add(g.home)
    teams.add(g.away)
  }
  if (teams.size === 0) return {}

  const adjacency = new Map<string, { opp: string; margin: number }[]>()
  for (const t of teams) adjacency.set(t, [])
  for (const g of games) {
    const margin = cappedMargin(g.homeGoals, g.awayGoals)
    adjacency.get(g.home)!.push({ opp: g.away, margin })
    adjacency.get(g.away)!.push({ opp: g.home, margin: -margin })
  }

  let rating = new Map<string, number>(Array.from(teams, (t) => [t, 0]))
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const next = new Map<string, number>()
    let maxDelta = 0
    for (const t of teams) {
      const oppGames = adjacency.get(t)!
      const n = oppGames.length
      const implied = oppGames.map(({ opp, margin }) => rating.get(opp)! + margin)
      let k = SHRINKAGE_K
      if (n >= 2) {
        const ratio = pvariance(implied) / REFERENCE_VARIANCE
        k = SHRINKAGE_K * Math.max(MIN_SHRINKAGE_RATIO, Math.min(MAX_SHRINKAGE_RATIO, ratio))
      }
      const sum = implied.reduce((a, b) => a + b, 0)
      const value = sum / (n + k)
      next.set(t, value)
      maxDelta = Math.max(maxDelta, Math.abs(value - rating.get(t)!))
    }
    rating = next
    if (maxDelta < CONVERGENCE_EPS) break
  }

  const mean = Array.from(rating.values()).reduce((a, b) => a + b, 0) / rating.size
  const centered: Record<string, number> = {}
  for (const [t, v] of rating) centered[t] = Math.round((v - mean) * 1000) / 1000
  return centered
}
