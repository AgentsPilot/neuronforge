/**
 * Guard: a snapshot in this directory may not record a plaintext ISO date.
 *
 * `callParams.boundary.step3.test.ts.snap` stored `Today is 2026-09-21.` - the
 * planner puts the current day in its prompt, correctly - so the file was red
 * every day after the day it was recorded, for ever, and re-recording bought
 * exactly one more day. The suites now replace any ISO-8601 date with `<date>`
 * inside `normalise()`, *before* the long-string digest, so a date buried in a
 * 30k-character prompt cannot move the hash either. This test is what keeps that
 * true: it reads the committed snapshot files as text, so it fails the moment a
 * new snapshot here embeds such a date, visible in the diff or not.
 *
 * WHAT IT CATCHES, EXACTLY - narrower than "any calendar date":
 *
 *   a contiguous `NNNN-NN-NN`, in plaintext, on a line that is not a `model` or
 *   `provider` line, in a `.snap` file directly in this directory.
 *
 * So it does NOT catch the following. Each would still be latent rot; none is
 * present today:
 *   - any other date format - `09/21/2026`, `2026/09/21`, `21.09.2026`, `26-09-21`,
 *     `21 Sep 2026`, `20260921`, epoch milliseconds (`1790109595397`), a bare
 *     time of day;
 *   - a date split across a newline, or one hidden inside a `sha256:` digest;
 *   - a date sharing a line with `"model":` (the exemption is line-scoped);
 *   - `.snap` files in a subdirectory, and inline snapshots (there are none
 *     repo-wide today).
 *
 * The pattern is deliberately NOT widened to chase those. A guard that tries to
 * match every date shape starts flagging version strings and ids, and the way a
 * noisy guard fails is that somebody deletes it. A narrow guard that says plainly
 * what it does is worth more than a broad one nobody trusts. The stronger fix for
 * the whole class is pinning the clock per suite - see the follow-up doc.
 *
 * Elsewhere in the repo the problem is already solved that stronger way: suites
 * that legitimately snapshot dates (`app/api/business-os/usage`, `lib/analytics`)
 * call `jest.setSystemTime` first, which asserts the date verbatim and therefore
 * also catches a *wrong* or missing one. Either approach is fine; what is not
 * fine is a snapshot whose value depends on the day it was recorded.
 *
 * Background: docs/workplans/FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_DIR = join(__dirname, '__snapshots__');

const DOC = 'docs/workplans/FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md';

/** Same shape as the suites' own normaliser, minus its optional time part. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

/**
 * The one exception, mirroring `DATE_EXEMPT_KEYS` in the suites themselves.
 *
 * Model ids carry dates - `gpt-4o-2024-08-06` is settable through
 * `npm run bos:llm-settings` - and the suites deliberately record them verbatim,
 * because which model went on the wire is the assertion they exist to make. Such
 * a line is a pinned constant, not a moving value: it changes when an operator
 * changes the setting, never on its own.
 *
 * Line-scoped, so a rotting date that shared a line with `"model":` would be
 * missed. The snapshot serialiser puts one field per line, so it cannot today.
 */
const DATE_EXEMPT_LINE = /"(model|provider)":/;

/**
 * `[]` rather than a throw if the directory is gone: throwing at module scope
 * fails collection, which would leave the "did we find any files" test below
 * unable to report the very thing it exists to report.
 */
function snapshotFiles(): string[] {
  try {
    return readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.snap'));
  } catch {
    return [];
  }
}

describe('Business OS LLM snapshots are date-independent', () => {
  const files = snapshotFiles();

  it('finds the snapshot files (a silent empty glob would prove nothing)', () => {
    expect(files.length > 0 ? 'found' : `no .snap files under ${SNAPSHOT_DIR}`).toBe('found');
  });

  it.each(files)('%s records no plaintext ISO date', (file) => {
    const lines = readFileSync(join(SNAPSHOT_DIR, file), 'utf8').split(/\r?\n/);
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => ISO_DATE.test(line) && !DATE_EXEMPT_LINE.test(line))
      .map(({ line, n }) => `${file}:${n}: ${line.trim().slice(0, 120)}`);

    // The remedy travels with the failure: CI prints this, never the header comment.
    const remedy =
      `\nThis snapshot recorded a date, so it will be red tomorrow. Normalise it in the ` +
      `suite's normalise() (ISO dates become <date>), or pin the clock with ` +
      `jest.setSystemTime() and keep asserting the date verbatim. Do not just ` +
      `re-record - that buys exactly one day. See ${DOC}.`;

    expect(offenders.length ? offenders.join('\n') + remedy : 'no dates').toBe('no dates');
  });
});
