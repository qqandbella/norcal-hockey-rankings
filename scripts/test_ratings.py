from ratings import Game, GOAL_CAP, compute_ratings, compute_team_stats

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
