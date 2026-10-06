/**
 * Purge slice 3b, SA G-1 — the commit box must not claim to delete while the
 * destructive function is not applied.
 *
 * Source-level guard (no DOM): the box renders after every preview, for both
 * levels, so its copy has to follow the same probe (`access.resetLive`) as
 * the page banner. This feature has already shipped three reassuring-but-false
 * lines in its UI copy (see descriptors.invariant.test.ts, "no user-facing copy
 * claims deletion is impossible"); this is the mirror image — a line that
 * claims deletion while the server will refuse.
 */

import fs from 'fs';
import path from 'path';

const src = fs
  .readFileSync(path.join(__dirname, '..', 'PurgeDangerZone.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

/** The commit box: from its heading to the commit button handler. */
const box = (() => {
  const start = src.indexOf("'Purge this business'");
  const end = src.indexOf('onClick={runCommit}', start);
  return start > -1 && end > start ? src.slice(start, end) : '';
})();

/** The JSX expression that renders when `cond` holds, up to the next `)}`. */
const branch = (cond: string) => {
  const at = box.indexOf(cond);
  return at === -1 ? '' : box.slice(at, box.indexOf(')}', at));
};

describe('G-1 — commit box copy follows the probe', () => {
  it('found the commit box (non-vacuity)', () => {
    expect(box.length).toBeGreaterThan(200);
  });

  it('when the function is NOT applied, says the server will refuse before any snapshot or delete', () => {
    const notLive = branch('access.resetLive === false &&');
    expect(notLive).toMatch(/not applied/);
    expect(notLive).toMatch(/server will refuse this run before anything\s+is snapshotted or deleted/);
  });

  it('when the state is unknown, says so', () => {
    const unknown = branch('access.resetLive !== true && access.resetLive !== false &&');
    expect(unknown).toMatch(/unknown/i);
  });

  it('"Permanently deletes" only when live; otherwise "Would permanently delete"', () => {
    expect(box).toMatch(/access\.resetLive === true \? 'Permanently deletes' : 'Would permanently delete'/);
    // No unconditional "Permanently deletes" left in the box.
    const unconditional = box.replace(/access\.resetLive === true \? 'Permanently deletes'/, '');
    expect(unconditional).not.toMatch(/>\s*Permanently deletes/);
    expect(unconditional).not.toMatch(/'Permanently deletes'/);
  });

  it('the button stays enabled whatever the probe says (the audited refusal path)', () => {
    const button = src.slice(src.indexOf('onClick={runCommit}'), src.indexOf('</button>', src.indexOf('onClick={runCommit}')));
    expect(button).toMatch(/disabled=\{committing \|\| confirmText\.trim\(\)\.length === 0\}/);
    expect(button).not.toMatch(/resetLive/);
  });
});
