import { describe, expect, it } from 'vitest'
import { idealBoxPositions } from './dzonePositioning'
import { DZONE_SNAPSHOTS, SNAPSHOT_GEO } from './dzoneSnapshots'

describe('golden snapshot replay (idealBoxPositions against reasoned game moments)', () => {
  for (const snapshot of DZONE_SNAPSHOTS) {
    it(snapshot.name, () => {
      const pos = idealBoxPositions(snapshot.puck, snapshot.others, SNAPSHOT_GEO)
      const failures = snapshot.assertions.filter((a) => !a.check(pos, SNAPSHOT_GEO)).map((a) => a.description)
      if (failures.length > 0) {
        const dump = JSON.stringify({ puck: snapshot.puck, others: snapshot.others, pos }, null, 2)
        throw new Error(
          `[${snapshot.name}]\nReasoning: ${snapshot.reasoning}\nFailed assertions:\n- ${failures.join('\n- ')}\n\nComputed positions:\n${dump}`,
        )
      }
      expect(failures).toEqual([])
    })
  }
})
