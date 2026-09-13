import { useState } from 'react'
import { Link } from 'react-router-dom'
import { teamRoute } from '../lib/grouping'
import type { Division, RatingsBucket, TeamRow } from '../lib/types'
import { ALL_TYPES } from '../lib/types'

const TIER_LABEL: Record<TeamRow['tier'], string> = {
  top: 'Top',
  mid: 'Mid',
  low: 'Low',
}

type RatingMode = 'classic' | 'experimental'

interface RankingsTableProps {
  division: Division
  selectedType: string
  onSelectedTypeChange: (type: string) => void
}

export function RankingsTable({ division, selectedType, onSelectedTypeChange }: RankingsTableProps) {
  const [ratingMode, setRatingMode] = useState<RatingMode>('classic')
  const availableTypes = [ALL_TYPES, ...Object.keys(division.ratingsByType).filter((t) => t !== ALL_TYPES)]
  const bucket: RatingsBucket | undefined =
    division.ratingsByType[selectedType] ?? division.ratingsByType[ALL_TYPES]
  const experimental = ratingMode === 'experimental'
  const teams = bucket
    ? experimental
      ? [...bucket.teams].sort((a, b) => a.experimentalRank - b.experimentalRank)
      : bucket.teams
    : []

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
        <div className="rankings-filter__rating-toggle" role="group" aria-label="Rating model">
          <button
            type="button"
            className={!experimental ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active' : 'rankings-filter__toggle-btn'}
            onClick={() => setRatingMode('classic')}
          >
            Classic rating
          </button>
          <button
            type="button"
            className={experimental ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active' : 'rankings-filter__toggle-btn'}
            onClick={() => setRatingMode('experimental')}
          >
            Try experimental rating
          </button>
        </div>
      </div>

      {experimental && (
        <p className="rankings-table__experimental-note">
          <strong>Experimental:</strong> splits each team's rating into separate offense and defense
          components instead of one combined number -- backtest-validated to predict held-out games
          better than the classic rating within a division (see <Link to="/help">Help</Link> for how).
          Within-division only for now: cross-division comparisons and the Predict page still use the
          classic rating.
        </p>
      )}

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
                {experimental && <th>Offense</th>}
                {experimental && <th>Defense</th>}
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
              {teams.map((team) => {
                const tier = experimental ? team.experimentalTier : team.tier
                const rating = experimental ? team.experimentalRating : team.rating
                return (
                  <tr key={team.name}>
                    <td>{experimental ? team.experimentalRank : team.rank}</td>
                    <td>
                      <Link to={teamRoute(division, team.name)}>{team.name}</Link>
                    </td>
                    <td>
                      <span className={`tier-badge tier-badge--${tier}`}>{TIER_LABEL[tier]}</span>
                    </td>
                    <td className="rankings-table__rating">{rating > 0 ? `+${rating}` : rating}</td>
                    {experimental && <td>{team.offense > 0 ? `+${team.offense}` : team.offense}</td>}
                    {experimental && <td>{team.defense > 0 ? `+${team.defense}` : team.defense}</td>}
                    <td>{team.gamesPlayed}</td>
                    <td>{team.wins}</td>
                    <td>{team.losses}</td>
                    <td>{team.ties}</td>
                    <td>{team.points}</td>
                    <td>{team.goalsFor}</td>
                    <td>{team.goalsAgainst}</td>
                    <td>{team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {bucket.unratedTeams.length > 0 && (
            <p className="rankings-table__unrated">
              No games of this type yet:{' '}
              {bucket.unratedTeams.map((name, i) => (
                <span key={name}>
                  {i > 0 && ', '}
                  <Link to={teamRoute(division, name)}>{name}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
