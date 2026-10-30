import 'server-only';

/**
 * The production wiring of `sendPlanCancelEmail` (`planCancelEmail.ts`) for
 * its two callers, the plan cancel and reactivate routes (account deletion
 * lifecycle D4a / SX-3; workplan
 * docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §3.2, §3.3;
 * SA S-6, S-9, S-11, S-16).
 *
 * The same lookups, sender gate and transport as the inviter email
 * (`inviterNotificationDeps.ts`), plus the user's timezone and the plan-ending
 * view. The audit port writes the SENT / NOT_SENT pair through `logAndFlush`
 * (WC-7, bounded), on the account's billing entity, with the session user.
 *
 * Every read is keyed on the SESSION user id the route passes, never on a
 * request value. The identity read is the service-role auth admin lookup
 * (`findUserIdentity`, as N-1); the language and timezone reads keep their
 * `.eq('user_id', id)` (tenant-isolation-guard).
 *
 * Entitlements: `readPlanEndingView` (display only, the drawer's own view),
 * on the account the route resolved through the seam (`context.accountId`).
 * A declared non-gate importer (S-16): it refuses nothing and calls no
 * `check()` / `decide()`.
 *
 * D4b (SX-3 part 2; workplan §3.4, D4b addendum R-A, R-D):
 *   - R-D: after a `cancelled` email the routes' one call also records the
 *     period end as covered when it is inside the reminder window
 *     (`coverReminderAfterCancelEmail`, user-scoped
 *     `markCancelReminderCovered` on the SESSION user), never failing the
 *     response.
 *   - The reminder cron's email wiring (`buildPlanCancelReminderEmailDeps`):
 *     the same lookups, view, sender and transport, keyed on the CLAIMED
 *     billing row's account (never input). Its audit is written non-blocking
 *     with `.catch` (a cron has no request), and the pass flushes once at the
 *     end, bounded (`flushPlanCancelReminderAudit`).
 */

import type { NextRequest } from 'next/server';

import { AUDIT_FLUSH_TIMEOUT_MS, logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { readPlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { platformUrl } from '@/lib/utils/origins';

import { isPlanCancelEmailsEnabled } from './planCancelEmailsFlag';
import {
  coverReminderAfterCancelEmail,
  sendPlanCancelEmail,
  type PlanCancelEmailDeps,
  type PlanCancelEmailInput,
  type PlanCancelEmailLogger,
  type PlanCancelEmailOutcome,
} from './planCancelEmail';

/** The lookups, view, sender and transport both wirings share. Every read is keyed on the id the composer passes. */
function sharedPorts(accountId: string): Omit<PlanCancelEmailDeps, 'audit' | 'logger'> {
  return {
    isEnabled: isPlanCancelEmailsEnabled,
    findUserIdentity: (id) => authAccountRepository.findUserIdentity(id),
    findProfileLanguage: (id) => businessProfileRepository.findLanguage(id),
    findPreferredLanguage: (id) => userPreferencesRepository.findPreferredLanguage(id),
    findTimezone: (id) => userPreferencesRepository.findTimezone(id),
    readEndingView: (_userId, endsAt, locale) => readPlanEndingView({ accountId, endsAt, locale }),
    senderAddress: () => platformSenderAddress(),
    sendEmail,
    platformUrl,
  };
}

export function buildPlanCancelEmailDeps(context: {
  /** The session account, from `resolveAccountId(user.id)` in the route: the audit entity and the view's account. */
  accountId: string;
  /** The session user. */
  userId: string;
  request: NextRequest;
  logger: PlanCancelEmailLogger & AuditFlushLogger;
}): PlanCancelEmailDeps {
  return {
    // The view reads the account the route already resolved through the seam (`resolveAccountId(user.id)`): one source (SA code review).
    ...sharedPorts(context.accountId),
    audit: (entry) =>
      logAndFlush(
        {
          action: AUDIT_EVENTS[entry.action],
          entityType: 'business_os_billing_account',
          entityId: context.accountId,
          userId: context.userId,
          details: entry.details,
          request: context.request,
        },
        context.logger,
        { reason: 'plan cancel email', continues: 'the plan outcome is returned regardless' }
      ),
    logger: context.logger,
  };
}

/**
 * The routes' one call. Never throws (S-11): the route's answer is computed
 * before this runs and is returned unchanged whatever happens here. While the
 * switch is off it returns `skipped` before building anything.
 */
export async function notifyPlanCancelEmail(
  input: PlanCancelEmailInput,
  context: Parameters<typeof buildPlanCancelEmailDeps>[0]
): Promise<PlanCancelEmailOutcome> {
  try {
    if (!isPlanCancelEmailsEnabled()) return { outcome: 'skipped' };
    const outcome = await sendPlanCancelEmail(input, buildPlanCancelEmailDeps(context));
    // D4b R-D: a cancel inside the reminder window covers the reminder. Never throws, and is
    // bounded by PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS (2 s, SA code review F-3).
    await coverReminderAfterCancelEmail(input, outcome, {
      markCovered: (args) => businessOsBillingAccountRepository.markCancelReminderCovered(args),
      logger: context.logger,
    });
    return outcome;
  } catch (err) {
    try {
      context.logger.error({ err, email: input.event }, 'Plan cancel email failed unexpectedly');
    } catch {
      // Nothing left to tell.
    }
    return { outcome: 'not_sent', reason: 'transport_failed' };
  }
}

// ── D4b: the reminder cron's email wiring ────────────────────────────────────

/**
 * The composer's ports for ONE claimed reminder row. `accountId` is the
 * claimed billing row's `user_id` (the account; the repository maps that
 * column to `accountId`), never input. The account seam is the identity today
 * (`resolveAccountId` returns its argument), so the same id keys the owner's
 * address, language and time zone, and the plan-ending view.
 *
 * Audit: the SENT / NOT_SENT pair, `actor: 'system'` (set by the pass on the
 * input), written NON-BLOCKING with `.catch` (CLAUDE.md § Audit Trail): a cron
 * has no request, and a per-row bounded flush would spend the run's deadline.
 * The pass flushes the queue once at the end (`flushPlanCancelReminderAudit`).
 */
export function buildPlanCancelReminderEmailDeps(context: {
  accountId: string;
  logger: PlanCancelEmailLogger;
}): PlanCancelEmailDeps {
  return {
    ...sharedPorts(context.accountId),
    audit: async (entry) => {
      AuditTrailService.getInstance()
        .log({
          action: AUDIT_EVENTS[entry.action],
          entityType: 'business_os_billing_account',
          entityId: context.accountId,
          userId: context.accountId,
          details: entry.details,
        })
        .catch((err: unknown) => {
          try {
            context.logger.error({ err, action: entry.action }, 'Audit failed');
          } catch {
            // Nothing left to tell.
          }
        });
    },
    logger: context.logger,
  };
}

/**
 * One bounded flush of the audit queue at the end of a reminder run, so the
 * rows the run queued are written before the instance can freeze. Never throws
 * and never waits longer than `AUDIT_FLUSH_TIMEOUT_MS`.
 */
export async function flushPlanCancelReminderAudit(logger: PlanCancelEmailLogger): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const flushed = AuditTrailService.getInstance()
      .flush()
      .then(() => 'flushed' as const)
      .catch((err: unknown) => {
        logger.error({ err }, 'Audit flush failed after the plan-ends reminder run');
        return 'failed' as const;
      });
    const timedOut = new Promise<'timedOut'>((resolve) => {
      timer = setTimeout(() => resolve('timedOut'), AUDIT_FLUSH_TIMEOUT_MS);
    });
    if ((await Promise.race([flushed, timedOut])) === 'timedOut') {
      logger.warn({ timeoutMs: AUDIT_FLUSH_TIMEOUT_MS }, 'Audit flush did not finish in time after the plan-ends reminder run');
    }
  } catch {
    // Never fails the run.
  } finally {
    clearTimeout(timer);
  }
}
