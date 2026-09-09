import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CONFIDENCE_LABEL, predictMatchup } from '../lib/predict'
import { ALL_TYPES } from '../lib/types'
import type { RankingsData, TierOffset } from '../lib/types'

interface TeamOption {
  name: string
  levelLabel: string
}

function teamOptionsByLevel(data: RankingsData, ageLabel: string): Map<string, TeamOption[]> {
  const byLevel = new Map<string, TeamOption[]>()
  for (const division of data.divisions) {
    if (division.ageLabel !== ageLabel) continue
    const teams = division.ratingsByType[ALL_TYPES]?.teams ?? []
    byLevel.set(
      division.levelLabel,
      teams.map((t) => ({ name: t.name, levelLabel: division.levelLabel })),
    )
  }
  return byLevel
}

function TeamSelect({
  id,
  label,
  byLevel,
  value,
  onChange,
}: {
  id: string
  label: string
  byLevel: Map<string, TeamOption[]>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="predict__picker">
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select a team...</option>
        {Array.from(byLevel.entries()).map(([levelLabel, teams]) => (
          <optgroup key={levelLabel} label={levelLabel}>
            {teams.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function HopExplanation({ hop }: { hop: TierOffset }) {
  return (
    <div className="predict__hop">
      {hop.bridgeGames.length > 0 && (
        <>
          <p className="predict__hop-heading">
            {hop.bridgeGames.length} cross-division game{hop.bridgeGames.length > 1 ? 's' : ''} this season:
          </p>
          <ul className="predict__evidence-list">
            {hop.bridgeGames.map((g, i) => (
              <li key={i}>
                <strong>{g.homeTeam}</strong> ({g.homeTier}) vs <strong>{g.awayTeam}</strong> ({g.awayTier}):
                margin {g.margin > 0 ? `+${g.margin}` : g.margin} -&gt; implied gap {g.impliedGap}
              </li>
            ))}
          </ul>
        </>
      )}
      {hop.priorAnchor && (
        <p className="predict__hop-prior">
          Default assumption (no bridge evidence overrides it): <strong>{hop.priorAnchor.lowTeam}</strong> (top of
          the lower tier, {hop.priorAnchor.lowRating}) &asymp; <strong>{hop.priorAnchor.highTeam}</strong> (bottom
          of the higher tier, {hop.priorAnchor.highRating}) &rarr; assumed gap {hop.priorAnchor.gap}.
        </p>
      )}
      <p className="predict__hop-blend">
        Blended offset used: <strong>{hop.offset}</strong>
        {hop.evidenceCount > 0
          ? ` (pulled toward the ${hop.evidenceCount} real game${hop.evidenceCount > 1 ? 's' : ''} above, but still anchored by the default assumption)`
          : ' (pure default assumption -- no real games connect these tiers yet)'}
      </p>
    </div>
  )
}

export function PredictPage({ data }: { data: RankingsData }) {
  const { age } = useParams()
  const [searchParams] = useSearchParams()
  const ageLabel = age ?? ''
  const byLevel = teamOptionsByLevel(data, ageLabel)
  const [teamA, setTeamA] = useState(searchParams.get('a') ?? '')
  const [teamB, setTeamB] = useState(searchParams.get('b') ?? '')

  const findLevel = (name: string) =>
    Array.from(byLevel.entries()).find(([, teams]) => teams.some((t) => t.name === name))?.[0]

  const levelA = teamA ? findLevel(teamA) : undefined
  const levelB = teamB ? findLevel(teamB) : undefined
  const prediction =
    teamA && teamB && teamA !== teamB && levelA && levelB
      ? predictMatchup(data.ageGroups, ageLabel, teamA, levelA, teamB, levelB)
      : null

  if (byLevel.size === 0) {
    return <p className="empty-state">No divisions found for {ageLabel}.</p>
  }

  return (
    <section>
      <h2>{ageLabel} Predictor</h2>
      <p className="empty-state">
        Predicts the expected goal differential between any two {ageLabel} teams, even across divisions. Each
        division's rating is centered to its own mean, so cross-division comparisons use a per-tier offset that
        defaults to "a tier's bottom is on par with the tier above's top", refined by real cross-division games
        where any exist. See each team's page for the within-division model itself.
      </p>

      <div className="predict__pickers">
        <TeamSelect id="predict-team-a" label="Home team" byLevel={byLevel} value={teamA} onChange={setTeamA} />
        <TeamSelect id="predict-team-b" label="Away team" byLevel={byLevel} value={teamB} onChange={setTeamB} />
      </div>

      {teamA && teamB && teamA === teamB && <p className="empty-state">Pick two different teams.</p>}

      {teamA && teamB && teamA !== teamB && !prediction && (
        <p className="empty-state">One of these teams hasn't played a rated game yet -- no prediction available.</p>
      )}

      {prediction && (
        <div className="predict__result">
          <p className="predict__margin">{prediction.marginText}</p>
          <p className={`predict__confidence predict__confidence--${prediction.confidence}`}>
            {CONFIDENCE_LABEL[prediction.confidence]}
          </p>
          {prediction.hops.map((hop, i) => (
            <HopExplanation key={i} hop={hop} />
          ))}
        </div>
      )}
    </section>
  )
}
