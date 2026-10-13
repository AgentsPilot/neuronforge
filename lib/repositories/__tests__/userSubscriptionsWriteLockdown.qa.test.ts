/**
 * P0-FT-RLS — QA-added guards (2026-09-20). Tests only; no production code.
 *
 * Dev's `userSubscriptionsWriteLockdownMigration.test.ts` pins the migration and
 * the three known call sites. These add the two nets that would actually have
 * caught W-4 (`create-checkout` -> `StripeService.getOrCreateCustomer`) as a
 * *discovery* rather than a regression:
 *
 *   1. A table-level allow-list of every module that writes `user_subscriptions`
 *      at all. A new writer anywhere fails here, whatever client it uses.
 *   2. A construction-site allow-list for every service that takes an injected
 *      `SupabaseClient` and writes the table. That is the shape a textual grep
 *      cannot see, and it is how W-4 hid from two independent sweeps.
 *
 * Plus tenant-scoping guards on the three service-role swaps (the swaps removed
 * the RLS backstop, so `.eq('user_id', <session user>)` is now the only control),
 * and a guard that neither agent page can announce credits it did not grant.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'lib'];
const SKIP_DIR = /^(node_modules|\.next|\.claude|__tests__|coverage)$/;
const SKIP_FILE = /(\.test\.tsx?$|\.backup[-.])/;
const WRITE_OP = /\.(update|insert|upsert|delete)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.test(entry)) walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !SKIP_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
const rel = (f: string) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

describe('QA — who can write user_subscriptions at all', () => {
  it('only these modules write the table, and every one is service-role or a documented exception', () => {
    const writers = sourceFiles
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return ["from('user_subscriptions')", 'from("user_subscriptions")'].some((needle) =>
          src
            .split(needle)
            .slice(1)
            .some((after) => WRITE_OP.test(after.slice(0, 200)))
        );
      })
      .map(rel)
      .sort();

    // Every entry here has been traced by hand to the client it runs on.
    // Adding a file to this list must be a deliberate, reviewed act.
    // Plan payments P-10 removed two writers: the free-tier freeze job is an
    // inert 410 (TK-3, BQ-P8) and sync-subscription is a 410 (CF-3).
    // CF-5 PR 5 moved the Stripe webhook's four writes (dunning, boost pack,
    // status mirror, canceled) into UserSubscriptionRepository, so the webhook
    // route is no longer a writer. `routerPlacement.guard` pins that the route
    // has no `.from(` at all, and the test below that each moved query keeps
    // its `.eq('user_id', userId)`.
    expect(writers).toEqual([
      'app/api/stripe/cancel-subscription/route.ts', // supabaseAdmin
      'app/api/stripe/reactivate-subscription/route.ts', // supabaseAdmin
      'lib/credits/rewardService.ts', // injected; browser client on purpose (W-3 / D-3)
      'lib/repositories/UserSubscriptionRepository.ts', // supabaseServer by default (S-6; the webhook's legacy writes, CF-5 PR 5)
      'lib/services/CreditService.ts', // injected; only built with supabaseServer (W-1)
      'lib/services/ExecutionService.ts', // injected; quota writers must not run on a cookie client
      'lib/services/StorageService.ts', // injected; only built from QuotaAllocationService (admin)
      'lib/stripe/StripeService.ts', // injected; no caller passes a client since P-10 (W-4)
    ]);
  });
});

describe('QA — injected-client services that write the table', () => {
  /** Every `new <Name>(<arg>)` in the repo, as `file::Name(arg)`. */
  function constructionSites(names: string[]): string[] {
    const out: string[] = [];
    for (const f of sourceFiles) {
      const src = readFileSync(f, 'utf8');
      const re = new RegExp(`new\\s+(${names.join('|')})\\s*\\(([^,)]*)`, 'g');
      for (const m of src.matchAll(re)) {
        out.push(`${rel(f)}::${m[1]}(${m[2].trim()})`);
      }
    }
    return out.sort();
  }

  it('is built only with a service-role client — the W-4 shape a textual grep cannot see', () => {
    expect(
      constructionSites([
        'CreditService',
        'ExecutionService',
        'StorageService',
        'QuotaAllocationService',
      ])
    ).toEqual([
      // W-1: the only CreditService in the app, on the service role.
      'app/api/run-agent/route.ts::CreditService(supabaseServer)',
      // Plan payments P-1 removed three of the five webhook sites with their
      // Pilot-Credit conversions (handleInvoicePaid, and the subscription-mode
      // checkout with its welcome bonus). P-10 removed subscription.updated's
      // and sync-subscription's (L-26). Left: the boost-pack branch, kept as-is
      // by Credits Boost FR-40 so in-flight sessions complete (SA P10 Q-2).
      // CF-5 PR 5 removed the route's `supabaseAdmin` alias: the argument is
      // now the shared service-role `supabaseServer` itself.
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseServer)',
      // Documented exception (SA RC9-8): the caller's cookie client. Only the
      // read and the SECURITY DEFINER `increment_executions_used` RPC may be
      // used from this instance — never applyExecutionQuotaBasedOnTokens /
      // updateExecutionQuota, which issue a plain UPDATE and would fail 42501.
      'lib/pilot/StateManager.ts::ExecutionService(this.supabase)',
      // Reached only from QuotaAllocationService, which is always admin-built.
      'lib/services/QuotaAllocationService.ts::ExecutionService(this.supabase)',
      'lib/services/QuotaAllocationService.ts::StorageService(this.supabase)',
    ]);
  });

  it('StateManager still calls only the read and the SECURITY DEFINER RPC (RC9-8)', () => {
    const src = read('lib/pilot/StateManager.ts');
    const calls = [...src.matchAll(/executionService\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(calls).toEqual(['checkExecutionAvailable', 'recordExecution']);
    // recordExecution must stay on the RPC, not a plain UPDATE.
    expect(read('lib/services/ExecutionService.ts')).toContain(
      "this.supabase.rpc('increment_executions_used'"
    );
  });

  // Plan payments P-10: create-checkout, the last caller, now refuses every
  // purchase with 410 (Credits Boost FR-40), and createCustomCreditSubscription
  // is deleted. A new caller of a client-taking method must be reviewed (W-4).
  it('no code hands a Supabase client to StripeService (W-4 discovery net)', () => {
    const callers = sourceFiles
      .filter((f) =>
        /stripeService\.(createBoostPackCheckout|getOrCreateCustomer)\s*\(/.test(readFileSync(f, 'utf8'))
      )
      .map(rel)
      .sort();
    expect(callers).toEqual([]);

    // And those are still the only StripeService methods that accept a client.
    const svc = read('lib/stripe/StripeService.ts');
    const withClient = [...svc.matchAll(/^ {2}async (\w+)[(<]/gm)]
      .map((m) => m[1])
      .filter((name) => {
        const start = svc.indexOf(`async ${name}(`);
        return /supabase:?\s*SupabaseClient/.test(svc.slice(start, start + 600));
      })
      .sort();
    expect(withClient).toEqual(['createBoostPackCheckout', 'getOrCreateCustomer']);
  });
});

describe('QA — the service-role swaps keep user scoping (tenant-isolation-guard)', () => {
  // CF-5 PR 5: the webhook's six legacy queries moved from the route into this
  // repository section. Each must keep exactly one `.eq('user_id', userId)`,
  // so the move cannot drop the only control on a service-role write.
  it('the Stripe webhook legacy section of UserSubscriptionRepository is user-scoped on every query', () => {
    const src = read('lib/repositories/UserSubscriptionRepository.ts');
    const header = '// Stripe webhook, agent-platform legacy: owner-scoped (CF-5 PR 5)';
    const start = src.indexOf(header);
    expect(start).toBeGreaterThan(-1);
    // Code only: the section's comments quote the filter, and must not count.
    const section = src
      .slice(start, src.indexOf('\n}', start))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const queries = section.match(/\.from\('user_subscriptions'\)/g) ?? [];
    expect(queries).toHaveLength(6);
    expect(section.match(/\.eq\('user_id', userId\)/g)).toHaveLength(6);
    expect(section).not.toMatch(/\.upsert\(|\.insert\(|\.delete\(|\.rpc\(/);
  });

  it('run-agent never lets a body-supplied user id reach CreditService', () => {
    const src = read('app/api/run-agent/route.ts');
    const args = [...src.matchAll(/creditService\.\w+\(\s*([\w.]+)/g)].map((m) => m[1]);
    expect(args.length).toBeGreaterThan(0);
    expect(args.every((a) => a === 'user.id')).toBe(true);
    // The body does carry `user_id: provided_user_id`; it must never be the source.
    expect(src).not.toMatch(/creditService\.\w+\(\s*provided_user_id/);
    expect(src).not.toMatch(/creditService\.\w+\(\s*executionUserId/);
  });

  // Plan payments P-1 (SA Q-3): update-subscription is refused with 410 and
  // writes nothing, so the service-role write this test scoped is gone. What
  // must hold now is that it stays gone.
  it('the Stripe plan update writes nothing: no service-role client, no table write', () => {
    const src = read('app/api/stripe/update-subscription/route.ts');
    expect(src).not.toContain('supabaseServer');
    expect(src).not.toMatch(WRITE_OP);
    expect(src).not.toContain('getStripeService');
    expect(src).toContain('status: 410');
  });

  // Plan payments P-10 (Credits Boost FR-40): create-checkout refuses every
  // purchase with 410, so the customer-creating call this test scoped is gone.
  // What must hold now is that it stays gone, and that getOrCreateCustomer,
  // kept for a possible revival (FR-40), stays user-scoped.
  it('create-checkout makes no customer-creating call and holds no service-role client', () => {
    const src = read('app/api/stripe/create-checkout/route.ts');
    expect(src).not.toMatch(/stripeService\.\w+\(/);
    expect(src).not.toContain('getStripeService');
    expect(src).not.toContain('supabaseServer');
    expect(src).not.toMatch(WRITE_OP);
    expect(src).toContain('status: 410');

    // getOrCreateCustomer must stay user-scoped on every statement it issues.
    const svc = read('lib/stripe/StripeService.ts');
    const fn = svc.slice(
      svc.indexOf('async getOrCreateCustomer('),
      svc.indexOf('async createBoostPackCheckout(')
    );
    expect(fn.length).toBeGreaterThan(0);
    expect(fn.match(/\.from\('user_subscriptions'\)/g)).toHaveLength(4);
    expect(fn.match(/\.eq\('user_id', userId\)/g)).toHaveLength(3); // the 4th site is the INSERT
    expect(fn).toMatch(/\.insert\(\{\s*\n\s*user_id: userId,/);
    expect(fn).not.toMatch(/\.upsert\(/); // an upsert would defeat the scope
  });
});

describe('QA — the UI cannot announce credits it did not grant (RC9-7)', () => {
  it('v2: the credits banner is only reachable from the success branch', () => {
    const src = read('app/v2/agents/[id]/page.tsx');
    expect(src.match(/setShareCreditsAwarded\(/g)).toHaveLength(1);
    expect(src.match(/setShowShareSuccess\(true\)/g)).toHaveLength(1);
    const failure = src.slice(src.indexOf('P0-FT-RLS (SA RC9-7)'));
    expect(failure.slice(0, 900)).not.toMatch(/setShowShareSuccess\(true\)|setShareCreditsAwarded\(/);
  });

  it('(protected): the success notification is not fired on a failed reward', () => {
    const src = read('app/(protected)/agents/[id]/page.tsx');
    expect(src.match(/setCreditsAwarded\(rewardResult\.creditsAwarded\)/g)).toHaveLength(1);
    expect(src.match(/setShowSuccessNotification\(true\)/g)).toHaveLength(1);
    const failure = src.slice(src.indexOf('P0-FT-RLS (SA RC9-7)'));
    expect(failure.slice(0, 900)).not.toMatch(/setShowSuccessNotification\(true\)|setCreditsAwarded\(/);
  });

  it('RewardService only reports success after the balance write landed (FT-RLS-1 back-fill assumption)', () => {
    const src = read('lib/credits/rewardService.ts');
    const upsertAt = src.indexOf(".from('user_subscriptions')");
    const secondUpsert = src.indexOf(".upsert({", upsertAt);
    const failFast = src.indexOf('if (updateError) {', secondUpsert);
    const ledgerAt = src.indexOf(".from('credit_transactions')", secondUpsert);
    const rewardsAt = src.indexOf(".from('user_rewards')", secondUpsert);
    expect(secondUpsert).toBeGreaterThan(-1);
    expect(failFast).toBeGreaterThan(secondUpsert);
    // It returns before writing either ledger table, so a blocked upsert leaves
    // no partial state and the owed rewards stay recoverable from shared_agents.
    expect(failFast).toBeLessThan(ledgerAt);
    expect(failFast).toBeLessThan(rewardsAt);
    expect(src.slice(failFast, ledgerAt)).toContain('success: false');
  });
});
