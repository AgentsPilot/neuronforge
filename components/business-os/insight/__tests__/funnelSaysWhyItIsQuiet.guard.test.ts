/**
 * The funnel must say why it has nothing to say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-09-28: an insight card said one contact was stuck
 * in the pipeline, and the diagram marked nothing anywhere. Both were correct.
 *
 *   `conv_pipeline_stuck` has `minSamples: 1`. One named person sitting in a
 *   stage for 20 days is true at a sample of one.
 *
 *   `resolveGap` returns `setup` while the site is a draft and `tooEarly` below
 *   `MIN_TO_JUDGE` of five, because a conversion rate from four people is
 *   noise. Neither draws as a leak, and on that account EVERY connector was in
 *   one of those two states.
 *
 * Two defensible rules, one incoherent screen. Three things were changed and
 * these hold them:
 *
 *   1. Every verdict gets a label, so a dashed connector explains itself
 *      instead of saying nothing at all.
 *   2. A stuck person is marked on the STATION, which counts named people and
 *      is honest at one, never on the connector, which is a rate.
 *   3. The five-person floor did not move, and must not.
 *
 * A SOURCE-LEVEL GUARD, because the labels live inside a `useMemo` in a
 * 2,500-line client component that would need the whole dashboard mounted.
 * Same approach as `bookedThisWeek.guard.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { MIN_TO_JUDGE, resolveGap, gapStateFor } from '@/lib/business-os/insight/funnelGap';

const dashboard = readFileSync(
  join(__dirname, '..', 'LiveDashboard.tsx'),
  'utf8'
);

/** The `funnelGaps` memo, where a verdict becomes a connector label. */
const labelBlock = dashboard.slice(
  dashboard.indexOf('const funnelGaps'),
  dashboard.indexOf('const tips')
);

/** The `tips` memo, where a marker is pinned to a station. */
const tipsBlock = dashboard.slice(
  dashboard.indexOf('const tips'),
  dashboard.indexOf('/** Says which period a number covers')
);

describe('a connector that cannot judge', () => {
  it.each([
    ['setup', 'gap.setup'],
    ['empty', 'gap.empty'],
    ['tooEarly', 'gap.tooEarly'],
    ['watching', 'gap.watchConversion'],
  ])('explains itself when the verdict is %s', (verdict, key) => {
    /*
     * `setup` and `empty` had no branch at all, so they drew as a dashed line
     * with nothing written on it. That was every connector on the reporting
     * account, which is why the diagram read as broken rather than as waiting.
     */
    expect(labelBlock).toContain(`verdict.kind === '${verdict}'`);
    expect(labelBlock).toContain(key);
  });

  it('still reports a leak as a count of people, not a rate', () => {
    expect(labelBlock).toContain('verdict.dropped');
    expect(labelBlock).toContain('gap.dropped');
  });
});

describe('the five-person floor', () => {
  it('has not moved', () => {
    /*
     * The tempting fix for the reported bug was to lower this so one stuck
     * person could light a connector. One person out of one leaving is not a
     * 100% drop-off rate, and that mistake has been made here before.
     */
    expect(MIN_TO_JUDGE).toBe(5);
  });

  it('keeps a single stuck person out of the leak state', () => {
    // One upstream, none downstream: the worst-looking possible ratio.
    const verdict = resolveGap({ count: 1, window: 'pipeline' }, { count: 0, window: 'pipeline' }, true);

    expect(verdict.kind).toBe('tooEarly');
    expect(gapStateFor(verdict)).not.toBe('leak');
  });

  it('keeps a draft site out of every state but off', () => {
    // Four people, nobody progressing, and still nothing claimed: not live.
    const verdict = resolveGap({ count: 40, window: 'pipeline' }, { count: 1, window: 'pipeline' }, false);

    expect(verdict.kind).toBe('setup');
    expect(gapStateFor(verdict)).toBe('off');
  });
});

describe('the stuck-contact marker', () => {
  it('is pinned to the station, not to the connector', () => {
    /*
     * `at: stageKey`. A station marker counts named people and is true at one;
     * a connector is a rate and is not. Pinning this to a gap key would be the
     * reported bug reintroduced from the other direction.
     */
    expect(tipsBlock).toContain('conv_pipeline_stuck');
    expect(tipsBlock).toContain('at: stageKey');
  });

  it('reads PENDING insights only', () => {
    /*
     * A resolved stuck-insight must leave no marker behind. The card already
     * made this mistake — it rendered a resolved insight identically to a live
     * one — and a stale badge on the diagram would be the same fault in a
     * second place.
     */
    expect(tipsBlock).toContain('pendingInsights.find');
    expect(tipsBlock).not.toContain('resolvedInsights');
  });

  it('skips a stage the map does not draw', () => {
    // A pipeline the owner has since renamed would otherwise pin a badge to a
    // station that is not there.
    expect(tipsBlock).toContain('funnelNodes.find');
    expect(tipsBlock).toContain('if (!node) continue;');
  });
});

describe('a resolved insight', () => {
  const card = readFileSync(join(__dirname, '..', 'InsightAdvisorCard.tsx'), 'utf8');

  it('says so where the owner reads, not only on a button', () => {
    /*
     * `isResolved` used to change the secondary button's label and nothing
     * else, so "1 contact stuck in your pipeline" looked identical whether it
     * was happening now or had been dealt with yesterday. That is what sent
     * the owner to the pipeline diagram looking for a leak.
     */
    expect(card).toContain('insight.badge.resolved');
  });

  it('still refuses to offer an action on something settled', () => {
    expect(card).toContain('const canRun = !isResolved');
  });
});
