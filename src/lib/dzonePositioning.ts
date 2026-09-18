/**
 * Ideal defensive-zone positioning for a 5-skater "Box+1" coverage
 * (goalie is the "+1"), the standard introductory D-zone system for
 * youth hockey (AJH Coach Player Book, "D-Zone Coverage Responsibilities
 * -- Box + 1"). Every rule below traces to that source, not guessed:
 *
 * - Puck-side ("strong side") defenseman: first to pressure the puck
 *   carrier, separating puck from carrier; stays low, near the
 *   boards/corner on the puck's side, not chasing above the top of the
 *   circles.
 * - Weak-side defenseman: stays net-front/slot, biased toward the puck
 *   side just enough to stay aware, but never fully abandons the crease
 *   ("weak side D is not a screen for our goalie" -- i.e. stays central
 *   enough not to block the goalie's own net-front coverage).
 * - Puck-side ("strong side") winger: holds the top of the circle on
 *   that side, covering the half-wall and point on the puck's side.
 * - Weak-side winger (farthest from puck): collapses to the middle-ice
 *   slot, supporting the weak-side D and net-front.
 * - Center: plays low, in support of the strong-side D/winger (the "low
 *   corner of the box" on the puck side); shifts more centrally when the
 *   puck is at the point rather than down low.
 *
 * Each named position's role is NOT fixed to its label -- "LD" plays the
 * strong-side D role whenever the puck happens to be on the left, and
 * the weak-side D role when the puck is on the right (matches the
 * source's own worked examples, which show first RD-strong/LD-weak, then
 * describe the same rules applying symmetrically). This module
 * determines strong/weak side dynamically from puck position every call.
 */

export interface Point {
  x: number
  y: number
}

export interface DZoneGeometry {
  /** Net/crease center. */
  net: Point
  /** Blue line y-coordinate -- puck.y ranges from `net.y` (goal line) up
   * to roughly this value inside the zone. */
  blueLineY: number
  /** Half-width of the zone, used to clamp/scale lateral positioning. */
  halfWidth: number
}

export interface BoxPositions {
  LD: Point
  RD: Point
  C: Point
  LW: Point
  RW: Point
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1)
}

/**
 * Depth (distance from the goal line) of the "top of the circles" --
 * defensemen generally don't pressure above this; wingers hold roughly
 * at this depth by default.
 */
function topOfCirclesDepth(geo: DZoneGeometry): number {
  return (geo.blueLineY - geo.net.y) * 0.55
}

export function idealBoxPositions(puck: Point, geo: DZoneGeometry): BoxPositions {
  const zoneDepth = geo.blueLineY - geo.net.y
  const puckDepth = clamp(puck.y - geo.net.y, 0, zoneDepth) // 0 = goal line, zoneDepth = blue line
  const puckSideIsLeft = puck.x < geo.net.x
  const strongSideSign = puckSideIsLeft ? -1 : 1

  // -- Defensemen: puck-side D pressures the puck directly (contain/
  // separate), capped so it never chases above the top of the circles.
  // Weak-side D stays net-front/slot, biased toward the puck side only
  // slightly ("head on a swivel", not a screen for the goalie).
  const strongDDepth = clamp(puckDepth, 0, topOfCirclesDepth(geo))
  const strongD: Point = {
    x: clamp(puck.x, geo.net.x - geo.halfWidth * 0.85, geo.net.x + geo.halfWidth * 0.85),
    y: geo.net.y + Math.max(strongDDepth, zoneDepth * 0.12),
  }
  const weakD: Point = {
    x: geo.net.x - strongSideSign * geo.halfWidth * 0.18,
    y: geo.net.y + zoneDepth * 0.14,
  }

  // -- Wingers: puck-side winger holds the top of the circle on that
  // side, sliding toward the point/half-wall as the puck gets shallower
  // (closer to the blue line). Weak-side winger collapses to the
  // middle-ice slot, a bit deeper than the strong winger, supporting the
  // weak-side D and net-front.
  const strongWBaseX = geo.net.x + strongSideSign * geo.halfWidth * 0.55
  const strongW: Point = {
    x: lerp(strongWBaseX, puck.x, 0.35),
    y: geo.net.y + Math.max(topOfCirclesDepth(geo), puckDepth * 0.9),
  }
  const weakW: Point = {
    x: geo.net.x - strongSideSign * geo.halfWidth * 0.15,
    y: geo.net.y + zoneDepth * 0.42,
  }

  // -- Center: low corner of the box in support of the strong side,
  // shifting more centrally (less puck-side-biased) when the puck is up
  // near the point rather than down low -- there's less need to commit
  // to the corner when the puck isn't actually in it.
  const depthFraction = puckDepth / zoneDepth // 0 = goal line, 1 = blue line
  const cBias = lerp(0.4, 0.12, depthFraction) // less lateral bias as puck gets higher
  const c: Point = {
    x: geo.net.x + strongSideSign * geo.halfWidth * cBias,
    y: geo.net.y + lerp(zoneDepth * 0.22, zoneDepth * 0.38, depthFraction),
  }

  return {
    LD: puckSideIsLeft ? strongD : weakD,
    RD: puckSideIsLeft ? weakD : strongD,
    LW: puckSideIsLeft ? strongW : weakW,
    RW: puckSideIsLeft ? weakW : strongW,
    C: c,
  }
}
