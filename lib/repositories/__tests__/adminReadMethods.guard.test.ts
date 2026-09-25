/**
 * The admin read methods added to owner repositories in admin reorganisation
 * slice 2b (SA C-7):
 *
 *   BusinessProfileRepository.findAdminIdentity / findAdminIdentitiesByUserIds
 *   AuditTrailRepository.listAdminAiFailures
 *   UserProfileRepository.listForAdmin
 *
 * Two things are pinned: what each reads (columns, scoping, no filter-string
 * search), and WHO may call it — only `app/api/admin/**`, behind requireAdmin.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BusinessProfileRepository,
  BUSINESS_ADMIN_IDENTITY_COLUMNS,
  ADMIN_IDENTITY_CHUNK,
} from '../BusinessProfileRepository';
import { AuditTrailRepository, ADMIN_AI_FAILURE_COLUMNS } from '../AuditTrailRepository';
import { UserProfileRepository, ADMIN_PROFILE_LIST_COLUMNS, compareForAdminList } from '../UserProfileRepository';
import { ilikeContainsPattern, matchesLiterally } from '../BusinessProfileRepository';

type Call = { method: string; args: unknown[] };

/** Every query is recorded separately; each resolves with `result(query)`. */
function recordingClient(result: (calls: Call[]) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'ilike', 'or', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve(result(calls));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

describe('BusinessProfileRepository admin identity reads', () => {
  it('findAdminIdentity selects exactly name + vertical, scoped by user_id', async () => {
    const row = { user_id: ACCOUNT, company_name: 'Acme', vertical: 'coach', sub_vertical: null };
    const { client, queries } = recordingClient(() => ({ data: row, error: null }));
    const result = await new BusinessProfileRepository(client).findAdminIdentity(ACCOUNT);

    expect(result).toEqual({ data: row, error: null });
    expect(BUSINESS_ADMIN_IDENTITY_COLUMNS).toBe('user_id, company_name, vertical, sub_vertical');
    expect(queries[0]).toContainEqual({ method: 'select', args: [BUSINESS_ADMIN_IDENTITY_COLUMNS] });
    expect(queries[0]).toContainEqual({ method: 'eq', args: ['user_id', ACCOUNT] });
  });

  it('findAdminIdentity returns { data: null, error } on a database error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const result = await new BusinessProfileRepository(client).findAdminIdentity(ACCOUNT);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('findAdminIdentitiesByUserIds batches: one .in() per chunk, never one read per account', async () => {
    const ids = Array.from({ length: ADMIN_IDENTITY_CHUNK + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessProfileRepository(client).findAdminIdentitiesByUserIds([...ids, ids[0]]);

    expect(result.error).toBeNull();
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContainEqual({ method: 'in', args: ['user_id', ids.slice(0, ADMIN_IDENTITY_CHUNK)] });
    expect(queries[1]).toContainEqual({ method: 'in', args: ['user_id', ids.slice(ADMIN_IDENTITY_CHUNK)] });
  });
});

describe('AuditTrailRepository.listAdminAiFailures', () => {
  it('reads only failed Business OS AI actions of the selected account, newest first, bounded', async () => {
    const since = new Date('2026-08-26T00:00:00.000Z');
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new AuditTrailRepository(client).listAdminAiFailures(ACCOUNT, { since, limit: 10 });

    expect(result).toEqual({ data: [], error: null });
    const q = queries[0];
    expect(q).toContainEqual({ method: 'from', args: ['audit_trail'] });
    expect(q).toContainEqual({ method: 'select', args: [ADMIN_AI_FAILURE_COLUMNS] });
    expect(ADMIN_AI_FAILURE_COLUMNS).toBe('id, created_at, entity_id, details');
    expect(q).toContainEqual({ method: 'eq', args: ['user_id', ACCOUNT] });
    expect(q).toContainEqual({ method: 'eq', args: ['action', 'BUSINESS_AI_ACTION_FAILED'] });
    expect(q).toContainEqual({ method: 'gte', args: ['created_at', since.toISOString()] });
    expect(q).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
    expect(q).toContainEqual({ method: 'limit', args: [10] });
  });

  it('returns { data: null, error } on a database error', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const result = await new AuditTrailRepository(client).listAdminAiFailures(ACCOUNT, { since: new Date(), limit: 10 });
    expect(result.data).toBeNull();
  });
});

describe('UserProfileRepository.listForAdmin', () => {
  it('without a search: one ordered, limited read of the allow-listed columns', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new UserProfileRepository(client).listForAdmin({ sortBy: 'created_at', ascending: false, limit: 1000 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContainEqual({ method: 'select', args: [ADMIN_PROFILE_LIST_COLUMNS] });
    expect(queries[0]).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
  });

  it('a hostile search never reaches a filter string: separate ILIKE reads, escaped, merged', async () => {
    const hostile = 'x%),id.neq.(y';
    const rows = {
      full_name: [{ id: 'a', full_name: 'B person', company: null, created_at: '2026-01-02', updated_at: null }],
      company: [{ id: 'b', full_name: 'A person', company: 'x', created_at: '2026-01-01', updated_at: null }],
    };
    const { client, queries } = recordingClient((calls) => {
      const ilike = calls.find((c) => c.method === 'ilike');
      const column = ilike?.args[0] as 'full_name' | 'company';
      return { data: rows[column] ?? [], error: null };
    });
    const result = await new UserProfileRepository(client).listForAdmin({
      search: hostile,
      sortBy: 'full_name',
      ascending: true,
      limit: 100,
    });

    expect(queries.flat().some((c) => c.method === 'or')).toBe(false);
    const ilikes = queries.flat().filter((c) => c.method === 'ilike');
    expect(ilikes).toEqual([
      { method: 'ilike', args: ['full_name', '%x\\%),id.neq.(y%'] },
      { method: 'ilike', args: ['company', '%x\\%),id.neq.(y%'] },
    ]);
    expect(result.data?.map((r) => r.id)).toEqual(['b', 'a']); // merged, sorted by full_name asc
  });

  it('a `*` is literal: sent as a one-character wildcard, then only literal matches are kept (QA E-1)', async () => {
    const rows = [
      { id: 'lit', full_name: 'Star * Clinic', company: null, created_at: '2026-01-01', updated_at: null },
      { id: 'wild', full_name: 'Starx Clinic', company: null, created_at: '2026-01-02', updated_at: null },
    ];
    const { client, queries } = recordingClient((calls) => {
      const ilike = calls.find((c) => c.method === 'ilike');
      return { data: ilike?.args[0] === 'full_name' ? rows : [], error: null };
    });
    const result = await new UserProfileRepository(client).listForAdmin({
      search: 'Star *',
      sortBy: 'created_at',
      ascending: true,
      limit: 100,
    });
    expect(queries.flat().filter((c) => c.method === 'ilike').map((c) => c.args[1])).toEqual(['%Star _%', '%Star _%']);
    expect(result.data?.map((r) => r.id)).toEqual(['lit']);
  });

  it('a lone `*` no longer matches every account', () => {
    expect(ilikeContainsPattern('*')).toBe('%_%');
    expect(matchesLiterally('Acme', '*')).toBe(false);
    expect(matchesLiterally('A*cme', '*')).toBe(true);
  });

  it('sorts a merged search the way the database sorts the list: missing values last ascending, first descending (N-3b)', () => {
    const named = { id: 'n', full_name: 'Bea', company: null, created_at: null, updated_at: null };
    const unnamed = { id: 'u', full_name: null, company: null, created_at: null, updated_at: null };
    const alpha = { id: 'a', full_name: 'Ann', company: null, created_at: null, updated_at: null };
    expect([unnamed, named, alpha].sort((x, y) => compareForAdminList(x, y, 'full_name', true)).map((r) => r.id)).toEqual(['a', 'n', 'u']);
    expect([alpha, unnamed, named].sort((x, y) => compareForAdminList(x, y, 'full_name', false)).map((r) => r.id)).toEqual(['u', 'n', 'a']);
  });

  it('matches a full account id exactly, and includes extra ids (business-name matches)', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new UserProfileRepository(client).listForAdmin({
      search: ACCOUNT,
      extraIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'not-a-uuid'],
      sortBy: 'created_at',
      ascending: false,
      limit: 100,
    });
    const flat = queries.flat();
    expect(flat).toContainEqual({ method: 'eq', args: ['id', ACCOUNT] });
    expect(flat).toContainEqual({ method: 'in', args: ['id', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']] });
  });

  it('returns { data: null, error } when any read fails', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const result = await new UserProfileRepository(client).listForAdmin({
      search: 'dana',
      sortBy: 'created_at',
      ascending: false,
      limit: 10,
    });
    expect(result.data).toBeNull();
  });
});

// ─── Who may call them (SA C-7) ───────────────────────────────────────────────

const ROOT = process.cwd();
const ADMIN_METHODS = ['findAdminIdentity', 'findAdminIdentitiesByUserIds', 'listAdminAiFailures', 'listForAdmin'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '.claude', 'coverage', 'out', 'archive'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

describe('only app/api/admin/** calls the admin read methods', () => {
  const files = ['app', 'lib', 'components', 'hooks', 'scripts']
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => walk(path.join(ROOT, d)));

  it('scanned a real tree', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(ADMIN_METHODS)('%s is called only from app/api/admin/**', (method) => {
    const callPattern = new RegExp(`\\.${method}\\(`);
    const callers = files.filter((file) => {
      if (file.includes('/__tests__/')) return false;
      const code = fs
        .readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return callPattern.test(code);
    });
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.filter((file) => !file.startsWith('app/api/admin/'))).toEqual([]);
  });
});
