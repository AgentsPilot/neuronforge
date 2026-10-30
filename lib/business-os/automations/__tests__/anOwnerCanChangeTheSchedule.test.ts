/**
 * Changing a running agent's schedule, without changing anything else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * The two questions were asked once, on the dialog that installed the agent,
 * and there was no way back. A business that got busier could not slow its own
 * invoice chaser down without removing the agent and adopting it again, which
 * loses its run history.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE WAYS THIS COULD GO WRONG, WHICH IS WHAT THIS SUITE IS FOR
 *
 * 1. IT COULD OUTRUN THE CATALOGUE. The ranges are the only thing stopping
 *    `win_back_quiet_clients` becoming hourly to people quiet for a year, and
 *    an edit path that forgot to clamp would be a second door into the same
 *    damage the install path is careful about.
 *
 * 2. IT COULD LEAVE TWO CLOCKS. An interval in days stores an interval plus a
 *    carrier cron; minutes and hours store a cron alone. Moving from one to the
 *    other has to DELETE what it replaces, because `nextRunFor` prefers the
 *    interval — an owner setting hourly over a stale three-day interval would
 *    get every three days while the list said hourly.
 *
 * 3. IT COULD CHANGE MORE THAN THE SCHEDULE. The plan, the name and above all
 *    the STATUS must be untouched: an owner adjusting a cadence has not asked
 *    to resume an agent they deliberately paused.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findById = jest.fn();
const update = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findById: (...a: unknown[]) => findById(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

import { updateAgentSchedule } from '../install';
import { AUTOMATION_AGENTS } from '../catalog';
import { SCHEDULE_RANGE, STOP_RANGE } from '@/lib/business-os/schedule/ranges';
import { intervalMinutes, parseInterval } from '@/lib/business-os/schedule/interval';

const USER = 'owner-1';
const AGENT = 'agent-1';

const CHASER = AUTOMATION_AGENTS.find(a => a.id === 'chase_overdue_invoices')!;
const WIN_BACK = AUTOMATION_AGENTS.find(a => a.id === 'win_back_quiet_clients')!;

/** An adopted agent as it sits on the row, running weekly. */
function adopted(overrides: Record<string, unknown> = {}, automationId = CHASER.id) {
  return {
    data: {
      id: AGENT,
      user_id: USER,
      mode: 'scheduled',
      status: 'active',
      schedule_cron: '0 9 * * 1',
      timezone: 'UTC',
      last_run: '2026-10-26T09:00:00.000Z',
      next_run: '2026-11-02T09:00:00.000Z',
      agent_config: {
        business_os_automation: {
          id: automationId,
          stopAfterDays: 60,
          planVersion: 'abc123',
          installed_at: '2026-10-01T00:00:00.000Z',
        },
        /* Creation metadata a merge must not drop. */
        ai_context: { from: 'v6' },
      },
      ...overrides,
    },
    error: null,
  };
}

/** What `update` was handed. */
function patch() {
  return (update.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
}

function family(key = 'business_os_automation') {
  const config = (patch().agent_config ?? {}) as Record<string, Record<string, unknown>>;
  return config[key] ?? {};
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(adopted());
  update.mockResolvedValue({ data: null, error: null });
});

describe('it stores what the owner chose', () => {
  it('writes an interval a cron cannot express, with a time-of-day carrier', async () => {
    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 10, unit: 'days' },
    });

    expect(outcome.ok).toBe(true);
    expect(family().schedule).toBe('10d');
    /* Nine in the morning, every day: the TIME, not the cadence. The interval
       beside it decides how often. */
    expect(patch().schedule_cron).toBe('0 9 * * *');
  });

  it('keeps a stop rule between two of the old chips', async () => {
    /* The chaser listed 30, 60, 90 and 120. Forty-five is a real answer now. */
    await updateAgentSchedule(USER, AGENT, { stopAfterDays: 45 });

    expect(family().stopAfterDays).toBe(45);
  });

  it('changes one answer without touching the other', async () => {
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 3, unit: 'days' } });

    /* The stop rule was 60 and no new one was sent, so it is still 60 —
       `agent_config` is written wholesale, so an omitted key would erase it. */
    expect(family().stopAfterDays).toBe(60);
  });
});

describe('the platform bounds hold on the way in', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * This block used to assert that an edit could not outrun the automation's
   * own `cadenceChoices`. That rule is gone, deliberately: it gave each agent a
   * different control, and changing WHEN an agent runs does not change what it
   * does — its plan, its audience and its send guards are untouched.
   *
   * What remains is the bound that is a fact: nothing may be set faster than
   * the scheduler itself runs.
   * ───────────────────────────────────────────────────────────────────────────
   */

  it('lets an owner speed the invoice chaser up to twice a day', async () => {
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 12, unit: 'hours' } });

    expect(patch().schedule_cron).toBe('0 */12 * * *');
  });

  it('lets an owner run the win-back agent weekly', async () => {
    findById.mockResolvedValue(adopted({}, WIN_BACK.id));

    await updateAgentSchedule(USER, AGENT, { schedule: { every: 7, unit: 'days' } });

    expect(parseInterval(family().schedule as string | null)).toEqual({
      every: 7,
      unit: 'days',
    });
  });

  it('refuses a cadence faster than the scheduler itself', async () => {
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 1, unit: 'minutes' } });

    expect(patch().schedule_cron).toBe('*/5 * * * *');
  });

  it('clamps a stop rule past the platform ceiling', async () => {
    await updateAgentSchedule(USER, AGENT, { stopAfterDays: 3000 });

    expect(family().stopAfterDays).toBe(intervalMinutes(STOP_RANGE.max) / 1440);
  });
});

describe('the next run moves, and where to', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ASSERTED ON THE PATCH, NOT ON THE RETURN VALUE.
   *
   * The first version of these three read `outcome.nextRun`, which is computed
   * beside the write rather than from it — so deleting the `patch.next_run`
   * line entirely left all three passing. A negative control caught it. The
   * agent's clock would never have moved and the suite would have said it did.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const written = () => patch().next_run as string | undefined;

  it('is counted from the last run, not from now', async () => {
    /*
     * An agent that ran on the 26th and is now daily is next due on the 27th.
     * Counting from the clock instead would put the send time wherever the
     * owner happened to open the dropdown.
     */
    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 1, unit: 'days' },
    });

    expect(written()).toBeTruthy();

    const next = new Date(written()!);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    /* And reported back, so the list can say what just happened. */
    expect(outcome.nextRun).toBe(written());
  });

  it('is brought forward when the cadence speeds up', async () => {
    /*
     * THE REASON `next_run` CANNOT BE LEFT ALONE. The row is due on 2 November;
     * going daily has to mean sooner than that, or the list says "every day"
     * over a next run a week out and nothing explains it.
     */
    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 1, unit: 'days' },
    });

    expect(written()).toBeTruthy();
    expect(Date.parse(written()!)).toBeLessThan(Date.parse('2026-11-02T09:00:00.000Z'));
  });

  it('is never now, so nothing sends while the owner is still on the screen', async () => {
    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 1, unit: 'days' },
    });

    expect(written()).toBeTruthy();
    expect(Date.parse(written()!)).toBeGreaterThan(Date.now());
  });

  it('is left alone when only the stop rule changed', async () => {
    /* Nothing about "give up after 45 days instead of 60" says the next run
       should move. */
    await updateAgentSchedule(USER, AGENT, { stopAfterDays: 45 });

    expect(patch().next_run).toBeUndefined();
  });
});

describe('it changes the schedule and nothing else', () => {
  it('never writes the status', async () => {
    /*
     * HAZARD 3, and the one that would be worst. An owner adjusting a cadence
     * has not asked to restart an agent they deliberately paused — the same
     * mistake the advisor card's "I got it" path exists to avoid.
     */
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 3, unit: 'days' } });

    expect(patch()).not.toHaveProperty('status');
    expect(patch()).not.toHaveProperty('schedule_enabled');
  });

  it('never writes the plan', async () => {
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 3, unit: 'days' } });

    expect(patch()).not.toHaveProperty('pilot_steps');
    expect(patch()).not.toHaveProperty('workflow_steps');
    expect(patch()).not.toHaveProperty('agent_name');
  });

  it('keeps every other key in agent_config', async () => {
    /* It is written wholesale, so a merge that dropped the V6 context or the
       plan stamp would make a just-edited agent look stale for ever. */
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 3, unit: 'days' } });

    const config = patch().agent_config as Record<string, unknown>;
    expect(config.ai_context).toEqual({ from: 'v6' });
    expect(family().planVersion).toBe('abc123');
    expect(family().installed_at).toBe('2026-10-01T00:00:00.000Z');
    expect(family().id).toBe(CHASER.id);
  });

  it('is scoped to the owner on both the read and the write', async () => {
    await updateAgentSchedule(USER, AGENT, { schedule: { every: 3, unit: 'days' } });

    expect(findById).toHaveBeenCalledWith(AGENT, USER);
    expect(update.mock.calls[0][0]).toBe(AGENT);
    expect(update.mock.calls[0][1]).toBe(USER);
  });
});

describe('what it refuses', () => {
  it('an agent that is not this owner', async () => {
    findById.mockResolvedValue({ data: null, error: null });

    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 3, unit: 'days' },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('not_found');
    expect(update).not.toHaveBeenCalled();
  });

  it('an agent that is not scheduled', async () => {
    /* Matched to the pause guard: this surface controls scheduled agents, and
       giving an on-demand one a cadence would start running it unasked. */
    findById.mockResolvedValue(adopted({ mode: 'on_demand' }));

    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 3, unit: 'days' },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('not_scheduled');
    expect(update).not.toHaveBeenCalled();
  });

  it('a deleted agent', async () => {
    findById.mockResolvedValue(adopted({ deleted_at: '2026-10-01T00:00:00.000Z' }));

    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 3, unit: 'days' },
    });

    expect(outcome.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('a call that asks for nothing', async () => {
    const outcome = await updateAgentSchedule(USER, AGENT, {});

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('nothing_to_change');
    expect(update).not.toHaveBeenCalled();
  });

  it('reports a failed write rather than claiming success', async () => {
    update.mockResolvedValue({ data: null, error: new Error('database unreachable') });

    const outcome = await updateAgentSchedule(USER, AGENT, {
      schedule: { every: 3, unit: 'days' },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('write_failed');
  });
});

describe('the mailbox channel, which keeps its own two fields in step', () => {
  function mailbox() {
    return {
      data: {
        id: AGENT,
        user_id: USER,
        mode: 'scheduled',
        status: 'active',
        schedule_cron: '*/15 * * * *',
        timezone: 'UTC',
        last_run: '2026-10-29T09:00:00.000Z',
        next_run: '2026-10-29T09:15:00.000Z',
        agent_config: {
          inbox_channel: {
            provider: 'google-mail',
            stopAfterDays: 30,
            stopAfter: '30d',
            watching: 'forms@example.com',
          },
        },
      },
      error: null,
    };
  }

  it('accepts a stop rule in HOURS and keeps the unit', async () => {
    /*
     * ───────────────────────────────────────────────────────────────────────────
     * THE BUG, FROM THE SERVER'S SIDE.
     *
     * `updateAgentSchedule` took `stopAfterDays` and nothing else, so an owner
     * pressing "hours" in the agents list had their answer converted to a
     * number of hours and then stored as that many DAYS — 720 of them, clamped
     * to the ceiling. The unit could not survive the trip because the parameter
     * had no room for it.
     * ───────────────────────────────────────────────────────────────────────────
     */
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { stopAfter: { every: 12, unit: 'hours' } });

    expect(family('inbox_channel').stopAfter).toBe('12h');
    /* And the lossy copy beside it, which every older reader still uses: half
       a day rounds to one, and that is the best that field can do. */
    expect(family('inbox_channel').stopAfterDays).toBe(1);
  });

  it('still takes a plain day count from a caller that has not changed', async () => {
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { stopAfterDays: 21 });

    expect(family('inbox_channel').stopAfterDays).toBe(21);
    expect(family('inbox_channel').stopAfter).toBe('21d');
  });

  it('clamps an hour count below the floor', async () => {
    /* One hour is narrower than the channel looks back, and a window under the
       floor would miss mail the sweep was meant to catch. */
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { stopAfter: { every: 1, unit: 'hours' } });

    expect(family('inbox_channel').stopAfter).toBe('12h');
  });

  it('writes the hours its window can hold, beside the rounded days', async () => {
    /*
     * `stopAfterDays` cannot say twelve hours — it rounds to one day — and
     * `inputsFor` computes the search window from `stopAfter`. Both are written
     * so no reader sees a window the owner did not ask for.
     */
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { stopAfterDays: 14 });

    expect(family('inbox_channel').stopAfterDays).toBe(14);
    expect(family('inbox_channel').stopAfter).toBe('14d');
  });

  it('writes an exact cron and CLEARS the interval it replaces', async () => {
    /*
     * ───────────────────────────────────────────────────────────────────────────
     * HAZARD 2, and it belongs HERE rather than on an adopted agent.
     *
     * The first version of this test moved the invoice chaser to four-hourly
     * and asserted the cron. It failed, correctly: the chaser's floor IS daily,
     * so four hours was clamped away and the assertion was measuring the floor
     * rather than the thing it was written for. The mailbox is the family whose
     * range admits minutes, so it is where this can be asked.
     *
     * The row is on a three-day interval; thirty minutes compiles exactly, so
     * nothing may be left behind — `nextRunFor` reads the interval FIRST, and a
     * stale one would run the channel every three days while the list said
     * every thirty minutes.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const row = mailbox();
    (row.data.agent_config.inbox_channel as Record<string, unknown>).schedule = '3d';
    findById.mockResolvedValue(row);

    await updateAgentSchedule(USER, AGENT, { schedule: { every: 30, unit: 'minutes' } });

    expect(patch().schedule_cron).toBe('*/30 * * * *');
    expect(family('inbox_channel').schedule).toBeNull();
  });

  it('keeps what setup measured from the owner own mail', async () => {
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { schedule: { every: 30, unit: 'minutes' } });

    expect(family('inbox_channel').watching).toBe('forms@example.com');
    expect(patch().schedule_cron).toBe('*/30 * * * *');
  });

  it('cannot be set faster than the platform can run it', async () => {
    /* The scheduler's own cron fires every five minutes. Anything faster is a
       promise the platform cannot keep. */
    findById.mockResolvedValue(mailbox());

    await updateAgentSchedule(USER, AGENT, { schedule: { every: 1, unit: 'minutes' } });

    expect(patch().schedule_cron).toBe('*/5 * * * *');
  });
});
