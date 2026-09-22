\set ON_ERROR_STOP on
\set QUIET on
DO $$
DECLARE
  u UUID := '00000000-0000-0000-0000-000000000001';
  c UUID;
  e UUID;
  n INT;
  failed BOOLEAN;
BEGIN
  -- ── the backfill ────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM marketing_consent_events WHERE method = 'legacy_unsubscribe_import';
  ASSERT n = 1, 'backfill should import the one unsubscribe, got ' || n;

  SELECT consented INTO failed FROM marketing_consent_state
   WHERE user_id = u AND email_normalized = 'gone@example.com';
  ASSERT failed = false, 'an imported unsubscribe must project as NOT consented';
  RAISE NOTICE 'PASS  backfill imports, normalises and projects';

  -- ── a grant needs its wording ───────────────────────────────────────────
  INSERT INTO crm_contacts (user_id, email) VALUES (u, 'Client@Example.com') RETURNING id INTO c;

  BEGIN
    INSERT INTO marketing_consent_events (user_id, contact_id, email, decision, method)
    VALUES (u, c, 'Client@Example.com', 'granted', 'web_form');
    RAISE EXCEPTION 'a grant with no statement_text must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  a grant with no wording is unstorable';
  END;

  -- ── a real grant ────────────────────────────────────────────────────────
  -- Explicit and oldest: this whole block shares one transaction, so now() is
  -- identical everywhere and the sequence below has to be spelled out.
  INSERT INTO marketing_consent_events
    (user_id, contact_id, email, decision, method, statement_text, statement_locale, occurred_at)
  VALUES (u, c, 'Client@Example.com', 'granted', 'web_form', 'Yes, email me offers.', 'en',
          now() - interval '10 days')
  RETURNING id INTO e;

  SELECT consented INTO failed FROM marketing_consent_state
   WHERE user_id = u AND email_normalized = 'client@example.com';
  ASSERT failed = true, 'a grant must project as consented';
  RAISE NOTICE 'PASS  a grant projects as consented';

  -- ── append-only still holds ─────────────────────────────────────────────
  BEGIN
    DELETE FROM marketing_consent_events WHERE id = e;
    RAISE EXCEPTION 'DELETE must be refused';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS  DELETE is still refused';
    ELSE RAISE; END IF;
  END;

  BEGIN
    UPDATE marketing_consent_events SET decision = 'withdrawn' WHERE id = e;
    RAISE EXCEPTION 'rewriting a decision must be refused';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS  rewriting a decision is still refused';
    ELSE RAISE; END IF;
  END;

  BEGIN
    UPDATE marketing_consent_events SET contact_id = NULL, statement_text = 'something else'
     WHERE id = e;
    RAISE EXCEPTION 'nulling contact_id must not smuggle another change through';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%append-only%' THEN
      RAISE NOTICE 'PASS  the SET NULL exemption cannot carry a second edit';
    ELSE RAISE; END IF;
  END;

  -- ── THE BUG: deleting the contact ───────────────────────────────────────
  DELETE FROM crm_contacts WHERE id = c;
  RAISE NOTICE 'PASS  deleting a contact SUCCEEDS';

  SELECT count(*) INTO n FROM marketing_consent_events WHERE id = e AND contact_id IS NULL;
  ASSERT n = 1, 'the event must survive with contact_id nulled';

  SELECT consented INTO failed FROM marketing_consent_state
   WHERE user_id = u AND email_normalized = 'client@example.com';
  ASSERT failed = true, 'consent must survive the contact being deleted';
  RAISE NOTICE 'PASS  consent outlives the contact, decision intact';

  -- ── withdrawal mirrors, re-grant un-mirrors ─────────────────────────────
  -- Explicit timestamps: everything in this DO block shares one transaction,
  -- so now() is identical for every statement and ordering would be a tie.
  INSERT INTO marketing_consent_events (user_id, email, decision, method, occurred_at)
  VALUES (u, 'client@example.com', 'withdrawn', 'unsubscribe_link', now() - interval '2 days');

  SELECT count(*) INTO n FROM email_unsubscribes
   WHERE user_id = u AND email = 'client@example.com';
  ASSERT n = 1, 'a withdrawal must mirror into email_unsubscribes';

  INSERT INTO marketing_consent_events
    (user_id, email, decision, method, statement_text, statement_locale, occurred_at)
  VALUES (u, 'client@example.com', 'granted', 'owner_entered', 'Said yes at the desk.', 'en',
          now() - interval '1 day');

  SELECT count(*) INTO n FROM email_unsubscribes
   WHERE user_id = u AND email = 'client@example.com';
  ASSERT n = 0, 'a re-grant must clear the mirror';

  SELECT count(*) INTO n FROM marketing_consent_events WHERE email_normalized = 'client@example.com';
  ASSERT n = 3, 'grant, withdraw and re-grant must all remain on the ledger, got ' || n;
  RAISE NOTICE 'PASS  grant/withdraw/re-grant keeps 3 events and one current state';

  -- ── a backdated import must not overwrite a newer decision ──────────────
  INSERT INTO marketing_consent_events
    (user_id, email, decision, method, occurred_at)
  VALUES (u, 'client@example.com', 'withdrawn', 'imported', now() - interval '30 days');

  SELECT consented INTO failed FROM marketing_consent_state
   WHERE user_id = u AND email_normalized = 'client@example.com';
  ASSERT failed = true, 'a backdated withdrawal must not overwrite a newer grant';
  RAISE NOTICE 'PASS  a backdated event does not overwrite a newer decision';

  -- ── and the mirror must agree with it ───────────────────────────────────
  -- The bug this catches: the mirror used to be written from the incoming
  -- event, so a backdated withdrawal resurrected a suppression the newer grant
  -- had cleared, and email_unsubscribes then contradicted the send gate.
  SELECT count(*) INTO n FROM email_unsubscribes
   WHERE user_id = u AND email = 'client@example.com';
  ASSERT n = 0, 'the mirror must follow the STATE, not the backdated event';
  RAISE NOTICE 'PASS  the mirror agrees with the state after a backdated event';

  -- ── an exact tie fails closed ───────────────────────────────────────────
  INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000002');
  INSERT INTO marketing_consent_events
    (user_id, email, decision, method, statement_text, statement_locale, occurred_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'tie@example.com', 'granted', 'web_form',
          'w', 'en', '2026-01-01T00:00:00Z');
  INSERT INTO marketing_consent_events
    (user_id, email, decision, method, occurred_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'tie@example.com', 'withdrawn',
          'unsubscribe_link', '2026-01-01T00:00:00Z');

  SELECT consented INTO failed FROM marketing_consent_state
   WHERE user_id = '00000000-0000-0000-0000-000000000002' AND email_normalized = 'tie@example.com';
  ASSERT failed = false, 'on an identical timestamp the withdrawal must win';
  RAISE NOTICE 'PASS  an exact tie resolves to withdrawn (fails closed)';
END $$;
