/**
 * The intake step is there when the drawer opens, not only after an action.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * A client booked from the public page, received the intake email, and the
 * booking's journey showed no intake step at all.
 *
 * Nothing about intake was broken. `businessCollectsIntake` answered true, the
 * settings were enabled, a published form existed, and `buildJourneySteps`
 * pushes the step whenever `hasIntakeData || collectsIntake`.
 *
 * The answer never reached it. `collectsIntake` lived in `useState`, set by its
 * own effect. `loadAllContactData` is a plain async function called from an
 * effect keyed on `[contact.id, isOpen]`, so it CAPTURED the value from the
 * render where the drawer opened — `false`, always, because the settings fetch
 * had not answered yet. The later `setCollectsIntake(true)` re-rendered the
 * component but could not reach into a closure that had already started, and
 * nothing rebuilt `sessionCards`.
 *
 * So the step was missing ON OPEN and appeared after any action that called
 * `fetchSessions`, which is recreated on every render and therefore saw the
 * settled value. That is the same shape as the warning already written on
 * `processBookingsData`: a refund that showed only after a refresh.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The defect is WHEN a value is read, not what any function returns. Every unit
 * here passes: `businessCollectsIntake` is correct, `buildJourneySteps` is
 * correct, the settings route is correct. Only the wiring between a closure and
 * a `useState` was wrong, and that is a property of the source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const drawer = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
  'utf8'
);

/** Comments quote the old shape; assertions about code must not read them. */
const code = drawer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the answer is awaited by the load that needs it', () => {
  it('fetches the setting inside the priority load', () => {
    expect(code).toMatch(/const intakeSettingsPromise = fetch\('\/api\/intake\/settings'\)/);
  });

  it('awaits it alongside the bookings, not after them', () => {
    /*
     * Ordering is removed rather than won: there is no arrangement of these
     * four responses that can build the journey without the answer.
     */
    expect(code).toMatch(
      /const \[bookingsData, emailsData, proposalsList, collects\] = await Promise\.all\(\[/
    );
    expect(code).toMatch(/intakeSettingsPromise,\s*\n\s*\]\);/);
  });

  it('hands it to the builder as an argument', () => {
    expect(code).toMatch(/processBookingsData\(bookingsData, emailsData, proposalsList, collects\)/);
    expect(code).toMatch(/collects: boolean = collectsIntakeRef\.current/);
  });
});

describe('nothing reads it from a closure-captured useState', () => {
  it('the state is gone', () => {
    /*
     * The whole defect in one declaration. A ref can be read from a long-lived
     * closure and still give today's answer; `useState` cannot.
     */
    expect(code).not.toMatch(/useState\(false\);?\s*$[\s\S]{0,40}setCollectsIntake/m);
    expect(code).not.toMatch(/setCollectsIntake/);
  });

  it('the other caller reads the ref', () => {
    /* `fetchSessions` has its own closure and no `collects` in scope. */
    expect(code).toMatch(/collectsIntakeRef\.current,\s*\n\s*timezone/);
  });

  it('the ref is kept in step by the load', () => {
    expect(code).toMatch(/collectsIntakeRef\.current = collects;/);
  });
});

describe('the step itself is unchanged', () => {
  it('still shows on a response OR on the business collecting intake', () => {
    /*
     * The second half is what makes an UNSENT form reachable — without it the
     * "Send intake form" action could never be shown, which is the bug this
     * parameter was added for in the first place.
     *
     * `!isUnscheduled` was added beside it: an intake form is what you ask
     * someone BEFORE you see them, and a purchase with no appointment has
     * nothing to prepare for — the step was drawing a card about a form that
     * would never be sent. `hasIntakeData` still wins on its own, so a response
     * already given survives the service changing shape.
     */
    expect(code).toMatch(/if \(hasIntakeData \|\| \(collectsIntake && !isUnscheduled\)\) \{/);
  });

  it('a failed read still means no step, which is the safer mistake', () => {
    expect(code).toMatch(/\.catch\(\(\) => false\)/);
  });
});
