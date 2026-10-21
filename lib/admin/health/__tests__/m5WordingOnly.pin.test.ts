/**
 * Money M-5, Pin D (AC-197, AC-198, SA-WP-M5 M5-R4): the FU-M4-1 rewording
 * (S-14 to S-17) is wording only.
 *
 * Written FIRST and run green on the unchanged tree (98735db9), then never
 * edited again. Its SHA-256 is recorded in the M-5 workplan's Implementation
 * Notes at Step 0 and at handover; the two must be equal.
 *
 * Each part hashes a structure with its words blanked, so a description or a
 * label may change and nothing else may:
 *   1. every Health rule (ids, priorities, colours, conditions, thresholds,
 *      factors, floors), descriptions blanked;
 *   2. every metric (ids and units), labels blanked; the flag labels and the
 *      tile vocabulary whole (M-5 does not reword them);
 *   3. the credit leak check cron entry (id, path, schedule, cadence, limits,
 *      count keys and paths), its description and count labels blanked.
 */

import { createHash } from 'crypto';

import { BOS_CRON_JOBS } from '@/lib/cron/bosCronJobs';
import { FLAG_LABELS, HEALTH_RULES, METRIC_LABELS, TILE_VOCABULARY } from '@/lib/admin/health/rules';

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** Recorded at Step 0 on 98735db9. */
const RULES_SHA256 = 'a441873a1adcca729ebe190d15ff1654d50debb09380fb050832dd2ce3c57b35';
const METRICS_SHA256 = 'bb069b70fab03a7425048c03215e9803d31c9d1d2ffacaea6b7f466f41380e13';
const CRON_SHA256 = '888a56495e7fceaf7a5fab66f82c67ec462831b592241c10081362fbc61bdd0a';

const rulesShape = () =>
  Object.fromEntries(
    Object.entries(HEALTH_RULES).map(([tile, rules]) => [
      tile,
      (rules as ReadonlyArray<{ description: string }>).map((rule) => ({ ...rule, description: '' })),
    ])
  );

const metricsShape = () => ({
  metrics: Object.fromEntries(Object.entries(METRIC_LABELS).map(([id, spec]) => [id, { ...spec, label: '' }])),
  flags: FLAG_LABELS,
  vocabulary: TILE_VOCABULARY,
});

const cronShape = () => {
  const job = BOS_CRON_JOBS.find((entry) => entry.id === 'credit-leak-check');
  expect(job).toBeDefined();
  return { ...job, description: '', counts: job?.counts?.map((count) => ({ ...count, label: '' })) };
};

describe('Pin D: M-5 changes words only (AC-197, AC-198)', () => {
  it('1. the Health rules, descriptions blanked', () => {
    expect(sha256(rulesShape())).toBe(RULES_SHA256);
  });

  it('2. the metrics (labels blanked), the flag labels and the tile vocabulary', () => {
    expect(sha256(metricsShape())).toBe(METRICS_SHA256);
  });

  it('3. the credit leak check cron entry, description and count labels blanked', () => {
    expect(sha256(cronShape())).toBe(CRON_SHA256);
  });

  it('control: a one-character factor change is caught', () => {
    const planted = rulesShape() as Record<string, Array<Record<string, unknown>>>;
    const first = planted.bos_ai_spend[1];
    planted.bos_ai_spend[1] = { ...first, condition: { ...(first.condition as object), factor: 2.9 } };
    expect(sha256(planted)).not.toBe(RULES_SHA256);
  });
});
