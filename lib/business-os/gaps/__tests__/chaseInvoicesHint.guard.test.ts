/**
 * The invoice-chasing switch governs half a schedule, and must say so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `PaymentReminderService` splits two schedules across two switches on one
 * line:
 *
 *   reminderType === 'overdue' ? config.chaseOverdue : config.enabled
 *
 *   before the due date   `payment_reminder_enabled`, default TRUE, no UI
 *                         `payment_reminder_days_before`, plus a due-day note
 *   after it              `chase_invoices_enabled`, the automation card
 *                         `payment_overdue_reminder_days`
 *
 * There is no double send — each reminder has exactly one owner. What there
 * was, was no way for the owner to know the other half existed. The card said
 * "a reminder on the first, third and seventh day", which is true of what it
 * controls and silent about the list that fires before the invoice is late.
 *
 * On 2026-10-05 the owner asked why the same invoices were being chased every
 * day. INV-00015 had gone out on three consecutive mornings — day -1, day 0,
 * day +1 — one entry from each of the three lists, every one correctly
 * scheduled, and the 24-hour floor blind to all of it because it was scoped per
 * reminder type. The defaults are now sparse and widening, and
 * `MIN_HOURS_BETWEEN_REMINDERS` spans the lists.
 *
 * These hold the hint honest in all three languages. If the day lists ever
 * become editable, this guard is the thing that should fail and send you to the
 * copy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const context = readFileSync(
  join(__dirname, '..', '..', 'LanguageContext.tsx'),
  'utf8'
);

/** Every translation of one key, one per language table. */
function translationsOf(key: string): string[] {
  return [...context.matchAll(new RegExp(`'${key}': '((?:[^'\\\\]|\\\\.)*)'`, 'g'))].map(m => m[1]);
}

describe('the chase-invoices hint', () => {
  const hints = translationsOf('automation.chase_invoices_hint');

  it('exists in all three languages', () => {
    expect(hints).toHaveLength(3);
  });

  it('names the half that is NOT this switch', () => {
    /*
     * The whole point. A hint describing only the overdue days lets an owner
     * turn this on believing three emails and watch more arrive from a list
     * they were never shown.
     */
    const before = [/before the due date/i, /antes del vencimiento/i, /לפני מועד התשלום/];

    hints.forEach((hint, index) => {
      expect(hint).toMatch(before[index]);
    });
  });

  it('promises the floor, which is what stops it reading as daily', () => {
    /*
     * The reassurance the owner actually needs, and the thing that was missing
     * when a client got three mornings running. A count would be the wrong
     * promise to print: the total depends on the account's own day lists, and
     * a hint quoting "six" went stale the day the defaults changed.
     */
    const floor = [/three days/i, /tres días/i, /שלושה ימים/];

    hints.forEach((hint, index) => {
      expect(hint).toMatch(floor[index]);
    });
  });

  it('does not print a total that goes stale with the defaults', () => {
    // An earlier version said "up to six emails". It was true for a day.
    for (const hint of hints) {
      expect(hint).not.toMatch(/\bsix\b|\bseis\b|שש/i);
    }
  });

  it('still promises the reminders stop on payment', () => {
    /*
     * The original hint's one genuinely reassuring claim, and the thing an
     * owner most wants to know before switching it on. It must survive any
     * rewrite of the rest.
     */
    const stops = [/stop the moment/i, /se detienen en cuanto/i, /נפסק ברגע/];

    hints.forEach((hint, index) => {
      expect(hint).toMatch(stops[index]);
    });
  });

  it('does not claim the owner can edit the schedule', () => {
    /*
     * An earlier comment in `automations.ts` said the days were the owner's to
     * change. Neither list is reachable from any screen, and a hint repeating
     * that would send somebody looking for a control that does not exist.
     */
    for (const hint of hints) {
      expect(hint).not.toMatch(/you can change|change (the|these) days|puedes cambiar|אפשר לשנות/i);
    }
  });
});

describe('the split itself', () => {
  const service = readFileSync(
    join(__dirname, '..', '..', '..', 'services', 'PaymentReminderService.ts'),
    'utf8'
  );

  it('still routes each reminder to exactly one switch', () => {
    /*
     * This line is why there is no double send. If it goes, the two switches
     * stop dividing the work and `chase_invoices_enabled` plus
     * `payment_reminder_enabled` both fire on the same reminder — the collision
     * the meeting reminder's comment cites as the precedent it was avoiding.
     */
    expect(service).toContain(
      "params.reminderType === 'overdue' ? config.chaseOverdue : config.enabled"
    );
  });

  it('keeps the overdue default OFF', () => {
    /*
     * Writing to a stranger's client about a debt without the owner having
     * agreed. The service's own comment calls this "the one default that does
     * nothing", and it is the only one of the four that is conservative.
     */
    expect(service).toMatch(/chaseOverdue: false/);
  });
});
