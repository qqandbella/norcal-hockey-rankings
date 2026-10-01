import { estimateDrive } from './rinks'
import { collectTeamGames, gameStart } from './schedule'
import type { GameRecord, RankingsData } from './types'

/** Typical youth hockey time commitment at the rink -- arrival through
 * puck-drop-to-buzzer through gear-off, not just on-ice clock time. */
export const GAME_DURATION_MINUTES = 90

/** Minimum spare time wanted beyond the estimated drive before a
 * back-to-back is called "tight" rather than clean -- parking, changing,
 * warmup at the second rink. */
export const ARRIVAL_BUFFER_MINUTES = 20

export type ConflictSeverity = 'overlap' | 'tight'

export interface ScheduleConflict {
  date: string
  earlierGame: GameRecord
  earlierTeam: string
  laterGame: GameRecord
  laterTeam: string
  /** Minutes between the earlier game's estimated end and the later
   * game's start -- negative if the games actually overlap. */
  gapMinutes: number
  /** Estimated drive time/distance between the two rinks, or null if
   * either rink's location isn't in `RINK_LOCATIONS` (still flagged as a
   * same-day double-booking, just without a distance-based verdict). */
  driveMinutes: number | null
  driveMiles: number | null
  severity: ConflictSeverity
}

function groupByDate(games: GameRecord[]): Map<string, GameRecord[]> {
  const byDate = new Map<string, GameRecord[]>()
  for (const g of games) {
    const list = byDate.get(g.date) ?? []
    list.push(g)
    byDate.set(g.date, list)
  }
  return byDate
}

function pairConflict(
  gameX: GameRecord,
  teamX: string,
  gameY: GameRecord,
  teamY: string,
  date: string,
): ScheduleConflict | null {
  const startX = gameStart(gameX)
  const startY = gameStart(gameY)
  if (!startX || !startY) return null

  const xIsEarlier = startX.getTime() <= startY.getTime()
  const earlierGame = xIsEarlier ? gameX : gameY
  const earlierTeam = xIsEarlier ? teamX : teamY
  const laterGame = xIsEarlier ? gameY : gameX
  const laterTeam = xIsEarlier ? teamY : teamX
  const earlierStart = xIsEarlier ? startX : startY
  const laterStart = xIsEarlier ? startY : startX

  const earlierEndMs = earlierStart.getTime() + GAME_DURATION_MINUTES * 60_000
  const gapMinutes = Math.round((laterStart.getTime() - earlierEndMs) / 60_000)

  const drive = estimateDrive(earlierGame.rink, laterGame.rink)
  const requiredMinutes = (drive?.minutes ?? 0) + ARRIVAL_BUFFER_MINUTES

  if (gapMinutes >= requiredMinutes) return null

  return {
    date,
    earlierGame,
    earlierTeam,
    laterGame,
    laterTeam,
    gapMinutes,
    driveMinutes: drive?.minutes ?? null,
    driveMiles: drive?.miles ?? null,
    severity: gapMinutes < 0 ? 'overlap' : 'tight',
  }
}

/**
 * Finds every same-day pair of games -- one from each team's full,
 * cross-division schedule -- where the gap between them, accounting for
 * estimated drive time between rinks, is too tight for one person to
 * realistically attend both. `teamA`/`teamB` are usually two different
 * teams the same family follows (e.g. siblings), not necessarily
 * division rivals, so every same-day pairing is checked, including each
 * team's own doubleheaders. Sorted chronologically.
 */
export function findScheduleConflicts(
  data: RankingsData,
  teamA: string,
  teamB: string,
): ScheduleConflict[] {
  const byDateA = groupByDate(collectTeamGames(data, teamA))
  const byDateB = groupByDate(collectTeamGames(data, teamB))
  const conflicts: ScheduleConflict[] = []

  for (const [date, dayGamesA] of byDateA) {
    const dayGamesB = byDateB.get(date)
    if (!dayGamesB) continue
    for (const gameA of dayGamesA) {
      for (const gameB of dayGamesB) {
        if (gameA.gameId === gameB.gameId) continue
        const conflict = pairConflict(gameA, teamA, gameB, teamB, date)
        if (conflict) conflicts.push(conflict)
      }
    }
  }

  return conflicts.sort((a, b) => {
    const aStart = gameStart(a.earlierGame)?.getTime() ?? 0
    const bStart = gameStart(b.earlierGame)?.getTime() ?? 0
    return aStart - bStart
  })
}
