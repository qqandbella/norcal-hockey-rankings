import { useState } from 'react'
import { Link } from 'react-router-dom'
import { teamRoute } from '../lib/grouping'
import type { Division, GameRecord } from '../lib/types'

type Outcome = 'win' | 'lose' | 'tie'
type ResultFilter = 'all' | 'win' | 'lose' | 'winOrTie'

const RESULT_FILTER_LABEL: Record<ResultFilter, string> = {
  all: 'All results',
  win: 'Win only',
  lose: 'Lose only',
  winOrTie: 'Win or tie',
}

function scoreLabel(game: GameRecord): string {
  if (!game.played || game.awayGoals === null || game.homeGoals === null) return 'Scheduled'
  return `${game.awayGoals} - ${game.homeGoals}`
}

/** Outcome for `perspectiveTeam` in this game, or null if unplayed / team isn't in it. */
function outcomeFor(game: GameRecord, perspectiveTeam: string | undefined): Outcome | null {
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

function matchesFilter(outcome: Outcome | null, filter: ResultFilter): boolean {
  if (filter === 'all') return true
  if (outcome === null) return false
  if (filter === 'win') return outcome === 'win'
  if (filter === 'lose') return outcome === 'lose'
  return outcome === 'win' || outcome === 'tie'
}

interface ScheduleListProps {
  games: GameRecord[]
  division: Pick<Division, 'ageLabel' | 'levelLabel'>
  startOpen?: boolean
  /** When set, highlights this team's name and color-codes each row by its result. */
  perspectiveTeam?: string
}

export function ScheduleList({ games, division, startOpen = false, perspectiveTeam }: ScheduleListProps) {
  const [open, setOpen] = useState(startOpen)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')

  const visibleGames = perspectiveTeam
    ? games.filter((g) => matchesFilter(outcomeFor(g, perspectiveTeam), resultFilter))
    : games
  const played = visibleGames.filter((g) => g.played)
  const upcoming = visibleGames.filter((g) => !g.played)

  return (
    <div className="schedule">
      <div className="schedule__controls">
        <button type="button" className="schedule__toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide schedule' : `Show schedule (${played.length} played, ${upcoming.length} upcoming)`}
        </button>
        {open && perspectiveTeam && (
          <label className="schedule__filter">
            Result
            <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as ResultFilter)}>
              {(Object.keys(RESULT_FILTER_LABEL) as ResultFilter[]).map((f) => (
                <option key={f} value={f}>
                  {RESULT_FILTER_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {open && (
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Away</th>
              <th>Home</th>
              <th>Score</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {visibleGames.map((game) => {
              const outcome = outcomeFor(game, perspectiveTeam)
              const rowClass = [
                !game.played && 'schedule-table__upcoming',
                outcome && `schedule-table__row--${outcome}`,
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <tr key={game.gameId} className={rowClass || undefined}>
                  <td>{game.date}</td>
                  <td>{game.time}</td>
                  <td className={game.away === perspectiveTeam ? 'schedule-table__me' : undefined}>
                    <Link to={teamRoute(division, game.away)}>{game.away}</Link>
                  </td>
                  <td className={game.home === perspectiveTeam ? 'schedule-table__me' : undefined}>
                    <Link to={teamRoute(division, game.home)}>{game.home}</Link>
                  </td>
                  <td>{scoreLabel(game)}</td>
                  <td>{game.type}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
