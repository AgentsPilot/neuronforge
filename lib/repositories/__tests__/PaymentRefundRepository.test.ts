/**
 * Unit tests for PaymentRefundRepository (CF-5 PR 3): the Stripe webhook's
 * `payment_refunds` upsert (E2).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.4 and §7.5. The method must issue EXACTLY the upsert the webhook issued
 * inline (the caller's row, `onConflict: 'processor_refund_id'`, awaited), pass
 * supabase-js's error object through unchanged, add no `user_id` filter
 * (⟨unscoped-by-design⟩, SA C-3), and never catch a throw (SA CR-P2-1).
 *
 * A recording fake client: no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import {
  PaymentRefundRepository,
  paymentRefundRepository,
  type NewStripeRefundRow,
} from '@/lib/repositories/PaymentRefundRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = (...args: unknown[]) => {
      calls.push([terminal, ...args]);
      return Promise.resolve(result);
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return Promise.resolve(result).then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function sampleRow(): NewStripeRefundRow {
  return {
    user_id: 'owner-1',
    transaction_id: 'tx-0001',
    invoice_id: null,
    amount: 50,
    amount_minor: 5000,
    currency: 'USD',
    status: 'succeeded',
    processor_type: 'stripe',
    processor_refund_id: 're_1',
    stripe_connect_account_id: null,
    idempotency_key: 'stripe:re_1',
    source: 'webhook',
    succeeded_at: '2026-10-08T09:00:00.000Z',
    metadata: { origin: 'charge.refunded', charge_id: 'ch_1' },
  };
}

const repo = (client: SupabaseClient) => new PaymentRefundRepository(client);

describe('PaymentRefundRepository (CF-5 PR 3)', () => {
  describe('upsertFromStripe (E2)', () => {
    it("upserts the caller row as it is, on processor_refund_id, awaited, nothing read back", async () => {
      const row = sampleRow();
      const before = JSON.stringify(row);
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).upsertFromStripe(row);

      expect(calls).toEqual([
        ['from', 'payment_refunds'],
        ['upsert', row, { onConflict: 'processor_refund_id' }],
        ['await'],
      ]);
      expect(calls[1][1]).toBe(row);
      expect(JSON.stringify(row)).toBe(before);
      expect(result).toEqual({ data: null, error: null });
    });

    it('adds no user_id filter (the row carries the owner copied from the payment)', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      await repo(client).upsertFromStripe(sampleRow());
      expect(calls.filter(([method]) => ['eq', 'in'].includes(method))).toEqual([]);
    });

    it('passes the error through (same object; the caller throws on it)', async () => {
      const error = Object.assign(new Error('boom'), { code: 'XX000', details: '', hint: '' });
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).upsertFromStripe(sampleRow())).error).toBe(error);
    });

    it('does not catch a rejected query (SA CR-P2-1)', async () => {
      const builder: Record<string, unknown> = {};
      builder.upsert = () => builder;
      builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
        Promise.reject(new Error('network')).then(onF, onR);
      const client = { from: () => builder } as unknown as SupabaseClient;
      await expect(repo(client).upsertFromStripe(sampleRow())).rejects.toThrow('network');
    });

    it('an extra key in the row is a compile error (SA C-3)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () =>
        r.upsertFromStripe({
          ...sampleRow(),
          // @ts-expect-error -- not a column the webhook writes
          refunded_by: 'someone',
        });
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('construction', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((paymentRefundRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });

    it('is exported from the barrel, class, singleton and types', () => {
      // Read as text, as PR 1 did: importing the barrel would load every repository for one assertion.
      const index = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
      expect(index).toContain(
        "export { PaymentRefundRepository, paymentRefundRepository } from './PaymentRefundRepository';"
      );
      expect(index).toContain("export type { NewStripeRefundRow, PaymentRefundResult } from './PaymentRefundRepository';");
    });
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentRefundRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('has the section header once, and the method doc carries the marker', () => {
      expect(source.split(header)).toHaveLength(2);
      expect(source.slice(source.indexOf(header))).toMatch(
        /\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async upsertFromStripe\(/
      );
    });

    it('one write only (the upsert of the typed row); no filter, no update/insert/delete/rpc, no try/catch, no logging', () => {
      expect(code.match(/\.upsert\(/g)).toHaveLength(1);
      expect(code).toMatch(/\.upsert\(row, \{ onConflict: 'processor_refund_id' \}\)/);
      expect(code).not.toMatch(/\.(update|insert|delete|rpc|eq|in)\(/);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/\blogger\b|createLogger/);
    });
  });
});
