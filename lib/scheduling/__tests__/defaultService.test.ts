/**
 * A new booking starts on no service at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dialog opened on the first row of an alphabetical list. That was a
 * visible guess while the picker was expanded; collapsed to a summary line it
 * reads as a decision the owner made, carrying a price and a duration that
 * belong to whichever service happened to sort first.
 *
 * Only a service the CALLER named survives — the drawer opening a known
 * service, a package slot, a smart link. Everything else asks.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { defaultServiceFor } from '@/lib/scheduling/defaultService';

const svc = (id: string, status = 'active') => ({ id, status });

describe('a new booking', () => {
  it('starts on no service, so the dialog asks', () => {
    expect(defaultServiceFor([svc('a'), svc('b')])).toBeUndefined();
  });

  it('and does not quietly pick the first', () => {
    /* The reported behaviour: "the default is the first service (why)?" */
    expect(defaultServiceFor([svc('therapy'), svc('coaching')])).toBeUndefined();
  });

  it('not even when there is only one to pick', () => {
    /*
     * Tempting, and still the dialog answering its own first question — and a
     * business with one service today has two tomorrow, at which point the
     * convenience silently becomes the guess it replaced.
     */
    expect(defaultServiceFor([svc('only')])).toBeUndefined();
  });

  it('and has nothing to start on when there are none', () => {
    expect(defaultServiceFor([])).toBeUndefined();
  });
});

describe('when the caller named one', () => {
  it('that is the one, however many others there are', () => {
    expect(defaultServiceFor([svc('a'), svc('b'), svc('c')], 'b')?.id).toBe('b');
  });

  it('even if it is retired', () => {
    /*
     * A booking taken on a service since withdrawn must still open showing
     * that service. Narrowing to active rows here would have shown the owner
     * somebody else's service on their own booking.
     */
    expect(defaultServiceFor([svc('a'), svc('old', 'archived')], 'old')?.id).toBe('old');
  });

  it('and a name that matches nothing falls back to asking', () => {
    /* Not to the first row: a stale id from a link is not a choice either. */
    expect(defaultServiceFor([svc('a'), svc('b')], 'gone')).toBeUndefined();
  });

  it('nor does a single service rescue a name that matches nothing', () => {
    expect(defaultServiceFor([svc('only')], 'gone')).toBeUndefined();
  });
});
