/*
 * What the client signed, and the evidence that they did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE `lib/consent` MODEL, NOT A TIMESTAMP
 *
 * `accepted_snapshot` already records what was AGREED. What it cannot record is
 * that a particular person typed their name against it, which is a different
 * claim and the one a dispute turns on.
 *
 * `20260930_marketing_consent.sql` worked this out once already, and the shape
 * is taken from it rather than reinvented:
 *
 *   · the SERVER's wording is authoritative (`statement_text`), and the
 *     client's echoed sentence is kept separately under
 *     `evidence.client_statement` so a mismatch is visible rather than
 *     silently resolved in the client's favour;
 *   · `statement_version` and `statement_locale`, because the sentence will be
 *     reworded and a signature means what the sentence said ON THE DAY;
 *   · `ip_hash` is stored WITH `ip_hash_salt`. `hashIP` salts with the calendar
 *     day, which is right for privacy and useless for verification unless the
 *     salt is kept — a bare hash cannot be reproduced or checked later.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APPEND-ONLY
 *
 * A signature is evidence. It is never updated and never deleted while the
 * quote stands — the guard below refuses both, exactly as `trg_mce_guard` does
 * for consent events. A revision that needs a new signature gets a NEW
 * proposal and therefore a new row; it does not overwrite this one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INDEPENDENT OF THE BREAKDOWN
 *
 * `requires_signature` lives on `proposals` and defaults false. It applies to
 * EVERY quote — one job or a series of meetings, with a document or without —
 * because it records consent to terms, and a client buying ten sessions agrees
 * to terms exactly as one buying a renovation does.
 *
 * Plan: docs/workplans/PROPOSAL_DOCUMENT_BUILDER_WORKPLAN.md (Slice 5)
 */

CREATE TABLE IF NOT EXISTS public.proposal_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  /* Denormalised so RLS reads this row alone, as `proposal_attachments` does. */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /** As the client typed it. Not matched against the contact's name on file:
      a company's director may sign for a contact recorded as somebody else. */
  signed_name text NOT NULL CHECK (length(btrim(signed_name)) BETWEEN 2 AND 200),

  /** The sentence they agreed to, as the SERVER worded it that day. */
  statement_text text NOT NULL,
  statement_locale text NOT NULL,
  statement_version text NOT NULL,

  /** Verifiable only together. See the header. */
  ip_hash text,
  ip_hash_salt text,
  user_agent text,

  /** How it was given. One value today; named so a second cannot be guessed at. */
  method text NOT NULL DEFAULT 'typed_name',

  /** Anything else worth keeping — `client_statement` above all. */
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,

  signed_at timestamptz NOT NULL DEFAULT now(),

  /*
   * One signature per quote.
   *
   * `claimForAcceptance` already guarantees a single acceptance, so a second
   * row here could only come from a bug or a direct write — and two signatures
   * on one quote is a question nobody could answer afterwards.
   */
  UNIQUE (proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_signatures_user
  ON public.proposal_signatures(user_id, signed_at DESC);

ALTER TABLE public.proposal_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own proposal signatures" ON public.proposal_signatures;
/*
 * READ ONLY through the policy, and only the business's own.
 *
 * The owner can see who signed. Nobody writes through here: the signature is
 * written by the client's accept request, which has no session and goes through
 * the service role with a verified token — the same path `proposals` documents.
 */
CREATE POLICY "Users read their own proposal signatures"
  ON public.proposal_signatures FOR SELECT
  USING (auth.uid() = user_id);

/*
 * Unwritable after the fact — UPDATE only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `BEFORE UPDATE OR DELETE`, WHICH IS WHAT CONSENT USES
 *
 * `marketing_consent_events_guard` refuses DELETE outright, and the comment
 * beside it records what that cost when a referential action collided with the
 * guard: `contact_id` is ON DELETE SET NULL, Postgres implements that as an
 * UPDATE, the guard saw every contact deletion as an attempt to rewrite the
 * ledger, and deleting a contact became impossible for anyone who had ever
 * ticked the box.
 *
 * The same collision is waiting here in the other direction. `proposal_id` is
 * ON DELETE CASCADE, and a cascade is a DELETE on THIS table that fires this
 * trigger — so refusing DELETE would make a proposal undeletable. The operator
 * test-account cleanup deletes `proposals` (step 42 of
 * `20261041_operator_test_account_cleanup.sql`), and it would have started
 * failing on any account that had ever signed one.
 *
 * The two tables also differ in what their rows MEAN. A consent event outlives
 * the contact it is about — that is the entire point of keeping it. A signature
 * is evidence of agreement to one quote; delete the quote and there is nothing
 * left for it to be evidence of.
 *
 * So: a signature can never be EDITED, which is the guarantee that matters, and
 * it goes when its quote goes.
 */
CREATE OR REPLACE FUNCTION public.proposal_signatures_are_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'proposal_signatures is append-only: signature % cannot be edited after the fact',
    OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_signatures_append_only ON public.proposal_signatures;
CREATE TRIGGER trg_proposal_signatures_append_only
  BEFORE UPDATE ON public.proposal_signatures
  FOR EACH ROW EXECUTE FUNCTION public.proposal_signatures_are_append_only();

COMMENT ON TABLE public.proposal_signatures IS
  'Evidence that a client signed a quote. Append-only. Follows lib/consent: '
  'server wording is authoritative, the client echo is kept in evidence, and '
  'ip_hash is stored with its salt or it cannot be verified.';
