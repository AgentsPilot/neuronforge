// lib/repositories/BusinessOsCreditLotRepository.ts
//
// Data access for Business OS credit lots: `business_os_credit_lots` (one row
// per batch of credits added to an account — an admin grant now, a boost
// purchase later) and `business_os_credit_lot_draws` (one row per batch of
// credits taken back out of a lot).
//
// Schema:   supabase/migrations/20261017_business_os_credit_lots.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md §3.4
//
// ── APPEND-ONLY, WRITTEN THROUGH TWO RPCS ───────────────────────────────────
// Lots are written only by `business_os_record_credit_lot` and draws only by
// `business_os_reverse_credit_lot`. Nothing here inserts, updates or deletes a
// row directly: the database grants `service_role` SELECT and INSERT on both
// tables and nothing else, so a lot can never be changed in place. What is
// left of a lot is always rebuilt from its rows (granted minus its draws);
// `lib/business-os/credits/creditLots.ts` holds that one definition.
//
// Idempotency keys, in SA's canonical form (S11-SQ-1):
//   admin grant     admin_grant:<requestId>
//   boost purchase  boost:<purchase reference>      (boost slice 2)
//   admin reversal  admin_reversal:<requestId>
// The reversal function serialises every writer of an account's draws on the
// transaction-scoped advisory lock `hashtextextended('business_os_credit_lots:'
// || user_id, 0)`; slice 9 / 10's consumption writer must take the same lock.
// (The SQL spells each colon `chr(58)` for the paste-file rules; the stored
// values are exactly the ones above.)
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// No client role can write either table or execute either function; owners
// may only SELECT their own rows, through a column list that hides the
// reason, the actor, the key, the source reference and the credit value
// version. Owners get their own read in 11d through the owner read repository
// on their RLS client, never through this file. Here the account id always
// comes from the server-side caller (the admin op's URL path, after the tenant
// check), never from request input (tenant-isolation-guard). Every read adds
// `.eq('user_id', accountId)` (CLAUDE.md rule 4), and the reversal function
// re-checks the lot's account under its lock.
//
// NO CALLER YET: 11b's admin op is the first. A source guard in
// `lib/business-os/credits/__tests__/creditLots.test.ts` fails if anything
// but the barrel and the tests names this repository.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The RPC names, exported so the tests and the checker speak about one thing. */
export const BOS_RECORD_CREDIT_LOT_RPC = 'business_os_record_credit_lot';
export const BOS_REVERSE_CREDIT_LOT_RPC = 'business_os_reverse_credit_lot';

export type BusinessOsCreditLotSource = 'admin_grant' | 'boost_purchase';
export type BusinessOsCreditLotActorKind = 'admin' | 'stripe_webhook';

/** One lot to record. The database's per-source shape CHECK decides which combinations are valid. */
export interface BusinessOsCreditLotInput {
  /** The server-derived account. Never from request input. */
  accountId: string;
  source: BusinessOsCreditLotSource;
  creditsBase: number;
  creditsBonus: number;
  creditValueVersion: number;
  /** ISO instant, or null for a lot that never expires. */
  expiresAt: string | null;
  /** `admin_grant:<requestId>` or `boost:<reference>`; one attempt records one lot. */
  idempotencyKey: string;
  sourceRef: string | null;
  actorKind: BusinessOsCreditLotActorKind;
  actorAdminId: string | null;
  reason: string | null;
}

export type BusinessOsCreditLotRecordResult =
  | { outcome: 'recorded' | 'replayed'; lotId: string }
  /** The key was already used for another account, source or amount (SQLSTATE 23505). */
  | { outcome: 'idempotency_key_conflict' };

/** What the reversal function can answer. Every status but `recorded` wrote nothing. */
export type BusinessOsCreditLotReverseStatus =
  | 'recorded'
  | 'already_recorded'
  | 'lot_not_found'
  | 'lot_expired'
  | 'nothing_left'
  | 'exceeds_remaining';

export interface BusinessOsCreditLotReverseInput {
  accountId: string;
  lotId: string;
  /** A positive number of credits, or `'rest'` for everything left on the lot. */
  credits: number | 'rest';
  /** `admin_reversal:<requestId>`. */
  idempotencyKey: string;
  actorAdminId: string;
  reason: string;
}

export interface BusinessOsCreditLotReverseResult {
  status: BusinessOsCreditLotReverseStatus | 'idempotency_key_conflict';
  /** Set on `recorded` and `already_recorded`; null otherwise. */
  drawId: string | null;
  credits: number | null;
  remainingBefore: number | null;
  /** On `already_recorded` both figures are the lot's remaining now: the replay changed nothing (SA OP-3). */
  remainingAfter: number | null;
}

/** One draw, as an admin may read it. */
export interface BusinessOsCreditLotDrawRow {
  id: string;
  lotId: string;
  accountId: string | null;
  kind: 'reversal';
  credits: number;
  reason: string | null;
  actorAdminId: string | null;
  idempotencyKey: string;
  createdAt: string;
}

/** One lot, as an admin may read it, without its draws. */
export interface BusinessOsCreditLot {
  id: string;
  accountId: string | null;
  source: BusinessOsCreditLotSource;
  creditsGranted: number;
  creditsBase: number;
  creditsBonus: number;
  creditValueVersion: number;
  expiresAt: string | null;
  idempotencyKey: string;
  sourceRef: string | null;
  actorKind: BusinessOsCreditLotActorKind;
  actorAdminId: string | null;
  reason: string | null;
  createdAt: string;
}

/** One lot with its draws attached. Structurally usable by `creditLots.ts`. */
export interface BusinessOsCreditLotRow extends BusinessOsCreditLot {
  draws: BusinessOsCreditLotDrawRow[];
}

/** The only columns selected: never `*`, so a column added later is never read by accident. */
export const CREDIT_LOT_COLUMNS =
  'id, user_id, source, credits_granted, credits_base, credits_bonus, credit_value_version, expires_at, idempotency_key, source_ref, actor_kind, actor_admin_id, reason, created_at';
export const CREDIT_LOT_DRAW_COLUMNS = 'id, lot_id, user_id, kind, credits, reason, actor_admin_id, idempotency_key, created_at';

export const CREDIT_LOT_READ_LIMITS = {
  /** Rows per read. Reaching it is reported as an error, never returned as a partial list. */
  ROWS_CEILING: 1000,
  /** Lot ids per `.in()` request, so the URL stays well under any proxy limit. */
  MAX_IDS_PER_REQUEST: 200,
} as const;

const REVERSE_STATUSES: readonly BusinessOsCreditLotReverseStatus[] = [
  'recorded',
  'already_recorded',
  'lot_not_found',
  'lot_expired',
  'nothing_left',
  'exceeds_remaining',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const UNIQUE_VIOLATION = '23505';

class CreditLotRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditLotRepositoryError';
  }
}

/**
 * A `numeric` as PostgREST returns it: a JSON number or a decimal string.
 * Anything else is an error, never a 0 that would read as "nothing left".
 */
function toCredits(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && DECIMAL_PATTERN.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new CreditLotRepositoryError('unreadable_figure');
}

function toTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new CreditLotRepositoryError('unreadable_timestamp');
  }
  return value;
}

function toUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new CreditLotRepositoryError('unreadable_id');
  return value;
}

function toNullableUuid(value: unknown): string | null {
  return value === null ? null : toUuid(value);
}

function toNullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new CreditLotRepositoryError('unreadable_text');
  return value;
}

function toText(value: unknown): string {
  if (typeof value !== 'string') throw new CreditLotRepositoryError('unreadable_text');
  return value;
}

function toOneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new CreditLotRepositoryError('unknown_value');
  }
  return value as T;
}

/** A set-returning RPC answers an array; exactly one row is required (SA W11a-8). */
function singleRow(data: unknown, rpc: string): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== 'object' || data[0] === null) {
    throw new CreditLotRepositoryError(`${rpc} did not return exactly one row`);
  }
  return data[0] as Record<string, unknown>;
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function mapDraw(raw: Record<string, unknown>): BusinessOsCreditLotDrawRow {
  return {
    id: toUuid(raw.id),
    lotId: toUuid(raw.lot_id),
    accountId: toNullableUuid(raw.user_id),
    kind: toOneOf(raw.kind, ['reversal'] as const),
    credits: toCredits(raw.credits),
    reason: toNullableText(raw.reason),
    actorAdminId: toNullableUuid(raw.actor_admin_id),
    idempotencyKey: toText(raw.idempotency_key),
    createdAt: toTimestamp(raw.created_at),
  };
}

function mapLot(raw: Record<string, unknown>): BusinessOsCreditLot {
  const version = raw.credit_value_version;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new CreditLotRepositoryError('unreadable_figure');
  return {
    id: toUuid(raw.id),
    accountId: toNullableUuid(raw.user_id),
    source: toOneOf(raw.source, ['admin_grant', 'boost_purchase'] as const),
    creditsGranted: toCredits(raw.credits_granted),
    creditsBase: toCredits(raw.credits_base),
    creditsBonus: toCredits(raw.credits_bonus),
    creditValueVersion: version,
    expiresAt: raw.expires_at === null ? null : toTimestamp(raw.expires_at),
    idempotencyKey: toText(raw.idempotency_key),
    sourceRef: toNullableUuid(raw.source_ref),
    actorKind: toOneOf(raw.actor_kind, ['admin', 'stripe_webhook'] as const),
    actorAdminId: toNullableUuid(raw.actor_admin_id),
    reason: toNullableText(raw.reason),
    createdAt: toTimestamp(raw.created_at),
  };
}

export class BusinessOsCreditLotRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by design — see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsCreditLotRepository' });
  }

  private assertUuid(value: unknown, what: string): void {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new CreditLotRepositoryError(`${what} (UUID) is required`);
    }
  }

  /**
   * Logged at warn with the method, SQLSTATE, message and ids only (SA CR11a-1).
   * Never the error object itself: a PostgreSQL constraint error carries the
   * failing row in `details`, which would put the admin's reason and the
   * idempotency key in the log. The returned error is rebuilt from the message
   * for the same reason, so a caller that logs it cannot leak `details` either.
   */
  private fail<T>(method: string, error: unknown, ids: Record<string, unknown>): RepositoryResult<T> {
    const message = String((error as { message?: unknown } | null)?.message ?? error);
    this.logger.warn({ method, sqlstate: sqlStateOf(error), errorMessage: message, ...ids }, 'Credit lot repository call failed');
    return { data: null, error: new Error(message) };
  }

  // ============ Writes (through the two RPCs) ============

  /**
   * Record one lot. The arguments are built field by field from the typed
   * input — never a spread — so a property the caller's object happens to
   * carry can never reach the RPC (tenant-isolation-guard Step 3).
   */
  async recordLot(input: BusinessOsCreditLotInput): Promise<RepositoryResult<BusinessOsCreditLotRecordResult>> {
    const method = 'recordLot';
    const ids = { accountId: input.accountId, source: input.source };
    try {
      this.assertUuid(input.accountId, 'An account id');
      // NaN or Infinity would serialise to JSON null and reach the database as "no amount".
      if (![input.creditsBase, input.creditsBonus, input.creditValueVersion].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new CreditLotRepositoryError('Credit figures must be finite numbers');
      }
      const args = {
        p_user_id: input.accountId,
        p_source: input.source,
        p_credits_base: input.creditsBase,
        p_credits_bonus: input.creditsBonus,
        p_credit_value_version: input.creditValueVersion,
        p_expires_at: input.expiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_source_ref: input.sourceRef,
        p_actor_kind: input.actorKind,
        p_actor_admin_id: input.actorAdminId,
        p_reason: input.reason,
      };

      const { data, error } = await this.supabase.rpc(BOS_RECORD_CREDIT_LOT_RPC, args);
      if (error) {
        // Any unique violation is a key conflict, matched by SQLSTATE and never by message
        // text: the function raises its own 23505, and a concurrent insert of the same key
        // raises Postgres's (SA W11a-4). 11b never parses Postgres codes.
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          this.logger.warn({ method, sqlstate: UNIQUE_VIOLATION, ...ids }, 'Credit lot idempotency key conflict');
          return { data: { outcome: 'idempotency_key_conflict' }, error: null };
        }
        throw error;
      }

      const row = singleRow(data, BOS_RECORD_CREDIT_LOT_RPC);
      if (typeof row.out_recorded !== 'boolean') throw new CreditLotRepositoryError('unreadable_outcome');
      const lotId = toUuid(row.out_lot_id);
      return { data: { outcome: row.out_recorded ? 'recorded' : 'replayed', lotId }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  /**
   * Take credits back out of one lot of this account. `'rest'` takes all that
   * is left. Every status but `recorded` wrote nothing.
   */
  async reverseLot(input: BusinessOsCreditLotReverseInput): Promise<RepositoryResult<BusinessOsCreditLotReverseResult>> {
    const method = 'reverseLot';
    const ids = { accountId: input.accountId, lotId: input.lotId };
    try {
      this.assertUuid(input.accountId, 'An account id');
      this.assertUuid(input.lotId, 'A lot id');
      // A NaN amount would serialise to JSON null, which the function reads as "the rest".
      if (input.credits !== 'rest' && !(typeof input.credits === 'number' && Number.isFinite(input.credits) && input.credits > 0)) {
        throw new CreditLotRepositoryError('Credits must be a positive finite number or rest');
      }
      const args = {
        p_user_id: input.accountId,
        p_lot_id: input.lotId,
        p_credits: input.credits === 'rest' ? null : input.credits,
        p_idempotency_key: input.idempotencyKey,
        p_actor_admin_id: input.actorAdminId,
        p_reason: input.reason,
      };

      const { data, error } = await this.supabase.rpc(BOS_REVERSE_CREDIT_LOT_RPC, args);
      if (error) {
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          this.logger.warn({ method, sqlstate: UNIQUE_VIOLATION, ...ids }, 'Credit lot idempotency key conflict');
          return {
            data: { status: 'idempotency_key_conflict', drawId: null, credits: null, remainingBefore: null, remainingAfter: null },
            error: null,
          };
        }
        throw error;
      }

      const row = singleRow(data, BOS_REVERSE_CREDIT_LOT_RPC);
      const status = toOneOf(row.out_status, REVERSE_STATUSES);
      if (status === 'recorded' || status === 'already_recorded') {
        return {
          data: {
            status,
            drawId: toUuid(row.out_draw_id),
            credits: toCredits(row.out_credits),
            remainingBefore: toCredits(row.out_remaining_before),
            remainingAfter: toCredits(row.out_remaining_after),
          },
          error: null,
        };
      }
      // The other statuses carry no figures: null, never 0.
      return { data: { status, drawId: null, credits: null, remainingBefore: null, remainingAfter: null }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  // ============ Reads ============

  /** Every lot of the account, oldest first, each with its draws attached. */
  async listLotsWithDraws(accountId: string): Promise<RepositoryResult<BusinessOsCreditLotRow[]>> {
    const method = 'listLotsWithDraws';
    try {
      this.assertUuid(accountId, 'An account id');
      const ceiling = CREDIT_LOT_READ_LIMITS.ROWS_CEILING;
      const { data: lotData, error: lotError } = await this.supabase
        .from('business_os_credit_lots')
        .select(CREDIT_LOT_COLUMNS)
        .eq('user_id', accountId)
        .order('created_at', { ascending: true })
        .range(0, ceiling - 1);
      if (lotError) throw lotError;
      const rawLots = (lotData ?? []) as unknown as Record<string, unknown>[];
      if (rawLots.length >= ceiling) throw new CreditLotRepositoryError('too_many_lots');
      if (rawLots.length === 0) return { data: [], error: null };

      const lotIds = rawLots.map((raw) => toUuid(raw.id));
      const drawsByLot = new Map<string, BusinessOsCreditLotDrawRow[]>(lotIds.map((id) => [id, []]));
      for (let i = 0; i < lotIds.length; i += CREDIT_LOT_READ_LIMITS.MAX_IDS_PER_REQUEST) {
        const chunk = lotIds.slice(i, i + CREDIT_LOT_READ_LIMITS.MAX_IDS_PER_REQUEST);
        const { data: drawData, error: drawError } = await this.supabase
          .from('business_os_credit_lot_draws')
          .select(CREDIT_LOT_DRAW_COLUMNS)
          .eq('user_id', accountId)
          .in('lot_id', chunk)
          .order('created_at', { ascending: true })
          .range(0, ceiling - 1);
        if (drawError) throw drawError;
        const rawDraws = (drawData ?? []) as unknown as Record<string, unknown>[];
        if (rawDraws.length >= ceiling) throw new CreditLotRepositoryError('too_many_draws');
        for (const raw of rawDraws) {
          const draw = mapDraw(raw);
          drawsByLot.get(draw.lotId)?.push(draw);
        }
      }

      return { data: rawLots.map((raw) => ({ ...mapLot(raw), draws: drawsByLot.get(toUuid(raw.id)) ?? [] })), error: null };
    } catch (error) {
      return this.fail(method, error, { accountId });
    }
  }

  /**
   * One lot, only if it belongs to this account; `data: null` when missing or
   * another account's (the same answer, so a foreign id learns nothing). No
   * draws: this is the ownership check before a reversal, and the reversal
   * function rebuilds what is left under its lock.
   */
  async findLotForAccount(lotId: string, accountId: string): Promise<RepositoryResult<BusinessOsCreditLot | null>> {
    const method = 'findLotForAccount';
    try {
      this.assertUuid(lotId, 'A lot id');
      this.assertUuid(accountId, 'An account id');
      const { data, error } = await this.supabase
        .from('business_os_credit_lots')
        .select(CREDIT_LOT_COLUMNS)
        .eq('id', lotId)
        .eq('user_id', accountId)
        .maybeSingle();
      if (error) throw error;
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapLot(data as unknown as Record<string, unknown>), error: null };
    } catch (error) {
      return this.fail(method, error, { lotId, accountId });
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsCreditLotRepository = new BusinessOsCreditLotRepository();
