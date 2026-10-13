/**
 * Unit tests for the Stripe webhook's plan-end methods on
 * PaymentPlanSubscriptionRepository (CF-5 PR 4).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.5 and §7.5. The two names are fixed: the webhook's characterisation
 * harness and `fix1Ownership.qa` delegate to them by name (SA O-2). Each must
 * issue EXACTLY the query `handlePlanSubscriptionEnded` issued inline, pass the
 * error object through unchanged, add no `user_id` (⟨unscoped-by-design⟩, SA
 * C-3) and never catch a throw (SA CR-P2-1).
 *
 * The class takes no injected client (it reads the `supabaseServer` singleton
 * as a field), so the singleton itself is replaced by a recording fake whose
 * answer each test sets. No database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';

type Call = [method: string, ...args: unknown[]];

const mockCalls: Call[] = [];
let mockResult: Record<string, unknown> | Error = { data: null, error: null };

jest.mock('@/lib/supabaseServer', () => {
  const answer = () => (mockResult instanceof Error ? Promise.reject(mockResult) : Promise.resolve(mockResult));
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = (...args: unknown[]) => {
      mockCalls.push([terminal, ...args]);
      return answer();
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    mockCalls.push(['await']);
    return answer().then(onF, onR);
  };
  return {
    supabaseServer: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return builder;
      },
    },
  };
});

const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => ({}) };
  },
}));

import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) expect(args[0]).not.toBe('user_id');
  }
  expect(JSON.stringify(calls.filter(([method]) => method !== 'select'))).not.toContain('user_id');
}

beforeEach(() => {
  mockCalls.length = 0;
  mockLogged.length = 0;
  mockResult = { data: null, error: null };
});

describe('PaymentPlanSubscriptionRepository: Stripe webhook plan-end methods (CF-5 PR 4)', () => {
  describe('findEndStateBySubscriptionId (M1)', () => {
    it("select the five columns, eq stripe_subscription_id, maybeSingle", async () => {
      const row = { id: 'plan-1', user_id: 'owner-a', status: 'active', installment_count: 3, periods_paid: 1 };
      mockResult = { data: row, error: null };
      const result = await paymentPlanSubscriptionRepository.findEndStateBySubscriptionId('sub_plan_1');

      expect(mockCalls).toEqual([
        ['from', 'payment_plan_subscriptions'],
        ['select', 'id, user_id, status, installment_count, periods_paid'],
        ['eq', 'stripe_subscription_id', 'sub_plan_1'],
        ['maybeSingle'],
      ]);
      expect(result.data).toBe(row);
      expect(result.error).toBeNull();
      expectNoOwnerFilter(mockCalls);
    });

    it('passes the error through (same object), logs nothing', async () => {
      const error = pgError();
      mockResult = { data: null, error };
      const result = await paymentPlanSubscriptionRepository.findEndStateBySubscriptionId('sub_plan_1');
      expect(result.error).toBe(error);
      expect(result.data).toBeNull();
      expect(mockLogged).toEqual([]);
    });
  });

  describe('endFromStripe (M2)', () => {
    it.each([
      ['completed', 'completed_at'],
      ['cancelled', 'cancelled_at'],
    ] as const)('%s: {status, %s, updated_at} in that order, eq id, awaited, nothing read back', async (outcome, stamp) => {
      const result = await paymentPlanSubscriptionRepository.endFromStripe('plan-1', outcome);

      expect(mockCalls).toEqual([
        ['from', 'payment_plan_subscriptions'],
        ['update', { status: outcome, [stamp]: expect.stringMatching(ISO), updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', 'plan-1'],
        ['await'],
      ]);
      // Not close(): no cancel-reason columns.
      expect(Object.keys(mockCalls[1][1] as object)).toEqual(['status', stamp, 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(mockCalls);
    });

    it('passes the error through (the webhook discards it today, FU-9)', async () => {
      const error = pgError();
      mockResult = { data: null, error };
      expect((await paymentPlanSubscriptionRepository.endFromStripe('plan-1', 'cancelled')).error).toBe(error);
    });

    it('accepts only the two outcomes (compile time)', () => {
      const typeOnly = () =>
        // @ts-expect-error -- a plan does not end as `past_due`
        paymentPlanSubscriptionRepository.endFromStripe('plan-1', 'past_due');
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('no catch (SA CR-P2-1: a rejected query must reach the route)', () => {
    it.each([
      ['findEndStateBySubscriptionId', () => paymentPlanSubscriptionRepository.findEndStateBySubscriptionId('sub_1')],
      ['endFromStripe', () => paymentPlanSubscriptionRepository.endFromStripe('plan-1', 'completed')],
    ])('%s rejects when the query rejects, and logs nothing', async (_name, call) => {
      mockResult = new Error('network');
      await expect(call()).rejects.toThrow('network');
      expect(mockLogged).toEqual([]);
    });
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/PaymentPlanSubscriptionRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const classStart = source.indexOf('export class PaymentPlanSubscriptionRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const section = source.slice(sectionStart, classEnd);
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('one section, at the end of the class, holding both methods with the marker', () => {
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(sectionStart).toBeLessThan(classEnd);
      expect(source.split(header)).toHaveLength(2);
      for (const method of ['findEndStateBySubscriptionId', 'endFromStripe']) {
        expect(section).toMatch(new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}\\(`));
      }
    });

    it('no generic update, spread, insert/delete/upsert/rpc, user_id, try/catch or logging', () => {
      expect(code).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
      expect(code).not.toMatch(/\.(insert|delete|upsert|rpc)\(/);
      expect(code).not.toMatch(/\.eq\('user_id'/);
      expect(code).not.toMatch(/\btry\s*\{/);
      expect(code).not.toMatch(/\blogger\./);
      expect(code).not.toMatch(/cancel_reason|cancel_note|cancelled_by/);
    });
  });
});
