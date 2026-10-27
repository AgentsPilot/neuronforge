/**
 * ONE "don't renew" path (D2 / SX-1, workplan
 * docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md §6; SA W-7;
 * account-deletion requirement §5 "One engine sets and clears 'don't renew'
 * for both. The deletion flow calls it; it does not copy it").
 *
 * Over every non-test source file under `lib/business-os/**` and
 * `app/api/business-os/**`:
 *   (a) `setBusinessOsCancelAtPeriodEnd` is referenced ONLY in
 *       `lib/business-os/billing/planSubscriptionManage.ts`, so D6's deletion
 *       request (and anything else) must call `managePlanSubscription`;
 *   (b) no file calls the Stripe SDK's `subscriptions.update(` or
 *       `subscriptions.cancel(` directly;
 *   (c) no file calls StripeService's legacy agent-platform
 *       `cancelSubscription(` / `reactivateSubscription(`.
 *
 * Outside the scanned roots, deliberately: `lib/stripe/StripeService.ts` (the
 * one write), the legacy `app/api/stripe/*` routes (untouched, SX SA-1), the
 * user's own Stripe plugin (`lib/server/stripe-plugin-executor.ts`) and the
 * repositories (column writes, not Stripe calls).
 *
 * When P-7a.4 adds its immediate-cancel StripeService method, it is listed in
 * ENGINE_ONLY below with the same single allowed caller (SA W-7).
 *
 * Pure fs read; milliseconds; no added CI time.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const SCANNED = ['lib/business-os', 'app/api/business-os'];
const ENGINE = 'lib/business-os/billing/planSubscriptionManage.ts';

/** StripeService methods only the engine may call. */
const ENGINE_ONLY = ['setBusinessOsCancelAtPeriodEnd'];

/** Calls no scanned file may make at all. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['Stripe SDK subscriptions.update(', /\bsubscriptions\s*\.\s*update\s*\(/],
  ['Stripe SDK subscriptions.cancel(', /\bsubscriptions\s*\.\s*cancel\s*\(/],
  ['legacy StripeService cancelSubscription(', /\bcancelSubscription\s*\(/],
  ['legacy StripeService reactivateSubscription(', /\breactivateSubscription\s*\(/],
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

const FILES = SCANNED.flatMap(sourceFiles);
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('one "don\'t renew" path (SA W-7)', () => {
  it('scans a real tree (not vacuous)', () => {
    expect(FILES).toContain(ENGINE);
    expect(FILES).toContain('app/api/business-os/billing/plan/cancel/route.ts');
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(ENGINE_ONLY)('(a) %s is referenced only by the engine', (method) => {
    const pattern = new RegExp(`\\b${method}\\b`);
    const users = FILES.filter((file) => pattern.test(read(file)));
    expect(users).toEqual([ENGINE]);
  });

  it.each(FORBIDDEN)('(b)/(c) no scanned file calls %s', (_label, pattern) => {
    const offenders = FILES.filter((file) => pattern.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
