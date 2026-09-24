-- The currency a business works in, as a DEFAULT — not as a constraint.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE COLUMN DID NOT EXIST, AND WHAT THAT COST
--
-- Settings has had a Currency dropdown for a long time. It never saved.
-- `LanguageContext.setCurrency` writes `localStorage` and nothing else, while
-- `setLanguage` two lines above it calls `syncLanguageToDatabase` — so an owner
-- picked shekels on their laptop, opened their phone, and everything was
-- dollars again. Two people on one account saw different symbols.
--
-- It could not save, because there was nowhere to put it: neither
-- `business_profiles.currency` nor `user_preferences.currency` exists. The repo
-- type declares `currency` on BusinessProfile and hardcodes it to null, with a
-- comment admitting no migration defines it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A DEFAULT, NOT A CONSTRAINT
--
-- `scheduling_services.currency` stays the authority for what a client is
-- actually charged, and that is deliberate: a business operating from Israel
-- can price and charge a US client in USD. This column only pre-fills the
-- picker when a service is created, and labels figures that have no row behind
-- them — a sum, an average. It must never narrow what a service may be set to.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NULLABLE, AND WITH NO DEFAULT, ON PURPOSE
--
-- Null means NOT CHOSEN, and that distinction has to survive.
--
-- `user_preferences.timezone` is the cautionary tale: it defaults to 'UTC', so
-- `resolveBusinessTimezone` cannot tell an account that deliberately chose UTC
-- from one that has never been asked. The daily briefing reads that as a
-- decision and mails a never-configured account at 07:00 UTC, while the two
-- backfill scripts read the same value as "an unanswered question". Both
-- behaviours are defensible and they disagree, which is what an overloaded
-- default buys you.
--
-- So no DEFAULT here. An account that has not answered stays null and keeps
-- resolving exactly as it does today, through the existing derivation.
--
-- NO BACKFILL, for the same reason: writing a derived value would record a
-- choice nobody made, and nothing would ever think to ask again.
--
-- The CHECK matches `scheduling_services`, so the two cannot disagree about
-- what a valid currency is.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS currency TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_currency_check'
  ) THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT business_profiles_currency_check
      CHECK (currency IS NULL OR currency IN ('USD', 'EUR', 'ILS', 'GBP'));
  END IF;
END $$;

COMMENT ON COLUMN business_profiles.currency IS
  'The business''s DEFAULT currency: pre-fills the picker when a service is created and labels '
  'figures with no row behind them. Never a constraint — scheduling_services.currency remains the '
  'authority for what a client is charged, so a business in one country can price in another''s '
  'currency. NULL means not chosen, which is deliberate and must stay distinguishable from a choice.';
