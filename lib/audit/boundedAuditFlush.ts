// lib/audit/boundedAuditFlush.ts
//
// Write an audit entry BEFORE the handler responds, within a bounded budget.
//
// Why this exists at all: `AuditTrail.log()` only QUEUES. On a serverless
// runtime the instance is free to freeze the moment the response is sent, so an
// entry still sitting in the queue is lost — production showed exactly that for
// logout on 2026-09-19 (FR-29, Layer 3 KI-F). A refusal has the same shape and
// worse odds: a 403 returns in milliseconds and nothing else on that instance
// will ever flush the queue.
//
// Extracted from `clientAuditWrite.ts`'s `logAndFlushOnLogout`, which this now
// backs, with ONE deliberate improvement over the original — see SERIALISATION.
//
// ── Contract ───────────────────────────────────────────────────────────────
// NEVER THROWS, NEVER REJECTS. A timeout warns, a failure logs at error, and
// the caller continues either way. That is load-bearing: the two call sites are
// an admin gate about to return 403 and a page gate about to call `redirect()`,
// and neither may be turned into a 500 by the audit trail.
//
// Logs carry ids and event names only — never an email, a body or a header.
//
// ── SERIALISATION (SA review M-1) ──────────────────────────────────────────
// `AuditTrailService.flush()` opens with
// `if (this.isFlushing || this.logQueue.length === 0) return;` and clears the
// queue BEFORE awaiting the insert. So two concurrent callers on one instance
// used to behave like this (A and B are both `logAndFlush` callers — read the
// SCOPE note below before relying on this):
//
//   A: log(A) → queue [A];  flush() sets isFlushing, takes [A], awaits
//   B: log(B) → queue [B];  flush() sees isFlushing and RETURNS IMMEDIATELY,
//                           having written nothing — and reported success
//
// B then depended on the 5 s batch timer, and the instance freezes first. The
// row was lost silently. Logouts are rare and never concurrent, so this was
// latent in the original; refusals arrive in bursts (one probe, or one
// non-admin client firing several `/api/admin/*` calls), so here it would be
// the normal case.
//
// Fix: a module-level promise chain, so B waits for A's flush to SETTLE and
// then flushes its own entry with `isFlushing` clear. Two constraints:
//
//   1. The chain wait sits INSIDE the raced promise, so the 2 s budget is total
//      per request — two queued refusals can never add up to 4 s on a 403.
//   2. A chain link must never reject, or the chain is poisoned for the life of
//      the instance. `pending` therefore holds the SWALLOWED continuation; the
//      caller awaits the raw link and `logAndFlush` catches it.
//
// `AuditTrailService` itself is untouched (the constraint the logout work
// accepted as its D-4). The chain's scope is the module instance, which is the
// serverless instance.
//
// ── SCOPE of the fix, stated exactly (SA code review C-3) ────────────────
// The chain serialises `logAndFlush` callers AGAINST EACH OTHER ONLY. It does
// not serialise them against the other `AuditTrail.flush()` callers on the same
// instance, and there are many: the batch interval (`AuditTrailService.ts:290`),
// `log()`'s own batch-size flush (`:123`), `shutdown()` (`:590`), the exported
// `auditFlush()` (`:647`) and its process-exit caller (`:636`), plus a dozen
// awaited route-level flushes (`app/api/admin/archiving/runs/route.ts:178`,
// `:187`, `:203`, the admin entitlements and invites routes, the public
// invite-validate route, `lib/business-os/invites/redemptionDeps.ts:92`).
//
// So the SAME row loss is still reachable — identical mechanism, different
// concurrent party: if any of those flushes is in flight when a refusal calls
// `logAndFlush`, this helper's `flush()` hits the `isFlushing` early return,
// resolves reporting success, and the entry falls back to the 5 s batch timer
// that a freezing instance beats. What the chain removes is the case this slice
// creates and makes common — refusals arriving in bursts — not the whole class.
//
// Closing the class means serialising inside `AuditTrailService.flush()`
// itself, which is deliberately out of scope here (D-4: this work does not
// modify the service every audit write in the platform goes through). Recorded
// as an accepted risk in the workplan's §10 rather than silently narrowed.
//
// Known, accepted: if a flush HANGS, the caller times out at 2 s while the
// chain stays blocked behind it, so a second caller also times out. That is
// still strictly better than the old behaviour, which reported success and
// dropped the row — but note what the second caller's state actually is: its
// `log()` has NOT run yet (it sits behind the hung link), so its entry is not
// in the queue and the 5 s batch timer cannot save it. Both entries are written
// by the chain as soon as the hung flush settles, and lost if the instance
// freezes first. The first caller's entry, by contrast, IS queued.

import { AuditTrail } from '@/lib/services/AuditTrailService';
import type { AuditLogInput } from './types';
import { AUDIT_FLUSH_TIMEOUT_MS } from './auditTimeouts';

/**
 * How long a request waits for the audit queue to be written. Bounded, so a
 * slow database delays a response but can never hold one open. Defined in the
 * zero-import `auditTimeouts.ts` (shared with `AuditTrailService.writeNow`
 * without the two modules importing each other) and re-exported here.
 */
export { AUDIT_FLUSH_TIMEOUT_MS };

/**
 * Only the levels this helper uses, typed structurally so a Pino `Logger`, a
 * child logger and `requireAdminRoute`'s `AdminGateLogger` all satisfy it with
 * no cast.
 */
export interface AuditFlushLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

/**
 * What the two log lines say. `reason` names the event being recorded and
 * `continues` names what happens regardless, because "the request continues"
 * is the whole point of the bound and the operator reading the line needs to
 * know nothing was blocked.
 */
export interface AuditFlushContext {
  /** e.g. 'logout', 'refused admin access'. */
  reason: string;
  /** e.g. 'logout continues', 'the refusal is unaffected'. */
  continues: string;
}

/**
 * The two calls this helper makes on the audit trail. `AuditTrail`, the
 * singleton, by default.
 *
 * Plan payments P-3b.1 (`recordPlanChange`, SA Q-5): the admin entitlements
 * route reaches the service through `AuditTrailService.getInstance()`, and its
 * route suite pins the audit entry through that seam byte for byte (SA C-8: the
 * suite must not change). Passing the instance the caller already holds keeps
 * the bound and the serialising chain without changing which object the entry
 * goes through. In production both are the same singleton.
 */
export interface AuditSink {
  log: (entry: AuditLogInput) => Promise<void>;
  flush: () => Promise<void>;
}

/**
 * The serialising chain. Holds the SWALLOWED continuation of the last link, so
 * one failure can never poison it (M-1 constraint 2).
 */
let pending: Promise<void> = Promise.resolve();

/**
 * Queue the entry behind any flush already in flight, then flush.
 *
 * `log()` is awaited, unlike almost every other audit write: it resolves once
 * the entry is QUEUED (it writes nothing unless the batch is full), and a
 * `flush()` called before that would find the entry not yet in the queue.
 *
 * The returned promise MAY reject (the caller handles it). `pending` never does.
 */
function enqueue(entry: AuditLogInput, sink: AuditSink): Promise<void> {
  const link = pending.then(() => sink.log(entry)).then(() => sink.flush());
  pending = link.then(
    () => undefined,
    () => undefined
  );
  return link;
}

/**
 * Record one audit entry and write it out before responding, within
 * AUDIT_FLUSH_TIMEOUT_MS. Resolves either way; never rejects.
 */
export async function logAndFlush(
  entry: AuditLogInput,
  logger: AuditFlushLogger,
  context: AuditFlushContext,
  sink: AuditSink = AuditTrail
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), AUDIT_FLUSH_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([enqueue(entry, sink).then(() => 'flushed' as const), timeout]);
    if (outcome === 'timeout') {
      logger.warn(
        { userId: entry.userId ?? null, action: entry.action, timeoutMs: AUDIT_FLUSH_TIMEOUT_MS },
        `Audit flush on ${context.reason} timed out; ${context.continues}`
      );
    }
  } catch (err) {
    logger.error(
      { err, userId: entry.userId ?? null, action: entry.action },
      `Audit flush on ${context.reason} failed; ${context.continues}`
    );
  } finally {
    // Always, including on the flushed path: an un-cleared 2 s timer keeps the
    // event loop awake on behalf of a race that is already decided.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Test seam only. Jest keeps module state for the whole file, so a test that
 * deliberately hangs a flush would otherwise block every later test behind it.
 * Not exported through any barrel and never called by application code.
 */
export function __resetAuditFlushChainForTests(): void {
  pending = Promise.resolve();
}
