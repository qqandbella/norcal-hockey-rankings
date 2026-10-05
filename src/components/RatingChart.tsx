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
        {' '}vs {point.opponent} ({scoreText(point.game, teamName)}, opponent {point.opponentRating > 0 ? `+${point.opponentRating}` : point.opponentRating})
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

/** "Nice" round-number tick values spanning [min, max], same idea as a
 * standard d3-style tick generator -- a step of 1/2/5 x 10^n, snapped
 * outward so the ticks fully cover the data (see marks-and-anatomy.md:
 * "round to clean numbers"). */
function niceTicks(min: number, max: number, targetCount: number): number[] {
  if (min === max) {
    min -= 1
    max += 1
  }
  const rawStep = (max - min) / targetCount
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  const step = niceResidual * magnitude
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

/** Short "M/D" form of a stored "MM/DD/YY" date -- compact enough for an
 * x-axis tick. */
function shortDate(date: string): string {
  const [mm, dd] = date.split('/')
  return `${Number(mm)}/${Number(dd)}`
}

/** Indices to label on the x-axis -- all of them if few enough, otherwise
 * an even subsample (always including the first and last) so labels
 * don't collide. */
function pickLabelIndices(n: number, maxLabels: number): number[] {
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (maxLabels - 1)
  const indices = new Set<number>()
  for (let i = 0; i < maxLabels; i++) indices.add(Math.round(i * step))
  return Array.from(indices).sort((a, b) => a - b)
}

function TrajectoryChart({ trajectory, teamName }: { trajectory: TrajectoryPoint[]; teamName: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const values = trajectory.map((t) => t.runningRating)
  const yTicks = niceTicks(Math.min(...values), Math.max(...values), 4)
  const domainMin = yTicks[0]
  const domainMax = yTicks[yTicks.length - 1]

  const slotWidth = 28
  const height = 220
  const marginTop = 10
  const marginBottom = 24
  const marginLeft = 40
  const marginRight = 10
  const innerHeight = height - marginTop - marginBottom
  const width = Math.max(320, marginLeft + marginRight + trajectory.length * slotWidth)

  const xFor = (i: number) => marginLeft + i * slotWidth + slotWidth / 2
  const yFor = (v: number) => marginTop + innerHeight - ((v - domainMin) / (domainMax - domainMin)) * innerHeight

  const linePath = trajectory.map((t, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(t.runningRating)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(trajectory.length - 1)} ${yFor(domainMin)} L ${xFor(0)} ${yFor(domainMin)} Z`
  const xLabelIndices = pickLabelIndices(trajectory.length, 6)

  const showTooltip = (index: number, el: SVGCircleElement) => setTooltip(tooltipPosition(wrapRef, el, index))

  return (
    <div className="rating-chart__wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="rating-chart__svg" role="img" aria-label={`Rating trajectory for ${teamName}`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={marginLeft}
              y1={yFor(tick)}
              x2={width - marginRight}
              y2={yFor(tick)}
              className="rating-chart__gridline"
            />
            <text x={marginLeft - 6} y={yFor(tick)} dy="0.32em" textAnchor="end" className="rating-chart__axis-label">
              {tick > 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}
        {xLabelIndices.map((i) => (
          <text
            key={trajectory[i].game.gameId}
            x={xFor(i)}
            y={height - marginBottom + 16}
            textAnchor="middle"
            className="rating-chart__axis-label"
          >
            {shortDate(trajectory[i].game.date)}
          </text>
        ))}
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
        A running average of each game's implied value (today's opponent rating + that game's capped margin), using
        today's opponent ratings throughout rather than re-deriving them as of each date -- shows the shape of the
        season, calibrated to land exactly on {teamName}'s current rating at the last game.
      </p>
      <TrajectoryChart trajectory={trajectory} teamName={teamName} />

      {showTable && (
        <table className="rating-chart__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Opponent rating</th>
              <th>Result</th>
              <th>Running rating</th>
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
