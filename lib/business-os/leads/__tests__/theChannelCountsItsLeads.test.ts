/**
 * The inbox channel reports the leads it brought in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SUITE EXISTS: THE COUNT WAS ZERO FOR EVERY ACCOUNT
 *
 * `inboxChannelStatus` read the lead count itself, with this filter on it:
 *
 *     .from('crm_contacts') … .is('deleted_at', null)
 *
 * `crm_contacts` has no `deleted_at` column — deletes there are hard. PostgREST
 * rejects the WHOLE query for one unknown name (42703), the call site
 * destructured only `data` and threw the `error` away, and a null result tallies
 * to zero. So every inbox channel on every account reported **0 leads** on all
 * four surfaces that ask — the Channels card, the onboarding build page, My Day
 * and the readiness gate — while the mailbox agent was filing enquiries
 * perfectly.
 *
 * Nothing caught it, and nothing could have: no suite exercised the count at
 * all, and the one that exercises this function answers every table with the
 * same fake, so a rejected query and an account with no leads are identical to
 * it. Zero is also a legitimate answer here, which is what let it pass for a
 * month as a quiet product fact.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEAM, AND WHY IT IS NOT THE TABLE
 *
 * The reads now go through repositories (CLAUDE.md rule 1), and this suite
 * mocks the four of them rather than `supabaseServer`. That is deliberate and
 * it is the half the sibling suite cannot cover:
 *
 *   · it can assert WHAT the call site asks for — the marker, the owner, the
 *     window — which a fake that answers every query the same way cannot
 *   · it can make a read FAIL, which is the condition the bug lived in and the
 *     one no table fake reaches
 *
 * The filter's absence is pinned where it belongs, on the repository, in
 * `ChannelAttributionRepository.findLeadsByVia.test.ts`. This suite pins that
 * the count arrives, is attributed to the right mailbox, and is never again
 * reported as a fact when the read did not happen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findByTag = jest.fn();
const findByUserAndPlugins = jest.fn();
const getLeadAutosendEnabled = jest.fn();
const findLeadsByVia = jest.fn();
const loggerWarnMock = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: { findByTag: (...args: unknown[]) => findByTag(...args) },
}));
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findByUserAndPlugins: (...args: unknown[]) => findByUserAndPlugins(...args),
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getLeadAutosendEnabled: (...args: unknown[]) => getLeadAutosendEnabled(...args),
  },
}));
jest.mock('@/lib/repositories/ChannelAttributionRepository', () => ({
  channelAttributionRepository: {
    findLeadsByVia: (...args: unknown[]) => findLeadsByVia(...args),
  },
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({
      info: jest.fn(),
      warn: (...args: unknown[]) => loggerWarnMock(...args),
      error: jest.fn(),
    }),
    info: jest.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: jest.fn(),
  }),
}));

import { inboxChannelStatus } from '../inboxChannel';
import { INBOX_CHANNEL_VIA } from '../captureEnquiry';
import { INBOX_CHANNEL_TAG } from '../inboxProviders';

const USER = 'owner-1';

/** One channel agent, as `findByTag` hands it over. */
function channelAgent(provider: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `agent-${provider}`,
    user_id: USER,
    agent_name: `Website enquiries from ${provider}`,
    status: 'active',
    last_run: '2026-10-30T17:55:07.000Z',
    tags: [INBOX_CHANNEL_TAG, `${INBOX_CHANNEL_TAG}:${provider}`],
    agent_config: { inbox_channel: { provider } },
    ...overrides,
  };
}

/** A filed lead, as the marker sits on the contact row. */
const lead = (provider?: string) => ({
  source_metadata: { via: INBOX_CHANNEL_VIA, ...(provider ? { provider } : {}) },
});

beforeEach(() => {
  jest.clearAllMocks();
  findByTag.mockResolvedValue({ data: [channelAgent('google-mail')], error: null });
  findByUserAndPlugins.mockResolvedValue({
    data: [{ plugin_name: 'google-mail', status: 'active' }],
    error: null,
  });
  getLeadAutosendEnabled.mockResolvedValue({ data: true, error: null });
  findLeadsByVia.mockResolvedValue({ data: [], error: null });
});

describe('the count reaches the surfaces', () => {
  it('reports the leads this mailbox brought in', async () => {
    /*
     * THE BUG, as one assertion. Three enquiries filed by the Gmail channel;
     * before the fix the query they were read with was rejected outright and
     * this was 0.
     */
    findLeadsByVia.mockResolvedValue({
      data: [lead('google-mail'), lead('google-mail'), lead('google-mail')],
      error: null,
    });

    const { channels } = await inboxChannelStatus(USER);

    expect(channels[0].leads).toBe(3);
  });

  it('asks for the mailbox marker, this owner, and the last thirty days', async () => {
    /*
     * The three arguments the count depends on. A wrong marker matches nothing
     * and reads as a channel that filed nothing; no window would report all
     * time as "the last thirty days"; no owner would be a cross-tenant read.
     */
    await inboxChannelStatus(USER);

    expect(findLeadsByVia).toHaveBeenCalledTimes(1);
    const [userId, since, via] = findLeadsByVia.mock.calls[0];

    expect(userId).toBe(USER);
    expect(via).toBe(INBOX_CHANNEL_VIA);

    const days = (Date.now() - Date.parse(since as string)) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('counts each mailbox separately rather than sharing one total', async () => {
    /*
     * Two addresses are two independent sources of leads, and the card shows a
     * number per row. A single total put on both would tell an owner their
     * quiet mailbox is as busy as their busy one.
     */
    findByTag.mockResolvedValue({
      data: [channelAgent('google-mail'), channelAgent('outlook')],
      error: null,
    });
    findByUserAndPlugins.mockResolvedValue({
      data: [
        { plugin_name: 'google-mail', status: 'active' },
        { plugin_name: 'outlook', status: 'active' },
      ],
      error: null,
    });
    findLeadsByVia.mockResolvedValue({
      data: [lead('google-mail'), lead('google-mail'), lead('outlook')],
      error: null,
    });

    const { channels } = await inboxChannelStatus(USER);

    expect(channels.map(c => [c.provider, c.leads])).toEqual([
      ['google-mail', 2],
      ['outlook', 1],
    ]);
  });

  it('gives a lead with no provider recorded to the only channel that could have filed it', async () => {
    /* Leads filed before the provider was written into the marker. One
       channel, so there is no ambiguity about whose they are. */
    findLeadsByVia.mockResolvedValue({ data: [lead(), lead('google-mail')], error: null });

    const { channels } = await inboxChannelStatus(USER);

    expect(channels[0].leads).toBe(2);
  });

  it('does not hand an unattributed lead to a second mailbox as well', async () => {
    /*
     * With two channels an unmarked lead cannot be placed, so it is counted
     * once — on the first — and never duplicated. Counting it on both would
     * make the rows add up to more leads than the business received.
     */
    findByTag.mockResolvedValue({
      data: [channelAgent('google-mail'), channelAgent('outlook')],
      error: null,
    });
    findByUserAndPlugins.mockResolvedValue({
      data: [
        { plugin_name: 'google-mail', status: 'active' },
        { plugin_name: 'outlook', status: 'active' },
      ],
      error: null,
    });
    findLeadsByVia.mockResolvedValue({ data: [lead()], error: null });

    const { channels } = await inboxChannelStatus(USER);

    expect(channels.map(c => c.leads)).toEqual([1, 0]);
  });

  it('reports a genuinely quiet mailbox as zero', async () => {
    /* Zero is a real answer and has to stay one — which is precisely why the
       rejected query hid for a month. */
    const { channels } = await inboxChannelStatus(USER);

    expect(channels[0].leads).toBe(0);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});

describe('a read that did not happen is not reported as a fact', () => {
  it('says so in the log when the lead count could not be read', async () => {
    /*
     * THE OTHER HALF OF THE BUG. The error was discarded, so a rejected query
     * and an empty mailbox produced the same answer with nothing anywhere to
     * tell them apart. The count still reads 0 — this function must not throw,
     * four surfaces render over it — so the log is the only signal there is.
     */
    findLeadsByVia.mockResolvedValue({ data: null, error: new Error('42703') });

    const { channels } = await inboxChannelStatus(USER);

    expect(channels[0].leads).toBe(0);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(String(loggerWarnMock.mock.calls[0][1])).toContain('lead counts');
    expect(loggerWarnMock.mock.calls[0][0]).toMatchObject({ userId: USER });
  });

  it('says so when the channels themselves could not be read', async () => {
    /*
     * An account with no channels and an account we could not ask both render
     * the setup invitation. Without the log, a broken read looks like an owner
     * who has not started.
     */
    findByTag.mockResolvedValue({ data: null, error: new Error('boom') });

    const status = await inboxChannelStatus(USER);

    expect(status.channels).toEqual([]);
    expect(status.state).toBe('not_connected');
    expect(String(loggerWarnMock.mock.calls[0][1])).toContain('channel agents');
  });

  it('does not invent a replies-off warning out of an unreadable setting', async () => {
    /*
     * `replies_off` tells an owner their clients are going unanswered. Raised
     * from a failed read it would send them to change a setting that is
     * already correct.
     */
    getLeadAutosendEnabled.mockResolvedValue({ data: null, error: new Error('boom') });

    const { problems } = await inboxChannelStatus(USER);

    expect(problems).not.toContain('replies_off');
    expect(String(loggerWarnMock.mock.calls[0][1])).toContain('auto-reply');
  });

  it('still warns when the owner really did switch replies off', async () => {
    getLeadAutosendEnabled.mockResolvedValue({ data: false, error: null });

    const { problems } = await inboxChannelStatus(USER);

    expect(problems).toContain('replies_off');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});
