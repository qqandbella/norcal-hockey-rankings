import { useState } from 'react'
import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { DivisionNav } from './components/DivisionNav'
import { DZoneTrainer } from './components/DZoneTrainer'
import { HelpPage } from './components/HelpPage'
import { PredictPage } from './components/PredictPage'
import { RankingsTable } from './components/RankingsTable'
import type { RatingMode } from './components/RankingsTable'
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

function DivisionPage({ data, ratingMode }: { data: RankingsData; ratingMode: RatingMode }) {
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
      <RankingsTable
        division={division}
        selectedType={selectedType}
        onSelectedTypeChange={setSelectedType}
        ratingMode={ratingMode}
      />
      <ScheduleList games={division.games} homeLevelLabel={division.levelLabel} />
    </section>
  )
}

function TeamPageRoute({ data, ratingMode }: { data: RankingsData; ratingMode: RatingMode }) {
  const { age, level } = useParams()
  const division = findDivision(data, age, level)
  if (!division) {
    return <p className="empty-state">No data for {age} {level}.</p>
  }
  return <TeamPage data={data} homeDivision={division} ratingMode={ratingMode} />
}

function Overview({ data }: { data: RankingsData }) {
  const firstDivision = data.divisions[0]
  if (!firstDivision) return <p className="empty-state">No divisions found.</p>
  return <Navigate to={`/${firstDivision.ageLabel}/${firstDivision.levelLabel}`} replace />
}

export default function App() {
  const { data, loading, error } = useRankingsData()
  const [ratingMode, setRatingMode] = useState<RatingMode>('classic')
  const experimental = ratingMode === 'experimental'

  return (
    <HashRouter>
      <div className="app">
        <header className="app__header">
          <div className="app__title-row">
            <h1>NorCal Hockey Rankings</h1>
            <span className="app__header-links">
              <Link to="/dzone" className="app__help-link">
                D-Zone Trainer
              </Link>
              <Link to="/help" className="app__help-link">
                Help / FAQ
              </Link>
            </span>
          </div>
          <p className="app__subtitle">
            Calibrated ratings from results, computed with a capped, shrinkage-regularized
            iterative model (MHR-style), alongside traditional W-L-T stats. New here? See{' '}
            <Link to="/help">how ratings and predictions are calculated</Link>.
          </p>
          <div className="rankings-filter__rating-toggle" role="group" aria-label="Rating model">
            <button
              type="button"
              className={
                !experimental
                  ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active'
                  : 'rankings-filter__toggle-btn'
              }
              onClick={() => setRatingMode('classic')}
            >
              Classic rating
            </button>
            <button
              type="button"
              className={
                experimental
                  ? 'rankings-filter__toggle-btn rankings-filter__toggle-btn--active'
                  : 'rankings-filter__toggle-btn'
              }
              onClick={() => setRatingMode('experimental')}
            >
              Try experimental rating
            </button>
          </div>
          {experimental && (
            <p className="rankings-table__experimental-note">
              <strong>Experimental:</strong> splits each team's rating into separate offense and defense
              components instead of one combined number -- backtest-validated to predict held-out games
              better than the classic rating within a division (see <Link to="/help">Help</Link> for how).
              Cross-division comparisons and the Predict page reuse the classic model's tier-offset
              machinery on this rating, which hasn't been separately validated the same way.
            </p>
          )}
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
                <Route path="/:age/:level" element={<DivisionPage data={data} ratingMode={ratingMode} />} />
                <Route
                  path="/:age/:level/team/:team"
                  element={<TeamPageRoute data={data} ratingMode={ratingMode} />}
                />
                <Route path="/predict/:age" element={<PredictPage data={data} ratingMode={ratingMode} />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/dzone" element={<DZoneTrainer />} />
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
