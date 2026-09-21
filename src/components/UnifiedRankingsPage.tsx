import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LEVEL_ORDER, teamRoute } from '../lib/grouping'
import { ALL_TYPES } from '../lib/types'
import type { Division, RankingsData } from '../lib/types'
import type { RatingMode } from './RankingsTable'

type SortKey = 'team' | 'tier' | 'rating' | 'gp' | 'w' | 'l' | 't' | 'pts' | 'gf' | 'ga' | 'gd'
type SortDirection = 'asc' | 'desc'

interface ColumnDef {
  key: SortKey
  label: string
  defaultDirection: SortDirection
}

const COLUMNS: ColumnDef[] = [
  { key: 'team', label: 'Team', defaultDirection: 'asc' },
  { key: 'tier', label: 'Division(s)', defaultDirection: 'asc' },
  { key: 'rating', label: 'Unified rating', defaultDirection: 'desc' },
  { key: 'gp', label: 'GP', defaultDirection: 'desc' },
  { key: 'w', label: 'W', defaultDirection: 'desc' },
  { key: 'l', label: 'L', defaultDirection: 'asc' },
  { key: 't', label: 'T', defaultDirection: 'desc' },
  { key: 'pts', label: 'PTS', defaultDirection: 'desc' },
  { key: 'gf', label: 'GF', defaultDirection: 'desc' },
  { key: 'ga', label: 'GA', defaultDirection: 'asc' },
  { key: 'gd', label: 'GD', defaultDirection: 'desc' },
]

interface UnifiedRow {
  name: string
  rating: number
  gamesPlayed: number
  /** Every division tier this team is rated in this age group, best first
   * -- almost always exactly one, more than one only for a genuinely
   * cross-tested team (the same team playing in two divisions this
   * season). */
  tiers: string[]
  /** Whichever of its divisions it's played the most games in, for the
   * team-page link -- there's no single "home" division field for a
   * cross-tested team, so pick the one with the most evidence. */
  linkDivision: Division
  wins: number
  losses: number
  ties: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
}

function tierSortKey(tier: string): number {
  const idx = LEVEL_ORDER.indexOf(tier)
  return idx === -1 ? LEVEL_ORDER.length : idx
}

function buildUnifiedRows(data: RankingsData, ageLabel: string, experimental: boolean): UnifiedRow[] {
  const group = data.ageGroups[ageLabel]
  if (!group) return []
  const teamsMap = experimental ? group.experimentalTeams : group.teams
  const ageDivisions = data.divisions.filter((d) => d.ageLabel === ageLabel)

  const rows: UnifiedRow[] = []
  for (const [name, unified] of Object.entries(teamsMap)) {
    const matches = ageDivisions
      .map((div) => ({ div, row: div.ratingsByType[ALL_TYPES]?.teams.find((t) => t.name === name) }))
      .filter((m): m is { div: Division; row: NonNullable<(typeof m)['row']> } => m.row !== undefined)
    if (matches.length === 0) continue // rated (via a bridge) but no local "All" row -- shouldn't happen, skip defensively

    const tiers = [...new Set(matches.map((m) => m.div.levelLabel))].sort((a, b) => tierSortKey(a) - tierSortKey(b))
    const linkDivision = matches.reduce((best, m) => (m.row.gamesPlayed > best.row.gamesPlayed ? m : best)).div

    const agg = matches.reduce(
      (acc, m) => ({
        wins: acc.wins + m.row.wins,
        losses: acc.losses + m.row.losses,
        ties: acc.ties + m.row.ties,
        points: acc.points + m.row.points,
        goalsFor: acc.goalsFor + m.row.goalsFor,
        goalsAgainst: acc.goalsAgainst + m.row.goalsAgainst,
      }),
      { wins: 0, losses: 0, ties: 0, points: 0, goalsFor: 0, goalsAgainst: 0 },
    )

    rows.push({
      name,
      rating: unified.rating,
      gamesPlayed: unified.gamesPlayed,
      tiers,
      linkDivision,
      ...agg,
      goalDiff: agg.goalsFor - agg.goalsAgainst,
    })
  }
  return rows
}

function sortValue(row: UnifiedRow, key: SortKey): number | string {
  switch (key) {
    case 'team':
      return row.name
    case 'tier':
      return tierSortKey(row.tiers[0])
    case 'rating':
      return row.rating
    case 'gp':
      return row.gamesPlayed
    case 'w':
      return row.wins
    case 'l':
      return row.losses
    case 't':
      return row.ties
    case 'pts':
      return row.points
    case 'gf':
      return row.goalsFor
    case 'ga':
      return row.goalsAgainst
    case 'gd':
      return row.goalDiff
  }
}

interface UnifiedRankingsPageProps {
  data: RankingsData
  ratingMode: RatingMode
}

export function UnifiedRankingsPage({ data, ratingMode }: UnifiedRankingsPageProps) {
  const { age } = useParams()
  const [sortKey, setSortKey] = useState<SortKey>('rating')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const experimental = ratingMode === 'experimental'

  const group = age ? data.ageGroups[age] : undefined
  const offsets = experimental ? group?.experimentalTierOffsets : group?.tierOffsets

  const rows = useMemo(() => (age ? buildUnifiedRows(data, age, experimental) : []), [data, age, experimental])
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDirection])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(COLUMNS.find((c) => c.key === key)?.defaultDirection ?? 'desc')
    }
  }

  if (!age || !group || !offsets) {
    return <p className="empty-state">No cross-division data for {age} yet.</p>
  }

  const tiersPresent = LEVEL_ORDER.filter((t) => t in offsets)

  return (
    <section>
      <h2>{age} -- Unified ranking (all divisions)</h2>
      <p className="empty-state">
        Every team in {age}, ranked on one scale across A/BB/B (etc.) -- not just within its own division. Each
        division's rating is shifted by a tier offset: a historical prior ("a tier's bottom is on par with the tier
        above's top"), refined by real cross-division games this season in proportion to how many actually exist.
        See <Link to="/help">Help</Link> for the full methodology.
      </p>

      <table className="rankings-table" style={{ marginBottom: '1rem', maxWidth: 480 }}>
        <thead>
          <tr>
            <th>Division</th>
            <th>Offset</th>
            <th>Bridge games</th>
          </tr>
        </thead>
        <tbody>
          {tiersPresent.map((tier) => (
            <tr key={tier}>
              <td>{tier}</td>
              <td className="rankings-table__rating">
                {offsets[tier].offset > 0 ? `+${offsets[tier].offset}` : offsets[tier].offset}
              </td>
              <td>{offsets[tier].evidenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rankings-table-wrap">
        <table className="rankings-table">
          <thead>
            <tr>
              <th>#</th>
              {COLUMNS.map((col) => (
                <th key={col.key}>
                  <button
                    type="button"
                    className="rankings-table__sort-btn"
                    onClick={() => handleSort(col.key)}
                    aria-sort={sortKey === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
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
            {sorted.map((row, i) => (
              <tr key={row.name}>
                <td>{i + 1}</td>
                <td>
                  <Link to={teamRoute(row.linkDivision, row.name)}>{row.name}</Link>
                </td>
                <td>{row.tiers.join(' + ')}</td>
                <td className="rankings-table__rating">{row.rating > 0 ? `+${row.rating}` : row.rating}</td>
                <td>{row.gamesPlayed}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{row.ties}</td>
                <td>{row.points}</td>
                <td>{row.goalsFor}</td>
                <td>{row.goalsAgainst}</td>
                <td>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
