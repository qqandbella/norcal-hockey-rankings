"""One-off resolver: team name -> TTS numeric team id, for linking out to the
official stats.caha.timetoscore.com team schedule page, and for detecting
when TTS renames a team's display text mid-season.

NOT part of the recurring scrape.yml loop and NOT run automatically. This is
the one place in this project that queries stats.caha.timetoscore.com
directly (see README for why the regular scraper deliberately avoids that
host). A single request here, run rarely (roughly once per season, since TTS
assigns each season's roster of teams new numeric ids -- or right after a
detected rename, see below), is a fundamentally different footprint than a
recurring bot -- but it's still the disallowed host, so keep it manual and
infrequent. Run by hand:

    python3 scripts/build_team_ids.py

and commit the resulting scripts/team_ids.json and scripts/team_aliases.json.

## Rename detection

TTS's numeric team id is the one stable identity NorCal's own schedule feed
(load-tts-schedule.php, scraped every 2h) never exposes -- that feed only
ever shows display text, and TTS can and does rename that text mid-season
(confirmed 2026-10: ~60 teams renamed from a roster-number suffix like
"10-2" to a division-coded one like "10B"). A rename otherwise fractures a
team's rating/schedule history into two unrelated-looking names.

Each run here loads the PREVIOUS team_ids.json (before overwriting it) and
diffs it against the freshly-resolved id->name mapping: any id that now
resolves to a different display name is a detected rename, recorded into
scripts/team_aliases.json (old name -> current canonical name), merged with
any aliases already on file from a previous run (so an old name doesn't
"forget" its alias just because it eventually ages out of team_ids.json).

One real collision exists in TTS's own data (confirmed 2026-10): two
genuinely different Tri Valley Blue Devils 10U A teams (ids 17 and 18, were
"10-1"/"10-2") were both renamed to the literal same string "Tri Valley Blue
Devils 10A" -- the live schedule feed can no longer distinguish them at all,
with or without this script. Aliasing into an ambiguous (multiply-claimed)
new name would silently merge two different teams' histories, which is
worse than leaving them fractured, so any such new name is skipped and
reported instead of aliased.
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
TEAM_IDS_PATH = Path(__file__).resolve().parent / "team_ids.json"
TEAM_ALIASES_PATH = Path(__file__).resolve().parent / "team_aliases.json"

TEAM_LINK_RE = re.compile(r"<a href='display-schedule\?team=(\d+)&season=(\d+)&league=3&stat_class=1'>([^<]*)</a>")


def resolve() -> list[tuple[str, str, str]]:
    """Every (team_id, season, display_name) row from TTS's own index page,
    in document order, with NO collapsing by name -- a display name can
    (rarely, confirmed 2026-10: two different Tri Valley Blue Devils 10U A
    teams) be shared by more than one distinct id, and compute_renames
    needs to see every id to catch that rather than silently dropping one."""
    resp = requests.get(INDEX_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    rows = []
    for team_id, season, raw_name in TEAM_LINK_RE.findall(resp.text):
        name = re.sub(r"\s+", " ", html.unescape(raw_name)).strip()
        rows.append((team_id, season, name))
    return rows


def collapse_by_name(rows: list[tuple[str, str, str]]) -> dict[str, dict[str, str]]:
    """Last-one-wins per display name -- this is what team_ids.json itself
    stores (the outbound-link lookup, keyed by name same as everything
    else fed from the plain-text schedule feed), where a genuine name
    collision can't be resolved any better than the schedule feed itself
    can be."""
    mapping: dict[str, dict[str, str]] = {}
    for team_id, season, name in rows:
        mapping[name] = {"teamId": team_id, "season": season}
    return mapping


def compute_renames(
    old_mapping: dict[str, dict[str, str]], new_rows: list[tuple[str, str, str]]
) -> tuple[dict[str, str], list[str]]:
    """Returns (aliases, collision_warnings). `aliases` maps an old display
    name to its current canonical one, for every id whose display name
    changed -- except where the new name is claimed by more than one id
    (an upstream naming collision, see module docstring), which is
    reported in `collision_warnings` instead of aliased. `new_rows` must
    be the uncollapsed id-level rows from `resolve()`, not a name-keyed
    dict -- collapsing by name first would already have thrown away the
    very collision this needs to detect."""
    old_names_by_id: dict[str, list[str]] = {}
    for name, info in old_mapping.items():
        old_names_by_id.setdefault(info["teamId"], []).append(name)

    new_name_by_id: dict[str, str] = {}
    ids_by_new_name: dict[str, list[str]] = {}
    for team_id, _season, name in new_rows:
        new_name_by_id[team_id] = name
        ids_by_new_name.setdefault(name, []).append(team_id)

    aliases: dict[str, str] = {}
    warnings: list[str] = []
    for team_id, old_names in old_names_by_id.items():
        new_name = new_name_by_id.get(team_id)
        if new_name is None:
            continue
        colliding_ids = ids_by_new_name[new_name]
        for old_name in old_names:
            if old_name == new_name:
                continue
            if len(colliding_ids) > 1:
                warnings.append(
                    f"{old_name!r} (id={team_id}) -> {new_name!r}: skipped, "
                    f"{new_name!r} is now shared by {len(colliding_ids)} different ids "
                    f"{sorted(colliding_ids)} -- can't tell them apart in the schedule feed"
                )
                continue
            aliases[old_name] = new_name
    return aliases, warnings


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def main() -> int:
    old_mapping = load_json(TEAM_IDS_PATH)
    new_rows = resolve()
    if not new_rows:
        print("No team links found -- aborting without overwriting team_ids.json", file=sys.stderr)
        return 1
    new_mapping = collapse_by_name(new_rows)

    aliases, warnings = compute_renames(old_mapping, new_rows)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    existing_aliases = load_json(TEAM_ALIASES_PATH)
    merged_aliases = {**existing_aliases, **aliases}
    # An alias chain (A -> B in an old run, B -> C now) should collapse to
    # A -> C directly, so downstream lookups never need more than one hop.
    for old_name, current_name in list(merged_aliases.items()):
        seen = {old_name}
        while current_name in merged_aliases and current_name not in seen:
            seen.add(current_name)
            current_name = merged_aliases[current_name]
        merged_aliases[old_name] = current_name

    TEAM_IDS_PATH.write_text(json.dumps(new_mapping, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {TEAM_IDS_PATH} ({len(new_mapping)} teams)", file=sys.stderr)

    if merged_aliases:
        TEAM_ALIASES_PATH.write_text(json.dumps(merged_aliases, indent=2, sort_keys=True) + "\n")
        print(
            f"Wrote {TEAM_ALIASES_PATH} ({len(merged_aliases)} aliases, "
            f"{len(aliases)} newly detected this run)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
