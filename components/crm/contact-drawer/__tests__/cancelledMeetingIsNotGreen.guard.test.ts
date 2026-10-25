/**
 * A cancelled meeting does not get the "this went well" colour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The dot beside the meeting's state line was green whenever `meetingSettled`
 * was true, and `attendanceRecorded` counts cancelled and no-show as settled.
 * That is the right question for the ACTION STRIP — a settled meeting has no
 * attendance left to record, whichever way it went — and the wrong question for
 * a colour.
 *
 * So the journey drew a green dot, the platform's "this went well" mark,
 * directly beside the word בוטלה:
 *
 *     ● 12:00 – 13:00 · 1 ש׳ · בוטלה      ← green
 *
 * The comment above that dot already said "green once it is marked held". The
 * condition under it said something else, and had for as long as it existed.
 *
 * Red rather than muted, because the step's own node on the rail is already
 * `failed`: a muted dot next to a red node reads as two different opinions
 * about one meeting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Inline styles inside the per-step map of a ~4,900-line component with no seam
 * to render one card through. What is protected is that the colour asks
 * "was it HELD", not "is it settled".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** Comments quote the forbidden condition by name. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The dot's own style block. */
const dot = (() => {
  const at = code.indexOf('background: meetingHeld');
  return at === -1 ? '' : code.slice(at, at + 600);
})();

describe('the comment stripping works', () => {
  it('removes prose naming the old condition', () => {
    expect(SOURCE).toContain(`"this went well" mark`);
    expect(code).not.toContain(`"this went well" mark`);
  });
});

describe('the colour asks whether it was HELD', () => {
  it('green only for a meeting that was HELD', () => {
    /*
     * Read off `meeting_status`, not `status`. The dot asks "did the meeting
     * happen", and that fact moved columns: `complete()` writes
     * `meeting_status: 'held'` and leaves `status` at `confirmed`, so pinning
     * the old expression meant this guard was protecting a line that had
     * stopped being true — the dot stayed grey for every meeting marked held.
     */
    expect(code).toMatch(/const meetingHeld =[\s\S]{0,160}meeting_status === 'held'/);
    expect(dot).toContain('meetingHeld');
    expect(dot).toContain('#22C58B');
  });

  it('the dot no longer keys off meetingSettled', () => {
    /*
     * The exact substitution. `meetingSettled` stays in the file — it is the
     * right question for the action strip and the edit button — but it must not
     * decide this colour.
     */
    expect(dot).not.toContain('meetingSettled');
  });

  it('meetingSettled is still used elsewhere, so this was a fix not a deletion', () => {
    /*
     * `attendanceRecorded` takes the BOOKING now, not a bare status — it has to
     * see `meeting_status` to answer at all. Asserting the call rather than the
     * exact expression, so a change to how the row is passed does not read as
     * the behaviour being deleted.
     */
    expect(code).toMatch(/const meetingSettled = attendanceRecorded\(booking\)/);
    expect(code.match(/meetingSettled/g)!.length).toBeGreaterThan(1);
  });
});

describe('a cancelled or missed meeting reads as such', () => {
  it('covers both ways a meeting fails to happen', () => {
    /* The window grew when the declaration did: it now reads `meeting_status`
       first and keeps the old statuses as the legacy branch. A fixed-width
       slice is the wrong tool for a growing expression, so it is bounded by the
       NEXT declaration instead. */
    const from = code.indexOf('const meetingCalledOff =');
    const decl = code.slice(from, code.indexOf(';', from) + 1);

    /* Both ways the appointment fails, on the column that now records them. */
    expect(decl).toContain("meeting_status === 'no_show'");
    expect(decl).toContain("meeting_status === 'cancelled'");
    /* And the pre-split rows still read correctly. */
    expect(decl).toContain("booking.status === 'cancelled'");
    expect(decl).toContain("booking.status === 'no_show'");
  });

  it('is red, matching the failed node on the rail beside it', () => {
    expect(dot).toContain('meetingCalledOff');
    expect(dot).toContain('#F04438');
  });

  it('held still outranks called-off, so a status cannot be both', () => {
    /* Order is the assertion: `meetingHeld` is tested first, so a completed
       booking can never fall through to the cancelled colour. */
    expect(dot.indexOf('meetingHeld')).toBeLessThan(dot.indexOf('meetingCalledOff'));
  });
});

describe('the states that have not resolved', () => {
  it('a meeting whose time has passed with no answer stays amber', () => {
    expect(dot).toContain('scheduleAwaiting');
    expect(dot).toContain('#B54708');
  });

  it('one still ahead stays muted', () => {
    expect(dot).toContain('var(--v2-border)');
  });

  it('amber is last of the three real states, so a cancellation wins over it', () => {
    /*
     * A cancelled meeting whose slot has already passed satisfies neither
     * `meetingHeld` nor — once cancelled — `scheduleAwaiting`, which excludes
     * settled bookings. Pinned anyway: if that exclusion is ever relaxed, the
     * cancellation must still be the colour shown.
     */
    expect(dot.indexOf('meetingCalledOff')).toBeLessThan(dot.indexOf('scheduleAwaiting'));
  });
});
