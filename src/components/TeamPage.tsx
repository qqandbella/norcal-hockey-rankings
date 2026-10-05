import { Link, useParams } from 'react-router-dom'
import { LEVEL_ORDER, divisionRoute, groupByAge } from '../lib/grouping'
import { collectWalkForwardTrajectory } from '../lib/ratingTrajectory'
import { collectTeamGames } from '../lib/schedule'
import type { Division, RankingsData, TeamRow } from '../lib/types'
import { ALL_TYPES } from '../lib/types'
import { RatingChart } from './RatingChart'
import { ScheduleList } from './ScheduleList'

interface DivisionRating {
  division: Division
  row: TeamRow
}

/** Every division a team has a rating in -- almost always one, more for a
 * team cross-tested in another division (see the predictor's tier-offset
 * model). Sorted by division hierarchy (A above BB above B) for display. */
function collectRatings(data: RankingsData, teamName: string): DivisionRating[] {
  const found: DivisionRating[] = []
  for (const division of data.divisions) {
    const row = division.ratingsByType[ALL_TYPES]?.teams.find((t) => t.name === teamName)
    if (row) found.push({ division, row })
  }
  return found.sort((a, b) => {
    const ai = LEVEL_ORDER.indexOf(a.division.levelLabel)
    const bi = LEVEL_ORDER.indexOf(b.division.levelLabel)
    return (ai === -1 ? LEVEL_ORDER.length : ai) - (bi === -1 ? LEVEL_ORDER.length : bi)
  })
}

/** The division to show as this team's "home" for display purposes
 * (predict-page link, cross-level highlighting, the no-ratings-yet
 * fallback link) -- resolved from the team's own current ratings/
 * schedule, never from the URL. A team's games can carry a `levelLabel`
 * naming a division that no longer exists as its own page (TTS's raw
 * per-game "Division" column text, stale once a legacy level gets split
 * -- see teamRoute's own doc comment), so this must never trust that. */
function primaryDivision(data: RankingsData, teamName: string, ratings: DivisionRating[]): Division | undefined {
  if (ratings.length > 0) return ratings[0].division
  const sortedDivisions = groupByAge(data.divisions).flatMap((g) => g.divisions)
  return sortedDivisions.find((d) => d.games.some((g) => g.home === teamName || g.away === teamName))
}

function findTeamLink(data: RankingsData, teamName: string): string | undefined {
  for (const division of data.divisions) {
    if (division.teamLinks[teamName]) return division.teamLinks[teamName]
  }
  return undefined
}

export function TeamPage({ data, ratingMode }: { data: RankingsData; ratingMode: 'classic' | 'experimental' }) {
  const { team: encodedTeam } = useParams()
  const teamName = encodedTeam ? decodeURIComponent(encodedTeam) : ''
  const teamGames = collectTeamGames(data, teamName)
  const ratings = collectRatings(data, teamName)
  const ttsLink = findTeamLink(data, teamName)

  if (teamGames.length === 0) {
    return <p className="empty-state">No games found for {teamName}.</p>
  }

  // teamGames is non-empty, and every one of its games comes from some
  // division's own games list, so primaryDivision's fallback always finds
  // at least one match.
  const homeDivision = primaryDivision(data, teamName, ratings)!

  const trajectory = collectWalkForwardTrajectory(data, teamName, teamGames)

  return (
    <section>
      <h2>
        {teamName}{' '}
        <Link
          className="team-page__predict-link"
          to={`/predict/${encodeURIComponent(homeDivision.ageLabel)}?a=${encodeURIComponent(teamName)}`}
        >
          (predict vs...)
        </Link>
        {ttsLink && (
          <>
            {' '}
            <a className="team-page__tts-link" href={ttsLink} target="_blank" rel="noreferrer">
              (official TTS page)
            </a>
          </>
        )}
      </h2>

      {ratings.length > 0 ? (
        ratings.map(({ division, row }) => (
          <dl className="team-stats" key={division.levelId}>
            <div>
              <dt>
                Rating (<Link to={divisionRoute(division)}>{division.ageLabel} {division.levelLabel}</Link>)
              </dt>
              <dd>
                {ratingMode === 'experimental'
                  ? row.experimentalRating > 0
                    ? `+${row.experimentalRating}`
                    : row.experimentalRating
                  : row.rating > 0
                    ? `+${row.rating}`
                    : row.rating}
              </dd>
            </div>
            <div>
              <dt>Rank</dt>
              <dd>
                {ratingMode === 'experimental'
                  ? `#${row.experimentalRank} (${row.experimentalTier})`
                  : `#${row.rank} (${row.tier})`}
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
        ))
      ) : (
        <p className="empty-state">
          No games played yet in <Link to={divisionRoute(homeDivision)}>{homeDivision.ageLabel} {homeDivision.levelLabel}</Link> or
          any other division (see full schedule below).
        </p>
      )}

      {trajectory.length > 0 && <RatingChart trajectory={trajectory} teamName={teamName} />}

      <h3>Schedule</h3>
      <ScheduleList
        games={teamGames}
        startOpen
        perspectiveTeam={teamName}
        homeLevelLabel={homeDivision.levelLabel}
        ageGroups={data.ageGroups}
        ratingMode={ratingMode}
      />
    </section>
  )
}
