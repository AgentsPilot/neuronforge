/**
 * Unit tests for the Stripe webhook's and `bindPlanSubscription`'s period
 * methods on PaymentPlanRepository (CF-5 PR 4).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.5 and §7.5. Each method must issue EXACTLY the query its caller issued
 * inline before PR 4 (table, operation, columns, filters in order, payload and
 * its key order, terminal), pass supabase-js's error object through unchanged
 * (same identity), add no `user_id` filter where the inline query had none
 * (⟨unscoped-by-design⟩, SA C-3) and keep it where it had one, and never catch
 * a throw (SA CR-P2-1: a rejected query must still reach the caller).
 *
 * A recording fake client: no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

// The default client is the shared service-role singleton; a marker proves it.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

// The repository's module logger, captured: these methods must log nothing.
const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => ({}) };
  },
}));

import {
  PaymentPlanRepository,
  paymentPlanRepository,
  type NewProjectedPeriodRow,
} from '@/lib/repositories/PaymentPlanRepository';

type Call = [method: string, ...args: unknown[]];

/** Records every builder call in order; the terminal (or `await`) answers `result`. */
function recordingClient(result: Record<string, unknown>) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit']) {
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

/** A client whose query REJECTS at the terminal / await (not a sync throw). */
function rejectingClient(reason: Error) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'eq', 'not', 'order', 'limit']) builder[method] = () => builder;
  for (const terminal of ['single', 'maybeSingle']) builder[terminal] = () => Promise.reject(reason);
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.reject(reason).then(onF, onR);
  return { from: () => builder } as unknown as SupabaseClient;
}

const PLAN_ROW = 'plan-row-1';
const OWNER = 'owner-1';
const SERVICE = 'svc-1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

/** No filter names `user_id`, and nothing outside the select list does (⟨unscoped-by-design⟩). */
function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) expect(args[0]).not.toBe('user_id');
  }
  expect(JSON.stringify(calls.filter(([method]) => method !== 'select' && method !== 'insert'))).not.toContain('user_id');
}

function sampleRows(): NewProjectedPeriodRow[] {
  return [1, 2].map((n) => ({
    user_id: OWNER,
    payment_plan_id: 'pp-1',
    subscription_id: PLAN_ROW,
    booking_id: null,
    contact_id: 'ct-1',
    installment_number: n,
    amount: 50,
    currency: 'USD',
    due_date: `2026-1${n}-01`,
    status: 'pending' as const,
  }));
}

const repo = (client: SupabaseClient) => new PaymentPlanRepository(client);

beforeEach(() => {
  mockLogged.length = 0;
});

describe('PaymentPlanRepository: Stripe webhook and plan-binding methods (CF-5 PR 4)', () => {
  describe('findInstallmentIdByStripeInvoiceId (G1)', () => {
    it("select 'id', eq stripe_invoice_id, maybeSingle", async () => {
      const { client, calls } = recordingClient({ data: { id: 'inst-1' }, error: null });
      const result = await repo(client).findInstallmentIdByStripeInvoiceId('in_1');

      expect(calls).toEqual([
        ['from', 'payment_plan_installments'],
        ['select', 'id'],
        ['eq', 'stripe_invoice_id', 'in_1'],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { id: 'inst-1' }, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through (same object), logs nothing', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).findInstallmentIdByStripeInvoiceId('in_1');
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
      expect(mockLogged).toEqual([]);
    });
  });

  describe('markPeriodPaidFromStripe (G3)', () => {
    it('writes the eight fields in the old key order, by plan row and period number, awaited', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPeriodPaidFromStripe(PLAN_ROW, 2, { stripeInvoiceId: 'in_2', transactionId: 'tx-2' });

      expect(calls).toEqual([
        ['from', 'payment_plan_installments'],
        [
          'update',
          {
            status: 'paid',
            paid_at: expect.stringMatching(ISO),
            stripe_invoice_id: 'in_2',
            payment_method: 'card',
            processor_type: 'stripe',
            transaction_id: 'tx-2',
            next_retry_at: null,
            updated_at: expect.stringMatching(ISO),
          },
        ],
        ['eq', 'subscription_id', PLAN_ROW],
        ['eq', 'installment_number', 2],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual([
        'status',
        'paid_at',
        'stripe_invoice_id',
        'payment_method',
        'processor_type',
        'transaction_id',
        'next_retry_at',
        'updated_at',
      ]);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('a null transaction id is written as null', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      await repo(client).markPeriodPaidFromStripe(PLAN_ROW, 1, { stripeInvoiceId: 'in_1', transactionId: null });
      expect((calls[1][1] as Record<string, unknown>).transaction_id).toBeNull();
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).markPeriodPaidFromStripe(PLAN_ROW, 1, { stripeInvoiceId: 'in_1', transactionId: null })).error).toBe(error);
    });
  });

  describe('findNextPendingPeriod (G4)', () => {
    it("select 'due_date, amount', by plan row, pending, order(installment_number) with no options, limit(1), maybeSingle", async () => {
      const row = { due_date: '2026-12-01', amount: 333.33 };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).findNextPendingPeriod(PLAN_ROW);

      expect(calls).toEqual([
        ['from', 'payment_plan_installments'],
        ['select', 'due_date, amount'],
        ['eq', 'subscription_id', PLAN_ROW],
        ['eq', 'status', 'pending'],
        ['order', 'installment_number'],
        ['limit', 1],
        ['maybeSingle'],
      ]);
      expect(result.data).toBe(row);
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).findNextPendingPeriod(PLAN_ROW)).error).toBe(error);
    });
  });

  describe('countProjectedPeriods (bind, the already-bound check)', () => {
    it("select('id', { count: 'exact', head: true }), eq subscription_id, awaited; the count back", async () => {
      const { client, calls } = recordingClient({ data: null, count: 3, error: null });
      const result = await repo(client).countProjectedPeriods(PLAN_ROW);

      expect(calls).toEqual([
        ['from', 'payment_plan_installments'],
        ['select', 'id', { count: 'exact', head: true }],
        ['eq', 'subscription_id', PLAN_ROW],
        ['await'],
      ]);
      expect(result).toEqual({ count: 3, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, count: null, error });
      const result = await repo(client).countProjectedPeriods(PLAN_ROW);
      expect(result.error).toBe(error);
      expect(result.count).toBeNull();
    });
  });

  describe('insertProjectedPeriods (bind, the projection)', () => {
    it('inserts the caller rows as they are (same array, nothing added), awaited, nothing read back', async () => {
      const rows = sampleRows();
      const before = JSON.stringify(rows);
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).insertProjectedPeriods(rows);

      expect(calls).toEqual([['from', 'payment_plan_installments'], ['insert', rows], ['await']]);
      expect(calls[1][1]).toBe(rows);
      expect(JSON.stringify(rows)).toBe(before);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes the error through (bind logs it and goes on)', async () => {
      const error = pgError('23502');
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).insertProjectedPeriods(sampleRows())).error).toBe(error);
    });

    it('an extra key in a row is a compile error (SA C-3)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () =>
        r.insertProjectedPeriods([
          {
            ...sampleRows()[0],
            // @ts-expect-error -- not a column the binder writes
            stripe_invoice_id: 'in_1',
          },
        ]);
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('cancelOpenPeriodsForEndedPlan (M3, owner-scoped)', () => {
    it('update {status, next_retry_at, updated_at}, eq user_id, eq subscription_id AS GIVEN, not status in (paid,cancelled), awaited', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      // The webhook passes Stripe's id here today (F-3); the method must not change it.
      const result = await repo(client).cancelOpenPeriodsForEndedPlan(OWNER, 'sub_plan_1');

      expect(calls).toEqual([
        ['from', 'payment_plan_installments'],
        ['update', { status: 'cancelled', next_retry_at: null, updated_at: expect.stringMatching(ISO) }],
        ['eq', 'user_id', OWNER],
        ['eq', 'subscription_id', 'sub_plan_1'],
        ['not', 'status', 'in', '(paid,cancelled)'],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'next_retry_at', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes the error through (the webhook discards it today, FU-9)', async () => {
      const error = pgError('22P02');
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).cancelOpenPeriodsForEndedPlan(OWNER, 'sub_plan_1')).error).toBe(error);
    });
  });

  describe('findOldestActivePlanIdForService (bind fallback, owner-scoped)', () => {
    it("payment_plans select 'id', eq user_id, eq service_id, eq is_active true, order created_at asc, limit(1), maybeSingle", async () => {
      const { client, calls } = recordingClient({ data: { id: 'pp-1' }, error: null });
      const result = await repo(client).findOldestActivePlanIdForService(OWNER, SERVICE);

      expect(calls).toEqual([
        ['from', 'payment_plans'],
        ['select', 'id'],
        ['eq', 'user_id', OWNER],
        ['eq', 'service_id', SERVICE],
        ['eq', 'is_active', true],
        ['order', 'created_at', { ascending: true }],
        ['limit', 1],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { id: 'pp-1' }, error: null });
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).findOldestActivePlanIdForService(OWNER, SERVICE)).error).toBe(error);
    });
  });

  describe('no catch anywhere (SA CR-P2-1: a rejected query must reach the caller)', () => {
    it.each([
      ['findInstallmentIdByStripeInvoiceId', (r: PaymentPlanRepository) => r.findInstallmentIdByStripeInvoiceId('in_1')],
      ['markPeriodPaidFromStripe', (r: PaymentPlanRepository) => r.markPeriodPaidFromStripe(PLAN_ROW, 1, { stripeInvoiceId: 'in_1', transactionId: null })],
      ['findNextPendingPeriod', (r: PaymentPlanRepository) => r.findNextPendingPeriod(PLAN_ROW)],
      ['countProjectedPeriods', (r: PaymentPlanRepository) => r.countProjectedPeriods(PLAN_ROW)],
      ['insertProjectedPeriods', (r: PaymentPlanRepository) => r.insertProjectedPeriods(sampleRows())],
      ['cancelOpenPeriodsForEndedPlan', (r: PaymentPlanRepository) => r.cancelOpenPeriodsForEndedPlan(OWNER, 'sub_1')],
      ['findOldestActivePlanIdForService', (r: PaymentPlanRepository) => r.findOldestActivePlanIdForService(OWNER, SERVICE)],
    ])('%s rejects when the query rejects, and logs nothing', async (_name, call) => {
      await expect(call(repo(rejectingClient(new Error('network'))))).rejects.toThrow('network');
      expect(mockLogged).toEqual([]);
    });
  });

  describe('construction', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((paymentPlanRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });
  });

  // SA C-3 bloat controls, read from the source so they cannot drift silently.
  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentPlanRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const scopedHeader = '// Stripe webhook and plan binding: owner-scoped (CF-5 PR 4)';
    const classStart = source.indexOf('export class PaymentPlanRepository');
    const sectionStart = source.indexOf(header, classStart);
    const scopedStart = source.indexOf(scopedHeader, classStart);
    const helpers = source.indexOf('// ==================== HELPER METHODS', classStart);
    const unscoped = source.slice(sectionStart, scopedStart);
    const scoped = source.slice(scopedStart, helpers);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const UNSCOPED = [
      'findInstallmentIdByStripeInvoiceId',
      'markPeriodPaidFromStripe',
      'findNextPendingPeriod',
      'countProjectedPeriods',
      'insertProjectedPeriods',
    ];
    const SCOPED = ['cancelOpenPeriodsForEndedPlan', 'findOldestActivePlanIdForService'];

    it('one unscoped section, then one owner-scoped section, both in the class', () => {
      expect(classStart).toBeGreaterThan(-1);
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(scopedStart).toBeGreaterThan(sectionStart);
      expect(helpers).toBeGreaterThan(scopedStart);
      expect(source.split(header)).toHaveLength(2);
      expect(source.split(scopedHeader)).toHaveLength(2);
    });

    it('every unscoped method sits in its section with the marker; the scoped ones without it', () => {
      for (const method of UNSCOPED) {
        expect(unscoped).toMatch(new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}[(<]`));
      }
      for (const method of SCOPED) {
        expect(scoped).toMatch(new RegExp(`async ${method}\\(`));
      }
      expect(scoped).not.toContain('⟨unscoped-by-design⟩');
    });

    it('no generic update, no spread payload, no delete/upsert/rpc, no try/catch, no logging; user_id only where it was', () => {
      for (const code of [strip(unscoped), strip(scoped)]) {
        expect(code).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
        expect(code).not.toMatch(/\.update\(\s*(patch|input|changes|fields|updates|state|row)\b/);
        expect(code).not.toMatch(/\.(delete|upsert|rpc)\(/);
        expect(code).not.toMatch(/\btry\s*\{/);
        expect(code).not.toMatch(/\blogger\./);
      }
      for (const m of strip(unscoped).matchAll(/\.insert\(([^)]*)\)/g)) expect(m[1]).toBe('rows');
      expect(strip(unscoped)).not.toContain('user_id');
      // Each scoped method filters on user_id exactly once.
      expect(strip(scoped).match(/\.eq\('user_id', userId\)/g)).toHaveLength(SCOPED.length);
    });
  });
});
