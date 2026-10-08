/**
 * `findOwnedId(id, userId)` — the lean ownership oracle on the contact, booking
 * and service repositories (webhook Fix-1, SA condition C-1), and on the payment
 * plan repository (Fix-1b, same shape).
 *
 * The Stripe webhook vets ids that a connected account wrote into metadata with
 * these. What must hold, for each of the three:
 *   - the read depends on `id` and `user_id` only: `select('id')`, both filters,
 *     `maybeSingle()` — no join that could break and fail every call closed;
 *   - owned → the id; not found (or another business's) → null with NO error and
 *     NO log line (a miss is a normal answer; the caller decides what it means);
 *   - a read failure → null with the error passed through, logged once as { err }.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const mockLogged: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const at = (level: string) => (ctx: unknown, msg?: unknown): void => {
    mockLogged.push({ level, ctx, msg });
  };
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { CRMContactRepository } from '@/lib/repositories/CRMContactRepository';
import {
  SchedulingBookingRepository,
  SchedulingServiceRepository,
} from '@/lib/repositories/SchedulingRepository';
import { PaymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';

type Answer = { data: unknown; error: unknown };

/** Records the whole chain of one query and answers it at `maybeSingle()`. */
function recordingClient(answer: Answer) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'single', 'order', 'limit', 'is', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push(['maybeSingle']);
    return Promise.resolve(answer);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ID = '33333333-3333-4333-8333-333333333333';
const OWNER = '11111111-1111-4111-8111-111111111111';

const CASES: Array<{
  name: string;
  table: string;
  make: (c: SupabaseClient) => { findOwnedId: (id: string, userId: string) => Promise<{ data: string | null; error: Error | null }> };
}> = [
  { name: 'CRMContactRepository', table: 'crm_contacts', make: (c) => new CRMContactRepository(c) },
  { name: 'SchedulingBookingRepository', table: 'scheduling_bookings', make: (c) => new SchedulingBookingRepository(c) },
  { name: 'SchedulingServiceRepository', table: 'scheduling_services', make: (c) => new SchedulingServiceRepository(c) },
  { name: 'PaymentPlanRepository', table: 'payment_plans', make: (c) => new PaymentPlanRepository(c) },
];

beforeEach(() => {
  mockLogged.length = 0;
});

describe.each(CASES)('$name.findOwnedId', ({ table, make }) => {
  it('owned: returns the id, from a lean read scoped by id and user_id', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });

    const result = await make(client).findOwnedId(ID, OWNER);

    expect(result).toEqual({ data: ID, error: null });
    expect(calls).toEqual([
      ['from', table],
      ['select', 'id'],
      ['eq', 'id', ID],
      ['eq', 'user_id', OWNER],
      ['maybeSingle'],
    ]);
    expect(mockLogged).toEqual([]);
  });

  it('not found or not owned: null, no error, and nothing logged', async () => {
    const { client } = recordingClient({ data: null, error: null });

    const result = await make(client).findOwnedId(ID, OWNER);

    expect(result).toEqual({ data: null, error: null });
    expect(mockLogged).toEqual([]);
  });

  it('read failure: null with the same error object, logged once at error as { err }', async () => {
    const failure = { code: 'XX000', message: 'read failed' };
    const { client } = recordingClient({ data: null, error: failure });

    const result = await make(client).findOwnedId(ID, OWNER);

    expect(result.data).toBeNull();
    expect(result.error).toBe(failure);
    expect(mockLogged).toHaveLength(1);
    expect(mockLogged[0].level).toBe('error');
    expect((mockLogged[0].ctx as { err?: unknown }).err).toBe(failure);
  });
});
