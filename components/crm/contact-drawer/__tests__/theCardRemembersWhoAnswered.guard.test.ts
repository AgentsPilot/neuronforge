/**
 * `toAppointment` must carry the columns its readers depend on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MISTAKE THIS EXISTS TO STOP, WHICH HAS NOW HAPPENED TWICE
 *
 * The mapper names its fields one at a time rather than spreading the row, so
 * a column the API returns is dropped simply by not being mentioned. Nothing
 * fails: the value is `undefined`, and every reader behaves as though it had
 * never been set.
 *
 * It happened first to `meeting_status`, and the comment block above that line
 * in the drawer is the record of it. It then happened to `outcome_by`:
 *
 *   · the column exists (migration 20261078) and holds `'system'` where
 *     `auto_complete_meetings` closed a meeting a person never answered for;
 *   · the repository returns it — the booking list is `select('*')`;
 *   · the route passes the rows through untouched;
 *   · the mapper did not name it, so the browser saw `undefined`.
 *
 * The cost was two features that looked built and did nothing: the row's
 * correction controls (no-show, cancel, and the confirmation that raises the
 * invoice the automation withheld) and the "marked automatically" badge. Both
 * are offered only on a system-held row, and no row could ever be one.
 *
 * Asserted against the source rather than by rendering, because the failure is
 * an ABSENCE — there is no wrong value to catch, only a missing line.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'CRMContactDrawerV2.tsx'), 'utf-8');

/** The body of `toAppointment`, which is where a dropped column hides. */
const mapper = (() => {
  const from = source.indexOf('export function toAppointment(');
  expect(from).toBeGreaterThan(-1);
  /* To the next top-level declaration: long enough to hold the whole field
     list, and it is the field list this asserts on. */
  const end = source.indexOf('\nexport ', from + 1);
  return source.slice(from, end === -1 ? source.length : end);
})();

describe('the card remembers who answered for the meeting', () => {
  it('carries the outcome AND who gave it', () => {
    /* Together, always. A status with nobody behind it is what let a clock's
       answer read as a person's. */
    expect(mapper).toContain('meeting_status: booking.meeting_status');
    expect(mapper).toContain('outcome_by: booking.outcome_by');
  });

  it('carries the fields the package table reads off a child card', () => {
    /*
     * A package of the older shape is child bookings grouped by their parent,
     * and each row of the meetings table IS one of these cards. Lose any of
     * these and a row renders with no idea what it is.
     */
    for (const field of ['status', 'start_time', 'parent_booking_id', 'attempts']) {
      expect(mapper).toContain(`${field}:`);
    }
  });
});

describe('the row offers a correction only when a machine gave the answer', () => {
  const actions = readFileSync(join(__dirname, '..', 'MeetingRowActions.tsx'), 'utf-8');
  const tab = readFileSync(join(__dirname, '..', 'BookingsTab.tsx'), 'utf-8');

  it('is handed the actor by the table', () => {
    /* The other half of the same break: the component can read it, but only
       if the row passes it down. */
    expect(tab).toMatch(/outcomeBy=\{row\.outcome_by/);
  });

  it('and reads it', () => {
    expect(actions).toMatch(/outcomeBy\?:/);
    expect(actions).toMatch(/outcomeBy === 'system'/);
  });
});

describe('a clock\'s answer does not wear a person\'s tick', () => {
  const tab = readFileSync(join(__dirname, '..', 'BookingsTab.tsx'), 'utf-8');

  it('gives the automation its own glyph', () => {
    /*
     * Held either way, so the COLOUR must not change — amber would claim the
     * meeting is in doubt, which is the opposite lie. What changes is who is
     * claiming it, and an identical tick hides exactly the rows worth a second
     * look.
     */
    expect(tab).toMatch(/\{markedByMachine \? \(/);
    expect(tab).toMatch(/<Bot className=/);
  });

  it('decides it once, for the word and the glyph alike', () => {
    /*
     * Two expressions saying the same thing about one row is how a cell ends
     * up showing a person's tick above a machine's sentence.
     */
    expect(tab).toMatch(/const markedByMachine =\s*\n?\s*held && row\.outcome_by === 'system';/);
    expect(tab).toMatch(/const meetingStatus = markedByMachine/);
  });

  it('says so in words too, in every language', () => {
    /* The glyph is the only difference on screen; hover and screen readers
       get the sentence. A missing key would leave them with the raw id. */
    for (const lang of ['en', 'he', 'es']) {
      const dict = readFileSync(
        /* From the repo root, not by counting `..` out of `__tests__` — three
           of them land on `components/`. Same correction as `root` above. */
        join(process.cwd(), 'lib', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      expect(`${lang}:${dict.includes("'crm.booking.status.auto_completed'")}`).toBe(
        `${lang}:true`
      );
    }
  });
});

describe('the Needs-you row says why it is asking', () => {
  /*
   * The repo root, from `components/crm/contact-drawer/__tests__`.
   *
   * Three `..` lands on `components/`, so every read below looked for
   * `components/lib/...` and the suite failed to LOAD — which CI reports as a
   * runtime error rather than a failed assertion, and the gate's G5 check
   * fails the whole run for it. `process.cwd()` is what the other guards in
   * this directory use and does not depend on counting directories.
   */
  const root = process.cwd();
  const defs = readFileSync(join(root, 'lib', 'business-os', 'gaps', 'definitions.ts'), 'utf-8');
  const route = readFileSync(
    join(root, 'app', 'api', 'business-os', 'gaps', 'route.ts'),
    'utf-8'
  );
  const card = readFileSync(
    join(root, 'components', 'business-os', 'insight', 'NeedsYouCard.tsx'),
    'utf-8'
  );

  it('reads who closed the hour it is about to bill', () => {
    expect(defs).toContain('meeting_status, outcome_by');
    expect(defs).toMatch(/autoHeld: meeting\?\.by === 'system'/);
  });

  it('carries it across the boundary, which drops what it does not name', () => {
    /* The same field-by-field list that silently dropped `outcome_by` once. */
    expect(route).toMatch(/autoHeld: item\.autoHeld/);
  });

  it('explains itself instead of looking like every other row', () => {
    expect(card).toMatch(/item\.autoHeld && \(/);
    expect(card).toContain("t('gaps.auto_held_check')");
  });

  it('asks for a confirmation rather than a charge', () => {
    /*
     * Same endpoint, different question. "Mark done and bill" is right over
     * work a person vouched for; over a clock's answer the owner has to decide
     * whether there is anything to bill for first.
     */
    expect(card).toMatch(/bill_stage_auto_held/);
    expect(card).toMatch(/gaps\.action\.\$\{actionKey\}/);
  });

  it('says both in every language', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = readFileSync(
        join(root, 'lib', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      for (const key of ['gaps.action.bill_stage_auto_held', 'gaps.auto_held_check']) {
        expect(`${lang}:${key}:${dict.includes(`'${key}'`)}`).toBe(`${lang}:${key}:true`);
      }
    }
  });
});

describe('confirming is offered only while there is something to confirm', () => {
  const actions = readFileSync(join(__dirname, '..', 'MeetingRowActions.tsx'), 'utf-8');
  const tab = readFileSync(join(__dirname, '..', 'BookingsTab.tsx'), 'utf-8');

  it('drops the primary once the invoice exists', () => {
    /*
     * The confirmation IS the gesture that raises the invoice, and the
     * Needs-you card can raise it from the other side without touching the
     * meeting. Left alone, this row would keep asking for a decision already
     * made elsewhere.
     */
    expect(actions).toMatch(/!\(systemHeld && alreadyBilled\)/);
    expect(tab).toMatch(/alreadyBilled=\{Boolean\(pay\?\.invoiceId\)\}/);
  });

  it('but keeps the corrections', () => {
    /* Discovering afterwards that the hour never happened is exactly when a
       no-show matters, and the refund path is built for it. */
    expect(actions).toMatch(/\(!settled \|\| systemHeld\) && onSetStatus/);
  });
});
