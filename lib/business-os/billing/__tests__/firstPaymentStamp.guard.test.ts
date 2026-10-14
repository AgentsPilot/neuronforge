/**
 * P5-C4 source guards for the first payment stamp (plan payments P-5a.1;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md §8 "Source guards"; SR-6,
 * AC-F2.4, S5-3).
 *
 * The stamp (`first_paid_at`, `first_payment_ref` on
 * `business_os_account_lineage`) is what lifts a held friend's payment hold.
 * It is written in ONE place: inside `business_os_apply_plan_payment`
 * (migration 20261028), in the same transaction as a paid plan invoice above
 * $0. These guards keep every TypeScript writer out:
 *
 *   1. the two columns are named only by the known readers;
 *   2. those readers, and the lineage repository, have no write call at all;
 *   3. every file that names the lineage table is a known, reviewed file, and
 *      none of them writes through a query builder;
 *   4. the apply function is reached only through the billing-event
 *      repository, called only by the webhook apply use case;
 *   5. BOOST never touches the stamp (SR-6, AC-F2.4): no boost file names the
 *      columns, the lineage table, the apply function or its repository. The
 *      one boost file that names the lineage repository reads the payment HOLD
 *      through it (`boostCheckoutDeps.ts`, a held account may not buy a boost);
 *      the repository has no write method, which guard 2 pins.
 *
 * Product code only: tests, fixtures and SQL are out of scope (the SQL is
 * pinned by the 20261028 migration test).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.claude', 'coverage', '__tests__', '__fixtures__'].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/');

/** Every product source file: lib, app, components, hooks, and the TypeScript scripts. */
const SOURCES = ['lib', 'app', 'components', 'hooks', 'scripts']
  .flatMap((dir) => walk(path.join(ROOT, dir)))
  .map((file) => ({ file: rel(file), text: fs.readFileSync(file, 'utf8') }));

const naming = (pattern: RegExp) => SOURCES.filter((source) => pattern.test(source.text)).map((source) => source.file).sort();

/**
 * A query-builder write: `.update({`, `.upsert([`, `.insert({`, `.delete()`.
 * The argument shape keeps `createHash(...).update(text)` out.
 */
const WRITE_CALL = /\.(update|upsert|insert)\s*\(\s*[{[]|\.delete\s*\(\s*\)/;

describe('P5-C4: no TypeScript writer of the first payment stamp', () => {
  it('scans a real tree (the guard cannot pass on an empty walk)', () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES.some((source) => source.file === 'lib/business-os/invites/paymentHold.ts')).toBe(true);
  });

  it('first_paid_at / first_payment_ref are named only by the known readers', () => {
    expect(naming(/first_paid_at|first_payment_ref|firstPaidAt|firstPaymentRef/)).toEqual([
      // The hold predicate: reads first_paid_at.
      'lib/business-os/invites/paymentHold.ts',
      // The one account-scoped read (select only) and its header.
      'lib/repositories/BusinessOsAccountLineageRepository.ts',
      // The row type of that read.
      'lib/repositories/types.ts',
    ]);
  });

  it('those readers and the lineage repository make no write call and no RPC', () => {
    for (const file of ['lib/business-os/invites/paymentHold.ts', 'lib/repositories/BusinessOsAccountLineageRepository.ts']) {
      const text = SOURCES.find((source) => source.file === file)?.text ?? '';
      expect({ file, write: WRITE_CALL.test(text), rpc: /\.rpc\s*\(/.test(text) }).toEqual({ file, write: false, rpc: false });
    }
    // types.ts holds no code that could write; the stamp columns appear there only as a row type.
    const types = SOURCES.find((source) => source.file === 'lib/repositories/types.ts')?.text ?? '';
    expect(types).not.toMatch(/\.(update|upsert|insert)\s*\(\s*\{[^}]*first_paid/);
  });

  it('every file naming the lineage table is a known one, and none of them writes through a query builder', () => {
    const files = naming(/business_os_account_lineage/);
    expect(files).toEqual([
      // Audit registries: the entity type of BOS_BILLING_FIRST_PAYMENT_STAMPED (P-5a.1).
      'lib/audit/events.ts',
      'lib/audit/ownerVisibility.ts',
      'lib/audit/types.ts',
      // The webhook apply: names the table as the stamp entry's ENTITY TYPE only.
      'lib/business-os/billing/planPaymentApply.ts',
      // Purge registry: the table is never purged.
      'lib/business-os/purge/descriptors.ts',
      'lib/repositories/BusinessOsAccountLineageRepository.ts',
      // The operator test-account cleanup SQL generator (it emits SQL text; the
      // database function it builds is pinned by its own migration tests).
      'scripts/generate-test-account-cleanup-sql.ts',
    ]);
    for (const file of files) {
      const text = SOURCES.find((source) => source.file === file)?.text ?? '';
      expect({ file, write: WRITE_CALL.test(text) }).toEqual({ file, write: false });
    }
  });

  it('planPaymentApply names the lineage table only as an audit entity type, never in a query', () => {
    const text = SOURCES.find((source) => source.file === 'lib/business-os/billing/planPaymentApply.ts')?.text ?? '';
    const uses = [...text.matchAll(/business_os_account_lineage/g)].map((match) => text.slice(match.index! - 20, match.index! + 40));
    expect(uses).toEqual([expect.stringContaining("entityType: 'business_os_account_lineage' as const")]);
    expect(text).not.toMatch(/\.from\s*\(|\.rpc\s*\(/);
  });

  it('the apply function is named only by the billing-event repository, and its method called only by the webhook apply', () => {
    expect(naming(/business_os_apply_plan_payment/)).toEqual([
      // Comments only: the registered audit key's description and the lineage repository header.
      'lib/audit/events.ts',
      'lib/business-os/billing/planPaymentApply.ts',
      'lib/business-os/entitlements/planWriteChecks.ts',
      'lib/repositories/BusinessOsAccountLineageRepository.ts',
      'lib/repositories/BusinessOsBillingEventRepository.ts',
    ]);
    const rpcHolders = SOURCES.filter((source) => /\.rpc\s*\(\s*(BOS_APPLY_PLAN_PAYMENT_RPC|'business_os_apply_plan_payment')/.test(source.text)).map((source) => source.file);
    expect(rpcHolders).toEqual(['lib/repositories/BusinessOsBillingEventRepository.ts']);
    const callers = SOURCES.filter((source) => /\.applyPlanPayment\s*\(/.test(source.text)).map((source) => source.file);
    expect(callers).toEqual(['lib/business-os/billing/planPaymentApply.ts']);
  });
});

/**
 * Plan payments P-5b.1 (N-2; workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md
 * §7 "Guards"; SA Q-4, C-5, C-7). The champion notifier is optional on the
 * apply's deps, so these guards close the gap that leaves: every caller of the
 * apply names it, it is built in one place, and boost never reaches it.
 */
describe('P-5b.1 (C-5, C-7): the N-2 notifier has one builder, every apply caller wires it, boost never names it', () => {
  const callers = (pattern: RegExp, except: string[] = []) =>
    SOURCES.filter((source) => pattern.test(source.text) && !except.includes(source.file))
      .map((source) => source.file)
      .sort();

  it('every non-test caller of applyPaidPlanInvoice( names firstPaymentNotifier (and the handler is found)', () => {
    const applyCallers = callers(/\bapplyPaidPlanInvoice\s*\(/, ['lib/business-os/billing/planPaymentApply.ts']);
    // Non-vacuity: the webhook's plan handler is the one known caller today.
    expect(applyCallers).toContain('lib/business-os/billing/planBillingHandler.ts');
    for (const file of applyCallers) {
      const text = SOURCES.find((source) => source.file === file)?.text ?? '';
      expect({ file, namesNotifier: /\bfirstPaymentNotifier\b/.test(text) }).toEqual({ file, namesNotifier: true });
    }
  });

  it('the notifier is constructed only in planBillingHandler.ts', () => {
    expect(callers(/\bcreateFirstPaymentNotifier\s*\(/, ['lib/business-os/invites/championSubscribedNotification.ts'])).toEqual([
      'lib/business-os/billing/planBillingHandler.ts',
    ]);
    // Imported (statically or dynamically) only by the wiring; other files name it in comments only.
    expect(callers(/(from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*championSubscribedNotification['"]/)).toEqual([
      'lib/business-os/billing/planBillingHandler.ts',
    ]);
  });

  it('findInviterNotificationFactsById is named only by the repository, the notifier and the handler wiring (C-7)', () => {
    expect(callers(/findInviterNotificationFactsById/)).toEqual([
      'lib/business-os/billing/planBillingHandler.ts',
      'lib/business-os/invites/championSubscribedNotification.ts',
      'lib/repositories/BusinessOsInviteRepository.ts',
    ]);
    // Called (not just named) only by the notifier and the handler's one-method hand-over.
    expect(callers(/\.findInviterNotificationFactsById\s*\(/)).toEqual([
      'lib/business-os/billing/planBillingHandler.ts',
      'lib/business-os/invites/championSubscribedNotification.ts',
    ]);
  });

  it.each([
    ['the notifier module', /championSubscribedNotification/],
    ['the port', /firstPaymentNotifier|FirstPaymentNotifier/],
    ['the notifier builder', /createFirstPaymentNotifier/],
    ['the notify call', /notifyChampion/],
    ['the N-2 invite read', /findInviterNotificationFactsById/],
  ])('no boost file names %s', (_what, pattern) => {
    const boost = SOURCES.filter(
      (source) =>
        source.file.startsWith('lib/business-os/boost/') ||
        (source.file.startsWith('app/') && /(^|\/)boost[^/]*(\/|\.tsx?$)|boost-packs\//.test(source.file))
    );
    expect(boost.length).toBeGreaterThan(10);
    expect(boost.filter((source) => pattern.test(source.text)).map((source) => source.file)).toEqual([]);
  });
});

describe('SR-6 / AC-F2.4: boost never stamps the first payment', () => {
  const BOOST = SOURCES.filter(
    (source) =>
      source.file.startsWith('lib/business-os/boost/') ||
      (source.file.startsWith('app/') && /(^|\/)boost[^/]*(\/|\.tsx?$)|boost-packs\//.test(source.file))
  );

  it('the boost scope is real: the boost modules and the boost routes', () => {
    const files = BOOST.map((source) => source.file);
    expect(files.filter((file) => file.startsWith('lib/business-os/boost/')).length).toBeGreaterThan(10);
    expect(files).toEqual(expect.arrayContaining(['app/api/business-os/credits/boost/checkout/route.ts', 'app/api/admin/business-os/credits/boost/reconcile/route.ts']));
  });

  it.each([
    ['the lineage table', /business_os_account_lineage/],
    ['first_paid_at', /first_paid_at|firstPaidAt/],
    ['first_payment_ref', /first_payment_ref|firstPaymentRef/],
    ['the apply function', /business_os_apply_plan_payment/],
    ['the apply method', /applyPlanPayment/],
    ['the billing-event repository', /BusinessOsBillingEventRepository|businessOsBillingEventRepository/],
  ])('no boost file names %s', (_what, pattern) => {
    expect(BOOST.filter((source) => pattern.test(source.text)).map((source) => source.file)).toEqual([]);
  });

  it('the lineage repository appears in boost only as the hold reader of the boost checkout', () => {
    const files = BOOST.filter((source) => /BusinessOsAccountLineageRepository|businessOsAccountLineageRepository/.test(source.text));
    expect(files.map((source) => source.file)).toEqual(['lib/business-os/boost/boostCheckoutDeps.ts']);
    const text = files[0].text;
    const uses = [...text.matchAll(/businessOsAccountLineageRepository/g)].map((match) => text.slice(match.index! - 40, match.index! + 40));
    expect(uses).toHaveLength(2);
    expect(uses[0]).toContain('import {');
    expect(uses[1]).toContain('holdReaders: { lineage:');
  });
});
