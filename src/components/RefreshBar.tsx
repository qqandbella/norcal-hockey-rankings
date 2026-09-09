interface RefreshBarProps {
  scrapedAt: string | null
  loading: boolean
  onRefresh: () => void
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function RefreshBar({ scrapedAt, loading, onRefresh }: RefreshBarProps) {
  return (
    <div className="refresh-bar">
      <span className="refresh-bar__timestamp">
        {scrapedAt ? `Last updated ${formatTimestamp(scrapedAt)}` : 'Loading...'}
      </span>
      <button type="button" onClick={onRefresh} disabled={loading} className="refresh-bar__button">
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
