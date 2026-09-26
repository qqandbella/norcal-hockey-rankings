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
    TeamStats,
    capped_margin,
    compute_corrected_local_ratings,
    compute_offense_defense_ratings,
    compute_ratings,
    compute_team_stats,
    compute_tier_offsets,
    compute_unified_ratings,
    rerank_and_tier,
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

# Built by scripts/build_declared_divisions.py (run manually/rarely, same
# posture as team_ids.json). {team_name: "10U BB", ...} -- the official
# division a team is actually placed in, independent of which division's
# schedule any individual game (including preseason cross-division tests)
# happened to be filed under. Missing file or missing entries means "unknown
# -- don't filter that team out," never "assume it doesn't belong anywhere."
DECLARED_DIVISIONS_PATH = Path(__file__).resolve().parent / "declared_divisions.json"


def load_team_ids() -> dict[str, dict[str, str]]:
    if not TEAM_IDS_PATH.exists():
        return {}
    return json.loads(TEAM_IDS_PATH.read_text())


def load_declared_divisions() -> dict[str, str]:
    if not DECLARED_DIVISIONS_PATH.exists():
        return {}
    return json.loads(DECLARED_DIVISIONS_PATH.read_text())


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
    the cross-division offset model. "B East"/"B West" are their own real,
    adjacent hierarchy entries (confirmed: only B East's top finishers reach
    the state playoff), not aliases of plain "B" -- so this is a direct
    membership check, no stripping. Anything unrecognized (house leagues,
    etc.) returns None -- excluded from the hierarchy rather than guessed
    at."""
    return level_label if level_label in DIVISION_HIERARCHY else None


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

    # Experimental offense/defense split (see compute_offense_defense_ratings
    # -- backtest-validated to beat the classic model within-division, not
    # yet extended to cross-division tier offsets). Combined into a single
    # sortable "experimental rating" = offense + defense = predicted margin
    # against a league-average (0, 0) opponent, the same interpretation as
    # the classic rating. Reuses rerank_and_tier for the same gap-based
    # tiering the classic model uses, rather than a separate implementation.
    od_by_name = {o.name: o for o in compute_offense_defense_ratings(rating_games)}
    experimental_rows = [
        {"name": name, "rating": round(od.offense + od.defense, 3)} for name, od in od_by_name.items()
    ]
    rerank_and_tier(experimental_rows)
    experimental_by_name = {row["name"]: row for row in experimental_rows}

    rows = []
    for r in sorted(ratings, key=lambda r: r.rank):
        s = stats_by_name.get(r.name)
        od = od_by_name.get(r.name)
        exp = experimental_by_name.get(r.name)
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
                "offense": od.offense if od else 0.0,
                "defense": od.defense if od else 0.0,
                "experimentalRating": exp["rating"] if exp else 0.0,
                "experimentalRank": exp["rank"] if exp else 0,
                "experimentalTier": exp["tier"] if exp else "mid",
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


def _team_ratings_from_bucket(
    bucket: dict, rating_field: str = "rating", rank_field: str = "rank", tier_field: str = "tier"
) -> list[TeamRating]:
    return [
        TeamRating(
            name=t["name"],
            rating=t[rating_field],
            games_played=t["gamesPlayed"],
            rank=t[rank_field],
            tier=t[tier_field],
        )
        for t in bucket["teams"]
    ]


def _compute_unified_and_patch(
    divisions: list[dict],
    rating_field: str,
    rank_field: str,
    tier_field: str,
    declared_divisions: dict[str, str],
) -> tuple[dict[str, dict], dict]:
    """One age group's cross-division-comparable ratings for a given rating
    type (classic: rating/rank/tier, or experimental:
    experimentalRating/experimentalRank/experimentalTier) -- shared by both
    so the tier-offset/unified-rating/corrected-local-display pipeline
    isn't duplicated per rating type. See compute_age_group_ratings for the
    overall rationale.

    The experimental cross-division extension reuses this same,
    already-validated machinery wholesale (tier offsets, bridge-game
    evidence, the historical prior) rather than a separate design -- a
    deliberate, lower-risk choice over building a full two-sided
    (offense-gap/defense-gap) cross-division model. Caveat: only the
    WITHIN-division offense/defense split has been walk-forward
    backtest-validated (scripts/backtest_offense_defense.py); this
    specific cross-division reuse has not been separately validated, since
    there's no cross-division experimental-mode ground truth to validate
    against yet.
    """
    # Route each team's within-rating by its DECLARED tier, not the
    # physical division's own tier -- two things this must handle:
    #   1. A team fully "relocated": every one of its actual games is filed
    #      under a division other than the one it's now declared in (e.g.
    #      Stockton Colts 10-1's only BB-caliber game was filed under B's
    #      own schedule, since B was its home when the game was played).
    #      Its within-rating still has to be computed from wherever it
    #      actually played, but attributed to its DECLARED tier so the
    #      tier-offset math treats it as a BB data point, not a B one.
    #   2. A physically split division (see
    #      split_physical_division_by_declared_subdivisions): "B East" and
    #      "B West" payloads both independently compute a rating for the
    #      WHOLE shared preseason pool (there's no separate East-only game
    #      history to compute from), so the same team's row shows up,
    #      redundantly but consistently, in both payloads' "All" buckets.
    #      `seen_team_names` keeps only one copy regardless of which
    #      payload it's first found in.
    within_ratings_by_tier: dict[str, list[TeamRating]] = {}
    seen_team_names: set[str] = set()
    for division in divisions:
        division_tier = tier_of(division["levelLabel"])
        for r in _team_ratings_from_bucket(division["ratingsByType"]["All"], rating_field, rank_field, tier_field):
            if r.name in seen_team_names:
                continue
            declared = declared_divisions.get(r.name)
            declared_tier = tier_of(split_age_level(declared)[1]) if declared else None
            effective_tier = declared_tier or division_tier
            if effective_tier is None:
                continue
            within_ratings_by_tier.setdefault(effective_tier, []).append(r)
            seen_team_names.add(r.name)

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
            bridge_games.append((g["home"], g["away"], capped_margin(g["homeGoals"], g["awayGoals"]), game_tier))

    offsets = compute_tier_offsets(within_ratings_by_tier, bridge_games)
    if not offsets:
        return {}, {}

    teams = compute_unified_ratings(within_ratings_by_tier, offsets)

    # A cross-tested team's raw, displayed within-division rating in a
    # tier it barely plays undersells it -- see
    # compute_corrected_local_ratings. Patch the same correction back
    # into that division's own "All" bucket, so a division's own
    # rankings table and a team's own per-division rating block on its
    # team page show the corrected number too, not a stale, too-low
    # raw one that contradicts the unified rating shown elsewhere. Only
    # "All" is patched -- offsets/bridge evidence are themselves only
    # ever computed from "All", so per-game-type buckets are outside
    # this correction's scope.
    corrected_local = compute_corrected_local_ratings(within_ratings_by_tier, offsets)
    for division in divisions:
        tier = tier_of(division["levelLabel"])
        if tier is None:
            continue
        all_rows = division["ratingsByType"]["All"]["teams"]
        if any((row["name"], tier) in corrected_local for row in all_rows):
            for row in all_rows:
                key = (row["name"], tier)
                if key in corrected_local:
                    row[rating_field] = corrected_local[key]
            # rerank_and_tier mutates each row's rank/tier fields in place
            # (it operates on the same dict objects regardless of the order
            # of the list passed in) -- its *return value* (a re-sorted
            # copy of the list) is intentionally discarded here, not used
            # to reorder `all_rows` itself. This function runs twice per
            # division (once for classic, once for experimental fields) on
            # the SAME shared row list; if either pass reordered the array,
            # whichever pass ran last would silently overwrite the other's
            # ordering (confirmed live: the classic rankings table briefly
            # displayed rows in experimental order). The array's own
            # canonical order is set once, explicitly, after all rating
            # types have been patched -- see compute_age_group_ratings.
            rerank_and_tier(all_rows, rating_field, rank_field, tier_field)

    return teams, offsets


def _merged_stats_for_age_group(divisions: list[dict]) -> dict[str, TeamStats]:
    """Each team's full preseason record across EVERY division it played a
    game in (its own declared division plus any cross-division tests),
    deduped by gameId -- the record shown once divisions display the
    unified rating should reflect the team's whole body of evidence, not
    just whichever division's schedule an individual game happened to be
    filed under."""
    seen_ids: set[str] = set()
    games: list[Game] = []
    for division in divisions:
        for g in division["games"]:
            if g["gameId"] in seen_ids or not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
                continue
            seen_ids.add(g["gameId"])
            games.append(Game(home=g["home"], away=g["away"], home_goals=g["homeGoals"], away_goals=g["awayGoals"]))
    return compute_team_stats(games)


def _strip_east_west(level_label: str) -> str:
    return re.sub(r"\s+(East|West)$", "", level_label).strip()


def filter_roster_to_declared(division: dict, declared_divisions: dict[str, str]) -> None:
    """Trim every ratingsByType bucket in `division` down to teams whose
    declared_divisions.json entry EXACTLY matches this division's own
    ageLabel+levelLabel. A team missing from declared_divisions.json
    (stale/incomplete file) is kept, not dropped -- "unknown" must never
    mean "doesn't belong here." Public (not `_`-prefixed): main() calls
    this per physical division payload, right after building it and before
    any age-group-wide rating computation reads its rosters -- see
    split_physical_division_by_declared_subdivisions for why that ordering
    matters."""
    declared_key = f"{division['ageLabel']} {division['levelLabel']}"

    def belongs_here(name: str) -> bool:
        declared = declared_divisions.get(name)
        return declared is None or declared == declared_key

    for bucket in division["ratingsByType"].values():
        bucket["teams"] = [row for row in bucket["teams"] if belongs_here(row["name"])]
        bucket["unratedTeams"] = [name for name in bucket["unratedTeams"] if belongs_here(name)]


def split_physical_division_by_declared_subdivisions(
    label: str, raw_games: list[dict], declared_divisions: dict[str, str]
) -> list[str]:
    """If the teams that actually appear in this physical level's games are
    declared across more than one label sharing the same base tier (e.g.
    "10U B East" and "10U B West" -- NorCal's own schedule feed has only
    ever exposed one lumped "10U B" schedule, see KNOWN_MISSING_LEVELS, but
    final declared placement can still split it), return that sorted list
    of labels so main() builds one division PAYLOAD per declared
    sub-label from the same underlying games, instead of one merged
    payload. Each such split is real ("B East" and "B West" are genuinely
    separate divisions from here on), not a relabeling -- their rosters
    just happen to share one preseason game history, since the split is a
    placement decision that postdates every preseason game played.

    Otherwise (no split exists in the declared data) returns [label]
    unchanged."""
    age_label, level_label = split_age_level(label)
    base = _strip_east_west(level_label)
    names = {g["home"] for g in raw_games} | {g["away"] for g in raw_games}
    sub_labels = set()
    for name in names:
        declared = declared_divisions.get(name)
        if declared is None:
            continue
        d_age, d_level = split_age_level(declared)
        if d_age == age_label and _strip_east_west(d_level) == base:
            sub_labels.add(declared)
    return sorted(sub_labels) if len(sub_labels) > 1 else [label]


def _apply_declared_roster_and_unified_rating(
    divisions: list[dict],
    teams: dict[str, dict],
    experimental_teams: dict[str, dict],
    declared_divisions: dict[str, str],
) -> None:
    """Filters every division's displayed roster down to teams officially
    declared there (see filter_roster_to_declared), synthesizes a row for a
    declared team that ends up with NO existing row in its new division
    (e.g. Stockton Colts 10-1's only cross-division evidence was a game
    filed under B's own schedule, so it never produced a row under BB even
    though BB is where it's now declared -- but its within-rating was still
    correctly computed and routed there, see _compute_unified_and_patch),
    replaces every division's displayed rating with the unified,
    cross-division-comparable number instead of the division-local one, and
    re-derives rank/tier for EVERY bucket (not just "All") now that rosters
    have changed -- a filtered bucket's rank/tier would otherwise still
    reflect the original, unfiltered pool's numbering.

    Deliberately runs AFTER _compute_unified_and_patch, not before: that
    function needs each division's FULL, unfiltered roster to correctly
    compute within-tier ratings (see its own routing logic for why),
    filtering here is purely about what gets DISPLAYED."""
    merged_stats = _merged_stats_for_age_group(divisions)

    for division in divisions:
        filter_roster_to_declared(division, declared_divisions)

        declared_key = f"{division['ageLabel']} {division['levelLabel']}"
        all_rows = division["ratingsByType"]["All"]["teams"]
        present = {row["name"] for row in all_rows}
        for name, declared in declared_divisions.items():
            if declared != declared_key or name in present:
                continue
            unified = teams.get(name)
            if unified is None or unified["gamesPlayed"] == 0:
                continue
            exp_unified = experimental_teams.get(name)
            all_rows.append(
                {
                    "name": name,
                    "rating": 0.0,
                    "rank": 0,
                    "tier": "mid",
                    "gamesPlayed": 0,
                    "wins": 0,
                    "losses": 0,
                    "ties": 0,
                    "points": 0,
                    "goalsFor": 0,
                    "goalsAgainst": 0,
                    "goalDiff": 0,
                    "offense": 0.0,
                    "defense": 0.0,
                    "experimentalRating": exp_unified["rating"] if exp_unified else 0.0,
                    "experimentalRank": 0,
                    "experimentalTier": "mid",
                }
            )

        for row in all_rows:
            unified = teams.get(row["name"])
            exp_unified = experimental_teams.get(row["name"])
            stats = merged_stats.get(row["name"])
            if unified is not None:
                row["rating"] = round(unified["rating"], 3)
            if exp_unified is not None:
                row["experimentalRating"] = round(exp_unified["rating"], 3)
            if stats is not None:
                row["gamesPlayed"] = stats.wins + stats.losses + stats.ties
                row["wins"] = stats.wins
                row["losses"] = stats.losses
                row["ties"] = stats.ties
                row["points"] = stats.points
                row["goalsFor"] = stats.goals_for
                row["goalsAgainst"] = stats.goals_against
                row["goalDiff"] = stats.goal_diff

        for bucket in division["ratingsByType"].values():
            rerank_and_tier(bucket["teams"], "rating", "rank", "tier")
            rerank_and_tier(bucket["teams"], "experimentalRating", "experimentalRank", "experimentalTier")


def compute_age_group_ratings(
    payload_divisions: list[dict], declared_divisions: dict[str, str] | None = None
) -> dict[str, dict]:
    """One unified, cross-division-comparable rating per team, spanning every
    division within an age group (10U, 12U, ...) -- not just its own.
    Computed for both the classic rating and the experimental
    offense/defense-derived rating (see _compute_unified_and_patch).

    A division-scoped rating (ratingsByType) can't be compared across
    divisions on its own -- each is centered to its own division's mean,
    with no notion that e.g. BB is generally a stronger division than B.
    See compute_tier_offsets in ratings.py for the model: each division's
    within-rating gets an additive offset, defaulting to the empirical rule
    "a tier's bottom is on par with the tier above's top", refined by real
    cross-division game evidence in proportion to how much of it exists.

    Once computed, this same unified rating is also what each division's
    OWN "All" roster displays (see _apply_declared_roster_and_unified_rating)
    -- there is no longer a separate, division-local-only rating shown
    anywhere on the site; and that roster is filtered to each team's
    officially DECLARED division, not just wherever it happened to play a
    game (a preseason cross-division test no longer leaves a team's name
    sitting in a division's roster it doesn't actually belong to).
    """
    divisions_by_age: dict[str, list[dict]] = {}
    for division in payload_divisions:
        divisions_by_age.setdefault(division["ageLabel"], []).append(division)

    if declared_divisions is None:
        declared_divisions = load_declared_divisions()

    age_groups: dict[str, dict] = {}
    for age_label, divisions in divisions_by_age.items():
        teams, offsets = _compute_unified_and_patch(divisions, "rating", "rank", "tier", declared_divisions)
        if not offsets:
            continue
        experimental_teams, experimental_offsets = _compute_unified_and_patch(
            divisions, "experimentalRating", "experimentalRank", "experimentalTier", declared_divisions
        )

        _apply_declared_roster_and_unified_rating(divisions, teams, experimental_teams, declared_divisions)

        # Canonical row order, set once after both rating types have
        # patched their own fields -- classic rank ascending. (The frontend
        # table is independently sortable by any column now, so this only
        # matters as a sane default / for any other consumer of the data.)
        for division in divisions:
            division["ratingsByType"]["All"]["teams"].sort(key=lambda row: row["rank"])

        age_groups[age_label] = {
            "teams": teams,
            "tierOffsets": offsets,
            "experimentalTeams": experimental_teams,
            "experimentalTierOffsets": experimental_offsets,
        }

    return age_groups


def main() -> int:
    session = _session()
    divisions = discover_divisions(session)
    if not divisions:
        print("No divisions discovered -- aborting without overwriting data/latest.json", file=sys.stderr)
        return 1
    team_ids = load_team_ids()
    declared_divisions = load_declared_divisions()

    payload_divisions = []
    for i, (level_id, label) in enumerate(sorted(divisions.items())):
        if i > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        games = fetch_division_games(session, level_id)
        print(f"  {label} (level={level_id}): {len(games)} games", file=sys.stderr)

        sub_labels = split_physical_division_by_declared_subdivisions(label, games, declared_divisions)
        for sub_label in sub_labels:
            payload_divisions.append(build_division_payload(level_id, sub_label, games, team_ids))
            if len(sub_labels) > 1:
                print(f"    -> split into {sub_label!r}", file=sys.stderr)

    age_groups = compute_age_group_ratings(payload_divisions, declared_divisions)
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
