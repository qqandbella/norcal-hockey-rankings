import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { DivisionNav } from './components/DivisionNav'
import { RankingsTable } from './components/RankingsTable'
import { StatusBar } from './components/StatusBar'
import { ScheduleList } from './components/ScheduleList'
import { TeamPage } from './components/TeamPage'
import { groupByAge } from './lib/grouping'
import { useRankingsData } from './lib/useRankingsData'
import type { RankingsData } from './lib/types'
import { ALL_TYPES } from './lib/types'

declare const __BUILD_ID__: string

function findDivision(data: RankingsData, age: string | undefined, level: string | undefined) {
  return data.divisions.find((d) => d.ageLabel === age && d.levelLabel === level)
}

function DivisionPage({ data }: { data: RankingsData }) {
  const { age, level } = useParams()
  const [selectedType, setSelectedType] = useState(ALL_TYPES)
  const division = findDivision(data, age, level)

  if (!division) {
    return <p className="empty-state">No data for {age} {level}.</p>
  }

  return (
    <section>
      <h2>
        {division.ageLabel} {division.levelLabel}
      </h2>
      <RankingsTable division={division} selectedType={selectedType} onSelectedTypeChange={setSelectedType} />
      <ScheduleList games={division.games} homeLevelLabel={division.levelLabel} />
    </section>
  )
}

function TeamPageRoute({ data }: { data: RankingsData }) {
  const { age, level } = useParams()
  const division = findDivision(data, age, level)
  if (!division) {
    return <p className="empty-state">No data for {age} {level}.</p>
  }
  return <TeamPage data={data} homeDivision={division} />
}

function Overview({ data }: { data: RankingsData }) {
  const firstDivision = data.divisions[0]
  if (!firstDivision) return <p className="empty-state">No divisions found.</p>
  return <Navigate to={`/${firstDivision.ageLabel}/${firstDivision.levelLabel}`} replace />
}

export default function App() {
  const { data, loading, error } = useRankingsData()

  return (
    <HashRouter>
      <div className="app">
        <header className="app__header">
          <h1>NorCal Hockey Rankings</h1>
          <p className="app__subtitle">
            Calibrated ratings from results, computed with a capped, shrinkage-regularized
            iterative model (MHR-style), alongside traditional W-L-T stats.
          </p>
          <StatusBar scrapedAt={data?.scraped_at ?? null} />
        </header>

        {loading && <p className="empty-state">Loading...</p>}
        {error && <p className="error-banner">Couldn&apos;t load rankings: {error}</p>}

        {data && (
          <div className="app__body">
            <DivisionNav ageGroups={groupByAge(data.divisions)} />
            <main className="app__main">
              <Routes>
                <Route path="/" element={<Overview data={data} />} />
                <Route path="/:age/:level" element={<DivisionPage data={data} />} />
                <Route path="/:age/:level/team/:team" element={<TeamPageRoute data={data} />} />
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
