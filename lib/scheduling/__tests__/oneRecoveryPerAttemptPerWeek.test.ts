/**
 * The agent door does not re-mail the attempt it is pointed at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `deliverRecovery`'s address window is shared by both senders and excludes the
 * attempt itself — `.neq('id', attempt.id)` — because the sweep stamps the row
 * BEFORE it delivers and a window counting its own stamp would make it refuse
 * every send it had just claimed. Correct for the sweep, and it left the agent
 * door with no opinion at all about the one row it was handed.
 *
 * Two things followed:
 *
 *   it repeated. `recoverAbandonedCheckouts` finds attempts where
 *   `recovery_email_sent_at IS NOT NULL` — the tail the sweep has finished
 *   with — and the agent changed no value that find reads. The same row came
 *   back every run: on a `daily` cadence, one person told every morning for as
 *   long as the owner's stop rule ran.
 *
 *   it could land behind the sweep. An attempt mailed and stamped an hour
 *   earlier was still a candidate, and the stamp proving it was the one the
 *   shared window had been told to ignore.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FIX IS IN THE AGENT DOOR AND NOT THE SHARED WINDOW
 *
 * Because the two callers need opposite answers about this one row: the sweep
 * must ignore its own stamp, the agent must respect it. Widening the shared
 * query to satisfy the agent silences the sweep completely — the first version
 * of this fix did exactly that.
 *
 * And the agent may now refresh that stamp, which it was told not to write,
 * because its find requires the column NOT NULL and the sweep selects on
 * IS NULL: a row the sweep has permanently stopped seeing cannot be hidden
 * from it again. `refreshRecoveryStamp` carries that as a condition on the
 * update rather than as an assumption.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Every `abandoned_bookings` statement this test cares about, in order. */
type Call = { op: string; filters: Record<string, unknown>; payload?: unknown };
const calls: Call[] = [];

let attemptRow: Record<string, unknown> | null = null;
/** Another attempt from the same address, inside the shared address window. */
let otherRecentFromAddress: Record<string, unknown> | null = null;

jest.mock('@/lib/supabaseServer', () => {
  const supabaseServer = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};

      const record = (op: string, payload?: unknown) => {
        if (table === 'abandoned_bookings') calls.push({ op, filters, payload });
      };

      /*
       * Which read this is, decided by its own filters rather than by call
       * order — the first version of this mock answered every read with the
       * attempt, which made the shared address window believe a second recent
       * attempt existed. `deliverRecovery` then refused every send, the refresh
       * was never reached, and the two tests that loop over the writes passed
       * over an empty list. A gate test that passes because nothing happened is
       * worse than no test.
       */
      const answer = () => {
        if (table !== 'abandoned_bookings') return { service_name: 'A service', id: 'other-1' };
        /* The shared address window: keyed on the address, excluding this row. */
        if ('neq:id' in filters) return otherRecentFromAddress;
        return attemptRow;
      };

      Object.assign(chain, {
        select: () => chain,
        update: (payload: unknown) => {
          record('update', payload);
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        neq: (col: string, val: unknown) => {
          filters[`neq:${col}`] = val;
          return chain;
        },
        gte: (col: string, val: unknown) => {
          filters[`gte:${col}`] = val;
          return chain;
        },
        not: (col: string, op: string, val: unknown) => {
          filters[`not:${col}`] = `${op} ${val}`;
          return chain;
        },
        ilike: (col: string, val: unknown) => {
          filters[`ilike:${col}`] = val;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          record('read', undefined);
          return Promise.resolve({ data: answer(), error: null });
        },
        /* An `update(...).eq(...)` with no `maybeSingle` is awaited directly. */
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      });

      return chain;
    },
  };

  return { supabaseServer };
});

/* The composer and the transport. What the message says is not what this test
   is about, only whether it is reached and what is written afterwards. */
jest.mock('@/lib/email/templates/booking-recovery', () => ({
  generateBookingRecoveryEmail: () => ({ subject: 's', html: '<p/>' }),
}));

jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: jest.fn().mockResolvedValue({}),
}));

const sendEmail = jest.fn();

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

jest.mock('@/lib/notifications/recordEmailSend', () => ({
  recordEmailSend: jest.fn().mockResolvedValue(undefined),
}));

import * as recovery from '../abandonedRecovery';

const USER = 'owner-1';
const ATTEMPT = 'attempt-1';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT,
    user_id: USER,
    service_id: 'service-1',
    first_name: 'Dana',
    email: 'client@example.com',
    start_time: daysAgo(-2),
    timezone: 'Europe/London',
    page_url: null,
    locale: 'en',
    status: 'abandoned',
    /* The tail the agent works: already mailed once by the sweep. */
    recovery_email_sent_at: daysAgo(20),
    ...overrides,
  };
}

/**
 * `deliverRecovery` is module-private, so it is reached through the only thing
 * that distinguishes a send from a refusal without one: whether the stamp was
 * refreshed. Read off the recorded statements rather than mocked.
 */
const updates = () => calls.filter((c) => c.op === 'update');

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  attemptRow = attempt();
  /* Nobody else from this address lately, so the SHARED window is not what is
     refusing — otherwise this suite would be measuring that instead. */
  otherRecentFromAddress = null;
  sendEmail.mockResolvedValue({ sent: true });
});

describe('the agent respects this attempt own history', () => {
  it('refuses an attempt mailed inside the window', async () => {
    attemptRow = attempt({ recovery_email_sent_at: daysAgo(2) });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('already mailed within 7 days');
    /* Nothing was written, because nothing was sent. */
    expect(updates()).toHaveLength(0);
  });

  it('refuses one the sweep mailed an hour ago', async () => {
    /* The collision. The sweep stamps as it sends, and the shared address
       window is told to ignore this row — so this check is the only thing
       standing between that client and a second message the same morning. */
    attemptRow = attempt({ recovery_email_sent_at: new Date(Date.now() - 3_600_000).toISOString() });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('already mailed');
  });

  it('allows one mailed longer ago than the window', async () => {
    attemptRow = attempt({ recovery_email_sent_at: daysAgo(20) });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a second run the next day finds its own refresh and refuses', async () => {
    /*
     * THE REPEAT, END TO END. Run one sends and refreshes the stamp; run two
     * reads the row back and must refuse. Before the fix the agent wrote
     * nothing, so run two was identical to run one — every morning.
     */
    attemptRow = attempt({ recovery_email_sent_at: daysAgo(20) });

    const first = await recovery.sendOneRecovery(ATTEMPT, USER);
    expect(first.sent).toBe(true);

    /* The row as the refresh left it: the time the update actually wrote. */
    const written = (updates()[0].payload as { recovery_email_sent_at: string })
      .recovery_email_sent_at;
    attemptRow = attempt({ recovery_email_sent_at: written });

    const second = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(second.sent).toBe(false);
    expect(second.reason).toContain('already mailed');
    /* And still only the one message. */
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the send did not go', async () => {
    /* A stamp refreshed after a failed delivery silences a week for somebody
       who heard nothing. */
    attemptRow = attempt({ recovery_email_sent_at: daysAgo(20) });
    sendEmail.mockResolvedValue({ sent: false, error: 'mailbox unavailable' });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it('reads the stamp it is about to judge', async () => {
    /* The column was absent from the select until this fix, so the check could
       not have been written without widening it. Pinned so a later tidy-up of
       the field list cannot silently disarm the guard. */
    await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].op).toBe('read');
    expect(calls[0].filters.id).toBe(ATTEMPT);
    expect(calls[0].filters.user_id).toBe(USER);
  });
});

describe('the refresh cannot take a row away from the sweep', () => {
  it('only ever updates a row whose stamp already exists', async () => {
    await recovery.sendOneRecovery(ATTEMPT, USER);

    /* Not vacuous: there IS a write to inspect. The first version of this
       suite looped over an empty list and passed. */
    expect(updates()).toHaveLength(1);

    for (const u of updates()) {
      /* THE SAFETY ARGUMENT, as a condition on the statement rather than a
         comment above it. A stamp written onto a NULL row removes that attempt
         from the sweep's `IS NULL` select for good. */
      expect(u.filters['not:recovery_email_sent_at']).toBe('is null');
      expect(u.filters.user_id).toBe(USER);
      expect(u.filters.id).toBe(ATTEMPT);
    }
  });

  it('scopes every write it makes to the owner', async () => {
    await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(updates()).toHaveLength(1);

    for (const u of updates()) {
      expect(u.filters.user_id).toBe(USER);
    }
  });
});

describe('the checks that were already there still hold', () => {
  it('refuses an attempt that converted, before reading any history', async () => {
    attemptRow = attempt({ status: 'converted' });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('converted');
    expect(updates()).toHaveLength(0);
  });

  it('refuses an attempt with no address', async () => {
    attemptRow = attempt({ email: null });

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('no email');
  });

  it('refuses one that no longer exists', async () => {
    attemptRow = null;

    const outcome = await recovery.sendOneRecovery(ATTEMPT, USER);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('no longer exists');
  });
});
