import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { RankingsData, TeamRow } from './lib/types'

function team(overrides: Partial<TeamRow>): TeamRow {
  return {
    name: 'Team',
    rating: 0,
    rank: 1,
    tier: 'mid',
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    ...overrides,
  }
}

const FRESNO = team({
  name: 'Fresno Jr Monsters 10-1',
  rating: 3.5,
  rank: 1,
  tier: 'top',
  gamesPlayed: 3,
  wins: 3,
  points: 6,
  goalsFor: 32,
  goalsAgainst: 3,
  goalDiff: 29,
})
const VACAVILLE = team({
  name: 'Vacaville Jets 10-2',
  rating: -3.1,
  rank: 2,
  tier: 'low',
  gamesPlayed: 3,
  losses: 3,
  points: 0,
})

const SAMPLE: RankingsData = {
  scraped_at: '2026-09-09T12:00:00+00:00',
  source: 'https://www.norcalyouthhockey.org/load-tts-schedule.php',
  divisions: [
    {
      levelId: 3,
      ageLabel: '10U',
      levelLabel: 'B',
      ratingsByType: {
        All: { teams: [FRESNO, VACAVILLE], unratedTeams: [] },
        Preseason: { teams: [FRESNO, VACAVILLE], unratedTeams: [] },
      },
      games: [
        {
          gameId: '1',
          date: 'Fri Sep 4',
          day: 'Fri',
          time: '6:15 PM',
          rink: 'San Jose',
          type: 'Preseason',
          away: 'Vacaville Jets 10-2',
          home: 'Fresno Jr Monsters 10-1',
          awayGoals: 2,
          homeGoals: 8,
          played: true,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE),
    }),
  )
})

describe('App', () => {
  it('renders discovered divisions and ranked teams with traditional stats', async () => {
    render(<App />)
    expect(await screen.findByText('Fresno Jr Monsters 10-1')).toBeInTheDocument()
    expect(screen.getByText('10U')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'B' })).toBeInTheDocument()
    // W-L-T/points/GF/GA/GD columns.
    expect(screen.getByText('+29')).toBeInTheDocument() // Fresno's goal diff
  })

  it('filters the ranking table by game type', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Fresno Jr Monsters 10-1')

    const select = screen.getByLabelText(/game type/i)
    expect(select).toHaveValue('All')
    await user.selectOptions(select, 'Preseason')
    expect(select).toHaveValue('Preseason')
  })

  it('links each team to its team page', async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    expect(await screen.findByRole('heading', { name: 'Fresno Jr Monsters 10-1' })).toBeInTheDocument()
    expect(screen.getByText(/3-0-0/)).toBeInTheDocument()
  })
})
