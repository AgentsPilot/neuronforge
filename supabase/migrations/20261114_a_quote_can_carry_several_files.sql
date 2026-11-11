/*
 * A quote can carry several files, not one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `proposals.document_id` IS KEPT, AND STILL HONOURED
 *
 * It is not deprecated, not backfilled and not dropped. Three live quotes carry
 * one, and they go on working exactly as they do — the reader is a single
 * helper, `lib/business-os/proposals/attachmentsFor.ts`, which returns that
 * column first and then these rows. No caller has to know which era a quote
 * comes from.
 *
 * A backfill was considered and rejected: moving three rows into a new table
 * to make the old column redundant is a write against live data that buys
 * nothing a `coalesce` in one function does not already buy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The owner's own files — photographs of the site, a drawing, a spec sheet, a
 * PDF they already had. Distinct from the two other things this feature calls
 * a document:
 *
 *   proposals.content   JSON. The breakdown the owner built here.
 *   the PDF             the quote itself, rendered on demand, never stored.
 *   THIS                files the owner uploaded, in `contact-documents`.
 *
 * Which is why the join is to `contact_documents` rather than a new store: the
 * bucket, its mime allowlist, its 50MB ceiling, its RLS and its signed-URL
 * reader all exist and already hold this business's paperwork.
 *
 * Plan: docs/workplans/PROPOSAL_DOCUMENT_BUILDER_WORKPLAN.md (Slice 4)
 */

CREATE TABLE IF NOT EXISTS public.proposal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  /*
   * ON DELETE CASCADE, deliberately: `proposals.document_id` uses SET NULL
   * because the quote survives its file, and so does a quote here — what does
   * not survive is a JOIN ROW pointing at a document that no longer exists.
   */
  document_id uuid NOT NULL REFERENCES public.contact_documents(id) ON DELETE CASCADE,
  /* Denormalised so RLS can be stated on this row alone, without a join. */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  /** The order the owner arranged them in. */
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  /* The same file twice on one quote is a mistake, not an intention. */
  UNIQUE (proposal_id, document_id)
);

-- Every read is "the files on this quote, in order". There is no other query.
CREATE INDEX IF NOT EXISTS idx_proposal_attachments_proposal
  ON public.proposal_attachments(proposal_id, position);

ALTER TABLE public.proposal_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own proposal attachments" ON public.proposal_attachments;
CREATE POLICY "Users manage their own proposal attachments"
  ON public.proposal_attachments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- The client's quote page reads through the service role with a signed token,
-- never through this policy — it has no session. Same as `proposals`.

COMMENT ON TABLE public.proposal_attachments IS
  'Files the owner attached to a quote. `proposals.document_id` holds the first '
  'one for quotes written before 2026-11-10 and is still honoured; read both '
  'through lib/business-os/proposals/attachmentsFor.ts, never directly.';
