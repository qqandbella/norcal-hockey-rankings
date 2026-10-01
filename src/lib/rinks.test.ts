import { describe, expect, it } from 'vitest'
import { estimateDrive, haversineMiles } from './rinks'

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMiles({ lat: 37.5, lon: -122.3 }, { lat: 37.5, lon: -122.3 })).toBe(0)
  })

  it('matches the known SF <-> LA great-circle distance (~347 mi) within a few miles', () => {
    const sf = { lat: 37.7749, lon: -122.4194 }
    const la = { lat: 34.0522, lon: -118.2437 }
    expect(haversineMiles(sf, la)).toBeCloseTo(347, -1)
  })
})

describe('estimateDrive', () => {
  it('is zero distance/time for two games at the same rink', () => {
    expect(estimateDrive('Bridgepointe', 'Bridgepointe')).toEqual({ miles: 0, minutes: 0 })
  })

  it('returns null when either rink has no known location', () => {
    expect(estimateDrive('Bridgepointe', 'Some Unlisted Rink')).toBeNull()
    expect(estimateDrive('Some Unlisted Rink', 'Bridgepointe')).toBeNull()
  })

  it('scales road miles above straight-line distance and derives minutes from the same average speed', () => {
    const estimate = estimateDrive('Bridgepointe', 'Vallco')
    expect(estimate).not.toBeNull()
    const straight = haversineMiles({ lat: 37.5485, lon: -122.301 }, { lat: 37.323, lon: -122.0192 })
    expect(estimate!.miles).toBeGreaterThan(straight) // detour factor > 1
    expect(estimate!.minutes).toBeGreaterThan(0)
  })

  it('is symmetric regardless of argument order', () => {
    expect(estimateDrive('Bridgepointe', 'Vallco')).toEqual(estimateDrive('Vallco', 'Bridgepointe'))
  })
})
