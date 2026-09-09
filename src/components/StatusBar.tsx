interface StatusBarProps {
  scrapedAt: string | null
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// Data only ever updates via the scheduled scrape.yml Action (see README) --
// there's no live "refresh" trigger from the public site, so this is a plain
// status line, not a control.
export function StatusBar({ scrapedAt }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span className="status-bar__timestamp">
        {scrapedAt ? `Data as of ${formatTimestamp(scrapedAt)}` : 'Loading...'}
      </span>
    </div>
  )
}
