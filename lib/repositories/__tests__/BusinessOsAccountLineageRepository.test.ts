/**
 * BusinessOsAccountLineageRepository (Slice 1b, L-6): one read, no writer.
 * The finalise function is the only thing that inserts lineage.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestError } from '@supabase/postgrest-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BusinessOsAccountLineageRepository, LINEAGE_LOOKUP_LIMIT } from '../BusinessOsAccountLineageRepository';

function client(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  return {
    client: { from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder) } as unknown as SupabaseClient,
    calls,
  };
}

const INVITE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  logged.length = 0;
});

describe('findByInviteIdsForAdmin', () => {
  it('reads account, invite and level for the given invites', async () => {
    const rows = [{ account_id: 'a', invite_id: INVITE, level: 1 }];
    const { client: c, calls } = client({ data: rows, error: null });
    expect(await new BusinessOsAccountLineageRepository(c).findByInviteIdsForAdmin([INVITE])).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_account_lineage'] },
      { method: 'select', args: ['account_id, invite_id, level'] },
      { method: 'in', args: ['invite_id', [INVITE]] },
    ]);
  });

  it('no ids: no query at all', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    expect(await new BusinessOsAccountLineageRepository(c).findByInviteIdsForAdmin([])).toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });

  it('too many ids is refused, not truncated', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    const ids = Array.from({ length: LINEAGE_LOOKUP_LIMIT + 1 }, (_value, index) => `id-${index}`);
    const result = await new BusinessOsAccountLineageRepository(c).findByInviteIdsForAdmin(ids);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('an error is scrubbed to { code, message } (M-1)', async () => {
    const dbError = new PostgrestError({ code: '42501', message: 'permission denied', details: 'row x@example.com', hint: '' });
    const result = await new BusinessOsAccountLineageRepository(client({ data: null, error: dbError }).client).findByInviteIdsForAdmin([INVITE]);
    expect(result.error).not.toHaveProperty('details');
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(JSON.stringify(logged)).not.toContain('x@example.com');
  });
});

describe('no writer', () => {
  it('has exactly one method, and no insert/update/upsert/delete call', () => {
    const methods = Object.getOwnPropertyNames(BusinessOsAccountLineageRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods).toEqual(['findByInviteIdsForAdmin']);
    const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'BusinessOsAccountLineageRepository.ts'), 'utf8');
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
