/**
 * AuditTrailRepository.listOwnerEntries (Layer 3 step 0, FR-23, FR-27, AC-26 / T-O1).
 *
 * A fake PostgREST builder records every filter applied, so the test asserts the
 * query itself: scoped to the owner, with AI audit entries excluded in SQL.
 * (Whether real PostgREST accepts the `not like` filter's encoding is proven
 * live, WC-7.)
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { AuditTrailRepository } from '../AuditTrailRepository';

type Call = [string, ...unknown[]];

function fakeClient(result: { data: unknown; error: unknown; count: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push(['range', ...args]);
    return Promise.resolve(result);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';

describe('listOwnerEntries', () => {
  it('scopes to the owner and excludes AI entries in the query', async () => {
    const rows = [{ id: 'r1', action: 'USER_LOGIN', entity_type: 'user' }];
    const { client, calls } = fakeClient({ data: rows, error: null, count: 1 });

    const result = await new AuditTrailRepository(client).listOwnerEntries(OWNER, { page: 1, limit: 1000 });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ logs: rows, total: 1, page: 1, limit: 1000, hasMore: false });
    expect(calls).toContainEqual(['from', 'audit_trail']);
    expect(calls).toContainEqual(['eq', 'user_id', OWNER]);
    expect(calls).toContainEqual(['neq', 'entity_type', 'ai_action']);
    expect(calls).toContainEqual(['not', 'action', 'like', 'BUSINESS_AI_ACTION_%']);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(calls).toContainEqual(['range', 0, 999]);
  });

  it('counts the same filtered rows, and selects an explicit column list without hash or user_email', async () => {
    const { client, calls } = fakeClient({ data: [], error: null, count: 0 });
    await new AuditTrailRepository(client).listOwnerEntries(OWNER, { page: 1, limit: 10 });

    const select = calls.find((c) => c[0] === 'select')!;
    expect(select[2]).toEqual({ count: 'exact' });
    const columns = String(select[1]).split(',').map((c) => c.trim());
    expect(columns).not.toContain('*');
    expect(columns).not.toContain('hash');
    expect(columns).not.toContain('user_email');
    for (const used of ['id', 'action', 'entity_type', 'entity_id', 'resource_name', 'changes', 'details', 'ip_address', 'user_agent', 'session_id', 'severity', 'compliance_flags', 'created_at']) {
      expect(columns).toContain(used);
    }
  });

  it('applies the optional filters and paginates with an inclusive range', async () => {
    const { client, calls } = fakeClient({ data: [], error: null, count: 45 });
    const result = await new AuditTrailRepository(client).listOwnerEntries(OWNER, {
      action: 'USER_LOGIN',
      entityType: 'user',
      severity: 'info',
      page: 2,
      limit: 20,
    });
    expect(calls).toContainEqual(['eq', 'action', 'USER_LOGIN']);
    expect(calls).toContainEqual(['eq', 'entity_type', 'user']);
    expect(calls).toContainEqual(['eq', 'severity', 'info']);
    expect(calls).toContainEqual(['range', 20, 39]);
    expect(result.data?.hasMore).toBe(true);
  });

  it.each([[{ entityType: 'ai_action' }], [{ action: 'BUSINESS_AI_ACTION_COMPLETED' }], [{ action: 'BUSINESS_AI_ACTION_FAILED' }]])(
    'answers a request for AI entries with nothing, without querying: %j',
    async (filter) => {
      const { client, calls } = fakeClient({ data: [{ id: 'should-not-appear' }], error: null, count: 1 });
      const result = await new AuditTrailRepository(client).listOwnerEntries(OWNER, { ...filter, page: 1, limit: 50 });
      expect(result.data).toEqual({ logs: [], total: 0, page: 1, limit: 50, hasMore: false });
      expect(calls).toHaveLength(0);
    }
  );

  it('returns the error rather than throwing', async () => {
    const { client } = fakeClient({ data: null, error: new Error('boom'), count: null });
    const result = await new AuditTrailRepository(client).listOwnerEntries(OWNER, { page: 1, limit: 10 });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
