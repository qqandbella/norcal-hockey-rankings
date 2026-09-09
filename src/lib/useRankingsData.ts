import { useEffect, useState } from 'react'
import type { RankingsData } from './types'

interface RankingsState {
  data: RankingsData | null
  loading: boolean
  error: string | null
}

const DATA_URL = `${import.meta.env.BASE_URL}data/latest.json`

/**
 * Loads the last committed rankings snapshot once per page load. Data itself
 * only ever updates via the scheduled scrape.yml GitHub Action (see README) --
 * there's no live/on-demand re-scrape from the site.
 */
export function useRankingsData(): RankingsState {
  const [data, setData] = useState<RankingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load rankings data (${res.status})`)
        return res.json() as Promise<RankingsData>
      })
      .then((parsed) => setData(parsed))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  return { data, loading, error }
}
