from build_team_ids import collapse_by_name, compute_renames
from scrape import (
    apply_team_aliases,
    build_division_payload,
    build_team_links,
    compute_age_group_ratings,
    merge_raw_games_into_label,
    split_physical_division_by_declared_subdivisions,
    tier_of,
)


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


def test_tier_of_maps_known_labels_including_east_west_as_their_own_tiers():
    assert tier_of("B") == "B"
    assert tier_of("BB") == "BB"
    # Real, separate tiers (East strictly above West) -- not aliases of "B".
    assert tier_of("B East") == "B East"
    assert tier_of("B West") == "B West"
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
    # Same gameId appearing in two divisions' games lists -- exactly what
    # happens for a real physically-split division (see
    # split_physical_division_by_declared_subdivisions: "B East" and
    # "B West" payloads both redundantly compute a rating for the whole
    # shared preseason game pool). A team's within-rating must only be
    # counted once, not once per division object it happens to have a
    # (redundant, identical) row in.
    raw = _raw_game("A", "B", 5, 2, "dup1", "10U B")
    division_1 = _division(3, "10U B", [raw])
    division_2 = _division(3, "10U B", [raw])

    age_groups = compute_age_group_ratings([division_1, division_2])
    assert age_groups["10U"]["teams"]["A"]["gamesPlayed"] == 1


def test_age_group_ratings_deduplicates_same_matchup_different_game_ids():
    # Confirmed real data artifact: the source feed can carry two DIFFERENT
    # gameIds for what's clearly the same real game (e.g. "Lake Tahoe
    # Grizzlies 10-1 vs Capital Thunder 10-2" on 09/19/26 appeared as both
    # game 57332 (13-2) and game 57345 (12-2) -- almost certainly a score
    # correction posted as a new row rather than an edit to the original).
    # gameId-only dedup doesn't catch this; (home, away, date) must.
    division = _division(
        3, "10U B",
        [
            _raw_game("A", "B", 13, 2, "57332", "10U B"),
            _raw_game("A", "B", 12, 2, "57345", "10U B"),  # same matchup, same date, "corrected" score
        ],
    )
    age_groups = compute_age_group_ratings([division])
    assert age_groups["10U"]["teams"]["A"]["gamesPlayed"] == 1


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


def test_age_group_ratings_filters_roster_to_declared_division():
    # B1 tested at BB (won convincingly) but is declared to stay in B.
    # BB's own roster must not show B1, even though it has a real game
    # (and a row) filed under BB's schedule.
    division_b = _division(3, "10U B", [_raw_game("B1", "B2", 5, 2, "g1", "10U B")])
    division_bb = _division(
        55, "10U BB",
        [
            _raw_game("BB1", "BB2", 4, 1, "g2", "10U BB"),
            _raw_game("BB1", "B1", 3, 6, "g3", "10U BB"),
        ],
    )
    declared = {"B1": "10U B", "B2": "10U B", "BB1": "10U BB", "BB2": "10U BB"}

    compute_age_group_ratings([division_b, division_bb], declared_divisions=declared)

    bb_names = {row["name"] for row in division_bb["ratingsByType"]["All"]["teams"]}
    assert "B1" not in bb_names
    b_names = {row["name"] for row in division_b["ratingsByType"]["All"]["teams"]}
    assert "B1" in b_names


def test_age_group_ratings_adds_promoted_team_with_no_row_in_new_division():
    # B1's declared division is BB, but every one of its actual games was
    # filed under B's own schedule (it hosted its one BB-caliber test) --
    # it never produced a row in BB's "All" bucket to begin with. BB's
    # roster must still show it, synthesized from the unified rating.
    division_b = _division(
        3, "10U B",
        [
            _raw_game("B1", "B2", 5, 2, "g1", "10U B"),
            _raw_game("B1", "BB1", 6, 3, "g2", "10U B"),  # B1 hosts, filed under B
        ],
    )
    division_bb = _division(55, "10U BB", [_raw_game("BB1", "BB2", 4, 1, "g3", "10U BB")])
    declared = {"B1": "10U BB", "B2": "10U B", "BB1": "10U BB", "BB2": "10U BB"}

    compute_age_group_ratings([division_b, division_bb], declared_divisions=declared)

    bb_names = {row["name"] for row in division_bb["ratingsByType"]["All"]["teams"]}
    assert "B1" in bb_names
    b1_row = next(row for row in division_bb["ratingsByType"]["All"]["teams"] if row["name"] == "B1")
    assert b1_row["wins"] == 2  # its full merged record (both games), not zero
    assert "B1" not in {row["name"] for row in division_b["ratingsByType"]["All"]["teams"]}


def test_split_physical_division_by_declared_subdivisions_detects_a_real_split():
    raw_games = [_raw_game("B1", "B2", 5, 2, "g1", "10U B"), _raw_game("B3", "B4", 1, 1, "g2", "10U B")]
    declared = {"B1": "10U B East", "B2": "10U B West", "B3": "10U B East", "B4": "10U B West"}

    labels = split_physical_division_by_declared_subdivisions("10U B", raw_games, declared)
    assert labels == ["10U B East", "10U B West"]


def test_split_physical_division_by_declared_subdivisions_no_split_when_not_declared():
    raw_games = [_raw_game("B1", "B2", 5, 2, "g1", "10U B")]
    # No declared entries at all -- nothing to split on, single label unchanged.
    assert split_physical_division_by_declared_subdivisions("10U B", raw_games, {}) == ["10U B"]


def test_age_group_ratings_keeps_declared_east_west_genuinely_separate():
    # B East and B West are a REAL split (East strictly stronger, confirmed
    # by state-playoff eligibility -- see DIVISION_HIERARCHY's own comment),
    # not a geographic relabeling of one shared "B" tier -- they must NOT
    # get merged back together. Simulates main()'s actual flow: one raw
    # game list, split into two division payloads by declared sub-label.
    raw_games = [
        _raw_game("B1", "B3", 5, 2, "g1", "10U B"),  # within East
        _raw_game("B2", "B4", 6, 1, "g2", "10U B"),  # within West
    ]
    declared = {"B1": "10U B East", "B2": "10U B West", "B3": "10U B East", "B4": "10U B West"}

    labels = split_physical_division_by_declared_subdivisions("10U B", raw_games, declared)
    east = build_division_payload(3, "10U B East", raw_games, {})
    west = build_division_payload(3, "10U B West", raw_games, {})

    compute_age_group_ratings([east, west], declared_divisions=declared)

    east_names = {row["name"] for row in east["ratingsByType"]["All"]["teams"]}
    west_names = {row["name"] for row in west["ratingsByType"]["All"]["teams"]}
    assert labels == ["10U B East", "10U B West"]
    assert east_names == {"B1", "B3"}
    assert west_names == {"B2", "B4"}
    # No cross-contamination -- East teams never leak into West's roster.
    assert east_names.isdisjoint(west_names)


def test_age_group_ratings_estimates_rating_for_team_with_no_within_tier_game():
    # San Mateo Black Stars 10-2 (declared B East, a brand-new split) had
    # zero games against a fellow B East team this preseason -- only B West
    # and BB opponents. It never appears in within_ratings_by_tier for ANY
    # tier, so without a fallback it's silently dropped from `teams`
    # entirely (confirmed live: exactly this team, plus Oakland Bears 10-2,
    # were missing after the East/West split shipped). Its rating must
    # still be estimated from its real opponents' own known ratings.
    raw_east_within = [_raw_game("B1", "B3", 5, 2, "g1", "10U B")]  # within East, uninvolved with B5
    raw_cross = [_raw_game("B5", "B2", 9, 0, "g2", "10U B")]  # B5 (declared East) vs B2 (declared West)
    raw_west_within = [_raw_game("B2", "B4", 6, 1, "g3", "10U B")]  # within West
    declared = {
        "B1": "10U B East", "B3": "10U B East", "B5": "10U B East",
        "B2": "10U B West", "B4": "10U B West",
    }

    raw_games = raw_east_within + raw_cross + raw_west_within
    east = build_division_payload(3, "10U B East", raw_games, {})
    west = build_division_payload(3, "10U B West", raw_games, {})
    age_groups = compute_age_group_ratings([east, west], declared_divisions=declared)

    assert "B5" in age_groups["10U"]["teams"]
    assert age_groups["10U"]["teams"]["B5"]["gamesPlayed"] == 1
    b5_row = next(row for row in east["ratingsByType"]["All"]["teams"] if row["name"] == "B5")
    assert b5_row["rating"] == age_groups["10U"]["teams"]["B5"]["rating"]
    assert "B5" not in {row["name"] for row in west["ratingsByType"]["All"]["teams"]}


def test_age_group_ratings_routes_within_rating_by_declared_tier_not_division_tier():
    # The display-roster assertions above (east_names/west_names) pass even
    # if a team's WITHIN-RATING got attributed to the wrong tier internally
    # -- display filtering and rating computation are two separate steps
    # (see _apply_declared_roster_and_unified_rating's own docstring on
    # why). This test catches that class of bug directly: tierOffsets must
    # show "B East" and "B West" as two genuinely distinct tiers (not one
    # merged into the other, and not one silently missing because its
    # within-ratings got mis-routed to the wrong bucket).
    raw_b = [
        _raw_game("B1", "B3", 5, 2, "g1", "10U B"),  # within East
        _raw_game("B2", "B4", 6, 1, "g2", "10U B"),  # within West
    ]
    raw_bb = [
        _raw_game("BB1", "BB2", 3, 2, "g4", "10U BB"),  # within BB
        _raw_game("BB1", "B1", 4, 1, "g3", "10U BB"),  # bridge: BB1 (BB) vs B1 (declared B East)
    ]
    declared = {
        "B1": "10U B East", "B2": "10U B West", "B3": "10U B East", "B4": "10U B West",
        "BB1": "10U BB", "BB2": "10U BB",
    }

    east = build_division_payload(3, "10U B East", raw_b, {})
    west = build_division_payload(3, "10U B West", raw_b, {})
    bb = build_division_payload(55, "10U BB", raw_bb, {})

    age_groups = compute_age_group_ratings([east, west, bb], declared_divisions=declared)

    offsets = age_groups["10U"]["tierOffsets"]
    assert "B East" in offsets
    assert "B West" in offsets
    assert offsets["BB"]["evidenceCount"] == 1  # the BB1-vs-B1 bridge, correctly attributed to B East


def test_age_group_ratings_missing_declared_entry_is_not_dropped():
    # A team absent from declared_divisions.json entirely (stale/incomplete
    # file) must be kept, not silently filtered out.
    division_b = _division(3, "10U B", [_raw_game("B1", "B2", 5, 2, "g1", "10U B")])
    declared = {"B1": "10U B"}  # B2 deliberately absent

    compute_age_group_ratings([division_b], declared_divisions=declared)

    names = {row["name"] for row in division_b["ratingsByType"]["All"]["teams"]}
    assert "B2" in names


def test_build_division_payload_includes_experimental_offense_defense_rating():
    division = _division(
        3, "10U B",
        [
            _raw_game("A", "B", 6, 2, "g1", "10U B"),
            _raw_game("B", "C", 3, 5, "g2", "10U B"),
            _raw_game("C", "A", 1, 4, "g3", "10U B"),
        ],
    )
    rows = division["ratingsByType"]["All"]["teams"]
    assert len(rows) == 3
    for row in rows:
        assert isinstance(row["offense"], float)
        assert isinstance(row["defense"], float)
        # Experimental rating = offense + defense, same convention used to
        # rank/tier it -- checked directly rather than trusting rounding.
        assert row["experimentalRating"] == round(row["offense"] + row["defense"], 3)
        assert row["experimentalRank"] in (1, 2, 3)
        assert row["experimentalTier"] in ("top", "mid", "low")


def test_merge_raw_games_into_label_first_seen_just_stores_the_games():
    by_label: dict = {}
    by_level_id: dict = {}
    games = [_raw_game("A", "B", 5, 2, "g1", "10U B East")]

    added = merge_raw_games_into_label(by_label, by_level_id, "10U B East", 135, games)

    assert added == 1
    assert by_label["10U B East"] == games
    assert by_level_id["10U B East"] == 135


def test_merge_raw_games_into_label_dedupes_by_game_id_across_physical_levels():
    # Simulates NorCal exposing a previously lumped level (e.g. "10U B",
    # level 3) AND its new native successor (e.g. "10U B East", level 135)
    # at the same time -- the whole point of this function is to fold them
    # into one payload instead of two duplicate division entries.
    by_label: dict = {}
    by_level_id: dict = {}
    legacy_games = [
        _raw_game("A", "B", 5, 2, "g1", "10U B East"),
        _raw_game("C", "D", 1, 1, "g2", "10U B East"),
    ]
    merge_raw_games_into_label(by_label, by_level_id, "10U B East", 3, legacy_games)

    native_games = [
        _raw_game("A", "B", 5, 2, "g1", "10U B East"),  # same game, re-fetched from the native feed
        _raw_game("E", "F", 3, 0, "g3", "10U B East"),  # genuinely new, regular-season game
    ]
    added = merge_raw_games_into_label(by_label, by_level_id, "10U B East", 135, native_games)

    assert added == 1  # only g3 is new; g1 was already present
    assert {g["game_id"] for g in by_label["10U B East"]} == {"g1", "g2", "g3"}
    # The later (native) physical level wins as the label's nominal levelId.
    assert by_level_id["10U B East"] == 135


def test_apply_team_aliases_rewrites_home_and_away():
    games = [_raw_game("Capital Thunder 10-2", "Opp", 5, 2, "g1", "10U B")]
    aliases = {"Capital Thunder 10-2": "Capital Thunder 10B"}
    rewritten = apply_team_aliases(games, aliases)
    assert rewritten[0]["home"] == "Capital Thunder 10B"
    assert rewritten[0]["away"] == "Opp"  # not in the alias map -- left untouched


def test_apply_team_aliases_is_a_noop_for_unknown_names_and_empty_map():
    games = [_raw_game("A", "B", 5, 2, "g1", "10U B")]
    assert apply_team_aliases(games, {}) == games
    assert apply_team_aliases(games, {"Someone Else": "X"}) == games


def test_compute_renames_detects_a_clean_rename():
    old = {"Capital Thunder 10-2": {"teamId": "3094", "season": "33"}}
    new_rows = [("3094", "33", "Capital Thunder 10B")]
    aliases, warnings = compute_renames(old, new_rows)
    assert aliases == {"Capital Thunder 10-2": "Capital Thunder 10B"}
    assert warnings == []


def test_compute_renames_skips_an_ambiguous_collision():
    # Two different real teams (ids 17, 18) renamed to the exact same
    # string -- aliasing either old name into it would wrongly merge two
    # teams' histories, so neither gets an alias; both are reported instead.
    # `new_rows` must carry BOTH ids under the identical name (as the raw,
    # uncollapsed resolve() output does) for this collision to be visible
    # at all -- collapsing by name first would already have dropped one.
    old = {
        "Tri Valley Blue Devils 10-1": {"teamId": "18", "season": "33"},
        "Tri Valley Blue Devils 10-2": {"teamId": "17", "season": "33"},
    }
    new_rows = [
        ("18", "33", "Tri Valley Blue Devils 10A"),
        ("17", "33", "Tri Valley Blue Devils 10A"),
    ]
    aliases, warnings = compute_renames(old, new_rows)
    assert aliases == {}
    assert len(warnings) == 2  # one per old name that would have collided
    assert all("Tri Valley Blue Devils 10A" in w for w in warnings)


def test_compute_renames_ignores_teams_with_no_name_change():
    old = {"Stable Name": {"teamId": "1", "season": "33"}}
    new_rows = [("1", "33", "Stable Name")]
    aliases, warnings = compute_renames(old, new_rows)
    assert aliases == {}
    assert warnings == []


def test_collapse_by_name_last_one_wins_on_collision():
    # This is the lossy step compute_renames must run BEFORE collapsing,
    # not after -- documented here so the two functions' contracts don't
    # drift apart silently.
    rows = [("18", "33", "Tri Valley Blue Devils 10A"), ("17", "33", "Tri Valley Blue Devils 10A")]
    assert collapse_by_name(rows) == {"Tri Valley Blue Devils 10A": {"teamId": "17", "season": "33"}}
