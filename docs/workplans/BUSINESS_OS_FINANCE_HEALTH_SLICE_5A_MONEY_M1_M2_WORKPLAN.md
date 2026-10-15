# Workplan: Business OS Finance & Business Health — Slice 5a (Money M-1 and M-2)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **5a**: §0.1 row 5a, §0.4 DF-6 and DF-7, §11D.1 to §11D.9 (AC-108 to AC-129), §13 checks 17 and 18, "SA Requirement Review — Slice 5a (M-1/M-2) — 2026-10-14", and §0.3 SA-Q32 to SA-Q41 and SA-RR-5a. It also uses [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): the U-10 exception (E-38, `:538`) and the C-6 note (E-39, `:695`).
**Decisions in force:**
- BD-1 and BD-9 (UTC calendar month).
- BD-12 (no FX; per currency only).
- BD-14 (test and live money count together, with no switch).
- BD-15 (a paying Founding Partner is grouped under its paid tier, with a chip).
- BD-16 (one billing row per account).
- BD-17 (refund-month rule; deferred with 4b).
- BD-18 (AI cost means the cost we charged).
- BD-19 (cash received first; MRR in 5b).
- BD-20 (no label for test payments).
**Builds on:** slices 1a, 1b, 1c, 2a, 2b and 4a, all on `main` at `392a9b53`. See the [4a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md) and the [4a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_RETROSPECTIVE.md).
**SA rulings implemented:**
- SA-Q32: the business name is taken by the UI only.
- SA-Q33: the one-shot `account` deep link.
- SA-Q34: links carry the window. SA-W56 below proposes an amendment.
- SA-Q35: R-d is not called with a business picked.
- SA-Q36: the layer-B pager.
- SA-Q37: the tier label comes through a callback.
- SA-Q38: refunds and disputes are left out.
- SA-Q39: zero-amount invoices go in a note.
- SA-Q40: the per-currency combination is pure and server side.
- SA-Q41: no dependency on P-8a.
- Findings S5-F1 to S5-F7.

Still in force:
- SA-W1 / AC-42: the view narrows to a picked business.
- SA-W22: structural input types.
- SA-W48: unreadable is decided per row.
- SA-W54: no × 100.
- SA-WR-3: spies at the repository boundary.
- SA-WR-4: builders are pure.
- SA-WR-7: scratch tsconfig with a canary.
- SA-WR-16: every `.from(` takes a literal.
- SA-WR-18: the page never adds or subtracts money.
- SA-WR-34: K-5 money only through `formatMoney`.
- SA-WR-35: one refund-timing sentence. SA-W58 below raises a conflict with it.
**Date:** 2026-10-14
**Branch:** `feature/bos-money-m1-m2`. RM cut it from `main` `392a9b53`, and I confirmed it with `git branch --show-current` in worktree `neuronforge-finance-health`. `node_modules` is a junction to the main checkout, so:
- never run `git worktree remove`, `git stash` or `npm install`;
- never commit. The user authorised M-1 and M-2 to run end to end without a diff stop. After SA code review and a QA pass, RM commits both parts and opens **one** PR.
**Status:** Code Complete (M-1 and M-2), uncommitted. Awaiting SA code review.

## Overview

Slice 5a fixes the trigger in §11D. On Finance, the owner test account shows only its USD 10.00 boost. It paid a USD 79.00 Basic plan in the same month, and that payment does not show. The slice has two parts, built in this order on one branch.

**Part 1, M-1 "One account, one screen."**
- Finance moves to the shared `AdminBusinessPicker`, and the original audit-trail picker is deleted. Four guard tests change with the deletion.
- The chip names the business.
- With a business picked, an **account header** and an **account summary** appear. They are built only from figures already in the payload.
- The summary links out to Activity, Costs & credits, AI cost & usage and the Businesses drawer. Each link carries the account and the window.
- The Businesses drawer links back with "Open money view". The Businesses page reads a one-shot `account` key.
- M-1 changes **no** file under `lib/` or `app/api/`.

**Part 2, M-2 "Plan payments received."**
- Two reads, R-m and R-m′, are added to `BusinessOsFinanceReadRepository`. They read `invoice_paid` rows dated by `paid_at` in the window.
- A pure builder, `planRevenue.ts`, gives:
  - plans received per currency (integer cents, tax included);
  - a by-business table, or one business's payment list;
  - a deleted-accounts line.
- A pure combiner, `ourRevenue.ts`, gives K-5 and the summary's "Paid us, total". The sum is boost net plus plans received, **within one currency only**, with the E-34 exactness rule.
- With a business picked, R-d (`countRevenueRows`) is **not called**.

What the slice adds and leaves out:
- No migration, no SQL function, no new table, no write, no LLM call and no audit entry.
- No new query parameter on the finance route.
- No new import from the entitlements module, and no tier written as a literal.

**Nineteen points need an SA ruling before code** ([Questions for SA](#questions-for-sa-before-code), SA-W55 to SA-W73). Seven are places where the requirement does not fit the code:
- SA-W56: AI cost & usage *can* take the window.
- SA-W58: the refund-timing pin conflicts with S5-F7.
- SA-W59: K-5 needs integer cents from the boost builder.
- SA-W61: `revenue.plans` changes type.
- SA-W65: `tierLabelForGroup` never returns null.
- SA-W69: Finance is not in the contrast walk.
- SA-W55: one workplan and one PR, against §11D.2.

None reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify / Delete](#files-to-create--modify--delete)
- [PART 1 — M-1: One account, one screen](#part-1--m-1-one-account-one-screen)
  - [M1.1 The picker swap and the original's deletion](#m11-the-picker-swap-and-the-originals-deletion)
  - [M1.2 The four guard edits](#m12-the-four-guard-edits)
  - [M1.3 The business name (SA-Q32)](#m13-the-business-name-sa-q32)
  - [M1.4 Account header (E-35)](#m14-account-header-e-35)
  - [M1.5 Account summary (M1-FR-5, M1-FR-6, S5-F7)](#m15-account-summary-m1-fr-5-m1-fr-6-s5-f7)
  - [M1.6 Links that keep the window and the account (M1-FR-7, SA-Q34)](#m16-links-that-keep-the-window-and-the-account-m1-fr-7-sa-q34)
  - [M1.7 Businesses: "Open money view" and the one-shot `account` key (SA-Q33)](#m17-businesses-open-money-view-and-the-one-shot-account-key-sa-q33)
  - [M1.8 M-1 checkpoint](#m18-m-1-checkpoint)
- [PART 2 — M-2: Plan payments received](#part-2--m-2-plan-payments-received)
  - [M2.1 The reads: R-m and R-m′](#m21-the-reads-r-m-and-r-m)
  - [M2.2 Money maths: integer cents, exact](#m22-money-maths-integer-cents-exact)
  - [M2.3 The plan revenue builder](#m23-the-plan-revenue-builder)
  - [M2.4 K-5 and "Paid us, total": the per-currency combiner](#m24-k-5-and-paid-us-total-the-per-currency-combiner)
  - [M2.5 Builder, wiring, types, route](#m25-builder-wiring-types-route)
  - [M2.6 With a business picked (SA-Q35, E-36)](#m26-with-a-business-picked-sa-q35-e-36)
  - [M2.7 Failure matrix](#m27-failure-matrix)
  - [M2.8 The page](#m28-the-page)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Checklist before SA code review](#checklist-before-sa-code-review)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I opened every file below at `392a9b53` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| Finance imports the original picker and renders it in bar slot 5 | `app/admin/finance/components/FinanceFilterBar.tsx:19-21`, `:114-119` |
| Finance's own chip shows an 8-character id fragment and a "All businesses" button | `FinanceFilterBar.tsx:128-140`; copy `financeCopy.ts:29-30` |
| The shared picker: `onSelect(accountId, name)`, no fetch on mount (RC-6), no standing note (L-4a), `describedBy` prop | `app/admin/components/layout/AdminBusinessPicker.tsx:76-93`, `:20-22`, `:28-32` |
| The shared picker's header still says the original "stays, unedited, for Finance only" | `AdminBusinessPicker.tsx:3-8` |
| `businessFilterChip`: "Business: {name}" else `formatShortId`, testid `business-filter-chip`, X "Remove business"; returns an `AdminActiveChip` object | `AdminBusinessPicker.tsx:368-387` |
| `AdminFilterBar`'s chip renderer is private (`function Chip`) | `app/admin/components/layout/AdminFilterBar.tsx:110-130` |
| The original picker's input is `py-1.5 text-sm`, the same height as the shared one; its standing hint is the one Finance shows today | `app/admin/audit-trail/BusinessAccountPicker.tsx:246`, `:336-339`; shared `INPUT_CLASS` `AdminBusinessPicker.tsx:64-65` |
| Only Finance imports the original; four guards name it; two finance tests mock it | `grep -rn BusinessAccountPicker app lib components`: `FinanceFilterBar.tsx:21`, `businessPicker.contract.test.ts:24-40, :92, :153, :202`, `layoutFolder.guard.test.ts:518-522`, `contrast.lf1.source.guard.test.ts:9-11, :50, :64, :112`, `business-os-llm/__tests__/source.guard.test.ts:536-549`, `financeFilterBar.layout.render.test.tsx:20-28`, `financePage.render.test.tsx:65-66` |
| The contrast guard walks Health, Jobs, Audit trail, Activity and Businesses, **not Finance**. Eight Finance files hold `text-slate-500` | `contrast.lf1.source.guard.test.ts:60-66`; `grep -c text-slate-500 app/admin/finance/**` |
| The LF-6 bar test pins the help line inside the picker column, and five row items | `financeFilterBar.layout.render.test.tsx:93-103` |
| The view's order: strip, revenue, takings, accounts, AI cost, credits, problems; `windowLabel` | `app/admin/finance/components/FinanceView.tsx:51-53`, `:94-103` |
| Section 3's link to AI cost & usage carries nothing | `AiCostSection.tsx:152-157`; `financeCopy.ts:178-180` |
| Section 1 group label (a tier label from the server, else the copy) | `AccountsByPlanSection.tsx:205-208`; groups `financeTypes.ts:56-73` |
| Section 4 credit row: `accountId`, `name`, `nameStatus`, `group`, `tierLabel`, `kind`, `allowance`, `used`, `usedTenths`, `giftedOutstanding` | `financeTypes.ts:385-409` |
| Section 3 top account row carries `name` / `nameStatus` | `financeTypes.ts:110-118` |
| AI cost & usage accepts presets, `range=custom&from&to` (both dates) and two extras; Today / This month / custom go out as whole UTC days; 7d / 30d go out as rolling `period=N` | `app/admin/analytics/analyticsFilters.ts:79`, `:141-157` (`narrowAnalyticsWindow`), `:167-170`, `:236-245` |
| Activity and Costs: `account` (UUID) and the window (`range` / `from` / `to`, two whole dates) | `app/admin/business-os-llm/activityFilters.ts:42`, `:80-89`; `costsFilters.ts:158-161`; `tabWindowFilter.ts:209-224`; `?tab=` `app/admin/business-os-llm/page.tsx:121-143` |
| Window URL form: `range=<preset>` or `range=custom&from&to` | `app/admin/components/layout/adminWindow.ts:131-147`, `:160-176` |
| The finance and the shared presets resolve through the same `resolveAdminWindow` | `lib/business-os/finance/financeWindow.ts:53-63`; `adminWindow.ts:216-224` |
| All three target routes cap a window at 92 days, as Finance does | `lib/business-os/credits/creditReport.ts:71`; `aiActivity.ts:101`; `adminWindowPresets.ts:28` |
| `useAdminFilters`: a `pageOnly` field is parsed from an inbound link, never written, and its key is removed by the mount write (`replaceState(null, …)`) | `app/admin/components/layout/useAdminFilters.ts:47-49`, `:136-152`, `:200-210` |
| Precedent of a page-only key | `app/admin/audit-trail/auditTrailFilters.ts:55` |
| Businesses: the status in the URL, default `active`; rows capped at 100, newest first | `app/admin/users/usersFilters.ts:20-27`; `app/admin/users/page.tsx:68-69`, `:364-365` |
| Businesses opener, focus return, the drawer, QA B-1 close | `page.tsx:367-376`, `:401-413`, `:566-570` (`row-open`), `:669-698` |
| Businesses URL tests (U-3 status only) | `app/admin/users/__tests__/businessesLayout.render.test.tsx:222-261` |
| BOS panel header line; link class; the existing AI cost & usage link | `app/admin/users/components/BusinessOsPanel.tsx:227-249`, `:118`, `:374-379` |
| Drawer pins: the summary strip holds no link; a section box has exactly one child | `businessDrawer.layout.render.test.tsx:370`, `:663` |
| The finance repository: header, columns, `FINANCE_READ_LIMITS`, R-d, `rangeFilter`, `pageClientRows` | `lib/repositories/BusinessOsFinanceReadRepository.ts:15-91`, `:162-168`, `:128-135`, `:428-453`, `:665-675`, `:702-759` |
| R-d already reads `business_os_billing_events` with `.eq('kind', 'invoice_paid')` | `BusinessOsFinanceReadRepository.ts:432-435` |
| Repository test pins: limits equality, R-d describe, no-write, no aggregate, writer names, one caller | `BusinessOsFinanceReadRepository.test.ts:124-139`, `:288-322`, `:512-567` |
| Billing events migration: integer amounts `>= 0`, `currency = 'usd'`, timestamptz `paid_at` / `period_*`, nullable `user_id` `ON DELETE SET NULL`, `tier` nullable | `supabase/migrations/20261027_business_os_billing_events.sql:5-24`, `:29`, `:31`, `:49`, `:51`, `:57` |
| `minorUnitsPerMajor(currency: string)`: trims and lower-cases; 1, 1000 or 100 | `lib/payments/refundMath.ts:44-49` |
| `normaliseCurrencyCode` (trim, upper case, 3 letters), `groupByCurrency`, `CURRENCY_SCALE` | `lib/business-os/finance/currencyGroups.ts:27-36`, `:83-105` |
| Boost builder: result type, wire lines divided once, `k5` summary | `lib/business-os/finance/boostRevenue.ts:88-100`, `:164`, `:262-277`, `:339-348` |
| Builder: K-5 constants, `finance` Pick, `counts.boosts`, the settled `Promise.all` (R-d at `:429`, R-k at `:467-471`), revenue section, K-5, payload | `lib/business-os/finance/financeHealth.ts:161-163`, `:183-200`, `:297-309`, `:405-472`, `:563-589`, `:783-793`, `:839` |
| `tierLabelForGroup` returns the raw tier id (never null) for a tier with no presentation entry | `lib/business-os/finance/planGroups.ts:111-114`, `:250-252` |
| Wire types: `FinanceRevenueSection.plans` is a string union from R-d; `FinanceTileMoney`; `FinanceTile.money` | `lib/business-os/finance/financeTypes.ts:226-235`, `:241-245`, `:260-271` |
| Wiring's `finance` block | `lib/business-os/finance/financeHealthDeps.ts:113-139` |
| Route info line | `app/api/admin/business-os/finance/route.ts:178-210` |
| Panel: plans line from `PLANS_TEXT`; "cannot produce" list | `app/admin/finance/components/RevenuePanel.tsx:80-84`, `:110-121`; copy `financeCopy.ts:56-78`, `:119-125` |
| K-5 strip: `k5Value` prints `formatMoney(money.net, money.currency)`; caption from `k5Caption` | `FinanceKpiStrip.tsx:128-141`, `:194`; `financeCopy.ts:36-46`, `:65-68` |
| Finance source guard: `FILES`, tier literal, entitlement importers, table pin, repo-wide `livemode`, money arithmetic, the 4a describe (scale rules, DF-5 pin, SA-WR-35, export pin, SA-WR-34) | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:77-84`, `:153-158`, `:174-177`, `:280-300`, `:361-365`, `:407-420`, `:616-789` (`:707-712`, `:745-751`, `:769-782`) |
| Tests that pin R-d with a business picked, and the 4a plans line | `financeHealth.test.ts:472-520`, `:633-660`, `:761-846` (`:802`); `route.test.ts:470-481` (`:479`), `:895-904` (`:901`); `financePage.render.test.tsx:1177-1226`, `:1320-1332` |
| Billing-event caller list (name based, comments included) | `lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts:464-502` |
| `test:bos-entitlements` covers `lib/repositories/__tests__` **and** `app/admin/users/__tests__` | `package.json:23` |
| Entitlement non-gate registrations for finance: `planGroups.ts`, `financeHealthDeps.ts` | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:515-535` |

`console.*` count in every file to modify is **0**. I grepped every finance file, the repository, the route, `users/page.tsx`, `BusinessOsPanel.tsx`, `usersFilters.ts` and the guard files, so CLAUDE.md's flag-and-convert rule has nothing to convert.

Flagged, not touched: `app/admin/finance/useFinanceData.ts:14-17` uses the server `createLogger` in a client file, where F-56 asks for `clientLogger`. The file is not modified in this slice. The fix belongs to the finance shell adoption (DF-4 / M-6).

---

## Scope

This is exactly §11D.2. The two parts ship in one PR, and SA-W55 covers that.

| Part | In | Out |
|---|---|---|
| **M-1** | The shared picker, the deletion of the original, and the four guard edits. The chip name (SA-Q32). The account header (E-35) and summary (M1-FR-5). Links carrying the account and the window. "Open money view" in the drawer, and the one-shot `account` key on `/admin/users` (SA-Q33) | Any read, route or `lib/` change. Margin (M-3). The cost recorded but not charged (M-4). The page shell and the `range` / `account` rename (M-6, DF-4). "Since it started" (DF-6). "Paying since" |
| **M-2** | R-m and R-m′. `planRevenue.ts`. Plans per currency, by business or one business's payments, and the deleted-accounts line. `ourRevenue.ts` for K-5 and "Paid us, total". The picked view stops calling R-d. Route counts. The page part | MRR, active subscriptions, paying vs comped (5b, P-8a). Plan refunds and disputes (P-6b; SA-Q38). Refused payments (DF-7, slice 7). Stripe fees (BD-7). FIN 4b (paused) |
| ACs | M-1: AC-108 to AC-116. M-2: AC-117 to AC-129 | — |

---

## Questions for SA before code

Each question has a recommendation, and I build the recommendation unless SA rules otherwise. Numbering continues from 4a (SA-W54).

| # | Issue | Recommendation |
|---|---|---|
| **SA-W55** | **One workplan and one PR, against §11D.2.** §11D.2 and §0.1 row 5a say each part gets its own workplan, review, QA and PR, and that "M-2 starts after M-1 merges". The user has now authorised both parts on one branch and in one PR. That leaves two problems. AC-111 ("the M-1 diff changes no file under `lib/` or `app/api/`") cannot be read off the final PR. And M1-FR-5's placeholder "Plan payments: shown in the next update" would never ship. | Keep the parts separable in time. At the end of M-1, I run an **M-1 checkpoint** ([M1.8](#m18-m-1-checkpoint)): `git diff --name-only` plus `git status --porcelain` pasted here, showing no path under `lib/` or `app/api/` and the finance route test unchanged. That is AC-111's evidence. The placeholder is built in M-1 and asserted at the checkpoint, then replaced in M-2. The final render test asserts the M-2 line. **TL/BA note:** §11D.2 and §0.1 row 5a need a line recording one workplan and one PR (I do not edit the requirement). |
| **SA-W56** | **AI cost & usage can take the window.** SA-Q34 assumed rolling presets only, but L-2a added a custom window and Today / This month, both sent as whole UTC days (`analyticsFilters.ts:141-157`, `:236-245`). Its 7d and 30d are rolling `period=N`, so they are not the same as Finance's whole-day 7d and 30d. | Every link carries the window, and no link says "(its own window)". **Activity and Costs:** `range=<preset>` for today / 7d / 30d / this_month (both pages resolve through `resolveAdminWindow`, as Finance does), and `range=custom&from&to` for custom. **AI cost & usage:** `range=today` / `range=this_month` as equal presets; 7d, 30d and custom go out as `range=custom&from=<payload window.from>&to=<payload window.to>`, which is exact. A test parses every href back through the **target's own spec** ([M1.6](#m16-links-that-keep-the-window-and-the-account-m1-fr-7-sa-q34)). If SA keeps SA-Q34 as written, AI cost & usage gets `account` only and the "(its own window)" text. |
| **SA-W57** | **How the one-shot `account` key is built.** SA-Q33 asks for a key read once, the drawer opened if the row is on screen, then the key removed by history replace. `useAdminFilters` already offers this: a `pageOnly` field is parsed from the inbound URL, never written, and **its key is removed by the hook's mount write**, `replaceState(null, …)` (`useAdminFilters.ts:140-152`, `:200-210`). The precedent is Audit trail's `search` (`auditTrailFilters.ts:55`). | `USERS_FILTER_SPEC` gains `account: textFilter({ key: 'account', defaultValue: '', pageOnly: true, isValid: UUID })`. **No history write in the page and no new pattern.** The page consumes it **once**, after the first list read that succeeds. If the row is in `shownUsers`, it opens the drawer through the existing `openRow` with that row's Open button. If not, it shows `AdminNotice` "This business is not in the current list". Either way it then calls `setFilters({ account: '' })`. A malformed value fails `isValid`, so it is ignored and removed. Side effect: Clear is enabled until the key is consumed (`isDefault` is false), which is harmless. |
| **SA-W58** | **S5-F7 against the SA-WR-35 pin.** S5-F7 wants the summary's "Paid us: credit boosts" line to carry the S4-W-3 refund-timing note whenever the section does. SA-WR-35 pins `REVENUE_REFUND_TIMING_NOTE` to **one** user, `RevenuePanel.tsx` (`finance.source.guard.test.ts:707-712`). | (a) Widen that pin's allowed users to exactly `[RevenuePanel.tsx, AccountSummary.tsx]`: still one sentence and one constant, with a planted third user as the control. The summary shows the note when `revenue.boosts.notes.refundOrDispute` is true, the panel's own condition. Option (b) would be a pointer line ("Refund timing: see Our revenue") under a new constant, which leaves the pin untouched but makes two sentences. I recommend (a). |
| **SA-W59** | **K-5 needs integer cents of the boost net.** `buildBoostRevenue` exposes only wire numbers, already divided by 100 (`boostRevenue.ts:262-277`). Adding 10.00 + 79.00 as floats is the path S4-W-4 forbids, and scaling back up by × 100 is banned (SA-W54). | `BoostRevenueResult` gains one **non-wire** field: `netMinorByCurrency: Array<{ currency: string \| null; netMinor: number \| null }>`, one entry per line, with `netMinor` null exactly when the wire `net` is null. Its `k5` field is **removed**, because K-5 moves to `ourRevenue.ts`. The names in the 4a export pin are unchanged (`:745-751`), and the one `/ CURRENCY_SCALE` holds (`:663`). The `k5` tests in `boostRevenue.test.ts` move to `ourRevenue.test.ts`. |
| **SA-W60** | **K-5's money field name and headline.** `FinanceTileMoney.one.net` (`financeTypes.ts:241-245`) is pinned by SA-WR-34 (`formatMoney(money.net, money.currency)`, `:769-782`). After M-2 the figure is boosts net **plus** plans received, and the headline "Net of refunds and disputes" (`financeHealth.ts:163`) is wrong for plans. | **Keep the shape**, so SA-WR-34 and `FinanceKpiStrip.tsx` stay unedited. Only the doc comment changes: "K-5's figure: boost net plus plans received, one currency". Replace `K5_NET_HEADLINE` with `K5_REVENUE_HEADLINE = 'Boosts net of refunds and disputes, plus plans received'`. The caption is `TILE_LABELS.k5Sub = 'Credit boosts and plans'` (M2-FR-5). |
| **SA-W61** | **`revenue.plans` changes type.** Today it is `'recorded' \| 'none' \| 'unknown'` from R-d (`financeTypes.ts:231-232`, `financeHealth.ts:580`), pinned by SA-WR-32 tests (`financeHealth.test.ts:472-520`) and page tests (`financePage.render.test.tsx:1177-1226`, `:1320-1332`). M2-FR-11 uses the same name for an object. | Replace the field with the M2-FR-11 object and rewrite those tests to the M-2 meaning. R-d's **behaviour** stays pinned in two places. The repository's R-d describe stays unedited (`BusinessOsFinanceReadRepository.test.ts:288-322`, test-mode rows, no mode filter). A builder test with all businesses checks that R-d's count of a test-mode invoice alone gives `state === 'recorded'`. The seven `REVENUE_PLANS_*` constants (`financeCopy.ts:70-78`) and `PLANS_TEXT` are deleted and grepped out (V-10). |
| **SA-W62** | **Section status after M-2.** Today the section is `unknown` only when R-d and R-k both failed (`financeHealth.ts:569-574`). After M-2, R-d feeds only `state` and the log, and nothing visible. | Status comes from the two money parts: `unknown` when boosts **and** plans failed; `partial` when exactly one failed or either is `partial`; `ok` otherwise (M2-FR-8). An R-d failure, which can only happen with all businesses, gives `state: 'unknown'` and a `failed('revenue_existence')` log, and leaves status unchanged. |
| **SA-W63** | **"A part with no rows counts as an exact 0" (E-34) at a ceiling.** At its ceiling, a read may have cut off the rows of a currency it never returned. | A missing part is an exact 0 **only when that read succeeded and did not reach its ceiling**. Otherwise that currency's total is Unknown. The "Unknown currency" line (`null`) is never exact. |
| **SA-W64** | **What makes a plan row unreadable, and how it is counted.** §11D.4 M2-W-4 lists missing, not a safe integer, negative, and wrong minor unit. It does not say whether such a row is a "payment", or what happens to a row whose tax exceeds its amount. | Row level, as SA-W48. A row is unreadable when any of these holds: `amount_minor` or `amount_tax_minor` is not a JSON number that is a safe integer `>= 0` (numeric strings and `null` included); tax `>` amount; the currency does not normalise; or `minorUnitsPerMajor(code) !== 100`. An unreadable row **is not a payment** (whether it charged anything is unknown). It is counted on its currency line as `unreadable`, adds no money, and makes payments, received and tax "At least" on that line and on its by-business row. The block becomes `partial`, and K-5 for that currency is Unknown. A NULL `tier` is not unreadable: it shows "Unknown plan". A NULL `period_*` shows "Not recorded", never '—'. |
| **SA-W65** | **"Unknown plan" needs a membership check.** `tierLabelForGroup(config, 'tier:' + tier)` returns the raw tier id, not null, when there is no presentation entry (`planGroups.ts:111-114`, `:250-252`). So it cannot tell a tier outside `tierOrder`. | The callback lives in `financeHealth.ts`, which already imports `tierLabelForGroup` (`:119`), so no entitlements import is added anywhere: `planLabelOf: (tier) => tier !== null && deps.config.tierOrder.includes(tier) ? tierLabelForGroup(deps.config, \`tier:${tier}\`) : null`. Null shows "Unknown plan". `planRevenue.ts` takes the callback as a parameter. Test fixtures take the tier from `getEntitlementConfig().tierOrder[0]`, the precedent at `finance.source.guard.test.ts:61`. **QA note:** the paid tier `basic` displays as "Essentials" (1c note), so AC-129's "Basic payment" reads "Essentials" on the list. |
| **SA-W66** | **By-business order across currencies.** "Sorted by received (descending) then name" (M2-FR-2) would rank amounts in different currencies against each other. | Sort by currency (Unknown last), then received descending, then name, then account id. This is the takings precedent (S2-FR-7). Names are looked up only for the shown rows, after the cap, so the name tie-break applies among shown rows, and a tie at the cap falls back to account id. |
| **SA-W67** | **The Finance → Businesses link must reach the row.** The Businesses list defaults to Active (30 days) and shows at most 100 rows, newest first (`page.tsx:68-69`, `:364-365`). A business with no sign-in in 30 days would get the "not in the current list" notice. | The summary links to `/admin/users?status=all&account=<id>`. `status` is the existing key. A business beyond row 100 of All still gets the notice (Risk R-9). |
| **SA-W68** | **The chip renderer.** M1-FR-3 asks for the shared `businessFilterChip` wording and test id. `businessFilterChip` returns an object, and `AdminFilterBar`'s `Chip` renderer is private (`AdminFilterBar.tsx:110-130`). Finance's bar is not migrated yet (DF-4). | A small local `FinanceActiveChip` in `FinanceFilterBar.tsx` renders the object with the same classes as the shared `Chip`. No export is added to the shared folder. It is replaced by `AdminFilterBar` in M-6. The old `finance-account-chip` test id and the "All businesses" X go, and "Remove business" replaces the X (M1-FR-1's "Show all businesses clears it" becomes the chip's X). |
| **SA-W69** | **The contrast guard does not walk Finance.** §11D.7 says "the Finance folder is walked with no exclusion". In fact `contrast.lf1.source.guard.test.ts` walks five pages (`:60-66`) and not Finance, and eight Finance files still use `text-slate-500`. | In the contrast guard: remove `EXCLUDED`, its filter and its header lines, and keep `:112` (it still passes). Do **not** add Finance to the walk: that is the shell migration (DF-4, M-6). The **new** M-1 and M-2 page files are held to `text-slate-400` by a narrow rule in the finance source guard, with a planted control. The Businesses edits are already under that guard's Businesses walk. |
| **SA-W70** | **Two more edits, in the shared folder and the old picker's hint.** The shared picker's header (`AdminBusinessPicker.tsx:3-8`) says the original "stays … for Finance". The original's standing hint ("Only accounts with a business profile can be found by name. Paste a full account id…", `BusinessAccountPicker.tsx:336-339`) disappears with it. | (a) A comment-only edit to `AdminBusinessPicker.tsx:3-8`: the original was deleted in Money M-1. This is a fourth folder, and the code does not change. (b) Finance keeps the hint as a **page-owned help line** under the bar, wired to the picker through `describedBy` (the L-4a SA Q-5 pattern). The LF-6 test (`financeFilterBar.layout.render.test.tsx:93-103`) is rewritten: the help line is under the row, the row still has five items, and the input carries `aria-describedby` with the line's id. |
| **SA-W71** | **Where "Open money view" sits in the drawer.** The summary strip is pinned to hold no link (`businessDrawer.layout.render.test.tsx:370`), and each section box to hold one child (`:663`). A login with no Business OS account would get a 404 from Finance. | Put it in the BOS panel's header block (`BusinessOsPanel.tsx:227-249`), as a second line under the business line, styled with `LINK_CLASS`, Next `Link`, test id `bos-panel-money-view`. Render it only once the panel knows the account is a Business OS account (`!loading && !notBos`). |
| **SA-W72** | **Display caps for M-2.** M2-FR-2 caps the by-business table at "the same displayed-rows limit as the takings table". M2-FR-3 (one business's payments) states no cap. | `FINANCE_LIMITS.PLAN_ACCOUNTS_SHOWN = FINANCE_LIMITS.TAKINGS_ROWS_SHOWN` (200), with "N more businesses not listed". `FINANCE_LIMITS.PLAN_PAYMENTS_SHOWN = 50`, with "N more payments not listed". It is a defensive cap: a monthly plan pays at most four times in 92 days. |
| **SA-W73** | **A second names call.** The by-business table needs names. Every block so far does its own `findNames` call, each awaited one after another after the `Promise.all` (`financeHealth.ts:538`, `:617`, `:658`, `:716`). That adds one round trip. | Follow the precedent: one more call, for the shown plan rows only, made only when the table has rows. With a business picked there is no call, because the payment list names no business. QA records `durationMs` (M2-FR-14, p95 under 2 s). If SA prefers, the plan ids can join the takings names call instead (one call for both blocks). |

---

## Analysis Summary

| Area | Touched how | Part |
|---|---|---|
| Finance page | `FinanceFilterBar.tsx` (shared picker, local chip, help line); `FinanceView.tsx` (picked-name state, header, summary); `AiCostSection.tsx` (link carries account and window); new `AccountHeader.tsx`, `AccountSummary.tsx`, `financeAccount.ts` (pure name and paying rules) and `financeLinks.ts` (pure hrefs); copy | M-1 |
| Original picker | `app/admin/audit-trail/BusinessAccountPicker.tsx` **deleted** | M-1 |
| Guards naming the original | Contract, layout folder, contrast (edited); BOS-LLM G-1 (run unchanged) | M-1 |
| Businesses page | `usersFilters.ts` (page-only `account`); `page.tsx` (one-shot open, or the notice); `BusinessOsPanel.tsx` ("Open money view") | M-1 |
| Shared folder | `AdminBusinessPicker.tsx`, header comment only (SA-W70) | M-1 |
| Finance read repository | R-m, R-m′, `FINANCE_PLAN_PAYMENT_COLUMNS`, `FinancePlanPaymentRow`, a private `paidInvoiceFilter`, header; barrel | M-2 |
| Builders | New `planRevenue.ts` and `ourRevenue.ts`; `boostRevenue.ts` gains `netMinorByCurrency` and loses `k5` (SA-W59) | M-2 |
| Builder / wiring / types / route | `financeHealth.ts` (one settled read, the R-d branch, plans, totals, K-5, counts, names); `financeHealthDeps.ts` (two lines); `financeTypes.ts`; `route.ts` (info line) | M-2 |
| Page | `RevenuePanel.tsx` (plans part through a new `PlanRevenuePart.tsx`); `AccountSummary.tsx` fills "Paid us: plan" and "Paid us, total"; copy. `FinanceKpiStrip.tsx` is **not** edited (SA-W60) | M-2 |
| Tables read | `business_os_billing_events` only, already one of the eight pinned for R-d | M-2 |
| Not touched | The writer `BusinessOsBillingEventRepository`; every Stripe or billing file; `currencyGroups.ts` (its export pin); `financeRules.ts`; `creditsSection.ts`; `FinanceSection.tsx`; `FinanceKpiStrip.tsx`; `useFinanceData.ts`; `financeUrl.ts`; the entitlements module and its registrations; every migration | — |

---

## Implementation Approach

1. **M-1 first, kept separable.** The picker swap and the four guard edits land first. Per the SA-RR-5a estimate note, I report to TL at the end of day 1 if they are not green. Then the pure helpers (`financeAccount.ts`, `financeLinks.ts`) with unit tests, then the header and summary, then Businesses. The M-1 checkpoint (SA-W55) records the diff before any `lib/` file changes.
2. **M-2: repository first, behind the existing pins.** R-m and R-m′ go through the existing pager. The no-write, one-caller, writer-name and limits pins pass unedited, and so does the table pin.
3. **Pure builders next.** `planRevenue.ts`, then `ourRevenue.ts`, then the `boostRevenue.ts` change. Each takes everything as parameters (SA-WR-4) and imports no repository (SA-W22).
4. **Builder, wiring, types and route**, then the **page**.
5. **Guard additions last**, each with a planted negative control (2b conclusion 1, 4a conclusion 2: make the wrong path impossible).
6. **No new pattern.**
   - The read pair and pager are R-e's and R-k's.
   - Integer-cents readability per row is SA-W48's.
   - The `tierLabelOf` callback follows `aiCost` and `creditsSection`.
   - The page-only URL key follows Audit trail's `search`.
   - The section frame and shared parts are the takings and boosts blocks'.
   - The local chip renderer (SA-W68) is the only near-duplicate, and M-6 removes it.

---

## Files to Create / Modify / Delete

### Create

| File | Purpose | Part |
|---|---|---|
| `app/admin/finance/financeAccount.ts` | Pure: `accountNameFor(query, picked, payload)` (M1-FR-3 order) and `payingStateOf(accounts)` (E-35). Imports types only | M-1 |
| `app/admin/finance/financeLinks.ts` | Pure: `activityHref`, `costsHref`, `analyticsHref`, `businessesHref`, `section3AnalyticsHref` from `(accountId, window)`. Literal paths and keys only; no import from another admin page | M-1 |
| `app/admin/finance/components/AccountHeader.tsx` | Name, plan group (with the Founding Partner chip), Paying / Not paying / Unknown, "every section below is for this business only" | M-1 |
| `app/admin/finance/components/AccountSummary.tsx` | Charged AI cost; boost net per currency; "Paid us: plan" (placeholder in M-1, filled in M-2); "Paid us, total" (M-2); credits; plan group; links | M-1, M-2 |
| `app/admin/finance/__tests__/financeAccount.test.ts` | Name order (a)→(b)→(c), platform label, paying rule (every group key) | M-1 |
| `app/admin/finance/__tests__/financeLinks.test.ts` | Each href parses back through the **target's own spec** (SA-W56) | M-1 |
| `app/admin/finance/__tests__/financeAccount.render.test.tsx` | Header, summary, states, links, no-arithmetic render half (AC-110, AC-112, AC-113, S5-F7) | M-1, M-2 |
| `app/admin/users/__tests__/businessesDeepLink.render.test.tsx` | AC-115: valid on screen, not on screen, malformed, key removed, focus return, status and search unchanged | M-1 |
| `lib/business-os/finance/planRevenue.ts` | Pure `buildPlanRevenue(input)` | M-2 |
| `lib/business-os/finance/ourRevenue.ts` | Pure `combineOurRevenue(input)`: per-currency totals and K-5 money (SA-Q40, E-34) | M-2 |
| `lib/business-os/finance/__tests__/planRevenue.test.ts` | AC-117 method (`checkSeventeen` helper), AC-119 to AC-121, AC-124, AC-125 builder halves; SA-W64, SA-W65 | M-2 |
| `lib/business-os/finance/__tests__/ourRevenue.test.ts` | AC-122, AC-125, AC-126 K-5 halves; E-34; SA-W63; the five K-5 kinds moved from `boostRevenue.test.ts` | M-2 |
| `app/admin/finance/components/PlanRevenuePart.tsx` | The plans part of "Our revenue": lines, by-business table or payment list, deleted line, notes | M-2 |

### Modify

| File | Change | Part |
|---|---|---|
| `app/admin/finance/components/FinanceFilterBar.tsx` | `AdminBusinessPicker` (with `describedBy`); `onPick(accountId, name)` up to the view; `FinanceActiveChip` from `businessFilterChip`; the help line | M-1 |
| `app/admin/finance/components/FinanceView.tsx` | `pickedName` state `{ accountId, name } \| null` (never in the URL); header and summary when `data.accountId !== null`; `window` passed to `AiCostSection` | M-1 |
| `app/admin/finance/components/AiCostSection.tsx` | The Section 3 link gets `section3AnalyticsHref(accountId, window)` (CR G-8) | M-1 |
| `app/admin/finance/financeCopy.ts` | M-1 strings (header, summary, links, help line); M-2 strings; delete `REVENUE_PLANS_*`; `TILE_LABELS.k5Sub`; `REVENUE_CANNOT`; subtitles | M-1, M-2 |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx` | Mock the shared picker (same shape); the help-line pin rewritten (SA-W70) | M-1 |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Mock the shared picker; chip name (AC-109); all-businesses unchanged (AC-116); 4a plans-line cases rewritten (SA-W61); M-2 render cases | M-1, M-2 |
| `app/admin/users/usersFilters.ts` | `account`: page-only text filter, UUID, default `''` (SA-W57) | M-1 |
| `app/admin/users/page.tsx` | One-shot consume effect; `AdminNotice` "This business is not in the current list"; `data-account-id` on each `tr` (to find its Open button) | M-1 |
| `app/admin/users/components/BusinessOsPanel.tsx` | "Open money view" link (SA-W71) | M-1 |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | AC-114: href, no name or email, hidden for a login with no Business OS account | M-1 |
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | `PICKERS = [SHARED_PICKER]`; `:92` becomes a deletion pin; header | M-1 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | G-6 comment (`:518-522`) only | M-1 |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | Remove `EXCLUDED` (`:50`), its filter (`:64`) and its header lines (`:9-11`); `:112` kept | M-1 |
| `app/admin/components/layout/AdminBusinessPicker.tsx` | Header comment `:3-8` only (SA-W70) | M-1 |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | R-m, R-m′, columns, row type, `paidInvoiceFilter`, header | M-2 |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Separate import line; a `slice 5a` column describe; `describe.each` over R-m and R-m′; pins `:124-139` and `:512-567` and the R-d describe `:288-322` unedited | M-2 |
| `lib/repositories/index.ts` | Export `FINANCE_PLAN_PAYMENT_COLUMNS` and the type `FinancePlanPaymentRow` | M-2 |
| `lib/business-os/finance/boostRevenue.ts` | `netMinorByCurrency`; `k5` removed (SA-W59) | M-2 |
| `lib/business-os/finance/__tests__/boostRevenue.test.ts` | `netMinorByCurrency` cases; the K-5 cases move to `ourRevenue.test.ts` | M-2 |
| `lib/business-os/finance/financeTypes.ts` | `FinancePlan*` types; `FinanceRevenueSection.plans` (object) and `totals`; `FinanceTileMoney` doc comment | M-2 |
| `lib/business-os/finance/financeHealth.ts` | Pick +2; one settled read; R-d only without an account; plans, names, totals, K-5, `state` (E-36), status (SA-W62); `counts.plans`; constants; header | M-2 |
| `lib/business-os/finance/financeHealthDeps.ts` | Two delegation lines; header bullet | M-2 |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | The fake gains R-m and R-m′; `:472-520`, `:633-660`, `:761-846` rewritten to E-36 / AC-123; new describes | M-2 |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | A new `slice 5a` describe; the SA-WR-35 user list widened (SA-W58); the `REPOSITORY_TABLES` comment names R-m. No other existing rule edited | M-2 |
| `app/api/admin/business-os/finance/route.ts` | Info line: `sections.revenuePlans`, `counts.plans`; header sentence | M-2 |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Mocks for R-m and R-m′ (so `allReads()` covers them, AC-128); `:479` and `:901` become zero R-d calls; payload walker; info line | M-2 |
| `app/admin/finance/components/RevenuePanel.tsx` | `PLANS_TEXT` and the plans line go; `PlanRevenuePart` under "Plans", boosts under "Credit boosts"; subtitle | M-2 |

### Delete

| File | Why |
|---|---|
| `app/admin/audit-trail/BusinessAccountPicker.tsx` | M1-FR-2, C-6 / E-39. Nothing imports it after the swap |

**Not modified, on purpose:**
- `FinanceKpiStrip.tsx` (SA-W60), `FinanceSection.tsx`, `financeFormat.ts`, `financeUrl.ts`, `useFinanceData.ts`.
- `currencyGroups.ts` (its export pin at `:377-382`), `financeRules.ts`, `creditsSection.ts`, `takings.ts`, `paymentProblems.ts`, `planGroups.ts` (registered symbol set unchanged).
- The billing-event writer repository and every file under `lib/business-os/billing/`, `app/api/stripe/` and `lib/payments/`.
- `enforcementPoints.test.ts`, every migration, and the requirement MDs (TL records the workplan link).

---

## PART 1 — M-1: One account, one screen

### M1.1 The picker swap and the original's deletion

**`FinanceFilterBar.tsx`:**
- Replace the import at `:19-21` with `import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';`.
- The picker column (`:114-119`) renders `<AdminBusinessPicker selectedAccountId={query.accountId ?? ''} onSelect={(id, name) => onPick(id, name)} describedBy={helpId} />`. `helpId` comes from `useId()`.
- `onPick` is a new prop. The view sets `pickedName = { accountId: id, name }` and calls `setQuery({ ...query, accountId: id || null })`. The URL keeps `accountId`, `preset`, `from` and `to` exactly as today (M1-FR-1). The rename to `range` / `account` is M-6.
- Under the controls row sits the page-owned help line `<p id={helpId} className="text-xs text-slate-400">{FILTER_BUSINESS_HELP}</p>`, carrying the original's sentence. It is a full-width line under the row, not an item of the row (SA-W70).
- The chip (`:128-140`) is replaced by `FinanceActiveChip` over `businessFilterChip({ accountId, name: chipName, onRemove: () => onChange({ ...query, accountId: null }) })` (SA-W68). `chipName` is computed by the view ([M1.3](#m13-the-business-name-sa-q32)) and passed in.
- Control heights are unchanged: the shared input is `py-1.5 text-sm`, the same as the original's. The LF-6 classes on the other controls stay.

**Deletion:** `app/admin/audit-trail/BusinessAccountPicker.tsx` is removed. Then `grep -rn "BusinessAccountPicker" app lib components hooks` must return only:
- the deletion pin in the contract test;
- the BOS-LLM G-1 rule;
- the contrast guard's `:112`.

Those three are test files, intended. The two finance test mocks (`financeFilterBar.layout.render.test.tsx:20-28`, `financePage.render.test.tsx:65-66`) switch to `jest.mock('@/app/admin/components/layout/AdminBusinessPicker', …)`. The mock keeps the real `businessFilterChip` through `jest.requireActual`.

### M1.2 The four guard edits

| Guard | Exact edit | Weakens a rule? |
|---|---|---|
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | `PICKERS = [SHARED_PICKER]` (`:40`), so `ORIGINAL_PICKER` no longer feeds the path and logging checks (`:153`, `:202`). `:92` `expect(SURFACE_FILES).toContain(ORIGINAL_PICKER)` becomes `expect(fs.existsSync(path.join(ROOT, ORIGINAL_PICKER))).toBe(false)`: a **deletion pin**, so a re-added original is red. The header (`:24-31`) says the original was deleted in Money M-1 | No. The path and logging checks still run on the shared picker, and the surface scan is unchanged |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | Comment `:518-522` only: "The original `BusinessAccountPicker.tsx` was deleted in Money M-1 (finance health §11D, M1-FR-2)." | No. No assertion changes |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | Delete `EXCLUDED` (`:50`) and its `.filter(...)` at `:64`, so Audit trail is walked whole. Header `:9-11` drops the exclusion sentence. `:112` stays and still passes. Finance is **not** added to `PAGES` (SA-W69) | No. Audit trail's walk widens by nothing (the file is gone) |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` G-1 (`:536-549`) | **Unchanged.** It still forbids importing the original and still guards against a re-added file. Run it | — |

Also: `AdminBusinessPicker.tsx:3-8` is a comment-only edit (SA-W70 a).

### M1.3 The business name (SA-Q32)

`financeAccount.ts` (pure):

```ts
/** M1-FR-3: the picked name, else a payload row for that exact id, else null (the chip then shows the short id). */
export function accountNameFor(
  accountId: string,
  picked: { accountId: string; name: string | null } | null,
  data: FinancePayload | null,
): { name: string | null; platform: boolean };
```

| Order | Source | Rule |
|---|---|---|
| (a) | `picked` | Only when `picked.accountId === accountId` and `name` is non-blank. Held in `FinanceView` state, never in the URL |
| (b) | Payload, only when `data.accountId === accountId` | Section 4 `credits.figures.rows` row with that id, then Section 3 `aiCost.figures.topAccounts`, then `takings.figures.rows`, then `paymentProblems.overdueInvoices` / `overdueInstalments` rows. Only `nameStatus === 'found'` gives a name. `'platform'` gives `platform: true` (the chip shows the existing `NAME_PLATFORM`; in practice the route 404s a platform id, `route.ts:147-150`) |
| (c) | — | `name: null`, so `businessFilterChip` falls back to `formatShortId` |

Privacy:
- The name goes into the chip, the header and the summary only.
- `FinanceView` writes the URL only through `serialiseFinanceUrl(query)`, whose `FinanceQuery` has no name field (`financeUrl.ts:16-23`).
- No `logger` call is added in M-1.
- A source rule ([Guard table](#guard-table-line-by-line), T-G7) pins that `pickedName` never reaches `serialiseFinanceUrl`, `router.replace` or `fetch`.

### M1.4 Account header (E-35)

`AccountHeader.tsx` is rendered by `FinanceView` above `FinanceKpiStrip` when `data.accountId !== null` (M1-FR-10: never with all businesses).

| Element | Source |
|---|---|
| Business name | [M1.3](#m13-the-business-name-sa-q32); the short id when null |
| Plan group | `accounts.figures.groups` (one-business form): the group with `count > 0`, labelled through the existing `groupLabel` (`AccountsByPlanSection.tsx:205-208`). The Founding Partner `StatusChip` when that group's `foundingPartners > 0` (BD-15), reusing `ACCOUNTS_FOUNDING_CHIP`. "Unknown" when Section 1 is `unknown` or no group has a count |
| Paying state | `payingStateOf(accounts)`: **Paying** when the group key starts `tier:`. **Not paying** when it is `trial`, `founding_partner`, `comped` or `unknown_held`. **Unknown** when Section 1 is `unknown`, the group is `tier_set` (paying read failed), or no group has a count. A `StatusChip` with words, tone `neutral` (no green: the slice does not judge the state) |
| Scope sentence | `ACCOUNT_SCOPE_NOTE = 'Every section below is for this business only.'` |

There are no new figures and no arithmetic.

### M1.5 Account summary (M1-FR-5, M1-FR-6, S5-F7)

`AccountSummary.tsx` sits directly under the header. It is a `<section>` with `aria-labelledby` and test id `account-summary`, so it adds one landmark. Every value is **selected and formatted** from the payload, and the component holds no `+`, `-`, `reduce` or conversion (AC-112).

| Line | Source | States |
|---|---|---|
| **AI cost, charged** (BD-18) | `aiCost.figures.costUsd` through `atLeast(formatUsd(v), figures.exact)`: the exact expression Section 3 uses (`AiCostSection.tsx:71`) | `aiCost.status === 'unknown'` → "Unknown". `coverage !== 'after_cutover'` → the short cut-over note `ACCOUNT_CUTOVER_NOTE` (the same condition as `CutoverNotice`). `entirely_before_cutover` → the note **instead of** a figure (AC-40) |
| **Paid us: credit boosts** | `revenue.boosts.lines`: one line per currency, `formatMoney(line.net, line.currency)`; net null → `REVENUE_CUT_OFF` when `!notes.exact`, else "Unknown" (the panel's `unknownText`) | `boosts.status === 'unknown'` → "Unknown". `notes.empty` → "None in this window". The refund-timing note when `notes.refundOrDispute` (S5-F7, SA-W58) |
| **Paid us: plan** | M-1: `ACCOUNT_PLAN_PLACEHOLDER = 'Plan payments: shown in the next update'`. M-2: [M2.8](#m28-the-page) | — |
| **Paid us, total** | M-2 only ([M2.4](#m24-k-5-and-paid-us-total-the-per-currency-combiner)) | — |
| **Credits** | This account's row in `credits.figures.rows` (`accountId === data.accountId`): allowance, used, % used and gifted outstanding. `usedPercent` (`CreditsSection.tsx:72-76`) becomes an export of that file and is imported here, so there is one rule; the summary does not copy it | `credits.status === 'unknown'` or no row → "Unknown". `kind: 'no_allowance'` → `CREDITS_NO_ALLOWANCE`. `kind: 'unknown'` → "Unknown". `giftedOutstanding === null` → "Unknown" |
| **Plan group** | As the header | As the header |
| **Links** | [M1.6](#m16-links-that-keep-the-window-and-the-account-m1-fr-7-sa-q34) | — |

The boost lines stay one per currency, with no total (BD-12, AC-112). "Each equals the same figure in its section on the same render" (AC-110) is proven by a render test that reads both nodes' text.

### M1.6 Links that keep the window and the account (M1-FR-7, SA-Q34)

`financeLinks.ts` is pure, and the window passed in is `data.window` (`{ preset, from, to }`, inclusive UTC dates from the server).

| Link (copy) | Href | Window rule |
|---|---|---|
| Business OS AI **Activity** | `/admin/business-os-llm?tab=activity&{window}&account=<id>` | `range=<preset>` for today / 7d / 30d / this_month; `range=custom&from=…&to=…` for custom |
| Business OS AI **Costs & credits** | `/admin/business-os-llm?tab=costs&{window}&account=<id>` | Same |
| **AI cost & usage** | `/admin/analytics?{window}&account=<id>` | SA-W56: `range=today` / `range=this_month`; 7d, 30d and custom → `range=custom&from=<window.from>&to=<window.to>` |
| **Businesses** | `/admin/users?status=all&account=<id>` | No window (SA-W67) |
| Section 3's "AI cost & usage" (CR G-8) | The same as AI cost & usage | Same |

Rules:
- Every value goes through `URLSearchParams`.
- Only the account **id** is used: never a name or an email.
- `scope` is omitted on the analytics link, because its default is `bos`.

**Contract test** (`financeLinks.test.ts`) imports the targets' own specs, **in the test only**: `ACTIVITY_FILTER_SPEC`, `COSTS_FILTER_SPEC` and `ANALYTICS_FILTER_SPEC`. For every preset and for a custom window it checks that:
- each field's `parse(get)` on the href's params returns the intended window and the account, never `undefined` (which would mean the target ignores the value);
- `resolveWindow(parsed, now)` gives exactly `data.window.from` / `to`.

For analytics 7d and 30d, it checks that the parsed value is `custom` with those dates.

If SA keeps SA-Q34 as written, the analytics href drops the window and the link text gains `ACCOUNT_LINK_OWN_WINDOW = '(its own window)'`.

### M1.7 Businesses: "Open money view" and the one-shot `account` key (SA-Q33)

**Drawer to Finance (M1-FR-8, AC-114).** `BusinessOsPanel.tsx` adds this under the header line (`:227-249`), only when `!loading && !notBos` (SA-W71):

```tsx
<Link data-testid="bos-panel-money-view" href={`/admin/finance?accountId=${encodeURIComponent(accountId)}&preset=this_month`} className={LINK_CLASS}>Open money view</Link>
```

It carries the id only, never a name or an email. `LINK_CLASS` is `text-blue-300`, so the Businesses contrast walk passes.

**Finance to drawer (M1-FR-9, AC-115).**
- `usersFilters.ts`: `account: textFilter({ key: 'account', defaultValue: '', pageOnly: true, isValid: (raw) => UUID.test(raw) })` (SA-W57). The header gains: "`account` is a one-shot inbound key (layout U-10 exception, E-38): read on arrival, never written, removed by the hook's first write; it opens a drawer and filters nothing."
- `page.tsx`: `<tr … data-account-id={user.id}>`, then one effect:

```ts
// SA-Q33 / E-38: consume the inbound account key once, after the first read that succeeded.
useEffect(() => {
  const pending = filters.account;
  if (!pending || loading || !hasLoaded) return;
  const row = shownUsers.find((u) => u.id === pending.toLowerCase()) ?? null;
  const button = row ? contentRef.current?.querySelector<HTMLButtonElement>(
    `tr[data-account-id="${row.id}"] [data-testid="row-open"]`) ?? null : null;
  if (row && button) openRow(row, button); else setDeepLinkMissing(true);
  setFilters({ account: '' });
}, [filters.account, loading, hasLoaded, shownUsers]);
```

  - The CSS selector is built only from `row.id`, a list row's UUID. It is never built from the URL text, so nothing from the URL reaches the selector.
  - `deepLinkMissing` renders `<AdminNotice testId="users-deeplink-missing">This business is not in the current list</AdminNotice>`. It is cleared by the next status or search change.
  - Opening goes through the existing `openRow`, so `opener.current` is the row's Open button, and focus returns there on close (D-6). There is no new focus code.
- `fetchUsers` depends on `filter` only (`:285-287`), so the page-only key starts **no** read. The list still reads exactly once on mount (U-7 test `businessesLayout.render.test.tsx:381-390`).
- `status` and the search are unaffected: the search is still never in the URL, and `status` is still the only written key.

### M1.8 M-1 checkpoint

This is AC-111's evidence (SA-W55). Before any M-2 file is touched:
1. `git diff --name-only; git status --porcelain`, pasted here. It must show **no** path under `lib/` or `app/api/`. Expected: `app/admin/finance/**`, `app/admin/users/**`, the deleted original, the three guard files, the shared picker comment, and the new test files.
2. `npx jest app/api/admin/business-os/finance --ci`: route test unchanged and green. `git diff --exit-code -- app/api lib` exits 0.
3. V-1 to V-3 and V-7 on the M-1 diff ([Verification plan](#verification-plan)), pasted.
4. The placeholder line (AC-110's M-1 clause) asserted by the render test at this point. M-2 then replaces that assertion.

---

## PART 2 — M-2: Plan payments received

### M2.1 The reads: R-m and R-m′

Both are in `BusinessOsFinanceReadRepository`, on the service role (documented in its header). Neither is in `BusinessOsBillingEventRepository` (SA-F2; its caller list is untouched). Both return `{ data, error }` and never throw (`fail`, `:327-334`).

**Columns (exact, exported):**

```ts
/**
 * The plan payment columns R-m / R-m′ select (slice 5a, §11D.6). No Stripe id,
 * no refusal reason, no plan_written, no mode column (BD-14, M2-FR-10) and no
 * created_at (never a revenue date, M2-W-1).
 */
export const FINANCE_PLAN_PAYMENT_COLUMNS =
  'id, user_id, kind, tier, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at';

/** One paid plan invoice, as "Our revenue" reads it (slice 5a). Amounts are INTEGER minor units, as JSON numbers. */
export interface FinancePlanPaymentRow {
  id: string;
  /** NULL: a payment of a deleted account (ON DELETE SET NULL). */
  user_id: string | null;
  kind: string | null;
  tier: string | null;
  amount_minor: number | null;      // Stripe amount_paid: tax INCLUDED
  amount_tax_minor: number | null;
  currency: string | null;          // 'usd' today (CHECK currency_usd)
  period_start: string | null;      // timestamptz
  period_end: string | null;        // timestamptz
  paid_at: string | null;           // timestamptz; decides the window (in the query only)
}
```

**The filter.** It is a private method, used by both reads on every page:

```ts
/** R-m / R-m′: kind invoice_paid AND paid_at in the half-open range, on every page. */
private paidInvoiceFilter(range: FinanceClientRange): ClientFilter {
  const inRange = this.rangeFilter('paid_at', range);
  return () => {
    const applyRange = inRange();                     // refuses a bad range before any query
    return (query) => applyRange(query.eq('kind', 'invoice_paid'));
  };
}
```

| # | Signature | Query |
|---|---|---|
| **R-m** | `listPlanPaymentsAllAccountsPaidInRange(range, opts?)` | `pageClientRows('listPlanPaymentsAllAccountsPaidInRange', () => this.supabase.from('business_os_billing_events').select(FINANCE_PLAN_PAYMENT_COLUMNS), this.paidInvoiceFilter(range), 'Plan payment rows', null, opts)` |
| **R-m′** | `listPlanPaymentsForAccountPaidInRange(accountId, range, opts?)` | The same with `{ accountId }`. The UUID is checked first (`:712-714`), then `.eq('user_id', accountId)` on every page |

| Item | Spec |
|---|---|
| Kind | `.eq('kind', 'invoice_paid')` in the query (M2-W-2, DF-7). `mismatch_refused` and every other kind are never read |
| Range | Half-open `from <= paid_at < to`, ISO strings, through `rangeFilter` (`:665-675`). `created_at` and `period_start` never decide (M2-W-1) |
| Paging | `pageClientRows`: keyset on `id`, page 1,000, ceiling 5,000 (`CLIENT_*`, SA-Q36). `>=` sets `reachedCeiling: true`. No new limit key, so the equality pin `:124-139` is untouched |
| Mode | No `livemode` anywhere (BD-14, BD-20; the repo-wide rule `finance.source.guard.test.ts:361-365`) |
| Index | None on `paid_at`. With 9 rows today a scan is trivial (SA-Q36 accepted). See Risk R-8 |
| Logging | R-m: `info { method, rows, reachedCeiling, durationMs }`. R-m′: `debug { method, rows, reachedCeiling }` (the pager's lines). Never an amount, a currency, a tier or an id |
| Writes | None. The no-write (`:519-527`) and no-aggregate (`:529-531`) pins are unedited |
| Table pin | `business_os_billing_events` is already one of the eight (R-d). Both `.from(` calls are literals, so `fromCallsOf === tables.length` holds (SA-WR-16) |
| Header | The opening block names slice 5a and R-m / R-m′ (layer A). They go in the ALL ACCOUNTS / ONE ACCOUNT lists, in TEST AND LIVE MODE (layer A), and in PAGING ("R-e to R-m′ use one pager"). The billing-event repository stays named in words only (`:15-24`) |

**Tests (`BusinessOsFinanceReadRepository.test.ts`, T1).** A new import line keeps the earlier ones byte-identical, and the cases run as a `describe.each` over R-m and R-m′ (the 4a shape, `:880-995`).
1. **Columns:** equal to the exact list. Contain none of `livemode`, `stripe_`, `refusal_reason`, `plan_written`, `created_at`.
2. **One page:** table `business_os_billing_events`; the exact columns; `eq` args `[['kind','invoice_paid']]` (R-m) or `[['kind','invoice_paid'],['user_id',A]]` (R-m′); `gte('paid_at','2026-10-01T00:00:00.000Z')`; `lt('paid_at','2026-11-01T00:00:00.000Z')`; `order('id', asc)`; `limit(1000)`; no `not` or `or`; `JSON.stringify(q)` has no `livemode`.
3. **AC-118 boundary:** a `[2026-11-01T00:00:00.000Z, 2026-12-01T00:00:00.000Z)` range carries exactly those ISO strings on `gte` / `lt`. The database applies the microsecond rule to `timestamptz`.
4. **Keyset:** a full first page, then `gt('id', last)`; the kind filter (and the user filter for R-m′) on **every** page.
5. **Ceiling:** `{ ceiling: 3, pageSize: 2 }` gives 3 rows and `reachedCeiling: true`. Exactly 3 is true; 2 is false.
6. **R-m′ id:** `''`, `'not-a-uuid'` and `"' or 1=1"` are refused **before** `from` is called, with `{ data: null, error }` and a warn. No info line carries the id.
7. **Bad range or options:** refused before querying. **Read error:** `{ data: null, error }`, logged at error, never throws.
8. **Unedited:** the R-d describe (`:288-322`), the limits equality (`:124-139`), no-write, no aggregate, writer names (`BillingEvent` included, `:533-539`) and one caller (`:541-567`).

### M2.2 Money maths: integer cents, exact

This lives in `planRevenue.ts`. It imports:
- `minorUnitsPerMajor` from `@/lib/payments/refundMath`;
- `normaliseCurrencyCode`, `groupByCurrency` and `CURRENCY_SCALE` from `./currencyGroups`.

It never imports `toUnits` or `toHundredths`.

```ts
/** SA-W64: one row's money in integer minor units, or null when any part is unreadable. */
function readPlanMoney(row: PlanPaymentInput): { code: string; amount: number; tax: number } | null;
//  code = normaliseCurrencyCode(row.currency)        (trim + upper case: 'usd' → 'USD')
//  code !== null && minorUnitsPerMajor(code) === 100  (only a normalised code reaches it; it trims)
//  amount, tax: typeof 'number', Number.isSafeInteger, >= 0; tax <= amount
```

| Rule | How |
|---|---|
| Scale | Integer cents **are** hundredths only when `minorUnitsPerMajor(code) === 100`. They go to `groupByCurrency` as `hundredths: amount`. Never `toHundredths`, `toUnits`, `* 100` or `CURRENCY_SCALE *` (M2-W-4, AC-120) |
| Currency | `usd` and `USD` → one `USD` line (M2-W-7; boosts store `USD`) |
| Sums | Inside `groupByCurrency`, with `overflow` past the safe range treated as unreadable, never silent |
| Wire | Each sum divided by `CURRENCY_SCALE` once (`toMoney`, the 4a shape). `formatMoney` prints two decimals: 7900 → "USD 79.00" |
| Zero amount | `amount === 0` (readable): not a payment. It is counted in the line's `zeroAmountInvoices` and in `notes.zeroAmountInvoices`, and adds nothing (M2-W-5, SA-Q39) |
| No FX | No rate, no `exchange_rates`, no export that adds two lines (BD-12) |

### M2.3 The plan revenue builder

`lib/business-os/finance/planRevenue.ts` is pure (SA-WR-4) and has a structural input (SA-W22).

```ts
export interface PlanPaymentInput {
  id: string; user_id: string | null; kind: string | null; tier: string | null;
  amount_minor: unknown; amount_tax_minor: unknown; currency: unknown;
  period_start: string | null; period_end: string | null; paid_at: string | null;
}

/** M2-W-2: the one kind that counts (also filtered by the query; a defence here). */
export const PLAN_PAYMENT_KIND = 'invoice_paid';

export function buildPlanRevenue(input: {
  payments: { rows: readonly PlanPaymentInput[]; reachedCeiling: boolean } | null; // null: the read failed
  scope: 'all' | 'one';
  /** SA-Q37 / SA-W65: the plan's display label, or null for "Unknown plan". Injected by the builder. */
  planLabelOf: (tier: string | null) => string | null;
  isPlatformAccount: (accountId: string) => boolean;
  limits: { accountsShown: number; paymentsShown: number };
}): PlanRevenueResult;
```

| Figure | Rule |
|---|---|
| Counted row | `kind === PLAN_PAYMENT_KIND`, exactly. Any other kind (NULL included) goes to `otherKind` and nowhere else (M2-W-2, AC-119) |
| Payment | A counted, readable row with `amount > 0` |
| Lines (per currency) | `payments`; `received` = Σ amount; `tax` = Σ tax (shown, not deducted); `businesses` = distinct non-null `user_id` with a payment; `zeroAmountInvoices`; `unreadable`; `exact` = read not at ceiling and `unreadable === 0` and no overflow. A line exists for a currency with a payment or an unreadable row. **A zero-amount-only currency has no line** (no "0.00", M2-FR-8) |
| By business (`scope 'all'`) | One row per `(user_id, currency)` for non-null `user_id`, with payments and received. Sort per SA-W66. Cap `limits.accountsShown`; `accountsTotal` is the row count before the cap. Names are added by `financeHealth.ts` |
| Deleted accounts (`scope 'all'`) | Per currency over payments with `user_id` NULL: payments and received (M2-W-8). Never named. `[]` when none. `null` with `scope 'one'` |
| Payment list (`scope 'one'`) | Payments (amount > 0) newest first by `Date.parse(paid_at)`, then `id`. Each row: `paidAt`, `planLabel` (`planLabelOf(row.tier)`), `received`, `tax`, `currency`, `periodStart`, `periodEnd`. Cap `limits.paymentsShown`; `paymentsTotal` is the count before the cap. `accounts` and `deletedAccounts` are `null` |
| Notes | `{ empty, exact, zeroAmountInvoices, unreadable, otherKind }`. `empty` = no payment in the window |
| Status | Read failed → `unknown`, figures null. Else `partial` when at the ceiling, or any unreadable, overflow or other-kind row exists. Else `ok` |
| K-5 input | `receivedMinorByCurrency: Array<{ currency, receivedMinor: number \| null }>`, null when the line is not exact. This is non-wire input for the combiner |
| Account `state` input | `countedPayments` (for E-36) |
| Counts | `{ rows, ceiling, payments, zeroAmount, unreadable, otherKind, currencies, accountsTotal, deletedAccountPayments, paymentsTotal }` |

The builder never decides the window, because the query does (AC-118). It reads `paid_at` only to sort the list and put it on the wire. It reads no clock (`Date.now` and `new Date(` are pinned out).

**Tests (`planRevenue.test.ts`, T2):**
- **AC-117 method:** a fixture's per-currency figures equal an independent `checkSeventeen(rows)` written in the test from check 17's SQL: `upper(btrim(currency))`, `count filter amount > 0`, `count filter amount = 0`, `count distinct user_id filter amount > 0`, `sum(amount)`, `sum(tax)`, and the deleted-account columns.
- **AC-119:** a planted `mismatch_refused` row with `amount_minor` 7900 is left out of every sum and counted in `otherKind`; the block is `partial`.
- **AC-120:** 7900 → 79.00; 1999 → 19.99; `usd` and ` USD ` on one line. Each of these is unreadable, counted, excluded, makes the line "At least", the block `partial` and never shows 0:
  - 1.5, -1, `Number.MAX_SAFE_INTEGER + 2`, `'7900'` and `null`;
  - tax greater than amount;
  - a NULL currency;
  - a mocked `minorUnitsPerMajor` returning 1 for the code.
  A `jest.mock('@/lib/payments/refundMath')` spy proves it is called with the normalised code only.
- **AC-121:** a zero-amount invoice is not a payment; received is unchanged; the note counts it; a zero-only currency has no line.
- **AC-124 builder half:**
  - the by-business rows equal check 18's plan column per account and currency;
  - the deleted line comes from NULL `user_id` only;
  - the sort follows SA-W66;
  - the cap gives `accountsTotal`.
- **AC-125:** `reachedCeiling` gives `exact: false` on every line, receivedMinor null, and `partial`.
- **AC-126 empty:** `empty: true`, `lines: []`, status `ok`.
- **SA-W65:** `planLabelOf` gets the stored tier. A tier from `getEntitlementConfig().tierOrder[0]` gets its label; `'not_a_tier'` and `null` give null ("Unknown plan").
- **Order:** the list is newest first and stable on ties.

### M2.4 K-5 and "Paid us, total": the per-currency combiner

`lib/business-os/finance/ourRevenue.ts` is pure, sits beside `boostRevenue.ts`, and implements SA-Q40 and E-34.

```ts
export interface PartByCurrency {
  /** Null: that read failed. */
  lines: ReadonlyArray<{ currency: string | null; minor: number | null }> | null;
  /** The read reached its ceiling (SA-W63). */
  cutOff: boolean;
}

export function combineOurRevenue(input: { boosts: PartByCurrency; plans: PartByCurrency }): {
  totals: FinanceRevenueTotalLine[] | null;   // null when either read failed
  k5: FinanceTileMoney;
};
```

| Rule | Spec |
|---|---|
| Currencies | The union of both parts' line currencies, sorted, Unknown last |
| A part for one currency | Present with `minor !== null` gives that value. Present with `minor === null` is **not exact**. **Absent** gives an exact 0 only when that part's read succeeded and `!cutOff` (SA-W63); otherwise not exact. The `null` currency is never exact |
| Total | Both parts exact gives `boostMinor + planMinor` as an integer (`Number.isSafeInteger`, else not exact), divided by `CURRENCY_SCALE` once. Otherwise `null` |
| Either read failed | `totals: null`; K-5 `{ kind: 'unknown', reason: 'failed' }` (M2-FR-5) |
| K-5 | No currency at all (neither part has a counted row) gives `{ kind: 'none' }` ("No data yet"). More than one currency gives `{ kind: 'several', currencies }`. One currency with a total gives `{ kind: 'one', currency, net: total }` (SA-W60). One currency without a total gives `{ kind: 'unknown', reason: cutOff ? 'cut_off' : 'unreadable' }` |
| Wire line | `FinanceRevenueTotalLine { currency; boostsNet: number \| null; plansReceived: number \| null; total: number \| null }`. Every money key sits beside `currency` (the AC-92 walker) |

**Owner account, October 2026:** boost line USD 1000 (net) + plan line USD 7900 = 8900, giving `{ kind: 'one', currency: 'USD', net: 89 }` and "USD 89.00" (AC-122, AC-129).

**`boostRevenue.ts` change (SA-W59).** The result gains `netMinorByCurrency` (from the same `netOf` values, before `toMoney`), and `k5` is removed. The builder passes `{ lines: built.netMinorByCurrency, cutOff: !notes.exact }`, or `lines: null` when its status is `unknown`.

**Tests (`ourRevenue.test.ts`, T3):**
- **AC-122:** USD 1000 + USD 7900 → `one`, 89. Two currencies → `several`, 2. Either part failing → `unknown` / `failed`, `totals: null`.
- A plans-only currency with the boosts read exact → total = plans. With the boosts read cut off → that currency is Unknown (SA-W63).
- An unreadable plan line → Unknown. A boost net null → Unknown.
- Neither part has rows → `none`. A `null` currency is never exact. An overflow → Unknown.
- The five kinds moved from `boostRevenue.test.ts`.

### M2.5 Builder, wiring, types, route

**`financeHealth.ts`:**
- `finance` Pick (`:183-200`) gains `'listPlanPaymentsAllAccountsPaidInRange' | 'listPlanPaymentsForAccountPaidInRange'`.
- **R-d branch (SA-Q35):** element `:429` becomes `accountId !== null ? Promise.resolve(NOT_CALLED_REVENUE) : settle(() => deps.finance.countRevenueRows())`, with `NOT_CALLED_REVENUE = null` (the `NOT_NARROWED` shape, `:403`). The `failed('revenue_existence')` line runs only for a real failure.
- **One more settled read** in the same `Promise.all`: `settle(() => accountId !== null ? deps.finance.listPlanPaymentsForAccountPaidInRange(accountId, windowRange) : deps.finance.listPlanPaymentsAllAccountsPaidInRange(windowRange))`, logged with `failed('plan_payments', err)`.
- `buildPlanRevenue({ payments, scope, planLabelOf, isPlatformAccount: deps.isPlatformAccount, limits })`. `planLabelOf` is as SA-W65.
- **Names (scope `all` only, SA-W73):** ids from the shown by-business rows, excluding platform accounts, with one `findNames` call when there is at least one. `nameStatus` follows the takings mapping (`:662-673`).
- `combineOurRevenue({ boosts: …, plans: … })` gives `totals` and K-5 money.
- **`state` (E-36):**
  - all businesses: R-d unchanged (`:575-579`);
  - picked: `unknown` if the R-k′ or R-m′ read failed, else `recorded` if `builtPlans.countedPayments > 0 || builtBoosts.counts.counted > 0`, else `none_yet`.
- **Section status:** SA-W62.
- **K-5:** `money` from the combiner. The colour measurement is `null` when `money.reason === 'failed'` (`unavailable`, "Could not check"), else `{ metrics: {}, information: money.kind === 'none' ? K5_NO_DATA_YET : K5_REVENUE_HEADLINE }`. K-5 rules stay `[]`, never green.
- `counts.plans` holds counts and booleans only. `counts.revenueExistence: 'read' | 'failed' | 'not_called'` makes the AC-42 closure visible in the log.
- Header: an "OUR REVENUE, PLANS (slice 5a)" paragraph. ACCOUNT SCOPE (`:15-28`) changes: with a business picked, **no** platform-wide read is made, so "The platform-wide revenue head count is the one deliberate exception" becomes "is not called with a business picked (SA-Q35)".

**`financeHealthDeps.ts`:** two delegation lines in the `finance` block (`:113-139`), and the header bullet "and the paid plan invoices in the window (layer A, slice 5a)".

**`financeTypes.ts`:**

```ts
export interface FinancePlanLine {
  currency: string | null;
  payments: number; received: number; tax: number; businesses: number;
  zeroAmountInvoices: number; unreadable: number;
  /** False at the ceiling or with an unreadable row on this line: payments, received and tax are "At least". */
  exact: boolean;
}
export interface FinancePlanAccountRow {
  accountId: string; name: string | null; nameStatus: 'found' | 'missing' | 'unavailable' | 'platform';
  currency: string | null; payments: number; received: number; exact: boolean;
}
export interface FinancePlanPaymentListRow {
  id: string;                 // the billing event row id (internal UUID, never a Stripe id)
  paidAt: string;             // ISO timestamptz → formatUtc
  planLabel: string | null;   // null → "Unknown plan"
  received: number; tax: number; currency: string | null;
  periodStart: string | null; periodEnd: string | null;
}
export interface FinancePlanDeletedLine { currency: string | null; payments: number; received: number; exact: boolean }
export interface FinancePlanNotes { empty: boolean; exact: boolean; zeroAmountInvoices: number; unreadable: number; otherKind: number }
export interface FinancePlanRevenue {
  status: FinanceSectionStatus; scope: 'all' | 'one';
  lines: FinancePlanLine[] | null;
  accounts: FinancePlanAccountRow[] | null; accountsTotal: number | null;     // 'all' only
  payments: FinancePlanPaymentListRow[] | null; paymentsTotal: number | null; // 'one' only
  deletedAccounts: FinancePlanDeletedLine[] | null;                           // 'all' only
  notes: FinancePlanNotes | null;
}
export interface FinanceRevenueTotalLine { currency: string | null; boostsNet: number | null; plansReceived: number | null; total: number | null }
export interface FinanceRevenueSection {
  status: FinanceSectionStatus;
  state: FinanceRevenueState;
  plans: FinancePlanRevenue;                     // M2-FR-11 (replaces the R-d string, SA-W61)
  boosts: FinanceBoostRevenue;
  /** Boost net + plans received per currency (SA-Q40); null when either read failed. Never across currencies. */
  totals: FinanceRevenueTotalLine[] | null;
}
```

**Route.** Only the info line (`:178-210`) and the header change: `sections.revenuePlans: payload.revenue.plans.status`, plus `counts.plans` and `counts.revenueExistence`. Zod (`.strict()`, `:91-96`), the gate, the 404 / 500 paths and `no-store` are untouched, and there is **no new query parameter**.

### M2.6 With a business picked (SA-Q35, E-36)

| Read | All businesses | One business picked |
|---|---|---|
| Plan payments | **R-m** | **R-m′(accountId, window)**: `.eq('user_id')` on every page; the UUID is refused before the query |
| Boost purchases | R-k | R-k′ (4a) |
| Revenue existence (R-d) | `countRevenueRows()` → `state` | **Not called**. AC-42's exception closes |
| Names for plans | Shown by-business rows | None |

With `accountId` set: R-m has zero calls, R-d has zero calls, the by-business table and deleted line are `null`, the payment list shows, and K-5 and "Paid us, total" are that business's own.

**Required tests (SA-WR-3 shape):**
- T5 (`financeHealth.test.ts`) and T7 (`route.test.ts`) put spies on R-m, R-m′, R-k, R-k′ and `countRevenueRows`. With `accountId`, R-m′ receives exactly the id and the window range, while R-m and `countRevenueRows` have **zero** calls. This rewrites `financeHealth.test.ts:633-660`, `:761-846` (`:802`) and `route.test.ts:479`, `:901`.
- E-36: a picked account with one counted plan payment and no boost gives `recorded`; with neither, `none_yet`; with R-m′ failing, `unknown`; with R-k′ failing, `unknown`.

### M2.7 Failure matrix

Never a 500 for a failed read (SA-Q8). Never a lower bound plus or minus a figure.

| What happens | Section status | Plans part | Boosts part | K-5 | "Paid us, total" |
|---|---|---|---|---|---|
| Nothing wrong | `ok` | lines / list | lines | value, several or none | per currency |
| R-m / R-m′ failed | `partial` | "Could not load" | lines | "Unknown", Could not check | "Unknown" |
| R-k / R-k′ failed | `partial` | lines | "Could not load" | "Unknown", Could not check | "Unknown" |
| Both failed | `unknown` (frame "Could not load this section" + Retry) | — | — | "Unknown" | "Unknown" |
| R-d failed (all businesses only) | unchanged (SA-W62) | unchanged | unchanged | unchanged | unchanged; `state: 'unknown'` |
| Plans at the ceiling (AC-125) | `partial` + notice | "At least" on payments, received, tax | — | "Unknown" (that currency) | "Unknown" |
| Unreadable plan row | `partial` + count | "At least" on that line, "excludes N unreadable" | — | "Unknown" if that currency | "Unknown" for that currency |
| Other-kind row (impossible by the query) | `partial` + count | left out | — | unchanged | unchanged |
| Zero-amount invoices only | `ok` | "No plan payments received in this window" + the note | — | unchanged | unchanged |
| No counted payment and no boost | `ok` | the empty sentence, no "0.00" | the empty sentence | "No data yet" | "None in this window" |

### M2.8 The page

**`RevenuePanel.tsx`:**
- The frame is unchanged (`id="revenue"`, `data-testid="section-revenue"`).
- Subtitle: `REVENUE_SUBTITLE_ALL = (w) => \`Plan payments and credit boosts received, all businesses · ${w}\``, or the "this business" form.
- `PLANS_TEXT` (`:80-84`) and the plans line (`:110-112`) go.
- Body order: **"Plans"** sub-heading with `<PlanRevenuePart plans={revenue.plans} />`; then **"Credit boosts"** sub-heading with `BoostsPart` (unchanged); then the "cannot produce" list.
- The two parts are never one figure in the section (M2-FR-1). The totals appear only in K-5 and the summary.

**`PlanRevenuePart.tsx`** (client; `import type` only from `lib/business-os/finance/`):
- **States.**
  - `status === 'unknown'` → `REVENUE_PLANS_FAILED = 'Could not load'`.
  - `notes.empty` → `AdminEmpty` "No plan payments received in this window", with no currency line and no `0.00` (M2-FR-8).
  - Notices (`AdminNotice`) for the ceiling, unreadable and other-kind counts.
  - The always-shown note `REVENUE_PLANS_REFUNDS_NOTE = 'Plan refunds and disputes are not recorded yet'` (M2-W-6).
  - `REVENUE_PLANS_ZERO_NOTE(n) = 'N paid invoices had nothing to charge'` when `notes.zeroAmountInvoices > 0`.
- **Lines table**, `aria-label="Plan payments per currency"`, built from `ADMIN_TABLE*`. Columns: Currency, Payments, Received, Of which tax, Businesses that paid. Money is printed through `formatMoney`, wrapped in `atLeast(…, line.exact)`. The Received header is "Received (Stripe fees not deducted; includes any tax; before any refund)" (M2-W-3).
- **All businesses:** the "By business" table (Business, Currency, Payments, Received). Names follow the `nameOf` pattern. After the cap: "N more businesses not listed". Then the "Deleted accounts: N payments, received USD x" line per currency, or "No plan payments from deleted accounts". Never a name.
- **One business:** the payment list, newest first, with columns Paid at, Plan, Received, Of which tax, Period.
  - **Every timestamp goes through the shared `formatUtc`** (`adminFormat.ts:21-27`): `paidAt`, `periodStart`, `periodEnd` (S5-F1, E-33). Never `formatUtcDate`.
  - A NULL period shows `REVENUE_PLANS_PERIOD_NOT_RECORDED`, never '—' (SA-W64).
  - Plan is `planLabel ?? 'Unknown plan'`.
- **BD-14 / BD-20:** no test-mode wording.

**`AccountSummary.tsx` (M-2 fill):**
- "Paid us: plan" shows `revenue.plans.lines` per currency with `atLeast(formatMoney(received, currency), exact)`.
  - Failed → "Unknown".
  - Empty → "None in this window".
- "Paid us, total" shows `revenue.totals` per currency: `formatMoney(total, currency)`, or "Unknown" when `total === null`.
  - `totals === null` → "Unknown".
  - No lines → "None in this window".

  It reads the same `totals` as K-5, so the tile and the summary cannot differ (SA-Q40).
- Still no margin (M-3).

**`financeCopy.ts` (M-2):**
- `TILE_LABELS.k5Sub = 'Credit boosts and plans'`.
- `REVENUE_CANNOT` = `['MRR and active subscriptions (a later update)', 'Plan refunds and disputes (not recorded yet)', 'Real Stripe fees (none are recorded for our payments yet)', 'One total across currencies']` (M2-FR-13). The 4a item "The date of a refund or dispute" is kept.
- The new `REVENUE_PLANS_*` set replaces the seven deleted constants.
- No mode wording (the 1c rule `finance.source.guard.test.ts:576-613`).

**`FinanceKpiStrip.tsx`:** **not edited** (SA-W60). The caption changes through `k5Caption` and the copy. Its value still comes from `formatMoney(money.net, money.currency)`.

---

## Entitlements registration check

I followed the `business-os-entitlements` skill row by row.

| Tripwire | 5a |
|---|---|
| A file outside the module **newly** imports from it | **No.** `planRevenue.ts` and `ourRevenue.ts` import nothing from it. The tier label arrives as a callback built in `financeHealth.ts` from `tierLabelForGroup` (a finance file, `planGroups.ts:250`) and `deps.config.tierOrder`. The config is passed in, and `financeHealth.ts` imports no entitlements path. M-1 page files import types only from `lib/business-os/finance/`. The finance guard's "only `planGroups.ts` and the wiring import the module" (`:174-177`) proves it |
| A listed file's symbol set changes | **No.** `planGroups.ts` and `financeHealthDeps.ts` are not edited for imports (`enforcementPoints.test.ts:515-535`) |
| A tier name as a literal | **None.** The stored `tier` is passed through. Test fixtures use `getEntitlementConfig().tierOrder[0]` (SA-Q37). `tierLiteral.forbidden.test.ts` and the finance tier rule (`:153-158`) run |
| A capability id literal; a catalog or matrix change | None |
| A gate | None: display only, it refuses nothing |

`npm run test:bos-entitlements` runs before handover (V-4). It covers `lib/repositories/__tests__` (M-2) **and** `app/admin/users/__tests__` (M-1), `package.json:23`.

---

## Tenant isolation check

I followed the `tenant-isolation-guard` skill.

- **Service role, caller-supplied id:**
  - The only caller-supplied id is `accountId`. The route validates it as a UUID behind `requireAdmin`, refuses a platform id (`route.ts:147-150`), and the builder checks it against the plan table **before** any read (`financeHealth.ts:353-363`).
  - R-m′ refuses a malformed id before any query and filters `.eq('user_id', accountId)` on every page.
- **No write**, no trigger, no upsert and no payload, so the write half of the skill does not apply. The no-write pin is unedited.
- **Picked business:** R-m′ receives exactly that id. R-m and R-d are **not called**, so the picked view makes no platform-wide read (AC-42's exception closes, E-36).
- **Deleted accounts:** rows with NULL `user_id` are read only by R-m (all accounts), shown as an unnamed line, and never reachable with a business picked (`.eq('user_id', id)` cannot match NULL).
- **No Stripe or customer data:** the column list carries no Stripe id, refusal reason, `plan_written` or `livemode` (M2-FR-10, AC-127).
- **Businesses deep link (M-1):**
  - The `account` value only selects among rows **already returned** to this admin by the admin-gated list route. It reads nothing and opens nothing that is not on screen.
  - The CSS selector is built from the list row's id, never from the URL text.
- **Names:** looked up only for ids taken from rows already read (by-business rows), never for a platform account or NULL.

---

## Guard table, line by line

| Guard | 5a trips it? | Exact change | Part |
|---|---|---|---|
| `businessPicker.contract.test.ts` (`PICKERS :40`, `:92`, `:153`, `:202`) | **Yes** (the file is deleted) | [M1.2](#m12-the-four-guard-edits): shared picker only, plus a deletion pin | M-1 |
| `layoutFolder.guard.test.ts` G-6 (`:518-522`) | Comment only | [M1.2](#m12-the-four-guard-edits) | M-1 |
| `contrast.lf1.source.guard.test.ts` (`:9-11`, `:50`, `:64`, `:112`) | **Yes** (the exclusion names a gone file) | Remove `EXCLUDED`; keep `:112`; Finance not added (SA-W69) | M-1 |
| `business-os-llm/__tests__/source.guard.test.ts` G-1 (`:536-549`) | No | **Run unchanged** | M-1 |
| `app/admin/finance/__tests__/source.guard.test.ts` | No, by construction | New page files import only types from `lib/business-os/finance/`, no repository, no `server-only`, no `console.` | M-1, M-2 |
| `financeFilterBar.layout.render.test.tsx` | **Yes** (mocks the original; help-line pin) | Mock the shared picker; the help-line pin is rewritten (SA-W70); the five-item row, top alignment and heights are unchanged | M-1 |
| Businesses suites (`app/admin/users/__tests__`), including U-3 (`businessesLayout.render.test.tsx:222-261`), U-7 one mount read (`:381-390`), drawer pins (`businessDrawer.layout.render.test.tsx:370`, `:663`), the Businesses contrast walk | **No**: `account` is page-only (never written); the link sits outside the strip and the boxes; `text-blue-300` | New `businessesDeepLink.render.test.tsx`; `businessOsPanel.render.test.tsx` link cases | M-1 |
| `app/admin/users/__tests__/source.guard.test.ts` | No: the `history.` / `useSearchParams` ban applies to the delete dialog only (`:345-349`) | Run | M-1 |
| C-14 migrated-pages registry | No: Finance is still not registered (DF-4); Businesses' registration is unchanged | Run (in V-3) | M-1 |
| **`finance.source.guard.test.ts` table pin** (`REPOSITORY_TABLES :280-289`, `:291-300`) | **No** (verified): `business_os_billing_events` is already one of the eight (R-d) | **Run unchanged.** The comment above `REPOSITORY_TABLES` gains "R-m and R-m′ read the billing events too" | M-2 |
| Same file: repo-wide `livemode` (`:361-365`), `MODE_WORDING` (`:610-612`), tier literal (`:153-158`), entitlements importers (`:174-177`), the four builders' guards, processor literal (`:403-405`), status literal (`:489-492`), due dates (`:519-521`), client columns, exchange rate (`:372-374`), `currencyGroups` export pin (`:377-382`), `MONEY_ARITHMETIC` (`:418-420`), `AMOUNT_ARITHMETIC` (`:562-567`), the 4a scale rules on `boostRevenue.ts` (`:654-664`), its export pin (`:745-751`), SA-WR-34 (`:775-782`) | **No** | Run unchanged. `boostRevenue.ts` keeps one `/ CURRENCY_SCALE` and the same four export names (SA-W59). The strip is unedited (SA-W60) | M-2 |
| Same file: SA-WR-35 (`:707-712`) | **Yes**, if SA-W58 (a) | Allowed users become exactly `[PANEL, 'app/admin/finance/components/AccountSummary.tsx']`, with a planted third user as the control | M-1 |
| **Same file: new `slice 5a` describe** | Added | See the list after this table | M-1, M-2 |
| `BusinessOsFinanceReadRepository.test.ts` | Extended | New describes ([M2.1](#m21-the-reads-r-m-and-r-m)). **Unedited:** limits equality (`:124-139`), R-d describe (`:288-322`), no-write, no aggregate, writer names, one caller (`:512-567`) | M-2 |
| **`BusinessOsBillingEventRepository.test.ts` exact caller list** (`:464-502`, name based) | **No** (SA-RR-5a, verified): no new file names `BusinessOsBillingEventRepository` / `businessOsBillingEventRepository`, comments and tests included. The finance repository names it in words only, and the finance repository test builds the name from parts (`:533-539`) | **Run unchanged** and paste. Any trip goes to SA, never a list edit | M-2 |
| **`firstPaymentStamp.guard.test.ts`** (`lib/business-os/billing/__tests__`) | **No**: nothing names `first_paid_at`, `first_payment_ref`, the lineage table, `business_os_apply_plan_payment` or `applyPaidPlanInvoice`; `PAYING_SUBSCRIPTION_STATUSES` is not used (SA-Q41) | **Run unchanged** and paste | M-2 |
| **Webhook placement:** `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts`, `lib/payments/__tests__/planSurfaces.guard.test.ts` | **No**: both builders are under `lib/business-os/finance/`, never `lib/business-os/billing/` (M2-FR-12); `refundMath` is already imported by finance (`boostRevenue.ts:46`) | **Run all three unchanged** and paste | M-2 |
| `tierLiteral.forbidden.test.ts`, `enforcementPoints.test.ts` | **No** | `test:bos-entitlements` proves it (V-4) | M-2 |
| `businessOwnedTables.test.ts`, `descriptors.invariant.test.ts`, RC-15 (`pagePlans` / `findEntitlementInputs` only), ledger and lot caller lists, G3 | **No**: no new table; no ledger, lot or plan-repository change | Run unchanged (V-4, V-6) | M-1, M-2 |
| 4a revenue and K-5 tests (AC-95, AC-96; S4-FR-4 plans line; SA-WR-32) | **Yes**, by design | Rewritten to AC-117 onward (SA-W61). The R-d repository describe is unedited, and the all-businesses `state` from a test-mode invoice is pinned | M-2 |
| Admin authz surface guard | **No**: no new route or page | `test:authz-guard` (V-5) | M-1, M-2 |

**The new `slice 5a` describe in `finance.source.guard.test.ts`.** Every rule has a planted negative control.

- **(a) Non-vacuity.** `FILES` contains the eight new product files. The R-m and R-m′ bodies are found in the repository, with `from('business_os_billing_events')`, `paidInvoiceFilter(range)` and no `livemode`. `paidInvoiceFilter` holds `.eq('kind', 'invoice_paid')`.
- **(b) Scale, `planRevenue.ts` and `ourRevenue.ts`:**
  - no `toHundredths` and no `toUnits(`;
  - no `* 100`, `*100` or `CURRENCY_SCALE *`;
  - `planRevenue.ts` holds `minorUnitsPerMajor(code) !== 100`;
  - each file holds exactly one `/ CURRENCY_SCALE`.
- **(c) Pure:** both files import no repository, no Supabase, no entitlements path and no `server-only`, name no table, and read no clock (`new Date(` or `Date.now(`).
- **(d) Columns and builders:** no `stripe_`, `refusal_reason`, `plan_written` or `livemode` in `FINANCE_PLAN_PAYMENT_COLUMNS`, the builders, `PlanRevenuePart.tsx` or the copy.
- **(e) Exports pinned exactly:**
  - `planRevenue.ts`: `PLAN_PAYMENT_KIND`, `PlanPaymentInput`, `PlanRevenueResult`, `buildPlanRevenue`;
  - `ourRevenue.ts`: `PartByCurrency`, `combineOurRevenue`.
  No export totals two currencies, and no `exchange_rates`, `fx` or `rate`.
- **(f) Kind literal:** `'invoice_paid'` appears only in the repository and `planRevenue.ts` (a positive pin).
- **(g) Page arithmetic:** the SA-WR-18 rule is extended to `received|tax|total|boostsNet|plansReceived|payments`, so no page file adds or subtracts two of them. `AccountSummary.tsx` and `AccountHeader.tsx` contain no `.reduce(`.
- **(h) Timestamps:** `PlanRevenuePart.tsx` imports `formatUtc` and never names `formatUtcDate` (S5-F1).
- **(i) No dim text:** the new page files contain no `text-slate-500` or `text-slate-600` (SA-W69).
- **(j) The picked name never reaches the URL or a request (AC-109):** in `FinanceView.tsx`, `pickedName` never appears inside a `serialiseFinanceUrl(`, `router.replace(` or `fetch(` call. `useFinanceData.ts` takes only the query string.

**No new CI job and no added critical-path time:** every new test runs in the existing Jest gate. The repository and Businesses tests also run in `test:bos-entitlements` (`feedback-no-added-ci-time`).

---

## AC mapping

T-numbers:

| T | Test file |
|---|---|
| T1 | `BusinessOsFinanceReadRepository.test.ts` |
| T2 | `planRevenue.test.ts` (new) |
| T3 | `ourRevenue.test.ts` (new) |
| T4 | `boostRevenue.test.ts` |
| T5 | `financeHealth.test.ts` |
| T6 | `finance.source.guard.test.ts` |
| T7 | finance `route.test.ts` |
| T8 | `financePage.render.test.tsx` |
| T9 | `financeFilterBar.layout.render.test.tsx` |
| T10 | `financeLinks.test.ts` (new) |
| T11 | `financeAccount.test.ts` (new) |
| T12 | `financeAccount.render.test.tsx` (new) |
| T13 | `businessesDeepLink.render.test.tsx` (new) and `businessOsPanel.render.test.tsx` |
| T14 | The four picker guards |
| QA | A recorded manual step |

| AC | Part | Test / check |
|---|---|---|
| **AC-108** | M-1 | T9 and T8 render `AdminBusinessPicker` (mocked by path). T14 holds the deletion pin and the contract on the shared picker only. V-10 `grep -rn BusinessAccountPicker app lib components hooks` → test files only. V-3 runs every §11D.7 M-1 row |
| **AC-109** | M-1 | T11: order (a) → (b) Section 4 → Section 3 → takings / overdue → (c). T8: after a pick the chip reads "Business: {picked name}". On a reload with a payload credit row it reads that name; with no row, the short id. T6 (j): the name never reaches the URL or a request. No logger call in M-1 (T6, `console` / logger rule) |
| **AC-110** | M-1 (M-2 completes) | T12: the header shows name, group (and the FP chip) and Paying / Not paying / Unknown for each group kind (E-35). The summary shows charged AI cost, boost net per currency, the plan line (the placeholder at the M-1 checkpoint, the M-2 line after), credits and group. Each equals the same node's text in its section on one render. `unknown` gives "Unknown"; `partial` gives "At least"; the refund note shows with `refundOrDispute` (S5-F7) |
| **AC-111** | M-1 | M-1 checkpoint ([M1.8](#m18-m-1-checkpoint)): `git diff --name-only` shows no `lib/` or `app/api/` path; `git diff --exit-code -- app/api lib` exits 0; the route test is unchanged and green, so the same query and the same reads |
| **AC-112** | M-1 | T6 (g): no arithmetic or `.reduce(` in the summary or header. T12: two boost currencies (mocked) give two lines and no total |
| **AC-113** | M-1 | T10: every href carries `account=<id>` and the window, parsed back through the target's own spec to the same dates (SA-W56). T12: the links render with those hrefs. T8: the Section 3 link carries both |
| **AC-114** | M-1 | T13 (`businessOsPanel.render.test.tsx`): `bos-panel-money-view` href is exactly `/admin/finance?accountId=<id>&preset=this_month`, contains no name or email, and is absent for a login with no Business OS account |
| **AC-115** | M-1 | T13 (`businessesDeepLink.render.test.tsx`), arriving with `?status=all&account=<id>`: <ul><li>row on screen → the drawer opens; on close, focus is on that row's Open button;</li><li>`replaceState` was called with a URL without `account`;</li><li>not on screen → the notice shows and nothing opens;</li><li>malformed → ignored and removed;</li><li>one list request only;</li><li>status and search behave as before (the U-3 / U-7 suites still pass)</li></ul> |
| **AC-116** | M-1 | T8: with no business picked, no `account-header` or `account-summary`, and each section's test id and text are as before (the existing all-businesses cases run unedited apart from the picker mock). QA: L-59 to L-63 |
| **AC-117** | M-2 | T2 against the independent `checkSeventeen`. QA: check 17 against the page (V-12) |
| **AC-118** | M-2 | T1: `eq('kind','invoice_paid')`, `gte` / `lt` `paid_at` ISO strings, and a month-boundary range. T2: rows given once count once. T6: the builder reads no clock; the window is the query's |
| **AC-119** | M-2 | T1: `kind` filter on the query. T2: a planted `mismatch_refused` row with an amount is excluded and counted as other kind. QA: check 17 excludes the eight refused rows |
| **AC-120** | M-2 | T2: 7900 → 79.00, `usd` and `USD` on one line, and each SA-W64 unreadable case. T6 (b): no `toHundredths`, `toUnits` or × 100. T8: "USD 79.00" |
| **AC-121** | M-2 | T2: zero-amount is not a payment; the note; received unchanged. T8: the note renders |
| **AC-122** | M-2 | T3: USD 1000 + 7900 → `one` 89; several; failed. T5: the owner fixture, picked, gives K-5 `money { one, USD, 89 }`, caption via `k5Caption`, grey. T7: payload walker (`revenue.plans`, `revenue.totals`, `tiles.k5.money`: every money key beside `currency`, none top level). T8: "USD 89.00", "2 currencies, see Our revenue", "Unknown". T6 (e): no export totals two currencies |
| **AC-123** | M-2 | T5 and T7: R-m′ receives exactly the id; R-m has zero calls; `countRevenueRows` has **zero** calls; the list is newest first. T8: no "all businesses" plans prefix (the constants are deleted, V-10) |
| **AC-124** | M-2 | T2: by-business equals check 18's plan column; deleted line from NULL `user_id`. T5: `findNames` called only with ids from the shown rows. T8: deleted line in words, never a name. QA: check 18 |
| **AC-125** | M-2 | T1: injected small ceiling gives `reachedCeiling`. T2: `exact: false`. T3: K-5 `unknown` / `cut_off`. T5: section `partial`. T8: "At least", the notice, K-5 "Unknown" |
| **AC-126** | M-2 | T2: empty. T5: R-m failing gives plans `unknown`, section `partial`, every other section present, 200 (T7 too). Both failing gives `unknown`. T8: "No plan payments received in this window" with no `0.00`; "Could not load" on the plans part only |
| **AC-127** | M-2 | T1: column list. T7: the payload has no `stripe_`, `refusal_reason`, `plan_written` or `livemode` key; the info line carries `sections.revenuePlans`, `counts.plans` and `counts.revenueExistence` as counts, booleans and state words only (a planted amount, currency and tier appear in no log call). T6: repo-wide `livemode` and mode wording. T2: a test-mode row and a live row are indistinguishable (no mode field) and count together |
| **AC-128** | M-2 | T7: 401, 403 (including a `profiles.role`-only admin), and every 400 case including an unknown key, with zero calls on R-m and R-m′ (they are in `mockDeps.finance`, so `allReads()` covers them). T6: write-verb pins over the new files. V-10: no `supabase/migrations` path. V-4 to V-6: every §11D.7 M-2 row, including the four billing guards, run unchanged. V-9: scoped `tsc` with a canary |
| **AC-129** | M-2 | QA L-64 to L-72, and V-12 (checks 17 and 18). Every list timestamp goes through `formatUtc` (T6 (h), T8) |

---

## Verification plan

The worktree has the `node_modules` junction. Never run `git worktree remove`, `git stash` or `npm install` through it. Before SA code review, I run the following and paste the command, its own exit code and the counts. Exit codes are read from the tool, never from a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | **Finance suites:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Suites and tests passed |
| V-2 | **Businesses list and `app/admin/users`:** `npx jest app/admin/users app/api/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users lib/business-os/credits` | Pass; exit 0. Only `app/admin/users/{usersFilters.ts,page.tsx,components/BusinessOsPanel.tsx}` and its tests change |
| V-3 | **Layout and picker guards:** `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm/__tests__/source.guard.test.ts app/admin/business-os-llm app/admin/analytics --ci` | Pass, with the contract, layout folder (G-6), contrast and G-1 named in the output |
| V-4 | `npm run test:bos-entitlements` | Exit 0 |
| V-5 | `npm run test:authz-guard` | Exit 0 |
| V-6 | **Billing guards, unchanged (M-2):** `npx jest lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts lib/payments/__tests__/refundMath.test.ts lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts lib/business-os/billing lib/business-os/purge/__tests__/descriptors.invariant.test.ts lib/business-os/__tests__/businessOwnedTables.test.ts --ci`, then `git diff --exit-code -- lib/business-os/billing app/api/stripe lib/payments lib/repositories/BusinessOsBillingEventRepository.ts lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts` | Pass; exit 0 |
| V-7 | `npm run lint:hooks` | Exit 0 |
| V-8 | `npx eslint <every touched and new file>` | Clean |
| V-9 | **Scoped `tsc` with a canary (AC-44, AC-128)**, procedure below | The canary reports TS2322, then the clean run |
| V-10 | `git diff --stat`, read **before** the diff (the truncation lesson):<ul><li>exactly one deletion-only file (the original picker), with no other file losing lines without gaining any;</li><li>no `supabase/migrations` path;</li><li>no requirement MD from Dev.</li></ul>`grep -rn "BusinessAccountPicker" app lib components hooks` → only the three guard tests. `grep -rn "REVENUE_PLANS_ALL\|REVENUE_PLANS_RECORDED\|REVENUE_PLANS_NONE\|REVENUE_PLANS_UNKNOWN\|K5_NET_HEADLINE\|PLANS_TEXT" app lib` → nothing | Output pasted |
| V-11 | `npm run schema:check` if the worktree has credentials. Otherwise the note: every R-m column is in migration `20261027` (`:5-24`) and in §11D.1's live column list | Output or the note |
| V-12 | **Read-only SQL checks 17 and 18, for the user / QA** (§13) | Table below |
| V-13 | **The M-1 checkpoint** ([M1.8](#m18-m-1-checkpoint)), pasted at the end of M-1 | AC-111 |

**V-9 procedure (SA-WR-7).**
1. Write a tsconfig **outside the worktree**, in the session scratchpad (`C:\Users\Barak\AppData\Local\Temp\claude\…\scratchpad\tsconfig.5a.json`), with:
   - an absolute `extends` to the worktree's `tsconfig.json`;
   - `compilerOptions: { noEmit: true, incremental: false }`;
   - `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts`, and every touched and new `.ts` / `.tsx` file, tests included, as absolute paths.
2. Plant `const __canary: number = 'x';` in `lib/business-os/finance/planRevenue.ts`.
3. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>` and record its own exit code. It **must** report TS2322 at the canary, or the run is not evidence.
4. Remove the canary (`grep -c __canary` must be 0) and re-run.
5. Record every diagnostic: zero in touched files, and any pre-existing one attributed by path. The scratch config is never written into the worktree.

The same is run once at the M-1 checkpoint, with the canary in `app/admin/finance/financeAccount.ts`.

**V-12, the read-only SQL checks, for the user.** Run checks 17 and 18 **in October 2026** in the Supabase SQL editor. Both use `date_trunc('month', now(), 'UTC')`. Run in November, they show November, so replace the two bounds with `'2026-10-01'` and `'2026-11-01'` literals. Compare with Finance on "This month" in October (or Custom 2026-10-01 to the last day), first with **All businesses**, then with the owner account picked. Amounts are minor units: divide by 100.

| Check | Column | Expected (live facts, §11D.1) | Page figure |
|---|---|---|---|
| 17 | `currency` | `USD` | The plans line |
| 17 | `payments` / `zero_amount_invoices` / `businesses_paid` | 1 / 0 / 1 | Payments / the zero note (absent) / Businesses that paid |
| 17 | `received_minor` / `tax_minor` | 7900 / 0 | Received USD 79.00 / Of which tax USD 0.00 |
| 17 | `deleted_account_payments` / `deleted_account_received_minor` | 0 / 0 | "No plan payments from deleted accounts" |
| 17 | (the 8 `mismatch_refused` rows) | not counted | not shown (DF-7) |
| 18 | owner account (`5f63adbd…`), `USD` | `plan_received_minor` 7900, `boost_net_minor` 1000, `total_minor` 8900 | By-business row USD 79.00. Picked: "Paid us: plan" USD 79.00, "Paid us: credit boosts" USD 10.00, "Paid us, total" and **K-5 "USD 89.00"** |
| 18 | sum over accounts, `USD` | 8900 (if no other account paid in October) | All businesses: K-5 "USD 89.00" |

**Manual QA steps.** These continue from 4a's L-58: run `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin. QA's list governs if QA renumbers it (4a retrospective conclusion 5).

| # | Step | Expected |
|---|---|---|
| L-59 | `/admin/finance`, This month, All businesses | No header and no summary; every section as before 5a, except "Our revenue" now has Plans and Credit boosts sub-headings (M-2) |
| L-60 | Pick the owner test account in the picker | The chip reads "Business: {name}". The header shows the name, the plan group "Essentials" (the `basic` tier's label) with the Founding Partner chip if its period is current, "Paying", and "Every section below is for this business only." |
| L-61 | Read the summary | Charged AI cost equals Section 3's total. Boosts USD 10.00. Plan USD 79.00. **Total USD 89.00**. Credits equal Section 4's row. The group matches the header. No margin line. No test-mode wording |
| L-62 | Reload the page | The chip and header show the name from the payload (Section 4 row), or the short id if none |
| L-63 | Click each summary link | Activity, and then Costs & credits, open on this account with the same window. AI cost & usage opens with the account and the same dates (SA-W56). Businesses opens with this business's drawer open, and `account` is gone from the address bar |
| L-64 | In that drawer, click "Open money view" | Finance opens on This month with this account picked |
| L-65 | Open `/admin/users?status=all&account=<a UUID not on the list>`, then `?account=nonsense` | The notice "This business is not in the current list" and no drawer; then nothing, with the key removed |
| L-66 | K-5 with the owner picked | "USD 89.00", caption "Credit boosts and plans · {window} UTC", grey, not green |
| L-67 | Our revenue → Plans with the owner picked | The payment list: one row, paid at `2026-10-12 18:21 UTC`, plan "Essentials", USD 79.00, tax USD 0.00, period `2026-10-12 … UTC` to `2026-11-12 … UTC`. No '—' and no "all businesses" prefix |
| L-68 | All businesses, Plans | USD: 1 payment, USD 79.00 received, tax USD 0.00, 1 business. By business: the owner, USD 79.00. Deleted accounts: none. The refused rows are not counted. Notes: "Plan refunds and disputes are not recorded yet" |
| L-69 | A custom range ending before 2026-10-12 | "No plan payments received in this window", no `0.00`; K-5 "No data yet" |
| L-70 | Run checks 17 and 18 (V-12) | Every row matches |
| L-71 | As a non-admin, then signed out, call `/api/admin/business-os/finance` | 403 / 401, `no-store`, no figures |
| L-72 | Read the dev-server log | One "Admin read the Business OS finance page" line with `sections.revenuePlans`, `counts.plans` and `counts.revenueExistence: 'not_called'` (picked) or `'read'` (all), and `durationMs`. No amount, currency total, tier or name. **Record `durationMs`** (M2-FR-14: p95 under 2 s) |

---

## Logging

- **New lines:**
  - R-m: `info { method, rows, reachedCeiling, durationMs }`.
  - R-m′: `debug { method, rows, reachedCeiling }`.
  - Guard refusals: `warn` (the existing `fail`).
  - Builder read failure: `error { read: 'plan_payments', err }` through the existing `failed`, and `plan_names` for the names call.
- **The route's accountability line** gains `sections.revenuePlans`, `counts.plans` and `counts.revenueExistence`: counts, booleans and state words only (M2-FR-11, SEC-8).
- **M-1 adds no log line.** The Businesses page logs nothing about the deep link: no id and no name.
- **Never logged:**
  - an amount, a received figure, a currency total, a tier or a plan label;
  - a business name;
  - an account id at info (the route's validated `accountId` filter is the existing exception).
- Errors go as `{ err }`. No `console.*` (T6 and the page guard pin it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Cents shown ×100 (USD 79.00 shown as USD 7,900.00) | The `minorUnitsPerMajor` gate; no `toUnits`, `toHundredths` or × 100 (T6 (b) with controls); wire tests 7900 → 79.00 and 1999 → 19.99 |
| R-2 | A cross-currency total in K-5, the summary or the payload | The combiner only adds within one currency; the payload walker; the export pins; render checks; SA-W66 ordering |
| R-3 | K-5 shows a figure from an inexact part | The single E-34 rule in `ourRevenue.ts`, with SA-W63 for absent parts at a ceiling; tested on failure, ceiling, unreadable, overflow and a null currency |
| R-4 | The deep link opens the wrong drawer, opens one not on screen, or leaves the key in the URL | Page-only field (never written; removed by the hook's mount write); consumption only after a successful read; row id taken from `shownUsers`; the selector built from the row id; T13 asserts `replaceState` and focus return |
| R-5 | The picker swap shifts the LF-6 alignment | Same input height (`py-1.5 text-sm`); the help line moves under the row; T9 pins the row, the heights and `aria-describedby`. Report to TL at the end of day 1 if not green (SA-RR-5a) |
| R-6 | A guard trips that §11D.7 does not list (as the 4a retro feared) | Every guard naming the picker, the billing-event table or repository, `lib/payments`, or the finance or Businesses files was opened and is in the guard table. V-3 to V-6 run them all |
| R-7 | The 4a tests silently keep old meanings | Listed and rewritten explicitly (SA-W61); V-10 greps out the deleted constants |
| R-8 | Route latency: one more read with no `paid_at` index, and one more names call | 9 rows today; a sequential scan of a tiny table; the names call only with rows (SA-W73); `durationMs` recorded at L-72. An index is a later migration if the table grows, not 5a |
| R-9 | A business beyond row 100 of All (or filtered out) gets the notice instead of its drawer | The notice says so; `status=all` (SA-W67); the newest-first cap is a known F-27 item |
| R-10 | M-1 and M-2 in one PR blur AC-111 | The M-1 checkpoint (SA-W55, V-13) |
| R-11 | Another agent's requirement edits appear in the diff (the worktree already holds BA's uncommitted requirement edits) | Dev never edits the requirement; V-10 reads the stat first; RM decides what joins the PR |
| R-12 | The junction | Never `git worktree remove`, `git stash` or `npm install`; stop and report instead |
| R-13 | The Jest "worker failed to exit gracefully" warning | Pre-existing (FU-4a-3). If it shows, cite FU-4a-3 and do not re-investigate |

---

## Estimate

About **4.5 days**: M-1 about 2 days and M-2 about 2.5 days, as SA-RR-5a accepted.

| Day | Work | Part |
|---|---|---|
| 0.5 | Picker swap, the deletion, the four guard edits, the two test mocks, the help line, the chip. V-3 green. **End-of-day-1 report to TL if not green** | M-1 |
| 1.0 | `financeAccount.ts` and `financeLinks.ts` with T10 and T11 (target-spec parse-back) | M-1 |
| 1.5 | `AccountHeader.tsx`, `AccountSummary.tsx`, `FinanceView.tsx`, `AiCostSection.tsx` link, copy; T8 and T12 | M-1 |
| 2.0 | Businesses: page-only key, consume effect, notice, "Open money view"; T13. **M-1 checkpoint** (V-13) | M-1 |
| 2.5 | R-m, R-m′, columns, row type, filter, header, barrel; T1 | M-2 |
| 3.0 | `planRevenue.ts` with T2 (including `checkSeventeen`) | M-2 |
| 3.5 | `ourRevenue.ts`, the `boostRevenue.ts` change; T3 and T4 | M-2 |
| 4.0 | Types, builder (R-d branch, plans, names, totals, K-5, `state`, status, counts), wiring, route; T5 and T7 (rewritten 4a cases) | M-2 |
| 4.5 | `PlanRevenuePart.tsx`, panel, summary fill, copy; T8; the 5a guard describe (T6); V-1 to V-11 and the canary; results pasted | M-2 |

---

## Task List

- ✅ 0. SA workplan review; apply the rulings on SA-W55 to SA-W73
- ✅ 1. Branch `feature/bos-money-m1-m2` confirmed (`git branch --show-current`); junction present; nothing committed
- **M-1**
  - ✅ 2. `FinanceFilterBar.tsx`: shared picker, `onPick`, `FinanceActiveChip`, help line with `describedBy`
  - ✅ 3. Delete `app/admin/audit-trail/BusinessAccountPicker.tsx`; the four guard edits ([M1.2](#m12-the-four-guard-edits)); `AdminBusinessPicker.tsx` header comment; the two test mocks; T9 rewritten. V-3 green (**day-1 checkpoint**)
  - ✅ 4. `financeAccount.ts` (+ T11), `financeLinks.ts` (+ T10)
  - ✅ 5. `AccountHeader.tsx`, `AccountSummary.tsx` (with the M-1 placeholder), `FinanceView.tsx` (`pickedName`, header, summary), `AiCostSection.tsx` link, copy; T8, T12. The SA-WR-35 widening moved to step 13 (deviation D-1)
  - ✅ 6. `usersFilters.ts`, `page.tsx` (consume, notice, `data-account-id`), `BusinessOsPanel.tsx` link; T13 (with SA-WR-36)
  - ✅ 7. **M-1 checkpoint** (V-13) pasted in Implementation Notes: GREEN
- **M-2**
  - ✅ 8. R-m, R-m′, `FINANCE_PLAN_PAYMENT_COLUMNS`, `FinancePlanPaymentRow`, `paidInvoiceFilter`, header; barrel; T1 (pins unedited)
  - ✅ 9. `planRevenue.ts` + T2
  - ✅ 10. `ourRevenue.ts` + T3; `boostRevenue.ts` (`netMinorByCurrency`, no `k5`) + T4
  - ✅ 11. `financeTypes.ts`; `financeHealth.ts`; `financeHealthDeps.ts`; T5 (E-36, AC-123, rewritten 4a and 1c cases)
  - ✅ 12. Route info line and header; T7
  - ✅ 13. `PlanRevenuePart.tsx`, `RevenuePanel.tsx`, `AccountSummary.tsx` fill (plan, total, and the S5-F7 refund note), `financeCopy.ts`; T8 (M-2 cases; placeholder assertion replaced); SA-WR-35/38 widening
  - ✅ 14. The `slice 5a` finance source-guard describe with planted controls (T6)
  - ✅ 15. V-1 to V-11 (V-12 is QA's / the user's), outputs pasted in Implementation Notes
  - ✅ 16. Hand over to SA code review, uncommitted. The requirement MDs are not edited by Dev (TL records the workplan link; TL / BA records SA-W55 in §11D.2 and §0.1)

---

## Checklist before SA code review

- [x] `git branch --show-current` = `feature/bos-money-m1-m2`; nothing committed; no stash used
- [x] `git diff --stat` read **before** the diff: only the original picker is deletion-only; no migration; no requirement MD from Dev
- [x] M-1 checkpoint pasted (AC-111)
- [x] No `lib/` file imports from the entitlements module newly; `planGroups.ts` / `financeHealthDeps.ts` symbol sets unchanged; no tier literal (fixtures from `tierOrder[0]`)
- [x] No `BusinessOsBillingEventRepository` / `businessOsBillingEventRepository` string in any new or edited file (comments and tests included)
- [x] No `livemode`, `stripe_`, `refusal_reason` or `plan_written` in the repository code, columns, builders, page or copy
- [x] Integer cents only; `minorUnitsPerMajor(code) !== 100` gate; one `/ CURRENCY_SCALE` per builder; no × 100
- [x] No total across currencies in any export, payload field, tile or element
- [x] With a business picked: R-m, R-k and `countRevenueRows` have zero calls (spied)
- [x] Every list timestamp goes through `formatUtc`; no `formatUtcDate` in the plans part
- [x] The business name never reaches the URL, a request or a log
- [x] `account` on `/admin/users` is page-only, consumed once, removed from the URL, and filters nothing
- [x] Every new guard rule has a planted negative control
- [x] No `console.*`; Pino only; errors as `{ err }`
- [x] V-1 to V-11 pasted with their own exit codes; the canary reported TS2322 before the clean run
- [x] `npm run test:bos-entitlements` and `npm run test:authz-guard` green on the final diff

---

## Implementation Notes

*Dev fills this in during and after implementation: files, where each SA ruling landed, deviations, verification output (V-1 to V-11, V-13), and what is not done or still open.*

### M-1 checkpoint (V-13, AC-111, SA-WR-37): GREEN, recorded before any M-2 file was touched

Run 2026-10-14 in `neuronforge-finance-health` on `feature/bos-money-m1-m2`, nothing committed, no stash.

`git diff --name-only` (tracked) plus `git status --porcelain` (untracked), the two requirement MDs excluded (BA's parallel E-40 to E-42 edits, not Dev's):

```text
 M app/admin/__tests__/contrast.lf1.source.guard.test.ts
 D app/admin/audit-trail/BusinessAccountPicker.tsx
 M app/admin/audit-trail/__tests__/businessPicker.contract.test.ts
 M app/admin/components/layout/AdminBusinessPicker.tsx          (comment only, SA-W70 a)
 M app/admin/components/layout/__tests__/layoutFolder.guard.test.ts   (comment only)
 M app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx
 M app/admin/finance/__tests__/financePage.render.test.tsx
 M app/admin/finance/__tests__/source.guard.test.ts
 M app/admin/finance/components/AiCostSection.tsx
 M app/admin/finance/components/CreditsSection.tsx
 M app/admin/finance/components/FinanceFilterBar.tsx
 M app/admin/finance/components/FinanceView.tsx
 M app/admin/finance/financeCopy.ts
 M app/admin/users/__tests__/businessOsPanel.render.test.tsx
 M app/admin/users/components/BusinessOsPanel.tsx
 M app/admin/users/page.tsx
 M app/admin/users/usersFilters.ts
?? app/admin/finance/__tests__/financeAccount.render.test.tsx
?? app/admin/finance/__tests__/financeAccount.test.ts
?? app/admin/finance/__tests__/financeLinks.test.ts
?? app/admin/finance/components/AccountHeader.tsx
?? app/admin/finance/components/AccountSummary.tsx
?? app/admin/finance/financeAccount.ts
?? app/admin/finance/financeLinks.ts
?? app/admin/users/__tests__/businessesDeepLink.render.test.tsx
```

**No path under `lib/` or `app/api/`.** `git diff --exit-code --stat -- app/api lib` → no output, `exit=0`.

| Check | Command | Own exit | Result |
|---|---|---|---|
| V-1 finance suites (route test unchanged) | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | 0 | 21 suites, 1,569 tests passed |
| V-2 Businesses and `app/admin/users` | `npx jest app/admin/users app/api/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`; then `git diff --exit-code --quiet -- app/api/admin/users lib/business-os/credits` | 0; 0 | 33 suites, 733 tests passed |
| V-3 layout and picker guards | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm app/admin/analytics --ci` | 0 | 70 suites, 2,266 tests passed. PASS lines for `businessPicker.contract`, `layoutFolder.guard` (G-6), `contrast.lf1.source.guard` and `business-os-llm/__tests__/source.guard` (G-1, unchanged) |
| V-5 | `npm run test:authz-guard` | 0 | 2 suites, 203 tests passed |
| V-7 | `npm run lint:hooks` | 0 | clean |
| V-9 (M-1) | scoped `tsc`, config outside the worktree (`…\scratchpad\tsconfig.m1.json`: absolute `extends`, `noEmit`, `incremental: false`, `types/**/*.d.ts`, `next-env.d.ts` and the 24 touched / new `.ts` / `.tsx` files) | canary 2; clean 0 | Canary in `financeAccount.ts` → `financeAccount.ts(97,14): error TS2322`. Canary removed (`grep -c __canary` = 0), re-run: zero diagnostics |

`grep -rn BusinessAccountPicker app lib components hooks` → the three guard tests (contract deletion pin, BOS-LLM G-1, contrast `:107`) plus two comments that name the old file as history (`AdminBusinessPicker.tsx:5`, `layoutFolder.guard.test.ts:518`). No import.

AC-110's M-1 clause: `financeAccount.render.test.tsx` asserted `account-summary-plan` = `ACCOUNT_PLAN_PLACEHOLDER` at this point (replaced in M-2).

**Deviation recorded at the checkpoint (D-1).** S5-F7 (the refund-timing note on the summary's boosts line) and its pin edit SA-WR-35/38 (SA-W58 a) are deferred from M-1 to the first M-2 step. Reason: the SA-WR-35 pin lives in `lib/business-os/finance/__tests__/finance.source.guard.test.ts`. A second user of `REVENUE_REFUND_TIMING_NOTE` turns it red unless that `lib/` file is edited, and AC-111 / SA-WR-37 require no `lib/` path at the checkpoint. So the summary note and its pin widening land together in M-2. The final PR is unchanged. For the same reason, the M-1 source rules (SA-WR-39 chip pin, (i) dim text, (j) name never in a URL or request, no `.reduce(` in the header or summary, links file imports) went into the **page** guard `app/admin/finance/__tests__/source.guard.test.ts` rather than the lib guard's 5a describe. Each has a planted control.

### Files (final, 2026-10-14)

**Created (14):**
- M-1: `app/admin/finance/financeAccount.ts`, `app/admin/finance/financeLinks.ts`, `app/admin/finance/components/AccountHeader.tsx`, `app/admin/finance/components/AccountSummary.tsx`.
- M-1 tests: `app/admin/finance/__tests__/financeAccount.test.ts` (T11), `financeLinks.test.ts` (T10), `financeAccount.render.test.tsx` (T12), and `app/admin/users/__tests__/businessesDeepLink.render.test.tsx` (T13).
- M-2: `lib/business-os/finance/planRevenue.ts`, `lib/business-os/finance/ourRevenue.ts`, `app/admin/finance/components/PlanRevenuePart.tsx`.
- M-2 tests: `lib/business-os/finance/__tests__/planRevenue.test.ts` (T2), `ourRevenue.test.ts` (T3).

**Deleted (1):** `app/admin/audit-trail/BusinessAccountPicker.tsx`, the one deletion-only file.

**Modified, M-1 (17):** `FinanceFilterBar.tsx`, `FinanceView.tsx`, `AiCostSection.tsx`, `CreditsSection.tsx` (`usedPercent` exported), `financeCopy.ts`, `financeFilterBar.layout.render.test.tsx`, `financePage.render.test.tsx`, `app/admin/finance/__tests__/source.guard.test.ts`, `usersFilters.ts`, `users/page.tsx`, `BusinessOsPanel.tsx`, `businessOsPanel.render.test.tsx`, `businessPicker.contract.test.ts`, `layoutFolder.guard.test.ts` (comment), `contrast.lf1.source.guard.test.ts`, `AdminBusinessPicker.tsx` (comment).

**Modified, M-2 (14):**
- Repository: `BusinessOsFinanceReadRepository.ts` and its test, and `lib/repositories/index.ts`.
- Builders: `boostRevenue.ts` and its test.
- `financeTypes.ts`, `financeHealth.ts`, `financeHealthDeps.ts`, `financeHealth.test.ts` and `finance.source.guard.test.ts`.
- Route: `route.ts` and its test.
- Page: `RevenuePanel.tsx`, plus a second pass on `AccountSummary.tsx`, `FinanceView.tsx`, `financeCopy.ts`, `financePage.render.test.tsx` and `financeAccount.render.test.tsx`.

**Not touched (as planned):**
- `FinanceKpiStrip.tsx`, `currencyGroups.ts`, `planGroups.ts`, `useFinanceData.ts`, `financeUrl.ts`.
- The billing-event writer and `lib/business-os/billing/`, `app/api/stripe/`, `lib/payments/`.
- `enforcementPoints.test.ts`, every migration, and the requirement MDs.

### Where each SA ruling and required change landed

| Ruling | Where |
|---|---|
| SA-W56 | `financeLinks.ts`: Activity and Costs get `range=<preset>` or `range=custom&from&to`; AI cost & usage gets `today` / `this_month` as presets, and 7d / 30d / custom as `range=custom` with the payload dates. `financeLinks.test.ts` parses every href back through `ACTIVITY_FILTER_SPEC`, `COSTS_FILTER_SPEC` and `ANALYTICS_FILTER_SPEC` and `resolveWindow` (specs imported in the test only; a source rule pins the links file to one type import) |
| SA-W57 / SA-WR-36 | `usersFilters.ts` page-only `account` textFilter (UUID). `page.tsx` consumes it after the first read that succeeded (`!loading && hasLoaded`), opens through `openRow`, else `AdminNotice` `users-deeplink-missing`, then `setFilters({ account: '' })`. `businessesDeepLink.render.test.tsx` covers: key gone from the URL before the delayed first read resolves, and the drawer still opens; first read FAILS → nothing consumed, Try again opens it; Refresh and Clear never bring it back; malformed ignored and removed; one list request; focus back on the row's Open button; status and search unchanged |
| SA-W58 (a) / SA-WR-38 | `finance.source.guard.test.ts`: users of `REVENUE_REFUND_TIMING_NOTE` are exactly `[AccountSummary.tsx, RevenuePanel.tsx]`, with a planted third user (`TakingsSection.tsx`) as the control. The summary shows the note only on `notes.refundOrDispute` (T12 asserts both ways) |
| SA-W59 | `boostRevenue.ts`: `netMinorByCurrency` added, `k5` removed; export names and the single `/ CURRENCY_SCALE` unchanged (4a pins pass unedited) |
| SA-W60 | `K5_REVENUE_HEADLINE`; `TILE_LABELS.k5Sub = 'Credit boosts and plans'`; `FinanceKpiStrip.tsx` unedited (SA-WR-34 passes) |
| SA-W61 (SA-WR-32 rule) | `revenue.plans` is the `FinancePlanRevenue` object. R-d's repository describe is unedited, and `financeHealth.test.ts` "SA-WR-32: a test-mode plan invoice alone (R-d counts it) → state recorded" pins the all-businesses behaviour. The seven `REVENUE_PLANS_*` constants, `PLANS_TEXT` and `K5_NET_HEADLINE` are deleted; a guard rule and V-10 grep prove it |
| SA-W62 / SA-W63 / SA-W64 / SA-W66 / SA-W72 / SA-W73 | `financeHealth.ts` status from the two money parts; `ourRevenue.ts` exactness; `planRevenue.ts` per-row unreadable; by-business sort (builder by currency / received / id, then `financeHealth.ts` re-sorts the shown rows by currency / received within one currency / name / id); caps 200 and 50; one names call for shown plan rows, all businesses only |
| SA-W65 | `planLabelOf` built in `financeHealth.ts` from `deps.config.tierOrder` and `tierLabelForGroup`. No new entitlements import anywhere (finance guard "only planGroups.ts and the wiring" passes) |
| SA-W68 / SA-WR-39 | Local, unexported `FinanceActiveChip` in `FinanceFilterBar.tsx` (comment names M-6). The page guard pins: defined only there, never exported, renders `chip.label / title / testId / removeLabel / onRemove`, with planted controls |
| SA-W69 / SA-W70 / SA-W71 / SA-W67 | Contrast `EXCLUDED` removed; the new page files are held to slate-400 by planted-control rules; the help line is page-owned with `describedBy`; "Open money view" only when `!loading && !notBos`; the Businesses link is `status=all&account=<id>` |
| SA-WR-37 | M-1 checkpoint above, recorded before any M-2 file was touched |
| SA-WR-40 | The month-parameterised SQL checks 17 and 18 are BA's E-40 requirement edit. QA runs them with `2026-10-01 00:00:00+00` for AC-129. `planRevenue.test.ts` has an independent `checkSeventeen` and a check-18 plan column written from that SQL |

### Deviations

- **D-1 (above):** the S5-F7 summary refund note and its pin widening landed in M-2, not M-1, so that AC-111 holds literally at the checkpoint. The M-1 source rules live in the page guard.
- **D-2:** `buildPlanRevenue` takes no `isPlatformAccount`. The platform label is applied by `financeHealth.ts` when it adds names, as the takings block does, so an unused parameter was dropped.
- **D-3:** `FinancePlanPaymentListRow.paidAt` is `string | null`, defensively; the read filters on `paid_at`. A null shows "Not recorded", never '—'.
- **D-4:** E-36's picked-business `state` uses `counts.invoices` (rows of the paid invoice kind, any amount), so it means what R-d means with all businesses. Zero-amount invoices and unreadable invoices still count as "recorded". A zero-only window therefore shows `recorded` with the empty plans sentence.
- **D-5:** `FinancePlanNotes.empty` is false when an unreadable paid invoice exists, even with no readable payment. The line then shows "At least" with "excludes N unreadable", not the empty sentence.
- **D-6:** the consume effect in `page.tsx` calls the latest closure through a ref (`consumeDeepLink.current`), not the workplan's inline effect. The trigger dependencies stay `[pendingAccount, loading, hasLoaded]`, and the effect does not re-run on every render of `shownUsers`. Behaviour is as specified.

### Final verification (2026-10-14, own exit codes, never through a pipe)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | 0 | 23 suites, 1,756 tests passed |
| V-2 | `npx jest app/admin/users app/api/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`; `git diff --exit-code --quiet -- app/api/admin/users lib/business-os/credits` | 0; 0 | 33 suites, 733 tests passed |
| V-3 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm app/admin/analytics --ci` | 0 | 70 suites, 2,266 tests. PASS: `businessPicker.contract`, `layoutFolder.guard`, `contrast.lf1.source.guard`, `business-os-llm/__tests__/source.guard` (G-1 unchanged) |
| V-4 | `npm run test:bos-entitlements` | 0 | 265 suites, 7,913 tests passed |
| V-5 | `npm run test:authz-guard` | 0 | 2 suites, 203 tests passed |
| V-6 | the billing-guard command of the plan, then `git diff --exit-code --quiet -- lib/business-os/billing app/api/stripe lib/payments lib/repositories/BusinessOsBillingEventRepository.ts lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts` | 0; 0 | 39 suites, 3,663 tests. Not tripped and unedited: `BusinessOsBillingEventRepository.test.ts` (caller list), `firstPaymentStamp.guard`, `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`. The finance table pin (`REPOSITORY_TABLES`, eight tables) is not tripped: only its comment gained R-m |
| V-7 | `npm run lint:hooks` | 0 | clean |
| V-8 | `npx eslint` on all 42 touched or new `.ts` / `.tsx` files | 0 | no output |
| V-9 | scoped `tsc`, config outside the worktree (`…\scratchpad\tsconfig.5a.json`, absolute `extends`, `noEmit`, `incremental: false`, `types/**/*.d.ts`, `next-env.d.ts`, the 42 files) | canary 2; clean 2 | The canary in `planRevenue.ts` reported `planRevenue.ts(351,14): error TS2322`; it was removed (`grep -c __canary` = 0). Clean run: **zero diagnostics in touched files**. Three pre-existing ones come from untouched files pulled in through the import graph: `lib/pilot/insight/MemoryManager.ts(60,48)` TS2769, `(126,40)` TS2339, and `lib/repositories/CalibrationSessionRepository.ts(315,7)` TS2741. `git diff 392a9b53` on both files is empty |
| V-10 | `git diff --stat` | — | 32 tracked files; `BusinessAccountPicker.tsx` 342 deletions, 0 insertions, the only deletion-only file; no `supabase/migrations` path; the two requirement MDs are BA's parallel edits. `grep -rn BusinessAccountPicker app lib components hooks` gives the three guard tests plus two history comments (`AdminBusinessPicker.tsx:5`, `layoutFolder.guard.test.ts:518`). The deleted-constants grep is empty (exit 1) |
| V-11 | `npm run schema:check` not run (no credentials in the worktree). Every R-m column is in migration `20261027` (`:5-24`) and the §11D.1 live column list | — | note |

**Logging.**
- `console.*` count in every touched or new product file: **0** (grep exit 1).
- Pino only, with errors as `{ err }`. New log lines: R-m `info` and R-m′ `debug` (the pager's own lines, counts only), `failed('plan_payments')`, `failed('plan_names')`, and the route line's `sections.revenuePlans`, `counts.plans` and `counts.revenueExistence`.
- M-1 adds no log line.
- Flagged earlier and still not touched: `useFinanceData.ts` uses the server `createLogger` in a client file (F-56, for M-6).

**Open / not done:**
- V-12 (SQL checks 17 and 18 against the page) and manual QA L-59 to L-72 are QA's and the user's.
- `durationMs` (M2-FR-14) is recorded at L-72.
- No commit; RM commits after SA and QA.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-14, against `392a9b53`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed, applying SA-WR-36 to SA-WR-40 as you build. SA checks them at code review, and the M-1 checkpoint is a hard gate (SA-WR-37). BA applies E-40 to E-42 below. Coding does not wait for them; V-11 and QA do.

**How it was checked.** I opened the code:
- **`useAdminFilters.ts`:**
  - `projectSearch` (`:138-152`) skips `pageOnly` fields;
  - the mount write (`:200-210`) `replaceState`s them away;
  - the `lastKnown` echo skip (`:170-192`) keeps the parsed state after that write.

  So a page-only `account` stays in `filters` until the page clears it. That is SA-W57's premise, and it holds.
- **`analyticsFilters.ts`:** has a custom window (`:132-157`, `:193-245`) and `account` (`:170`), so SA-W56 holds.
- **`contrast.lf1.source.guard.test.ts`:** `PAGES` (`:60-66`) does not walk Finance, and `EXCLUDED` filters only Audit trail. SA-W69 holds.
- **The picker deletion:**
  - the original is imported only by `FinanceFilterBar.tsx`;
  - the contract test's `:92` becomes a deletion pin, which is stronger, not weaker;
  - the layout-folder edit is a comment;
  - the contrast exclusion is removed;
  - BOS-LLM G-1 is unchanged.
- **The two reads:** R-m and R-m′ use the pager with `paidInvoiceFilter` (`kind = invoice_paid` and the `paid_at` range on every page). They are the all-accounts / account-scoped pair, with the 5,000 ceiling and "at least", and integer cents only when `minorUnitsPerMajor` is 100. R-d is not called with a business picked, and `formatUtc` is used for every timestamp.
- **K-5:** `combineOurRevenue` adds only within one currency and returns Unknown unless both parts are exact. An absent part is an exact 0 only when its read succeeded and was not cut off (SA-W63).
- **Guards:** the table pin does not grow (`business_os_billing_events` is already pinned for R-d). The billing-event caller list, `firstPaymentStamp` and the three webhook placement guards are untouched (no `billing/` file, no writer name, no `first_paid_at`).
- **AC mapping:** covers AC-108 to AC-129.
- **The canary:** follows SA-WR-7.

### One PR or two (SA-W55, the estimate)

**One PR, accepted.** The user asked for it, and the parts touch shared files: copy, the page render test, `FinanceView.tsx` and `AccountSummary.tsx`. Splitting the commits would be artificial. 4.5 days is above the usual slice size, so the size is controlled by:
- the **M-1 checkpoint as a hard gate** (SA-WR-37);
- M-1's "no `lib/` / `app/api/` change" proven at that point (AC-111);
- the end-of-day-1 and end-of-day-2 reports.

If the checkpoint is not green by the end of day 2, M-2 does not start and TL decides whether M-1 ships alone.

### Rulings SA-W55 to SA-W73

| # | Ruling |
|---|---|
| **SA-W55** | **Approved:** one workplan and one PR, with the M-1 checkpoint (above). BA records it (E-41). |
| **SA-W56** | **Approved, and supersedes SA-Q34's "(its own window)".** Every link carries the window. AI cost & usage gets `today` / `this_month` as equal presets, and 7d, 30d and custom as `range=custom` with the payload's dates. The parse-back test runs through each target's own spec, and those specs are imported **in tests only**. BA records it (E-42). |
| **SA-W57** | **Approved.** A page-only `textFilter` with UUID validation; no new pattern (Audit trail `search`). Add the timing test in SA-WR-36. |
| **SA-W58** | **Option (a).** The refund-timing pin's allowed users become exactly `[RevenuePanel.tsx, AccountSummary.tsx]`: one constant, one sentence, with a planted third user as the control. |
| **SA-W59** | **Approved.** `netMinorByCurrency` is a non-wire field; `k5` leaves `boostRevenue.ts`. The 4a export pin and the single `/ CURRENCY_SCALE` hold. |
| **SA-W60** | **Approved.** The shape is kept, so SA-WR-34 and `FinanceKpiStrip.tsx` are unedited; only the headline and caption copy change. |
| **SA-W61** | **Approved, under the SA-WR-32 rule.** `revenue.plans` becomes the M2-FR-11 object. R-d's behaviour stays pinned: the repository's R-d describe is unedited, and with all businesses a test-mode invoice count alone gives `state === 'recorded'`. The `REVENUE_PLANS_*` constants are deleted and grepped out. |
| **SA-W62** | **Approved.** Section status comes from the two money parts; an R-d failure moves only `state`. |
| **SA-W63** | **Approved:** an absent part is an exact 0 only when its read succeeded and was not cut off. |
| **SA-W64** | **Approved:** unreadable is decided per row, including tax greater than amount. An unreadable row is not a payment. A NULL tier shows "Unknown plan" and a NULL period shows "Not recorded". |
| **SA-W65** | **Approved.** The membership check against `tierOrder` lives in `financeHealth.ts` and adds no entitlements import. QA reads "Essentials" for the stored `basic`. |
| **SA-W66** | **Approved:** sort by currency first, then received, then name, then id (the S2-FR-7 precedent). |
| **SA-W67** | **Approved:** `/admin/users?status=all&account=<id>`. A business beyond row 100 gets the notice (R-9). |
| **SA-W68** | **Approved as temporary.** The local `FinanceActiveChip` is not exported and carries a pointer to M-6 (DF-4); SA-WR-39 pins it. |
| **SA-W69** | **Approved.** Remove `EXCLUDED`; do not add Finance to the contrast walk (that is M-6). The new files are held to `text-slate-400` by a narrow finance rule with a planted control. |
| **SA-W70** | **Approved.** (a) A comment-only edit in the shared folder. (b) The help line becomes page-owned, through `describedBy`. |
| **SA-W71** | **Approved:** in the BOS panel header, only when `!loading && !notBos`. |
| **SA-W72** | **Approved:** 200 and 50, with "N more … not listed". |
| **SA-W73** | **Approved:** one more names call, only for shown plan rows and only with all businesses. QA records `durationMs`. |

**`!!`-style and other notes.** No new tier literal, cohort literal or `console.` is planned. The local chip is the only near-duplicate.

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-36 (Medium). The one-shot key survives until the list arrives.** The `businessesDeepLink` render test runs the first users fetch **after** the hook's mount write, using a delayed mock. It asserts that:
   - the URL no longer holds `account` right after mount;
   - the drawer still opens once the list resolves;
   - a first read that **fails** consumes nothing, and the next successful read still opens the drawer;
   - Clear and Refresh do not resurrect the key.
2. **SA-WR-37 (Medium). The M-1 checkpoint is a gate.**
   - Paste V-13 (the `git diff --name-only` / `status --porcelain` lists, `git diff --exit-code -- app/api lib`, the route test unchanged and green, and V-1 to V-3 plus V-7 on M-1) before any M-2 file is touched.
   - If it is not green by the end of day 2, stop and report to TL.
   - At code review, SA re-checks that every `lib/` and `app/api/` path in the final diff is an M-2 path.
3. **SA-WR-38 (Low). The SA-W58 pin edit.** The allowed list is exact (two files) and has a planted third user. The summary shows the note only on the panel's own condition (`notes.refundOrDispute`).
4. **SA-WR-39 (Low). The local chip.**
   - A source rule pins that `FinanceActiveChip` is defined only in `FinanceFilterBar.tsx` and is not exported.
   - It renders `businessFilterChip`'s `label`, `title`, `testId` and `removeLabel` unchanged.
   - Its comment names M-6.
5. **SA-WR-40 (Low). SQL checks 17 and 18 take a month (E-40).** QA runs them for AC-129 with `2026-10-01 00:00:00+00`, so the October figures reproduce in any later month.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-5a)

- **E-40 (checks 17 and 18: one month, chosen by the user).** In §13, replace the two SQL blocks with these. They are ASCII only, with no apostrophe in a comment, no "into", and one result set each. The default is still the current UTC month.

  **check 17:**
  ```sql
  -- Finance page check 17: plan payments received in one UTC month, per currency, read only.
  -- Compare with Our revenue (plans) and the plans part of tile K-5.
  -- The month is the current UTC month. To check another month, replace null in the
  -- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
  -- Only invoice_paid rows count. mismatch_refused rows also carry amounts and never count.
  -- A payment counts in the UTC month of paid_at. amount_minor is the amount paid, tax included.
  -- Zero amount invoices are not payments; they are counted on their own.
  -- Rows with a null user_id are payments of deleted accounts.
  with p as (
    select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
  )
  select
    upper(btrim(e.currency)) as currency,
    count(*) filter (where e.amount_minor > 0) as payments,
    count(*) filter (where e.amount_minor = 0) as zero_amount_invoices,
    count(distinct e.user_id) filter (where e.amount_minor > 0) as businesses_paid,
    coalesce(sum(e.amount_minor), 0) as received_minor,
    coalesce(sum(e.amount_tax_minor), 0) as tax_minor,
    count(*) filter (where e.user_id is null and e.amount_minor > 0) as deleted_account_payments,
    coalesce(sum(e.amount_minor) filter (where e.user_id is null), 0) as deleted_account_received_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  group by 1
  order by 1;
  ```

  **check 18:**
  ```sql
  -- Finance page check 18: our revenue per account and currency in one UTC month, read only.
  -- Compare with the account summary, the by business table and tile K-5 with that business picked.
  -- The month is the current UTC month. To check another month, replace null in the
  -- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
  -- plan_received_minor: invoice_paid amounts by paid_at, tax included.
  -- boost_net_minor: boosts by paid_at, net of refunds and disputes, as check 14.
  -- A disputed or dispute_lost boost adds nothing to net, as on the page.
  -- total_minor adds plans and boosts of one currency only; no row adds two currencies.
  with p as (
    select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
  ),
  money as (
    select e.user_id, upper(btrim(e.currency)) as currency,
           e.amount_minor as plan_minor, 0 as boost_minor
    from public.business_os_billing_events e
    cross join p
    where e.kind = 'invoice_paid'
      and e.paid_at >= p.month_start
      and e.paid_at < p.month_start + interval '1 month'
    union all
    select b.user_id, upper(btrim(b.currency)) as currency,
           0 as plan_minor, b.amount_total_minor - b.amount_refunded_minor as boost_minor
    from public.business_os_boost_purchases b
    cross join p
    where b.paid_at >= p.month_start
      and b.paid_at < p.month_start + interval '1 month'
      and b.status in ('paid', 'partially_refunded', 'refunded')
  )
  select
    coalesce(m.user_id::text, 'deleted accounts') as account,
    m.currency,
    sum(m.plan_minor) as plan_received_minor,
    sum(m.boost_minor) as boost_net_minor,
    sum(m.plan_minor) + sum(m.boost_minor) as total_minor
  from money m
  group by 1, 2
  order by 1, 2;
  ```

  In the "Slice 5a checks" intro, replace "Run in October 2026, check 18 shows" with "With the month set to 2026-10-01 00:00:00+00 (or run in October 2026), check 18 shows".
- **E-41 (SA-W55).** Append to §11D.2's "**Order:**" paragraph: " **Amended 2026-10-14 (user, SA-W55):** M-1 and M-2 ship in **one workplan and one PR**. M-1 is finished first and proven at the M-1 checkpoint (no `lib/` or `app/api/` change; AC-111); M-2 starts only after it." Make the same note on the §0.1 row 5a.
- **E-42 (SA-W56).** Append to M1-FR-7: " AI cost & usage accepts a custom UTC window (L-2a), so every link carries the window: equal presets where they exist, otherwise `range=custom` with the payload's dates (SA-W56; supersedes SA-Q34's \"(its own window)\")."

---

## SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** ✅ **APPROVED. Code approved for QA.** There is no code condition. One requirement wording edit (E-43) and one recorded follow-up are below.

**How it was checked.** I read every changed, new and deleted file: 31 modified, 14 new, 1 deleted.

**My own runs (all exit 0 unless noted):**
- **Finance and admin suites:** the finance lib, page and route; the finance repository test; `app/admin/users`; `app/admin/audit-trail`; `app/admin/__tests__`; the layout folder; BOS-LLM G-1; `lib/business-os/billing`; the billing-event repository test; the three webhook placement guards.
  - Result: 129 suites, 7,541 of 7,543 tests passed.
  - The 2 failures were in `app/admin/__tests__/jobsQueues.items.render.test.tsx`, a file this diff does not touch. It ran 160 s under the parallel load of my run, and **passed alone (25/25)**, so it is a load-sensitive render test, not 5a.
- `test:bos-entitlements`: 265 suites, 7,913 tests.
- `test:authz-guard`: 203 tests.
- `git diff --stat` on `lib/business-os/billing`, `app/api/stripe`, `lib/payments` and the billing-event writer: empty.
- `grep BusinessAccountPicker` (product code): only the history comment in `AdminBusinessPicker.tsx:5`.
- No `'basic'` / `'pro'` literal in finance code.

### Required changes

| Item | Verdict |
|---|---|
| **SA-WR-36** | ✅ The `businessesDeepLink` render test proves that: the key leaves the URL before a delayed first read resolves and the drawer still opens; a failed first read consumes nothing and the next success opens it; Refresh and Clear never resurrect it; a malformed key is ignored and removed; there is one list request; focus returns to the Open button. |
| **SA-WR-37** | ✅ The M-1 checkpoint is recorded with its lists, `git diff --exit-code -- app/api lib` exit 0, V-1 to V-3 and the canary, before M-2. A pre-commit worktree cannot be re-run after the fact. I checked the other half: **every `lib/` and `app/api/` path in the final diff is an M-2 path** (repository, `index.ts`, the builders, types, health, deps, route and their tests). |
| **SA-WR-38** | ✅ The refund-timing note's users are exactly `[AccountSummary.tsx, RevenuePanel.tsx]`, with a planted third user. The summary shows it only on `notes.refundOrDispute`. |
| **SA-WR-39** | ✅ The page guard pins `FinanceActiveChip`: defined only in `FinanceFilterBar.tsx`, not exported, rendering the shared chip fields, with planted controls. |
| **SA-WR-40** | ✅ The month-parameterised checks 17 and 18 are BA's E-40. `planRevenue.test.ts` holds independent `checkSeventeen` and check-18 helpers written from that SQL. |

### Other checks

- **The picker:**
  - deleted (342 / 0);
  - the contract test is now a **deletion pin** (`existsSync … false` and not in the surface), with `PICKERS = [SHARED_PICKER]`;
  - the contrast exclusion is removed and Audit trail is walked whole;
  - the layout-folder and shared-picker edits are comments only;
  - BOS-LLM G-1 is unchanged.
- **R-m / R-m′:**
  - `paidInvoiceFilter` applies `kind = invoice_paid` plus the `paid_at` range on every page;
  - they are a named all-accounts / account-scoped pair (UUID first, `.eq('user_id')`);
  - keyset paging with ceiling 5,000, giving "At least" on the line (`exact` false);
  - `readPlanMoney`: `normaliseCurrencyCode` (trim and upper case), `minorUnitsPerMajor === 100`, integer, non-negative, tax ≤ amount;
  - no `toUnits`, `toHundredths` or `× 100`, and one `/ CURRENCY_SCALE`;
  - no `livemode`.
- **R-d:** `Promise.resolve(NOT_CALLED_REVENUE)` when `accountId` is set, and `counts.revenueExistence: 'not_called'`; the R-d repository describe is unedited.
- **Timestamps:** the payment list prints `paidAt` and the period through `formatUtc`; NULL shows "Not recorded".
- **K-5:** `combineOurRevenue` adds only within one currency. It returns Unknown unless both parts are exact, and an absent part counts as 0 only for an exact, uncut read. The null currency is never exact, and the summary total reads the same `totals`.
- **The plans part:** per account in the picked view (R-m′ and the payment list); the all-businesses prefix is gone.
- **The business name chain:** picked → payload row (`nameStatus === 'found'`) → short id. The name never reaches the URL, a request or a log (page-guard rule with control).
- **The one-shot `account` key on `/admin/users`:**
  - it is `pageOnly`, so it is never written and is removed by the hook's mount write;
  - it is consumed after the first successful read and does not filter the list;
  - the row selector is built from the list row's id, not from the URL.
- **Tier labels:** `planLabelOf` is built in `financeHealth.ts` from `deps.config.tierOrder` plus `tierLabelForGroup`, so the "Unknown plan" check lives there. There is no new entitlements import, and the "only `planGroups.ts` and the wiring" rule passes.
- **Links:** every link carries the window (W56); the Businesses link is `status=all`. A parse-back test runs through each target's own spec, imported in the test only.
- **The route:** `requireAdmin` is first. The info line adds `revenuePlans`, `counts.plans` and `counts.revenueExistence`, all counts, statuses and timing; no money and no tier.
- **Guards untouched:** billing-event caller list, `firstPaymentStamp`, the three webhook guards; the table pin is still eight tables (comment only).

### Deviations

| # | Ruling |
|---|---|
| D-1 | **Approved.** Moving S5-F7 and its pin edit into M-2 was the only way to keep AC-111 literally true at the checkpoint. The M-1 source rules in the page guard are the right home, and each has a control. |
| D-2 | **Approved.** The platform label is applied where names are added (the takings precedent); no unused parameter. |
| D-3 | **Approved.** A defensive `paidAt: string \| null` shows "Not recorded". |
| D-4 | **Approved, with a wording fix (E-43).** In the picked view, "recorded" means any `invoice_paid` row, which matches what R-d counts with all businesses, so `state` means one thing in both views. E-36 said "a counted plan payment". |
| D-5 | **Approved.** An unreadable invoice is not "empty": the line says "At least" with "excludes N unreadable". That is more honest. |
| D-6 | **Approved.** A ref to the latest closure, with trigger deps `[pendingAccount, loading, hasLoaded]`; the behaviour is tested. |

### `useFinanceData.ts` logger (Dev's flag)

- **Pre-existing since 1a** (`946653a1`), and not touched by this diff.
- **Not a browser break:** `lib/logger.ts` configures Pino's `browser` build, so the client bundle works. It is a standards deviation: client files should use `clientLogger` from `@/lib/logger/client`.
- **Leave it out of this PR** (no scope creep in an unattended PR) and fix it in **M-6** with the shell migration. It is recorded as a follow-up.

### Requirement edit (BA applies; recorded in §0.3 as SA-CR-5a)

- **E-43 (D-4).** In M2-FR-7, replace "`revenue.state` is `recorded` when the account has a counted plan payment or a counted boost in the window" with "`revenue.state` is `recorded` when the account has any `invoice_paid` row (any amount, the same rows R-d counts with all businesses) or a counted boost in the window".

### Code Approved for QA: **Yes**

QA owes V-12 (checks 17 and 18 with `2026-10-01 00:00:00+00`) and L-59 to L-72, including `durationMs`. Then RM commits and opens the PR as the user authorised.

---

## QA Report

**QA — 2026-10-14**
**Test mode:** full (AC-108 to AC-129)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the M-1 boundary and the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 17 and 18 (QA does not run SQL against production). The steps for the user are L-59 to L-74 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every AC from AC-108 to AC-129 that Jest can test passes. AC-116 (QA part), AC-117, AC-119 (live part), AC-124 (live part) and AC-129 wait on the user's manual run. Two Low notes, neither blocking.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-money-m1-m2`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` (T1 to T12; the finance source guard and the table pin included) | exit 0; **23 suites, 1,756 passed** |
| Q-2 | `npx jest app/admin/users app/api/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci` (T13 and the Businesses list), then `git diff --exit-code -- app/api/admin/users lib/business-os/credits` | exit 0; **33 suites, 733 passed**; diff **exit 0** |
| Q-3 | Picker and layout guards: `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm app/admin/analytics --ci` | First run (started while `test:bos-entitlements` was running alongside): 3 timeouts in 2 suites (`activityLayout.render` "Exceeded timeout of 5000 ms", `jobsQueues.items.render` "of 20000 ms"; neither file is in the diff). **The two suites alone: exit 0, 63 / 63. The whole set re-run on its own: exit 0, 70 suites, 2,266 passed.** PASS lines for `businessPicker.contract`, `layoutFolder.guard`, `contrast.lf1.source.guard` and `business-os-llm/__tests__/source.guard` (G-1, unchanged). Load-induced timeouts, not a 5a defect |
| Q-4 | Billing guards: `BusinessOsBillingEventRepository.test` (caller list), `firstPaymentStamp.guard`, `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`, `refundMath.test`, `BusinessOsBoostPurchaseRepository.test`, `lib/business-os/billing`, `purge/descriptors.invariant`, `businessOwnedTables`; then `git diff --exit-code` on `lib/business-os/billing app/api/stripe lib/payments`, the billing-event repository and its test, `lib/business-os/purge`, `lib/business-os/__tests__` | exit 0; **39 suites, 3,663 passed**; diff **exit 0** |
| Q-5 | `npm run test:bos-entitlements` | exit 0; **265 suites, 7,913 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-5a.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 42 added or modified `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `planRevenue.ts`): exit 2, `lib/business-os/finance/planRevenue.ts(350,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: exit 2 with **0 diagnostics in changed or new files**; the same 3 pre-existing ones outside the diff (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1) |
| Q-9 | The Jest "worker failed to exit gracefully" warning | Printed on Q-1, Q-2, Q-3, Q-4, Q-5 and Q-6 with every suite passing. This is FU-4a-3 (pre-existing, seen on untouched suites in 4a); not re-investigated, per R-13 |

### M-1 boundary (step 3, AC-111)

QA cannot replay history, so this checks the current tree against the checkpoint Dev recorded:
- **Every file in the recorded M-1 list is page-side:** all 25 entries are under `app/admin/` (finance, users, audit-trail, the shared layout folder and the contrast guard). None is under `lib/` or `app/api/`.
- **Every `lib/` and `app/api/` change in the final diff is M-2 content:**
  - the route gains only `revenuePlans: payload.revenue.plans.status` plus header text (+10 / −1);
  - the repository adds R-m / R-m′;
  - the builders add plan revenue and the combiner.
  None of them is an M-1 file.
- **The old picker:** `app/admin/audit-trail/BusinessAccountPicker.tsx` is gone (`ls`: no such file; numstat 0 / 342, the only deletion-only file). `grep -rln "audit-trail/BusinessAccountPicker"` over `app lib components hooks` finds only:
  - three guard tests (the contract test's deletion pin, BOS-LLM G-1, the contrast test);
  - one history comment (`AdminBusinessPicker.tsx:5`).
  Nothing imports it.

### Test Coverage (AC-108 to AC-129)

| AC | Result | Evidence |
|---|---|---|
| AC-108 | ✅ Pass | T9 / T8 render `AdminBusinessPicker` (mocked by path); `businessPicker.contract` with its deletion pin; G-1 unchanged; the M-1 boundary check above |
| AC-109 | ✅ Pass | T11 the name order (picked → Section 4 → Section 3 → takings → overdue → short id); T8 chip after a pick and after a reload; the page guard's rule that `pickedName` never reaches `serialiseFinanceUrl` / `router.replace` / `fetch` (planted control); `accountNameFor` (`financeAccount.ts:34-45`) |
| AC-110 | ✅ Pass (Jest), live part manual | T12 header (name, group, FP chip, Paying / Not paying / Unknown for every group kind) and summary lines, each compared with its section's node on one render; "Unknown" / "At least"; refund note both ways |
| AC-111 | ✅ Pass | Dev's checkpoint (`git diff --exit-code -- app/api lib` = 0, route test unchanged and green at that point) plus QA's boundary check above |
| AC-112 | ✅ Pass | Page guard: no `.reduce(` or money arithmetic in `AccountSummary.tsx` / `AccountHeader.tsx` (planted controls); T12 two boost currencies → two lines, no total |
| AC-113 | ✅ Pass | T10 parses every href back through `ACTIVITY_FILTER_SPEC`, `COSTS_FILTER_SPEC`, `ANALYTICS_FILTER_SPEC` and `resolveWindow` for every preset and a custom window (account and the same dates); T12 / T8 render the hrefs |
| AC-114 | ✅ Pass | T13 `businessOsPanel.render`: `bos-panel-money-view` href exactly `/admin/finance?accountId=<id>&preset=this_month`, no name or email, absent for a non-BOS login |
| AC-115 | ✅ Pass (Jest), live part manual | T13 `businessesDeepLink.render` (row opens the drawer; focus back to the row's Open button; key removed from the URL; off-screen → notice; malformed → ignored and removed; one list request; first read failing → nothing consumed, Try again opens it); the U-3 / U-7 suites green in Q-2 |
| AC-116 | ✅ Pass (Jest), QA part manual | T8: with no business picked, no `account-header` or `account-summary`, and the sections are as before. Manual: L-59 to L-66 |
| AC-117 | ⬜ NOT-TESTED (live) / ✅ method | T2 against the independent `checkSeventeen`. Check 17: L-71 |
| AC-118 | ✅ Pass | T1 `eq('kind','invoice_paid')`, `gte` / `lt` `paid_at` ISO strings, and a month-boundary range, for R-m and R-m′; T2 rows given once count once; T6 no clock in the builder |
| AC-119 | ✅ Pass (Jest), live part manual | T1 the kind filter on every page; T2 a planted `mismatch_refused` row with 7900 is excluded and counted as other kind (`planRevenue.ts:137-140`). Live: L-71 (the 8 refused rows not counted) |
| AC-120 | ✅ Pass | T2 7900 → 79.00, `usd` / ` USD ` on one line, each unreadable case; T6 (b) no `toHundredths` / `toUnits` / × 100; T8 "USD 79.00" |
| AC-121 | ✅ Pass | T2 zero-amount is not a payment and has no line; the note; T8 the note renders |
| AC-122 | ✅ Pass (Jest), live part manual | T3 USD 1000 + 7900 → `one` 89; several; failed; T5 owner fixture picked → K-5 `{ one, USD, 89 }`; T7 payload walker; T8 "USD 89.00", "2 currencies, see Our revenue", "Unknown" |
| AC-123 | ✅ Pass | T5 / T7: R-m′ exactly the id; R-m and `countRevenueRows` zero calls (`financeHealth.ts:484`); newest first; the deleted-constants grep is empty |
| AC-124 | ✅ Pass (Jest), live part manual | T2 by-business equals check 18's plan column; deleted line from NULL `user_id`; T5 `findNames` only with ids from shown rows; T8 deleted line in words. Check 18: L-72 |
| AC-125 | ✅ Pass | T1 small ceiling → `reachedCeiling`; T2 `exact: false`; T3 K-5 `unknown` / `cut_off`; T5 section `partial`; T8 "At least", notice, K-5 "Unknown" |
| AC-126 | ✅ Pass | T2 empty; T5 R-m failing → plans `unknown`, section `partial`, others present, 200 (T7 too); both failing → `unknown`; T8 the empty sentence, no `0.00`, "Could not load" on the plans part only |
| AC-127 | ✅ Pass | T1 column list (no `stripe_`, `refusal_reason`, `plan_written`, `livemode`, `created_at`); T7 payload keys and the info line (counts, booleans, state words; planted amount, currency and tier in no log call); T6 repo-wide `livemode` and mode-wording rules |
| AC-128 | ✅ Pass | T7 401 / 403 / every 400 with zero R-m / R-m′ calls; T6 write-verb pins; Q-4 billing guards unchanged; no migration path; Q-8 |
| AC-129 | ⬜ NOT-TESTED | Manual L-67 to L-74 below; `formatUtc` on every list timestamp is pinned by T6 (h) and seen in code (`PlanRevenuePart.tsx:90`) |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Business-name chain after a reload (picked → payload row → short id) | Confirmed | `accountNameFor`: a picked name only for the same id; else the first `found` row for that id across Section 4, Section 3, takings and overdue (only when `data.accountId` matches); else `null`, so the chip shows `formatShortId`. T11 / T8 |
| `account` deep link: opens once, stripped, slow or failed first read | Confirmed | Page-only `textFilter` (UUID-validated); the hook's mount write strips it from the URL at once. The pending value is consumed only when `!loading && hasLoaded`, then `setFilters({ account: '' })` (`page.tsx` consume effect). T13 covers a delayed first read and a failed first read: nothing is consumed on failure, and Try again opens it |
| Links carry the window | Confirmed | T10 parse-back through each target's own spec |
| USD plan + USD boost → K-5 89.00 | Confirmed | `combineOurRevenue` adds within one currency only (`ourRevenue.ts:38-48`); T3 / T5 |
| Plan in one currency and boost in another, never summed | Confirmed | Separate total lines per currency; K-5 `several` (`ourRevenue.ts:52-53`) |
| One part inexact → K-5 Unknown for that currency | Confirmed | `partFor` returns null for a null or unsafe line, and for an absent line when that part was cut off (SA-W63); the total is then null (`ourRevenue.ts:17-22, 41-42`) |
| `mismatch_refused` excluded | Confirmed | Query `.eq('kind','invoice_paid')` on every page, plus the builder's own kind check (other kind counted, block `partial`) |
| `paidAt` null | Confirmed | Sorted last (`NEGATIVE_INFINITY`), shown "Not recorded", never "—" (`PlanRevenuePart.tsx:90`, D-3) |
| Lowercase or padded currency codes | Confirmed | `normaliseCurrencyCode` trims and upper-cases (`usd`, ` USD ` → USD); only a normalised code reaches `minorUnitsPerMajor` |
| 5,000 ceiling, "at least" | Confirmed | `pageClientRows` `>=` → `reachedCeiling`; every line `exact: false`; `receivedMinor` null; K-5 Unknown |
| Picked business: account-scoped reads only, R-d not called | Confirmed | R-m′ / R-k′ with the id; `NOT_CALLED_REVENUE` instead of `countRevenueRows` (`financeHealth.ts:457, 484`); `counts.revenueExistence: 'not_called'` |
| Unknown tier → "Unknown plan" | Confirmed | `planLabelOf` returns null for a tier outside `config.tierOrder` (`financeHealth.ts:633-634`); the list prints `REVENUE_PLANS_UNKNOWN_PLAN` |
| Paying / Not paying | Confirmed | `payingStateOf` (`financeAccount.ts:54-66`): `tier:*` → Paying; trial / FP / comped / unknown_held → Not paying; `tier_set`, unknown or no group → Unknown |
| Timestamps through `formatUtc`, never "—" for a valid timestamp | Confirmed | `when()` uses `formatUtc` (UTC through `Date`, which parses Postgres offsets and microseconds); "—" only for an invalid value; NULL shows "Not recorded" |
| No money in logs | Confirmed | Repository lines carry counts only; `counts.plans` and `counts.revenueExistence` are counts and state words; T7 planted amount, currency and tier in no log call; M-1 adds no log line |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found in code. One more concurrent read on a 9-row table; the names call only with rows. `durationMs` owed from L-74.

#### Edge Cases / notes (Low)
1. **K-5 can count the "Unknown currency" line as a second currency** (`lib/business-os/finance/ourRevenue.ts:37, 52-53`). An unreadable plan row with no currency, next to a USD boost, gives two total lines (USD and Unknown), so K-5 reads "2 currencies, see Our revenue" instead of a USD figure or Unknown. Plan rows carry `currency_usd` (CHECK), so this cannot happen today, and nothing is summed wrongly. Low.
2. **Load-sensitive timeouts in two untouched layout suites** (Q-3: `activityLayout.render`, `jobsQueues.items.render`). They pass alone and in their own set run. They are worth watching on CI shards, but they are not a 5a defect.

### Manual live steps (continuing from 4a's L-58): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. For the SQL checks, use the Supabase SQL editor. In checks 17 and 18, replace `null` in the `p` block with `'2026-10-01 00:00:00+00'`, so the month is October 2026 whatever today's date is. Amounts there are minor units: divide by 100.

| # | Step | Expected |
|---|---|---|
| L-59 | `/admin/finance`, preset This month (October 2026; or Custom 2026-10-01 to 2026-10-31), All businesses | No account header and no summary. "Our revenue" has **Plans** and **Credit boosts** sub-headings. Every other section as before |
| L-60 | Pick your test account in the business picker | The chip reads "Business: {its name}". The header shows that name, the plan group **"Essentials"** with the Founding Partner chip (BD-15), **"Paying"**, and "Every section below is for this business only." |
| L-61 | Read the account summary | **AI cost, charged** equals Section 3's total. **Paid us: plan** USD 79.00. **Paid us: credit boosts** USD 10.00. **Paid us, total USD 89.00**. Credits equal your Section 4 row. The plan group matches the header. No margin line and no test-mode wording |
| L-62 | Reload the page | The chip and header still show the name (from the payload), or the short id if no section row holds it. `accountId` stays in the URL; the name never appears in it |
| L-63 | Click **Activity** and **Costs & credits** in the summary | Each opens on your account with the same window |
| L-64 | Click **AI cost & usage** | It opens filtered to your account with the same dates (This month → `range=this_month`; 7d / 30d → custom dates) |
| L-65 | Click **Businesses** | `/admin/users` opens with your business's drawer open, and `account` is gone from the address bar. Close it: focus returns to that row's Open button |
| L-66 | In that drawer, click **Open money view**; then try `/admin/users?status=all&account=<a UUID not on the list>` and `?account=nonsense` | Finance opens on This month with your account picked. The unknown UUID shows "This business is not in the current list" and no drawer; `nonsense` does nothing, and the key is removed |
| L-67 | K-5 with your account picked | **"USD 89.00"**, caption "Credit boosts and plans · <window> UTC", grey ("For information"), not green |
| L-68 | Our revenue → Plans, your account picked | The payment list has one row: paid at **2026-10-12 hh:mm UTC** (no "—"), plan **"Essentials"**, received USD 79.00, tax USD 0.00, period `2026-10-12 … UTC` to `2026-11-12 … UTC`. No "all businesses" prefix |
| L-69 | All businesses, Plans | USD line: 1 payment, received USD 79.00, tax USD 0.00, 1 business. By business: your account, USD 79.00. "No plan payments from deleted accounts". The note "Plan refunds and disputes are not recorded yet". K-5 "USD 89.00" (if no other account paid in October) |
| L-70 | A custom range ending before 2026-10-12 | "No plan payments received in this window", no `0.00`; K-5 "No data yet" |
| L-71 | **Check 17** (October literal) | USD: `payments` 1, `zero_amount_invoices` 0, `businesses_paid` 1, `received_minor` 7900, `tax_minor` 0, `deleted_account_payments` 0, `deleted_account_received_minor` 0. The page matches. The 8 `mismatch_refused` rows do not appear (they are not `invoice_paid`) |
| L-72 | **Check 18** (October literal) | Your account, USD: `plan_received_minor` 7900, `boost_net_minor` 1000, `total_minor` 8900, matching the by-business row (USD 79.00), the summary and K-5 picked (USD 89.00). The sum over accounts for USD equals K-5 with All businesses |
| L-73 | Signed out, then as a non-admin, call `/api/admin/business-os/finance` | 401 / 403, `Cache-Control: no-store`, no figures |
| L-74 | Dev-server log | One "Admin read the Business OS finance page" line per load with `sections.revenuePlans`, `counts.plans` and `counts.revenueExistence` (`'not_called'` with your account picked, `'read'` with all businesses). No amount, currency total, tier or name. **Record `durationMs`** for All businesses and for your account (target p95 under 2 s) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 5a AC that Jest can test passes, and no bug is open.** The manual / SQL parts (AC-116 QA part, AC-117, AC-119 live, AC-124 live, AC-129: L-59 to L-74) are owed by the user. The two Low notes do not block the commit and PR the user authorised after SA and QA.

---

## Commit Info

*RM populates this section (one commit / one PR for M-1 and M-2).*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (Dev) | One workplan for slice 5a, Money M-1 (one account, one screen) and M-2 (plan payments received), on `feature/bos-money-m1-m2` from `392a9b53`. **M-1:** shared picker and deletion of the original with four guard edits; the chip-name order (SA-Q32); account header (E-35) and summary; links carrying the window and account, checked against each target's own spec; "Open money view"; the one-shot `account` key as a page-only field (SA-Q33). **M-2:** R-m / R-m′ (`invoice_paid`, `paid_at`, integer cents, ceiling 5,000); `planRevenue.ts`; `ourRevenue.ts` (K-5 per currency, E-34); R-d not called with a business picked (SA-Q35, E-36); `formatUtc` for every list timestamp (E-33). Guard table, AC-108 to AC-129 mapping, verification plan (V-1 to V-13, SQL checks 17 and 18, manual L-59 to L-72), risks, estimate of about 4.5 days. Raises SA-W55 to SA-W73. No code changed. |
| 2026-10-14 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W55 to SA-W73 approved (W56 supersedes SA-Q34's "(its own window)"; W58 option a). One PR accepted, with the M-1 checkpoint as a hard gate. Required changes SA-WR-36 to SA-WR-40. Requirement edits E-40 (checks 17 and 18 take a month), E-41 (one PR) and E-42 (links carry the window) are for BA. |
| 2026-10-14 | Implemented (Dev): M-1 then M-2, Code Complete, uncommitted | M-1 checkpoint GREEN before any M-2 file (no `lib/` or `app/api/` path; V-1 / V-2 / V-3 / authz / lint:hooks / scoped tsc with canary). Then M-2: R-m / R-m′, `planRevenue.ts`, `ourRevenue.ts`, `netMinorByCurrency`, R-d not called with a business picked, the plans part, summary plan / total lines, K-5 boost net plus plans. SA-WR-36 to SA-WR-39 applied (SA-WR-40 is BA's E-40). Deviations D-1 to D-6 recorded. Final: finance 1,756 tests, Businesses 733, layout / picker guards 2,266, billing guards 3,663, bos-entitlements 7,913, authz 203, all exit 0; ESLint and lint:hooks clean; tsc zero diagnostics in touched files. |
| 2026-10-14 | SA code review: **APPROVED** | All 46 files read. SA-WR-36 to SA-WR-40 verified; the M-1 checkpoint is recorded, and every `lib/` / `app/api/` path is M-2. D-1 to D-6 approved (D-4 needs requirement wording, E-43). SA re-ran 129 suites (the 2 failures, in an untouched jobs render test, pass alone under no load), `test:bos-entitlements` (7,913) and `test:authz-guard` (203). The `useFinanceData.ts` logger is pre-existing since 1a and deferred to M-6. Code approved for QA. |
