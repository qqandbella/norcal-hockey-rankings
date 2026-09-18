import { describe, expect, it } from 'vitest'
import { idealBoxPositions, moveToward } from './dzonePositioning'
import type { DZoneGeometry } from './dzonePositioning'

describe('moveToward (max-speed-capped seek, not an ease)', () => {
  it('moves exactly maxStep toward the target when farther away than that', () => {
    const current = { x: 0, y: 0 }
    const target = { x: 100, y: 0 }
    const next = moveToward(current, target, 10)
    expect(next.x).toBeCloseTo(10, 5)
    expect(next.y).toBeCloseTo(0, 5)
  })

  it('covers the same distance per call regardless of how far from the target it starts -- constant speed, not an ease', () => {
    const target = { x: 1000, y: 0 }
    const far = moveToward({ x: 0, y: 0 }, target, 25)
    const near = moveToward({ x: 990, y: 0 }, target, 25)
    // Both should move by exactly `maxStep` in this direction (near
    // clamps to the target since it's within maxStep -- covered below);
    // here both are still farther than maxStep, so both cover exactly 25.
    expect(Math.hypot(far.x - 0, far.y - 0)).toBeCloseTo(25, 5)
    expect(Math.hypot(near.x - 990, near.y - 0)).toBeCloseTo(10, 5) // only 10px left, arrives exactly
  })

  it('arrives exactly at the target (no overshoot) once within maxStep, rather than creeping forever', () => {
    const next = moveToward({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)
    expect(next).toEqual({ x: 5, y: 0 })
  })

  it('moves diagonally at the correct capped speed (Pythagorean, not per-axis)', () => {
    const next = moveToward({ x: 0, y: 0 }, { x: 100, y: 100 }, 10)
    expect(Math.hypot(next.x, next.y)).toBeCloseTo(10, 5)
    expect(next.x).toBeCloseTo(next.y, 5) // stays on the diagonal toward the target
  })

  it('returns the current position unchanged if already at the target', () => {
    const p = { x: 42, y: 7 }
    expect(moveToward(p, { x: 42, y: 7 }, 10)).toEqual({ x: 42, y: 7 })
  })
})

// net.y > blueLineY, matching the real convention (see dzonePositioning.ts's
// module doc comment) -- an earlier version of these tests used the OPPOSITE
// convention (net.y=0, blueLineY=100), which passed while masking a real
// integration bug: the actual canvas component builds geometry with
// net.y > blueLineY, and every depth calculation silently broke against
// that (zoneDepth went negative). These fixtures now match the real usage.
const geo: DZoneGeometry = { net: { x: 0, y: 100 }, blueLineY: 0, halfWidth: 80, behindNetDepth: 15 }

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

  it("doesn't let a defenseman pressure beyond hash-mark depth -- that's the winger's job past there", () => {
    const puck = { x: -20, y: 1 } // right up at the blue line
    const pos = idealBoxPositions(puck, geo)
    const dCapY = geo.net.y - (geo.net.y - geo.blueLineY) * 0.32
    expect(pos.LD.y).toBeGreaterThanOrEqual(dCapY - 1e-9)
  })

  it('lets the puck-side defenseman track the puck behind the net (prevent a wrap-around)', () => {
    const puck = { x: -30, y: geo.net.y + 10 } // behind the net, left side
    const pos = idealBoxPositions(puck, geo)
    // LD (strong side here) should follow behind the net too, not stop at the goal line.
    expect(pos.LD.y).toBeGreaterThan(geo.net.y)
    // Weak-side D (RD) stays in front, doesn't also go behind the net.
    expect(pos.RD.y).toBeLessThanOrEqual(geo.net.y)
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

  it('keeps every position within the playable area (blue line to behind the net)', () => {
    const puck = { x: -60, y: 20 }
    const pos = idealBoxPositions(puck, geo)
    for (const p of Object.values(pos)) {
      expect(p.y).toBeGreaterThanOrEqual(geo.blueLineY - 1e-9)
      expect(p.y).toBeLessThanOrEqual(geo.net.y + geo.behindNetDepth + 1e-9)
    }
  })

  it('never jumps discontinuously as the puck crosses the rink centerline', () => {
    // A tiny nudge across x=net.x (dead center) should only nudge every
    // defender's position a little, not swap them to a completely
    // different spot -- this was a real, reported bug (a hard left/right
    // switch caused every defender to "teleport" the instant the puck
    // crossed center).
    const justLeft = idealBoxPositions({ x: geo.net.x - 0.5, y: 40 }, geo)
    const justRight = idealBoxPositions({ x: geo.net.x + 0.5, y: 40 }, geo)
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    for (const key of ['LD', 'RD', 'LW', 'RW', 'C'] as const) {
      expect(dist(justLeft[key], justRight[key])).toBeLessThan(1)
    }
  })

  it('smoothly blends strong/weak roles across the whole centerline transition band, not just right at 0', () => {
    // Sweep puck.x across the transition zone and confirm LD's position
    // moves continuously (no single step bigger than a small bound),
    // rather than jumping at some other fixed threshold.
    const steps = 40
    const xs = Array.from({ length: steps + 1 }, (_, i) => -geo.halfWidth * 0.4 + (i / steps) * geo.halfWidth * 0.8)
    const positions = xs.map((x) => idealBoxPositions({ x, y: 40 }, geo).LD)
    for (let i = 1; i < positions.length; i++) {
      const step = Math.hypot(positions[i].x - positions[i - 1].x, positions[i].y - positions[i - 1].y)
      expect(step).toBeLessThan(3)
    }
  })
})
