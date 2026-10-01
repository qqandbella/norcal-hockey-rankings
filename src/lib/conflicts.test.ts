import { describe, expect, it } from 'vitest'
import { ARRIVAL_BUFFER_MINUTES, GAME_DURATION_MINUTES, findScheduleConflicts } from './conflicts'
import { estimateDrive } from './rinks'
import type { GameRecord, RankingsData } from './types'

let nextGameId = 1

function makeGame(overrides: Partial<GameRecord>): GameRecord {
  return {
    gameId: String(nextGameId++),
    date: '10/10/26',
    day: 'Sat',
    time: '10:00AM',
    rink: 'Bridgepointe',
    type: 'Regular',
    away: 'Team A',
    home: 'Opponent',
    awayGoals: null,
    homeGoals: null,
    played: false,
    ageLabel: '10U',
    levelLabel: 'A',
    ...overrides,
  }
}

function makeData(games: GameRecord[]): RankingsData {
  return {
    scraped_at: '2026-10-01T00:00:00Z',
    source: 'test',
    ageGroups: {},
    divisions: [
      {
        levelId: 1,
        ageLabel: '10U',
        levelLabel: 'A',
        ratingsByType: {},
        teamLinks: {},
        games,
      },
    ],
  }
}

describe('findScheduleConflicts', () => {
  it('flags two same-day games as an overlap when they literally coincide in time', () => {
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', time: '10:00AM', rink: 'Bridgepointe' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', time: '10:00AM', rink: 'Vallco' })
    const conflicts = findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('overlap')
    expect(conflicts[0].gapMinutes).toBeLessThan(0)
  })

  it('flags a back-to-back as "tight" when the gap is positive but less than drive time + buffer', () => {
    const drive = estimateDrive('Bridgepointe', 'Vallco')!
    const gameA = makeGame({
      away: 'Team A',
      home: 'Opp A',
      time: '9:00AM',
      rink: 'Bridgepointe',
    })
    // Starts right as the required (drive + buffer) window closes, minus a
    // few minutes -- deliberately still inside the window, however wide it
    // is for this specific rink pair.
    const earlierEndMinutes = 9 * 60 + GAME_DURATION_MINUTES
    const laterStartMinutes = earlierEndMinutes + drive.minutes + ARRIVAL_BUFFER_MINUTES - 5
    const hour = Math.floor(laterStartMinutes / 60) % 24
    const minute = laterStartMinutes % 60
    const hour12 = hour % 12 === 0 ? 12 : hour % 12
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const gameB = makeGame({
      away: 'Team B',
      home: 'Opp B',
      time: `${hour12}:${String(minute).padStart(2, '0')}${ampm}`,
      rink: 'Vallco',
    })
    const conflicts = findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('tight')
    expect(conflicts[0].gapMinutes).toBeGreaterThanOrEqual(0)
  })

  it('does not flag a conflict when the gap comfortably exceeds drive time + buffer', () => {
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', time: '8:00AM', rink: 'Bridgepointe' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', time: '6:00PM', rink: 'Vallco' })
    expect(findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')).toHaveLength(0)
  })

  it('marks a positive but small gap as "overlap", not "tight", when it is still less than the drive alone takes -- not just short on buffer', () => {
    // Fresno <-> Dublin is roughly a 3.5-4hr drive; a 15-minute gap is not
    // "cutting it close", it's not possible at all.
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', time: '11:45AM', rink: 'Fresno' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', time: '1:30PM', rink: 'Dublin' })
    const conflicts = findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].gapMinutes).toBeGreaterThan(0)
    expect(conflicts[0].driveMinutes).toBeGreaterThan(conflicts[0].gapMinutes)
    expect(conflicts[0].severity).toBe('overlap')
  })

  it('does not flag games on different dates', () => {
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', date: '10/10/26', time: '10:00AM' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', date: '10/11/26', time: '10:00AM' })
    expect(findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')).toHaveLength(0)
  })

  it('treats back-to-back games at the same rink as needing only the arrival buffer, not drive time', () => {
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', time: '9:00AM', rink: 'Bridgepointe' })
    // Ends at 10:30 (90 min duration); starts again with only the arrival
    // buffer worth of gap -- should still flag as tight since it's below
    // the buffer, not because of any drive time (same rink, 0 drive).
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', time: '10:35AM', rink: 'Bridgepointe' })
    const conflicts = findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].driveMinutes).toBe(0)
    expect(conflicts[0].severity).toBe('tight')
  })

  it('still flags a same-day double-booking when a rink has no known location, without a drive estimate', () => {
    const gameA = makeGame({ away: 'Team A', home: 'Opp A', time: '10:00AM', rink: 'Some Unlisted Rink' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp B', time: '10:05AM', rink: 'Vallco' })
    const conflicts = findScheduleConflicts(makeData([gameA, gameB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].driveMinutes).toBeNull()
    expect(conflicts[0].driveMiles).toBeNull()
  })

  it('checks a team against its own doubleheader, not just the other team', () => {
    const gameA1 = makeGame({ away: 'Team A', home: 'Opp 1', time: '9:00AM', rink: 'Bridgepointe' })
    const gameA2 = makeGame({ away: 'Team A', home: 'Opp 2', time: '9:30AM', rink: 'Vallco' })
    const gameB = makeGame({ away: 'Team B', home: 'Opp 3', date: '10/11/26', time: '9:00AM' })
    const conflicts = findScheduleConflicts(makeData([gameA1, gameA2, gameB]), 'Team A', 'Team A')
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('ignores a shared game between the two teams (not a conflict -- they are at the same place)', () => {
    const headToHead = makeGame({ away: 'Team A', home: 'Team B', time: '10:00AM' })
    expect(findScheduleConflicts(makeData([headToHead]), 'Team A', 'Team B')).toHaveLength(0)
  })

  it('returns conflicts sorted chronologically', () => {
    const laterA = makeGame({ away: 'Team A', home: 'Opp', date: '10/17/26', time: '10:00AM', rink: 'Bridgepointe' })
    const laterB = makeGame({ away: 'Team B', home: 'Opp', date: '10/17/26', time: '10:00AM', rink: 'Vallco' })
    const earlierA = makeGame({ away: 'Team A', home: 'Opp', date: '10/10/26', time: '10:00AM', rink: 'Bridgepointe' })
    const earlierB = makeGame({ away: 'Team B', home: 'Opp', date: '10/10/26', time: '10:00AM', rink: 'Vallco' })
    const conflicts = findScheduleConflicts(makeData([laterA, laterB, earlierA, earlierB]), 'Team A', 'Team B')
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].date).toBe('10/10/26')
    expect(conflicts[1].date).toBe('10/17/26')
  })
})
