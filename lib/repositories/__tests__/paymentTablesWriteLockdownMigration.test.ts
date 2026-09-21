/**
 * P0-PAY-RLS. Two things, both static (no DB), mirroring
 * userSubscriptionsWriteLockdownMigration.test.ts:
 *
 * 1. What the lock-down migration does. It is applied by hand in the SQL editor
 *    after SA review, so this pins its content before anyone runs it. The live
 *    effect is checked with the post-check queries in the file header and the
 *    browser check in the apply guide.
 *
 * 2. That no caller writes the twelve tables with a caller's own credentials.
 *
 * WHAT THESE GUARDS CANNOT CATCH. They are textual: they see a file that names a
 * table. They do NOT see a route that hands its user-cookie client to a service
 * which writes the table somewhere else — which is how W-4 hid in the
 * `user_subscriptions` cycle. Every injected-`SupabaseClient` service must still
 * be traced to its construction sites by hand in review; the sweep for this
 * change is in docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md §3.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const FILE = '20261004_payment_tables_write_lockdown.sql';
const REPO_ROOT = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', FILE), 'utf8');

/** The executable statements: comment lines removed, whitespace collapsed. */
const body = sql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const TABLES = [
  'credit_transactions',
  'payment_automation_executions',
  'payment_automation_rules',
  'payment_events',
  'payment_invoices',
  'payment_methods',
  'payment_plan_installments',
  'payment_plans',
  'payment_processors',
  'payment_reminders',
  'payment_transactions',
  'saved_payment_methods',
];

/** The eight `FOR ALL` policies, by their live names (read on 2026-09-21). */
const ALL_POLICIES: Array<[string, string]> = [
  ['payment_automation_executions', 'Users can view their own automation executions'],
  ['payment_automation_rules', 'Users can manage their own automation rules'],
  ['payment_events', 'Users can view their own payment events'],
  ['payment_plan_installments', 'Users can manage their own installments'],
  ['payment_plans', 'Users can manage their own payment plans'],
  ['payment_processors', 'Users can manage their own payment processors'],
  ['payment_reminders', 'Users can manage their own payment reminders'],
  ['saved_payment_methods', 'Users can manage their contacts saved payment methods'],
];

describe(`${FILE}`, () => {
  it('runs as one transaction and fails fast instead of queueing behind its own lock', () => {
    expect(body.startsWith('BEGIN;')).toBe(true);
    expect(body.endsWith('COMMIT;')).toBe(true);
    expect(body).toContain("SET LOCAL lock_timeout = '3s';");
    expect(body).toContain("SET LOCAL statement_timeout = '60s';");
    expect(body.indexOf('SET LOCAL lock_timeout')).toBeLessThan(body.indexOf('DROP POLICY'));
    expect(body.indexOf('SET LOCAL statement_timeout')).toBeLessThan(body.indexOf('DROP POLICY'));
  });

  it('fails closed if RLS is off, FORCEd, or a table is missing', () => {
    expect(body).toMatch(/RLS is disabled on public\.% - stop and escalate/);
    expect(body).toMatch(/FORCE RLS is on for public\.% - stop and escalate/);
    expect(body).toMatch(/table public\.% does not exist - stop and escalate/);
    // The guard runs before anything is dropped.
    expect(body.indexOf('RLS is disabled on public.%')).toBeLessThan(body.indexOf('DROP POLICY'));
  });

  it('converts each FOR ALL policy to a read-only SELECT twin instead of dropping it', () => {
    for (const [table, policy] of ALL_POLICIES) {
      expect(body).toContain(`'${table}'`);
      expect(body).toContain(`'${policy}'`);
    }
    // Same name + suffix, same roles, same USING expression, copied at run time.
    expect(body).toContain("newname := r.pol_name || ' (read-only)';");
    expect(body).toContain(
      "EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)', newname, r.tbl, rolelist, pol_qual);"
    );
    expect(body).toContain("SELECT string_agg(quote_ident(x), ', ') INTO rolelist FROM unnest(pol_roles) AS x;");
    // SA RC-5: with_check cannot live on a SELECT twin, so it is logged instead.
    expect(body).toMatch(/original WITH CHECK: %/);
    // The read half is created before the writable original goes away.
    expect(body.indexOf('CREATE POLICY %I ON public.%I FOR SELECT')).toBeLessThan(
      body.indexOf("EXECUTE format('DROP POLICY %I ON public.%I', r.pol_name, r.tbl)")
    );
    // Only SELECT policies are ever created — never a write policy.
    expect(body).not.toMatch(/CREATE POLICY[^;]*FOR (ALL|INSERT|UPDATE|DELETE)/);
  });

  it('refuses to guess when the live schema has drifted', () => {
    expect(body).toMatch(/live schema has drifted, re-run the pre-check/);
    expect(body).toMatch(/is cmd %, expected ALL - live schema has drifted/);
    expect(body).toMatch(/is %, expected PERMISSIVE - live schema has drifted/);
    expect(body).toMatch(/has no USING expression - cannot rebuild its read half safely/);
    // Re-running an applied file is a no-op, not an error.
    expect(body).toMatch(/already converted: "%" on public\.%/);
  });

  it('sweeps write-only policies by shape, and never touches service-role or SELECT policies', () => {
    expect(body).toContain("AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE')");
    expect(body).toContain("AND p.roles && ARRAY['public','anon','authenticated']::name[]");
    expect(body).toContain("AND coalesce(p.qual, '') NOT LIKE '%service_role%'");
    expect(body).toContain("AND coalesce(p.with_check, '') NOT LIKE '%service_role%'");
    expect(body).toContain("AND p.permissive = 'PERMISSIVE'");
    // Every drop is announced. The NOTICEs are NOT the backup (SA RC-2: the
    // Supabase SQL editor does not surface them) — the pre-check query-2 export
    // is, which is why the header and the apply guide say so.
    expect(body).toMatch(/dropped write policy "%" \(%\) on public\.%/);
    // billing_events and boost_pack_purchases are out of scope entirely.
    expect(body).not.toContain('billing_events');
    expect(body).not.toContain('boost_pack_purchases');
  });

  it('scopes the shape-based sweep to the twelve tables, and nothing wider', () => {
    // Without the tablename filter the same shape query would drop the owner
    // write policy of every table in `public`. This is the one step that cannot
    // be rolled back from the file, so the scope is pinned explicitly.
    const sweep = body.slice(body.indexOf('FROM pg_policies p WHERE'), body.indexOf('ORDER BY p.tablename, p.policyname'));
    expect(sweep).toContain('AND p.tablename IN (');
    for (const t of TABLES) expect(sweep).toContain(`'${t}'`);
    // Exactly twelve, i.e. nobody widened the list without updating this test.
    expect(sweep.match(/'[a-z_]+'/g)?.filter((q) => TABLES.includes(q.slice(1, -1)))).toHaveLength(TABLES.length);
  });

  it('converts exactly the eight known FOR ALL policies — no more, no less', () => {
    // A ninth name added without an SA re-read would be a policy dropped (the
    // original) on evidence nobody checked.
    const list = body.slice(body.indexOf('FOR r IN SELECT * FROM (VALUES'), body.indexOf('AS t(tbl, pol_name)'));
    expect(list.match(/\('[a-z_]+',/g)).toHaveLength(ALL_POLICIES.length);
    for (const [table, policy] of ALL_POLICIES) {
      expect(list).toContain(`('${table}',`);
      expect(list).toContain(`'${policy}'`);
    }
  });

  it('enforces the 20261001 ordering in the transaction, and only reads user_subscriptions (SA RC-1)', () => {
    // The guard: `authenticated` holding UPDATE there is the precise privilege
    // that lets the browser share-reward credit a balance with no ledger row.
    // UPDATE *and* INSERT (QA-4): the reward path is an upsert, so an INSERT
    // grant alone still creates a credited balance for a user with no row.
    expect(body).toContain(
      "IF has_table_privilege('authenticated', 'public.user_subscriptions', 'UPDATE') OR has_table_privilege('authenticated', 'public.user_subscriptions', 'INSERT') THEN"
    );
    expect(body).toMatch(
      /authenticated still holds UPDATE or INSERT on public\.user_subscriptions - apply 20261001_user_subscriptions_write_lockdown\.sql FIRST/
    );
    // It runs before anything is changed.
    expect(body.indexOf("'public.user_subscriptions', 'UPDATE'")).toBeLessThan(body.indexOf('DROP POLICY'));
    // Read-only: the file never drops a policy on that table or revokes from it.
    expect(body).not.toMatch(/DROP POLICY[^;]*user_subscriptions/);
    expect(body).not.toMatch(/REVOKE[^;]*user_subscriptions/);
    expect(body).not.toMatch(/CREATE POLICY[^;]*user_subscriptions/);
  });

  it('revokes every write privilege from anon and authenticated on all twelve tables, and nothing else', () => {
    const revoke = body.slice(body.indexOf('REVOKE INSERT'), body.indexOf('FROM anon, authenticated;') + 25);
    expect(revoke).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON');
    for (const t of TABLES) expect(revoke).toContain(`public.${t}`);
    expect(revoke.endsWith('FROM anon, authenticated;')).toBe(true);
    // Exactly twelve tables — a thirteenth would be a table nobody swept.
    expect(revoke.match(/public\.[a-z_]+/g)).toHaveLength(TABLES.length);
    // Two REVOKEs in the file: this table one, and the function one (QA-2).
    expect(body.match(/REVOKE/g)).toHaveLength(2);
    // A REVOKE naming SELECT would break every payments screen.
    expect(body).not.toMatch(/REVOKE[^;]*\bSELECT\b/);
    // Nothing is handed back out; the rollback lives in the header, not the body.
    expect(body).not.toMatch(/\bGRANT\b/);
  });

  it('touches no table definition and no data', () => {
    expect(body).not.toMatch(/\bALTER TABLE\b/);
    expect(body).not.toMatch(/\bDROP TABLE\b/);
    expect(body).not.toMatch(/ROW LEVEL SECURITY/); // never disables or forces RLS
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(body).not.toMatch(/\bUPDATE\s+public\./);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(body).not.toMatch(/\bCREATE (OR REPLACE )?FUNCTION\b/);
    expect(body).not.toMatch(/\bCREATE TRIGGER\b/);
  });

  it('verifies its own post-conditions for every one of the twelve tables', () => {
    expect(body).toMatch(/no PERMISSIVE SELECT policy left on public\.% - owners would lose read access/);
    expect(body).toContain("AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'");
    expect(body).toMatch(/authenticated lost SELECT on public\.% - the payments UI would break/);
    expect(body).toMatch(/write-capable user policies still present on public\.%/);
    expect(body).toContain("FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP");
    expect(body).toContain(
      "FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP"
    );
    expect(body).toMatch(/has_table_privilege\(role_name, 'public\.' \|\| quote_ident\(t\), priv\)/);
    // The post-condition loop covers all twelve tables, not just the ones edited.
    const postBlock = body.slice(body.lastIndexOf('FOREACH t IN ARRAY'));
    for (const t of TABLES) expect(postBlock).toContain(`'${t}'`);
  });

  it('revokes EXECUTE on the SECURITY DEFINER overdue helper, from PUBLIC too (QA-2)', () => {
    // A table lock-down cannot close this one: the function is SECURITY DEFINER
    // (runs as its owner, ignores RLS and the grants) and its UPDATE has no
    // user_id predicate. The grant is the DEFAULT PUBLIC one, so `FROM PUBLIC`
    // is load-bearing - naming only the two roles would be a no-op.
    expect(body).toContain(
      'REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM PUBLIC, anon, authenticated;'
    );
    // Guarded: REVOKE on an absent function is an error, and this file must stay
    // applicable to an environment that never ran 20260723.
    expect(body).toContain("IF to_regprocedure('public.update_overdue_installments()') IS NOT NULL THEN");
    // The body of the function is never touched - only the privilege.
    expect(body).not.toMatch(/CREATE (OR REPLACE )?FUNCTION[^;]*update_overdue_installments/);
    expect(body).not.toMatch(/DROP FUNCTION/);
    // ... and its own post-condition, inside the same transaction.
    expect(body).toContain(
      "IF has_function_privilege(role_name, 'public.update_overdue_installments()', 'EXECUTE') THEN"
    );
    expect(body).toMatch(
      /% still holds EXECUTE on public\.update_overdue_installments\(\) - the platform-wide overdue flip is still callable/
    );
  });

  it('runs the post-conditions inside the transaction, after the REVOKE and before COMMIT', () => {
    // If any of these ran after COMMIT — or were a separate transaction — the
    // migration could commit with a write path still open and only tell you
    // afterwards. They must be the last thing before COMMIT.
    const commit = body.lastIndexOf('COMMIT;');
    const revoke = body.indexOf('REVOKE INSERT');
    for (const guard of [
      'no PERMISSIVE SELECT policy left on public.%',
      'authenticated lost SELECT on public.%',
      'write-capable user policies still present on public.%',
      'still holds % on public.%',
      'still holds EXECUTE on public.update_overdue_installments()',
    ]) {
      const at = body.indexOf(guard);
      expect(at).toBeGreaterThan(revoke);
      expect(at).toBeLessThan(commit);
    }
  });

  it('documents the pre-check, the post-check, the rollback and its limits', () => {
    expect(sql).toMatch(/PRE-CHECK/);
    expect(sql).toMatch(/STOP and send the output to the Dev/);
    expect(sql).toMatch(/POST-CHECK/);
    expect(sql).toMatch(/-- ROLLBACK/);
    // The pre-check lists EVERY policy, not only the write-capable ones — the
    // user's investigation query returned only writers.
    expect(sql).toMatch(/EVERY policy on those tables, not only the write-capable ones/);
    // Honest about the half that is not self-inverting.
    expect(sql).toMatch(/recoverable from anything this file leaves behind/);
    expect(sql).toMatch(/that export IS\s+--\s+the backup/);
    expect(sql).toMatch(/GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
  });

  it('states the deploy order: no code ships first, but 20261001 must be applied first', () => {
    expect(sql).toMatch(/CODE THAT MUST SHIP FIRST: NONE/);
    expect(sql).toContain('20261001_user_subscriptions_write_lockdown.sql');
    expect(sql).toContain('RewardService');
    expect(sql).toMatch(/credits granted, nothing recorded/);
  });
});

// ---------------------------------------------------------------------------
// Source guard: who writes the twelve tables?
// ---------------------------------------------------------------------------

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

/** Files that write `table` within 200 chars of a `.from('table')`. */
function writersOf(table: string, files: string[]): string[] {
  return files
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return [`from('${table}')`, `from("${table}")`].some((needle) =>
        src
          .split(needle)
          .slice(1)
          .some((after) => WRITE_OP.test(after.slice(0, 200)))
      );
    })
    .map(rel)
    .sort();
}

describe('the payment tables are never written with a caller\'s own credentials', () => {
  const clientFiles = sourceFiles.filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')));

  it.each(TABLES)('no browser module writes %s directly (reads are fine)', (table) => {
    expect(writersOf(table, clientFiles)).toEqual([]);
  });

  it('no user-cookie server client writes any of the twelve tables', () => {
    // The `'use client'` guard above only sees the browser. A route that builds
    // `createAuthenticatedServerClient()` and writes one of these tables is
    // equally RLS-respecting and would break on apply — `sync-subscription` is
    // the live example of the shape done right (cookie client for auth,
    // `supabaseAdmin` for every write).
    const USER_COOKIE = /supabaseServerAuth|createAuthenticatedServerClient|createServerClient/;
    const offenders: string[] = [];
    for (const f of sourceFiles) {
      const src = readFileSync(f, 'utf8');
      if (!USER_COOKIE.test(src)) continue;
      for (const table of TABLES) {
        for (const needle of [`from('${table}')`, `from("${table}")`]) {
          for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
            const isWrite = WRITE_OP.test(src.slice(i + needle.length, i + needle.length + 200));
            const onServiceClient = /supabase(Admin|Server)\b/.test(src.slice(Math.max(0, i - 80), i));
            if (isWrite && !onServiceClient) offenders.push(`${rel(f)} -> ${table}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the documented agent pages build RewardService with the browser client', () => {
    // RewardService INSERTs `credit_transactions` (and upserts user_subscriptions).
    // These two client pages are the known, deliberate exception — that path IS
    // the vulnerability. A third caller must fail here.
    const callers = sourceFiles
      .filter((f) => /new RewardService\s*\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();

    expect(callers).toEqual([
      'app/(protected)/agents/[id]/page.tsx',
      'app/v2/agents/[id]/page.tsx',
    ]);
  });

  it('CreditService is only ever built with the service-role client (SA RC-6)', () => {
    // CreditService INSERTs `credit_transactions` on an INJECTED client - the
    // W-4 shape. The same assertion exists in the user_subscriptions guard, but
    // that file could be deleted without this one noticing.
    const callers = sourceFiles
      .filter((f) => /new CreditService\s*\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(callers).toEqual(['app/api/run-agent/route.ts']);
    expect(readFileSync(join(REPO_ROOT, 'app/api/run-agent/route.ts'), 'utf8')).toContain(
      'new CreditService(supabaseServer)'
    );
  });

  it('every payment repository defaults to the service-role client', () => {
    const repos = [
      'PaymentRepository',
      'PaymentPlanRepository',
      'PaymentPlanSubscriptionRepository',
      'PaymentAutomationRepository',
      'PaymentEventRepository',
      'PaymentReminderRepository',
      'PaymentProcessorRepository',
    ];
    for (const repo of repos) {
      const src = readFileSync(join(REPO_ROOT, 'lib', 'repositories', `${repo}.ts`), 'utf8');
      expect(src).toContain("import { supabaseServer } from '@/lib/supabaseServer'");
      // Either a defaulted constructor or an explicitly service-role singleton.
      expect(/supabase(Client)?: SupabaseClient = supabaseServer|=\s*supabaseServer|\(supabaseServer\)/.test(src)).toBe(true);
    }
  });

  it('the payment services and queue drains are singletons on the service-role client', () => {
    const singletons: Array<[string, string]> = [
      ['lib/services/PaymentReminderService.ts', 'new PaymentReminderService(supabaseServer)'],
      ['lib/services/PaymentAutomationEngine.ts', 'new PaymentAutomationEngine(supabaseServer)'],
      ['lib/services/PaymentRetryService.ts', 'new PaymentRetryService(supabaseServer)'],
      ['lib/services/PaymentProcessorService.ts', 'new PaymentProcessorService(supabaseServer)'],
      ['lib/services/PaymentEventService.ts', 'new PaymentEventService(supabaseServer)'],
    ];
    for (const [file, ctor] of singletons) {
      expect(readFileSync(join(REPO_ROOT, file), 'utf8')).toContain(ctor);
    }

    // The §8.1 claim-pattern drains reach the queues only through those
    // singletons — no cron builds its own client for these tables.
    for (const cron of ['app/api/cron/payment-reminders/route.ts', 'app/api/cron/payment-retry/route.ts']) {
      const src = readFileSync(join(REPO_ROOT, cron), 'utf8');
      expect(src).not.toMatch(/createServerClient|createAuthenticatedServerClient|supabaseServerAuth/);
    }
  });

  it('every settleInvoicePaid call site passes the service-role client', () => {
    // `settleInvoicePaid(<client>, {...})` writes payment_transactions,
    // payment_invoices and payment_plan_installments; the client is injected, so
    // the call sites are the only place the truth lives.
    const DEFINITION = join('lib', 'payments', 'invoiceSettlement.ts');
    const badCalls: string[] = [];
    for (const f of sourceFiles) {
      if (f.endsWith(DEFINITION)) continue; // the declaration itself, not a call
      const src = readFileSync(f, 'utf8');
      for (const call of src.split(/settleInvoicePaid\s*\(/).slice(1)) {
        if (!/^\s*supabaseServer/.test(call)) badCalls.push(`${rel(f)}: ${call.slice(0, 40).replace(/\s+/g, ' ')}`);
      }
    }
    expect(badCalls).toEqual([]);
  });
});
