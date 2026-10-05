import type { AgeGroupRatings, GameRecord } from './types'

// Mirrors scripts/ratings.py's own goal cap -- keep in sync if it changes.
export const GOAL_CAP = 7

function cappedMargin(myGoals: number, theirGoals: number): number {
  return Math.max(-GOAL_CAP, Math.min(GOAL_CAP, myGoals - theirGoals))
}

export interface TrajectoryPoint {
  game: GameRecord
  opponent: string
  /** The opponent's CURRENT (today's, fully converged) rating -- not an
   * as-of-date re-derivation, see module doc for why. */
  opponentRating: number
  /** This team's own running rating after this game (and every game
   * before it), using today's opponent ratings throughout. */
  runningRating: number
}

/**
 * A running, game-by-game rating trajectory for one team: a plain
 * (unshrunk) running mean of each played game's implied value (today's
 * opponent rating + that game's capped margin), calibrated so the final
 * point lands exactly on the team's known-correct current rating.
 *
 * Deliberately uses each opponent's CURRENT rating throughout, not a
 * walk-forward re-derivation of what the opponent's rating was as of
 * that date (an earlier version of this chart did exactly that, porting
 * scripts/ratings.py's solver to re-solve each division at every cutoff
 * -- removed, see below). A team's rating trajectory is shaped by three
 * things: (1) small-sample noise early in the season, (2) game-to-game
 * performance variance, and (3) genuine developmental-pace differences
 * between teams over the season. Walk-forward only buys a more accurate
 * read of (3) -- and pays for it by reintroducing (1) at every single
 * cutoff: an opponent's as-of-date rating, computed from whatever handful
 * of division games had been played by then, is itself barely more
 * trustworthy than the team's own early rating, so walk-forward was
 * compounding noise on noise. With a short season (few games/team) and
 * peer teams developing at roughly the same pace -- especially true
 * early season -- (3) is small relative to the stability a fully-mature,
 * many-games current rating gives every opponent lookup. Using today's
 * ratings throughout trades a small, mostly-irrelevant bias for a large
 * reduction in variance -- the better trade here.
 */
export function collectTrajectory(
  teamGames: GameRecord[],
  teamName: string,
  ageGroups: Record<string, AgeGroupRatings>,
  finalRating: number,
  ratingMode: 'classic' | 'experimental' = 'classic',
): TrajectoryPoint[] {
  const implied: number[] = []
  const points: Omit<TrajectoryPoint, 'runningRating'>[] = []

  for (const game of teamGames) {
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
    implied.push(opponentRating + margin)
    points.push({ game, opponent, opponentRating })
  }

  if (points.length === 0) return []

  const raw: number[] = []
  let sum = 0
  implied.forEach((v, i) => {
    sum += v
    raw.push(sum / (i + 1))
  })
  const calibration = finalRating - raw[raw.length - 1]

  return points.map((point, i) => ({
    ...point,
    runningRating: Math.round((raw[i] + calibration) * 1000) / 1000,
  }))
}

