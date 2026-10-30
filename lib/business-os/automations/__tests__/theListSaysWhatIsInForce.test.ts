/**
 * The agents list reports what is in force, not what the owner typed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEST EXISTS
 *
 * `cadence` and `stopAfterDays` are stored as the owner's EXPLICIT choice and
 * left null when they made none. Nothing about the agent is null in that case:
 * `installAutomation` writes `automation.defaultCron` onto the row either way,
 * and `planInputs` hands the plan `defaultStopAfterDays`. So the agent runs on
 * a real cadence and gives up after a real number of days.
 *
 * The list read those two columns straight off the stored choice, and the live
 * account showed both halves of what that costs:
 *
 *   rebook_quiet_clients     scheduled `0 9 1,15 * *`, "Every" read "—"
 *   chase_overdue_invoices   plan spends -60 days, "Stops after" read "—"
 *
 * An owner reads that dash as "no limit" or "nobody knows". It actually writes
 * to their clients twice a month and stops after two months, and those are the
 * two facts they came to this list to check before trusting it.
 *
 * Mocked rather than live, because the defect is a null-handling branch and a
 * live account only has it when somebody happens to have installed without
 * choosing. Both directions are exercised: a stored choice must survive, and
 * an absent one must resolve.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * `findScheduled`, not `findByTag`.
 *
 * The list selects on the scheduling CONTRACT (`mode = 'scheduled'`) rather
 * than on one tag, which is what makes the mailbox channel appear on it at all
 * — a tag names a family, the contract names the behaviour.
 */
const findScheduled = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: { findScheduled: (...args: unknown[]) => findScheduled(...args) },
}));

/* The owner's language. Mocked so the list stays hermetic: without it the
   dictionary read reaches for a real profile and falls back to English. */
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

/* Switched on and able to run: this test is about the two schedule columns,
   and `blocked` has its own. */
jest.mock('@/lib/business-os/gaps/automationApplies', () => ({
  automationApplies: jest.fn().mockResolvedValue(true),
}));

import { installedAutomations } from '../install';
import { automationById } from '../catalog';
import { CADENCE_CRON } from '../types';

function row(overrides: {
  id: string;
  cadence?: string | null;
  stopAfterDays?: number | null;
  schedule_cron?: string | null;
}) {
  return {
    id: `agent-${overrides.id}`,
    agent_name: `Agent ${overrides.id}`,
    status: 'active',
    mode: 'scheduled',
    tags: ['business-os-automation', `business-os-automation:${overrides.id}`],
    last_run: null,
    next_run: null,
    schedule_cron:
      overrides.schedule_cron === undefined
        ? automationById(overrides.id)?.defaultCron
        : overrides.schedule_cron,
    agent_config: {
      business_os_automation: {
        id: overrides.id,
        cadence: overrides.cadence ?? null,
        stopAfterDays: overrides.stopAfterDays ?? null,
      },
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe('an install that made no choices', () => {
  it('reports the cadence the scheduler will actually fire on', async () => {
    /* The live defect, exactly: stored null, scheduled fortnightly. */
    findScheduled.mockResolvedValue({
      data: [row({ id: 'rebook_quiet_clients', schedule_cron: '0 9 1,15 * *' })],
      error: null,
    });

    const [agent] = await installedAutomations('owner-1');

    expect(agent.cadence).toBe('fortnightly');
    expect(agent.cadence).not.toBeNull();
  });

  it('reports the day count the plan is going to spend', async () => {
    findScheduled.mockResolvedValue({
      data: [row({ id: 'chase_overdue_invoices' })],
      error: null,
    });

    const [agent] = await installedAutomations('owner-1');
    const automation = automationById('chase_overdue_invoices')!;

    /* The same number `planInputs` hands the plan, which is what makes the
       column true rather than merely non-empty. */
    expect(agent.stopAfterDays).toBe(automation.defaultStopAfterDays);
  });

  it('agrees with planInputs for every agent in the catalogue', async () => {
    /*
     * The invariant behind both cases above: whatever the list SAYS it stops
     * after is what the run actually stops after. Stated over the whole
     * catalogue so a new agent cannot be added with the two disagreeing.
     */
    const { planInputs } = await import('../install');
    const { AUTOMATION_AGENTS } = await import('../catalog');

    for (const automation of AUTOMATION_AGENTS) {
      findScheduled.mockResolvedValue({ data: [row({ id: automation.id })], error: null });

      const [agent] = await installedAutomations('owner-1');
      const spent = planInputs(automation, {
        business_os_automation: { id: automation.id, stopAfterDays: null },
      });

      expect(`${automation.id}: list ${agent.stopAfterDays}, plan ${spent.stop_after_days}`).toBe(
        `${automation.id}: list ${automation.defaultStopAfterDays}, plan ${-automation.defaultStopAfterDays}`
      );
    }
  });
});

describe('an install that did make choices', () => {
  it('keeps the owner choice and does not overwrite it with the default', async () => {
    const automation = automationById('rebook_quiet_clients')!;
    const chosen = automation.stopAfterChoices.find(d => d !== automation.defaultStopAfterDays)!;

    findScheduled.mockResolvedValue({
      data: [row({ id: 'rebook_quiet_clients', cadence: 'monthly', stopAfterDays: chosen })],
      error: null,
    });

    const [agent] = await installedAutomations('owner-1');

    expect(agent.cadence).toBe('monthly');
    expect(agent.stopAfterDays).toBe(chosen);
  });
});

describe('a cron nobody offered', () => {
  it('says nothing rather than inventing a name for it', async () => {
    /*
     * A hand-edited row. The dash is right here: naming this "weekly" because
     * it is nearly weekly would be wrong rather than merely silent, and wrong
     * is what the whole fix above is about.
     */
    findScheduled.mockResolvedValue({
      data: [row({ id: 'rebook_quiet_clients', schedule_cron: '17 4 */2 * *' })],
      error: null,
    });

    const [agent] = await installedAutomations('owner-1');

    expect(agent.cadence).toBeNull();
    expect(Object.values(CADENCE_CRON)).not.toContain('17 4 */2 * *');
  });

  it('still answers for a row with no cron at all', async () => {
    /* An older row, or one the scheduler has not been told about. The
       catalogue default is the honest answer: it is what an install writes. */
    findScheduled.mockResolvedValue({
      data: [row({ id: 'rebook_quiet_clients', schedule_cron: null })],
      error: null,
    });

    const [agent] = await installedAutomations('owner-1');

    expect(agent.cadence).toBe(
      (Object.entries(CADENCE_CRON) as [string, string][])
        .find(([, cron]) => cron === automationById('rebook_quiet_clients')!.defaultCron)?.[0]
    );
  });
});
