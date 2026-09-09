from backtest import load_played_games, parse_game_datetime, predict_one, walk_forward
from ratings import Game, compute_ratings


def _game(game_id, home, away, home_goals, away_goals, date, time, division_label="10U B", played=True):
    return {
        "gameId": game_id,
        "date": date,
        "day": "",
        "time": time,
        "rink": "",
        "type": "Preseason",
        "away": away,
        "home": home,
        "awayGoals": away_goals if played else None,
        "homeGoals": home_goals if played else None,
        "played": played,
        "ageLabel": division_label.split()[0],
        "levelLabel": division_label.split(None, 1)[1],
    }


def _division(level_id, label, games):
    age, level = label.split(None, 1)
    return {"levelId": level_id, "ageLabel": age, "levelLabel": level, "games": games}


def test_parse_game_datetime_orders_correctly():
    earlier = parse_game_datetime("09/04/26", "6:15PM")
    later_same_day = parse_game_datetime("09/04/26", "7:00PM")
    next_day = parse_game_datetime("09/05/26", "1:00AM")
    assert earlier < later_same_day < next_day


def test_parse_game_datetime_unparseable_returns_none():
    assert parse_game_datetime("not a date", "whenever") is None


def test_predict_one_never_uses_the_held_out_game_itself_or_future_games():
    division = _division(
        3, "10U B",
        [
            _game("g1", "A", "B", 5, 2, "09/04/26", "5:00PM"),
            _game("g2", "A", "C", 3, 1, "09/05/26", "5:00PM"),
            # This is the held-out game: predicting it must not use its own
            # result, nor game g3 which happens after it.
            _game("g3_target", "A", "B", 20, 0, "09/06/26", "5:00PM"),
            _game("g4", "A", "C", 20, 0, "09/07/26", "5:00PM"),
        ],
    )
    games = load_played_games({"divisions": [division]})
    target = next(g for g in games if g.dt == parse_game_datetime("09/06/26", "5:00PM"))

    result = predict_one([division], target)

    # Manually compute what the rating *should* be using only g1 and g2 --
    # if g3_target's own 20-0 result or g4's later result leaked in, this
    # would not match.
    expected_ratings = {
        r.name: r.rating
        for r in compute_ratings(
            [
                Game(home="A", away="B", home_goals=5, away_goals=2),
                Game(home="A", away="C", home_goals=3, away_goals=1),
            ]
        )
    }
    assert result.predicted_margin == round(expected_ratings["A"] - expected_ratings["B"], 3)


def test_predict_one_returns_none_for_a_cold_start_team():
    division = _division(
        3, "10U B",
        [_game("g1", "A", "B", 5, 2, "09/04/26", "5:00PM")],
    )
    games = load_played_games({"divisions": [division]})
    # Predicting the very first game: neither team has any prior history.
    result = predict_one([division], games[0])
    assert result.predicted_margin is None
    assert result.cross_division is None


def test_walk_forward_produces_one_result_per_played_game_in_order():
    division = _division(
        3, "10U B",
        [
            _game("g1", "A", "B", 5, 2, "09/05/26", "5:00PM"),
            _game("g2", "A", "C", 3, 1, "09/04/26", "5:00PM"),  # earlier date, listed second
            _game("g3", "A", "D", 1, 1, "09/06/26", "5:00PM", played=False),  # unplayed, excluded
        ],
    )
    results = walk_forward({"divisions": [division]})
    assert [r.game.dt for r in results] == sorted(r.game.dt for r in results)
    assert len(results) == 2  # g3 (unplayed) excluded
