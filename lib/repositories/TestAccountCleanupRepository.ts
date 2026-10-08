/**
 * Data access for the operator-only test-account cleanup (OX-1r).
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 * (SA-5, SA-6, SA-10, SA re-ruling R-2, R-5, R-6).
 *
 * Calls ONE database function, the generated secret-gated cleanup RPC, through
 * the service-role client. No SQL exists here: the guards G-1 to G-19, the
 * deletes, the survivor scan and the success audit row all run inside the
 * function, in PostgREST's single transaction, so any error rolls all of it
 * back. The function refuses with 42501 unless it is sent the second secret
 * (read by lib/server/testCleanupSecret.ts), whose sha256 only the database holds.
 *
 * ── Service role, intentionally ────────────────────────────────────────────
 * Only `service_role` holds EXECUTE on the function (R-4), and Storage objects
 * can only be removed through the Storage API. Both uses are this module's
 * whole purpose and sit behind `requireAdmin` in the routes.
 *
 * ── Why the user_id rule and tenant-isolation-guard do not apply ──────────
 * CLAUDE.md rule 4 and the `tenant-isolation-guard` skill protect one tenant's
 * request from touching another tenant. This is an operator tool: the target
 * is resolved by EMAIL inside the function, and the guards G-1 to G-19
 * (exactly one login, the email contains the test tag, not an admin, no real
 * money, no other account's rows affected) are its isolation.
 *
 * Never log the rpc arguments: they carry the email, the tag and the secret.
 *
 * @module lib/repositories/TestAccountCleanupRepository
 */

import 'server-only';
import { z } from 'zod';
import { createLogger, type Logger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import { readTestCleanupSecret } from '@/lib/server/testCleanupSecret';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The function's name. The only place under app/ lib/ components/ hooks/ that names it (R-7 guard). */
export const CLEANUP_RPC = 'operator_test_account_cleanup';

/** Storage API batch size (SA-6: at most 1000). */
export const STORAGE_REMOVE_BATCH = 1000;

/** pg error code for a plpgsql `RAISE EXCEPTION`: the delete refused on a guard. */
const PG_RAISE_EXCEPTION = 'P0001';
/** insufficient_privilege: the function's secret check said no (R-3). */
const PG_INSUFFICIENT_PRIVILEGE = '42501';
/** PostgREST: no such function in the schema cache (migration not applied, or cache not reloaded). */
const PGRST_FUNCTION_MISSING = 'PGRST202';

export interface CleanupInput {
  email: string;
  tag: string;
}

export interface CleanupDeleteInput extends CleanupInput {
  confirmEmail: string;
}

/** One row of the check's report, as the pasted file shows it. */
export interface CleanupCheckRow {
  section: string;
  status: string;
  item: string;
  found: number | null;
  detail: string;
}

export interface CleanupBlocker {
  guard: string;
  item: string;
  found: number | null;
  clears: string;
}

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

export interface CleanupCheckResult {
  /** The applied function's version stamp (R-6). */
  version: string;
  verdict: 'OK' | 'BLOCKED';
  /** The login the email resolved to, when exactly one matched. */
  targetUserId: string | null;
  blockers: CleanupBlocker[];
  /** The files under the account folder (G-12), by bucket and path. */
  storageObjects: StorageObjectRef[];
  rows: CleanupCheckRow[];
  /**
   * Time the function spent in the database, in ms (SA C-2), measured from the
   * statement start. `elapsedMs` in the routes adds network and cold start.
   * Null from a function version that does not report it.
   */
  serverMs: number | null;
}

export interface CleanupReport {
  tables: Array<{ table: string; rowsRemoved: number }>;
  total: {
    result: string;
    rowsRemoved: number;
    tablesRemoved: number;
    removedLogin: string | null;
    removedAt: string | null;
    sameRun: boolean;
  };
}

export type CleanupRemoveOutcome =
  | { kind: 'removed'; version: string; report: CleanupReport; serverMs: number | null }
  /** The function raised on a guard: nothing was removed. `reason` is the plain SQL message (no email). */
  | { kind: 'blocked'; guards: string[]; reason: string };

/**
 * Why a call did not run. `not_configured`: no secret on this deployment.
 * `not_authorised`: the database refused the secret (42501). `function_missing`:
 * the function is not applied or PostgREST has not reloaded. `failed`: any other.
 */
export type CleanupErrorKind = 'not_configured' | 'not_authorised' | 'function_missing' | 'failed';

export class CleanupRpcError extends Error {
  constructor(
    readonly kind: CleanupErrorKind,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = 'CleanupRpcError';
  }
}

/** The subset of the Supabase client this repository uses. A fake implements it in tests. */
export interface CleanupRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ data: Array<{ name: string }> | null; error: { message: string } | null }>;
    };
  };
}

export interface EmptyStorageResult {
  removed: number;
  failed: number;
}

const rpcResultSchema = z.object({
  version: z.string().min(1),
  mode: z.enum(['check', 'delete']),
  rows: z.array(z.record(z.unknown())),
  // Optional: the 20261041 function does not return it.
  server_ms: z.number().nonnegative().optional(),
});

const GUARD_ID = /^G-\d+/;
const toCount = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Every guard id named in a refusal message, in order, once each. */
export function guardIdsIn(message: string): string[] {
  return [...new Set(message.match(/G-\d+/g) ?? [])];
}

/** What may be logged about an error: kind, `code` and `message` only (SA-12). */
export function cleanupErrorFacts(err: unknown): { kind: CleanupErrorKind | null; code: string | null; message: string } {
  if (err instanceof CleanupRpcError) return { kind: err.kind, code: err.code, message: err.message };
  return { kind: null, code: null, message: err instanceof Error ? err.message : String(err) };
}

function parseCheck(version: string, rows: Array<Record<string, unknown>>, serverMs: number | null): CleanupCheckResult {
  const parsed: CleanupCheckRow[] = rows.map((row) => ({
    section: toText(row.section),
    status: toText(row.status),
    item: toText(row.item),
    found: toCount(row.found),
    detail: toText(row.detail),
  }));
  const verdictRow = parsed.find((row) => row.section === 'VERDICT');
  const login = verdictRow?.item.match(/^login ([0-9a-f-]{36})$/i);
  const blockers = parsed
    .filter((row) => row.section === 'guard' && row.status === 'BLOCKED')
    .map((row) => {
      const guard = row.item.match(GUARD_ID)?.[0] ?? row.item;
      return { guard, item: row.item.slice(guard.length).trim(), found: row.found, clears: row.detail };
    });
  const buckets = STORAGE_DESCRIPTORS.map((descriptor) => descriptor.bucket);
  const storageObjects = parsed
    .filter((row) => row.section === 'storage')
    .map((row) => {
      const bucket = buckets.find((name) => row.item.startsWith(`${name}/`));
      return bucket ? { bucket, path: row.item.slice(bucket.length + 1) } : { bucket: '', path: row.item };
    });
  return {
    version,
    verdict: verdictRow?.status === 'OK' && blockers.length === 0 ? 'OK' : 'BLOCKED',
    targetUserId: login ? login[1].toLowerCase() : null,
    blockers,
    storageObjects,
    rows: parsed,
    serverMs,
  };
}

function parseReport(rows: Array<Record<string, unknown>>): CleanupReport {
  const tables = rows
    .filter((row) => row.line !== 'TOTAL')
    .map((row) => ({ table: toText(row.line), rowsRemoved: toCount(row.rows_removed) ?? 0 }));
  const total = rows.find((row) => row.line === 'TOTAL') ?? {};
  return {
    tables,
    total: {
      result: toText(total.result),
      rowsRemoved: toCount(total.rows_removed) ?? 0,
      tablesRemoved: toCount(total.tables_removed) ?? 0,
      removedLogin: total.removed_login ? toText(total.removed_login) : null,
      removedAt: total.removed_at ? toText(total.removed_at) : null,
      sameRun: total.same_run === true,
    },
  };
}

export class TestAccountCleanupRepository {
  private readonly client: CleanupRpcClient;
  private readonly secret: () => string | null;
  private readonly logger: Logger;

  constructor(deps?: { client?: CleanupRpcClient; secret?: () => string | null }) {
    // Service role, intentionally: see the module header.
    this.client = deps?.client ?? (supabaseServer as unknown as CleanupRpcClient);
    this.secret = deps?.secret ?? readTestCleanupSecret;
    this.logger = createLogger({ service: 'TestAccountCleanupRepository' });
  }

  /** One call of the function. Throws CleanupRpcError; returns the parsed jsonb. */
  private async call(
    mode: 'check' | 'delete',
    input: CleanupInput & { confirmEmail?: string },
    actorId: string | null
  ): Promise<z.infer<typeof rpcResultSchema>> {
    const secret = this.secret();
    if (secret === null) throw new CleanupRpcError('not_configured', null, 'Test-account cleanup is not configured');

    const { data, error } = await this.client.rpc(CLEANUP_RPC, {
      p_mode: mode,
      p_email: input.email,
      p_tag: input.tag,
      p_confirm: input.confirmEmail ?? '',
      p_actor: actorId,
      p_secret: secret,
    });
    if (error) {
      const code = error.code ?? null;
      const kind: CleanupErrorKind =
        code === PG_INSUFFICIENT_PRIVILEGE ? 'not_authorised' : code === PGRST_FUNCTION_MISSING ? 'function_missing' : 'failed';
      throw new CleanupRpcError(kind, code, error.message);
    }
    const parsed = rpcResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.mode !== mode) {
      this.logger.error({ mode }, 'Test-account cleanup function returned an unexpected shape');
      throw new CleanupRpcError('failed', null, 'Unexpected result from the cleanup function');
    }
    return parsed.data;
  }

  /** The check (FR-5). The function sets the transaction read-only itself (R-2 c). */
  async check(input: CleanupInput): Promise<RepositoryResult<CleanupCheckResult>> {
    try {
      const result = await this.call('check', input, null);
      return { data: parseCheck(result.version, result.rows, result.server_ms ?? null), error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  /**
   * The delete (FR-7, FR-8). The function writes the success audit row with
   * `actorId` as actor (SA-5) and returns the report from the same
   * transaction. A guard that raises (P0001) is `blocked`, not an error.
   */
  async remove(input: CleanupDeleteInput, actorId: string): Promise<RepositoryResult<CleanupRemoveOutcome>> {
    try {
      const result = await this.call('delete', input, actorId);
      return {
        data: { kind: 'removed', version: result.version, report: parseReport(result.rows), serverMs: result.server_ms ?? null },
        error: null,
      };
    } catch (err) {
      if (err instanceof CleanupRpcError && err.code === PG_RAISE_EXCEPTION) {
        return { data: { kind: 'blocked', guards: guardIdsIn(err.message), reason: err.message }, error: null };
      }
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  /**
   * Removes exactly the given objects (SA-6). Every path must sit in a
   * descriptor bucket and under `<targetUserId>/`, or nothing is removed.
   */
  async emptyStorage(targetUserId: string, objects: StorageObjectRef[]): Promise<RepositoryResult<EmptyStorageResult>> {
    const buckets = new Set(STORAGE_DESCRIPTORS.map((descriptor) => descriptor.bucket));
    const prefix = `${targetUserId}/`;
    const outside = objects.filter((object) => !buckets.has(object.bucket) || !object.path.startsWith(prefix));
    if (outside.length > 0) {
      return { data: null, error: new Error(`Refused: ${outside.length} storage path(s) outside the account folder`) };
    }

    const byBucket = new Map<string, string[]>();
    for (const object of objects) byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);

    let removed = 0;
    let failed = 0;
    try {
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += STORAGE_REMOVE_BATCH) {
          const batch = paths.slice(i, i + STORAGE_REMOVE_BATCH);
          const { data, error } = await this.client.storage.from(bucket).remove(batch);
          if (error) {
            failed += batch.length;
            continue;
          }
          const names = new Set((data ?? []).map((entry) => entry.name));
          const done = batch.filter((path) => names.has(path)).length;
          removed += done;
          failed += batch.length - done;
        }
      }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
    return { data: { removed, failed }, error: null };
  }
}
