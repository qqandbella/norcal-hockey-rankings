import { Link, useParams } from 'react-router-dom'
import { LEVEL_ORDER, divisionRoute } from '../lib/grouping'
import type { Division, GameRecord, RankingsData, TeamRow } from '../lib/types'
import { ALL_TYPES } from '../lib/types'
import { ScheduleList } from './ScheduleList'

/** "MM/DD/YY" + "3:15PM" -> sortable timestamp. Falls back to 0 (sorts
 * first) for anything unparseable rather than throwing. */
function gameSortKey(game: GameRecord): number {
  const [mm, dd, yy] = game.date.split('/').map(Number)
  if (!mm || !dd || !yy) return 0
  const timeMatch = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(game.time.trim())
  let hour = 0
  let minute = 0
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12
    minute = Number(timeMatch[2])
    if (timeMatch[3].toUpperCase() === 'PM') hour += 12
  }
  return new Date(2000 + yy, mm - 1, dd, hour, minute).getTime()
}

/** A team can appear in more than one division's games -- cross-level test
 * games, or a mid-season level move -- so its full schedule has to be
 * aggregated across every division on the site, not just the one the page
 * was reached from. */
function collectTeamGames(data: RankingsData, teamName: string): GameRecord[] {
  const byId = new Map<string, GameRecord>()
  for (const division of data.divisions) {
    for (const game of division.games) {
      if (game.home === teamName || game.away === teamName) {
        byId.set(game.gameId, game)
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => gameSortKey(a) - gameSortKey(b))
}

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

function findTeamLink(data: RankingsData, teamName: string): string | undefined {
  for (const division of data.divisions) {
    if (division.teamLinks[teamName]) return division.teamLinks[teamName]
  }
  return undefined
}

export function TeamPage({ data, homeDivision }: { data: RankingsData; homeDivision: Division }) {
  const { team: encodedTeam } = useParams()
  const teamName = encodedTeam ? decodeURIComponent(encodedTeam) : ''
  const teamGames = collectTeamGames(data, teamName)
  const ratings = collectRatings(data, teamName)
  const ttsLink = findTeamLink(data, teamName)

  if (teamGames.length === 0) {
    return <p className="empty-state">No games found for {teamName}.</p>
  }

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
        ))
      ) : (
        <p className="empty-state">
          No games played yet in <Link to={divisionRoute(homeDivision)}>{homeDivision.ageLabel} {homeDivision.levelLabel}</Link> or
          any other division (see full schedule below).
        </p>
      )}

      <h3>Schedule</h3>
      <ScheduleList
        games={teamGames}
        startOpen
        perspectiveTeam={teamName}
        homeLevelLabel={homeDivision.levelLabel}
        ageGroups={data.ageGroups}
      />
    </section>
  )
}
