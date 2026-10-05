import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { TrajectoryPoint } from '../lib/ratingTrajectory'
import { outcomeFor } from '../lib/schedule'
import type { GameRecord } from '../lib/types'

const OUTCOME_LABEL = { win: 'W', lose: 'L', tie: 'T' } as const

// Validated diverging pair (blue <-> red), see dataviz skill's palette --
// CVD/normal-vision/contrast all pass (worst adjacent ΔE 19.2 CVD, 32.2
// normal-vision). Reused as plain hex (not CSS vars) since this chart is
// drawn in raw SVG, same approach the rest of the app's CSS vars don't reach.
const LINE_COLOR = '#256abf'

function scoreText(game: GameRecord, teamName: string): string {
  const isHome = game.home === teamName
  const mine = isHome ? game.homeGoals : game.awayGoals
  const theirs = isHome ? game.awayGoals : game.homeGoals
  return `${mine}-${theirs}`
}

function TrajectoryTooltipContent({ point, teamName }: { point: TrajectoryPoint; teamName: string }) {
  const outcome = outcomeFor(point.game, teamName)
  return (
    <>
      <div className="rating-chart__tooltip-date">{point.game.date}</div>
      <div>
        {outcome && <strong className={`rating-chart__tooltip-outcome rating-chart__tooltip-outcome--${outcome}`}>{OUTCOME_LABEL[outcome]}</strong>}
        {' '}vs {point.opponent} ({scoreText(point.game, teamName)}, opponent as of then {point.opponentRating > 0 ? `+${point.opponentRating}` : point.opponentRating})
      </div>
      <div className="rating-chart__tooltip-value">
        rating after this game: {point.runningRating > 0 ? `+${point.runningRating}` : point.runningRating}
      </div>
    </>
  )
}

interface TooltipState {
  index: number
  x: number
  y: number
  /** True when there isn't enough headroom above the hovered mark to show
   * the tooltip there without it getting clipped by the chart's own
   * scroll container -- show it below the mark instead. */
  flip: boolean
}

// Enough headroom for the tallest tooltip content (3 short lines) plus the
// pointer gap -- below this, flip the tooltip under the mark instead.
const TOOLTIP_FLIP_THRESHOLD_PX = 70

function tooltipPosition(wrapRef: RefObject<HTMLDivElement | null>, el: Element, index: number): TooltipState | null {
  const wrapRect = wrapRef.current?.getBoundingClientRect()
  if (!wrapRect) return null
  const elRect = el.getBoundingClientRect()
  const topY = elRect.top - wrapRect.top
  const flip = topY < TOOLTIP_FLIP_THRESHOLD_PX
  return {
    index,
    x: elRect.left - wrapRect.left + elRect.width / 2,
    y: flip ? elRect.bottom - wrapRect.top : topY,
    flip,
  }
}

function TrajectoryChart({ trajectory, teamName }: { trajectory: TrajectoryPoint[]; teamName: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const values = trajectory.map((t) => t.runningRating)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max(0.5, (max - min) * 0.15)
  const domainMin = min - pad
  const domainMax = max + pad

  const slotWidth = 28
  const height = 220
  const marginTop = 16
  const marginBottom = 24
  const innerHeight = height - marginTop - marginBottom
  const width = Math.max(320, trajectory.length * slotWidth + 16)

  const xFor = (i: number) => 8 + i * slotWidth + slotWidth / 2
  const yFor = (v: number) => marginTop + innerHeight - ((v - domainMin) / (domainMax - domainMin)) * innerHeight

  const zeroVisible = domainMin < 0 && domainMax > 0
  const linePath = trajectory.map((t, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(t.runningRating)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(trajectory.length - 1)} ${yFor(domainMin)} L ${xFor(0)} ${yFor(domainMin)} Z`

  const showTooltip = (index: number, el: SVGCircleElement) => setTooltip(tooltipPosition(wrapRef, el, index))

  return (
    <div className="rating-chart__wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="rating-chart__svg" role="img" aria-label={`Rating trajectory for ${teamName}`}>
        {zeroVisible && <line x1={0} y1={yFor(0)} x2={width} y2={yFor(0)} className="rating-chart__baseline" />}
        <path d={areaPath} fill={LINE_COLOR} opacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {trajectory.map((t, i) => (
          <circle
            key={t.game.gameId}
            cx={xFor(i)}
            cy={yFor(t.runningRating)}
            r={5}
            fill={LINE_COLOR}
            strokeWidth={2}
            tabIndex={0}
            role="img"
            aria-label={`${t.game.date} vs ${t.opponent}, rating ${t.runningRating > 0 ? '+' : ''}${t.runningRating}`}
            className={tooltip?.index === i ? 'rating-chart__dot rating-chart__dot--active' : 'rating-chart__dot'}
            onMouseEnter={(e) => showTooltip(i, e.currentTarget)}
            onFocus={(e) => showTooltip(i, e.currentTarget)}
            onMouseLeave={() => setTooltip(null)}
            onBlur={() => setTooltip(null)}
          />
        ))}
      </svg>
      {tooltip && (
        <div
          className={tooltip.flip ? 'rating-chart__tooltip rating-chart__tooltip--below' : 'rating-chart__tooltip'}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <TrajectoryTooltipContent point={trajectory[tooltip.index]} teamName={teamName} />
        </div>
      )}
    </div>
  )
}

export function RatingChart({ trajectory, teamName }: { trajectory: TrajectoryPoint[]; teamName: string }) {
  const [showTable, setShowTable] = useState(false)

  if (trajectory.length === 0) {
    return null
  }

  return (
    <div className="rating-chart">
      <div className="rating-chart__header">
        <h3 className="rating-chart__title">Season trajectory</h3>
        <button type="button" className="rating-chart__table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </div>

      <p className="rating-chart__caption">
        A true walk-forward rating: at each game, re-solved from only the games played up to that date, so an early
        point reflects what was actually knowable then -- not today's fully-matured opponent ratings applied
        backward. Classic (within-division) model only; may not exactly match {teamName}'s current cross-division
        rating shown above if it's been cross-tested in more than one division.
      </p>
      <TrajectoryChart trajectory={trajectory} teamName={teamName} />

      {showTable && (
        <table className="rating-chart__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Opponent rating (as of then)</th>
              <th>Result</th>
              <th>Rating (as of then)</th>
            </tr>
          </thead>
          <tbody>
            {trajectory.map((t) => {
              const outcome = outcomeFor(t.game, teamName)
              return (
                <tr key={t.game.gameId}>
                  <td>{t.game.date}</td>
                  <td>{t.opponent}</td>
                  <td>{t.opponentRating > 0 ? `+${t.opponentRating}` : t.opponentRating}</td>
                  <td>
                    {outcome ? OUTCOME_LABEL[outcome] : '?'} {scoreText(t.game, teamName)}
                  </td>
                  <td>{t.runningRating > 0 ? `+${t.runningRating}` : t.runningRating}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
