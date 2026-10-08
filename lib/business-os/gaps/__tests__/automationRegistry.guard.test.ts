/**
 * The registry is the only place that says which consent covers which queued
 * message. These hold that claim honest.
 *
 * Before `covers` existed the same fact was written twice — a `kind` field here
 * and a `KIND_FOR` map in the dispatcher — in two vocabularies that collided on
 * the word "chase". A row could be queued under one automation and checked for
 * permission against another.
 */

import { OPERATIONAL_AUTOMATIONS, automationById } from '../automations';
import { GAP_DEFINITIONS } from '../definitions';

/**
 * Every kind the queue can hold.
 *
 * Repeated here rather than imported on purpose: the authority is the CHECK
 * constraint on `lead_responses.kind` (latest: `20261006d_auto_complete_meetings.sql`),
 * and the TypeScript union can be widened without the database agreeing. A kind
 * the column rejects is queued happily and skipped forever, so this list has to
 * be maintained against the MIGRATION, not against the union.
 */
const QUEUE_KINDS = [
  'invite',
  'chase',
  'invoice_chase',
  'intake_chase',
  'meeting_reminder',
  'meeting_complete',
];

describe('the automation registry', () => {
  it('gives every entry at least one queue kind to cover', () => {
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      expect(automation.covers.length).toBeGreaterThan(0);
    }
  });

  it('never lets two automations claim the same queue kind', () => {
    /*
     * The dispatcher takes the FIRST match. Two entries covering one kind would
     * make which permission is checked depend on array order — an owner could
     * switch an automation off and have it go on sending under another one's
     * consent.
     */
    const seen = new Map<string, string>();

    for (const automation of OPERATIONAL_AUTOMATIONS) {
      for (const kind of automation.covers) {
        expect(seen.has(kind)).toBe(false);
        seen.set(kind, automation.id);
      }
    }
  });

  it('only names kinds the queue can actually hold', () => {
    // A kind outside the column's CHECK is queued happily and skipped forever.
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      for (const kind of automation.covers) {
        expect(QUEUE_KINDS).toContain(kind);
      }
      if (automation.sweepQueues) {
        expect(QUEUE_KINDS).toContain(automation.sweepQueues);
      }
    }
  });

  it('only sweeps a kind its own consent covers', () => {
    // Otherwise the sweep writes rows the dispatcher cannot find a permission
    // for, and every one of them is skipped as `unknown_kind`.
    for (const automation of OPERATIONAL_AUTOMATIONS) {
      if (automation.sweepQueues) {
        expect(automation.covers).toContain(automation.sweepQueues);
      }
    }
  });

  it('points every entry at a gap that exists', () => {
    const known = new Set(GAP_DEFINITIONS.map(gap => gap.id));

    for (const automation of OPERATIONAL_AUTOMATIONS) {
      expect(known.has(automation.gapId)).toBe(true);
    }
  });

  it('never lets an owner alert share a column with a consent', () => {
    /*
     * `column` is the owner's permission for the platform to write to their
     * CLIENT; `ownerAlertColumn` is whether the platform writes to the OWNER.
     * One column serving both would make declining the automation switch off the
     * alert too — the two are asked with different verbs precisely because they
     * are different questions.
     */
    const consents = new Set(OPERATIONAL_AUTOMATIONS.map(a => a.column));

    for (const automation of OPERATIONAL_AUTOMATIONS) {
      if (!automation.ownerAlertColumn) continue;
      expect(automation.ownerAlertColumn).not.toBe(automation.column);
      expect(consents.has(automation.ownerAlertColumn as never)).toBe(false);
    }
  });
});

describe('the enquiry reply', () => {
  const reply = automationById('reply_to_enquiries')!;

  it('is registered', () => {
    expect(reply).toBeDefined();
  });

  it('carries the owner alert, so the card can offer both together', () => {
    expect(reply.ownerAlertColumn).toBe('lead_alert_email_enabled');
  });

  it('is offered to every business, which is what makes the card a safe home', () => {
    /*
     * The whole reason the alert switch moved out of Settings. An automation with
     * a `requires` can be absent for a given business, and a switch that lives
     * only on an absent card is unreachable — the trap the briefing card sets on
     * a cold-start account.
     */
    expect(reply.requires).toBeUndefined();
  });
});

describe('the meeting reminder', () => {
  const reminder = automationById('remind_about_meeting')!;

  it('is registered', () => {
    expect(reminder).toBeDefined();
  });

  it('runs on the backward clock, with a lead-time column', () => {
    expect(reminder.timing).toBe('before_event');
    expect(reminder.leadHoursColumn).toBe('meeting_reminder_hours_before');
  });

  it('is gated on the business taking bookings', () => {
    expect(reminder.requires).toBe('takes_bookings');
  });

  it('is swept, not written by an alert path', () => {
    expect(reminder.sweepQueues).toBe('meeting_reminder');
  });

  it('is not carried out by somebody else', () => {
    // `carriedOutBy` means another service does the sending and this entry is
    // consent only — true of the invoice chase, not of this one.
    expect(reminder.carriedOutBy).toBeUndefined();
  });
});

describe('the phase-waiting gap', () => {
  const gap = GAP_DEFINITIONS.find(g => g.id === 'stage_awaiting_completion');

  it('is registered, or nothing surfaces a phase at all', () => {
    expect(gap).toBeDefined();
  });

  it('blocks on the OWNER, which is what puts it on the Needs-you card', () => {
    /*
     * `findGaps` filters the card on exactly this. A phase waits on the owner to
     * say the work happened — the client cannot do it, and cannot be chased for
     * money nobody has billed.
     */
    expect(gap!.blocksOn).toBe('owner');
  });

  it('is stuck the moment it exists', () => {
    // There is nothing to wait for: no date will ever arrive to make it billable.
    expect(gap!.staleAfterHours).toBe(0);
  });

  it('navigates rather than sends', () => {
    /*
     * `bill_stage` has no entry in `NeedsYouCard`'s `endpointFor`, like
     * `write_quote`. Billing a phase asks the owner to judge that work is
     * finished, and no button should make that call for them.
     */
    expect(gap!.action).toBe('bill_stage');
  });
});

