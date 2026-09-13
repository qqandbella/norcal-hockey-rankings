"""Does blending shots-on-goal into the offense/defense split
(compute_offense_defense_ratings) predict held-out games better than goals
alone?

Motivation: goals are a noisy, low-count signal (a handful of goals per
game); shots are a higher-volume signal of sustained offensive/defensive
process that correlates with true strength even when finishing varies
game to game -- the same idea behind Corsi/Fenwick shot-attempt metrics in
the NHL. A team that generates 16 shots but scores 5 (leaky finishing, or a
hot opposing goalie) is probably a bit better than its 5 goals alone
suggest; a team that manages only 4 shots the whole game is probably worse
than a scoreline like 0-3 alone would suggest.

Model: for each game, blend the actual (capped) goals-for with a
shot-implied "expected goals" (shots-for * league-average shooting %,
capped the same way) at weight w, before feeding into the same bilinear
offense/defense solve compute_offense_defense_ratings already uses.
w=0 is an exact reduction to the currently-shipped, goals-only model (the
baseline to beat, not a strawman) -- this is a strict generalization, not
a different mechanism.

Scoped to 10U only, since that's the only age group with shots data so far
(scripts/shots_cache.json, via scripts/fetch_shots.py -- see GitHub issue
#6). Only games that HAVE shots data are used as held-out prediction
targets, so the goals-only and shot-blended models are compared on an
identical set of games -- apples to apples, not "shots helps because it
was tested on an easier subset."

RESULT (2026-09-13, 54 games / 30 held-out predictions): weak and
equivocal, NOT shipped. Best case found (grid search over both w and k):
MAE improves ~5% (2.925 -> 2.776) at w=0.3 with directional accuracy flat
(89.3%), but pushing the blend weight higher trades MAE for a real
accuracy *regression* (down to 85.7%) -- a genuine tension between the two
metrics, not a clean win on both, unlike the goals-only offense/defense
split's win (MAE -17%, accuracy +5.8pp, consistent across a wide k range).
Two reasons not to trust this yet: only 30 held-out games to tune TWO free
parameters (w and k) against -- real overfitting risk on a grid that
small -- and the goals-only baseline already hits 89.3% accuracy on this
particular subset (a ceiling effect, less room for any signal to show).
Revisit once more games' worth of shots data exists (run fetch_shots.py
again later in the season), not by re-tuning harder against the same 30
games.

Usage: python3 scripts/backtest_shots_blend.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from backtest import parse_game_datetime
from ratings import GOAL_CAP, OFFENSE_DEFENSE_SHRINKAGE_K

DATA_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "latest.json"
SHOTS_CACHE_PATH = Path(__file__).resolve().parent / "shots_cache.json"
AGE_LABEL = "10U"


def _cap(x: float) -> float:
    return max(0.0, min(GOAL_CAP, x))


def _offense_defense_from_blended(
    games: list[tuple[str, str, float, float]], k: float
) -> dict[str, tuple[float, float]]:
    """Same bilinear Jacobi solve as compute_offense_defense_ratings, but
    taking pre-blended float goals-for/against per game instead of always
    deriving them from a Game's raw int goals -- kept standalone here
    rather than generalizing the shipped function's signature until this
    is validated."""
    teams = sorted({h for h, _, _, _ in games} | {a for _, a, _, _ in games})
    if not teams:
        return {}
    adjacency: dict[str, list[tuple[str, float, float]]] = {t: [] for t in teams}
    for home, away, home_for, away_for in games:
        adjacency[home].append((away, home_for, away_for))
        adjacency[away].append((home, away_for, home_for))

    offense = {t: 0.0 for t in teams}
    defense = {t: 0.0 for t in teams}
    for _ in range(300):
        new_offense: dict[str, float] = {}
        new_defense: dict[str, float] = {}
        max_delta = 0.0
        for t in teams:
            opp_games = adjacency[t]
            n = len(opp_games)
            implied_offense = [defense[opp] + goals_for for opp, goals_for, _ in opp_games]
            implied_defense = [offense[opp] - goals_against for opp, _, goals_against in opp_games]
            new_offense[t] = sum(implied_offense) / (n + k)
            new_defense[t] = sum(implied_defense) / (n + k)
            max_delta = max(max_delta, abs(new_offense[t] - offense[t]), abs(new_defense[t] - defense[t]))
        offense, defense = new_offense, new_defense
        if max_delta < 1e-9:
            break

    offense_mean = sum(offense.values()) / len(offense)
    defense_mean = sum(defense.values()) / len(defense)
    return {t: (offense[t] - offense_mean, defense[t] - defense_mean) for t in teams}


def load_shot_games(data: dict, shots_cache: dict) -> dict[str, list[dict]]:
    """gameId -> enriched game dict, for this age group's played games with
    shots data, grouped by division levelId, in chronological order."""
    by_division: dict[int, list[dict]] = {}
    seen: set[str] = set()
    for division in data["divisions"]:
        if division["ageLabel"] != AGE_LABEL:
            continue
        for g in division["games"]:
            if g["gameId"] in seen or not g["played"] or g["gameId"] not in shots_cache:
                continue
            seen.add(g["gameId"])
            dt = parse_game_datetime(g["date"], g["time"])
            if dt is None:
                continue
            shots = shots_cache[g["gameId"]]
            by_division.setdefault(division["levelId"], []).append(
                {
                    "dt": dt,
                    "home": g["home"],
                    "away": g["away"],
                    "home_goals": g["homeGoals"],
                    "away_goals": g["awayGoals"],
                    "home_shots": int(shots["home_shots"]),
                    "away_shots": int(shots["away_shots"]),
                }
            )
    for games in by_division.values():
        games.sort(key=lambda g: g["dt"])
    return by_division


def walk_forward(by_division: dict[int, list[dict]], w: float, k: float) -> list[tuple[float, float, float]]:
    """Returns (actual_margin, goals_only_predicted, blended_predicted) per
    held-out game."""
    results = []
    for games in by_division.values():
        for i, g in enumerate(games):
            prior = games[:i]
            if not prior:
                continue
            actual = _cap(g["home_goals"]) - _cap(g["away_goals"])

            total_goals = sum(p["home_goals"] + p["away_goals"] for p in prior)
            total_shots = sum(p["home_shots"] + p["away_shots"] for p in prior)
            shot_pct = total_goals / total_shots if total_shots else 0.0

            goals_only_games = [(p["home"], p["away"], _cap(p["home_goals"]), _cap(p["away_goals"])) for p in prior]
            blended_games = [
                (
                    p["home"],
                    p["away"],
                    (1 - w) * _cap(p["home_goals"]) + w * _cap(p["home_shots"] * shot_pct),
                    (1 - w) * _cap(p["away_goals"]) + w * _cap(p["away_shots"] * shot_pct),
                )
                for p in prior
            ]

            goals_only = _offense_defense_from_blended(goals_only_games, k)
            blended = _offense_defense_from_blended(blended_games, k)
            if g["home"] not in goals_only or g["away"] not in goals_only:
                continue

            go_off, go_def = goals_only[g["home"]]
            go_off_a, go_def_a = goals_only[g["away"]]
            goals_only_predicted = (go_off - go_def_a) - (go_off_a - go_def)

            bl_off, bl_def = blended[g["home"]]
            bl_off_a, bl_def_a = blended[g["away"]]
            blended_predicted = (bl_off - bl_def_a) - (bl_off_a - bl_def)

            results.append((actual, goals_only_predicted, blended_predicted))
    return results


def _mae(results: list[tuple[float, float, float]], idx: int) -> float:
    return sum(abs(r[idx] - r[0]) for r in results) / len(results)


def _accuracy(results: list[tuple[float, float, float]], idx: int) -> float:
    nz = [r for r in results if r[0] != 0]
    return sum(1 for r in nz if (r[idx] > 0) == (r[0] > 0)) / len(nz)


def main() -> int:
    if not DATA_PATH.exists():
        print(f"{DATA_PATH} not found -- run scripts/scrape.py first.", file=sys.stderr)
        return 1
    if not SHOTS_CACHE_PATH.exists():
        print(f"{SHOTS_CACHE_PATH} not found -- run scripts/fetch_shots.py first.", file=sys.stderr)
        return 1

    data = json.loads(DATA_PATH.read_text())
    shots_cache = json.loads(SHOTS_CACHE_PATH.read_text())
    by_division = load_shot_games(data, shots_cache)
    n_games = sum(len(g) for g in by_division.values())
    print(f"{AGE_LABEL}: {n_games} played games with shots data across {len(by_division)} divisions", file=sys.stderr)

    k = OFFENSE_DEFENSE_SHRINKAGE_K
    print(f"\nGrid search over blend weight w (k={k} fixed):", file=sys.stderr)
    print(f"{'w':>5}  {'goals-only MAE':>15}  {'blended MAE':>12}  {'goals-only acc':>15}  {'blended acc':>12}")
    for w in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]:
        results = walk_forward(by_division, w, k)
        if not results:
            continue
        go_mae, bl_mae = _mae(results, 1), _mae(results, 2)
        go_acc, bl_acc = _accuracy(results, 1), _accuracy(results, 2)
        print(f"{w:5.1f}  {go_mae:15.3f}  {bl_mae:12.3f}  {go_acc:14.1%}  {bl_acc:12.1%}  (n={len(results)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
