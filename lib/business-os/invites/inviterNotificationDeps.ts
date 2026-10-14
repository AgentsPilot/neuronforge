import 'server-only';

/**
 * The production wiring of `notifyInviter` (`inviterNotification.ts`), shared
 * by its two callers (plan payments P-5b.1, workplan §3.2; SA C-10):
 *
 *   - the invite redemption (N-1, `redemptionDeps.ts`), which QUEUES its audit
 *     and lets the signup route flush it (`flushRedemptionAudit`);
 *   - the champion's "your friend subscribed" email (N-2,
 *     `championSubscribedNotification.ts`, wired in the Stripe webhook's plan
 *     handler), which flushes its audit itself, bounded (SA Q-3).
 *
 * A pure move of what `redemptionDeps.ts` built inline: the same lookups, the
 * same sender gate, the same transport. The AUDIT callback and the logger stay
 * the caller's, so each keeps its own write-out (C-10).
 *
 * Imports nothing from `lib/business-os/entitlements/**` and must not (C-8).
 */

import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { platformUrl } from '@/lib/utils/origins';

import type { InviterNotificationDeps } from './inviterNotification';

export function buildInviterNotificationDeps(context: {
  logger: InviterNotificationDeps['logger'];
  audit: InviterNotificationDeps['audit'];
}): InviterNotificationDeps {
  /*
   * N-1. INTENTIONAL SERVICE-ROLE READS (RLS bypass): these routes are public
   * and have no session, and the reads concern the invite's ISSUER, not the
   * visitor. Each is keyed only on the issuer id of the row the 256-bit token
   * matched (`inviteRedemption.ts` passes nothing else), and the two language
   * reads keep their `.eq('user_id', id)` (tenant-isolation-guard; SA C-2).
   *
   * N-2 (P-5b.1): the Stripe webhook has no session either. There the issuer id
   * is the `issuer_account_id` of the invite named by the paying account's own
   * lineage row, the account resolved from OUR billing record (SR-8), and the
   * invite must have been redeemed by that same account
   * (`championSubscribedNotification.ts`). Never a value from Stripe metadata.
   * Plan payments P-9.2 (T10): for an admin Paid invitee the id is that same
   * invite's `issuer_admin_id` instead (the invite must be admin-issued and
   * redeemed by the payer), and `isActiveAdmin` is checked before any send.
   */
  return {
    findUserIdentity: (id) => authAccountRepository.findUserIdentity(id),
    isActiveAdmin: (id) => AdminAccessService.getInstance().isAdminById(id),
    findProfileLanguage: (id) => businessProfileRepository.findLanguage(id),
    findPreferredLanguage: (id) => userPreferencesRepository.findPreferredLanguage(id),
    senderAddress: () => platformSenderAddress(),
    sendEmail,
    platformUrl,
    audit: context.audit,
    logger: context.logger,
  };
}
