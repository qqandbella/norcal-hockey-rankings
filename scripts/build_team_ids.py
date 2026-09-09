"""One-off resolver: team name -> TTS numeric team id, for linking out to the
official stats.caha.timetoscore.com team schedule page.

NOT part of the recurring scrape.yml loop and NOT run automatically. This is
the one place in this project that queries stats.caha.timetoscore.com
directly (see README for why the regular scraper deliberately avoids that
host). A single request here, run rarely (roughly once per season, since TTS
assigns each season's roster of teams new numeric ids), is a fundamentally
different footprint than a recurring bot -- but it's still the disallowed
host, so keep it manual and infrequent. Run by hand:

    python3 scripts/build_team_ids.py

and commit the resulting scripts/team_ids.json.
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

import requests

INDEX_URL = "https://stats.caha.timetoscore.com/display-stats.php?league=3&season=0"
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; one-off team-id resolver, "
    "run rarely by hand -- contact via GitHub issues)"
)
OUTPUT_PATH = Path(__file__).resolve().parent / "team_ids.json"

TEAM_LINK_RE = re.compile(r"<a href='display-schedule\?team=(\d+)&season=(\d+)&league=3&stat_class=1'>([^<]*)</a>")


def resolve() -> dict[str, dict[str, str]]:
    resp = requests.get(INDEX_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    mapping: dict[str, dict[str, str]] = {}
    for team_id, season, raw_name in TEAM_LINK_RE.findall(resp.text):
        name = re.sub(r"\s+", " ", html.unescape(raw_name)).strip()
        mapping[name] = {"teamId": team_id, "season": season}
    return mapping


def main() -> int:
    mapping = resolve()
    if not mapping:
        print("No team links found -- aborting without overwriting team_ids.json", file=sys.stderr)
        return 1
    OUTPUT_PATH.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {OUTPUT_PATH} ({len(mapping)} teams)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
