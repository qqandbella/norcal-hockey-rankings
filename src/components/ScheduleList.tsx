import { useState } from 'react'
import type { GameRecord } from '../lib/types'

function scoreLabel(game: GameRecord): string {
  if (!game.played || game.awayGoals === null || game.homeGoals === null) return 'Scheduled'
  return `${game.awayGoals} - ${game.homeGoals}`
}

export function ScheduleList({ games }: { games: GameRecord[] }) {
  const [open, setOpen] = useState(false)
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
                <td>{game.away}</td>
                <td>{game.home}</td>
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
