/**
 * The work the platform will do for a business, once it has said yes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A REGISTRY AND NOT THREE BOOLEANS
 *
 * Each of these is the same bargain in a different costume: something is stuck,
 * the platform knows how to unstick it, and it will not do so until the owner
 * has agreed — once, in advance, for that kind of work. Writing that bargain
 * down once means the advisor can ASK for each of them in the same words, the
 * dispatcher can CHECK each of them in the same line, and adding the next one
 * is an entry rather than a fourth place to remember.
 *
 * EVERY ONE IS OFF UNTIL ASKED FOR
 *
 * Deliberately unlike the alert, which ships on. Being told something happened
 * is a courtesy the business is owed; writing to their client on their behalf
 * is an act performed in their name, and consent to that has to be given rather
 * than assumed. An owner who discovers the platform has been emailing their
 * clients is an owner who leaves.
 *
 * EACH ONE CLEARS A GAP
 *
 * `gapId` ties the automation to the thing it fixes, so the advisor can say how
 * many are waiting right now rather than describing the feature in the
 * abstract. "Chase 3 unpaid invoices" is a decision somebody can make; "enable
 * invoice chasing" is a setting they will skip.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/gaps/automations
 */

import type { GapId } from './types';

export type OperationalAutomationId = 'reply_to_enquiries' | 'chase_invoices' | 'chase_intake';

export interface OperationalAutomation {
  id: OperationalAutomationId;

  /**
   * The column on `business_profiles` that holds the answer.
   *
   * On the profile rather than `user_preferences`, which has no DDL anywhere in
   * this repo and would fail a migration on a fresh environment.
   */
  column: 'lead_autosend_enabled' | 'chase_invoices_enabled' | 'chase_intake_enabled';

  /** The gap this clears, so the advisor can count what is waiting. */
  gapId: GapId;

  /**
   * How long after the gap appears before the platform acts.
   *
   * Never zero. Every one of these writes to somebody's client, and a delay is
   * what gives the owner room to do it themselves first — or to stop it.
   */
  delayHours: number;

  /** The queue row kind that carries it out. */
  kind: 'invite' | 'chase';

  /** i18n keys. The copy lives with the other copy, not here. */
  labelKey: string;
  hintKey: string;
}

export const OPERATIONAL_AUTOMATIONS: OperationalAutomation[] = [
  {
    id: 'reply_to_enquiries',
    column: 'lead_autosend_enabled',
    gapId: 'enquiry_unanswered',
    // Fifteen minutes: long enough to intervene after reading the alert on a
    // phone, short enough that the person who wrote in still has this business
    // in mind when the reply lands.
    delayHours: 0.25,
    kind: 'invite',
    labelKey: 'automation.reply_to_enquiries',
    hintKey: 'automation.reply_to_enquiries_hint',
  },
  {
    id: 'chase_invoices',
    column: 'chase_invoices_enabled',
    gapId: 'invoice_unpaid',
    // Three days past due. Sooner reads as distrust of somebody who may simply
    // not have opened their email yet.
    delayHours: 72,
    kind: 'chase',
    labelKey: 'automation.chase_invoices',
    hintKey: 'automation.chase_invoices_hint',
  },
  {
    id: 'chase_intake',
    column: 'chase_intake_enabled',
    gapId: 'intake_outstanding',
    // A day. `IntakeReminderService` already sends one the day before the
    // appointment; this is the one for a form that has been ignored for longer
    // than that and still has time to be useful.
    delayHours: 24,
    kind: 'chase',
    labelKey: 'automation.chase_intake',
    hintKey: 'automation.chase_intake_hint',
  },
];

/** Look one up. Returns undefined for an id that is not in the registry. */
export function automationById(
  id: string
): OperationalAutomation | undefined {
  return OPERATIONAL_AUTOMATIONS.find(automation => automation.id === id);
}
