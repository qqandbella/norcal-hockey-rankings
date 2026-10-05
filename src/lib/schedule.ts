import type { GameRecord, RankingsData } from './types'

/** "MM/DD/YY" + "3:15PM" -> sortable timestamp. Falls back to 0 (sorts
 * first) for anything unparseable rather than throwing. */
export function gameSortKey(game: GameRecord): number {
  const [mm, dd, yy] = game.date.split('/').map(Number)
  if (!mm || !dd || !yy) return 0
  const timeMatch = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(game.time.trim())
  let hour = 0
  let minute = 0
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12
    minute = Number(timeMatch[2])
    if (timeMatch[3].toUpperCase() === 'PM') hour += 12
  }
  return new Date(2000 + yy, mm - 1, dd, hour, minute).getTime()
}

/** Game start as a real Date, or null if the date/time couldn't be parsed
 * (gameSortKey's 0 fallback -- never a real game's timestamp, since every
 * season here is 2000+). */
export function gameStart(game: GameRecord): Date | null {
  const ms = gameSortKey(game)
  return ms > 0 ? new Date(ms) : null
}

/** A team can appear in more than one division's games -- cross-level test
 * games, or a mid-season level move -- so its full schedule has to be
 * aggregated across every division on the site, not just the one the page
 * was reached from. */
export function collectTeamGames(data: RankingsData, teamName: string): GameRecord[] {
  const byId = new Map<string, GameRecord>()
  for (const division of data.divisions) {
    for (const game of division.games) {
      if (game.home === teamName || game.away === teamName) {
        byId.set(game.gameId, game)
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => gameSortKey(a) - gameSortKey(b))
}

export type Outcome = 'win' | 'lose' | 'tie'

/** Outcome for `perspectiveTeam` in this game, or null if unplayed, not
 * yet scored, or `perspectiveTeam` isn't actually in it. */
export function outcomeFor(game: GameRecord, perspectiveTeam: string | undefined): Outcome | null {
  if (!perspectiveTeam || !game.played || game.awayGoals === null || game.homeGoals === null) return null
  const isHome = game.home === perspectiveTeam
  const isAway = game.away === perspectiveTeam
  if (!isHome && !isAway) return null
  const mine = isHome ? game.homeGoals : game.awayGoals
  const theirs = isHome ? game.awayGoals : game.homeGoals
  if (mine > theirs) return 'win'
  if (mine < theirs) return 'lose'
  return 'tie'
}
