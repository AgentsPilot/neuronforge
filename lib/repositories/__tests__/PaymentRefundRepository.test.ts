/**
 * Unit tests for PaymentRefundRepository: the refund ledger's three scoped
 * methods (STRIPE_CONNECT_REFUND_WEBHOOK slice 2, FR 13, SA-6, A-2).
 *
 * What must hold:
 *   - every query is scoped by `user_id` AND `transaction_id` (rule 4, F1-f);
 *   - the (b) read by metadata row id runs only when (a) found nothing;
 *   - the update is compare-and-set: expected status and processor id in the
 *     filters, `{ count: 'exact' }`, no `.or()`, no `.select()` (F2-e);
 *   - the patch type is closed (F2-f, T-2: `// @ts-expect-error` below, compiled
 *     by ts-jest diagnostics);
 *   - no upsert anywhere, and `upsertFromStripe` is gone (G-5);
 *   - errors pass through as the same object, and a rejected query is not
 *     caught.
 *
 * A recording fake client: no database, no network.
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import {
  PaymentRefundRepository,
  paymentRefundRepository,
  STRIPE_REFUND_MATCH_COLUMNS,
  type NewWebhookRefundRow,
  type StripeRefundStatePatch,
} from '@/lib/repositories/PaymentRefundRepository';

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: unknown; count?: number | null };

/** Records every builder call. Terminal answers are consumed in order. */
function recordingClient(...results: Result[]) {
  const calls: Call[] = [];
  const queue = [...results];
  const next = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'in', 'or', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = (...args: unknown[]) => {
      calls.push([terminal, ...args]);
      return next();
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return next().then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const repo = (client: SupabaseClient) => new PaymentRefundRepository(client);

const LEDGER_ROW = {
  id: 'rf-1',
  status: 'pending',
  processor_refund_id: null,
  source: 'app',
  processor_type: 'stripe',
  amount_minor: 2500,
  currency: 'USD',
  stripe_connect_account_id: 'acct_1',
};

function sampleInsert(): NewWebhookRefundRow {
  return {
    user_id: 'owner-1',
    transaction_id: 'tx-0001',
    invoice_id: null,
    amount: 25,
    amount_minor: 2500,
    currency: 'USD',
    status: 'succeeded',
    processor_type: 'stripe',
    processor_refund_id: 're_1',
    stripe_connect_account_id: 'acct_1',
    idempotency_key: 'stripe:re_1',
    source: 'webhook',
    created_at: '2026-10-08T09:00:00.000Z',
    succeeded_at: '2026-10-08T09:00:05.000Z',
    failure_code: null,
    failure_message: null,
    metadata: { origin: 'refund.updated', charge_id: 'ch_1', payment_intent_id: 'pi_1' },
  };
}

const PATCH: StripeRefundStatePatch = { status: 'succeeded', succeeded_at: '2026-10-08T09:00:05.000Z', updated_at: 'now' };

describe('PaymentRefundRepository', () => {
  describe('findForStripeRefund (FR 3 a/b, F1-f)', () => {
    it('(a) by Stripe refund id, scoped by user_id and transaction_id; (b) is not read when (a) finds the row', async () => {
      const { client, calls } = recordingClient({ data: LEDGER_ROW, error: null });
      const result = await repo(client).findForStripeRefund('owner-1', 'tx-1', {
        processorRefundId: 're_1',
        ledgerRowId: 'rf-9',
      });

      expect(calls).toEqual([
        ['from', 'payment_refunds'],
        ['select', STRIPE_REFUND_MATCH_COLUMNS],
        ['eq', 'user_id', 'owner-1'],
        ['eq', 'transaction_id', 'tx-1'],
        ['eq', 'processor_refund_id', 're_1'],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { row: LEDGER_ROW, matchedBy: 'processor_refund_id' }, error: null });
    });

    it('(b) by the metadata row id only after (a) misses, filtered by id, transaction_id and user_id', async () => {
      const { client, calls } = recordingClient({ data: null, error: null }, { data: LEDGER_ROW, error: null });
      const result = await repo(client).findForStripeRefund('owner-1', 'tx-1', {
        processorRefundId: 're_1',
        ledgerRowId: 'rf-1',
      });

      expect(calls.slice(6)).toEqual([
        ['from', 'payment_refunds'],
        ['select', STRIPE_REFUND_MATCH_COLUMNS],
        ['eq', 'id', 'rf-1'],
        ['eq', 'transaction_id', 'tx-1'],
        ['eq', 'user_id', 'owner-1'],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { row: LEDGER_ROW, matchedBy: 'ledger_row_id' }, error: null });
    });

    it('no metadata row id: one read, and no row is data null with no error', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).findForStripeRefund('owner-1', 'tx-1', { processorRefundId: 're_1', ledgerRowId: null });
      expect(calls.filter(([m]) => m === 'from')).toHaveLength(1);
      expect(result).toEqual({ data: null, error: null });
    });

    it('neither key finds a row → data null, no error', async () => {
      const { client } = recordingClient({ data: null, error: null }, { data: null, error: null });
      expect(await repo(client).findForStripeRefund('o', 't', { processorRefundId: 're_1', ledgerRowId: 'rf-1' })).toEqual({
        data: null,
        error: null,
      });
    });

    it('a read error on (a) returns at once (same object), without reading (b)', async () => {
      const error = { code: 'XX000', message: 'boom', details: '', hint: '' };
      const { client, calls } = recordingClient({ data: null, error });
      const result = await repo(client).findForStripeRefund('o', 't', { processorRefundId: 're_1', ledgerRowId: 'rf-1' });
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
      expect(calls.filter(([m]) => m === 'from')).toHaveLength(1);
    });

    it('a read error on (b) is passed through', async () => {
      const error = { code: 'XX000', message: 'boom', details: '', hint: '' };
      const { client } = recordingClient({ data: null, error: null }, { data: null, error });
      expect((await repo(client).findForStripeRefund('o', 't', { processorRefundId: 're_1', ledgerRowId: 'rf-1' })).error).toBe(error);
    });
  });

  describe('insertFromStripe (FR 3 c)', () => {
    it('inserts the caller row as it is, awaited, nothing read back, no ON CONFLICT', async () => {
      const row = sampleInsert();
      const before = JSON.stringify(row);
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).insertFromStripe(row);

      expect(calls).toEqual([['from', 'payment_refunds'], ['insert', row], ['await']]);
      expect(calls[1][1]).toBe(row);
      expect(JSON.stringify(row)).toBe(before);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes a 23505 through as the same object (the caller re-reads)', async () => {
      const error = { code: '23505', message: 'duplicate key', details: '', hint: '' };
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).insertFromStripe(sampleInsert())).error).toBe(error);
    });

    it('an extra key in the row is a compile error', () => {
      const r = repo(recordingClient().client);
      const typeOnly = () =>
        r.insertFromStripe({
          ...sampleInsert(),
          // @ts-expect-error -- Stripe's own metadata is never copied onto the row
          stripe_metadata: { refund_row_id: 'x' },
        });
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('applyStripeRefundState (A-2, F2-e)', () => {
    it('expected processor id null: scoped compare-and-set with .is(null), count exact, no select', async () => {
      const { client, calls } = recordingClient({ data: null, error: null, count: 1 });
      const result = await repo(client).applyStripeRefundState(
        'owner-1',
        'tx-1',
        'rf-1',
        { status: 'pending', processorRefundId: null },
        PATCH
      );

      expect(calls).toEqual([
        ['from', 'payment_refunds'],
        ['update', PATCH, { count: 'exact' }],
        ['eq', 'id', 'rf-1'],
        ['eq', 'transaction_id', 'tx-1'],
        ['eq', 'user_id', 'owner-1'],
        ['eq', 'status', 'pending'],
        ['is', 'processor_refund_id', null],
        ['await'],
      ]);
      expect(result).toEqual({ data: { count: 1 }, error: null });
    });

    it('expected processor id set: .eq on it instead of .is', async () => {
      const { client, calls } = recordingClient({ data: null, error: null, count: 1 });
      await repo(client).applyStripeRefundState('owner-1', 'tx-1', 'rf-1', { status: 'succeeded', processorRefundId: 're_1' }, PATCH);
      expect(calls.slice(5, 7)).toEqual([
        ['eq', 'status', 'succeeded'],
        ['eq', 'processor_refund_id', 're_1'],
      ]);
      expect(calls.some(([m]) => m === 'is')).toBe(false);
    });

    it('count 0 (the race was lost) is returned as 0, not as an error', async () => {
      const { client } = recordingClient({ data: null, error: null, count: 0 });
      expect(
        await repo(client).applyStripeRefundState('o', 't', 'rf-1', { status: 'pending', processorRefundId: null }, PATCH)
      ).toEqual({ data: { count: 0 }, error: null });
    });

    it('an error (P0001 from refund_guard_before) passes through as the same object, with no data', async () => {
      const error = { code: 'P0001', message: 'Refund of 25 would exceed', details: '', hint: '' };
      const { client } = recordingClient({ data: null, error, count: null });
      const result = await repo(client).applyStripeRefundState('o', 't', 'rf-1', { status: 'pending', processorRefundId: null }, PATCH);
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
    });

    it('does not catch a rejected query', async () => {
      const builder: Record<string, unknown> = {};
      for (const m of ['update', 'eq', 'is']) builder[m] = () => builder;
      builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
        Promise.reject(new Error('network')).then(onF, onR);
      const client = { from: () => builder } as unknown as SupabaseClient;
      await expect(
        repo(client).applyStripeRefundState('o', 't', 'rf-1', { status: 'pending', processorRefundId: null }, PATCH)
      ).rejects.toThrow('network');
    });

    it('the patch cannot carry the app’s own columns (F2-f, T-2: compile errors)', () => {
      const r = repo(recordingClient().client);
      const expected = { status: 'pending', processorRefundId: null } as const;
      const typeOnly = () => [
        // @ts-expect-error -- source is the app's
        r.applyStripeRefundState('o', 't', 'i', expected, { updated_at: 'x', source: 'webhook' }),
        // @ts-expect-error -- created_at never changes on update (SA-11)
        r.applyStripeRefundState('o', 't', 'i', expected, { updated_at: 'x', created_at: 'x' }),
        // @ts-expect-error -- metadata is the app's
        r.applyStripeRefundState('o', 't', 'i', expected, { updated_at: 'x', metadata: {} }),
        // @ts-expect-error -- amounts never change
        r.applyStripeRefundState('o', 't', 'i', expected, { updated_at: 'x', amount: 1 }),
        // @ts-expect-error -- the owner never changes
        r.applyStripeRefundState('o', 't', 'i', expected, { updated_at: 'x', user_id: 'attacker' }),
        // @ts-expect-error -- updated_at is required (SA C-7)
        r.applyStripeRefundState('o', 't', 'i', expected, { status: 'failed' }),
      ];
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('construction and exports', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((paymentRefundRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });

    it('upsertFromStripe is gone (G-5)', () => {
      expect((paymentRefundRepository as unknown as Record<string, unknown>).upsertFromStripe).toBeUndefined();
    });

    it('is exported from the barrel, class, singleton and types', () => {
      // Read as text: importing the barrel would load every repository for one assertion.
      const index = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
      expect(index).toContain(
        "export { PaymentRefundRepository, paymentRefundRepository, STRIPE_REFUND_MATCH_COLUMNS } from './PaymentRefundRepository';"
      );
      expect(index).toMatch(/NewWebhookRefundRow,[\s\S]*StripeRefundStatePatch,[\s\S]*from '\.\/PaymentRefundRepository';/);
    });
  });

  describe('source shape (SA-6, rule 4, the PostgREST hazard)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentRefundRepository.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('no upsert, no ON CONFLICT, no .or(), no unscoped-by-design exception', () => {
      expect(code).not.toMatch(/\.upsert\(|onConflict|\.or\(/);
      expect(source).not.toContain('⟨unscoped-by-design⟩');
    });

    it('one insert and one update, the update with count exact; no delete, rpc, try/catch or logging', () => {
      expect(code.match(/\.insert\(/g)).toHaveLength(1);
      expect(code.match(/\.update\(/g)).toHaveLength(1);
      expect(code).toMatch(/\.update\(patch, \{ count: 'exact' \}\)/);
      expect(code).not.toMatch(/\.(delete|rpc)\(/);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/\blogger\b|createLogger/);
    });

    it('every query is scoped by user_id and transaction_id', () => {
      const queries = code.split(".from('payment_refunds')").slice(1);
      expect(queries).toHaveLength(4);
      // The insert carries both on the row (NewWebhookRefundRow requires them).
      for (const q of queries.filter((s) => !/^\s*\.insert\(/.test(s))) {
        const chain = q.slice(0, q.search(/;|\n\n/));
        expect(chain).toMatch(/\.eq\('user_id', userId\)/);
        expect(chain).toMatch(/\.eq\('transaction_id', transactionId\)/);
      }
    });
  });
});
