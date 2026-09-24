/**
 * A correlation pattern that cannot match is a pattern nobody will ever notice
 * is broken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three of the ten shipped with ONE entry in `requiredDetectors` and
 * `minMatches: 2`. `checkPattern` counts matches against the required list
 * only, so `matchedRequired.length` can never exceed that list's length: those
 * three could not fire, ever, on any data. `patternsChecked` still counted
 * them, so the engine reported ten patterns checked and could only ever produce
 * seven.
 *
 * The same three also referenced placeholders no detector could fill —
 * `{page_issue}` named a detector replaced during the 2026-09 rebuild,
 * `{cards_issue}` and `{discount_issue}` named detectors absent from their own
 * pattern's lists. Unfilled placeholders are stripped by a regex, so the story
 * would have read "Cash flow problems are developing.  and ." had it ever run.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CORRELATION_PATTERNS } from '../patterns';
import { DetectorEngine } from '../../detectors/DetectorEngine';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/** Placeholders the engine fills from something other than a detector. */
const ENGINE_PROVIDED = new Set(['optional_context', 'total_impact']);

/**
 * Which detector-id fragments fill which placeholder.
 *
 * Transcribed from the `includes(...)` chain in
 * `InsightCorrelationEngine.buildStory`. Kept explicit rather than inferred
 * from the placeholder name, because the two do not match: `{rebooking_issue}`
 * is filled by `ret_repeat_booking_low`, and `{cta_issue}` by
 * `web_missing_cta`. Guessing produced a false failure on a pattern that was
 * perfectly correct.
 *
 * If a placeholder is added to a story, add its fragment here — that is the
 * point of the test, and the mapping is otherwise invisible.
 */
const FILLED_BY: Record<string, string[]> = {
  traffic_issue: ['traffic'],
  conversion_issue: ['conversion'],
  cold_leads_issue: ['cold_leads'],
  ar_issue: ['ar_overdue'],
  aging_issue: ['ar_aging'],
  payment_issue: ['payment_issues'],
  engagement_issue: ['engagement'],
  rebooking_issue: ['repeat_booking', 'rebooking'],
  stuck_deals_issue: ['pipeline_stuck'],
  utilization_issue: ['utilization'],
  cancellation_issue: ['cancellation_spike'],
  last_minute_issue: ['last_minute'],
  cta_issue: ['missing_cta'],
  page_issue: ['page_underperform', 'page_no_conversions'],
  cards_issue: ['cards_expiring'],
  discount_issue: ['discount'],
  intro_issue: ['intro_offer'],
  service_issue: ['service_performance'],
  peak_issue: ['peak_unutilized'],
};

function registeredDetectorIds(): Set<string> {
  const engine = new DetectorEngine({} as never);
  const detectors = (engine as unknown as { detectors: Array<{ definition: { id: string } }> }).detectors;
  return new Set(detectors.map(d => d.definition.id));
}

describe('correlation patterns', () => {
  it('never asks for more matches than it has required detectors', () => {
    const impossible = CORRELATION_PATTERNS
      .filter(p => p.minMatches > p.requiredDetectors.length)
      .map(p => `${p.id}: needs ${p.minMatches} of ${p.requiredDetectors.length} required`);

    expect(impossible).toEqual([]);
  });

  it('names only detectors that are registered', () => {
    const known = registeredDetectorIds();

    const missing = CORRELATION_PATTERNS.flatMap(p =>
      [...p.requiredDetectors, ...(p.optionalDetectors ?? [])]
        .filter(id => !known.has(id))
        .map(id => `${p.id}: ${id} is not registered`)
    );

    expect(missing).toEqual([]);
  });

  it('has no literal currency symbol in a story', () => {
    /*
     * `'Total exposure: ${total_impact}.'` — a single-quoted string, so `${...}`
     * is literal text, and `{total_impact}` is separately replaced with
     * `formatCurrency` output which already carries the locale's symbol. An
     * Israeli business read "Total exposure: $₪12,340."
     */
    const withSymbol = CORRELATION_PATTERNS
      .filter(p => /[$£€₪]/.test(p.storyTemplate) || /[$£€₪]/.test(p.actionTemplate))
      .map(p => p.id);

    expect(withSymbol).toEqual([]);
  });

  it('uses no placeholder its own detectors cannot fill', () => {
    /*
     * Every `{name}` in a story has to be fillable, either by the engine or by
     * a detector this pattern actually lists. The engine strips what it cannot
     * fill, so the failure is a sentence with a hole in it rather than an error.
     */
    const orphans: string[] = [];

    for (const pattern of CORRELATION_PATTERNS) {
      const placeholders = [...pattern.storyTemplate.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]);
      const available = [...pattern.requiredDetectors, ...(pattern.optionalDetectors ?? [])].join(' ');

      for (const name of placeholders) {
        if (ENGINE_PROVIDED.has(name)) continue;

        const fragments = FILLED_BY[name];
        if (!fragments) {
          orphans.push(`${pattern.id}: {${name}} is not filled by anything in buildStory`);
          continue;
        }

        if (!fragments.some(fragment => available.includes(fragment))) {
          orphans.push(`${pattern.id}: {${name}} needs a detector matching ${fragments.join('/')}, which this pattern does not list`);
        }
      }
    }

    expect(orphans).toEqual([]);
  });
});
