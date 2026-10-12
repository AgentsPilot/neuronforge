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
 *
 * Slice 1b adds: the wiring's lot calls are exactly the two reads (SA-Q10);
 * no finance file names a lot writer or a lot RPC; the lots are narrowed
 * field by field (SA-W14); Section 4 never shows money; and no finance file
 * names a credit-figure builder or imports the entitlement service (SA-WR-11).
 *
 * Slice 2a (S2-F1, §12.1): the layer-B rule is NARROWED to every file but the
 * finance read repository, and the repository gets a POSITIVE pin instead:
 * the exact set of tables it reads, with every `.from(` a string literal
 * (SA-WR-16). The four layer-B method bodies name no `livemode` (BD-13); no
 * file reads `exchange_rates` (CUR-3); the currency helper's exports are
 * pinned; the 2a files carry no test-mode wording and no "Deleted business"
 * (AC-54, AC-55); no processor literal in the finance lib (SA-W21); and no
 * page file adds or subtracts two money fields (SA-WR-18). Every new rule has
 * a planted negative control.
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

const REPOSITORY = 'lib/repositories/BusinessOsFinanceReadRepository.ts';
/** Every scanned file but the finance read repository (slice 2a, S2-F1). */
const LAYER_B_FREE = FILES.filter((file) => file !== REPOSITORY);

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

  // Slice 2a (S2-F1): the finance read repository is the one file allowed to
  // name a layer-B table; it is pinned positively below instead.
  it.each(LAYER_B_FREE)('%s: no layer-B payment table (only the finance read repository reads them)', (file) => {
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

describe('finance slice 1b source guards (Section 4, the lots, SA-Q10, SA-W14, SA-WR-11)', () => {
  const WIRING = 'lib/business-os/finance/financeHealthDeps.ts';
  const LOT_CALL = /\b(?:lotReads|businessOsCreditLotRepository)\s*\.\s*(\w+)\s*\(/g;

  it('scans the slice 1b files too (non-vacuity)', () => {
    expect(FILES).toEqual(
      expect.arrayContaining(['lib/business-os/finance/creditsSection.ts', 'app/admin/finance/components/CreditsSection.tsx'])
    );
  });

  it('the wiring calls exactly the two lot READS, through a Pick of exactly those two', () => {
    const code = codeOf(WIRING);
    const calls = [...code.matchAll(LOT_CALL)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(['listLotsWithDraws', 'listLotsWithDrawsAllAccounts']);
    expect(code).toMatch(/Pick<BusinessOsCreditLotRepository,\s*'listLotsWithDrawsAllAccounts'\s*\|\s*'listLotsWithDraws'>/);
    // Planted negative control: a writer call would be seen.
    const planted = 'lotReads.listLotsWithDraws(a); businessOsCreditLotRepository.recordLot(b)';
    expect([...planted.matchAll(LOT_CALL)].map((m) => m[1])).toEqual(['listLotsWithDraws', 'recordLot']);
  });

  it.each(FILES)('%s: names no lot writer and no lot RPC', (file) => {
    expect(codeOf(file)).not.toMatch(/\brecordLot\b|\breverseLot\b|business_os_record_credit_lot|business_os_reverse_credit_lot|BOS_RECORD_CREDIT_LOT_RPC|BOS_REVERSE_CREDIT_LOT_RPC/);
  });

  it('SA-W14: the wiring maps lots field by field, never with a spread', () => {
    const code = codeOf(WIRING);
    const mapper = code.slice(code.indexOf('export function toFinanceLot'), code.indexOf('type LotsResult'));
    expect(mapper.length).toBeGreaterThan(0);
    expect(mapper).not.toMatch(/\.\.\./);
    expect(mapper).not.toMatch(/\breason\b|idempotencyKey|sourceRef|creditValueVersion/);
  });

  it('only the wiring and the pure section name the lot repository or the balance core (G3 kept narrow)', () => {
    const LOT_SYMBOLS = /BusinessOsCreditLotRepository|businessOsCreditLotRepository|credits\/creditLots|extraCreditsAt|creditLotRemaining|isCreditLotExpired/;
    const namers = FILES.filter((file) => LOT_SYMBOLS.test(read(file)));
    expect(namers.sort()).toEqual(['lib/business-os/finance/creditsSection.ts', 'lib/business-os/finance/financeHealthDeps.ts']);
  });

  it.each(['lib/business-os/finance/creditsSection.ts', 'app/admin/finance/components/CreditsSection.tsx'])(
    '%s: credits are units, never money — no USD and no cost',
    (file) => {
      expect(read(file)).not.toMatch(/USD|\bcost/i);
    }
  );

  it.each(FILES.filter((file) => file.startsWith('lib/business-os/finance/')))(
    'SA-WR-11: %s names none of the credit-figure builders (comments included) and does not import the entitlement service',
    (file) => {
      expect(read(file)).not.toMatch(/creditAllowanceForDisplay|ownerCreditUsage|describePlanOffer|describeInviteOffer|buildCustomerPlanView/);
      expect(read(file)).not.toMatch(/business-os\/entitlements\/(EntitlementService|index)['"]|\bgetEntitlementService\b/);
    }
  );

  it('SA-WR-11 rule bites (planted)', () => {
    expect(/creditAllowanceForDisplay/.test('// uses creditAllowanceForDisplay')).toBe(true);
    expect(/business-os\/entitlements\/(EntitlementService|index)['"]/.test(`from '@/lib/business-os/entitlements/EntitlementService';`)).toBe(true);
  });
});

describe('finance slice 2a source guards (layer B, S2-F1, §12.1)', () => {
  const TAKINGS_FILES = [
    'lib/business-os/finance/currencyGroups.ts',
    'lib/business-os/finance/takings.ts',
    'app/admin/finance/components/TakingsSection.tsx',
  ];

  it('scans the slice 2a files, and the narrowed list leaves out only the repository (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining([...TAKINGS_FILES, REPOSITORY]));
    expect(LAYER_B_FREE).toHaveLength(FILES.length - 1);
    expect(LAYER_B_FREE).not.toContain(REPOSITORY);
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining(TAKINGS_FILES));
  });

  // ── The positive table pin (S2-F1, SA-WR-16) ──
  const FROM_LITERAL = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
  /** Any `.from(` call at all, literal or not (an `Array.from(` would count too, on purpose: it must be looked at). */
  const FROM_ANY = /\.from\s*\(/g;
  const tablesOf = (code: string) => [...code.matchAll(FROM_LITERAL)].map((m) => m[1]);
  const fromCallsOf = (code: string) => (code.match(FROM_ANY) ?? []).length;

  it('the extractor bites (planted negative controls)', () => {
    expect(tablesOf("x.from('payment_reminders')")).toEqual(['payment_reminders']);
    expect(tablesOf('x.from( "payment_refunds" )')).toEqual(['payment_refunds']);
    // A non-literal argument is not a table match, but it IS a .from( call: the counts differ.
    const planted = "this.supabase.from(TABLE).select('*'); this.supabase.from('payment_refunds')";
    expect(tablesOf(planted)).toEqual(['payment_refunds']);
    expect(fromCallsOf(planted)).toBe(2);
    expect(fromCallsOf(planted)).not.toBe(tablesOf(planted).length);
  });

  it('the repository reads exactly its five tables, and every .from( names its table as a literal', () => {
    const code = codeOf(REPOSITORY);
    const tables = tablesOf(code);
    expect(tables.length).toBeGreaterThanOrEqual(5);
    // SA-WR-16: a .from(TABLE) with a non-literal argument cannot escape the set below.
    expect(fromCallsOf(code)).toBe(tables.length);
    expect([...new Set(tables)].sort()).toEqual([
      'business_os_billing_accounts',
      'business_os_billing_events',
      'business_os_boost_purchases',
      'payment_refunds',
      'payment_transactions',
    ]);
    // R-j owns the reminder queue (slice 2b, reused read): never here.
    expect(tables).not.toContain('payment_reminders');
  });

  it('the set check fails on a planted extra table', () => {
    const planted = `${codeOf(REPOSITORY)}\nthis.supabase.from('payment_reminders').select('id');`;
    expect([...new Set(tablesOf(planted))].sort()).not.toEqual([
      'business_os_billing_accounts',
      'business_os_billing_events',
      'business_os_boost_purchases',
      'payment_refunds',
      'payment_transactions',
    ]);
  });

  // ── No livemode in a layer-B method body (BD-13, AC-55) ──
  const LAYER_B_METHODS = [
    'listClientPaymentsAllAccountsPaidInRange',
    'listClientPaymentsForAccountPaidInRange',
    'listClientRefundsAllAccountsCreatedInRange',
    'listClientRefundsForAccountCreatedInRange',
    // The shared paging every one of them delegates to.
    'pageClientRows',
  ];
  /** From `async <name>(` to the next `async ` or the end of the class. */
  const bodyOf = (code: string, name: string) => {
    const start = code.search(new RegExp(`async\\s+${name}\\s*[<(]`));
    if (start < 0) return '';
    const next = code.indexOf('async ', start + 6);
    const classEnd = code.indexOf('\n}\n', start);
    const end = next < 0 ? classEnd : classEnd < 0 ? next : Math.min(next, classEnd);
    return code.slice(start, end < 0 ? undefined : end);
  };

  it('the body slicer bites (planted): a planted livemode filter in a method body is caught', () => {
    const planted = "class X {\n  async listClientPaymentsAllAccountsPaidInRange(r) {\n    return q.eq('livemode', true);\n  }\n  async other() {}\n}\n";
    const body = bodyOf(planted, 'listClientPaymentsAllAccountsPaidInRange');
    expect(body).toMatch(/livemode/);
    expect(body).not.toMatch(/other/);
  });

  it.each(LAYER_B_METHODS)('%s: its body is found and names no livemode', (name) => {
    const body = bodyOf(codeOf(REPOSITORY), name);
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toMatch(/livemode/);
  });

  it('the layer-A reads still filter livemode (the rule above is not vacuous by a missing word)', () => {
    expect(bodyOf(codeOf(REPOSITORY), 'listLiveBillingStatusesAllAccounts')).toMatch(/livemode/);
  });

  // ── No FX, no exchange rate (CUR-3) ──
  it('the exchange-rate rule bites (planted)', () => {
    expect(/exchange_rates/.test("from('exchange_rates')")).toBe(true);
  });

  it.each(FILES)('%s: no exchange_rates read', (file) => {
    expect(codeOf(file)).not.toMatch(/exchange_rates/);
  });

  // ── The currency helper's exports (S2-CUR-1) ──
  it('currencyGroups.ts exports exactly four runtime names and one type: none is a cross-currency total', () => {
    const code = codeOf('lib/business-os/finance/currencyGroups.ts');
    const exported = [...code.matchAll(/export\s+(?:const|function|interface|type|class|let|var)\s+(\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual(['CURRENCY_SCALE', 'CurrencyLine', 'groupByCurrency', 'normaliseCurrencyCode', 'toHundredths']);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
  });

  // ── No test-mode wording, no livemode, no "Deleted business" in the 2a files (AC-54, AC-55) ──
  it('the wording rule bites (planted)', () => {
    expect(/livemode|test.?mode/i.test('Shows Test mode payments')).toBe(true);
    expect(/Deleted business/.test("'Deleted business'")).toBe(true);
  });

  it.each(TAKINGS_FILES)('%s: no livemode, no test-mode wording, no "Deleted business"', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/livemode|test.?mode/i);
    expect(code).not.toMatch(/Deleted business/);
  });

  // ── No processor literal in the finance lib (SA-W21) ──
  const PROCESSOR_LITERAL = /['"`](stripe|manual)['"`]/i;
  it('the processor-literal rule bites (planted)', () => {
    expect(PROCESSOR_LITERAL.test("if (p === 'stripe')")).toBe(true);
    expect(PROCESSOR_LITERAL.test('processorType')).toBe(false);
  });

  it.each(FILES.filter((file) => file.startsWith('lib/')))('%s: no processor literal (labels live in financeCopy.ts)', (file) => {
    expect(codeOf(file)).not.toMatch(PROCESSOR_LITERAL);
  });

  // ── The page never adds or subtracts money (SA-WR-18) ──
  const MONEY = '(?:gross|refunded|net|fees)';
  const MONEY_ARITHMETIC = new RegExp(`\\b${MONEY}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY}\\b)`);
  it('the money-arithmetic rule bites (planted)', () => {
    expect(MONEY_ARITHMETIC.test('const n = line.gross - line.refunded;')).toBe(true);
    expect(MONEY_ARITHMETIC.test('total += row.net')).toBe(false);
    expect(MONEY_ARITHMETIC.test('row.net += x')).toBe(true);
    expect(MONEY_ARITHMETIC.test('a.fees + b.fees')).toBe(true);
    expect(MONEY_ARITHMETIC.test('formatMoney(line.gross, line.currency)')).toBe(false);
  });

  it.each(FILES.filter((file) => file.startsWith('app/admin/finance/')))('%s: adds or subtracts no two money fields', (file) => {
    expect(codeOf(file)).not.toMatch(MONEY_ARITHMETIC);
  });
});
