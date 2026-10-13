# Workplan: Business OS Finance & Business Health — Slice 1c (fix: test-mode platform money, paying Founding Partners)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **1c**: §0.1 row 1c, §0.2 **BD-14** and **BD-15**, §0.3 **SA-Q20 to SA-Q24** and **SA-RR-1c**, §11B (S1C-FR-1 to S1C-FR-7, AC-75 to AC-86), §11B.5, the §12.2 "Slice 1c rows" row, §13 checks 1 and 6, and "SA Requirement Review — Slice 1c — 2026-10-13" (findings S1C-F1 to S1C-F6, edits E-15 to E-19, already applied by BA).
**Builds on:** slices 1a (PR #284), 1b (PR #290), 2a (PR #312), 2b (PR #318), all merged. [2b workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md) · [2b retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_RETROSPECTIVE.md).
**SA rulings implemented:**
- SA-Q20: the paid tier is the plan row's tier first, then `bought_tier`, then Unknown/held; values are only compared with `config.tierOrder`.
- SA-Q21, as changed by **BD-16** (one billing record per account, SA-WR-26): R-c keeps its keyset on `user_id` and R-c′ keeps `.eq('user_id').maybeSingle()`; both drop only the mode filter and add `bought_tier`. Two rows are an error, never a figure (SA-WR-27 for R-c; `maybeSingle` for R-c′). Paying = the account's row passes `isPayingBillingRow`.
- SA-Q22: the three renames; the source guard's `:334-335` control becomes "the repository's code names no `livemode`", with a planted control; the repository header is rewritten for BD-14.
- SA-Q23: dormant Founding Partners counts the Founding Partner group only; "ending in 30 days" is unchanged.
- SA-Q24: a note on the tier group row, and a `neutral` `StatusChip` "Founding Partner" in the picked view, both from `financeCopy.ts`; cohort recognised through `stateForCohort`.

Still in force from earlier slices: SA-W1 / AC-42 (picked business: account-scoped reads only, R-d the one platform-wide exception), SA-W2 (the paying constant is a literal with no repository import), SA-W3, SA-WR-1, SA-WR-4 (config is a parameter), SA-WR-7 (scoped `tsc` with canary), SA-WR-17 (see SA-W43), SA-CR-1 (cohort-literal rule with `\b`).
**Date:** 2026-10-13
**Branch:** `feature/bos-finance-health-1c`, cut by RM from `main` `97c66132`. Confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`. `node_modules` is a junction to the main checkout. Never `git worktree remove`, never `git stash`, never commit: RM commits after the user has seen the diff. The requirement MD is not edited by Dev (TL records the link).
**Status:** Code Complete. SA workplan review APPROVED WITH CONDITIONS (BD-16); workplan adjusted per SA-WR-26; awaiting SA code review.

## Overview

The owner's test (a Starter boost and a Basic subscription, both Stripe test mode, recorded correctly) showed nothing on the Finance page: the revenue panel and the paying read filter `livemode = true` (BD-10), and the account sat in **Comped**, because its plan tier was in force but its only billing row was test mode (S1C-F1). The user decided:

- **BD-14:** platform money counts test-mode and live-mode rows together, with no switch and no label.
- **BD-15:** a paying account is grouped under its paid tier, even with the Founding Partner (`champion`) cohort, with a Founding Partner note; a non-paying champion stays in Founding Partner.

Slice 1c is a **fix slice**: no migration, no new table, no new read, no new tile, no new route, no new query parameter. It changes three existing reads (R-c, R-c′, R-d) and renames them, the Section 1 classifier, the revenue panel copy, and the guards and tests that pinned the old behaviour.

Six points go to SA before code (SA-W41 to SA-W46, [below](#questions-for-sa-before-code)). Three are gaps between the requirement and the code (SA-W41, SA-W42, SA-W43); none reopens BD-14 or BD-15.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [The reads: R-c, R-c′, R-d (SA-Q21, SA-Q22, S1C-FR-1, S1C-FR-2)](#the-reads-r-c-r-c-r-d-sa-q21-sa-q22-s1c-fr-1-s1c-fr-2)
- [The renames: every caller (SA-Q22)](#the-renames-every-caller-sa-q22)
- [The classifier: paid tier, note, dormant (SA-Q20, SA-Q23, SA-Q24)](#the-classifier-paid-tier-note-dormant-sa-q20-sa-q23-sa-q24)
- [The builder and the picked business](#the-builder-and-the-picked-business)
- [K-3 and K-5](#k-3-and-k-5)
- [The page: panel copy, note and chip](#the-page-panel-copy-note-and-chip)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I opened every file below at `97c66132` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| Repository header: ACCOUNT SCOPE list names the three "Live" methods; "LIVE MODE (layer A only)" says R-c, R-c′, R-d filter `livemode = true`; PAGING says R-c keysets on `user_id` | `lib/repositories/BusinessOsFinanceReadRepository.ts:47-65`, `:67-72`, `:74-80` |
| `FinanceBillingStatusRow` = `user_id`, `subscription_status`, `ended_at` (no `id`, no `bought_tier`); `FinanceRevenueCounts` | `BusinessOsFinanceReadRepository.ts:89-99`, `:101-105` |
| `FINANCE_BILLING_STATUS_COLUMNS = 'user_id, subscription_status, ended_at'` | `BusinessOsFinanceReadRepository.ts:107-108` |
| `FINANCE_READ_LIMITS.BILLING_PAGE_SIZE 1000`, `BILLING_CEILING 20_000` (unchanged in 1c) | `BusinessOsFinanceReadRepository.ts:110-117` |
| `FinanceReadCeilingError` message "Live billing rows reached the read ceiling of …" | `BusinessOsFinanceReadRepository.ts:247-257` |
| **R-c** `listLiveBillingStatusesAllAccounts`: `.eq('livemode', true)`, `.not('user_id','is',null)`, `.gt('user_id', last)`, `.order('user_id')`; ceiling `>=` throws; info "Live billing statuses of all accounts read" | `BusinessOsFinanceReadRepository.ts:278-328` (`:307-313`, `:318`, `:320`, `:323`) |
| **R-c′** `findLiveBillingStatusForAccount`: UUID check, `.eq('user_id').eq('livemode', true).maybeSingle()`; returns one row or null | `BusinessOsFinanceReadRepository.ts:330-354` (`:340-345`) |
| **R-d** `countLiveRevenueRows`: two head counts, each `.eq('livemode', true)`; info "Live revenue rows counted" | `BusinessOsFinanceReadRepository.ts:356-389` (`:369`, `:374`, `:384`) |
| `business_os_billing_accounts`: `id uuid` primary key, `user_id uuid` nullable, `livemode boolean NOT NULL`, `bought_tier text` (1 to 64 chars), `UNIQUE (user_id, livemode)` | `supabase/migrations/20261025_business_os_billing_accounts.sql:5-30`, `:50` |
| `bought_tier` is written by the webhook from the price's lookup key, beside the plan row tier | `supabase/migrations/20261027_business_os_billing_events.sql:279`; `20261028_business_os_first_payment_stamp.sql:202` |
| `isPayingBillingRow` and `PAYING_SUBSCRIPTION_STATUSES` (unchanged); the header comment says "Live mode is the reader's job (the finance read filters `livemode = true`)" | `lib/business-os/billing/payingSubscriptionStatuses.ts:1-30` (`:4-6`, `:27`) |
| `groupFor`: `champion` → `founding_partner` by state; a tier-basis state not paying → `comped`; grace on a cohort → its cohort group via `stateForCohort` | `lib/business-os/finance/planGroups.ts:38-66` |
| `classifyAccounts`: `isPaying` from `payingIds.has(user_id)`; `foundingNoEndDate` counted only when `key === 'founding_partner'`; **`dormantFounding` counted for every row** (`isDormantChampion(row)`, no group check) | `planGroups.ts:116-185` (`:137-138`, `:150`, `:151`) |
| `seedGroups` builds `{ key, tierLabel, count, grace, pastDue }` | `planGroups.ts:74-92` |
| `planGroups.ts` imports from the entitlements module: `fromPlanRow`, `deriveLifecycle`, `stateForCohort`, `LifecycleResult`, `isDormantChampion`, `isOpenEndedCohort`, `lifecycleInputs`, `EntitlementConfig`, `LifecycleState` | `planGroups.ts:23-29` |
| Its `KNOWN_NON_GATE_IMPORTERS` entry lists exactly those nine symbols | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:496-510` |
| `stateForCohort(id)` returns `'champion'` for the champion cohort id | `lib/business-os/entitlements/lifecycle.ts:120-122` |
| `deriveLifecycle`: an unknown tier → `unknown`; **a tier in force wins outright** (`active`, tier basis); an expired tier with a live cohort resumes the cohort state; an expired tier with no live cohort → grace/lapsed on the **tier** basis | `lifecycle.ts:166-177`, `:190-200`, `:202-210`, `:211-245` |
| `isOpenEndedCohort(row)`, `isDormantChampion(row)` (champion, no end date, no profile) | `lib/business-os/entitlements/report.ts:663-675` |
| `FinanceGroupCount`, `FinanceAccountsFigures` | `lib/business-os/finance/financeTypes.ts:50-77` |
| Builder: `finance` Pick names the three methods; the picked-business branch wraps R-c′'s single row in an array; R-d; `payingIds` built from `isPayingBillingRow`; revenue state from the two counts; K-3 from `foundingNoEndDate`; K-5 headlines | `lib/business-os/finance/financeHealth.ts:169-173`, `:392-399`, `:457-463`, `:518-524`, `:708-723`, `:147-149` |
| Builder header: "the all-accounts billing read … The platform-wide revenue head count is the one deliberate exception" | `financeHealth.ts:14-25` |
| Wiring: the three method lines; header "live billing status and revenue head counts" | `lib/business-os/finance/financeHealthDeps.ts:113-115`, `:14` |
| The route names none of the three methods; its info line carries `sections.revenue` and `sections.accounts` | `app/api/admin/business-os/finance/route.ts:177-179` |
| Revenue copy: "…the payment webhook is not in place… test accounts only", "Live revenue has started to arrive…", "Live-mode plan invoices and paid boosts, all businesses" | `app/admin/finance/financeCopy.ts:53-58` |
| Accounts copy; `GROUP_LABELS.founding_partner = 'Founding Partner'` | `financeCopy.ts:60-87` |
| `RevenuePanel`: header comment "a live paid row exists"; renders `REVENUE_SUBTITLE` and the state text | `app/admin/finance/components/RevenuePanel.tsx:1-41` |
| `AccountsByPlanSection`: group rows (`:80-87`), no chip today | `app/admin/finance/components/AccountsByPlanSection.tsx:1-125` |
| `StatusChip({ tone, children, testId })`, renders `data-tone`; `neutral` has no icon | `app/admin/components/layout/StatusChip.tsx:25-28`, `:40-48`, `:56-64` |
| SA-WR-17 render test: `section-accounts` has no `[data-tone]` (fixture is all businesses) | `app/admin/finance/__tests__/financePage.render.test.tsx:588-594` |
| Render fixture groups (five `FinanceGroupCount` literals) | `financePage.render.test.tsx:278-296` (`:284-288`) |
| Render AC-22 / AC-39 panel tests | `financePage.render.test.tsx:371-384` |
| Repository test: `row()` helper; column + limits pin; **`livemode` pins at `:133`, `:196-199`, `:242-248`**; `maybeSingle` pin `:200`; R-c keyset test `:145-157` | `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts:100-104`, `:108-122`, `:124-186`, `:188-227`, `:229-265` |
| Repository test: no-write, no-aggregate, writer-name and **one-caller pins** (text match on the class name) | `BusinessOsFinanceReadRepository.test.ts:454-509` (`:483-508`) |
| Finance source guard: `FILES` (includes the repository and `payingSubscriptionStatuses.ts`), `codeOf` comment stripper | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:59-75` |
| Tier-literal rule from `config.tierOrder`; cohort-literal rules with `\b` and their planted control (SA-CR-1); only `planGroups.ts` and the wiring import the entitlements module | `finance.source.guard.test.ts:135-140`, `:142-153`, `:155-158` |
| `LAYER_B_METHODS`, `bodyOf` slicer, **`:321-326` the slicer's planted control**, `:328-332` the per-method no-`livemode` rule, **`:334-336` "the layer-A reads still filter livemode"** | `finance.source.guard.test.ts:295-336` |
| No-`livemode` / test-mode wording rules over the 2a files (`:361`), the 2b files (`:507`) and the 2b copy block (`:519`) | `finance.source.guard.test.ts:355-364`, `:507-520` |
| Builder test: `makeDeps` finance defaults (`:226-230`); paying read fails (`:371-379`); revenue describe AC-23 / AC-39 (`:416-433`); picked business (`:493-564`, incl. R-c′ mock `:556-563`); wiring key list (`:1073-1090`); 2b picked-business zero-calls list (`:1277`) | `lib/business-os/finance/__tests__/financeHealth.test.ts` |
| Classifier test: exhaustive `groupFor` (`:67-111`), the 12-row fixture with `tierAndCohort` paying (`:113-168`), **the shadow-report parity test** with no paying champion and no tier (`:195-225`) | `lib/business-os/finance/__tests__/planGroups.test.ts` |
| Route test: `mockDeps.finance` keys (`:81-83`), defaults (`:251-253`), `allReads()` spreads `Object.values(mockDeps.finance)` (`:273-283`), AC-42 through the route (`:443-454`) | `app/api/admin/business-os/finance/__tests__/route.test.ts` |
| Tier labels: `basic` shows as "Essentials", `pro` as "Autopilot" | `lib/business-os/entitlements/config/tierMatrix.ts:245`, `:259` |
| The tier-literal guard scans every test outside its listed `__tests__` prefixes, the finance tests included | `lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts:36-55` |
| The billing placement guard checks imports in `lib/business-os/billing/*.ts`, not comments | `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts:37`, `:979-1041` |

**Every caller of the three methods** (grep over `app`, `lib`, `components`, `hooks`, `scripts`, all `.ts` / `.tsx`): the repository, its test, `financeHealth.ts`, `financeHealthDeps.ts`, `financeHealth.test.ts`, `finance.source.guard.test.ts:335` and the route test. Docs that name them: this requirement and the 1a workplan (history, not edited).

`console.*` count in every file to modify: **0** (grep). The CLAUDE.md flag-and-convert rule has nothing to convert.

**Schema (business-os-schema-check).** The only new selected column is `bought_tier` on `business_os_billing_accounts` (BD-16: no `id`), in the migration above. `bought_tier` is in SQL check 1 and the user's live check of 2026-10-12. The worktree has no credentials for `npm run schema:check` (2a / 2b, FU-2b-6); V-10 records the note.

---

## Scope

Exactly the 1c rows of requirement §11B.1.

| In 1c | Out |
|---|---|
| R-d counts test and live paid plan invoices and paid boosts (S1C-FR-1) | Any amount, sum or chart of our revenue (slices 4, 5) |
| R-c and R-c′ read both modes, one row per account assumed (BD-16); two rows are an error (S1C-FR-2, SA-WR-27) | A test-mode switch or label (BD-14, S1C-FR-7) |
| The three renames, every caller, the repository header (SA-Q22) | Filtering test businesses or users (DF-3) |
| A paying champion goes to its paid tier's group (S1C-FR-3, SA-Q20); the Founding Partner note and the picked-view chip (S1C-FR-4, SA-Q24) | Boost credits in Section 4 (slice 4, S1C-FR-6) |
| K-3 and dormant count the Founding Partner group only (S1C-FR-5, SA-Q23) | Any change to the paying definition, BD-4, the "Tier set" fallback, the plan walk, Sections 3 and 4 logic (S1C-FR-6) |
| New revenue panel copy (§11B.3) | The page shell (DF-4), any shared-folder file |
| Guard edits with planted controls (§11B.5) | A KPI tile, a migration, an SQL function |
| ACs AC-75 to AC-86, and the re-runs in AC-83 / AC-84 | Editing the requirement MD (BA / TL) |

---

## Questions for SA before code

Numbering continues from 2b (SA-W40). Each has a recommendation, which I build unless SA rules otherwise.

| # | Issue | Recommendation |
|---|---|---|
| **SA-W41** | **Two paying rows with different `bought_tier`** (requirement gap). SA-Q20 falls back to `bought_tier` when the plan row has no valid tier, but an account can have **two** paying rows (test and live, both `active`) naming different tiers. SQL check 1 shows `max(bought_tier)`, an alphabetical pick. | Take the distinct `bought_tier` values of the account's **paying** rows that are in `config.tierOrder`. **Exactly one → that tier; none or more than one → Unknown/held** (never a guess, never dropped). A non-paying row's `bought_tier` is ignored. Check 1 is unchanged: this case needs a champion with no tier in force **and** two paying rows that disagree, which the live data does not have. If SA prefers, I add one ASCII comment line to check 1 via BA. |
| **SA-W42** | **Group-only dormant also drops a non-paying champion with a tier in force** (requirement gap). SA-Q23 says dormant counts the Founding Partner group only. Today `dormantFounding` counts every row (`planGroups.ts:151`). A champion whose tier is in force and who is **not** paying is in Comped (S1C-F4), so group-only also stops counting it, not only the paying champion S1C-F3 names. | **Apply SA-Q23 as written**: `key === 'founding_partner' && isDormantChampion(row)`, exactly like K-3 (`:150`). The label says "Dormant Founding Partners", and a row outside the group should not be in it. The parity test still holds unedited: its fixture has no tier and no paying row (`planGroups.test.ts:197-204`). The new S1C-F3 test covers both a paying dormant champion and a Comped dormant champion. |
| **SA-W43** | **SA-WR-17 vs SA-Q24.** The 2a render test says "the Accounts … sections render no chip" (`financePage.render.test.tsx:588-594`); SA-Q24 adds a `neutral` `StatusChip` to Section 1 in the picked view. The test stays green: its fixture is all businesses, and the chip only renders in the picked view. | **Do not edit the SA-WR-17 test.** It remains true for the all-businesses view, and no section **badge** (`section-accounts-badge`) is added. Add a new render test: the chip renders only with `scope: 'one'` and `foundingPartners > 0`, has words, and the all-businesses view shows the note as text with no `[data-tone]` in Section 1. |
| **SA-W44** | **Where the BD-15 override lives.** S1C-FR-3 says "an account the §8.1 mapping would place in Founding Partner". Putting it inside `groupFor` changes its signature and the exhaustive 1a `groupFor` tests (`planGroups.test.ts:67-111`). | **`groupFor` is unchanged.** `classifyAccounts` applies the override right after it: `if (key === 'founding_partner' && isPaying === true) key = paidTier ? tierKey(paidTier) : 'unknown_held'`. This catches both `champion` and grace on the champion cohort, and only when the paying read succeeded (a failed read keeps champions in Founding Partner, S1C-FR-6). `ClassifyInput` gains an **optional** `paidTierHints` map, so every 1a classifier test runs unedited. A new pure, exported `paidTierOf(planTier, hints, tierOrder)` holds SA-Q20 and is tested on its own. |
| **SA-W45** | **Two stale comments outside the slice's named files.** `payingSubscriptionStatuses.ts:4-6` says "the finance read filters `livemode = true`", and `:27` says "this live billing row". §11B.5 says the file is "not tripped", meaning its definition and test. | **Comment-only edit** (no code line changes): "Mode is not filtered: test and live rows both count (BD-14)". `payingSubscriptionStatuses.test.ts` and the billing placement guard run unchanged (V-5); the placement guard checks imports, not comments. If SA prefers zero edits there, I leave it and record a follow-up. |
| **SA-W46** | **AC-80 vs check 1 for a champion with an expired tier.** AC-80 says K-3 equals the sum of `no_cohort_end_date` over champion rows where `paying` is false **and `tier` is `(none)`**. A champion whose plan tier has **expired** while the cohort is live is in Founding Partner on the page (`lifecycle.ts:202-210`), but check 1 shows its stale `tier`, so the SQL sum leaves it out. This is the 1a QA-2 caveat in another form. | **No code change.** The page is right (the account is a Founding Partner now). V-11 states the caveat: the two match while no champion has an expired tier; if one does, it shows in check 1 under its tier with `paying = false` and must be added by hand. BA may add one ASCII comment line to check 1 if SA wants it in the requirement. |

---

## Analysis Summary

| Area | What changes |
|---|---|
| Finance read repository | R-c renamed `listBillingStatusesAllAccounts`, no mode filter, keyset on `user_id` unchanged, a duplicate `user_id` is an error (SA-WR-27); R-c′ renamed `findBillingStatusForAccount`, `.maybeSingle()` unchanged; R-d renamed `countRevenueRows`, no mode filter. Columns gain `bought_tier` (no `id`). Header rewritten for BD-14 / BD-16; log messages lose "Live" |
| Classifier (`planGroups.ts`) | `paidTierOf` (SA-Q20); the BD-15 override after `groupFor` (SA-W44); `foundingPartners` per group (SA-Q24); dormant by group (SA-Q23). No new entitlements import |
| Types (`financeTypes.ts`) | `FinanceGroupCount.foundingPartners: number` |
| Builder (`financeHealth.ts`) | Pick and calls renamed; R-c′ list used directly; paid-tier hints built from paying rows; header comments |
| Wiring (`financeHealthDeps.ts`) | Three renamed lines; header line |
| Page | Revenue copy (§11B.3); `AccountsByPlanSection` note and picked-view chip; `RevenuePanel` header comment |
| Guards and tests | Repository `livemode` pins inverted; source guard control replaced (SA-Q22) plus AC-81 wording rules; classifier, builder, route and render tests (§ Guard table) |
| Tables read | Unchanged: `business_os_billing_accounts`, `business_os_billing_events`, `business_os_boost_purchases` (and the layer-B tables, untouched) |
| Knock-on, by design | Section 3 "By current plan group" follows the new grouping (it reads `groupByAccount`); its BD-8 note already says "the plan each account is on now". No code change there |
| Not touched | Layer-B reads and blocks, Section 3 and Section 4 logic, the KPI strip and rules data, the URL and filter bar, the route, the shared layout folder, the entitlements module, the payment writers, every Stripe file, the Businesses list |

---

## Implementation Approach

1. **Repository first.** Rename and change the three reads, rewrite the header, then update the repository test (pins inverted, duplicate-row error cases added). The no-write, no-aggregate, writer-name, SA-WR-19, SA-W40 and one-caller pins stay byte-identical.
2. **Every caller in one step** (builder Pick and calls, wiring, builder test, route test, source guard), so nothing is half-renamed; `tsc` proves it (V-8).
3. **Pure classifier** next: `paidTierOf`, the override, `foundingPartners`, dormant by group, with new tests. The 1a classifier tests run unedited (SA-W44).
4. **Builder** builds the hints; picked-business branch simplified.
5. **Page**: copy, note, chip; render tests.
6. **Guards last**, each new rule with a planted control (2b retrospective, conclusion 1).
7. **No new pattern.** The reads keep their shape (BD-16); the duplicate error mirrors the ceiling error; the chip is the shared `StatusChip`; the note is copy. No new dependency, no new file.

---

## Files to Create / Modify

### Create

None. Every new test goes into an existing test file.

### Modify

| File | Change |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | Header `:47-80` (ACCOUNT SCOPE names, "LIVE MODE" paragraph → BD-14 / BD-16 paragraph, PAGING); `FinanceBillingStatusRow` + `bought_tier` (`:89-99`); new `FinanceReadDuplicateError` (SA-WR-27); `FINANCE_BILLING_STATUS_COLUMNS` (`:107-108`); `FinanceRevenueCounts` doc (`:101`); `FinanceReadCeilingError` message (`:254`); R-c (`:278-328`), R-c′ (`:330-354`), R-d (`:356-389`) |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Doc `:1-10`; `row()` (`:100-104`); column pin (`:108-116`); R-c describe (`:124-186`), R-c′ describe (`:188-227`), R-d describe (`:229-265`); new AC-85 duplicate-row error cases (SA-WR-27, SA-WR-28). **`:266-` onwards (2a, 2b, source guards, SA-WR-19, SA-W40) not edited** |
| `lib/business-os/finance/planGroups.ts` | `paidTierOf`; `ClassifyInput.paidTierHints?`; override after `groupFor`; `foundingPartners`; dormant by group; header lines |
| `lib/business-os/finance/__tests__/planGroups.test.ts` | New describes: `paidTierOf` (AC-86), paying champion cases (AC-78, AC-79, AC-80, AC-85), the note counts, dormant S1C-F3. **`:1-225` not edited** |
| `lib/business-os/finance/financeTypes.ts` | `FinanceGroupCount.foundingPartners` (`:52-61`) |
| `lib/business-os/finance/financeHealth.ts` | Header `:14-25`; K5 comment `:147`; Pick `:171-173`; calls `:392-399`; hints and `payingIds` `:457-463`; revenue comment `:518` |
| `lib/business-os/finance/financeHealthDeps.ts` | `:14` header; `:113-115` |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | Renames (`:226-230`, `:373`, `:419`, `:428`, `:499`, `:522-534`, `:558`, `:1076-1084`, `:1277`); revenue describe → AC-75 to AC-77; new AC-78, AC-80, AC-82 builder cases |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Doc `:1-40` (a 1c paragraph); replace `:334-336` (SA-Q22); new AC-81 wording rules; no other rule edited |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Renames `:81-83`, `:251-253`, `:448-452`; AC-82 two-row case through the route: R-c′ error → 200 with the "Tier set" fallback (SA-WR-28) |
| `app/admin/finance/financeCopy.ts` | `REVENUE_NONE_YET`, `REVENUE_RECORDED`, `REVENUE_SUBTITLE` (`:54-58`); `accountsFoundingNote(n)`, `ACCOUNTS_FOUNDING_CHIP`; header line |
| `app/admin/finance/components/AccountsByPlanSection.tsx` | The note in the group label cell; the picked-view chip; header line |
| `app/admin/finance/components/RevenuePanel.tsx` | Header comment only (`:3-7`: "a paid row exists, test or live", BD-14) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture `:284-288` gains `foundingPartners: 0`; AC-22 → AC-77 wording; new AC-75 / AC-81 / AC-78 note / AC-82 chip cases |
| `lib/business-os/billing/payingSubscriptionStatuses.ts` | **Comment only** (`:4-6`, `:27`), if SA approves SA-W45 |

**Not modified, on purpose:** `lib/repositories/index.ts` (same exported names); `route.ts`; `FinanceKpiStrip.tsx`, `financeRules.ts` (K-3 / K-5 rules data unchanged); `FinanceSection.tsx`; every layer-B file; `report.ts`, `lifecycle.ts`, the whole entitlements module and its tests; `enforcementPoints.test.ts` (imports unchanged, see below); `payingSubscriptionStatuses.test.ts`; the shared layout folder; the requirement MD.

---

## The reads: R-c, R-c′, R-d (SA-Q21, SA-Q22, S1C-FR-1, S1C-FR-2)

> Re-planned for **BD-16** (SA-WR-26): one billing record per account is assumed. Both billing reads keep their current shape and drop **only** the mode filter. No keyset on `id`, no `.limit(2)` list, no `id` column.

### Columns and row type

```typescript
/** One billing-account row, test or live mode (BD-14), one per account (BD-16): who, which status, ended or not, which tier was bought. */
export interface FinanceBillingStatusRow {
  user_id: string;
  subscription_status: string | null;
  ended_at: string | null;
  /** The tier named by the paid price (SA-Q20 fallback). Free text here; the classifier compares it with config.tierOrder only. */
  bought_tier: string | null;
}

export const FINANCE_BILLING_STATUS_COLUMNS = 'user_id, subscription_status, ended_at, bought_tier';
```

No mode column is selected: the page never splits by mode (S1C-FR-7). `FINANCE_READ_LIMITS` is unchanged.

### R-c `listBillingStatusesAllAccounts(opts?)` (was `listLiveBillingStatusesAllAccounts`)

- Unchanged shape: `.not('user_id', 'is', null)`, `.gt('user_id', last)` after the first page, `.order('user_id', { ascending: true }).limit(size)`. **Only the mode filter is dropped.** With one row per account, `user_id` is a unique key, so a page boundary loses nothing.
- Ceiling `>=` is still an error (`FinanceReadCeilingError`, 20,000), never a partial list.
- **SA-WR-27:** after the loop, if any `user_id` occurs twice among the rows read, return `{ data: null, error: FinanceReadDuplicateError }`, logged at `error` with counts only through `fail` (the same path as the ceiling). The builder then shows "Tier set". Residual (recorded): a second row exactly past a page boundary is skipped by `.gt` and not detected; this needs a dual-row account at a 1,000-row boundary, which BD-16 says will not exist.
- Info: `{ method: 'listBillingStatusesAllAccounts', rows, durationMs }`, message "Billing statuses of all accounts read". Counts only.

### R-c′ `findBillingStatusForAccount(accountId)` (was `findLiveBillingStatusForAccount`)

- UUID check first, refused at `warn` before any query (unchanged).
- `.eq('user_id', accountId).maybeSingle()` unchanged; only the mode filter is dropped. Returns `RepositoryResult<FinanceBillingStatusRow | null>`.
- Two rows: PostgREST's `maybeSingle` error is returned as `{ data: null, error }`, never thrown (SA-WR-28). The builder logs `paying_status` and Section 1 shows "Tier set" with Founding Partner untouched.
- Debug: `{ method, found }`, message "Billing status of one account read". Never the id at info.

### R-d `countRevenueRows()` (was `countLiveRevenueRows`)

- Billing events: `.select('id', { count: 'exact', head: true }).eq('kind', 'invoice_paid')`.
- Boosts: `.select('id', { count: 'exact', head: true }).not('paid_at', 'is', null)`.
- Still two head counts, still no argument, still no amount; a missing count is an error, never 0 (unchanged).
- Info: `{ method: 'countRevenueRows', planInvoicesPaid, boostsPaid }`, "Revenue rows counted".

### Header rewrite (S1C-F5)

- ACCOUNT SCOPE list: the three new names.
- The "LIVE MODE (layer A only)" paragraph becomes **"TEST AND LIVE MODE (BD-13, BD-14, BD-16)"**: no read in this file filters by mode. Layer A counts test and live rows together and treats them as real (BD-14); layer B has no mode at all (BD-13). One billing record per account is assumed (BD-16); if two ever appear, R-c and R-c′ return an error, never a figure. Its code never names the mode column (pinned by the finance source guard).
- PAGING: unchanged ("R-c pages by keyset on `user_id` …"), plus the duplicate error.
- The "payment plan repository" and "payment reminder repository" words (SA-W40 test) and "THIS FILE NEVER READS THE REMINDER QUEUE" stay.

### Repository test changes (T1)

| Lines | Change |
|---|---|
| `:1-10` doc | "live mode only" → "no mode filter (BD-14), one row per account (BD-16)" |
| `:100-104` `row()` | Gains `bought_tier` (default `null`); **no tier literal** (the tier-literal guard scans this file): a pass-through value such as `'tier-from-price'` |
| `:108-116` | Column list pin = `['user_id', 'subscription_status', 'ended_at', 'bought_tier']`; the `FINANCE_READ_LIMITS` equality is unchanged |
| `:124-186` R-c | Renamed. `:133` becomes `expect(argsOf(q, 'eq')).toEqual([])` and the query names no `livemode`; order and keyset on `user_id` unchanged. **New (SA-WR-27, AC-85):** two rows with one `user_id` → `{ data: null, error: FinanceReadDuplicateError }`, logged at `error` with counts only |
| `:188-227` R-c′ | Renamed. `eq` = `[['user_id', A]]` (`:196-199`); `maybeSingle` still called (`:200`). **New (SA-WR-28, AC-85):** the mocked `maybeSingle` error (two rows) is returned as `{ data: null, error }`, never thrown. Refusal and not-at-info tests: only the name changes |
| `:229-265` R-d | Renamed. `:242` comment (AC-23) removed. Events `eq` = `[['kind', 'invoice_paid']]`; boosts `eq` = `[]`, `not` = `[['paid_at', 'is', null]]`; neither query names `livemode`. The three failure cases: only the name changes |
| `:266-773` | **Not edited** (2a, 2b, no-write, no-aggregate, writer names, one-caller pin, SA-WR-19, SA-W40) |

The one-caller pin (`:483-508`) matches the class name in text; the renames do not change who names the class.

---

## The renames: every caller (SA-Q22)

| Old | New | Every place it appears (file:line) |
|---|---|---|
| `listLiveBillingStatusesAllAccounts` | `listBillingStatusesAllAccounts` | Repository `:52`, `:287`, `:291`; repo test `:124`, `:127`, `:139`, `:148`, `:160`, `:174`, `:182`; `financeHealth.ts:171`, `:398`; `financeHealthDeps.ts:113`; `financeHealth.test.ts:226`, `:373`, `:522`, `:1084`, `:1277`; route test `:81`, `:251`, `:448`; source guard `:335` (removed by SA-Q22) |
| `findLiveBillingStatusForAccount` | `findBillingStatusForAccount` | Repository `:58`, `:334`, `:335`; repo test `:188`, `:191`, `:205`, `:215`, `:224`; `financeHealth.ts:172`, `:395`; `financeHealthDeps.ts:114`; `financeHealth.test.ts:229`, `:526`, `:558`, `:1077`; route test `:82`, `:252`, `:450` |
| `countLiveRevenueRows` | `countRevenueRows` | Repository `:64`, `:362`, `:363`; repo test `:229`, `:236`, `:261`; `financeHealth.ts:173`, `:399`; `financeHealthDeps.ts:115`; `financeHealth.test.ts:230`, `:419`, `:428`, `:499`, `:534`, `:1076`; route test `:83`, `:253`, `:452` |

After the edit, `grep -rn "LiveBillingStatus\|countLiveRevenueRows" app lib components hooks scripts` must return nothing (V-9). The 1a workplan and the requirement keep the old names as history.

The wiring key-list test (`financeHealth.test.ts:1073-1090`) is sorted: the three new names take their sorted places (`countRevenueRows`, `listBillingStatusesAllAccounts`, `findBillingStatusForAccount`).

---

## The classifier: paid tier, note, dormant (SA-Q20, SA-Q23, SA-Q24)

All in `planGroups.ts`, pure, config passed in (SA-WR-4). **No new import from the entitlements module.**

### `paidTierOf` (SA-Q20; SA-W41 moot under BD-16; SA-WR-29)

```typescript
/**
 * SA-Q20: the tier a PAYING champion is grouped under. The plan row's tier
 * in force first; otherwise the tier its billing row bought, if valid;
 * otherwise null (Unknown/held). Values are compared with config.tierOrder
 * only: no tier is written here.
 */
export function paidTierOf(
  planTier: string | null,
  boughtTier: string | null | undefined,
  tierOrder: readonly string[]
): string | null {
  if (planTier && tierOrder.includes(planTier)) return planTier;
  if (boughtTier && tierOrder.includes(boughtTier)) return boughtTier;
  return null;
}
```

- The plan row wins when both are valid and differ (AC-86).
- A blank or unknown `bought_tier` is ignored, never trusted → Unknown/held.
- One row per account (BD-16), so one `bought_tier`; two rows are an error before this point (SA-WR-27).

### The override (S1C-FR-3, SA-W44)

```typescript
// ClassifyInput gains:
/** Paying accounts' bought tier (from the paying billing row only); optional, so absent = none known. */
paidTierHints?: ReadonlyMap<string, string>;

// In the loop, right after groupFor:
let key = groupFor(lifecycle, isPaying);
// BD-15: a paying account the §8.1 table would place in Founding Partner
// (champion, or grace on the champion cohort) goes to its paid tier.
if (key === 'founding_partner' && isPaying === true) {
  const tier = paidTierOf(row.tier, input.paidTierHints?.get(row.user_id), config.tierOrder);
  key = tier ? tierKey(tier) : 'unknown_held';
}
if (!groupIndex.has(key)) key = 'unknown_held'; // unchanged backstop
```

- A tier in force already maps through the tier basis (S1C-F1): BD-14 alone moves the owner account from Comped to its tier group, with no override.
- `isPaying === null` (the paying read failed) is never overridden: champions stay in Founding Partner, the tier groups fold into "Tier set" (S1C-FR-6).
- Every account is still in exactly one group, and the groups sum to Total (AC-12).

### The note count (SA-Q24, S1C-FR-4)

```typescript
// Written as `!!cohort`, never `cohort !== ''`: the cohort-literal rule
// (`finance.source.guard.test.ts:144`) matches `cohort !== '…'` (checked with node).
const isChampionCohort = (cohort: string | null) => !!cohort && stateForCohort(cohort) === 'champion';
// in the loop:
if (key.startsWith('tier:') && isChampionCohort(row.cohort)) group.foundingPartners += 1;
```

- `foundingPartners` is seeded `0` on every group in `seedGroups`.
- It counts every account in a **tier group** with the champion cohort, so it covers the owner account (tier in force) and the account that left Founding Partner. A tier group holds paying accounts only, so it is never a non-paying account.
- `'champion'` here is a `LifecycleState` value returned by `stateForCohort`, not a cohort id (SA-W3, SA-F6). I ran both cohort-literal regexes (`finance.source.guard.test.ts:144-145`) in node: `stateForCohort(cohort) === 'champion'` and `!!cohort && …` match neither; **`cohort !== ''` matches the first**, so that form is banned in the implementation. V-1 runs the real rules.

### Dormant and K-3 (SA-Q23, S1C-FR-5, SA-W42)

- `foundingNoEndDate`: unchanged code (`key === 'founding_partner' && isOpenEndedCohort(row)`, `:150`); a paying champion now leaves the group, so it is no longer counted.
- `dormantFounding`: becomes `key === 'founding_partner' && isDormantChampion(row)` (was every row, `:151`).
- `endingIn30Days`: unchanged.

### Classifier tests (T2, appended to `planGroups.test.ts`; `:1-225` not edited)

Tier and cohort ids come from `config` only (`TIER = config.tierOrder[0]`, a second tier `config.tierOrder[1]`, `CHAMPION` via `stateForCohort`); the invalid tier is `'not-a-tier'`, as `:131` already does.

| Test | Proves |
|---|---|
| `paidTierOf`: plan tier valid → plan tier; plan tier valid and bought tier differs → plan tier; plan null, valid bought → bought; plan invalid, bought valid → bought; bought invalid → null; both absent → null | AC-86, SA-WR-29 |
| (a) champion, **tier in force**, paying → `tier:TIER`, `foundingPartners` 1, Comped 0 | AC-78 (a), S1C-F1 |
| (a′) same, not paying → Comped, no note | AC-78 (a) contrast, BD-4 |
| (b) champion, **no tier**, paying, hint `TIER2` → `tier:TIER2`, note 1, Founding Partner 0 | AC-78 (b) |
| (b′) champion, expired plan tier, live cohort, paying, hint names another tier → the plan tier wins | AC-86 |
| (b″) champion, no tier, paying, no hint → `unknown_held`, no note | AC-86 |
| grace on the champion cohort, paying → its paid tier | S1C-FR-3 |
| not paying (absent; `canceled`; `active` with `ended_at`) → Founding Partner, no note. The billing rows go through `isPayingBillingRow` in the builder test; here `payingIds` excludes them | AC-79 |
| paying read failed (`payingIds: null`) with a paying-looking hint → Founding Partner, "Tier set" | S1C-FR-6 |
| K-3: open-ended champions, one of them paying → `foundingNoEndDate` counts only the non-paying ones | AC-80 |
| **S1C-F3:** a paying dormant champion and a Comped dormant champion (tier in force, not paying) → `dormantFounding` 0; a plain dormant champion → 1 | SA-Q23, SA-W42 |
| Sum to Total over a mixed fixture including every new case | AC-12, AC-84 |
| The 1a parity test (`:195-225`) **runs unedited**: its fixture has no paying champion and no tier | S1C-F3 |

---

## The builder and the picked business

### All businesses

```typescript
const payingRows = payingResult.data ? payingResult.data.filter(isPayingBillingRow) : null;
const payingIds = payingRows ? new Set(payingRows.map((row) => row.user_id)) : null;
// SA-Q20 fallback: the bought tier of the PAYING row only, per account (validated in the classifier).
const paidTierHints = new Map<string, string>();
for (const row of payingRows ?? []) {
  if (row.bought_tier) paidTierHints.set(row.user_id, row.bought_tier);
}
classifyAccounts({ rows, payingIds, paidTierHints, window, now, config: deps.config });
```

- One row per account (BD-16): an account is paying when its row passes `isPayingBillingRow`. Two rows never reach here: R-c returns an error (SA-WR-27) and Section 1 shows "Tier set".
- No new constant and no new paying definition (S1C-FR-2).

### One business picked (SA-W1, AC-42, AC-82)

- `settle(() => deps.finance.findBillingStatusForAccount(accountId))` , the single row still wrapped in an array as today (`:394-397`).
- Unchanged: the plan check first; zero calls on `pagePlans`, R-c and every other all-accounts read; R-d called with **no argument** (the one platform-wide exception, head counts, no account).
- Two rows make R-c′'s `maybeSingle` fail: the paying read errors, the champion stays in Founding Partner, Section 1 shows "Tier set" with no note (BD-16, SA-WR-28). Never a wrong group.

### Builder tests (T3, `financeHealth.test.ts`)

| Test | Proves |
|---|---|
| Renames everywhere (§ renames) | SA-Q22 |
| Revenue describe (`:416-433`) becomes AC-75 / AC-76 / AC-77 / AC-39: a test-mode invoice count of 1 → `recorded` and K-5 "Revenue recorded, not yet shown"; a boost count of 1 → same; 0 and 0 → `none_yet`, K-5 grey "None yet"; failure → unknown (unchanged). The test-vs-live distinction lives in the repository test: the builder receives counts only | AC-75 to AC-77 |
| All businesses: plan row champion with tier in force, R-c returns its one `active` row → its tier group with note 1; Comped 0 | AC-78 (a) |
| All businesses: champion, no tier, paying row with `bought_tier = config.tierOrder[1]` → that tier group, note 1; K-3 does not count it | AC-78 (b), AC-80, AC-86 |
| Picked: plan row champion with tier in force, R-c′ returns its `active` row → tier group count 1, `foundingPartners` 1, K-3 value 0; R-c′ called with exactly the id; R-c and `pagePlans` not called; R-d `toHaveBeenCalledWith()` | AC-82 |
| Picked: R-c′ returns an error (two rows) → the champion stays in Founding Partner, "Tier set", no note (SA-WR-28) | AC-82, AC-85 |
| The existing picked-business test (`:511-544`) and AC-41 (`:546-554`) pass with only the rename | AC-42 re-run |

---

## K-3 and K-5

- **K-3:** no code change. `foundingNoEndDate` already counts by group (`planGroups.ts:150`); BD-15 moves paying champions out of the group. With a business picked, a paying champion reads 0, "not an open-ended Founding Partner" (AC-82). The rule data (`financeRules.ts`) is unchanged.
- **K-5:** no code change. Same three states and headlines (`financeHealth.ts:147-149`, `:718-723`); the definition change ("test and live mode together") is requirement text only, because S1C-FR-7 forbids test-mode wording on the page.

---

## The page: panel copy, note and chip

### Copy (`financeCopy.ts`, §11B.3)

| Constant | New text |
|---|---|
| `REVENUE_NONE_YET` | "None yet. No plan payment or credit boost has been recorded." |
| `REVENUE_RECORDED` | "Revenue has been recorded. Amounts are shown in a later update." |
| `REVENUE_COULD_NOT_CHECK` | "Could not check" (unchanged) |
| `REVENUE_SUBTITLE` | "Paid plan invoices and paid boosts, all businesses" |
| `accountsFoundingNote(n)` (new) | "including 1 Founding Partner" / "including N Founding Partners" |
| `ACCOUNTS_FOUNDING_CHIP` (new) | "Founding Partner" |

"None yet" is a claim about **all** rows: R-d is an exact head count, never capped, so the claim is backed by a complete read (2b retrospective, conclusion 4). No amount, no `$0`, no chart (unchanged).

### `AccountsByPlanSection.tsx` (SA-Q24, no new column)

- In the group label cell (`:82`), after `groupLabel(g)`:
  - all businesses, `g.foundingPartners > 0`: a muted span with `accountsFoundingNote(g.foundingPartners)`, text only;
  - picked business (`accounts.scope === 'one'`), `g.foundingPartners > 0`: `<StatusChip tone="neutral" testId={\`accounts-founding-chip-${g.key}\`}>{ACCOUNTS_FOUNDING_CHIP}</StatusChip>`.
- The chip has words, so state is never colour alone. `StatusChip` comes from `@/app/admin/components/layout/StatusChip` (as `FinanceSection.tsx:18`); the page guard allows it (only `lib/business-os/finance/` imports must be type-only).
- No section badge, no new column, no tier name in the file (labels from the server).

### Render tests (T4, `financePage.render.test.tsx`)

| Test | Proves |
|---|---|
| Fixture `:284-288` gains `foundingPartners: 0` | Type change |
| `:371-378` AC-22 → AC-77: the new none-yet sentence; no `$`, `USD` or `0.00` in the panel or on K-5 | AC-77 |
| New: `revenue.state: 'recorded'` → "Revenue has been recorded", K-5 headline as served | AC-75, AC-76 (render half) |
| New AC-81: in every revenue state, the panel text and subtitle match none of `webhook`, `not in place`, `test accounts only`, `live mode`, `test mode`, `livemode` (case-insensitive) | AC-81 |
| New: all businesses, a tier group with `foundingPartners: 1` → "including 1 Founding Partner" in that row; `section-accounts` has no `[data-tone]` | AC-78 render, SA-W43 |
| New: picked, same group → the chip with words, `data-tone="neutral"`; no note sentence | AC-82, SA-Q24 |
| SA-WR-17 (`:588-594`) **unedited** | SA-W43 |

---

## Entitlements registration check

Following the `business-os-entitlements` skill, row by row:

| Tripwire | 1c |
|---|---|
| A file outside the module **newly** imports from it | **No.** `planGroups.ts` keeps exactly its nine symbols (`stateForCohort` is already imported, `:25`); `financeHealth.ts` and `financeHealthDeps.ts` import nothing new; `AccountsByPlanSection.tsx` imports nothing from the module. The finance guard's "only `planGroups.ts` and the wiring import the module" (`finance.source.guard.test.ts:155-158`) holds |
| A listed file's symbol set changes | **No.** The `enforcementPoints.test.ts:496-510` entry stays exact; not edited |
| A tier name as a literal | **None.** `paidTierOf` compares with `config.tierOrder`; tests take tiers from `config.tierOrder`; the repository test's `bought_tier` is a pass-through string that is not a tier id. `tierLiteral.forbidden` and the finance tier rule (`:135-140`) prove it |
| A capability id literal, a catalog or matrix change | None |
| A gate | None: display only, refuses nothing |

`npm run test:bos-entitlements` runs before handover (V-3), because the diff touches a registered importer (`planGroups.ts`) and the repository test, which that suite includes.

---

## Tenant isolation check

Following the `tenant-isolation-guard` skill:

- **Service role, caller-supplied id:** yes, `accountId`, already validated as a UUID by the route behind `requireAdmin`. The repository refuses a malformed id before any query (unchanged) and R-c′ filters `.eq('user_id', accountId)` on its one query.
- **No write**, no trigger, no upsert, no payload: the guard's write half does not apply. The no-write pin is unedited.
- **Picked business:** every account-scoped read receives exactly that id; no all-accounts read runs (AC-42 re-run in T3 and the route test). R-d stays the one documented platform-wide exception: two head counts, no account, no amount.
- **New column `bought_tier`:** a tier id from a Stripe lookup key, not client or admin text; it travels only as a group key after validation against `config.tierOrder`, and it is never logged.
- **Mode filter removed:** cannot cross tenants; R-c′'s `.eq('user_id')` holds. Two rows for one account are an error (BD-16, SA-WR-27, SA-WR-28).

---

## Guard table, line by line

| Guard | Does 1c trip it? | Exact change |
|---|---|---|
| `BusinessOsFinanceReadRepository.test.ts:133` (R-c `eq` = `[['livemode', true]]`) | **Yes** | Becomes `eq` = `[]` plus the query names no `livemode`; order and keyset on `user_id` unchanged; new duplicate-row error case |
| Same file `:196-199` (R-c′ `eq` includes `['livemode', true]`) and `:200` (`maybeSingle` called) | **Yes** | `eq` = `[['user_id', A]]`; `maybeSingle` still called; new two-row error case |
| Same file `:242-248` (R-d `livemode` pins, AC-23 comment) | **Yes** | Events `eq` = `[['kind', 'invoice_paid']]`; boosts `eq` = `[]`; comment removed |
| Same file `:108-116` (column list pin) | **Yes** | Four columns (`bought_tier` added). `FINANCE_READ_LIMITS` equality unchanged |
| Same file no-write, no-aggregate, writer-name, **one-caller** (`:454-509`), SA-WR-19, SA-W40 | **No** | Not edited; run |
| `finance.source.guard.test.ts:334-336` ("the layer-A reads still filter livemode") | **Yes, by design (SA-Q22)** | **Replaced** by: `expect(codeOf(REPOSITORY)).not.toMatch(/livemode/)`. **Planted control:** a planted source `"// livemode in a comment\nconst a = 1;"` passes through `codeOf`'s stripper with no match, and `"q.eq('livemode', true)"` matches, so the rule bites on code and not on prose. Implemented with a small `stripComments(text)` helper shared with `codeOf` so the control runs the same stripper |
| Same file `:321-326` (the body-slicer planted control) | **No** | **Kept** unchanged (SA-Q22); it still proves `bodyOf` for the layer-B per-method rule (`:328-332`), which also stays |
| Same file `:361`, `:507`, `:519` (no `livemode` / test-mode wording in the 2a, 2b files and the 2b copy block) | **No** | Run unchanged. The new copy follows S1C-FR-7 |
| Same file, **new AC-81 rules** | Added | (a) Over every `app/admin/finance/**` file and `financeHealth.ts`, code without comments: no `/webhook\|not in place\|test accounts only/i`. (b) Over every file in `FILES`, code without comments: no `/livemode\|test.?mode\|live.?mode/i` (after 1c this holds for the whole page, the repository included). Planted controls: the old `REVENUE_NONE_YET` text matches (a); `'Live-mode plan invoices'` matches (b); `'deliver'` and `'alive'` do not match (b) |
| Same file cohort-literal rules (`:142-153`) | **No** | `stateForCohort(cohort) === 'champion'` matches neither regex; run |
| Same file tier-literal rule (`:135-140`) and "only `planGroups.ts` and the wiring import the module" (`:155-158`) | **No** | Run |
| Same file positive table pin (8 tables) | **No** | Same tables; run |
| `planGroups.test.ts` parity with `buildShadowReport` (`:195-225`) | **No, by construction** (S1C-F3) | Fixture has no paying champion and no tier; not edited. The separate S1C-F3 test is added |
| `planGroups.test.ts` `groupFor` exhaustive and §8.1 table (`:67-111`), 12-row fixture (`:113-192`) | **No** (SA-W44) | Not edited; `groupFor` unchanged, `paidTierHints` optional |
| The 1a revenue tests: builder AC-23 / AC-39 (`financeHealth.test.ts:416-433`), render AC-22 / AC-39 (`financePage.render.test.tsx:371-384`) | **Yes** | AC-23 → AC-75 to AC-77; AC-22 → AC-77 text; AC-39 unchanged but renamed method |
| S1-FR-26 / S1-FR-27 behaviour (R-d live-only) | **Yes** | Superseded by S1C-FR-1: proven in T1 (no mode in either query) and T3 (counts → state) |
| `financeHealth.test.ts` wiring key list (`:1073-1090`) | **Yes** (names) | Three names replaced, sorted |
| Route test `:81-83`, `:251-253`, `:448-452` | **Yes** (names) | Renamed; `allReads()` (`:273-283`) uses `Object.values`, so it needs no edit |
| `enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`, `:496-510`) | **No** | Imports unchanged; not edited. `test:bos-entitlements` proves it |
| `tierLiteral.forbidden.test.ts` | **No** | No tier literal in code or tests |
| `lib/business-os/entitlements/__tests__/report.test.ts`, `dormantChampions.test.ts` | **No** | `report.ts` untouched; run unchanged |
| `payingSubscriptionStatuses.test.ts` | **No** | Definition unchanged; run unchanged (comment edit only, SA-W45) |
| Stripe placement guards (`routerPlacement`, `invoiceIntentsStayUnowned`, `planSurfaces`) | **No** (SA-Q16) | Run unchanged and paste. `routerPlacement` reads `lib/business-os/billing/*.ts` imports; the SA-W45 edit is comment-only |
| RC-15 (`businessOsEntitlements.imports.guard`), ledger caller list, G3, `creditFigures`, `accountSeam`, N-10, `adminReadMethods`, jobs-queues isolation | **No** | No new repository name, no new import; run in V-3 / V-5 |
| `app/admin/finance/__tests__/source.guard.test.ts` | **No** | `AccountsByPlanSection.tsx` gains a shared-layout import only |
| Shared layout folder guard (`layoutFolder.guard`) | **No** | No file in the folder changes |
| Admin authz surface guard | **No** | No route or page added |

**No new CI job and no added PR critical-path time.** Every changed test runs in the existing Jest gate; the repository test also runs in `test:bos-entitlements`.

---

## AC mapping

T-numbers:
- **T1** `BusinessOsFinanceReadRepository.test.ts`
- **T2** `planGroups.test.ts`
- **T3** `financeHealth.test.ts`
- **T4** `financePage.render.test.tsx`
- **T5** `finance.source.guard.test.ts`
- **T6** finance `route.test.ts`

QA = a recorded manual step; V-11 = the user's SQL checks.

| AC | Test / check |
|---|---|
| **AC-75** | T1: R-d's event query names no `livemode` (`eq` = `[['kind', 'invoice_paid']]`). T3: invoice count 1, boosts 0 → `recorded`, K-5 "Revenue recorded, not yet shown". T4: "Revenue has been recorded". V-11 check 6 |
| **AC-76** | T1: the boost query names no `livemode`. T3: boosts 1 → `recorded`. T4 as AC-75 |
| **AC-77** | T3: 0 and 0 → `none_yet`, K-5 grey "None yet". T4: the new sentence; no `$`, `USD`, `0.00`, no chart |
| **AC-78** | T2 (a), (a′), (b); T3 all businesses (a) with two rows and (b); T4 note render. QA: the owner account under Essentials (config tier `basic`) with the note |
| **AC-79** | T2 not-paying cases (absent, `canceled`, `active` with `ended_at`); T3 the `isPayingBillingRow` filter over real-shaped rows; no note |
| **AC-80** | T2 K-3 case; T3 K-3 value with a paying champion. V-11 check 1 (with the SA-W46 caveat) |
| **AC-81** | T4 render over every revenue state; T5 the two new wording rules with planted controls |
| **AC-82** | T3 picked: tier group, chip data, K-3 0, R-c′ gets exactly the id, R-d with no argument, no all-accounts read, two rows → "Tier set" (SA-WR-28); T4 the chip; T6 the two-row case through the route (200 with the fallback) |
| **AC-83** (re-run) | T6 `authz` describe (`:294-330`) unchanged: 401, 403 (incl. `profiles.role`-only), zero calls on every read in `allReads()` (renamed reads included via `Object.values`); the page under `requireAdminPage` (authz guard, V-4) |
| **AC-84** (re-run) | AC-12: T2 sum-to-Total with every new case. AC-28: no write verb (T1, T5 unedited), V-9 no `supabase/migrations` path. AC-30: § Logging, T1 log assertions. AC-31: the guard table above, V-3 to V-6. AC-44: V-8. QA: the manual check (L-42 to L-45) |
| **AC-85** | T1 R-c duplicate `user_id` → `FinanceReadDuplicateError`, no data; T1 R-c′ `maybeSingle` error returned, not thrown; T3 picked two-row error → "Tier set", no note; T6 through the route |
| **AC-86** | T2 `paidTierOf` table and (b′), (b″); T5 / `tierLiteral.forbidden` no tier literal |

---

## Verification plan

The worktree has the `node_modules` junction. Never `git worktree remove`, never `git stash`, never `npm install` through the junction. Exit codes are read from the tool itself, never through a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | **Finance suites:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Suites and tests passed |
| V-2 | **Businesses-list suites, unchanged:** `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | Pass; diff exit 0 |
| V-3 | `npm run test:bos-entitlements` | Exit 0 (includes `enforcementPoints`, `tierLiteral.forbidden`, `report`, `dormantChampions`, the repository test) |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | **Guards, run unchanged:** `npx jest app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts lib/business-os/billing lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts lib/business-os/credits/__tests__/serviceColumn.guard.test.ts app/admin/components/layout lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci`, then `git diff --exit-code` on each of those paths (`lib/business-os/billing` will show only the SA-W45 comment lines, if approved: `git diff --numstat` pasted) | Pass; diff exit 0 except the comment-only file |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched file>` | Clean |
| V-8 | **Scoped `tsc` with a canary (AC-44)**, procedure below | Canary TS2322 reported, then the clean run |
| V-9 | `git diff --stat` read **before** the diff (no deletion-only file); no `supabase/migrations` path; the requirement MD not in the diff from Dev; `grep -rn "LiveBillingStatus\|countLiveRevenueRows" app lib components hooks scripts` returns nothing | Output pasted |
| V-10 | `npm run schema:check` if credentials exist, otherwise the note | Output or note |
| V-11 | **The user's read-only SQL checks 1 and 6** (§13), at QA time | Table below |

**V-8 procedure** (SA-WR-7):
1. Write a tsconfig **outside the worktree**, in the session scratchpad, with an absolute `extends` to the worktree's `tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false }`, and `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts`, and every touched `.ts` / `.tsx` file (absolute paths), tests included (the renames must type-check in every mock).
2. Plant `const __canary: number = 'x';` in `lib/business-os/finance/planGroups.ts`.
3. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>`; it **must** report TS2322 at the canary, or the run is not evidence.
4. Remove the canary (`grep -c __canary` = 0) and re-run.
5. Record every diagnostic: zero in touched files; any pre-existing one attributed by path (2a / 2b saw `MemoryManager.ts` ×2 and `CalibrationSessionRepository.ts` ×1).

The scratch config is never written into the worktree.

**V-11, the user's read-only SQL checks.** Supabase SQL editor; the page on "This month" and "All businesses".

| Check | Page figure | Expected today |
|---|---|---|
| 6 | Revenue panel | `plan_invoice_paid` and/or `boost_paid` `row_count` above 0 (the owner's test Basic invoice and Starter boost, `test_rows` > 0) → the panel says **"Revenue has been recorded. Amounts are shown in a later update."**; K-5 "Revenue recorded, not yet shown"; still no amount. `billing_accounts_paying` `row_count` ≥ 1 |
| 1 | Section 1, K-3 | The owner account's row: `cohort = champion`, `tier = basic`, `paying = true`, `paid_tier = basic`. On the page it is counted under **Essentials** (the display label of config tier `basic`, `tierMatrix.ts:245`), not Comped and not Founding Partner, and that row shows **"including 1 Founding Partner"**. Comped no longer counts it. K-3 = the sum of `no_cohort_end_date` over champion rows with `paying = false` and `tier = (none)` (SA-W46 caveat: plus any champion with an expired tier, of which there should be none) |

**Manual QA steps (AC-84), continuing from 2b's L-41.** Run `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin.

| # | Step | Expected |
|---|---|---|
| L-42 | Open `/admin/finance` | "Our revenue" says "Revenue has been recorded. Amounts are shown in a later update."; subtitle "Paid plan invoices and paid boosts, all businesses"; no amount, no `$0`; the words "webhook", "test accounts" and "live mode" appear nowhere on the page |
| L-43 | Read Section 1 | The owner account counted under Essentials with "including 1 Founding Partner"; groups sum to Total; Founding Partner and K-3 match check 1 |
| L-44 | Pick the owner's business, then reload the URL | Section 1 Total 1, in Essentials with a "Founding Partner" chip; K-3 says it is not an open-ended Founding Partner (0); no "Could not check" |
| L-45 | Read the dev-server log | "Billing statuses of all accounts read" and "Revenue rows counted" with counts only; one "Admin read the Business OS finance page" line; no tier, id at info, or amount. Record `durationMs` |

---

## Logging

- **Changed messages** (counts only, unchanged fields): R-c info `{ method, rows, durationMs }` "Billing statuses of all accounts read"; R-c′ debug `{ method, found }` "Billing status of one account read"; R-c duplicate error at `error` through `fail`; R-d info `{ method, planInvoicesPaid, boostsPaid }` "Revenue rows counted". Guard refusals `warn`, read errors `error` through the existing `fail`.
- **Builder and route:** no new line. `failed('paying_status' | 'revenue_existence', err)` unchanged.
- **Never logged:** a tier, a `bought_tier`, an account id at info, a status per account. Errors as `{ err }`. No `console.*` (T5 pins it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A rename is missed and a mock silently stops matching (ts-jest does not type-check) | The caller table above; V-9 grep returns nothing; V-8 scoped `tsc` over every touched test |
| R-2 | A second billing row for one account is silently counted | BD-16; SA-WR-27 duplicate error in R-c; R-c′ `maybeSingle` error; the page-boundary residual is recorded |
| R-3 | The override reaches an account it should not (non-paying, or paying read failed) | Override only when `key === 'founding_partner' && isPaying === true`; T2 cases for `false` and `null` |
| R-4 | A tier literal sneaks into code or a test | `paidTierOf` compares with `config.tierOrder`; tests take tiers from config; `tierLiteral.forbidden` and T5 run |
| R-5 | The shadow-report parity test diverges | SA-Q23 by group; the parity fixture has no paying champion and no tier and is not edited (S1C-F3); the separate test covers the new case |
| R-6 | A guard rule is vacuous | Every new or replaced rule has a planted control (2b retrospective, conclusion 1) |
| R-7 | An unknown `bought_tier` shows a wrong paid tier | Validated against `config.tierOrder`; invalid → Unknown/held, never a guess |
| R-8 | Section 3's "By current plan group" changes without warning | Expected (it follows the groups); its BD-8 note already says "the plan each account is on now"; called out in the PR description |
| R-9 | The requirement file is rewritten whole and loses lines | Dev does not edit it; `git diff --stat` before reading any diff |
| R-10 | The junction | Never `git worktree remove` or `git stash`; stop rather than `npm install` |

---

## Estimate

**1 to 1.5 days** (S1C-F6). I report at mid-day 1 if R-c / R-c′ are not green.

| Half-day | Work |
|---|---|
| 0.5 | R-c, R-c′, R-d, header, column constant; T1; every rename (builder, wiring, T3, T6); V-1 on the repository and builder |
| 1.0 | `paidTierOf`, override, note count, dormant by group; T2; builder hints and picked branch; T3 new cases; copy, `AccountsByPlanSection`, T4 |
| 1.5 | T5 rule replacement and AC-81 rules with controls; SA-W45 comment; V-1 to V-10, the canary run; results pasted |

---

## Task List

- ✅ 0. SA workplan review (SA-W41 to SA-W46): APPROVED WITH CONDITIONS, with BD-16
- ✅ 1. Branch `feature/bos-finance-health-1c` confirmed (`git branch --show-current`); junction present; nothing committed, nothing stashed
- ✅ 2. Repository: R-c, R-c′, R-d renamed, mode filter dropped, `bought_tier` column, `FinanceReadDuplicateError` (SA-WR-27), ceiling message, header (BD-14 / BD-16)
- ✅ 3. T1: inverted pins, duplicate-row error cases (SA-WR-27, SA-WR-28); 2a / 2b / pins untouched
- ✅ 4. Renames in `financeHealth.ts`, `financeHealthDeps.ts`, T3, T6 (R-c′ keeps its single row, BD-16)
- ✅ 5. `planGroups.ts`: `paidTierOf`, override, `foundingPartners`, dormant by group; `financeTypes.ts`
- ✅ 6. T2 new describes (AC-78 to AC-80, AC-86, S1C-F3); 1a tests unedited (additions only)
- ✅ 7. Builder hints; T3 new cases (AC-75 to AC-79, AC-80, AC-82, AC-85)
- ✅ 8. Copy, `AccountsByPlanSection.tsx` note and chip, `RevenuePanel.tsx` comment; T4 (AC-75 to AC-78, AC-81, AC-82)
- ✅ 9. T5: replace `:334-336`, add the AC-81 rules, planted controls; doc paragraph
- ✅ 10. `payingSubscriptionStatuses.ts` comment (SA-W45 approved; no "supabase" in it)
- ✅ 11. V-1 to V-10, the canary run; outputs pasted in Implementation Notes
- ✅ 12. Hand over to SA code review, uncommitted

---

## Implementation Notes

**Dev, 2026-10-13.** Built on `feature/bos-finance-health-1c`, uncommitted, nothing stashed. The workplan was first adjusted for BD-16 (SA-WR-26): the dual-row redesign was removed (no keyset on `id`, no `.limit(2)` list, no OR over rows, no `id` column); both billing reads keep their shape and drop only the mode filter.

### Files changed (15 code and test files, plus this workplan)

| File | Change |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | Header (names, "TEST AND LIVE MODE (BD-13, BD-14, BD-16)", PAGING); `bought_tier` on the row type and column list; `FinanceReadDuplicateError` (SA-WR-27); R-c `listBillingStatusesAllAccounts` (keyset on `user_id` unchanged, duplicate check after the loop); R-c′ `findBillingStatusForAccount` (`maybeSingle` unchanged); R-d `countRevenueRows`. Code names no `livemode` |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Doc; `row()` with a pass-through `bought_tier`; four-column pin; mode pins inverted; SA-WR-27 (every row read; the fake ignores `.gt`, so with real keyset paging a repeat is caught on the same page only) and SA-WR-28 cases; renames. The 2a / 2b import lines are unedited (a separate import for the new error) |
| `lib/business-os/finance/planGroups.ts` | `paidTierOf` (SA-Q20, SA-WR-29); `paidTierHints?: ReadonlyMap<string, string>`; BD-15 override after `groupFor` (SA-W44); `foundingPartners` per tier group via `!!cohort && stateForCohort(cohort) === 'champion'`; dormant by group (SA-W42). No new entitlements import |
| `lib/business-os/finance/financeTypes.ts` | `FinanceGroupCount.foundingPartners` |
| `lib/business-os/finance/financeHealth.ts` | Pick and calls renamed; paid-tier hints from the paying rows only; header paragraph |
| `lib/business-os/finance/financeHealthDeps.ts` | Three renamed lines; header line |
| `app/admin/finance/financeCopy.ts` | New panel copy (verbatim, no webhook wording); subtitle "Paid plan invoices and paid boosts, all businesses"; `accountsFoundingNote(n)`; `ACCOUNTS_FOUNDING_CHIP` |
| `app/admin/finance/components/AccountsByPlanSection.tsx` | Note as text with all businesses; `neutral` `StatusChip` with words for a picked business |
| `app/admin/finance/components/RevenuePanel.tsx` | Header comment only |
| `lib/business-os/billing/payingSubscriptionStatuses.ts` | Comment only (4 lines changed, `git diff --numstat` = `4 4`); no "supabase" in it (`grep -ci supabase` = 0) |
| `lib/business-os/finance/__tests__/planGroups.test.ts` | Additions only (154 insertions, 0 deletions): `paidTierOf` table, BD-15 cases, S1C-F3 dormant test on its own fixture. Parity test unedited |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | Renames; wiring key list re-sorted; AC-75 / AC-76 / AC-77 revenue cases; BD-15 all-businesses cases; AC-82 picked case; SA-WR-28 two-row case |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | `stripComments` extracted (behaviour of `codeOf` unchanged); `:334-336` replaced by "the repository code names no livemode" plus a planted control; AC-81 rules with planted controls, including the `latestMode` false-positive shape (SA-WR-30) |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Renames; SA-WR-28 through the route (200, "Tier set", no note) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture `foundingPartners: 0`; AC-75 / AC-76 render; AC-81 for every state; AC-78 note; AC-82 chip; SA-W43 no-chip case. The SA-WR-17 test is unedited |

### Required changes applied

| # | How |
|---|---|
| SA-WR-26 | Workplan edited (§ Reads rewritten, classifier, builder, guard table, AC mapping, risks). Code: R-c and R-c′ keep their shape |
| SA-WR-27 | `FinanceReadDuplicateError` after the loop, through `fail` at `error`, counts only. The page-boundary residual is commented in the code |
| SA-WR-28 | Repository, builder and route tests as specified |
| SA-WR-29 | `paidTierOf(planTier, boughtTier, tierOrder)`, single value |
| SA-WR-30 | Control: `MODE_WORDING.test('const latestMode = 1;')` is `true`, recorded; the rule passes on every scanned file, so none holds such an identifier |
| SA-WR-31 | Done in about the estimate |

### Deviations for SA

1. **R-c′'s new name starts with `list`, but the read still returns one row or null** (BD-16). SA-Q22 fixed the name, and BD-16 kept the single-row shape. I kept the SA-Q22 name as instructed. A rename back to `find…` is SA's call.
2. **`codeOf` in the finance source guard now calls a shared `stripComments`.** The behaviour is the same, and this is what the workplan planned so the planted control runs the same stripper. No other rule was edited.
3. **R-c′ debug message:** "Billing status of one account read", with `found` (single row), not the old plan's `rows`.
4. **An extra SA-WR-27 test over two pages.** Its fake ignores `.gt`, so it proves only that the check covers every row read. With real `.gt('user_id', last)` paging a repeat can only be caught on the same page; a second row just past a page boundary is the recorded residual (re-titled per SA-CR-3).

### `console.*`

0 in every touched file (`grep`). The only two hits under the scanned folders are comment text in guard tests.

### Verification (real output)

| # | Result |
|---|---|
| V-1 | Finance suites: **16 suites passed, 1,285 tests passed** |
| V-2 | Businesses-list suites: **22 suites, 567 tests passed**; `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` exit **0** |
| V-3 | `npm run test:bos-entitlements`: exit **0**, **244 suites, 7,194 tests** |
| V-4 | `npm run test:authz-guard`: exit **0**, **2 suites, 203 tests** |
| V-5 | Guards (routerPlacement, invoiceIntentsStayUnowned, planSurfaces, `lib/business-os/billing` incl. `payingSubscriptionStatuses.test.ts`, adminReadMethods, AdminJobsQueues, serviceColumn, layout folder, health, sidebar nav, plus `tierLiteral.forbidden`): **53 suites, 1,685 tests passed**. `git diff --numstat` over those paths: only `4 4 lib/business-os/billing/payingSubscriptionStatuses.ts` (comment only). The finance source guard: 530 tests passed (within V-1). The parity test in `planGroups.test.ts` passed unedited |
| V-6 | `npm run lint:hooks`: exit **0** |
| V-7 | `npx eslint` over the 15 touched `.ts` / `.tsx` files: exit **0**, no output |
| V-8 | Scoped `tsc`, config in the session scratchpad (`extends` the worktree `tsconfig.json`, include = types, `next-env.d.ts`, the 15 touched files). **Canary run:** `planGroups.ts(240,7): error TS2322` reported. The same run also found two real TS2345 errors in `financeHealth.test.ts` (an untyped default R-c mock), fixed with `ok<FinanceBillingStatusRow[]>`. Re-run with the canary: only the canary. Canary removed (`grep -c __canary` = 0); **clean run exit 0, 0 diagnostics** |
| V-9 | `git diff --stat`: 16 files, 954 insertions, 153 deletions; **no file has deletions without insertions** (the requirement MD in the stat is the BA agent's parallel E-20..E-25, not Dev's). No `supabase/migrations` path. `grep -rn "LiveBillingStatus\|countLiveRevenueRows" app lib components hooks scripts` returns nothing (exit 1) |
| V-10 | No credentials in the worktree for `npm run schema:check` (as in 2a / 2b). `bought_tier` is in migration `20261025` and in the user's live check of 2026-10-12 |
| V-11 | Owed: the user's SQL checks 1 and 6 at QA time |

### Fix round 1 (SA-CR-2, SA-CR-3, QA-1), Dev, 2026-10-13

| Item | Fix |
|---|---|
| SA-CR-2 | R-c′ is renamed to `findBillingStatusForAccount` in the repository (method and log `method`), the builder Pick and call, the wiring, and the repository, builder and route tests. The wiring key list was re-sorted. In this workplan's plan sections the name is replaced; the SA review text keeps the old name, because it is history. The `grep -rn "listBillingStatusesForAccount\|LiveBillingStatus\|countLiveRevenueRows" app lib components hooks scripts` returns nothing (exit 1) |
| SA-CR-3 | The repository test is re-titled with SA's exact wording ("covers every row read (the fake ignores `.gt`; with real keyset paging a repeat can only be on the same page)"). A comment says the boundary case is the recorded residual, and the repository comment says the same. Deviation 4 above is reworded to match |
| QA-1 | `planGroups.ts`: the note count now also requires `isCohortCurrent(row.cohort_expires_at, nowMs)`, meaning no end or an end strictly after the classifier's own `now`. An unparseable end counts as ended. `!!cohort` is kept, with no cohort literal. Tests: a future end gets the note; an ended period gets its tier group with no note; an end exactly at `now` has ended. My earlier "grace on the champion cohort, paying" test now expects no note, because its period has ended |

**Re-run results:**

| Check | Result |
|---|---|
| Finance suites | 16 suites, **1,288 tests** passed |
| Finance source guard | 530 tests passed |
| Businesses-list suites | 22 suites, 567 tests passed; `git diff --exit-code` returned 0 |
| routerPlacement + tierLiteral | 2 suites, 40 tests passed |
| `test:bos-entitlements` | exit 0, 244 suites, 7,194 tests |
| `test:authz-guard` | exit 0, 203 tests |
| `lint:hooks` | exit 0 |
| ESLint on the touched files | exit 0 |
| Scoped `tsc` | canary reported `planGroups.ts(254,7) TS2322`; canary removed (count 0); clean run exit 0, 0 diagnostics |

`git diff --stat`: 16 files, 994 insertions, 153 deletions, with no file showing deletions without insertions. The requirement MD in the stat is the BA agent's change, not Dev's.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-13, against `97c66132`, with user decision BD-16**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed once the workplan is adjusted for BD-16 (SA-WR-26), applying SA-WR-26 to SA-WR-31 as you build. SA checks them at code review. BA applies E-20 to E-25 below.

**BD-16 changes my SA-Q21 ruling.** The user's words: "there are no separate test and production rows; it should be one … assume that when we go live each account has one." **The dual-row redesign is withdrawn.** That means:
- no keyset on `id`;
- no `.limit(2)` list;
- no OR over rows;
- no `id` column.

The current single-row reads stay. If two rows ever appear, the honest result is an **error**, never a figure.

**Is the current paging wrong for one row per account? No.** I verified it in the code:
- R-c keysets on `user_id` with `.gt('user_id', last)`, after `.not('user_id', 'is', null)` and `.order('user_id')`. When every `user_id` holds one row, `user_id` is a unique key, so a page boundary can lose nothing.
- R-c′ uses `.maybeSingle()`. With two rows PostgREST returns an error (PGRST116), and the repository returns `{ data: null, error }`. The builder then logs `paying_status`, and Section 1 shows the "Tier set" fallback with Founding Partner untouched (`payingIds === null`, S1C-FR-6). That is an honest failure, never a wrong group.
- **One gap remains for the all-accounts read.** If two rows existed, R-c would silently feed both into the paying `Set`, which is a guess. Required change SA-WR-27 makes it fail loudly instead.

**Checked:**
- **The renames (SA-Q22).** The old names appear in exactly the seven files your table lists: the repository, its test, `financeHealth.ts`, `financeHealthDeps.ts`, `financeHealth.test.ts`, the route test, and the source guard. Your V-9 grep is the right proof.
- **The guard replacement.** "The repository code names no `livemode`" with a planted control, using one shared stripper so the control exercises the real path. The `:321` slicer control is kept.
- **SA-Q20.** Tiers are compared with `config.tierOrder` only, and the repository test uses a pass-through value that is not a tier id.
- **`!!cohort` is acceptable.** The cohort-literal rule (`:144`) matches `cohort !== ''`, so `!!cohort && stateForCohort(cohort) === 'champion'` is the right form. `'champion'` there is a lifecycle state, not a cohort id.
- **The AC mapping** covers AC-75 to AC-86. AC-80, AC-82 and AC-85 are re-mapped per BD-16 below.
- **The canary** follows SA-WR-7.
- **The estimate shrinks to about 1 day.**

### Rulings SA-W41 to SA-W46

| # | Ruling |
|---|---|
| **SA-W41** | **Moot under BD-16.** One row means one `bought_tier`. `paidTierHints` becomes `ReadonlyMap<string, string>` (one value per account). `paidTierOf(planTier, boughtTier, tierOrder)` returns the plan tier if valid, otherwise `boughtTier` if valid, otherwise null (Unknown/held). Two rows are an error before this point (SA-WR-27). |
| **SA-W42** | **Approved.** Dormant counts the Founding Partner group only, so a Comped dormant champion is not counted either. The label is "Dormant Founding Partners", and Comped accounts are not in that group. Test both cases. |
| **SA-W43** | **Approved.** The SA-WR-17 test is kept unedited (all businesses, no section badge), and a new test is added: the chip appears only with `scope: 'one'` and `foundingPartners > 0`. |
| **SA-W44** | **Approved.** The override runs after `groupFor`, only when `isPaying === true`. `groupFor` and its exhaustive 1a tests are unchanged. `paidTierHints` is optional. |
| **SA-W45** | **Approved, comment only.** The new comment must not contain the word "supabase", because the billing placement guard (P-2a M-1) scans this folder's text. Run that guard and `payingSubscriptionStatuses.test.ts` unchanged. |
| **SA-W46** | **Approved: no code change.** The page is right. The check 1 comment states the caveat (E-25). |

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-26 (High). Re-plan the reads for BD-16.**
   - **R-c** keeps `.not('user_id', 'is', null)`, `.order('user_id')`, `.gt('user_id', last)` and the 20,000-row error ceiling. It drops only the mode filter.
   - **R-c′** keeps `.eq('user_id', id).maybeSingle()` and drops only the mode filter.
   - The columns become `user_id, subscription_status, ended_at, bought_tier`, with no `id`.
   - Remove from the workplan:
     - the `.limit(2)` list;
     - the keyset on `id`;
     - the AC-85 `pageSize: 1` test;
     - the "OR over rows" text;
     - the header sentence "one test and one live row … R-c′ returns a list".
   - The header says one billing record per account is assumed (BD-16).
2. **SA-WR-27 (Medium). Make two rows fail honestly in R-c.** After the loop, if any `user_id` occurs twice among the rows read, return `{ data: null, error: FinanceReadDuplicateError }`. It is logged at `error` with counts only, the same path as the ceiling. The builder then shows "Tier set". Repository test: two rows with one `user_id` give an error and no data.
   - **Residual, recorded:** a second row that falls exactly past a page boundary is not detected, because `.gt` skips it. This needs more than 1,000 billing rows and a dual-row account exactly at the boundary, which BD-16 says will not exist.
3. **SA-WR-28 (Medium). R-c′ with two rows.**
   - **Repository test:** the mocked `maybeSingle` error is returned as `{ data: null, error }` and is never thrown.
   - **Builder test:** in the picked view, a paying-read error leaves the champion in Founding Partner, with "Tier set" and no note. This replaces the "two rows → 200 ok" case.
   - **Route test:** returns 200 with that fallback.
4. **SA-WR-29 (Low).** `paidTierOf` and the hints follow SA-W41 (single value). Tests: plan tier wins; a valid bought tier as fallback; an invalid one gives Unknown/held.
5. **SA-WR-30 (Low).** The AC-81 rule `/test.?mode|live.?mode/i` over `FILES` must not hit identifiers. Include a control that `latestMode` would match (a known false-positive shape), and confirm no current file contains such an identifier. If one ever does, narrow the rule to string literals.
6. **SA-WR-31 (Low).** The estimate is about **1 day**. Report at mid-day if R-c / R-c′ are not green.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-1c)

- **E-20 (S1C-FR-2).** Replace the S1C-FR-2 rule cell with: "**R-c and R-c′ (BD-14, BD-16).** The paying reads drop `livemode = true`. One billing record per account is assumed (BD-16): R-c keeps its keyset on `user_id`, and R-c′ keeps its single-row read. If an account ever has two rows, the read reports an error, never a figure: R-c fails when a `user_id` appears twice among the rows it read, and R-c′'s single-row read fails. Section 1 then shows the 'Tier set' fallback (S1-FR-15). An account is paying when its row passes `isPayingBillingRow` (the single definition; no new constant). R-c and R-c′ add `bought_tier` to their columns (SA-Q20)."
- **E-21 (AC-82).** Replace "and a business with **two** billing rows (test and live) does not error (re-run of AC-42)." with "and a business with **two** billing rows makes the paying read fail, so Section 1 shows the 'Tier set' fallback and never a wrong group (BD-16; re-run of AC-42)."
- **E-22 (AC-80).** Delete the sentence "An account with both a test and a live billing row is counted once."
- **E-23 (AC-85).** Replace the whole AC-85 item with: "- [ ] **AC-85** *(1c)* **One billing row per account (BD-16).** R-c and R-c′ read without a mode filter and assume one row per account. If an account ever has two rows, the read returns an error: R-c when a `user_id` appears twice among the rows read, R-c′ when its single-row read fails. Section 1 then shows the 'Tier set' fallback with no Founding Partner note: never a wrong group or count (repository test and builder test)."
- **E-24 (SA-Q21 in §11B.6).** In the SA-Q21 row's BA-suggestion cell, append: " **Withdrawn 2026-10-13 by BD-16** (one billing record per account; see §0.3 SA-Q21)."
- **E-25 (check 1 comments).**
  - Replace `-- active or past_due and no end date. One row per account even with two billing rows.` with `-- active or past_due and no end date. One billing row per account is assumed (BD-16).`
  - After the line `-- and tier is (none); a champion with a tier set is Comped or in its tier group.`, add `-- A champion whose tier has expired shows here under that tier but is a Founding Partner on the page.`
  - Both are ASCII, with no apostrophe and no "into". The query is unchanged.

---

## SA Code Review

**Code Review by SA — 2026-10-13**
**Status:** ✅ **APPROVED WITH CONDITIONS. Code approved for QA.** There are two Low conditions (SA-CR-2 and SA-CR-3) for the fix round. Neither blocks QA.

**How it was checked.** I read all 15 changed code and test files.

**My own runs (all green):**
- The finance lib, page and route, the repository test, `lib/business-os/billing` (the paying-status test and the billing placement guard), `routerPlacement.guard` and `tierLiteral`: 41 suites, 1,891 tests.
- `test:bos-entitlements`: 244 suites, 7,194 tests.
- `test:authz-guard`: 203 tests.
- `grep "LiveBillingStatus|countLiveRevenueRows"` over `app`, `lib`, `components`, `hooks` and `scripts` finds 0 hits.
- No `livemode` remains in finance code or the repository's code.

### Checks

| Item | Verdict |
|---|---|
| **SA-WR-26** (dual-row redesign gone) | ✅ R-c keeps `.not('user_id', 'is', null)`, `.order('user_id')` and `.gt('user_id')`; R-c′ keeps `.maybeSingle()`. The columns are `user_id, subscription_status, ended_at, bought_tier`: no `id`, no `.limit(2)`, no list. |
| **SA-WR-27** | ✅ After the loop, a `Set` of `user_id` that is smaller than the row count gives `FinanceReadDuplicateError`, through `fail` at `error`, with counts only (no id in the log or the message). Tested. |
| **SA-WR-28** | ✅ R-c′'s `maybeSingle` error is returned, never thrown. In the builder and through the route, a paying-read error leaves the champion in Founding Partner with "Tier set". |
| **SA-Q22 renames** | ✅ The old names appear nowhere. The header, logs and ceiling message lose "Live". |
| **Source guard** | ✅ "The repository code names no `livemode`" (code length over 5,000, non-vacuous). Its planted control runs the shared `stripComments`, catching a line comment, a block comment and real code. The AC-81 rules have controls, and the `latestMode` false-positive shape is recorded (SA-WR-30). |
| **SA-Q20 / SA-WR-29** | ✅ `paidTierOf(planTier, boughtTier, tierOrder)`: the plan tier first, then the bought tier, then null (Unknown/held). Compared with `tierOrder` only; `tierLiteral` is green. |
| **BD-15** | ✅ The override runs after `groupFor` (unchanged), only when `isPaying === true`, and before the group lookup. `foundingPartners` counts `tier:` groups with the champion cohort through `stateForCohort`, using `!!cohort`. A non-paying champion stays in Founding Partner. With all businesses the note is text; in the picked view it is a `neutral` `StatusChip` with words. No section badge. |
| **SA-W42** | ✅ Dormant counts `key === 'founding_partner' && isDormantChampion(row)`. Tested for both a paying champion and a Comped dormant champion. |
| **SA-W45** | ✅ Comment-only edit (4/4 lines), with no "supabase" in the file. The billing placement guard and `payingSubscriptionStatuses.test.ts` are green. |
| **Panel copy** | ✅ "None yet. No plan payment or credit boost has been recorded." / "Revenue has been recorded. Amounts are shown in a later update." / "Paid plan invoices and paid boosts, all businesses". No webhook or mode wording. |
| **S1C-F3** | ✅ The parity test with `buildShadowReport` (`planGroups.test.ts:198`) is unedited, and its fixture has no paying champion. Paying champions sit in a separate fixture (`:361`). |
| **BD-14 everywhere in layer A** | ✅ R-c, R-c′ and R-d have no mode filter. Boost credits stay out of Credits (`creditsSection.ts` is untouched). |
| **Typed mock fix** | ✅ `ok<FinanceBillingStatusRow[]>([... bought_tier: null])` is the right fix: the default mock now has the repository row type, so TS2345 is gone without a cast. |

### Deviations

| # | Ruling |
|---|---|
| D-1 | **Not accepted as is.** The name `listBillingStatusesForAccount` promises a list, but under BD-16 the method returns one row or null. My SA-Q22 name assumed SA-Q21's list, which BD-16 withdrew. **SA-CR-2** renames it. |
| D-2 | **Approved.** The shared `stripComments` is what makes the planted control prove the real path. |
| D-3 | **Approved; the recorded gap is accurate, but the test's title overstates.** Real keyset paging (`.gt('user_id', last)`) excludes every row of the last user on a page from the next page. So a repeat **cannot** arrive on the next page from a real database. The check catches two rows of one account **on the same page**. It cannot see a second row that falls just past a boundary, because `.gt` skips it: that is exactly the recorded residual, and it is not contradictory. The "spans pages" test only shows the `Set` covers every row read, using a fake that ignores `.gt`. **SA-CR-3** fixes its wording. |

### Code Review Comments

1. **SA-CR-2 (Low). Rename R-c′ to `findBillingStatusForAccount`.**
   - Change the repository, the Pick in `financeHealth.ts`, `financeHealthDeps.ts`, and the builder, route and repository tests.
   - The method name inside the repository and in its log `method` field follows.
   - Update the requirement and workplan mentions through the BA, as history notes.
   - V-9's grep then also checks that `listBillingStatusesForAccount` appears nowhere.
2. **SA-CR-3 (Low). Re-title the repository test at `:221`** to "the duplicate check covers every row read (the fake ignores `.gt`; with real keyset paging a repeat can only be on the same page)". Add one comment line saying the boundary case is the recorded residual.

### Code Approved for QA: **Yes**

QA owes V-11 (SQL checks 1 and 6, with the E-25 caveat) and the manual check that the owner test account shows under its paid tier with the Founding Partner note and that the panel says "Revenue has been recorded".

---

## QA Report

**QA — 2026-10-13**
**Test mode:** full (AC-75 to AC-86)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 1 and 6 (QA does not run SQL against production). The steps for the user are L-42 to L-48 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every AC from AC-75 to AC-86 that Jest can test passes. The manual half of AC-84 (the user's own test account, checks 1 and 6) is owed. Two Low notes, neither blocking.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-1c`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` (T1 to T6, the finance source guard included) | exit 0; **16 suites, 1,285 passed** |
| Q-2 | Businesses list: `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | exit 0; **22 suites, 567 passed**; diff **exit 0** |
| Q-3 | Guards: `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`, `lib/business-os/billing` (billing placement + `payingSubscriptionStatuses.test.ts`), `adminReadMethods.guard`, `AdminJobsQueuesRepository`, `serviceColumn.guard`, `app/admin/components/layout`, `lib/admin/health`, `AdminSidebar.nav`, `tierLiteral.forbidden`, `report.test.ts`, `dormantChampions.test.ts` | exit 0; **55 suites, 1,738 passed**. `git diff --numstat` over those paths: only `4 4 lib/business-os/billing/payingSubscriptionStatuses.ts` (comment-only, read: no "supabase", no code change) |
| Q-4 | Parity test unedited | `git diff --numstat` on `planGroups.test.ts` = **154 / 0** (additions only); the 1a parity test with `buildShadowReport` passes in Q-1 |
| Q-5 | Credits exclusion untouched | `git diff --exit-code -- lib/business-os/finance/creditsSection.ts` **exit 0** |
| Q-6 | `npm run test:bos-entitlements` | exit 0; **244 suites, 7,194 passed** |
| Q-7 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-8 | `npm run lint:hooks` | exit 0 |
| Q-9 | Scoped `tsc`. Config: `tsconfig.qa-1c.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 15 changed `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `planGroups.ts`): exit 2, `lib/business-os/finance/planGroups.ts(239,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-10 | `git diff --stat`; rename grep | 16 files (+955 / −153), no deletion-only file, no migration path; `grep -rn "LiveBillingStatus\|countLiveRevenueRows" app lib components hooks scripts` → nothing (exit 1) |

### Test Coverage (AC-75 to AC-86)

| AC | Result | Evidence |
|---|---|---|
| AC-75 | ✅ Pass | T1 "R-d … two head counts, test and real rows together (BD-14)" (events `eq` = `kind` only, no `livemode`); T3 "AC-75: a paid plan invoice (test or real) → recorded, K-5 'Revenue recorded, not yet shown'"; T4 "AC-75 / AC-76: revenue recorded → 'Revenue has been recorded' …" |
| AC-76 | ✅ Pass | T1 boosts query `not('paid_at', 'is', null)`, no `livemode`; T3 "AC-76: a paid boost alone → recorded"; T4 |
| AC-77 | ✅ Pass | T3 "AC-77: no paid invoice and no paid boost → none_yet, K-5 'None yet'"; T4 "AC-22 / AC-77: … no $0 anywhere in it or on K-5" |
| AC-78 | ✅ Pass (Jest), live part manual | T2 "(a) AC-78: champion with its tier in force and paying → its tier group with the note; Comped 0", "(b) AC-78 …"; T3 both AC-78 cases; T4 "AC-78: … the note as text". The user's own account: L-43 |
| AC-79 | ✅ Pass | T2 "AC-79: a champion that is not paying stays in Founding Partner, even with a bought tier, and no note"; T3 "AC-79: a bought tier on a row that is not paying is ignored" |
| AC-80 | ✅ Pass (Jest), live part manual | T2 "AC-80: K-3 ('no end date') counts only the champions left in Founding Partner"; T3 AC-78 (b) / AC-80. Check 1: L-44 |
| AC-81 | ✅ Pass | T4 `it.each` over every revenue state (no webhook / not in place / test accounts only / mode wording); T5 "no 'webhook', 'not in place' or 'test accounts only' in code" and "names no mode in code", both with planted controls (SA-WR-30 `latestMode` control recorded) |
| AC-82 | ✅ Pass | T3 "AC-82: a paying Founding Partner with its tier in force → its tier group, note 1, K-3 0; account-scoped reads only"; T3 / T6 two-row case → "Tier set"; T4 "AC-82 / SA-Q24: … the neutral 'Founding Partner' chip with words" |
| AC-83 (re-run) | ✅ Pass | T6 authz describe unchanged (401, 403, `profiles.role`-only 403, zero calls via `allReads()`), green in Q-1; Q-7 |
| AC-84 (re-run) | ✅ Pass (Jest), manual owed | AC-12: T2 "AC-12 / AC-84: a mixed fixture with every new case still sums to Total". AC-28: T1 / T5 no-write pins, Q-10 no migration. AC-30: T1 log assertions (counts only). AC-31: Q-3, Q-6, Q-7. AC-44: Q-9. Manual: L-42 to L-48 |
| AC-85 | ✅ Pass | T1 "SA-WR-27 / AC-85: one user_id read twice is an ERROR with no data" and "the duplicate check spans pages"; T1 "SA-WR-28 / AC-85: two rows make maybeSingle error, RETURNED … never thrown"; T3 / T6 the picked two-row case → "Tier set", no note |
| AC-86 | ✅ Pass | T2 `paidTierOf` `it.each` table (plan tier wins, bought fallback, invalid → null), "(b2) … the plan tier wins", "(b3) … Unknown/held"; T5 tier-literal rule and `tierLiteral.forbidden` green |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Test-mode paid invoice counts | Confirmed | R-d events query is `.eq('kind', 'invoice_paid')` only (`BusinessOsFinanceReadRepository.ts:397-399`); the repository code names no `livemode` at all (T5 rule) |
| Test-mode paid boost counts | Confirmed | Boosts `.not('paid_at', 'is', null)` only (`:401-403`) |
| Neither → "None yet" copy | Confirmed | 0 and 0 → `none_yet` with the new sentence "None yet. No plan payment or credit boost has been recorded." |
| Old webhook wording gone | Confirmed | `financeCopy.ts` diff replaces both sentences and the "Live-mode" subtitle; a scan of `app/admin/finance` and `lib/business-os/finance` (non-test) finds "webhook" only in a code comment (`planGroups.ts:76`), which the AC-81 code rule correctly ignores |
| Paying champion, tier in force (the user's case) | Confirmed | Tier in force → state `active`, basis `tier` → `groupFor` gives `tier:<tier>` once paying; note from `isChampionCohort` (`planGroups.ts:195`). With config tier `basic` the row is labelled **"Essentials"** (`tierMatrix.ts:245`), not "Basic" |
| Paying champion, no tier in force | Confirmed | Override at `planGroups.ts:180-183`: `paidTierOf(row.tier, bought_tier, config.tierOrder)`; an invalid or blank bought tier → `unknown_held`, never a guess |
| Non-paying champion stays FP | Confirmed | Override only when `isPaying === true`; T2 / T3 AC-79 |
| `past_due` paying account | Confirmed | `isPayingBillingRow` unchanged (`active`, `past_due`, `ended_at` NULL; comment-only diff); `payingSubscriptionStatuses.test.ts` green |
| K-3 excludes paying champions | Confirmed | `foundingNoEndDate` counts only `key === 'founding_partner'`; paying champions leave the group |
| Dormant count | Confirmed | Now `key === 'founding_partner' && isDormantChampion(row)`; T2 "a paying dormant champion and a Comped dormant champion are not counted; a plain dormant one is" (SA-W42) |
| Duplicate `user_id` in R-c | Confirmed (with the recorded residual) | `:349-350` throws `FinanceReadDuplicateError` → `fail` → `{ data: null }` → "Tier set". A second row exactly past a page boundary is skipped by `.gt` (SA-WR-27 residual) |
| Two rows for a picked business | Confirmed | `maybeSingle` error returned as data null → `payingIds === null` → champion stays FP, "Tier set", no note (T3 / T6, 200) |
| Boost credits still excluded from Credits | Confirmed | `creditsSection.ts` unchanged (Q-5); its `admin_grant` filter still skips `boost_purchase` lots (1b test "boost lots are left out") |
| Picked business | Confirmed | R-c′ gets exactly the id; `pagePlans`, R-c and every all-accounts read zero calls; R-d with no argument (T3 / T6) |
| Auth failure unchanged | Confirmed | AC-83 above |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. No new read; the reads lost a filter only.

#### Edge Cases / notes (Low)
1. **The Founding Partner note counts any champion-cohort account in a tier group, including one whose cohort has already ended** (`lib/business-os/finance/planGroups.ts:195`). Such an account would read "including 1 Founding Partner" although its Founding Partner period is over. BD-15 does not say whether a lapsed Founding Partner keeps the note; none exists today. Low; a product wording question for BA.
2. **The trigger was described as "$79 Basic"; the page shows the tier's config label, "Essentials"** (`tierMatrix.ts:245`). This is correct by design (no tier literal, labels from config), but the user should expect "Essentials" in L-43, not "Basic". Not a defect.

### Manual live steps (continuing from 2b's L-41): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for §13 checks 1 and 6 (read-only; QA did not run them). Page on **This month**, **All businesses** unless a step says otherwise.

| # | Step | Expected |
|---|---|---|
| L-42 | Open `/admin/finance` and read "Our revenue" | "Revenue has been recorded. Amounts are shown in a later update."; subtitle "Paid plan invoices and paid boosts, all businesses"; no amount, no `$0`, no chart. K-5 grey, "Revenue recorded, not yet shown". The words "webhook", "not in place", "test accounts", "live mode" and "test mode" appear nowhere on the page |
| L-43 | Read Section 1 for your own test account (the $79 plan) | It is counted under **Essentials** (the label of config tier `basic`), with "including 1 Founding Partner" in that row. Comped no longer counts it; Founding Partner went down by one. The groups still sum to Total |
| L-44 | **Check 1** vs Section 1 and K-3 | Your account's row: `cohort` = `champion`, `tier` = `basic`, `paying` = true, `paid_tier` = `basic`. Founding Partner = the champion rows with `paying` false (and no tier in force). K-3 = Σ `no_cohort_end_date` over champion rows with `paying` false and `tier` `(none)` (the E-25 caveat: plus any champion with an expired tier). Every group count matches |
| L-45 | **Check 6** vs the panel | `plan_invoice_paid` `row_count` ≥ 1 and `boost_paid` `row_count` ≥ 1, both with `test_rows` > 0 and `live_rows` 0; `billing_accounts_paying` `row_count` ≥ 1. Any non-zero on the first two rows means the panel must say "Revenue has been recorded" (it does, L-42) |
| L-46 | Pick your own business, then reload the URL | Section 1: Total 1, in Essentials with a neutral "Founding Partner" chip with words (no note sentence); K-3 says it is not an open-ended Founding Partner (0); no "Tier set" and no "Could not check". The revenue panel is unchanged (platform-wide). The reload reproduces the view |
| L-47 | Credits section for your account | The $10 boost's credits are **not** in "gifted outstanding" (admin grants only); K-4 unchanged by the boost |
| L-48 | Dev-server log | "Billing statuses of all accounts read" and "Revenue rows counted" with counts only; one "Admin read the Business OS finance page" line; no tier, no bought tier, no id at info, no amount. **Record `durationMs`** for All businesses and for your business |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **AC-75 to AC-86 pass in Jest, and no bug is open.** The manual half of AC-84 (L-42 to L-48, SQL checks 1 and 6, your own test account) is owed before commit. The two Low notes do not block.

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created (Dev) | Slice 1c workplan from §11B, BD-14, BD-15, SA-Q20 to SA-Q24 and SA-RR-1c, checked against `97c66132`. Reads R-c / R-c′ / R-d renamed and freed of the mode filter (keyset on `id`, list-returning R-c′); paid tier via `paidTierOf`; note and picked-view chip; dormant by group; new panel copy; guard table; AC-75 to AC-86 mapped; raises SA-W41 to SA-W46. No code changed. |
| 2026-10-13 | SA workplan review: **APPROVED WITH CONDITIONS** (with BD-16) | BD-16 (one billing record per account) withdraws the SA-Q21 dual-row redesign: the single-row reads are kept, which is verified correct for one row. Two rows now give an honest error (SA-WR-27 duplicate check in R-c; R-c′ `maybeSingle` error → "Tier set"). W41 moot (single `bought_tier`); W42 to W46 approved; `!!cohort` accepted. Required changes SA-WR-26 to SA-WR-31; estimate about 1 day. Requirement edits E-20 to E-25 are for BA. |
| 2026-10-13 | Dev: workplan adjusted for BD-16 (SA-WR-26), slice built | Dual-row redesign removed from the workplan; R-c / R-c′ keep their shape, drop only the mode filter; SA-WR-27 duplicate error; SA-Q22 renames; guard replaced with a planted control; BD-15 grouping, note and chip; dormant by group; new panel copy; comment-only edit in `payingSubscriptionStatuses.ts`. V-1 to V-10 green (results in Implementation Notes). Uncommitted, for SA code review. |
| 2026-10-13 | SA code review: **APPROVED WITH CONDITIONS** | All 15 code and test files read. SA-WR-26 to SA-WR-30, SA-Q20 to SA-Q24 and BD-14 to BD-16 verified; the typed-mock fix is right. D-2 approved; D-1 not accepted (SA-CR-2: rename R-c′ to `findBillingStatusForAccount`); D-3 approved with a test re-title (SA-CR-3), since a repeat on the next page is impossible with real keyset paging. SA re-ran 41 suites / 1,891 tests, `test:bos-entitlements` (7,194) and `test:authz-guard` (203), all green. Code approved for QA. |
