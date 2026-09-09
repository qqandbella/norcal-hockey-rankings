"""One-off: check the current tier-gap prior against a full COMPLETED past
season, instead of trusting this season's noisy 3-game preseason extremes.

compute_tier_offsets' prior_gap is `max(within-rating of the tier below) -
min(within-rating of the tier above)`. Early in the season, both of those
are estimated from ~3 games -- exactly the kind of small-sample statistic
the rest of this project goes out of its way not to trust. A full completed
season (~15-20 games/team) gives a much lower-variance estimate of the same
quantity. This script computes that historical version and prints it next
to what this season's preseason data currently gives, so a real decision
about recalibrating the prior can be made from evidence.

Directly queries stats.caha.timetoscore.com (like build_team_ids.py -- see
its docstring for why that's the one place in this project this is okay).
This is a one-off/rarely-run analysis script, not part of scrape.yml.

Usage: python3 scripts/historical_tier_gap.py [season_id]
(defaults to 31 = Fall 2025, the last fully-completed season as of writing)
"""

from __future__ import annotations

import re
import sys
from statistics import median

import requests

from ratings import Game, compute_ratings
from scrape import split_age_level, tier_of

BASE_URL = "https://stats.caha.timetoscore.com"
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; one-off historical "
    "calibration, run rarely by hand -- contact via GitHub issues)"
)
DEFAULT_SEASON = 31  # Fall 2025

LEVEL_LINE_RE = re.compile(r"level=(\d+)&conf=0&season=\d+'>([^<]*) Schedule")
ROW_RE = re.compile(r"<tr.*?</tr>", re.S)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")


def _clean(cell: str) -> str:
    return TAG_RE.sub("", cell).replace("&nbsp;", "").strip()


def discover_levels(session: requests.Session, season: int) -> dict[int, str]:
    resp = session.get(f"{BASE_URL}/display-stats.php", params={"league": 3, "season": season}, timeout=30)
    resp.raise_for_status()
    return {int(m.group(1)): m.group(2).strip() for m in LEVEL_LINE_RE.finditer(resp.text)}


def fetch_games(session: requests.Session, level_id: int, season: int) -> list[Game]:
    resp = session.get(
        f"{BASE_URL}/display-schedule.php",
        params={"stat_class": 1, "league": 3, "level": level_id, "conf": 0, "season": season},
        timeout=30,
    )
    resp.raise_for_status()
    games = []
    for row in ROW_RE.findall(resp.text):
        cells = [_clean(c) for c in CELL_RE.findall(row)]
        if len(cells) < 10:
            continue
        _game_id, _date, _time, _rink, _league, _level, away, away_goals, home, home_goals = cells[:10]
        if not away_goals.isdigit() or not home_goals.isdigit():
            continue
        games.append(Game(home=home, away=away, home_goals=int(home_goals), away_goals=int(away_goals)))
    return games


def extremes_gap(low_ratings: list[float], high_ratings: list[float]) -> float:
    return max(low_ratings) - min(high_ratings)


def trimmed_gap(low_ratings: list[float], high_ratings: list[float]) -> float:
    """2nd-best of the lower tier vs 2nd-worst of the higher tier -- less
    sensitive to one fluke result than the literal extremes, at the cost of
    needing at least 2 teams per tier."""
    if len(low_ratings) < 2 or len(high_ratings) < 2:
        return extremes_gap(low_ratings, high_ratings)
    return sorted(low_ratings)[-2] - sorted(high_ratings)[1]


def main() -> int:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEASON
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    levels = discover_levels(session, season)
    print(f"season={season}: {len(levels)} divisions discovered", file=sys.stderr)

    ratings_by_age_tier: dict[str, dict[str, list]] = {}
    for level_id, label in sorted(levels.items()):
        age_label, level_label = split_age_level(label)
        tier = tier_of(level_label)
        if tier is None:
            continue
        games = fetch_games(session, level_id, season)
        if not games:
            continue
        ratings = compute_ratings(games)
        ratings_by_age_tier.setdefault(age_label, {}).setdefault(tier, []).extend(ratings)
        print(f"  {label} (level={level_id}): {len(games)} games, {len(ratings)} teams", file=sys.stderr)

    print(f"\nHistorical (season={season}) tier-gap check vs. extremes-based prior_gap formula:")
    for age_label, by_tier in sorted(ratings_by_age_tier.items()):
        tiers_present = [t for t in ["AA", "A", "BB", "B"] if t in by_tier]
        for i in range(len(tiers_present) - 1):
            higher, lower = tiers_present[i], tiers_present[i + 1]
            low_r = [r.rating for r in by_tier[lower]]
            high_r = [r.rating for r in by_tier[higher]]
            print(
                f"  {age_label} {higher} vs {lower}: "
                f"extremes_gap={extremes_gap(low_r, high_r):.2f}  "
                f"trimmed_gap={trimmed_gap(low_r, high_r):.2f}  "
                f"(n={len(high_r)} {higher} teams, n={len(low_r)} {lower} teams)"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
