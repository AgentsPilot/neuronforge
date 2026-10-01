# Workplan: Business OS credit deduction — slice 6, the owner usage card in credits

> **Last Updated**: 2026-10-01

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §12 "Slice 6 — Owner usage card in credits", "Slice 6 scoping (BA, 2026-09-30)", §13 "Slice 6 decisions for the user (2026-09-30)" (D-a to D-h, all decided), AC-18, AC-21, AC-33, AC-35, AC-36, AC-37, FR-6, FR-24, FR-25, FR-28, FR-29, FR-36, FR-39, SQ-20 to SQ-28, KI-17, KI-18, OI-10, and **"SA review — slice 6 scoping (2026-09-30)"** (binding)
**Previous slice:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_5_WORKPLAN.md) (T6c is the R-7 removal list)
**Worktree:** `neuronforge-llm-deduction`
**Branch:** `feature/business-os-credit-deduction-slice-6` (off `origin/main` `d5a7a93a`; confirmed with `git branch --show-current`). 6b gets its own branch from RM when 6a is merged (see §3).
**Date:** 2026-09-30
**Status:** 6a Code Complete (uncommitted; awaiting SA code review). SA conditions W6-1 to W6-9 folded in below, marked "(W6-n)"; evidence in §4.12

## Overview

Slice 6 makes the dashboard card tell the owner the truth: credits used and left of **their own plan's allowance**, for **their own billing period**, split "by you" / "automatic", and kept current without a page reload. It then puts the plan's credit figure back on the plan screen and the public invite page (removing the temporary R-7 rule). SA re-cut the slice by surface into two parts, each its own PR, **6a first**:

- **6a — The dashboard card reads credits.** Route, owner read repository, period module, card UI, all three refresh triggers (including the SQ-24 signal), retirement of the agent-platform rate keys from the owner surface (FR-36), Check 5 relabel, the D-b sentence on the card.
- **6b — The plan screen and the invite page show the credit figure.** The required R-7 removal (T6c) with restored assertions, the D-g "Credits" heading, the D-h sentence on the plan screen and the invite page, and the optional OI-10 localisation at its root.

**No migration** in either part (SA condition 5). Nothing below needs one; if implementation finds otherwise, Dev stops and goes back to SA.

## Table of Contents

- [1. Analysis summary](#1-analysis-summary)
- [2. As-built facts this plan rests on (verified)](#2-as-built-facts-this-plan-rests-on-verified)
- [3. Order, PRs and release (D-d)](#3-order-prs-and-release-d-d)
- [4. Part 6a — the dashboard card reads credits](#4-part-6a--the-dashboard-card-reads-credits)
- [5. Part 6b — the plan screen and the invite page](#5-part-6b--the-plan-screen-and-the-invite-page)
- [6. What owners see](#6-what-owners-see)
- [7. Test plan](#7-test-plan)
- [8. Guardrails](#8-guardrails)
- [9. Risks](#9-risks)
- [10. Open questions for SA](#10-open-questions-for-sa)
- [11. Logging, deprecated systems and follow-ups](#11-logging-deprecated-systems-and-follow-ups)
- [15. User decisions after the local preview](#15-user-decisions-after-the-local-preview)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis summary

| Area | Today (as built) | After slice 6 |
|---|---|---|
| Card (`components/business-os/UsageCard.tsx`) | Title "AI credits" (F-12), "Last 30 days", Pilot Credits counting down from ≈ 20,833 for every account, "32.2K" abbreviation (F-13), fetched once on mount | "Credits", the owner's own period and plan allowance, full grouped numbers in the reader's language, "by you" / "automatic", three refresh triggers, D-b sentence |
| Route (`app/api/business-os/usage/route.ts`) | `?range=`, `token_usage` via `usageSummary.ts`, `readAllowanceCredits` from `monthly_ai_allowance_usd` ÷ `pilot_credit_cost_usd` | Replaced in place (SQ-28): **no input at all**, reads the credit ledger through the owner RLS client, allowance from the entitlements resolver, never cached |
| Data | `token_usage` rolling 30 days, tokens ÷ `tokens_per_pilot_credit` | `business_os_credit_totals` (split already in the row, F-1), adjustments only when `credits_adjustment ≠ 0` |
| Period | Rolling 30 days | `business_os_credit_period_start(anchor, now)` from the live plan anchor; recorder's calendar-month rule with no plan row; trial = sum from the anchor |
| Admin Check 5 | Claims to compute "exactly what the owner's card shows" | Relabelled "Token usage by feature", no claim to match the card (SQ-23) |
| Plan screen / invite page | "Credits (included)", no number (R-7 option C) | "Credits (32,250 per month)" etc. under a first "Credits" heading, plus the D-h sentence (6b) |

Tables read: `business_os_credit_totals`, `business_os_credit_charges` (owner RLS, granted columns only), `business_os_account_plans` (service role, `user_id, period_anchor` only). Function called: `business_os_credit_period_start` (service role; pure, reads no table). No table written. No provider, no AI call (`bos-llm-call-standards` not engaged).

---

## 2. As-built facts this plan rests on (verified)

Each checked in this worktree at `d5a7a93a` on 2026-09-30.

| # | Fact | Where |
|---|---|---|
| V-1 | Totals row carries `credits_owner`, `credits_scheduled`, `credits_external`, `credits_adjustment`; CHECK `credits_total` = the four summed | `supabase/migrations/20261015_business_os_credit_charges.sql:55-76` |
| V-2 | Owner GRANTs — charges: `id, kind, action_id, adjusts_action_id, reason_code, user_id, period_start, group_id, credits, credit_value_version, service, action_type, triggered_by, outcome, created_at`; totals: `user_id, period_start, credits_total, credits_owner, credits_scheduled, credits_external, credits_adjustment, charge_count, created_at, updated_at`. Owner SELECT policies `auth.uid() = user_id` on both | same file, `GRANT SELECT (…) … TO authenticated` lines; policies before the REVOKEs |
| V-3 | `business_os_credit_period_start` EXECUTE is `service_role` only | same file, end |
| V-4 | Recorder with no plan row: `date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'` (`calendar_month`) | same file, `business_os_record_credit_charge` |
| V-5 | `BusinessOsCreditLedgerReadRepository` selects `cost_usd`, `is_fallback_priced`, `cost_usd_total`, `fallback_priced_count` → unusable on the RLS client; its header says "a later owner-facing reader (slice 7) can pass the RLS client instead" — wrong (F-4). Its source test forbids `.rpc(` | `lib/repositories/BusinessOsCreditLedgerReadRepository.ts:21-25, 126-132`; its test `:409` |
| V-6 | `BusinessOsAccountPlanRepository` is service role by design; has no anchor-only method | `lib/repositories/BusinessOsAccountPlanRepository.ts` |
| V-7 | **Every path onto the trial leaves the anchor at the trial's start** (SA SQ-20 check): onboarding and profile triggers insert `cohort 'trial'` with `period_anchor DEFAULT now()` and their `ON CONFLICT` never touches the anchor (`20261005:349-395`); `business_os_reset_plan_state` writes `period_anchor = now()` (`20261005:480-505`); `set_cohort` writes `period_anchor = ctx.now` (`adminOps.ts:351-362`); `ensurePlanRow` inserts with `period_anchor: now` (`BusinessOsAccountPlanRepository.ts:523`); invite redemption inserts `period_anchor = now()` (`20261014:113`). **The `20261005b` backfill inserts `champion` only**, never the trial, so it does not apply. One nuance: a trigger-created trial row is anchored when the row is created, which can precede the trial clock's start fact by the gap between the two triggers; summing from the anchor is therefore over-inclusive by at most that gap, never under-inclusive | as cited |
| V-8 | Resolver's withheld metered value is `{ perMonth: 0 }`; resolution carries `state`, `basis`, `anomaly`; the lifecycle overlay (grace / paused) is **not** applied to values by the resolver (layer 5 lives in `decide.ts`) | `lib/business-os/entitlements/resolver.ts:14-15, 60-101`; `lifecycle.ts:34-65` |
| V-9 | `EntitlementService.getSnapshot` → `{ resolution, unavailable, stale }`, 30 s cache | `EntitlementService.ts:49, 77-84, 203` |
| V-10 | `UsageCard` has one consumer (`components/business-os/insight/LiveDashboard.tsx:2214`); only the card calls the route; `buildCardBreakdown` / `CardBreakdownLine` are used only by the route and `usageSummary.test.ts` | grep |
| V-11 | `usage.*` keys: only `UsageCard.tsx` reads them; the 8 `usage.category.*` keys have **no** consumer anywhere (already dead) | grep over `app lib components hooks` |
| V-12 | `LanguageContext` already holds the business timezone (`timezone`, `timeZoneOptions`) from `user_preferences.timezone`, `UTC` until it arrives | `lib/business-os/LanguageContext.tsx:75-98` |
| V-13 | `monthly_ai_allowance_usd` has exactly one reader: the usage route. `pilot_credit_cost_usd` / `tokens_per_pilot_credit` have other, agent-platform readers (Stripe, analytics) that are untouched | grep |
| V-14 | Check 5's visible strings: `CheckPanels.tsx:278` title, `:281` caveat ("Computed exactly as the owner's usage card computes it…"), column "On the card"; `StatusSummary.tsx:18` label | files cited |
| V-15 | Owner AI surfaces reachable on the dashboard page — see §4.6. The chat is JSON, not streamed; each turn ends in a `finally` | `ChatCommandPanel.tsx:945, 1238, 1309`, `sendDirect` / `applyCorrection` / `applyPick` |
| V-16 | R-7 code: `SHOWN_WITHOUT_AMOUNT`, `INCLUDED_WITHOUT_AMOUNT`, `withCustomerDisplay` in `customerPlanView.ts:113-139`; call sites `customerPlanView.ts:606` (next plan up), `:745` (included), `planOfferView.ts:21, 70`. TEMPORARY markers: `customerPlanView.test.ts:216, 263, 372, 801`; `inviteOffer.test.ts:72`; `PlanSection.render.test.tsx:115, 244, 282`; the file `creditsShownWithoutAmount.temporary.test.ts`. Two markers wrap across lines (`:263`, `:372` read "TEMPORARY (R-7 option\n C)"), so the exit grep includes a second pattern (§5 T-b9) | grep |
| V-17 | Category plumbing for D-g: `CapabilityCategory` union (`types.ts:74-83`), `z.enum` in `schema.ts:536-546`, `CATEGORY_PRESENTATION` (`customerPlanView.ts:412-422`), catalog `credits.allowance` in `ai_chat` with the N-12 comment (`catalog.ts:299-313`), `plan.category.*` keys in `LanguageContext` (×3), `planCategory` in `app/invite/invitePageCopy.ts`. **`entitlements.snapshot.json` has no category field** (0 matches), so no snapshot regeneration for D-g | files cited |
| V-18 | Values on the plan screen and the invite page are English in every language: `describeCapabilityValue` hard-codes "per month" / "in total" with `en-US` grouping; `describePlanOffer` passes no locale (OI-10) | `capabilityDisplay.ts:25-49`, `planOfferView.ts:58-70`, `planPresentation.ts:149-173` |
| V-19 | `publicInviteView.test.ts:139-144, 298` pins the top-level keys of the response and of `offer`, not of `offer.included[]` rows | file cited |
| V-20 | No `console.*` in any file this plan touches (§11) | grep count, 29 files |

---

## 3. Order, PRs and release (D-d)

| Part | PR | Merge rule |
|---|---|---|
| 6a | PR 1, this branch | Merges alone (D-d: slice 6 is not held for slice 7). Owners get the new card on deploy (D-f); the user sends the Founding Partners a personal note — no in-product note |
| 6b | PR 2, a branch RM cuts after 6a merges (suggested `feature/business-os-credit-deduction-slice-6b`) | **Never before 6a** (R-7's reason; SA guardrail). Slice 6 is done — AC-36 — only when 6b is merged |

Standing process: Dev leaves changes uncommitted; SA code review → user sees the diff → QA → user approval → RM commits and opens the PR. Each part runs its own gates (§7).

---

## 4. Part 6a — the dashboard card reads credits

### 4.1 Approach

Three new server pieces, one new client module, the card rewritten, the route replaced in place.

```text
UsageCard (client) ── fetch GET /api/business-os/usage, cache: 'no-store' ──► route.ts
                                                                               │ getUser() → 401
                                                                               ▼
                                            lib/business-os/credits/ownerCreditUsage.ts   (the ONE non-gate importer of entitlements)
                                               ├─ resolveAccountId(user.id); getEntitlementService().getSnapshot(accountId)
                                               ├─ creditAllowanceForDisplay(snapshot)        ← new helper INSIDE the entitlements module
                                               ├─ creditPeriod.ts  → anchor string → period_start string (reads injected)
                                               ├─ ownerCreditUsageDeps.ts (W6-1): the ONE file naming the plan repository (findPeriodAnchor only),
                                               │     the period repository, and the owner repository built on the caller's RLS client
                                               ├─ BusinessOsCreditOwnerReadRepository (owner RLS client) → totals rows (+ adjustments only if ≠ 0)
                                               └─ creditBalance.ts → remaining = max(0, allowance + granted − used)
```

### 4.2 The period — strings end to end (SQ-20; SA condition 2)

`lib/business-os/credits/creditPeriod.ts` (server-only) resolves the caller's current period:

1. **Anchor.** New method `BusinessOsAccountPlanRepository.findPeriodAnchor(accountId)` → `RepositoryResult<string | null>`: `.select('period_anchor').eq('user_id', accountId).maybeSingle()`; returns the **string PostgREST returned**, untouched; `null` = no plan row; read error returned, never "no row". Uncached (the recorder reads the live anchor). **(W6-1)** Only `lib/business-os/credits/ownerCreditUsageDeps.ts` names the plan repository; it is added to RC-15's `ALLOWED` **and** `NO_STATE_WRITE_REFERRERS` with the comment "Credit deduction slice 6a: the owner card's period — READ ONLY, `findPeriodAnchor` and nothing else".
2. **Period start.** New read-only repository `BusinessOsCreditPeriodRepository.periodStartFor(anchor: string, at: string)` → `RepositoryResult<string>`: one `.rpc('business_os_credit_period_start', { p_anchor: anchor, p_at: at })`, service role, documented in the header (the function is pure and reads no table, so the bypass exposes nothing; owners hold no EXECUTE, V-3). Returns the string. `at` is `new Date().toISOString()` (the "now" side may be millisecond; only the anchor must stay exact). *(Location: Q-1.)* **(W6-8)** Optional client defaulting to `supabaseServer`, header stating the bypass is intentional (EXECUTE is `service_role` only; the function is `STABLE`, `SECURITY INVOKER`, empty `search_path`, reads no table) and that "`.eq('user_id')` on every query" is N/A by design (no table, no account id crosses it); exported singleton; both arguments validated as strict ISO timestamptz strings and refused without calling; source test: exactly one `.rpc('business_os_credit_period_start'`, no `.from(`, no `user_id`.
3. **No plan row.** `calendarMonthStartUtc(now)` → `'YYYY-MM-01T00:00:00.000Z'`, the recorder's rule (V-4). Exact at the whole second, so a `Date` cannot truncate it. Pinned by a source test that reads the expression out of the migration.
4. **Trial total.** When the allowance is `{ total }`, the totals rows with `period_start >= anchor` (the **anchor string**) are summed (V-7).
5. **Reset date (display only).** `nextPeriodStartUtc(anchorIso, periodStartIso)`: k = whole months from anchor to period start (UTC components), result = anchor + (k + 1) months, day clamped to the target month's last day, counted **from the anchor** (never period start + 1 month). Parsed through `Date` — allowed, because it is never a key or a filter. Sent as an ISO instant `resetsOn`; the card formats it with `timeZoneOptions({ day: 'numeric', month: 'short' })` in the reader's language, i.e. in `user_preferences.timezone` (V-12). **No reset date for the trial or the no-plan-row state.**

The string rule is enforced three ways: types (`anchor: string`, `periodStart: string`, no `Date` parameter on any key path), a unit test whose fake PostgREST matches `period_start` by **exact string** and returns 0 rows for a millisecond-truncated value (proving the module never re-serialises), and a source guard that `creditPeriod.ts` / `ownerCreditUsage.ts` never call `new Date(` on a variable named `anchor` or `periodStart` except inside `nextPeriodStartUtc`.

### 4.3 The owner read repository (SQ-21, C-S6-2)

`lib/repositories/BusinessOsCreditOwnerReadRepository.ts`:

- `constructor(supabaseClient: SupabaseClient)` — **required**, no service-role default, no import of `supabaseServer`.
- Exported column constants: `OWNER_TOTALS_COLUMNS = 'period_start, credits_total, credits_owner, credits_scheduled, credits_external, credits_adjustment'`; `OWNER_CHARGE_COLUMNS = 'kind, action_id, adjusts_action_id, credits, triggered_by, period_start, user_id, service, action_type'` (`user_id` so `resolveEffectiveFields`' cross-account check works unchanged — Q-2; **`service`, `action_type` (W6-3)** so the rows satisfy `EffectiveFieldsInput` with no cast — selected, never filtered on, never in the payload).
- Methods (every one takes the account id, validates it as a UUID, and adds `.eq('user_id', accountId)` on top of RLS):
  - `findTotalsForPeriod(accountId, periodStart: string)` → `maybeSingle()`; no row = zero use, read error returned.
  - `listTotalsFrom(accountId, fromPeriodStart: string)` → `.gte('period_start', from)`, bounded (a trial spans a handful of monthly rows; cap at 24 with `reachedCeiling`). **(W6-6)** The caller turns `reachedCeiling` into a read error with a `warn` naming the account — never a partial trial total.
  - `listAdjustmentsForPeriods(accountId, periodStarts: string[])` → `kind = 'adjustment'`, bounded.
  - `findChargesByActionIds(accountId, actionIds)` → originals, chunked like its sibling.
- Never throws; `{ data, error }`; never filters on `service` (added to `serviceColumn.guard.test.ts`'s scanned files).
- Same "no write verb, no `.rpc(`" source test as its sibling.
- Header documents: RLS client, why not the sibling (V-5), granted columns only, and **(W6-8)** the `new-repository` singleton item as N/A by design (the client is required, SA SQ-21).
- **In the same change:** correct the sibling's header sentence (V-5).

### 4.4 The payload and the server functions (SQ-22, SQ-27, FR-28)

`lib/business-os/credits/ownerCreditUsage.ts` (server-only) — `readOwnerCreditUsage(userId, deps)` returns `RepositoryResult<OwnerCreditUsage>`:

1. `accountId = resolveAccountId(userId)`; `snapshot = getEntitlementService().getSnapshot(accountId)`.
2. `allowance = creditAllowanceForDisplay(snapshot)` — new helper **inside** the entitlements module (`lib/business-os/entitlements/creditAllowanceView.ts`), so the literal `'credits.allowance'` stays in the module. Returns `{ amount, per: 'month' | 'total' } | null`. `null` when: snapshot `unavailable`; resolution has an `anomaly` or `basis.kind === 'none'`; the value deep-equals `withheldValue(definition)`; state `paused` or `unknown` (Q-4). **(W6-9)** Written as an exhaustive `switch` over `LifecycleState` with a `never` check: `paused`, `unknown` → `null`; `trial`, `champion`, `active`, `past_due`, `grace` → the value. `stale: true` snapshots are used (display only; T-3 bars stale data from owner-paid answers, not from a read-out) — documented in the helper, which no gate may import. A trial is recognised only by the value's shape `{ total }`, never by a cohort or tier name.
3. Period (§4.2). Kind: `trial_total` when the allowance is `{ total }`; `monthly` when there is an anchor; `calendar_month` when there is none (Q-5). **(W6-5)** `resetsOn` is `null` whenever `allowance` is `null`, whatever the kind; the sum still runs over the current anchor period.
4. Used and the split, from the totals row(s) (F-1): `usedByOwner = credits_owner`, `usedAutomatic = credits_scheduled + credits_external`, `used = credits_total`. **(W6-4)** Every credits column is parsed with `Number(...)` and checked with `Number.isFinite`: numeric columns may arrive as strings; a non-finite value is a **read error** (500, logged), never 0. **Only when `credits_adjustment ≠ 0`:** load that period's adjustments and their originals (owner client, same account), attribute each by `resolveEffectiveFields(...).effectiveTrigger` (`owner` → by you; `scheduled` / `external` → automatic); unresolved → neither part, `warn` log. `used` always from `credits_total`. Sums rounded to 6 dp.
5. `remaining` from `computeCreditBalance({ allowance, granted: 0, used })` in `lib/business-os/credits/creditBalance.ts` — `max(0, allowance + granted − used)`, `null` without an allowance; **no display rounding**; the function slice 9's `balance.ts` source can call (F-9).
6. Unavailable snapshot → `warn` log, ungauged payload (never an error line, never "0 left").

Payload (`data`), types in a client-safe `lib/business-os/credits/ownerCreditUsageTypes.ts`:

```typescript
{
  period: { kind: 'monthly' | 'trial_total' | 'calendar_month'; resetsOn: string | null };
  allowance: { amount: number; per: 'month' | 'total' } | null;
  used: number;           // exact, 6 dp
  usedByOwner: number;
  usedAutomatic: number;
  granted: number;        // always 0 until slice 11; the card ignores it
  remaining: number | null;
}
```

No `user_id`, no token, dollar, cost, model, "pilot" or fallback field.

### 4.5 The route (SQ-28)

`app/api/business-os/usage/route.ts`, replaced in place:

- `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`.
- `getUser()` first → 401 `{ success: false, error: 'Unauthorized' }`.
- **Accepts no input** — no query, no body, no params; no Zod schema because there is nothing to parse (the `my-plan` precedent). The CLAUDE.md "invalid input" test case is **N/A by design**, replaced by the "reads nothing / ignores `?accountId=` and `?range=`" tests.
- Builds the owner client (`createAuthenticatedServerClient`) and calls `readOwnerCreditUsage(user.id, …)`. Imports nothing from the entitlements module and no `supabaseServer`.
- Pino child logger with `correlationId`; one `info` line (userId, period kind, whether gauged — no figures beyond `used`).
- Response header `Cache-Control: private, no-store`.
- Errors: `{ success: false, error: 'Could not load your credits', details: dev-only }`, 500.
- Deleted from the file: `QuerySchema`, `RANGE_DAYS`, `fillGaps`, `readAllowanceCredits`, `breakdown`, `daily`, `calls`, `range`.

### 4.6 Refresh triggers (FR-39, SQ-24, SA condition 3)

**The signal** — new module `lib/business-os/client/creditUsageSignal.ts` (new, SA-approved pattern, rule 7): `CREDIT_USAGE_CHANGED_EVENT` (one exported constant), `notifyCreditUsageChanged()` and `onCreditUsageChanged(handler) → unsubscribe`, over a `window` `CustomEvent` with **no payload**. SSR-safe (no-op without `window`). No `BroadcastChannel`, no context, no timers.

**Owner AI surfaces reachable on the dashboard page that raise it**, once per action, after it finishes, success or failure:

| # | Surface | AI action(s) | Where "finished" is recognised | Raise at |
|---|---|---|---|---|
| S-1 | Chat — `handleSend` (v4 and v2 turns) | `chat_turn`, `chat_website_operation` (inside a v4 turn) | the `finally` after the awaited JSON response (`ChatCommandPanel.tsx:1238`) | that `finally` |
| S-2 | Chat — `sendDirect` (example chips) | `chat_turn` | its `finally` | that `finally` |
| S-3 | Chat — `applyCorrection` | `chat_turn` | its `finally` | that `finally` |
| S-4 | Chat — `applyPick` | `chat_turn` | its `finally` | that `finally` |
| S-5 | Dashboard data load — `my-day` in `fetchDashboardData` (`app/business-os/page.tsx:176`) | `briefing_narration`, trigger `user` → `owner` (`my-day/route.ts:129`) | the `my-day` response settles (resolved or rejected) | a `.finally` on that one fetch (Q-6) |
| S-6 | Configuration dialog → intake — "generate form" (`IntakeSettingsPanel.tsx:216`) | `intake_form_generation` | its `finally` (`:238`) | that `finally` |
| S-7 | Configuration dialog → intake — "infer question" (`AddIntakeQuestion.tsx:59`) | `intake_question_inference` | its `finally` (`:78`) | that `finally` |
| S-8 **(W6-2)** | Configuration dialog → Business tab → logo `MediaUploader` → "Generate" → `MediaLibraryPicker.generate` | `image_generation` | its `finally` (`MediaLibraryPicker.tsx:214`) | that `finally`, inside the shared picker, so every host is covered |

Not raised (verified): `chat-v4/attach` (no AI call), insight actions (`/api/business-os/insights` runs no AI), lead / channel / gap calls. Owner AI surfaces on other pages (website editor, onboarding, landing-page wizard) need no raise (the media picker raises anyway, S-8, because the dashboard's configuration dialog reaches it): returning to the dashboard remounts the card, which reads on mount. A raise with no card mounted is a no-op.

**The card** re-reads on: mount; (a) the signal; (b) `visibilitychange` to visible and `pageshow` with `persisted` (back-forward cache); (c) the refresh icon (button, `aria-label`, disabled and spinning while a read is in flight — the "brief loading state"; CSS animation, not a timer). **Coalescing:** a `ref` in-flight flag and a `ref` pending flag — a trigger during a read sets pending; when the read settles, exactly one more read runs if pending. One request at a time. `AbortController` on unmount. **No `setTimeout`, `setInterval` or `requestAnimationFrame`** in the card or the signal module (source guard).

Known lag for QA (SQ-3): the charge write is awaited with a short time budget; on a timed-out write the card catches up on the next trigger.

### 4.7 The card (D-a, D-b, D-c, D-e, D-f)

- Title `usage.title` → "Credits" / "קרדיטים" / "Créditos" (AC-35 card half).
- Beside the title: "Resets {date}" (monthly), "For your trial" (trial), "This month" (`calendar_month` only, Q-8); **no label** when there is no allowance (W6-5); refresh icon.
- Centre: left (whole, grouped via `Intl.NumberFormat(language)`), "left", "of {n}" (monthly) / "of {n} in total" (trial). Ungauged: used, "used".
- ~~Under the ring: "{used} used — {owner} by you · {automatic} automatic", or "Nothing used yet this period" / trial "Nothing used yet".~~ **Removed — user decision U-1, §15.**
- ~~The D-b sentence (monthly or trial variant), small, under the figures.~~ **Now a tooltip on the ring — user decision U-2, §15.**
- Low arc: orange at ≤ 20% left (unchanged); **no warning text**, no "paused" wording, no upgrade wording.
- Error: localised `usage.error` line — never a zero.

**Display rounding** — `lib/business-os/credits/creditDisplay.ts`, pure, client-safe, imports nothing: `toDisplayedCredits({ used, usedByOwner, usedAutomatic, allowanceAmount })` →

- `used`: `0` → "nothing"; `0 < used < 1` → "less than 1" (counts as 1 below); else `Math.round(used)`; negative clamps to 0.
- parts: negatives clamp to 0, then the largest-remainder method so they sum to the displayed used (in the "less than 1" case the unit goes to the larger part, shown as "less than 1", the other as 0).
- `left = max(0, allowance − displayed used)`.

The card ignores `granted` and uses the display function for "left" (equal to the server's `remaining` while `granted` is 0).

**Dictionary** (`LanguageContext.tsx`, en / he / es): new `usage.resets_on`, `usage.for_trial`, `usage.this_month`, `usage.left`, `usage.of_total`, `usage.used`, `usage.by_you`, `usage.automatic`, `usage.less_than_one`, `usage.none_period`, `usage.none_trial`, `usage.explain.monthly`, `usage.explain.trial`, `usage.refresh`, `usage.error`; `usage.title` and `usage.of` reworded/kept; **removed** (no consumer left, V-11): `usage.last30days`, `usage.available`, `usage.none`, `usage.credits`, and the 8 dead `usage.category.*` — in all three languages. D-a split labels: he "על ידך" / "אוטומטי", es "por ti" / "automático". he and es of the D-b sentence need **native review before release** (D-b).

### 4.8 Retirement and relabel (FR-36, SQ-23)

- The route and card no longer name `monthly_ai_allowance_usd`, `pilot_credit_cost_usd`, `tokens_per_pilot_credit`, `token_usage` or "Pilot" — pinned by `ownerCreditSurface.guard.test.ts` over the route, the card, the signal module and every new 6a module (full source, comments included, so the old header text cannot survive).
- `usageSummary.ts` stays for Check 5: header reworded (no "exactly the way the owner's usage card computes them"); `buildCardBreakdown` / `CardBreakdownLine` and their two tests deleted (V-10); `readTokensPerCredit` stays.
- `TokenUsageRepository.ts:7` consumer note: "the owner usage card" → "the admin LLM usage report's token-usage check".
- Check 5 visible labels: `CheckPanels.tsx` title → "Check 5 — Token usage by feature", caveat rewritten with no card claim, column "On the card" → "Has tokens"; `StatusSummary.tsx:18` label; `llmUsageVerification.ts:490` comment. **(W6-7)** Also reworded: `llmUsageReport.ts:133` ("the card's own computation"), `llmUsageReportTypes.ts:127` and `:134`, `usageSummary.test.ts:6` (names the deleted `route.test.ts`); Check 5's "Credits" column and total relabelled as the legacy measure ("Token credits (tokens ÷ N)"). **(Q-13)** A one-line naming-debt comment on `UsageCardCheck` / `evaluateUsageCardCheck`. Identifiers (`UsageCardCheck`, `evaluateUsageCardCheck`, `usageCard`, `shownOnCard`) **left as recorded naming debt** (SQ-23 makes the rename optional; renaming ripples through 6 test files for no owner benefit). Tests asserting the old visible strings updated.
- `monthly_ai_allowance_usd` in system config becomes an **orphan key with no reader** — left in place (removing it is a migration for no benefit); recorded per §11.
- Layer 1.1 characterization tests **retired, not edited** (F-11): delete `app/api/business-os/usage/__tests__/route.test.ts`, `route.zeroToken.test.ts` and `__snapshots__/route.test.ts.snap`, with a one-line note in the new test file's header that slice 6 supersedes Layer 1.1 AC-23 for this route (the admin side keeps `usageSummary.test.ts`). `boundaries.static.test.ts`'s "no `token_usage`, no `.rpc(`, no `.from(` in the owner route" stays green. `snapshotsAreDateless.test.ts:35` comment names the deleted suite — reworded.

### 4.9 Entitlements registration (skill; SA condition 4)

- New helper `creditAllowanceView.ts` inside the module (no importer registration needed for it; its own unit test).
- `lib/business-os/credits/ownerCreditUsage.ts` is the **only** file outside the module that imports from it — `getEntitlementService`, `resolveAccountId`, `creditAllowanceForDisplay` — registered in `KNOWN_NON_GATE_IMPORTERS` with a `why` naming this slice, "display only, calls no `check()` / `decide()`, refuses nothing". `accountSeam.guard.test.ts` external scan satisfied by `resolveAccountId`.
- The route, the card, the display function and the types file import nothing from the module. No capability-id literal outside the module; no tier literal.
- `npm run test:bos-entitlements` green on the final 6a diff.

### 4.10 Files — 6a

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/usage/route.ts` | modify (replace) | SQ-28 |
| `app/api/business-os/usage/__tests__/route.test.ts`, `route.zeroToken.test.ts`, `__snapshots__/route.test.ts.snap` | delete | F-11: retired, not edited |
| `app/api/business-os/usage/__tests__/route.credits.test.ts` | create | Route integration tests (§7) |
| `lib/business-os/credits/ownerCreditUsage.ts` | create | Payload builder; the one non-gate importer |
| `lib/business-os/credits/ownerCreditUsageTypes.ts` | create | Client-safe payload type |
| `lib/business-os/credits/creditPeriod.ts` | create | SQ-20 |
| `lib/business-os/credits/ownerCreditUsageDeps.ts` | create | **W6-1**: the one wiring file naming the plan repository |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | **W6-1**: `ALLOWED` + `NO_STATE_WRITE_REFERRERS` |
| `lib/business-os/credits/creditBalance.ts` | create | SQ-27, reusable by slice 9 |
| `lib/business-os/credits/creditDisplay.ts` | create | D-c rounding, pure |
| `lib/business-os/credits/__tests__/` `ownerCreditUsage.test.ts`, `creditPeriod.test.ts`, `creditBalance.test.ts`, `creditDisplay.test.ts`, `ownerCreditSurface.guard.test.ts`, `ownerCreditUsage.crossCheck.test.ts`, `ownerCreditUsage.payload.test.ts` | create | §7 |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | modify | Scan the new owner repository too |
| `lib/business-os/entitlements/creditAllowanceView.ts` + `__tests__/creditAllowanceView.test.ts` | create | Keeps the id literal in the module; F-8 rule |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Register the one non-gate importer |
| `lib/repositories/BusinessOsCreditOwnerReadRepository.ts` + `__tests__/BusinessOsCreditOwnerReadRepository.test.ts` | create | SQ-21 |
| `lib/repositories/BusinessOsCreditPeriodRepository.ts` + test | create | Period RPC wrapper (Q-1) |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` + its test | modify | `findPeriodAnchor` |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | modify | Header sentence (F-4) |
| `lib/repositories/TokenUsageRepository.ts` | modify | Consumer note (comment only) |
| `lib/business-os/client/creditUsageSignal.ts` + `__tests__/creditUsageSignal.test.ts` | create | SQ-24 |
| `components/business-os/UsageCard.tsx` | modify (rewrite) | §4.6, §4.7 |
| `components/business-os/__tests__/UsageCard.render.test.tsx` | create | States × en/he/es, triggers |
| `components/business-os/ChatCommandPanel.tsx` | modify | S-1 to S-4 |
| `app/business-os/page.tsx` | modify | S-5 |
| `components/scheduling/IntakeSettingsPanel.tsx`, `components/scheduling/intake/AddIntakeQuestion.tsx` | modify | S-6, S-7 |
| `components/website/MediaLibraryPicker.tsx` | modify | **S-8 (W6-2)** |
| `lib/business-os/usage/llmUsageReport.ts`, `lib/business-os/usage/llmUsageReportTypes.ts` | modify | **W6-7** comments; Q-13 naming-debt comment |
| `lib/business-os/LanguageContext.tsx` | modify | `usage.*` keys, en/he/es |
| `lib/business-os/usage/usageSummary.ts` + `__tests__/usageSummary.test.ts` | modify | Header; delete `buildCardBreakdown` and its tests |
| `lib/business-os/usage/llmUsageVerification.ts` | modify | Comment only |
| `components/test-business-os/llm-usage/CheckPanels.tsx`, `StatusSummary.tsx` + the tests that assert their strings | modify | Check 5 relabel |
| `lib/business-os/llm/__tests__/snapshotsAreDateless.test.ts` | modify | Comment naming the deleted suite |
| `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify | §8 "fractional credits" row → decided (D-c, whole with "less than 1"); Change History row |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Metering section: one line on the owner read path; Change History row |

Not edited by Dev (BA's): the requirement's A-18 "superseded by slice 6" note and KI-18's anchor-reset line.

### 4.11 Task list — 6a

- ✅ **T-a0** Fold SA conditions W6-1 to W6-9 into §4 / §4.10 / §4.11 (marked "(W6-n)"). Baselines: `npx tsc --noEmit` error list, `npm run typecheck:bos-llm`, `npm test -- lib/business-os app/api/business-os components/business-os` red list, so "no new failure" is measurable.
- ✅ **T-a1** `findPeriodAnchor` on the plan repository + tests (string returned verbatim; null row; error returned); **W6-1** wiring file `ownerCreditUsageDeps.ts` added to RC-15 `ALLOWED` + `NO_STATE_WRITE_REFERRERS`.
- ✅ **T-a2** `BusinessOsCreditPeriodRepository` + tests (one `.rpc`, no `.from(`, no `user_id`; strict ISO validation refuses before calling; string returned verbatim; W6-8 header).
- ✅ **T-a3** `BusinessOsCreditOwnerReadRepository` + tests (client required; columns ⊆ migration GRANT lines, parsed; `.eq('user_id')` on every method; no write verb / rpc; errors returned; UUID guard); add to `serviceColumn.guard.test.ts`; fix the sibling header; W6-3 columns; W6-8 header (singleton N/A).
- ✅ **T-a4** `creditPeriod.ts`: anchor → period start; calendar-month rule + migration-reading source test; `nextPeriodStartUtc` + fixtures (anchors on 28th, 29th, 30th, 31st; 29 February in a leap and a non-leap target; December → January; k = 0 and k = 13).
- ✅ **T-a5** `creditAllowanceView.ts` inside the entitlements module + tests (monthly, total, withheld, unavailable, anomaly, basis none, paused, grace, stale); W6-9 exhaustive switch.
- ✅ **T-a6** `creditBalance.ts` + tests (no allowance; clamp; granted added; no rounding).
- ✅ **T-a7** `ownerCreditUsage.ts` (split from totals; adjustment branch via `effectiveFields`; trial sum; unavailable → warn + ungauged; W6-4 numeric parsing; W6-5 `resetsOn` null without allowance; W6-6 ceiling → error) + types + unit tests; register the importer; `npm run test:bos-entitlements`.
- ✅ **T-a8** Replace the route; retire the three characterization files; write `route.credits.test.ts`.
- ✅ **T-a9** `creditDisplay.ts` + tests.
- ✅ **T-a10** `creditUsageSignal.ts` + tests.
- ✅ **T-a11** Rewrite `UsageCard.tsx` (states, three triggers, coalescing, `Intl` numbers, business-timezone reset date, D-b sentence) + render tests.
- ✅ **T-a12** Raise the signal at S-1 to S-8 (W6-2) + a test per file that each named site raises exactly once, on success and on failure.
- ✅ **T-a13** Dictionary keys en/he/es; delete dead `usage.*` keys.
- ✅ **T-a14** Retirement: FR-36 source guard; `usageSummary.ts` header and `buildCardBreakdown` removal; `TokenUsageRepository` note; Check 5 visible relabel and its tests; `snapshotsAreDateless` comment; W6-7 four comments + "Token credits" relabel; Q-13 comment.
- ✅ **T-a15** Cross-check test with `buildCreditReport` (same fixture rows, same account and period → same credits).
- ✅ **T-a16** Docs (pricing §8 + history; entitlements Metering line + history).
- ✅ **T-a17** Gates (§7) with results pasted into this workplan; `git diff --stat` checked for deletions without insertions before handing over.
- ⬜ **T-a18** Handover uncommitted: SA code review → user diff → QA → user approval → RM.

### 4.12 6a implementation evidence (Dev, 2026-09-30)

Uncommitted on `feature/business-os-credit-deduction-slice-6`. No migration, no DB write, no dev server; Jest with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys.

**Gates**

| Gate | Result |
|---|---|
| T-a0 baseline `npx tsc --noEmit` | 2,095 errors (pre-existing) |
| `npx tsc --noEmit` after | 2,095 errors; **identical by file + error code** (one untouched agentkit line, `IRFormalizer.ts`, reports the same missing name as TS2552 "did you mean" instead of TS2304). No error in any 6a file |
| New + touched suites (32) | **32 / 32 suites, 609 / 609 tests** |
| `npm run test:bos-entitlements` | **100 / 100 suites, 2,091 / 2,091 tests** |
| Wider: `lib/business-os app/api/business-os components/business-os app/business-os components/test-business-os lib/repositories app/api/admin/business-os components/scheduling components/website` | 315 suites, 5,730 tests: **4 suites / 3 tests / 1 snapshot red — exactly the T-a0 baseline reds** (`chat-v4/route.audit`, `catalog/proposals-capability`, `llm/callParams.boundary.step3`, `usage/tokenUsageRepository.contract`); no new failure |
| `npm run typecheck:bos-llm` | passed, 0 new (28 baseline errors, one baseline entry now fixed — pre-existing) |
| `npm run check:bos-llm-literals` | passed, 0 violations |
| `npm run lint:hooks` | clean (exit 0) |
| `npx eslint` on changed + new files | 0 errors. Every 6a file clean; remaining warnings are pre-existing in touched files (unused imports, `exhaustive-deps`, `<img>`), not reformatted |
| `next build` (6 GB heap, CI placeholder env, no `.env*` in the worktree) | **exit 0** (compiled; `/api/business-os/usage` built as a dynamic route) |

**What the tests pin (new suites)**: owner repository (columns parsed against the migration's `authenticated` GRANT lines, client required, `.eq('user_id')` on every query, no write verb / rpc / service filter); period repository (one `.rpc`, no `.from(`, no `user_id`, strict timestamptz refusal before any call); `findPeriodAnchor` (verbatim microsecond string, null row, error ≠ no row); RC-15 wiring pin (`ownerCreditUsageDeps.ts` calls `findPeriodAnchor` and nothing else); `creditPeriod` (strings verbatim, calendar-month rule read out of the migration, reset-date fixtures 28th–31st, 29 Feb leap / non-leap, Dec → Jan, k = 0 and k = 13, a non-UTC anchor; source guard: no `Date` built from an anchor or period key outside the display maths); `creditAllowanceView` (real config; monthly, total, withheld, zero total, unavailable, stale, anomaly, basis none, all seven lifecycle states); `creditBalance`; `creditDisplay` (the SA example 62.5 → 63 = 41 + 22, less than 1, sums always add up in a sweep); `ownerCreditUsage` (exact-string fake ledger, split, trial sum from the anchor with a row one microsecond earlier excluded, W6-4 string / garbage / `Infinity`, W6-5, W6-6, corrections by effective trigger, unresolved → neither part + `warn`, every failure an error); FR-28 payload (exact recursive key set in four shapes, banned words, `ai` segment rule proved on `aiCredits` / `ai_used` / `usedAi`, passing `remaining` / `trial_total`); cross-check with `buildCreditReport` (used = stored and recomputed credits; split = by-trigger breakdown, corrections included); route (happy path with `Cache-Control: private, no-store`, 401 reads nothing, `?accountId=&range=` ignored, ledger on the RLS client and service role only on the anchor and the RPC, four failure paths → 500 generic, unavailable snapshot → 200 ungauged, source: no input read, no service-role / entitlements import); signal module; card render (every state, en / he / es with the real dictionary, business timezone, no "AI" / token / dollar text, all three triggers, coalescing, abort on unmount); raise sites (S-7, S-8 behavioural on success / refusal / network failure; S-1 to S-6 source; a census that only these sites raise); the owner-surface guard (FR-36 words over full source, no timers, Q-11 client-safe files, service role confined to the wiring file, no `check()` / `decide()`).

**Deviations from the plan as written (for SA)**

| # | What | Why |
|---|---|---|
| DV-1 | `lib/repositories/__tests__/ConfigRepository.getSystemConfigs.test.ts` edited (not in §4.10): its "owner usage route (AC-19)" test positively pinned the old route's `getSystemConfigs` call | The route reads no system config any more (FR-36). The negative pin (no direct `ais_system_config` read) is kept and widened to "no config read at all". **Follow-up:** `ConfigRepository.getSystemConfigs` now has no production caller |
| DV-2 | `lib/repositories/index.ts` exports the two new repositories (not in §4.10) | `new-repository` checklist step 4. The owner repository has no singleton (client required) |
| DV-3 | The D-b sentence shows only when there is an allowance | Both variants say the plan / trial "includes a fixed amount"; on a no-allowance card that would be false. SA to confirm |
| DV-4 | The reset date follows the reader's locale: en "Resets Oct 14", he / es day-first (§6's "14 Oct" example is illustrative) | `Intl.DateTimeFormat(language, { day, month: 'short' })` in the business timezone, as §4.2 specifies |
| DV-5 | The "fractional credits" row is in the pricing doc's **§5** table, not §8; decided there. The orphan-key row went to §8 (Q-12) | Where the row actually is |
| DV-6 | A refresh that fails after a good read clears the figures and shows the error line | Stale figures would read as current; "could not read" is never shown as a number |
| DV-7 | `computeCreditBalance` returns `null` (no gauge) for a non-finite input rather than treating it as 0 | Never turn an unreadable figure into a full allowance (the builder already errors first, W6-4) |
| DV-8 | S-6 (intake form generation) is pinned at source level, not behaviourally | `IntakeSettingsPanel` needs drag-and-drop, the form API and the dialog to render; SA allowed source-level where render is expensive |
| DV-9 | `usage.of` reworded to `of {n}` (placeholder) in all three languages | Word order differs per language; the number goes inside the sentence |

**Flagged, not changed**: `components/website/MediaLibraryPicker.tsx`'s `generate` has a pre-existing `catch {}` that drops the error without a log (CLAUDE.md "never swallow errors"). 0 `console.*` in every touched file (18 counted). The he / es card strings (D-b sentence and labels) need **native review before release** (D-b).

**Estimate 6a: ≈ 3.5 days** (route + repos + period ≈ 1.25 d; card + triggers + signal sites ≈ 1.25 d; retirement / relabel ≈ 0.25 d; tests, docs and gates ≈ 0.75 d). Within SA's 3–3.5 d.

---

## 5. Part 6b — the plan screen and the invite page

### 5.1 Approach

All changes inside the entitlements module and the two plan surfaces; no new importer of the module, no route change.

1. **R-7 removal (AC-36, T6c, required).** Delete `SHOWN_WITHOUT_AMOUNT`, `INCLUDED_WITHOUT_AMOUNT`, `withCustomerDisplay` and their three call sites (`customerPlanView.ts:606`, `:745`; `planOfferView.ts:21, 70`), plus the `:262` comment that points at it. Delete `creditsShownWithoutAmount.temporary.test.ts` and the TEMPORARY test in `inviteOffer.test.ts:72`. Restore:
   - `customerPlanView.test.ts:216` → "IS told the allowance changes, as a change rather than an improvement": trial → Essentials `changes` contains `credits.allowance` with "2,000 in total" → "19,750 per month";
   - `:263` → Essentials → Autopilot `improves` `toEqual(['credits.allowance'])`;
   - `:372` → both thresholds back to 2;
   - `:801` → `Credits (19,750 per month)` in the Essentials summary;
   - `PlanSection.render.test.tsx`: `:115` fixture `renderTrialWithCrossUnitChange` removed and its callers back to `renderFor('trial')`; `:244` → "19,750 per month becomes 32,250 per month"; the `:282` describe block removed (its "ends when the credits run out" case kept, moved under "a trial"); the `email.volume` positive control kept (SA).
   Restore values are taken from the pre-slice-5 text in commit `630386b9` with the slice 5 numbers.
2. **D-g — a "Credits" heading first (SQ-25).** Category `credits`: added to `CapabilityCategory` (`types.ts`) and the `z.enum` (`schema.ts`); first in `CATEGORY_PRESENTATION`; `credits.allowance` moves to it in `catalog.ts` (N-12 comment replaced); `plan.category.credits` in `LanguageContext` ×3 and in `invitePageCopy.ts` `planCategory` ×3; category-order tests updated (`order[0]` → `credits`, the `ai_chat` row's feature count). No snapshot regeneration (V-17); the admin Tiers view checked (it groups `not_built` capabilities only — `credits.allowance` is `available`).
3. **D-h — the sentence on the plan screen and the invite page.** A generic, optional `noteKey` on a category presentation entry (Q-9) — not a per-capability exception: the `credits` entry carries it; the variant follows the metered value's shape (`{ perMonth }` → `plan.category.credits.note.monthly`, `{ total }` → `.trial`). `PlanSection.tsx` renders it under its row; the invite page renders it from a new `planCategoryNote` map in `invitePageCopy.ts`. Same D-b wording as the card, en/he/es.
4. **OI-10 (optional, recommended) — at the root.** `describeCapabilityValue(value, definition, locale = defaultLocale)` words "per month", "in total", "(alerts, never blocks)", the unit / "more purchasable" phrases per locale; `describePlanCapabilities` passes its existing `locale`; `describePlanOffer(config, planId, now, locale)`; `describeInviteOffer(..., locale)` fed from `publicInviteView`'s existing `pageLanguage(row.language)` (already validated). Admin callers keep English (no argument). Variant ids pass through unchanged (Q-10). Fixes Settings in he/es at the same time. Stale "English today" comments in `inviteOffer.ts` and `invitePageCopy.ts` updated.
5. **Docs.** Entitlements doc: remove the `:58` temporary callout, category note, Change History row. Pricing doc: §1 note, §8 row ("Showing the number…" → done), Change History row.

### 5.2 Files — 6b

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/customerPlanView.ts` | modify | R-7 removal; `credits` presentation first; `noteKey` |
| `lib/business-os/entitlements/planOfferView.ts` | modify | R-7 call site; `noteKey` on `PlanOfferCategory`; locale (OI-10) |
| `lib/business-os/entitlements/types.ts`, `schema.ts`, `config/catalog.ts` | modify | D-g category |
| `lib/business-os/entitlements/capabilityDisplay.ts`, `planPresentation.ts` | modify | OI-10 |
| `lib/business-os/entitlements/__tests__/creditsShownWithoutAmount.temporary.test.ts` | delete | T6c |
| `lib/business-os/entitlements/__tests__/customerPlanView.test.ts`, `planOfferView.test.ts`, `planCopy.i18n.test.ts`, `catalog.invariant.test.ts` (if it pins categories) | modify | Restores, D-g order, new keys |
| `lib/business-os/invites/inviteOffer.ts`, `publicInviteView.ts` + `__tests__/inviteOffer.test.ts` | modify | TEMPORARY test removed; locale threaded |
| `components/business-os/settings/PlanSection.tsx` + `__tests__/PlanSection.render.test.tsx` | modify | Render the note; restores |
| `app/invite/invitePageCopy.ts`, `app/invite/page.tsx` + `__tests__/page.render.test.tsx` | modify | Heading, note, localisation |
| `lib/business-os/LanguageContext.tsx` | modify | `plan.category.credits`, note keys ×3 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` | modify | Callouts and history |

### 5.3 Task list — 6b

- ⬜ **T-b0** RM cuts the 6b branch from `main` after 6a merges; Dev confirms the branch.
- ⬜ **T-b1** Remove the R-7 rule and its call sites.
- ⬜ **T-b2** Delete the temporary test file and the `inviteOffer.test.ts` TEMPORARY test.
- ⬜ **T-b3** Restore the `customerPlanView.test.ts` assertions (4 sites).
- ⬜ **T-b4** Restore `PlanSection.render.test.tsx` (`renderFor('trial')`, the "becomes" line, block removal).
- ⬜ **T-b5** D-g: category, schema, presentation, catalog, dictionary ×2 surfaces, order tests.
- ⬜ **T-b6** D-h: `noteKey`, `PlanSection` and invite page rendering, en/he/es, render tests.
- ⬜ **T-b7** OI-10: locale through `describeCapabilityValue` / `describePlanOffer` / `describeInviteOffer`; he/es value tests; admin stays English (test).
- ⬜ **T-b8** Docs.
- ⬜ **T-b9** Exit grep over `app lib components hooks`: `withCustomerDisplay|SHOWN_WITHOUT_AMOUNT|INCLUDED_WITHOUT_AMOUNT|TEMPORARY \(R-7|R-7 option` → nothing (the second pattern catches the two line-wrapped markers).
- ⬜ **T-b10** Gates (§7), `npm run test:bos-entitlements` green, results pasted; `git diff --stat` check.
- ⬜ **T-b11** Handover uncommitted, same chain.

**Estimate 6b: ≈ 1.0 day required + D-g + D-h, ≈ 1.5 days with OI-10.** SA range 0.75–1.25 d; OI-10 is the extra half day.

---

## 6. What owners see

### After 6a (dashboard only)

| Owner | Card |
|---|---|
| Founding Partner (all 8 live accounts), anchor e.g. the 14th | Title **"Credits"**, "Resets 14 Oct" and a refresh icon; ring almost full; centre **"32,187 / left / of 32,250"**; under it **"63 used — 41 by you · 22 automatic"**; the D-b sentence. With today's spend (≈ 60 a month) the number goes **up** from ≈ 20,833 and changes unit (KI-18); the user's personal note covers it (D-f) |
| First day of a period | "32,250 left of 32,250", "Nothing used yet this period" |
| After one briefing only | "less than 1 used — less than 1 by you · 0 automatic"; "32,249 left" |
| Trial (none live today) | "1,652 left of 2,000 in total", "For your trial", no reset date, no "per month" |
| Essentials / Autopilot (none live) | As Founding Partner with 19,750 / 32,250 |
| No plan row / unreadable plan / lapsed | Credits used and the split, no ring gauge, no "left", never "0 of 0"; "This month" for no plan row |
| Over the allowance | "0 left", "32,260 used", orange arc, no warning or "paused" wording |
| Updates | After a chat answer, a briefing load or an intake generation on the page; on returning to the tab; on the refresh icon. Never on a timer |

**Unchanged after 6a:** Settings → Plan and the invite page still read **"Credits (included)"** with no number, under "AI assistant" (R-7 still in place).

### After 6b (plan screen and invite page)

| Surface | What changes |
|---|---|
| Settings → Plan | A first heading **"Credits"** with **"Credits (32,250 per month)"** (Founding Partner, Autopilot), "Credits (19,750 per month)" (Essentials), "Credits (2,000 in total)" (trial), and the explanation sentence under it. Essentials' "next plan up" shows the credits improving "19,750 per month → 32,250 per month"; the trial's shows "2,000 in total becomes 19,750 per month" as a change. With OI-10, "per month" / "in total" read in Hebrew or Spanish |
| Public invite page | The same line with its number and the sentence — the first time a prospect sees a credit figure; with OI-10 the whole plan list is in the invite's language |
| Dashboard card | Unchanged from 6a |

---

## 7. Test plan

| Check | Part | How | Pass criterion |
|---|---|---|---|
| Happy path (monthly) | 6a | `route.credits.test.ts` | 200, exact payload for a fixture Founding Partner (split, remaining, `resetsOn`) |
| 401 | 6a | same | No session → 401, no repository or service called |
| Invalid input | 6a | **N/A by design** | Replaced by: `?accountId=<other>&range=last_7d` returns the caller's own figures; source guard — the handler reads no `searchParams`, no body, no `params` |
| Tenant isolation | 6a | route + repository tests | Every owner-repo query carries `.eq('user_id', callerId)`; repository refuses a non-UUID; route never names another id; service-role calls limited to snapshot, anchor, period function (source guard on the route and `ownerCreditUsage.ts`) |
| Failure paths | 6a | route + unit | Totals read error → 500 with the dev-only guard, never `used: 0`; anchor read error → 500; period RPC error → 500; unavailable snapshot → 200 ungauged + `warn` |
| Payload allow-list (FR-28, AC-21, AC-37) | 6a | `ownerCreditUsage.payload.test.ts` | Exact recursive key set; banned-word scan on every key over `/token|usd|cost|dollar|price|model|pilot|fallback/i` plus `ai` as a camelCase word segment (Q-3); no `user_id` |
| Owner columns ⊆ GRANTs | 6a | owner repo test | Constants parsed and each column found in the migration's `authenticated` GRANT line for its table |
| Period / strings | 6a | `creditPeriod.test.ts` | Anchor and period strings passed through verbatim; truncated value matches no row in the exact-string fake; calendar-month source pin; reset-date fixtures (28th–31st, 29 Feb, year wrap) |
| Trial total | 6a | unit | Sum of rows with `period_start >= anchor`; a row one microsecond before the anchor excluded |
| Split & adjustments | 6a | unit | Totals-row split; adjustment branch attributes by effective trigger; unresolved → neither part + `warn`; `used` from `credits_total` |
| Rounding (D-c) | 6a | `creditDisplay.test.ts` | 0 → nothing; 0.4 → "less than 1", left = allowance − 1; 62.5 / 40.6 + 21.9 → 63 = 41 + 22; parts always sum; over → left 0; negatives clamp |
| Balance | 6a | `creditBalance.test.ts` | `max(0, a + g − u)`, null without allowance, no rounding |
| Allowance helper | 6a | `creditAllowanceView.test.ts` | Monthly, total, withheld `{perMonth:0}` → null, unavailable, anomaly, basis none, paused → null, grace → allowance |
| States × languages | 6a | `UsageCard.render.test.tsx` with the real `translations` for en / he / es | Loading, error, monthly, nothing used, less than 1, near (orange), over, trial, no allowance, no plan row; he renders RTL; no "AI" in any card text; no token or dollar figure |
| Refresh triggers | 6a | render tests | Mount fetches once with `cache: 'no-store'`; signal → one re-read; visibilitychange visible → one; `pageshow` persisted → one; icon click → loading state then figures; three triggers during a read → exactly one extra read |
| No timers (AC-33) | 6a | `ownerCreditSurface.guard.test.ts` | No `setTimeout`, `setInterval`, `requestAnimationFrame`, `BroadcastChannel` in the card or signal module; each rule proved on a planted violation |
| Signal raised | 6a | per-surface tests | S-1…S-7 each raise exactly once after success and once after failure |
| FR-36 retirement | 6a | guard | No rate key, `token_usage` or "Pilot" in the route, card, signal or new modules |
| Cross-check | 6a | `ownerCreditUsage.crossCheck.test.ts` | Card `used` = `buildCreditReport` credits for the same account and period |
| Entitlements registration | 6a, 6b | `npm run test:bos-entitlements` | Green |
| R-7 restored | 6b | module + `PlanSection` tests | Restored assertions green; exit grep empty |
| D-g / D-h | 6b | module, `PlanSection`, invite page render tests | "Credits" heading first; line with its number; sentence (monthly / trial variant) en/he/es |
| OI-10 | 6b | `planOfferView.test.ts`, invite render | he / es invite shows localised labels and "per month" / "in total"; admin view still English |
| Types / lint / build | both | `npx tsc --noEmit` vs T-a0 baseline; `npx eslint` on changed files; `npm run lint:hooks`; `npm run typecheck:bos-llm`; `npm run check:bos-llm-literals`; `next build` | No new error; clean; exit 0 |
| Wider suites | both | `npm test -- lib/business-os app/api/business-os components/business-os app/invite components/test-business-os` | No new failure vs baseline |
| Manual (QA, AC-33) | 6a | Dashboard in a browser, network tab | Chat answer moves the card without reload; tab away and back re-reads; icon shows loading then figures; idle page makes **no** periodic request; figures match the Costs & credits tab for the same account and period; he and es checked visually |
| Manual (QA) | 6b | Settings → Plan and `/invite` for each plan | Numbers and sentence present, en/he/es |

---

## 8. Guardrails

- No migration; no new ledger column; no write to any table.
- No service-role read of ledger rows on the owner route; service role only for the snapshot (existing), the anchor, and the pure period function — each documented in code.
- No account id from the request; the route reads nothing from the request.
- No tokens, dollars, cost, model or "Pilot" on any owner surface; never "AI credits".
- No warning, pause, upgrade or grant wording or logic (slices 8, 10, 11).
- No timer or background polling; no `BroadcastChannel`; the event carries no figures.
- Period keys never pass through `Date`.
- "Could not read" is never shown as "nothing used" or "0 left".
- No branch on a cohort or tier name; the trial is recognised by `{ total }`.
- 6b never merges before 6a; neither part ships with any piece of the R-7 rule half-removed.
- `bos-llm-call-standards` not engaged: no AI call added, `runAiAction` untouched.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Microsecond `period_start` truncated → card silently reads 0 | Strings end to end, exact-string fake test, source guard (§4.2) |
| R-2 | The number jumps for every owner on deploy (KI-18) | Decided (D-f): the user's personal note to the 8 Founding Partners before or on deploy |
| R-3 | he / es D-b wording not native-reviewed | Release precondition (D-b); flagged to the user at the diff review |
| R-4 | Entitlement snapshot cached 30 s while the anchor is live: right after a plan change the allowance may be the old plan's for up to 30 s | Display only, self-heals on the next trigger (Q-7) |
| R-5 | Spanish grouping differs by size (`2000` vs `19.750`) under `Intl` | It is the locale's rule; accepted unless SA prefers en-US grouping (Q-10) |
| R-6 | `LanguageContext.tsx` is large and busy; rebase conflicts with parallel work (slice 7 will also add keys) | Keys added as one contiguous block per language; rebase before RM |
| R-7 | Card shows the reset date in UTC for a moment until the timezone arrives (`UTC` placeholder, V-12) | Accepted; the card re-renders when context resolves |
| R-8 | Chat v2 turns may not be charged (known unledgered path) — the card will not move after one | Signal still raised; documented for QA as expected |
| R-9 | Future T-2 (account ≠ user): owner RLS policy is `auth.uid() = user_id` | Out of scope; recorded — the owner repo would need a policy change then |
| R-10 | Deleting the Layer 1.1 characterization tests looks like weakening coverage | Ruled by SA (F-11); replaced by the new route tests, and the admin side keeps `usageSummary.test.ts` |

---

## 10. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Where does the `business_os_credit_period_start` wrapper live? The owner repo cannot run it (no EXECUTE) and the admin read repo's source test forbids `.rpc(` | New `BusinessOsCreditPeriodRepository` (one method, service role, one `.rpc`) rather than a method on `BusinessOsAccountPlanRepository`, which is about the entitlement tables |
| Q-2 | May `OWNER_CHARGE_COLUMNS` include `user_id` (granted), beyond SA's list? | Yes — `resolveEffectiveFields` refuses a cross-account original by comparing `user_id`; keeping that check intact beats filling the field from the argument |
| Q-3 | The "no `ai` in any field name" rule vs `remaining` (contains the letters) | Scan `ai` as a camelCase word segment; the other banned words as substrings |
| Q-4 | Lapsed accounts: the resolver does not apply the grace / paused overlay to values (V-8). Should `creditAllowanceForDisplay` return `null` for state `paused` (and `unknown`) and the allowance for `grace` / `past_due`? | Yes, as SA's "in grace the allowance, once lapsed usage with no gauge" |
| Q-5 | Period kind when a plan row exists but no allowance resolves (unavailable / anomaly / paused) | `monthly` with its true reset date; an unreadable trial therefore shows its current monthly period rather than the trial total — accepted as a rare anomaly |
| Q-6 | S-5 raises after every `my-day` response, which narrates a briefing only sometimes (a cached briefing makes no call) — a superset of "once per AI action" | Accept: one extra read per dashboard data load, never periodic; the response does not say whether it narrated |
| Q-7 | 30 s snapshot cache vs live anchor (R-4) | Accept; no cache bypass added |
| Q-8 | Label beside the title for the no-plan-row state (no D-decision covers it) | "This month" / "החודש" / "Este mes" (it is a calendar month) — or no label, if SA prefers |
| Q-9 | D-h via an optional `noteKey` on the category presentation, variant chosen by the metered value's shape — is that a "display exception" of the kind R-7's removal deletes? | No: it is a category-level property, capability-agnostic, and changes no value |
| Q-10 | OI-10 scope: value phrases localised, variant ids unchanged; number grouping per locale (`Intl`) or kept `en-US` | Phrases localised, ids unchanged, `Intl` per locale to match the card |
| Q-11 | Client-safe `creditDisplay.ts` and `ownerCreditUsageTypes.ts` in `lib/business-os/credits/` (otherwise server modules) | Keep there with an "imports nothing server-side" guard, next to the logic they mirror; alternative `lib/business-os/client/` |
| Q-12 | Where to record the orphan `monthly_ai_allowance_usd` key | Pricing doc §8 open-items row, plus §11 below |
| Q-13 | Check 5 identifiers (`UsageCardCheck`, `usageCard`, `shownOnCard`) | Leave as recorded naming debt; relabel visible strings only |

---

## 11. Logging, deprecated systems and follow-ups

**`console.*` in touched files:** none. All 29 files this plan touches were counted (route, card, `LanguageContext.tsx`, `ChatCommandPanel.tsx`, `app/business-os/page.tsx`, `LiveDashboard.tsx`, both intake components, the four repositories, the usage and Check 5 files, the entitlements files, `PlanSection.tsx`, the invite page files and invite services, `effectiveFields.ts`): **0** each. Nothing to flag or convert.

**Pre-existing, not touched, flagged only:** `app/api/business-os/entitlements/my-plan/route.ts` reads `user_preferences` with a direct `supabaseServer.from(...)` (CLAUDE.md rule 1) — `UserPreferencesRepository.findPreferredLanguage` exists; a one-line follow-up. `LanguageContext.tsx`'s direct client Supabase call remains the separate backlog chip from slice 5.

**Deprecated systems:** none touched. The agent-platform Pilot Credit reads (Stripe, analytics) are separate and untouched.

**Follow-ups recorded:**

- The orphan `monthly_ai_allowance_usd` system-config key (no reader after 6a) — remove in a later clean-up migration if ever wanted (Q-12).
- Check 5 identifier naming debt (Q-13).
- For BA: A-18 "superseded by slice 6" note and KI-18's anchor-reset line in the requirement.

---

## 15. User decisions after the local preview

Numbered 15 so it does not collide with the requirement's §12–§13 decision lists. Recorded by Dev on 2026-10-01; the user viewed 6a locally and asked for a simpler card. UI only: no route, payload, repository or migration change.

| # | Decision (user, 2026-10-01) | As built |
|---|---|---|
| U-1 | **Remove the line under the ring** — used and the split ("2 used — 2 by you · 0 automatic", "less than 1 used …") | Removed in every state. "Nothing used yet this period" / "Nothing used yet" were the same element (`credits-split`), so they are gone too: a gauged card with nothing used shows the full ring and "{allowance} left". Over the allowance the card shows "0 left" and an empty ring; the true figure used is no longer on the card. The no-allowance state never relied on the line — its used figure is the ring's centre ("63 used"), unchanged |
| U-2 | **Remove the explanation sentence from the card body** | `credits-explain` paragraph removed |
| U-3 | **Show the same sentence as a tooltip on the ring** — hover and keyboard focus | No tooltip primitive exists in `components/ui/` and `@radix-ui/react-tooltip` is not installed, so — no new dependency — the codebase's hand-rolled pattern (`DarkModeToggle`) is followed: the ring is a tab stop (`tabIndex=0`, `role="img"` with the existing label, moved from the `<svg>` to the wrapper), `aria-describedby` → a `role="tooltip"` element that is always in the DOM and toggled by visibility; opens on mouse-enter and focus, closes on mouse-leave, blur and Escape. Same keys as before (`usage.explain.monthly` / `usage.explain.trial`); only when there is an allowance (DV-3) — with none, no tooltip and no tab stop |
| U-4 | **Keep the split in the API** | Payload and route unchanged (`usedByOwner`, `usedAutomatic` still returned and still validated by the card's payload check) |

**Dictionary:** `usage.by_you`, `usage.automatic`, `usage.none_period`, `usage.none_trial` removed in en / he / es — the card was their only reader (repo grep), and all four were added by this uncommitted slice. Kept: `usage.used` and `usage.less_than_one` (still read by the no-allowance centre), `usage.explain.*` (the tooltip). The es / he D-b native-review note in §4.7 still applies — the sentence is unchanged, only moved.

**Tests:** `UsageCard.render.test.tsx` — every state asserts no `credits-split` and none of the split / "nothing used" words in the card body (tooltip excluded), the sentence appears exactly once and only inside the ring's tooltip (en / he / es, monthly and trial), and a new case drives focus → visible, Escape → hidden, hover → visible, mouse-out → hidden, with the ring described by the tooltip. No-allowance: no tooltip, no `tabindex`, no `aria-describedby`.

---

## SA Review Notes

### SA workplan review — slice 6 (2026-09-30)

**Reviewed by SA — 2026-09-30**, against the requirement's "SA review — slice 6 scoping (2026-09-30)" (C-S6-1, C-S6-2, SQ-20 to SQ-28, other rulings, conditions 2–5) and §13 D-a to D-h, in this worktree at `d5a7a93a`. Skills applied: `business-os-entitlements`, `new-api-route`, `new-repository`, `tenant-isolation-guard` (`bos-llm-call-standards` correctly not engaged). Verified as-built: migration `20261015` (GRANT lines `:130-132`, `business_os_credit_period_start` `:138-170` — `STABLE`, `SECURITY INVOKER`, `search_path = ''`, reads no table, EXECUTE `service_role` only `:275`; recorder's `calendar_month` branch `:215`), `effectiveFields.ts` (`EffectiveFieldsInput`), `resolver.ts` (`withheldValue`), `lifecycle.ts` / `types.ts:343` (`LifecycleState`), `EntitlementService.getSnapshot`, `enforcementPoints` registration, `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` (RC-15), `serviceColumn.guard.test.ts`, `boundaries.static.test.ts`, `ChatCommandPanel.tsx` (`handleV4Send` and its four callers, `handleV2Send`, the early returns before `handleSend`'s `try`), `app/business-os/page.tsx` (`fetchDashboardData` and its eleven callers), `ConfigurationDialog.tsx` → `BusinessProfileSection.tsx` → `MediaUploader.tsx` → `MediaLibraryPicker.tsx`, every client caller of every `runAiAction` route, the `my-plan` route, `supabaseServerAuth.ts`. Review only; no code.

**Status: ✅ APPROVED WITH CONDITIONS.** The plan implements C-S6-1 (split from the totals row) and C-S6-2 (a separate owner repository on the RLS client), all nine SQ rulings, the FR-28 allow-list and banned-word tests, the D-c rounding function, "no allowance" decided from the resolution, one registered non-gate importer with the id literal kept inside the module, the FR-36 source guard, the R-7 removal after 6a with the exit grep (including the wrapped-marker pattern), the three extra states, the string rule for microsecond keys, and D-a to D-h (D-d: 6a merges alone). Two gaps would have gone red or left AC-33 short (W6-1, W6-2); the rest are precisions. **6a may start now**: Dev folds W6-1 to W6-9 into §4 / §4.10 / §4.11 as the first step of T-a0, with no second workplan pass; SA checks them at code review.

#### Conditions (Dev, folded into the plan before code)

| # | Priority | Finding | Required change |
|---|---|---|---|
| W6-1 | **High** | **The RC-15 guard is missed.** `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` refuses any file outside its `ALLOWED` set that names `businessOsAccountPlanRepository` / `BusinessOsAccountPlanRepository`, and it runs inside `npm run test:bos-entitlements` (the `lib/repositories/__tests__` glob). Whatever file wires `findPeriodAnchor` (`creditPeriod.ts` or `ownerCreditUsage.ts`) turns that suite red | Name the plan repository in **one** wiring file only (the `creditLeakCheckDeps.ts` / `friendInviteDeps.ts` precedent — e.g. `lib/business-os/credits/ownerCreditUsageDeps.ts`, or `creditPeriod.ts` itself). Add it to `ALLOWED` **and** `NO_STATE_WRITE_REFERRERS`, with a comment: "Credit deduction slice 6a: the owner card's period — READ ONLY, `findPeriodAnchor` and nothing else". Add the file to §4.10 and the guard edit to T-a1 |
| W6-2 | **High** | **The S-list is missing one owner AI surface reachable on the dashboard.** `ConfigurationDialog` (mounted by the dashboard page and the `business-os` layout) → Business tab → `BusinessProfileSection.tsx:558` logo `MediaUploader` → "Generate" (`MediaUploader.tsx:349`) → `MediaLibraryPicker.generate` → `POST /api/website/media/generate` (`image_generation`, `isCharged: true`). The plan's "media picker is on other pages" is not true for the logo | Add **S-8**: raise in `MediaLibraryPicker.tsx`'s `generate` `finally` (`:214`), inside the shared picker, so every host is covered (a raise with no card mounted is a no-op). Add to §4.6, §4.10, T-a12 and the tests. The remaining set S-1 to S-7 is verified complete and correctly placed: `handleSend`'s early returns (publish / confirm / cancel) exit before the `try`, so its `finally` never fires without a chat call; `chat-v4/attach`, `gaps` (names `LeadAlertService` in a comment only), insights, stats and channels run no AI; `lead_reply_recommendation` is `external` (inbound lead), never an owner action on the page |
| W6-3 | Medium | **`OWNER_CHARGE_COLUMNS` does not satisfy `EffectiveFieldsInput`,** which also requires `service` and `action_type` (`effectiveFields.ts:26-34`). Without them the rows need a cast or invented nulls | Add `service, action_type` (both in the `authenticated` GRANT at `:130`) — final list `kind, action_id, adjusts_action_id, credits, triggered_by, period_start, user_id, service, action_type`. Selecting them is not filtering on them; `serviceColumn.guard.test.ts` must stay green with the new repository added to its scan. Neither field reaches the payload |
| W6-4 | Medium | **Numeric columns may arrive as strings** (the sibling's own note, `BusinessOsCreditLedgerReadRepository.ts` row type). A `Number('x')` that yields `NaN`, or a string concatenation in the trial sum, would produce a wrong figure silently | Parse every credits column with `Number(...)` and `Number.isFinite`; a non-finite value is a **read error** (500 path, logged), never 0. One unit test with string-typed numerics and one with a garbage value |
| W6-5 | Medium | **Q-5 as proposed shows "Resets {date}" on an ungauged card** (a paused or unreadable plan). A reset date promises a refill the owner may not get | `resetsOn` is `null` whenever `allowance` is `null`, whatever the period kind. The sum still runs over the current anchor period (`monthly`). The card shows no label beside the title in that state; "This month" only for `calendar_month` (Q-8). Test both |
| W6-6 | Medium | **`listTotalsFrom` at the 24-row ceiling** is unspecified; a partial sum would be shown as the trial's total | `reachedCeiling` → a read error with a `warn` naming the account (an anomaly: a trial allowance on an anchor two years old), never a partial total. Test it |
| W6-7 | Low | **Rewording scope (SQ-23) misses four card claims**: `llmUsageReport.ts:133` ("the card's own computation"), `llmUsageReportTypes.ts:127` and `:134`, and `usageSummary.test.ts:6` (names the deleted `route.test.ts`). Check 5 also keeps a **"Credits"** column and total computed as tokens ÷ `tokens_per_pilot_credit` — next to the ledger's credits on the Costs & credits tab, an operator will compare two different units | Reword the four comments. Relabel Check 5's "Credits" column and total to name the legacy measure (e.g. "Token credits (tokens ÷ N)") — admin surface only, so naming the old unit is fine there. Add the two files to §4.10 / T-a14 and update the tests asserting those strings |
| W6-8 | Low | **Repository conformance (`new-repository` checklist) for the two new repositories** | **`BusinessOsCreditPeriodRepository`** (Q-1): optional client defaulting to `supabaseServer`, header comment stating the bypass is intentional because EXECUTE is `service_role` only and the function is pure (`STABLE`, `SECURITY INVOKER`, empty `search_path`, reads no table); exported singleton; `periodStartFor(anchor, at)` takes **no account id**, validates both as timestamptz strings (a strict ISO pattern; refuse without calling), returns the string verbatim; source test: exactly one `.rpc('business_os_credit_period_start'`, no `.from(`, no `user_id`. "`.eq('user_id')` on every query" is N/A by design (no table) — say so in the header. **`BusinessOsCreditOwnerReadRepository`**: no singleton because the client is required (SA SQ-21) — record the checklist item as N/A by design in its header |
| W6-9 | Low | **`creditAllowanceForDisplay` (Q-4) duplicates lifecycle knowledge** | Write it as an **exhaustive** `switch` over `LifecycleState` with a `never` check, so a new state fails to compile until someone decides it. `paused` and `unknown` → `null`; `trial`, `champion`, `active`, `past_due`, `grace` → the value. `stale: true` snapshots are used (display only; T-3 bars stale data from owner-paid answers, not from a read-out) — document that in the helper. It must never be imported by a gate |

#### Answers to Q-1 to Q-13 (all TECHNICAL)

| Q | Ruling |
|---|---|
| Q-1 | **Approved:** a new `BusinessOsCreditPeriodRepository`, not a method on the plan repository (whose purpose, guard and write methods are about entitlement state) and not on either ledger repository (the admin one forbids `.rpc(`; the owner one has no EXECUTE). Tenant safety holds: the function reads no table, its inputs are two timestamps, and no account id crosses it. Conditions in W6-8 |
| Q-2 | **Yes**, and extend further per W6-3 (`service`, `action_type`). `user_id` keeps `resolveEffectiveFields`' cross-account refusal intact; it is granted and never echoed |
| Q-3 | **Approved:** the other banned words as case-insensitive substrings; `ai` as a camelCase / snake_case word segment (`/(^|_)ai($|_|[A-Z])|[a-z]Ai($|[A-Z_])/`-style, proved on planted `aiCredits`, `ai_used`, `usedAi`, and passing `remaining`, `trial_total`). Keys only; enum values are covered by the exact-shape test |
| Q-4 | **Yes**, as W6-9 |
| Q-5 | **Approved with W6-5:** `monthly` scope for the sum, no reset date when there is no allowance. An unreadable or paused trial showing its current anchor-month's use (not the trial total) is acceptable: the card is ungauged, so no "left" figure can be wrong |
| Q-6 | **Accepted.** Raising after every `my-day` settle is a superset of "once per AI action", owner- or load-driven, never periodic. Note for QA: `fetchDashboardData` also runs after a config dialog closes, a booking or contact is saved, etc. (eleven call sites), so each of those also re-reads the card once — expected, and still no request on an idle page. Do not add a narration flag to the `my-day` payload for this |
| Q-7 | **Accepted, no bypass.** For up to 30 s after a plan change the allowance may be the old plan's against the new anchor (e.g. "2,000 left of 2,000 in total" right after moving off the trial). Display only; self-heals on the next trigger; keep it in R-4 |
| Q-8 | **"This month" / "החודש" / "Este mes"**, for `calendar_month` only (W6-5) |
| Q-9 | **Not a display exception.** A category-level optional `noteKey` changes no value and names no capability. Choose the variant generically inside the module (the shape of the category's metered value: `{ perMonth }` → `.monthly`, `{ total }` → `.trial`); render the note only when the category renders at least one line |
| Q-10 | **Approved as proposed:** phrases localised at the root, variant ids unchanged, admin callers stay English, grouping via `Intl.NumberFormat(locale)` to match the card (Spanish `2000` vs `19.750` is CLDR's rule — accept). Tests assert strings produced by the same `Intl` call or pinned from Node's ICU, never hand-typed separators |
| Q-11 | **Keep them in `lib/business-os/credits/`** with a source guard that `creditDisplay.ts` imports nothing and `ownerCreditUsageTypes.ts` has no value import; `UsageCard.tsx` may import only those two from that directory (add to the guard). There is no barrel in the directory, so no server code can leak through one |
| Q-12 | **Approved:** pricing doc §8 open-items row and §11. BA adds an OI in the requirement §17 at the next fold-in (not Dev's edit) |
| Q-13 | **Approved as naming debt.** Add a one-line comment on `UsageCardCheck` / `evaluateUsageCardCheck` that the name is historical and the check no longer mirrors the owner card, so the next reader is not misled |

#### Points checked and accepted as planned

- **Microsecond strings end to end** (§4.2): anchor string → RPC → `period_start` string → `.eq` / `.in`; trial `.gte` on the anchor string; adjustment period keys taken from the rows returned, never re-formatted; `Date` only in `nextPeriodStartUtc` (display). The exact-string fake and the source guard are the right proofs. Node's clock for `p_at` against the recorder's DB `now()` can differ by milliseconds at a period boundary — negligible; accepted.
- **Owner repository vs grants**: `OWNER_TOTALS_COLUMNS` ⊆ the totals GRANT; charge columns ⊆ the charges GRANT after W6-3; the parsed-GRANT subset test is the right pin. An expired or missing session on the RLS client yields a permission / JWT error (no `anon` grant), so it surfaces as a read error, not as zero rows.
- **Tenant isolation**: no input read; account only from `resolveAccountId(user.id)`; every owner query RLS + `.eq('user_id')`; service role limited to the snapshot, the anchor and the pure function, pinned by a source guard. The `tenant-isolation-guard` checklist has no caller-supplied id to check.
- **Layer 1.1 characterization deletions**: as ruled (F-11). Nothing else references `usage/__tests__/route*.test.ts` except the comments listed in W6-7 and `snapshotsAreDateless.test.ts`; `boundaries.static.test.ts`'s owner-route assertions stay green on the new route (no `token_usage`, `.rpc(`, `.from(`, `createClient(`). `usageCategories.ts` keeps its Check 5 consumers — not dead.
- **Entitlements registration**: one non-gate importer, `symbols` exactly `getEntitlementService`, `resolveAccountId`, `creditAllowanceForDisplay` (add any type import, e.g. `SnapshotResult`, to `symbols` if used); no tier literal (`TIER_ORDER` is `basic`, `pro`; `trial_total` is not one). Plus W6-1.
- **R-7**: removal only in 6b, 6b only after 6a merges; exit grep over `app lib components hooks` with both patterns. 6b **may be built in parallel** off `main` and rebased after 6a merges; only the merge order is fixed.
- **Estimates**: 6a ≈ 3.5 d (W6-1 to W6-9 add well under a quarter-day) and 6b ≈ 1–1.5 d are each within the few-days rule and SA's ranges.

#### `my-plan` route (Dev's flag)

**A separate chip, not 6a.** The card takes the business timezone from `LanguageContext` (V-12), so 6a never touches `app/api/business-os/entitlements/my-plan/route.ts`. It is a real rule-1 breach (`supabaseServer.from('user_preferences')` at `:90`, while `UserPreferencesRepository.findPreferredLanguage` exists) and should not be waived: record it as a follow-up in §11. **If 6b edits that route for any reason (e.g. OI-10's locale), fix it in the same change** (touched-file rule), with a test that it reads the language through the repository.

#### Optimisation suggestions (non-blocking)

- S-1 to S-4 can be two raise sites instead of four: one in `handleV4Send`'s own `finally` (it is the one function all four v4 callers await) and one in `handleSend`'s `finally` for the v2 path only. Either shape passes the "exactly once per action" test.
- T-a12's per-surface tests: behavioural where the component renders cheaply (`AddIntakeQuestion`, `MediaLibraryPicker`); for `ChatCommandPanel.tsx` and `app/business-os/page.tsx` a source-level guard that each named `finally` calls `notifyCreditUsageChanged()` exactly once is acceptable.
- Display rounding: with used ≥ 1, a part between 0 and 1 shows as 0 under largest-remainder (e.g. "63 used — 63 by you · 0 automatic" after one lead reply). D-c's sum rule wins; give QA that example so it is not filed as a bug.

#### Business questions

None. Every open item above is technical and ruled. D-a to D-h stand as decided.

#### Approval

- [x] Workplan approved with conditions W6-1 to W6-9 — **6a may start**; Dev folds the conditions into the plan first, SA verifies at code review
- [ ] 6b starts after 6a merges (or is built in parallel and rebased); merges only after 6a

### SA code review — 6a (2026-09-30)

**Code Review by SA — 2026-09-30**, on the uncommitted diff in `neuronforge-llm-deduction` (`feature/business-os-credit-deduction-slice-6`, off `d5a7a93a`): `git diff` plus every new file listed in §4.10, the 8 raise sites, the RC-15 / `enforcementPoints` / `serviceColumn` guard edits, the Check 5 relabel, the dictionary and the three retired Layer 1.1 files. Skills walked: `business-os-entitlements` (review checklist), `new-api-route`, `new-repository`, `tenant-isolation-guard`. Review only; no code changed, no DB touched.

**Status: ✅ Code Approved — no blocking finding.** Every condition W6-1 to W6-9 is met in code and pinned by a test; the SQ-20 to SQ-28 rulings hold; DV-1 to DV-9 are all accepted.

#### Gates re-run by SA

Jest with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys.

| Gate | Result |
|---|---|
| New + touched suites (`lib/business-os/credits`, `lib/business-os/client`, `components/business-os`, `app/api/business-os/usage`, `creditAllowanceView`, `lib/business-os/usage`, `components/test-business-os`, `snapshotsAreDateless`) | 33 / 34 suites, 563 / 564 tests. The one red is `usage/tokenUsageRepository.contract` (baseline, see below) |
| `npm run test:bos-entitlements` (includes `lib/repositories/__tests__`) | **100 / 100 suites, 2,091 / 2,091 tests** |
| Wider run (Dev's 10 paths) | 311 / 315 suites, 5,727 / 5,730 tests, 1 snapshot red — **the same 4 suites Dev recorded as the T-a0 baseline**, each checked to be unrelated to this diff: `chat-v4/route.audit` (cannot resolve `@anthropic-ai/sdk`), `catalog/proposals-capability` (a new status in the database's list), `llm/callParams.boundary.step3` (chat planner snapshot), `usage/tokenUsageRepository.contract` (`summariseFeatureAllAccountsInWindow` is not in the arity pin — pre-existing; the 6a edit to `TokenUsageRepository.ts` is a comment only) |
| `typecheck:bos-llm` | passed — 28 errors, 0 new (one baseline entry now fixed, pre-existing) |
| `check:bos-llm-literals` | passed — 0 violations |
| `lint:hooks` | exit 0 |

Tooling note for QA and RM: in this worktree `node_modules` is a link to the main checkout's and `node_modules/.bin` does not resolve, so `npm run typecheck:bos-llm` / `check:bos-llm-literals` / `lint:hooks` fail with "'tsx' / 'eslint' is not recognized". SA ran the same commands with `node node_modules/tsx/dist/cli.mjs …` and `node node_modules/eslint/bin/eslint.js …`. Not a code issue.

#### Conditions W6-1 to W6-9 — verified

| # | Verified in code | Pinned by |
|---|---|---|
| W6-1 | `ownerCreditUsageDeps.ts` is the only file naming the plan repository; it is in RC-15 `ALLOWED` and `NO_STATE_WRITE_REFERRERS` with the required comment; it calls `findPeriodAnchor` only | New RC-15 test (method census, with a planted second method) |
| W6-2 | S-8 raise in `MediaLibraryPicker.generate`'s `finally` | Behavioural test: success, refusal, network failure each raise once; the library load raises nothing |
| W6-3 | `OWNER_CHARGE_COLUMNS` adds `service, action_type`; rows are passed to `resolveEffectiveFields` with no cast to `EffectiveFieldsInput`; `service` never filtered | `serviceColumn.guard` now scans the owner repository and `ownerCreditUsage.ts` |
| W6-4 | `figure()` in `ownerCreditUsage.ts:115` — number or non-empty string → `Number`, non-finite → `unreadable_figure` error | Unit (string / garbage / `Infinity`) and route (`credits_owner: 'NaN'` → 500) |
| W6-5 | `resetsOn` is null unless `allowance !== null && kind === 'monthly'`; the card shows no label beside the title without an allowance, "This month" only for `calendar_month` | Route (unavailable snapshot → `resetsOn: null`), unit, render |
| W6-6 | Trial ceiling → `warn` naming the account + `trial_ceiling` error; the same for the adjustments ceiling | Unit |
| W6-7 | The four comments reworded; Check 5 column "Token credits (tokens ÷ N)", total "token credits", caveat without a card claim, "Has tokens" | `LlmUsageVerification.test.tsx` caveat assertions |
| W6-8 | Period repository: optional client, `supabaseServer` default, bypass and "rule 4 N/A" documented in the header, singleton, strict timestamptz refusal before the call, one `.rpc`, no `.from(`, no `user_id`. Owner repository: singleton recorded N/A by design | Repository source tests |
| W6-9 | `showsAllowance` is an exhaustive `switch` over `LifecycleState` with a `never` default; stale snapshots used and documented; no gate imports it | `creditAllowanceView.test.ts` (all seven states) |

#### The specific checks asked for

- **Tenant isolation.** The route reads no input (the source test forbids `searchParams`, `nextUrl`, `new URL(`, body readers and `params`); the account is `resolveAccountId(user.id)` only. The ledger is read through `createAuthenticatedServerClient()`; every owner-repository method validates the UUID and adds `.eq('user_id', accountId)` on top of RLS. The period repository takes no account id and touches no table. The service role appears only in `ownerCreditUsageDeps.ts`'s two repositories (the anchor and the pure function), and the route test proves the owner client read only `business_os_credit_totals` and the service client only `business_os_account_plans`. `?accountId=<other>` is ignored.
- **Columns vs grants.** `OWNER_TOTALS_COLUMNS` ⊆ the totals GRANT (`20261015:132`) and `OWNER_CHARGE_COLUMNS` ⊆ the charges GRANT (`:130`); the `.order('created_at')` is on a granted column too. No cost or fallback column. The test parses the migration.
- **Microsecond strings.** The anchor goes from PostgREST to `.rpc` unchanged, the RPC's answer goes to `.eq('period_start')` unchanged, the trial `.gte` uses the anchor string, and adjustment keys are taken from the rows as read. `Date` appears only in `nextPeriodStartUtc` (display) and in validation (`Date.parse`, never re-serialised). The route test's happy path asserts the exact microsecond string on the wire.
- **Route.** `runtime = 'nodejs'`, `force-dynamic`, 401 before any read (test: no client built, no query, no RPC), `Cache-Control: private, no-store` on the 200, 401 and 500 answers, generic `'Could not load your credits'` with details only in development, Pino child with `correlationId`. FR-28: exact recursive key set plus banned-word scan (substrings plus the `ai` word-segment rule proved on `aiCredits` / `ai_used` / `usedAi` and passing `remaining` / `trial_total`).
- **Rounding.** 0 → nothing; `0 < used < 1` → "less than 1", counted as 1; else `Math.round`; the parts are shared out by largest remainder so they add up; `left = max(0, allowance − displayed used)`. The card uses this `left`, not the server's `remaining`: the same figure while `granted` is 0.
- **Signal.** Exactly 8 raise sites (census: 4 in `ChatCommandPanel.tsx`, `page.tsx`'s `my-day` `.finally`, both intake components, the media picker), each in a `finally` after the awaited call. `handleV4Send` / `handleV2Send` do not raise, so an action raises once; the imperative handle exposes no send path. No payload on the event. The card: one request at a time (ref in-flight flag plus one pending re-read), `AbortController` on unmount, stale answers ignored by controller identity. **No `setTimeout` / `setInterval` / `requestAnimationFrame` / `BroadcastChannel`** in the card or the signal module (grep and the source guard).
- **FR-36.** None of `monthly_ai_allowance_usd`, `pilot_credit_cost_usd`, `tokens_per_pilot_credit`, `token_usage` or "Pilot" appears in the 12 owner-surface files, comments included (grep and the guard).
- **Entitlements registration.** `ownerCreditUsage.ts` is the only non-test file outside the module that imports from it: `getEntitlementService`, `resolveAccountId`, `creditAllowanceForDisplay`, all three in `symbols`, with a `why`. No type-only import was missed. The route, card, display and types files import nothing from the module; the capability-id literal stays inside it. The payload builder calls `getSnapshot`, never `check()` / `decide()` (guard).
- **Check 5 relabel.** Title, `StatusSummary` label, caveat, column and total relabelled; the identifiers remain as recorded naming debt with the Q-13 comment.
- **`buildCardBreakdown` removal.** Safe: no remaining reference in `app lib components hooks scripts`; `toCredits` keeps its Check 5 callers and `usageCategories.ts` keeps its consumers.
- **Dictionary.** The D-b sentences match the requirement's decided text in en / he / es exactly; the D-a split labels match. The removed `usage.*` keys have no consumer left.
- **`console.*`.** None in any touched or new file.

#### Deviation rulings

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** Replacing the positive pin with "no config read at all" is right, because the route now reads no config. The new consequence, that `ConfigRepository.getSystemConfigs` has no production caller, is **not** removed in 6a. It is a generic repository method with its own tests, and deleting it is clean-up unrelated to the owner card. Recorded as a follow-up chip (L-2) |
| DV-2 | **Accepted.** `new-repository` checklist step 4. There is correctly no owner-repository singleton |
| DV-3 | **Accepted, and it is the correct reading of D-b.** Both decided sentences end with a claim that the plan or trial "includes a fixed amount". On an ungauged card (no plan row, paused, unreadable plan) that claim is false or unverifiable, and FR-29 / D-e say to show usage only. That state affects zero live accounts today (all 8 have a plan row) and is an anomaly state, so it does not need its own sentence. If one is ever wanted, it is a new dictionary line needing native review, not a code change, so this is not a business question now |
| DV-4 | **Accepted.** Day and month order follows the reader's locale through `Intl`, in the business timezone. §6's "14 Oct" was illustrative |
| DV-5 | **Accepted.** The rows were edited where they actually live |
| DV-6 | **Accepted.** An error line next to figures from an earlier read would present them as current. "Could not read" is never shown as a number, and the refresh icon plus the next trigger recover. QA should expect a transient network failure to blank the figures, with the error line, until the next successful read |
| DV-7 | **Accepted.** Refusing to turn a non-finite input into a full allowance is the W6-4 principle one layer down. It cannot be reached through the builder, which errors first |
| DV-8 | **Accepted.** SA's workplan review allowed a source-level check where rendering is expensive. The source test pins exactly one raise, inside `generate`'s `finally` |
| DV-9 | **Accepted.** The placeholder is needed for word order in he / es |

#### Code Review Comments

| # | Where | Finding | Priority |
|---|---|---|---|
| L-1 | `components/website/MediaLibraryPicker.tsx:103, 169, 213` | Three pre-existing `catch {}` blocks set a user-facing error but log nothing, and the file has no logger at all. They are handled but not logged. **Ruling: a separate chip, not 6a.** The swallowing is pre-existing and not caused by the S-8 line. Logging one of the three would leave the file half-done, and the fix (a `createLogger` import and `logger.warn({ err }, …)` in each of the three) belongs to whoever next works on the media picker. No `console.*` is involved, so the touched-file rule is not triggered | Low (non-blocking) |
| L-2 | `lib/repositories/ConfigRepository.ts:51` | `getSystemConfigs` has no production caller after DV-1. Follow-up chip: remove it with its test, or keep it as general repository API. Either is fine | Low (non-blocking) |

#### Optimisation Suggestions (non-blocking)

- `lib/business-os/credits/ownerCreditUsage.ts:177`: `rows as readonly OwnerCreditChargeRow[]` is a no-op cast, because `listAdjustmentsForPeriods` already returns that row type. It can go the next time the file is touched.
- `BusinessOsCreditOwnerReadRepository.assertPeriodKey` accepts anything `Date.parse` accepts. The period repository's stricter `isTimestamptzString` could be reused so both key guards refuse the same shapes. It is safe as written because every key the owner repository receives comes from PostgREST or `calendarMonthStartUtc`.
- In the unlikely "less than 1" case where every correction is unresolved, both parts are 0 and "by you" is shown as "less than 1" by the tie rule. That is harmless and does not need a change.

#### Flags answered

- **`MediaLibraryPicker.generate`'s `catch {}`:** separate chip, see L-1.
- **`ConfigRepository.getSystemConfigs` with no production caller:** separate chip, see L-2.
- **Wider-run reds:** the same four baseline suites, each confirmed unrelated.

#### Business questions

None. DV-3 is ruled above as the correct reading of D-b. The only open release condition is the one already recorded in D-b and R-3: native review of the he / es card strings before release.

#### Code Approved for QA: **Yes**

---

## QA Testing Report

### QA report — 6a (2026-09-30)

**QA — 2026-09-30**, on the uncommitted 6a diff in `neuronforge-llm-deduction` (`feature/business-os-credit-deduction-slice-6`, off `d5a7a93a`), after SA's code approval.
**Test mode:** full
**Strategy used:** A (Jest unit: display rounding, reset date, balance), B (Jest route integration with faked RLS / service clients and a faked entitlement snapshot built from the real config), a source review of the 8 raise sites, and log analysis of the gate output. Option D (the manual browser check) was **not run**: the brief rules out a dev server with real credentials.
**Focus:** api, ui, security, schema
**Skipped:** the manual browser check (AC-33, §7 "Manual (QA)"), because there is no dev server with real creds. `next build` was **not re-run by QA** because of the environment incident below.
**Input source:** prompt keywords (the TL brief), plus §7 of this workplan.
**Safety:** no real DB was touched. Jest ran with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. There are no `.env*` files in the worktree. No code was changed: three temporary probe files were written, run and deleted, and hashes match (see the end of this section).

#### ⚠️ Environment incident caused by QA (not a code issue, and the user must act)

To confirm the baseline reds on `origin/main`, QA created a temporary worktree and gave it a `node_modules` junction to `neuronforge/node_modules`. Removing the junction failed on a quoting error, and QA then ran `git worktree remove --force`. **That deleted files through the junction, inside the shared `neuronforge/node_modules`**, before it stopped on "Filename too long". QA then removed the junction safely, and the directory count has held steady since then.

- **Deleted:** `node_modules/.bin`, `node_modules/.package-lock.json`, `@adobe/css-tools`, `@alloc/quick-lru`, `@anthropic-ai/sdk`, `@aws/lambda-invoke-store`, and part of `@aws-sdk/client-sesv2` (its `dist-cjs/index.js` is missing). This was established by checking against `package-lock.json`.
- **Effect:** every worktree that links to this `node_modules` is affected. That includes this one and SA's. `npm run …` scripts cannot find their binaries. jsdom component suites fail on `@adobe/css-tools`, which `@testing-library/jest-dom` needs. `next build` and anything importing the Anthropic SDK or SES will fail.
- **Not repaired by QA:** QA's `npm ci` in the main checkout was **denied by the permission system**, and QA did not retry.
- **User action:** run `npm ci` in `C:\Users\Barak\My Projects\AgentsPilot\neuronforge`. `package-lock.json` is unchanged (`252c8fbc…`). Then re-run `next build` for 6a before RM.
- **Timing:** every Jest gate in the tables below ran **before** the incident, except where marked.

#### Gates

| Gate | Result |
|---|---|
| New + touched suites (36 suites: `app/api/business-os/usage`, `components/business-os/__tests__`, `lib/business-os/client`, `lib/business-os/credits`, `creditAllowanceView`, `enforcementPoints`, the 5 touched / new `lib/repositories` tests, `snapshotsAreDateless`, `lib/business-os/usage`, `components/test-business-os/llm-usage`) | 35 / 36 suites, 682 / 683 tests. The one red is `usage/tokenUsageRepository.contract`: `summariseFeatureAllAccountsInWindow` is missing from the arity pin. That is a baseline red, and 6a's edit to `TokenUsageRepository.ts` is a comment only |
| `npm run test:bos-entitlements` | ✅ **100 / 100 suites, 2,091 / 2,091 tests**, exit 0 |
| Wider run: `lib/repositories lib/business-os/credits components/business-os app/business-os app/api/business-os/usage components/test-business-os app/api/admin/business-os lib/business-os components/scheduling components/website app/api/business-os` | 311 / 315 suites, 5,727 / 5,730 tests, 1 / 23 snapshots red. The 4 red suites are `chat-v4/route.audit`, `catalog/proposals-capability`, `llm/callParams.boundary.step3` and `usage/tokenUsageRepository.contract`, the same set Dev and SA recorded |
| The 4 reds on `origin/main` | ✅ **Pre-existing.** In a clean temporary worktree at `origin/main` **`56feb9d2`** (main has moved past `d5a7a93a`), the same 4 suites fail with the same counts (3 tests plus 1 snapshot). None of the 11 files main changed since `d5a7a93a` overlaps with this diff, so no rebase conflict is expected |
| `typecheck:bos-llm` (run as `node node_modules/tsx/dist/cli.mjs …`, after the incident) | ✅ passed: 357 files, 28 errors, 0 new (the one fixed baseline entry is pre-existing) |
| `check:bos-llm-literals` (via `node …/tsx`, after the incident) | ✅ passed: 53 files, 0 violations |
| `lint:hooks` (via `node …/eslint`, after the incident) | ✅ exit 0 |
| `next build` (6 GB heap, CI placeholder env) | ⚠️ **Not re-verified by QA.** It cannot run until `node_modules` is restored (see the incident). Dev's §4.12 run showed exit 0. SA did not run it. **Re-run it before RM** |

#### Test Coverage

The QA probes were three temporary files, and they were deleted after the run:

- a route probe: 15 tests, using the route suite's fake-client pattern, run before the jsdom breakage mattered, because this suite does not use jsdom;
- a numbers probe: 19 tests;
- a card probe: 44 tests, jsdom with the real en / he / es dictionary, without jest-dom.

All 78 passed.

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Route: 401 without a session | ✅ | Pass | 401 with `Cache-Control: private, no-store`. No client is built, and there is no query or RPC (Dev test plus QA probe) |
| Route: `?accountId=` ignored | ✅ | Pass | QA sent `?accountId=`, `?userId=`, `?range=` and an `x-user-id` header, all naming another UUID. Every `user_id` filter was the session account, and the other id appeared in no query |
| Route: no-store | ✅ | Pass | On 200, 401 and 500 |
| Route: generic 500 on each read failure | ✅ | Pass | Totals, anchor, period RPC, a garbage figure (Dev tests); trial ceiling, a thrown snapshot service, and an unreadable string `'abc'` / `''` / `'Infinity'` / `null` (QA). Every one answered `{ success: false, error: 'Could not load your credits' }` with no `details` outside development, and the thrown message did not leak |
| Payload allow-list, no token / usd / cost / pilot words | ✅ | Pass | The exact keys `allowance, granted, period{kind,resetsOn}, remaining, used, usedAutomatic, usedByOwner` in the monthly, Essentials and trial shapes. The JSON has no `token`, `usd`, `cost`, `dollar`, `pilot`, `model`, `fallback` or `user_id`, and no account id (QA). Also Dev's recursive FR-28 test |
| Founding Partner 32,250 / month, microsecond anchor | ✅ | Pass | Anchor `2026-09-23 19:55:01.28632+00` (Postgres text form) was sent to the RPC **verbatim**. The RPC answer went to `.eq('period_start', …)` verbatim on the **owner** client. The response was `resetsOn` `2026-10-23T19:55:01.286Z` and `remaining` 32,186.6 for used 63.4 |
| Essentials 19,750 | ✅ | Pass | `allowance {19750, month}`, `remaining` 19,686.6 |
| Trial 2,000 total, summed across two totals rows from the anchor | ✅ | Pass | Rows 10.5 (owner) and 5.25 (1.25 owner, 3 scheduled, 1 external) gave used 15.75 = 11.75 by you + 4 automatic, and 1,984.25 left. The read was `.gte('period_start', <anchor string>)`, `kind: trial_total`, `resetsOn: null` |
| Paused: no allowance, no reset date | ✅ | Pass | `allowance: null`, `remaining: null`, `period {monthly, null}`, and used is still shown |
| No plan row: calendar month, "This month" | ✅ | Pass | No RPC call. The key was `2026-09-01T00:00:00.000Z`. `calendar_month` and no allowance, **even when the cached snapshot still names a plan** |
| Unreadable numeric string is an error, not 0 | ✅ | Pass | See the 500 row |
| Trial cap hit is an error | ✅ | Pass | 24 rows returned a generic 500, never a partial total |
| Numbers: 63.4 = 41.2 + 22.2 | ✅ | Pass | "63 used — 41 by you · 22 automatic", 32,187 left. The parts add up. The card shows the same string in en / he / es |
| Numbers: 0.2 gives "less than 1"; exactly 0 gives "Nothing used yet" | ✅ | Pass | 0.2 leaves allowance − 1 (for example 32,249). 0.5 and 0.999999 also give "less than 1". 0 gives "Nothing used yet this period", or "Nothing used yet" on a trial, with the full allowance left |
| Numbers: over the allowance gives "0 left" and the true used | ✅ | Pass | 32,400.7 used shows 0 left and 32,401 used, with parts summing to 32,401. No arc, and no pause, upgrade or warning wording |
| left = allowance − displayed used | ✅ | Pass | Checked on a 430-point sweep, with parts always summing to the displayed used |
| Reset date: month ends, leap year, year wrap, business timezone | ✅ | Pass | Anchor on the 31st: Jan → Feb 28, Feb 28 period → **Mar 31** (counted from the anchor). 2028 → Feb 29. Mar 31 → Apr 30. Anchor on the 30th: Feb 28 period → Mar 30. Dec 15 → Jan 15 of the next year. A k = 11 microsecond anchor. `2026-10-31T22:30Z` shows as "Nov 1" in Asia/Jerusalem and "Oct 31" in America/New_York. The card formats the date in the business timezone (Dev test) |
| Card render, every state × en / he / es | ✅ | Pass | Loading ("—", icon disabled), error (the localised `usage.error` line, headline "—", never 0), Founding Partner data, trial ("For your trial", "of 2,000 in total"), trial and monthly nothing-used, less than 1, near the allowance (orange `#F97316` at exactly 20% left, not at 20% + 1), over, no allowance (no label, no "of", no sentence), no plan row ("This month"). The title is "Credits", "קרדיטים" or "Créditos". There is no `MISSING:` key, no "AI" / "IA" / token / $ / cost / pilot text, and **no "K" abbreviation** (32,187 is shown in full, grouped by locale). he renders RTL |
| The D-b sentence per variant | ✅ | Pass | The monthly sentence matches the requirement's decided text **verbatim** in en, he and es. The trial sentence ends with the requirement's trial ending in each language. It is shown only when there is an allowance (DV-3, accepted by SA) |
| Refresh: the signal fires once after each of the 8 surfaces, on success and on failure | ✅ | Pass | S-7 and S-8 are behavioural (Dev tests: success, refusal and network failure each raise once). S-1 to S-6 are pinned at source level (Dev census), and QA reviewed the diff. Each raise is in the `finally` after the awaited call. `handleSend`'s publish / confirm / cancel early returns come before its `try`. `handleV4Send` and `handleV2Send` do not raise, so there is no double raise. S-5 is `fetch(my-day).finally(notify)`, and its rejection still propagates to `Promise.all` as before |
| Refresh: the card re-reads once per signal; returning to the tab and the icon each re-read | ✅ | Pass | QA probe plus Dev tests. The icon is disabled during a read, so a second click is a no-op |
| Refresh: one request at a time | ✅ | Pass | Signal, signal, signal and visibilitychange during a held read gave **max 1 in flight** and exactly one queued re-read, then nothing more |
| Refresh: no timers | ✅ | Pass | After mount, `jest.getTimerCount()` is 0, and an hour of fake time made **0** extra requests. Dev's source guard bans `setTimeout`, `setInterval`, `requestAnimationFrame` and `BroadcastChannel` |
| Isolation: the owner repository selects only granted columns | ✅ | Pass | Checked by hand against `20261015:130, :132`: the totals columns and charge columns are subsets of the `authenticated` GRANTs, and `.order('created_at')` is on a granted column. The owner `select` in the probe has no cost, usd or fallback column (Dev also parses the migration) |
| Isolation: the period repository has no account id | ✅ | Pass | `periodStartFor(anchor, at)` makes one `.rpc`, with no `.from(` and no `user_id` (source plus Dev test) |
| Regression: admin Check 5 relabelled and still works | ✅ | Pass | Title "Check 5 — Token usage by feature", a "legacy measure" caveat with no card claim, "Token credits (tokens ÷ N)", and "Has tokens". `LlmUsageVerification`, `CheckPanels.layer15`, `boundaries.static`, `llmUsageReport`, `usageSummary` and `llmUsageVerification` are all green |
| Entitlements registration | ✅ | Pass | `test:bos-entitlements` is green, and `enforcementPoints` plus RC-15 are green |
| Manual browser check (AC-33: a chat answer moves the card, tab away and back, the icon, an idle page making no requests, figures matching Costs & credits, he / es visual) | ⬜ | Not run | Owed. The user runs it on a dev server with real credentials, or on the Vercel preview, before or at the diff review |

#### Issues Found

**Bugs (must fix before commit):** none in the 6a code.

**Performance issues:** none. There is one request per trigger, coalesced, and none on an idle page.

**Edge cases (nice to fix, Low, non-blocking):**

1. **QA-E1: back-forward cache restore can cost two reads.** Browsers that fire both `pageshow` (with `persisted`) and `visibilitychange` → visible on a bfcache restore trigger one read plus one queued re-read. They run one after the other, never in parallel, so the "one request at a time" rule still holds. No change needed.
2. **QA-E2: unresolved corrections are redistributed by the display.** The server counts an unresolved correction in `used` and in neither part, as designed. `toDisplayedCredits` then shares the **whole** displayed used between the two parts in proportion, so the unresolved credits show up inside "by you" / "automatic" on the card. This follows D-c's "parts add up" rule, and it applies only to a warn-logged anomaly. Recorded, not a bug.
3. **QA-E3: one timestamp form fails both key guards.** `Date.parse('2026-09-23T19:55:01.28632+00')` (a `T` separator with a two-digit offset) returns NaN in V8, so both key guards would refuse that form. The Postgres text form with a space (`… 19:55:01.28632+00`) and PostgREST's `+00:00` form both parse. PostgREST always emits `+00:00`, so this form cannot occur today. It matches SA's non-blocking suggestion to share one strict key guard.

**Carried from SA (not re-raised):** L-1 (`MediaLibraryPicker` `catch {}` without a log) and L-2 (`getSystemConfigs` has no production caller) are separate chips. Native review of the he / es strings (D-b, R-3) is a release precondition.

#### Test Outputs / Logs

```text
new + touched:        Test Suites: 1 failed, 35 passed, 36 total | Tests: 1 failed, 682 passed, 683 total
test:bos-entitlements Test Suites: 100 passed, 100 total | Tests: 2091 passed, 2091 total | exit=0
wider:                Test Suites: 4 failed, 311 passed, 315 total | Tests: 3 failed, 5727 passed, 5730 total | Snapshots: 1 failed, 22 passed
origin/main 56feb9d2: FAIL chat-v4/route.audit, catalog/proposals-capability, llm/callParams.boundary.step3, usage/tokenUsageRepository.contract | Tests: 3 failed | Snapshots: 1 failed
typecheck-bos-llm: 357 files in scope, 28 errors, 0 new — passed
check-bos-llm-literals: 53 files in scope, 2 exempt, 0 violations — passed
lint:hooks exit=0
QA probes: route 15/15, numbers 19/19, card 44/44 (all deleted after the run)
```

**No code changed during the QA run.** SHA-1 of all 53 changed and new files was taken before the run and re-checked after the probes were deleted, and every file matches. The only change is this workplan: SA's code-review section, written in parallel, plus this QA section and its history row. `git status --short` shows the same 55 entries, and no probe file remains.

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **6a code: PASS. No bug found, and every tested criterion passes.** Before RM commits:
  1. the user restores `neuronforge/node_modules` with `npm ci` (the QA incident above);
  2. `next build` is re-run green on this diff;
  3. the manual browser check (AC-33) is done.

  he / es native review remains the release precondition (D-b).

---

## Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-30 | Created (Dev) | Workplan for slice 6 as SA re-cut it: 6a (dashboard card, route, owner repository, period module, three refresh triggers with the SQ-24 signal at seven named surfaces, FR-36 retirement, Check 5 relabel; ≈ 3.5 d) and 6b (R-7 removal with restored assertions, D-g heading, D-h sentence on the plan screen and invite page, optional OI-10 at its root; ≈ 1.0–1.5 d), each its own PR, 6b after 6a. No migration. 13 open questions for SA |
| 2026-09-30 | SA workplan review — slice 6: APPROVED WITH CONDITIONS | New "SA workplan review — slice 6 (2026-09-30)" under SA Review Notes. Conditions W6-1 to W6-9: register the plan-repository referrer in the RC-15 guard (`ALLOWED` + `NO_STATE_WRITE_REFERRERS`, one wiring file); add S-8 (logo "Generate" in `MediaLibraryPicker`, reachable from the dashboard's configuration dialog); owner charge columns gain `service`, `action_type` for `EffectiveFieldsInput`; numeric parsing never yields 0 on garbage; no reset date without an allowance; trial ceiling is an error; four more card-claim comments and Check 5's "Credits" column relabelled; period / owner repository conformance; exhaustive lifecycle switch in the allowance helper. Q-1 to Q-13 ruled (all TECHNICAL). `my-plan` rule-1 breach: separate chip unless 6b touches the route. No business questions. 6a may start |
| 2026-09-30 | 6a implemented (Dev) — Code Complete, uncommitted | T-a0: W6-1 to W6-9 folded into §4 / §4.10 / §4.11 (marked "(W6-n)"). T-a1 to T-a17 done: `findPeriodAnchor`; `BusinessOsCreditPeriodRepository`; `BusinessOsCreditOwnerReadRepository` (+ sibling header); `creditPeriod`, `creditAllowanceView` (inside the module), `creditBalance`, `creditDisplay`, `ownerCreditUsage` (+ types, + `ownerCreditUsageDeps` on RC-15); route replaced, three Layer 1.1 files retired; `creditUsageSignal` raised at S-1 to S-8; card rewritten; dictionary en / he / es; Check 5 relabelled and four comments reworded; docs. Gates in §4.12 (no new tsc error or test failure; entitlements 2,091 / 2,091). Deviations DV-1 to DV-9 for SA. No migration |
| 2026-09-30 | SA code review — 6a: ✅ CODE APPROVED | New "SA code review — 6a (2026-09-30)" under SA Review Notes. W6-1 to W6-9 verified in code and tests. Tenant isolation, grants, microsecond strings, route contract, FR-28, rounding, the 8 signal sites, no timers, FR-36, entitlements registration, Check 5 relabel and the `buildCardBreakdown` removal all checked. Gates re-run: test:bos-entitlements 100 / 100; the wider run shows only the 4 known baseline reds, all unrelated; typecheck:bos-llm, literals and lint:hooks green. DV-1 to DV-9 accepted (DV-3 is the correct reading of D-b). Two non-blocking chips: L-1 `MediaLibraryPicker` `catch {}` logging, L-2 `ConfigRepository.getSystemConfigs` with no caller. No business questions. Approved for QA |
| 2026-09-30 | QA report — 6a: PASS, no bug; three items owed before RM | New "QA report — 6a (2026-09-30)" under QA Testing Report. Gates: new and touched suites 682 / 683, and entitlements 2,091 / 2,091. The wider run shows only the 4 baseline reds, confirmed pre-existing on `origin/main` `56feb9d2`. typecheck:bos-llm, literals and lint:hooks green. 78 QA probe tests (route, numbers, card in en / he / es, refresh coalescing, no timers) all passed and were deleted. Three Low edge notes (QA-E1 to E3). **Environment incident:** QA's temporary worktree cleanup deleted part of the shared `neuronforge/node_modules`, and QA's `npm ci` repair was denied. Owed before RM: the user runs `npm ci` in the main checkout, `next build` is re-run, and the manual AC-33 browser check is done. No code changed (hash-verified) |
| 2026-10-01 | User decision after local preview — card simplified (Dev, uncommitted) | New §15 (U-1 to U-4): the used / "by you" / "automatic" line under the ring removed (with "Nothing used yet", which was the same element); the D-b sentence removed from the body and shown as a keyboard- and hover-accessible tooltip on the ring (hand-rolled pattern, no new dependency; allowance only, DV-3); payload and route unchanged. Dictionary: four now-unread keys removed in en / he / es. §4.7 bullets struck through. Card tests updated; card + `lib/business-os/credits` 285 / 285, lint:hooks and typecheck:bos-llm green. Needs SA + QA re-look |
