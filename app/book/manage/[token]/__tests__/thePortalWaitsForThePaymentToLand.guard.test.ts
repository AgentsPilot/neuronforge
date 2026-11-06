/**
 * Coming back from a payment, the portal waits for it to land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CLIENT WAS SHOWN
 *
 * A booking on a two-instalment plan. The client pays the first instalment and
 * Stripe returns them to the portal, which greets them with:
 *
 *     Payment  $65  To pay      due Friday, November 6
 *     Payment plan             0 of 2 payments made
 *
 * about money they had just sent. Only a manual refresh cleared it, and the
 * second screenshot on the report shows the same page then reading
 * "$32.50 · 1 of 2 payments made · #1 PAID".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS A RACE, NOT A MISSING REFETCH
 *
 * Worth stating because the obvious diagnosis is wrong and was reached first.
 * `InvoicePaymentPanel` finishes with `window.location.href = successUrl`, a
 * FULL navigation — so the page remounts and `loadBooking` reads the server
 * with `cache: 'no-store'`. The read happens and is correct.
 *
 * It is simply too early. Stripe releases the client the moment the card
 * clears; the webhook that records the payment lands a second or two later.
 * The portal asked an honest question and got an honest, stale answer.
 *
 * Verified against the live row behind the report: instalment #1 carried
 * `status: paid` with `paid_at: 2026-11-06T15:12:37`. No data was lost — the
 * page just looked before it was written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * `?payment=success` is the panel's own marker and nothing read it. The page
 * now re-reads on that arrival until the figure moves, and the shape of that
 * loop is what matters: bounded, quiet, and stopped on the way out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const PAGE = 'app/book/manage/[token]/page.tsx';
const PANEL = 'components/public/InvoicePaymentPanel.tsx';

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

const page = read(PAGE);
const panel = read(PANEL);

/** The effect that handles the return, comments stripped. */
function returnEffect(): string {
  const from = page.indexOf("url.searchParams.get('payment')");
  expect(from).toBeGreaterThan(-1);

  return page
    .slice(from, from + 1800)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the marker the panel sends is read', () => {
  it('the panel still returns to it', () => {
    /* If this ever stops being the success target, the effect below is dead
       code and the client is back to a stale figure. */
    expect(page).toContain('?payment=success');
    expect(panel).toContain('window.location.href = successUrl');
  });

  it('the page acts on it', () => {
    /* THE BUG, AS ONE ASSERTION. This parameter existed and nothing anywhere
       read it. */
    expect(page).toMatch(/searchParams\.get\('payment'\) !== 'success'/);
  });

  it('and strips it, so a reload does not start the wait again', () => {
    const effect = returnEffect();

    expect(effect).toContain("searchParams.delete('payment')");
    expect(effect).toContain('history.replaceState');
  });
});

describe('the wait is bounded and quiet', () => {
  it('re-reads quietly, leaving the booking on screen', () => {
    /*
     * `loadBooking(true)`. Blanking a card the client is already reading, to
     * update a number, is worse than the number being a moment late.
     */
    expect(returnEffect()).toContain('loadBooking(true)');
  });

  it('gives up rather than polling for ever', () => {
    /* A payment that has not landed within a few seconds is not landing on
       this page load, and an unbounded loop is worse than the stale figure. */
    expect(returnEffect()).toMatch(/attempt < 5/);
  });

  it('stops as soon as the figure moves', () => {
    /* `plan.paid` over the amount — the "1 of 2 payments made" the client is
       waiting to see. */
    const effect = returnEffect();

    expect(effect).toMatch(/plan\?\.paid/);
    expect(effect).toMatch(/settled\(paymentRef\.current\) !== before/);
  });

  it('stops when the client leaves the page', () => {
    /* Without this the loop keeps refetching against an unmounted page. */
    const effect = returnEffect();

    expect(effect).toMatch(/return \(\) => \{\s*live = false;/);
  });
});

describe('it reads the payment it just fetched', () => {
  it('through a ref, not a closed-over value', () => {
    /*
     * The subtle half. `payment` captured in this effect is the value from the
     * render that STARTED the loop — never the one the refetch just stored —
     * so comparing against it would never detect the change and the loop would
     * always run all five times.
     */
    expect(page).toMatch(/const paymentRef = useRef<PortalPayment \| null>\(null\)/);
    expect(page).toMatch(/paymentRef\.current = payment/);
  });
});
