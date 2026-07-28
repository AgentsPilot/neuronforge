-- =====================================================
-- Migration: Skip contact creation for pending payment bookings
--
-- This modifies the create_crm_contact_from_booking trigger to NOT
-- create contacts when payment_status = 'pending'. Contacts will be
-- created after payment is confirmed via the finalize endpoint.
--
-- For free services (immediate booking), contacts are created with
-- the appropriate "active client" stage based on the user's pipeline.
-- =====================================================

-- Drop the existing trigger
DROP TRIGGER IF EXISTS create_crm_contact_from_booking_trigger ON scheduling_bookings;

-- Update the function to check payment_status and use dynamic pipeline stages
CREATE OR REPLACE FUNCTION create_crm_contact_from_booking()
RETURNS TRIGGER AS $$
DECLARE
  active_stage TEXT;
BEGIN
  -- Skip contact creation if payment is pending (contact will be created after payment)
  IF NEW.payment_status = 'pending' THEN
    RETURN NEW;
  END IF;

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
  IF NOT EXISTS (
    SELECT 1 FROM crm_contacts
    WHERE user_id = NEW.user_id AND email = NEW.client_email
  ) THEN
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
      active_stage, -- Use the user's pipeline stage for active clients
      'booking'
    );
  END IF;

  -- Link booking to contact (if contact exists)
  UPDATE scheduling_bookings
  SET contact_id = (
    SELECT id FROM crm_contacts
    WHERE user_id = NEW.user_id AND email = NEW.client_email
    LIMIT 1
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER create_crm_contact_from_booking_trigger
  AFTER INSERT ON scheduling_bookings
  FOR EACH ROW
  EXECUTE FUNCTION create_crm_contact_from_booking();
