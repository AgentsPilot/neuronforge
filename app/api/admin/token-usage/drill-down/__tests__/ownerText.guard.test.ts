/**
 * Source guard — ADMIN_BOS_CLEANUP slice 3 (C3-9, W3-1).
 *
 * The AI cost execution detail is a cross-account admin view, so it is
 * metadata only (requirement §8). These names must not appear anywhere in the
 * route or the page, comments included, so a partial revert that brings any
 * owner text back fails here.
 *
 * Jest is a required check on main, so this guard runs on every PR.
 *
 * Admin Layout Standard L-2a: the page is split into several files (types,
 * filters, KPI strip, filter bar), so G-2 and G-3 read EVERY non-test source
 * file under `app/admin/analytics/` (walked, so a file added later is covered
 * before anyone remembers this guard). Strengthening only.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ROUTE = 'app/api/admin/token-usage/drill-down/route.ts';
const PAGE = 'app/admin/analytics/page.tsx';
const PAGE_DIR = 'app/admin/analytics';

/** Every non-test .ts / .tsx file under the page folder, as repo-relative forward-slash paths. */
function pageSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...pageSources(rel));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

describe('owner text stays out of the AI cost drill-down', () => {
  const route = read(ROUTE);
  const page = read(PAGE);
  const files = pageSources(PAGE_DIR);
  const pageFiles = files.map((file) => ({ file, source: read(file) }));

  /** The files under the page folder that name `name` (expected: none). */
  const naming = (name: string) => pageFiles.filter(({ source }) => source.includes(name)).map(({ file }) => file);

  it.each(['input_data', 'user_prompt'])('G-1: route.ts never names %s', (name) => {
    expect(route).not.toContain(name);
  });

  it.each(['userPrompt', 'inputData'])('G-2: no page file names %s', (name) => {
    expect(naming(name)).toEqual([]);
  });

  it.each(['output_data', 'system_prompt', 'pilot_steps', 'input_schema', 'output_schema'])(
    'G-3: route.ts never names %s',
    (name) => {
      expect(route).not.toContain(name);
    }
  );

  it.each(['outputData', 'systemPrompt', 'pilotSteps', 'inputSchema', 'outputSchema'])(
    'G-3: no page file names %s',
    (name) => {
      expect(naming(name)).toEqual([]);
    }
  );

  it.each(['workflow_step_executions', 'step_name'])('G-4: the retired step-name lookup stays retired (%s)', (name) => {
    expect(route).not.toContain(name);
  });

  it('reads the real files (the guard cannot pass on an empty read)', () => {
    expect(route).toContain('export async function GET');
    expect(page).toContain('export default function AdminCostAnalytics');
  });

  it('the walk finds the page and its split files, and no test file (L-2a, L-2b)', () => {
    for (const file of [
      PAGE,
      'app/admin/analytics/analyticsTypes.ts',
      'app/admin/analytics/analyticsFilters.ts',
      'app/admin/analytics/analyticsCall.ts',
      'app/admin/analytics/components/AnalyticsKpis.tsx',
      'app/admin/analytics/components/AnalyticsFilterBar.tsx',
      'app/admin/analytics/components/AnalyticsTable.tsx',
      'app/admin/analytics/components/AnalyticsCallDetails.tsx',
      'app/admin/analytics/components/AnalyticsExecutionCard.tsx',
      'app/admin/analytics/components/AnalyticsSummaryCards.tsx',
    ]) {
      expect(files).toContain(file);
    }
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((file) => file.includes('__tests__') || /\.test\.tsx?$/.test(file))).toBe(false);
  });
});
