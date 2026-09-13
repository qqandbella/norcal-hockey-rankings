"""Walk-forward comparison: does splitting each team's rating into separate
offense/defense components (compute_offense_defense_ratings) predict
held-out games better than the existing single-scalar rating
(compute_ratings)?

Scoped to WITHIN-division games only, one division at a time -- a fair,
simple comparison that sidesteps the cross-division tier-offset machinery
entirely (irrelevant here: both models start from the same per-division
game log, and offense/defense hasn't been extended to work with tier
offsets at all yet -- see GitHub issue #6). If this shows a real
improvement, extending it across divisions is a separate follow-up.

Same walk-forward discipline as scripts/backtest.py: for each played game,
in chronological order, refit both models using only games strictly before
it, predict, compare to the actual (capped) margin.

Usage: python3 scripts/backtest_offense_defense.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from backtest import parse_game_datetime
from ratings import Game, capped_margin, compute_offense_defense_ratings, compute_ratings

DATA_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "latest.json"


@dataclass
class Comparison:
    actual_margin: int
    single_predicted: float | None
    od_predicted: float | None

    @property
    def single_error(self) -> float | None:
        return None if self.single_predicted is None else abs(self.single_predicted - self.actual_margin)

    @property
    def od_error(self) -> float | None:
        return None if self.od_predicted is None else abs(self.od_predicted - self.actual_margin)


def _division_games_chronological(division: dict) -> list[tuple]:
    """(datetime, home, away, home_goals, away_goals) for this division's
    own played games, in chronological order."""
    out = []
    for g in division["games"]:
        if not g["played"] or g["homeGoals"] is None or g["awayGoals"] is None:
            continue
        dt = parse_game_datetime(g["date"], g["time"])
        if dt is None:
            continue
        out.append((dt, g["home"], g["away"], g["homeGoals"], g["awayGoals"]))
    return sorted(out, key=lambda t: t[0])


def walk_forward_division(division: dict) -> list[Comparison]:
    ordered = _division_games_chronological(division)
    results: list[Comparison] = []
    for i, (_, home, away, home_goals, away_goals) in enumerate(ordered):
        prior = [Game(h, a, hg, ag) for _, h, a, hg, ag in ordered[:i]]
        actual = capped_margin(home_goals, away_goals)

        single_predicted = None
        if prior:
            single = {r.name: r.rating for r in compute_ratings(prior)}
            if home in single and away in single:
                single_predicted = round(single[home] - single[away], 3)

        od_predicted = None
        if prior:
            od = {r.name: r for r in compute_offense_defense_ratings(prior)}
            if home in od and away in od:
                od_predicted = round(
                    (od[home].offense - od[away].defense) - (od[away].offense - od[home].defense), 3
                )

        results.append(Comparison(actual_margin=actual, single_predicted=single_predicted, od_predicted=od_predicted))
    return results


def main() -> int:
    if not DATA_PATH.exists():
        print(f"{DATA_PATH} not found -- run scripts/scrape.py first.", file=sys.stderr)
        return 1
    data = json.loads(DATA_PATH.read_text())

    all_results: list[Comparison] = []
    for division in data["divisions"]:
        all_results.extend(walk_forward_division(division))

    single_scored = [r for r in all_results if r.single_error is not None]
    od_scored = [r for r in all_results if r.od_error is not None]
    both_scored = [r for r in all_results if r.single_error is not None and r.od_error is not None]

    single_mae = sum(r.single_error for r in single_scored) / len(single_scored) if single_scored else None
    od_mae = sum(r.od_error for r in od_scored) / len(od_scored) if od_scored else None
    baseline_mae = sum(abs(r.actual_margin) for r in both_scored) / len(both_scored) if both_scored else None

    single_correct = sum(
        1 for r in both_scored if r.actual_margin != 0 and (r.single_predicted > 0) == (r.actual_margin > 0)
    )
    od_correct = sum(1 for r in both_scored if r.actual_margin != 0 and (r.od_predicted > 0) == (r.actual_margin > 0))
    nonzero = sum(1 for r in both_scored if r.actual_margin != 0)

    print(f"Within-division walk-forward comparison over {len(both_scored)} games (both models scoreable)")
    print(f"  baseline MAE (predict even game): {baseline_mae:.3f} goals")
    print(f"  single-rating model MAE:          {single_mae:.3f} goals")
    print(f"  offense/defense model MAE:        {od_mae:.3f} goals")
    print(f"  single-rating directional accuracy:    {single_correct / nonzero:.1%}" if nonzero else "  n/a")
    print(f"  offense/defense directional accuracy:  {od_correct / nonzero:.1%}" if nonzero else "  n/a")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
