BEGIN;

CREATE INDEX business_os_boost_purchases_reconcile_idx
  ON public.business_os_boost_purchases (checkout_expires_at)
  WHERE status IN ('pending', 'awaiting_payment');

CREATE INDEX business_os_boost_purchases_receipt_backfill_idx
  ON public.business_os_boost_purchases (paid_at)
  WHERE status = 'paid' AND receipt_url IS NULL;

COMMIT;
