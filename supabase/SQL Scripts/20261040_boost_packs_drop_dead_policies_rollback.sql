BEGIN;

CREATE POLICY "Boost packs are publicly readable" ON public.boost_packs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "Service role can manage boost packs" ON public.boost_packs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role');

COMMIT;
