/**
 * Unit tests for `LegacyBoostPackPurchaseRepository` (agent-platform
 * `boost_pack_purchases`), the Stripe webhook's legacy boost-pack insert
 * (CF-5 PR 5, B5).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6 and §7.5. `insert` must issue EXACTLY the inline query (the row as
 * given, awaited, nothing read back), pass the error through unchanged and
 * never catch (SA CR-P2-1). Recording client; no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockDefaultClient = { defaultServiceRoleClient: true };
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: mockDefaultClient }));

import {
  LegacyBoostPackPurchaseRepository,
  legacyBoostPackPurchaseRepository,
  type NewLegacyBoostPackPurchaseRow,
} from '@/lib/repositories/LegacyBoostPackPurchaseRepository';

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

const ROW: NewLegacyBoostPackPurchaseRow = {
  user_id: 'agent-platform-user',
  boost_pack_id: 'bp_1',
  transaction_id: 'ctx-1',
  credits_purchased: 5000,
  bonus_credits: 0,
  price_paid_usd: 10,
  stripe_payment_intent_id: 'pi_1',
  payment_status: 'succeeded',
  metadata: { stripe_session_id: 'cs_1', boost_pack_id: 'bp_1', amount_total: 1000 },
};

describe('LegacyBoostPackPurchaseRepository (CF-5 PR 5, B5)', () => {
  it('insert the row as given, awaited, nothing read back', async () => {
    const { client, calls } = recordingClient();
    const snapshot = JSON.stringify(ROW);
    const result = await new LegacyBoostPackPurchaseRepository(client).insert(ROW);

    expect(calls).toEqual([['from', 'boost_pack_purchases'], ['insert', ROW], ['await']]);
    expect(calls[1][1]).toBe(ROW);
    expect(JSON.stringify(ROW)).toBe(snapshot);
    expect(result).toEqual({ data: null, error: null });
  });

  it('a null transaction id is passed as null (the credit row failed)', async () => {
    const { client, calls } = recordingClient();
    await new LegacyBoostPackPurchaseRepository(client).insert({ ...ROW, transaction_id: null });
    expect((calls[1][1] as NewLegacyBoostPackPurchaseRow).transaction_id).toBeNull();
  });

  it('passes the error through (same object); the route logs it', async () => {
    const error = pgError('23505');
    const { client } = recordingClient({ data: null, error });
    expect((await new LegacyBoostPackPurchaseRepository(client).insert(ROW)).error).toBe(error);
  });

  it('rejects when the query rejects (no catch, SA CR-P2-1)', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new LegacyBoostPackPurchaseRepository(client).insert(ROW)).rejects.toThrow('network');
  });

  it('the row is closed: an extra key or another payment status fails to compile', () => {
    const { client } = recordingClient();
    const repo = new LegacyBoostPackPurchaseRepository(client);
    const typeOnly = () => {
      // @ts-expect-error -- an extra key is not part of the legacy row
      void repo.insert({ ...ROW, refunded_at: null });
      // @ts-expect-error -- the webhook writes only `succeeded`
      void repo.insert({ ...ROW, payment_status: 'refunded' });
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('defaults to the service-role client, exports a singleton and is in the barrel (new-repository)', () => {
    expect((new LegacyBoostPackPurchaseRepository() as unknown as { supabase: unknown }).supabase).toBe(mockDefaultClient);
    expect((legacyBoostPackPurchaseRepository as unknown as { supabase: unknown }).supabase).toBe(mockDefaultClient);
    const barrel = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
    expect(barrel).toMatch(/export \{\s*LegacyBoostPackPurchaseRepository,\s*legacyBoostPackPurchaseRepository,\s*\} from '\.\/LegacyBoostPackPurchaseRepository';/);
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/LegacyBoostPackPurchaseRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class LegacyBoostPackPurchaseRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const section = source.slice(source.indexOf(header, classStart), classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section with the marker on the one method; the table is the agent-platform one', () => {
      expect(source.split(header)).toHaveLength(2);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async insert\(/);
      expect(code.match(/\.from\('([a-z_]+)'\)/g)).toEqual([".from('boost_pack_purchases')"]);
    });

    it('inserts `row` only: no update/upsert/delete/rpc, spread, select, try/catch or logging', () => {
      expect(code).toMatch(/\.insert\(row\)/);
      expect(code).not.toMatch(/\.(update|upsert|delete|rpc|select)\(|\.\.\./);
      expect(source).not.toMatch(/\btry\s*\{|createLogger|console\./);
    });
  });
});
