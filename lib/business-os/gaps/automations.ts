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
// Type-only: erased at build, so the registry stays free of the repository and
// everything the repository imports.
import type { LeadResponseKind } from '@/lib/repositories/LeadResponseRepository';

export type OperationalAutomationId =
  | 'reply_to_enquiries'
  | 'chase_invoices'
  | 'chase_intake'
  | 'remind_about_meeting'
  | 'auto_complete_meetings'
  | 'chase_quotes';

export interface OperationalAutomation {
  id: OperationalAutomationId;

  /**
   * The column on `business_profiles` that holds the answer.
   *
   * On the profile rather than `user_preferences`, which has no DDL anywhere in
   * this repo and would fail a migration on a fresh environment.
   */
  column:
    | 'lead_autosend_enabled'
    | 'chase_invoices_enabled'
    | 'chase_intake_enabled'
    | 'meeting_reminder_enabled'
    | 'auto_complete_meetings_enabled'
    | 'chase_quotes_enabled';

  /** The gap this clears, so the advisor can count what is waiting. */
  gapId: GapId;

  /**
   * How long after the gap appears before the platform acts.
   *
   * Every one of these writes to somebody, and a delay is what gives the owner
   * room to do it themselves first — or to stop it.
   *
   * ZERO ONLY WHERE THE GAP ITSELF ALREADY WAITED. `chase_quotes` is the one
   * case: `quote_awaiting_client` has `staleAfterHours: 72`, so by the time it
   * reports anything the owner has had three days. A delay on top would make
   * the follow-up land on day six, and nothing on the card would say so. The
   * grace period is still three days; it is simply held in the gap rather than
   * here.
   *
   * Ignored when `timing` is `before_event`, where the schedule runs from the
   * appointment rather than from us noticing something.
   */
  delayHours: number;

  /**
   * Which direction the clock runs.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `after_gap` — the default, and how the first three work. Something is
   *   stuck, and we wait `delayHours` from the moment it got stuck before
   *   acting. The delay exists to give the owner first refusal.
   *
   * `before_event` — the reminder case. The work is due a chosen number of
   *   hours BEFORE something happens, so the only date that can schedule it is
   *   the event's own (`GapItem.eventAt`), and the number of hours is the
   *   owner's rather than ours.
   *
   * These are genuinely different clocks, not a sign flip: one is "wait, then
   * act", the other is "be ready by". Writing the second as a negative
   * `delayHours` would have worked and been unreadable — and would have left
   * `dueAt` in the past for every appointment already inside its window, which
   * is the state that matters most.
   * ───────────────────────────────────────────────────────────────────────────
   */
  timing?: 'after_gap' | 'before_event';

  /**
   * The `business_profiles` column holding the owner's chosen lead time, in
   * hours. Only meaningful with `before_event`.
   */
  leadHoursColumn?: 'meeting_reminder_hours_before';

  /**
   * The queue row kinds this one permission covers.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The dispatcher asks "which automation did the owner approve for this row?"
   * and this array is the answer. It replaced a `kind` field that named a
   * DIFFERENT vocabulary — `chase_invoices` was `kind: 'chase'`, while a queue
   * row of kind `'chase'` is the lead follow-up and belongs to
   * `reply_to_enquiries`. The dispatcher kept a second map to get the real
   * answer and a special case to get round the collision, so the same fact was
   * written twice in two languages, and one of them was wrong.
   *
   * `reply_to_enquiries` covers two: the first reply and the follow-up are one
   * conversation and one decision.
   * ───────────────────────────────────────────────────────────────────────────
   */
  covers: LeadResponseKind[];

  /**
   * What the five-minute sweep queues for this automation.
   *
   * Absent where the sweep is not what queues it: the lead invite is written by
   * the alert path at the moment the owner is told, so it has its own clock and
   * the sweep skips it.
   */
  sweepQueues?: LeadResponseKind;

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
  requires?: 'intake_reaches_client' | 'takes_bookings' | 'sends_quotes';

  /**
   * Not offered until the owner has shown they already do this work by hand.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `requires` asks whether the machinery exists. This asks something harder
   * and more useful: whether this is a habit the owner would recognise as
   * theirs. The two are independent — a business can take bookings (so the
   * machinery is there) and never once have marked a meeting complete.
   *
   * WHY ANY AUTOMATION NEEDS THIS
   *
   * A standing switch can be found cold, by somebody who has never used the
   * feature, and switched on over a history the platform knows nothing about.
   * `auto_complete_meetings` is the sharp case: saying yes to it sweeps up to
   * ninety days of past meetings and records every one as having happened,
   * including the no-shows nobody marked. An owner who has marked a dozen
   * meetings complete themselves is making a different, informed decision —
   * they have seen what the answer looks like and know which ones are wrong.
   *
   * So the offer is EARNED rather than listed, and the recommendation can be
   * phrased as what it is: "you have closed off twelve of these by hand this
   * month — want me to do it?"
   *
   * The count comes from the audit trail, which records the owner's OWN action
   * only. The automation's completions are never audited, so this can never
   * feed on its own output.
   * ───────────────────────────────────────────────────────────────────────────
   */
  offerOnEvidence?: {
    /** The audit action that proves the owner does this themselves. */
    action: string;
    /** How many, inside the window, before the offer is earned. */
    minCount: number;
    /** How far back to look. */
    windowDays: number;
  };

  /**
   * How late is too late to act on a piece of work at all.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Absent for the chasers, and deliberately: a chase is still worth sending a
   * week late, and the sweep's own comment says so.
   *
   * Present for the one automation that RECORDS rather than sends. Switching
   * `auto_complete_meetings` on used to sweep the ninety days its gap looks
   * back over and close every meeting in them — two hundred of them, every one
   * marked as having gone ahead, including the no-shows nobody marked. That is
   * not the automation catching up; it is answering a question about meetings
   * the owner was never asked about.
   *
   * It costs nothing in steady state: the work becomes due twelve hours after
   * a meeting and the sweep runs every five minutes, so what it sees is hours
   * old. The bound only ever excludes a backlog.
   * ───────────────────────────────────────────────────────────────────────────
   */
  actsWithinHours?: number;

  /**
   * A notification to the OWNER that travels with this automation on the card
   * but is NOT part of it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * DELIBERATELY NOT `column`, AND DELIBERATELY NOT AN AUTOMATION OF ITS OWN.
   *
   * `column` above is the owner's consent for the platform to write to their
   * CLIENT. This is the platform writing to the OWNER, which needs no consent
   * and ships ON — the distinction this module's header calls out.
   *
   * They share a card because they are two halves of what happens when somebody
   * gets in touch, and the card is the only screen an owner reliably meets. They
   * do NOT share a verb: the automation is approved or declined, while this is a
   * plain switch that saves the moment it moves and means something whether the
   * automation is running or not.
   *
   * So it is also NOT the meeting reminder's `notifyOwner`. There, owner and
   * client are two copies of one send, which is why at least one of them must
   * stay on. Here "do not write to them, do not write to me" is a state an owner
   * is entitled to, and nothing may forbid it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  ownerAlertColumn?: 'lead_alert_email_enabled';

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
    covers: ['invite', 'chase'],
    /*
     * "Tell me somebody is waiting", on the same card as "reply for me".
     *
     * It used to be a row in Settings, which an owner had no reason to open —
     * the switch that decides whether they hear about an enquiry at all was
     * filed two screens from the enquiry. This card always renders (no
     * `requires`, and zero waiting is still offered), so it is the one place
     * the pair can be met together.
     */
    ownerAlertColumn: 'lead_alert_email_enabled',
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
     * 1, 3 and 7 past due (`payment_overdue_reminder_days`). This 72-hour send
     * landed on top of that schedule's day three.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * THIS SWITCH IS HALF THE SCHEDULE, AND THE HINT NOW SAYS SO.
     *
     * `chase_invoices_enabled` governs the sends AFTER the due date only. The
     * ones before it — `payment_reminder_days_before`, defaulting to 3 and 1
     * days, plus a due-today reminder — are governed by
     * `payment_reminder_enabled`, which defaults to TRUE and has no UI
     * anywhere. One line in `PaymentReminderService` splits them:
     *
     *   reminderType === 'overdue' ? config.chaseOverdue : config.enabled
     *
     * So an owner turning this on reads "three reminders" and their client
     * receives up to six. On a live account on 2026-10-04, four chasers went
     * out in one morning and the owner had to ask why. Neither schedule is
     * editable from any screen: an earlier version of this comment said the
     * owner could change the days, and they cannot.
     *
     * The card's hint now states both halves and the total. The settings
     * channel the meeting reminder uses (`hours_before`, `notify_client`,
     * `notify_owner`, all editable on the card) is the obvious home for the day
     * lists too, and is not built yet.
     * ─────────────────────────────────────────────────────────────────────────
     */
    delayHours: 72,
    covers: ['invoice_chase'],
    sweepQueues: 'invoice_chase',
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
    covers: ['intake_chase'],
    sweepQueues: 'intake_chase',
    // Nothing to chase if no form reaches the client in the first place.
    requires: 'intake_reaches_client',
    labelKey: 'automation.chase_intake',
    hintKey: 'automation.chase_intake_hint',
  },
  {
    id: 'remind_about_meeting',
    column: 'meeting_reminder_enabled',
    gapId: 'meeting_upcoming',
    /*
     * Unused: `timing: 'before_event'` means the clock runs from the
     * appointment, and the number of hours is the owner's. Left at the default
     * lead time so the field is never undefined for a caller reading it
     * generically.
     */
    delayHours: 24,
    timing: 'before_event',
    leadHoursColumn: 'meeting_reminder_hours_before',
    covers: ['meeting_reminder'],
    sweepQueues: 'meeting_reminder',
    // A business that takes no bookings has no meetings to remind anyone
    // about. Same reasoning as the intake chase, different fact.
    requires: 'takes_bookings',
    labelKey: 'automation.remind_about_meeting',
    hintKey: 'automation.remind_about_meeting_hint',
  },
  {
    /*
     * The only automation here that sends nothing.
     *
     * Every other entry writes to somebody's CLIENT, which is why `delayHours`
     * is described as the owner's room to do it themselves first. This one
     * writes to the owner's own records: it marks a meeting that has already
     * happened as completed, which is a click they would otherwise make.
     *
     * Chosen as the fifth automation on evidence rather than instinct. A
     * coverage measurement across all six accounts found the platform able to
     * perform 0.4% of what owners do, and `SCHEDULING_BOOKING_COMPLETED` was
     * third by volume (52 across accounts) among the work nothing could take --
     * with no judgement in it and no message to get wrong.
     */
    id: 'auto_complete_meetings',
    column: 'auto_complete_meetings_enabled',
    gapId: 'meeting_unmarked',
    /*
     * Twelve hours after the meeting's start time, which is what the gap's own
     * `staleAfterHours` already uses. Long enough that a session running over,
     * or an owner who marks it themselves that evening, happens first.
     */
    delayHours: 12,
    covers: ['meeting_complete'],
    sweepQueues: 'meeting_complete',
    /*
     * Only a business that takes bookings has meetings to mark. The same guard
     * `remind_about_meeting` uses, and for the same reason: an invoicing
     * practice should never be shown this card at all.
     */
    requires: 'takes_bookings',
    /*
     * Earned, not listed — the only entry in the registry that is.
     *
     * Five in thirty days is a habit rather than a try: enough that the owner
     * recognises the work as theirs, low enough that a business with a handful
     * of meetings a week reaches it inside a month.
     *
     * It matters most here because this is the one automation that resolves a
     * judgement it cannot make. `completed` is one of three answers — the
     * others are no-show and cancelled — and it always picks the first. An
     * owner who has made that call by hand five times knows what they are
     * handing over; a stranger to the feature does not.
     */
    offerOnEvidence: {
      action: 'SCHEDULING_BOOKING_COMPLETED',
      minCount: 5,
      windowDays: 30,
    },
    /*
     * From here on, never the owner's past meetings.
     *
     * The work is due twelve hours after a meeting; forty-eight is two days of
     * slack for a cron that stalled or a deploy that paused the sweep, and
     * still far short of the ninety days the gap looks back over. The card goes
     * on offering every one of those ninety days to the owner by hand — what
     * this stops is the platform answering for them in bulk the moment the
     * switch moves. The hint on the card promises exactly this.
     */
    actsWithinHours: 48,
    labelKey: 'automation.auto_complete_meetings',
    hintKey: 'automation.auto_complete_meetings_hint',
  },
  {
    /*
     * The gap that had nothing behind it.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Of the four client-blocked gaps, three had a chaser and this one did not:
     * an unpaid invoice is chased on days 1/3/7, an outstanding intake form
     * after a day, an upcoming meeting before it happens. An unanswered quote
     * reached nobody. Its only reader was the briefing's `quotesOut`, which is
     * opt-in and had sent nothing in thirty days.
     *
     * That is the wrong one to have missed. An unpaid invoice is money already
     * earned; an unanswered quote is a sale still winnable, and it decays
     * fastest of anything in the registry.
     * ─────────────────────────────────────────────────────────────────────────
     */
    id: 'chase_quotes',
    column: 'chase_quotes_enabled',
    gapId: 'quote_awaiting_client',
    /*
     * ZERO, and this is the one number here that is easy to get wrong.
     *
     * Every other entry hangs off a gap that is stale immediately, so its
     * `delayHours` IS the grace period. This gap waits 72 hours of its own
     * (`staleAfterHours: 72`, measured from `sent_at`) before it reports
     * anything at all. Any delay on top would silently make the follow-up land
     * on day six, and nothing on the card would say so.
     */
    delayHours: 0,
    covers: ['quote_chase'],
    sweepQueues: 'quote_chase',
    /*
     * A business that has never sent a quote has nothing to follow up, and
     * offering it the switch is a request for permission to do something that
     * cannot happen. Same reasoning as the intake gate, different fact.
     */
    requires: 'sends_quotes',
    labelKey: 'automation.chase_quotes',
    hintKey: 'automation.chase_quotes_hint',
  },
];

/**
 * Should this automation be put in front of the owner at all?
 *
 * Pure, and separate from `automationApplies` because that one asks the
 * database and this one only weighs facts it is handed — so both call sites
 * can reach the same verdict without either re-deriving the rule.
 *
 * ALREADY ENABLED ALWAYS SHOWS. An automation the owner has switched on must
 * stay reachable to switch OFF; hiding it because the evidence window has
 * since gone quiet would trap them in a behaviour they agreed to once.
 */
export function offerIsEarned(
  automation: OperationalAutomation,
  facts: { enabled: boolean; evidence: number }
): boolean {
  if (!automation.offerOnEvidence) return true;
  if (facts.enabled) return true;
  return facts.evidence >= automation.offerOnEvidence.minCount;
}

/** Look one up. Returns undefined for an id that is not in the registry. */
export function automationById(
  id: string
): OperationalAutomation | undefined {
  return OPERATIONAL_AUTOMATIONS.find(automation => automation.id === id);
}
