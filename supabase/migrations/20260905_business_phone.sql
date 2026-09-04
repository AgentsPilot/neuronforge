-- The phone number a business's own clients call.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The platform had nowhere to store one. `business_profiles` carries the
-- company name, logo, language, theme and address-for-invoices, but no phone;
-- the only phone field in the product lived in `website_content.contact`, a
-- section of the WEBSITE COPY editor.
--
-- That had three consequences:
--
--   * A business without a website — one reaching clients by booking link,
--     which is most of them — had no way to record a phone number at all.
--   * The field that did exist is scaffolded by the website templates with
--     example values (`+1 (555) 123-4567`), and most owners never replace them,
--     so what was stored was frequently not a real number.
--   * The public pages a client actually reads — the booking they are managing,
--     the invoice they are paying — could not offer a way to call the business,
--     because there was no trustworthy value to offer. A client opening their
--     appointment on the morning of it could not find a number.
--
-- A phone number is a property of the BUSINESS, like its logo and its
-- subdomain, not a property of one web page's copy. This is where it lives.
-- `website_content.contact.phone` stays as the website's own display copy and
-- as the fallback for accounts that already filled it in there.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN business_profiles.phone IS
  'The phone number this business publishes to its own clients. Shown on the public booking, intake, contact and invoice pages, and used to derive a WhatsApp link. Stored in international format (leading +) wherever the owner provides one; a number without a country code is still shown but cannot become a WhatsApp link.';

-- Backfill from the website contact section, where a business already has one.
--
-- Placeholder values are deliberately NOT filtered here. The public pages run
-- every contact detail through `cleanPublicContact` at read time, which rejects
-- the template seeds and 555 numbers — so a placeholder carried over is
-- suppressed where it matters, while the owner still sees it in settings and
-- can correct it. Filtering in SQL would instead silently discard it and leave
-- the field looking empty for someone who believes they filled it in.
UPDATE business_profiles bp
SET phone = NULLIF(TRIM(wc.contact ->> 'phone'), '')
FROM website_content wc
WHERE wc.user_id = bp.user_id
  AND bp.phone IS NULL
  AND NULLIF(TRIM(wc.contact ->> 'phone'), '') IS NOT NULL;
