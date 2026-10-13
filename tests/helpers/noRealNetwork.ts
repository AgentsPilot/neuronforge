/**
 * Fail a suite on any real network request.
 *
 * Why a recorder and not just a throwing `fetch`: the code a unit test reaches
 * often swallows the failure. `lib/ai/pricing.ts` never throws (a failed
 * price read keeps the cache and falls back), so a throwing stub alone would
 * turn a leak into a silent fallback and the test would still pass. Every
 * attempt is recorded, and an `afterEach` fails the case that made it.
 *
 * The flake this exists for (PR #340, 2026-10-13): `adminSettingsView.test.ts`
 * left `lib/ai/pricing` unstubbed, so the guardrail price check called
 * `aiModelPricingRepository.listActive()` for real — a fetch to the setup
 * file's placeholder Supabase URL that, on a slow DNS day, retried past Jest's
 * 5 s timeout. `supabaseFetch` calls the global `fetch` at request time, so
 * replacing it here catches every Supabase client, including module-level
 * singletons created before the suite ran.
 *
 * The stub's error is a plain `Error`, not a `TypeError: fetch failed`, so
 * `supabaseFetch` does not retry it — a leak fails fast instead of timing out.
 *
 * Coverage limits: it replaces the global `fetch` only (what every Supabase
 * client here uses), not raw `http` / `https` or an SDK with its own HTTP
 * client. It is installed in `beforeAll`, so a request made while a module is
 * being imported is not caught.
 *
 * Lives outside `__tests__` so Jest does not collect it as a suite.
 *
 * Usage: call `forbidRealNetwork()` once at the top level of a suite.
 */
export function forbidRealNetwork(): void {
  const attempts: string[] = [];
  let realFetch: typeof fetch | undefined;

  beforeAll(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      attempts.push(url);
      throw new Error(`Real network request blocked in a unit test: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    const made = attempts.splice(0);
    if (made.length > 0) {
      throw new Error(
        `This case made ${made.length} real network request(s) — stub the repository or ` +
          `module that reached them:\n  ${made.join('\n  ')}`
      );
    }
  });

  afterAll(() => {
    if (realFetch) globalThis.fetch = realFetch;
  });
}
