-- Allow NULL start_time and end_time for non-scheduled bookings
-- Purpose: Support courses, products, and other offerings that don't require scheduling
-- Last Updated: 2026-08-03

-- =============================================
-- MODIFY SCHEDULING_BOOKINGS TABLE
-- =============================================

-- Make start_time nullable (for non-scheduled bookings like courses/products)
ALTER TABLE scheduling_bookings
ALTER COLUMN start_time DROP NOT NULL;

-- Make end_time nullable (for non-scheduled bookings like courses/products)
ALTER TABLE scheduling_bookings
ALTER COLUMN end_time DROP NOT NULL;

-- =============================================
-- UPDATE TRIGGER TO HANDLE NULL start_time
-- =============================================

-- Update the activity logging trigger to handle NULL start_time
CREATE OR REPLACE FUNCTION log_booking_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_title TEXT;
  activity_desc TEXT;
  activity_datetime TIMESTAMPTZ;
BEGIN
  -- Determine activity based on status
  CASE NEW.status
    WHEN 'confirmed' THEN
      activity_title := 'Booking Confirmed: ' || (SELECT service_name FROM scheduling_services WHERE id = NEW.service_id);
      -- Handle NULL start_time for non-scheduled bookings
      IF NEW.start_time IS NOT NULL THEN
        activity_desc := 'Scheduled for ' || TO_CHAR(NEW.start_time, 'YYYY-MM-DD HH24:MI');
        activity_datetime := NEW.start_time;
      ELSE
        activity_desc := 'Purchase confirmed';
        activity_datetime := NEW.created_at;
      END IF;
    WHEN 'cancelled' THEN
      activity_title := 'Booking Cancelled';
      activity_desc := COALESCE(NEW.cancellation_reason, 'No reason provided');
      activity_datetime := COALESCE(NEW.start_time, NEW.created_at);
    WHEN 'completed' THEN
      activity_title := 'Session Completed';
      activity_desc := (SELECT service_name FROM scheduling_services WHERE id = NEW.service_id);
      activity_datetime := COALESCE(NEW.start_time, NEW.created_at);
    WHEN 'no_show' THEN
      activity_title := 'No-Show';
      activity_desc := 'Client did not attend scheduled session';
      activity_datetime := COALESCE(NEW.start_time, NEW.created_at);
    ELSE
      RETURN NEW;
  END CASE;

  -- Create activity if contact exists
  IF NEW.contact_id IS NOT NULL THEN
    INSERT INTO crm_activities (
      user_id,
      contact_id,
      activity_type,
      title,
      description,
      auto_logged,
      source_capability,
      source_entity_id,
      activity_date
    ) VALUES (
      NEW.user_id,
      NEW.contact_id,
      'booking',
      activity_title,
      activity_desc,
      true,
      'scheduling',
      NEW.id,
      activity_datetime
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON COLUMN scheduling_bookings.start_time IS 'Scheduled start time. NULL for non-scheduled bookings (courses, products, etc.)';
COMMENT ON COLUMN scheduling_bookings.end_time IS 'Scheduled end time. NULL for non-scheduled bookings (courses, products, etc.)';
