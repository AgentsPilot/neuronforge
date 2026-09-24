/**
 * Every detector must be able to describe itself, in every language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Adding a detector means touching several places that do not fail when you
 * miss them. The registry footprint is documented, but nothing checks it — a
 * detector with no entry in `detectorDescriptions` still fires, and the owner
 * gets whatever the model invents from the raw id: `conv_no_next_step` narrated
 * as generic prose about a "conversion issue".
 *
 * Worse, the FALLBACK copy (used when the LLM is disabled for the area, or when
 * a call fails) is looked up by detector id. A missing entry there is not
 * generic prose — it is a blank card, or the raw key on screen, which is how
 * `journey.meta.total_bookings` once reached a dashboard.
 *
 * The three languages are checked together because Hebrew and Spanish are where
 * a gap shows up last: an English-speaking developer sees nothing wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { DetectorEngine } from '../../detectors/DetectorEngine';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/**
 * Read as text rather than imported.
 *
 * The copy lives in object literals inside private methods of a 3,000-line
 * repository whose constructor wants a Supabase client. Reading the source is
 * both cheaper and closer to what is being asserted: that the id appears where
 * a developer must add it.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'InsightRepository.ts'), 'utf8');

function detectorIds(): string[] {
  const engine = new DetectorEngine({} as never);
  const detectors = (engine as unknown as { detectors: Array<{ definition: { id: string } }> }).detectors;
  return detectors.map(d => d.definition.id);
}

/**
 * How many times an id appears as a key in the repository's copy tables.
 *
 * Four are needed: the description handed to the model, then the title,
 * description and recommendation fallbacks — each of which exists in an English
 * and a Hebrew table.
 */
function keyOccurrences(id: string): number {
  return (SOURCE.match(new RegExp(`^\\s*${id}:`, 'gm')) ?? []).length;
}

describe('every detector has copy', () => {
  it('describes each detector to the model', () => {
    /*
     * `detectorDescriptions` is what turns an id into a sentence the model can
     * work from. Without it the prose is written from the id alone.
     */
    const missing = detectorIds().filter(id => !SOURCE.includes(`${id}: '`) && !SOURCE.includes(`${id}: \``));

    expect(missing).toEqual([]);
  });

  it('has fallback copy for each detector, in English and Hebrew', () => {
    /*
     * Four entries minimum: the model-facing description plus title,
     * description and recommendation — and the last three exist twice, once per
     * language table. Anything below four means at least one surface would
     * render empty for somebody.
     */
    const thin = detectorIds()
      .map(id => ({ id, count: keyOccurrences(id) }))
      .filter(({ count }) => count < 4)
      .map(({ id, count }) => `${id}: appears ${count} time(s), expected at least 4`);

    expect(thin).toEqual([]);
  });
});
