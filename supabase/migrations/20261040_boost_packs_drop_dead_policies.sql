BEGIN;

DROP POLICY "Boost packs are publicly readable" ON public.boost_packs;
DROP POLICY "Service role can manage boost packs" ON public.boost_packs;

COMMIT;
