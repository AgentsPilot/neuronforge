// lib/business-os/entitlements/EntitlementService.ts
//
// THE ONE CALL EVERY SURFACE MAKES: `check(accountId, capability, request)`.
//
// Workplan §4.9 (T-2, T-3, T-5, S-6, RC-12, RC-13, A-2).
//
// ── WHY THERE IS A SERVICE AT ALL ───────────────────────────────────────────
// The resolver is pure and the decision is pure; both need inputs from the
// database. If every call site fetched its own, then every call site would also
// own the cache policy, the failure policy and the batching limit — and they
// would diverge. This is the only place that talks to the repository, so there
// is exactly one answer to "how stale may this be?" and "what happens when the
// database is down?".
//
// ── THE CACHE HOLDS INPUTS, NOT ANSWERS (S-6, RC-13) ────────────────────────
// Caching a resolved snapshot would freeze `now` into it, and a trial that ended
// thirty seconds ago would still look live. So the cache holds the raw plan row
// and overrides, and every call re-resolves against the current clock. Resolving
// is a loop over 37 catalog entries — microseconds — while the round trip is
// milliseconds, so this costs nothing and removes a whole class of bug.
//
// Staleness is bounded at 30 s and is **cross-instance**: another serverless
// instance may hold its own copy, so an admin change can take up to 30 s to be
// visible everywhere. That is why `effectiveWithinSeconds: 30` travels with
// every decision — a caller that cannot tolerate it knows, rather than guesses.
//
// ── WHY BATCH AND REPORT PATHS READ THROUGH ─────────────────────────────────
// The shadow report walks every account. Populating the cache with ten thousand
// entries would evict everything a live request needs, to serve a page nobody is
// waiting on. Batch reads therefore bypass the cache in both directions.

import { createLogger } from '@/lib/logger';
import {
  BOS_ENTITLEMENT_BATCH_LIMIT,
  businessOsAccountPlanRepository,
  type BusinessOsAccountPlanRepository,
  type BusinessOsEntitlementInputs,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { fromOverrideRow, fromPlanRow, type AccountId, type EntitlementAccount, type EntitlementOverride } from './account';
import { ALWAYS_SUFFICIENT, type AiActionBalanceSource } from './balance';
import { decide, failurePolicyFor, type EntitlementDecision, type EntitlementRequest } from './decide';
import { resolveEntitlements, type EntitlementResolution } from './resolver';
import { getEntitlementConfig, type EntitlementConfig, type TierMatrixSource } from './source';
import type { CatalogLike } from './schema';

const logger = createLogger({ service: 'BusinessOsEntitlementService' });

/** How long a cached set of inputs is fresh (T-5). Travels with every decision. */
export const CACHE_TTL_SECONDS = 30;

/**
 * How long past the TTL stale inputs are kept for fail-open surfaces.
 *
 * Ten minutes: long enough to ride out a database blip, short enough that a
 * revoked capability cannot survive a deploy cycle. Stale data is NEVER used for
 * an owner-paid answer (T-3).
 */
export const STALE_TOLERANCE_SECONDS = 600;

/** Bounded so a report or an attack cannot grow the heap (RC-13). */
export const CACHE_MAX_ENTRIES = 5000;

interface CacheEntry {
  inputs: { account: EntitlementAccount | null; overrides: EntitlementOverride[] };
  storedAtMs: number;
}

export interface EntitlementServiceOptions {
  repository?: Pick<BusinessOsAccountPlanRepository, 'findEntitlementInputs' | 'findEntitlementInputsBatch'>;
  balanceSource?: AiActionBalanceSource;
  /** Injected in tests. Production uses the wall clock. */
  now?: () => Date;
  /** Injected in tests so a fixture matrix can be resolved against. */
  configSource?: TierMatrixSource;
}

/** What `getSnapshot` returns: the resolution, or the reason there isn't one. */
export interface SnapshotResult {
  resolution: EntitlementResolution | null;
  /** True when the inputs could not be read at all (T-3). */
  unavailable: boolean;
  /** True when the inputs came from beyond the TTL. */
  stale: boolean;
}

export class EntitlementService {
  private readonly repository: NonNullable<EntitlementServiceOptions['repository']>;
  private readonly balanceSource: AiActionBalanceSource;
  private readonly now: () => Date;
  private readonly configSource?: TierMatrixSource;

  /** Insertion-ordered, which is what makes the eviction below LRU. */
  private readonly cache = new Map<AccountId, CacheEntry>();

  constructor(options: EntitlementServiceOptions = {}) {
    this.repository = options.repository ?? businessOsAccountPlanRepository;
    this.balanceSource = options.balanceSource ?? ALWAYS_SUFFICIENT;
    this.now = options.now ?? (() => new Date());
    this.configSource = options.configSource;
  }

  /** The config, loaded and validated on first use (lazily — RC-7). */
  private config(): EntitlementConfig {
    return this.configSource ? getEntitlementConfig(this.configSource) : getEntitlementConfig();
  }

  /**
   * The one call. Resolve, then answer the three questions in order (A-2).
   *
   * The balance source is consulted **only** when the capability is metered and
   * steps (a) and (b) have already passed — so Slice 3's ledger query will not
   * run for a request that was going to be refused anyway.
   */
  async check(accountId: AccountId, capability: string, request: EntitlementRequest): Promise<EntitlementDecision> {
    let config: EntitlementConfig;
    try {
      config = this.config();
    } catch (err) {
      // A config that does not load is our failure, not the customer's. Same
      // policy as an unreadable database: never `not_entitled`.
      logger.error({ err, accountId, capability, surfaceKind: request.surfaceKind }, 'Entitlement config failed to load');
      const policy = failurePolicyFor(undefined, request.surfaceKind);
      return {
        outcome: policy.outcome,
        capability,
        lowestTier: null,
        reason: `config_unavailable:${policy.reason}`,
        surfaceKind: request.surfaceKind,
        state: 'unknown',
      };
    }

    const snapshot = await this.getSnapshot(accountId, { config });

    // Step 0 is inside `decide`, so an unreadable account and a broken account
    // are handled by one policy rather than two.
    if (snapshot.unavailable || !snapshot.resolution) {
      return decide({
        config,
        resolution: null,
        capability,
        request,
        effectiveWithinSeconds: CACHE_TTL_SECONDS,
      });
    }

    const definition = (config.catalog as CatalogLike)[capability];
    const needsBalance = definition?.shape.kind === 'metered';

    // Owner-paid answers never come from stale data (T-3): a customer must not
    // be refused something they pay for on the strength of a ten-minute-old row.
    if (snapshot.stale && definition && (definition.audience === 'owner' || definition.audience === 'mixed')) {
      const policy = failurePolicyFor(definition, request.surfaceKind);
      return {
        outcome: policy.outcome,
        capability,
        lowestTier: null,
        reason: `stale_inputs:${policy.reason}`,
        surfaceKind: request.surfaceKind,
        state: snapshot.resolution.state,
        effectiveWithinSeconds: CACHE_TTL_SECONDS,
      };
    }

    let balance;
    if (needsBalance) {
      // Cheap today (ALWAYS_SUFFICIENT), a ledger query in Slice 3. Ordering the
      // steps so this runs last is what keeps that query off the refusal path.
      const provisional = decide({
        config,
        resolution: snapshot.resolution,
        capability,
        request,
        effectiveWithinSeconds: CACHE_TTL_SECONDS,
      });
      if (provisional.outcome !== 'allowed' && provisional.outcome !== 'allowed_with_warning') return provisional;

      try {
        balance = await this.balanceSource.check({ accountId, capability, cost: request.cost ?? 1 });
      } catch (err) {
        // A balance we cannot read must not refuse a call: the failure is ours.
        logger.error({ err, accountId, capability }, 'Balance source failed; allowing the call');
        balance = { sufficient: true };
      }
    }

    return decide({
      config,
      resolution: snapshot.resolution,
      capability,
      request,
      balance,
      effectiveWithinSeconds: CACHE_TTL_SECONDS,
    });
  }

  /**
   * The resolved snapshot for one account, from cache when it is fresh.
   *
   * Public because the admin inspect route and the shadow recorder both want
   * every capability at once rather than one decision.
   */
  async getSnapshot(
    accountId: AccountId,
    options: { config?: EntitlementConfig; bypassCache?: boolean } = {}
  ): Promise<SnapshotResult> {
    const config = options.config ?? this.config();
    const nowMs = this.now().getTime();

    const cached = options.bypassCache ? undefined : this.cache.get(accountId);
    const ageMs = cached ? nowMs - cached.storedAtMs : Infinity;

    if (cached && ageMs <= CACHE_TTL_SECONDS * 1000) {
      // Touch, so the map's insertion order stays "least recently used first".
      this.cache.delete(accountId);
      this.cache.set(accountId, cached);
      return { resolution: this.resolve(config, cached.inputs), unavailable: false, stale: false };
    }

    const result = await this.repository.findEntitlementInputs(accountId);

    if (result.error || !result.data) {
      if (cached && ageMs <= STALE_TOLERANCE_SECONDS * 1000) {
        logger.warn(
          { err: result.error, accountId, ageSeconds: Math.round(ageMs / 1000) },
          'Entitlement inputs unreadable; serving stale inputs'
        );
        return { resolution: this.resolve(config, cached.inputs), unavailable: false, stale: true };
      }

      logger.error({ err: result.error, accountId }, 'Entitlement inputs unreadable and nothing usable is cached');
      return { resolution: null, unavailable: true, stale: false };
    }

    const inputs = toDomain(result.data);
    if (!options.bypassCache) this.store(accountId, { inputs, storedAtMs: nowMs });

    return { resolution: this.resolve(config, inputs), unavailable: false, stale: false };
  }

  /**
   * Snapshots for many accounts — the report and cron path.
   *
   * Chunked at the repository's own limit (RC-12) and **read through**: it
   * neither reads nor writes the cache, so a report cannot evict the working set
   * of live requests.
   */
  async getSnapshots(accountIds: readonly AccountId[]): Promise<Map<AccountId, SnapshotResult>> {
    const config = this.config();
    const out = new Map<AccountId, SnapshotResult>();

    for (let i = 0; i < accountIds.length; i += BOS_ENTITLEMENT_BATCH_LIMIT) {
      const chunk = [...accountIds.slice(i, i + BOS_ENTITLEMENT_BATCH_LIMIT)];
      const result = await this.repository.findEntitlementInputsBatch(chunk);

      if (result.error || !result.data) {
        logger.error({ err: result.error, count: chunk.length }, 'Batch entitlement read failed');
        for (const id of chunk) out.set(id, { resolution: null, unavailable: true, stale: false });
        continue;
      }

      for (const id of chunk) {
        const inputs = result.data[id];
        out.set(id, {
          // A missing entry is an account with no plan row, which the resolver
          // reports as an anomaly rather than as unavailable — the read worked.
          resolution: this.resolve(config, inputs ? toDomain(inputs) : { account: null, overrides: [] }),
          unavailable: false,
          stale: false,
        });
      }
    }

    return out;
  }

  /**
   * Forget one account, on this instance.
   *
   * Called after every admin write. It cannot reach other serverless instances,
   * which is exactly the 30 s bound the module header describes — a fan-out
   * invalidation would need a broker this project does not have, for a staleness
   * window nothing in Slice 1 is sensitive to.
   */
  invalidate(accountId: AccountId): void {
    this.cache.delete(accountId);
  }

  /** Tests only. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Tests only: how many entries are held. */
  get cacheSize(): number {
    return this.cache.size;
  }

  private resolve(
    config: EntitlementConfig,
    inputs: { account: EntitlementAccount | null; overrides: EntitlementOverride[] }
  ): EntitlementResolution {
    return resolveEntitlements({
      config,
      account: inputs.account,
      overrides: inputs.overrides,
      addons: [],
      now: this.now(),
    });
  }

  private store(accountId: AccountId, entry: CacheEntry): void {
    this.cache.delete(accountId);
    this.cache.set(accountId, entry);

    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

function toDomain(inputs: BusinessOsEntitlementInputs): {
  account: EntitlementAccount | null;
  overrides: EntitlementOverride[];
} {
  return {
    account: inputs.plan ? fromPlanRow(inputs.plan) : null,
    overrides: inputs.overrides.map(fromOverrideRow),
  };
}

let defaultService: EntitlementService | null = null;

/** The shared instance. Its cache is per serverless instance, which is the point. */
export function getEntitlementService(): EntitlementService {
  if (!defaultService) defaultService = new EntitlementService();
  return defaultService;
}

/** Tests only. */
export function resetEntitlementService(): void {
  defaultService = null;
}
