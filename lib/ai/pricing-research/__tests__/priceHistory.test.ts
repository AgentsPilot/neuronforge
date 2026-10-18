/**
 * The per-model price history builder (AI model price review slice 9;
 * workplan §2.3, §2.4; SA SC9-2, SC9-5, SC9-6, SC9-7, SC9-10, SC9-11).
 * Pure: every read is a fixture. Fixtures reproduce the production shapes
 * read at T-0 (2026-10-18): the runbook row `549fcc6e-…`, a slice 2 clean-up
 * duplicate, and pre-review rows with and without old audit entries.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: (...args: unknown[]) => mockWarn(...args), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  CLEANUP_RETIRED_ON,
  PriceHistoryReadError,
  RUNBOOK_ERA_STARTS_AT,
  buildPriceHistory,
  loadPriceHistory,
  type PriceHistoryDeps,
  type PriceHistoryInputs,
} from '../priceHistory';
import { PriceHistoryDataSchema, type PriceHistoryRow } from '../priceHistorySchema';
import type { AdminPricingRowEvent, AdminPricingSyncRun } from '@/lib/repositories/AuditTrailRepository';
import type {
  AiModelImagePricingHistoryRow,
  AiModelPricingHistoryRow,
  AiPriceApplyBatchRecord,
  AiPriceAppliedLineRecord,
} from '@/lib/repositories/types';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const SYSTEM = '99999999-9999-4999-8999-999999999999';
const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_GONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOT_LISTED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUNBOOK_ROW = '549fcc6e-3f63-4d06-b959-71c77759a12e';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function token(over: Partial<AiModelPricingHistoryRow>): AiModelPricingHistoryRow {
  return {
    id: uuid(1),
    provider: 'openai',
    model_name: 'gpt-4o-mini',
    input_cost_per_token: '0.00000015',
    output_cost_per_token: '0.0000006',
    cached_input_cost_per_token: null,
    effective_date: '2026-06-29',
    retired_date: null,
    created_at: '2026-06-29T10:00:00+00:00',
    proposal_id: null,
    proposal_line_id: null,
    ...over,
  };
}

function image(over: Partial<AiModelImagePricingHistoryRow>): AiModelImagePricingHistoryRow {
  return {
    id: uuid(50),
    provider: 'openai',
    model_name: 'gpt-image-1-mini',
    size: '1024x1024',
    quality: 'low',
    cost_per_image: '0.005',
    effective_date: '2026-10-01',
    retired_date: null,
    created_at: '2026-10-01T10:00:00+00:00',
    proposal_id: null,
    proposal_line_id: null,
    ...over,
  };
}

function line(over: Partial<AiPriceAppliedLineRecord>): AiPriceAppliedLineRecord {
  return {
    id: uuid(900),
    proposal_id: uuid(800),
    kind: 'token',
    image_size: null,
    image_quality: null,
    input_per_1m: '0.15',
    output_per_1m: '0.6',
    cached_input_per_1m: null,
    price_per_image: null,
    source_url: 'https://developers.openai.com/api/docs/pricing',
    checked_on: '2026-10-17',
    state: 'applied',
    decided_by: ADMIN_A,
    decided_at: '2026-10-18T09:00:00+00:00',
    decision_reason: 'Provider price change',
    override_reason: null,
    apply_batch_id: uuid(700),
    created_by: ADMIN_GONE,
    created_at: '2026-10-17T09:00:00+00:00',
    ai_price_proposals: { source_kind: 'manual' },
    ...over,
  };
}

function batch(over: Partial<AiPriceApplyBatchRecord>): AiPriceApplyBatchRecord {
  return {
    id: uuid(700),
    applied_by: ADMIN_A,
    applied_at: '2026-10-18T09:00:00+00:00',
    line_count: 3,
    margin_review_needed: false,
    margin_review_done: false,
    margin_review_by: null,
    margin_review_at: null,
    margin_review_note: null,
    ...over,
  };
}

function event(over: Partial<AdminPricingRowEvent>): AdminPricingRowEvent {
  return {
    id: 'ev-1',
    action: 'AI_PRICING_CREATED',
    actor_id: ADMIN_A,
    user_id: ADMIN_A,
    created_at: '2026-09-25T10:00:00+00:00',
    entity_id: uuid(1),
    changes: null,
    details: { input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006 },
    ...over,
  };
}

function inputs(over: Partial<PriceHistoryInputs>): PriceHistoryInputs {
  return {
    query: { kind: 'token', provider: 'openai', model: 'gpt-4o-mini' },
    now: NOW,
    tokenRows: [],
    imageRows: [],
    truncated: false,
    lines: [],
    batches: [],
    events: [],
    auditTruncated: false,
    syncRuns: [],
    syncTruncated: false,
    emailByUserId: new Map([
      [ADMIN_A, 'a@example.com'],
      // A deactivated admin: the lookup includes inactive rows (BQ-9a), so the email is in the map.
      [ADMIN_GONE, 'gone@example.com'],
    ]),
    systemActorIds: [SYSTEM, '00000000-0000-0000-0000-000000000000'],
    inputOnly: false,
    ...over,
  };
}

function rowsOf(over: Partial<PriceHistoryInputs>): PriceHistoryRow[] {
  const data = buildPriceHistory(inputs(over));
  expect(PriceHistoryDataSchema.safeParse(data).success).toBe(true);
  return data.units.flatMap((unit) => unit.rows);
}

beforeEach(() => mockWarn.mockClear());

describe('cut-over constants (SA O-2)', () => {
  it('are pinned to the slice 6 merge and the slice 2 clean-up date', () => {
    expect(RUNBOOK_ERA_STARTS_AT).toBe('2026-10-16T18:52:20Z');
    expect(CLEANUP_RETIRED_ON).toBe('2026-10-11');
  });
});

describe('A1 applied', () => {
  const applied = token({ id: uuid(2), effective_date: '2026-10-18', created_at: '2026-10-18T09:00:00+00:00', proposal_id: uuid(800), proposal_line_id: uuid(900) });

  it('names who applied, why, the source, who entered it and how; margin not needed', () => {
    const [row] = rowsOf({ tokenRows: [applied], lines: [line({})], batches: [batch({})] });
    expect(row.provenance).toEqual({
      kind: 'applied',
      appliedBy: { kind: 'admin', email: 'a@example.com' },
      appliedAt: '2026-10-18T09:00:00+00:00',
      reason: 'Provider price change',
      overrideReason: null,
      sourceUrl: 'https://developers.openai.com/api/docs/pricing',
      checkedOn: '2026-10-17',
      enteredBy: { kind: 'admin', email: 'gone@example.com' },
      entrySource: 'manual',
      batch: { lineCount: 3, marginReview: 'not_needed', reviewedBy: null, reviewedAt: null, reviewNote: null },
    });
    expect(row.preReviewNote).toBe(false);
    expect(row.syncRuns).toEqual([]);
  });

  it('with an override reason, by a provider check, margin open', () => {
    const [row] = rowsOf({
      tokenRows: [applied],
      lines: [line({ override_reason: 'Flag checked by hand', ai_price_proposals: { source_kind: 'fetch' } })],
      batches: [batch({ margin_review_needed: true })],
    });
    expect(row.provenance).toMatchObject({ overrideReason: 'Flag checked by hand', entrySource: 'fetch', batch: { marginReview: 'open' } });
  });

  it('margin review done, by whom, when and the note', () => {
    const [row] = rowsOf({
      tokenRows: [applied],
      lines: [line({})],
      batches: [batch({ margin_review_needed: true, margin_review_done: true, margin_review_by: ADMIN_A, margin_review_at: '2026-10-18T10:00:00Z', margin_review_note: 'Plans fine' })],
    });
    expect(row.provenance).toMatchObject({
      batch: { marginReview: 'done', reviewedBy: { kind: 'admin', email: 'a@example.com' }, reviewedAt: '2026-10-18T10:00:00Z', reviewNote: 'Plans fine' },
    });
  });
});

describe('A2 record missing never falls through', () => {
  it.each([
    ['the line is absent', []],
    ['the line is not applied', [line({ state: 'dismissed' })]],
  ])('%s', (_label, lines) => {
    // Created after the runbook cut-over, and with an audit entry: still not a guess.
    const row = token({ id: uuid(3), created_at: '2026-10-17T00:00:00Z', proposal_id: uuid(800), proposal_line_id: uuid(900) });
    const [built] = rowsOf({ tokenRows: [row], lines, events: [event({ entity_id: uuid(3) })] });
    expect(built.provenance).toEqual({ kind: 'provenance_missing' });
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ rowId: uuid(3), lineId: uuid(900) }), expect.any(String));
  });
});

describe('R runbook (SA SC9-10)', () => {
  it('at the exact cut-over instant is the runbook; one second before is pre-review', () => {
    const at = token({ id: uuid(4), created_at: '2026-10-16T18:52:20Z' });
    const before = token({ id: uuid(5), created_at: '2026-10-16T18:52:19Z', model_name: 'gpt-4o-mini' });
    expect(rowsOf({ tokenRows: [at] })[0]).toMatchObject({ provenance: { kind: 'runbook' }, preReviewNote: false });
    expect(rowsOf({ tokenRows: [before] })[0]).toMatchObject({ provenance: { kind: 'none' }, preReviewNote: true });
  });

  it('never for an image row, never for a null created_at', () => {
    const img = image({ created_at: '2026-10-17T00:00:00Z' });
    const built = rowsOf({ query: { kind: 'image', provider: 'openai', model: 'gpt-image-1-mini' }, imageRows: [img] });
    expect(built[0].provenance).toEqual({ kind: 'none' });
    const noDate = rowsOf({ tokenRows: [token({ created_at: null })] })[0];
    expect(noDate).toMatchObject({ provenance: { kind: 'none' }, preReviewNote: true, createdAt: null });
  });

  it('production shape: the runbook row replaced a pre-review row the same day', () => {
    const runbook = token({ id: RUNBOOK_ROW, model_name: 'text-embedding-3-small', effective_date: '2026-10-16', created_at: '2026-10-16 19:56:29.842154+00', input_cost_per_token: '0.00000002', output_cost_per_token: '0' });
    const old = token({ id: uuid(6), model_name: 'text-embedding-3-small', effective_date: '2026-06-29', retired_date: '2026-10-16', input_cost_per_token: '0.00000002', output_cost_per_token: '0' });
    const [now, was] = rowsOf({ query: { kind: 'token', provider: 'openai', model: 'text-embedding-3-small' }, tokenRows: [runbook, old], inputOnly: true });
    expect(now).toMatchObject({ rowId: RUNBOOK_ROW, status: 'current', provenance: { kind: 'runbook' }, replacedOn: null, retirement: null });
    expect(now.prices).toMatchObject({ inputPer1m: '0.02', outputPer1m: '0', storedAsZero: false });
    expect(was).toMatchObject({ status: 'retired', replacedOn: '2026-10-16', neverCharged: false, retirement: { kind: 'replaced' }, provenance: { kind: 'none' } });
  });
});

describe('P1 old audit and P2 no record', () => {
  it('lists created, updated and zero_set newest first, with values per 1M as recorded', () => {
    const events = [
      event({ id: 'e3', action: 'AI_PRICING_ZERO_SET', created_at: '2026-09-27T00:00:00Z', details: { input_cost_per_token: 0, output_cost_per_token: 0 } }),
      event({
        id: 'e2',
        action: 'AI_PRICING_UPDATED',
        created_at: '2026-09-26T00:00:00Z',
        details: { fields_updated: ['input_cost_per_token'] },
        changes: { before: { input_cost_per_token: 7.5e-8, output_cost_per_token: '0.0000003' }, after: { input_cost_per_token: 1.5e-7, output_cost_per_token: '0.0000006' } },
      }),
      event({ id: 'e1', created_at: '2026-09-25T00:00:00Z' }),
    ];
    const [row] = rowsOf({ tokenRows: [token({})], events });
    expect(row.provenance).toEqual({
      kind: 'audit',
      events: [
        { action: 'zero_set', by: { kind: 'admin', email: 'a@example.com' }, at: '2026-09-27T00:00:00Z', inputPer1m: '0', outputPer1m: '0', beforeInputPer1m: null, beforeOutputPer1m: null },
        { action: 'updated', by: { kind: 'admin', email: 'a@example.com' }, at: '2026-09-26T00:00:00Z', inputPer1m: '0.15', outputPer1m: '0.6', beforeInputPer1m: '0.075', beforeOutputPer1m: '0.3' },
        { action: 'created', by: { kind: 'admin', email: 'a@example.com' }, at: '2026-09-25T00:00:00Z', inputPer1m: '0.15', outputPer1m: '0.6', beforeInputPer1m: null, beforeOutputPer1m: null },
      ],
    });
    expect(row.preReviewNote).toBe(true);
  });

  it.each([
    ['a garbage string', { input_cost_per_token: 'abc', output_cost_per_token: 'NaN' }],
    ['missing keys', {}],
    ['not an object', 'text'],
  ])('values not recorded for %s; never throws', (_label, details) => {
    const [row] = rowsOf({ tokenRows: [token({})], events: [event({ details })] });
    expect(row.provenance).toMatchObject({ kind: 'audit', events: [{ inputPer1m: null, outputPer1m: null }] });
  });

  it('an update whose changes have no "after" records no values', () => {
    const [row] = rowsOf({ tokenRows: [token({})], events: [event({ action: 'AI_PRICING_UPDATED', changes: { input_cost_per_token: 1 }, details: null })] });
    expect(row.provenance).toMatchObject({ kind: 'audit', events: [{ action: 'updated', inputPer1m: null, beforeInputPer1m: null }] });
  });

  it('names: email, a deactivated admin by email, not on the admin list, and system (SA SC9-2)', () => {
    const events = [
      event({ id: 'e1', actor_id: ADMIN_A, created_at: '2026-09-25T04:00:00Z' }),
      event({ id: 'e2', actor_id: ADMIN_GONE, created_at: '2026-09-25T03:00:00Z' }),
      event({ id: 'e3', actor_id: NOT_LISTED, user_id: NOT_LISTED, created_at: '2026-09-25T02:00:00Z' }),
      event({ id: 'e4', actor_id: SYSTEM, user_id: SYSTEM, created_at: '2026-09-25T01:00:00Z' }),
      event({ id: 'e5', actor_id: null, user_id: ADMIN_A, details: { system_action: true }, created_at: '2026-09-25T00:00:00Z' }),
    ];
    const [row] = rowsOf({ tokenRows: [token({})], events });
    const by = row.provenance.kind === 'audit' ? row.provenance.events.map((e) => e.by) : [];
    expect(by).toEqual([
      { kind: 'admin', email: 'a@example.com' },
      { kind: 'admin', email: 'gone@example.com' },
      { kind: 'not_on_admin_list' },
      { kind: 'system' },
      { kind: 'system' },
    ]);
  });

  it('SA CR9-2: an entry with no actor id is "not recorded", never "system"; flagged system_action stays "system"', () => {
    const events = [
      event({ id: 'e1', actor_id: null, user_id: null, details: {}, created_at: '2026-09-25T02:00:00Z' }),
      event({ id: 'e2', actor_id: null, user_id: null, details: { system_action: true }, created_at: '2026-09-25T01:00:00Z' }),
    ];
    const [row] = rowsOf({ tokenRows: [token({})], events });
    const by = row.provenance.kind === 'audit' ? row.provenance.events.map((e) => e.by) : [];
    expect(by).toEqual([{ kind: 'not_recorded' }, { kind: 'system' }]);
  });

  it('P2: no provenance and no audit is "no record"', () => {
    expect(rowsOf({ tokenRows: [token({})] })[0].provenance).toEqual({ kind: 'none' });
  });
});

describe('retirement and replacement (SA SC9-6)', () => {
  it('clean-up 2026-10-11 only without provenance; with a same-date sibling it was never charged', () => {
    const survivor = token({ id: uuid(10), created_at: '2026-06-29T10:00:01Z' });
    const duplicate = token({ id: uuid(11), retired_date: '2026-10-11' });
    const [kept, dup] = rowsOf({ tokenRows: [survivor, duplicate] });
    expect(kept).toMatchObject({ status: 'current', replacedOn: null, retirement: null });
    expect(dup).toMatchObject({ status: 'retired', retirement: { kind: 'cleanup' }, replacedOn: '2026-06-29', neverCharged: true });
  });

  it('a row with provenance retired on 2026-10-11 is not a clean-up', () => {
    const newer = token({ id: uuid(12), effective_date: '2026-10-11' });
    const applied = token({ id: uuid(13), effective_date: '2026-10-05', retired_date: '2026-10-11', proposal_id: uuid(800), proposal_line_id: uuid(900) });
    const [, row] = rowsOf({ tokenRows: [newer, applied], lines: [line({})] });
    expect(row.retirement).toEqual({ kind: 'replaced' });
    expect(row).toMatchObject({ replacedOn: '2026-10-11', neverCharged: false });
  });

  it('an Apply-retired row is replaced on the apply date', () => {
    const applied = token({ id: uuid(14), effective_date: '2026-10-18', created_at: '2026-10-18T09:00:00Z', proposal_id: uuid(800), proposal_line_id: uuid(900) });
    const old = token({ id: uuid(15), effective_date: '2026-06-29', retired_date: '2026-10-18' });
    const [, was] = rowsOf({ tokenRows: [applied, old], lines: [line({})], batches: [batch({})] });
    expect(was).toMatchObject({ status: 'retired', replacedOn: '2026-10-18', retirement: { kind: 'replaced' }, neverCharged: false });
  });

  it('SA CR9-1: a retired row whose only newer row starts later was not replaced: no record of why', () => {
    const later = token({ id: uuid(40), effective_date: '2026-11-01' });
    const retired = token({ id: uuid(41), effective_date: '2026-06-29', retired_date: '2026-10-12' });
    const [, row] = rowsOf({ tokenRows: [later, retired] });
    expect(row).toMatchObject({ status: 'retired', retirement: { kind: 'no_record' }, replacedOn: '2026-10-12', neverCharged: false });
  });

  it('retired with no newer row and not the clean-up date: no record of why', () => {
    const [row] = rowsOf({ tokenRows: [token({ retired_date: '2026-10-12' })] });
    expect(row).toMatchObject({ retirement: { kind: 'no_record' }, replacedOn: '2026-10-12' });
  });

  it('an active row shadowed by a newer in-effect row is not charged, replaced on that date', () => {
    const newer = token({ id: uuid(16), effective_date: '2026-10-01' });
    const older = token({ id: uuid(17), effective_date: '2026-06-29' });
    const [cur, shadowed] = rowsOf({ tokenRows: [newer, older] });
    expect(cur.status).toBe('current');
    expect(shadowed).toMatchObject({ status: 'not_charged', replacedOn: '2026-10-01', neverCharged: false, retirement: null });
  });

  it('a row with only a starts-later successor is still current, not replaced', () => {
    const later = token({ id: uuid(18), effective_date: '2026-11-01' });
    const now = token({ id: uuid(19), effective_date: '2026-06-29' });
    const [future, cur] = rowsOf({ tokenRows: [later, now] });
    expect(future).toMatchObject({ status: 'starts_later', replacedOn: null });
    expect(cur).toMatchObject({ status: 'current', replacedOn: null });
  });
});

describe('current, prices and cached input (SA SC9-7)', () => {
  it('same-day rows keep the repository (created_at) order: the first is charged', () => {
    const a = token({ id: uuid(20), created_at: '2026-06-29T12:00:00Z' });
    const b = token({ id: uuid(21), created_at: '2026-06-29T11:00:00Z' });
    expect(rowsOf({ tokenRows: [a, b] }).map((r) => r.status)).toEqual(['current', 'not_charged']);
  });

  it('exact per-1M text: 0.000000075 per token prints 0.075, never rounded', () => {
    const [row] = rowsOf({ tokenRows: [token({ input_cost_per_token: '0.000000075', output_cost_per_token: '0.0000003' })] });
    expect(row.prices).toMatchObject({ inputPer1m: '0.075', outputPer1m: '0.3' });
  });

  it('an unreadable stored value is "not readable" (null), with a warning naming the row only', () => {
    const [row] = rowsOf({ tokenRows: [token({ id: uuid(22), input_cost_per_token: 'NaN' })] });
    expect(row.prices).toMatchObject({ inputPer1m: null, storedAsZero: false });
    expect(mockWarn).toHaveBeenCalledWith({ rowId: uuid(22), column: 'input' }, expect.any(String));
  });

  it.each([
    ['openai, stored above 0', 'openai', '0.000000075', { cachedInputPer1m: '0.075', cachedNote: 'stored' }],
    ['openai, stored 0', 'openai', '0', { cachedInputPer1m: null, cachedNote: 'half_of_input' }],
    ['openai, not set', 'openai', null, { cachedInputPer1m: null, cachedNote: 'half_of_input' }],
    ['anthropic, stored', 'anthropic', '0.0000003', { cachedInputPer1m: '0.3', cachedNote: 'stored_not_used' }],
    ['anthropic, not set', 'anthropic', null, { cachedInputPer1m: null, cachedNote: 'none' }],
  ])('%s', (_label, provider, cached, expected) => {
    const [row] = rowsOf({
      query: { kind: 'token', provider: provider as 'openai', model: 'gpt-4o-mini' },
      tokenRows: [token({ provider, cached_input_cost_per_token: cached })],
    });
    expect(row.prices).toMatchObject(expected);
  });

  it('a current row stored at 0 stays current and says so; an input-only model may have output 0', () => {
    expect(rowsOf({ tokenRows: [token({ input_cost_per_token: '0' })] })[0]).toMatchObject({ status: 'current', prices: { storedAsZero: true } });
    expect(rowsOf({ tokenRows: [token({ output_cost_per_token: '0' })] })[0].prices).toMatchObject({ storedAsZero: true });
    expect(rowsOf({ tokenRows: [token({ output_cost_per_token: '0' })], inputOnly: true })[0].prices).toMatchObject({ storedAsZero: false });
  });

  it('images: units by size then low, medium, high; the charged row skips a price at 0', () => {
    const rows = [
      image({ id: uuid(60), size: '1024x1536', quality: 'high', cost_per_image: '0.25' }),
      image({ id: uuid(61), quality: 'high', cost_per_image: '0.167' }),
      image({ id: uuid(62), quality: 'low', effective_date: '2026-10-10', cost_per_image: '0' }),
      image({ id: uuid(63), quality: 'low', cost_per_image: '0.011' }),
      image({ id: uuid(64), quality: 'medium', cost_per_image: '0.042' }),
    ];
    const data = buildPriceHistory(inputs({ query: { kind: 'image', provider: 'openai', model: 'gpt-image-1-mini' }, imageRows: rows }));
    expect(data.units.map((u) => `${u.size} ${u.quality}`)).toEqual(['1024x1024 low', '1024x1024 medium', '1024x1024 high', '1024x1536 high']);
    expect(data.units[0].rows.map((r) => [r.rowId, r.status])).toEqual([
      [uuid(62), 'not_charged'],
      [uuid(63), 'current'],
    ]);
    expect(data.units[0].rows[0].prices).toEqual({ kind: 'image', perImage: '0', storedAsZero: true });
  });
});

describe('Sync runs (SA SC9-11)', () => {
  const run = (n: number, at: string): AdminPricingSyncRun => ({ id: `s${n}`, actor_id: ADMIN_A, user_id: ADMIN_A, created_at: at, details: { models_updated: 3, models_added: 1 } });

  it('only under rows with no provenance, inside the row life, at most 10 with the rest counted', () => {
    const runs = Array.from({ length: 12 }, (_, i) => run(i, `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00Z`));
    runs.push(run(99, '2026-06-01T00:00:00Z')); // before the row existed
    const legacy = token({ id: uuid(30) });
    const [row] = rowsOf({ tokenRows: [legacy], syncRuns: runs, syncTruncated: true });
    expect(row.syncRuns).toHaveLength(10);
    expect(row.moreSyncRuns).toBe(2);
    expect(row.syncRuns[0]).toEqual({ at: '2026-09-10T00:00:00Z', by: { kind: 'admin', email: 'a@example.com' }, modelsUpdated: 3, modelsAdded: 1 });
    expect(buildPriceHistory(inputs({ tokenRows: [legacy], syncRuns: runs, syncTruncated: true })).syncTruncated).toBe(true);

    const runbook = token({ id: uuid(31), created_at: '2026-10-17T00:00:00Z' });
    expect(rowsOf({ tokenRows: [runbook], syncRuns: [run(1, '2026-10-17T05:00:00Z')] })[0].syncRuns).toEqual([]);
  });

  it('a run after the replacement day is not listed under the replaced row', () => {
    const newer = token({ id: uuid(32), effective_date: '2026-09-15' });
    const older = token({ id: uuid(33), effective_date: '2026-06-29', retired_date: '2026-09-15' });
    const [, was] = rowsOf({ tokenRows: [newer, older], syncRuns: [run(1, '2026-09-15T20:00:00Z'), run(2, '2026-09-16T00:00:00Z')] });
    expect(was.syncRuns.map((r) => r.at)).toEqual(['2026-09-15T20:00:00Z']);
  });
});

describe('loadPriceHistory: reads only what is needed; any failure throws', () => {
  function deps(over: Partial<PriceHistoryDeps> = {}): PriceHistoryDeps {
    return {
      listTokenHistory: jest.fn(async () => ({ data: { rows: [token({})], truncated: false }, error: null })),
      listImageHistory: jest.fn(async () => ({ data: { rows: [], truncated: false }, error: null })),
      findLines: jest.fn(async () => ({ data: [], error: null })),
      findBatches: jest.fn(async () => ({ data: [], error: null })),
      listRowEvents: jest.fn(async () => ({ data: { rows: [event({ actor_id: NOT_LISTED, user_id: NOT_LISTED })], reachedLimit: true }, error: null })),
      listSyncRuns: jest.fn(async () => ({ data: { rows: [], reachedLimit: false }, error: null })),
      findAdminEmails: jest.fn(async () => ({ data: [], error: null })),
      isInputOnly: () => false,
      systemActorIds: [SYSTEM],
      ...over,
    };
  }
  const query = { kind: 'token' as const, provider: 'openai' as const, model: 'gpt-4o-mini' };

  it('a pre-review model: audit and Sync read, no line or batch read, one name lookup without system ids', async () => {
    const d = deps();
    const data = await loadPriceHistory(query, d, NOW);
    expect(d.findLines).not.toHaveBeenCalled();
    expect(d.findBatches).not.toHaveBeenCalled();
    expect(d.listRowEvents).toHaveBeenCalledWith([uuid(1)]);
    expect(d.findAdminEmails).toHaveBeenCalledWith([NOT_LISTED]);
    expect(data.auditTruncated).toBe(true);
    expect(data.units[0].rows[0].provenance).toMatchObject({ kind: 'audit', events: [{ by: { kind: 'not_on_admin_list' } }] });
  });

  it('an applied model: lines, batches and names read; no audit or Sync read', async () => {
    const applied = token({ id: uuid(2), proposal_id: uuid(800), proposal_line_id: uuid(900) });
    const d = deps({
      listTokenHistory: jest.fn(async () => ({ data: { rows: [applied], truncated: true }, error: null })),
      findLines: jest.fn(async () => ({ data: [line({})], error: null })),
      findBatches: jest.fn(async () => ({ data: [batch({})], error: null })),
      findAdminEmails: jest.fn(async () => ({ data: [{ user_id: ADMIN_A, email: 'a@example.com' }], error: null })),
    });
    const data = await loadPriceHistory(query, d, NOW);
    expect(d.listRowEvents).not.toHaveBeenCalled();
    expect(d.listSyncRuns).not.toHaveBeenCalled();
    expect(d.findBatches).toHaveBeenCalledWith([uuid(700)]);
    expect((d.findAdminEmails as jest.Mock).mock.calls[0][0].sort()).toEqual([ADMIN_A, ADMIN_GONE].sort());
    expect(data.truncated).toBe(true);
    expect(data.units[0].rows[0].provenance).toMatchObject({ enteredBy: { kind: 'not_on_admin_list' } });
  });

  it('no stored row: an empty history, and no other read', async () => {
    const d = deps({ listTokenHistory: jest.fn(async () => ({ data: { rows: [], truncated: false }, error: null })) });
    const data = await loadPriceHistory(query, d, NOW);
    expect(data.units).toEqual([]);
    expect(d.listRowEvents).not.toHaveBeenCalled();
    expect(d.findAdminEmails).not.toHaveBeenCalled();
  });

  it.each([
    ['the rows', { listTokenHistory: jest.fn(async () => ({ data: null, error: new Error('x') })) }],
    ['the audit', { listRowEvents: jest.fn(async () => ({ data: null, error: new Error('x') })) }],
    ['the name lookup (never a silent fallback)', { findAdminEmails: jest.fn(async () => ({ data: null, error: new Error('x') })) }],
  ])('throws when %s cannot be read', async (_label, over) => {
    await expect(loadPriceHistory(query, deps(over as Partial<PriceHistoryDeps>), NOW)).rejects.toBeInstanceOf(PriceHistoryReadError);
  });

  it('an image query reads the image rows', async () => {
    const d = deps({ listImageHistory: jest.fn(async () => ({ data: { rows: [image({})], truncated: false }, error: null })) });
    const data = await loadPriceHistory({ kind: 'image', provider: 'openai', model: 'gpt-image-1-mini' }, d, NOW);
    expect(d.listTokenHistory).not.toHaveBeenCalled();
    expect(data.units[0]).toMatchObject({ size: '1024x1024', quality: 'low' });
  });
});
