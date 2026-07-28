-- CRM Contact Creation Activity Trigger
-- Auto-logs a "contact_created" activity when a new contact is added

-- =====================================================
-- Function to log contact creation activity
-- =====================================================
CREATE OR REPLACE FUNCTION log_crm_contact_created()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert a "contact_created" activity for the newly created contact
  INSERT INTO crm_activities (
    user_id,
    contact_id,
    activity_type,
    title,
    description,
    auto_logged,
    source_capability,
    source_entity_id,
    activity_date,
    created_at
  ) VALUES (
    NEW.user_id,
    NEW.id,
    'contact_created',
    'Contact Created',
    jsonb_build_object(
      'source', COALESCE(NEW.source, 'manual'),
      'stage', NEW.stage
    )::text,
    true,
    'crm',
    NEW.id,
    NEW.created_at,
    NEW.created_at
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Trigger for contact creation
-- =====================================================
DROP TRIGGER IF EXISTS log_crm_contact_created_trigger ON crm_contacts;
CREATE TRIGGER log_crm_contact_created_trigger
  AFTER INSERT ON crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION log_crm_contact_created();
