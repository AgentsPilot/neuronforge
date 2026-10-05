// lib/business-os/entitlements/config/tierMatrix.ts
//
// THE TIER MATRIX — which plan includes what.
//
// Owned by pricing, not by engineering. `catalog.ts` says what a capability IS;
// this file says who GETS it. Two files, two owners, two release rhythms.
//
// ── THE FOUR PLANS (user decision, 2026-09-23) ──────────────────────────────
//
//   internal   marketing          chat   credits          ends           price
//   ────────────────────────────────────────────────────────────────────────
//   trial      Test Flight        no     2,000 in total   14 days or     $0
//                                                         credits gone
//   champion   Founding Partner   yes    32,250/mo        never          $0
//                                        (reads `pro`)
//   basic      Essentials         no     19,750/mo        while paid     $79
//   pro        Autopilot          yes    32,250/mo        while paid     $129
//
// The credit numbers, and why: docs/architecture/BUSINESS_OS_CREDIT_PRICING.md.
//
// "Chat" above means the `chat.access` capability (FR-46) plus the eight
// per-operation `chat.*` groups. Autopilot has all nine; nobody else has any.
//
// **Only TWO of those are tiers.** `trial` and `champion` are cohorts: `trial`
// points at the `basic` tier and `champion` at the `pro` tier (see `cohorts.ts`),
// so they inherit every change made here instead of drifting away from it.
//
// ── THE ONE RULE THAT SHAPES THIS FILE ──────────────────────────────────────
// The paid tiers differ in exactly TWO ways: **chat** and the **credit
// allowance**. Everything else that exists is in every tier, and nothing that
// does not exist is in any of them.
//
// That is a deliberate commercial choice, and it makes the file easy to check:
// take `BASE`, change the nine `chat.*` values and `credits.allowance`, and there is
// no third thing to get wrong.
//
// ── ADDING A TIER (the whole procedure) ─────────────────────────────────────
//
//   1. Add its name to TIER_ORDER, cheapest first.
//   2. Add its row to `tiers` — one value per capability. Start from `BASE`.
//   3. Add its entry to `presentation` — a customer-facing name and a price.
//   4. Check every capability you grant against its `lifecycle` in catalog.ts:
//      a tier may NOT grant a `not_built` one, and the config refuses to load
//      if it does. See docs/architecture/BUSINESS_OS_ENTITLEMENTS.md.
//   5. `npm run entitlements:snapshot` to refresh the drift snapshot.
//
// Steps 2 and 3 cannot be forgotten: `TierRow` is a mapped type over the
// catalog, so a missing capability is a compile error, and the Zod schema
// rejects a tier with no presentation entry at load.
//
// ── CHANGING WHAT A TIER INCLUDES ───────────────────────────────────────────
//
// ADDING a capability to a tier is ONE LINE. Every account on that tier has it
// from the release that ships the change (B-10).
//
// REMOVING one is TWO lines — the value, and an entry in `removals` — plus a
// version bump. That asymmetry is deliberate: taking something away from people
// who are already paying for it is a commercial decision, so it cannot be made
// silently. The snapshot test refuses a lowered value with no matching removal.

import type { MatrixRemoval, TierMatrixShape } from '../types';
import type { TierRow } from './catalog';

/**
 * The configured tiers, cheapest first.
 *
 * The order is not cosmetic: it is how "the lowest tier that includes this" is
 * computed for an upgrade prompt (FR-16), and how the snapshot test knows which
 * direction is a downgrade.
 */
export const TIER_ORDER = ['basic', 'pro'] as const satisfies readonly string[];

/** A configured tier's name. */
export type TierId = (typeof TIER_ORDER)[number];

/** The production matrix, typed to the configured tiers. */
export type TierMatrix = TierMatrixShape<TierId, TierRow>;

/**
 * Everything both paid tiers include.
 *
 * The rule from the top of the file, expressed once: every `available`
 * capability is on, at its highest value, and every `not_built` one is
 * withheld. `pro` then changes chat and credits; `basic` changes credits.
 *
 * Withholding a `not_built` capability is not a pricing decision — the loader
 * rejects a tier that grants one, because a feature that does not exist cannot
 * be sold (the rule the user set on 2026-09-22).
 */
const BASE: TierRow = {
  // ── CRM, booking, website, intake, payments: the product ──────────────────
  'crm.core': true,
  'crm.documents': true,
  'booking.calendar_sync': true,
  'website.ai_site': true,
  // Both paid plans are unbranded. Branding is not a differentiator here —
  // the differentiators are chat and credits, and nothing else.
  'website.branding': 'unbranded',
  'intake.forms': 'ai',
  'intake.reminders': true,
  'payments.invoices': true,
  'payments.card': true,
  'payments.multi_currency': true,
  /*
   * `not_built` until 2026-09-25, when the sender stopped simulating success.
   *
   * Moved here from the `not_built` block on 2026-09-28. It sat there reading
   * `false, // the sender returns a simulated success`, which was true until
   * 2026-09-25: `sendEmailReminder` logged "Would send payment reminder email"
   * and returned `true; // Simulated success`, so a queue row was marked SENT
   * while no client received anything. The catalog was moved to
   * `lifecycle: 'available'` when the real sender landed and this line was not,
   * so the config still withheld a feature that works.
   *
   * Nothing enforces this capability at runtime yet, so the effect was on what
   * a customer is TOLD: a Founding Partner saw 28 of the 29 things they have,
   * and the missing one was payment reminders. `featuresFrom` lists only
   * granting rows, which is why an ungranted-but-available capability vanishes
   * from the plan rather than showing as off.
   */
  'payments.reminders': true,
  'marketing.lead_response': true,
  'insights.checks': true,
  'insights.channels': true,
  'insights.daily_briefing': true,
  // Same reasoning as branding: one support level, because support is not one
  // of the two things the plans differ by.
  'support.level': 'priority',

  // ── The nine chat capabilities. `basic` turns every one of these off ──────
  // `chat.access` is the SURFACE — may this account open chat at all — and the
  // other eight are what it may do once inside. It was added on 2026-09-24
  // (FR-46) because the eight alone do not close the surface: a chat read or
  // write of contacts resolves to `crm.core`, which Essentials has. **Slice 2
  // gates on it; nothing reads it today.**
  'chat.access': true,
  'chat.marketing': true,
  'chat.invoice_control': true,
  'chat.email': true,
  'chat.search': true,
  'chat.scheduling': true,
  'chat.quotes': true,
  'chat.reporting': true,
  'chat.bulk': true,

  // ── Numbers ──────────────────────────────────────────────────────────────
  // Decided (D1–D3, 2026-09-30): docs/architecture/BUSINESS_OS_CREDIT_PRICING.md §3.
  'credits.allowance': { perMonth: 19750 },
  // FIRST PASS. A fair-use ceiling alerts the platform team and never blocks a
  // customer (B-7), so it is an abuse threshold rather than a product promise —
  // and it is the same on both tiers, because email volume is not one of the
  // two differentiators.
  'email.volume': { ceilingPerMonth: 10000 },
  // One owner seat and one location is what EXISTS: invites and multi-location
  // are unbuilt (§18), so these cannot be raised yet on any plan.
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },

  // ── not_built: withheld everywhere, on every plan ─────────────────────────
  // Each of these is a feature the code does not deliver today. The loader
  // enforces it; these lines are the config agreeing with the loader rather
  // than the loader catching the config.
  'marketing.mass_email': false, // a campaign builder with no dispatcher
  'marketing.posts': false,
  'sms.messages': { perMonth: 0 },
  'addon.marketing_analytics': 'unavailable',
  'addon.mobile': 'unavailable',
  'addon.full_payment_cycle': 'unavailable',
  'addon.sms': 'unavailable',
  'addon.act_for_you': 'unavailable',
  'website.custom_domain': 'unavailable',
};

/** The nine capabilities that make the difference between the two paid plans. */
const CHAT_CAPABILITIES = [
  'chat.access',
  'chat.marketing',
  'chat.invoice_control',
  'chat.email',
  'chat.search',
  'chat.scheduling',
  'chat.quotes',
  'chat.reporting',
  'chat.bulk',
] as const;

/** `BASE` with chat switched off — which is what "Essentials" means. */
const withoutChat = (): TierRow => {
  const row = { ...BASE };
  for (const capability of CHAT_CAPABILITIES) row[capability] = false;
  return row;
};

/**
 * Essentials — everything the product does, without the chat assistant.
 *
 * ⚠️ **The config half is here; the enforcement half is Slice 2 (FR-46).**
 * `chat.access: false` is what "no chat" means, and it is the ONE line that
 * expresses the whole commercial difference. The other eight `chat.*` values
 * cannot express it on their own: a chat turn that reads OR writes contacts
 * maps to `crm.core` under the configured read rule, and Essentials has
 * `crm.core` — so without a gate on the SURFACE, chat would answer and act for
 * an account that was never sold it.
 *
 * **Nothing reads `chat.access` yet.** Slice 2 gates the chat entry point on it,
 * once per turn, before any per-capability check. Until then this row states an
 * intent, exactly like every other value here while the mode is off.
 */
const basic: TierRow = withoutChat();

/** Autopilot — Essentials plus chat, and more credits. */
const pro: TierRow = {
  ...BASE,
  // Decided (D1–D3, 2026-09-30): docs/architecture/BUSINESS_OS_CREDIT_PRICING.md §3.
  'credits.allowance': { perMonth: 32250 },
};

export const TIER_MATRIX = {
  // Version 1 was the FIRST REAL MATRIX. Version 2 (credit deduction slice 5)
  // is the first whose allowance is in credits: `ai.actions` was renamed to
  // `credits.allowance` (SA SQ-17) and both values were raised (SQ-19). Nothing
  // was lowered, so `removals` stays empty: a rename is not a removal, and an
  // entry naming an id that is no longer in the catalog would describe nothing.
  version: 2,
  tiers: { basic, pro },
  removals: [] as readonly MatrixRemoval<TierId>[],
  /**
   * What a customer sees, and what they pay.
   *
   * The internal id and the marketing name move at different speeds: renaming
   * "Essentials" must not rewrite the `tier` column of every plan row, which is
   * why the id never appears in front of a customer.
   *
   * **The names are deliberately untranslated for now**: Hebrew and Spanish
   * carry the English string, and the user will supply the translations. They
   * are present rather than optional so a missing one is a visible duplicate on
   * a pricing page rather than an `undefined` — and so the day the translations
   * arrive is a data change, not a schema change.
   *
   * The price is for display and for an admin reading the config. **Stripe
   * becomes the source of truth in Slice 4**; nothing here charges anyone.
   */
  presentation: {
    basic: {
      labels: { en: 'Essentials', he: 'Essentials', es: 'Essentials' },
      monthlyPriceUsd: 79,
      shownToCustomers: true,
      // Not yet: there is no buy path until WS-2 step 3. Flipping this to `true`
      // is what turns it on — no component changes with it, which is the whole
      // point of the flag living here.
      availableToBuy: false,
      // FYI ONLY — NOT A SWITCH (user decision, 2026-09-29). Shown on the admin
      // Tiers card and read by nothing else. Open question before it does
      // anything: what should inactive DO — stop new assignments? hide the plan
      // from customers? affect accounts already on it?
      active: true,
    },
    pro: {
      labels: { en: 'Autopilot', he: 'Autopilot', es: 'Autopilot' },
      monthlyPriceUsd: 129,
      shownToCustomers: true,
      availableToBuy: false,
      // FYI ONLY — NOT A SWITCH (user decision, 2026-09-29). Shown on the admin
      // Tiers card and read by nothing else. Open question before it does
      // anything: what should inactive DO — stop new assignments? hide the plan
      // from customers? affect accounts already on it?
      active: true,
    },
  },
} as const satisfies TierMatrix;
