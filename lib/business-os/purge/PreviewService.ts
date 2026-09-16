// lib/business-os/purge/PreviewService.ts
//
// T16 (dry-run slice) — assembles the preview.
//
// ⚠️ This service CANNOT delete anything. It composes counts, the gate result,
// and — the part that matters most — an explicit inventory of what this build
// could NOT verify. The requirement's dry-run returns "gate outcome, per-table
// counts, per-bucket object counts, and any table FR-1 could not verify"; the
// last clause is the one a demo is most tempted to drop, so it is modelled as
// a first-class field rather than a log line.
//
// No dry-run token is minted. The token exists to bind a preview to a commit
// (FR-21/AC-29), and there is no commit route in this build. Minting one would
// produce a credential that authorises nothing, which is worse than absent: the
// next reader would reasonably assume a commit path exists to consume it.

import { createLogger } from '@/lib/logger';
import {
  descriptorsForRun,
  STORAGE_DESCRIPTORS,
  PURGE_DESCRIPTORS,
} from './descriptors';
import { evaluatePreflightGate, describeGateCoverage } from './PreflightGate';
import { missingCapabilities, describeCapability, hasCapability } from './capabilities';
import type { PurgeLevel, PurgeOptions, GateResult } from './types';
import {
  businessPurgeRepository,
  type TableCount,
} from '@/lib/repositories/BusinessPurgeRepository';

const logger = createLogger({ module: 'PurgePreviewService' });

export interface PreviewResult {
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId: string;

  /** Tables this run would delete from, with counts. `count: null` = unknown. */
  tables: TableCount[];
  /** Total rows, and how many tables could not be counted. */
  totals: { rows: number; tablesWithRows: number; tablesUnknown: number };

  /** Storage objects under the user's folder, per bucket. */
  storage: TableCount[];

  gate: GateResult;
  gateCoverage: { headline: string; unchecked: string[] };

  /**
   * Everything this build could not verify or cannot do.
   *
   * Rendered prominently by the UI. A preview that looks complete is how
   * someone later assumes the destructive path is equally complete.
   */
  limitations: string[];

  /** Always false in this build. There is no commit route. */
  canProceed: false;

  generatedAt: string;
  durationMs: number;
}

export async function buildPurgePreview(params: {
  userId: string;
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId: string;
}): Promise<PreviewResult> {
  const { userId, level, options, correlationId } = params;
  const startedAt = Date.now();
  const log = logger.child({ correlationId });

  const descriptors = descriptorsForRun(level, options);

  log.info(
    { userId, level, options, descriptorCount: descriptors.length },
    'Building purge preview',
  );

  // ── Gate ────────────────────────────────────────────────────────────────
  const hasStripe = await businessPurgeRepository.hasStripeConnectRow(userId);
  const gate = await evaluatePreflightGate({ userId, hasStripe });
  const gateCoverage = describeGateCoverage(gate);

  // ── Counts ──────────────────────────────────────────────────────────────
  //
  // SA-S1: capability gates the OPERATION, never the table list. `descriptors`
  // above was resolved from level + options with no capability term; the check
  // here decides whether we may count them, not which ones exist.
  const tables = hasCapability('count')
    ? await businessPurgeRepository.countAll(descriptors, userId)
    : descriptors.map<TableCount>((d) => ({
        table: d.table,
        count: null,
        error: 'counting is not granted in this build',
      }));

  const rows = tables.reduce((sum, t) => sum + (t.count ?? 0), 0);
  const tablesWithRows = tables.filter((t) => (t.count ?? 0) > 0).length;
  const tablesUnknown = tables.filter((t) => t.count === null).length;

  // ── Storage ─────────────────────────────────────────────────────────────
  const storageBuckets = STORAGE_DESCRIPTORS.filter(
    (s) => s.level !== 'never' && (s.level === 'reset' || level === 'purge'),
  );
  const storage: TableCount[] = [];
  for (const bucket of storageBuckets) {
    storage.push(
      hasCapability('storage_count')
        ? await businessPurgeRepository.countStorageObjects(bucket.bucket, userId)
        : ({ table: bucket.bucket, count: null, error: 'storage counting is not granted in this build' } as TableCount),
    );
  }

  // ── Limitations: stated, not implied ────────────────────────────────────
  const limitations: string[] = [
    'PREVIEW ONLY — this build has no commit route and no delete capability. Nothing here can remove a row.',
    'The pre-purge snapshot does NOT exist yet: the `business-purge-snapshots` bucket has not been created, and no snapshot writer has been built. There is currently no forensic record and no way to see what was deleted after the fact.',
    'The destructive RPC (`purge_business_data`) has not been written or applied, so the ordered, single-transaction delete — including the blocking-FK ordering constraints and the `crm_activities`-last rule — is unexercised.',
  ];

  if (gate.outcome !== 'skipped') {
    limitations.push(
      'The Stripe pre-flight gate did not pass cleanly. Only the no-Stripe skip path is implemented in this build; C1/C2/C3 are not.',
    );
  }

  if (tablesUnknown > 0) {
    limitations.push(
      `${tablesUnknown} table(s) could not be counted — shown as "unknown", NOT as zero. See the per-table list.`,
    );
  }

  const truncated = [...tables, ...storage].filter((t) => t.truncated);
  if (truncated.length > 0) {
    limitations.push(
      `${truncated.length} count(s) hit an internal cap and are a FLOOR, not an exact figure: ${truncated
        .map((t) => t.table)
        .join(', ')}.`,
    );
  }

  // Capabilities this build does not have, named rather than implied.
  const missing = missingCapabilities();
  if (missing.length > 0) {
    limitations.push(
      `This build cannot: ${missing.map(describeCapability).join('; ')}. The table list above is resolved from level and options ONLY — capability never removes a table from it, so nothing is hidden by the absence of these.`,
    );
  }

  const neverCount = PURGE_DESCRIPTORS.filter((d) => d.level === 'never').length;
  limitations.push(
    `${neverCount} tables are classified as never-deleted (platform, billing, other tenants' catalogs, plus the two retained by design) and are not counted above.`,
  );

  const durationMs = Date.now() - startedAt;

  log.info(
    { userId, level, rows, tablesWithRows, tablesUnknown, gate: gate.outcome, durationMs },
    'Purge preview complete',
  );

  return {
    level,
    options,
    correlationId,
    tables,
    totals: { rows, tablesWithRows, tablesUnknown },
    storage,
    gate,
    gateCoverage,
    limitations,
    canProceed: false,
    generatedAt: new Date().toISOString(),
    durationMs,
  };
}
