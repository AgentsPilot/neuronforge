BEGIN;
SET LOCAL lock_timeout = '2s';
LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing, public.ai_price_proposal_lines IN SHARE ROW EXCLUSIVE MODE;

DO $rollback_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing WHERE pricing.proposal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused  a token price row came from a pending price line  nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model_image_pricing AS image_pricing WHERE image_pricing.proposal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused  an image price row came from a pending price line  nothing was changed';
  END IF;
END
$rollback_guard$;

DROP INDEX public.ai_model_image_pricing_proposal_line_idx;
ALTER TABLE public.ai_model_image_pricing DROP CONSTRAINT ai_model_image_pricing_proposal_line_fkey;
ALTER TABLE public.ai_model_image_pricing DROP CONSTRAINT ai_model_image_pricing_proposal_fkey;
DROP INDEX public.ai_model_pricing_proposal_line_idx;
ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_proposal_line_fkey;
ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_proposal_fkey;

DROP FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb);
DROP TRIGGER ai_price_proposal_lines_transition ON public.ai_price_proposal_lines;
DROP FUNCTION public.ai_price_proposal_line_transition();
DROP TABLE public.ai_price_proposal_lines;
DROP TABLE public.ai_price_proposals;

COMMIT;
