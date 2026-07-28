-- Delete FUTURE Bookings When CRM Contact is Deleted
-- Only deletes future bookings - past bookings are preserved for history
-- This frees up the time slot and removes clutter from calendar

-- =====================================================
-- 1. Trigger function to delete future bookings before contact delete
-- =====================================================
CREATE OR REPLACE FUNCTION delete_future_bookings_on_contact_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete only FUTURE bookings for this contact (start_time > now)
  -- Past bookings are kept for historical records
  DELETE FROM scheduling_bookings
  WHERE contact_id = OLD.id
    AND start_time > now();  -- Only future bookings

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 2. Create trigger on crm_contacts BEFORE DELETE
-- =====================================================
DROP TRIGGER IF EXISTS cancel_bookings_on_contact_delete_trigger ON crm_contacts;
DROP TRIGGER IF EXISTS delete_future_bookings_on_contact_delete_trigger ON crm_contacts;
CREATE TRIGGER delete_future_bookings_on_contact_delete_trigger
  BEFORE DELETE ON crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION delete_future_bookings_on_contact_delete();

-- =====================================================
-- 3. Comment explaining the behavior
-- =====================================================
COMMENT ON FUNCTION delete_future_bookings_on_contact_delete() IS
  'Automatically deletes FUTURE bookings when a CRM contact is deleted.
   Past bookings are preserved for historical records.
   This keeps the calendar clean and frees up time slots.';
