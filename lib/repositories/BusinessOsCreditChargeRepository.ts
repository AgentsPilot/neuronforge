// lib/repositories/BusinessOsCreditChargeRepository.ts
//
// Data access for the Business OS credit ledger: `business_os_credit_charges`
// (one thin row per charged action) and `business_os_credit_totals` (the
// running total per account and billing period).
//
// ── NOT AI-SPECIFIC (user decision 2026-09-29) ───────────────────────────────
// Every chargeable action — AI or not (e.g. a notification email to a client)
// — is eventually charged here, from ONE credit pool per account: the totals
// row is per account and period, never per service. `service` says which
// service charged the action; everything slice 3 records is `'ai'` (the
// 3b-ii recorder passes it). Nothing non-AI is built yet. Every charge has a
// grouping id, even a group of one (a bulk send is one group with one action
// id per email). `isFallbackPriced` is service-neutral: true when the cost was
// priced from a fallback rate rather than the measured one. AI sets it when a
// model is missing from the price table; another service sets it only if it
// defines its own documented fallback, and otherwise records `false`.
//
// Schema:   supabase/migrations/20261015_business_os_credit_charges.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md §3.2 to §3.6
//
// ── WRITE-ONLY, THROUGH ONE RPC ──────────────────────────────────────────────
// The only method writes a charge through `business_os_record_credit_charge`, which
// inserts the charge row and moves the totals row in ONE transaction, is
// idempotent on the action id, and computes the billing period in SQL from the
// account's plan anchor. Nothing here updates or deletes a row: the database
// grants `service_role` SELECT and INSERT on the charge table and nothing else,
// so a ledger row cannot be changed in place even by mistake.
//
// There is deliberately no read method yet (SA N-5): nothing reads the ledger
// before slices 4, 6 and 9, and each of those adds its own read, scoped with
// `.eq('user_id', userId)`, when it has a caller. The RPC scopes its own writes
// by `p_user_id`.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// Owners may only SELECT their own rows (and not the cost columns); no client
// role can write either table or execute the RPC. The writer is the server-side
// charge recorder at the end of `runAiAction` for AI
// (`lib/business-os/llm/aiChargeRecorder.ts`, slice 3b-ii; the only caller,
// pinned by the source guard in the test). The account id always comes from
// that server-side context, never from request input (tenant-isolation-guard:
// `action_id` is minted in-process, `group_id` is stored only and is never a
// key or an ownership target).
//
// ── WHY THE TYPES LIVE HERE (SA N-5) ────────────────────────────────────────
// As in the entitlement shadow-event repository, the row-shaped types sit with
// the repository that owns the RPC, and are re-exported from the barrel. The
// input is the `AiChargeRecord` that `chargeResolver.ts` builds plus `service`,
// so the 3b-ii recorder passes `{ ...record, service: 'ai' }`; the test pins
// that the two stay assignable, without this layer importing from
// `lib/business-os/llm`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** Who started the action (SQ-15 (3)); the database refuses any other value. */
export type BusinessOsCreditChargeTrigger = 'owner' | 'scheduled' | 'external';

/** Whether the billing period came from the plan anchor or, with no plan row, the UTC calendar month (Q-3). */
export type BusinessOsCreditChargeAnchorSource = 'plan' | 'calendar_month';

/** One charge to write: exactly the thin row (FR-13). */
export interface BusinessOsCreditChargeInput {
  /** The invocation's id, minted by `runAiAction`. The idempotency key. */
  actionId: string;
  /** The server-derived account. Never from request input. */
  accountId: string;
  /** Required for every charge, any service: a group may hold one action. */
  groupId: string;
  /**
   * Which service charged the action: lowercase letters, digits and
   * underscores, 1 to 64 characters, starting with a letter (a format CHECK,
   * not a closed list). Slice 3 records only `'ai'`.
   */
  service: string;
  actionType: string;
  trigger: BusinessOsCreditChargeTrigger;
  outcome: 'succeeded' | 'failed';
  /** Stored at 6 dp; the RPC rounds. */
  credits: number;
  /** Stored at 10 dp; the RPC rounds. */
  costUsd: number;
  creditValueVersion: number;
  /**
   * Priced from a fallback rate rather than the measured one. AI sets it when a
   * model is missing from the price table; another service only if it defines
   * its own documented fallback, otherwise `false`.
   */
  isFallbackPriced: boolean;
}

/** What the RPC reports back. */
export interface BusinessOsCreditChargeWriteResult {
  /** False when this action id was already recorded: nothing was written and no total moved. */
  recorded: boolean;
  /** ISO timestamp of the billing period the charge belongs to. */
  periodStart: string;
  anchorSource: BusinessOsCreditChargeAnchorSource;
}

/** The RPC's name, exported so the tests and the checker speak about one thing. */
export const BOS_RECORD_CREDIT_CHARGE_RPC = 'business_os_record_credit_charge';

const ANCHOR_SOURCES: readonly BusinessOsCreditChargeAnchorSource[] = ['plan', 'calendar_month'];

export class BusinessOsCreditChargeRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by design — see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsCreditChargeRepository' });
  }

  /**
   * Record one action's charge and move its period total, atomically.
   *
   * The arguments are built field by field from the typed input — never a
   * spread — so a property the caller's object happens to carry can never reach
   * the RPC (tenant-isolation-guard Step 3). The optional signal cancels the
   * request client-side; a cancelled or failed write is returned as `error`,
   * never thrown.
   *
   * Logged at `warn` only: the caller owns the one `error`-level event for a
   * failed charge (FR-16), so a failure is not reported twice at that level.
   */
  async recordCharge(
    charge: BusinessOsCreditChargeInput,
    options: { signal?: AbortSignal } = {}
  ): Promise<RepositoryResult<BusinessOsCreditChargeWriteResult>> {
    const args = {
      p_action_id: charge.actionId,
      p_user_id: charge.accountId,
      p_group_id: charge.groupId,
      p_service: charge.service,
      p_action_type: charge.actionType,
      p_triggered_by: charge.trigger,
      p_outcome: charge.outcome,
      p_credits: charge.credits,
      p_cost_usd: charge.costUsd,
      p_credit_value_version: charge.creditValueVersion,
      p_is_fallback_priced: charge.isFallbackPriced,
    };

    try {
      let query = this.supabase.rpc(BOS_RECORD_CREDIT_CHARGE_RPC, args);
      if (options.signal) query = query.abortSignal(options.signal);

      const { data, error } = await query;
      if (error) throw error;

      return { data: toWriteResult(data), error: null };
    } catch (error) {
      this.logger.warn(
        { err: error, actionId: charge.actionId, accountId: charge.accountId, groupId: charge.groupId, service: charge.service },
        'Credit charge write failed'
      );
      return { data: null, error: error as Error };
    }
  }
}

/**
 * Map the RPC's single row. A shape that is not exactly what the migration
 * returns is an error, never a guess: a silently wrong `recorded` would hide a
 * lost or doubled charge.
 */
function toWriteResult(data: unknown): BusinessOsCreditChargeWriteResult {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (typeof row !== 'object' || row === null) {
    throw new Error(`${BOS_RECORD_CREDIT_CHARGE_RPC} returned no row`);
  }
  const record = row as Record<string, unknown>;
  const recorded = record.out_recorded;
  const periodStart = record.out_period_start;
  const anchorSource = record.out_anchor_source;
  if (
    typeof recorded !== 'boolean' ||
    typeof periodStart !== 'string' ||
    typeof anchorSource !== 'string' ||
    !(ANCHOR_SOURCES as readonly string[]).includes(anchorSource)
  ) {
    throw new Error(`${BOS_RECORD_CREDIT_CHARGE_RPC} returned an unexpected row`);
  }
  return { recorded, periodStart, anchorSource: anchorSource as BusinessOsCreditChargeAnchorSource };
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsCreditChargeRepository = new BusinessOsCreditChargeRepository();
