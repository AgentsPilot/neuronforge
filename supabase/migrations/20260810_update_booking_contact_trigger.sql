-- =====================================================
-- Migration: Update booking contact creation trigger
--
-- This updates the create_crm_contact_from_booking trigger to handle the new flow where:
-- 1. Contacts are ALWAYS created BEFORE booking (in /api/website/booking/create)
-- 2. contact_id is ALWAYS set on scheduling_bookings (no longer nullable after code deployment)
-- 3. client_* fields will be removed in future migration
--
-- New trigger behavior:
-- - For free bookings (payment_status='paid'): Contact already exists, just ensure link
-- - For paid bookings (payment_status='pending'): Contact already exists as 'lead', just ensure link
-- - Legacy bookings without contact_id: Create contact from client_* fields (backward compatibility)
--
-- IMPORTANT: This is a transitional migration
-- Once all bookings use the new flow, we can simplify or remove this trigger entirely
-- =====================================================

-- Drop the existing trigger
DROP TRIGGER IF EXISTS create_crm_contact_from_booking_trigger ON scheduling_bookings;

-- Update the function to handle new flow
CREATE OR REPLACE FUNCTION create_crm_contact_from_booking()
RETURNS TRIGGER AS $$
DECLARE
  active_stage TEXT;
  found_contact_id UUID;
BEGIN
  -- New flow: contact_id should ALWAYS be set from /create endpoint
  -- If it's already set, we're done (this is the normal case now)
  IF NEW.contact_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Legacy fallback: Handle old bookings without contact_id
  -- This should rarely happen after code deployment, but provides backward compatibility
  -- IMPORTANT: This block uses client_* fields which will be removed in future migration

  -- Determine the best "active client" stage from user's pipeline
  -- Priority: 'active_client' > 'active' > 'client' > fallback to 'client'
  SELECT stage_key INTO active_stage
  FROM crm_pipeline_stages
  WHERE user_id = NEW.user_id
    AND stage_key IN ('active_client', 'active', 'client')
  ORDER BY
    CASE stage_key
      WHEN 'active_client' THEN 1
      WHEN 'active' THEN 2
      WHEN 'client' THEN 3
    END
  LIMIT 1;

  -- Fallback to 'client' if no matching stage found
  IF active_stage IS NULL THEN
    active_stage := 'client';
  END IF;

  -- Only create contact if one doesn't exist with this email
  -- For free bookings (payment_status != 'pending'), create as active client
  -- For paid bookings (payment_status = 'pending'), create as lead (will upgrade after payment)
  IF NEW.client_email IS NOT NULL THEN
    -- Check if contact exists
    SELECT id INTO found_contact_id
    FROM crm_contacts
    WHERE user_id = NEW.user_id AND email = NEW.client_email
    LIMIT 1;

    IF found_contact_id IS NULL THEN
      -- Create new contact
      INSERT INTO crm_contacts (
        user_id,
        first_name,
        last_name,
        email,
        phone,
        stage,
        source
      ) VALUES (
        NEW.user_id,
        NEW.client_first_name,
        NEW.client_last_name,
        NEW.client_email,
        NEW.client_phone,
        CASE
          WHEN NEW.payment_status = 'pending' THEN 'lead'
          ELSE active_stage
        END,
        'booking'
      )
      RETURNING id INTO found_contact_id;
    END IF;

    -- Link booking to contact
    NEW.contact_id := found_contact_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER create_crm_contact_from_booking_trigger
  BEFORE INSERT ON scheduling_bookings
  FOR EACH ROW
  EXECUTE FUNCTION create_crm_contact_from_booking();

-- Add comment explaining the trigger's purpose
COMMENT ON FUNCTION create_crm_contact_from_booking() IS
'Trigger function to ensure booking has contact_id. With new flow, contact is created FIRST in /create endpoint, so this mostly handles legacy bookings. Will be simplified after client_* fields are removed.';
