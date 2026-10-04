/**
 * purge-schema-reconcile — READ-ONLY measurement of the live schema against
 * the purge descriptor set (admin delete AD-1a, AC-A5, SC-7 / SC-8).
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/purge-schema-reconcile.ts
 *
 * WHAT IT DOES. Calls `runSchemaReconciler()` — the same function the admin
 * preview's R-8 uses, so this measures the code that ships, not a copy of it —
 * and logs: the status, the three lists (unclassified, missing deletable,
 * missing never), the tenant-table count, the fingerprint, and the git ref/SHA
 * it ran from (business-os-schema-check Rule 2). It imports only the
 * reconciler, never `BusinessPurgeRepository` itself (purge bound B-3).
 *
 * WHAT IT NEVER DOES. It writes nothing: `purge_schema_introspect()` performs
 * no DML and no DDL (migration 20260915a). It reads no table rows, so it can
 * log no row data and no emails — only table names, column names, FK actions
 * and counts, which are schema. It is never wired into CI (SA condition 4).
 *
 * ENVIRONMENT. `lib/supabaseServer.ts` builds the service-role client at
 * import, so `.env.local` must be loaded BEFORE the first import — hence the
 * `--import ./scripts/env-preload.ts` form. Run from the repository root. The
 * Supabase host is logged first; check it before reading the verdict, because
 * this is normally run against production.
 *
 * Exit code: 0 = `ok`; 1 = `drift` / `ambiguous` / `unreadable` (do not merge
 * AD-1a until it is 0, per AC-A5); 2 = bad arguments.
 *
 * @module scripts/purge-schema-reconcile
 */

import { execSync } from 'child_process';

import { createLogger } from '@/lib/logger';
import { runSchemaReconciler } from '@/lib/business-os/purge/SchemaReconciler';

const logger = createLogger({ module: 'PurgeSchemaReconcileScript' });

function gitRef(): { branch: string; sha: string } {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return 'unknown';
    }
  };
  return { branch: run('git rev-parse --abbrev-ref HEAD'), sha: run('git rev-parse HEAD') };
}

function supabaseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host || 'unset';
  } catch {
    return 'invalid';
  }
}

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    logger.error({ argv: process.argv.slice(2) }, 'Usage: purge-schema-reconcile (takes no arguments)');
    return 2;
  }

  logger.info({ supabaseHost: supabaseHost(), ...gitRef() }, 'Purge schema reconcile (read-only)');

  const result = await runSchemaReconciler({ correlationId: `script-${Date.now()}` });

  logger.info(
    {
      status: result.status,
      tenantTableCount: result.tenantTables.length,
      unclassifiedCount: result.unclassified.length,
      missingDeletableCount: result.missingDeletable.length,
      missingNeverCount: result.missingNever.length,
      unclassified: result.unclassified,
      missingDeletable: result.missingDeletable,
      missingNever: result.missingNever,
      fingerprint: result.fingerprint,
      error: result.error,
    },
    'Reconcile result'
  );

  return result.status === 'ok' ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'purge-schema-reconcile crashed');
    process.exitCode = 1;
  });
