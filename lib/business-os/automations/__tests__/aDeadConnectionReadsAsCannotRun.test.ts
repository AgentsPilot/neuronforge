/**
 * An agent whose plugin connection is gone says so, rather than being refused.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHOICE THIS PINS, BECAUSE IT WAS MADE THE OTHER WAY FIRST.
 *
 * The first attempt refused activation outright: install and resume both
 * returned an error naming the plugin, and the owner had to connect it and then
 * come back and switch the agent on. Two visits, and the second is the one
 * people forget.
 *
 * The list already had a better answer and had had it all along. `blocked` is a
 * third state beside running and paused — "switched on, and refused at the
 * first step" — and the win-back agent lives in it whenever marketing sending
 * is off. Reusing it means the owner switches the agent on whenever they like,
 * connecting is the LAST thing they do, and the agent starts on its own.
 *
 * So a dead mailbox is the same shape of problem as an unmet business
 * requirement, and gets the same word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT APPLIES TO ALL THREE FAMILIES
 *
 * `blocked: false` used to be hard-coded for the mailbox channel and for an
 * agent the owner wrote. The mailbox channel is the family a revoked Gmail has
 * actually happened to, so that constant was wrong exactly where it mattered
 * most. The fact is computed from `plugins_required` — the column the runtime
 * grants the run from — so it holds for a family with no catalogue entry.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findActiveByUser = jest.fn();
const findScheduled = jest.fn();

jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findActiveByUser: (...a: unknown[]) => findActiveByUser(...a),
  },
}));

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

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

/*
 * `installedAutomations` reads `agent_executions` through `supabaseServer`
 * DIRECTLY (install.ts:865) rather than through a repository, so there is no
 * repository seam to stub, and that read sits OUTSIDE both of the file's try
 * blocks, so a bare `supabaseServer: {}` would throw rather than fail soft.
 * In this suite the read was a real request to the placeholder Supabase URL.
 * An unconfigured fake answers it the way a healthy empty table does, and
 * `deadLetteredRuns` turns that into the same empty map the failed read
 * produced -- so no case here changes. See tests/jest-no-network.ts.
 */
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: jest.requireActual('@/tests/helpers/fakePostgrest').createFakeSupabase().client,
}));

import { installedAutomations } from '../install';

const USER = 'owner-1';

const agentRow = (over: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  agent_name: 'Draft replies to client emails',
  status: 'active',
  schedule_cron: '0 9 * * *',
  plugins_required: ['business-os', 'google-mail'],
  agent_config: { business_os_automation: { id: 'draft_client_replies' } },
  ...over,
});

beforeEach(() => {
  findActiveByUser.mockReset();
  findScheduled.mockReset();
});

const listWith = async (agents: unknown[], connections: unknown) => {
  findScheduled.mockResolvedValue({ data: agents, error: null });
  findActiveByUser.mockResolvedValue(connections);
  return installedAutomations(USER);
};

describe('a mail agent whose mailbox is not connected', () => {
  it('reports it, named, rather than hiding it', async () => {
    const [row] = await listWith([agentRow()], { data: [], error: null });

    expect(row.missingPlugins).toEqual(['google-mail']);
    expect(row.blocked).toBe(true);
  });

  it('is not blocked once the mailbox is connected', async () => {
    const [row] = await listWith([agentRow()], {
      data: [{ plugin_key: 'google-mail' }],
      error: null,
    });

    expect(row.missingPlugins).toEqual([]);
    expect(row.blocked).toBe(false);
  });

  it('counts a revoked connection as missing, because the read is active-only', async () => {
    /* `findActiveByUser` filters on `status = 'active'`, so an expired or
       withdrawn token simply does not come back — and the owner's next action
       is identical to never having connected it. */
    const [row] = await listWith([agentRow()], {
      data: [{ plugin_key: 'slack' }],
      error: null,
    });

    expect(row.missingPlugins).toEqual(['google-mail']);
  });

  it('never counts business-os, which nobody connects', async () => {
    const [row] = await listWith(
      [agentRow({ plugins_required: ['business-os'] })],
      { data: [], error: null }
    );

    expect(row.missingPlugins).toEqual([]);
    expect(row.blocked).toBe(false);
  });
});

describe('the direction it fails when it cannot tell', () => {
  /*
   * THE ONE THAT MATTERS. An empty `connected` set from a FAILED read looks
   * identical to one from an owner who has connected nothing. Reading it the
   * second way would turn every row on the dashboard red the moment that table
   * blinked, with nothing actually wrong.
   */
  it('reports everything as connected when the table cannot be read', async () => {
    const [row] = await listWith([agentRow()], {
      data: null,
      error: new Error('unreadable'),
    });

    expect(row.missingPlugins).toEqual([]);
    expect(row.blocked).toBe(false);
  });
});

describe('the families that used to hard-code blocked: false', () => {
  it('covers the mailbox channel, which is where a revoked Gmail happens', async () => {
    const [row] = await listWith(
      [agentRow({ agent_config: { inbox_channel: { provider: 'google-mail' } } })],
      { data: [], error: null }
    );

    expect(row.family).toBe('mailbox');
    expect(row.blocked).toBe(true);
    expect(row.missingPlugins).toEqual(['google-mail']);
  });

  it('covers an agent the owner wrote themselves', async () => {
    const [row] = await listWith([agentRow({ agent_config: {} })], {
      data: [],
      error: null,
    });

    expect(row.family).toBe('own');
    expect(row.blocked).toBe(true);
    expect(row.missingPlugins).toEqual(['google-mail']);
  });
});
