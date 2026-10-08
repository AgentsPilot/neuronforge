-- ============================================================================
-- insight_measurements: did the thing we raised actually get better?
-- ============================================================================
--
-- WHAT THIS CLOSES
--
-- The advisor has never found out whether its advice helped. It records that a
-- card was shown (`insights.surface_count`), that it was read and acted on
-- (`owner_insight_history.action`), and the figure that made it fire
-- (`insights.current_value` with its `metric_key`). Then nothing. The "before"
-- has been stored since the module was built; the "after" was never taken.
--
-- One row here is one re-reading of that same metric, some weeks after the
-- owner did something about it.
--
-- ── WHY NOT `insight_outcomes` ──────────────────────────────────────────────
--
-- `lib/repositories/OutcomeRepository.ts` already writes to a table of that
-- name, and `public.insight_outcomes` DOES NOT EXIST -- no migration in this
-- repository creates it, and a live probe on 2026-10-06 returned
-- `relation "public.insight_outcomes" does not exist`. That repository belongs
-- to the AGENT insight system (`lib/pilot/insight/**`, `/api/v2/insights`),
-- whose shape is agent-flavoured: `executions_measured`, success per run.
--
-- Creating `insight_outcomes` with a Business OS shape would silently adopt
-- that broken writer and then fail it on missing columns. Rule 1 of the
-- `business-os-insights` skill exists for exactly this collision: two systems
-- share a vocabulary and must not share a table. Hence a distinct name.
--
-- (The agent system's outcome tracking is therefore also dead. Flagged, not
-- fixed here -- it is the other system.)
--
-- ── WHAT A ROW DOES AND DOES NOT CLAIM ──────────────────────────────────────
--
-- It claims the owner acted and the number later moved. It does NOT claim the
-- action caused the movement: a holiday, a lost contract and the weather all
-- happened too. That is why `outcome_of` also records DISMISSED insights --
-- they are the control group, and advice is only worth ranking against what
-- happened when it was ignored.
--
-- `verdict = 'unmeasurable'` is a real answer, stored rather than skipped. A
-- metric with no fresh reading means we do not know, and the row records that
-- we looked. Without it "no data" silently becomes "no improvement", and the
-- ranking learns to suppress detectors that fire on quiet accounts.
--
-- ── IMPROVEMENT HAS NO FIXED SIGN ───────────────────────────────────────────
--
-- `direction` is copied from the insight because it decides what "better"
-- means. `ret_no_show_spike` fired because a rate was too HIGH, so falling is
-- improvement; `ops_utilization_low` fired because one was too LOW, so rising
-- is. The judgement lives in `insight/outcome/judgeMovement.ts`, which is pure
-- and tested; this table stores what it decided.
--
-- ── OPERATOR-ONLY ───────────────────────────────────────────────────────────
--
-- RLS ENABLED with NO POLICY, the same shape as `insight_hypotheses` and
-- `bos_cron_runs`. Only the service role reaches it. An owner being shown
-- "the advice we gave you did not work" is a product decision nobody has
-- taken, and until they do the rows exist to rank advice, not to report on it.
-- `user_id` says whose business a row is about; it is not an access grant.
--
-- IDEMPOTENT: every statement is guarded, so applying this twice is harmless.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.insight_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * Whose business this is about. NOT an access grant -- see the header. No
   * foreign key to auth.users, matching the other Business OS tables.
   */
  user_id uuid NOT NULL,

  /*
   * The card being judged. CASCADE because a measurement of a deleted insight
   * is an orphan with no meaning -- it cannot be joined back to what was
   * claimed, the metric it was about, or the threshold it breached.
   */
  insight_id uuid NOT NULL REFERENCES public.insights(id) ON DELETE CASCADE,

  /*
   * Denormalised from the insight so the ranking query never needs the join.
   * This is the column the whole table exists to group by: "does advice from
   * THIS detector tend to be followed by improvement?"
   */
  detector_id text NOT NULL,

  /** The metric that was re-read. Matches `derived_metrics.metric_key`. */
  metric_key text NOT NULL,

  /*
   * What the owner did, and the reason dismissals are here.
   *
   * `dismissed` rows are the control group. Without them a high improvement
   * rate is unreadable: businesses improve on their own, and advice that is
   * followed by improvement no more often than advice that was ignored is
   * advice worth retiring.
   */
  outcome_of text NOT NULL CHECK (outcome_of IN ('acted', 'dismissed')),

  /** When the clock started: `insights.acted_at` or `dismissed_at`. */
  action_at timestamptz NOT NULL,

  /** How long after the action this reading was taken. */
  horizon_days integer NOT NULL CHECK (horizon_days > 0),

  /*
   * The two readings. Both nullable, because `unmeasurable` has to be
   * storable -- a row saying "we looked and could not tell" is the point.
   */
  value_before numeric,
  value_after numeric,

  /*
   * The side the threshold was breached on, copied from the insight.
   *
   * Decides what improvement means. Copied rather than joined because the
   * insight's own value could in principle be rewritten by a later detection,
   * and a stored verdict must stay readable against the direction that
   * produced it.
   */
  direction text NOT NULL CHECK (direction IN ('above', 'below')),

  verdict text NOT NULL
    CHECK (verdict IN ('improved', 'worsened', 'unchanged', 'unmeasurable')),

  /*
   * Signed change from `value_before`. NULL where it cannot be computed --
   * a baseline of zero has no percentage, and every movement away from it is
   * infinite. Printing one is how this module once showed an owner a 275%
   * refund rate. The verdict carries the meaning; this is for display.
   */
  change_percent numeric,

  measured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  /*
   * One reading per insight per horizon.
   *
   * This is the idempotency guarantee that lets the measuring job be a plain
   * select-then-write rather than a claim/lease queue: re-running it can only
   * attempt rows that already exist, and the conflict is swallowed. There is
   * no external effect here -- nothing is sent, charged or published -- so the
   * `durable-queue-drain` pattern is not required. A second horizon (90 days
   * after a 30) is a NEW row by design, so a metric can be followed.
   */
  UNIQUE (insight_id, horizon_days)
);

/*
 * The measuring job's query: insights acted on, not yet measured at a horizon.
 *
 * The job selects from `insights` and anti-joins here, so this index serves the
 * existence check. Partial on nothing, because every row is a candidate.
 */
CREATE INDEX IF NOT EXISTS insight_measurements_insight_idx
  ON public.insight_measurements (insight_id, horizon_days);

/*
 * The ranking query: how has advice from this detector tended to land?
 *
 * Across accounts deliberately -- a single business will not act on enough
 * cards to rank its own advice for a very long time, and this table holds no
 * business content, only a detector id and whether a number moved.
 */
CREATE INDEX IF NOT EXISTS insight_measurements_detector_idx
  ON public.insight_measurements (detector_id, outcome_of, verdict);

/** Per-account history, for reading one business's story end to end. */
CREATE INDEX IF NOT EXISTS insight_measurements_user_idx
  ON public.insight_measurements (user_id, measured_at DESC);

/*
 * Business ownership, so a torn-down business takes its measurements with it.
 *
 * `20260916_business_data_ownership.sql` keeps a loop that adds exactly this
 * constraint to every business-owned table, and `insight_measurements` is
 * named in its array — but that loop runs BEFORE this migration on a fresh
 * database and skips a table that does not exist yet. So the constraint is
 * added here as well, following the precedent that file documents for
 * `business_addresses`. The loop skips a constraint that is already there, so
 * only one of the two ever creates it.
 *
 * NOT VALID matches the loop: it binds new rows without taking the table lock
 * a full validation would.
 */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insight_measurements_business_fk'
      AND conrelid = 'public.insight_measurements'::regclass
  ) THEN
    ALTER TABLE public.insight_measurements
      ADD CONSTRAINT insight_measurements_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.insight_measurements ENABLE ROW LEVEL SECURITY;

/*
 * NO POLICY. Service role only, by construction rather than by a rule somebody
 * has to maintain. See the header.
 */

COMMENT ON TABLE public.insight_measurements IS
  'One re-reading of an insight''s own metric, some weeks after the owner acted on or dismissed it. Closes the loop the advisor never had: the "before" was always stored on `insights`, the "after" was never taken. RLS enabled with NO policy: operator-only. Records correlation, never causation -- dismissed insights are the control group. Named to avoid `insight_outcomes`, which the AGENT system''s repository writes to and which does not exist. Added 2026-10-06.';

COMMENT ON COLUMN public.insight_measurements.outcome_of IS
  'acted | dismissed. Dismissed rows are the control group: advice followed by improvement no more often than advice that was ignored is advice worth retiring.';

COMMENT ON COLUMN public.insight_measurements.direction IS
  'The side the threshold was breached on, copied from the insight. Decides what improvement means: `above` means it was too high, so falling is better.';

COMMENT ON COLUMN public.insight_measurements.verdict IS
  'improved | worsened | unchanged | unmeasurable. `unmeasurable` is stored, not skipped -- otherwise "no data" becomes "no improvement" and the ranking learns to suppress detectors that fire on quiet accounts.';

COMMENT ON COLUMN public.insight_measurements.change_percent IS
  'Signed change from value_before, or NULL where no percentage exists (a baseline of zero). Never 0 as a stand-in for unknown.';
