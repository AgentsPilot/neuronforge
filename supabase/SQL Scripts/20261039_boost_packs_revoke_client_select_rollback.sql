BEGIN;

GRANT SELECT ON TABLE public.boost_packs TO anon;
GRANT SELECT ON TABLE public.boost_packs TO authenticated;

COMMIT;
