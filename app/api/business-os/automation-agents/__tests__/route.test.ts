/**
 * The controls an owner has over an automation they installed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The reason this route exists is that the previous standing-automation path
 * had no off switch: a rule could be created from the advisor card and the copy
 * pointed at a screen that did not exist. So the cases that matter most here
 * are the ones that prove an owner can stop a thing — and that they cannot stop
 * somebody else's.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
const installAutomation = jest.fn();
const automationApplies = jest.fn();
const markAutomated = jest.fn();
const installedAutomations = jest.fn();
const pauseAutomation = jest.fn();
const resumeAutomation = jest.fn();
const removeAutomation = jest.fn();
const automationById = jest.fn();
const auditLog = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: auditLog }) },
}));

jest.mock('@/lib/business-os/automations/catalog', () => ({
  automationById: (id: string) => automationById(id),
}));

jest.mock('@/lib/business-os/insight/repository/InsightRepository', () => ({
  InsightRepository: class {
    markAutomated = (...args: unknown[]) => markAutomated(...args);
  },
}));

jest.mock('@/lib/business-os/gaps/automationApplies', () => ({
  automationApplies: (...args: unknown[]) => automationApplies(...args),
}));

jest.mock('@/lib/business-os/automations/install', () => ({
  installAutomation: (...args: unknown[]) => installAutomation(...args),
  installedAutomations: (...args: unknown[]) => installedAutomations(...args),
  pauseAutomation: (...args: unknown[]) => pauseAutomation(...args),
  resumeAutomation: (...args: unknown[]) => resumeAutomation(...args),
  removeAutomation: (...args: unknown[]) => removeAutomation(...args),
}));

import { DELETE, GET, PATCH, POST } from '../route';

const AGENT_ID = '11111111-2222-3333-4444-555555555555';

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/automation-agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const patch = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/automation-agents', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

const del = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/automation-agents', {
    method: 'DELETE',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ id: 'user-1' });
  automationById.mockReturnValue({ id: 'chase_overdue_invoices' });
  installAutomation.mockResolvedValue({ ok: true, agentId: AGENT_ID, alreadyInstalled: false });
  installedAutomations.mockResolvedValue([]);
  pauseAutomation.mockResolvedValue(true);
  resumeAutomation.mockResolvedValue(true);
  removeAutomation.mockResolvedValue(true);
  /* Applies, unless a test says otherwise: the requirement is a separate
     question from everything else this route does. */
  automationApplies.mockResolvedValue(true);
  markAutomated.mockResolvedValue({ data: {}, error: null });
});

describe('listing what is installed', () => {
  it('answers with this business"s automations', async () => {
    installedAutomations.mockResolvedValue([
      { agentId: AGENT_ID, automationId: 'chase_overdue_invoices', status: 'active' },
    ]);

    const response = await GET(new NextRequest('http://localhost/x'));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect(installedAutomations).toHaveBeenCalledWith('user-1');
  });

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue(null);

    expect((await GET(new NextRequest('http://localhost/x'))).status).toBe(401);
  });
});

describe('installing one', () => {
  it('installs it and records the decision', async () => {
    const response = await POST(post({ automationId: 'chase_overdue_invoices' }));

    expect(response.status).toBe(200);
    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      { id: 'chase_overdue_invoices' },
      undefined,
      undefined,
      undefined
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTOMATION_AGENT_INSTALLED', userId: 'user-1' })
    );
  });

  it('takes the plan from the catalogue, never from the caller', async () => {
    /*
     * The request names WHICH automation and nothing else. A caller able to
     * supply steps could make the platform send anything to anyone.
     */
    await POST(post({ automationId: 'chase_overdue_invoices', steps: [{ plugin: 'evil' }] }));

    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      { id: 'chase_overdue_invoices' },
      undefined,
      undefined,
      undefined
    );
  });

  it('does not record a second decision for an automation already installed', async () => {
    /* Pressing an installed one again is not a new choice. */
    installAutomation.mockResolvedValue({ ok: true, agentId: AGENT_ID, alreadyInstalled: true });

    const response = await POST(post({ automationId: 'chase_overdue_invoices' }));

    expect(response.status).toBe(200);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('passes the cadence the owner chose', async () => {
    /* How often the platform writes to their clients in their name is their
       decision, made before it is switched on. */
    await POST(post({ automationId: 'chase_overdue_invoices', cadence: 'weekly' }));

    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      { id: 'chase_overdue_invoices' },
      'weekly',
      undefined,
      undefined
    );
  });

  it('passes the owner\'s stop rule through', async () => {
    /*
     * The second choice on the install dialog. Validated here only as a
     * positive number of days; whether this automation OFFERS that bound is
     * `installAutomation`'s business, because the list lives on the catalogue
     * entry it already holds.
     */
    await POST(post({ automationId: 'chase_overdue_invoices', stopAfterDays: 90 }));

    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      { id: 'chase_overdue_invoices' },
      undefined,
      90,
      undefined
    );
  });

  it('passes the interval the owner set', async () => {
    /*
     * The one control both dialogs now use. `cadence` could say only one of
     * five words, each meaning a number of days at 09:00, so "every ten days"
     * and "every four hours" were unaskable.
     */
    await POST(
      post({ automationId: 'chase_overdue_invoices', schedule: { every: 10, unit: 'days' } })
    );

    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      { id: 'chase_overdue_invoices' },
      undefined,
      undefined,
      { every: 10, unit: 'days' }
    );
  });

  it('refuses an interval in a unit that is not one of the three', async () => {
    /* Still not a cron string, and still not a free-text duration: a field that
       could say `* * * * *` is a mailshot one keystroke away. */
    const response = await POST(
      post({ automationId: 'chase_overdue_invoices', schedule: { every: 1, unit: 'seconds' } })
    );

    expect(response.status).toBe(400);
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('refuses an interval of zero', async () => {
    const response = await POST(
      post({ automationId: 'chase_overdue_invoices', schedule: { every: 0, unit: 'days' } })
    );

    expect(response.status).toBe(400);
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('leaves the per-automation floor to installAutomation, not to Zod', async () => {
    /*
     * A one-minute interval is a SANE number and an unacceptable cadence, and
     * only the catalogue knows which: `win_back_quiet_clients` writes to people
     * quiet for a year. So the route accepts it and the installer clamps it to
     * the automation's own range — the alternative is a copy of every
     * automation's floor living in this schema.
     */
    await POST(
      post({ automationId: 'chase_overdue_invoices', schedule: { every: 1, unit: 'minutes' } })
    );

    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      undefined,
      undefined,
      { every: 1, unit: 'minutes' }
    );
  });

  it('refuses a stop rule that is not a sane number of days', async () => {
    /* Zero would mean "give up before you start"; three years is somebody
       pasting a timestamp into the field. */
    for (const stopAfterDays of [0, -30, 5000]) {
      const response = await POST(post({ automationId: 'chase_overdue_invoices', stopAfterDays }));
      expect(`${stopAfterDays}: ${response.status}`).toBe(`${stopAfterDays}: 400`);
    }
  });

  it('refuses a cadence that is not on the list', async () => {
    /* No free cron field: `* * * * *` from a text box is a mailshot, and the
       install could not tell it from a deliberate choice. */
    expect((await POST(post({ automationId: 'chase_overdue_invoices', cadence: 'hourly' }))).status).toBe(400);
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('closes the card that offered it', async () => {
    /*
     * The press has to end the question. Without this the agent installed and
     * the insight stayed `new`, so the next page load showed the same card
     * offering an agent already running — and the owner's only way out was to
     * dismiss it, which records "this did not matter" against something that
     * did.
     */
    const INSIGHT = '99999999-8888-7777-6666-555555555555';

    const response = await POST(post({ automationId: 'chase_overdue_invoices', insightId: INSIGHT }));

    expect(response.status).toBe(200);
    expect(markAutomated).toHaveBeenCalledWith(INSIGHT, 'user-1');
  });

  it('installs just as happily when no card offered it', async () => {
    /* An install from a management screen answers no insight, and must not
       need one. */
    const response = await POST(post({ automationId: 'chase_overdue_invoices' }));

    expect(response.status).toBe(200);
    expect(markAutomated).not.toHaveBeenCalled();
  });

  it('still reports success when the insight cannot be closed', async () => {
    /*
     * The agent exists and is running by this point. Answering "could not
     * install" for something that installed would have the owner press again,
     * and the worst version of that is an owner who believes nothing is
     * running while it is.
     */
    markAutomated.mockResolvedValue({ data: null, error: new Error('gone') });

    const response = await POST(post({
      automationId: 'chase_overdue_invoices',
      insightId: '99999999-8888-7777-6666-555555555555',
    }));

    expect(response.status).toBe(200);
    expect(installAutomation).toHaveBeenCalled();
  });

  it('accepts monthly, which one agent offers and nothing else does', async () => {
    /*
     * `win_back_quiet_clients` defaults to monthly and offers only monthly and
     * fortnightly. The schema's enum did not have it, so the one cadence that
     * agent is meant to run at was a 400.
     */
    const response = await POST(post({ automationId: 'win_back_quiet_clients', cadence: 'monthly' }));

    expect(response.status).toBe(200);
    expect(installAutomation).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      'monthly',
      undefined,
      undefined
    );
  });

  it('refuses one this business cannot use yet, and installs nothing', async () => {
    /*
     * The check that stopped `requires` being decoration. Four agents declare
     * it and nothing read it, so an owner could install an automation whose
     * every send is refused at the transport — the invite-based ones, while
     * `MARKETING_SENDING_ENABLED` is false, which is today.
     *
     * 409 and not 403: the caller and the request are both fine. The business
     * is not in a state where this can work.
     */
    automationById.mockReturnValue({ id: 'win_back_quiet_clients', requires: 'can_send_marketing' });
    automationApplies.mockResolvedValue(false);

    const response = await POST(post({ automationId: 'win_back_quiet_clients' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('requirement_unmet');
    /* Named, so the card can say WHICH state rather than "something is wrong". */
    expect(body.requires).toBe('can_send_marketing');
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('installs the same one once the business can use it', async () => {
    /* The other half: the gate must open, or it is a permanent refusal wearing
       a condition. */
    automationById.mockReturnValue({ id: 'win_back_quiet_clients', requires: 'can_send_marketing' });
    automationApplies.mockResolvedValue(true);

    const response = await POST(post({ automationId: 'win_back_quiet_clients' }));

    expect(response.status).toBe(200);
    expect(installAutomation).toHaveBeenCalled();
  });

  it('says so when we ship no such automation', async () => {
    automationById.mockReturnValue(undefined);

    const response = await POST(post({ automationId: 'not_a_thing' }));

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('unknown_automation');
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue(null);

    expect((await POST(post({ automationId: 'chase_overdue_invoices' }))).status).toBe(401);
    expect(installAutomation).not.toHaveBeenCalled();
  });

  it('refuses a body that names nothing', async () => {
    expect((await POST(post({}))).status).toBe(400);
  });
});

describe('pausing and resuming', () => {
  it('pauses', async () => {
    const response = await PATCH(patch({ agentId: AGENT_ID, action: 'pause' }));

    expect(response.status).toBe(200);
    expect(pauseAutomation).toHaveBeenCalledWith('user-1', AGENT_ID);
  });

  it('resumes', async () => {
    const response = await PATCH(patch({ agentId: AGENT_ID, action: 'resume' }));

    expect(response.status).toBe(200);
    expect(resumeAutomation).toHaveBeenCalledWith('user-1', AGENT_ID);
  });

  it('passes the caller"s own id, so another business"s agent is untouched', async () => {
    /* The repository filters on `user_id`, so an id from elsewhere updates no
       rows and reports a failure rather than acting. */
    await PATCH(patch({ agentId: AGENT_ID, action: 'pause' }));

    expect(pauseAutomation).toHaveBeenCalledWith('user-1', expect.any(String));
  });

  it('refuses an action it does not have', async () => {
    expect((await PATCH(patch({ agentId: AGENT_ID, action: 'delete_everything' }))).status).toBe(
      400
    );
    expect(pauseAutomation).not.toHaveBeenCalled();
  });

  it('refuses an agent id that is not one', async () => {
    expect((await PATCH(patch({ agentId: 'nope', action: 'pause' }))).status).toBe(400);
  });

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue(null);

    expect((await PATCH(patch({ agentId: AGENT_ID, action: 'pause' }))).status).toBe(401);
    expect(pauseAutomation).not.toHaveBeenCalled();
  });
});

describe('removing one', () => {
  it('removes it and records the decision', async () => {
    const response = await DELETE(del({ agentId: AGENT_ID }));

    expect(response.status).toBe(200);
    expect(removeAutomation).toHaveBeenCalledWith('user-1', AGENT_ID);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTOMATION_AGENT_REMOVED' })
    );
  });

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue(null);

    expect((await DELETE(del({ agentId: AGENT_ID }))).status).toBe(401);
    expect(removeAutomation).not.toHaveBeenCalled();
  });

  it('refuses a body with no agent', async () => {
    expect((await DELETE(del({}))).status).toBe(400);
  });
});
