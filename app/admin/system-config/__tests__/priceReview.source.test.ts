/**
 * Source rules for the new Model pricing comparison files (AI model price
 * review slice 4; SA RC-1, RC-2, RC-8). Short on purpose: the render suites
 * carry the behaviour.
 *
 * Line endings are normalised first, so a Windows checkout reads the same as CI.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');

const DIR = 'app/admin/system-config';
const NEW_FILES = [
  `${DIR}/priceReviewCopy.ts`,
  `${DIR}/priceComparisonRead.ts`,
  `${DIR}/priceTableRows.ts`,
  `${DIR}/components/PriceRowCells.tsx`,
  `${DIR}/components/ManualPriceEntryForm.tsx`,
  // Slice 5: "Check provider prices".
  `${DIR}/priceFetchRun.ts`,
  `${DIR}/components/ProviderPriceCheck.tsx`,
  // Slice 8: Apply, Dismiss and the margin prompt.
  `${DIR}/priceApply.ts`,
  `${DIR}/components/PriceDecisionPanel.tsx`,
  `${DIR}/components/MarginReviewNotice.tsx`,
];
const sources = NEW_FILES.map((file) => [file, read(file)] as const);

/** The code without comments (the `codeOf` idiom of `source.guard.test.ts`). */
function codeOf(source: string): string {
  return source.replace(/[/][*][^]*?[*][/]/g, '').replace(/(^|[^:])[/][/].*$/gm, '$1');
}

/** RC-1: the only pricing-research modules a browser file may take VALUES from. */
const VALUE_ALLOWED = ['pendingLineSchema', 'officialSources', 'lineFlags', 'bounds', 'coverageColour'];
/** RC-2: server-only modules, reachable by a whole-statement `import type` only. */
const TYPE_ONLY = ['comparisonModel', 'areaTags', 'fetchOutcomes']; // fetchOutcomes: slice 5, SA SC-14 (types only)

describe('slice 4 new files', () => {
  it.each(sources)('%s: no console, no number parsing or formatting (RC-8)', (_file, source) => {
    expect(source).not.toContain('console.');
    for (const banned of ['Number(', 'parseFloat(', 'parseInt(', 'toFixed(']) expect(source).not.toContain(banned);
  });

  it.each(sources)('%s: pricing-research imports follow RC-1 and RC-2', (_file, source) => {
    const lines = source.split('\n').filter((line) => line.includes("from '@/lib/ai/pricing-research/"));
    for (const line of lines) {
      const moduleName = line.match(/pricing-research[/]([A-Za-z]+)'/)?.[1] ?? '';
      if (TYPE_ONLY.includes(moduleName)) {
        expect(line.startsWith('import type {')).toBe(true);
      } else {
        expect(VALUE_ALLOWED).toContain(moduleName);
      }
    }
  });

  it('the files that log use the client logger', () => {
    for (const file of [
      `${DIR}/priceComparisonRead.ts`,
      `${DIR}/components/ManualPriceEntryForm.tsx`,
      `${DIR}/priceFetchRun.ts`,
      `${DIR}/components/ProviderPriceCheck.tsx`,
      `${DIR}/priceApply.ts`,
    ]) {
      expect(read(file)).toContain("import { clientLogger } from '@/lib/logger/client';");
    }
  });

  it('each model-pricing route is named in exactly one file, and the page names none', () => {
    const count = (needle: string) => sources.filter(([, source]) => source.includes(needle)).map(([file]) => file);
    expect(count('/api/admin/model-pricing/comparison')).toEqual([`${DIR}/priceComparisonRead.ts`]);
    expect(count('/api/admin/model-pricing/manual-entries')).toEqual([`${DIR}/components/ManualPriceEntryForm.tsx`]);
    expect(count('/api/admin/model-pricing/fetch-runs')).toEqual([`${DIR}/priceFetchRun.ts`]);
    expect(count('/api/admin/model-pricing/apply')).toEqual([`${DIR}/priceApply.ts`]);
    expect(count('/api/admin/model-pricing/dismiss')).toEqual([`${DIR}/priceApply.ts`]);
    for (const [, source] of sources) {
      const apis = codeOf(source).match(/[/]api[/][a-z0-9/-]+/g) ?? [];
      for (const api of apis) expect(api.startsWith('/api/admin/model-pricing/')).toBe(true);
    }
    expect(codeOf(read(`${DIR}/page.tsx`))).not.toContain('/api/admin/model-pricing');
  });

  it('slice 5: the page renders the price check once, and a stored check re-reads the table silently', () => {
    // The page suites replace the component with a stand-in (speed), so the wiring is pinned here.
    const page = codeOf(read(`${DIR}/page.tsx`));
    expect(page).toContain("import ProviderPriceCheck from '@/app/admin/system-config/components/ProviderPriceCheck';");
    expect(page.match(/<ProviderPriceCheck/g)).toHaveLength(1);
    // Intent kept; page layout slice (UF-7): `onStatus` hands the page the status this component already read (the Last provider check KPI).
    expect(page.replace(/[ \n]+/g, ' ')).toContain('<ProviderPriceCheck onFinished={() => { void fetchData(true); }} onStatus={setCheckStatus} />');
  });

  it('slice 8 (SA O-18): only priceApply.ts sends a write; the panel and the notice post through it', () => {
    const writers = sources.filter(([, source]) => /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/.test(codeOf(source))).map(([file]) => file);
    expect(writers.sort()).toEqual([`${DIR}/components/ManualPriceEntryForm.tsx`, `${DIR}/priceApply.ts`, `${DIR}/priceFetchRun.ts`].sort());
    for (const file of [`${DIR}/components/PriceDecisionPanel.tsx`, `${DIR}/components/MarginReviewNotice.tsx`]) {
      const source = codeOf(read(file));
      expect({ file, fetches: /(?<![A-Za-z0-9_])fetch[(]/.test(source) }).toEqual({ file, fetches: false });
      expect(source).toContain("from '@/app/admin/system-config/priceApply'");
    }
  });

  it('slice 8 (RR-2, RR-5): the reason pre-fill is built in the page; the override field is never pre-filled', () => {
    expect(read(`${DIR}/priceApply.ts`)).toContain('return `Provider price change — source ${sourceUrl} (checked ${checkedOn})`;');
    const panel = codeOf(read(`${DIR}/components/PriceDecisionPanel.tsx`));
    expect(panel).toContain('prefilledReason(line.sourceUrl, line.checkedOn)');
    expect(panel).toContain("value={overrides[line.lineId] ?? ''}");
    expect(panel).not.toMatch(/setOverrides[(][^)]*prefilledReason/);
  });

    it('no raw .json( read: bodies go through readJsonBody or readAdminResponse', () => {
    for (const [, source] of sources) expect(source).not.toContain('.json(');
  });
});
