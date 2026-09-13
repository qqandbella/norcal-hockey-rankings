import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { teamRoute } from '../lib/grouping'
import type { Division, RatingsBucket, Tier, TeamRow } from '../lib/types'
import { ALL_TYPES } from '../lib/types'

const TIER_LABEL: Record<Tier, string> = {
  top: 'Top',
  mid: 'Mid',
  low: 'Low',
}

// Ascending = best-tier-first, matching the natural "top, mid, low" reading.
const TIER_ORDER: Record<Tier, number> = { top: 0, mid: 1, low: 2 }

export type RatingMode = 'classic' | 'experimental'

type SortKey = 'team' | 'tier' | 'rating' | 'offense' | 'defense' | 'gp' | 'w' | 'l' | 't' | 'pts' | 'gf' | 'ga' | 'gd'
type SortDirection = 'asc' | 'desc'

interface ColumnDef {
  key: SortKey
  label: string
  /** Direction a column starts in the first time it's clicked -- "best
   * value first" for that stat (e.g. fewer losses/goals-against is better,
   * so those default ascending; everything else where bigger is better
   * defaults descending). */
  defaultDirection: SortDirection
  experimentalOnly?: boolean
}

const COLUMNS: ColumnDef[] = [
  { key: 'team', label: 'Team', defaultDirection: 'asc' },
  { key: 'tier', label: 'Tier', defaultDirection: 'asc' },
  { key: 'rating', label: 'Rating', defaultDirection: 'desc' },
  { key: 'offense', label: 'Offense', defaultDirection: 'desc', experimentalOnly: true },
  { key: 'defense', label: 'Defense', defaultDirection: 'desc', experimentalOnly: true },
  { key: 'gp', label: 'GP', defaultDirection: 'desc' },
  { key: 'w', label: 'W', defaultDirection: 'desc' },
  { key: 'l', label: 'L', defaultDirection: 'asc' },
  { key: 't', label: 'T', defaultDirection: 'desc' },
  { key: 'pts', label: 'PTS', defaultDirection: 'desc' },
  { key: 'gf', label: 'GF', defaultDirection: 'desc' },
  { key: 'ga', label: 'GA', defaultDirection: 'asc' },
  { key: 'gd', label: 'GD', defaultDirection: 'desc' },
]

function sortValue(team: TeamRow, key: SortKey, experimental: boolean): number | string {
  switch (key) {
    case 'team':
      return team.name
    case 'tier':
      return TIER_ORDER[experimental ? team.experimentalTier : team.tier]
    case 'rating':
      return experimental ? team.experimentalRating : team.rating
    case 'offense':
      return team.offense
    case 'defense':
      return team.defense
    case 'gp':
      return team.gamesPlayed
    case 'w':
      return team.wins
    case 'l':
      return team.losses
    case 't':
      return team.ties
    case 'pts':
      return team.points
    case 'gf':
      return team.goalsFor
    case 'ga':
      return team.goalsAgainst
    case 'gd':
      return team.goalDiff
  }
}

interface RankingsTableProps {
  division: Division
  selectedType: string
  onSelectedTypeChange: (type: string) => void
  ratingMode: RatingMode
}

export function RankingsTable({ division, selectedType, onSelectedTypeChange, ratingMode }: RankingsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rating')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const availableTypes = [ALL_TYPES, ...Object.keys(division.ratingsByType).filter((t) => t !== ALL_TYPES)]
  const bucket: RatingsBucket | undefined =
    division.ratingsByType[selectedType] ?? division.ratingsByType[ALL_TYPES]
  const experimental = ratingMode === 'experimental'

  // Offense/Defense columns only exist in experimental mode -- if the user
  // was sorted by one and switches back to classic, fall back to Rating
  // rather than silently sorting by a now-hidden column.
  useEffect(() => {
    if (!experimental && (sortKey === 'offense' || sortKey === 'defense')) {
      setSortKey('rating')
      setSortDirection('desc')
    }
  }, [experimental, sortKey])

  const teams = useMemo(() => {
    if (!bucket) return []
    const sorted = [...bucket.teams].sort((a, b) => {
      const va = sortValue(a, sortKey, experimental)
      const vb = sortValue(b, sortKey, experimental)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [bucket, sortKey, sortDirection, experimental])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(COLUMNS.find((c) => c.key === key)?.defaultDirection ?? 'desc')
    }
  }

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
                {COLUMNS.filter((c) => !c.experimentalOnly || experimental).map((col) => (
                  <th key={col.key}>
                    <button
                      type="button"
                      className="rankings-table__sort-btn"
                      onClick={() => handleSort(col.key)}
                      aria-sort={
                        sortKey === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span className="rankings-table__sort-arrow">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team, i) => {
                const tier = experimental ? team.experimentalTier : team.tier
                const rating = experimental ? team.experimentalRating : team.rating
                return (
                  <tr key={team.name}>
                    <td>{i + 1}</td>
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
