// lib/business-os/entitlements/shadow.ts
//
// SHADOW MODE — what the resolver WOULD have answered, while nothing is blocked.
//
// Workplan §4.10 (FR-22, AC-7, RC-6, RC-7, WC-21).
//
// ── THE ONE RULE THIS FILE EXISTS TO KEEP ───────────────────────────────────
// **It can never affect the request it is observing.** Not by throwing, not by
// rejecting, not by making it slower. A customer's chat turn must be exactly as
// reliable with entitlements switched on as with them off — because for the
// whole of Slice 1 they ARE off as far as the customer is concerned.
//
// Three mechanisms, each doing a different job:
//
//   1. **`off` returns before anything is imported.** The mode check is the
//      first statement and the only top-level import besides the logger. With
//      `BOS_ENTITLEMENTS_MODE` unset — the default, and production today — this
//      function reads nothing, writes nothing, loads no config and allocates
//      almost nothing. A bad entitlement config cannot take chat down at cold
//      start, because with the flag off it is never loaded (RC-7).
//   2. **Everything else happens inside `void (async () => { try { … } })()`.**
//      Not awaited, so the response does not wait for it; wrapped in `try`, so a
//      failure is a log line. `await import()` inside the try means even a
//      module that throws while loading — a Zod error in config — is caught.
//   3. **The repository swallows its own errors** and returns `{ error }`, so a
//      database failure is already not an exception by the time it reaches here.
//
// ── WHY `allowed` IS RECORDED TOO (RC-6) ────────────────────────────────────
// Production ships with NO tiers and every existing account as a champion, so
// every decision today is `allowed`. A recorder that only logged would-be
// denials would produce an empty report and the first tier would be designed on
// nothing. What we need to learn is what accounts actually USE — the denials
// come later, from the `asTier` replay in `report.ts`.

import { createLogger } from '@/lib/logger';
import { getEntitlementMode } from './mode';

const logger = createLogger({ module: 'BusinessOsEntitlementsShadow' });

/** What the chat hook hands over. Structurally typed so the route stays uncoupled. */
export interface ShadowChatInput {
  userId: string;
  /** The planned turn. Only `steps` is read. */
  plan: { steps: unknown[] };
  correlationId?: string | null;
}

/**
 * Record what this chat turn would have needed. Fire and forget.
 *
 * Returns `void`, never a promise: a caller cannot await it by accident, which
 * is the point — `await`ing would put entitlement resolution on the response
 * path of a turn that is not being gated by it.
 */
export function shadowChatPlan(input: ShadowChatInput): void {
  // Statement one. Nothing above it, nothing imported for it.
  if (getEntitlementMode() === 'off') return;

  void (async () => {
    try {
      // Lazy, and inside the try: a config that fails to load must be a logged
      // error here, not an unhandled rejection in a chat request.
      const [
        { capabilitiesForPlan },
        { getEntitlementService },
        { decide },
        { getEntitlementConfig },
        { resolveAccountId },
        repositoryModule,
      ] = await Promise.all([
        import('./planCapabilities'),
        import('./EntitlementService'),
        import('./decide'),
        import('./source'),
        import('./account'),
        import('@/lib/repositories/BusinessOsEntitlementShadowRepository'),
      ]);

      // SA R4-2. A user is an account *today* (T-2), and this is precisely the
      // call site that would be missed when that stops being true: the id is
      // resolved once here, then used for the snapshot AND for the recorded
      // row, so the two can never disagree about whose usage this was.
      const accountId = resolveAccountId(input.userId);

      const { requests, gaps } = capabilitiesForPlan(input.plan as { steps: never[] });
      if (requests.length === 0 && gaps.length === 0) return;

      for (const gap of gaps) {
        // An unmapped entity would decide whether an owner can do something,
        // once enforcement is on. It is a defect, not a data point.
        if (gap.reason === 'unmapped_entity') {
          logger.error(
            { userId: input.userId, entity: gap.entity, op: gap.op, correlationId: input.correlationId },
            'Chat step maps to no capability; FR-8 says every action must be classified'
          );
        }
      }

      if (requests.length === 0) return;

      const config = getEntitlementConfig();
      const service = getEntitlementService();

      // ONE read for the whole turn. `getSnapshot` is used rather than
      // `check()` per capability because the answer for every capability comes
      // from the same snapshot at the same instant — and because shadow mode
      // has no balance question to ask (nothing is metered until Slice 3), so
      // going through `check()` would only add a cache lookup per capability.
      const snapshot = await service.getSnapshot(accountId);

      if (snapshot.unavailable || !snapshot.resolution) {
        logger.warn(
          { accountId, correlationId: input.correlationId },
          'Shadow: entitlement inputs unavailable; nothing recorded for this turn'
        );
        return;
      }

      // Fold to one row per (capability, surface, outcome, rule). The RPC folds
      // duplicates too, so this is about payload size rather than correctness.
      const folded = new Map<string, { capability: string; surface: string; outcome: string; rule: string; hits: number; items_total: number; items_max: number }>();

      for (const request of requests) {
        const decision = decide({
          config,
          resolution: snapshot.resolution,
          capability: request.capability,
          request: { surfaceKind: request.surface },
        });

        const key = `${request.capability}|${request.surface}|${decision.outcome}|${request.rule}`;
        const existing = folded.get(key);

        if (existing) {
          existing.hits += 1;
          existing.items_total += request.plannedItems;
          existing.items_max = Math.max(existing.items_max, request.plannedItems);
        } else {
          folded.set(key, {
            capability: request.capability,
            surface: request.surface,
            outcome: decision.outcome,
            rule: request.rule,
            hits: 1,
            items_total: request.plannedItems,
            items_max: request.plannedItems,
          });
        }

        // `debug` for allowed, `info` for anything else: in shadow mode a
        // would-be refusal is the interesting line, and today there should be
        // none (no tiers, everyone a champion).
        const line = { accountId, capability: request.capability, surface: request.surface, outcome: decision.outcome, rule: request.rule, state: decision.state, correlationId: input.correlationId };
        if (decision.outcome === 'allowed') logger.debug(line, 'Shadow decision');
        else logger.info(line, 'Shadow decision (would not have been a plain allow)');
      }

      const rows = [...folded.values()].map((row) => ({
        user_id: accountId,
        capability: row.capability,
        surface: row.surface,
        outcome: row.outcome,
        rule: row.rule,
        hits: row.hits,
        items_total: row.items_total,
        items_max: row.items_max,
        sample_correlation_id: input.correlationId ?? null,
      }));

      const result = await repositoryModule.businessOsEntitlementShadowRepository.recordEvents(rows);

      if (result.error) {
        // Already logged by the repository; this line says which turn it was.
        logger.warn(
          { accountId, correlationId: input.correlationId, rows: rows.length },
          'Shadow events were not recorded'
        );
      }
    } catch (err) {
      // The catch-all that makes the promise above safe to ignore. Anything
      // that gets here — a bad config, a broken import, a programming error in
      // this module — is observability failing, not the product.
      logger.error({ err, userId: input.userId, correlationId: input.correlationId }, 'Shadow recording failed');
    }
  })();
}
