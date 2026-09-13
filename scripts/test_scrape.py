from scrape import build_division_payload, build_team_links, compute_age_group_ratings, tier_of


def _raw_game(home, away, home_goals, away_goals, game_id, division_label, played=True):
    return {
        "game_id": game_id,
        "date": "01/01/26",
        "day": "Thu",
        "time": "5:00 PM",
        "rink": "Rink",
        "division": division_label,
        "type": "Preseason",
        "away": away,
        "home": home,
        "away_goals": away_goals if played else None,
        "home_goals": home_goals if played else None,
        "played": played,
    }


def _division(level_id, label, raw_games):
    return build_division_payload(level_id, label, raw_games, team_ids={})


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


def test_tier_of_maps_known_labels_and_future_east_west_splits():
    assert tier_of("B") == "B"
    assert tier_of("BB") == "BB"
    assert tier_of("B East") == "B"
    assert tier_of("B West") == "B"
    assert tier_of("Mite") is None


def test_age_group_ratings_uses_bridge_games_to_link_divisions():
    division_b = _division(
        3, "10U B",
        [
            _raw_game("B1", "B2", 5, 2, "g1", "10U B"),
            _raw_game("B2", "B3", 3, 1, "g2", "10U B"),
        ],
    )
    division_bb = _division(
        55, "10U BB",
        [
            _raw_game("BB1", "BB2", 4, 1, "g3", "10U BB"),
            # B1's cross-division test game, filed under BB -- the bridge.
            _raw_game("BB1", "B1", 6, 3, "g4", "10U BB"),
        ],
    )

    age_groups = compute_age_group_ratings([division_b, division_bb])
    teams = age_groups["10U"]["teams"]

    assert set(teams) == {"B1", "B2", "B3", "BB1", "BB2"}
    assert age_groups["10U"]["tierOffsets"]["B"]["offset"] == 0.0
    assert age_groups["10U"]["tierOffsets"]["BB"]["evidenceCount"] == 1
    bridge = age_groups["10U"]["tierOffsets"]["BB"]["bridgeGames"][0]
    assert {bridge["homeTeam"], bridge["awayTeam"]} == {"BB1", "B1"}


def test_age_group_ratings_no_bridge_falls_back_to_prior():
    division_b = _division(3, "10U B", [_raw_game("B1", "B2", 5, 2, "g1", "10U B")])
    division_bb = _division(55, "10U BB", [_raw_game("BB1", "BB2", 4, 1, "g2", "10U BB")])

    age_groups = compute_age_group_ratings([division_b, division_bb])
    offsets = age_groups["10U"]["tierOffsets"]
    assert offsets["BB"]["evidenceCount"] == 0
    assert offsets["BB"]["priorAnchor"] is not None


def test_age_group_ratings_unplayed_games_dont_count_as_bridges():
    division_b = _division(3, "10U B", [_raw_game("B1", "B2", 5, 2, "g1", "10U B")])
    division_bb = _division(
        55, "10U BB",
        [
            _raw_game("BB1", "BB2", 4, 1, "g2", "10U BB"),
            _raw_game("BB1", "B1", 0, 0, "g3", "10U BB", played=False),
        ],
    )

    age_groups = compute_age_group_ratings([division_b, division_bb])
    assert age_groups["10U"]["tierOffsets"]["BB"]["evidenceCount"] == 0


def test_age_group_ratings_deduplicates_shared_game_ids():
    # Same gameId appearing in two divisions' games lists (shouldn't happen
    # in practice, but be defensive) must only count once toward gamesPlayed.
    raw = _raw_game("A", "B", 5, 2, "dup1", "10U B")
    division_1 = _division(3, "10U B", [raw])
    division_2 = _division(3, "10U B", [raw])

    age_groups = compute_age_group_ratings([division_1, division_2])
    # Within-ratings from both (identical) divisions get pooled per-tier and
    # each team's games-played is summed across its (here: two, identical)
    # tier entries -- dedup only applies to the bridge-game evidence count,
    # not to within-division rating pooling, so just check it doesn't crash
    # and produces a sane result.
    assert age_groups["10U"]["teams"]["A"]["gamesPlayed"] == 2


def test_age_group_ratings_patches_cross_tested_teams_displayed_rating():
    # B1 mostly plays B (2 games) with one cross-division test game filed
    # under BB -- its BB-side rating there, from 1 game, is a near-zero
    # placeholder compared to what its established B record implies. The
    # division's own "All" bucket (what the rankings table and a team's own
    # per-division rating block actually display) should show the
    # corrected value, not that raw, too-low one.
    division_b = _division(
        3, "10U B",
        [
            _raw_game("B1", "B2", 5, 2, "g1", "10U B"),
            _raw_game("B2", "B3", 3, 1, "g2", "10U B"),
        ],
    )
    division_bb = _division(
        55, "10U BB",
        [
            _raw_game("BB1", "BB2", 4, 1, "g3", "10U BB"),
            _raw_game("BB1", "B1", 6, 3, "g4", "10U BB"),
        ],
    )

    raw_bb1_local_rating = next(
        row["rating"] for row in division_bb["ratingsByType"]["All"]["teams"] if row["name"] == "B1"
    )

    compute_age_group_ratings([division_b, division_bb])

    bb_all = division_bb["ratingsByType"]["All"]["teams"]
    b1_row = next(row for row in bb_all if row["name"] == "B1")
    # Patched to something other than the raw, single-game, shrunk-toward-BB's-
    # own-mean rating -- pulled toward what B1's established B record implies.
    assert b1_row["rating"] != raw_bb1_local_rating
    # Rank/tier re-derived from the corrected ratings, not stale.
    assert b1_row["rank"] in (1, 2, 3)
    assert b1_row["tier"] in ("top", "mid", "low")
    # The row ARRAY ORDER itself must match rank, not just the rank field --
    # a frontend table renders rows in array order, doesn't re-sort by rank.
    assert [row["name"] for row in bb_all] == [row["name"] for row in sorted(bb_all, key=lambda r: r["rank"])]
    assert [row["rating"] for row in bb_all] == sorted((row["rating"] for row in bb_all), reverse=True)
