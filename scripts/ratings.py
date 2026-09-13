"""Capped, shrinkage-regularized iterative rating for a set of games.

Same family as MyHockeyRankings' iterative averaging: each team's rating is
the average of (opponent rating + goal differential) across its games. Three
modifications on top of the plain average:

- Goal differential is capped at +/-GOAL_CAP before being used. Beyond that
  cap, additional goals mostly reflect ice-time/lineup decisions late in a
  blowout, not additional information about relative team strength.
- A ridge shrinkage term (K) pulls each team's rating toward 0 in proportion
  to how few games it has played. With ~3 games per team this matters a lot:
  an unregularized average lets one blowout swing a season-long-looking
  rating from three data points.
- That shrinkage is *variance-aware*, not uniform: a team whose games all
  imply roughly the same strength (e.g. capped wins over several
  differently-weak opponents) is shrunk less than a team with the same game
  count but a scattered, inconsistent record. A fixed K=3 for both
  under-states a team whose entire profile is consistently extreme -- e.g. a
  team that beats everyone by the capped margin has *more* real evidence of
  being dominant than the raw capped numbers alone can show, and uniform
  shrinkage was suppressing that evidence identically to a team with a messy
  1-blowout-win/1-blowout-loss/1-close-game record.

This is a Jacobi iteration solving a ridge-regularized Massey/least-squares
rating system, not a heuristic average.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

GOAL_CAP = 7
SHRINKAGE_K = 3.0
MAX_ITERS = 300
CONVERGENCE_EPS = 1e-9

# Variance of a uniform margin over [-GOAL_CAP, GOAL_CAP] -- the reference
# point for "typical, uninformative" game-to-game spread. A team whose own
# implied-value variance sits well below this is unusually consistent
# (trust it more, shrink less); well above it is unusually scattered (trust
# it less, shrink more). Bounds picked via scripts/backtest.py grid search
# (walk-forward MAE/directional-accuracy), not guessed -- (0.1, 8.0) beat
# tighter bounds like (0.3, 3.0) and looser ones like (0.05, 10.0) both.
MIN_SHRINKAGE_RATIO = 0.1
MAX_SHRINKAGE_RATIO = 8.0
REFERENCE_VARIANCE = (2 * GOAL_CAP) ** 2 / 12

# Top to bottom. Mirrors src/lib/grouping.ts's LEVEL_ORDER -- keep both in
# sync if this list changes.
DIVISION_HIERARCHY = ["AA", "A", "BB", "B"]

# Pseudo-observation weight for the tier-gap prior when blending it with
# real cross-division evidence (see compute_tier_offsets). ~5 independent
# bridge-game observations are needed to meaningfully override the prior;
# one or two noisy games barely move it.
W_PRIOR = 5.0

# The prior itself: pooled average trimmed (2nd-best/2nd-worst) gap from a
# full completed season (season 31, Fall 2025 -- scripts/historical_tier_gap.py),
# pooled across age groups sharing the same tier-pair pattern. Deliberately
# NOT derived from this season's own preseason extremes: even trimmed, a
# 3-game sample is too volatile to anchor a cross-division scale -- verified
# directly (10U's B's top two teams both legitimately extreme after the
# variance-aware shrinkage fix pushed the "2nd-best of B" prior anchor to
# 11.85, versus 3.5-7 from a full historical season using the same
# algorithm). A full season smooths out exactly the kind of individual
# extreme results that make a 3-game sample untrustworthy as a calibration
# anchor, even though those same extremes are legitimate signal for the
# *within-division* rating of the specific team that earned them.
#
# Only pairs with a real, reasonably-trustworthy historical sample get an
# entry here. For everything else (AA/A had only 1 historical sample -- too
# noisy to trust -- and any pair with no historical season to draw from at
# all, e.g. a not-yet-existing B East/B West split), fall back to
# DEFAULT_TIER_GAP below rather than a shaky number.
HISTORICAL_TIER_GAP: dict[tuple[str, str], float] = {
    ("A", "BB"): 6.09,
    ("BB", "B"): 5.65,
}

# Flat default gap for any adjacent tier pair with no trustworthy historical
# calibration. Simpler than deriving one from this season's own noisy
# few-games-per-team extremes (which is what this replaced -- see
# compute_tier_offsets), and just as sound as a starting assumption: real
# cross-division evidence still overrides it in proportion to how much
# exists, the same way it overrides a calibrated historical value.
DEFAULT_TIER_GAP = 7.0

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


def _assign_tiers(ratings_desc: list[float]) -> list[str]:
    """top/mid/low based on the two largest natural gaps in the sorted
    ratings, not a fixed exact-rank-thirds split. A team just past an
    arbitrary rank cutoff but barely different in rating from the tier
    above it (e.g. a tightly-clustered mid-pack) shouldn't be labeled a
    full tier lower than a team it's rated almost identically to."""
    n = len(ratings_desc)
    if n <= 2:
        return ["mid"] * n
    gaps = [(ratings_desc[i] - ratings_desc[i + 1], i) for i in range(n - 1)]
    cut_after = sorted(i for _, i in sorted(gaps, key=lambda g: -g[0])[:2])
    tier_names = ["top", "mid", "low"]
    tiers = []
    tier_idx = 0
    for i in range(n):
        tiers.append(tier_names[tier_idx])
        if cut_after and i == cut_after[0]:
            tier_idx += 1
            cut_after.pop(0)
    return tiers


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
            implied = [rating[opp] + margin for opp, margin in opp_games]
            if n >= 2:
                ratio = statistics.pvariance(implied) / REFERENCE_VARIANCE
                ratio = max(MIN_SHRINKAGE_RATIO, min(MAX_SHRINKAGE_RATIO, ratio))
                k_t = k * ratio
            else:
                # Can't estimate consistency from a single game -- no adjustment.
                k_t = k
            new_rating[t] = sum(implied) / (n + k_t)
            max_delta = max(max_delta, abs(new_rating[t] - rating[t]))
        rating = new_rating
        if max_delta < CONVERGENCE_EPS:
            break

    mean = sum(rating.values()) / len(rating)
    centered = {t: v - mean for t, v in rating.items()}

    ordered = sorted(teams, key=lambda t: -centered[t])
    tiers = _assign_tiers([centered[t] for t in ordered])
    results: list[TeamRating] = []
    for i, t in enumerate(ordered):
        rank = i + 1
        tier = tiers[i]
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


def compute_unified_ratings(
    within_ratings_by_tier: dict[str, list[TeamRating]],
    offsets: dict[str, dict],
    k: float = SHRINKAGE_K,
) -> dict[str, dict]:
    """Final, single cross-division-comparable rating per team.

    A cross-tested team's rating in a *secondary* tier (any tier that isn't
    the one it has the most games in) is, by construction, shrunk toward
    that tier's own zero mean -- the right call for a team we genuinely
    know nothing about, but wrong once the team already has an established
    rating from its primary tier. Naively averaging the two tiers' raw
    ratings (weighted just by games played) then silently discounts a
    team's known strength every time its tier split is uneven. Confirmed on
    real data: Tri Valley Blue Devils 10-1 (3 A games, rating -2.298; 1 BB
    tie, rating 1.197 -- barely above zero despite a competitive tie
    against a real BB team) unified *below* a team it's clearly stronger
    than, purely because that one low-sample BB reading dragged the average
    down toward BB's zero mean instead of toward what its 3 A games already
    established.

    Fix: before blending, re-express each secondary-tier rating as if it
    had been computed with a prior mean of "the primary-tier estimate,
    translated onto that secondary tier's own local scale" instead of the
    default prior of 0 -- reconstructed algebraically from the
    already-computed rating rather than re-solving the whole division
    (a team's raw rating is `sum(implied)/(n+k)`, so injecting a prior mean
    p instead of 0 gives `(sum(implied)+k*p)/(n+k) = rating + k*p/(n+k)`).
    Exact when the secondary tier has <2 games (shrinkage there is just the
    base k, since variance can't be estimated from a single game); a
    reasonable approximation otherwise.
    """
    primary_tier = compute_primary_tiers(within_ratings_by_tier)
    entries_by_team: dict[str, list[tuple[TeamRating, str]]] = {}
    for tier, rows in within_ratings_by_tier.items():
        if tier not in offsets:
            continue
        for r in rows:
            entries_by_team.setdefault(r.name, []).append((r, tier))

    teams: dict[str, dict] = {}
    for name, entries in entries_by_team.items():
        p_tier = primary_tier[name]
        primary_row = next(r for r, tier in entries if tier == p_tier)
        primary_estimate = primary_row.rating + offsets[p_tier]["offset"]

        weighted_sum = 0.0
        total_games = 0
        for r, tier in entries:
            if tier == p_tier:
                estimate = r.rating + offsets[tier]["offset"]
            else:
                prior_local = primary_estimate - offsets[tier]["offset"]
                corrected_local = r.rating + k * prior_local / (r.games_played + k)
                estimate = corrected_local + offsets[tier]["offset"]
            weighted_sum += estimate * r.games_played
            total_games += r.games_played

        teams[name] = {"rating": round(weighted_sum / total_games, 3), "gamesPlayed": total_games}
    return teams


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
        historical_gap = HISTORICAL_TIER_GAP.get((higher, lower))
        if historical_gap is not None:
            prior_gap = historical_gap
            prior_anchor = {"source": "historical", "gap": round(prior_gap, 3)}
        else:
            # No trustworthy historical reference for this tier pair (too
            # few historical samples, or the pair doesn't exist in any past
            # season at all -- e.g. a brand-new B East/B West split) -- fall
            # back to the flat default rather than deriving one from this
            # season's own noisy few-games-per-team extremes (tried
            # earlier, and fragile: 10U's own "2nd-best of B" anchor once
            # hit 11.85 in-season versus 3.5-7 from a full historical
            # season using the same algorithm).
            prior_gap = DEFAULT_TIER_GAP
            prior_anchor = {"source": "default", "gap": round(prior_gap, 3)}
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
