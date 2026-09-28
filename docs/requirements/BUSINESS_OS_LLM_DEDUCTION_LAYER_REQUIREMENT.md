# Requirement: Business OS AI Deduction Layer (LLM standards, last layer)

> **Last Updated**: 2026-09-28

**Created by:** BA
**Date:** 2026-09-27
**Status:** **Draft — BD-1 resolved (option B, 2026-09-28); ready for SA review.** BD-2 to BD-7 agreed in principle. Open for SA: SQ-1 to SQ-12

## Overview

Business OS tracks every AI call and charges for none of them. Layers 1, 1.1, 1.5, 2 and 3 made the tracking correct — every call attributed to the business, with an area, a call name, a grouping id, tokens, an estimated cost and one audit entry per action. This layer turns that record into a **charge**: a currency, a rule for what an owner spends, a place to record it, a truthful number on the dashboard, and a defined behaviour when the allowance is gone.

**The currency is decided (§2).** One credit is a fixed amount of real provider cost, and every AI action is charged **its own measured cost, after it ran**. Nothing is predicted, nothing is quoted in advance, and no price list has to be maintained. What replaces predictability is a **credit diary**: the owner sees every action and what it cost, so they learn their own spending.

The **grain** is the AI action, which already exists in code: `runAiAction` wraps one action and collects its calls, and `lib/business-os/entitlements/balance.ts` is an empty socket waiting for exactly this. This layer is the **S-3 Metering** slice of the entitlements programme, written from the LLM side so the parked LLM questions (Q1, Q6, OQ-7, OI-1, UD-1) are answered with it rather than beside it.

---

## Table of Contents

1. [What is already true](#1-what-is-already-true)
2. [The currency: decided (BD-1)](#2-the-currency-decided-bd-1)
3. [Scope](#3-scope)
4. [User Stories](#4-user-stories)
5. [The grain, and what is charged](#5-the-grain-and-what-is-charged)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Slice plan](#9-slice-plan)
10. [Business decisions for the user](#10-business-decisions-for-the-user)
11. [Open questions for SA](#11-open-questions-for-sa)
12. [Operator questions answered as-built](#12-operator-questions-answered-as-built)
13. [Out of scope](#13-out-of-scope)
14. [Known issues and open items](#14-known-issues-and-open-items)
15. [Notes on integration points](#15-notes-on-integration-points)
16. [Change History](#16-change-history)

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
| **A-8** | **That audit entry cannot be the billing record.** It is queued, never awaited, and a failed insert loses its whole batch (accepted as Layer 3 KI-B). It is, however, the right **shape** for the diary | `lib/business-os/llm/aiActionAudit.ts:316`, `:304`; `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:551` |
| **A-9** | **The allowance numbers are invented and nothing is sold against them.** `ai.actions` is a `metered` capability (unit `ai_action`, period `month`, `atLimit: 'by_call_site_audience'`); the four plans carry 250 / 500 / 1,000 / 2,000 a month, described in the doc itself as "a first pass… reset here from the shadow report", and every cohort quantity is a `PLACEHOLDER` | `lib/business-os/entitlements/config/catalog.ts:293-305`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:53`, `:133`, `:40-47` |
| **A-10** | **The seam exists and is empty.** `ALWAYS_SUFFICIENT` answers "yes" to every balance question so that this layer needs no call-site migration | `lib/business-os/entitlements/balance.ts:20-49` |
| **A-11** | **Business OS must not touch the Pilot-Credit tables.** RD-2: Business OS billing never writes `user_subscriptions` / `credit_transactions`, and no Business OS surface may read them. The ledger behind `balance.ts` is a **BUILD NEW** row (L-22) | `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:351`, `:176` |
| **A-12** | **The mechanics of metering are already specified** in §11 and FR-23 to FR-30, FR-36, FR-41, FR-42: monthly, no roll-over, allowance then boost, degrade-don't-stop, 80/100% warnings, one visible allowance. Only the **unit** was reopened, and is now settled | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md:379-394`, `:475-482`, `:497`, `:502-503` |
| **A-13** | **Nothing is enforced.** `BOS_ENTITLEMENTS_MODE=shadow` in production on purpose; a refused `enforce` also runs as `shadow` | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9`, `:148-151` |
| **A-14** | **No admin can add or reduce a customer's AI balance.** The admin op union is `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state` — no credit grant, and no admin route anywhere writes a credit balance | `lib/business-os/entitlements/adminOps.ts:76-80`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:172`; no match under `app/api/admin/**` |
| **A-15** | **The expiry lock is half-built and fails open.** `checkExecutionAllowed` blocks an agent run on `account_frozen` or an insufficient balance but returns `allowed: true` on any DB error or missing row; the cron that would set `account_frozen` is **not scheduled** | `lib/services/CreditService.ts:388-438` (`:404-408`); `app/api/run-agent/route.ts:104-135`; `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:108-110` |
| **A-16** | **Layer 2's kill switch fails open** by design — an area whose settings read fails keeps calling on code defaults. It also lets an operator **change an area's model in configuration**, which the chosen currency absorbs automatically | `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` §5, §3 |
| **A-17** | **Real cost per action is spread wide, and is not predictable per action.** A chat turn is fractions of a cent (measured over 1,000 calls: p50 $0.000594, p99 $0.000747); a website generation is cents; one image is **$0.016–$0.25** and carries **zero tokens** | `lib/business-os/bizql/telemetry/ChatBudget.ts:7-13`; per-image pricing by model / size / reported quality, Layer 1.5 FR-10, FR-13 |

**The consequence, in one line:** the plumbing, the grain, the cost figure and the socket all exist; what is missing is a **credit**, a ledger, a truthful dashboard number with a diary behind it, and a defined behaviour at zero.

---

## 2. The currency: decided (BD-1)

**Decision, by the user, 2026-09-28: option B — credits charged at live measured cost.**

- **One credit is a fixed amount of real provider cost** (working figure ≈ $0.001). The exact value is a configuration decision taken **with** the tier allowances, once D-1 has measured real spend (FR-37).
- **Every action is charged its own measured cost, after it ran.** Credits charged = the action's measured provider cost ÷ the credit value.
- **No prediction, no published price list, no re-derivation when a model changes.**

**Why the user chose it:** it is the simpler mechanism, and cost genuinely cannot be predicted per action — chat above all. Everything is after the fact, so the platform never loses money on a stale price and never has to recalculate one. A model change, a prompt change or a provider price change is absorbed the moment it happens.

**Knowingly accepted, and written here so nobody rediscovers it as a defect:**

| Accepted | Consequence |
|---|---|
| The same action can cost different amounts on different days | Two identical-looking website generations may be 27 and 34 credits. The diary shows both, and neither is wrong |
| Support cannot quote a price in advance | "What will this cost me?" is answered with the owner's own history and a range (FR-27), never with a number we commit to |
| The charge depends on our cost figure being right | Which is why FR-12 is a prerequisite in the first slice, not a follow-up |

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

## 3. Scope

**In scope**

- The credit (§2): its value as configuration, and the one resolver that turns an action's measured cost into credits.
- Making the cost figure trustworthy enough to charge on (FR-12).
- What one action is at each of the catalogued areas, and what is not charged.
- A durable per-action ledger, with idempotency, and the real implementation behind `balance.ts`.
- The owner-facing surface: the usage card in credits, and the **credit diary**.
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

---

## 4. User Stories

- As **a business owner**, I want the dashboard to tell me how many credits I have left of what my plan includes.
- As **a business owner**, I want to see what each thing I did actually cost, so that after a week I know which work is cheap and which is expensive, and I can manage it myself.
- As **a business owner**, I want to know which of my spend was work I asked for and which the product did for me overnight, so a falling balance is never a mystery.
- As **a business owner who has used everything up**, I want my clients to keep getting replies and reminders, and to be told plainly that the assistant is paused until next month or an upgrade.
- As **a new owner**, I don't want my setup conversation to eat a meaningful part of my first month.
- As **an admin**, I want to give a design partner or an unhappy customer more credits, and to take them back, with a reason and an audit entry.
- As **the business owner (Barak)**, I want each plan's allowance and the value of a credit to be derived from what it actually costs us to serve, not from a number somebody invented.

---

## 5. The grain, and what is charged

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
| **A cache hit (chat plan cache, image reuse)** | Charged 0 — no call was made, so no cost was incurred |
| **Agent-platform work** | Never charged here; Business OS never reads or writes the Pilot-Credit balance (A-11) |

---

## 6. Functional Requirements

### The currency and the grain

1. **FR-1** The customer-visible unit of AI usage in Business OS is a **credit**, defined as a fixed amount of real provider cost. The unit at which spend is measured is **one AI action** (§5). Every action is charged **after it has run**, at its own measured cost.
2. **FR-2** Credits charged for an action = the action's measured provider cost ÷ the configured credit value, computed in **one** resolver. No call site computes a charge, and there is no per-action-type price list to maintain.
3. **FR-3** The credit value is **configuration**, versioned, and changing it **never rewrites history**: consumption already recorded keeps the credits it was charged, and the change is auditable (who, when, from what, to what). Every ledger row records the credit-value version it was charged under.
4. **FR-4** The set of chargeable actions is derived from **one** declared list, shared with the audit layer, so an action cannot be audited without being chargeable or vice versa. Each entry declares: its area, its **audience** (owner-facing or client-facing), whether it is **setup AI**, whether it is charged, its **diary label**, and its template fallback where it is client-facing.
5. **FR-5** A fan-out action (one instruction applied to many records) needs no multiplier: it is charged the cost of every call it made. `AiActionBalanceQuery.cost` remains an **estimate for the pre-check only**, never the charge.
6. **FR-6** **Credits are stored as a fraction and displayed rounded.** The ledger records credits at a documented precision sufficient for the cheapest action (an embedding is a fraction of a cent); the card and the diary display rounded figures. **The displayed diary must reconcile with the displayed balance** — rounding is applied to presentation only, never accumulated into the stored balance, and a documented rule says how a sum of rounded lines is reconciled with the rounded sum.

### What is charged

7. **FR-7** An action that made no LLM call is charged **0** — including a chat turn served from the plan cache and an image served from the reuse cache.
8. **FR-8** An action is charged **the measured cost of the calls it actually made, whether it succeeded or failed**, and a failed action appears in the diary marked as failed. This is consistent with the existing per-action audit entry, which already records a failed action with its calls, its tokens and its cost.
9. **FR-9** A ledger row is written **at most once per completed action**, identified by its grouping id: replaying or double-invoking the same completed action writes no second row. Where a retry made **new** calls, their cost is charged — idempotency protects against recording the same spend twice, never against charging spend that happened.
10. **FR-10** Background (`trigger: 'scheduled'`) and external (`trigger: 'external'`) actions are charged to the business whose account they ran for, and recorded with their trigger so they can be reported and shown separately.
11. **FR-11** Tokens and estimated cost continue to be recorded per call exactly as today, and every charged action records the measured cost behind its credits, so any charge can be traced back to what it was derived from.
12. **FR-12** **A charge may never be derived from a cost figure that can silently be wrong.** Specifically:
    - a. A model with **no price entry** must **fail loudly** — logged at `error` with the provider, model, area and action — and must **never** be recorded, or charged, as $0.
    - b. Where a price is genuinely missing at charge time, the action is charged a **conservative documented fallback** (the highest price in the relevant class, documented with its derivation), and the ledger row is **flagged as fallback-priced**.
    - c. A flagged row is surfaced to operators in the report of FR-33 and as a countable log event, so "how many charges were guessed?" is answerable at any time.
    - d. Flagged rows are **reconciled** once the real price is known: the corrected figure is recorded as an adjustment with its reason, never by rewriting the original row.
    - e. Every model an operator can select in Layer 2's area settings must have a price entry, checked automatically; and a per-image price must resolve for every configured model, size and quality.
    - f. This is a prerequisite inside the first slice.

### The ledger and the charge path

13. **FR-13** Consumption is recorded in a **Business OS-owned ledger**, one row per charged action, carrying: the account, the grouping id (unique), the area, the action type, the trigger, **the credits charged**, **the measured cost behind them**, the credit-value version, the fallback-priced flag, the outcome (succeeded / failed), the period it falls in, the action's tokens, and the time.
14. **FR-14** The ledger is **not** `user_subscriptions`, `credit_transactions` or `billing_events`, and no Business OS code reads or writes those (A-11). All access goes through a repository in `lib/repositories/`, scoped by account.
15. **FR-15** The ledger write is **not** the audit queue. It must be a direct, confirmed write; the audit entry stays as it is and remains joinable by the grouping id (A-7, A-8).
16. **FR-16** A ledger write failure never fails the owner's action, and is logged at `error` with the account, area, action type and grouping id — so an uncharged action is discoverable rather than silent.
17. **FR-17** `balance.ts`'s real implementation answers from the ledger plus the account's entitled allowance and any grant balance: consumption order is **period allowance first, then grants** (soonest-expiring first). No call site changes.
18. **FR-18** The period allowance **resets each period and does not roll over** (B-6). The trial's allowance is a one-off total, not monthly, and using it up ends the trial.

### At the limit

19. **FR-19** When an account's allowance is exhausted, behaviour follows the action's **audience**: client-facing actions **degrade** to their template fallback and still run; owner-facing AI **pauses** with an explanation (D-12).
20. **FR-20** No client-facing automation may be stopped by an exhausted allowance. Where a client-facing action has no template fallback, this layer builds one before that action can be degraded.
21. **FR-21** The balance check **fails closed for owner-facing AI** and **fails open for client-facing** actions, and every fallback is logged at `error`. This is deliberately unlike Layer 2's kill switch (A-16) and unlike the chat daily budget (A-6), and the difference is stated in code.
22. **FR-22** The chat daily budget stays as it is and is a **separate, additional** guard: it caps a day, the allowance caps a period. A refusal names which one stopped the turn, and the two are never presented to the owner as one number.
23. **FR-23** Warnings fire at configurable thresholds (default **80%** and **100%**), once per threshold per period. Before a **setup** action that would exhaust or nearly exhaust a trial allowance, the owner is warned first, told what remains, and can cancel (FR-42).

### What the owner sees

24. **FR-24** The usage card reports **credits used and remaining out of the allowance the account's plan entitles it to** — read from the entitlements resolver, not from `monthly_ai_allowance_usd ÷ pilot_credit_cost_usd` (A-4).
25. **FR-25** The card separates **what the owner asked for** from **what ran automatically**, at least as two figures, so a balance that fell overnight is explainable (OI-1).
26. **FR-26** **The credit diary.** The owner can see a per-action history of their own spend, newest first, covering at least the current period. Each line shows: **when** it happened, **the area**, **what the action was** (a plain-language label for the action type), **whether the owner triggered it or it ran automatically**, **whether it succeeded or failed**, and **the credits charged**.
    - It derives from the same per-action record as the audit entry and **reconciles with the balance**: the diary for a period sums to the credits used in that period.
    - It **never** shows prompts, anything the owner typed, anything the model returned, an error message, tokens or dollars — the same closed rule Layer 3 applies to audit entries.
    - It is the owner's own data only, always scoped to the caller, never addressable by an account id in a request.
27. **FR-27** **A typical range, from the owner's own history.** Where the diary holds enough of an owner's own examples of an action type, it may show a typical range — "website generations have cost you 25–35 credits". It is labelled as **their own past spend, not a price and not a commitment**, it is never shown as a single number, and it is suppressed when there are too few examples to be meaningful.
28. **FR-28** No owner-facing surface shows tokens or dollars.
29. **FR-29** Where an account has no entitled allowance (nothing configured, or an unresolvable plan), the card shows consumption with no gauge, as it does today for a missing allowance, and the diary still works.

### Operator

30. **FR-30** An admin can **grant** credits to one account (amount, reason, optional expiry) and **reduce or end** a grant, through the existing admin operations path: `requireAdmin` first, Zod-validated, audited with actor, target, before/after and reason, never available to a user on their own account.
31. **FR-31** An admin can read one account's current position — allowance, used, granted, remaining, and which layer decided the allowance — without SQL.
32. **FR-32** An account whose plan has expired or lapsed consumes no further owner-facing AI, decided by the entitlements lifecycle, not by a frozen flag on the agent-platform subscription row (A-15).
33. **FR-33** An operator-readable report gives, per account and period: credits used by area, by action type and by trigger, **with the measured cost behind them** and **the count of fallback-priced rows** (FR-12c). This is the report the credit value and the tier allowances are derived from (FR-37).

### Day one, allowances and rollout

34. **FR-34** Charging starts at a stated moment. **No historical usage is converted into credits**, and no account starts its first metered period with anything already spent.
35. **FR-35** Existing Pilot-Credit balances are left exactly as they are, are never read by Business OS, and have no effect on a Business OS allowance. The ~13× understatement (A-5) becomes irrelevant rather than being reconciled.
36. **FR-36** Exactly **one** AI allowance is visible to a Business OS owner. The display-only `monthly_ai_allowance_usd` path is retired from the owner surface in the same release that introduces the new one (T-9).
37. **FR-37** **The credit value and the tier allowances are derived together, not invented.** From FR-33's measurement: the credit value is set as a round amount of real cost, and each plan's allowance = the target AI cost the business is willing to carry for that plan ÷ that credit value. The existing 250 / 500 / 1,000 / 2,000 are **placeholders** and are replaced in the same change, along with every `PLACEHOLDER` cohort quantity; the derivation (target cost, credit value, measured inputs, date) is recorded next to the numbers. This touches `lib/business-os/entitlements/config/tierMatrix.ts`, `config/cohorts.ts` and `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, and the capability's `unit` changes from `ai_action` to the credit unit.
38. **FR-38** The layer ships behind the existing entitlements mode: in `shadow` it charges, records, reports, shows the diary and warns, and refuses nothing; only `enforce` applies FR-19 to FR-21.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | A balance check adds at most one cached lookup per request or turn, resolved once and reused. The ledger write never blocks the owner's response. The diary is paged and reads one account's rows only. Background runs resolve in batch per run, not per item. |
| **Correctness** | One completed action = at most one ledger row, guaranteed by a uniqueness constraint on the grouping id, not by application care alone. A concurrent burst may overspend an allowance by a small, bounded amount; it may never charge the same spend twice. Credits are never stored rounded, and the diary always reconciles with the balance. |
| **Security** | Account, allowance, credit value and grant values are never taken from a request body. The diary is caller-scoped with no account parameter. Admin authority only via `requireAdmin` / `admin_users`, never `profiles.role`. Every ledger read and write is account-scoped through a repository; the table is server-write-only (the money-table lockdown pattern). |
| **Observability** | Pino structured logs for every `limit_reached`, degrade, pause, warning, grant, credit-value change, failed ledger write, **unpriced model** and **fallback-priced charge** (FR-12), with account, area, action type, grouping id and correlation id. No prompt text, owner text or model output, matching Layer 3's rules. |
| **Auditability** | Every grant, reduction, credit-value change and fallback-price reconciliation is an audit entry. Every charged action is already audited (A-7); the ledger row and the audit entry share the grouping id, so the two can be reconciled. |
| **Testability** | Charging rules are unit-testable with no provider: cost→credits conversion at a given credit value, 0 for a cache hit, the actual cost for a failed action, no second row on replay, a new charge for a retry that spent, fractional storage with rounded display, an unpriced model failing loudly and falling back conservatively, and audience-dependent behaviour at zero. A source-level test fails if a declared action type has no audience, no charge rule or no diary label. |
| **Logging debt** | This layer does not touch `lib/services/CreditService.ts` or `lib/utils/pricingConfig.ts` (A-11), so their `console.*` calls stay out of scope. If a slice ends up touching either — or `lib/ai/pricing.ts` for FR-12 — CLAUDE.md rule 3 applies and the conversion is raised with the user first. |

---

## 8. Acceptance Criteria

**The currency and pricing**

- [ ] **AC-1** (FR-1, FR-2) An action's charge equals its measured cost ÷ the configured credit value, computed in one resolver; a code review finds no charge, price or weight computed at a call site, and no per-action-type price list.
- [ ] **AC-2** (FR-3) Changing the credit value changes what new actions cost and leaves every already-recorded row at its original credits; the change writes one audit entry with before and after, and rows record the version they were charged under.
- [ ] **AC-3** (FR-12a, b, e) A model with no price entry produces an `error` log naming provider, model, area and action, and is charged the **conservative documented fallback** — never $0; a test enumerates every model selectable in Layer 2's area settings and fails if any has no price; a per-image price resolves for every configured model / size / quality.
- [ ] **AC-4** (FR-12c, d) A fallback-priced row is flagged, counted in the operator report and countable from logs; reconciling it records an adjustment with its reason and leaves the original row intact.
- [ ] **AC-5** (FR-6) Credits are stored fractionally at the documented precision: an embedding-only action records a non-zero fraction, not 0 and not 1; the card and diary display rounded figures; and the diary for a period reconciles with the balance shown for that period under the documented rule.

**What is charged**

- [ ] **AC-6** (FR-7) A chat turn served from the plan cache and a second identical image request (reuse cache) are each charged **0**, and neither moves the balance.
- [ ] **AC-7** (FR-8) An action that threw after two paid calls is charged those two calls' cost and appears in the diary marked failed; an action with one failed call and a successful outcome is charged the whole action's cost, once.
- [ ] **AC-8** (FR-9) Replaying the same completed action writes no second row; a retry that made new calls is charged for them.
- [ ] **AC-9** (FR-4, FR-10) Every declared action type has an audience, a setup flag, a charge rule and a diary label, asserted by a test that fails when a new type is added without them. A nightly insight run and a daily briefing are each charged to their own business with `trigger: 'scheduled'`.
- [ ] **AC-10** (FR-5) One action that made five LLM calls produces one row charged for all five; a fan-out over 12 records is charged its actual total, and the pre-check estimate is not what was charged.

**Ledger**

- [ ] **AC-11** (FR-13, FR-14) A ledger row carries the credits charged, the measured cost, the credit-value version, the fallback flag and the outcome; a code review finds no Business OS read or write of `user_subscriptions`, `credit_transactions` or `billing_events`, and no direct Supabase call outside `lib/repositories/`.
- [ ] **AC-12** (FR-15, FR-16) With the audit queue stubbed to fail, the ledger row is still written; with the ledger write forced to fail, the owner's action still succeeds and one `error` log names the account, area, action type and grouping id.
- [ ] **AC-13** (FR-17, FR-18) An account with 10 credits remaining and a 25-credit grant spends the 10 first; a new period resets consumption to zero and carries nothing over; a used-up trial total ends the trial.

**At the limit**

- [ ] **AC-14** (FR-19, FR-20) With the allowance exhausted and mode `enforce`: a lead reply still goes out, with template text; a chat turn is refused with a normal assistant message that names the plan and the reset, and the conversation stays usable.
- [ ] **AC-15** (FR-21) With the ledger unreadable: an owner-facing AI action is refused and logged at `error`; a client-facing automation runs.
- [ ] **AC-16** (FR-22) A turn refused by the daily chat budget and a turn refused by the period allowance produce different, correctly named refusals.
- [ ] **AC-17** (FR-23) Crossing 80% fires once in the period and not again; a setup regeneration that would exhaust a trial allowance warns before running and can be cancelled.

**Owner surface**

- [ ] **AC-18** (FR-24, FR-25, FR-29) The card shows credits used and remaining against the resolved plan allowance, splits owner-triggered from automatic, and falls back to "consumption, no gauge" when no allowance resolves — with the diary still working.
- [ ] **AC-19** (FR-26) The diary shows time, area, plain-language action, trigger, outcome and credits per line, newest first, pages correctly, reconciles with the period's balance, and contains **no** prompt, owner text, model output, error message, token count or dollar figure. A request that tries to name another account's id gets its own data or a refusal, never the other account's.
- [ ] **AC-20** (FR-27) With enough of an owner's own examples, a range is shown, labelled as their own past spend and never as a price; with too few, nothing is shown.
- [ ] **AC-21** (FR-28, FR-36) No owner-facing surface renders a token or dollar figure, and none derives an allowance from `monthly_ai_allowance_usd`.

**Operator**

- [ ] **AC-22** (FR-30) A grant and a reduction each: require an admin, reject an invalid body with 400, write one audit entry with actor, target, before/after and reason, and change the account's remaining balance. A non-admin, and a user aiming the operation at their own account, are both refused.
- [ ] **AC-23** (FR-31, FR-33) One account's allowance / used / granted / remaining and the deciding layer are readable without SQL, and the per-area, per-action-type, per-trigger report — with measured cost and the fallback-priced count — reproduces the same totals.
- [ ] **AC-24** (FR-32) An account whose plan has lapsed consumes no owner-facing AI, with no dependence on `account_frozen`.

**Allowances, day one and rollout**

- [ ] **AC-25** (FR-37) The credit value is recorded as configuration with its derivation; no plan or cohort allowance remains at a placeholder value; each carries its derivation (target cost, credit value, measured input, date); the entitlements doc and the capability's `unit` match what shipped.
- [ ] **AC-26** (FR-34, FR-35) On the day charging starts, every account reads zero spent and an empty diary; no historical `token_usage` row is converted; no Pilot-Credit balance changes.
- [ ] **AC-27** (FR-38) In `shadow`, a fully exhausted account is refused nothing, while the ledger, the diary, the report and the warnings all work. Flipping to `enforce` is the only thing that changes behaviour.
- [ ] **AC-28** (end-to-end, non-production) On a test business: an onboarding conversation, an insight run, a briefing, a website generation, a lead reply, a chat turn, an image and one deliberately failed action each produce one diary line whose credit figure matches the measured cost; the card's figures before and after are recorded; the audit entry and the ledger row for each action carry the same grouping id. A concurrency test proves the same spend is never charged twice and records the measured overspend under a burst.

---

## 9. Slice plan

Six slices. Each ships alone and leaves the product working. **D-0 to D-2 do not depend on G-1 or on enforcement switch-on** — they measure, charge in shadow and tell the truth, which is also the evidence the credit value and the allowances need.

| Slice | Delivers | Why first / notes |
|---|---|---|
| **D-0 Rules, and a trustworthy cost** | The declared action list (audience, setup flag, chargeable, diary label, template-fallback status) as code with a guard test, **and FR-12**: unpriced models fail loudly, a conservative documented fallback exists and flags its rows, every Layer 2-selectable model has a price, image prices resolve. No behaviour change. | Under option B the cost figure **is** the charge, so a silent $0 would charge a customer nothing (A-3). This is also where the *missing* client-facing template fallbacks are found, rather than discovered at the limit. |
| **D-1 Measure** | Per-action-type cost measurement across real accounts and the operator report (FR-33). Charging runs in shadow: the ledger fills at a provisional credit value, nothing is refused, nothing owner-facing moves. | Produces the evidence for **the credit value** and for FR-37's allowances — not for a price list, which option B does not need. Answers OQ-7, OI-1 and UD-1 with numbers instead of argument. |
| **D-1b Set the credit value and derive the allowances** | Fix the credit value as configuration; replace 250 / 500 / 1,000 / 2,000 and every `PLACEHOLDER` cohort quantity with derived figures; record the derivation; update the capability `unit` and the plans doc (FR-37). | A config change, gated by D-1's measurement. Small — but it is the moment the plans stop being invented. |
| **D-2 Tell the owner the truth** | The usage card in credits against the resolved plan allowance, split owner-triggered vs automatic; **the credit diary** (FR-26) and the own-history range (FR-27); the display-only allowance retired from the owner surface. | The first owner-visible change, and the last one that is safe to make before anything can be refused. The diary ships **with** the card: under option B it is not a nice-to-have, it is the whole of the owner's predictability. |
| **D-3 Behave at zero** | The real `balance.ts`, warnings at 80/100%, the setup pre-warning, degrade-vs-pause by audience, the fail-closed/fail-open split, and the relationship to the chat daily budget — all still inert in `shadow`. | Built and reviewable before it can refuse anyone; turns on with the entitlements flag, not with its own. |
| **D-4 Operator controls** | Admin grant / reduce, the per-account position view, and the lapsed-plan stop. | Needed before enforcement is live, or the first exhausted champion is a support ticket with no remedy (D-7). |

Selling credits (boost purchases, auto top-up) stays in S-4b. This layer only needs a grant to **exist**; selling one does not.

---

## 10. Business decisions for the user

| # | Decision | Status | Note |
|---|---|---|---|
| **BD-1** | **What one credit is defined against** | ✅ **DECIDED 2026-09-28 — option B, credits charged at live measured cost.** See [§2](#2-the-currency-decided-bd-1) | Simpler, and cost cannot be predicted per action. Everything after the fact: no stale price to lose money on, nothing to recalculate. Accepted: the same action varies day to day, and support cannot quote in advance — answered by the diary (FR-26) and the own-history range (FR-27) |
| **BD-2** | **Does work the product does on its own — nightly insights, the daily briefing, automatic lead replies — come out of the owner's allowance?** | Agreed in principle: **yes, with its own line, and every instance in the diary** | It is real spend, and an uncounted channel is an uncapped one — but an owner must never watch a balance fall on a day they did nothing without being told why. Under option B the diary answers that per action, not just per month |
| **BD-3** | **Does a new owner's setup — onboarding, the first website and intake generation — come out of their allowance?** | Agreed in principle: **yes, against the trial's one-off total, with a warning before it runs out** (B-12) | UD-1's worry — a new owner opening their dashboard with part of month one already spent — is answered by D-1's measured number, by FR-23's pre-action warning, and by the diary showing exactly what setup cost |
| **BD-4** | **How much is an AI image?** (OQ-7) | ✅ **Settled by BD-1: its actual measured cost** ($0.016–$0.25, A-17) | No per-image price to decide or maintain. The existing per-business daily image cap stays as the abuse guard |
| **BD-5** | **What happens when an owner's allowance is gone** | Agreed in principle: **degrade, don't stop** (D-12) | The owner's assistant pauses; everything touching their clients keeps working on template text. Two conditions: the check **fails closed for the owner's own AI and open for client-facing work** — the opposite of Layer 2's kill switch and of the chat budget, both of which fail open — and a client-facing action may only be degraded once it has template text to fall back to |
| **BD-6** | **What happens to existing balances and history on day one** | Agreed in principle: **start from zero** | History is in tokens, under a rule we are replacing, for a period in which nobody was told they were metered. Leave the agent platform's balances untouched; nothing is double-charged because the two never meet |
| **BD-7** | **When the owner's dashboard changes to the new number** | Agreed in principle: **in D-2, before anything can be refused** | The number on the card today is measured against an allowance nobody is held to, in a unit we are discarding; making it true is a fix, not a feature |

---

## 11. Open questions for SA

- [ ] **SQ-1 — Where the ledger lives, and what a row holds.** A new Business OS table, one row per charged action with a unique grouping id, **the credits charged, the measured cost, the credit-value version and the fallback flag** — versus deriving totals from `token_usage` at read time. *BA leaning: a real table.* `token_usage` counts calls, not actions, holds no credits, and cannot express a grant, a period or a reconciliation. The diary (FR-26) also needs a per-action row, not a per-call one.
- [ ] **SQ-2 — Idempotency and retries.** Is a unique constraint on the grouping id the whole of FR-9, given that one action legitimately produces several calls and a retry may reuse the grouping id? SA must say what happens when a retry adds calls under an existing id: update the row's total, or append an adjustment row.
- [ ] **SQ-3 — The write path.** Write the ledger row inside the existing usage scope (non-blocking, confirmed) versus a claim-and-drain job on the §8.1 pattern. *BA leaning: a direct write* — the data is already in hand at the end of the action, and a queue adds a second way to lose a charge. FR-16 then means a failed write is an uncharged action; SA to rule on whether that is acceptable or needs an outbox. **Option B raises the stakes:** an uncharged action is money spent that no balance reflects.
- [ ] **SQ-4 — Reserve-then-settle, or check-then-charge?** *BA leaning: check before, charge after,* accepting a small bounded overspend under a burst. ⚠️ **Under option B the price is not knowable in advance** — a reservation would have to hold a guessed amount and true it up, which is the very machinery the decision avoided. Any SA ruling must account for that: a pre-check can only ask "is there anything left?", not "is there enough for this?".
- [ ] **SQ-5 — Cache freshness.** `EntitlementService` caches raw inputs for 30 s. Is a balance resolved through that cache acceptable, or does it need its own read?
- [ ] **SQ-6 — The period boundary** (T-6, still undecided): calendar month versus billing anniversary. It decides when a warning resets, when an exhausted account recovers, and what window the diary defaults to.
- [ ] **SQ-7 — Where the credit value lives, and who owns it.** `system_settings_config` (operator-changeable through a script, beside the Layer 2 area rows), or the entitlements config (engineering-owned, shipped in a release)? *BA leaning: the entitlements config* — it must be versioned with the allowances derived from it (FR-3, FR-37), and a change silently re-prices the whole product.
- [ ] **SQ-8 — Rounding precision and the reconciliation rule** (FR-6). What precision does the ledger store, and how is "the sum of the rounded lines" reconciled with "the rounded sum" so the diary never appears to disagree with the balance? *BA leaning: store at the precision of the cheapest action, display whole credits, and take the balance from the unrounded sum with a documented note.*
- [ ] **SQ-9 — The conservative fallback price** (FR-12b). What is "conservative" — the most expensive model in the same family, a fixed per-1k ceiling, or something else — and who signs off the number?
- [ ] **SQ-10 — A discrepancy to settle before TK-6 is scoped.** The tier-billing plan records F-28 as a live B-8 leak: "`app/api/business-os/usage/route.ts` already reads `user_subscriptions`". At `main` 7ba40a56 it **does not** — the only mention is a comment explaining why it deliberately does not (`route.ts:214-223`), and `usageSummary.ts` reads only `token_usage` and `tokens_per_pilot_credit`. Either F-28 is already closed, or it meant the agent-platform **rate** keys (`pilot_credit_cost_usd`, `tokens_per_pilot_credit`) that the route does read — which FR-36 removes anyway. SA to confirm which.
- [ ] **SQ-11 — Sequencing.** The entitlements plan puts S-3 metering after S-5 switch-on, which is hard-gated on G-1. This requirement proposes D-0 to D-2 ship before that, in `shadow`. Does SA accept the reordering, given that charging in shadow refuses nobody?
- [ ] **SQ-12 — The scope of FR-12, and `atLimit: 'by_call_site_audience'`.** Is "every model selectable in Layer 2's area settings has a price entry, enforced by a test" the right boundary, or must the whole `ai_model_pricing` / `FALLBACK_PRICING` path be reworked (cache warming, refresh, cached-input rates) before a charge may be derived from it? And is the declared action list (FR-4) the right home for the audience map — is the 16-entry `AiActionType` union the FR-30 inventory, or must that stay per call site?

---

## 12. Operator questions answered as-built

The user's two queued questions, answered against the code first.

**"Can an admin add or reduce a customer's credit?"** — **No, nowhere, on either side.**
- Business OS: the admin op union has no credit operation (A-14), and nothing counts AI usage, so there is nothing to grant. An admin *can* raise an account's `ai.actions` allowance with `add_override`, but with `ALWAYS_SUFFICIENT` behind `balance.ts` (A-10) the value has no effect.
- Agent platform: no admin route writes a balance (A-14). A Pilot-Credit balance moves only by the signup grant, an agent-run charge, or a Stripe purchase (`CreditService.ts:30-82`, `:444`).
- **The gap is FR-30 (grant / reduce, audited) and FR-31 (read the position).** It is needed before enforcement, not after: the champion policy is literally "when they hit the cap, an admin grants credits" (D-7), and that path does not exist.

**"Is there a subscription-expiry lock?"** — **Half of one, and it fails open (A-15).**
- Agent platform: `checkExecutionAllowed` blocks an agent run on `account_frozen` or insufficient balance, but returns `allowed: true` on any DB error or a missing subscription row; and the cron that would set `account_frozen` is not scheduled, so in practice nothing freezes.
- Business OS: the lifecycle (trial → grace → paused) and per-account expiry exist and resolve correctly, but the mode is `shadow`, so an expired account is refused nothing (A-13).
- **The gap is FR-32**: an expired Business OS plan must stop owner-facing AI through the entitlements lifecycle — explicitly **not** by reusing `account_frozen`, which is an agent-platform flag also read by agent generation and would freeze a paying Business OS customer.

---

## 13. Out of scope

| Item | Where |
|---|---|
| Boost purchase, auto top-up, add-ons, annual pricing | S-4b |
| Enforcement switch-on and G-1 key rotation | S-5 |
| Reconciling our cost figure against the provider's invoice; cached-input and batch rates | Follow-up. FR-12 removes silent $0 and flags a guessed price; it does not claim our figure equals OpenAI's bill |
| Any change to Pilot Credits, `CreditService`, `pricingConfig` or the agent charge path | Forbidden here (A-11); retirement is WS-3 |
| SMS metering and email fair-use | Same mechanism, later — a credit extends to them |
| An all-businesses usage overview | Layer 1.1 F-2 |
| Making AI audit entries durable (Layer 3 KI-B / OI-D) | Separate; FR-15 removes the billing dependency on it |

---

## 14. Known issues and open items

| Id | Description | Status |
|---|---|---|
| **KI-1** | **The same action costs different amounts on different days**, and support cannot quote a price in advance. Accepted with BD-1; mitigated by the diary (FR-26) and the own-history range (FR-27) | **Accepted by the user, 2026-09-28** |
| **KI-2** | A fallback-priced charge (FR-12b) is a **deliberate over-estimate**, so an owner can be charged slightly more than we actually paid until it is reconciled. Flagged, counted and reconciled — never silent | Accepted; watch the count |
| **KI-3** | The image reuse cache means the ledger charges **generations**, not requests; a repeated request is free and absent from the diary. Consistent with FR-7, but anyone auditing image spend must know it | Informational (Layer 1.5 KI-B) |
| **KI-4** | Two dormant action types (`website_section_field_rewrite`, `website_block_enrichment`) have no production trigger. They must be declared and given a diary label anyway, or they arrive unlabelled the day they are wired | Declared in D-0 |
| **KI-5** | A small bounded overspend is possible under a concurrent burst (SQ-4), and under option B a pre-check cannot know what the next action will cost | Accepted, pending SA |
| **KI-6** | Chat v2 and v1 are outside the call catalog and choose their own model; their spend is not in the eight areas and so is not chargeable by FR-4 | Pre-existing (Layer 2); state it, do not fix it here |
| **KI-7** | An image is priced as `high` when the provider reports no quality (Layer 1.5 KI-E), so its recorded cost is an upper bound. Under option B that upper bound is **charged**; frequent warnings mean owners are being charged conservatively | Informational; watch the warning count |
| **OI-1** | Client-facing actions with **no** template fallback are found in D-0 and built in D-3. Until then, FR-20 cannot be satisfied for them | Open, sized in D-0 |
| **OI-2** | The credit value, every allowance in the tier matrix and every `PLACEHOLDER` in `cohorts.ts` are guesses until D-1b (FR-37) | Open by design |
| **Closes** | Q1 (what a credit represents) and OQ-7 (images) by BD-1; Q6 (do failed attempts count) by FR-8 — **yes, at what was actually spent**; OI-1 (background work on the card) and UD-1 (onboarding in a new owner's first month) by BD-2, BD-3 and the diary | Resolved, pending SA review |

---

## 15. Notes on integration points

| Area | Files |
|---|---|
| The action wrapper and the declared list | `lib/business-os/llm/aiActionAudit.ts` (`AiActionType` `:38-54`, the per-action summary `:179-218`, `runAiAction` `:267-293`), `lib/ai/usageScope.ts` |
| The catalog of areas and calls | `lib/business-os/llm/callCatalog.ts:37-84` |
| Cost, and FR-12 | `lib/ai/pricing.ts` (`calculateCostSync` `:250-275`, `FALLBACK_PRICING`), `ai_model_pricing`, the Layer 1.5 per-image prices in `system_settings_config` |
| Layer 2 area settings (which models an operator can select) | `lib/business-os/llm/modelSettingsPolicy.ts`, `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` |
| The seam, the resolver and the allowances | `lib/business-os/entitlements/balance.ts`, `EntitlementService.ts`, `config/catalog.ts:293-305`, `config/tierMatrix.ts`, `config/cohorts.ts` |
| Admin operations | `lib/business-os/entitlements/adminOps.ts`, `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` |
| Owner surface (card and diary) | `app/api/business-os/usage/route.ts`, `lib/business-os/usage/usageSummary.ts`, `components/business-os/UsageCard.tsx`, `lib/business-os/LanguageContext.tsx` (diary labels) |
| Existing guards to relate to, not replace | `lib/business-os/bizql/telemetry/ChatBudget.ts`, `lib/services/GeneratedImageService.ts:170-183` |
| Deliberately untouched | `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/route.ts`, `user_subscriptions`, `credit_transactions`, `billing_events` |
| Documents this layer answers to and changes | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §11, `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.2 (S-3), `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (credit value and allowances, FR-37), `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` §E, §K |

---

## 16. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | The last layer of the Business OS LLM standards effort, parked since 2026-09-16. Written as the entitlements programme's S-3 metering seen from the LLM side: 31 FRs, 22 ACs, a five-slice plan, BD-1 to BD-7 and SQ-1 to SQ-10 |
| 2026-09-28 | Currency reopened; BD-1 promoted to a "Decide first" section | The user's framing: the app needs a **currency**, and tier allowances are derived from it — and the 250/500/1,000/2,000 numbers are invented and sold to nobody, so the unit was genuinely open. The user rejected a flat count of AI actions as not cost-linear. Three options set out (price list / live cost / tokens ÷ 10); recorded that "weighted actions" *is* the price-list option, and that `tokens ÷ 10` is not cost-based either — model-blind while Layer 2 lets an operator change the model, and images have no tokens so they would be free. 35 FRs, 25 ACs |
| 2026-09-28 | **BD-1 DECIDED — option B, credits charged at live measured cost** | **One credit is a fixed amount of real provider cost** (~$0.001; the exact value is set with the allowances in D-1b); every action is charged **its own measured cost after it ran**; no prediction, no price list, no re-derivation when a model changes. The user's reason: simpler, and per-action cost cannot be predicted (chat above all), so everything after the fact means no stale price to lose money on and nothing to recalculate. **Knowingly accepted, recorded as KI-1:** the same action varies day to day, and support cannot quote in advance. **New: the credit diary (FR-26)** — a per-action history of time, area, plain-language action, trigger, outcome and credits, which reconciles with the balance and carries no prompt, owner text, model output, tokens or dollars; it ships with the card in **D-2**, because under option B it *is* the owner's predictability. **FR-27** adds a typical range drawn from the owner's own history, labelled as past spend and never a price. The four approved rules specified: **FR-12** tightened (loud failure, a conservative documented fallback rather than a zero charge, a flagged row, operator surfacing, reconciliation by adjustment); **FR-6** rounding (fractional storage, rounded display, diary reconciles with balance); **FR-8 / FR-9** failed and retried actions charged what was actually spent, with idempotency protecting against double-recording the same spend rather than against charging real spend; **FR-5** fan-out needs no multiplier and the pre-check estimate is never the charge. §2 rewritten as resolved, with the option table kept for the record and short reasons why A and C were not chosen. SQ-2, SQ-3 and SQ-4 updated for the "price not knowable in advance" consequence; **SQ-8** (rounding precision and the reconciliation rule) and **SQ-9** (what "conservative" means) added. D-1 now measures to set the **credit value**, not a price list. Now **38 FRs, 28 ACs**; BD-4 settled by BD-1; Q1, Q6 and OQ-7 closed |
