/**
 * PF-14 cross-path pin (plan payments P-7a.3; workplan §4.6; SA C-9, TQ-11).
 *
 * "Subscribed" must mean ONE thing on every path that deletes or wipes a
 * business, or one of them keeps charging an account another path would have
 * refused to touch. The paths, as built:
 *
 *   Danger Zone Reset / Purge   `ResetGuard` control 3 → `hasLivePlanSubscription`
 *   Admin delete (preview, commit's evaluations 1 and 2)
 *                               R-3 → `readPlanBilling` + `isPlanSubscriptionLive`
 *   Owner self-delete, operator test-account cleanup
 *                               guard G-6 inside `operator_test_account_cleanup`
 *                               (SQL, generated from `R3_LIVE_STATUSES`)
 *
 * This suite pins, in order:
 *   1. the SQL: every G-6 in the NEWEST cleanup migration (selected by the
 *      generator's first-line marker, so an unrelated later migration cannot
 *      become "newest" and a renamed one is not missed), and in the operator
 *      check / delete scripts, carries
 *      exactly `R3_LIVE_STATUSES` and the same "not ended yet" clause;
 *   2. the rule: G-6 read as a predicate equals `isPlanSubscriptionLive` for
 *      every status the database can hold × subscription id × ended;
 *   3. the paths, by behaviour: for each of those rows, in either mode, the
 *      Reset guard refuses `subscription_live` exactly when R-3 applies and
 *      exactly when `hasLivePlanSubscription` says true; a failed read refuses
 *      on both TS paths;
 *   4. the wiring, by source: the guard and R-3 reach the one predicate and
 *      write no status list of their own; the only engine call of the purge
 *      RPC runs after the guard; the cleanup RPC has one caller.
 *
 * A drifted list, a second rule, or a new caller of either destructive RPC
 * fails here.
 */

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

type BillingRow = { subscriptionStatus: string | null; stripeSubscriptionId: string | null; endedAt: string | null };
const billingAnswer: { test: { data: BillingRow | null; error: Error | null }; live: { data: BillingRow | null; error: Error | null } } = {
  test: { data: null, error: null },
  live: { data: null, error: null },
};

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async (_userId: string, livemode: boolean) => (livemode ? billingAnswer.live : billingAnswer.test),
  },
}));

// The guard's controls 1 and 2 must CLEAR, so control 3 is the only variable.
jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({
  businessPurgeRepository: {
    resolveConnectAccounts: async () => [],
    countLocalBlockingState: async () => [
      { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'x', count: 0 },
      { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'x', count: 0 },
      { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'x', count: 0 },
      { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'x', count: 0 },
    ],
  },
}));

import type { BusinessOsSubscriptionStatus } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { evaluateResetGuard } from '../ResetGuard';
import { hasLivePlanSubscription, readPlanBilling } from '../adminDeletionFacts';
import {
  evaluateAdminDeletionRefusals,
  isPlanSubscriptionLive,
  R3_LIVE_STATUSES,
  type PlanBillingRowFact,
} from '../adminDeletionRefusals';
import { CHECK_FILE, DELETE_FILE, MIGRATION_FILE } from '@/scripts/generate-test-account-cleanup-sql';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every status the database can hold. A `Record` so a new union member fails to compile here. */
const EVERY_STATUS: Record<BusinessOsSubscriptionStatus, true> = {
  incomplete: true,
  incomplete_expired: true,
  trialing: true,
  active: true,
  past_due: true,
  canceled: true,
  unpaid: true,
  paused: true,
};
const STATUSES: Array<BusinessOsSubscriptionStatus | null> = [...(Object.keys(EVERY_STATUS) as BusinessOsSubscriptionStatus[]), null];

/** Every row shape the rule distinguishes: status × subscription id × ended. */
const ROWS: PlanBillingRowFact[] = STATUSES.flatMap((status) =>
  [null, 'sub_1'].flatMap((stripeSubscriptionId) =>
    [null, '2026-10-01T00:00:00.000Z'].map((endedAt) => ({ status, stripeSubscriptionId, endedAt }))
  )
);

/**
 * The generator's first-line marker. Generated cleanup migrations are found by
 * CONTENT, not by filename, exactly as `scripts/__tests__/testAccountCleanupSql.test.ts`
 * (G-b) finds them: 20261081 already broke the `operator_test_account_cleanup`
 * name pattern once, so a filename glob would miss (or false-red on) the next
 * rename. (SA code review P-7a.3, F-3.)
 */
const GENERATED_MARKER = 'GENERATED by scripts/generate-test-account-cleanup-sql.ts';

function newestCleanupMigration(): string {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => {
      const firstLine = fs.readFileSync(path.join(dir, name), 'utf8').split('\n', 1)[0];
      return firstLine.startsWith('-- ') && firstLine.includes(GENERATED_MARKER);
    })
    .sort();
  expect(names.length).toBeGreaterThan(0);
  return `supabase/migrations/${names[names.length - 1]}`;
}

/** Every G-6 count expression in a SQL text: its status list and whether the "not ended" clause follows. */
function g6Predicates(sql: string): Array<{ statuses: string[]; notEndedClause: boolean }> {
  const out: Array<{ statuses: string[]; notEndedClause: boolean }> = [];
  const marker = "'G-6'::text AS guard";
  let at = sql.indexOf(marker);
  while (at !== -1) {
    // The guard row's count expression follows within the same UNION arm.
    const arm = sql.slice(at, at + 1500);
    const match = arm.match(
      /billing\.subscription_status IN \(([^)]*)\)\s+OR\s+\(billing\.stripe_subscription_id IS NOT NULL AND billing\.ended_at IS NULL\)/
    );
    const inList = arm.match(/billing\.subscription_status IN \(([^)]*)\)/);
    out.push({
      statuses: inList ? inList[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [],
      notEndedClause: match !== null,
    });
    at = sql.indexOf(marker, at + marker.length);
  }
  return out;
}

/** G-6 read as a predicate over one billing row, from the list parsed out of the SQL. */
function g6Counts(row: PlanBillingRowFact, sqlStatuses: readonly string[]): boolean {
  return (row.status !== null && sqlStatuses.includes(row.status)) || (row.stripeSubscriptionId !== null && row.endedAt === null);
}

/** The source without comments, so a mention in a comment is never mistaken for code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

const asRepoRow = (row: PlanBillingRowFact): BillingRow => ({
  subscriptionStatus: row.status,
  stripeSubscriptionId: row.stripeSubscriptionId,
  endedAt: row.endedAt,
});

beforeEach(() => {
  billingAnswer.test = { data: null, error: null };
  billingAnswer.live = { data: null, error: null };
});

describe('1. the SQL guard G-6 carries the one status list', () => {
  it('the newest cleanup migration, chosen by the generator filename pattern, is the one the generator writes', () => {
    expect(newestCleanupMigration()).toBe(MIGRATION_FILE);
  });

  it.each([
    ['the newest cleanup migration', () => newestCleanupMigration()],
    ['the operator check script', () => CHECK_FILE],
    ['the operator delete script', () => DELETE_FILE],
  ])('every G-6 in %s lists exactly R3_LIVE_STATUSES, with the "not ended yet" clause', (_label, file) => {
    const predicates = g6Predicates(read(file()));
    expect(predicates.length).toBeGreaterThan(0);
    for (const predicate of predicates) {
      expect([...predicate.statuses].sort()).toEqual([...R3_LIVE_STATUSES].sort());
      expect(predicate.notEndedClause).toBe(true);
    }
  });

  it('the parser is not vacuous: a drifted list is seen as drifted', () => {
    const drifted = read(newestCleanupMigration()).replace("'past_due', ", '');
    const predicates = g6Predicates(drifted);
    expect(predicates.some((p) => !p.statuses.includes('past_due'))).toBe(true);
  });
});

describe('2. G-6 read as a predicate is isPlanSubscriptionLive', () => {
  const sqlStatuses = g6Predicates(read(MIGRATION_FILE))[0].statuses;

  it.each(ROWS.map((row) => [JSON.stringify(row), row] as const))('%s', (_label, row) => {
    expect(g6Counts(row, sqlStatuses)).toBe(isPlanSubscriptionLive(row));
  });
});

describe('3. the Reset guard, R-3 and hasLivePlanSubscription agree on every row, in either mode', () => {
  const r3For = (billing: { test: { row: PlanBillingRowFact | null } | 'unreadable'; live: { row: PlanBillingRowFact | null } | 'unreadable' }) =>
    evaluateAdminDeletionRefusals({
      adminId: 'admin-1',
      targetId: 'target-1',
      targetIsAdmin: false,
      later: {
        billing,
        connectAccounts: 0,
        localBlocking: { outcome: 'clear' },
        schema: { status: 'ok', unclassified: [], missingDeletable: [] },
        deleteGraph: { status: 'ok' },
      },
    }).refusals.find((r) => r.id === 'R-3');

  const cases = ROWS.flatMap((row) => (['test', 'live'] as const).map((mode) => [`${mode} ${JSON.stringify(row)}`, mode, row] as const));

  it.each(cases)('%s', async (_label, mode, row) => {
    billingAnswer[mode] = { data: asRepoRow(row), error: null };
    const live = isPlanSubscriptionLive(row);

    // hasLivePlanSubscription (the guard's read, and the admin entitlements op's).
    await expect(hasLivePlanSubscription('target-1')).resolves.toBe(live);

    // The Reset guard refuses with control 3 exactly when the row is live.
    const guard = await evaluateResetGuard({ userId: 'target-1', correlationId: 'c' });
    if (live) expect(guard).toMatchObject({ outcome: 'refused', control: 'subscription_live' });
    else expect(guard).toEqual({ outcome: 'clear' });

    // R-3, from the same reads (`readPlanBilling` both modes, as the admin facts gather them).
    const r3 = r3For({ test: await readPlanBilling('target-1', false), live: await readPlanBilling('target-1', true) });
    expect(r3?.status).toBe(live ? 'applies' : 'clear');
  });

  it('a failed read refuses on both TS paths: subscription_unreadable, and R-3 unverified', async () => {
    billingAnswer.live = { data: null, error: new Error('read failed') };

    await expect(hasLivePlanSubscription('target-1')).resolves.toBeNull();
    await expect(evaluateResetGuard({ userId: 'target-1', correlationId: 'c' })).resolves.toMatchObject({
      outcome: 'refused',
      control: 'subscription_unreadable',
    });
    const r3 = r3For({ test: await readPlanBilling('target-1', false), live: await readPlanBilling('target-1', true) });
    expect(r3?.status).toBe('unverified');
  });
});

describe('4. the wiring: one predicate, one caller per destructive RPC', () => {
  const LIVE_STATUS_LITERAL = /'(?:active|trialing|past_due|unpaid|paused)'/;

  it('the Reset guard reaches the shared read and writes no status list of its own', () => {
    const guard = code('lib/business-os/purge/ResetGuard.ts');
    expect(guard).toMatch(/import \{ hasLivePlanSubscription \} from '\.\/adminDeletionFacts';/);
    expect(guard).toMatch(/await hasLivePlanSubscription\(userId\)/);
    expect(guard).not.toMatch(LIVE_STATUS_LITERAL);
    // Control 3 runs before control 1's Connect read.
    expect(guard.indexOf('hasLivePlanSubscription(userId)')).toBeLessThan(guard.indexOf('resolveConnectAccounts('));
  });

  it('hasLivePlanSubscription and R-3 both decide through isPlanSubscriptionLive, and only the evaluator holds the list', () => {
    const facts = code('lib/business-os/purge/adminDeletionFacts.ts');
    expect(facts).toMatch(/import \{ isPlanSubscriptionLive[^}]*\} from '\.\/adminDeletionRefusals';/);
    expect(facts).toMatch(/isPlanSubscriptionLive\(row\)/);
    expect(facts).not.toMatch(LIVE_STATUS_LITERAL);

    const refusals = code('lib/business-os/purge/adminDeletionRefusals.ts');
    const r3 = refusals.slice(refusals.indexOf('function evaluateR3'), refusals.indexOf('function evaluateR4'));
    expect(r3).toMatch(/isPlanSubscriptionLive\(m\.fact\.row\)/);
  });

  it('the generator builds G-6 from R3_LIVE_STATUSES, never a list of its own', () => {
    // Raw, not comment-stripped: the generator's comments carry globs and SQL
    // that a naive stripper would run together with code.
    const generator = read('scripts/generate-test-account-cleanup-sql.ts');
    expect(generator).toMatch(/import \{ R3_LIVE_STATUSES \} from '@\/lib\/business-os\/purge\/adminDeletionRefusals';/);
    const g6 = generator.slice(generator.indexOf("'G-6'"), generator.indexOf("'G-7'"));
    expect(g6).toContain('litList(R3_LIVE_STATUSES)');
  });

  it('the purge RPC has one engine caller, ResetService, and it runs after the guard', () => {
    const callers = filesMatching(/\bexecutePurge\(/).filter((f) => f !== 'lib/repositories/BusinessPurgeRepository.ts');
    expect(callers).toEqual(['lib/business-os/purge/ResetService.ts']);
    const service = code('lib/business-os/purge/ResetService.ts');
    expect(service.indexOf('evaluateResetGuard(')).toBeGreaterThan(-1);
    expect(service.indexOf('evaluateResetGuard(')).toBeLessThan(service.indexOf('executePurge('));
  });

  it('the cleanup function (G-6) is called from one repository only', () => {
    expect(filesMatching(/\.rpc\(\s*CLEANUP_RPC\b/)).toEqual(['lib/repositories/TestAccountCleanupRepository.ts']);
    expect(filesMatching(/\.rpc\(\s*['"`]operator_test_account_cleanup['"`]/)).toEqual([]);
  });
});

/**
 * Product files (tests excluded) whose RAW source matches. Raw on purpose
 * (as `no-deletion-paths.guard.test.ts` argues): a comment stripper that
 * swallows code fails silently in the permissive direction, while a mention in
 * a comment only costs a look.
 */
function filesMatching(pattern: RegExp): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (['node_modules', '.next', '.claude', 'coverage', '__tests__', '__fixtures__'].includes(entry.name)) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && pattern.test(read(rel))) found.push(rel);
    }
  };
  for (const dir of ['app', 'lib', 'components', 'hooks']) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
  return found.sort();
}
