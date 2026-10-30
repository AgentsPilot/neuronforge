/**
 * A resumed agent is next due in the FUTURE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, SEEN ON A LIVE ACCOUNT
 *
 * `resumeAutomation` called `activate`, which writes `status` and nothing else.
 * So `next_run` kept the value it held when the agent was paused — by
 * definition in the past by the time anybody resumes it.
 *
 * Two agents switched back on showed "29 באוק׳" as their next run on the
 * thirtieth. That reads as a broken agent rather than a resumed one, and it is
 * not only a display problem: the scheduler selects on `next_run <= now()`, so
 * both were immediately due and would fire on the next tick instead of
 * resuming their own rhythm. An agent paused for a month comes back and runs at
 * once, to whoever it writes to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO CASES, WHICH WANT OPPOSITE ANSWERS
 *
 *   it has run before   resume its rhythm: counted from the last run and
 *                       advanced past now, so it is at most one interval away
 *                       and keeps the time of day it already used.
 *
 *   it has never run    date it NOW, like install. Somebody switching on an
 *                       agent that has never worked is asking for it to work,
 *                       and a week's wait for the first run of a weekly chaser
 *                       is not what they pressed the button for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findById = jest.fn();
const activate = jest.fn();
const update = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findById: (...a: unknown[]) => findById(...a),
    activate: (...a: unknown[]) => activate(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

import { resumeAutomation } from '../install';

const USER = 'owner-1';
const AGENT = 'agent-1';

/** A paused agent whose clock stopped a day ago. */
function paused(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: AGENT,
      user_id: USER,
      mode: 'scheduled',
      status: 'inactive',
      schedule_cron: '0 9 * * 1',
      timezone: 'UTC',
      last_run: '2026-10-23T09:00:00.000Z',
      next_run: '2026-10-29T11:22:00.000Z',
      agent_config: { business_os_automation: { id: 'chase_overdue_invoices' } },
      ...overrides,
    },
    error: null,
  };
}

/** The `next_run` the resume wrote, if it wrote one. */
function clock(): string | undefined {
  const call = update.mock.calls.find(c => (c[2] as Record<string, unknown>)?.next_run);
  return (call?.[2] as Record<string, unknown> | undefined)?.next_run as string | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(paused());
  activate.mockResolvedValue({ data: null, error: null });
  update.mockResolvedValue({ data: null, error: null });
});

describe('an agent that has run before', () => {
  it('is next due in the future, not in the past', async () => {
    /* THE BUG, as one assertion. Everything else here is about WHERE in the
       future, and this is about it being there at all. */
    const ok = await resumeAutomation(USER, AGENT);

    expect(ok).toBe(true);
    expect(clock()).toBeTruthy();
    expect(Date.parse(clock()!)).toBeGreaterThan(Date.now());
  });

  it('resumes its own rhythm rather than starting a new one', async () => {
    /*
     * Counted from the last run, so a weekly agent lands on the weekday and
     * time it already used — and within one interval of now rather than a week
     * out from the moment somebody pressed resume.
     */
    await resumeAutomation(USER, AGENT);

    const next = new Date(clock()!);

    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it('reads the stored interval in preference to the cron', async () => {
    /* A days interval carries a cron stating only the time of day. Reading
       that for the cadence would resume a three-day agent as a daily one. */
    findById.mockResolvedValue(
      paused({
        schedule_cron: '0 9 * * *',
        agent_config: { business_os_automation: { id: 'x', schedule: '3d' } },
        last_run: '2026-10-29T09:00:00.000Z',
      })
    );

    await resumeAutomation(USER, AGENT);

    /* Three days after the last run, not one. */
    expect(clock()).toBe('2026-11-01T09:00:00.000Z');
  });
});

describe('an agent that has never run', () => {
  it('is dated now, so switching it on starts it', async () => {
    /*
     * The opposite answer, and deliberately so. Counting an interval from
     * nothing would make a weekly chaser wait a week before its first run,
     * which is not what pressing resume means.
     */
    findById.mockResolvedValue(paused({ last_run: null }));

    await resumeAutomation(USER, AGENT);

    expect(Math.abs(Date.parse(clock()!) - Date.now())).toBeLessThan(5_000);
  });
});

describe('what it will not do', () => {
  it('leaves a schedule it cannot read exactly as it is', async () => {
    /*
     * A weekday list from the prompt flow's builder is not an interval, so
     * there is no honest next run to compute. Being due immediately is a
     * smaller wrong than being moved to a date nobody chose.
     */
    findById.mockResolvedValue(
      paused({ schedule_cron: '0 9 * * 1,3,5', agent_config: {} })
    );

    await resumeAutomation(USER, AGENT);

    expect(clock()).toBeUndefined();
  });

  it('still reports the resume when the clock cannot be written', async () => {
    /*
     * The agent IS active by then. Reporting failure would invite a second
     * press, and a stale clock makes it due sooner than it should be — a wrong
     * time rather than a wrong state.
     */
    update.mockResolvedValue({ data: null, error: new Error('write failed') });

    expect(await resumeAutomation(USER, AGENT)).toBe(true);
  });

  it('writes the status before the clock', async () => {
    /*
     * The other order would leave a paused agent holding a freshly advanced
     * clock if the second write failed — a silent skip of one run, with
     * nothing anywhere saying so.
     */
    await resumeAutomation(USER, AGENT);

    expect(activate).toHaveBeenCalled();
    expect(activate.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0]
    );
  });

  it('does not touch the clock when the resume itself failed', async () => {
    activate.mockResolvedValue({ data: null, error: new Error('database unreachable') });

    expect(await resumeAutomation(USER, AGENT)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
