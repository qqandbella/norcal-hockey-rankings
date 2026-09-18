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
 *
 * This is a real 5-on-5 read, not a 5-on-1 reaction to the puck alone:
 * `idealBoxPositions` also takes `others`, the 4 non-carrier attackers
 * (whether or not the UI happens to be rendering all of them). Box+1 is
 * still fundamentally a ZONE system -- these positions don't switch to
 * man-to-man marking -- but a real zone defense reads WHERE the danger
 * actually is within its zone, not just the puck:
 * - the weak-side D collapses tighter to net if a second attacker is
 *   crashing the low slot on the weak side (still never fully abandons
 *   the crease -- same "not a screen for our goalie" rule as before);
 * - the strong-side winger rises to challenge a point attacker on its own
 *   side, instead of only reacting to the puck's own depth;
 * - the center shades toward a central trailing attacker in the low slot.
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

// An off-puck attacker inside this fraction of zone depth (roughly
// hash-marks-to-net) is a genuine secondary danger a weak-side D/center
// should read, not just someone standing around.
const DANGER_DEPTH_FRACTION = 0.4
// An off-puck attacker beyond this fraction of zone depth is up at the
// point -- the strong-side winger's job, not the D's or center's.
const POINT_DEPTH_FRACTION = 0.75

export function idealBoxPositions(puck: Point, others: Point[], geo: DZoneGeometry): BoxPositions {
  const zoneDepth = geo.net.y - geo.blueLineY // positive: net.y > blueLineY by convention
  // 0 = goal line, zoneDepth = blue line, negative = behind the net.
  const puckDepth = clamp(geo.net.y - puck.y, -geo.behindNetDepth, zoneDepth)

  // Continuous, not a hard boolean -- see the module doc comment on why.
  // t: -1 = puck confidently on the left, 0 = dead center, +1 = confidently right.
  const blendWidth = Math.max(1e-6, geo.halfWidth * SIDE_BLEND_HALFWIDTH_FRACTION)
  const t = clamp((puck.x - geo.net.x) / blendWidth, -1, 1)

  const dCapDepth = zoneDepth * D_PRESSURE_CAP_FRACTION
  const wingerHoldDepth = zoneDepth * WINGER_HOLD_FRACTION

  function depthOf(p: Point): number {
    return clamp(geo.net.y - p.y, -geo.behindNetDepth, zoneDepth)
  }
  // Loosely "on this side" -- a small tolerance band around center so an
  // attacker standing near the slot still counts for whichever D/winger
  // is nearer, instead of a hard cutoff exactly at net.x.
  function onSide(p: Point, sign: number): boolean {
    return (p.x - geo.net.x) * sign >= -geo.halfWidth * 0.1
  }

  const dangerDepth = zoneDepth * DANGER_DEPTH_FRACTION
  const dangerAttackers = others.filter((o) => depthOf(o) < dangerDepth)
  function nearestDangerOnSide(sign: number): Point | null {
    let best: Point | null = null
    let bestDist = Infinity
    for (const o of dangerAttackers) {
      if (!onSide(o, sign)) continue
      const d = Math.hypot(o.x - geo.net.x, o.y - geo.net.y)
      if (d < bestDist) {
        bestDist = d
        best = o
      }
    }
    return best
  }
  function nearestCentralDanger(): Point | null {
    let best: Point | null = null
    let bestDx = Infinity
    for (const o of dangerAttackers) {
      const dx = Math.abs(o.x - geo.net.x)
      if (dx < bestDx) {
        bestDx = dx
        best = o
      }
    }
    return best
  }

  const pointDepth = zoneDepth * POINT_DEPTH_FRACTION
  function nearestPointOnSide(sign: number): Point | null {
    let best: Point | null = null
    let bestY = Infinity
    for (const o of others) {
      if (depthOf(o) < pointDepth) continue // not actually up at the point
      if (!onSide(o, sign)) continue
      if (o.y < bestY) {
        bestY = o.y
        best = o
      }
    }
    return best
  }

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
    const base = { x: geo.net.x + ownSign * geo.halfWidth * 0.18, y: geo.net.y - zoneDepth * 0.14 }
    const danger = nearestDangerOnSide(ownSign)
    if (!danger) return base
    // A second attacker crashing the low slot on this D's own side is a
    // real threat -- collapse tighter to mark it, but still never sit
    // right on the crease itself ("weak side D is not a screen for our
    // goalie" -- same rule as the puck-side D's own floor).
    return {
      x: lerp(base.x, danger.x, 0.5),
      // Track the danger's depth, but never sit closer to net than the
      // crease floor (a max on y in this convention -- larger y is closer
      // to the net).
      y: Math.min(lerp(base.y, danger.y, 0.5), geo.net.y - zoneDepth * 0.06),
    }
  }
  function strongW(sign: number): Point {
    const baseX = geo.net.x + sign * geo.halfWidth * 0.55
    const holdY = geo.net.y - Math.max(wingerHoldDepth, Math.max(puckDepth, 0) * 0.9)
    const point = nearestPointOnSide(sign)
    if (!point) return { x: lerp(baseX, puck.x, 0.35), y: holdY }
    // Reacts to a point threat, but how strongly scales with how far up
    // ice the PUCK itself already is -- Box+1's own rule is that the
    // winger only truly owns the point once the puck is up around/above
    // the hash marks. A winger fully abandoning low support to challenge
    // a stationary point man while the puck is still buried in the
    // corner would be a real coverage breakdown, not this system --
    // that's a seam-denial read for the D/center, not a wholesale swap.
    const puckShallowness = clamp(puckDepth / zoneDepth, 0, 1) // 0 = at net, 1 = at blue line
    const pointHonorY = Math.min(holdY, point.y + 6)
    return { x: lerp(baseX, puck.x, 0.35), y: lerp(holdY, pointHonorY, puckShallowness) }
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
  const cX = geo.net.x + t * geo.halfWidth * cBias
  // A trailing attacker in the low slot (not necessarily strong- or
  // weak-side specifically -- whichever off-puck attacker is nearest
  // center ice) pulls the center's own low-slot coverage slightly toward
  // them, on top of the puck-side bias.
  const trailer = nearestCentralDanger()
  const C: Point = {
    x: trailer ? lerp(cX, trailer.x, 0.25) : cX,
    y: geo.net.y - lerp(zoneDepth * 0.22, zoneDepth * 0.38, depthFraction),
  }

  return { LD, RD, LW, RW, C }
}
