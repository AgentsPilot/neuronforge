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

/** Every kind the queue can hold, from the repository's own union. */
const QUEUE_KINDS = ['invite', 'chase', 'invoice_chase', 'intake_chase', 'meeting_reminder'];

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
