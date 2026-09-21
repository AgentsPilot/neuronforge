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
    expect(writers).toEqual([
      'app/api/cron/check-free-tier-expiration/route.ts', // module-level service-role client
      'app/api/stripe/cancel-subscription/route.ts', // supabaseAdmin
      'app/api/stripe/reactivate-subscription/route.ts', // supabaseAdmin
      'app/api/stripe/sync-subscription/route.ts', // supabaseAdmin
      'app/api/stripe/update-subscription/route.ts', // supabaseServer (W-2)
      'app/api/stripe/webhook/route.ts', // supabaseAdmin
      'lib/credits/rewardService.ts', // injected; browser client on purpose (W-3 / D-3)
      'lib/repositories/UserSubscriptionRepository.ts', // supabaseServer by default (S-6)
      'lib/services/CreditService.ts', // injected; only built with supabaseServer (W-1)
      'lib/services/ExecutionService.ts', // injected; quota writers must not run on a cookie client
      'lib/services/StorageService.ts', // injected; only built from QuotaAllocationService (admin)
      'lib/stripe/StripeService.ts', // injected; only create-checkout passes a client (W-4)
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
      'app/api/stripe/sync-subscription/route.ts::QuotaAllocationService(supabaseAdmin)',
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)',
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)',
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)',
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)',
      'app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)',
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

  it('only create-checkout hands a Supabase client to StripeService (W-4 discovery net)', () => {
    const callers = sourceFiles
      .filter((f) =>
        /stripeService\.(createCustomCreditSubscription|createBoostPackCheckout|getOrCreateCustomer)\s*\(/.test(
          readFileSync(f, 'utf8')
        )
      )
      .map(rel)
      .sort();
    expect(callers).toEqual(['app/api/stripe/create-checkout/route.ts']);

    // And those are still the only StripeService methods that accept a client.
    const svc = read('lib/stripe/StripeService.ts');
    const withClient = [...svc.matchAll(/^ {2}async (\w+)[(<]/gm)]
      .map((m) => m[1])
      .filter((name) => {
        const start = svc.indexOf(`async ${name}(`);
        return /supabase:?\s*SupabaseClient/.test(svc.slice(start, start + 600));
      })
      .sort();
    expect(withClient).toEqual([
      'createBoostPackCheckout',
      'createCustomCreditSubscription',
      'getOrCreateCustomer',
    ]);
  });
});

describe('QA — the service-role swaps keep user scoping (tenant-isolation-guard)', () => {
  it('run-agent never lets a body-supplied user id reach CreditService', () => {
    const src = read('app/api/run-agent/route.ts');
    const args = [...src.matchAll(/creditService\.\w+\(\s*([\w.]+)/g)].map((m) => m[1]);
    expect(args.length).toBeGreaterThan(0);
    expect(args.every((a) => a === 'user.id')).toBe(true);
    // The body does carry `user_id: provided_user_id`; it must never be the source.
    expect(src).not.toMatch(/creditService\.\w+\(\s*provided_user_id/);
    expect(src).not.toMatch(/creditService\.\w+\(\s*executionUserId/);
  });

  it('the Stripe plan update stays scoped to the session user and to two columns', () => {
    const src = read('app/api/stripe/update-subscription/route.ts');
    const at = src.indexOf('await supabaseServer');
    expect(at).toBeGreaterThan(-1);
    const stmt = src.slice(at, src.indexOf(';', at));
    expect(stmt).toContain(".from('user_subscriptions')");
    expect(stmt).toContain(".eq('user_id', user.id)");
    const keys = [...stmt.matchAll(/^ {8}(\w+):/gm)].map((m) => m[1]).sort();
    expect(keys).toEqual(['monthly_amount_usd', 'monthly_credits']);
    // No balance, no quotas, no account_frozen, no user_id in the payload.
    for (const forbidden of ['balance', 'account_frozen', 'storage_quota_mb', 'executions_quota', 'user_id:']) {
      expect(stmt).not.toContain(forbidden);
    }
  });

  it('create-checkout passes the session user id, not a body value, into both calls', () => {
    const src = read('app/api/stripe/create-checkout/route.ts');
    const blocks = [...src.matchAll(/stripeService\.create\w+\(\{([^]*?)\n {6}\}\)/g)].map(
      (m) => m[1]
    );
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain('supabase: supabaseServer,');
      expect(block).toContain('userId: user.id,');
      expect(block).not.toMatch(/userId:\s*(body|provided|params)/);
    }
    expect(src.match(/supabase: supabaseServer,/g)).toHaveLength(2);

    // getOrCreateCustomer must stay user-scoped on every statement it issues.
    const svc = read('lib/stripe/StripeService.ts');
    const fn = svc.slice(
      svc.indexOf('async getOrCreateCustomer('),
      svc.indexOf('async createCustomCreditSubscription(')
    );
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
