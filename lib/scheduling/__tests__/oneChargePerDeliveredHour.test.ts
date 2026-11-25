/**
 * One payment per hour the client actually gets.
 *
 * `replacedHourAlreadyPaid` is the rule that decides whether a replacement
 * session may carry a charge. It was written for a real double charge
 * (package 83e8460c): a no-show was charged and paid at 399.99, its make-up
 * correctly carried no stage, the make-up was MOVED — which until 20261109
 * erased `replaces_meeting_id` — and the replacement booked after it was
 * billed 400.02 for the same delivered hour.
 *
 * The case that matters most here is the last one: the chain must be walked,
 * not read one hop, and ancestors must be judged while the hour being replaced
 * must not be. That second half is what keeps the documented waiver behaviour
 * intact, and it is easy to "fix" into a regression, so it is pinned.
 */

import { replacedHourAlreadyPaid } from '../replacementCharge';

const USER = 'eb4765cd-6b78-4aaa-bb24-d0ff998a2547';

interface Meeting {
  id: string;
  replaces_meeting_id: string | null;
}

/**
 * A fake Supabase client over a fixed graph.
 *
 * The real calls are two shapes: a meeting read ending in `maybeSingle()`, and
 * a stage read that is awaited directly. The chain object answers both, so the
 * test exercises the same call shapes the module really makes.
 */
function makeDb(options: {
  meetings: Meeting[];
  /** meeting id to the statuses of the stages pointing at it. */
  stages: Record<string, string[]>;
  failOn?: 'meeting' | 'stage';
}) {
  const reads: string[] = [];

  const client = {
    reads,
    from(table: string) {
      return {
        select() {
          const filters: Record<string, string> = {};
          const chain: any = {
            eq(column: string, value: string) {
              filters[column] = value;
              return chain;
            },
            /* The meeting read. */
            async maybeSingle() {
              reads.push(`${table}:${filters.id}`);
              if (options.failOn === 'meeting') {
                return { data: null, error: { message: 'read failed' } };
              }
              expect(filters.user_id).toBe(USER);
              const found = options.meetings.find(row => row.id === filters.id) ?? null;
              return { data: found, error: null };
            },
            /* The stage read, awaited without maybeSingle. */
            then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
              reads.push(`${table}:${filters.meeting_id}`);
              const result =
                options.failOn === 'stage'
                  ? { data: null, error: { message: 'read failed' } }
                  : {
                      data: (options.stages[filters.meeting_id] ?? []).map((status, index) => ({
                        id: `${filters.meeting_id}-stage-${index}`,
                        status,
                      })),
                      error: null,
                    };
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
  };

  return client as unknown as Parameters<typeof replacedHourAlreadyPaid>[0]['client'] & {
    reads: string[];
  };
}

describe('an ordinary session being replaced', () => {
  it('is not already paid, so the caller decides and a waived no-show still bills its make-up', async () => {
    const db = makeDb({
      meetings: [{ id: 'session-3', replaces_meeting_id: null }],
      stages: { 'session-3': ['pending'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'session-3',
      client: db,
    });

    expect(verdict).toEqual({
      alreadyPaid: false,
      paidMeetingId: null,
      hops: 0,
      uncertain: false,
    });
  });

  it('never reads the replaced hour’s OWN stage, whose fate the caller has not posted yet', async () => {
    const db = makeDb({
      meetings: [{ id: 'session-3', replaces_meeting_id: null }],
      /* Live stage on the hour being cancelled. Reading it would refuse the
         charge and hand the client a session nobody invoices. */
      stages: { 'session-3': ['paid'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'session-3',
      client: db,
    });

    expect(verdict.alreadyPaid).toBe(false);
    expect(db.reads).not.toContain('payment_plan_installments:session-3');
  });
});

describe('a make-up for an hour the client paid for', () => {
  it('is already paid one hop up, and names the hour holding the money', async () => {
    const db = makeDb({
      meetings: [
        { id: 'make-up', replaces_meeting_id: 'session-1' },
        { id: 'session-1', replaces_meeting_id: null },
      ],
      stages: { 'session-1': ['paid'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'make-up',
      client: db,
    });

    expect(verdict.alreadyPaid).toBe(true);
    expect(verdict.paidMeetingId).toBe('session-1');
    expect(verdict.uncertain).toBe(false);
  });

  it('is already paid TWO hops up, which is the production shape one hop missed', async () => {
    /*
     * Package 83e8460c exactly: the moved attempt carries no stage of its own
     * because the money sits on the no-show it ultimately replaces.
     */
    const db = makeDb({
      meetings: [
        { id: 'moved-make-up', replaces_meeting_id: 'make-up' },
        { id: 'make-up', replaces_meeting_id: 'session-1' },
        { id: 'session-1', replaces_meeting_id: null },
      ],
      stages: { 'make-up': [], 'session-1': ['paid'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'moved-make-up',
      client: db,
    });

    expect(verdict.alreadyPaid).toBe(true);
    expect(verdict.paidMeetingId).toBe('session-1');
    expect(verdict.hops).toBe(2);
  });

  it('is NOT already paid when every hour up the chain was waived', async () => {
    const db = makeDb({
      meetings: [
        { id: 'make-up', replaces_meeting_id: 'session-2' },
        { id: 'session-2', replaces_meeting_id: null },
      ],
      /* `cancelled` is how a waiver is recorded: nothing was collected. */
      stages: { 'session-2': ['cancelled'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'make-up',
      client: db,
    });

    expect(verdict.alreadyPaid).toBe(false);
    expect(verdict.hops).toBe(1);
  });

  it('counts a stage that is merely billed, not yet paid, as money raised for that hour', async () => {
    const db = makeDb({
      meetings: [
        { id: 'make-up', replaces_meeting_id: 'session-1' },
        { id: 'session-1', replaces_meeting_id: null },
      ],
      stages: { 'session-1': ['billed'] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'make-up',
      client: db,
    });

    expect(verdict.alreadyPaid).toBe(true);
  });
});

describe('when the answer cannot be trusted', () => {
  it('treats a failed meeting read as paid rather than billing twice', async () => {
    const db = makeDb({ meetings: [], stages: {}, failOn: 'meeting' });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'make-up',
      client: db,
    });

    expect(verdict).toMatchObject({ alreadyPaid: true, uncertain: true });
  });

  it('treats a failed stage read as paid rather than billing twice', async () => {
    const db = makeDb({
      meetings: [
        { id: 'make-up', replaces_meeting_id: 'session-1' },
        { id: 'session-1', replaces_meeting_id: null },
      ],
      stages: {},
      failOn: 'stage',
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'make-up',
      client: db,
    });

    expect(verdict).toMatchObject({ alreadyPaid: true, uncertain: true });
  });

  it('stops on a chain that loops instead of spinning in a money path', async () => {
    /* `replaces_meeting_id` has no constraint against this. */
    const db = makeDb({
      meetings: [
        { id: 'a', replaces_meeting_id: 'b' },
        { id: 'b', replaces_meeting_id: 'a' },
      ],
      stages: { a: [], b: [] },
    });

    const verdict = await replacedHourAlreadyPaid({
      userId: USER,
      replacedMeetingId: 'a',
      client: db,
    });

    expect(verdict).toMatchObject({ alreadyPaid: true, uncertain: true });
  });
});
