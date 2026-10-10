/**
 * Unit tests for the Stripe webhook's agent-platform legacy methods on
 * UserSubscriptionRepository (CF-5 PR 5).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.6 and §7.5. Each method must issue EXACTLY the query the route issued
 * inline (A1, A3, B2, B3, C1, N1), keep its `.eq('user_id', userId)` (the only
 * control on a service-role write), pass the error object through unchanged
 * and never catch a throw (SA CR-P2-1).
 *
 * The client is injected: a recording fake whose answer each test sets. No
 * database, no network (SA C-7).
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

import { UserSubscriptionRepository } from '@/lib/repositories/UserSubscriptionRepository';

type Call = [method: string, ...args: unknown[]];

/** A PostgREST stand-in that records the chain and answers `answer` at the terminal. */
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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });
const USER = 'agent-platform-user';

function expectScopedOnce(calls: Call[]) {
  const ownerFilters = calls.filter(([method, column]) => method === 'eq' && column === 'user_id');
  expect(ownerFilters).toEqual([['eq', 'user_id', USER]]);
}

beforeEach(() => {
  mockLogged.length = 0;
});

describe('UserSubscriptionRepository: Stripe webhook legacy methods (CF-5 PR 5)', () => {
  describe('findDunningState (A1)', () => {
    it('select the three dunning columns, eq user_id, single; hands the row back', async () => {
      const row = { payment_retry_count: 2, grace_period_days: 5, current_period_end: null };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await new UserSubscriptionRepository(client).findDunningState(USER);

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['select', 'payment_retry_count, grace_period_days, current_period_end'],
        ['eq', 'user_id', USER],
        ['single'],
      ]);
      expect(result.data).toBe(row);
      expect(result.error).toBeNull();
      expectScopedOnce(calls);
    });

    it('no row: the PGRST116 error object comes back as it is, data null, nothing logged', async () => {
      const error = pgError('PGRST116');
      const { client } = recordingClient({ data: null, error });
      const result = await new UserSubscriptionRepository(client).findDunningState(USER);
      expect(result).toEqual({ data: null, error });
      expect(result.error).toBe(error);
      expect(mockLogged).toEqual([]);
    });
  });

  describe('recordPaymentFailure (A3)', () => {
    it.each([
      ['past_due', true],
      ['active', false],
    ] as const)('status %s: {payment_retry_count, last_payment_attempt, status, agents_paused} in that order, eq user_id, awaited', async (status, agentsPaused) => {
      const { client, calls } = recordingClient();
      const result = await new UserSubscriptionRepository(client).recordPaymentFailure(USER, { retryCount: 3, status, agentsPaused });

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['update', { payment_retry_count: 3, last_payment_attempt: expect.stringMatching(ISO), status, agents_paused: agentsPaused }],
        ['eq', 'user_id', USER],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['payment_retry_count', 'last_payment_attempt', 'status', 'agents_paused']);
      expect(result).toEqual({ data: null, error: null });
      expectScopedOnce(calls);
    });

    it('passes the error through (the webhook discards it today, FU-9)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await new UserSubscriptionRepository(client).recordPaymentFailure(USER, { retryCount: 1, status: 'active', agentsPaused: false });
      expect(result.error).toBe(error);
    });

    it('accepts only the two dunning statuses (compile time)', () => {
      const { client } = recordingClient();
      const typeOnly = () =>
        // @ts-expect-error -- the dunning handler never writes `canceled`
        new UserSubscriptionRepository(client).recordPaymentFailure(USER, { retryCount: 1, status: 'canceled', agentsPaused: false });
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('findBalance (B2)', () => {
    it('select balance, total_earned, eq user_id, single', async () => {
      const row = { balance: 2500, total_earned: 4000 };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await new UserSubscriptionRepository(client).findBalance(USER);

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['select', 'balance, total_earned'],
        ['eq', 'user_id', USER],
        ['single'],
      ]);
      expect(result.data).toBe(row);
      expectScopedOnce(calls);
    });

    it('no row: data null, the error object as it is', async () => {
      const error = pgError('PGRST116');
      const { client } = recordingClient({ data: null, error });
      expect((await new UserSubscriptionRepository(client).findBalance(USER)).error).toBe(error);
    });
  });

  describe('applyBoostPackBalance (B3)', () => {
    it('{balance, total_earned, free_tier_expires_at: null, account_frozen: false} in that order, eq user_id, awaited', async () => {
      const { client, calls } = recordingClient();
      const result = await new UserSubscriptionRepository(client).applyBoostPackBalance(USER, { balance: 7500, totalEarned: 9000 });

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['update', { balance: 7500, total_earned: 9000, free_tier_expires_at: null, account_frozen: false }],
        ['eq', 'user_id', USER],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['balance', 'total_earned', 'free_tier_expires_at', 'account_frozen']);
      expect(result).toEqual({ data: null, error: null });
      expectScopedOnce(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await new UserSubscriptionRepository(client).applyBoostPackBalance(USER, { balance: 1, totalEarned: 1 })).error).toBe(error);
    });
  });

  describe('mirrorStripeStatus (C1)', () => {
    it.each([
      [{ cancelAtPeriodEnd: true, canceledAt: '2026-10-01T00:00:00.000Z', status: 'canceled' }],
      [{ cancelAtPeriodEnd: false, canceledAt: null, status: 'active' }],
    ])('{cancel_at_period_end, canceled_at, status} in that order, values as given, eq user_id, awaited (%o)', async (mirror) => {
      const { client, calls } = recordingClient();
      const result = await new UserSubscriptionRepository(client).mirrorStripeStatus(USER, mirror);

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['update', { cancel_at_period_end: mirror.cancelAtPeriodEnd, canceled_at: mirror.canceledAt, status: mirror.status }],
        ['eq', 'user_id', USER],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['cancel_at_period_end', 'canceled_at', 'status']);
      expect(result).toEqual({ data: null, error: null });
      expectScopedOnce(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await new UserSubscriptionRepository(client).mirrorStripeStatus(USER, { cancelAtPeriodEnd: false, canceledAt: null, status: 'active' });
      expect(result.error).toBe(error);
    });
  });

  describe('markCanceled (N1)', () => {
    it("{status: 'canceled', canceled_at: now, cancel_at_period_end: false} in that order, eq user_id, awaited", async () => {
      const { client, calls } = recordingClient();
      const result = await new UserSubscriptionRepository(client).markCanceled(USER);

      expect(calls).toEqual([
        ['from', 'user_subscriptions'],
        ['update', { status: 'canceled', canceled_at: expect.stringMatching(ISO), cancel_at_period_end: false }],
        ['eq', 'user_id', USER],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'canceled_at', 'cancel_at_period_end']);
      expect(result).toEqual({ data: null, error: null });
      expectScopedOnce(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await new UserSubscriptionRepository(client).markCanceled(USER)).error).toBe(error);
    });
  });

  describe('no catch (SA CR-P2-1: a rejected query must reach the route)', () => {
    const repo = (client: SupabaseClient) => new UserSubscriptionRepository(client);
    it.each([
      ['findDunningState', (c: SupabaseClient) => repo(c).findDunningState(USER)],
      ['recordPaymentFailure', (c: SupabaseClient) => repo(c).recordPaymentFailure(USER, { retryCount: 1, status: 'active', agentsPaused: false })],
      ['findBalance', (c: SupabaseClient) => repo(c).findBalance(USER)],
      ['applyBoostPackBalance', (c: SupabaseClient) => repo(c).applyBoostPackBalance(USER, { balance: 1, totalEarned: 1 })],
      ['mirrorStripeStatus', (c: SupabaseClient) => repo(c).mirrorStripeStatus(USER, { cancelAtPeriodEnd: false, canceledAt: null, status: 'active' })],
      ['markCanceled', (c: SupabaseClient) => repo(c).markCanceled(USER)],
    ])('%s rejects when the query rejects, and logs nothing', async (_name, call) => {
      const { client } = recordingClient(new Error('network'));
      await expect(call(client)).rejects.toThrow('network');
      expect(mockLogged).toEqual([]);
    });
  });

  describe('source shape (SA C-3, PR4-Q1 layout)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/UserSubscriptionRepository.ts'), 'utf8');
    const header = '// Stripe webhook, agent-platform legacy: owner-scoped (CF-5 PR 5)';
    const classStart = source.indexOf('export class UserSubscriptionRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const METHODS = ['findDunningState', 'recordPaymentFailure', 'findBalance', 'applyBoostPackBalance', 'mirrorStripeStatus', 'markCanceled'];

    it('one owner-scoped section at the end of the class, holding the six methods, no unscoped marker', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.split(header)).toHaveLength(2);
      for (const method of METHODS) expect(code).toMatch(new RegExp(`async ${method}\\(`));
      expect(section).not.toContain('⟨unscoped-by-design⟩');
    });

    it("every query is user_subscriptions with exactly one eq('user_id', userId)", () => {
      expect(code.match(/\.from\('user_subscriptions'\)/g)).toHaveLength(METHODS.length);
      expect(code.match(/\.eq\('user_id', userId\)/g)).toHaveLength(METHODS.length);
    });

    it('no generic update, spread, insert/delete/upsert/rpc, try/catch or logging', () => {
      expect(code).not.toMatch(/\.\.\./);
      expect(code).not.toMatch(/\.(insert|delete|upsert|rpc)\(/);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/\blogger\./);
    });
  });
});
