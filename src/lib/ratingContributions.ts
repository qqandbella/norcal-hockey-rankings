import type { AgeGroupRatings, GameRecord } from './types'

// Mirrors scripts/ratings.py's own goal cap -- keep in sync if it changes.
export const GOAL_CAP = 7

function cappedMargin(myGoals: number, theirGoals: number): number {
  return Math.max(-GOAL_CAP, Math.min(GOAL_CAP, myGoals - theirGoals))
}

export interface GameContribution {
  game: GameRecord
  opponent: string
  /** Capped goal differential from this team's own perspective. */
  margin: number
  /** The opponent's current (today's, fully converged) unified rating. */
  opponentRating: number
  /** opponentRating + margin -- what this one game, valued at the
   * opponent's current strength, implies this team's rating should be. */
  implied: number
}

/**
 * Every played game's rating contribution for one team, in chronological
 * order. Reuses each opponent's CURRENT unified rating (already computed
 * and shipped in `ageGroups`) rather than re-deriving what the opponent's
 * strength was as of that date -- cheap (no re-solving), and it's exactly
 * the quantity `compute_ratings` itself averages over (see scripts/
 * ratings.py), just not centered/shrunk the way the official rating is.
 * Skips a game if it's unplayed, has no score, or the opponent has no
 * known current rating (e.g. a team with zero rated games of its own).
 */
export function collectGameContributions(
  games: GameRecord[],
  teamName: string,
  ageGroups: Record<string, AgeGroupRatings>,
  ratingMode: 'classic' | 'experimental' = 'classic',
): GameContribution[] {
  const contributions: GameContribution[] = []
  for (const game of games) {
    if (!game.played || game.homeGoals === null || game.awayGoals === null) continue
    const isHome = game.home === teamName
    const isAway = game.away === teamName
    if (!isHome && !isAway) continue
    const opponent = isHome ? game.away : game.home
    const myGoals = isHome ? game.homeGoals : game.awayGoals
    const theirGoals = isHome ? game.awayGoals : game.homeGoals

    const group = ageGroups[game.ageLabel]
    const teams = ratingMode === 'experimental' ? group?.experimentalTeams : group?.teams
    const opponentRating = teams?.[opponent]?.rating
    if (opponentRating === undefined) continue

    const margin = cappedMargin(myGoals, theirGoals)
    contributions.push({ game, opponent, margin, opponentRating, implied: opponentRating + margin })
  }
  return contributions
}

export interface TrajectoryPoint {
  contribution: GameContribution
  /** This team's own running rating after this game (and every game
   * before it), using today's opponent ratings throughout. */
  runningRating: number
}

/**
 * A running, game-by-game rating trajectory for one team -- "how would my
 * rating have looked after each game, if every opponent were valued at
 * today's strength the whole time." A **plain, unshrunk running mean** of
 * `implied` (opponent rating + capped margin) over the games so far --
 * deliberately NOT the official model's ridge-shrinkage formula (see
 * scripts/ratings.py's compute_ratings): that formula divides by `n+k`
 * (k=3.0 flat for a single game), which makes an early point look far
 * more conservative than simply "today's opponent rating + this game's
 * margin" -- confirmed confusing in practice (a team's very first game
 * read as barely a quarter of its implied value). This chart is already
 * an approximation (opponent ratings aren't re-solved as of each date,
 * see below), so matching naive per-game intuition beats mirroring a
 * regularization term out of context. Calibrated so the final point lands
 * exactly on `finalRating` (the one number known to be correct): the
 * whole uncalibrated curve is shifted by the gap between its own last
 * point and `finalRating`, since this simplified running mean isn't
 * centered/unified the same way the official rating is.
 *
 * Also NOT a true walk-forward re-derivation (that would need re-solving
 * the whole division's ratings as of each date, same technique scripts/
 * backtest.py uses for validation, not implemented here) -- opponent
 * ratings are held at their final values throughout, so this shows
 * accumulation of evidence, not a historically accurate snapshot.
 */
export function collectTrajectory(contributions: GameContribution[], finalRating: number): TrajectoryPoint[] {
  if (contributions.length === 0) return []
  const raw: number[] = []
  let sum = 0
  contributions.forEach((c, i) => {
    sum += c.implied
    raw.push(sum / (i + 1))
  })
  const calibration = finalRating - raw[raw.length - 1]
  return contributions.map((contribution, i) => ({
    contribution,
    runningRating: Math.round((raw[i] + calibration) * 1000) / 1000,
  }))
}
