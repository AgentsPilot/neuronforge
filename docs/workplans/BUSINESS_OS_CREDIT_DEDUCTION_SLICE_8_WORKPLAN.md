# Workplan: Business OS credit deduction — slice 8, credits as a percentage, one colour-band config, and the admin "Credits left" column (8a); low-line audit record (8b, outline)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §12 "Slice 8 — Credits shown as a percentage, colour bands, and a low-credit audit record" and "Slice 8 scoping (BA, 2026-10-02)", FR-46 to FR-50, AC-40 to AC-46, §13 BD-18 to BD-25 (**all decided**: BD-20 whole %, rounded down, 100% only when nothing used, "less than 1%" below 1, 0% at or over; BD-24 explanation sentence unchanged; BD-25 plan allowance only), §14 SQ-39 to SQ-47 (ruled), KI-21 to KI-25, and **"SA review — slice 8 scoping (2026-10-02)"** (binding; its condition 3 is answered item by item in §4.13)
**Previous slice:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_7_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_7_WORKPLAN.md) (the window function this slice reuses)
**Worktree:** `neuronforge-llm-deduction`
**Branch:** `feature/business-os-credit-deduction-slice-8` (confirmed with `git branch --show-current`; base `origin/main` `9a7c4fb3`). **Fast-forwarded by RM to `origin/main` `5061489b`** (admin cleanup 5a #177, admin header #178, slice 11b #179, #180) before code — R-1 / Q-11 closed (SA C-W2). 8b gets its own branch from RM after 8a merges.
**Date:** 2026-10-03
**Status:** 8a **Code Complete** — awaiting SA code review ∥ QA (uncommitted on the branch; evidence §4.15). SA workplan review ✅ approved with conditions 2026-10-03 (C-W1 to C-W5 folded in §4.0). 8b outline only, not started. *(Previous status, superseded: 8a In Progress.)*

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
- [5. Part 8b — outline](#5-part-8b--outline)
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

## 5. Part 8b — outline

*(Detailed in its own workplan section after 8a merges; full path. SA's rulings SQ-44 to SQ-46 and condition 4 are binding.)*

| # | Task | Estimate |
|---|---|---|
| B-1 | `lib/business-os/credits/creditLowLine.ts` (+ `creditLowLineDeps.ts`): `crossedLowLine(usedBefore, usedAfter, allowance)` via `creditPercentLeft` and `LOW_LINE_PERCENT` ("shown ≥ 10 before, < 10 after"); `checkCreditLowLine(...)` using the charge's own `periodStart` / `anchorSource`: `calendar_month` or `credits ≤ 0` → return with **zero reads**; allowance via cached `getSnapshot`, null → return; monthly → one `findTotalsForPeriod(account, periodStart)`; trial → anchor + `listTotalsFrom`; `usedBefore = roundToLedger(usedAfter − roundToLedger(credits))`; owner read repository on the service-role client, explicit and documented (S11-SQ-9 pattern); **500 ms read budget**, `unref`'d and cleared; optional `signal` on the two owner-repository reads | 0.4 d |
| B-2 | Hook in `aiChargeRecorder.ts` `write()` after the `!data.recorded` return and the existing logs: one bounded **awaited** call in `try / catch`; recorder and `runAiAction` header comments updated to the new bound | 0.15 d |
| B-3 | Audit: `AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED`, `'bos'` in `eventAudience.ts`, registered severity `info` (the writer passes **no** severity — pinned); new entity type `'business_os_credit_period'` in `AUDIT_ENTITY_TYPES`; `entityId = userId = account`, `actorId` null; details per SQ-46; Pino `info` (`event: 'bos_credit_low_line_crossed'`) **before** `logAndFlush` (own 2 s bound after the read budget) | 0.25 d |
| B-4 | Tests: AC-44 cases as unit tests; **NI-6** (reads hang → delay ≤ read budget, no timer left), **NI-7** (hook throws / rejects / flush hangs → same value or error, one log, bounded delay), **NI-8** (never called on `recorded: false`, timed-out write, DB error, skipped / uncharged action, `calendar_month`); `aiActionAudit.test.ts` gains **one module-level `jest.mock` line** of the hook module (NI-1 to NI-4 bodies unedited); NI-5 re-run (whole-suite pass set identical) | 0.35 d |
| B-5 | Registrations: `creditLowLine.ts` as the second non-gate importer (`getEntitlementService`, `resolveAccountId`, `creditAllowanceForDisplay` as used); the cut-off guard's consumer list gains it; `creditFigures` `SOURCES`; `npm run test:bos-entitlements` | 0.1 d |
| B-6 | Docs; QA: forced crossing on a test account (temporary override lowering the allowance) → exactly one entry in the admin audit trail's Business OS dropdown, the next action none; user re-runs the 11a checker L8 / C7 on PROD (read-only) after merge | 0.1–0.25 d |
| | **Total 8b** | **≈ 1.35–1.5 d** (SA: 1.25–1.6 d) |

Worst case added to an action: ≤ 0.5 s on any charged action, ≤ 2.5 s on the one crossing charge. No migration (SQ-45); KI-21 / KI-22 (extended) / KI-25 accepted.

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
