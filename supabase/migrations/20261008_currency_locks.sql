-- Once money exists in a currency, that currency stops being editable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- Changing a currency does not convert anything. It RELABELS: 300 stays 300,
-- so USD → ILS on a priced service is a 73% price cut nobody typed, and on a
-- business it silently restates every total that was already stated.
--
-- History cannot follow. An invoice issued in dollars is a dollar invoice — it
-- has been sent, a client has it, and no later setting can make it otherwise.
-- So a change after money exists does not correct anything; it fractures the
-- reports, and the platform has no FX rate with which to put them back
-- together. `revenueByCurrency` can only ever keep the halves apart.
--
-- This is the settled answer elsewhere too: Xero and QuickBooks fix the base
-- currency at setup and never allow a change; Shopify allows it freely until
-- the first order and locks it after.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IS LOCKED, AND WHAT DELIBERATELY IS NOT
--
-- CHANGING a currency is locked. RECORDING one for the first time is not.
--
-- That distinction is load-bearing. `business_profiles.currency` was added only
-- in 20261004, so every existing account has NULL — and several already have
-- invoices. A lock keyed on "money exists" would mean those businesses could
-- never state their currency at all, which is the opposite of the intent.
--
-- So: NULL → 'ILS' is always allowed, whatever the history. 'ILS' → 'USD' is
-- refused once money exists.
--
-- A business that genuinely rebases creates new services rather than mutating
-- old ones. The old service keeps its history coherent, which is the thing
-- being protected.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY TRIGGERS RATHER THAN A CHECK IN THE ROUTE
--
-- Because the writes do not all go through a route. The Settings currency
-- picker writes `business_profiles` straight from the browser, the chat
-- executor updates services, and the plugin executor does too. A rule enforced
-- in one of those is a rule three others do not know about.
--
-- Same reasoning as `refund_guard_before` in 20260828b, which guards refunds at
-- the database for the same reason: "an application-level check is a race and
-- cannot be made correct."
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The business's own currency ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION business_currency_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  /*
   * Nothing to guard unless an existing choice is being REPLACED.
   *
   * Clearing it (→ NULL) is allowed too. It removes a default; it does not
   * restate anything, and the platform simply falls back to deriving one as it
   * did before the column existed. Refusing that would leave an owner with no
   * way back at all, which is a lock rather than a guard.
   */
  IF OLD.currency IS NULL
     OR NEW.currency IS NULL
     OR NEW.currency IS NOT DISTINCT FROM OLD.currency THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM payment_invoices     WHERE user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM payment_transactions WHERE user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM proposals            WHERE user_id = OLD.user_id)
  THEN
    RAISE EXCEPTION
      'Cannot change the business currency from % to %: money already exists in %. '
      'Changing it would relabel history rather than convert it.',
      OLD.currency, NEW.currency, OLD.currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_business_currency_lock ON business_profiles;
CREATE TRIGGER trg_business_currency_lock
  BEFORE UPDATE OF currency ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION business_currency_lock();

-- ── 2. A service's currency ──────────────────────────────────────────────────
--
-- Scoped to THAT service's own money, not the business's. A business may still
-- add a service in another currency — pricing a US client in USD from Israel is
-- the case this whole design exists to keep working. What it may not do is move
-- a service that has already been sold.
CREATE OR REPLACE FUNCTION service_currency_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- `scheduling_services.currency` is NOT NULL, so only a genuine change gets
  -- this far; the NULL arms are kept for symmetry with the business guard.
  IF OLD.currency IS NULL
     OR NEW.currency IS NULL
     OR NEW.currency IS NOT DISTINCT FROM OLD.currency THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM payment_invoices     WHERE service_id = OLD.id)
     OR EXISTS (SELECT 1 FROM payment_transactions WHERE service_id = OLD.id)
     OR EXISTS (SELECT 1 FROM scheduling_bookings  WHERE service_id = OLD.id)
     OR EXISTS (SELECT 1 FROM proposals            WHERE service_id = OLD.id)
  THEN
    RAISE EXCEPTION
      'Cannot change the currency of "%" from % to %: it has already been sold in %. '
      'The price would be relabelled, not converted. Add a new service instead.',
      OLD.service_name, OLD.currency, NEW.currency, OLD.currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_currency_lock ON scheduling_services;
CREATE TRIGGER trg_service_currency_lock
  BEFORE UPDATE OF currency ON scheduling_services
  FOR EACH ROW EXECUTE FUNCTION service_currency_lock();

COMMENT ON FUNCTION business_currency_lock() IS
  'Refuses a CHANGE to business_profiles.currency once the account has invoices, transactions or '
  'proposals. Setting it for the first time (NULL → a value) is always allowed, so accounts that '
  'predate the column can still state their currency; clearing it (→ NULL) is allowed too, since '
  'that removes a default rather than restating history.';

COMMENT ON FUNCTION service_currency_lock() IS
  'Refuses a CHANGE to a service''s currency once that service has been invoiced, paid, booked or '
  'quoted. Scoped to the service, not the business: adding a service in another currency stays '
  'allowed, because pricing one client in their own currency is a supported case.';
