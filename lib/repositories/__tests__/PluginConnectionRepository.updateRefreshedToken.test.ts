/**
 * Unit tests for `PluginConnectionRepository.updateRefreshedToken` (data export
 * DE-0b, BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.1.2 S1). The legacy AgentKit
 * token refresh used to write `access_token, expires_at` with the caller's
 * cookie client; DE-0b revokes those columns from `authenticated`, so the write
 * moves here (service role). It must stay scoped to one user's one connection,
 * write a fixed field list, and never select or log the token.
 */

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

function recordingClient(answer: Record<string, unknown> | Error) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'upsert', 'insert', 'eq', 'neq', 'or', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    const settled = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    return settled.then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const TOKEN = { accessToken: 'ya29.secret-access', expiresAt: '2026-10-14T12:00:00.000Z' };

beforeEach(() => {
  mockLogged.length = 0;
});

describe('PluginConnectionRepository.updateRefreshedToken (DE-0b S1)', () => {
  it('updates access_token, expires_at and updated_at only, scoped by user_id and plugin_key', async () => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    const result = await new PluginConnectionRepository(client).updateRefreshedToken('user-1', 'google-mail', TOKEN);

    expect(result).toEqual({ data: true, error: null });
    expect(calls[0]).toEqual(['from', 'plugin_connections']);
    const update = calls.find(([m]) => m === 'update')!;
    const patch = update[1] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['access_token', 'expires_at', 'updated_at']);
    expect(patch.access_token).toBe(TOKEN.accessToken);
    expect(patch.expires_at).toBe(TOKEN.expiresAt);
    expect(update[2]).toEqual({ count: 'exact' });
    expect(calls.filter(([m]) => ['eq', 'neq', 'or', 'in'].includes(m))).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'plugin_key', 'google-mail'],
    ]);
    // Nothing is read back: no select, so the token never returns.
    expect(calls.some(([m]) => m === 'select' || m === 'upsert' || m === 'insert')).toBe(false);
  });

  it('a null expiry is written as null', async () => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    await new PluginConnectionRepository(client).updateRefreshedToken('user-1', 'notion', {
      accessToken: 'tok',
      expiresAt: null,
    });
    const patch = calls.find(([m]) => m === 'update')![1] as Record<string, unknown>;
    expect(patch.expires_at).toBeNull();
  });

  it('no matching row: data false, a warning without the token', async () => {
    const { client } = recordingClient({ error: null, count: 0 });
    const result = await new PluginConnectionRepository(client).updateRefreshedToken('user-1', 'google-mail', TOKEN);
    expect(result).toEqual({ data: false, error: null });
    expect(mockLogged.map((l) => l.level)).toEqual(['warn']);
    expect(JSON.stringify(mockLogged)).not.toContain(TOKEN.accessToken);
  });

  it('a database error comes back as error, logged without the token', async () => {
    const dbError = { code: '42501', message: 'permission denied', details: '', hint: '' };
    const { client } = recordingClient({ error: dbError, count: null });
    const result = await new PluginConnectionRepository(client).updateRefreshedToken('user-1', 'google-mail', TOKEN);
    expect(result.data).toBeNull();
    expect(result.error).toBe(dbError);
    expect(mockLogged.map((l) => l.level)).toEqual(['error']);
    expect(JSON.stringify(mockLogged)).not.toContain(TOKEN.accessToken);
  });

  it('a rejected query is caught and returned', async () => {
    const { client } = recordingClient(new Error('network'));
    const result = await new PluginConnectionRepository(client).updateRefreshedToken('user-1', 'google-mail', TOKEN);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('network');
  });

  it.each([
    ['', 'google-mail', TOKEN],
    ['user-1', '', TOKEN],
    ['user-1', 'google-mail', { accessToken: '', expiresAt: null }],
  ])('refuses a missing scope or token without touching the table (%#)', async (userId, pluginKey, token) => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    const result = await new PluginConnectionRepository(client).updateRefreshedToken(userId, pluginKey, token);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });
});
