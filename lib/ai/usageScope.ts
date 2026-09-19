// lib/ai/usageScope.ts
//
// An in-process accumulator for the LLM calls made during one unit of work.
//
// A caller opens a scope for a grouping id with `withUsageScope`; every call
// that goes through BaseAIProvider.callWithTracking inside it reports itself
// through `notifyUsage`, and the scope returns what was collected. This is how
// Business OS Layer 3 totals one AI action for its audit entry without reading
// the usage ledger back (requirement FR-8, SA OQ-4).
//
// Deliberately generic: no Business OS imports, no knowledge of areas or audit
// entries, so the provider layer stays product-agnostic and the agents side is
// unaffected. The rules (SA conditions on this pattern):
//   - Outside a scope, `notifyUsage` is a single AsyncLocalStorage lookup and
//     returns. Nothing else changes and nothing is awaited.
//   - Only the INNERMOST scope is told about a call. A nested scope (its own
//     grouping id) shadows its parent.
//   - A call whose `sessionId` differs from the scope's grouping id is left
//     out and logged at warn: it means a call site is wired to the wrong group
//     (or to none).
//   - A scope is CLOSED when its function settles. Work it started without
//     awaiting (fire-and-forget) keeps the async context, so its later calls
//     would otherwise land in a scope whose result was already used. They are
//     dropped with a debug log instead.
//   - `notifyUsage` never throws into the call it is reporting.
//   - `withUsageScope` never swallows the function's error: it hands it back,
//     so the caller can record the outcome and rethrow it unchanged.
//
// Node runtime only (node:async_hooks). No route that uses the provider layer
// declares the Edge runtime.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageScope' });

/** One LLM call, as reported by the provider layer. No prompt, no output, no error text. */
export interface UsageCallRecord {
  /** The ledger `feature` (for Business OS: `business-os-<area>`). */
  feature: string;
  /** The ledger `component` (for Business OS: the catalog call name). */
  component: string;
  provider: string;
  model: string;
  /** The grouping id the call was made under (the ledger `session_id`). */
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  success: boolean;
  /** The provider error's `code` on failure. Never its message. */
  errorCode?: string;
}

export interface UsageScopeResult {
  /** The calls that belong to this scope, in the order they finished. */
  calls: UsageCallRecord[];
  /** Calls made inside the scope under a different grouping id (a wiring bug). */
  excluded: number;
}

export type UsageScopeOutcome<T> =
  | { ok: true; value: T; usage: UsageScopeResult }
  | { ok: false; error: unknown; usage: UsageScopeResult };

interface Scope {
  groupId: string;
  calls: UsageCallRecord[];
  excluded: number;
  closed: boolean;
}

const storage = new AsyncLocalStorage<Scope>();

/**
 * Run `fn` inside a new innermost scope for `groupId`, and return its value
 * (or its error) together with the calls it made. Never throws.
 */
export async function withUsageScope<T>(groupId: string, fn: () => Promise<T>): Promise<UsageScopeOutcome<T>> {
  const scope: Scope = { groupId, calls: [], excluded: 0, closed: false };
  try {
    const value = await storage.run(scope, fn);
    return { ok: true, value, usage: snapshot(scope) };
  } catch (error) {
    return { ok: false, error, usage: snapshot(scope) };
  } finally {
    scope.closed = true;
  }
}

function snapshot(scope: Scope): UsageScopeResult {
  return { calls: [...scope.calls], excluded: scope.excluded };
}

/**
 * Report one finished LLM call to the innermost open scope, if there is one.
 * Called by BaseAIProvider.callWithTracking exactly once per call. Never throws.
 */
export function notifyUsage(call: UsageCallRecord): void {
  try {
    const scope = storage.getStore();
    if (!scope) return;

    if (scope.closed) {
      logger.debug(
        { groupId: scope.groupId, feature: call.feature, component: call.component },
        'LLM call finished after its usage scope closed; not counted'
      );
      return;
    }

    if (call.sessionId !== scope.groupId) {
      scope.excluded++;
      logger.warn(
        { groupId: scope.groupId, callSessionId: call.sessionId ?? null, feature: call.feature, component: call.component },
        'LLM call inside a usage scope carries a different grouping id; left out of the scope'
      );
      return;
    }

    scope.calls.push({ ...call });
  } catch (err) {
    // The call it reports has already happened; accounting must never fail it.
    logger.warn({ err }, 'Usage scope notification failed');
  }
}

/** Whether a usage scope is open for the current async context. */
export function hasActiveUsageScope(): boolean {
  const scope = storage.getStore();
  return !!scope && !scope.closed;
}
