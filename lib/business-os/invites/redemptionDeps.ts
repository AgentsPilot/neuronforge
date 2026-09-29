import 'server-only';

/**
 * The production wiring of the invite redemption (Slice 1b), shared by the two
 * public signup routes, and the one mapping from an outcome to an HTTP answer.
 *
 * Kept out of the routes so both build the SAME dependencies, and so the only
 * application file that names the plan repository is this one (it is listed,
 * with its reason, in the entitlements imports guard: it may call exactly one
 * plan-state write, `provisionFromInvite`).
 *
 * The code email is sent from the platform's system sender (no `from`, no
 * `replyTo`, no `ownerUserId`), `kind: 'transactional'` (D-7, SA F-10).
 */

import type { NextRequest } from 'next/server';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { generateInviteSignupCodeEmail } from '@/lib/email/templates/invite-signup-code';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

import type { RedemptionDeps, RedemptionLogger, RedemptionRefusal } from './inviteRedemption';
import { INVITE_SIGNUP_CODE_POLICY } from './signupCodePolicy';

/** On every signup response, success or not (C-4, T-7). */
export const SIGNUP_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

/** Byte-identical to the validate route's answer for a token that did not match (AC-2). */
export const NOT_RECOGNISED_BODY = { success: true, data: { state: 'not_recognised' } } as const;

export function buildRedemptionDeps(context: {
  logger: RedemptionLogger & { error: (context: Record<string, unknown>, message: string) => void };
  correlationId: string;
  request: NextRequest;
}): RedemptionDeps {
  const auditTrail = AuditTrailService.getInstance();

  return {
    invites: businessOsInviteRepository,
    accounts: authAccountRepository,
    finalise: (input) => businessOsAccountPlanRepository.provisionFromInvite(input),
    sendCode: async ({ to, code, language }) => {
      const locale: Locale = isValidLocale(language) ? (language as Locale) : (defaultLocale as Locale);
      const email = generateInviteSignupCodeEmail({ code, validMinutes: INVITE_SIGNUP_CODE_POLICY.ttlMinutes, locale });
      const result = await sendEmail({
        kind: 'transactional',
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        // SA MF-1: the invitee is not yet a customer; keep the address out of the logs.
        redactRecipientInLogs: true,
      });
      return { sent: result.sent };
    },
    audit: async (entry) => {
      await auditTrail
        .log({
          action: AUDIT_EVENTS[entry.action],
          entityType: 'business_os_invite',
          entityId: entry.inviteId,
          userId: entry.accountId,
          actorId: entry.accountId,
          details: { correlationId: context.correlationId, ...entry.details },
          request: context.request,
        })
        .catch((err) => context.logger.error({ err }, 'Audit failed (non-blocking)'));
    },
    config: getEntitlementConfig(),
    now: () => new Date(),
    newAccountId: () => crypto.randomUUID(),
    logger: context.logger,
  };
}

/** Flush the audit queue before answering (WC-7): a serverless instance can freeze after. */
export async function flushRedemptionAudit(logger: { error: (context: Record<string, unknown>, message: string) => void }) {
  await AuditTrailService.getInstance()
    .flush()
    .catch((err) => logger.error({ err }, 'Audit flush failed'));
}

/** A refusal as status and body. */
export function refusalToHttp(refusal: RedemptionRefusal): { status: number; body: Record<string, unknown> } {
  if (refusal.kind === 'not_recognised') return { status: 200, body: NOT_RECOGNISED_BODY };
  if (refusal.kind === 'unavailable_try_again') {
    return { status: 503, body: { success: false, error: 'unavailable_try_again' } };
  }
  const body: Record<string, unknown> = { success: false, error: refusal.error };
  if (refusal.attemptsRemaining !== undefined) body.attemptsRemaining = refusal.attemptsRemaining;
  if (refusal.retryAfterSeconds !== undefined) body.retryAfterSeconds = refusal.retryAfterSeconds;
  return { status: refusal.status, body };
}
