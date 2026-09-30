import 'server-only';

/**
 * Production wiring for the champion's friend-invite routes (Slice 5a).
 *
 * Kept out of the routes so both handlers share one set of repositories and so
 * the routes import nothing from the entitlements module but the account seam.
 * `getEntitlementConfig` is read here only to name the plan in the invitation
 * email (`planLabel`); it resolves no account and refuses nothing.
 *
 * The repositories are the service-role singletons (C-13): every method the
 * routes reach is scoped by the `issuer_account_id` the route resolved from the
 * session (`ForIssuerAccount`), or by that account's own id.
 */

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import {
  BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT,
  businessOsInviteRepository,
} from '@/lib/repositories/BusinessOsInviteRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';

import type { InvitationEmailDeps } from './inviteEmail';

export const friendInviteRepositories = {
  plans: businessOsAccountPlanRepository,
  repository: businessOsInviteRepository,
  preferences: userPreferencesRepository,
  profileRepository: userProfileRepository,
  listLimit: BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT,
} as const;

/** The config, for the email's plan name only. */
export function friendInviteConfig(): EntitlementConfig {
  return getEntitlementConfig();
}

/** How the invitation is sent: the same transport and sender as the admin path (F5a-6). */
export function friendInviteEmailDeps(logger: InvitationEmailDeps['logger']): Omit<InvitationEmailDeps, 'repository'> {
  return {
    sendEmail,
    senderAddress: platformSenderAddress,
    now: () => new Date(),
    logger,
  };
}
