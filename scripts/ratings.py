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

from dataclasses import dataclass

GOAL_CAP = 7
SHRINKAGE_K = 3.0
MAX_ITERS = 300
CONVERGENCE_EPS = 1e-9

# Top to bottom. Mirrors src/lib/grouping.ts's LEVEL_ORDER -- keep both in
# sync if this list changes.
DIVISION_HIERARCHY = ["AA", "A", "BB", "B"]

# Pseudo-observation weight for the "a tier's bottom is roughly on par with
# the tier above's top" prior when blending it with real cross-division
# evidence (see compute_tier_offsets). ~5 independent bridge-game
# observations are needed to meaningfully override the prior; one or two
# noisy games barely move it.
W_PRIOR = 5.0

# Standard hockey points: win=2, tie=1, loss=0. The source feed carries no
# OT/shootout marker, so ties are recorded as plain ties rather than OTL.
POINTS_WIN = 2
POINTS_TIE = 1
POINTS_LOSS = 0


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


@dataclass
class TeamStats:
    name: str
    wins: int = 0
    losses: int = 0
    ties: int = 0
    points: int = 0
    goals_for: int = 0
    goals_against: int = 0

    @property
    def goal_diff(self) -> int:
        return self.goals_for - self.goals_against


def capped_margin(home_goals: int, away_goals: int) -> int:
    margin = home_goals - away_goals
    return max(-GOAL_CAP, min(GOAL_CAP, margin))


def compute_ratings(games: list[Game], k: float = SHRINKAGE_K) -> list[TeamRating]:
    """Compute centered, shrinkage-regularized ratings for all teams in `games`."""
    teams = sorted({g.home for g in games} | {g.away for g in games})
    if not teams:
        return []

    adjacency: dict[str, list[tuple[str, int]]] = {t: [] for t in teams}
    for g in games:
        margin = capped_margin(g.home_goals, g.away_goals)
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


def _adjacent_pair(t1: str, t2: str) -> tuple[str, str] | None:
    """Return (higher, lower) if t1/t2 are adjacent in DIVISION_HIERARCHY,
    else None. Non-adjacent cross-division evidence (e.g. a game directly
    between A and B, skipping BB) is intentionally not used -- rare, and
    handled implicitly once each adjacent hop's offset is chained."""
    if t1 not in DIVISION_HIERARCHY or t2 not in DIVISION_HIERARCHY:
        return None
    i1, i2 = DIVISION_HIERARCHY.index(t1), DIVISION_HIERARCHY.index(t2)
    if abs(i1 - i2) != 1:
        return None
    return (t1, t2) if i1 < i2 else (t2, t1)


def compute_primary_tiers(within_ratings_by_tier: dict[str, list[TeamRating]]) -> dict[str, str]:
    """Each team's primary tier -- whichever tier it has the most games in
    (almost always its only tier). Shared by compute_tier_offsets and
    anything else (e.g. the backtest) that needs to know which tier a team
    is really "from" as of a given set of within-division ratings."""
    primary_tier: dict[str, str] = {}
    most_games: dict[str, int] = {}
    for tier, rows in within_ratings_by_tier.items():
        for r in rows:
            if r.games_played > most_games.get(r.name, -1):
                most_games[r.name] = r.games_played
                primary_tier[r.name] = tier
    return primary_tier


def compute_tier_offsets(
    within_ratings_by_tier: dict[str, list[TeamRating]],
    bridge_games: list[tuple[str, str, int, str]],
    w_prior: float = W_PRIOR,
) -> dict[str, dict]:
    """Offset to add to each tier's within-division ratings so they land on
    one shared, cross-division-comparable scale.

    `bridge_games` is every *played* game across an age group's divisions,
    as (home, away, capped_margin, game_tier) -- capped_margin is
    home_goals - away_goals already capped to +/-GOAL_CAP. `game_tier` is
    informational only (which division filed the game); it does not drive
    the math below.

    Each team's *primary* tier is whichever tier it has the most games in
    (almost always its only tier). A game is ordinary, contributing nothing,
    when both sides share the same primary tier. It becomes bridge evidence
    only when the two sides' primary tiers differ -- e.g. a team primarily
    playing BB (3 games there) that also has one B game is evidence for that
    one game, translated through its *established* BB rating, not its
    single-game B rating; its other 3 (ordinary, BB-vs-BB) games are not
    re-litigated as evidence just because it happens to also play B.

    Returns {tier: {"offset": float, "evidenceCount": int}}, offsets
    relative to the lowest tier present (which gets offset 0).
    """
    rating_by_tier_name: dict[str, dict[str, float]] = {
        tier: {r.name: r.rating for r in rows} for tier, rows in within_ratings_by_tier.items() if rows
    }
    primary_tier = compute_primary_tiers(within_ratings_by_tier)

    # (higher_tier, lower_tier) -> list of evidence dicts, each carrying
    # enough detail to explain the observation on its own (which two teams,
    # which game, what gap it implies) -- not just the bare number, so the
    # site can show *why* a prediction says what it says.
    evidence: dict[tuple[str, str], list[dict]] = {}

    for home, away, margin, _game_tier in bridge_games:
        home_tier, away_tier = primary_tier.get(home), primary_tier.get(away)
        if home_tier is None or away_tier is None or home_tier == away_tier:
            continue
        pair = _adjacent_pair(home_tier, away_tier)
        if pair is None:
            continue
        home_rating = rating_by_tier_name[home_tier][home]
        away_rating = rating_by_tier_name[away_tier][away]
        # unified(home) - unified(away) = margin
        # (home_rating + offset[home_tier]) - (away_rating + offset[away_tier]) = margin
        gap = margin - home_rating + away_rating  # offset[home_tier] - offset[away_tier]
        gap = gap if pair == (home_tier, away_tier) else -gap
        evidence.setdefault(pair, []).append(
            {
                "homeTeam": home,
                "homeTier": home_tier,
                "awayTeam": away,
                "awayTier": away_tier,
                "margin": margin,
                "impliedGap": round(gap, 3),
            }
        )

    tiers_present = [t for t in DIVISION_HIERARCHY if t in rating_by_tier_name]
    offsets: dict[str, dict] = {}
    if not tiers_present:
        return offsets

    # Bottom of the hierarchy present is the reference point.
    offsets[tiers_present[-1]] = {"offset": 0.0, "evidenceCount": 0, "priorAnchor": None, "bridgeGames": []}
    for i in range(len(tiers_present) - 2, -1, -1):
        higher, lower = tiers_present[i], tiers_present[i + 1]
        low_rows = within_ratings_by_tier[lower]
        high_rows = within_ratings_by_tier[higher]
        low_top = max(low_rows, key=lambda r: r.rating)
        high_bottom = min(high_rows, key=lambda r: r.rating)
        prior_gap = low_top.rating - high_bottom.rating
        prior_anchor = {
            "lowTeam": low_top.name,
            "lowRating": low_top.rating,
            "highTeam": high_bottom.name,
            "highRating": high_bottom.rating,
            "gap": round(prior_gap, 3),
        }
        bridges = evidence.get((higher, lower), [])
        blended = (w_prior * prior_gap + sum(b["impliedGap"] for b in bridges)) / (w_prior + len(bridges))
        offsets[higher] = {
            "offset": round(offsets[lower]["offset"] + blended, 3),
            "evidenceCount": len(bridges),
            "priorAnchor": prior_anchor,
            "bridgeGames": bridges,
        }
    return offsets


def compute_team_stats(games: list[Game]) -> dict[str, TeamStats]:
    """Traditional W-L-T / points / GF / GA, uncalibrated -- the official-style
    counting stats, independent of the rating model above."""
    stats: dict[str, TeamStats] = {}

    def _get(name: str) -> TeamStats:
        if name not in stats:
            stats[name] = TeamStats(name=name)
        return stats[name]

    for g in games:
        home, away = _get(g.home), _get(g.away)
        home.goals_for += g.home_goals
        home.goals_against += g.away_goals
        away.goals_for += g.away_goals
        away.goals_against += g.home_goals

        if g.home_goals > g.away_goals:
            home.wins += 1
            home.points += POINTS_WIN
            away.losses += 1
            away.points += POINTS_LOSS
        elif g.home_goals < g.away_goals:
            away.wins += 1
            away.points += POINTS_WIN
            home.losses += 1
            home.points += POINTS_LOSS
        else:
            home.ties += 1
            away.ties += 1
            home.points += POINTS_TIE
            away.points += POINTS_TIE

    return stats
