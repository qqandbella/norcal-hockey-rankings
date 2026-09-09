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
and stats.

See `scripts/ratings.py` for the implementation and `scripts/test_ratings.py`
for a regression fixture built from real results.

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
