/**
 * The admin AI Activity drill-down's builder (Gap B slice B2a). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B2_WORKPLAN.md § D and the
 * Test Plan (AC-B2, AC-B5, AC-B13, AC-B19 drill-down half; SA-B2-7, SA-B2-8,
 * SA-B2-9; OQ-9).
 *
 * Pinned: the only request-supplied key is the action id, and every second
 * read is keyed on the CHARGE ROW's account and grouping id; one NULL ("not
 * found") for an unknown id, an adjustment, a deleted account and a platform
 * account, with no second read; other accounts' charges, corrections and
 * audit entries never reach the payload; corrections listed and netted, a
 * later-period one included; the shared-group marker; and that the drawer's
 * opened charge equals the list row for the same charge (parity).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AI_ACTIVITY_DRILL_DOWN_LIMITS,
  AiActivityDrillDownReadError,
  buildAiActivityDrillDown,
  type AiActivityDrillDownDeps,
} from '../aiActivityDrillDown';
import { buildAiActivity, type AiActivityDeps } from '../aiActivity';
import type { AiActivityRow } from '../aiActivityTypes';
import type { AiActivityDrillDownCharge } from '../aiActivityDrillDownTypes';
import type { CreditLedgerPagedResult, CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { AdminAiActionEntriesPage, AdminAiActionEntryRow } from '@/lib/repositories/AuditTrailRepository';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_GROUP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-10-02T12:00:00.000Z');

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

let seq = 0;
function charge(user: string | null, cost: string, credits: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${String(seq).padStart(4, '0')}`,
    kind: 'charge',
    action_id: id(seq),
    adjusts_action_id: null,
    reason_code: null,
    user_id: user,
    period_start: '2026-09-29T00:00:00+00:00',
    group_id: GROUP,
    credits,
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-10-01T10:00:00+00:00',
    ...extra,
  };
}

function adjustment(user: string | null, adjusts: string, cost: string, credits: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${String(seq).padStart(4, '0')}`,
    kind: 'adjustment',
    action_id: null,
    adjusts_action_id: adjusts,
    reason_code: 'fallback_price_reconciled',
    user_id: user,
    period_start: '2026-09-29T00:00:00+00:00',
    group_id: null,
    credits,
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: null,
    action_type: null,
    triggered_by: null,
    outcome: null,
    created_at: '2026-10-01T11:00:00+00:00',
    ...extra,
  };
}

let entrySeq = 0;
function entry(user: string, actionId: string, details: Record<string, unknown> = {}, extra: Partial<AdminAiActionEntryRow> = {}): AdminAiActionEntryRow {
  entrySeq += 1;
  return {
    id: `entry-${String(entrySeq).padStart(3, '0')}`,
    user_id: user,
    created_at: '2026-10-01T09:59:59+00:00',
    entity_id: GROUP,
    details: {
      schema: 2,
      actionId,
      callCount: 2,
      failedCallCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      models: ['model-alpha', 'model-beta'],
      outcome: 'succeeded',
      ...details,
    },
    ...extra,
  };
}

const log = { error: jest.fn(), warn: jest.fn() };

/**
 * Typed against the REAL dependency signatures (SA-CR-1): each fake is a
 * `jest.Mock` of the member's own return and parameter types, so a change to
 * the repository's signature or result shape fails `typecheck:bos-llm` here
 * instead of passing silently through a cast.
 */
type Ledger = AiActivityDrillDownDeps['ledger'];
type Archive = AiActivityDrillDownDeps['archive'];
type FakeOf<F extends (...args: never[]) => unknown> = jest.Mock<ReturnType<F>, Parameters<F>>;

function fake<F extends (...args: never[]) => unknown>(impl: (...args: Parameters<F>) => ReturnType<F>): FakeOf<F> {
  return jest.fn<ReturnType<F>, Parameters<F>>(impl);
}

interface Seed {
  /** What the by-id read returns (the fake filters nothing: the builder must). */
  found?: CreditLedgerRow[];
  /** What the group read returns (the fake filters nothing: the builder must). */
  group?: CreditLedgerRow[];
  groupReachedCeiling?: boolean;
  adjustments?: CreditLedgerRow[];
  entries?: AdminAiActionEntryRow[];
  names?: { user_id: string; company_name: string | null }[];
}

function makeDeps(seed: Seed = {}) {
  const adjustmentsFor = (ids: readonly string[]): CreditLedgerPagedResult<CreditLedgerRow> => ({
    rows: (seed.adjustments ?? []).filter((a) => a.adjusts_action_id !== null && ids.includes(a.adjusts_action_id)),
    reachedCeiling: false,
  });
  const ledger: { [K in keyof Ledger]: FakeOf<Ledger[K]> } = {
    findChargesByActionIds: fake<Ledger['findChargesByActionIds']>(async () => ({ data: seed.found ?? [], error: null })),
    listChargesOfGroupForAccount: fake<Ledger['listChargesOfGroupForAccount']>(async () => ({
      data: { rows: seed.group ?? seed.found ?? [], reachedCeiling: seed.groupReachedCeiling ?? false },
      error: null,
    })),
    listAdjustmentsForActionIds: fake<Ledger['listAdjustmentsForActionIds']>(async (ids) => ({ data: adjustmentsFor(ids), error: null })),
  };
  const entriesPage: AdminAiActionEntriesPage = { rows: seed.entries ?? [], reachedLimit: false };
  const listAuditEntries = fake<AiActivityDrillDownDeps['listAuditEntries']>(async () => ({ data: entriesPage, error: null }));
  const archive: { [K in keyof Archive]: FakeOf<Archive[K]> } = {
    getLatestCutoff: fake<Archive['getLatestCutoff']>(async () => ({ data: null, error: null })),
    listRuns: fake<Archive['listRuns']>(async () => ({ data: [], error: null })),
  };
  const findNames = fake<AiActivityDrillDownDeps['findNames']>(async () => ({
    data: seed.names ?? [{ user_id: A, company_name: 'Alpha Studio' }],
    error: null,
  }));
  const deps: AiActivityDrillDownDeps = { ledger, findNames, listAuditEntries, archive, now: () => NOW };
  return { deps, ledger, findNames, listAuditEntries, archive };
}

/** The arguments of a fake's first call, typed as the real member's parameters. */
const firstCall = <R, P extends unknown[]>(mock: jest.Mock<R, P>): P => mock.mock.calls[0];

const noSecondRead = (fakes: ReturnType<typeof makeDeps>) => {
  expect(fakes.ledger.listChargesOfGroupForAccount).not.toHaveBeenCalled();
  expect(fakes.ledger.listAdjustmentsForActionIds).not.toHaveBeenCalled();
  expect(fakes.findNames).not.toHaveBeenCalled();
  expect(fakes.listAuditEntries).not.toHaveBeenCalled();
  expect(fakes.archive.getLatestCutoff).not.toHaveBeenCalled();
  expect(fakes.archive.listRuns).not.toHaveBeenCalled();
};

const openedOf = (charges: AiActivityDrillDownCharge[]) => {
  const opened = charges.filter((c) => c.opened);
  expect(opened).toHaveLength(1);
  return opened[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  entrySeq = 0;
});

describe('OQ-9: one "not found" for every case, with no second read', () => {
  it('an unknown action id', async () => {
    const fakes = makeDeps({ found: [] });
    expect(await buildAiActivityDrillDown(id(999), log, fakes.deps)).toBeNull();
    expect(firstCall(fakes.ledger.findChargesByActionIds)).toEqual([[id(999)]]);
    noSecondRead(fakes);
  });

  it("an adjustment's id, even if a read ever handed one back", async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const adj = adjustment(A, c1.action_id ?? '', '-0.0001000000', '-0.100000', { action_id: id(500) });
    const fakes = makeDeps({ found: [adj] });
    expect(await buildAiActivityDrillDown(id(500), log, fakes.deps)).toBeNull();
    noSecondRead(fakes);
  });

  it("a deleted account's charge (no account to scope a second read)", async () => {
    const orphan = charge(null, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [orphan] });
    expect(await buildAiActivityDrillDown(orphan.action_id ?? '', log, fakes.deps)).toBeNull();
    noSecondRead(fakes);
  });

  it("a platform account's charge (refused rather than assumed impossible)", async () => {
    const platform = charge(PLATFORM, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [platform] });
    expect(await buildAiActivityDrillDown(platform.action_id ?? '', log, fakes.deps)).toBeNull();
    noSecondRead(fakes);
  });

  it('a row that is not a live charge (an unknown trigger) is refused and logged with ids only', async () => {
    const odd = charge(A, '0.0010000000', '1.000000', { triggered_by: 'cron' });
    const fakes = makeDeps({ found: [odd] });
    expect(await buildAiActivityDrillDown(odd.action_id ?? '', log, fakes.deps)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith({ actionId: odd.action_id, read: 'drill-down charge' }, expect.any(String));
    noSecondRead(fakes);
  });
});

describe('the charge read itself', () => {
  it('a failed read throws the read error (the route answers 500, never 404)', async () => {
    const fakes = makeDeps();
    fakes.ledger.findChargesByActionIds.mockResolvedValueOnce({ data: null, error: new Error('down') });
    await expect(buildAiActivityDrillDown(id(1), log, fakes.deps)).rejects.toBeInstanceOf(AiActivityDrillDownReadError);
    noSecondRead(fakes);
  });

  it('a synchronous throw is a read error too', async () => {
    const fakes = makeDeps();
    fakes.ledger.findChargesByActionIds.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(buildAiActivityDrillDown(id(1), log, fakes.deps)).rejects.toBeInstanceOf(AiActivityDrillDownReadError);
  });

  it('SA-B2-8: an upper-case id is looked up lower-case, and the opened charge is flagged once, not added twice', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [c1] });
    const payload = await buildAiActivityDrillDown((c1.action_id ?? '').toUpperCase(), log, fakes.deps);
    expect(firstCall(fakes.ledger.findChargesByActionIds)).toEqual([[c1.action_id]]);
    expect(payload?.actionId).toBe(c1.action_id);
    expect(payload?.group.charges).toHaveLength(1);
    expect(openedOf(payload?.group.charges ?? []).actionId).toBe(c1.action_id);
  });
});

describe('SA-RC-11: every second read is keyed on the CHARGE ROW, never the request', () => {
  it('the group read takes the charge account and its lower-cased grouping id; names and audit follow the row', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000', { group_id: GROUP.toUpperCase() });
    const fakes = makeDeps({ found: [c1], group: [c1] });
    await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);

    expect(firstCall(fakes.ledger.listChargesOfGroupForAccount)).toEqual([
      A,
      GROUP,
      { pageSize: AI_ACTIVITY_DRILL_DOWN_LIMITS.GROUP_CHARGES_PAGE_SIZE, ceiling: AI_ACTIVITY_DRILL_DOWN_LIMITS.GROUP_CHARGES_CEILING },
    ]);
    expect(firstCall(fakes.findNames)).toEqual([[A]]);
    const [groupIds, window] = firstCall(fakes.listAuditEntries);
    expect(groupIds).toEqual([GROUP]);
    expect(window).toEqual({ start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T11:00:00.000Z' });
    expect(firstCall(fakes.ledger.listAdjustmentsForActionIds)).toEqual([[c1.action_id]]);
    expect(firstCall(fakes.archive.getLatestCutoff)).toEqual(['audit_trail']);
  });

  it('the account in the payload is the charge account', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1] }).deps);
    expect(payload?.account).toEqual({ accountId: A, companyName: 'Alpha Studio' });
    expect(payload?.names).toBe('ok');
  });
});

describe('AC-B5: another account never reaches the payload', () => {
  it('a group row of another account (or another group) is dropped, counted and never sent, even if the read returns it', async () => {
    const mine = charge(A, '0.0010000000', '1.000000');
    const theirs = charge(B, '0.0099000000', '9.900000', { action_type: 'marker_other_account_type' });
    const elsewhere = charge(A, '0.0088000000', '8.800000', { group_id: OTHER_GROUP, action_type: 'marker_other_group_type' });
    const adjustmentRow = adjustment(A, mine.action_id ?? '', '-0.0001000000', '-0.100000', { group_id: GROUP });
    const fakes = makeDeps({ found: [mine], group: [mine, theirs, elsewhere, adjustmentRow] });
    const payload = await buildAiActivityDrillDown(mine.action_id ?? '', log, fakes.deps);

    expect(payload?.group.charges.map((c) => c.actionId)).toEqual([mine.action_id]);
    expect(payload?.group).toMatchObject({ chargedActions: 1, shared: false });
    expect(log.warn).toHaveBeenCalledWith(
      { actionId: mine.action_id, dropped: 3, read: 'drill-down group' },
      expect.stringContaining('dropped')
    );
    const json = JSON.stringify(payload);
    for (const marker of ['marker_other_account_type', 'marker_other_group_type', theirs.action_id ?? '', B, '0.0099', '9.9']) {
      expect(json).not.toContain(marker);
    }
    // Adjustments are read for the KEPT charges only.
    expect(firstCall(fakes.ledger.listAdjustmentsForActionIds)).toEqual([[mine.action_id]]);
  });

  it("another account's audit entry for the same action is counted, never sent; the own entry is found", async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const foreign = entry(B, c1.action_id ?? '', { callCount: 987654, models: ['marker-foreign-model'], errorCode: 'MARKER_FOREIGN' });
    const fakes = makeDeps({ found: [c1], entries: [foreign, entry(A, c1.action_id ?? '')] });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);

    expect(openedOf(payload?.group.charges ?? []).entry).toMatchObject({ state: 'found', callCount: 2 });
    expect(payload?.audit.noEntry.accountMismatch).toBe(1);
    const json = JSON.stringify(payload);
    for (const marker of ['987654', 'marker-foreign-model', 'MARKER_FOREIGN', foreign.id, B]) expect(json).not.toContain(marker);
  });

  it("only another account has the entry: the charge is an account_mismatch, with neither account's entry fields", async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const foreign = entry(B, c1.action_id ?? '', { callCount: 987654 });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], entries: [foreign] }).deps);
    expect(openedOf(payload?.group.charges ?? []).entry).toEqual({ state: 'account_mismatch' });
    expect(JSON.stringify(payload)).not.toContain('987654');
  });

  it('a correction on another account is counted, never listed or netted', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const foreign = adjustment(B, c1.action_id ?? '', '-0.0019999999', '-1.999999', { reason_code: 'marker_foreign_reason' });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], adjustments: [foreign] }).deps);
    const opened = openedOf(payload?.group.charges ?? []);
    expect(opened).toMatchObject({ costUsd: { gross: 0.002, net: 0.002 }, corrected: false, adjustments: [] });
    expect(payload?.unresolvedAdjustments).toBe(1);
    const json = JSON.stringify(payload);
    for (const marker of ['marker_foreign_reason', foreign.id, '1.999999']) expect(json).not.toContain(marker);
  });
});

describe('the group and the shared-group marker (FR-B2, OQ-10)', () => {
  it('two charged actions of one account in one group: shared, both listed newest first, the opened one flagged', async () => {
    const first = charge(A, '0.0010000000', '1.000000', { created_at: '2026-10-01T10:00:00+00:00' });
    const second = charge(A, '0.0030000000', '3.000000', { created_at: '2026-10-01T10:05:00+00:00', action_type: 'website_copy' });
    const fakes = makeDeps({
      found: [first],
      group: [first, second],
      entries: [entry(A, first.action_id ?? '', { callCount: 1 }), entry(A, second.action_id ?? '', { callCount: 7 })],
    });
    const payload = await buildAiActivityDrillDown(first.action_id ?? '', log, fakes.deps);

    expect(payload?.group).toMatchObject({ groupId: GROUP, status: 'ok', chargedActions: 2, shared: true, atLeast: false });
    expect(payload?.group.charges.map((c) => [c.actionId, c.opened])).toEqual([
      [second.action_id, false],
      [first.action_id, true],
    ]);
    // Each charge joins its OWN entry by actionId.
    expect(payload?.group.charges.map((c) => (c.entry.state === 'found' ? c.entry.callCount : null))).toEqual([7, 1]);
    // No per-charge call figure exists: calls are never attributed to one action.
    expect(Object.keys(payload?.group.charges[0] ?? {})).not.toContain('calls');
  });

  it('a group read cut at its ceiling without the opened charge: the charge is added, and the count is "at least"', async () => {
    const opened = charge(A, '0.0010000000', '1.000000', { created_at: '2026-10-01T09:00:00+00:00' });
    const newer = charge(A, '0.0010000000', '1.000000', { created_at: '2026-10-01T10:00:00+00:00' });
    const payload = await buildAiActivityDrillDown(
      opened.action_id ?? '',
      log,
      makeDeps({ found: [opened], group: [newer], groupReachedCeiling: true }).deps
    );
    expect(payload?.group).toMatchObject({ chargedActions: 2, shared: true, atLeast: true });
    expect(payload?.group.charges.map((c) => c.actionId)).toEqual([newer.action_id, opened.action_id]);
  });

  it('a failed group read shows the opened charge alone and says so', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [c1] });
    fakes.ledger.listChargesOfGroupForAccount.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);
    expect(payload?.group).toMatchObject({ status: 'failed', chargedActions: 1, shared: false });
    expect(openedOf(payload?.group.charges ?? []).actionId).toBe(c1.action_id);
    expect(log.error).toHaveBeenCalled();
  });

  it('a charge with no grouping id makes no group read and no audit read, and the drawer still opens', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000', { group_id: null });
    const fakes = makeDeps({ found: [c1] });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);
    expect(fakes.ledger.listChargesOfGroupForAccount).not.toHaveBeenCalled();
    expect(fakes.listAuditEntries).not.toHaveBeenCalled();
    expect(payload?.group).toMatchObject({ groupId: '', status: 'failed', chargedActions: 1 });
    expect(payload?.audit.status).toBe('failed');
  });
});

describe('AC-B19 (drill-down half): corrections listed and netted', () => {
  it('a correction written in a later period is listed under its charge and netted into it', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000', { is_fallback_priced: true });
    const late = adjustment(A, c1.action_id ?? '', '-0.0005000000', '-0.500000', {
      created_at: '2026-12-15T00:00:00+00:00',
      period_start: '2026-12-01T00:00:00+00:00',
    });
    const early = adjustment(A, c1.action_id ?? '', '-0.0001000000', '-0.100000', { reason_code: 'manual_correction' });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], adjustments: [late, early] }).deps);
    const opened = openedOf(payload?.group.charges ?? []);
    expect(opened).toMatchObject({
      costUsd: { gross: 0.002, net: 0.0014 },
      credits: { gross: 2, net: 1.4 },
      corrected: true,
      adjustmentCount: 2,
      reasonCodes: ['fallback_price_reconciled', 'manual_correction'],
      isFallbackPriced: true,
    });
    // Oldest first, as dated.
    expect(opened.adjustments).toEqual([
      { createdAt: early.created_at, reasonCode: 'manual_correction', costUsd: -0.0001, credits: -0.1 },
      { createdAt: '2026-12-15T00:00:00+00:00', reasonCode: 'fallback_price_reconciled', costUsd: -0.0005, credits: -0.5 },
    ]);
    expect(payload?.adjustments).toBe('ok');
  });

  it('corrections that cannot be read: no net figure and no listed correction, and the payload says so', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const fakes = makeDeps({ found: [c1], adjustments: [adjustment(A, c1.action_id ?? '', '-0.001', '-1')] });
    fakes.ledger.listAdjustmentsForActionIds.mockResolvedValueOnce({ data: { rows: [], reachedCeiling: true }, error: null });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);
    expect(payload?.adjustments).toBe('failed');
    expect(openedOf(payload?.group.charges ?? [])).toMatchObject({ costUsd: { gross: 0.002, net: null }, adjustments: [] });
  });

  it('reads the corrections of a large group in chunks of at most 200 ids', async () => {
    const rows = Array.from({ length: 201 }, (_, i) =>
      charge(A, '0.0010000000', '1.000000', { created_at: new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString() })
    );
    const fakes = makeDeps({ found: [rows[0]], group: rows });
    await buildAiActivityDrillDown(rows[0].action_id ?? '', log, fakes.deps);
    expect(fakes.ledger.listAdjustmentsForActionIds.mock.calls.map(([ids]) => ids.length)).toEqual([200, 1]);
  });

  it('an unreadable correction amount is counted once, not once per use', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const bad = adjustment(A, c1.action_id ?? '', 'not-a-number', '-0.100000');
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], adjustments: [bad] }).deps);
    expect(payload?.unreadableAmounts).toBe(1);
  });
});

describe('AC-B13: the entry projection is the B1b allow-list (OQ-12)', () => {
  it('no prompt, owner text, output, error message or email reaches the payload; a free-text code is dropped', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000', { outcome: 'failed' });
    const leaky = entry(A, c1.action_id ?? '', {
      prompt: 'MARKER_PROMPT_7f3a',
      ownerText: 'MARKER_OWNER_TEXT_7f3a',
      output: 'MARKER_OUTPUT_7f3a',
      errorMessage: 'MARKER_ERROR_MESSAGE_7f3a',
      user_email: 'marker-owner@example.com',
      errorCode: 'connection reset by MARKER_FREE_TEXT',
      estimatedCostUsd: 0.123456789,
    });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], entries: [leaky] }).deps);
    expect(openedOf(payload?.group.charges ?? []).entry).toEqual({
      state: 'found',
      callCount: 2,
      failedCallCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      models: ['model-alpha', 'model-beta'],
      errorCode: null,
    });
    const json = JSON.stringify(payload);
    for (const marker of ['MARKER_PROMPT', 'MARKER_OWNER_TEXT', 'MARKER_OUTPUT', 'MARKER_ERROR_MESSAGE', 'marker-owner@example.com', 'MARKER_FREE_TEXT', '0.123456789']) {
      expect(json).not.toContain(marker);
    }
  });

  it('a failed audit read: every charge unknown, never lost; the drawer still opens', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [c1] });
    fakes.listAuditEntries.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);
    expect(openedOf(payload?.group.charges ?? []).entry).toEqual({ state: 'unknown', reason: 'audit_read_failed' });
    expect(payload?.audit.status).toBe('failed');
  });

  it('a failed name lookup fails only the name', async () => {
    const c1 = charge(A, '0.0010000000', '1.000000');
    const fakes = makeDeps({ found: [c1] });
    fakes.findNames.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivityDrillDown(c1.action_id ?? '', log, fakes.deps);
    expect(payload).toMatchObject({ names: 'failed', account: { accountId: A, companyName: null } });
  });
});

describe('SA-B2-7: the drawer and the list cannot disagree about one action', () => {
  it("the opened charge deep-equals the list row on every shared field (one charge, two corrections, its entry)", async () => {
    const c1 = charge(A, '0.0040000000', '4.000000', { is_fallback_priced: true, action_type: 'website_copy', triggered_by: 'scheduled' });
    // QA-B2a-1: the reason codes ARRIVE in non-alphabetical order, so both
    // sides must sort them to agree; an unsorted side turns this red.
    const adj = adjustment(A, c1.action_id ?? '', '-0.0004000000', '-0.400000', { reason_code: 'manual_correction' });
    const adj2 = adjustment(A, c1.action_id ?? '', '-0.0001000000', '-0.100000', { reason_code: 'fallback_price_reconciled' });
    const e1 = entry(A, c1.action_id ?? '', { callCount: 3, errorCode: 'RATE_LIMITED' });

    // The list builder over the same rows.
    type ListLedger = AiActivityDeps['ledger'];
    const listFakes = makeDeps({ found: [c1], adjustments: [adj, adj2], entries: [e1] });
    const listDeps: AiActivityDeps = {
      ledger: {
        listChargesAllAccountsInWindow: fake<ListLedger['listChargesAllAccountsInWindow']>(async () => ({
          data: { rows: [c1], total: 1 },
          error: null,
        })),
        listChargesForAccountInWindow: fake<ListLedger['listChargesForAccountInWindow']>(async () => ({
          data: { rows: [c1], total: 1 },
          error: null,
        })),
        listAdjustmentsForActionIds: listFakes.ledger.listAdjustmentsForActionIds,
        listChargesOfDeletedAccountsInWindow: fake<ListLedger['listChargesOfDeletedAccountsInWindow']>(async () => ({
          data: { rows: [], reachedCeiling: false, total: 0 },
          error: null,
        })),
      },
      findNames: listFakes.findNames,
      listAuditEntries: listFakes.listAuditEntries,
      archive: listFakes.archive,
      now: () => NOW,
    };
    const list = await buildAiActivity(
      {
        window: { from: '2026-10-01', to: '2026-10-02' },
        accountId: A,
        area: null,
        outcome: null,
        trigger: null,
        minCostUsd: null,
        sort: 'time',
        limit: 100,
      },
      log,
      listDeps
    );
    const drawer = await buildAiActivityDrillDown(c1.action_id ?? '', log, makeDeps({ found: [c1], adjustments: [adj, adj2], entries: [e1] }).deps);

    const listRow: AiActivityRow = list.rows[0];
    const opened = openedOf(drawer?.group.charges ?? []);
    const shared = {
      actionId: opened.actionId,
      createdAt: opened.createdAt,
      area: opened.area,
      actionType: opened.actionType,
      trigger: opened.trigger,
      outcome: opened.outcome,
      costUsd: opened.costUsd,
      credits: opened.credits,
      isFallbackPriced: opened.isFallbackPriced,
      corrected: opened.corrected,
      adjustmentCount: opened.adjustmentCount,
      reasonCodes: opened.reasonCodes,
      entry: opened.entry,
      accountId: drawer?.account.accountId,
      companyName: drawer?.account.companyName,
      groupId: drawer?.group.groupId,
    };
    // Every field of the list row, compared: a field added to one side only fails here.
    expect(shared).toEqual(listRow);
    // And the test is not vacuous: the shared fields carry a correction, a fallback price and a found entry.
    expect(opened).toMatchObject({
      corrected: true,
      adjustmentCount: 2,
      reasonCodes: ['fallback_price_reconciled', 'manual_correction'],
      isFallbackPriced: true,
      entry: { state: 'found', callCount: 3 },
    });
  });
});

describe('SA-B2-9, by source', () => {
  const codeOf = (rel: string) =>
    fs
      .readFileSync(path.join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const CAST = /\bas\s+(?!const\b)[A-Za-z_]/;

  it('the cast rule matches a planted cast, so a clean file means something', () => {
    expect(CAST.test('pageRows.push(row as PageCharge);')).toBe(true);
    expect(CAST.test('} as const;')).toBe(false);
  });

  it.each(['lib/business-os/credits/aiActivityDrillDown.ts', 'lib/business-os/credits/aiActivityDrillDownDeps.ts'])(
    '%s narrows with type guards, never a cast, and never reads a row service',
    (rel) => {
      const code = codeOf(rel);
      expect(code).not.toMatch(CAST);
      expect(code).not.toMatch(/\.service\b/);
    }
  );
});
