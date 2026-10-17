/**
 * Finance slice 8.3: the server-built History view (HS-FR-12 to HS-FR-15,
 * HS-W-6, HS-W-8, HS-W-10, E-99; AC-288, AC-289, AC-291).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { seedGroups } from '../planGroups';
import { buildHistoryView, dayBefore, notInstalledHistoryView, HISTORY_LIMITS, type HistoryRowInput } from '../historyView';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];

const row = (as_of_date: string, metric: string, value: number | string, dimension = 'all', unit = 'accounts'): HistoryRowInput => ({
  as_of_date,
  metric,
  dimension,
  unit,
  value,
});
const dayRows = (date: string, total: number, extra: HistoryRowInput[] = []) => [
  row(date, 'accounts_total', total),
  row(date, 'accounts_in_group', total, 'trial'),
  row(date, 'founding_no_end_date', 1),
  row(date, 'credit_allowance', 1000.1, 'all', 'credits'),
  row(date, 'credit_used', '0.2', 'all', 'credits'),
  ...extra,
];
const WINDOW = { from: '2026-10-01', to: '2026-10-17' };
const view = (rows: HistoryRowInput[], first: string | null = '2026-10-10', window = WINDOW, latestDay = '2026-10-16') =>
  buildHistoryView({ window, latestDay, firstSnapshotDate: first, rows, config });

describe('HS-FR-12: the three states', () => {
  it('no snapshot at all: no_history', () => {
    expect(view([], null).state).toBe('no_history');
  });
  it('snapshots, none in the window: none_in_window, with the first date', () => {
    const v = view([], '2026-09-01');
    expect(v.state).toBe('none_in_window');
    expect(v.firstSnapshotDate).toBe('2026-09-01');
  });
  it('snapshots in the window: ready', () => {
    expect(view(dayRows('2026-10-15', 3)).state).toBe('ready');
  });
  it('not installed: the window only, no tables', () => {
    expect(notInstalledHistoryView(WINDOW)).toMatchObject({ state: 'not_installed', firstSnapshotDate: null, planMix: { columns: [], points: [] } });
  });
});

describe('HS-FR-14: points, gaps and cells', () => {
  it('daily, newest first, from the last possible day back to the first snapshot (never before it)', () => {
    const v = view([...dayRows('2026-10-15', 3), ...dayRows('2026-10-12', 2)]);
    expect(v.weekly).toBe(false);
    expect(v.planMix.points.map((p) => p.date)).toEqual(['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10']);
  });

  it('a day with no row is "no_snapshot" (HS-W-6: no gap filling)', () => {
    const v = view(dayRows('2026-10-15', 3));
    expect(v.planMix.points[0]).toEqual({ date: '2026-10-16', kind: 'no_snapshot' });
    expect(v.planMix.points[1].kind).toBe('snapshot');
  });

  it('a metric not written that day is "not_recorded", never 0', () => {
    const v = view(dayRows('2026-10-15', 3));
    const point = v.credits.points[1];
    if (point.kind !== 'snapshot') throw new Error('expected a snapshot');
    const ids = v.credits.columns.map((c) => c.id);
    expect(point.cells[ids.indexOf('credit_allowance')]).toEqual({ kind: 'value', value: 1000.1 });
    expect(point.cells[ids.indexOf('gifted_outstanding')]).toEqual({ kind: 'not_recorded' });
  });

  it(`more than ${HISTORY_LIMITS.DAILY_MAX_DAYS} days: weekly points counting back from the last day`, () => {
    const w = { from: '2026-08-20', to: '2026-10-17' };
    const v = buildHistoryView({ window: w, latestDay: '2026-10-16', firstSnapshotDate: '2026-09-25', rows: dayRows('2026-10-09', 3), config });
    expect(v.weekly).toBe(true);
    expect(v.planMix.points.map((p) => p.date)).toEqual(['2026-10-16', '2026-10-09', '2026-10-02', '2026-09-25']);
  });

  it('31 inclusive days is still daily; 32 is weekly', () => {
    const at = (from: string) => buildHistoryView({ window: { from, to: '2026-10-31' }, latestDay: '2026-10-31', firstSnapshotDate: '2026-10-01', rows: dayRows('2026-10-31', 1), config }).weekly;
    expect(at('2026-10-01')).toBe(false);
    expect(at('2026-09-30')).toBe(true);
  });
});

describe('HS-FR-13 / HS-W-10: the columns', () => {
  it('plan mix follows Section 1’s seeded order with config labels, then Total and Founding Partners with no end date', () => {
    const v = view(dayRows('2026-10-15', 3));
    const seeded = seedGroups(config, true);
    const groups = v.planMix.columns.filter((c) => c.id === 'group');
    expect(groups.map((c) => (c.id === 'group' ? c.key : ''))).toEqual(seeded.map((g) => g.key));
    expect(groups.find((c) => c.id === 'group' && c.key === `tier:${TIER}`)).toMatchObject({ noLongerConfigured: false });
    expect(v.planMix.columns.slice(-2).map((c) => c.id)).toEqual(['accounts_total', 'founding_no_end_date']);
  });

  it('a stored tier no longer in config comes last among the groups, flagged; no tier literal needed (AC-291)', () => {
    const v = view(dayRows('2026-10-15', 3, [row('2026-10-15', 'accounts_in_group', 2, 'tier:retired-plan')]));
    const groups = v.planMix.columns.filter((c) => c.id === 'group');
    expect(groups[groups.length - 1]).toEqual({ id: 'group', key: 'tier:retired-plan', tierLabel: null, noLongerConfigured: true });
  });

  it('HS-W-8: a stored plan key that is neither a seeded group nor a tier key is dropped, never echoed', () => {
    const v = view(dayRows('2026-10-15', 3, [row('2026-10-15', 'accounts_in_group', 9, 'mystery_group')]));
    expect(JSON.stringify(v)).not.toContain('mystery_group');
  });

  it('the credits columns, in the HS-FR-13 order', () => {
    expect(view(dayRows('2026-10-15', 3)).credits.columns.map((c) => c.id)).toEqual([
      'credit_allowance',
      'credit_used',
      'gifted_outstanding',
      'bought_outstanding',
      'credit_outstanding_total',
      'credit_over_allowance',
      'credit_far_over_allowance',
    ]);
  });
});

describe('HS-FR-15: the change line', () => {
  it('newest minus oldest, only between two recorded cells; exact in micro units', () => {
    const rows = [
      ...dayRows('2026-10-16', 5, [row('2026-10-16', 'credit_used', '0.3', 'all', 'credits')]),
      ...dayRows('2026-10-10', 2),
    ].filter((r) => !(r.as_of_date === '2026-10-16' && r.metric === 'credit_used' && r.value === '0.2'));
    const v = view(rows);
    const plan = v.planMix;
    expect(plan.change[plan.columns.findIndex((c) => c.id === 'accounts_total')]).toEqual({ kind: 'value', value: 3 });
    const credits = v.credits;
    expect(credits.change[credits.columns.findIndex((c) => c.id === 'credit_used')]).toEqual({ kind: 'value', value: 0.1 });
    expect(credits.change[credits.columns.findIndex((c) => c.id === 'gifted_outstanding')]).toEqual({ kind: 'not_available' });
  });

  it('a "no snapshot" newest point gives "not_available" across the line', () => {
    const v = view(dayRows('2026-10-12', 2));
    expect(v.planMix.points[0].kind).toBe('no_snapshot');
    expect(v.planMix.change.every((c) => c.kind === 'not_available')).toBe(true);
  });
});

describe('dayBefore', () => {
  it('rolls months and years back in UTC', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});
