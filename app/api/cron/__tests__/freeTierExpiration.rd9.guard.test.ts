/**
 * RD-9, made permanent (plan payments P-10, TK-3, decided by BQ-P8):
 * `check-free-tier-expiration` is never scheduled, full stop, and its route
 * writes nothing.
 *
 * ── The trap, in one paragraph ──────────────────────────────────────────────
 * The cron froze accounts whose `free_tier_expires_at` had passed and who
 * never bought credits, and zeroed their balance. Those are agent-platform
 * ideas. A Business OS customer paying $79 a month has never bought a credit
 * and carries whatever `free_tier_expires_at` their signup wrote — so the day
 * this cron ran, it would have frozen **paying Business OS customers**.
 * `account_frozen` is read by `generate-agent` and `run-agent`, so the freeze
 * is not cosmetic.
 *
 * ── What changed in P-10 ────────────────────────────────────────────────────
 * S-0 wrote this suite to allow two safe states: unscheduled, or scheduled with
 * a Business OS exclusion. BQ-P8 (2026-10-02) removed the second: the job stays
 * off for good and `free_tier_expires_at` keeps its meaning. So:
 *
 *   1. it may not appear in `vercel.json` at all (also enforced, with the
 *      reason, by `PERMANENTLY_UNSCHEDULED_CRONS` in `lib/cron/bosCronJobs.ts`
 *      and `lib/cron/__tests__/vercelCrons.test.ts`);
 *   2. the route is an inert 410 whose source contains no table access, no
 *      write and no `account_frozen: true` — so even a mistaken schedule
 *      freezes nobody;
 *   3. no other code writes `account_frozen = true`
 *      (`lib/__tests__/accountFrozenWriters.guard.test.ts`).
 *
 * `vercel.json` is JSON and cannot carry a comment, so the rule is executable:
 * a reader who never opens this file still meets it, because CI does.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md RD-9, F-17, TK-3
 * @see docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md BQ-P8
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const CRON_PATH = '/api/cron/check-free-tier-expiration';
const ROUTE_FILE = 'app/api/cron/check-free-tier-expiration/route.ts';

const vercelConfig = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
  crons?: Array<{ path: string; schedule: string }>;
};
const routeSource = readFileSync(join(process.cwd(), ROUTE_FILE), 'utf8');

/** Code only: comments may explain the old behaviour without tripping the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Everything that would let the route touch an account. Empty means inert. */
function accountTouches(source: string): string[] {
  // The secret check hashes with `createHash(...).update(...)`: a hash update,
  // not a table write.
  const code = stripComments(source).replace(/createHash\([^)]*\)\s*\.update\(/g, 'createHash().');
  const found: string[] = [];
  if (/account_frozen\s*:\s*true/.test(code)) found.push('account_frozen: true');
  if (/\.(update|insert|upsert|delete)\s*\(/.test(code)) found.push('a table write');
  if (/\.from\s*\(/.test(code)) found.push('a table access');
  if (/\.rpc\s*\(/.test(code)) found.push('an RPC call');
  if (/createClient|supabaseServer|supabaseAdmin/.test(code)) found.push('a database client');
  return found;
}

describe('RD-9 — the free-tier expiration cron (permanent, BQ-P8)', () => {
  it('is not scheduled in vercel.json, full stop', () => {
    const scheduled = (vercelConfig.crons ?? []).filter((cron) => cron.path === CRON_PATH);
    expect({
      cron: CRON_PATH,
      scheduled: scheduled.length > 0,
      whatToDo:
        scheduled.length > 0
          ? `Remove ${CRON_PATH} from vercel.json. BQ-P8 retired it for good: it freezes accounts that never bought credits, which is every paying Business OS customer.`
          : 'nothing',
    }).toEqual({ cron: CRON_PATH, scheduled: false, whatToDo: 'nothing' });
  });

  it('the route is inert: no table access, no write, no account_frozen: true, no database client', () => {
    expect(accountTouches(routeSource)).toEqual([]);
    expect(routeSource).toContain('status: 410');
  });

  it('negative control: the old freezing body is caught', () => {
    const freezing = [
      'const { data } = await supabase',
      "  .from('user_subscriptions')",
      '  .update({ balance: 0, account_frozen: true })',
      "  .eq('user_id', user.user_id);",
    ].join('\n');
    expect(accountTouches(freezing)).toEqual(['account_frozen: true', 'a table write', 'a table access']);
    expect(accountTouches("const supabase = createClient(url, key);")).toEqual(['a database client']);
    // Only a hash update is exempt, not a write chained after one.
    expect(accountTouches("createHash('sha256').update(v); await db.update({ x: 1 });")).toEqual(['a table write']);
    // A comment describing the old behaviour is not code.
    expect(accountTouches('// it used to set account_frozen: true with .update(')).toEqual([]);
  });

  it('every other cron in vercel.json is left alone', () => {
    // Non-vacuity on the config read: a parse that returned no crons would make
    // the first assertion pass for the wrong reason.
    expect((vercelConfig.crons ?? []).length).toBeGreaterThan(3);
  });
});
