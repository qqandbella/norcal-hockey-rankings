import { useEffect, useRef, useState } from 'react'
import { idealBoxPositions } from '../lib/dzonePositioning'
import type { BoxPositions, DZoneGeometry, Point } from '../lib/dzonePositioning'

type Mode = 'watch' | 'control'
type DefenderKey = keyof BoxPositions
const DEFENDER_KEYS: DefenderKey[] = ['LD', 'RD', 'C', 'LW', 'RW']
const DEFENDER_LABEL: Record<DefenderKey, string> = { LD: 'LD', RD: 'RD', C: 'C', LW: 'LW', RW: 'RW' }
const IDENTITY_ASSIGNMENT: Record<DefenderKey, DefenderKey> = { LD: 'LD', RD: 'RD', C: 'C', LW: 'LW', RW: 'RW' }

const CANVAS_W = 520
const CANVAS_H = 620
const NET: Point = { x: CANVAS_W / 2, y: CANVAS_H - 60 }
const BLUE_LINE_Y = 90
const GEO: DZoneGeometry = { net: NET, blueLineY: BLUE_LINE_Y, halfWidth: 190 }
const FOLLOW_RATE = 0.08 // per-frame lerp fraction -- smooth, not instant, movement toward the ideal spot
const OFFENSE_RADIUS = 12
const DEFENDER_RADIUS = 14

function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clampToZone(p: Point): Point {
  return {
    x: Math.max(NET.x - GEO.halfWidth, Math.min(NET.x + GEO.halfWidth, p.x)),
    y: Math.max(20, Math.min(BLUE_LINE_Y + 40, p.y)),
  }
}

function drawRink(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#eef6fb'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // Blue line
  ctx.strokeStyle = '#2c6fbb'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(0, BLUE_LINE_Y)
  ctx.lineTo(CANVAS_W, BLUE_LINE_Y)
  ctx.stroke()

  // Boards
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 3
  ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4)

  // Faceoff dots/circles (reference for "top of the circles")
  const dotY = NET.y - (NET.y - BLUE_LINE_Y) * 0.55
  for (const sign of [-1, 1]) {
    const dotX = NET.x + sign * 95
    ctx.strokeStyle = '#c0392b'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(dotX, dotY, 46, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#c0392b'
    ctx.beginPath()
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // Crease
  ctx.fillStyle = 'rgba(44,111,187,0.15)'
  ctx.beginPath()
  ctx.arc(NET.x, NET.y, 34, Math.PI, 0)
  ctx.fill()

  // Net
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 3
  ctx.strokeRect(NET.x - 24, NET.y - 6, 48, 14)
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

export function DZoneTrainer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>('watch')
  const [offenseCount, setOffenseCount] = useState(1)
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

  const offenseRef = useRef<Point[]>([{ x: NET.x - 60, y: 200 }, { x: NET.x + 60, y: 220 }, { x: NET.x, y: 260 }])
  const puckHolderRef = useRef(0)
  const defenderPosRef = useRef<BoxPositions>(
    idealBoxPositions(offenseRef.current[0], GEO),
  )
  const dragRef = useRef<{ kind: 'offense' | 'defender'; index: number | DefenderKey } | null>(null)
  const [accuracyText, setAccuracyText] = useState<string>('')

  // Simple scripted wandering for offense in Control mode, so there's
  // something dynamic to react to while the user is busy controlling one
  // defender.
  const wanderTargetsRef = useRef<Point[]>(offenseRef.current.map((p) => p))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let frame = 0

    function tick() {
      if (!ctx) return

      if (!paused) {
        frame++

        if (mode === 'control') {
          // Every ~90 frames, pick new wander targets for any offense dot
          // not currently being dragged by the user (Watch mode drag is
          // disabled here; in Control mode the user drags the defender).
          if (frame % 90 === 0) {
            wanderTargetsRef.current = offenseRef.current.map(() =>
              clampToZone({
                x: NET.x + (Math.random() - 0.5) * GEO.halfWidth * 1.6,
                y: BLUE_LINE_Y + Math.random() * 60 + (NET.y - BLUE_LINE_Y) * Math.random() * 0.7,
              }),
            )
          }
          offenseRef.current = offenseRef.current.map((p, i) => lerpPoint(p, wanderTargetsRef.current[i], 0.02))
        }

        const puck = offenseRef.current[puckHolderRef.current]
        const ideal = idealBoxPositions(puck, GEO)
        const current = defenderPosRef.current
        const next: BoxPositions = { LD: current.LD, RD: current.RD, C: current.C, LW: current.LW, RW: current.RW }
        for (const key of DEFENDER_KEYS) {
          if (locked[key]) continue // coach-corrected: hold this exact spot, don't auto-follow
          if (mode === 'control' && key === controlledDefender && dragRef.current?.kind === 'defender') {
            continue // user is actively dragging this one -- don't auto-follow it
          }
          next[key] = lerpPoint(current[key], ideal[roleAssignment[key]], FOLLOW_RATE)
        }
        defenderPosRef.current = next

        if (mode === 'control') {
          const d = dist(next[controlledDefender], ideal[roleAssignment[controlledDefender]])
          const rating =
            d < 18 ? 'Great position!' : d < 45 ? 'Close -- adjust toward the ideal spot' : 'Out of position'
          setAccuracyText(`${rating} (${Math.round(d)}px from ideal)`)
        }
      }

      const puckForDraw = offenseRef.current[puckHolderRef.current]
      const idealForDraw = idealBoxPositions(puckForDraw, GEO)
      const current = defenderPosRef.current

      drawRink(ctx)
      // Offense
      offenseRef.current.forEach((p, i) => {
        const hasPuck = i === puckHolderRef.current
        drawDot(ctx, p, OFFENSE_RADIUS, hasPuck ? '#1565c0' : '#64b5f6', hasPuck ? '●' : `O${i + 1}`)
      })
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
          ctx.arc(idealForDraw[roleAssignment[key]].x, idealForDraw[roleAssignment[key]].y, DEFENDER_RADIUS, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, controlledDefender, paused, locked, roleAssignment, coachMode, highlighted])

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
        dragRef.current = { kind: 'defender', index: key }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }

    if (mode === 'watch') {
      const i = offenseRef.current.slice(0, offenseCount).findIndex((o) => dist(o, p) < OFFENSE_RADIUS + 8)
      if (i >= 0) {
        dragRef.current = { kind: 'offense', index: i }
        puckHolderRef.current = i // dragging a dot also gives it the puck, simulating a pass to it
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    } else {
      const pos = defenderPosRef.current[controlledDefender]
      if (dist(pos, p) < DEFENDER_RADIUS + 10) {
        dragRef.current = { kind: 'defender', index: controlledDefender }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const p = clampToZone(canvasPoint(e))
    if (drag.kind === 'offense' && typeof drag.index === 'number') {
      offenseRef.current[drag.index] = p
    } else if (drag.kind === 'defender') {
      defenderPosRef.current = { ...defenderPosRef.current, [drag.index]: p }
    }
  }

  function handlePointerUp() {
    const drag = dragRef.current
    // A coach manually placing a defender while paused is a deliberate
    // correction -- lock it so play doesn't immediately pull it back to
    // the model's default the moment it resumes.
    if (coachMode && paused && drag?.kind === 'defender') {
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
          Drag any blue dot (the offensive players) around the zone -- whichever one you're dragging has the
          puck. Watch the 5 red defenders (LD/RD/C/LW/RW) adjust to cover it.
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
