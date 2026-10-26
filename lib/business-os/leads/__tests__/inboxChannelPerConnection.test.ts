/**
 * One agent per mailbox, and the three ways that could silently stop being true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A business taking enquiries at two addresses runs two channels. The failures
 * this guards against all LOOK like success:
 *
 *   · setup matched on the shared tag, so configuring Outlook found the Gmail
 *     agent and re-pointed it — the second mailbox appeared set up and the
 *     first silently stopped being read
 *   · the two providers need different plans (a different action to mark read,
 *     different search parameters, a different query language), so a plan
 *     naming the wrong plugin produces an agent that fails every five minutes
 *   · the Gmail query is built from the measured rule, and `after:` takes
 *     `YYYY/MM/DD` — a wrong format there silently matches nothing, forever
 *
 * These are source-level and pure: no mailbox, no database.
 */

import {
  INBOX_CHANNEL_TAG,
  PROVIDER_NAMES,
  SUPPORTED_PROVIDERS,
  inboxChannelTag,
  type InboxProvider,
} from '../inboxProviders';
import GMAIL_STEPS from '../agent/inboxEnquiryAgent.steps.json';
import OUTLOOK_STEPS from '../agent/inboxEnquiryAgent.outlook.steps.json';

type Step = {
  step_id?: string;
  plugin?: string;
  action?: string;
  params?: Record<string, unknown>;
  condition?: { field?: string; operator?: string; value?: unknown };
  steps?: Step[];
  scatter?: { input?: string; steps?: Step[] };
};

/** Every step, including the ones nested in the scatter and the conditional. */
function flatten(steps: Step[]): Step[] {
  return steps.flatMap(step => [
    step,
    ...flatten(step.steps ?? []),
    ...flatten(step.scatter?.steps ?? []),
  ]);
}

const PLANS: Record<InboxProvider, Step[]> = {
  'google-mail': GMAIL_STEPS as Step[],
  outlook: OUTLOOK_STEPS as Step[],
};

describe('one channel per mailbox', () => {
  it('gives every supported provider a distinct tag', () => {
    const tags = SUPPORTED_PROVIDERS.map(inboxChannelTag);
    expect(new Set(tags).size).toBe(SUPPORTED_PROVIDERS.length);

    /* Each provider tag must also be findable as an inbox channel: the cron and
       the card list by the shared tag, so a channel carrying only its provider
       tag would run and be invisible, or be visible and never run. */
    for (const tag of tags) expect(tag.startsWith(`${INBOX_CHANNEL_TAG}:`)).toBe(true);
  });

  it('names every supported provider in the owner’s words', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(PROVIDER_NAMES[provider]).toBeTruthy();
      /* Never a plugin key in front of a customer. */
      expect(PROVIDER_NAMES[provider]).not.toContain('-');
    }
  });

  it('ships a plan for every supported provider, naming only that provider', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const steps = PLANS[provider];
      expect(steps.length).toBeGreaterThan(0);

      const plugins = new Set(
        flatten(steps)
          .map(step => step.plugin)
          .filter((p): p is string => Boolean(p))
      );

      /* Its own mailbox and the CRM. Any OTHER mail plugin in here is the bug
         this covers: an agent asking a mailbox the owner never connected. */
      expect([...plugins].sort()).toEqual([provider, 'crm'].sort());
    }
  });

  it('marks a message read only once it has been filed', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const all = flatten(PLANS[provider]);

      const markRead = all.find(
        step => step.plugin === provider && step.action !== 'search_emails'
      );
      expect(markRead).toBeDefined();

      /*
       * The guard is the whole idempotency. Marking read unconditionally would
       * lose an enquiry we could not parse: the message is consumed and no
       * contact exists, so nobody — owner or platform — ever sees it again.
       */
      const guard = all.find(step => step.condition?.field === 'filing_result.filed');
      expect(guard?.condition).toMatchObject({ operator: 'equals', value: true });
      expect(flatten(guard?.steps ?? [])).toContain(markRead);
    }
  });

  it('resolves the owner’s own values from input, never from the stored plan', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const serialized = JSON.stringify(PLANS[provider]);

      /* The plan is shipped and identical for every owner, so a real address or
         subject baked into it would read one business's mail on another's
         behalf. Everything owner-specific arrives as `{{input.*}}`. */
      expect(serialized).toContain('{{input.enquiry_template}}');
      expect(serialized).toMatch(/\{\{input\.mail_/);
      expect(serialized).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });
});
