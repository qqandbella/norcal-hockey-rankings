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

export function teamRoute(div: Pick<Division, 'ageLabel' | 'levelLabel'>, teamName: string): string {
  return `${divisionRoute(div)}/team/${encodeURIComponent(teamName)}`
}
