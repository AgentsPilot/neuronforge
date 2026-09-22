// lib/business-os/entitlements/__fixtures__/exampleTierMatrix.ts
//
// EYAL'S DRAFT MATRIX — a TEST FIXTURE, not a price list.
//
// Production ships no tiers (U-1 / B-13). But "every tier assigns every
// capability", "moving a capability between plans is one line" and
// grandfathering are all properties OF A MATRIX — they cannot be demonstrated
// against an empty one. So the draft lives here, where it proves the mechanism
// and can never be mistaken for what customers are sold.
//
// Values come from requirement §5.3, which marks them illustrative. Rows the
// user has confirmed are marked (S); the five rows still with Eyal are (?).
// If the real matrix arrives and differs, this file does not need to change —
// it is a shape, not a source of truth.

import type { TierMatrixShape } from '../types';
import type { TierRow } from '../config/catalog';

export const FIXTURE_TIER_ORDER = ['basic', 'growth', 'pro'] as const;
export type FixtureTierId = (typeof FIXTURE_TIER_ORDER)[number];

/** Everything every tier has: the floor of the product. */
const COMMON: Pick<
  TierRow,
  | 'crm.core'
  | 'crm.documents'
  | 'booking.calendar_sync'
  | 'website.ai_site'
  | 'payments.invoices'
  | 'payments.card'
  | 'chat.email'
  | 'chat.scheduling'
  | 'addon.sms'
  | 'sms.messages'
  | 'addon.act_for_you'
> = {
  'crm.core': true,
  'crm.documents': true,
  'booking.calendar_sync': true,
  'website.ai_site': true,
  'payments.invoices': true, // (?) B-1
  'payments.card': true, // (?) B-1
  'chat.email': true,
  'chat.scheduling': true,
  'addon.sms': 'purchasable',
  'sms.messages': { perMonth: 0 },
  'addon.act_for_you': 'purchasable',
};

const basic: TierRow = {
  ...COMMON,
  'website.branding': 'branded', // (S)
  'intake.forms': 'manual', // (S)
  'intake.reminders': false, // (S)
  'payments.reminders': false, // (S)
  'payments.multi_currency': false,
  'chat.marketing': false, // (?) B-1
  'chat.invoice_control': false,
  'chat.search': false,
  'chat.quotes': false,
  'chat.reporting': false,
  'chat.bulk': false,
  'ai.actions': { perMonth: 100 },
  'marketing.mass_email': false, // (?) B-1
  'marketing.lead_response': false,
  'marketing.posts': false,
  'insights.checks': false, // (S)
  'insights.channels': false,
  'insights.daily_briefing': false,
  'support.level': 'standard',
  'email.volume': { ceilingPerMonth: 2000 },
  'addon.marketing_analytics': 'purchasable', // (?) B-1
  'addon.mobile': 'purchasable', // (?) B-1
  'addon.full_payment_cycle': 'purchasable', // (?) B-1
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
  'website.custom_domain': 'purchasable',
};

const growth: TierRow = {
  ...basic,
  'website.branding': 'unbranded',
  'intake.forms': 'ai', // (S)
  'intake.reminders': true, // (S)
  'payments.reminders': true,
  'chat.marketing': true,
  'chat.invoice_control': true,
  'chat.quotes': true,
  'chat.reporting': true,
  'ai.actions': { perMonth: 500 },
  'marketing.mass_email': true,
  'marketing.lead_response': true,
  'insights.checks': true, // (S)
  'insights.channels': true,
  'insights.daily_briefing': true,
  'team.seats': { included: 1, purchasable: true },
  'business.locations': { included: 1, purchasable: true },
};

const pro: TierRow = {
  ...growth,
  'payments.multi_currency': true,
  // The worked example in requirement §6.3 moves this one to Growth. It is here
  // so the one-line-change test has something real to move.
  'chat.search': true,
  'chat.bulk': true,
  'ai.actions': { perMonth: 2000 },
  'marketing.posts': true,
  'support.level': 'priority',
  'email.volume': { ceilingPerMonth: 20000 },
  'addon.marketing_analytics': 'included', // (?) B-1
  'addon.mobile': 'included', // (?) B-1
  'team.seats': { included: 5, purchasable: true },
  'business.locations': { included: 3, purchasable: true },
  'website.custom_domain': 'included',
};

export const FIXTURE_TIER_MATRIX: TierMatrixShape<FixtureTierId, TierRow> = {
  version: 1,
  tiers: { basic, growth, pro },
  removals: [],
};
