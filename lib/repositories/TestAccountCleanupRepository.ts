/**
 * Data access for the operator-only account cleanup (OX-1r, extended by data
 * export DE-10b.1).
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 * (SA-5, SA-6, SA-10, SA re-ruling R-2, R-5, R-6) and
 * docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md (SA Review 2).
 *
 * Calls ONE database function, the generated secret-gated cleanup RPC, through
 * the service-role client. No SQL exists here: the guards, the deletes, the
 * survivor scan, the success audit row and the deletion receipt all run inside
 * the function, in PostgREST's single transaction, so any error rolls all of
 * it back. The function refuses with 42501 unless it is sent the second secret
 * (read by lib/server/testCleanupSecret.ts), whose sha256 only the database holds.
 *
 * Four modes. `check` / `delete`: the test-account hard delete, login included
 * (OX-1r), unchanged except that the delete now also writes a receipt.
 * `anonymise_check` / `anonymise` (DE-10b.1): close and anonymise a real
 * account in place. The business data is deleted, our billing rows stay under
 * the same id with their personal columns blanked, and the login becomes a
 * tombstone (placeholder email, no password, identities or sessions, banned).
 *
 * ── The receipt (SA R-2, O-9) ──────────────────────────────────────────────
 * The RPC WRITES `business_os_deletion_receipts`: the function inserts the
 * receipt last, inside its transaction, from `p_receipt` (built and checked by
 * lib/business-os/account-deletion/receiptInput.ts) plus what it computes
 * itself. No TS code reads or writes that table in this release; the read
 * repository arrives with the lookup (release 3, `new-repository` skill).
 *
 * ── Service role, intentionally ────────────────────────────────────────────
 * Only `service_role` holds EXECUTE on the function (R-4), and Storage objects
 * can only be removed through the Storage API. Both uses are this module's
 * whole purpose and sit behind `requireAdmin` in the routes. Only the routes
 * and runners allow-listed by family 5 of
 * lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts may import it.
 *
 * ── tenant-isolation-guard ─────────────────────────────────────────────────
 * CLAUDE.md rule 4 and the `tenant-isolation-guard` skill protect one tenant's
 * request from touching another tenant. This is an operator tool: the target
 * is resolved by EMAIL inside the function, and its guards are the isolation.
 * In the anonymise modes the caller also sends `subject` (the account id the
 * admin picked on its row), and guard G-2a proves IN THE DATABASE that the
 * email resolves to exactly that login, so a mismatched pair refuses. The
 * anonymise also blanks rows of ANOTHER account: the invites the subject
 * redeemed or claimed, which their issuer keeps (O-4, W-6). Those rows are
 * found by the subject's own id (`redeemed_account_id` / `claimed_account_id`
 * equal to it), never by a caller-supplied id.
 *
 * Never log the rpc arguments: they carry the email, the tag, the secret and
 * the receipt (fingerprint, reason note).
 *
 * @module lib/repositories/TestAccountCleanupRepository
 */

import 'server-only';
import { z } from 'zod';
import { createLogger, type Logger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import { readTestCleanupSecret } from '@/lib/server/testCleanupSecret';
import type { DeletionReceiptInput } from '@/lib/business-os/account-deletion/receiptInput';
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

export type CleanupRpcMode = 'check' | 'delete' | 'anonymise_check' | 'anonymise';

export interface CleanupInput {
  email: string;
  tag: string;
}

export interface CleanupDeleteInput extends CleanupInput {
  confirmEmail: string;
}

/** The anonymise check: the email and the account id picked on the row (G-2a). */
export interface AnonymiseInput {
  email: string;
  subject: string;
}

export interface AnonymiseDeleteInput extends AnonymiseInput {
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
  /**
   * Informational guard rows (anonymise modes only, workplan §3.2): reported,
   * never blocking. For example "billing will be kept". Always [] in hard mode.
   */
  notes: CleanupBlocker[];
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

/** What the anonymise returns, built in its own transaction (workplan §3.5). */
export interface AnonymiseReport {
  receiptId: string;
  placeholderRef: string;
  receiptMode: 'anonymised' | 'pseudonymised_billing_kept';
  rowsRemoved: number;
  tablesRemoved: number;
  rowsBlanked: number;
}

export type CleanupRemoveOutcome =
  | { kind: 'removed'; version: string; report: CleanupReport; serverMs: number | null; receiptId: string | null }
  /** The function raised on a guard: nothing was removed. `reason` is the plain SQL message (no email). */
  | { kind: 'blocked'; guards: string[]; reason: string };

export type AnonymiseOutcome =
  | { kind: 'anonymised'; version: string; report: AnonymiseReport; serverMs: number | null }
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
  mode: z.enum(['check', 'delete', 'anonymise_check', 'anonymise']),
  rows: z.array(z.record(z.unknown())),
  // Optional: the 20261041 function does not return it.
  server_ms: z.number().nonnegative().optional(),
  // DE-10b.1: the delete and the anonymise return their receipt id.
  receipt_id: z.string().uuid().optional(),
});

const anonymiseReportSchema = z.object({
  receipt_id: z.string().uuid(),
  placeholder_ref: z.string().regex(/^[0-9a-f]{12}$/),
  receipt_mode: z.enum(['anonymised', 'pseudonymised_billing_kept']),
  rows_removed: z.number().int().nonnegative(),
  tables_removed: z.number().int().nonnegative(),
  rows_blanked: z.number().int().nonnegative(),
});

/** A guard id: G-12, or G-2a (the anonymise replacement of G-2). */
const GUARD_ID = /^G-\d+[a-z]?/;
const toCount = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Every guard id named in a refusal message, in order, once each. */
export function guardIdsIn(message: string): string[] {
  return [...new Set(message.match(/G-\d+[a-z]?/g) ?? [])];
}

/** What may be logged about an error: kind, `code` and `message` only (SA-12). */
export function cleanupErrorFacts(err: unknown): { kind: CleanupErrorKind | null; code: string | null; message: string } {
  if (err instanceof CleanupRpcError) return { kind: err.kind, code: err.code, message: err.message };
  return { kind: null, code: null, message: err instanceof Error ? err.message : String(err) };
}

function toGuardRow(row: CleanupCheckRow): CleanupBlocker {
  const guard = row.item.match(GUARD_ID)?.[0] ?? row.item;
  return { guard, item: row.item.slice(guard.length).trim(), found: row.found, clears: row.detail };
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
  const blockers = parsed.filter((row) => row.section === 'guard' && row.status === 'BLOCKED').map(toGuardRow);
  // `info` rows never count towards BLOCKED (workplan §3.2).
  const notes = parsed.filter((row) => row.section === 'guard' && row.status === 'info').map(toGuardRow);
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
    notes,
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

interface CallInput {
  email: string;
  tag?: string;
  confirmEmail?: string;
  subject?: string;
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

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

  /**
   * One call of the function. Throws CleanupRpcError; returns the parsed jsonb.
   * `p_subject` and `p_receipt` are sent only by the modes that use them, so a
   * hard check sends exactly the six arguments it always did.
   */
  private async call(
    mode: CleanupRpcMode,
    input: CallInput,
    actorId: string | null,
    receipt: DeletionReceiptInput | null
  ): Promise<{ parsed: z.infer<typeof rpcResultSchema>; raw: Record<string, unknown> }> {
    const secret = this.secret();
    if (secret === null) throw new CleanupRpcError('not_configured', null, 'Test-account cleanup is not configured');

    const args: Record<string, unknown> = {
      p_mode: mode,
      p_email: input.email,
      p_tag: input.tag ?? '',
      p_confirm: input.confirmEmail ?? '',
      p_actor: actorId,
      p_secret: secret,
    };
    if (mode === 'anonymise_check' || mode === 'anonymise') args.p_subject = input.subject ?? null;
    if (mode === 'delete' || mode === 'anonymise') args.p_receipt = receipt;

    const { data, error } = await this.client.rpc(CLEANUP_RPC, args);
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
    return { parsed: parsed.data, raw: data as Record<string, unknown> };
  }

  /** The check (FR-5). The function sets the transaction read-only itself (R-2 c). */
  async check(input: CleanupInput): Promise<RepositoryResult<CleanupCheckResult>> {
    try {
      const { parsed } = await this.call('check', input, null, null);
      return { data: parseCheck(parsed.version, parsed.rows, parsed.server_ms ?? null), error: null };
    } catch (err) {
      return { data: null, error: asError(err) };
    }
  }

  /**
   * The anonymise check (DE-10b.1). Read-only in the database like `check`.
   * Blocking guards land in `blockers`, informational ones in `notes`.
   */
  async anonymiseCheck(input: AnonymiseInput): Promise<RepositoryResult<CleanupCheckResult>> {
    try {
      const { parsed } = await this.call('anonymise_check', { email: input.email, subject: input.subject }, null, null);
      return { data: parseCheck(parsed.version, parsed.rows, parsed.server_ms ?? null), error: null };
    } catch (err) {
      return { data: null, error: asError(err) };
    }
  }

  /**
   * The delete (FR-7, FR-8). The function writes the success audit row with
   * `actorId` as actor (SA-5), then the receipt, and returns the report from
   * the same transaction. A guard that raises (P0001) is `blocked`, not an error.
   */
  async remove(
    input: CleanupDeleteInput,
    actorId: string,
    receipt: DeletionReceiptInput
  ): Promise<RepositoryResult<CleanupRemoveOutcome>> {
    try {
      const { parsed } = await this.call('delete', input, actorId, receipt);
      return {
        data: {
          kind: 'removed',
          version: parsed.version,
          report: parseReport(parsed.rows),
          serverMs: parsed.server_ms ?? null,
          receiptId: parsed.receipt_id ?? null,
        },
        error: null,
      };
    } catch (err) {
      if (err instanceof CleanupRpcError && err.code === PG_RAISE_EXCEPTION) {
        return { data: { kind: 'blocked', guards: guardIdsIn(err.message), reason: err.message }, error: null };
      }
      return { data: null, error: asError(err) };
    }
  }

  /**
   * The anonymise (DE-10b.1). `actorId` is the admin, or null when the owner
   * asked (DE-10b.2); the function refuses a mismatch with the receipt origin.
   * A guard that raises (P0001) is `blocked`, not an error.
   */
  async anonymise(
    input: AnonymiseDeleteInput,
    actorId: string | null,
    receipt: DeletionReceiptInput
  ): Promise<RepositoryResult<AnonymiseOutcome>> {
    try {
      const { parsed, raw } = await this.call('anonymise', input, actorId, receipt);
      const report = anonymiseReportSchema.safeParse(raw);
      if (!report.success) {
        this.logger.error({ mode: 'anonymise' }, 'The anonymise returned no report');
        return { data: null, error: new CleanupRpcError('failed', null, 'Unexpected result from the cleanup function') };
      }
      return {
        data: {
          kind: 'anonymised',
          version: parsed.version,
          report: {
            receiptId: report.data.receipt_id,
            placeholderRef: report.data.placeholder_ref,
            receiptMode: report.data.receipt_mode,
            rowsRemoved: report.data.rows_removed,
            tablesRemoved: report.data.tables_removed,
            rowsBlanked: report.data.rows_blanked,
          },
          serverMs: parsed.server_ms ?? null,
        },
        error: null,
      };
    } catch (err) {
      if (err instanceof CleanupRpcError && err.code === PG_RAISE_EXCEPTION) {
        return { data: { kind: 'blocked', guards: guardIdsIn(err.message), reason: err.message }, error: null };
      }
      return { data: null, error: asError(err) };
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
      return { data: null, error: asError(err) };
    }
    return { data: { removed, failed }, error: null };
  }
}
