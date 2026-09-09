import { NavLink } from 'react-router-dom'
import type { AgeGroup } from '../lib/grouping'
import { divisionRoute } from '../lib/grouping'

interface DivisionNavProps {
  ageGroups: AgeGroup[]
}

export function DivisionNav({ ageGroups }: DivisionNavProps) {
  return (
    <nav className="division-nav">
      {ageGroups.map((group) => (
        <div key={group.ageLabel} className="division-nav__group">
          <div className="division-nav__age">{group.ageLabel}</div>
          <div className="division-nav__levels">
            {group.divisions.map((div) => (
              <NavLink
                key={div.levelId}
                to={divisionRoute(div)}
                className={({ isActive }) =>
                  isActive ? 'division-nav__link division-nav__link--active' : 'division-nav__link'
                }
              >
                {div.levelLabel}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}
