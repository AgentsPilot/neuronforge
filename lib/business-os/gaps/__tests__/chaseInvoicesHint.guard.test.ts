/**
 * The invoice-chasing switch governs EVERYTHING, and must say so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS GUARD USED TO PIN THE OPPOSITE, AND IT WAS RIGHT AT THE TIME.
 *
 * `PaymentReminderService` split two schedules across two switches on one line:
 *
 *   reminderType === 'overdue' ? config.chaseOverdue : config.enabled
 *
 *   before the due date   `payment_reminder_enabled`, default TRUE, no UI
 *                         `payment_reminder_days_before`, plus a due-day note
 *   after it              `chase_invoices_enabled`, the automation card
 *                         `payment_overdue_reminder_days`
 *
 * There was no double send — each reminder had exactly one owner — and this
 * guard made the hint admit the other half existed, which was the honest repair
 * available while two switches stood.
 *
 * It is one switch now. "Default TRUE, no UI" is the whole problem restated: an
 * owner who had agreed to nothing was emailing their clients a courtesy note in
 * their own name, and the only switch they had been shown governed the other
 * half. Naming the second half in the hint told them it was happening; it never
 * let them stop it.
 *
 * `chase_invoices_enabled` now governs every reminder type, and the hint has to
 * describe the whole arc: the courtesy before, the chaser's days, and the agent
 * that works the tail.
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

/*
 * The three dictionaries, read as text.
 *
 * They were one block inside `LanguageContext.tsx` until that file was split:
 * twelve thousand lines of strings inside a `'use client'` component that every
 * Business OS page imports. Same strings, three modules, and this still reads
 * them as SOURCE rather than importing them — the point is to assert what the
 * copy says, and importing the component would pull React in to do it.
 */
const context = (['en', 'es', 'he'] as const)
  .map(lang => readFileSync(join(__dirname, '..', '..', 'translations', `${lang}.ts`), 'utf8'))
  .join('\n');

/** Every translation of one key, one per language table. */
function translationsOf(key: string): string[] {
  return [...context.matchAll(new RegExp(`'${key}': '((?:[^'\\\\]|\\\\.)*)'`, 'g'))].map(m => m[1]);
}

describe('the chase-invoices hint', () => {
  const hints = translationsOf('automation.chase_invoices_hint');

  it('exists in all three languages', () => {
    expect(hints).toHaveLength(3);
  });

  it('names the courtesy that goes out BEFORE the due date', () => {
    /*
     * Still asserted, and now for a different reason. It used to prove the hint
     * admitted a second switch existed; it now proves the hint describes
     * something this switch actually governs. An owner reading it must know
     * that answering yes starts a note before the invoice is even late.
     */
    const before = [/before it falls due/i, /antes del vencimiento/i, /לפני מועד התשלום/];

    hints.forEach((hint, index) => {
      expect(hint).toMatch(before[index]);
    });
  });

  it('names the agent that picks up the tail', () => {
    /*
     * The other end of the same arc. The chaser stops after its last milestone
     * and the `chase_overdue_invoices` agent carries on, one consolidated
     * message per client per week. A hint that stops at the chaser lets an owner
     * believe the chasing continues for ever, or that it stops dead — and which
     * of those is true depends on whether they have installed the agent.
     */
    const agent = [/collection agent/i, /agente de cobros/i, /סוכן הגבייה/];

    hints.forEach((hint, index) => {
      expect(hint).toMatch(agent[index]);
    });
  });

  it('does not enumerate the days, because the copy cannot know them', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * IT HAS GONE STALE TWICE, IN OPPOSITE DIRECTIONS.
     *
     * The hint said "3, 7 and 14 days late" — `overdueMilestones`' module
     * default. Every live profile carries the COLUMN default `{1,3,7}`, so the
     * card promised a day 14 that would never come. Rewriting it to "1, 3 and 7"
     * fixed those accounts and broke the other case: an account created without
     * the column falls back to the module default and would be shown a schedule
     * it is not on.
     *
     * The two defaults disagree, `overdueMilestones` says so outright, and
     * reconciling them is a cadence change that does not belong in a copy edit.
     * So the hint stops quoting a list it cannot know and points at the
     * account's own setting instead.
     * ─────────────────────────────────────────────────────────────────────────
     */
    for (const hint of hints) {
      expect(hint).not.toMatch(/\b1,\s*3\s*(and|y|ו)\s*7\b/i);
      expect(hint).not.toMatch(/\b3,\s*7\s*(and|y|ו)\s*14\b/i);
    }
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

  it('routes every reminder to the one switch the owner was shown', () => {
    /*
     * The line this used to pin, in full, was:
     *
     *   params.reminderType === 'overdue' ? config.chaseOverdue : config.enabled
     *
     * It divided the work so nothing double-sent, and it is gone because the
     * division itself was the defect: `config.enabled` reads
     * `payment_reminder_enabled`, which defaults TRUE and has no UI, so half
     * the schedule asked nobody.
     *
     * Nothing double-sends now either, for a simpler reason — there is only one
     * answer to read.
     */
    expect(service).not.toContain(
      "params.reminderType === 'overdue' ? config.chaseOverdue : config.enabled"
    );
    expect(service).not.toMatch(/if \(!config\.enabled\)/);
    expect(service).toMatch(/if \(!config\.chaseOverdue\)/);
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
