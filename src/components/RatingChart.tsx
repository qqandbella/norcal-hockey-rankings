import { useRef, useState } from 'react'
import type { GameContribution, TrajectoryPoint } from '../lib/ratingContributions'
import { outcomeFor } from '../lib/schedule'

type Tab = 'contribution' | 'trajectory'

const OUTCOME_LABEL = { win: 'W', lose: 'L', tie: 'T' } as const

// Validated diverging pair (blue <-> red), see dataviz skill's palette --
// CVD/normal-vision/contrast all pass (worst adjacent ΔE 19.2 CVD, 32.2
// normal-vision). Reused as plain hex (not CSS vars) since this chart is
// drawn in raw SVG, same approach the rest of the app's CSS vars don't reach.
const POSITIVE_COLOR = '#256abf'
const NEGATIVE_COLOR = '#e34948'

function scoreText(game: GameContribution['game'], teamName: string): string {
  const isHome = game.home === teamName
  const mine = isHome ? game.homeGoals : game.awayGoals
  const theirs = isHome ? game.awayGoals : game.homeGoals
  return `${mine}-${theirs}`
}

function TooltipContent({ c, teamName }: { c: GameContribution; teamName: string }) {
  const outcome = outcomeFor(c.game, teamName)
  return (
    <>
      <div className="rating-chart__tooltip-date">{c.game.date}</div>
      <div>
        {outcome && <strong className={`rating-chart__tooltip-outcome rating-chart__tooltip-outcome--${outcome}`}>{OUTCOME_LABEL[outcome]}</strong>}
        {' '}vs {c.opponent} ({scoreText(c.game, teamName)})
      </div>
      <div className="rating-chart__tooltip-value">
        implied {c.implied > 0 ? `+${c.implied.toFixed(2)}` : c.implied.toFixed(2)}
        {' '}(opponent {c.opponentRating > 0 ? `+${c.opponentRating}` : c.opponentRating} {c.margin > 0 ? `+${c.margin}` : c.margin})
      </div>
    </>
  )
}

interface TooltipState {
  index: number
  x: number
  y: number
}

function ContributionChart({
  contributions,
  teamName,
  finalRating,
}: {
  contributions: GameContribution[]
  teamName: string
  finalRating: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const deviations = contributions.map((c) => c.implied - finalRating)
  const maxAbs = Math.max(1, ...deviations.map((d) => Math.abs(d)))

  const slotWidth = 28
  const barWidth = 18
  const height = 220
  const marginTop = 16
  const marginBottom = 24
  const innerHeight = height - marginTop - marginBottom
  const midY = marginTop + innerHeight / 2
  const width = Math.max(320, contributions.length * slotWidth + 16)

  const yFor = (deviation: number) => midY - (deviation / maxAbs) * (innerHeight / 2)

  const showTooltip = (index: number, el: SVGRectElement) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (!wrapRect) return
    setTooltip({ index, x: elRect.left - wrapRect.left + elRect.width / 2, y: elRect.top - wrapRect.top })
  }

  return (
    <div className="rating-chart__wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="rating-chart__svg" role="img" aria-label={`Per-game rating contribution for ${teamName}`}>
        <line x1={0} y1={midY} x2={width} y2={midY} className="rating-chart__baseline" />
        {contributions.map((c, i) => {
          const deviation = deviations[i]
          const x = 8 + i * slotWidth + (slotWidth - barWidth) / 2
          const y0 = yFor(0)
          const y1 = yFor(deviation)
          const barY = Math.min(y0, y1)
          const barHeight = Math.max(1, Math.abs(y1 - y0))
          const positive = deviation >= 0
          return (
            <rect
              key={c.game.gameId}
              x={x}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill={positive ? POSITIVE_COLOR : NEGATIVE_COLOR}
              tabIndex={0}
              role="img"
              aria-label={`${c.game.date} vs ${c.opponent}, ${scoreText(c.game, teamName)}, ${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)} vs current rating`}
              className={tooltip?.index === i ? 'rating-chart__bar rating-chart__bar--active' : 'rating-chart__bar'}
              onMouseEnter={(e) => showTooltip(i, e.currentTarget)}
              onFocus={(e) => showTooltip(i, e.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onBlur={() => setTooltip(null)}
            />
          )
        })}
      </svg>
      {tooltip && (
        <div className="rating-chart__tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <TooltipContent c={contributions[tooltip.index]} teamName={teamName} />
        </div>
      )}
    </div>
  )
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

  const showTooltip = (index: number, el: SVGCircleElement) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (!wrapRect) return
    setTooltip({ index, x: elRect.left - wrapRect.left + elRect.width / 2, y: elRect.top - wrapRect.top })
  }

  return (
    <div className="rating-chart__wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="rating-chart__svg" role="img" aria-label={`Rating trajectory for ${teamName}`}>
        {zeroVisible && <line x1={0} y1={yFor(0)} x2={width} y2={yFor(0)} className="rating-chart__baseline" />}
        <path d={areaPath} fill={POSITIVE_COLOR} opacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={POSITIVE_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {trajectory.map((t, i) => (
          <circle
            key={t.contribution.game.gameId}
            cx={xFor(i)}
            cy={yFor(t.runningRating)}
            r={5}
            fill={POSITIVE_COLOR}
            strokeWidth={2}
            tabIndex={0}
            role="img"
            aria-label={`${t.contribution.game.date} vs ${t.contribution.opponent}, rating ${t.runningRating > 0 ? '+' : ''}${t.runningRating}`}
            className={tooltip?.index === i ? 'rating-chart__dot rating-chart__dot--active' : 'rating-chart__dot'}
            onMouseEnter={(e) => showTooltip(i, e.currentTarget)}
            onFocus={(e) => showTooltip(i, e.currentTarget)}
            onMouseLeave={() => setTooltip(null)}
            onBlur={() => setTooltip(null)}
          />
        ))}
      </svg>
      {tooltip && (
        <div className="rating-chart__tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="rating-chart__tooltip-date">{trajectory[tooltip.index].contribution.game.date}</div>
          <div>
            vs {trajectory[tooltip.index].contribution.opponent} ({scoreText(trajectory[tooltip.index].contribution.game, teamName)})
          </div>
          <div className="rating-chart__tooltip-value">
            rating after this game: {trajectory[tooltip.index].runningRating > 0 ? '+' : ''}
            {trajectory[tooltip.index].runningRating}
          </div>
        </div>
      )}
    </div>
  )
}

export function RatingChart({
  contributions,
  trajectory,
  teamName,
  finalRating,
}: {
  contributions: GameContribution[]
  trajectory: TrajectoryPoint[]
  teamName: string
  finalRating: number
}) {
  const [tab, setTab] = useState<Tab>('contribution')
  const [showTable, setShowTable] = useState(false)

  if (contributions.length === 0) {
    return null
  }

  return (
    <div className="rating-chart">
      <div className="rating-chart__header">
        <div className="rating-chart__tabs" role="tablist" aria-label="Rating chart view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'contribution'}
            className={tab === 'contribution' ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active' : 'rankings-filter__toggle-btn'}
            onClick={() => setTab('contribution')}
          >
            Per-game contribution
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'trajectory'}
            className={tab === 'trajectory' ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active' : 'rankings-filter__toggle-btn'}
            onClick={() => setTab('trajectory')}
          >
            Season trajectory
          </button>
        </div>
        <button type="button" className="rating-chart__table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </div>

      {tab === 'contribution' && (
        <>
          <p className="rating-chart__caption">
            Each bar is one played game, valued at today's opponent ratings: how far that game's implied result sits
            above or below {teamName}'s current rating ({finalRating > 0 ? `+${finalRating}` : finalRating}).
          </p>
          <div className="rating-chart__legend">
            <span className="rating-chart__legend-item">
              <span className="rating-chart__legend-swatch" style={{ background: POSITIVE_COLOR }} /> Pulled rating up
            </span>
            <span className="rating-chart__legend-item">
              <span className="rating-chart__legend-swatch" style={{ background: NEGATIVE_COLOR }} /> Pulled rating down
            </span>
          </div>
          <ContributionChart contributions={contributions} teamName={teamName} finalRating={finalRating} />
        </>
      )}

      {tab === 'trajectory' && (
        <>
          <p className="rating-chart__caption">
            An approximate running rating after each game, using today's opponent ratings throughout (not re-derived
            as of each date) -- shows the shape of the season, calibrated to land exactly on {teamName}'s current
            rating at the last game.
          </p>
          <TrajectoryChart trajectory={trajectory} teamName={teamName} />
        </>
      )}

      {showTable && (
        <table className="rating-chart__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Result</th>
              {tab === 'contribution' ? <th>vs current rating</th> : <th>Running rating</th>}
            </tr>
          </thead>
          <tbody>
            {(tab === 'contribution' ? contributions : trajectory.map((t) => t.contribution)).map((c, i) => {
              const outcome = outcomeFor(c.game, teamName)
              const value = tab === 'contribution' ? c.implied - finalRating : trajectory[i].runningRating
              return (
                <tr key={c.game.gameId}>
                  <td>{c.game.date}</td>
                  <td>{c.opponent}</td>
                  <td>
                    {outcome ? OUTCOME_LABEL[outcome] : '?'} {scoreText(c.game, teamName)}
                  </td>
                  <td>{value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
