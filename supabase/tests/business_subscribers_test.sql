\set ON_ERROR_STOP on
DO $$
DECLARE
  u UUID := '00000000-0000-0000-0000-000000000001';
  n INT; st TEXT; cid UUID; linked UUID;
BEGIN
  -- ── the migration ───────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM crm_contacts WHERE stage = 'subscriber';
  ASSERT n = 0, 'no subscriber-stage contact may survive the migration';

  SELECT status INTO st FROM business_subscribers WHERE email_normalized = 'offir.omer@windpoint.io';
  ASSERT st = 'confirmed', 'a confirmed subscriber must migrate as confirmed, got ' || st;
  RAISE NOTICE 'PASS  the existing subscriber moved across, keeping its confirmed status';

  SELECT attribution->>'utm_source' INTO st FROM business_subscribers
   WHERE email_normalized = 'offir.omer@windpoint.io';
  ASSERT st = 'instagram', 'attribution must survive the move';
  RAISE NOTICE 'PASS  where they came from survived the move';

  -- The consent evidence is keyed by EMAIL, so deleting the contact loses none.
  SELECT count(*) INTO n FROM marketing_consent_events
   WHERE email_normalized = 'offir.omer@windpoint.io' AND decision = 'granted';
  ASSERT n = 1, 'consent must survive the contact being deleted';
  RAISE NOTICE 'PASS  consent survived, because it is keyed by address not contact';

  -- ── a new signup ────────────────────────────────────────────────────────
  INSERT INTO business_subscribers (user_id, email, source)
  VALUES (u, 'New.Person@Example.com ', 'newsletter');

  SELECT status INTO st FROM business_subscribers WHERE email_normalized = 'new.person@example.com';
  ASSERT st = 'pending', 'a new signup starts pending, got ' || st;
  RAISE NOTICE 'PASS  a new signup starts pending, and the address is normalised';

  -- Signing up twice must not produce two rows.
  BEGIN
    INSERT INTO business_subscribers (user_id, email) VALUES (u, 'new.person@example.com');
    RAISE EXCEPTION 'a duplicate signup must be rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  the same address cannot be on one list twice';
  END;

  -- Another business may hold the same address. Different people, different lists.
  INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000002');
  INSERT INTO business_subscribers (user_id, email) VALUES ('00000000-0000-0000-0000-000000000002', 'new.person@example.com');
  RAISE NOTICE 'PASS  two businesses may each hold the same address';

  -- ── THE TRIGGER: they book, so a contact appears ────────────────────────
  INSERT INTO crm_contacts (user_id, email, stage, source)
  VALUES (u, 'NEW.PERSON@example.com', 'lead', 'website_booking')
  RETURNING id INTO cid;

  SELECT status, promoted_contact_id INTO st, linked
    FROM business_subscribers
   WHERE user_id = u AND email_normalized = 'new.person@example.com';

  ASSERT st = 'promoted', 'booking must promote the subscriber, got ' || st;
  ASSERT linked = cid, 'the roster must point at the contact that was created';
  RAISE NOTICE 'PASS  booking promotes them automatically, and links the two';

  -- The other business's row must be untouched: the trigger is user-scoped.
  SELECT status INTO st FROM business_subscribers
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  ASSERT st = 'pending', 'another tenant''s subscriber must not be promoted, got ' || st;
  RAISE NOTICE 'PASS  the trigger is scoped to one business';

  -- A second contact for the same address must not steal the link.
  INSERT INTO crm_contacts (user_id, email, stage) VALUES (u, 'new.person@example.com', 'lead');
  SELECT promoted_contact_id INTO linked FROM business_subscribers
   WHERE user_id = u AND email_normalized = 'new.person@example.com';
  ASSERT linked = cid, 'the first contact keeps the provenance';
  RAISE NOTICE 'PASS  a later duplicate contact does not steal the provenance';

  -- ── the row outlives the contact ────────────────────────────────────────
  DELETE FROM crm_contacts WHERE id = cid;
  SELECT count(*) INTO n FROM business_subscribers
   WHERE user_id = u AND email_normalized = 'new.person@example.com';
  ASSERT n = 1, 'deleting the contact must not delete the record that they subscribed';
  RAISE NOTICE 'PASS  deleting the contact keeps the record that they subscribed';

  -- A contact with no email must not break the trigger.
  INSERT INTO crm_contacts (user_id, email, stage) VALUES (u, NULL, 'lead');
  RAISE NOTICE 'PASS  a contact with no address does not break the trigger';
END $$;
