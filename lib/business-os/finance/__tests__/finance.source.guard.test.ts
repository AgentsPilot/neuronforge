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

  it.each(FILES)('%s: no aggregate select and no token_usage', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/select\(\s*['"`][^'"`]*\b(sum|avg|min|max)\s*\(/i);
    expect(code).not.toMatch(/token_usage|TokenUsageRepository|monthly_token_usage|business_os_usage_summary/);
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

  /** Slice 2b (S2-F1): the five of 1a / 2a plus the client invoices, plan instalments and client plans. */
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
