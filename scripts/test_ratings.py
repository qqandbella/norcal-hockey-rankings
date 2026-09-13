from ratings import (
    Game,
    GOAL_CAP,
    TeamRating,
    W_PRIOR,
    _assign_tiers,
    SHRINKAGE_K,
    compute_ratings,
    compute_team_stats,
    compute_tier_offsets,
    compute_unified_ratings,
)

# Real 10U B preseason results (Labor Day weekend 2026), used as a regression
# fixture. Home/away order matches how they were originally recorded; only
# the goal differential matters to the rating.
TEN_U_B_GAMES = [
    Game("Stockton Colts 10-1", "San Jose Jr Sharks Girls 10G-1", 12, 1),
    Game("Oakland Bears 10-2", "Tri Valley Blue Devils 10-3", 5, 3),
    Game("San Jose Jr Sharks 10-6", "Stockton Colts Girls 10G-1", 11, 1),
    Game("Santa Clara Blackhawks 10-2", "San Francisco Sabercats 10-2", 11, 1),
    Game("Santa Rosa Flyers 10-2", "Vacaville Jets 10-2", 12, 8),
    Game("Tri Valley Lady Blue Devils 10G-1", "San Jose Jr Sharks 10-5", 5, 0),
    Game("Stockton Colts 10-1", "San Mateo Black Stars 10-3", 13, 0),
    Game("Capital Thunder 10-2", "Vacaville Jets 10-2", 11, 4),
    Game("Fresno Jr Monsters 10-1", "Santa Clara Blackhawks 10-2", 8, 1),
    Game("San Jose Jr Sharks 10-6", "Lake Tahoe Grizzlies 10-2", 7, 4),
    Game("Stockton Colts Girls 10G-1", "Fresno Jr Monsters Girls 10G-1", 13, 3),
    Game("Tri Valley Blue Devils 10-3", "San Francisco Sabercats 10-2", 3, 2),
    Game("San Jose Jr Sharks 10-5", "Capital Thunder 10-2", 7, 2),
    Game("Lake Tahoe Grizzlies 10-2", "San Mateo Black Stars 10-3", 14, 0),
    Game("Tri Valley Lady Blue Devils 10G-1", "Oakland Bears 10-2", 12, 0),
    Game("San Jose Jr Sharks Girls 10G-1", "Fresno Jr Monsters Girls 10G-1", 11, 1),
    Game("Fresno Jr Monsters 10-1", "Santa Rosa Flyers 10-2", 11, 2),
    Game("Stockton Colts 10-1", "Oakland Bears 10-2", 14, 3),
    Game("San Francisco Sabercats 10-2", "Stockton Colts Girls 10G-1", 9, 4),
    Game("Santa Clara Blackhawks 10-2", "Tri Valley Blue Devils 10-3", 9, 3),
    Game("San Jose Jr Sharks 10-5", "Vacaville Jets 10-2", 12, 1),
    Game("San Jose Jr Sharks 10-6", "Santa Rosa Flyers 10-2", 7, 1),
    Game("Tri Valley Lady Blue Devils 10G-1", "Capital Thunder 10-2", 7, 0),
    Game("Fresno Jr Monsters 10-1", "Lake Tahoe Grizzlies 10-2", 13, 0),
    Game("Fresno Jr Monsters Girls 10G-1", "San Mateo Black Stars 10-3", 5, 3),
    Game("San Mateo Black Stars 10-3", "San Jose Jr Sharks Girls 10G-1", 9, 0),
]


def ratings_by_name(games):
    return {r.name: r for r in compute_ratings(games)}


def test_fresno_tops_10u_b():
    by_name = ratings_by_name(TEN_U_B_GAMES)
    ranked = sorted(by_name.values(), key=lambda r: r.rank)
    assert ranked[0].name == "Fresno Jr Monsters 10-1"
    assert ranked[0].tier == "top"


def test_vacaville_bottoms_10u_b():
    by_name = ratings_by_name(TEN_U_B_GAMES)
    ranked = sorted(by_name.values(), key=lambda r: r.rank)
    assert ranked[-1].name == "Vacaville Jets 10-2"
    assert ranked[-1].tier == "low"


def test_ratings_centered_at_zero():
    # Centered before rounding to 3 decimals for display, so the displayed
    # mean can drift by up to ~half a rounding unit per team.
    ratings = compute_ratings(TEN_U_B_GAMES)
    mean = sum(r.rating for r in ratings) / len(ratings)
    assert abs(mean) < 1e-3


def test_goal_diff_capped_beyond_cap():
    # A 20-0 win should rate a team no higher than a (cap)-0 win against the
    # same opponent, since anything past GOAL_CAP carries no extra signal.
    capped = compute_ratings([Game("A", "B", GOAL_CAP, 0)])
    blowout = compute_ratings([Game("A", "B", 20, 0)])
    a_capped = next(r for r in capped if r.name == "A").rating
    a_blowout = next(r for r in blowout if r.name == "A").rating
    assert a_capped == a_blowout


def test_isolated_low_sample_team_shrinks_toward_mean():
    # A team with a single blowout win should NOT rate as if the full 7-goal
    # margin were its true strength -- shrinkage pulls it toward 0.
    ratings = {r.name: r.rating for r in compute_ratings([Game("A", "B", 7, 0)])}
    assert 0 < ratings["A"] < GOAL_CAP / 2
    assert -GOAL_CAP / 2 < ratings["B"] < 0


def test_games_played_counted_correctly():
    by_name = ratings_by_name(TEN_U_B_GAMES)
    assert by_name["Fresno Jr Monsters 10-1"].games_played == 3
    assert by_name["Stockton Colts 10-1"].games_played == 3


def test_team_stats_win_loss_tie_and_points():
    stats = compute_team_stats(TEN_U_B_GAMES)
    fresno = stats["Fresno Jr Monsters 10-1"]
    # 3 wins, 0 losses, 0 ties: 8-1, 11-2, 13-0.
    assert (fresno.wins, fresno.losses, fresno.ties) == (3, 0, 0)
    assert fresno.points == 6
    assert fresno.goals_for == 32
    assert fresno.goals_against == 3
    assert fresno.goal_diff == 29


def test_team_stats_tie_splits_points():
    stats = compute_team_stats([Game("A", "B", 3, 3)])
    assert stats["A"].ties == stats["B"].ties == 1
    assert stats["A"].points == stats["B"].points == 1
    assert stats["A"].wins == stats["A"].losses == 0


def test_team_stats_uncapped_unlike_rating():
    # Unlike the rating model, official stats use the real goal differential,
    # not the +/-7 capped version.
    stats = compute_team_stats([Game("A", "B", 20, 0)])
    assert stats["A"].goal_diff == 20


def _b_bb_setup():
    """A + B (native only, no bridges) division, ratings picked so the
    prior gap (B's top vs BB's bottom) is a clean, known number."""
    b_ratings = [
        TeamRating("B_top", rating=5.0, games_played=3),
        TeamRating("B_mid", rating=0.0, games_played=3),
        TeamRating("B_bottom", rating=-5.0, games_played=3),
    ]
    bb_ratings = [
        TeamRating("BB_top", rating=6.0, games_played=3),
        TeamRating("BB_bottom", rating=-4.0, games_played=3),
    ]
    return {"B": b_ratings, "BB": bb_ratings}


def test_tier_offsets_uses_historical_prior_by_default():
    within = _b_bb_setup()
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert offsets["B"]["offset"] == 0.0
    assert offsets["B"]["evidenceCount"] == 0
    # Historical, not this-season-derived: HISTORICAL_TIER_GAP[("BB","B")].
    from ratings import HISTORICAL_TIER_GAP

    expected_gap = HISTORICAL_TIER_GAP[("BB", "B")]
    assert offsets["BB"]["offset"] == expected_gap
    assert offsets["BB"]["evidenceCount"] == 0
    assert offsets["BB"]["bridgeGames"] == []
    assert offsets["BB"]["priorAnchor"] == {"source": "historical", "gap": expected_gap}


def test_tier_offsets_falls_back_to_flat_default_when_no_historical_data(monkeypatch):
    import ratings

    monkeypatch.setattr(ratings, "HISTORICAL_TIER_GAP", {})
    within = _b_bb_setup()
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert offsets["BB"]["offset"] == ratings.DEFAULT_TIER_GAP
    assert offsets["BB"]["priorAnchor"] == {"source": "default", "gap": ratings.DEFAULT_TIER_GAP}


def test_tier_offsets_one_bridge_game_nudges_toward_its_implied_gap():
    from ratings import HISTORICAL_TIER_GAP

    within = _b_bb_setup()
    # B_top (native B, rating 5.0 there) plays one game filed under BB,
    # against BB_bottom (native BB, rating -4.0) -- B_top loses by 2. B_top
    # is "cross-tested": it has no separate BB-side rating, so its own
    # established B rating is what translates it into this BB game.
    bridge_games = [("BB_bottom", "B_top", 2, "BB")]  # home=BB_bottom, away=B_top, margin=home-away=2

    offsets = compute_tier_offsets(within, bridge_games)
    prior_gap = HISTORICAL_TIER_GAP[("BB", "B")]
    # unified(B_top) - unified(BB_bottom) = -margin = -2
    # (5.0 + offset[B]) - (-4.0 + offset[BB]) = -2  =>  offset[BB]-offset[B] = 2 + 5.0 + 4.0 = 11.0
    implied_gap = 11.0
    expected = (W_PRIOR * prior_gap + implied_gap) / (W_PRIOR + 1)
    assert offsets["BB"]["offset"] == round(expected, 3)
    assert offsets["BB"]["evidenceCount"] == 1
    # A single noisy bridge shouldn't swing the offset anywhere near its own
    # raw implied value -- it should still sit much closer to the prior.
    assert abs(offsets["BB"]["offset"] - prior_gap) < abs(offsets["BB"]["offset"] - implied_gap)
    # The evidence itself is explainable: which teams, which gap.
    assert offsets["BB"]["bridgeGames"] == [
        {
            "homeTeam": "BB_bottom",
            "homeTier": "BB",
            "awayTeam": "B_top",
            "awayTier": "B",
            "margin": 2,
            "impliedGap": 11.0,
        }
    ]


def test_tier_offsets_repeated_bridge_games_from_same_team_each_count():
    within = _b_bb_setup()
    # Same cross-tested team (B_top, whose primary tier stays B -- it has no
    # separate BB appearances of its own), three separate BB games against
    # different native BB opponents -- matches the real San Mateo Black
    # Stars 10-2 case (one team, three bridge games).
    bridge_games = [
        ("BB_bottom", "B_top", 2, "BB"),
        ("B_top", "BB_top", -3, "BB"),
        ("BB_bottom", "B_top", 1, "BB"),
    ]
    offsets = compute_tier_offsets(within, bridge_games)
    assert offsets["BB"]["evidenceCount"] == 3


def test_tier_offsets_ordinary_game_between_two_native_teams_is_not_evidence():
    within = _b_bb_setup()
    # Neither team is cross-tested -- an everyday within-BB game.
    bridge_games = [("BB_top", "BB_bottom", 5, "BB")]
    offsets = compute_tier_offsets(within, bridge_games)
    assert offsets["BB"]["evidenceCount"] == 0


def test_tier_offsets_chain_three_tiers(monkeypatch):
    import ratings

    monkeypatch.setattr(ratings, "HISTORICAL_TIER_GAP", {})  # isolate the chaining logic itself
    within = {
        "A": [TeamRating("A_top", rating=3.0, games_played=3), TeamRating("A_bottom", rating=-3.0, games_played=3)],
        "BB": [TeamRating("BB_top", rating=2.0, games_played=3), TeamRating("BB_bottom", rating=-2.0, games_played=3)],
        "B": [TeamRating("B_top", rating=1.0, games_played=3), TeamRating("B_bottom", rating=-1.0, games_played=3)],
    }
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert offsets["B"]["offset"] == 0.0
    # No historical data for either pair -> both fall back to the flat default.
    assert offsets["BB"]["offset"] == ratings.DEFAULT_TIER_GAP
    assert offsets["A"]["offset"] == 2 * ratings.DEFAULT_TIER_GAP


def test_tier_offsets_missing_tier_handled_gracefully():
    within = {"B": _b_bb_setup()["B"], "AA": []}
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert "AA" not in offsets
    assert offsets["B"]["offset"] == 0.0


def test_assign_tiers_keeps_a_tight_cluster_together_across_a_rank_boundary():
    # 9 teams: exact-rank-thirds would cut top=1-3/mid=4-6/low=7-9, splitting
    # the tightly-clustered 6th (0.1) and 7th (0.0) place teams into
    # different tiers despite a near-zero gap between them, while the real,
    # large gaps sit elsewhere (index 2->3 and index 7->8). This is exactly
    # the "Jets1" case: a team just past an arbitrary rank cutoff shouldn't
    # be labeled a full tier below a team it's rated almost identically to.
    ratings_desc = [10, 9, 8, 2, 1, 0.1, 0.0, -0.1, -10]
    tiers = _assign_tiers(ratings_desc)
    assert tiers == ["top", "top", "top", "mid", "mid", "mid", "mid", "mid", "low"]


def test_assign_tiers_too_few_teams_falls_back_to_mid():
    assert _assign_tiers([5.0, -5.0]) == ["mid", "mid"]
    assert _assign_tiers([1.0]) == ["mid"]
    assert _assign_tiers([]) == []


def test_variance_aware_shrinkage_trusts_consistent_records_more():
    # C beats three different (otherwise-neutral, single-game) opponents by
    # the same margin each time -- a consistent, low-variance profile.
    consistent_games = [
        Game("C", "O1", 6, 0),
        Game("C", "O2", 6, 0),
        Game("C", "O3", 6, 0),
    ]
    # S has a similar overall win record but a scattered, high-variance
    # profile: one big win, one narrow loss, one big win.
    scattered_games = [
        Game("S", "O4", 7, 0),
        Game("O5", "S", 1, 0),  # S loses by 1
        Game("S", "O6", 7, 0),
    ]
    consistent = {r.name: r.rating for r in compute_ratings(consistent_games)}
    scattered = {r.name: r.rating for r in compute_ratings(scattered_games)}
    # Consistency earns C less shrinkage -- a more confident (larger
    # magnitude) rating than S's scattered record, even though S's raw
    # average margin is comparable or better.
    assert abs(consistent["C"]) > abs(scattered["S"])


def test_variance_aware_shrinkage_bounded_by_min_max_ratio():
    # A single-game team can't have its consistency measured at all --
    # confirm it falls back to the unadjusted base shrinkage rather than
    # blowing up from a degenerate (zero-sample) variance estimate.
    single_game = compute_ratings([Game("X", "Y", 7, 0)])
    x = next(r for r in single_game if r.name == "X")
    # Fixed point of the mutual 2-team iteration (X and Y only reference
    # each other): rating[X] = (-rating[X] + 7) / (1 + SHRINKAGE_K), solved
    # for rating[X] -- the plain (non-adaptive) shrinkage formula, since a
    # single game gives no basis to estimate consistency.
    from ratings import SHRINKAGE_K

    expected = round(7 / (2 + SHRINKAGE_K), 3)
    assert x.rating == expected


def test_unified_ratings_cross_tested_team_secondary_tier_uses_primary_as_prior():
    # Real-data regression: a team playing mostly in a higher tier (A) with
    # just one game in a lower tier (BB) shouldn't have that one low-sample
    # BB reading (shrunk toward BB's own zero mean) drag its unified rating
    # down below a team it's clearly at least as strong as -- confirmed
    # directly for Tri Valley Blue Devils 10-1 (3 A games) vs Santa Rosa
    # Flyers 10-1 (BB native) after a BB-BB-tie test game.
    within = {
        "A": [
            TeamRating("TVBD1", rating=-2.298, games_played=3),
            TeamRating("A2", rating=2.298, games_played=3),
        ],
        "BB": [
            # TVBD1 tied Flyers1 in its one BB appearance -- barely above
            # zero once shrunk toward BB's own mean with only 1 game.
            TeamRating("Flyers1", rating=3.351, games_played=4),
            TeamRating("TVBD1", rating=1.197, games_played=1),
        ],
    }
    offsets = {
        "BB": {"offset": 0.0},
        "A": {"offset": 12.802},
    }
    teams = compute_unified_ratings(within, offsets)
    # TVBD1 should land at or above Flyers1, not below it.
    assert teams["TVBD1"]["rating"] >= teams["Flyers1"]["rating"]
    assert teams["TVBD1"]["gamesPlayed"] == 4


def test_unified_ratings_single_tier_team_unaffected():
    within = {
        "B": [TeamRating("B1", rating=5.0, games_played=3), TeamRating("B2", rating=-5.0, games_played=3)],
    }
    offsets = {"B": {"offset": 0.0}}
    teams = compute_unified_ratings(within, offsets)
    assert teams["B1"]["rating"] == 5.0
    assert teams["B2"]["rating"] == -5.0


def test_unified_ratings_secondary_tier_correction_matches_hand_derivation():
    # Exact algebraic check for the n<2 case: corrected = rating + k*prior/(n+k).
    within = {
        "A": [TeamRating("X", rating=0.0, games_played=3)],
        "BB": [TeamRating("X", rating=1.0, games_played=1), TeamRating("Y", rating=-1.0, games_played=3)],
    }
    offsets = {"BB": {"offset": 0.0}, "A": {"offset": 10.0}}
    teams = compute_unified_ratings(within, offsets)
    primary_estimate = 0.0 + 10.0  # X's A rating + A offset
    prior_local = primary_estimate - 0.0  # translated onto BB's local scale
    corrected_local = 1.0 + SHRINKAGE_K * prior_local / (1 + SHRINKAGE_K)
    expected_bb_estimate = corrected_local + 0.0
    expected_unified = (3 * primary_estimate + 1 * expected_bb_estimate) / 4
    assert teams["X"]["rating"] == round(expected_unified, 3)
