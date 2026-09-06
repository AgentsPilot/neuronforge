-- Add test bookings for current week (August 2026)
-- This fixes the empty calendar issue where all seed bookings were in the past

DO $$
DECLARE
  v_user_id UUID;
  v_service_id UUID;
  v_contact_id UUID;
BEGIN
  -- Get the first user from business_profiles
  SELECT user_id INTO v_user_id FROM business_profiles LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No user found in business_profiles. Skipping.';
    RETURN;
  END IF;

  -- Get an active service
  SELECT id INTO v_service_id
  FROM scheduling_services
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_service_id IS NULL THEN
    RAISE NOTICE 'No active service found. Skipping.';
    RETURN;
  END IF;

  -- Get a contact (optional)
  SELECT id INTO v_contact_id FROM crm_contacts WHERE user_id = v_user_id LIMIT 1;

  RAISE NOTICE 'Creating current week bookings for user: %', v_user_id;

  -- Tomorrow at 10:00 UTC (will show in current week)
  INSERT INTO scheduling_bookings (
    user_id, service_id, contact_id,
    client_first_name, client_last_name, client_email,
    start_time, end_time,
    status, payment_status,
    created_at, updated_at
  ) VALUES (
    v_user_id, v_service_id, v_contact_id,
    'Alice', 'Johnson', 'alice.johnson@example.com',
    date_trunc('day', now()) + interval '1 day' + interval '10 hours',
    date_trunc('day', now()) + interval '1 day' + interval '11 hours',
    'confirmed', 'pending',
    now() - interval '2 days',
    now() - interval '2 days'
  ) ON CONFLICT DO NOTHING;

  -- Day after tomorrow at 14:00 UTC
  INSERT INTO scheduling_bookings (
    user_id, service_id, contact_id,
    client_first_name, client_last_name, client_email,
    start_time, end_time,
    status, payment_status,
    created_at, updated_at
  ) VALUES (
    v_user_id, v_service_id, v_contact_id,
    'Bob', 'Smith', 'bob.smith@example.com',
    date_trunc('day', now()) + interval '2 days' + interval '14 hours',
    date_trunc('day', now()) + interval '2 days' + interval '15 hours',
    'confirmed', 'pending',
    now() - interval '3 days',
    now() - interval '3 days'
  ) ON CONFLICT DO NOTHING;

  -- +3 days at 16:00 UTC
  INSERT INTO scheduling_bookings (
    user_id, service_id, contact_id,
    client_first_name, client_last_name, client_email,
    start_time, end_time,
    status, payment_status,
    created_at, updated_at
  ) VALUES (
    v_user_id, v_service_id, v_contact_id,
    'Carol', 'Williams', 'carol.williams@example.com',
    date_trunc('day', now()) + interval '3 days' + interval '16 hours',
    date_trunc('day', now()) + interval '3 days' + interval '17 hours',
    'confirmed', 'pending',
    now() - interval '1 day',
    now() - interval '1 day'
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 3 test bookings for current week';
END $$;
