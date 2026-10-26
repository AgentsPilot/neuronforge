/**
 * QA, live-test fix LF-2 (2026-10-21): the cohort account's own column says
 * what the ACCOUNT really has, not what its plan has by default.
 *
 * Gaps left by the Dev tests in `customerPlanView.test.ts`:
 *   - an independent recompute: for every row, the own cell's ✓ equals "every
 *     visible member is granting" in the account's own resolution (the row's
 *     members come from `PLAN_COMPARISON_ROWS`, or the row id for a fallback row);
 *   - an admin override on the account moves the own cell and NO tier cell
 *     (C-17: the tier columns never read the account);
 *   - the own cell is never highlighted, for every cohort.
 */

import { buildCustomerPlanView, isHiddenFromCustomer } from '@/lib/business-os/entitlements/customerPlanView';
import { PLAN_COMPARISON_ROWS } from '@/lib/business-os/entitlements/config/planComparison';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { isGrantingValue } from '@/lib/business-os/entitlements/schema';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementOverride } from '@/lib/business-os/entitlements/account';

const CONFIG = readCodeConfig();
const NOW = new Date('2026-10-21T10:00:00.000Z');
// Cohort ids appear only in tests (C-7).
const COHORTS = ['trial', 'champion'] as const;
type Catalog = Record<string, Parameters<typeof isGrantingValue>[1]>;
const CATALOG = CONFIG.catalog as unknown as Catalog;

function viewFor(planId: string, overrides: EntitlementOverride[] = [], cohortExpiresAt?: string | null) {
  const account = previewAccountFor(CONFIG, planId, NOW);
  const resolution = resolveEntitlements({
    config: CONFIG,
    account: cohortExpiresAt === undefined ? account : { ...account, cohortExpiresAt },
    overrides,
    addons: [],
    now: NOW,
  });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config: CONFIG, locale: 'en' });
  return { view, resolution };
}

function membersOf(rowId: string): string[] {
  const configured = PLAN_COMPARISON_ROWS.find((row) => row.id === rowId);
  const ids = configured ? [...configured.capabilities] : [rowId];
  return ids.filter((id) => CATALOG[id] !== undefined && !isHiddenFromCustomer(id, CATALOG[id] as never));
}

const rowsOf = (view: ReturnType<typeof viewFor>['view']) => (view.comparison?.sections ?? []).flatMap((section) => section.rows);

describe('QA LF-2: own column = the account resolution (independent recompute)', () => {
  it.each(COHORTS)('%s: every row has an own cell whose ✓ matches the resolution, never highlighted', (planId) => {
    const { view, resolution } = viewFor(planId);
    expect(view.comparison?.current).toEqual({ planId });
    const rows = rowsOf(view);
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      const members = membersOf(row.row);
      expect(members.length).toBeGreaterThan(0);
      const expected = members.every((id) => isGrantingValue(resolution.values[id].value as never, CATALOG[id]));
      expect({ row: row.row, included: row.current?.included }).toEqual({ row: row.row, included: expected });
      expect(row.current?.planId).toBe(planId);
      expect(row.current?.highlight).toBe(false);
    }
  });

  it.each(COHORTS)('%s with an end date gets the same own column as without one', (planId) => {
    const open = rowsOf(viewFor(planId, [], null).view).map((row) => row.current);
    const dated = rowsOf(viewFor(planId, [], '2099-01-01T00:00:00.000Z').view).map((row) => row.current);
    expect(dated).toEqual(open);
  });

  it('tier accounts: no own column on the comparison or any row', () => {
    for (const tier of CONFIG.tierOrder) {
      const { view } = viewFor(tier);
      expect(view.comparison?.current).toBeNull();
      for (const row of rowsOf(view)) expect(row.current).toBeNull();
    }
  });
});

describe('QA LF-2: an override on the account moves only the own cell (C-17)', () => {
  it.each(COHORTS)('%s: revoking a granted single-member boolean capability turns its own cell ✕, tier cells unchanged', (planId) => {
    const before = viewFor(planId);
    // Pick a row the account has, whose single member is a boolean capability.
    const target = rowsOf(before.view).find((row) => {
      const members = membersOf(row.row);
      return row.current?.included === true && members.length === 1 && CATALOG[members[0]].shape.kind === 'boolean';
    });
    expect(target).toBeDefined();
    const capability = membersOf(target!.row)[0];
    const override: EntitlementOverride = {
      id: 'qa-ovr-1',
      capability,
      op: 'revoke',
      value: null,
      expiresAt: null,
      endedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    const after = viewFor(planId, [override]);
    // Non-vacuity: the resolver really applied it.
    expect(isGrantingValue(after.resolution.values[capability].value as never, CATALOG[capability])).toBe(false);

    const afterRow = rowsOf(after.view).find((row) => row.row === target!.row);
    // The row survives when a tier still grants it; then its own cell is ✕.
    if (afterRow) {
      expect(afterRow.current?.included).toBe(false);
      expect(afterRow.cells).toEqual(target!.cells);
    }
    // Every other row's tier cells are untouched.
    const tierCells = (view: typeof before.view) => rowsOf(view).filter((row) => row.row !== target!.row).map((row) => [row.row, row.cells]);
    expect(tierCells(after.view)).toEqual(tierCells(before.view));
  });
});
