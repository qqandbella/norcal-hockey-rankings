"""One-off resolver: team name -> officially declared division label (e.g.
"10U BB"), from the league's own final standings index.

NOT part of the recurring scrape.yml loop and NOT run automatically -- same
posture as build_team_ids.py (see its docstring for why direct
stats.caha.timetoscore.com queries are kept manual/rare in this project).
Run once per season after division placement is finalized, and again if
mid-season roster moves happen:

    python3 scripts/build_declared_divisions.py

and commit the resulting scripts/declared_divisions.json.

Why this exists: the regular scrape pulls games from NorCal's own schedule
feed, which files a game under whichever division scheduled it -- including
one-off preseason cross-division test games (a B team testing at BB, etc.).
Before final placement, "which division is this team actually in" isn't
well-defined at all; after it, a team's declared division is this file's
whole reason to exist -- scrape.py uses it to filter each division's shown
roster to only the teams officially placed there, regardless of which
division's schedule any individual game (including historical preseason
ones) happened to be filed under.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

INDEX_URL = "https://stats.caha.timetoscore.com/display-stats.php?league=3&season=0"
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; one-off declared-division resolver, "
    "run rarely by hand -- contact via GitHub issues)"
)
OUTPUT_PATH = Path(__file__).resolve().parent / "declared_divisions.json"


def _clean_text(text: str) -> str:
    """Collapse internal whitespace (source has stray double spaces, e.g.
    "Fresno Jr Monsters  Girls 10G-1") -- MUST match scrape.py's own
    _clean_text exactly, or a team's name here won't match the name used
    everywhere else on the site, and it'll silently fall through
    filter_roster_to_declared's "unknown -> keep" leniency instead of
    actually being matched to its declared division."""
    return re.sub(r"\s+", " ", text).strip()


def resolve() -> dict[str, str]:
    """Flat {team_name: division_label} -- e.g. {"Tri Valley Lady Blue
    Devils 10G-1": "10U BB"}. Division labels come straight from the page's
    own section headers ("<levelLabel> Schedule"), so they already match
    whatever ageLabel/levelLabel split scrape.py's own split_age_level
    produces from the same kind of label elsewhere."""
    resp = requests.get(INDEX_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    mapping: dict[str, str] = {}
    current_division: str | None = None
    for row in soup.find_all("tr"):
        header = row.find("th")
        if header and header.get("colspan"):
            link = header.find("a")
            if link and "Schedule" in link.get_text():
                label = link.get_text().replace(" Schedule", "").strip()
                current_division = None if label == "Norcal" else label
            continue
        cells = row.find_all("td")
        if current_division and len(cells) >= 2:
            name = _clean_text(cells[1].get_text(strip=True))
            if name and name != "Team":
                mapping[name] = current_division
    return mapping


def main() -> int:
    mapping = resolve()
    if not mapping:
        print("No declared divisions found -- aborting without overwriting declared_divisions.json", file=sys.stderr)
        return 1
    OUTPUT_PATH.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {OUTPUT_PATH} ({len(mapping)} teams)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
