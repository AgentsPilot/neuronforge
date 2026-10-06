/**
 * What the narrator is told a number IS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-10-05, looking at four cards on their dashboard.
 * Every one of them was wrong in the same way, and the model was not at fault:
 *
 *   ops_service_performance     currentValue 2  (services)  → "₪2 עלולים להפסיד ₪340"
 *   cash_refund_pattern         currentValue 25 (per cent)  → "שיעור החזרות גבוה של 25 ₪"
 *   cash_cancelled_unrefunded   currentValue 2  (bookings)  → "₪2 לא הוחזרו" beside a real ₪150
 *
 * One line in the prompt did it:
 *
 *   - Amount involved: ${formatMoney(detection.currentValue, currency)}
 *
 * `currentValue` is whatever its own metric counts. The prompt asserted it was
 * money for all forty-four detectors, and the model wrote money because it was
 * told money.
 *
 * The rule now: a figure whose unit nobody declared is NOT SENT. An unlabelled
 * number the model has to guess the unit of is worse than one it never saw,
 * and `affectedCount` and `estimatedImpactUsd` are unambiguous by construction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const repo = readFileSync(join(__dirname, '..', 'InsightRepository.ts'), 'utf8');
const CATALOG = join(__dirname, '..', '..', 'detectors', 'catalog');

describe('the narration prompt', () => {
  it('no longer calls every metric an amount of money', () => {
    /*
     * The exact line that produced all three cards. If it comes back, so do
     * they.
     */
    expect(repo).not.toContain(
      '- Amount involved: ${formatMoney(detection.currentValue'
    );
  });

  it('routes the figure through the labelling helper instead', () => {
    expect(repo).toContain('describeCurrentValue(detection, businessContext.currency)');
  });

  it('sends nothing at all when the unit was never declared', () => {
    /*
     * The default branch is the whole safety property. A fallback that printed
     * the bare number would still leave the model guessing, and it guessed
     * currency last time.
     */
    const helper = repo.slice(
      repo.indexOf('function describeCurrentValue'),
      repo.indexOf('const OPEN_STATUSES')
    );

    expect(helper).toMatch(/default:\s*\n\s*return '';/);
  });

  it('tells the model in words that a rate is not money', () => {
    // "25" with a currency symbol beside it is what an owner read. The unit
    // alone was not enough; the prompt says it outright.
    const helper = repo.slice(
      repo.indexOf('function describeCurrentValue'),
      repo.indexOf('const OPEN_STATUSES')
    );

    expect(helper).toMatch(/percentage, never an amount of money/);
    expect(helper).toMatch(/not money/);
  });

  it('passes the detector\'s own subject through when there is one', () => {
    /*
     * "One link you share does not open" — which link? The code, the name and
     * the click count were in `processParameters` and never reached the model.
     */
    expect(repo).toContain('detection.narrationSubject');
  });
});

describe('the detectors behind the four reported cards', () => {
  const unitOf = (file: string): string | null => {
    const source = readFileSync(join(CATALOG, file), 'utf8');
    return source.match(/currentValueUnit:\s*'(\w+)'/)?.[1] ?? null;
  };

  it.each([
    ['OpsServicePerformanceDetector.ts', 'count'],
    ['CashRefundPatternDetector.ts', 'percent'],
    ['CashCancelledUnrefundedDetector.ts', 'count'],
    ['WebLinkDeadDestinationDetector.ts', 'count'],
  ])('%s declares its figure as %s', (file, unit) => {
    expect(unitOf(file)).toBe(unit);
  });

  it('lets the dead-link card name the link', () => {
    const source = readFileSync(join(CATALOG, 'WebLinkDeadDestinationDetector.ts'), 'utf8');

    expect(source).toContain('narrationSubject');
    // The owner's own words for the link, not the opaque code alone.
    expect(source).toMatch(/b\.link\.name/);
  });
});

describe('every other detector', () => {
  /*
   * Not a requirement that they all declare one — omitting it is the safe
   * answer and most metrics are counts the card does not need. This records
   * which have been through the question, so the next person can see the sweep
   * is incomplete rather than assuming it was finished.
   */
  it('either declares a unit or is silently omitted, never guessed', () => {
    const files = readdirSync(CATALOG).filter(f => f.endsWith('Detector.ts') && f !== 'BaseDetector.ts');

    const declared = files.filter(file =>
      /currentValueUnit:/.test(readFileSync(join(CATALOG, file), 'utf8'))
    );

    // The four above. When the sweep continues this number goes up, and the
    // only thing that must never happen is the prompt guessing again — which
    // the `default: return ''` case above is what prevents.
    expect(declared.length).toBeGreaterThanOrEqual(4);
    expect(files.length).toBeGreaterThan(40);
  });
});
