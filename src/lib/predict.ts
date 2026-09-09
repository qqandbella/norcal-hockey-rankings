import { LEVEL_ORDER } from './grouping'
import type { AgeGroupRatings, TierOffset } from './types'

export type Confidence = 'direct' | 'prior' | 'bridged'

export interface Prediction {
  /** Positive: teamA favored by this many (capped-scale) goals. */
  margin: number
  marginText: string
  confidence: Confidence
  /** One entry per hierarchy hop crossed between the two teams' tiers
   * (empty when confidence is 'direct') -- the actual evidence trail
   * behind the number, not just a label. */
  hops: TierOffset[]
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  direct: 'Same division',
  bridged: 'Cross-division, backed by real bridge games this season',
  prior: 'Cross-division, no bridge games yet -- resting on the "adjacent tiers overlap" assumption',
}

function hopsBetween(tierOffsets: Record<string, TierOffset>, tierA: string, tierB: string): TierOffset[] {
  const idxA = LEVEL_ORDER.indexOf(tierA)
  const idxB = LEVEL_ORDER.indexOf(tierB)
  if (idxA === -1 || idxB === -1) return []
  const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA]
  // Each adjacent pair's blended gap/evidence is stored at the *higher*
  // tier of that pair (lower LEVEL_ORDER index) -- offsets[T] holds
  // offset[T] - offset[T_below].
  const hops: TierOffset[] = []
  for (let i = lo; i < hi; i++) {
    const hop = tierOffsets[LEVEL_ORDER[i]]
    if (hop) hops.push(hop)
  }
  return hops
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
  tierA: string,
  teamB: string,
  tierB: string,
): Prediction | null {
  const group = ageGroups[ageLabel]
  const ratingA = group?.teams[teamA]
  const ratingB = group?.teams[teamB]
  if (!ratingA || !ratingB) return null

  const margin = Math.round((ratingA.rating - ratingB.rating) * 100) / 100
  const marginText =
    margin === 0 ? 'Even matchup' : `${margin > 0 ? teamA : teamB} favored by ${Math.abs(margin)}`

  if (tierA === tierB) {
    return { margin, marginText, confidence: 'direct', hops: [] }
  }

  const hops = hopsBetween(group.tierOffsets, tierA, tierB)
  const minEvidence = hops.length > 0 ? Math.min(...hops.map((h) => h.evidenceCount)) : 0
  const confidence: Confidence = minEvidence > 0 ? 'bridged' : 'prior'

  return { margin, marginText, confidence, hops }
}
