import type { TeamRating } from '../lib/types'

const TIER_LABEL: Record<TeamRating['tier'], string> = {
  top: 'Top',
  mid: 'Mid',
  low: 'Low',
}

export function RankingsTable({ teams, unratedTeams }: { teams: TeamRating[]; unratedTeams: string[] }) {
  return (
    <div className="rankings-table-wrap">
      <table className="rankings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Tier</th>
            <th>Rating</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team.name}>
              <td>{team.rank}</td>
              <td>{team.name}</td>
              <td>
                <span className={`tier-badge tier-badge--${team.tier}`}>{TIER_LABEL[team.tier]}</span>
              </td>
              <td className="rankings-table__rating">{team.rating > 0 ? `+${team.rating}` : team.rating}</td>
              <td>{team.gamesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unratedTeams.length > 0 && (
        <p className="rankings-table__unrated">
          No games played yet: {unratedTeams.join(', ')}
        </p>
      )}
    </div>
  )
}
