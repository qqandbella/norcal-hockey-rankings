from scrape import build_team_links, compute_age_group_ratings


def _game(home, away, home_goals, away_goals, game_id, played=True):
    return {
        "gameId": game_id,
        "date": "01/01/26",
        "day": "Thu",
        "time": "5:00 PM",
        "rink": "Rink",
        "type": "Preseason",
        "away": away,
        "home": home,
        "awayGoals": away_goals if played else None,
        "homeGoals": home_goals if played else None,
        "played": played,
        "ageLabel": "10U",
        "levelLabel": "B",
    }


def _division(age_label, level_label, games):
    return {"levelId": 1, "ageLabel": age_label, "levelLabel": level_label, "games": games}


def test_build_team_links_matches_known_team():
    team_ids = {"Cupertino Cougars 10-2": {"teamId": "130", "season": "33"}}
    links = build_team_links({"Cupertino Cougars 10-2", "Some Other Team"}, team_ids)
    assert links == {
        "Cupertino Cougars 10-2": (
            "https://stats.caha.timetoscore.com/display-schedule"
            "?team=130&season=33&league=3&stat_class=1"
        )
    }


def test_build_team_links_skips_unresolved_teams():
    links = build_team_links({"Unknown Team"}, {})
    assert links == {}


def test_age_group_ratings_pool_divisions_with_a_bridge():
    division_b = _division(
        "10U", "B",
        [_game("B1", "B2", 5, 2, "g1"), _game("B2", "B3", 3, 1, "g2")],
    )
    division_bb = _division(
        "10U", "BB",
        [_game("BB1", "BB2", 4, 1, "g3")],
    )
    # Cross-division bridge, filed under BB, matching the real-world case
    # (a B team's test game filed under the BB division).
    bridge = _division("10U", "BB", [_game("BB1", "B1", 6, 3, "g4")])

    age_groups = compute_age_group_ratings([division_b, division_bb, bridge])
    teams = age_groups["10U"]["teams"]

    assert set(teams) == {"B1", "B2", "B3", "BB1", "BB2"}
    # Every team is now bridged into one component via B1<->BB1.
    assert len({t["componentId"] for t in teams.values()}) == 1
    # Unified rating is centered across the whole pooled graph, not per-division.
    assert abs(sum(t["rating"] for t in teams.values())) < 1e-2


def test_age_group_ratings_unplayed_games_dont_count_as_bridges():
    division_b = _division("10U", "B", [_game("B1", "B2", 5, 2, "g1")])
    division_bb = _division("10U", "BB", [_game("BB1", "BB2", 4, 1, "g2")])
    scheduled_bridge = _division("10U", "BB", [_game("BB1", "B1", 0, 0, "g3", played=False)])

    age_groups = compute_age_group_ratings([division_b, division_bb, scheduled_bridge])
    teams = age_groups["10U"]["teams"]

    assert teams["B1"]["componentId"] != teams["BB1"]["componentId"]


def test_age_group_ratings_deduplicates_shared_game_ids():
    # Same gameId appearing in two divisions' games lists (shouldn't happen
    # in practice, but be defensive) must only count once.
    game = _game("A", "B", 5, 2, "dup1")
    division_1 = _division("10U", "B", [game])
    division_2 = _division("10U", "B", [game])

    age_groups = compute_age_group_ratings([division_1, division_2])
    assert age_groups["10U"]["teams"]["A"]["gamesPlayed"] == 1
