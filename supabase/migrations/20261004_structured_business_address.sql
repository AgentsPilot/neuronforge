-- A structured address for the business, beside the line it already shows
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- `business_profiles.address` is one free-text line — "the address this business
-- shows its clients", written however they write it. That was a deliberate
-- choice (see 20260906_business_contact_details.sql) and it served the display
-- case well.
--
-- What it cannot do is answer "which country is this business in". That question
-- now has consequences: which legal sentence goes on a refund email, which tax
-- rules apply, which currency to default to. A free-text line cannot be asked,
-- and the invoice address — the only structured one — is the BILLING address,
-- which a business may deliberately keep different.
--
-- So the display address gains parts, and the country among them is picked from
-- a real list rather than typed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE EXISTING COLUMN STAYS, AND STAYS POPULATED
--
-- Three places read `address` as a string and none of them should have to care
-- that it is now assembled:
--
--   lib/branding/publicBranding.ts   the public booking and contact pages
--   lib/website-builder/building-blocks.ts   the website's address block
--   lib/consent/privacyPolicy.ts     the generated policy
--
-- So `address` is kept as the rendered one-line form, composed from the parts
-- whenever they are saved. Nothing that reads it changes, and a business that
-- never opens its settings again keeps exactly the line it has today.
--
-- `address_parts` is the structured truth; `address` is its rendering. Where
-- they disagree — only possible for a row written before this migration — the
-- parts are empty and the line is authoritative, which is why nothing is
-- backfilled: splitting "2nd floor, above the bakery" into line1/city/postcode
-- is a guess, and a wrong guess here is printed on a public page.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS address_parts JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN business_profiles.address_parts IS
  'The display address in parts: {line1, line2, city, state, postal_code, country}. `country` is an ISO 3166-1 alpha-2 code chosen from a list, never typed. The `address` column holds the rendered one-line form of this and is what public surfaces read; it is composed on save, so the two do not drift. Empty on rows written before the structured form existed — there `address` alone is authoritative and must not be overwritten by a guess.';

COMMENT ON COLUMN business_profiles.address IS
  'The address this business shows its clients — where to come. Rendered from `address_parts` on save; still free text for rows that predate it. Distinct from invoice_address, which is the structured billing address printed on invoices and may deliberately differ.';
