/**
 * One quote produces one card, not two.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `quote_awaiting_client` and `quote_deadline_unanswered` read the same rows
 * (`status in (sent, viewed)`) and asked the same question. The first had no
 * deadline condition at all, so the second was a strict SUBSET of it: every
 * quote with a future `valid_until` matched both, and nothing dedupes by
 * `entityId` across gaps, so both reached the owner.
 *
 * Reported on a live account on 2026-11-16. An expired quote was extended from
 * the 13th to the 17th, which correctly flipped its status back to `sent` and
 * cleared the `quote_expired` card — and replaced it with TWO cards about the
 * same quote, both dated to the original send. From the owner's seat they had
 * acted and the card had multiplied.
 *
 * ── THE DIVISION ────────────────────────────────────────────────────────────
 * A quote with a live deadline belongs to the deadline gap, which carries the
 * date it lapses. A quote with no deadline, or one already past it, belongs to
 * `quote_awaiting_client` — nothing else would ever mention it.
 *
 * ── WHY A SOURCE GUARD ──────────────────────────────────────────────────────
 * Both definitions keep working when they overlap. Each returns correct rows,
 * every existing gap test stays green, and the only symptom is two cards where
 * there should be one — which no assertion about a single gap can see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const definitions = readFileSync(
  join(process.cwd(), 'lib/business-os/gaps/definitions.ts'),
  'utf8'
);

/** One gap definition's source, from its id to the start of the next const. */
function definitionOf(id: string): string {
  const start = definitions.indexOf(`id: '${id}'`);
  expect(start).toBeGreaterThan(-1);
  const end = definitions.indexOf('\nconst ', start);
  return definitions.slice(start, end === -1 ? undefined : end);
}

describe('the two unanswered-quote gaps do not both claim the same quote', () => {
  it('both read the same statuses, which is why they must differ elsewhere', () => {
    expect(definitionOf('quote_awaiting_client')).toContain("in('status', ['sent', 'viewed'])");
    expect(definitionOf('quote_deadline_unanswered')).toContain("in('status', ['sent', 'viewed'])");
  });

  it('the deadline gap takes quotes whose deadline has not passed', () => {
    const deadline = definitionOf('quote_deadline_unanswered');

    expect(deadline).toContain("not('valid_until', 'is', null)");
    expect(deadline).toMatch(/gte\('valid_until'/);
  });

  it('the awaiting gap leaves those alone, and keeps the ones nobody else has', () => {
    const awaiting = definitionOf('quote_awaiting_client');

    /*
     * Null and already-past are deliberately KEPT: a quote with no expiry has
     * no deadline gap to own it, and a lapsed one is unowned for the window
     * between lapsing and `expireLapsedQuotes` writing the state.
     */
    expect(awaiting).toContain('valid_until.is.null');
    expect(awaiting).toContain('valid_until.lt.');
  });
});
