/**
 * PaymentReminderService.nextSendableAt (ADMIN_BOS_CLEANUP slice 7c; SA C7-8,
 * W7C-7; workplan §2.4 and §5.13 S-1..S-3, B-6, B-7).
 *
 * The public wrapper the admin retry uses to find a reminder's next time
 * inside the business's sending hours. It must be the SAME rule the scheduler
 * applies (`sendableAt`), reused and never copied, and it must not write,
 * send or emit anything.
 */

const mockEmit = jest.fn();
jest.mock('@/lib/services/PaymentEventService', () => ({
  emitPaymentEvent: (...args: unknown[]) => mockEmit(...args),
}));

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { PaymentReminderService } from '@/lib/services/PaymentReminderService';
import { businessClock, businessDateKey } from '@/lib/scheduling/businessTime';

type Call = { method: string; args: unknown[] };

/** A client that answers the zone read, and records every call. */
function zoneClient(timezone: string | null, opts: { throws?: boolean; error?: boolean } = {}) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'insert', 'update', 'upsert', 'delete']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      if (method === 'maybeSingle') {
        if (opts.throws) return Promise.reject(new Error('socket hang up'));
        return Promise.resolve(opts.error ? { data: null, error: { code: '57014' } } : { data: { timezone }, error: null });
      }
      return builder;
    };
  }
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push({ method: 'rpc', args });
      throw new Error('no rpc expected');
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const OWNER = 'owner-1';

beforeEach(() => jest.clearAllMocks());

describe('S-1 the wrapper is the private sendableAt, as a Date', () => {
  it.each([
    // B-6, UTC: the edges of 08:00–20:00
    ['UTC', '2026-10-04T07:59:59.999Z', '2026-10-04T08:00:00.000Z'],
    ['UTC', '2026-10-04T08:00:00.000Z', '2026-10-04T08:00:00.000Z'],
    ['UTC', '2026-10-04T19:59:59.999Z', '2026-10-04T19:59:59.999Z'],
    ['UTC', '2026-10-04T20:00:00.000Z', '2026-10-05T08:00:00.000Z'],
    // B-7, DST days at 01:30 local: 08:00 local that same date
    ['Europe/London', '2026-10-25T01:30:00.000Z', '2026-10-25T08:00:00.000Z'], // 01:30 GMT after the change
    ['America/New_York', '2026-11-01T05:30:00.000Z', '2026-11-01T13:00:00.000Z'], // 01:30 EDT/EST, 08:00 EST
    // B-5: 02:00 local in Jerusalem → 08:00 local the same day
    ['Asia/Jerusalem', '2026-10-04T23:00:00.000Z', '2026-10-05T05:00:00.000Z'],
  ])('%s %s → %s', async (zone, desired, expected) => {
    const { client } = zoneClient(zone);
    const service = new PaymentReminderService(client);
    const spy = jest.spyOn(service as unknown as { sendableAt: (d: Date, u: string) => Promise<string> }, 'sendableAt');
    const result = await service.nextSendableAt(OWNER, new Date(desired));
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(expected);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].toISOString()).toBe(desired);
    expect(spy.mock.calls[0][1]).toBe(OWNER);
    expect(await spy.mock.results[0].value).toBe(expected);
  });

  it('an out-of-hours result is 08:00 on the business\'s own clock', async () => {
    const { client } = zoneClient('America/Los_Angeles');
    const result = await new PaymentReminderService(client).nextSendableAt(OWNER, new Date('2026-10-05T04:30:00.000Z')); // 21:30 PDT
    expect(businessClock(result, 'America/Los_Angeles').hour).toBe(8);
    expect(businessDateKey(result, 'America/Los_Angeles')).toBe('2026-10-05');
  });
});

describe('S-2 its only database access is the existing zone read; nothing is written, sent or emitted', () => {
  it('reads user_preferences.timezone for the owner, once', async () => {
    const { client, calls } = zoneClient('UTC');
    await new PaymentReminderService(client).nextSendableAt(OWNER, new Date('2026-10-04T12:00:00.000Z'));
    expect(calls).toEqual([
      { method: 'from', args: ['user_preferences'] },
      { method: 'select', args: ['timezone'] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'maybeSingle', args: [] },
    ]);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it.each([
    ['the read throws', { throws: true }],
    ['the read returns an error', { error: true }],
  ])('%s → UTC (the documented fallback, OP-4)', async (_label, opts) => {
    const { client } = zoneClient('Asia/Jerusalem', opts);
    const result = await new PaymentReminderService(client).nextSendableAt(OWNER, new Date('2026-10-04T21:30:00.000Z'));
    expect(result.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });
});

describe('S-3 the wrapper is additive: the scheduling rule is untouched', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'lib/services/PaymentReminderService.ts'), 'utf8');

  it('nextSendableAt only delegates to sendableAt', () => {
    const body = code.match(/async nextSendableAt\(userId: string, desired: Date\): Promise<Date> \{([\s\S]*?)\n  \}/);
    expect(body).not.toBeNull();
    expect(body![1].trim()).toBe('return new Date(await this.sendableAt(desired, userId));');
  });

  it('sendableAt and businessZone stay private; the window constants are unchanged', () => {
    expect(code).toMatch(/private async sendableAt\(desired: Date, userId: string\): Promise<string> \{/);
    expect(code).toMatch(/private async businessZone\(userId: string\): Promise<string> \{/);
    expect(code).toMatch(/const REMINDER_WINDOW_OPENS_AT = 8;/);
    expect(code).toMatch(/const REMINDER_WINDOW_CLOSES_AT = 20;/);
    expect(code.match(/nextSendableAt/g)).toHaveLength(1);
  });
});
