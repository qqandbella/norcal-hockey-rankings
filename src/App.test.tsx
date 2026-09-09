import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { RankingsData } from './lib/types'

const SAMPLE: RankingsData = {
  scraped_at: '2026-09-09T12:00:00+00:00',
  source: 'https://www.norcalyouthhockey.org/load-tts-schedule.php',
  divisions: [
    {
      levelId: 3,
      ageLabel: '10U',
      levelLabel: 'B',
      unratedTeams: [],
      teams: [
        { name: 'Fresno Jr Monsters 10-1', rating: 3.5, rank: 1, tier: 'top', gamesPlayed: 3 },
        { name: 'Vacaville Jets 10-2', rating: -3.1, rank: 2, tier: 'low', gamesPlayed: 3 },
      ],
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
  it('renders discovered divisions and ranked teams', async () => {
    render(<App />)
    expect(await screen.findByText('Fresno Jr Monsters 10-1')).toBeInTheDocument()
    expect(screen.getByText('10U')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'B' })).toBeInTheDocument()
  })

  it('re-fetches with a cache-busting refresh on button click', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Fresno Jr Monsters 10-1')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const callsBefore = fetchMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore))
    const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string
    expect(lastUrl).toContain('cb=')
  })
})
