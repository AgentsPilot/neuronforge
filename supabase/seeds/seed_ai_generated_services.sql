-- =====================================================
-- Seed Data: AI-Generated Draft Services
-- Run this AFTER the status migration to test the feature
-- Replace 'YOUR_USER_ID' with your actual user ID
-- =====================================================

-- To find your user ID, run:
-- SELECT id, email FROM auth.users LIMIT 10;

-- Then replace the placeholder below with your actual user ID

DO $$
DECLARE
  test_user_id UUID;
BEGIN
  -- Get the first user (or specify a specific email)
  SELECT id INTO test_user_id FROM auth.users LIMIT 1;

  IF test_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found. Create a user first.';
  END IF;

  -- Delete existing draft services for clean test
  DELETE FROM scheduling_services
  WHERE user_id = test_user_id AND status = 'draft';

  -- Insert AI-generated draft services (Therapist vertical example)
  INSERT INTO scheduling_services (
    user_id,
    service_name,
    description,
    duration_minutes,
    price,
    buffer_minutes,
    min_notice_hours,
    advance_booking_days,
    is_active,
    status,
    source,
    ai_suggestions
  ) VALUES
  -- Service 1: Initial Consultation
  (
    test_user_id,
    'Initial Consultation',
    'A comprehensive first session to understand your needs, discuss your goals, and create a personalized treatment plan.',
    60,
    150.00,
    15,
    24,
    30,
    false,
    'draft',
    'ai_generated',
    '{
      "reasoning": "First-time clients typically need longer sessions for intake and assessment. Priced at premium rate to reflect comprehensive evaluation.",
      "confidence": 0.92,
      "source": "vertical_default"
    }'::jsonb
  ),
  -- Service 2: Standard Session
  (
    test_user_id,
    'Standard Therapy Session',
    'Regular one-on-one therapy session for ongoing support and progress tracking.',
    50,
    120.00,
    10,
    4,
    14,
    false,
    'draft',
    'ai_generated',
    '{
      "reasoning": "Standard 50-minute session is industry norm for therapy. Buffer allows for notes and brief breaks between clients.",
      "confidence": 0.95,
      "source": "industry_standard"
    }'::jsonb
  ),
  -- Service 3: Extended Session
  (
    test_user_id,
    'Extended Deep-Work Session',
    'Longer session for complex issues, trauma processing, or intensive work that requires more time.',
    90,
    180.00,
    20,
    24,
    21,
    false,
    'draft',
    'ai_generated',
    '{
      "reasoning": "Some therapeutic modalities (EMDR, trauma-focused) benefit from longer sessions. Higher buffer time for emotional processing.",
      "confidence": 0.88,
      "source": "vertical_default"
    }'::jsonb
  ),
  -- Service 4: Couples Session
  (
    test_user_id,
    'Couples Therapy Session',
    'Joint session for couples working on communication, conflict resolution, and relationship strengthening.',
    75,
    175.00,
    15,
    48,
    14,
    false,
    'draft',
    'ai_generated',
    '{
      "reasoning": "Couples sessions typically run longer than individual sessions. Requires coordination of two schedules, hence longer notice period.",
      "confidence": 0.85,
      "source": "vertical_default"
    }'::jsonb
  ),
  -- Service 5: Quick Check-in
  (
    test_user_id,
    'Brief Check-in Session',
    'Short follow-up session for medication check, crisis stabilization, or quick progress review.',
    30,
    75.00,
    5,
    2,
    7,
    false,
    'draft',
    'ai_generated',
    '{
      "reasoning": "Useful for established clients who need quick touchpoints between regular sessions. Lower barrier with shorter notice period.",
      "confidence": 0.82,
      "source": "industry_standard"
    }'::jsonb
  );

  RAISE NOTICE 'Created 5 AI-generated draft services for user %', test_user_id;
END $$;

-- Verify the seed data
SELECT
  service_name,
  duration_minutes,
  price,
  status,
  source,
  ai_suggestions->>'reasoning' as ai_reasoning,
  ai_suggestions->>'confidence' as confidence
FROM scheduling_services
WHERE status = 'draft'
ORDER BY created_at DESC
LIMIT 10;
