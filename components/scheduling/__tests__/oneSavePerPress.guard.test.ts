/**
 * One press of Save is one write.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THIS WAS FOUND. A service on the reporting account carried two
 * `SCHEDULING_SERVICE_UPDATED` audit entries one second apart with
 * byte-identical payloads. Nothing in the UI suggested two saves had happened;
 * the owner had pressed Save once as far as they knew.
 *
 * THE CAUSE. `savingRow` was declared and never written. Two separate
 * protections read it, and both were therefore inert:
 *
 *   `if (savingRow) return` at the top of `saveRowEdit` — the re-entry guard,
 *     which could never be true, so a second press started a second request;
 *   `disabled={saving || …}` on Save, where `saving` is this flag on the edit
 *     path — so the button stayed live for the whole round trip.
 *
 * The new-row path beside it has always set `savingNewRow` correctly. The edit
 * path is the copy that lost it, which is why nothing looked wrong: the code
 * reads as guarded, and the guard was a variable nobody assigned.
 *
 * WHY A SOURCE GUARD. The failure is an absent assignment, not a behaviour a
 * render test can reach: jsdom would have to hold a request open and press a
 * button twice inside it, and the assertion would still be about whether a
 * state setter was called. What has to hold is that both flags are written on
 * both paths, and that is visible in the source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const list = readFileSync(join(__dirname, '..', 'SchedulingServicesList.tsx'), 'utf8');

describe('the edit path', () => {
  it('marks itself in flight', () => {
    expect(list).toMatch(/setSavingRow\(true\)/);
  });

  it('and releases on every outcome', () => {
    /*
     * In a `finally`, not in each branch: the request has a success path, an
     * error path and a rejection path, and a release copied into three places
     * is one refactor away from being in two.
     */
    expect(list).toMatch(/\.finally\(\(\) => \{[\s\S]{0,400}setSavingRow\(false\)/);
  });

  it('still refuses to re-enter while one is running', () => {
    // The guard that the missing assignment had made unreachable.
    expect(list).toMatch(/if \(savingRow\) return;/);
  });
});

describe('the new-row path, which always did this', () => {
  it('marks itself in flight and releases', () => {
    expect(list).toMatch(/setSavingNewRow\(true\)/);
    expect(list).toMatch(/setSavingNewRow\(false\)/);
  });

  it('and refuses to re-enter', () => {
    expect(list).toMatch(/if \(savingNewRow \|\|/);
  });
});

describe('the Save button reads a flag that is written', () => {
  it('takes it from whichever path is open', () => {
    expect(list).toMatch(/const saving = isNew \? savingNewRow : savingRow;/);
  });

  it('and disables while a save is in flight', () => {
    expect(list).toMatch(/disabled=\{saving \|\|/);
  });
});

/**
 * The shape of the bug, stated so it cannot come back by deletion.
 *
 * A `useState` whose setter is never called is indistinguishable from a working
 * one at a glance — the reader sees a guard and believes it. If either setter
 * disappears again, these fail.
 */
describe('neither flag is write-only', () => {
  it.each([
    ['savingRow', 'setSavingRow'],
    ['savingNewRow', 'setSavingNewRow'],
  ])('%s is actually assigned', (_flag, setter) => {
    const assignments = list.match(new RegExp(`${setter}\\(`, 'g')) ?? [];

    // The declaration plus at least a true and a false.
    expect(assignments.length).toBeGreaterThanOrEqual(2);
  });
});
