# Business OS credit pricing: the credit value and plan allowances

> **Last Updated**: 2026-10-25

## Overview

This document is the **single source** for what a Business OS credit is worth, how many credits each plan includes, **why** those numbers were chosen, and **what data they were based on**. Its purpose, in the user's words: *"so when we change it we come back and remind ourselves the considerations and the data that we have; with more data we revisit the calculations."*

The mechanism (how a charge is recorded, the ledger, the balance) is specified in the [credit deduction requirement](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) and described as built in [BUSINESS_OS_ENTITLEMENTS.md § Metering](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md#metering-the-credit-ledger). This document holds only the **numbers**, the **decisions** behind them, the **benchmark** they were checked against, and the **procedure for revisiting them**. When the numbers change, the change is recorded in the [Revision log](#7-revision-log) here first, and the config follows.

---

## Table of Contents

1. [What a credit is](#1-what-a-credit-is)
2. [The decisions (2026-09-30)](#2-the-decisions-2026-09-30)
   - [2a. The decisions (2026-10-25): the re-size](#2a-the-decisions-2026-10-25-the-re-size)
3. [The allowance rule and the resulting allowances](#3-the-allowance-rule-and-the-resulting-allowances)
4. [Benchmark (2026-09-30)](#4-benchmark-2026-09-30)
   - [4a. Benchmark (2026-10-25)](#4a-benchmark-2026-10-25)
5. [Considerations and trade-offs](#5-considerations-and-trade-offs)
6. [When and how to revisit](#6-when-and-how-to-revisit) (6.4 is the [D6 re-size runbook](#64-the-d6-re-size-runbook-existing-accounts))
7. [Revision log](#7-revision-log)
8. [Open items](#8-open-items)
9. [Change History](#change-history)

---

## 1. What a credit is

| Rule | Detail | Source |
|---|---|---|
| **1 credit = $0.001 of measured provider cost** | A credit is defined against **our cost**, not against a retail price. Credits charged for an action = the action's measured provider cost ÷ $0.001 | Requirement §2, **BD-1 option B** |
| **Charged after it ran, at its own measured cost** | Nothing is predicted, quoted or looked up in a price list. A model change, a prompt change or a provider price change is absorbed automatically | BD-1, FR-1, FR-2 |
| **One credit pool for every service** | AI today; later non-AI chargeable services (for example a notification email or an SMS) draw from the **same** balance, at the **same** credit value. There is one allowance per account per period, never one per service | **BD-12**, FR-40 |
| **Credit value is versioned configuration** | It lives in `lib/business-os/entitlements/config/creditValue.ts` (+ `creditValue.history.json`), append-only. A change affects **only future charges**; every charge row records the `credit_value_version` it was priced at, so no recorded charge is ever re-priced | **FR-3**, SQ-7, SA-S6 |
| **Stored as fractions, shown rounded** | Ledger credits are stored at 6 decimal places and cost at 10, so a cheap action is a small non-zero fraction; the owner-facing display rule is slice 6 / slice 7 | FR-6, SQ-8 |

**Where the markup lives.** The credit itself carries **no markup**: a charge is always measured cost ÷ $0.001. This keeps the ledger an honest record of cost, so the commercial numbers can be revisited without touching the credit value or any recorded charge. Since 2026-10-25 the two commercial numbers are separate:

- **Plan allowances** are sized on **measured usage** (D4, §2a): about 3× a modelled heavy month. They are no longer derived from the fee, so a plan fee is not a purchase of credits at a markup.
- **The markup** applies only to what a **boost** dollar buys (`creditRetail.ts`). It was 100% (D1, retail version 1, 500 credits per $1) and is **400%** since D5 (retail version 2, **200 credits per $1**).

*(Until 2026-10-25 the margin was expressed entirely in how many credits a plan's fee included, under D1 and D2. That rule is kept below as history.)*

**Current configuration state.**

| Item | Before slice 5 | Slice 5 (2026-09-30; capability `credits.allowance`, tier matrix version 2) | **Re-size (2026-10-25; tier matrix version 3, retail version 2)** |
|---|---|---|---|
| Credit value | Version **0**, $0.001, `status: 'provisional'`, decided 2026-09-28, `matrixVersion: 1` | Version **1** appended, $0.001, `status: 'derived'`, decided 2026-09-30, with the derivation in this document. Version 0 stays unchanged (append-only) | **Unchanged: version 1**, $0.001. No entry appended; the ledger is unchanged |
| Essentials (`basic`) allowance | `ai.actions` 500 / month (placeholder — a count of actions) | 19,750 credits / month | **2,000 credits / month** (D4) |
| Autopilot (`pro`) allowance | `ai.actions` 2,000 / month (placeholder) | 32,250 credits / month | **5,000 credits / month** (D4) |
| Founding Partner (`champion` cohort) | Reads the `pro` row (structural parity) | Inherits 32,250 automatically | Inherits **5,000** automatically (still reads `pro`) |
| Test Flight (`trial` cohort) | One-off total 250 (placeholder) | 2,000 credits in total (one-off, BD-16 — the user's decision, see [Revision log](#7-revision-log)) | **1,000 credits in total** (one-off, D4; the floor the trial invariant allows) |
| Boost markup and base rate | — | Retail version **1**: 100% markup (D1), **500 credits per $1** (credits boost slice 1, 2026-10-04) | Retail version **2**: **400% markup** (D5), **200 credits per $1**. Version 1 stays unchanged (append-only) |
| Boost packages | — | Version 1 of each: Starter $10 → 5,000; Plus $25 → 13,750; Max $50 → 28,750 credits | Version **2** of each, same prices and bonuses: **Starter $10 → 2,000; Plus $25 → 5,500; Max $50 → 11,500 credits** (D5). Credits already bought are untouched |

The capability was renamed from `ai.actions` to **`credits.allowance`** (unit `credit`) in slice 5, as SA ruled under requirement SQ-17; the tier matrix moved to **version 2** (SQ-19), and to **version 3** with the re-size (a lowering, so it carries `removals` entries with no real grandfathering, D6; see §6.3). Since slice 6b, owners (Settings → Plan) and invitees (the public invite page) see the allowance with its number under a first "Credits" heading, with the sentence explaining what a credit is; the numbers are read from config only.

---

## 2. The decisions (2026-09-30)

Decided by the user on 2026-09-30. They resolve requirement **BD-8** ("how much AI cost are we willing to carry per plan per month?").

> **Superseded in part on 2026-10-25 (§2a).** **D2 and D3 are superseded by D4**: allowances are now sized on measured usage, not on the fee. **D1** stays as history: it is the markup of retail version 1 (the 500 credits per $1 boost rate) and the basis of the 2026-09-30 allowances; new boost sales use **D5** (400%, retail version 2). The rows below are kept unchanged as the record of what was decided then.

| # | Decision | What it means |
|---|---|---|
| **D1** | **100% markup** | The owner pays **2×** our AI cost. Every $1 of provider cost corresponds to $2 of the plan fee |
| **D2** | **Plan AI allowance = 50% of the SaaS fee, expressed as credit value** | Half of each plan's monthly fee is "spent" on the credit allowance at retail value. At 2× markup, the **AI cost ceiling is 25% of the fee** — the most provider cost one account can generate inside its allowance |
| **D3** | **Option A chosen over a tight limit** | The allowance is a **margin-protecting ceiling**, not a limit owners are expected to hit. The practical abuse guards are **per-action caps**: images are already capped daily per business (`GeneratedImageService.ts`), the chat daily budget exists (`ChatBudget.ts`), and a further chat / image cap is to be considered in **slice 12** (guards before switch-on) |

**The alternative that was not chosen (option B in the 2026-09-30 discussion — not to be confused with BD-1's option B).** The benchmark showed the allowance could be one to two orders of magnitude smaller and still leave more than 3× headroom over measured use. A tight allowance would make credits a real constraint (and a boost-purchase driver) rather than a comfortable promise. The user chose the generous ceiling: owners should not meet the limit in normal work, and the margin is protected by the ceiling itself.

### 2a. The decisions (2026-10-25): the re-size

Decided by the user on 2026-10-25, on the 2026-10-25 benchmark (§4a). Recorded as decided; not to be reopened without new data (§6.1).

| # | Decision | What it means |
|---|---|---|
| **D4** | **Plan allowances re-sized on measured usage, not on the fee** | Replaces D2's "allowance = 50% of the fee" (and D3's generous ceiling). **New rule: allowance ≈ 3× a modelled heavy month for the plan.** D1 (100% markup) stays as history; the ledger is unchanged — 1 credit = $0.001 of cost, credit value version 1 untouched. The resulting allowances are in the table below and in §3 |
| **D5** | **Boosts: keep the prices, fewer credits** | The boost markup changes from 100% to **400%** (the customer pays 5× our cost), i.e. **200 credits per $1** (was 500). Prices unchanged ($10 / $25 / $50), bonus % unchanged (0 / 10 / 15): **Starter $10 → 2,000 credits** (one Essentials month); **Plus $25 → 5,000 + 10% = 5,500** (one Autopilot month plus the bonus); **Max $50 → 10,000 + 15% = 11,500** (~2.3 Autopilot months). Gross margin on cost **80%** before Stripe fees. No Stripe change is needed: `lib/business-os/boost/boostCheckoutSession.ts` builds `price_data` per purchase from `priceMinor`. The purchase cap ($150 per 30 days) is unchanged. **Credits already bought keep what they bought** (lots are untouched) |
| **D6** | **Existing accounts: a relative top-up, expiring** | No grandfathering through the matrix: there are no paying customers, and every account is a test / demo account (one trial, the rest Founding Partners, one Founding Partner also on an Autopilot tier). After deploy, each account with usage gets **one** admin credit grant (the existing `grant_credits` op, `lib/business-os/credits/creditAdminOps.ts`, which takes `expiresAt`) of **`used × (1 − new / old)`** credits, **expiring at the end of its current period** (a trial: at its trial end), so the total credits left are the same percentage as before the switch: left_new = (1 − used / old) × new. Afterwards everyone is on the new number. Grants are audited with a reason like "Credits re-size 2026-10-25: relative top-up (D6)". The plan ring shows the plan percentage (extra credits never count, BD-25) and the grant shows as extra credits — **accepted**. The grants are executed by an admin after the code is live, not by code in this change. Runbook: §6.4 |

**D4: the plans.**

| Plan | Old | New | Heavy month model | Max AI cost |
|---|---|---|---|---|
| Test Flight (`trial` cohort) | 2,000 total | **1,000 total** | setup ~150 (onboarding + website ~50, 2 images ~100) + 14 days of use ~25 | $1 |
| Essentials (`basic`) | 19,750 / mo | **2,000 / mo** | ~600: 10 images × ~54, website edits, automatic work ~15 | $2 (2.5% of $79) |
| Autopilot (`pro`) | 32,250 / mo | **5,000 / mo** | ~1,850: the above + 20 chat turns / day × 30 × 2.1 | $5 (3.9% of $129) |
| Founding Partner (`champion`) | 32,250 | **5,000** (automatic — reads `pro`) | | |

**D5: why fewer credits rather than lower prices.** At 500 per $1 the smallest boost was 2.5 Essentials months, and a top-up undercut the plan's own credits. Lowering the prices instead ($4 / $10 / $20) would let Stripe's fixed $0.30 fee eat ~8% of the smallest sale.

---

## 3. The allowance rule and the resulting allowances

**The rule (D4, since 2026-10-25).** Allowance ≈ **3× a modelled heavy month** for the plan, built from the measured unit costs of §4a. It is a real limit a heavy owner can meet, not a ceiling nobody reaches; a boost is the way past it.

| Plan | Internal id | Fee / month | Heavy month model (credits) | **Allowance** | Allowance ÷ heavy month | Max AI cost inside the allowance |
|---|---|---|---|---|---|---|
| Test Flight | `trial` cohort | $0 | ~175 (setup ~150 + 14 days of use ~25) | **1,000 in total** (one-off) | ~5.7× (1,000 is the floor the trial invariant allows) | $1 |
| Essentials | `basic` | $79 | ~600 | **2,000 / month** | ~3.3× | $2 (2.5% of the fee) |
| Autopilot | `pro` | $129 | ~1,850 | **5,000 / month** | ~2.7× | $5 (3.9% of the fee) |
| Founding Partner | `champion` cohort | $0 | as Autopilot | **5,000 / month** (reads the `pro` row) | as Autopilot | $5 |

**Against recurring use.** The 2026-10-25 benchmark measured recurring use at a mean of ~39 credits per account per 30 days (§4a). The new allowances are ~51× (Essentials) and ~128× (Autopilot) that; the old ones were ~500× and ~800×.

### 3.1 History: the formula (2026-09-30 to 2026-10-25, D1–D2)

*Superseded by D4 on 2026-10-25. Kept as the record of how the slice 5 allowances were derived.*

**Formula.**

```text
allowance credits = (fee × AI share ÷ (1 + markup)) ÷ credit value

where  AI share     = 0.50   (D2)
       markup       = 1.00   (D1, i.e. 100%)
       credit value = $0.001 (BD-1; version 1)
```

Equivalently: **credit value of the allowance (retail) = fee × 50%**, and **cost ceiling = fee × 25%**.

**Resulting allowances (2026-09-30, superseded).**

| Plan | Internal id | Fee / month | Allowance at retail (50% of fee) | AI cost ceiling (25% of fee) | **Allowance, credits / month** | Placeholder it replaces |
|---|---|---|---|---|---|---|
| Essentials | `basic` | $79 | $39.50 | $19.75 | **19,750** | 500 (`ai.actions`, a count of actions) |
| Autopilot | `pro` | $129 | $64.50 | $32.25 | **32,250** | 2,000 |
| Founding Partner | `champion` cohort | $0 | — | $32.25 (inherited) | **32,250** (reads the `pro` row) | 2,000 (inherited) |
| Test Flight | `trial` cohort | $0 | — | ≤ $2 (one-off) | **2,000 in total** — not derived; the formula gives 0 for a $0 plan, so it was sized on setup (BD-16, §7) | 250 one-off |

**Arithmetic check.** Essentials: 79 × 0.5 = 39.50; ÷ 2 = 19.75; ÷ 0.001 = 19,750. Autopilot: 129 × 0.5 = 64.50; ÷ 2 = 32.25; ÷ 0.001 = 32,250.

**N-8 check (SA).** SA asked that a typical chat turn be at least one whole credit. On the benchmark a chat turn costs about $0.002, i.e. **about 2 credits** at $0.001, so keeping $0.001 satisfies N-8. (SA's N-8 estimate of ~0.6 credit per turn was based on the ChatBudget per-call figure, p50 $0.000594; a turn makes several calls. This reconciliation is an inference, not separately verified.) *(2026-10-25: re-measured from the ledger at **2.09 credits** on average over 54 turns, p50 2.08 (§4a); N-8 still met, and the credit value is unchanged.)*

---

## 4. Benchmark (2026-09-30)

A read-only production analysis (SELECTs only, no writes, no RPCs), run on 2026-09-30 around 05:45 UTC, to check the proposal before it was decided. Only account-level aggregates are recorded here.

### 4.1 The accounts

| | Benchmark account A | Benchmark account B |
|---|---|---|
| Plan | No tier; **champion cohort** (Founding Partner, reads Autopilot) | Same |
| Nature | Test / demo account (see caveats) | Test / demo account |
| Business OS history | ~15.5 days | ~9.8 days |
| Measurement window (from first `ai_action` audit entry to run time) | **10.74 days** | **9.84 days** |

There is **less than one billing cycle** of history, so every figure below is **normalised to 30 days** (×2.8–3.0).

### 4.2 How actions were counted

| Class | Source | Rule |
|---|---|---|
| **AI action** | `audit_trail` rows with `entity_type = 'ai_action'` | One row per action (`runAiAction`), with `details.actionType`, `trigger` and `estimatedCostUsd` |
| **Owner deterministic** | `audit_trail` non-AI rows | **Excluded:** `BUSINESS_CHAT_QUERY` (the same event as a `chat_turn` AI action — would double-count), `USER_LOGOUT` (not business work), `INVOICE_PAID` (Stripe-driven, counted as external). Split into **setup** (service / availability / branding / publish / Stripe connect / intake publish / plugin connect) and **operations** |
| **External (client-initiated)** | `scheduling_bookings` with `booking_source = 'website'`; `INVOICE_PAID` audit entries; `business_events` `enquiry.received` / `form.submitted` | Manual bookings are **not** counted here, because they are already in the audit as `SCHEDULING_BOOKING_CREATED` |
| **Automatic deterministic** | `email_sends` (status sent); `payment_reminders` (sent); `daily_briefing_sends` (sent); `payment_events` `invoice.created` (invoices auto-created from bookings) | **Double-count handling:** `lead_responses` sent matched `email_sends` 12 of 12, so they were **not** added again; reminder and briefing sends matched 0 in `email_sends`, so they are separate sends and **were** counted |
| **Not counted** | `crm_activities`, `business_events` (other than enquiries), `payment_events` (other than `invoice.created`), `website_page_views`, `insights`, `daily_briefings`, `business_os_entitlement_shadow_events` | These mirror the events above or are outputs of AI actions. Page views are visitor traffic. Shadow events are daily aggregates of gate decisions, not actions |

The deterministic count is a **modelling choice**. Counting `crm_activities` timeline entries instead would give a different total, but those duplicate emails, bookings and payments.

### 4.3 Actions per 30 days

| Per 30 days | Account A | Account B | Mean per account |
|---|---|---|---|
| AI actions | 101 | 131 (122 recurring) | **116** |
| Deterministic actions | 148 | 726 | **437** |
| Total actions | 249 | 857 | 553 |
| Actions per day | 8.3 | 28.6 | 18.4 |
| AI share of all actions | 40% | 15% | **~21%** (pooled) |
| AI share, one-time setup excluded | 49% | 18% | **~25%** (pooled) |

In the raw window: A had 36 AI actions (none setup) and 53 deterministic; B had 43 AI actions (3 onboarding setup) and 238 deterministic.

### 4.4 Trigger split (raw window)

| | AI: owner | AI: scheduled | AI: external | Deterministic: owner / external / automatic |
|---|---|---|---|---|
| Account A | 16 ($0.0174) | 19 ($0.0052) | 1 ($0.00008) | 21 / 5 / 27 |
| Account B | 36 ($0.0415, of which $0.0255 onboarding) | 7 ($0.0023) | 0 | 116 / 19 / 103 |

Automatic work is a real share of both AI and deterministic activity. This matters because automatic work draws from the same pool (§5).

### 4.5 Cost per action type

Measured `estimatedCostUsd` from the audit entries; credits at $0.001.

| Action type | Trigger | Typical cost | ≈ Credits | Note |
|---|---|---|---|---|
| Chat turn (`chat_turn`) | owner | **~$0.002** (means $0.00171–$0.00226; medians ~$0.002) | ~2 | 14 turns measured |
| Briefing narration (`briefing_narration`) | scheduled and owner refresh | **~$0.0002** ($0.00018–$0.00023 mean) | ~0.2 | 46 measured; 7 failures on account A, charged what they spent |
| Insight run (`insight_run`) | scheduled | **$0.0003–$0.0006** | 0.3–0.6 | 11 measured |
| Website field rewrite (`website_field_regenerate`) | owner | **~$0.000016** | ~0.016 | 4 measured |
| Lead reply (`lead_reply_recommendation`) | external | **~$0.00008** | ~0.08 | 1 measured |
| Onboarding turn (`onboarding_turn`) | owner, setup | **$0.0044** | ~4.4 | 2 measured |
| Onboarding build (`onboarding_build`) | owner, setup | **$0.0168** | ~17 | 1 measured (website + intake generation) |
| Image generation (`gpt-image-1`, historical) | owner, setup | **$0.25** | **250** | 1 measured, before audit coverage began (from `token_usage`) |

**Images dominate.** One image costs as much as ~125 chat turns or ~1,000 briefings.

> **Model change (2026-10-14).** The measured $0.25 is a `gpt-image-1` image. OpenAI retires `gpt-image-1` on 23 Oct 2026, so the default image model is now `gpt-image-2.5-flare`, with the request quality pinned to `high`. Its estimated price at `high` is **$0.043** (1536x1024 / 1024x1536) to **$0.054** (1024x1024) per image: calculator estimates, not a measurement (the source and rounding rule are in `IMAGE_FALLBACK_PRICING`, `lib/repositories/SystemConfigRepository.ts`). The figures in this section stay as measured until an image on the new model is measured. *(2026-10-25: the first two images on `gpt-image-2.5-flare` were measured from the ledger at **43 and 54 credits** — see §4a. That measurement supersedes this estimate.)*

### 4.6 Cost per account and use of the allowance

| Per account | Figure |
|---|---|
| Regular (recurring) AI cost per 30 days | **~$0.06** (A $0.063, B $0.056) → **~60 credits** |
| Setup month, worst case (account A: one image $0.25 + website $0.013 + onboarding $0.009, plus recurring) | **up to ~347 credits** |
| Setup month, account B (onboarding + recurring) | ~134 credits |
| Measured AI cost as a share of the $79 fee | **~0.08%** |

| Plan | Allowance | Recurring use (60 credits) | Headroom | Setup month worst case (~347 credits) |
|---|---|---|---|---|
| Essentials | 19,750 | **0.30%** | **~330×** | 1.8% |
| Autopilot | 32,250 | **0.19%** | **~540×** | 1.1% |

**What the Essentials ceiling buys** ($19.75 of cost, at the measured unit costs):

- about **9,950 chat turns** (~330 a day), or
- about **100,000 briefing narrations**, or
- about **54,000 insight runs**, or
- **79 generated images** at $0.25 — the only unit cost that comes close to the ceiling.

**Cross-check.** `token_usage` (feature `business-os%`) for the same window gave $0.0233 (A) and $0.0464 (B), against audit figures of $0.0227 and $0.0438 — within about 6%.

**The live ledger at run time.** `business_os_credit_charges` (live since 2026-09-29 ~15:40 UTC) held 1 charge for A (0.415 credits, an insight run) and 4 for B (1.080 credits: 3 briefings, 1 insight run); `business_os_credit_totals` matched the charges.

### 4.7 Caveats

1. **These are test / demo accounts, not organic customers.** Each sent email to only two distinct recipients (the owner and one other address), and the data volumes look like exercised flows. Both are on the champion cohort, not a paid tier.
2. **Owner-triggered activity is inflated by testing.** Most of account B's briefings were owner refreshes, and a large share of its AI actions fell on 2026-09-29, the day charging went live. This pushes AI **counts** up; the **cost** is negligible either way.
3. **Short history.** About 10 days in the window, extrapolated ×2.8–3.0 to 30 days. Setup was a large share of the deterministic count (half of account B's owner actions).
4. **Cost is estimated, not invoiced.** `estimatedCostUsd` comes from our provider price table, cross-checked against `token_usage.cost_usd`; it is **not** the provider's invoice.
5. **AI before 2026-09-19 exists only in `token_usage`.** Account A's early AI spend (the image, website, onboarding and 15 briefing calls, ~$0.288) predates audit coverage and is reported only in the "including setup" figures.
6. **The chat golden set belongs to another account.** All 2,830 `business-os-chat` token rows with a NULL session id between 2026-09-22 and 2026-09-29 (~$1.30) belong to one other account, not to either benchmark account.
7. **One audit entry was missing while its charge exists.** An insight-run charge on account B (2026-09-30 03:31 UTC) had no matching `ai_action` audit row, although a run a few seconds earlier on account A did. This is consistent with the audit trail being lossy by design (requirement §3 (a), KI-10): **the charge is the reliable record**, and any re-run of this benchmark should count from the ledger where it can.

### 4a. Benchmark (2026-10-25)

A read-only production analysis (aggregates only; no account ids or emails recorded here) run on 2026-10-25, counted **from the credit ledger** as caveat 7 above recommends. It is the data behind D4–D6 (§2a).

**The window and the accounts.**

| Fact | Figure |
|---|---|
| Ledger live since | 2026-09-29 ~15:40 UTC — about **25 days** at run time |
| Accounts with a plan row | **10**, of which **8** have charges |
| Nature | All test / demo accounts; **0 paying customers** |
| Excluded | One 20,000-credit `test_take_credits` charge (the admin test tool, not usage) |

**Recurring use per account, scaled to 30 days** (accounts with at least 3 weeks of history): **66, 57, 56, 31, 13, 11** → mean ≈ **39**, median ≈ **44** credits. Of that, automatic work (scheduled briefings and insights) is ≈ **15 credits a month**.

**One-time setup:** onboarding plus website ≈ **40–60 credits**, plus any images.

**Unit costs measured (credits, from the ledger).**

| Action | Credits | Count measured |
|---|---|---|
| Chat turn | **2.09** average, 2.08 p50 | 54 |
| Image, `gpt-image-1` (retired) | 250 | 5 |
| Image, `gpt-image-2.5-flare` | **43** and **54** | 2 — the first measured on the new model; supersedes the estimate in §4.5's note |
| Onboarding turn | 4.6 | 144 |
| Onboarding build | 13.0 | 10 |
| Website landing page | ~10.3 | 3 |
| Website, full site | 15.1 | 1 |
| Intake form generation | ~5.1 | 2 |
| Insight run | 0.41 | 95 |
| Briefing narration | 0.14–0.15 | 307 |
| Lead reply | 0.095 | 3 |
| Website field rewrite | 0.018 | 14 |

**Against the old allowances.** The 2026-09-30 allowances were ~**500×** (Essentials, 19,750) and ~**800×** (Autopilot, 32,250) the average recurring use.

**Shadow-mode events.** About 100 gate decisions, almost all `chat.*`, nearly all `allowed`. They show **which capabilities are reached**, not spend.

**Caveats.** Test accounts only; about 25 days; 5 of the 7 images were on the retired model. **Provisional — revisit after the first month of paying customers** (the §6.1 triggers stand).

---

## 5. Considerations and trade-offs

| Consideration | What was weighed | Where it stands |
|---|---|---|
| **Generous ceiling vs a real limit** | A ceiling at 25% of the fee is ~330–540× what the benchmark accounts use. It protects margin (no account can cost more than a quarter of its fee in AI inside its allowance) but it is not a constraint owners will feel, and it will not drive boost purchases. A tight limit would do both, at the cost of owners meeting it | ~~D3: generous ceiling chosen.~~ **2026-10-25: decided the other way (D4).** The allowance is now a real limit, ≈ 3× a modelled heavy month (§3), with a cost exposure of $1 / $2 / $5 instead of up to $32.25. A heavy owner can meet it, and a boost is the way past it. Revisit with real customer data (§6) |
| **Automatic work shares the pool** | Nightly insights, briefings and lead replies are charged to the owner (BD-2) from the same allowance. At a generous ceiling this is invisible; at a tight one, automatic work could consume an owner's credits on days they did nothing | Acceptable at the chosen ceiling. The trigger split (§4.4) is the figure to watch if the ceiling tightens. **2026-10-25 (the ceiling did tighten, D4):** automatic work measured ≈ 15 credits a month (§4a), **under 1% of Essentials' 2,000** (0.3% of Autopilot's 5,000). Still acceptable; an owner who did nothing loses a negligible share |
| **Future non-AI services share the pool** | BD-12: notification emails, SMS and other chargeable services will draw from the same credits. D2's "50% of the fee" was sized on AI cost alone | **May need revisiting** when the first non-AI service is priced: either the 50% covers all services, or the share is raised, or that service's cost is folded in differently. Record the choice in the revision log. **2026-10-25:** D2 no longer sets the allowances (D4). When a non-AI service is priced, add its expected use to each plan's heavy month model (§3) and re-apply the 3× rule |
| **Images dominate cost** | One image ≈ 250 credits; 79 images exhaust Essentials. Chat, briefings and insights never come close | The per-business **daily image cap** is the practical guard today. A chat / image cap is to be considered in **slice 12**. If image use grows, image pricing is the first thing to review. **2026-10-25:** on `gpt-image-2.5-flare` an image measured 43–54 credits (§4a), so images still dominate the heavy month model (10 images ≈ 540 of Essentials' ~600) but no longer dwarf an allowance: about 37 images exhaust Essentials' 2,000, about 92 Autopilot's 5,000 |
| **Founding Partners carry Autopilot's ceiling at $0** | Champions read the `pro` row, so each may generate up to $32.25 of AI cost a month with no fee against it | Accepted by structural parity (entitlements doc, 2026-09-27). The ceiling is exposure, not expected cost (~$0.06 measured). **2026-10-25:** with D4 the exposure is **$5** a month per Founding Partner (5,000 credits, still read from `pro`) |
| **Fractional credits for cheap actions** | A briefing is ~0.2 credit, a lead reply ~0.08, a website field rewrite ~0.016. Whole-credit display would show many actions as "0" | Stored as fractions (FR-6). ✅ **The card (slice 6, D-c): whole credits, with "less than 1"** between 0 and 1; "left" = allowance − the displayed used; the "by you" / "automatic" parts are shared out so they add up to the displayed used (`lib/business-os/credits/creditDisplay.ts`). ✅ **The credit history (slice 7a, D-m): one decimal, "less than 0.1" below that, every line shown**; the period total at the same precision from the exact sum, its "by you" / "automatic" parts shared out so they add up to it, and the footnote "Each line is rounded; the total is exact." ✅ **The card as a percentage (slice 8a, BD-20, replaces "left of" on the card):** whole percent left, rounded down; 100% only when nothing was used; "less than 1%" while anything is left below 1%; 0% at or over the allowance — computed in micro-credit integers from the exact used, so an exact 10% is 10. The ring's colour is the band of the shown percentage — green 60–100, blue 30–59, orange 10–29, red below 10 — defined once in `lib/business-os/credits/creditBands.ts`; the admin Businesses list shows the same figure per account. ✅ **The low-line audit record (slice 8b, BD-22):** when a recorded AI charge takes the shown percentage of the **plan** allowance (BD-25 — extra credits never count) from at or above 10 to below it, one admin audit entry `BOS_CREDIT_LOW_LINE_CROSSED` is written (`lib/business-os/credits/creditLowLine.ts`, called from the charge recorder, ≤ 0.5 s read budget, never fails the action). Once per account per period (once per trial) is **derived**, not stored: totals only rise within a period, so one charge straddles the line. Known limits: KI-21 (concurrent charges at the line), KI-22 (an allowance changed mid-period), KI-23 (an audit entry can be lost; the Pino `info` line is written first) — count distinct (account, period). |
| **Credit value kept at $0.001** | A different value only rescales every number; $0.001 makes a chat turn ~2 credits (N-8 met) and keeps allowances readable | Kept; promoted from provisional to derived (version 1) |
| **Markup lives in the allowance, not the credit** | Putting the markup into the credit value would make the ledger overstate cost and tie every recorded charge to a commercial choice | Markup expressed only in allowance size (§1). **2026-10-25:** the credit still carries no markup, but allowances are no longer derived from a markup (D4); the markup now lives only in the boost retail rate (`creditRetail.ts`, 400% since D5) |
| **Boosts are now meaningful** *(added 2026-10-25)* | Under D3 a paid-plan owner never needed a boost, and at 500 per $1 the smallest boost was 2.5 Essentials months and undercut the plan's own credits. With real limits (D4), a boost is the release valve for a heavy month | **D5:** 200 credits per $1, prices kept. Starter = one Essentials month (2,000), Plus = one Autopilot month plus 10% (5,500), Max ≈ 2.3 Autopilot months (11,500). Gross margin on cost 80% before Stripe fees; the $150 / 30-day cap allows three Max packs (34,500 credits) |

---

## 6. When and how to revisit

### 6.1 Triggers

Re-run the calculation when **any** of these happens:

| Trigger | Why |
|---|---|
| **The first paying customers** | The benchmark is two test accounts on the champion cohort |
| **30 or more days of real usage** on real accounts | The benchmark extrapolated ~10 days ×3 |
| **Any account above ~25% of its allowance** in a period | The ceiling is meant never to bind; an account at a quarter of it is a signal that the usage model is wrong or that abuse guards are needed |
| **A model price change** or a change of the default model in an area (Layer 2) | Costs are absorbed automatically per charge, but the benchmark's unit costs and headroom change |
| **Adding a non-AI chargeable service** (BD-12) | The 50% AI share (D2) was sized on AI alone |
| **A margin review** (pricing change, fee change, new tier) | The allowance is a function of the fee |

*(2026-10-25.)* The triggers stand, and D4 is **provisional** until the first month of paying customers. Two of them read differently under D4: an allowance is no longer "a function of the fee" (it is a function of the heavy month model), and an account above ~25% of its allowance is now **expected** for a heavy user (a heavy month is ~30–37% of the paid allowances by design). Read that trigger as "compare the account with the plan's heavy month model": an account well above the model is the signal that the model is wrong or that abuse guards are needed.

### 6.2 Data sources to re-run

| Source | What it gives |
|---|---|
| **Charge checks** page, `/admin/finance/charges` (slice 4a; until Money M-5 the Costs & credits tab of `/admin/business-os-llm`) | Per account and billing period: credits and cost by action type, area, effective service and trigger; **p50 / p90 per action type**; the fallback-priced count. The first place to look |
| **The credit ledger** (`business_os_credit_charges`, `business_os_credit_totals`) | The authoritative record of what was charged, from 2026-09-29 ~15:40 UTC. Prefer it over the audit trail |
| **`audit_trail` `ai_action` entries** | Per-action detail (action type, trigger, `estimatedCostUsd`) back to 2026-09-19. Lossy by design — use for history before the ledger existed, not as the bill |
| **`token_usage`** | Per-call cost, the only record of AI before 2026-09-19, and the cross-check. The leak check (slice 4b) compares it with the ledger |

Use the counting rules in §4.2 for deterministic actions, so figures stay comparable between runs.

### 6.3 Procedure to change the numbers

1. **Record the decision here first** — a row in the [Revision log](#7-revision-log): date, what changed, why, the data used.
2. **Credit value:** **append** a new entry to `CREDIT_VALUE_HISTORY` in `lib/business-os/entitlements/config/creditValue.ts` with the next version number, and extend `creditValue.history.json` in the **same PR**. **Never edit a shipped entry** — that re-prices history (FR-3); the snapshot test catches an accidental edit. The PR and its SA review are the audit record (SQ-7, SA-S6).
3. **Plan allowances:** edit the allowance values in `config/tierMatrix.ts` (the `credits.allowance` capability; it was `ai.actions` before slice 5). **Raising** a value is one line. **Lowering** one is a removal: lower the value, add a `removals` entry, **bump the matrix `version`**, and decide grandfathering — see [BUSINESS_OS_ENTITLEMENTS.md § Removing a capability from a tier](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md#removing-a-capability-from-a-tier). Founding Partners follow the `pro` row automatically; the trial total is set explicitly in `config/cohorts.ts`. **No grandfathering** (as in the 2026-10-25 re-size, D6) is expressed as a `removals` entry whose `grandfatherUntil` is an instant **at or before the release**: the resolver's grandfather layer (Layer 1a) keeps `previousValue` only while `now < grandfatherUntil`, so a past instant means the old value never applies after deploy. Matrix version 3 uses `2026-10-25T00:00:00.000Z`, the decision date. Existing accounts are then moved by admin grants instead (§6.4).
4. Run `npm run entitlements:snapshot` and read the diff, then `npm run test:bos-entitlements`, and follow the `business-os-entitlements` skill.
5. Update the plan table in [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) and this document's §1 / §3 in the same change.
6. **Never rewrite history**: no charge row is edited, and no earlier revision-log row is changed — a correction is a new row.

**The markup and the boost base rate (credits boost slice 1).** The markup (D1) also lives in code, in `lib/business-os/entitlements/config/creditRetail.ts`: an append-only history like the credit value's, each entry naming the credit value version it was decided against (version 1: 100% on credit value v1). The boost base rate is **computed** from the two, credits per dollar = 1 / (credit value × (1 + markup)), which is **200 since retail version 2** (D5, 400%; it was 500 under version 1) (`retailRate.ts`); no file types it. To change the markup, **append** an entry and extend `creditRetail.history.json` in the same PR, then re-point and re-version every boost package in `config/boostPackages.ts` (and append them to `boostPackages.snapshot.json`): until that is done the boost catalogue is invalid and the checkout refuses. In the same PR, add each new `(package, version)` and its fingerprint to `RELEASED` in `__tests__/boostCatalogue.guard.test.ts` (released lines are never edited), and update that suite's "the banned list is real" expectation to the newly derived figures, so the no-typed-figures guard keeps scanning for the current ones. Appending a credit value without a matching markup entry fails a CI test for the same reason. Boost packages store only a price and a bonus %; their credits are derived ([credits boost requirement](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) §8, FR-42).

### 6.4 The D6 re-size runbook (existing accounts)

Run **once, by an admin, after the matrix version 3 code is live in production** — never before, and never by code. It gives every account with usage this period one expiring grant, so its total credits left are the same percentage as before the switch (D6).

**The rule.** For each account: `grant = used × (1 − new / old)`, **rounded up to 2 decimals**; skip it when the result is below 0.01 (nothing used). Then `left_new = new − used + grant = (1 − used / old) × new`.

| Term | Monthly plans (Essentials, Autopilot, Founding Partner) | Test Flight (trial) |
|---|---|---|
| **used** | `credits_total` of the account's **current period** in `business_os_credit_totals` (period key = `business_os_credit_period_start(period_anchor, now())`, the recorder's own rule) | **All** charges since the trial started: every `business_os_credit_totals` row from `period_anchor` on (the card's trial window) |
| **old → new** | Essentials 19,750 → 2,000; Autopilot and Founding Partner 32,250 → 5,000 | 2,000 → 1,000 |
| **Expiry** (`expiresAt`) | The end of the current period (the next period start) | The trial end (`trial_ends_at`, else trial start + 14 days) |

**Worked example.** A Founding Partner who used 300 of 32,250 (99.07% left): grant = 300 × (1 − 5,000 / 32,250) = 253.49. After the switch: 5,000 − 300 + 253.49 = 4,953.49 = 99.07% of 5,000.

**Step 1 — compute (read-only).** Paste in the Supabase SQL editor of the target project. It writes nothing. Kept deliberately plain for that editor (no comments, no punctuation inside quoted strings).

**File:** none (run by hand)

```sql
WITH plan_rows AS (
  SELECT
    p.user_id,
    CASE
      WHEN p.tier IS NOT NULL AND (p.tier_expires_at IS NULL OR p.tier_expires_at > now()) THEN p.tier
      WHEN p.cohort IS NOT NULL AND (p.cohort_expires_at IS NULL OR p.cohort_expires_at > now()) THEN p.cohort
      ELSE NULL
    END AS plan_basis,
    p.tier,
    p.tier_expires_at,
    p.cohort,
    p.cohort_expires_at,
    p.period_anchor,
    public.business_os_credit_period_start(p.period_anchor, now()) AS period_start,
    COALESCE(p.trial_ends_at, COALESCE(p.trial_started_at, p.onboarding_started_at) + interval '14 days') AS trial_end
  FROM public.business_os_account_plans p
),
sized AS (
  SELECT
    r.user_id,
    r.plan_basis,
    r.tier,
    r.tier_expires_at,
    r.cohort,
    r.cohort_expires_at,
    r.period_anchor,
    r.period_start,
    CASE r.plan_basis WHEN 'basic' THEN 19750 WHEN 'pro' THEN 32250 WHEN 'champion' THEN 32250 WHEN 'trial' THEN 2000 END AS old_allowance,
    CASE r.plan_basis WHEN 'basic' THEN 2000 WHEN 'pro' THEN 5000 WHEN 'champion' THEN 5000 WHEN 'trial' THEN 1000 END AS new_allowance,
    CASE
      WHEN r.plan_basis = 'trial' THEN r.trial_end
      ELSE (
        (r.period_anchor AT TIME ZONE 'UTC')
        + make_interval(months => (
            (extract(year FROM (r.period_start AT TIME ZONE 'UTC'))::integer - extract(year FROM (r.period_anchor AT TIME ZONE 'UTC'))::integer) * 12
            + (extract(month FROM (r.period_start AT TIME ZONE 'UTC'))::integer - extract(month FROM (r.period_anchor AT TIME ZONE 'UTC'))::integer)
            + 1
          ))
      ) AT TIME ZONE 'UTC'
    END AS grant_expires_at
  FROM plan_rows r
),
used AS (
  SELECT
    s.user_id,
    COALESCE(SUM(t.credits_total), 0) AS used_credits
  FROM sized s
  LEFT JOIN public.business_os_credit_totals t
    ON t.user_id = s.user_id
   AND (
        (s.plan_basis = 'trial' AND t.period_start >= s.period_anchor)
     OR (s.plan_basis <> 'trial' AND t.period_start = s.period_start)
   )
  GROUP BY s.user_id
),
grants AS (
  SELECT
    s.user_id,
    s.plan_basis,
    s.tier,
    s.tier_expires_at,
    s.cohort,
    s.cohort_expires_at,
    s.old_allowance,
    s.new_allowance,
    u.used_credits,
    round(100 * (1 - u.used_credits / s.old_allowance), 2) AS percent_left_before,
    ceil(u.used_credits * (1 - s.new_allowance::numeric / s.old_allowance) * 100) / 100 AS grant_exact,
    s.grant_expires_at
  FROM sized s
  JOIN used u ON u.user_id = s.user_id
  WHERE s.old_allowance IS NOT NULL
)
SELECT
  g.user_id,
  g.plan_basis,
  g.tier,
  g.tier_expires_at,
  g.cohort,
  g.cohort_expires_at,
  g.old_allowance,
  g.new_allowance,
  g.used_credits,
  g.percent_left_before,
  g.grant_exact,
  ceil(g.grant_exact) AS grant_whole_credits,
  g.grant_expires_at
FROM grants g
WHERE g.grant_exact >= 0.01
  AND g.grant_expires_at > now()
ORDER BY g.grant_exact DESC;
```

Read the result before granting anything:

- **`plan_basis` must match the admin Businesses list before any grant.** The query takes a tier while `tier_expires_at` is empty or in the future, else a cohort while `cohort_expires_at` is empty or in the future, else nothing (the row is left out). It is a simplification of the resolver: **a tier whose `tier_expires_at` has just passed is still on the tier** while it is in the renewal settlement margin (1 day) or the subscription grace, so for such a row the query wrongly falls back to the cohort. Check `tier` and `tier_expires_at` in the output: if the Businesses list still shows the tier, use **that tier's** old and new allowance (Essentials 19,750 → 2,000; Autopilot 32,250 → 5,000) and recompute the grant by hand with the rule above. Any other disagreement with the list: stop and ask before granting.
- **`grant_whole_credits`.** The `grant_credits` op takes **whole credits** (`creditAdminOps.ts`: a positive integer, at most 100,000). Grant this figure: `grant_exact` rounded up to the next whole credit, so an account ends a fraction of a credit above the D6 percentage, never below.
- **Run it close to the deploy.** Each credit used between the deploy and the grant adds up to about 0.9 of a credit to the grant; at measured use (a few credits a day) that is negligible.
- **Expired windows drop out by themselves.** The query leaves out any account whose `grant_expires_at` is already past (a trial that has ended): the op refuses an expiry in the past, and there is no period left to top up.
- **`grant_expires_at` is a UTC instant** (the SQL editor shows it with `+00`). Step 2 says how to enter it.
- If the editor refuses `business_os_credit_period_start` (EXECUTE is granted to `service_role`), run the query as the project's `postgres` role, which the SQL editor uses by default.

**Step 2 — grant.** For each row, an admin opens **/admin/users → the business's drawer → Credits block → Give credits** (the slice 11c form, which sends the `grant_credits` op) or sends the op directly, with:

| Field | Value |
|---|---|
| `amount` | `grant_whole_credits` |
| End date (`expiresAt`) | **In the Give credits form:** choose "End date" and enter `grant_expires_at` **converted to your own local time**. The form's field is a `datetime-local` read "in your local time" (`CreditFormDialog.tsx`), so typing the UTC figure as it stands ends the grant hours away from the period end (for example, in Israel a period ending 2026-11-14 09:31 UTC is entered as 2026-11-14 11:31 in winter time). **Only when sending the `grant_credits` op directly**, send `grant_expires_at` as an ISO instant with its offset (`Z`). Either way, check that the saved lot's expiry equals `grant_expires_at` **to the minute** (the form takes whole minutes; `period_anchor` carries seconds, so a difference of under a minute is expected and harmless) |
| `reason` | `Credits re-size 2026-10-25: relative top-up (D6)` |

Each grant is audited like any admin grant. A held account (payment hold) is refused by the op (fail closed); note it and decide with the user.

**What the owner then sees.** The plan ring shows the **plan** percentage against the new allowance (extra credits never count, BD-25), and the grant appears as **Extra credits** until it expires at the period end; from the next period every account is simply on the new number. Where `used` already exceeds the new allowance (a trial that used more than 1,000), the ring shows 0% and Extra credits shows the whole grant: nothing draws from lots yet (slices 9–10), so the D6 percentage holds as a total, not on either figure alone. The low-credit audit line (slice 8b) may fire on the first charge after the switch for an account already below 10% of the new plan allowance; that is KI-22 (an allowance changed mid-period), accepted.

**Afterwards.** Record in §7 the date the grants were made and how many accounts received one (aggregates only).

---

## 7. Revision log

| Date | What changed | Why | Data used |
|---|---|---|---|
| 2026-09-28 | Credit value **version 0**: $0.001 per credit, `provisional` | Working figure from BD-1 so slice 3 could record charges before any measurement existed | None — a round working figure |
| 2026-09-30 | **Decisions D1–D3** (user): 100% markup; allowance = 50% of fee at retail value (cost ceiling 25% of fee); generous ceiling over a tight limit. Resulting allowances: **Essentials 19,750**, **Autopilot 32,250** credits / month (Founding Partner inherits Autopilot), replacing the placeholders 500 / 2,000. Credit value **kept at $0.001**, to be appended as **version 1, `derived`**. **To ship in slice 5** (not yet in code on this date) | Resolves BD-8. The benchmark showed measured use at 0.2–0.3% of these ceilings, so the ceiling protects margin without constraining owners | Benchmark 2026-09-30 (§4): two test accounts, ~10 days each scaled to 30; audit `ai_action` entries, `token_usage`, the credit ledger |
| 2026-09-30 | **Shipped in slice 5.** Capability `ai.actions` renamed to **`credits.allowance`**, unit `credit` (SA SQ-17); **tier matrix version 2** (SQ-19); credit value **version 1** appended (`derived`, $0.001, `matrixVersion: 2`); Essentials 19,750, Autopilot 32,250, Founding Partner reads Autopilot | Carries out D1–D3 in config. A rename and two raises; nothing lowered, so no `removals` entry | As the row above |
| 2026-09-30 | **Trial (Test Flight) one-off total: 2,000 credits** (user, BD-16). Not monthly; running out ends the trial | Sized on setup, not on a fee (the formula gives 0 for a $0 plan): about 6× the worst measured setup month (~347 credits, one image included), so a genuine trial does not end on day one (B-12), with a cost exposure of at most ~$2 per trial. The alternative, a 14-day share of Essentials (~9,200, ≤ ~$9.20), was not chosen | Benchmark 2026-09-30 (§4.5, §4.6): setup month worst case ~347 credits; one image ~250 credits |
| 2026-10-25 | **Decisions D4–D6** (user): **D4** allowances re-sized on measured usage (≈ 3× a modelled heavy month), replacing D2 and D3: **Test Flight 1,000 in total** (was 2,000), **Essentials 2,000 / month** (was 19,750), **Autopilot 5,000 / month** (was 32,250), Founding Partner 5,000 (reads `pro`). **D5** boost markup 100% → **400%**, i.e. **200 credits per $1** (was 500); prices and bonuses unchanged, so Starter $10 → 2,000, Plus $25 → 5,500, Max $50 → 11,500 credits; credits already bought untouched. **D6** no grandfathering; each existing account with usage gets one expiring admin grant of `used × (1 − new / old)` after deploy (§6.4). Credit value **unchanged** (version 1, $0.001) | Old allowances were ~500× / ~800× measured recurring use, so they protected nothing commercially and gave boosts no purpose; at 500 per $1 the smallest boost was 2.5 Essentials months and undercut the plan's own credits; lower prices instead would let Stripe's fixed $0.30 fee eat ~8% of the smallest sale. No paying customers, so no grandfathering is owed | Benchmark 2026-10-25 (§4a): ~25 days of ledger, 10 accounts with plan rows (8 with charges), all test / demo; recurring use mean ≈ 39 / median ≈ 44 credits per 30 days; unit costs from the ledger. Provisional |
| 2026-10-25 | **Recorded in code** (branch `feature/business-os-credits-resize`, not yet merged on this date): **tier matrix version 3** with `basic` 2,000 and `pro` 5,000 and two `removals` entries (version 3, previous values 19,750 and 32,250, `grandfatherUntil` `2026-10-25T00:00:00.000Z`, so the old values never apply after deploy); `TRIAL_CREDIT_TOTAL` 1,000; **credit retail version 2** appended (markup 4, credit value version 1); boost packages re-versioned to **version 2** (retail version 2) and appended to `boostPackages.snapshot.json`. Credit value history unchanged | Carries out D4–D5 in config. A lowering, so it is a removal with a version bump (§6.3 step 3) | As the row above |

---

## 8. Open items

| Item | Status |
|---|---|
| **Trial (Test Flight) one-off total.** D1–D3 derive allowances from a fee; the trial is $0, so the formula gives 0. The trial total must be sized on setup instead (B-12: setup AI counts against it, and using it up ends the trial) | ✅ Decided by the user on 2026-09-30 — **2,000 credits** in total (BD-16; revision log §7). A permanent guard (`trialAllowance.invariant.test.ts`) keeps it a whole one-off total of at least 1,000. *(2026-10-25: re-sized to **1,000** by D4, the guard's floor.)* |
| **Capability id and unit** | ✅ SA ruled (SQ-17): renamed to **`credits.allowance`**, unit `credit`; shipped in slice 5 |
| **Whether slice 5 bumps the tier-matrix `version`** | ✅ SA ruled (SQ-19): yes, **version 2**, no removal; credit value version 1 carries `matrixVersion: 2` |
| **Showing the number to owners and invitees** | ✅ Slice 6b: "Credits (32,250 per month)" etc. under a first "Credits" heading with the explanation sentence (D-g, D-h), in en / he / es; the R-7 option C rule is removed. Figures come only from config (guard test) |
| **The 50% share once a non-AI service is priced** (BD-12) | Revisit when the first non-AI service is designed (§5, §6.1). *(2026-10-25: D2's 50% no longer sets the allowances; the question becomes adding the service to each plan's heavy month model, §5.)* |
| **A chat / image per-action cap** as the practical abuse guard (D3) | To be considered in slice 12. *(2026-10-25: with real limits (D4) the allowance itself now bounds cost at $1 / $2 / $5; the per-action caps remain the guard against a burst.)* |
| **D6 grants for existing accounts** *(added 2026-10-25)* | ⬜ An admin runs the §6.4 runbook **after** the matrix version 3 code is live, and records the date and the count of accounts granted in §7 |
| **D4 is provisional** *(added 2026-10-25)* | ⬜ Re-run the benchmark after the **first month of paying customers** (§6.1), with more than two images measured on `gpt-image-2.5-flare` |
| **Orphan system-config key `monthly_ai_allowance_usd`** | ⬜ Since slice 6a it has **no reader**: the owner card reads the plan's `credits.allowance` from the entitlements resolver, and the dollar allowance and its conversion by `pilot_credit_cost_usd` left the owner surface (FR-36). Left in place — removing a config row is a migration for no owner benefit. Remove in a later clean-up if ever wanted (slice 6 Q-12) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-30 | Created | Credit deduction slice 5. What a credit is (BD-1, BD-12, FR-3); the user's decisions D1–D3 resolving BD-8 (100% markup, allowance = 50% of fee at retail, cost ceiling 25% of fee, generous ceiling over a tight limit); the formula and resulting allowances (Essentials 19,750, Autopilot 32,250 credits / month; Founding Partner inherits Autopilot; trial open as BD-16); the 2026-09-30 benchmark (two test accounts on the champion cohort, counting rules, actions per 30 days, trigger split, cost per action type, usage vs allowance, caveats); considerations and trade-offs; revisit triggers, data sources and change procedure; revision log; open items (BD-16, SQ-17, SQ-19) |
| 2026-09-30 | Slice 5 shipped; BD-16 decided | P-1: §4.7 caveat 2 no longer hints at who account B belongs to. P-2: §1 and §6.3 name `credits.allowance` (renamed from `ai.actions`, SQ-17) and matrix version 2 (SQ-19). §1 and §3 gain the trial's **2,000** one-off total; §7 gains two rows (slice 5 shipped; BD-16 decided); §8 closes BD-16, SQ-17 and SQ-19 and records the temporary "Credits (included)" display until slice 6 |
| 2026-09-30 | Slice 6a: the card rounds; an orphan key | §5 "Fractional credits" row decided for the card (D-c: whole credits, "less than 1", parts that add up). §8 gains the orphan `monthly_ai_allowance_usd` key (no reader since slice 6a, Q-12). The "Showing the number" row is unchanged until 6b removes R-7 |
| 2026-10-02 | Slice 6b: the number is shown | §1 note and §8 "Showing the number" row: owners and invitees now see the allowance with its number under a "Credits" heading, with the explanation sentence, localised; R-7 option C removed |
| 2026-10-02 | Slice 7a: the history rounds | §5 "Fractional credits" row decided for the credit history (D-m: one decimal, "less than 0.1", every line shown, the total from the exact sum with the footnote) |
| 2026-10-03 | Slice 8a: the card shows a percentage | §5 "Fractional credits" row: the card's headline is the percentage left (BD-20 rounding) with colour bands from `creditBands.ts` (BD-19); the admin Businesses list shows the same figure. The credit history's precision is unchanged |
| 2026-10-04 | Slice 8b: the low-line audit record | §5 "Fractional credits" row: one admin audit entry when a recorded charge takes the shown plan percentage below 10 (BD-22, BD-25), derived once per period; KI-21 to KI-23 |
| 2026-10-04 | Credits boost slice 1: the markup in code | One paragraph at the end of §6.3: the markup's home `creditRetail.ts` (append-only, version 1 = D1), the computed boost base rate, and the procedure for a markup change (re-version the boost packages). No figure changed |
| 2026-10-14 | Image model change noted | §4.5: the measured $0.25 image row is labelled historical (`gpt-image-1`), and a note gives the new default `gpt-image-2.5-flare` at quality `high` with its estimated $0.043–$0.054 per image. No measured figure changed |
| 2026-10-16 | Money M-5: where the cost report lives | §4.6 table: the operator cost report is the Charge checks page (`/admin/finance/charges`), moved from the Business OS AI "Costs & credits" tab. No figure changed |
| 2026-10-25 | Credits re-size: decisions D4–D6 | New §2a (D4 allowances on measured usage, ≈ 3× a heavy month; D5 boosts at 400% markup, 200 credits per $1, prices kept; D6 relative expiring top-up, no grandfathering); §2 marks D2 / D3 superseded by D4 and D1 as history. §1 configuration table gains the re-size column (Test Flight 1,000, Essentials 2,000, Autopilot and Founding Partner 5,000; retail version 2; packages version 2 at 2,000 / 5,500 / 11,500). §3 is now the usage rule and its allowances, the old formula kept as §3.1 history. New §4a, the 2026-10-25 ledger benchmark (aggregates only). §4.5 note: first measured images on the new model. §5 rows updated (ceiling decided the other way; automatic work under 1% of 2,000; images; Founding Partner exposure $5; markup now only in the boost rate) and a new "Boosts are now meaningful" row. §6.1 note on reading the triggers under D4; §6.3 notes on expressing no grandfathering and on the boost guard's `RELEASED` and banned-figure list; new §6.4 D6 runbook with the read-only SQL. §7 two rows; §8 two new items |
| 2026-10-25 | Credits re-size: SA review fixes to the §6.4 runbook | The form's end date is entered in the admin's local time (the ISO `Z` instant only when sending the op directly). `plan_basis` honours `cohort_expires_at` and the query now returns `tier`, `tier_expires_at`, `cohort`, `cohort_expires_at`, with a note that a tier in its settlement margin or grace is still on the tier and that the result must match the admin Businesses list before any grant. Accounts whose window has ended drop out of the query |
