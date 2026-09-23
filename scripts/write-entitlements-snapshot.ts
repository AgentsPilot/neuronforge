/**
 * Refresh the entitlement drift snapshot.
 *
 *   npm run entitlements:snapshot
 *
 * Run this AFTER a config change has been reviewed and agreed — never to make a
 * failing test go green. The snapshot is what turns "someone quietly took a
 * capability away from paying subscribers" into a red suite (T-11 / B-10), so
 * refreshing it is the moment someone accepts the change. The diff is the
 * record.
 *
 * @module scripts/write-entitlements-snapshot
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { COHORTS } from '../lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '../lib/business-os/entitlements/config/lifecycle';
import { TIER_MATRIX } from '../lib/business-os/entitlements/config/tierMatrix';
import type { EntitlementSnapshot } from '../lib/business-os/entitlements/snapshot';

const TARGET = join(process.cwd(), 'lib', 'business-os', 'entitlements', '__tests__', 'entitlements.snapshot.json');

const snapshot: EntitlementSnapshot = {
  generated: new Date().toISOString().slice(0, 10),
  matrixVersion: TIER_MATRIX.version,
  tiers: TIER_MATRIX.tiers as EntitlementSnapshot['tiers'],
  removals: [...TIER_MATRIX.removals] as EntitlementSnapshot['removals'],
  histories: {
    trial: {
      duration: [...(COHORTS.trial.durationHistory ?? [])],
      grace: [...COHORTS.trial.graceHistory],
    },
    champion: {
      grace: [...COHORTS.champion.graceHistory],
    },
    subscription: {
      grace: [...LIFECYCLE_CONFIG.subscriptionGraceHistory],
    },
  },
};

writeFileSync(TARGET, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

// A CLI script's output is its interface, which is why this is not Pino.
process.stdout.write(`entitlements snapshot written: ${TARGET}\n`);
process.stdout.write(
  `  matrix version ${snapshot.matrixVersion}, ${Object.keys(snapshot.tiers).length} tier(s), ${snapshot.removals.length} removal(s)\n`
);
