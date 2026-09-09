import { Link, useParams } from 'react-router-dom'
import { divisionRoute } from '../lib/grouping'
import type { Division, GameRecord, RankingsData } from '../lib/types'
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

function findTeamLink(data: RankingsData, homeDivision: Division, teamName: string): string | undefined {
  if (homeDivision.teamLinks[teamName]) return homeDivision.teamLinks[teamName]
  for (const division of data.divisions) {
    if (division.teamLinks[teamName]) return division.teamLinks[teamName]
  }
  return undefined
}

export function TeamPage({ data, homeDivision }: { data: RankingsData; homeDivision: Division }) {
  const { team: encodedTeam } = useParams()
  const teamName = encodedTeam ? decodeURIComponent(encodedTeam) : ''
  const teamGames = collectTeamGames(data, teamName)
  const row = homeDivision.ratingsByType[ALL_TYPES]?.teams.find((t) => t.name === teamName)
  const ttsLink = findTeamLink(data, homeDivision, teamName)

  if (teamGames.length === 0) {
    return <p className="empty-state">No games found for {teamName}.</p>
  }

  return (
    <section>
      <p>
        <Link to={divisionRoute(homeDivision)}>
          &larr; {homeDivision.ageLabel} {homeDivision.levelLabel} rankings
        </Link>
      </p>
      <h2>
        {teamName}
        {ttsLink && (
          <>
            {' '}
            <a className="team-page__tts-link" href={ttsLink} target="_blank" rel="noreferrer">
              (official TTS page)
            </a>
          </>
        )}
      </h2>

      {row ? (
        <dl className="team-stats">
          <div>
            <dt>Rating ({homeDivision.ageLabel} {homeDivision.levelLabel})</dt>
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
        <p className="empty-state">
          No games played yet in {homeDivision.ageLabel} {homeDivision.levelLabel} (see full schedule below --
          it may only have games in other divisions so far).
        </p>
      )}

      <h3>Schedule</h3>
      <ScheduleList
        games={teamGames}
        startOpen
        perspectiveTeam={teamName}
        homeLevelLabel={homeDivision.levelLabel}
      />
    </section>
  )
}
