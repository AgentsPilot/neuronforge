/**
 * Unit tests for `CreditTransactionRepository.insertReturningId`, the Stripe
 * webhook's legacy boost-pack ledger row (CF-5 PR 5, B4). The repository's
 * only write.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6 and §7.5. It must issue EXACTLY the inline query (insert the row as
 * given, `select('id')`, `.single()`), pass the error through unchanged and
 * never catch (SA CR-P2-1). Injected recording client; no database (SA C-7).
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

import { CreditTransactionRepository, type NewLegacyBoostCreditRow } from '@/lib/repositories/CreditTransactionRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown> | Error = { data: null, error: null }) {
  const calls: Call[] = [];
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'order', 'limit']) {
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

const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

const ROW: NewLegacyBoostCreditRow = {
  user_id: 'agent-platform-user',
  credits_delta: 5000,
  balance_before: 2500,
  balance_after: 7500,
  transaction_type: 'allocation',
  activity_type: 'boost_pack_purchase',
  description: 'Boost pack purchase: 5,000 credits',
  metadata: { stripe_session_id: 'cs_1', stripe_payment_intent_id: 'pi_1', boost_pack_id: 'bp_1', amount_paid_cents: 1000 },
};

beforeEach(() => {
  mockLogged.length = 0;
});

describe('CreditTransactionRepository.insertReturningId (CF-5 PR 5, B4)', () => {
  it("insert the row as given, select('id'), single; the id comes back", async () => {
    const { client, calls } = recordingClient({ data: { id: 'ctx-1' }, error: null });
    const snapshot = JSON.stringify(ROW);
    const result = await new CreditTransactionRepository(client).insertReturningId(ROW);

    expect(calls).toEqual([['from', 'credit_transactions'], ['insert', ROW], ['select', 'id'], ['single']]);
    expect(calls[1][1]).toBe(ROW); // the caller's object, not a copy
    expect(JSON.stringify(ROW)).toBe(snapshot); // not mutated
    expect(result).toEqual({ data: { id: 'ctx-1' }, error: null });
  });

  it('passes the error through (same object), data null, logs nothing (the route logs it)', async () => {
    const error = pgError('23503');
    const { client } = recordingClient({ data: null, error });
    const result = await new CreditTransactionRepository(client).insertReturningId(ROW);
    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
    expect(mockLogged).toEqual([]);
  });

  it('rejects when the query rejects, and logs nothing (no catch, SA CR-P2-1)', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new CreditTransactionRepository(client).insertReturningId(ROW)).rejects.toThrow('network');
    expect(mockLogged).toEqual([]);
  });

  it('the row is closed: an extra key or another activity type fails to compile', () => {
    const { client } = recordingClient();
    const repo = new CreditTransactionRepository(client);
    const typeOnly = () => {
      // @ts-expect-error -- an extra key is not part of the legacy row
      void repo.insertReturningId({ ...ROW, related_agent_id: 'a' } satisfies NewLegacyBoostCreditRow);
      // @ts-expect-error -- only the boost-pack activity is written here
      void repo.insertReturningId({ ...ROW, activity_type: 'welcome_bonus' });
    };
    expect(typeof typeOnly).toBe('function');
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/CreditTransactionRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class CreditTransactionRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section at the end of the class, with the marker on the method', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.split(header)).toHaveLength(2);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async insertReturningId\(/);
    });

    it('the only write in the file, inserting `row` only: no update/upsert/delete/rpc, spread, try/catch or logging', () => {
      expect(source.match(/\.(insert|update|upsert|delete)\(/g)).toEqual(['.insert(']);
      expect(code).toMatch(/\.insert\(row\)/);
      expect(code).not.toMatch(/\.rpc\(|\.\.\./);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/[lL]ogger\./);
    });
  });
});
