# Business OS entitlements

> **Last Updated**: 2026-09-29

## Overview

What an account can do in Business OS, and why. This module answers one question — *is this account entitled to this capability, on this surface, right now?* — and it answers it from **configuration**, so changing what a plan includes is a config edit rather than a code change.

**Nothing is enforced yet.** Slice 1 ships the infrastructure: the catalog, the resolver, the plan records, shadow-mode recording and the admin surface. **Production runs `BOS_ENTITLEMENTS_MODE=shadow` on purpose, to collect data first** (confirmed 2026-09-27): every decision is resolved and recorded, and nothing is refused. A refused `enforce` also runs as `shadow` (`lib/business-os/entitlements/mode.ts`); the admin Health tile then shows the amber "Enforcement requested but not active". Shadow **without** that amber headline means the setting is `shadow` itself. Slice 2 wires enforcement, Slice 3 adds metering, Slice 4 adds billing.

## Table of Contents

1. [The shape of it](#the-shape-of-it)
2. [Adding or changing a tier](#adding-or-changing-a-tier)
3. [Removing a capability from a tier](#removing-a-capability-from-a-tier)
4. [Histories: trial and grace lengths](#histories-trial-and-grace-lengths)
5. [Staleness: how fresh an answer is](#staleness-how-fresh-an-answer-is)
6. [The mode flag](#the-mode-flag)
7. [Before enforcement can be switched on](#before-enforcement-can-be-switched-on)
8. [Admin operations](#admin-operations)
9. [Ops checks](#ops-checks)
10. [Importing the module from outside it](#importing-the-module-from-outside-it)
11. [Metering: the credit ledger](#metering-the-credit-ledger)

---

## The shape of it

| Layer | File | Owned by | Changes when |
|---|---|---|---|
| **Catalog** — what capabilities exist | `lib/business-os/entitlements/config/catalog.ts` | Engineering | A feature is built or changed |
| **Tier matrix** — what each plan includes | `config/tierMatrix.ts` | Pricing | The price list changes |
| **Cohorts** — trial and champion | `config/cohorts.ts` | Product | The trial deal changes |
| **Lifecycle overlay** — what each state allows | `config/lifecycle.ts` | Product | The grace/paused policy changes |
| **Invites** — link expiry options, who may issue which invite type, and the Paid-invites switch | `config/invites.ts` | Product | The invite policy changes. `paidInvitesAvailable` stays `false` until invite-signup Slice 5 (the Business OS checkout, S-4a); flipping it is a config edit, and the create route refuses every Paid invite until then |
| **Resolver** — puts them together | `resolver.ts`, `lifecycle.ts`, `decide.ts` | Engineering | Rarely |
| **Service** — the one call sites use | `EntitlementService.ts` | Engineering | Rarely |

The separation is the point: `catalog.ts` says what `marketing.posts` *is*, `tierMatrix.ts` says who *gets* it. A capability's `lifecycle` is a claim about the **code** — `available`, `beta` or `not_built` — and the rule the user set is enforced at config load: **if a feature does not exist it cannot be allocated.** A tier that grants a `not_built` capability fails validation, naming the capability and the tier.

### What production ships (user decision, 2026-09-23)

| Internal id | Customer-facing | Chat | AI actions | Ends | Price |
|---|---|---|---|---|---|
| `trial` | Test Flight | no | 250 (one-off total) | 14 days, or when the credits run out | $0 |
| `champion` | Founding Partner | no | 1,000 / month | never, unless an admin sets a date | $0 |
| `basic` | Essentials | no | 500 / month | while paid | $79 |
| `pro` | Autopilot | **yes** | 2,000 / month | while paid | $129 |

**Only two of those are tiers.** `basic` and `pro` are in `TIER_ORDER`; `trial` and `champion` are cohorts that point at the `basic` row (`base: { tier: 'basic' }`), so they inherit every change to Essentials instead of drifting from it.

The paid tiers differ in exactly **two** ways: chat (the eight `chat.*` capabilities) and the credit allowance. Everything that exists is in both; nothing that is `not_built` is in either. A third difference is either a decision nobody recorded or a mistake, and `productionConfig.test.ts` fails until someone says which.

**Champions become Autopilot in one line.** When chat is ready for design partners, `champion.base` becomes `{ tier: 'pro' }` in `config/cohorts.ts` — no code, no migration, no per-account admin operation, and every champion has chat on the next resolve.

> **The credit numbers are a first pass.** 250 / 500 / 1,000 / 2,000 are decisions, not measurements. Slice 3 resets them from the shadow report — the setup-AI measurement (S1-T15) sizes the trial total, observed usage sizes the rest. Treat them as "chosen to start with", not as policy.

> ### ⚠️ "Essentials has no chat" is configured, and not yet enforced
>
> Withholding the eight per-operation `chat.*` capabilities does **not** close the chat surface. Every chat operation maps to the capability of the **domain it touches**, so an Essentials owner reading — or writing — their own contacts through chat resolves to `crm.core`, which Essentials has, and chat answers and acts.
>
> ⚠️ **Chat is named normally on the customer-facing "Your plan" section, and `chat.access` is still unenforced** (user decision, 2026-09-27). Founding Partners resolve through Autopilot **with its full AI allowance** — see the Change History for the brief window in which they did not. Chat is available to everyone and in testing, so the earlier suppression — which existed to avoid advertising a restriction nothing enforced — was removed along with its test. The accepted consequence: an Essentials customer sees chat listed under Autopilot and may infer they do not have it, **which is false today and becomes true when this gate ships**.
>
> The config half is fixed: **`chat.access`** (FR-46) is a capability in its own right, off for Essentials and on for Autopilot, and it is the whole commercial difference stated once. **Nothing reads it yet.** Slice 2 gates the chat entry point on it, **once per turn**, before any per-capability check, and refuses as `not_entitled` with the wording specified in FR-46c — a normal assistant message naming Autopilot, with both plan names read from `presentation`.
>
> `productionConfig.test.ts` asserts the gap in both directions, which is what proves the gate is still needed: a `false` in the matrix changes nothing until something reads it. It is also why shadow records reads under **both** readings of Q-B1 — that dual recording is the measurement that decides which behaviour Essentials gets.

Eyal's draft matrix still lives in `__fixtures__/exampleTierMatrix.ts`. It is a **test fixture** — three invented tiers with invented names and prices — kept because the mechanism tests (moving a capability between plans, grandfathering, drift) need a matrix that can be mutated freely, and the shipped one cannot be.

## Adding or changing a tier

1. Add the name to `TIER_ORDER` in `config/tierMatrix.ts`, cheapest first.
2. Add its row to `tiers` — **one value per capability**. A missing one does not compile (`TierRow` is a mapped type over the catalog) and does not validate (Zod repeats the rule, because the Next build ignores type errors).
3. Add its entry to `presentation` — the customer-facing name per locale and the monthly list price. The config does not validate without one, and the price is for display and admins only: **Stripe is the source of truth from Slice 4**. It also carries three required flags: `shownToCustomers`, `availableToBuy` and `active`. **`active` is FYI only** — an admin marker shown on the Tiers card, and read only through `planActive()`. It changes nothing: `planActive.noEffect.test.ts` proves resolution, the customer view, the pill, the shadow report, invites and the offer are identical with every plan inactive. Deciding what inactive *does* means removing that file's check for each affected surface in the same change.
4. **Check every capability you are granting against its `lifecycle` in `catalog.ts`.** A tier may **not** grant one that is `not_built`, and the config will **refuse to load** if it does — see below, because this is the step most likely to stop you.
5. `npm run entitlements:snapshot` to refresh the drift snapshot, and read the diff: it is the record of what the new tier includes.
6. `npm run test:bos-entitlements`.

> ### ⚠️ Step 4 in full: you cannot sell what does not exist
>
> This is not a style rule, it is a load-time error, and it is the most likely thing to interrupt you: it rejected **eight** capabilities in Eyal's draft matrix the first time it ran.
>
> **What counts as granting** — all of these fail on a `not_built` capability:
>
> | Shape | Granting | Withheld |
> |---|---|---|
> | boolean / group | `true` | `false` |
> | variant | any value above the first | the first variant |
> | add-on | `'purchasable'` **or** `'included'` | `'unavailable'` |
> | metered / fair-use | any non-zero | `{ perMonth: 0 }` / `{ ceilingPerMonth: 0 }` |
> | quantity | non-zero `included`, **or** `purchasable: true` | `{ included: 0, purchasable: false }` |
>
> `'purchasable'` counts on purpose: it is an **offer to sell** something that does not exist, and the customer finds out after paying.
>
> **What the failure looks like.** Any test that loads the config fails, with an `EntitlementConfigError` naming the capability, the tier, the value you used and the value that would withhold it:
>
> ```
> entitlement config: tier matrix is invalid — tier "growth" grants
> "payments.reminders" (true), but that capability is not_built — it does not
> exist yet, so it cannot be allocated. Either withhold it (false) or change its
> lifecycle in the catalog, which means proving a customer gets the outcome.
> ```
>
> **How to fix it**, in order of what is usually true:
>
> 1. **Withhold it in the tier row** (the value in the right-hand column above) and keep the intended value in a trailing comment, so nothing is lost when the feature is built. This is what the fixture matrix does.
> 2. **If you believe the feature does exist**, the catalog entry is wrong, not your row. Change `lifecycle` in `catalog.ts` — but the bar is *"a customer gets the outcome"*, not *"the tables and the code exist"*. Three entries were corrected downwards on exactly that test: `marketing.mass_email` (a campaign builder with no dispatcher), `payments.reminders` (the sender returns a simulated success) and `website.custom_domain` (the lookup has no caller). Put the trace in the entry's `note`.
>
> The same rule applies to a **cohort's** explicit numbers and to an **override** — an admin cannot grant a `not_built` capability either (the route refuses with `capability_not_built`).

Moving a capability between plans is **one line** — change its value in the row. `oneLineChange.test.ts` proves that end to end: the same account gets `not_entitled` before the edit and `allowed` after, with nothing else changed.

## Removing a capability from a tier

Adding is one line; **removing is two**, and that asymmetry is deliberate — taking something away is a decision about people who are already paying (B-10).

1. Lower the value in the tier's row.
2. Add a `removals` entry: `{ version, tier, capability, previousValue, grandfatherUntil }`.
3. Bump `version` on the matrix.
4. `npm run entitlements:snapshot`.

The snapshot test refuses a lowered value with no matching removal and no version bump. Subscribers sold at an earlier `plan_version` keep `previousValue` until `grandfatherUntil`.

> `grandfatherUntil: 'renewal'` is **rejected at load until Slice 4**: before billing there is no renewal event to end it, so it would silently mean "for ever".

## Histories: trial and grace lengths

Trial length and grace length are **histories, not numbers**:

```typescript
durationHistory: [{ effectiveFrom: '2026-09-22T00:00:00.000Z', days: 14 }]
```

A trial uses the entry in force **when it started**. Shortening the trial from 14 days to 7 therefore changes the deal for new signups and cannot end a trial someone is three days into. **Append an entry; never edit one** — the snapshot test blocks an edit, for exactly that reason.

⚠️ Every **quantity** in `cohorts.ts` is a `PLACEHOLDER` nobody has chosen (champion AI actions, the trial total, the email ceilings). They are harmless today because nothing meters anything, and Slice 3 sets them from the shadow report's setup-AI measurement. The 14/7/30-day durations *are* decisions.

## Staleness: how fresh an answer is

`EntitlementService` caches the **raw inputs** — the plan row and its overrides — for **30 seconds** in an LRU of 5,000 entries, and re-resolves against the current clock on every call. So a trial that expires inside the cache window still resolves as expired.

Cross-instance staleness is bounded at 30 s: an admin change invalidates the local instance only, and every decision carries `effectiveWithinSeconds: 30` so a caller that cannot tolerate it knows rather than guesses. Report and batch paths bypass the cache in both directions.

## The mode flag

`BOS_ENTITLEMENTS_MODE`, read fresh on every call:

| Value | Meaning |
|---|---|
| unset / `off` | The default when the variable is not set. Nothing resolved, read, recorded or refused |
| `shadow` | Everything resolved and recorded; **nothing refused**. **What production runs, on purpose, to collect data first** (2026-09-27) |
| `enforce` | Decisions acted on. Slice 2 onwards |

**Metering is not mode-gated** (credit deduction SA ruling Q-4). The credit ledger (see [Metering](#metering-the-credit-ledger)) records a charge in **every** mode, `off` included. A charge is a *measurement*, like `token_usage` and the AI audit entry, neither of which reads the mode; the mode governs entitlement *decisions* (resolve, record shadow events, refuse). So `off`'s "nothing recorded" above covers shadow events, **not** the ledger, and an environment where the variable is unset still charges. Do not add a mode check to the charge path.

`enforce` is **refused and downgraded to `shadow`** while no tier is configured (UD-2), logged at `error`. Since 2026-09-23 two tiers are configured, so that gate no longer fires — it stays as the guard against an emptied matrix. **This does not mean `enforce` is safe to set:** nothing calls a decision until Slice 2, there is no billing until Slice 4, and G-1 blocks both.

## Before enforcement can be switched on

| Gate | What it means |
|---|---|
| **G-1** | The service-role key is rotated, the old key revoked and verified. Blocks all of Slice 4 and `enforce` |
| **G-2** | The CI checks that are advisory today are required |
| **UD-2** | At least one tier configured — otherwise `enforce` self-downgrades. ✅ met on 2026-09-23 |
| **Chat surface gate (FR-46)** | `chat.access` is configured (off for Essentials) but nothing reads it. Slice 2 must gate the chat entry point on it, once per turn, or Essentials has chat in all but name — for writes as well as reads. ⚠️ **Until it ships, the customer surface OVERSTATES the gap** (SA R2-3): `nextPlanUp.adds` lists the nine chat capabilities for a trial or Essentials customer, so the screen says Autopilot would add something those customers already have. Nothing on the customer side needs to change when the gate lands — building it is what makes the sentence true. **Founding Partners point at Autopilot**, so they keep chat when it does |
| **Missing-plan-row check** | ✅ **met in code on 2026-09-26** (S-0): `findTenantsMissingPlanRow` is one call to `public.business_os_tenants_missing_plan_row`, an SQL anti-join over the union of `business_profiles` and `onboarding_conversations`. It used to scan accounts with a business profile only, so an onboarding-only tenant with no plan row was invisible — and under enforcement a missing row denies a real customer. **The gate is not closed until the migration is applied to production and the count is zero**: `20261010_business_os_tenants_missing_plan_row.sql`, runbook step 10. A missing function returns an error, never zero |
| **Launch operation** | `launch_champion_existing` makes every account without an in-force tier an open-ended champion (U-2, UD-3, UD-4). Slice 1 ships the **dry run**; execution is Slice 2 |
| **Trim list** | ✅ **worked on 2026-09-26** (S-0): the shadow report has a `dormantChampions` section listing each open-ended champion with no business profile, how long they have been dormant, where they came from, and the exact admin call that would end their access. **It is a list and a mechanism, not a decision** — nothing is trimmed, and the section writes nothing. Who (if anyone) is cut is the user's call |

## Admin operations

All under `/api/admin/business-os/entitlements/**`, all gated by `requireAdmin` as the first statement of each handler, all Zod-validated, all audited with the actor and reason, and the audit is **flushed before the response**.

| Route | Method | What |
|---|---|---|
| `accounts/<accountId>` | GET | What is this account entitled to, and **which layer decided each value** |
| `accounts/<accountId>` | POST | `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state` |
| `shadow-report` | GET | Static / observed / `asTier` replay / setup-AI |
| `launch` | POST | `launch_champion_existing` — dry run in Slice 1 |

Refusals are explicit codes, never a database constraint: `not_a_business_os_account` (404), `plan_row_missing` (409), `would_leave_no_basis` (409), `capability_not_built` (409), `no_tiers_configured` (400), `expires_at_required_for_champion` (400), `tier_assigned` (409).

Two rules worth knowing before using them:

- **Every assignment must say when it ends** — a champion and a tier both need the `expiresAt` key, even to say `null` ("no end date"). Silence is never read as "forever" (A-1, RC-4), and the report lists every open-ended account.
- **No op may leave an account with neither an in-force tier nor a cohort** (R2-3). That state resolves to an anomaly, and under enforcement an anomaly denies owner-paid capabilities.

`reset_plan_state` wipes and recreates: it needs a confirm literal, the account id echoed back, and `confirmTierLoss` if a tier is assigned. The overrides it ends go into the audit entry (`endedOverrides`), because afterwards that is the only trace of them.

## Ops checks

| Check | How |
|---|---|
| Did the migration land? | `scripts/check-bos-entitlements-migration.sql` in the Supabase SQL editor — read-only, one result grid, row 0 is the verdict |
| Are the fact triggers working? | `check-…` row 61 (plan rows with a trigger origin) plus the Postgres log searched for `business_os_plan_fact_` |
| Who has free access with no end date? | The shadow report's `static.noEndDate`, with `noEndDateAccountsWithoutProfile` as the trim list |
| What would tier X cost? | `shadow-report?from=…&to=…&asTier=X` |
| What does setup cost in AI actions? | `shadow-report?…&includeSetupAi=true` — sized against p90 with headroom (B-12) |
| Applying it all | [BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md) |
| Did the credit ledger land? | `scripts/check-bos-credit-charges-migration.sql` (read-only, one grid, row 0 the verdict), then the write probe `scripts/probe-bos-credit-charges-migration.sql` — see [Metering](#metering-the-credit-ledger) |

> **Editing any of these SQL files?** The three the operator pastes — `preflight-`, `check-` and `rollback-` — carry **no `--` comments at all** and no prose in any string. They are several small standalone statements, with no single-letter aliases, and every row emits a short `fix` key that [the runbook](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md) explains. That is not tidiness: two pastes failed with `ERROR: 42P01: relation "a" does not exist`, the editor's parser cannot be inspected, and the answer is to stop giving it anything to misparse. `scripts/__tests__/entitlementSqlScripts.guard.test.ts` enforces it, and its header is explicit that it is **hygiene, not a proof the file will paste**.

---

## Importing the module from outside it

Any file outside `lib/business-os/entitlements/` that imports from it — **a type-only import included** — must be registered in the same change: as a gate in `config/enforcementPoints.ts`, or as a non-gate in `KNOWN_NON_GATE_IMPORTERS` (`__tests__/enforcementPoints.test.ts`) with the exact symbols it imports and why it refuses nothing. That is what keeps the admin screen's per-capability "no gate yet" marker true.

The same applies to a capability id or tier name written as a literal, and to switching a capability to `available` (grant it in `BASE`, then `npm run entitlements:snapshot`). The full table, the review checklist and the definition of done (`npm run test:bos-entitlements`) are in the **`business-os-entitlements` skill** (`.claude/skills/business-os-entitlements/SKILL.md`). The CI check is not required, so the skill is where this gets caught.

---

## Metering: the credit ledger

Credit deduction layer, slice 3 ([workplan](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md), [requirement](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md)). **Status: the schema is applied on PROD (3b-i, 2026-09-29 08:13:51 UTC). 3b-ii writes a charge for every Business OS AI action; charging starts at 3b-ii's production go-live, a moment RM records in the workplan §15 (and below).** Nothing reads either table before slices 4, 6 and 9, and nothing is refused: `balance.ts` still answers "sufficient" to everything.

**Not AI-specific** (user decision 2026-09-29). Every chargeable action — AI or not, e.g. a notification email to a client — will eventually have a measured cost converted to credits, all from **one credit pool** per account, following the same procedure as AI with few exceptions. Each charge row names its `service` (an identifier checked by format, not a closed list, so a new service needs no schema change); the totals row stays **one per account and period**, never split by service. Slice 3 records only `service = 'ai'`; nothing non-AI is built yet. Every charge has a **grouping id**, whatever the service — a group may hold one action (a bulk send is one group, one action id per email).

| Object | What it is |
|---|---|
| `business_os_credit_charges` | The bill. One thin row per charged Business OS action of any service (`kind = 'charge'`): action id (unique, the idempotency key), account, billing period, grouping id, credits (6 dp), cost in USD (10 dp), credit value version, fallback-priced flag (priced from a fallback rate rather than the measured one: AI sets it when a model is missing from the price table; another service only if it defines its own documented fallback, otherwise `false`), service, action type, trigger (`owner` / `scheduled` / `external`) and outcome. Slice 4's corrections are rows of `kind = 'adjustment'` in the same table; they carry no service of their own and inherit it from the charge they adjust. **Never updated in place** — `service_role` holds only SELECT and INSERT. No tokens, models, call names or owner text |
| `business_os_credit_totals` | The running total per account and billing period — one pool across every service — split by trigger plus an adjustment bucket, with `credits_total = owner + scheduled + external + adjustment` enforced by a CHECK. Derived: it can always be rebuilt from the ledger (checker row C7) |
| `business_os_record_credit_charge(...)` | The one write path: inserts the charge and moves the total in one transaction, idempotent on the action id. `SECURITY INVOKER`, `service_role` only. Repository: `BusinessOsCreditChargeRepository` |
| `business_os_credit_period_start(anchor, at)` | The one definition of a billing period: the latest `period_anchor + n months` at or before `at`, in UTC, `n` counted from the anchor (a 31st anchor gives Jan 31 → Feb 28 → Mar 31). An account with no plan row is charged in the UTC calendar month |

**Who can see what.** Owners may SELECT their own rows through the API (including `service`), **except** the cost and fallback columns (`cost_usd`, `is_fallback_priced`, `cost_usd_total`, `fallback_priced_count`): a column-level grant, so an owner-session `select=*` is refused and a column added later is hidden by default. No client role can write either table or execute either function.

**Lifecycle.** Both tables are `never` in the purge registry and keyed to `auth.users`, not `business_profiles`, so a business Reset cannot reach them. On account deletion the ledger is **minimised** (`user_id` set to NULL by the foreign key) and the totals are **deleted** (cascade).

**The credit value** is `lib/business-os/entitlements/config/creditValue.ts` — version 0, provisional, about $0.001 of provider cost per credit — recorded on every row as `credit_value_version`.

**How an AI charge is written (3b-ii).** At the end of every `runAiAction` (`lib/business-os/llm/aiActionAudit.ts`), after the audit entry is queued, `recordAiCharge` (`lib/business-os/llm/aiChargeRecorder.ts`) builds the row from the action's in-memory calls and writes it through the repository with `service = 'ai'` (one exported constant, `AI_CHARGE_SERVICE`). The write is **awaited with a 1,500 ms budget** (`BOS_AI_CHARGE_WRITE_BUDGET_MS`), is never retried, and **never throws**: a failed, refused or timed-out write is one `error` log (`bos_ai_charge_write_failed`, or `bos_ai_charge_not_written` when no row could be built) and the action's own result is unchanged. A timed-out write's fate is *unknown* (it may still have committed); the action id makes any repeat harmless. An action with no AI call writes nothing and waits for nothing. The recorder is the ledger's only writer (a source guard in the repository test pins it).

**Reading the ledger (slice 4a).** Operators read it on the **Costs & credits** tab of `/admin/business-os-llm` (route `GET /api/admin/business-os/credits/report`, `requireAdmin`): per account and billing period the stored totals row, cross-checked against the sum of its ledger rows by the totals row's own rules (a mismatch is shown, never hidden); breakdowns by action type, area, effective service and trigger, *net, including corrections* (an adjustment is counted under the charge it corrects, never under the raw `service` column, which is NULL on adjustments); the fallback-priced charges; and p50 / p90 per action type over succeeded, non-fallback charges. Read-only, through `BusinessOsCreditLedgerReadRepository` (no write method) and `lib/business-os/credits/`. Aggregated in Node with read ceilings; a report that hit one says "incomplete". [Workplan](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_4_WORKPLAN.md) §4.

**Charging start:** *to be recorded by RM at 3b-ii's production go-live (workplan §6.4 step 6).* Rows between the 3b-i apply time and that moment are developer or preview traffic on developers' own accounts (environments share the production database).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | S-0 moved two switch-on gates | The missing-plan-row scan is now an exhaustive SQL anti-join (`20261010`), so the admin report and checker row B1 answer from one place; the trim list is worked as a `dormantChampions` report section that proposes an end-access call and cuts nobody |
| 2026-09-22 | Created | Slice 1 as built: catalog/config, resolver, plan records, shadow mode, report and the admin surface (workplan §4, S1-T16) |
| 2026-09-27 | Production mode corrected: `shadow`, on purpose | The Overview and the mode table said `BOS_ENTITLEMENTS_MODE` is unset (off) in production. Production resolves it to **`shadow`**, set deliberately to collect data first (admin reorganisation slice 5, RC-5.3 / OQ-8). Added the caveat that a refused `enforce` also runs as `shadow`, and how the Health tile tells the two apart |
| 2026-09-24 | `chat.access` added (FR-46) | The chat SURFACE as its own capability, off for Essentials and on for Autopilot: the per-operation `chat.*` groups cannot express "this plan has no chat", for writes as well as reads. Ships in the catalog (38 capabilities) and both tier rows; the gate itself is Slice 2 |
| 2026-09-23 | The four plans configured | `basic`/`pro` as tiers with names and prices, `trial`/`champion` as cohorts pointing at `basic`; UD-2 now met; the chat-surface gap recorded as a Slice 2 gate (workplan §4.32) |
| 2026-09-27 | ~~Customer-facing "Your plan" (S-4a step 1)~~ — **SUPERSEDED the same day by the three rows below** | ⚠️ **Two claims in this row were reversed within hours and are left here only as the record of what was believed** (SA R2-4): it said the section "says nothing about chat", and that the gates table carried an instruction to delete `customerPlanView.chat.test.ts`. Both were true when written and are false now — chat is named, and that test was deleted rather than deferred. What REMAINS true: the section is read-only, and it reads the resolver through a user-scoped endpoint that accepts **no input at all**. Corrected by the rows below; do not act on the struck text |
| 2026-09-27 | Two commercial flags per tier | `presentation` gains **`shownToCustomers`** and **`availableToBuy`** — required, not defaulted, and validated (a tier cannot be buyable while hidden). They answer different questions: a plan can be worth showing before it can be sold. Both tiers ship **shown, not buyable**; flipping `availableToBuy` is the single switch that turns the buy path on in WS-2 step 3, with no component change. The admin Tiers card shows both, including when they disagree |
| 2026-09-27 | Founding Partner points at Autopilot | `champion.base` is `{ tier: ’pro’ }`, reversing Q-B3, so design partners keep chat while it is in testing. **Their AI allowance is unchanged at 1,000 a month** — `CHAMPION_VALUES` sets it explicitly and an explicit cohort value beats the tier row, so they do not pick up Autopilot’s 2,000. Reversing it is the same one line |
| 2026-09-27 | Chat named on the customer surface | The dedicated suppression and `customerPlanView.chat.test.ts` are gone (deleted in the same commit, per that file’s own instruction), because chat is available to everyone and in testing. Replaced by the narrower rule that survives enforcement: **the surface lists what a plan INCLUDES and never asserts what the customer’s current plan excludes** — `customerPlanView.noExclusions.test.ts` |
| 2026-09-27 | Founding Partner gets FULL parity with Autopilot | The `ai.actions` override is gone: `CHAMPION_VALUES` now **reads the allowance from the tier its `base` names**, so champions get 2,000 a month rather than the 1,000 they were pinned at earlier the same day. "Founding Partners get the top plan free" is true without an exception, and the customer screen no longer offers a design partner an upgrade. Parity is **structural, not a copied number** — raise Autopilot and champions rise with it. **No other cohort value disagrees with the inherited row** (checked: `sms.messages`, `email.volume`, `team.seats`, `business.locations`) |
| 2026-09-28 | Invite config added | `config/invites.ts` holds the invite link expiry options (15/30/60, default 30), the invite types and the grants each may carry (read from `COHORT_IDS` and `TIER_ORDER`), and the issuance policy with its Paid switch, off until Slice 5 (invite-only signup Slice 0, T-14, T-15) |
| 2026-09-28 | Importing the module from outside it | New section and the `business-os-entitlements` skill, after three misses in three days reached main (9ffdf05b, #129, #134): an unregistered importer, including a type-only one, and a capability switched to `available` without being granted in `BASE` |
| 2026-09-28 | Invite redemption writes plan rows; tenant definition widened | Invite-only signup Slice 1b. A champion invite redeemed from the invite page writes the account's plan row with `origin = 'invite'` through `BusinessOsAccountPlanRepository.provisionFromInvite` (the SQL function `business_os_finalise_invite_redemption`, one transaction with the lineage row and the redeemed stamp; the end date is computed in SQL from the invite row). `provisionFromInvite` is listed in the imports guard's write methods. `isBusinessOsTenant` is now **profile OR onboarding message OR any plan row** (L-4), so an invited champion is visible on the Tiers page before onboarding; the plan row is read only when the other two say no. The RC-4 champion end-date rule moved to `grantRules.ts`, shared by the admin operations and the invite path |
| 2026-09-29 | Metering: the credit ledger | New section for credit deduction slice 3b-i: the charge and totals tables, the write RPC, the period function, the owner column grant, the lifecycle verdicts and the credit value; the schema exists and nothing writes yet. **The mode flag** now states that metering is not mode-gated and records in every mode, `off` included (SA Q-4 / SF-6). Ops checks gains the ledger checker and write probe. Same day, per the user's decision that the ledger is not AI-specific: objects renamed (`business_os_ai_charges` → `business_os_credit_charges`, `business_os_ai_charge_totals` → `business_os_credit_totals`, `business_os_record_ai_charge` → `business_os_record_credit_charge`, `business_os_ai_period_start` → `business_os_credit_period_start`) and a `service` column added; one credit pool, totals not split by service |
| 2026-09-29 | Metering: charging wired (3b-ii) | Credit deduction slice 3b-ii: every Business OS AI action now writes one charge through `aiChargeRecorder.ts` at the end of `runAiAction` — awaited, 1,500 ms budget, no retry, never throws, `service = 'ai'` from one constant. The Metering section's status now records the 3b-i PROD apply time and a placeholder for the charging start (RM, at go-live). No mode check, no refusal, `balance.ts` untouched |
| 2026-09-29 | FYI-only `active` flag on every plan | Required on all four plans (tiers in `presentation`, cohorts beside their labels), read only through `planActive()`, shown as a badge on the admin Tiers card. **It changes no behaviour** — `planActive.noEffect.test.ts` holds resolution, the customer view, the Founding Partner pill, the shadow report, invites and the offer identical with every plan inactive; only the admin view differs. An inactive plan stays invitable by design. What inactive should *do* (stop new assignments? hide from customers? affect existing accounts?) is an open business question |
| 2026-09-29 | Metering: the operator cost report (4a) | Credit deduction slice 4a: where operators read the ledger (the Costs & credits tab of `/admin/business-os-llm`), what it shows, and that it is read-only through a separate read repository. Nothing in this module is imported by it |
