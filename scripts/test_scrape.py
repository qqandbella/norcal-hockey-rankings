from scrape import build_team_links


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
