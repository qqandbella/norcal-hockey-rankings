from ratings import Game, GOAL_CAP, TeamRating, W_PRIOR, compute_ratings, compute_team_stats, compute_tier_offsets

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


def test_tier_offsets_prior_only_when_no_bridge_evidence():
    within = _b_bb_setup()
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert offsets["B"]["offset"] == 0.0
    assert offsets["B"]["evidenceCount"] == 0
    # B has 3 teams (>=3, trimmed): 2nd-best = B_mid (0.0), not B_top (5.0).
    # BB only has 2 teams (<3, falls back to the plain extreme): BB_bottom (-4.0).
    # prior_gap = 0.0 - (-4.0) = 4.0
    assert offsets["BB"]["offset"] == 4.0
    assert offsets["BB"]["evidenceCount"] == 0
    assert offsets["BB"]["bridgeGames"] == []
    # The prior anchor names exactly which two teams justify the default gap.
    assert offsets["BB"]["priorAnchor"] == {
        "lowTeam": "B_mid",
        "lowRating": 0.0,
        "highTeam": "BB_bottom",
        "highRating": -4.0,
        "gap": 4.0,
    }


def test_tier_offsets_trimming_needs_at_least_three_teams_per_side():
    # With exactly 2 teams, "trimming one" just leaves the *other* extreme
    # (flipping the gap's sign), which is worse than not trimming at all --
    # confirm the 2-team fallback still uses the plain extreme, not that.
    within = {
        "B": [TeamRating("B1", rating=5.0, games_played=3), TeamRating("B2", rating=-5.0, games_played=3)],
        "BB": [TeamRating("BB1", rating=6.0, games_played=3), TeamRating("BB2", rating=-4.0, games_played=3)],
    }
    offsets = compute_tier_offsets(within, bridge_games=[])
    # Both sides have only 2 teams -> both fall back to plain extremes,
    # identical to the pre-trimming formula: max(B) - min(BB) = 5.0 - (-4.0).
    assert offsets["BB"]["offset"] == 9.0


def test_tier_offsets_one_bridge_game_nudges_toward_its_implied_gap():
    within = _b_bb_setup()
    # B_top (native B, rating 5.0 there) plays one game filed under BB,
    # against BB_bottom (native BB, rating -4.0) -- B_top loses by 2. B_top
    # is "cross-tested": it has no separate BB-side rating, so its own
    # established B rating is what translates it into this BB game.
    bridge_games = [("BB_bottom", "B_top", 2, "BB")]  # home=BB_bottom, away=B_top, margin=home-away=2

    offsets = compute_tier_offsets(within, bridge_games)
    prior_gap = 4.0  # see test_tier_offsets_prior_only_when_no_bridge_evidence
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


def test_tier_offsets_chain_three_tiers():
    within = {
        "A": [TeamRating("A_top", rating=3.0, games_played=3), TeamRating("A_bottom", rating=-3.0, games_played=3)],
        "BB": [TeamRating("BB_top", rating=2.0, games_played=3), TeamRating("BB_bottom", rating=-2.0, games_played=3)],
        "B": [TeamRating("B_top", rating=1.0, games_played=3), TeamRating("B_bottom", rating=-1.0, games_played=3)],
    }
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert offsets["B"]["offset"] == 0.0
    # gap(BB,B) = B's top (1.0) - BB's bottom (-2.0) = 3.0
    assert offsets["BB"]["offset"] == 3.0
    # gap(A,BB) = BB's top (2.0) - A's bottom (-3.0) = 5.0, chained onto offset[BB]
    assert offsets["A"]["offset"] == 8.0


def test_tier_offsets_missing_tier_handled_gracefully():
    within = {"B": _b_bb_setup()["B"], "AA": []}
    offsets = compute_tier_offsets(within, bridge_games=[])
    assert "AA" not in offsets
    assert offsets["B"]["offset"] == 0.0
