import { Link, useParams } from 'react-router-dom'
import { divisionRoute } from '../lib/grouping'
import type { Division } from '../lib/types'
import { ALL_TYPES } from '../lib/types'
import { ScheduleList } from './ScheduleList'

export function TeamPage({ division }: { division: Division }) {
  const { team: encodedTeam } = useParams()
  const teamName = encodedTeam ? decodeURIComponent(encodedTeam) : ''
  const teamGames = division.games.filter((g) => g.home === teamName || g.away === teamName)
  const row = division.ratingsByType[ALL_TYPES]?.teams.find((t) => t.name === teamName)

  if (teamGames.length === 0) {
    return <p className="empty-state">No games found for {teamName}.</p>
  }

  return (
    <section>
      <p>
        <Link to={divisionRoute(division)}>&larr; {division.ageLabel} {division.levelLabel} rankings</Link>
      </p>
      <h2>{teamName}</h2>

      {row ? (
        <dl className="team-stats">
          <div>
            <dt>Rating</dt>
            <dd>{row.rating > 0 ? `+${row.rating}` : row.rating}</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd>
              #{row.rank} ({row.tier})
            </dd>
          </div>
          <div>
            <dt>Record</dt>
            <dd>
              {row.wins}-{row.losses}-{row.ties} ({row.points} pts)
            </dd>
          </div>
          <div>
            <dt>GF / GA / GD</dt>
            <dd>
              {row.goalsFor} / {row.goalsAgainst} / {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="empty-state">No games played yet.</p>
      )}

      <h3>Schedule</h3>
      <ScheduleList games={teamGames} startOpen />
    </section>
  )
}
