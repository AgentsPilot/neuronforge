/**
 * A quote request is not offered an intake form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * An owner's own booking: a quotation, with a real meeting on Wed 28 Oct. The
 * journey drew
 *
 *     Client questionnaire   Not sent yet     [ Send client form ]
 *
 * and pressing it, confirming the dialog, produced a red banner:
 *
 *     This service does not collect an intake form
 *
 * A button whose only possible outcome was a refusal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT GOT THERE
 *
 * The rule has two clauses. `intakeAppliesToService` states both: intake is
 * what you ask someone BEFORE you see them, so neither a PRODUCT (nothing to
 * prepare for) nor a QUOTE REQUEST (no occasion yet) has one, however the
 * business has configured its form.
 *
 * `buildJourneySteps` wrote the rule again by hand instead of calling it, and
 * the hand copy had one clause: `!isUnscheduled`. That catches the product. A
 * scheduled quote walked straight through it. The comment directly above the
 * gate named BOTH cases — "a quote request or a product" — so the prose was
 * right and only the code was short, which is why reading it never found this.
 *
 * `IntakeReminderService` and `resolveIntakeBlock` both call the shared rule,
 * which is why the server refused what the journey offered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS TESTED WHERE
 *
 * The rule is a pure function and is tested for real below — those cases are
 * the behaviour, and they must keep answering for a quote however the journey
 * is refactored.
 *
 * The wiring is a gate inside a ~6,000-line component with no seam to render
 * one card through, so it is checked at the source: that the journey asks the
 * shared function rather than owning a third copy of the rule, and that the
 * button reads the answer the journey recorded.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { intakeAppliesToService } from '@/lib/business-os/intakeReach';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const tab = read('components/crm/contact-drawer/BookingsTab.tsx');

describe('the rule itself', () => {
  it('a quote request has no occasion for a form, even with a meeting booked', () => {
    // The reported booking exactly: sale_mode 'proposal', and genuinely scheduled.
    expect(intakeAppliesToService({ sale_mode: 'proposal', is_scheduled: true })).toBe(false);
  });

  it('a product has none either', () => {
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: false })).toBe(false);
  });

  it('an ordinary scheduled service does', () => {
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: true })).toBe(true);
  });

  it('says yes when it has nothing to go on, so a thin row is not silently stripped', () => {
    expect(intakeAppliesToService(null)).toBe(true);
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: null })).toBe(true);
  });
});

describe('the journey asks the shared rule', () => {
  it('imports it rather than restating it', () => {
    expect(drawer).toMatch(
      /import \{[^}]*\bintakeAppliesToService\b[^}]*\} from '@\/lib\/business-os\/intakeReach'/,
    );
  });

  it('the intake step is gated on it', () => {
    expect(drawer).toMatch(
      /const intakeHasAnOccasion =\s*intakeAppliesToService\(booking\.service\) && !isUnscheduled/,
    );
    expect(drawer).toMatch(/if \(hasIntakeData \|\| \(collectsIntake && intakeHasAnOccasion\)\)/);
  });

  it('no longer gates on the product clause alone', () => {
    /* The fault as it was written. */
    expect(drawer).not.toMatch(/if \(hasIntakeData \|\| \(collectsIntake && !isUnscheduled\)\)/);
  });

  it('keeps the start-time fallback the shared rule does not carry', () => {
    /*
     * `intakeAppliesToService` answers YES for `is_scheduled: null`; the
     * journey additionally treats "no flag AND no start time" as unscheduled.
     * Dropping `!isUnscheduled` for the shared call alone would regress that,
     * so both must stay in the expression above.
     */
    expect(drawer).toMatch(/booking\.service\?\.is_scheduled == null && !booking\.start_time/);
  });
});

describe('a step that still appears cannot offer a refused send', () => {
  it('the journey records the answer on the step', () => {
    /*
     * `hasIntakeData` deliberately outranks the rule — a form already sent or
     * answered keeps its step, because the record outlives the configuration.
     * In exactly that case there is nothing left to send.
     */
    expect(drawer).toMatch(/sendable: collectsIntake && intakeHasAnOccasion/);
  });

  it('the button reads it', () => {
    const at = tab.indexOf('const canSendIntake = Boolean(');
    expect(at).toBeGreaterThan(-1);

    const expr = tab.slice(at, tab.indexOf(');', at));
    expect(expr).toMatch(/step\.metadata\?\.sendable !== false/);
  });

  it('compares against false, so a step built without the field behaves as before', () => {
    const at = tab.indexOf('const canSendIntake = Boolean(');
    const expr = tab.slice(at, tab.indexOf(');', at));

    expect(expr).not.toMatch(/step\.metadata\?\.sendable === true/);
  });
});
