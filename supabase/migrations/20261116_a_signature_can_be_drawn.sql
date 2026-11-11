/*
 * A signature the client draws, beside the name they type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DRAWING IS NOT THE EVIDENCE. IT IS WHAT MAKES IT READ AS A CONTRACT.
 *
 * Worth stating plainly, because it is easy to assume otherwise: a drawn mark
 * is not stronger evidence than a typed name. Nothing verifies it against a
 * specimen, and nobody here is a handwriting examiner. What makes an electronic
 * signature binding is intent, attribution, and a record that cannot be altered
 * afterwards — which `proposal_signatures` already provides through the
 * `lib/consent` model it was built on.
 *
 * What a drawing adds is that a client in the trades EXPECTS one. A renovation
 * quote closed with a typed name reads like a web form; the same quote closed
 * with a signature reads like a contract, and that difference closes jobs.
 *
 * So both are kept, and neither replaces the other:
 *
 *   signed_name      the legible record. It is what the booking tab names on
 *                    the row, what a report lists, what a search finds and what
 *                    a dispute reads. A squiggle answers none of those.
 *   signature_image  the mark. It is what appears on the PDF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NULLABLE IN THE SCHEMA, REQUIRED IN THE FLOW
 *
 * The column allows NULL and the application does not: when a quote asks for a
 * signature, the client types a name AND draws, and the route refuses an accept
 * that is missing either.
 *
 * The constraint is not tightened to match, deliberately. A NOT NULL here would
 * make this column impossible to add to any signature taken before it existed,
 * and would turn a future flow that legitimately has no drawing — a signature
 * relayed by phone, a countersignature, an import — into a migration rather
 * than a decision.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COLUMN AND NOT THE BUCKET
 *
 * A trimmed signature PNG is 5–20KB. `contact-documents` is for files a person
 * chose to attach and later browses; this is one field of one row, written once
 * and read with it. Storage would mean an object whose lifetime has to be
 * managed against a row that is already append-only and already cascades —
 * work, for a thing that fits in a column.
 */

ALTER TABLE public.proposal_signatures
  ADD COLUMN IF NOT EXISTS signature_image text;

ALTER TABLE public.proposal_signatures
  DROP CONSTRAINT IF EXISTS proposal_signatures_image_is_a_png;

ALTER TABLE public.proposal_signatures
  ADD CONSTRAINT proposal_signatures_image_is_a_png CHECK (
    signature_image IS NULL
    OR (
      signature_image LIKE 'data:image/png;base64,%'
      /*
       * ~256KB of base64. A drawn signature is 5-20KB, so this is far above
       * anything real and far below what a hostile client could otherwise put
       * in a row that can never be edited or deleted.
       */
      AND length(signature_image) <= 350000
    )
  );

COMMENT ON COLUMN public.proposal_signatures.signature_image IS
  'The drawn mark, as a PNG data URI. `signed_name` is the record; this is what '
  'the PDF shows. Not evidence in itself — see the migration header.';

/*
 * `method` now has two values, so it is worth constraining.
 *
 * It was free text with a default. Naming the values stops a third spelling of
 * the same thing appearing the first time anyone adds a path, which is the same
 * reason `DECLINE_REASONS` is a shared constant rather than a literal in two
 * files.
 *
 * `typed_name` is kept rather than renamed: it is what every row written before
 * this says, and a rename would need a backfill to buy nothing.
 */
ALTER TABLE public.proposal_signatures
  DROP CONSTRAINT IF EXISTS proposal_signatures_method_is_known;

ALTER TABLE public.proposal_signatures
  ADD CONSTRAINT proposal_signatures_method_is_known CHECK (
    method IN ('typed_name', 'drawn')
  );
