/**
 * readOwnerCreditHistory — one page of the owner's credit history (credit
 * deduction slice 7a, workplan §4.6, §7; SA SQ-29 to SQ-34, SQ-38, C-S7-2,
 * C-S7-3, W7-5).
 *
 * The ledger is ONE fixture of rows; the totals rows are DERIVED from it by
 * the recorder's own rules, and both the card and the history read the same
 * fake. So "the lines add up to the card's total" is a real property here,
 * not two numbers typed twice. Keys are matched as exact strings.
 *
 * Also here (rather than in separate files): the window function's tests
 * (§4.2), the reconciliation property (AC-38, C-S7-3) and the payload
 * allow-list (SQ-38).
 */

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshot: async () => {
      throw new Error('tests inject readAllowance');
    },
  }),
}));

import type {
  OwnerCreditChargeRow,
  OwnerCreditTotalsRow,
  OwnerDiaryKeyset,
  OwnerDiaryRow,
  OwnerLedgerWindow,
} from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { AI_ACTION_DECLARATIONS } from '@/lib/business-os/llm/aiActionAudit';
import { decodeHistoryCursor, encodeHistoryCursor } from '../creditHistoryCursor';
import type { CreditHistoryPage, OwnerCreditHistoryPage } from '../creditHistoryTypes';
import { CREDIT_HISTORY_PAGE_SIZE, readOwnerCreditHistory, type OwnerCreditHistoryDeps } from '../ownerCreditHistory';
import { readOwnerCreditUsage, resolveOwnerCreditWindow, type OwnerCreditCardDeps } from '../ownerCreditUsage';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const USER = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const PREVIOUS_PERIOD = '2026-08-14T09:31:07.123456+00:00';
const CALENDAR_MONTH = '2026-09-01T00:00:00.000Z';
const NOW = new Date('2026-09-30T12:00:00.000Z');

const MONTHLY: OwnerCreditAllowance = { amount: 32250, per: 'month' };
const TRIAL: OwnerCreditAllowance = { amount: 2000, per: 'total' };

let seq = 0;
const hex = (n: number) => n.toString(16).padStart(12, '0');

/** A charge row. `created_at` is microsecond, as PostgREST returns it. */
function charge(
  minute: number,
  over: Partial<OwnerDiaryRow> = {}
): OwnerDiaryRow {
  seq += 1;
  const mm = String(Math.floor(minute / 60) % 24).padStart(2, '0');
  const ss = String(minute % 60).padStart(2, '0');
  return {
    id: `00000000-0000-4000-8000-${hex(seq)}`,
    kind: 'charge',
    action_id: `aaaaaaaa-0000-4000-8000-${hex(seq)}`,
    adjusts_action_id: null,
    period_start: PERIOD,
    credits: '2.100000',
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: `2026-09-20T${mm}:${ss}:00.${String(100000 + seq).slice(-6)}+00:00`,
    user_id: USER,
    ...over,
  };
}

function correction(of: OwnerDiaryRow, minute: number, credits: string): OwnerDiaryRow {
  return charge(minute, {
    kind: 'adjustment',
    action_id: null,
    adjusts_action_id: of.action_id,
    credits,
    service: null,
    action_type: null,
    triggered_by: null,
    outcome: null,
    period_start: of.period_start,
  });
}

const num = (v: number | string) => Number(v);

/** Totals rows built from the rows by the recorder's rules (one per period). */
function totalsFrom(rows: readonly OwnerDiaryRow[]): OwnerCreditTotalsRow[] {
  const byPeriod = new Map<string, { o: number; s: number; e: number; a: number }>();
  for (const row of rows) {
    const t = byPeriod.get(row.period_start) ?? { o: 0, s: 0, e: 0, a: 0 };
    if (row.kind === 'adjustment') t.a += num(row.credits);
    else if (row.triggered_by === 'owner') t.o += num(row.credits);
    else if (row.triggered_by === 'scheduled') t.s += num(row.credits);
    else t.e += num(row.credits);
    byPeriod.set(row.period_start, t);
  }
  return [...byPeriod.entries()].map(([period_start, t]) => ({
    period_start,
    credits_total: (t.o + t.s + t.e + t.a).toFixed(6),
    credits_owner: t.o.toFixed(6),
    credits_scheduled: t.s.toFixed(6),
    credits_external: t.e.toFixed(6),
    credits_adjustment: t.a.toFixed(6),
  }));
}

const asCharge = (row: OwnerDiaryRow): OwnerCreditChargeRow => ({
  kind: row.kind,
  action_id: row.action_id,
  adjusts_action_id: row.adjusts_action_id,
  credits: row.credits,
  triggered_by: row.triggered_by,
  period_start: row.period_start,
  user_id: row.user_id,
  service: row.service,
  action_type: row.action_type,
});

/** Same-format strings: lexical order is time order here. */
const newestFirst = (a: OwnerDiaryRow, b: OwnerDiaryRow) =>
  a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1;

function inWindow(row: OwnerDiaryRow, window: OwnerLedgerWindow) {
  return window.kind === 'period' ? row.period_start === window.periodStart : row.period_start >= window.fromPeriodStart;
}

interface Fixture {
  rows: OwnerDiaryRow[];
  anchor?: string | null;
  allowance?: OwnerCreditAllowance | null;
  failRows?: boolean;
  failOriginals?: boolean;
  periodStartFor?: string;
}

function makeDeps(f: Fixture) {
  const totals = totalsFrom(f.rows);
  const owner = {
    findTotalsForPeriod: jest.fn(async (_a: string, periodStart: string) => ({
      data: totals.find((t) => t.period_start === periodStart) ?? null,
      error: null,
    })),
    listTotalsFrom: jest.fn(async (_a: string, from: string) => ({
      data: { rows: totals.filter((t) => t.period_start >= from), reachedCeiling: false },
      error: null,
    })),
    listAdjustmentsForPeriods: jest.fn(async (_a: string, periods: readonly string[]) => ({
      data: {
        rows: f.rows.filter((r) => r.kind === 'adjustment' && periods.includes(r.period_start)).map(asCharge),
        reachedCeiling: false,
      },
      error: null,
    })),
    findChargesByActionIds: jest.fn(async (_a: string, ids: readonly string[]) =>
      f.failOriginals
        ? { data: null, error: new Error('originals failed') }
        : {
            data: f.rows.filter((r) => r.kind === 'charge' && r.action_id !== null && ids.includes(r.action_id)).map(asCharge),
            error: null,
          }
    ),
    // Slice 11d: the card also reads the owner's credit lots (none here; the history never does).
    listOwnCreditLots: jest.fn(async () => ({ data: [], error: null })),
  };
  const ledger = {
    listLedgerRowsForWindow: jest.fn(
      async (_a: string, window: OwnerLedgerWindow, after: OwnerDiaryKeyset | null, limit: number) => {
        if (f.failRows) return { data: null, error: new Error('rows failed') };
        const all = f.rows
          .filter((r) => inWindow(r, window))
          .filter((r) => !after || r.created_at < after.createdAt || (r.created_at === after.createdAt && r.id < after.id))
          .sort(newestFirst);
        return { data: { rows: all.slice(0, limit), hasMore: all.length > limit }, error: null };
      }
    ),
    // Its own mock (same answers), so a test can tell the history's read from the window's.
    findChargesByActionIds: jest.fn(owner.findChargesByActionIds.getMockImplementation()!),
  };
  const deps: OwnerCreditHistoryDeps & OwnerCreditCardDeps = {
    findPeriodAnchor: jest.fn(async () => ({ data: f.anchor === undefined ? ANCHOR : f.anchor, error: null })),
    periodStartFor: jest.fn(async () => ({ data: f.periodStartFor ?? PERIOD, error: null })),
    owner,
    ledger,
    now: () => NOW,
    readAllowance: jest.fn(async () => (f.allowance === undefined ? MONTHLY : f.allowance)),
  };
  return { deps, owner, ledger };
}

const makeLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

function asPage(page: OwnerCreditHistoryPage | null): CreditHistoryPage {
  if (!page || 'restart' in page) throw new Error('expected a page');
  return page;
}

/** Every page, in order. */
async function allPages(deps: OwnerCreditHistoryDeps) {
  const pages: CreditHistoryPage[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const result = await readOwnerCreditHistory(USER, cursor ? decodeHistoryCursor(cursor) : null, deps, makeLog());
    if (result.error) throw result.error;
    const page = asPage(result.data);
    pages.push(page);
    if (!page.nextCursor) return pages;
    cursor = page.nextCursor;
  }
  throw new Error('no last page');
}

beforeEach(() => {
  seq = 0;
});

describe('the shared window (§4.2, SA SQ-30)', () => {
  it('monthly: the period key, exact; the card and the window agree on every figure', async () => {
    const rows = [charge(1), charge(2, { triggered_by: 'scheduled', credits: '0.200000' })];
    const { deps, owner } = makeDeps({ rows });
    const window = (await resolveOwnerCreditWindow(USER, deps, makeLog())).data!;
    const card = (await readOwnerCreditUsage(USER, deps, makeLog())).data!;

    expect(window.kind).toBe('monthly');
    expect(window.ledger).toEqual({ kind: 'period', periodStart: PERIOD });
    expect(window.key).toBe(PERIOD);
    expect(owner.findTotalsForPeriod).toHaveBeenCalledWith(USER, PERIOD);
    expect([window.used, window.usedByOwner, window.usedAutomatic]).toEqual([card.used, card.usedByOwner, card.usedAutomatic]);
    expect(window.resetsOn).toBe(card.period.resetsOn);
    expect(window.resetsOn).not.toBeNull();
  });

  it('trial: every period from the anchor, keyed by the anchor string; no reset date', async () => {
    const { deps, owner } = makeDeps({ rows: [charge(1)], allowance: TRIAL });
    const window = (await resolveOwnerCreditWindow(USER, deps, makeLog())).data!;
    expect(window.kind).toBe('trial_total');
    expect(window.ledger).toEqual({ kind: 'from', fromPeriodStart: ANCHOR });
    expect(window.key).toBe(ANCHOR);
    expect(window.resetsOn).toBeNull();
    expect(owner.listTotalsFrom).toHaveBeenCalledWith(USER, ANCHOR);
  });

  it('no plan row: the calendar month, no allowance, no reset date', async () => {
    const { deps } = makeDeps({ rows: [charge(1, { period_start: CALENDAR_MONTH })], anchor: null });
    const window = (await resolveOwnerCreditWindow(USER, deps, makeLog())).data!;
    expect(window.kind).toBe('calendar_month');
    expect(window.key).toBe(CALENDAR_MONTH);
    expect(window.allowance).toBeNull();
    expect(window.resetsOn).toBeNull();
    expect(window.used).toBeCloseTo(2.1, 6);
  });

  it('an error is returned and logged, never thrown', async () => {
    const { deps } = makeDeps({ rows: [] });
    deps.findPeriodAnchor = async () => ({ data: null, error: new Error('anchor failed') });
    const log = makeLog();
    const result = await resolveOwnerCreditWindow(USER, deps, log);
    expect(result.data).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'period_read_failed' }), 'Owner credit window read failed');
  });
});

describe('the first page', () => {
  it('carries the summary — the card\'s own figures — and the newest lines', async () => {
    const rows = [
      charge(1, { action_type: 'briefing_narration', triggered_by: 'scheduled', credits: '0.200000' }),
      charge(2),
    ];
    const { deps } = makeDeps({ rows });
    const card = (await readOwnerCreditUsage(USER, deps, makeLog())).data!;
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);

    expect(page.summary).toEqual({
      period: { kind: 'monthly', startsOn: '2026-09-14T09:31:07.123Z', endsBefore: card.period.resetsOn },
      used: card.used,
      usedByOwner: card.usedByOwner,
      usedAutomatic: card.usedAutomatic,
    });
    expect(page.lines).toEqual([
      {
        id: rows[1].id,
        at: rows[1].created_at.replace(/\.(\d{3})\d{3}\+00:00$/, '.$1Z'),
        area: 'chat',
        label: AI_ACTION_DECLARATIONS.chat_turn.diaryLabels,
        who: 'you',
        didNotComplete: false,
        isCorrection: false,
        credits: 2.1,
      },
      expect.objectContaining({ id: rows[0].id, area: 'briefing', who: 'automatic', credits: 0.2 }),
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('a trial page starts at the anchor and shows no end', async () => {
    const { deps } = makeDeps({ rows: [charge(1)], allowance: TRIAL });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.summary?.period).toEqual({ kind: 'trial_total', startsOn: '2026-09-14T09:31:07.123Z', endsBefore: null });
  });

  it('no plan row: the calendar month, no end', async () => {
    const { deps } = makeDeps({ rows: [charge(1, { period_start: CALENDAR_MONTH })], anchor: null });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.summary?.period).toEqual({ kind: 'calendar_month', startsOn: CALENDAR_MONTH, endsBefore: null });
    expect(page.lines).toHaveLength(1);
  });

  it('over the allowance: the true total, nothing else changes', async () => {
    const { deps } = makeDeps({ rows: [charge(1, { action_type: 'image_generation', credits: '32260.400000' })] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.summary?.used).toBe(32260.4);
  });

  it('nothing used: no lines, a zero total, still a summary', async () => {
    const { deps } = makeDeps({ rows: [] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.lines).toEqual([]);
    expect(page.summary?.used).toBe(0);
  });
});

describe('the lines', () => {
  it('a failed action is marked and still shows its credits (FR-8)', async () => {
    const { deps } = makeDeps({ rows: [charge(1, { outcome: 'failed', credits: '0.200000' })] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.lines[0]).toEqual(expect.objectContaining({ didNotComplete: true, credits: 0.2 }));
  });

  it('a stranger-triggered action is "automatic" (FR-10)', async () => {
    const { deps } = makeDeps({ rows: [charge(1, { action_type: 'lead_reply_recommendation', triggered_by: 'external' })] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.lines[0]).toEqual(expect.objectContaining({ who: 'automatic', area: 'leads' }));
  });

  it('another service is counted, with no area and no label ("Other activity"; AC-35)', async () => {
    const rows = [charge(1, { service: 'notification_email', action_type: 'chat_turn', credits: '0.050000' }), charge(2)];
    const { deps } = makeDeps({ rows });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.lines[1]).toEqual(expect.objectContaining({ area: null, label: null, who: 'you', credits: 0.05 }));
    expect(page.summary?.used).toBeCloseTo(2.15, 6);
  });

  it('a correction is its own signed line under the service, area and trigger of its charge — even when the charge is on a later page', async () => {
    const original = charge(1, { action_type: 'image_generation', triggered_by: 'scheduled', credits: '250.000000' });
    const fillers = Array.from({ length: CREDIT_HISTORY_PAGE_SIZE }, (_, i) => charge(10 + i));
    const fix = correction(original, 200, '-12.500000');
    const { deps, ledger } = makeDeps({ rows: [original, ...fillers, fix] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);

    expect(page.lines[0]).toEqual(
      expect.objectContaining({
        id: fix.id,
        isCorrection: true,
        area: 'images',
        label: AI_ACTION_DECLARATIONS.image_generation.diaryLabels,
        who: 'automatic',
        didNotComplete: false,
        credits: -12.5,
      })
    );
    expect(page.lines.map((l) => l.id)).not.toContain(original.id);
    expect(ledger.findChargesByActionIds).toHaveBeenCalledWith(USER, [original.action_id]);
  });

  it('a correction whose charge is on the same page is resolved without another read', async () => {
    const original = charge(1);
    const fix = correction(original, 2, '-0.100000');
    const { deps, ledger } = makeDeps({ rows: [original, fix] });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    expect(page.lines[0]).toEqual(expect.objectContaining({ isCorrection: true, who: 'you', area: 'chat' }));
    expect(ledger.findChargesByActionIds).not.toHaveBeenCalled();
  });

  it('a correction with no resolvable charge is still a line, still counted, with nothing guessed', async () => {
    const ghost = charge(1);
    const fix = correction(ghost, 2, '-1.000000');
    const { deps } = makeDeps({ rows: [fix] });
    const log = makeLog();
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, log)).data);
    expect(page.lines[0]).toEqual(expect.objectContaining({ isCorrection: true, area: null, label: null, who: null, credits: -1 }));
    expect(page.summary?.used).toBe(-1);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ unresolved: 1 }), expect.any(String));
  });
});

describe('paging (SA SQ-29)', () => {
  it('50 a page, newest first, summary on the first page only, no repeat and no skip', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => charge(i));
    const { deps } = makeDeps({ rows });
    const pages = await allPages(deps);

    expect(pages.map((p) => p.lines.length)).toEqual([50, 50, 20]);
    expect(pages[0].summary).toBeDefined();
    expect(pages[1].summary).toBeUndefined();
    expect(pages[2].summary).toBeUndefined();
    const ids = pages.flatMap((p) => p.lines.map((l) => l.id));
    expect(ids).toEqual([...rows].sort(newestFirst).map((r) => r.id));
  });

  it('the cursor carries the window tag and the last row\'s created_at and id as exact strings', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => charge(i));
    const { deps } = makeDeps({ rows });
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    const last = [...rows].sort(newestFirst)[49];
    expect(decodeHistoryCursor(page.nextCursor)).toEqual({ w: `m:${PERIOD}`, t: last.created_at, i: last.id });
  });

  it('a cursor for another window is answered { restart: true } without reading the ledger', async () => {
    const { deps, ledger } = makeDeps({ rows: [charge(1)] });
    for (const w of [`m:${PREVIOUS_PERIOD}`, `t:${PERIOD}`]) {
      const stale = decodeHistoryCursor(encodeHistoryCursor({ w, t: '2026-09-20T00:00:00.000001+00:00', i: '00000000-0000-4000-8000-000000000001' }));
      const result = await readOwnerCreditHistory(USER, stale, deps, makeLog());
      expect(result.data).toEqual({ restart: true });
    }
    expect(ledger.listLedgerRowsForWindow).not.toHaveBeenCalled();
  });

  it('the period rolled over between pages: restart', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => charge(i));
    const { deps } = makeDeps({ rows });
    const first = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    const next = makeDeps({ rows, periodStartFor: '2026-10-14T09:31:07.123456+00:00' }).deps;
    const result = await readOwnerCreditHistory(USER, decodeHistoryCursor(first.nextCursor), next, makeLog());
    expect(result.data).toEqual({ restart: true });
  });
});

describe('reconciliation (AC-38: proven by tests, not checked at runtime — SA C-S7-3)', () => {
  it('over all pages, the exact sum of the lines equals the card\'s used — charges, a failure, a correction across pages, another service', async () => {
    const original = charge(0, { action_type: 'image_generation', credits: '250.000000' });
    const rows = [
      original,
      ...Array.from({ length: 70 }, (_, i) => charge(1 + i, { credits: (0.016 + i * 0.37).toFixed(6), triggered_by: i % 3 ? 'owner' : 'scheduled' })),
      charge(80, { outcome: 'failed', credits: '0.200000' }),
      charge(81, { service: 'notification_email', action_type: 'email_sent', credits: '0.080000' }),
      correction(original, 90, '-12.500000'),
      charge(95, { period_start: PREVIOUS_PERIOD, credits: '999.000000' }), // another period: not in this window
    ];
    const { deps } = makeDeps({ rows });
    const card = (await readOwnerCreditUsage(USER, deps, makeLog())).data!;
    const pages = await allPages(deps);
    const lines = pages.flatMap((p) => p.lines);
    const micro = (n: number) => Math.round(n * 1e6);

    expect(lines).toHaveLength(rows.length - 1);
    expect(lines.reduce((sum, l) => sum + micro(l.credits), 0)).toBe(micro(card.used));
    expect(pages[0].summary!.used).toBe(card.used);
  });

  it('the same for a trial window spanning two periods', async () => {
    const rows = [charge(1), charge(2, { period_start: '2026-10-14T09:31:07.123456+00:00', credits: '3.300000' })];
    const { deps } = makeDeps({ rows, allowance: TRIAL });
    const card = (await readOwnerCreditUsage(USER, deps, makeLog())).data!;
    const lines = (await allPages(deps)).flatMap((p) => p.lines);
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + Math.round(l.credits * 1e6), 0)).toBe(Math.round(card.used * 1e6));
  });
});

describe('failures are errors, never an empty history', () => {
  it.each([
    ['the rows read', { failRows: true }],
    ['the originals read', { failOriginals: true }],
  ])('%s', async (_name, over) => {
    const original = charge(1);
    const fillers = Array.from({ length: CREDIT_HISTORY_PAGE_SIZE }, (_, i) => charge(10 + i));
    const { deps } = makeDeps({ rows: [original, ...fillers, correction(original, 200, '-1')], ...over });
    const log = makeLog();
    const result = await readOwnerCreditHistory(USER, null, deps, log);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(log.error).toHaveBeenCalled();
  });

  it('an unreadable figure', async () => {
    const { deps } = makeDeps({ rows: [] });
    (deps.ledger.listLedgerRowsForWindow as jest.Mock).mockResolvedValueOnce({
      data: { rows: [charge(1, { credits: 'garbage' })], hasMore: false },
      error: null,
    });
    const result = await readOwnerCreditHistory(USER, null, deps, makeLog());
    expect(result.data).toBeNull();
  });

  it('the window', async () => {
    const { deps } = makeDeps({ rows: [] });
    deps.periodStartFor = async () => ({ data: null, error: new Error('rpc failed') });
    const result = await readOwnerCreditHistory(USER, null, deps, makeLog());
    expect(result.data).toBeNull();
  });
});

describe('the payload allow-list (SA SQ-38)', () => {
  const BANNED_SUBSTRING = /token|usd|cost|dollar|price|model|pilot|fallback|user_?id|account|action_?id|group|service|action_?type|reason|credit_value|version/i;
  const AI_SEGMENT = /(^|_)ai($|_|[A-Z])|[a-z]Ai($|[A-Z_])/;

  function keysOf(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => keysOf(item, `${prefix}[]`));
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      const here = prefix ? `${prefix}.${key}` : key;
      return [here, ...keysOf(child, here)];
    });
  }

  const LINE_KEYS = ['at', 'area', 'credits', 'didNotComplete', 'id', 'isCorrection', 'label', 'who'];
  const LABEL_KEYS = ['en', 'es', 'he'];

  async function firstPage() {
    const original = charge(1);
    const { deps } = makeDeps({ rows: [original, correction(original, 2, '-0.5'), charge(3, { service: 'notification_email' })] });
    return asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
  }

  it('the rules match planted violations first', () => {
    for (const key of ['aiCredits', 'costUsd', 'user_id', 'actionId', 'group_id', 'service', 'action_type', 'reason_code', 'credit_value_version', 'isFallbackPriced', 'model']) {
      expect(BANNED_SUBSTRING.test(key) || AI_SEGMENT.test(key)).toBe(true);
    }
  });

  it('the first page has exactly the allowed keys, recursively', async () => {
    const keys = [...new Set(keysOf(await firstPage()))].sort();
    expect(keys).toEqual(
      [
        'lines',
        ...LINE_KEYS.map((k) => `lines[].${k}`),
        ...LABEL_KEYS.map((k) => `lines[].label.${k}`),
        'nextCursor',
        'summary',
        'summary.period',
        'summary.period.endsBefore',
        'summary.period.kind',
        'summary.period.startsOn',
        'summary.used',
        'summary.usedAutomatic',
        'summary.usedByOwner',
      ].sort()
    );
  });

  it('a later page has no summary; a restart is one key', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => charge(i));
    const { deps } = makeDeps({ rows });
    const first = asPage((await readOwnerCreditHistory(USER, null, deps, makeLog())).data);
    const second = (await readOwnerCreditHistory(USER, decodeHistoryCursor(first.nextCursor), deps, makeLog())).data;
    expect(Object.keys(second!).sort()).toEqual(['lines', 'nextCursor']);
    expect(keysOf({ restart: true })).toEqual(['restart']);
  });

  it('no key names a banned word or "ai"', async () => {
    const segments = keysOf(await firstPage()).flatMap((k) => k.replace(/\[\]/g, '').split('.'));
    expect(segments.filter((s) => BANNED_SUBSTRING.test(s) || AI_SEGMENT.test(s))).toEqual([]);
  });

  it('no value carries a banned word, an account id or a raw identifier (label strings excepted)', async () => {
    const page = await firstPage();
    const withoutLabels = JSON.stringify({ ...page, lines: page.lines.map((l) => ({ ...l, label: null })) });
    expect(withoutLabels).not.toMatch(/token|usd|cost|dollar|price|model|pilot|fallback|notification_email|chat_turn|"ai"/i);
    expect(withoutLabels).not.toContain(USER);
    expect(withoutLabels).not.toMatch(/aaaaaaaa-0000/); // action ids
  });
});

describe('the emitted cursor is checked with its own decoder (SA CR7-3)', () => {
  it('a last row whose created_at the decoder would refuse ends paging cleanly: no cursor, an error log, the lines still shown', async () => {
    const { deps } = makeDeps({ rows: [] });
    const odd = charge(1, { created_at: '2026-09-20T07:00:00.123456+00' }); // "+00" without minutes
    (deps.ledger.listLedgerRowsForWindow as jest.Mock).mockResolvedValueOnce({
      data: { rows: [charge(2), odd], hasMore: true },
      error: null,
    });
    const log = makeLog();
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, log)).data);
    expect(page.lines).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'cursor_not_decodable' }),
      'Credit history cursor would not decode; paging ended at this page'
    );
  });

  it('a normal last row gives a cursor its own decoder accepts, and logs no error', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => charge(i));
    const { deps } = makeDeps({ rows });
    const log = makeLog();
    const page = asPage((await readOwnerCreditHistory(USER, null, deps, log)).data);
    expect(decodeHistoryCursor(page.nextCursor)).not.toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });
});
