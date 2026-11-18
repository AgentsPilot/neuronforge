/*
 * A client's standing, snapshotted, so behaviour can be read as a TREND.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TABLE AT ALL, WHEN THE COUNTS CAN BE COMPUTED
 *
 * `lib/business-os/clients/clientProfile.ts` builds a client's record from rows
 * that already exist — sessions, instalments, refunds, quotes — and
 * `clientStanding.ts` turns it into a band. Computed on read, neither can go
 * stale, which is the failure the refund insight had on 2026-11-15: a derived
 * figure written once and never refreshed.
 *
 * What computing on read cannot do is remember. "Dana missed one session in six
 * last quarter and four in eight this one" is the sentence an owner can act on,
 * and nothing in the schema could answer it: the source rows say what happened,
 * never what the picture looked like at a point in time. A pattern needs its
 * own history.
 *
 * So: a snapshot per client per day, written only when the picture CHANGED. The
 * live answer stays computed; this is the memory of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO BACKFILL, DELIBERATELY
 *
 * Several fixes landed after the data they govern — attribution of who called a
 * session off among them. Of 78 cancelled meetings in production, nine still
 * name nobody, and a backfill would import exactly that uncertainty as though
 * it were measured. The first snapshot is taken the first time the job runs,
 * and trend becomes available once there is honest history to read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A ROW IS, AND IS NOT
 *
 * It is a count of facts and the band they produced. It is NOT a judgement
 * about a person that outlives the facts: every number here can be re-derived
 * from the source rows, and the band's own thresholds live in
 * `CLIENT_STANDING` where they can be read and argued with.
 *
 * `sessions_cancelled_by_owner` and `_unknown` are stored beside the client's
 * own count on purpose. They never move a band, and keeping them visible is
 * what stops the next reader assuming a cancellation was the client's.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_client_standing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* Denormalised so RLS is stated on this row alone, as every sibling does. */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,

  /*
   * The DAY the picture was taken, not the instant.
   *
   * A day is the grain a trend is read at, and it makes the job idempotent: a
   * second run on the same day updates the row rather than adding a second
   * opinion about the same afternoon.
   */
  as_of date NOT NULL DEFAULT CURRENT_DATE,
  /* How far back the counts looked. Stored because it may be tightened, and a
     count means nothing without the window it was taken over. */
  window_days integer NOT NULL,

  band text NOT NULL CHECK (band IN ('new', 'reliable', 'watch', 'at_risk')),

  sessions_settled integer NOT NULL DEFAULT 0,
  sessions_held integer NOT NULL DEFAULT 0,
  sessions_missed integer NOT NULL DEFAULT 0,
  /* Theirs. The only cancellation count a band may read. */
  sessions_cancelled_by_client integer NOT NULL DEFAULT 0,
  /* The business's own. Kept so it can never be mistaken for the client's. */
  sessions_cancelled_by_owner integer NOT NULL DEFAULT 0,
  /* Nobody recorded. Pre-fix rows live here and are held against no one. */
  sessions_cancelled_unknown integer NOT NULL DEFAULT 0,

  instalments_due integer NOT NULL DEFAULT 0,
  instalments_paid_on_time integer NOT NULL DEFAULT 0,
  instalments_paid_late integer NOT NULL DEFAULT 0,
  instalments_overdue integer NOT NULL DEFAULT 0,

  /* Reported, never scored: a refund is usually the business's own decision. */
  refunds integer NOT NULL DEFAULT 0,
  proposals_declined integer NOT NULL DEFAULT 0,

  /* Null below the evidence floor — "we do not know" is not zero. */
  miss_rate numeric(5, 4),
  late_rate numeric(5, 4),

  created_at timestamptz NOT NULL DEFAULT now(),

  /* One picture per client per day. */
  UNIQUE (user_id, contact_id, as_of)
);

/*
 * The two reads this table has.
 *
 * The drawer badge asks for ONE client's latest row; the dashboard asks which
 * clients are in a band today. Nothing else queries it, and an index that no
 * query uses is a write cost with no reader.
 */
CREATE INDEX IF NOT EXISTS idx_crm_client_standing_latest
  ON public.crm_client_standing(user_id, contact_id, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_crm_client_standing_attention
  ON public.crm_client_standing(user_id, as_of DESC)
  WHERE band IN ('watch', 'at_risk');

/*
 * Business-owned: a new business must not inherit the previous holder's view of
 * its clients. `20260916`'s loop has already run on every existing database and
 * will never see this name, so the constraint is added here and the name is
 * added there for a fresh install — the same pairing `refund_requests` uses.
 */
DO $business_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_client_standing_business_fk'
      AND conrelid = 'public.crm_client_standing'::regclass
  ) THEN
    ALTER TABLE public.crm_client_standing
      ADD CONSTRAINT crm_client_standing_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$business_fk$;

ALTER TABLE public.crm_client_standing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own client standing" ON public.crm_client_standing;
CREATE POLICY "Users read their own client standing"
  ON public.crm_client_standing FOR SELECT
  USING (auth.uid() = user_id);

/*
 * READ-ONLY to the owner, on purpose.
 *
 * Every row is derived. A hand-edited standing would be a claim about a client
 * that no source row supports and that the next run would silently overwrite —
 * so the only writer is the job that computes it, through the service role,
 * which does not consult this policy.
 */

COMMENT ON TABLE public.crm_client_standing IS
  'A snapshot of how a client has behaved, one row per client per day, written '
  'only when the picture changed. Derived from sessions, instalments, refunds '
  'and quotes by lib/business-os/clients/clientProfile.ts; the band comes from '
  'clientStanding.ts. The live answer is computed on read — this is the memory '
  'that makes a trend possible. Never backfilled: data predating the '
  'attribution fixes would import uncertainty as fact.';

COMMIT;
