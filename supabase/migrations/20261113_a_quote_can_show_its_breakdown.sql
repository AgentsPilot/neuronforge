/*
 * A quote can carry a breakdown, and can ask to be signed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRUCTURE DOES NOT CHANGE
 *
 * `20260913_proposals.sql:6-14` says "one total and a description. No line
 * items, no cost breakdown." That rule still holds for the SHAPE of a proposal:
 * `total` remains the single authoritative figure, one number in its own
 * column, and it is what every reader on the platform acts on — the expiry
 * sweep, the reminder and its cooldown, quote chasing, the acceptance-rate
 * detector, `splitTotal`, the invoice, the money page, the client portal.
 *
 * None of them reads `content`. A chaser cannot tell a quote with a breakdown
 * from one without, which is the design rather than a happy accident.
 *
 * What changes is that an owner who wants to can now EXPLAIN that number: a
 * contractor pricing a renovation lists the phases, their dates and what each
 * one covers. A therapist selling ten sessions never opens it and sees no
 * difference at all.
 *
 * Decided 2026-11-10. Plan: docs/workplans/PROPOSAL_DOCUMENT_BUILDER_WORKPLAN.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTH COLUMNS ARE NULLABLE / DEFAULTED
 *
 * 46 proposals exist. Every one of them must keep rendering, sending, being
 * accepted and being chased exactly as it does today, which NULL `content`
 * gives for free: the document section is omitted rather than drawn empty, and
 * `total` stays the number the owner typed.
 *
 * `requires_signature` defaults FALSE for the same reason — the accept path
 * for an existing quote must not acquire a gate retroactively.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT `content` HOLDS
 *
 *   {
 *     "v": 1,
 *     "overview": ReplyBlock[],          -- mirrors `description`
 *     "items": [{
 *        "id":        "it_1",
 *        "date":      "2026-11-24" | null,   -- DELIVERY, never a payment date
 *        "label":     "פירוק ותשתיות",
 *        "qty":       1,
 *        "unitPrice": 2727.27,
 *        "body":      ReplyBlock[]           -- the per-item description
 *     }],
 *     "tax": { "rate": 10, "label": "מע״מ", "inclusive": false }
 *   }
 *
 * `ReplyBlock` is the restricted block model from lib/business-os/mail/replyBody.ts
 * — paragraphs and list items made of runs carrying at most bold, italic and a
 * link. It is stored rather than HTML for the reason that module's header
 * gives: nothing an owner types is ever interpreted as markup, so the question
 * is "can the renderer emit anything unexpected" rather than "did we sanitise
 * it correctly".
 *
 * `tax` is COPIED from the business profile when the draft is written, exactly
 * as `tax_rate` / `tax_label` / `prices_include_tax` already are on this table,
 * so a later change to the profile cannot restate what a sent quote said.
 *
 * Deliberately NOT a child table. The items are one document, written and read
 * together, never queried across, and they must freeze into
 * `accepted_snapshot` as a unit. Rows would buy nothing and would have to be
 * kept consistent through every supersede and stop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS content jsonb,
  ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.proposals.content IS
  'Optional line-item document explaining `total`. NULL = priced only, which is '
  'every proposal written before 2026-11-10. Never read by chasers, crons or '
  'detectors; see docs/workplans/PROPOSAL_DOCUMENT_BUILDER_WORKPLAN.md';

COMMENT ON COLUMN public.proposals.requires_signature IS
  'When true the client must type their name and agree before Approve enables. '
  'Declining is never gated. Independent of `content` — a package quote with no '
  'document can still require a signature.';

/*
 * `content` IS JSON, NOT A FILE.
 *
 * Worth saying in the schema, because three different things in this feature
 * get called "the document" in conversation and only one of them is stored:
 *
 *   proposals.content      JSON, this column. The breakdown itself.
 *   the PDF                rendered from that JSON on demand, never stored.
 *   contact_documents      real uploaded files — images, drawings, a spec
 *                          sheet — in the `contact-documents` bucket, exactly
 *                          as they are today.
 *
 * The letterhead is in none of them: it is read live from `business_profiles`
 * when the page or the PDF is rendered, so an owner who changes their address
 * does not have to reissue anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The breakdown must add up to the figure it explains.
 *
 * Enforced in the route as well, which is where the arithmetic is done and
 * where a mismatch can be reported to the owner. This is the floor underneath
 * that: a direct write — a migration, a repair script, a future chat tool —
 * cannot leave a document whose items contradict the total the client is being
 * asked to approve.
 *
 * Shape only. Postgres is not asked to re-add the items; it is asked to refuse
 * a `content` that is not the object this column is documented to hold.
 */
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_content_shape;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_content_shape CHECK (
    content IS NULL
    OR (
      jsonb_typeof(content) = 'object'
      AND jsonb_typeof(content -> 'items') = 'array'
      /* Zero items is not a document: `total` could not be derived from it. */
      AND jsonb_array_length(content -> 'items') >= 1
      AND jsonb_array_length(content -> 'items') <= 60
    )
  );

/*
 * No index.
 *
 * `content` is read by exactly two surfaces, both of which already have the
 * proposal row in hand: the document renderer and the PDF. Slice 7 scans an
 * owner's accepted proposals to offer them back, and across the whole platform
 * that is 46 rows. A GIN index here would be maintained on every write to earn
 * nothing.
 */
