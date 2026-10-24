/**
 * The attempt id must reach the Stripe object that holds the money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS GUARDED AT SOURCE LEVEL
 *
 * A booking is written only once the client has paid, so the charge exists
 * before there is a booking to name. `linkPaymentsToBooking` joins them
 * afterwards by asking Stripe `metadata['attempt_id']:'<id>'` — which is only
 * answerable if the attempt was put on the Stripe object at creation.
 *
 * Checkout Session metadata does NOT propagate to the objects the session
 * creates. Not to the Subscription, and not to the PaymentIntent. Both halves
 * of that have already shipped as live bugs:
 *
 *   - the plan branch had session metadata only, so an instalment sale recorded
 *     a plan naming no attempt and the drawer showed ₪0 collected;
 *   - the one-off branch had the same gap for its PaymentIntent, found while
 *     fixing the first.
 *
 * The failure is silent in the worst way — the client is charged, Stripe is
 * correct, and only the owner's screen is wrong — and no runtime test catches
 * it, because it needs a real Stripe round trip to observe. So it is asserted
 * against the source: whichever `*_data` key a mode requires, the attempt is on
 * it.
 *
 * A match on the surrounding literal rather than the call, because these are
 * object-literal keys and there is nothing to invoke in a unit test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..');

/** CRLF-normalised, so the assertions hold on Windows checkouts too. */
function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/** The body of a `key: { metadata: { … } }` literal, if the key is present. */
function metadataBlockFor(src: string, key: string): string | null {
  const at = src.indexOf(`${key}: {`);
  if (at === -1) return null;

  const metadataAt = src.indexOf('metadata: {', at);
  if (metadataAt === -1) return null;

  /* Walk the braces so a nested object cannot end the block early. */
  let depth = 0;
  const open = src.indexOf('{', metadataAt);

  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }

  return null;
}

describe('the attempt travels with the money', () => {
  describe('website/checkout — session metadata reaches neither child object', () => {
    const src = source('app/api/website/checkout/route.ts');

    it('puts the attempt on the subscription a plan creates', () => {
      const block = metadataBlockFor(src, 'subscription_data');

      expect(block).not.toBeNull();
      expect(block).toContain('attempt_id');
    });

    it('puts the attempt on the payment intent a one-off creates', () => {
      const block = metadataBlockFor(src, 'payment_intent_data');

      expect(block).not.toBeNull();
      expect(block).toContain('attempt_id');
    });
  });

  describe('website/payment-intent — the widget journey', () => {
    const src = source('app/api/website/payment-intent/route.ts');

    /*
     * This route calls `subscriptions.create` directly, so there is no
     * `subscription_data` key to anchor on. `plan_count` is: it is written only
     * into the metadata of the subscription that bounds a plan. So every
     * metadata literal that bounds a plan must also name the attempt — which
     * asserts the real thing rather than "the file mentions attempt_id".
     */
    it('puts the attempt on the subscription metadata that bounds a plan', () => {
      const blocks = [...src.matchAll(/metadata: \{/g)]
        .map(match => {
          let depth = 0;
          const open = src.indexOf('{', match.index!);

          for (let i = open; i < src.length; i += 1) {
            if (src[i] === '{') depth += 1;
            if (src[i] === '}') {
              depth -= 1;
              if (depth === 0) return src.slice(open, i + 1);
            }
          }

          return '';
        })
        .filter(block => block.includes('plan_count'));

      expect(blocks.length).toBeGreaterThan(0);

      for (const block of blocks) {
        expect(block).toContain('attempt_id');
      }
    });

    it('puts the attempt on the one-off payment intent too', () => {
      /* The params object for a single charge: identified by its receipt field. */
      expect(src).toMatch(/receipt_email[\s\S]{0,1200}?attempt_id/);
    });
  });

  describe('the reader those writes exist for', () => {
    const src = source('lib/payments/linkPaymentsToBooking.ts');

    it('searches Stripe on the attempt, and only on the attempt', () => {
      expect(src).toContain("metadata['attempt_id']");
    });

    it('searches both the subscription and the one-off charge', () => {
      expect(src).toContain('subscriptions');
      expect(src).toContain('payment_intents');
    });

    it('never moves a row that is already attached', () => {
      /*
       * Every write is `.is('booking_id', null)`. That is what makes the happy
       * path, the webhook and the reconcile pass safe to all run on the same
       * sale, and what stops a retry attaching one client's money to another's
       * booking.
       */
      const writes = src.match(/\.update\(stamp\)/g) ?? [];
      const guards = src.match(/\.is\('booking_id', null\)/g) ?? [];

      expect(writes.length).toBeGreaterThan(0);
      expect(guards.length).toBeGreaterThanOrEqual(writes.length);
    });
  });
});
