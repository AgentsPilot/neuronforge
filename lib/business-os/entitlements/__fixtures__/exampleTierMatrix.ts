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
//
// ── WHERE THIS DIVERGES FROM THE SHEET, AND WHY (2026-09-22) ────────────────
// The sheet sells things that do not exist yet. Under the user's rule — **if a
// feature does not exist it cannot be allocated** — the loader now rejects a
// tier that grants a `not_built` capability, and this fixture was doing exactly
// that: it was a fixture bug, and a useful one, because it is the same mistake
// the real matrix will make the first time it is written.
//
// Clamped to "withheld" here, with the draft value kept in the comment so
// nothing is lost when these features are built:
//
//   marketing.posts          pro: true          -> false
//   marketing.mass_email     growth/pro: true   -> false      (no dispatcher)
//   payments.reminders       growth/pro: true   -> false      (sender is a stub)
//   website.custom_domain    purchasable/incl.  -> unavailable (no serving path)
//   addon.marketing_analytics / addon.mobile / addon.full_payment_cycle /
//   addon.act_for_you / addon.sms   purchasable/included -> unavailable
//
// `purchasable` counts as granting: it is an offer to sell, and the customer
// finds out afterwards. Each line goes back to its draft value in the same
// change that makes the feature real.

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
  | 'chat.access'
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
  // Every fixture tier has SOME chat, so every one may open the surface. The
  // production matrix is the interesting case (Essentials has none) and it is
  // asserted where it belongs, in productionConfig.test.ts.
  'chat.access': true,
  'chat.email': true,
  'chat.scheduling': true,
  'addon.sms': 'unavailable', // sheet: purchasable — not_built (no SMS path)
  'sms.messages': { perMonth: 0 },
  'addon.act_for_you': 'unavailable', // sheet: purchasable — not_built
};

const basic: TierRow = {
  ...COMMON,
  'website.branding': 'branded', // (S)
  'intake.forms': 'manual', // (S)
  'intake.reminders': false, // (S)
  'payments.reminders': false, // (S) — also not_built: the sender is a stub
  'payments.multi_currency': false,
  'chat.marketing': false, // (?) B-1
  'chat.invoice_control': false,
  'chat.search': false,
  'chat.quotes': false,
  'chat.reporting': false,
  'chat.bulk': false,
  'ai.actions': { perMonth: 100 },
  'marketing.mass_email': false, // (?) B-1 — also not_built: no dispatcher
  'marketing.lead_response': false,
  'marketing.posts': false, // not_built
  'insights.checks': false, // (S)
  'insights.channels': false,
  'insights.daily_briefing': false,
  'support.level': 'standard',
  'email.volume': { ceilingPerMonth: 2000 },
  'addon.marketing_analytics': 'unavailable', // sheet: purchasable — not_built (?) B-1
  'addon.mobile': 'unavailable', // sheet: purchasable — not_built (?) B-1
  'addon.full_payment_cycle': 'unavailable', // sheet: purchasable — not_built (?) B-1
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
  'website.custom_domain': 'unavailable', // sheet: purchasable — not_built (no serving path)
};

const growth: TierRow = {
  ...basic,
  'website.branding': 'unbranded',
  'intake.forms': 'ai', // (S)
  'intake.reminders': true, // (S)
  // sheet: true — not_built (PaymentReminderService.sendEmailReminder is a stub)
  'payments.reminders': false,
  'chat.marketing': true,
  'chat.invoice_control': true,
  'chat.quotes': true,
  'chat.reporting': true,
  'ai.actions': { perMonth: 500 },
  'marketing.mass_email': false, // sheet: true — not_built (no dispatcher)
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
  'marketing.posts': false, // sheet: true — not_built
  'support.level': 'priority',
  'email.volume': { ceilingPerMonth: 20000 },
  'addon.marketing_analytics': 'unavailable', // sheet: included — not_built (?) B-1
  'addon.mobile': 'unavailable', // sheet: included — not_built (?) B-1
  'team.seats': { included: 5, purchasable: true },
  'business.locations': { included: 3, purchasable: true },
  'website.custom_domain': 'unavailable', // sheet: included — not_built
};

export const FIXTURE_TIER_MATRIX: TierMatrixShape<FixtureTierId, TierRow> = {
  version: 1,
  tiers: { basic, growth, pro },
  removals: [],
  // The presentation metadata the real matrix carries (2026-09-23). Deliberately
  // NOT the production names: a fixture that reused "Essentials" would make a
  // test failure read like a pricing statement.
  presentation: {
    basic: { labels: { en: 'Fixture Basic', he: 'Fixture Basic', es: 'Fixture Basic' }, monthlyPriceUsd: 10 },
    growth: { labels: { en: 'Fixture Growth', he: 'Fixture Growth', es: 'Fixture Growth' }, monthlyPriceUsd: 20 },
    pro: { labels: { en: 'Fixture Pro', he: 'Fixture Pro', es: 'Fixture Pro' }, monthlyPriceUsd: 30 },
  },
};
