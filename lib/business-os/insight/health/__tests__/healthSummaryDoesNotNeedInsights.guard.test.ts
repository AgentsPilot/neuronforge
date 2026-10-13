/**
 * A business with nothing wrong still gets a health summary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Both paths that write `business_health_summaries` used to guard on
 * `allInsights.length > 0`:
 *
 *     lib/business-os/insight/repository/InsightRepository.ts  (correlateAndSummarize)
 *     app/api/cron/insight-detect/route.ts                     (the no-correlation branch)
 *
 * That guard made sense in the model it was written for, where the health score
 * WAS a function of our own detections — 100 minus severity penalties over
 * insight counts — so with no insights there was nothing to score.
 *
 * `resolveBusinessHealth` replaced that with six rates read from the module
 * tables. Its signature is `(supabase, userId, now)`: it never sees an insight.
 * The guard was left gating the new model on the old model's input, and the
 * effect was the exact inverse of anyone's intent — a business trading quietly,
 * with no detections against it, got NO row at all, so the reports page showed
 * an empty verdict and six empty rates PRECISELY BECAUSE nothing was wrong.
 *
 * It was found from the live page, not from a test, which is why one exists now.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * What has to hold is that neither call site reintroduces a count gate, and that
 * `resolveBusinessHealth` keeps taking no insights. Both are facts about the
 * code. Exercising the write path needs a database and an LLM, and the
 * arithmetic that does have rules in it is already tested behaviourally in
 * `businessHealth.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Comments may DISCUSS the old guard; only live code must not reinstate it. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CALL_SITES = [
  'lib/business-os/insight/repository/InsightRepository.ts',
  'app/api/cron/insight-detect/route.ts',
];

describe('writing a health summary does not depend on having insights', () => {
  it.each(CALL_SITES)('%s does not gate the write on an insight count', file => {
    const code = stripComments(read(file));

    // Any shape of "only write it if there are insights".
    expect(code).not.toMatch(/allInsights\s*(&&[^)]*)?\.length\s*[>!=]/);
    expect(code).not.toMatch(/insights\.length\s*>\s*0\s*\)\s*\{[\s\S]{0,200}createOrUpdateHealthSummary/);
  });

  it.each(CALL_SITES)('%s still calls createOrUpdateHealthSummary', file => {
    // Guarding against the gate is worthless if the call itself went away.
    expect(stripComments(read(file))).toContain('createOrUpdateHealthSummary');
  });

  it('resolveBusinessHealth takes no insights, so none can gate it', () => {
    const code = read('lib/business-os/insight/health/resolveBusinessHealth.ts');
    const signature = code.slice(
      code.indexOf('export async function resolveBusinessHealth'),
      code.indexOf('export async function resolveBusinessHealth') + 240
    );

    expect(signature).toContain('supabase');
    expect(signature).toContain('userId');
    // The moment this takes insights, the guard becomes defensible again and
    // this whole test should be reconsidered rather than deleted.
    expect(signature).not.toMatch(/insight/i);
  });
});
