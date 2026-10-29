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
 */

import type { NextRequest } from 'next/server';

import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { readPlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { platformUrl } from '@/lib/utils/origins';

import { isPlanCancelEmailsEnabled } from './planCancelEmailsFlag';
import {
  sendPlanCancelEmail,
  type PlanCancelEmailDeps,
  type PlanCancelEmailInput,
  type PlanCancelEmailLogger,
  type PlanCancelEmailOutcome,
} from './planCancelEmail';

export function buildPlanCancelEmailDeps(context: {
  /** The session account, from `resolveAccountId(user.id)` in the route: the audit entity and the view's account. */
  accountId: string;
  /** The session user. */
  userId: string;
  request: NextRequest;
  logger: PlanCancelEmailLogger & AuditFlushLogger;
}): PlanCancelEmailDeps {
  return {
    isEnabled: isPlanCancelEmailsEnabled,
    findUserIdentity: (id) => authAccountRepository.findUserIdentity(id),
    findProfileLanguage: (id) => businessProfileRepository.findLanguage(id),
    findPreferredLanguage: (id) => userPreferencesRepository.findPreferredLanguage(id),
    findTimezone: (id) => userPreferencesRepository.findTimezone(id),
    // The account the route already resolved through the seam (`resolveAccountId(user.id)`): one source (SA code review).
    readEndingView: (_userId, endsAt, locale) => readPlanEndingView({ accountId: context.accountId, endsAt, locale }),
    senderAddress: () => platformSenderAddress(),
    sendEmail,
    platformUrl,
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
    return await sendPlanCancelEmail(input, buildPlanCancelEmailDeps(context));
  } catch (err) {
    try {
      context.logger.error({ err, email: input.event }, 'Plan cancel email failed unexpectedly');
    } catch {
      // Nothing left to tell.
    }
    return { outcome: 'not_sent', reason: 'transport_failed' };
  }
}
