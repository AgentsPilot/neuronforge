# Business OS entitlements

> **Last Updated**: 2026-09-22

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

**Production ships with no tiers** (`TIER_ORDER` is empty). Every existing account is a `champion` and new signups are `trial`; both get everything. Eyal's draft matrix lives in `__fixtures__/exampleTierMatrix.ts`, where it proves the mechanism without being mistaken for a price list.

## Adding or changing a tier

1. Add the name to `TIER_ORDER` in `config/tierMatrix.ts`, cheapest first.
2. Add its row to `tiers` — **one value per capability**. A missing one does not compile (`TierRow` is a mapped type over the catalog) and does not validate (Zod repeats the rule, because the Next build ignores type errors).
3. **Check every capability you are granting against its `lifecycle` in `catalog.ts`.** A tier may **not** grant one that is `not_built`, and the config will **refuse to load** if it does — see below, because this is the step most likely to stop you.
4. `npm run entitlements:snapshot` to refresh the drift snapshot.
5. `npm run test:bos-entitlements`.

> ### ⚠️ Step 3 in full: you cannot sell what does not exist
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

`enforce` is **refused and downgraded to `shadow`** while no tier is configured (UD-2), logged at `error`. Without that, switching on before a plan exists would push trials into grace with nothing to buy.

## Before enforcement can be switched on

| Gate | What it means |
|---|---|
| **G-1** | The service-role key is rotated, the old key revoked and verified. Blocks all of Slice 4 and `enforce` |
| **G-2** | The CI checks that are advisory today are required |
| **UD-2** | At least one tier configured — otherwise `enforce` self-downgrades |
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

`reset_plan_state` wipes and recreates: it needs a confirm literal, the account id echoed back, and `confirmTierLoss` if a tier is assigned. The deleted overrides go into the audit entry, because afterwards that is the only trace of them.

## Ops checks

| Check | How |
|---|---|
| Did the migration land? | `scripts/check-bos-entitlements-migration.sql` in the Supabase SQL editor — read-only, one result grid, row 0 is the verdict |
| Are the fact triggers working? | `check-…` row 61 (plan rows with a trigger origin) plus the Postgres log searched for `business_os_plan_fact_` |
| Who has free access with no end date? | The shadow report's `static.noEndDate`, with `noEndDateAccountsWithoutProfile` as the trim list |
| What would tier X cost? | `shadow-report?from=…&to=…&asTier=X` |
| What does setup cost in AI actions? | `shadow-report?…&includeSetupAi=true` — sized against p90 with headroom (B-12) |
| Applying it all | [BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Created | Slice 1 as built: catalog/config, resolver, plan records, shadow mode, report and the admin surface (workplan §4, S1-T16) |
