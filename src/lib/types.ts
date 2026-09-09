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
}

export interface Division {
  levelId: number
  ageLabel: string
  levelLabel: string
  /** Keyed by game type ("Preseason", "Regular", ...), plus a synthetic "All" bucket. */
  ratingsByType: Record<string, RatingsBucket>
  games: GameRecord[]
}

export interface RankingsData {
  scraped_at: string
  source: string
  divisions: Division[]
}

export const ALL_TYPES = 'All'
