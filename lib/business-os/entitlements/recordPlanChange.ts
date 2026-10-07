// lib/business-os/entitlements/recordPlanChange.ts
//
// What happens AFTER a plan row changed, whoever changed it: the entitlement
// cache is invalidated, and the audit entry is written and flushed before the
// caller responds (plan payments P-3b, SA-P3 c; workplan
// BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md §3.4).
//
// Two callers:
//   - the admin entitlements route (P-3b.1), which used to do these three
//     steps inline. It was refactored onto this helper with the same inputs and
//     the same order; its route suite pins the audit entry byte for byte and
//     runs unedited except the one SA-approved billing-repository mock
//     (SA C-8 ruling), which is the proof of no behaviour change;
//   - the webhook plan handler (P-3b.2), a system actor.
//
// ── ORDER ───────────────────────────────────────────────────────────────────
//   1. invalidate (local instance; other instances follow within the 30 s TTL)
//   2. log the audit entry
//   3. flush it, BOUNDED at 2 s (`logAndFlush`, SA Q-5). This is the one
//      behaviour change for the admin route: a hung flush now lets the response
//      go after 2 s instead of holding it open. `log()` only queues, and a
//      serverless instance can freeze the moment it responds (WC-7, PF-11).
//
// ── NEVER THROWS ────────────────────────────────────────────────────────────
// The plan row is already written when this runs. An audit or cache failure is
// logged at error; it must never turn a completed change into a 500 (or, for
// the webhook, into a released claim that applies nothing new on retry).
//
// ── THE SYSTEM ACTOR (SA Q-4) ───────────────────────────────────────────────
// `AuditTrailService` turns a missing actor into the OWNER
// (`actorId || userId`), which would record a Stripe payment as something the
// owner did to their own plan. So a system change is never written with a null
// actor: it carries `platformActorId()` (the D-3 convention for platform
// actions) and `details.actor = 'stripe_webhook'`.

import type { NextRequest } from 'next/server';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import type { AuditLogInput, AuditSeverity, EntityType } from '@/lib/audit/types';
import { platformActorId } from '@/lib/business-os/llm/aiActionAudit';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import type { AccountId } from './account';
import { getEntitlementService } from './EntitlementService';

/** Who changed the plan. A system change names its source; it never passes a null actor. */
export type PlanChangeActor = { kind: 'admin'; adminId: string } | { kind: 'system'; source: 'stripe_webhook' };

export interface RecordPlanChangeInput {
  accountId: AccountId;
  /** An `AUDIT_EVENTS` key. An unregistered one is still written, under its own name. */
  action: string;
  actor: PlanChangeActor;
  entityType: EntityType;
  entityId: string;
  changes: Record<string, unknown>;
  details: Record<string, unknown>;
  severity: AuditSeverity;
  request?: NextRequest;
  /** False for changes that touch no entitlement input (the admin credit ops). */
  invalidatesEntitlements: boolean;
  /** The caller's request logger: failures are logged where the request is. */
  log: AuditFlushLogger;
}

/** Invalidate, then audit and flush within 2 s. Resolves in every case; never rejects. */
export async function recordPlanChange(input: RecordPlanChangeInput): Promise<void> {
  const { accountId, actor, log } = input;

  if (input.invalidatesEntitlements) {
    try {
      getEntitlementService().invalidate(accountId);
    } catch (err) {
      // The cache is bounded by its 30 s TTL either way; the audit entry still matters.
      log.error({ err, accountId }, 'Entitlement cache invalidation failed after a plan change');
    }
  }

  const entry: AuditLogInput = {
    // The fallback keeps an unregistered action as a row named oddly rather
    // than no row at all; `adminOps.test.ts` asserts every admin action is
    // registered, so for the admin route it cannot fire.
    action: AUDIT_EVENTS[input.action as keyof typeof AUDIT_EVENTS] ?? input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    userId: accountId,
    actorId: actor.kind === 'admin' ? actor.adminId : platformActorId(),
    changes: input.changes,
    details: actor.kind === 'admin' ? input.details : { ...input.details, actor: actor.source },
    severity: input.severity,
    ...(input.request ? { request: input.request } : {}),
  };

  try {
    // The instance the admin route has always written through (SA C-8); in
    // production it is the same singleton `logAndFlush` uses by default.
    await logAndFlush(entry, log, { reason: 'plan change', continues: 'the plan change stands' }, AuditTrailService.getInstance());
  } catch (err) {
    // `logAndFlush` never rejects; this is defence in depth for the contract above.
    log.error({ err, accountId, action: entry.action }, 'Plan change audit failed');
  }
}
