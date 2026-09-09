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
- That shrinkage is **variance-aware**, not uniform: a team whose games all
  point the same direction (e.g. capped wins over several different
  opponents) is shrunk less than a team with the same game count but a
  scattered, inconsistent record (one blowout win, one blowout loss, one
  close game) — a fixed shrinkage constant treated both identically, which
  understated genuinely dominant/weak teams and overstated teams whose one
  bad (or good) result was really just an outlier game against an unusually
  strong (or weak) opponent. Bounds (`MIN_SHRINKAGE_RATIO`/`MAX_SHRINKAGE_RATIO`
  in `scripts/ratings.py`) picked via `scripts/backtest.py` grid search, not
  guessed — real, validated improvement (MAE 3.84→3.45 goals, directional
  accuracy 68%→72% on live data), not just a better-looking spread.
- **Tier labels (top/mid/low) come from the two largest natural gaps** in a
  division's sorted ratings, not an exact one-third-of-teams-each rank split
  — a team just past an arbitrary rank cutoff, but barely different in
  rating from the tier above it, no longer gets mislabeled a full tier down
  from a near-identical peer.

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
Likewise, a team rated in more than one division (a cross-tested team, like
the real San Mateo Black Stars 10-2 case) gets one rating block per division
it's actually rated in, not just whichever one the page was reached from —
each labeled with, and linking to, its own division.

See `scripts/ratings.py` for the implementation and `scripts/test_ratings.py`
for a regression fixture built from real results.

### Cross-division predictor

Each division's rating is centered to that division's own mean, so a B
team's +2 and a BB team's +2 aren't directly comparable on their own — and
naively pooling every division's games into one flat graph (an earlier
version of this) is actively wrong: it lets a single noisy team's small
sample set the *entire* scale offset between two divisions, with no
knowledge that divisions are ranked (A > BB > B) at all. Concretely: that
version once predicted a bottom-of-BB team to lose by ~4.6 to a mid-B team,
resting entirely on one team's one-off blowout game — flatly contradicted by
a simple manual cross-check.

The fix (`compute_tier_offsets` in `scripts/ratings.py`): decompose a team's
unified rating into `(within-division rating) + (tier offset)`. Each
adjacent tier-pair's offset defaults to the empirical rule of thumb "a
tier's bottom is on par with the tier above's top", sourced from a
**pooled, multi-age-group historical constant** (`HISTORICAL_TIER_GAP`) —
the trimmed (2nd-best/2nd-worst, not literal extremes) gap averaged across
all age groups in a full completed past season
(`scripts/historical_tier_gap.py`), rather than derived from the *current*
season's own 3-games-per-team sample. That in-season derivation was tried
first and is still the fallback when no historical value exists for a tier
pair, but it broke once variance-aware shrinkage (below) correctly widened
a division's spread: with two genuinely distinct top-of-division teams both
now legitimately extreme, the trim's "2nd-best" landed on the *other*
outlier instead of a representative typical-top-team, inflating one
division's offset well past what any real evidence supported (concretely:
BB's offset briefly hit +11.98, correctly identified as implausible from a
specific Capital Thunder 10-1 vs LBD prediction) — a fixed historical
constant isn't vulnerable to this because it doesn't move with a single
season's noisy extremes at all.

This then blends toward real evidence in proportion to how much
exists — each team's *primary* tier (wherever it
has the most games) anchors it, and a game only becomes bridge evidence when
the two sides' primary tiers actually differ, so a cross-tested team's
*ordinary* same-tier games are never mistaken for cross-division evidence.
One or two noisy bridge games barely move the default; real, repeated
evidence can.

- **Predict page** (`/predict/<age>`, linked from the nav and from each
  team's own page): pick any two teams in an age group, even across
  divisions, and see the predicted goal differential.
- **Inline on team pages**: every scheduled-but-unplayed game on a team's own
  schedule shows a tentative predicted margin the same way, linking through
  to the full prediction.
- **The reasoning is always shown, not just a confidence label**: which two
  teams anchor the default assumption for a tier gap, and every real
  cross-division game backing it (which teams, the actual margin, the
  implied gap) — `direct` (same division), `bridged` (real cross-division
  games exist), or `prior` (no bridge games yet, pure default assumption).

Only *played* cross-division games count as evidence — a merely scheduled
one doesn't connect anything until it's actually played and scraped, so
`prior` pairs naturally flip toward `bridged` as the season's test games
happen. See `compute_tier_offsets` in `scripts/ratings.py` and
`compute_age_group_ratings` in `scripts/scrape.py`.

### Validating the model: walk-forward backtest

With ~3-4 games per team, this is fundamentally a low-data pairwise-ranking
problem (the same regime Elo/TrueSkill were built for), not a big-data one —
the honest way to check whether the model is any good is **walk-forward
validation**: for every played game, in chronological order, refit using
*only* games strictly before it, predict that game's margin, and compare to
what actually happened.

```bash
python3 scripts/backtest.py   # reads public/data/latest.json, no network calls
```

Reports MAE against a naive "predict an even game" baseline and directional
accuracy (did it pick the right favorite), broken out by within-division vs.
cross-division games, so an "it looks plausible" model can't hide behind a
few cherry-picked examples. See `scripts/backtest.py` and
`scripts/test_backtest.py` (the latter tests the *harness* itself — no data
leakage from a held-out game's own result or from games that happen after
it — not prediction accuracy, which is what running the script itself
reports).

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
