/**
 * P0-FT-RLS. Two things, both static (no DB):
 *
 * 1. What the lock-down migration does. It is applied by hand in the SQL editor
 *    after SA review, so this pins its content before anyone runs it — the same
 *    pattern as lib/audit/__tests__/ownerPolicyMigration.test.ts. The live effect
 *    is checked with the post-check query in the file header and the browser
 *    check in the apply guide.
 *
 * 2. That no caller writes `user_subscriptions` with a caller's own credentials.
 *    After the migration, `anon` and `authenticated` have no write privilege on
 *    the table, so any such write fails at runtime. This guard is the reason a
 *    new one would be caught in review instead of in production.
 *
 * WHAT THESE GUARDS CANNOT CATCH (SA RC9-9). They are textual: they see a file
 * that names `user_subscriptions`. They do NOT see a route that hands its
 * user-cookie client to a service which writes the table somewhere else — which
 * is exactly how W-4 (`app/api/stripe/create-checkout/route.ts` →
 * `StripeService.getOrCreateCustomer`) hid from two independent greps. Every
 * injected-`SupabaseClient` service must still be traced to its construction
 * sites by hand in review. The pinned assertions below cover the three call
 * sites we know about; they are a regression net, not a discovery tool.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const FILE = '20261001_user_subscriptions_write_lockdown.sql';
const REPO_ROOT = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', FILE), 'utf8');

/** The executable statements: comment lines removed, whitespace collapsed. */
const body = sql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe(`${FILE}`, () => {
  it('runs as one transaction, and fails fast instead of queueing behind its own lock (SA RC9-3)', () => {
    expect(body.startsWith('BEGIN;')).toBe(true);
    expect(body.endsWith('COMMIT;')).toBe(true);
    expect(body).toContain("SET LOCAL lock_timeout = '3s';");
    expect(body).toContain("SET LOCAL statement_timeout = '30s';");
    // Both must come before the DROPs, or they protect nothing.
    expect(body.indexOf("SET LOCAL lock_timeout")).toBeLessThan(body.indexOf('DROP POLICY'));
    expect(body.indexOf("SET LOCAL statement_timeout")).toBeLessThan(body.indexOf('DROP POLICY'));
  });

  it('drops exactly the two write policies, by name, idempotently', () => {
    expect(body.match(/DROP POLICY/g)).toHaveLength(2);
    expect(body).toContain(
      'DROP POLICY IF EXISTS "Users can update their own credits" ON public.user_subscriptions;'
    );
    expect(body).toContain(
      'DROP POLICY IF EXISTS "Users can update own subscription" ON public.user_subscriptions;'
    );
  });

  it('revokes every write privilege from anon and authenticated, and nothing else', () => {
    expect(body).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_subscriptions FROM anon, authenticated;'
    );
    expect(body.match(/REVOKE/g)).toHaveLength(1);
    // A REVOKE that named SELECT would break every billing screen.
    expect(body).not.toMatch(/REVOKE[^;]*\bSELECT\b/);
    // Nothing is handed back out, and no policy is created or rewritten: the
    // rollback lives in the header comment, not in the executable body.
    expect(body).not.toMatch(/\bGRANT\b/);
    expect(body).not.toMatch(/\bCREATE POLICY\b/);
    expect(body).not.toMatch(/\bALTER POLICY\b/);
  });

  it('leaves the SELECT policies, the service-role policy and the table itself alone', () => {
    expect(body).not.toContain('Service role can manage all credits');
    expect(body).not.toContain('Users can view');
    expect(body).not.toMatch(/\bALTER TABLE\b/);
    expect(body).not.toMatch(/\bDROP TABLE\b/);
    expect(body).not.toMatch(/ROW LEVEL SECURITY/); // never disables or forces RLS
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/); // no data statements
    expect(body).not.toMatch(/\bUPDATE\s+public\./);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/);
  });

  it('fails closed if RLS is off before it starts', () => {
    expect(body).toMatch(
      /IF NOT \( SELECT relrowsecurity FROM pg_class WHERE oid = 'public\.user_subscriptions'::regclass \) THEN RAISE EXCEPTION/
    );
  });

  it('verifies its own post-conditions inside the transaction', () => {
    // the two policies are gone
    expect(body).toMatch(/write policies still present after DROP/);
    // neither role kept a write privilege (inherited PUBLIC grants included)
    expect(body).toContain(
      "FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP"
    );
    expect(body).toContain(
      "FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP"
    );
    expect(body).toMatch(/has_table_privilege\(role_name, 'public\.user_subscriptions', priv\)/);
    // reads still work, and a RESTRICTIVE-only SELECT policy does not count
    expect(body).toMatch(/no PERMISSIVE SELECT policy left on public\.user_subscriptions/);
    expect(body).toContain("cmd = 'SELECT' AND permissive = 'PERMISSIVE'");
    expect(body).toMatch(
      /has_table_privilege\('authenticated', 'public\.user_subscriptions', 'SELECT'\)/
    );
  });

  it('documents the pre-check, the post-check and a full rollback', () => {
    expect(sql).toMatch(/PRE-CHECK/);
    expect(sql).toMatch(/STOP and send the output to the Dev/);
    expect(sql).toMatch(/POST-CHECK/);
    expect(sql).toMatch(/-- ROLLBACK/);
    expect(sql).toMatch(
      /--\s+CREATE POLICY "Users can update their own credits" ON public\.user_subscriptions/
    );
    expect(sql).toMatch(
      /--\s+CREATE POLICY "Users can update own subscription" ON public\.user_subscriptions/
    );
    expect(sql).toMatch(
      /--\s+GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/
    );
  });

  it('names the code that must ship before it is applied, including W-4', () => {
    expect(sql).toContain('app/api/run-agent/route.ts');
    expect(sql).toContain('app/api/stripe/update-subscription/route.ts');
    expect(sql).toContain('app/api/stripe/create-checkout/route.ts');
    expect(sql).toContain('getOrCreateCustomer');
    expect(sql).toContain('RewardService');
  });

  it('tells the reader what to expect from FORCE RLS and PERMISSIVE (SA RC9-6)', () => {
    expect(sql).toMatch(/rls_forced = false/);
    expect(sql).toMatch(/permissive/);
  });
});

// ---------------------------------------------------------------------------
// Source guard: who writes `user_subscriptions`?
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

describe('user_subscriptions is never written with a caller\'s own credentials', () => {
  it('no browser module writes the table directly (reads are fine)', () => {
    const offenders = sourceFiles.filter((f) => {
      const src = readFileSync(f, 'utf8');
      if (!/^\s*['"]use client['"]/m.test(src)) return false;
      // Both quote styles: a `from("user_subscriptions")` writer would otherwise
      // slip straight through this guard (SA RC9-9).
      return ["from('user_subscriptions')", 'from("user_subscriptions")'].some((needle) =>
        src
          .split(needle)
          .slice(1)
          .some((after) => WRITE_OP.test(after.slice(0, 200)))
      );
    });

    expect(offenders.map(rel)).toEqual([]);
  });

  it('only the documented pages build RewardService with the browser client', () => {
    // RewardService upserts `user_subscriptions.balance`. These two client pages
    // are the known exception, kept as-is on purpose: that path IS the
    // vulnerability (a user can replay the upsert to award themselves credits),
    // so after the migration the reward is simply not credited until a
    // server-side reward route lands. Adding a third caller must fail here.
    const callers = sourceFiles
      .filter((f) => /new RewardService\s*\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();

    expect(callers).toEqual([
      'app/(protected)/agents/[id]/page.tsx',
      'app/v2/agents/[id]/page.tsx',
    ]);
  });

  it('run-agent charges credits with the service-role client', () => {
    const src = readFileSync(join(REPO_ROOT, 'app/api/run-agent/route.ts'), 'utf8');
    expect(src).toContain("import { supabaseServer } from '@/lib/supabaseServer'");
    expect(src).toContain('new CreditService(supabaseServer)');
    expect(src).not.toContain('new CreditService(supabase)');
  });

  it('Stripe checkout hands the service-role client to the customer-creating calls (W-4)', () => {
    // `getOrCreateCustomer` UPDATEs/INSERTs `user_subscriptions` without checking
    // the result; with the cookie client it would fail 42501 in silence and a
    // paying user with no row would never be credited.
    const src = readFileSync(
      join(REPO_ROOT, 'app/api/stripe/create-checkout/route.ts'),
      'utf8'
    );
    expect(src).toContain("import { supabaseServer } from '@/lib/supabaseServer'");
    expect(src.match(/supabase: supabaseServer,/g)).toHaveLength(2);
    // The bare shorthand would pass the cookie client again.
    expect(src).not.toMatch(/stripeService\.create\w+\(\{\s+supabase,/);
  });

  it('the Stripe subscription update writes with the service-role client', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'app/api/stripe/update-subscription/route.ts'),
      'utf8'
    );
    expect(src).toMatch(
      /await supabaseServer\s*\.from\('user_subscriptions'\)\s*\.update\(/
    );
    expect(src).not.toMatch(/await supabase\s*\.from\('user_subscriptions'\)\s*\.update\(/);
    // SA RC9-5: the result is captured, logged through Pino and surfaced as a 500.
    expect(src).toContain('const { error: subUpdateError }');
    expect(src).toMatch(/if \(subUpdateError\) \{/);
    expect(src).toMatch(/status: 500/);
    expect(src).not.toMatch(/console\./);
  });

  it('the share-reward failure path is loud in both agent pages (SA RC9-7)', () => {
    for (const page of ['app/v2/agents/[id]/page.tsx', 'app/(protected)/agents/[id]/page.tsx']) {
      const src = readFileSync(join(REPO_ROOT, page), 'utf8');
      expect(src).toContain(
        'Agent shared. The credit reward could not be applied right now and will be credited later.'
      );
      expect(src).toContain('Agent shared but the sharing reward could not be applied');
    }
  });
});
