"""Scrape NorCal Youth Hockey division schedules/results and compute ratings.

Data source is www.norcalyouthhockey.org -- the official association site --
never stats.caha.timetoscore.com directly (see plan/README for why). NorCal's
own Schedules.php page already calls the same load-tts-schedule.php endpoint
via AJAX on every visitor's page load; this script calls it the same way,
just server-side and at low frequency.
"""

from __future__ import annotations

import datetime
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from ratings import (
    DIVISION_HIERARCHY,
    Game,
    TeamRating,
    capped_margin,
    compute_ratings,
    compute_team_stats,
    compute_tier_offsets,
)

BASE_URL = "https://www.norcalyouthhockey.org"
SCHEDULES_URL = f"{BASE_URL}/Schedules.php"
FEED_URL = f"{BASE_URL}/load-tts-schedule.php"
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; contact via GitHub issues)"
)
REQUEST_DELAY_SECONDS = 1.0
# Must live under public/ so `vite build` copies it into dist/ -- Vite only
# bundles imported modules and files under public/, not arbitrary repo files.
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "latest.json"

# Confirmed via direct query: works, but missing from NorCal's own Schedules.php
# levels[0] JS array. Always included regardless of what discovery finds.
KNOWN_MISSING_LEVELS = {3: "10U B"}

LEVEL_LINE_RE = re.compile(r"'Level:\s*([^|']+)\|(\d+)'")

# Built by scripts/build_team_ids.py (run manually/rarely -- see its
# docstring for why). Missing file or missing entries just means no outbound
# TTS link for that team; never block the regular scrape on this.
TEAM_IDS_PATH = Path(__file__).resolve().parent / "team_ids.json"
TTS_TEAM_URL = "https://stats.caha.timetoscore.com/display-schedule?team={team_id}&season={season}&league=3&stat_class=1"


def load_team_ids() -> dict[str, dict[str, str]]:
    if not TEAM_IDS_PATH.exists():
        return {}
    return json.loads(TEAM_IDS_PATH.read_text())


def build_team_links(team_names: set[str], team_ids: dict[str, dict[str, str]]) -> dict[str, str]:
    links = {}
    for name in team_names:
        entry = team_ids.get(name)
        if entry:
            links[name] = TTS_TEAM_URL.format(team_id=entry["teamId"], season=entry["season"])
    return links


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def discover_divisions(session: requests.Session) -> dict[int, str]:
    """Return {levelId: label} for every division, e.g. {2: "10U A"}."""
    resp = session.get(SCHEDULES_URL, timeout=30)
    resp.raise_for_status()
    divisions: dict[int, str] = {}
    for label, level_id in LEVEL_LINE_RE.findall(resp.text):
        divisions[int(level_id)] = label.strip()
    divisions.update(KNOWN_MISSING_LEVELS)
    return divisions


def _parse_goals(score_cell: str) -> tuple[int | None, int | None]:
    text = score_cell.strip().replace("\xa0", "")
    if not text or "-" not in text:
        return None, None
    away_str, home_str = text.split("-", 1)
    away_str, home_str = away_str.strip(), home_str.strip()
    if not away_str.isdigit() or not home_str.isdigit():
        return None, None
    return int(away_str), int(home_str)


def _clean_text(text: str) -> str:
    """Strip and collapse internal whitespace (source has stray double spaces,
    e.g. "Fresno Jr Monsters  Girls 10G-1"), so near-duplicate team names
    don't slip through as distinct teams."""
    return re.sub(r"\s+", " ", text).strip()


def _parse_table(table) -> list[dict]:
    games = []
    rows = table.find("tbody").find_all("tr") if table.find("tbody") else []
    for row in rows:
        cells = [_clean_text(c.get_text(strip=True)) for c in row.find_all("td")]
        if len(cells) < 11:
            continue
        (
            date,
            day,
            time_str,
            rink,
            _league,
            division,
            game_type,
            game_id,
            away,
            home,
            score,
        ) = cells[:11]
        if not away and not home:
            continue
        away_goals, home_goals = _parse_goals(score)
        games.append(
            {
                "game_id": game_id,
                "date": date,
                "day": day,
                "time": time_str,
                "rink": rink,
                "division": division,
                "type": game_type,
                "away": away,
                "home": home,
                "away_goals": away_goals,
                "home_goals": home_goals,
                "played": away_goals is not None and home_goals is not None,
            }
        )
    return games


def fetch_division_games(session: requests.Session, level_id: int) -> list[dict]:
    resp = session.get(
        FEED_URL,
        params={"filter": 1, "rinks": "All", "clubs": "All", "levels": level_id},
        timeout=30,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    games: list[dict] = []
    for table in soup.find_all("table"):
        games.extend(_parse_table(table))
    # De-dupe by game_id (future/past sections shouldn't overlap, but be safe).
    seen = set()
    deduped = []
    for g in games:
        if g["game_id"] in seen:
            continue
        seen.add(g["game_id"])
        deduped.append(g)
    return deduped


def split_age_level(label: str) -> tuple[str, str]:
    """"10U BB" -> ("10U", "BB")."""
    parts = label.split(None, 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return label, ""


def tier_of(level_label: str) -> str | None:
    """Which DIVISION_HIERARCHY tier a division's levelLabel belongs to, for
    the cross-division offset model. Exact matches map directly; a future
    split like "B East"/"B West" is a sibling of "B" (same competitive tier,
    just two flights), so strip a trailing " East"/" West"/" <N>" and retry.
    Anything unrecognized (house leagues, etc.) returns None -- excluded
    from the hierarchy rather than guessed at."""
    if level_label in DIVISION_HIERARCHY:
        return level_label
    base = re.sub(r"\s+(East|West)$", "", level_label).strip()
    return base if base in DIVISION_HIERARCHY else None


def _rating_games(raw_games: list[dict]) -> list[Game]:
    return [
        Game(home=g["home"], away=g["away"], home_goals=g["home_goals"], away_goals=g["away_goals"])
        for g in raw_games
        if g["played"]
    ]


def _build_team_rows(played_of_type: list[dict], roster_of_type: list[dict]) -> dict:
    """Ratings + traditional stats for one type-filtered slice of games.

    `roster_of_type` includes scheduled-but-not-yet-played games of this type
    too, so a team that's only scheduled (no results yet) still shows up as
    "unrated" rather than silently disappearing from this type's view.
    """
    rating_games = _rating_games(played_of_type)
    ratings = compute_ratings(rating_games)
    stats_by_name = compute_team_stats(rating_games)
    rows = []
    for r in sorted(ratings, key=lambda r: r.rank):
        s = stats_by_name.get(r.name)
        rows.append(
            {
                "name": r.name,
                "rating": r.rating,
                "rank": r.rank,
                "tier": r.tier,
                "gamesPlayed": r.games_played,
                "wins": s.wins if s else 0,
                "losses": s.losses if s else 0,
                "ties": s.ties if s else 0,
                "points": s.points if s else 0,
                "goalsFor": s.goals_for if s else 0,
                "goalsAgainst": s.goals_against if s else 0,
                "goalDiff": s.goal_diff if s else 0,
            }
        )
    unrated = sorted(
        ({g["home"] for g in roster_of_type} | {g["away"] for g in roster_of_type})
        - {r["name"] for r in rows}
    )
    return {"teams": rows, "unratedTeams": unrated}


def build_division_payload(
    level_id: int, label: str, raw_games: list[dict], team_ids: dict[str, dict[str, str]]
) -> dict:
    age_label, level_label = split_age_level(label)

    # Precompute one ratings+stats table per distinct game type actually
    # present in this division, plus a synthetic "All" bucket covering every
    # played game regardless of type. The type filter on the site is a
    # single-select, so this is a small, bounded set (never all 2^n
    # combinations) -- no need to run the rating algorithm client-side.
    played_games = [g for g in raw_games if g["played"]]
    types_present = sorted({g["type"] for g in raw_games if g["type"]})
    ratings_by_type = {"All": _build_team_rows(played_games, raw_games)}
    for game_type in types_present:
        ratings_by_type[game_type] = _build_team_rows(
            [g for g in played_games if g["type"] == game_type],
            [g for g in raw_games if g["type"] == game_type],
        )

    games = []
    for g in raw_games:
        # The feed's own Division column for this specific game row, which
        # can differ from the level we queried -- a team's B-level squad
        # sometimes plays a cross-division test game filed under BB (or vice
        # versa). Carry it through so a team's full schedule (aggregated
        # across every division on the site) can still link/label each game
        # correctly rather than only ever showing games filed under this
        # team's "home" level.
        game_age_label, game_level_label = split_age_level(g["division"]) if g["division"] else (age_label, level_label)
        games.append(
            {
                "gameId": g["game_id"],
                "date": g["date"],
                "day": g["day"],
                "time": g["time"],
                "rink": g["rink"],
                "type": g["type"],
                "away": g["away"],
                "home": g["home"],
                "awayGoals": g["away_goals"],
                "homeGoals": g["home_goals"],
                "played": g["played"],
                "ageLabel": game_age_label,
                "levelLabel": game_level_label,
            }
        )
    all_team_names = {g["home"] for g in raw_games} | {g["away"] for g in raw_games}
    return {
        "levelId": level_id,
        "ageLabel": age_label,
        "levelLabel": level_label,
        "ratingsByType": ratings_by_type,
        "games": games,
        "teamLinks": build_team_links(all_team_names, team_ids),
    }


def _team_ratings_from_bucket(bucket: dict) -> list[TeamRating]:
    return [
        TeamRating(
            name=t["name"], rating=t["rating"], games_played=t["gamesPlayed"], rank=t["rank"], tier=t["tier"]
        )
        for t in bucket["teams"]
    ]


def compute_age_group_ratings(payload_divisions: list[dict]) -> dict[str, dict]:
    """One unified, cross-division-comparable rating per team, spanning every
    division within an age group (10U, 12U, ...) -- not just its own.

    A division-scoped rating (ratingsByType) can't be compared across
    divisions on its own -- each is centered to its own division's mean,
    with no notion that e.g. BB is generally a stronger division than B.
    See compute_tier_offsets in ratings.py for the model: each division's
    within-rating gets an additive offset, defaulting to the empirical rule
    "a tier's bottom is on par with the tier above's top", refined by real
    cross-division game evidence in proportion to how much of it exists.
    """
    divisions_by_age: dict[str, list[dict]] = {}
    for division in payload_divisions:
        divisions_by_age.setdefault(division["ageLabel"], []).append(division)

    age_groups: dict[str, dict] = {}
    for age_label, divisions in divisions_by_age.items():
        within_ratings_by_tier: dict[str, list[TeamRating]] = {}
        for division in divisions:
            tier = tier_of(division["levelLabel"])
            if tier is None:
                continue
            within_ratings_by_tier.setdefault(tier, []).extend(
                _team_ratings_from_bucket(division["ratingsByType"]["All"])
            )

        bridge_games: list[tuple[str, str, int, str]] = []
        seen_game_ids: set[str] = set()
        for division in divisions:
            for g in division["games"]:
                if g["gameId"] in seen_game_ids:
                    continue
                seen_game_ids.add(g["gameId"])
                if not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
                    continue
                game_tier = tier_of(g["levelLabel"])
                if game_tier is None:
                    continue
                bridge_games.append(
                    (g["home"], g["away"], capped_margin(g["homeGoals"], g["awayGoals"]), game_tier)
                )

        offsets = compute_tier_offsets(within_ratings_by_tier, bridge_games)
        if not offsets:
            continue

        # Unified rating per team = games-played-weighted average of
        # (within-rating + that tier's offset) across every tier the team
        # is rated in -- almost always just one, more for cross-tested teams.
        team_tier_ratings: dict[str, list[tuple[TeamRating, str]]] = {}
        for tier, rows in within_ratings_by_tier.items():
            if tier not in offsets:
                continue
            for r in rows:
                team_tier_ratings.setdefault(r.name, []).append((r, tier))

        teams = {}
        for name, entries in team_tier_ratings.items():
            total_games = sum(r.games_played for r, _ in entries)
            unified = (
                sum((r.rating + offsets[tier]["offset"]) * r.games_played for r, tier in entries) / total_games
            )
            teams[name] = {"rating": round(unified, 3), "gamesPlayed": total_games}

        age_groups[age_label] = {"teams": teams, "tierOffsets": offsets}

    return age_groups


def main() -> int:
    session = _session()
    divisions = discover_divisions(session)
    if not divisions:
        print("No divisions discovered -- aborting without overwriting data/latest.json", file=sys.stderr)
        return 1
    team_ids = load_team_ids()

    payload_divisions = []
    for i, (level_id, label) in enumerate(sorted(divisions.items())):
        if i > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        games = fetch_division_games(session, level_id)
        payload_divisions.append(build_division_payload(level_id, label, games, team_ids))
        print(f"  {label} (level={level_id}): {len(games)} games", file=sys.stderr)

    age_groups = compute_age_group_ratings(payload_divisions)
    for age_label, group in age_groups.items():
        print(f"  {age_label} unified rating: {len(group['teams'])} teams", file=sys.stderr)

    payload = {
        "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": FEED_URL,
        "divisions": payload_divisions,
        "ageGroups": age_groups,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT_PATH} ({len(payload_divisions)} divisions)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
