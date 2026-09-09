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

from ratings import Game, compute_ratings

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


def build_division_payload(level_id: int, label: str, raw_games: list[dict]) -> dict:
    age_label, level_label = split_age_level(label)
    rating_games = [
        Game(home=g["home"], away=g["away"], home_goals=g["home_goals"], away_goals=g["away_goals"])
        for g in raw_games
        if g["played"]
    ]
    ratings = compute_ratings(rating_games)
    rating_by_name = {r.name: r for r in ratings}
    teams = [
        {
            "name": r.name,
            "rating": r.rating,
            "rank": r.rank,
            "tier": r.tier,
            "gamesPlayed": r.games_played,
        }
        for r in sorted(ratings, key=lambda r: r.rank)
    ]
    games = [
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
        }
        for g in raw_games
    ]
    return {
        "levelId": level_id,
        "ageLabel": age_label,
        "levelLabel": level_label,
        "teams": teams,
        "games": games,
        # Teams present in the schedule but with zero played games don't get a
        # rating (nothing to compute from yet); surface them separately so
        # the site can still show "no games played" rather than omit them.
        "unratedTeams": sorted(
            ({g["home"] for g in raw_games} | {g["away"] for g in raw_games})
            - set(rating_by_name)
        ),
    }


def main() -> int:
    session = _session()
    divisions = discover_divisions(session)
    if not divisions:
        print("No divisions discovered -- aborting without overwriting data/latest.json", file=sys.stderr)
        return 1

    payload_divisions = []
    for i, (level_id, label) in enumerate(sorted(divisions.items())):
        if i > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        games = fetch_division_games(session, level_id)
        payload_divisions.append(build_division_payload(level_id, label, games))
        print(f"  {label} (level={level_id}): {len(games)} games", file=sys.stderr)

    payload = {
        "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": FEED_URL,
        "divisions": payload_divisions,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT_PATH} ({len(payload_divisions)} divisions)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
