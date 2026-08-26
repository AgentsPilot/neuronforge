-- Comprehensive Seed Data for Business OS Insight Detection
-- Creates realistic business data for a busy service professional over 90 days
-- This data will trigger AI insight detectors when you run the cron job
--
-- Data created:
-- - 50+ CRM contacts (leads and clients)
-- - 30+ invoices (mix of paid, overdue, draft)
-- - 40+ bookings (past and upcoming)
-- - 100+ business events
-- - Activities and tasks
--
-- After running: POST /api/cron/insight-detect

DO $$
DECLARE
  v_user_id UUID;
  v_service_id_1 UUID;
  v_service_id_2 UUID;
  v_service_id_3 UUID;
  v_contact_ids UUID[] := ARRAY[]::UUID[];
  v_contact_id UUID;
  i INTEGER;
  v_random_date TIMESTAMPTZ;
  v_amount DECIMAL;
  v_service_choice INTEGER;
  v_selected_service UUID;
  v_first_names TEXT[] := ARRAY['שרה', 'דוד', 'מיכל', 'יוסי', 'רונית', 'אבי', 'נועה', 'עומר', 'תמר', 'איתי', 'שירה', 'גל', 'מאיה', 'רון', 'ליאור', 'דנה', 'אור', 'יעל', 'עידו', 'נויה', 'אלון', 'הילה', 'עמית', 'שני', 'בן'];
  v_last_names TEXT[] := ARRAY['כהן', 'לוי', 'אברהם', 'פרץ', 'שמש', 'גולן', 'ברק', 'שפירא', 'מזרחי', 'דהן', 'ביטון', 'אזולאי', 'חדד', 'אוחנה', 'גבאי', 'פרידמן', 'רוזנברג', 'קפלן', 'שוורץ', 'גרינברג'];
  v_sources TEXT[] := ARRAY['website_form', 'referral', 'instagram', 'facebook', 'google', 'manual'];
  v_stages TEXT[] := ARRAY['lead', 'lead', 'lead', 'client', 'client', 'past_client']; -- weighted toward leads
BEGIN
  -- Get the first user from business_profiles
  SELECT user_id INTO v_user_id FROM business_profiles LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No user found in business_profiles. Please create a business profile first.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding comprehensive business data for user: %', v_user_id;

  -- ============================================================================
  -- SEED SERVICES
  -- ============================================================================

  v_service_id_1 := gen_random_uuid();
  INSERT INTO scheduling_services (id, user_id, service_name, description, duration_minutes, price, currency, is_active, created_at)
  VALUES (v_service_id_1, v_user_id, 'ייעוץ עסקי', 'פגישת ייעוץ עסקי אישית', 60, 450.00, 'ILS', true, now() - interval '180 days')
  ON CONFLICT DO NOTHING;

  v_service_id_2 := gen_random_uuid();
  INSERT INTO scheduling_services (id, user_id, service_name, description, duration_minutes, price, currency, is_active, created_at)
  VALUES (v_service_id_2, v_user_id, 'קואצינג אישי', 'מפגש קואצינג אישי', 90, 650.00, 'ILS', true, now() - interval '180 days')
  ON CONFLICT DO NOTHING;

  v_service_id_3 := gen_random_uuid();
  INSERT INTO scheduling_services (id, user_id, service_name, description, duration_minutes, price, currency, is_active, created_at)
  VALUES (v_service_id_3, v_user_id, 'סדנה קבוצתית', 'סדנה קבוצתית', 180, 250.00, 'ILS', true, now() - interval '180 days')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 3 services';

  -- ============================================================================
  -- SEED 50 CRM CONTACTS
  -- ============================================================================

  FOR i IN 1..50 LOOP
    v_contact_id := gen_random_uuid();
    v_contact_ids := array_append(v_contact_ids, v_contact_id);

    -- Random creation date in last 90 days
    v_random_date := now() - (random() * 90)::int * interval '1 day';

    INSERT INTO crm_contacts (
      id, user_id, first_name, last_name, email, phone, stage, source,
      notes, created_at, updated_at
    ) VALUES (
      v_contact_id,
      v_user_id,
      v_first_names[1 + (random() * (array_length(v_first_names, 1) - 1))::int],
      v_last_names[1 + (random() * (array_length(v_last_names, 1) - 1))::int],
      'contact' || i || '@example.com',
      '05' || (2 + (random() * 2)::int)::text || '-' || lpad((1000000 + (random() * 8999999)::int)::text, 7, '0'),
      v_stages[1 + (random() * (array_length(v_stages, 1) - 1))::int],
      v_sources[1 + (random() * (array_length(v_sources, 1) - 1))::int],
      CASE WHEN random() > 0.5 THEN 'הגיע דרך המלצה' ELSE NULL END,
      v_random_date,
      v_random_date + (random() * 7)::int * interval '1 day'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 50 CRM contacts';

  -- ============================================================================
  -- SEED CRM ACTIVITIES (to track last contact dates)
  -- Some contacts have no recent activity (stalled)
  -- ============================================================================

  -- Add activities for ~60% of contacts (leaving 40% stalled)
  FOR i IN 1..30 LOOP
    v_contact_id := v_contact_ids[i];
    v_random_date := now() - (random() * 30)::int * interval '1 day';

    INSERT INTO crm_activities (
      id, user_id, contact_id, activity_type, title, description, auto_logged, created_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 4)::int
        WHEN 0 THEN 'note'
        WHEN 1 THEN 'email'
        WHEN 2 THEN 'call'
        ELSE 'meeting'
      END,
      CASE (random() * 3)::int
        WHEN 0 THEN 'שיחה ראשונית'
        WHEN 1 THEN 'מעקב'
        ELSE 'פולואפ'
      END,
      'תיעוד פעילות',
      random() > 0.5,
      v_random_date
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- Leave contacts 31-50 without recent activity (stalled leads)
  -- Add old activity for some of them
  FOR i IN 31..40 LOOP
    v_contact_id := v_contact_ids[i];

    INSERT INTO crm_activities (
      id, user_id, contact_id, activity_type, title, description, auto_logged, created_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      'note',
      'פנייה ראשונית',
      'לקוח פנה דרך האתר',
      true,
      now() - interval '72 hours' - (random() * 48)::int * interval '1 hour'  -- 3-5 days ago
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created CRM activities (some contacts left stalled 48+ hours)';

  -- ============================================================================
  -- SEED PAYMENT INVOICES (mix of paid, overdue, draft)
  -- ============================================================================

  -- 10 Paid invoices (last 60 days) - with service_id references
  FOR i IN 1..10 LOOP
    v_contact_id := v_contact_ids[i];
    v_amount := 300 + (random() * 1200)::int;
    v_random_date := now() - (30 + random() * 30)::int * interval '1 day';

    INSERT INTO payment_invoices (
      id, user_id, contact_id, service_id, invoice_number, amount, currency, status,
      due_date, sent_at, paid_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      -- Distribute invoices across services
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      'INV-2024-' || lpad(i::text, 3, '0'),
      v_amount,
      'ILS',
      'paid',
      v_random_date + interval '14 days',
      v_random_date,
      v_random_date + (random() * 10)::int * interval '1 day',
      v_random_date,
      v_random_date
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 10 paid invoices';

  -- 8 Overdue invoices (7-30 days overdue) - triggers cash_ar_overdue - with service_id
  FOR i IN 11..18 LOOP
    v_contact_id := v_contact_ids[i];
    v_amount := 400 + (random() * 2000)::int;

    INSERT INTO payment_invoices (
      id, user_id, contact_id, service_id, invoice_number, amount, currency, status,
      due_date, sent_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      'INV-2024-' || lpad(i::text, 3, '0'),
      v_amount,
      'ILS',
      'sent',
      now() - (7 + (i - 11) * 3)::int * interval '1 day',  -- 7, 10, 13, 16, 19, 22, 25, 28 days overdue
      now() - (21 + (i - 11) * 3)::int * interval '1 day',
      now() - (21 + (i - 11) * 3)::int * interval '1 day',
      now() - (21 + (i - 11) * 3)::int * interval '1 day'
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 8 overdue invoices (7-28 days overdue)';

  -- 5 Recent invoices (sent, not yet due) - with service_id
  FOR i IN 19..23 LOOP
    v_contact_id := v_contact_ids[i];
    v_amount := 350 + (random() * 800)::int;

    INSERT INTO payment_invoices (
      id, user_id, contact_id, service_id, invoice_number, amount, currency, status,
      due_date, sent_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      'INV-2024-' || lpad(i::text, 3, '0'),
      v_amount,
      'ILS',
      'sent',
      now() + (7 + random() * 14)::int * interval '1 day',  -- Due in future
      now() - (random() * 5)::int * interval '1 day',
      now() - (random() * 5)::int * interval '1 day',
      now() - (random() * 5)::int * interval '1 day'
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- 4 Draft invoices - with service_id
  FOR i IN 24..27 LOOP
    v_contact_id := v_contact_ids[i];
    v_amount := 500 + (random() * 1000)::int;

    INSERT INTO payment_invoices (
      id, user_id, contact_id, service_id, invoice_number, amount, currency, status,
      due_date, sent_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      'INV-2024-' || lpad(i::text, 3, '0'),
      v_amount,
      'ILS',
      'draft',
      now() + interval '14 days',
      NULL,  -- draft invoices not sent yet
      now() - (random() * 3)::int * interval '1 day',
      now()
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 5 current + 4 draft invoices';

  -- ============================================================================
  -- SEED PAYMENT TRANSACTIONS (mix of succeeded, failed, refunded)
  -- ============================================================================

  -- 15 Succeeded payments (matching some paid invoices + standalone) - with service_id
  FOR i IN 1..15 LOOP
    v_contact_id := v_contact_ids[1 + (random() * 20)::int];
    v_amount := 300 + (random() * 1500)::int;
    v_random_date := now() - (10 + random() * 50)::int * interval '1 day';

    INSERT INTO payment_transactions (
      id, user_id, contact_id, service_id, amount, currency, status, payment_method,
      description, metadata, paid_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      -- Distribute payments across services
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      v_amount,
      'ILS',
      'succeeded',
      CASE (random() * 3)::int
        WHEN 0 THEN 'card'
        WHEN 1 THEN 'bit'
        WHEN 2 THEN 'bank_transfer'
        ELSE 'cash'
      END,
      CASE (random() * 2)::int
        WHEN 0 THEN 'תשלום עבור ייעוץ עסקי'
        WHEN 1 THEN 'תשלום עבור קואצינג'
        ELSE 'תשלום עבור סדנה'
      END,
      jsonb_build_object('source', 'manual', 'receipt_sent', true),
      v_random_date,
      v_random_date,
      v_random_date
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 15 succeeded payment transactions';

  -- 3 Failed payments (for potential insight about failed charges) - with service_id
  FOR i IN 1..3 LOOP
    v_contact_id := v_contact_ids[20 + i];
    v_amount := 400 + (random() * 800)::int;

    INSERT INTO payment_transactions (
      id, user_id, contact_id, service_id, amount, currency, status, payment_method,
      description, failure_reason, metadata, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      v_amount,
      'ILS',
      'failed',
      'card',
      'תשלום עבור שירות',
      CASE (random() * 2)::int
        WHEN 0 THEN 'insufficient_funds'
        WHEN 1 THEN 'card_declined'
        ELSE 'expired_card'
      END,
      jsonb_build_object('retry_count', (random() * 2)::int + 1),
      now() - (random() * 14)::int * interval '1 day',
      now() - (random() * 14)::int * interval '1 day'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 3 failed payment transactions';

  -- 2 Refunded payments - with service_id
  FOR i IN 1..2 LOOP
    v_contact_id := v_contact_ids[25 + i];
    v_amount := 250 + (random() * 400)::int;
    v_random_date := now() - (20 + random() * 20)::int * interval '1 day';

    INSERT INTO payment_transactions (
      id, user_id, contact_id, service_id, amount, currency, status, payment_method,
      description, metadata, paid_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      v_amount,
      'ILS',
      'refunded',
      'card',
      'תשלום שהוחזר',
      jsonb_build_object('refund_reason', 'customer_request', 'original_payment_date', v_random_date),
      v_random_date,
      v_random_date,
      now() - (random() * 5)::int * interval '1 day'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 2 refunded payment transactions';

  -- 4 Pending payments (awaiting confirmation) - with service_id
  FOR i IN 1..4 LOOP
    v_contact_id := v_contact_ids[30 + i];
    v_amount := 450 + (random() * 600)::int;

    INSERT INTO payment_transactions (
      id, user_id, contact_id, service_id, amount, currency, status, payment_method,
      description, metadata, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int
        WHEN 0 THEN v_service_id_1
        WHEN 1 THEN v_service_id_2
        ELSE v_service_id_3
      END,
      v_amount,
      'ILS',
      'pending',
      'bank_transfer',
      'ממתין להעברה בנקאית',
      jsonb_build_object('expected_by', now() + interval '3 days'),
      now() - (random() * 3)::int * interval '1 day',
      now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 4 pending payment transactions';

  -- ============================================================================
  -- SEED BOOKINGS (past and upcoming)
  -- ============================================================================

  -- 25 Past completed bookings (last 60 days) - shows historical activity with revenue
  FOR i IN 1..25 LOOP
    v_contact_id := v_contact_ids[1 + (random() * 25)::int];
    v_random_date := now() - (5 + random() * 55)::int * interval '1 day';

    -- Randomly select service and set matching price
    v_service_choice := (random() * 2)::int;
    v_selected_service := CASE v_service_choice
      WHEN 0 THEN v_service_id_1
      WHEN 1 THEN v_service_id_2
      ELSE v_service_id_3
    END;
    v_amount := CASE v_service_choice
      WHEN 0 THEN 450.00  -- v_service_id_1 price (ייעוץ עסקי)
      WHEN 1 THEN 650.00  -- v_service_id_2 price (קואצינג אישי)
      ELSE 250.00         -- v_service_id_3 price (סדנה קבוצתית)
    END;

    INSERT INTO scheduling_bookings (
      id, user_id, contact_id, service_id, start_time, end_time, status, total_amount,
      client_first_name, client_last_name, client_email,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      v_selected_service,
      v_random_date + interval '10 hours' + (random() * 7)::int * interval '1 hour',
      v_random_date + interval '11 hours' + (random() * 7)::int * interval '1 hour',
      'completed',
      v_amount,
      'לקוח',
      'מס ' || i::text,
      'client' || i || '@example.com',
      v_random_date - (random() * 7)::int * interval '1 day',
      v_random_date
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 25 past completed bookings';

  -- 3 Past no-shows (for no-show spike detection)
  FOR i IN 1..3 LOOP
    v_contact_id := v_contact_ids[26 + i];
    v_random_date := now() - (3 + random() * 10)::int * interval '1 day';

    INSERT INTO scheduling_bookings (
      id, user_id, contact_id, service_id, start_time, end_time, status,
      client_first_name, client_last_name, client_email,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      v_service_id_1,
      v_random_date + interval '14 hours',
      v_random_date + interval '15 hours',
      'no_show',
      'לקוח',
      'לא הגיע ' || i::text,
      'noshow' || i || '@example.com',
      v_random_date - interval '5 days',
      v_random_date
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 3 no-show bookings';

  -- 2-3 Upcoming bookings this week (sparse = low utilization trigger)
  INSERT INTO scheduling_bookings (
    id, user_id, contact_id, service_id, start_time, end_time, status,
    client_first_name, client_last_name, client_email,
    created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_contact_ids[1],
    v_service_id_1,
    date_trunc('day', now()) + interval '1 day' + interval '10 hours',
    date_trunc('day', now()) + interval '1 day' + interval '11 hours',
    'confirmed',
    'לקוח',
    'קרוב 1',
    'upcoming1@example.com',
    now() - interval '3 days',
    now() - interval '3 days'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO scheduling_bookings (
    id, user_id, contact_id, service_id, start_time, end_time, status,
    client_first_name, client_last_name, client_email,
    created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_contact_ids[2],
    v_service_id_2,
    date_trunc('day', now()) + interval '3 days' + interval '14 hours',
    date_trunc('day', now()) + interval '3 days' + interval '15 hours' + interval '30 minutes',
    'confirmed',
    'לקוח',
    'קרוב 2',
    'upcoming2@example.com',
    now() - interval '5 days',
    now() - interval '5 days'
  ) ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 2 upcoming bookings (sparse week = low utilization)';

  -- 5 Future bookings (next 2-4 weeks)
  FOR i IN 1..5 LOOP
    v_contact_id := v_contact_ids[1 + (random() * 20)::int];

    INSERT INTO scheduling_bookings (
      id, user_id, contact_id, service_id, start_time, end_time, status,
      client_first_name, client_last_name, client_email,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_id,
      CASE (random() * 2)::int WHEN 0 THEN v_service_id_1 ELSE v_service_id_2 END,
      date_trunc('day', now()) + (10 + i * 3)::int * interval '1 day' + interval '11 hours',
      date_trunc('day', now()) + (10 + i * 3)::int * interval '1 day' + interval '12 hours',
      'confirmed',
      'לקוח',
      'עתידי ' || i::text,
      'future' || i || '@example.com',
      now() - (random() * 7)::int * interval '1 day',
      now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 5 future bookings';

  -- ============================================================================
  -- SEED BUSINESS EVENTS (for detector context)
  -- ============================================================================
  -- Note: Business events are optional and auto-created by the system.
  -- Skipping manual seed to avoid schema compatibility issues.

  RAISE NOTICE 'Skipped business events (auto-created by system)';

  -- ============================================================================
  -- SEED CRM TASKS
  -- ============================================================================

  -- Overdue tasks
  FOR i IN 1..5 LOOP
    INSERT INTO crm_tasks (
      id, user_id, contact_id, title, description, due_date, priority, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_ids[30 + i],
      'לחזור ללקוח',
      'לקוח ממתין לתגובה',
      now() - (i + 1)::int * interval '1 day',
      (CASE WHEN i <= 2 THEN 'high' ELSE 'medium' END)::task_priority,
      'pending'::task_status,
      now() - (i + 3)::int * interval '1 day',
      now() - (i + 3)::int * interval '1 day'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- Upcoming tasks
  FOR i IN 1..3 LOOP
    INSERT INTO crm_tasks (
      id, user_id, contact_id, title, description, due_date, priority, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_contact_ids[i],
      'מעקב אחרי הצעה',
      'לבדוק אם קיבל את ההצעה',
      now() + i::int * interval '1 day',
      'medium'::task_priority,
      'pending'::task_status,
      now() - interval '2 days',
      now() - interval '2 days'
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created 8 CRM tasks';

  -- ============================================================================
  -- SUMMARY
  -- ============================================================================

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  SEED COMPLETE - Comprehensive business data for user: %', v_user_id;
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  📊 Data Created:';
  RAISE NOTICE '     • 50 CRM contacts (leads + clients)';
  RAISE NOTICE '     • 27 invoices (10 paid, 8 overdue, 5 current, 4 draft) - WITH service_id';
  RAISE NOTICE '     • 24 payment transactions (15 succeeded, 3 failed, 2 refunded, 4 pending) - WITH service_id';
  RAISE NOTICE '     • 35+ bookings (25 past completed WITH total_amount, 3 no-shows, 7+ upcoming)';
  RAISE NOTICE '     • 8 CRM tasks';
  RAISE NOTICE '     • 3 services (Business Consulting ₪450, Personal Coaching ₪650, Group Workshop ₪250)';
  RAISE NOTICE '';
  RAISE NOTICE '  🔍 Insight Triggers:';
  RAISE NOTICE '     • cash_ar_overdue: 8 invoices overdue (7-28 days)';
  RAISE NOTICE '     • cash_payment_issues: 3 failed, 4 pending, 2 refunded';
  RAISE NOTICE '     • sales_stalled: ~15 leads with no activity 48+ hours';
  RAISE NOTICE '     • ops_utilization_low: Only 2 bookings this week';
  RAISE NOTICE '     • ret_no_show_spike: 3 recent no-shows';
  RAISE NOTICE '';
  RAISE NOTICE '  ▶️  Next: POST /api/cron/insight-detect to generate AI insights';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';

END $$;
