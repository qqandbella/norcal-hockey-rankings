export function HelpPage() {
  return (
    <section className="help">
      <h2>How this works</h2>
      <p className="help__intro">
        This is a plain-English explanation of how ratings and predictions on this site are
        calculated -- no math background needed. If you want the actual code, everything here maps
        to <code>scripts/ratings.py</code> in the repo.
      </p>

      <h3>Why not just use win/loss record?</h3>
      <p>
        Early in the season, teams haven&apos;t played many games -- often just 2-3 preseason games
        each. A team that happens to play two weak opponents can look undefeated without actually
        being strong, and a team that happens to play two strong opponents can look bad despite
        being solid. Win/loss alone doesn&apos;t account for <em>who</em> you played.
      </p>
      <p>
        So instead of a simple standings table, each division gets a <strong>rating</strong> --
        a single number, centered around 0, that tries to estimate a team&apos;s true strength
        relative to the rest of its division. Positive means better than average, negative means
        below average. The traditional W-L-T/points/goals stats are still shown too -- they&apos;re
        just not what determines the rating or the tier label.
      </p>

      <h3>How the rating is computed</h3>
      <p>
        The core idea, in one sentence: <strong>a team&apos;s rating is the average of &quot;how
        good my opponent looked, plus or minus the game&apos;s goal margin&quot;, across all its
        games.</strong>
      </p>
      <p>
        Concretely: if Team A beats Team B by 3 goals, that game says &quot;A&apos;s rating should
        be about B&apos;s rating + 3&quot;. If A also loses to Team C by 2 goals, that game says
        &quot;A&apos;s rating should be about C&apos;s rating - 2&quot;. A&apos;s final rating is
        the average of those two implied values. Since every team&apos;s rating depends on its
        opponents&apos; ratings, and vice versa, the whole division is solved together, refining
        all ratings simultaneously until they stop changing (this is the same family of method
        MyHockeyRankings uses).
      </p>
      <p>On top of that plain average, two adjustments matter a lot with only a handful of games per team:</p>
      <ul>
        <li>
          <strong>Blowout margins are capped.</strong> A 12-0 win doesn&apos;t make a team 12 goals
          better than one that won 7-0 -- once a game is decided, the final score often just
          reflects lineup and ice-time decisions, not additional signal about strength. So goal
          margins beyond 7 are treated the same as exactly 7.
        </li>
        <li>
          <strong>Ratings are pulled toward the average (&quot;shrinkage&quot;) in proportion to
          how few games a team has played.</strong> A team with just one blowout win shouldn&apos;t
          be rated as if that were its whole season -- with one data point, we genuinely
          don&apos;t know if it&apos;ll hold up, so the rating is pulled partway back toward 0
          until more games confirm it. The pull is <em>weaker</em> for a team whose results all
          point the same direction (consistently strong or weak results across different
          opponents are more trustworthy) and <em>stronger</em> for a team with a scattered,
          inconsistent record (one big win, one big loss, one close game) -- since a single wild
          result there is more likely to be an outlier game, not the team&apos;s real level.
        </li>
      </ul>

      <h3>Tiers (top / mid / low)</h3>
      <p>
        Within a division, each team is labeled top, mid, or low tier. This isn&apos;t just
        &quot;top third by rank&quot; -- it&apos;s based on where the biggest natural gaps in
        rating actually fall. If the 3rd and 4th ranked teams are nearly identical in rating, they
        stay in the same tier even though one technically ranks higher; the tier boundaries land
        wherever there&apos;s a real jump in strength, not at a fixed head-count.
      </p>

      <h3>Comparing teams across divisions</h3>
      <p>
        Once final division placement is announced each season, every division&apos;s rankings
        table shows this same shared, cross-division-comparable rating -- not a separate
        division-local-only number. A B-division team&apos;s +2 and a BB-division team&apos;s +2
        mean the exact same thing. A division&apos;s roster is also now the teams{' '}
        <strong>officially placed</strong> there, from the league&apos;s own final standings --
        not just whoever happened to play a game filed under that division&apos;s schedule (a
        preseason cross-division test no longer leaves a team&apos;s name sitting in a roster it
        doesn&apos;t actually belong to). A team&apos;s W-L-T record still reflects every game it
        played this preseason, including any cross-division tests, even after it settles into one
        official division.
      </p>
      <p>
        Divisions themselves differ in overall strength (AA &gt; A &gt; BB &gt; B), so a shared
        scale still requires shifting each division&apos;s own internal rating by a{' '}
        <strong>tier offset</strong> before comparing:
      </p>
      <p>Each adjacent tier-pair&apos;s offset comes from two sources, blended together:</p>
      <ul>
        <li>
          <strong>A default assumption</strong> -- roughly, &quot;the bottom of the higher tier is
          about as strong as the top of the lower tier&quot;. Where a full past season of results
          exists for a tier pair (hundreds of games), that historical average is used; otherwise
          (too few historical samples to trust, or a brand-new split with no history at all, like
          a future B East/B West) the default is a flat +7 gap.
        </li>
        <li>
          <strong>Real cross-division games</strong>, when they exist -- a team that has played
          in two different tiers (a cross-level test game, or a team that moved levels) gives a
          direct data point for how the two tiers actually compare. The more such games exist for
          a tier pair, the more the offset shifts away from the default assumption and toward what
          the real games show; one or two games only nudge it slightly, since a single result
          could be a fluke.
        </li>
      </ul>
      <p>
        <strong>Worked example:</strong> suppose BB&apos;s default offset over B is +5.6 (from the
        historical calibration), and this season one real BB-vs-B game was played with a result
        implying a +8 gap. Since that&apos;s only one game against a years-long historical average,
        the blended offset moves only slightly above +5.6 -- not all the way to +8. If five more
        BB-vs-B games get played later in the season and they also suggest a bigger gap, the
        offset will keep drifting toward what the real games show.
      </p>
      <p>
        <strong>A team that plays mostly in one tier, with just a game or two in another,</strong>{' '}
        keeps its rating anchored mainly to whichever tier it has the most games in (its
        &quot;primary&quot; tier) -- the occasional cross-tier game nudges that rating slightly
        rather than replacing it outright. Without this, a single low-sample game in an unfamiliar
        tier (which on its own looks unremarkable, since there&apos;s no track record yet to judge
        it against) could otherwise drag a well-established team&apos;s rating down toward that
        other tier&apos;s average, even when the team&apos;s much larger body of evidence from its
        real tier says it&apos;s clearly stronger than that. This applies both to the team&apos;s
        overall cross-division rating, and to the rating shown for it directly on the guest
        division&apos;s own rankings table and rating block -- both reflect the same correction, so
        they stay consistent with each other.
      </p>

      <p>
        The <strong>Unified</strong> page (one per age group) lists every team across every division on
        this same shared, offset-adjusted scale -- not just within its own division -- so you can see how
        an A team, a BB team, and a B team actually compare. It also shows each tier&apos;s current offset
        and how many real cross-division games back it (&quot;evidence&quot;) -- early in the season that
        count can be small, so an offset (and the ranking positions it implies) can still be dominated by
        the historical prior rather than this season&apos;s own games; it firms up as more cross-division
        games get played and scraped in.
      </p>

      <h3>How predictions work</h3>
      <p>
        The <strong>Predict</strong> page (and the &quot;predicted: ...&quot; links on team
        schedules) picks two teams and estimates the goal margin as simply the difference between
        their cross-division-adjusted ratings. If Team A is rated +3.0 (on the shared scale) and
        Team B is rated -1.5, the predicted margin is 4.5 goals in Team A&apos;s favor.
      </p>
      <p>Every prediction shows its full reasoning, not just a number, labeled one of three ways:</p>
      <ul>
        <li>
          <strong>direct</strong> -- both teams are in the same division, so no cross-division
          translation is involved at all; the comparison is as solid as the within-division
          ratings themselves.
        </li>
        <li>
          <strong>bridged</strong> -- the teams are in different tiers, but real cross-division
          games exist connecting those tiers this season. The page lists every one of those games
          (who played, the actual margin, what gap it implies) so you can see exactly what
          evidence the prediction rests on.
        </li>
        <li>
          <strong>prior</strong> -- the teams are in different tiers and no cross-division games
          have been played yet connecting them, so the comparison rests entirely on the default
          historical assumption described above. Treat these predictions as a rougher estimate --
          they&apos;ll get more solid as real cross-division games happen and get scraped in.
        </li>
      </ul>

      <h3>Validating all of this against reality</h3>
      <p>
        Every change to this algorithm is checked with a <strong>walk-forward backtest</strong>:
        for every game that&apos;s actually been played, the model is refit using only the games
        that happened <em>before</em> it, asked to predict that game, and the prediction is
        compared to what really happened -- the same honest way tools like Elo ratings get
        validated. This catches changes that look reasonable in theory but actually make real
        predictions worse, and is how every tuning decision on this site (like the cap value or
        the shrinkage strength) has been chosen -- not by eyeballing the results, but by checking
        whether they actually predict real games better.
      </p>

      <h3>Experimental rating (offense/defense split)</h3>
      <p>
        The header has a site-wide <strong>Classic rating / Try experimental rating</strong> toggle
        (applies everywhere -- rankings tables, team pages, and the Predict page). The classic rating is a
        single number: how much better or worse than average a team is, overall. The experimental rating
        splits that into two separate numbers -- <strong>offense</strong> (how many goals a team scores
        above what an average team would against the same opponents) and <strong>defense</strong> (how
        many goals below average it allows). A team can have real offense but a leaky defense, or vice
        versa -- the same overall record either way, but a different reason for it, and a different
        question about how it&apos;ll do against a tougher or weaker opponent than usual.
      </p>
      <p>
        This isn&apos;t a guess -- it&apos;s backtest-validated the same way as everything else on this
        page: on this season&apos;s games so far, the offense/defense split predicts held-out games more
        accurately than the classic rating (lower average error, and picks the correct favorite more
        often). That validation is within-division only, though. Cross-division comparisons and the
        Predict page do use the experimental rating when the toggle is on, but they get there by reusing
        the classic model&apos;s cross-division machinery (tier offsets, described above) on the
        experimental number as-is -- a lower-risk, lighter-weight choice than building a full two-sided
        (offense-gap / defense-gap) cross-division model, but this specific reuse hasn&apos;t been
        separately validated, since there&apos;s no cross-division ground truth to check it against yet.
      </p>

      <h3>D-Zone Positioning Trainer</h3>
      <p>
        A separate practice tool (linked from the header) for teaching defensive-zone positioning, not
        part of the rating model above. It's built on the &quot;Box + 1&quot; defensive zone coverage
        system (goalie is the &quot;+1&quot;) -- a standard, widely-used introductory system for youth
        hockey, not something invented for this site. Every positioning rule it uses traces to that real
        coaching source (AJH Coach Player Book, &quot;D-Zone Coverage Responsibilities -- Box + 1&quot;):
        the puck-side defenseman pressures the puck and stays low -- including chasing behind the net to
        prevent a wrap-around, but handing off to a winger once the puck gets up around the hash marks,
        rather than chasing it all the way to the point; the weak-side defenseman holds the net-front/slot;
        the puck-side winger holds the top of the circle on that side; the weak-side winger collapses to
        the middle-ice slot; and the center plays low in support of the puck side, shifting more central
        when the puck is at the point. Which side is "strong" shifts gradually as the puck crosses toward
        the middle of the ice, not with a sudden swap the instant it crosses center -- real players read
        the play and adjust incrementally.
      </p>
      <p>
        Honest caveat: the coaching source describes roles in prose, not exact coordinates -- the
        <em> shape</em> of the system (who covers what, roughly) is real coaching knowledge, but the
        specific numbers (exact depths, how wide a lateral shift, how gradually roles hand off near
        center ice) are this site's own best-guess interpolation between those roles, tuned by hand
        against a handful of observed issues rather than validated against game film or a coach's direct
        review. Treat the exact positioning as a reasonable approximation, not gospel.
      </p>
      <p>
        Each defender's movement speed is capped relative to how fast the puck carrier is actually
        moving right now (roughly 1.15x, with a floor so defenders still adjust when the carrier is
        standing still, and a ceiling so dragging the carrier instantly across the ice doesn't let
        defenders teleport too) -- a real physical constraint, not just a smoothing effect. That speed
        estimate (~15ft/s base) is a plausible guess for 10U-level skating, not measured from real
        player-tracking data either.
      </p>
      <p>
        The rink itself is drawn to real NHL dimensions (85ft wide, 64ft goal line to blue line, 28ft
        corner radius, properly-spaced faceoff circles and hash marks), not an arbitrary shape.
      </p>
      <p>
        <strong>Watch mode</strong> lets you control 1-3 offensive players (drag the puck carrier, marked
        with a yellow ring, to move with the puck; tap a teammate to pass to them at a selectable speed --
        the puck travels visibly between them, and the 5 defenders react to where it actually is mid-pass,
        not just teleporting). You can focus on one position to watch it specifically.{' '}
        <strong>Control mode</strong> lets you directly control one defensive position yourself, with a
        dashed circle showing the model's ideal spot for comparison. <strong>Coach mode</strong> adds the
        ability to pause at any time, manually correct any defender's position (it stays put until reset,
        rather than snapping back), or swap which position's assignment two defenders each follow -- for
        a scenario like "LW tracks the puck carrier into RD's zone and continues, RD rotates into LW's
        zone" as a deliberate tactical call, not just a one-off nudge.
      </p>
    </section>
  )
}
