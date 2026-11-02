/**
 * A mail agent pointed at a mailbox the owner no longer has moves to the one
 * they do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "AN AGENT THAT WILL DO NOTHING IS AN ISSUE"
 *
 * Refusing to install the second provider variant (see `oneAgentTwoMailboxes`)
 * leaves one agent, and that was only half the problem. One agent pointed at
 * the wrong mailbox is just as useless as two: the owner installs the Gmail
 * variant, their Gmail connection later dies and the business moves to Outlook,
 * and a healthy-looking agent runs every morning against a mailbox it cannot
 * open. The dashboard's advice — "Cannot run · connect google-mail" — points
 * them back at the mailbox they deliberately left.
 *
 * Nothing else can fix it. The install seam fires once, and the available list
 * never offers an agent that is already installed, so there is no button
 * anywhere that re-points it. The dashboard read is the only thing that runs
 * when an owner's connections change, which is why the repair lives there.
 *
 * Nothing is asked, because there is nothing ambiguous: one mail plugin is
 * connected and one agent wants a mailbox.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findActiveByUser = jest.fn();
const findScheduled = jest.fn();
const update = jest.fn();
const updatePilotSteps = jest.fn();

jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findActiveByUser: (...a: unknown[]) => findActiveByUser(...a),
  },
}));

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findScheduled: (...a: unknown[]) => findScheduled(...a),
    update: (...a: unknown[]) => update(...a),
    updatePilotSteps: (...a: unknown[]) => updatePilotSteps(...a),
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
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { installedAutomations } from '../install';

const USER = 'owner-1';

/** An install of the GMAIL variant, which is what every case here starts from. */
const gmailInstall = (over: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  agent_name: 'Draft replies to client emails',
  status: 'active',
  schedule_cron: '0 9 * * *',
  plugins_required: ['business-os', 'google-mail'],
  agent_config: { business_os_automation: { id: 'draft_client_replies' } },
  ...over,
});

const listWith = async (agents: unknown[], pluginKeys: string[]) => {
  findScheduled.mockResolvedValue({ data: agents, error: null });
  findActiveByUser.mockResolvedValue({
    data: pluginKeys.map(plugin_key => ({ plugin_key })),
    error: null,
  });
  return installedAutomations(USER);
};

beforeEach(() => {
  findActiveByUser.mockReset();
  findScheduled.mockReset();
  update.mockReset().mockResolvedValue({ error: null });
  updatePilotSteps.mockReset().mockResolvedValue({ error: null });
});

describe('the owner moved to the other mailbox', () => {
  it('moves the plan, the grant and the tag together', async () => {
    /*
     * ALL THREE, or the repair is worse than the fault. The plan alone leaves
     * an agent calling Outlook actions on a Gmail grant, which fails inside a
     * cron where nobody is watching. The tag alone leaves the next read trying
     * to migrate it straight back.
     */
    await listWith([gmailInstall()], ['outlook']);

    expect(updatePilotSteps).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updatePilotSteps.mock.calls[0][2])).toContain('"plugin":"outlook"');

    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][2];

    expect(written.plugins_required).toEqual(['business-os', 'outlook']);
    expect(written.tags).toContain('business-os-automation:draft_client_replies_outlook');
    expect(written.agent_config.business_os_automation.id).toBe('draft_client_replies_outlook');
  });

  it('stops telling them to connect the mailbox they left', async () => {
    /*
     * THE MESSAGE THE REPAIR EXISTS TO END, and it would have survived the
     * repair itself: `missingPlugins` is computed from the grant as READ, which
     * the repoint has just replaced.
     */
    const [row] = await listWith([gmailInstall()], ['outlook']);

    expect(row.missingPlugins).toEqual([]);
    expect(row.blocked).toBe(false);
    expect(row.plugins).toEqual(['business-os', 'outlook']);
    expect(row.automationId).toBe('draft_client_replies_outlook');
  });
});

describe('what it leaves alone', () => {
  it('does nothing when the installed mailbox is the connected one', async () => {
    const [row] = await listWith([gmailInstall()], ['google-mail']);

    expect(updatePilotSteps).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(row.automationId).toBe('draft_client_replies');
    expect(row.blocked).toBe(false);
  });

  it('does nothing when NO mailbox is connected, and says so', async () => {
    /*
     * Genuinely blocked, not mispointed. There is nothing to move to, and
     * "connect a mailbox" is then exactly the right advice — so the existing
     * blocked state must survive untouched.
     */
    const [row] = await listWith([gmailInstall()], ['google-sheets']);

    expect(update).not.toHaveBeenCalled();
    expect(row.missingPlugins).toEqual(['google-mail']);
    expect(row.blocked).toBe(true);
  });

  it('does nothing when the connection read failed', async () => {
    /*
     * An empty set means "we could not tell", not "nothing is connected" — the
     * list fails open for exactly this reason. A migration decided from it
     * would re-point every variant agent on the account over a transient read.
     */
    findScheduled.mockResolvedValue({ data: [gmailInstall()], error: null });
    findActiveByUser.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const [row] = await installedAutomations(USER);

    expect(update).not.toHaveBeenCalled();
    expect(row.automationId).toBe('draft_client_replies');
    /* Fails open: nothing is reported missing, so nothing turns red. */
    expect(row.missingPlugins).toEqual([]);
  });

  it('leaves an agent that is not a provider variant entirely alone', async () => {
    /* Most agents have no variant group at all, and this must be invisible to
       them — including the ones that legitimately need a plugin. */
    const [row] = await listWith(
      [
        gmailInstall({
          plugins_required: ['business-os', 'google-sheets'],
          agent_config: { business_os_automation: { id: 'import_leads_from_sheet' } },
        }),
      ],
      ['outlook']
    );

    expect(update).not.toHaveBeenCalled();
    expect(row.automationId).toBe('import_leads_from_sheet');
    expect(row.missingPlugins).toEqual(['google-sheets']);
  });
});

describe('when the repair itself fails', () => {
  it('leaves the agent coherent rather than half-moved', async () => {
    /*
     * The one state worse than mispointed is mid-migration: a new grant over an
     * old plan, or the reverse. A failed plan write must not be followed by a
     * grant write — the agent stays exactly what it was and the next dashboard
     * load tries again.
     */
    updatePilotSteps.mockResolvedValue({ error: { message: 'no' } });

    const [row] = await listWith([gmailInstall()], ['outlook']);

    expect(update).not.toHaveBeenCalled();
    expect(row.automationId).toBe('draft_client_replies');
    /* Still honestly reported as unable to run, which it is. */
    expect(row.missingPlugins).toEqual(['google-mail']);
    expect(row.blocked).toBe(true);
  });
});
