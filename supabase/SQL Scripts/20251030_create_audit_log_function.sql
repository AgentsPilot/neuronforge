-- Create a database function to insert audit logs
-- This bypasses PostgREST's validation and works like raw SQL

CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT DEFAULT NULL,
  p_resource_name TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_changes JSONB DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT 'info',
  p_compliance_flags TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Run with the privileges of the function owner (bypasses RLS)
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- Validate severity
  IF p_severity NOT IN ('info', 'warning', 'critical') THEN
    RAISE EXCEPTION 'Invalid severity: %. Must be info, warning, or critical', p_severity;
  END IF;

  -- Insert the audit log
  INSERT INTO public.audit_trail (
    action,
    entity_type,
    entity_id,
    resource_name,
    user_id,
    actor_id,
    changes,
    details,
    ip_address,
    user_agent,
    session_id,
    severity,
    compliance_flags
  ) VALUES (
    p_action,
    p_entity_type,
    p_entity_id,
    p_resource_name,
    p_user_id,
    p_actor_id,
    p_changes,
    p_details,
    p_ip_address,
    p_user_agent,
    p_session_id,
    p_severity,
    p_compliance_flags
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION public.insert_audit_log TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_audit_log TO authenticated;

-- Comment
COMMENT ON FUNCTION public.insert_audit_log IS 'Insert audit log entry - bypasses PostgREST validation issues';

-- Test the function
SELECT public.insert_audit_log(
  p_action := 'TEST_FUNCTION_INSERT',
  p_entity_type := 'test',
  p_severity := 'info',
  p_user_id := '08456106-aa50-4810-b12c-7ca84102da31'::uuid,
  p_details := '{"test": "Using database function to bypass PostgREST"}'::jsonb
);
