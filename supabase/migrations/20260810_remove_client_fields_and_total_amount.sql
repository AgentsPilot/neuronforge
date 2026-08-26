-- =====================================================
-- Migration: Remove client_* and total_amount from scheduling_bookings
--
-- This is the FINAL migration in the data cleanup series.
--
-- Removes:
-- 1. client_first_name, client_last_name, client_email, client_phone
--    → Client data now ONLY in crm_contacts (single source of truth)
-- 2. total_amount
--    → Payment amounts now ONLY in payment_transactions (prevents double-counting)
--
-- Prerequisites (MUST be completed BEFORE running this migration):
-- 1. All application code updated to use JOINs to crm_contacts (not client_* fields)
-- 2. All revenue calculations updated to use payment_transactions only
-- 3. Database trigger updated to not reference client_* fields
-- 4. All bookings have contact_id set (no NULL values)
--
-- CRITICAL: This is a DESTRUCTIVE migration that drops columns permanently!
-- Ensure all code is deployed and tested before running this.
-- =====================================================

-- Step 1: Check if client_* columns still exist (they might have been dropped already)
DO $$
DECLARE
  client_email_exists BOOLEAN;
  orphaned_count INTEGER;
BEGIN
  -- Check if client_email column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduling_bookings'
    AND column_name = 'client_email'
  ) INTO client_email_exists;

  -- Only check for orphaned bookings if columns still exist
  IF client_email_exists THEN
    SELECT COUNT(*) INTO orphaned_count
    FROM scheduling_bookings
    WHERE contact_id IS NULL;

    IF orphaned_count > 0 THEN
      RAISE WARNING 'Found % bookings with NULL contact_id. Will attempt to backfill.', orphaned_count;
    END IF;
  ELSE
    RAISE NOTICE 'client_* columns already dropped - skipping orphan check';
  END IF;
END $$;

-- Step 2: Backfill orphaned bookings ONLY if client_* columns still exist
-- This handles the case where columns were already dropped in a previous migration attempt
DO $$
DECLARE
  client_email_exists BOOLEAN;
BEGIN
  -- Check if client_email column still exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduling_bookings'
    AND column_name = 'client_email'
  ) INTO client_email_exists;

  -- Only backfill if columns exist
  IF client_email_exists THEN
    -- Create contacts from booking data for any bookings without contact_id
    INSERT INTO crm_contacts (user_id, first_name, last_name, email, phone, source, stage)
    SELECT DISTINCT
      sb.user_id,
      sb.client_first_name,
      sb.client_last_name,
      sb.client_email,
      sb.client_phone,
      'booking_migration',
      'lead'
    FROM scheduling_bookings sb
    WHERE sb.contact_id IS NULL
      AND sb.client_email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM crm_contacts c
        WHERE c.user_id = sb.user_id AND c.email = sb.client_email
      );

    -- Link orphaned bookings to their contacts
    UPDATE scheduling_bookings sb
    SET contact_id = c.id
    FROM crm_contacts c
    WHERE sb.contact_id IS NULL
      AND sb.client_email IS NOT NULL
      AND c.email = sb.client_email
      AND c.user_id = sb.user_id;

    RAISE NOTICE 'Backfilled orphaned bookings';
  ELSE
    RAISE NOTICE 'client_* columns already dropped - skipping backfill';
  END IF;
END $$;

-- Step 3: Verify all bookings have contact_id before making it NOT NULL
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM scheduling_bookings
  WHERE contact_id IS NULL;

  IF orphaned_count > 0 THEN
    RAISE EXCEPTION 'Cannot make contact_id NOT NULL: % bookings still have NULL contact_id. Manual intervention required.', orphaned_count;
  END IF;

  RAISE NOTICE 'All bookings have contact_id - safe to enforce NOT NULL constraint';
END $$;

-- Make contact_id NOT NULL (enforce data integrity)
-- This ensures new bookings MUST have a contact
ALTER TABLE scheduling_bookings
ALTER COLUMN contact_id SET NOT NULL;

-- Step 4: Drop client_* columns (no longer needed - data in crm_contacts)
ALTER TABLE scheduling_bookings
DROP COLUMN IF EXISTS client_first_name,
DROP COLUMN IF EXISTS client_last_name,
DROP COLUMN IF EXISTS client_email,
DROP COLUMN IF EXISTS client_phone;

-- Step 5: Drop total_amount column (no longer needed - data in payment_transactions)
ALTER TABLE scheduling_bookings
DROP COLUMN IF EXISTS total_amount;

-- Step 6: Update contact_id column comment for documentation
COMMENT ON COLUMN scheduling_bookings.contact_id IS
'Foreign key to crm_contacts (NOT NULL) - single source of truth for client data. Client name/email/phone retrieved via JOIN.';

-- Step 7: Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully:';
  RAISE NOTICE '- Removed client_first_name, client_last_name, client_email, client_phone columns';
  RAISE NOTICE '- Removed total_amount column';
  RAISE NOTICE '- contact_id now NOT NULL (enforced data integrity)';
  RAISE NOTICE '- Client data now ONLY in crm_contacts (single source of truth)';
  RAISE NOTICE '- Payment amounts now ONLY in payment_transactions (no double-counting)';
END $$;

-- =====================================================
-- Post-Migration Verification Queries
-- =====================================================

-- Verify all bookings have contact_id
-- SELECT COUNT(*) as total_bookings,
--        COUNT(contact_id) as with_contact_id
-- FROM scheduling_bookings;
-- (Should be equal)

-- Verify revenue is only in payment_transactions
-- SELECT
--   SUM(amount) as revenue_from_payments,
--   (SELECT COUNT(*) FROM scheduling_bookings) as total_bookings
-- FROM payment_transactions
-- WHERE status = 'succeeded';

-- Verify client data retrieval works via JOIN
-- SELECT
--   b.id,
--   b.start_time,
--   c.first_name,
--   c.last_name,
--   c.email
-- FROM scheduling_bookings b
-- JOIN crm_contacts c ON b.contact_id = c.id
-- LIMIT 5;
