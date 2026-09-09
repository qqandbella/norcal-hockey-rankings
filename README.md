# NorCal Hockey Rankings

Calibrated rankings for NorCal youth hockey divisions, built from preseason
and in-season results. Live at
[qqandbella.github.io/norcal-hockey-rankings](https://qqandbella.github.io/norcal-hockey-rankings/).

## Why not a plain win/loss table?

Teams entering a new season (especially preseason) aren't calibrated against
each other at all, so raw win/loss/goal-differential doesn't mean much with
only a handful of games per team. Instead, each division's ratings are
computed with an iterative, capped, shrinkage-regularized model in the same
family as MyHockeyRankings:

- A team's rating is the average of `(opponent rating + goal differential)`
  across its games, iterated to convergence.
- Goal differential is capped at ±7 — beyond that, extra goals mostly reflect
  lineup/ice-time decisions late in a blowout, not additional signal about
  relative strength.
- A ridge shrinkage term pulls a team's rating toward the division average in
  proportion to how few games it has played, so a single lopsided result with
  a 2-3 game sample doesn't swing the rating as if it were a full season.

Traditional counting stats (W-L-T, points, GF/GA/GD) are also shown alongside
the rating — those use standard hockey scoring (win=2, tie=1, loss=0) and the
real, uncapped goal differential, independent of the rating model above. See
`compute_team_stats` in `scripts/ratings.py`.

Each division has a **game-type filter** (All / Preseason / Regular / ... —
whatever types are actually present in that division's schedule, discovered
from the source data rather than a fixed list). Ratings and stats are
precomputed server-side for each type plus an "All" bucket, so switching the
filter doesn't require running anything client-side.

Every team name links to a **team page** showing that team's full schedule
and stats — including, where resolved, an outbound link to that team's
official page on `stats.caha.timetoscore.com`. On a team's own page, its
schedule rows are color-coded by result (green win / red loss / yellow tie)
from that team's perspective, its own name is bolded, and there's a result
filter (win only / lose only / win-or-tie).

A team's schedule is aggregated **across every division on the site**, not
just its "home" one — teams sometimes play a cross-level test game that TTS
files under a different division entirely (e.g. a B team's game against a BB
opponent gets filed under BB, not B), or move levels mid-season. Each game
row is tagged with the division it's actually filed under, and links from
that row use that game's own division rather than the team's home one.

See `scripts/ratings.py` for the implementation and `scripts/test_ratings.py`
for a regression fixture built from real results.

### Cross-division predictor

Each division's rating is centered to that division's own mean, so a B
team's +2 and a BB team's +2 aren't directly comparable on their own.
Cross-division test games (a B team's game filed under BB, or vice versa —
see above) are real bridges between those otherwise-separate scales. For
each age group (10U, 12U, ...), `compute_age_group_ratings` in
`scripts/scrape.py` pools every division's played games (bridges included)
and runs the same rating model once over the combined graph, giving one
unified, cross-division-comparable rating per team, plus a `componentId`
(union-find over the same graph) marking which teams are actually
bridge-connected this season versus not.

- **Predict page** (`/predict/<age>`, linked from the nav and from each
  team's own page): pick any two teams in an age group, even across
  divisions, and see the predicted goal differential.
- **Inline on team pages**: every scheduled-but-unplayed game on a team's own
  schedule shows a tentative predicted margin the same way.
- Confidence is always shown: `direct` (same division), `bridged`
  (different division, same component — real evidence ties the scales
  together), or `unbridged` (different component — no bridge game has been
  played yet, so the comparison silently assumes the two divisions' average
  teams are equal; still shown, but flagged).

Only *played* cross-division games count as bridges — a merely scheduled one
doesn't connect anything until it's actually played and scraped, so
`unbridged` pairs naturally flip to `bridged` as the season's test games
happen. See `compute_components` in `scripts/ratings.py` and
`compute_age_group_ratings` in `scripts/scrape.py`.

## Data source

Data comes from `www.norcalyouthhockey.org` (the NorCal Youth Hockey
Association's own site), specifically the same `load-tts-schedule.php`
endpoint its own `Schedules.php` page calls via AJAX on every page load.
`scripts/scrape.py` runs every 12h via GitHub Actions
(`.github/workflows/scrape.yml`), writes `public/data/latest.json`, and
commits it back to `main`, which triggers a rebuild/redeploy
(`.github/workflows/deploy.yml`).

The site itself never talks to any upstream data source directly, and there
is currently no live/on-demand refresh from the public site — the "Data as
of" line just reflects whatever `scrape.yml` last committed. A repository
collaborator with write access can force an out-of-cycle scrape any time via
the Actions tab (**Scrape rankings data** → **Run workflow**), or:

```bash
gh workflow run scrape.yml --repo qqandbella/norcal-hockey-rankings
```

(A client-triggered on-demand refresh was considered but requires holding a
credential somewhere — either exposed in the public site's JS, or in a small
backend proxy that doesn't exist yet. Revisit if that tradeoff becomes worth
it.)

### Team IDs (for the outbound TTS link)

`scripts/team_ids.json` maps team name → TTS's own numeric team id, so team
pages can link out to `stats.caha.timetoscore.com/display-schedule?team=...`.
Unlike everything else in this project, resolving that mapping requires
querying `stats.caha.timetoscore.com` directly (its `robots.txt` disallows
crawling, which is exactly why the regular scraper never touches it) — so
this is deliberately **not** part of `scrape.yml`. It's a one-off/rarely-run
script instead:

```bash
python3 scripts/build_team_ids.py   # single direct request, run by hand
```

TTS assigns each season's teams new ids, so re-run this roughly once per
season (existing entries just silently stop matching if a team's id changes;
nothing breaks, the outbound link just disappears for that team until the
mapping is refreshed).

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # vitest
npm run build     # production build to dist/

python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
pytest scripts/                 # rating algorithm tests
python scripts/scrape.py        # refresh public/data/latest.json locally
```
