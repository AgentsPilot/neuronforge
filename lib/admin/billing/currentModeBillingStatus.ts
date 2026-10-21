/**
 * Billing STATUS of the current Stripe mode, for the admin Finance page and
 * its nightly snapshot (Finance R4; plan payments P-8a SA condition P8A-R4).
 *
 * Why this file exists: test-mode and live-mode billing rows share one table,
 * one row per account per mode (UNIQUE (user_id, livemode), 20261025). The
 * Finance reads R-c and R-c′ had no mode filter, so an account with both a test
 * and a live row broke them: R-c failed the whole read on the duplicate and
 * R-c′'s `maybeSingle` errored. The approved rule (2026-10-18) is PF-15's:
 * STATUS is read for the current mode only. Revenue still counts both modes
 * (BD-14) and is not read here.
 *
 * Why it lives here and not in the finance tree: the finance source guard
 * forbids any mode wording in the finance files and the mode column in the
 * finance read repository (slice 1c). This module reuses P-8a's ONE
 * current-mode resolution (`stripeMode.ts`) and P-8a's ONE mode-filtered
 * reader (`BusinessOsBillingAdminReadRepository`, its D-1), so there is no
 * second copy of either. The finance wiring (`financeHealthDeps.ts`) calls the
 * two functions below by their own names and never sees a mode.
 *
 * The result shape is exactly the finance status row: `user_id`,
 * `subscription_status`, `ended_at`, `bought_tier`, mapped field by field, so
 * no Stripe id or any other column travels on. Detached rows (`user_id` NULL,
 * a deleted account) are dropped, as R-c did. Two rows for one account in one
 * mode is an ERROR (BD-16), never a guess; UNIQUE makes it unreachable, so it
 * is a defence only.
 *
 * Fails closed: an unknown or missing key returns an error and reads nothing.
 * Never throws: every function returns `{ data, error }`.
 *
 * Server-only: the reader holds the service-role client. The callers are the
 * finance wiring, reached only from the admin finance route after
 * `requireAdmin`, and the snapshot job, which picks the same wiring.
 *
 * @module lib/admin/billing/currentModeBillingStatus
 */

import 'server-only';

import {
  businessOsBillingAdminReadRepository,
  type AdminBillingReadOptions,
  type AdminBillingRow,
  type BusinessOsBillingAdminReadRepository,
} from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

/** One account's billing status in the current mode (the finance status row's shape). */
export interface CurrentModeBillingStatusRow {
  user_id: string;
  subscription_status: string | null;
  ended_at: string | null;
  bought_tier: string | null;
}

interface Result<T> {
  data: T | null;
  error: Error | null;
}

/** For tests: the reader and the mode. Production uses P-8a's singleton and the server key. */
export interface CurrentModeBillingStatusDeps {
  reader?: Pick<BusinessOsBillingAdminReadRepository, 'listBillingRowsForModeAllAccounts' | 'findBillingRowForAccount'>;
  mode?: () => StripeMode;
}

/** Two rows for one account in one mode (BD-16): an error, never a guess. */
export class CurrentModeBillingDuplicateError extends Error {
  constructor(duplicates: number) {
    super(`Billing status read returned ${duplicates} duplicate account row(s) in one mode`);
    this.name = 'CurrentModeBillingDuplicateError';
  }
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** The resolved mode as the reader spells it, or the fail-closed error. */
function resolveMode(deps: CurrentModeBillingStatusDeps): Result<boolean> {
  try {
    return { data: isLiveMode((deps.mode ?? currentStripeMode)()), error: null };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

/** Field by field: only the four status fields cross this line. */
function toStatus(row: Pick<AdminBillingRow, 'subscription_status' | 'ended_at' | 'bought_tier'>, userId: string): CurrentModeBillingStatusRow {
  return {
    user_id: userId,
    subscription_status: row.subscription_status,
    ended_at: row.ended_at,
    bought_tier: row.bought_tier,
  };
}

/**
 * R-c, current mode. Every account's billing status in the current Stripe mode.
 * `opts` (page size, ceiling) go to the reader, which pages at ≤ 1,000 and errors
 * at its ceiling.
 */
export async function listCurrentModeBillingStatusesAllAccounts(
  opts?: AdminBillingReadOptions,
  deps: CurrentModeBillingStatusDeps = {}
): Promise<Result<CurrentModeBillingStatusRow[]>> {
  const mode = resolveMode(deps);
  if (mode.error || mode.data === null) return { data: null, error: mode.error ?? new Error('stripe_key_mode_unknown') };

  const reader = deps.reader ?? businessOsBillingAdminReadRepository;
  const result = await reader.listBillingRowsForModeAllAccounts(mode.data, opts);
  if (result.error || !result.data) return { data: null, error: result.error ?? new Error('Billing status read returned no data') };

  const rows: CurrentModeBillingStatusRow[] = [];
  for (const row of result.data) {
    if (row.user_id === null) continue;
    rows.push(toStatus(row, row.user_id));
  }
  const accounts = new Set(rows.map((row) => row.user_id));
  if (accounts.size !== rows.length) return { data: null, error: new CurrentModeBillingDuplicateError(rows.length - accounts.size) };
  return { data: rows, error: null };
}

/** R-c′, current mode. One account's billing status in the current Stripe mode, or `null`. */
export async function findCurrentModeBillingStatusForAccount(
  accountId: string,
  deps: CurrentModeBillingStatusDeps = {}
): Promise<Result<CurrentModeBillingStatusRow | null>> {
  const mode = resolveMode(deps);
  if (mode.error || mode.data === null) return { data: null, error: mode.error ?? new Error('stripe_key_mode_unknown') };

  const reader = deps.reader ?? businessOsBillingAdminReadRepository;
  const result = await reader.findBillingRowForAccount(accountId, mode.data);
  if (result.error) return { data: null, error: result.error };
  if (!result.data || result.data.user_id === null) return { data: null, error: null };
  return { data: toStatus(result.data, result.data.user_id), error: null };
}
