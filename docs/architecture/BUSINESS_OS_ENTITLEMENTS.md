# Business OS entitlements

> **Last Updated**: 2026-09-24

## Overview

What an account can do in Business OS, and why. This module answers one question — *is this account entitled to this capability, on this surface, right now?* — and it answers it from **configuration**, so changing what a plan includes is a config edit rather than a code change.

**Nothing is enforced yet.** Slice 1 ships the infrastructure: the catalog, the resolver, the plan records, shadow-mode recording and the admin surface. `BOS_ENTITLEMENTS_MODE` is unset in production, which means nothing is resolved, nothing is recorded and nothing is refused. Slice 2 wires enforcement, Slice 3 adds metering, Slice 4 adds billing.

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

---

## The shape of it

| Layer | File | Owned by | Changes when |
|---|---|---|---|
| **Catalog** — what capabilities exist | `lib/business-os/entitlements/config/catalog.ts` | Engineering | A feature is built or changed |
| **Tier matrix** — what each plan includes | `config/tierMatrix.ts` | Pricing | The price list changes |
| **Cohorts** — trial and champion | `config/cohorts.ts` | Product | The trial deal changes |
| **Lifecycle overlay** — what each state allows | `config/lifecycle.ts` | Product | The grace/paused policy changes |
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
> The config half is fixed: **`chat.access`** (FR-46) is a capability in its own right, off for Essentials and on for Autopilot, and it is the whole commercial difference stated once. **Nothing reads it yet.** Slice 2 gates the chat entry point on it, **once per turn**, before any per-capability check, and refuses as `not_entitled` with the wording specified in FR-46c — a normal assistant message naming Autopilot, with both plan names read from `presentation`.
>
> `productionConfig.test.ts` asserts the gap in both directions, which is what proves the gate is still needed: a `false` in the matrix changes nothing until something reads it. It is also why shadow records reads under **both** readings of Q-B1 — that dual recording is the measurement that decides which behaviour Essentials gets.

Eyal's draft matrix still lives in `__fixtures__/exampleTierMatrix.ts`. It is a **test fixture** — three invented tiers with invented names and prices — kept because the mechanism tests (moving a capability between plans, grandfathering, drift) need a matrix that can be mutated freely, and the shipped one cannot be.

## Adding or changing a tier

1. Add the name to `TIER_ORDER` in `config/tierMatrix.ts`, cheapest first.
2. Add its row to `tiers` — **one value per capability**. A missing one does not compile (`TierRow` is a mapped type over the catalog) and does not validate (Zod repeats the rule, because the Next build ignores type errors).
3. Add its entry to `presentation` — the customer-facing name per locale and the monthly list price. The config does not validate without one, and the price is for display and admins only: **Stripe is the source of truth from Slice 4**.
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
| unset / `off` | **The default and what production runs.** Nothing resolved, read, recorded or refused |
| `shadow` | Everything resolved and recorded; **nothing refused** |
| `enforce` | Decisions acted on. Slice 2 onwards |

`enforce` is **refused and downgraded to `shadow`** while no tier is configured (UD-2), logged at `error`. Since 2026-09-23 two tiers are configured, so that gate no longer fires — it stays as the guard against an emptied matrix. **This does not mean `enforce` is safe to set:** nothing calls a decision until Slice 2, there is no billing until Slice 4, and G-1 blocks both.

## Before enforcement can be switched on

| Gate | What it means |
|---|---|
| **G-1** | The service-role key is rotated, the old key revoked and verified. Blocks all of Slice 4 and `enforce` |
| **G-2** | The CI checks that are advisory today are required |
| **UD-2** | At least one tier configured — otherwise `enforce` self-downgrades. ✅ met on 2026-09-23 |
| **Chat surface gate (FR-46)** | `chat.access` is configured (off for Essentials) but nothing reads it. Slice 2 must gate the chat entry point on it, once per turn, or Essentials has chat in all but name — for writes as well as reads |
| **Missing-plan-row check** | `findTenantsMissingPlanRow` must become an exhaustive SQL anti-join first. Today it scans accounts with a business profile; under enforcement a missing row denies a real customer |
| **Launch operation** | `launch_champion_existing` makes every account without an in-force tier an open-ended champion (U-2, UD-3, UD-4). Slice 1 ships the **dry run**; execution is Slice 2 |
| **Trim list** | The shadow report's no-end-date list flags accounts that never created a business profile — onboarding-only champions to trim before enforcement |

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

> **Editing any of these SQL files?** The three the operator pastes — `preflight-`, `check-` and `rollback-` — carry **no `--` comments at all** and no prose in any string. They are several small standalone statements, with no single-letter aliases, and every row emits a short `fix` key that [the runbook](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md) explains. That is not tidiness: two pastes failed with `ERROR: 42P01: relation "a" does not exist`, the editor's parser cannot be inspected, and the answer is to stop giving it anything to misparse. `scripts/__tests__/entitlementSqlScripts.guard.test.ts` enforces it, and its header is explicit that it is **hygiene, not a proof the file will paste**.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Created | Slice 1 as built: catalog/config, resolver, plan records, shadow mode, report and the admin surface (workplan §4, S1-T16) |
| 2026-09-24 | `chat.access` added (FR-46) | The chat SURFACE as its own capability, off for Essentials and on for Autopilot: the per-operation `chat.*` groups cannot express "this plan has no chat", for writes as well as reads. Ships in the catalog (38 capabilities) and both tier rows; the gate itself is Slice 2 |
| 2026-09-23 | The four plans configured | `basic`/`pro` as tiers with names and prices, `trial`/`champion` as cohorts pointing at `basic`; UD-2 now met; the chat-surface gap recorded as a Slice 2 gate (workplan §4.32) |
