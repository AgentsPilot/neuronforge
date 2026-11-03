-- Two facts about how an owner is already found, which onboarding asked and threw away.
--
-- ---------------------------------------------------------------------------
-- WHY `online_presence_mode` COULD NOT ANSWER EITHER OF THEM
--
-- `online_presence_mode` records what WE are asked to BUILD, and only that:
--
--   full_website   a website + online booking
--   website_only   a website
--   booking_only   a booking page, NOT a website
--   none           no website, can add one later
--
-- So the two owners who most need telling apart share one value. A business
-- keeping its own site and a business with no web presence at all are both
-- `booking_only`, because neither asked us to build anything. The comment on
-- `has_website` in app/api/onboarding/build/route.ts has said so for a while:
-- "Separate from the mode above… both share `booking_only`."
--
-- The consequence was on the dashboard. The readiness item that offers the
-- agent which reads enquiry email was gated on
-- `presence === 'booking_only' || presence === 'none'` — every owner who
-- declined our website. Half of that group has no website and so no form and
-- no enquiry email, and will never have any. They were offered an agent that
-- could not work for them, worded as though it already did.
--
-- ---------------------------------------------------------------------------
-- WHAT EACH COLUMN IS, AND WHY BOTH ARE NULLABLE
--
-- `has_website`            they have a site of their own, whoever built it.
-- `leads_arrive_by_email`  enquiries from it land in a mailbox we could read.
--
-- They are two questions because the second does not follow from the first. An
-- owner with their own site may take enquiries by phone, by WhatsApp, or
-- through a portal we cannot see. Asking one question and inferring the other
-- is what the old onboarding chip did — "I already have a website: read the
-- enquiries it emails me" — and an owner whose enquiries come by phone could
-- not tick it, so we lost the first fact in order to guess at the second.
--
-- NULL is a real and common answer on both: "never established". Every account
-- that onboarded before this migration has it, and so does any owner who was
-- never asked because they took a website from us. The dashboard must read
-- NULL as "wait rather than guess" — an offer suppressed is recoverable, an
-- offer made to somebody it cannot serve is not.
--
-- `leads_arrive_by_email` is asked ONLY where `has_website` is true. Where
-- `has_website` is false the second column stays NULL for good: there is no
-- site, so there is no site's mail to read.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS has_website BOOLEAN,
  ADD COLUMN IF NOT EXISTS leads_arrive_by_email BOOLEAN;

COMMENT ON COLUMN business_profiles.has_website IS
  'The owner has a website of their own, whoever built it. Set from the onboarding client_acquisition chip "I already have a website". DISTINCT FROM online_presence_mode, which records only what WE build: a business keeping its own site and one with no web presence at all both carry booking_only. NULL means never established — the common case for accounts that predate this column and for anyone who took a website from us. Read NULL as "do not offer", never as false.';

COMMENT ON COLUMN business_profiles.leads_arrive_by_email IS
  'Enquiries from the owner''s own site land in a mailbox. Asked as a follow-up ONLY where has_website is true, because it does not follow from it: an owner with their own site may take enquiries by phone or through a portal. TRUE is the one state that justifies offering the inbox-channel agent, which reads enquiry email; FALSE means offer the form smart link instead. NULL means never established and must suppress both offers rather than pick one.';
