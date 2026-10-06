BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN SHARE ROW EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.lot_id IS NOT NULL) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  a boost purchase already holds credits so the crediting functions were kept';
  END IF;
END
$refuse$;

DROP FUNCTION public.business_os_record_boost_receipt(uuid, text, text);

DROP FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text);

DROP FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean);

REVOKE UPDATE (stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at) ON TABLE public.business_os_boost_purchases FROM service_role;

COMMIT;
