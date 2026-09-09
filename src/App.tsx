import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { DivisionNav } from './components/DivisionNav'
import { RankingsTable } from './components/RankingsTable'
import { RefreshBar } from './components/RefreshBar'
import { ScheduleList } from './components/ScheduleList'
import { groupByAge } from './lib/grouping'
import { useRankingsData } from './lib/useRankingsData'
import type { RankingsData } from './lib/types'

declare const __BUILD_ID__: string

function DivisionPage({ data }: { data: RankingsData }) {
  const { age, level } = useParams()
  const division = data.divisions.find((d) => d.ageLabel === age && d.levelLabel === level)

  if (!division) {
    return <p className="empty-state">No data for {age} {level}.</p>
  }

  return (
    <section>
      <h2>
        {division.ageLabel} {division.levelLabel}
      </h2>
      <RankingsTable teams={division.teams} unratedTeams={division.unratedTeams} />
      <ScheduleList games={division.games} />
    </section>
  )
}

function Overview({ data }: { data: RankingsData }) {
  const firstDivision = data.divisions[0]
  if (!firstDivision) return <p className="empty-state">No divisions found.</p>
  return <Navigate to={`/${firstDivision.ageLabel}/${firstDivision.levelLabel}`} replace />
}

export default function App() {
  const { data, loading, error, refresh } = useRankingsData()

  return (
    <HashRouter>
      <div className="app">
        <header className="app__header">
          <h1>NorCal Hockey Rankings</h1>
          <p className="app__subtitle">
            Calibrated ratings from preseason results, computed with a capped, shrinkage-regularized
            iterative model (MHR-style).
          </p>
          <RefreshBar scrapedAt={data?.scraped_at ?? null} loading={loading} onRefresh={refresh} />
        </header>

        {error && <p className="error-banner">Couldn&apos;t load rankings: {error}</p>}

        {data && (
          <div className="app__body">
            <DivisionNav ageGroups={groupByAge(data.divisions)} />
            <main className="app__main">
              <Routes>
                <Route path="/" element={<Overview data={data} />} />
                <Route path="/:age/:level" element={<DivisionPage data={data} />} />
              </Routes>
            </main>
          </div>
        )}

        <footer className="app__footer">
          <span>build {__BUILD_ID__}</span>
        </footer>
      </div>
    </HashRouter>
  )
}
