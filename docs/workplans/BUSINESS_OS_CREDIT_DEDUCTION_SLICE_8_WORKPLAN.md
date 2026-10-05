# Workplan: Business OS credit deduction — slice 8, credits as a percentage, one colour-band config, and the admin "Credits left" column (8a); low-line audit record (8b, outline)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §12 "Slice 8 — Credits shown as a percentage, colour bands, and a low-credit audit record" and "Slice 8 scoping (BA, 2026-10-02)", FR-46 to FR-50, AC-40 to AC-46, §13 BD-18 to BD-25 (**all decided**: BD-20 whole %, rounded down, 100% only when nothing used, "less than 1%" below 1, 0% at or over; BD-24 explanation sentence unchanged; BD-25 plan allowance only), §14 SQ-39 to SQ-47 (ruled), KI-21 to KI-25, and **"SA review — slice 8 scoping (2026-10-02)"** (binding; its condition 3 is answered item by item in §4.13)
**Previous slice:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_7_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_7_WORKPLAN.md) (the window function this slice reuses)
**Worktree:** `neuronforge-llm-deduction`
**Branch:** `feature/business-os-credit-deduction-slice-8` (confirmed with `git branch --show-current`; base `origin/main` `9a7c4fb3`). **Fast-forwarded by RM to `origin/main` `5061489b`** (admin cleanup 5a #177, admin header #178, slice 11b #179, #180) before code — R-1 / Q-11 closed (SA C-W2). 8b gets its own branch from RM after 8a merges.
**Date:** 2026-10-03
**Status:** 8a **Code Complete** — awaiting SA code review ∥ QA (uncommitted on the branch; evidence §4.15). SA workplan review ✅ approved with conditions 2026-10-03 (C-W1 to C-W5 folded in §4.0). 8b outline only, not started. *(Previous status, superseded: 8a In Progress.)* **2026-10-04:** 8a merged (PR #189). **8b Planning** — full plan in §5 on `feature/business-os-credit-deduction-slice-8b` (base `origin/main` `89dbc568`), awaiting SA workplan review.

## Overview

Slice 8a changes how an owner reads their credits and gives admins the same figure for every account:

- **The card** shows **"64% left"** instead of "20,640 left of 32,250". The ring's colour comes from one band table (green 60–100, blue 30–59, orange 10–29, red below 10), judged on the **shown** whole percentage, so number and colour never disagree.
- **One band module**, `lib/business-os/credits/creditBands.ts`, imports nothing and is the only place the cut-offs, the colours, the low line and the BD-20 rounding live. A guard proves no other file defines a cut-off.
- **`/admin/users`** gains a **"Credits left"** column with the same percentage and colour per Business OS account, read in one batched, failure-isolated pass inside `GET /api/admin/users` (no per-row call, 2 s budget, "Unknown" on any failure, list still 200).

**No migration.** No change to `business_os_record_credit_charge`, `business_os_credit_charges` or `business_os_credit_totals`. Nothing refused, nothing sent (`shadow`). 8b (the low-line audit record) is outlined in §5 and starts after 8a merges.

## Table of Contents

- [1. Analysis summary](#1-analysis-summary)
- [2. As-built facts this plan rests on (verified)](#2-as-built-facts-this-plan-rests-on-verified)
- [3. Order, PRs and release](#3-order-prs-and-release)
- [4. Part 8a](#4-part-8a)
- [5. Part 8b — the low-line audit record](#5-part-8b--the-low-line-audit-record)
- [6. What owners and admins see](#6-what-owners-and-admins-see)
- [7. Test plan](#7-test-plan)
- [8. Guardrails](#8-guardrails)
- [9. Risks](#9-risks)
- [10. Open questions for SA](#10-open-questions-for-sa)
- [11. Logging, deprecated systems and follow-ups](#11-logging-deprecated-systems-and-follow-ups)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis summary

| Area | Today | After 8a |
|---|---|---|
| Card (`components/business-os/UsageCard.tsx`) | "{left} left of {allowance}" (whole credits, D-c); one accent `#2a78d6`, orange `#F97316` at `share <= LOW_THRESHOLD (0.2)`; `data-low` on the arc; error line in the same orange | "{percent}" + "left", no "of" line; ring colour = band of the shown %; `data-band` on the ring and arc; screen-reader label states the % and the reset; error line keeps its own colour constant (an error is not a band) |
| Band config | — (`LOW_THRESHOLD` in the card) | `lib/business-os/credits/creditBands.ts`: bands as data, colours, `LOW_LINE_PERCENT` derived, BD-20 function in scaled integers, `bandFor` |
| Window rule | Inline in `computeOwnerCreditWindow` (`ownerCreditUsage.ts:246-276`) | Pure rule extracted to `lib/business-os/credits/creditWindowRule.ts`, called by the owner window and the admin batch (and 8b) |
| Admin list route (`app/api/admin/users/route.ts`) | Profiles → one batched business-name read → auth `listUsers` enrichment | + a credits pass for rows that have a business, **in parallel with** `listUsers`, raced against 2 s; each BOS row gets `creditsLeft` |
| Admin page (`app/admin/users/page.tsx`) | Columns Business / user, Contact, Login Activity, Last Sign In, Joined, Actions | + "Credits left" after "Business / user", rendered by a new `CreditsLeftCell` |
| Repositories | `findPeriodAnchor` (one account); ledger read repo has no multi-account totals-in-range read | + `BusinessOsAccountPlanRepository.findPeriodAnchorsBatch(ids)`; + `BusinessOsCreditLedgerReadRepository.listTotalsForAccountsInRange(ids, range, opts)` |
| Dictionary (`lib/business-os/LanguageContext.tsx`) | `usage.of`, `usage.of_total` | − those two; + `usage.less_than_percent`, `usage.sr.monthly`, `usage.sr.trial`, `usage.sr.plain` (en / he / es) |

Tables read (all SELECT, service role, admin route only): `business_os_account_plans` (`user_id, period_anchor`, plus the existing entitlements batch read through `getSnapshots`), `business_os_credit_totals` (`user_id, period_start, credits_total` only — no cost column, not even internally). The owner card reads nothing new. **No table written. No AI call** (`bos-llm-call-standards` not engaged).

Skills applied in planning: `new-repository` (two methods on existing repositories), `business-os-entitlements` (one new non-gate importer), `tenant-isolation-guard` (service-role cross-account read, ids server-derived), `business-os-schema-check` (columns from migrations `20261015` and the plan table, §2), `new-api-route` (extending an existing route: auth first, Zod unchanged, Pino + correlationId, error format).

---

## 2. As-built facts this plan rests on (verified)

Checked in this worktree at `9a7c4fb3` on 2026-10-03, plus `git show origin/main:` where noted.

| # | Fact | Where |
|---|---|---|
| F-1 | The card: `left` = D-c displayed left (whole), `share = min(1, left / allowance)`, `isLow = share <= LOW_THRESHOLD`; arc `data-low`, stroke `LOW` / `ACCENT`; error line uses `LOW`; `ofLine` from `usage.of` / `usage.of_total`; ring 156 × 156 px, headline 29 px bold | `UsageCard.tsx:72-76`, `:209-211`, `:230-232`, `:300`, `:329`, `:344-357`, `:380-399` |
| F-2 | The payload carries `used` (6 dp), `allowance { amount, per }`, `period { kind, resetsOn }` — everything the % needs; no payload change (SQ-40) | `ownerCreditUsageTypes.ts`; `ownerCreditUsage.ts:342-369` |
| F-3 | The window rule: `allowance = anchor === null ? null : allowanceRead`; trial when `allowance?.per === 'total' && anchor !== null` (sum from the anchor); otherwise one period; `figure()` throws `OwnerCreditUsageError('unreadable_figure')` on a non-finite value | `ownerCreditUsage.ts:122-128`, `:246-276` |
| F-4 | `nextPeriodStartUtc(anchor, periodStart)` mirrors the period function for display; `displayInstantMs` is private; the "no `Date` from a key" source guard excludes exactly `nextPeriodStartUtc`, `displayInstantMs`, `displayInstantIso` | `creditPeriod.ts:59-120`; `creditPeriod.test.ts:120-170` |
| F-5 | `getSnapshots(ids)`: read-through, chunks of `BOS_ENTITLEMENT_BATCH_LIMIT = 100`, **sequential** loop, a failed chunk → each id `{ unavailable: true }` (no throw); the snapshot carries no `period_anchor` | `EntitlementService.ts:241-276`; `BusinessOsAccountPlanRepository.ts:159` |
| F-6 | `creditAllowanceForDisplay(snapshot)` → `{ amount, per: 'month' \| 'total' } \| null`; null for `unavailable`, anomaly, no basis or a state that shows none | `creditAllowanceView.ts:36-60` |
| F-7 | `findPeriodAnchor(accountId)` returns the anchor string verbatim; no batched anchor read exists; `findEntitlementInputsBatch` refuses > 100 ids | `BusinessOsAccountPlanRepository.ts:256-321` |
| F-8 | Ledger read repo: service role by default, every account method requires validated UUIDs, `CreditPeriodStartRange` is half-open with `Date`s, `MAX_IDS_PER_REQUEST = 200`, `MAX_PAGE_SIZE = 1000`; `pageTotals` selects `CREDIT_TOTALS_COLUMNS` (includes `cost_usd_total`) | `BusinessOsCreditLedgerReadRepository.ts:106-145`, `:157-300` |
| F-9 | `GET /api/admin/users`: `requireAdmin` first, Zod, ≤ 1,000 profiles, one batched business read (`business: null` none, `undefined` lookup failed), then `listUsers` **sequentially after it**; page renders the first 100 | `route.ts:77-235`; `page.tsx:681` (at `5061489b`, SA C-W2) |
| F-10 | Businesses screen guard: every `SCREEN_FILES` entry may import nothing matching `from '@/lib/business-os`, no `callCatalog`, no repository, no `console.*` | `app/admin/users/__tests__/source.guard.test.ts:19-52` |
| F-11 | `defaultFilter.render.test.tsx:134` pins the **full column-header list** of the Businesses table | that file |
| F-12 | `UsageCard.render.test.tsx` pins `credits-of` (`:115` gauged helper, `:167`, `:223`, `:246`, `:261`, `:291`), `data-low` (`:168`, `:199`) and whole-credit headlines (`:165`, `:186`, `:193`, `:222`, `:238`, `:290`); `UsageCard.historyLink.render.test.tsx:102` waits on `credits-of` | those files |
| F-13 | `creditFigures.fromConfig.guard.test.ts` (in `test:bos-entitlements`) pins `usage.of` as its dictionary non-vacuity anchor (`:228`) and requires `{n}` in `usage.of` / `usage.of_total` (`:236`); its completeness test requires every product file naming `creditAllowanceForDisplay` / `ownerCreditUsage` to be in `SOURCES` | `:81-114`, `:155-160`, `:224-243` |
| F-14 | `ownerCreditSurface.guard.test.ts` rule 3: `creditDisplay.ts` imports nothing; the card imports exactly `creditDisplay` and `ownerCreditUsageTypes` from the credits directory | `:119-146` |
| F-15 | Plan-repository referrers: `ALLOWED` + `NO_STATE_WRITE_REFERRERS`; `ownerCreditUsageDeps.ts` is pinned to `findPeriodAnchor` only (`OWNER_CREDIT_CARD_WIRING` / `_METHOD`) | `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts:63-150`, `:183-193`, `:309-320` |
| F-16 | `KNOWN_NON_GATE_IMPORTERS` is equality-checked on exact symbols; `ownerCreditUsage.ts` registered for `creditAllowanceForDisplay`, `getEntitlementService`, `resolveAccountId` | `enforcementPoints.test.ts:200`, `:363-367`, `:416-447` |
| F-17 | **`origin/main` since base (branch now at `5061489b`, SA C-W2):** #177 (admin cleanup **5a**, already merged) rewrote 335 lines of `app/admin/users/page.tsx` (header list unchanged, `colSpan={6}` at `:655` / `:793`); #179 (slice 11b) touched `lib/business-os/credits/creditAdminOps.ts`, `creditLots.ts`, `BusinessOsCreditLotRepository.ts` — none of this plan's credits files; the requirement MD changed by 5 lines | `git diff --stat 9a7c4fb3 origin/main` |
| F-18 | 0 `console.*` calls in every file this plan touches (one hit in `app/api/admin/users/route.ts:7` is a **comment** describing the earlier conversion, not a call) | §11 |

---

## 3. Order, PRs and release

| Part | PR | Path | Merge rule |
|---|---|---|---|
| 8a | PR 1, this branch | Short workplan → **SA workplan review** → Dev → SA code review ∥ QA → user diff → RM (SA ruling) | Releasable alone. Precondition: BD-24 decided ✅; he / es strings handed to the user for native review at the diff |
| 8b | PR 2, branch RM cuts after 8a merges | Full path: workplan → SA → Dev → SA code review → QA | Never before 8a (imports the band module) |

Standing process: Dev leaves changes uncommitted; nothing is committed before the user has seen the diff.

---

## 4. Part 8a

### 4.0 SA workplan-review conditions (folded 2026-10-03)

| # | Condition / ruling | Folded into |
|---|---|---|
| C-W1 | Cut-off comparison rule scoped to the named consumers, every non-test file in `lib/business-os/credits/` except `creditBands.ts`, and `app/admin/users/**`; a test that the scoped files pass today; planted negative that JSX text like `>10<` does not match; `LOW_THRESHOLD`-nowhere stays repo-wide | §4.3 |
| C-W2 | F-9 → `page.tsx:681`; header and F-17 base → `5061489b` | header, §2 |
| C-W3 | `adminCreditPercent.ts` takes `now` once (period selector and range); no per-account figure logged; a test that a timed-out pass's late results change nothing | §4.8, §4.9 tests |
| C-W4 | The route's timeout test asserts its Pino line carries `creditsPass: 'timeout'` | §4.9 |
| C-W5 | T-12 pastes `npm run test:bos-entitlements`, the creditPeriod Date guard, the screen guard and the surface guard results, plus `git diff --stat` = 0 on the §4.4 owner suites | T-12, §4.15 |
| DV-1 note | `defaultFilter` test **title** ("six columns" → seven) changes with its list | §4.10 |
| Q-1 to Q-6, Q-10 | All accepted as proposed (exact-share arc; red track at 0%; ink headline; `unavailable` → Unknown; 92-day trial anchor → Unknown, excluded from AC-43's equality; 25 calls / ≈15 critical path; overflow → null) | §4.2, §4.5, §4.8 |
| R-8 | Error line: constant renamed `ERROR_INK`, colour unchanged; contrast stays a follow-up | §4.5, §11 |

### 4.1 Approach

```text
Owner                                              Admin
UsageCard (client)                                 /admin/users page (client)
  payload: used, allowance, period (unchanged)       └─ CreditsLeftCell ── imports creditBands (exact-path exception)
  └─ creditPercentLeft(used, allowance) ─┐                   ▲ row.creditsLeft { kind, value?, trial? }
                                          │          GET /api/admin/users  (requireAdmin first — unchanged)
                     lib/business-os/credits/creditBands.ts      ├─ profiles → business identities (unchanged)
                     (imports NOTHING; bands, colours,           └─ Promise.all([ credits pass ≤ 2 s, listUsers ])
                      LOW_LINE_PERCENT, BD-20, bandFor)                │
                                          ▲                  lib/business-os/credits/adminCreditPercent.ts (server-only)
                                          └──────────────────── ├─ resolveAccountId(userId) per row
                                                                ├─ getSnapshots(ids)  ∥  findPeriodAnchorsBatch(ids)   (per 100)
                                                                ├─ creditWindowRule  (shared with the owner window)
                                                                ├─ listTotalsForAccountsInRange(ids, range)            (per 200)
                                                                └─ isCurrentPeriodRow / trial sum → creditPercentLeft
```

### 4.2 The band module (SQ-39; SA condition 3)

New **`lib/business-os/credits/creditBands.ts`** — pure, **imports nothing** (no `import` statement at all, pinned like `creditDisplay.ts`), client-safe, not in the entitlements module, not operator-editable.

```typescript
export type CreditBandId = 'plenty' | 'comfortable' | 'low' | 'below_line';

/** Lower bounds on the SHOWN whole percentage, highest first. The only cut-offs in the codebase. */
export const CREDIT_BANDS = [
  { id: 'plenty',      from: 60, color: '#059669' }, // green  — 3.8:1 on #FFFFFF, 3.9:1 on #1E293B (SA)
  { id: 'comfortable', from: 30, color: '#2a78d6' }, // blue   — today's accent
  { id: 'low',         from: 10, color: '#EA580C' }, // orange
  { id: 'below_line',  from: 0,  color: '#EF4444' }, // red
] as const;

/** The top of the red band — derived, never a second literal. */
export const LOW_LINE_PERCENT: number = /* CREDIT_BANDS[index of 'below_line' − 1].from */;

export type ShownPercentLeft = { kind: 'percent'; value: number } | { kind: 'less_than_one' };

export interface CreditPercentLeft {
  shown: ShownPercentLeft;
  band: CreditBandId;
  /** Exact share left, 0..1, for the ring's arc only. Never shown as text. */
  share: number;
}

/** BD-20 in scaled integers. Null when there is no usable allowance. */
export function creditPercentLeft(used: number, allowance: number | null): CreditPercentLeft | null;
export function bandFor(shown: ShownPercentLeft): CreditBandId;
export function bandColor(band: CreditBandId): string;
```

**Arithmetic (SA SQ-39), integers only:**

1. `allowance` null, non-finite or ≤ 0, or `used` non-finite → `null` (no gauge; the caller shows "no allowance").
2. `usedMicro = Math.round(max(0, used) × 10⁶)`, `allowanceMicro = Math.round(allowance × 10⁶)`, `leftMicro = allowanceMicro − usedMicro` (see DV-2: equal to SA's `round((allowance − used) × 10⁶)` for 6-dp inputs, without a float subtraction).
3. `allowanceMicro × 100` must be `Number.isSafeInteger` (true up to ≈ 9 × 10⁷ credits; today's largest is 32,250) — else `null` and the caller treats it as unreadable (Q-10).
4. `usedMicro === 0` → **100** (only when nothing was used). `leftMicro ≤ 0` → **0**. Otherwise `percent = Math.floor(leftMicro × 100 / allowanceMicro)`; `percent === 0` → `{ kind: 'less_than_one' }`. An exact 10.000000% is `10` → orange.
5. `band = bandFor(shown)`: `less_than_one` → `below_line`; otherwise the first band with `value >= from`.
6. `share = max(0, leftMicro) / allowanceMicro` (exact; the arc only).

**Tests** (`__tests__/creditBands.test.ts`): boundaries 100 (nothing used) / 99 (0.2 used of 32,250) / 60 / 59 / 30 / 29 / 10 / 9 / exact 10.000000% (`used = 0.9 × allowance` on 32,250 and on 2,000) / 64.9 → 64 / 9.6 → 9 / 0.4 → `less_than_one` / exactly at the allowance → 0 / over → 0 / negative `used` → 100; each with its band; `LOW_LINE_PERCENT === 10` and derived (a test re-orders a copy of the table and shows the derivation follows it); the four colours; null cases (null / 0 / NaN allowance, NaN used, unsafe allowance); a sweep over 0..allowance in 0.000001-credit steps near each boundary showing number and band never disagree.

### 4.3 The cut-off guard (SA condition 3, AC-41)

New **`lib/business-os/credits/__tests__/creditBands.guard.test.ts`** (planted violations proved first, as the repo's guards do):

| Rule | Scope | Planted first |
|---|---|---|
| `creditBands.ts` has no `import` / `require` | that file | `import x from 'y'` matched |
| Each consumer **imports** `@/lib/business-os/credits/creditBands` | `UsageCard.tsx`, `app/admin/users/components/CreditsLeftCell.tsx`, `lib/business-os/credits/adminCreditPercent.ts` (8b adds `creditLowLine.ts`) | — |
| Comment-stripped code holds no `LOW_THRESHOLD` / `LOW_LINE` definition and no comparison against `60`, `30`, `10`, `20`, `0.6`, `0.3`, `0.1`, `0.2` (either side of `<`, `<=`, `>`, `>=`) | **(SA C-W1)** the named consumers (`UsageCard.tsx`, `CreditsLeftCell.tsx`, `adminCreditPercent.ts`; 8b adds `creditLowLine.ts`), every non-test file in `lib/business-os/credits/` except `creditBands.ts`, and every non-test file under `app/admin/users/`. A test proves the scoped files pass on the current tree | `share <= 0.2`, `pct >= 60`, `10 > p`, `const LOW_THRESHOLD = …` all matched; `marginTop: 10`, `width: 156` and JSX text `>10<` not matched |
| `LOW_THRESHOLD` exists nowhere in product code | repo `app/ components/ lib/` | — |

`ownerCreditSurface.guard.test.ts` rule 3 changes **deliberately** (SQ-40): `creditBands.ts` joins the "imports nothing" pins, and the card's credits-directory import list becomes `['creditBands', 'creditDisplay', 'ownerCreditUsageTypes']`.

### 4.4 The window rule extraction (SQ-41)

New **`lib/business-os/credits/creditWindowRule.ts`** — pure, type-only import of `OwnerCreditAllowance` from `ownerCreditUsageTypes.ts`; never names `creditAllowanceForDisplay` or `ownerCreditUsage` (so it does not join the `creditFigures` completeness list):

```typescript
export type CreditWindowMode = 'trial_total' | 'period';
/** No plan row ⇒ no allowance; a one-off allowance with an anchor ⇒ summed from the anchor; else the one period. */
export function creditWindowRule(input: { anchor: string | null; allowance: OwnerCreditAllowance | null }):
  { allowance: OwnerCreditAllowance | null; mode: CreditWindowMode };
/** A ledger numeric as a number; null when it does not parse to a finite number (never 0). */
export function parseLedgerFigure(value: number | string | null | undefined): number | null;
```

`computeOwnerCreditWindow` calls `creditWindowRule` in place of `:247` and `:253`, and `figure()` becomes `parseLedgerFigure` + the same throw. **Behaviour unchanged**: same calls, same order, same errors, same logs. `ownerCreditUsage.test.ts`, `.crossCheck`, `.payload`, `ownerCreditHistory.test.ts` and `app/api/business-os/usage/__tests__/route.credits.test.ts` pass **unedited** (T-13 records `git diff --stat` = 0 on them). `readCreditPosition` stays 11c's (S11-SQ-9) and will call the same rule.

New `__tests__/creditWindowRule.test.ts`: no anchor + any allowance → `{ null, 'period' }`; anchor + `per: 'total'` → `trial_total`; anchor + `per: 'month'` → `period`; anchor + null → `period` with null; `parseLedgerFigure` on `'12.5'`, `12.5`, `''`, `'abc'`, `null`, `NaN`, `Infinity`.

### 4.5 The card (SQ-40, SQ-47; C-S8-7)

**`components/business-os/UsageCard.tsx`:**

- `LOW_THRESHOLD`, `LOW`, `isLow`, `ofLine` removed. `ACCENT` stays for the no-allowance frame ring only. The error line uses a renamed local constant `ERROR_INK = '#F97316'` (SA: an error is not a band; unchanged colour).
- `const position = gauged ? creditPercentLeft(usage.used, allowance.amount) : null` — the **exact** `used` (not D-c's displayed used). `toDisplayedCredits` stays for the no-allowance "used" figure.
- Headline: `formatPercent(value)` = `new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)`; `less_than_one` → `t('usage.less_than_percent', { percent: formatPercent(1) })` at a smaller size (15 px, wraps within the ring; SQ-47). Label under it stays `usage.left`. No "of" line.
- Arc: drawn when `position.share > 0`, `strokeDashoffset = C × (1 − share)`, stroke `bandColor(position.band)`, `data-band={position.band}`. At **0%** no arc; the track is drawn in the red band colour (Q-2). The ring container carries `data-band` in every gauged state, so 0% is testable without an arc.
- Headline text stays `INK` (Q-3) — colour is the ring's, the number is always written (AC-42).
- `aria-label` (gauged): `usage.sr.trial` for a trial; `usage.sr.monthly` with the reset date when `resetsOn` parses; `usage.sr.plain` otherwise — each `{ percent }` (the formatted % or the "less than 1%" string). No colour name. Ungauged label unchanged.
- No-allowance state, loading, error, tooltip (D-b, BD-24), refresh, history link: **unchanged**.
- Header comment updated ("WHAT IT SHOWS").

**Dictionary** (`LanguageContext.tsx`, en / he / es, he / es for native review):

| Key | en | he | es |
|---|---|---|---|
| `usage.less_than_percent` | `less than {percent}` | `פחות מ־{percent}` | `menos del {percent}` |
| `usage.sr.monthly` | `{percent} of your credits left, resets {date}` | `נותרו {percent} מהקרדיטים שלך, מתאפס ב־{date}` | `Te queda el {percent} de tus créditos; se renueva el {date}` |
| `usage.sr.trial` | `{percent} of your credits left for your trial` | `נותרו {percent} מהקרדיטים שלך לתקופת הניסיון` | `Te queda el {percent} de tus créditos de tu prueba` |
| `usage.sr.plain` | `{percent} of your credits left` | `נותרו {percent} מהקרדיטים שלך` | `Te queda el {percent} de tus créditos` |
| `usage.of`, `usage.of_total` | **removed** (no other reader — repo grep: only `UsageCard.tsx:232` and the guard in F-13) | removed | removed |

`{percent}` is always the formatter's output, so es gets "64 %" / "menos del 1 %" from `Intl`, never a typed space.

**Tests changed deliberately (C-S8-7 and what the headline change forces — see DV-1):**

| File | Lines | Change |
|---|---|---|
| `UsageCard.render.test.tsx` | `:115` | "gauged" helper keys off `credits-ring[data-band]` instead of `credits-of` |
| | `:158-170` | Founding Partner: headline "99%" (or the fixture's %), no `credits-of`, `data-band="plenty"` |
| | `:186`, `:193` | nothing used → "100%"; less than one used → "99%" |
| | `:197-200` | "near the allowance: orange" → band tests at 59 / 29 / 9 (blue / orange / red) and no warning text |
| | `:205` | over → "0%", `data-band="below_line"`, no arc |
| | `:222-223`, `:238` | trial → "%" against 2,000, "For your trial", no "of … in total" |
| | `:246`, `:261` | unchanged meaning (`credits-of` absent stays true) — kept as is |
| | `:290-291` | locale test: `formatPercent` per language, no `usage.of` |
| `UsageCard.historyLink.render.test.tsx` | `:102` | `findByTestId('credits-of')` → `findByTestId('credits-arc')` |

New `UsageCard.percent.render.test.tsx`: every §6 state × en / he / es (incl. "less than 1%" with the smaller size class, "0%" red track, trial, no allowance unchanged, error never "0%" / "100%"); `aria-label` per variant; greyscale readability = the text alone carries the state (no colour word asserted absent); the FR-36 banned words absent.

### 4.6 The repository methods (SQ-42; `new-repository` skill)

**`BusinessOsAccountPlanRepository.findPeriodAnchorsBatch(accountIds: string[]): Promise<RepositoryResult<Record<string, string>>>`**

- Refuses (error, no query) an empty list, > `BOS_ENTITLEMENT_BATCH_LIMIT` (100) ids, or any id that is not a UUID.
- `.from('business_os_account_plans').select('user_id, period_anchor').in('user_id', ids)` — `.in('user_id', …)` is the multi-account form of rule 4 (documented in the method comment).
- Anchors returned **verbatim** (microsecond strings, never through `Date`); a row with a non-string anchor → error (as `findPeriodAnchor`). A missing key = no plan row. Never throws.
- Tests: happy path (two rows, one missing), the select string is exactly `'user_id, period_anchor'`, `.in` with the ids, refusals (0, 101, a non-UUID) send no query, DB error → `{ data: null, error }`, anchor string untouched.

**`BusinessOsCreditLedgerReadRepository.listTotalsForAccountsInRange(userIds: readonly string[], range: CreditPeriodStartRange, opts: CreditLedgerPageOptions): Promise<RepositoryResult<CreditLedgerPagedResult<CreditTotalsPositionRow>>>`**

- New exported constant `CREDIT_TOTALS_POSITION_COLUMNS = 'user_id, period_start, credits_total'` and row type `CreditTotalsPositionRow` — **no cost column**.
- `assertAccounts(userIds)` (non-empty, every UUID), at most `MAX_IDS_PER_REQUEST` (200) ids per call (refused above — the caller chunks), `assertRange`, `assertPaging`.
- `.select(CREDIT_TOTALS_POSITION_COLUMNS).in('user_id', ids).gte('period_start', from).lt('period_start', to)`, ordered `period_start desc, user_id asc`, paged, de-duplicated by `(user_id, period_start)`, `reachedCeiling` as `pageTotals`. Implemented as its own small pager (the existing `pageTotals` keeps its column list byte-for-byte).
- No filter or grouping on `service` (the `serviceColumn.guard` scan covers it).
- Header comment: the new caller (`adminCreditPercent.ts`, reached only from `GET /api/admin/users` after `requireAdmin`) and why service role (admin cross-account display; the owner RLS client cannot read other accounts).
- Tests: columns exactly the constant (and contain no `cost`), `.in` with the ids, half-open range strings, refusals (0 ids, 201 ids, a non-UUID, bad range, bad paging) send no query, paging + ceiling, de-duplication, DB error, the existing "no write verb / no `.rpc(`" source test covers it.

### 4.7 Display helpers in `creditPeriod.ts` (SQ-42)

Three new exports, all **display maths** (through `displayInstantMs`), used only as selectors among rows already read, never as a filter key:

- `isCurrentPeriodRow(anchor, periodStart, now: Date): boolean` — `parse(periodStart) ≤ now < parse(nextPeriodStartUtc(anchor, periodStart))`; false when either string does not parse.
- `isAtOrAfter(periodStart, anchor): boolean` — the trial sum's row selector (`parse(periodStart) ≥ parse(anchor)`). Safe at millisecond precision: a trial's first period key **equals** its anchor and later keys are months apart.
- `utcDayFloor(iso): Date | null` — the range floor for a trial anchor (a whole-day bound no truncation can move, the ledger repo's CR-B1 rule).

The "no `Date` from a key" guard (`creditPeriod.test.ts`) changes **deliberately**: its display-maths exclusion gains these three functions only; its non-vacuity test proves each is really removed; its `it.each` gains `adminCreditPercent.ts` (which builds no `Date` from a key itself). Unit tests for each helper, incl. an anchor on the 31st and a month boundary.

### 4.8 The admin helper (SQ-41, SQ-42, SQ-43)

New **`lib/business-os/credits/adminCreditPercent.ts`** (`import 'server-only'`):

```typescript
export const ADMIN_CREDITS_BUDGET_MS = 2_000;
export type AdminCreditsLeft =
  | { kind: 'percent'; value: number; trial: boolean }
  | { kind: 'less_than_one'; trial: boolean }
  | { kind: 'no_allowance' }
  | { kind: 'unknown' };
export interface AdminCreditsPass { outcome: 'ok' | 'failed' | 'timeout'; byUserId: Map<string, AdminCreditsLeft> }
export async function readAdminCreditsLeft(userIds: string[], deps: AdminCreditPercentDeps, log, now = new Date()): Promise<AdminCreditsPass>;
```

Never throws. Steps:

0. **One `now`** (SA C-W3): taken once by the caller or defaulted once, and used for both the current-period selector and the range.
1. `ids` = de-duplicated `resolveAccountId(userId)` for the rows that **have a business** (server-derived from the profile list — never caller input). Empty → `{ ok, empty map }`, zero reads.
2. In parallel: `getEntitlementService().getSnapshots(ids)` (one read per 100, read-through) and `findPeriodAnchorsBatch` per 100-id chunk (chunks sequential, so at most two requests in flight).
3. Per account: snapshot `unavailable` → **`unknown`** (a failed read is not "no allowance", Q-4); `allowance = creditAllowanceForDisplay(snapshot)`; then `creditWindowRule({ anchor, allowance })` → `allowance` null → **`no_allowance`**.
4. For the accounts that still have an allowance: range `from = utcDayFloor(min(now − 32 d, earliest trial anchor))`, `to` = next UTC midnight after `now` (exclusive); `listTotalsForAccountsInRange` per 200-id chunk (pageSize 1,000, ceiling 5,000 per chunk). `reachedCeiling` on any chunk → the whole pass `failed` (never a partial sum). A trial anchor older than 92 days → that row `unknown` and left out of the floor (Q-5).
5. `used`: monthly → the row with `isCurrentPeriodRow(anchor, period_start, now)` (none → 0); trial → the sum of rows with `isAtOrAfter(period_start, anchor)`; each figure through `parseLedgerFigure` (an unparseable figure → that row `unknown`), summed and rounded with `roundToLedger`.
6. `creditPercentLeft(used, allowance.amount)` → `percent` / `less_than_one` with `trial: mode === 'trial_total'`; `null` (unsafe allowance) → `unknown`.
7. The whole of 1–6 is raced against `ADMIN_CREDITS_BUDGET_MS` (timer `unref`'d and cleared in `finally`); on timeout or any thrown / returned error from the anchor or totals reads → `outcome: 'timeout' | 'failed'`, **every** id `unknown`, one `warn` (`{ outcome, accounts, ms }`, `err` when there is one). Late results of a timed-out pass are ignored (all reads return `{ data, error }`, so nothing rejects unhandled).
8. One `info` line on success: counts by kind and `ms` — never a figure per account.

**Call count** (pinned by test): for n accounts with plans and allowances, `getSnapshots` chunks `⌈n/100⌉` + anchor reads `⌈n/100⌉` + totals reads `⌈n/200⌉`: **1 / 1 / 1** at 1 and 100 accounts, **2 / 2 / 1** at 101. At 1,000: 25 calls, critical path ≈ 15 sequential round trips (Q-6).

**Scale trigger (recorded):** above 1,000 Business OS accounts, or a pass p95 above 1 s in the `info` line, move the figure to a separate visible-rows admin route (≤ 100 ids), as the BA's fallback.

**Deps:** new **`lib/business-os/credits/adminCreditPercentDeps.ts`** (`server-only`): `findPeriodAnchorsBatch` from the `businessOsAccountPlanRepository` singleton (service role) and `listTotalsForAccountsInRange` from the `businessOsCreditLedgerReadRepository` singleton (service role), with the documented RLS-bypass reason (admin cross-account display behind `requireAdmin`; ids from the server's own profile list). `getSnapshots` is reached through `getEntitlementService()` in the helper (registered, §4.11), injectable for tests.

### 4.9 The route (SQ-42; `new-api-route` rules on an existing route)

**`app/api/admin/users/route.ts`:**

- `requireAdmin` stays the first statement; Zod schema unchanged; no new query parameter.
- After the business lookup: when `businessLookup === 'ok'`, `const [credits, auth] = await Promise.all([readAdminCreditsLeft(idsWithBusiness, adminCreditPercentDeps(), requestLogger), authEnrichment()])` — `listUsers` keeps its own try / warn, moved into a small local function so it runs **in parallel** with the credits pass. When the business lookup failed: no credits pass (`creditsPass: 'skipped'`).
- Each row: `creditsLeft` **only** when `business` is non-null — the pass's value, or `{ kind: 'unknown' }`. Rows with `business: null` or `undefined` carry **no** `creditsLeft` key.
- The served log line gains `creditsPass` (`ok | failed | timeout | skipped`) and `creditsMs`. No figure is logged.
- The route imports nothing from `lib/business-os/entitlements/` (stays off the registry).
- No new handler → no authz-guard census or cap change.

**Tests** — new `app/api/admin/users/__tests__/route.creditsLeft.test.ts` (the helper mocked at the module boundary, plus one integration case with the real helper and mocked repositories):

| Case | Pass criterion |
|---|---|
| Happy path | 200; BOS rows carry `creditsLeft` (`percent`, `less_than_one`, `no_allowance`, trial flag); non-BOS rows have no `creditsLeft` key |
| 401 / 403 | Unchanged (existing `requireAdmin` mocks); credits helper never called |
| Pass fails | 200, every BOS row `{ kind: 'unknown' }`, list otherwise identical |
| Pass times out (fake timers, helper hangs) | 200 after ≈ 2 s, every BOS row `unknown`, no timer left; the route's Pino line carries `creditsPass: 'timeout'` (SA C-W4) |
| Parallel | `listUsers` is called before the credits pass resolves |
| Business lookup failed | No credits pass; no `creditsLeft` anywhere |
| Call count (real helper, mocked repos) | 1 / 100 / 101 accounts → 1·1·1 / 1·1·1 / 2·2·1 |
| Payload allow-list | Exact key set of every `creditsLeft` value ⊆ `{kind, value, trial}`; a recursive scan of the response finds no `credits_total`, `used`, `allowance`, `amount`, `cost`, `token`, `usd`, `dollar` key |

The two existing suites that import the route (`route.test.ts`, `searchInjection.qa.test.ts`) gain **one module-level `jest.mock('@/lib/business-os/credits/adminCreditPercent', …)` line each** (setup only; no assertion edited) so they do not load the entitlements service (DV-1, Q-7).

Helper unit tests (`__tests__/adminCreditPercent.test.ts`): every kind; a monthly account with two rows in range (only the current one counts); an anchor on the 31st; a trial summed from the anchor; no plan row with an allowance in a stale snapshot → `no_allowance`; snapshot unavailable → `unknown`; unparseable figure → that row only `unknown`; ceiling → all `unknown`; a timed-out pass whose reads resolve afterwards changes nothing in the returned map (SA C-W3); old trial anchor → that row `unknown`, floor unaffected; budget; empty input → zero reads; **cross-check**: for the same fixture, the helper's % equals `creditPercentLeft(readOwnerCreditUsage(...).used, allowance)` (the card's figure).

### 4.10 The admin column (FR-48, C-S8-1)

- New **`app/admin/users/components/CreditsLeftCell.tsx`** (client): props `{ business: RowBusiness | null | undefined; creditsLeft?: RowCreditsLeft }`. Renders: `business === null` → "—"; `business === undefined` → "Unknown" (muted); `unknown` → "Unknown" (muted); `no_allowance` → "No allowance" (muted); `percent` / `less_than_one` → a small dot in `bandColor(bandFor(shown))` + the text (`Intl.NumberFormat('en', percent)`, "less than 1%") + a small "trial" marker when `trial`. Imports `bandFor`, `bandColor` from `@/lib/business-os/credits/creditBands` — **the only `lib/business-os` import on the screen**. English only, like the rest of `/admin`. Not sortable or filterable.
- **`app/admin/users/types.ts`**: `RowCreditsLeft` declared structurally (no import), mirroring `AdminCreditsLeft`.
- **`app/admin/users/page.tsx`**: `User.creditsLeft?: RowCreditsLeft`; one `<th>Credits left</th>` after "Business / user"; one `<td><CreditsLeftCell … /></td>`; both `colSpan={6}` → `7`. Nothing else.
- **`source.guard.test.ts`** (C-S8-1): `SCREEN_FILES` gains `CreditsLeftCell.tsx`; the "imports nothing from lib/business-os" rule allows **exactly** `'@/lib/business-os/credits/creditBands'` (an exact-string allow, not a prefix), and only in `CreditsLeftCell.tsx` (DV-4) — planted samples first: `…/credits/creditBandsX`, `…/credits/creditDisplay`, `…/credits/creditBands/index`, `@/lib/business-os/entitlements/…` are still rejected; a positive pin that `CreditsLeftCell.tsx` is the one file that imports it.
- **`defaultFilter.render.test.tsx:134`**: the header list gains "Credits left", and the test title's "six" becomes "seven" (DV-1, SA note).
- New `creditsLeftCell.render.test.tsx`: each state; the dot's colour equals `bandColor` for 64 / 59 / 29 / 9 / less than 1 / 0; the text is always present (colour never alone); "trial" marker; no credit count, token or dollar text.

### 4.11 Registrations (SQ-43; `business-os-entitlements` skill)

| Registry | Change |
|---|---|
| `enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS` | + `{ file: 'lib/business-os/credits/adminCreditPercent.ts', symbols: ['creditAllowanceForDisplay', 'getEntitlementService', 'resolveAccountId'], why: 'Credit deduction slice 8a: the admin Businesses list shows each account's percentage of credits left, for DISPLAY only. It maps rows through the account seam, reads getSnapshots (never check() / decide()) and turns each snapshot into a figure with creditAllowanceForDisplay. It refuses nothing; if it ever calls check, it is a gate and belongs in ENFORCEMENT_POINTS.' }` |
| `businessOsEntitlements.imports.guard.test.ts` | `adminCreditPercentDeps.ts` added to `ALLOWED` (with its reason) **and** `NO_STATE_WRITE_REFERRERS`; a method pin like 6a's: it calls `findPeriodAnchorsBatch` on the plan repository and nothing else (planted sample first) |
| `creditFigures.fromConfig.guard.test.ts` | `SOURCES` + `lib/business-os/credits/adminCreditPercent.ts` (names `creditAllowanceForDisplay`; required by the completeness test) and `app/admin/users/components/CreditsLeftCell.tsx`; **the dictionary non-vacuity anchor moves from `usage.of` to `usage.sr.monthly`** and the template test checks `{percent}` in the four new `usage.*` keys instead of `{n}` in the two removed ones (DV-1, Q-8) |
| Authz guard census / caps | Unchanged (no new handler) |

`npm run test:bos-entitlements` on the final diff, result pasted in §4.14.

### 4.12 Docs

- `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md` — where it describes the owner card: percentage left, the band table (one line pointing at `creditBands.ts`), BD-20; Change History row.
- `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` — Metering: one line on the admin percentage (`adminCreditPercent.ts`, registered non-gate importer, display only); Change History row.
- Not edited by Dev (BA's): the requirement's delivery status, AC ticks, KI rows.

### 4.13 SA condition 3 — where each item is answered

| Condition item | Answered in |
|---|---|
| `creditBands.ts` imports nothing, scaled-integer arithmetic, the four colours | §4.2 |
| Boundary tests 60 / 59 / 30 / 29 / 10 / 9 / < 1 / 0 / exact 10.000000% | §4.2 tests |
| Cut-off guard with planted violations | §4.3 |
| Card import pin changed deliberately; admin screen exception, exact path only | §4.3 (rule 3), §4.10 |
| 6a / 7a card tests in C-S8-7 changed deliberately, every other test unedited | §4.5 table; DV-1 lists the extra edits the headline change forces |
| Pure window extraction; `readOwnerCreditUsage` / `resolveOwnerCreditWindow` tests green unedited | §4.4 |
| Admin helper + deps; both repository methods per `new-repository` | §4.6, §4.8 |
| Entitlements and plan-repository registrations | §4.11 |
| Route tests: happy, 401 / 403, failure and timeout → 200 + `unknown`, non-BOS absent, 1 / 100 / 101 call count, no count / cost / token key | §4.9 |
| `npm run test:bos-entitlements` green | §4.11, T-12 |
| SQ-47: Intl percent, one "less than" key with formatted 1%, SR keys, `usage.of` / `of_total` removed, 156 px fit | §4.5; fit checked by QA visually (jsdom cannot measure) |

### 4.13a Deviations from SA rulings (for SA to accept or refuse)

| # | Ruling | Deviation | Why |
|---|---|---|---|
| DV-1 | C-S8-7: change the card tests that pin `credits-of` / `data-low` "and nothing else" | Also edits: the whole-credit headline assertions and the gauged helper in `UsageCard.render.test.tsx` (§4.5 table); `defaultFilter.render.test.tsx:134` (header list); the `creditFigures` guard's `usage.of` anchor and template check (F-13); one setup `jest.mock` line in each of the two existing admin users route suites | Each is forced by a ruled change (headline becomes %, a new column, SQ-47's key removal, the route's new import); no assertion is weakened (Q-7 to Q-9) |
| DV-2 | SQ-39: `leftMicro = round((allowance − used) × 10⁶)` | `leftMicro = round(allowance × 10⁶) − round(used × 10⁶)` | Same result for 6-dp inputs; avoids a float subtraction before scaling |
| DV-3 | SQ-42: add `isCurrentPeriodRow` beside `nextPeriodStartUtc` and update the Date guard | Also `isAtOrAfter` (trial row selector) and `utcDayFloor` (range floor); the guard exclusion grows by three | Keeps every key-to-`Date` step inside `creditPeriod.ts`'s guarded display maths instead of in the helper |
| DV-4 | C-S8-1: exception for the page | The import lives in a new `CreditsLeftCell.tsx`; the exact-path exception is pinned to that file | Narrower than allowing it in every screen file; keeps the `page.tsx` edit minimal for the rebase (R-1) |

### 4.14 Task list — 8a

| # | Task | Estimate |
|---|---|---|
| ✅ **T-0** | Branch up to date with `origin/main` (Q-11, done by RM before code); baselines: `npx tsc --noEmit` error list, `npm test -- lib/business-os components/business-os app/admin/users app/api/admin/users lib/repositories` red list, `npm run test:bos-entitlements` | 0.05 d |
| ✅ **T-1** | `creditBands.ts` + `creditBands.test.ts` (§4.2) | 0.15 d |
| ✅ **T-2** | Cut-off guard + surface-guard rule 3 changes, planted first (§4.3) | 0.1 d |
| ✅ **T-3** | `creditWindowRule.ts` extraction + tests; owner suites unedited (§4.4) | 0.15 d |
| ✅ **T-4** | Card + dictionary keys (en / he / es) + the listed test edits + `UsageCard.percent.render.test.tsx` (§4.5) | 0.4 d |
| ✅ **T-5** | `findPeriodAnchorsBatch` + `listTotalsForAccountsInRange` + tests (§4.6) | 0.3 d |
| ✅ **T-6** | `creditPeriod.ts` display helpers + Date-guard update + tests (§4.7) | 0.1 d |
| ✅ **T-7** | `adminCreditPercent.ts` + deps + unit tests incl. budget, call count, owner cross-check (§4.8) | 0.3 d |
| ✅ **T-8** | Route wiring + `route.creditsLeft.test.ts` + the two setup mock lines (§4.9) | 0.2 d |
| ✅ **T-9** | `CreditsLeftCell` + page column + `types.ts` + screen guard exception + header-list edit + render test (§4.10) | 0.2 d |
| ✅ **T-10** | Registrations (§4.11) | 0.1 d |
| ✅ **T-11** | Docs (§4.12) | 0.05 d |
| ✅ **T-12** | Gates (§7) with results pasted — incl. (SA C-W5) `test:bos-entitlements`, the creditPeriod Date guard, the screen guard, the surface guard; `git diff --stat` (no deletion without insertion; 0 lines on the §4.4 owner suites) | 0.1 d |
| ⬜ **T-13** | Handover uncommitted: SA code review ∥ QA → user diff (with the he / es list) → RM | — |
| | **Total 8a** | **≈ 2.2 d** |

About 0.1 d above SA's 1.75–2.1 d, **under 2.5 d**. The extra is the test edits SA's list did not name (DV-1: headline assertions, the header list, the `creditFigures` anchor, two setup mock lines) and the two display helpers beyond `isCurrentPeriodRow`. T-4 and T-7 are the likeliest to run long; if the total passes 2.5 d, Dev stops and returns to SA rather than trimming tests.

---

### 4.15 8a implementation evidence (Dev, 2026-10-03)

Uncommitted on `feature/business-os-credit-deduction-slice-8` at `5061489b`. No migration, no database read or write, no dev server. Jest run with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. **`next build` not run by Dev: owed, arranged by the coordinator.**

**Gates (SA C-W5 and §7)**

| Gate | Result |
|---|---|
| `npm run test:bos-entitlements` | ✅ 105 / 105 suites, 2,407 / 2,407 tests (baseline at T-0: 105 / 2,384) |
| creditPeriod Date guard (`creditPeriod.test.ts`) | ✅ 33 / 33 (exclusion grows by exactly `isCurrentPeriodRow`, `isAtOrAfter`, `utcDayFloor`, each proved removed; `adminCreditPercent.ts` added to the scan) |
| Screen guard (`app/admin/users/__tests__/source.guard.test.ts`) | ✅ 18 / 18 (exact-path exception pinned to `CreditsLeftCell.tsx`, planted samples first) |
| Surface guard (`ownerCreditSurface.guard.test.ts`) | ✅ 48 / 48 (`creditBands.ts` imports nothing; card import list `creditBands`, `creditDisplay`, `ownerCreditUsageTypes`) |
| Cut-off guard (`creditBands.guard.test.ts`, C-W1) | ✅ 52 / 52 — 29 scoped files pass on the current tree; planted negatives incl. JSX `>10<` and `=> 10` |
| Owner suites unedited (§4.4) | ✅ `git diff --numstat` on `ownerCreditUsage.test.ts`, `.crossCheck`, `.payload`, `ownerCreditHistory.test.ts`, `app/api/business-os/usage/__tests__/route.credits.test.ts` = **0 lines**; 5 / 5 suites, 96 / 96 tests green |
| Touched / new suites | ✅ credits dir + the two repository suites 26 / 26 suites, 639 tests; card suites 3 / 3, 105 tests; `app/admin/users` + cut-off guard 131 tests; admin users route 3 / 3 suites, 59 tests |
| Wider Jest (`lib/business-os components/business-os app/admin app/api/admin app/api/business-os lib/repositories lib/audit`) | 400 / 404 suites, 8,223 / 8,226 tests. The 4 red suites — `proposals-capability`, `tokenUsageRepository.contract`, `callParams.boundary.step3`, `chat-v4/route.audit` (a worker crash) — import none of the files this slice touches; they match the known baseline reds (the tokenUsage contract pin is red on main) |
| `npx tsc --noEmit` (6 GB heap) | 2,091 errors before and after; in touched files only the 24 pre-existing duplicate-key errors in `LanguageContext.tsx` — **no new error** |
| `npx eslint` on the 33 changed / new code and test files | 0 errors; 15 warnings, all pre-existing (`page.tsx` unused icons / `any` / exhaustive-deps; the plan-repository test's `any` stub) |
| `npm run lint:hooks` | ✅ clean (`--max-warnings 0`) |
| `next build` | ⬜ **owed** (not run by Dev, per the coordinator) |

**Deviations found while building (for SA code review)**

| # | What | Why |
|---|---|---|
| DV-1 (addendum) | Three more forced test edits of the DV-1 kind: `UsageCard.render.test.tsx` refresh test's whole-credit headline (`n(32187)` → `pct(99)`, missed in F-12) and the now-unused `n` helper removed; `defaultFilter.render.test.tsx` "empty state spans all six columns" (`colspan` 6 → 7, title "seven") — the colSpan change §4.10 already names | Forced by the % headline and the new column; no assertion weakened |
| DV-5 | `BusinessOsCreditLedgerReadRepository.test.ts`'s "is imported only by …" list gains `adminCreditPercentDeps.ts` | A registry of who may name the ledger read repository; the deps file must import its singleton. The helper itself names no repository (structural types), so it is not added |
| DV-6 | `ADMIN_CREDITS_BUDGET_MS` written as `2 * 1000` | The `creditFigures` guard reads a bare `2_000` as the trial allowance figure; comment says so |
| DV-7 | The setup `jest.mock` lines in `route.test.ts` / `searchInjection.qa.test.ts` were not strictly needed for the suites to pass, but kept as planned | Without them the pass would run against the real entitlements service and repositories (network-shaped calls) inside unrelated suites |

**Notes for SA / QA**

- `findPeriodAnchorsBatch` refuses an empty list (as §4.6 says), unlike its sibling `findEntitlementInputsBatch`, which returns `{}`; the helper never calls it with none.
- The card's headline for "less than 1%" is 15 px with a 104 px max width (wraps inside the ring); jsdom cannot measure — **QA visual check in en / he / es** (R-2).
- Dictionary keys added (he / es for native review): `usage.less_than_percent`, `usage.sr.monthly`, `usage.sr.trial`, `usage.sr.plain`; removed: `usage.of`, `usage.of_total`.
- QA manual (SA condition 5): the card's % equals the `/admin/users` "Credits left" % for one live account.

## 5. Part 8b — the low-line audit record

*(Dev, 2026-10-04. Expanded from the outline written with 8a. Full path: this section → **SA workplan review** → Dev → SA code review → QA → user diff → RM. SA's rulings SQ-44, SQ-45, SQ-46 and condition 4 of "SA review — slice 8 scoping (2026-10-02)" are binding. Nothing below is built yet.)*

**Branch:** `feature/business-os-credit-deduction-slice-8b`, cut by RM from `origin/main` `89dbc568` (includes 8a, PR #189). Confirmed with `git branch --show-current`. The requirement MD carries an uncommitted edit by the coordinator; Dev does not touch it.
**Status:** SA workplan review ✅ approved with conditions (2026-10-04); conditions folded below; **Code Complete** (B-0 to B-7, evidence §5.12) — awaiting SA code review → QA. *(Previous, superseded: Planning — awaiting SA workplan review.)*

### 5.0a SA workplan-review conditions and rulings (folded 2026-10-04)

| # | Condition / ruling | Folded into |
|---|---|---|
| C-B1 (Q-B5) | `actorId` = a **UUID-checked platform actor** via a new pure `platformActorUuid()` in `lib/platformAccount.ts` (env value if a UUID, else the all-zero id; no imports, no logging). The hook uses it; it never imports `aiActionAudit.ts` (cycle). `platformActorId()` in `aiActionAudit.ts` may delegate only if behaviour is identical and its tests stay unedited, else a recorded follow-up. Tests: non-UUID env → all-zero; the entry's `actorId` equals it and is never the account | §5.5, §5.8, B-2 |
| C-B2 | Hook-point source guard: exactly one `checkCreditLowLine(` in `aiChargeRecorder.ts`, after the `!data.recorded` return, inside `if (data.anchorSource === 'plan' && record.credits > 0)`; the recorder still names no `supabaseServer`, `.from(`, `.rpc(` | §5.6, §5.8 |
| C-B3 | NI-7's flush-hang case: fake timers, total delay ≤ 500 ms + 2,000 ms, `jest.getTimerCount() === 0` after it settles; any test that hangs the chain calls `__resetAuditFlushChainForTests` | §5.8 |
| C-B4 (Q-B7) | §5.12 pastes local runs of every §5.11 "not in CI" suite plus NI-5 before / after. CI scope unchanged. The CI-tier note is recorded by the coordinator (not edited by Dev) | §5.12 |
| C-B5 (BD-26) | The two names (`BOS_CREDIT_LOW_LINE_CROSSED`, `'business_os_credit_period'`) — already passed on by the coordinator | §5.9 |
| Q-B1 | Exact expression: `anchor: input.anchorSource === 'plan' ? input.periodStart : null`, with the comment; a test pins `per: 'month'` → `period` with **no** anchor read | §5.4 |
| Q-B2 to Q-B4, Q-B6 to Q-B8; DV-B1 to DV-B4 | Accepted as proposed | §5.4 to §5.8 |

### 5.0 What 8b delivers, and what it does not

When a **recorded** AI charge takes an account's **shown** percentage left from at or above the low line (10) to below it, one audit entry `BOS_CREDIT_LOW_LINE_CROSSED` is written for admins (FR-49, BD-22). The check runs inside the charge recorder, after the write, under its own time limit, and can never change, fail or noticeably slow the action (FR-50).

| In | Out (guardrails) |
|---|---|
| One pure crossing decision built on 8a's `creditPercentLeft` and `LOW_LINE_PERCENT` | No migration, no table, column, index or function (SQ-45). No change to `business_os_record_credit_charge`, `_charges`, `_totals` (11a L8 md5 untouched, AC-46) |
| One hook module + one deps file, called once from `aiChargeRecorder.ts` `write()` | Nothing shown or sent to the owner; no notice, email or banner (BD-22) |
| One registered event (`bos`, `info`) and one new entity type | No "seen" set, no `audit_trail` pre-read (SQ-45) |
| An optional `signal` on the two owner-repository reads | No change to `runAiAction`'s logic; only its header comment's bound |
| Registrations (entitlements, plan-repository referrers, `creditFigures`, cut-off guard) | Not the owner-hiding fix for these entries (BD-26 — owned by the slice 11 session; see §5.9) |
| | Extra credits (lots) never count (BD-25): the line is measured against the **plan allowance only** |

### 5.1 As-built facts 8b rests on (verified 2026-10-04 at `89dbc568`)

| # | Fact | Where |
|---|---|---|
| B-F1 | `write()` returns early on exception, timeout and DB error (`:202-231`) and on `!data.recorded` (`:233-238`); then logs the `calendar_month` warn (`:240-243`), the fallback-priced info (`:245-259`) and `bos_ai_charge_recorded` at debug (`:261`). The hook goes **after `:261`**, the last line of `write()` | `lib/business-os/llm/aiChargeRecorder.ts` |
| B-F2 | `AiChargeRecord` carries `actionId`, `accountId` (already validated by `runAiAction`), `actionType`, `trigger` (`'owner' \| 'scheduled' \| 'external'`), `credits` (number, 6 dp); the RPC result carries `recorded`, `periodStart` (the charge's own exact key), `anchorSource` (`'plan' \| 'calendar_month'`) | `chargeResolver.ts:50-64`; `aiChargeRecorder.ts:218` |
| B-F3 | Owner read repository: `findTotalsForPeriod(accountId, periodStart)` (one row or null), `listTotalsFrom(accountId, from)` (ceiling 24, `reachedCeiling`); constructor **requires** a client and the file imports no service client (pinned by `BusinessOsCreditOwnerReadRepository.test.ts:306`); neither method takes a signal today | `lib/repositories/BusinessOsCreditOwnerReadRepository.ts:171-249` |
| B-F4 | `BusinessOsCreditChargeRepository` already uses the signal pattern: `options: { signal?: AbortSignal } = {}`, `if (options.signal) query = query.abortSignal(options.signal)` | `BusinessOsCreditChargeRepository.ts:132`, `:150` |
| B-F5 | `getEntitlementService().getSnapshot(accountId)` serves from a 30 s instance cache, else one read; `creditAllowanceForDisplay(snapshot)` → `{ amount, per: 'month' \| 'total' } \| null`; the owner card reaches it the same way (`ownerCreditUsage.ts:106-116`) | `EntitlementService.ts:203-240` |
| B-F6 | `creditWindowRule({ anchor, allowance })`: anchor null ⇒ allowance null; `per: 'total'` + anchor ⇒ `trial_total`; else `period`. `parseLedgerFigure` returns null on an unparseable figure | `lib/business-os/credits/creditWindowRule.ts` |
| B-F7 | `creditPercentLeft(used, allowance)` → `{ shown, band, share } \| null`; `LOW_LINE_PERCENT` derived from the band table (10); `bandFor(shown)`; `roundToLedger` in `creditBalance.ts` | `creditBands.ts`; `creditBalance.ts:26` |
| B-F8 | `logAndFlush(entry, logger, { reason, continues })`: never rejects, races `AUDIT_FLUSH_TIMEOUT_MS = 2000`, serialised per instance, flushes the **whole** instance queue (so the action's own queued AI entry is written too — harmless) | `lib/audit/boundedAuditFlush.ts:91`, `:144-178` |
| B-F9 | `buildLogEntry`: `severity = input.severity \|\| metadata.severity` (writer wins); **`actorId = input.actorId \|\| input.userId \|\| SYSTEM_ADMIN_USER_ID`** — passing `actorId: null` stores the **account** as the actor (see Q-B5) | `lib/services/AuditTrailService.ts:147-154` |
| B-F10 | Registration pattern (11b): `AUDIT_EVENTS` key + comment (`events.ts:169-179`), `EVENT_METADATA` (`:722-736`, `complianceFlags` optional), `eventAudience.ts` tag (`:136-137`, `satisfies Record<AuditEvent, AuditAudience>`), a `GROUP_RULES` prefix in `filterOptions.ts:108` (cosmetic; without it the event falls into a "Bos" group). `AUDIT_ENTITY_TYPES` drives the entity filter by derivation (`filterOptions.ts:224`) — no second list to edit | `lib/audit/*` |
| B-F11 | `eventAudience.test.ts:54-58` pins the counts: **175 registered, 30 `bos`**, 61 shared, 84 agentspilot, with a comment line per addition | that file |
| B-F12 | Every suite that runs the recorder for real: `aiActionAudit.test.ts` (fakes the repository; default `recorded: true`, `anchorSource: 'plan'`, `:139`) and `aiChargeRecorder.test.ts` (default `ok()` = `recorded: true`, `'plan'`, `:86-89`). The other 10 census suites `jest.mock` the whole recorder, so the hook never loads there | `grep -rl aiChargeRecorder --include=*.test.ts` |
| B-F13 | The recorder suite's source guards: only types from `aiActionAudit` (C-5), no `supabaseServer` / `.from(` / `.rpc(` **in the recorder file**, `recordCharge(` once, no "retry" | `aiChargeRecorder.test.ts:370-414` |
| B-F14 | `accountSeam.guard.test.ts`: a product file that reaches the entitlement service must go through `resolveAccountId` and never pass a raw id to `getSnapshot` | `lib/business-os/entitlements/__tests__/accountSeam.guard.test.ts` |
| B-F15 | `creditBands.guard.test.ts` `CONSUMERS` (`:27-31`) and the scoped comparison rule already cover every non-test file in `lib/business-os/credits/` — the new module is in scope automatically and joins `CONSUMERS` | that file |
| B-F16 | CI: only `test:bos-entitlements` (`lib/business-os/entitlements`, `lib/repositories/__tests__`, `supabase/migrations/__tests__`, two single files), `test:authz-guard`, plugin tests, `lint:hooks`, `typecheck:bos-llm` (type-checks `lib/business-os/llm/`, `credits/`, `entitlements/`, `usage/`) and `build` run on PRs. **No CI job runs the rest of Jest** | `package.json:21`; `.github/workflows/*`; `scripts/typecheck-bos-llm.ts:102-110` |

### 5.2 Approach

```text
runAiAction ─▶ recordAiCharge ─▶ write()
                                   ├─ recordCharge (≤ 1.5 s budget, unchanged)
                                   ├─ early returns: exception / timeout / DB error / recorded:false   (hook never called — NI-8)
                                   ├─ existing logs (no plan row warn, fallback info, recorded debug)
                                   └─ if anchorSource === 'plan' && credits > 0:                      (pre-filter — NI-8, Q-B2)
                                        try { await checkCreditLowLine(input) } catch { one error log }  (defence in depth — NI-7)

lib/business-os/credits/creditLowLine.ts   (server-only; non-gate entitlements importer)
  checkCreditLowLine(input, deps = creditLowLineDeps())    — never throws
   1. pre-filter again: calendar_month or credits ≤ 0 → return, ZERO reads
   2. READ PHASE, raced against CREDIT_LOW_LINE_READ_BUDGET_MS = 500 (timer unref'd, cleared in finally; signal → owner reads)
        allowance = creditAllowanceForDisplay(getSnapshot(resolveAccountId(account)))   — null → done
        per 'month'  → findTotalsForPeriod(account, input.periodStart)                 — ONE read
        per 'total'  → findPeriodAnchor(account) → creditWindowRule → listTotalsFrom(account, anchor)
        usedAfter  = roundToLedger(Σ parseLedgerFigure(credits_total))
   3. DECIDE (pure): usedBefore = roundToLedger(usedAfter − roundToLedger(credits)); crossedLowLine(before, after)
   4. WRITE, only if crossed and the read phase did not time out:
        Pino info 'bos_credit_low_line_crossed'  →  logAndFlush(entry)  (own 2 s bound)

lib/business-os/credits/creditLowLineDeps.ts  (server-only)
  findPeriodAnchor ← businessOsAccountPlanRepository (service role, findPeriodAnchor ONLY)
  owner            ← new BusinessOsCreditOwnerReadRepository(supabaseServer)  — documented S11-SQ-9 pattern
```

The read phase and the write phase are separate on purpose: a read that answers after the 500 ms budget is discarded with the race, so a late result can **never** write an entry (tested).

### 5.3 The crossing decision (FR-49; SQ-44; BD-20 / BD-25)

In `creditLowLine.ts`, pure and exported:

```typescript
/** True when the SHOWN percentage is under the low line. Same rule as the card's red band. */
export function isBelowLowLine(shown: ShownPercentLeft): boolean;   // less_than_one, or value < LOW_LINE_PERCENT
export type LowLineCrossing =
  | { crossed: true; before: ShownPercentLeft; after: ShownPercentLeft }
  | { crossed: false; reason: 'no_allowance' | 'already_below' | 'still_above' | 'anomaly' };
export function crossedLowLine(usedBefore: number, usedAfter: number, allowance: number): LowLineCrossing;
```

- Both sides go through **8a's `creditPercentLeft`** — the BD-20 integer rounding the card uses — so "crossed" means exactly "the card went from a non-red number to a red one". No percentage maths, cut-off or literal in this file (the cut-off guard enforces it).
- `creditPercentLeft` returns null (no allowance, unsafe allowance) → `no_allowance`. `usedAfter < usedBefore` cannot happen for a positive charge; `usedBefore < 0` (the total read is smaller than this very charge — a read anomaly) → `anomaly`, no entry, one warn (Q-B4).
- `allowance` is the **plan** allowance from `creditAllowanceForDisplay` only; credit lots are never read (BD-25). If 11d ever moves to plan + extra, this function and the card change together (§11 follow-up, unchanged).
- A test proves `isBelowLowLine(shown) === (bandFor(shown) === 'below_line')` for every shown value 0..100 and `less_than_one`, so the line and the red band cannot drift.

**Why "once per period" holds without a marker (SQ-45, derived):** within one period (or one trial) `credits_total` only rises — no adjustment is written (4c deferred), and lots never touch totals. So exactly one charge can straddle the line. A new period starts at 100% (no fire on a reset); a recovery needs a higher allowance (KI-22 extended: a second entry is then possible; reports count distinct `(account, periodStart)`); two charges committing together at the line can give two entries or none (KI-21). All accepted by SA.

### 5.4 The hook module (SQ-44)

New **`lib/business-os/credits/creditLowLine.ts`** (`import 'server-only'`).

```typescript
export const CREDIT_LOW_LINE_READ_BUDGET_MS = 500;
export interface CreditLowLineInput {
  accountId: string;           // record.accountId — validated by runAiAction, never caller input
  credits: number;             // record.credits
  periodStart: string;         // the charge's own key, verbatim (never re-derived from "now")
  anchorSource: 'plan' | 'calendar_month';
  actionId: string; actionType: string; trigger: 'owner' | 'scheduled' | 'external';
  service: string;             // the recorder's AI_CHARGE_SERVICE, passed in (no import of the recorder)
}
export interface CreditLowLineDeps {
  findPeriodAnchor(accountId: string): Promise<RepositoryResult<string | null>>;
  owner: Pick<BusinessOsCreditOwnerReadRepository, 'findTotalsForPeriod' | 'listTotalsFrom'>;
  readAllowance?(accountId: string): Promise<OwnerCreditAllowance | null>;   // test seam; default = entitlements
}
export async function checkCreditLowLine(input: CreditLowLineInput, deps?: CreditLowLineDeps): Promise<void>;
```

Steps:

1. **Zero-read pre-filter:** `anchorSource === 'calendar_month'` (no plan row ⇒ no allowance) or `!(credits > 0)` → return, debug line `bos_credit_low_line_skipped`. No read, no timer.
2. **Read phase**, inside a local `withReadBudget(CREDIT_LOW_LINE_READ_BUDGET_MS, (signal) => …)` — the same shape as the recorder's `withWriteBudget` (timer `unref`'d, cleared in `finally`, async IIFE so a synchronous throw becomes a handled rejection):
   - `allowance` = `readAllowance` or the default: `creditAllowanceForDisplay(await getEntitlementService().getSnapshot(resolveAccountId(accountId)))`. Null (no allowance, unavailable snapshot, lapsed, paused) → done, debug `no_allowance`.
   - `per === 'month'` → `creditWindowRule({ anchor: input.anchorSource === 'plan' ? input.periodStart : null, allowance })` (Q-B1, SA ruling: `anchorSource === 'plan'` is the database's own statement that a plan row existed at the write, so the charge's key stands in for "anchor present" and **no anchor read is spent**); mode `period`; **one** read, `owner.findTotalsForPeriod(accountId, input.periodStart, { signal })`. No row → anomaly (the charge was just written into that row) → warn, no entry.
   - `per === 'total'` → `findPeriodAnchor(accountId)` → `creditWindowRule({ anchor, allowance })`; anchor null → done (plan row gone since the write); mode `trial_total` → `owner.listTotalsFrom(accountId, anchor, { signal })`; `reachedCeiling` → warn `ceiling`, no entry (never a partial sum, as the card).
   - Each `credits_total` through `parseLedgerFigure`; any null → warn `unreadable_figure`, no entry. `usedAfter = roundToLedger(sum)`.
3. **Decide:** `usedBefore = roundToLedger(usedAfter − roundToLedger(credits))`; `crossedLowLine(usedBefore, usedAfter, allowance.amount)`. Not crossed → debug only (the common case, not logged at info).
4. **Write** (§5.5) only when crossed and the read phase finished in budget.
5. **Never throws:** read errors, `{ error }` results, the timeout and any exception → **one** `warn` `bos_credit_low_line_check_failed` with `reason` (`timeout` / `read_failed` / `ceiling` / `unreadable_figure` / `anomaly` / `exception`), `errCode` (code or class name, never a message), `accountId`, `actionId`. Logs carry ids, codes and percentages only (bos-llm-call-standards Standard 5).

Not cancelled by the signal: `getSnapshot` and `findPeriodAnchor` (neither takes one; SA asked for the signal on the two owner reads only). A late answer from either is ignored with the race (Q-B3).

New **`lib/business-os/credits/creditLowLineDeps.ts`** (`import 'server-only'`): `findPeriodAnchor` from the `businessOsAccountPlanRepository` singleton, and **one module-level** `new BusinessOsCreditOwnerReadRepository(supabaseServer)`. Header documents the RLS bypass (tenant-isolation-guard; CLAUDE.md rule 4 / security table): the account id is `record.accountId`, validated by `runAiAction` from its own server-side identities, never request input; reads are SELECT-only on owner-safe columns of that one account, `.eq('user_id', accountId)` in every method; it runs in a background charge path with no session, so the owner's RLS client does not exist there — the S11-SQ-9 pattern SA ruled.

**`lib/repositories/BusinessOsCreditOwnerReadRepository.ts`** (`new-repository` rules on an existing class): `findTotalsForPeriod` and `listTotalsFrom` gain `options: { signal?: AbortSignal } = {}` and `if (options.signal) query = query.abortSignal(options.signal)` (B-F4 pattern). Existing callers pass nothing → behaviour unchanged. The header's "THE CLIENT IS REQUIRED" section gains the documented service-role callers (8b `creditLowLineDeps.ts`; later 11c `readCreditPosition`), and states the file itself still imports no service client (its test at `:306` stays green unedited).

### 5.5 The audit event (SQ-46)

| Item | Value |
|---|---|
| Key | `AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED`, with a comment like 11b's (what, entity, details, "derived once per period, KI-21 / KI-22") |
| Metadata | `severity: 'info'`, **no** `complianceFlags`, description "A Business OS account's plan credits dropped below the low line (percent before / after recorded)" |
| Audience | `[AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED]: 'bos'` in `eventAudience.ts` → listed in the admin audit trail's Action Type dropdown (`OPERATOR_AUDIENCES`) |
| Dropdown group | `GROUP_RULES` + `{ prefix: 'BOS_CREDIT_LOW_LINE_', label: 'Business OS Credits' }` — sits with the 11b lot events (cosmetic, Q-B6) |
| Entity type | New `'business_os_credit_period'` in `AUDIT_ENTITY_TYPES`, commented ("one account's credit period; entity id = the account id; written only by the low-line hook, slice 8b") |
| Ids | `entityId = userId = accountId`; `actorId = platformActorUuid()` (C-B1: `SYSTEM_ADMIN_USER_ID` when it is a UUID, else the all-zero id — never null, which `buildLogEntry` would turn into the account, and never a non-UUID, which would fail the whole flushed batch) |
| `details` | `periodStart` (exact key), `periodKind` (`'monthly'` \| `'trial_total'`), `allowance` (plan amount), `percentBefore`, `percentAfter` (whole numbers, `'less_than_one'` as a string), `lowLine` (`LOW_LINE_PERCENT`), `service` (`input.service`, i.e. `'ai'` — passed in, see below), `actionId`, `actionType`, `trigger` |
| Never | `severity` (the writer passes none — registration is the only source, B-F9), `resourceName`, owner text, tokens, dollars, cost, used credits |
| Order | Pino `info` `{ event: 'bos_credit_low_line_crossed', accountId, actionId, actionType, trigger, periodStart, periodKind, percentBefore, percentAfter, lowLine }` **first**, then `await logAndFlush(entry, logger, { reason: 'credit low line crossed', continues: 'the AI action continues' })` |

`service` is passed in on `CreditLowLineInput` from the recorder's `AI_CHARGE_SERVICE`, so the hook never imports the recorder (no cycle) and the recorder's "service only from `AI_CHARGE_SERVICE`" guard (B-F13) stays exact — its expected assignment list grows by one `service: AI_CHARGE_SERVICE` (DV-B3).

**Severity guard** — new `lib/audit/__tests__/creditLowLineSeverity.guard.test.ts`, the `paymentRefundSeverity.guard` pattern: registered `info`, registration exists (not the "Unknown event" default), not `critical`, a value the CHECK accepts; and comment-stripped `creditLowLine.ts` has no `severity` key in any object literal (planted sample `severity: 'warning'` matched first).

### 5.6 The hook point (SQ-44, FR-50)

In **`aiChargeRecorder.ts` `write()`**, after the `bos_ai_charge_recorded` debug line (B-F1):

```typescript
if (data.anchorSource === 'plan' && record.credits > 0) {
  try {
    await checkCreditLowLine({ accountId: record.accountId, credits: record.credits, periodStart: data.periodStart,
      anchorSource: data.anchorSource, actionId: record.actionId, actionType: record.actionType,
      trigger: record.trigger, service: AI_CHARGE_SERVICE });
  } catch (err) {
    // checkCreditLowLine never throws; defence in depth (SA SQ-44).
    logger.error({ event: 'bos_credit_low_line_check_failed', reason: 'exception', errCode: errCodeOf(err) ?? null, ...ids }, '…');
  }
}
```

- The pre-filter is repeated in the recorder so NI-8's "never **called** on `calendar_month`" holds literally; the hook keeps its own copy so it is safe on its own (Q-B2).
- Header comments updated: the recorder's "cannot delay it beyond the budget" becomes "the write budget, plus at most `CREDIT_LOW_LINE_READ_BUDGET_MS` after a recorded charge, plus the audit flush bound on the one charge that crosses the low line"; `runAiAction`'s doc (`aiActionAudit.ts:12-17`, `:448-451`) says the same in one line. **No logic in `aiActionAudit.ts` changes.**
- **Worst-case added delay** (SA): ≤ 0.5 s on any charged action with a plan row; ≤ 2.5 s on the one crossing charge per account per period. No change on uncharged, skipped, failed-write, duplicate or `calendar_month` paths.
- The recorder still reaches the database only through the charge repository: `supabaseServer` lives in `creditLowLineDeps.ts`, which the recorder does not import (the hook defaults its deps).

### 5.7 Registrations (`business-os-entitlements` skill; SQ-43)

| Registry | Change |
|---|---|
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS` | + `{ file: 'lib/business-os/credits/creditLowLine.ts', symbols: ['creditAllowanceForDisplay', 'getEntitlementService', 'resolveAccountId'], why: 'Credit deduction slice 8b: after a charge is recorded, reads the account\'s plan allowance (getSnapshot through the account seam, then creditAllowanceForDisplay) to decide whether the shown percentage crossed the low line, and writes one admin audit entry. It refuses nothing and never calls check() / decide(); if it ever does, it is a gate and belongs in ENFORCEMENT_POINTS.' }` — symbols equal the file's imports exactly |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | `creditLowLineDeps.ts` in `ALLOWED` (reason) **and** `NO_STATE_WRITE_REFERRERS`; a method pin like 6a / 8a: it calls `findPeriodAnchor` on the plan repository and nothing else (planted sample first) |
| `accountSeam.guard.test.ts` | No edit expected: `creditLowLine.ts` names `resolveAccountId` and passes its result to `getSnapshot` (B-F14). If the guard's classifier needs an entry, Dev adds it and records it here |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts` | `SOURCES` + `lib/business-os/credits/creditLowLine.ts` (names `creditAllowanceForDisplay`, required by the completeness test). The 500 ms budget is not a credit figure (< 1,000) |
| `lib/business-os/credits/__tests__/creditBands.guard.test.ts` | `CONSUMERS` + `creditLowLine.ts` (imports the band module; no cut-off defined or compared) — already promised in §4.3 |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` "no `Date` from a key" `it.each` | + `creditLowLine.ts` (keys stay strings end to end) |
| `lib/audit/__tests__/eventAudience.test.ts:54-58` | Count pin **175 → 176, `bos` 30 → 31**, one comment line ("+1 Business OS (BOS_CREDIT_LOW_LINE_CROSSED): credit deduction slice 8b") — forced by the new event (DV-B2) |
| `test:bos-entitlements` | Run on the final diff, result pasted in §5.12 |

No new API handler → no authz-guard census or cap change. No new capability id or tier literal.

### 5.8 Test plan — 8b

| Check | File | Pass criterion | In CI? |
|---|---|---|---|
| Crossing maths (AC-44 as unit tests) | new `lib/business-os/credits/__tests__/creditLowLine.test.ts` | Fires once at the crossing charge (10% → 9%); **not** on the next charge below (9% → 8%); **not** when the action starts below; trial crossing against 2,000 fires once (`periodKind: 'trial_total'`, summed from the anchor over two periods); one charge from 40% to over the allowance fires (`percentAfter: 0`); exactly 10.000000% after → no fire (orange); to "less than 1%" → fires with `'less_than_one'`; no allowance (snapshot null, unavailable) → no read beyond the snapshot, no entry; reset (new period, first charge) → none; `isBelowLowLine` ≡ `bandFor === 'below_line'` sweep | No — see §5.11 |
| Reads and pre-filters (SQ-44) | same | `calendar_month` and `credits ≤ 0` → **zero** reads, no timer; monthly → exactly one `findTotalsForPeriod` with the charge's **verbatim** key (a microsecond string), never a key from `now` (fake clock moved a month: same key used); trial → anchor then `listTotalsFrom(anchor)`; ceiling, unparseable figure, missing row, `{ error }`, rejecting read, `usedBefore < 0` → one warn each, no entry | No |
| Budget (NI-6 at unit level) | same | Hanging snapshot / anchor / totals read → returns at 500 ms, the owner read's signal aborted, `jest.getTimerCount() === 0`, one warn `timeout`; **a read that resolves after the budget writes no entry** | No |
| Entry shape (SQ-46) | same (`AuditTrailService` mocked) | Exact `action`, `entityType`, `entityId === userId === account`, the agreed `actorId` (Q-B5), exact `details` key set, **no `severity` key**, no `resourceName`, recursive scan finds no `cost` / `token` / `usd` / `dollar` / `used` key; the Pino `info` is logged **before** `logAndFlush` is called (call order); flush failure → one warn, no throw | No |
| Severity / registration | new `lib/audit/__tests__/creditLowLineSeverity.guard.test.ts`; `eventAudience.test.ts` | `info`, registered, `bos`, counts 176 / 31; writer passes none (planted first) | No |
| Hook point **NI-6 / NI-7 / NI-8** | `lib/business-os/llm/__tests__/aiChargeRecorder.test.ts` (new `describe('low-line hook')`) | **NI-6:** real hook (`jest.requireActual`) with hanging deps → `recordAiCharge` resolves ≤ write + 500 ms, no timer left. **NI-7:** hook throws synchronously / rejects / `logAndFlush`'s write hangs (AuditTrail mocked at module level) → `recordAiCharge` still resolves, one log line, total delay ≤ 500 ms + 2,000 ms. **NI-8:** hook not called on `recorded: false`, timed-out write, DB error, thrown repository, skipped (`no_calls`, `not_charged`), not written (`invalid_identity`, `unpriceable`, `undecided`), `calendar_month`, `credits: 0`; called exactly once, with the charge's own `periodStart` / `anchorSource`, on the happy path. Source guard: one `checkCreditLowLine(` call, positioned after the `!data.recorded` return | No |
| NI-1 to NI-4 unedited | `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | **One** module-level `jest.mock('@/lib/business-os/credits/creditLowLine', …)` line (setup only); `git diff` of that file = that line (+ its comment) only; all NI tests green | No |
| NI-5 | Whole Jest run, before (T-0) vs after | Identical failing-suite list; new suites only add passes | No (local) |
| Owner repository signal | `lib/repositories/__tests__/BusinessOsCreditOwnerReadRepository.test.ts` | With a signal → `abortSignal` called with it; without → not called; existing tests unedited | **Yes** (`test:bos-entitlements`) |
| Registrations | §5.7 suites | Green | **Yes** (entitlements, imports guard, creditFigures) / No (cut-off guard, creditPeriod) |
| AC-46 | `git diff --stat origin/main -- supabase/` = empty | No migration, no charge-function change | Reviewed by SA |
| Types / lint / build | `npx tsc --noEmit` vs T-0 baseline; `npm run typecheck:bos-llm`; `npx eslint` on changed files; `npm run lint:hooks`; `next build` (owed via the coordinator, as 8a) | No new error | `typecheck:bos-llm`, `lint:hooks`, build: **Yes** |

### 5.9 QA manual check and post-merge checks

- **QA (SA condition 5):** on a **test** account, a temporary entitlement override lowering the allowance so that one action crosses 10% (e.g. allowance just above `used / 0.9`), then one owner action → exactly **one** `BOS_CREDIT_LOW_LINE_CROSSED` row in `/admin/audit-trail` under the Business OS dropdown ("Business OS Credits" group), with the details of §5.5; a second action → **no** second row; remove the override afterwards. The action itself returns normally both times. QA does not sign in with real credentials, so the signed-in part may be owed by the user, as in 8a.
- **User, after merge (condition 4, read-only on PROD):** re-run `scripts/check-bos-credit-lots-migration.sql` L8 (charge-function md5) and C7; both pass unchanged (8b changes no SQL).
- **BD-26 dependency (not 8b's to fix):** like the 11b lot entries, a low-line entry is written with `userId` = the account and is therefore readable by that owner through `GET /api/audit/query` and `/monitoring` until the slice 11 session's owner-read exclusion lands (KI-25, accepted). That fix must cover the action `BOS_CREDIT_LOW_LINE_CROSSED` / entity type `'business_os_credit_period'`; Dev hands both names to the coordinator for the slice 11 session. Today no live account is expected to cross (KI-24), so in practice the only such row before that fix is QA's forced one, on a test account.

### 5.10 Task list — 8b

| # | Task | Estimate |
|---|---|---|
| ✅ **B-0** | Baselines: `npx tsc --noEmit` error list; `npm test` whole-suite pass/fail list (NI-5 "before"); `npm run test:bos-entitlements`; re-run the B-F12 census (`grep -rl aiChargeRecorder`) and confirm no suite but the two runs the real recorder | 0.1 d |
| ✅ **B-1** | Owner repository: optional `signal` on the two reads + tests + header (§5.4) | 0.1 d |
| ✅ **B-2** | `creditLowLine.ts` (pre-filter, read phase under 500 ms, `crossedLowLine`, `isBelowLowLine`, write phase) + `creditLowLineDeps.ts` + `creditLowLine.test.ts` (AC-44 cases, reads, budget, entry shape) (§5.3–5.5) | 0.5 d |
| ✅ **B-3** | Audit registration: event + metadata + audience + group rule + entity type; `eventAudience.test.ts` count pin; severity guard (§5.5) | 0.15 d |
| ✅ **B-4** | Recorder hook + pre-filter + header comments (recorder, `runAiAction`); recorder-suite module mock line + NI-6 / NI-7 / NI-8 + source guard; `aiActionAudit.test.ts` one mock line (§5.6, §5.8) | 0.3 d |
| ✅ **B-5** | Registrations (§5.7) + `npm run test:bos-entitlements` | 0.1 d |
| ✅ **B-6** | Docs: `BUSINESS_OS_CREDIT_PRICING.md` (the low-line record: when, once per period, derived, KI-21 / 22 / 23), `BUSINESS_OS_ENTITLEMENTS.md` (Metering: second display-only non-gate importer, and the new audit event beside the 11b lot events); Change History rows | 0.05 d |
| ✅ **B-7** | Gates (§5.8) with results pasted in §5.12, incl. NI-5 "after", `git diff --numstat` (no deletion without insertion; `aiActionAudit.test.ts` = the one line; no `supabase/` change) | 0.1 d |
| ⬜ **B-8** | Handover uncommitted: SA code review → QA → user diff → RM; hand the BD-26 names to the coordinator | — |
| | **Total 8b** | **≈ 1.4 d** |

Inside SA's 1.25–1.6 d. B-2 is the likeliest to run long (the timing tests). If the total passes **2 d**, Dev stops and returns to SA rather than trimming tests.

### 5.11 Tests CI does not run (flagged)

Only `test:bos-entitlements` runs Jest on PRs (B-F16). **In CI:** the owner-repository signal tests, the `KNOWN_NON_GATE_IMPORTERS` entry, the plan-repository referrer pin, the `creditFigures` `SOURCES` entry. **Not in CI (local, SA and QA re-run):** `creditLowLine.test.ts`, the NI-6 / NI-7 / NI-8 proofs and NI-1 to NI-5 (`lib/business-os/llm/__tests__/`), the severity guard and the audience count (`lib/audit/__tests__/`), the cut-off guard and the creditPeriod Date guard (`lib/business-os/credits/__tests__/`). Type errors in the new code and tests **are** caught in CI by `typecheck:bos-llm` (it scopes `lib/business-os/llm/` and `credits/`). Moving these tests into a CI-run folder would put them next to unrelated code, so Dev does not propose it; widening the CI Jest scope belongs to the CI tiering work (Q-B7).

### 5.12 8b implementation evidence

*(Dev, 2026-10-04.)* Uncommitted on `feature/business-os-credit-deduction-slice-8b` at `89dbc568`. No migration, no SQL, no `supabase/` change, no database read or write, no dev server. Jest runs use the repo's setup env plus `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. **`next build` not run by Dev (QA runs it in place).**

**Gates**

| Gate | Result |
|---|---|
| `npm run test:bos-entitlements` (CI) | ✅ **108 / 108 suites, 2,521 / 2,521 tests** (incl. the new non-gate entry, the plan-repository referrer pin for `creditLowLineDeps.ts`, the `creditFigures` SOURCES entry, the owner-repository signal suite) |
| `npm run typecheck:bos-llm` (CI) | ✅ passed — 398 files in scope, 28 errors, **0 new**. It also reports one baseline entry already fixed (`app/api/onboarding/build/route.ts` TS18047) — not 8b's; left for whoever owns the baseline |
| `npx tsc --noEmit` (6 GB heap) | 2,085 errors in the repo; **0 in the 22 changed or new TS files**. 39 error lines name `business_os_credit_period`: every one is a pre-existing "X is not assignable to EntityType" error in an untouched file (`lib/audit/admin-helpers.ts`, `ais-helpers.ts`, CRM / email / Stripe Connect routes, `WorkflowOrchestrator.ts`) whose message prints the union. No `Record<EntityType, …>` broke. A pre-change full-tsc baseline was not captured (the NI-5 run took the slot); the per-file check above stands in for it |
| `npx eslint` on the 22 changed / new TS files | 0 errors; 6 warnings, all pre-existing (`events.ts:1239` unused `_`; `types.ts` five `any`) |
| `npm run lint:hooks` | ✅ clean (`--max-warnings 0`) |
| `git diff --numstat` | No deletion without insertion. `aiActionAudit.test.ts` **+2 / −0** (the one mock line and its comment); `aiActionAudit.ts` +6 / −3 (comments only); no file under `supabase/` |

**Suites §5.11 lists as not in CI — local runs (C-B4)**

| Suite | Result |
|---|---|
| `lib/business-os/credits/__tests__/creditLowLine.test.ts` (new) | ✅ 51 / 51 — AC-44 cases, reads and pre-filters, budget (incl. "a read answering after the budget writes no entry"), entry shape, actor (C-B1), flush hang (C-B3), source guards |
| `lib/business-os/llm/__tests__/aiChargeRecorder.test.ts` | ✅ 60 / 60 (37 before + 23: NI-8 ×13, NI-6 ×2, NI-7 ×5, C-B2 ×3); the 37 existing bodies unedited |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` (NI-1 to NI-4) | ✅ 85 / 85, same count as before; diff = the one mock line |
| `lib/audit/__tests__/creditLowLineSeverity.guard.test.ts` (new) | ✅ 5 / 5 |
| `lib/audit/__tests__/eventAudience.test.ts` | ✅ 21 / 21 (176 / 31 / 61 / 84) |
| `lib/audit/__tests__/` (all 12 suites) | ✅ green |
| `lib/business-os/credits/__tests__/creditBands.guard.test.ts` | ✅ 55 / 55 (`creditLowLine.ts` in CONSUMERS and in scope; no cut-off) |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` (Date guard) | ✅ 34 / 34 |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | ✅ 34 / 34 (see DV-B5) |
| `lib/__tests__/platformAccount.test.ts` | ✅ 13 / 13 (4 new for `platformActorUuid`) |
| Combined: `lib/business-os/credits lib/business-os/llm lib/audit lib/__tests__/platformAccount.test.ts app/admin/audit-trail` | ✅ **72 / 72 suites, 1,563 / 1,563 tests** |

**NI-5 — whole Jest run, before vs after**

| | Suites | Failed suites | Tests | Failed | Passed |
|---|---|---|---|---|---|
| Before (`89dbc568`, no 8b code) | 812 | 27* | 14,966 | 146 | 14,784 |
| After | 815 (+3 new) | 26 | 15,064 | 145 | 14,883 |

\* One "before" red is Dev's own doing: `creditLowLine.ts` was written while the baseline was still running, and `serviceColumn.guard.test.ts` scanned it mid-run and failed (that is how DV-B5 was found). Excluding it, **the failing-suite list is identical before and after (26 suites)**: the V6 / agentkit / pilot / orchestration reds, `DeclarativeCompiler-*`, `proposals-capability`, `tokenUsageRepository.contract`, `featureFlags`, `website-builder` ×2, `runRecord.adoption`, chat-v4 `route.audit`, `marketingGate` (focused), plus the 8 skipped plugin integration suites. Per-suite pass counts change only in the suites 8b touched (above), plus `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` 63 → 64 (it iterates registered events). **No test that passed before fails after.**

**Census (B-F12, re-run at B-0)**: three suites run the real recorder — `aiActionAudit.test.ts`, `aiChargeRecorder.test.ts` (both mock the hook module), and `lib/business-os/credits/__tests__/creditLeakCheck.ac31.test.ts`, missed in B-F12. That third suite's charge write is refused (its fake RPC returns `42501`), so the hook is never reached (NI-8's DB-error path); it passes unedited.

**Deviations found while building (for SA code review)**

| # | What | Why |
|---|---|---|
| DV-B5 | The hook's input field is **`chargeService`**, not `service` | `serviceColumn.guard.test.ts` (N-10) forbids `\.service\b` anywhere in `lib/business-os/credits/` outside the resolver, and `input.service` matched. The audit `details` key is still `service: 'ai'`. Consequence: **DV-B3 is moot** — the recorder passes `chargeService: AI_CHARGE_SERVICE`, so its "service only from `AI_CHARGE_SERVICE`" guard still sees exactly two `service:` assignments, unedited |
| DV-B6 | The owner-repository signal tests live in a **new** `lib/repositories/__tests__/BusinessOsCreditOwnerReadRepository.signal.test.ts` | The existing suite's recording client has no `abortSignal` method; a new file keeps that suite unedited. Still in the CI scope |
| DV-B7 | `platformActorId()` in `aiActionAudit.ts` does **not** delegate to `platformActorUuid()` (C-B1's option) | It caches per process and warns once; delegating would change when the env is read. Recorded as a follow-up (one rule, two implementations); behaviour and tests untouched |
| DV-B8 | The hook logs its own give-ups at `warn` (`bos_credit_low_line_check_failed`); the recorder's defence-in-depth catch logs at `error` with the same event name | A hook give-up is expected and harmless; the recorder catching a throw is a defect |

**Notes for SA / QA**

- `creditLowLine.ts` imports `server-only`, like `adminCreditPercent.ts`; it is reached only through the recorder (server). `next build` (QA) is the check that no client bundle reaches it.
- The trial path reads `findPeriodAnchor` and `getSnapshot` without a signal (Q-B3, accepted); a late answer is discarded.
- QA manual (SA condition 5): a forced crossing on a test account → exactly one `BOS_CREDIT_LOW_LINE_CROSSED` row under "Business OS Credits" in `/admin/audit-trail`, actor = the platform account (not the owner), the next action none.
- After merge, the user re-runs `scripts/check-bos-credit-lots-migration.sql` L8 / C7 on PROD (read-only).

### 5.13 Deviations from SA rulings (for SA to accept or refuse)

| # | Ruling | Deviation | Why |
|---|---|---|---|
| DV-B1 | Condition 4: "the single module mock line in the NI suite" | The **recorder's own suite** (`aiChargeRecorder.test.ts`) also gains one module-level `jest.mock` of the hook module, plus a module-level `AuditTrailService` mock for NI-7's flush case; its existing test bodies are unedited | Its default write returns `recorded: true`, `'plan'` (B-F12), so without the mock every existing test would run the real hook against the entitlements service; this is also the suite where SA put NI-6 to NI-8 |
| DV-B2 | (not named) | `eventAudience.test.ts` count pin 175 → 176 and `bos` 30 → 31, one comment line | Forced by registering the event; how 11b and the invite slices did it |
| DV-B3 | (not named) | The recorder guard "service only from `AI_CHARGE_SERVICE`" expects three `service: AI_CHARGE_SERVICE` assignments instead of two | The hook receives `service` from the recorder's constant rather than importing the recorder (no cycle) |
| DV-B4 | SQ-44: "`credits ≤ 0` ⇒ return" inside the hook | Repeated as a pre-filter in the recorder (with `calendar_month`) | NI-8 says the hook is never **called** on `calendar_month`; the hook keeps its own check |

### 5.14 Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-B1 | SQ-41 says the 8b hook calls `creditWindowRule`. For a monthly allowance SQ-44 allows one read only, so no anchor is read | Call `creditWindowRule({ anchor: input.periodStart, allowance })` on the monthly path: `anchorSource === 'plan'` is the database's statement that a plan row existed at the write, and the rule only tests `anchor !== null` (the value is never used in `period` mode). Commented in code; a test pins `per: 'month'` → `period` |
| Q-B2 | NI-8 "never called on `calendar_month`" vs SQ-44 "the hook returns with zero reads on `calendar_month`" | Both: the recorder checks `anchorSource === 'plan' && credits > 0` before calling; the hook repeats it (DV-B4) |
| Q-B3 | `getSnapshot` and `findPeriodAnchor` take no signal; after the 500 ms budget they finish in the background | Accept: bounded by the race, the result is discarded, no entry can be written late (tested); adding a signal to the entitlements service is out of scope |
| Q-B4 | The totals read returns less than this charge's own credits (or no row for the charge's key) | Anomaly: one warn, no entry. Never "fire to be safe" |
| Q-B5 | SQ-46 "`actorId` null (system)", but `buildLogEntry` turns a null actor into `userId`, so the row would show the **account** as the actor (B-F9) | Pass `actorId` = the platform account (`platformAccountId()` from `lib/platformAccount.ts`, UUID-checked with the all-zero fallback — the same rule `runAiAction` uses for automatic AI entries), so the row reads as a system event. Alternative: accept actor = account |
| Q-B6 | Without a `GROUP_RULES` prefix the event sits in a fallback "Bos" group in the dropdown | Add `BOS_CREDIT_LOW_LINE_` → "Business OS Credits" (beside 11b's lot events). Cosmetic; no event can be hidden by it |
| Q-B7 | Most 8b tests are outside every CI Jest scope (§5.11) | Leave the scope as is in 8b; SA and QA re-run the listed suites; widening it is for the CI tiering work |
| Q-B8 | The recorder adds no outer timer around the hook (SA: "one bounded awaited call"); the bound lives in the hook (500 ms + the flush's 2 s) | Keep as ruled; NI-6 / NI-7 prove the bound with the real hook. An outer race would be a second timer on every charged action |

### 5.15 Risks — 8b

| # | Risk | Mitigation |
|---|---|---|
| R-B1 | The hook adds latency to every charged action with a plan row | Cached snapshot (usually no round trip) + one indexed totals read; hard 500 ms bound (NI-6); crossing charge +2 s at most, once per account per period |
| R-B2 | Duplicate or missed entry under concurrent charges at the line (KI-21), or after a mid-period allowance change (KI-22 extended) | Accepted by SA (SQ-45); reports count distinct `(account, periodStart)`; revisit triggers recorded in SQ-45 |
| R-B3 | Entry lost: the flush times out, or a batch-interval flush is already running on the instance (`logAndFlush` serialises only its own callers — `boundedAuditFlush.ts` "SCOPE" note) | KI-23 accepted; the Pino `info` line is written first and carries the same ids and figures, so the event is recoverable from logs |
| R-B4 | The hook loads the entitlements service and repositories into suites that run the real recorder | B-F12 census: only two suites; both get the module mock line (DV-B1); B-0 re-runs the census |
| R-B5 | An owner reads their own low-line entry before the slice 11 hiding fix (BD-26, KI-25) | Accepted (own percentage only); names handed to the slice 11 session; no live account expected to cross today (KI-24) |
| R-B6 | A late snapshot or anchor read keeps running after the budget on a warm instance | No side effect (read-only); the result is discarded (Q-B3) |
| R-B7 | The service-role owner read is misused later for a caller-supplied id | Only `creditLowLineDeps.ts` constructs it on the service role; its header and the repository header name the one input (`record.accountId`, server-validated); the account-seam and referrer guards pin the wiring |

**`console.*` in files 8b touches: none.** Counted 2026-10-04: `aiChargeRecorder.ts`, `aiActionAudit.ts`, `BusinessOsCreditOwnerReadRepository.ts`, `BusinessOsAccountPlanRepository.ts`, `lib/audit/events.ts`, `eventAudience.ts`, `types.ts`, `filterOptions.ts`, `creditBands.ts`, `creditWindowRule.ts`, `creditBalance.ts`, and the test files in §5.7 / §5.8 — **0 calls each**. New files use `createLogger`.

---

## 6. What owners and admins see

| State | Card headline | Ring | Admin column |
|---|---|---|---|
| Nothing used | "100%" / "left" | Full, green | 🟢 100% |
| 0.2 used of 32,250 | "99%" | Green, near full | 🟢 99% |
| 64.9% left | "64%" | Green | 🟢 64% |
| 59% / 30% | "59%" / "30%" | Blue | 🔵 |
| 29% / 10.000000% | "29%" / "10%" | Orange | 🟠 |
| 9.6% | "9%" | Red | 🔴 9% |
| 0.4% | "less than 1%" (smaller size) | Red sliver | 🔴 less than 1% |
| At / over | "0%" | No arc, red track | 🔴 0% |
| Trial | "87%", "For your trial" | Against 2,000 | 87% + "trial" |
| No allowance | Credits used, as today | Frame only when used | "No allowance" |
| Read failed | Error line (unchanged colour) | Track only | "Unknown" |
| No Business OS business | — | — | "—" |

Every card today reads 99–100% and green (KI-24).

---

## 7. Test plan

| Check | How | Pass criterion |
|---|---|---|
| Band maths and boundaries | `creditBands.test.ts` | §4.2 list; number and band never disagree in the sweep |
| One definition | `creditBands.guard.test.ts` | Planted samples matched; no consumer defines or compares a cut-off; `LOW_THRESHOLD` gone |
| Owner path unmoved | the 6 owner suites in §4.4, **unedited** | Green; `git diff --stat` 0 lines on them |
| Card states × languages | `UsageCard.percent.render.test.tsx` + the edited 6a / 7a suites | §6 rows in en / he / es; SR label; no "of" line; FR-36 words absent |
| Repositories | the two repository test files | §4.6 lists |
| Display helpers / Date guard | `creditPeriod.test.ts` | Helpers correct; exclusion non-vacuous; `adminCreditPercent.ts` builds no `Date` from a key |
| Admin helper | `adminCreditPercent.test.ts` | §4.9 list incl. owner cross-check and call count |
| Route (happy, auth, failure, timeout, parallel, count, allow-list) | `route.creditsLeft.test.ts` + existing suites | §4.9 table; existing admin users suites green with only the setup line added |
| Admin column | `creditsLeftCell.render.test.tsx`, `source.guard.test.ts`, `defaultFilter.render.test.tsx` | §4.10 |
| Entitlements | `npm run test:bos-entitlements` | Green |
| Types / lint / build | `npx tsc --noEmit` vs T-0 baseline; `npx eslint` on changed files; `npm run lint:hooks`; `next build` (scratch export, as 6b/7a — no worktree, no junction removal) | No new error; exit 0 |
| Wider suites | `npm test -- lib/business-os components/business-os app/admin app/api/admin lib/repositories lib/audit` | No new failure vs T-0 |
| **Manual (QA)** | Signed in as a test account + an admin | The card's % equals the admin column's % for the same account (SA condition 5); he / es / en headline fits the 156 px ring incl. "menos del 1 %" (force via a temporary override on a test account, or a render in Storybook-less dev with a mocked payload); RTL; no warning wording; `/admin/users` loads with the column, BOS rows coloured, non-BOS "—" |

---

## 8. Guardrails

- No migration, no table / column / index / grant / function. No change to the charge function, `_charges` or `_totals` (11a L8 md5 untouched).
- Nothing refused, nothing sent; no warning / paused / upgrade wording.
- No credit count, token, dollar or cost on the card or in the admin column or its payload; the admin totals read selects no cost column.
- Exactly one definition of the cut-offs (`creditBands.ts`); every consumer imports it.
- No per-row database call on the admin list; calls grow per chunk of 100 / 200.
- A failed or slow credits pass never fails, empties or slows the list beyond 2 s.
- The admin ids come from the server's own profile list, never from the request.
- Settings → Plan, the invite page and the credit history (7a, dark) untouched.
- `readOwnerCreditUsage` / `resolveOwnerCreditWindow` behaviour unchanged; `readCreditPosition` left to 11c.
- No `console.*`; new files use `createLogger` (server) or the client logger.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **The branch base is behind main.** #177 (cleanup 5a) is already merged and rewrote 335 lines of `page.tsx` (the record SA asked for: 5a vs 8a, whichever merges second rebases — 5a went first, so 8a rebases). The requirement MD also moved on main while the user holds uncommitted edits to it | RM brings the branch up to `origin/main` before T-1 (Q-11); the page edit is kept to one header, one cell, two `colSpan`s; the requirement MD is not touched by Dev |
| R-2 | "less than 1%" / "menos del 1 %" does not fit the 156 px ring at 29 px | Smaller size for that state only; QA visual check in three languages (jsdom cannot measure) |
| R-3 | The admin figure diverges from the card (different window logic) | One window rule (§4.4); `isCurrentPeriodRow` built on the card's own `nextPeriodStartUtc`; a unit cross-check against `readOwnerCreditUsage`; QA live comparison |
| R-4 | `isCurrentPeriodRow` disagrees with the database at a period boundary (display maths in ms vs the DB function) | Rows are selected, not filtered by a key; at the boundary instant the only effect is reading the just-ended period for at most a millisecond; tests on an anchor on the 31st and month ends |
| R-5 | A trial with a very old anchor widens the range for every account | 92-day bound per Q-5 (that row "Unknown") |
| R-6 | `getSnapshots` runs its chunks sequentially; at 1,000 accounts the pass may approach the budget | Budget → "Unknown", list still 200; the scale trigger in §4.8 is logged-measurable |
| R-7 | he / es strings not native-reviewed | Handed to the user at the diff; release precondition as 7a |
| R-8 | The card's error line keeps `#F97316`, which is 2.8:1 on white as small text | Out of scope (SA: an error is not a band); recorded as a follow-up |

---

## 10. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | One function returning `{ shown, band, share }`, with the arc using the **exact** share (`(allowance − used) / allowance`) rather than today's D-c displayed whole left | Yes. The difference is under one credit of the allowance (invisible), and it lets the "less than 1%" state draw its red sliver, which the displayed-left share cannot (it rounds to 0 left) |
| Q-2 | At 0% there is no arc. The BA table says the ring is red | Draw the empty track in the red band colour at 0% only; otherwise the 0% state has no colour |
| Q-3 | Should the headline text take the band colour? | No: the text stays ink (readable on both surfaces; red text at 11–29 px is borderline); colour lives on the ring; `data-band` on the ring container |
| Q-4 | Admin: a snapshot `unavailable` for a chunk | "Unknown" (a failed read), not "No allowance" — differs from the card, which shows usage with no gauge plus a warn, because on the admin list "no allowance" is a fact an operator acts on |
| Q-5 | A trial anchor years old would widen the range for all accounts | Trial anchors older than 92 days → that row "Unknown", excluded from the range floor (the owner path refuses such a trial at its ceiling too) |
| Q-6 | SA's "≤ 15 round trips at 1,000 accounts" | 25 calls (10 + 10 + 5), ≈ 15 on the critical path because snapshots and anchors run in parallel — Dev reads SA's figure as the critical path; confirm |
| Q-7 | The two existing admin users route suites would load the entitlements service through the route's new import | One module-level `jest.mock` line each (setup, no assertion change), as SA allowed for the NI suite in 8b |
| Q-8 | SQ-47 removes `usage.of` / `usage.of_total`, which the `creditFigures` guard uses as its non-vacuity anchor and template check (F-13) | Move the anchor to `usage.sr.monthly` and check `{percent}` in the four new keys — the guard stays as strong |
| Q-9 | Removing the "of N" line also changes the whole-credit headline assertions and the gauged-state helper in `UsageCard.render.test.tsx`, and the admin header list test — beyond C-S8-7's list | Edit exactly the lines in §4.5 / §4.10 and nothing else |
| Q-10 | Scaled integers need `allowance × 10⁸` to stay a safe integer | Above ≈ 9 × 10⁷ credits the function returns null (card: no gauge; admin: "Unknown"); no BigInt |
| Q-11 | Branch base `9a7c4fb3` vs `origin/main` `05ca1a55` | RM updates the branch before code (Dev does not create branches or merge); Dev re-verifies F-9 to F-12 line numbers after |
| Q-12 | Column place | After "Business / user", as the BA suggested |

---

## 11. Logging, deprecated systems and follow-ups

**`console.*` in touched files: none.** Counted 2026-10-03 in every existing file this plan touches: `components/business-os/UsageCard.tsx`, `lib/business-os/credits/ownerCreditUsage.ts`, `creditPeriod.ts`, `creditDisplay.ts`, `lib/repositories/BusinessOsCreditLedgerReadRepository.ts`, `BusinessOsAccountPlanRepository.ts`, `lib/business-os/LanguageContext.tsx`, `app/admin/users/page.tsx` (also on `origin/main`), `app/admin/users/types.ts`, `app/api/admin/users/route.ts` — **0 calls each**. `route.ts:7` mentions `console.*` in a comment about the earlier conversion; not a call. Nothing to flag or convert.

**Deprecated systems:** none touched.

**Follow-ups (not in 8a):**

- Sort / filter by "Credits left" on `/admin/users` (BA: only if wanted).
- The separate visible-rows admin route, on the scale trigger (§4.8).
- The card's error line colour contrast (R-8).
- 11c's `readCreditPosition` calls `creditWindowRule` (whichever lands second rebases).
- BD-25 governs 8b too: if plan + extra is ever chosen, the card, the admin column and the detector change together in 11d.

---

## SA Review Notes

### SA Workplan Review (2026-10-03)

**Reviewed by SA — 2026-10-03**
**Status:** ✅ Approved with conditions (8a). The 8b outline (§5) matches SQ-44 to SQ-46 and condition 4; it gets its own review when detailed.

**Branch sync (Q-11) verified.** The branch is at `origin/main` `5061489b` (#177 cleanup 5a, #179 slice 11b, #180 Tailwind exclusions); the only uncommitted file besides this workplan is the requirement. Re-checked against the new tree:
- `app/admin/users/page.tsx` (1,175 lines): the header row is still the six headers at `:641-649`, with "Business / user" first; `colSpan={6}` is still at `:655` and `:793`. **The first-100 slice moved from `:677` to `:681`** — update F-9.
- `app/admin/users/types.ts` and `components/` exist as §4.10 assumes.
- `defaultFilter.render.test.tsx` still pins the full header list at `:134`.
- `source.guard.test.ts` still has `SCREEN_FILES` at `:19` and the import rule at `:43`.
- The `creditFigures` guard anchors are still at `:228` / `:236`.
- **None of these files changed since 9a7c4fb3:** `app/api/admin/users/route.ts`, the card, its tests, `creditPeriod.ts`, `ownerCreditUsage.ts`, both repositories this plan extends, `LanguageContext.tsx` and the registries. #179 changed `creditAdminOps.ts`, `creditLots.ts` and `entitlements/adminOps.ts` only, and added no entitlements importer.
- Update the header line and F-17 from `05ca1a55` to `5061489b`.

**Estimate.** ≈ 2.2 d is accepted. The extra 0.1 d over SA's range is the test edits a % headline forces. The stop rule at 2.5 d stands.

#### Deviations

| # | Ruling |
|---|---|
| **DV-1** | **Accepted.** Every listed edit is forced by a ruled change and none weakens an assertion. Also update the `defaultFilter` test **title** ("six columns in all" → seven) together with its list. The two `jest.mock` lines are setup only, like 8b's NI line. Nothing outside the §4.5 / §4.10 / §4.11 lists may change. |
| **DV-2** | **Accepted.** `round(allowance·10⁶) − round(used·10⁶)` equals SA's form for the 6-dp inputs every caller passes (the payload's `used` and the admin sum both go through `roundToLedger`; allowances are whole). One test pins the equality on a few 6-dp pairs. |
| **DV-3** | **Accepted.** Keeping every key→`Date` step inside `creditPeriod.ts` is the better place. The Date-guard exclusion grows by exactly these three functions, each proved by the existing non-vacuity pattern. `utcDayFloor` is used only as a range bound and `isAtOrAfter` only as a row selector; their doc comments say so. |
| **DV-4** | **Accepted, and preferred.** The exception is pinned to the exact import string **and** to `CreditsLeftCell.tsx` only. `page.tsx` stays under the full ban. |

#### Questions

| # | Ruling |
|---|---|
| **Q-1** | **Yes.** One function returning `{ shown, band, share }`; the arc uses the exact share. |
| **Q-2** | **Yes.** At 0% the empty track is drawn in the red band colour, and `data-band` sits on the ring container. |
| **Q-3** | **Yes.** The headline stays ink; colour is the ring's. |
| **Q-4** | **Yes.** On the admin list, a snapshot `unavailable` shows "Unknown", because "no allowance" must stay a fact. The difference from the card is deliberate. |
| **Q-5** | **Yes,** with a note: a trial anchor more than 92 days old is an anomaly, and the admin shows "Unknown" where the card may still show a %. AC-43's "admin % equals the card's" therefore excludes that anomaly (SA note added to the requirement). |
| **Q-6** | **Confirmed.** SA's "≤ 15" meant the critical path. 25 calls in all, about 15 sequential, at 1,000 accounts. The test pins the call counts (1·1·1 / 1·1·1 / 2·2·1); the budget plus the scale trigger covers the rest. |
| **Q-10** | **Yes.** `null` when the allowance overflows (unsafe integer above about 9 × 10⁷ credits): the card shows no gauge, the admin shows "Unknown". No BigInt. |

#### The error-line colour (R-8)

**Follow-up, not 8a.** It is pre-existing, not introduced here, and it is **text** contrast (4.5:1), which no single hex meets on both the white and `#1E293B` surfaces. The fix needs a theme-aware token, which is a separate decision. In 8a: rename the constant to `ERROR_INK` with the colour unchanged, and keep the follow-up in §11.

#### Conditions

1. **C-W1 (guard scope; required).** As written, §4.3's "every file under … `components/business-os/` …" scope is a false positive today: it matches `ChannelSourcesSection.tsx:367` (`conversion >= 10`), `InsightDetailModal.tsx:161` (`minutes >= 60`) and `NeedsYouCard.tsx:695` (`minutes < 60`). Restrict the comparison rule to:
   - the named consumers (`UsageCard.tsx`, `CreditsLeftCell.tsx`, `adminCreditPercent.ts`, and later `creditLowLine.ts`);
   - every non-test file in `lib/business-os/credits/` except `creditBands.ts`;
   - `app/admin/users/**`.

   Prove it has no false positive on the current tree (a test that the scoped files pass today), plus the planted samples. JSX text like `>10<` must not match; add a planted negative for it. The `LOW_THRESHOLD`-nowhere rule stays repo-wide.
2. **C-W2.** F-9 and F-17 line and commit references updated, as above.
3. **C-W3.** `adminCreditPercent.ts` passes `now` once, for both `isCurrentPeriodRow` and the range, and logs no per-account figure (as §4.8 item 8 says). Test that a pass that times out lets its late results change nothing.
4. **C-W4.** §4.9's "Pass times out" test also asserts that the route's own Pino line carries `creditsPass: 'timeout'`.
5. **C-W5.** T-12 pastes the following, with `git diff --stat` = 0 on the owner suites §4.4 names:
   - `npm run test:bos-entitlements`;
   - the creditPeriod Date guard;
   - the screen guard;
   - the surface guard.

**Business question:** none.

- [x] Workplan approved — proceed to implementation of 8a once C-W1 and C-W2 are folded in (Dev, in this file; no SA re-review needed for those two).

### SA Code Review (2026-10-03)

**Code review by SA — 2026-10-03**
**Status:** ✅ Code approved, with two low-priority fixes (not blocking QA).

**Scope.** The uncommitted 8a diff on `feature/business-os-credit-deduction-slice-8` at `5061489b`: 25 modified and 13 new files. The requirement MD is the coordinator's and was not reviewed. Read-only: no Jest, build or lint run by SA; the gate results are Dev's (§4.15), cross-checked against the source.

#### Verified

| Item | Result |
|---|---|
| SQ-39 band module | `creditBands.ts` imports nothing; bands as data on the shown %; `LOW_LINE_PERCENT = lowLineOf(CREDIT_BANDS)` (derived); BD-20 rules in micro-credit integers (`:89-111`), with 100% only at `usedMicro === 0` and `less_than_one` at percent 0 with left > 0; colours `#059669` / `#2a78d6` / `#EA580C` / `#EF4444` as ruled |
| SQ-40 card | `creditPercentLeft(usage.used, allowance.amount)` from the exact payload `used`; no payload change; arc = exact share; red track at 0% (`UsageCard.tsx:367-375`); `data-band` on ring and arc; headline stays ink; error line `ERROR_INK` with the colour unchanged (follow-up R-8) |
| SQ-41 window rule | `creditWindowRule.ts` is pure; `ownerCreditUsage.ts` behaviour unchanged (`:247-256`); the owner suites are 0-line diffs (not in `git status`) |
| SQ-42 admin pass | No N+1: snapshots ∥ anchors per 100, totals per 200, current row picked by `isCurrentPeriodRow` (`adminCreditPercent.ts:200-203`); 2 s race with the timer `unref`'d and cleared (`:253-288`); failure or timeout ⇒ every row `unknown`, warn, never throws; **one `now`** for the selector, the range and the trial cutoff (`:242`, C-W3 test at `adminCreditPercent.test.ts:275`) |
| Rule 1 / 4, service role | Reads only through the two repositories. `findPeriodAnchorsBatch` and `listTotalsForAccountsInRange` take an explicit validated UUID `IN` list (≤ 100 / ≤ 200), select only `user_id, period_anchor` / `user_id, period_start, credits_total`, and are documented as intentional cross-account service-role reads behind `requireAdmin` (`adminCreditPercentDeps.ts:10-19`, both repository headers). The ids come from the route's own business lookup, never from the request. **Bounded and documented: yes** |
| Route | `requireAdmin` still the first statement; Zod unchanged; credits pass runs in parallel with `listUsers` and is skipped when the business lookup failed; `creditsLeft` only on rows with a business; Pino `creditsPass` / `creditsMs` in the served line (C-W4 test `route.creditsLeft.test.ts:239-253`); payload allow-list test `:281` |
| Rules 2 / 3 / 6 | No new input surface; no `console.*`; no `any` in the new code |
| SQ-43 registrations | `adminCreditPercent.ts` in `KNOWN_NON_GATE_IMPORTERS` with exact symbols and a display-only `why`; route imports nothing from the module; `adminCreditPercentDeps.ts` in ALLOWED + `NO_STATE_WRITE_REFERRERS` with a one-method pin and a planted sample; `creditFigures` SOURCES extended. `test:bos-entitlements` 105 suites / 2,407 tests green (§4.15) |
| C-S8-1 / DV-4 | Screen guard: the exact string, only in `CreditsLeftCell.tsx`, with planted negatives (`creditBandsX`, `/index`, `creditDisplay`, entitlements, and the band import in `page.tsx`) |
| C-W1 cut-off guard | Scoped to the consumers, `lib/business-os/credits/**` (minus the band module) and `app/admin/users/**`; "passes today" per file; planted negatives for JSX `>10<`, `=> 10`, `< 0.25`, `>= 100`; `LOW_THRESHOLD` checked repo-wide |
| SQ-47 i18n | `Intl` percent; one `less_than_percent` key with the formatted 1%; three SR keys; `usage.of` / `of_total` removed; the `creditFigures` anchor moved to `usage.sr.monthly`, with `{percent}` required in all four keys × 3 languages |
| Wider-Jest reds | `proposals-capability` (catalog), `tokenUsageRepository.contract` (red on main), `callParams.boundary.step3` (LLM planner) and `chat-v4/route.audit` (worker crash) import none of the touched modules directly, and their domains do not reach them. **Unrelated** (static check; QA reproduces the baseline) |

#### Rulings

- **DV-1 addendum — accepted.** Forced by the % headline and the new column; no assertion weakened.
- **DV-5 — accepted.** The deps file is the only new referrer of the ledger read repository; the helper names none.
- **DV-6 — accepted.** `ADMIN_CREDITS_BUDGET_MS` is a time budget, not a credit figure, and the comment says why it is written `2 * 1000`. Follow-up (not 8a): teach the `creditFigures` guard to skip `*_MS` constants, so no file has to write around it.
- **DV-7 — accepted.** The setup mock lines stop two unrelated suites from reaching network-shaped reads.
- **`findPeriodAnchorsBatch` refuses an empty list — accepted.** It is stricter than its sibling, documented in the method comment, and the only caller never sends one. No change.

#### Findings

1. **`app/api/admin/users/route.ts:190`, `:198`** — `creditsMs` measures the whole `Promise.all` (the slower of auth and credits), not the credits pass. Rename it to `enrichMs`, or drop it (the helper already logs its own `ms`). Priority: **Low**.
2. **`lib/business-os/credits/adminCreditPercent.ts:165`** — `isAtOrAfter(anchor, trialCutoffIso)` uses the trial **row selector** to compare an anchor with a cutoff, outside its documented role (`creditPeriod.ts`: "the trial total's ROW SELECTOR"). The result is correct, but the next reader will be misled. Add a one-line comment, or widen the helper's doc to "an instant at or after another". Priority: **Low**.
3. **Note (no change):** an out-of-range allowance gives `creditPercentLeft` null, so the card shows usage with no gauge, as ruled in Q-10. It cannot happen at today's allowances.

#### Optimisation suggestions

- `UsageCard.tsx`: `new Intl.NumberFormat(...)` is built on every render. Memoising it on `language` is optional; the cost is negligible.

**Required fixes before RM:** findings 1 and 2 (Low; a few minutes; no re-review needed beyond the diff check).
**Owed by QA:** `next build`; the en / he / es visual fit of "less than 1%" in the 156 px ring (R-2); the live check that the card's % equals the admin column's.
**Business question:** none.

**Code approved for QA: Yes.**

### SA Workplan Review — 8b (2026-10-04)

**Reviewed by SA — 2026-10-04** (§5, on `feature/business-os-credit-deduction-slice-8b` at `89dbc568`; read-only)
**Status:** ✅ Approved with conditions. ≈ 1.4 d is accepted, with Dev's stop at 2 d.

#### As-built facts B-F1 to B-F16 — spot-checked against `89dbc568`

All hold. Checked directly:
- **B-F1:** `write()` early returns, the `!data.recorded` return, the `calendar_month` warn, and the `bos_ai_charge_recorded` debug as the last line.
- **B-F9:** `AuditTrailService.ts:149`, `actorId = input.actorId || input.userId || systemAdminId || null`.
- **B-F10:** `GROUP_RULES` with `BOS_CREDIT_LOT_` → "Business OS Credits" at `filterOptions.ts:108`.
- **B-F11:** 175 / 30 / 61 / 84 at `eventAudience.test.ts:54-58`.
- **B-F16:** the `test:bos-entitlements` scope in `package.json:21` includes `lib/repositories/__tests__`, so the owner-repository signal tests do run in CI.

The rest (B-F2 to B-F8, B-F12 to B-F15) match the code I read for 8a and are unchanged on this base.

**Worst-case latency claim — confirmed.**
- Before the read race, the hook does only synchronous work: the pre-filter, building its deps (no I/O) and the cached config lookup.
- The read phase is one race at 500 ms. The write phase is `logAndFlush`, whose 2 s race also covers its chain wait.
- So: **≤ +0.5 s on any charged action with a plan row, ≤ +2.5 s on the one crossing charge**, plus negligible synchronous work.
- No change on the uncharged, skipped, failed-write, duplicate or `calendar_month` paths.

#### Deviations

| # | Ruling |
|---|---|
| **DV-B1** | **Accepted.** The recorder suite's default write is `recorded: true`, `'plan'`, so it needs the same setup mock as the NI suite. Its existing bodies stay unedited, as Dev says. |
| **DV-B2** | **Accepted.** The count-pin change is forced by registering the event, and follows the 11b pattern. |
| **DV-B3** | **Accepted.** `service` is passed in, so there is no recorder import and no cycle. The guard stays exact at three assignments. |
| **DV-B4** | **Accepted.** NI-8 is literal at the call site; the hook keeps its own zero-read pre-filter. |

#### Questions

| # | Ruling |
|---|---|
| **Q-B1** | **Accepted.** `anchorSource === 'plan'` is the database's own statement that a plan row existed at the write, and in `period` mode the rule only tests "anchor present". Write it as `anchor: input.anchorSource === 'plan' ? input.periodStart : null`, with the comment. A test pins `per: 'month'` → `period` with **no** anchor read. |
| **Q-B2** | **Accepted** (see DV-B4). |
| **Q-B3** | **Accepted.** The reads are read-only; a late answer is discarded with the race; the test proves no late entry. Adding a signal to the entitlements service is out of scope. |
| **Q-B4** | **Accepted.** No row, or a total below this charge → one `anomaly` warn, no entry. Never "fire to be safe". |
| **Q-B5** | **Changed from SQ-46: the actor is the platform actor, UUID-checked** — not `null` (which stores the account as the actor) and not the raw `platformAccountId()`. `actor_id` is a uuid column, and a non-UUID `SYSTEM_ADMIN_USER_ID` would fail **the whole flushed batch**, including the action's own AI entry (that is why `runAiAction` checks). See C-B1. SA note and Change History row added to the requirement. |
| **Q-B6** | **Accepted.** `BOS_CREDIT_LOW_LINE_` → "Business OS Credits". |
| **Q-B7** | **Leave CI scope unchanged in 8b — cheap, but not right.** Appending `lib/business-os/llm/__tests__` and `credits/__tests__` to `test:bos-entitlements` is one line, but it would put charge-path proofs into a job named and owned for entitlements invariants, and that job is **not a required check**, so it would add little protection. The right home is the parked CI-Jest / test-tiering work. See C-B4. |
| **Q-B8** | **Accepted.** The bound lives in the hook; NI-6 / NI-7 prove it with the real hook, and a second timer on every charged action would be redundant. |

#### Conditions

1. **C-B1 (Q-B5).** `actorId` = a UUID-checked platform actor, without importing `aiActionAudit.ts` (it imports the recorder, which imports the hook: a cycle).
   - Add a pure `platformActorUuid()` to `lib/platformAccount.ts`: `SYSTEM_ADMIN_USER_ID` if it is a UUID, else the all-zero id. No logging; the file keeps importing nothing.
   - Use it in the hook.
   - Optionally, `aiActionAudit.ts`'s `platformActorId()` may delegate to it, keeping its one-time warn; behaviour must be identical, with its tests unedited. If Dev does not, record the duplicate as a follow-up.
   - Test: a non-UUID env value gives the all-zero actor.
   - The entry-shape test asserts `actorId` equals that value, never the account.
2. **C-B2.** The hook-point source guard pins:
   - exactly one `checkCreditLowLine(` call in `aiChargeRecorder.ts`;
   - placed after the `!data.recorded` return;
   - inside `if (data.anchorSource === 'plan' && record.credits > 0)`;
   - and the recorder file still names no `supabaseServer`, `.from(` or `.rpc(`.
3. **C-B3.** NI-7's flush-hang case uses fake timers and asserts both that the total delay is ≤ 500 ms + 2,000 ms and that `jest.getTimerCount() === 0` after it settles. Any test that hangs the chain calls `__resetAuditFlushChainForTests` (`logAndFlush`'s chain is module state).
4. **C-B4 (Q-B7).** §5.12 pastes local runs of every suite listed in §5.11 as "not in CI", plus NI-5 before / after. QA re-runs them. Dev adds one line to the parked CI-Jest / test-tiering item naming these four test folders, as the first charge-path tier: `lib/business-os/llm/__tests__/aiChargeRecorder.test.ts`, `aiActionAudit.test.ts`, `lib/business-os/credits/__tests__/`, `lib/audit/__tests__/`.
5. **C-B5 (BD-26).** Hand the coordinator, for the slice 11 owner-hiding fix: the action `BOS_CREDIT_LOW_LINE_CROSSED`, the entity type `'business_os_credit_period'`, and the note that the fix must hide them on both the RLS policy side and the `/api/audit/query` repository side. 8b does not wait for it.

**Business question:** none. BD-26 is already decided (owners do not see these entries); the hiding fix is the slice 11 session's.

- [x] 8b workplan approved — proceed to implementation with C-B1 to C-B5.

### SA Code Review — 8b (2026-10-04)

**Code review by SA — 2026-10-04** (uncommitted diff on `feature/business-os-credit-deduction-slice-8b`, base `89dbc568`; 21 modified and 5 new files; the requirement MD is the coordinator's and was not reviewed; read-only — the gate results are Dev's, §5.12, cross-checked against the source)
**Status:** ✅ Code approved. No required fixes.

#### Verified

| Item | Result |
|---|---|
| **SQ-44 hook point** | `aiChargeRecorder.ts:268-291` holds one awaited call. It sits after the `!data.recorded` return and the existing logs, inside `if (data.anchorSource === 'plan' && record.credits > 0)`, wrapped in `try / catch` (error log, never a throw). It uses the charge's own `periodStart` / `anchorSource`. |
| **Reads** | `creditLowLine.ts:147-189`. Monthly: one `findTotalsForPeriod(account, periodStart, { signal })`, and no anchor read (Q-B1, `:156-159`). Trial: anchor, then `listTotalsFrom` with the ceiling ⇒ fail. A missing row ⇒ anomaly. An unparseable figure ⇒ fail. Allowance comes through `resolveAccountId` → `getSnapshot` → `creditAllowanceForDisplay`. Plan allowance only; lots never read (BD-25, pinned by a source test). |
| **Crossing** | `crossedLowLine` (`:104-115`) runs both sides through 8a's `creditPercentLeft`. `isBelowLowLine` is proved ≡ the red band for every shown value. `usedBefore < 0` or a non-finite value ⇒ `anomaly`. An exact 10.000000% does not fire. |
| **Budget / never throws (FR-50)** | `withReadBudget` (`:199-217`): the timer is `unref`'d and cleared in `finally`, an async IIFE handles a late rejection, and the abort signal reaches both owner reads. The read and write phases are separate, so a late read writes nothing (tested). Every path ends in a debug, a `warn` or the write; the outer `catch` ⇒ warn. |
| **NI-6 / NI-7 / NI-8 with the real hook** | `aiChargeRecorder.test.ts` routes its mocked hook to `jest.requireActual` with injected reads. NI-6: the hook settles at exactly the read budget, with no timer left. NI-7: sync throw, rejection, read failure, and a hanging flush — bounded by ≤ 500 ms + 2,000 ms, no timer left, the chain reset in `beforeEach` / `afterEach` (C-B3). NI-8: 12 "not called" cases plus a timed-out write, and exactly-once with the exact input on the happy path. NI-1 to NI-4: `aiActionAudit.test.ts` +2 / −0 (one mock line). NI-5: identical failing-suite list before and after (§5.12). |
| **C-B2 source guard** | Exactly one `checkCreditLowLine(`, after the `!data.recorded` return, inside the gate with no `}` in between; no `supabaseServer`, `supabaseClient`, `.from(` or `.rpc(` in the recorder. |
| **Worst-case latency** | Holds as stated: ≤ +0.5 s on any charged action with a plan row; ≤ +2.5 s on the crossing charge; no change on every other path. |
| **SQ-46 as corrected (C-B1)** | Key `BOS_CREDIT_LOW_LINE_CROSSED`, metadata `info` with no compliance flags, `'bos'` audience, group "Business OS Credits", entity type `'business_os_credit_period'`, `entityId = userId = account`. `actorId = platformActorUuid()` (`lib/platformAccount.ts`: pure, imports nothing, UUID-checked, all-zero fallback; tests for unset and non-UUID). The writer passes no `severity` (source guard with a planted sample). The details hold ids and figures only. The Pino `info` line comes **before** `logAndFlush` (call-order test). |
| **Registrations** | `creditLowLine.ts` is in `KNOWN_NON_GATE_IMPORTERS` with its exact three symbols. `creditLowLineDeps.ts` is in ALLOWED + `NO_STATE_WRITE_REFERRERS`, pinned to `findPeriodAnchor`. Also registered: `creditFigures` SOURCES, cut-off guard CONSUMERS, the creditPeriod Date-guard scan, and the audience count pin 176 / 31. `test:bos-entitlements` 108 / 2,521 green. |
| **Rule 1 / 4, service role** | Reads go only through the plan repository and the owner read repository (`.eq('user_id', accountId)` in every method). The service-role construction lives only in `creditLowLineDeps.ts`, documented: no session in the charge path, account = `record.accountId` validated by `runAiAction`, SELECT only. The repository header names it as the documented service-role caller, and the file itself still imports no service client. |
| **Rules 2 / 3 / 6** | No new input surface; Pino only, logs carry ids, codes and percentages; no `any`. `tsc`: 0 errors in the 22 changed or new files. |
| **`server-only`** | `creditLowLine.ts` / `creditLowLineDeps.ts` are `server-only`. The recorder already loaded service-role repositories, and no `'use client'` file imports `aiActionAudit` or `aiChargeRecorder` (repo grep: comment mentions only). QA's `next build` is the final check. |
| **No charge SQL change (AC-46)** | No file under `supabase/`; no migration; the charge function, `_charges` and `_totals` are untouched. |
| **Census** | `creditLeakCheck.ac31` runs the real recorder, but its fake RPC refuses the write (`42501`), so the hook is never reached (NI-8's DB-error path). It passes unedited. Accepted. |

#### Deviations

| # | Ruling |
|---|---|
| **DV-B5** | **Accepted.** `chargeService` keeps the N-10 `serviceColumn` guard exact, and the audit detail is still `service: 'ai'`. DV-B3 is moot: the recorder's `service:` assignment guard is unedited. |
| **DV-B6** | **Accepted.** A separate signal suite keeps the existing suite unedited and is still in the CI scope. |
| **DV-B7** | **Accepted as a follow-up.** One rule, two implementations (`aiActionAudit.platformActorId()` caches and warns; `platformActorUuid()` reads at call time). Their outputs agree for every env value. Fold them together when either is next touched. |
| **DV-B8** | **Accepted.** A hook give-up is `warn` (expected, harmless); the recorder catching a throw is `error` (a defect). The same event name with a different level is fine and filterable. |

#### Compatibility with the slice 11 BD-26 fix

The fix is on `fix/bos-owner-audit-hides-admin-entries`, in the `neuronforge-llm-layer2-step4` folder; I read it, without editing. **It is compatible:**
- Migration `20261018_audit_trail_owner_policy_hides_admin_entries.sql` adds `'business_os_credit_period'` to the owner RLS policy's excluded entity types.
- `lib/audit/ownerVisibility.ts` marks it `operator`.
- `AuditTrailRepository` excludes `OWNER_HIDDEN_ENTITY_TYPES` in the query.

So an 8b entry is hidden from the owner by entity type in both places, whatever its action name. **Coordination:** that branch also adds `'business_os_credit_period'` to `AUDIT_ENTITY_TYPES` (`lib/audit/types.ts`, same position, different comment), and both branches edit `creditPeriod.test.ts`. Whichever PR merges second resolves `types.ts` to **one** entry; a duplicate would compile but is a defect. Until the fix merges, KI-25 stands (accepted; no live account is expected to cross, KI-24).

#### Findings

1. **`lib/audit/types.ts:86-90` × the slice 11 branch** — the same entity type is added on both branches; resolve to a single entry at the second merge (RM / coordinator). Priority: **Low (coordination)**.
2. **`lib/business-os/credits/creditLowLine.ts:299`** — `entityType: 'business_os_credit_period'` is a typed literal, so it is checked against `EntityType`. No change. Priority: **Note**.

**Required fixes:** none.
**Owed by QA:** `next build`; the forced-crossing manual check (one row under "Business OS Credits", actor = platform account, the next action none); a re-run of the §5.11 suites. **Owed by the user after merge:** the 11a checker L8 / C7 on PROD (read-only).
**Business question:** none.

**Code approved for QA: Yes.**

---

## QA Testing Report

*(QA populates.)*

### QA Report (2026-10-03) — slice 8a

**QA — 2026-10-03**
**Test mode:** full
**Strategy used:** A (Jest, unit + render), B (route suites with mocked repositories), C (read-only live script against PROD with the production deps), plus `next build` and an unauthenticated probe against `next dev`. D (signed-in browser check) is **not done**: QA does not sign in with real credentials. It is listed below as owed by the user.
**Focus:** all (api, ui, schema, security, performance)
**Skipped:** signed-in visual check (owed, see below). No DB writes, no migration, no commit.
**Input source:** prompt from the coordinator, plus workplan §7 and SA condition 5.
**Tree:** `feature/business-os-credit-deduction-slice-8` in `neuronforge-llm-deduction`, uncommitted. `git status` shows the same 38 entries before and after QA, so QA added no file to the repo. QA's scratch files live only in the session scratchpad.

#### Verdict: PASS WITH NOTES

No bugs. Every gate is green, `next build` exits 0, and the live check shows the card % equal to the admin % on every account tested. The notes are SA's two Low findings, which QA concurs with, and the manual checks the user still owes.

#### Gates (re-run independently)

| Gate | Result |
|---|---|
| `npm run test:bos-entitlements` | ✅ 105 / 105 suites, 2,407 / 2,407 tests |
| Touched / new suites: `lib/business-os/credits`, the two repository suites, the three `UsageCard*` suites, `app/admin/users`, `app/api/admin/users`, `app/api/business-os/usage` | ✅ 41 / 41 suites, 965 / 965 tests (includes `creditBands`, `creditBands.guard`, `creditWindowRule`, `adminCreditPercent`, `creditPeriod`, `ownerCreditSurface.guard`, `route.creditsLeft`, `creditsLeftCell`, `source.guard`, `defaultFilter`) |
| C-W5 owner suites unedited | ✅ `git diff --stat` is empty on `ownerCreditUsage.test.ts`, `.crossCheck`, `.payload`, `ownerCreditHistory.test.ts` and `app/api/business-os/usage/__tests__/route.credits.test.ts`. All five pass |
| `npm run lint:hooks` | ✅ exit 0 (`--max-warnings 0`) |
| `npx eslint` on the 34 changed or new `.ts` / `.tsx` files | ✅ 0 errors, 14 warnings, all pre-existing (unused icons, `any` and exhaustive-deps in `page.tsx`; `currencyInitialized` in `LanguageContext.tsx`; the `any` stubs in the plan-repository test) |
| `npx next build` (`NODE_OPTIONS=--max-old-space-size=6144`, run in place on the existing junction; no new folder, no copy) | ✅ **exit 0**. "Compiled successfully", 307 / 307 static pages, and `/admin/users` and `/api/admin/users` are both built as dynamic (ƒ). The log has 64 `DYNAMIC_SERVER_USAGE` lines. These are pre-existing static-generation noise across admin pages: `requireAdminPage` / admin APIs read cookies at build time. The build skips its own lint and type steps (existing `next.config.js`); `tsc` was baselined by Dev (§4.15). `.next/` existed before the build, so QA left it in place |
| Dictionary | `usage.less_than_percent`, `usage.sr.monthly`, `usage.sr.trial` and `usage.sr.plain` each appear exactly 3 times (en / es / he). `usage.of` and `usage.of_total` appear 0 times. No product file still names `credits-of`, `data-low`, `usage.of` or `LOW_THRESHOLD` |

#### Live read-only check (SA condition 5, AC-43)

Script `qa8-live.ts` (scratchpad, service-role SELECTs only). It takes every account that has `business_os_credit_totals` rows (6 on PROD). For each one it computes:
- **the card's %**: `readOwnerCreditUsage` with the production `ownerCreditUsageDeps`, then `creditPercentLeft(used, allowance)`, exactly as `UsageCard` does;
- **the admin %**: `readAdminCreditsLeft` with the production `adminCreditPercentDeps()` and the real `getSnapshots`.

Then it compares the two.

**Real allowances.** Admin pass outcome `ok`, **6 / 6 equal**:

| Account | Period | Allowance | Used | Card | Admin | Band |
|---|---|---|---|---|---|---|
| Avital Omer | monthly | 32,250 / month | 297.75474 | 99% | 99% | plenty (green) |
| Offir Omer | monthly | 32,250 / month | 3.6741 | 99% | 99% | plenty |
| Eyal Omer | monthly | 32,250 / month | 2.0196 | 99% | 99% | plenty |
| Barak Meiri | monthly | 32,250 / month | 2.42385 | 99% | 99% | plenty |
| David KPMG | monthly | 32,250 / month | 2.39235 | 99% | 99% | plenty |
| (unnamed, `2f734ed5…`) | monthly | 32,250 / month | 1.5645 | 99% | 99% | plenty |

All six read 99%, as KI-24 predicts, so this check alone cannot tell the two paths apart. To make it **discriminating**, QA re-ran it with the **allowance value swapped in memory only** on both sides. Nothing was written. Both sides still read the real anchors, the real ledger rows, and the real period and window logic: the owner side through `readAllowance`, the admin side through a `getSnapshots` wrapper that rewrites `credits.allowance` in a cloned real snapshot. All runs had outcome `ok` and **24 / 24 equal**:

| Override | Avital | Offir | Eyal | Barak | David | 2f734ed5 |
|---|---|---|---|---|---|---|
| 5 / month | 0% red (over) | 26% orange | 59% blue | 51% blue | 52% blue | 68% green |
| 300 / month | less than 1% red | 98% green | 99% | 99% | 99% | 99% |
| 5 total (trial) | 0% red, trial | 26% orange, trial | 59% blue, trial | 51%, trial | 52%, trial | 68%, trial |
| 400 total (trial) | 25% orange, trial | 99%, trial | 99% | 99% | 99% | 99% |

So the two paths agree on every band, on "less than 1%", on 0% over the allowance, and on the trial flag and trial sum.

#### Edge cases

| Case | How | Result |
|---|---|---|
| Rounding down at the boundaries: exactly 60 → 60 green; 59.999999 → 59 blue; exactly 30 → 30 blue; 29.9999 → 29 orange; **exactly 10.0 → 10 orange; 9.99 → 9 red**; 1.0 → 1 red | `creditBands.test.ts` table + sweep; QA probe `qa8-edges.ts` | ✅ |
| 100% only when nothing used: used 0 → 100; used 0.000001 → **99** | test + probe | ✅ |
| "less than 1%": 0.999% left and one micro-credit left → `less_than_one`, red | test + probe | ✅ |
| 0% at and over the allowance: band `below_line`, share 0, no arc, track drawn in `#EF4444` | test (`UsageCard.percent.render`) + probe | ✅ |
| Trial (% of 2,000): 0.5 used → 99; 1,800 used → 10 orange; 1,800.000001 used → 9 red | test + probe | ✅ |
| No allowance: null / 0 / NaN allowance, NaN used, 1e9 allowance (unsafe) → `null` (card ungauged, admin "Unknown") | test + probe | ✅ |
| Admin "Unknown" on a failed read or timeout, list still 200; the route logs `creditsPass: 'timeout'` | `route.creditsLeft.test.ts:222`, `:239`; `adminCreditPercent.test.ts:275` (late results ignored, timer cleared) | ✅ |
| "—" for a row with no business; no `creditsLeft` key on those rows; "Unknown" when the business lookup failed | route + cell tests; code read of `CreditsLeftCell.tsx:40-47` | ✅ |
| Call count 1 / 100 / 101 accounts → 1·1·1 / 1·1·1 / 2·2·1 | `route.creditsLeft.test.ts:258` | ✅ |
| No cost, token, count or dollar key in the payload; `creditsLeft` keys ⊆ `{kind, value, trial}` | `route.creditsLeft.test.ts:281` | ✅ |
| 401 / 403: the pass is never called | `route.creditsLeft.test.ts:163` | ✅ |
| Colours match the band module | the cell uses `bandColor(bandFor(shown))`; the card uses `bandColor(position.band)`; the guard pins one definition | ✅ |
| RTL he: `Intl` he gives "64%" / "1%"; the strings use `{percent}` | probe | ✅ by reasoning; visual check owed |
| es "menos del 1 %": `Intl` es gives "1 %" (the formatter's own space, never a typed one); the string is about 13 characters at 15 px in a 104 px max-width box that is allowed to wrap | reasoning | ⚠️ should fit on one line or wrap to two inside the 156 px ring; **visual check owed** (jsdom cannot measure) |

#### Unauthenticated probe (`next dev -p 3000`, stopped afterwards)

- `GET /api/admin/users` → **401** `{"success":false,"error":"Unauthorized"}` (40 bytes, no data). With `?search=a` → also **401**.
- No `creditsPass` log line was emitted, so the pass never ran.
- `GET /admin/users` → a streamed `NEXT_REDIRECT;replace;/business-os;307`. The response contains no "Credits left" markup and no data.

#### Issues found

**Bugs:** none.

**Performance:** none observed. The pass is bounded at 2 s and grows by chunk, not by row (pinned by test).

**Edge cases (nice to fix, Low). QA concurs with SA's two findings and adds nothing new:**
1. **SA finding 1: `creditsMs` is not the credits pass's own time** (`app/api/admin/users/route.ts:190`, `:198`). QA found this independently. Because it is measured after the `Promise.all`, a slow `listUsers` inflates it. The helper's own `info` / `warn` line carries the true `ms`, so the §4.8 scale trigger must be read from that line. Low (observability only).
2. **SA finding 2:** `isAtOrAfter` is used as an anchor-vs-cutoff comparison at `adminCreditPercent.ts:165`. The behaviour is correct (QA's live trial runs pass); the issue is documentation only. Low.

#### Owed manual checks (user, signed in)

1. **Card visual, en / he / es.** Check the "NN%" headline, the ring colour, "left" under it, no "of N" line, and the tooltip unchanged. In **he**, check RTL layout and the placement of the "%". Today every account reads 99% green (KI-24).
2. **"less than 1%" / "פחות מ־1%" / "menos del 1 %" fit inside the 156 px ring at 15 px** (R-2). This needs a test account forced near its allowance (a temporary override) or a mocked payload.
3. **`/admin/users` as an admin.** Check the "Credits left" column sits after "Business / user"; Business OS rows show a green dot plus "99%"; non-Business OS rows show "—"; the expanded row and the empty state span all 7 columns. Equality with the card is already proven live (above).
4. **Native review of the he / es strings** (release precondition, R-7).

#### Final status

- [x] All 8a acceptance criteria QA can test pass (AC-40 to AC-43 by test and live check). AC-44 belongs to 8b, not this PR. The signed-in visual checks above are owed by the user.
- [x] No High or Medium bug open. This is ready for the user's diff review once Dev lands SA's two Low fixes; those fixes need only the diff check.

### QA Report — 8b (2026-10-04)

**Test mode:** full
**Strategy used:** A (Jest: every §5.11 not-in-CI suite plus the CI gates, re-run independently) + C (a scratch script driving the real `checkCreditLowLine` with the production deps against the live DB, **read-only**). The script wrapped `supabaseServer` so `insert` / `update` / `upsert` / `delete` / `rpc` throw. It stubbed `logAndFlush` to capture entries, stubbed `AuditTrailService` to write nothing, and swapped only the allowance amount in memory (a wrapper around the real `creditAllowanceForDisplay`, after the real snapshot read). Plus an in-place `next build`. No browser check: the signed-in, write-producing check is owed (below).
**Focus:** api, pipeline (the charge path), security (actor, entity, scoping), performance (the time budget)
**Skipped:** the live crossing that **writes** an audit row (needs a DB write; owed to the user). Also the signed-in `/admin/audit-trail` view of that row.
**Input source:** prompt keywords (coordinator) + workplan §5.8 / §5.9 / §5.11

**Branch / tree:** `feature/business-os-credit-deduction-slice-8b`, uncommitted. 21 modified + 5 new files. `git diff --numstat`: no deletion without insertion. `aiChargeRecorder.test.ts` is **+230 / −0**, so the 37 existing bodies are unedited. `aiActionAudit.test.ts` is **+2 / −0** (the mock line and its comment). `git diff origin/main -- supabase/ scripts/` is empty (AC-46).

#### Gates (re-run by QA)

| Gate | Result |
|---|---|
| `npm run test:bos-entitlements` (CI) | ✅ 108 / 108 suites, 2,521 / 2,521 tests |
| `npm run typecheck:bos-llm` (CI) | ✅ passed. 398 files, 28 errors, **0 new**. The same "1 baseline entry fixed" note (`app/api/onboarding/build/route.ts`) is not 8b's |
| `npm run lint:hooks` (CI) | ✅ exit 0 |
| `npx eslint` on the 22 changed / new TS files | 0 errors; 6 warnings, all pre-existing (`events.ts:1239`, `types.ts` × 5 `any`) |
| **`next build`** (in place, existing junction, `NODE_OPTIONS=--max-old-space-size=6144`) | ✅ **exit 0**. "Compiled successfully". The only error-level lines are the known "Dynamic server usage" noise from page-data collection on admin pages and crons, not 8b's. `bos_credit_low_line_crossed` appears in **1** `.next/server` chunk and **0** `.next/static` (client) files. So `server-only` in `creditLowLine.ts` / `creditLowLineDeps.ts` reaches no client bundle. `.next` was rebuilt in place, with no new folder |

**§5.11 suites not run in CI, re-run locally** (stub Supabase URL, so no DB)

| Suite | Result |
|---|---|
| Combined `lib/business-os/credits lib/business-os/llm lib/audit lib/__tests__/platformAccount.test.ts app/admin/audit-trail` | ✅ **72 / 72 suites, 1,563 / 1,563 tests** (matches §5.12) |
| `creditLowLine.test.ts` | ✅ 51 / 51 |
| `aiChargeRecorder.test.ts` (NI-6 / NI-7 / NI-8, C-B2, C-B3) | ✅ 60 / 60 |
| `aiActionAudit.test.ts` (NI-1 to NI-4, unedited bodies) | ✅ 85 / 85 |
| `creditLowLineSeverity.guard.test.ts` | ✅ 5 / 5 |
| `eventAudience.test.ts` (176 / 31 / 61 / 84) | ✅ 21 / 21 |
| `platformAccount.test.ts` | ✅ 13 / 13 |
| `creditBands.guard` / `creditPeriod` / `serviceColumn.guard` | ✅ 55 / 34 / 34 |
| Same key suites with `--detectOpenHandles` | No open handle reported, none hung |

#### Simulated crossing: live reads, no writes (C)

Accounts read: Eyal, Offir and Avital Omer. Each has a real allowance of 32,250 / month and one period, `2026-09-23T19:55:01.28632+00:00`. Totals are 6.82815 / 4.17345 / 298.59084. The cases ran on **Eyal Omer** (`39c134b8…`), U = 6.82815. Every case read the real period key verbatim and the real totals row. `blockedWrites = []` and `AuditTrailService` calls `= []` in **every** run, so nothing was written.

| Case | Allowance (in memory) | Charge | Shown % before → after | Reads | Entries | Log |
|---|---|---|---|---|---|---|
| (a) monthly crossing | 7.187526 / month | 0.718753 | 15 → 4 | `business_os_credit_totals` × 1 | **1** | info `bos_credit_low_line_crossed` |
| (b) next charge, same period | 7.187526 / month | 0.143751 | 7 → 4 | totals × 1 | **0** | debug `already_below` |
| (c1) stays at or above the line | 13.6563 / month | 0.136563 | 51 → 50 | totals × 1 | **0** | debug `still_above` |
| (c2) starts below the line | 6.967500 / month | 0.069675 | 3 → 2 | totals × 1 | **0** | debug `already_below` |
| (c3) 15 → 9 (QA aimed at exactly 10; float rounding landed on 9, which is a correct crossing) | 7.586833 / month | 0.379342 | 15 → 9 | totals × 1 | 1 | info `crossed` |
| (d1) trial crossing | 7.187526 **total** | 0.718753 | 15 → 4 | `business_os_account_plans` (anchor) + totals (`listTotalsFrom(anchor)`) | **1**, `periodKind: 'trial_total'` | info `crossed` |
| (d2) trial, next charge | 7.187526 total | 0.143751 | 7 → 4 | anchor + totals | **0** | `already_below` |
| (d3) trial, stays above | 13.6563 total | 1 | above → above | anchor + totals | **0** | `still_above` |
| (real) real allowance, no swap | 32,250 / month | 1 | 99 → 99 | totals × 1 | **0** | `still_above` (KI-24) |
| (e1) `calendar_month` | — | 0.718753 | — | **none**, 0 snapshot calls | 0 | debug `skipped` / `not_applicable` |
| (e2–e4) credits 0 / −1 / NaN | — | — | — | **none**, 0 snapshot calls | 0 | debug `skipped` |
| (f) allowance answers at **700 ms** with a crossing value | 7.187526 / month (late) | 0.718753 | — | none inside the budget | **0**, and still **0 after waiting 2.5 s more** | one warn `timeout`, no second log |

**The entry, from cases (a), (c3) and (d1).** `action` is `BOS_CREDIT_LOW_LINE_CROSSED` and `entityType` is `business_os_credit_period`. `entityId` and `userId` are the account. `actorId === platformActorUuid()`, never the account; the env value in `.env.local` is a UUID, so it is the configured platform id. There is **no `severity` key** and no `resourceName`. The details keys are exactly `actionId, actionType, allowance, lowLine, percentAfter, percentBefore, periodKind, periodStart, service, trigger`, with `service: 'ai'`, `lowLine: 10` and `periodStart` verbatim. No cost, token or used-credit field. The Pino `info` came before the stubbed flush.

**Timers.** Active `Timeout` handles were 0 before and 0 after every case. In (f), 1 handle remained right after return: QA's own 700 ms stub sleep, not the hook's. It was 0 after the wait.

#### Latency (4)

- **By test (fake timers), as required:** NI-6 (`aiChargeRecorder.test.ts:540-561`) stays unsettled at 499 ms and resolves at 500 ms, with `getTimerCount() === 0`, for a hanging allowance read and a hanging totals read. C-B3 (`:589-609`) holds a hanging flush to ≤ 500 + 2,000 ms, with one entry handed to `AuditTrail.log`, one warn, and 0 timers. `creditLowLine.test.ts` pins `getTimerCount() === 0` at `:298`, `:389` and `:439`. **Worst cases: +0.5 s on any charged plan action, +2.5 s on the crossing charge. Confirmed.** C-B3's reads resolve at once, so it measures about 2.0 s, not the full 2.5 s. The 2.5 s worst case follows from the two sequential bounds, not from a single test.
- **Live, from this machine (informational):** warm monthly checks took **180–260 ms**, and warm trial checks took **360–420 ms** (2 round trips). A **cold** process timed out every time: the first snapshot plus the first totals read took more than 500 ms. With the CPU at 100% from an unrelated Jest run, the race came back at **514–975 ms** rather than 500, because of event-loop starvation; under fake timers the bound is exact. In every timeout: no entry, one `timeout` warn, nothing thrown.

#### Issues found

**Bugs:** none.

**Performance (should look at, not blocking):**
1. **A read timeout on the crossing charge loses that period's entry for good, and leaves no figures in the logs.** `lib/business-os/credits/creditLowLine.ts:236-240`. "Once" is derived, so the next charge starts below the line and never fires (case b). The only trace is a `bos_credit_low_line_check_failed` / `timeout` warn with ids and no percentages. KI-23 covers a lost **flush**, where the Pino `crossed` line survives. It does not cover a lost **read**, where nothing records the crossing. From this dev machine, cold reads exceeded 500 ms every time. On Vercel near the DB, latency should be far lower, but cold instances pay a TLS handshake. Severity Medium as a data-completeness risk, though no action or charge is affected (FR-50 holds). Suggest: record it as a KI, or extend KI-23 in the requirement. After merge, watch the rate of `bos_credit_low_line_check_failed` `reason: timeout` in the Vercel logs. SA owns any budget change.

**Edge cases (nice to fix, Low):**
1. **Work continues after the budget.** `creditLowLine.ts:147-188`: `readFigures` does not check `signal.aborted` between steps. In (f), a late allowance answer still went on to call `findTotalsForPeriod` (with the already-aborted signal, so the request was cancelled at once). On the trial path, a late snapshot would go on to an **un-cancellable** `findPeriodAnchor` read. No write happens and the result is discarded (Q-B3, accepted), but one `if (signal.aborted) return …` after each await would avoid the wasted background reads.
2. **DV-B7 follow-up stands:** there are two implementations of the platform-actor rule (`platformActorUuid()` and `aiActionAudit.ts` `platformActorId()`). Behaviour is identical today.

#### AC coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-44: one entry on the crossing; none on the next charge, none when starting below; trial once | ✅ | Pass (unit + live-read simulation) | The **written** row on PROD is owed (below) |
| AC-45: read fail / throw / hang does not harm the action; bounded; NI-1 to NI-5 unedited; never on recorded:false and the like | ✅ | Pass | NI-6/7/8 green. `aiActionAudit.test.ts` +2/−0. Recorder bodies unedited |
| AC-46: no SQL / migration change | ✅ | Pass | No `supabase/` diff. The L8 / C7 re-check is owed after merge |
| FR-49 entry shape (SQ-46, C-B1) | ✅ | Pass | Actor = platform UUID, no severity, exact detail keys |
| `server-only` stays out of client bundles | ✅ | Pass | `next build` exit 0, 0 hits in `.next/static` |

#### Owed (needs the user's approval, or happens naturally)

1. **A real crossing on PROD that writes one audit row.** On a **test** account, add a temporary entitlement override that brings the allowance just above `used / 0.9`. Then run one owner AI action, and expect **exactly one** `BOS_CREDIT_LOW_LINE_CROSSED` row in `/admin/audit-trail` under the **"Business OS Credits"** group, with **actor = the platform account** (not the owner) and the §5.5 details. A second action should write none, and both actions should return normally. Then remove the override. This writes a charge, a totals change and an audit row, so QA did not do it. It may also happen naturally once usage is real (KI-24). Note BD-26 / KI-25: until the slice 11 owner-read exclusion lands, the owner can read that row.
2. **After merge, the user's read-only `scripts/check-bos-credit-lots-migration.sql` L8 (charge-function md5) and C7 on PROD.** Both should pass unchanged, since 8b changes no SQL.
3. (Optional) **After deploy:** the rate of `bos_credit_low_line_check_failed` `reason: timeout` in the Vercel logs (Performance 1).

#### Final status

- [x] Every 8b acceptance criterion QA can test without a DB write passes. The live written row and the post-merge L8 / C7 re-check are owed.
- [x] No High bug and no bug at all. One Medium performance / data-completeness note, which needs a KI or SA decision rather than a code fix before commit, and two Low edge cases. **PASS WITH NOTES.**

---

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-03 | Created | Dev workplan for slice 8a (card %, `creditBands.ts`, admin "Credits left" column) with an 8b outline; answers SA slice 8 condition 3 in §4.13; estimate ≈ 2.2 d; Q-1 to Q-12 for SA |
| 2026-10-03 | SA Workplan Review | Approved with conditions: DV-1 to DV-4 accepted; Q-1 to Q-6 and Q-10 ruled; error-line colour is a follow-up; C-W1 (narrow the cut-off guard scope — false positives in `components/business-os/insight/*`) to C-W5; branch sync to `5061489b` verified (page.tsx slice line now `:681`) |
| 2026-10-03 | SA conditions folded (Dev) | C-W1 to C-W5, DV-1 title note, Q rulings and `ERROR_INK` folded into §4.0, §2, §4.3, §4.8–4.10, T-12; 8a implementation started |
| 2026-10-03 | SA Code Review | Code approved for QA. DV-1 addendum and DV-5 to DV-7 accepted; the empty-list refusal is accepted; two Low findings (route `creditsMs` measures the parallel block; `isAtOrAfter` used outside its documented role); wider-Jest reds unrelated |
| 2026-10-03 | 8a Code Complete (Dev) | T-0 to T-12 done; §4.15 gate results (C-W5) and DV-1 addendum, DV-5 to DV-7; `next build` owed; awaiting SA code review ∥ QA |
| 2026-10-03 | QA Report (8a) | PASS WITH NOTES. Gates re-run green (bos-entitlements 105/2,407; touched suites 41/965; lint:hooks; eslint 0 errors); `next build` exit 0; live read-only check: card % equals admin % on 6/6 accounts (all 99%), and on 24/24 with in-memory allowance overrides covering every band, less than 1%, 0% and trial; unauthenticated `GET /api/admin/users` returns 401. QA concurs with SA's two Low findings; signed-in en/he/es visual checks owed |
| 2026-10-04 | SA Workplan Review — 8b | Approved with conditions: DV-B1 to DV-B4 accepted; Q-B1 to Q-B4 and Q-B6 to Q-B8 accepted (Q-B7: CI scope unchanged, gap recorded in the CI tiering item); **Q-B5 changes SQ-46 — the actor is a UUID-checked platform actor** (a non-UUID would fail the whole flushed batch); C-B1 to C-B5; facts B-F1 to B-F16 and the worst-case latency (+0.5 s / +2.5 s) confirmed at `89dbc568` |
| 2026-10-04 | 8b workplan (Dev) | §5 expanded from the outline into the full 8b plan on `feature/business-os-credit-deduction-slice-8b` (base `89dbc568`, 8a merged): as-built facts B-F1 to B-F16, hook module + deps, crossing on the shown % via 8a's `creditPercentLeft`, 500 ms read budget with a separate write phase, `BOS_CREDIT_LOW_LINE_CROSSED` + entity type `business_os_credit_period`, NI-6 to NI-8, registrations, CI coverage gaps (§5.11), DV-B1 to DV-B4, Q-B1 to Q-B8, R-B1 to R-B7; estimate ≈ 1.4 d; no migration; `console.*` none. Awaiting SA workplan review |
| 2026-10-04 | 8b Code Complete (Dev) | C-B1 to C-B5 and Q-B rulings folded (§5.0a); B-0 to B-7 done: `creditLowLine.ts` + deps, `platformActorUuid()`, owner-repository signal, event `BOS_CREDIT_LOW_LINE_CROSSED` + entity type, recorder hook, NI-6 to NI-8, registrations, docs. Gates in §5.12: bos-entitlements 108 / 2,521; local non-CI suites 72 / 1,563; NI-5 failing-suite list identical (26); typecheck:bos-llm 0 new; DV-B5 to DV-B8. Uncommitted; `next build` owed by QA |
| 2026-10-04 | SA Code Review — 8b | Code approved for QA, no required fixes. C-B1 to C-B5 and SQ-44 to SQ-46 (actor as corrected) verified; NI-6 to NI-8 with the real hook; DV-B5 to DV-B8 accepted (DV-B7 a follow-up); slice 11 BD-26 fix compatible (hides `business_os_credit_period` by entity type in RLS and the repository) — coordinate the duplicate `AUDIT_ENTITY_TYPES` line at the second merge |
