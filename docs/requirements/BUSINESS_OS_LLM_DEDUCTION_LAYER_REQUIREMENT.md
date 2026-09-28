# Requirement: Business OS AI Deduction Layer (LLM standards, last layer)

> **Last Updated**: 2026-09-28

**Created by:** BA
**Date:** 2026-09-27
**Status:** **Draft — blocked on the currency decision (BD-1), then SA review.** BD-2 to BD-7 agreed in principle; SQ-1 to SQ-12 open

## Overview

Business OS tracks every AI call and charges for none of them. Layers 1, 1.1, 1.5, 2 and 3 made the tracking correct — every call attributed to the business, with an area, a call name, a grouping id, tokens, an estimated cost and one audit entry per action. This layer turns that record into a **charge**: a currency, a rule for what an owner spends, a place to record it, a truthful number on the dashboard, and a defined behaviour when the allowance is gone.

**What is already settled** is the plumbing and the grain: `runAiAction` already treats one AI action as a first-class object, and `lib/business-os/entitlements/balance.ts` is an empty socket waiting for exactly this. This layer is the **S-3 Metering** slice of the entitlements programme, written from the LLM side so the parked LLM questions (Q1, Q6, OQ-7, OI-1, UD-1) are answered with it rather than beside it.

**What is not settled is the currency** — what one credit is worth, and therefore what anything costs. The ledger, the card and every tier allowance depend on it, so it is decided first (§2).

---

## Table of Contents

1. [What is already true](#1-what-is-already-true)
2. [Decide first: what one credit is (BD-1)](#2-decide-first-what-one-credit-is-bd-1)
3. [Scope](#3-scope)
4. [User Stories](#4-user-stories)
5. [The grain, and what counts](#5-the-grain-and-what-counts)
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
| **A-3** | **Our dollar figure is not trustworthy yet.** An unpriced model records **$0** with a warning; the sync path reads only the in-memory cache, then a hardcoded fallback list. Any cost-derived currency depends on fixing this first (FR-11) | `lib/ai/pricing.ts:250-275`, `:267-270` |
| **A-4** | **The owner's allowance is display-only**, derived as `monthly_ai_allowance_usd ÷ pilot_credit_cost_usd` (≈20,833 credits at the $10 default), and the card counts **down** against it | `app/api/business-os/usage/route.ts:115-138`, `:232-236`; `components/business-os/UsageCard.tsx:108-117` |
| **A-5** | **The Pilot-Credit ledger understates consumption ~13×** (202,414 credits recorded against 2,637,147 consumed on a real account), because only agent runs write to it | `app/api/business-os/usage/route.ts:214-223` |
| **A-6** | **Only two things stop a Business OS owner today**, and both are daily caps, not allowances: the chat daily budget (200 turns / 2,000,000 tokens, counting **distinct turns**) and the per-business daily image cap. The chat budget **fails open** on a read error | `lib/business-os/bizql/telemetry/ChatBudget.ts:51-52`, `:98`, `:173-189`; `lib/services/GeneratedImageService.ts:170-183` |
| **A-7** | **One AI action is already a first-class object in code.** `runAiAction` opens a usage scope per grouping id and summarises the action's calls — count, failed count, tokens, **estimated cost**, call names, models, outcome — into one audit entry. There are **16 declared action types**, two dormant | `lib/business-os/llm/aiActionAudit.ts:38-54`, `:179-218`, `:267-293` |
| **A-8** | **That audit entry cannot be the billing record.** It is queued, never awaited, and a failed insert loses its whole batch (accepted as Layer 3 KI-B) | `lib/business-os/llm/aiActionAudit.ts:316`, `:304`; `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:551` |
| **A-9** | **The allowance numbers are invented and nothing is sold against them.** `ai.actions` is a `metered` capability (unit `ai_action`, period `month`, `atLimit: 'by_call_site_audience'`); the four plans carry 250 / 500 / 1,000 / 2,000 a month, described in the doc itself as "a first pass… reset here from the shadow report", and every cohort quantity is a `PLACEHOLDER` | `lib/business-os/entitlements/config/catalog.ts:293-305`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:53`, `:133`, `:40-47` |
| **A-10** | **The seam exists and is empty.** `ALWAYS_SUFFICIENT` answers "yes" to every balance question so that this layer needs no call-site migration | `lib/business-os/entitlements/balance.ts:20-49` |
| **A-11** | **Business OS must not touch the Pilot-Credit tables.** RD-2: Business OS billing never writes `user_subscriptions` / `credit_transactions`, and no Business OS surface may read them. The ledger behind `balance.ts` is a **BUILD NEW** row (L-22) | `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:351`, `:176` |
| **A-12** | **The mechanics of metering are already specified** in §11 and FR-23 to FR-30, FR-36, FR-41, FR-42: monthly, no roll-over, allowance then boost, degrade-don't-stop, 80/100% warnings, one visible allowance. Only the **unit** is reopened by BD-1 | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md:379-394`, `:475-482`, `:497`, `:502-503` |
| **A-13** | **Nothing is enforced.** `BOS_ENTITLEMENTS_MODE=shadow` in production on purpose; a refused `enforce` also runs as `shadow` | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9`, `:148-151` |
| **A-14** | **No admin can add or reduce a customer's AI balance.** The admin op union is `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state` — no credit grant, and no admin route anywhere writes a credit balance | `lib/business-os/entitlements/adminOps.ts:76-80`; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:172`; no match under `app/api/admin/**` |
| **A-15** | **The expiry lock is half-built and fails open.** `checkExecutionAllowed` blocks an agent run on `account_frozen` or an insufficient balance but returns `allowed: true` on any DB error or missing row; the cron that would set `account_frozen` is **not scheduled** | `lib/services/CreditService.ts:388-438` (`:404-408`); `app/api/run-agent/route.ts:104-135`; `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:108-110` |
| **A-16** | **Layer 2's kill switch fails open** by design — an area whose settings read fails keeps calling on code defaults. It also lets an operator **change an area's model in configuration**, which is why any unit must survive a model change | `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` §5, §3 |
| **A-17** | **Real cost per action is spread wide.** A chat turn is fractions of a cent (measured over 1,000 calls: p50 $0.000594, p99 $0.000747); a website generation is cents; one image is **$0.016–$0.25** and carries **zero tokens** | `lib/business-os/bizql/telemetry/ChatBudget.ts:7-13`; per-image pricing by model / size / reported quality, Layer 1.5 FR-10, FR-13 |

**The consequence, in one line:** the plumbing, the grain and the socket all exist; what is missing is a **currency**, a counter, a truthful dashboard number and a defined behaviour at zero.

---

## 2. Decide first: what one credit is (BD-1)

**This layer cannot be built until the currency is chosen.** The ledger stores a price, the card shows a balance, and every tier allowance is a number of these things — so the ledger's columns, the card's wording and the plans' contents all follow from this one decision, and none of them can be built ahead of it.

**What is not in question.** The product needs a currency the owner spends — an **AI credit**. The **grain** at which spend is measured stays the AI action: one chat turn, one insight run, one website generation, one image. That object already exists in code, with its tokens and its estimated cost (A-7). Credits are the currency; actions are what gets priced. The question is only **what one credit is defined against**.

**Why a flat count of AI actions was dropped.** It is the simplest thing to explain, and the 250 / 500 / 1,000 / 2,000 allowances are already written in that unit — but the underlying actions are **not cost-linear**. A chat turn and a generated image differ by roughly a factor of 300 (A-17), so charging both 1 is not sound economics: it either over-prices the cheap action or gives the expensive one away. The numbers it is written in are invented and sold to nobody (A-9), so nothing is lost by re-deriving them.

**Why today's rule is no better.** Credits as `tokens ÷ 10` (A-2) look cost-based and are not. They are **model-blind**: a gpt-4o token costs roughly 16× a gpt-4o-mini token and both count as one tenth of a credit — and Layer 2 lets an operator change an area's model in configuration (A-16), so the same action silently changes what it costs us without changing what it costs the customer. And **an image has no tokens at all**, so the most expensive action in the product would cost **zero**.

### The three options

| | **A. Credits with a per-action-type price list** | **B. Credits charged at live measured cost** | **C. Credits = tokens ÷ 10** |
|---|---|---|---|
| **What one credit is** | A fixed unit of value (e.g. 1 credit ≈ $0.001). Each action type has a published price in credits, set from its measured cost | The same fixed unit, but each action is charged its own actual cost at the moment it ran | One tenth of a token, whatever that token cost |
| **What the owner sees** | "A website generation costs 30 credits; you have 4,200 left" — the price is knowable **before** acting | "You have 4,200 credits left" — what the next action costs is knowable only afterwards | A number that moves at a rate nothing explains |
| **What we can bill on** | A price list we control, re-derived from measurement when models or prices move | Our actual spend, exactly | Nothing safely: the figure tracks neither cost nor value |
| **What must be true for it to work** | The cost figure is trustworthy (FR-11), and cost per action type has been measured (slice D-1) | The same, **per call, every time** — here a wrong price is charged to a customer, not merely reported | Nothing new. It works today, badly |
| **Failure mode** | An action type whose real cost drifts is mispriced until the list is re-derived — visible, bounded, fixed by a config change | The same action costs a customer different amounts on different days, and a gap in the price table charges **$0** silently. Unpredictable for the owner, unquotable in support | Images are free, and a model change silently moves our cost without moving the customer's price |
| **Verdict** | ✅ **Recommended** | Viable, but exactness bought at the price of predictability | ❌ Advise against |

**The BA recommendation is A.** It is the only option that is simultaneously cost-linked, stable enough to publish, predictable for the owner, and changeable without code — re-pricing is editing a list. Option B's extra accuracy buys nothing commercially (margin is judged per month, not per call) and costs the one property an owner most needs: knowing what something costs before doing it. Option C is the status quo, and fails on its own terms.

**A "weighted action" is option A.** Weighting actions (an image is worth 30, a chat turn 1) and a credit price list are the same mechanism with the same data behind them; only the label on the unit differs. Nothing is lost by calling it a credit — and a credit extends to non-AI metered things later (SMS) where "actions" does not.

### What follows from each option

| Depends on BD-1 | Under A | Under B | Under C |
|---|---|---|---|
| The ledger row | Stores the price charged **and** the action type | Stores the price charged per action | Stores the tokens |
| The card | Credits left, with a price list the owner can consult | Credits left only | Credits left, meaning nothing |
| Tier allowances | Derived: target AI cost per tier ÷ credit value (FR-34) | Same | Would have to be re-derived too |
| Pricing accuracy (FR-11) | **Prerequisite** | **Prerequisite, and stricter** | Not needed — which is the tell |
| Images (BD-4) | Their own price line | Charged at actual | **Free** — the flaw |
| A model change by an operator (A-16) | Re-derive one line in the list | Automatic | Silent mispricing |

---

## 3. Scope

**In scope**

- The currency (§2) and the rate or price list behind it, as configuration.
- Making the cost figure trustworthy enough to derive a price from (FR-11).
- What one action is at each of the catalogued areas, and what is not charged.
- A durable per-action ledger, with idempotency, and the real implementation behind `balance.ts`.
- The owner-facing number: the usage card in credits against the plan's allowance.
- Deriving the tier allowances from measurement rather than inventing them (FR-34).
- Behaviour at the limit, per audience, and how it relates to the chat daily budget.
- Admin grant / reduce, and how an expired subscription stops AI spend.
- Day-one treatment of existing balances and history.

**Not in scope**

| Item | Where it belongs |
|---|---|
| Buying a plan, boost purchase, auto top-up, annual | S-4a / S-4b (`BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.2) |
| Switching enforcement on (needs G-1 key rotation) | S-5 |
| Any change to Pilot Credits, `CreditService`, `user_subscriptions` or the agent platform's charge path | Out — forbidden by B-8 / RD-2 (A-11) |
| Reconciling our cost figure against the provider's invoice | Follow-up. FR-11 removes silent $0; it does not claim our figure equals OpenAI's bill |
| Non-AI metering (SMS, email fair-use) | Same mechanism later; a credit extends to it, an "action" does not |

---

## 4. User Stories

- As **a business owner**, I want the dashboard to tell me how much I have left of what my plan includes, in a unit whose price I can look up before I act.
- As **a business owner**, I want to know which of that was work I asked for and which the product did for me overnight, so a falling number is never a mystery.
- As **a business owner who has used everything up**, I want my clients to keep getting replies and reminders, and to be told plainly that the assistant is paused until next month or an upgrade.
- As **a new owner**, I don't want my setup conversation to eat a meaningful part of my first month.
- As **an admin**, I want to give a design partner or an unhappy customer more credits, and to take them back, with a reason and an audit entry.
- As **the business owner (Barak)**, I want each plan's allowance to be derived from what it actually costs us to serve, not from a number somebody invented.

---

## 5. The grain, and what counts

The **grain** is one AI action, under every option in §2. The rules below decide *whether* something is charged; *how much* follows from BD-1.

| Question | Rule | Depends on BD-1? |
|---|---|---|
| **The grain** | One entry of `AiActionType` (A-7): one chat turn, one insight run for one business, one briefing narration, one website or landing-page generation, one intake form generation, one lead reply, one onboarding turn, one image. An action that makes five LLM calls is still **one action** | No |
| **The price of an action** | Option A: its price-list entry. Option B: its measured cost. Option C: its tokens ÷ 10 | **Yes** |
| **Owner-triggered** | Charged | No |
| **Background (nightly insights, daily briefing, automatic lead replies)** | Charged, and reported as its own line (BD-2) | No |
| **Setup (onboarding, first website / intake generation, regenerations)** | Charged, against the trial's one-off total (B-12, FR-41) | No |
| **Images** | Charged. Under A they get their own price line; under B their actual per-image cost; **under C they are free**, which is the flaw in C (BD-4) | **Yes** |
| **A failed call inside a successful action** | Adds nothing. The action is charged once | No |
| **An action that failed outright** | Not charged — the owner does not pay for our failure | No |
| **A retry of the same action** | Charged once; the grouping id is the idempotency key | No |
| **A cache hit (chat plan cache, image reuse)** | Not charged — no LLM call was made | No |
| **Agent-platform work** | Never charged here; Business OS never reads or writes the Pilot-Credit balance (A-11) | No |

---

## 6. Functional Requirements

### The currency and the grain

1. **FR-1** The customer-visible unit of AI usage in Business OS is a **credit**. The unit at which spend is measured and priced is **one AI action** (§5). Credits are the currency; actions are what is priced.
2. **FR-2** An action's price in credits is resolved from **one** configured rate — a per-action-type price list (option A), a cost-to-credit conversion (option B), or a token divisor (option C). No call site writes a price, and there is exactly one resolver.
3. **FR-3** The rate is **configuration**, changeable without a code change and versioned. Changing it **never rewrites history**: consumption already recorded keeps the price it was charged at, and the change is auditable (who, when, from what, to what).
4. **FR-4** The set of chargeable actions is derived from **one** declared list, shared with the audit layer, so an action cannot be audited without being chargeable or vice versa. Each entry declares: its area, its **audience** (owner-facing or client-facing), whether it is **setup AI**, whether it is charged, and its template fallback where it is client-facing.
5. **FR-5** A fan-out action (one instruction applied to many records) is charged `n` times its action price; the seam already accepts `n`.

### What counts

6. **FR-6** An action that makes no LLM call is not charged — including a chat turn served from the plan cache and an image served from the reuse cache.
7. **FR-7** An action whose outcome is `failed` is not charged. A failed call inside an action that succeeded does not add to its price.
8. **FR-8** The same action, identified by its grouping id, can never be charged twice, however many times its code path runs or retries.
9. **FR-9** Background (`trigger: 'scheduled'`) and external (`trigger: 'external'`) actions are charged to the business whose account they ran for, and recorded with their trigger so they can be reported separately.
10. **FR-10** Tokens and estimated cost continue to be recorded per call exactly as today, and every charged action records the tokens and cost behind its price, so any price can be traced back to what it was derived from.
11. **FR-11** **No price may be derived from a cost figure that can silently be wrong.** Before options A or B can price anything: a model with no price entry must **fail loudly** — logged at `error` and surfaced to operators — and never be recorded as $0; every model an operator can select in Layer 2's area settings must have a price entry, checked automatically; and a per-image price must resolve for every configured model, size and quality. This is a prerequisite inside the first slice, not a follow-up.

### The ledger and the charge path

12. **FR-12** Consumption is recorded in a **Business OS-owned ledger**, one row per charged action, carrying: the account, the grouping id (unique), the area, the action type, the trigger, **the credits charged and the rate version used**, the period it falls in, the action's tokens and estimated cost for reference, and the time.
13. **FR-13** The ledger is **not** `user_subscriptions`, `credit_transactions` or `billing_events`, and no Business OS code reads or writes those (A-11). All access goes through a repository in `lib/repositories/`, scoped by account.
14. **FR-14** The ledger write is **not** the audit queue. It must be a direct, confirmed write; the audit entry stays as it is and remains joinable by the grouping id (A-7, A-8).
15. **FR-15** A ledger write failure never fails the owner's action, and is logged at `error` with the account, area, action type and grouping id — so an uncharged action is discoverable rather than silent.
16. **FR-16** `balance.ts`'s real implementation answers from the ledger plus the account's entitled allowance and any grant balance: consumption order is **period allowance first, then grants** (soonest-expiring first). No call site changes.
17. **FR-17** The period allowance **resets each period and does not roll over** (B-6). The trial's allowance is a one-off total, not monthly, and using it up ends the trial.

### At the limit

18. **FR-18** When an account's allowance is exhausted, behaviour follows the action's **audience**: client-facing actions **degrade** to their template fallback and still run; owner-facing AI **pauses** with an explanation (D-12).
19. **FR-19** No client-facing automation may be stopped by an exhausted allowance. Where a client-facing action has no template fallback, this layer builds one before that action can be degraded.
20. **FR-20** The balance check **fails closed for owner-facing AI** and **fails open for client-facing** actions, and every fallback is logged at `error`. This is deliberately unlike Layer 2's kill switch (A-16) and unlike the chat daily budget (A-6), and the difference is stated in code.
21. **FR-21** The chat daily budget stays as it is and is a **separate, additional** guard: it caps a day, the allowance caps a period. A refusal names which one stopped the turn, and the two are never presented to the owner as one number.
22. **FR-22** Warnings fire at configurable thresholds (default **80%** and **100%**), once per threshold per period. Before a **setup** action that would exhaust or nearly exhaust a trial allowance, the owner is warned first, told what remains, and can cancel (FR-42).

### What the owner sees

23. **FR-23** The usage card reports **credits used out of the allowance the account's plan entitles it to** — read from the entitlements resolver, not from `monthly_ai_allowance_usd ÷ pilot_credit_cost_usd` (A-4).
24. **FR-24** The card separates **what the owner asked for** from **what ran automatically**, at least as two figures, so a number that fell overnight is explainable (OI-1).
25. **FR-25** The card never shows tokens or dollars to an owner. Under option A the owner can also see **what each kind of action costs**: the price list is customer-facing, because a price nobody can look up is not a price.
26. **FR-26** Where an account has no entitled allowance (nothing configured, or an unresolvable plan), the card shows consumption with no gauge, as it does today for a missing allowance.

### Operator

27. **FR-27** An admin can **grant** credits to one account (amount, reason, optional expiry) and **reduce or end** a grant, through the existing admin operations path: `requireAdmin` first, Zod-validated, audited with actor, target, before/after and reason, never available to a user on their own account.
28. **FR-28** An admin can read one account's current position — allowance, used, granted, remaining, and which layer decided the allowance — without SQL.
29. **FR-29** An account whose plan has expired or lapsed consumes no further owner-facing AI, decided by the entitlements lifecycle, not by a frozen flag on the agent-platform subscription row (A-15).
30. **FR-30** An operator-readable report gives, per account and period: credits used by area, by action type and by trigger, **with the measured cost behind them**. This is the report the rate and the tier allowances are derived from (FR-34).

### Day one, allowances and rollout

31. **FR-31** Charging starts at a stated moment. **No historical usage is converted into credits**, and no account starts its first metered period with anything already spent.
32. **FR-32** Existing Pilot-Credit balances are left exactly as they are, are never read by Business OS, and have no effect on a Business OS allowance. The ~13× understatement (A-5) becomes irrelevant rather than being reconciled.
33. **FR-33** Exactly **one** AI allowance is visible to a Business OS owner. The display-only `monthly_ai_allowance_usd` path is retired from the owner surface in the same release that introduces the new one (T-9).
34. **FR-34** **Tier allowances are derived, not invented.** Each plan's allowance = the target AI cost the business is willing to carry for that plan ÷ the value of one credit, using the measured cost per action type from FR-30. The existing 250 / 500 / 1,000 / 2,000 are **placeholders** and are replaced in the same change, along with every `PLACEHOLDER` cohort quantity; the derivation (target cost, credit value, measured inputs, date) is recorded next to the numbers. This touches `lib/business-os/entitlements/config/tierMatrix.ts`, `config/cohorts.ts` and `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, and the capability's `unit` changes from `ai_action` to the chosen credit unit.
35. **FR-35** The layer ships behind the existing entitlements mode: in `shadow` it charges, reports and warns and refuses nothing; only `enforce` applies FR-18 to FR-20.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | A balance check adds at most one cached lookup per request or turn, resolved once and reused. The ledger write never blocks the owner's response. Background runs resolve in batch per run, not per item. |
| **Correctness** | One action = at most one ledger row, guaranteed by a uniqueness constraint on the grouping id, not by application care alone. A concurrent burst may overspend an allowance by a small, bounded amount; it may never double-charge one action. A price is never recorded without the rate version that produced it. |
| **Security** | Account, allowance, rate and grant values are never taken from a request body. Admin authority only via `requireAdmin` / `admin_users`, never `profiles.role`. Every ledger read and write is account-scoped through a repository; the table is server-write-only (the money-table lockdown pattern). |
| **Observability** | Pino structured logs for every `limit_reached`, degrade, pause, warning, grant, rate change, failed ledger write and **unpriced model** (FR-11), with account, area, action type, grouping id and correlation id. No prompt text, owner text or model output, matching Layer 3's rules. |
| **Auditability** | Every grant, reduction and rate change is an audit entry. Every charged action is already audited (A-7); the ledger row and the audit entry share the grouping id, so the two can be reconciled. |
| **Testability** | Pricing and counting rules are unit-testable with no provider: the price of each action type, 0 for a cache hit, 0 for a failed action, once for a retry, `n` for a fan-out, an unpriced model failing loudly, and audience-dependent behaviour at zero. A source-level test fails if a declared action type has no price, no audience or no counting rule. |
| **Logging debt** | This layer does not touch `lib/services/CreditService.ts` or `lib/utils/pricingConfig.ts` (A-11), so their `console.*` calls stay out of scope. If a slice ends up touching either — or `lib/ai/pricing.ts` for FR-11 — CLAUDE.md rule 3 applies and the conversion is raised with the user first. |

---

## 8. Acceptance Criteria

**Currency and pricing**

- [ ] **AC-1** (FR-1, FR-2) Every chargeable action type resolves a price through one resolver; a code review finds no price, weight or divisor written at a call site.
- [ ] **AC-2** (FR-3) Changing the rate changes what new actions cost and leaves every already-recorded row at its original price; the change writes one audit entry with before and after.
- [ ] **AC-3** (FR-11) A model with no price entry produces an `error` log and an operator-visible signal, and **no $0 cost row**; a test enumerates every model selectable in Layer 2's area settings and fails if any has no price; a per-image price resolves for every configured model / size / quality.
- [ ] **AC-4** (FR-5) One action that made five LLM calls is charged once; a declared fan-out over 12 records is charged 12× its action price.

**What counts**

- [ ] **AC-5** (FR-6) A chat turn served from the plan cache and a second identical image request (reuse cache) are each charged **0**, and neither moves the owner's balance.
- [ ] **AC-6** (FR-7) An action that failed is charged 0; an action with one failed call and a successful outcome is charged once.
- [ ] **AC-7** (FR-8) Replaying the same grouping id — the same action retried, or its handler invoked twice — leaves exactly one ledger row.
- [ ] **AC-8** (FR-4, FR-9) Every declared action type has a price, an audience, a setup flag and a counting rule, asserted by a test that fails when a new type is added without them. A nightly insight run and a daily briefing are each charged to their own business with `trigger: 'scheduled'`.

**Ledger**

- [ ] **AC-9** (FR-12, FR-13) A ledger row carries the credits charged and the rate version; a code review finds no Business OS read or write of `user_subscriptions`, `credit_transactions` or `billing_events`, and no direct Supabase call outside `lib/repositories/`.
- [ ] **AC-10** (FR-14, FR-15) With the audit queue stubbed to fail, the ledger row is still written; with the ledger write forced to fail, the owner's action still succeeds and one `error` log names the account, area, action type and grouping id.
- [ ] **AC-11** (FR-16, FR-17) An account with 10 credits remaining and a 25-credit grant spends the 10 first; a new period resets consumption to zero and carries nothing over; a used-up trial total ends the trial.

**At the limit**

- [ ] **AC-12** (FR-18, FR-19) With the allowance exhausted and mode `enforce`: a lead reply still goes out, with template text; a chat turn is refused with a normal assistant message that names the plan and the reset, and the conversation stays usable.
- [ ] **AC-13** (FR-20) With the ledger unreadable: an owner-facing AI action is refused and logged at `error`; a client-facing automation runs.
- [ ] **AC-14** (FR-21) A turn refused by the daily chat budget and a turn refused by the period allowance produce different, correctly named refusals.
- [ ] **AC-15** (FR-22) Crossing 80% fires once in the period and not again; a setup regeneration that would exhaust a trial allowance warns before running and can be cancelled.

**Owner surface**

- [ ] **AC-16** (FR-23, FR-24, FR-26) The card shows credits used out of the resolved plan allowance, splits owner-triggered from automatic, and falls back to "consumption, no gauge" when no allowance resolves.
- [ ] **AC-17** (FR-25) The card renders no token or dollar figure; under option A the owner can reach a price list whose figures match the resolver's.
- [ ] **AC-18** (FR-33) After the release, no owner-facing surface derives an allowance from `monthly_ai_allowance_usd`.

**Operator**

- [ ] **AC-19** (FR-27) A grant and a reduction each: require an admin, reject an invalid body with 400, write one audit entry with actor, target, before/after and reason, and change the account's remaining balance. A non-admin, and a user aiming the operation at their own account, are both refused.
- [ ] **AC-20** (FR-28, FR-30) One account's allowance / used / granted / remaining and the deciding layer are readable without SQL, and the per-area, per-action-type, per-trigger report — with measured cost — reproduces the same totals.
- [ ] **AC-21** (FR-29) An account whose plan has lapsed consumes no owner-facing AI, with no dependence on `account_frozen`.

**Allowances, day one and rollout**

- [ ] **AC-22** (FR-34) No plan or cohort allowance remains at a placeholder value; each carries its derivation (target cost, credit value, measured input, date), and the entitlements doc and the capability's `unit` match what shipped.
- [ ] **AC-23** (FR-31, FR-32) On the day charging starts, every account reads zero spent; no historical `token_usage` row is converted; no Pilot-Credit balance changes.
- [ ] **AC-24** (FR-35) In `shadow`, a fully exhausted account is refused nothing, while the ledger, the report and the warnings all work. Flipping to `enforce` is the only thing that changes behaviour.
- [ ] **AC-25** (end-to-end, non-production) On a test business: an onboarding conversation, an insight run, a briefing, a website generation, a lead reply, a chat turn and an image are each charged the expected number of credits; the card's figures before and after are recorded; the audit entry and the ledger row for each action carry the same grouping id. A concurrency test proves no double-charge of one action and records the measured overspend under a burst.

---

## 9. Slice plan

Each slice ships alone and leaves the product working. **D-0 to D-2 do not depend on G-1 or on enforcement switch-on** — they measure, charge in shadow and tell the truth, which is also the evidence the tier allowances need.

| Slice | Delivers | Why first / notes |
|---|---|---|
| **D-0 Rules, and a trustworthy cost** | The declared action list (audience, setup flag, chargeable, template-fallback status) as code with a guard test, **and FR-11**: unpriced models fail loudly, every Layer 2-selectable model has a price, image prices resolve. No behaviour change. | Nothing cost-derived can be built on a figure that silently reads $0 (A-3). This is also where the *missing* client-facing template fallbacks are found, rather than discovered at the limit. |
| **D-1 Measure, then price** | Per-action-type cost measurement across real accounts, the resulting **rate / price list** as configuration, and the operator report (FR-30). Charging runs in shadow: the ledger fills, nothing is refused, nothing owner-facing moves. | Produces the evidence for the price list **and** for FR-34's allowances. Answers OQ-7, OI-1 and UD-1 with numbers instead of argument. Blocked on BD-1. |
| **D-1b Derive the allowances** | Replace 250 / 500 / 1,000 / 2,000 and every `PLACEHOLDER` cohort quantity with derived figures, record the derivation, update the capability `unit` and the plans doc (FR-34). | A config change, gated by D-1's measurement. Small — but it is the moment the plans stop being invented. |
| **D-2 Tell the owner the truth** | The usage card in credits against the resolved plan allowance, split owner-triggered vs automatic; the price list surfaced (option A); the display-only allowance retired from the owner surface. | The first owner-visible change, and the last one that is safe to make before anything can be refused. |
| **D-3 Behave at zero** | The real `balance.ts`, warnings at 80/100%, the setup pre-warning, degrade-vs-pause by audience, the fail-closed/fail-open split, and the relationship to the chat daily budget — all still inert in `shadow`. | Built and reviewable before it can refuse anyone; turns on with the entitlements flag, not with its own. |
| **D-4 Operator controls** | Admin grant / reduce, the per-account position view, and the lapsed-plan stop. | Needed before enforcement is live, or the first exhausted champion is a support ticket with no remedy (D-7). |

Selling credits (boost purchases, auto top-up) stays in S-4b. This layer only needs a grant to **exist**; selling one does not.

---

## 10. Business decisions for the user

| # | Decision | Status | BA recommendation |
|---|---|---|---|
| **BD-1** | **What one credit is defined against** — see [§2](#2-decide-first-what-one-credit-is-bd-1) for the three options, what each shows the owner, what each lets us bill on, and how each fails | **OPEN — everything else waits on it** | **Option A: credits with a per-action-type price list, derived from measured cost.** Cost-linked, publishable, predictable for the owner, re-priced by editing config. A "weighted action" is the same thing under another name |
| **BD-2** | **Does work the product does on its own — nightly insights, the daily briefing, automatic lead replies — come out of the owner's allowance?** | Agreed in principle: **yes, with its own line on the card** | Unaffected by BD-1. It is real spend, and an uncounted channel is an uncapped one — but an owner must never watch a number fall on a day they did nothing without being told why. What BD-1 changes is only *how much* background work costs, which is exactly what D-1 measures |
| **BD-3** | **Does a new owner's setup — onboarding, the first website and intake generation — come out of their allowance?** | Agreed in principle: **yes, against the trial's one-off total, with a warning before it runs out** (B-12) | Unaffected by BD-1 in principle; the measured size changes with it. UD-1's worry — a new owner opening their dashboard with part of month one already spent — is answered by D-1's number and FR-22's pre-action warning, not by exempting setup |
| **BD-4** | **How much is an AI image?** (OQ-7) | **Follows from BD-1** | Under **A**, its own price line derived from its real cost ($0.016–$0.25, A-17) — the option that actually solves OQ-7. Under **B**, charged at actual. Under **C**, **free**, because an image has no tokens: on its own a sufficient reason to reject C. The existing per-business daily image cap stays either way, as the abuse guard |
| **BD-5** | **What happens when an owner's allowance is gone** | Agreed in principle: **degrade, don't stop** (D-12) | Unaffected by BD-1. The owner's assistant pauses; everything touching their clients keeps working on template text. Two conditions: the check **fails closed for the owner's own AI and open for client-facing work** — the opposite of Layer 2's kill switch and of the chat budget, both of which fail open — and a client-facing action may only be degraded once it has template text to fall back to |
| **BD-6** | **What happens to existing balances and history on day one** | Agreed in principle: **start from zero** | Unaffected by BD-1, and reinforced by it: history is in tokens, under a rule we are replacing, for a period in which nobody was told they were metered. Leave the agent platform's balances untouched; nothing is double-charged because the two never meet |
| **BD-7** | **When the owner's dashboard changes to the new number** | Agreed in principle: **in D-2, before anything can be refused** | Unaffected by BD-1. The number on the card today is measured against an allowance nobody is held to, in a unit we are discarding; making it true is a fix, not a feature |

---

## 11. Open questions for SA

*(SQ-1, SQ-4, SQ-7 and SQ-11 change shape with BD-1 and are best answered after it.)*

- [ ] **SQ-1 — Where the ledger lives, and what a row holds.** A new Business OS table, one row per charged action with a unique grouping id, **the credits charged and the rate version** — versus deriving totals from `token_usage` at read time. *BA leaning: a real table.* `token_usage` counts calls, not actions, holds no price, and cannot express a grant or a period.
- [ ] **SQ-2 — Idempotency.** Is a unique constraint on the grouping id the whole of FR-8, given that one action can legitimately produce several calls?
- [ ] **SQ-3 — The write path.** Write the ledger row inside the existing usage scope (non-blocking, confirmed) versus a claim-and-drain job on the §8.1 pattern. *BA leaning: a direct write* — the data is already in hand at the end of the action, and a queue adds a second way to lose a charge. FR-15 then means a failed write is an uncharged action; SA to rule on whether that is acceptable or needs an outbox.
- [ ] **SQ-4 — Reserve-then-settle, or check-then-charge?** *BA leaning: check before, charge after,* accepting a small bounded overspend under a burst. Under option A the price is known before the action runs, which makes a reservation cheap if SA wants one; under option B it is not knowable in advance at all — a point in A's favour.
- [ ] **SQ-5 — Cache freshness.** `EntitlementService` caches raw inputs for 30 s. Is a balance resolved through that cache acceptable, or does it need its own read?
- [ ] **SQ-6 — The period boundary** (T-6, still undecided): calendar month versus billing anniversary. Unaffected by BD-1.
- [ ] **SQ-7 — Where the rate lives, and who owns it.** The price list is pricing data that changes when models change: `system_settings_config` (beside the Layer 2 area rows, operator-changeable through a script), or the entitlements config (engineering-owned, shipped in a release)? *BA leaning: the entitlements config* — it is part of what a plan is worth, it must be versioned with the allowances derived from it (FR-3, FR-34), and it should not be changeable without review.
- [ ] **SQ-8 — Fan-out `n`.** `AiActionBalanceQuery.cost` already accepts `n`. Where is `n` decided for a `ForEachExecutor` run, and is it known before the action starts?
- [ ] **SQ-9 — A discrepancy to settle before TK-6 is scoped.** The tier-billing plan records F-28 as a live B-8 leak: "`app/api/business-os/usage/route.ts` already reads `user_subscriptions`". At `main` 7ba40a56 it **does not** — the only mention is a comment explaining why it deliberately does not (`route.ts:214-223`), and `usageSummary.ts` reads only `token_usage` and `tokens_per_pilot_credit`. Either F-28 is already closed, or it meant the agent-platform **rate** keys (`pilot_credit_cost_usd`, `tokens_per_pilot_credit`) that the route does read — which FR-33 removes anyway. SA to confirm which.
- [ ] **SQ-10 — Sequencing.** The entitlements plan puts S-3 metering after S-5 switch-on, which is hard-gated on G-1. This requirement proposes D-0 to D-2 ship before that, in `shadow`. Does SA accept the reordering, given that charging in shadow refuses nobody?
- [ ] **SQ-11 — The scope of FR-11.** Is "every model selectable in Layer 2's area settings has a price entry, enforced by a test" the right boundary — or must the whole `ai_model_pricing` / `FALLBACK_PRICING` path be reworked (cache warming, refresh, cached-input rates) before a price may be derived from it? *BA leaning: the narrow boundary now*, with the wider rework as a follow-up. SA owns this, because it decides whether D-0 is small.
- [ ] **SQ-12 — `atLimit: 'by_call_site_audience'`.** Is the declared action list (FR-4) the right home for the audience map, and is the 16-entry `AiActionType` union the FR-30 inventory, or must that stay per call site rather than per action?

---

## 12. Operator questions answered as-built

The user's two queued questions, answered against the code first.

**"Can an admin add or reduce a customer's credit?"** — **No, nowhere, on either side.**
- Business OS: the admin op union has no credit operation (A-14), and nothing counts AI usage, so there is nothing to grant. An admin *can* raise an account's `ai.actions` allowance with `add_override`, but with `ALWAYS_SUFFICIENT` behind `balance.ts` (A-10) the value has no effect.
- Agent platform: no admin route writes a balance (A-14). A Pilot-Credit balance moves only by the signup grant, an agent-run charge, or a Stripe purchase (`CreditService.ts:30-82`, `:444`).
- **The gap is FR-27 (grant / reduce, audited) and FR-28 (read the position).** It is needed before enforcement, not after: the champion policy is literally "when they hit the cap, an admin grants credits" (D-7), and that path does not exist.

**"Is there a subscription-expiry lock?"** — **Half of one, and it fails open (A-15).**
- Agent platform: `checkExecutionAllowed` blocks an agent run on `account_frozen` or insufficient balance, but returns `allowed: true` on any DB error or a missing subscription row; and the cron that would set `account_frozen` is not scheduled, so in practice nothing freezes.
- Business OS: the lifecycle (trial → grace → paused) and per-account expiry exist and resolve correctly, but the mode is `shadow`, so an expired account is refused nothing (A-13).
- **The gap is FR-29**: an expired Business OS plan must stop owner-facing AI through the entitlements lifecycle — explicitly **not** by reusing `account_frozen`, which is an agent-platform flag also read by agent generation and would freeze a paying Business OS customer.

---

## 13. Out of scope

| Item | Where |
|---|---|
| Boost purchase, auto top-up, add-ons, annual pricing | S-4b |
| Enforcement switch-on and G-1 key rotation | S-5 |
| Reconciling our cost figure against the provider's invoice; cached-input and batch rates | Follow-up. FR-11 removes silent $0; it does not claim our figure equals OpenAI's bill |
| Any change to Pilot Credits, `CreditService`, `pricingConfig` or the agent charge path | Forbidden here (A-11); retirement is WS-3 |
| SMS metering and email fair-use | Same mechanism, later — a credit extends to them |
| An all-businesses usage overview | Layer 1.1 F-2 |
| Making AI audit entries durable (Layer 3 KI-B / OI-D) | Separate; FR-14 removes the billing dependency on it |

---

## 14. Known issues and open items

| Id | Description | Status |
|---|---|---|
| **KI-1** | The image reuse cache means the ledger charges **generations**, not requests; a repeated request is free and invisible. Consistent with FR-6, but anyone auditing image spend must know it | Informational (Layer 1.5 KI-B) |
| **KI-2** | Two dormant action types (`website_section_field_rewrite`, `website_block_enrichment`) have no production trigger. They must be declared and priced anyway, or they become unpriced the day they are wired | Declared in D-0 |
| **KI-3** | A small bounded overspend is possible under a concurrent burst (SQ-4). Measured in AC-25, not prevented | Accepted, pending SA |
| **KI-4** | Chat v2 and v1 are outside the call catalog and choose their own model; their spend is not in the eight areas and so is not chargeable by FR-4 | Pre-existing (Layer 2); state it, do not fix it here |
| **KI-5** | An image is priced as `high` when the provider reports no quality (Layer 1.5 KI-E), so its recorded cost is an upper bound. Under options A and B that feeds the price: frequent warnings mean the price is conservative, not wrong | Informational; watch the warning count |
| **OI-1** | Client-facing actions with **no** template fallback are found in D-0 and built in D-3. Until then, FR-19 cannot be satisfied for them | Open, sized in D-0 |
| **OI-2** | Every allowance in the tier matrix and every `PLACEHOLDER` in `cohorts.ts` is a guess until D-1b (FR-34) | Open by design |
| **Closes** | Q1 (what a credit represents) by BD-1; Q6 (do failed attempts count), OQ-7 (images), OI-1 (background work on the card) and UD-1 (onboarding in a new owner's first month) by BD-2 to BD-6 | Pending BD-1 |

---

## 15. Notes on integration points

| Area | Files |
|---|---|
| The action wrapper and the declared list | `lib/business-os/llm/aiActionAudit.ts` (`AiActionType` `:38-54`, `runAiAction` `:267-293`), `lib/ai/usageScope.ts` |
| The catalog of areas and calls | `lib/business-os/llm/callCatalog.ts:37-84` |
| Cost, and FR-11 | `lib/ai/pricing.ts` (`calculateCostSync` `:250-275`, `FALLBACK_PRICING`), `ai_model_pricing`, the Layer 1.5 per-image prices in `system_settings_config` |
| Layer 2 area settings (which models an operator can select) | `lib/business-os/llm/modelSettingsPolicy.ts`, `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` |
| The seam, the resolver and the allowances | `lib/business-os/entitlements/balance.ts`, `EntitlementService.ts`, `config/catalog.ts:293-305`, `config/tierMatrix.ts`, `config/cohorts.ts` |
| Admin operations | `lib/business-os/entitlements/adminOps.ts`, `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` |
| Owner surface | `app/api/business-os/usage/route.ts`, `lib/business-os/usage/usageSummary.ts`, `components/business-os/UsageCard.tsx` |
| Existing guards to relate to, not replace | `lib/business-os/bizql/telemetry/ChatBudget.ts`, `lib/services/GeneratedImageService.ts:170-183` |
| Deliberately untouched | `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/route.ts`, `user_subscriptions`, `credit_transactions`, `billing_events` |
| Documents this layer answers to and changes | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §11, `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` §6.2 (S-3), `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (allowances, FR-34), `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` §E, §K |

---

## 16. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | The last layer of the Business OS LLM standards effort, parked since 2026-09-16. Written as the entitlements programme's S-3 metering seen from the LLM side: 31 FRs, 22 ACs, a five-slice plan, BD-1 to BD-7 and SQ-1 to SQ-10 |
| 2026-09-28 | **Currency reopened; BD-1 promoted to a "Decide first" section** | The user's framing: the app needs a **currency**, and tier allowances are derived from it — and the 250/500/1,000/2,000 numbers are invented and sold to nobody, so the unit is genuinely open. The user rejected a flat count of AI actions as not cost-linear. New §2 sets out three options (price list / live cost / tokens ÷ 10) with what each shows the owner, what each lets us bill on, what must be true, and how each fails; records that "weighted actions" **is** the price-list option under another name; and records why `tokens ÷ 10` is not cost-based either — model-blind while Layer 2 lets an operator change the model, and images have no tokens so they would be free. **Actions stay the grain under every option; credits are the currency.** Added **FR-11** (an unpriced model must fail loudly, never $0) as a prerequisite inside the first slice, **FR-3** (the rate is versioned config and never rewrites history) and **FR-34** (tier allowances derived from target cost ÷ credit value, placeholders replaced, entitlements catalog and plans doc updated). New slices **D-0** (rules + trustworthy cost) and **D-1b** (derive the allowances). BD-2 to BD-7 restated as agreed-in-principle, each saying what it inherits from BD-1; SQ-7 (where the rate lives) and SQ-11 (how far FR-11 goes) added. Now **35 FRs, 25 ACs**; status blocked on BD-1 |
