-- Seed Data for Business Story / Reports Page Testing
-- Run this after logging in to get your user_id
-- Replace 'YOUR_USER_ID' with your actual auth.users.id from Supabase

-- To find your user ID, run:
-- SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- =====================================================
-- CONFIGURATION: Set your user_id here
-- =====================================================
DO $$
DECLARE
  target_user_id UUID;
  contact_1_id UUID;
  contact_2_id UUID;
  contact_3_id UUID;
  contact_4_id UUID;
  contact_5_id UUID;
  contact_6_id UUID;
  contact_7_id UUID;
  contact_8_id UUID;
  contact_9_id UUID;
  contact_10_id UUID;
  service_1_id UUID;
  service_2_id UUID;
  invoice_1_id UUID;
  invoice_2_id UUID;
  invoice_3_id UUID;
BEGIN
  -- Get the first user (for testing) - change this query if needed
  SELECT id INTO target_user_id FROM auth.users LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found. Please ensure you have a user in auth.users table.';
  END IF;

  RAISE NOTICE 'Seeding data for user: %', target_user_id;

  -- =====================================================
  -- 1. DELETE EXISTING TEST DATA (clean slate)
  -- =====================================================
  DELETE FROM crm_activities WHERE user_id = target_user_id;
  DELETE FROM scheduling_bookings WHERE user_id = target_user_id;
  DELETE FROM scheduling_services WHERE user_id = target_user_id;
  DELETE FROM payment_transactions WHERE user_id = target_user_id;
  DELETE FROM payment_invoices WHERE user_id = target_user_id;
  DELETE FROM crm_contacts WHERE user_id = target_user_id;
  DELETE FROM crm_pipeline_stages WHERE user_id = target_user_id;

  RAISE NOTICE 'Cleaned up existing data';

  -- =====================================================
  -- 2. CREATE PIPELINE STAGES
  -- =====================================================
  INSERT INTO crm_pipeline_stages (user_id, vertical, stage_key, stage_label, position, color) VALUES
    (target_user_id, 'coach', 'lead', 'Lead', 0, '#94A3B8'),
    (target_user_id, 'coach', 'consultation', 'Consultation', 1, '#60A5FA'),
    (target_user_id, 'coach', 'client', 'Active Client', 2, '#34D399'),
    (target_user_id, 'coach', 'completed', 'Completed', 3, '#A78BFA'),
    (target_user_id, 'coach', 'inactive', 'Inactive', 4, '#F87171');

  RAISE NOTICE 'Created pipeline stages';

  -- =====================================================
  -- 3. CREATE CRM CONTACTS (47 total - matching the design)
  -- =====================================================

  -- Active clients (became clients this month - 3 this week)
  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', 'client', 'website_form', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')
  RETURNING id INTO contact_1_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', 'client', 'booking', NOW() - INTERVAL '4 days', NOW() - INTERVAL '2 days')
  RETURNING id INTO contact_2_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Emma', 'Williams', 'emma.williams@email.com', '+1-555-0103', 'client', 'manual', NOW() - INTERVAL '5 days', NOW() - INTERVAL '3 days')
  RETURNING id INTO contact_3_id;

  -- New leads this week (8 new faces - not all became clients)
  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'David', 'Brown', 'david.brown@email.com', '+1-555-0104', 'lead', 'website_form', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
  RETURNING id INTO contact_4_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Lisa', 'Garcia', 'lisa.garcia@email.com', '+1-555-0105', 'lead', 'website_form', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days')
  RETURNING id INTO contact_5_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'James', 'Martinez', 'james.martinez@email.com', '+1-555-0106', 'consultation', 'website_form', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days')
  RETURNING id INTO contact_6_id;

  INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at) VALUES
    (target_user_id, 'Jennifer', 'Lopez', 'jennifer.lopez@email.com', '+1-555-0107', 'lead', 'website_form', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
    (target_user_id, 'Robert', 'Wilson', 'robert.wilson@email.com', '+1-555-0108', 'lead', 'manual', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
    (target_user_id, 'Amanda', 'Taylor', 'amanda.taylor@email.com', '+1-555-0109', 'consultation', 'website_form', NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
    (target_user_id, 'Christopher', 'Anderson', 'christopher.anderson@email.com', '+1-555-0110', 'lead', 'booking', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
    (target_user_id, 'Jessica', 'Thomas', 'jessica.thomas@email.com', '+1-555-0111', 'lead', 'website_form', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days');

  -- Quiet contacts (5 went quiet - no activity in 2+ weeks)
  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Mark', 'Davis', 'mark.davis@email.com', '+1-555-0112', 'lead', 'website_form', NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days')
  RETURNING id INTO contact_7_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Susan', 'Miller', 'susan.miller@email.com', '+1-555-0113', 'consultation', 'manual', NOW() - INTERVAL '25 days', NOW() - INTERVAL '16 days')
  RETURNING id INTO contact_8_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Daniel', 'Moore', 'daniel.moore@email.com', '+1-555-0114', 'lead', 'website_form', NOW() - INTERVAL '30 days', NOW() - INTERVAL '20 days')
  RETURNING id INTO contact_9_id;

  INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at)
  VALUES (gen_random_uuid(), target_user_id, 'Patricia', 'Jackson', 'patricia.jackson@email.com', '+1-555-0115', 'consultation', 'website_form', NOW() - INTERVAL '28 days', NOW() - INTERVAL '15 days')
  RETURNING id INTO contact_10_id;

  INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at) VALUES
    (target_user_id, 'Kevin', 'White', 'kevin.white@email.com', '+1-555-0116', 'lead', 'manual', NOW() - INTERVAL '22 days', NOW() - INTERVAL '17 days');

  -- Older active clients (part of the 47 total)
  INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at) VALUES
    (target_user_id, 'Nancy', 'Harris', 'nancy.harris@email.com', '+1-555-0117', 'client', 'booking', NOW() - INTERVAL '45 days', NOW() - INTERVAL '5 days'),
    (target_user_id, 'Steven', 'Clark', 'steven.clark@email.com', '+1-555-0118', 'client', 'website_form', NOW() - INTERVAL '60 days', NOW() - INTERVAL '7 days'),
    (target_user_id, 'Betty', 'Lewis', 'betty.lewis@email.com', '+1-555-0119', 'client', 'manual', NOW() - INTERVAL '90 days', NOW() - INTERVAL '3 days'),
    (target_user_id, 'Richard', 'Walker', 'richard.walker@email.com', '+1-555-0120', 'client', 'booking', NOW() - INTERVAL '120 days', NOW() - INTERVAL '10 days'),
    (target_user_id, 'Dorothy', 'Hall', 'dorothy.hall@email.com', '+1-555-0121', 'client', 'website_form', NOW() - INTERVAL '150 days', NOW() - INTERVAL '2 days'),
    (target_user_id, 'Joseph', 'Allen', 'joseph.allen@email.com', '+1-555-0122', 'client', 'manual', NOW() - INTERVAL '180 days', NOW() - INTERVAL '8 days'),
    (target_user_id, 'Sandra', 'Young', 'sandra.young@email.com', '+1-555-0123', 'client', 'booking', NOW() - INTERVAL '30 days', NOW() - INTERVAL '4 days'),
    (target_user_id, 'Charles', 'King', 'charles.king@email.com', '+1-555-0124', 'client', 'website_form', NOW() - INTERVAL '75 days', NOW() - INTERVAL '6 days'),
    (target_user_id, 'Margaret', 'Wright', 'margaret.wright@email.com', '+1-555-0125', 'client', 'manual', NOW() - INTERVAL '100 days', NOW() - INTERVAL '9 days'),
    (target_user_id, 'Thomas', 'Scott', 'thomas.scott@email.com', '+1-555-0126', 'completed', 'booking', NOW() - INTERVAL '200 days', NOW() - INTERVAL '30 days');

  -- Completed/past clients
  INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at) VALUES
    (target_user_id, 'Ashley', 'Green', 'ashley.green@email.com', '+1-555-0127', 'completed', 'website_form', NOW() - INTERVAL '180 days', NOW() - INTERVAL '60 days'),
    (target_user_id, 'Matthew', 'Adams', 'matthew.adams@email.com', '+1-555-0128', 'completed', 'manual', NOW() - INTERVAL '240 days', NOW() - INTERVAL '90 days'),
    (target_user_id, 'Kimberly', 'Nelson', 'kimberly.nelson@email.com', '+1-555-0129', 'completed', 'booking', NOW() - INTERVAL '300 days', NOW() - INTERVAL '120 days'),
    (target_user_id, 'Andrew', 'Baker', 'andrew.baker@email.com', '+1-555-0130', 'inactive', 'website_form', NOW() - INTERVAL '250 days', NOW() - INTERVAL '100 days'),
    (target_user_id, 'Emily', 'Gonzalez', 'emily.gonzalez@email.com', '+1-555-0131', 'inactive', 'manual', NOW() - INTERVAL '280 days', NOW() - INTERVAL '110 days');

  -- More leads and consultations to reach 47 total
  INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, stage, source, created_at, updated_at) VALUES
    (target_user_id, 'Joshua', 'Carter', 'joshua.carter@email.com', '+1-555-0132', 'lead', 'website_form', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
    (target_user_id, 'Stephanie', 'Mitchell', 'stephanie.mitchell@email.com', '+1-555-0133', 'consultation', 'booking', NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days'),
    (target_user_id, 'Brian', 'Perez', 'brian.perez@email.com', '+1-555-0134', 'lead', 'manual', NOW() - INTERVAL '12 days', NOW() - INTERVAL '11 days'),
    (target_user_id, 'Nicole', 'Roberts', 'nicole.roberts@email.com', '+1-555-0135', 'consultation', 'website_form', NOW() - INTERVAL '9 days', NOW() - INTERVAL '7 days'),
    (target_user_id, 'Ryan', 'Turner', 'ryan.turner@email.com', '+1-555-0136', 'lead', 'booking', NOW() - INTERVAL '11 days', NOW() - INTERVAL '10 days'),
    (target_user_id, 'Melissa', 'Phillips', 'melissa.phillips@email.com', '+1-555-0137', 'lead', 'website_form', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
    (target_user_id, 'Jason', 'Campbell', 'jason.campbell@email.com', '+1-555-0138', 'consultation', 'manual', NOW() - INTERVAL '14 days', NOW() - INTERVAL '12 days'),
    (target_user_id, 'Laura', 'Parker', 'laura.parker@email.com', '+1-555-0139', 'lead', 'website_form', NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days'),
    (target_user_id, 'Justin', 'Evans', 'justin.evans@email.com', '+1-555-0140', 'lead', 'booking', NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days'),
    (target_user_id, 'Rebecca', 'Edwards', 'rebecca.edwards@email.com', '+1-555-0141', 'consultation', 'website_form', NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days'),
    (target_user_id, 'Brandon', 'Collins', 'brandon.collins@email.com', '+1-555-0142', 'lead', 'manual', NOW() - INTERVAL '16 days', NOW() - INTERVAL '15 days'),
    (target_user_id, 'Samantha', 'Stewart', 'samantha.stewart@email.com', '+1-555-0143', 'lead', 'website_form', NOW() - INTERVAL '17 days', NOW() - INTERVAL '16 days'),
    (target_user_id, 'Aaron', 'Sanchez', 'aaron.sanchez@email.com', '+1-555-0144', 'consultation', 'booking', NOW() - INTERVAL '18 days', NOW() - INTERVAL '17 days'),
    (target_user_id, 'Rachel', 'Morris', 'rachel.morris@email.com', '+1-555-0145', 'lead', 'website_form', NOW() - INTERVAL '19 days', NOW() - INTERVAL '18 days'),
    (target_user_id, 'Tyler', 'Rogers', 'tyler.rogers@email.com', '+1-555-0146', 'lead', 'manual', NOW() - INTERVAL '21 days', NOW() - INTERVAL '19 days'),
    (target_user_id, 'Lauren', 'Reed', 'lauren.reed@email.com', '+1-555-0147', 'consultation', 'website_form', NOW() - INTERVAL '23 days', NOW() - INTERVAL '21 days');

  RAISE NOTICE 'Created 47 CRM contacts';

  -- =====================================================
  -- 4. CREATE SCHEDULING SERVICES
  -- =====================================================
  INSERT INTO scheduling_services (id, user_id, service_name, description, duration_minutes, price, buffer_minutes, is_active)
  VALUES (gen_random_uuid(), target_user_id, 'Discovery Call', 'Free 30-minute consultation', 30, 0, 15, true)
  RETURNING id INTO service_1_id;

  INSERT INTO scheduling_services (id, user_id, service_name, description, duration_minutes, price, buffer_minutes, is_active)
  VALUES (gen_random_uuid(), target_user_id, 'Coaching Session', 'Standard 60-minute coaching session', 60, 150, 15, true)
  RETURNING id INTO service_2_id;

  INSERT INTO scheduling_services (user_id, service_name, description, duration_minutes, price, buffer_minutes, is_active) VALUES
    (target_user_id, 'Deep Dive Session', '90-minute intensive coaching', 90, 225, 30, true),
    (target_user_id, 'Follow-up Call', 'Quick 30-minute check-in', 30, 75, 10, true);

  RAISE NOTICE 'Created scheduling services';

  -- =====================================================
  -- 5. CREATE SCHEDULING BOOKINGS (18 this month, 3 upcoming)
  -- =====================================================

  -- Upcoming bookings (3 this week)
  INSERT INTO scheduling_bookings (user_id, service_id, contact_id, client_first_name, client_last_name, client_email, client_phone, start_time, end_time, status, payment_status) VALUES
    (target_user_id, service_2_id, contact_1_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', NOW() + INTERVAL '1 day' + INTERVAL '10 hours', NOW() + INTERVAL '1 day' + INTERVAL '11 hours', 'confirmed', 'pending'),
    (target_user_id, service_2_id, contact_2_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', NOW() + INTERVAL '2 days' + INTERVAL '14 hours', NOW() + INTERVAL '2 days' + INTERVAL '15 hours', 'confirmed', 'paid'),
    (target_user_id, service_1_id, contact_4_id, 'David', 'Brown', 'david.brown@email.com', '+1-555-0104', NOW() + INTERVAL '3 days' + INTERVAL '9 hours', NOW() + INTERVAL '3 days' + INTERVAL '9 hours 30 minutes', 'confirmed', 'pending');

  -- Past bookings this month (15 completed)
  INSERT INTO scheduling_bookings (user_id, service_id, contact_id, client_first_name, client_last_name, client_email, client_phone, start_time, end_time, status, payment_status, created_at) VALUES
    (target_user_id, service_2_id, contact_1_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', NOW() - INTERVAL '3 days' + INTERVAL '10 hours', NOW() - INTERVAL '3 days' + INTERVAL '11 hours', 'completed', 'paid', NOW() - INTERVAL '5 days'),
    (target_user_id, service_2_id, contact_2_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', NOW() - INTERVAL '5 days' + INTERVAL '14 hours', NOW() - INTERVAL '5 days' + INTERVAL '15 hours', 'completed', 'paid', NOW() - INTERVAL '7 days'),
    (target_user_id, service_2_id, contact_3_id, 'Emma', 'Williams', 'emma.williams@email.com', '+1-555-0103', NOW() - INTERVAL '7 days' + INTERVAL '11 hours', NOW() - INTERVAL '7 days' + INTERVAL '12 hours', 'completed', 'paid', NOW() - INTERVAL '10 days'),
    (target_user_id, service_1_id, contact_5_id, 'Lisa', 'Garcia', 'lisa.garcia@email.com', '+1-555-0105', NOW() - INTERVAL '8 days' + INTERVAL '9 hours', NOW() - INTERVAL '8 days' + INTERVAL '9 hours 30 minutes', 'completed', 'pending', NOW() - INTERVAL '10 days'),
    (target_user_id, service_2_id, contact_1_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', NOW() - INTERVAL '10 days' + INTERVAL '10 hours', NOW() - INTERVAL '10 days' + INTERVAL '11 hours', 'completed', 'paid', NOW() - INTERVAL '12 days'),
    (target_user_id, service_2_id, contact_2_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', NOW() - INTERVAL '12 days' + INTERVAL '14 hours', NOW() - INTERVAL '12 days' + INTERVAL '15 hours', 'completed', 'paid', NOW() - INTERVAL '14 days'),
    (target_user_id, service_1_id, contact_6_id, 'James', 'Martinez', 'james.martinez@email.com', '+1-555-0106', NOW() - INTERVAL '14 days' + INTERVAL '9 hours', NOW() - INTERVAL '14 days' + INTERVAL '9 hours 30 minutes', 'completed', 'pending', NOW() - INTERVAL '16 days'),
    (target_user_id, service_2_id, contact_3_id, 'Emma', 'Williams', 'emma.williams@email.com', '+1-555-0103', NOW() - INTERVAL '15 days' + INTERVAL '11 hours', NOW() - INTERVAL '15 days' + INTERVAL '12 hours', 'completed', 'paid', NOW() - INTERVAL '17 days'),
    (target_user_id, service_2_id, contact_1_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', NOW() - INTERVAL '17 days' + INTERVAL '10 hours', NOW() - INTERVAL '17 days' + INTERVAL '11 hours', 'completed', 'paid', NOW() - INTERVAL '19 days'),
    (target_user_id, service_2_id, contact_2_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', NOW() - INTERVAL '19 days' + INTERVAL '14 hours', NOW() - INTERVAL '19 days' + INTERVAL '15 hours', 'completed', 'paid', NOW() - INTERVAL '21 days'),
    (target_user_id, service_1_id, contact_7_id, 'Mark', 'Davis', 'mark.davis@email.com', '+1-555-0112', NOW() - INTERVAL '20 days' + INTERVAL '9 hours', NOW() - INTERVAL '20 days' + INTERVAL '9 hours 30 minutes', 'completed', 'pending', NOW() - INTERVAL '22 days'),
    (target_user_id, service_2_id, contact_3_id, 'Emma', 'Williams', 'emma.williams@email.com', '+1-555-0103', NOW() - INTERVAL '22 days' + INTERVAL '11 hours', NOW() - INTERVAL '22 days' + INTERVAL '12 hours', 'completed', 'paid', NOW() - INTERVAL '24 days'),
    (target_user_id, service_2_id, contact_1_id, 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-0101', NOW() - INTERVAL '24 days' + INTERVAL '10 hours', NOW() - INTERVAL '24 days' + INTERVAL '11 hours', 'completed', 'paid', NOW() - INTERVAL '26 days'),
    (target_user_id, service_1_id, contact_8_id, 'Susan', 'Miller', 'susan.miller@email.com', '+1-555-0113', NOW() - INTERVAL '25 days' + INTERVAL '9 hours', NOW() - INTERVAL '25 days' + INTERVAL '9 hours 30 minutes', 'completed', 'pending', NOW() - INTERVAL '27 days'),
    (target_user_id, service_2_id, contact_2_id, 'Michael', 'Chen', 'michael.chen@email.com', '+1-555-0102', NOW() - INTERVAL '28 days' + INTERVAL '14 hours', NOW() - INTERVAL '28 days' + INTERVAL '15 hours', 'completed', 'paid', NOW() - INTERVAL '30 days');

  RAISE NOTICE 'Created 18 scheduling bookings';

  -- =====================================================
  -- 6. CREATE PAYMENT INVOICES (2 pending, rest paid)
  -- =====================================================

  -- Pending invoices ($450 waiting from 2 people)
  INSERT INTO payment_invoices (id, user_id, contact_id, invoice_number, amount, currency, status, due_date, line_items, created_at)
  VALUES (gen_random_uuid(), target_user_id, contact_7_id, 'INV-2026-001', 300.00, 'USD', 'sent', NOW() + INTERVAL '7 days',
    '[{"description": "Coaching Session (2x)", "quantity": 2, "unit_price": 150.00, "total": 300.00}]'::jsonb,
    NOW() - INTERVAL '10 days')
  RETURNING id INTO invoice_1_id;

  INSERT INTO payment_invoices (id, user_id, contact_id, invoice_number, amount, currency, status, due_date, line_items, created_at)
  VALUES (gen_random_uuid(), target_user_id, contact_8_id, 'INV-2026-002', 150.00, 'USD', 'overdue', NOW() - INTERVAL '3 days',
    '[{"description": "Coaching Session", "quantity": 1, "unit_price": 150.00, "total": 150.00}]'::jsonb,
    NOW() - INTERVAL '17 days')
  RETURNING id INTO invoice_2_id;

  -- Paid invoices (for the $2,450 revenue)
  INSERT INTO payment_invoices (id, user_id, contact_id, invoice_number, amount, currency, status, due_date, paid_at, line_items, created_at)
  VALUES (gen_random_uuid(), target_user_id, contact_1_id, 'INV-2026-003', 600.00, 'USD', 'paid', NOW() - INTERVAL '5 days', NOW() - INTERVAL '3 days',
    '[{"description": "Coaching Sessions (4x)", "quantity": 4, "unit_price": 150.00, "total": 600.00}]'::jsonb,
    NOW() - INTERVAL '25 days')
  RETURNING id INTO invoice_3_id;

  INSERT INTO payment_invoices (user_id, contact_id, invoice_number, amount, currency, status, due_date, paid_at, line_items, created_at) VALUES
    (target_user_id, contact_2_id, 'INV-2026-004', 450.00, 'USD', 'paid', NOW() - INTERVAL '10 days', NOW() - INTERVAL '8 days',
      '[{"description": "Coaching Sessions (3x)", "quantity": 3, "unit_price": 150.00, "total": 450.00}]'::jsonb,
      NOW() - INTERVAL '20 days'),
    (target_user_id, contact_3_id, 'INV-2026-005', 450.00, 'USD', 'paid', NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days',
      '[{"description": "Coaching Sessions (3x)", "quantity": 3, "unit_price": 150.00, "total": 450.00}]'::jsonb,
      NOW() - INTERVAL '25 days'),
    (target_user_id, contact_1_id, 'INV-2026-006', 300.00, 'USD', 'paid', NOW() - INTERVAL '20 days', NOW() - INTERVAL '19 days',
      '[{"description": "Coaching Sessions (2x)", "quantity": 2, "unit_price": 150.00, "total": 300.00}]'::jsonb,
      NOW() - INTERVAL '28 days'),
    (target_user_id, contact_2_id, 'INV-2026-007', 300.00, 'USD', 'paid', NOW() - INTERVAL '22 days', NOW() - INTERVAL '21 days',
      '[{"description": "Coaching Sessions (2x)", "quantity": 2, "unit_price": 150.00, "total": 300.00}]'::jsonb,
      NOW() - INTERVAL '29 days'),
    (target_user_id, contact_3_id, 'INV-2026-008', 225.00, 'USD', 'paid', NOW() - INTERVAL '25 days', NOW() - INTERVAL '24 days',
      '[{"description": "Deep Dive Session", "quantity": 1, "unit_price": 225.00, "total": 225.00}]'::jsonb,
      NOW() - INTERVAL '30 days'),
    (target_user_id, contact_1_id, 'INV-2026-009', 125.00, 'USD', 'paid', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day',
      '[{"description": "Follow-up Call + Coaching", "quantity": 1, "unit_price": 125.00, "total": 125.00}]'::jsonb,
      NOW() - INTERVAL '5 days');

  RAISE NOTICE 'Created payment invoices (2 pending, rest paid)';

  -- =====================================================
  -- 7. CREATE PAYMENT TRANSACTIONS (matching revenue ~$2,450)
  -- =====================================================
  INSERT INTO payment_transactions (user_id, contact_id, invoice_id, amount, currency, status, payment_method, description, paid_at, created_at) VALUES
    (target_user_id, contact_1_id, invoice_3_id, 600.00, 'USD', 'succeeded', 'card', 'Payment for 4 coaching sessions', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
    (target_user_id, contact_2_id, NULL, 450.00, 'USD', 'succeeded', 'card', 'Payment for 3 coaching sessions', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
    (target_user_id, contact_3_id, NULL, 450.00, 'USD', 'succeeded', 'card', 'Payment for 3 coaching sessions', NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
    (target_user_id, contact_1_id, NULL, 300.00, 'USD', 'succeeded', 'card', 'Payment for 2 coaching sessions', NOW() - INTERVAL '19 days', NOW() - INTERVAL '19 days'),
    (target_user_id, contact_2_id, NULL, 300.00, 'USD', 'succeeded', 'card', 'Payment for 2 coaching sessions', NOW() - INTERVAL '21 days', NOW() - INTERVAL '21 days'),
    (target_user_id, contact_3_id, NULL, 225.00, 'USD', 'succeeded', 'bank_transfer', 'Payment for deep dive session', NOW() - INTERVAL '24 days', NOW() - INTERVAL '24 days'),
    (target_user_id, contact_1_id, NULL, 125.00, 'USD', 'succeeded', 'card', 'Payment for follow-up session', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');

  RAISE NOTICE 'Created payment transactions (total revenue: $2,450)';

  -- =====================================================
  -- 8. CREATE CRM ACTIVITIES (recent interactions)
  -- =====================================================
  INSERT INTO crm_activities (user_id, contact_id, activity_type, title, description, auto_logged, source_capability, activity_date) VALUES
    (target_user_id, contact_1_id, 'note', 'Great progress', 'Sarah is making excellent progress on her goals. Very motivated.', false, 'manual', NOW() - INTERVAL '1 day'),
    (target_user_id, contact_2_id, 'email', 'Follow-up sent', 'Sent check-in email after last session', false, 'manual', NOW() - INTERVAL '2 days'),
    (target_user_id, contact_3_id, 'call', 'Quick check-in', 'Called to confirm next appointment', false, 'manual', NOW() - INTERVAL '3 days'),
    (target_user_id, contact_4_id, 'note', 'Initial contact', 'Interested in career coaching. Will schedule discovery call.', false, 'manual', NOW() - INTERVAL '1 day'),
    (target_user_id, contact_5_id, 'email', 'Welcome email', 'Sent welcome packet and onboarding materials', false, 'manual', NOW() - INTERVAL '2 days'),
    (target_user_id, contact_6_id, 'meeting', 'Discovery call completed', 'Great conversation. Ready to start coaching package.', false, 'manual', NOW() - INTERVAL '3 days');

  RAISE NOTICE 'Created CRM activities';

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'SEED DATA COMPLETE!';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '- 47 CRM contacts (8 new this week, 3 became clients, 5 went quiet)';
  RAISE NOTICE '- 18 scheduling bookings this month (3 upcoming this week)';
  RAISE NOTICE '- $2,450 revenue (7 paid transactions)';
  RAISE NOTICE '- 2 pending invoices ($450 total from 2 people)';
  RAISE NOTICE '- Pipeline stages configured';
  RAISE NOTICE '- Recent activities logged';
  RAISE NOTICE '=====================================================';

END $$;
