/**
 * Who counts as a client is configurable, and asking for a column decides it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUND 2026-10-06 while verifying the maturity gate. The retention vector read
 * `dark 0/60` on an account with 31 bookings, 24 invoices and three enrolled
 * families, which is not a plausible answer.
 *
 * Both reads behind it asked for:
 *
 *   .eq('lifecycle_stage', 'client')
 *
 * THERE IS NO `lifecycle_stage` COLUMN ON `crm_contacts`. PostgREST rejects the
 * whole select for one unknown name, the error was destructured away, and both
 * reads fell through to their defaults. So `clientCount` was 0 and
 * `firstClient` was null for EVERY ACCOUNT on the platform, and the retention
 * vector was permanently dark. Nothing threw and nothing logged.
 *
 * It was invisible because a dark vector only ever skipped detectors, and a
 * skipped detector produces no output to look wrong. The gate change surfaced
 * it: once `instance` claims were held on `dark` too, two retention detectors
 * that had been finding real packages went quiet, and that was the only visible
 * symptom this bug has ever had.
 *
 * Stages are rows in `crm_pipeline_stages` carrying a `stage_type`. The
 * reporting account's keys are `family_enrolled` and `initial_consultation`:
 * a therapist vertical whose stages were never going to equal 'client'.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const repo = readFileSync(join(__dirname, '..', 'InsightRepository.ts'), 'utf8');

describe('the retention vector', () => {
  it('never filters contacts on a column that does not exist', () => {
    // The whole bug, in one string.
    expect(repo).not.toContain("lifecycle_stage', 'client'");
    expect(repo).not.toMatch(/\.eq\('lifecycle_stage'/);
  });

  it('resolves client stages through the existing shared helper', () => {
    /*
     * `buildClientStageFilter` is already used by CrmEngagementDecayDetector
     * and carries the legacy fallback for accounts whose `stage_type` is not
     * populated. A second hand-rolled resolver here is how the two surfaces
     * would come to disagree about who a client is.
     */
    expect(repo).toContain('buildClientStageFilter');
    expect(repo).toContain("import('@/lib/crm/StageTypeUtils')");
  });

  it('filters on the stage column the table actually has', () => {
    expect(repo).toMatch(/\.in\('stage', clientStageKeys\)/);
  });

  it('counts zero clients when the account has no client stage defined', () => {
    /*
     * An account mid-onboarding has no stages yet. `.in('stage', [])` matches
     * nothing, which is the right answer, but issuing the query at all is a
     * round trip to learn what the empty array already said.
     */
    expect(repo).toMatch(/clientStageKeys\.length\s*\n?\s*\?/);
    expect(repo).toContain('{ count: 0 }');
  });
});

describe('the narration prompt', () => {
  it('omits the impact line when there is no impact', () => {
    /*
     * `formatMoney` is `Number(amount) || 0`, so a real zero and an absent
     * figure print identically. The dead-link card was titled "השפעה גבוהה על
     * העסק" (high impact) above a body reading "ההשפעה הכספית היא ₪0": both
     * halves invented, in opposite directions, from the same absent number.
     */
    const prompt = repo.slice(
      repo.indexOf('Detection details:'),
      repo.indexOf('TONE & STYLE GUIDELINES')
    );

    // Sliced rather than searched whole: `describeImpact` quotes the old line
    // in its own body and doc comment, so a file-wide `not.toContain` matches
    // the fix itself and fails on correct code.
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).not.toContain('- Estimated impact: ${formatMoney(');
    expect(prompt).toContain('describeImpact(detection, businessContext.currency)');
  });

  it('sends the impact only when it is genuinely a number', () => {
    const helper = repo.slice(
      repo.indexOf('function describeImpact'),
      repo.indexOf('How long a resolved insight stays visible')
    );

    expect(helper.length).toBeGreaterThan(100);
    expect(helper).toMatch(/typeof detection\.estimatedImpactUsd !== 'number'/);
    expect(helper).toMatch(/return '';/);
  });
});
