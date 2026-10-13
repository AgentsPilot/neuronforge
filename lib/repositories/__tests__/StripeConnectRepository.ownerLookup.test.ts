/**
 * Unit tests for `StripeConnectRepository.findOwnerIdByStripeAccountId`, the
 * Express half of `resolveAccountOwner` (CF-5 PR 5, FU-5 SA rule-1 ruling).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6. It must issue EXACTLY the read the resolver issued inline
 * (`select('user_id')·eq('stripe_account_id')·maybeSingle`), add no owner
 * filter (the owner is its output), hand back supabase-js's own error object
 * so the resolver can throw FU-5's error, and never catch (SA CR-P2-1).
 * Covers data, miss, error and reject. Injected recording client (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => ({}) };
  },
}));

import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown> | Error = { data: null, error: null }) {
  const calls: Call[] = [];
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
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
      return settle();
    };
  }
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  mockLogged.length = 0;
});

describe('StripeConnectRepository.findOwnerIdByStripeAccountId (CF-5 PR 5)', () => {
  it("data: select('user_id'), eq stripe_account_id, maybeSingle; the row is handed back", async () => {
    const row = { user_id: 'owner-a' };
    const { client, calls } = recordingClient({ data: row, error: null });
    const result = await new StripeConnectRepository(client).findOwnerIdByStripeAccountId('acct_a');

    expect(calls).toEqual([
      ['from', 'stripe_connect_accounts'],
      ['select', 'user_id'],
      ['eq', 'stripe_account_id', 'acct_a'],
      ['maybeSingle'],
    ]);
    expect(result.data).toBe(row);
    expect(result.error).toBeNull();
    // Unscoped by design: the owner is the output, so no owner filter.
    expect(calls.filter(([method, column]) => method === 'eq' && column === 'user_id')).toEqual([]);
  });

  it('miss: data null, no error', async () => {
    const { client } = recordingClient({ data: null, error: null });
    expect(await new StripeConnectRepository(client).findOwnerIdByStripeAccountId('acct_unknown')).toEqual({ data: null, error: null });
  });

  it('error: the same error object comes back, and nothing is logged (the resolver throws FU-5\'s error)', async () => {
    const error = { code: 'XX000', message: 'connection reset', details: '', hint: '' };
    const { client } = recordingClient({ data: null, error });
    const result = await new StripeConnectRepository(client).findOwnerIdByStripeAccountId('acct_a');
    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
    expect(mockLogged).toEqual([]);
  });

  it('reject: a rejected query rejects (no catch), nothing logged', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new StripeConnectRepository(client).findOwnerIdByStripeAccountId('acct_a')).rejects.toThrow('network');
    expect(mockLogged).toEqual([]);
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class StripeConnectRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section inside the class, at its end, with the marker on the method', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async findOwnerIdByStripeAccountId\(/);
    });

    it('reads user_id only: no write, spread, other column, try/catch or logging', () => {
      expect(code).toContain(".select('user_id')");
      expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|\.\.\./);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/\blogger\./);
    });
  });
});
