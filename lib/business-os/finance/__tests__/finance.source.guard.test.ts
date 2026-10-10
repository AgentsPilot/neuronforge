/**
 * Source guards over every slice 1a finance file (T11): the builder, its
 * wiring, the route and the page. Read-only and honest by construction:
 *
 *   - no write verb, no RPC (AC-28, NG-1);
 *   - no aggregate select (PGRST123, AGG-1) and no `token_usage` read (SA-Q4,
 *     AC-29);
 *   - no layer-B payment table (SA-Q9, AC-14);
 *   - no tier literal and no cohort-id literal (SA-F6);
 *   - no `console.` (CLAUDE.md rule 3);
 *   - never the capped Activity list reads (SA-F1, SA-Q6);
 *   - only `planGroups.ts` and the wiring reach the entitlements module.
 */

import * as fs from 'fs';
import * as path from 'path';

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(relPath, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relPath);
  }
  return out;
}

const FILES = [
  ...walk('lib/business-os/finance'),
  'app/api/admin/business-os/finance/route.ts',
  ...walk('app/admin/finance'),
  'lib/repositories/BusinessOsFinanceReadRepository.ts',
  'lib/business-os/billing/payingSubscriptionStatuses.ts',
  'app/admin/components/adminWindowPresets.ts',
];

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Comments removed: prose about a table is not a read of it. */
const codeOf = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('finance slice 1a source guards', () => {
  it('scans the slice’s files (non-vacuity)', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'lib/business-os/finance/financeHealth.ts',
        'lib/business-os/finance/financeHealthDeps.ts',
        'lib/business-os/finance/planGroups.ts',
        'lib/business-os/finance/aiCost.ts',
        'app/admin/finance/components/FinanceView.tsx',
      ])
    );
    expect(FILES.length).toBeGreaterThanOrEqual(20);
  });

  const WRITE_VERB = /\.(insert|update|upsert|delete|rpc)\s*\(/;

  it('the write-verb rule bites (planted negative control)', () => {
    expect(WRITE_VERB.test(`supabase.from('x').upsert({})`)).toBe(true);
    expect(WRITE_VERB.test(`select('updated_at')`)).toBe(false);
  });

  it.each(FILES)('%s: no write verb or RPC', (file) => {
    expect(WRITE_VERB.test(codeOf(file))).toBe(false);
  });

  it.each(FILES)('%s: no aggregate select and no token_usage', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/select\(\s*['"`][^'"`]*\b(sum|avg|min|max)\s*\(/i);
    expect(code).not.toMatch(/token_usage|TokenUsageRepository|monthly_token_usage|business_os_usage_summary/);
  });

  it.each(FILES)('%s: no layer-B payment table (slice 2)', (file) => {
    expect(codeOf(file)).not.toMatch(/payment_transactions|payment_refunds|payment_plan_/);
  });

  it.each(FILES)('%s: never the capped Activity list reads (SA-F1)', (file) => {
    expect(codeOf(file)).not.toMatch(/listChargesAllAccountsInWindow|listChargesOfDeletedAccountsInWindow/);
  });

  it.each(FILES)('%s: no console', (file) => {
    expect(read(file)).not.toMatch(/\bconsole\./);
  });

  it.each(FILES)('%s: no tier literal (tiers come from config.tierOrder)', (file) => {
    const code = codeOf(file);
    for (const id of getEntitlementConfig().tierOrder) {
      expect({ file, id, quoted: new RegExp(`['"\`]${id}['"\`]`).test(code) }).toEqual({ file, id, quoted: false });
    }
  });

  it.each(FILES)('%s: never compares a cohort with a literal id (SA-F6, SA-W3: through stateForCohort only)', (file) => {
    // A lifecycle STATE compared through its typed union is fine; a cohort id is not.
    expect(codeOf(file)).not.toMatch(/cohort\w*\s*(===|!==|==|!=)\s*['"`]/);
    expect(codeOf(file)).not.toMatch(/['"`]\s*(===|!==)\s*\w*\.cohort/);
  });

  it('only planGroups.ts and the wiring import from the entitlements module', () => {
    const importers = FILES.filter((file) => /from\s+['"][^'"]*business-os\/entitlements\//.test(codeOf(file)));
    expect(importers.sort()).toEqual(['lib/business-os/finance/financeHealthDeps.ts', 'lib/business-os/finance/planGroups.ts']);
  });

  it('the wiring imports exactly getEntitlementConfig from the module (SA-WR-4), nothing that could gate', () => {
    const code = codeOf('lib/business-os/finance/financeHealthDeps.ts');
    const imports = [...code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*business-os\/entitlements\/[^'"]*['"]/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    expect(imports).toEqual(['getEntitlementConfig']);
  });
});
