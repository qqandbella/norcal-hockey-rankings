import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ARRIVAL_BUFFER_MINUTES, GAME_DURATION_MINUTES, findScheduleConflicts } from '../lib/conflicts'
import { teamRoute } from '../lib/grouping'
import { ALL_TYPES } from '../lib/types'
import type { GameRecord, RankingsData } from '../lib/types'

/** Every team name that appears in any division, grouped by "age level"
 * for the picker -- including teams with no played game yet (schedule
 * conflicts don't depend on a rating existing). */
function allTeamOptions(data: RankingsData): Map<string, string[]> {
  const byGroup = new Map<string, Set<string>>()
  for (const division of data.divisions) {
    const label = `${division.ageLabel} ${division.levelLabel}`
    const bucket = division.ratingsByType[ALL_TYPES]
    const names = byGroup.get(label) ?? new Set<string>()
    for (const t of bucket?.teams ?? []) names.add(t.name)
    for (const n of bucket?.unratedTeams ?? []) names.add(n)
    if (names.size > 0) byGroup.set(label, names)
  }
  const result = new Map<string, string[]>()
  for (const [label, names] of byGroup) {
    result.set(label, Array.from(names).sort())
  }
  return result
}

function describeGame(game: GameRecord, team: string): string {
  const isHome = game.home === team
  const opponent = isHome ? game.away : game.home
  return `${game.date} ${game.time} vs ${opponent} @ ${game.rink}`
}

function TeamSelect({
  id,
  label,
  byGroup,
  value,
  onChange,
}: {
  id: string
  label: string
  byGroup: Map<string, string[]>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="predict__picker">
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select a team...</option>
        {Array.from(byGroup.entries()).map(([groupLabel, names]) => (
          <optgroup key={groupLabel} label={groupLabel}>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

export function ComparePage({ data }: { data: RankingsData }) {
  const [searchParams] = useSearchParams()
  const byGroup = allTeamOptions(data)
  const [teamA, setTeamA] = useState(searchParams.get('a') ?? '')
  const [teamB, setTeamB] = useState(searchParams.get('b') ?? '')

  const bothPicked = Boolean(teamA && teamB && teamA !== teamB)
  const conflicts = bothPicked ? findScheduleConflicts(data, teamA, teamB) : []

  return (
    <section>
      <h2>Schedule Conflict Checker</h2>
      <p className="empty-state">
        Pick two teams -- usually two siblings' teams -- to find same-day games too close together for one
        person to make both, accounting for an estimated drive time between rinks, not just the clock. Assumes a
        {' '}
        {GAME_DURATION_MINUTES}-minute rink commitment per game (arrival through gear-off, not just on-ice time)
        and wants at least {ARRIVAL_BUFFER_MINUTES} minutes of slack beyond the estimated drive.
      </p>

      <div className="predict__pickers">
        <TeamSelect id="compare-team-a" label="Team A" byGroup={byGroup} value={teamA} onChange={setTeamA} />
        <TeamSelect id="compare-team-b" label="Team B" byGroup={byGroup} value={teamB} onChange={setTeamB} />
      </div>

      {teamA && teamB && teamA === teamB && <p className="empty-state">Pick two different teams.</p>}

      {bothPicked && conflicts.length === 0 && (
        <p className="empty-state">
          No conflicts found -- every same-day game for these two teams leaves enough time, including estimated
          drive, to make both.
        </p>
      )}

      {bothPicked && conflicts.length > 0 && (
        <table className="schedule-table compare__table">
          <thead>
            <tr>
              <th>{teamA}</th>
              <th>{teamB}</th>
              <th>Est. drive</th>
              <th>Gap</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c, i) => {
              const gameForA = c.earlierTeam === teamA ? c.earlierGame : c.laterGame
              const gameForB = c.earlierTeam === teamB ? c.earlierGame : c.laterGame
              return (
                <tr key={i} className={`compare__row--${c.severity}`}>
                  <td>
                    <Link to={teamRoute(gameForA, teamA)}>{describeGame(gameForA, teamA)}</Link>
                  </td>
                  <td>
                    <Link to={teamRoute(gameForB, teamB)}>{describeGame(gameForB, teamB)}</Link>
                  </td>
                  <td>
                    {c.driveMiles !== null && c.driveMinutes !== null
                      ? `${c.driveMiles} mi / ~${c.driveMinutes} min`
                      : 'rink location unknown'}
                  </td>
                  <td>{c.gapMinutes < 0 ? `overlap by ${Math.abs(c.gapMinutes)} min` : `${c.gapMinutes} min`}</td>
                  <td>{c.severity === 'overlap' ? "Can't make both" : 'Tight -- cutting it close'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {bothPicked && (
        <p className="compare__note">
          Drive time is a straight-line-distance estimate (see <code>src/lib/rinks.ts</code>) scaled by a rough
          road-network/speed assumption -- not live traffic or turn-by-turn navigation. Treat "tight" rows as a
          judgment call, not gospel.
        </p>
      )}
    </section>
  )
}
