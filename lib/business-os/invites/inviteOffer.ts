import 'server-only';

/**
 * What an invite offers, described for a human (FR-8, FR-9, GR-1).
 *
 * ── It resolves; it does not describe ───────────────────────────────────────
 * The offered plan comes from `describePlanOffer`, a read-only view INSIDE the
 * entitlements module that resolves a synthetic account on that plan, exactly
 * as the admin Tiers screen and the customer "Your plan" section do. This file
 * never imports the resolver (SA M-3): only the module itself may, so a
 * capability gate cannot hide outside it. Nothing about plan contents is
 * written here, so the invite page cannot disagree with the rest of the
 * product.
 *
 * The offer is described in the INVITE's language (credit deduction slice 6,
 * OI-10): plan and capability names from the config's own `labels`, and the
 * value phrases ("per month", "in total") with numbers grouped by that
 * language. Variant ids pass through unchanged (SA Q-10).
 *
 * ── Grant availability (GR-1, D-8) ──────────────────────────────────────────
 * `isInviteGrantAvailable` re-checks a STORED grant against today's config: an
 * invite created for a plan that has since been removed must be refused
 * cleanly, never described or redeemed as an unknown value.
 */

import { describePlanOffer, type PlanOfferCategory } from '@/lib/business-os/entitlements/planOfferView';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { INVITE_TYPES, INVITE_TYPE_IDS } from '@/lib/business-os/entitlements/config/invites';
import type { BusinessOsInviteGrantKind } from '@/lib/repositories/types';
import { defaultLocale, type Locale } from '@/lib/i18n/config';

/** The grant columns of an invite row. */
export interface InviteGrantFacts {
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
}

/**
 * The access an invite gives, as data, so the page can say it in the invite's
 * language rather than receiving an English sentence.
 */
export type InviteAccess =
  | { kind: 'open_ended'; months: null }
  | { kind: 'months'; months: number }
  | { kind: 'while_paid'; months: null };

/** One row of "what the plan includes": a category and its features, joined. */
export type InviteOfferCategory = PlanOfferCategory;

/** Everything the public page may say about the offered plan. */
export interface InviteOffer {
  planName: string;
  free: boolean;
  monthlyPriceUsd: number;
  access: InviteAccess;
  included: InviteOfferCategory[];
}

/**
 * Is this stored grant still something an invite may carry, per today's config?
 *
 * Both halves must hold: the plan still exists in the entitlements config, and
 * some invite type still grants it under this grant kind.
 */
export function isInviteGrantAvailable(config: EntitlementConfig, grant: Pick<InviteGrantFacts, 'grant_kind' | 'grant_id'>): boolean {
  const existsInConfig =
    grant.grant_kind === 'tier'
      ? config.tierOrder.includes(grant.grant_id)
      : Object.prototype.hasOwnProperty.call(config.cohorts, grant.grant_id);

  if (!existsInConfig) return false;

  return INVITE_TYPE_IDS.some((type) => {
    const definition = INVITE_TYPES[type];
    return definition.grantKind === grant.grant_kind && (definition.grantIds as readonly string[]).includes(grant.grant_id);
  });
}

/** The access, as data. */
export function inviteAccessOf(grant: InviteGrantFacts): InviteAccess {
  if (grant.grant_kind === 'tier') return { kind: 'while_paid', months: null };
  if (grant.access_open_ended === false && typeof grant.access_months === 'number') {
    return { kind: 'months', months: grant.access_months };
  }
  return { kind: 'open_ended', months: null };
}

/** The access in one English sentence, for the admin list (the admin screen is English). */
export function describeInviteAccess(grant: InviteGrantFacts): string {
  const access = inviteAccessOf(grant);
  if (access.kind === 'while_paid') return 'While the plan is paid for';
  if (access.kind === 'months') {
    return `${access.months} ${access.months === 1 ? 'month' : 'months'} from signup`;
  }
  return 'No end date';
}

/**
 * The offer, resolved.
 *
 * Throws only if the config itself cannot resolve a plan it lists, which the
 * config loader already refuses; the caller treats a throw as "try again".
 * Call `isInviteGrantAvailable` first: an unavailable grant is not described.
 *
 * `locale` is the invite's own, already validated language (OI-10).
 */
export function describeInviteOffer(
  grant: InviteGrantFacts,
  config: EntitlementConfig,
  now: Date,
  locale: Locale = defaultLocale
): InviteOffer {
  const plan = describePlanOffer(config, grant.grant_id, now, locale);
  return {
    planName: plan.planName,
    free: plan.free,
    monthlyPriceUsd: plan.monthlyPriceUsd,
    access: inviteAccessOf(grant),
    included: plan.included,
  };
}
