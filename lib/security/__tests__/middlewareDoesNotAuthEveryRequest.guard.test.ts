/**
 * Middleware does not pay for an onboarding answer it cannot use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Middleware ran two network round trips on every request that was not
 * explicitly exempt: `auth.getUser` against Supabase Auth, measured at 1.58s,
 * and a `business_profiles` read at a further 262ms. Nothing cached the answer
 * and nothing shared a lookup, so the next request paid it again.
 *
 * Measured on `/.well-known/appspecific/com.chrome.devtools.json` — a file
 * Chrome requests unprompted — at 1.85 SECONDS for a probe no human asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO PREFETCH ASSERTION HERE
 *
 * The obvious fix was to skip when `Next-Router-Prefetch: 1` is present, since
 * Next prefetches every `<Link>` in the viewport and those were the burst.
 *
 * It does not work, and this records why so nobody writes it again. Next
 * STRIPS its own routing headers before middleware runs. A request sent with
 * `Next-Router-Prefetch`, `RSC` and `purpose` arrived carrying only:
 *
 *     accept, host, purpose, user-agent, x-forwarded-*
 *
 * Both Next headers were gone. A prefetch cannot be told from a navigation
 * here, so the burst is handled where it lands instead: one shared in-flight
 * lookup per token, proved behaviourally in `onboardingVerdict.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT WEAKENED
 *
 * The redirect. A user who has not finished onboarding is still sent to
 * `/onboarding-chat`, and `/v2`, `/admin` and `/` still reach the check.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const mw = read('middleware.ts');
const verdict = read('lib/security/onboardingVerdict.ts');

describe('requests that cannot act on the answer never ask for it', () => {
  it('skips the files browsers and tools fetch on their own', () => {
    // `.json` was the one missing, and it is the one Chrome asks for.
    const at = mw.indexOf('pathname.match(');
    const allowlist = mw.slice(at, at + 300);

    for (const ext of ['json', 'txt', 'xml', 'map', 'webmanifest']) {
      expect(allowlist).toContain(ext);
    }
    expect(mw).toMatch(/startsWith\('\/\.well-known\/'\)/);
  });

  it('records that a prefetch cannot be detected, so nobody retries it', () => {
    // The measurement, kept where the next person will look for it.
    expect(mw).toMatch(/STRIPS its own routing headers/);
    expect(mw).not.toMatch(/Next-Router-Prefetch'\) === '1'/);
  });

  it('still protects the paths it is there for', () => {
    expect(mw).toMatch(/IMPORTANT: \/v2, \/admin, and \/ are NOT in the skip list/);
    expect(mw).toMatch(/url\.pathname = '\/onboarding-chat'/);
  });

  it('keeps the public portal exempt, so it pays nothing', () => {
    /*
     * `/book/`, `/invoice/`, `/proposal/`, `/consent/` return before any auth
     * work. They were ruled out as a cause of the crash and must stay that way.
     */
    for (const prefix of ["'/book/'", "'/invoice/'", "'/proposal/'", "'/consent/'"]) {
      expect(mw).toContain(prefix);
    }
  });
});

describe('the middleware delegates rather than inlining the lookup', () => {
  it('calls the shared verdict', () => {
    expect(mw).toMatch(/await onboardingVerdict\(accessToken, requestLogger\)/);
  });

  it('builds no Supabase client of its own', () => {
    /*
     * It constructed one per request for a single read. The only `createClient`
     * left in the request path is the memoised one inside the verdict module.
     */
    expect(mw).not.toMatch(/createClient\(/);
  });

  it('redirects only on a definite "onboard"', () => {
    // `unknown` continues: an auth hiccup must not become a redirect loop.
    expect(mw).toMatch(/verdict === 'onboard'/);
  });
});

describe('the verdict module keeps its guarantees', () => {
  it('shares one in-flight lookup per token', () => {
    expect(verdict).toMatch(/const existing = inflight\.get\(accessToken\)/);
    expect(verdict).toMatch(/inflight\.delete\(accessToken\)/);
  });

  it('clears in-flight entries in a finally, so a rejection cannot poison it', () => {
    expect(verdict).toMatch(/finally \{[\s\S]{0,80}inflight\.delete\(accessToken\)/);
  });

  it('bounds the cache and expires it', () => {
    expect(verdict).toMatch(/ONBOARDING_CACHE_MAX/);
    expect(verdict).toMatch(/onboardingCache\.delete\(oldest\)/);
    expect(verdict).toMatch(/hit\.expiresAt < Date\.now\(\)/);
  });

  it('answers "unknown" on a failed profile read, rather than redirecting', () => {
    /*
     * This used to assert `if (!profileError) rememberOnboarding(...)`, which
     * kept a failed read out of the cache but still returned 'onboard'. Not
     * caching a wrong answer is not the same as not giving one, and on
     * 2026-10-29 that distinction was an hour and a half of production
     * bouncing between `/onboarding-chat` and `/business-os`.
     */
    expect(verdict).toMatch(/if \(profileError\)[\s\S]{0,900}return 'unknown'/);
  });

  it('says so out loud when the profile read fails', () => {
    /*
     * The edge logger drops `debug` outside development, so a failed read that
     * only logs at debug is invisible in production — the gate would be off
     * platform-wide with nothing to attribute it to. `warn` is the lowest level
     * that survives.
     */
    expect(verdict).toMatch(/log\.warn\(/);
  });

  it('tells a missing profile row apart from a failed read', () => {
    /*
     * `single` reports "no row" as a PGRST116 error, so under it every user
     * who has not onboarded yet — most of them — is indistinguishable from
     * the database being down. The verdicts for those two are opposites.
     */
    expect(verdict).toMatch(/\.maybeSingle\(\)/);
    expect(verdict).not.toMatch(/\.single\(\)/);
  });

  it('reuses one Supabase client per instance', () => {
    expect(verdict).toMatch(/function getServiceClient\(\)/);
    expect(verdict.match(/createClient\(/g) ?? []).toHaveLength(1);
  });
});
