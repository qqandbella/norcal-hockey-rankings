"""Capped, shrinkage-regularized iterative rating for a set of games.

Same family as MyHockeyRankings' iterative averaging: each team's rating is
the average of (opponent rating + goal differential) across its games. Two
modifications on top of the plain average:

- Goal differential is capped at +/-GOAL_CAP before being used. Beyond that
  cap, additional goals mostly reflect ice-time/lineup decisions late in a
  blowout, not additional information about relative team strength.
- A ridge shrinkage term (K) pulls each team's rating toward 0 in proportion
  to how few games it has played. With ~3 games per team this matters a lot:
  an unregularized average lets one blowout swing a season-long-looking
  rating from three data points.

This is a Jacobi iteration solving a ridge-regularized Massey/least-squares
rating system, not a heuristic average.
"""

from __future__ import annotations

from dataclasses import dataclass, field

GOAL_CAP = 7
SHRINKAGE_K = 3.0
MAX_ITERS = 300
CONVERGENCE_EPS = 1e-9


@dataclass
class Game:
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass
class TeamRating:
    name: str
    rating: float
    games_played: int
    rank: int = 0
    tier: str = "mid"


def _capped_margin(home_goals: int, away_goals: int) -> int:
    margin = home_goals - away_goals
    return max(-GOAL_CAP, min(GOAL_CAP, margin))


def compute_ratings(games: list[Game], k: float = SHRINKAGE_K) -> list[TeamRating]:
    """Compute centered, shrinkage-regularized ratings for all teams in `games`."""
    teams = sorted({g.home for g in games} | {g.away for g in games})
    if not teams:
        return []

    adjacency: dict[str, list[tuple[str, int]]] = {t: [] for t in teams}
    for g in games:
        margin = _capped_margin(g.home_goals, g.away_goals)
        adjacency[g.home].append((g.away, margin))
        adjacency[g.away].append((g.home, -margin))

    rating = {t: 0.0 for t in teams}
    for _ in range(MAX_ITERS):
        new_rating = {}
        max_delta = 0.0
        for t in teams:
            opp_games = adjacency[t]
            n = len(opp_games)
            total = sum(rating[opp] + margin for opp, margin in opp_games)
            new_rating[t] = total / (n + k)
            max_delta = max(max_delta, abs(new_rating[t] - rating[t]))
        rating = new_rating
        if max_delta < CONVERGENCE_EPS:
            break

    mean = sum(rating.values()) / len(rating)
    centered = {t: v - mean for t, v in rating.items()}

    ordered = sorted(teams, key=lambda t: -centered[t])
    n_teams = len(ordered)
    results: list[TeamRating] = []
    for i, t in enumerate(ordered):
        rank = i + 1
        if rank <= max(1, round(n_teams / 3)):
            tier = "top"
        elif rank <= max(1, round(2 * n_teams / 3)):
            tier = "mid"
        else:
            tier = "low"
        results.append(
            TeamRating(
                name=t,
                rating=round(centered[t], 3),
                games_played=len(adjacency[t]),
                rank=rank,
                tier=tier,
            )
        )
    return results
