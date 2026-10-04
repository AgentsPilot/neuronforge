BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER POLICY "Users can view their own audit logs" ON public.audit_trail
  USING (auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action');

COMMIT;
