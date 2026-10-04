BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER POLICY "Users can view their own audit logs" ON public.audit_trail
  USING (
    auth.uid() = user_id
    AND (entity_type IS NULL
         OR entity_type NOT IN ('ai_action', 'bos_queue_item', 'business_os_account_plan',
                                'business_os_credit_lot', 'business_os_credit_period'))
  );

COMMIT;
