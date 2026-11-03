/**
 * Installed is not the same as working, and only working counts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS GUARDS, WHICH IS THE WORSE DIRECTION
 *
 * Hiding a card because an agent "has it" is only safe while the agent really
 * does. An agent that is paused, has its schedule switched off, or has been
 * dead-lettered after failing looks installed and active from almost every
 * column — and if it still suppressed the card, the owner would be told
 * nothing by anybody. A redundant row is a nuisance; silence is never
 * discovered.
 *
 * Every case below therefore asserts the SAFE answer: not covered, card shows.
 *
 * `deadLetteredRuns` is imported from the agents list rather than
 * reimplemented, so the two can never disagree about what "stopped" means.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findScheduled = jest.fn();
const deadLetteredRuns = jest.fn();
const planInputs = jest.fn();

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: { findScheduled: (...a: unknown[]) => findScheduled(...a) },
}));

jest.mock('@/lib/business-os/automations/install', () => ({
  deadLetteredRuns: (...a: unknown[]) => deadLetteredRuns(...a),
  planInputs: (...a: unknown[]) => planInputs(...a),
}));

jest.mock('@/lib/business-os/automations/catalog', () => ({
  AUTOMATION_AGENTS: [
    { id: 'chase_overdue_invoices', coversGap: 'invoice_unpaid' },
    { id: 'rebook_quiet_clients' },
  ],
}));

import { agentCoverage } from '../coverage';

const USER = 'owner-1';

/** An installed, healthy invoice-chasing agent. */
const agent = (over: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  status: 'active',
  schedule_enabled: true,
  agent_config: { business_os_automation: { id: 'chase_overdue_invoices' } },
  ...over,
});

beforeEach(() => {
  findScheduled.mockReset().mockResolvedValue({ data: [agent()], error: null });
  deadLetteredRuns.mockReset().mockResolvedValue(new Map());
  /* `planInputs` hands the plan a NEGATIVE offset, because the plan spends it
     as a date offset. Coverage wants the magnitude. */
  planInputs.mockReset().mockReturnValue({ stop_after_days: -60 });
});

describe('a healthy agent covers its gap', () => {
  it('up to the owner stop rule, read from planInputs', async () => {
    const coverage = await agentCoverage(USER);

    expect(coverage.get('invoice_unpaid')).toBe(60);
  });

  it('takes the magnitude, not the plan sign', async () => {
    /* A negative window would make every comparison false and cover nothing —
       failing safe, but silently, which is how a fix stops working. */
    planInputs.mockReturnValue({ stop_after_days: -14 });

    expect((await agentCoverage(USER)).get('invoice_unpaid')).toBe(14);
  });
});

describe('what must NOT cover — the card has to show', () => {
  it('a paused agent', async () => {
    findScheduled.mockResolvedValue({ data: [agent({ status: 'paused' })], error: null });

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('an agent whose schedule is switched off', async () => {
    findScheduled.mockResolvedValue({ data: [agent({ schedule_enabled: false })], error: null });

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('a dead-lettered agent — installed, active, and not actually running', async () => {
    /* The one that is easiest to miss: every column says healthy. */
    deadLetteredRuns.mockResolvedValue(new Map([['agent-1', { message: 'stopped' }]]));

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('an agent that claims no gap', async () => {
    findScheduled.mockResolvedValue({
      data: [agent({ agent_config: { business_os_automation: { id: 'rebook_quiet_clients' } } })],
      error: null,
    });

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('an automation with no stop rule — there is no far edge to be inside of', async () => {
    planInputs.mockReturnValue({});

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('an unreadable agent list', async () => {
    /* FAILS OPEN. We cannot tell what is covered, so nothing is. */
    findScheduled.mockResolvedValue({ data: null, error: new Error('boom') });

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('a read that throws outright', async () => {
    findScheduled.mockRejectedValue(new Error('network'));

    expect((await agentCoverage(USER)).size).toBe(0);
  });

  it('no agents at all, which is most businesses', async () => {
    findScheduled.mockResolvedValue({ data: [], error: null });

    expect((await agentCoverage(USER)).size).toBe(0);
  });
});

describe('two agents on one gap', () => {
  it('takes the longer window, because either acting makes the card wrong', async () => {
    findScheduled.mockResolvedValue({
      data: [agent(), agent({ id: 'agent-2' })],
      error: null,
    });
    planInputs
      .mockReturnValueOnce({ stop_after_days: -30 })
      .mockReturnValueOnce({ stop_after_days: -90 });

    expect((await agentCoverage(USER)).get('invoice_unpaid')).toBe(90);
  });
});
