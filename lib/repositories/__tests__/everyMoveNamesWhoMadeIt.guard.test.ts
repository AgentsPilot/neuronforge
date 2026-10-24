import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * A booking that moves has to say who moved it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAUGHT, TWICE
 *
 * `moved_by` (20261082) was added because the journey labelled every
 * reschedule "you changed the time", including the ones a client made for
 * themselves. The column was wired, the public portal declared `'client'`, and
 * the owner's own dialog then stored NULL — because it writes `start_time`
 * directly instead of going through `rescheduleBooking`, which was the one
 * place the actor had been threaded.
 *
 * So the card went from naming the wrong person to naming nobody. Reported
 * both times by the owner, from the same card.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The argument is optional, which it has to be: most updates are not moves.
 * That means a path which forgets it compiles, runs, passes its own tests and
 * writes a row that is simply missing a fact. There is no failure to assert
 * on — only the shape of the call.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('every path that moves a booking names the actor', () => {
  /**
   * Call sites of `schedulingBookingRepository.update(` across the product,
   * with the arguments that follow. Found by grep rather than a hand-kept list,
   * so a NEW path is covered the day it is written — a list would only ever
   * describe the paths somebody remembered to add to it.
   */
  function updateCallSites(): Array<{ file: string; line: number; text: string }> {
    const raw = execSync(
      "grep -rn 'schedulingBookingRepository.update(' --include='*.ts' --include='*.tsx' app lib components || true",
      { cwd: join(__dirname, '..', '..', '..'), encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(entry => {
        const [file, line] = entry.split(':');
        return { file, line: Number(line) };
      })
      .filter(({ file }) => file && !file.includes('__tests__'))
      .map(({ file, line }) => {
        const source = readFileSync(join(__dirname, '..', '..', '..', file), 'utf-8').split('\n');
        /* Brace-matched from the call, so a multi-line argument object and any
           comments inside it are all covered. */
        const from = source.slice(line - 1).join('\n');
        const open = from.indexOf('(');
        let depth = 0;
        let i = open;
        for (; i < from.length; i++) {
          if (from[i] === '(') depth++;
          else if (from[i] === ')' && --depth === 0) break;
        }
        return { file, line, text: from.slice(0, i + 1) };
      });
  }

  it('so a call that writes start_time passes one', () => {
    const offenders = updateCallSites()
      /* Only the ones that can actually move an appointment. A status, a note
         or a payment field is not a reschedule and must not claim to be. */
      .filter(site => site.text.includes('start_time'))
      /* Either a literal, or a conditional that decides between them. */
      .filter(site => !/'owner'|'client'|'system'|movedBy/.test(site.text))
      .map(site => `${site.file}:${site.line}`);

    expect(offenders).toEqual([]);
  });

  it('and the two surfaces a person actually uses disagree about who they are', () => {
    /*
     * The whole point of the column, pinned: these two must never be given the
     * same answer. If a refactor ever routes them through one call site, this
     * fails and says so.
     */
    const root = join(__dirname, '..', '..', '..');

    const portal = readFileSync(
      join(root, 'app/api/book/manage/[token]/reschedule/route.ts'),
      'utf-8'
    );
    expect(portal).toContain("movedBy: 'client'");

    const drawer = readFileSync(
      join(root, 'app/api/scheduling/bookings/[id]/route.ts'),
      'utf-8'
    );
    expect(drawer).toContain("timeIsChanging ? 'owner' : undefined");
  });
});
