import { Link } from 'react-router-dom'
import { teamRoute } from '../lib/grouping'
import type { Division, RatingsBucket, TeamRow } from '../lib/types'
import { ALL_TYPES } from '../lib/types'

const TIER_LABEL: Record<TeamRow['tier'], string> = {
  top: 'Top',
  mid: 'Mid',
  low: 'Low',
}

interface RankingsTableProps {
  division: Division
  selectedType: string
  onSelectedTypeChange: (type: string) => void
}

export function RankingsTable({ division, selectedType, onSelectedTypeChange }: RankingsTableProps) {
  const availableTypes = [ALL_TYPES, ...Object.keys(division.ratingsByType).filter((t) => t !== ALL_TYPES)]
  const bucket: RatingsBucket | undefined =
    division.ratingsByType[selectedType] ?? division.ratingsByType[ALL_TYPES]

  return (
    <div>
      <div className="rankings-filter">
        <label htmlFor="game-type-filter">Game type</label>
        <select
          id="game-type-filter"
          value={selectedType}
          onChange={(e) => onSelectedTypeChange(e.target.value)}
        >
          {availableTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {!bucket || bucket.teams.length === 0 ? (
        <p className="empty-state">No games of this type played yet.</p>
      ) : (
        <div className="rankings-table-wrap">
          <table className="rankings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Tier</th>
                <th>Rating</th>
                <th>GP</th>
                <th>W</th>
                <th>L</th>
                <th>T</th>
                <th>PTS</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
              </tr>
            </thead>
            <tbody>
              {bucket.teams.map((team) => (
                <tr key={team.name}>
                  <td>{team.rank}</td>
                  <td>
                    <Link to={teamRoute(division, team.name)}>{team.name}</Link>
                  </td>
                  <td>
                    <span className={`tier-badge tier-badge--${team.tier}`}>{TIER_LABEL[team.tier]}</span>
                  </td>
                  <td className="rankings-table__rating">
                    {team.rating > 0 ? `+${team.rating}` : team.rating}
                  </td>
                  <td>{team.gamesPlayed}</td>
                  <td>{team.wins}</td>
                  <td>{team.losses}</td>
                  <td>{team.ties}</td>
                  <td>{team.points}</td>
                  <td>{team.goalsFor}</td>
                  <td>{team.goalsAgainst}</td>
                  <td>{team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bucket.unratedTeams.length > 0 && (
            <p className="rankings-table__unrated">
              No games of this type yet: {bucket.unratedTeams.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
