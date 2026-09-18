import { describe, expect, it } from 'vitest'
import { idealBoxPositions } from './dzonePositioning'
import type { DZoneGeometry } from './dzonePositioning'

const geo: DZoneGeometry = { net: { x: 0, y: 0 }, blueLineY: 100, halfWidth: 80 }

describe('idealBoxPositions (Box+1 coverage)', () => {
  it('puts the puck-side defenseman closer to the puck than the weak-side one', () => {
    const puck = { x: -50, y: 20 } // deep on the left
    const pos = idealBoxPositions(puck, geo)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - puck.x, p.y - puck.y)
    expect(dist(pos.LD)).toBeLessThan(dist(pos.RD))
  })

  it('mirrors correctly when the puck is on the right instead', () => {
    const puck = { x: 50, y: 20 }
    const pos = idealBoxPositions(puck, geo)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - puck.x, p.y - puck.y)
    expect(dist(pos.RD)).toBeLessThan(dist(pos.LD))
  })

  it('keeps the weak-side D net-front, not chasing the puck', () => {
    const puck = { x: -70, y: 90 } // deep left, near the blue line
    const pos = idealBoxPositions(puck, geo)
    // Weak-side D (RD, since puck is left) stays close to the goal line.
    expect(pos.RD.y).toBeLessThan(30)
  })

  it('never lets a defenseman pressure above the top of the circles', () => {
    const puck = { x: -20, y: 99 } // right up at the blue line
    const pos = idealBoxPositions(puck, geo)
    expect(pos.LD.y).toBeLessThanOrEqual(geo.blueLineY * 0.55 + 1e-9)
  })

  it('holds the puck-side winger higher (closer to the blue line) than either defenseman', () => {
    const puck = { x: -30, y: 40 }
    const pos = idealBoxPositions(puck, geo)
    expect(pos.LW.y).toBeGreaterThan(pos.LD.y)
    expect(pos.LW.y).toBeGreaterThan(pos.RD.y)
  })

  it('collapses the weak-side winger toward middle ice, not out wide', () => {
    const puck = { x: -60, y: 30 }
    const pos = idealBoxPositions(puck, geo)
    // Weak-side winger is RW here (puck is on the left).
    expect(Math.abs(pos.RW.x)).toBeLessThan(geo.halfWidth * 0.3)
  })

  it("keeps the center biased toward the puck's side", () => {
    const puckLeft = { x: -60, y: 30 }
    const posLeft = idealBoxPositions(puckLeft, geo)
    expect(posLeft.C.x).toBeLessThan(0)

    const puckRight = { x: 60, y: 30 }
    const posRight = idealBoxPositions(puckRight, geo)
    expect(posRight.C.x).toBeGreaterThan(0)
  })

  it("pulls the center more central (less puck-biased) when the puck is at the point", () => {
    const puckLow = { x: -60, y: 20 }
    const puckPoint = { x: -60, y: 95 }
    const posLow = idealBoxPositions(puckLow, geo)
    const posPoint = idealBoxPositions(puckPoint, geo)
    expect(Math.abs(posPoint.C.x)).toBeLessThan(Math.abs(posLow.C.x))
  })

  it('is left-right symmetric: mirroring the puck mirrors every position', () => {
    const puck = { x: -35, y: 55 }
    const mirroredPuck = { x: 35, y: 55 }
    const pos = idealBoxPositions(puck, geo)
    const mirrored = idealBoxPositions(mirroredPuck, geo)
    expect(mirrored.RD.x).toBeCloseTo(-pos.LD.x, 5)
    expect(mirrored.RD.y).toBeCloseTo(pos.LD.y, 5)
    expect(mirrored.LD.x).toBeCloseTo(-pos.RD.x, 5)
    expect(mirrored.RW.x).toBeCloseTo(-pos.LW.x, 5)
    expect(mirrored.LW.x).toBeCloseTo(-pos.RW.x, 5)
    expect(mirrored.C.x).toBeCloseTo(-pos.C.x, 5)
  })
})
