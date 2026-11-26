/**
 * The closure status view (DL-2a; DL-2 workplan §5.1, D-7, §12 row 1; SA
 * W-4 d, W-12). Pure: a row and a timezone read in, the wire out, checked
 * against the route's own schema.
 */

import { closureStatusView, needsTimezone, type ClosureStatusRow } from '../closureStatusView';
import { closureLockAt } from '../closureDates';
import { GRACE_DAYS } from '../closureLifecycle';
import { closureStatusViewSchema } from '../schemas';

const ENDS = '2026-11-26T10:00:00.000Z';

const row = (over: Partial<ClosureStatusRow> = {}): ClosureStatusRow => ({
  status: 'pending',
  renewal_was_on: true,
  plan_ends_at: ENDS,
  lock_at: null,
  lock_timezone: null,
  ...over,
});

describe('pending: the lock date is projected from the plan end (D-7)', () => {
  it('Asia/Jerusalem: closureLockAt(plan_ends_at, zone), marked projected, the zone named', () => {
    const view = closureStatusView(row(), { ok: true, stored: 'Asia/Jerusalem' });
    const expected = closureLockAt(new Date(ENDS), 'Asia/Jerusalem');
    expect(view).toEqual({
      status: 'pending',
      planEndsAt: ENDS,
      lockAt: expected.lockAt,
      lockAtIsProjected: true,
      timezone: 'Asia/Jerusalem',
      renewalWasOn: true,
      graceDays: GRACE_DAYS,
    });
    // The start of local day 15 (26 Nov is day 1): midnight 10 Dec in Jerusalem, UTC+2 in winter.
    expect(view.lockAt).toBe('2026-12-09T22:00:00.000Z');
    expect(closureStatusViewSchema.safeParse(view).success).toBe(true);
  });

  it('America/New_York across the DST change (1 Nov 2026): still a local midnight', () => {
    const view = closureStatusView(row({ plan_ends_at: '2026-10-25T15:00:00.000Z' }), { ok: true, stored: 'America/New_York' });
    // 25 Oct is EDT (UTC-4); day 15 is 8 Nov, EST (UTC-5).
    expect(view.lockAt).toBe('2026-11-08T05:00:00.000Z');
    expect(view.timezone).toBe('America/New_York');
  });

  it('a NULL zone ("not asked") resolves to UTC, named UTC', () => {
    const view = closureStatusView(row(), { ok: true, stored: null });
    expect(view.timezone).toBe('UTC');
    expect(view.lockAt).toBe(closureLockAt(new Date(ENDS), null).lockAt);
    expect(view.lockAtIsProjected).toBe(true);
  });

  it('W-4 d: the timezone read failed → no date of any kind, timezone UTC', () => {
    const view = closureStatusView(row(), { ok: false });
    expect(view).toMatchObject({ status: 'pending', planEndsAt: null, lockAt: null, lockAtIsProjected: false, timezone: 'UTC' });
    expect(closureStatusViewSchema.safeParse(view).success).toBe(true);
  });

  it('a pending row without a usable plan end → no lock date, not projected', () => {
    expect(closureStatusView(row({ plan_ends_at: null }), { ok: true, stored: 'Asia/Jerusalem' })).toMatchObject({ lockAt: null, lockAtIsProjected: false, timezone: 'Asia/Jerusalem' });
    expect(closureStatusView(row({ plan_ends_at: 'not a date' }), { ok: true, stored: null })).toMatchObject({ lockAt: null, lockAtIsProjected: false });
  });
});

describe('grace and locked: the stored date in the stored zone', () => {
  it.each(['grace', 'locked'] as const)('%s → lock_at / lock_timezone, not projected, the zone read ignored', (status) => {
    const stored = { status, renewal_was_on: false, plan_ends_at: null, lock_at: '2026-12-01T22:00:00.000Z', lock_timezone: 'Asia/Jerusalem' };
    for (const zone of [{ ok: true as const, stored: 'America/New_York' }, { ok: false as const }]) {
      expect(closureStatusView(stored, zone)).toEqual({
        status,
        planEndsAt: null,
        lockAt: '2026-12-01T22:00:00.000Z',
        lockAtIsProjected: false,
        timezone: 'Asia/Jerusalem',
        renewalWasOn: false,
        graceDays: GRACE_DAYS,
      });
    }
  });

  it('a grace row with no stored zone names UTC', () => {
    expect(closureStatusView(row({ status: 'grace', lock_at: '2026-12-01T00:00:00.000Z', lock_timezone: null }), { ok: true, stored: null }).timezone).toBe('UTC');
  });
});

describe('requesting: nothing is fixed yet', () => {
  it('no lock date, UTC, never projected', () => {
    const view = closureStatusView(row({ status: 'requesting' }), { ok: true, stored: 'Asia/Jerusalem' });
    expect(view).toMatchObject({ status: 'requesting', lockAt: null, lockAtIsProjected: false, timezone: 'UTC' });
  });
});

describe('needsTimezone', () => {
  it('only a pending row reads the timezone', () => {
    expect(needsTimezone('pending')).toBe(true);
    for (const status of ['requesting', 'grace', 'locked'] as const) expect(needsTimezone(status)).toBe(false);
  });
});
