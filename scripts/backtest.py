"""Walk-forward backtest: does the rating model actually predict held-out
games, or is it just fitting noise?

For every played game, in chronological order, refit the model using only
games that happened *before* it, predict that game's (capped) margin, and
compare to what actually happened. This is the honest way to validate a
low-data rating system -- not "does the final rating look plausible" but
"if we'd stopped the season the day before this game, would we have called
it right." Standard walk-forward validation, exact (not sampled) since the
whole dataset is only ~100-300 games.

Reads the already-scraped public/data/latest.json (no network calls) --
run `python3 scripts/scrape.py` first if you want this against fresher data.

Usage: python3 scripts/backtest.py
"""

from __future__ import annotations

import datetime
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from ratings import Game, capped_margin, compute_primary_tiers, compute_ratings, compute_tier_offsets
from scrape import tier_of

DATA_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "latest.json"


def parse_game_datetime(date_str: str, time_str: str) -> datetime.datetime | None:
    """"09/12/26" + "3:15PM" -> datetime. None if unparseable (excluded from
    the walk-forward order entirely rather than guessed at)."""
    try:
        date_part = datetime.datetime.strptime(date_str, "%m/%d/%y")
        time_part = datetime.datetime.strptime(time_str, "%I:%M%p")
    except ValueError:
        return None
    return date_part.replace(hour=time_part.hour, minute=time_part.minute)


@dataclass
class HeldOutGame:
    dt: datetime.datetime
    age_label: str
    home: str
    away: str
    actual_margin: int


@dataclass
class PredictionResult:
    game: HeldOutGame
    predicted_margin: float | None  # None if either team has zero prior games anywhere
    cross_division: bool | None  # None when predicted_margin is None (unknown)

    @property
    def error(self) -> float | None:
        if self.predicted_margin is None:
            return None
        return self.predicted_margin - self.game.actual_margin


def load_played_games(data: dict) -> list[HeldOutGame]:
    games: list[HeldOutGame] = []
    seen_ids: set[str] = set()
    for division in data["divisions"]:
        for g in division["games"]:
            if g["gameId"] in seen_ids:
                continue
            seen_ids.add(g["gameId"])
            if not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
                continue
            dt = parse_game_datetime(g["date"], g["time"])
            if dt is None:
                continue
            games.append(
                HeldOutGame(
                    dt=dt,
                    age_label=g["ageLabel"],
                    home=g["home"],
                    away=g["away"],
                    actual_margin=capped_margin(g["homeGoals"], g["awayGoals"]),
                )
            )
    return sorted(games, key=lambda g: g.dt)


def _within_ratings_by_tier(divisions: list[dict], age_label: str, up_to: datetime.datetime) -> dict[str, list]:
    """Refit each division's within-rating using only games strictly before
    `up_to`, for one age group. Re-run here on a truncated game list rather
    than trusting the (fully season-to-date) precomputed ratingsByType."""
    by_tier: dict[str, list] = {}
    for division in divisions:
        if division["ageLabel"] != age_label:
            continue
        tier = tier_of(division["levelLabel"])
        if tier is None:
            continue
        rating_games = []
        for g in division["games"]:
            if not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
                continue
            dt = parse_game_datetime(g["date"], g["time"])
            if dt is None or dt >= up_to:
                continue
            rating_games.append(
                Game(home=g["home"], away=g["away"], home_goals=g["homeGoals"], away_goals=g["awayGoals"])
            )
        if not rating_games:
            continue
        by_tier.setdefault(tier, []).extend(compute_ratings(rating_games))
    return by_tier


def _bridge_games(divisions: list[dict], age_label: str, up_to: datetime.datetime) -> list[tuple[str, str, int, str]]:
    bridges = []
    seen_ids: set[str] = set()
    for division in divisions:
        if division["ageLabel"] != age_label:
            continue
        for g in division["games"]:
            if g["gameId"] in seen_ids:
                continue
            seen_ids.add(g["gameId"])
            if not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
                continue
            dt = parse_game_datetime(g["date"], g["time"])
            if dt is None or dt >= up_to:
                continue
            game_tier = tier_of(g["levelLabel"])
            if game_tier is None:
                continue
            bridges.append((g["home"], g["away"], capped_margin(g["homeGoals"], g["awayGoals"]), game_tier))
    return bridges


def predict_one(divisions: list[dict], game: HeldOutGame) -> PredictionResult:
    within = _within_ratings_by_tier(divisions, game.age_label, game.dt)
    if not within:
        return PredictionResult(game=game, predicted_margin=None, cross_division=None)

    primary_tier = compute_primary_tiers(within)
    home_tier, away_tier = primary_tier.get(game.home), primary_tier.get(game.away)
    if home_tier is None or away_tier is None:
        # Cold start: one of the teams has never played before this game.
        return PredictionResult(game=game, predicted_margin=None, cross_division=None)

    bridges = _bridge_games(divisions, game.age_label, game.dt)
    offsets = compute_tier_offsets(within, bridges)

    def rating_of(name: str, tier: str) -> float:
        return next(r.rating for r in within[tier] if r.name == name) + offsets.get(tier, {"offset": 0.0})["offset"]

    predicted = round(rating_of(game.home, home_tier) - rating_of(game.away, away_tier), 3)
    return PredictionResult(game=game, predicted_margin=predicted, cross_division=home_tier != away_tier)


def walk_forward(data: dict) -> list[PredictionResult]:
    games = load_played_games(data)
    return [predict_one(data["divisions"], g) for g in games]


def _mae(results: list[PredictionResult]) -> float | None:
    errors = [abs(r.error) for r in results if r.error is not None]
    return sum(errors) / len(errors) if errors else None


def _directional_accuracy(results: list[PredictionResult]) -> float | None:
    scored = [r for r in results if r.predicted_margin is not None and r.game.actual_margin != 0]
    if not scored:
        return None
    correct = sum(1 for r in scored if (r.predicted_margin > 0) == (r.game.actual_margin > 0))
    return correct / len(scored)


def _baseline_mae(results: list[PredictionResult]) -> float | None:
    """Predicting margin=0 (a coin-flip-even game) for everything -- the bar
    the real model needs to clear to be worth anything."""
    scored = [r for r in results if r.predicted_margin is not None]
    if not scored:
        return None
    return sum(abs(r.game.actual_margin) for r in scored) / len(scored)


def report_segment(name: str, results: list[PredictionResult]) -> None:
    scored = [r for r in results if r.predicted_margin is not None]
    skipped = len(results) - len(scored)
    mae = _mae(results)
    baseline = _baseline_mae(results)
    acc = _directional_accuracy(results)
    print(f"\n{name}: {len(results)} games ({skipped} skipped, cold start -- a team with 0 prior games)")
    if mae is None:
        print("  no scoreable predictions")
        return
    print(f"  model MAE:        {mae:.3f} goals")
    print(f"  baseline MAE (predict even game): {baseline:.3f} goals")
    print(f"  model vs baseline: {'BEATS' if mae < baseline else 'DOES NOT BEAT'} the naive baseline")
    if acc is not None:
        print(f"  directional accuracy (correct favorite): {acc:.1%}")


def main() -> int:
    if not DATA_PATH.exists():
        print(f"{DATA_PATH} not found -- run scripts/scrape.py first.", file=sys.stderr)
        return 1
    data = json.loads(DATA_PATH.read_text())
    results = walk_forward(data)

    print(f"Walk-forward backtest over {len(results)} played games (data as of {data['scraped_at']})")
    report_segment("ALL games", results)
    report_segment("Within-division games", [r for r in results if r.cross_division is False])
    report_segment("Cross-division games", [r for r in results if r.cross_division is True])

    warm = [r for r in results if r.predicted_margin is not None]
    print(f"\n{len(warm)}/{len(results)} games had both teams with prior history to predict from.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
