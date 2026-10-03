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

## Collisions: two different teams renamed to the identical string

One real case exists in TTS's own data (confirmed 2026-10): two genuinely
different Tri Valley Blue Devils 10U A teams (ids 17 and 18, were
"10-1"/"10-2") were both renamed to the literal same string "Tri Valley Blue
Devils 10A". A plain name-keyed alias can't represent "this one string means
two different teams," so this script resolves it precisely instead of
guessing: for every display name claimed by more than one id, it fetches
EACH colliding id's own schedule page
(stats.caha.timetoscore.com/display-schedule?team=<id>&...) and records
which TTS game ids belong to which id into scripts/team_collisions.json
({collided_name: {resolved_name: {gameIds: [...]}}}). scrape.py then
resolves each game independently by its own game id (see
apply_team_collisions), splitting the collided name back into the two real
teams for every game except a genuine head-to-head meeting between them --
TTS's own per-team schedule page doesn't disambiguate which side is which
for an unplayed game either, so neither can this script; it's a true,
temporary ambiguity that resolves itself once the game is played and this
script is re-run (TTS bolds the "this team" side once there's a result).

This still costs one extra request per colliding id against the disallowed
host (stats.caha.timetoscore.com) -- acceptable under the same "rare,
manual, narrowly scoped" posture as the rest of this script, since it only
fires for the (so far: one) actual collision on file, not every team.

Falls back to the coarser declared_divisions.json-consensus alias (merge
the two teams under one name, safe for ROUTING only, not for keeping their
records separate) if the per-id schedule fetch fails or returns no games --
better than leaving a collision completely unresolved.
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
from pathlib import Path

import requests

INDEX_URL = "https://stats.caha.timetoscore.com/display-stats.php?league=3&season=0"
SCHEDULE_URL = "https://stats.caha.timetoscore.com/display-schedule?team={team_id}&season={season}&league=3&stat_class=1"
USER_AGENT = (
    "norcal-hockey-rankings/1.0 "
    "(+https://github.com/qqandbella/norcal-hockey-rankings; one-off team-id resolver, "
    "run rarely by hand -- contact via GitHub issues)"
)
# Only used between the handful of extra per-id requests a collision
# resolution needs (see resolve_team_game_ids) -- same politeness posture
# as scrape.py's REQUEST_DELAY_SECONDS, kept separate since this script
# otherwise makes exactly one request.
COLLISION_REQUEST_DELAY_SECONDS = 1.0
TEAM_IDS_PATH = Path(__file__).resolve().parent / "team_ids.json"
TEAM_ALIASES_PATH = Path(__file__).resolve().parent / "team_aliases.json"
TEAM_COLLISIONS_PATH = Path(__file__).resolve().parent / "team_collisions.json"

TEAM_LINK_RE = re.compile(r"<a href='display-schedule\?team=(\d+)&season=(\d+)&league=3&stat_class=1'>([^<]*)</a>")
GAME_ID_CELL_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
FIRST_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")


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


def resolve_team_game_ids(team_id: str, season: str) -> list[str]:
    """Every TTS game id on one specific team's own schedule page (both
    played games, wrapped in an oss-scoresheet link, and future/unplayed
    ones, a bare numeric cell -- a naive "game_id=" link scrape only finds
    the played half). Used ONLY to disambiguate a display-name collision
    (see module docstring); never called for the regular recurring scrape.
    Empty list on any fetch error -- callers treat that as "couldn't
    resolve this id," not as "this team played zero games."""
    try:
        resp = requests.get(
            SCHEDULE_URL.format(team_id=team_id, season=season), headers={"User-Agent": USER_AGENT}, timeout=30
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"WARNING: failed to fetch schedule for team={team_id} season={season}: {e}", file=sys.stderr)
        return []
    game_ids = []
    for row in GAME_ID_CELL_RE.findall(resp.text):
        cells = FIRST_CELL_RE.findall(row)
        if not cells:
            continue
        first = TAG_RE.sub("", cells[0]).strip().rstrip("*")
        if first.isdigit():
            game_ids.append(first)
    return game_ids


def resolve_collisions(new_rows: list[tuple[str, str, str]]) -> dict[str, dict[str, dict]]:
    """For every display name currently claimed by more than one id,
    fetches each colliding id's own schedule page and records which game
    ids belong to which id. Returns {collided_name: {resolved_name:
    {"teamId", "season", "gameIds"}}}, sorted by team id ascending so the
    lower (usually older/first-registered) id gets the "-1" suffix --
    skips a collision entirely (omits it from the result) if any id's
    fetch fails, returns no games, or if the resolved game-id sets aren't
    actually disjoint (untrustworthy data -- better to leave the
    collision unresolved than guess)."""
    ids_by_name: dict[str, list[tuple[str, str]]] = {}
    for team_id, season, name in new_rows:
        ids_by_name.setdefault(name, []).append((team_id, season))

    resolved: dict[str, dict[str, dict]] = {}
    for name, id_seasons in ids_by_name.items():
        if len(id_seasons) < 2:
            continue
        id_seasons = sorted(set(id_seasons), key=lambda pair: int(pair[0]))
        per_id_games: list[tuple[str, str, list[str]]] = []
        ok = True
        for team_id, season in id_seasons:
            time.sleep(COLLISION_REQUEST_DELAY_SECONDS)
            game_ids = resolve_team_game_ids(team_id, season)
            if not game_ids:
                ok = False
                break
            per_id_games.append((team_id, season, game_ids))
        if not ok:
            continue
        # Overlap is EXPECTED and fine -- a head-to-head meeting between
        # the two colliding teams legitimately shows up on both of their
        # own schedule pages (apply_team_collisions in scrape.py leaves
        # exactly that one game ambiguous, see its docstring). Only an
        # exact duplicate set across different ids suggests the fetch
        # didn't actually distinguish them (e.g. an identical page
        # returned for both), which IS untrustworthy.
        game_id_sets = [set(game_ids) for _, _, game_ids in per_id_games]
        if any(a == b for i, a in enumerate(game_id_sets) for b in game_id_sets[i + 1 :]):
            print(f"WARNING: {name!r} resolved to identical game-id sets -- can't disambiguate", file=sys.stderr)
            continue
        resolved[name] = {
            f"{name}-{i}": {"teamId": team_id, "season": season, "gameIds": sorted(game_ids, key=int)}
            for i, (team_id, season, game_ids) in enumerate(per_id_games, start=1)
        }
        print(f"Resolved collision {name!r} into {len(resolved[name])} distinct teams by game id", file=sys.stderr)
    return resolved


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
    old_mapping: dict[str, dict[str, str]],
    new_rows: list[tuple[str, str, str]],
    declared_divisions: dict[str, str] | None = None,
) -> tuple[dict[str, str], list[str]]:
    """Returns (aliases, collision_warnings). `aliases` maps an old display
    name to its current canonical one, for every id whose display name
    changed. `new_rows` must be the uncollapsed id-level rows from
    `resolve()`, not a name-keyed dict -- collapsing by name first would
    already have thrown away the very collision this needs to detect.

    Where the new name is claimed by more than one id (an upstream naming
    collision, see module docstring), aliasing is still safe for DIVISION
    ROUTING if every old name behind the collision agrees on the same
    `declared_divisions` placement -- their rating/schedule history is
    already irrecoverably merged upstream either way, so routing them
    correctly is a strict improvement over leaving them unaliased (which
    makes declared_divisions.json's keys permanently stale and lets the
    collided name leak into any division it played a cross-division game
    in, see scrape.py's filter_roster_to_declared). Only when the old
    names disagree on declared placement, or none has a declared entry at
    all, does it stay skipped and reported in `collision_warnings`."""
    declared_divisions = declared_divisions or {}
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
                all_old_names = {n for tid in colliding_ids for n in old_names_by_id.get(tid, [])}
                declared_values = {declared_divisions[n] for n in all_old_names if n in declared_divisions}
                if len(declared_values) == 1:
                    aliases[old_name] = new_name
                    continue
                warnings.append(
                    f"{old_name!r} (id={team_id}) -> {new_name!r}: skipped, "
                    f"{new_name!r} is now shared by {len(colliding_ids)} different ids "
                    f"{sorted(colliding_ids)} with no consistent declared_divisions.json "
                    f"placement to safely route by -- can't tell them apart in the schedule feed"
                )
                continue
            aliases[old_name] = new_name
    return aliases, warnings


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


DECLARED_DIVISIONS_PATH = Path(__file__).resolve().parent / "declared_divisions.json"


def main() -> int:
    old_mapping = load_json(TEAM_IDS_PATH)
    declared_divisions = load_json(DECLARED_DIVISIONS_PATH)
    new_rows = resolve()
    if not new_rows:
        print("No team links found -- aborting without overwriting team_ids.json", file=sys.stderr)
        return 1
    new_mapping = collapse_by_name(new_rows)

    new_collisions = resolve_collisions(new_rows)
    existing_collisions = load_json(TEAM_COLLISIONS_PATH)
    merged_collisions = {**existing_collisions, **new_collisions}

    aliases, warnings = compute_renames(old_mapping, new_rows, declared_divisions)
    # A name precisely resolved by game id (merged_collisions) doesn't also
    # need the coarser declared_divisions-consensus merge-alias -- the
    # per-game split in team_collisions.json is strictly more accurate and
    # takes priority (see module docstring).
    aliases = {old: new for old, new in aliases.items() if new not in merged_collisions}
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

    if merged_collisions:
        TEAM_COLLISIONS_PATH.write_text(json.dumps(merged_collisions, indent=2, sort_keys=True) + "\n")
        print(
            f"Wrote {TEAM_COLLISIONS_PATH} ({len(merged_collisions)} collisions, "
            f"{len(new_collisions)} resolved this run)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
