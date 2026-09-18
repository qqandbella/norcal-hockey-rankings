/**
 * Golden-snapshot regression harness for `idealBoxPositions`.
 *
 * Unit tests in `dzonePositioning.test.ts` check ISOLATED invariants (one
 * behavior at a time, e.g. "weak D stays on its own side"). This file
 * instead captures full GAME MOMENTS -- realistic puck + all-5-attacker
 * configurations -- each with a written judgment call on what "correct"
 * coverage looks like at that instant, and machine-checkable assertions
 * for it. The judgment/reasoning is recorded in `reasoning` so a future
 * reader (human or AI) can see WHY the expected shape was chosen, not
 * just what the assertion checks -- this is deliberately how the model
 * gets caught making a plausible-looking-but-wrong call, the same way
 * the "5-on-1 swarm" bug was only caught by actually looking at a frame,
 * not by isolated unit tests.
 *
 * New snapshots should be added the same way that bug was found: pick a
 * puck + attacker configuration, reason in prose about where each of the
 * 5 defenders should realistically be, then encode that reasoning as
 * assertions -- not by asserting whatever the algorithm currently
 * outputs (that would just freeze bugs in place, not catch them).
 */

import { idealBoxPositions } from './dzonePositioning'
import type { BoxPositions, DZoneGeometry, Point } from './dzonePositioning'

// Real NHL-scaled geometry, matching what the actual trainer component
// builds (kept independent of `src/components` so this stays a pure
// `src/lib` fixture, not a dependency on the UI layer).
const PX_PER_FT = 7
const RINK_WIDTH_FT = 85
const ZONE_DEPTH_FT = 64
const BEHIND_NET_FT = 11
const NEUTRAL_SLIVER_FT = 12
const BLUE_LINE_Y = NEUTRAL_SLIVER_FT * PX_PER_FT
const NET_Y = BLUE_LINE_Y + ZONE_DEPTH_FT * PX_PER_FT
const NET_X = (RINK_WIDTH_FT * PX_PER_FT) / 2

export const SNAPSHOT_GEO: DZoneGeometry = {
  net: { x: NET_X, y: NET_Y },
  blueLineY: BLUE_LINE_Y,
  halfWidth: (RINK_WIDTH_FT / 2) * PX_PER_FT,
  behindNetDepth: BEHIND_NET_FT * PX_PER_FT,
}

export interface Assertion {
  description: string
  check: (pos: BoxPositions, geo: DZoneGeometry) => boolean
}

export interface DZoneSnapshot {
  name: string
  /** The human reasoning for what "correct" looks like at this moment --
   * not just what the assertions check, but WHY, so a reviewer can
   * disagree with the judgment call itself, not just the code. */
  reasoning: string
  puck: Point
  /** The 4 non-carrier attackers' positions -- a full 5-on-5 read, even
   * for scenarios where most of them are irrelevant to what's tested. */
  others: Point[]
  assertions: Assertion[]
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const { net, halfWidth, blueLineY } = SNAPSHOT_GEO
const zoneDepth = net.y - blueLineY

export const DZONE_SNAPSHOTS: DZoneSnapshot[] = [
  {
    name: 'rush, puck deep in the left corner, no other attackers yet',
    reasoning:
      "A clean 1-on-0 into the corner. LD (puck-side) should be the closest defender to the puck, cutting the lane between puck and net rather than sitting beside the puck. RD (weak side) has no reason to leave the net-front -- there's no second attacker to read yet, so it should sit at its baseline net-front spot, clearly on the RIGHT of center (the bug this whole harness exists to catch: collapsing onto the puck's side). LW holds the top of its own circle; RW (weak winger) collapses to the middle, not out wide.",
    puck: { x: net.x - halfWidth * 0.75, y: net.y - 8 },
    others: [],
    assertions: [
      {
        description: 'LD is the closest defender to the puck',
        check: (pos) => {
          const dLD = dist(pos.LD, { x: net.x - halfWidth * 0.75, y: net.y - 8 })
          const others = [pos.RD, pos.C, pos.LW, pos.RW]
          return others.every((p) => dist(p, { x: net.x - halfWidth * 0.75, y: net.y - 8 }) > dLD)
        },
      },
      { description: 'RD (weak side) sits clearly right of center', check: (pos) => pos.RD.x > net.x + halfWidth * 0.05 },
      { description: 'RW (weak winger) collapses toward the middle, not out wide', check: (pos) => Math.abs(pos.RW.x - net.x) < halfWidth * 0.3 },
      { description: 'LW holds higher up ice than either defenseman', check: (pos) => pos.LW.y < pos.LD.y && pos.LW.y < pos.RD.y },
    ],
  },

  {
    name: '2-on-1 down low: puck deep left, second attacker crashing the weak-side slot',
    reasoning:
      "Same puck position as the previous snapshot, but now there's a real second threat: an attacker crashing the low slot on the WEAK (right) side. A real Box+1 weak-side D reads this and collapses tighter to mark the second attacker -- it should end up noticeably closer to the crasher than in the no-threat case, while still never sitting exactly on the crease (that would screen the goalie).",
    puck: { x: net.x - halfWidth * 0.75, y: net.y - 8 },
    others: [{ x: net.x + halfWidth * 0.35, y: net.y - 15 }],
    assertions: [
      {
        description: 'RD (weak D) is within a puck-width of the crasher -- genuinely marking it, not just sitting at the generic net-front spot',
        check: (pos) => dist(pos.RD, { x: net.x + halfWidth * 0.35, y: net.y - 15 }) < halfWidth * 0.35,
      },
      { description: 'RD still does not sit exactly on the crease', check: (pos) => pos.RD.y < net.y - 1 },
    ],
  },

  {
    name: 'point shot setup: puck at the strong-side point, both points manned',
    reasoning:
      "Puck has been worked up to the strong-side point, with the opposing point manned on the weak side too, and a second attacker at the strong-side point supporting (a real 5-man cycle look). The puck-side D should NOT be chasing all the way up to the blue line -- that's beyond hash-mark depth, the winger's job. Instead the strong-side WINGER should rise to challenge/be near the puck-side point threat. The weak-side D and winger stay home; they have no low-slot danger to react to here (the weak attacker is at the point, not the slot), so the danger-collapse logic must NOT fire for them.",
    puck: { x: net.x - halfWidth * 0.7, y: blueLineY + 15 },
    others: [
      { x: net.x + halfWidth * 0.7, y: blueLineY + 12 }, // weak-side point
      { x: net.x - halfWidth * 0.55, y: blueLineY + 30 }, // strong-side support, also up high
      { x: net.x, y: net.y - 90 }, // a trailer far from the action, roughly mid-zone -- shouldn't dominate this scenario
      { x: net.x - halfWidth * 0.2, y: net.y - 60 },
    ],
    assertions: [
      {
        description: "puck-side D doesn't press beyond the hash-mark cap depth even with the puck at the point",
        check: (pos) => pos.LD.y >= net.y - zoneDepth * 0.32 - 1e-6,
      },
      {
        description: 'strong-side winger (LW) is up near the point, clearly higher than its default low-puck hold spot',
        check: (pos) => pos.LW.y < net.y - zoneDepth * 0.6,
      },
      {
        description: "weak-side D (RD) stays home near the net-front -- doesn't chase the weak-side point man",
        check: (pos) => pos.RD.y > net.y - zoneDepth * 0.3,
      },
    ],
  },

  {
    name: 'wraparound attempt: puck behind the net, three attackers spread around the zone',
    reasoning:
      "Puck carrier has gone behind the net attempting a wraparound. The puck-side D must follow behind the net too (a real D doesn't let a free wraparound happen), while the weak-side D stays in front to guard against a centering pass -- it must NOT also go behind the net, or the crease is wide open.",
    puck: { x: net.x - halfWidth * 0.35, y: net.y + 20 },
    others: [
      { x: net.x + halfWidth * 0.6, y: net.y - 100 },
      { x: net.x - halfWidth * 0.3, y: blueLineY + 20 },
      { x: net.x + halfWidth * 0.3, y: blueLineY + 25 },
    ],
    assertions: [
      { description: 'puck-side D (LD) follows behind the net', check: (pos) => pos.LD.y > net.y },
      { description: "weak-side D (RD) stays in front, doesn't also go behind the net", check: (pos) => pos.RD.y <= net.y },
    ],
  },

  {
    name: 'full cycle: puck at the half-wall, both points manned, a trailer in the low slot',
    reasoning:
      "A realistic full 5-man cycle moment: puck on the half-wall (strong side, mid-depth), a trailer crashing the low slot centrally, and both points manned. This combines multiple signals at once -- exactly the kind of moment a change to one position's logic could quietly break another's. Puck-side D pressures the puck itself (still the #1 threat); center should shade toward the central trailer; weak-side D should read the trailer too if it's within range; strong winger stays honest to the point above it.",
    puck: { x: net.x - halfWidth * 0.55, y: net.y - 35 },
    others: [
      { x: net.x + halfWidth * 0.7, y: blueLineY + 10 }, // weak point
      { x: net.x - halfWidth * 0.65, y: blueLineY + 15 }, // strong point
      { x: net.x + halfWidth * 0.05, y: net.y - 12 }, // trailer, dead center, very low (high danger)
    ],
    assertions: [
      { description: 'puck-side D (LD) is nearer the puck than any other defender', check: (pos, g) => {
        const dLD = dist(pos.LD, { x: g.net.x - g.halfWidth * 0.55, y: g.net.y - 35 })
        return [pos.RD, pos.C, pos.LW, pos.RW].every((p) => dist(p, { x: g.net.x - g.halfWidth * 0.55, y: g.net.y - 35 }) > dLD)
      } },
      {
        description: 'center shades toward the central low-slot trailer, relative to what it would be without that trailer',
        check: (pos, g) => {
          const puck = { x: g.net.x - g.halfWidth * 0.55, y: g.net.y - 35 }
          const baseline = idealBoxPositions(puck, [], g)
          return pos.C.x > baseline.C.x
        },
      },
      {
        description: 'strong-side winger (LW) still honors the point above it, not collapsed down with the D',
        check: (pos) => pos.LW.y < net.y - zoneDepth * 0.4,
      },
    ],
  },

  {
    name: 'faceoff moment: puck dead center, no attackers positioned yet',
    reasoning:
      "The exact regression case for the '5-on-1 swarm' bug this harness was built to prevent: with the puck dead center and no other attackers to react to, the 5 defenders must still form a real box spanning both sides of the ice -- not collapse into a tight huddle on top of the puck. This is the single highest-value snapshot in this file precisely because a visually-plausible-looking bug slipped past every unit test that existed before it.",
    puck: { x: net.x, y: net.y - 90 },
    others: [],
    assertions: [
      {
        description: 'the 5-defender box spans a meaningful fraction of the rink width, not a tight huddle',
        check: (pos) => {
          const xs = Object.values(pos).map((p) => p.x)
          return Math.max(...xs) - Math.min(...xs) > halfWidth * 0.25
        },
      },
      {
        description: 'there is real defensive presence on BOTH sides of center, not just one',
        check: (pos) => {
          const xs = Object.values(pos).map((p) => p.x)
          return Math.min(...xs) < net.x - 5 && Math.max(...xs) > net.x + 5
        },
      },
    ],
  },
]
