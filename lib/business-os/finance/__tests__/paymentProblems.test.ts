/**
 * The client payment problems builder (finance slice 2b, T3): overdue invoices
 * and instalments against independent re-implementations of SQL checks 10 and
 * 11 (AC-56, AC-58), the UTC-midnight edge (AC-57), client plans (AC-59, AC-60,
 * SA-W39, SA-WR-22), the ceiling (AC-62), empty parts (AC-63), an overdue
 * invoice with no due date (SA-W36), the reminder mapping (SA-W35) and the
 * block status that is never unknown (SA-W31).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  buildClientPlans,
  buildOverdue,
  CLIENT_PLAN_STATUSES,
  mapReminderFigures,
  paymentProblemsStatus,
  type ClientPlanInput,
  type DueRowInput,
} from '../paymentProblems';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const isPlatformAccount = (id: string) => id === PLATFORM;
const TODAY = '2026-10-12';

let seq = 0;
function due(extra: Partial<DueRowInput> = {}): DueRowInput {
  seq += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: A,
    amount: '100.00',
    currency: 'USD',
    status: 'overdue',
    due_date: '2026-09-30',
    ...extra,
  };
}

const read = (rows: DueRowInput[], reachedCeiling = false) => ({ rows, reachedCeiling });
const overdue = (kind: 'invoice' | 'instalment', rows: DueRowInput[], opts: { ceiling?: boolean; today?: string; cap?: number } = {}) =>
  buildOverdue({ kind, read: read(rows, opts.ceiling), todayUtc: opts.today ?? TODAY, isPlatformAccount, displayCap: opts.cap ?? 50 });

/**
 * An independent re-implementation of SQL check 10 / 11 (the 1b / 2a method):
 * written from the SQL, not from the builder. Marked overdue, or still
 * sent/pending with a due date before today; per upper-cased currency; amount
 * in hundredths; distinct businesses; min(due_date) over non-null dates.
 */
function checkSql(rows: DueRowInput[], unmarked: string, today: string) {
  const out = new Map<string, { marked: number; pastDue: number; cents: number; businesses: Set<string>; oldest: string | null }>();
  for (const row of rows) {
    const isMarked = row.status === 'overdue';
    const isPast = row.status === unmarked && typeof row.due_date === 'string' && row.due_date < today;
    if (!isMarked && !isPast) continue;
    const key = String(row.currency).trim().toUpperCase();
    const acc = out.get(key) ?? { marked: 0, pastDue: 0, cents: 0, businesses: new Set<string>(), oldest: null };
    if (isMarked) acc.marked += 1;
    else acc.pastDue += 1;
    acc.cents += Math.round(Number(row.amount) * 100);
    if (row.user_id) acc.businesses.add(row.user_id);
    if (typeof row.due_date === 'string' && (acc.oldest === null || row.due_date < acc.oldest)) acc.oldest = row.due_date;
    out.set(key, acc);
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, a]) => ({ currency, marked: a.marked, pastDue: a.pastDue, amount: a.cents / 100, businesses: a.businesses.size, oldestDueDate: a.oldest }));
}

describe('AC-56: overdue invoices match check 10, per currency', () => {
  const rows = [
    due({ amount: '100.10', currency: 'USD', due_date: '2026-09-01' }),
    due({ amount: '0.20', currency: 'usd', due_date: '2026-09-15', user_id: B }),
    due({ status: 'sent', amount: '50.00', currency: 'ILS', due_date: '2026-10-11' }),
    due({ status: 'sent', amount: '70.00', currency: 'ILS', due_date: '2026-10-12' }), // due today: not past due
    due({ status: 'overdue', amount: '12.34', currency: 'EUR', due_date: null }),
  ];

  it('marked, past due, the full amount, businesses and the oldest due date per currency equal the SQL', () => {
    const built = overdue('invoice', rows);
    expect(built.status).toBe('ok');
    const lines = built.figures!.lines.map(({ amountExact, unreadable, ...rest }) => {
      expect(amountExact).toBe(true);
      expect(unreadable).toBe(0);
      return rest;
    });
    expect(lines).toEqual(checkSql(rows, 'sent', TODAY));
    expect(built.figures!.lines.find((l) => l.currency === 'USD')).toMatchObject({ marked: 2, amount: 100.3, businesses: 2, oldestDueDate: '2026-09-01' });
    expect(built.figures!.lines.find((l) => l.currency === 'ILS')).toMatchObject({ marked: 0, pastDue: 1, amount: 50 });
    expect(built.figures!.total).toBe(4);
    expect(built.figures!.businesses).toBe(2);
    // The row due today came back from nothing the .or() would return; here it is counted as unexpected.
    expect(built.unexpectedRows).toBe(1);
  });

  it('SA-W36: an overdue invoice with no due date is counted as marked, has unknown date and days, sorts last, and is not the oldest', () => {
    const built = overdue('invoice', rows);
    const eur = built.figures!.lines.find((l) => l.currency === 'EUR')!;
    expect(eur).toMatchObject({ marked: 1, oldestDueDate: null });
    const last = built.figures!.rows[built.figures!.rows.length - 1];
    expect(last).toMatchObject({ dueDate: null, daysPastDue: null, kind: 'marked', currency: 'EUR' });
  });

  it('rows are oldest due date first, then by id; every row carries its own currency and full amount', () => {
    const built = overdue('invoice', rows);
    expect(built.figures!.rows.map((r) => r.dueDate)).toEqual(['2026-09-01', '2026-09-15', '2026-10-11', null]);
    expect(built.figures!.rows[0]).toMatchObject({ amount: 100.1, currency: 'USD', daysPastDue: 41, kind: 'marked', accountId: A, isPlatform: false });
    expect(built.figures!.rows[2]).toMatchObject({ kind: 'past_due', daysPastDue: 1 });
  });

  it('no line adds two currencies: three currencies give three lines, none holding another’s amount', () => {
    const built = overdue('invoice', rows);
    expect(built.figures!.lines.map((l) => l.currency)).toEqual(['EUR', 'ILS', 'USD']);
    expect(built.figures!.lines.map((l) => l.amount)).toEqual([12.34, 50, 100.3]);
  });

  it('the display cap keeps the oldest rows and reports the total; a platform row is flagged', () => {
    const many = Array.from({ length: 5 }, (_, i) => due({ due_date: `2026-09-0${i + 1}`, user_id: i === 0 ? PLATFORM : A }));
    const built = overdue('invoice', many, { cap: 3 });
    expect(built.figures!.rows.map((r) => r.dueDate)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(built.figures!.rowsTotal).toBe(5);
    expect(built.figures!.rows[0].isPlatform).toBe(true);
  });
});

describe('AC-57: the UTC-midnight edge, through the builder', () => {
  it.each([
    ['invoice', 'sent'],
    ['instalment', 'pending'],
  ] as const)('a %s still %s and due 2026-09-30 is not past due on 2026-09-30, and 1 day past due on 2026-10-01', (kind, status) => {
    const row = due({ status, due_date: '2026-09-30' });
    const before = overdue(kind, [row], { today: '2026-09-30' });
    expect(before.figures!.total).toBe(0);
    expect(before.figures!.empty).toBe(true);
    const after = overdue(kind, [row], { today: '2026-10-01' });
    expect(after.figures!.rows).toEqual([expect.objectContaining({ kind: 'past_due', dueDate: '2026-09-30', daysPastDue: 1 })]);
  });
});

describe('AC-58: overdue instalments match check 11', () => {
  const rows = [
    due({ status: 'overdue', amount: '30.00', currency: 'ILS', due_date: '2026-09-20' }),
    due({ status: 'pending', amount: '25.50', currency: 'ILS', due_date: '2026-10-05' }),
    due({ status: 'pending', amount: '25.50', currency: 'ILS', due_date: '2026-10-05', user_id: B }),
    // `sent` means nothing for an instalment: never past due.
    due({ status: 'sent', amount: '9.00', currency: 'ILS', due_date: '2026-10-01' }),
  ];

  it('equals the SQL; pending is the unmarked status, not sent', () => {
    const built = overdue('instalment', rows);
    const sqlShape = built.figures!.lines.map((l) => ({
      currency: l.currency, marked: l.marked, pastDue: l.pastDue, amount: l.amount, businesses: l.businesses, oldestDueDate: l.oldestDueDate,
    }));
    expect(sqlShape).toEqual(checkSql(rows, 'pending', TODAY));
    expect(built.figures!.lines).toEqual([
      { currency: 'ILS', marked: 1, pastDue: 2, amount: 81, amountExact: true, unreadable: 0, businesses: 2, oldestDueDate: '2026-09-20' },
    ]);
    expect(built.unexpectedRows).toBe(1);
  });

  it('statuses are matched exactly: " overdue" or "Pending" is not counted (SA-WR-15)', () => {
    const built = overdue('instalment', [due({ status: ' overdue' }), due({ status: 'Pending', due_date: '2026-01-01' })]);
    expect(built.figures!.total).toBe(0);
    expect(built.unexpectedRows).toBe(2);
  });
});

describe('AC-62: the ceiling and unreadable amounts', () => {
  it('at the ceiling: not exact, every amount "at least", the part partial', () => {
    const built = overdue('invoice', [due(), due()], { ceiling: true });
    expect(built.status).toBe('partial');
    expect(built.figures!.exact).toBe(false);
    expect(built.figures!.lines.every((l) => l.amountExact === false)).toBe(true);
  });

  it('an unreadable amount is left out, counted on its line, and makes the part partial; the row amount is null', () => {
    const built = overdue('invoice', [due({ amount: '10.00' }), due({ amount: 'abc' }), due({ amount: '1.005', currency: 'ILS' })]);
    expect(built.status).toBe('partial');
    expect(built.figures!.unreadableAmounts).toBe(2);
    expect(built.figures!.lines.find((l) => l.currency === 'USD')).toMatchObject({ amount: 10, unreadable: 1, amountExact: false, marked: 2 });
    expect(built.figures!.rows.filter((r) => r.amount === null)).toHaveLength(2);
  });

  it('a failed read is unknown with no figures, never zeros', () => {
    expect(buildOverdue({ kind: 'invoice', read: null, todayUtc: TODAY, isPlatformAccount, displayCap: 50 })).toEqual({
      status: 'unknown',
      figures: null,
      unexpectedRows: 0,
    });
  });
});

describe('AC-63: empty parts', () => {
  it('no overdue row → empty, ok, no line', () => {
    const built = overdue('invoice', []);
    expect(built).toEqual({
      status: 'ok',
      figures: { empty: true, exact: true, lines: [], businesses: 0, total: 0, unreadableAmounts: 0, rows: [], rowsTotal: 0 },
      unexpectedRows: 0,
    });
  });

  it('no client plan → total 0, every known status shown at 0, ok', () => {
    const built = buildClientPlans({ read: { rows: [], reachedCeiling: false }, window: WINDOW, now: NOW });
    expect(built.status).toBe('ok');
    expect(built.figures!.total).toBe(0);
    expect(built.figures!.byStatus.map((s) => s.plans)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

// ── Client plans ──────────────────────────────────────────────────────────────
const NOW = new Date('2026-10-12T12:00:00.000Z');
const WINDOW = { start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-10-13T00:00:00.000Z') };
function plan(extra: Partial<ClientPlanInput> = {}): ClientPlanInput {
  seq += 1;
  return {
    id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: A,
    status: 'active',
    cancelled_at: null,
    completed_at: null,
    next_charge_at: '2026-11-01T00:00:00Z',
    last_failure_at: null,
    ...extra,
  };
}

describe('AC-59: client plans', () => {
  const rows = [
    plan(),
    plan({ next_charge_at: '2026-10-12T11:59:00Z' }), // active, next charge overdue
    plan({ status: 'past_due', next_charge_at: '2026-10-01T00:00:00Z' }), // not active now; not counted overdue
    plan({ status: 'cancelled', cancelled_at: '2026-10-01T00:00:00Z' }), // on the start edge: in
    plan({ status: 'cancelled', cancelled_at: '2026-09-30T23:59:59Z' }), // just before: out
    plan({ status: 'completed', completed_at: '2026-10-12T23:59:59Z' }), // just before the end: in
    plan({ status: 'completed', completed_at: '2026-10-13T00:00:00Z' }), // on the end edge: out
    plan({ status: 'weird' }),
    plan({ status: null }),
  ];

  it('every known status in order with zeros, then the others; active now is exactly active', () => {
    const f = buildClientPlans({ read: { rows, reachedCeiling: false }, window: WINDOW, now: NOW }).figures!;
    expect(f.byStatus).toEqual([
      { status: 'pending', plans: 0, recognised: true },
      { status: 'active', plans: 2, recognised: true },
      { status: 'past_due', plans: 1, recognised: true },
      { status: 'paused', plans: 0, recognised: true },
      { status: 'completed', plans: 2, recognised: true },
      { status: 'cancelled', plans: 2, recognised: true },
      { status: 'weird', plans: 1, recognised: false },
      { status: null, plans: 1, recognised: false },
    ]);
    expect(f.unrecognised).toBe(2);
    expect(f.activeNow).toBe(2);
    expect(f.total).toBe(9);
  });

  it('cancelled and completed in the window are half-open [start, end); next charge overdue is active only', () => {
    const f = buildClientPlans({ read: { rows, reachedCeiling: false }, window: WINDOW, now: NOW }).figures!;
    expect(f.cancelledInWindow).toBe(1);
    expect(f.completedInWindow).toBe(1);
    expect(f.nextChargeOverdue).toBe(1);
  });

  it('the cancelled count follows the window', () => {
    const wider = { start: new Date('2026-09-01T00:00:00Z'), end: WINDOW.end };
    expect(buildClientPlans({ read: { rows, reachedCeiling: false }, window: wider, now: NOW }).figures!.cancelledInWindow).toBe(2);
  });

  it('an unreadable time is counted, never guessed, and makes the part partial; a ceiling does too', () => {
    const odd = buildClientPlans({ read: { rows: [plan({ next_charge_at: 'soon' })], reachedCeiling: false }, window: WINDOW, now: NOW });
    expect(odd.status).toBe('partial');
    expect(odd.figures).toMatchObject({ unreadableTimes: 1, nextChargeOverdue: 0 });
    const capped = buildClientPlans({ read: { rows: [plan()], reachedCeiling: true }, window: WINDOW, now: NOW });
    expect(capped.status).toBe('partial');
    expect(capped.figures!.exact).toBe(false);
  });

  it('a failed read is unknown', () => {
    expect(buildClientPlans({ read: null, window: WINDOW, now: NOW })).toEqual({ status: 'unknown', figures: null });
  });
});

describe('AC-60: failed plan charges', () => {
  it('no last_failure_at anywhere → never recorded, 0 in the window', () => {
    const f = buildClientPlans({ read: { rows: [plan(), plan({ status: 'cancelled' })], reachedCeiling: false }, window: WINDOW, now: NOW }).figures!;
    expect(f.failedCharges).toEqual({ everRecorded: false, inWindow: 0 });
  });

  it('QA-1: at the ceiling with no failure in the rows read → everRecorded false but not exact and partial, so the page qualifies the claim', () => {
    const built = buildClientPlans({ read: { rows: [plan()], reachedCeiling: true }, window: WINDOW, now: NOW });
    expect(built.status).toBe('partial');
    expect(built.figures).toMatchObject({ exact: false, failedCharges: { everRecorded: false, inWindow: 0 } });
  });

  it('a failure in the window is counted; one before it only says a failure was recorded', () => {
    const rows = [plan({ last_failure_at: '2026-10-05T10:00:00Z' }), plan({ last_failure_at: '2026-08-05T10:00:00Z' })];
    const f = buildClientPlans({ read: { rows, reachedCeiling: false }, window: WINDOW, now: NOW }).figures!;
    expect(f.failedCharges).toEqual({ everRecorded: true, inWindow: 1 });
  });
});

describe('SA-WR-22 / SA-W39: the plan statuses are the migration CHECK', () => {
  it('CLIENT_PLAN_STATUSES equals the CHECK list of the client plan table, in order', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260828e_payment_plan_subscriptions.sql'), 'utf8');
    const match = sql.match(/status\s+TEXT[^\n]*\n\s*CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/);
    expect(match).not.toBeNull();
    const fromSql = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // Non-vacuity: the extraction found the six values.
    expect(fromSql).toHaveLength(6);
    expect([...CLIENT_PLAN_STATUSES]).toEqual(fromSql);
  });

  it('the extraction bites (planted): a different CHECK gives a different list', () => {
    const planted = "  status TEXT NOT NULL DEFAULT 'pending'\n    CHECK (status IN ('pending', 'active'))";
    const match = planted.match(/status\s+TEXT[^\n]*\n\s*CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/);
    const fromSql = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql).not.toEqual([...CLIENT_PLAN_STATUSES]);
  });
});

describe('SA-W35: the reminder figures, mapped field by field', () => {
  const raw = {
    dueNow: 3, later: 9, noDueTime: null, inProgress: 1, stuck: 0, failed24h: 2, failed7d: 5,
    deadLettered24h: 0, deadLettered7d: 1, skipped7d: 4, guardrailSkips7d: null, unrecognisedStatus: 0,
    oldestDueAt: '2026-10-12T08:00:00.000Z',
  };

  it('copies exactly the seven counts and the oldest due time; nothing else travels', () => {
    expect(mapReminderFigures(raw)).toEqual({
      dueNow: 3, inProgress: 1, stuck: 0, failed24h: 2, failed7d: 5, deadLettered24h: 0, deadLettered7d: 1,
      oldestDueAt: '2026-10-12T08:00:00.000Z',
    });
    expect(mapReminderFigures({ ...raw, oldestDueAt: null })?.oldestDueAt).toBeNull();
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a missing count', { ...raw, stuck: undefined }],
    ['a negative count', { ...raw, failed24h: -1 }],
    ['a fractional count', { ...raw, dueNow: 1.5 }],
    ['a count as text', { ...raw, inProgress: '1' }],
    ['an unreadable oldest time', { ...raw, oldestDueAt: 'yesterday' }],
  ])('%s → null (the part says "Could not check reminders", never 0)', (_n, value) => {
    expect(mapReminderFigures(value)).toBeNull();
  });
});

describe('SA-W31: the block status is never unknown', () => {
  it.each([
    [['ok', 'ok', 'ok', 'ok'], 'ok'],
    [['ok', 'partial', 'ok', 'ok'], 'partial'],
    [['unknown', 'ok', 'ok', 'ok'], 'partial'],
    [['unknown', 'unknown', 'unknown', 'unknown'], 'partial'],
  ] as const)('%j → %s', (parts, expected) => {
    expect(paymentProblemsStatus(parts)).toBe(expected);
  });
});
