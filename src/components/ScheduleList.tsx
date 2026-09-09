import { useState } from 'react'
import { Link } from 'react-router-dom'
import { teamRoute } from '../lib/grouping'
import type { Division, GameRecord } from '../lib/types'

function scoreLabel(game: GameRecord): string {
  if (!game.played || game.awayGoals === null || game.homeGoals === null) return 'Scheduled'
  return `${game.awayGoals} - ${game.homeGoals}`
}

interface ScheduleListProps {
  games: GameRecord[]
  division: Pick<Division, 'ageLabel' | 'levelLabel'>
  startOpen?: boolean
}

export function ScheduleList({ games, division, startOpen = false }: ScheduleListProps) {
  const [open, setOpen] = useState(startOpen)
  const played = games.filter((g) => g.played)
  const upcoming = games.filter((g) => !g.played)

  return (
    <div className="schedule">
      <button type="button" className="schedule__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide schedule' : `Show schedule (${played.length} played, ${upcoming.length} upcoming)`}
      </button>
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
            {games.map((game) => (
              <tr key={game.gameId} className={game.played ? undefined : 'schedule-table__upcoming'}>
                <td>{game.date}</td>
                <td>{game.time}</td>
                <td>
                  <Link to={teamRoute(division, game.away)}>{game.away}</Link>
                </td>
                <td>
                  <Link to={teamRoute(division, game.home)}>{game.home}</Link>
                </td>
                <td>{scoreLabel(game)}</td>
                <td>{game.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
