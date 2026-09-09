export type Tier = 'top' | 'mid' | 'low'

export interface TeamRating {
  name: string
  rating: number
  rank: number
  tier: Tier
  gamesPlayed: number
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
  teams: TeamRating[]
  games: GameRecord[]
  unratedTeams: string[]
}

export interface RankingsData {
  scraped_at: string
  source: string
  divisions: Division[]
}
