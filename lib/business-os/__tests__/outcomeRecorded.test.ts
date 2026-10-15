/**
 * A client cannot fill in a form for a meeting that already ended.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * All three public intake routes — read the form, submit it, upload a file to
 * it — tested `booking.status === 'cancelled'` and nothing else. Two other
 * statuses end a meeting just as finally:
 *
 *   · `no_show`   — the client did not turn up, and the owner said so
 *   · `completed` — it happened; a form that prepares for it is moot
 *
 * So a client marked absent could still open their manage link, fill the form
 * in and attach files, and the answers landed on a booking nobody was going to
 * look at again — after the owner's own journey card had already stopped asking
 * for them and gone grey.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `holdsSlot`
 *
 * They look like the same question and are not. `holdsSlot` asks whether the
 * calendar is blocked, and `completed` is deliberately IN it so a past meeting
 * cannot be double-booked retrospectively. This asks whether the story is over,
 * and for a finished meeting it is. Sharing one predicate between the two would
 * either re-open the slot on a completed booking or let an absent client keep
 * filing forms.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  outcomeRecorded,
  holdsSlot,
  BOOKING_STATUSES,
  SETTLED_BOOKING_STATUSES,
} from '@/lib/business-os/bookingStatus';

describe('the three ways a booking ends', () => {
  for (const status of ['cancelled', 'completed', 'no_show']) {
    it(`${status} is settled`, () => {
      expect(outcomeRecorded(status)).toBe(true);
    });
  }

  for (const status of ['confirmed', 'pending']) {
    it(`${status} is not`, () => {
      expect(outcomeRecorded(status)).toBe(false);
    });
  }

  it('covers every status the system has, one way or the other', () => {
    /*
     * A new status added to `BOOKING_STATUSES` is a decision this predicate has
     * to make. Listing them here means it cannot be added without someone
     * answering "is this one over".
     */
    expect(BOOKING_STATUSES.length).toBe(5);
    expect([...SETTLED_BOOKING_STATUSES].sort()).toEqual(['cancelled', 'completed', 'no_show']);
  });
});

describe('it is not the slot question', () => {
  it('a completed booking is settled AND still holds its slot', () => {
    /*
     * The one status where the two disagree, and the reason they are separate
     * predicates. Collapsing them would either re-open a past slot to
     * double-booking or let an absent client keep filing forms.
     */
    expect(outcomeRecorded('completed')).toBe(true);
    expect(holdsSlot('completed')).toBe(true);
  });

  it('a no-show is settled and releases its slot', () => {
    expect(outcomeRecorded('no_show')).toBe(true);
    expect(holdsSlot('no_show')).toBe(false);
  });

  it('a pending booking holds its slot and is not settled', () => {
    expect(outcomeRecorded('pending')).toBe(false);
    expect(holdsSlot('pending')).toBe(true);
  });
});

describe('rubbish off the wire', () => {
  /* These routes are PUBLIC: the row is read by token, and a status the system
     does not know must not read as "still open" by accident. */
  for (const value of [null, undefined, '', 'CANCELLED', 'deleted', 0, {}, []]) {
    it(`${JSON.stringify(value)} is not settled`, () => {
      expect(outcomeRecorded(value)).toBe(false);
    });
  }

  it('is case-sensitive, matching what the column stores', () => {
    expect(outcomeRecorded('Cancelled')).toBe(false);
    expect(outcomeRecorded('cancelled')).toBe(true);
  });
});

describe('the file stays importable from a public route', () => {
  it('imports nothing', () => {
    /*
     * The header's own rule: a public page that pulls in a module which reaches
     * for a service-role key that is not there took down every public page in
     * this app once already. Adding this predicate here is only safe while that
     * holds.
     */
    const source = readFileSync(join(process.cwd(), 'lib/business-os/bookingStatus.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).not.toMatch(/^\s*import\s/m);
  });
});

describe('every intake route asks it', () => {
  /*
   * Source-level, because the three routes each resolve a portal token, a
   * Supabase row and a published form before they get here — and the thing
   * worth protecting is that none of them is left behind when the next one is
   * edited. That is exactly how they came to differ in the first place.
   */
  const routes = [
    'app/api/book/manage/[token]/intake/route.ts',
    'app/api/book/manage/[token]/intake/upload/route.ts',
  ];

  for (const route of routes) {
    const source = readFileSync(join(process.cwd(), route), 'utf8');

    it(`${route} imports the predicate`, () => {
      expect(source).toContain("import { outcomeRecorded } from '@/lib/business-os/bookingStatus';");
    });

    it(`${route} guards every entry point that had a cancelled check`, () => {
      const cancelled = (source.match(/booking\.status === 'cancelled'/g) ?? []).length;
      const settled = (source.match(/outcomeRecorded\(booking\.status\)/g) ?? []).length;

      expect(cancelled).toBeGreaterThan(0);
      expect(settled).toBe(cancelled);
    });

    it(`${route} still refuses with a 400`, () => {
      /* Not a 500 and not a silent accept: the client's page reads the status. */
      const at = source.indexOf('outcomeRecorded(booking.status)');
      expect(source.slice(at, at + 260)).toContain('{ status: 400 }');
    });

    it(`${route} keeps the cancelled branch and its own wording`, () => {
      /*
       * Folded into one check, a cancelled booking would start reporting
       * "already taken place" — and in the upload route it would lose the
       * `code: 'cancelled'` the client-side already handles.
       */
      expect(source).toMatch(/error: 'This booking (has been|was) cancelled'/);
    });
  }

  it('the upload route keeps its machine-readable code', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/api/book/manage/[token]/intake/upload/route.ts'),
      'utf8'
    );

    expect(source).toContain("code: 'cancelled'");
  });
});
