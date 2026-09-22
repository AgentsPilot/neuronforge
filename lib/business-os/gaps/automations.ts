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

  /**
   * Which system actually does the work once the owner has said yes.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `lead_responses` — this registry's own queue, swept by
   *   `LeadResponseDispatchService`. The default, and what `delayHours` times.
   *
   * `payment_reminders` — `PaymentReminderService`, on its own schedule. The
   *   switch is still this one; the sending is not.
   *
   * WHY THE SECOND VALUE EXISTS
   *
   * Invoice chasing was built twice. This registry sent once at 72 hours past
   * due; `PaymentReminderService` had been sending on days 1, 3 and 7 past due
   * since long before, gated on a different column that nobody was ever asked
   * about. Day three fired both. They dedupe in different tables, so neither
   * could see the other, and the client got two emails from one business about
   * one invoice.
   *
   * Keeping the card and withdrawing the duplicate send was the choice: the
   * owner is asked once, in the advisor, and one system sends. The alternative
   * — deleting the card — would have left a chaser running that nobody had
   * agreed to, which is the state that caused this.
   *
   * `delayHours` is not used for these. The other system owns the timing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  carriedOutBy?: 'payment_reminders';

  /**
   * What must already be true of the business before this is worth offering.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Named here as a fact rather than resolved here as a query: this module is
   * pure data, imported by both the advisor and the dispatcher, and a
   * repository call in it would drag the database into every import of the
   * registry. `automationApplies` turns each name into an answer.
   *
   * WHY IT EXISTS
   *
   * The advisor offered all three to every business, and "Remind clients about
   * their form" was being put to businesses with no form. Two of the five
   * accounts in the database are in that state — one with only a draft form,
   * one with no intake settings and no form at all — so no form has ever
   * reached a client and none would if they said yes.
   *
   * That is worse than a useless card. It is a request for permission to do
   * something that cannot happen, and every one the owner says yes to and sees
   * nothing come of teaches them that saying yes here means nothing.
   *
   * `undefined` means it always applies — every business can receive an
   * enquiry, so nothing gates the reply.
   * ───────────────────────────────────────────────────────────────────────────
   */
  requires?: 'intake_reaches_client';

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
    /*
     * Unused, and left in place as the record of what this used to do.
     *
     * The send was withdrawn to `PaymentReminderService`, which chases on days
     * 1, 3 and 7 past due — `payment_overdue_reminder_days`, which the owner can
     * change. This 72-hour send landed on top of that schedule's day three.
     */
    delayHours: 72,
    kind: 'chase',
    carriedOutBy: 'payment_reminders',
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
    // Nothing to chase if no form reaches the client in the first place.
    requires: 'intake_reaches_client',
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
