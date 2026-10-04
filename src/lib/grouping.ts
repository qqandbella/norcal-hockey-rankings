import type { Division } from './types'

// Top to bottom. Mirrors scripts/ratings.py's DIVISION_HIERARCHY -- keep
// both in sync if this list changes. "B East" is a real tier above "B West"
// (only B East's top finishers reach the state playoff), not a geographic
// alias of "B" -- see ratings.py's own comment on DIVISION_HIERARCHY.
export const LEVEL_ORDER = ['AA', 'A', 'BB', 'B East', 'B West', 'B']

function ageSortKey(ageLabel: string): number {
  const match = /^(\d+)/.exec(ageLabel)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function levelSortKey(levelLabel: string): number {
  const idx = LEVEL_ORDER.indexOf(levelLabel)
  return idx === -1 ? LEVEL_ORDER.length : idx
}

export interface AgeGroup {
  ageLabel: string
  divisions: Division[]
}

export function groupByAge(divisions: Division[]): AgeGroup[] {
  const byAge = new Map<string, Division[]>()
  for (const div of divisions) {
    const list = byAge.get(div.ageLabel) ?? []
    list.push(div)
    byAge.set(div.ageLabel, list)
  }
  const groups = Array.from(byAge.entries()).map(([ageLabel, divs]) => ({
    ageLabel,
    divisions: divs.sort((a, b) => levelSortKey(a.levelLabel) - levelSortKey(b.levelLabel)),
  }))
  return groups.sort((a, b) => ageSortKey(a.ageLabel) - ageSortKey(b.ageLabel))
}

export function divisionRoute(div: Pick<Division, 'ageLabel' | 'levelLabel'>): string {
  return `/${encodeURIComponent(div.ageLabel)}/${encodeURIComponent(div.levelLabel)}`
}

/** Team pages are indexed purely by team name, never by a division --
 * a game's own `levelLabel` is TTS's raw per-game "Division" column text,
 * which can name a division that no longer exists as its own page (e.g.
 * "B" for a game filed before a legacy level got split into "B East"/"B
 * West") even though the team itself is still very much on the site.
 * TeamPage resolves its own current division(s) internally instead of
 * trusting whatever division happened to be in the URL. */
export function teamRoute(teamName: string): string {
  return `/team/${encodeURIComponent(teamName)}`
}
