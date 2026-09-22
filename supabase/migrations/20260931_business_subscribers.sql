-- =====================================================
-- Newsletter subscribers, per business.
--
-- A subscriber is an AUDIENCE, not a deal. They were being written into
-- `crm_contacts` with `stage = 'subscriber'` — a key absent from every
-- business's `crm_pipeline_stages` — so the pipeline, which buckets by exact
-- stage match, rendered them in no column at all. They existed and were
-- invisible.
--
-- Putting them in the first stage instead is worse. `CrmColdLeadsDetector`
-- matches `stage IN ('lead','new_lead','prospect','enquiry')`, so seven days
-- after signing up a subscriber becomes a "cold lead": counted, multiplied by
-- average deal value into a loss figure, and offered up to `send_followup_nudge`
-- with the "you got in touch and we never followed up" wording — to somebody who
-- never got in touch.
--
-- So subscribers live here, and become a contact only when they do business or
-- when the owner says so.
--
-- NOT `newsletter_subscribers`: that is AgentPilot's OWN website footer list. It
-- has no `user_id` column, its RLS is an open "Anyone can subscribe" insert
-- policy, and it is documented as outside the purge set. Adding a nullable
-- `user_id` would make one table hold both the platform's list and every
-- tenant's, one forgotten WHERE apart.
-- =====================================================

CREATE TABLE IF NOT EXISTS business_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,

  /*
   * Nullable, and left null rather than derived. The newsletter box collects an
   * address and nothing else; inventing a name from the local part is the bug
   * that filled the CRM with people called "offir.omer".
   */
  name TEXT,

  /*
   * `pending` until the double opt-in link is clicked. That state exists here
   * and NOT in `marketing_consent_state`, which records decisions and treats
   * absence as "no" — so a signup that has not yet confirmed has no consent row
   * anywhere, and without this table it would be stored nowhere at all.
   */
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'unsubscribed', 'promoted')),

  source TEXT NOT NULL DEFAULT 'newsletter',

  -- Where they came from: UTM, referrer, hashed IP. The same shape
  -- `buildAttributionFromRequest` writes into `crm_contacts.source_metadata`.
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,

  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,

  /*
   * Where they went, once they became a contact.
   *
   * SET NULL rather than CASCADE: deleting the contact must not erase the record
   * that this person once subscribed, for the same reason consent outlives a
   * contact row.
   */
  promoted_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  promoted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, email_normalized)
);

CREATE INDEX IF NOT EXISTS idx_business_subscribers_user
  ON business_subscribers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_business_subscribers_contact
  ON business_subscribers(promoted_contact_id);

ALTER TABLE business_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscribers" ON business_subscribers;
CREATE POLICY "Users can view their own subscribers"
  ON business_subscribers FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own subscribers" ON business_subscribers;
CREATE POLICY "Users can update their own subscribers"
  ON business_subscribers FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No INSERT policy: signups arrive on a PUBLIC, unauthenticated form, so the
-- write path runs on the service role. An anon insert policy here is exactly
-- what makes `newsletter_subscribers` unsuitable for per-tenant data.

/*
 * Business ownership.
 *
 * Added here rather than left to 20260916_business_data_ownership.sql, whose
 * loop runs before this table exists on a fresh database and would skip it. That
 * migration names the table too, so an existing database picks it up on a re-run;
 * the loop skips a constraint that already exists, so only one of the two ever
 * creates it.
 */
DO $$
BEGIN
  IF to_regclass('public.business_profiles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'business_subscribers_business_fk'
         AND conrelid = 'public.business_subscribers'::regclass
     )
  THEN
    ALTER TABLE public.business_subscribers
      ADD CONSTRAINT business_subscribers_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- =====================================================
-- Linking a new contact back to the subscriber it came from.
-- =====================================================

/*
 * A trigger, not application code.
 *
 * Contacts are created by the booking route, the contact form, the proposal
 * route, the manual CRM form, the chat capability and the import path. Any of
 * them can create a contact for an address that already subscribed, and one
 * added next year will too. Six call sites can each forget; one trigger cannot.
 *
 * It deliberately does NOT touch `crm_contacts.source`. A contact created by a
 * booking has a source describing how the CONTACT was created, and overwriting
 * it with 'newsletter' would make the row lie about that. Where they came from
 * before is carried by the link.
 */
CREATE OR REPLACE FUNCTION link_subscriber_to_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NULL;
  END IF;

  UPDATE business_subscribers
     SET status = 'promoted',
         promoted_contact_id = NEW.id,
         promoted_at = now(),
         updated_at = now()
   WHERE user_id = NEW.user_id
     AND email_normalized = lower(btrim(NEW.email))
     -- An already-promoted row keeps its first contact: the provenance is the
     -- moment they entered the CRM, not the most recent row bearing the address.
     AND promoted_contact_id IS NULL;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_link_subscriber_to_contact ON crm_contacts;
CREATE TRIGGER trg_link_subscriber_to_contact
  AFTER INSERT ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION link_subscriber_to_contact();

-- =====================================================
-- Move the subscribers that were written as contacts.
--
-- Their status comes from the consent ledger, which is the authority on whether
-- they ever confirmed: a state row saying `consented` is a confirmed
-- subscriber, one saying otherwise is unsubscribed, and no row at all is a
-- signup that never clicked the link.
-- =====================================================
INSERT INTO business_subscribers (
  user_id, email, name, status, source, attribution, subscribed_at, confirmed_at
)
SELECT
  c.user_id,
  c.email,
  NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
  CASE
    WHEN s.consented IS TRUE THEN 'confirmed'
    WHEN s.consented IS FALSE THEN 'unsubscribed'
    ELSE 'pending'
  END,
  COALESCE(c.source, 'newsletter'),
  COALESCE(c.source_metadata, '{}'::jsonb),
  c.created_at,
  CASE WHEN s.consented IS TRUE THEN s.decided_at ELSE NULL END
FROM crm_contacts c
LEFT JOIN marketing_consent_state s
  ON s.user_id = c.user_id
 AND s.email_normalized = lower(btrim(c.email))
 AND s.channel = 'email'
WHERE c.stage = 'subscriber'
  AND c.email IS NOT NULL
ON CONFLICT (user_id, email_normalized) DO NOTHING;

/*
 * Then remove the contact rows.
 *
 * Deleting a contact cascades its activities and sets its consent events'
 * `contact_id` to NULL — which is correct and lossless here: the consent ledger
 * is keyed by EMAIL, so the decision, the wording and the date all survive, and
 * `/api/crm/contacts/[id]/consent` looks consent up by address rather than by
 * contact id.
 */
DELETE FROM crm_contacts
 WHERE stage = 'subscriber'
   AND email IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM business_subscribers b
     WHERE b.user_id = crm_contacts.user_id
       AND b.email_normalized = lower(btrim(crm_contacts.email))
   );

-- =====================================================
-- And the subscribers who never had a contact row to move.
--
-- The block above moves contacts at `stage = 'subscriber'`. It cannot see
-- somebody who confirmed a newsletter subscription and whose contact was since
-- deleted, or who consented through a flow that predates this table — and
-- without a roster row they never appear on the Subscribers tab at all, no
-- matter how many times they sign up again.
--
-- Scoped to consent that CAME FROM the newsletter. `marketing_consent_state`
-- also holds people who ticked the marketing box while booking; they are
-- marketing-consented clients, not newsletter subscribers, and sweeping them
-- onto the roster would invent a signup that never happened.
-- =====================================================
INSERT INTO business_subscribers (
  user_id, email, status, source, subscribed_at, confirmed_at
)
SELECT DISTINCT ON (e.user_id, e.email_normalized)
  e.user_id,
  e.email,
  CASE WHEN st.consented IS TRUE THEN 'confirmed' ELSE 'unsubscribed' END,
  'newsletter',
  e.occurred_at,
  CASE WHEN st.consented IS TRUE THEN st.decided_at ELSE NULL END
FROM marketing_consent_events e
JOIN marketing_consent_state st
  ON st.user_id = e.user_id
 AND st.email_normalized = e.email_normalized
 AND st.channel = 'email'
WHERE e.source_surface = 'newsletter'
  AND e.decision = 'granted'
ORDER BY e.user_id, e.email_normalized, e.occurred_at ASC
ON CONFLICT (user_id, email_normalized) DO NOTHING;
