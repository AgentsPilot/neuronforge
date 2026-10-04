/**
 * Source guard — ADMIN_BOS_CLEANUP slice 3 (C3-9, W3-1).
 *
 * The AI cost execution detail is a cross-account admin view, so it is
 * metadata only (requirement §8). These names must not appear anywhere in the
 * route or the page, comments included, so a partial revert that brings any
 * owner text back fails here.
 *
 * Limit: no CI workflow runs Jest yet, so this guard bites in local runs and at
 * review only (follow-up for the test-tiering cycle).
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ROUTE = 'app/api/admin/token-usage/drill-down/route.ts';
const PAGE = 'app/admin/analytics/page.tsx';

describe('owner text stays out of the AI cost drill-down', () => {
  const route = read(ROUTE);
  const page = read(PAGE);

  it.each(['input_data', 'user_prompt'])('G-1: route.ts never names %s', (name) => {
    expect(route).not.toContain(name);
  });

  it.each(['userPrompt', 'inputData'])('G-2: page.tsx never names %s', (name) => {
    expect(page).not.toContain(name);
  });

  it.each(['output_data', 'system_prompt', 'pilot_steps', 'input_schema', 'output_schema'])(
    'G-3: route.ts never names %s',
    (name) => {
      expect(route).not.toContain(name);
    }
  );

  it.each(['outputData', 'systemPrompt', 'pilotSteps', 'inputSchema', 'outputSchema'])(
    'G-3: page.tsx never names %s',
    (name) => {
      expect(page).not.toContain(name);
    }
  );

  it.each(['workflow_step_executions', 'step_name'])('G-4: the retired step-name lookup stays retired (%s)', (name) => {
    expect(route).not.toContain(name);
  });

  it('reads the real files (the guard cannot pass on an empty read)', () => {
    expect(route).toContain('export async function GET');
    expect(page).toContain('export default function AdminCostAnalytics');
  });
});
