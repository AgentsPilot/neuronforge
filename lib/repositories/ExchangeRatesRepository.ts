// lib/repositories/ExchangeRatesRepository.ts
// Data-access layer for `exchange_rates` and `exchange_rate_history`: the
// admin-maintained table of rates behind the Exchange rates tab of
// `/admin/finance` (Admin Exchange Rates slices 1a and 2, requirement
// ADMIN_EXCHANGE_RATES_REQUIREMENT.md).
// Nothing reads these rates to convert money (D-5).
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (CLAUDE.md rule 4 exemption,
// stated rather than silently skipped):
//
//   Both tables are platform-wide reference data: one row per currency, the
//   same row for every tenant. They have NO `user_id` (or any other owner)
//   column, so there is nothing to scope by and no cross-tenant read or write
//   is reachable through this repository. `updated_by` / `changed_by` record
//   the acting admin; they are not owners.
//
//   `supabaseServer` (service role) is therefore INTENTIONAL: an admin-only
//   surface that bypasses RLS on purpose. Until slice 1b lands, the browser
//   roles still hold write grants under a `profiles.role` policy; this
//   repository does not depend on those policies either way (SA-R5).
//
//   Because scoping cannot protect these tables, AUTHORISATION IS THE CALLER'S
//   JOB. The one permitted caller is `app/api/admin/exchange-rates/**`, behind
//   the admin gate `requireAdmin` (`lib/admin/requireAdminRoute.ts` →
//   AdminAccessService → the `admin_users` table; never `profiles.role`). Do
//   not add an ungated caller.
//
//   No method accepts a caller-supplied filter, table name, column list or
//   limit — only a currency code the route has already narrowed through Zod,
//   a validated decimal string, a boolean and the admin id.
//
//   `updated_by` MUST be the acting admin on every update, in the SAME UPDATE
//   as the change: the live trigger `exchange_rate_change_trigger` copies
//   `NEW.updated_by` into `exchange_rate_history.changed_by` when the rate
//   changes (SA-R7). The admin id comes from `requireAdmin`, never a body.
//   `last_updated_at` is stamped here because no database trigger sets it on
//   UPDATE (Step 0, 2026-10-19).
//
//   `lib/services/CurrencyService.ts` is a legacy browser reader and an
//   unwired browser writer; it is not a second writer to extend (SQ-1).
//
//   Server-side only — never import this from a `'use client'` component.
//
// Rates are read cast to text and written as validated decimal strings, so a
// `numeric(12,6)` value never passes through a JS number.
//
// No method throws: every failure comes back as `{ data: null, error }`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  ExchangeRateHistoryRow,
  ExchangeRateRow,
} from './types';
import {
  HISTORY_LIMIT,
  type ExchangeRateHistoryRecord,
  type ExchangeRateWire,
} from '@/lib/admin/exchangeRates/exchangeRateRules';

const RATES_TABLE = 'exchange_rates';
const HISTORY_TABLE = 'exchange_rate_history';

/**
 * How many history rows the admin page shows, overall and per currency (SA-R4;
 * 10 since slice 1c.1); the one source is the rules module.
 */
export const EXCHANGE_RATE_HISTORY_LIMIT = HISTORY_LIMIT;

const RATE_COLUMNS =
  'id, currency_code, currency_name, currency_symbol, rate_to_usd::text, is_enabled, decimal_places, last_updated_at, updated_by';

const HISTORY_COLUMNS =
  'id, currency_code, old_rate::text, new_rate::text, changed_by, changed_at, change_reason';

export interface ExchangeRatesRepositoryOptions {
  /** Test seam for `last_updated_at`. */
  now?: () => Date;
}

export class ExchangeRatesRepository {
  private supabase: SupabaseClient;
  private logger: Logger;
  private now: () => Date;

  constructor(supabaseClient?: SupabaseClient, options: ExchangeRatesRepositoryOptions = {}) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ExchangeRatesRepository' });
    this.now = options.now ?? (() => new Date());
  }

  /** Every currency, enabled or not, by code — what the admin page lists. */
  async listAll(): Promise<RepositoryResult<ExchangeRateRow[]>> {
    const methodLogger = this.logger.child({ method: 'listAll' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(RATES_TABLE)
        .select(RATE_COLUMNS)
        .order('currency_code', { ascending: true });

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Exchange rates fetched');
      return { data: (data as unknown as ExchangeRateRow[]) || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch exchange rates');
      return { data: null, error: error as Error };
    }
  }

  /** One currency by code; `data: null` (and no error) when no row has that code. */
  async findByCode(currencyCode: string): Promise<RepositoryResult<ExchangeRateRow | null>> {
    const methodLogger = this.logger.child({ method: 'findByCode', currencyCode });

    try {
      const { data, error } = await this.supabase
        .from(RATES_TABLE)
        .select(RATE_COLUMNS)
        .eq('currency_code', currencyCode)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as unknown as ExchangeRateRow | null) ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch exchange rate');
      return { data: null, error: error as Error };
    }
  }

  /** The newest history rows, newest first (SA-R4). */
  async listRecentHistory(): Promise<RepositoryResult<ExchangeRateHistoryRow[]>> {
    const methodLogger = this.logger.child({ method: 'listRecentHistory' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(HISTORY_TABLE)
        .select(HISTORY_COLUMNS)
        .order('changed_at', { ascending: false })
        .limit(EXCHANGE_RATE_HISTORY_LIMIT);

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Exchange rate history fetched');
      return { data: (data as unknown as ExchangeRateHistoryRow[]) || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch exchange rate history');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One currency's newest history rows, newest first (slice 1c.1, SQ-12): the
   * per-row History view. The code has already passed `currencyCodeSchema` in
   * the route; the limit is the same fixed constant, never caller-supplied.
   */
  async listRecentHistoryForCurrency(currencyCode: string): Promise<RepositoryResult<ExchangeRateHistoryRow[]>> {
    const methodLogger = this.logger.child({ method: 'listRecentHistoryForCurrency', currencyCode });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(HISTORY_TABLE)
        .select(HISTORY_COLUMNS)
        .eq('currency_code', currencyCode)
        .order('changed_at', { ascending: false })
        .limit(EXCHANGE_RATE_HISTORY_LIMIT);

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Exchange rate history fetched');
      return { data: (data as unknown as ExchangeRateHistoryRow[]) || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch exchange rate history');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set one currency's rate. One UPDATE carries the rate, `last_updated_at` and
   * `updated_by`, so the trigger attributes the history row to this admin
   * (SA-R7). A same-value save still runs: it refreshes the date and the
   * trigger writes no history row. `data: null` when no row has that code.
   */
  async updateRate(currencyCode: string, rate: string, adminId: string): Promise<RepositoryResult<ExchangeRateRow | null>> {
    return this.updateOne('updateRate', currencyCode, { rate_to_usd: rate }, adminId);
  }

  /** Switch one currency on or off; same single-UPDATE contract as `updateRate` (SA-R7). */
  async setEnabled(currencyCode: string, isEnabled: boolean, adminId: string): Promise<RepositoryResult<ExchangeRateRow | null>> {
    return this.updateOne('setEnabled', currencyCode, { is_enabled: isEnabled }, adminId);
  }

  private async updateOne(
    method: 'updateRate' | 'setEnabled',
    currencyCode: string,
    change: { rate_to_usd: string } | { is_enabled: boolean },
    adminId: string
  ): Promise<RepositoryResult<ExchangeRateRow | null>> {
    const methodLogger = this.logger.child({ method, currencyCode });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(RATES_TABLE)
        .update({
          ...change,
          last_updated_at: this.now().toISOString(),
          updated_by: adminId,
        })
        .eq('currency_code', currencyCode)
        .select(RATE_COLUMNS)
        .maybeSingle();

      if (error) throw error;

      methodLogger.info({ found: data !== null, duration: Date.now() - startTime }, 'Exchange rate updated');
      return { data: (data as unknown as ExchangeRateRow | null) ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to update exchange rate');
      return { data: null, error: error as Error };
    }
  }
}

// ── Wire mapping ────────────────────────────────────────────────────────────

/**
 * A stored row as the admin API sends it. `is_enabled` is nullable live; a
 * null reads as DISABLED (`=== true`), matching the only production reader
 * (the signed-in user's RLS read `is_enabled = true`, so a null row is already
 * invisible to users). SA §10 additional ruling 1. Callers that record the
 * raw value (the audit `oldValue`) read `row.is_enabled`, not this.
 */
export function toExchangeRateWire(row: ExchangeRateRow): ExchangeRateWire {
  return {
    currencyCode: row.currency_code,
    currencyName: row.currency_name,
    currencySymbol: row.currency_symbol,
    rateToUsd: row.rate_to_usd,
    isEnabled: row.is_enabled === true,
    decimalPlaces: row.decimal_places,
    lastUpdatedAt: row.last_updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * A stored history row as a record WITHOUT its "Changed by" label (slice 1c.1,
 * SA W-1): the route resolves the label through `labelHistory`, which is the
 * only thing that produces the wire type.
 */
export function toExchangeRateHistoryRecord(row: ExchangeRateHistoryRow): ExchangeRateHistoryRecord {
  return {
    id: row.id,
    currencyCode: row.currency_code,
    oldRate: row.old_rate,
    newRate: row.new_rate,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    changeReason: row.change_reason,
  };
}

// Singleton instance for convenience
export const exchangeRatesRepository = new ExchangeRatesRepository();
