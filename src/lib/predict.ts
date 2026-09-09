import type { AgeGroupRatings } from './types'

export type Confidence = 'direct' | 'bridged' | 'unbridged'

export interface Prediction {
  /** Positive: teamA favored by this many (capped-scale) goals. */
  margin: number
  marginText: string
  confidence: Confidence
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  direct: 'Same division',
  bridged: 'Cross-division, connected by bridge games this season',
  unbridged: 'No bridge games yet -- assumes divisions are equal on average',
}

/**
 * Predicted margin (teamA - teamB) from each team's unified, cross-division
 * rating for their shared age group. Returns null if either team hasn't
 * played any rated game yet (no unified rating to compare).
 */
export function predictMatchup(
  ageGroups: Record<string, AgeGroupRatings>,
  ageLabel: string,
  teamA: string,
  teamB: string,
  sameDivision: boolean,
): Prediction | null {
  const teams = ageGroups[ageLabel]?.teams
  const ratingA = teams?.[teamA]
  const ratingB = teams?.[teamB]
  if (!ratingA || !ratingB) return null

  const margin = Math.round((ratingA.rating - ratingB.rating) * 100) / 100
  const confidence: Confidence = sameDivision
    ? 'direct'
    : ratingA.componentId === ratingB.componentId
      ? 'bridged'
      : 'unbridged'

  const marginText =
    margin === 0
      ? 'Even matchup'
      : `${margin > 0 ? teamA : teamB} favored by ${Math.abs(margin)}`

  return { margin, marginText, confidence }
}
