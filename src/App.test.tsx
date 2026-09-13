import { render, screen, within } from '@testing-library/react'
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
        All: {
          teams: [
            FRESNO,
            VACAVILLE,
            // Also rated in BB below -- a dual-rated (cross-tested) team,
            // like the real San Mateo Black Stars 10-2 case. A fresh name
            // (not reused from the BB fixture teams below) so this doesn't
            // collide with the unrelated cross-division-prediction tests.
            team({ name: 'Oakland Bears 10-2', rating: -1.0, rank: 3, tier: 'low', gamesPlayed: 1, losses: 1 }),
          ],
          unratedTeams: [],
        },
        Preseason: { teams: [FRESNO, VACAVILLE], unratedTeams: [] },
      },
      teamLinks: {
        'Fresno Jr Monsters 10-1':
          'https://stats.caha.timetoscore.com/display-schedule?team=114&season=33&league=3&stat_class=1',
      },
      games: [
        {
          gameId: '6',
          date: 'Sat Sep 5',
          day: 'Sat',
          time: '10:00 AM',
          rink: 'San Jose',
          type: 'Preseason',
          away: 'Oakland Bears 10-2',
          home: 'Vacaville Jets 10-2',
          awayGoals: 1,
          homeGoals: 4,
          played: true,
          ageLabel: '10U',
          levelLabel: 'B',
        },
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
          ageLabel: '10U',
          levelLabel: 'B',
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
          ageLabel: '10U',
          levelLabel: 'B',
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
          ageLabel: '10U',
          levelLabel: 'B',
        },
      ],
    },
    {
      levelId: 55,
      ageLabel: '10U',
      levelLabel: 'BB',
      ratingsByType: {
        All: {
          teams: [
            team({ name: 'Capital Thunder 10-1', rating: 1.5, rank: 1, tier: 'top', gamesPlayed: 1, wins: 1 }),
            team({ name: 'Lake Tahoe Grizzlies 10-1', rating: -1.5, rank: 2, tier: 'low', gamesPlayed: 1, losses: 1 }),
            team({ name: 'Oakland Bears 10-2', rating: -2.0, rank: 3, tier: 'low', gamesPlayed: 1, losses: 1 }),
          ],
          unratedTeams: ['Santa Clara Blackhawks 10-1', 'Fresno Jr Monsters 10-1'],
        },
      },
      teamLinks: {},
      games: [
        {
          // Fresno's B-team playing a cross-division test game filed under
          // BB -- this only shows up when scraping level=55, never level=3,
          // so a team page has to aggregate across all divisions to see it.
          gameId: '4',
          date: 'Sat Sep 12',
          day: 'Sat',
          time: '3:15 PM',
          rink: 'Fresno',
          type: 'Preseason',
          away: 'Santa Clara Blackhawks 10-1',
          home: 'Fresno Jr Monsters 10-1',
          awayGoals: null,
          homeGoals: null,
          played: false,
          ageLabel: '10U',
          levelLabel: 'BB',
        },
        {
          // A separate, already-played BB game unconnected to the B
          // division -- keeps BB in a different rating component than B in
          // this fixture, so the predictor's "unbridged" path is testable.
          gameId: '5',
          date: 'Sat Sep 5',
          day: 'Sat',
          time: '1:00 PM',
          rink: 'Capital',
          type: 'Preseason',
          away: 'Capital Thunder 10-1',
          home: 'Lake Tahoe Grizzlies 10-1',
          awayGoals: 4,
          homeGoals: 1,
          played: true,
          ageLabel: '10U',
          levelLabel: 'BB',
        },
      ],
    },
  ],
  ageGroups: {
    '10U': {
      teams: {
        'Fresno Jr Monsters 10-1': { rating: 3.5, gamesPlayed: 3 },
        'Vacaville Jets 10-2': { rating: -3.1, gamesPlayed: 3 },
        'Santa Clara Blackhawks 10-2': { rating: 0.5, gamesPlayed: 1 },
        'Lake Tahoe Grizzlies 10-2': { rating: -0.2, gamesPlayed: 1 },
        // BB ratings already include the tier offset below (+4.0).
        'Capital Thunder 10-1': { rating: 5.5, gamesPlayed: 1 },
        'Lake Tahoe Grizzlies 10-1': { rating: 2.5, gamesPlayed: 1 },
        'Santa Clara Blackhawks 10-1': { rating: 5.0, gamesPlayed: 1 },
      },
      tierOffsets: {
        B: { offset: 0, evidenceCount: 0, priorAnchor: null, bridgeGames: [] },
        // No bridge game between B and BB has been played in this fixture
        // (game 4 above is still just scheduled) -- pure prior, no evidence.
        BB: {
          offset: 4.0,
          evidenceCount: 0,
          priorAnchor: { source: 'historical', gap: 5.0 },
          bridgeGames: [],
        },
      },
    },
  },
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

  it("includes a team's cross-division games (filed under a different level) in its schedule", async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    // Game 4 is filed under 10U BB, not this team's home division (10U B),
    // but it's still Fresno's game and must show up.
    expect(screen.getByText('Sat Sep 12')).toBeInTheDocument()
    const crossLevelRow = screen.getByText('Sat Sep 12').closest('tr')
    expect(crossLevelRow).toHaveTextContent('10U BB')

    // The opponent from that cross-division game links using ITS own
    // division (BB), not Fresno's home division (B).
    const opponentLink = screen.getByRole('link', { name: 'Santa Clara Blackhawks 10-1' })
    expect(opponentLink).toHaveAttribute('href', '#/10U/BB/team/Santa%20Clara%20Blackhawks%2010-1')
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

  it('predicts a same-division matchup as direct confidence', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Fresno Jr Monsters 10-1')

    await user.click(screen.getByRole('link', { name: 'Predict' }))
    await screen.findByRole('heading', { name: '10U Predictor' })

    await user.selectOptions(screen.getByLabelText('Home team'), 'Fresno Jr Monsters 10-1')
    await user.selectOptions(screen.getByLabelText('Away team'), 'Vacaville Jets 10-2')

    expect(await screen.findByText(/favored by/)).toBeInTheDocument()
    expect(screen.getByText('Same division')).toBeInTheDocument()
  })

  it('predicts a cross-division matchup as resting on the prior when no bridge game has been played, and explains it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Fresno Jr Monsters 10-1')

    await user.click(screen.getByRole('link', { name: 'Predict' }))
    await screen.findByRole('heading', { name: '10U Predictor' })

    await user.selectOptions(screen.getByLabelText('Home team'), 'Fresno Jr Monsters 10-1')
    await user.selectOptions(screen.getByLabelText('Away team'), 'Capital Thunder 10-1')

    expect(await screen.findByText(/favored by/)).toBeInTheDocument()
    expect(screen.getByText(/no bridge games yet/i)).toBeInTheDocument()
    // The evidence trail itself: what anchors the default gap.
    const result = document.querySelector<HTMLElement>('.predict__result')!
    expect(within(result).getByText(/pooled average from a full past season/)).toBeInTheDocument()
    expect(within(result).getByText(/pure default assumption/)).toBeInTheDocument()
  })

  it('prefills the predictor from a team page\'s "predict vs..." link', async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    await user.click(screen.getByRole('link', { name: /predict vs/i }))
    await screen.findByRole('heading', { name: '10U Predictor' })

    expect(screen.getByLabelText('Home team')).toHaveValue('Fresno Jr Monsters 10-1')
  })

  it("shows a tentative predicted margin on a team's unplayed cross-division game", async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Fresno Jr Monsters 10-1' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Fresno Jr Monsters 10-1/ })

    const crossLevelRow = screen.getByText('Sat Sep 12').closest('tr')
    expect(crossLevelRow).toHaveTextContent(/Predicted:/)

    // The prediction itself links to the predictor page with both this
    // game's away and home teams pre-selected.
    const predictionLink = within(crossLevelRow!).getByRole('link', { name: /Predicted:/ })
    expect(predictionLink).toHaveAttribute(
      'href',
      '#/predict/10U?a=Santa%20Clara%20Blackhawks%2010-1&b=Fresno%20Jr%20Monsters%2010-1',
    )
  })

  it('shows a rating block per division for a team rated in more than one, each linking to its own division', async () => {
    const user = userEvent.setup()
    render(<App />)
    const teamLink = await screen.findByRole('link', { name: 'Oakland Bears 10-2' })
    await user.click(teamLink)
    await screen.findByRole('heading', { name: /Oakland Bears 10-2/ })

    // One "Rating (...)" block per division this team is actually rated in.
    const ratingHeadings = screen.getAllByText(/^Rating \(/)
    expect(ratingHeadings).toHaveLength(2)

    const bLink = screen.getByRole('link', { name: '10U B' })
    expect(bLink).toHaveAttribute('href', '#/10U/B')
    const bbLink = screen.getByRole('link', { name: '10U BB' })
    expect(bbLink).toHaveAttribute('href', '#/10U/BB')

    // No separate "<- rankings" back-link anymore -- navigation lives in
    // the rating block labels themselves.
    expect(screen.queryByText(/rankings$/)).not.toBeInTheDocument()
  })
})
