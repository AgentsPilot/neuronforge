/**
 * The available list offers only the agents no insight card will ever offer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGRESSION THIS EXISTS FOR, FOUND ON A LIVE ACCOUNT
 *
 * The first version listed everything uninstalled. The dashboard then showed
 * FIVE agents with Activate buttons, and the owner's reaction was "why have we
 * added all of these" — because four were not new, and three of those were not
 * missing either. They were WAITING for their card.
 *
 * An agent with detectors behind it is designed to arrive at a moment, carrying
 * its reason: "four leads have gone cold, shall I follow them up?" Listing it
 * offers the same agent with no trigger and nothing to justify it. Same button,
 * much weaker offer — and it pre-empts the card for good, because an agent
 * switched on from a list never gets the card that would have explained it.
 *
 * `offeredFromInsight: false` already marks the agents with no such moment: no
 * detector reports their work, so nothing will ever mention them, and before
 * this list they were shipped and unreachable. A list is for exactly those.
 *
 * Two live examples, and keeping them apart is the whole rule:
 *
 *   follow_up_new_enquiries   has `crm_cold_leads`. Not listed. It is not
 *                             missing, it is waiting.
 *   follow_up_stalled_deals   has nothing. Listed, because no card exists for
 *                             it and a list is its only route.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findScheduled = jest.fn().mockResolvedValue({ data: [], error: null });
const findActiveByUser = jest.fn().mockResolvedValue({ data: [], error: null });

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: { findScheduled: (...a: unknown[]) => findScheduled(...a) },
}));

jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: { findActiveByUser: (...a: unknown[]) => findActiveByUser(...a) },
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

import { availableAutomations } from '../install';
import { AUTOMATION_AGENTS } from '../catalog';

const USER = 'owner-1';

describe('what the available list offers', () => {
  it('offers every agent no card will ever offer, and nothing else', async () => {
    const offered = (await availableAutomations(USER)).map(a => a.automationId).sort();

    /*
     * MINUS THE PROVIDER VARIANTS THAT ARE NOT THE ONE ON OFFER.
     *
     * Some agents are the same job through a different mailbox, and the
     * catalogue holds each separately because `pluginsRequired` is what grants
     * a run — one entry naming both mail plugins would make an owner connect
     * BOTH to run either. The OFFER still holds one, because two rows carrying
     * the same name and the same button is a puzzle rather than a choice.
     *
     * So the rule gains one clause and keeps its shape: every agent no card
     * will offer, counting a group of variants once. No connection is mocked
     * here, so the one on offer is the group's declared default.
     */
    const neverFromACard = AUTOMATION_AGENTS
      .filter(a => a.offeredFromInsight === false)
      .filter(a => !a.variantGroup || a.variantDefault === true)
      .map(a => a.id)
      .sort();

    expect(offered).toEqual(neverFromACard);
  });

  it('is not vacuous about variants either: a group exists, with a default', () => {
    /*
     * A guard on the clause above. With no variant in the catalogue the extra
     * filter is a no-op, and a group whose default was dropped would silently
     * remove the whole group from the list — an agent shipped and unreachable,
     * which is the exact failure this file was written for.
     */
    const grouped = AUTOMATION_AGENTS.filter(a => a.variantGroup);
    expect(grouped.length).toBeGreaterThan(1);

    const groups = new Set(grouped.map(a => a.variantGroup));
    for (const group of groups) {
      const members = grouped.filter(a => a.variantGroup === group);
      expect(`${group} has a default: ${members.filter(m => m.variantDefault).length}`).toBe(
        `${group} has a default: 1`
      );
      /* Every member names the mailbox it speaks to, or it can never be chosen. */
      for (const m of members) expect(typeof m.variantPlugin).toBe('string');
    }
  });

  it('follows the mailbox the owner actually connected', async () => {
    /*
     * THE POINT OF THE WHOLE MECHANISM. An owner on Outlook offered the Gmail
     * plan would connect Gmail to satisfy the dialog and then watch an agent
     * read an empty mailbox for ever, reporting nothing wrong.
     */
    findActiveByUser.mockResolvedValueOnce({
      data: [{ plugin_key: 'outlook' }],
      error: null,
    });

    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).toContain('draft_client_replies_outlook');
    expect(offered).not.toContain('draft_client_replies');
  });

  it('offers the default when neither mailbox is connected', async () => {
    /* How most owners first meet this agent. The install dialog then asks them
       to connect it, which is the existing behaviour for any agent with a
       plugin — so showing the default costs nothing and showing neither would
       hide the agent entirely. */
    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).toContain('draft_client_replies');
    expect(offered).not.toContain('draft_client_replies_outlook');
  });

  it('asks WHICH mailbox when the owner has connected neither', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * "WHERE IS THE OUTLOOK AGENT?"
     *
     * It was nowhere, and that was the bug. With no mailbox connected the row
     * fell back to the group's default and the install dialog then said
     * "connect Gmail" — so an owner who runs their business on Outlook was
     * being told to connect the wrong mailbox, with no way in the dialog to
     * say otherwise. They would have had to leave, find the plugins page, and
     * come back: exactly the two-visit flow the in-dialog repair ended.
     *
     * So the row stops asserting a mailbox and offers both. Connecting one is
     * the choice — `automationId` on the entry says which variant it means.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const row = (await availableAutomations(USER)).find(
      a => a.automationId === 'draft_client_replies'
    )!;

    expect(row.connectEither).toEqual([
      { plugin: 'google-mail', automationId: 'draft_client_replies', connected: false },
      { plugin: 'outlook', automationId: 'draft_client_replies_outlook', connected: false },
    ]);
  });

  it('still offers the choice when one mailbox IS connected', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE BUG THIS REPLACED, FOUND BY TRYING TO REACH THE OTHER PLAN.
     *
     * The first version returned nothing once any mailbox in the group was
     * connected, reasoning that the answer was already known. That made the
     * Outlook plan UNREACHABLE: an owner with Gmail connected got the Gmail
     * variant and no way to say their client mail goes through Outlook. The
     * only route was to disconnect Gmail, which nobody would guess and which
     * breaks whatever else used it.
     *
     * It showed up as "I deleted the Gmail agent and Outlook was not offered"
     * — the agent came back, still as Gmail, with no choice anywhere.
     *
     * The choice is offered; `connected` is what keeps it from being a
     * QUESTION. The connected one is pre-selected, so an owner who does not
     * care presses Activate and never thinks about it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    findActiveByUser.mockResolvedValueOnce({ data: [{ plugin_key: 'google-mail' }], error: null });

    const row = (await availableAutomations(USER)).find(
      a => a.automationId === 'draft_client_replies'
    )!;

    expect(row.missingPlugins).toEqual([]);
    expect(row.connectEither).toEqual([
      { plugin: 'google-mail', automationId: 'draft_client_replies', connected: true },
      { plugin: 'outlook', automationId: 'draft_client_replies_outlook', connected: false },
    ]);
  });

  it('marks the connected one whichever it is', async () => {
    findActiveByUser.mockResolvedValueOnce({ data: [{ plugin_key: 'outlook' }], error: null });

    const row = (await availableAutomations(USER)).find(
      a => a.automationId === 'draft_client_replies_outlook'
    )!;

    expect(row.missingPlugins).toEqual([]);
    expect(row.connectEither?.find(c => c.plugin === 'outlook')?.connected).toBe(true);
    expect(row.connectEither?.find(c => c.plugin === 'google-mail')?.connected).toBe(false);
  });

  it('never asks it of an agent with one provider', async () => {
    /* Almost every agent. The spreadsheet importer needs Sheets and nothing
       else will do, so there is no either-or to offer and the plain
       "connect this" path must be untouched. */
    const row = (await availableAutomations(USER)).find(
      a => a.automationId === 'import_leads_from_sheet'
    )!;

    expect(row.connectEither).toBeUndefined();
    expect(row.missingPlugins).toEqual(['google-sheets']);
  });

  it('takes the whole group off the list once either one is running', async () => {
    /*
     * The regression this clause is really for. Running the Gmail agent and
     * later connecting Outlook would otherwise offer the twin, and an owner who
     * accepted it would have two agents reading two mailboxes and drafting into
     * both — nobody asked for that, and nothing would explain it.
     */
    findScheduled.mockResolvedValueOnce({
      data: [{ id: 'a1', agent_config: { business_os_automation: { id: 'draft_client_replies' } } }],
      error: null,
    });
    findActiveByUser.mockResolvedValueOnce({
      data: [{ plugin_key: 'outlook' }],
      error: null,
    });

    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).not.toContain('draft_client_replies');
    expect(offered).not.toContain('draft_client_replies_outlook');
    /* Still a working list, not an empty one. */
    expect(offered).toContain('follow_up_stalled_deals');
  });

  it('is not vacuous: the catalogue holds agents of BOTH kinds', async () => {
    /* A guard on the guard. If every entry were one kind, the assertion above
       would pass while testing nothing. */
    const never = AUTOMATION_AGENTS.filter(a => a.offeredFromInsight === false);
    const carded = AUTOMATION_AGENTS.filter(a => a.offeredFromInsight !== false);

    expect(never.length).toBeGreaterThan(0);
    expect(carded.length).toBeGreaterThan(0);
  });

  it('leaves an agent with detectors to its card', async () => {
    /* It is not missing from the list, it is waiting for a moment that carries
       its reason. Named rather than left to the set comparison, because this is
       the one somebody will be tempted to add back. */
    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).not.toContain('follow_up_new_enquiries');
    expect(offered).not.toContain('recover_abandoned_checkouts');
    expect(offered).not.toContain('win_back_quiet_clients');
  });

  it('offers the agents that have no other route at all', async () => {
    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).toContain('follow_up_stalled_deals');
    expect(offered).toContain('draft_client_replies');
  });

  it('says what an agent works alongside, so it is not mistaken for it', async () => {
    /*
     * The row for the quote agent is word for word the `chase_quotes` toggle an
     * owner may already be running, and that is what prompted "are these the
     * same?". They are not: the toggle fires once at 72 hours and stops, this
     * starts at day 7. The relationship was in `worksAlongside` all along and
     * visible nowhere.
     */
    const quotes = (await availableAutomations(USER)).find(
      a => a.automationId === 'follow_up_stalled_deals'
    )!;

    expect(quotes.worksAlongside).toBeTruthy();
    /* Resolved to words, never left as the raw id a surface cannot show. */
    expect(quotes.worksAlongside).not.toBe('chase_quotes');
  });

  it('leaves it null for an agent that stands alone', async () => {
    const drafts = (await availableAutomations(USER)).find(
      a => a.automationId === 'draft_client_replies'
    )!;

    expect(drafts.worksAlongside).toBeNull();
  });

  it('still drops anything already installed', async () => {
    findScheduled.mockResolvedValueOnce({
      data: [{ id: 'a1', agent_config: { business_os_automation: { id: 'draft_client_replies' } } }],
      error: null,
    });

    const offered = (await availableAutomations(USER)).map(a => a.automationId);

    expect(offered).not.toContain('draft_client_replies');
    expect(offered).toContain('follow_up_stalled_deals');
  });
});
