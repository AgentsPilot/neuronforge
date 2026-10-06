-- An address book for the business, instead of two fixed slots
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- A business had exactly two addresses, because it had exactly two columns:
-- `business_profiles.address_parts` (what clients are shown) and
-- `business_profiles.invoice_address` (what goes on an invoice). Everything
-- wrong with the address UI follows from that shape:
--
--   · The picker offers "the OTHER column", so its option is labelled by slot
--     — "כתובת לחיוב" — rather than being an address the owner recognises and
--     named. Amazon lists addresses; this listed a storage location.
--
--   · The two drift. One account has the same street in both, with a state in
--     one and none in the other, because the State field was fixed after one of
--     them was last saved. There is no single record to correct, so correcting
--     one leaves the other stale and the screen contradicting itself.
--
--   · "Use the most recently updated address" is unanswerable. Both columns sit
--     in ONE row behind ONE `updated_at`, so nothing can tell which was edited
--     last.
--
--   · Only ever one alternative can be offered, because there is only one other
--     column to offer.
--
-- One row per address fixes all four: addresses get identity, a name, and a
-- default; a profile and an invoice can point at the SAME one and so follow it
-- when it is corrected, or at different ones deliberately.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE OLD COLUMNS STAY, AND STAY POPULATED
--
-- Seventeen files read `address_parts` or `invoice_address` — the invoice PDF,
-- the public booking and contact pages, the generated privacy policy, Stripe
-- Connect onboarding, the readiness checks. None of them should have to learn
-- about a table to render an address they already read correctly.
--
-- So the columns remain the rendered truth for readers, and the repository
-- writes them alongside the book on every save. The pointers added below say
-- WHICH address each one is a copy of; the copy is what gets read.
--
-- Same arrangement `20261004_structured_business_address.sql` already chose for
-- `address` and `address_parts`, and for the same reason.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  /* The six structured parts, same shape as `business_profiles.address_parts`:
     {line1, line2, city, state, postal_code, country}. `country` is ISO 3166-1
     alpha-2, chosen from a list and never typed — it is what the refund
     disclaimer, the tax rules and the State field all reason about. */
  parts jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* The owner's own name for it — "the studio", "accountant". NULL until they
     give one, and the rendered address is the label until then: an address book
     whose entries must be named before they can be saved is a worse address
     book. */
  label text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_addresses_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.business_addresses IS
  'Addresses a business has saved, one row each. A profile or an invoice points at one via business_profiles.address_id / invoice_address_id, and keeps a denormalised copy in address_parts / invoice_address which is what every reader actually renders. Pointing two uses at one row is how an address corrected once is corrected everywhere.';

COMMENT ON COLUMN public.business_addresses.parts IS
  'The structured address: {line1, line2, city, state, postal_code, country}. `country` is an ISO 3166-1 alpha-2 code. `state` is empty for the many countries whose addresses carry no administrative area — see lib/geo/addressFormat.ts, which reads Google''s libaddressinput metadata to decide whether the field exists at all.';

COMMENT ON COLUMN public.business_addresses.is_default IS
  'The one offered first when a form has no address of its own. At most one per owner, enforced by business_addresses_one_default_idx.';

COMMENT ON COLUMN public.business_addresses.updated_at IS
  'Set by the repository on every update. There is no trigger.';

/* The book, newest first — how the picker lists it. */
CREATE INDEX business_addresses_user_idx
  ON public.business_addresses (user_id, created_at DESC);

/*
 * At most one default per owner, enforced rather than trusted.
 *
 * A partial unique index rather than application logic: "set this one as
 * default" is two writes (clear the old, set the new) and a failure between
 * them would leave an owner with two defaults and a picker that silently picks
 * whichever sorted first.
 */
CREATE UNIQUE INDEX business_addresses_one_default_idx
  ON public.business_addresses (user_id)
  WHERE is_default;

ALTER TABLE public.business_addresses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_addresses FROM PUBLIC;
REVOKE ALL ON TABLE public.business_addresses FROM anon;
REVOKE ALL ON TABLE public.business_addresses FROM authenticated;
REVOKE ALL ON TABLE public.business_addresses FROM service_role;

/* Reached only through the repository, which scopes every query by `user_id`
   (CLAUDE.md rule 1 and 4). No direct client access: an address is business
   contact detail, and the public surfaces are served the rendered copy. */
GRANT SELECT, INSERT, DELETE ON TABLE public.business_addresses TO service_role;
GRANT UPDATE (parts, label, is_default, updated_at) ON TABLE public.business_addresses TO service_role;

-- ── Which address each use points at ─────────────────────────────────────────

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES public.business_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_address_id uuid REFERENCES public.business_addresses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.business_profiles.address_id IS
  'Which saved address `address_parts` is a copy of. NULL means the address was typed here and never added to the book, which is allowed — the copy is still what renders. ON DELETE SET NULL: removing an address from the book must not blank the address a business is currently showing its clients.';

COMMENT ON COLUMN public.business_profiles.invoice_address_id IS
  'Which saved address `invoice_address` is a copy of. Equal to `address_id` when the business bills from where it trades, which is the common case and is what makes correcting one correct both.';

CREATE INDEX IF NOT EXISTS business_profiles_address_id_idx
  ON public.business_profiles (address_id);
CREATE INDEX IF NOT EXISTS business_profiles_invoice_address_id_idx
  ON public.business_profiles (invoice_address_id);

-- ── Backfill: the two columns become the first entries in the book ───────────

/*
 * Normalised so an address stored twice is recognised as one.
 *
 * The common case is a business whose invoice address IS its trading address,
 * saved through two different forms. Inserting both would put the same street
 * in the book twice and reintroduce the drift this migration exists to end —
 * so they are compared on the six parts, trimmed and case-folded, exactly as
 * `sameAddress` in SavedAddressPicker compares them on screen.
 *
 * Deliberately NOT tolerant of a missing part: an address with a state and the
 * same address without one are two different rows here, because they are two
 * different addresses and one of them is wrong. Merging them would pick a
 * winner silently, and the wrong pick is printed on an invoice.
 */
CREATE OR REPLACE FUNCTION pg_temp.address_key(a jsonb) RETURNS text AS $$
  SELECT lower(btrim(coalesce(a->>'line1', ''))) || E'\n'
      || lower(btrim(coalesce(a->>'line2', ''))) || E'\n'
      || lower(btrim(coalesce(a->>'city', ''))) || E'\n'
      || lower(btrim(coalesce(a->>'state', ''))) || E'\n'
      || lower(btrim(coalesce(a->>'postal_code', ''))) || E'\n'
      || lower(btrim(coalesce(a->>'country', '')));
$$ LANGUAGE sql IMMUTABLE;

/* Something in it, by the same rule `hasAddressContent` applies in the app:
   a street, a city or a country. An empty slot contributes no entry. */
CREATE OR REPLACE FUNCTION pg_temp.has_address(a jsonb) RETURNS boolean AS $$
  SELECT coalesce(btrim(a->>'line1'), '') <> ''
      OR coalesce(btrim(a->>'city'), '') <> ''
      OR coalesce(btrim(a->>'country'), '') <> '';
$$ LANGUAGE sql IMMUTABLE;

/* The trading address first, so it takes the default. It is the one shown on
   the booking page, the contact page and the invoice, and the one a business
   would name if asked for "its" address. */
WITH inserted_profile AS (
  INSERT INTO public.business_addresses (user_id, parts, is_default)
  SELECT p.user_id, p.address_parts, true
  FROM public.business_profiles p
  WHERE pg_temp.has_address(p.address_parts)
  RETURNING id, user_id, parts
)
UPDATE public.business_profiles p
SET address_id = i.id
FROM inserted_profile i
WHERE p.user_id = i.user_id;

/* The invoice address, only where it is genuinely a different address. Where it
   is the same, the profile's row is pointed at twice — which is the whole
   point: one record, two uses, corrected once. */
WITH inserted_invoice AS (
  INSERT INTO public.business_addresses (user_id, parts, is_default)
  SELECT p.user_id, p.invoice_address, false
  FROM public.business_profiles p
  WHERE pg_temp.has_address(p.invoice_address)
    AND (
      NOT pg_temp.has_address(p.address_parts)
      OR pg_temp.address_key(p.invoice_address) <> pg_temp.address_key(p.address_parts)
    )
  RETURNING id, user_id, parts
)
UPDATE public.business_profiles p
SET invoice_address_id = i.id
FROM inserted_invoice i
WHERE p.user_id = i.user_id;

/* And where it was the same, point it at the row already written. */
UPDATE public.business_profiles p
SET invoice_address_id = p.address_id
WHERE p.invoice_address_id IS NULL
  AND p.address_id IS NOT NULL
  AND pg_temp.has_address(p.invoice_address)
  AND pg_temp.address_key(p.invoice_address) = pg_temp.address_key(p.address_parts);

/*
 * A business with ONLY an invoice address still needs a default, or its picker
 * opens with nothing offered — the empty-form case this book is meant to serve.
 *
 * EXACTLY ONE ROW PER OWNER, via `DISTINCT ON`. A plain
 * `UPDATE … WHERE NOT EXISTS (… is_default)` reads the pre-update state for
 * every candidate row at once, so an owner holding two addresses and no default
 * would have BOTH set true — and `business_addresses_one_default_idx` would
 * then abort this migration. The index catching it is the system working; the
 * statement handing it two was the bug.
 */
WITH needs_default AS (
  SELECT DISTINCT ON (a.user_id) a.id
  FROM public.business_addresses a
  WHERE NOT EXISTS (
    SELECT 1 FROM public.business_addresses d
    WHERE d.user_id = a.user_id AND d.is_default
  )
  ORDER BY a.user_id, a.created_at
)
UPDATE public.business_addresses a
SET is_default = true
FROM needs_default n
WHERE a.id = n.id;

COMMIT;
