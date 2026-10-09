/**
 * Unit tests for the Stripe webhook's payment-row methods on
 * PaymentTransactionRepository (CF-5 PR 3).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.4 and §7.5. Each method must issue EXACTLY the query the webhook issued
 * inline before PR 3 (table, operation, columns, filters in order, `.limit`,
 * payload and its key order, terminal), pass supabase-js's error object through
 * unchanged (same identity), never add a `user_id` filter
 * (⟨unscoped-by-design⟩, SA C-3), and never catch a throw (SA CR-P2-1: a
 * rejected query must still reach the route, which answers 500).
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
  PaymentTransactionRepository,
  paymentTransactionRepository,
  WEBHOOK_TRANSACTION_ATTACH_COLUMNS,
  WEBHOOK_TRANSACTION_DISPUTE_COLUMNS,
  WEBHOOK_TRANSACTION_ID_COLUMNS,
  WEBHOOK_TRANSACTION_REFUND_COLUMNS,
  type NewWebhookTransactionRow,
} from '@/lib/repositories/PaymentRepository';

type Call = [method: string, ...args: unknown[]];

/** Records every builder call in order; the terminal (or `await`) answers `result`. */
function recordingClient(result: { data: unknown; error: unknown }) {
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
  for (const method of ['select', 'insert', 'update', 'eq', 'in', 'limit']) builder[method] = () => builder;
  for (const terminal of ['single', 'maybeSingle']) builder[terminal] = () => Promise.reject(reason);
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.reject(reason).then(onF, onR);
  return { from: () => builder } as unknown as SupabaseClient;
}

const TX_ID = 'tx-0001';
const INVOICE_ID = 'pinv-0001';
const PI = 'pi_test_1';
const CHARGE = 'ch_test_1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

/** No filter names `user_id`, and nothing outside the select list does (⟨unscoped-by-design⟩). */
function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) {
      expect(args[0]).not.toBe('user_id');
    }
  }
  const nonSelect = calls.filter(([method]) => method !== 'select');
  expect(JSON.stringify(nonSelect)).not.toContain('user_id');
}

/** A row of the shape the route builds (the standalone-payment one). */
function sampleRow(): NewWebhookTransactionRow {
  return {
    user_id: 'owner-1',
    contact_id: null,
    amount: 120,
    currency: 'USD',
    status: 'succeeded',
    processor_type: 'stripe',
    payment_method: 'card',
    stripe_payment_intent_id: PI,
    booking_id: null,
    service_id: null,
    paid_at: '2026-10-08T09:00:00.000Z',
    description: 'Website payment',
    refund_status: 'none',
    refunded_amount: 0,
    metadata: { source: 'payment_intent_webhook' },
    stripe_connect_account_id: 'acct_1',
    charge_account_kind: 'connect',
    account_resolution: 'recorded',
  };
}

const repo = (client: SupabaseClient) => new PaymentTransactionRepository(client);

beforeEach(() => {
  mockLogged.length = 0;
});

describe('PaymentTransactionRepository: Stripe webhook methods (CF-5 PR 3)', () => {
  describe('findFirstByStripeReference (D1, E1)', () => {
    it('by payment intent: select, limit(1), THEN eq — the order the route built it in; awaited, an array back', async () => {
      const rows = [{ id: TX_ID }];
      const { client, calls } = recordingClient({ data: rows, error: null });
      const result = await repo(client).findFirstByStripeReference(
        { paymentIntentId: PI, chargeId: CHARGE },
        WEBHOOK_TRANSACTION_DISPUTE_COLUMNS
      );

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['select', 'id, user_id, status, amount, currency, contact_id, metadata'],
        ['limit', 1],
        ['eq', 'stripe_payment_intent_id', PI],
        ['await'],
      ]);
      expect(result.data).toBe(rows);
      expect(result.error).toBeNull();
      expectNoOwnerFilter(calls);
    });

    it.each([undefined, null, ''])('no payment intent (%p): by charge id instead', async (paymentIntentId) => {
      const { client, calls } = recordingClient({ data: [], error: null });
      await repo(client).findFirstByStripeReference({ paymentIntentId, chargeId: CHARGE }, WEBHOOK_TRANSACTION_REFUND_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['select', 'id, user_id, invoice_id, currency'],
        ['limit', 1],
        ['eq', 'stripe_charge_id', CHARGE],
        ['await'],
      ]);
      expectNoOwnerFilter(calls);
    });

    it("the dispute caller's empty-string charge id is passed as given", async () => {
      const { client, calls } = recordingClient({ data: [], error: null });
      await repo(client).findFirstByStripeReference({ paymentIntentId: undefined, chargeId: '' }, WEBHOOK_TRANSACTION_DISPUTE_COLUMNS);
      expect(calls[3]).toEqual(['eq', 'stripe_charge_id', '']);
    });

    it('passes the error through (same object), logs nothing', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).findFirstByStripeReference({ paymentIntentId: PI, chargeId: CHARGE }, WEBHOOK_TRANSACTION_REFUND_COLUMNS);
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
      expect(mockLogged).toEqual([]);
    });

    it('accepts only the closed column set (compile time)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () => [
        // @ts-expect-error -- a free-form column list is not one of the constants
        r.findFirstByStripeReference({ paymentIntentId: PI, chargeId: CHARGE }, '*'),
        // @ts-expect-error -- the intent-lookup lists belong to findByPaymentIntentId
        r.findFirstByStripeReference({ paymentIntentId: PI, chargeId: CHARGE }, WEBHOOK_TRANSACTION_ID_COLUMNS),
      ];
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('recordDisputeState (D2)', () => {
    it('writes status, the caller-built metadata (same object) and a fresh updated_at, by id, in the old key order', async () => {
      const metadata = { status_before_dispute: 'succeeded', dispute: { id: 'dp_1' } };
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).recordDisputeState(TX_ID, { status: 'disputed', metadata });

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['update', { status: 'disputed', metadata, updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', TX_ID],
        ['await'],
      ]);
      const payload = calls[1][1] as Record<string, unknown>;
      expect(Object.keys(payload)).toEqual(['status', 'metadata', 'updated_at']);
      expect(payload.metadata).toBe(metadata);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).recordDisputeState(TX_ID, { status: 'succeeded', metadata: {} })).error).toBe(error);
    });
  });

  describe('findByPaymentIntentId (F1, #257 lookup)', () => {
    it("'id' (F1): select, eq intent, limit(1), maybeSingle", async () => {
      const { client, calls } = recordingClient({ data: { id: TX_ID }, error: null });
      const result = await repo(client).findByPaymentIntentId(PI, WEBHOOK_TRANSACTION_ID_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['select', 'id'],
        ['eq', 'stripe_payment_intent_id', PI],
        ['limit', 1],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { id: TX_ID }, error: null });
      expectNoOwnerFilter(calls);
    });

    it("'id, invoice_id' (#257): the same chain with the attach columns", async () => {
      const row = { id: TX_ID, invoice_id: null };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).findByPaymentIntentId(PI, WEBHOOK_TRANSACTION_ATTACH_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['select', 'id, invoice_id'],
        ['eq', 'stripe_payment_intent_id', PI],
        ['limit', 1],
        ['maybeSingle'],
      ]);
      expect(result.data).toBe(row);
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).findByPaymentIntentId(PI, WEBHOOK_TRANSACTION_ID_COLUMNS)).error).toBe(error);
    });

    it('accepts only the closed column set (compile time)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () => [
        // @ts-expect-error -- a free-form column list is not one of the constants
        r.findByPaymentIntentId(PI, '*'),
        // @ts-expect-error -- the reference-lookup lists belong to findFirstByStripeReference
        r.findByPaymentIntentId(PI, WEBHOOK_TRANSACTION_DISPUTE_COLUMNS),
      ];
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('attachToInvoice (#257 attach)', () => {
    it('writes invoice_id ONLY (no updated_at, as the route never did), by id', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).attachToInvoice(TX_ID, INVOICE_ID);

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['update', { invoice_id: INVOICE_ID }],
        ['eq', 'id', TX_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['invoice_id']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through (the caller logs it and carries on)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).attachToInvoice(TX_ID, INVOICE_ID)).error).toBe(error);
    });
  });

  describe('findSettledIdForInvoice (H4)', () => {
    it("select 'id', eq invoice_id, in status [succeeded, refunded], limit(1), maybeSingle", async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).findSettledIdForInvoice(INVOICE_ID);

      expect(calls).toEqual([
        ['from', 'payment_transactions'],
        ['select', 'id'],
        ['eq', 'invoice_id', INVOICE_ID],
        ['in', 'status', ['succeeded', 'refunded']],
        ['limit', 1],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).findSettledIdForInvoice(INVOICE_ID)).error).toBe(error);
    });
  });

  describe('insertFromWebhook (F2, H5, I2)', () => {
    it('inserts the caller row as it is (same object, nothing added), awaited, nothing read back', async () => {
      const row = sampleRow();
      const before = JSON.stringify(row);
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).insertFromWebhook(row);

      expect(calls).toEqual([['from', 'payment_transactions'], ['insert', row], ['await']]);
      expect(calls[1][1]).toBe(row);
      expect(JSON.stringify(row)).toBe(before);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes the error through (the caller throws on it)', async () => {
      const error = pgError('23505');
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).insertFromWebhook(sampleRow())).error).toBe(error);
    });

    it('an extra key in the row is a compile error (SA C-3)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () =>
        r.insertFromWebhook({
          ...sampleRow(),
          // @ts-expect-error -- not a column the webhook writes
          stripe_invoice_id: 'in_1',
        });
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('insertFromWebhookReturningId (G2)', () => {
    it("inserts the caller row, then select('id'), single", async () => {
      const row = sampleRow();
      const { client, calls } = recordingClient({ data: { id: TX_ID }, error: null });
      const result = await repo(client).insertFromWebhookReturningId(row);

      expect(calls).toEqual([['from', 'payment_transactions'], ['insert', row], ['select', 'id'], ['single']]);
      expect(calls[1][1]).toBe(row);
      expect(result).toEqual({ data: { id: TX_ID }, error: null });
    });

    it('passes the RAW error through (the caller rethrows that very object)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).insertFromWebhookReturningId(sampleRow());
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
    });
  });

  describe('no catch anywhere (SA CR-P2-1: a rejected query must reach the route)', () => {
    it.each([
      ['findFirstByStripeReference', (r: PaymentTransactionRepository) => r.findFirstByStripeReference({ paymentIntentId: PI, chargeId: CHARGE }, WEBHOOK_TRANSACTION_DISPUTE_COLUMNS)],
      ['recordDisputeState', (r: PaymentTransactionRepository) => r.recordDisputeState(TX_ID, { status: 'disputed', metadata: {} })],
      ['findByPaymentIntentId', (r: PaymentTransactionRepository) => r.findByPaymentIntentId(PI, WEBHOOK_TRANSACTION_ATTACH_COLUMNS)],
      ['attachToInvoice', (r: PaymentTransactionRepository) => r.attachToInvoice(TX_ID, INVOICE_ID)],
      ['findSettledIdForInvoice', (r: PaymentTransactionRepository) => r.findSettledIdForInvoice(INVOICE_ID)],
      ['insertFromWebhook', (r: PaymentTransactionRepository) => r.insertFromWebhook(sampleRow())],
      ['insertFromWebhookReturningId', (r: PaymentTransactionRepository) => r.insertFromWebhookReturningId(sampleRow())],
    ])('%s rejects when the query rejects, and logs nothing', async (_name, call) => {
      await expect(call(repo(rejectingClient(new Error('network'))))).rejects.toThrow('network');
      expect(mockLogged).toEqual([]);
    });
  });

  describe('construction', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((paymentTransactionRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });

    it('column constants are the exact inline strings', () => {
      expect(WEBHOOK_TRANSACTION_DISPUTE_COLUMNS).toBe('id, user_id, status, amount, currency, contact_id, metadata');
      expect(WEBHOOK_TRANSACTION_REFUND_COLUMNS).toBe('id, user_id, invoice_id, currency');
      expect(WEBHOOK_TRANSACTION_ID_COLUMNS).toBe('id');
      expect(WEBHOOK_TRANSACTION_ATTACH_COLUMNS).toBe('id, invoice_id');
    });
  });

  // SA C-3 bloat controls, read from the source so they cannot drift silently.
  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class PaymentTransactionRepository');
    // The class's closing brace: the first `}` in column 0 after it opens.
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const sectionCode = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const NEW_METHODS = [
      'findFirstByStripeReference',
      'recordDisputeState',
      'findByPaymentIntentId',
      'attachToInvoice',
      'findSettledIdForInvoice',
      'insertFromWebhook',
      'insertFromWebhookReturningId',
    ];

    it('one section per touched class: once here, once in the invoice class, once in the Connect class (CF-5 PR 5), nowhere else', () => {
      expect(classStart).toBeGreaterThan(-1);
      expect(classEnd).toBeGreaterThan(classStart);
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.slice(classStart, classEnd).split(header)).toHaveLength(2);
      // Each touched class holds exactly one section, and those are all of them.
      const TOUCHED = ['PaymentTransactionRepository', 'PaymentInvoiceRepository', 'StripeConnectRepository'];
      for (const name of TOUCHED) {
        const start = source.indexOf(`export class ${name}`);
        expect({ name, start: start > -1 }).toEqual({ name, start: true });
        const inClass = source.slice(start, source.indexOf('\n}', start)).split(header).length - 1;
        expect({ name, sections: inClass }).toEqual({ name, sections: 1 });
      }
      expect(source.split(header)).toHaveLength(TOUCHED.length + 1);
    });

    it('every new method sits in the section, its doc carrying the marker', () => {
      for (const method of NEW_METHODS) {
        const doc = new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}[(<]`);
        expect(section).toMatch(doc);
      }
    });

    it('no generic update, no spread payload, no delete/upsert/rpc, no user_id, no try/catch, no logging, no booking_id', () => {
      expect(sectionCode).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
      expect(sectionCode).not.toMatch(/\.update\(\s*(patch|input|changes|fields|updates|state|row)\b/);
      expect(sectionCode).not.toMatch(/\.(delete|upsert|rpc)\(/);
      // Inserts pass the typed row and nothing else.
      for (const m of sectionCode.matchAll(/\.insert\(([^)]*)\)/g)) expect(m[1]).toBe('row');
      expect(sectionCode).not.toContain('user_id');
      expect(sectionCode).not.toMatch(/\btry\s*\{/);
      expect(sectionCode).not.toMatch(/\blogger\./);
      expect(sectionCode).not.toContain('booking_id');
    });
  });
});
