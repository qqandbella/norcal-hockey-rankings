import { describe, expect, it } from 'vitest'
import { idealBoxPositions } from './dzonePositioning'
import type { DZoneGeometry } from './dzonePositioning'

// net.y > blueLineY, matching the real convention (see dzonePositioning.ts's
// module doc comment) -- an earlier version of these tests used the OPPOSITE
// convention (net.y=0, blueLineY=100), which passed while masking a real
// integration bug: the actual canvas component builds geometry with
// net.y > blueLineY, and every depth calculation silently broke against
// that (zoneDepth went negative). These fixtures now match the real usage.
const geo: DZoneGeometry = { net: { x: 0, y: 100 }, blueLineY: 0, halfWidth: 80 }

describe('idealBoxPositions (Box+1 coverage)', () => {
  it('puts the puck-side defenseman closer to the puck than the weak-side one', () => {
    const puck = { x: -50, y: 80 } // deep on the left (close to the net)
    const pos = idealBoxPositions(puck, geo)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - puck.x, p.y - puck.y)
    expect(dist(pos.LD)).toBeLessThan(dist(pos.RD))
  })

  it('mirrors correctly when the puck is on the right instead', () => {
    const puck = { x: 50, y: 80 }
    const pos = idealBoxPositions(puck, geo)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - puck.x, p.y - puck.y)
    expect(dist(pos.RD)).toBeLessThan(dist(pos.LD))
  })

  it('keeps the weak-side D net-front, not chasing the puck', () => {
    const puck = { x: -70, y: 10 } // deep left, near the blue line
    const pos = idealBoxPositions(puck, geo)
    // Weak-side D (RD, since puck is left) stays close to the goal line (y near 100).
    expect(pos.RD.y).toBeGreaterThan(70)
  })

  it('never lets a defenseman pressure beyond the top of the circles', () => {
    const puck = { x: -20, y: 1 } // right up at the blue line
    const pos = idealBoxPositions(puck, geo)
    const topOfCirclesY = geo.net.y - (geo.net.y - geo.blueLineY) * 0.55
    expect(pos.LD.y).toBeGreaterThanOrEqual(topOfCirclesY - 1e-9)
  })

  it('holds the puck-side winger higher (closer to the blue line, smaller y) than either defenseman', () => {
    const puck = { x: -30, y: 60 }
    const pos = idealBoxPositions(puck, geo)
    expect(pos.LW.y).toBeLessThan(pos.LD.y)
    expect(pos.LW.y).toBeLessThan(pos.RD.y)
  })

  it('collapses the weak-side winger toward middle ice, not out wide', () => {
    const puck = { x: -60, y: 70 }
    const pos = idealBoxPositions(puck, geo)
    // Weak-side winger is RW here (puck is on the left).
    expect(Math.abs(pos.RW.x)).toBeLessThan(geo.halfWidth * 0.3)
  })

  it("keeps the center biased toward the puck's side", () => {
    const puckLeft = { x: -60, y: 70 }
    const posLeft = idealBoxPositions(puckLeft, geo)
    expect(posLeft.C.x).toBeLessThan(0)

    const puckRight = { x: 60, y: 70 }
    const posRight = idealBoxPositions(puckRight, geo)
    expect(posRight.C.x).toBeGreaterThan(0)
  })

  it("pulls the center more central (less puck-biased) when the puck is at the point", () => {
    const puckLow = { x: -60, y: 80 } // close to the net
    const puckPoint = { x: -60, y: 5 } // near the blue line
    const posLow = idealBoxPositions(puckLow, geo)
    const posPoint = idealBoxPositions(puckPoint, geo)
    expect(Math.abs(posPoint.C.x)).toBeLessThan(Math.abs(posLow.C.x))
  })

  it('is left-right symmetric: mirroring the puck mirrors every position', () => {
    const puck = { x: -35, y: 45 }
    const mirroredPuck = { x: 35, y: 45 }
    const pos = idealBoxPositions(puck, geo)
    const mirrored = idealBoxPositions(mirroredPuck, geo)
    expect(mirrored.RD.x).toBeCloseTo(-pos.LD.x, 5)
    expect(mirrored.RD.y).toBeCloseTo(pos.LD.y, 5)
    expect(mirrored.LD.x).toBeCloseTo(-pos.RD.x, 5)
    expect(mirrored.RW.x).toBeCloseTo(-pos.LW.x, 5)
    expect(mirrored.LW.x).toBeCloseTo(-pos.RW.x, 5)
    expect(mirrored.C.x).toBeCloseTo(-pos.C.x, 5)
  })

  it('keeps every position within the zone (between the blue line and the net), not off in space', () => {
    const puck = { x: -60, y: 20 }
    const pos = idealBoxPositions(puck, geo)
    for (const p of Object.values(pos)) {
      expect(p.y).toBeGreaterThanOrEqual(geo.blueLineY - 1e-9)
      expect(p.y).toBeLessThanOrEqual(geo.net.y + 1e-9)
    }
  })
})
