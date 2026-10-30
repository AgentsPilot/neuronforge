/**
 * Every agent that HAS a stop rule can still be shown one to edit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGRESSION THIS EXISTS FOR
 *
 * The editor's stop control is drawn only when the row carries a `stopAfter`.
 * That field was first resolved from the RAW `agent_config`, and
 * `installAutomation` writes `stopAfterDays: null` whenever the owner took the
 * catalogue's default — which is the common case, because taking the default is
 * what pressing the button without touching the second question does.
 *
 * So every adopted agent installed without changing its stop rule lost the
 * control for changing it. The one screen that could fix a bound was the one
 * that hid it from the agents most likely to need it.
 *
 * The row's `stopAfterDays` had been resolving this correctly since it was
 * added — `config ?? catalogue default` — and the interval simply has to follow
 * the same chain instead of inventing a second one. That is the whole fix, and
 * this suite is what holds the two together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ONE FAMILY WHERE NULL IS CORRECT
 *
 * An agent the owner WROTE has no end-of-life concept: the bound lives in a
 * committed plan's find, and that family has no committed plan. Offering the
 * control there would store a number nothing reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findScheduled = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findScheduled: (...a: unknown[]) => findScheduled(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

jest.mock('@/lib/business-os/gaps/automationApplies', () => ({
  automationApplies: jest.fn().mockResolvedValue(true),
}));

import { installedAutomations } from '../install';
import { AUTOMATION_AGENTS } from '../catalog';
import { INBOX_STOP_AFTER_DEFAULT } from '@/lib/business-os/leads/inboxProviders';

const USER = 'owner-1';
const CHASER = AUTOMATION_AGENTS.find(a => a.id === 'chase_overdue_invoices')!;

function row(agentConfig: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    user_id: USER,
    agent_name: 'An agent',
    status: 'active',
    schedule_cron: '0 9 * * 1',
    timezone: 'UTC',
    last_run: null,
    next_run: '2026-11-02T09:00:00.000Z',
    plugins_required: ['business-os'],
    agent_config: agentConfig,
    ...overrides,
  };
}

const first = async () => (await installedAutomations(USER))[0];

beforeEach(() => jest.clearAllMocks());

describe('an adopted agent that took the default', () => {
  it('still gets a stop rule to edit', async () => {
    /*
     * THE REGRESSION, as one assertion. `stopAfterDays: null` is what install
     * writes when the owner did not answer the second question, and it is the
     * commonest row in the table.
     */
    findScheduled.mockResolvedValue({
      data: [row({ business_os_automation: { id: CHASER.id, stopAfterDays: null } })],
      error: null,
    });

    const agent = await first();

    expect(agent.stopAfter).not.toBeNull();
    expect(agent.stopAfter).toEqual({
      every: CHASER.defaultStopAfterDays,
      unit: 'days',
    });
  });

  it('agrees with the number the row already showed', async () => {
    /* The two are read off the same row by the same screen. Disagreeing would
       mean the column said one bound and the editor opened on another. */
    findScheduled.mockResolvedValue({
      data: [row({ business_os_automation: { id: CHASER.id, stopAfterDays: null } })],
      error: null,
    });

    const agent = await first();

    expect(agent.stopAfter?.every).toBe(agent.stopAfterDays);
  });

  it('prefers what the owner actually chose', async () => {
    findScheduled.mockResolvedValue({
      data: [row({ business_os_automation: { id: CHASER.id, stopAfterDays: 45 } })],
      error: null,
    });

    const agent = await first();

    expect(agent.stopAfter).toEqual({ every: 45, unit: 'days' });
    expect(agent.stopAfterDays).toBe(45);
  });
});

describe('the mailbox channel', () => {
  it('keeps the hours it was set to, which days cannot hold', async () => {
    findScheduled.mockResolvedValue({
      data: [
        row({
          inbox_channel: { provider: 'google-mail', stopAfterDays: 1, stopAfter: '12h' },
        }),
      ],
      error: null,
    });

    const agent = await first();

    expect(agent.stopAfter).toEqual({ every: 12, unit: 'hours' });
    /* And the lossy copy still says a day, because that field cannot say half
       of one. Both are true; only one is exact. */
    expect(agent.stopAfterDays).toBe(1);
  });

  it('falls back to the default on a channel installed before the question', async () => {
    findScheduled.mockResolvedValue({
      data: [row({ inbox_channel: { provider: 'google-mail' } })],
      error: null,
    });

    const agent = await first();

    expect(agent.stopAfter).toEqual({ every: INBOX_STOP_AFTER_DEFAULT, unit: 'days' });
  });
});

describe('an agent the owner wrote', () => {
  it('has no stop rule, and that is not a regression', async () => {
    /*
     * The bound belongs to a committed plan's find, and this family has no
     * committed plan. A control here would store a number nothing reads — the
     * defect the advisor card's threshold stepper already had, where
     * `days_threshold` was written and the detector hardcoded 7.
     */
    findScheduled.mockResolvedValue({
      data: [row({}, { agent_config: {} })],
      error: null,
    });

    const agent = await first();

    expect(agent.family).toBe('own');
    expect(agent.stopAfter).toBeNull();
    expect(agent.stopAfterDays).toBeNull();
  });
});
