/**
 * QA (CF-5 PR 5): `resolveAccountOwner` through the REAL repositories, over a
 * recording client.
 *
 * `stripeAccountContext.test.ts` stands the two tables in with a hand-written
 * fake that answers any chain, so it cannot see which columns, filters and
 * terminals the resolver now asks its repositories for. This file pins:
 *
 *   1. The exact reads, on the client the resolver was handed (never the
 *      shared `supabaseServer`): Express by `stripe_account_id`, `maybeSingle`;
 *      then, only after an Express miss, every `stripe` plugin connection of
 *      ANY status (no status filter, no token column).
 *   2. FU-5: a returned error throws the table-and-code message, and a read that
 *      rejects or throws synchronously rejects with that same error.
 *   3. Tenant isolation: `listByPluginKey` (every tenant's `profile_data`) and
 *      `findOwnerIdByStripeAccountId` are called from the resolver only.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 5). No database.
 */

import fs from 'fs';
import path from 'path';

// The shared client must not be reached: the resolver works on its argument.
jest.mock('@/lib/supabaseServer', () => {
  const client = {
    from: (table: string) => {
      throw new Error(`supabaseServer used for ${table}`);
    },
  };
  return { supabaseServer: client, createServerSupabaseClient: () => client };
});
jest.mock('@/lib/logger', () => {
  const l: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) l[level] = () => undefined;
  l.child = () => l;
  return { createLogger: () => l };
});

import { resolveAccountOwner } from '../stripeAccountContext';

type Rule = { data: unknown; error: unknown } | { reject: unknown } | { throwSync: unknown };
interface Read {
  table: string;
  chain: unknown[][];
  terminal: string;
}

function recordingDb(rules: Record<string, Rule>) {
  const reads: Read[] = [];
  const builder = (table: string, chain: unknown[][]): unknown => {
    const resolve = (terminal: string) => {
      reads.push({ table, chain, terminal });
      const rule = rules[table];
      if (rule && 'throwSync' in rule) throw rule.throwSync;
      if (rule && 'reject' in rule) return Promise.reject(rule.reject);
      return Promise.resolve(rule ?? { data: null, error: null });
    };
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => {
              let p: Promise<unknown>;
              try {
                p = resolve('await');
              } catch (e) {
                p = Promise.reject(e);
              }
              return p.then(f, r);
            };
          }
          if (prop === 'single' || prop === 'maybeSingle') return () => resolve(String(prop));
          return (...args: unknown[]) => builder(table, [...chain, [String(prop), ...args]]);
        },
      }
    );
  };
  return { reads, db: { from: (table: string) => builder(table, []) } };
}

const EXPRESS_READ: Read = {
  table: 'stripe_connect_accounts',
  chain: [['select', 'user_id'], ['eq', 'stripe_account_id', 'acct_x']],
  terminal: 'maybeSingle',
};
const PLUGIN_READ: Read = {
  table: 'plugin_connections',
  chain: [['select', 'user_id, profile_data, status'], ['eq', 'plugin_key', 'stripe']],
  terminal: 'await',
};
const ok = (data: unknown) => ({ data, error: null });

describe('QA CF-5 PR 5: resolveAccountOwner through its repositories', () => {
  it('Express hit: one read, the exact chain, on the injected client; the plugin table is not read', async () => {
    const { db, reads } = recordingDb({ stripe_connect_accounts: ok({ user_id: 'u1' }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's narrow client type
    expect(await resolveAccountOwner(db as any, 'acct_x')).toBe('u1');
    expect(reads).toEqual([EXPRESS_READ]);
  });

  it('Express miss: then every stripe connection of any status (no status filter), matched in memory', async () => {
    const { db, reads } = recordingDb({
      plugin_connections: ok([
        { user_id: 'u-other', profile_data: { stripe_account_id: 'acct_y' }, status: 'active' },
        { user_id: 'u-revoked', profile_data: { stripe_account_id: 'acct_x' }, status: 'revoked' },
      ]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's narrow client type
    expect(await resolveAccountOwner(db as any, 'acct_x')).toBe('u-revoked');
    expect(reads).toEqual([EXPRESS_READ, PLUGIN_READ]);
  });

  it('both miss: null, after exactly the two reads', async () => {
    const { db, reads } = recordingDb({ plugin_connections: ok([{ user_id: 'u', profile_data: null, status: null }]) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's narrow client type
    expect(await resolveAccountOwner(db as any, 'acct_x')).toBeNull();
    expect(reads).toEqual([EXPRESS_READ, PLUGIN_READ]);
  });

  it.each([
    ['stripe_connect_accounts', 'Account owner lookup failed on stripe_connect_accounts (code PGRST301)', [EXPRESS_READ]],
    ['plugin_connections', 'Account owner lookup failed on plugin_connections (code PGRST301)', [EXPRESS_READ, PLUGIN_READ]],
  ] as const)('FU-5: a returned error on %s throws the table-and-code message, and nothing is read after it', async (table, message, expected) => {
    const { db, reads } = recordingDb({ [table]: { data: null, error: { code: 'PGRST301', message: 'acct_x secret' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's narrow client type
    await expect(resolveAccountOwner(db as any, 'acct_x')).rejects.toThrow(new Error(message));
    expect(reads).toEqual(expected);
  });

  it.each([
    ['stripe_connect_accounts', 'reject'],
    ['stripe_connect_accounts', 'throwSync'],
    ['plugin_connections', 'reject'],
    ['plugin_connections', 'throwSync'],
  ] as const)('a %s read that fails with %s rejects with that same error (no catch, never "no business")', async (table, how) => {
    const boom = new Error(`${table} ${how}`);
    const { db } = recordingDb({ [table]: how === 'reject' ? { reject: boom } : { throwSync: boom } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's narrow client type
    const error = await resolveAccountOwner(db as any, 'acct_x').catch((e: unknown) => e);
    expect(error).toBe(boom);
  });
});

describe('QA CF-5 PR 5: the two owner-lookup reads have one caller (tenant isolation)', () => {
  const ROOT = process.cwd();
  const METHODS = ['listByPluginKey', 'findOwnerIdByStripeAccountId'];
  const found: Record<string, string[]> = Object.fromEntries(METHODS.map((m) => [m, []]));
  // One pass over the server and client source trees (tests excluded).
  beforeAll(() => {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          for (const m of METHODS) if (text.includes(`.${m}(`)) found[m].push(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    };
    for (const top of ['app', 'lib', 'components', 'hooks']) {
      if (fs.existsSync(path.join(ROOT, top))) walk(path.join(ROOT, top));
    }
  });
  const callers = (method: string) => [...found[method]].sort();

  it('listByPluginKey (every tenant\'s profile_data) is called from resolveAccountOwner only', () => {
    expect(callers('listByPluginKey')).toEqual(['lib/payments/stripeAccountContext.ts']);
  });

  it('findOwnerIdByStripeAccountId is called from resolveAccountOwner only', () => {
    expect(callers('findOwnerIdByStripeAccountId')).toEqual(['lib/payments/stripeAccountContext.ts']);
  });
});
