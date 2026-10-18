/**
 * QA edge cases for the per-model price history builder (AI model price
 * review slice 9, QA pass 2026-10-18). Pins exact decimals at the extremes,
 * stored values Postgres can hold that are not plain decimals, image unit
 * order with non-standard qualities, same-day ordering of three rows, and a
 * mixed-case audit entity id. Fixtures copied from `priceHistory.test.ts`.
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

describe('QA: exact decimals at the extremes (no float anywhere)', () => {
  it('a tiny stored per-token value converts to per 1M exactly', () => {
    const [row] = rowsOf({ tokenRows: [token({ input_cost_per_token: '0.000000000000003', output_cost_per_token: '0.000000000000000001' })] });
    expect(row.prices).toMatchObject({ inputPer1m: '0.000000003', outputPer1m: '0.000000000001' });
  });

  it('a value with trailing zeros prints without them, and float-hostile values stay exact', () => {
    const [row] = rowsOf({ tokenRows: [token({ input_cost_per_token: '0.000000150000', output_cost_per_token: '0.0000001' })] });
    // 0.0000001 * 1e6 as a float is 0.09999999999999999.
    expect(row.prices).toMatchObject({ inputPer1m: '0.15', outputPer1m: '0.1' });
  });

  it('a tiny legacy audit value, as a JSON number (exponent form) or a plain string, is exact per 1M', () => {
    const [row] = rowsOf({
      tokenRows: [token({})],
      events: [event({ details: { input_cost_per_token: 3e-15, output_cost_per_token: '0.000000000000003' } })],
    });
    expect(row.provenance).toMatchObject({ kind: 'audit', events: [{ inputPer1m: '0.000000003', outputPer1m: '0.000000003' }] });
  });

  it('a legacy audit string in exponent form is not guessed: values not recorded', () => {
    const [row] = rowsOf({ tokenRows: [token({})], events: [event({ details: { input_cost_per_token: '3e-15', output_cost_per_token: 'Infinity' } })] });
    expect(row.provenance).toMatchObject({ kind: 'audit', events: [{ inputPer1m: null, outputPer1m: null }] });
  });
});

describe('QA: stored values that are not plain decimals never throw', () => {
  it.each(['Infinity', '-Infinity', 'NaN', '', '1e-7'])('stored %p is "not readable"', (bad) => {
    let rows: PriceHistoryRow[] = [];
    expect(() => {
      rows = rowsOf({ tokenRows: [token({ input_cost_per_token: bad, output_cost_per_token: bad, cached_input_cost_per_token: bad })] });
    }).not.toThrow();
    expect(rows[0].prices).toMatchObject({ inputPer1m: null, outputPer1m: null, cachedNote: 'unreadable', storedAsZero: false });
  });

  it('an unreadable image price is "not readable" and never the charged row', () => {
    const rows = rowsOf({
      query: { kind: 'image', provider: 'openai', model: 'gpt-image-1-mini' },
      imageRows: [image({ id: uuid(61), cost_per_image: 'NaN', created_at: '2026-10-02T10:00:00+00:00' }), image({ id: uuid(62) })],
    });
    expect(rows[0]).toMatchObject({ rowId: uuid(61), status: 'not_charged', prices: { perImage: null } });
    expect(rows[1]).toMatchObject({ rowId: uuid(62), status: 'current', prices: { perImage: '0.005' } });
  });
});

describe('QA: ordering and grouping', () => {
  it('three rows on the same date: the newest created is charged, the others were never charged', () => {
    const rows = rowsOf({
      tokenRows: [
        token({ id: uuid(3), effective_date: '2026-10-18', created_at: '2026-10-18T11:00:00+00:00' }),
        token({ id: uuid(2), effective_date: '2026-10-18', created_at: '2026-10-18T10:00:00+00:00' }),
        token({ id: uuid(1), effective_date: '2026-10-18', created_at: '2026-10-18T09:00:00+00:00' }),
      ],
    });
    expect(rows.map((row) => [row.rowId, row.status, row.neverCharged])).toEqual([
      [uuid(3), 'current', false],
      [uuid(2), 'not_charged', true],
      [uuid(1), 'not_charged', true],
    ]);
  });

  it('image units: sizes in order, then low, medium, high, then other qualities alphabetically', () => {
    const data = buildPriceHistory(
      inputs({
        query: { kind: 'image', provider: 'openai', model: 'gpt-image-1-mini' },
        imageRows: [
          image({ id: uuid(71), size: '1536x1024', quality: 'standard' }),
          image({ id: uuid(72), size: '1024x1024', quality: 'auto' }),
          image({ id: uuid(73), size: '1024x1024', quality: 'high' }),
          image({ id: uuid(74), size: '1024x1024', quality: 'low' }),
          image({ id: uuid(75), size: '1024x1024', quality: 'medium' }),
          image({ id: uuid(76), size: '1024x1024', quality: 'low', effective_date: '2026-09-01', retired_date: '2026-10-01' }),
        ],
      })
    );
    expect(data.units.map((unit) => `${unit.size}/${unit.quality}`)).toEqual([
      '1024x1024/low',
      '1024x1024/medium',
      '1024x1024/high',
      '1024x1024/auto',
      '1536x1024/standard',
    ]);
    expect(data.units[0].rows.map((row) => row.rowId)).toEqual([uuid(74), uuid(76)]);
    expect(data.units[0].rows[1]).toMatchObject({ status: 'retired', replacedOn: '2026-10-01', retirement: { kind: 'replaced' } });
  });

  it('an audit entity id stored in upper case still attaches to its row', () => {
    const [row] = rowsOf({ tokenRows: [token({ id: uuid(1) })], events: [event({ entity_id: uuid(1).toUpperCase() })] });
    expect(row.provenance.kind).toBe('audit');
  });
});
