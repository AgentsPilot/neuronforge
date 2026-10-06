/**
 * One address policy: localhost on a laptop, the real domain everywhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG ON VERCEL
 *
 * `NEXT_PUBLIC_APP_URL` is ONE value per environment, and a deployed build hands
 * out whatever it was set to. Set from a copy of `.env.local` — the obvious
 * thing to do — it is `http://localhost:3000`, and then every absolute URL the
 * platform produces points at the machine of whoever configured it. `NODE_ENV`
 * cannot catch it either: Vercel builds previews with `NODE_ENV=production`, so
 * the localhost address arrives as CONFIGURATION, not as a fallback.
 *
 * `lib/utils/origins.ts` exists to answer this once: it refuses a loopback
 * address when running on Vercel, prefers the deployment's own host on a
 * preview, and the stable production domain in production. The bug was never in
 * that module — it was in the thirteen call sites that never asked it, each
 * reading the variable itself with `|| 'http://localhost:3000'` behind it.
 *
 * Those links are not internal plumbing. They are what a CLIENT receives:
 * reschedule and cancel in a booking confirmation, the intake form, an invoice,
 * the business's own website address, the "book again" button — and the URLs
 * Stripe sends an owner back to after onboarding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO DELIBERATE EXCEPTIONS
 *
 * An OAuth `redirect_uri` must match what is REGISTERED with the provider, so
 * it cannot follow a per-deployment host. And `lib/email/platformBranding.ts`
 * reads the variable directly on purpose, accepting it only when it is `https`,
 * because an email logo has to be fetchable from the recipient's device and the
 * resolver's production fallback is a host that does not answer yet. Both are
 * listed below rather than silently tolerated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** Where the policy is decided, and the only file allowed to read the variable. */
const RESOLVER = 'lib/utils/origins.ts';

/**
 * Files that read `NEXT_PUBLIC_APP_URL` for a reason the resolver cannot serve.
 * This list should only ever shrink.
 */
const ALLOWED = [
  RESOLVER,
  // An email logo must be fetchable from the recipient's device; accepted only
  // when https, which rejects localhost by construction. See the module note.
  'lib/email/platformBranding.ts',
];

/**
 * An OAuth `redirect_uri` has to match the provider's registration, verbatim —
 * a per-deployment host would simply be rejected at the provider's end, so
 * these cannot follow the resolver and must keep reading the configured value.
 *
 * Both halves are needed. A LINE that names a redirect catches
 * `app/api/v2/plugins/connect/route.ts`, which builds one and has "oauth"
 * nowhere in its path. An explicit FILE list catches the strategies, which
 * compute a `baseUrl` on one line and append the callback path on another.
 *
 * Listed rather than pattern-matched so the set is auditable and shrinks only
 * on purpose.
 */
const isOAuthRedirect = (line: string) => /redirect_uri|redirectUri|oauth\/callback/i.test(line);

const OAUTH_FILES = [
  'lib/plugins/strategies/gmailPluginStrategy.ts',
  'lib/plugins/strategies/googleDrivePluginStrategy.ts',
  'lib/plugins/strategies/slackPluginStrategy.ts',
  'lib/plugins/v2/core/UniversalOAuthHandler.ts',
  'app/oauth/callback/[plugin]/route.ts',
];

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.(test|backup)\./.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const FILES = ['lib', 'app'].flatMap(sourcesUnder);
const relative = (file: string) => file.replace(ROOT + '/', '');

describe('nobody hands out an address of their own', () => {
  it('scans a realistic number of files', () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it('no file falls back to a loopback address when building a URL', () => {
    /*
     * `|| 'http://localhost:3000'` is the shape this bug always took: correct on
     * the laptop it was written on and wrong on every deployment. A dev-origin
     * EQUALITY check is a different thing and stays allowed.
     */
    const offenders = FILES.filter(file => {
      if (relative(file) === RESOLVER) return false;
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return /\|\|\s*['"`]https?:\/\/localhost/.test(code);
    }).map(relative);

    expect(offenders).toEqual([]);
  });

  it('only the resolver and the documented exceptions read the variable', () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const name = relative(file);
      if (ALLOWED.includes(name) || OAUTH_FILES.includes(name)) continue;

      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      for (const line of code.split('\n')) {
        if (!line.includes('NEXT_PUBLIC_APP_URL')) continue;
        if (isOAuthRedirect(line)) continue;
        offenders.push(name);
        break;
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the client-facing builders go through the resolver', () => {
    // The two that put a link in front of a client.
    for (const file of ['lib/services/BookingEmailService.ts', 'lib/branding/platformSite.ts']) {
      const code = readFileSync(join(ROOT, file), 'utf8');
      expect(code).toContain("from '@/lib/utils/origins'");
      expect(code).toMatch(/platformOrigin\(\)/);
    }
  });
});
