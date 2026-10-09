/**
 * Unit tests for the Stripe webhook's and `bindPlanSubscription`'s booking
 * methods on SchedulingBookingRepository (CF-5 PR 4).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.5 and §7.5. Each method must issue EXACTLY the query its caller issued
 * inline before PR 4 (table, operation, payload and its key order, update
 * options, filters in order, terminal), pass supabase-js's error object (and
 * `count`) through unchanged, add no `user_id` filter where the inline query had
 * none (⟨unscoped-by-design⟩, SA C-3) and keep it where it had one, and never
 * catch a throw (SA CR-P2-1).
 *
 * A recording fake client: no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

// Module-level imports of the repository file that do I/O are stubbed: these
// methods emit no business event.
const mockEvents: unknown[] = [];
jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({
  recordBusinessEvent: (...args: unknown[]) => {
    mockEvents.push(args);
  },
}));

const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => ({}) };
  },
}));

import { SchedulingBookingRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(result: Record<string, unknown>) {
  const calls: Call[] = [];
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
      return Promise.resolve(result);
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return Promise.resolve(result).then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function rejectingClient(reason: Error) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'eq']) builder[method] = () => builder;
  for (const terminal of ['single', 'maybeSingle']) builder[terminal] = () => Promise.reject(reason);
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.reject(reason).then(onF, onR);
  return { from: () => builder } as unknown as SupabaseClient;
}

const BOOKING = 'bk-0001';
const OWNER = 'owner-1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = (code = 'XX000') => Object.assign(new Error('boom'), { code, details: '', hint: '' });

function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) expect(args[0]).not.toBe('user_id');
  }
  expect(JSON.stringify(calls)).not.toContain('user_id');
}

const repo = (client: SupabaseClient) => new SchedulingBookingRepository(client);

beforeEach(() => {
  mockLogged.length = 0;
  mockEvents.length = 0;
});

describe('SchedulingBookingRepository: Stripe webhook and plan-binding methods (CF-5 PR 4)', () => {
  describe('markPaidUnscoped (H7)', () => {
    it('update {payment_status, updated_at}, eq id, awaited, nothing read back', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPaidUnscoped(BOOKING);

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['update', { payment_status: 'paid', updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', BOOKING],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['payment_status', 'updated_at']);
      expect(calls[1]).toHaveLength(2);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through (same object), logs nothing, emits nothing', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).markPaidUnscoped(BOOKING)).error).toBe(error);
      expect(mockLogged).toEqual([]);
      expect(mockEvents).toEqual([]);
    });
  });

  describe('markPaidAndConfirmIfPending (I4)', () => {
    it('update {payment_status, status: confirmed, updated_at}, eq id, eq status pending, awaited', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPaidAndConfirmIfPending(BOOKING);

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['update', { payment_status: 'paid', status: 'confirmed', updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', BOOKING],
        ['eq', 'status', 'pending'],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['payment_status', 'status', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).markPaidAndConfirmIfPending(BOOKING)).error).toBe(error);
    });
  });

  describe('markPaidForOwner (G5, owner-scoped)', () => {
    it('update {payment_status, updated_at}, eq id, eq user_id, awaited, no update options', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).markPaidForOwner(BOOKING, OWNER);

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['update', { payment_status: 'paid', updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', BOOKING],
        ['eq', 'user_id', OWNER],
        ['await'],
      ]);
      expect(calls[1]).toHaveLength(2);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes the error through (the webhook logs it and carries on)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).markPaidForOwner(BOOKING, OWNER)).error).toBe(error);
    });
  });

  describe('markPaidForOwnerCounted (I5, Fix-1 F-2, owner-scoped)', () => {
    it("update with { count: 'exact' }, eq id, eq user_id, awaited; the count back", async () => {
      const { client, calls } = recordingClient({ data: null, error: null, count: 0 });
      const result = await repo(client).markPaidForOwnerCounted(BOOKING, OWNER);

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['update', { payment_status: 'paid', updated_at: expect.stringMatching(ISO) }, { count: 'exact' }],
        ['eq', 'id', BOOKING],
        ['eq', 'user_id', OWNER],
        ['await'],
      ]);
      // 0 is how the webhook tells a foreign booking apart: it must survive as 0.
      expect(result).toEqual({ data: null, error: null, count: 0 });
    });

    it('an absent count stays absent (never read as a refusal)', async () => {
      const { client } = recordingClient({ data: null, error: null, count: null });
      expect((await repo(client).markPaidForOwnerCounted(BOOKING, OWNER)).count).toBeNull();
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error, count: null });
      expect((await repo(client).markPaidForOwnerCounted(BOOKING, OWNER)).error).toBe(error);
    });
  });

  describe('linkPaymentPlan (bind, owner-scoped)', () => {
    it('update {payment_plan_id, updated_at}, eq id, eq user_id, awaited', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await repo(client).linkPaymentPlan(BOOKING, OWNER, 'pp-1');

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['update', { payment_plan_id: 'pp-1', updated_at: expect.stringMatching(ISO) }],
        ['eq', 'id', BOOKING],
        ['eq', 'user_id', OWNER],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['payment_plan_id', 'updated_at']);
      expect(result).toEqual({ data: null, error: null });
    });

    it('passes the error through (bind logs it and goes on)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).linkPaymentPlan(BOOKING, OWNER, 'pp-1')).error).toBe(error);
    });
  });

  describe('findContactIdForOwner (bind, owner-scoped)', () => {
    it("select 'contact_id', eq id, eq user_id, maybeSingle", async () => {
      const { client, calls } = recordingClient({ data: { contact_id: 'ct-1' }, error: null });
      const result = await repo(client).findContactIdForOwner(BOOKING, OWNER);

      expect(calls).toEqual([
        ['from', 'scheduling_bookings'],
        ['select', 'contact_id'],
        ['eq', 'id', BOOKING],
        ['eq', 'user_id', OWNER],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: { contact_id: 'ct-1' }, error: null });
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await repo(client).findContactIdForOwner(BOOKING, OWNER)).error).toBe(error);
    });
  });

  describe('no catch anywhere (SA CR-P2-1: a rejected query must reach the caller)', () => {
    it.each([
      ['markPaidUnscoped', (r: SchedulingBookingRepository) => r.markPaidUnscoped(BOOKING)],
      ['markPaidAndConfirmIfPending', (r: SchedulingBookingRepository) => r.markPaidAndConfirmIfPending(BOOKING)],
      ['markPaidForOwner', (r: SchedulingBookingRepository) => r.markPaidForOwner(BOOKING, OWNER)],
      ['markPaidForOwnerCounted', (r: SchedulingBookingRepository) => r.markPaidForOwnerCounted(BOOKING, OWNER)],
      ['linkPaymentPlan', (r: SchedulingBookingRepository) => r.linkPaymentPlan(BOOKING, OWNER, 'pp-1')],
      ['findContactIdForOwner', (r: SchedulingBookingRepository) => r.findContactIdForOwner(BOOKING, OWNER)],
    ])('%s rejects when the query rejects, and logs nothing', async (_name, call) => {
      await expect(call(repo(rejectingClient(new Error('network'))))).rejects.toThrow('network');
      expect(mockLogged).toEqual([]);
    });
  });

  describe('construction', () => {
    it('the singleton defaults to the shared service-role client', () => {
      expect((schedulingBookingRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });
  });

  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/SchedulingRepository.ts'), 'utf8');
    const header = '// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)';
    const scopedHeader = '// Stripe webhook and plan binding: owner-scoped (CF-5 PR 4)';
    const classStart = source.indexOf('export class SchedulingBookingRepository');
    const classEnd = source.indexOf('\n}', classStart);
    const sectionStart = source.indexOf(header, classStart);
    const scopedStart = source.indexOf(scopedHeader, classStart);
    const unscoped = source.slice(sectionStart, scopedStart);
    const scoped = source.slice(scopedStart, classEnd);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const UNSCOPED = ['markPaidUnscoped', 'markPaidAndConfirmIfPending'];
    const SCOPED = ['markPaidForOwner', 'markPaidForOwnerCounted', 'linkPaymentPlan', 'findContactIdForOwner'];

    it('one unscoped section, then one owner-scoped section, at the end of the booking class', () => {
      expect(classStart).toBeGreaterThan(-1);
      expect(sectionStart).toBeGreaterThan(classStart);
      expect(scopedStart).toBeGreaterThan(sectionStart);
      expect(classEnd).toBeGreaterThan(scopedStart);
      expect(source.split(header)).toHaveLength(2);
      expect(source.split(scopedHeader)).toHaveLength(2);
    });

    it('every unscoped method sits in its section with the marker; the scoped ones without it', () => {
      for (const method of UNSCOPED) {
        expect(unscoped).toMatch(new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}\\(`));
      }
      for (const method of SCOPED) expect(scoped).toMatch(new RegExp(`async ${method}\\(`));
      expect(scoped).not.toContain('⟨unscoped-by-design⟩');
    });

    it('no generic update, spread, insert/delete/upsert/rpc, try/catch, logging or event; user_id only where it was', () => {
      for (const code of [strip(unscoped), strip(scoped)]) {
        expect(code).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
        expect(code).not.toMatch(/\.update\(\s*(patch|input|changes|fields|updates|state|row)\b/);
        expect(code).not.toMatch(/\.(insert|delete|upsert|rpc)\(/);
        expect(code).not.toMatch(/\btry\s*\{/);
        expect(code).not.toMatch(/\blogger\./);
        expect(code).not.toMatch(/recordBusinessEvent|emitBookingStatusEvent/);
        // These set payment_status; none may filter on it (bookingPaymentStatusReaders.guard).
        expect(code).not.toMatch(/\.(eq|in|neq)\(\s*'payment_status'/);
      }
      expect(strip(unscoped)).not.toContain('user_id');
      expect(strip(scoped).match(/\.eq\('user_id', userId\)/g)).toHaveLength(SCOPED.length);
    });
  });
});
