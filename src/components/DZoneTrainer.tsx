import { useEffect, useRef, useState } from 'react'
import { idealBoxPositions, moveToward } from '../lib/dzonePositioning'
import type { BoxPositions, DZoneGeometry, Point } from '../lib/dzonePositioning'

type Mode = 'watch' | 'control'
type PassSpeed = 'slow' | 'medium' | 'fast'
type DefenderKey = keyof BoxPositions
const DEFENDER_KEYS: DefenderKey[] = ['LD', 'RD', 'C', 'LW', 'RW']
const DEFENDER_LABEL: Record<DefenderKey, string> = { LD: 'LD', RD: 'RD', C: 'C', LW: 'LW', RW: 'RW' }
const IDENTITY_ASSIGNMENT: Record<DefenderKey, DefenderKey> = { LD: 'LD', RD: 'RD', C: 'C', LW: 'LW', RW: 'RW' }
const PASS_DURATION_MS: Record<PassSpeed, number> = { slow: 1100, medium: 650, fast: 350 }

// Real NHL rink dimensions, scaled to pixels -- not an arbitrary shape.
// Rink is 200x85ft with a 28ft corner radius; the goal line sits 11ft in
// front of the end boards; the zone (goal line to blue line) is 64ft
// deep. We render one end zone plus a small slice of neutral ice above
// the blue line for point play, so the boards/corners are only drawn at
// the near (net) end -- the blue-line edge is an open viewport boundary
// into the neutral zone, not a wall.
const PX_PER_FT = 7
const RINK_WIDTH_FT = 85
const ZONE_DEPTH_FT = 64
const BEHIND_NET_FT = 11
const NEUTRAL_SLIVER_FT = 12
const CORNER_RADIUS_FT = 28

const CANVAS_W = RINK_WIDTH_FT * PX_PER_FT
const CANVAS_H = (ZONE_DEPTH_FT + BEHIND_NET_FT + NEUTRAL_SLIVER_FT) * PX_PER_FT
const BLUE_LINE_Y = NEUTRAL_SLIVER_FT * PX_PER_FT
const NET: Point = { x: CANVAS_W / 2, y: BLUE_LINE_Y + ZONE_DEPTH_FT * PX_PER_FT }
const END_BOARDS_Y = NET.y + BEHIND_NET_FT * PX_PER_FT
const CORNER_RADIUS_PX = CORNER_RADIUS_FT * PX_PER_FT

const GEO: DZoneGeometry = {
  net: NET,
  blueLineY: BLUE_LINE_Y,
  halfWidth: (RINK_WIDTH_FT / 2) * PX_PER_FT,
  behindNetDepth: BEHIND_NET_FT * PX_PER_FT,
}
// Defender movement speed -- capped RELATIVE to the puck carrier's own
// current speed, not a fixed constant, and not an easing fraction of
// remaining distance (a real skater moves at roughly constant speed
// toward where they're going, not faster the farther away they are).
// These numbers are a reasonable estimate for 10U-level skating speed,
// not measured from real player-tracking data:
//   ~15 ft/s base skating speed => 15 * PX_PER_FT =~ 105 px/s
const DEFENDER_SPEED_MULTIPLIER_OF_CARRIER = 1.15 // defenders read/close slightly faster than the carrier is moving
const MIN_DEFENDER_SPEED_PX_PER_S = 8 * PX_PER_FT // still adjusts/creeps even if the carrier is standing still
const MAX_DEFENDER_SPEED_PX_PER_S = 24 * PX_PER_FT // sprint cap, so dragging the carrier instantly doesn't let defenders teleport too
const OFFENSE_RADIUS = 12
const DEFENDER_RADIUS = 14
const PUCK_RADIUS = 5
const TAP_VS_DRAG_THRESHOLD_PX = 6

function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function clampToZone(p: Point): Point {
  return {
    x: Math.max(12, Math.min(CANVAS_W - 12, p.x)),
    y: Math.max(BLUE_LINE_Y - 25, Math.min(END_BOARDS_Y - 8, p.y)),
  }
}

const MIN_DOT_SEPARATION = OFFENSE_RADIUS + DEFENDER_RADIUS + 6

/** Nudges each defender away from any offense dot it's ended up on top
 * of, so a defender and an offense player are never fully overlapping
 * (a real reported bug: the model can legitimately converge a defender
 * right where the puck carrier already is, and with same-size circles
 * drawn on top of each other one becomes invisible). Purely a rendering
 * concern -- the coaching model's own "ideal spot" is untouched, this
 * only nudges the drawn/followed position so both dots stay visible and
 * separately draggable. */
function separateFromOffense(defenders: BoxPositions, offensePositions: Point[]): BoxPositions {
  const result: BoxPositions = { ...defenders }
  for (const key of DEFENDER_KEYS) {
    let pos = result[key]
    for (const o of offensePositions) {
      const d = dist(pos, o)
      if (d >= MIN_DOT_SEPARATION) continue
      const push = MIN_DOT_SEPARATION - d
      if (d < 1e-6) {
        pos = { x: pos.x + MIN_DOT_SEPARATION, y: pos.y }
      } else {
        pos = { x: pos.x + ((pos.x - o.x) / d) * push, y: pos.y + ((pos.y - o.y) / d) * push }
      }
    }
    result[key] = pos
  }
  return result
}

const MIN_DEFENDER_SEPARATION = DEFENDER_RADIUS * 2 + 6

/** Pushes any two defenders that have drifted within collision distance
 * of each other apart -- a real reported bug: two teammates converging on
 * the same "ideal" spot (e.g. both drawn toward the puck) and visibly
 * overlapping/colliding, which never happens with real skaters. Runs
 * after `separateFromOffense`, and after the auto-follow step, so it's a
 * final positional correction rather than a change to the coaching model
 * itself (the same "two layers" split as `moveToward` vs `idealBoxPositions`). */
function separateDefendersMutually(defenders: BoxPositions): BoxPositions {
  const result: BoxPositions = { ...defenders }
  // A few relaxation passes so a push away from one teammate doesn't just
  // create a new collision with a different one.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < DEFENDER_KEYS.length; i++) {
      for (let j = i + 1; j < DEFENDER_KEYS.length; j++) {
        const a = DEFENDER_KEYS[i]
        const b = DEFENDER_KEYS[j]
        const pa = result[a]
        const pb = result[b]
        const d = dist(pa, pb)
        if (d >= MIN_DEFENDER_SEPARATION) continue
        const push = (MIN_DEFENDER_SEPARATION - d) / 2
        if (d < 1e-6) {
          result[a] = { x: pa.x - MIN_DEFENDER_SEPARATION / 2, y: pa.y }
          result[b] = { x: pb.x + MIN_DEFENDER_SEPARATION / 2, y: pb.y }
        } else {
          const ux = (pa.x - pb.x) / d
          const uy = (pa.y - pb.y) / d
          result[a] = { x: pa.x + ux * push, y: pa.y + uy * push }
          result[b] = { x: pb.x - ux * push, y: pb.y - uy * push }
        }
      }
    }
  }
  return result
}

/** Traces the boards -- straight side walls, 28ft-radius corners at the
 * net end, open at the blue-line end (that's a viewport edge into the
 * neutral zone, not a real wall). */
function tracedBoards(): Path2D {
  const path = new Path2D()
  const r = CORNER_RADIUS_PX
  path.moveTo(0, BLUE_LINE_Y - 30)
  path.lineTo(0, END_BOARDS_Y - r)
  path.arcTo(0, END_BOARDS_Y, r, END_BOARDS_Y, r)
  path.lineTo(CANVAS_W - r, END_BOARDS_Y)
  path.arcTo(CANVAS_W, END_BOARDS_Y, CANVAS_W, END_BOARDS_Y - r, r)
  path.lineTo(CANVAS_W, BLUE_LINE_Y - 30)
  return path
}

function drawFaceoffSpot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const circleR = 15 * PX_PER_FT
  ctx.strokeStyle = '#c0392b'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, circleR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#c0392b'
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, Math.PI * 2)
  ctx.fill()

  // Hash marks: short ticks near the dot, roughly matching the real
  // rink's faceoff-circle hash mark pattern (decorative precision, not
  // to spec down to the inch, but recognizably in the right place/scale).
  const hx = 3 * PX_PER_FT
  const hy = 2.2 * PX_PER_FT
  const tick = 1.3 * PX_PER_FT
  ctx.lineWidth = 2.5
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x + sx * hx, y + sy * hy)
      ctx.lineTo(x + sx * (hx + tick), y + sy * hy)
      ctx.moveTo(x + sx * hx, y + sy * hy)
      ctx.lineTo(x + sx * hx, y + sy * (hy + tick))
      ctx.stroke()
    }
  }
}

function drawRink(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#eef6fb'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  const boards = tracedBoards()

  // Blue line (full width -- it's a real line across the whole rink).
  ctx.strokeStyle = '#2c6fbb'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(0, BLUE_LINE_Y)
  ctx.lineTo(CANVAS_W, BLUE_LINE_Y)
  ctx.stroke()

  // Goal line.
  ctx.strokeStyle = '#c0392b'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, NET.y)
  ctx.lineTo(CANVAS_W, NET.y)
  ctx.stroke()

  // Faceoff dots/circles + hash marks, at the real spec (20ft from the
  // goal line, 22ft off the rink centerline).
  for (const sign of [-1, 1]) {
    drawFaceoffSpot(ctx, NET.x + sign * 22 * PX_PER_FT, NET.y - 20 * PX_PER_FT)
  }

  // Crease.
  ctx.fillStyle = 'rgba(44,111,187,0.15)'
  ctx.strokeStyle = '#2c6fbb'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(NET.x, NET.y, 4 * PX_PER_FT, Math.PI, 0)
  ctx.fill()
  ctx.stroke()

  // Net.
  ctx.strokeStyle = '#222'
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  ctx.lineWidth = 3
  const netW = 6 * PX_PER_FT
  const netD = 3.3 * PX_PER_FT
  ctx.fillRect(NET.x - netW / 2, NET.y - netD, netW, netD)
  ctx.strokeRect(NET.x - netW / 2, NET.y - netD, netW, netD)

  // Boards outline on top.
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 3
  ctx.stroke(boards)
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  p: Point,
  radius: number,
  fill: string,
  label: string,
  ringColor?: string,
) {
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = ringColor ?? '#fff'
  ctx.lineWidth = ringColor ? 3 : 2
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, p.x, p.y)
}

interface PassState {
  from: Point
  to: Point
  startTime: number
  duration: number
  targetIndex: number
}

interface DragState {
  kind: 'offense' | 'defender'
  index: number | DefenderKey
  startPoint: Point
  moved: boolean
}

export function DZoneTrainer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>('watch')
  const [offenseCount, setOffenseCount] = useState(1)
  const [passSpeed, setPassSpeed] = useState<PassSpeed>('medium')
  const [controlledDefender, setControlledDefender] = useState<DefenderKey>('LD')
  // Watch mode: focus on one position (e.g. "I play LW, so watch how LW
  // specifically reacts") -- highlights that dot and dims the rest,
  // without taking control away from the auto-positioning model.
  const [highlighted, setHighlighted] = useState<DefenderKey | 'none'>('none')

  // Coach mode: pause play at any time, manually correct any defender's
  // position (persists as a "lock" until reset), or swap which formation
  // role two defenders each follow -- a persistent tactical override
  // (e.g. "LW tracks the puck carrier into RD's zone and continues; RD
  // rotates into LW's zone" is exactly `roleAssignment.LW = 'RD'` and
  // `roleAssignment.RD = 'LW'`), not just a one-time nudge.
  const [coachMode, setCoachMode] = useState(false)
  const [paused, setPaused] = useState(false)
  const [locked, setLocked] = useState<Partial<Record<DefenderKey, boolean>>>({})
  const [roleAssignment, setRoleAssignment] = useState<Record<DefenderKey, DefenderKey>>(IDENTITY_ASSIGNMENT)
  const [swapA, setSwapA] = useState<DefenderKey>('LW')
  const [swapB, setSwapB] = useState<DefenderKey>('RD')

  const offenseRef = useRef<Point[]>([
    { x: NET.x - 90, y: NET.y - 130 },
    { x: NET.x + 90, y: NET.y - 150 },
    { x: NET.x, y: NET.y - 40 },
  ])
  const puckHolderRef = useRef(0)
  const puckPosRef = useRef<Point>({ ...offenseRef.current[0] })
  const passRef = useRef<PassState | null>(null)
  const defenderPosRef = useRef<BoxPositions>(idealBoxPositions(offenseRef.current[0], GEO))
  const dragRef = useRef<DragState | null>(null)
  const [accuracyText, setAccuracyText] = useState<string>('')

  // Simple scripted wandering for offense in Control mode, so there's
  // something dynamic to react to while the user is busy controlling one
  // defender.
  const wanderTargetsRef = useRef<Point[]>(offenseRef.current.map((p) => p))

  function startPass(targetIndex: number) {
    if (targetIndex === puckHolderRef.current || targetIndex >= offenseCount) return
    passRef.current = {
      from: { ...puckPosRef.current },
      to: { ...offenseRef.current[targetIndex] },
      startTime: performance.now(),
      duration: PASS_DURATION_MS[passSpeed],
      targetIndex,
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let frame = 0
    let lastFrameTime = performance.now()
    let lastCarrierPos: Point = { ...offenseRef.current[puckHolderRef.current] }

    function tick() {
      if (!ctx) return

      const now = performance.now()
      // Clamp dt so a backgrounded tab (huge gap between frames) doesn't
      // let defenders "teleport" on the next tick -- treat anything over
      // 200ms as a fresh start instead of a real elapsed duration.
      const dtSeconds = Math.min(0.2, Math.max(0, (now - lastFrameTime) / 1000))
      lastFrameTime = now

      if (!paused) {
        frame++

        if (mode === 'control') {
          // Every ~90 frames, pick new wander targets for any offense dot
          // not currently being dragged by the user (Watch mode drag is
          // disabled here; in Control mode the user drags the defender).
          if (frame % 90 === 0) {
            wanderTargetsRef.current = offenseRef.current.map(() =>
              clampToZone({
                x: NET.x + (Math.random() - 0.5) * GEO.halfWidth * 1.5,
                y: BLUE_LINE_Y + Math.random() * (NET.y - BLUE_LINE_Y) * 0.85,
              }),
            )
          }
          offenseRef.current = offenseRef.current.map((p, i) => lerpPoint(p, wanderTargetsRef.current[i], 0.02))
        }

        // Puck position: mid-flight during an active pass, otherwise
        // wherever the current holder actually is (so dragging the
        // holder carries the puck with them in real time).
        if (passRef.current) {
          const pass = passRef.current
          const t = (performance.now() - pass.startTime) / pass.duration
          if (t >= 1) {
            puckHolderRef.current = pass.targetIndex
            puckPosRef.current = { ...offenseRef.current[pass.targetIndex] }
            passRef.current = null
          } else {
            puckPosRef.current = lerpPoint(pass.from, pass.to, t)
          }
        } else {
          puckPosRef.current = { ...offenseRef.current[puckHolderRef.current] }
        }

        const puck = puckPosRef.current
        const ideal = idealBoxPositions(puck, GEO)
        const current = defenderPosRef.current

        // Defender speed is capped relative to how fast the puck CARRIER
        // (the skater, not the puck mid-flight during a pass -- see the
        // MIN/MAX/multiplier comment above) is actually moving right now,
        // not a fixed easing fraction. This is a real, deliberate physics
        // constraint: no defender can close distance faster than a
        // plausible skating speed allows, regardless of how far its
        // target position is.
        const carrierPos = offenseRef.current[puckHolderRef.current]
        const carrierSpeedPxPerS = dtSeconds > 0 ? dist(carrierPos, lastCarrierPos) / dtSeconds : 0
        lastCarrierPos = { ...carrierPos }
        const defenderSpeedPxPerS = clamp(
          carrierSpeedPxPerS * DEFENDER_SPEED_MULTIPLIER_OF_CARRIER,
          MIN_DEFENDER_SPEED_PX_PER_S,
          MAX_DEFENDER_SPEED_PX_PER_S,
        )
        const maxStepThisFrame = defenderSpeedPxPerS * dtSeconds

        const next: BoxPositions = { LD: current.LD, RD: current.RD, C: current.C, LW: current.LW, RW: current.RW }
        for (const key of DEFENDER_KEYS) {
          if (locked[key]) continue // coach-corrected: hold this exact spot, don't auto-follow
          if (mode === 'control' && key === controlledDefender && dragRef.current?.kind === 'defender') {
            continue // user is actively dragging this one -- don't auto-follow it
          }
          next[key] = moveToward(current[key], ideal[roleAssignment[key]], maxStepThisFrame)
        }
        defenderPosRef.current = separateDefendersMutually(
          separateFromOffense(next, offenseRef.current.slice(0, offenseCount)),
        )

        if (mode === 'control') {
          const d = dist(next[controlledDefender], ideal[roleAssignment[controlledDefender]])
          const rating =
            d < 18 ? 'Great position!' : d < 45 ? 'Close -- adjust toward the ideal spot' : 'Out of position'
          setAccuracyText(`${rating} (${Math.round(d)}px from ideal)`)
        }
      }

      const idealForDraw = idealBoxPositions(puckPosRef.current, GEO)
      const current = defenderPosRef.current

      drawRink(ctx)
      // Offense -- only as many as offenseCount, never stale extras.
      offenseRef.current.slice(0, offenseCount).forEach((p, i) => {
        const isHolder = i === puckHolderRef.current
        drawDot(ctx, p, OFFENSE_RADIUS, '#1976d2', `O${i + 1}`, isHolder ? '#f1c40f' : undefined)
      })
      // The puck itself, drawn separately so a pass in flight is visible
      // between the two players rather than teleporting.
      ctx.beginPath()
      ctx.arc(puckPosRef.current.x, puckPosRef.current.y, PUCK_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = '#111'
      ctx.fill()

      // Defenders
      for (const key of DEFENDER_KEYS) {
        const isControlled = mode === 'control' && key === controlledDefender
        const isLocked = !!locked[key]
        const isHighlighted = highlighted === key
        const isDimmed = highlighted !== 'none' && !isHighlighted
        const ringColor = isHighlighted ? '#f1c40f' : isControlled ? undefined : isLocked ? '#f39c12' : undefined
        ctx.save()
        ctx.globalAlpha = isDimmed ? 0.35 : 1
        drawDot(
          ctx,
          current[key],
          isHighlighted ? DEFENDER_RADIUS + 3 : DEFENDER_RADIUS,
          isControlled ? '#c0392b' : '#e74c3c',
          DEFENDER_LABEL[key],
          ringColor,
        )
        ctx.restore()
        if (isControlled || isHighlighted || (coachMode && paused)) {
          // Ghost marker at the model's ideal spot, for the "rate/correct" feedback loop.
          ctx.save()
          ctx.strokeStyle = 'rgba(21,101,192,0.55)'
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(
            idealForDraw[roleAssignment[key]].x,
            idealForDraw[roleAssignment[key]].y,
            DEFENDER_RADIUS,
            0,
            Math.PI * 2,
          )
          ctx.stroke()
          ctx.restore()
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, controlledDefender, paused, locked, roleAssignment, coachMode, highlighted, offenseCount])

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = canvasPoint(e)

    // Coach mode, paused: any defender can be grabbed and corrected,
    // regardless of Watch/Control mode.
    if (coachMode && paused) {
      const key = DEFENDER_KEYS.find((k) => dist(defenderPosRef.current[k], p) < DEFENDER_RADIUS + 10)
      if (key) {
        dragRef.current = { kind: 'defender', index: key, startPoint: p, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }

    if (mode === 'watch') {
      const i = offenseRef.current.slice(0, offenseCount).findIndex((o) => dist(o, p) < OFFENSE_RADIUS + 8)
      if (i >= 0) {
        dragRef.current = { kind: 'offense', index: i, startPoint: p, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    } else {
      const pos = defenderPosRef.current[controlledDefender]
      if (dist(pos, p) < DEFENDER_RADIUS + 10) {
        dragRef.current = { kind: 'defender', index: controlledDefender, startPoint: p, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const p = clampToZone(canvasPoint(e))
    if (dist(p, drag.startPoint) > TAP_VS_DRAG_THRESHOLD_PX) drag.moved = true

    if (drag.kind === 'offense' && typeof drag.index === 'number') {
      offenseRef.current[drag.index] = p
      if (drag.index === puckHolderRef.current && !passRef.current) {
        puckPosRef.current = p // puck travels with its carrier while dragging them
      }
    } else if (drag.kind === 'defender') {
      defenderPosRef.current = { ...defenderPosRef.current, [drag.index]: p }
    }
  }

  function handlePointerUp() {
    const drag = dragRef.current
    if (mode === 'watch' && drag?.kind === 'offense' && typeof drag.index === 'number') {
      if (!drag.moved && drag.index !== puckHolderRef.current) {
        // A tap (not a drag) on a teammate: pass to them.
        startPass(drag.index)
      }
    }
    // A coach manually placing a defender while paused is a deliberate
    // correction -- lock it so play doesn't immediately pull it back to
    // the model's default the moment it resumes.
    if (coachMode && paused && drag?.kind === 'defender' && drag.moved) {
      setLocked((prev) => ({ ...prev, [drag.index as DefenderKey]: true }))
    }
    dragRef.current = null
  }

  function swapTactics() {
    if (swapA === swapB) return
    setRoleAssignment((prev) => ({ ...prev, [swapA]: prev[swapB], [swapB]: prev[swapA] }))
  }

  function resetCorrections() {
    setLocked({})
    setRoleAssignment(IDENTITY_ASSIGNMENT)
  }

  const hasCorrections = Object.values(locked).some(Boolean) || DEFENDER_KEYS.some((k) => roleAssignment[k] !== k)

  return (
    <section className="dzone">
      <h2>D-Zone Positioning Trainer</h2>
      <p className="empty-state">
        Practice "Box + 1" defensive zone coverage -- the standard introductory system for youth hockey
        (AJH Coach Player Book). See <a href="#/help">Help</a> for the coaching rules this is built from.
      </p>

      <div className="dzone__controls">
        <div className="rankings-filter__rating-toggle" role="group" aria-label="Trainer mode">
          <button
            type="button"
            className={
              mode === 'watch'
                ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active'
                : 'rankings-filter__toggle-btn'
            }
            onClick={() => setMode('watch')}
          >
            Watch mode
          </button>
          <button
            type="button"
            className={
              mode === 'control'
                ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active'
                : 'rankings-filter__toggle-btn'
            }
            onClick={() => setMode('control')}
          >
            Control mode
          </button>
        </div>

        {mode === 'watch' ? (
          <label className="dzone__option">
            Offensive players
            <select value={offenseCount} onChange={(e) => setOffenseCount(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        ) : null}

        {mode === 'watch' && offenseCount > 1 && (
          <label className="dzone__option">
            Pass speed
            <select value={passSpeed} onChange={(e) => setPassSpeed(e.target.value as PassSpeed)}>
              <option value="slow">Slow</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
            </select>
          </label>
        )}

        {mode === 'watch' && (
          <label className="dzone__option">
            Focus on
            <select value={highlighted} onChange={(e) => setHighlighted(e.target.value as DefenderKey | 'none')}>
              <option value="none">All positions</option>
              {DEFENDER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DEFENDER_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === 'control' && (
          <label className="dzone__option">
            You control
            <select value={controlledDefender} onChange={(e) => setControlledDefender(e.target.value as DefenderKey)}>
              {DEFENDER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DEFENDER_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="dzone__option">
          <input
            type="checkbox"
            checked={coachMode}
            onChange={(e) => {
              setCoachMode(e.target.checked)
              if (!e.target.checked) setPaused(false)
            }}
          />
          Coach mode
        </label>
      </div>

      {coachMode && (
        <div className="dzone__coach-panel">
          <button type="button" className="rankings-filter__toggle-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>

          <span className="dzone__coach-tactics">
            Swap tactics:
            <select value={swapA} onChange={(e) => setSwapA(e.target.value as DefenderKey)}>
              {DEFENDER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DEFENDER_LABEL[k]}
                </option>
              ))}
            </select>
            &harr;
            <select value={swapB} onChange={(e) => setSwapB(e.target.value as DefenderKey)}>
              {DEFENDER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DEFENDER_LABEL[k]}
                </option>
              ))}
            </select>
            <button type="button" className="rankings-filter__toggle-btn" onClick={swapTactics}>
              Swap
            </button>
          </span>

          {hasCorrections && (
            <button type="button" className="rankings-filter__toggle-btn" onClick={resetCorrections}>
              Reset corrections
            </button>
          )}
        </div>
      )}

      {mode === 'watch' ? (
        <p className="dzone__hint">
          Drag the puck carrier (yellow ring) to move with the puck. Tap a different blue player to pass to
          them{offenseCount > 1 ? ' -- the puck travels at the selected speed, and defense reacts as it does' : ''}.
          Watch the 5 red defenders (LD/RD/C/LW/RW) adjust to cover it.
        </p>
      ) : (
        <p className="dzone__hint">
          Drag your defender (dark red, solid) to where you think it should be. The dashed circle shows the
          model's ideal spot for comparison -- try to stay inside it as the puck moves.
          {accuracyText && <strong> {accuracyText}</strong>}
        </p>
      )}
      {coachMode && (
        <p className="dzone__hint">
          {paused
            ? 'Paused -- drag any defender to correct it (an orange ring marks a locked correction). Or swap two positions’ tactics above (e.g. LW takes RD’s assignment and rotates into its zone, RD takes LW’s).'
            : 'Pause any time to correct a defender or swap tactics -- corrections persist through play until reset.'}
        </p>
      )}

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="dzone__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </section>
  )
}
