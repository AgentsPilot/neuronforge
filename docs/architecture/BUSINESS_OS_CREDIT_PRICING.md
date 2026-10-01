# Business OS credit pricing: the credit value and plan allowances

> **Last Updated**: 2026-09-30

## Overview

This document is the **single source** for what a Business OS credit is worth, how many credits each plan includes, **why** those numbers were chosen, and **what data they were based on**. Its purpose, in the user's words: *"so when we change it we come back and remind ourselves the considerations and the data that we have; with more data we revisit the calculations."*

The mechanism (how a charge is recorded, the ledger, the balance) is specified in the [credit deduction requirement](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) and described as built in [BUSINESS_OS_ENTITLEMENTS.md § Metering](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md#metering-the-credit-ledger). This document holds only the **numbers**, the **decisions** behind them, the **benchmark** they were checked against, and the **procedure for revisiting them**. When the numbers change, the change is recorded in the [Revision log](#7-revision-log) here first, and the config follows.

---

## Table of Contents

1. [What a credit is](#1-what-a-credit-is)
2. [The decisions (2026-09-30)](#2-the-decisions-2026-09-30)
3. [The formula and the resulting allowances](#3-the-formula-and-the-resulting-allowances)
4. [Benchmark (2026-09-30)](#4-benchmark-2026-09-30)
5. [Considerations and trade-offs](#5-considerations-and-trade-offs)
6. [When and how to revisit](#6-when-and-how-to-revisit)
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

**Where the markup lives.** The credit itself carries **no markup**: a charge is always measured cost ÷ $0.001. The margin is expressed entirely in **how many credits a plan's fee includes** (§3). This keeps the ledger an honest record of cost, and means the markup can be revisited by changing allowances alone, without touching the credit value or any recorded charge.

**Current configuration state.**

| Item | Before slice 5 | After slice 5 ships (capability `credits.allowance`, tier matrix version 2) |
|---|---|---|
| Credit value | Version **0**, $0.001, `status: 'provisional'`, decided 2026-09-28, `matrixVersion: 1` | Version **1** appended, $0.001, `status: 'derived'`, decided 2026-09-30, with the derivation in this document. Version 0 stays unchanged (append-only) |
| Essentials (`basic`) allowance | `ai.actions` 500 / month (placeholder — a count of actions) | **19,750 credits / month** |
| Autopilot (`pro`) allowance | `ai.actions` 2,000 / month (placeholder) | **32,250 credits / month** |
| Founding Partner (`champion` cohort) | Reads the `pro` row (structural parity) | Inherits **32,250** automatically |
| Test Flight (`trial` cohort) | One-off total 250 (placeholder) | **2,000 credits in total** (one-off, BD-16 — the user's decision, see [Revision log](#7-revision-log)) |

The capability was renamed from `ai.actions` to **`credits.allowance`** (unit `credit`) in slice 5, as SA ruled under requirement SQ-17; the tier matrix moved to **version 2** (SQ-19). Until slice 6, owners and invitees see the allowance as "Credits (included)" without the number; admin screens show the figures.

---

## 2. The decisions (2026-09-30)

Decided by the user on 2026-09-30. They resolve requirement **BD-8** ("how much AI cost are we willing to carry per plan per month?").

| # | Decision | What it means |
|---|---|---|
| **D1** | **100% markup** | The owner pays **2×** our AI cost. Every $1 of provider cost corresponds to $2 of the plan fee |
| **D2** | **Plan AI allowance = 50% of the SaaS fee, expressed as credit value** | Half of each plan's monthly fee is "spent" on the credit allowance at retail value. At 2× markup, the **AI cost ceiling is 25% of the fee** — the most provider cost one account can generate inside its allowance |
| **D3** | **Option A chosen over a tight limit** | The allowance is a **margin-protecting ceiling**, not a limit owners are expected to hit. The practical abuse guards are **per-action caps**: images are already capped daily per business (`GeneratedImageService.ts`), the chat daily budget exists (`ChatBudget.ts`), and a further chat / image cap is to be considered in **slice 12** (guards before switch-on) |

**The alternative that was not chosen (option B in the 2026-09-30 discussion — not to be confused with BD-1's option B).** The benchmark showed the allowance could be one to two orders of magnitude smaller and still leave more than 3× headroom over measured use. A tight allowance would make credits a real constraint (and a boost-purchase driver) rather than a comfortable promise. The user chose the generous ceiling: owners should not meet the limit in normal work, and the margin is protected by the ceiling itself.

---

## 3. The formula and the resulting allowances

**Formula.**

```text
allowance credits = (fee × AI share ÷ (1 + markup)) ÷ credit value

where  AI share     = 0.50   (D2)
       markup       = 1.00   (D1, i.e. 100%)
       credit value = $0.001 (BD-1; version 1)
```

Equivalently: **credit value of the allowance (retail) = fee × 50%**, and **cost ceiling = fee × 25%**.

**Resulting allowances.**

| Plan | Internal id | Fee / month | Allowance at retail (50% of fee) | AI cost ceiling (25% of fee) | **Allowance, credits / month** | Placeholder it replaces |
|---|---|---|---|---|---|---|
| Essentials | `basic` | $79 | $39.50 | $19.75 | **19,750** | 500 (`ai.actions`, a count of actions) |
| Autopilot | `pro` | $129 | $64.50 | $32.25 | **32,250** | 2,000 |
| Founding Partner | `champion` cohort | $0 | — | $32.25 (inherited) | **32,250** (reads the `pro` row) | 2,000 (inherited) |
| Test Flight | `trial` cohort | $0 | — | ≤ $2 (one-off) | **2,000 in total** — not derived; the formula gives 0 for a $0 plan, so it was sized on setup (BD-16, §7) | 250 one-off |

**Arithmetic check.** Essentials: 79 × 0.5 = 39.50; ÷ 2 = 19.75; ÷ 0.001 = 19,750. Autopilot: 129 × 0.5 = 64.50; ÷ 2 = 32.25; ÷ 0.001 = 32,250.

**N-8 check (SA).** SA asked that a typical chat turn be at least one whole credit. On the benchmark a chat turn costs about $0.002, i.e. **about 2 credits** at $0.001, so keeping $0.001 satisfies N-8. (SA's N-8 estimate of ~0.6 credit per turn was based on the ChatBudget per-call figure, p50 $0.000594; a turn makes several calls. This reconciliation is an inference, not separately verified.)

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
| Image generation (`gpt-image-1`) | owner, setup | **$0.25** | **250** | 1 measured, before audit coverage began (from `token_usage`) |

**Images dominate.** One image costs as much as ~125 chat turns or ~1,000 briefings.

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

---

## 5. Considerations and trade-offs

| Consideration | What was weighed | Where it stands |
|---|---|---|
| **Generous ceiling vs a real limit** | A ceiling at 25% of the fee is ~330–540× what the benchmark accounts use. It protects margin (no account can cost more than a quarter of its fee in AI inside its allowance) but it is not a constraint owners will feel, and it will not drive boost purchases. A tight limit would do both, at the cost of owners meeting it | **D3: generous ceiling chosen.** Revisit with real customer data (§6) |
| **Automatic work shares the pool** | Nightly insights, briefings and lead replies are charged to the owner (BD-2) from the same allowance. At a generous ceiling this is invisible; at a tight one, automatic work could consume an owner's credits on days they did nothing | Acceptable at the chosen ceiling. The trigger split (§4.4) is the figure to watch if the ceiling tightens |
| **Future non-AI services share the pool** | BD-12: notification emails, SMS and other chargeable services will draw from the same credits. D2's "50% of the fee" was sized on AI cost alone | **May need revisiting** when the first non-AI service is priced: either the 50% covers all services, or the share is raised, or that service's cost is folded in differently. Record the choice in the revision log |
| **Images dominate cost** | One image ≈ 250 credits; 79 images exhaust Essentials. Chat, briefings and insights never come close | The per-business **daily image cap** is the practical guard today. A chat / image cap is to be considered in **slice 12**. If image use grows, image pricing is the first thing to review |
| **Founding Partners carry Autopilot's ceiling at $0** | Champions read the `pro` row, so each may generate up to $32.25 of AI cost a month with no fee against it | Accepted by structural parity (entitlements doc, 2026-09-27). The ceiling is exposure, not expected cost (~$0.06 measured) |
| **Fractional credits for cheap actions** | A briefing is ~0.2 credit, a lead reply ~0.08, a website field rewrite ~0.016. Whole-credit display would show many actions as "0" | Stored as fractions (FR-6). ✅ **The card (slice 6, D-c): whole credits, with "less than 1"** between 0 and 1; "left" = allowance − the displayed used; the "by you" / "automatic" parts are shared out so they add up to the displayed used (`lib/business-os/credits/creditDisplay.ts`). The diary is slice 7 |
| **Credit value kept at $0.001** | A different value only rescales every number; $0.001 makes a chat turn ~2 credits (N-8 met) and keeps allowances readable | Kept; promoted from provisional to derived (version 1) |
| **Markup lives in the allowance, not the credit** | Putting the markup into the credit value would make the ledger overstate cost and tie every recorded charge to a commercial choice | Markup expressed only in allowance size (§1) |

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

### 6.2 Data sources to re-run

| Source | What it gives |
|---|---|
| **Costs & credits tab** of `/admin/business-os-llm` (slice 4a) | Per account and billing period: credits and cost by action type, area, effective service and trigger; **p50 / p90 per action type**; the fallback-priced count. The first place to look |
| **The credit ledger** (`business_os_credit_charges`, `business_os_credit_totals`) | The authoritative record of what was charged, from 2026-09-29 ~15:40 UTC. Prefer it over the audit trail |
| **`audit_trail` `ai_action` entries** | Per-action detail (action type, trigger, `estimatedCostUsd`) back to 2026-09-19. Lossy by design — use for history before the ledger existed, not as the bill |
| **`token_usage`** | Per-call cost, the only record of AI before 2026-09-19, and the cross-check. The leak check (slice 4b) compares it with the ledger |

Use the counting rules in §4.2 for deterministic actions, so figures stay comparable between runs.

### 6.3 Procedure to change the numbers

1. **Record the decision here first** — a row in the [Revision log](#7-revision-log): date, what changed, why, the data used.
2. **Credit value:** **append** a new entry to `CREDIT_VALUE_HISTORY` in `lib/business-os/entitlements/config/creditValue.ts` with the next version number, and extend `creditValue.history.json` in the **same PR**. **Never edit a shipped entry** — that re-prices history (FR-3); the snapshot test catches an accidental edit. The PR and its SA review are the audit record (SQ-7, SA-S6).
3. **Plan allowances:** edit the allowance values in `config/tierMatrix.ts` (the `credits.allowance` capability; it was `ai.actions` before slice 5). **Raising** a value is one line. **Lowering** one is a removal: lower the value, add a `removals` entry, **bump the matrix `version`**, and decide grandfathering — see [BUSINESS_OS_ENTITLEMENTS.md § Removing a capability from a tier](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md#removing-a-capability-from-a-tier). Founding Partners follow the `pro` row automatically; the trial total is set explicitly in `config/cohorts.ts`.
4. Run `npm run entitlements:snapshot` and read the diff, then `npm run test:bos-entitlements`, and follow the `business-os-entitlements` skill.
5. Update the plan table in [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) and this document's §1 / §3 in the same change.
6. **Never rewrite history**: no charge row is edited, and no earlier revision-log row is changed — a correction is a new row.

---

## 7. Revision log

| Date | What changed | Why | Data used |
|---|---|---|---|
| 2026-09-28 | Credit value **version 0**: $0.001 per credit, `provisional` | Working figure from BD-1 so slice 3 could record charges before any measurement existed | None — a round working figure |
| 2026-09-30 | **Decisions D1–D3** (user): 100% markup; allowance = 50% of fee at retail value (cost ceiling 25% of fee); generous ceiling over a tight limit. Resulting allowances: **Essentials 19,750**, **Autopilot 32,250** credits / month (Founding Partner inherits Autopilot), replacing the placeholders 500 / 2,000. Credit value **kept at $0.001**, to be appended as **version 1, `derived`**. **To ship in slice 5** (not yet in code on this date) | Resolves BD-8. The benchmark showed measured use at 0.2–0.3% of these ceilings, so the ceiling protects margin without constraining owners | Benchmark 2026-09-30 (§4): two test accounts, ~10 days each scaled to 30; audit `ai_action` entries, `token_usage`, the credit ledger |
| 2026-09-30 | **Shipped in slice 5.** Capability `ai.actions` renamed to **`credits.allowance`**, unit `credit` (SA SQ-17); **tier matrix version 2** (SQ-19); credit value **version 1** appended (`derived`, $0.001, `matrixVersion: 2`); Essentials 19,750, Autopilot 32,250, Founding Partner reads Autopilot | Carries out D1–D3 in config. A rename and two raises; nothing lowered, so no `removals` entry | As the row above |
| 2026-09-30 | **Trial (Test Flight) one-off total: 2,000 credits** (user, BD-16). Not monthly; running out ends the trial | Sized on setup, not on a fee (the formula gives 0 for a $0 plan): about 6× the worst measured setup month (~347 credits, one image included), so a genuine trial does not end on day one (B-12), with a cost exposure of at most ~$2 per trial. The alternative, a 14-day share of Essentials (~9,200, ≤ ~$9.20), was not chosen | Benchmark 2026-09-30 (§4.5, §4.6): setup month worst case ~347 credits; one image ~250 credits |

---

## 8. Open items

| Item | Status |
|---|---|
| **Trial (Test Flight) one-off total.** D1–D3 derive allowances from a fee; the trial is $0, so the formula gives 0. The trial total must be sized on setup instead (B-12: setup AI counts against it, and using it up ends the trial) | ✅ Decided by the user on 2026-09-30 — **2,000 credits** in total (BD-16; revision log §7). A permanent guard (`trialAllowance.invariant.test.ts`) keeps it a whole one-off total of at least 1,000 |
| **Capability id and unit** | ✅ SA ruled (SQ-17): renamed to **`credits.allowance`**, unit `credit`; shipped in slice 5 |
| **Whether slice 5 bumps the tier-matrix `version`** | ✅ SA ruled (SQ-19): yes, **version 2**, no removal; credit value version 1 carries `matrixVersion: 2` |
| **Showing the number to owners and invitees** | ⬜ Until slice 6, "Credits (included)" without the number (user decision R-7, option C, 2026-09-30); slice 6 decides the wording and removes the rule |
| **The 50% share once a non-AI service is priced** (BD-12) | Revisit when the first non-AI service is designed (§5, §6.1) |
| **A chat / image per-action cap** as the practical abuse guard (D3) | To be considered in slice 12 |
| **Orphan system-config key `monthly_ai_allowance_usd`** | ⬜ Since slice 6a it has **no reader**: the owner card reads the plan's `credits.allowance` from the entitlements resolver, and the dollar allowance and its conversion by `pilot_credit_cost_usd` left the owner surface (FR-36). Left in place — removing a config row is a migration for no owner benefit. Remove in a later clean-up if ever wanted (slice 6 Q-12) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-30 | Created | Credit deduction slice 5. What a credit is (BD-1, BD-12, FR-3); the user's decisions D1–D3 resolving BD-8 (100% markup, allowance = 50% of fee at retail, cost ceiling 25% of fee, generous ceiling over a tight limit); the formula and resulting allowances (Essentials 19,750, Autopilot 32,250 credits / month; Founding Partner inherits Autopilot; trial open as BD-16); the 2026-09-30 benchmark (two test accounts on the champion cohort, counting rules, actions per 30 days, trigger split, cost per action type, usage vs allowance, caveats); considerations and trade-offs; revisit triggers, data sources and change procedure; revision log; open items (BD-16, SQ-17, SQ-19) |
| 2026-09-30 | Slice 5 shipped; BD-16 decided | P-1: §4.7 caveat 2 no longer hints at who account B belongs to. P-2: §1 and §6.3 name `credits.allowance` (renamed from `ai.actions`, SQ-17) and matrix version 2 (SQ-19). §1 and §3 gain the trial's **2,000** one-off total; §7 gains two rows (slice 5 shipped; BD-16 decided); §8 closes BD-16, SQ-17 and SQ-19 and records the temporary "Credits (included)" display until slice 6 |
| 2026-09-30 | Slice 6a: the card rounds; an orphan key | §5 "Fractional credits" row decided for the card (D-c: whole credits, "less than 1", parts that add up). §8 gains the orphan `monthly_ai_allowance_usd` key (no reader since slice 6a, Q-12). The "Showing the number" row is unchanged until 6b removes R-7 |
