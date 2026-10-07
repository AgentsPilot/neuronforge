BEGIN;

REVOKE SELECT ON TABLE public.boost_packs FROM anon;
REVOKE SELECT ON TABLE public.boost_packs FROM authenticated;

COMMIT;
