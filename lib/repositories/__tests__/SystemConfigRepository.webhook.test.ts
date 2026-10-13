/**
 * Unit tests for `SystemConfigRepository.findRawValue`, the Stripe webhook's
 * grace-period read in the agent-platform dunning handler (CF-5 PR 5, A2).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6 and §7.5. It must issue EXACTLY the inline query (not `getByKey`,
 * which selects `*` with `.single()`), pass the error through unchanged, add
 * no owner filter (a platform-wide table), and never catch (SA CR-P2-1).
 * Injected recording client; no database, no network (SA C-7).
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
    const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => logger };
    return logger;
  },
}));

import { SystemConfigRepository } from '@/lib/repositories/SystemConfigRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown> | Error = { data: null, error: null }) {
  const calls: Call[] = [];
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'limit']) {
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

beforeEach(() => {
  mockLogged.length = 0;
});

describe('SystemConfigRepository.findRawValue (CF-5 PR 5, A2)', () => {
  it("select 'value', eq key, maybeSingle; the row is handed back as it is", async () => {
    const row = { value: '5' };
    const { client, calls } = recordingClient({ data: row, error: null });
    const result = await new SystemConfigRepository(client).findRawValue('payment_grace_period_days');

    expect(calls).toEqual([
      ['from', 'system_settings_config'],
      ['select', 'value'],
      ['eq', 'key', 'payment_grace_period_days'],
      ['maybeSingle'],
    ]);
    expect(result.data).toBe(row);
    expect(result.error).toBeNull();
    expect(JSON.stringify(calls)).not.toContain('user_id');
  });

  it('no row: data null, no error (the route then defaults to 3 days)', async () => {
    const { client } = recordingClient({ data: null, error: null });
    expect(await new SystemConfigRepository(client).findRawValue('payment_grace_period_days')).toEqual({ data: null, error: null });
  });

  it('passes the error through (same object) and logs nothing', async () => {
    const error = pgError();
    const { client } = recordingClient({ data: null, error });
    const result = await new SystemConfigRepository(client).findRawValue('payment_grace_period_days');
    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
    expect(mockLogged).toEqual([]);
  });

  it('rejects when the query rejects, and logs nothing (no catch, SA CR-P2-1)', async () => {
    const { client } = recordingClient(new Error('network'));
    await expect(new SystemConfigRepository(client).findRawValue('payment_grace_period_days')).rejects.toThrow('network');
    expect(mockLogged).toEqual([]);
  });

  it('accepts only the keys the webhook reads (compile time)', () => {
    const { client } = recordingClient();
    const typeOnly = () =>
      // @ts-expect-error -- not a key the webhook reads; a generic config read stays `getByKey`
      new SystemConfigRepository(client).findRawValue('stripe_secret_key');
    expect(typeof typeOnly).toBe('function');
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/SystemConfigRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class SystemConfigRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section at the end of the class, with the marker on the method', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.split(header)).toHaveLength(2);
      expect(section).toMatch(/\/\*\*[^/]*⟨unscoped-by-design⟩[\s\S]*?\*\/\s*async findRawValue\(/);
    });

    it('no write, spread, user_id, try/catch or logging', () => {
      expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
      expect(code).not.toMatch(/\.\.\./);
      expect(code).not.toContain('user_id');
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/[lL]ogger\./);
    });
  });
});
