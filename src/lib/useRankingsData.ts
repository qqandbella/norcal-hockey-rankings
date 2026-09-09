import { useCallback, useEffect, useState } from 'react'
import type { RankingsData } from './types'

interface RankingsState {
  data: RankingsData | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const DATA_URL = `${import.meta.env.BASE_URL}data/latest.json`

export function useRankingsData(): RankingsState {
  const [data, setData] = useState<RankingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((bustCache: boolean) => {
    setLoading(true)
    setError(null)
    const url = bustCache ? `${DATA_URL}?cb=${Date.now()}` : DATA_URL
    fetch(url, { cache: bustCache ? 'no-store' : 'default' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load rankings data (${res.status})`)
        return res.json() as Promise<RankingsData>
      })
      .then((parsed) => setData(parsed))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, error, refresh }
}
