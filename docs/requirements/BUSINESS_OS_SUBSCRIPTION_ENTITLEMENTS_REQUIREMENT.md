# Requirement: Business OS Subscription & Entitlements Module

> **Last Updated**: 2026-09-21

**Created by:** BA
**Date:** 2026-09-19
**Status:** SA reviewed 2026-09-19 — APPROVED WITH CONDITIONS (see §21). Business decisions B-2 to B-15 were decided by the user on 2026-09-19 (B-3 revised the same day). T-1 to T-12 decided by SA (§21). B-1 is still open (waiting on Eyal). **P-2 is DECIDED by the user (2026-09-19): at enforcement switch-on, all pre-existing accounts become open-ended champions. P-1 (trial contents) is DEFERRED to tier-configuration time and does not block this delivery.** **Scope of this delivery (B-13): entitlement infrastructure only.** No commercial tier assignments are implemented.

## Overview

Business OS gives every account every feature today; there is no plan, tier or entitlement check anywhere in the product. This requirement defines a **subscription and entitlements module**: one catalog of commercial capabilities, a tier matrix mechanism that says which capabilities and limits each tier gets, per-account layers on top of that (trial, champion, add-ons, admin overrides), and server-side enforcement across APIs, AI chat actions, background crons and public pages. The main design goal: **assigning a capability or a limit to a tier must be a one-line config change, not a code change**, because the tier matrix is still being revised (Eyal's `business-os-pricing-comparison.xlsx`). Billing (Stripe) comes last. The entitlement engine must ship and be testable first, with no billing attached.

> **Delivery scope (B-13, DECIDED 2026-09-19):** this delivery builds the entitlement **infrastructure** only: capability catalog, tier-matrix config mechanism, resolver, account state, cohorts, overrides, admin operations and the shadow report. **Eyal's tier assignments are not implemented, and no fixed set of tiers is built.** Every Basic / Growth / Pro value in this document is **illustrative** and shows how the mechanism will be used. Commercial tiers will be added later as configuration. Enforcement, metering and billing (Slices 2–4) remain specified here for later deliveries. **All existing accounts become open-ended champions with all capabilities as of the enforcement switch-on date (B-3 revised, B-14, P-2 DECIDED).** New signups follow the trial lifecycle; the trial contains all capabilities by default, and its final contents are **deferred to tier-configuration time (P-1)**.

---

## Table of Contents

1. [Context & Current State](#1-context--current-state)
2. [Concepts & Vocabulary](#2-concepts--vocabulary)
3. [Business Decisions Already Made](#3-business-decisions-already-made)
4. [User Stories](#4-user-stories)
5. [Capability Catalog & Shapes](#5-capability-catalog--shapes)
6. [Assigning Capabilities to Tiers (Config Shape)](#6-assigning-capabilities-to-tiers-config-shape)
7. [Configuration Storage Options](#7-configuration-storage-options)
8. [Effective Entitlement Resolution](#8-effective-entitlement-resolution)
9. [Account Lifecycle (State Machine)](#9-account-lifecycle-state-machine)
10. [Enforcement](#10-enforcement)
11. [Metering (AI Actions)](#11-metering-ai-actions)
12. [Admin Operations (No UI)](#12-admin-operations-no-ui)
13. [Billing Linkage Scope](#13-billing-linkage-scope)
14. [Functional Requirements](#14-functional-requirements)
15. [Non-Functional Requirements](#15-non-functional-requirements)
16. [Delivery Slicing](#16-delivery-slicing)
17. [Acceptance Criteria](#17-acceptance-criteria)
18. [Out of Scope / Future Roadmap](#18-out-of-scope--future-roadmap)
19. [Open Decisions](#19-open-decisions)
20. [Notes on Integration Points](#20-notes-on-integration-points)
21. [SA Review](#21-sa-review)

---

## 1. Context & Current State

The findings below were checked against the codebase on 2026-09-19.

| Area | Current state | Location |
|---|---|---|
| Commercial gating | **None.** Every Business OS account can use every feature. | — |
| Business-shape visibility | Tabs are shown or hidden based on what kind of business the account is. This is about relevance, **not** commercial gating. | `lib/business-os/businessShape.ts`, `app/api/capabilities/route.ts`, `components/business-os/BusinessOSTabs.tsx` |
| Internal plugin enablement | `capabilities` / `user_capabilities` (`UserCapabilityRepository`) turn internal plugins on per tenant. The provider-abstraction requirement keeps this as a separate, orthogonal concept. | See [BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) |
| Pilot Credits | 1,000 free credits at signup. 1 credit = 10 tokens. Stripe credit subscriptions use prices created on the fly (no fixed price IDs). A `boost_packs` table and admin API exist, as does quota allocation. | `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `lib/stripe/StripeService.ts`, `app/api/admin/boost-packs/route.ts`, `lib/services/QuotaAllocationService.ts` |
| Business OS AI usage | **Business OS never deducts credits.** The usage card calculates usage from `token_usage` and shows a `monthly_ai_allowance_usd` (default $10) for display only. Nothing enforces it. There are 18 Business OS LLM call sites. | `app/api/business-os/usage/route.ts` |
| Free-tier expiry | `check-free-tier-expiration` freezes accounts that never bought credits. It is **not scheduled** in `vercel.json` and has no concept of a grace period for client-facing pages. | `app/api/cron/check-free-tier-expiration/route.ts` |
| Teams | `organizations` / `organization_members` tables exist ("1 org = 1 user for now"), with no invites or seats. All Business OS data is keyed by `user_id`. | `supabase/migrations/20260615_add_organizations.sql` |
| Payment reminders | Reminders are **scheduled automatically for every booking invoice**. | `lib/services/BookingLifecycleService.ts:750` |
| Intake reminders | Run for every account. | `app/api/cron/intake-reminders/route.ts` |
| Branding | "Powered by AgentPilot" is an owner toggle per page (`show_powered_by`) on websites, and is **hard-coded** on public booking pages. | `app/business-os/website/page.tsx`, `lib/branding/footerBlockContent.ts`, `app/site/[subdomain]/book/page.tsx:69` |
| AI chat actions | About 107 actions are declared in the plugin definition, defined in the catalog, and executed by the mutate/for-each executors. | `lib/plugins/definitions/business-os-plugin-v2.json`, `lib/business-os/catalog/catalog.ts`, `lib/business-os/bizql/mutate/MutateExecutor.ts`, `lib/business-os/bizql/mutate/ForEachExecutor.ts` |

### Prior documents this requirement reconciles

| Document | Relationship |
|---|---|
| [PRICING_SYSTEM_IMPLEMENTATION_PLAN.md](/docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md) (2025-01-27, Explorer / Navigator / Commander) | **Superseded for Business OS.** Its tier names, credit multipliers and Settings-page UI plan do not apply to Business OS. Its ledger ideas (`credit_transactions` linked to `token_usage`, reserve/finalize) may be reused for metering (Slice 3). Whether to reuse its tables is an SA decision (T-9). It was never built. |
| [BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) §"Pluggable Access / Eligibility Strategy" (line 128), FR-3 (line 193), FR-7 (line 197) | **Fulfills the designed-but-not-built "License / subscription tier" seam.** That seam gates whole plugins. This module gates at a finer grain: capability, operation, variant and limit. The plugin access strategy becomes one consumer of the entitlement resolver, not a second source of truth. That requirement's FR-3/FR-7 wording ("license-tier strategy is a documented seam, not built") stays accurate until Slice 2 of this requirement. |

> **Doc gap:** the brief cited `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` as the inventory of the 18 Business OS LLM call sites. That file **is not present** on the current branch. Dev must find it or rebuild the inventory before Slice 3 (see FR-30).

---

## 2. Concepts & Vocabulary

| Term | Definition |
|---|---|
| **Capability** | A named commercial function the product can grant or withhold, e.g. `booking.calendar_sync` or `chat.invoice_control`. Each has one stable ID. |
| **Capability catalog** | The complete list of capabilities, with each one's shape, customer-facing name, category and behavior when not entitled or at a limit. This is the single source of truth for what *can* be gated. |
| **Tier (plan)** | A named commercial package. It is a set of default values, one for every capability in the catalog. The working names are Basic, Growth and Pro, but **there is no fixed set of tiers**: tiers are configuration, and **this delivery ships none** (B-13). |
| **Tier matrix** | The config that assigns a value for each capability to each tier. This is the thing that changes often. |
| **Entitlement** | The **effective** value of one capability for one account at one moment, after all layers are applied (§8). |
| **Limit / allowance** | A metered quantity per period (e.g. AI actions per month) or a fixed quantity (e.g. seats). |
| **Fair-use ceiling** | A limit that is not advertised and exists to catch abuse (e.g. email volume). Reaching it alerts the platform team and **never blocks the customer automatically** (B-7). |
| **Add-on** | A purchasable capability unlock on top of a tier, optionally with a quantity (extra seats, extra locations, custom domain, SMS, act-for-you automations). |
| **Boost** | A one-off pack that tops up a **metered** allowance only (e.g. +250 AI actions). It never unlocks a capability. |
| **Cohort / label** | An account classification that applies a bundle of adjustments: `trial`, `champion`, and possibly `beta` later. It is not a tier. A cohort's **contents** (which capabilities it grants) are cohort config. |
| **Champion** | A cohort that receives **every** catalog capability at its highest variant and quantity, including `beta` capabilities (B-14). Every account existing at the enforcement switch-on date becomes an **open-ended** champion with no end date until an admin sets one (B-3 revised, P-2 DECIDED). |
| **Per-account override** | An admin-set adjustment for one account: grant or revoke a capability, change a variant or quantity, extend an expiry, grant credits. Every override records a reason and can have an expiry. |
| **Policy value** | A business rule held as configuration rather than code, with a documented default (§6.4). Examples: trial clock start, trial contents, what a lower tier gets for search via chat, whether intake requests run while paused. |
| **Grandfathered entitlement** | A capability that an existing subscriber keeps after their tier loses it, until their renewal or a set sunset date (B-10). |
| **Period** | The reset window for a metered allowance (monthly). |
| **Grace** | A time-boxed window after a trial or subscription ends. The account is read-only, client-facing pages stay live and show warnings, and transactional client messages keep running (B-9). |
| **Paused** | The state after grace ends. New bookings, the public website and reminder messages stop. Invoice payment links, payment receipts and booking cancel/reschedule links keep working for the business's clients. Messages suppressed while paused are never sent later (B-11). Intake requests stop while paused by default (policy value, §6.4). |
| **Message class** | Every automated client-facing message is either **transactional** (booking confirmations, receipts, intake requests, reminders for existing bookings or invoices) or **marketing** (marketing sends, mass email, lead chasing). This drives grace behavior (B-9). |
| **AI action** | The customer-facing unit for AI usage. It is a **flat count**: each customer-visible AI action counts as 1, whatever its size (B-4). Pilot Credits and tokens remain the internal accounting unit. Customers never see tokens or credits. |
| **Setup AI** | AI used while a new account sets up: onboarding, first website generation, and services/intake generation, including regenerations. It **counts** against the trial AI allowance (B-12). |
| **Enforcement switch-on date** | The moment the Slice 2 enforcement flag is turned on in production. The launch migration runs at this moment (P-2 DECIDED). |
| **Business shape** | *Not* part of this module. It decides whether a feature is **relevant** to the business. Entitlement decides whether the account **has paid for it**. A tab is shown only if both are true (§10.5). |

---

## 3. Business Decisions Already Made

These are fixed inputs. They are listed so SA can trace each FR back to a decision. The follow-up decisions made on 2026-09-19 are recorded in §19 (B-2 to B-15, plus P-2 decided and P-1 deferred). Because of B-13, this delivery is infrastructure-only: D-1's tiers are added later as configuration, and D-2's trial contents are cohort configuration (§6.4). B-14 fixes what champions get (D-4).

| # | Decision |
|---|---|
| D-1 | Tiers are **Basic, Growth, Pro**. Pro-only features arrive as they are built. Working prices: Basic $20–30, Growth $30–50, Pro $100 per month. An annual option (2 months free) is planned. *(Per B-13 these are added later as configuration and are not implemented in this delivery. There is no fixed set of tiers in code, FR-3.)* |
| D-2 | **Trial**: every new signup gets a trial of 14 days (**length configurable**) with a small AI allowance. It ends at 14 days or when the trial allowance runs out, whichever comes first. *(Per B-13, the trial is **no longer defined as "Growth-level"**. Its contents are **trial cohort config**, currently defaulting to **all capabilities**. The final contents, including whether `beta` capabilities are included, are **deferred to tier-configuration time (P-1)** and do not block this delivery. The trial clock starts at the first onboarding message by default, §6.4.)* |
| D-3 | **End of trial with no purchase**: data is kept and the account becomes read-only. Client-facing pages (booking page, website, invoice links) stay live for about 7 days with warnings, then pause. What stays working once paused is refined by B-11. |
| D-4 | **Champions (design partners) are not a tier.** They are free accounts with the `champion` cohort: a longer expiry set per account (about 6 months), a higher AI allowance, beta features, and a longer grace (about 30 days). *(Per B-14, champions get every capability at its highest level. Per P-2, DECIDED, accounts migrated at enforcement switch-on are **open-ended** champions with no end date until an admin sets one.)* |
| D-5 | Only an **admin** can set the champion label, never the user. Admin authority comes from `admin_users` via `AdminAccessService`, **never** from `profiles.role`. |
| D-6 | When a champion converts, they get a **founder coupon** on their subscription (e.g. 50% off Growth for 24 months). This is a billing discount, not a tier. |
| D-7 | When a champion hits the AI cap, an **admin grants credits**. Champions do not buy boosts. |
| D-8 | **Boosts** are only for metered things (AI actions now, SMS later). Example: +250 AI actions for $10, +750 for $25. Paid plans only. The monthly allowance is used first, then the boost balance. Boost credits expire after 12 months. Warnings at 80% and 100%. Optional auto top-up with a monthly cap set by the customer. |
| D-9 | **Feature unlocks are not boosts**: seats, locations, custom domain, SMS and act-for-you automations are add-ons that unlock a capability, possibly with a quantity. |
| D-10 | **Flex (pay-as-you-go) is deferred.** The model must not rule it out. |
| D-11 | Pilot Credits are the internal unit. Customers see "AI actions". |
| D-12 | **Degrade, don't stop, at a limit.** When the AI allowance is used up, client-facing automations (lead replies, payment reminders, intake reminders) keep running with template text instead of AI. Only owner-facing AI (chat, insight write-ups, briefing) pauses. |
| D-13 | Do not cap cheap things that punish growth: contacts, bookings, invoices, website pages. Email gets only a quiet fair-use ceiling. |
| D-14 | Product cost per customer is small (about $0.40 Basic / $1.06 Growth / $2.51 Pro per month). AI limits exist to **protect against abuse, not to protect margin**, so they must be easy to tune. |

---

## 4. User Stories

- As **the business owner (Barak/Eyal)**, I want to move a capability or change a limit between tiers by editing one line of config and shipping it in a normal release, so that pricing can change without engineering work beyond the merge.
- As **the business owner**, I want the entitlement infrastructure in place before the commercial tiers are final, so that the tiers can be added later as configuration without new code.
- As **an admin**, I want to mark an account as a champion, set or extend its expiry, grant it AI credits or switch on a beta capability, without a UI and with an audit trail, so that design partners are looked after and every change can be traced.
- As **a new signup**, I want a trial with the configured contents (all capabilities for now), starting from my first onboarding message, so that I can judge the product before paying.
- As **a new signup setting up my business**, I want a trial AI allowance that easily covers my setup, and a warning before a regeneration would use it up, so that my trial doesn't end on day one without me knowing.
- As **an existing user when enforcement is switched on**, I want to become a champion with every capability and no end date, so that I lose nothing when entitlements are introduced.
- As **a customer on a lower tier** (once tiers exist), I want a clear "available on a higher plan" message when I try a feature I don't have, so that I understand the upgrade path and never see a broken screen.
- As **a customer who used up their AI allowance**, I want my client-facing automations to keep working (with template text), so that my clients are never left without a reply or a reminder.
- As **a customer whose trial ended**, I want my booking page, invoice links and transactional client messages to keep working for a grace period with a warning, so that my clients aren't cut off while I decide.
- As **a client of a business whose account is paused**, I want to still pay an invoice I already received and cancel or reschedule a booking I already made, so that I'm not stuck because of the business's subscription.
- As **a paying subscriber**, I want to keep a capability until my renewal even if my tier drops it, so that the product doesn't change under me mid-term.
- As **Dev/QA**, I want a test that fails when a capability is missing from any configured tier, or when a chat action is not mapped to a capability, so that gating gaps are caught before release.

---

## 5. Capability Catalog & Shapes

### 5.1 Capability shapes the model must express

| Shape | Meaning | Examples |
|---|---|---|
| **Boolean** | On or off. | `booking.calendar_sync`, `payments.multi_currency` |
| **Variant / mode** | One of several named options. | `intake.forms` = `manual` / `ai`; `website.branding` = `branded` / `unbranded`; `chat.search` level (what lower tiers get is a policy value, §6.4) |
| **Metered allowance** | A quantity per period that resets. Can be topped up with boosts. | `ai.actions` = N per month; later `sms.messages` |
| **Quantity** | A fixed count. Can be raised with add-ons. | `team.seats`, `business.locations` |
| **Fair-use ceiling** | A metered limit that is not advertised. It alerts the platform team and never blocks automatically (B-7). | `email.volume` |
| **Capability group (sub-capabilities)** | A named group covering many fine-grained operations on one surface. | `chat.invoice_control` covers the invoice-related chat actions |

### 5.2 Catalog entry: required attributes (business level)

Each catalog entry must declare: stable ID, customer-facing name, category, shape, lifecycle (`available` / `beta` / `not_built`), **at-limit behavior** (`degrade_to_template` / `pause` / `block`), **audience** (client-facing vs owner-facing, which drives D-12), **message class** for client-facing sends (`transactional` / `marketing`, which drives B-9), whether it can be sold as an add-on, and, for variant and quantity capabilities, **which value is highest** (needed for champions, B-14, and for the default trial contents). The exact field names are for the workplan.

### 5.3 Initial catalog (from column B of Eyal's sheet)

The **capabilities** below are built in this delivery as the catalog. **The Basic / Growth / Pro columns are illustrative only (B-13).** They show how Eyal's sheet would be expressed as configuration, and they are **not implemented** in this delivery. Rows marked **(S)** show assignments the user has referenced from the sheet or through a decision, kept as the intended starting point for the later tier configuration. Rows marked **(?)** are ambiguous and have been sent back to Eyal (see B-1).

| Category | Capability (proposed ID) | Shape | Basic | Growth | Pro |
|---|---|---|---|---|---|
| CRM | Contacts, pipeline, tasks (`crm.core`) | bool | on | on | on |
| CRM | Documents (`crm.documents`) | bool | on | on | on |
| CRM | Booking + Google Calendar sync (`booking.calendar_sync`) | bool | on | on | on |
| Website & Intake | AI website (`website.ai_site`) + branding (`website.branding`) | bool + variant | on, **branded (S)** | on, unbranded | on, unbranded |
| Website & Intake | Intake forms (`intake.forms`) | variant | **manual (S)** | **ai (S)** | **ai (S)** |
| Website & Intake | Intake reminders (`intake.reminders`) | bool | **off (S)** | **on (S)** | **on (S)** |
| Payments | Invoice payments (`payments.invoices`) **(?)** | bool | on | on | on |
| Payments | Card payments via Stripe (`payments.card`) **(?)** | bool | on | on | on |
| Payments | Reminders / retries / installments (`payments.reminders`) | bool | **off (S)** | on | on |
| Payments | Multi-currency (`payments.multi_currency`) | bool | off | off | on |
| AI & chat | Marketing chat, mass email (`chat.marketing`) **(?)** | group | off | on | on |
| AI & chat | Invoice control via chat (`chat.invoice_control`) | group | off | on | on |
| AI & chat | One-off email via chat (`chat.email`) | group | on | on | on |
| AI & chat | Search via chat (`chat.search`). What a lower tier gets (none / limited / full) is a policy value (§6.4). | group, variant level | off | off | on |
| AI & chat | Scheduling via chat (`chat.scheduling`) | group | on | on | on |
| AI & chat | Quotes via chat (`chat.quotes`) | group | off | on | on |
| AI & chat | On-demand reporting via chat (`chat.reporting`) | group | off | on | on |
| AI & chat | Bulk actions via chat (`chat.bulk`) | group | off | off | on |
| AI & chat | AI actions allowance (`ai.actions`) | metered / month (flat count, B-4) | small | medium | large |
| Marketing | Mass email campaigns (`marketing.mass_email`) **(?)** | bool | off | on | on |
| Marketing | Lead auto-reply & follow-up (`marketing.lead_response`) | bool | off | on | on |
| Marketing | Post creation & scheduling (`marketing.posts`) | bool | off | off | on |
| Insights | Automated checks (`insights.checks`): all 34 checks in code as **one capability**, with no per-check tiering (B-5). The sheet's "28" is stale. | bool | **off (S)** | **on (S)** | **on (S)** |
| Insights | Meta / GA4 / GBP data (`insights.channels`) | bool | off | on | on |
| Insights | Daily briefing (`insights.daily_briefing`) | bool | off | on | on |
| Support | Support tier (`support.level`) | variant | standard | standard | priority |
| Platform | Email volume (`email.volume`) | fair-use (alert only) | ceiling | ceiling | ceiling |
| Add-on | Marketing analytics (`addon.marketing_analytics`) **(?)** | bool add-on | purchasable | purchasable | included? |
| Add-on | Mobile chat + insights (`addon.mobile`) **(?)** | bool add-on | purchasable | purchasable | included? |
| Add-on | Full payment cycle, 1% fee (`addon.full_payment_cycle`) **(?)** | bool add-on | purchasable | purchasable | purchasable |
| Add-on | SMS (`addon.sms` + metered `sms.messages`) | bool add-on + metered | purchasable | purchasable | purchasable |
| Add-on | Team seats (`team.seats`) | quantity | 1 | 1 (+add-on) | N (+add-on) |
| Add-on | Locations (`business.locations`) | quantity | 1 | 1 (+add-on) | N (+add-on) |
| Add-on | Custom domain (`website.custom_domain`) | bool add-on | purchasable | purchasable | included? |
| Add-on | Act-for-you automations (`addon.act_for_you`) | bool add-on | purchasable | purchasable | purchasable |

**Not in the catalog on purpose (D-13):** contacts, bookings, invoices and website pages have no count cap.

---

## 6. Assigning Capabilities to Tiers (Config Shape)

### 6.1 Principle

The **catalog** (what exists, its shape and its behavior) changes only when engineering builds or changes a feature. The **tier matrix** (who gets what) changes whenever pricing changes. They must be kept apart so that a pricing change never touches enforcement code.

### 6.2 Illustrative tier matrix entry

The syntax below only shows the intended granularity. The real format is part of the storage decision (§7, T-1). **The `tiers` block is illustrative and is not shipped in this delivery (B-13).** The shipped config contains the mechanism, the `trial` and `champion` cohorts and the policy values (§6.4). Commercial tiers are added later in the same shape.

**File:** *(location per SA decision)*

```json
{
  "tiers": {
    "basic":  { "crm.core": true, "intake.forms": "manual", "website.branding": "branded",   "payments.reminders": false, "chat.search": "none", "insights.checks": false, "ai.actions": { "per_month": 100 } },
    "growth": { "crm.core": true, "intake.forms": "ai",     "website.branding": "unbranded", "payments.reminders": true,  "chat.search": "none", "insights.checks": true,  "ai.actions": { "per_month": 500 } },
    "pro":    { "crm.core": true, "intake.forms": "ai",     "website.branding": "unbranded", "payments.reminders": true,  "chat.search": "full", "insights.checks": true,  "ai.actions": { "per_month": 2000 } }
  },
  "cohorts": {
    "trial":    { "grant_all": "highest", "duration_days": 14, "clock_start": "first_onboarding_message", "ai.actions": { "total": 150 }, "grace_days": 7 },
    "champion": { "grant_all": "highest", "include_lifecycle": ["beta"], "expiry": "open_ended", "ai.actions": { "per_month": 3000 }, "grace_days": 30 }
  }
}
```

(All numbers are placeholders. The trial's final contents, including whether `beta` is included, are **deferred to tier-configuration time (P-1)**; the current default is all capabilities. The trial `total` must be sized per FR-41, since it includes setup AI.)

### 6.3 Worked example: moving "search via chat" from Pro to Growth

*(Illustrative. It demonstrates the mechanism with the example tiers above, which are not shipped.)* Change `"chat.search": "none"` to `"full"` (or to a limited level, if one is configured) under `growth`. That is the whole change. No route, executor, cron or UI code is touched, because:

- every chat action that performs a search is mapped in the catalog to the `chat.search` group (FR-6), and
- the enforcement points ask "is `chat.search` entitled for this account, and at what level?". They never ask "is this account on Pro?" (FR-12).

The invariant tests (FR-8) still pass, since every tier still has a value for `chat.search`. Because this change **adds** a capability to a tier, it applies to every Growth account as soon as it is released (B-10). Had it **removed** a capability, existing subscribers would keep it until renewal or a set sunset date (FR-38).

### 6.4 Policy values (configuration, not code)

Several points that earlier needed a business answer are **configuration values with documented defaults** (decided by user 2026-09-19, B-15). The defaults can be changed in config without a code change, through a normal release (B-2).

| Policy value | Default for now | Notes |
|---|---|---|
| Commercial tiers and their capability values | **None shipped** (B-13). No fixed set of tiers. | Eyal's sheet (§5.3) is the intended starting point once finalized (B-1). |
| What "search via chat" means on lower tiers | Set per tier as the `chat.search` level (e.g. none / limited / full) | Takes effect only once tiers are configured. |
| Champion entitlement level | **All capabilities at highest variant/quantity, including beta** (B-14) | A cohort setting, not a tier. |
| Champion expiry, accounts migrated at launch | **Open-ended: no end date until an admin sets one** (P-2 DECIDED) | An admin can set an expiry on any champion later (§12). |
| Champion expiry, champions set later by an admin | Per account. Cohort default about 6 months (D-4) | Admin can set, extend or clear it (§12). |
| Champion grace | 30 days | D-4. Applies only when a champion has an expiry. |
| Trial length | 14 days | D-2 |
| **Trial clock start** | **First onboarding message** | Not account creation. |
| **Trial contents** | **All capabilities at highest variant/quantity (`grant_all`)** | Replaces D-2's "Growth-level". Final contents, including whether `beta` is included, are **deferred to tier-configuration time (P-1)**. It is a config change, not a blocker for this delivery. |
| Trial AI allowance and setup headroom target | Placeholder (§6.2) | Sized per FR-41. |
| Trial grace | 7 days | D-3 |
| **Intake requests while paused** | **Stop** | Intake requests are transactional and keep running in `grace` (B-9). In `paused` they stop by default. |
| Usage warning thresholds | 80% / 100% | D-8 |

---

## 7. Configuration Storage Options

This is an evaluation for SA. **The final choice is SA's decision (T-1).** Per-account state (current tier, cohort, expiry, add-ons, overrides, credit balances, grandfathered entitlements) is **always stored in the DB** whatever is chosen here. The options below apply only to the **catalog** and the **tier matrix**.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. Typed code-resident config** (TypeScript module) | Catalog and matrix are both typed constants in the repo. | Compile-time checks (a typo in a capability ID fails the build). Changes reviewed in a PR with git history. Nothing to query at runtime, so it is fast. Easy to test. | Every matrix change needs a PR and a deploy (minutes on Vercel). A non-engineer cannot edit it safely. |
| **B. JSON/YAML resource file** | Catalog and matrix are a data file in the repo, validated with Zod at load. | Readable by non-engineers. Still has git history. Can be moved to DB/remote later without changing its shape. | IDs are only checked at runtime and in tests, not by the compiler. Still needs a deploy. |
| **C. DB tables** | Catalog and matrix are rows in Postgres. | Changes take effect without a deploy. A future admin UI would be natural. | Changes bypass PR review unless audited. Easy to create drift between environments. Adds a DB read to the hot path, so it needs caching. Capability IDs used in code can refer to rows that don't exist. Seeding and migrations add work. |
| **D. Hybrid (recommended)**: code-defined catalog + config-file tier matrix, with a loader seam | The catalog is typed code, because enforcement code refers to its IDs. The matrix is a Zod-validated config file (A or B syntax) read through one loader interface. Per-account layers live in the DB. | Keeps "what exists" (engineering-owned, compile-checked) apart from "who gets what" (pricing-owned, one-line edits). Reviewed and versioned. Fast. The loader seam means the matrix can move to DB (option C) later with no change to resolver or enforcement code. | Matrix changes still need a deploy until the loader moves to DB. |

**BA recommendation: Option D.** Pricing is still moving, but the moves happen in reviewed batches (Eyal's revisions), not minute to minute. A Vercel redeploy is fast. Git gives a free audit trail of pricing changes. The part that genuinely needs runtime changes without a deploy (one champion's expiry, one account's credit grant) is per-account, and that goes in the DB under every option.

**Business constraint (B-2, DECIDED 2026-09-19):** tier matrix changes go through a **normal release**. There is no live editing, and Eyal does not edit the matrix directly. This is to be revisited once the matrix stabilizes, so **whatever storage SA chooses must not rule out moving to live edits later** (FR-34). This constraint does not settle T-1. It only removes "must edit without a release" as a requirement for now.

---

## 8. Effective Entitlement Resolution

An account's effective entitlements are computed in this fixed order. Each later layer can override an earlier one:

| Order | Layer | Source | Example |
|---|---|---|---|
| 1 | **Tier defaults** | Tier matrix for the account's current tier, if any. An account with no tier has no tier defaults, which is every account in this delivery (B-13). | Growth: `chat.search` = none (illustrative) |
| 1a | **Grandfathered entitlements** | Capabilities the account's tier has lost but that this subscriber keeps until renewal or a sunset date (B-10). | Growth subscriber keeps a removed capability until 2027-03-01 |
| 2 | **Add-ons** | Add-ons the account has purchased or been granted. | +2 seats, custom domain on |
| 3 | **Cohort adjustments** | Cohort config (`trial`, `champion`). **Champion grants every catalog capability at its highest variant/quantity, including `beta` (B-14).** Trial grants its configured contents (currently all capabilities; final contents deferred, P-1). | Champion: every capability at highest level, `ai.actions` = champion allowance |
| 4 | **Per-account admin overrides** | DB, set by an admin, each with a reason and optional expiry. | Revoke `chat.bulk` from one champion; grant `chat.bulk` to one trial until 2026-12-31 |
| 5 | **Account state overlay** | Lifecycle state (§9). Applied **last**, and it **caps** everything above it. | Read-only grace: owner writes blocked, marketing sends stopped; public pages and transactional messages live with a warning |

Rules:

- Overrides can both **grant** and **revoke**. Quantity and metered values from add-ons and boosts **add** to the tier value. Cohort and override values **replace** it unless explicitly marked additive (exact semantics are for the workplan; SA to confirm, T-4).
- Capabilities with lifecycle `not_built` are never entitled, whatever the config says. This includes champions and trials. Capabilities with lifecycle `beta` are entitled only through a cohort (including champion) or an override.
- For champions (and for trials under the `grant_all` default), "highest" is taken from the catalog's declared ordering for variants and quantities. For the metered AI allowance, each cohort uses its own configured value (champion: D-4 higher allowance and D-7 admin grants; trial: the one-off trial total).
- An override or grandfathered entitlement that has expired is ignored. It is never deleted silently. A champion with no expiry never lapses on its own (P-2).
- **Tier changes over time (B-10, DECIDED):** a capability **added** to a tier applies to every account on that tier from the release that adds it. A capability **removed** from a tier stays with existing subscribers of that tier until their next renewal or a set sunset date, whichever the business chooses for that change. New subscribers get the new matrix. How this is recorded (e.g. plan versioning) is T-11.
- Business shape is **not** a layer here. It is checked separately (§10.5).

---

## 9. Account Lifecycle (State Machine)

| State | Entered when | Owner app | Client-facing pages & automations | Exits to |
|---|---|---|---|---|
| `trial` | New signup. The clock starts at the first onboarding message by default (§6.4). | Trial cohort contents: all capabilities for now; final contents deferred to tier-configuration time (P-1). Setup AI counts against the trial allowance, with a warning before a setup regeneration would use it up (B-12). | Live | `active` (pays); `grace` (trial expires **or** trial AI allowance used up) |
| `champion` | Admin sets cohort. Also, at the launch migration, every account existing at the **enforcement switch-on date** (B-3 revised, P-2 DECIDED), as an **open-ended** champion with no end date. | Every capability at highest level, including beta (B-14) | Live | `active` (converts, founder coupon); `grace` (only if an expiry has been set and is reached) |
| `active` | Paid subscription in force (or admin-assigned tier before billing exists) | Per entitlements | Live | `grace` (cancelled / not renewed); `past_due` (Slice 4) |
| `past_due` | Payment failed (Slice 4) | Per entitlements, with a banner | Live | `active` (payment recovered); `grace` (dunning exhausted) |
| `grace` | Trial, champion (with an expiry) or subscription ended | **Read-only**: view and export only | Pages live **with warnings**. **Transactional** messages keep running: booking confirmations, receipts, intake requests, reminders for existing bookings and invoices. **Marketing** stops: marketing sends, mass email, lead chasing (B-9). Duration from config (trial 7 days, champion 30 days). | `active` (pays); `paused` (grace elapsed) |
| `paused` | Grace elapsed | Read-only | **Keep working for the business's clients (B-11):** invoice payment links, payment receipts, booking cancel/reschedule links. **Stop:** new bookings, the public website (neutral "unavailable" page), all reminder messages, and intake requests (policy value, default stop, §6.4). Suppressed messages are **never sent retroactively** when the account reactivates. | `active` (pays) |

Requirements on this lifecycle:

- Data is **never deleted** by a lifecycle transition. Data deletion is governed separately by the Business OS data purge requirement.
- Expiry dates, grace lengths, trial length and trial clock start are **config or per-account values, never constants in code**. A champion may have **no expiry** (open-ended), which is the state every migrated account starts in.
- An admin can move an account between states by setting, extending or clearing an expiry or by changing cohort (§12), and every such move is audited.
- Paying from `grace` or `paused` restores `active` immediately, with no data loss. Reminders and other messages that were suppressed while paused are dropped, not caught up (B-11). Only sends that fall due after reactivation go out.
- **Launch migration (B-3 REVISED + P-2, DECIDED by user 2026-09-19):** every Business OS account that exists **at the enforcement switch-on date** is placed on the `champion` cohort with **no expiry** (open-ended, no end date until an admin sets one). This includes accounts that signed up, and started a trial, after this delivery shipped but before enforcement was switched on. No existing account is put on a fresh trial. Accounts that sign up after switch-on enter `trial`. **In this delivery (B-13)** the migration is built and can be dry-run in shadow mode (FR-22), but it is not executed, and nothing is blocked.

---

## 10. Enforcement

*(Specified for a later delivery. Not built in this delivery, B-13. Only the shadow report of what would be enforced, FR-22, is in scope now.)*

### 10.1 Principle

Enforcement is **server-side and centralized**. Every surface asks the same resolver the same question: "may account X use capability C (at variant V / quantity Q) right now?" Hiding things in the UI is only a courtesy and **never counts as enforcement**.

### 10.2 Surfaces that must be covered

| Surface | Scope |
|---|---|
| API routes | `app/api/business-os/**`, `app/api/crm/**`, `app/api/payments/**`, `app/api/website/**`, `app/api/intake/**`, `app/api/scheduling/**` |
| AI chat | `app/api/business-os/chat-v4/**` and the actions executed via `MutateExecutor` / `ForEachExecutor`. Every catalog action maps to one capability (or group). The legacy chat routes (`chat`, `chat-v2`, `chat-command`) must be gated too, or confirmed dead (T-8). |
| Background crons (`vercel.json`) | `payment-reminders`, `payment-retry`, `intake-reminders`, `lead-response`, `daily-briefing`, `insight-metrics`, `insight-detect`, `insight-automations`, `channel-metrics-sync`, `calendar-sync`, and `abandoned-proposal-invoices` (also scheduled; it acts on invoices automatically) |
| Scheduling side effects | Automatic scheduling inside services, e.g. `BookingLifecycleService` scheduling payment reminders for every booking invoice |
| Public pages | `app/site/[subdomain]/**` (website, booking), invoice/payment links, booking manage (cancel/reschedule) links. Branding variant and `paused` state apply here, with the B-11 split between surfaces that stop and surfaces that keep working. |

### 10.3 Outcome types

| Outcome | Meaning | Required behavior |
|---|---|---|
| `allowed` | Entitled and within limit | Proceed |
| `not_entitled` | The account's entitlements do not include it | APIs return a consistent structured error that carries the capability and the lowest configured tier that includes it, so the UI can show an upgrade message. Chat explains and does not run the action. Crons skip the account without error. |
| `limit_reached` | Metered allowance used up | Follow the capability's at-limit behavior: **degrade** (client-facing: template text), **pause** (owner-facing AI), or **block**. Fair-use ceilings never block automatically (B-7). |
| `read_only` | Account is in `grace` / `paused` | Block owner writes. Allow reads and export. In `grace`, transactional client messages continue and marketing sends stop (B-9). |
| `paused_public` | Account is `paused` | The public website and new-booking pages show the neutral unavailable page. Reminder messages and (by default) intake requests are suppressed with no retroactive send. Invoice payment links, payment receipts and booking cancel/reschedule links keep working (B-11). |

### 10.4 Known conflicts gating must resolve

| Conflict | Required resolution |
|---|---|
| Payment reminders are scheduled automatically for every booking invoice (`BookingLifecycleService.ts:750`). Lower tiers may not be entitled (per the eventual tier config). | Check at **scheduling time** (don't schedule) **and** at **send time** (skip if the account has since lost entitlement). Checking at send time is mandatory so that downgrades take effect. Reminders for existing invoices are transactional, so an entitled account in `grace` keeps sending them (B-9). In `paused` they are suppressed and never caught up (B-11). |
| Intake reminders run for everyone. Lower tiers may not be entitled. | The `intake-reminders` cron checks entitlement per account. In `paused`, intake requests follow the policy value (default: stop). |
| `lead-response` in grace. | Lead chasing is **marketing**, so it stops during `grace` (B-9). |
| "Powered by AgentPilot" is an owner toggle (`show_powered_by`) on websites and hard-coded on booking pages. | Branding follows `website.branding`. On `branded` levels the footer is forced on and the owner toggle is disabled. On `unbranded` levels the owner toggle works. The booking page follows the same entitlement. |
| Degraded client-facing automations need template text. | Every client-facing AI call site must have a template fallback (lead reply, payment reminder, intake reminder). Where one is missing, Slice 3 builds it. |

### 10.5 Entitlement vs business shape

A tab or feature is **shown** only if it is relevant to the business shape **and** entitled. If it is relevant but not entitled, it may be shown as locked with an upgrade message (a UX decision, outside this requirement). If it is entitled but not relevant, it stays hidden. The two checks stay in separate code paths, and neither may be implemented in terms of the other.

### 10.6 Failure policy (T-3)

If the entitlement lookup fails (DB error, bad config), the system needs a defined policy. **BA suggestion for SA:**

- **Client-facing surfaces** (public pages, client-facing automations) **fail open** to the last known entitlements, so that a lookup failure never takes down a customer's booking page or invoice link.
- **Owner-facing paid unlocks and metered AI** **fail closed**. Metered AI degrades to template text rather than stopping outright.
- Every fallback is logged at `error` level.
- An invalid tier-matrix config must fail **at load and in CI**, never at request time.

---

## 11. Metering (AI Actions)

*(Specified for a later delivery, Slice 3. Not built in this delivery, B-13.)*

| Aspect | Requirement |
|---|---|
| What is counted | AI usage at all Business OS LLM call sites, **including background ones** (insight write-ups, daily briefing, lead replies) **and setup AI** (onboarding, first website generation, services/intake generation, and their regenerations, B-12), shown to the customer as AI actions. Later: SMS messages. |
| Unit (B-4, DECIDED) | An AI action is a **flat count**: 1 per customer-visible AI action, **not weighted by tokens or size**. Pilot Credits and tokens are still recorded as the internal accounting unit (cost and abuse monitoring), but the allowance, warnings and boosts are counted in AI actions. What counts as one customer-visible AI action at each call site is defined in the FR-30 inventory. |
| Period (B-6, DECIDED) | Monthly allowance that **resets each period and does not roll over**. The reset boundary (calendar month vs billing anniversary) is decision T-6. |
| Consumption order | Period allowance first, then boost balance (soonest-expiring boost first). Boost balances last 12 months from purchase. |
| Trial allowance | A one-off total for the trial, not monthly. Using it up ends the trial (D-2). **Setup AI counts against it (B-12, DECIDED).** So: (1) the trial allowance must be **sized to cover a typical full setup with meaningful headroom left for trying the product**. The size is based on the measured AI actions of a typical full setup from the FR-30 inventory, and both numbers are recorded next to each other in the config (BA suggestion: at least half of the trial allowance left after a typical setup). (2) Before a setup action or regeneration that would **use up** the remaining trial allowance (or push it past a configurable low-balance threshold), the owner is **warned first**, told how many AI actions remain and that running out ends the trial, and can choose not to proceed. The trial must never end silently on day one because of setup. |
| Champions | Allowance via champion cohort config (D-4 higher allowance). When they hit the cap, an admin grants credits (§12). Champions have no boost purchase path. |
| Warnings | Configurable thresholds (default 80% and 100%). Each threshold is notified once per period. The channel (in-app / email) is a UX decision. The setup pre-action warning (above) is in addition to these. |
| Auto top-up | Opt-in, with a monthly spend cap set by the customer. Billing slice only (Slice 4). |
| Relationship to existing credits | Business OS starts metering AI for the first time. The signup grant of 1,000 credits in `CreditService`, the display-only `monthly_ai_allowance_usd`, and the unscheduled `check-free-tier-expiration` cron must each be reconciled: reused, replaced or retired (T-9). There must be **one** allowance a Business OS customer sees, not two. |
| Fair-use (email) (B-7, DECIDED) | Email volume is counted and never shown to the customer. Reaching the ceiling **alerts the platform team and does not block the customer**. Blocking is only for clear abuse, done by an admin through the override path (§12). |

---

## 12. Admin Operations (No UI)

**In scope for this delivery (B-13).** No admin UI is in scope. The following operations must still be possible **through a sanctioned, admin-authorized path** (admin API endpoints and/or a script; mechanism T-7). Editing the DB directly by hand is not a sanctioned path, because it bypasses authorization and audit.

| Operation | Notes |
|---|---|
| Set / clear cohort (`champion`, `trial`) | Admin only (D-5). The launch migration puts every existing account on `champion`, open-ended, at enforcement switch-on (B-3 revised, P-2). After that, champion is set by an admin. |
| Set / extend / clear expiry and grace for one account | Moves lifecycle state (§9). This includes setting an end date on an open-ended champion, which is how a migrated account is eventually moved off the free cohort. |
| Grant AI credits | For champions (D-7) and support goodwill, including a trial that ran short during setup. Amount, reason, optional expiry. |
| Grant / revoke a capability, or set variant or quantity | Per-account override with reason and optional expiry. It can revoke from a champion or a trial as well as grant. It is also the only way to block email for clear abuse (B-7). |
| Assign tier manually | Available once commercial tiers are configured. Needed before billing exists and for comped accounts. |
| Set a sunset date for a grandfathered capability | Used when a tier loses a capability (B-10) |
| Inspect effective entitlements for an account | Read-only. Shows every layer and which layer won, so support can answer "why can't I…?" |

Every write operation must:

1. Be authorized via `AdminAccessService` (the `admin_users` table). `profiles.role` is never used.
2. Be written to `AuditTrailService` (non-blocking) with actor, target account, before/after values and reason.
3. Validate its input with Zod.
4. Be impossible for a user to perform on their own account through any user-facing route (including profile update routes that accept arbitrary fields).

---

## 13. Billing Linkage Scope

| Item | Slice |
|---|---|
| Entitlement engine, config, admin operations, enforcement, metering: all work with **admin-assigned tiers and no Stripe** | 1–3 |
| Stripe product/price per tier (monthly + annual), with **fixed price IDs** from config. Today `StripeService` creates credit prices on the fly, which is not suitable for tiered plans (T-10). | 4 |
| Checkout, upgrade/downgrade, cancellation → lifecycle transitions via webhooks | 4 |
| Renewal events that end grandfathered entitlements (B-10) | 4. Before billing exists, grandfathering ends on the admin-set sunset date. |
| Founder coupon applied at champion conversion | 4 |
| Boost checkout (one-off) and optional auto top-up with customer cap | 4 |
| Add-on checkout (seats, domain, SMS…) | 4 or later |
| Proration, tax, invoicing presentation | Billing workplan (not specified here) |

**Recommendation:** the entitlement engine must never import from billing. Billing only *writes* account state (tier, add-ons, boost balance, lifecycle) and the engine *reads* it. This keeps Slices 1–3 shippable and testable before any payment code exists.

---

## 14. Functional Requirements

FRs marked **[now]** are in this delivery (B-13). The rest are specified for later deliveries.

**Catalog & config**

1. **FR-1** [now] A single capability catalog defines every gateable capability with the attributes in §5.2.
2. **FR-2** [now] The catalog supports the shapes in §5.1: boolean, variant, metered allowance, quantity, fair-use ceiling, capability group.
3. **FR-3** [now] **There is no fixed set of tiers.** The tier matrix mechanism supports any number of tiers defined in configuration, with no tier names in code. Every configured tier must assign a value to **every** catalog capability, with no implicit defaults. This delivery ships **no commercial tiers** (B-13). Basic / Growth / Pro, or any other tiers, are added later as configuration only.
4. **FR-4** [now] Changing a capability's value for a tier is a change to one entry in the tier matrix and requires no code change (§6.3). It ships through a normal release (B-2).
5. **FR-5** [now] Cohort config (trial, champion) is declared alongside the tier matrix: contents (including `grant_all` at highest level), duration or open-ended expiry, clock start, grace length, allowance adjustments, lifecycle inclusions (e.g. beta).
6. **FR-6** [now] Every AI chat action in `lib/business-os/catalog/catalog.ts` maps to exactly one capability or capability group.
7. **FR-7** [now] The tier matrix, cohort config and policy values are validated at load (Zod). Unknown capability IDs, incomplete tiers and wrongly-shaped values are rejected.
8. **FR-8** [now] Automated invariant tests fail if: a catalog capability has no value in any configured tier; a chat action is unmapped; config refers to an unknown capability; a gated surface listed in §10.2 has no declared capability or explicit "ungated" marker; a client-facing send has no message class; a variant or quantity capability has no declared highest value.

**Resolution & lifecycle**

9. **FR-9** [now] A resolver computes an account's effective entitlements using the layer order in §8. It is the only component that answers entitlement questions.
10. **FR-10** [now] The resolver can explain its result: for each capability, which layer determined the value.
11. **FR-11** [now] Account lifecycle state follows §9 and is recorded per account. Trial length, trial clock start, grace lengths and champion expiry (including **none**, for open-ended champions) are config or per-account values.
12. **FR-12** [now] No application code branches on tier name. Code asks only about capabilities.
13. **FR-13** [now] Capabilities with lifecycle `not_built` are never entitled. Capabilities with lifecycle `beta` are entitled only through cohort or override.
14. **FR-14** [now: build and dry-run; executed at enforcement switch-on] New signups enter `trial` automatically, with the clock starting at the configured start event (default: first onboarding message) and the trial contents from cohort config (currently all capabilities; final contents deferred to tier-configuration time, P-1). A **launch migration** places **every Business OS account existing at the enforcement switch-on date** on the `champion` cohort as an **open-ended** champion with no end date until an admin sets one (B-3 revised, P-2 DECIDED by user 2026-09-19). No existing account gets a fresh trial. The migration is idempotent and built in this delivery, can be dry-run in shadow mode, and is executed only when enforcement is switched on.

**Enforcement** (later delivery)

15. **FR-15** Every surface in §10.2 enforces entitlements server-side through the resolver.
16. **FR-16** Outcomes and required behaviors follow §10.3. `not_entitled` API errors use one consistent structured shape that includes the capability and the lowest configured tier that includes it.
17. **FR-17** Chat must not execute a non-entitled action, and must reply with a clear, user-friendly explanation.
18. **FR-18** Crons check entitlement and lifecycle state **per account at execution time**. Scheduled work (e.g. reminders) is also checked at send time, not only when it was scheduled.
19. **FR-19** Public-page branding follows `website.branding`. The owner `show_powered_by` toggle works only where the level is unbranded. The booking page follows the same rule.
20. **FR-20** `grace` makes the owner app read-only (view and export allowed). In `grace`, **transactional** client messages continue and **marketing** sends stop, per B-9 and §9. `paused` behaves as defined in FR-40 (B-11).
21. **FR-21** The failure policy for a failed entitlement lookup is implemented as decided in T-3 and logged.
22. **FR-22** [now] This delivery ships a **shadow mode**: the resolver runs and logs what *would* be gated per surface and account, while blocking nothing. It is controlled by a flag. It also reports the effect of the launch migration as a dry run (which accounts would become open-ended champions).

**Metering** (later delivery)

23. **FR-23** Business OS AI usage is metered as a flat count of AI actions (1 per customer-visible AI action, not weighted by tokens), with Pilot Credits/tokens still recorded internally (§11, B-4).
24. **FR-24** Consumption order: period allowance, then boost balance (soonest-expiring first). Boosts expire after 12 months.
25. **FR-25** When the allowance is used up, capabilities marked client-facing degrade to template text and owner-facing AI pauses (D-12).
26. **FR-26** Usage warnings fire at configurable thresholds (default 80% / 100%), once per threshold per period.
27. **FR-27** Using up the trial allowance ends the trial (moves to `grace`). Setup AI counts toward it (FR-41), and the trial must never end from setup without the prior warning in FR-42.
28. **FR-28** Reaching the email fair-use ceiling alerts the platform team and **does not block** the customer. It is never shown to the customer. Blocking for clear abuse happens only through an admin override (B-7).
29. **FR-29** There is exactly one customer-visible AI allowance for Business OS. The existing display-only `monthly_ai_allowance_usd` and signup credit grant are reconciled (T-9).
30. **FR-30** Every Business OS LLM call site (currently 18) is inventoried and classified as client-facing or owner-facing. The inventory also records its message class (transactional / marketing) if it sends to clients, what counts as one AI action there, whether it is setup AI, and its template fallback.

**Admin**

31. **FR-31** [now] The admin operations in §12 are available without a UI through a sanctioned path.
32. **FR-32** [now] Every admin write is authorized via `AdminAccessService`, audited via `AuditTrailService`, and validated with Zod. Cohort, tier, override and credit fields cannot be written through any user-facing route.

**Billing (Slice 4)** (later delivery)

33. **FR-33** Stripe subscriptions per tier (monthly/annual) with price IDs held in config, founder coupon at champion conversion, boost checkout, optional auto top-up. Webhooks write account state only.

**Decided business rules (2026-09-19)**

34. **FR-34** [now] (B-2) The tier matrix is changed only through a normal release. There is no runtime editing path and no direct editing by non-engineers in this scope. The resolver reads the matrix only through a loader seam, so that moving to live edits later needs no change to resolver or enforcement code.
35. **FR-35** [now] (B-5) All insight automated checks (34 in code today) are governed by one catalog capability, `insights.checks`, with no per-check tiering. New checks added later fall under the same capability automatically. Which tiers include it is tier configuration, added later (B-13). The sheet's intent is Growth and Pro.
36. **FR-36** (B-6) The monthly AI allowance resets each period and unused allowance does not roll over. Boost balances remain usable for 12 months from purchase.
37. **FR-37** [now] (B-8) Business OS entitlements cover Business OS only. A Business OS subscription does not grant use of the general AgentPilot agent platform, and agent-platform credits and plans do not grant Business OS entitlements. The model must not prevent a deliberate bundle later.
38. **FR-38** [now] (B-10) When a capability is **added** to a tier, every account on that tier gets it from the release that adds it. When a capability is **removed** from a tier, existing subscribers on that tier keep it (grandfathered, §8 layer 1a) until their next renewal or an admin-set sunset date. New subscribers and trials get the updated matrix. The mechanism is built now, and it takes effect once tiers are configured.
39. **FR-39** [now] (B-9) Every automated client-facing send is classified as transactional or marketing (§5.2) in the catalog. The lifecycle overlay uses this class to decide what runs during `grace` (enforced in a later delivery).
40. **FR-40** (B-11) In `paused`, these keep working for the business's clients: invoice payment links (including taking payment), payment receipts for payments made, and booking cancel/reschedule links. These stop: new bookings, the public website (neutral unavailable page), all reminder messages, and intake requests (policy value, default stop, §6.4). Messages suppressed during `paused` are **never sent retroactively** on reactivation. They are recorded as suppressed, not queued.
41. **FR-41** (B-12) Setup AI (onboarding, first website generation, services/intake generation, and their regenerations) is metered as AI actions and **counts against the trial AI allowance**. The trial allowance in cohort config must be sized to cover a typical full setup with meaningful headroom for trying the product. The typical-setup consumption, measured from the FR-30 inventory, is recorded next to the configured allowance, and the headroom target is a config-documented business value.
42. **FR-42** (B-12) Before any setup action or regeneration that would use up the remaining trial allowance, or push it below a configurable low-balance threshold, the owner is warned before the action runs. The warning shows the AI actions remaining and says that running out ends the trial. The owner can cancel. The trial must never end silently because of setup.
43. **FR-43** [now] (B-13) This delivery is limited to entitlement infrastructure: catalog, tier-matrix config mechanism, resolver, account state, cohorts, overrides, admin operations, the shadow report and the (not yet executed) launch migration. It does not implement commercial tier assignments, and no customer-facing behavior changes.
44. **FR-44** [now] (B-14) The `champion` cohort resolves to **every** catalog capability: booleans on, variants at their highest declared value, quantities at their highest declared value, and `beta` capabilities included. `not_built` capabilities stay excluded. Metered AI uses the champion cohort's configured allowance. Admin overrides can still revoke a capability from an individual champion.
45. **FR-45** [now] (B-15) The policy values in §6.4 are configuration with documented defaults, not code: tier assignments including what lower tiers get for search via chat, champion level, champion expiry for migrated accounts (open-ended, P-2 DECIDED), trial clock start (default: first onboarding message), trial contents (currently all capabilities; final contents deferred to tier configuration, P-1), and intake requests while paused (default: stop). Changing a default is a config change through a normal release.

---

## 15. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Changeability** | A tier-matrix change is a one-entry config change shipped in a normal release (B-2). There is no live editing for now, but the design must allow moving to live edits later (FR-34). Adding the commercial tiers later, and settling the trial contents with them (P-1), is a configuration change only (B-13, FR-3). |
| **Performance** | An entitlement check on a hot path (API, chat turn) adds at most one cached lookup per request. Effective entitlements are resolved once per request/turn and reused. Crons resolve in batch per run, not per item. The target is <10 ms added p95 when cached (SA to confirm). Metering writes must not block the user-facing response. |
| **Cache correctness** | When an admin override or billing change happens, it must take effect within a bounded, documented time (proposed: 60 s or less) or immediately via invalidation (SA, T-5). |
| **Security** | Server-side only. Tier, cohort and override values are never taken from the client. Admin authority comes only from `AdminAccessService`. All per-account entitlement data is `user_id`-scoped (or org-scoped per T-2) and accessed through `lib/repositories/`. Public pages resolve entitlements by the owning account, never from request input. |
| **Observability** | Pino structured logs for every `not_entitled`, `limit_reached`, degrade, read-only block, grace-suppressed marketing send, paused-suppressed message, setup low-balance warning and lookup failure, with account, capability, surface and correlation ID. A platform-team alert on email fair-use breach (B-7). Shadow-mode report of would-be denials per capability and the launch-migration dry run (FR-22). |
| **Auditability** | Admin changes → `AuditTrailService`. Tier-matrix changes → git history (Option D) or an audited table (Option C). The launch migration records, per account, the cohort assigned and when. |
| **Testability** | Invariant tests (FR-8). Resolver unit tests covering every layer (including grandfathering, champion "all at highest", open-ended champions and trial `grant_all`) and lifecycle state, using a **test-fixture tier matrix** since no commercial tiers ship (B-13). Integration tests per enforcement surface type (later delivery): happy path, not entitled, limit reached, read-only, paused (keep-working vs stopped surfaces). An end-to-end journey for trial → grace → paid once billing exists, run per the repo's current E2E position. |
| **Accessibility** | Upgrade, limit and setup-allowance warnings must be readable by screen readers and must not rely on color alone. The detailed UX belongs to a later UI requirement. |
| **Extensibility** | Adding a capability means one catalog entry plus one value per configured tier. Adding a tier means one matrix column. Flex/pay-as-you-go (D-10) must fit as a metered-only plan without resolver changes. A future Business OS + agent-platform bundle (B-8) must fit as config, not a code fork. |

---

## 16. Delivery Slicing

Each slice ships on its own and leaves the product working. **This delivery = Slice 1 (B-13).** The launch migration is built in Slice 1 and executed at the Slice 2 enforcement switch-on (P-2 DECIDED). Slices 2–4 are specified for later deliveries.

| Slice | Content | User-visible effect | Exit criteria |
|---|---|---|---|
| **1. Infrastructure: catalog, config mechanism, resolver, account state, cohorts, overrides, admin ops, shadow report** *(this delivery)* | Catalog (§5), tier matrix mechanism with **no fixed or commercial tiers**, cohorts (trial `grant_all`, champion "all at highest", open-ended expiry supported), policy values (§6.4), resolver (§8), lifecycle state stored per account, admin ops (§12), invariant tests, shadow-mode logging and report, **launch migration built and dry-runnable** (not executed). New signups → `trial` (clock from first onboarding message). | None. Nothing is blocked. | AC-1 to AC-7, AC-26 (dry-run part), AC-36 and AC-37 pass. The shadow report shows, for real accounts, what would be gated. A test-fixture tier matrix in Eyal's shape loads and validates. |
| **2. Enforcement** *(later)* | Commercial tier configuration added, and the trial contents settled with it (P-1), **launch migration executed at switch-on** (every existing account → open-ended champion, P-2), gating on all §10.2 surfaces, the §10.4 conflict fixes (reminder scheduling/sending, branding), grace/paused behavior including the transactional/marketing split and the B-11 paused split, failure policy, grandfathering | Accounts are held to their entitlements. Trial and champion lifecycle is live. | AC-8 to AC-16, AC-26 (executed part), AC-27 to AC-29 and AC-32 to AC-33 pass. Shadow report shows no unexplained denials before the flag flips. |
| **3. Metering** *(later)* | AI action metering (flat count) across all LLM call sites including setup AI, trial-allowance sizing against measured setup, setup low-balance warning, template fallbacks, warnings, admin credit grants, trial-ends-on-allowance, no-rollover reset, email fair-use alerting | Allowances are enforced; degrade behavior is live. | AC-17 to AC-22, AC-30 to AC-31 and AC-34 to AC-35 pass. |
| **4. Billing** *(later)* | Stripe tiers, checkout, webhooks → state, founder coupon, boosts, auto top-up, add-on purchase, renewal-driven end of grandfathering | Customers can pay and self-upgrade. | AC-23 to AC-25 pass. |

**Dependencies:** `PaymentReminderService.sendEmailReminder` is a stub that logs and returns success, so reminders never actually send. Gating reminders (Slice 2) does not fix this, and the stub must be fixed separately before `payments.reminders` means anything commercially. Background crons also depend on `CRON_SECRET` being set in the deployment.

**Note for SA (B-3 revised + P-2, now decided):** every account existing at switch-on, including trials started after Slice 1 shipped, becomes an open-ended champion. The §21.3 "reset `trial_ends_at` for every non-champion account at flag-flip" step therefore applies to no existing account — only accounts created after switch-on are trials. SA to confirm this replacement at workplan review.

---

## 17. Acceptance Criteria

ACs that name Basic / Growth / Pro are verified against a **test-fixture tier matrix** in this delivery, and against the real commercial tier configuration once it is added (B-13). ACs that depend on the final trial contents are marked and re-checked when the tiers are configured (P-1).

**Slice 1 (this delivery)**
- [ ] **AC-1** Every capability in §5.3 exists in the catalog with all §5.2 attributes.
- [ ] **AC-2** In a test-fixture tier matrix, every configured tier has a value for every capability. Removing any single value makes the invariant test fail. The shipped config, which has no tiers, also validates.
- [ ] **AC-3** Every chat action in `lib/business-os/catalog/catalog.ts` maps to one capability. Adding an unmapped action makes the invariant test fail.
- [ ] **AC-4** In a test-fixture tier matrix, changing one capability's value for one fixture tier (e.g. raising `chat.search` for a mid tier) is a **one-entry diff**, and the resolver then reports the new value for an account on that fixture tier. No other file changes, and no tier name appears in application code (FR-3, FR-12). Adding a new fixture tier requires only a new matrix entry.
- [ ] **AC-5** The resolver applies layers in the §8 order. Tests cover each layer overriding the one before it, an override with an expiry, and a `beta` capability entitled only through a cohort or override.
- [ ] **AC-6** An admin can set the champion cohort, set, extend or clear an expiry, assign a (fixture) tier and grant or revoke a capability through the sanctioned path. Each action produces an audit record with before/after values and reason. A non-admin gets 403, including a user whose `profiles.role` says admin.
- [ ] **AC-7** With the shadow flag on, nothing is blocked. The report lists, per account and surface, what would be gated under the current config. With the shipped config (no tiers), a champion shows no would-be denials, and so does a trial with the current all-capabilities contents (to be re-checked if P-1 changes them at tier-configuration time). An account on a fixture tier shows exactly the denials its fixture values imply. The report also includes the launch-migration dry run: which accounts would become open-ended champions at switch-on.

**Slice 2 (later)**
- [ ] **AC-8** An account on a lower tier calling an API for a capability it lacks gets the structured `not_entitled` error naming the capability and the lowest configured tier that includes it.
- [ ] **AC-9** An account asking chat for a non-entitled action (e.g. a search) gets an explanation, and no mutation runs.
- [ ] **AC-10** For an account not entitled to `payments.reminders`, booking invoices schedule no payment reminders. A reminder already scheduled before a downgrade is skipped at send time.
- [ ] **AC-11** The `intake-reminders`, `lead-response`, `daily-briefing` and `insight-*` crons skip non-entitled accounts and log the skip.
- [ ] **AC-12** An account whose `website.branding` is `branded` always shows "Powered by AgentPilot" on its website and booking page, and the owner toggle cannot turn it off. For an `unbranded` account, the toggle works.
- [ ] **AC-13** When a trial reaches its configured length, the account moves to `grace`: owner writes are blocked, reads and export work, and public pages stay live with a warning. Booking confirmations, receipts, intake requests and reminders for existing bookings and invoices still send. Marketing sends, mass email and lead chasing do not. After the configured grace, the account moves to `paused` and behaves as AC-32. No data is deleted.
- [ ] **AC-14** Changing the trial length, trial clock start or trial contents in config changes the trial for new signups, with no code change.
- [ ] **AC-15** A champion with an admin-set expiry gets 30-day grace per cohort config. An **open-ended champion never enters `grace` on its own**, and only does so after an admin sets an end date that then passes.
- [ ] **AC-16** An entitlement lookup failure behaves according to decision T-3 and is logged at `error` level.

**Slice 3 (later)**
- [ ] **AC-17** Business OS AI usage (including cron-driven usage and setup AI) reduces the account's allowance by exactly 1 AI action per customer-visible AI action, whatever its token size. The internal credit/token record is still written.
- [ ] **AC-18** At allowance exhaustion, a lead reply and a payment reminder still go out with template text, while chat and the daily briefing pause with a clear message.
- [ ] **AC-19** A boost balance is used only after the period allowance. A boost older than 12 months is not usable.
- [ ] **AC-20** Warnings fire once at 80% and once at 100% per period.
- [ ] **AC-21** A trial that uses up its trial allowance moves to `grace` before day 14.
- [ ] **AC-22** An admin credit grant to a champion restores AI availability and is audited.

**Slice 4 (later)**
- [ ] **AC-23** Buying a paid tier moves an account from `trial` / `grace` / `paused` to `active` with that tier's entitlements and no data loss.
- [ ] **AC-24** A converting champion's subscription carries the founder coupon, while their tier entitlements are exactly the purchased tier's.
- [ ] **AC-25** A boost purchase adds to the boost balance. Auto top-up never exceeds the customer's monthly cap.

**Decided business rules (2026-09-19)**
- [ ] **AC-26** (B-3 revised + P-2 DECIDED) **Dry run (this delivery):** the launch migration can be run in shadow mode. It lists every Business OS account that would become an open-ended champion and changes no account state. Running it twice gives the same result. **Execution (at enforcement switch-on, Slice 2):** every Business OS account existing at the switch-on date, including accounts that started a trial after Slice 1 shipped, is in the `champion` cohort with **no end date**. No pre-existing account is in `trial`, and none is left without a lifecycle state. An account that signs up after switch-on is in `trial`.
- [ ] **AC-27** (B-5) All insight automated checks are covered by the single `insights.checks` capability. In a fixture matrix where the two higher tiers include it and the lowest does not, higher-tier accounts have every check and the lowest-tier account has none. Adding a new check to the code needs no tier-matrix change.
- [ ] **AC-28** (B-10) Removing a capability from a fixture tier leaves an existing subscriber on that tier entitled to it until their renewal or sunset date, and a new subscriber is not entitled. Adding a capability to a fixture tier entitles every account on that tier right after release.
- [ ] **AC-29** (B-8) A Business OS subscription grants no agent-platform entitlements, and agent-platform credits or plans grant no Business OS entitlements.
- [ ] **AC-30** (B-6) At the period boundary, unused monthly allowance is gone and the allowance resets to the tier value. The boost balance is carried over untouched until each boost's 12-month expiry.
- [ ] **AC-31** (B-7) Crossing the email fair-use ceiling raises a platform-team alert, and the customer's email keeps sending. Email is blocked only after an admin sets an override, and that override is audited.
- [ ] **AC-32** (B-11) For a `paused` account: a client can open an existing invoice payment link and pay it, and receives a payment receipt. A client can cancel or reschedule an existing booking through its manage link. The public website shows the neutral unavailable page. Creating a new booking is refused. No reminder message (payment, intake or booking) is sent, and intake requests are not sent (default policy).
- [ ] **AC-33** (B-11) When a `paused` account reactivates (pays), no reminder or other message suppressed while paused is sent. Only sends that fall due after reactivation go out. Suppressed sends are logged as suppressed.
- [ ] **AC-34** (B-12) A scripted typical full setup on a new trial account (onboarding, first website generation, services/intake generation) is counted against the trial allowance and leaves at least the config-documented headroom. The configured trial allowance and the measured typical-setup consumption are both recorded in config.
- [ ] **AC-35** (B-12) When a trial account requests a setup regeneration that would use up the remaining trial allowance, or push it below the low-balance threshold, a warning showing the remaining AI actions and the trial-ending consequence appears **before** the action runs. Cancelling consumes nothing. Without that warning having been shown, setup can never be the action that ends a trial.
- [ ] **AC-36** (B-14, this delivery) For a champion, the resolver reports every `available` and `beta` catalog capability as entitled at its highest declared variant/quantity, and no `not_built` capability. An admin revoke override on one champion removes that capability for that account only.
- [ ] **AC-37** (B-13 / B-15 / FR-45, this delivery) The shipped config contains no tier assignments and no fixed tier list. Each §6.4 policy value is present in config with its documented default. Specifically: a new trial's clock starts at its first onboarding message; a new trial resolves to all capabilities (the current default, to be settled with the tiers, P-1); a migrated champion has no end date; and the resolver's `paused` view reports intake requests as stopped. Changing any of these defaults is a config-only change.

---

## 18. Out of Scope / Future Roadmap

- **Implementing Eyal's commercial tier assignments**, or any fixed set of tiers (B-13). The Basic / Growth / Pro values in this document are illustrative, and tiers are added later as configuration.
- **Settling the final trial contents** (P-1), including whether `beta` capabilities are included. Deferred to tier-configuration time; the current default is all capabilities.
- **Enforcement, metering and billing** (Slices 2–4) in this delivery. They are specified here for later deliveries. This delivery ships the infrastructure, the shadow report and a dry-runnable (not executed) launch migration.
- Admin UI or customer-facing plan/usage UI, beyond the structured errors, messages and setup-allowance warnings needed for enforcement.
- Live (no-release) editing of the tier matrix, and editing by non-engineers (B-2). To be revisited once the matrix stabilizes. The design keeps the path open (FR-34).
- Flex / pay-as-you-go plan (D-10). The model must accommodate it but it is not built.
- Team invites and seat management. The `team.seats` quantity is modeled but no invite flow is built.
- Multi-location data model. `business.locations` is modeled only.
- SMS delivery itself (only its catalog entries and metering hooks).
- Gating or bundling the general AgentPilot agent platform (V2/V6 agents). It stays separate from Business OS subscriptions (B-8). A bundle may be a later, deliberate offer.
- Per-check tiering of insight checks (B-5).
- Catching up messages suppressed while paused (B-11). This is deliberately never done.
- Fixing the `PaymentReminderService.sendEmailReminder` stub (a dependency, tracked separately).
- Resolving the five ambiguous sheet rows (sent to Eyal, B-1).
- DB schema and code design (Dev workplan).

---

## 19. Open Decisions

### Business (for the user)

| ID | Question | Resolution | Status |
|---|---|---|---|
| B-1 | The five ambiguous sheet rows: "Full payment cycle (1% fee)", "Mobile chat + insights", "Marketing analytics", invoice vs card payment split, "Marketing chat (mass email)" vs "Mass email campaigns". | BA suggestion: keep them as placeholder catalog entries marked (?). Final values come from Eyal. The engine does not depend on the answers, and under B-13 no tier values are implemented in this delivery anyway. | **Open** (waiting on Eyal) |
| B-2 | Does a change to what a tier includes need to go live without a release, and does Eyal edit it himself? | Tier matrix changes go through a **normal release** for now. No live editing, and Eyal does not edit it directly. Revisit once the matrix stabilizes. The design must not rule out moving to live edits later. See FR-4, FR-34, §7. | **DECIDED** 2026-09-19 (decided by user) |
| B-3 | What happens to existing accounts at rollout? | **REVISED 2026-09-19:** **all** existing accounts become champions, not only design partners. No existing account gets a fresh trial. New signups still follow the trial lifecycle. *(Supersedes the earlier B-3: design partners → champion, everyone else → fresh 14-day trial.)* The timing (the enforcement switch-on date) and the champions being **open-ended** are confirmed in **P-2**. See §9, §12, FR-14, AC-26. | **DECIDED** 2026-09-19 (decided by user, revised) |
| B-4 | Is an AI action a flat count or weighted by size? | **Flat count**: 1 per customer-visible AI action, not weighted by tokens. Credits and tokens remain the internal accounting unit. See §2, §11, FR-23, AC-17. | **DECIDED** 2026-09-19 (decided by user) |
| B-5 | Insights automated checks: 34 in code vs 28 in the sheet. Which does each tier get? | All 34 checks are **one capability**, entitled together on Growth and Pro. No per-check tiering. The sheet's "28" is stale. Under B-13, the Growth/Pro assignment is applied when tiers are configured. See §5.3, FR-35, AC-27. | **DECIDED** 2026-09-19 (decided by user) |
| B-6 | Does unused monthly AI allowance roll over? | **No rollover**. The allowance resets each period. Boost balances last 12 months. See §11, FR-36, AC-30. | **DECIDED** 2026-09-19 (decided by user) |
| B-7 | What happens at the email fair-use ceiling? | **Alert the platform team. Do not block the customer.** Blocking only for clear abuse, by admin action. See §11, FR-28, AC-31. | **DECIDED** 2026-09-19 (decided by user) |
| B-8 | Does a Business OS subscription include the general agent platform? | **No.** They stay separate. Bundling may be a later deliberate offer. See §18, FR-37, AC-29. | **DECIDED** 2026-09-19 (decided by user) |
| B-9 | During grace, do client-facing automations keep running? | **Transactional** client messages keep running (booking confirmations, receipts, intake requests, reminders for existing bookings and invoices). **Marketing** sends, mass email and lead chasing stop. See §9, §10.4, FR-20, FR-39, AC-13. | **DECIDED** 2026-09-19 (decided by user) |
| B-10 | When the tier matrix changes, do existing subscribers get the change? | When a tier **loses** a capability, existing subscribers keep it until their renewal or a set sunset date (grandfathered). When a tier **gains** a capability, it applies to everyone on the tier immediately. See §8, FR-38, AC-28. | **DECIDED** 2026-09-19 (decided by user) |
| B-11 | What keeps working for the business's clients once an account is `paused` after grace? (Raised by SA, §21.5 item 1.) | **Keep working:** invoice payment links, payment receipts, booking cancel/reschedule links. **Stop:** new bookings, the public website, reminder messages. Messages suppressed during pause are **not sent retroactively** on reactivation. This replaces the earlier BA assumption that all automatic client messages stop. Intake requests while paused are a policy value (default: stop, §6.4). See §2, §9, §10.3, FR-40, AC-32, AC-33. | **DECIDED** 2026-09-19 (decided by user) |
| B-12 | Does AI used during setup count against the trial AI allowance? (Raised by SA, §21.5 item 2.) | **Yes.** Setup AI (onboarding, first website generation, services/intake generation) counts against the trial allowance. Because of this, the trial allowance must be sized to cover a typical full setup with meaningful headroom for trying the product, and the owner must be warned before setup regenerations use it up. The trial must not end silently on day one. This decision **differs from SA's recommendation** in §21.5 (not counted). See §2, §11, FR-27, FR-41, FR-42, AC-34, AC-35. | **DECIDED** 2026-09-19 (decided by user) |
| B-13 | What does this delivery build? | **Entitlement infrastructure only**: catalog, tier-matrix config mechanism, resolver, account state, cohorts, overrides, admin operations and the shadow report. Eyal's specific tier assignments are **not** implemented, there is no fixed set of tiers, and all sheet-based examples in this document are illustrative only. Commercial tiers will be added later as configuration. See Overview, D-1, D-2, §5.3, §6.2, §6.4, §14 ([now] tags), FR-3, FR-43, §16, §17, §18, AC-37. | **DECIDED** 2026-09-19 (decided by user) |
| B-14 | What do champions get? | **All capabilities**: every catalog capability at its highest variant/quantity, including `beta`. See §2, §6.4, §8, §9, FR-44, AC-36. | **DECIDED** 2026-09-19 (decided by user) |
| B-15 | Should the remaining product-rule questions be hard-coded? Specifically: what "search via chat" means on lower tiers, the champion tier level, when the trial clock starts, and whether intake questionnaires run while paused. | **No. They are configuration values** (policy values, §6.4), not hard-coded decisions. **Defaults for now:** the trial clock starts at the first onboarding message, and intake requests stop while paused. Search-via-chat level per tier is set when tiers are configured. Champion level follows B-14. See §6.4, FR-45, AC-37. | **DECIDED** 2026-09-19 (decided by user) |

### Follow-ups raised by the SA workplan review

| ID | Point | Resolution | Status |
|---|---|---|---|
| **P-1** | What does a new signup's trial contain, now that it is no longer defined as "Growth-level" (B-13)? | **Deferred to tier-configuration time.** Trial contents — including whether `beta` capabilities are included — are configuration to be set when the commercial tiers are configured, not a decision needed for this delivery. **Current default: all capabilities** at highest variant/quantity (`grant_all` in trial cohort config). Changing it later is a config change, not a redesign. | **DEFERRED to tier configuration** (user, 2026-09-19). Not a blocker. Affects D-2, §6.2, §6.4, §8, §9, FR-14, FR-45, §16 (Slice 2), §18, AC-7, AC-14, AC-37 |
| **P-2** | When does the launch migration run, and do migrated champions expire? | **Confirmed by the user ("all existing accounts are champions"):** the migration runs at the **enforcement switch-on date**, covering every account existing at that moment, including trials started in between. Migrated champions are **open-ended** — no end date until an admin sets one. | **DECIDED** 2026-09-19 (decided by user). Affects B-3, D-4, §2, §6.4, §9, §12, FR-14, FR-22, FR-45, §16 (SA note), AC-6, AC-7, AC-15, AC-26 |

### Technical (for SA)

| ID | Question | BA suggested resolution | Status |
|---|---|---|---|
| T-1 | Storage for the catalog and tier matrix (§7). | Option D: typed code catalog + Zod-validated config-file matrix behind a loader seam. Per-account state in the DB. | **Decided by SA** 2026-09-19 (see §21) |
| T-2 | Does a subscription attach to the **user** or the **organization**? All Business OS data is keyed by `user_id`, and `organizations` is "1 org = 1 user". Seats are a future add-on. | Attach to organization (future-proof for seats), and resolve org from user via the existing 1:1 mapping. SA to weigh this against the cost of the `user_id`-keyed data. | **Decided by SA** 2026-09-19 (see §21) |
| T-3 | Fail-open vs fail-closed when entitlement lookup fails (§10.6). | Client-facing fails open to last-known. Owner paid unlocks fail closed. Metered AI degrades. | **Decided by SA** 2026-09-19 (see §21) |
| T-4 | Merge semantics across layers (replace vs additive per shape). | Additive for quantity, metered and boosts. Replace for boolean and variant. Overrides always win within the state cap. | **Decided by SA** 2026-09-19 (see §21) |
| T-5 | Caching and invalidation of effective entitlements on hot paths and crons. | Per-request memoization, plus a short TTL cache invalidated on admin/billing writes. | **Decided by SA** 2026-09-19 (see §21) |
| T-6 | Allowance period boundary: calendar month vs subscription anniversary. Trial allowance handling. | Anniversary for paid accounts. Trial uses a one-off total. | **Decided by SA** 2026-09-19 (see §21) |
| T-7 | Mechanism for admin operations without UI: admin API routes vs scripts. | Admin API routes (reuse `AdminAccessService` + audit), callable from `/test-business-os` or curl. | **Decided by SA** 2026-09-19 (see §21) |
| T-8 | Legacy chat routes (`chat`, `chat-v2`, `chat-command`): gate them or retire them? | Retire if unused. Otherwise gate through the same action→capability mapping. | **Decided by SA** 2026-09-19 (see §21) |
| T-9 | Reconcile with existing credit infrastructure: `CreditService` signup grant, `boost_packs`, `QuotaAllocationService`, `monthly_ai_allowance_usd`, `check-free-tier-expiration`, and the tables planned in `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md`. | Reuse the Pilot Credits ledger and `boost_packs`. Retire the display-only USD allowance and the unscheduled free-tier cron for Business OS accounts. | **Decided by SA** 2026-09-19 (see §21) |
| T-10 | Stripe: fixed price IDs per tier/interval vs the current on-the-fly price creation in `StripeService`. | Fixed price IDs in config for tiers. Keep on-the-fly pricing only where it already exists. | **Decided by SA** 2026-09-19 (see §21) (Slice 4) |
| T-11 | Plan versioning to support grandfathering (B-10). | Tier matrix entries carry a version. The account records the version it subscribed to. | **Decided by SA** 2026-09-19 (see §21) |
| T-12 | How the plugin-level "license/subscription tier" access strategy (provider-abstraction requirement) consumes the resolver without duplicating logic. | The access strategy calls the resolver for the plugin's capability. There is no separate tier logic in the plugin manager. | **Decided by SA** 2026-09-19 (see §21) |

---

## 20. Notes on Integration Points

| System | Impact |
|---|---|
| `lib/business-os/catalog/catalog.ts`, `business-os-plugin-v2.json`, `MutateExecutor.ts`, `ForEachExecutor.ts` | Action→capability mapping (this delivery). Execution-time entitlement check (later). |
| `app/api/business-os/chat-v4/**` | Chat-level refusal and explanation. Metering per turn (later). |
| API route groups in §10.2 | Server-side checks, structured `not_entitled` error (later). Shadow logging (this delivery). |
| Crons in `vercel.json` (§10.2) | Per-account entitlement and lifecycle checks at run time, including the transactional/marketing split during grace and full reminder suppression (no catch-up) while paused (later). |
| `lib/services/BookingLifecycleService.ts`, `lib/services/PaymentReminderService.ts` | Reminder scheduling and send-time gating. Send is currently a stub (dependency). |
| `app/site/[subdomain]/**`, `lib/branding/footerBlockContent.ts`, `app/business-os/website/page.tsx` | Branding variant, grace warnings, paused page. Invoice payment and booking manage links stay working when paused (B-11). |
| Onboarding / website generation / services and intake generation | Trial clock start event (first onboarding message, this delivery). Setup AI metering against the trial allowance, plus the pre-action low-balance warning (later, B-12). |
| `lib/business-os/businessShape.ts`, `app/api/capabilities/route.ts`, `components/business-os/BusinessOSTabs.tsx` | Stays separate. The UI combines relevance with entitlement (§10.5). |
| `capabilities` / `user_capabilities` | Internal plugin enablement. Stays orthogonal to entitlements. |
| `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `lib/services/QuotaAllocationService.ts`, `boost_packs`, `app/api/admin/boost-packs/route.ts`, `token_usage` | Metering foundation (T-9). |
| `app/api/business-os/usage/route.ts` | Becomes the AI-actions allowance view. The display-only USD allowance is retired. |
| `lib/stripe/StripeService.ts` | Tier subscriptions, coupons, boosts (Slice 4). |
| `lib/services/AdminAccessService.ts`, `lib/services/AuditTrailService.ts` | Admin authorization and audit for all admin operations (this delivery). |
| `organizations` / `organization_members` | Subscription attachment level (T-2). |
| `app/api/cron/check-free-tier-expiration/route.ts` | Superseded or reconciled by the lifecycle in §9 (T-9). |
| General agent platform (V2/V6 credits and plans) | Kept separate from Business OS entitlements (B-8). |
| Business OS data purge requirement | Lifecycle transitions never delete data. Purge stays governed by its own requirement. |

### Documentation follow-up for the CLAUDE.md owner

SA found a wording nit in the project context doc, outside this requirement: CLAUDE.md's Key Documentation row for [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) describes the required GitHub status check `Admin authz surface guard` as `(enforce_admins, strict)`, but **the repository's branch-protection setting is not strict** (a required check that is not "strict" does not force a branch to be up to date with `main` before merging). The wording should be corrected by whoever owns CLAUDE.md, and the same phrasing should be checked in `ADMIN_IDENTIFICATION_AND_ACCESS.md`. This requirement itself makes no claim about strictness: any admin-route work under it simply has to keep the guard green (WC-7, AC-6). **BA has not edited CLAUDE.md.**

---

## 21. SA Review

**Reviewed by SA — 2026-09-19**
**Status:** APPROVED WITH CONDITIONS. Dev may write the workplan. The workplan must satisfy every condition in §21.4 (WC-1 to WC-22) and the SA must review it before any code is written.

The requirement is well-structured. Separating catalog from matrix, putting the lifecycle overlay last, keeping business shape out of the resolver, and keeping billing out of the engine are all correct and are approved as written. B-2 to B-10 are treated as fixed inputs and are not reopened here. Most corrections below come from this branch (`feature/business-os-purge-slice-2`) being behind `origin/main` by the Business OS LLM Layer 1 / 1.1 / 1.5 / 3 work. That work changes what metering can build on.

### 21.1 Technical decisions (T-1 to T-12)

| ID | Decision | Rationale |
|---|---|---|
| **T-1** Storage | **Option D, refined.** Catalog and tier matrix (plus cohort config) are **two separate, data-only TypeScript modules** under one new folder (e.g. `lib/business-os/entitlements/`). The matrix is typed with a mapped type over the catalog: a missing capability, an unknown ID or a wrongly-shaped value is a type error. The resolver reads the matrix only through a `TierMatrixSource` loader interface. The shipped implementation (code-backed) **also Zod-validates at load**, so a future DB-backed source (FR-34) goes through the same validation. Per-account state lives in the DB. | B-2 removes "non-engineers edit it" and "no release", which were the only reasons to prefer JSON/YAML. A typed module keeps the change to one line (AC-4) and adds compile-time exhaustiveness on top of FR-8. **Caveat, verified:** `next.config.js` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, so a type error does **not** fail the Vercel build. Compile-time checks only count if they run in CI. So the Zod load validation plus the FR-8 invariant tests are the real gate, and the new folder must be added to a scoped typecheck gate (see WC-2). |
| **T-2** User vs org | **Attach to the Business OS account, keyed by the owner's `user_id`. Do not key by `organizations`.** The resolver API takes an `accountId`. Today that is the owner `user_id`. One function, `resolveAccountId(userId)`, is the only place that maps an acting user to an account (identity today, via `organization_members` when seats ship). Seats are a `quantity` capability on the account. | Every enforcement surface already has the owner `user_id` in hand: session routes, claimed cron rows, public pages (subdomain/token → owner), and the plugin executors. Keying by org would add a join to every hot path. Org rows are also created lazily (`get_or_create_user_organization`, first called from `app/api/business-os/business-profile/route.ts:314`), so an account may have no org row. `organizations` has an owner **UPDATE** RLS policy (its `settings` JSONB is user-writable), and its `organization_members` policy is self-referencing. When seats arrive, **all** Business OS data has to move from user to account tenancy anyway. The subscription moves with it through the single `resolveAccountId` seam, so doing it now buys nothing. |
| **T-3** Failure policy | Failure policy is a property of the **capability's audience/message class in the catalog**, not of each call site. (a) **Client-facing public pages and transactional sends: fail open.** Treat the account as `live` and the capability as entitled, use the in-process cached value if one exists, log at `error`. (b) **Owner-facing paid unlocks: fail closed** with a distinct retryable outcome `entitlement_unavailable` (HTTP 503 shape). This is **never** `not_entitled`, so an outage never shows an upgrade prompt. (c) **Marketing sends in crons: defer.** Skip the account for this run **without** a terminal status, so the next tick retries. (d) **Metered AI pre-check: fail open** (allow, log `error`, record usage when the store recovers). (e) An invalid matrix fails at load/CI, never at request time (already required). | "Last known" in the BA suggestion needs a durable cache. Serverless has none across cold starts, so "last known" can only be best-effort in-process, and the fallback has to be "open". D-14 says AI limits exist for abuse, not margin, so blocking all owner AI on a DB blip costs more than it protects. Paid unlocks fail closed because failing open would give away features, and the feature's own DB reads are usually down in the same outage anyway. |
| **T-4** Merge semantics | **Approved as BA suggested, made explicit:** boolean/variant **replace** (the later layer wins). Quantity/metered: **tier base + add-ons additive**. Cohort **replaces** the base unless the cohort entry is marked `additive`. Overrides carry an explicit `op`: `set` \| `add` \| `revoke`. The **state overlay caps** everything (it can only reduce). `not_built` is never entitled. `beta` is entitled only via cohort/override. **Boosts and admin AI-action grants are not a resolution layer.** They are a balance consumed after the period allowance (§11), stored in a ledger, and never change the resolved entitlement value. The catalog declares an **order for variants** (e.g. `manual < ai`, `branded < unbranded`) and the matrix declares **tier order** (`basic < growth < pro`). | Explicit `op` removes ambiguity about whether an override adds to or replaces a value. Variant and tier ordering are needed by FR-16 ("lowest tier that includes it"), by T-11 (detecting a removal) and by the degrade logic. Keeping balances out of the resolver keeps resolution a pure function of config plus account rows, so it can be cached. Counters are never cached (T-5). |
| **T-5** Caching | **Per-request memoization plus an in-process TTL cache (30 s), keyed by `accountId`, holding the resolved entitlement snapshot only.** One DB round trip on a miss: one repository method backed by a single query or RPC that returns plan row + active overrides + add-ons + active grandfather entries. Local invalidation on admin/billing writes in the same instance. Cross-instance staleness is bounded at **30 s** (meets the ≤60 s NFR). **Metered counters are never cached.** Crons resolve **once per claimed batch** (one `IN (...)` query), not per row. | Vercel runs many instances and the repo has no shared cache (Redis) for entitlements, so cross-instance invalidation isn't available. A bounded TTL is the honest guarantee. The <10 ms p95 NFR can only be met on a cache hit. On a miss, the target is **one** round trip, not <10 ms. Resolve once per chat turn and **pass the snapshot down** to `MutateExecutor` / `ForEachExecutor` rather than re-resolving per action. |
| **T-6** Period boundary | **Anniversary, from a per-account `period_anchor` timestamp.** Before billing, the anchor is set when a tier or cohort is assigned. In Slice 4 it becomes the Stripe billing-cycle anchor. Month arithmetic clamps the day (anchor on the 31st → the 28th/29th/30th in shorter months). Boundaries are computed from the timestamp, so they don't depend on the business's time zone. **Trial:** one period equal to the trial window, holding the one-off trial total. **Champion:** anchored at cohort start. Usage is stored per `(account, period_start)`. A new period starts at zero on its first write (no reset cron, B-6 no-rollover for free). | Anniversary matches what Stripe will do in Slice 4, so there's no mismatch or migration later. Deriving periods from an anchor needs no scheduled reset job. Unscheduled jobs are a known failure mode here (see `check-free-tier-expiration`). |
| **T-7** Admin ops | **Admin API routes** under `app/api/admin/business-os/entitlements/**`, each gated server-side by `AdminAccessService.isAdmin` (pattern: `app/api/admin/business-os/llm-usage/route.ts` on `main`), Zod-validated, audited, and writing through a new repository. They can optionally be surfaced later as an admin-only tab on `/test-business-os`. **No write scripts.** A script that writes with the service role bypasses both authorization and audit. | A script path would need its own authz and audit, so it would be a second pattern. **Do not copy `app/api/admin/boost-packs/route.ts`.** It has **no authentication at all** and creates its own service-role client. This matches the known finding that most `/api/admin/**` routes are unauthenticated (LLM investigation §I.3). |
| **T-8** Legacy chat routes | **Retire `chat` and `chat-command`** (no in-repo caller: verified by grep of `app/`, `components/`, `hooks/`, `lib/`, `scripts/`). Return 410 in Slice 2 and delete afterwards. **`chat-v2` is LIVE:** `components/business-os/ChatCommandPanel.tsx:1247` calls it behind an **ungated** "V2/V4 comparison" toggle (`:1591`) available to every user. It must be **retired (remove the toggle, route → 410)** before the Slice 2 flag flips. If comparison is still wanted, restrict it server-side to `AdminAccessService` admins. It must not be gated through the catalog mapping. | Every user can switch to V2 in one click, so it would bypass V4 gating completely. V2's tool set isn't the BizQL catalog, so mapping it would mean a second action→capability mapping to maintain (FR-9 says one resolver, one mapping). Retiring is cheaper and safer. |
| **T-9** Credit reconciliation | Business OS gets its **own AI-action counter and grant ledger. It does not reuse `user_subscriptions.balance`, `credit_transactions`, `plans` or `boost_packs` rows.** Specifically: **(1)** `CreditService`'s 1,000-credit signup grant stays as-is for the agent platform. Business OS never reads or deducts it (B-8/FR-37). **(2)** `boost_packs` stays agent-platform. Business OS boost definitions (+250 / +750 AI actions) live in entitlement config. Boost purchases and admin grants go into one Business OS grant ledger (`source`, `qty`, `remaining`, `expires_at`, `actor`, `reason`). **(3)** `QuotaAllocationService` is **unrelated**: it allocates agent-platform storage/execution quotas. It needs no change. **(4)** `monthly_ai_allowance_usd` (`ais_system_config`, migration `20260928_ai_credit_allowance.sql`) is **left untouched in Slices 1–2** and retired in Slice 3 when the usage card switches to AI actions. **(5)** `check-free-tier-expiration` is agent-platform only (its `account_frozen` consumers are all agent-platform files). **It must not be scheduled and must not be used for the Business OS lifecycle.** Business OS lifecycle is **derived from stored timestamps at resolution time** (`trial_ends_at`, `grace_ends_at`, `paused_at`), not moved by a cron. Pilot Credits/tokens stay the internal cost record in `token_usage` (already attributed per account by Layer 1 on `main`). | B-8 requires the two products' credits and plans not to grant each other anything. Sharing a balance table would couple them, and `user_subscriptions` / `plans` are named for the agent-platform model. B-4 makes the Business OS unit a flat count, which is a different unit from Pilot Credits. A time-derived lifecycle cannot silently fail to run, whereas an unscheduled cron can. |
| **T-10** Stripe prices | **Fixed prices referenced by Stripe `lookup_key`** in config (e.g. `bos_growth_monthly_v1`), resolved to price IDs at runtime and cached. Existing on-the-fly credit/boost pricing in `StripeService` (`prices.create` at `:149`, `:321`; inline `price_data` at `:248`) stays as-is for the agent platform. Business OS subscription webhooks are **namespaced** (subscription metadata `product: business_os`), and the existing credit webhook must ignore them. | Lookup keys are the same in Stripe test and live mode, so no per-environment ID table is needed. Namespacing stops the existing `app/api/stripe/webhook` credit handler from acting on Business OS events (it already touches `account_frozen` / `user_subscriptions`). |
| **T-11** Plan versioning | **The matrix module carries `version` plus an append-only `removals` ledger**: `{ version, tier, capability, previous_value, grandfather_until: 'renewal' \| <ISO date> }`. Each account stores `plan_version` (set at trial start / tier assignment / subscribe, bumped to current at renewal in Slice 4). The resolver's layer 1a restores `previous_value` for every removal with `version > account.plan_version`, a matching tier, and a sunset/renewal not yet passed. A **snapshot test** (committed snapshot of the previous matrix) fails if any tier value was **lowered** (by the T-4 orders) without a matching `removals` entry and a version bump. **Before Slice 4, a removal must carry an ISO sunset date**: `'renewal'` is rejected at load because there is no renewal event yet. | This keeps "add a capability" a one-line change, as B-10 wants. A removal is two lines (value + ledger entry), which is right because B-10 already requires a per-change business decision (renewal vs sunset date). There are no per-account writes at release time and no need to keep whole old matrices in code. The snapshot test makes an un-grandfathered removal impossible to merge. |
| **T-12** License-tier seam | **Implement the existing stub case, don't add a new mechanism.** `lib/server/access-strategy.ts:77` already has a `license_tier` case that fails closed with `license_tier_not_implemented`. In Slice 2 it becomes: a `db_active` precondition **and** `resolver.isEntitled(accountId, definition.accessStrategy.capability)`, with the capability ID declared in the plugin definition's `accessStrategy`. **Action-level** gating for Business OS stays in the entitlement catalog's action→capability map (FR-6), not in plugin definitions. The Business OS internal plugins keep `db_active` unless a whole plugin becomes a paid unlock. | One resolver, one source of truth (FR-9). The plugin layer asks a yes/no question at plugin granularity only. The existing unit test `lib/server/access-strategy.test.ts:82` ("license_tier seam … denies closed") must be updated in the same change. |

**New patterns approved by this review** (per CLAUDE.md rule 7; nothing else new is approved without a workplan-stage SA check):

1. The entitlements module: data-only catalog + matrix TS modules, the `TierMatrixSource` loader seam, and a single resolver.
2. A route-level entitlement wrapper (e.g. `withEntitlement(capability | 'ungated', handler)`) plus a per-route declaration that the FR-8 test discovers by globbing the §10.2 route groups.
3. An in-process TTL cache for the resolved entitlement snapshot (T-5). This is **not** a general cache utility.
4. A time-derived lifecycle state instead of a state-transition cron (T-9 (5)).
5. The matrix version + `removals` ledger with a snapshot test (T-11).
6. SECURITY DEFINER RPCs for atomic AI-action consumption, **service-role only** (WC-9).

### 21.2 Corrections to BA facts

| # | BA statement | Verified finding |
|---|---|---|
| C-1 | `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` is missing | It exists on **`origin/main`** (added in `6351ebb1`, last touched in `b6f8ff1c`, 2026-09-18). It is missing only because this branch is behind main. `main` also has **`lib/business-os/llm/callCatalog.ts`** (Layer 1: every Business OS LLM call attributed with `feature = business-os-<area>`, `component = call name`, `session_id` = one UUID per action/job), **`lib/ai/usageScope.ts`**, and **`lib/business-os/llm/aiActionAudit.ts` → `runAiAction`** (Layer 3 step 2: one scope per AI action, not yet wired to call sites). **FR-30 must rely on `callCatalog.ts` (`BOS_LLM_CALLS`) as the inventory, not on a count of "18".** On main that is 8 areas / 26 call names, and some of them (plan-cache/verified-question embeddings) are not customer-visible actions. The **metering hook must be `runAiAction`** (one scope = one candidate AI action), so there is not a second instrumentation layer. |
| C-2 | Payment reminder scheduling at `BookingLifecycleService.ts:750` | **Correct on this branch** (`.scheduleInvoiceReminders(...)` at `:750`, fire-and-forget with `.catch`). Line numbers will differ on main, so cite the function, not the line. |
| C-3 | Cron list (§10.2) | **Correct.** All 11 Business OS crons are in `vercel.json`, including `abandoned-proposal-invoices` and `calendar-sync`. Also unscheduled: `check-free-tier-expiration` **and `process-queue`** (agent platform). The non-Business-OS scheduled crons (`run-scheduled-agents`, `update-template-scores`, `memory-consolidation`) are correctly left out. |
| C-4 | Branding: website toggle + hard-coded on booking page | **Incomplete.** It's hard-coded at `app/site/[subdomain]/book/page.tsx:252` (`{labels.poweredBy}`; `:69` is the label table). The website toggle is `show_powered_by` in `components/website/blocks/FooterBlock.tsx` and `components/website/templates/shapes/Footer.tsx`, defaulted `true` in `WebsiteGenerationService.ts:1344`. **Missed surface:** `components/public/PublicFooter.tsx` / `PublicShell.tsx` (`showPoweredBy = true` by default) render the tail on `app/book/manage/[token]/**`, `app/c/[userCode]/book` + `/contact`, and `app/proposal/[token]`. FR-19 must cover every `PublicFooter` consumer, not just the site booking page. |
| C-5 | Public-page surface = `app/site/[subdomain]/**` + invoice links | **Incomplete.** The public surfaces are `app/site/[subdomain]/**`, `app/book/**` (manage/cancel/reschedule/intake), `app/c/[userCode]/**`, `app/invoice/[id]`, `app/proposal/[token]`, `app/go/[code]`, and their APIs `app/api/public/invoice/[id]/pay`, `app/api/book/manage/[token]/**`, `app/api/contact`, `app/api/proposal/[token]`. `app/go/unavailable/page.tsx` already exists as a branded "unavailable" page and is a good model for the `paused` page. |
| C-6 | API surfaces (§10.2) | **Missed:** `app/api/email/sequences/**` and `app/api/email/enrollments/**` (`WebsiteEmailSequenceService`, `EmailAutomationRepository`). These are marketing drip sequences, so they are **marketing class** under B-9. Also `app/api/insights`, `app/api/smart-links/**`, `app/api/onboarding/**` (Business OS onboarding LLM calls). They must be declared gated or explicitly `ungated` under FR-8. |
| C-7 | "License-tier seam … designed-but-not-built" | The seam is **coded as a stub** (`lib/server/access-strategy.ts:77`, fails closed, with a unit test). It is more than documentation. See T-12. |
| C-8 | `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` "was never built" | **Partly built for the agent platform.** `plans` (upserted by `supabase/SQL Scripts/20250127_update_pricing_plans.sql`), `user_subscriptions`, `credit_transactions`, `billing_events` and `boost_packs` exist and are used by `CreditService` / `StripeService`. The reserve/finalize ledger was not built. Business OS must not reuse these (T-9). New tables need a clear Business OS namespace to avoid confusion with `user_subscriptions` and `payment_plan_subscriptions` (client installment plans). |
| C-9 | `QuotaAllocationService` listed as credit/quota infrastructure to reconcile | It allocates **agent-platform storage and execution quotas** from Pilot Credits. It has no bearing on Business OS AI metering. It also logs via `console.*` (not in scope unless touched). |
| C-10 | "1 credit = 10 tokens" | Correct as the **default** (`pricingConfig.ts:58`, `tokens_per_pilot_credit` from `ais_system_config`). It is config, not a constant. |
| C-11 | Other claims | Verified: 107 actions in `business-os-plugin-v2.json`. `PaymentReminderService.sendEmailReminder` is a stub (`:500`–`:517`, logs "Would send payment reminder email"). The `organizations` migration says "1 org = 1 user". There are 34 insight detectors in `lib/business-os/insight/detectors/catalog/` (excluding `BaseDetector`/`index`). `check-free-tier-expiration` is unscheduled and non-compliant (raw `createClient` with the service role, `console.*`). |

### 21.3 Architecture and risk review

| Area | Assessment |
|---|---|
| **Hot path** | Acceptable with T-5: one memoized snapshot per request/turn, 30 s in-process TTL, one round trip on a miss, counters never cached. Metering: a synchronous **read** pre-check, then an **atomic increment after** the action, non-blocking. A small concurrency overshoot past the allowance is accepted (D-14). Do **not** put the resolver in `middleware.ts`: it runs on Edge and skips `/api`. Enforce in Node route handlers, server components and services. |
| **Cron enforcement** | Schedule-time **and** send-time checks are both required (FR-18), and send-time is authoritative. **Interaction with the §8.1 claim pattern** (payment-reminders, payment-retry, lead-response, daily-briefing, automation executions all claim rows): a row skipped because of entitlement or lifecycle must get a **terminal status with a reason** (e.g. `suppressed` + `suppressed_reason`). Otherwise it is re-claimed every tick, then reaped and dead-lettered as a failure. The exception is T-3 (c) (lookup failure → defer, no status change). Resolve entitlements once per claimed batch. |
| **Degrade vs block** | Correct per D-12, but degrade only applies where a client-facing send actually uses an LLM. Today that is mainly `LeadReplyRecommender` (leads area). Payment reminders are not AI today (and the sender is a stub). Intake reminders need confirming. The FR-30 inventory will show that most "degrade" rows need no new template. Owner-facing pause needs its own outcome (`limit_reached` + pause), and chat must explain it, not error. |
| **Transactional/marketing classification** | Sound, and correctly declared per catalog capability/send (FR-39). Must be total: every automated client send gets a class, and an unclassified send fails FR-8. Add to the marketing class: email sequences/enrollments (C-6), `lead-response`, mass email, post scheduling. Transactional: booking confirmations/reminders, receipts, intake requests/reminders for existing bookings, payment reminders/retries for existing invoices, `abandoned-proposal-invoices` (acts on existing proposals, so treat as transactional unless the business says otherwise). |
| **Tenant isolation** (tenant-isolation-guard principles) | (1) Entitlement tables: RLS on, owner **SELECT only** (or none), **no** INSERT/UPDATE/DELETE policy for `authenticated`/`anon`. All writes go through repositories on the service role. (2) Any SECURITY DEFINER RPC (consume, batch resolve) must `REVOKE EXECUTE … FROM public, anon, authenticated` and grant to `service_role` only. Otherwise any logged-in user could call it through PostgREST with another account's id. (3) Admin routes act on a caller-supplied **target** account id: admin authz, then a target-exists / is-a-Business-OS-tenant pre-check, then an **explicit field allow-list** per operation (no spreading the request body into an upsert). (4) Public pages resolve the owner from subdomain/token server-side, never from query/body. (5) The account id for metering always comes from the server context (session or claimed row), never from request input. (6) Store nothing in `profiles`, `organizations.settings`, `business_profiles` or `user_subscriptions`. All four have user-writable paths or belong to another product. |
| **Purge / Reset interaction** (not addressed by BA) | Entitlement and lifecycle tables must be classified **person-owned, never purged** in `lib/business-os/purge/descriptors.ts` (the descriptor invariant test will force a classification), and must be keyed to `auth.users(id)`, **not** FK-cascaded from `business_profiles`. Otherwise a Business OS "Reset / start over" would delete the plan row and let the account start a **fresh trial**, which is a trial-reset loophole. |
| **Missing plan row** | Every Business OS tenant needs a plan row, created idempotently where the tenant is provisioned (the `business_profiles` creation path) and backfilled by the launch migration. The resolver treats a missing row as an anomaly: log `error`, apply the T-3 policy for the surface. It must never silently mean "full access forever". Add an ops check that counts tenants with no row (AC-26 already requires none). |
| **Testability** | Good. FR-8 plus AC-2/AC-3 are the right invariants. Also required: (a) a **forbidden-literal test**: no `'basic' \| 'growth' \| 'pro'` tier-name literals outside the entitlements config folder (enforces FR-12); (b) the **T-11 snapshot test**; (c) a **route-declaration test** that globs the §10.2 route groups plus C-5/C-6 and asserts every route declares a capability or `ungated`; (d) a test that the resolver is pure given (config, account rows, now), with an injected clock for lifecycle and expiry. |
| **Slice ordering** | Correct order, independently shippable. **Slice 1 changes no customer behavior only if:** the shadow path is flag-controlled, wrapped so it can never throw into the request, and adds no read when the flag is off. Plan-row creation at signup is non-blocking (failure is logged and backfilled later) and never fails onboarding. The usage card and `monthly_ai_allowance_usd` are untouched. **Launch migration timing:** trials created during Slice 1 would expire in shadow before Slice 2 launches. The B-3 launch migration must therefore reset `trial_ends_at = launch + configured length` for **every** non-champion account, including Slice-1-era signups, at the moment the Slice 2 enforcement flag flips, not at Slice 1 deploy. **Slice 2 prerequisites:** T-8 retirement of `chat` / `chat-command` / `chat-v2` toggle. **Slice 3 prerequisite:** Layer 3's `runAiAction` wired to call sites on `main` (C-1). |

### 21.4 Conditions for the Dev workplan

| # | Condition |
|---|---|
| WC-1 | Branch the workplan from **current `origin/main`**, not this branch. Layer 1/1.1/1.5/3 (callCatalog, usageScope, runAiAction, admin-gated LLM usage routes) are only on main. |
| WC-2 | Implement T-1 as decided. Add the entitlements folder to a scoped CI typecheck gate (extend `typecheck:bos-llm` or add `typecheck:bos-entitlements`), because the Next build ignores TS errors. |
| WC-3 | Key all per-account state by owner `user_id` behind a single `resolveAccountId` seam (T-2). Use new, clearly Business-OS-namespaced tables with FKs to `auth.users(id)`, not `business_profiles`. Register them in `lib/business-os/purge/descriptors.ts` as never-purged. |
| WC-4 | All DB access through new repositories in `lib/repositories/` with `.eq('user_id', …)` on reads. Every `supabaseServer` use is documented in code with why. |
| WC-5 | Zod on every admin route input, on the matrix/cohort config at load, and on every new public/cron entry that takes input. |
| WC-6 | Pino `createLogger` everywhere, with correlation IDs on routes. Every `not_entitled`, `limit_reached`, degrade, read-only block, suppressed send and lookup failure is logged with account, capability, surface and correlationId (NFR Observability). Any touched file still using `console.*` must be flagged and converted per CLAUDE.md. Known touch candidates: `lib/utils/pricingConfig.ts`, `QuotaAllocationService.ts` (only if touched), `check-free-tier-expiration` (only if touched). |
| WC-7 | Admin routes per T-7: `AdminAccessService` gate (a user whose `profiles.role = 'admin'` must get 403, per AC-6), Zod, explicit field allow-list, target pre-check. Audit via `AuditTrailService.log(...).catch(...)` followed by `await auditTrail.flush().catch(...)` before responding: admin ops are rare, and the queued path can lose entries on a frozen serverless function (Layer 3 KI-B). **Every override/grant row also stores `actor_admin_id`, `reason`, `created_at`, `expires_at` itself**, so the durable record does not depend on the audit queue. |
| WC-8 | RLS on every new table: owner SELECT only (or none), no user write policies. Add a test that user-facing profile and business-profile update routes cannot reach any entitlement field. |
| WC-9 | Any SECURITY DEFINER function: `REVOKE EXECUTE … FROM public, anon, authenticated`, grant `service_role` only, and pin `search_path`. |
| WC-10 | The failure policy follows T-3 and is driven by catalog audience/class, with `entitlement_unavailable` distinct from `not_entitled`. |
| WC-11 | Caching follows T-5. Document the 30 s staleness bound in the module header and in the admin route responses ("takes effect within 30 s"). |
| WC-12 | Lifecycle is derived from timestamps at resolution time (T-9 (5)). No new state-transition cron. Do not schedule `check-free-tier-expiration`. |
| WC-13 | Cron changes follow the `durable-queue-drain` skill / §8.1. Suppressed rows get a terminal status with a reason. Lookup-failure rows are deferred. Entitlements are resolved once per claimed batch. Each cron is declared gated (with capability and message class) or explicitly `ungated`. |
| WC-14 | Payment reminders: check at schedule time in `BookingLifecycleService` (and any other `scheduleInvoiceReminders` caller) **and** at send time in `PaymentReminderService`. Send time is authoritative. |
| WC-15 | Branding (FR-19) covers `FooterBlock`, template `Footer`, the site booking page and every `PublicFooter` / `PublicShell` consumer (C-4). The owner toggle is disabled in the UI **and** overridden server-side at render for `branded` accounts. |
| WC-16 | The public/paused surface list is C-5. The `paused` page reuses the `app/go/unavailable` / `PublicErrorScreen` pattern. |
| WC-17 | T-8: retire `chat` and `chat-command` (410), and remove the `chat-v2` toggle and route (or make it admin-only server-side) before the Slice 2 flag flips. |
| WC-18 | Metering (Slice 3) hooks into `runAiAction` (C-1). The FR-30 inventory is built from `BOS_LLM_CALLS` and marks, per call name: counts-as-AI-action (yes/no), audience, message class, template fallback. Embedding calls do not count. Consume boosts and grants soonest-expiring first, in one atomic RPC. |
| WC-19 | T-11 versioning + `removals` ledger + snapshot test. `'renewal'` is rejected until Slice 4 ships. |
| WC-20 | T-12: implement the existing `license_tier` case via the resolver and update `access-strategy.test.ts`. No tier logic in the plugin manager. |
| WC-21 | Slice 1 exit criteria must add: flag off means no extra DB reads; the shadow path cannot throw; signup/onboarding cannot fail because of plan-row creation. The Slice 2 launch migration resets trial windows for all non-champion accounts at flag-flip time (§21.3 Slice ordering). |
| WC-22 | Tests: FR-8 invariants, the forbidden tier-literal test, the route-declaration test, the T-11 snapshot test, resolver unit tests with an injected clock for every layer and lifecycle state, and integration tests per surface type (happy path, not entitled, limit reached, read-only, lookup failure). Per CLAUDE.md, new admin routes need happy path + auth failure (including the `profiles.role` admin impersonation case) + invalid input. |

### 21.5 Items for the user (business input)

These are the only points that need the user. Everything else in §21 is decided.

1. **When an account is fully paused after grace (BA assumption, §9 footnote), should the business's clients still be able to pay invoices they already received, and cancel or reschedule bookings they already made?** Technically, pausing everything also turns off the pay-invoice link and the manage-booking links. That means the business stops collecting money it is owed, and clients can't cancel appointments. The alternative is to keep those links (and receipts for payments that still come in) working in `paused`, and stop only new bookings, the website and reminder messages. Messages suppressed during the pause will **not** be sent later if the account reactivates, because stale reminders would be confusing. Both options are cheap to build. This is a customer-experience call.
2. **Should the AI work done while a new customer sets up (building their first website and profile during signup) count against their trial AI allowance?** If it counts, a customer who regenerates their site a few times could use up the trial allowance, and so end the trial (D-2), on day one. SA recommends that onboarding and setup AI is **not counted** against the trial. The user should confirm.

(B-1, the five ambiguous rows, is still with Eyal and does not block the workplan. Those rows ship as catalog placeholders.)

### Approval

[x] Requirement approved with conditions. Dev may write the workplan against WC-1 to WC-22. SA reviews the workplan before implementation.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Initial draft (BA) | Catalog, tier matrix config shape, storage options evaluation (recommend hybrid, SA decides), resolution order, lifecycle, enforcement surfaces, metering, admin ops, 4-slice delivery, 33 FRs, 25 ACs, 10 business + 12 technical open decisions. Supersedes `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` for Business OS; fulfills the license-tier seam from the provider-abstraction requirement. |
| 2026-09-19 | Business decisions B-2 to B-10 recorded as DECIDED (decided by user) | B-2 release-only matrix changes with a loader seam kept; B-3 launch migration (design partners → champion, others → fresh 14-day trial); B-4 flat-count AI actions; B-5 insights checks as one Growth/Pro capability; B-6 no rollover; B-7 fair-use alerts only; B-8 Business OS separate from the agent platform; B-9 transactional vs marketing sends in grace; B-10 grandfather removals, apply additions immediately. Updated §2, §5, §6.3, §7, §8 (new layer 1a), §9, §10, §11, §12, §13, FR-4/8/14/18/20/23/28/30, AC-13/17, slicing, NFRs, out of scope. Added FR-34 to FR-39 and AC-26 to AC-31. B-1 and T-1 to T-12 still open. |
| 2026-09-19 | SA review: APPROVED WITH CONDITIONS | Added §21 SA Review. Decided T-1 to T-12 (typed data-only catalog + matrix behind a loader seam; account keyed by owner `user_id` behind a `resolveAccountId` seam; audience-driven failure policy; explicit merge ops; 30 s in-process TTL cache; anniversary periods from an anchor; admin API routes via `AdminAccessService`; retire legacy chat routes including the ungated `chat-v2` toggle; separate Business OS AI-action ledger, time-derived lifecycle; Stripe lookup keys; matrix version + removals ledger; implement the existing `license_tier` stub via the resolver). Corrections C-1 to C-11 (investigation doc and Layer 1/3 metering foundations are on `origin/main`; branding and public-surface lists incomplete; email-sequence APIs missed; license-tier stub exists; pricing-plan tables partly built for the agent platform). Risks: claim-pattern suppression, SECURITY DEFINER exposure, purge/Reset trial loophole, Slice-1 trial windows. Conditions WC-1 to WC-22. Two user items: what stays live when paused; whether onboarding AI counts against the trial allowance. Marked T-1 to T-12 decided in §19. |
| 2026-09-19 | Business decisions B-11 and B-12 recorded as DECIDED (decided by user), answering SA §21.5 | B-11: in `paused`, invoice payment links, payment receipts and booking cancel/reschedule links keep working. New bookings, the public website and reminder messages stop. Suppressed messages are never sent retroactively on reactivation. This replaces the BA "all messages stop" assumption (§9 footnote removed). B-12: setup AI counts against the trial allowance (differs from SA's recommendation), so the trial allowance must be sized for a typical setup with headroom, and the owner is warned before a setup regeneration would use it up. Updated status line, §2 (Paused, Setup AI), §3, §4, §6.2 note, §9, §10.2–10.4, §11, §12, FR-20/27/30, AC-13/17, NFRs, slicing, out of scope, §20. Added FR-40 to FR-42 and AC-32 to AC-35. §21 and T-1 to T-12 unchanged. |
| 2026-09-19 | Business decisions B-13, B-14, B-15 recorded and B-3 revised (all DECIDED by user) | B-13: this delivery is entitlement infrastructure only (catalog, tier-matrix mechanism, resolver, account state, cohorts, overrides, admin ops, shadow report). Eyal's tier assignments are not implemented, and every Basic/Growth/Pro value is now illustrative. Enforcement, metering and billing remain specified for later deliveries. B-3 revised: **all** existing accounts become champions (no fresh trials). New signups follow the trial lifecycle. B-14: champions receive every capability at its highest variant/quantity, including beta. B-15: search-via-chat level on lower tiers, champion level, trial clock start and intake while paused are configuration policy values. Defaults: trial clock starts at the first onboarding message, and intake requests stop while paused. Updated status, Overview (scope note), §2, §3 notes, §4, §5.1–5.3, §6.2–6.3, new §6.4 policy values, §8, §9, §10/§11 scope notes, §12, FR-3/5/7/8/11/14/16/19/35/38/39/40 plus [now] tags, NFRs, §16, §17 (fixture-tier note, AC-2/4/6/8/10/12/14/23/24/26/27/32), §18, §20. Added FR-43 to FR-45 and AC-36 to AC-37. §21 and T-1 to T-12 unchanged. |
| 2026-09-19 | SA workplan-review follow-ups applied; P-1 and P-2 raised | FR-3: no fixed set of tiers; tiers exist only as configuration added later, with no tier names in code. D-2: the trial is no longer defined as "Growth-level"; its contents are trial cohort config, default all capabilities (P-1). B-3 / FR-14: the launch migration is built and dry-runnable now, and executed at the **enforcement switch-on date**, making every account existing at that moment an **open-ended** champion (P-2). Updated AC-4 (tier-agnostic fixture diff), AC-7 (shadow report incl. migration dry run), AC-26 (dry run now, execution at switch-on), plus AC-14/15/27/28/37, §2, §3, §4, §6.2, §6.4, §8, §9, §12, FR-5/11/22/43/45, NFRs, §16, §18, and added the P-1/P-2 table to §19. §21 and T-1 to T-12 unchanged. |
| 2026-09-21 | P-2 decided, P-1 deferred, doc nit noted | **P-2 DECIDED by user** ("all existing accounts are champions"): at the enforcement switch-on date, every pre-existing account becomes an **open-ended champion** with no end date until an admin sets one. All "pending user confirmation" wording for P-2 removed from the status line, Overview, §2, §3 (D-4), §6.4, §9, §12, FR-14/FR-22/FR-45, §16 note, AC-6/7/15/26. **P-1 DEFERRED by user** to tier-configuration time: trial contents (including whether `beta` is included) are configuration set with the commercial tiers, not a blocker for this delivery; the current default of all capabilities is recorded in D-2, §6.2, §6.4, FR-14, FR-45, AC-7/14/37, §16 (Slice 2) and §18. **Doc nit (SA):** CLAUDE.md describes the required `Admin authz surface guard` check as `strict`, but the repository setting is not strict — noted for the CLAUDE.md owner at the end of §20; BA has not edited CLAUDE.md. Also softened the one "Playwright" mention in the NFR testability row, since E2E is not set up in this repo. §21 and T-1 to T-12 unchanged. |
