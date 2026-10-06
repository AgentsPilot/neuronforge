/**
 * The agent-platform billing UI is read-only (Business OS plan payments P-10b,
 * WS-3, SA ruling Q-6).
 *
 * P-1 and P-10a turned the Pilot-Credit purchase routes into 410 stubs:
 * `create-checkout` (subscription and boost pack), `update-subscription` and
 * `sync-subscription`. P-10b removed every first-party caller. This suite keeps
 * it that way, by source text:
 *
 *   1. No non-test file in the app, component, hook or lib trees names one of
 *      the three retired route paths (the route files themselves excepted).
 *   2. `BillingSettings` has no buy flow left: no browser read of `boost_packs`,
 *      no Stripe embedded checkout, no `console.*` (client Pino logger only),
 *      and it still calls the routes that serve existing subscriptions.
 *   3. The dead and replaced billing files stay deleted.
 *   4. `/v2/billing` is a server redirect to `/settings?tab=billing`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLIENT_AND_SERVER_TREES = ['app', 'components', 'hooks', 'lib'];
const SKIP_DIR = /^(node_modules|\.next|__tests__|coverage)$/;
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

const RETIRED_ROUTES = ['create-checkout', 'update-subscription', 'sync-subscription'] as const;
/** The 410 stubs name themselves in their header comment; that is not a caller. */
const RETIRED_ROUTE_DIRS = RETIRED_ROUTES.map((r) => `app/api/stripe/${r}/`);
const RETIRED_ROUTE_REFERENCE = new RegExp(`/api/stripe/(${RETIRED_ROUTES.join('|')})\\b`);

const BILLING_SETTINGS = 'components/settings/BillingSettings.tsx';

const DELETED_FILES = [
  'components/settings/PlanManagementTab.tsx',
  'components/v2/settings/BillingSettingsV2.tsx',
  'components/v2/settings/BillingSettingsV2.css',
  'components/v2/settings/BillingSettingsV2_NEW.tsx',
  'components/v2/billing/ModalsV2.tsx',
  'components/v2/billing/StatsCardsV2.tsx',
  'components/v2/billing/StorageUsageV2.tsx',
  'app/v2/billing/page.tsx.bak',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.test(entry)) walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !SKIP_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

function retiredRouteCallers(name: string, source: string): string[] {
  if (RETIRED_ROUTE_DIRS.some((d) => name.startsWith(d))) return [];
  const hit = source.match(RETIRED_ROUTE_REFERENCE);
  return hit ? [`${name} names /api/stripe/${hit[1]}`] : [];
}

/** What a buy flow in BillingSettings would look like. */
function buyFlowOffences(source: string): string[] {
  const out: string[] = [];
  if (/\.from\(\s*['"`]boost_packs['"`]\s*\)/.test(source)) out.push('reads boost_packs');
  if (/js\.stripe\.com|initEmbeddedCheckout|window\.Stripe/.test(source)) out.push('loads Stripe embedded checkout');
  if (/\bconsole\.(log|info|warn|error|debug)\s*\(/.test(source)) out.push('uses console.*');
  if (RETIRED_ROUTE_REFERENCE.test(source)) out.push('calls a retired purchase route');
  return out;
}

describe('agent-platform billing UI is read-only (P-10b)', () => {
  const files = CLIENT_AND_SERVER_TREES.filter((d) => existsSync(join(REPO_ROOT, d)))
    .flatMap((d) => walk(join(REPO_ROOT, d)))
    .map((f) => ({ name: rel(f), source: readFileSync(f, 'utf8') }));

  it('scans the trees it claims to (non-vacuity)', () => {
    expect(files.some((f) => f.name === BILLING_SETTINGS)).toBe(true);
    expect(files.some((f) => f.name === 'app/v2/billing/page.tsx')).toBe(true);
    expect(files.some((f) => f.name.startsWith('hooks/'))).toBe(true);
    expect(files.some((f) => f.name.startsWith('lib/client/'))).toBe(true);
    // The stubs exist and are the only files naming their own path.
    for (const r of RETIRED_ROUTES) {
      expect(files.some((f) => f.name === `app/api/stripe/${r}/route.ts`)).toBe(true);
    }
  });

  it('no file outside the 410 stubs names a retired purchase route', () => {
    expect(files.flatMap((f) => retiredRouteCallers(f.name, f.source))).toEqual([]);
  });

  it('BillingSettings has no buy flow and logs through Pino', () => {
    const source = read(BILLING_SETTINGS);
    expect(buyFlowOffences(source)).toEqual([]);
    expect(source).toMatch(/import \{ createLogger \} from '@\/lib\/logger'/);
  });

  it('BillingSettings still serves existing subscriptions (portal, cancel, reactivate, invoices)', () => {
    const source = read(BILLING_SETTINGS);
    for (const route of ['create-portal', 'cancel-subscription', 'reactivate-subscription', 'invoices']) {
      expect(source).toContain(`/api/stripe/${route}`);
    }
  });

  it('the dead and replaced billing files stay deleted', () => {
    expect(DELETED_FILES.filter((p) => existsSync(join(REPO_ROOT, p)))).toEqual([]);
  });

  it('/v2/billing is a server redirect to the Settings billing tab', () => {
    const source = read('app/v2/billing/page.tsx');
    expect(source).not.toMatch(/['"]use client['"]/);
    expect(source).toMatch(/import \{ redirect \} from 'next\/navigation'/);
    expect(source).toContain("redirect('/settings?tab=billing')");
  });

  it('negative controls: each offence shape is caught; survivors and the stubs are not', () => {
    expect(retiredRouteCallers('components/x.tsx', "await fetch('/api/stripe/create-checkout', { method: 'POST' })")).toEqual([
      'components/x.tsx names /api/stripe/create-checkout',
    ]);
    expect(retiredRouteCallers('hooks/y.ts', 'fetch(`/api/stripe/sync-subscription`)')).toEqual([
      'hooks/y.ts names /api/stripe/sync-subscription',
    ]);
    expect(retiredRouteCallers('lib/client/z.ts', 'const u = "/api/stripe/update-subscription";')).toEqual([
      'lib/client/z.ts names /api/stripe/update-subscription',
    ]);
    expect(retiredRouteCallers('app/api/stripe/sync-subscription/route.ts', '// app/api/stripe/sync-subscription/route.ts')).toEqual([]);
    expect(retiredRouteCallers('components/w.tsx', "fetch('/api/stripe/create-portal')")).toEqual([]);

    expect(buyFlowOffences("await supabase.from('boost_packs').select('*')")).toEqual(['reads boost_packs']);
    expect(buyFlowOffences('<Script src="https://js.stripe.com/v3/" />')).toEqual(['loads Stripe embedded checkout']);
    expect(buyFlowOffences("console.log('x')")).toEqual(['uses console.*']);
    expect(buyFlowOffences("fetch('/api/stripe/update-subscription')")).toEqual(['calls a retired purchase route']);
    expect(buyFlowOffences("logger.error({ err }, 'x'); fetch('/api/stripe/invoices')")).toEqual([]);
  });
});
