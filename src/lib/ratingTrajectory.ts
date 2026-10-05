import { computeRatings } from './computeRatings'
import type { RatingGame } from './computeRatings'
import { gameSortKey } from './schedule'
import type { GameRecord, RankingsData } from './types'

export { GOAL_CAP } from './computeRatings'

export interface TrajectoryPoint {
  game: GameRecord
  opponent: string
  /** The opponent's own rating as of this exact date -- re-solved from
   * scratch (see computeRatings), not looked up from today's final
   * numbers. */
  opponentRating: number
  /** This team's own rating as of this exact date, from the same re-solve
   * -- a true walk-forward snapshot: "what would my rating have been if
   * the season had stopped here," using only what was knowable then. */
  runningRating: number
}

function toRatingGame(g: GameRecord): RatingGame {
  return { home: g.home, away: g.away, homeGoals: g.homeGoals!, awayGoals: g.awayGoals! }
}

/**
 * A true walk-forward rating trajectory for one team: at each of its
 * played games, re-solves the CONTAINING DIVISION's ratings (computeRatings,
 * an exact port of scripts/ratings.py's compute_ratings -- see
 * computeRatings.test.ts for cross-validation against the real Python
 * output) using only that division's games up to and including that date.
 *
 * This exists specifically because the simpler alternative -- averaging
 * each game's (today's opponent rating + capped margin) -- applies
 * knowledge from the rest of the season backward onto early games: an
 * opponent's CURRENT rating reflects games played long after this one, so
 * "today's opponent rating" isn't what was actually knowable at the time.
 * Confirmed concretely: San Jose Jr Sharks 10A-1's first and fourth played
 * games were both identical 10-2 wins over the same opponent, yet a
 * today's-ratings approximation showed wildly different values for the
 * two points -- an artifact of mixing time periods, not a real signal.
 * Walk-forward removes that mixing entirely: every number in a given
 * point is computed from games that had actually been played by that
 * date, nothing later.
 *
 * Deliberately scoped to ONLY this chart -- scripts/ratings.py and the
 * site's own real ratings (shipped in latest.json) are untouched; this
 * re-solve happens entirely client-side, from data already shipped, and
 * never feeds back into the official numbers.
 *
 * A division is identified per-game by TTS game id (not by the game's own
 * `levelLabel` text, which can name a division that no longer exists as
 * its own page once a legacy level gets split -- see teamRoute's doc
 * comment for the same lesson learned the hard way). Each point's
 * `runningRating`/`opponentRating` are this WITHIN-division classic
 * rating as of that date -- not the cross-division unified number shown
 * elsewhere on the team page, since replicating the full unified/tier-
 * offset pipeline walk-forward is out of scope here (see module caption
 * in RatingChart.tsx). For a team that's only ever played within one
 * division, the two numbers are usually close; for a heavily cross-
 * tested team, they can diverge -- the chart's caption says so.
 */
export function collectWalkForwardTrajectory(data: RankingsData, teamName: string, teamGames: GameRecord[]): TrajectoryPoint[] {
  const played = teamGames
    .filter((g) => g.played && g.homeGoals !== null && g.awayGoals !== null && (g.home === teamName || g.away === teamName))
    .sort((a, b) => gameSortKey(a) - gameSortKey(b))

  const points: TrajectoryPoint[] = []
  for (const game of played) {
    const division = data.divisions.find((d) => d.games.some((g) => g.gameId === game.gameId))
    if (!division) continue

    const cutoff = gameSortKey(game)
    const cutoffGames = division.games
      .filter((g) => g.played && g.homeGoals !== null && g.awayGoals !== null && gameSortKey(g) <= cutoff)
      .map(toRatingGame)

    const solved = computeRatings(cutoffGames)
    const myRating = solved[teamName]
    if (myRating === undefined) continue

    const isHome = game.home === teamName
    const opponent = isHome ? game.away : game.home
    const opponentRating = solved[opponent]
    if (opponentRating === undefined) continue

    points.push({ game, opponent, opponentRating, runningRating: myRating })
  }
  return points
}
