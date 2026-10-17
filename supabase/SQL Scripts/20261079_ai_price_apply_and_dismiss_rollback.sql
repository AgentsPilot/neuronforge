BEGIN;
SET LOCAL lock_timeout = '2s';
LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing, public.ai_price_proposal_lines IN SHARE ROW EXCLUSIVE MODE;

DO $rollback_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_price_apply_batches AS batch_row) THEN
    RAISE EXCEPTION 'rollback refused  a price was applied with Apply  nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_price_proposal_lines AS price_line WHERE price_line.state = 'applied') THEN
    RAISE EXCEPTION 'rollback refused  a price line is applied  nothing was changed';
  END IF;
END
$rollback_guard$;

DROP FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text);
DROP FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text);
DROP FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb);
REVOKE UPDATE (decision_reason, override_reason, apply_batch_id) ON TABLE public.ai_price_proposal_lines FROM service_role;
DROP INDEX public.ai_price_proposal_lines_apply_batch_idx;
ALTER TABLE public.ai_price_proposal_lines DROP CONSTRAINT ai_price_proposal_lines_applied_batch_shape;
ALTER TABLE public.ai_price_proposal_lines DROP CONSTRAINT ai_price_proposal_lines_apply_batch_fkey;
ALTER TABLE public.ai_price_proposal_lines DROP COLUMN apply_batch_id;
DROP TRIGGER ai_price_apply_batches_transition ON public.ai_price_apply_batches;
DROP FUNCTION public.ai_price_apply_batch_transition();
DROP TABLE public.ai_price_apply_batches;

REVOKE ALL ON TABLE public.ai_model_pricing FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_model_pricing FROM anon;
REVOKE ALL ON TABLE public.ai_model_pricing FROM authenticated;
REVOKE ALL ON TABLE public.ai_model_pricing FROM service_role;
GRANT SELECT, MAINTAIN ON TABLE public.ai_model_pricing TO anon;
GRANT SELECT, MAINTAIN ON TABLE public.ai_model_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ai_model_pricing TO service_role;
CREATE POLICY ai_model_pricing_admin_write ON public.ai_model_pricing
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
COMMENT ON TABLE public.ai_model_pricing IS 'Per-token model pricing; every credit charge is computed from it. Written only by the service role through /api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; anon has no privileges beyond SELECT, which RLS then denies.';
COMMENT ON TABLE public.ai_model_image_pricing IS 'Price per generated image by provider model size and quality  Empty until the first approved price proposal  Written only by the service role  History is kept with retired_date and rows are never deleted';

COMMIT;
