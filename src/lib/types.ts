export type Tier = 'top' | 'mid' | 'low'

export interface TeamRow {
  name: string
  rating: number
  rank: number
  tier: Tier
  gamesPlayed: number
  wins: number
  losses: number
  ties: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  /** Experimental offense/defense split (see scripts/ratings.py
   * compute_offense_defense_ratings) -- backtest-validated to beat the
   * classic rating within-division, not yet used for cross-division
   * predictions or tier offsets. Opt-in via the rankings table's
   * Classic/Experimental toggle. experimentalRating = offense + defense
   * (predicted margin against a league-average opponent), same
   * interpretation as the classic rating. */
  offense: number
  defense: number
  experimentalRating: number
  experimentalRank: number
  experimentalTier: Tier
}

export interface RatingsBucket {
  teams: TeamRow[]
  unratedTeams: string[]
}

export interface GameRecord {
  gameId: string
  date: string
  day: string
  time: string
  rink: string
  type: string
  away: string
  home: string
  awayGoals: number | null
  homeGoals: number | null
  played: boolean
  /** The division this specific game is filed under -- can differ from a
   * team's "home" division (cross-level test games, or a team that moved
   * levels mid-season). */
  ageLabel: string
  levelLabel: string
}

export interface Division {
  levelId: number
  ageLabel: string
  levelLabel: string
  /** Keyed by game type ("Preseason", "Regular", ...), plus a synthetic "All" bucket. */
  ratingsByType: Record<string, RatingsBucket>
  games: GameRecord[]
  /** Team name -> official stats.caha.timetoscore.com schedule URL, where resolved. */
  teamLinks: Record<string, string>
}

export interface UnifiedTeamRating {
  rating: number
  gamesPlayed: number
}

/** Either a historical, multi-season reference gap (no specific teams --
 * derived from a full completed past season, not this season's own noisy
 * few-games-per-team sample), or, only when no historical value exists for
 * a tier pair (too few historical samples, or a brand-new split like a
 * future B East/B West), a flat default gap. */
export type PriorAnchor = { source: 'historical' | 'default'; gap: number }

export interface BridgeGame {
  homeTeam: string
  homeTier: string
  awayTeam: string
  awayTier: string
  margin: number
  impliedGap: number
}

export interface TierOffset {
  offset: number
  evidenceCount: number
  /** The "a tier's bottom is on par with the tier above's top" default,
   * naming exactly which two teams justify it. Null for the bottom-most
   * tier present (offset 0, nothing to anchor). */
  priorAnchor: PriorAnchor | null
  /** Real cross-division games backing this tier's offset, each with its
   * own implied gap -- the actual evidence trail behind the number. */
  bridgeGames: BridgeGame[]
}

export interface AgeGroupRatings {
  teams: Record<string, UnifiedTeamRating>
  /** Keyed by division tier ("A", "BB", "B", ...). */
  tierOffsets: Record<string, TierOffset>
}

export interface RankingsData {
  scraped_at: string
  source: string
  divisions: Division[]
  /** Unified, cross-division rating per age group ("10U", "12U", ...). */
  ageGroups: Record<string, AgeGroupRatings>
}

export const ALL_TYPES = 'All'
