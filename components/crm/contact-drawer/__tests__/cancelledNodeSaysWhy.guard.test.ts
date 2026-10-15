/**
 * The node that announces a cancellation says why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The journey's closing step drew "הזמנה בוטלה" over an empty body. The reason
 * was on the row and shown once, in the badge row at the top of the card — but
 * that is the card's header, not the journey, and the journey is where someone
 * reads what happened in order. The step whose whole job is to announce the
 * cancellation was the one place not saying why.
 *
 * On a product it is worse than on a meeting: `scheduleFact` gives a cancelled
 * APPOINTMENT a line to fall back on (its hours, still true if no longer the
 * point), and a purchase has no schedule at all — so the closing card was
 * reliably empty exactly where there was least other context.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * This is computed inside the per-step map of a ~4,800-line component with no
 * seam to render one card through, and it depends on `t`. What is protected is
 * that the fallback LADDER stays intact and keeps matching the badge row's —
 * two places deriving the same sentence is how they came to disagree before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** Comments quote the strings under test; assertions must not read them. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const block = (() => {
  const start = code.indexOf('const cancelledOutcomeFact =');
  const end = code.indexOf('const stepTitle =', start);
  return code.slice(start, end);
})();

describe('the comment stripping works', () => {
  it('removes prose naming the fallback', () => {
    expect(SOURCE).toContain('an empty line reads as data still loading');
    expect(code).not.toContain('an empty line reads as data still loading');
  });

  it('and the block was actually found', () => {
    expect(block).toContain('cancelledOutcomeFact');
    expect(block.length).toBeGreaterThan(80);
  });
});

describe('it only speaks on the closing step of a cancelled booking', () => {
  it('is scoped to the final step', () => {
    expect(block).toContain('isFinalStep');
  });

  it('covers a no-show as well as a cancellation', () => {
    /* Both are "this did not happen", and the owner's reason is recorded the
       same way for each. */
    expect(block).toContain("booking.status === 'cancelled'");
    expect(block).toContain("booking.status === 'no_show'");
  });
});

describe('the fallback ladder, in order', () => {
  it('prefers the countable code', () => {
    expect(block).toContain('t(cancelReasonKey(booking.cancel_reason))');
  });

  it('falls back to the older free text, with the client prefix stripped', () => {
    /*
     * Shown raw, `cancellation_reason` puts the stored English
     * `CLIENT_CANCELLED_PREFIX` in front of a Hebrew-speaking owner. The badge
     * row splits it for that reason; so must this.
     */
    expect(block).toContain('splitClientCancellationReason(booking.cancellation_reason)');
    expect(block).toContain('.note');
  });

  it('never ends on nothing', () => {
    /* The whole point. An empty line reads as data still loading. */
    expect(block).toContain("t('crm.activity.desc.no_reason')");
    expect(block).toContain("'No reason given'");
  });

  it('reuses the existing key rather than adding a duplicate', () => {
    const he = readFileSync(join(process.cwd(), 'lib/business-os/translations/he.ts'), 'utf8');
    const en = readFileSync(join(process.cwd(), 'lib/business-os/translations/en.ts'), 'utf8');

    /* Exactly one definition each — a second would shadow the first silently. */
    expect(he.match(/'crm\.activity\.desc\.no_reason':/g)).toHaveLength(1);
    expect(en.match(/'crm\.activity\.desc\.no_reason':/g)).toHaveLength(1);
  });
});

describe('it reaches the card', () => {
  it('feeds the card fact, which is what decides the body exists', () => {
    /*
     * `hasCardBody` is computed from `cardFact`. A step with neither a fact nor
     * a block has no body at all — which is literally the empty box.
     */
    const fact = code.slice(code.indexOf('const cardFact ='), code.indexOf('const hasCardBody'));

    expect(fact).toContain('cancelledOutcomeFact ||');
  });

  it('sits ABOVE scheduleFact, not below it', () => {
    /*
     * Order is the assertion. A cancelled meeting still has hours, and they are
     * no longer what the reader needs; below `scheduleFact` this line would
     * never show on the one shape that does have a schedule.
     */
    const fact = code.slice(code.indexOf('const cardFact ='), code.indexOf('const hasCardBody'));

    expect(fact.indexOf('cancelledOutcomeFact')).toBeLessThan(fact.indexOf('scheduleFact'));
  });

  it('does not displace a step that brought its own details', () => {
    /* `step.details` is the step's own fact and still wins — the intake status
       line, the confirmation subject, the amount. */
    const fact = code.slice(code.indexOf('const cardFact ='), code.indexOf('const hasCardBody'));

    expect(fact.indexOf('step.details')).toBeLessThan(fact.indexOf('cancelledOutcomeFact'));
  });
});
