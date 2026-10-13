/**
 * Every way the website produces a lead is counted as one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `acq_low_conversion` counted `source = 'website_form'` and nothing else, so
 * a visitor who booked straight off the page was indistinguishable from one who
 * closed the tab. Booking is what the product is built around, and three
 * production routes write `website_booking`:
 *
 *     app/api/website/booking/create/route.ts
 *     app/api/website/booking/confirm/route.ts
 *     app/api/website/booking/finalize/route.ts
 *
 * against one that writes `website_form`. So the detector was blind to the
 * majority route by construction, and the insight it produced said the opposite
 * of the truth: a site converting well read as converting nobody, scored
 * `critical`, with a money figure on it, once a week forever.
 *
 * `quote_unwritten` in `lib/business-os/gaps/definitions.ts` was broken by the
 * same column and its note is worth keeping in view: a source filter that omits
 * `website_booking` does not narrow a finding, it inverts it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * What has to hold is which values the filter contains and that an early return
 * exists. Both are facts about the code rather than about any return value, and
 * the surrounding query needs a database to exercise. The arithmetic that does
 * have rules in it is tested behaviourally in
 * `websiteConversionIsCountedWhole`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { WEBSITE_CONVERSION_SOURCES } from '@/lib/business-os/insight/detectors/catalog/AcqLowConversionDetector';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const detector = read('lib/business-os/insight/detectors/catalog/AcqLowConversionDetector.ts');

describe('the sources counted as a website conversion', () => {
  it('includes booking, the route that was missing', () => {
    expect(WEBSITE_CONVERSION_SOURCES).toContain('website_booking');
  });

  it('still includes the form routes it always counted', () => {
    expect(WEBSITE_CONVERSION_SOURCES).toContain('website_form');
    expect(WEBSITE_CONVERSION_SOURCES).toContain('conversion_page');
  });

  it('excludes a newsletter signup, which is a subscriber and not a lead', () => {
    /*
     * The contact form route routes `newsletter` to the subscriber table and
     * returns before any contact exists, having been fixed once for filing a
     * subscriber as a lead and chasing them for a message they never sent.
     * Counting them here would re-import that confusion as a conversion.
     */
    expect(WEBSITE_CONVERSION_SOURCES).not.toContain('newsletter');
  });

  it('excludes the other channels, which are not the website converting', () => {
    for (const source of ['instagram', 'whatsapp', 'in_person', 'manual']) {
      expect(WEBSITE_CONVERSION_SOURCES).not.toContain(source);
    }
  });
});

describe('the detector uses the list', () => {
  it('filters on it rather than on a single source', () => {
    expect(detector).toMatch(/\.in\('source', WEBSITE_CONVERSION_SOURCES/);
    expect(detector).not.toMatch(/\.eq\('source', 'website_form'\)/);
  });

  it('keeps the breakdown instead of only the total', () => {
    /*
     * A bare "2% convert" sends an owner to look at a form. "18 booked, 1
     * enquired" tells them the site already works and where, which is a
     * different action. The percentage is only answerable with the split.
     */
    expect(detector).toMatch(/conversions_by_source: bySource/);
  });

  it('counts visitors through the shared helper, not its own query', () => {
    /*
     * Owner views, account scope, session identity and the row bound all live
     * in `resolveUniqueVisitors`. A second implementation drifts, and the drift
     * shows up as two insights disagreeing about the same traffic.
     */
    expect(detector).toMatch(/await this\.resolveUniqueVisitors\(userId, 30\)/);
    expect(detector).not.toMatch(/from\('website_page_views'\)/);
    expect(detector).not.toMatch(/\.eq\('subdomain', subdomain\)/);
  });

  it('refuses to divide by a visitor count it could not establish', () => {
    expect(detector).toMatch(/uniqueVisitors === null \|\| uniqueVisitors < this\.definition\.minSamples/);
  });
});

describe('it does not fire with nothing to say', () => {
  it('returns before reporting zero missed leads', () => {
    /*
     * The benchmark is floored, so just under the threshold rounds to the count
     * the site already achieved: 51 visitors with 1 lead is 1.96%, and 2% of 51
     * floors to 1. That produced a card with a severity on it reporting that
     * nothing had been missed.
     */
    expect(detector).toMatch(/if \(missedSubmissions < 1\) \{/);
  });
});

describe('it is named for what it measures', () => {
  it('reports a website conversion rate, not a form conversion rate', () => {
    expect(detector).toMatch(/metricKey: 'acquisition\.website_conversion_rate'/);
    expect(detector).toMatch(/watchedMetrics: \['acquisition\.website_conversion_rate'\]/);
  });

  it('keeps the detector id, which stored rows and correlations refer to', () => {
    /*
     * `acq_low_conversion` appears in three locale blocks, two correlation
     * patterns and every insight row ever written for it. The measurement was
     * wrong; its identity was not.
     */
    expect(detector).toMatch(/id: 'acq_low_conversion'/);
  });
});
