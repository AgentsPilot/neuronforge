/**
 * Unit tests for `BillingEventRepository` (agent-platform `billing_events`),
 * the Stripe webhook's two legacy inserts (CF-5 PR 5, A4 and N2).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6 and §7.5. `insert` must issue EXACTLY the inline query (the row as
 * given, awaited, nothing read back), keep the rows byte for byte (their odd
 * columns included), pass the error through unchanged and never catch (SA
 * CR-P2-1). Recording client; no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockDefaultClient = { defaultServiceRoleClient: true };
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: mockDefaultClient }));

import {
  BillingEventRepository,
  billingEventRepository,
  type NewLegacyBillingEventRow,
} from '@/lib/repositories/BillingEventRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown> | Error = { data: null, error: null }) {
  const calls: Call[] = [];
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = (...args: unknown[]) => {
      calls.push([terminal, ...args]);
      return settle();
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return settle().then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

/** A4: the dunning row, `stripe_event_id` holding the invoice id exactly as the route wrote it. */
const DUNNING_ROW: NewLegacyBillingEventRow = {
  user_id: 'agent-platform-user',
  event_type: 'renewal_failed',
  credits_delta: 0,
  description: 'Payment failed (attempt 1). Grace period active (3 days).',
  stripe_event_id: 'in_1',
  stripe_invoice_id: 'in_1',
  amount_cents: 2000,
  currency: 'usd',
};

/** N2: the cancellation row, four keys. */
const CANCEL_ROW: NewLegacyBillingEventRow = {
  user_id: 'agent-platform-user',
  event_type: 'subscription_canceled',
  credits_delta: 0,
  description: 'Subscription canceled',
};

describe('BillingEventRepository (CF-5 PR 5, A4 / N2)', () => {
  it.each([
    ['A4 dunning row', DUNNING_ROW],
    ['N2 cancellation row', CANCEL_ROW],
  ])('%s: insert the row as given, awaited, nothing read back', async (_label, row) => {
    const { client, calls } = recordingClient();
    const snapshot = JSON.stringify(row);
    const result = await new BillingEventRepository(client).insert(row);

    expect(calls).toEqual([['from', 'billing_events'], ['insert', row], ['await']]);
    expect(calls[1][1]).toBe(row);
    expect(JSON.stringify(row)).toBe(snapshot);
    expect(result).toEqual({ data: null, error: null });
  });

  it('passes the error through (same object); the webhook discards it today (FU-9)', async () => {
    const error = pgError();
    const { client } = recordingClient({ data: null, error });
    expect((await new BillingEventRepository(client).insert(CANCEL_ROW)).error).toBe(error);
  });

  it('rejects when the query rejects (no catch, SA CR-P2-1)', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new BillingEventRepository(client).insert(DUNNING_ROW)).rejects.toThrow('network');
  });

  it('the row is closed: an extra key or another event type fails to compile', () => {
    const { client } = recordingClient();
    const repo = new BillingEventRepository(client);
    const typeOnly = () => {
      // @ts-expect-error -- an extra key is not part of the legacy row
      void repo.insert({ ...CANCEL_ROW, metadata: {} });
      // @ts-expect-error -- only the two legacy event types are written here
      void repo.insert({ ...CANCEL_ROW, event_type: 'credits_granted' });
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('defaults to the service-role client, exports a singleton and is in the barrel (new-repository)', () => {
    expect((new BillingEventRepository() as unknown as { supabase: unknown }).supabase).toBe(mockDefaultClient);
    expect((billingEventRepository as unknown as { supabase: unknown }).supabase).toBe(mockDefaultClient);
    const barrel = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
    expect(barrel).toContain("export { BillingEventRepository, billingEventRepository } from './BillingEventRepository';");
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/BillingEventRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class BillingEventRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const section = source.slice(source.indexOf(header, classStart), classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section with the marker on the one method; the table is billing_events, not the Business OS one', () => {
      expect(source.split(header)).toHaveLength(2);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async insert\(/);
      expect(code.match(/\.from\('([a-z_]+)'\)/g)).toEqual(["from('billing_events')"].map((s) => `.${s}`));
    });

    it('inserts `row` only: no update/upsert/delete/rpc, spread, select, try/catch or logging', () => {
      expect(code).toMatch(/\.insert\(row\)/);
      expect(code).not.toMatch(/\.(update|upsert|delete|rpc|select)\(|\.\.\./);
      expect(source).not.toMatch(/\btry\s*\{|createLogger|console\./);
    });
  });
});
