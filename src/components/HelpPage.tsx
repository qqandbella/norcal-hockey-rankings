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
        A B-division team&apos;s +2 rating and a BB-division team&apos;s +2 rating aren&apos;t the
        same thing -- each division is centered around its own average, and divisions themselves
        differ in overall strength (AA &gt; A &gt; BB &gt; B). To compare across divisions, each
        team&apos;s rating gets a <strong>tier offset</strong> added on top of its within-division
        rating, so everyone lands on one shared scale.
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
        real tier says it&apos;s clearly stronger than that.
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
    </section>
  )
}
