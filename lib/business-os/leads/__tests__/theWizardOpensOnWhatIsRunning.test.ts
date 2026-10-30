/**
 * The setup wizard reports what a channel is actually set to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A DATA-LOSS BUG AND NOT A DISPLAY ONE
 *
 * Step four of the wizard held its two answers in `useState` seeded from
 * constants, so it opened on fifteen minutes and thirty days whatever the
 * channel was running on.
 *
 * Re-running setup on a mailbox that already has a channel does not create a
 * second one — `enableInboxChannel` takes its UPDATE path. So an owner who
 * opened the wizard to fix their template, or to point it at a different
 * sender, and pressed "Start now" silently reset a cadence they had
 * deliberately changed somewhere else. Nothing warned them and nothing in the
 * result said it had happened.
 *
 * Found by setting a live Gmail channel to run daily from the agents list, then
 * noticing the wizard still offering fifteen minutes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUITE PINS
 *
 * The status row is where the wizard learns it, so the row has to carry both
 * answers — read from the CONFIG, never from the cron. A days interval stores a
 * carrier expression stating only the time of day, so a wizard reading
 * `schedule_cron` would be told "every day at nine" about an agent set to every
 * three days.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * `inboxChannelStatus` reads `supabaseServer.from('agents')` directly rather
 * than through the repository, so the table is what has to answer. Measured,
 * not assumed: the first version of this file mocked `agentRepository` and
 * every test failed with an empty channel list.
 */
let agents: unknown[] = [];
let connections: unknown[] = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const rows = () =>
        table === 'agents' ? agents : table === 'plugin_connections' ? connections : [];

      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        not: () => chain,
        is: () => chain,
        contains: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      });

      return chain;
    },
  },
}));

import { inboxChannelStatus } from '../inboxChannel';
import { parseInterval } from '@/lib/business-os/schedule/interval';

const USER = 'owner-1';

/** One channel agent, as the row sits in the table. */
function channelAgent(config: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    user_id: USER,
    agent_name: 'Website enquiries from Gmail',
    status: 'active',
    mode: 'scheduled',
    schedule_enabled: true,
    /* The carrier: a days interval stores the TIME OF DAY here and nothing
       about the cadence. Reading it would mislead. */
    schedule_cron: '0 9 * * *',
    last_run: '2026-10-30T17:55:07.000Z',
    tags: ['inbox-enquiries', 'inbox-enquiries:google-mail'],
    agent_config: { inbox_channel: { provider: 'google-mail', ...config } },
    ...overrides,
  };
}

const firstChannel = async () => (await inboxChannelStatus(USER)).channels[0];

beforeEach(() => {
  jest.clearAllMocks();
  agents = [];
  /* A connected Gmail, so the channel is a real one rather than an orphan. */
  connections = [{ plugin_name: 'google-mail', status: 'connected' }];
});

describe('the row carries what the owner set', () => {
  it('reports a daily cadence as daily, not as the carrier cron', async () => {
    /*
     * THE BUG, as one assertion. The agent runs every day because its interval
     * says so; its cron says 09:00 and nothing about how often.
     */
    agents = [channelAgent({ schedule: '1d', stopAfter: '30d', stopAfterDays: 30 })];

    const channel = await firstChannel();

    expect(channel.schedule).toBe('1d');
    expect(parseInterval(channel.schedule)).toEqual({ every: 1, unit: 'days' });
  });

  it('reports a window measured in hours', async () => {
    /* The one answer `stopAfterDays` cannot hold: twelve hours rounds to one
       day there, and the wizard must not offer a day back. */
    agents = [channelAgent({ schedule: '15m', stopAfter: '12h', stopAfterDays: 1 })];

    const channel = await firstChannel();

    expect(parseInterval(channel.stopAfter)).toEqual({ every: 12, unit: 'hours' });
  });

  it('falls back to the rounded day count where there is no exact one', async () => {
    /* A channel configured before the window could be stated in hours. */
    agents = [channelAgent({ schedule: '15m', stopAfterDays: 14 })];

    const channel = await firstChannel();

    expect(channel.stopAfter).toBe('14d');
  });

  it('says nothing rather than guessing on a channel from before the question', async () => {
    /*
     * Null, not a default. The dialog owns the default — it is the one place
     * that knows what it opens on — and a row inventing one here would be a
     * second answer to the same question.
     */
    agents = [channelAgent({})];

    const channel = await firstChannel();

    expect(channel.schedule).toBeNull();
    expect(channel.stopAfter).toBeNull();
  });

  it('never reads the cadence off the cron', async () => {
    /*
     * The carrier states a time of day. An agent set to every three days has
     * `0 9 * * *` on it, and a reader taking that for the cadence would tell
     * the owner their channel runs daily — then write daily when they saved.
     */
    agents = [channelAgent({ schedule: '3d' }, { schedule_cron: '0 9 * * *' })];

    const channel = await firstChannel();

    expect(channel.schedule).toBe('3d');
  });
});
