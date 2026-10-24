/**
 * A package stage is not billable until its own session has happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The Needs-you card showed five identical rows — one client, one package,
 * ₪133 each, all "7 hours since they approved the proposal" — asking the owner
 * to mark work done and invoice for it. None of the sessions had happened.
 *
 * `stage_awaiting_completion` already held a stage against its `booking_id`,
 * added after a real series asked for six sessions in October that ran to
 * December. That guard then became UNREACHABLE rather than wrong: a package is
 * now one container booking with N `scheduling_meetings`, every stage shares
 * the container's id, and `ProposalAcceptanceService` states that "a container
 * carries no time". So the lookup always returned null, the deliberate
 * fail-open fired, and every stage was released the moment the quote was
 * accepted.
 *
 * The session is named by `meeting_id`, which the acceptance service has
 * stamped all along and which `billSessionOnCompletion` already keys on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  payment_plan_installments: [],
  scheduling_meetings: [],
  scheduling_bookings: [],
  crm_contacts: [],
  proposals: [],
};

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: tables[table] ?? [], error: null });
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  },
}));

import { findGaps } from '../findGaps';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const PAST_START = '2026-10-08T09:00:00.000Z';
const PAST_END = '2026-10-08T10:00:00.000Z';
const FUTURE_START = '2026-12-17T09:00:00.000Z';
const FUTURE_END = '2026-12-17T10:00:00.000Z';

/** The container: a purchase, which by design carries no time of its own. */
const CONTAINER = { id: 'container-1', start_time: null };

function stage(overrides: Row = {}): Row {
  return {
    id: 's1',
    contact_id: 'c1',
    amount: 133,
    currency: 'ILS',
    label: null,
    created_at: '2026-10-14T05:00:00.000Z',
    proposal_id: 'p1',
    /* The CONTAINER, shared by every stage of the package — this is the id
       whose missing time released all five rows. */
    booking_id: 'container-1',
    meeting_id: null,
    ...overrides,
  };
}

function meeting(overrides: Row = {}): Row {
  return {
    id: 'm1',
    start_time: FUTURE_START,
    end_time: FUTURE_END,
    session_number: 1,
    meeting_status: null,
    ...overrides,
  };
}

function seed({ stages, meetings }: { stages: Row[]; meetings: Row[] }) {
  tables.payment_plan_installments = stages;
  tables.scheduling_meetings = meetings;
  tables.scheduling_bookings = [CONTAINER];
  tables.crm_contacts = [
    { id: 'c1', first_name: 'שלמה', last_name: 'המלך', email: 'shlomo@example.com' },
  ];
  tables.proposals = [{ id: 'p1', title: 'חבילת טיפולים' }];
}

async function items() {
  const [gap] = await findGaps('user-1', { only: ['stage_awaiting_completion'], now: NOW });
  return gap?.items ?? [];
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
});

describe('the reported bug', () => {
  it('asks for nothing while every session is still to come', () => {
    /*
     * The screenshot, as data: five stages of one package, accepted this
     * morning, for sessions that have not happened. Every one of them was
     * shown with a "mark done and bill" button.
     */
    seed({
      stages: [1, 2, 3, 4, 5].map(n =>
        stage({ id: `s${n}`, meeting_id: `m${n}` })
      ),
      meetings: [1, 2, 3, 4, 5].map(n =>
        meeting({ id: `m${n}`, session_number: n })
      ),
    });

    return expect(items()).resolves.toEqual([]);
  });

  it('asks for exactly the session that has happened', async () => {
    seed({
      stages: [1, 2, 3].map(n => stage({ id: `s${n}`, meeting_id: `m${n}` })),
      meetings: [
        meeting({ id: 'm1', session_number: 1, start_time: PAST_START, end_time: PAST_END }),
        meeting({ id: 'm2', session_number: 2 }),
        meeting({ id: 'm3', session_number: 3 }),
      ],
    });

    const rows = await items();

    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe('s1');
  });
});

describe('what the row says about itself', () => {
  beforeEach(() => {
    seed({
      stages: [stage({ meeting_id: 'm1' })],
      meetings: [meeting({ id: 'm1', session_number: 3, start_time: PAST_START, end_time: PAST_END })],
    });
  });

  it('dates itself by the session, not by the acceptance', async () => {
    /* It read "7 hours since they approved the proposal" about a session held
       six days ago — so a stale one looked newer than a fresh one. */
    const [row] = await items();

    expect(row.since).toBe(PAST_START);
    expect(row.since).not.toBe('2026-10-14T05:00:00.000Z');
  });

  it('measures the wait from the END, because that is when it is answerable', async () => {
    // `staleFrom`'s documented purpose: a long session must not be asked about
    // while it is still running.
    const [row] = await items();

    expect(row.staleFrom).toBe(PAST_END);
  });

  it('names which session, so two rows are not identical', async () => {
    const [row] = await items();

    // A number, never a sentence: the gaps resolve no language.
    expect(row.sessionNumber).toBe(3);
    expect(row.note).not.toMatch(/[Ss]ession|מפגש/);
  });
});

describe('sessions that did not happen', () => {
  it('drops a cancelled session', async () => {
    seed({
      stages: [stage({ meeting_id: 'm1' })],
      meetings: [
        meeting({
          id: 'm1',
          start_time: PAST_START,
          end_time: PAST_END,
          meeting_status: 'cancelled',
        }),
      ],
    });

    expect(await items()).toEqual([]);
  });

  it('keeps a no-show, because charging for it is the owner\'s call', async () => {
    // The hour was held and the client did not come. That is a decision to
    // make on a row you can see, not one to make by hiding the row.
    seed({
      stages: [stage({ meeting_id: 'm1' })],
      meetings: [
        meeting({ id: 'm1', start_time: PAST_START, end_time: PAST_END, meeting_status: 'no_show' }),
      ],
    });

    expect(await items()).toHaveLength(1);
  });

  it('holds a moved attempt rather than billing a superseded date', async () => {
    /*
     * Should be unreachable — `moveMeeting` repoints a pending unbilled stage
     * at the new attempt so the money follows the session. If it happens, the
     * old row's start is in the past and releasing on it is the exact bug.
     */
    seed({
      stages: [stage({ meeting_id: 'm1' })],
      meetings: [
        meeting({ id: 'm1', start_time: PAST_START, end_time: PAST_END, meeting_status: 'moved' }),
      ],
    });

    expect(await items()).toEqual([]);
  });
});

describe('everything that is not a package is untouched', () => {
  it('a milestone phase still appears on acceptance', async () => {
    /*
     * The case the gap was written for: a quote phase has no date of its own,
     * which is why `staleAfterHours: 0`. It has no `meeting_id` and its
     * booking is the consultation the quote came out of.
     */
    seed({ stages: [stage({ meeting_id: null, booking_id: null })], meetings: [] });

    const rows = await items();

    expect(rows).toHaveLength(1);
    expect(rows[0].since).toBe('2026-10-14T05:00:00.000Z');
    expect(rows[0].sessionNumber).toBeUndefined();
    expect(rows[0].staleFrom).toBeUndefined();
  });

  it('a stage with an unreadable meeting is shown, not hidden', async () => {
    /*
     * The fail-open, kept deliberately: "hiding it over a missing join would
     * lose the owner money silently — the opposite failure, and the worse of
     * the two." What must NOT happen is falling back to the container, whose
     * missing time releases everything.
     */
    seed({ stages: [stage({ meeting_id: 'gone' })], meetings: [] });

    expect(await items()).toHaveLength(1);
  });

  it('an old stage with a dated booking still follows that booking', async () => {
    // Written before `meeting_id` existed: the booking path is its only one.
    tables.payment_plan_installments = [stage({ meeting_id: null, booking_id: 'b-old' })];
    tables.scheduling_meetings = [];
    tables.scheduling_bookings = [{ id: 'b-old', start_time: FUTURE_START }];
    tables.crm_contacts = [{ id: 'c1', first_name: 'A', last_name: 'B', email: 'a@b.com' }];
    tables.proposals = [];

    expect(await items()).toEqual([]);
  });
});
