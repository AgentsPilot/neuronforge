-- =====================================================
-- Marketing consent
--
-- Six public surfaces collect contacts and not one of them asks for permission
-- to market to those people. This adds the record that permission needs.
--
-- Why a ledger and not a boolean on crm_contacts:
--
--   1. A boolean cannot produce the SENTENCE someone agreed to. GDPR Art. 7(1)
--      asks the controller to demonstrate consent, and demonstrating it means
--      showing the exact wording, in the language it was shown in.
--   2. A boolean has no history. grant -> withdraw -> grant leaves one bit and
--      no audit trail, and the question asked eighteen months later is "what
--      did they agree to, when, and did they ever withdraw".
--   3. crm_contacts is resettable. email_unsubscribes was deliberately exempted
--      from the business reset (see lib/business-os/purge/descriptors.ts) with
--      the note "deleting this would resume emailing people who opted out".
--      Consent has exactly that lifetime.
--   4. crm_contacts has NO unique constraint on (user_id, email), so the same
--      person can exist twice. Consent attaches to an ADDRESS, not to a row;
--      keyed on contact_id, a duplicate row would be an unconsented row.
--
-- Shape: an append-only event ledger holding the evidence, plus a small state
-- table maintained by trigger that the send gate reads. The projection exists
-- because the gate runs per recipient inside a fan-out, and a per-recipient
-- "latest decision" scan is not viable under a serverless timeout.
-- =====================================================

-- =====================================================
-- 1. Consent events — the evidence ledger. Append-only.
-- =====================================================
CREATE TABLE IF NOT EXISTS marketing_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- SET NULL, not CASCADE: consent outlives the CRM row, exactly as an
  -- unsubscribe does. Deleting a contact must not make them mailable again.
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,

  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms', 'whatsapp', 'phone')),
  purpose TEXT NOT NULL DEFAULT 'marketing'
    CHECK (purpose IN ('marketing')),

  decision TEXT NOT NULL CHECK (decision IN ('granted', 'withdrawn')),

  -- HOW, in the Art. 7(1) sense.
  method TEXT NOT NULL CHECK (method IN (
    'web_form', 'double_optin_confirm', 'unsubscribe_link', 'list_unsubscribe',
    'owner_entered', 'imported', 'reply_stop', 'legacy_unsubscribe_import'
  )),

  -- WHAT WORDING, verbatim, in the language it was shown in.
  statement_text TEXT,
  statement_locale TEXT,
  statement_version INT,
  privacy_policy_url TEXT,

  -- WHERE, and the circumstantial evidence.
  source_surface TEXT,
  source_page_url TEXT,
  ip_hash TEXT,
  -- Without the salt the hash proves nothing: hashIP salts with the calendar
  -- day, so the same address hashes differently tomorrow and the stored value
  -- is unverifiable. See lib/utils/attribution.ts.
  ip_hash_salt TEXT,
  user_agent TEXT,
  session_id TEXT,

  -- WHO recorded it, where a human did.
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Set by the erasure path only. The decision itself never disappears.
  redacted_at TIMESTAMPTZ,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The load-bearing line in this file: an opt-in with no record of what was
  -- agreed to is not storable at all.
  CONSTRAINT marketing_consent_grant_has_wording CHECK (
    decision <> 'granted'
    OR (statement_text IS NOT NULL
        AND length(btrim(statement_text)) > 0
        AND statement_locale IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mce_user_email
  ON marketing_consent_events(user_id, email_normalized, channel);
CREATE INDEX IF NOT EXISTS idx_mce_contact
  ON marketing_consent_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_mce_occurred
  ON marketing_consent_events(user_id, occurred_at DESC);

ALTER TABLE marketing_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own consent events" ON marketing_consent_events;
CREATE POLICY "Users can view their own consent events"
  ON marketing_consent_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own consent events" ON marketing_consent_events;
CREATE POLICY "Users can insert their own consent events"
  ON marketing_consent_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE and no DELETE policy, deliberately. RLS is default-deny.

-- RLS does not constrain the service role, and every write path here runs on
-- supabaseServer. The trigger is what actually makes this table append-only.
CREATE OR REPLACE FUNCTION marketing_consent_events_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'marketing_consent_events is append-only (attempted DELETE of %)', OLD.id;
  END IF;

  /*
   * The foreign key's OWN action, which arrives here as an UPDATE.
   *
   * `contact_id` is ON DELETE SET NULL precisely so consent outlives the CRM
   * row. Postgres implements that by UPDATEing this table, so the guard saw
   * every contact deletion as an attempt to rewrite the ledger and refused it —
   * which made deleting a contact impossible for anyone who had ever ticked
   * the box.
   *
   * Permitted only in the exact shape the referential action produces: every
   * other column identical, and contact_id going to NULL. Compared as jsonb
   * rather than column by column, so a column added later is covered by
   * default instead of silently falling outside the check.
   *
   * `email_normalized` is excluded because it is GENERATED ALWAYS AS STORED,
   * and a generated column is computed AFTER before-row triggers run — so it
   * reads NULL in NEW here while holding its value in OLD. Left in, the two
   * sides could never compare equal and this branch would never fire, which is
   * precisely how this went out broken the first time. Excluding it costs
   * nothing: it is derived from `email`, which IS compared.
   */
  IF NEW.contact_id IS NULL
     AND OLD.contact_id IS NOT NULL
     AND (to_jsonb(NEW) - 'contact_id' - 'email_normalized')
       = (to_jsonb(OLD) - 'contact_id' - 'email_normalized')
  THEN
    RETURN NEW;
  END IF;

  -- The one permitted deliberate mutation: erasure redaction. PII out,
  -- decision intact.
  IF OLD.redacted_at IS NOT NULL
     OR NEW.redacted_at IS NULL
     OR NEW.decision       IS DISTINCT FROM OLD.decision
     OR NEW.occurred_at    IS DISTINCT FROM OLD.occurred_at
     OR NEW.method         IS DISTINCT FROM OLD.method
     OR NEW.statement_text IS DISTINCT FROM OLD.statement_text
     OR NEW.user_id        IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'marketing_consent_events is append-only (only redaction may update row %)', OLD.id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mce_guard ON marketing_consent_events;
CREATE TRIGGER trg_mce_guard
  BEFORE UPDATE OR DELETE ON marketing_consent_events
  FOR EACH ROW EXECUTE FUNCTION marketing_consent_events_guard();

-- =====================================================
-- 2. Consent state — the projection the send gate reads.
-- =====================================================
CREATE TABLE IF NOT EXISTS marketing_consent_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',

  consented BOOLEAN NOT NULL,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  last_event_id UUID NOT NULL REFERENCES marketing_consent_events(id),
  decided_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, email_normalized, channel)
);

ALTER TABLE marketing_consent_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own consent state" ON marketing_consent_state;
CREATE POLICY "Users can view their own consent state"
  ON marketing_consent_state FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: the trigger below owns this table. Anything
-- that writes it directly is a bug, and this makes it an impossible one for
-- everything but the service role.

-- =====================================================
-- 3. Projection, and the email_unsubscribes mirror.
-- =====================================================
CREATE OR REPLACE FUNCTION marketing_consent_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_consented BOOLEAN;
  current_contact UUID;
  current_method TEXT;
  current_at TIMESTAMPTZ;
BEGIN
  INSERT INTO marketing_consent_state AS s (
    user_id, email_normalized, channel, consented, contact_id,
    last_event_id, decided_at, updated_at
  )
  VALUES (
    NEW.user_id, NEW.email_normalized, NEW.channel,
    (NEW.decision = 'granted'), NEW.contact_id,
    NEW.id, NEW.occurred_at, now()
  )
  ON CONFLICT (user_id, email_normalized, channel) DO UPDATE
    SET consented     = EXCLUDED.consented,
        contact_id    = COALESCE(EXCLUDED.contact_id, s.contact_id),
        last_event_id = EXCLUDED.last_event_id,
        decided_at    = EXCLUDED.decided_at,
        updated_at    = now()
    -- A backdated import must never overwrite a newer decision, and on an exact
    -- tie the withdrawal wins. Fail closed on ambiguity.
    WHERE EXCLUDED.decided_at > s.decided_at
       OR (EXCLUDED.decided_at = s.decided_at AND EXCLUDED.consented = false);

  /*
   * The mirror. email_unsubscribes is promised by the purge system to outlive
   * the business; it stays true, and it stays derived from this ledger.
   *
   * Driven by the STATE that resulted, not by the event that just arrived.
   *
   * The distinction is not academic: the upsert above deliberately ignores an
   * event that is older than the decision already recorded, so an event and
   * the current state can disagree. Mirroring straight from NEW meant a
   * backdated withdrawal — a late import, a replayed webhook — would insert a
   * suppression that the newer grant had already overridden, and a backdated
   * grant would delete a live one. The mirror would then contradict the gate,
   * and the two would never reconcile because nothing writes this table again.
   */
  IF NEW.channel = 'email' THEN
    SELECT s.consented, s.contact_id, e.method, s.decided_at
      INTO current_consented, current_contact, current_method, current_at
      FROM marketing_consent_state s
      JOIN marketing_consent_events e ON e.id = s.last_event_id
     WHERE s.user_id = NEW.user_id
       AND s.email_normalized = NEW.email_normalized
       AND s.channel = 'email';

    IF current_consented IS FALSE THEN
      INSERT INTO email_unsubscribes (user_id, contact_id, email, reason, unsubscribed_at)
      VALUES (NEW.user_id, current_contact, NEW.email_normalized, current_method, current_at)
      ON CONFLICT (user_id, email) DO NOTHING;
    ELSIF current_consented IS TRUE THEN
      DELETE FROM email_unsubscribes
       WHERE user_id = NEW.user_id
         AND lower(btrim(email)) = NEW.email_normalized;
    END IF;
    -- NULL means no state row at all, which cannot happen after the upsert
    -- above. Left unhandled deliberately: doing nothing is the safe response
    -- to a situation that should be impossible.
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_mce_project ON marketing_consent_events;
CREATE TRIGGER trg_mce_project
  AFTER INSERT ON marketing_consent_events
  FOR EACH ROW EXECUTE FUNCTION marketing_consent_project();

-- =====================================================
-- 4. Per-tenant settings: wording, privacy policy, postal address.
-- =====================================================
CREATE TABLE IF NOT EXISTS marketing_consent_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Whether the checkbox is offered at all. Off does NOT mean "assume yes";
  -- it means this business does not do marketing email.
  capture_enabled BOOLEAN NOT NULL DEFAULT true,

  -- NULL in a locale falls back to the platform default in
  -- lib/consent/defaultStatements.ts, so a tenant that configures nothing still
  -- gets a lawful checkbox on day one. The alternative is a blank label, which
  -- makes consent uncollectable.
  statement_en TEXT,
  statement_es TEXT,
  statement_he TEXT,
  statement_version INT NOT NULL DEFAULT 1,

  privacy_policy_mode TEXT NOT NULL DEFAULT 'hosted'
    CHECK (privacy_policy_mode IN ('hosted', 'url', 'none')),
  privacy_policy_url TEXT,
  privacy_policy_body TEXT,
  privacy_policy_updated_at TIMESTAMPTZ,

  -- CAN-SPAM requires a physical postal address in every commercial message.
  -- Consent does not substitute for it, so the gate refuses a marketing send
  -- without one.
  postal_address TEXT,

  -- Israel Amendment 40 regulates the CONTENT of an advertisement, not just the
  -- permission to send it: the message must identify itself as one.
  label_as_advertisement BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/*
 * Business ownership.
 *
 * These settings are the BUSINESS's — its wording, its privacy notice, its
 * postal address — so tearing the business down takes them with it. A new
 * business under the same account must not inherit another's legal notice.
 *
 * The constraint is added here rather than left to
 * 20260916_business_data_ownership.sql, whose loop runs BEFORE this table
 * exists on a fresh database and would skip it with a notice. That migration
 * names the table too, so an existing database picks it up on a re-run; the
 * loop skips a constraint that already exists, so only one of the two ever
 * creates it.
 *
 * NOT VALID for the same reason the original does it: existing rows are not
 * scanned, so this cannot fail on a database with orphans in it.
 *
 * The two tables above are deliberately NOT given this constraint. Consent
 * outlives the business that collected it, exactly as email_unsubscribes does.
 */
DO $$
BEGIN
  IF to_regclass('public.business_profiles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'marketing_consent_settings_business_fk'
         AND conrelid = 'public.marketing_consent_settings'::regclass
     )
  THEN
    ALTER TABLE public.marketing_consent_settings
      ADD CONSTRAINT marketing_consent_settings_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE marketing_consent_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own consent settings" ON marketing_consent_settings;
CREATE POLICY "Users manage their own consent settings"
  ON marketing_consent_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- 5. Backfill — the only safe direction.
--
-- Suppression carries forward; permission does not. Nothing in this file
-- creates a 'granted' event, so every existing contact starts non-mailable.
-- That is the point: consent cannot be backfilled, because the email asking
-- for it retroactively would itself be the marketing email nobody agreed to.
-- =====================================================
INSERT INTO marketing_consent_events (
  user_id, contact_id, email, channel, purpose, decision, method,
  source_surface, occurred_at
)
SELECT u.user_id,
       u.contact_id,
       u.email,
       'email',
       'marketing',
       'withdrawn',
       'legacy_unsubscribe_import',
       'email_unsubscribes',
       COALESCE(u.unsubscribed_at, now())
FROM email_unsubscribes u
/*
 * NOT EXISTS rather than ON CONFLICT: the ledger has no unique constraint to
 * conflict on, and deliberately so — the same address may be granted and
 * withdrawn any number of times. `ON CONFLICT DO NOTHING` was therefore a
 * no-op clause that read like a safeguard, and re-running this file would have
 * inserted the whole import a second time.
 *
 * The condition is "the ledger has never heard of this address", NOT "has no
 * legacy import of it". The narrower version fed a loop: the projection
 * trigger MIRRORS withdrawals back into email_unsubscribes, so a re-run found
 * rows this ledger had itself written and imported them as though they
 * predated it. Every unsubscribe that matters here is one that existed before
 * this table did, and that is exactly what this asks.
 *
 * With this, every statement in the file is idempotent and it can be applied
 * again safely — which is how the fix to the append-only guard reaches a
 * database that already ran the first version.
 */
WHERE NOT EXISTS (
  SELECT 1 FROM marketing_consent_events e
  WHERE e.user_id = u.user_id
    AND e.email_normalized = lower(btrim(u.email))
);
