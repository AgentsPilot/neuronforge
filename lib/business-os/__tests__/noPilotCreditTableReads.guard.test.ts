/**
 * Business OS never reads the agent platform's Pilot-Credit tables (plan
 * payments P-10, TK-6 / RD-2 read side, F-28).
 *
 * The Business OS usage route once read `user_subscriptions` to show a
 * Business OS owner their usage, mixing the parked agent platform's credit
 * balance into a Business OS screen (F-28). That was fixed before P-10; this
 * suite keeps it fixed. Business OS money and usage live in its own tables
 * (`business_os_*`); the Pilot-Credit tables belong to the agent platform.
 *
 * Checked by source text, as the reuse plan asks ("enforceable by grep"): no
 * non-test file under the Business OS trees calls `.from(<table>)` for one of
 * the tables below, or imports `UserSubscriptionRepository` or `CreditService`.
 * The account deletion and purge registries NAME these tables as strings (to
 * erase a user's rows), not through `.from(`, so they pass.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const BUSINESS_OS_TREES = ['app/api/business-os', 'app/business-os', 'lib/business-os', 'components/business-os'];
const SKIP_DIR = /^(node_modules|\.next|__tests__|coverage)$/;
const SKIP_FILE = /\.(test|spec)\.(ts|tsx)$/;

const PILOT_CREDIT_TABLES = [
  'user_subscriptions',
  'credit_transactions',
  'billing_events',
  'boost_pack_purchases',
  'subscription_invoices',
] as const;

const TABLE_READ = new RegExp(`\\.from\\(\\s*['"\`](${PILOT_CREDIT_TABLES.join('|')})['"\`]\\s*\\)`);
/** Whole import statements, single- or multi-line, and dynamic imports / requires. */
const IMPORT_STATEMENT = /^\s*import\s[\s\S]*?from\s+['"`][^'"`]+['"`]|import\(\s*['"`][^'"`]+['"`]\s*\)|require\(\s*['"`][^'"`]+['"`]\s*\)/gm;
const FORBIDDEN_NAME = /\b(UserSubscriptionRepository|CreditService)\b/;

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

const rel = (f: string) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');

function offences(name: string, source: string): string[] {
  const out: string[] = [];
  const read = source.match(TABLE_READ);
  if (read) out.push(`${name} reads ${read[1]}`);
  // Only import statements count; a comment naming the class is not a dependency.
  const imports = source.match(IMPORT_STATEMENT) ?? [];
  if (imports.some((statement) => FORBIDDEN_NAME.test(statement))) {
    out.push(`${name} imports a Pilot-Credit service`);
  }
  return out;
}

describe('Business OS does not read the Pilot-Credit tables (P-10, TK-6)', () => {
  const files = BUSINESS_OS_TREES.filter((d) => existsSync(join(REPO_ROOT, d)))
    .flatMap((d) => walk(join(REPO_ROOT, d)))
    .map((f) => ({ name: rel(f), source: readFileSync(f, 'utf8') }));

  it('scans every Business OS tree (non-vacuity)', () => {
    for (const tree of BUSINESS_OS_TREES) {
      expect(files.some((f) => f.name.startsWith(`${tree}/`))).toBe(true);
    }
    expect(files.some((f) => f.name === 'app/api/business-os/usage/route.ts')).toBe(true);
  });

  it('no Business OS file reads a Pilot-Credit table or imports a Pilot-Credit service', () => {
    expect(files.flatMap((f) => offences(f.name, f.source))).toEqual([]);
  });

  it('the deletion and purge registries still name the tables as strings, and pass', () => {
    const registries = files.filter((f) =>
      ['lib/business-os/account/accountDeletionPolicy.ts', 'lib/business-os/purge/descriptors.ts'].includes(f.name)
    );
    expect(registries).toHaveLength(2);
    expect(registries.some((f) => f.source.includes("'user_subscriptions'"))).toBe(true);
    for (const f of registries) expect(offences(f.name, f.source)).toEqual([]);
  });

  it('negative controls: a read and each import shape are caught; a comment is not', () => {
    expect(offences('a.ts', "const { data } = await supabase.from('user_subscriptions').select('balance');")).toEqual([
      'a.ts reads user_subscriptions',
    ]);
    expect(offences('b.ts', 'await db.from("billing_events").insert(row);')).toEqual(['b.ts reads billing_events']);
    expect(offences('c.ts', "import { CreditService } from '@/lib/services/CreditService';")).toEqual([
      'c.ts imports a Pilot-Credit service',
    ]);
    expect(
      offences('d.ts', "import {\n  UserSubscriptionRepository,\n} from '@/lib/repositories/UserSubscriptionRepository';")
    ).toEqual(['d.ts imports a Pilot-Credit service']);
    expect(offences('g.ts', "import {\n  foo,\n  UserSubscriptionRepository,\n} from '@/lib/repositories';")).toEqual([
      'g.ts imports a Pilot-Credit service',
    ]);
    expect(offences('h.ts', "const { CreditService } = await import('@/lib/services/CreditService');")).toEqual([
      'h.ts imports a Pilot-Credit service',
    ]);
    expect(offences('e.ts', '// Unlike CreditService, this reads business_os_credit_charges.')).toEqual([]);
    expect(offences('f.ts', "const TABLES = ['user_subscriptions', 'credit_transactions'];")).toEqual([]);
  });
});
