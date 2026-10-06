BEGIN;

REVOKE ALL ON TABLE public.billing_events FROM anon;
REVOKE ALL ON TABLE public.billing_events FROM authenticated;
REVOKE ALL ON TABLE public.boost_pack_purchases FROM anon;
REVOKE ALL ON TABLE public.boost_pack_purchases FROM authenticated;
REVOKE ALL ON TABLE public.subscription_invoices FROM anon;
REVOKE ALL ON TABLE public.subscription_invoices FROM authenticated;
REVOKE ALL ON TABLE public.processed_webhook_events FROM anon;
REVOKE ALL ON TABLE public.processed_webhook_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.boost_packs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.boost_packs FROM authenticated;

COMMIT;
