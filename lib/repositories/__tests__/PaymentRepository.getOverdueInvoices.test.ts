/**
 * Unit tests for the generalized PaymentInvoiceRepository.getOverdueInvoices.
 *
 * Verifies user_id scoping and the status / due_date / amount filters (including
 * defaults when no opts are passed), plus the { data, error } result shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';

/**
 * Mock the Supabase query builder for getOverdueInvoices. The chain terminates at
 * `.order(...)`, which resolves to the seeded result. Records calls for assertions.
 */
function mockSupabase(result: { data: any; error: any }) {
  const calls: {
    table?: string;
    select?: string;
    eqs: Array<[string, any]>;
    in?: [string, any];
    lt?: [string, any];
    gt?: [string, any];
    order?: [string, any];
  } = { eqs: [] };

  const builder: any = {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    eq: jest.fn((col: string, val: any) => { calls.eqs.push([col, val]); return builder; }),
    in: jest.fn((col: string, val: any) => { calls.in = [col, val]; return builder; }),
    lt: jest.fn((col: string, val: any) => { calls.lt = [col, val]; return builder; }),
    gt: jest.fn((col: string, val: any) => { calls.gt = [col, val]; return builder; }),
    order: jest.fn((col: string, opts: any) => { calls.order = [col, opts]; return Promise.resolve(result); }),
  };

  const client = {
    from: jest.fn((t: string) => { calls.table = t; return builder; }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const ROWS = [
  { id: 'i1', user_id: 'u1', amount: 100, status: 'overdue', due_date: '2026-01-01' },
  { id: 'i2', user_id: 'u1', amount: 250, status: 'sent', due_date: '2026-02-01' },
];

describe('PaymentInvoiceRepository.getOverdueInvoices', () => {
  it('applies default filters (statuses/asOfDate/minAmount) and scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: ROWS, error: null });
    const repo = new PaymentInvoiceRepository(client);

    const { data, error } = await repo.getOverdueInvoices('u1');

    expect(error).toBeNull();
    expect(data).toEqual(ROWS);
    expect(calls.table).toBe('payment_invoices');
    expect(calls.eqs).toEqual([['user_id', 'u1']]);
    // Default statuses = unpaid set
    expect(calls.in).toEqual(['status', ['pending', 'sent', 'overdue']]);
    // Default minAmount = 0 (exclusive)
    expect(calls.gt).toEqual(['amount', 0]);
    // Default asOfDate = now (ISO string), applied as a due_date upper bound
    expect(calls.lt?.[0]).toBe('due_date');
    expect(typeof calls.lt?.[1]).toBe('string');
  });

  it('applies caller-supplied opts (overdue-only, explicit asOfDate + minAmount)', async () => {
    const { client, calls } = mockSupabase({ data: ROWS.slice(0, 1), error: null });
    const repo = new PaymentInvoiceRepository(client);

    await repo.getOverdueInvoices('u1', {
      asOfDate: '2026-03-01T00:00:00.000Z',
      statuses: ['overdue'],
      minAmount: 50,
    });

    expect(calls.in).toEqual(['status', ['overdue']]);
    expect(calls.lt).toEqual(['due_date', '2026-03-01T00:00:00.000Z']);
    expect(calls.gt).toEqual(['amount', 50]);
  });

  it('returns { data: null, error } shape on query error (never throws)', async () => {
    const boom = new Error('db down');
    const { client } = mockSupabase({ data: null, error: boom });
    const repo = new PaymentInvoiceRepository(client);

    const { data, error } = await repo.getOverdueInvoices('u1');

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});
