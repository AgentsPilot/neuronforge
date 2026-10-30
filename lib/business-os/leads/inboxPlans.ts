/**
 * The committed plan each mailbox provider's agent runs, and its fingerprint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 *
 * Two callers need the same answer and neither can reach the other's module:
 *
 *   inboxChannelSetup   copies the plan onto the `agents` row at install
 *   the scheduler       refreshes that copy when the committed plan moves on
 *
 * The setup module is heavy — it reaches the plugin executor to sample a real
 * mailbox — so the scheduler cannot import it just to read a constant. And
 * `inboxProviders.ts`, the obvious home by subject, is deliberately
 * import-free: client components import it by value, and a JSON import there
 * would risk pulling server code into a browser bundle.
 *
 * So: the two plans and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FINGERPRINT
 *
 * The plan is COPIED onto each owner's agent row, because that is what the
 * runtime reads. A copy goes stale: the plans were just repointed from the
 * `crm` plugin to `business-os.capture_enquiry_contacts`, and without a way to
 * detect the drift every already-installed channel would have kept calling the
 * old door for ever.
 *
 * The automation agents learned this the hard way — all six carried a broken
 * variable token that a fix to the committed file could not reach. Same
 * mechanism, same reason: fingerprint the plan itself rather than ask anybody
 * to remember a version number.
 *
 * @module lib/business-os/leads/inboxPlans
 */

import GMAIL_PLAN from './agent/inboxEnquiryAgent.steps.json';
import OUTLOOK_PLAN from './agent/inboxEnquiryAgent.outlook.steps.json';
import type { InboxProvider } from './inboxProviders';

/** The committed plan per provider. One source for setup and the scheduler. */
export const INBOX_PLANS: Record<InboxProvider, unknown[]> = {
  'google-mail': GMAIL_PLAN as unknown[],
  outlook: OUTLOOK_PLAN as unknown[],
};

/**
 * Which plugins a provider's agent must be granted.
 *
 * Its own mailbox, and `business-os` for filing the lead — the channel into
 * the business's data, which carries tenant scoping on `connection.user_id`.
 * This was `[provider, 'crm']`; the CRM plugin reached the same records by a
 * second door.
 */
export function inboxPluginsRequired(provider: InboxProvider): string[] {
  return [provider, 'business-os'];
}

/**
 * A short fingerprint of a plan, so a copy can be told from the current one.
 *
 * FNV-1a over the serialised steps. Not a security hash — this answers "did
 * these bytes change", and a 32-bit answer is plenty for two committed plans.
 * Deliberately the same function the automation catalogue uses, so the two
 * mechanisms cannot disagree about what "the plan moved" means.
 */
export function inboxPlanVersion(provider: InboxProvider): string {
  const json = JSON.stringify(INBOX_PLANS[provider]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
