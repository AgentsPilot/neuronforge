-- ============================================================================
-- insight_hypotheses: model-proposed findings, before anyone has looked at them.
-- ============================================================================
--
-- WHAT THIS HOLDS
--
-- One row per hypothesis the weekly generator proposed, whether or not the
-- verifier confirmed it. Each row carries the claim, the BizQL query that was
-- meant to settle it, the condition the model committed to in advance, and the
-- result that came back.
--
-- The UNCONFIRMED rows are kept on purpose. Early on they are the more valuable
-- half: they are the record of what the model gets wrong, and the evidence for
-- tightening `confirm_when` in `lib/business-os/insight/hypothesis/verify.ts`.
-- Judging this feature means reading the reject pile, not the highlights.
--
-- ── OPERATOR-ONLY, AND WHY THAT IS NOT OPTIONAL ─────────────────────────────
--
-- RLS is ENABLED with NO POLICY AT ALL, the same shape as
-- `20261011_bos_cron_runs.sql`. Only the service role reaches it.
--
-- A business owner must never read this table, and the reason is the point of
-- the whole review step: a row here is a sentence a MODEL wrote about their
-- business that nobody has checked. One of them will eventually say something
-- true and useless ("clients who book on Mondays never come back" -- Monday had
-- one client), and one may eventually say something true and upsetting. The
-- owner sees a finding only after it is promoted into `insights`, which is a
-- deliberate act by a person.
--
-- There is therefore no owner policy to write and no `user_id` filter to get
-- right on the read path. `user_id` is here to say WHOSE business the claim is
-- about, not to grant anybody access to it.
--
-- ── WHAT IS DELIBERATELY NOT STORED ─────────────────────────────────────────
--
-- No client names, no emails, no owner text. The generator's prompt is built
-- from counts and shapes (`buildProfile.ts`), so the claim cannot name a person
-- unless the model invents one -- and `result` holds group KEYS, which for a
-- relation grouping are labels the catalog resolved, not raw rows.
--
-- `claim` is model output and is therefore never logged, only stored. The
-- services that touch it log reasons and lengths (standard 5 of
-- bos-llm-call-standards).
--
-- IDEMPOTENT: every statement is guarded, so applying this twice is harmless.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.insight_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * Whose business the claim is about. NOT an access grant -- see the header.
   * No foreign key to auth.users, matching the other Business OS tables, so a
   * deleted account's rows are removed by the purge descriptors rather than by
   * a cascade nobody can see.
   */
  user_id uuid NOT NULL,

  /** The action's grouping id, so a row joins to its audit entry and charge. */
  run_group_id uuid NOT NULL,

  /** One sentence, no figures. Model output: stored, never logged. */
  claim text NOT NULL,

  /** The BizQL compute query that was meant to settle it. */
  query jsonb NOT NULL,

  /** The condition the model committed to BEFORE seeing any result. */
  confirm_when jsonb NOT NULL,

  /*
   * The verdict and the numbers behind it: surviving groups with their row
   * counts, the best and worst, the ratio. This is the provenance -- a
   * published card's figures must be traceable to a result, not to prose.
   */
  verdict jsonb,

  /**
   * unconfirmed  the verifier said no. Kept for learning; never shown to anyone.
   * pending      confirmed, waiting for a person to look.
   * published    promoted into `insights`; the owner can see it.
   * dismissed    a person looked and said no.
   */
  status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (status IN ('unconfirmed', 'pending', 'published', 'dismissed')),

  /** Why the verifier declined: one of verify.ts's RejectReason values. */
  reject_reason text,

  /** The model that actually ran, not the one asked for (FR-13). */
  model_used text,

  /** Who decided, and when. Null while pending. */
  decided_at timestamptz,
  decided_by uuid,

  created_at timestamptz NOT NULL DEFAULT now()
);

/*
 * The review screen's query: pending rows, newest first.
 *
 * Partial, on the status the screen actually filters. The table is expected to
 * be mostly `unconfirmed`, so an index over every status would be mostly rows
 * nobody reads.
 */
CREATE INDEX IF NOT EXISTS insight_hypotheses_pending_idx
  ON public.insight_hypotheses (created_at DESC)
  WHERE status = 'pending';

/** Per-account history, for the reject-pile reading that tunes the verifier. */
CREATE INDEX IF NOT EXISTS insight_hypotheses_user_idx
  ON public.insight_hypotheses (user_id, created_at DESC);

ALTER TABLE public.insight_hypotheses ENABLE ROW LEVEL SECURITY;

/*
 * NO POLICY. Service role only, by construction rather than by a rule somebody
 * has to maintain. See the header: a row here is unreviewed model output about
 * somebody's business.
 */

COMMENT ON TABLE public.insight_hypotheses IS
  'Model-proposed findings awaiting review. RLS enabled with NO policy: operator-only, because a row is a claim a model wrote that nobody has checked. Owners see a finding only once it is promoted into `insights`. Unconfirmed rows are kept deliberately as the record of what the generator gets wrong. Added 2026-10-06.';

COMMENT ON COLUMN public.insight_hypotheses.user_id IS
  'Whose business the claim is about. NOT an access grant -- there is no owner policy on this table.';

COMMENT ON COLUMN public.insight_hypotheses.verdict IS
  'The groups that survived the row floor, with row counts, plus best/worst/ratio. The provenance for any figure a published card shows.';
