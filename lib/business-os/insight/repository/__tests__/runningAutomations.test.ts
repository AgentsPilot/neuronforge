/**
 * What "Working on its own" is allowed to count.
 *
 * Automations live in two places, and the journey node was reading one of them:
 *
 *   insight_automations   a standing rule attached to a detector, created by
 *                         "Set this up permanently" on an insight card. Empty on
 *                         every account in the database
 *
 *   business_profiles     the three operational automations the advisor asks
 *                         about, each a boolean column. The only automations
 *                         anybody has ever turned on
 *
 * So the node said nothing was working on its own to an owner with two of them
 * switched on and sending email on their behalf.
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
