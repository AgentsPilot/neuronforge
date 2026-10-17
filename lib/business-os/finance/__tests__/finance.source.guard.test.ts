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
 *
 * Slice 2b (S2-F1, §12.1, AC-61, AC-64, AC-74): the positive table pin grows to
 * EIGHT tables (the client invoices, plan instalments and client plans join
 * it; the reminder queue never does); `payment_invoices` joins the layer-B
 * rule; the six 2b method bodies name no `livemode`; no finance file holds
 * the reminder queue's own vocabulary, and only the route names the jobs &
 * queues read (SA-W29); the invoice and instalment status literals live only
 * in the repository and the pure builder; `dueDates.ts` never builds a Date
 * and no due date is parsed as an instant (SA-W33); the 2b files name no
 * client column; and no 2b page file or builder adds two amounts. Every new
 * rule has a planted negative control.
 *
 * Slice 1c (BD-14, SA-Q22, AC-81, SA-WR-30): "the layer-A reads still filter
 * livemode" is REPLACED by "the repository's code names no livemode", with a
 * planted control run through the same comment stripper as every rule here.
 * Two wording rules join (AC-81): no page or builder code says "webhook",
 * "not in place" or "test accounts only", and no scanned file's code names a
 * mode. Each has a planted control, including the known false-positive shape
 * of an identifier such as latestMode (SA-WR-30).
 *
 * Slice 4a (SA-Q26, SA-W22, SA-W53, SA-W54, SA-WR-34, SA-WR-35): the boost
 * revenue builder never scales money (no decimal helper, no × 100; credits go
 * through toUnits once), reads no date, keeps the DF-5 rule in one function
 * and its sentence in one copy line used by the panel only, imports no data
 * layer, exports exactly four names, and names no Stripe or lot field; the
 * page adds no two 4a money fields; K-5's money is printed only through
 * formatMoney or a copy string. No existing rule is edited. Each new rule has
 * a planted negative control.
 *
 * Slice 5a (Money M-1 and M-2, §11D.7): one existing rule is WIDENED, by SA
 * ruling SA-W58 (a) / SA-WR-38: the refund-timing sentence now has exactly two
 * users, the revenue panel and the account summary, with a planted third user
 * as the control. The table pin is unchanged (R-m / R-m′ read the billing
 * events, already pinned for R-d). A new describe pins the plan revenue
 * builder and the combiner (scale, purity, exports, the kind literal), the
 * R-m / R-m′ bodies, the page's money arithmetic over the 5a fields, `formatUtc`
 * on the plans part and no dim text in the new page file. Every new rule has a
 * planted negative control. The M-1 page rules (the local chip, the picked name,
 * the links file) live in the page's own guard, app/admin/finance/__tests__/source.guard.test.ts.
 *
 * Slice 6a (Money M-3, §11E.6, E-44, SA-Q45): three existing pins are UPDATED,
 * each by SA ruling: the boost and plan export pins grow to exactly five names
 * (`readMoney`, `readPlanMoney`), each with a planted sixth export (SA-WR-45);
 * the refund-timing sentence gets a third user, the Accounts tab, with a
 * planted fourth. A new describe pins the account economics builder (one
 * integer scale, purity, readers only, zero DF-5 tokens, exports, one 'USD')
 * and the purity of financeUrl.ts, whose group shape the route imports
 * (SA-W83, SA-WR-42). Every new rule has a planted negative control.
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

// CRLF normalised (as in PR #394): on a Windows checkout the newline-shaped
// scans below (the DF-5 function and interface ends) otherwise find nothing.
const read = (file: string) =>
  fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
/** Comments removed: prose about a table is not a read of it. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (file: string) => stripComments(read(file));

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

  // Money M-4 (SA-RR-M4, SA-W103, §11F.8): NARROWED by SA ruling. The table and view names stay
  // forbidden in EVERY file, the route included (AGG-4: no file reads `token_usage` itself); the
  // usage-log READER name moved to the rule below, which spares the route only.
  it.each(FILES)('%s: no aggregate select and no token_usage table or usage-log view', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/select\(\s*['"`][^'"`]*\b(sum|avg|min|max)\s*\(/i);
    expect(code).not.toMatch(/token_usage|monthly_token_usage|business_os_usage_summary/);
  });

  // Money M-4 (SA-W103): WIDENED to `/tokenusage/i` over code (comments stripped), so the analytics
  // reader and both instance names are caught too, not only `TokenUsageRepository` (today's gap).
  // Only the route may name a usage-log reader; it is pinned positively in the M-4 describe.
  const USAGE_LOG_READER = /tokenusage/i;
  const NOT_THE_ROUTE = FILES.filter((file) => file !== 'app/api/admin/business-os/finance/route.ts');

  it.each(NOT_THE_ROUTE)('%s: names no usage-log reader in code (only the route may, M4-FR-6)', (file) => {
    expect(codeOf(file)).not.toMatch(USAGE_LOG_READER);
  });

  it('the widened reader rule bites on every reader and instance name (planted); the narrowing spares the route only', () => {
    for (const planted of [
      "import { tokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';",
      "import type { AdminCostPointRow } from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';",
      'adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(ctx, w, f, o)',
      'const r = new TokenUsageRepository();',
    ]) {
      expect({ planted, caught: USAGE_LOG_READER.test(planted) }).toEqual({ planted, caught: true });
    }
    // The old case-sensitive pattern missed the analytics reader: the gap this closes.
    expect(/TokenUsageRepository/.test('AdminTokenUsageAnalyticsRepository')).toBe(false);
    expect(FILES.length - NOT_THE_ROUTE.length).toBe(1);
    // AGG-4 still bites on the route's own code.
    expect(`${codeOf('app/api/admin/business-os/finance/route.ts')}\nq.from('token_usage');\n`).toMatch(/token_usage/);
  });

  // Slice 2a (S2-F1): the finance read repository is the one file allowed to
  // name a layer-B table; it is pinned positively below instead.
  // Slice 2b: `payment_invoices` joins the rule (the `payment_plan_` prefix already covers the other two).
  const LAYER_B_TABLE = /payment_transactions|payment_refunds|payment_plan_|payment_invoices/;

  it('the layer-B rule bites on each 2b table (planted)', () => {
    for (const planted of ["from('payment_invoices')", "from('payment_plan_installments')", "from('payment_plan_subscriptions')"]) {
      expect(LAYER_B_TABLE.test(planted)).toBe(true);
    }
    expect(LAYER_B_TABLE.test("from('payment_reminders')")).toBe(false);
  });

  it.each(LAYER_B_FREE)('%s: no layer-B payment table (only the finance read repository reads them)', (file) => {
    expect(codeOf(file)).not.toMatch(LAYER_B_TABLE);
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
    expect(codeOf(file)).not.toMatch(/['"`]\s*(===|!==)\s*\w*\.cohort\b/);
  });

  it('the cohort-literal rules bite (planted negative control, SA-CR-1)', () => {
    // The same pattern as the rule above (with \b, so cohortExpiresAt is not a cohort).
    const LITERAL_FIRST = /['"`]\s*(===|!==)\s*\w*\.cohort\b/;
    expect(LITERAL_FIRST.test("if ('champion' === row.cohort) n += 1;")).toBe(true);
    expect(LITERAL_FIRST.test("if ('x' === row.cohortExpiresAt) n += 1;")).toBe(false);
    expect(/cohort\w*\s*(===|!==|==|!=)\s*['"`]/.test("row.cohort === 'champion'")).toBe(true);
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

  /** Slice 2b (S2-F1): the five of 1a / 2a plus the client invoices, plan instalments and client plans. Slice 4a: R-k and R-k′ read the boost table too (already here for R-d). Slice 5a: R-m and R-m′ read the billing events too (already here for R-d). */
  const REPOSITORY_TABLES = [
    'business_os_billing_accounts',
    'business_os_billing_events',
    'business_os_boost_purchases',
    'payment_invoices',
    'payment_plan_installments',
    'payment_plan_subscriptions',
    'payment_refunds',
    'payment_transactions',
  ];

  it('the repository reads exactly its eight tables, and every .from( names its table as a literal', () => {
    const code = codeOf(REPOSITORY);
    const tables = tablesOf(code);
    expect(tables.length).toBeGreaterThanOrEqual(8);
    // SA-WR-16: a .from(TABLE) with a non-literal argument cannot escape the set below.
    expect(fromCallsOf(code)).toBe(tables.length);
    expect([...new Set(tables)].sort()).toEqual(REPOSITORY_TABLES);
    // R-j owns the reminder queue (slice 2b, reused read): never here.
    expect(tables).not.toContain('payment_reminders');
  });

  it('the set check fails on a planted extra table', () => {
    const planted = `${codeOf(REPOSITORY)}\nthis.supabase.from('payment_reminders').select('id');`;
    expect([...new Set(tablesOf(planted))].sort()).not.toEqual(REPOSITORY_TABLES);
  });

  it('the set check fails on a planted near miss (payment_plans for payment_plan_installments)', () => {
    const planted = codeOf(REPOSITORY).replace("from('payment_plan_installments')", "from('payment_plans')");
    expect(planted).not.toBe(codeOf(REPOSITORY));
    expect([...new Set(tablesOf(planted))].sort()).not.toEqual(REPOSITORY_TABLES);
  });

  // ── No livemode in a layer-B method body (BD-13, AC-55) ──
  const LAYER_B_METHODS = [
    'listClientPaymentsAllAccountsPaidInRange',
    'listClientPaymentsForAccountPaidInRange',
    'listClientRefundsAllAccountsCreatedInRange',
    'listClientRefundsForAccountCreatedInRange',
    // Slice 2b.
    'listOverdueClientInvoicesAllAccounts',
    'listOverdueClientInvoicesForAccount',
    'listOverdueClientInstalmentsAllAccounts',
    'listOverdueClientInstalmentsForAccount',
    'listClientPlansAllAccounts',
    'listClientPlansForAccount',
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

  // Slice 1c (SA-Q22, BD-14): the layer-A reads no longer filter by mode, so
  // the whole repository's code names no livemode. The planted control runs
  // the SAME stripper (stripComments), so the rule bites on code, not prose.
  it('the repository-wide livemode rule bites on code and not on a comment (planted)', () => {
    expect(stripComments("// livemode in a comment\nconst a = 1;")).not.toMatch(/livemode/);
    expect(stripComments("/* livemode in a block */\nconst a = 1;")).not.toMatch(/livemode/);
    expect(stripComments("const r = await q.eq('livemode', true);")).toMatch(/livemode/);
  });

  it('the repository code names no livemode (BD-14: test and real rows count together)', () => {
    const code = codeOf(REPOSITORY);
    expect(code.length).toBeGreaterThan(5000);
    expect(code).not.toMatch(/livemode/);
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

describe('finance slice 2b source guards (client payment problems, §12.1, AC-61, AC-64, AC-74)', () => {
  const ROUTE = 'app/api/admin/business-os/finance/route.ts';
  const DUE_DATES = 'lib/business-os/finance/dueDates.ts';
  const PROBLEMS = 'lib/business-os/finance/paymentProblems.ts';
  const NEW_FILES = [
    DUE_DATES,
    PROBLEMS,
    'app/admin/finance/components/PaymentProblemsSection.tsx',
    'app/admin/finance/components/OverdueTable.tsx',
  ];
  /** Every file 2b adds or changes in the finance tree. */
  const FILES_2B = [
    ...NEW_FILES,
    REPOSITORY,
    ROUTE,
    'lib/business-os/finance/financeHealth.ts',
    'lib/business-os/finance/financeHealthDeps.ts',
    'lib/business-os/finance/financeTypes.ts',
    'app/admin/finance/financeCopy.ts',
    'app/admin/finance/components/FinanceView.tsx',
  ];

  it('scans the slice 2b files (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining(FILES_2B));
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining(NEW_FILES));
  });

  // ── AC-61 / SA-W29: the reminder queue's own vocabulary stays in Jobs & queues ──
  const REMINDER_VOCABULARY = /STUCK_AFTER_SECONDS|DEAD_LETTER_MARKER|ADMIN_QUEUE_SPECS|dead-letter|'processing'|claimed_at|error_message|\b690\b|90\s*\+\s*10/;

  it('the reminder-vocabulary rule bites on each term (planted)', () => {
    for (const planted of [
      'const s = STUCK_AFTER_SECONDS;',
      "if (msg === DEAD_LETTER_MARKER) n += 1;",
      'ADMIN_QUEUE_SPECS.payment_reminders',
      "q.like('error_message', 'dead-letter: max attempts')",
      "q.eq('status', 'processing')",
      "q.lt('claimed_at', before)",
      'const STUCK = 690;',
      'const STUCK = 90 + 10 * 60;',
    ]) {
      expect({ planted, caught: REMINDER_VOCABULARY.test(planted) }).toEqual({ planted, caught: true });
    }
    // The page's own words are not the vocabulary: "Dead-lettered (24 h)", "In progress".
    expect(REMINDER_VOCABULARY.test("deadLettered24h: 'Dead-lettered (24 h)', inProgress: 'In progress'")).toBe(false);
  });

  it.each(FILES)('%s: none of the reminder queue’s own vocabulary (AC-61)', (file) => {
    expect(codeOf(file)).not.toMatch(REMINDER_VOCABULARY);
  });

  const JOBS_READ = /AdminJobsQueuesRepository|adminJobsQueuesRepository|readQueueFiguresAllAccounts/;

  it('only the route names the jobs & queues read, comments included (a positive pin)', () => {
    const namers = FILES.filter((file) => JOBS_READ.test(read(file)));
    expect(namers).toEqual([ROUTE]);
  });

  it('the namers pin bites (planted): a builder naming the read would join the list', () => {
    const planted = "import type { RawQueueFigures } from '@/lib/repositories/AdminJobsQueuesRepository';";
    expect(JOBS_READ.test(planted)).toBe(true);
    expect(JOBS_READ.test('readReminderFigures: (now, signal) => deps.read(now, signal)')).toBe(false);
  });

  const STATUS_LITERAL = /['"`](?:sent|pending)['"`]|\.eq\.(?:sent|pending)\b/;

  it('the invoice and instalment status literals live only in the repository and the pure builder (a positive pin)', () => {
    const holders = FILES.filter((file) => STATUS_LITERAL.test(codeOf(file)));
    expect(holders.sort()).toEqual([REPOSITORY, PROBLEMS].sort());
  });

  it('the status-literal pin bites (planted), and copy words are not literals', () => {
    expect(STATUS_LITERAL.test("row.status === 'sent'")).toBe(true);
    expect(STATUS_LITERAL.test('`status.eq.overdue,and(status.eq.pending,due_date.lt.${t})`')).toBe(true);
    expect(STATUS_LITERAL.test("pastDueColumn: 'Past due date, still pending',")).toBe(false);
    expect(STATUS_LITERAL.test("pending: 'Pending',")).toBe(false);
  });

  // ── SA-W33 / AC-74: a due date never goes through a Date ──
  const BUILDS_DATE = /new Date\(|Date\.parse\(/;
  const DUE_INTO_DATE = /(?:new Date|Date\.parse)\(\s*[^)]*\bdue_?[dD]ate/;

  it('the date rules bite (planted)', () => {
    expect(BUILDS_DATE.test('return new Date(value);')).toBe(true);
    expect(BUILDS_DATE.test('Date.parse(`${due}T00:00:00Z`)')).toBe(true);
    expect(DUE_INTO_DATE.test('const d = new Date(row.due_date);')).toBe(true);
    expect(DUE_INTO_DATE.test('Date.parse(row.dueDate)')).toBe(true);
    expect(DUE_INTO_DATE.test('Date.parse(row.next_charge_at)')).toBe(false);
  });

  it('dueDates.ts builds no Date at all (it works on the text and the presets helper)', () => {
    const code = codeOf(DUE_DATES);
    expect(code.length).toBeGreaterThan(200);
    expect(code).not.toMatch(BUILDS_DATE);
  });

  it.each(FILES)('%s: never passes a due date through a Date', (file) => {
    expect(codeOf(file)).not.toMatch(DUE_INTO_DATE);
  });

  // ── AC-64: no client data in the 2b files ──
  const CLIENT_COLUMN = /contact_id|client_name|client_email|client_phone|line_items|invoice_number|internal_notes/;

  it('the client-column rule bites (planted)', () => {
    expect(CLIENT_COLUMN.test("'id, user_id, contact_id, amount'")).toBe(true);
    expect(CLIENT_COLUMN.test('row.client_email')).toBe(true);
  });

  it.each(FILES_2B)('%s: names no client column (AC-64)', (file) => {
    expect(codeOf(file)).not.toMatch(CLIENT_COLUMN);
  });

  // ── BD-13 / S2-F6: no test-mode wording, no "Deleted business" in the new files ──
  it.each(NEW_FILES)('%s: no livemode, no test-mode wording, no "Deleted business"', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/livemode|test.?mode/i);
    expect(code).not.toMatch(/Deleted business/);
  });

  it('the copy file holds no test-mode wording in the 2b strings', () => {
    const copy = read('app/admin/finance/financeCopy.ts');
    // The 2b strings, their comments removed (a comment may say what the copy must not).
    const block = copy.slice(copy.indexOf('client payment problems (slice 2b)')).replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(block.length).toBeGreaterThan(500);
    expect(block).toMatch(/PROBLEMS_TITLE/);
    expect(block).not.toMatch(/livemode|test.?mode|Deleted business/i);
  });

  // ── CUR: no two amounts added or subtracted (the SA-WR-18 rule, extended to `amount`) ──
  const MONEY_2B = '(?:gross|refunded|net|fees|amount)';
  const AMOUNT_ARITHMETIC = new RegExp(`\\b${MONEY_2B}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY_2B}\\b)`);

  it('the amount-arithmetic rule bites (planted)', () => {
    expect(AMOUNT_ARITHMETIC.test('const total = a.amount + b.amount;')).toBe(true);
    expect(AMOUNT_ARITHMETIC.test('line.amount += row.amount')).toBe(true);
    expect(AMOUNT_ARITHMETIC.test('formatMoney(line.amount, line.currency)')).toBe(false);
    expect(AMOUNT_ARITHMETIC.test('amount: toMoney(line.sums.amount)')).toBe(false);
  });

  it.each([PROBLEMS, ...FILES.filter((file) => file.startsWith('app/admin/finance/'))])(
    '%s: adds or subtracts no two amounts',
    (file) => {
      expect(codeOf(file)).not.toMatch(AMOUNT_ARITHMETIC);
    }
  );

  // ── SA-W22 / SA-W35: the pure modules import no repository ──
  it.each([DUE_DATES, PROBLEMS])('%s: imports no repository and no Supabase client', (file) => {
    expect(read(file)).not.toMatch(/@\/lib\/repositories|supabase/i);
  });
});

// ── Slice 1c: no mode and no webhook wording (AC-81, S1C-FR-7, SA-WR-30) ─────
describe('finance slice 1c wording guards', () => {
  const PAGE_AND_BUILDER = [...walk('app/admin/finance'), 'lib/business-os/finance/financeHealth.ts'];
  const OLD_PANEL_WORDING = /webhook|not in place|test accounts only/i;
  const MODE_WORDING = /livemode|test.?mode|live.?mode/i;

  it('scans the page and the builder (non-vacuity)', () => {
    expect(PAGE_AND_BUILDER).toEqual(
      expect.arrayContaining(['app/admin/finance/financeCopy.ts', 'app/admin/finance/components/RevenuePanel.tsx'])
    );
  });

  it('the old-panel wording rule bites (planted: the 1a "none yet" sentence)', () => {
    const planted =
      "export const REVENUE_NONE_YET = 'None yet. Plan billing is not live (the payment webhook is not in place) and credit boosts are open to test accounts only.';";
    expect(stripComments(planted)).toMatch(OLD_PANEL_WORDING);
    expect(stripComments('// the webhook writes it\nconst a = 1;')).not.toMatch(OLD_PANEL_WORDING);
  });

  it.each(PAGE_AND_BUILDER)('%s: no "webhook", "not in place" or "test accounts only" in code', (file) => {
    expect(codeOf(file)).not.toMatch(OLD_PANEL_WORDING);
  });

  it('the mode-wording rule bites (planted), and its known false-positive shape is recorded (SA-WR-30)', () => {
    expect(MODE_WORDING.test("'Live-mode plan invoices and paid boosts'")).toBe(true);
    expect(MODE_WORDING.test("q.eq('livemode', true)")).toBe(true);
    expect(MODE_WORDING.test('Shows Test mode payments')).toBe(true);
    expect(MODE_WORDING.test("'deliver'")).toBe(false);
    expect(MODE_WORDING.test("'alive'")).toBe(false);
    // SA-WR-30: an identifier such as latestMode matches too. No scanned file
    // holds one today (the rule below passes); if one ever does, narrow the
    // rule to string literals rather than renaming the identifier.
    expect(MODE_WORDING.test('const latestMode = 1;')).toBe(true);
  });

  it.each(FILES)('%s: names no mode in code (no livemode, test mode or live mode)', (file) => {
    expect(codeOf(file)).not.toMatch(MODE_WORDING);
  });
});

// ── Slice 4a: our boost revenue (SA-Q26, SA-W22, SA-W53, SA-W54, SA-WR-34, SA-WR-35) ──
describe('finance slice 4a source guards (our boost revenue)', () => {
  const BUILDER = 'lib/business-os/finance/boostRevenue.ts';
  const PANEL = 'app/admin/finance/components/RevenuePanel.tsx';
  const STRIP = 'app/admin/finance/components/FinanceKpiStrip.tsx';
  const COPY = 'app/admin/finance/financeCopy.ts';
  const BOOST_METHODS = ['listBoostPurchasesAllAccountsPaidInRange', 'listBoostPurchasesForAccountPaidInRange'];
  /** From `async <name>(` to the next `async ` or the end of the class (the 2a slicer, repeated here). */
  const bodyOf = (code: string, name: string) => {
    const start = code.search(new RegExp(`async\\s+${name}\\s*[<(]`));
    if (start < 0) return '';
    const next = code.indexOf('async ', start + 6);
    return code.slice(start, next < 0 ? undefined : next);
  };

  // (a) Non-vacuity.
  it('scans the slice 4a files, and finds the two boost read bodies in the repository', () => {
    expect(FILES).toEqual(expect.arrayContaining([BUILDER, PANEL, STRIP, COPY]));
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining([BUILDER, PANEL]));
    for (const name of BOOST_METHODS) {
      const body = bodyOf(codeOf(REPOSITORY), name);
      expect({ name, found: body.length > 100 }).toEqual({ name, found: true });
      expect(body).toMatch(/from\('business_os_boost_purchases'\)/);
      expect(body).toMatch(/rangeFilter\('paid_at', range\)/);
      expect(body).not.toMatch(/livemode/);
    }
  });

  // (b) SA-Q26 / SA-W54: money never through the decimal helpers or × 100; credits through toUnits once.
  const TIMES_100 = /\*\s*100\b|CURRENCY_SCALE\s*\*/;
  it('the scale rules bite (planted)', () => {
    expect(TIMES_100.test('const cents = row.amount_total_minor * 100;')).toBe(true);
    expect(TIMES_100.test('const cents = row.amount_total_minor*100;')).toBe(true);
    expect(TIMES_100.test('CURRENCY_SCALE * total')).toBe(true);
    expect(TIMES_100.test('hundredths / CURRENCY_SCALE')).toBe(false);
    expect(/\btoHundredths\b/.test('toHundredths(row.amount_total_minor)')).toBe(true);
    expect('toUnits(row.amount_total_minor, 100); toUnits(row.credits_total, CREDIT_SCALE)'.match(/\btoUnits\(/g)).toHaveLength(2);
  });

  it('boostRevenue.ts never names toHundredths, has no × 100, and calls toUnits exactly once: credits_total at CREDIT_SCALE', () => {
    const code = codeOf(BUILDER);
    expect(code.length).toBeGreaterThan(2000);
    expect(code).not.toMatch(/\btoHundredths\b/);
    expect(code).not.toMatch(TIMES_100);
    const calls = code.match(/\btoUnits\([^)]*\)/g) ?? [];
    expect(calls).toEqual(['toUnits(row.credits_total, CREDIT_SCALE)']);
    // The one division to the wire, valid only behind the minorUnitsPerMajor === 100 gate.
    expect(code).toMatch(/minorUnitsPerMajor\(code\) !== 100/);
    expect(code.match(/\/ CURRENCY_SCALE/g)).toHaveLength(1);
  });

  // (c) AC-88: the read decides the window; the builder reads no date.
  it('boostRevenue.ts reads neither paid_at nor created_at (planted control)', () => {
    expect(codeOf(BUILDER)).not.toMatch(/\bpaid_at\b|\bcreated_at\b/);
    expect(/\bpaid_at\b/.test(stripComments('const d = row.paid_at;'))).toBe(true);
  });

  // (d) SA-W53: the DF-5 rule lives in refundsAndDisputesOf only.
  const DF5_TOKENS = /amount_refunded_minor|'disputed'|'dispute_lost'/;
  /** The builder's code with the three places allowed to name the tokens cut out. */
  const outsideDf5 = (code: string) => {
    const fnStart = code.indexOf('function refundsAndDisputesOf(');
    const fnEnd = code.indexOf('\n}\n', fnStart);
    const ifaceStart = code.indexOf('export interface BoostPurchaseInput');
    const ifaceEnd = code.indexOf('\n}\n', ifaceStart);
    if (fnStart < 0 || fnEnd < 0 || ifaceStart < 0 || ifaceEnd < 0) return null;
    return code
      .slice(0, Math.min(fnStart, ifaceStart))
      .concat(code.slice(Math.min(fnEnd, ifaceEnd), Math.max(fnStart, ifaceStart)))
      .concat(code.slice(Math.max(fnEnd, ifaceEnd)))
      .replace(/export const BOOST_PAID_FAMILY = \[[^\]]*\] as const;/, '');
  };

  it('DF-5: the refunded amount and the dispute statuses appear only in refundsAndDisputesOf, the paid-family literal and the input type', () => {
    const code = codeOf(BUILDER);
    const rest = outsideDf5(code);
    expect(rest).not.toBeNull();
    expect((rest as string).length).toBeGreaterThan(1000);
    expect(rest).not.toMatch(DF5_TOKENS);
    // The function itself holds all three.
    const fn = code.slice(code.indexOf('function refundsAndDisputesOf('), code.indexOf('function readMoney('));
    for (const token of ['amount_refunded_minor', "'disputed'", "'dispute_lost'"]) expect(fn).toContain(token);
  });

  it('the DF-5 pin bites (planted): a refund read outside the function is caught', () => {
    const planted = `${codeOf(BUILDER)}\nconst leak = (r: BoostPurchaseInput) => r.amount_refunded_minor;\n`;
    expect(outsideDf5(planted)).toMatch(DF5_TOKENS);
    const plantedStatus = codeOf(BUILDER).replace('function readMoney(', "const x = (s: string) => s === 'disputed';\nfunction readMoney(");
    expect(outsideDf5(plantedStatus)).toMatch(DF5_TOKENS);
  });

  // SA-WR-35: the one DF-5 copy line. Slice 5a, SA-W58 (a) / SA-WR-38: the revenue panel and the
  // account summary (S5-F7). Slice 6a (SA workplan review, the SA-W58 (a) reasoning): the Accounts tab
  // joins, so EXACTLY THREE users; still one constant and one sentence.
  const SUMMARY = 'app/admin/finance/components/AccountSummary.tsx';
  const ACCOUNTS_TAB = 'app/admin/finance/components/AccountsTab.tsx';
  const refundNoteUsers = (files: readonly string[], code: (file: string) => string) =>
    files.filter((file) => file !== COPY && /\bREVENUE_REFUND_TIMING_NOTE\b/.test(code(file)));
  it('SA-WR-35 / SA-WR-38 / 6a: REVENUE_REFUND_TIMING_NOTE is defined in the copy and used by exactly RevenuePanel.tsx, AccountSummary.tsx and AccountsTab.tsx', () => {
    const users = refundNoteUsers(FILES, codeOf);
    expect([...users].sort()).toEqual([SUMMARY, PANEL, ACCOUNTS_TAB].sort());
    expect(codeOf(COPY)).toMatch(/export const REVENUE_REFUND_TIMING_NOTE =/);
    expect(read(COPY)).toContain('Refunds and disputes are counted in the month of the purchase, as recorded today, so a past month can still change.');
  });

  it('the SA-WR-35 pin bites (planted): a second user would join the list', () => {
    const planted = "import { REVENUE_REFUND_TIMING_NOTE } from '../financeCopy';";
    expect(/\bREVENUE_REFUND_TIMING_NOTE\b/.test(planted)).toBe(true);
    expect(/\bREVENUE_REFUND_TIMING_NOTE\b/.test('REVENUE_REFUND_TIMING_NOTES')).toBe(false);
  });

  it('6a (planted control): a FOURTH user of the sentence breaks the exact three-file list', () => {
    const FOURTH = 'app/admin/finance/components/TakingsSection.tsx';
    const planted = (file: string) =>
      file === FOURTH ? `${codeOf(file)}\nconst leak = REVENUE_REFUND_TIMING_NOTE;\n` : codeOf(file);
    const users = refundNoteUsers(FILES, planted);
    expect(users).toContain(FOURTH);
    expect(users).toHaveLength(4);
    expect([...users].sort()).not.toEqual([SUMMARY, PANEL, ACCOUNTS_TAB].sort());
  });

  // (e) SA-W22: pure and structural.
  it('boostRevenue.ts imports no repository and no Supabase client, names no table and reads no clock', () => {
    const raw = read(BUILDER);
    expect(raw).not.toMatch(/@\/lib\/repositories|supabase/i);
    expect(raw).not.toMatch(/BusinessOsFinanceReadRepository/);
    expect(codeOf(BUILDER)).not.toMatch(/business_os_boost_purchases|payment_/);
    expect(codeOf(BUILDER)).not.toMatch(/new Date\(|Date\.now\(/);
  });

  // (f) SA-WR-18 extended: no page file adds or subtracts any 4a money field.
  const MONEY_4A = '(?:gross|refunded|net|fees|amount|held|lost|tax|creditsSold)';
  const MONEY_4A_ARITHMETIC = new RegExp(`\\b${MONEY_4A}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY_4A}\\b)`);
  it('the 4a money-arithmetic rule bites (planted)', () => {
    expect(MONEY_4A_ARITHMETIC.test('const n = line.held + line.lost;')).toBe(true);
    expect(MONEY_4A_ARITHMETIC.test('line.gross - line.tax')).toBe(true);
    expect(MONEY_4A_ARITHMETIC.test('a.creditsSold + b.creditsSold')).toBe(true);
    expect(MONEY_4A_ARITHMETIC.test('count + line.unreadableCredits')).toBe(false);
    expect(MONEY_4A_ARITHMETIC.test('formatMoney(line.held, line.currency)')).toBe(false);
  });

  it.each(FILES.filter((file) => file.startsWith('app/admin/finance/')))('%s: adds or subtracts no two 4a money fields', (file) => {
    expect(codeOf(file)).not.toMatch(MONEY_4A_ARITHMETIC);
  });

  // (g) BD-12: boostRevenue.ts's exports are pinned exactly; none is a cross-currency total.
  // Slice 6a (SA-Q45, E-44, SA-W80): `readMoney` joins the list, so the account economics builder
  // reads boost money through the one reader. Exactly five names; `refundsAndDisputesOf` stays private.
  const BOOST_EXPORTS = ['BOOST_PAID_FAMILY', 'BoostPurchaseInput', 'BoostRevenueResult', 'buildBoostRevenue', 'readMoney'];
  const boostExportsOf = (code: string) =>
    [...code.matchAll(/export\s+(?:const|function|interface|type|class|let|var)\s+(\w+)/g)].map((m) => m[1]).sort();
  it('boostRevenue.ts exports exactly BOOST_PAID_FAMILY, BoostPurchaseInput, BoostRevenueResult, buildBoostRevenue and readMoney (SA-Q45)', () => {
    const code = codeOf(BUILDER);
    expect(boostExportsOf(code)).toEqual(BOOST_EXPORTS);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
    expect(code).not.toMatch(/exchange_rates|\bfx\b|\brate\b/i);
    expect(code).not.toMatch(/export\s+function\s+refundsAndDisputesOf\b/);
  });

  it('SA-WR-45 (planted control): a sixth boost export breaks the exact five-name pin', () => {
    const planted = `${codeOf(BUILDER)}\nexport function refundedOf(row: BoostPurchaseInput) { return row; }\n`;
    expect(boostExportsOf(planted)).toHaveLength(6);
    expect(boostExportsOf(planted)).not.toEqual(BOOST_EXPORTS);
  });

  // (h) S4-FR-9 / AC-98: no Stripe id, receipt, flag reason or lot id.
  const STRIPE_OR_LOT = /stripe_|receipt_url|flag_reason|lot_id/;
  it('the Stripe-or-lot rule bites (planted)', () => {
    expect(STRIPE_OR_LOT.test("'id, stripe_charge_id, amount'")).toBe(true);
    expect(STRIPE_OR_LOT.test('row.lot_id')).toBe(true);
    expect(STRIPE_OR_LOT.test("'Real Stripe fees'")).toBe(false);
  });

  it('no Stripe id, receipt URL, flag reason or lot id in the boost columns, the builder, the panel, the strip or the copy', () => {
    const columns = codeOf(REPOSITORY).match(/export const FINANCE_BOOST_PURCHASE_COLUMNS =\s*'([^']*)'/);
    expect(columns).not.toBeNull();
    expect((columns as RegExpMatchArray)[1]).not.toMatch(STRIPE_OR_LOT);
    for (const file of [BUILDER, PANEL, STRIP, COPY]) expect({ file, hit: STRIPE_OR_LOT.test(codeOf(file)) }).toEqual({ file, hit: false });
  });

  // SA-WR-34: K-5's money is printed only through formatMoney or a copy string, and only K-5 has it.
  const strayMoney = (code: string) =>
    code
      .replace(/formatMoney\(money\.net, money\.currency\)/g, '')
      .replace(/k5SeveralCurrencies\(money\.currencies\)/g, '')
      .match(/\bmoney\.(?:net|currencies|currency)\b/g) ?? [];

  it('SA-WR-34: the strip prints money.net only through formatMoney, the count only through the copy, and reads money from K-5 only', () => {
    const code = codeOf(STRIP);
    expect(code).toMatch(/formatMoney\(money\.net, money\.currency\)/);
    expect(strayMoney(code)).toEqual([]);
    expect(code).not.toMatch(/\bk[1-4]\.money\b/);
    expect(code.match(/\.money\b/g)).toEqual(['.money']);
    expect(code).toMatch(/k5Value\(k5\.money\)/);
  });

  it('the SA-WR-34 rules bite (planted): a bare net or a K-1 money read is caught', () => {
    expect(strayMoney('return String(money.net);')).toEqual(['money.net']);
    expect(strayMoney('return formatMoney(money.net, money.currency);')).toEqual([]);
    expect(/\bk[1-4]\.money\b/.test('k1.money')).toBe(true);
  });
});

// ── Slice 5a: our plan revenue (§11D.7, SA-W59, SA-W64, SA-W65, SA-Q40) ─────
describe('finance slice 5a source guards (plans received, the per-currency combiner)', () => {
  const PLANS = 'lib/business-os/finance/planRevenue.ts';
  const OURS = 'lib/business-os/finance/ourRevenue.ts';
  const PART = 'app/admin/finance/components/PlanRevenuePart.tsx';
  const COPY = 'app/admin/finance/financeCopy.ts';
  const NEW_PRODUCT_FILES = [
    PLANS,
    OURS,
    PART,
    'app/admin/finance/components/AccountHeader.tsx',
    'app/admin/finance/components/AccountSummary.tsx',
    'app/admin/finance/financeAccount.ts',
    'app/admin/finance/financeLinks.ts',
  ];
  const PLAN_METHODS = ['listPlanPaymentsAllAccountsPaidInRange', 'listPlanPaymentsForAccountPaidInRange'];
  /** From `async <name>(` to the next `async ` (the 4a slicer, repeated here). */
  const bodyOf = (code: string, name: string) => {
    const start = code.search(new RegExp(`async\\s+${name}\\s*[<(]`));
    if (start < 0) return '';
    const next = code.indexOf('async ', start + 6);
    return code.slice(start, next < 0 ? undefined : next);
  };

  // (a) Non-vacuity, and the two read bodies.
  it('scans the slice 5a files; finds the R-m / R-m′ bodies; the filter holds the paid invoice kind', () => {
    expect(FILES).toEqual(expect.arrayContaining(NEW_PRODUCT_FILES));
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining([PLANS, OURS, PART]));
    const code = codeOf(REPOSITORY);
    for (const name of PLAN_METHODS) {
      const body = bodyOf(code, name);
      expect({ name, found: body.length > 100 }).toEqual({ name, found: true });
      expect(body).toMatch(/from\('business_os_billing_events'\)/);
      expect(body).toMatch(/paidInvoiceFilter\(range\)/);
      expect(body).not.toMatch(/livemode/);
    }
    const filter = code.slice(code.indexOf('private paidInvoiceFilter('), code.indexOf('private rangeFilter('));
    expect(filter.length).toBeGreaterThan(50);
    expect(filter).toMatch(/\.eq\('kind', 'invoice_paid'\)/);
    expect(filter).toMatch(/this\.rangeFilter\('paid_at', range\)/);
  });

  // (b) Scale: integer cents only, one division to the wire, behind the two-decimals gate.
  const TIMES_100 = /\*\s*100\b|CURRENCY_SCALE\s*\*/;
  it('the 5a scale rules bite (planted)', () => {
    expect(TIMES_100.test('const cents = row.amount_minor * 100;')).toBe(true);
    expect(/\btoUnits\(/.test('toUnits(row.amount_minor, 100)')).toBe(true);
    expect(/\btoHundredths\b/.test('toHundredths(row.amount_minor)')).toBe(true);
    expect('a / CURRENCY_SCALE; b / CURRENCY_SCALE'.match(/\/ CURRENCY_SCALE/g)).toHaveLength(2);
  });

  it.each([PLANS, OURS])('%s: no toHundredths, no toUnits, no × 100; exactly one / CURRENCY_SCALE', (file) => {
    const code = codeOf(file);
    expect(code.length).toBeGreaterThan(1000);
    expect(code).not.toMatch(/\btoHundredths\b/);
    expect(code).not.toMatch(/\btoUnits\(/);
    expect(code).not.toMatch(TIMES_100);
    expect(code.match(/\/ CURRENCY_SCALE/g)).toHaveLength(1);
  });

  it('planRevenue.ts reads a row only behind the two-decimals gate (SA-W64)', () => {
    expect(codeOf(PLANS)).toMatch(/minorUnitsPerMajor\(code\) !== 100/);
  });

  // (c) Pure and structural (SA-WR-4, SA-W22, SA-W65).
  const IMPURE = /@\/lib\/repositories|supabase|business-os\/entitlements\/|['"]server-only['"]/i;
  it('the purity rule bites (planted)', () => {
    expect(IMPURE.test("import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';")).toBe(true);
    expect(IMPURE.test("import type { X } from '@/lib/repositories/BusinessOsFinanceReadRepository';")).toBe(true);
    expect(/new Date\(|Date\.now\(/.test('const t = Date.now();')).toBe(true);
  });

  it.each([PLANS, OURS])('%s: imports no repository, Supabase, entitlements path or server-only; names no table; reads no clock', (file) => {
    expect(read(file)).not.toMatch(IMPURE);
    expect(read(file)).not.toMatch(/BusinessOsFinanceReadRepository|BusinessOsBillingEvent/);
    expect(codeOf(file)).not.toMatch(/business_os_|payment_/);
    expect(codeOf(file)).not.toMatch(/new Date\(|Date\.now\(/);
  });

  // (d) No Stripe id, refusal reason, plan_written or mode.
  const PLAN_SECRET = /stripe_|refusal_reason|plan_written|livemode/;
  it('the plan-secret rule bites (planted)', () => {
    expect(PLAN_SECRET.test("'id, stripe_invoice_id, amount_minor'")).toBe(true);
    expect(PLAN_SECRET.test('row.refusal_reason')).toBe(true);
    expect(PLAN_SECRET.test("'Real Stripe fees'")).toBe(false);
  });

  it('no Stripe id, refusal reason, plan_written or mode in the plan columns, the builders, the plans part or the copy', () => {
    const columns = codeOf(REPOSITORY).match(/export const FINANCE_PLAN_PAYMENT_COLUMNS =\s*'([^']*)'/);
    expect(columns).not.toBeNull();
    expect((columns as RegExpMatchArray)[1]).not.toMatch(PLAN_SECRET);
    expect((columns as RegExpMatchArray)[1]).not.toMatch(/created_at/);
    for (const file of [PLANS, OURS, PART, COPY]) expect({ file, hit: PLAN_SECRET.test(codeOf(file)) }).toEqual({ file, hit: false });
  });

  // (e) Exports pinned exactly; none is a cross-currency total, no exchange rate.
  const exportsOf = (code: string) =>
    [...code.matchAll(/export\s+(?:const|function|interface|type|class|let|var)\s+(\w+)/g)].map((m) => m[1]).sort();
  it('the export pin bites (planted): an extra export would join the list', () => {
    expect(exportsOf('export function sumAcrossCurrencies() {}\nexport const A = 1;')).toEqual(['A', 'sumAcrossCurrencies']);
  });

  // Slice 6a (SA-Q45, E-44, SA-W80): `readPlanMoney` joins the list. Exactly five names.
  const PLAN_EXPORTS = ['PLAN_PAYMENT_KIND', 'PlanPaymentInput', 'PlanRevenueResult', 'buildPlanRevenue', 'readPlanMoney'];
  it('SA-WR-45 (planted control): a sixth plan export breaks the exact five-name pin', () => {
    const planted = `${codeOf(PLANS)}\nexport const PLAN_TOTAL_ACROSS_CURRENCIES = 0;\n`;
    expect(exportsOf(planted)).toHaveLength(6);
    expect(exportsOf(planted)).not.toEqual(PLAN_EXPORTS);
  });

  it('planRevenue.ts exports exactly PLAN_PAYMENT_KIND, PlanPaymentInput, PlanRevenueResult, buildPlanRevenue and readPlanMoney (SA-Q45)', () => {
    const code = codeOf(PLANS);
    expect(exportsOf(code)).toEqual(PLAN_EXPORTS);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
    expect(code).not.toMatch(/exchange_rates|\bfx\b|\brate\b/i);
  });

  it('ourRevenue.ts exports exactly PartByCurrency and combineOurRevenue', () => {
    const code = codeOf(OURS);
    expect(exportsOf(code)).toEqual(['PartByCurrency', 'combineOurRevenue']);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
    expect(code).not.toMatch(/exchange_rates|\bfx\b|\brate\b/i);
  });

  // (f) The paid invoice kind is written in exactly two places (a positive pin).
  const KIND_LITERAL = /['"`]invoice_paid['"`]/;
  it('the kind-literal pin bites (planted), and prose is not a literal', () => {
    expect(KIND_LITERAL.test("row.kind === 'invoice_paid'")).toBe(true);
    expect(KIND_LITERAL.test('// kind = invoice_paid')).toBe(false);
  });

  it("'invoice_paid' appears only in the repository and planRevenue.ts", () => {
    const holders = FILES.filter((file) => KIND_LITERAL.test(codeOf(file)));
    expect(holders.sort()).toEqual([REPOSITORY, PLANS].sort());
  });

  // (g) SA-WR-18 extended: no page file adds or subtracts any 5a money field.
  const MONEY_5A = '(?:gross|refunded|net|fees|amount|held|lost|tax|creditsSold|received|total|boostsNet|plansReceived|payments)';
  const MONEY_5A_ARITHMETIC = new RegExp(`\\b${MONEY_5A}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY_5A}\\b)`);
  it('the 5a money-arithmetic rule bites (planted)', () => {
    expect(MONEY_5A_ARITHMETIC.test('const t = line.boostsNet + line.plansReceived;')).toBe(true);
    expect(MONEY_5A_ARITHMETIC.test('line.received - line.tax')).toBe(true);
    expect(MONEY_5A_ARITHMETIC.test('a.payments + b.payments')).toBe(true);
    expect(MONEY_5A_ARITHMETIC.test('total - rows.length')).toBe(false);
    expect(MONEY_5A_ARITHMETIC.test('formatMoney(line.received, line.currency)')).toBe(false);
  });

  it.each(FILES.filter((file) => file.startsWith('app/admin/finance/')))('%s: adds or subtracts no two 5a money fields', (file) => {
    expect(codeOf(file)).not.toMatch(MONEY_5A_ARITHMETIC);
  });

  it('the account summary and header hold no .reduce( (AC-112)', () => {
    for (const file of ['app/admin/finance/components/AccountSummary.tsx', 'app/admin/finance/components/AccountHeader.tsx']) {
      expect({ file, reduce: /\.reduce\(/.test(codeOf(file)) }).toEqual({ file, reduce: false });
    }
  });

  // (h) S5-F1 / E-33: every list timestamp through formatUtc.
  it('the plans part imports formatUtc and never names formatUtcDate (planted control)', () => {
    const code = codeOf(PART);
    expect(code).toMatch(/import \{[^}]*\bformatUtc\b[^}]*\} from '@\/app\/admin\/components\/layout\/adminFormat'/);
    expect(code).not.toMatch(/\bformatUtcDate\b/);
    expect(/\bformatUtcDate\b/.test('formatUtcDate(row.paidAt)')).toBe(true);
    expect(/\bformatUtcDate\b/.test('formatUtc(row.paidAt)')).toBe(false);
  });

  // (i) SA-W69: the new page file is held to text-slate-400.
  const DIM_TEXT = /(^|[^a-zA-Z0-9-])text-slate-[56]00([^0-9]|$)/;
  it('the dim-text rule bites (planted), and the plans part has none', () => {
    expect(DIM_TEXT.test("const NOTE = 'text-[11px] text-slate-500';")).toBe(true);
    expect(DIM_TEXT.test("const NOTE = 'text-[11px] text-slate-400';")).toBe(false);
    expect(DIM_TEXT.test(codeOf(PART))).toBe(false);
  });

  // The 4a plans line is gone (SA-W61): its constants are deleted everywhere.
  it('the 4a plans-line constants and PLANS_TEXT are gone from every scanned file', () => {
    for (const file of FILES) {
      expect({ file, hit: /REVENUE_PLANS_(ALL_PREFIX|ALL_RECORDED|ALL_NONE|ALL_UNKNOWN|RECORDED|NONE|UNKNOWN)\b|K5_NET_HEADLINE|\bPLANS_TEXT\b/.test(read(file)) }).toEqual({ file, hit: false });
    }
  });
});

// ── Slice 6a: account economics and AI margin (§11E.6, E-44, SA-W75, SA-W80, SA-W83, SA-WR-42) ──
describe('finance slice 6a source guards (account economics, the AI margin)', () => {
  const ECON = 'lib/business-os/finance/accountEconomics.ts';
  const URL_MODULE = 'app/admin/finance/financeUrl.ts';
  const PAGE_FILES = [
    'app/admin/finance/components/AccountsTab.tsx',
    'app/admin/finance/components/AccountEconomicsTable.tsx',
    'app/admin/finance/components/FinanceTabs.tsx',
  ];
  const COPY = 'app/admin/finance/financeCopy.ts';

  // (a) Non-vacuity.
  it('scans the slice 6a files (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining([ECON, ...PAGE_FILES]));
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining([ECON]));
    expect(codeOf(ECON).length).toBeGreaterThan(3000);
  });

  // (b) SA-W75: one common integer scale, one multiply, one division each way.
  const TIMES_100 = /\*\s*100\b|CURRENCY_SCALE\s*\*/;
  const DECLARATION = /const MINOR_TO_COST_UNITS = COST_SCALE \/ CURRENCY_SCALE;/;
  const withoutDeclaration = (code: string) => code.replace(DECLARATION, '');
  it('the 6a scale rules bite (planted)', () => {
    expect(TIMES_100.test('const units = afterTax * 100;')).toBe(true);
    expect('a * MINOR_TO_COST_UNITS; b * MINOR_TO_COST_UNITS'.match(/\*\s*MINOR_TO_COST_UNITS\b/g)).toHaveLength(2);
    expect(withoutDeclaration('const MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE;\nx / CURRENCY_SCALE;').match(/\/ CURRENCY_SCALE/g)).toHaveLength(1);
    expect(/\btoUnits\(/.test('toUnits(row.amount_minor, 100)')).toBe(true);
  });

  it('accountEconomics.ts: no toHundredths, toUnits or × 100; exactly one × MINOR_TO_COST_UNITS, one / CURRENCY_SCALE, one / COST_SCALE; the constant declared once', () => {
    const code = codeOf(ECON);
    expect(code).not.toMatch(/\btoHundredths\b/);
    expect(code).not.toMatch(/\btoUnits\(/);
    expect(code).not.toMatch(TIMES_100);
    expect(code.match(/\*\s*MINOR_TO_COST_UNITS\b/g)).toHaveLength(1);
    expect(code.match(new RegExp(DECLARATION.source, 'g'))).toHaveLength(1);
    expect(withoutDeclaration(code).match(/\/ CURRENCY_SCALE/g)).toHaveLength(1);
    expect(withoutDeclaration(code).match(/\/ COST_SCALE/g)).toHaveLength(1);
    expect(code).toMatch(/Number\.isSafeInteger\(revenueUnits\)/);
    expect(code).toMatch(/Number\.isSafeInteger\(marginUnits\)/);
  });

  it('the scale pin bites (planted): a second multiply or a second division is caught', () => {
    const plantedMultiply = `${codeOf(ECON)}\nconst again = 1 * MINOR_TO_COST_UNITS;\n`;
    expect(plantedMultiply.match(/\*\s*MINOR_TO_COST_UNITS\b/g)).toHaveLength(2);
    const plantedDivision = `${codeOf(ECON)}\nconst usd = 5 / COST_SCALE;\n`;
    expect(withoutDeclaration(plantedDivision).match(/\/ COST_SCALE/g)).toHaveLength(2);
  });

  // (c) Pure and structural (SA-WR-4, SA-W22): no ledger row type, no table, no clock.
  const IMPURE = /@\/lib\/repositories|supabase|business-os\/entitlements\/|['"]server-only['"]/i;
  const LEDGER_OR_TABLE = /CreditLedgerRow|BusinessOsCreditLedger|business_os_|payment_/;
  it('the 6a purity rules bite (planted)', () => {
    expect(IMPURE.test("import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';")).toBe(true);
    expect(LEDGER_OR_TABLE.test('(rows: readonly CreditLedgerRow[])')).toBe(true);
    expect(LEDGER_OR_TABLE.test('PLAN_PAYMENT_KIND')).toBe(false);
  });

  it('accountEconomics.ts imports no repository, Supabase, entitlements path or server-only; names no ledger row type or table; reads no clock', () => {
    expect(read(ECON)).not.toMatch(IMPURE);
    expect(codeOf(ECON)).not.toMatch(LEDGER_OR_TABLE);
    expect(codeOf(ECON)).not.toMatch(/new Date\(|Date\.now\(/);
  });

  // (d) Readers, not rows (SA-Q45, E-45): money only through the two exported readers.
  const RAW_MONEY_COLUMN = /\bamount_total_minor\b|\bamount_tax_minor\b|\bamount_minor\b/;
  it('the readers rule bites (planted)', () => {
    expect(RAW_MONEY_COLUMN.test('const t = row.amount_total_minor;')).toBe(true);
    expect(RAW_MONEY_COLUMN.test('const a = row.amount_minor;')).toBe(true);
    expect(RAW_MONEY_COLUMN.test('readPlanMoney(row)')).toBe(false);
  });

  it('accountEconomics.ts reads money only through readMoney / readPlanMoney and counts only by the exported family and kind', () => {
    const code = codeOf(ECON);
    expect(code).toMatch(/\breadMoney\(/);
    expect(code).toMatch(/\breadPlanMoney\(/);
    expect(code).not.toMatch(RAW_MONEY_COLUMN);
    expect(code).toMatch(/\bBOOST_PAID_FAMILY\b/);
    expect(code).toMatch(/\bPLAN_PAYMENT_KIND\b/);
    expect(code).toMatch(/import \{[^}]*\breadMoney\b[^}]*\} from '\.\/boostRevenue';/);
    expect(code).toMatch(/import \{[^}]*\breadPlanMoney\b[^}]*\} from '\.\/planRevenue';/);
  });

  // DF-5 extended (E-44): ZERO refund or dispute tokens in the new builder.
  const DF5_TOKENS = /amount_refunded_minor|'disputed'|'dispute_lost'/;
  it('DF-5 (E-44): accountEconomics.ts names no refunded amount and no dispute status', () => {
    expect(codeOf(ECON)).not.toMatch(DF5_TOKENS);
  });

  it('the DF-5 extension bites (planted): the builder plus a refund read is caught', () => {
    expect(`${codeOf(ECON)}\nconst leak = (r: BoostPurchaseInput) => r.amount_refunded_minor;\n`).toMatch(DF5_TOKENS);
    expect(`${codeOf(ECON)}\nconst held = (s: string) => s === 'disputed';\n`).toMatch(DF5_TOKENS);
  });

  // (e) Exports pinned exactly; none takes or returns a total across currencies.
  const ECON_EXPORTS = ['AccountEconomicsInput', 'buildAccountEconomics', 'buildAccountMargin'];
  const econExportsOf = (code: string) =>
    [...code.matchAll(/export\s+(?:const|function|interface|type|class|let|var)\s+(\w+)/g)].map((m) => m[1]).sort();
  it('accountEconomics.ts exports exactly AccountEconomicsInput, buildAccountEconomics and buildAccountMargin; no exchange rate', () => {
    const code = codeOf(ECON);
    expect(econExportsOf(code)).toEqual(ECON_EXPORTS);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
    expect(code).not.toMatch(/exchange_rates|\bfx\b|\brate\b/i);
  });

  it('the 6a export pin bites (planted): a fourth export breaks it', () => {
    const planted = `${codeOf(ECON)}\nexport function sumAcrossCurrencies() { return 0; }\n`;
    expect(econExportsOf(planted)).toHaveLength(4);
    expect(econExportsOf(planted)).not.toEqual(ECON_EXPORTS);
  });

  // (f) BD-12 / BD-22: 'USD' is written once, as MARGIN_CURRENCY.
  const USD_LITERAL = /['"`]USD['"`]/g;
  it("'USD' appears exactly once in accountEconomics.ts, as MARGIN_CURRENCY (planted control)", () => {
    const code = codeOf(ECON);
    expect(code.match(USD_LITERAL)).toHaveLength(1);
    expect(code).toMatch(/const MARGIN_CURRENCY = 'USD';/);
    expect(`${code}\nconst other = line.currency === 'USD';\n`.match(USD_LITERAL)).toHaveLength(2);
  });

  // (g) No mode or Stripe id in the builder, the three page files, or the 6a copy.
  const MODE_OR_STRIPE = /livemode|test.?mode|live.?mode|stripe_/i;
  it('the 6a mode rule bites (planted)', () => {
    expect(MODE_OR_STRIPE.test("const NOTE = 'Test mode rows';")).toBe(true);
    expect(MODE_OR_STRIPE.test('Stripe fees are not deducted.')).toBe(false);
  });

  it('no livemode, mode wording or Stripe id in the builder, the tab files or the 6a copy', () => {
    for (const file of [ECON, ...PAGE_FILES]) expect({ file, hit: MODE_OR_STRIPE.test(codeOf(file)) }).toEqual({ file, hit: false });
    const copy = read(COPY);
    const block = copy.slice(copy.indexOf('The Accounts tab: account economics'));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(MODE_OR_STRIPE);
  });

  // SA-W83 / SA-WR-42: financeUrl.ts stays pure, because the route imports the group shape from it.
  const importSourcesOf = (code: string) =>
    [...code.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => ({ typeOnly: Boolean(m[1]), source: m[2] }));
  const urlModuleProblems = (raw: string): string[] => {
    const problems: string[] = [];
    if (/^\s*['"]use client['"]/m.test(raw)) problems.push('use client');
    if (/['"]server-only['"]/.test(raw)) problems.push('server-only');
    for (const { typeOnly, source } of importSourcesOf(raw)) {
      if (source === 'react' || source.startsWith('next/') || source === 'next') problems.push(`imports ${source}`);
      else if (!typeOnly && source !== '@/app/admin/components/adminWindowPresets') problems.push(`runtime import ${source}`);
    }
    return problems;
  };

  it('SA-WR-42: financeUrl.ts has no use client, no React or Next import, no server-only, and only adminWindowPresets at run time', () => {
    const raw = read(URL_MODULE);
    expect(importSourcesOf(raw).length).toBeGreaterThan(0);
    expect(urlModuleProblems(raw)).toEqual([]);
    expect(raw).toMatch(/export const FINANCE_GROUP_SHAPE = /);
  });

  it('SA-WR-42 (planted controls): use client, a React import, a Next import or another runtime import is caught', () => {
    const raw = read(URL_MODULE);
    expect(urlModuleProblems(`'use client';\n${raw}`)).toContain('use client');
    expect(urlModuleProblems(`import { useMemo } from 'react';\n${raw}`)).toContain('imports react');
    expect(urlModuleProblems(`import { useRouter } from 'next/navigation';\n${raw}`)).toContain('imports next/navigation');
    expect(urlModuleProblems(`import { buildFinanceHealth } from '@/lib/business-os/finance/financeHealth';\n${raw}`)).toContain(
      'runtime import @/lib/business-os/finance/financeHealth'
    );
    expect(urlModuleProblems(`import 'server-only';\n${raw}`)).toContain('server-only');
  });

  it('SA-W83: the group shape is defined once (financeUrl.ts) and the route imports it', () => {
    const definers = FILES.filter((file) => /founding_partner\|comped\|unknown_held\|tier_set\|tier:/.test(codeOf(file)));
    expect(definers).toEqual([URL_MODULE]);
    expect(codeOf('app/api/admin/business-os/finance/route.ts')).toMatch(/\bFINANCE_GROUP_SHAPE\b/);
  });
});

// ── Money M-4 (OV-5, §11F.8, SA-RR-M4, SA-W103, SA-WR-48): the recorded AI cost ──
// Every rule has a planted negative control.
describe('Money M-4 source guards (the recorded AI cost, T6-B)', () => {
  const ROUTE = 'app/api/admin/business-os/finance/route.ts';
  const BUILDER = 'lib/business-os/finance/recordedCost.ts';
  const ORCHESTRATOR = 'lib/business-os/finance/financeHealth.ts';
  const TYPES = 'lib/business-os/finance/financeTypes.ts';
  const WIRING = 'lib/business-os/finance/financeHealthDeps.ts';
  const LINES = 'app/admin/finance/components/RecordedCostLines.tsx';
  const SECTION3 = 'app/admin/finance/components/AiCostSection.tsx';
  const SUMMARY = 'app/admin/finance/components/AccountSummary.tsx';
  const READER = /tokenusage/i;

  // (a) Non-vacuity.
  it('scans the M-4 files (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining([BUILDER, LINES]));
    expect(LAYER_B_FREE).toEqual(expect.arrayContaining([BUILDER]));
    expect(codeOf(BUILDER).length).toBeGreaterThan(1500);
  });

  // (b) The route is the ONE finance file that names a usage-log reader, by code, and it calls exactly two methods.
  const namersOf = (code: (file: string) => string) => FILES.filter((file) => READER.test(code(file)));
  const READER_CALL = /\b(?:adminTokenUsageAnalyticsRepository|tokenUsageRepository)\s*\.\s*(\w+)\s*\(/g;
  const methodsOf = (code: string) => [...new Set([...code.matchAll(READER_CALL)].map((m) => m[1]))].sort();

  it('only the route names a usage-log reader in code (a positive pin; comments are not code, SA-W103)', () => {
    expect(namersOf(codeOf)).toEqual([ROUTE]);
    // The finance read repository names one in a comment only: read raw it matches, as code it does not.
    expect(read(REPOSITORY)).toMatch(/TokenUsageRepository/);
    expect(codeOf(REPOSITORY)).not.toMatch(READER);
  });

  it('the namers pin bites (planted): a builder naming the analytics reader joins the list', () => {
    const planted = (file: string) =>
      file === ORCHESTRATOR
        ? `${codeOf(file)}\nimport type { AdminCostPointRow } from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';\n`
        : codeOf(file);
    expect(namersOf(planted).sort()).toEqual([ORCHESTRATOR, ROUTE].sort());
    // …while the same name in a comment does not (W103).
    const inComment = (file: string) =>
      file === ORCHESTRATOR ? stripComments(`${read(file)}\n// see AdminTokenUsageAnalyticsRepository\n`) : codeOf(file);
    expect(namersOf(inComment)).toEqual([ROUTE]);
  });

  it('the route calls exactly listCostPointsAllAccountsInWindow and listCallsInWindow on the two readers', () => {
    expect(methodsOf(codeOf(ROUTE))).toEqual(['listCallsInWindow', 'listCostPointsAllAccountsInWindow']);
  });

  it('the method pin bites (planted): a third method on either reader is caught', () => {
    const planted = `${codeOf(ROUTE)}\nvoid tokenUsageRepository.countInWindow([id], w, m);\n`;
    expect(methodsOf(planted)).toEqual(['countInWindow', 'listCallsInWindow', 'listCostPointsAllAccountsInWindow']);
  });

  // SA-WR-48: both bindings pass the Business OS row filter; without it the all-accounts read counts agent-platform calls.
  const bindingsOf = (code: string) => {
    const all = code.indexOf('readRecordedAllAccounts:');
    const one = code.indexOf('readRecordedForAccount:');
    const end = code.indexOf('});', one);
    return { all: code.slice(all, one), one: code.slice(one, end) };
  };
  const filterCount = (text: string) => (text.match(/\bbosRowFilter\(\)/g) ?? []).length;

  it('SA-WR-48: each recorded binding in the route passes bosRowFilter() exactly once', () => {
    const { all, one } = bindingsOf(codeOf(ROUTE));
    expect(all).toMatch(/listCostPointsAllAccountsInWindow\(/);
    expect(one).toMatch(/listCallsInWindow\(/);
    expect(filterCount(all)).toBe(1);
    expect(all).toMatch(/\{\s*featureFilter:\s*bosRowFilter\(\)\s*\}/);
    expect(filterCount(one)).toBe(1);
  });

  it('SA-WR-48 (planted): a binding with its filter removed is caught', () => {
    const plantedAll = bindingsOf(codeOf(ROUTE).replace('{ featureFilter: bosRowFilter() }', '{}'));
    expect(filterCount(plantedAll.all)).toBe(0);
    const route = codeOf(ROUTE);
    const oneStart = route.indexOf('readRecordedForAccount:');
    const plantedOne = bindingsOf(route.slice(0, oneStart) + route.slice(oneStart).replace('bosRowFilter(),', '{ featurePrefix: "", features: [] },'));
    expect(filterCount(plantedOne.one)).toBe(0);
  });

  it('SA-Q52: both bindings pass the window end less 1 ms through the one helper', () => {
    const route = codeOf(ROUTE);
    expect(route).toMatch(/const inclusiveEnd = \(to: Date\) => new Date\(to\.getTime\(\) - 1\);/);
    const { all, one } = bindingsOf(route);
    expect(all).toMatch(/end: inclusiveEnd\(span\.to\)\.toISOString\(\)/);
    expect(one).toMatch(/end: inclusiveEnd\(span\.to\)/);
    expect(one).not.toMatch(/signal/);
  });

  // (c) Pure and structural.
  const IMPURE = /@\/lib\/repositories|supabase|business-os\/entitlements\/|['"]server-only['"]/i;
  const LEDGER_OR_LOG = /CreditLedgerRow|BusinessOsCreditLedger|business_os_|token_usage|tokenusage/i;
  it('recordedCost.ts imports no repository, Supabase, entitlements path or server-only; names no ledger row, table or usage-log reader; reads no clock', () => {
    expect(read(BUILDER)).not.toMatch(IMPURE);
    expect(codeOf(BUILDER)).not.toMatch(LEDGER_OR_LOG);
    expect(codeOf(BUILDER)).not.toMatch(/new Date\(|Date\.now\(/);
    const imports = [...codeOf(BUILDER).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./financeTypes', '@/lib/business-os/credits/creditReport']);
  });

  it('the M-4 purity rules bite (planted)', () => {
    expect(IMPURE.test("import { adminTokenUsageAnalyticsRepository } from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';")).toBe(true);
    expect(LEDGER_OR_LOG.test('(rows: readonly CreditLedgerRow[])')).toBe(true);
    expect(LEDGER_OR_LOG.test("from('token_usage')")).toBe(true);
    expect(LEDGER_OR_LOG.test('RecordedRowInput')).toBe(false);
    expect(/new Date\(|Date\.now\(/.test(`${codeOf(BUILDER)}\nconst t = Date.now();\n`)).toBe(true);
  });

  // (d) Scale: one division, integers, a safe-integer check.
  it('recordedCost.ts: exactly one / COST_SCALE, no toHundredths, no × 100, and a safe-integer check', () => {
    const code = codeOf(BUILDER);
    expect(code.match(/\/ COST_SCALE/g)).toHaveLength(1);
    expect(code).not.toMatch(/\btoHundredths\b/);
    expect(code).not.toMatch(/\*\s*100\b/);
    expect(code).toMatch(/Number\.isSafeInteger\(recordedUnits\)/);
    expect(code).toMatch(/Number\.isSafeInteger\(differenceUnits\)/);
  });

  it('the scale pin bites (planted): a second division is caught', () => {
    expect(`${codeOf(BUILDER)}\nconst again = n / COST_SCALE;\n`.match(/\/ COST_SCALE/g)).toHaveLength(2);
  });

  // (e) Exports exactly.
  const EXPORTS = ['RecordedCostInput', 'RecordedReadInput', 'RecordedRowInput', 'buildRecordedAiCost'];
  const exportsOf = (code: string) =>
    [...code.matchAll(/export\s+(?:const|function|interface|type|class|let|var)\s+(\w+)/g)].map((m) => m[1]).sort();
  it('recordedCost.ts exports exactly RecordedRowInput, RecordedReadInput, RecordedCostInput and buildRecordedAiCost', () => {
    const code = codeOf(BUILDER);
    expect(exportsOf(code)).toEqual(EXPORTS);
    expect(code).not.toMatch(/export\s*\{|export\s+default/);
  });

  it('the export pin bites (planted): a fifth export, a sum of the two measures, breaks it', () => {
    const planted = `${codeOf(BUILDER)}\nexport function recordedPlusCharged(a: number, b: number) { return a + b; }\n`;
    expect(exportsOf(planted)).toHaveLength(5);
    expect(exportsOf(planted)).not.toEqual(EXPORTS);
  });

  // (f) Never added (R4-11, BD-18).
  const ADDED = /recorded\w*\s*\+\s*\w*charged|charged\w*\s*\+\s*\w*recorded/i;
  it('no M-4 file adds a recorded figure to a charged one', () => {
    for (const file of [BUILDER, ORCHESTRATOR, ROUTE, LINES, SECTION3, SUMMARY]) {
      expect({ file, added: ADDED.test(codeOf(file)) }).toEqual({ file, added: false });
    }
  });

  it('the never-added rule bites (planted)', () => {
    expect(ADDED.test('const total = recordedUnits + chargedUnits;')).toBe(true);
    expect(ADDED.test('const t = chargedUnits + recordedUsd;')).toBe(true);
    expect(ADDED.test('const diff = recordedUnits - chargedUnits;')).toBe(false);
    expect(ADDED.test('recordedUnits += units;')).toBe(false);
  });

  const recordedKeysOf = (code: string) => {
    const start = code.indexOf('export interface FinanceRecordedAiCost {');
    const end = code.indexOf('\n}', start);
    return [...code.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
  };
  it('SA-Q54: FinanceRecordedAiCost has exactly its five keys, none a sum', () => {
    expect(recordedKeysOf(codeOf(TYPES))).toEqual(['aboveCharged', 'chargedAboveUsd', 'recordedExact', 'recordedUsd', 'status']);
    expect(codeOf(TYPES)).toMatch(/recorded\?: FinanceRecordedAiCost;/);
  });

  it('the five-key pin bites (planted): a total key is caught', () => {
    const planted = codeOf(TYPES).replace('export interface FinanceRecordedAiCost {', 'export interface FinanceRecordedAiCost {\n  totalUsd: number;');
    expect(recordedKeysOf(planted)).toHaveLength(6);
  });

  // (g) E-53: exactness decided in one place.
  const FLAG = /\bcompleted\b|\breachedCeiling\b/;
  const regionsOf = (raw: string) => {
    const region = (startMark: string, endMark: string) => {
      const start = raw.indexOf(startMark);
      const end = raw.indexOf(endMark, start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      return stripComments(raw.slice(start, end));
    };
    return [
      region('// ── M-4 recorded read (wiring): start ──', '// ── M-4 recorded read (wiring): end ──'),
      region('// ── 4b. M-4 recorded section: start ──', '// ── 4b. M-4 recorded section: end ──'),
    ];
  };

  it('E-53: recordedCost.ts reads each flag once, under its kind; financeHealth.ts’s recorded wiring names neither', () => {
    const code = codeOf(BUILDER);
    expect(code.match(/\.completed\b/g)).toHaveLength(1);
    expect(code.match(/\.reachedCeiling\b/g)).toHaveLength(1);
    expect(code).toMatch(/read\.kind === 'all_accounts' \? read\.completed : null/);
    expect(code).toMatch(/read\.kind === 'account' \? read\.reachedCeiling : null/);
    for (const region of regionsOf(read(ORCHESTRATOR))) {
      expect(region.length).toBeGreaterThan(200);
      expect(region).not.toMatch(FLAG);
    }
  });

  it('E-53 (planted): the wiring deciding exactness itself is caught', () => {
    const raw = read(ORCHESTRATOR).replace(
      "{ data: { kind: 'all_accounts', ...result.data }, error: null }",
      "{ data: { kind: 'all_accounts', rows: result.data.rows, completed: result.data.rows.length < 10 }, error: null }"
    );
    expect(regionsOf(raw).some((region) => FLAG.test(region))).toBe(true);
  });

  // W104: the wiring's Omit grows by exactly the two route-injected reads; its entitlements import is unchanged.
  it('SA-W104: financeHealthDeps() omits exactly the four route-injected reads', () => {
    const match = codeOf(WIRING).match(/financeHealthDeps\(\): Omit<\s*FinanceHealthDeps,\s*([^>]*)>/);
    expect(match).not.toBeNull();
    const keys = [...(match as RegExpMatchArray)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(['findNames', 'readRecordedAllAccounts', 'readRecordedForAccount', 'readReminderFigures']);
    expect(codeOf(WIRING)).not.toMatch(READER);
  });
});

// ── Slice 6b (§11K.7, AC-244, AC-255, SA-W-6b-1 to SA-W-6b-3): the Stripe fee estimate ──
// Every rule has a planted control. No 6a rule above is edited: the 6a scale,
// 'USD', rate, export, DF-5 and mode pins keep biting on the 6b builder.
describe('slice 6b source guards (the Stripe fee estimate)', () => {
  const ECON = 'lib/business-os/finance/accountEconomics.ts';
  const RULES = 'lib/business-os/finance/financeRules.ts';

  it('scans the 6b files (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining([ECON, RULES]));
    expect(codeOf(ECON)).toMatch(/\bestimateChargeFeeMinor\(/);
    expect(codeOf(RULES)).toMatch(/export const STRIPE_FEE_ESTIMATE\b/);
  });

  // AC-244: no fee number in the builder; the price is data in financeRules.ts.
  const FEE_LITERAL = /\b290\b|\b30\b|\b0?\.029\b|\b0?\.3\b|\b10_?000\b|\b5_?000\b/;
  it('the fee-literal rule bites (planted)', () => {
    expect(FEE_LITERAL.test('const fee = gross * 290;')).toBe(true);
    expect(FEE_LITERAL.test('return fee + 30;')).toBe(true);
    expect(FEE_LITERAL.test('const pct = 0.029;')).toBe(true);
    expect(FEE_LITERAL.test('const scaled = (x + 5000) / 10000;')).toBe(true);
    expect(FEE_LITERAL.test('estimateChargeFeeMinor(gross, entry)')).toBe(false);
  });

  it('accountEconomics.ts holds no fee literal and no formula of its own: it imports the formula and the validator from ./financeRules', () => {
    const code = codeOf(ECON);
    expect(code).not.toMatch(FEE_LITERAL);
    expect(code).toMatch(/import \{[^}]*\bestimateChargeFeeMinor\b[^}]*\bstripeFeeEntryOf\b[^}]*\} from '\.\/financeRules';/);
    expect(code).not.toMatch(/\bSTRIPE_FEE_ESTIMATE\b/);
    expect(code).not.toMatch(/\bpercentBps\s*[*/]|\bfixedMinor\s*[+-]/);
  });

  it('the formula and the price are defined only in financeRules.ts', () => {
    const definers = FILES.filter((file) => /export (?:const STRIPE_FEE_ESTIMATE\b|function estimateChargeFeeMinor\b)/.test(codeOf(file)));
    expect(definers).toEqual([RULES]);
    const planted = `${codeOf(ECON)}\nexport const STRIPE_FEE_ESTIMATE = {};\n`;
    expect(/export const STRIPE_FEE_ESTIMATE\b/.test(planted)).toBe(true);
  });

  it('FE-17: no Stripe id, mode or tier literal is added to the 6b builder or the price file', () => {
    for (const file of [ECON, RULES]) expect({ file, hit: /stripe_|livemode/.test(codeOf(file)) }).toEqual({ file, hit: false });
  });
});

// ── DF-6 (§11L.8, AC-270, SA-W-DF6-6, DF6-R1) ─────────────────────────────────
describe('slice DF-6 source guards (since it started)', () => {
  const WINDOW_FILE = 'lib/business-os/finance/financeWindow.ts';
  // DF6-R1: non-test sources only (walk skips __tests__/), because this guard itself names the tokens.
  const DF6_SCOPE = [...walk('lib/business-os/finance'), ...walk('app/admin/finance')];
  const NO_ACCOUNT_CLOCK = /user_preferences|timezone/i;
  const READS_CLOCK = /Date\.now\(|new Date\(\s*\)/;
  const PLAN_FACT = /\b(onboarding_started_at|profile_created_at|created_at)\b/;
  const IMPORTS = /from\s+['"]([^'"]+)['"]/g;

  it('the rules bite (planted controls)', () => {
    expect(NO_ACCOUNT_CLOCK.test("select('timezone')")).toBe(true);
    expect(NO_ACCOUNT_CLOCK.test("from('user_preferences')")).toBe(true);
    expect(READS_CLOCK.test('const t = new Date();')).toBe(true);
    expect(READS_CLOCK.test('const t = Date.now();')).toBe(true);
    expect(READS_CLOCK.test('new Date(CHARGING_CUTOVER_FLOOR_MS)')).toBe(false);
    expect(PLAN_FACT.test('plan.onboarding_started_at')).toBe(true);
    expect(PLAN_FACT.test('row.created_at')).toBe(true);
  });

  it('scans the window file and both folders, and no test file (non-vacuity, DF6-R1)', () => {
    expect(DF6_SCOPE).toEqual(expect.arrayContaining([WINDOW_FILE, 'app/admin/finance/financeLinks.ts', 'app/admin/finance/components/FinanceView.tsx']));
    expect(DF6_SCOPE.some((file) => file.includes('__tests__'))).toBe(false);
  });

  it('AC-270: no finance source names user_preferences or timezone (comments included)', () => {
    for (const file of DF6_SCOPE) expect({ file, hit: NO_ACCOUNT_CLOCK.test(read(file)) }).toEqual({ file, hit: false });
  });

  it('financeWindow.ts reads no clock, no plan-row fact, and imports no repository, Supabase, entitlements or server-only module', () => {
    const code = codeOf(WINDOW_FILE);
    expect(code).not.toMatch(READS_CLOCK);
    expect(code).not.toMatch(PLAN_FACT);
    const imports = [...code.matchAll(IMPORTS)].map((m) => m[1]);
    expect(imports).toEqual([
      '@/app/admin/components/adminWindowPresets',
      '@/lib/business-os/credits/aiActivity',
      '@/lib/business-os/credits/creditReport',
      './financeTypes',
    ]);
    for (const spec of imports) expect(spec).not.toMatch(/repositories|supabase|entitlements|server-only/);
  });

  it('the since_start branch starts at the cut-over constant and ends at the passed-in now', () => {
    const code = codeOf(WINDOW_FILE);
    expect(code).toMatch(/if \(query\.preset === 'since_start'\)/);
    expect(code).toMatch(/start: new Date\(CHARGING_CUTOVER_FLOOR_MS\)/);
    expect(code).toMatch(/end: new Date\(now\.getTime\(\)\)/);
  });
});
