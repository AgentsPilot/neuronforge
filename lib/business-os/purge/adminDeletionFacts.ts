// lib/business-os/purge/adminDeletionFacts.ts
//
// Admin delete AD-2a (T2): the READ helpers behind R-1 … R-8, extracted from
// `AdminDeletionPreview.ts` so the preview, the commit's evaluation 1 and its
// evaluation 2 (the `preCommitGate`, immediately before the RPC) share ONE
// code path (requirement FR-A7, AC-A8). A fact read differently at commit than
// at preview would be a second, untested rule.
//
// ── What this file never does ───────────────────────────────────────────────
//   * write anything, delete, snapshot or take the advisory lock. Every read is
//     a repository (service role, documented at each repository) or
//     `AdminAccessService`; no Supabase client is imported here;
//   * count rows. The commit's evaluations read facts only (workplan R-5, the
//     60 s budget); counting is the preview's job (`buildPurgePreview`);
//   * log an email or a business name (SC-10). Ids, codes and counts only.
//
// Every read fails CLOSED: a failure is `'unreadable'` / `null` / a `refused`
// local precondition, which the pure evaluator turns into `unverified`.

import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';
import { runSchemaReconciler, type SchemaReconcileResult } from './SchemaReconciler';
import { runDeleteGraphCheck, type DeleteGraphStatus } from './deleteGraph';
import { decideLocalPrecondition, type LocalPreconditionResult } from './localPrecondition';
import { isPlanSubscriptionLive, type AdminDeletionLaterFacts, type PlanBillingFact } from './adminDeletionRefusals';
import type { PurgeLevel, PurgeOptions } from './types';

const logger = createLogger({ module: 'AdminDeletionFacts' });

/** One `livemode` row of the plan billing account, reduced to R-3's facts. */
export async function readPlanBilling(targetId: string, livemode: boolean): Promise<PlanBillingFact> {
  try {
    const { data, error } = await businessOsBillingAccountRepository.findByUser(targetId, livemode);
    if (error) return 'unreadable';
    if (!data) return { row: null };
    return {
      row: { status: data.subscriptionStatus, stripeSubscriptionId: data.stripeSubscriptionId, endedAt: data.endedAt },
    };
  } catch {
    // The repository never throws; if it ever does, a failed read is a refusal.
    return 'unreadable';
  }
}

/**
 * Plan payments P-3b.1 (PF-13, SA Q-6): does the account hold a plan
 * subscription Stripe may still bill, in EITHER mode?
 *
 * The same reads and the same rule as deletion's R-3 (`readPlanBilling` +
 * `isPlanSubscriptionLive`), so "subscribed" means one thing on the platform.
 * The admin entitlements route uses it to keep the credit-period anchor of a
 * subscribed account. Both modes, because test and live rows share this
 * database and a test-mode subscription re-asserts the same plan row; and so
 * the answer never depends on which Stripe key this deployment holds.
 *
 * `null` = could not tell (either read failed): the caller refuses.
 */
export async function hasLivePlanSubscription(accountId: string): Promise<boolean | null> {
  const [test, live] = await Promise.all([readPlanBilling(accountId, false), readPlanBilling(accountId, true)]);
  if (test === 'unreadable' || live === 'unreadable') return null;
  return [test.row, live.row].some((row) => row !== null && isPlanSubscriptionLive(row));
}

export async function readConnectAccountCount(targetId: string): Promise<number | 'unreadable'> {
  try {
    const accounts = await businessPurgeRepository.resolveConnectAccounts(targetId);
    return accounts.length;
  } catch {
    // The resolver throws on a failed read so that `[]` always means "none".
    return 'unreadable';
  }
}

export async function readLocalBlocking(targetId: string): Promise<LocalPreconditionResult> {
  try {
    return decideLocalPrecondition(await businessPurgeRepository.countLocalBlockingState(targetId));
  } catch (err) {
    // A fixed reason, never `err.message`: this string reaches the admin's
    // response in R-6's message, with no dev-only guard (AD-1b QA Low-1).
    // The error itself goes to the log, with ids only.
    logger.error({ err, targetId }, 'Admin deletion: local blocking-state read threw');
    return { outcome: 'refused', reason: 'the read failed' };
  }
}

/** The business name for the dialog header. A failed read is not a refusal: it is display only. */
export async function readBusinessName(targetId: string): Promise<{ name: string | null; unreadable: boolean }> {
  try {
    const { data, error } = await businessProfileRepository.findByUserId(targetId);
    if (error) return { name: null, unreadable: true };
    return { name: data?.company_name ?? null, unreadable: false };
  } catch {
    return { name: null, unreadable: true };
  }
}

/**
 * Is this user an admin? R-2's fact for the target, and the commit's re-check
 * of the ACTOR (AC2-7). Tri-state (`null` = could not tell,
 * which refuses). `fresh` bypasses the admin cache and its stale fallback
 * (SA T-8 / AC2-7): the commit always passes it, the read-only preview does not.
 */
export async function readAdminStatus(
  target: { id: string; email: string | null },
  opts: { fresh: boolean },
): Promise<boolean | null> {
  return AdminAccessService.getInstance().checkAdminStatus(target, { fresh: opts.fresh });
}

/** The facts behind R-3 … R-8, plus the full reconciler result (for its fingerprint). */
export interface GatheredLaterFacts {
  later: AdminDeletionLaterFacts;
  schema: SchemaReconcileResult;
}

/**
 * Read every fact R-3 … R-8 needs, sequentially (each is cheap). Never throws:
 * each helper fails closed on its own.
 *
 * `deleteGraph` is the caller's when it already holds one (the preview's
 * `buildPurgePreview` computed it for the same level and options); otherwise
 * it is read here for `level` / `options`.
 */
export async function gatherAdminDeletionLaterFacts(params: {
  targetId: string;
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId: string;
  deleteGraph?: { status: DeleteGraphStatus };
}): Promise<GatheredLaterFacts> {
  const { targetId, level, options, correlationId } = params;

  // Never throws: an unreadable schema is R-8 `unverified`, and the other
  // refusals still evaluate (SA further condition 3, AD-1b).
  const schema = await runSchemaReconciler({ correlationId });
  const deleteGraph = params.deleteGraph ?? (await runDeleteGraphCheck({ level, options, correlationId }));
  const billing = {
    test: await readPlanBilling(targetId, false),
    live: await readPlanBilling(targetId, true),
  };
  const connectAccounts = await readConnectAccountCount(targetId);
  const localBlocking = await readLocalBlocking(targetId);

  return {
    schema,
    later: {
      billing,
      connectAccounts,
      localBlocking,
      schema: { status: schema.status, unclassified: schema.unclassified, missingDeletable: schema.missingDeletable },
      deleteGraph: { status: deleteGraph.status },
    },
  };
}
