/**
 * Ideal defensive-zone positioning for a 5-skater "Box+1" coverage
 * (goalie is the "+1"), the standard introductory D-zone system for
 * youth hockey (AJH Coach Player Book, "D-Zone Coverage Responsibilities
 * -- Box + 1"). Every rule below traces to that source, not guessed:
 *
 * - Puck-side ("strong side") defenseman: first to pressure the puck
 *   carrier, separating puck from carrier -- including behind the net,
 *   where a real D chases to prevent a wrap-around. Stays low: doesn't
 *   press beyond roughly the faceoff-dot/hash-mark depth. Past that
 *   depth, pressuring the puck becomes the winger's or center's job, not
 *   the D's -- a real D doesn't chase all the way to the point.
 * - Weak-side defenseman: stays net-front/slot, biased toward the puck
 *   side just enough to stay aware, but never fully abandons the crease
 *   ("weak side D is not a screen for our goalie" -- i.e. stays central
 *   enough not to block the goalie's own net-front coverage).
 * - Puck-side ("strong side") winger: holds the top of the circle on
 *   that side, covering the half-wall and point on the puck's side --
 *   this is the position responsible once the puck is up around/above
 *   the hash marks, past where the D would pressure.
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
 * describe the same rules applying symmetrically). Which side is "strong"
 * is a CONTINUOUS function of puck.x, not a hard left/right switch --
 * real players read the play and shift gradually as the puck crosses
 * toward the middle, not with a sudden role swap the instant the puck
 * crosses the centerline. A hard switch was tried first and produced a
 * jarring, physically-impossible teleport right at center ice.
 *
 * Coordinate convention (IMPORTANT, and the source of a real bug once):
 * `net.y` is the LARGER y value and `blueLineY` is SMALLER -- y DECREASES
 * moving from the net toward the blue line. This matches an HTML canvas
 * with the net drawn near the bottom of the screen (y grows downward) and
 * is the convention `DZoneTrainer.tsx` actually renders. Every caller
 * (including tests) must build a `DZoneGeometry` with `net.y > blueLineY`,
 * or every depth-based calculation below silently breaks.
 */

export interface Point {
  x: number
  y: number
}

export interface DZoneGeometry {
  /** Net/crease center. y must be GREATER than `blueLineY` -- see the
   * module doc comment above. */
  net: Point
  /** Blue line y-coordinate -- smaller than `net.y`. */
  blueLineY: number
  /** Half-width of the zone, used to clamp/scale lateral positioning. */
  halfWidth: number
  /** How far behind the net (beyond the goal line, away from the blue
   * line) the puck-side defenseman should track the puck -- real hockey:
   * the D chases behind the net to prevent/contest a wrap-around. */
  behindNetDepth: number
}

export interface BoxPositions {
  LD: Point
  RD: Point
  C: Point
  LW: Point
  RW: Point
}

// Roughly the faceoff-dot/hash-mark depth (about 20ft into a 64ft zone).
// The puck-side D doesn't pressure beyond this -- past it, that's the
// winger's or center's responsibility, not the D's.
const D_PRESSURE_CAP_FRACTION = 0.32
// Roughly the top of the faceoff circles (about 35ft into a 64ft zone) --
// where a winger holds by default.
const WINGER_HOLD_FRACTION = 0.55
// How wide (as a fraction of halfWidth) the smooth strong/weak transition
// band around the rink centerline is. Wider = more gradual handoff --
// real players don't fully swap roles the instant the puck nudges past
// center, they shift gradually as it moves convincingly to one side.
const SIDE_BLEND_HALFWIDTH_FRACTION = 0.42

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1)
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

/**
 * Moves `current` directly toward `target` by at most `maxStep` -- a
 * constant-max-speed "seek", not an easing/lerp. Arrives exactly at
 * `target` (no overshoot, no asymptotic creep) once within `maxStep`.
 *
 * This -- not the target position itself -- is where a hard physical
 * constraint belongs: a real skater has a max speed, and closing on a
 * target 300px away can't happen any faster than closing the last 20px
 * of the same target. An exponential-decay ease (`lerp(current, target,
 * fixedFraction)` every frame) gets this backwards: the step size is
 * proportional to the REMAINING distance, so it's fastest when farthest
 * from the target and crawls as it arrives -- the opposite of a real
 * skater, who moves at roughly constant speed and then decelerates only
 * right at the very end.
 */
export function moveToward(current: Point, target: Point, maxStep: number): Point {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const distance = Math.hypot(dx, dy)
  if (distance <= maxStep || distance < 1e-9) return { ...target }
  const t = maxStep / distance
  return { x: current.x + dx * t, y: current.y + dy * t }
}

export function idealBoxPositions(puck: Point, geo: DZoneGeometry): BoxPositions {
  const zoneDepth = geo.net.y - geo.blueLineY // positive: net.y > blueLineY by convention
  // 0 = goal line, zoneDepth = blue line, negative = behind the net.
  const puckDepth = clamp(geo.net.y - puck.y, -geo.behindNetDepth, zoneDepth)

  // Continuous, not a hard boolean -- see the module doc comment on why.
  // t: -1 = puck confidently on the left, 0 = dead center, +1 = confidently right.
  const blendWidth = Math.max(1e-6, geo.halfWidth * SIDE_BLEND_HALFWIDTH_FRACTION)
  const t = clamp((puck.x - geo.net.x) / blendWidth, -1, 1)

  const dCapDepth = zoneDepth * D_PRESSURE_CAP_FRACTION
  const wingerHoldDepth = zoneDepth * WINGER_HOLD_FRACTION

  function strongD(): Point {
    // Pressures the puck directly, including behind the net (a real D
    // chases there to prevent a wrap-around), but doesn't press beyond
    // the hash-mark depth on the shallow end -- that's the winger's job.
    const depth = clamp(puckDepth, -geo.behindNetDepth, dCapDepth)
    // The "don't sit right on top of the crease" floor (zoneDepth*0.12)
    // only makes sense in FRONT of the net (depth >= 0) -- behind the net
    // there's no crease to avoid crowding, so the floor must not apply,
    // or it cancels out negative (behind-net) depth entirely via Math.max.
    const effectiveDepth = depth >= 0 ? Math.max(depth, zoneDepth * 0.12) : depth
    // Cut BETWEEN the puck carrier and the net, not just mirror the
    // puck's x -- interpolate laterally along the net->puck line at this
    // D's own depth, so a D pressuring from shallower than the puck sits
    // on the shooting/passing lane rather than directly beside the puck.
    const fraction = Math.abs(puckDepth) > 1e-6 ? clamp(effectiveDepth / puckDepth, 0, 1.3) : 1
    const x = geo.net.x + (puck.x - geo.net.x) * fraction
    return {
      x: clamp(x, geo.net.x - geo.halfWidth * 0.85, geo.net.x + geo.halfWidth * 0.85),
      y: geo.net.y - effectiveDepth,
    }
  }
  function weakD(ownSign: number): Point {
    // Biases toward ITS OWN side (away from the puck, which is on the
    // other side when this D is playing weak) -- +ownSign, not -ownSign.
    return { x: geo.net.x + ownSign * geo.halfWidth * 0.18, y: geo.net.y - zoneDepth * 0.14 }
  }
  function strongW(sign: number): Point {
    const baseX = geo.net.x + sign * geo.halfWidth * 0.55
    return {
      x: lerp(baseX, puck.x, 0.35),
      y: geo.net.y - Math.max(wingerHoldDepth, Math.max(puckDepth, 0) * 0.9),
    }
  }
  function weakW(ownSign: number): Point {
    // Same fix as weakD: bias toward ITS OWN side, not the puck's.
    return { x: geo.net.x + ownSign * geo.halfWidth * 0.15, y: geo.net.y - zoneDepth * 0.42 }
  }

  // Weight of "the puck is confidently on the left" -- 1 at t=-1, 0 at t=+1.
  const wLeft = (1 - t) / 2
  const LD = lerpPoint(weakD(-1), strongD(), wLeft)
  const RD = lerpPoint(strongD(), weakD(1), wLeft)
  const LW = lerpPoint(weakW(-1), strongW(-1), wLeft)
  const RW = lerpPoint(strongW(1), weakW(1), wLeft)

  // -- Center: low corner of the box in support of the strong side,
  // shifting more centrally (less puck-side-biased) when the puck is up
  // near the point rather than down low -- there's less need to commit
  // to the corner when the puck isn't actually in it. Uses the same
  // continuous `t` for lateral bias, so it never jumps either.
  const depthFraction = clamp(puckDepth, 0, zoneDepth) / zoneDepth // 0 = goal line, 1 = blue line
  const cBias = lerp(0.4, 0.12, depthFraction) // less lateral bias as puck gets higher
  const C: Point = {
    x: geo.net.x + t * geo.halfWidth * cBias,
    y: geo.net.y - lerp(zoneDepth * 0.22, zoneDepth * 0.38, depthFraction),
  }

  return { LD, RD, LW, RW, C }
}
