/**
 * An owner may set any schedule the platform can actually run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CATALOGUE'S LISTS ARE FOR NOW
 *
 * `cadenceChoices` and `defaultStopAfterDays` are the RECOMMENDATION — what the
 * control opens on, the number we would have chosen. They were briefly treated
 * as walls, which gave every agent a different control on one screen and made
 * two of them look broken beside a third.
 *
 * The walls that remain are the platform's, and both are facts rather than
 * judgements: five minutes because the scheduler's own cron fires every five,
 * ninety days because past that an agent is switched off rather than scheduled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHAT THE STORAGE HAS TO LOOK LIKE AFTERWARDS
 *
 * An interval in days has no cron expression — a step on day-of-month means
 * days 1, 4, 7 … 28, 31 and then 1 — so those agents store the interval plus a
 * cron that states only the time of day. The scheduler selects on
 * `schedule_cron IS NOT NULL`, so an agent with no expression at all would be
 * active, correct and invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const create = jest.fn();
const findByTag = jest.fn();
const update = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    create: (...a: unknown[]) => create(...a),
    /* How `findInstall` asks whether this business already has one. */
    findByTag: (...a: unknown[]) => findByTag(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

import { installAutomation } from '../install';
import { AUTOMATION_AGENTS } from '../catalog';
import { SCHEDULE_RANGE, STOP_RANGE } from '@/lib/business-os/schedule/ranges';
import { intervalMinutes, parseInterval } from '@/lib/business-os/schedule/interval';

const USER = 'owner-1';

const CHASER = AUTOMATION_AGENTS.find(a => a.id === 'chase_overdue_invoices')!;
const WIN_BACK = AUTOMATION_AGENTS.find(a => a.id === 'win_back_quiet_clients')!;

/** What `create` was called with, as the parts this suite asks about. */
function written() {
  const row = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
  const config = (row?.agent_config ?? {}) as Record<string, Record<string, unknown>>;

  return {
    cron: row?.schedule_cron as string | undefined,
    schedule: config.business_os_automation?.schedule as string | undefined,
    stopAfterDays: config.business_os_automation?.stopAfterDays as number | null | undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  /* Nothing installed yet, so every call takes the create path. */
  findByTag.mockResolvedValue({ data: [], error: null });
  create.mockResolvedValue({ data: { id: 'agent-1' }, error: null });
  update.mockResolvedValue({ data: null, error: null });
});

describe('the interval an owner chose', () => {
  it('stores a value between two old chips exactly as chosen', async () => {
    /*
     * THE POINT OF THE CHANGE. Ten days was not on the chaser's list — it
     * offered daily, every three days, weekly and fortnightly — and is well
     * inside the same walls.
     */
    await installAutomation(USER, CHASER, undefined, undefined, { every: 10, unit: 'days' });

    expect(written().schedule).toBe('10d');
  });

  it('stores a carrier cron that states the time of day', async () => {
    await installAutomation(USER, CHASER, undefined, undefined, { every: 10, unit: 'days' });

    /* Nine in the morning, every day — the TIME, not the cadence. The interval
       beside it is what decides how often. */
    expect(written().cron).toBe('0 9 * * *');
  });

  it('never leaves the cron empty, whatever the interval', async () => {
    /* The scheduler selects on `schedule_cron IS NOT NULL`. An agent with no
       expression would be active, correct and permanently unselected. */
    for (const interval of [
      { every: 1, unit: 'days' as const },
      { every: 10, unit: 'days' as const },
      { every: 30, unit: 'days' as const },
    ]) {
      create.mockClear();
      await installAutomation(USER, CHASER, undefined, undefined, interval);
      expect(written().cron).toBeTruthy();
    }
  });
});

describe('the platform bounds hold, and they are the only ones', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THIS SUITE USED TO ASSERT THE OPPOSITE, AND THE CHANGE WAS DELIBERATE.
   *
   * It held that each automation's `cadenceChoices` was a wall: the chaser
   * could not be made hourly, the win-back agent could not be made weekly. That
   * produced a different control per agent on one screen, and an owner looking
   * at it could only conclude that some of their agents were missing a control
   * the others had.
   *
   * Changing a schedule is not changing what an agent does. Its plan, who it
   * writes to, the repeat-send gates and the stop rule inside the plan are all
   * untouched by moving a run from Tuesday to Wednesday.
   *
   * What survives is the one bound that is a FACT rather than a judgement: the
   * scheduler's own cron fires every five minutes, so nothing may be set faster
   * than the platform can actually run it.
   *
   * The catalogue's lists are still load-bearing — as the DEFAULT the control
   * opens on, which is the recommendation. See the last block.
   * ───────────────────────────────────────────────────────────────────────────
   */

  it('lets an owner run the invoice chaser twice a day', async () => {
    await installAutomation(USER, CHASER, undefined, undefined, { every: 12, unit: 'hours' });

    expect(written().cron).toBe('0 */12 * * *');
  });

  it('lets an owner run the win-back agent weekly', async () => {
    await installAutomation(USER, WIN_BACK, undefined, undefined, { every: 7, unit: 'days' });

    expect(parseInterval(written().schedule ?? '')).toEqual({ every: 7, unit: 'days' });
  });

  it.each(AUTOMATION_AGENTS.map(a => [a.id, a] as const))(
    '%s still cannot outrun the scheduler itself',
    async (_id, automation) => {
      create.mockClear();
      await installAutomation(USER, automation, undefined, undefined, {
        every: 1,
        unit: 'minutes',
      });

      /* Five minutes, which is the cron's own tick. Anything faster is a
         promise the platform cannot keep: the run would simply wait for the
         next pass while the list claimed otherwise. */
      expect(written().cron).toBe('*/5 * * * *');
    }
  );

  it('refuses to slow an agent past the platform ceiling', async () => {
    await installAutomation(USER, CHASER, undefined, undefined, { every: 900, unit: 'days' });

    expect(parseInterval(written().schedule ?? '')).toEqual(SCHEDULE_RANGE.max);
  });
});

describe('the stop rule became a range too', () => {
  it('keeps a value between two old chips instead of discarding it', async () => {
    /*
     * The chaser listed 30, 60, 90 and 120. The old check was `includes`, so 45
     * fell through to null — the default — and the owner's answer disappeared
     * with nothing said. A range keeps it.
     */
    await installAutomation(USER, CHASER, undefined, 45);

    expect(written().stopAfterDays).toBe(45);
  });

  it('keeps a bound shorter than the agent used to offer', async () => {
    /* One day is below every `stopAfterChoices` list and well inside the
       platform range, so it is the owner's to choose. */
    await installAutomation(USER, CHASER, undefined, 1);

    expect(written().stopAfterDays).toBe(1);
  });

  it('clamps one past the platform ceiling', async () => {
    await installAutomation(USER, CHASER, undefined, 3000);

    expect(written().stopAfterDays).toBe(intervalMinutes(STOP_RANGE.max) / 1440);
  });

  it('still means "the default" when nothing was chosen', async () => {
    /* Null and not a number, so the RUNTIME resolves the default and an install
       made before a default changed picks the new one up. */
    await installAutomation(USER, CHASER);

    expect(written().stopAfterDays).toBeNull();
  });
});

describe('nothing changes for a caller that did not ask for an interval', () => {
  it('a named cadence still becomes its own cron and no interval', async () => {
    await installAutomation(USER, CHASER, 'weekly');

    expect(written().cron).toBe('0 9 * * 1');
    expect(written().schedule).toBeUndefined();
  });

  it('no cadence at all still becomes the catalogue default', async () => {
    await installAutomation(USER, CHASER);

    expect(written().cron).toBe(CHASER.defaultCron);
    expect(written().schedule).toBeUndefined();
  });
});
