/**
 * What "Working on its own" is allowed to count.
 *
 * Automations live in THREE places, and the journey node has been reading fewer
 * than all of them twice now:
 *
 *   insight_automations   a standing rule attached to a detector, created by
 *                         "Set this up permanently" on an insight card. Empty on
 *                         every account in the database
 *
 *   business_profiles     the operational automations the advisor asks about,
 *                         each a boolean column. For a long time the only
 *                         automations anybody had ever turned on
 *
 *   agents                an installed catalogue automation
 *                         (`business-os-automation`) or the mailbox channel
 *                         (`inbox-enquiries`) — scheduled rows that run
 *                         themselves, added after this node was last fixed
 *
 * The first miss told an owner with two switches on and email going out on
 * their behalf that nothing was working on its own. The second left the Gmail
 * channel — running every few minutes, filing leads — out of the number.
 */

import { InsightRepository } from '../InsightRepository';
import { automationApplies } from '@/lib/business-os/gaps/automationApplies';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

jest.mock('@/lib/business-os/gaps/automationApplies', () => ({
  automationApplies: jest.fn(),
}));

const applies = automationApplies as jest.Mock;

type Profile = Record<string, boolean> | null;

function mockSupabase(profile: Profile, fail = false) {
  return {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          fail ? { data: null, error: new Error('unreadable') } : { data: profile, error: null },
      };
      return chain;
    },
  };
}

/** The method is private; the count it produces is the behaviour under test. */
function count(profile: Profile, fail = false): Promise<number> {
  const repository = new InsightRepository(mockSupabase(profile, fail) as never);
  return (repository as unknown as {
    countOperationalAutomations: (userId: string) => Promise<number>;
  }).countOperationalAutomations('user-1');
}

beforeEach(() => {
  jest.clearAllMocks();
  applies.mockResolvedValue(true);
});

describe('countOperationalAutomations', () => {
  it('counts the ones switched on', async () => {
    expect(await count({
      lead_autosend_enabled: true,
      chase_invoices_enabled: true,
      chase_intake_enabled: false,
    })).toBe(2);
  });

  it('is zero when nothing has been turned on', async () => {
    expect(await count({
      lead_autosend_enabled: false,
      chase_invoices_enabled: false,
      chase_intake_enabled: false,
    })).toBe(0);
  });

  it('does not ask whether the switched-off ones could act', async () => {
    // A business that has enabled nothing should pay for one row and no more.
    await count({
      lead_autosend_enabled: false,
      chase_invoices_enabled: false,
      chase_intake_enabled: false,
    });

    expect(applies).not.toHaveBeenCalled();
  });

  it('does not count one that is on but cannot act', async () => {
    /*
     * The intake reminder switched on with no published form. Nothing runs, and
     * calling it "working on its own" would be the same overstatement this
     * whole node was fixed to stop making.
     */
    applies.mockImplementation(async (_userId: string, automation: { id: string }) =>
      automation.id !== 'chase_intake'
    );

    expect(await count({
      lead_autosend_enabled: true,
      chase_invoices_enabled: false,
      chase_intake_enabled: true,
    })).toBe(1);
  });

  it('reports none rather than failing the dashboard when the profile is unreadable', async () => {
    expect(await count(null, true)).toBe(0);
  });

  it('treats a missing profile row as nothing running', async () => {
    expect(await count(null)).toBe(0);
  });
});

/**
 * The agents. Recorded as a query shape rather than as a number, because the
 * three filters ARE the behaviour: the wrong status counts a paused automation,
 * a missing `deleted_at` counts a removed one, and `contains` instead of
 * `overlaps` counts only one of the two populations.
 */
function agentCount(
  result: { count?: number; error?: Error },
  seen: Record<string, unknown[]>
): Promise<number> {
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => { seen.select = args; return chain; },
    eq: (column: string, value: unknown) => {
      seen.eq = [...(seen.eq ?? []), [column, value]];
      return chain;
    },
    is: (column: string, value: unknown) => { seen.is = [column, value]; return chain; },
    overlaps: (column: string, value: unknown) => {
      seen.overlaps = [column, value];
      return Promise.resolve({ count: result.count ?? 0, error: result.error ?? null });
    },
  };

  const repository = new InsightRepository({
    from: (table: string) => { seen.from = [table]; return chain; },
  } as never);

  return (repository as unknown as {
    countAgentAutomations: (userId: string) => Promise<number>;
  }).countAgentAutomations('user-1');
}

describe('countAgentAutomations', () => {
  it('counts the agents that are running', async () => {
    const seen: Record<string, unknown[]> = {};
    expect(await agentCount({ count: 3 }, seen)).toBe(3);
    expect(seen.from).toEqual(['agents']);
  });

  it('asks only for this owner, only for active, and only for the undeleted', async () => {
    const seen: Record<string, unknown[]> = {};
    await agentCount({ count: 0 }, seen);

    expect(seen.eq).toEqual([
      ['user_id', 'user-1'],
      ['status', 'active'],
    ]);
    expect(seen.is).toEqual(['deleted_at', null]);
  });

  it('counts both populations, not just one', async () => {
    const seen: Record<string, unknown[]> = {};
    await agentCount({ count: 0 }, seen);

    expect(seen.overlaps).toEqual([
      'tags',
      ['business-os-automation', 'inbox-enquiries'],
    ]);
  });

  it('reports none rather than failing the dashboard when the table is unreadable', async () => {
    expect(await agentCount({ error: new Error('unreadable') }, {})).toBe(0);
  });
});
