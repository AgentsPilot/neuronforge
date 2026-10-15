# Workplan: Business OS Finance & Business Health — Money M-4 (two measures, one vocabulary)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers Money **M-4**:
- §11F.1 to §11F.10 (AC-150 to AC-168);
- §13 checks 21 and 22;
- "SA Requirement Review — M-4 (§11F) — 2026-10-15" (findings F-1 to F-9, edits E-53 to E-57);
- §0.3 SA-Q51 to SA-Q57 and SA-RR-M4;
- the consolidation review's §6 (two names) ([ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md)).

**Decisions in force:**
- BD-12 (no FX; both measures are USD by construction, nothing to convert).
- BD-18 (the business AI cost figure is the **charged** cost; the recorded cost is shown beside it and **never added**).
- BD-21 / BD-24 (the Money section and the move of Costs & credits are M-5, not here).
- BD-27 (keep the Health tile, renamed "Recorded AI cost"; its link to Finance is text now, a real link in M-5, SA-Q55).

**Builds on:** slices 1a to 6a, all on `main` at `b20da2cc` (M-1/M-2 = PR #383, M-3 = PR #392). See the [6a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md) and the [6a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_RETROSPECTIVE.md).

**SA rulings implemented:**
- SA-Q51: the vocabulary guard scans string literals and JSX text only; fixed phrase list; per-file non-vacuity count; planted control; an explicit allow-list with a reason.
- SA-Q52: the route passes `end` less 1 ms to both reused reads; the route test asserts the exact ISO value.
- SA-Q53: the one-account read is raced against the deadline only; a late result is dropped and never rejects unhandled (E-57).
- SA-Q54: an optional `aiCost.recorded` object; no field holds a sum of the two measures.
- SA-Q55: the Health footnote names Finance in text only.
- SA-Q56: a difference of two measures, named "Recorded above charged" (E-54), not a per-call match.
- SA-Q57: two PRs under this one workplan. **Part A (OV-1) ships first, on the short path for copy. Part B (OV-5) is built only after Part A's PR merges, on the full cycle.**
- E-53 (exactness per read), E-55 (the AC-145 baseline is updated once, in Part B), E-56 (AC-167, AC-168), E-57 (race rule), F-7 (full caller list in `TokenUsageRepository`'s header).

**Still in force (from earlier slices):**
- SA-W1 / AC-42: the picked view makes no platform-wide read.
- SA-W22 / SA-WR-4: builders are pure, with structural input types.
- SA-WR-3: spies at the repository boundary.
- SA-WR-7: scratch tsconfig outside the worktree, with a canary.
- SA-WR-18 / M1-FR-6: the page never adds or subtracts money.
- SA-WR-44: the AC-145 Overview baseline; edited **only** under E-55 (Part B), exactly once.
- 6a retro conclusion 6: Dev writes "see the QA report" for the live steps and numbers none of its own.

**Date:** 2026-10-15
**Branch:** `feature/bos-money-m4`. RM cut it from `main` `b20da2cc`. I confirmed it with `git branch --show-current` in worktree `neuronforge-finance-health`. `node_modules` is a junction to the main checkout, so:
- never run `git worktree remove`, `git stash` or `npm install`;
- never commit (RM commits; Part A after SA + QA + the user's diff view, Part B after the full cycle).

The worktree already holds BA's uncommitted edits to `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` and `docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md`. Dev does not edit either; TL records this workplan's link.

**Status:** Planning. Awaiting SA workplan review of **both parts** (SA-W90 to SA-W104). No code written.

## Overview

M-4 answers "what did AI cost us, and how much of it did we not charge for?" For October 2026 (to 2026-10-15) the live answer is: charged AI cost USD 1.61, recorded AI cost USD 1.94, recorded above charged USD 0.33 (§11F.1).

It ships as **two PRs**:

| Part | What | Cycle | Estimate |
|---|---|---|---|
| **A — OV-1** | Copy only. Every admin AI cost figure is called **"Charged AI cost"** (credit ledger) or **"Recorded AI cost"** (usage log): W-1 to W-25 on Finance, AI cost & usage, Business OS AI (Costs & credits, Leak check, Activity), the Health tile and the Businesses drawer. One new Jest guard over visible strings (SA-Q51). No figure, read, payload field, link target, URL key, `data-testid`, Health rule id or metric changes (V-5) | Short path for copy: SA review + QA, then the user's diff view, then RM | About **1 day** |
| **B — OV-5** | Finance Section 3 shows **"Recorded AI cost (USD)"** and **"Recorded above charged (USD)"** beside the charged total, for the window and for one picked business; the M-1 account summary shows the second line. Two **reused** reads injected by the route; one new pure builder; nothing ever added to the charged figure | Full cycle; built only after Part A merges | About **2 days** |

**What M-4 leaves out:** no migration, no SQL function, no new table, no write, no LLM call, no audit entry, **no new repository method**, no new query parameter, no KPI tile, no Accounts tab change, no sidebar change (M-5), no entitlements import and no tier literal.

**Fifteen points need an SA ruling before code** ([Questions for SA](#questions-for-sa-before-code), SA-W90 to SA-W104). Eight are places where the requirement does not fit the code:
- SA-W90: W-3's new two-sentence source text is joined to the window label with a comma.
- SA-W91: a fourth ledger "Cost (USD)" label in Activity is not in W-18.
- SA-W92: the drawer box's purpose line still says "Estimated cost".
- SA-W93: the M-1 cut-over note names the old Section 3 title.
- SA-W98: Section 3 hides its figures before the cut-over and on Unknown, but R4-5 shows the recorded figure there.
- SA-W99: the Leak check takes its business from the Costs tab's `account` key.
- SA-W103: one finance file names `TokenUsageRepository` in a comment.
- SA-W104: the deps wiring's `Omit<>` must grow, in a file registered with the entitlements guard.

None reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [PART A — OV-1, copy only](#part-a--ov-1-copy-only)
  - [A.1 Files](#a1-files)
  - [A.2 Every string change, old → new](#a2-every-string-change-old--new)
  - [A.3 The vocabulary guard (SA-Q51)](#a3-the-vocabulary-guard-sa-q51)
  - [A.4 Entitlements and tenant isolation (Part A)](#a4-entitlements-and-tenant-isolation-part-a)
  - [A.5 Guard table, line by line (Part A)](#a5-guard-table-line-by-line-part-a)
  - [A.6 AC mapping (Part A)](#a6-ac-mapping-part-a)
  - [A.7 Verification plan (Part A)](#a7-verification-plan-part-a)
  - [A.8 Estimate (Part A)](#a8-estimate-part-a)
  - [A.9 Task list (Part A)](#a9-task-list-part-a)
  - [A.10 Checklist before SA code review (Part A)](#a10-checklist-before-sa-code-review-part-a)
- [PART B — OV-5, recorded above charged](#part-b--ov-5-recorded-above-charged)
  - [B.1 Files](#b1-files)
  - [B.2 Payload (SA-Q54)](#b2-payload-sa-q54)
  - [B.3 The pure builder `recordedCost.ts`](#b3-the-pure-builder-recordedcostts)
  - [B.4 Wiring in `financeHealth.ts`](#b4-wiring-in-financehealthts)
  - [B.5 The route: binding the two reads](#b5-the-route-binding-the-two-reads)
  - [B.6 Failure matrix](#b6-failure-matrix)
  - [B.7 The page](#b7-the-page)
  - [B.8 Repository headers (F-7)](#b8-repository-headers-f-7)
  - [B.9 Entitlements registration check (Part B)](#b9-entitlements-registration-check-part-b)
  - [B.10 Tenant isolation check (Part B)](#b10-tenant-isolation-check-part-b)
  - [B.11 Guard table, line by line (Part B)](#b11-guard-table-line-by-line-part-b)
  - [B.12 AC mapping (Part B)](#b12-ac-mapping-part-b)
  - [B.13 Verification plan (Part B)](#b13-verification-plan-part-b)
  - [B.14 Logging (Part B)](#b14-logging-part-b)
  - [B.15 Estimate (Part B)](#b15-estimate-part-b)
  - [B.16 Task list (Part B)](#b16-task-list-part-b)
  - [B.17 Checklist before SA code review (Part B)](#b17-checklist-before-sa-code-review-part-b)
- [Risks](#risks)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I opened every file below at `b20da2cc` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| Every §11F.4 Finance line is where the requirement says | `app/admin/finance/financeCopy.ts:42`, `:202-204`, `:212`, `:218`, `:481`, `:511`, `:519`, `:547` |
| Section 3's subtitle is `` `${AI_SOURCE}, ${windowLabel}` `` | `app/admin/finance/components/AiCostSection.tsx:81` |
| Section 3 renders its figures only when `f && !entirelyBefore`; the link note sits outside that guard | `AiCostSection.tsx:84`, `:157-163` |
| The M-1 cut-over note names "AI cost in the window" | `financeCopy.ts:482` |
| Analytics scope notes are JSX text, split over lines | `app/admin/analytics/page.tsx:345-348`, `:350` |
| "Total spend" tile and "% of spend" sub-line | `app/admin/analytics/components/AnalyticsKpis.tsx:84`, `:131`; comments `:6`, `:7`, `:11`, `:72` |
| Costs intro, fallback note, KPI label | `app/admin/business-os-llm/costCopy.ts:9-11`, `:36-38`, `:83` |
| Leak check strings | `app/admin/business-os-llm/leakCopy.ts:23`, `:46`, `:59`; "spend" in known-path texts `:118`, `:122`, `:123` |
| Activity strings; a **fourth** ledger "Cost (USD)" label exists in the corrections table | `app/admin/business-os-llm/activityCopy.ts:11-13`, `:46`, `:75`, `:81`, `:191`, `:228`, **`:245`** |
| Health tile title, figure labels, link label, footnote | `lib/admin/health/evaluateHealth.ts:422`, `:662`, `:675-676`, `:679-681`; comment `:108` |
| Health rule descriptions and metric labels say "spend" and are shown as the tile's headline | `lib/admin/health/rules.ts:73-76`, `:225`, `:232`; `evaluateHealth.ts:521` |
| Drawer strip, panel and All products labels | `app/admin/users/components/BusinessSummaryStrip.tsx:80`; `BusinessOsPanel.tsx:218`, `:359`; `AllProductsUsage.tsx:21`, `:27`, `:56` |
| The drawer box's purpose line still says "Estimated cost" | `app/admin/users/components/DrawerBox.tsx:45`; pinned in `app/admin/users/__tests__/drawerBox.render.test.tsx:112` |
| The finance "no token_usage" rule covers every file, the route included; it is case-sensitive | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:144-147` |
| A finance file (in `FILES`) names `TokenUsageRepository` **in a comment** | `lib/repositories/BusinessOsFinanceReadRepository.ts:57` |
| The 2b positive pin "only the route names the jobs read" reads comments too | `finance.source.guard.test.ts:494-499` |
| The route injects `findNames` and `readReminderFigures`; its admin context object | `app/api/admin/business-os/finance/route.ts:155`, `:193-200` |
| The route's one `info` line | `route.ts:216-251` |
| `financeHealthDeps()` returns `Omit<FinanceHealthDeps, 'findNames' \| 'readReminderFigures'>`; the file is a registered non-gate importer | `lib/business-os/finance/financeHealthDeps.ts:101`; `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:533` |
| The reminder read runs inside the one `Promise.all` under `underDeadline` and `REMINDER_DEADLINE_MS` | `lib/business-os/finance/financeHealth.ts:199`, `:565-573` |
| `underDeadline` races, aborts the signal, swallows a late settlement and clears its timer | `lib/admin/readUnderDeadline.ts:41-86` (`work.catch`, `:62`) |
| Section 3's units: total, deleted bucket; `figures.exact = !reachedCeiling && unreadableAmounts === 0` | `lib/business-os/finance/aiCost.ts:57-61`, `:181`, `:199-203`; wired `financeHealth.ts:642-651` |
| `toUnits` returns `NaN` for null, blank or non-finite; `COST_SCALE` 1e10 | `lib/business-os/credits/creditReport.ts:136-139`, `:90` |
| The Finance window is `[start, end)` as `Date`s | `lib/business-os/finance/financeWindow.ts:26-33` |
| `cutoverClamp` gives the coverage | `lib/business-os/credits/aiActivity.ts:219-225` |
| The all-accounts reader: AdminReadContext first, `gte` / `lte`, newest first, paged, de-duplicated, `completed`, ceiling ≤ 10,000, signal between pages; window as ISO strings | `lib/repositories/AdminTokenUsageAnalyticsRepository.ts:69-72`, `:139-149`, `:293-360` |
| Its header names only two permitted callers | `AdminTokenUsageAnalyticsRepository.ts:12-17` |
| Its isolation guard allows `app/api/admin/**` | `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts:327-345` |
| The Health tile's exactness is `completed` (C-1) | `lib/admin/health/windows.ts:126`; the read in `app/api/admin/health-summary/route.ts:185-191` |
| The one-account reader: UUID assert, `.eq('user_id')`, `gte` / `lte`, ceiling ≤ 5,000, no signal; `reachedCeiling = rows.length >= ceiling` | `lib/repositories/TokenUsageRepository.ts:119-123`, `:348-403` |
| Its header lists three callers and claims one all-accounts read; `summariseFeatureAllAccountsInWindow` is a second | `TokenUsageRepository.ts:1-27`, `:483` |
| The contract test reads the raw source (comments included) for `callCatalog` and `from '@/lib/business-os` | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts:96-100` |
| `bosRowFilter()` | `lib/business-os/llm/callCatalog.ts:139`; already imported module in `route.ts:70` |
| The drawer's account read (the precedent binding) | `app/api/admin/business-os/accounts/[accountId]/summary/route.ts:145-148` |
| The AC-145 baseline pins every read, `findNames`, top-level keys and a SHA-256; `allReads()` | `app/api/admin/business-os/finance/__tests__/route.test.ts:316-326`, `:1077-1174` |
| The Costs tab's `account` key scopes the Leak check | `app/admin/business-os-llm/costsFilters.ts:29-43`; `components/costs/LeakCheckPanel.tsx:89-92` |
| `financeLinks.ts` imports only the wire types (pinned) | `app/admin/finance/__tests__/source.guard.test.ts:167-171` |
| The account summary already receives `aiCost` | `app/admin/finance/components/AccountSummary.tsx:169`, `:194-196`; `FinanceView.tsx:173-181` |
| Test pins on the old strings (Part A must edit) | listed in [A.1](#a1-files) |
| Precedent for a TypeScript-AST source guard | `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts:24-29`; `lib/payments/__tests__/planSurfaces.guard.test.ts:15-28` |

---

## Scope

| In scope | Not in scope |
|---|---|
| **Part A:** W-1 to W-25 (§11F.4), the W-26 comments, and the SA-W91 to SA-W93 additions if SA approves; the tests that pin the old strings; one vocabulary guard | Sidebar names and descriptions (`AdminSidebar.tsx:100`, `:106`, `:180`) and the page title "AI cost & usage" (M-5, the user signs off); Health rule descriptions and metric labels (SA-W94) |
| **Part B:** `aiCost.recorded` on the Overview and in the picked view; Section 3's two new lines; one summary line; one pure builder; two reused reads bound by the route; the finance guard narrowed and widened; two repository headers | Any new repository method, an exclusive-end option or a signal option on `listCallsInWindow`; a recorded figure on the Accounts tab, in AI margin or in a KPI tile; a per-call list (the Leak check's job); raising either ceiling; owner-facing pages |

---

## Questions for SA before code

Fifteen points. **Part A: SA-W90 to SA-W97. Part B: SA-W98 to SA-W104.**

| # | Part | Question | Dev recommendation |
|---|---|---|---|
| **SA-W90** | A | **W-3 does not fit its join.** `AiCostSection.tsx:81` renders `` `${AI_SOURCE}, ${windowLabel}` ``. W-3's new text is two sentences ending in a full stop, so the subtitle would read "…are not in it., This month". | Change the one JSX line to `` `${windowLabel}. ${AI_SOURCE}` `` (the window first, as `TAKINGS_SUBTITLE(windowLabel)` does). It is the only non-string, non-test edit in Part A, so it needs a ruling against V-5. Alternative: shorten W-3 to one clause (a BA wording change) |
| **SA-W91** | A | W-18 lists `activityCopy.ts:191` and `:228`, but `:245` (`CORRECTION_COLUMNS.cost`, the drill-down's corrections table, also read from the ledger) says "Cost (USD)" too | Include it: `'Cost (USD)'` → `'Charged AI cost (USD)'`. Otherwise one drill-down shows two labels for the same measure |
| **SA-W92** | A | `DrawerBox.tsx:45` (`DRAWER_PURPOSE['ai-bos']`) is the purpose line of the block W-24 renames, and says "Estimated cost of this business's Business OS AI calls, in USD." It is not in §11F.4 | Add as **W-27**: → `"Recorded AI cost of this business's Business OS AI calls, in USD."`; update `drawerBox.render.test.tsx:112`; put `DrawerBox.tsx` in the guard's file list. Without it, the drawer says "Recorded" and "Estimated" in two adjacent lines |
| **SA-W93** | A | `financeCopy.ts:482` (`ACCOUNT_CUTOVER_NOTE`) says "see AI cost in the window below", the Section 3 title W-2 renames | → `'The window starts before AI charging went live: see Charged AI cost in the window below.'` Confirm that the other bare "AI cost" strings on the Accounts tab (`:507`, `:535`, `:541`, `:562`) and the Section 3 column "Cost (USD)" (`:214`) stay: none uses a forbidden word, and the tab's note (W-9) defines the term |
| **SA-W94** | A | The Health tile's rule descriptions and metric labels say "spend" ("Spend tripled vs yesterday", "24 h spend", `rules.ts:73-76`, `:225`, `:232`) and appear as the tile's headline and rule list under the new "Recorded AI cost" title. V-5 freezes rule ids and metric names; AC-151 says the rule tests pass unchanged. None matches a forbidden phrase | Leave them, and leave `rules.ts` out of the guard; record a follow-up for M-5. Rewording them touches `rules.config.test.ts` |
| **SA-W95** | A | Comments and fixtures naming the old terms beyond W-26: `AnalyticsKpis.tsx:6`, `:7`, `:11`, `:72`; `BusinessSummaryStrip.tsx:5`; `BusinessOsPanel.tsx:22`; `evaluateHealth.ts:108`. Test fixtures: `health.render.test.tsx:93`, `:97`; `qa-slice5.test.ts:148`; `KpiStrip.render.test.tsx:159-185` | Reword the seven comments in the same diff (comments only, the W-26 rule). Update the Health render fixture to the new labels, for consistency. Leave `qa-slice5` and `KpiStrip` (generic fixtures of a shared primitive; the guard never scans tests) |
| **SA-W96** | A | Three Leak check reason texts say "spend" (`leakCopy.ts:118`, `:122`, `:123`). They are not in §11F.4 and match no forbidden phrase | Leave them: they describe usage paths, not a figure's name |
| **SA-W97** | A | **Guard mechanics.** I propose the TypeScript compiler API (the `routerPlacement.guard` precedent): collect `StringLiteral`, `NoSubstitutionTemplateLiteral`, template head / middle / tail and `JsxText`; fold `+` chains of literals first (the `COSTS_INTRO` shape, `costCopy.ts:9-11`); collapse whitespace (JSX text spans lines, `analytics/page.tsx:345-348`). It skips import specifiers, property **names**, and the values of the JSX attributes `data-testid`, `testId`, `className`, `key`, `id` and `href`. File: `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` (it also reads `lib/admin/health/evaluateHealth.ts`) | Approve the skip set and the location |
| **SA-W98** | B | **R4-5 against the section's layout.** Section 3 shows its figures only when `f && !entirelyBefore` (`AiCostSection.tsx:84`). R4-5 still shows the recorded figure before the cut-over, and R4-9 still shows it when the ledger read failed (`figures` null) | Render the recorded block **outside** that guard, after the cut-over notice, so it shows in every coverage and when Section 3 is Unknown, with "Not available" or "Unknown" for the difference. The block is still absent when `aiCost.recorded` is absent (the Accounts tab) |
| **SA-W99** | B | The Leak check takes its business from the Costs tab's `account` key (`costsFilters.ts:43`, `LeakCheckPanel.tsx:89-92`). M4-FR-1 says no window is carried, but is silent on the business | A new `leakCheckHref(accountId \| null)` in `financeLinks.ts`: `/admin/business-os-llm?tab=costs`, plus `&account=<id>` when a business is picked. No window, no other key; the file still imports only the wire types |
| **SA-W100** | B | **Deadline.** Both reads go through the shared `underDeadline` (`readUnderDeadline.ts:41`) with a new `FINANCE_LIMITS.RECORDED_DEADLINE_MS: 2 * 1000`. The all-accounts binding passes the signal; the account binding ignores it (race only, SA-Q53). `underDeadline` already swallows a late settlement (`:62`) and the bound call is wrapped in `settle`, so neither can reject unhandled | Approve the reuse; no new race helper. A late account read keeps paging (at most 5 pages) and its result is dropped (F-6) |
| **SA-W101** | B | **Payload field names and rule order** (SA-Q54). [B.2](#b2-payload-sa-q54) proposes `status`, `recordedUsd`, `recordedExact`, `aboveCharged: { state, usd }`, `chargedAboveUsd`. The order: a failed read makes both Unknown first; then a window before the cut-over gives "Not available"; then any inexact side gives Unknown; then the difference | Approve the names and the order. One notice text covers both a failure and a deadline (the log tells them apart) |
| **SA-W102** | B | **The charged side's exactness.** I use Section 3's `figures.exact` (`aiCost.ts:181`: no ceiling and no unreadable amount). Unresolved corrections (`unresolvedAdjustments`) stay in the charged total and do **not** make the difference Unknown, as they do not make Section 3 inexact today | Approve. FU-6a-2 (unreadable rows) is unchanged |
| **SA-W103** | B | **The name rule must read code, not comments.** `BusinessOsFinanceReadRepository.ts:57` (in `FILES`) says "the TokenUsageRepository convention" in a comment, so the 2b "comments included" shape (`:494-499`) would trip | The narrowed rule and the positive pin use `codeOf` (comments stripped), case-insensitive `/tokenusage/i` |
| **SA-W104** | B | `financeHealthDeps.ts:101` must also `Omit` the two new route-injected deps. The file is in `KNOWN_NON_GATE_IMPORTERS` (`enforcementPoints.test.ts:533`); its import from the entitlements module does not change. 6a avoided editing it | Approve the one-line type edit. `test:bos-entitlements` proves the symbol set is unchanged |

---

## Analysis Summary

| Area | Part A | Part B |
|---|---|---|
| Admin pages | Finance (Overview, Accounts tab, account summary), AI cost & usage, Business OS AI (Costs & credits, Leak check, Activity), Health landing tile, Businesses drawer | Finance Section 3 and the account summary only |
| API routes | None | `app/api/admin/business-os/finance/route.ts` (binds two reads; one log line grows) |
| Builders | None | New `lib/business-os/finance/recordedCost.ts`; `financeHealth.ts` wiring |
| Repositories | None | **No method change.** Two header comments (F-7) |
| DB tables | None | `token_usage`, read through the two existing readers; `business_os_credit_charges` through Section 3's existing R-a / R-a′ |
| Providers / LLM | None | None |

---

## Implementation Approach

- **Part A first, alone.** Strings are changed where they live (V-7). Tests that pin an old string are updated in the same diff; no assertion is removed. One new guard file makes the vocabulary stick (SA-Q51).
- **Part B on the slice 2b precedent.** The route binds two reused reads to the request (admin context, `bosRowFilter()`, page size, ceiling, `end − 1 ms`) and injects them, as it injects `readReminderFigures`. The builder never names the usage log. A pure `recordedCost.ts` makes the figures from `{ cost_usd }` rows, a read-kind flag and Section 3's integer units. The difference is taken in integers at `COST_SCALE`.
- **The AC-145 baseline is written to change once.** In Part B the baseline gains the all-accounts read with its exact arguments and a new hash (E-55). Every other read and key stays pinned. `git diff -U0` proves the hunk list.
- **Pattern check (rule 7).** No new pattern: injected admin reads (2b), `underDeadline` (2b), a pure builder with structural types (6a), a TS-AST source guard (`routerPlacement.guard`).
- **V6 pipeline:** not touched.

---

# PART A — OV-1, copy only

## A.1 Files

**Modify (source, 13):**

| File | Action | Reason |
|---|---|---|
| `app/admin/finance/financeCopy.ts` | modify | W-1 to W-9; SA-W93 |
| `app/admin/finance/components/AiCostSection.tsx` | modify | W-26 comment (`:8`); SA-W90 subtitle join (`:81`) if ruled |
| `app/admin/analytics/page.tsx` | modify | W-10, W-11 |
| `app/admin/analytics/components/AnalyticsKpis.tsx` | modify | W-12; SA-W95 comments |
| `app/admin/business-os-llm/costCopy.ts` | modify | W-13 to W-15 |
| `app/admin/business-os-llm/leakCopy.ts` | modify | W-16 |
| `app/admin/business-os-llm/activityCopy.ts` | modify | W-17 to W-19; SA-W91 |
| `app/admin/business-os-llm/components/activity/CutoverNotice.tsx` | modify | W-26 comment (`:4`) |
| `lib/admin/health/evaluateHealth.ts` | modify | W-20 to W-22; SA-W95 comment (`:108`) |
| `app/admin/users/components/BusinessSummaryStrip.tsx` | modify | W-23 label; SA-W95 comment (`:5`) |
| `app/admin/users/components/BusinessOsPanel.tsx` | modify | W-23 sub-label, W-24; SA-W95 comment (`:22`) |
| `app/admin/users/components/AllProductsUsage.tsx` | modify | W-25 |
| `app/admin/users/components/DrawerBox.tsx` | modify | W-27, only if SA-W92 approves |

**Create (1):**

| File | Action | Reason |
|---|---|---|
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | create | SA-Q51 guard, AC-150 source pins, AC-152 |

**Modify (tests that pin an old string, 10):**

| File | Lines | Change |
|---|---|---|
| `app/admin/analytics/__tests__/analytics.layout.render.test.tsx` | `:280`, `:346`, `:362`, `:391` (`'Total spend, $1.50…'`); `:368` (`'33% of spend · …'`); titles `:343`, `:358`, `:378` | → `'Recorded AI cost, $1.50…'`; `'33% of recorded cost · …'` |
| `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx` | `:317`, `:346`, `:362` (`Cost (USD, net), …`) | → `Charged AI cost (USD, net), …` |
| `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx` | `:218` title, `:224` (`'Cost (USD)'`) | → `'Charged AI cost (USD)'` |
| `app/admin/business-os-llm/__tests__/costsLayout.render.test.tsx` | `:491` (`Cost (USD), …`) | → `Charged AI cost (USD), …` |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | `:368`, `:396`, `:587` (`'$4.21estimated'`); `:442` (`'$4.21estimated, a lower bound'`); `:490` (`'Cost by Model (highest cost first)'`); titles `:356`, `:475` | → `'$4.21recorded'`; `'$4.21recorded, a lower bound'`; `'Recorded AI cost by model (highest first)'` |
| `app/admin/users/__tests__/businessSummaryStrip.render.test.tsx` | `:35` label list; fixture `:22` and `:44` (`'estimated'`); title `:40` | `'Recorded AI cost, 30 days'`; fixture sub `'recorded'` |
| `lib/admin/health/__tests__/evaluateHealth.test.ts` | `:347` (`'AI spend, last 7 days (USD)'`) | → `'Recorded AI cost, last 7 days (USD)'`; plus one new case pinning the W-20 to W-22 texts |
| `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts` | `:192-193` (figure lookup by label) | → the W-21 labels |
| `app/admin/__tests__/health.render.test.tsx` | fixture `:93`, `:97` | → the W-21 label and link label (SA-W95) |
| `app/admin/users/__tests__/drawerBox.render.test.tsx` | `:112` | → W-27 text, only if SA-W92 approves |

Tests that import the copy constant (for example `leakPanel.render.test.tsx:168`, `:185`, `:171`; `activityLayout.render.test.tsx:162`, `:166`; `activityTab.render.test.tsx:437`; `accountsTab.render.test.tsx:230`, `:247-249`; `financeAccount.render.test.tsx:224`) follow the new text with no edit. `scope.render.test.tsx:82-83` asserts "legacy-tagged" and "USD", which both survive W-10.

Unchanged on purpose: `app/admin/analytics/__tests__/analytics.table.render.test.tsx:303`, `:324`, `:416` (the analytics table's own "Cost (USD)" column is not in §11F.4); `KpiStrip.render.test.tsx` and `qa-slice5.test.ts:148` (SA-W95).

## A.2 Every string change, old → new

Each row is the literal as it is in the file today and the literal after the change. `’` is the typographic apostrophe already in the file and is kept. Nothing else on the line changes.

**Finance (`app/admin/finance/financeCopy.ts`)**

| # | Line | Old | New |
|---|---|---|---|
| W-1 | `:42` `TILE_LABELS.k1` | `'AI cost this month'` | `'Charged AI cost this month'` |
| W-2 | `:202` `AI_TITLE` | `'AI cost in the window'` | `'Charged AI cost in the window'` |
| W-3 | `:203` `AI_SOURCE` | `'Credit ledger, charges and corrections'` | `'Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it.'` |
| W-4 | `:204` `AI_TOTAL` | `'AI cost (USD)'` | `'Charged AI cost (USD)'` |
| W-5 | `:212` `AI_TOP` | `'Top 10 businesses by AI cost'` | `'Top 10 businesses by charged AI cost'` |
| W-6 | `:218` `AI_LINK_NOTE` (`AI_LINK` unchanged) | `'For the provider-side token measure, see'` | `'Every recorded AI call, charged or not:'` |
| W-7 | `:481` `ACCOUNT_AI_COST` | `'AI cost, charged'` | `'Charged AI cost'` |
| W-8 | `:519` `ECON_COST` | `'AI cost, charged (USD)'` | `'Charged AI cost (USD)'` |
| W-9a | `:511` `ECON_NOTES[1]` | `'AI cost is the charged cost (credits we billed).'` | `'AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here.'` |
| W-9b | `:547` `ECON_SORT_LABELS.ai_cost` | `'AI cost, highest first'` | `'Charged AI cost, highest first'` |
| SA-W93 | `:482` `ACCOUNT_CUTOVER_NOTE` | `'The window starts before AI charging went live: see AI cost in the window below.'` | `'The window starts before AI charging went live: see Charged AI cost in the window below.'` |
| SA-W90 | `AiCostSection.tsx:81` (JSX, not copy) | `` subtitle={`${AI_SOURCE}, ${windowLabel}`} `` | `` subtitle={`${windowLabel}. ${AI_SOURCE}`} `` |

**AI cost & usage**

| # | File and line | Old | New |
|---|---|---|---|
| W-10 | `app/admin/analytics/page.tsx:345-348` (JSX text, Business OS scope) | `Business OS only: includes legacy-tagged Business OS rows. Costs are USD, estimated from the model pricing table.` | `Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, including calls before charging started on 29 Sep 2026 and legacy-tagged Business OS rows. USD, priced from the model price table. The charged cost is on Finance.` |
| W-11 | `page.tsx:350` (JSX text, All scope) | `Both products. Costs are USD, estimated from the model pricing table.` | `Recorded AI cost, both products: every AI call in the usage log. USD, priced from the model price table.` |
| W-12a | `app/admin/analytics/components/AnalyticsKpis.tsx:84` | `label="Total spend"` | `label="Recorded AI cost"` |
| W-12b | `AnalyticsKpis.tsx:131` | `` `${pctOf(figures.cost)}% of spend · ${formatNumber(figures.tokens)} tokens · ${description}` `` | `` `${pctOf(figures.cost)}% of recorded cost · ${formatNumber(figures.tokens)} tokens · ${description}` `` |

**Business OS AI (`app/admin/business-os-llm/`)**

| # | File and line | Old | New |
|---|---|---|---|
| W-13 | `costCopy.ts:9-11` `COSTS_INTRO` | `'What Business OS actions cost us (USD, the provider’s measured cost) and what we charged ' + '(credits), per account and billing period. Read from the credit ledger; nothing here changes it.'` | `'Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) and what we charged ' + '(credits), per account and billing period. Read from the credit ledger; nothing here changes it. ' + 'Monthly totals are on Finance.'` |
| W-14 | `costCopy.ts:83` `KPI_COST_USD` | `'Cost (USD)'` | `'Charged AI cost (USD)'` |
| W-15 | `costCopy.ts:36-38` `FALLBACK_NOTE` | `'Charged from a fallback price because the measured price was missing — a deliberate ' + 'over-estimate. Reconciling them is a later part of this work.'` | `'Charged from a fallback price because the model had no price in the price table: a deliberate ' + 'over-estimate. Reconciling them is a later part of this work.'` |
| W-16a | `leakCopy.ts:23` `LEAK_CLEAN` | `'No uncharged AI spend found'` | `'No recorded AI cost left uncharged'` |
| W-16b | `leakCopy.ts:46` `LEAK_FOUND` | `` `${accounts} business${accounts === 1 ? '' : 'es'} with uncharged AI spend (${usd} not charged)` `` | `` `${accounts} business${accounts === 1 ? '' : 'es'} with recorded AI cost not charged (${usd})` `` |
| W-16c | `leakCopy.ts:59` `LEAK_STATUS_TEXT.leak` | `'Uncharged spend'` | `'Recorded, not charged'` |
| W-17 | `activityCopy.ts:12` `ACTIVITY_INTRO` (first literal; `:13` unchanged) | `'One row per Business OS AI action: what ran, for which business, whether it worked and what it cost. '` | `'One row per Business OS AI action: what ran, for which business, whether it worked and its charged AI cost. '` |
| W-18a | `activityCopy.ts:46` `KPI_COST` | `'Cost (USD, net)'` | `'Charged AI cost (USD, net)'` |
| W-18b | `activityCopy.ts:191` `COLUMNS.cost` | `'Cost (USD)'` | `'Charged AI cost (USD)'` |
| W-18c | `activityCopy.ts:228` `DRILL_DOWN_FIELDS.cost` | `'Cost (USD)'` | `'Charged AI cost (USD)'` |
| SA-W91 | `activityCopy.ts:245` `CORRECTION_COLUMNS.cost` | `'Cost (USD)'` | `'Charged AI cost (USD)'` |
| W-19a | `activityCopy.ts:75` `CUTOVER_LINE` (second literal; `:74` unchanged) | `'For AI activity before then, see the audit trail’s AI action entries or Cost Analytics.'` | `'For AI activity before then, see the audit trail’s AI action entries or the recorded AI cost in AI cost & usage.'` |
| W-19b | `activityCopy.ts:81` `CUTOVER_ANALYTICS_LINK` | `'Cost Analytics (Business OS)'` | `'AI cost & usage (Business OS, recorded)'` |

**Health tile (`lib/admin/health/evaluateHealth.ts`)**

| # | Line | Old | New |
|---|---|---|---|
| W-20 | `:422` `TITLES.bos_ai_spend` (the key stays) | `'Business OS AI spend (USD, estimated)'` | `'Recorded AI cost (USD)'` |
| W-21a | `:675` | `'AI spend, last 24 h (USD)'` | `'Recorded AI cost, last 24 h (USD)'` |
| W-21b | `:676` | `'AI spend, last 7 days (USD)'` | `'Recorded AI cost, last 7 days (USD)'` |
| W-21c | `:662` `linkLabel` | `` `Business OS AI spend, ${windowWords}: ${money(current)}, open in AI cost & usage` `` | `` `Recorded AI cost, ${windowWords}: ${money(current)}, open in AI cost & usage` `` |
| W-22 | `:679` (first footnote literal; `:680-681`, the OI-P2 sentence, unchanged) | `'USD, estimated from the model pricing table; never mixed with a business currency. '` | `'USD: every Business OS AI call in the usage log, charged or not, priced from the model price table; never mixed with a business currency. The charged AI cost is on Finance. '` |

**Businesses drawer (`app/admin/users/components/`)**

| # | File and line | Old | New |
|---|---|---|---|
| W-23a | `BusinessSummaryStrip.tsx:80` | `label="Business OS AI, 30 days"` (testid `strip-ai-spend` unchanged) | `label="Recorded AI cost, 30 days"` |
| W-23b | `BusinessOsPanel.tsx:218` | `sub: spend.status === 'incomplete' ? 'estimated, a lower bound' : 'estimated',` | `sub: spend.status === 'incomplete' ? 'recorded, a lower bound' : 'recorded',` |
| W-24 | `BusinessOsPanel.tsx:359` (JSX text) | `Business OS, last 30 days (USD estimated)` | `Recorded AI cost, Business OS, last 30 days (USD)` |
| W-25a | `AllProductsUsage.tsx:21` | `'All products, token records (30 days; may be incomplete above 1,000 calls)'` | `'All products, recorded AI cost (30 days; may be incomplete above 1,000 calls)'` |
| W-25b | `AllProductsUsage.tsx:27` | `'Cost by Model (highest cost first)'` | `'Recorded AI cost by model (highest first)'` |
| W-25c | `AllProductsUsage.tsx:56` | `label="Total Cost"` | `label="Recorded AI cost"` |
| W-27 (SA-W92) | `DrawerBox.tsx:45` `DRAWER_PURPOSE['ai-bos']` | `"Estimated cost of this business's Business OS AI calls, in USD."` | `"Recorded AI cost of this business's Business OS AI calls, in USD."` |

**Comments only (W-26 and SA-W95)**

| File and line | Old wording | New wording |
|---|---|---|
| `AiCostSection.tsx:8` | "The provider-side token measure is a link, not a read (SA-Q4)." | "The recorded AI cost (the usage log) is a link, not a read here (SA-Q4); M-4 Part B adds it beside the charged figure, never added." |
| `CutoverNotice.tsx:4` | "…the audit trail's AI action entries and Cost Analytics," | "…the audit trail's AI action entries and the recorded AI cost in AI cost & usage," |
| `AnalyticsKpis.tsx:6`, `:7`, `:11`, `:72` | "Total spend" | "Recorded AI cost" |
| `BusinessSummaryStrip.tsx:5` | "Business OS AI spend" | "Recorded AI cost" |
| `BusinessOsPanel.tsx:22` | "AI spend" | "recorded AI cost" |
| `evaluateHealth.ts:108` | "Cost Analytics' figure" | "AI cost & usage's figure" |

No identifier, testid, metric id, rule id, URL key or link target changes: `spend24h`, `bos_ai_spend`, `strip-ai-spend`, `bos-panel-spend`, `ai-spend-card`, `aiSpend`, `aiSpend30d` and `estimatedCostUsd` stay (V-5).

## A.3 The vocabulary guard (SA-Q51)

**File:** `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` (runs in the existing Jest gate; no new CI job).

- **Files scanned** (the §11F.4 places): `financeCopy.ts`, `AiCostSection.tsx`, `analytics/page.tsx`, `AnalyticsKpis.tsx`, `costCopy.ts`, `leakCopy.ts`, `activityCopy.ts`, `CutoverNotice.tsx`, `evaluateHealth.ts`, `BusinessSummaryStrip.tsx`, `BusinessOsPanel.tsx`, `AllProductsUsage.tsx`, plus `DrawerBox.tsx` if SA-W92 is approved. Part B's `RecordedCostLines.tsx` joins the list in Part B.
- **What is scanned:** string literals, no-substitution templates, template head / middle / tail, and JSX text, through `ts.createSourceFile`. Adjacent `+` chains of literals are folded first. Whitespace is collapsed to one space.
- **What is never scanned:** identifiers and property names; import specifiers; the values of the JSX attributes `data-testid`, `testId`, `className`, `key`, `id` and `href`; comments (SA-W97).
- **Forbidden phrases** (case-insensitive, exactly SA's list): `estimated`, `provider-side`, `measured cost`, `measured price`, `Cost Analytics`, `AI spend`, `Total spend`, `Uncharged spend`.
- **Allow-list:** `ALLOWED: Array<{ file, phrase, reason }>`, empty at the start. A test fails if an entry no longer matches anything (no slack), and each `reason` is over 30 characters.

**Tests in the file:**
1. **Non-vacuity, per file:** the number of scanned strings is at least a pinned count (recorded at build time from the real files), and the file list has its 12 (or 13) entries.
2. **No forbidden phrase** in any scanned string, per file (`it.each`).
3. **Planted controls** (they must hold):
   - `const x = 'Costs are USD, estimated';` → one offence;
   - `<p>Total spend</p>` → one offence;
   - `'Recorded, ' + 'estimated'` → one offence after folding;
   - a JSX text broken over two lines, "measured\n cost" → one offence;
   - `data-testid="strip-ai-spend"`, `'bos_ai_spend'`, `x.estimatedCostUsd`, `import x from './estimated'` → zero offences.
4. **AC-150, positive pins:** each W row's new text is present in its file's scanned strings (a `{ file, text }` table, one entry per row in [A.2](#a2-every-string-change-old--new)).
5. **AC-150, negative pins:** no "Old" text of [A.2](#a2-every-string-change-old--new) is present in any scanned file (exact strings, so "AI cost (USD)" is matched only as a whole literal, not inside "Charged AI cost (USD)").

## A.4 Entitlements and tenant isolation (Part A)

- **Entitlements (`business-os-entitlements` skill):** no file gains or loses an import from `lib/business-os/entitlements/`; no capability id or tier literal is written; no catalog or matrix change. `npm run test:bos-entitlements` runs anyway, because it covers `app/admin/users/__tests__` and `lib/repositories/__tests__`.
- **Tenant isolation (`tenant-isolation-guard` skill):** not applicable. No read, write, id or query changes.
- **New repository (`new-repository` skill):** not applicable.

## A.5 Guard table, line by line (Part A)

| Guard | Part A trips it? | Exact change |
|---|---|---|
| **New** `aiCostVocabulary.source.guard.test.ts` | Added | [A.3](#a3-the-vocabulary-guard-sa-q51); every rule has a planted control |
| String pins listed in [A.1](#a1-files) | **Yes** | Each old literal → its new literal; no assertion removed; test titles reworded where they quote the old label |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` (every `FILES` rule, the 1c wording rules, `MONEY_*`) | No: strings only; no "webhook", "not in place", "test accounts only" or mode word added | Run unchanged |
| `app/admin/finance/__tests__/source.guard.test.ts` (dim text, `financeLinks` imports, `MONEY_6A`) | No (the SA-W90 join adds no arithmetic and no class) | Run unchanged |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` (no server import, no model/temperature literal, no console, **no quoted provider name** `:157-172`) | No: the new strings name no provider | Run unchanged |
| `app/admin/users/__tests__/source.guard.test.ts` (`:232` imports, `:243` USD only) | No | Run unchanged |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts`; `layoutFolder.guard` | No: no class changes, no new file in the shared folder | Run unchanged |
| Health: `rules.config.test.ts`, `windows.test.ts`, `qa-edge.test.ts` (`lib/admin/health`), `qa-slice5.test.ts` | No (rule ids, metrics and descriptions unchanged, SA-W94) | Run unchanged (AC-151) |
| Health: `evaluateHealth.test.ts:347`; `health-summary/__tests__/route.qa-edge.test.ts:192-193` | **Yes** (they find a figure by its label) | New labels |
| Finance, Costs, Activity, analytics, drawer-summary **route** tests | No: no route changes (AC-151) | Run unchanged |
| `test:bos-entitlements`, `test:authz-guard` | No | Run |
| `tierLiteral.forbidden`, `serviceColumn.guard` | No | Run inside `test:bos-entitlements` |
| Tailwind CSS-escape guard (PR #180) | No: no backslash in any new string | Run with the Jest gate |

## A.6 AC mapping (Part A)

| AC | Test / check |
|---|---|
| **AC-150** | Vocabulary guard tests 4 and 5 (every W row's new text present, every old text absent). Render pins: the updated `analytics.layout`, `activityLayout`, `activityTab`, `costsLayout`, `businessDrawer.layout`, `businessSummaryStrip`, `evaluateHealth` (new case for W-20 to W-22) and `health.render` cases; the Finance render tests that import the constants (`financePage.render`, `financeAccount.render`, `accountsTab.render`) |
| **AC-151** | `git diff -U0` of Part A shows no change to a `data-testid`, `href`, URL key, rule id, metric id or payload field (read with the diff, recorded in Implementation Notes). The Finance, Costs, Activity, analytics and drawer-summary route tests and the Health rule and metric tests pass **unedited** (`git diff --stat` shows none of them) |
| **AC-152** | Vocabulary guard test 3 (planted controls) and test 2 (all files clean) |
| **AC-153** | Manual, QA: see the QA report (the QA list governs) |

## A.7 Verification plan (Part A)

Before SA code review I run each command alone and paste the command, its own exit code (read from the tool, never from a pipe) and the counts.

| # | Command | Evidence |
|---|---|---|
| VA-1 | **Finance:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` | Suites and tests passed |
| VA-2 | **AI cost & usage:** `npx jest app/admin/analytics app/api/admin/token-usage --ci` | Pass |
| VA-3 | **Business OS AI:** `npx jest app/admin/business-os-llm app/api/admin/business-os/credits app/api/admin/business-os/llm-settings --ci` | Pass |
| VA-4 | **Health:** `npx jest lib/admin/health app/admin/__tests__ app/admin/components app/api/admin/health-summary --ci` | Pass; the vocabulary guard and the contrast guard named in the output |
| VA-5 | **Businesses drawer:** `npx jest app/admin/users app/api/admin/business-os/accounts --ci` | Pass |
| VA-6 | `npm run test:bos-entitlements` | Exit 0 |
| VA-7 | `npm run test:authz-guard` | Exit 0 |
| VA-8 | `npm run lint:hooks` | Exit 0 |
| VA-9 | `npx eslint <every touched and new file>` | Clean |
| VA-10 | **Scoped `tsc` with a canary** (SA-WR-7): a tsconfig **outside the worktree**, in the session scratchpad (`…\scratchpad\tsconfig.m4a.json`), with an absolute `extends` to the worktree's `tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false }`, and `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts` and every touched and new `.ts` / `.tsx` file (tests included) as absolute paths. Plant `const __canary: number = 'x';` in `app/admin/finance/financeCopy.ts`; run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>`; it **must** report TS2322 at the canary. Remove it (`grep -c __canary` = 0), re-run, record every diagnostic (zero in touched files; any pre-existing one attributed by path) | TS2322 seen, then the clean run |
| VA-11 | `git diff --stat` and `git diff --numstat`, read **before** the diff: no file loses lines without gaining any; no `supabase/`, `lib/repositories/` or `app/api/` source path (tests only); no requirement MD from Dev | Output pasted |
| VA-12 | `git diff -U0 -- '*.ts' '*.tsx' ':!**/__tests__/**'` filtered to changed lines: every changed line is a string, JSX text or comment, plus the one SA-W90 line | Hunk list pasted |

## A.8 Estimate (Part A)

About **1 day**, as §11F.2 and SA-Q57 accepted.

| Day | Work |
|---|---|
| 0.25 | All string edits of [A.2](#a2-every-string-change-old--new) and the comments |
| 0.5 | The pinned tests of [A.1](#a1-files); the new `evaluateHealth` case |
| 0.85 | The vocabulary guard with its planted controls and per-file counts |
| 1.0 | VA-1 to VA-12; results pasted |

## A.9 Task list (Part A)

- [x] ✅ 0. SA workplan review; apply the rulings on SA-W90 to SA-W97 (W90 join, W91 `:245`, W92 = W-27, W93 = W-28, W94/W96 left, W95 comments, W97 guard; SA-WR-46, SA-WR-47)
- [x] ✅ 1. Confirm `feature/bos-money-m4` (`git branch --show-current`); junction present; nothing committed
- [x] ✅ 2. Finance strings W-1 to W-9 (+ W-28); E-59 join; W-26 comment
- [x] ✅ 3. Analytics W-10 to W-12 (+ SA-W95 comments)
- [x] ✅ 4. Business OS AI W-13 to W-19 (+ SA-W91); W-26 comment
- [x] ✅ 5. Health W-20 to W-22 (+ SA-W95 comment)
- [x] ✅ 6. Drawer W-23 to W-25, W-27; SA-W95 comments
- [x] ✅ 7. Update the pinned tests of [A.1](#a1-files); SA-WR-46 subtitle render pin
- [x] ✅ 8. The vocabulary guard ([A.3](#a3-the-vocabulary-guard-sa-q51)), with SA-WR-47 controls
- [x] ✅ 9. VA-1 to VA-12, own exit codes; canary; outputs in Implementation Notes
- [ ] 10. Hand over to SA code review and QA, uncommitted. Then the user's diff view; then RM opens **PR 1 (Part A)**

## A.10 Checklist before SA code review (Part A)

- [x] ✅ `git branch --show-current` = `feature/bos-money-m4`; nothing committed; no stash used
- [x] ✅ `git diff --stat` read first: no deletion-only file; no repository, route, migration or requirement MD **from Dev** in the diff (the two requirement MDs in `git status` are BA/SA's pre-existing edits, untouched by Dev)
- [x] ✅ Every [A.2](#a2-every-string-change-old--new) row applied exactly; no testid, href, URL key, rule id or metric id changed (VA-12)
- [x] ✅ The vocabulary guard passes, and each planted control behaves as listed
- [x] ✅ Every test that pinned an old string now pins the new one; no assertion removed
- [x] ✅ The Finance, Costs, Activity, analytics and drawer-summary route tests and the Health rule tests are not in the diff (AC-151). The only `app/api/` file is the planned `health-summary/__tests__/route.qa-edge.test.ts` label lookup (A.1)
- [x] ✅ No `console.*`; no new import in source (tests: the guard imports `typescript`; the Finance render test gains one separate `../financeCopy` import)
- [x] ✅ `test:bos-entitlements`, `test:authz-guard`, `lint:hooks` green; canary seen

---

# PART B — OV-5, recorded above charged

Built only after PR 1 (Part A) merges into `main` and the branch is updated by RM. Part B then only **adds** strings to `financeCopy.ts`.

## B.1 Files

**Create (4):**

| File | Reason |
|---|---|
| `lib/business-os/finance/recordedCost.ts` | The pure builder (M4-FR-5) |
| `lib/business-os/finance/__tests__/recordedCost.test.ts` | T1-B: R4-1 to R4-11, AC-156, AC-160, AC-168; TypeScript ports of checks 21 and 22 (6a retro conclusion 4) |
| `app/admin/finance/components/RecordedCostLines.tsx` | Section 3's block and the shared `RecordedAboveValue` (one renderer for AC-158) |
| `app/admin/finance/__tests__/recordedCost.render.test.tsx` | T9-B: the block's states and texts, the Leak check link |

**Modify (source, 10):**

| File | Reason |
|---|---|
| `lib/business-os/finance/financeTypes.ts` | `FinanceRecordedAiCost`; `FinanceAiCostSection.recorded?` |
| `lib/business-os/finance/financeHealth.ts` | Two deps; the recorded read in the one `Promise.all`; the builder call; counts; header |
| `lib/business-os/finance/financeHealthDeps.ts` | `:101` `Omit<>` gains the two route-injected keys (SA-W104) |
| `app/api/admin/business-os/finance/route.ts` | Binds the two reads (M4-FR-6), `end − 1 ms`; the log line; header paragraph |
| `app/admin/finance/financeCopy.ts` | The M-4 strings only (M4-FR-10) |
| `app/admin/finance/financeLinks.ts` | `leakCheckHref` (SA-W99) |
| `app/admin/finance/components/AiCostSection.tsx` | Renders `RecordedCostLines` (SA-W98) |
| `app/admin/finance/components/AccountSummary.tsx` | The "Recorded above charged" line (M4-FR-2) |
| `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` | **Header comment only**: the finance route joins the permitted callers |
| `lib/repositories/TokenUsageRepository.ts` | **Header comment only**: the full caller list (F-7) |

**Modify (tests, 8):**

| File | Reason |
|---|---|
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | T5-B: wiring, scope, deadline, the tab |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Narrow `:144-147`; a new M-4 describe |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Mocks at the repository boundary; `allReads()`; **AC-145 baseline updated once (E-55)**; a new M-4 describe |
| `app/admin/finance/__tests__/source.guard.test.ts` | New M-4 page rules |
| `app/admin/finance/__tests__/financeLinks.test.ts` | `leakCheckHref` |
| `app/admin/finance/__tests__/financeAccount.render.test.tsx` | The summary line; AC-158 |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | The block on the Overview; none on the Accounts tab |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | `RecordedCostLines.tsx` joins the scanned files; positive pins for the new labels |

## B.2 Payload (SA-Q54)

**File:** `lib/business-os/finance/financeTypes.ts`

```typescript
/** M-4 (§11F.5): the recorded AI cost beside the charged one. Never added to it (BD-18, R4-11). */
export type FinanceRecordedAboveState = 'figure' | 'none' | 'not_available' | 'unknown';

export interface FinanceRecordedAiCost {
  /** ok: recorded exact and the difference decided; partial: "at least" or an Unknown difference; unknown: the read failed or timed out. */
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown`. USD by construction (the price table). */
  recordedUsd: number | null;
  /** False = "At least" (R4-9). */
  recordedExact: boolean;
  /** "Recorded above charged" (E-54). `usd` only with `figure`, and always > 0. */
  aboveCharged: { state: FinanceRecordedAboveState; usd: number | null };
  /** Only when `aboveCharged.state` is `none` and charged is strictly above recorded (R4-6). */
  chargedAboveUsd: number | null;
}

export interface FinanceAiCostSection {
  // …existing fields unchanged…
  /** M-4: present on the Overview and in the picked view; absent on the Accounts tab (AC-167). */
  recorded?: FinanceRecordedAiCost;
}
```

- **No field holds a sum** of the two measures (SA-Q54, pinned by T6-B and T7-B).
- **Optional and absent**, never `null`, when not built (the SA-W74 precedent).
- No row, id, session id, feature value or name is ever in it (AC-164).

## B.3 The pure builder `recordedCost.ts`

**File:** `lib/business-os/finance/recordedCost.ts`. Imports only `COST_SCALE` and `toUnits` from `@/lib/business-os/credits/creditReport` and types from `./financeTypes`. No repository, no data layer, no clock, no entitlements import, no `token_usage` or usage-log reader name (M4-FR-5).

```typescript
/** One usage-log row, structurally: only its cost is read. */
export interface RecordedRowInput { cost_usd: number | string | null }

/** E-53: exactness is decided per read kind, here, in one place. */
export type RecordedReadInput =
  | { kind: 'all_accounts'; rows: readonly RecordedRowInput[]; completed: boolean }
  | { kind: 'account'; rows: readonly RecordedRowInput[]; reachedCeiling: boolean }
  | { kind: 'failed' };

export interface RecordedCostInput {
  read: RecordedReadInput;
  coverage: FinanceCoverage;
  /** Section 3's integer units (COST_SCALE); null when the ledger read failed. */
  charged: { totalUnits: number; deletedUnits: number; exact: boolean } | null;
}

export function buildRecordedAiCost(input: RecordedCostInput): { recorded: FinanceRecordedAiCost; unreadable: number };
```

**Rules, in this order (SA-W101):**
1. **Sum (R4-8).** `units += toUnits(row.cost_usd, COST_SCALE)`; a `NaN` adds 0 and counts one `unreadable`. USD 0 is a real 0. If the sum is not `Number.isSafeInteger` (about USD 900,719 at 1e10, `MAX_SAFE_INTEGER / 1e10`), the recorded figure is Unknown.
2. **Read failed or overflow** → `status: 'unknown'`, `recordedUsd: null`, `aboveCharged: { state: 'unknown', usd: null }` (R4-9).
3. **Recorded exactness (E-53):** `all_accounts` → exact only when `completed`; `account` → exact when `!reachedCeiling`; and in both, `unreadable === 0`.
4. **Before the cut-over (R4-5):** `coverage !== 'after_cutover'` → `aboveCharged.state = 'not_available'`. The recorded figure is still shown.
5. **Unknown difference (R4-9):** recorded not exact, or `charged` null, or `charged.exact` false → `'unknown'`.
6. **The difference (R4-2, R4-4):** `diff = recordedUnits − (charged.totalUnits − charged.deletedUnits)`, in integers. `diff > 0` → `figure` with `usd = diff / COST_SCALE`; `diff === 0` → `none`; `diff < 0` → `none` and `chargedAboveUsd = −diff / COST_SCALE` (R4-6). A negative "above" is never produced.
7. **Status:** `unknown` (rule 2), else `partial` when recorded is "at least" or the difference is `unknown`, else `ok`.

- Every USD figure leaves through one local `usdOf(units)` with the file's **only** `/ COST_SCALE` (pinned).
- **Exports exactly:** `RecordedRowInput`, `RecordedReadInput`, `RecordedCostInput`, `buildRecordedAiCost`. No export returns or takes "recorded + charged" (R4-11; pinned with a planted control).
- With a business picked, `deletedUnits` is 0 by construction (the account ledger read has no NULL `user_id`), so one rule serves both scopes.

## B.4 Wiring in `financeHealth.ts`

**File:** `lib/business-os/finance/financeHealth.ts`

- **Deps** (beside `readReminderFigures`, `:261`):
  ```typescript
  /** M-4 (§11F.7): every account's Business OS usage-log costs in [from, to). Route-bound; called only with no business picked and no tab. */
  readRecordedAllAccounts: (span: FinanceSpan, signal: AbortSignal) => Promise<RepoResult<{ rows: RecordedRowInput[]; completed: boolean }>>;
  /** M-4: ONE account's Business OS usage-log costs in [from, to). No signal (SA-Q53). Called only with that business picked. */
  readRecordedForAccount: (accountId: string, span: FinanceSpan) => Promise<RepoResult<{ rows: RecordedRowInput[]; reachedCeiling: boolean }>>;
  ```
  The builder hands the half-open window `[window.start, window.end)`; the route converts the end (SA-Q52).
- **`FINANCE_LIMITS.RECORDED_DEADLINE_MS: 2 * 1000`** beside `REMINDER_DEADLINE_MS` (SA-W100).
- **One more entry in the one `Promise.all`** (`:529`):
  - `input.accountsTab !== null` → `Promise.resolve(null)`, **neither read called** (AC-167);
  - `accountId !== null` → `underDeadline('recorded', recordedTimings, () => settle(() => deps.readRecordedForAccount(accountId, span)), RECORDED_DEADLINE_MS)`: the signal is not passed (race only, E-57);
  - otherwise → `underDeadline('recorded', recordedTimings, (signal) => settle(() => deps.readRecordedAllAccounts(span, signal)), RECORDED_DEADLINE_MS)`.
- **After Section 3** (`:631-680`), when the read ran: `buildRecordedAiCost({ read, coverage: clamp.coverage, charged })`, where `charged` is `null` when `windowResult.data` is null, else `{ totalUnits: aiCostUnits.total.cost, deletedUnits: aiCostUnits.deleted.cost, exact: summary.figures.exact }`. When `coverage` is `entirely_before_cutover`, Section 3's read is `EMPTY_LEDGER` and `charged` is the zero units; rule 4 makes the difference "Not available" first.
- **Payload:** `aiCost = { ...aiCost, recorded }` only when built; otherwise the key is absent.
- **A failed read** logs once through `failed('recorded_ai_cost', err)` (the existing `error { read, err }` shape).
- **Header:** the account-scope list (`:16-29`) gains "since M-4, the all-accounts usage-log cost read"; a new M-4 paragraph says the usage log is reached only through the two injected functions.

## B.5 The route: binding the two reads

**File:** `app/api/admin/business-os/finance/route.ts`

```typescript
import { bosRowFilter, isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { adminTokenUsageAnalyticsRepository, ADMIN_HEALTH_READ_LIMITS } from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';
import { tokenUsageRepository, TOKEN_USAGE_READ_LIMITS } from '@/lib/repositories/TokenUsageRepository';

/** SA-Q52: both reused reads are inclusive at the end; the Finance window is exclusive. */
const inclusiveEnd = (to: Date) => new Date(to.getTime() - 1);

// inside GET, in the deps object passed to buildFinanceHealth:
readRecordedAllAccounts: (span, signal) =>
  adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(
    adminReadContext,
    { start: span.from.toISOString(), end: inclusiveEnd(span.to).toISOString() },
    { featureFilter: bosRowFilter() },
    { pageSize: ADMIN_HEALTH_READ_LIMITS.PAGE_SIZE, ceiling: ADMIN_HEALTH_READ_LIMITS.CEILING, signal }
  ),
readRecordedForAccount: (id, span) =>
  tokenUsageRepository.listCallsInWindow(
    id,
    { start: span.from, end: inclusiveEnd(span.to) },
    bosRowFilter(),
    { pageSize: TOKEN_USAGE_READ_LIMITS.MAX_PAGE_SIZE, ceiling: TOKEN_USAGE_READ_LIMITS.MAX_CEILING }
  ),
```

- `reminderContext` (`:155`) is renamed `adminReadContext`, with a comment naming both of its reads. It is the same `{ correlationId, adminId }` object, so the AC-145 serialisation of the reminder call is unchanged.
- **The route is the one finance file that names the usage-log readers** (M4-FR-6). It names exactly `listCostPointsAllAccountsInWindow` and `listCallsInWindow` (pinned).
- The structural row type passes straight through: both readers' rows carry `cost_usd`. The builder reads nothing else, and the payload carries nothing else.
- `id` is the builder's `accountId`: UUID-validated by Zod, lower-cased, refused if a platform account (`:179-182`), and checked against the plan table before any read (`financeHealth.ts:459-468`).
- **No new query parameter**: the strict schema is unchanged.

## B.6 Failure matrix

| Case | Recorded AI cost | Recorded above charged | `status` | Section 3's charged figures |
|---|---|---|---|---|
| Both exact, after the cut-over, recorded > charged | Figure | Figure | `ok` | Unchanged |
| Equal | Figure | "None" | `ok` | Unchanged |
| Charged > recorded | Figure | "None" + "Charged is USD X above recorded (fallback prices or corrections)" | `ok` | Unchanged |
| Window starts, or is entirely, before 29 Sep 2026 | Figure (or "At least") | "Not available: AI charging began 29 Sep 2026" | `ok` / `partial` | Unchanged (cut-over notice) |
| All accounts, `completed` false (below or at the ceiling) | "At least X" | Unknown | `partial` | Unchanged |
| One account, `reachedCeiling` true | "At least X" | Unknown | `partial` | Unchanged |
| A row with a null or non-finite cost | "At least X" | Unknown | `partial` | Unchanged |
| Ledger read failed (`figures` null) or not exact | Figure | Unknown | `partial` | Unknown / "At least", as today |
| Recorded read failed or past 2 s | Unknown, with the notice | Unknown | `unknown` | **Unchanged**; every other section renders |
| Sum not a safe integer | Unknown, with the notice | Unknown | `unknown` | Unchanged |
| `tab=accounts` | — (no `recorded` key; no read) | — | — | Unchanged |
| 401 / 403 / 400 / 404 | No read at all | | | |

## B.7 The page

**`RecordedCostLines.tsx`** (client, functional, types only from `lib/business-os/finance/financeTypes`):
- **Section 3 block** (M4-FR-1), rendered by `AiCostSection` after the cut-over notice and **outside** the `f && !entirelyBefore` guard (SA-W98), only when `aiCost.recorded` is present. A `dl` with a caption "Beside the charged cost, never added":
  - **"Recorded AI cost (USD)"**, sub-label "Usage log: every Business OS AI call, charged or not, priced from the model price table", value `atLeast(formatUsd(recordedUsd), recordedExact)` or "Unknown";
  - **"Recorded above charged (USD)"**, sub-label "Recorded AI cost minus charged AI cost, for the same window. Which calls: run the" + link **"Leak check"** (`leakCheckHref(accountId)`, SA-W99), value through `RecordedAboveValue`;
  - the notice (Unknown status): "The recorded AI cost could not be read in time. The charged figures above are unaffected.";
  - the R4-4 sentence, with no business picked only: "Deleted accounts are left out: their recorded calls are deleted with the account.";
  - the R4-10 sentences, one each (a `readonly string[]`, the `ECON_NOTES` shape).
- **`RecordedAboveValue`**: `figure` → `formatUsd(usd)`; `none` → "None", plus the charged-above line when `chargedAboveUsd` is not null; `not_available` → "Not available: AI charging began 29 Sep 2026"; `unknown` → "Unknown".
- **`AccountSummary.tsx`**: one `Line` labelled **"Recorded above charged"** (testid `account-summary-recorded-above`) under "Charged AI cost", rendering `RecordedAboveValue` from the **same** `aiCost.recorded` (one field, rendered twice: AC-158). The recorded figure itself is not repeated (M4-FR-2). Absent when `recorded` is absent.
- **No client arithmetic** (M4-FR-11): the components format only; a new page rule pins it.
- **Copy** (`financeCopy.ts`, new block after `AI_UNREADABLE`): `RECORDED_CAPTION`, `RECORDED_LABEL`, `RECORDED_SOURCE`, `ABOVE_LABEL`, `ABOVE_SOURCE`, `ABOVE_LEAK_LINK`, `ABOVE_NONE`, `aboveChargedAboveLine(usd)`, `ABOVE_NOT_AVAILABLE`, `RECORDED_UNKNOWN`, `RECORDED_NOTICE`, `RECORDED_DELETED_NOTE`, `RECORDED_DISTORTIONS`, `ACCOUNT_RECORDED_ABOVE`. The texts are exactly §11F's (M4-FR-1, R4-4, R4-5, R4-6, R4-10 with E-54's closing sentence).
- Contrast: no `text-slate-500` / `-600` in the new file (the LF-1 rule). `AiCostSection.tsx`'s existing `text-slate-500` (`:126`) predates this step and is not touched.

## B.8 Repository headers (F-7)

Comments only; no code, no export and no public surface change.

**`lib/repositories/AdminTokenUsageAnalyticsRepository.ts:12-17`.** The "ONLY permitted callers" sentence becomes three callers. It adds `app/api/admin/business-os/finance/route.ts`: Finance Section 3's recorded AI cost (Money M-4, OV-5), `listCostPointsAllAccountsInWindow` only, with the Business OS row filter, called only with no business picked, under the route's `requireAdmin`. The isolation guard is unchanged (`:327-345`).

**`lib/repositories/TokenUsageRepository.ts:1-27`.** The caller list is rewritten **in full**:

| Caller | Methods | Reached from |
|---|---|---|
| `lib/business-os/usage/usageSummary.ts` | `usageSummaryByFeatureAndDay`, `listSummaryRowsPage` | the admin LLM usage report |
| `lib/business-os/usage/llmUsageReport.ts` | `listCallsInWindow`, `countInWindow`, `listLabelsInWindow` | `app/api/admin/business-os/llm-usage/route.ts` |
| `lib/business-os/bizql/telemetry/usageReport.ts` | `listChatCallsForAccountInWindow`, `listChatCallsAllAccountsInWindow` | `app/api/admin/chat-usage/route.ts` |
| `lib/business-os/credits/creditLeakCheckDeps.ts` | `listCallsInWindow`, `countInWindow` | the Leak check route and the credit-leak-check cron |
| `lib/business-os/entitlements/report.ts` | `listCallsInWindow` (setup AI measure) | the entitlements shadow report route |
| `app/api/admin/business-os/accounts/[accountId]/summary/route.ts` | `listCallsInWindow` | the Businesses drawer's 30-day figure |
| `app/api/admin/business-os/llm-settings/ledger/route.ts` | `summariseFeatureAllAccountsInWindow` | the ledger check |
| `app/api/admin/business-os/finance/route.ts` (**new**) | `listCallsInWindow` | Finance's picked-business recorded AI cost (M-4) |
| `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` | `buildFeatureFilterOrExpression` (module function), types | — |

Type-only importers are named in one line (`llmUsageVerification.ts`, `creditLeakCheck.ts`). "THE ONE ALL-ACCOUNTS READ" becomes **two named reads**, `listChatCallsAllAccountsInWindow` and `summariseFeatureAllAccountsInWindow` (a fact, already pinned by the contract test's arity map, `:73-74`).

**Traps the rewrite avoids:** the contract test reads the raw source, comments included, for `callCatalog` and `` from '@/lib/business-os `` (`tokenUsageRepository.contract.test.ts:98-99`). The header writes "the call catalog", never the identifier, and gives paths without `from '…'`.

## B.9 Entitlements registration check (Part B)

| Tripwire | Part B |
|---|---|
| A file outside the module newly imports from it | **No.** `recordedCost.ts`, `RecordedCostLines.tsx` and the route add no such import. The finance rule "only `planGroups.ts` and the wiring import the module" (`finance.source.guard.test.ts:194-197`) proves it |
| A listed file's symbol set changes | **No.** `financeHealthDeps.ts` (`enforcementPoints.test.ts:533`) changes one type line (SA-W104); its entitlements import is unchanged |
| A tier name or capability id literal | None |
| Catalog / matrix / gate | None |

`npm run test:bos-entitlements` runs before handover (VB-6).

## B.10 Tenant isolation check (Part B)

- **Service role, caller-supplied id.** The only caller-supplied id is still `accountId`: UUID-validated behind `requireAdmin`, refused if a platform account (`route.ts:179-182`), checked against the plan table **before any read** (`financeHealth.ts:459-468`). Only then does `readRecordedForAccount` receive it. The repository asserts the UUID again and scopes with `.eq('user_id', userId)` (`TokenUsageRepository.ts:355`, `:370`).
- **Picked business (SA-W1, AC-42, AC-157).** With `accountId`, the all-accounts read is **not called**. The picked view still makes no platform-wide read.
- **All accounts.** A deliberate cross-tenant **read**, admin-gated, attributed (`AdminReadContext` on every page's log line), allowed only under `app/api/admin/**` (isolation guard). It returns `id, created_at, cost_usd` only, and the payload carries only sums and states.
- **No write, trigger, upsert or caller-built payload**, so the write half of the skill does not apply.
- **Required test:** a foreign or platform id never reaches either recorded read. The existing 404 cases (`route.test.ts:426-453`) gain `expect` lines for both mocks; `allReads()` includes both, so every 401 / 403 / 400 case proves zero calls.

## B.11 Guard table, line by line (Part B)

| Guard | Part B trips it? | Exact change |
|---|---|---|
| **`finance.source.guard.test.ts:144-147`** ("no aggregate select and no token_usage") | **Yes** (the route now names the usage-log readers) | **Narrowed by SA ruling.** Over every file, the route included: the aggregate rule and `/token_usage\|monthly_token_usage\|business_os_usage_summary/` stay as they are (AGG-4: no file names `.from('token_usage')`). The **reader-name** part moves to `FILES` minus the route and **widens** to `/tokenusage/i` over `codeOf`. That catches `TokenUsageRepository`, `tokenUsageRepository`, `AdminTokenUsageAnalyticsRepository` and `adminTokenUsageAnalyticsRepository` (SA-W103). Title and a reason comment cite SA-RR-M4 |
| Same file, **new `Money M-4` describe** | Added | See the list after this table |
| Same file, every other `FILES` rule (write verb, tier literal, cohort, entitlements importers, livemode, exchange rate, processor literal, `MONEY_*`, `REMINDER_VOCABULARY`, the jobs-read pin `:494-499`) | No; they apply to the new files through the walk | Run unchanged |
| `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts:327-345` (isolation) | **No**: the route is under `app/api/admin/**` | Run unchanged; header amended ([B.8](#b8-repository-headers-f-7)) |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | **No**: no method, arity or optional account filter changes; the header avoids `callCatalog` and `from '@/lib/business-os` | Run unchanged |
| **`route.test.ts` AC-145 baseline** (`:1077-1174`) | **Yes** (one more read; `aiCost.recorded` in the payload) | **Updated once, under E-55.** Only these: `namedReads()` gains `recorded.allAccounts` and `recorded.forAccount`. `EXPECTED_CALLS` gains `'recorded.allAccounts': [[{ correlationId: '<correlationId>', adminId: ADMIN.id }, { start: '2026-10-01T00:00:00.000Z', end: '2026-10-14T23:59:59.999Z' }, { featureFilter: <bosRowFilter()> }, { pageSize: 1000, ceiling: 10000, signal: '<signal>' }]]` and `'recorded.forAccount': []`. `EXPECTED_SHA256` is refreshed. One `expect(body.data.aiCost).toHaveProperty('recorded')`. The comment cites E-55. Every other read call, `EXPECTED_NAME_CALLS` and `EXPECTED_KEYS` stay **unedited** (the hunk list proves it) |
| `route.test.ts` `allReads()` (`:316-326`) | Extended | Both recorded mocks added, so every 401 / 403 / 400 case proves zero calls (AC-157) |
| `route.test.ts` 6a tab cases (`:1226-1377`) | No | Run; a new case asserts AC-167 |
| `app/admin/finance/__tests__/source.guard.test.ts` | No by construction | New M-4 rules: below |
| `financeLinks.test.ts`; the `financeLinks.ts` import pin (`source.guard.test.ts:167-171`) | No: `leakCheckHref` uses literal keys only | New cases |
| `BusinessOsCreditLedgerReadRepository.test.ts` caller list (`:1072-1079`) | **No**: `recordedCost.ts` takes integers, not `CreditLedgerRow` | Run; T6-B (c) pins it |
| `BusinessOsFinanceReadRepository.test.ts`, billing caller lists, `serviceColumn.guard`, `creditLots.test.ts`, webhook placement guards | No | Run unchanged |
| `enforcementPoints.test.ts`, `tierLiteral.forbidden.test.ts` | No (SA-W104) | `test:bos-entitlements` |
| Admin authz surface guard | No: no new route or page | `test:authz-guard` |
| `typecheck:bos-llm` | In scope (the route imports the call catalog) | Run; zero new diagnostics |
| Vocabulary guard (Part A) | Extended | `RecordedCostLines.tsx` joins the scanned files; positive pins for the new labels |

**The new `Money M-4` describe in `finance.source.guard.test.ts`.** Every rule has a planted negative control.
- **(a) Non-vacuity.** `FILES` contains `recordedCost.ts` and `RecordedCostLines.tsx`; `LAYER_B_FREE` contains `recordedCost.ts`.
- **(b) Positive pin, the route.** Exactly one file's code matches `/tokenusage/i`: the route. The method names called on the two readers are exactly `{ listCostPointsAllAccountsInWindow, listCallsInWindow }`. Planted: a builder importing `AdminTokenUsageAnalyticsRepository` joins the namers list; a route calling `tokenUsageRepository.countInWindow(` adds a method.
- **(c) Pure.** `recordedCost.ts` does not match `IMPURE`; names no `CreditLedgerRow`, `BusinessOsCreditLedger`, `business_os_`, `token_usage` or `tokenusage`; no `new Date(` or `Date.now(`.
- **(d) Scale.** Exactly one `/ COST_SCALE`; no `toHundredths`, no `* 100`; `Number.isSafeInteger(` present.
- **(e) Exports exactly** `RecordedRowInput`, `RecordedReadInput`, `RecordedCostInput`, `buildRecordedAiCost`.
- **(f) Never added (R4-11).** No `+` between a recorded identifier and a charged one (`/recorded\w*\s*\+\s*\w*charged|charged\w*\s*\+\s*\w*recorded/i`). The `FinanceRecordedAiCost` interface has exactly the five keys of [B.2](#b2-payload-sa-q54). Planted: `recordedUnits + chargedUnits` is caught.
- **(g) Exactness rule in one place.** `completed` and `reachedCeiling` are each read once in `recordedCost.ts`, under their `kind`, and nowhere in `financeHealth.ts`'s recorded wiring.

**New rules in `app/admin/finance/__tests__/source.guard.test.ts`** (each with a planted control):
- `MONEY_M4 = (?:recordedUsd|chargedAboveUsd|usd|costUsd)`: no page file adds or subtracts two of them (the `MONEY_6A` shape; `MONEY_6A` itself is not edited).
- `RecordedCostLines.tsx` imports only types from `@/lib/business-os/finance/` and has no dim text.
- `AiCostSection.tsx` and `AccountSummary.tsx` render the value only through `RecordedAboveValue` (one renderer, AC-158).

No new CI job and no added critical-path time: every new test runs in the existing Jest gate.

## B.12 AC mapping (Part B)

| T | Test file |
|---|---|
| T1-B | `recordedCost.test.ts` (new) |
| T5-B | `financeHealth.test.ts` |
| T6-B | `finance.source.guard.test.ts` |
| T7-B | finance `route.test.ts` |
| T8-B | `financeLinks.test.ts` |
| T9-B | `recordedCost.render.test.tsx` (new), `financePage.render.test.tsx` |
| T11-B | `financeAccount.render.test.tsx` |
| T12-B | `app/admin/finance/__tests__/source.guard.test.ts` |
| QA | A recorded manual step or SQL check (see the QA report) |

| AC | Test / check |
|---|---|
| **AC-154** | T1-B: a fixture shaped like §11F.1 (recorded 1.942075, charged 1.612137) gives 0.329938, equal to `checkTwentyOne` (a TypeScript port of check 21's SQL over the same fixture). T9-B: both lines beside the charged total; no element's text is their sum. QA: check 21 |
| **AC-155** | T5-B: picked view → the account read only; the figures equal `checkTwentyTwo`. T11-B: the summary line. QA: check 22 |
| **AC-156** | T1-B: 1.94 / 1.61 → 0.33; equal → `none`; charged above → `none` + `chargedAboveUsd`; the deleted bucket is left out with all accounts; 0.1 + 0.2 → 0.3 exactly |
| **AC-157** | T7-B: with `accountId`, the all-accounts mock is called 0 times and the account mock once with that id; with none, the account mock 0 times; 401 / 403 / 400 / 404 → neither (`allReads()`) |
| **AC-158** | T11-B: the summary line and Section 3 show the same text for the same `recorded` object; T12-B: one renderer |
| **AC-159** | T1-B: `starts_before_cutover` and `entirely_before_cutover` → `not_available` with the recorded figure present. T9-B: the text, and the block shows even though Section 3's figures are hidden (SA-W98). QA: a window from 2026-09-15 |
| **AC-160** | T1-B: each read kind not exact → "At least" and Unknown; a null and a `'abc'` cost → `unreadable` 1, same effect. T5-B: an injected small result through the fake read; Section 3's figures deep-equal the run without it |
| **AC-161** | T5-B: the read throws, returns `{ error }`, or never settles (fake timers past 2 s) → `status: 'unknown'`; every other section is present; the late settlement causes no unhandled rejection (`process.on('unhandledRejection')` spy). Ledger not exact → difference Unknown. T9-B: the notice |
| **AC-162** | T7-B: the all-accounts mock receives `end` = `'2026-10-14T23:59:59.999Z'` for October to date (frozen clock), and the account mock receives the `Date` 1 ms before `window.end`. T1-B / T5-B: a fixture row exactly at `end` is excluded by the fake read honouring `lte`, and so not counted |
| **AC-163** | T6-B (f); T5-B: K-1 and `accountMargin` are deep-equal with and without a recorded fixture; T7-B: the tab payload has no `recorded` |
| **AC-164** | T7-B: the info line carries `sections.aiRecorded` and `counts.aiRecorded` as statuses, counts and booleans only; a planted cost, feature value, session id and name appear in no log call; the payload JSON has no `session_id`, `feature`, `cost_usd` or row id |
| **AC-165** | VB-1 to VB-12; `git diff --stat` shows no migration and no repository code (header comments only, VB-11) |
| **AC-166** | Manual, QA: see the QA report (the QA list governs; checks 21 and 22 with the October literal; `durationMs` for This month, a 92-day window and a picked business) |
| **AC-167** | T7-B and T5-B: `tab=accounts` → both mocks 0 calls; `aiCost` has no `recorded`; the 6a tab payload is otherwise unchanged (the existing 6a cases pass unedited) |
| **AC-168** | T1-B: all accounts, `completed` false with fewer rows than the ceiling → "At least" and Unknown; the same rows with `completed` true → the figure; one account, `reachedCeiling` true → "At least" |
| **AC-145 (E-55)** | T7-B: the baseline, updated exactly as in [B.11](#b11-guard-table-line-by-line-part-b); `git diff -U0` of its describe shows only those hunks |

## B.13 Verification plan (Part B)

Each command alone; own exit code; counts pasted.

| # | Command | Evidence |
|---|---|---|
| VB-1 | **Finance:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Pass |
| VB-2 | **Usage-log readers, unchanged:** `npx jest lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts --ci`, then `git diff -U0 -- lib/repositories` shows only `//` comment lines | Pass; comment-only diff |
| VB-3 | **Pages that share the readers:** `npx jest app/admin/analytics app/api/admin/health-summary lib/admin/health app/admin/users app/api/admin/business-os/accounts app/admin/business-os-llm --ci` | Pass |
| VB-4 | **Layout and vocabulary:** `npx jest app/admin/__tests__ app/admin/components app/admin/audit-trail --ci` | Pass |
| VB-5 | **Billing guards and caller lists:** the 6a V-6 list (`BusinessOsBillingEventRepository`, `BusinessOsCreditLedgerReadRepository`, `businessOsEntitlements.imports.guard`, `creditLots`, `serviceColumn.guard`, `firstPaymentStamp.guard`, `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`), then `git diff --exit-code -- lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase` | Pass; exit 0 |
| VB-6 | `npm run test:bos-entitlements` | Exit 0 |
| VB-7 | `npm run test:authz-guard` | Exit 0 |
| VB-8 | `npm run typecheck:bos-llm` | Exit 0 |
| VB-9 | `npm run lint:hooks`; `npx eslint <every touched and new file>` | Exit 0; clean |
| VB-10 | **Scoped `tsc` with a canary**, as VA-10, config `…\scratchpad\tsconfig.m4b.json` outside the worktree; canary in `lib/business-os/finance/recordedCost.ts` | TS2322, then clean |
| VB-11 | `git diff --stat` / `--numstat` read first: no deletion-only file; no `supabase/` or `lib/business-os/billing/` path; `lib/repositories/` comments only; no requirement MD from Dev | Output pasted |
| VB-12 | `npm run schema:check` if the worktree has credentials; otherwise the note "no new column: `cost_usd` is already selected by both readers (`ADMIN_ANALYTICS_COLUMNS.cost`, `TOKEN_USAGE_COLUMNS.call`)" | Output or the note |
| VB-13 | **Checks 21 and 22, for the user / QA** (§13): replace the month `null` with `'2026-10-01 00:00:00+00'` in both (the SA-WR-40 precedent), and the account `null` in check 22 with the owner test account id; compare with Finance → This month in October, or Custom 2026-10-01 to the last day | See the QA report |

**For QA (from the requirement, not a Dev step list):** check 21 `recorded_usd` → "Recorded AI cost"; `not_charged_usd` → "Recorded above charged"; `charged_usd + deleted_accounts_charged_usd` → Section 3's charged total. Check 22 the same for the picked owner account, in Section 3 and in the summary. Live steps: **see the QA report** (6a retro conclusion 6).

## B.14 Logging (Part B)

- **`recordedCost.ts`** logs nothing (pure).
- **`financeHealth.ts`**: one `failed('recorded_ai_cost', err)` on a failed read (the existing shape).
- **The route's info line** (`route.ts:216-251`) gains:
  - `sections.aiRecorded`: `payload.aiCost.recorded?.status ?? 'not_built'`;
  - `counts.aiRecorded`: `{ built: false }` or `{ built: true, read: 'all_accounts' | 'account', outcome: 'ok' | 'failed' | 'deadline', rows: number | null, completed: boolean | null, reachedCeiling: boolean | null, unreadable: number, ms: number }`.
- **Never logged:** an amount, a difference, a feature value, a session id, a name, or a currency total (M4-FR-9, SEC-8).
- The repositories' own log lines are unchanged. The all-accounts read logs the admin, the correlation id and row counts (`AdminTokenUsageAnalyticsRepository.ts:353-358`).
- Errors as `{ err }`. No `console.*` (the finance rule pins it).

## B.15 Estimate (Part B)

About **2 days**, as §11F.2 and SA-Q57 accepted (including the baseline update, F-2). I report at the end of day 1 if the builder and the route are not green.

| Day | Work |
|---|---|
| 0.4 | `recordedCost.ts` + T1-B (including `checkTwentyOne` / `checkTwentyTwo`) |
| 1.0 | Types; `financeHealth.ts` wiring, deadline, counts; route binding and log line; T5-B, T7-B; **AC-145 baseline (E-55)**. **End-of-day-1 checkpoint** |
| 1.5 | `RecordedCostLines.tsx`, `AiCostSection.tsx`, `AccountSummary.tsx`, `financeLinks.ts`, copy; T8-B, T9-B, T11-B |
| 1.75 | Finance guard narrowing and the M-4 describe; page rules; vocabulary guard extension; repository headers |
| 2.0 | VB-1 to VB-12 with the canary; results pasted |

## B.16 Task list (Part B)

- [x] ✅ 0. PR 1 (Part A) merged (PR #398); Part B built on a NEW branch `feature/bos-money-m4b`, cut by RM from `main` `bd7beabd`; SA rulings SA-W98 to SA-W104 applied
- [x] ✅ 1. `recordedCost.ts` + T1-B
- [x] ✅ 2. `financeTypes.ts`; `financeHealth.ts` (deps, limit, `Promise.all`, builder call, counts, header); `financeHealthDeps.ts:101`; T5-B
- [x] ✅ 3. Route binding, `adminReadContext`, log line, header; `route.test.ts` mocks and `allReads()`; **the AC-145 baseline update (E-55), and only it**; M-4 route cases; T7-B
- [x] ✅ 4. `financeLinks.ts` `leakCheckHref`; T8-B
- [x] ✅ 5. `RecordedCostLines.tsx`; `AiCostSection.tsx`; `AccountSummary.tsx`; copy; T9-B, T11-B (plus `FinanceSection.tsx`, deviation BD-2)
- [x] ✅ 6. Finance guard: narrow `:144-147`; the M-4 describe (T6-B); page rules (T12-B); vocabulary guard extension
- [x] ✅ 7. Repository headers ([B.8](#b8-repository-headers-f-7)); VB-2 comment-only proof
- [x] ✅ 8. VB-1 to VB-12; canary; outputs in Implementation Notes
- [ ] 9. Hand over to SA code review, uncommitted (done by Dev); then QA; then RM opens **PR 2 (Part B)**

## B.17 Checklist before SA code review (Part B)

- [x] ✅ `git branch --show-current` = `feature/bos-money-m4b` (Part B's own branch; Part A is in `main` as PR #398); nothing committed; no stash used
- [x] ✅ `git diff --stat` read first: no deletion-only file; no migration; `lib/repositories/` comment-only
- [x] ✅ The route is the only finance file whose code matches `/tokenusage/i`; it calls exactly the two methods
- [x] ✅ With a business picked, the all-accounts read is never called; with `tab=accounts`, neither read is called
- [x] ✅ The all-accounts exactness uses `completed`; the account exactness uses `reachedCeiling` (E-53), decided only in `recordedCost.ts`
- [x] ✅ Both reads receive `end − 1 ms`; the route test asserts the exact ISO value
- [x] ✅ The account read takes no signal; a late result is dropped with no unhandled rejection (test; see BD-6)
- [x] ✅ Integer arithmetic at `COST_SCALE`; one `/ COST_SCALE`; safe-integer check; 0.1 + 0.2 = 0.3
- [x] ✅ No payload field, export or element adds recorded to charged; K-1 and AI margin unchanged by a recorded fixture
- [x] ✅ The AC-145 baseline changed only in the E-55 hunks (plus one proof assertion, BD-5)
- [x] ✅ `TokenUsageRepository` header: full caller list; no `callCatalog`; no `from '@/lib/business-os`
- [x] ✅ No `console.*`; log line has no amount, feature, session id or name
- [x] ✅ Every new guard rule has a planted negative control
- [x] ✅ VB-1 to VB-12 pasted with own exit codes; the canary reported TS2322 before the clean run

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Part A changes a testid, link or rule id by accident | V-5 list in [A.2](#a2-every-string-change-old--new); VA-12 hunk list; the route and rule tests stay out of the diff (AC-151) |
| R-2 | A visible old word survives in a place no test renders | The vocabulary guard scans source, not renders; its negative pins list every "Old" text |
| R-3 | The guard over-matches an identifier or testid | AST-based, with the skip set of SA-W97 and planted false-positive controls |
| R-4 | Recorded is added to charged anywhere | No sum field (B.2); T6-B (f); AC-163 tests |
| R-5 | A truncated all-accounts read prints as exact (F-1) | `completed`, not `reachedCeiling` (E-53), decided in one place; AC-168 |
| R-6 | The 2 s deadline is too short for a 92-day window (about 8 pages today, up to 10) | The figure is Unknown, never wrong; QA records `durationMs` for a 92-day window (M4-FR-12); raising the limit is an SA decision, not a code default |
| R-7 | A late account read rejects unhandled | `settle` inside `underDeadline` (which already swallows); an `unhandledRejection` spy in T5-B |
| R-8 | The Overview payload changes beyond E-55 | The baseline's other pins stay unedited; `git diff -U0` hunk list |
| R-9 | The `TokenUsageRepository` header trips the RC-7 contract test | No `callCatalog` and no `from '@/lib/business-os` in the text; VB-2 |
| R-10 | Another agent's requirement edits appear in the diff | Dev never edits the requirement; VA-11 / VB-11 read the stat first; RM decides what joins each PR |
| R-11 | The junction | Never `git worktree remove`, `git stash` or `npm install`; stop and report instead |
| R-12 | Known noise: the Jest worker-exit warning (FU-4a-3) and load-sensitive render suites (FU-5a-3) | Cite the follow-up; do not re-investigate |
| R-13 | Part B starts before Part A merges | B.16 step 0 is a hard gate |

---

## Implementation Notes

*Dev fills this in while building: files, deviations (each needing SA approval), outputs of VA-1 to VA-12 and VB-1 to VB-13.*

### Part A

**Built 2026-10-15 by Dev on `feature/bos-money-m4`, uncommitted.** No stash, no worktree command, no `npm install`. The requirement MDs were not edited by Dev.

**Files (26 in the diff from Dev, + 1 new)**
- Source (13): `app/admin/finance/financeCopy.ts`, `app/admin/finance/components/AiCostSection.tsx`, `app/admin/analytics/page.tsx`, `app/admin/analytics/components/AnalyticsKpis.tsx`, `app/admin/business-os-llm/costCopy.ts`, `app/admin/business-os-llm/leakCopy.ts`, `app/admin/business-os-llm/activityCopy.ts`, `app/admin/business-os-llm/components/activity/CutoverNotice.tsx`, `lib/admin/health/evaluateHealth.ts`, `app/admin/users/components/BusinessSummaryStrip.tsx`, `app/admin/users/components/BusinessOsPanel.tsx`, `app/admin/users/components/AllProductsUsage.tsx`, `app/admin/users/components/DrawerBox.tsx`.
- Tests (11 modified): the 10 of [A.1](#a1-files), plus `app/admin/finance/__tests__/financePage.render.test.tsx` (SA-WR-46, +25 lines, nothing removed).
- New (1): `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` (416 lines, 128 tests).

**SA conditions**
- **E-59 / SA-W90:** `AiCostSection.tsx` subtitle is `` `${windowLabel}. ${AI_SOURCE}` ``. It is the one non-string change.
- **SA-WR-46:** new case in `financePage.render.test.tsx` pins the Section 3 subtitle as exactly `"<window label>. Credit ledger: …"`, asserts no `", <window label>"` tail and no `"., "`, and pins the title. Nothing asserted the old join before, so no existing assertion was changed. The guard also pins the template shape `${}. ${}` (new) and the absence of `${}, ${}` (old) in `AiCostSection.tsx`.
- **SA-WR-47:** planted controls `aria-label="AI spend"` and `title="Total spend"` each give exactly one offence; `placeholder` and `label` are also controlled.
- **W91–W93 / E-58:** `activityCopy.ts:245` renamed with W-18 (a guard case asserts exactly three `"Charged AI cost (USD)"` in Activity); `DrawerBox.tsx:45` = W-27; `financeCopy.ts:482` = W-28.
- **W94 / W96:** `rules.ts` and the Leak check reason texts are untouched; `rules.ts` is not in the guard.
- **W95:** the seven comments reworded; `health.render` fixture updated; `qa-slice5` and `KpiStrip` untouched.

**Deviations (minor; for SA to confirm)**
1. **Guard skip set, two additions:** besides the SA-W97 set, the guard also skips element-access keys (`o['…']`) and literal types (`type T = 'a' | 'b'`). Neither is shown text. Each has a planted zero-offence control. The JSX `label` prop is scanned, like `aria-label`, `title` and `placeholder`.
2. **Old-text pins:** `"Cost (USD)"` is pinned absent only in `costCopy.ts` and `activityCopy.ts`, because Section 3's `AI_COST` column keeps it (SA-W93). The old Health footnote and W-15 are covered both by exact pins and by the forbidden phrases.
3. **Test titles left as they are:** `businessOsPanel.render.test.tsx:8` (comment) and `:218` (title) still say "AI spend". They pin no string and are not in A.1.
4. **Line wrap:** `AI_SOURCE` now sits on a second line (the line was too long). The string is unchanged.

**Guard non-vacuity:** the same scanner run over the `HEAD` (`b20da2cc`) versions of the 13 files finds **21** offences, and finds **0** after the change. All 38 old-text pins match at `HEAD`, and none of the 38 new-text pins does.

**Verification (each command run on its own; exit code read from the command, not from a pipe)**

| # | Command | Result |
|---|---|---|
| VA-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` | exit 0; 24 suites, 1,781 tests passed |
| VA-2 | `npx jest app/admin/analytics app/api/admin/token-usage --ci` | First run: exit 1, two failures. I had missed two `'Total spend, $1.50'` pins (`analytics.layout.render.test.tsx:346`, `:362`); fixed. Rerun: exit 0; 13 suites, 277 tests passed |
| VA-3 | `npx jest app/admin/business-os-llm app/api/admin/business-os/credits app/api/admin/business-os/llm-settings --ci` | exit 0; 24 suites, 1,031 tests passed |
| VA-4 | `npx jest lib/admin/health app/admin/__tests__ app/admin/components app/api/admin/health-summary --ci` | exit 0; 45 suites, 1,512 tests passed. Named in the output: `aiCostVocabulary.source.guard`, `contrast.lf1.source.guard`, `layoutFolder.guard` |
| VA-5 | `npx jest app/admin/users app/api/admin/business-os/accounts --ci` | exit 0; 27 suites, 624 tests passed |
| Guards | `layoutFolder.guard`, every `app/admin/**/__tests__/*guard*` (14 files, the new guard included), `finance.source.guard` | exit 0; 15 suites, 2,401 tests passed |
| New guard alone | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | exit 0; 1 suite, 128 tests passed |
| VA-6 | `npm run test:bos-entitlements` | First run: exit 1. One 5 s timeout in `creditsBlock.render.test.tsx:412` (OP-32). That file is untouched and the suite is load-sensitive (FU-5a-3, R-12). The suite alone: 69/69 passed. Full rerun: exit 0; 268 suites, 7,994 tests passed |
| VA-7 | `npm run test:authz-guard` | exit 0; 2 suites, 203 tests passed |
| VA-8 | `npm run lint:hooks` | exit 0 |
| VA-9 | `npx eslint --max-warnings 0 <25 touched + new files>` | exit 0, no output |
| VA-10 | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratchpad>/tsconfig.m4a.json` (absolute `extends` to the worktree `tsconfig.json`; `noEmit`, `incremental: false`; include = `types/**/*.d.ts` + the 25 touched `.ts`/`.tsx` files, tests included; the worktree has no `next-env.d.ts`) | Canary `const __canary: number = 'x';` in `financeCopy.ts` → exit 2, `financeCopy.ts(570,7): error TS2322`, 1 diagnostic. Canary removed (`grep -c __canary` = 0) → exit 0, **0 diagnostics** |
| VA-11 | `git diff --stat` / `--numstat` | 26 files, 513 insertions, 88 deletions (this includes BA/SA's requirement MDs: 384+/3− and 1+/1−). **No file has deletions without insertions.** No `supabase/` or `lib/repositories/` path; the one `app/api/` path is a test file. The new guard is untracked (416 lines) |
| VA-12 | `git diff -U0 -- '*.ts' '*.tsx' ':!**/__tests__/**'` | Every changed source line is a string, JSX text or comment, plus the E-59 subtitle line. Where an id sits on a changed line (`testId="strip-ai-spend"`, the `bos_ai_spend` key, `sums.spend24h`/`spend7d`), it is unchanged |

**`console.*`:** none of the touched or new files has a `console.*` call (count 0 each).

**Visible strings changed, old → new (as the user reads them)**

*Finance*
1. KPI tile: "AI cost this month" → "Charged AI cost this month"
2. Section 3 title: "AI cost in the window" → "Charged AI cost in the window"
3. Section 3 subtitle: "Credit ledger, charges and corrections, ‹window›" → "‹window›. Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it."
4. Section 3 total: "AI cost (USD)" → "Charged AI cost (USD)"
5. "Top 10 businesses by AI cost" → "Top 10 businesses by charged AI cost"
6. Link note: "For the provider-side token measure, see" → "Every recorded AI call, charged or not:" (the link "AI cost & usage" is unchanged)
7. Account summary: "AI cost, charged" → "Charged AI cost"
8. Account cut-over note: "…: see AI cost in the window below." → "…: see Charged AI cost in the window below."
9. Accounts tab column: "AI cost, charged (USD)" → "Charged AI cost (USD)"
10. Accounts tab note: "AI cost is the charged cost (credits we billed)." → "AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here."
11. Accounts tab sort: "AI cost, highest first" → "Charged AI cost, highest first"

*AI cost & usage*

12. Business OS scope note: "Business OS only: includes legacy-tagged Business OS rows. Costs are USD, estimated from the model pricing table." → "Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, including calls before charging started on 29 Sep 2026 and legacy-tagged Business OS rows. USD, priced from the model price table. The charged cost is on Finance."
13. All scope note: "Both products. Costs are USD, estimated from the model pricing table." → "Recorded AI cost, both products: every AI call in the usage log. USD, priced from the model price table."
14. KPI tile: "Total spend" → "Recorded AI cost"
15. Category tile sub-line: "‹n›% of spend · …" → "‹n›% of recorded cost · …"

*Business OS AI*

16. Costs intro: "What Business OS actions cost us (USD, the provider’s measured cost) and what we charged (credits), per account and billing period. Read from the credit ledger; nothing here changes it." → "Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) and what we charged (credits), per account and billing period. Read from the credit ledger; nothing here changes it. Monthly totals are on Finance."
17. Fallback note: "…because the measured price was missing — a deliberate over-estimate…" → "…because the model had no price in the price table: a deliberate over-estimate…"
18. Costs KPI: "Cost (USD)" → "Charged AI cost (USD)"
19. Leak check clean: "No uncharged AI spend found" → "No recorded AI cost left uncharged"
20. Leak check found: "‹n› businesses with uncharged AI spend (‹$› not charged)" → "‹n› businesses with recorded AI cost not charged (‹$›)"
21. Leak check status: "Uncharged spend" → "Recorded, not charged"
22. Activity intro: "…whether it worked and what it cost." → "…whether it worked and its charged AI cost."
23. Activity KPI: "Cost (USD, net)" → "Charged AI cost (USD, net)"
24. Activity table column, drill-down field and corrections column (three places): "Cost (USD)" → "Charged AI cost (USD)"
25. Activity cut-over line: "…AI action entries or Cost Analytics." → "…AI action entries or the recorded AI cost in AI cost & usage."
26. Activity cut-over link: "Cost Analytics (Business OS)" → "AI cost & usage (Business OS, recorded)"

*Health*

27. Tile title: "Business OS AI spend (USD, estimated)" → "Recorded AI cost (USD)"
28. Figures: "AI spend, last 24 h (USD)" / "AI spend, last 7 days (USD)" → "Recorded AI cost, last 24 h (USD)" / "Recorded AI cost, last 7 days (USD)"
29. Link label (read aloud): "Business OS AI spend, ‹window›: ‹$›, open in AI cost & usage" → "Recorded AI cost, ‹window›: ‹$›, open in AI cost & usage"
30. Footnote, first sentence: "USD, estimated from the model pricing table; never mixed with a business currency." → "USD: every Business OS AI call in the usage log, charged or not, priced from the model price table; never mixed with a business currency. The charged AI cost is on Finance." (the OI-P2 sentence is unchanged)

*Businesses drawer*

31. Strip label: "Business OS AI, 30 days" → "Recorded AI cost, 30 days"
32. Figure sub-text: "estimated" / "estimated, a lower bound" → "recorded" / "recorded, a lower bound"
33. Box heading: "Business OS, last 30 days (USD estimated)" → "Recorded AI cost, Business OS, last 30 days (USD)"
34. Box purpose line: "Estimated cost of this business's Business OS AI calls, in USD." → "Recorded AI cost of this business's Business OS AI calls, in USD."
35. All products title: "All products, token records (30 days; may be incomplete above 1,000 calls)" → "All products, recorded AI cost (30 days; may be incomplete above 1,000 calls)"
36. All products list: "Cost by Model (highest cost first)" → "Recorded AI cost by model (highest first)"
37. All products field: "Total Cost" → "Recorded AI cost"

**Not done (by design):** Part B; the AC-153 manual checks (see the QA report); the commit and PR (RM, after SA + QA + the user's diff view).

### Part B

**Built 2026-10-15 by Dev on `feature/bos-money-m4b` (RM cut it from `main` `bd7beabd`, after PR #398), uncommitted.** No stash, no worktree command, no `npm install`, no migration. The requirement MDs were not edited by Dev.

**Files (19 modified, 4 new)**
- New: `lib/business-os/finance/recordedCost.ts` (139 lines), `app/admin/finance/components/RecordedCostLines.tsx` (102), `lib/business-os/finance/__tests__/recordedCost.test.ts` (227, 25 tests), `app/admin/finance/__tests__/recordedCost.render.test.tsx` (167, 11 tests).
- Source (11): `financeTypes.ts`, `financeHealth.ts`, `financeHealthDeps.ts` (the `Omit<>`, SA-W104), the finance `route.ts`, `financeCopy.ts`, `financeLinks.ts`, `AiCostSection.tsx`, `AccountSummary.tsx`, `FinanceSection.tsx` (BD-2), and the two repository headers (comments only).
- Tests (8): `financeHealth.test.ts`, `finance.source.guard.test.ts`, the finance `route.test.ts`, the page `source.guard.test.ts`, `financeLinks.test.ts`, `financeAccount.render.test.tsx`, `financePage.render.test.tsx`, `aiCostVocabulary.source.guard.test.ts`.

**SA conditions**
- **SA-WR-48:** both bindings pass `bosRowFilter()`. The route tests assert `featureFilter` deep-equals `bosRowFilter()` (in the E-55 baseline and in the M-4 describe) and the account read's third argument deep-equals it. Source pin: each binding has exactly one `bosRowFilter()`, with a planted control for each binding.
- **SA-WR-49:** `RECORDED_DEADLINE_MS: 2 * 1000`, pinned in `financeHealth.test.ts`. QA's 92-day `durationMs` goes to SA before the PR; Dev did not tune it.
- **SA-WR-50:** a T5-B case spies on the pure builder (pass-through `jest.mock`). With a business picked, `charged.totalUnits` = 3 × `COST_SCALE`, equal to Section 3's figure × `COST_SCALE`, and `deletedUnits` = 0.
- **W103:** the name rule reads `codeOf`. `BusinessOsFinanceReadRepository.ts` names `TokenUsageRepository` in a comment: it matches raw and does not match as code (both asserted).
- **W104:** the `Omit<>` lists exactly `findNames`, `readReminderFigures`, `readRecordedAllAccounts` and `readRecordedForAccount` (pinned). The entitlements import is unchanged (`getEntitlementConfig` only; existing pin green; `test:bos-entitlements` green).
- **F-7:** `TokenUsageRepository` header rewritten in full: 8 callers with methods and entry routes, 2 type-only importers, and "THE TWO ALL-ACCOUNTS READS". It avoids `callCatalog` and `from '@/lib/business-os` (contract test green). The `AdminTokenUsageAnalyticsRepository` header now names three permitted callers.

**Guards added (each with a planted control)**
- `finance.source.guard`: the `:144-147` rule split.
  - The `token_usage` / view names stay on every file, the route included.
  - New rule: `/tokenusage/i` over code, every file but the route, with 4 planted names.
  - New M-4 describe:
    - (a) non-vacuity;
    - (b) only the route names a reader; it calls exactly two methods; `bosRowFilter()` once per binding; `inclusiveEnd`;
    - (c) purity;
    - (d) one `/ COST_SCALE`, safe-integer checks;
    - (e) exactly 4 exports;
    - (f) no recorded + charged anywhere; `FinanceRecordedAiCost` has exactly 5 keys;
    - (g) E-53: each flag is read once in `recordedCost.ts`, and neither appears in `financeHealth.ts`'s two marked recorded regions;
    - W104.
- Page `source.guard`:
  - `MONEY_M4` arithmetic over every page file;
  - no dim text, and type-only finance imports, in `RecordedCostLines.tsx`;
  - one renderer (AC-158);
  - the SA-W98 slot.
- Vocabulary guard: `RecordedCostLines.tsx` joins (14 files, minimum 7 texts); 7 positive pins for the new labels.

**Deviations (for SA)**
1. **BD-1:** `buildRecordedAiCost` returns `{ recorded, counts }`, not `{ recorded, unreadable }`.
   - `counts` holds `rows`, `completed`, `reachedCeiling` and `unreadable`, so the read flags are read only in `recordedCost.ts` (rule g) and can still be logged.
   - `financeHealth.ts` passes each read result through by spread.
   - The exports are unchanged (4).
2. **BD-2:** `FinanceSection.tsx` gains an optional `alsoWhenUnknown` slot, rendered only when the section is `unknown`.
   - Why: the frame hides its children when `unknown`, so SA-W98 ("shows when Section 3 is Unknown") could not be met inside `AiCostSection` alone. B.1 did not list this file.
   - With no prop, the DOM is unchanged. Render tests show the block appears exactly once in each state.
3. **BD-3:** the block sits **directly under the charged total**: the figures guard is split in two around it. It stays outside that guard (SA-W98) and under the total (M4-FR-1).
4. **BD-4:** `counts.aiRecorded.ms` is `number | null` (null is not reachable in practice).
5. **BD-5:** the AC-145 hunks are exactly E-55's: the header comment, 2 `namedReads`, 2 `EXPECTED_CALLS` entries, the hash, and the `recorded` assertion. One proof was **added**: the payload with `aiCost.recorded` removed still hashes to the 6a value `b4d10bc1…`. New hash: `6761620e6fb59c9df83ec19b6ba0b534929bca660e7b3dbd2e271356e11b5250`.
6. **BD-6:** Jest fails the running test on any unhandled rejection, so a `process.on('unhandledRejection')` spy never fires.
   - Control: a planted `void Promise.reject(new Error('planted unhandled'))` in the late-rejection test made it **fail** with that error (run once, then removed).
   - The test relies on this Jest behaviour, and says so in a comment.
7. **BD-7:** the fourth R4-10 sentence is written as "By design, Recorded above charged includes chat turns outside the call catalog, platform-account calls and cache-served turns at USD 0." The requirement gives a clause, not a sentence. BA to confirm the wording.
8. **BD-8:** the `AdminTokenUsageAnalyticsRepository` header also renames "Cost Analytics" to "AI cost & usage" (SA Part A comment 2). Comments only.
9. **BD-9:** `makeDeps()` in `financeHealth.test.ts` gains the two recorded reads as defaults, so the 117 existing cases keep the real happy path. No existing assertion was edited.

**Verification (each command alone; exit code from the command)**

| # | Command | Result |
|---|---|---|
| VB-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | exit 0; 27 suites, 2,239 tests |
| VB-2 | `npx jest lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts --ci` (both unchanged) | exit 0; 2 suites, 28 tests. `git diff -U0 -- lib/repositories`: **0** changed lines that are not `//` comments |
| VB-3a | `npx jest app/admin/users app/api/admin/business-os/accounts --ci` | exit 0; 27 suites, 624 tests |
| VB-3b / VB-4 | `npx jest app/admin/__tests__ app/admin/components lib/admin/health app/api/admin/health-summary --ci` | exit 0; 45 suites, 1,521 tests |
| VB-3c | `npx jest app/admin/analytics app/api/admin/token-usage --ci` | exit 0; 13 suites, 277 tests |
| VB-3d | `npx jest app/admin/business-os-llm --ci` | exit 0; 17 suites, 854 tests |
| Vocabulary | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | exit 0; 1 suite, 137 tests |
| New builder | `recordedCost.test.ts` / `recordedCost.render.test.tsx` | 25 / 11 tests passed (inside VB-1) |
| VB-5 | the 9 V-6 guard and caller-list suites | exit 0; 9 suites, 425 tests. `git diff --exit-code -- lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase`: exit 0 |
| VB-6 | `npm run test:bos-entitlements` | exit 0; 269 suites, 7,984 tests |
| VB-7 | `npm run test:authz-guard` | exit 0; 2 suites, 203 tests |
| VB-8 | `npm run typecheck:bos-llm` | exit 0, "passed". It also prints "1 baseline entry is fixed" for `app/api/onboarding/build/route.ts` (TS18047), a file outside this diff |
| VB-9 | `npm run lint:hooks`; `npx eslint --max-warnings 0 <23 touched and new .ts/.tsx>` | exit 0; eslint first gave 2 unused-variable warnings in two tests (fixed), then exit 0 with no output |
| VB-10 | Scoped `tsc`, config `<scratchpad>/tsconfig.m4b.json` outside the worktree (absolute `extends`; `noEmit`; `incremental: false`; include = `types/**/*.d.ts` + the 23 touched and new `.ts`/`.tsx`, tests included) | Canary `const __canary: number = 'x';` in `recordedCost.ts` → exit 2, `recordedCost.ts(140,7): error TS2322`. Restored from a byte copy (`cmp` identical, `grep -c __canary` = 0). Clean run → exit 0, **0 diagnostics**, repeated after the lint fixes |
| VB-11 | `git diff --numstat` + untracked | 19 modified files, +1,266 / −46, 4 new files (635 lines). **No file has deletions without insertions.** No `supabase/`, billing or requirement-MD path; `lib/repositories/` comments only |
| VB-12 | Schema | No credentials in the worktree. No new column: `cost_usd` is already selected by both readers (`ADMIN_ANALYTICS_COLUMNS.cost`, `TOKEN_USAGE_COLUMNS.call`) |
| VB-13 | Checks 21 and 22 | For QA: see the QA report. The TypeScript ports (`checkTwentyOne` / `checkTwentyTwo`) agree with the builder on a §11F.1-shaped fixture (1.942075 / 0.329938) |

**`console.*`:** none of the touched or new files has a `console.*` call (the two guard tests hold `/\bconsole\./` as a pattern, not a call).

**Not done (by design):** checks 21 and 22 on the live database, and the AC-166 `durationMs` timings for This month, a 92-day window and a picked business (QA; SA-WR-49 if the 92-day read nears 2 s); the commit and PR (RM).

**Fix round 1 (SA low follow-up, 2026-10-15).** The recorded-read failure notice said "The charged figures above are unaffected", even when no charged figure was shown above it.
- **Change.**
  - `RecordedCostLines` takes `chargedShown`. `AiCostSection` sets it to `status !== 'unknown' && figures !== null && !entirelyBefore`.
  - When the charged figures rendered, the notice stays `RECORDED_NOTICE`.
  - Otherwise it is the new `RECORDED_NOTICE_PLAIN`: "The recorded AI cost could not be read in time."
  - Both texts live in `financeCopy.ts`. The page guard's `AiCostSection` pin now includes `chargedShown={chargedShown}`.
- **Tests.** Three render cases in `recordedCost.render.test.tsx`:
  - charged figures shown → the full notice;
  - charged read failed → the plain notice, with no "above" or "unaffected";
  - window entirely before the cut-over → the plain notice.
- **Re-run** (each alone):

  | Run | Exit | Result |
  |---|---|---|
  | Finance (VB-1 set) | 0 | 27 suites, 2,242 tests |
  | Vocabulary guard | 0 | 137 tests |
  | `lint:hooks` | 0 | — |
  | ESLint on the 5 touched files | 0 | no output |
  | Scoped tsc, canary in `RecordedCostLines.tsx` | 2 | `(113,7): error TS2322` |
  | Scoped tsc, after restoring (`cmp` identical) | 0 | 0 diagnostics |
- **Diff.** 21 tracked files plus 4 new; no deletion-only file. The requirement MD's +2 is not from Dev.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-15, against `b20da2cc` and §11F (with E-53 to E-57 and the BA's E-54 applied)**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Part A may start now. Part B starts only after PR 1 merges (B.16 step 0, a hard gate). Apply SA-WR-46 to SA-WR-50 while building; SA verifies them at code review. SA applied E-58 and E-59 to the requirement.

**Release gate:** the user has **not** given a no-diff-review go-ahead for M-4. Each part stops after SA and QA for the user's diff view. RM opens a PR only after the user approves.

### How it was checked (I read the code myself)

**Part A**
- Every A.2 "Old" literal is where the table says. `AiCostSection.tsx:81` is the only file outside the copy modules that consumes `AI_SOURCE`.
- No row changes an identifier, testid, metric id, rule id, URL key or href; the V-5 list in A.2 matches the code.
- Health behaviour is unchanged: `rules.ts` and the rule tests stay out of the diff, and only labels in `evaluateHealth.ts` change.

**Part B: the two reads**
- `listCostPointsAllAccountsInWindow` checks only `start <= end` (`:239`), so a 92-day window is legal.
- Its `reachedCeiling` is `!completed && rows >= ceiling` (`:350`), so E-53's use of `completed` is the right fix.
- `listCallsInWindow` sets `reachedCeiling = rows >= ceiling` (`:393`) and has no completion flag; the accepted edge is unchanged.
- `underDeadline` already attaches `work.catch` and `deadline.catch` and clears its timer (`readUnderDeadline.ts:56-62`), so a race-only account read cannot reject unhandled.
- The Costs tab's business key is `account` (`costsFilters.ts:43`), so SA-W99's href is right.

**Part B: payload, baseline and guards**
- The payload is optional, with five keys and no sum.
- The AC-145 baseline is changed only in the E-55 hunks.
- The guard is narrowed to `/tokenusage/i` over `codeOf`, and the route is pinned to exactly the two methods.
- The `TokenUsageRepository` header is rewritten in full, and avoids the two strings the contract test greps for (`:98-99`).
- The isolation guard and the contract test are run unchanged (VB-2).

**Mapping and estimate**
- The AC mapping covers AC-150 to AC-153 (A.6) and AC-154 to AC-168 plus AC-145 (B.12).
- Canaries are in VA-10 and VB-10.
- Estimates of about 1 + 2 days are accepted, with an end-of-day-1 checkpoint in Part B.

### Rulings SA-W90 to SA-W104

| # | Ruling |
|---|---|
| **SA-W90** | **Approved:** `` subtitle={`${windowLabel}. ${AI_SOURCE}`} ``. It follows the `TAKINGS_SUBTITLE` order, and it is a ruled exception to V-5 (a join of copy, not a figure). Recorded as E-59. |
| **SA-W91** | **Approved:** `activityCopy.ts:245` joins W-18 (E-58). |
| **SA-W92** | **Approved as W-27** (`DrawerBox.tsx:45`, E-58). `DrawerBox.tsx` joins the guard's file list. |
| **SA-W93** | **Approved as W-28** (`financeCopy.ts:482`, E-58). The other bare "AI cost" strings on the Accounts tab and Section 3's "Cost (USD)" column stay: no forbidden phrase, and W-9 defines the term. |
| **SA-W94** | **Approved: leave the Health rule descriptions and metric labels.** `rules.ts` stays out of the guard, and AC-151 keeps the rule tests unedited. This is a V-3 exception, recorded with a reason in E-59, with the rewording deferred to M-5 (FU-M4-1, §0.4). |
| **SA-W95** | **Approved:** reword the seven comments and update the `health.render` fixture. `qa-slice5` and `KpiStrip` stay. |
| **SA-W96** | **Approved: leave the Leak check reason texts.** They describe usage paths, not the name of a figure. |
| **SA-W97** | **Approved: the skip set and the location.** It uses the TypeScript AST, folds `+` chains and collapses whitespace. `aria-label`, `title` and `placeholder` values are **scanned**, because they are read aloud or shown (SA-WR-47). |
| **SA-W98** | **R4-5 is right.** Render the block outside the `f && !entirelyBefore` guard, after the cut-over notice, whenever `aiCost.recorded` is present. |
| **SA-W99** | **Approved:** `leakCheckHref(accountId \| null)` → `/admin/business-os-llm?tab=costs`, plus `&account=<id>` when a business is picked. No window key; literal keys only. |
| **SA-W100** | **Approved:** reuse `underDeadline` with `FINANCE_LIMITS.RECORDED_DEADLINE_MS = 2000`. The account binding ignores the signal. No new race helper. |
| **SA-W101** | **Approved:** the B.2 names and the B.3 rule order. Read failed comes first, then Not available, then Unknown, then the difference, which matches the M-3 precedence. One notice text covers both a failure and a deadline. |
| **SA-W102** | **Approved:** the charged side's exactness is Section 3's `figures.exact`. Unresolved corrections stay in the charged total. |
| **SA-W103** | **Approved:** `codeOf`, `/tokenusage/i`. The AGG-4 `token_usage` rule stays over every file, the route included. |
| **SA-W104** | **Approved:** one type line in `financeHealthDeps.ts:101`. Its import symbols from the entitlements module are unchanged; `test:bos-entitlements` proves it. |

### Required changes (SA verifies at code review)

1. **SA-WR-46 (Medium, Part A). The subtitle pin.** Add a render test that pins Section 3's subtitle as "`<window label>`. Credit ledger: …" and contains no ", `<window label>`" tail. Update any existing assertion on the old `${AI_SOURCE}, ${windowLabel}` text in the same diff.
2. **SA-WR-47 (Low, Part A). The guard scans attribute text.** The guard's planted controls include `aria-label="AI spend"` and `title="Total spend"`. Each gives one offence.
3. **SA-WR-48 (Medium, Part B). The Business OS filter is pinned on both reads.** Without it, the all-accounts read would count agent-platform calls too.
   - Route tests assert that `featureFilter` deep-equals `bosRowFilter()` for the all-accounts read (in the E-55 baseline) and that the third argument of the account read deep-equals `bosRowFilter()`.
   - A source pin: both bindings in `route.ts` pass `bosRowFilter()`, with a planted control that has one filter removed.
4. **SA-WR-49 (Medium, Part B). The deadline is not tuned silently.** `RECORDED_DEADLINE_MS` is 2000 and pinned. If QA's `durationMs` for a 92-day window shows the recorded read near or past 2 s, Dev and QA report to SA before the PR. The constant is changed only by SA ruling.
5. **SA-WR-50 (Low, Part B). Picked view equals the tab row.** With a business picked, a T5-B case asserts that `charged.totalUnits` equals Section 3's account units and `deletedUnits` is 0. This proves the one-rule-serves-both claim of B.3.

### Requirement edits (SA applied; recorded in §0.3 as SA-WP-M4)

- **E-58 (§11F.4).**
  - W-18 gains `:245` (`CORRECTION_COLUMNS.cost`).
  - New rows: W-27 (`DrawerBox.tsx:45`, "Estimated cost of …" → "Recorded AI cost of …") and W-28 (`financeCopy.ts:482`, "see AI cost in the window below" → "see Charged AI cost in the window below").
  - AC-150 covers W-1 to W-28.
- **E-59 (§11F.3).**
  - V-5 gains: "One ruled exception: Section 3's subtitle join becomes `${windowLabel}. ${AI_SOURCE}` (SA-W90)."
  - V-3 gains: "The Health rule descriptions and metric labels (`rules.ts`) keep 'spend' until M-5 (SA-W94, FU-M4-1); the Leak check reason texts describe usage paths and keep it (SA-W96)."

---

## SA Code Review

### Part A (OV-1)

**Code Review by SA — 2026-10-15** (uncommitted on `feature/bos-money-m4`: 13 source files, 11 tests and one new guard)
**Status:** ✅ **Code Approved.** Nothing blocks QA. The user has given the go-ahead for M-4, so after QA passes, RM may commit and open PR 1.

**1. Strings.** I read every changed source line.
- All 37 visible strings match §11F.4 W-1 to W-28 and CR §6.
- **Ledger figures say Charged:** Finance, Costs & credits and Activity.
- **Usage-log figures say Recorded:** AI cost & usage, the Health tile, the drawer, All products, and the Activity cut-over link to analytics.
- No swap, no misspelling.
- Capitalisation is consistent. "Charged AI cost" or "Recorded AI cost" starts each label. Mid-sentence it is lower case ("by charged AI cost", "the recorded AI cost"). The one exception is W-28's "see Charged AI cost in the window below", which quotes the Section 3 title and is right.
- The Leak check's "Recorded, not charged" is its per-call figure (E-54 keeps it).

**2. Identifiers and Health behaviour.** No testid, rule id, metric id, URL key, href or payload field changes. `strip-ai-spend`, `bos_ai_spend`, `spend24h` and `spend7d` are untouched. In `evaluateHealth.ts` only the title, the two figure labels, the link label, the footnote's first literal and one comment change. `rules.ts` and the rule and metric tests are not in the diff (AC-151). Labels are not used as keys in product code (`grep`); only tests look figures up by label, and those are updated.

**3. W90 / E-59.** `AiCostSection.tsx:81` now renders `` `${windowLabel}. ${AI_SOURCE}` ``. The SA-WR-46 render test pins the full text, with no ", window" tail and no "., ".

**4. The vocabulary guard.**
- **What it reads:** the TypeScript AST over the 13 files.
- **What it scans:** literals, templates, JSX text, and attribute values including `aria-label`, `title`, `placeholder` and `label`.
- **What it skips:** testid, `testId`, `className`, `key`, `id` and `href` values, identifiers, property names, imports, comments, element-access keys and literal types.
- **Controls:** every rule has a planted control, 10 that must find one offence and 12 that must find none, including the SA-WR-47 `aria-label` and `title` controls.
- **Pins:** the per-file minimum counts and the empty allow-list (with its no-slack rule) are pinned.
- **HEAD count re-done by SA.** I ran the guard's own scanner, transpiled from the test file, over `git show HEAD:` copies of the 13 files. It gives **21 offences at HEAD and 0 now**: AnalyticsKpis 1, page 2, activityCopy 2, costCopy 2, leakCopy 3, financeCopy 1, BusinessOsPanel 3, DrawerBox 1, evaluateHealth 6. The Dev's count is real.

**5. Deviations.**

| # | Ruling |
|---|---|
| D1 | ✅ **Approved.** Skipping element-access keys and literal types is right: neither is shown, and each has a zero-offence control. |
| D2 | ✅ **Approved.** "Cost (USD)" is pinned absent only in `costCopy` and `activityCopy`. Section 3's column keeps it (SA-W93), and the three Activity labels are pinned at exactly 3 × "Charged AI cost (USD)". |
| D3 | **Leave it.** `businessOsPanel.render.test.tsx:8` and `:218` are a test comment and a test title, not copy. The guard rightly never scans tests. Optional: reword them in Part B if the file is touched. |

**Code Review Comments (Low; follow-ups, not conditions)**
1. `lib/cron/bosCronJobs.ts:452`: the Jobs page description "Checks that yesterday's Business OS AI spend was all charged" is visible but outside §11F.4. Record it with FU-M4-1 for M-5 (the Leak check cron). Priority: Low.
2. The log message at `creditLeakCheck.ts:787` and the repository header comments still say "AI spend" and "Cost Analytics". They are not visible. Part B rewrites the `AdminTokenUsageAnalyticsRepository` header anyway (B.8). Priority: Low.

**6. Re-run by SA.** One suite at a time, each with its own exit code:

| Run | Result |
|---|---|
| Vocabulary guard | exit 0, 1 suite, 128 tests |
| Finance (`lib/business-os/finance`, `app/admin/finance`, finance route) | exit 0, 24 suites, 1781 tests |
| Analytics (+ `app/api/admin/token-usage`) | exit 0, 13 suites, 277 tests |
| Business OS AI (`app/admin/business-os-llm`) | exit 0, 17 suites, 854 tests |
| Users (+ `app/api/admin/business-os/accounts`) | exit 0, 27 suites, 624 tests |
| Health (`lib/admin/health`, `app/admin/__tests__`, `app/admin/components`, health-summary route) | 44/45 suites, 1511/1512 tests. The one failure is `jobsQueues.layout.render.test.tsx` ("a failed Refresh keeps the tiles…"), **not in the diff**, a load flake. **Re-run alone: exit 0, 18/18** |
| `npm run test:bos-entitlements` | 267/268 suites. 2 failures, both in `creditsBlock.render.test.tsx` (the known load-sensitive suite, **not in the diff**; it passed in the users run above). **Re-run alone: exit 0, 69/69** |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Code Approved for QA: Yes**

### Part B (OV-5)

**Code Review by SA — 2026-10-15** (uncommitted on `feature/bos-money-m4b`, from `bd7beabd`: 4 new files, 11 source files, 8 tests)
**Status:** ✅ **Code Approved.** Nothing blocks QA. The user has pre-authorised commit and PR after SA and QA.

**Verified in code**

*`recordedCost.ts`*
- **Exactness (E-53, F-1).** All-accounts exactness comes from `completed`, and one-account exactness from `reachedCeiling === false`. Each flag is read once, in `recordedCost.ts`, and never derived from a row count (AC-168 tests).
- **Integer arithmetic.** Every cost goes through `toUnits` at `COST_SCALE`; NaN is counted as unreadable. The overflow check uses `isSafeInteger` on the sum and the difference, and `usdOf` holds the only `/ COST_SCALE`.
- **The difference.** It is recorded minus (total − deleted). Charged above recorded gives "None" plus `chargedAboveUsd`; a negative "above" is never produced.
- **Rule order.** Failed first, then Not available, then Unknown, then the difference.

*Wiring (`financeHealth.ts`, `route.ts`)*
- **Deadline.** The recorded read is inside the one `Promise.all` under `underDeadline` at `RECORDED_DEADLINE_MS = 2000` (pinned). The account read is raced only; no signal reaches it.
- **Tab and picked view.** `tab=accounts` returns `null` and no read runs (AC-167). With a business picked, only `readRecordedOne(accountId)` runs. Charged comes from Section 3's own `aiCostUnits` and `figures.exact` (SA-W102); SA-WR-50 has a pass-through spy test.
- **Bindings.** The route binds `listCostPointsAllAccountsInWindow` (admin context, `{ featureFilter: bosRowFilter() }`, 1000/10000, signal) and `listCallsInWindow(id, …, bosRowFilter(), 1000/5000)`.
- **Window end.** Both bindings get `inclusiveEnd = end − 1 ms`, pinned at `2026-10-14T23:59:59.999Z`.
- **Admin context.** `reminderContext` was renamed `adminReadContext`; it is the same object, so the reminder call is unchanged.

*Payload*
- `aiCost.recorded` is optional and has five keys, none of them a sum. It is absent on the tab.
- Nothing adds recorded to charged. The source rule (f) has a planted `recordedUnits + chargedUnits` control, and K-1 and AI margin are deep-equal with and without a recorded fixture.

*AC-145 (E-55)*
- The only baseline edits are the two mocks in `namedReads`, the `recorded.allAccounts` expected call (with `serialise(bosRowFilter())` and end − 1 ms), `'recorded.forAccount': []`, the refreshed hash `6761620e…`, and `toHaveProperty('recorded')`.
- A new check deletes `aiCost.recorded` and gets the 6a hash `b4d10bc1…` back. That proves this one key is the only change to the bytes.
- Every other read call, the `findNames` calls and the top-level keys are unedited.

*Guards*
- The `token_usage` / view rule stays over every file. The reader rule is `/tokenusage/i` over `codeOf` (comments stripped), excludes the route, and has planted controls.
- **Positive pins:** only the route names a reader in code; it calls exactly `listCallsInWindow` and `listCostPointsAllAccountsInWindow`; and `bosRowFilter()` appears once per binding, with a planted filter-removed control (SA-WR-48).
- **Repository headers:** the `git diff -U0 -- lib/repositories` lines that do not start with `//` are empty, so the change is comments only. The isolation and contract tests pass unchanged (28/28).

*Page*
- **W98.** The block renders outside the figure guard, so it shows before the cut-over and with charged Unknown.
- **Leak check link.** `leakCheckHref` gives `?tab=costs`, plus `&account=<id>` when a business is picked. That is the Costs tab's own key (`costsFilters.ts:43`).

*W104, logs, admin gate*
- **W104.** `financeHealthDeps.ts`'s `Omit<>` gains exactly the two route-injected keys. Its entitlements import is unchanged, and `test:bos-entitlements` is green.
- **Logs.** `counts.aiRecorded` carries the read kind, the outcome (ok, failed or deadline), rows, flags, unreadable and ms. It never carries an amount; AC-164 has a planted-value test.
- **Admin gate.** `requireAdmin` is still the first statement (route source test). No `console.*`.

**Deviations**

| # | Ruling |
|---|---|
| D1 | ✅ **Approved.** `alsoWhenUnknown` is the right shape. It is optional and rendered only when `status === 'unknown'`. A section that passes none renders the DOM it rendered before. It cannot double-render, because the frame hides children exactly when it shows the slot. `FinanceSection` is page-local to Finance, not the shared layout folder, so no layout ruling is needed. |
| D2 | ✅ **Approved.** `{ recorded, counts }` keeps the two read flags in the one file (E-53). `counts` is non-wire, with no amount. |
| D3 | ✅ **Approved.** The block sits directly under the charged total, inside its own bordered box with the caption "Beside the charged cost, never added". |
| D4 | ✅ **Approved.** Jest itself fails a test on an unhandled rejection; the Dev proved this with a planted `Promise.reject`, and that a `process.on` spy never fires. The test therefore relies on Jest's failure plus an assertion that the late result is dropped. |
| D5 | ✅ **Wording confirmed.** "By design, Recorded above charged includes chat turns outside the call catalog, platform-account calls and cache-served turns at USD 0." This says what R4-10 already says (E-54 wording), so **no E-edit is needed**. |

**Code Review Comments (Low; follow-ups, not conditions)**
1. `RecordedCostLines.tsx`: `RECORDED_NOTICE` says "The charged figures above are unaffected." When the charged read has also failed (the `alsoWhenUnknown` path), that clause is true but there are no figures above it. Acceptable; reword in M-5 if wanted. Priority: Low.

**Re-run by SA** (one at a time, own exit codes)

| Run | Result |
|---|---|
| Finance (`lib/business-os/finance`, `app/admin/finance`, finance route, finance read repo) | exit 0, 27 suites, 2239 tests |
| Vocabulary guard | exit 0, 137 tests |
| Usage-log readers (isolation + contract), unchanged | exit 0, 2 suites, 28 tests |
| Health (`lib/admin/health`, health-summary route) | exit 0, 7 suites, 296 tests |
| `npm run test:bos-entitlements` | exit 0, 269 suites, 7984 tests |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Code Approved for QA: Yes**

---

## QA Report

### Part A (OV-1)

**QA Report — Part A, 2026-10-15**
**Test mode:** full (AC-150 to AC-153)
**Strategy used:**
- A (unit and source guard) and B (render and route tests), re-run from the worktree **one command at a time**;
- a scoped `tsc` with a canary, and a planted phrase for the vocabulary guard;
- a script that checks each of the 37 new strings is present in code;
- D (manual browser check) listed for the user.

**Focus:** ui (copy), with the guards
**Skipped:** the live browser path (AC-153), for the user (L-89 to L-97 below)
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS**. No bug found. AC-150, AC-151 and AC-152 pass. AC-153 is owed by the user.

**Release-gate note.** The SA Workplan Review says "the user has **not** given a no-diff-review go-ahead for M-4. Each part stops after SA and QA for the user's diff view." The TL brief to QA says commit and PR are pre-authorised. These disagree. QA records it for TL and RM to resolve with the user; it is not a QA finding.

**Test runs** (worktree `neuronforge-finance-health`, branch `feature/bos-money-m4`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | Finance: `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` | exit 0; **24 suites, 1,781 passed** |
| Q-2 | AI cost & usage: `npx jest app/admin/analytics app/api/admin/token-usage --ci` | exit 0; **13 suites, 277 passed** |
| Q-3 | Business OS AI: `npx jest app/admin/business-os-llm app/api/admin/business-os/credits app/api/admin/business-os/llm-settings --ci` | exit 0; **24 suites, 1,031 passed** |
| Q-4 | Health and `app/admin`: `npx jest lib/admin/health app/admin/__tests__ app/admin/components app/api/admin/health-summary --ci` | First run: 44 / 45 suites, 1,511 / 1,512; one failure, `jobsQueues.layout.render` (`findBy… jobs-error` not found). That file is not in the diff, and the machine was heavily loaded (suites running 30 to 130 s). **Alone: exit 0, 18 / 18.** PASS in that run: `aiCostVocabulary.source.guard`, `contrast.lf1.source.guard`, `layoutFolder.guard` |
| Q-5 | Businesses drawer: `npx jest app/admin/users app/api/admin/business-os/accounts --ci` | First run: 26 / 27 suites, 623 / 624; one failure, **`creditsBlock.render`** ("Exceeded timeout of 5000 ms", OP-32, the known load-sensitive suite, not in the diff). **Alone: exit 0, 69 / 69** |
| Q-6 | New vocabulary guard alone: `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | exit 0; **1 suite, 128 passed** |
| Q-7 | Layout and source guards: `app/admin/components/layout`, `finance.source.guard`, BOS-LLM `source.guard`, users `source.guard`, `businessPicker.contract`, `contrast.lf1.source.guard` | exit 0; **23 suites, 2,180 passed** |
| Q-7b | `app/admin/audit-trail` (run alongside Q-7 the first time) | Under load: 5 render failures in 3 suites, all `findBy` / 5 s timeouts. Re-run as a folder: still 3 failing under load. **Each alone: `aiCostPrecision.render` 8 / 8, `searchTotals.render` 6 / 6, `auditTrail.table.render` 18 / 18, exit 0.** No audit-trail file is in the diff, and none imports a touched copy module. This is the FU-5a-3 load sensitivity, not Part A |
| Q-8 | `npm run test:bos-entitlements` | exit 0; **268 suites, 7,994 passed** |
| Q-9 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-10 | `npm run lint:hooks` | exit 0 |
| Q-11 | Scoped `tsc`. Config: `tsconfig.qa-m4a.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 25 added or modified `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `financeCopy.ts`): exit 2, `app/admin/finance/financeCopy.ts(570,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-12 | `git diff --stat` / `--numstat` | 26 files (+515 / −88, the two requirement MDs included); **no file only loses lines**; no `supabase/` or `lib/repositories/` path; the one `app/api/` file is the planned `health-summary/__tests__/route.qa-edge.test.ts` |

**Checks (step 4)**

| Check | Result | Evidence |
|---|---|---|
| No testid, rule id or metric changed | Confirmed | `git diff -U0` of every non-test `.ts` / `.tsx` file, filtered for `testid`, `href`, `spend24h`, `spend7d`, `bos_ai_spend`, `metric`, `ruleId` and `id:`. The only hits are lines where a label changed beside an unchanged id: `testId="strip-ai-spend"`; the `bos_ai_spend:` key; `sums.spend24h` / `sums.spend7d` |
| Health rule texts unchanged (FU-M4-1) | Confirmed | `git diff --stat -- lib/admin/health/rules.ts` and the rule tests (`rules.config`, `qa-edge`, `windows`) is empty |
| Leak check reasons unchanged | Confirmed | `leakCopy.ts` diff is exactly the three planned lines (W-16a/b/c: `LEAK_CLEAN`, `LEAK_FOUND`, `LEAK_STATUS_TEXT.leak`); no reason text touched |
| Subtitle reads "‹window›. ‹source›", no ". ," | Confirmed | `AiCostSection.tsx:82` `` subtitle={`${windowLabel}. ${AI_SOURCE}`} ``. `windowLabel` ends with "UTC" (no full stop), and `AI_SOURCE` starts with "Credit ledger:", so the result is "This month, 2026-10-01 to 2026-10-15 UTC. Credit ledger: …". SA-WR-46 render pin in `financePage.render` |
| The guard catches an old phrase (planted) | Confirmed | `export const QA_PLANTED = 'Total spend';` appended to `leakCopy.ts` → guard exit 1, **2 failed / 126 passed**: "no forbidden phrase … › leakCopy.ts" and "AC-150: the old texts are gone › W-12a: 'Total spend'". Restored byte-identical (`cmp`), numstat back to its 3 / 3 |
| Every string in the 37-string list is in the code | Confirmed | A QA script (scratchpad `m4check.js`) folds `' + '` chains and whitespace, then looks for each new text in its own file. **39 checks** (the 37 items, with W-3's subtitle and source split, and W-28's two figures), **0 missing**. Activity holds exactly three `'Charged AI cost (USD)'` (SA-W91) |
| No "charged" / "recorded" swapped | Confirmed | Every added line containing "recorded" in the ledger-based copy (Finance, Costs, Activity) is a pointer to the usage log ("Every recorded AI call…", "the recorded AI cost is not used here", "AI cost & usage (Business OS, recorded)"). Every added "charged" in the usage-log copy (analytics, Health, drawer) is "charged or not" or "The charged cost is on Finance". Each figure label matches its source: "Charged" = credit ledger, "Recorded" = usage log |

**Test coverage**

| AC | Result | Evidence |
|---|---|---|
| AC-150 | ✅ Pass | Vocabulary guard tests 4 and 5 (every W row's new text present; every old text absent); QA's own 39-check script; the updated render pins (`analytics.layout`, `activityLayout`, `activityTab`, `costsLayout`, `businessDrawer.layout`, `businessSummaryStrip`, `evaluateHealth`, `health.render`, `financePage.render`) green in Q-1 to Q-5 |
| AC-151 | ✅ Pass | The id and rule checks above. Finance, Costs, Activity, analytics and drawer route tests and the Health rule and metric tests are **not in the diff**, and they pass. The one `app/api` test edit is the planned label lookup |
| AC-152 | ✅ Pass | Guard test 2 (all 13 files clean) and test 3 (planted controls, SA-WR-47 attribute cases); QA's own plant caught (above) |
| AC-153 | ⬜ NOT-TESTED | Manual, L-89 to L-97 below |

**Issues found**
- **Bugs:** none.
- **Performance:** none (copy only).
- **Notes (Low, not Part A):**
  - the load-sensitive render suites, all untouched and green alone: `creditsBlock.render`, `jobsQueues.layout.render` and three audit-trail suites (FU-5a-3);
  - the release-gate disagreement noted at the top.

**Manual live steps** (continuing from 6a's L-88): for the user. Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Nothing on any page should say "estimated", "AI spend", "Total spend", "Cost Analytics", "provider-side" or "measured cost / price".

| # | Page | New labels to look for |
|---|---|---|
| L-89 | **Finance**, Overview | K-1 tile "Charged AI cost this month". Section 3 title "Charged AI cost in the window", with the subtitle reading "‹window› UTC. Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it." (no ". ,"). Total "Charged AI cost (USD)". "Top 10 businesses by charged AI cost". Link line "Every recorded AI call, charged or not: AI cost & usage" |
| L-90 | **Finance**, a business picked; then the **Accounts** tab | Summary line "Charged AI cost". If the window starts before 29 Sep, "…see Charged AI cost in the window below." Accounts tab: column "Charged AI cost (USD)", sort "Charged AI cost, highest first", and the note "AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here." |
| L-91 | **AI cost & usage** (`/admin/analytics`), Business OS scope, then All | Scope note "Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, …" / "Recorded AI cost, both products: …". KPI tile "Recorded AI cost". Category tiles "‹n›% of recorded cost · …" |
| L-92 | **Business OS AI → Costs & credits** | Intro begins "Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) …" and ends "Monthly totals are on Finance." KPI "Charged AI cost (USD)". The fallback note (if shown) says "the model had no price in the price table" |
| L-93 | **Business OS AI → Leak check** | "No recorded AI cost left uncharged", or "‹n› businesses with recorded AI cost not charged (‹$›)". Status "Recorded, not charged". The reason texts are unchanged |
| L-94 | **Business OS AI → Activity** | Intro ends "…whether it worked and its charged AI cost." KPI "Charged AI cost (USD, net)". Table column, drill-down field and corrections column "Charged AI cost (USD)". With a window before 29 Sep: "…or the recorded AI cost in AI cost & usage." and the link "AI cost & usage (Business OS, recorded)" |
| L-95 | **Health** (`/admin`) | Tile "Recorded AI cost (USD)". Figures "Recorded AI cost, last 24 h (USD)" / "…last 7 days (USD)". The footnote begins "USD: every Business OS AI call in the usage log, charged or not, …" and says "The charged AI cost is on Finance." The tile colour and rule wording are unchanged (FU-M4-1) |
| L-96 | **Businesses** drawer (open a business) | Strip "Recorded AI cost, 30 days" with sub "recorded" (or "recorded, a lower bound"). Box heading "Recorded AI cost, Business OS, last 30 days (USD)". Purpose line "Recorded AI cost of this business's Business OS AI calls, in USD." All products: "All products, recorded AI cost (30 days; …)", "Recorded AI cost by model (highest first)" and "Recorded AI cost" |
| L-97 | Cross-check the meaning | For the same window, Finance's "Charged AI cost" (credit ledger) and AI cost & usage's "Recorded AI cost" (usage log) may differ. Recorded includes calls never charged and calls before 29 Sep. Charged is never shown as "recorded", and recorded is never shown as "charged" |

### Part B (OV-5)

**QA Report — Part B, 2026-10-15**
**Test mode:** full (AC-154 to AC-168, plus the AC-145 baseline)
**Strategy used:** A (unit) + B (builder and route integration with mocked reads), re-run from the worktree **one command at a time**; scoped `tsc` with a canary; code reading for the edge cases; D (manual) listed for the user.
**Focus:** api, ui, security, performance
**Skipped:**
- §13 checks 21 and 22 on the live database;
- the 92-day timing (step 5). QA's read-only timing script against the live database was **refused by the session's permission guard ("Production Reads")**. QA did not work around it, so the timing is a manual step for the user (L-104).

**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every Jest-testable AC passes. Still owed by the user:
- AC-154 and AC-155 (the SQL halves);
- AC-166;
- the SA-WR-49 92-day timing. Per SA-WR-49, if the recorded read nears 2 s, Dev and QA report to SA **before the PR**.

**Release-gate note (repeat from Part A).** The SA Workplan Review's "Release gate" line says the user has **not** given a no-diff-review go-ahead for M-4. The TL brief says commit and PR are pre-authorised. Please confirm with the user before RM opens PR 2.

**Test runs** (worktree `neuronforge-finance-health`, branch `feature/bos-money-m4b`, uncommitted; every run passed first time)

| # | Command | Result |
|---|---|---|
| Q-1 | Finance: `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | exit 0; **27 suites, 2,239 passed** |
| Q-2 | Readers, unchanged: `npx jest lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts --ci` | exit 0; **2 suites, 28 passed**. `git diff -U0 -- lib/repositories`: every changed line is a comment (no non-comment `+` / `-` line) |
| Q-3 | `npx jest app/admin/users app/api/admin/business-os/accounts --ci` | exit 0; **27 suites, 624 passed** |
| Q-4 | `npx jest app/admin/__tests__ app/admin/components lib/admin/health app/api/admin/health-summary --ci` | exit 0; **45 suites, 1,521 passed** |
| Q-5 | `npx jest app/admin/analytics app/api/admin/token-usage --ci` | exit 0; **13 suites, 277 passed** |
| Q-6 | `npx jest app/admin/business-os-llm --ci` | exit 0; **17 suites, 854 passed** |
| Q-7 | Vocabulary guard alone | exit 0; **1 suite, 137 passed** |
| Q-8 | Billing guards and caller lists (the 6a V-6 nine); `git diff --exit-code -- lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase` | exit 0; **9 suites, 425 passed**; diff **exit 0** |
| Q-9 | `npm run test:bos-entitlements` | exit 0; **269 suites, 7,984 passed** |
| Q-10 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-11 | `npm run lint:hooks` | exit 0 |
| Q-12 | Scoped `tsc`. Config: `tsconfig.qa-m4b.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 23 added or modified `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `recordedCost.ts`): exit 2, `lib/business-os/finance/recordedCost.ts(140,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-13 | `git diff --stat` / `--numstat` | 21 tracked files (+1,438 / −71, this workplan included), 4 new; **no deletion-only file**; no `supabase/`, billing or requirement path; `lib/repositories/` comments only |

**Test coverage**

| AC | Result | Evidence |
|---|---|---|
| AC-154 | ✅ Pass (Jest), SQL half manual | T1-B §11F.1 fixture 1.942075 / 1.612137 → 0.329938, equal to `checkTwentyOne`; T9-B both lines beside the charged total, no sum. Check 21: L-100 |
| AC-155 | ✅ Pass (Jest), SQL half manual | T5-B picked view: the account read only, figures equal to `checkTwentyTwo`; T11-B the summary line. Check 22: L-102 |
| AC-156 | ✅ Pass | T1-B 1.94 / 1.61 → 0.33; equal → `none`; charged above → `none` + `chargedAboveUsd`; deleted left out; 0.1 + 0.2 = 0.3 exactly. Code: integer units, `charged.totalUnits − deletedUnits` (`recordedCost.ts:70-78`) |
| AC-157 | ✅ Pass | T7-B: with `accountId`, the all-accounts mock 0 calls and the account mock once with the id; with none, the reverse; 401 / 403 / 400 / 404 → neither (`allReads()`) |
| AC-158 | ✅ Pass | T11-B the same text in Section 3 and the summary from one `recorded` object; T12-B one renderer (`RecordedAboveValue`) |
| AC-159 | ✅ Pass (Jest), live part manual | T1-B both cut-over coverages → `not_available` with the recorded figure kept (`recordedCost.ts:65-66`); T9-B the text, shown even when Section 3 is Unknown (BD-2 `alsoWhenUnknown` slot; render tests show it exactly once per state). Live: L-103 |
| AC-160 | ✅ Pass | T1-B each read kind not exact → "At least" + Unknown; null and `'abc'` costs → `unreadable` 1; T5-B Section 3 deep-equal with and without |
| AC-161 | ✅ Pass | T5-B throws / `{ error }` / never settles (fake timers past 2 s) → `unknown`, every other section present; no unhandled rejection (BD-6 control); ledger not exact → Unknown difference; T9-B the notice |
| AC-162 | ✅ Pass | T7-B the all-accounts read gets `end` `'2026-10-14T23:59:59.999Z'` (frozen clock), the account read the `Date` 1 ms before `window.end`; T1-B / T5-B a row at `end` is excluded. Code: `inclusiveEnd` in `route.ts` |
| AC-163 | ✅ Pass | T6-B (f) no `recorded + charged` anywhere (planted control), `FinanceRecordedAiCost` exactly five keys; T5-B K-1 and `accountMargin` deep-equal with and without; T7-B tab payload has no `recorded` |
| AC-164 | ✅ Pass | T7-B info line `sections.aiRecorded` / `counts.aiRecorded` (statuses, counts, booleans, `ms`); planted cost, feature, session id and name in no log call; payload has no `session_id`, `feature`, `cost_usd` or row id |
| AC-165 | ✅ Pass | Q-1 to Q-13; repository comment-only proof (Q-2) |
| AC-166 | ⬜ NOT-TESTED | Manual L-98 to L-105 |
| AC-167 | ✅ Pass | T5-B / T7-B `tab=accounts` → both mocks 0 calls, no `recorded`; the wiring returns `NOT_BUILT` (`financeHealth.ts:672`) |
| AC-168 | ✅ Pass | T1-B `completed` false with fewer rows than the ceiling → "At least" and Unknown; `completed` true → figure; account `reachedCeiling` true → "At least" |
| AC-145 (E-55) | ✅ Pass | Baseline green; BD-5: only the E-55 hunks, plus one proof assertion that the payload without `aiCost.recorded` still hashes to the 6a value |

**Edge cases (code and tests read)**

| Edge case | Result | Evidence |
|---|---|---|
| "Completed" vs ceiling: a read that stopped short is never exact | Confirmed | `readComplete = completed` for all accounts, `reachedCeiling === false` for one account (`recordedCost.ts:59`); a short-stopped read (e.g. by the signal) with `completed: false` → "At least" + Unknown |
| The end − 1 ms boundary | Confirmed | `inclusiveEnd(to) = to − 1 ms` for both readers (`route.ts`), so `[from, to)` becomes `[from, to − 1 ms]` on `lte` readers. Residual, by design (SA-Q52): a sub-millisecond row in the last millisecond of the window falls out, while check 21 (`< month end`) keeps it. With "This month" the window ends at tomorrow 00:00, so this can only touch rows timed in the future |
| "Not available" visible when Section 3 is Unknown (D1 / BD-2 slot) | Confirmed | `FinanceSection` `alsoWhenUnknown` renders the block only in the `unknown` state; render tests assert it once per state |
| "None" when charged > recorded | Confirmed | `differenceUnits < 0` → `none` + `chargedAboveUsd` (`recordedCost.ts:76-78`); never a negative "above" |
| Deleted accounts left out of charged | Confirmed | `chargedUnits = totalUnits − deletedUnits` (`:70`); the R4-4 note shows with no business picked |
| Picked business uses only the account read | Confirmed | `accountId !== null` → `readRecordedOne(accountId)` only (`financeHealth.ts:672-676`); T7-B spies |
| Accounts tab skips the recorded reads | Confirmed | `input.accountsTab !== null → NOT_BUILT` |
| `bosRowFilter` keeps agent-platform calls out | Confirmed | Both bindings pass `bosRowFilter()` (SA-WR-48 pins). Its set equals check 21's: the prefix `business-os` plus the five legacy values (`callCatalog.ts:100-132`); the onboarding value stays out by design |
| Deadline: late or failed read → Unknown, page renders | Confirmed | `underDeadline(…, RECORDED_DEADLINE_MS = 2 * 1000)`; the outcome is logged as `'deadline'` / `'failed'`; T5-B fake timers |
| No sum of recorded + charged anywhere | Confirmed | T6-B (f) regex with a planted control; payload keys pinned; page `MONEY_M4` rule |
| Leak check link carries `account` | Confirmed | `leakCheckHref(id)` → `/admin/business-os-llm?tab=costs&account=<id>`; no `account` key with all businesses (`financeLinks.ts:96-101`); T8-B |
| No money in logs | Confirmed | `counts.aiRecorded` = built, read, outcome, rows, completed, reachedCeiling, unreadable, ms; the builder logs nothing; T7-B planted values absent |

**Issues found**
- **Bugs:** none.
- **Performance:** not measured. QA's live timing was refused, as above. SA-WR-49 requires the 92-day figure before the PR (L-104).
- **Notes (Low):**
  1. The end − 1 ms residual above, accepted under SA-Q52.
  2. BD-7's sentence wording awaits BA (Dev's note).

**Manual live steps** (continuing from Part A's L-97): for the user. Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. For checks 21 and 22, replace the month `null` with `'2026-10-01 00:00:00+00'`. In check 22, also replace the account `null` with your test account id in quotes.

| # | Step | Expected |
|---|---|---|
| L-98 | `/admin/finance`, This month (October 2026), All businesses: read Section 3 | Directly under "Charged AI cost (USD)" sits a block captioned "Beside the charged cost, never added". It shows **"Recorded AI cost (USD)"** (about USD 1.94) and **"Recorded above charged (USD)"** (about USD 0.33; it moves as usage grows). The sentence "Deleted accounts are left out…" and the "By design…" sentences appear. No figure on the page equals recorded + charged |
| L-99 | Click **Leak check** under "Recorded above charged" | `/admin/business-os-llm?tab=costs` opens on the Costs tab (no `account`) |
| L-100 | **Check 21** (October literal) | `recorded_usd` = "Recorded AI cost" (to the display precision). `not_charged_usd` = "Recorded above charged" (or the page shows "None" when it is 0 or below, with "Charged is USD X above recorded" when below). `charged_usd + deleted_accounts_charged_usd` = Section 3's charged total. If `rows_without_cost` > 0, the page shows "At least" and Unknown instead |
| L-101 | Pick your test account | Section 3's block shows that account's recorded figure and difference. The account summary has a **"Recorded above charged"** line under "Charged AI cost", with exactly the same text as Section 3. There is no "Deleted accounts" sentence. The Leak check link now ends `&account=<your id>` |
| L-102 | **Check 22** (October literal, your id) | `recorded_usd`, and `not_charged_usd` (or "None"), match the picked view. The account's charged total matches Section 3 |
| L-103 | Custom **2026-09-15 to 2026-09-28**, All businesses | Section 3 shows the cut-over notice instead of charged figures. The recorded block still shows its figure, with "Recorded above charged: Not available: AI charging began 29 Sep 2026". Repeat with 2026-09-15 to 2026-10-14: still "Not available", with charged figures present |
| L-104 | **SA-WR-49 timing:** Custom, the longest window allowed (92 days, e.g. 2026-07-15 to 2026-10-14), All businesses; then This month; then This month with your account picked | Read the dev-server log line "Admin read the Business OS finance page" for each: `durationMs` and `counts.aiRecorded.ms` / `outcome` / `rows` / `completed`. **If `counts.aiRecorded.ms` is near 2,000 or `outcome` is `'deadline'` on the 92-day window, stop and report to SA before the PR** (SA-WR-49). With `outcome: 'deadline'` the block reads Unknown with the notice, and every other section still renders |
| L-105 | Accounts tab, then the log | No recorded block on the tab. The log line has `sections.aiRecorded: 'not_built'` and `counts.aiRecorded: { built: false }`. No amount, feature, session id or name in any line |

---

## Commit Info

*RM to populate: PR 1 (Part A) and PR 2 (Part B).*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created (Dev) | Workplan for Money M-4, two PRs under one workplan (SA-Q57). Part A (OV-1): every string W-1 to W-25 listed old → new, plus W-26 comments, and the AST vocabulary guard (SA-Q51). Part B (OV-5): pure `recordedCost.ts`, two reused reads bound by the route (`end − 1 ms`, race-only account read), optional `aiCost.recorded`, the finance guard narrowed and widened, the AC-145 baseline updated once (E-55), AC-167 / AC-168, full `TokenUsageRepository` caller list (F-7). SA-W90 to SA-W104 raised; no code written |
| 2026-10-15 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W90 to SA-W104 approved (W98: R4-5 is right; W97: `aria-label`, `title`, `placeholder` scanned). Required changes SA-WR-46 to SA-WR-50 (subtitle pin, attribute controls, `bosRowFilter()` pinned on both reads, the deadline changes only by SA ruling, picked-view charged units). Requirement edits E-58 and E-59 applied by SA. Each part stops for the user's diff view |
| 2026-10-15 | SA code review, Part A: **Code Approved** | Strings W-1 to W-28 verified; no identifier changed; E-59 subtitle pinned; guard HEAD count re-run by SA (21 offences at HEAD, 0 now); D1 and D2 approved, D3 left; SA re-run green (two untouched load flakes pass alone) |
| 2026-10-15 | SA code review, Part B: **Code Approved** | E-53 exactness, end − 1 ms, race-only deadline, no sum, W98 placement, SA-WR-48 and SA-WR-50, AC-145 E-55 hunks (6a hash restored with `recorded` removed), `/tokenusage/i` with two methods pinned, comment-only repository headers verified; D1 to D5 approved; SA re-run all exit 0 |
