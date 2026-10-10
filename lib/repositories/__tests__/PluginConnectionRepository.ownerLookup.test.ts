/**
 * Unit tests for `PluginConnectionRepository.listByPluginKey`, the OAuth half
 * of `resolveAccountOwner` (CF-5 PR 5, FU-5 SA rule-1 ruling).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6. It must issue EXACTLY the read the resolver issued inline
 * (`select('user_id, profile_data, status')·eq('plugin_key')`, awaited) with NO
 * status filter (unlike `findActiveByProfileData`, SA FU-5), never read the
 * token columns, hand back supabase-js's own error object so the resolver can
 * throw FU-5's error, and never catch (SA CR-P2-1). Covers data, miss, error
 * and reject. Injected recording client (SA C-7).
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

import { PluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown> | Error = { data: null, error: null }) {
  const calls: Call[] = [];
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'contains', 'order', 'limit']) {
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

beforeEach(() => {
  mockLogged.length = 0;
});

describe('PluginConnectionRepository.listByPluginKey (CF-5 PR 5)', () => {
  it('data: select user_id, profile_data, status; eq plugin_key; awaited; every status, rows handed back', async () => {
    const rows = [
      { user_id: 'u1', profile_data: { stripe_account_id: 'acct_b' }, status: 'active' },
      { user_id: 'u2', profile_data: { id: 'acct_c' }, status: 'expired' },
    ];
    const { client, calls } = recordingClient({ data: rows, error: null });
    const result = await new PluginConnectionRepository(client).listByPluginKey('stripe');

    expect(calls).toEqual([
      ['from', 'plugin_connections'],
      ['select', 'user_id, profile_data, status'],
      ['eq', 'plugin_key', 'stripe'],
      ['await'],
    ]);
    expect(result.data).toBe(rows);
    expect(result.error).toBeNull();
    // No status filter (an expired connection still maps its account), no
    // owner filter (the owner is the output), no token column.
    expect(calls.filter(([method]) => ['eq', 'neq', 'in', 'is', 'not', 'contains'].includes(method))).toEqual([
      ['eq', 'plugin_key', 'stripe'],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/token/);
  });

  it('miss: an empty list, no error', async () => {
    const { client } = recordingClient({ data: [], error: null });
    expect(await new PluginConnectionRepository(client).listByPluginKey('stripe')).toEqual({ data: [], error: null });
  });

  it("error: the same error object comes back, and nothing is logged (the resolver throws FU-5's error)", async () => {
    const error = { code: '57014', message: 'canceling statement', details: '', hint: '' };
    const { client } = recordingClient({ data: null, error });
    const result = await new PluginConnectionRepository(client).listByPluginKey('stripe');
    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
    expect(mockLogged).toEqual([]);
  });

  it('reject: a rejected query rejects (no catch), nothing logged', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new PluginConnectionRepository(client).listByPluginKey('stripe')).rejects.toThrow('network');
    expect(mockLogged).toEqual([]);
  });

  it('reads only the plugin keys it is for (compile time)', () => {
    const { client } = recordingClient();
    const typeOnly = () =>
      // @ts-expect-error -- a cross-tenant list of another plugin's profile_data is not offered
      new PluginConnectionRepository(client).listByPluginKey('google-mail');
    expect(typeof typeOnly).toBe('function');
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PluginConnectionRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class PluginConnectionRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section at the end of the class, with the marker on the method', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.split(header)).toHaveLength(2);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async listByPluginKey\(/);
    });

    it("no status filter, no write, spread, try/catch or logging; not `select('*')`", () => {
      expect(code).not.toMatch(/'status',/);
      expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc|contains)\(|\.\.\./);
      expect(code).not.toContain("select('*')");
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/[lL]ogger\./);
    });
  });
});
