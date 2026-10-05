import 'server-only';

/**
 * The production wiring of the invite redemption (Slice 1b), shared by the
 * public signup routes (code, complete and, from Slice 3b, google), and the one
 * mapping from an outcome to an HTTP answer.
 *
 * Kept out of the routes so both build the SAME dependencies, and so the only
 * application file that names the plan repository is this one (it is listed,
 * with its reason, in the entitlements imports guard: it may call exactly two
 * plan-state writes, `provisionFromInvite` and, from Slice 5b,
 * `provisionFromFriendInvite`; and one read, `findEntitlementInputs`, for the
 * friend issuer's in-force champion re-check).
 *
 * The code email, and from Slice 5b the "you already have an account" notice
 * (F5b-3, SA R-5), are sent from the platform's system sender (no `from`, no
 * `replyTo`, no `ownerUserId`), `kind: 'transactional'` (D-7, SA F-10). The
 * sender FAILS CLOSED like the invitation email (`inviteEmail.ts`, SA R-2):
 * `platformSenderAddress()` is the gate only. When `RESEND_FROM_EMAIL` is not
 * configured nothing is sent (`{ sent: false, senderNotConfigured: true }`)
 * rather than falling back to the transport's NeuronForge default; when it is,
 * no `from` is passed, so the transport uses `RESEND_FROM_EMAIL` exactly as
 * configured (display name included) and production mail is unchanged.
 *
 * N-1 adds `notifyInviter` (`inviterNotification.ts`): the "your invitation was
 * accepted" email to the invite's issuer, through the same sender gate and the
 * same non-blocking audit (with no owner, SA Q-4), flushed by the route's
 * existing `flushRedemptionAudit`. Its lookups run on the SERVICE-ROLE
 * repositories, keyed only on the issuer id of the matched invite row (SA C-2).
 */

import type { NextRequest } from 'next/server';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { generateInviteExistingAccountEmail } from '@/lib/email/templates/invite-existing-account';
import { generateInviteSignupCodeEmail } from '@/lib/email/templates/invite-signup-code';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { marketingUrl, platformUrl } from '@/lib/utils/origins';

import { verifyGoogleIdToken } from './googleIdToken';
import type { RedemptionDeps, RedemptionLanding, RedemptionLogger, RedemptionRefusal } from './inviteRedemption';
import { notifyInviter, type InviterNotificationDeps } from './inviterNotification';
import { AWAITING_PAYMENT_PATH } from './paymentHold';
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

  /**
   * Is the platform sender configured? Logs (no recipient address) when not.
   * Never throws. A gate only: the From header itself is left to the transport.
   */
  const senderConfigured = (email: 'signup_code' | 'existing_account_notice'): boolean => {
    let address: string | undefined;
    try {
      address = platformSenderAddress();
    } catch {
      address = undefined;
    }
    if (!address) {
      context.logger.warn(
        { email, reason: 'sender_not_configured' },
        'System email not sent: RESEND_FROM_EMAIL is not configured, and invite emails never use the default sender'
      );
      return false;
    }
    return true;
  };

  /*
   * N-1. INTENTIONAL SERVICE-ROLE READS (RLS bypass): these routes are public
   * and have no session, and the reads concern the invite's ISSUER, not the
   * visitor. Each is keyed only on the issuer id of the row the 256-bit token
   * matched (`inviteRedemption.ts` passes nothing else), and the two language
   * reads keep their `.eq('user_id', id)` (tenant-isolation-guard; SA C-2).
   */
  const inviterNotificationDeps: InviterNotificationDeps = {
    findUserIdentity: (id) => authAccountRepository.findUserIdentity(id),
    isActiveAdmin: (id) => AdminAccessService.getInstance().isAdminById(id),
    findProfileLanguage: (id) => businessProfileRepository.findLanguage(id),
    findPreferredLanguage: (id) => userPreferencesRepository.findPreferredLanguage(id),
    senderAddress: () => platformSenderAddress(),
    sendEmail,
    platformUrl,
    audit: async (entry) => {
      // SA Q-4: a system event. No owner, so the inviter's id never reaches
      // the invitee's audit view (nor the other way round); it is in details.
      await auditTrail
        .log({
          action: AUDIT_EVENTS[entry.action],
          entityType: 'business_os_invite',
          entityId: entry.inviteId,
          userId: null,
          actorId: null,
          details: { correlationId: context.correlationId, ...entry.details },
          request: context.request,
        })
        .catch((err) => context.logger.error({ err }, 'Audit failed (non-blocking)'));
    },
    logger: context.logger,
  };

  return {
    invites: businessOsInviteRepository,
    accounts: authAccountRepository,
    finalise: (input) => businessOsAccountPlanRepository.provisionFromInvite(input),
    finaliseFriend: (input) => businessOsAccountPlanRepository.provisionFromFriendInvite(input),
    // Read-only: the friend issuer's plan row (the TypeScript in-force re-check,
    // T-19). Only the one read method is handed over (SA N-3).
    issuerPlans: { findEntitlementInputs: (accountId) => businessOsAccountPlanRepository.findEntitlementInputs(accountId) },
    sendCode: async ({ to, code, language }) => {
      const locale: Locale = isValidLocale(language) ? (language as Locale) : (defaultLocale as Locale);
      if (!senderConfigured('signup_code')) return { sent: false, senderNotConfigured: true };
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
    sendExistingAccountNotice: async ({ to, language }) => {
      // SA N-1: never throws. A malformed marketing URL renders the notice
      // without a link (QA-1, the template never throws); anything that still
      // fails is `{ sent: false }`, logged. The code route answers the same
      // either way (QA-1): the champion must not learn the address has an account.
      try {
        // Checked before anything is composed. The redemption answers this the
        // SAME way as the code email's `senderNotConfigured` (no account oracle).
        if (!senderConfigured('existing_account_notice')) return { sent: false, senderNotConfigured: true };
        const locale: Locale = isValidLocale(language) ? (language as Locale) : (defaultLocale as Locale);
        const email = generateInviteExistingAccountEmail({ signInUrl: marketingUrl('/login'), locale });
        // SA R-5: the system sender, exactly like the code email. No `from`, no
        // `replyTo` (never the champion's), no `ownerUserId`.
        const result = await sendEmail({
          kind: 'transactional',
          to: [to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          redactRecipientInLogs: true,
        });
        return { sent: result.sent };
      } catch (err) {
        context.logger.error({ err }, 'Existing-account notice could not be built or sent');
        return { sent: false };
      }
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
    // Slice 3b: never throws, never logs (SA R-1); off until the client id is set (R-6).
    verifyGoogleIdToken,
    notifyInviter: (input) => notifyInviter(input, inviterNotificationDeps),
    logger: context.logger,
  };
}

/**
 * Where the browser goes after a redemption (FR-13, FR-35): a champion to
 * onboarding, a friend (Slice 5b, not yet paid) to the payment hold. One map,
 * shared by the complete and Google routes, so the two can never disagree.
 */
export const REDEMPTION_LANDING_PATHS: Readonly<Record<RedemptionLanding, string>> = {
  onboarding: '/onboarding-chat',
  awaiting_payment: AWAITING_PAYMENT_PATH,
};

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
