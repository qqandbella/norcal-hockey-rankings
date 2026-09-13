"""One-off: fetch shots-on-goal per team per game from live.caha.timetoscore.com's
JSON API, for games already recorded in public/data/latest.json.

Not part of scrape.yml -- this is exploratory data collection for the
offense/defense rating split proposal (see GitHub issue #6), run by hand.
Paced deliberately (SLEEP_SECONDS between requests) even though
live.caha.timetoscore.com carries no robots.txt restriction (verified
2026-09-13: root returns 404 for /robots.txt) -- a live-scoring endpoint
wasn't built to be hit for every game in a season back-to-back, and being
polite about request rate doesn't depend on whether a rule technically
requires it.

Mechanism (see issue #6 for the full writeup): GET / sets an HttpOnly
session cookie (tts_live_session); GET /get_team_info?game_id=<id> then
returns home_shots/away_shots directly as JSON. Verified to work for any
game_id regardless of age (tested back to game_id=1, Fall 2009).

Usage: python3 scripts/fetch_shots.py [age_label]
(defaults to 10U; writes scripts/shots_cache.json, keyed by gameId, so a
re-run only fetches games not already cached)
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

LIVE_BASE_URL = "https://live.caha.timetoscore.com"
DATA_PATH = Path(__file__).parent.parent / "public" / "data" / "latest.json"
CACHE_PATH = Path(__file__).parent / "shots_cache.json"
SLEEP_SECONDS = 0.6
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; one-off shots-on-goal "
    "collection for offense/defense modeling, run rarely by hand -- see issue #6)"
)


def played_game_ids(age_label: str) -> dict[str, dict]:
    data = json.loads(DATA_PATH.read_text())
    games: dict[str, dict] = {}
    for division in data["divisions"]:
        if division["ageLabel"] != age_label:
            continue
        for g in division["games"]:
            if not g["played"] or g["gameId"] in games:
                continue
            games[g["gameId"]] = g
    return games


def fetch_shots(session: requests.Session, game_id: str) -> dict | None:
    session.get(f"{LIVE_BASE_URL}/", params={"game_id": game_id}, timeout=15)
    resp = session.get(f"{LIVE_BASE_URL}/get_team_info", params={"game_id": game_id}, timeout=15)
    resp.raise_for_status()
    payload = resp.json()
    if "error" in payload:
        return None
    return payload


def main() -> int:
    age_label = sys.argv[1] if len(sys.argv) > 1 else "10U"
    games = played_game_ids(age_label)
    cache: dict[str, dict] = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    to_fetch = [gid for gid in games if gid not in cache]
    print(f"{age_label}: {len(games)} played games, {len(to_fetch)} not yet cached", file=sys.stderr)

    for i, game_id in enumerate(to_fetch):
        result = fetch_shots(session, game_id)
        if result is None:
            print(f"  [{i + 1}/{len(to_fetch)}] game_id={game_id}: no data", file=sys.stderr)
        else:
            cache[game_id] = result
            print(
                f"  [{i + 1}/{len(to_fetch)}] game_id={game_id}: "
                f"{result['away_team_name']} {result['away_shots']} shots / "
                f"{result['home_team_name']} {result['home_shots']} shots",
                file=sys.stderr,
            )
        time.sleep(SLEEP_SECONDS)

    CACHE_PATH.write_text(json.dumps(cache, indent=2))
    print(f"Wrote {CACHE_PATH} ({len(cache)} games cached)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
