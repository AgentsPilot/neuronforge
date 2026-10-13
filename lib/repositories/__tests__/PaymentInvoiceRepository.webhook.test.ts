/**
 * Unit tests for the Stripe webhook's invoice methods on PaymentInvoiceRepository
 * (CF-5 PR 2).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.3 and §7.5. Each method must issue EXACTLY the query the webhook issued
 * inline before PR 2 (table, operation, columns, payload and its key order,
 * filter, terminal), pass supabase-js's error object through unchanged (same
 * identity), never add a `user_id` filter (⟨unscoped-by-design⟩, SA C-3), and
 * never catch a throw. `findByStripeInvoiceId` (reused) stays quiet on a
 * PGRST116 miss and logs every other error (SA C-5 / Q-5).
 *
 * A recording fake client: no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

// The default client is the shared service-role singleton; a marker proves it.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

// The repository's module logger, captured (createLogger({ service })).
const mockLogged: Array<{ level: string; service: unknown; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: (options: { service?: unknown }) => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, service: options?.service, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => ({}) };
  },
}));

import {
  PaymentInvoiceRepository,
  paymentInvoiceRepository,
  WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS,
  WEBHOOK_INVOICE_LOOKUP_COLUMNS,
  WEBHOOK_INVOICE_RECEIPT_COLUMNS,
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
  for (const method of ['select', 'update', 'eq']) builder[method] = () => builder;
  for (const terminal of ['single', 'maybeSingle']) builder[terminal] = () => Promise.reject(reason);
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.reject(reason).then(onF, onR);
  return { from: () => builder } as unknown as SupabaseClient;
}

const INVOICE_ID = 'pinv-0001';
const STRIPE_INVOICE_ID = 'in_test_1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

/** No call anywhere in the chain names `user_id` (⟨unscoped-by-design⟩). */
function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) {
      expect(args[0]).not.toBe('user_id');
    }
  }
  // Payloads and filters only: a select list may name the `user_id` column.
  const nonSelect = calls.filter(([method]) => method !== 'select');
  expect(JSON.stringify(nonSelect)).not.toContain('user_id');
}

const repo = (client: SupabaseClient) => new PaymentInvoiceRepository(client);

beforeEach(() => {
  mockLogged.length = 0;
});

describe('PaymentInvoiceRepository: Stripe webhook methods (CF-5 PR 2)', () => {
  describe('findByStripeInvoiceId (reused; H1, J1, K1, L1)', () => {
    it('default: select * by stripe_invoice_id, single (H1, unchanged)', async () => {
      const row = { id: INVOICE_ID };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).findByStripeInvoiceId(STRIPE_INVOICE_ID);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['select', '*'],
        ['eq', 'stripe_invoice_id', STRIPE_INVOICE_ID],
        ['single'],
      ]);
      expect(result).toEqual({ data: row, error: null });
      expectNoOwnerFilter(calls);
    });

    it('with the lookup columns: id, invoice_number, user_id (J1, K1, L1)', async () => {
      const row = { id: INVOICE_ID, invoice_number: 'INV-1', user_id: 'owner-1' };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).findByStripeInvoiceId(STRIPE_INVOICE_ID, WEBHOOK_INVOICE_LOOKUP_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['select', 'id, invoice_number, user_id'],
        ['eq', 'stripe_invoice_id', STRIPE_INVOICE_ID],
        ['single'],
      ]);
      expect(result).toEqual({ data: row, error: null });
      expectNoOwnerFilter(calls);
    });

    it('C-5: a PGRST116 miss returns the same error object and logs NOTHING', async () => {
      const error = pgError('PGRST116');
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).findByStripeInvoiceId(STRIPE_INVOICE_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(error);
      expect(mockLogged).toEqual([]);
    });

    it('C-5: any other error returns the same error object and logs it at error, with the service logger', async () => {
      const error = pgError('57014');
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).findByStripeInvoiceId(STRIPE_INVOICE_ID, WEBHOOK_INVOICE_LOOKUP_COLUMNS);

      expect(result.data).toBeNull();
      expect(result.error).toBe(error);
      expect(mockLogged).toHaveLength(1);
      expect(mockLogged[0].level).toBe('error');
      expect(mockLogged[0].service).toBe('PaymentRepository');
      expect(mockLogged[0].args).toEqual([{ err: error, stripeInvoiceId: STRIPE_INVOICE_ID }, 'Failed to find invoice by Stripe ID']);
    });

    it('does not catch a rejected query: the webhook must still fail and let Stripe retry', async () => {
      await expect(repo(rejectingClient(new Error('network'))).findByStripeInvoiceId(STRIPE_INVOICE_ID)).rejects.toThrow(
        'network'
      );
      await expect(
        repo(rejectingClient(new Error('network'))).findByStripeInvoiceId(STRIPE_INVOICE_ID, WEBHOOK_INVOICE_LOOKUP_COLUMNS)
      ).rejects.toThrow('network');
    });

    it('a hit logs nothing', async () => {
      const { client } = recordingClient({ data: { id: INVOICE_ID }, error: null });
      await repo(client).findByStripeInvoiceId(STRIPE_INVOICE_ID);
      expect(mockLogged).toEqual([]);
    });

    it('accepts only the closed column set (compile time)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      // Never run; exists for `tsc`.
      const typeOnly = () =>
        // @ts-expect-error -- a free-form column list is not one of the constants
        r.findByStripeInvoiceId(STRIPE_INVOICE_ID, 'id, user_id, booking_id');
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('findByIdUnscoped (H2, I1)', () => {
    it('select * by id, single; returns the row', async () => {
      const row = { id: INVOICE_ID, user_id: 'owner-1' };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).findByIdUnscoped(INVOICE_ID);

      expect(calls).toEqual([['from', 'payment_invoices'], ['select', '*'], ['eq', 'id', INVOICE_ID], ['single']]);
      expect(result).toEqual({ data: row, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the same error object through (PGRST116 too), logs nothing', async () => {
      const error = pgError('PGRST116');
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).findByIdUnscoped(INVOICE_ID);
      expect(result).toEqual({ data: null, error });
      expect(result.error).toBe(error);
      expect(mockLogged).toEqual([]);
    });

    it('does not catch a rejected query', async () => {
      await expect(repo(rejectingClient(new Error('network'))).findByIdUnscoped(INVOICE_ID)).rejects.toThrow('network');
    });
  });

  describe('recordStripeInvoiceId (H3)', () => {
    it('updates stripe_invoice_id and updated_at by id, awaited', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).recordStripeInvoiceId(INVOICE_ID, STRIPE_INVOICE_ID);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['update', { stripe_invoice_id: STRIPE_INVOICE_ID, updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', INVOICE_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['stripe_invoice_id', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).recordStripeInvoiceId(INVOICE_ID, STRIPE_INVOICE_ID)).error).toBe(error);
    });
  });

  describe('markPaidFromStripeInvoice (H6)', () => {
    it('writes paid, the given paidAt twice and both documents, in the old key order', async () => {
      const paidAt = '2026-10-08T10:00:00.000Z';
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPaidFromStripeInvoice(INVOICE_ID, {
        paidAt,
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/1',
        invoicePdf: null,
      });

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        [
          'update',
          {
            status: 'paid',
            paid_at: paidAt,
            stripe_hosted_invoice_url: 'https://invoice.stripe.test/i/1',
            stripe_invoice_pdf: null,
            updated_at: paidAt,
          },
        ],
        ['eq', 'id', INVOICE_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual([
        'status',
        'paid_at',
        'stripe_hosted_invoice_url',
        'stripe_invoice_pdf',
        'updated_at',
      ]);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('keeps the document keys when Stripe sent none (undefined, as the inline literal did)', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      await repo(client).markPaidFromStripeInvoice(INVOICE_ID, {
        paidAt: 'p',
        hostedInvoiceUrl: undefined,
        invoicePdf: undefined,
      });
      const payload = calls[1][1] as Record<string, unknown>;
      expect('stripe_hosted_invoice_url' in payload).toBe(true);
      expect('stripe_invoice_pdf' in payload).toBe(true);
      expect(payload.stripe_hosted_invoice_url).toBeUndefined();
    });

    it('passes the error through (the caller throws on it)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await repo(client).markPaidFromStripeInvoice(INVOICE_ID, {
        paidAt: 'p',
        hostedInvoiceUrl: null,
        invoicePdf: null,
      });
      expect(result.error).toBe(error);
    });
  });

  describe('markPaidFromCheckout (I3)', () => {
    it('writes paid with the given paidAt as paid_at and updated_at, by id', async () => {
      const paidAt = '2026-10-08T10:00:00.000Z';
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPaidFromCheckout(INVOICE_ID, paidAt);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['update', { status: 'paid', paid_at: paidAt, updated_at: paidAt }],
        ['eq', 'id', INVOICE_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'paid_at', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through (the caller throws on it)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).markPaidFromCheckout(INVOICE_ID, 'p')).error).toBe(error);
    });
  });

  describe('setStatusFromStripe (J2, L2)', () => {
    it.each(['overdue', 'cancelled'] as const)('writes status %s and a fresh updated_at, by id', async (status) => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).setStatusFromStripe(INVOICE_ID, status);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['update', { status, updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', INVOICE_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('accepts only the two Stripe-mirrored statuses (compile time)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () =>
        // @ts-expect-error -- 'paid' has its own named transitions; nothing else is allowed here
        r.setStatusFromStripe(INVOICE_ID, 'paid');
      expect(typeof typeOnly).toBe('function');
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).setStatusFromStripe(INVOICE_ID, 'overdue')).error).toBe(error);
    });
  });

  describe('recordStripeDocuments (K2)', () => {
    it('writes both documents and a fresh updated_at, by id, in the old key order', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).recordStripeDocuments(INVOICE_ID, {
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/1',
        invoicePdf: 'https://invoice.stripe.test/i/1.pdf',
      });

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        [
          'update',
          {
            stripe_hosted_invoice_url: 'https://invoice.stripe.test/i/1',
            stripe_invoice_pdf: 'https://invoice.stripe.test/i/1.pdf',
            updated_at: expect.stringMatching(ISO),
          },
        ],
        ['eq', 'id', INVOICE_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['stripe_hosted_invoice_url', 'stripe_invoice_pdf', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).recordStripeDocuments(INVOICE_ID, { hostedInvoiceUrl: null, invoicePdf: null })).error).toBe(error);
    });
  });

  describe('readFieldsUnscoped (H8, J3)', () => {
    it('receipt fields: the exact column list (with id, #257), by id, maybeSingle', async () => {
      const row = {
        id: INVOICE_ID,
        user_id: 'owner-1',
        client_email: 'client@example.test',
        client_name: 'Client',
        invoice_number: 'INV-1',
        currency: 'ILS',
        booking_id: null,
      };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await repo(client).readFieldsUnscoped(INVOICE_ID, WEBHOOK_INVOICE_RECEIPT_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['select', 'id, user_id, client_email, client_name, invoice_number, currency, booking_id'],
        ['eq', 'id', INVOICE_ID],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: row, error: null });
      expectNoOwnerFilter(calls);
    });

    it('failed-activity fields: contact_id, amount, currency, by id, maybeSingle', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).readFieldsUnscoped(INVOICE_ID, WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS);

      expect(calls).toEqual([
        ['from', 'payment_invoices'],
        ['select', 'contact_id, amount, currency'],
        ['eq', 'id', INVOICE_ID],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through, logs nothing', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).readFieldsUnscoped(INVOICE_ID, WEBHOOK_INVOICE_RECEIPT_COLUMNS)).error).toBe(error);
      expect(mockLogged).toEqual([]);
    });

    it('accepts only the closed column set (compile time)', () => {
      const r = repo(recordingClient({ data: null, error: null }).client);
      const typeOnly = () =>
        // @ts-expect-error -- a free-form column list is not one of the constants
        r.readFieldsUnscoped(INVOICE_ID, '*');
      expect(typeof typeOnly).toBe('function');
    });

    it('does not catch a rejected query', async () => {
      await expect(
        repo(rejectingClient(new Error('network'))).readFieldsUnscoped(INVOICE_ID, WEBHOOK_INVOICE_RECEIPT_COLUMNS)
      ).rejects.toThrow('network');
    });
  });

  describe('no catch on the writes (PR 1 rule)', () => {
    it.each([
      ['recordStripeInvoiceId', (r: PaymentInvoiceRepository) => r.recordStripeInvoiceId(INVOICE_ID, STRIPE_INVOICE_ID)],
      ['markPaidFromStripeInvoice', (r: PaymentInvoiceRepository) => r.markPaidFromStripeInvoice(INVOICE_ID, { paidAt: 'p', hostedInvoiceUrl: null, invoicePdf: null })],
      ['markPaidFromCheckout', (r: PaymentInvoiceRepository) => r.markPaidFromCheckout(INVOICE_ID, 'p')],
      ['setStatusFromStripe', (r: PaymentInvoiceRepository) => r.setStatusFromStripe(INVOICE_ID, 'cancelled')],
      ['recordStripeDocuments', (r: PaymentInvoiceRepository) => r.recordStripeDocuments(INVOICE_ID, { hostedInvoiceUrl: null, invoicePdf: null })],
    ])('%s rejects when the query rejects', async (_name, call) => {
      await expect(call(repo(rejectingClient(new Error('network'))))).rejects.toThrow('network');
    });
  });

  describe('construction', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((paymentInvoiceRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });

    it('column constants are the exact inline strings', () => {
      expect(WEBHOOK_INVOICE_LOOKUP_COLUMNS).toBe('id, invoice_number, user_id');
      expect(WEBHOOK_INVOICE_RECEIPT_COLUMNS).toBe('id, user_id, client_email, client_name, invoice_number, currency, booking_id');
      expect(WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS).toBe('contact_id, amount, currency');
    });
  });

  // SA C-3 bloat controls, read from the source so they cannot drift silently.
  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    // C-3 is one section per touched class. CF-5 PR 3 gave
    // PaymentTransactionRepository (earlier in the file) its own, so this one
    // is looked up inside PaymentInvoiceRepository.
    const classStart = source.indexOf('export class PaymentInvoiceRepository');
    const sectionStart = source.indexOf(header, classStart);
    // The section runs to the end of the PaymentInvoiceRepository class.
    const sectionEnd = source.indexOf('// Stripe Connect Repository', sectionStart);
    const section = source.slice(sectionStart, sectionEnd);
    const sectionCode = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const NEW_METHODS = [
      'findByIdUnscoped',
      'recordStripeInvoiceId',
      'markPaidFromStripeInvoice',
      'markPaidFromCheckout',
      'setStatusFromStripe',
      'recordStripeDocuments',
      'readFieldsUnscoped',
    ];

    it('has the section header once, holding every new method, each doc carrying the marker', () => {
      expect(classStart).toBeGreaterThan(-1);
      expect(sectionStart).toBeGreaterThan(classStart);
      // Once in this class (from the class to the end of the section, nothing before it).
      expect(source.slice(classStart, sectionEnd).split(header)).toHaveLength(2);
      for (const method of NEW_METHODS) {
        const doc = new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}[(<]`);
        expect(section).toMatch(doc);
      }
    });

    it('the reused findByStripeInvoiceId carries the marker too', () => {
      expect(source).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩ Find invoice by Stripe invoice ID[\s\S]*?\*\/\s*findByStripeInvoiceId\(/);
    });

    it('the section has no generic update, no spread payload, no insert/delete/upsert/rpc, no user_id, no try/catch, no logging', () => {
      expect(sectionCode).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
      expect(sectionCode).not.toMatch(/\.update\(\s*(patch|input|changes|fields|updates)\b/);
      expect(sectionCode).not.toMatch(/\.(insert|delete|upsert|rpc)\(/);
      expect(sectionCode).not.toContain('user_id');
      expect(sectionCode).not.toMatch(/\btry\s*\{/);
      expect(sectionCode).not.toMatch(/\blogger\./);
      expect(sectionCode).not.toContain('booking_id');
    });
  });
});
