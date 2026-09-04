-- The email and address a business publishes to its own clients.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The companion to `20260905_business_phone.sql`, for the same reason and with
-- the same shape. `business_profiles` had no public email at all, and no public
-- address: the only fields were in `website_content.contact`, a section of the
-- WEBSITE COPY editor.
--
-- So a business without a website — one reaching clients by booking link, which
-- is most of them — could not record either, and what was stored for the ones
-- that did have a website was frequently still the template's scaffolding
-- (`contact@yourbusiness.com`, `123 Main St`). The public pages consequently
-- had nothing trustworthy to show a client who wanted to email or find the
-- business.
--
-- ---------------------------------------------------------------------------
-- WHY `address` IS SEPARATE FROM `invoice_address`
--
-- `invoice_address` already exists and is structured
-- (`{line1, line2, city, state, postal_code, country}`). It is a BILLING
-- address: it appears on invoices, it is what the invoice-readiness check reads,
-- and for a business trading from home it is deliberately not the address it
-- wants clients turning up at.
--
-- This column is the address a client is shown — "where to come". For most
-- small businesses the two are the same string, which is why `invoice_address`
-- remains the fallback rather than being replaced. Nothing about
-- `invoice_address` changes here; it keeps its column, its readers and its
-- meaning.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN business_profiles.email IS
  'The email address this business publishes to its own clients. Shown on the public booking, intake, contact and invoice pages. Distinct from the account login email, which belongs to the user rather than to the business.';

COMMENT ON COLUMN business_profiles.address IS
  'The address this business shows its clients — where to come. Free text, because a display address is written the way the business writes it. Distinct from invoice_address, which is the structured billing address printed on invoices and may deliberately differ.';

-- Backfill from the website contact section, where a business already has one.
--
-- Placeholder values are deliberately NOT filtered here, exactly as in the
-- phone migration: the public pages run every contact detail through
-- `cleanPublicContact` at read time, so a template seed carried over is
-- suppressed where it matters while the owner still sees it in settings and can
-- correct it. Filtering in SQL would discard it silently and leave the field
-- looking empty to someone who believes they filled it in.
UPDATE business_profiles bp
SET
  email   = COALESCE(bp.email,   NULLIF(TRIM(wc.contact ->> 'email'), '')),
  address = COALESCE(bp.address, NULLIF(TRIM(wc.contact ->> 'address'), ''))
FROM website_content wc
WHERE wc.user_id = bp.user_id
  AND (bp.email IS NULL OR bp.address IS NULL)
  AND (
    NULLIF(TRIM(wc.contact ->> 'email'), '') IS NOT NULL
    OR NULLIF(TRIM(wc.contact ->> 'address'), '') IS NOT NULL
  );
