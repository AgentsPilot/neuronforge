// lib/services/FreeTierGrantService.ts
// The once-only, race-safe free-tier grant (S-6 fix).
//
// Design: docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md §2.3–§2.5 and the
// SA review (Q1–Q8, RC-1 to RC-9). In short:
//   - `free_tier_granted_at IS NOT NULL` is the "already granted" marker. Every
//     write is conditional on it being NULL, so Postgres decides who wins a race.
//   - A frozen account is never granted (RC-1), and `account_frozen` is never
//     written on an existing row.
//   - Repeat calls cost one SELECT and write nothing (RC-7): the grant state is
//     read before config and pricing are loaded.
//   - The loop is bounded on every path, including insert conflicts (RC-2).
//
// The caller (the route) is responsible for authentication: `userId` passed in
// here must be the authenticated session user, never a request-supplied id.

import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';
import {
  systemConfigRepository as defaultSystemConfigRepository,
  type SystemConfigRepository,
} from '@/lib/repositories/SystemConfigRepository';
import {
  userSubscriptionRepository as defaultUserSubscriptionRepository,
  type UserSubscriptionRepository,
} from '@/lib/repositories/UserSubscriptionRepository';
import type { FreeTierGrantPatch, UserSubscriptionGrantState } from '@/lib/repositories/types';

// No `credit_transactions` ledger row is written for the grant. Check C2 (2026-09-20)
// showed `credit_transactions_activity_type_check` does not allow 'free_tier_grant',
// and widening a CHECK is out of scope for this P0 (SA Q4 fallback). Reusing
// 'welcome_bonus' or 'reward_credit' is forbidden: the Stripe webhook queries both.
// The grant stays traceable through `free_tier_granted_at` / `free_tier_initial_amount`
// and the FREE_TIER_ALLOCATED audit entry. See workplan §8.1 F-4 for the migration.

/** Bounded retry for lost races (balance moved / concurrent insert). */
export const MAX_GRANT_ATTEMPTS = 3;

export const FREE_TIER_CONFIG_KEYS = [
  'free_tier_pilot_tokens',
  'free_tier_storage_mb',
  'free_tier_executions',
  'free_tier_duration_days',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config (Q8: today's defaults preserved exactly; invalid present values fail closed)
// ---------------------------------------------------------------------------

const freeTierConfigSchema = z.object({
  pilotTokens: z.number().finite().int().nonnegative(),
  storageMb: z.number().finite().int().nonnegative(),
  /** `null` = unlimited. A MISSING key parses to 0, exactly as before (Q8 (a)). */
  executions: z.number().finite().int().nonnegative().nullable(),
  durationDays: z.number().finite().int().positive(),
});

export type FreeTierConfig = z.infer<typeof freeTierConfigSchema>;

export class FreeTierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreeTierConfigError';
  }
}

/**
 * Same parsing the old route used (a number is taken as is, anything else goes
 * through `parseInt` with the documented default), so the amounts granted do not
 * change. The difference: a result that is not a valid number now fails closed.
 */
function parseNumeric(value: unknown, fallback: string): number {
  if (typeof value === 'number') return value;
  // `value || fallback` mirrors the old `parseInt(configMap[key] || '<default>')`.
  return parseInt(String((value as string | null | undefined) || fallback), 10);
}

export function parseFreeTierConfig(rows: ReadonlyArray<{ key: string; value: unknown }>): FreeTierConfig {
  const map = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
  const executionsRaw = map.get('free_tier_executions');

  const candidate = {
    pilotTokens: parseNumeric(map.get('free_tier_pilot_tokens'), '20834'),
    storageMb: parseNumeric(map.get('free_tier_storage_mb'), '1000'),
    executions: executionsRaw === null ? null : parseNumeric(executionsRaw, '0'),
    durationDays: parseNumeric(map.get('free_tier_duration_days'), '30'),
  };

  const parsed = freeTierConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new FreeTierConfigError(
      `Invalid free-tier configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface FreeTierAllocation {
  pilot_tokens: number;
  raw_tokens: number;
  /** Effective value written (for existing rows, never lower than before). */
  storage_mb: number;
  /** Effective value written. `null` = unlimited. */
  executions: number | null;
}

export type FreeTierGrantResult =
  | { status: 'GRANTED'; path: 'insert' | 'update'; attempts: number; allocation: FreeTierAllocation }
  | { status: 'ALREADY_GRANTED'; attempts: number }
  | { status: 'INELIGIBLE_FROZEN'; attempts: number }
  | { status: 'RETRY_EXHAUSTED'; attempts: number };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type ConfigReader = Pick<SystemConfigRepository, 'getByKeys'>;
type SubscriptionStore = Pick<
  UserSubscriptionRepository,
  'findGrantStateByUserId' | 'insertFreeTierRow' | 'applyFreeTierGrant'
>;
export interface FreeTierGrantServiceDeps {
  configRepository?: ConfigReader;
  subscriptionRepository?: SubscriptionStore;
  /** Pilot tokens → raw LLM tokens. Defaults to the shared pricing util. */
  toRawTokens?: (pilotTokens: number) => Promise<number>;
  now?: () => Date;
}

interface ResolvedGrantConfig {
  cfg: FreeTierConfig;
  rawTokens: number;
}

/**
 * The patch for an existing row (workplan §2.4, Q2 (a), Q3 (a)):
 * add tokens, keep `total_earned` cumulative, never lower a quota, and set an
 * expiry only when the row held no credits before (so the expiry cron can never
 * wipe purchased or reward credits).
 */
export function buildExistingRowPatch(
  row: UserSubscriptionGrantState,
  cfg: FreeTierConfig,
  rawTokens: number,
  now: Date
): FreeTierGrantPatch {
  const balanceBefore = row.balance ?? 0;
  const earnedBefore = row.total_earned ?? 0;
  const nowIso = now.toISOString();
  const hadNoCredits = balanceBefore === 0 && earnedBefore === 0;

  const executionsQuota =
    row.executions_quota === null || row.executions_quota === undefined || cfg.executions === null
      ? null
      : Math.max(row.executions_quota, cfg.executions);

  return {
    balance: balanceBefore + rawTokens,
    total_earned: earnedBefore + rawTokens,
    storage_quota_mb: Math.max(row.storage_quota_mb ?? 0, cfg.storageMb),
    executions_quota: executionsQuota,
    free_tier_granted_at: nowIso,
    free_tier_initial_amount: rawTokens,
    ...(hadNoCredits
      ? { free_tier_expires_at: new Date(now.getTime() + cfg.durationDays * DAY_MS).toISOString() }
      : {}),
    updated_at: nowIso,
  };
}

export class FreeTierGrantService {
  private readonly configRepository: ConfigReader;
  private readonly subscriptionRepository: SubscriptionStore;
  private readonly toRawTokens: (pilotTokens: number) => Promise<number>;
  private readonly now: () => Date;

  constructor(deps: FreeTierGrantServiceDeps = {}) {
    this.configRepository = deps.configRepository ?? defaultSystemConfigRepository;
    this.subscriptionRepository = deps.subscriptionRepository ?? defaultUserSubscriptionRepository;
    // The pricing util takes a client and reads `ais_system_config` itself; it is
    // used unchanged (workplan §8 lists it for the conformance sweep).
    this.toRawTokens = deps.toRawTokens ?? ((n) => pilotCreditsToTokens(n, supabaseServer));
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Grant the free tier to `userId` (the AUTHENTICATED user) at most once.
   * Throws on a DB read/write error or invalid configuration (→ 500).
   */
  async grant(userId: string, logger: Logger): Promise<FreeTierGrantResult> {
    let resolved: ResolvedGrantConfig | null = null;

    for (let attempt = 1; attempt <= MAX_GRANT_ATTEMPTS; attempt++) {
      const read = await this.subscriptionRepository.findGrantStateByUserId(userId);
      if (read.error) {
        throw new Error('Failed to read subscription grant state', { cause: read.error });
      }
      const row = read.data;

      // Repeat call: no config read, no write (RC-7).
      if (row && row.free_tier_granted_at !== null && row.free_tier_granted_at !== undefined) {
        logger.info({ attempts: attempt }, 'Free tier already granted');
        return { status: 'ALREADY_GRANTED', attempts: attempt };
      }

      // RC-1: a frozen account that never had the grant is not granted now.
      if (row && row.account_frozen === true) {
        logger.warn({ attempts: attempt }, 'Free tier refused: account is frozen and was never granted');
        return { status: 'INELIGIBLE_FROZEN', attempts: attempt };
      }

      // Loaded at most once, and only when a write is actually going to be attempted.
      resolved = resolved ?? (await this.loadGrantConfig(logger));
      const { cfg, rawTokens } = resolved;
      const now = this.now();

      if (!row) {
        const ins = await this.subscriptionRepository.insertFreeTierRow(userId, {
          rawTokens,
          storageMb: cfg.storageMb,
          executionsQuota: cfg.executions,
          grantedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + cfg.durationDays * DAY_MS).toISOString(),
        });
        if (ins.error || !ins.data) {
          throw new Error('Failed to insert free-tier subscription row', { cause: ins.error ?? undefined });
        }
        if (ins.data.inserted) {
          logger.info({ path: 'insert', rawTokens, attempts: attempt }, 'Free tier granted');
          return {
            status: 'GRANTED',
            path: 'insert',
            attempts: attempt,
            allocation: {
              pilot_tokens: cfg.pilotTokens,
              raw_tokens: rawTokens,
              storage_mb: cfg.storageMb,
              executions: cfg.executions,
            },
          };
        }
        if (ins.data.conflict) {
          // Conflict (23505): someone else created the row first. Re-read; counts toward the bound (RC-2).
          logger.debug({ attempt }, 'Free-tier insert lost a race; re-reading');
          continue;
        }
        // Neither inserted nor a conflict (SA RF-1): the outcome is unknown, so it is not
        // treated as a lost race. Retrying could find the row "already granted" and skip
        // the audit entry for a grant that did land. Fail closed instead (§2.3).
        throw new Error('Free-tier insert returned no row and no conflict');
      }

      const patch = buildExistingRowPatch(row, cfg, rawTokens, now);
      const upd = await this.subscriptionRepository.applyFreeTierGrant(userId, row.balance ?? null, patch);
      if (upd.error || !upd.data) {
        throw new Error('Failed to apply free-tier grant', { cause: upd.error ?? undefined });
      }
      if (upd.data.updated) {
        logger.info({ path: 'update', rawTokens, attempts: attempt }, 'Free tier granted');
        return {
          status: 'GRANTED',
          path: 'update',
          attempts: attempt,
          allocation: {
            pilot_tokens: cfg.pilotTokens,
            raw_tokens: rawTokens,
            storage_mb: patch.storage_quota_mb,
            executions: patch.executions_quota,
          },
        };
      }
      // 0 rows: granted meanwhile, frozen meanwhile, or the balance moved. Re-read decides.
      logger.debug({ attempt }, 'Free-tier update matched no row; re-reading');
    }

    // RC-3: onboarding hides this failure and does not retry, so ops must see it.
    logger.error({ attempts: MAX_GRANT_ATTEMPTS }, 'Free-tier grant retries exhausted');
    return { status: 'RETRY_EXHAUSTED', attempts: MAX_GRANT_ATTEMPTS };
  }

  private async loadGrantConfig(logger: Logger): Promise<ResolvedGrantConfig> {
    const { data, error } = await this.configRepository.getByKeys([...FREE_TIER_CONFIG_KEYS]);
    if (error || !data) {
      throw new Error('Failed to load free-tier configuration', { cause: error ?? undefined });
    }
    const cfg = parseFreeTierConfig(data);
    const rawTokens = await this.toRawTokens(cfg.pilotTokens);

    // Q8: the grant amount must be a finite integer > 0, or nothing is written.
    if (typeof rawTokens !== 'number' || !Number.isFinite(rawTokens) || !Number.isInteger(rawTokens) || rawTokens <= 0) {
      throw new FreeTierConfigError('Free-tier token amount is not a positive integer');
    }

    logger.debug(
      {
        pilotTokens: cfg.pilotTokens,
        rawTokens,
        storageMb: cfg.storageMb,
        executions: cfg.executions,
        durationDays: cfg.durationDays,
      },
      'Free-tier configuration loaded'
    );
    return { cfg, rawTokens };
  }

}

// Singleton instance for convenience
export const freeTierGrantService = new FreeTierGrantService();
