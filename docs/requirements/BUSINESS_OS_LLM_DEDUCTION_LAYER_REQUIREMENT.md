# Requirement: Business OS AI Deduction Layer (LLM standards, last layer)

> **Last Updated**: 2026-09-28

**Created by:** BA
**Date:** 2026-09-27
**Status:** **SA reviewed 2026-09-28 — APPROVED WITH CONDITIONS. SA follow-up 2026-09-28 ruled SQ-13 to SQ-16 (slices 1–3 unblocked). Reorganised 2026-09-28 (user) into twelve numbered slices (§12).** The SQ-13 to SQ-16 rulings are now folded into §4, FR-10, FR-12, FR-13, AC-11, slices 2, 3, 4, 9 and KI-8 / KI-9, so the **slice 2 and slice 3 workplans may start**. SA correction **C-1** (slice 1 workplan review) is folded in: the lead reply already has a template fallback (§14, OI-1, slices 1 and 10, FR-20). **BD-11** (when the usage card refreshes) decided by the user and added to slice 6 (FR-39, AC-33). SQ-1 to SQ-16 ruled; BQ-1 **decided 2026-09-28: option C**. BD-2 to BD-7 agreed in principle; BD-8 (AI cost per plan per month) is asked at slice 5. Not yet Approved — needs user or TL sign-off
*(Previous status, superseded 2026-09-28: "SA reviewed 2026-09-28 — APPROVED WITH CONDITIONS. Reorganised 2026-09-28 (user) into twelve numbered slices (§12). Slice 1 may go to a Dev workplan now (it is a subset of the D-0 SA already cleared). Slice 2 adds two items beyond SA's D-0 scope (unrounded audit cost, the failed-call $0 fix) and needs SA to answer SQ-13, SQ-14 and SQ-16 first. Slice 3 needs SA-B1 (folded in) and SQ-15 (the thin charge row). SA-B2 and SA-B3 are folded into slice 9. SQ-1 to SQ-12 ruled; BQ-1 decided 2026-09-28: option C. BD-2 to BD-7 agreed in principle; BD-8 (AI cost per plan per month) is asked at slice 5. The D-0 Dev workplan is superseded and will be redone for slice 1")*

## Overview

Business OS tracks every AI call and charges for none of them. Layers 1, 1.1, 1.5, 2 and 3 made the tracking correct — every call attributed to the business, with an area, a call name, a grouping id, tokens, an estimated cost and one audit entry per action. This layer turns that record into a **charge**: a currency, a rule for what an owner spends, a place to record it, a truthful number on the dashboard, and a defined behaviour when the allowance is gone.

**The currency is decided (§2).** One credit is a fixed amount of real provider cost, and every AI action is charged **its own measured cost, after it ran**. Nothing is predicted, nothing is quoted in advance, and no price list has to be maintained. What replaces predictability is a **credit diary**: the owner sees every action and what it cost, so they learn their own spending.

**Nothing new is tracked (§3).** `runAiAction` already measures every action; the charge is built from that same measurement. The only new thing stored is a thin bill line per action (§4), because the existing records cannot safely be the bill.

The **grain** is the AI action, which already exists in code: `runAiAction` wraps one action and collects its calls, and `lib/business-os/entitlements/balance.ts` is an empty socket waiting for exactly this. This layer is the **S-3 Metering** slice of the entitlements programme, written from the LLM side so the parked LLM questions (Q1, Q6, OQ-7, OI-1, UD-1) are answered with it rather than beside it.

---

## Table of Contents

1. [What is already true](#1-what-is-already-true)
2. [The currency: decided (BD-1)](#2-the-currency-decided-bd-1)
3. [Reusing what exists](#3-reusing-what-exists)
4. [The three records](#4-the-three-records)
5. [How the balance works](#5-how-the-balance-works)
6. [Scope](#6-scope)
7. [User Stories](#7-user-stories)
8. [The grain, and what is charged](#8-the-grain-and-what-is-charged)
9. [Functional Requirements](#9-functional-requirements)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Slice plan](#12-slice-plan)
13. [Business decisions for the user](#13-business-decisions-for-the-user)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [Operator questions answered as-built](#15-operator-questions-answered-as-built)
16. [Out of scope](#16-out-of-scope)
17. [Known issues and open items](#17-known-issues-and-open-items)
18. [Notes on integration points](#18-notes-on-integration-points)
19. [Change History](#19-change-history)

Review: [SA Review (2026-09-28)](#sa-review-2026-09-28), placed before the Change History. The SA Review is kept as written; it uses the section numbers and slice names in force when it was written — see the mapping at its top.

---

## 1. What is already true

Every row was checked against this worktree at `main` 7ba40a56.

| # | Fact | Evidence |
|---|---|---|
| **A-1** | **Business OS deducts nothing.** The only charge path in the product is the agent run: `/api/run-agent` calls `chargeTokensWithIntensity`, and no Business OS code calls any `CreditService` charge method | `lib/services/CreditService.ts:155` (`chargeForExecution`), `:222` (`chargeForCreation`), `:444` (`chargeTokensWithIntensity`); `app/api/run-agent/route.ts:94`; `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:86` |
| **A-2** | **A credit is a token count today, not a cost.** `ceil(tokens ÷ tokens_per_pilot_credit)`, default 10, identical for a gpt-4o token and an embedding token. The agent run then multiplies by an AIS complexity factor (`1 + AIS/10`) | `lib/utils/pricingConfig.ts:102-108`, `:87-92`; `lib/services/CreditService.ts:451-452` |
| **A-3** | **Our dollar figure is not trustworthy yet.** An unpriced model records **$0** with a warning; the sync path reads only the in-memory cache, then a hardcoded fallback list. Under the chosen currency that would charge the customer **nothing**, so it is a prerequisite, not a follow-up (FR-12) | `lib/ai/pricing.ts:250-275`, `:267-270` |
| **A-4** | **The owner's allowance is display-only**, derived as `monthly_ai_allowance_usd ÷ pilot_credit_cost_usd` (≈20,833 credits at the $10 default), and the card counts **down** against it | `app/api/business-os/usage/route.ts:115-138`, `:232-236`; `components/business-os/UsageCard.tsx:108-117` |
| **A-5** | **The Pilot-Credit ledger understates consumption ~13×** (202,414 credits recorded against 2,637,147 consumed on a real account), because only agent runs write to it | `app/api/business-os/usage/route.ts:214-223` |
| **A-6** | **Only two things stop a Business OS owner today**, and both are daily caps, not allowances: the chat daily budget (200 turns / 2,000,000 tokens, counting **distinct turns**) and the per-business daily image cap. The chat budget **fails open** on a read error | `lib/business-os/bizql/telemetry/ChatBudget.ts:51-52`, `:98`, `:173-189`; `lib/services/GeneratedImageService.ts:170-183` |
| **A-7** | **One AI action is already a first-class object in code, and it already carries its own cost.** `runAiAction` opens a usage scope per grouping id and summarises the action's calls — count, failed count, tokens, **estimated cost**, call names, models, outcome — into one audit entry. There are **16 declared action types**, two dormant | `lib/business-os/llm/aiActionAudit.ts:38-54`, `:179-218`, `:267-293` |
| **A-8** | **That audit entry cannot be the billing record.** It is queued, never awaited, and a failed insert loses its whole batch (accepted as Layer 3 KI-B). It is, however, the right **shape** for the diary. The full reasoning is in §3 | `lib/business-os/llm/aiActionAudit.ts:316`, `:304`; `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:551` |
| **A-9** | **The allowance numbers are invented and nothing is sold against them.** `ai.actions` is a `metered` capability (unit `ai_action`, period `month`, `atLimit: 'by_call_site_audience'`); the four plans carry 250 / 500 / 1,000 / 2,000 a month, described in the doc itself as "a first pass… reset here from the shadow report", and every cohort quantity is a `PLACEHOLDER`. **Corrected by SA-S11:** there are two tiers — `basic` 500 and `pro` 2,000, **decided by the user** as action counts — champion reads the pro row, and trial is a one-off 250 | `lib/business-os/entitlements/config/catalog.ts:293-305`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:53`, `:133`, `:40-47`; `tierMatrix.ts:127-129` |
| **A-10** | **The seam exists and is empty.** `ALWAYS_SUFFICIENT` answers "yes" to every balance question so that this layer needs no call-site migration | `lib/business-os/entitlements/balance.ts:20-49` |
| **A-11** | **Business OS must not touch the Pilot-Credit tables.** RD-2: Business OS billing never writes `user_subscriptions` / `credit_transactions`, and no Business OS surface may read them. The ledger behind `balance.ts` is a **BUILD NEW** row (L-22) | `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:351`, `:176` |
| **A-12** | **The mechanics of metering are already specified** in §11 and FR-23 to FR-30, FR-36, FR-41, FR-42: monthly, no roll-over, allowance then boost, degrade-don't-stop, 80/100% warnings, one visible allowance. Only the **unit** was reopened, and is now settled | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md:379-394`, `:475-482`, `:497`, `:502-503` |
| **A-13** | **Nothing is enforced.** `BOS_ENTITLEMENTS_MODE=shadow` in production on purpose; a refused `enforce` also runs as `shadow` | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9`, `:148-151` |
| **A-14** | **No admin can add or reduce a customer's AI balance.** The admin op union is `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state` — no credit grant, and no admin route anywhere writes a credit balance | `lib/business-os/entitlements/adminOps.ts:76-80`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:172`; no match under `app/api/admin/**` |
| **A-15** | **The expiry lock is half-built and fails open.** `checkExecutionAllowed` blocks an agent run on `account_frozen` or an insufficient balance but returns `allowed: true` on any DB error or missing row; the cron that would set `account_frozen` is **not scheduled** | `lib/services/CreditService.ts:388-438` (`:404-408`); `app/api/run-agent/route.ts:104-135`; `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:108-110` |
| **A-16** | **Layer 2's kill switch fails open** by design — an area whose settings read fails keeps calling on code defaults. It also lets an operator **change an area's model in configuration**, which the chosen currency absorbs automatically | `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` §5, §3 |
| **A-17** | **Real cost per action is spread wide, and is not predictable per action.** A chat turn is fractions of a cent (measured over 1,000 calls: p50 $0.000594, p99 $0.000747); a website generation is cents; one image is **$0.016–$0.25** and carries **zero tokens** (SA N-6: the lower bound is $0.011) | `lib/business-os/bizql/telemetry/ChatBudget.ts:7-13`; per-image pricing by model / size / reported quality, Layer 1.5 FR-10, FR-13 |
| **A-18** | *(added 2026-09-28, for BD-11)* **What the usage card shows today, as built.** It reads a **rolling 30 days** of `token_usage` and turns tokens into credits at **tokens ÷ 10** (A-2); the allowance is **platform-wide** — $10 ÷ $0.00048 ≈ 20,800 credits — and is **the same whatever the account's plan** (A-4); and the figures are **fetched once, when the page loads**, so the card does not move after the owner uses the AI until the page is reloaded | `app/api/business-os/usage/route.ts`, `lib/business-os/usage/usageSummary.ts`, `components/business-os/UsageCard.tsx` |

**The consequence, in one line:** the plumbing, the grain, the cost figure and the socket all exist; what is missing is a **credit**, a ledger, a truthful dashboard number with a diary behind it, and a defined behaviour at zero.

---

## 2. The currency: decided (BD-1)

**Decision, by the user, 2026-09-28: option B — credits charged at live measured cost.**

- **One credit is a fixed amount of real provider cost** (working figure ≈ $0.001). The exact value is a configuration decision taken **with** the tier allowances in slice 5, once slices 3 and 4 have measured real spend (FR-37).
- **Every action is charged its own measured cost, after it ran.** Credits charged = the action's measured provider cost ÷ the credit value.
- **No prediction, no published price list, no re-derivation when a model changes.**

**Why the user chose it:** it is the simpler mechanism, and cost genuinely cannot be predicted per action — chat above all. Everything is after the fact, so the platform never loses money on a stale price and never has to recalculate one. A model change, a prompt change or a provider price change is absorbed the moment it happens.

**Knowingly accepted, and written here so nobody rediscovers it as a defect:**

| Accepted | Consequence |
|---|---|
| The same action can cost different amounts on different days | Two identical-looking website generations may be 27 and 34 credits. The diary shows both, and neither is wrong |
| Support cannot quote a price in advance | "What will this cost me?" is answered with the owner's own history and a range (FR-27), never with a number we commit to |
| The charge depends on our cost figure being right | Which is why FR-12 is a prerequisite — slice 2 lands before slice 3 records any charge |

**What replaces predictability: the credit diary.** The owner sees their balance fall **and** a per-action history — what each action was and what it cost — so they can learn to manage their own spend (FR-26). Predictability comes from their record, not from our promise.

### The options, for the record

| | **A. Per-action-type price list** | **B. Live measured cost** | **C. Credits = tokens ÷ 10** |
|---|---|---|---|
| **What one credit is** | A fixed unit of value; each action type has a published price set from its measured cost | A fixed amount of real provider cost; each action is charged its own actual cost | One tenth of a token, whatever that token cost |
| **What the owner sees** | A price before acting | A balance, and a diary of what everything actually cost | A number that moves at a rate nothing explains |
| **Verdict** | **Not chosen** — it needs a price list maintained against every model and prompt change, and the moment one drifts we are either over-charging or losing money | ✅ **CHOSEN** | **Not chosen** — model-blind (a gpt-4o token costs ~16× a gpt-4o-mini token, and Layer 2 lets an operator change the model in config, A-16), and an image has no tokens, so the most expensive action in the product would cost **zero** |

**A "weighted action" was option A** — weighting actions and a price list are the same mechanism — so it falls with A.

### What follows from the decision

| Item | Under option B |
|---|---|
| The ledger row | Stores **the credits charged and the measured cost behind them**, plus the credit-value version used and whether a fallback price was applied (FR-13) |
| The card | Credits used and remaining against the plan allowance, **plus the diary** (FR-24, FR-26) |
| Tier allowances | Derived from measurement together with the credit value (FR-37) |
| Pricing accuracy (FR-12) | **A prerequisite, in the strict form**: a missing price must never charge zero |
| Images | Charged at their actual measured cost — which is what finally settles OQ-7 |
| Failed and retried actions | Charged what was actually spent, and shown in the diary (FR-8, FR-9) |
| Rounding | Fractional credits stored, rounded figures displayed (FR-6) |
| A model change by an operator (A-16) | Absorbed automatically; nothing to re-derive |

---

## 3. Reusing what exists

**Decision, by the user, 2026-09-28: no new tracking.**

- **`runAiAction` is the only place that measures.** It already opens a usage scope for the action and collects every call the action made — tokens, cost, call name, model, outcome — into an in-memory list (A-7).
- **The audit entry and the charge row are both built from that same in-memory list**, at the end of the action. The charge is **not** built by re-reading `token_usage` afterwards, and nothing else in the product is asked to count anything.
- One measurement, two outputs: the logbook (the audit entry, which exists) and the bill (the charge row, which is new and thin — §4).

### Why the audit trail cannot itself be the bill

It is tempting to charge straight from the AI audit entry: it already exists, is one per action and already holds the cost. It cannot be the bill, for five reasons:

| # | Gap | What it means for a bill | How it is handled |
|---|---|---|---|
| **(a)** | **It is lossy by design.** Entries go into an in-memory queue flushed every 5 s or 100 rows, the write is never awaited, and a failed insert is silent and loses the batch (Layer 3 KI-B) | A lost audit entry would be a free action — money spent that no balance reflects. A logbook may tolerate an occasional gap; a bill may not | **Not fixed** — making the audit durable is out of scope (§16). This is one of the two reasons for the new charge table |
| **(b)** | **Its key is not one-per-action.** The grouping id is reused: onboarding keeps one per conversation, and chat takes it from a client-supplied header (SA-B1) | Keyed on the grouping id, every later onboarding turn would be dropped as a duplicate, and a client re-sending one header would get every chat turn free | **Fixed inside the existing infrastructure** — `runAiAction` mints an action id per invocation, and the audit entry carries it (slice 3) |
| **(c)** | **It cannot hold grants or adjustments.** It records what an action did; it has no place for "admin added 200 credits" or "this charge was corrected" | A balance needs both | **Not fixed there** — the second reason for the new table (grants in slice 11, adjustments in slice 4) |
| **(d)** | **It gets archived.** The Admin Archiving module moves old `audit_trail` rows out of the live table | A bill whose lines disappear on an archive run cannot be summed or shown in a diary | A reason not to depend on it; the charge table is never archived or purged (SA-S8) |
| **(e)** | **It rounds cost to a micro-dollar** (`aiActionAudit.ts:199`). A plan-cache lookup embedding costs ~$0.0000002 and rounds to $0 | Small actions would be charged nothing | **Fixed inside the existing infrastructure** — the audit entry stores the unrounded cost (slice 2; per SQ-14, rounded to 10 decimal places rather than a micro-dollar), and the charge row is built from the raw per-call figures (SQ-8) |

**In short:** gaps (b) and (e) are fixed where they live, so the logbook becomes accurate. Gaps (a) and (c) are why one new, thin table exists at all; (d) is why it must be its own table rather than a view over the audit trail.

---

## 4. The three records

After this layer there are three records of AI use. Two already exist; one is new. Each has one job, and nothing is written to more than one of them twice.

| | **`token_usage`** (exists) | **AI entries in `audit_trail`** (exist) | **The charge table** (new — working name `business_ai_charges`; SA names it) |
|---|---|---|---|
| **Covers** | The whole product — AgentsPilot agents **and** Business OS | Business OS only | Business OS only |
| **One row per** | AI **call** | AI **action** | AI **action** |
| **Written by** | The shared AI layer, automatically, for every call | `runAiAction`, from its in-memory list of calls | `runAiAction`, from the same in-memory list, **directly and confirmed** |
| **Its job** | Per-call cost detail; checking the provider's invoice; the **safety net** that sees AI calls made outside `runAiAction` | The **logbook** — compliance and admin review of what the AI did | The **bill** — what the owner was charged |
| **Losing a row** | Undesirable | Tolerable now and then (it is queued, §3 (a)) | **Never acceptable** |
| **Also used by** | The agent platform, in about 50 places in code | — | — |
| **Read by** | Admin "why was this expensive?", the invoice check, the nightly leak check (slice 4) | Admins and compliance | The owner's card and diary, the balance, the operator report |

**The charge row is deliberately thin.** It holds only what a bill needs (shape confirmed by SA, SQ-15, 2026-09-28):

- the action id (one per action, the key), the account, the time;
- **the period it belongs to (`period_start`, required, written at charge time)** — so the period totals can always be rebuilt even if the account's period anchor later changes;
- **the grouping id (`group_id`, indexed, not unique)** — the only link from a charge to its `token_usage` rows;
- the credits charged, the measured cost behind them, the credit-value version, and whether a fallback price was used;
- three short codes: **the action type**, **the trigger — `owner`, `scheduled` or `external`** ("automatic" is derived from the last two for display), **succeeded or failed**.

It does **not** hold tokens, models, call names, areas or error codes. Those stay in the audit entry (joined by the **action id**, which the audit entry carries from slice 3) and in `token_usage` (joined by the **grouping id**, which `token_usage` stores as `session_id` — `usageScope.ts:45-46`; `token_usage` never carries the action id, and adding it would be new tracking). The area and the plain-language diary label come from the action type through the slice 1 list. **The diary reads only the charge table** (confirmed by SA, SQ-15).

*(Superseded wording, 2026-09-28, corrected by SQ-15: the row held "the action id (one per action, the key), the account, the time" and "three short codes: the action type, owner or automatic, succeeded or failed", with "Those stay in the audit entry and in `token_usage`, joined by the action id when anyone needs them" and "(SQ-15 asks SA to confirm this shape against the SQ-1 ruling)". `token_usage` is not joinable by the action id as built.)*

### Scenario 1 — an owner asks the assistant a question

One chat turn makes three AI calls:

| Call | Model | Cost |
|---|---|---|
| Look up whether a similar question was answered before | embedding | $0.0000002 |
| Plan the answer | gpt-4o | $0.0012 |
| Write the answer | gpt-4o | $0.0028 |
| **The action** | | **$0.0040002** |

What happens:

1. The shared AI layer writes **3 rows to `token_usage`**, one per call, as it does today.
2. At the end of the turn `runAiAction` has the three calls in memory. From that list it:
   - queues **1 audit entry** (the logbook), now carrying the action id and the unrounded $0.0040002;
   - writes **1 charge row** and waits for it to be confirmed: 4.0002 credits at 1 credit = $0.001, stored as a fraction, shown as **4**.
3. The account's running total moves from **1,000 to 996** credits remaining (stored 995.9998, shown 996).
4. The owner's **card and diary read the charge table**: "Chat — Answered a question — you — 4 credits".
5. If an admin later asks "why was this turn expensive?", they take the charge row's **grouping id** (`group_id`) and read the `token_usage` rows with that `session_id`, and see that the two gpt-4o calls were the cost. *(Superseded wording, corrected by SQ-15: "they read `token_usage` for that action id".)*
6. When the provider's invoice arrives, it is checked against `token_usage`, not against the charges.

### Scenario 2 — a Business OS AI call that is not wrapped in `runAiAction`

A new feature is shipped that calls the AI directly, or a call finishes after its action closed, or a call is excluded from its action's usage scope (SA-S9; `usageScope.ts:58-59`).

1. The shared AI layer writes **1 row to `token_usage`**, as for every call.
2. No audit entry and no charge row are written, because no action was open.
3. That night the **leak check** (slice 4) compares Business OS spend in `token_usage` with the charge table for each account and finds **spend with no charge**. Operators see it and fix the call site; nothing is silently free for long.

### Scenario 3 — an AgentsPilot agent runs

1. The shared AI layer writes rows to **`token_usage` only**.
2. The agent is charged by the **agent platform's own credit system** (Pilot Credits, A-1), exactly as today.
3. **The charge table is never written for agent work**, and Business OS never reads or writes Pilot Credits (A-11). The two systems share only `token_usage`, and each reads its own rows.

---

## 5. How the balance works

A worked example, in plain language. The numbers are illustrative: the real plan allowances and credit value are set in slice 5.

**The rule:** remaining credits = **this period's plan allowance** + **any live admin grants** − **the sum of this period's charge rows**. It is kept as a running total per account per period so it is fast to read, and it can always be rebuilt from the charge rows.

| When | What happens | Plan credits left | Grant left | Owner sees |
|---|---|---|---|---|
| The account's period starts | A **Pro** account gets **1,000 credits** for the period. The period runs from the account's own start date (e.g. the 14th to the 13th), not the calendar month (T-6) | 1,000 | — | 1,000 left |
| The owner asks a question | The chat turn cost $0.004, so **4 credits** are taken **after it ran** | 996 | — | 996 left; diary: "you — 4" |
| Overnight | The nightly insight run costs **12 credits**. It is shown as **automatic**, on its own line, so the owner is never surprised | 984 | — | 984 left; diary: "automatic — 12" |
| An admin grants credits | An admin adds **+200** for a design partner, with a reason and, optionally, an expiry date | 984 | 200 | 1,184 left |
| Later in the period | The owner keeps working. **Grant credits are used only after the plan's credits are gone** | 0 | 150 | 150 left |
| Before every owner action | The only question asked is **"is anything left?"** — never "is there enough for this?", because the cost is not known until afterwards | | | |
| The last action | With 2 credits left and no grant, one more website generation costs 5. It runs, and the balance goes **slightly below zero** | −3 (stored) | 0 | **0 left** (never shown negative) |
| The next period | The plan allowance **resets to 1,000**. The 3-credit overspend is **not carried over**, and unused plan credits **do not roll over** (B-6). An unused, unexpired grant stays until it is used or expires | 1,000 | as left | 1,000 left |
| A trial account | Gets a **one-off total**, not a monthly one; using it up ends the trial (FR-18) | | | |

In `shadow` mode (today, and through every slice in §12) the numbers are all recorded exactly as above, but **nothing is refused**; the owner's assistant keeps working at zero until enforcement is switched on (S-5).

---

## 6. Scope

**In scope**

- The credit (§2): its value as configuration, and the one resolver that turns an action's measured cost into credits.
- **No new tracking** (§3): the charge is built from the measurement `runAiAction` already makes.
- Making the cost figure trustworthy enough to charge on (FR-12).
- What one action is at each of the catalogued areas, and what is not charged.
- A durable, thin per-action charge record (§4), with idempotency, and the real implementation behind `balance.ts`.
- The owner-facing surface: the usage card in credits, when it refreshes (FR-39), and the **credit diary**.
- Deriving the credit value and the tier allowances from measurement rather than inventing them (FR-37).
- Behaviour at the limit, per audience, and how it relates to the chat daily budget.
- Admin grant / reduce, and how an expired subscription stops AI spend.
- Day-one treatment of existing balances and history.

**Not in scope**

| Item | Where it belongs |
|---|---|
| Buying a plan, boost purchase, auto top-up, annual | S-4a / S-4b (`BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.2) |
| Switching enforcement on (needs G-1 key rotation) | S-5 |
| Any change to Pilot Credits, `CreditService`, `user_subscriptions` or the agent platform's charge path | Out — forbidden by B-8 / RD-2 (A-11) |
| Reconciling our cost figure against the provider's invoice | Follow-up. FR-12 removes silent $0 and flags a guessed price; it does not claim our figure equals OpenAI's bill |
| Non-AI metering (SMS, email fair-use) | Same mechanism later; a credit extends to it, an "action" does not |
| A second tracking mechanism of any kind | Out, by the user's reuse decision (§3) |
| Live, background-polled updates of the usage card | Out, by BD-11: the card refreshes on three triggers only (FR-39) |

---

## 7. User Stories

- As **a business owner**, I want the dashboard to tell me how many credits I have left of what my plan includes.
- As **a business owner**, I want the card to update as soon as I have used the AI, and when I come back to the page, without reloading it — and to be able to refresh it myself.
- As **a business owner**, I want to see what each thing I did actually cost, so that after a week I know which work is cheap and which is expensive, and I can manage it myself.
- As **a business owner**, I want to know which of my spend was work I asked for and which the product did for me overnight, so a falling balance is never a mystery.
- As **a business owner who has used everything up**, I want my clients to keep getting replies and reminders, and to be told plainly that the assistant is paused until next month or an upgrade.
- As **a new owner**, I don't want my setup conversation to eat a meaningful part of my first month.
- As **an admin**, I want to give a design partner or an unhappy customer more credits, and to take them back, with a reason and an audit entry.
- As **the business owner (Barak)**, I want each plan's allowance and the value of a credit to be derived from what it actually costs us to serve, not from a number somebody invented.
- As **the business owner (Barak)**, I want to know every night that no AI spend escaped the bill, so a missed charge is found in a day, not at the end of a quarter.

---

## 8. The grain, and what is charged

The **grain** is one AI action. The **price** of that action is always its own measured provider cost.

| Question | Rule |
|---|---|
| **The grain** | One entry of `AiActionType` (A-7): one chat turn, one insight run for one business, one briefing narration, one website or landing-page generation, one intake form generation, one lead reply, one onboarding turn, one image. An action that makes five LLM calls is still **one action**, charged the cost of all five |
| **The price** | The measured provider cost of the calls that action made, converted at the configured credit value. Never estimated, never quoted in advance |
| **Owner-triggered** | Charged |
| **Background (nightly insights, daily briefing, automatic lead replies)** | Charged, recorded with its trigger, and shown on its own line and in the diary (BD-2) |
| **Setup (onboarding, first website / intake generation, regenerations)** | Charged, against the trial's one-off total (B-12, FR-41) |
| **Images** | Charged at their actual per-image cost ($0.016–$0.25, A-17) — this is what settles OQ-7 |
| **An action that failed** | **Charged what was actually spent**, and shown in the diary marked as failed. The money left the building; the balance must reflect it |
| **A failed call inside a successful action** | Its cost is part of the action's cost. One action, one row |
| **A retry that made new calls** | Charged, because new calls were paid for. Idempotency protects against writing the same spend twice, never against charging spend that happened |
| **A cache hit (chat plan cache, image reuse)** | Charged exactly what it spent. An image served from the reuse cache made no call and costs 0; a chat plan-cache hit still paid for its lookup embedding, so it costs a small non-zero fraction (SA-S1) |
| **A lead with no candidate links** | Not charged: `LeadAlertService` returns before the AI action runs, so there is no action (C-1) |
| **Agent-platform work** | Never charged here; Business OS never reads or writes the Pilot-Credit balance (A-11) |

---

## 9. Functional Requirements

Each FR's delivering slice is listed in the coverage table in §12.

### The currency and the grain

1. **FR-1** The customer-visible unit of AI usage in Business OS is a **credit**, defined as a fixed amount of real provider cost. The unit at which spend is measured is **one AI action** (§8). Every action is charged **after it has run**, at its own measured cost.
2. **FR-2** Credits charged for an action = the action's measured provider cost ÷ the configured credit value, computed in **one** resolver. No call site computes a charge, and there is no per-action-type price list to maintain.
3. **FR-3** The credit value is **configuration**, versioned, and changing it **never rewrites history**: consumption already recorded keeps the credits it was charged, and the change is auditable (who, when, from what, to what). Every ledger row records the credit-value version it was charged under.
4. **FR-4** The set of chargeable actions is derived from **one** declared list, shared with the audit layer, so an action cannot be audited without being chargeable or vice versa. Each entry declares: its area, its **audience** (owner-facing or client-facing), whether it is **setup AI**, whether it is charged, its **diary label**, and its template fallback where it is client-facing. **Refined 2026-09-28 (user):** the list is declared **on the existing `AiActionType`** in `lib/business-os/llm/aiActionAudit.ts`, co-located with the type — not as a separate parallel list — and a guard test fails if any type lacks an entry.
5. **FR-5** A fan-out action (one instruction applied to many records) needs no multiplier: it is charged the cost of every call it made. `AiActionBalanceQuery.cost` remains an **estimate for the pre-check only**, never the charge.
6. **FR-6** **Credits are stored as a fraction and displayed rounded.** The ledger records credits at a documented precision sufficient for the cheapest action (an embedding is a fraction of a cent); the card and the diary display rounded figures. **The displayed diary must reconcile with the displayed balance** — rounding is applied to presentation only, never accumulated into the stored balance, and a documented rule says how a sum of rounded lines is reconciled with the rounded sum.

### What is charged

7. **FR-7** An action is charged **exactly what it spent**. An action that made no LLM call — an image served from the reuse cache — is charged **0**. A chat turn served from the plan cache still made its lookup embedding and is charged that small non-zero fraction (SA-S1). *(Superseded wording, 2026-09-27: "An action that made no LLM call is charged 0 — including a chat turn served from the plan cache and an image served from the reuse cache.")*
8. **FR-8** An action is charged **the measured cost of the calls it actually made, whether it succeeded or failed**, and a failed action appears in the diary marked as failed. This is consistent with the existing per-action audit entry, which already records a failed action with its calls, its tokens and its cost.
9. **FR-9** A ledger row is written **at most once per completed action**, identified by its **action id** — minted by `runAiAction` once per invocation (SA-B1): writing the same invocation's charge twice produces no second row. Where a retry made **new** calls, it is a new invocation and its cost is charged — idempotency protects against recording the same spend twice, never against charging spend that happened. The grouping id is **not** the key, because it is reused across onboarding turns and taken from a client header in chat. *(Superseded wording: "identified by its grouping id: replaying or double-invoking the same completed action writes no second row.")*
10. **FR-10** Background (`trigger: 'scheduled'`) and external (`trigger: 'external'`) actions are charged to the business whose account they ran for, and recorded with their trigger so they can be reported and shown separately. On the charge row the trigger is stored as one short code — **`owner`, `scheduled` or `external`** (SQ-15) — and "automatic" is derived from `scheduled` and `external` for display, so slice 12's stranger cap can count `external` actions on their own. *(Superseded wording, corrected by SQ-15: "On the charge row the trigger is the short code **owner / automatic**; the finer trigger stays on the audit entry.")*
11. **FR-11** Tokens and estimated cost continue to be recorded per call exactly as today, and every charged action records the measured cost behind its credits, so any charge can be traced back to what it was derived from. **No new tracking** (§3): the charge row and the audit entry are built from the same in-memory list of calls in `runAiAction`, never by re-reading `token_usage`.
12. **FR-12** **A charge may never be derived from a cost figure that can silently be wrong.** Specifically:
    - a. A model with **no price entry** must **fail loudly** — logged at `error` with the provider, model, area and action — and must **never** be recorded, or charged, as $0.
    - b. Where a price is genuinely missing at charge time, the action is charged a **conservative documented fallback** (the highest price in the relevant class, documented with its derivation), and the ledger row is **flagged as fallback-priced**.
    - c. A flagged row is surfaced to operators in the report of FR-33 and as a countable log event, so "how many charges were guessed?" is answerable at any time.
    - d. Flagged rows are **reconciled** once the real price is known: the corrected figure is recorded as an adjustment with its reason, never by rewriting the original row.
    - e. Every model an operator can select in Layer 2's area settings must have a price entry, checked automatically; and a per-image price must resolve for every configured model, size and quality. *(Restated by SA-S2: every **code default** is priced > 0, tested; DB-selected models are covered by Layer 2's existing refill gate, DEC-7.)*
    - f. This is a prerequisite: it lands in **slice 2**, before slice 3 records any charge. *(Was: "inside the first slice", D-0.)*
    - g. **Added 2026-09-28 (user): the cost is fixed at its source**, so `token_usage`, the audit entry and every future charge agree: the audit entry stores the **unrounded** cost (§3 (e)), and a failed call on which the provider still spent tokens is not recorded at $0 (SA N-3) — assessed and fixed in slice 2 without changing what the agent platform is charged (SQ-13, SQ-14, SQ-16).
    - h. **Refined by SA, SQ-13 / SQ-14 / SQ-16 (2026-09-28)** — this supersedes the parts of (a) and (g) it contradicts:
      - "At source" means the **per-call record** (`UsageCallRecord`) carries the true measurement plus a **priced / unpriced signal**, derived from a **separate read-only lookup** over the same price table. `calculateCost`, `calculateCostSync` and `resolveImagePrice` return nothing new.
      - `token_usage` **never** gets a Business OS-only figure. On the residual unpriced call (reachable only through a defect), `token_usage` and the audit entry record **$0 with an `error` log**, and **only the charge row** carries the flagged conservative price. So (a)'s "never recorded as $0" holds for the charge, not for `token_usage` or the audit entry; the three records disagree **visibly**, never silently.
      - An **absent** signal is **not** "unpriced": the Business OS resolver re-checks the table with the same lookup and falls back only when the model is genuinely unpriced — so an area an operator points at a provider that does not set the signal is not over-charged the class maximum.
      - The audit entry's cost is rounded to **10 decimal places** (not stored as a raw float), stays `schema: 1`, and older entries are **not backfilled**.
      - The failed-call part of (g) is **not** fixed: the provider reports no usage on an error, so there is nothing to record. KI-8 is accepted with SA sign-off, and `baseProvider.ts`'s failure path is not changed.

### The ledger and the charge path

13. **FR-13** Consumption is recorded in a **Business OS-owned charge table**, one **thin** row per charged action (§4), carrying: the **action id** (unique), the account, the time, **`period_start`** (required, written at charge time), the **grouping id** (`group_id`, indexed, **not** unique), **the credits charged**, **the measured cost behind them**, the credit-value version, the fallback-priced flag, and three short codes — the **action type**, the **trigger** (`owner` / `scheduled` / `external`), and **succeeded / failed**. It does **not** carry tokens, models, call names, areas or error codes; those stay in the audit entry (joined by the action id) and `token_usage` (joined by the grouping id, stored there as `session_id`). A **per-account, per-period running total**, keyed by account and `period_start`, is kept in step with it and can be rebuilt from the rows. **Adjustment rows** (FR-12d) have their shape decided in slice 3 — a row kind with a nullable reference to the adjusted action, or a sibling table — so slice 4 adds rows, not a breaking migration; an adjustment row has its own id and never reuses the adjusted row's action id (SQ-15). *(Superseded 2026-09-28 by SQ-15 — the thin-row wording was: "carrying: the action id (unique), the account, the time, the credits charged, the measured cost behind them, the credit-value version, the fallback-priced flag, and three short codes — the action type, owner / automatic, and succeeded / failed … joined by the action id." Superseded earlier 2026-09-28 by the user's thin-row decision — the first list was: "the account, the grouping id (unique), the area, the action type, the trigger, the credits charged, the measured cost behind them, the credit-value version, the fallback-priced flag, the outcome (succeeded / failed), the period it falls in, the action's tokens, and the time." SA's SQ-1 ruling listed a similar wider row.)*
14. **FR-14** The ledger is **not** `user_subscriptions`, `credit_transactions` or `billing_events`, and no Business OS code reads or writes those (A-11). All access goes through a repository in `lib/repositories/`, scoped by account.
15. **FR-15** The ledger write is **not** the audit queue. It must be a direct, confirmed write; the audit entry stays as it is and remains joinable **by the action id**, which the audit entry now also carries (SA-B1; A-7, A-8).
16. **FR-16** A ledger write failure never fails the owner's action, and is logged at `error` with the account, area, action type, grouping id and action id — so an uncharged action is discoverable rather than silent. The nightly leak check (slice 4) also finds it.
17. **FR-17** `balance.ts`'s real implementation answers from the ledger plus the account's entitled allowance and any grant balance: consumption order is **period allowance first, then grants** (soonest-expiring first). **Corrected by SA-B3:** the pre-check is wired in **one** place, `runAiAction`, before the action runs; "no call site changes" understated this (slice 9).
18. **FR-18** The period allowance **resets each period and does not roll over** (B-6). The trial's allowance is a one-off total, not monthly, and using it up ends the trial. The period runs from the account's own anchor date (T-6).

### At the limit

19. **FR-19** When an account's allowance is exhausted, behaviour follows the action's **audience**: client-facing actions **degrade** to their template fallback and still run; owner-facing AI **pauses** with an explanation (D-12).
20. **FR-20** No client-facing automation may be stopped by an exhausted allowance. **Corrected by C-1 (SA, 2026-09-28):** the one client-facing action today, `lead_reply_recommendation`, **already has** a template fallback — every failure in `recommendLeadReply` falls back to `pickFallbackCandidate`, a fixed rule with no AI call, and the model only ever picks which of the owner's links to send, never writes the reply. So nothing is built: "balance exhausted" is **routed down the existing fallback path that the area-switched-off path already uses**, and the lead reply still goes out. Any client-facing action added later must declare a template fallback (FR-4) before it can be degraded. *(Superseded wording: "Where a client-facing action has no template fallback, this layer builds one before that action can be degraded." — and the slice plan's "build the missing fallback".)*
21. **FR-21** The balance check **fails closed for owner-facing AI** and **fails open for client-facing** actions, and every fallback is logged at `error`. This is deliberately unlike Layer 2's kill switch (A-16) and unlike the chat daily budget (A-6), and the difference is stated in code. **Refined by BQ-1 (option C, user 2026-09-28) and SA-B2:** when the balance cannot be read, owner-facing AI **keeps working unless the account was last seen at zero**; only then is it refused, with the retryable `entitlement_unavailable` outcome — never "out of credits" and never an upgrade prompt. This supersedes entitlements T-3(d) for this capability.
22. **FR-22** The chat daily budget stays as it is and is a **separate, additional** guard: it caps a day, the allowance caps a period. A refusal names which one stopped the turn, and the two are never presented to the owner as one number.
23. **FR-23** Warnings fire at configurable thresholds (default **80%** and **100%**), once per threshold per period. Before a **setup** action that would exhaust or nearly exhaust a trial allowance, the owner is warned first, told what remains, and can cancel (FR-42). In `shadow` the warnings are **recorded, not sent** (slice 8). The "would exhaust" estimate is the action type's measured p90, or the owner's own history once there is enough (SA-S4); it is never the charge.

### What the owner sees

24. **FR-24** The usage card reports **credits used and remaining out of the allowance the account's plan entitles it to** — read from the entitlements resolver, not from `monthly_ai_allowance_usd ÷ pilot_credit_cost_usd` (A-4).
25. **FR-25** The card separates **what the owner asked for** from **what ran automatically**, at least as two figures, so a balance that fell overnight is explainable (OI-1).
26. **FR-26** **The credit diary.** The owner can see a per-action history of their own spend, newest first, covering at least the current period. Each line shows: **when** it happened, **the area**, **what the action was** (a plain-language label for the action type), **whether the owner triggered it or it ran automatically**, **whether it succeeded or failed**, and **the credits charged**.
    - It **reads only the charge table** (SA-S5; user 2026-09-28) — the area and the label come from the action type through the slice 1 list — and **reconciles with the balance**: the diary for a period sums to the credits used in that period. *(Superseded wording: "It derives from the same per-action record as the audit entry" — the audit is lossy, §3 (a).)*
    - It **never** shows prompts, anything the owner typed, anything the model returned, an error message, tokens or dollars — the same closed rule Layer 3 applies to audit entries.
    - It is the owner's own data only, always scoped to the caller, never addressable by an account id in a request.
27. **FR-27** **A typical range, from the owner's own history.** Where the diary holds enough of an owner's own examples of an action type, it may show a typical range — "website generations have cost you 25–35 credits". It is labelled as **their own past spend, not a price and not a commitment**, it is never shown as a single number, and it is suppressed when there are too few examples to be meaningful.
28. **FR-28** No owner-facing surface shows tokens or dollars.
29. **FR-29** Where an account has no entitled allowance (nothing configured, or an unresolvable plan), the card shows consumption with no gauge, as it does today for a missing allowance, and the diary still works.

### Operator

30. **FR-30** An admin can **grant** credits to one account (amount, reason, optional expiry) and **reduce or end** a grant, through the existing admin operations path: `requireAdmin` first, Zod-validated, audited with actor, target, before/after and reason, never available to a user on their own account.
31. **FR-31** An admin can read one account's current position — allowance, used, granted, remaining, and which layer decided the allowance — without SQL.
32. **FR-32** An account whose plan has expired or lapsed consumes no further owner-facing AI, decided by the entitlements lifecycle, not by a frozen flag on the agent-platform subscription row (A-15).
33. **FR-33** An operator-readable report gives, per account and period: credits used by area, by action type and by trigger, **with the measured cost behind them** and **the count of fallback-priced rows** (FR-12c). This is the report the credit value and the tier allowances are derived from (FR-37). It includes the nightly **leak check** — Business OS spend in `token_usage` compared with the charge table per account and period (SA-S9).

### Day one, allowances and rollout

34. **FR-34** Charging starts at a stated moment. **No historical usage is converted into credits**, and no account starts its first metered period with anything already spent.
35. **FR-35** Existing Pilot-Credit balances are left exactly as they are, are never read by Business OS, and have no effect on a Business OS allowance. The ~13× understatement (A-5) becomes irrelevant rather than being reconciled.
36. **FR-36** Exactly **one** AI allowance is visible to a Business OS owner. The display-only `monthly_ai_allowance_usd` path is retired from the owner surface in the same release that introduces the new one (T-9).
37. **FR-37** **The credit value and the tier allowances are derived together, not invented.** From FR-33's measurement: the credit value is set as a round amount of real cost, and each plan's allowance = the target AI cost the business is willing to carry for that plan ÷ that credit value. The existing 250 / 500 / 1,000 / 2,000 are **placeholders** and are replaced in the same change, along with every `PLACEHOLDER` cohort quantity; the derivation (target cost, credit value, measured inputs, date) is recorded next to the numbers. This touches `lib/business-os/entitlements/config/tierMatrix.ts`, `config/cohorts.ts` and `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, and the capability's `unit` changes from `ai_action` to the credit unit. *(SA-S11: basic 500 and pro 2,000 were user decisions, so the target cost per plan is the user's input — BD-8.)*
38. **FR-38** The layer ships behind the existing entitlements mode: in `shadow` it charges, records, reports, shows the diary and warns, and refuses nothing; only `enforce` applies FR-19 to FR-21.

### What the owner sees — when the card refreshes (added 2026-09-28, BD-11)

39. **FR-39** **The usage card refreshes on three triggers, and only these** (BD-11, user 2026-09-28):
    - a. **right after an AI action the owner triggered finishes** — the owner sees what that action cost without reloading the page;
    - b. **when the owner returns** to the tab or the page;
    - c. **when the owner presses a small refresh icon on the card**, which shows a brief loading state while it re-reads.

    There is **no background or timer polling**. Work that runs automatically (nightly insights, the daily briefing, lead replies) appears on the **next** of these refreshes. After slice 6 each refresh reads the **per-period running total kept with the charge table**, for the owner's own billing period (§5, T-6) — not a rolling 30 days of `token_usage` (A-18).

---

## 10. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | A balance check adds at most one cached lookup per request or turn, resolved once and reused. The ledger write never blocks the owner's response beyond a short, fixed time budget (SQ-3). The diary is paged and reads one account's rows only. Background runs resolve in batch per run, not per item. The usage card does **no background or timer polling**; it reads only on the three triggers of FR-39. |
| **Correctness** | One completed action = at most one ledger row, guaranteed by a uniqueness constraint on the **action id** (SA-B1; was: the grouping id), not by application care alone. A concurrent burst may overspend an allowance by a small, bounded amount; it may never charge the same spend twice. Credits are never stored rounded, and the diary always reconciles with the balance. The running total per account and period can always be rebuilt from the rows, using each row's stored `period_start` (SQ-15). |
| **Security** | Account, allowance, credit value and grant values are never taken from a request body. The diary is caller-scoped with no account parameter. Admin authority only via `requireAdmin` / `admin_users`, never `profiles.role`. Every ledger read and write is account-scoped through a repository; the table is server-write-only (the money-table lockdown pattern). |
| **Observability** | Pino structured logs for every `limit_reached`, degrade, pause, warning, grant, credit-value change, failed ledger write, **unpriced model** and **fallback-priced charge** (FR-12), with account, area, action type, grouping id, action id and correlation id. No prompt text, owner text or model output, matching Layer 3's rules. |
| **Auditability** | Every grant, reduction, credit-value change and fallback-price reconciliation is an audit entry. Every charged action is already audited (A-7); the ledger row and the audit entry share the **action id** (the audit entry also keeps the grouping id), so the two can be reconciled. The ledger row also carries the grouping id, which is how a charge reaches its `token_usage` rows (`session_id`) even when the audit entry is lost or archived (SQ-15). |
| **Reuse** | No new tracking mechanism (§3). The charge row and the audit entry are built from the same in-memory list of calls in `runAiAction`. No code reads `token_usage` to build a charge; `token_usage` is read only by the report, the leak check and admin drill-downs. |
| **Testability** | Charging rules are unit-testable with no provider: cost→credits conversion at a given credit value, 0 for a call-free cache hit, the actual cost for a failed action, no second row on a repeated write of the same invocation, a new charge for a retry that spent, fractional storage with rounded display, an unpriced model failing loudly and falling back conservatively, an **absent** price signal re-checked rather than treated as unpriced (SQ-13), and audience-dependent behaviour at zero. A source-level test fails if a declared action type has no audience, no charge rule or no diary label. |
| **Logging debt** | This layer does not touch `lib/services/CreditService.ts` or `lib/utils/pricingConfig.ts` (A-11), so their `console.*` calls stay out of scope. If a slice ends up touching either — or `lib/ai/pricing.ts` for FR-12 — CLAUDE.md rule 3 applies and the conversion is raised with the user first. `anthropicProvider.ts` (7 `console.*`) and `kimiProvider.ts` (2) are the same: a slice that must touch them raises the conversion first. |

---

## 11. Acceptance Criteria

The delivering slice for each AC is listed in §12.

**The currency and pricing**

- [ ] **AC-1** (FR-1, FR-2) An action's charge equals its measured cost ÷ the configured credit value, computed in one resolver; a code review finds no charge, price or weight computed at a call site, and no per-action-type price list.
- [ ] **AC-2** (FR-3) Changing the credit value changes what new actions cost and leaves every already-recorded row at its original credits; the change writes one audit entry with before and after, and rows record the version they were charged under. *(SA-S6: because the value lives in code config, "one audit entry" is the versioned config record plus its PR, and the process logs the active version at start-up.)*
- [ ] **AC-3** (FR-12a, b, e) A model with no price entry produces an `error` log naming provider, model, area and action, and is charged the **conservative documented fallback** — never $0; a test enumerates every model selectable in Layer 2's area settings and fails if any has no price; a per-image price resolves for every configured model / size / quality. *(SA-S2: the test enumerates every **code default**; DB-selected models are covered by DEC-7.)*
- [ ] **AC-4** (FR-12c, d) A fallback-priced row is flagged, counted in the operator report and countable from logs; reconciling it records an adjustment with its reason and leaves the original row intact.
- [ ] **AC-5** (FR-6) Credits are stored fractionally at the documented precision: an embedding-only action records a non-zero fraction, not 0 and not 1; the card and diary display rounded figures; and the diary for a period reconciles with the balance shown for that period under the documented rule.
- [ ] **AC-29** (FR-12g) *(added 2026-09-28)* The AI audit entry records the unrounded cost: an action whose only call is a ~$0.0000002 embedding shows a non-zero cost in its audit entry. A failed call on which the provider reported spent tokens is not recorded at $0, **or** the case is documented as a known issue with SA sign-off (SQ-16). The agent platform's charge for an identical agent run is unchanged before and after. *(Resolved by SQ-16: the "documented as a known issue with SA sign-off" branch applies — KI-8. Per SQ-14 the stored cost is rounded to 10 decimal places and the entry stays `schema: 1`; AC-29 is verified on the stored value.)*

**What is charged**

- [ ] **AC-6** (FR-7) A second identical image request (reuse cache) is charged **0** and does not move the balance; a chat turn served from the plan cache is charged only its lookup embedding — a small non-zero fraction (SA-S1).
- [ ] **AC-7** (FR-8) An action that threw after two paid calls is charged those two calls' cost and appears in the diary marked failed; an action with one failed call and a successful outcome is charged the whole action's cost, once.
- [ ] **AC-8** (FR-9) Writing the same invocation's charge twice produces no second row (the action id is unique); two onboarding turns in one conversation, and two chat turns sent with the same client header, each produce their **own** row; a retry that made new calls is charged for them.
- [ ] **AC-9** (FR-4, FR-10) Every declared action type has an audience, a setup flag, a charge rule and a diary label, asserted by a test that fails when a new type is added without them. A nightly insight run and a daily briefing are each charged to their own business with `trigger: 'scheduled'`.
- [ ] **AC-10** (FR-5) One action that made five LLM calls produces one row charged for all five; a fan-out over 12 records is charged its actual total, and the pre-check estimate is not what was charged.

**Ledger**

- [ ] **AC-11** (FR-13, FR-14) A ledger row carries the action id, `period_start`, the grouping id, the credits charged, the measured cost, the credit-value version, the fallback flag, the action type, the trigger (`owner` / `scheduled` / `external`) and the outcome — and no tokens, models, call names, areas or error codes; a code review finds no Business OS read or write of `user_subscriptions`, `credit_transactions` or `billing_events`, and no direct Supabase call outside `lib/repositories/`. *(Superseded wording, corrected by SQ-15: "A ledger row carries the action id, the credits charged, the measured cost, the credit-value version, the fallback flag, the action type, owner / automatic and the outcome".)*
- [ ] **AC-12** (FR-15, FR-16) With the audit queue stubbed to fail, the ledger row is still written; with the ledger write forced to fail, the owner's action still succeeds and one `error` log names the account, area, action type, grouping id and action id.
- [ ] **AC-13** (FR-17, FR-18) An account with 10 credits remaining and a 25-credit grant spends the 10 first; a new period resets consumption to zero and carries nothing over; a used-up trial total ends the trial.
- [ ] **AC-30** (FR-11) *(added 2026-09-28)* A code review finds that the charge row is built from `runAiAction`'s in-memory call list and that no charge path reads `token_usage`; the charge row's cost equals the unrounded sum of the action's per-call costs.

**At the limit**

- [ ] **AC-14** (FR-19, FR-20) With the allowance exhausted and mode `enforce`: a lead reply still goes out, with template text (the link chosen by the existing fixed rule, `pickFallbackCandidate` — C-1); a chat turn is refused with a normal assistant message that names the plan and the reset, and the conversation stays usable.
- [ ] **AC-15** (FR-21) With the ledger unreadable: an owner-facing AI action for an account last seen with credit left **runs** (BQ-1 option C); one last seen at zero is refused with the retryable `entitlement_unavailable` outcome, not "out of credits"; a client-facing automation runs; each case is logged at `error`. *(Superseded wording: "an owner-facing AI action is refused and logged at `error`".)*
- [ ] **AC-16** (FR-22) A turn refused by the daily chat budget and a turn refused by the period allowance produce different, correctly named refusals.
- [ ] **AC-17** (FR-23) Crossing 80% fires once in the period and not again; a setup regeneration that would exhaust a trial allowance warns before running and can be cancelled. In `shadow`, both are recorded and not sent.

**Owner surface**

- [ ] **AC-18** (FR-24, FR-25, FR-29) The card shows credits used and remaining against the resolved plan allowance, splits owner-triggered from automatic, and falls back to "consumption, no gauge" when no allowance resolves — with the diary still working.
- [ ] **AC-19** (FR-26) The diary shows time, area, plain-language action, trigger, outcome and credits per line, newest first, pages correctly, reconciles with the period's balance, and contains **no** prompt, owner text, model output, error message, token count or dollar figure. A request that tries to name another account's id gets its own data or a refusal, never the other account's. The diary reads only the charge table.
- [ ] **AC-20** (FR-27) With enough of an owner's own examples, a range is shown, labelled as their own past spend and never as a price; with too few, nothing is shown.
- [ ] **AC-21** (FR-28, FR-36) No owner-facing surface renders a token or dollar figure, and none derives an allowance from `monthly_ai_allowance_usd`.
- [ ] **AC-33** (FR-39) *(added 2026-09-28, BD-11)* With the dashboard open: after the owner runs an AI action, the card shows the new used / remaining figures **without a page reload**; after a scheduled run while the owner is on another tab, **returning to the tab** shows it; pressing the **refresh icon** shows a brief loading state and then the current figures; and with the page left idle, a network trace shows **no periodic requests** from the card. The figures match the period's running total for the owner's own billing period, not a rolling 30 days.

**Operator**

- [ ] **AC-22** (FR-30) A grant and a reduction each: require an admin, reject an invalid body with 400, write one audit entry with actor, target, before/after and reason, and change the account's remaining balance. A non-admin, and a user aiming the operation at their own account, are both refused.
- [ ] **AC-23** (FR-31, FR-33) One account's allowance / used / granted / remaining and the deciding layer are readable without SQL, and the per-area, per-action-type, per-trigger report — with measured cost and the fallback-priced count — reproduces the same totals.
- [ ] **AC-24** (FR-32) An account whose plan has lapsed consumes no owner-facing AI, with no dependence on `account_frozen`.
- [ ] **AC-31** (FR-33, SA-S9) *(added 2026-09-28)* The nightly leak check, run against a test account with one deliberately unwrapped Business OS AI call and one forced ledger-write failure, reports both as uncharged spend with the account and period.
- [ ] **AC-32** (SA-S7) *(added 2026-09-28)* Past the per-account daily cap on stranger-triggered lead replies, further lead replies go out as template text and are not charged; the owner's own AI is unaffected.

**Allowances, day one and rollout**

- [ ] **AC-25** (FR-37) The credit value is recorded as configuration with its derivation; no plan or cohort allowance remains at a placeholder value; each carries its derivation (target cost, credit value, measured input, date); the entitlements doc and the capability's `unit` match what shipped.
- [ ] **AC-26** (FR-34, FR-35) On the day charging starts, every account reads zero spent and an empty diary; no historical `token_usage` row is converted; no Pilot-Credit balance changes.
- [ ] **AC-27** (FR-38) In `shadow`, a fully exhausted account is refused nothing, while the ledger, the diary, the report and the warnings all work. Flipping to `enforce` is the only thing that changes behaviour.
- [ ] **AC-28** (end-to-end, non-production) On a test business: an onboarding conversation, an insight run, a briefing, a website generation, a lead reply, a chat turn, an image and one deliberately failed action each produce one diary line whose credit figure matches the measured cost; the card's figures before and after are recorded; the audit entry and the ledger row for each action carry the same **action id**. A concurrency test proves the same spend is never charged twice and records the measured overspend under a burst.

---

## 12. Slice plan

**Reorganised 2026-09-28, at the user's direction.** The rules for every slice:

- Slices are numbered **1, 2, 3 …** — no D-0 / D-1b labels.
- Each has a **title that says what it does**, and is **small enough to implement in a few days**.
- Each has a defined **scope** and explicit **guardrails** — what it must not touch.
- Every slice ships alone, leaves the product working, and runs in `shadow`: **no slice refuses anyone**. Switching enforcement on is S-5, outside this layer, and needs G-1.

The user proposed eleven slices. BA split the proposed "behaviour at zero" into two (slices 9 and 10) because, with SA-B2 and SA-B3 folded in, it would not fit in a few days: one slice builds the balance check, the other the pause-and-degrade behaviour and the missing template fallback. The rest are as proposed. *(Corrected by C-1: the lead-reply template fallback is not missing; slice 10 routes to it rather than building it, so slice 10 is smaller than first sized.)*

### At a glance

| # | Title | Owner sees a change? | Depends on |
|---|---|---|---|
| **1** | Label every AI action | No | — |
| **2** | No $0 cost | No | — (alongside 1) |
| **3** | Record every charge, silently | No | 1, 2 |
| **4** | Operator cost report and nightly leak check | No (operators do) | 3 |
| **5** | Set the credit value and plan allowances | No (the user decides) | 4 |
| **6** | Owner usage card in credits | **Yes** | 3, 5 |
| **7** | Credit diary and typical range | **Yes** | 3, 6 |
| **8** | Warnings at 80% and 100%, and the setup pre-warning | Recorded, not sent, in `shadow` | 3, 4, 5 |
| **9** | Check the balance before every AI action | No | 1, 3 |
| **10** | Pause the owner's assistant, keep client work on templates | Only once enforced | 9 |
| **11** | Admin grant / reduce credits and per-account view | Admins do | 3, 9 |
| **12** | Guards before switch-on | Only once enforced | 9, 10 |

---

### Slice 1 — Label every AI action

| | |
|---|---|
| **Goal** | Every existing AI action type carries, in one place, the facts the charge and the diary need. |
| **What the owner / user gets** | Nothing visible yet. It is the foundation: every future diary line will have a plain-language name in English, Hebrew and Spanish, and the product will know which actions face the owner and which face the owner's clients. |
| **Scope (in)** | On the **existing** `AiActionType` in `lib/business-os/llm/aiActionAudit.ts`, co-located with the type, a declaration for every type: area, audience (owner / client), setup flag, charged, diary label (en/he/es, or its key following the catalog's label pattern — the workplan chooses), template-fallback status (exists / missing / n/a). A guard test that fails when a type lacks an entry, inside the `typecheck:bos-llm` gate. The two dormant types included (KI-4). The fallback inventory: `lead_reply_recommendation` recorded as **`exists`** — every failure in `recommendLeadReply` falls back to `pickFallbackCandidate` (`LeadReplyRecommender.ts`, `leadReplyCandidates.ts`), a fixed rule with no AI call (C-1). Fix the stale "NOT WIRED YET" header (SA-S12). *(Superseded wording, corrected by C-1: "`lead_reply_recommendation` recorded as **missing** (OI-1)".)* |
| **Guardrails (out / must not touch)** | No separate, parallel list or module (user decision; supersedes SA's D-0 item 1 "one typed module next to `aiActionAudit.ts`"). No runtime behaviour change. No change to `runAiAction`'s behaviour, the audit `details` schema, `balance.ts`, `EntitlementService`, `ENFORCEMENT_POINTS`, any call site, the entitlements catalog's audience, or the `ai.actions` id. No pricing file. No migration, no UI. No change to the lead-reply fallback path — it is recorded, not touched (slice 10 routes "balance exhausted" to it). *(Superseded wording: "The missing fallback is recorded, **not built** (slice 10).")* `aiActionAudit.ts` is server-only, so slice 7 must resolve diary labels on the server (or ship keys) — never import this module into a client component (SA follow-up). |
| **Depends on** | Nothing. |
| **FRs / ACs** | FR-4. AC-9 (the guard half). Also SQ-12, SA-S12, KI-4, OI-1 (closed by C-1), C-1. |

### Slice 2 — No $0 cost

| | |
|---|---|
| **Goal** | Fix the cost figure at its source, so `token_usage`, the audit entry and every future charge are right: never silently $0, never rounded away. |
| **What the owner / user gets** | Nothing visible. It protects both sides: no action can ever be free by accident, and none can be over-charged without a flag. For Barak, the AI cost figures already on record become trustworthy. |
| **Scope (in)** | An unpriced model **fails loudly** (`error`, naming provider, model, area, action) and is never recorded as $0 (FR-12a). The **conservative fallback**, computed as the highest rate in the in-code table for the same provider and kind, flagged (FR-12b, SQ-9), via an optional price-source signal on `UsageCallRecord` set in `openaiProvider` (SA-S3), plus a pure Business OS function that slice 3 wires. **Price-coverage tests**: every code-default model priced > 0, every image default × size × quality resolves > 0, the default embedding model priced (SA-S2, FR-12e). The **audit entry stops rounding** to a micro-dollar and stores the unrounded cost (FR-12g, SQ-14). A **failed call recorded at $0 when tokens were spent** (SA N-3, `baseProvider.ts:166-176`) is assessed and fixed where the provider reports usage (SQ-16). *(Superseded by SQ-16: assessed, no code change — the provider reports no usage on an error; KI-8 accepted with SA sign-off.)* Optionally, the unpriced log level in `pricing.ts` goes from `warn` to `error`. **Folded in from SQ-13, SQ-14 and SQ-16 (SA, 2026-09-28):** (1) the per-call record (`UsageCallRecord`) carries the true figure plus the priced / unpriced signal, derived from a **separate read-only lookup** over the same price table — `calculateCost`, `calculateCostSync` and `resolveImagePrice` return nothing new; (2) `token_usage` **never** gets a Business OS-only figure — on an unpriced call, `token_usage` and the audit entry say **$0 with an `error` log**, and only the charge row (slice 3) carries the flagged conservative price; (3) an **absent** signal is **not** "unpriced" — the Business OS resolver re-checks the table with the same lookup and falls back only when the model is genuinely unpriced (this refines SA's D-0 item 4); (4) the audit cost is rounded to **10 decimal places**, not stored as a raw float, stays `schema: 1`, the tests that pin the old rounding change with it, and **no backfill** of older entries; (5) one named UI exception: the **admin audit-trail cost formatter** may become precision-aware (admin-only, no owner surface). Restated: **KI-8** (failed calls stay $0 — the provider reports no usage on an error; SA-accepted) and **KI-9** (OpenAI cached input is already priced at half rate in `openaiProvider.ts`). |
| **Guardrails (out / must not touch)** | **Must not change what the agent platform is charged**: `CreditService`, `pricingConfig`, `run-agent` and `chargeTokensWithIntensity` untouched, and an agent run costs the same credits before and after. Must not change what `calculateCost`, `calculateCostSync` or `resolveImagePrice` return for priced models (SA-S3; see SQ-13). No hand-typed fallback prices. Does not touch `anthropicProvider` or `kimiProvider` (`console.*` debt) unless the user approves converting them. No charge table, no migration, no UI, no call-site change, no change to `balance.ts`. **No change to the `baseProvider.ts` failure path** (SQ-16). The "no UI" rule has **one named exception**: the admin audit-trail cost formatter (SQ-14). |
| **Depends on** | Nothing; can run alongside slice 1. SQ-13, SQ-14 and SQ-16 **ruled 2026-09-28 and folded in above — the workplan may start.** *(Was: "Needs SA answers to SQ-13, SQ-14 and SQ-16 before its workplan.")* |
| **FRs / ACs** | FR-11, FR-12a, b (mechanism), e, f, g, h. AC-3, AC-29. Also SQ-9, SQ-13, SQ-14, SQ-16, SA-S2, SA-S3, N-3, N-5, KI-8, KI-9. |

### Slice 3 — Record every charge, silently

| | |
|---|---|
| **Goal** | Every completed Business OS AI action writes one confirmed charge row, and each account has a running total for its period — while nothing is refused and nothing the owner sees changes. |
| **What the owner / user gets** | Nothing visible. From the stated start moment, every AI action has a bill line behind it. This is the moment Business OS starts **counting** in credits. |
| **Scope (in)** | An **action id** minted per invocation inside `runAiAction` (SA-B1); the audit entry carries it (a `schema: 2` bump). The **thin charge table** (§4, FR-13) and the **per-account, per-period totals row** updated in the same transaction (SQ-1). The write is **direct, awaited with a short time budget, and never throws** (SQ-3), idempotent on the action id (SQ-2). The charge is built from the in-memory call list, never from `token_usage` (FR-11). **One resolver** converts cost to credits at a **provisional credit value, version 0**, in the entitlements config (FR-2, FR-3, SQ-7); slice 2's fallback flag is applied. Fractional storage (SQ-8). Failed actions charged what they spent (FR-8); background and external actions recorded with their trigger (FR-10). Table standards per SA-S8: FK to `auth.users`, owner-SELECT RLS only, server-write-only, repository access, registered as never-purged and in the deletion policy. A stated charging start; no history converted (FR-34, FR-35). **Row shape per SQ-15 (SA, 2026-09-28):** the thin row gains `period_start` (**required**, written at charge time; the totals row is keyed on it), `group_id` (**indexed, not unique** — the link to `token_usage.session_id`), and stores the trigger as **`owner` / `scheduled` / `external`** (slice 12's stranger cap counts `external`). **The adjustment-row shape is decided here** (a row kind plus a nullable reference to the adjusted action, or a sibling table), so slice 4 adds rows without a breaking migration; adjustment rows have their own id and never reuse an `action_id`. **Possible split** (SA follow-up): if the workplan's estimate exceeds a few days, split at the natural seam — **3a** action id + `schema: 2` + credit value v0 + the pure resolver (no DB); **3b** the tables, repository, RPC and wiring. *(Superseded wording: "background and external actions recorded as automatic (FR-10)".)* |
| **Guardrails (out / must not touch)** | Refuses nothing, and adds no pre-check (slice 9). No owner surface. `balance.ts` stays `ALWAYS_SUFFICIENT`. No read of `token_usage` to build a charge. No tokens, models, call names, areas or error codes on the charge row. No row is ever updated in place. No grants table (slice 11); no adjustment rows **written** (slice 4) — only their shape decided. No Pilot-Credit table read or written. Must be **proven** unable to throw into, delay beyond its budget, or change the result of any action (SQ-11 condition 1, WC-21). *(Superseded wording: "no adjustment rows (slice 4)".)* |
| **Depends on** | Slices 1 and 2. SQ-15 **ruled 2026-09-28 and folded in — the workplan may start.** *(Was: "Needs SA to confirm the thin row (SQ-15) before its workplan.")* |
| **FRs / ACs** | FR-1, FR-2, FR-3 (provisional value, versioning), FR-5 (charge side), FR-6 (storage), FR-7, FR-8 (charge side), FR-9, FR-10, FR-11, FR-12b (flag on the row), FR-13, FR-14, FR-15, FR-16, FR-18 (period totals), FR-34, FR-35, FR-38. AC-1, AC-2, AC-5 (storage), AC-6, AC-7, AC-8, AC-10, AC-11, AC-12, AC-26, AC-30. Also SA-B1, SA-S1, SA-S8, SQ-15. |

### Slice 4 — Operator cost report and nightly leak check

| | |
|---|---|
| **Goal** | Operators can see what AI costs us, per account, per action type and per trigger; and every night we check that no Business OS AI spend escaped the bill. |
| **What the owner / user gets** | Owners see nothing. Barak and operators get the real numbers needed to set the credit value and the plan allowances, a count of charges that used a fallback price, and a nightly list of any spend with no charge behind it. |
| **Scope (in)** | The FR-33 report, readable without SQL: credits and cost per account and period, by action type, by area (through the slice 1 list) and by owner / automatic; the fallback-priced count (FR-12c); per-action-type spread (p50 / p90), which slice 8's pre-warning and slice 5's derivation use. The **nightly leak check**: Business OS spend in `token_usage` compared with the charge table, per account and period (SA-S9) — catches calls outside `runAiAction` and failed charge writes (FR-16). Reconciling a fallback-priced row by an **adjustment row** that points at the original (FR-12d). **Folded in from the SA follow-up (2026-09-28):** a **fallback-flagged row is not a leak** — its charge is above `token_usage` by design, so it is reported as reconciled-pending (SQ-13 (3)); the **drill-down** from a charge to its cost detail goes from the charge row's `group_id` to `token_usage.session_id` (SQ-15); and the check also covers calls **excluded from a usage scope** (`usageScope.ts:58-59`), the other source of uncharged spend. |
| **Guardrails (out / must not touch)** | Read-only over `token_usage` and the charge table, except the adjustment rows. No automatic correction and no backfill of missed charges — a backfill is decided once the loss rate is measured (SQ-3, N-7). No owner-visible change. No change to how `token_usage` is written. Admin access only through `requireAdmin`. A nightly job depends on `CRON_SECRET` being set on Vercel, or it stays dormant (fail-closed). |
| **Depends on** | Slice 3; a few weeks of shadow data before slice 5 uses it. |
| **FRs / ACs** | FR-12c, FR-12d, FR-16 (detection), FR-33. AC-4, AC-23 (report half), AC-31. Also SA-S9, N-7, SQ-13 (3), SQ-15. |

### Slice 5 — Set the credit value and plan allowances

| | |
|---|---|
| **Goal** | Replace the invented numbers with a real credit value and per-plan allowances derived from measured cost. |
| **What the owner / user gets** | **Barak decides one thing: how much AI cost we are willing to carry per plan per month** (BD-8). From that and slice 4's numbers, each plan gets a credit allowance that means something. Owners see nothing yet; slice 6 shows it. |
| **Scope (in)** | A configuration change (FR-37): the credit value as a versioned entry in the entitlements config with its derivation and date (SQ-7, SA-S6); new `basic` / `pro` allowances and every `PLACEHOLDER` cohort quantity, including the trial's one-off total; the capability's `unit` and labels changed from action to credit; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` updated. The credit value is chosen so that a typical chat turn is at least one whole credit (N-8). |
| **Guardrails (out / must not touch)** | Config and documentation only — no code path changes. No recorded charge is rewritten (FR-3). The `ai.actions` id is not renamed (SA-S11). No tier may grant a `not_built` capability. No enforcement. |
| **Depends on** | Slice 4's measurement, and the user's answer to BD-8. |
| **FRs / ACs** | FR-3 (the real value), FR-18 (trial total), FR-37. AC-2, AC-25. Also SA-S6, SA-S11, N-8, OI-2. |

### Slice 6 — Owner usage card in credits

| | |
|---|---|
| **Goal** | The dashboard card tells the owner the truth: credits used and left of their plan, split into what they asked for and what ran automatically — and it stays current without a page reload. |
| **What the owner / user gets** | One honest AI number on the dashboard, for example "620 of 1,000 credits used this period — 480 by you, 140 automatic — resets on the 14th". The old, display-only allowance disappears. The card updates right after the owner uses the AI, when they come back to the page, and when they press its small refresh icon (BD-11). |
| **Scope (in)** | FR-24, FR-25, FR-28, FR-29, FR-36. The card reads the totals row and the charge table; the allowance comes from the entitlements resolver. Rounded display (FR-6). Labels in en/he/es. The display-only `monthly_ai_allowance_usd` path and the agent-platform rate-key reads are retired from the owner surface (closes the read side of TK-6, SQ-10). **Card refresh (FR-39, BD-11):** the card re-reads (a) right after the owner's own AI action finishes, (b) when the owner returns to the tab or page, and (c) from a small manual refresh icon on the card, with a brief loading state; no background or timer polling, so automatic work shows on the next refresh. **As-built today (A-18):** the card reads a rolling 30 days of `token_usage` at tokens ÷ 10, against a platform-wide allowance of $10 ÷ $0.00048 ≈ 20,800 credits regardless of plan, fetched once on page load. **After this slice:** it reads the charge table's running total for the owner's own billing period. |
| **Guardrails (out / must not touch)** | **Must not ship before slice 5** (SA-S10). No tokens or dollars shown. No refusal and no warning sent. No Pilot-Credit table read. Caller-scoped only, no account id in a request. No background or timer polling (BD-11). **BA recommendation:** slices 6 and 7 may be built separately, but should reach owners in the **same release** — under option B the diary is the owner's predictability, and a falling number with no explanation behind it invites support tickets (KI-11). |
| **Depends on** | Slices 3 and 5. |
| **FRs / ACs** | FR-6 (display), FR-24, FR-25, FR-28, FR-29, FR-36, FR-39. AC-18, AC-21, AC-33. Also SA-S10, SQ-10, BD-11. |

### Slice 7 — Credit diary and typical range

| | |
|---|---|
| **Goal** | The owner can see every AI action and what it cost, and — once there are enough examples — a typical range from their own history. |
| **What the owner / user gets** | A list such as "Today 09:14 — Chat — Answered a question — you — 4 credits" and "Last night — Insights — automatic — 12 credits", with failed actions marked; and, where there is enough history, "website generations have cost you 25–35 credits". |
| **Scope (in)** | FR-26 (reads **only** the charge table; area and label from the slice 1 list; paged, newest first, current period by default), FR-27 (own-history range), FR-6's display rule with the footnote "lines are rounded; the total is exact" (SQ-8), failed actions marked (FR-8). |
| **Guardrails (out / must not touch)** | Never shows prompts, owner text, model output, error messages, tokens or dollars. No account id parameter. Never reads `audit_trail` or `token_usage`. The range is never a single number and never presented as a price; it is hidden when there are too few examples. |
| **Depends on** | Slices 3 and 6. |
| **FRs / ACs** | FR-6 (display), FR-8 (display), FR-26, FR-27, FR-28. AC-5 (display), AC-19, AC-20. Also SA-S5. |

### Slice 8 — Warnings at 80% and 100%, and the setup pre-warning

| | |
|---|---|
| **Goal** | Owners are warned before they run out, and before a setup action that could use up the rest of a trial. |
| **What the owner / user gets** | Once warnings are switched on: a notice at 80% and at 100%, each once per period; and, before a setup regeneration on a trial, "this usually costs about X of your remaining Y credits — continue?", with a way to cancel. **In `shadow` the warnings are recorded and logged, not sent** — Barak can see who would have been warned. |
| **Scope (in)** | FR-23: configurable thresholds (default 80 / 100), once per threshold per period, the setup pre-warning. The estimate for "would exhaust" is the action type's measured p90 from slice 4, or the owner's own history once there is enough (SA-S4). Delivery through the existing in-app surface. |
| **Guardrails (out / must not touch)** | Refuses nothing. The estimate is never the charge. No new delivery channel (email, SMS). Nothing sent to the owner's clients. Whether warnings are sent before enforcement (SQ-11 condition 3 allows it after slice 5) is a switch-on choice, not a build choice. |
| **Depends on** | Slices 3, 4 (the p90 figures) and 5 (real allowances to measure against). |
| **FRs / ACs** | FR-23. AC-17. Also SA-S4, SQ-11 condition 3. |

### Slice 9 — Check the balance before every AI action

| | |
|---|---|
| **Goal** | Before every Business OS AI action, ask one question in one place: "does this account have anything left?" — and behave sensibly when the answer cannot be read. |
| **What the owner / user gets** | Nothing visible in `shadow`. The check runs, its answer is logged, and nothing is refused. Once enforcement is on, this is what decides whether the owner's assistant may run. |
| **Scope (in)** | The real `balance.ts` (FR-17): plan allowance first, then grants (none exist until slice 11), consumption read fresh from the totals row (SQ-5). The pre-check wired in **one** place, `runAiAction`, before the action runs, with the audience from the slice 1 list (SA-B3). chat-v4 restructured to set the account before the action starts. The gate registered in `ENFORCEMENT_POINTS`. **Outage behaviour per BQ-1 option C** (FR-21, SA-B2): when the balance cannot be read, owner AI keeps working unless the account was last seen at zero, then `entitlement_unavailable`; the comment and catch block in `EntitlementService` updated in the same change. The pre-check asks only "is anything left?" — no reservation (SQ-4). **Folded in from the SA follow-up (2026-09-28):** option C needs a **"last seen at zero"** fact that is readable **when the balance is not** — the totals row is unreadable in exactly that case. The workplan must say **where it is kept** (for example, per-instance memory from the last successful read), and a **cold instance with no memory keeps working** (treated as "last seen with credit left") — otherwise option C silently becomes option A or B. |
| **Guardrails (out / must not touch)** | Refuses nothing in `shadow`, and **cannot throw** there (WC-21). No reservation. No second pre-check anywhere else. No change to the chat daily budget or the image cap. Does not use `account_frozen`. Never an upgrade prompt on an outage. A missing "last seen" fact never refuses an owner. |
| **Depends on** | Slices 1 and 3. |
| **FRs / ACs** | FR-5 (the pre-check estimate), FR-17, FR-18 (period reset applied), FR-21, FR-38. AC-13 (plan half), AC-15, AC-27. Also SA-B2, SA-B3, BQ-1, OI-5. |

### Slice 10 — Pause the owner's assistant, keep client work on templates

| | |
|---|---|
| **Goal** | Define and build what happens at zero: the owner's own AI pauses with a clear explanation; everything that touches the owner's clients keeps working on template text. |
| **What the owner / user gets** | Nothing in `shadow`. Once enforcement is on, at zero: "Your assistant is paused until the 14th, or until you upgrade" — while their clients still get lead replies and reminders. A turn stopped by the daily chat limit says so, and is never confused with the monthly allowance. |
| **Scope (in)** | FR-19: pause owner-facing actions, degrade client-facing ones, by audience. FR-20: **route "balance exhausted" down the existing fallback path** for `lead_reply_recommendation` — the same path the area-switched-off path already uses (`pickFallbackCandidate`, a fixed rule with no AI call) — so a lead reply goes out even with no AI (C-1). FR-22: distinct, correctly named refusals for the daily chat budget and the period allowance. The pause message as a normal assistant reply that keeps the conversation usable. *(Superseded wording, corrected by C-1: "FR-20: **build the missing template fallback** for `lead_reply_recommendation` (OI-1) so a lead reply goes out even with no AI.")* |
| **Guardrails (out / must not touch)** | Inert in `shadow`. No client-facing automation may ever be stopped. No change to how the chat daily budget or image cap count. No enforcement switch-on. No change to the pre-check itself (slice 9). No new lead-reply fallback and no change to `pickFallbackCandidate`'s rule — only a new reason to take the existing path. |
| **Depends on** | Slice 9. |
| **FRs / ACs** | FR-19, FR-20, FR-22. AC-14, AC-16. Also OI-1 (closed by C-1), BD-5, C-1. |

### Slice 11 — Admin grant / reduce credits and per-account view

| | |
|---|---|
| **Goal** | An admin can give an account extra credits, take them back, and see any account's position — without SQL. |
| **What the owner / user gets** | Barak or an admin can give a design partner or an unhappy customer "+200 credits, reason: onboarding help, expires 31 Dec", and reduce or end it later. The owner sees the extra credits in their remaining balance, used only after the plan's own credits. An admin can open one account and see allowance, used, granted, remaining and which layer decided the allowance. |
| **Scope (in)** | FR-30: new grant / reduce / end operations on the existing admin operations path — `requireAdmin` first, Zod-validated, audited with actor, target, before/after and reason. A grants table carrying actor, reason, `created_at` and `expires_at` (SA-S8). Grants counted in `balance.ts`, soonest-expiring first (FR-17). FR-31: the per-account position view. |
| **Guardrails (out / must not touch)** | Never available to a user on their own account. No purchase or payment (S-4b). No Pilot-Credit table. Never `profiles.role`. Grants never rewrite charge rows. |
| **Depends on** | Slices 3 and 9. |
| **FRs / ACs** | FR-17 (grant half), FR-30, FR-31. AC-13 (grant half), AC-22, AC-23 (view half). Also A-14, D-7. |

### Slice 12 — Guards before switch-on

| | |
|---|---|
| **Goal** | Close the two gaps that must be closed before enforcement can be switched on: an expired plan must stop the owner's AI, and strangers must not be able to spend an owner's credits. |
| **What the owner / user gets** | Once enforcement is on: an owner whose plan has lapsed gets a clear "your plan has ended" instead of AI; and a form-spammer flooding an owner's enquiry form cannot drain the owner's credits — past a daily cap, lead replies go out as template text. |
| **Scope (in)** | FR-32: a lapsed or expired plan stops owner-facing AI, decided by the entitlements lifecycle. SA-S7: a per-account daily cap on charged stranger-triggered (`external`) actions, like the image cap; past it, the lead reply degrades to template text. The cap counts charge rows whose stored trigger is **`external`** (SQ-15), not a list of action types, so a future stranger-triggered type is counted automatically. |
| **Guardrails (out / must not touch)** | Does not use or change `account_frozen` (it would freeze paying Business OS customers through the agent platform). Does not switch enforcement on (S-5, G-1). No agent-platform change. Client-facing work is never stopped, only degraded. |
| **Depends on** | Slices 9 and 10. |
| **FRs / ACs** | FR-32. AC-24, AC-32. Also SA-S7, A-15, SQ-15. |

Selling credits (boost purchases, auto top-up) stays in S-4b. This layer only needs a grant to **exist**; selling one does not.

### FR coverage — every FR has a slice

| FR | Slice(s) | FR | Slice(s) |
|---|---|---|---|
| FR-1 | 3 | FR-20 | 10 |
| FR-2 | 3 | FR-21 | 9 |
| FR-3 | 3 (provisional, versioned), 5 (real value) | FR-22 | 10 |
| FR-4 | 1 | FR-23 | 8 |
| FR-5 | 3 (charge), 9 (pre-check estimate) | FR-24 | 6 |
| FR-6 | 3 (storage), 6 and 7 (display) | FR-25 | 6 |
| FR-7 | 3 | FR-26 | 7 |
| FR-8 | 3 (charge), 7 (shown as failed) | FR-27 | 7 |
| FR-9 | 3 | FR-28 | 6, 7 |
| FR-10 | 3 | FR-29 | 6 |
| FR-11 | 2 (per-call figure), 3 (charge built from it) | FR-30 | 11 |
| FR-12a, b, e, f, g, h | 2 (b's flag written in 3) | FR-31 | 11 |
| FR-12c, d | 4 | FR-32 | 12 |
| FR-13 | 3 | FR-33 | 4 |
| FR-14 | 3 | FR-34 | 3 |
| FR-15 | 3 | FR-35 | 3 |
| FR-16 | 3 (log), 4 (detection) | FR-36 | 6 |
| FR-17 | 9 (allowance), 11 (grants) | FR-37 | 5 |
| FR-18 | 3 (period totals), 5 (trial total), 9 (reset in the check) | FR-38 | 3–12 (every slice ships inert in `shadow`) |
| FR-19 | 10 | FR-39 | 6 |

**SA findings by slice:** SA-S12 → 1. SA-S2, SA-S3, N-3 → 2. SA-B1, SA-S1, SA-S8 → 3. SA-S9 → 4. SA-S6, SA-S11, N-8 → 5. SA-S10 → 6. SA-S5 → 7. SA-S4 → 8. SA-B2, SA-B3 → 9. SA-S7 → 12. **SA follow-up (2026-09-28):** SQ-13, SQ-14, SQ-16 → 2. SQ-15 → 3 (and 4, 12). SQ-13 (3) → 4. "Last seen at zero" storage → 9. **C-1** → 1 and 10.

### Old slice names → new numbers

| Old (before 2026-09-28) | New | What moved |
|---|---|---|
| **D-0** Rules, and a trustworthy cost | **1** and **2** | The declared action list → 1; FR-12 and the pricing work → 2 (with the unrounded audit cost and the failed-call fix added) |
| **D-1** Measure | **3** and **4** | Recording the charge in shadow → 3; the operator report and the leak check → 4 |
| **D-1b** Set the credit value and derive the allowances | **5** | Unchanged |
| **D-2** Tell the owner the truth | **6** and **7** | The card → 6; the diary and range → 7 (recommended to release together) |
| **D-3** Behave at zero | **8**, **9** and **10** | Warnings → 8; the balance check and outage behaviour → 9; pause / degrade and the template fallback → 10 |
| **D-4** Operator controls | **11** and **12** | Grants and the per-account view → 11; the lapsed-plan stop and the stranger cap (SA-S7, previously "before D-3") → 12 |

### Superseded slice plan (2026-09-28)

Kept for the record; the SA Review refers to these names. **Superseded by the plan above.**

Six slices. Each ships alone and leaves the product working. **D-0 to D-2 do not depend on G-1 or on enforcement switch-on** — they measure, charge in shadow and tell the truth, which is also the evidence the credit value and the allowances need.

| Slice | Delivers | Why first / notes |
|---|---|---|
| **D-0 Rules, and a trustworthy cost** | The declared action list (audience, setup flag, chargeable, diary label, template-fallback status) as code with a guard test, **and FR-12**: unpriced models fail loudly, a conservative documented fallback exists and flags its rows, every Layer 2-selectable model has a price, image prices resolve. No behaviour change. | Under option B the cost figure **is** the charge, so a silent $0 would charge a customer nothing (A-3). This is also where the *missing* client-facing template fallbacks are found, rather than discovered at the limit. |
| **D-1 Measure** | Per-action-type cost measurement across real accounts and the operator report (FR-33). Charging runs in shadow: the ledger fills at a provisional credit value, nothing is refused, nothing owner-facing moves. | Produces the evidence for **the credit value** and for FR-37's allowances — not for a price list, which option B does not need. Answers OQ-7, OI-1 and UD-1 with numbers instead of argument. |
| **D-1b Set the credit value and derive the allowances** | Fix the credit value as configuration; replace 250 / 500 / 1,000 / 2,000 and every `PLACEHOLDER` cohort quantity with derived figures; record the derivation; update the capability `unit` and the plans doc (FR-37). | A config change, gated by D-1's measurement. Small — but it is the moment the plans stop being invented. |
| **D-2 Tell the owner the truth** | The usage card in credits against the resolved plan allowance, split owner-triggered vs automatic; **the credit diary** (FR-26) and the own-history range (FR-27); the display-only allowance retired from the owner surface. | The first owner-visible change, and the last one that is safe to make before anything can be refused. The diary ships **with** the card: under option B it is not a nice-to-have, it is the whole of the owner's predictability. |
| **D-3 Behave at zero** | The real `balance.ts`, warnings at 80/100%, the setup pre-warning, degrade-vs-pause by audience, the fail-closed/fail-open split, and the relationship to the chat daily budget — all still inert in `shadow`. | Built and reviewable before it can refuse anyone; turns on with the entitlements flag, not with its own. |
| **D-4 Operator controls** | Admin grant / reduce, the per-account position view, and the lapsed-plan stop. | Needed before enforcement is live, or the first exhausted champion is a support ticket with no remedy (D-7). |

---

## 13. Business decisions for the user

| # | Decision | Status | Note |
|---|---|---|---|
| **BD-1** | **What one credit is defined against** | ✅ **DECIDED 2026-09-28 — option B, credits charged at live measured cost.** See [§2](#2-the-currency-decided-bd-1) | Simpler, and cost cannot be predicted per action. Everything after the fact: no stale price to lose money on, nothing to recalculate. Accepted: the same action varies day to day, and support cannot quote in advance — answered by the diary (FR-26) and the own-history range (FR-27) |
| **BD-2** | **Does work the product does on its own — nightly insights, the daily briefing, automatic lead replies — come out of the owner's allowance?** | Agreed in principle: **yes, with its own line, and every instance in the diary** | It is real spend, and an uncounted channel is an uncapped one — but an owner must never watch a balance fall on a day they did nothing without being told why. Under option B the diary answers that per action, not just per month |
| **BD-3** | **Does a new owner's setup — onboarding, the first website and intake generation — come out of their allowance?** | Agreed in principle: **yes, against the trial's one-off total, with a warning before it runs out** (B-12) | UD-1's worry — a new owner opening their dashboard with part of month one already spent — is answered by slice 4's measured number, by FR-23's pre-action warning (slice 8), and by the diary showing exactly what setup cost |
| **BD-4** | **How much is an AI image?** (OQ-7) | ✅ **Settled by BD-1: its actual measured cost** ($0.016–$0.25, A-17) | No per-image price to decide or maintain. The existing per-business daily image cap stays as the abuse guard |
| **BD-5** | **What happens when an owner's allowance is gone** | Agreed in principle: **degrade, don't stop** (D-12) | The owner's assistant pauses; everything touching their clients keeps working on template text. Two conditions: the check **fails closed for the owner's own AI and open for client-facing work** — the opposite of Layer 2's kill switch and of the chat budget, both of which fail open — and a client-facing action may only be degraded once it has template text to fall back to. **Refined by BQ-1 (option C):** during an outage the owner's AI keeps working unless the account was last seen at zero. *(C-1: the lead reply already has its template fallback, so the second condition is met today for the one client-facing action.)* |
| **BD-6** | **What happens to existing balances and history on day one** | Agreed in principle: **start from zero** | History is in tokens, under a rule we are replacing, for a period in which nobody was told they were metered. Leave the agent platform's balances untouched; nothing is double-charged because the two never meet |
| **BD-7** | **When the owner's dashboard changes to the new number** | Agreed in principle: **in slice 6 (was D-2), before anything can be refused**, and only after slice 5 | The number on the card today is measured against an allowance nobody is held to, in a unit we are discarding; making it true is a fix, not a feature |
| **BD-8** | **How much AI cost are we willing to carry per plan per month?** | ⬜ **Pending user input — asked at slice 5**, once slice 4 has real numbers | The one input slice 5 needs. It replaces the 500 / 2,000 the user decided as action counts (SA-S11). BA will bring the measured cost per plan and a suggested figure; the user decides |
| **BD-9** | **Slice format** | ✅ **DECIDED 2026-09-28 (user)** | Slices numbered 1, 2, 3…, each titled by its scope, a few days each, with defined scope and guardrails (§12) |
| **BD-10** | **No new tracking** | ✅ **DECIDED 2026-09-28 (user)** | `runAiAction` is the only place that measures; the audit entry and the charge row come from the same in-memory call list; one new thin table only because the audit trail cannot be the bill (§3, §4) |
| **BD-11** | **When does the owner's usage card refresh?** | ✅ **DECIDED 2026-09-28 (user)** | Three triggers: (a) right after the owner's own AI action finishes, (b) when the owner returns to the tab or page, (c) a small manual refresh icon on the card, with a brief loading state. **No background or timer polling** — automatic work shows on the next refresh (KI-12). Delivered in slice 6 (FR-39, AC-33). Today the card is fetched once on page load (A-18) |

---

## 14. Open questions for SA

- [x] **SQ-1 — Where the ledger lives, and what a row holds.** A new Business OS table, one row per charged action with a unique grouping id, **the credits charged, the measured cost, the credit-value version and the fallback flag** — versus deriving totals from `token_usage` at read time. *BA leaning: a real table.* `token_usage` counts calls, not actions, holds no credits, and cannot express a grant, a period or a reconciliation. The diary (FR-26) also needs a per-action row, not a per-call one. **SA ruling (TECHNICAL):** a real Business OS table, as the BA leans, plus a per-account per-period totals row kept in step in the same transaction. Keyed by a server-minted action id, not the grouping id (SA-B1). Details: SA Review, SQ table. *(Row contents revisited by SQ-15.)*
- [x] **SQ-2 — Idempotency and retries.** Is a unique constraint on the grouping id the whole of FR-9, given that one action legitimately produces several calls and a retry may reuse the grouping id? SA must say what happens when a retry adds calls under an existing id: update the row's total, or append an adjustment row. **SA ruling (TECHNICAL):** no. The grouping id is not one-per-action (onboarding reuses one per conversation; chat takes it from a request header). The idempotency key is an action id minted inside `runAiAction`, one per invocation; the grouping id is stored, indexed, not unique. A retry is a new invocation and a new row; no row is ever updated. See SA-B1.
- [x] **SQ-3 — The write path.** Write the ledger row inside the existing usage scope (non-blocking, confirmed) versus a claim-and-drain job on the §8.1 pattern. *BA leaning: a direct write* — the data is already in hand at the end of the action, and a queue adds a second way to lose a charge. FR-16 then means a failed write is an uncharged action; SA to rule on whether that is acceptable or needs an outbox. **Option B raises the stakes:** an uncharged action is money spent that no balance reflects. **SA ruling (TECHNICAL):** direct write at the end of `runAiAction`, awaited with a short time budget, never throwing. No outbox and no §8.1 queue. Lost writes are found by a ledger-vs-`token_usage` reconciliation in the D-1 report (SA-S9) *(now slice 4)*; a backfill is decided on the measured loss rate.
- [x] **SQ-4 — Reserve-then-settle, or check-then-charge?** *BA leaning: check before, charge after,* accepting a small bounded overspend under a burst. ⚠️ **Under option B the price is not knowable in advance** — a reservation would have to hold a guessed amount and true it up, which is the very machinery the decision avoided. Any SA ruling must account for that: a pre-check can only ask "is there anything left?", not "is there enough for this?". **SA ruling (TECHNICAL):** check-then-charge, no reservation. The pre-check asks only "is anything left?"; overspend is bounded by in-flight actions, recorded, drawn from grants if any, and never carried into the next period.
- [x] **SQ-5 — Cache freshness.** `EntitlementService` caches raw inputs for 30 s. Is a balance resolved through that cache acceptable, or does it need its own read? **SA ruling (TECHNICAL):** already decided by entitlements T-5: metered counters are never cached. The allowance may come from the 30 s snapshot; consumption is read fresh from the period totals row.
- [x] **SQ-6 — The period boundary** (T-6, still undecided): calendar month versus billing anniversary. It decides when a warning resets, when an exhausted account recovers, and what window the diary defaults to. **SA ruling (TECHNICAL, already decided):** not undecided. Entitlements T-6 (SA, 2026-09-19) chose anniversary periods from a per-account `period_anchor`, which exists in code (`account.ts`, `BusinessOsAccountPlanRepository`) and in migration `20261005` (unverified against live). The diary defaults to the current period. Not reopened.
- [x] **SQ-7 — Where the credit value lives, and who owns it.** `system_settings_config` (operator-changeable through a script, beside the Layer 2 area rows), or the entitlements config (engineering-owned, shipped in a release)? *BA leaning: the entitlements config* — it must be versioned with the allowances derived from it (FR-3, FR-37), and a change silently re-prices the whole product. **SA ruling (TECHNICAL):** the entitlements config, versioned with the matrix. Not `system_settings_config`: an operator-editable value that re-prices the whole product is the wrong kind of setting.
- [x] **SQ-8 — Rounding precision and the reconciliation rule** (FR-6). What precision does the ledger store, and how is "the sum of the rounded lines" reconciled with "the rounded sum" so the diary never appears to disagree with the balance? *BA leaning: store at the precision of the cheapest action, display whole credits, and take the balance from the unrounded sum with a documented note.* **SA ruling (TECHNICAL):** store cost from the raw per-call figures (not the audit's micro-dollar-rounded one) at 10 decimal places and credits at 6; round only for display; totals come from unrounded sums, with a one-line footnote on the diary. See SA Review.
- [x] **SQ-9 — The conservative fallback price** (FR-12b). What is "conservative" — the most expensive model in the same family, a fixed per-1k ceiling, or something else — and who signs off the number? **SA ruling (TECHNICAL):** conservative = the highest rate in the in-code price table for the same provider and kind (text, embedding, image), computed from the table rather than typed by hand. SA signs it off at code review. Once D-0 lands *(now slice 2)*, only a defect can reach this path.
- [x] **SQ-10 — A discrepancy to settle before TK-6 is scoped.** The tier-billing plan records F-28 as a live B-8 leak: "`app/api/business-os/usage/route.ts` already reads `user_subscriptions`". At `main` 7ba40a56 it **does not** — the only mention is a comment explaining why it deliberately does not (`route.ts:214-223`), and `usageSummary.ts` reads only `token_usage` and `tokens_per_pilot_credit`. Either F-28 is already closed, or it meant the agent-platform **rate** keys (`pilot_credit_cost_usd`, `tokens_per_pilot_credit`) that the route does read — which FR-36 removes anyway. SA to confirm which. **SA ruling (TECHNICAL):** F-28 was a false positive. `git log -S` shows the string `user_subscriptions` entered `usage/route.ts` only as the explanatory comment (ea35c79d) and was never a query. The route reads the agent-platform rate keys, which FR-36 retires in D-2 *(now slice 6)*. TK-6 should be re-scoped and the tier-billing plan corrected.
- [x] **SQ-11 — Sequencing.** The entitlements plan puts S-3 metering after S-5 switch-on, which is hard-gated on G-1. This requirement proposes D-0 to D-2 ship before that, in `shadow`. Does SA accept the reordering, given that charging in shadow refuses nobody? **SA ruling (TECHNICAL):** reordering accepted, with conditions: D-1's ledger write is proven unable to throw or fail an action; D-2 is hard-gated on D-1b; in `shadow` the 80/100% warnings are recorded, not delivered to owners, until D-1b ships. *(In the new numbering: slice 3's write is proven safe; slice 6 is hard-gated on slice 5; slice 8's warnings are recorded, not sent, in `shadow`. The reordering now covers slices 1–12, all in `shadow`.)*
- [x] **SQ-12 — The scope of FR-12, and `atLimit: 'by_call_site_audience'`.** Is "every model selectable in Layer 2's area settings has a price entry, enforced by a test" the right boundary, or must the whole `ai_model_pricing` / `FALLBACK_PRICING` path be reworked (cache warming, refresh, cached-input rates) before a charge may be derived from it? And is the declared action list (FR-4) the right home for the audience map — is the 16-entry `AiActionType` union the FR-30 inventory, or must that stay per call site? **SA ruling (TECHNICAL):** no full pricing rework. The boundary is SA-S2 and SA-S3: test the code defaults, cite Layer 2's existing unpriced-model gate, and signal "unpriced" to the Business OS resolver rather than changing shared pricing return values. The declared list keyed by `AiActionType` is the right home for audience, setup, charge, label and fallback. That supersedes WC-18's per-call-name inventory for these attributes; `BOS_LLM_CALLS` stays the pricing and attribution inventory.

**New questions from the 2026-09-28 reorganisation** (each with a BA-suggested resolution):

- [x] **SQ-13 — "Right at source" versus SA-S3** (raised by: BA | status: ruled 2026-09-28 | blocks: slice 2 workplan). The user wants the cost fixed at its source so `token_usage`, the audit entry and the charge all agree. SA-S3 says the shared pricing functions must not change what they return, because the agent platform uses them. How does an unpriced Business OS call show up correctly in `token_usage` without changing the shared return values? *BA suggested resolution:* the two do not conflict in practice. Slice 2's price-coverage tests make every code default priced, and Layer 2 already refuses unpriced DB-selected models (DEC-7), so an unpriced call is reachable only through a defect. For that residual case, `token_usage` keeps what we priced but the call carries the price-source signal and is logged at `error`, so it is never **silent**; the conservative price is applied by the Business OS charge resolver. SA to confirm, or to name a way to record the conservative figure in `token_usage` for Business OS calls only. **SA ruling (TECHNICAL):** **confirmed as the BA suggests; SA-S3 stands.** "At source" means the **per-call record** (`UsageCallRecord`, built in the provider) carries the true measurement plus a price-source signal; it does **not** mean `token_usage` carries a Business OS-only figure. Do **not** write the conservative figure into `token_usage`: the write is the shared `aiAnalytics.trackAICall` path used by the agent platform (`baseProvider.ts:124-160`), a product-conditional there is exactly the plugin-/product-specific branch the shared layer must not carry, and `token_usage`'s job (§4) is the provider-invoice check, which an invented figure would break. So the three records agree on every priced call, and on the residual unpriced call (reachable only through a defect after DEC-7 and slice 2's coverage tests) they **disagree visibly**: `token_usage` and the audit entry say what we measured ($0 plus an `error` log), and only the charge row carries the conservative figure with its flag. Three constraints for the slice 2 workplan: (1) the signal is derived **without changing any return value** — a companion read-only lookup over the same table (`pricing.ts:255-269` already knows "no pricing found"), not a new return shape on `calculateCostSync` / `calculateCost` / `resolveImagePrice`; (2) an **absent** signal (any provider other than `openaiProvider`, since `anthropicProvider` / `kimiProvider` are not touched) must **not** be treated as unpriced wholesale — the Business OS resolver re-checks priceability with the same lookup and falls back only when the model is genuinely unpriced, otherwise an operator who points an area at Anthropic (Layer 2 allows it) would be over-charged the class maximum on every call; this refines SA D-0 item 4; (3) slice 4's leak check must treat a fallback-flagged row (charge > `token_usage`) as reconciled-pending, not as a leak. *(BA, 2026-09-28: folded into FR-12h and slices 2 and 4.)*
- [x] **SQ-14 — Storing the unrounded cost in the audit entry** (raised by: BA | status: ruled 2026-09-28 | blocks: slice 2 workplan). SA's D-0 scoping said "no change to the audit `details` schema"; the user now wants the audit entry to stop rounding in slice 2. *BA suggested resolution:* treat it as a precision change to an existing field, not a new shape, so no schema bump in slice 2; slice 3 then bumps to `schema: 2` once, when it adds the action id. If SA judges the precision change to be a schema change, move it into slice 3's single bump instead — the requirement only needs both done before slice 3 records a charge. **SA ruling (TECHNICAL):** **confirmed — a precision change to an existing field, stays `schema: 1`, ships in slice 2.** The field name and type (`estimatedCostUsd: number`, `aiActionAudit.ts:115`) do not change, no reader parses a fixed precision, and the only reader in code is the admin audit-trail page (`app/admin/audit-trail/page.tsx:139,181`); nothing in SQL reads `details->'estimatedCostUsd'`. My D-0 "no audit `details` schema change" meant no new or renamed field; this is neither. Conditions: (1) **do not store the raw float** — the rounding exists to kill float noise (`0.30000000000000004`, comment at `:198`); round to **10 decimal places** instead of 6, matching SQ-8's `numeric(…,10)` for `cost_usd`, which keeps a ~2e-7 embedding non-zero and the noise out; (2) the tests that pin the old rounding change with it (`__tests__/aiActionAudit.test.ts:167-168` asserts the value *is* micro-rounded; `:403` still passes at 10 dp); (3) the admin page formats with `toFixed(6)`, so a 2e-7 entry would still **display** `$0.000000` — AC-29 is verified on the stored value, and SA **permits** (recommends) a one-line precision-aware formatter on that admin page inside slice 2 as a named exception to its "no UI" guardrail (admin-only, no owner surface); (4) entries written before the change stay micro-rounded — no backfill. The `schema: 2` bump stays in slice 3, once, for the action id. *(BA, 2026-09-28: folded into FR-12h, AC-29 and slice 2.)*
- [x] **SQ-15 — The thin charge row** (raised by: BA | status: ruled 2026-09-28 | blocks: slice 3 workplan). The user has decided a thin row (§4, FR-13): action id, account, time, credits, cost, credit-value version, fallback flag, action type, owner / automatic, succeeded / failed. SA's SQ-1 ruling listed a wider row (grouping id, area, the full trigger, tokens, `period_start`). *BA suggested resolution:* area comes from the action type (slice 1 list); the grouping id, the full trigger and tokens are reachable through the action id in the audit entry and `token_usage`; so none is needed on the bill. `period_start` is bookkeeping rather than tracking: if SA needs it on the row to index or rebuild the period totals, it may stay as a derived column. SA to confirm the thin row, with `period_start` as the only possible addition. **SA ruling (TECHNICAL):** **the thin row is confirmed, with three identifier-level changes and no tracking content** — this narrows my SQ-1 row (area and tokens are dropped, as the BA argues: area derives from the action type through the slice 1 list, tokens stay in `token_usage` and the audit entry). (1) **`period_start` is required, not optional**, written at charge time. The totals row is keyed `(user_id, period_start)` and must be rebuildable from the rows (FR-13); recomputing the period from `created_at` would use *today's* `period_anchor` (T-6), so a later anchor change (plan change, Stripe cycle alignment) would silently move old charges into the wrong period. (2) **Keep `group_id`** (indexed, **not** unique — SA-B1). The §4 / Scenario 1 claim that `token_usage` joins "by the action id" is **incorrect as built**: `token_usage` rows carry the grouping id as `session_id` (`usageScope.ts:45-46`) and never the action id, and adding it would be the new tracking the user ruled out. Without `group_id` on the charge row, the only path from a charge to its `token_usage` rows runs through the audit entry, which is lossy (§3 (a)) and archived (§3 (d)) — so a lost audit entry would orphan the charge from its cost detail, and slice 4's leak-check drill-down (SA-S9, "by `session_id`") could not name the leaking group. BA to correct §4 and Scenario 1 step 5 to "joined by the grouping id". (3) **Store the trigger code (`owner` \| `scheduled` \| `external`), not the two-value owner / automatic** — still one short code; "automatic" is derived for display. Slice 12's stranger cap (SA-S7) counts charged **`external`** actions per account per day, and "automatic" merges `external` with the nightly runs; counting by action type instead would silently miss the next stranger-triggered type. Also for the slice 3 workplan: decide the **adjustment-row shape now** (a row kind plus a nullable reference to the adjusted action, or a sibling table) so slice 4 adds rows, not a breaking migration; adjustment rows have their own id and never reuse the adjusted row's `action_id`. The diary reading only the charge table is confirmed (SA-S5). *(BA, 2026-09-28: folded into §4, Scenario 1 step 5, FR-10, FR-13, AC-11, NFR Correctness / Auditability and slices 3, 4 and 12.)*
- [x] **SQ-16 — A failed call that spent tokens is recorded at $0** (raised by: BA | status: ruled 2026-09-28 | blocks: slice 2 workplan). SA N-3 found that `baseProvider.ts:166-176` records a failed provider call at $0 even when the provider billed for it; the user wants this assessed and fixed in slice 2. `baseProvider` is shared with the agent platform. *BA suggested resolution:* where the provider's error response reports usage, record that usage and its cost; where it does not, keep $0 and record it as a known issue (KI-8). SA to confirm that the agent platform's charge is token-based (A-2) and does not read the recorded cost of failed calls, so the fix cannot change what an agent run costs — otherwise the fix is limited to Business OS calls. **SA ruling (TECHNICAL):** **no code change; KI-8 is accepted with SA sign-off, and `baseProvider.ts` is not touched in slice 2.** Verified: (a) **there is nothing to record** — on failure the OpenAI SDK throws an `APIError` carrying `status`, `headers`, `error` (the error body), `code`, `param`, `type` and `requestID`, and **no usage** (`openai/core/error.d.ts:3-17`); `APIConnectionError` / `APIUserAbortError` (timeouts, aborts) carry even less. The provider's accounting of a failed or timed-out generation never reaches us, so "where the error reports usage" is an empty set for the provider Business OS uses, and a fix would be dead code in a shared file. (b) **A-2 confirmed:** the agent platform's charge is token-based and in-memory — `run-agent` passes `executionResult.totalTokensUsed` (`app/api/run-agent/route.ts:372`, `:573`) to `CreditService.chargeTokensWithIntensity`; it does not read `token_usage.cost_usd`. **But** agent-side readers do sum failed-row **tokens** from `token_usage` (`TokenReconciliationService.ts:78`, `updateAgentIntensity.ts:365`), so changing what the shared failure path records would shift agent reconciliation and intensity figures even though no agent charge moves — a second reason to leave it alone. AC-29's "documented as a known issue with SA sign-off" branch applies; this ruling is the sign-off. BA to restate KI-8's status as "accepted — the provider does not report usage on an error (SQ-16)", and add to slice 2's guardrails: no change to the `baseProvider.ts` failure path. Revisit only if a provider Business OS is configured to use starts returning usage on errors. *(BA, 2026-09-28: folded into FR-12h, AC-29, slice 2 and KI-8.)*

### SA correction C-1 (slice 1 workplan review, 2026-09-28)

**Raised by:** SA, reviewing the slice 1 Dev workplan. **A correction of fact, not a reopened decision.** Recorded here by BA and folded into the requirement.

- **The fact:** the lead reply (`lead_reply_recommendation`) **already has a template fallback.** Every failure in `recommendLeadReply` falls back to `pickFallbackCandidate` — a fixed rule, with no AI call (`LeadReplyRecommender.ts`, `leadReplyCandidates.ts`). The model only ever **picks which of the owner's links to send**; it never writes the reply. `LeadAlertService` returns **before** the AI action when there are no candidates, so such a lead makes no AI call and is never charged.
- **What was wrong:** OI-1, slice 1's scope ("recorded as **missing**"), slice 10's scope ("build the missing template fallback") and FR-20 ("this layer builds one") all said the fallback was missing. So did SA's own D-0 scoping, item 2 ("when the model returns nothing, no reply is queued") — **SA's D-0 item 2 is corrected by C-1.**
- **What changes:** slice 1 records the fallback as **`exists`**; FR-20 and slice 10 now **route "balance exhausted" down the existing fallback path the area-switched-off path already uses**, rather than building one; OI-1 is closed. The BA's original wording is kept, marked superseded, where it appeared.
- **What does not change:** no decision is reopened. BD-5 (degrade, don't stop), FR-19 and AC-14 stand; the lead reply still goes out with template text at zero.

---

## 15. Operator questions answered as-built

The user's two queued questions, answered against the code first.

**"Can an admin add or reduce a customer's credit?"** — **No, nowhere, on either side.**
- Business OS: the admin op union has no credit operation (A-14), and nothing counts AI usage, so there is nothing to grant. An admin *can* raise an account's `ai.actions` allowance with `add_override`, but with `ALWAYS_SUFFICIENT` behind `balance.ts` (A-10) the value has no effect.
- Agent platform: no admin route writes a balance (A-14). A Pilot-Credit balance moves only by the signup grant, an agent-run charge, or a Stripe purchase (`CreditService.ts:30-82`, `:444`).
- **The gap is FR-30 (grant / reduce, audited) and FR-31 (read the position)** — slice 11. It is needed before enforcement, not after: the champion policy is literally "when they hit the cap, an admin grants credits" (D-7), and that path does not exist.

**"Is there a subscription-expiry lock?"** — **Half of one, and it fails open (A-15).**
- Agent platform: `checkExecutionAllowed` blocks an agent run on `account_frozen` or insufficient balance, but returns `allowed: true` on any DB error or a missing subscription row; and the cron that would set `account_frozen` is not scheduled, so in practice nothing freezes.
- Business OS: the lifecycle (trial → grace → paused) and per-account expiry exist and resolve correctly, but the mode is `shadow`, so an expired account is refused nothing (A-13).
- **The gap is FR-32** (slice 12): an expired Business OS plan must stop owner-facing AI through the entitlements lifecycle — explicitly **not** by reusing `account_frozen`, which is an agent-platform flag also read by agent generation and would freeze a paying Business OS customer.

---

## 16. Out of scope

| Item | Where |
|---|---|
| Boost purchase, auto top-up, add-ons, annual pricing | S-4b |
| Enforcement switch-on and G-1 key rotation | S-5 |
| Reconciling our cost figure against the provider's invoice; cached-input and batch rates | Follow-up. FR-12 removes silent $0 and flags a guessed price; it does not claim our figure equals OpenAI's bill |
| Any change to Pilot Credits, `CreditService`, `pricingConfig` or the agent charge path | Forbidden here (A-11); retirement is WS-3 |
| SMS metering and email fair-use | Same mechanism, later — a credit extends to them |
| An all-businesses usage overview | Layer 1.1 F-2 |
| Making AI audit entries durable (Layer 3 KI-B / OI-D) | Separate; FR-15 removes the billing dependency on it |
| A backfill of charges missed by the leak check | Decided after slice 4 measures the loss rate (SQ-3, N-7) |
| Any second tracking mechanism | Out by the user's reuse decision (§3, BD-10) |
| Background or timer polling of the usage card | Out by BD-11 (FR-39) |
| Recording usage for a failed provider call | Out by SQ-16 — the provider reports none on an error (KI-8) |

---

## 17. Known issues and open items

| Id | Description | Status |
|---|---|---|
| **KI-1** | **The same action costs different amounts on different days**, and support cannot quote a price in advance. Accepted with BD-1; mitigated by the diary (FR-26) and the own-history range (FR-27) | **Accepted by the user, 2026-09-28** |
| **KI-2** | A fallback-priced charge (FR-12b) is a **deliberate over-estimate**, so an owner can be charged slightly more than we actually paid until it is reconciled. Flagged, counted and reconciled — never silent | Accepted; watch the count |
| **KI-3** | The image reuse cache means the ledger charges **generations**, not requests; a repeated request is free and absent from the diary. Consistent with FR-7, but anyone auditing image spend must know it | Informational (Layer 1.5 KI-B) |
| **KI-4** | Two dormant action types (`website_section_field_rewrite`, `website_block_enrichment`) have no production trigger. They must be declared and given a diary label anyway, or they arrive unlabelled the day they are wired | Declared in slice 1 (was D-0) |
| **KI-5** | A small bounded overspend is possible under a concurrent burst (SQ-4), and under option B a pre-check cannot know what the next action will cost | Accepted (SA ruling SQ-4): shown as 0, never carried into the next period (§5) |
| **KI-6** | Chat v2 and v1 are outside the call catalog and choose their own model; their spend is not in the eight areas and so is not chargeable by FR-4 | Pre-existing (Layer 2); state it, do not fix it here. The slice 4 leak check will show it as uncharged spend if any Business OS account uses them |
| **KI-7** | An image is priced as `high` when the provider reports no quality (Layer 1.5 KI-E), so its recorded cost is an upper bound. Under option B that upper bound is **charged**; frequent warnings mean owners are being charged conservatively | Informational; watch the warning count |
| **KI-8** | A failed provider call is recorded at $0 (`baseProvider.ts:166-176`), so a failure the provider billed anyway is not charged (SA N-3). **The provider reports no usage on an error** — the OpenAI SDK's `APIError` carries no usage, and timeouts / aborts carry less — so there is nothing to record. `baseProvider.ts`'s failure path is not changed | **Accepted with SA sign-off (SQ-16, 2026-09-28)** — revisit only if a provider Business OS uses starts returning usage on errors. *(Superseded status: "Assessed and, where the provider reports usage, fixed in slice 2 (SQ-16); any residue stays accepted".)* |
| **KI-9** | **Cached input is priced at OpenAI's half rate for OpenAI calls** — `openaiProvider.ts` (`calculateCost`, `:552-571`) already does this — and at the full input rate for other providers, where those are charged slightly more (conservative). *(Superseded description, stale per SA follow-up: "Provider-cached input tokens are charged at the full input rate (`cachedInputTokens` is recorded but not priced), so the owner is slightly over-charged — conservative (SA N-4)".)* | Accepted; restated 2026-09-28. Cached-input pricing for other providers is out of scope (§16) |
| **KI-10** | The AI audit trail is lossy by design and is archived by the Admin Archiving module, so it can never be the bill (§3). Anyone comparing audit entries with charges will occasionally find an audit entry missing | Informational; the charge table is authoritative for money |
| **KI-11** | If slice 6 (card) reaches owners before slice 7 (diary), owners see a falling number with no per-action explanation | BA recommends releasing 6 and 7 together (§12) |
| **KI-12** | *(added 2026-09-28)* With no background polling (BD-11), work that runs automatically while the owner's page is open — the nightly insight run, the briefing, a lead reply — does not appear on the card until the next refresh (the owner's own action, a return to the tab, or the refresh icon) | **Accepted by the user, 2026-09-28** (BD-11) |
| **OI-1** | Client-facing actions with **no** template fallback are found in slice 1 and built in slice 10 (was: found in D-0, built in D-3). Until then, FR-20 cannot be satisfied for them | ✅ **Closed by C-1 (SA, 2026-09-28):** there is none. `lead_reply_recommendation` already falls back to `pickFallbackCandidate` on every failure; slice 1 records it as `exists`, and slice 10 routes "balance exhausted" down that path. *(Superseded status: "Open; `lead_reply_recommendation` is the known one".)* |
| **OI-2** | The credit value, every allowance in the tier matrix and every `PLACEHOLDER` in `cohorts.ts` are guesses until slice 5 (was D-1b) (FR-37) | Open by design; needs BD-8 |
| **OI-3** | Correct F-28, TK-6, H-10 and E-3 in `BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` (SA N-1, SQ-10) | Open — BA follow-up, not a slice |
| **OI-4** | The D-0 Dev workplan (`docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md`) is superseded by the reorganisation and will be redone for slice 1 (and separately for slice 2) | Open — Dev |
| **OI-5** | *(added 2026-09-28)* Where the "last seen at zero" fact for BQ-1 option C is kept, so it is readable when the balance is not, and a cold instance with no memory keeps working (SA follow-up) | Open — owed by the slice 9 workplan |
| **Closes** | Q1 (what a credit represents) and OQ-7 (images) by BD-1; Q6 (do failed attempts count) by FR-8 — **yes, at what was actually spent**; OI-1 (background work on the card) and UD-1 (onboarding in a new owner's first month) by BD-2, BD-3 and the diary | Resolved, pending SA review |

---

## 18. Notes on integration points

| Area | Files |
|---|---|
| The action wrapper and the declared list | `lib/business-os/llm/aiActionAudit.ts` (`AiActionType` `:38-54`, the per-action summary `:179-218`, `runAiAction` `:267-293`), `lib/ai/usageScope.ts` |
| The catalog of areas and calls | `lib/business-os/llm/callCatalog.ts:37-84` |
| Cost, and FR-12 | `lib/ai/pricing.ts` (`calculateCostSync` `:250-275`, `FALLBACK_PRICING`; the "no pricing found" branch `:255-269` that the read-only price lookup mirrors, SQ-13), `ai_model_pricing`, the Layer 1.5 per-image prices in `system_settings_config` |
| Failed-call cost (FR-12g, SQ-16) | `lib/ai/providers/baseProvider.ts:166-176` (**not changed** — SQ-16), `lib/ai/providers/openaiProvider.ts` (cached input at half rate `:552-571`, KI-9) |
| Audit-entry rounding (FR-12g, SQ-14) | `lib/business-os/llm/aiActionAudit.ts:199`; the admin audit-trail cost formatter `app/admin/audit-trail/page.tsx:139,181` (slice 2's one UI exception) |
| Charge ↔ cost detail link (SQ-15) | `token_usage.session_id` = the grouping id (`lib/ai/usageScope.ts:45-46`); calls excluded from a scope `:58-59` (slice 4 leak check) |
| Layer 2 area settings (which models an operator can select) | `lib/business-os/llm/modelSettingsPolicy.ts`, `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` |
| The seam, the resolver and the allowances | `lib/business-os/entitlements/balance.ts`, `EntitlementService.ts`, `config/catalog.ts:293-305`, `config/tierMatrix.ts`, `config/cohorts.ts` |
| The three records (§4) | `token_usage` (shared with the agent platform — read only, never changed by this layer); `audit_trail` (AI entries written by `runAiAction`, archived by the Admin Archiving module); the new charge table and per-period totals (Business OS-owned, server-write-only, never purged — SA names them) |
| Admin operations | `lib/business-os/entitlements/adminOps.ts`, `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` |
| Owner surface (card and diary) | `app/api/business-os/usage/route.ts`, `lib/business-os/usage/usageSummary.ts`, `components/business-os/UsageCard.tsx` (today fetched once on page load, A-18; refresh triggers per FR-39), `lib/business-os/LanguageContext.tsx` (diary labels) |
| Existing guards to relate to, not replace | `lib/business-os/bizql/telemetry/ChatBudget.ts`, `lib/services/GeneratedImageService.ts:170-183` |
| Where the pre-check lands (slice 9) | `runAiAction`; chat-v4 account set late (`chat-v4/route.ts:433`); `enforcementPoints.ts` |
| Stranger-triggered spend (slice 12) | `LeadAlertService.ts:344-345`, `:361-366` |
| The lead-reply template fallback (C-1, slice 10) | `LeadReplyRecommender.ts` (`recommendLeadReply`), `leadReplyCandidates.ts` (`pickFallbackCandidate`), `LeadAlertService.ts` (returns before the AI action when there are no candidates) |
| Deliberately untouched | `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/route.ts`, `user_subscriptions`, `credit_transactions`, `billing_events`, the `baseProvider.ts` failure path (SQ-16) |
| Data lifecycle registration | `purge/descriptors.ts`, `accountDeletionPolicy.ts` (SA-S8) |
| Documents this layer answers to and changes | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §11, `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.2 (S-3), `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (credit value and allowances, FR-37), `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` §E, §K |

---

## SA Review (2026-09-28)

> **BA note (2026-09-28, after the review):** this review is preserved as written. It uses the numbering in force at the time. Section references: §11 → now §14, §13 → now §16, §14 → now §17. Slice references: D-0 → slices 1 and 2; D-1 → slices 3 and 4; D-1b → slice 5; D-2 → slices 6 and 7; D-3 → slices 8, 9 and 10; D-4 → slices 11 and 12 (full mapping in §12). The "D-0 scoping for the Dev workplan" below now splits across slices 1 and 2, with two user-driven changes: the declared list is co-located on `AiActionType` rather than in a separate module (slice 1), and the audit entry's unrounded cost plus the failed-call fix are added to slice 2 (SQ-13, SQ-14, SQ-16).
>
> **BA note (2026-09-28, later):** the failed-call fix was not made — SQ-16 ruled no code change (KI-8). Item 2 of the "D-0 scoping" below is **corrected by C-1** (§14): the lead reply already falls back to `pickFallbackCandidate`, so it is recorded as `exists`, not `missing`. The review text itself is unchanged.

**Reviewed by SA — 2026-09-28**, against worktree `feature/business-os-credit-deduction` @ 7120adee (main 7ba40a56).
**Status:** 🔄 **APPROVED WITH CONDITIONS**

BD-1 (option B) is a fixed input and is not reopened here. Everything below is reviewed within it.

### Verdict in one paragraph

The shape is right. The grain is `runAiAction`, the ledger is new and belongs to Business OS, Pilot Credits are left alone, the audit queue is not the billing record, and the layer ships in `shadow` behind the existing mode. All of that is architecturally sound, and it matches the entitlements SA decisions (T-5, T-6, T-9, WC-18). **Three findings block later slices, not D-0.** The ledger's uniqueness key is wrong for today's code (SA-B1). The fail-closed rule contradicts an approved SA decision and the code that already ships (SA-B2). And "no call-site changes" understates D-3 (SA-B3). **D-0 may go to a Dev workplan now** under the scoping below. The requirement must absorb SA-B1 to SA-B3 before the D-1 and D-3 workplans are written.

### Verified as-built (spot checks)

| Claim | Result |
|---|---|
| A-7 `runAiAction` / 16 action types | ✅ `aiActionAudit.ts:38-54`, `:263-293`. **It is wired at 16 call sites.** The file header still says "NOT WIRED YET … nothing calls `runAiAction` in production", which is stale (SA-S12) |
| A-10 `ALWAYS_SUFFICIENT` | ✅ `balance.ts:45-49`. `EntitlementService.check` consults it only for metered capabilities, and **fails open on a balance error** (`EntitlementService.ts:178-184`) |
| A-3 unpriced → $0 | ✅ `pricing.ts:267-269` (sync) and `:229-230` (async). Image: `GeneratedImageService.ts:117`. **But A-3 overstates the risk.** Layer 2 already refuses an unpriced or zero-priced model at settings refill (`modelSettings.ts:36-38`, `checkTokenModel` `:304-305`, `checkImageModel` `:314-327`, DEC-7). The residual holes are narrower (SA-S2) |
| A-9 allowances | ⚠️ Partly stale. There are **two** tiers (`basic` 500, `pro` 2,000 — `tierMatrix.ts:127-129`, `:196`, **"the only one the user has decided"**). Champion now **reads the pro row** (`cohorts.ts:100`), and trial is a one-off `total: 250` (`cohorts.ts:138`). There is no 1,000 and no "four plans" (SA-S11) |
| A-11 / SQ-10 F-28 | ✅ The route never queried `user_subscriptions`. See the SQ-10 ruling |
| A-17 image range | ⚠️ The lower bound is $0.011 (`gpt-image-1:1024x1024:low`, `SystemConfigRepository.ts:69`), not $0.016 |
| `period_anchor` (T-6) | Present in `lib/business-os/entitlements/account.ts`, `BusinessOsAccountPlanRepository.ts` and `supabase/migrations/20261005_business_os_entitlements.sql`. **Unverified against live** |
| Logging debt | `pricing.ts`, `usageScope.ts`, `baseProvider.ts`, `openaiProvider.ts`, `GeneratedImageService.ts` and `aiActionAudit.ts` have **0** `console.*` calls. `anthropicProvider.ts` has 7 and `kimiProvider.ts` has 2, so D-0 must not need to touch them |

### SQ rulings

All twelve are **TECHNICAL**. The reasons are summarised here; the one-line rulings are also appended inline in §11.

| SQ | Ruling | Reason |
|---|---|---|
| **SQ-1** Ledger | A new Business OS table with one row per charged action, **keyed by a server-minted `action_id`** (SA-B1). It carries: `user_id` (FK `auth.users`), `group_id` (indexed, not unique), area, action type, trigger, outcome, `cost_usd`, `credits`, credit-value version, fallback flag, tokens, `period_start` and `created_at`. Reconciliations (FR-12d) are **separate adjustment rows** that point at the original. It also needs a **per-`(user_id, period_start)` totals row**, updated in the same transaction, so the pre-check is O(1). Grants (D-4) get their own table with the T-9(2) fields | `token_usage` is per call and holds no credits, grants, periods or reconciliations. T-6 already specifies usage "stored per `(account, period_start)`". Immutable action rows plus a maintained total give both the diary and a cheap balance |
| **SQ-2** Idempotency | The grouping-id constraint is **not** sufficient, and it is also **wrong**. Each `runAiAction` invocation mints one `action_id`, and the write is `ON CONFLICT (action_id) DO NOTHING`. A retry that made new calls is a new invocation, so it gets a new row. **Nothing is ever updated in place** | A charge is written once per invocation, in-process. The only duplicate risk is the write itself being retried, which `action_id` covers. See SA-B1 for why the grouping id cannot be the key |
| **SQ-3** Write path | A **direct write** at the end of `runAiAction`, through a repository and one RPC. It is awaited with a short time budget (the workplan proposes the figure, ≤ 2 s) and never throws or rethrows. It is a failure only when it logs `error` with account, area, action type, grouping id and action id. **No outbox and no §8.1 drain** | The data is in hand at that point, and the write lands after seconds of LLM work, so a few tens of ms is immaterial. Fire-and-forget is not an option on serverless: a frozen function loses it, exactly as it does for Layer 3 KI-B. `token_usage` is already an independent durable record of every call, so a reconciliation (SA-S9) detects any lost write without building a second queue. Decide on a backfill once D-1 has measured the loss rate |
| **SQ-4** Reserve vs check | **Check-then-charge.** The pre-check asks "is remaining > 0?" (allowance + live grants − consumed). There is no reservation. Overspend is recorded. It draws from grants when there are any, is shown as 0 remaining (never negative), and is **not** carried into the next period | Under option B the price cannot be known in advance, so a reservation would reintroduce the price list BD-1 rejected. The overspend is bounded by the actions in flight, and the worst single action (a high-quality image, ≈ $0.25) is known. Carrying no debt mirrors no roll-over (B-6) |
| **SQ-5** Cache | The **allowance** may come from the 30 s snapshot. **Consumption is always read fresh** (from the totals row) | Already decided: entitlements T-5, "metered counters are never cached". The stale-snapshot rule for `owner`/`mixed` capabilities (`EntitlementService.ts:150-162`) still applies |
| **SQ-6** Period | **Already decided (T-6):** anniversary periods from `period_anchor`. The diary defaults to the current period | SA ruled it on 2026-09-19 (entitlements §21.1). It matches Stripe's billing cycle in Slice 4 and needs no reset cron. The requirement's "still undecided" is incorrect and should be amended |
| **SQ-7** Credit value | **In the entitlements config (code)**, versioned with the matrix version. Each version carries its value, derivation and date. Ledger rows record the version | FR-3 and FR-37 tie it to the allowances derived from it. An operator-editable row would silently re-price the product with no release and no review. It also means AC-2's "audit entry" is the versioned config record plus its PR, not an `audit_trail` row (SA-S6) |
| **SQ-8** Precision | `cost_usd` is summed from the **raw per-call `costUsd`** and stored as `numeric` with 10 decimal places. `credits` is `numeric` with 6. **Never** derive cost from the audit's `estimatedCostUsd`, which is rounded to a micro-dollar (`aiActionAudit.ts:199`): a plan-cache lookup embedding costs ~1e-7 USD and would round to 0. Round only at display. Used and remaining come from unrounded sums. Diary lines are rounded individually, and the period total is shown once from the unrounded sum, with a one-line footnote ("lines are rounded; the total is exact") | Summing rounded lines cannot be made to equal the rounded sum in general. The honest rule is one exact total and a stated footnote. Whether lines show whole credits or one decimal depends on the credit value D-1b picks: at ≈ $0.001, a p50 chat turn is ≈ 0.6 credit (see Note N-8) |
| **SQ-9** Fallback | "Conservative" means the **highest rate in the in-code price table for the same provider and the same kind** (text, embedding, image), **computed** from the table rather than hand-typed. It lives in the pricing module with its derivation, is flagged on the row and logged at `error`. SA signs it off at code review | After D-0, this path is reachable only through a defect: Layer 2 refuses unpriced models, and the D-0 test covers every code default. So the rule should never lose money and never go stale; it does not need to be tuned. A computed maximum cannot drift behind the table |
| **SQ-10** F-28 | **F-28 is a false positive, so TK-6 is already closed on the read side.** `git log -S user_subscriptions -- app/api/business-os/usage/route.ts` returns one commit (ea35c79d), and in it the string arrives inside the explanatory comment at `:214`. It was never a query. The route does read the agent-platform **rate keys** (`pilot_credit_cost_usd` `:122/:129`; `tokens_per_pilot_credit` in `usageSummary.ts:195`), and FR-36 removes those in D-2 | BA to correct F-28, TK-6 and H-10 in `BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` (re-scope TK-6 to "retire the rate-key reads, delivered by D-2"). The other Business OS mentions (`accountDeletionPolicy.ts:94-107`, `purge/descriptors.ts:337-340`) are data-lifecycle policy, not billing reads |
| **SQ-11** Sequencing | **Accepted**, with three conditions: (1) the D-1 ledger write is proven unable to throw into, delay beyond its time budget, or change the result of any action (the WC-21 standard); (2) **D-2 is hard-gated on D-1b** (SA-S10); (3) in `shadow`, the 80/100% warnings are recorded and logged but **not delivered to owners** until D-1b's allowances ship | Shadow refuses nothing, so metering first produces the measurement S-5 needs anyway. But D-1 puts a DB write in the path of every production AI action, so "no behaviour change" has to be proven, not assumed |
| **SQ-12** FR-12 scope; audience home | **No full pricing rework** (no cache warming, refresh or cached-input rates). The boundary is SA-S2 and SA-S3. The **declared list keyed by `AiActionType`** is the right home for audience, setup flag, chargeable, diary label and fallback status. Audience is uniform per type today: `lead_reply_recommendation` is client-facing and every other type is owner-facing. This supersedes WC-18's per-call-name inventory **for these attributes only**, and `BOS_LLM_CALLS` stays the attribution and pricing inventory. `atLimit: 'by_call_site_audience'` then resolves through that list | Under option B, cost is per call but behaviour at the limit is per action, so each fact lives at its own grain. WC-18's "embedding calls do not count" is also superseded, because their cost is charged (N-2) |

### Business question for the user (BQ-1)

This is the only item that needs the product owner. It comes out of SA-B2, not out of an SQ.

> **When our record of how much AI a business has used is briefly unreachable (a database hiccup, usually seconds to minutes), what should the owner's own AI assistant do?**
> - **A. Pause it.** We never give away AI we can't count, but every owner loses their assistant during any hiccup, including owners with plenty of credit left. (This is what BD-5 currently says.)
> - **B. Keep it working, and charge afterwards.** Nobody is interrupted. The usage is still recorded when the database recovers, so almost nothing is given away. An owner who had already run out could get a few extra answers during the hiccup. (This is what SA decided for entitlements before option B, and what the code does today.)
> - **C. Keep it working for owners we last saw with credit left, and pause only owners we last saw at zero.** It behaves like B for almost everyone and like A for the few who were already out.
>
> **SA recommendation: C.** Under option B every action is charged after it runs anyway, so a hiccup costs us almost nothing. Pausing every owner's assistant for a hiccup that is our fault is the worse customer experience. Client-facing work keeps running under all three options.

> ✅ **DECIDED 2026-09-28 by the user: option C.** When the balance cannot be read, the owner's own AI keeps working unless the account was last seen at zero; then it gets the retryable `entitlement_unavailable` outcome (SA-B2), never "out of credits". SA-B2 is to be folded in on this basis before the D-3 workplan.

**Heads-up, not a question yet:** D-1b will need one business input from the user, **the AI cost we are willing to carry per plan per month**. It replaces the 500 / 2,000 the user already decided as action counts (SA-S11). That is asked when D-1's numbers exist, not now.

### Findings

#### Blocking (must be folded into the requirement before the named slice's workplan; none blocks D-0)

| # | Finding | Blocks |
|---|---|---|
| **SA-B1** | **The grouping id is not one-per-action, so it cannot be the ledger's unique key.** (a) `onboarding_turn` uses `currentState.attributionGroupId` (`app/api/onboarding/chat/route.ts:224`), which is minted **once per conversation** and persisted (`OnboardingConversationManager.ts:2159`, `:2172-2177`). A unique constraint would therefore charge the first onboarding turn and silently drop every later one. (b) `chat_turn` uses `turnId = incomingCorrelationId` when it is a UUID (`chat-v4/route.ts:392`), which is **client-supplied**. Under FR-9's "replay writes no second row", a client that resends one header gets **every chat turn free**. **Fix:** make the idempotency key an `action_id` minted inside `runAiAction` per invocation. Keep `group_id` stored and indexed but not unique. Amend FR-9, FR-13, NFR Correctness, AC-8 and AC-28. To keep ledger↔audit joins exact, the D-1 workplan should also add the `action_id` to the audit details (a `schema: 2` bump), because a grouping id can now map to several audit entries | D-1 |
| **SA-B2** | **FR-21 / AC-15 contradict an approved decision and shipped code.** Entitlements **T-3(d)** says "Metered AI pre-check: **fail open**", and `EntitlementService.check` does exactly that (`:178-184`). `ai.actions` is audience `mixed` in the catalog (`catalog.ts:293-305`), so the catalog-driven failure policy (WC-10) cannot tell owner-facing from client-facing on its own. **Fix:** after BQ-1 is answered, state that FR-21 supersedes T-3(d) for this capability. Resolve the audience per action type from the FR-4 list, not from the catalog. Make any refusal on an unreadable balance the retryable `entitlement_unavailable` outcome, **never** "out of credits" and never an upgrade prompt. Update the comment and the catch block in `EntitlementService` in the same change | D-3 |
| **SA-B3** | **FR-17 "No call site changes" is untrue.** No AI call site asks the entitlement resolver anything today: `ENFORCEMENT_POINTS` is empty on purpose (`enforcementPoints.ts`), and no production code calls `EntitlementService.check` for `ai.actions`. `ALWAYS_SUFFICIENT` removed the *interface* migration, not the *wiring*. **Fix:** D-3 adds the pre-check in **one** place, `runAiAction`, before `fn` runs, using the action type → audience list. That needs the account known up front, and chat-v4 is the one site that sets it late (`h.setAccount(user.id)`, `chat-v4/route.ts:433`), so it must be restructured. Register the gate in `ENFORCEMENT_POINTS` (its test enforces the truth). The pre-check must be unable to throw in `shadow` (WC-21) | D-3 |

#### Should-fix

| # | Finding |
|---|---|
| **SA-S1** | **FR-7 / AC-6: a plan-cache hit is not free.** The lookup embedding is itself a paid call inside the turn (`PlanCache.ts:233`, `plan_cache_lookup_embedding`). Restate this as "charged exactly what it spent; a plan-cache hit costs only its lookup embedding (a small non-zero fraction)". The image reuse cache really does make no call, so it is 0 |
| **SA-S2** | **FR-12e / AC-3: "every model an operator can select" cannot be enumerated.** The model is a free-text field, and Layer 2 already refuses unpriced or zero-priced ones at refill (DEC-7). Restate it as a test that every **code default** is priced > 0 in the in-code tables: `BOS_LLM_CALL_POLICY` defaults, `IMAGE_GENERATION_CONFIG_DEFAULTS.model` × every configured size × low/medium/high, and the default embedding model behind the excluded chat calls (input > 0). Cite the DEC-7 gate as the runtime guarantee for DB-selected models. The residual holes are: an excluded call's model, a model priced only in the DB when a cold instance's pricing load failed, and a new call site outside Layer 2 |
| **SA-S3** | **The FR-12 fallback must not change shared pricing return values.** `calculateCostSync`, `calculateCost` and `resolveImagePrice` serve the agent platform too. Instead: an optional price-source signal on `UsageCallRecord` (set by `openaiProvider` for tokens, and from `ImagePriceSource` for images), and the **Business OS charge resolver** applies the conservative price and flags the row. Promoting the existing log level in `pricing.ts` to `error` is acceptable, because it changes the level only and the file is already on Pino. `token_usage` keeps recording what we priced |
| **SA-S4** | **FR-23 / AC-17: "a setup action that *would* exhaust" cannot be known under option B.** State the estimate's source: the action type's D-1-measured p90 (or the owner's own history once there is enough). It is used for the warning only and is never the charge |
| **SA-S5** | **FR-26: the diary must read the ledger, not "the same per-action record as the audit entry".** The audit is lossy (A-8), and a diary that disagreed with the balance would break FR-26's reconciliation rule |
| **SA-S6** | **AC-2:** the credit value lives in code config (SQ-7), so "writes one audit entry" becomes: the version record carries value, before/after, date and derivation; the ledger rows carry the version; and the process logs the active version at start-up |
| **SA-S7** | **Strangers can spend an owner's allowance.** `lead_reply_recommendation` runs on a public enquiry (`trigger: 'external'`, `LeadAlertService.ts:344-345`). Under `enforce`, a form-spammer could exhaust the allowance and pause the owner's own AI. Before enforcement (D-3), add a per-account daily cap on charged `external` actions, like the image cap. Past the cap, the lead reply degrades to template text, which is the client-facing path that exists anyway |
| **SA-S8** | **Standards the new tables must meet (WC-3, WC-4, WC-7, WC-8, WC-9, tenant-isolation):** Business OS-namespaced names with an FK to `auth.users(id)`; RLS owner-SELECT only with no user write policy (the money-table lockdown); repository-only access, with `.eq('user_id', …)` on reads and a documented reason for each `supabaseServer` use; any RPC is `SECURITY INVOKER` if possible, otherwise `REVOKE EXECUTE … FROM public, anon, authenticated`, with `search_path` pinned; the account id always comes from `runAiAction`'s server-derived spec, never a body; registered in `purge/descriptors.ts` (never-purged) and `accountDeletionPolicy.ts` (verdict); grant rows store the actor, reason, `created_at` and `expires_at` themselves, and the admin audit is flushed before responding |
| **SA-S9** | **Scope leakage is uncharged spend.** A call is left out of a usage scope if it carries a different `sessionId` or finishes after the scope closes (`usageScope.ts:108-124`), so it never reaches the ledger. The D-1 report (FR-33) must include a **ledger-vs-`token_usage` reconciliation** per account and period (features `business-os-*`, by `session_id`). The same check catches FR-16's failed writes |
| **SA-S10** | **D-2 must not ship before D-1b.** Otherwise the owner's card shows placeholder allowances converted to credits. In `shadow`, warnings are recorded but not delivered to owners until D-1b ships (SQ-11 condition 3) |
| **SA-S11** | **A-9 / FR-37 correction.** 500 (basic) and 2,000 (pro) were **decided by the user** as action counts (`tierMatrix.ts:127-128`). Champion reads the pro row, and trial is a one-off 250. FR-37 replaces a user decision, so D-1b needs the user's sign-off on the per-plan target cost (the heads-up above). Keep the capability **id** `ai.actions` (admin overrides in the DB reference it) and change only its `unit` and labels |
| **SA-S12** | `aiActionAudit.ts`'s header says "NOT WIRED YET"; it is wired at 16 sites. Fix it in D-0, which touches the file's neighbourhood |

#### Notes

- **N-1** SQ-10: F-28 is closed on the read side. BA to correct the tier-billing plan (F-28, TK-6, H-10, E-3).
- **N-2** WC-18's "embedding calls do not count" was written for a flat count. Under option B their (tiny) cost is charged.
- **N-3** A failed provider call is recorded at $0 (`baseProvider.ts:166-176`). "Charged what was spent" therefore means *what we measured*: a failure the provider billed anyway (for example, a timeout after generation) is not charged. Accept it and add it to §14 as a KI.
- **N-4** Provider-cached input tokens are charged at the full input rate (`cachedInputTokens` is recorded but not priced). The owner is slightly over-charged, which is conservative. Add it to §14 as a KI; it is already out of scope in §13.
- **N-5** `calculateCostSync` never re-checks the 1 h pricing TTL, so a price can be stale but is never $0 once loaded. Acceptable.
- **N-6** A-17's lower image bound is $0.011.
- **N-7** No `durable-queue-drain` work is needed while nothing drains a table. If a backfill job is ever added after SA-S9's measurement, it follows §8.1.
- **N-8** For D-1b: pick a credit value that makes a typical chat turn at least 1 whole credit. At ≈ $0.001 a p50 chat turn is ≈ 0.6 credit, so whole-credit display would show "0" or "1" for most of the diary.

### D-0 scoping for the Dev workplan

**D-0 is well-scoped enough to start now**, once the workplan applies SA-S2, SA-S3 and SA-S12. It is pure code and tests: no migration, no DB, no UI, and no runtime behaviour change.

**The workplan must include**

1. **The declared action list** as one typed module in `lib/business-os/llm/`, next to `aiActionAudit.ts`. It is a `Record<AiActionType, …>` with `satisfies`, and for every type it declares: area, audience (`owner` \| `client`), setup flag, chargeable, a diary-label key (en/he/es, following the catalog's label pattern) and template-fallback status (`exists` \| `missing` \| `n/a`). It must be impossible to add a type without an entry. Because `next build` ignores type errors, a **Jest guard test** enforces this, and the file sits inside the `typecheck:bos-llm` gate. The two dormant types (KI-4) are included.
2. **The fallback inventory.** `lead_reply_recommendation` is recorded as `missing`: when the model returns nothing, no reply is queued (`LeadAlertService.ts:361-366`). Record it; **do not build it** (that is D-3 / OI-1).
3. **Price coverage tests** (SA-S2): every code default is priced > 0, and every image default × size × quality resolves > 0. Reference the existing DEC-7 tests rather than duplicating them.
4. **The unpriced signal** (SA-S3): an optional, product-agnostic field on `UsageCallRecord`, set in `openaiProvider` (token path and image path). Absent means "unknown" and is treated conservatively by the Business OS resolver. `anthropicProvider` and `kimiProvider` are **not touched**, because both carry `console.*` debt.
5. **The conservative-price function and the flag** (SQ-9) as a **pure** Business OS function that nothing calls yet (D-1 wires it), with unit tests: a priced call passes through, an unpriced text call is charged the class maximum and flagged, an unpriced image likewise, and the `error` log names provider, model, area, action type and grouping id.
6. Optionally, raise the unpriced log level in `pricing.ts` from `warn` to `error`. This is level-only.
7. Fix the stale header in `aiActionAudit.ts` (SA-S12).

> **BA note (2026-09-28):** item 2 above is **corrected by SA's C-1** (§14): `lead_reply_recommendation` already falls back to `pickFallbackCandidate` on every failure, so slice 1 records it as `exists`. Item 4's "treated conservatively" is refined by SQ-13 (2): an absent signal is re-checked against the price table, not assumed unpriced. The SA text above is unchanged.

**The workplan must avoid**

- Changing what `calculateCost`, `calculateCostSync` or `resolveImagePrice` **return**, or changing what `token_usage` records.
- Hand-typed fallback prices: they are computed from the table.
- Putting audience into the entitlements catalog, or renaming the `ai.actions` id.
- Any change to `runAiAction`'s behaviour, the audit `details` schema, `balance.ts`, `EntitlementService`, `ENFORCEMENT_POINTS`, any call site, or any file under `CreditService` / `pricingConfig`.
- A migration. The ledger is D-1, and its shape follows SA-B1.

**D-0 exit criteria:** `npm test` on the touched suites, `typecheck:bos-llm` and `check:bos-llm-literals` are all green. A grep shows no call site changed, and the SA code review confirms there is no runtime behaviour change.

### Approval

- [x] Requirement approved **with conditions**. D-0 → Dev workplan now.
- [ ] SA-B1 folded in → D-1 workplan may start.
- [ ] SA-B2 (BQ-1 answered: option C) and SA-B3 folded in → D-3 workplan may start.
- [ ] SA-S1 to SA-S12 addressed in the next BA revision.

### SA follow-up (2026-09-28, reorganised plan)

**Reviewed by SA — 2026-09-28**, second pass over the twelve-slice plan (§12) and SQ-13 to SQ-16. **Status: ✅ slices 1–3 unblocked.** All four new SQs are **TECHNICAL**; **no new business question**. Rulings are inline in §14.

| SQ | Ruling in one line |
|---|---|
| SQ-13 | SA-S3 stands. The per-call record carries the truth plus a price-source signal; `token_usage` is never given a Business OS-only figure; only the (flagged) charge row carries the conservative price. An absent signal is re-checked, not assumed unpriced |
| SQ-14 | Precision change to an existing field, stays `schema: 1`, ships in slice 2. Round to 10 dp, not raw float. Admin page formatter may change in slice 2 |
| SQ-15 | Thin row confirmed, plus `period_start` (required), `group_id` (indexed, not unique) and the three-value trigger code in place of owner / automatic. §4's "joined by the action id" to `token_usage` is wrong as built |
| SQ-16 | No code change. The OpenAI SDK reports no usage on an error, so there is nothing to record. KI-8 accepted with SA sign-off; `baseProvider.ts` untouched |

**Slice plan findings**

| Slice | Coherent, few-days scope? | Finding |
|---|---|---|
| **1** | ✅ Yes | **Clear to implement.** Co-locating the declaration on `AiActionType` (user decision) supersedes my D-0 item 1 and is acceptable, provided it is a `Record<AiActionType, …>` with `satisfies` and the Jest guard. Note for the workplan: `aiActionAudit.ts` imports the audit service, so it is server-only — slice 7 must resolve diary labels on the server (or ship keys), never import this module into a client component. SA-S12 header fix confirmed still stale (`aiActionAudit.ts:12`) |
| **2** | ✅ Yes, now that SQ-13/14/16 are ruled | Add to its guardrails: **no change to the `baseProvider.ts` failure path** (SQ-16). Its "no UI" guardrail gets one named exception: the admin audit-trail cost formatter (SQ-14). The resolver's absent-signal re-check (SQ-13 (2)) is in scope. **KI-9 / N-4 are stale:** `openaiProvider.calculateCost` already prices cached input at half-rate (`openaiProvider.ts:552-571`); BA to restate KI-9 as "cached input is priced at OpenAI's half-rate for OpenAI calls; other providers at full rate" |
| **3** | ⚠️ Coherent, but the heaviest slice | It carries the action id and `schema: 2`, a migration with two tables, an RPC, RLS, purge and deletion registration, the resolver and the non-interference proof. If the workplan's estimate exceeds a few days, split it at the natural seam: **3a** action id + `schema: 2` + credit value v0 + pure resolver (no DB), **3b** tables, repository, RPC and wiring. Row shape per SQ-15, adjustment-row shape decided here (SQ-15). SA-B1 is folded in correctly |
| **4** | ✅ Yes | The leak check must treat fallback-flagged rows as reconciled-pending (SQ-13 (3)) and drill down by `group_id` ↔ `session_id` (SQ-15). Remember scope-`excluded` calls (`usageScope.ts:58-59`) are the other source of uncharged spend |
| **5** | ✅ Yes | Config and docs only; gated on BD-8. No conflict |
| **6, 7** | ✅ Yes | SA-S10 and SA-S5 are carried as guardrails. The BA's "release 6 and 7 together" is endorsed |
| **8** | ✅ Yes | SA-S4 and SQ-11 condition 3 carried. No conflict |
| **9** | ✅ Yes | Option C needs a **"last seen at zero"** fact that is readable *when the balance is not*; the totals row is unreadable in exactly that case. The workplan must say where it lives (e.g. per-instance memory from the last successful read) and that a cold instance with no memory keeps working — otherwise option C silently becomes option A or B |
| **10** | ✅ Yes | No conflict |
| **11** | ✅ Yes | SA-S8 grant fields and `requireAdmin` carried. No conflict |
| **12** | ✅ Yes, after SQ-15 | **Conflicted with the thin row as proposed**: the stranger cap needs `external` on the charge row. Resolved by SQ-15 (3) |

**What BA owes before the slice 3 workplan (not before slices 1 and 2):** fold SQ-15 into §4, FR-13 and slice 3 (the three identifiers; correct Scenario 1 step 5 and the "joined by the action id" sentence). **Before the slice 2 workplan:** fold SQ-13, SQ-14 and SQ-16 into slice 2's scope and guardrails, KI-8 and KI-9. Both are text edits; none reopens a decision.

- [x] Slice 1 → Dev workplan now.
- [x] SQ-13, SQ-14, SQ-16 ruled → slice 2 workplan may start once BA folds them in.
- [x] SQ-15 ruled; SA-B1 already folded → slice 3 workplan may start once BA folds SQ-15 in.

> **BA note (2026-09-28, after the follow-up):** both items owed above are done. SQ-13, SQ-14 and SQ-16 are folded into FR-12h, AC-29, slice 2's scope and guardrails, KI-8 and KI-9. SQ-15 is folded into §4 (the thin row and the "joined by the grouping id" correction), Scenario 1 step 5, FR-10, FR-13, AC-11 and slices 3, 4 and 12. The slice 4 and slice 9 findings are carried into those slices' scope, and the slice 9 storage question is tracked as OI-5. The SA text above is unchanged.


---

## 19. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | The last layer of the Business OS LLM standards effort, parked since 2026-09-16. Written as the entitlements programme's S-3 metering seen from the LLM side: 31 FRs, 22 ACs, a five-slice plan, BD-1 to BD-7 and SQ-1 to SQ-10 |
| 2026-09-28 | Currency reopened; BD-1 promoted to a "Decide first" section | The user's framing: the app needs a **currency**, and tier allowances are derived from it — and the 250/500/1,000/2,000 numbers are invented and sold to nobody, so the unit was genuinely open. The user rejected a flat count of AI actions as not cost-linear. Three options set out (price list / live cost / tokens ÷ 10); recorded that "weighted actions" *is* the price-list option, and that `tokens ÷ 10` is not cost-based either — model-blind while Layer 2 lets an operator change the model, and images have no tokens so they would be free. 35 FRs, 25 ACs |
| 2026-09-28 | **BD-1 DECIDED — option B, credits charged at live measured cost** | **One credit is a fixed amount of real provider cost** (~$0.001; the exact value is set with the allowances in D-1b); every action is charged **its own measured cost after it ran**; no prediction, no price list, no re-derivation when a model changes. The user's reason: simpler, and per-action cost cannot be predicted (chat above all), so everything after the fact means no stale price to lose money on and nothing to recalculate. **Knowingly accepted, recorded as KI-1:** the same action varies day to day, and support cannot quote in advance. **New: the credit diary (FR-26)** — a per-action history of time, area, plain-language action, trigger, outcome and credits, which reconciles with the balance and carries no prompt, owner text, model output, tokens or dollars; it ships with the card in **D-2**, because under option B it *is* the owner's predictability. **FR-27** adds a typical range drawn from the owner's own history, labelled as past spend and never a price. The four approved rules specified: **FR-12** tightened (loud failure, a conservative documented fallback rather than a zero charge, a flagged row, operator surfacing, reconciliation by adjustment); **FR-6** rounding (fractional storage, rounded display, diary reconciles with balance); **FR-8 / FR-9** failed and retried actions charged what was actually spent, with idempotency protecting against double-recording the same spend rather than against charging real spend; **FR-5** fan-out needs no multiplier and the pre-check estimate is never the charge. §2 rewritten as resolved, with the option table kept for the record and short reasons why A and C were not chosen. SQ-2, SQ-3 and SQ-4 updated for the "price not knowable in advance" consequence; **SQ-8** (rounding precision and the reconciliation rule) and **SQ-9** (what "conservative" means) added. D-1 now measures to set the **credit value**, not a price list. Now **38 FRs, 28 ACs**; BD-4 settled by BD-1; Q1, Q6 and OQ-7 closed |
| 2026-09-28 | **SA review — APPROVED WITH CONDITIONS** | Added the SA Review section. All 12 SQs ruled TECHNICAL, one business question raised (BQ-1: what the owner's assistant does during a usage-records outage — BD-5's fail-closed contradicts entitlements T-3(d)). Blocking: SA-B1 (the grouping id is not one-per-action — onboarding reuses one per conversation, chat takes it from a request header — so the ledger key must be a server-minted action id), SA-B2 (fail-closed vs T-3(d) and the shipped `EntitlementService`), SA-B3 (FR-17 "no call-site change" is untrue: nothing asks the resolver today; the pre-check belongs in `runAiAction`). Should-fix SA-S1 to SA-S12, including: a plan-cache hit is not free (its lookup embedding is paid), FR-12e restated around code defaults plus Layer 2's existing unpriced-model gate, the stranger-triggered spend guard, and D-2 gated on D-1b. SQ-6 was already decided (T-6), and SQ-10's F-28 was a false positive. D-0 scoped for the Dev workplan. BA text preserved; rulings appended inline to §11 |
| 2026-09-28 | **BQ-1 DECIDED — option C** | During a usage-records outage the owner's own AI keeps working unless the account was last seen at zero. Unblocks folding SA-B2 into the requirement before the D-3 workplan |
| 2026-09-28 | **Reorganised into twelve numbered slices; reuse principle, the three records and the balance example added** | User decisions of 2026-09-28. **Slice format (BD-9):** §12 rewritten — slices numbered 1–12, each titled by its scope, a few days each, with goal, what the owner / user gets, scope, guardrails, dependencies and FRs / ACs; an FR coverage table (every FR mapped, none orphaned), an old→new mapping (D-0 → 1, 2; D-1 → 3, 4; D-1b → 5; D-2 → 6, 7; D-3 → 8, 9, 10; D-4 → 11, 12), and the old D-0…D-4 table kept as "Superseded slice plan". The user proposed eleven slices; BA split "behaviour at zero" into slice 9 (the balance check and BQ-1 outage behaviour) and slice 10 (pause / degrade and the missing lead-reply template) to keep each to a few days. **Reuse (BD-10):** new §3 — no new tracking; `runAiAction` is the only measurer; audit entry and charge row are built from the same in-memory call list, never by re-reading `token_usage`; why the audit trail cannot be the bill (lossy queue, grouping id not per action, no grants / adjustments, archived by the Admin Archiving module, micro-dollar rounding) and which gaps are fixed in place. **New §4, the three records** (`token_usage`, audit entries, the thin charge table) with three scenarios. **New §5**, a worked balance example. **FR changes:** FR-4 co-located on `AiActionType`; FR-7 and AC-6 per SA-S1; FR-9, FR-13, FR-15, FR-16, NFR Correctness / Auditability, AC-8, AC-11, AC-12 and AC-28 moved to the action id (SA-B1); FR-13 **thin row** (old list kept as superseded); FR-12g added (cost right at source: unrounded audit cost, failed-call $0); FR-17 corrected per SA-B3; FR-21 and AC-15 per BQ-1 option C and SA-B2; FR-23 per SA-S4; FR-26 reads only the charge table (SA-S5); FR-33 includes the leak check (SA-S9). New ACs 29–32; new NFR "Reuse". New BD-8 (AI cost per plan per month, asked at slice 5), BD-9, BD-10. New open questions for SA: **SQ-13** (right-at-source vs SA-S3), **SQ-14** (unrounded audit cost vs D-0's no-schema-change), **SQ-15** (the thin charge row vs the SQ-1 ruling), **SQ-16** (failed-call $0 in the shared `baseProvider`). New KI-8 to KI-11, OI-3, OI-4. Sections renumbered (3 → 6 … 16 → 19); the SA Review is kept verbatim with a mapping note at its top, and slice / section references in BA text updated with the old name in brackets where it matters. **The D-0 Dev workplan (`docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md`) is superseded by this reorganisation and will be redone for slice 1** (slice 2 gets its own workplan once SQ-13, SQ-14 and SQ-16 are answered); it was not edited |
| 2026-09-28 | **SA follow-up — SQ-13 to SQ-16 ruled; slices 1–3 unblocked** | All four TECHNICAL, no new business question. **SQ-13:** SA-S3 stands — the per-call record carries the truth and a price-source signal, `token_usage` gets no Business OS-only figure, only the flagged charge row carries the conservative price; an absent signal is re-checked, not assumed unpriced. **SQ-14:** unrounded audit cost is a precision change, stays `schema: 1`, rounded to 10 dp; admin formatter may change in slice 2. **SQ-15:** thin row confirmed plus `period_start` (required), `group_id` (not unique) and the three-value trigger; §4's "joined by the action id" to `token_usage` is wrong as built. **SQ-16:** no code change — the OpenAI SDK reports no usage on errors; KI-8 accepted with SA sign-off, `baseProvider.ts` untouched; agent charge confirmed token-based. Slice-plan findings added (slice 3 split seam, slice 9 "last seen at zero" storage, slice 12 needs `external`, KI-9 stale). SA follow-up subsection added under the SA Review; rulings appended inline in §14 |
| 2026-09-28 | **BD-11 decided (card refresh); SA correction C-1 folded in; SQ-13 to SQ-16 rulings applied** | Documentation only; no decision reopened; SA text kept verbatim (BA notes added beside it) and superseded BA wording kept and marked. **BD-11 (user):** the usage card refreshes (a) right after the owner's own AI action finishes, (b) when the owner returns to the tab or page, (c) from a small manual refresh icon with a brief loading state; no background or timer polling, automatic work shows on the next refresh. Added to slice 6's goal, scope and guardrails; new **FR-39**, **AC-33**, **KI-12**, a user story, an NFR Performance line and an out-of-scope row. **As-built recorded (new A-18):** today the card reads a rolling 30 days of `token_usage` at tokens ÷ 10, against a platform-wide $10 ÷ $0.00048 ≈ 20,800-credit allowance regardless of plan, fetched once on page load; after slice 6 it reads the charge table's running total for the owner's own billing period. **C-1 (SA, slice 1 workplan review):** `lead_reply_recommendation` already has a template fallback — every failure in `recommendLeadReply` falls back to `pickFallbackCandidate` (fixed rule, no AI call); the model only picks which owner link to send; `LeadAlertService` returns before the AI action when there are no candidates. Corrected OI-1 (closed), slice 1 scope (fallback `exists`), slice 10 scope, FR-20 ("route 'balance exhausted' down the existing fallback path the area-switched-off path already uses", not "build the missing fallback"), AC-14, §8 and BD-5's note; a C-1 subsection added to §14; a BA note records that SA's D-0 item 2 is corrected by C-1. **SQ-13 / SQ-14 / SQ-16 → slice 2:** new FR-12h (per-call record carries the true figure plus a priced / unpriced signal from a separate read-only lookup; shared pricing functions return nothing new; `token_usage` never gets a Business OS-only figure — on an unpriced call `token_usage` and the audit entry say $0 with an `error` log and only the charge row carries the flagged conservative price; an absent signal is re-checked, not assumed unpriced; audit cost at 10 dp, still `schema: 1`, no backfill; failed-call part not fixed); slice 2 scope, guardrails (no change to the `baseProvider.ts` failure path; one UI exception, the admin audit-trail cost formatter) and dependencies updated; AC-29 resolved to its known-issue branch; KI-8 restated as accepted (provider reports no usage on failure); KI-9 restated (OpenAI cached input already priced at half rate in `openaiProvider.ts`). **SQ-15 → slice 3:** §4, FR-13 and AC-11 gain `period_start` (required) and `group_id` (indexed, not unique), and the trigger is stored as `owner` / `scheduled` / `external` (FR-10; slice 12's stranger cap counts `external`); "joined by the action id" to `token_usage` and Scenario 1 step 5 corrected to the grouping id (`session_id`); the adjustment-row shape is decided in slice 3; slice 3 may split into 3a (action id, `schema: 2`, credit value v0, pure resolver) and 3b (tables, repository, RPC, wiring). **Slice 4:** flagged rows are reconciled-pending, not leaks; drill-down by `group_id` ↔ `session_id`; calls excluded from a usage scope covered. **Slice 9:** the workplan must say where "last seen at zero" is kept for option C, and a cold instance with no memory keeps working (new OI-5). FR coverage table, SA-findings-by-slice line, NFR Correctness / Auditability / Testability and §18 integration points updated. Status updated; still not Approved (needs user or TL sign-off) |
