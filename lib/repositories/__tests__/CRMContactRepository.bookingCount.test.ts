/**
 * A package is one booking on the pipeline card, not six.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A package is a container booking plus one row per session. The container
 * carries no `parent_booking_id`; each session carries the container's.
 * `SchedulingBookingInsert` states the rule outright: "`parent_booking_id IS
 * NULL` means a purchase for every reader that counts them."
 *
 * The contact list is such a reader, and it counted every row. So a client who
 * bought ONE six-session package appeared on their pipeline card with the same
 * figure as a client who had booked six separate times, and the card could not
 * be used to tell a regular from a one-off purchase -- which is most of what
 * the number is for.
 *
 * Measured on production 2026-10-08: one contact's card read 17 where 11 is the
 * number of things they actually bought.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RISK IN THE FIX
 *
 * The count is an EMBEDDED aggregate, and a filter on an embedded table can
 * behave like an inner join -- which would drop every contact who has never
 * booked, emptying the top of the pipeline. Checked against production before
 * the change: 5 contacts returned before, 5 after. The tests below pin the
 * filter's placement, because `parent_booking_id` without the table prefix
 * would filter CONTACTS by a column they do not have.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { CRMContactRepository } from '../CRMContactRepository';

/**
 * Records the filters each query applies.
 *
 * Two tables are read: `crm_contacts` (awaited at `range`) and `proposals`
 * (awaited at the end of its chain), so every builder is thenable and resolves
 * to that table's rows.
 */
function recordingClient(rows: unknown[], proposals: unknown[] = []) {
  const calls: Array<[string, ...unknown[]]> = [];

  const makeBuilder = (table: string) => {
    const result = { data: table === 'proposals' ? proposals : rows, error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of ['select', 'eq', 'is', 'not', 'or', 'order', 'range', 'contains', 'gte', 'lte', 'in']) {
      builder[method] = (...args: unknown[]) => {
        calls.push([`${table}.${method}`, ...args] as [string, ...unknown[]]);
        return builder;
      };
    }
    return builder;
  };

  const client = { from: (table: string) => { calls.push(['from', table]); return makeBuilder(table); } };
  return { client: client as unknown as SupabaseClient, calls };
}

/** The filter calls made against one table, with the table prefix removed. */
const filtersOn = (calls: Array<[string, ...unknown[]]>, table: string, method: string) =>
  calls.filter((c) => c[0] === `${table}.${method}`).map((c) => c.slice(1));

describe('the pipeline card counts purchases', () => {
  it('asks the database for containers only, on the embedded table', async () => {
    const { client, calls } = recordingClient([]);
    await new CRMContactRepository(client).list('u-1', {});

    expect(filtersOn(calls, 'crm_contacts', 'is')).toContainEqual([
      'scheduling_bookings.parent_booking_id',
      null,
    ]);
  });

  it('names the embedded table, or it would filter contacts instead', async () => {
    // `is('parent_booking_id', null)` would be read against `crm_contacts`,
    // which has no such column -- PostgREST would reject the whole query and
    // the pipeline would come back empty.
    const { client, calls } = recordingClient([]);
    await new CRMContactRepository(client).list('u-1', {});

    for (const [column] of filtersOn(calls, 'crm_contacts', 'is')) {
      expect(String(column)).toContain('scheduling_bookings.');
    }
  });

  it('still scopes to the owner, on both reads', async () => {
    // CLAUDE.md rule 4: the tenant filter is not optional, and the new second
    // read must carry it too or it reaches across accounts.
    const { client, calls } = recordingClient([]);
    await new CRMContactRepository(client).list('u-1', {});

    expect(filtersOn(calls, 'crm_contacts', 'eq')).toContainEqual(['user_id', 'u-1']);
    expect(filtersOn(calls, 'proposals', 'eq')).toContainEqual(['user_id', 'u-1']);
  });

  it('reports the count the database returned when nothing was quoted', async () => {
    const { client } = recordingClient([
      { id: 'c1', email: 'a@b.c', scheduling_bookings: [{ count: 11 }], crm_tasks: [{ count: 0 }] },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(11);
  });

  it('a contact who has never booked still comes back, at nought', async () => {
    // The inner-join risk, stated as a test: the top of the pipeline is mostly
    // these people, and losing them would empty the board.
    const { client } = recordingClient([
      { id: 'c2', email: 'new@lead.co', scheduling_bookings: [], crm_tasks: [] },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data).toHaveLength(1);
    expect(data?.[0].bookings_count).toBe(0);
  });
});

describe('a package sold by a quote is one purchase, not two', () => {
  /*
   * Accepting a quote writes the quote's booking AND the package container.
   * Both have a null parent, so both survive the first filter. The drawer drops
   * the container onto the quote's card -- so the card said 11 where the drawer
   * showed 10, for the same client, on the same data. Live figures, 2026-10-08.
   */
  const CONTACT = { id: 'c1', email: 'client@x.co', scheduling_bookings: [{ count: 11 }], crm_tasks: [] };

  it('subtracts a container that a quote already accounts for', async () => {
    const { client } = recordingClient([CONTACT], [
      { contact_id: 'c1', package_booking_id: 'pkg-1' },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(10);
  });

  it('counts a package only once, however many quotes name it', async () => {
    // A superseded quote and the accepted one can both point at the same
    // package; that is one container, so one subtraction.
    const { client } = recordingClient([CONTACT], [
      { contact_id: 'c1', package_booking_id: 'pkg-1' },
      { contact_id: 'c1', package_booking_id: 'pkg-1' },
      { contact_id: 'c1', package_booking_id: 'pkg-1' },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(10);
  });

  it('two different packages are two subtractions', async () => {
    const { client } = recordingClient([CONTACT], [
      { contact_id: 'c1', package_booking_id: 'pkg-1' },
      { contact_id: 'c1', package_booking_id: 'pkg-2' },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(9);
  });

  it('does not take another contact\'s packages off this one', async () => {
    const { client } = recordingClient([CONTACT], [
      { contact_id: 'someone-else', package_booking_id: 'pkg-9' },
    ]);
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(11);
  });

  it('never shows a negative count', async () => {
    const { client } = recordingClient(
      [{ id: 'c1', email: 'x@y.z', scheduling_bookings: [{ count: 0 }], crm_tasks: [] }],
      [{ contact_id: 'c1', package_booking_id: 'pkg-1' }]
    );
    const { data } = await new CRMContactRepository(client).list('u-1', {});

    expect(data?.[0].bookings_count).toBe(0);
  });

  it('asks only for packages that a real quote booking sold', async () => {
    // A quote with no booking of its own is not absorbed by the drawer either,
    // so subtracting for it would make the card too low.
    const { client, calls } = recordingClient([]);
    await new CRMContactRepository(client).list('u-1', {});

    const nots = filtersOn(calls, 'proposals', 'not');
    expect(nots).toContainEqual(['package_booking_id', 'is', null]);
    expect(nots).toContainEqual(['booking_id', 'is', null]);
  });
});

describe('the rule this relies on is still written down', () => {
  it('SchedulingBookingInsert still defines a purchase as a null parent', () => {
    // If that contract changes, this count is wrong again and silently.
    const scheduling = fs.readFileSync(
      path.join(process.cwd(), 'lib/repositories/SchedulingRepository.ts'),
      'utf8'
    );
    expect(scheduling).toContain('parent_booking_id');
    expect(scheduling).toMatch(/parent_booking_id IS NULL. mean/i);
  });
});
