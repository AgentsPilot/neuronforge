/**
 * Every pair of detectors that can collide has been thought about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Forty-four detectors, and nothing used to stop two of them putting the same
 * contact on the dashboard twice. It happened on a live account before anyone
 * noticed, and it was noticed by the owner rather than by us.
 *
 * The signal that two detectors can collide is that they watch the SAME
 * METRIC. This reads the catalogue, finds every metric claimed more than once,
 * and insists each of those pairs appears in exactly one of two declarations:
 *
 *   OVERLAP_GROUPS        one card wins, the other stands down
 *   DELIBERATELY_SEPARATE both cards are correct and must both show
 *
 * Either is a fine answer. Silence is not, and silence is what the default
 * used to be: adding a detector that shared a metric with an existing one
 * changed the dashboard for every business and needed no decision from anyone.
 *
 * A SOURCE-LEVEL GUARD, because `watchedMetrics` lives on a class property
 * inside forty-four files that each want a Supabase client to instantiate.
 * Reading the declarations is enough to prove the pair was considered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { OVERLAP_GROUPS, DELIBERATELY_SEPARATE } from '../overlappingInsights';

const CATALOG = join(__dirname, '..', '..', 'detectors', 'catalog');

/** Detector id → the metrics it watches, read from the source. */
function detectorMetrics(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const file of readdirSync(CATALOG)) {
    if (!file.endsWith('Detector.ts') || file === 'BaseDetector.ts') continue;

    const source = readFileSync(join(CATALOG, file), 'utf8');
    const id = source.match(/^\s{4}id: '([^']+)'/m)?.[1];
    const metrics = source.match(/watchedMetrics: \[([^\]]*)\]/)?.[1];
    if (!id || metrics === undefined) continue;

    found.set(
      id,
      [...metrics.matchAll(/'([^']+)'/g)].map(m => m[1])
    );
  }

  return found;
}

/** Only detectors the engine actually runs. An unregistered file never fires. */
function registered(): Set<string> {
  const engine = readFileSync(
    join(__dirname, '..', '..', 'detectors', 'DetectorEngine.ts'),
    'utf8'
  );
  const classes = [...engine.matchAll(/new (\w+Detector)\(/g)].map(m => m[1]);

  const ids = new Set<string>();
  for (const className of classes) {
    const source = readFileSync(join(CATALOG, `${className}.ts`), 'utf8');
    const id = source.match(/^\s{4}id: '([^']+)'/m)?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

function declaredPairs(groups: readonly (readonly string[])[]): Set<string> {
  const pairs = new Set<string>();
  for (const group of groups) {
    for (const a of group) {
      for (const b of group) {
        if (a !== b) pairs.add(pairKey(a, b));
      }
    }
  }
  return pairs;
}

describe('detectors that watch the same metric', () => {
  const metrics = detectorMetrics();
  const live = registered();
  const decided = new Set([
    ...declaredPairs(OVERLAP_GROUPS),
    ...declaredPairs(DELIBERATELY_SEPARATE),
  ]);

  /** Every pair of REGISTERED detectors sharing at least one metric. */
  const colliding = new Map<string, string[]>();
  for (const [idA, metricsA] of metrics) {
    if (!live.has(idA)) continue;
    for (const [idB, metricsB] of metrics) {
      if (idA >= idB || !live.has(idB)) continue;
      const shared = metricsA.filter(m => metricsB.includes(m));
      if (shared.length > 0) colliding.set(pairKey(idA, idB), shared);
    }
  }

  it('found the catalogue, so this guard is looking at something', () => {
    // A rename that broke the parse would otherwise make this pass vacuously.
    expect(metrics.size).toBeGreaterThan(30);
    expect(live.size).toBeGreaterThan(30);
  });

  it('has a decision recorded for every one of them', () => {
    /*
     * To fix a failure here, put the pair in ONE of the two lists in
     * `overlappingInsights.ts`:
     *
     *   OVERLAP_GROUPS        if an owner reading both cards would take ONE
     *                         action. Order them most specific first.
     *   DELIBERATELY_SEPARATE if the two cards call for different actions and
     *                         both deserve to show.
     *
     * Say which in a comment. The next person needs the reasoning, not the
     * verdict.
     */
    const undecided = [...colliding.entries()]
      .filter(([pair]) => !decided.has(pair))
      .map(([pair, shared]) => `${pair} (shares ${shared.join(', ')})`);

    expect(undecided).toEqual([]);
  });

  it('declares nothing about detectors that do not exist', () => {
    /*
     * A declaration naming a deleted or renamed detector is dead weight that
     * reads as coverage. It would also silently stop suppressing the moment
     * the id drifted.
     */
    const declared = new Set(
      [...OVERLAP_GROUPS, ...DELIBERATELY_SEPARATE].flatMap(group => [...group])
    );

    const unknown = [...declared].filter(id => !live.has(id));
    expect(unknown).toEqual([]);
  });
});
