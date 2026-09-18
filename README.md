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
season's own 3-games-per-team sample (tried first, and fragile: once
variance-aware shrinkage, below, correctly widened a division's spread, two
genuinely distinct top-of-division teams both became legitimately extreme,
and the trim's "2nd-best" landed on the *other* outlier instead of a
representative typical-top-team, briefly inflating one division's offset to
+11.98 — flagged as implausible from a specific Capital Thunder 10-1 vs LBD
prediction). For a tier pair with no trustworthy historical sample (too
thin, or a brand-new split like a future B East/B West with no history to
draw from at all), the fallback is a **flat default gap of 7** rather than
that fragile in-season derivation — a fixed constant that doesn't move with
a single season's noisy extremes.

This then blends toward real evidence in proportion to how much
exists — each team's *primary* tier (wherever it
has the most games) anchors it, and a game only becomes bridge evidence when
the two sides' primary tiers actually differ, so a cross-tested team's
*ordinary* same-tier games are never mistaken for cross-division evidence.
One or two noisy bridge games barely move the default; real, repeated
evidence can.

A cross-tested team's rating gets the same "trust the established
evidence" treatment, both in its **own unified rating**
(`compute_unified_ratings`) and in **the raw number displayed on the
division it's a guest in** (its division rankings table row, and the
per-division rating block on its own team page —
`compute_corrected_local_ratings`, patched back into that division's own
"All" bucket in `scrape.py`). A team's rating in a tier it barely plays
(one cross-level test game, say) is, by construction, shrunk toward that
tier's own zero mean — correct for a team we know nothing about, wrong once
the team already has an established rating from its primary tier. Naively
averaging the two tiers' raw ratings weighted by games played (for the
unified number), or just displaying that raw, barely-shrunk-off-zero number
outright (on the guest division's own table), then silently discounts a
team's known strength whenever its tier split is uneven. Confirmed on real
data: Tri Valley Blue Devils 10-1 (3 games in A) tied Santa Rosa Flyers
10-1 (BB) in its first BB appearance; its lone, barely-above-zero BB
reading (1 game, shrunk hard toward BB's mean, 1.197) both dragged its
*unified* rating below Flyers1's, and showed as a worse-looking BB rating
than Flyers1's directly on the BB rankings table, despite a strong,
competitive result. Fix: re-express that secondary-tier rating as if it
had been computed with a prior mean of "the primary-tier estimate,
translated onto the secondary tier's own local scale" instead of the
default prior of 0 — reconstructed algebraically from the already-computed
rating (`rating + k*prior/(n+k)`) rather than re-solving the whole
division. Verified: Tri Valley Blue Devils 10-1 now unifies to 10.571,
just above Santa Rosa Flyers 10-1's 10.136, *and* its displayed BB rating
(the number that actually shows up on the BB rankings table) is 3.986,
ranked above Flyers1's 3.351 there too — anchored by its established
A-division strength, nudged by the tie, not swamped by a single low-sample
reading.

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

### Experimental: offense/defense split

The header has a **site-wide Classic rating / Try experimental rating**
toggle (rankings tables, team pages, and the Predict page all respect it).
The classic rating is one number per team; the experimental rating
(`compute_offense_defense_ratings` in `scripts/ratings.py`) splits it into
separate **offense** and **defense** components instead, so a team with
real offensive output but a leaky defense (or vice versa) doesn't collapse
into a single number that looks identical to a team that's just uniformly
weaker. Combined into a single sortable "experimental rating" = offense +
defense (predicted margin against a league-average opponent), tiered via
the same natural-breaks partitioning the classic model uses (see below).

Backtest-validated via `scripts/backtest_offense_defense.py`
(walk-forward, within-division games only): naively reusing the classic
model's `SHRINKAGE_K=3.0` made it strictly worse (MAE 3.84 vs 3.47) —
splitting one signal into two starves each half of data unless shrinkage
is retuned specifically for it. Grid-searching found a real win at
`OFFENSE_DEFENSE_SHRINKAGE_K=0.2`: MAE 3.20 vs 3.47, directional accuracy
77.9% vs 72.1%, flat across k=0.15-0.30 (not a knife's-edge fit to noise).

Deliberately shipped as an **opt-in toggle, not a replacement** — this is
industry-standard practice for a validated-but-newer model (an
"experimental" label a user can switch to and back from), rather than
silently swapping the model everyone already trusts.

**Cross-division reach**: rather than build a full two-sided (offense-gap
and defense-gap tracked separately across tiers) cross-division model, the
experimental rating's combined offense+defense scalar is run through the
exact same `compute_tier_offsets`/`compute_unified_ratings` pipeline the
classic rating already uses (`_compute_unified_and_patch` in
`scripts/scrape.py`, called once per rating type). Lower-risk, 100% code
reuse — but only the within-division split itself has been walk-forward
backtest-validated; this specific cross-division reuse hasn't been,
since there's no cross-division experimental-mode ground truth to check it
against yet. The Predict page and cross-division rankings both surface an
inline note about this when experimental mode is on. Tracked in
[issue #6](https://github.com/qqandbella/norcal-hockey-rankings/issues/6).

### Tier labels: natural-breaks partitioning

Top/mid/low tier labels (both classic and experimental) come from a 3-way
contiguous partition of a division's sorted ratings that minimizes total
within-tier variance (`_assign_tiers` in `scripts/ratings.py`, "natural
breaks" / Fisher-Jenks, solved via a small DP) — not a fixed exact-thirds
split, and not just the two largest adjacent gaps (tried first, and has a
real degenerate failure mode: if the single biggest gap in a division
happens to sit near the bottom, e.g. one or two extreme outlier teams, the
second-biggest gap can also end up positioned low, lumping most of the
division into "top" even though most of those teams aren't meaningfully
different from each other — confirmed on real data, 10U BB's experimental
ratings put 10 of 13 teams in "top" this way before the fix).

### Rankings table sorting

Each division's rankings table is fully client-side sortable — click any
column header to sort by it (ascending or descending, toggling on repeat
clicks); each column starts in whichever direction reads as "best value
first" for that stat (fewer losses/goals-against first, more of everything
else first). Defaults to Rating, descending.

This also structurally closes off a whole class of bug that bit this
project twice: the backend's own row order needs to stay in sync with a
`rank` field for anything relying on server-side ordering, and it broke
both times (once when a display correction re-ranked without reordering
the array, once when the classic and experimental rating passes both
reordered the same shared row list and the second call silently clobbered
the first's order). Real client-side sorting doesn't have this failure
mode at all — the displayed order is always derived fresh from whatever
column is actually selected, not trusted from upstream.

## D-Zone Positioning Trainer

A separate practice tool (`/dzone`, linked from the header) for teaching defensive-zone positioning to
young players -- unrelated to the rating model above. Built on **"Box + 1"** defensive zone coverage
(goalie is the "+1"), a standard introductory system for youth hockey, not invented for this site. Every
positioning rule in `src/lib/dzonePositioning.ts` traces to a real coaching source (AJH Coach Player
Book, "D-Zone Coverage Responsibilities -- Box + 1") and is documented as such in that file, with unit
tests (`src/lib/dzonePositioning.test.ts`) asserting the actual coaching invariants (e.g. "the puck-side
defenseman is always closer to the puck than the weak-side one," "a defenseman never pressures above the
top of the circles") rather than just implementation details.

Three modes, in `src/components/DZoneTrainer.tsx`:
- **Watch**: control 1-3 offensive players (drag to move; whichever one you're dragging has the puck) and
  watch the 5 defenders (LD/RD/C/LW/RW) react. Optionally focus on one position to watch it specifically.
- **Control**: directly control one defensive position; the rest follow the model. A dashed circle marks
  the model's ideal spot for comparison, with a live distance readout.
- **Coach**: pause at any time; manually correct any defender's position (it holds there until reset,
  instead of snapping back to the model's default); or swap which position's assignment two defenders
  each follow, for a deliberate tactical call ("LW tracks the puck carrier into RD's zone and continues,
  RD rotates into LW's zone") rather than a one-off nudge.

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
