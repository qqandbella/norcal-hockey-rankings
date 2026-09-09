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
      teamLinks: {
        'Fresno Jr Monsters 10-1':
          'https://stats.caha.timetoscore.com/display-schedule?team=114&season=33&league=3&stat_class=1',
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
        {
          gameId: '2',
          date: 'Sat Sep 5',
          day: 'Sat',
          time: '9:00 AM',
          rink: 'San Jose',
          type: 'Preseason',
          away: 'Santa Clara Blackhawks 10-2',
          home: 'Fresno Jr Monsters 10-1',
          awayGoals: 5,
          homeGoals: 1,
          played: true,
        },
        {
          gameId: '3',
          date: 'Sun Sep 6',
          day: 'Sun',
          time: '11:00 AM',
          rink: 'Fresno',
          type: 'Preseason',
          away: 'Fresno Jr Monsters 10-1',
          home: 'Lake Tahoe Grizzlies 10-2',
          awayGoals: 3,
          homeGoals: 3,
          played: true,
        },
      ],
    },
  ],
}

beforeEach(() => {
  // HashRouter reads/writes the real jsdom location, which otherwise carries
  // over between tests in this file (e.g. after a test clicks a team link).
  window.location.hash = ''
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
    expect(await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })).toBeInTheDocument()
    expect(screen.getByText(/3-0-0/)).toBeInTheDocument()
  })

  it('links out to the official TTS page when a team id is resolved', async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    const ttsLink = screen.getByRole('link', { name: /official TTS page/i })
    expect(ttsLink).toHaveAttribute(
      'href',
      'https://stats.caha.timetoscore.com/display-schedule?team=114&season=33&league=3&stat_class=1',
    )

    // Vacaville has no entry in teamLinks -- no outbound link should appear.
    await user.click(screen.getByRole('link', { name: 'Vacaville Jets 10-2' }))
    await screen.findByRole('heading', { name: /Vacaville Jets 10-2/ })
    expect(screen.queryByRole('link', { name: /official TTS page/i })).not.toBeInTheDocument()
  })

  it('links team names inside the schedule table too', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Fresno Jr Monsters 10-1')

    await user.click(screen.getByRole('button', { name: /show schedule/i }))

    const scheduleLinks = screen.getAllByRole('link', { name: 'Vacaville Jets 10-2' })
    expect(scheduleLinks.length).toBeGreaterThan(0)
  })

  it("highlights the viewed team and color-codes each row by that team's result", async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    const winRow = screen.getByText('Fri Sep 4').closest('tr')
    const loseRow = screen.getByText('Sat Sep 5').closest('tr')
    const tieRow = screen.getByText('Sun Sep 6').closest('tr')

    expect(winRow).toHaveClass('schedule-table__row--win')
    expect(loseRow).toHaveClass('schedule-table__row--lose')
    expect(tieRow).toHaveClass('schedule-table__row--tie')

    // Fresno's own name is highlighted in every row it appears in, regardless
    // of whether it's listed as home or away.
    const fresnoCells = winRow!.querySelectorAll('.schedule-table__me')
    expect(fresnoCells.length).toBe(1)
  })

  it('filters a team schedule by result', async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    expect(screen.getByText('Fri Sep 4')).toBeInTheDocument()
    expect(screen.getByText('Sat Sep 5')).toBeInTheDocument()
    expect(screen.getByText('Sun Sep 6')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/result/i), 'win')

    expect(screen.getByText('Fri Sep 4')).toBeInTheDocument()
    expect(screen.queryByText('Sat Sep 5')).not.toBeInTheDocument()
    expect(screen.queryByText('Sun Sep 6')).not.toBeInTheDocument()
  })
})
