# Workplan: Business OS Finance & Business Health — Slice 8.2 (nightly history snapshot job)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **8.2 only**:
- §11M.4 (HS-W-1 to HS-W-11), §11M.5 (the metrics), §11M.7 (HS-FR-1 to HS-FR-8) and the 8.2 rows of §11M.10;
- AC-278 to AC-286, and AC-293 / AC-294 for 8.2;
- L-156 to L-158 (checks 33 and 34);
- SA-RR-8 with E-85 to E-93 applied (E-86, E-87 and E-88 touch 8.2), and SA-WR-8.1.
**Branch:** `feature/bos-finance-health-8-2` (worktree `neuronforge-finance-m8`, cut from the 8.1 tip `1eaa8f3d`). Confirmed with `git branch --show-current`.
**Status:** Code Complete (SA-WR-8.2 approved with conditions 8.2-R1 to 8.2-R4; awaiting SA code review; PR only after #452 merges)

**Stacking rule:** 8.1 is PR #452 and is **not merged**: it waits for the user to apply `20261078`. **8.2's PR is not opened until #452 has merged into main.** Then RM merges main into this branch (no rebase) and opens the PR. 8.2 may auto-merge under BD-33 (SA-Q107), because 8.2 has no migration.

**Decisions in force:**
- BQ-17: daily.
- BQ-18: keep forever (no pruning).
- BQ-19: no backfill.
- BD-12: no FX, and here no money at all (HS-W-9).
- BD-33: the fast track.
- SA rulings:
  - SA-Q101: the metric list is pinned in code.
  - SA-Q102: a PostgREST insert, no function.
  - SA-Q103: the 02:00 UTC late cut-off.
  - SA-Q105: a narrow wiring with its own `Pick`s.
  - E-86: rows are pre-checked against the shape.
  - E-87: a 30 s night budget.
  - E-88: `upsert … ignoreDuplicates … select('id')`.

## Overview

8.2 adds the nightly job that fills `business_os_finance_snapshots`. At **00:07 UTC** it reads the all-businesses state that Section 1 and Section 4 show:
- the plan walk;
- the billing rows;
- the credit positions, with a **30 s** budget;
- the lots.

It turns them into the §11M.5 rows **through the same functions the page uses**, checks every row against the 8.1 shape constants, and writes them in **one** idempotent insert through a new repository. A run that starts at or after 02:00 UTC writes nothing. A family whose read failed is skipped, never written as 0. **If the table is not installed, the job refuses cleanly** before reading anything (§8.5).

There is no new read, no change to any page, route payload or pin, and no migration.

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Files to Create / Modify](#files-to-create--modify)
- [1. The pure builder](#1-the-pure-builder)
- [2. Reuse refactors (no behaviour change)](#2-reuse-refactors-no-behaviour-change)
- [3. The wiring](#3-the-wiring)
- [4. The writer repository](#4-the-writer-repository)
- [5. The job](#5-the-job)
- [6. The route](#6-the-route)
- [7. Registry and schedule](#7-registry-and-schedule)
- [8. Safety before 20261078 is applied](#8-safety-before-20261078-is-applied)
- [9. Tenant isolation and money](#9-tenant-isolation-and-money)
- [Guard table, line by line](#guard-table-line-by-line)
- [Test plan](#test-plan)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
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

I read every fact below myself, on `1eaa8f3d`.

| # | Fact | Where | Consequence |
|---|---|---|---|
| VL-1 | **The cron pattern.**<ul><li>`verifyCronSecret`: in development any request passes; in production a missing `CRON_SECRET` logs `error` and refuses; otherwise the header must equal `Bearer ${secret}`.</li><li>`runJob` builds a `correlationId` child logger, returns 401 when refused, and on a thrown defect returns `{ success: false, error: 'Internal server error' }` 500.</li><li>The route exports `GET = withCronRunRecord('<id>', runJob)`, `runtime = 'nodejs'` and `maxDuration = 60`.</li></ul> | `app/api/cron/credit-leak-check/route.ts:35-61, :63-115` | Copied verbatim for the secret and the shape (HS-FR-1) |
| VL-2 | **The recorder.**<ul><li>It records only a proven Vercel cron call.</li><li>A response with status `>= 400` is recorded `failed` with `http_error` and no counts.</li><li>Otherwise the registry `counts` are taken from the body, and the run is `partial` when a `partlyDoneWhen` holds.</li><li>A missing `bos_cron_runs` table backs off for 5 minutes.</li></ul> | `lib/cron/cronRunRecorder.ts:172-185, :194-279` | A missing snapshots table → a 503 → the run reads "failed" on Jobs & queues (§8) |
| VL-3 | **The registry.**<ul><li>`BosCronJobId` is a union (`bosCronJobs.ts:30-47`).</li><li>`DAILY = { intervalMinutes: 1440, graceMinutes: 60, keepsFailingAfter: 2 }` (`:139`) and `MAX_60` (`:151`).</li><li>The entries end at `:616`; `payment-reminders` is last (`:584-615`).</li><li>The file must import nothing (`bosCronJobs.test.ts:160`).</li><li>Keys follow the database rule, and no key or path may name a money word.</li></ul> | `lib/cron/bosCronJobs.ts` | One entry plus one id (§7) |
| VL-4 | **Pins on the job list.**<ul><li>`bosCronJobs.test.ts:46-52`: the registry equals `vercel.json`, `toHaveLength(17)`, with the comment "17th: …".</li><li>`vercelCrons.test.ts:37-91` (`BOS_CRONS`, in order) and `:102-105` `toHaveLength(17)`.</li><li>`vercel.json:73-76`: `bos-billing-reconcile` is the last cron.</li></ul> | the three files | Ruled count edits 17 → 18 plus one appended row (§7) |
| VL-5 | **The Jobs page and Health read the registry by length** (`BOS_CRON_JOBS.length`). Their tests compute the length the same way:<ul><li>`jobsQueues.layout.render.test.tsx:173-174`;</li><li>`jobsQueues.render.test.tsx:91`;</li><li>`app/api/admin/jobs-queues/__tests__/route.test.ts:127`;</li><li>`buildJobsQueuesView.test.ts:212, :369`;</li><li>`qa-slice5-pr2.status.test.ts:264`</li></ul> | those tests | They adapt with no edit. `addedOn` keeps the new job "No run yet" until its first night (QA4b-B1) |
| VL-6 | **There is no generic "Run now" for jobs.** The Jobs page has "Drain now" per queue (`app/api/admin/jobs-queues/drain/route.ts`) and "Reconcile top-ups now" for one job. Its source says that one "is not a Run now for the job: the press records no run (SA SQ-1)" | `app/admin/components/jobs/JobsQueuesView.tsx:63-75` | **No button in 8.2** (SA-W-8.2-6) |
| VL-7 | **Run-record adoption test.**<ul><li>It loads **every** registered cron route and calls it as Vercel would, in production, with `supabaseServer` mocked to "nothing to do" (`data: []`).</li><li>It expects `outcome: 'succeeded'`, HTTP 200 and numeric counts that are all registered keys.</li></ul> | `app/api/cron/__tests__/runRecord.adoption.test.ts:31-46, :176-197` | The new route runs in it automatically. Its late gate depends on the clock: a test run after 02:00 UTC would give `partial`, so the route takes its start time from a seam the test can fix (SA-W-8.2-4) |
| VL-8 | **The plan walk is private.** `walkPlans(plans)` (keyset, page 500, ceiling 20,000 with `>=`, `capped`) is a module function at `financeHealth.ts:496-509`, not exported | `lib/business-os/finance/financeHealth.ts` | Export it (§2.1); never copy it |
| VL-9 | **The paying set is inline.** `payingRows = rows.filter(isPayingBillingRow)`, then `payingIds` and `paidTierHints` from `bought_tier`, at `financeHealth.ts:705-716`, before `classifyAccounts(…)` at `:717-719` | same | Extract into an exported `payingSetOf(rows)` that the page calls unchanged (§2.2) |
| VL-10 | **Section 1** is `classifyAccounts({ rows, payingIds, paidTierHints, window, now, config })`. It returns `figures`:<ul><li>`total`;</li><li>`groups[]`, each with `key`, `count`, `grace`, `pastDue` and `foundingPartners`, every group seeded;</li><li>`payingKnown`;</li><li>`byState`;</li><li>`foundingNoEndDate` (= K-3), `dormantFounding` and `endingIn30Days`</li></ul> | `planGroups.ts:150-172`, `financeTypes.ts:96-110` | The `plan` family maps these one to one (§1) |
| VL-11 | **Section 4** is `buildCreditsSection({ accountIds, groupOf, tierLabelOf, positions, lots, window, now, farOverAllowancePercent, displayCap })`. It returns:<ul><li>`figures` (`accounts`, `overAllowance`, `farOverAllowance`, null when the line is invalid, `unknownAccounts`, `noAllowanceAccounts`);</li><li>`gifted` (`outstanding` = K-4, `deletedAccountsOutstanding`);</li><li>the non-wire `rowByAccount`, which holds each account's `allowance` / `used`</li></ul>It has **no sum of allowance or used** | `creditsSection.ts:55-87, :218-300`; `financeTypes.ts:723-749` | The three credit sums are added up from `rowByAccount` in the builder (SA-W-8.2-2) |
| VL-12 | **No "bought outstanding" figure exists anywhere.** `giftedFigures` filters `source === 'admin_grant'` (`creditsSection.ts:170-215`). §11M.5 names "the 4b bought-credits figure", but 4b's Section 4 part is not built. The finance guard allows only `creditsSection.ts` and the wiring to name `extraCreditsAt` (`finance.source.guard.test.ts:270-277`) | `creditsSection.ts`; guard | The per-source outstanding loop is moved, unchanged, into an exported helper in `creditsSection.ts` that gifted and bought both use (§2.3, SA-W-8.2-3). The builder never names `extraCreditsAt` |
| VL-13 | **The credit pass.** `readAdminCreditPositions(ids, deps, log, { now, budgetMs })` defaults to `ADMIN_CREDITS_BUDGET_MS = 2 * 1000` and returns `{ outcome: 'ok' \| 'failed' \| 'timeout', byUserId }` | `lib/business-os/credits/adminCreditPercent.ts:127, :382-397` | The night budget is passed as an option, with no new read (E-87) |
| VL-14 | **The wiring and its pins.**<ul><li>`financeHealthDeps()` returns `plans.pagePlans`, `finance.listBillingStatusesAllAccounts`, `credits` (`adminCreditPercentDeps()`), `lots.allAccounts` (through `toFinanceLot`) and `config` (`financeHealthDeps.ts:107-…`).</li><li>Five caller lists pin it **by file name**: `creditLots.test.ts:235`, `businessOsEntitlements.imports.guard.test.ts:207, :231, :287`, `BusinessOsFinanceReadRepository.test.ts:563`, `BusinessOsCreditLedgerReadRepository.test.ts:1079`, `enforcementPoints.test.ts:545`.</li><li>The finance guard pins the entitlements importers to exactly `financeHealthDeps.ts` and `planGroups.ts` (`:227-228`)</li></ul> | the wiring and the tests | A narrow `financeSnapshotDeps.ts` that **picks from `financeHealthDeps()`** names no repository and imports no entitlements module. **No caller list changes** (SA-W-8.2-1) |
| VL-15 | **Missing-table helper.** `isMissingRelationError` (`42P01`, `PGRST205`, `PGRST202`; a missing column is **not** a missing relation) is pure and shared. `BosCronRunRepository` documents the precedent ("the table may not exist yet", the deliberate exception to the new-repository skill) | `lib/repositories/supabaseErrorCodes.ts:11-31`; `BosCronRunRepository.ts:15-20` | The new repository uses it the same way (§8) |
| VL-16 | **Pin D hashes only the `credit-leak-check` registry entry** (`m5WordingOnly.pin.test.ts:45-49`). The other six pins name no cron file | Pin D | All seven pins stay byte-identical |
| VL-17 | **The vocabulary guard scans `lib/cron/bosCronJobs.ts`**, with a text floor of 580 (`aiCostVocabulary.source.guard.test.ts:55, :190`) | guard | The new label, description, schedule words and count labels avoid every SA-Q51 word (no "cost", no "AI"). The floor only rises; the guard file is not edited |
| VL-18 | The lot repository header says its all-accounts read is reached "behind `requireAdmin`" (`BusinessOsCreditLotRepository.ts:41-48`) | header | The cron is a second, CRON_SECRET-gated door with no caller input. The header paragraph is amended, in words only (SA-W-8.2-1) |

---

## Scope

| In | Out |
|---|---|
| The pure builder `financeSnapshot.ts` and its pinned metric list<br>Reuse refactors in `financeHealth.ts` and `creditsSection.ts`<br>The narrow wiring<br>The writer repository<br>The job `financeSnapshotJob.ts` and the route `app/api/cron/finance-snapshot`<br>The registry entry and `vercel.json`<br>Guards and tests; checks 33 and 34 for QA | The read methods and route (8.3)<br>Any UI<br>A "Run now" button (VL-6)<br>Backfill<br>Pruning<br>Money metrics<br>Section 6 overdue history (DF-9)<br>Any migration<br>Any change to the page's payload, request or the seven pins |

---

## Questions for SA before code

| # | Question | Dev suggestion |
|---|---|---|
| **SA-W-8.2-1** (VL-14, VL-18) | SA-Q105 rules a narrow wiring "with one ruled update per caller list". Is a wiring that **picks from `financeHealthDeps()`** acceptable instead? | **Yes, suggested.**<ul><li>`financeSnapshotDeps()` returns `{ plans, finance: { listBillingStatusesAllAccounts }, credits, lots: { allAccounts }, config }`, taken from `financeHealthDeps()` and typed by a `Pick` of `FinanceHealthDeps`.</li><li>It names no repository and imports no entitlements module. So none of the five caller lists, the RC-15 pin or the entitlements-importer pin changes, and the reads are the page's reads by construction (HS-W-7).</li><li>Cost: building the page's whole deps object, a handful of closures and no I/O.</li><li>The lot repository's header gains one sentence about the cron door (VL-18).</li></ul>If SA prefers its own `Pick`s of the repositories, I add the five ruled list entries instead |
| **SA-W-8.2-2** (VL-11) | Section 4 has no allowance or used sum | The builder sums `rowByAccount` rows of kind `position` in **micro-credits**, as integers (the `toMicro` scale, 1e6), and divides once. `credit_included_left` = Σ max(allowance − used, 0). All three only when `unknownAccounts === 0` (HS-W-5) and every sum is a safe integer, otherwise skipped. No second definition of a position |
| **SA-W-8.2-3** (VL-12) | "Bought outstanding" has no existing figure | Move the body of `giftedFigures`' per-account loop (`creditsSection.ts:173-198`) into an exported **`outstandingBySource(lots, source, now)`**, which returns `{ byAccount, total, deletedTotal, inconsistentAccounts }` (null totals when unreadable). `giftedFigures` calls it with `'admin_grant'`; the builder calls it with `'boost_purchase'`. Behaviour is unchanged: the creditsSection tests and AC-145 hash are the proof. Until BQ-13 is answered a refunded boost keeps its lot, so the figure follows the lots |
| **SA-W-8.2-4** (VL-7) | The adoption test runs every cron at the real clock, and the late gate depends on that clock | The route takes its start from `financeSnapshotClock.now()` in `lib/business-os/finance/financeSnapshotClock.ts` (one function, `new Date()`). The adoption test gains **one additive `jest.mock`** of that module, returning 00:07 UTC, so the job is "succeeded" whatever the hour. The route's own tests use the same seam for the late, on-time and D − 1 cases. No existing line of that test is edited |
| **SA-W-8.2-5** (§8) | What a run does before `20261078` is applied | Probe first: `probeTable()` is a `select('id').limit(1)` with no reads before it. On a **missing relation**, it logs one `error` line `{ tableMissing: true }`, returns **503** `{ success: false, error: 'The finance history table is not installed yet' }` and reads nothing. The run record shows "failed". Any other probe error is a 500. No new count key (HS-FR-3 unchanged) |
| **SA-W-8.2-6** (VL-6) | "Run now" | **Not in 8.2.** The page has no job-level Run now. The Reconcile pattern is deliberately not one (SA SQ-1). A manual press after 02:00 would only hit the late gate. A Run now would need its own requirement |
| **SA-W-8.2-7** | Where the far-over line comes from | `farOverAllowancePercentOf(FINANCE_METRIC_PARAMS)` (`financeRules.ts:110-115`), as the page does at `financeHealth.ts:925-926`. A null line skips `credit_far_over_allowance` only |
| **SA-W-8.2-8** | `classifyAccounts` wants a window (for "new in window", which is not snapshotted) | Pass `{ start: now, end: now }`. The empty window makes `newInWindow` 0, and it is never written. Every other figure is "as of now" |

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/financeSnapshot.ts` | Pure builder; `SNAPSHOT_METRICS` (pinned list); `buildFinanceSnapshot(input)` → `{ rows, familiesSkipped, metricsSkipped }` |
| `lib/business-os/finance/financeSnapshotJob.ts` | `runFinanceSnapshot({ startedAt }, deps, logger)`: late gate, probe, reads, builder, insert. `SNAPSHOT_LATEST_START_HOUR_UTC = 2`, `SNAPSHOT_CREDIT_BUDGET_MS = 30 * 1000` |
| `lib/business-os/finance/financeSnapshotDeps.ts` | `import 'server-only'`; picks from `financeHealthDeps()` and binds the writer repository |
| `lib/business-os/finance/financeSnapshotClock.ts` | `export const financeSnapshotClock = { now: () => new Date() }` (SA-W-8.2-4) |
| `lib/repositories/BusinessOsFinanceSnapshotRepository.ts` | `probeTable()`, `insertSnapshotRows(rows)` |
| `app/api/cron/finance-snapshot/route.ts` | The cron door |
| `lib/business-os/finance/__tests__/financeSnapshot.test.ts` | Builder |
| `lib/business-os/finance/__tests__/financeSnapshotJob.test.ts` | Job |
| `lib/repositories/__tests__/BusinessOsFinanceSnapshotRepository.test.ts` | Repository |
| `app/api/cron/finance-snapshot/__tests__/route.test.ts` | Route |

### Modify

| File | Anchor | Change |
|---|---|---|
| `lib/business-os/finance/financeHealth.ts` | `:496` | `async function walkPlans` → `export async function walkPlans` |
| same | `:705-716` | The paying derivation moved into `export function payingSetOf(rows: readonly FinanceBillingStatusRow[] \| null)` → `{ payingIds, paidTierHints }`, called at the same place; byte-identical behaviour |
| `lib/business-os/finance/creditsSection.ts` | `:170-215` | `outstandingBySource` extracted (SA-W-8.2-3); `giftedFigures` calls it |
| `lib/cron/bosCronJobs.ts` | `:30-47`, before `:616` | `'finance-snapshot'` in the union; one entry (§7) |
| `vercel.json` | after `:76` | `{ "path": "/api/cron/finance-snapshot", "schedule": "7 0 * * *" }` |
| `lib/cron/__tests__/bosCronJobs.test.ts` | `:46-52` | Title, comment and `toHaveLength(18)` ("18th: finance-snapshot (finance slice 8.2)") — **ruled** |
| `lib/cron/__tests__/vercelCrons.test.ts` | `:90-91`, `:102-105` | One appended `BOS_CRONS` row; title and `toHaveLength(18)` — **ruled** |
| `app/api/cron/__tests__/runRecord.adoption.test.ts` | after `:46` | One **additive** `jest.mock('@/lib/business-os/finance/financeSnapshotClock', …)` (SA-W-8.2-4) |
| `lib/repositories/BusinessOsCreditLotRepository.ts` | header `:41-48` | One sentence: the nightly finance snapshot cron also reaches the read, through `financeSnapshotDeps` → `financeHealthDeps`, behind `CRON_SECRET`, with no caller input |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | end | A new `describe('slice 8.2 …')` (guard table); no existing line edited |

**Not touched** (checked with `git diff --exit-code`):
- `route.ts` of the finance page, `financeHealthDeps.ts`, every finance page component, the seven pins, AC-145's region;
- `supabase/**`, `lib/business-os/entitlements/**`;
- the five caller-list tests (if SA-W-8.2-1 is accepted);
- the aiCost vocabulary guard file.

---

## 1. The pure builder

**File:** `lib/business-os/finance/financeSnapshot.ts`. It imports only `./planGroups` (`classifyAccounts`, `ClassifyInput` type), `./creditsSection` (`buildCreditsSection`, `outstandingBySource`, `FinanceLot` type), `./financeSnapshotShape`, and types from `./financeTypes` / `@/lib/business-os/credits/adminCreditPercent` (type only). It has no repository, no clock, no entitlements path, no `extraCreditsAt` and no tier literal.

```typescript
export interface FinanceSnapshotInput {
  asOfDate: string;                       // YYYY-MM-DD, D − 1 of the run's UTC start
  now: Date;                              // the run's start, the "as of" instant
  plans: { rows: readonly BusinessOsAccountPlan[]; capped: boolean } | null; // null = walk failed
  paying: { payingIds: ReadonlySet<string>; paidTierHints: ReadonlyMap<string, string> } | null; // null = billing read failed
  config: ClassifyInput['config'];
  positions: AdminCreditPositionsPass | null;       // null = not run (walk failed or capped)
  lots: readonly FinanceLot[] | null;               // null = lots read failed
  farOverAllowancePercent: number | null;
}
export interface SnapshotRow { as_of_date: string; metric: SnapshotMetric; dimension: string; unit: 'accounts' | 'credits'; value: number }
export function buildFinanceSnapshot(input: FinanceSnapshotInput): { rows: SnapshotRow[]; familiesSkipped: number; metricsSkipped: number };
```

| Family | Condition to write (HS-W-5) | Rows (§11M.5) |
|---|---|---|
| `plan` | `plans` is set and not `capped`, and `paying` is set (so `payingKnown`), and **every** plan row passes `SNAPSHOT_DIMENSION_SHAPE` / `SNAPSHOT_METRIC_SHAPE` (E-86). Otherwise the whole family is skipped | `accounts_total` (`total`, `all`); per group: `accounts_in_group` (`count`), `accounts_in_grace` (`grace`), `accounts_past_due` (`pastDue`); per `byState` key: `accounts_in_state`; `founding_no_end_date`, `founding_dormant`, `accounts_ending_soon` (`all`) |
| `credit`, counts | `positions?.outcome === 'ok'` and the walk is usable | `credit_accounts`, `credit_over_allowance`, `credit_unknown_accounts`, `credit_no_allowance_accounts`; `credit_far_over_allowance` only when the line is valid (else `metricsSkipped += 1`) |
| `credit`, sums | as counts, **and** `unknownAccounts === 0` and safe sums (SA-W-8.2-2) | `credit_allowance`, `credit_used`, `credit_included_left` (else `metricsSkipped += 3`) |
| `lots` | `lots` is set | `gifted_outstanding` (`gifted.outstanding`), `gifted_outstanding_deleted` (`deletedAccountsOutstanding`), `bought_outstanding` (`outstandingBySource(lots, 'boost_purchase', now).total`). A null part is skipped (`metricsSkipped`) |
| `lots`, total | all three of `credit_included_left`, `gifted_outstanding`, `bought_outstanding` written | `credit_outstanding_total` = their sum in micro-credits |

- **Same functions, same `now`.** `classifyAccounts({ rows, payingIds, paidTierHints, window: { start: now, end: now }, now, config })`. Then `buildCreditsSection({ accountIds: rows.map(user_id), groupOf, tierLabelOf: () => null, positions: byUserId, lots, window: { start: now, end: now }, now, farOverAllowancePercent, displayCap: 0 })`. A display cap of 0 is valid, because the counts cover every account and `rowByAccount` holds them all.
- **Values.** Accounts are integers. Credits are rounded to 6 decimals through the micro scale. A non-finite value or a negative one (impossible by construction) skips that metric.
- **`SNAPSHOT_METRICS`** is an exported `as const` list of the 21 metric names of §11M.5. A test pins it, and pins that it holds no `revenue`, `cost`, `fee`, `takings`, `usd` or `currency` token (AC-285).
- **Family skip, never a batch failure (E-86).** A tier id that breaks the shape (for example `tier:Pro Plus`) drops the `plan` family only. `familiesSkipped` is 1, and `credit` / `lots` are still written.

## 2. Reuse refactors (no behaviour change)

1. **`walkPlans`** is exported as it is (`financeHealth.ts:496`).
2. **`payingSetOf(rows)`** returns `{ payingIds: null, paidTierHints: empty }` when `rows` is null. The page calls it where lines `:705-716` were, and every variable keeps its name. AC-145's payload hash and the existing 1a / 1c classifier tests prove nothing moved.
3. **`outstandingBySource(lots, source, now)`** is the old per-account loop with the `source` filter as a parameter. `giftedFigures` becomes `const g = outstandingBySource(lots, 'admin_grant', input.now)` plus the unchanged `accountsNotListed` and window parts. The existing `creditsSection.test.ts` cases and the AC-145 hash must stay green unedited.

## 3. The wiring

**File:** `lib/business-os/finance/financeSnapshotDeps.ts` (per SA-W-8.2-1)

```typescript
import 'server-only';
import { financeHealthDeps } from './financeHealthDeps';
import { businessOsFinanceSnapshotRepository } from '@/lib/repositories/BusinessOsFinanceSnapshotRepository';
import type { FinanceHealthDeps } from './financeHealth';

export type FinanceSnapshotReads = Pick<FinanceHealthDeps, 'plans' | 'credits' | 'config'> & {
  finance: Pick<FinanceHealthDeps['finance'], 'listBillingStatusesAllAccounts'>;
  lots: Pick<FinanceHealthDeps['lots'], 'allAccounts'>;
};
export function financeSnapshotDeps(): FinanceSnapshotReads & { writer: Pick<BusinessOsFinanceSnapshotRepository, 'probeTable' | 'insertSnapshotRows'> };
```

It is read-only apart from the one writer. No `findNames`, no ledger read, no recorded read and no account-scoped read crosses it.

## 4. The writer repository

**File:** `lib/repositories/BusinessOsFinanceSnapshotRepository.ts`, built with the `new-repository` skill.
- **Client and log.** `supabaseServer` by injection; `createLogger({ service: 'BusinessOsFinanceSnapshotRepository' })`.
- **Header: no `.eq('user_id')`.** The table has no `user_id`; it holds platform aggregates (CLAUDE.md rule 4 bypass, HS-W-8). The header also records "the table may not exist yet": the `BosCronRunRepository` precedent (VL-15), a deliberate exception to the skill's step 1.

| Method | Query | Returns |
|---|---|---|
| `probeTable()` | `.from('business_os_finance_snapshots').select('id').limit(1)` | `{ data: { installed: true } }`; or `{ data: { installed: false } }` when `isMissingRelationError`; or `{ error }` |
| `insertSnapshotRows(rows)` | One call: `.from(…).upsert(rows.map(pick5), { onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }).select('id')` (E-88). `pick5` builds `{ as_of_date, metric, dimension, unit, value }` **field by field**, never with a spread (tenant-isolation-guard step 3). An empty list makes no call | `{ data: { written: ids.length, alreadyThere: rows.length − ids.length } }`, or `{ error }` (never throws) |

- **No update, delete or select-for-read method.** 8.3 adds the reads.
- A source pin forbids `.update(`, `.delete(`, `.rpc(` and a spread in the insert.
- An error is logged with `{ err }`, the method name and the row count. A row value is never logged.

## 5. The job

**File:** `lib/business-os/finance/financeSnapshotJob.ts`. `runFinanceSnapshot({ startedAt }, deps, logger)` never throws; any read throw becomes that family's skip.

| Step | Rule |
|---|---|
| 1 | `asOfDate` = the UTC date of `startedAt` minus one day (HS-W-2). |
| 2 | **Late gate (HS-W-3):** `startedAt.getUTCHours() >= SNAPSHOT_LATEST_START_HOUR_UTC` gives `{ kind: 'late', asOfDate }`, with counts all 0 except `lateRun: 1`. Nothing is read or written. |
| 3 | **Probe (SA-W-8.2-5):** `writer.probeTable()`. `installed: false` gives `{ kind: 'not_installed' }`; an error gives `{ kind: 'probe_failed' }`. Nothing else is read. |
| 4 | **Reads**, as the page does, each settled:<ul><li>`walkPlans(deps.plans)` and, in parallel, `deps.finance.listBillingStatusesAllAccounts()` and `deps.lots.allAccounts()`;</li><li>then, chained on a usable walk, `readAdminCreditPositions(ids, deps.credits, logger, { now: startedAt, budgetMs: SNAPSHOT_CREDIT_BUDGET_MS })` (E-87).</li></ul>A failed or capped walk runs no pass, as on the page. |
| 5 | `buildFinanceSnapshot({ asOfDate, now: startedAt, plans, paying: payingSetOf(billing.data), config: deps.config, positions, lots, farOverAllowancePercent: farOverAllowancePercentOf(FINANCE_METRIC_PARAMS) })`. |
| 6 | **One insert**, `writer.insertSnapshotRows(rows)`. An error gives `{ kind: 'insert_failed' }`. |
| 7 | Result `{ kind: 'done', asOfDate, counts: { metricsWritten, metricsAlreadyThere, metricsSkipped, familiesSkipped, accountsRead, lateRun: 0 } }`. `accountsRead` is the plan rows walked (0 when the walk failed). |

The budget constant has a test that `SNAPSHOT_CREDIT_BUDGET_MS < 60 * 1000` (the route's `maxDuration`), and that it differs from `ADMIN_CREDITS_BUDGET_MS`, so the page keeps 2 s.

## 6. The route

**File:** `app/api/cron/finance-snapshot/route.ts`. The header says, as `credit-leak-check` does:
- not a queue drain (HS-W-11);
- fail-closed;
- counts only, no money;
- the late rule;
- the missing-table behaviour.

| Result | HTTP | Body | Log |
|---|---|---|---|
| refused secret | 401 | `{ success: false, error: 'Unauthorized' }` | `warn` (plus the `error` for a missing secret) |
| `done` | 200 | `{ success: true, data: { asOfDate, metricsWritten, metricsAlreadyThere, metricsSkipped, familiesSkipped, accountsRead, lateRun } }` | one `info` with `asOfDate`, the counts and `durationMs` (HS-FR-7) |
| `late` | 200 | same shape, `lateRun: 1`, the rest 0 | `warn` "Finance snapshot run started too late; nothing written" |
| `not_installed` | **503** | `{ success: false, error: 'The finance history table is not installed yet' }` | `error` `{ tableMissing: true }` |
| `probe_failed`, `insert_failed`, a thrown defect | 500 | `{ success: false, error: 'Internal server error', details: dev only }` | `error` `{ err }` |

Other route rules:
- `runtime = 'nodejs'`, `maxDuration = 60`.
- `const logger = createLogger({ module: 'FinanceSnapshotCron' })`, then `logger.child({ correlationId })`.
- `export const GET = withCronRunRecord('finance-snapshot', runJob)`.
- The start time is `financeSnapshotClock.now()` (SA-W-8.2-4).

## 7. Registry and schedule

**`lib/cron/bosCronJobs.ts`:** `| 'finance-snapshot'` is added to `BosCronJobId`, and this entry is added after `payment-reminders`:

```typescript
{
  /*
   * Finance slice 8.2 (§11M.7): last night's plan mix and credit position, one
   * idempotent insert. Not a queue drain (HS-W-11): nothing is claimed, and a
   * second run the same day writes nothing new.
   */
  id: 'finance-snapshot',
  path: '/api/cron/finance-snapshot',
  schedule: '7 0 * * *',
  ...DAILY,
  ...MAX_60,
  label: 'Finance history snapshot',
  description: "Records last night's plan mix and credit position for the Finance history",
  scheduleWords: 'Daily at 00:07 UTC',
  addedOn: '<deploy day, set by RM in the PR>',
  drainsQueue: null,
  counts: [
    { key: 'metricsWritten', path: ['data', 'metricsWritten'], label: 'figures written' },
    { key: 'metricsAlreadyThere', path: ['data', 'metricsAlreadyThere'], label: 'figures already recorded for the day' },
    { key: 'metricsSkipped', path: ['data', 'metricsSkipped'], label: 'figures not recorded (source unreadable)' },
    { key: 'familiesSkipped', path: ['data', 'familiesSkipped'], label: 'groups of figures not recorded' },
    { key: 'accountsRead', path: ['data', 'accountsRead'], label: 'businesses read' },
    { key: 'lateRun', path: ['data', 'lateRun'], label: 'started too late to record (1 = yes)' },
  ],
  partlyDoneWhen: [
    { kind: 'atLeast', key: 'familiesSkipped', value: 1 },
    { kind: 'atLeast', key: 'lateRun', value: 1 },
  ],
},
```

- **`addedOn`** must be the real deploy day (QA4b-B1): RM sets it in the PR, never earlier.
- **`metricsSkipped` alone does not make a run partly done.** HS-FR-3 lists only the two conditions above, and a configured far-over line that is invalid would otherwise colour every night amber. Recorded here; SA may add it.
- **`vercel.json`:** the row is appended after `bos-billing-reconcile`, and `vercelCrons.test.ts` `BOS_CRONS` gains the same row last.

## 8. Safety before 20261078 is applied

**Why this is unlikely to be needed:** the PR opens only after #452 merges, and #452 merges only after the user applies `20261078`. So in the normal order the table exists before this code deploys. The guard below covers a revert, a renamed table or a wrong environment.

| What | Behaviour |
|---|---|
| The first thing after the late gate | `probeTable()`. A **missing relation** (`42P01` / `PGRST205`) is recognised by the shared `isMissingRelationError`. A missing *column* is **not** treated as missing: it is a real defect, so it gives a 500 |
| On missing | Nothing is read (no 30 s pass) and nothing is written. One `error` log `{ tableMissing: true }` carries the correlation id; the response is 503 |
| What the admin sees | The run record (`>= 400` gives `failed`, `http_error`) shows "Last run failed" on Jobs & queues, and "Keeps failing" (red) after 2 nights (`DAILY.keepsFailingAfter`) |
| No crash loop | Vercel cron calls once a day and does not retry a failed call. The route never throws: every path returns a response. The recorder's own missing-table backoff is untouched |
| Recovery | Apply `20261078`; the next 00:07 run writes. Missed days stay gaps (HS-W-6, BQ-19) |

## 9. Tenant isolation and money

The `tenant-isolation-guard` skill is applied:
- **No caller input:** the route takes no body, query or header beyond the secret. The time comes from the server clock.
- **Allow-listed write:** the five fields are built field by field (§4). `id` and `taken_at` are database defaults, and the 8.1 grants refuse them anyway.
- **No account id in a row:** `dimension` is a group key, a state or `all`. It is checked against `SNAPSHOT_DIMENSION_SHAPE`, which refuses a uuid. A test plants an account id as a group key and as a state, and the plan family is skipped.
- **No name, email, admin id, reason or Stripe id** is read into the builder: lots cross `toFinanceLot`, which carries none of the reason fields, and the builder emits only metric names from `SNAPSHOT_METRICS`.
- **No money:** `unit` is `accounts` or `credits` only, and the count keys pass the registry's money rule.

---

## Guard table, line by line

| Guard | Expected | Action |
|---|---|---|
| `npm run test:authz-guard` | Pass, no edit | The new route is under `app/api/cron/**`, not `app/api/admin/**` |
| `bosCronJobs.test.ts` | 17 → 18 (**ruled**); the entry matches `vercel.json` byte for byte and `maxDuration` 60; keys pass the key and money rules; `addedOn` set; the file imports nothing | `:46-52` edited |
| `vercelCrons.test.ts` | `BOS_CRONS` +1 row, 17 → 18 (**ruled**) | `:90-91`, `:102-105` |
| `runRecord.adoption.test.ts` | Runs the new route; `succeeded` with the fixed clock | One additive `jest.mock` (SA-W-8.2-4) |
| Jobs page and Health tests (VL-5) | Pass, no edit (length-based) | Run |
| Seven frozen pins (AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`; Pin A `30f5fc24…2e01`; Pin B `24ff0da7…df9f`; Pin C `98ea0507…1e4b`, helper `02813360…5bd8`; Pin D `1f7cf07a…f144`) | Byte-identical; Pin D hashes only `credit-leak-check` (VL-16) | Hash at Step 0 and handover |
| AC-145 payload baseline (`route.test.ts`) | Unchanged hash (proves the §2 refactors moved nothing) | Run |
| `aiCostVocabulary.source.guard.test.ts` | Pass, no edit; the `bosCronJobs.ts` text count rises | Run |
| `finance.source.guard.test.ts` | Existing rules pass unedited: the entitlements importers are still exactly two; `extraCreditsAt` namers are still `creditsSection.ts` and the wiring; the lot calls are still the wiring's two | New 8.2 `describe`, each rule with a planted control:<ul><li>`financeSnapshot.ts` is pure (no repository, Supabase, server-only, entitlements or clock; no `extraCreditsAt`; no tier literal);</li><li>`financeSnapshotDeps.ts` names no repository except the snapshot writer, and imports `financeHealthDeps`;</li><li>`SNAPSHOT_METRICS` holds no money token;</li><li>the job passes `budgetMs: SNAPSHOT_CREDIT_BUDGET_MS`</li></ul> |
| `npm run test:bos-entitlements` | Pass; no entitlements import added (VL-14) | Run |
| `tierLiteral.forbidden.test.ts`, `serverModulesStayServer.guard`, `anon-default-repositories.guard`, `no-deletion-paths.guard` | Pass | Run |
| Caller lists (`creditLots.test.ts:235`, RC-15 `:207/:287`, `BusinessOsFinanceReadRepository.test.ts:563`, ledger `:1079`, `enforcementPoints.test.ts:545`) | **Unedited** if SA-W-8.2-1 is accepted | Run |
| Lint and types | `lint:hooks`, eslint, scoped `tsc` with a canary | Run |

## Test plan

| File | What it asserts |
|---|---|
| `financeSnapshot.test.ts` | <ul><li>**AC-280:** for one fixture (plans, billing, positions, lots, the fixed `now`), every `plan` row equals `classifyAccounts`' figures, and `credit` / `lots` equal `buildCreditsSection`'s figures and K-2, K-3 and K-4. A second case runs **`buildFinanceHealth`** on the same fixture with no business picked and compares its `accounts.figures`, `credits.figures`, `credits.gifted` and `tiles.k2/k3/k4` with the rows.</li><li>**AC-283:** every seeded group is written, zeros included, and Σ `accounts_in_group` = `accounts_total`.</li><li>**AC-282, every skip:** a failed walk, a capped walk or a failed billing read → no `plan` rows. A failed or timed-out pass → no `credit` rows. One unknown account → counts written, the three sums skipped. An invalid line → only `credit_far_over_allowance` skipped. Failed lots → no `lots` rows and no total. A bad tier key (E-86) → `plan` skipped and the others written. Each case asserts `familiesSkipped` / `metricsSkipped`, and never a 0 for a missing figure.</li><li>**Micro sums** are exact (3 × 0.1 credits = 0.3), and an unsafe sum is skipped.</li><li>**`bought_outstanding`** counts `boost_purchase` lots only, expired lots give 0, and drawn lots give the remainder.</li><li>**AC-284:** a planted account uuid as a group key or a state skips `plan`, and no row ever holds a uuid shape.</li><li>**AC-285:** `SNAPSHOT_METRICS` is pinned, every unit is `accounts` or `credits`, and every metric matches `SNAPSHOT_METRIC_SHAPE`.</li></ul> |
| `financeSnapshotJob.test.ts` | <ul><li>**AC-279:** a start at `2026-10-18T00:07Z` gives `asOfDate` `2026-10-17`; the year and month rolls are covered (01-01 gives the previous 12-31); 01:59:59 runs; 02:00:00 is late, with no read or write called and `lateRun: 1`.</li><li>**E-87:** the pass is called with `budgetMs: 30000`; the constant is below 60 s and not 2 s.</li><li>A walk at the ceiling runs no pass.</li><li>The probe: missing gives `not_installed` with **zero** read calls; an error gives `probe_failed`.</li><li>**AC-281:** the insert gets exactly the builder rows; written and already-there come from the repository; a second run with the same rows gives 0 written. An insert error gives `insert_failed`.</li><li>A throwing read becomes a skip, never a throw.</li></ul> |
| `BusinessOsFinanceSnapshotRepository.test.ts` | <ul><li>`upsert` is called once with `{ onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }`, then `.select('id')`; each row object has exactly the five keys (a planted extra field on the input does not pass through); written and already-there are computed from the returned ids; an empty list makes no call.</li><li>An error → `{ error }`; a missing relation in the probe → `installed: false`; `42703` → `{ error }`.</li><li>Source pin: no `.update(`, `.delete(`, `.rpc(` or `user_id`; the header documents the bypass.</li></ul> |
| `app/api/cron/finance-snapshot/__tests__/route.test.ts` | <ul><li>**AC-278:** production without `CRON_SECRET` → 401 and an `error` log; a wrong bearer → 401; development without a secret → runs.</li><li>`done` → 200 with the seven `data` keys, numbers only.</li><li>Late → 200 with `lateRun: 1`.</li><li>`not_installed` → 503 with the fixed message and an `error` `{ tableMissing: true }`.</li><li>`insert_failed` → 500 with no details outside development.</li><li>The `info` line carries no value, account id or name.</li><li>`maxDuration` 60 and `runtime` `nodejs`.</li></ul> |
| `bosCronJobs.test.ts`, `vercelCrons.test.ts` | Ruled count edits; **AC-286** through the existing rules |
| `runRecord.adoption.test.ts` | The new route is recorded `succeeded`, with registered numeric counts |
| `creditsSection.test.ts`, `financeHealth.test.ts`, the finance route tests | Unedited and green (proves §2) |
| `finance.source.guard.test.ts` | The 8.2 `describe` |

## AC mapping

| AC | Proven by |
|---|---|
| AC-278 | Route tests (401, development, the run record via the adoption test) |
| AC-279 | Job tests (D − 1, the 02:00 gate) |
| AC-280 | Builder test against `buildFinanceHealth`; check 34 on production (L-158) |
| AC-281 | Repository and job tests (E-88 call, written versus already there, the second run) |
| AC-282 | Builder and job skip matrix; the budget constant test |
| AC-283 | Builder test; check 33 `groups_match_total` (L-158) |
| AC-284 | Builder isolation test; repository five-field test; guard |
| AC-285 | `SNAPSHOT_METRICS` pin; unit test; the registry money rule |
| AC-286 | `bosCronJobs.test.ts`, `vercelCrons.test.ts`; L-156 |
| AC-293 (8.2) | The guard table; seven pins; AC-145; no new CI job |
| AC-294 (8.2) | L-156 to L-158, recorded in the QA Report |

## Verification plan

Each command runs alone with its own exit code. Never `git stash`, `git worktree remove` or `npm install`.

| # | Command |
|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` |
| V-2 | `npx jest lib/cron app/api/cron lib/admin/jobs lib/admin/health app/admin/__tests__/jobsQueues* app/api/admin/jobs-queues --ci` |
| V-3 | `npx jest lib/repositories/__tests__/BusinessOsFinanceSnapshotRepository.test.ts lib/business-os/credits --ci` |
| V-4 | `npm run test:authz-guard` |
| V-5 | `npm run test:bos-entitlements` |
| V-6 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` (file unedited) |
| V-7 | `npm run lint:hooks`; `npx eslint` on the touched files |
| V-8 | Scoped `tsc` with a canary in `financeSnapshot.ts`: config outside the worktree, the canary file restored byte-identical (`sha256sum -c`) |
| V-9 | The seven pin hashes |
| V-10 | `git diff --numstat` read first; `git diff --exit-code` on the "Not touched" list |

**QA after the deploy** (it needs 8.1 applied and 8.2 merged):
- **L-156:** Jobs & queues lists "Finance history snapshot", "Daily at 00:07 UTC", "No run yet".
- **L-157:** after the first night the run is green. Note `metricsWritten` (about 30 to 40), `familiesSkipped` (0) and `durationMs`.
- **L-158:** check 33 shows `groups_match_total` and `taken_after_day_end` true; check 34 shows the rebuilt gifted and bought figures equal to the snapshot.

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | A §2 refactor changes a page figure | Low | Behaviour-preserving moves; the AC-145 hash and the unedited 1a, 1b and 1c tests |
| R-2 | The night pass plus the walk exceeds 60 s as accounts grow | Low today | 30 s budget; a timeout skips only `credit`, and `durationMs` is recorded (L-157) |
| R-3 | A tier id with a capital or a space | Low | E-86 pre-check skips `plan` only; the other families still land |
| R-4 | The PR opens before #452 merges (a stacked PR) | Medium | The stacking rule in the header; RM checks `git merge-base --is-ancestor 0439f94f origin/main` first |
| R-5 | `addedOn` is set too early, so the job shows "Stopped" | Low | RM sets the deploy day; the existing QA4b-B1 rule |
| R-6 | The adoption test is flaky around midnight | Low | The fixed clock seam (SA-W-8.2-4) |
| R-7 | PostgREST does not see the 8.1 table | Low | 8.1's `NOTIFY pgrst`; the probe's 503 is visible on Jobs & queues |

## Estimate

**About 1.5 days** (§11M.13):
- builder and refactors with tests: 0.6 d;
- job, wiring and repository with tests: 0.4 d;
- route, registry, schedule and adoption: 0.25 d;
- guards, verification and handover: 0.25 d.

## Task List

- [x] ✅ Step 0: branch confirmed (`feature/bos-finance-health-8-2`, from `1eaa8f3d`); code read (VL-1 to VL-18)
- [x] ✅ Step 1: SA workplan review SA-WR-8.2 approved with conditions; rulings and 8.2-R1 to 8.2-R4 applied
- [x] ✅ Step 2: the seven pins hashed (all equal). No separate untouched-tree baseline was run: the 8.1 handover counts on the same base served as the baseline (D-4)
- [x] ✅ Step 3: §2 refactors (`walkPlans`, `PlanWalk` and `payingSetOf` exported; `outstandingBySource` extracted); the finance suites and the route's AC-145 baseline are green, unedited
- [x] ✅ Step 4: builder plus `financeSnapshot.test.ts` (18 tests: AC-280 against `buildFinanceHealth`, AC-282 to AC-285, 8.2-R1, 8.2-R3)
- [x] ✅ Step 5: repository plus tests (10 tests: AC-281, AC-284, E-96)
- [x] ✅ Step 6: wiring, clock, job plus `financeSnapshotJob.test.ts` (18 tests: AC-279, AC-281, AC-282, E-87, E-96)
- [x] ✅ Step 7: route plus tests (11 tests: AC-278, the late, 503 and 500 paths, 8.2-R4)
- [x] ✅ Step 8: registry entry, `vercel.json`, the ruled 17 → 18 edits, and the adoption-test clock mock (AC-286); the adoption test records the new job as `succeeded`
- [x] ✅ Step 9: the 8.2 source-guard `describe` (6 tests, 8.2-R2 and 8.2-R4 with planted controls); the lot repository header sentence
- [x] ✅ Step 10: verification, pins, Implementation Notes; status → Code Complete
- [ ] Step 11: after #452 merges, RM merges main into this branch, sets `addedOn` to the deploy day and opens the PR (BD-33 fast track)

## Implementation Notes

**Built 2026-10-17 in `neuronforge-finance-m8`, branch `feature/bos-finance-health-8-2`, uncommitted.** Dev edited the requirement MD only for the §0.1 workplan link, before the build.

### Files

| File | State |
|---|---|
| `lib/business-os/finance/financeSnapshot.ts` | New. Pure builder; `SNAPSHOT_METRICS` (20 metrics, §11M.5); the shape check runs on each **emitted** row (8.2-R1); a family is written whole or not at all |
| `lib/business-os/finance/financeSnapshotJob.ts` | New. Late gate, probe, the page's reads, builder, one insert. `SNAPSHOT_LATEST_START_HOUR_UTC = 2`, `SNAPSHOT_CREDIT_BUDGET_MS = 30 * 1000`, `snapshotDayOf` |
| `lib/business-os/finance/financeSnapshotDeps.ts` | New. `server-only`; picks from `financeHealthDeps()` and adds the writer (E-94) |
| `lib/business-os/finance/financeSnapshotClock.ts` | New. The one clock (E-97, 8.2-R4) |
| `lib/repositories/BusinessOsFinanceSnapshotRepository.ts` | New. `probeTable`, `insertSnapshotRows` (E-88); the header documents the `user_id` bypass and the not-installed exception |
| `app/api/cron/finance-snapshot/route.ts` | New. Fail-closed secret, recorded, 200 / 503 / 500 |
| `lib/business-os/finance/financeHealth.ts` | `export` on `walkPlans` and `PlanWalk`; `payingSetOf` extracted, same lines, same names |
| `lib/business-os/finance/creditsSection.ts` | `outstandingBySource` (K-4's loop with the source as a parameter); `giftedFigures` calls it |
| `lib/cron/bosCronJobs.ts`, `vercel.json` | `finance-snapshot`, `7 0 * * *`, last |
| `lib/repositories/BusinessOsCreditLotRepository.ts` | One header sentence about the cron door |
| Tests | 4 new files (`financeSnapshot`, `financeSnapshotJob`, repository, route). Edits: the 8.2 `describe` in the finance guard; the ruled 17 → 18 in `bosCronJobs.test.ts` and `vercelCrons.test.ts` (with one appended `BOS_CRONS` row); one additive `jest.mock` in `runRecord.adoption.test.ts` |

**Untouched** (`git diff --quiet` exit 0):
- `financeHealthDeps.ts` and the finance page route;
- the vocabulary guard;
- `supabase/` and `lib/business-os/entitlements/`;
- the five caller-list tests (`creditLots`, RC-15, `BusinessOsFinanceReadRepository`, the ledger read, `enforcementPoints`): E-94 held.

### Deviations

| # | Deviation | Reason |
|---|---|---|
| D-1 | `PlanWalk` is exported along with `walkPlans` | The job's `settle<PlanWalk>` needs the type. It is type only, with no behaviour change |
| D-2 | The two new test files take the plan row type as `ClassifyInput['rows'][number]` rather than importing it from `BusinessOsAccountPlanRepository` | RC-15 (`businessOsEntitlements.imports.guard.test.ts:334`) forbids any non-registered file, tests included, from naming that repository. The first full run failed there, and this fixes it with no guard edit |
| D-3 | `addedOn` is `'2026-10-18'` for now, with a comment for RM | It must be the real deploy day (QA4b-B1). RM sets it in the PR, once #452 has merged |
| D-4 | No separate baseline run before Step 3 | The base is the 8.1 tip, whose suites were recorded at the 8.1 handover. After the refactor, the finance suites and the AC-145 baseline passed unedited |
| D-5 | One timing flake: `qa-slice5-pr2.route.test.ts` (its 5 s deadline cases) failed once while six suites ran back to back | It passed alone (11/11), and on the rerun of the whole cron and jobs group (44/44). 8.2 does not touch it |

### SA conditions

- **8.2-R1:** `familyRows` checks every emitted row against `SNAPSHOT_METRIC_SHAPE` / `SNAPSHOT_DIMENSION_SHAPE` and that `accounts` values are whole. One bad row skips its family only. Tests:
  - a `tier:Pro Plus` key skips `plan`, while `credit` and `lots` are written;
  - a planted account uuid as a lifecycle state skips `plan`, and no row ever holds a uuid shape.
- **8.2-R2:** a guard over every non-test source in `app/` and `lib/`:
  - only `financeSnapshotDeps.ts` imports the writer;
  - only `financeSnapshotJob.ts` calls `.insertSnapshotRows(`;
  - no finance page file (the builder, `financeHealth.ts`, `financeHealthDeps.ts`, any `app/admin/finance` file) reaches it;
  - with a planted control.
- **8.2-R3:** `payingSetOf(null).payingIds === null`; `payingSetOf([])` gives an empty set (unit test). A null paying set skips `plan`.
- **8.2-R4:** the guard asserts no `new Date()` or `Date.now(` in the job or the route, and `financeSnapshotClock.now()` in the route; the route test pins the same.

### Verification (each command run alone; exit code read from the tool)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1a | `npx jest app/admin/finance --ci` | 0 | 19 suites, **649 passed** |
| V-1b | `npx jest lib/business-os/finance --ci` | 0 | 18 suites, **1788 passed** |
| V-1c | `npx jest app/api/admin/business-os/finance --ci` | 0 | 1 suite, **106 passed** (AC-145 baseline unedited) |
| V-2 | `npx jest lib/cron app/api/cron lib/admin/jobs lib/admin/health app/api/admin/jobs-queues app/admin/__tests__/jobsQueues --ci` | 0 | 44 suites, **1677 passed** (on the rerun, D-5) |
| V-2b | `npx jest app/admin/components --ci` | 0 | 25 suites, **824 passed** |
| V-3 | `npx jest lib/repositories lib/business-os/credits --ci` | 0 | 136 suites, **3497 passed** (after D-2) |
| V-6 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | 0 | **182 passed**, file unedited |
| V-4 | `npm run test:authz-guard` | 0 | 2 suites, **203 passed** |
| V-5 | `npm run test:bos-entitlements` | 0 | 285 suites, **8742 passed** |
| V-7 | `npm run lint:hooks`; `npx eslint` on the 18 changed and new `.ts` files | 0 / 0 | clean; one `no-require-imports` in the builder test fixed with a justified disable comment, as in the adoption test |
| V-8 | Scoped `tsc` (scratch `tsconfig.82.json` outside the worktree, 29 files: the changed and new files, the seven pins, the recorder, the Jobs view and read, and the finance route), with a canary in `financeSnapshot.ts` | 2 / 0 | Canary run: exactly **1** error, `financeSnapshot.ts(256,7) TS2322`. Restored from a copy: `sha256sum -c` OK, `grep -c __canary` = 0. Clean run: **0** errors (the DE TS2353 file is not in this set) |
| V-9 | Seven pins (LF-normalised SHA-256) | — | all equal: `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144` |
| V-10 | `git diff --numstat`; `console.` grep over the non-test touched files | — | no deletion-only file; no `console.` (grep exit 1) |

### Owed

- SA code review, then QA.
- RM: wait for #452 to merge, merge main into this branch (no rebase), set `addedOn` to the deploy day, open the PR, and turn on auto-merge (BD-33).
- After the first night: L-156 to L-158 (checks 33 and 34).

---

## SA Workplan Review

**Reviewed by SA, 2026-10-17, at `1eaa8f3d`.**
**Status: APPROVED WITH CONDITIONS (SA-WR-8.2).** Code may start. SA applied E-94 to E-97 to the requirement (§11M.5 `bought_outstanding`, and new HS-FR-8a and HS-FR-8b).

**Spot-checked in code:**
- `walkPlans` is module-private.
- The paying derivation is inline at `financeHealth.ts:705-716`; null billing gives `payingIds = null` and an empty map.
- The finance source guard's `WRITE_VERB` (`/\.(insert|update|upsert|delete|rpc)\s*\(/`) does **not** match `.insertSnapshotRows(`, so the folder's no-write rule holds, with the writer in `lib/repositories/`.
- The entitlements-importer pin (`:228`) and the `extraCreditsAt` namers pin (`:276`) are unaffected by a wiring that picks from `financeHealthDeps()`.

### Rulings

| # | Ruling |
|---|---|
| SA-W-8.2-1 | **Accepted. This amends SA-Q105 (E-94).** Picking from `financeHealthDeps()` is better than my own-`Pick`s ruling: the reads are the page's by construction, and no caller list moves. Building the page's deps object at night costs no I/O. The lot repository header gains its sentence |
| SA-W-8.2-2 | **Accepted.** Integer micro-credit sums from `rowByAccount` position rows, divided once. They are written only when `unknownAccounts === 0` and every sum is a safe integer |
| SA-W-8.2-3 | **Accepted (E-95).** `outstandingBySource` is K-4's loop with the source as a parameter. `bought_outstanding` uses **the same "existing accounts" rule as K-4** (its `total`, never `deletedTotal`), which also matches check 34's `user_id is not null`. The unedited `creditsSection.test.ts` and the AC-145 hash are the proof |
| SA-W-8.2-4 | **Accepted (E-97).** The clock is a seam, and the one additive `jest.mock` in the adoption test is allowed |
| SA-W-8.2-5 | **Accepted (E-96).** The probe comes first, then 503 with zero reads, shown as failed on Jobs & queues; Vercel does not retry |
| SA-W-8.2-6 | **Accepted.** No Run now |
| SA-W-8.2-7 | Accepted |
| SA-W-8.2-8 | Accepted. `{ start: now, end: now }`; `newInWindow` is never written |
| Partly done | Accepted as Dev wrote it: `metricsSkipped` alone does not colour a run amber; the count stays visible |

### Conditions

- **8.2-R1 (Medium).** The E-86 pre-check runs on **the rows the builder emits** (each `metric` and `dimension`: the group keys, the state names, `all`), not on the plan rows. One bad emitted `plan` dimension skips the whole `plan` family. A bad `credit` or `lots` row is impossible by construction, but if one is ever produced it skips its own family. The batch is never sent with a row the CHECKs would refuse.
- **8.2-R2 (Medium).** A new finance-guard rule, with a planted control, pins the writer to one path:
  - **only** `financeSnapshotDeps.ts` imports `BusinessOsFinanceSnapshotRepository`;
  - **only** `financeSnapshotJob.ts` calls `insertSnapshotRows`;
  - no finance-page file (the builder, `financeHealth.ts`, any `app/admin/finance` file) reaches the writer.
- **8.2-R3 (Low).** `payingSetOf` keeps the null / empty semantics exactly: `null` rows give `payingIds: null` (Section 1's "Unknown paying"), never an empty set. A unit test proves both cases.
- **8.2-R4 (Low).** `financeSnapshotClock` is the **only** clock in the job and route. A guard test checks that neither file has `new Date()` or `Date.now(`.

### Checked and fine

| Area | Result |
|---|---|
| Cron pattern | ✅ Fail-closed `CRON_SECRET` copied from `credit-leak-check`; `withCronRunRecord` into `bos_cron_runs`; the registry entry; `vercel.json` `7 0 * * *` (a free minute); ruled 17 → 18 edits. Not a queue drain (HS-W-11) |
| Repository writes | ✅ A new repository (`new-repository` skill), five fields built field by field, the E-88 upsert, no update / delete / rpc; the `user_id` bypass documented |
| Isolation | ✅ No caller input; platform aggregates only; a planted uuid skips `plan` |
| Budget and skips | ✅ 30 s, below `maxDuration`, the page stays at 2 s; HS-W-5 skip matrix in tests |
| Idempotency | ✅ The key, the second run writes 0 |
| Pins and CI | ✅ Seven pins untouched (Pin D hashes only the `credit-leak-check` entry); AC-145 unchanged; new Jest files only, no new CI job |
| Estimate | ✅ About 1.5 days accepted |

## SA Code Review

**Code Review by SA, 2026-10-17. Reviewed: the uncommitted tree on `feature/bos-finance-health-8-2`.**
**Status: Code Approved (SA-CR-8.2).** It carries one instruction for RM (`addedOn`).

### Checked

| Item | Result |
|---|---|
| 8.2-R1 | ✅ `familyRows` checks every **emitted** row (metric and dimension shape, whole accounts). A bad row skips its own family only, so the batch never carries a row the CHECKs would refuse |
| 8.2-R2 | ✅ The guard walks every non-test source in `app/` and `lib/`. The writer's only importer is `financeSnapshotDeps.ts` and the only `.insertSnapshotRows(` caller is the job; no finance page file reaches the writer; there is a planted control |
| 8.2-R3 | ✅ `payingSetOf(null)` gives `payingIds: null`, and the builder then skips `plan` (no folded "Tier set" enters history) |
| 8.2-R4 | ✅ `financeSnapshotClock` is the one clock: the job takes `startedAt`, and the guard proves neither the job nor the route has `new Date()` or `Date.now(` |
| Missing table | ✅ The late gate, then `probeTable()` before any read. A missing relation gives `not_installed` → 503 and one `error` `{ tableMissing: true }`; other errors give a 500 |
| Cron pattern | ✅ Fail-closed `verifyCronSecret` copied from `credit-leak-check`; `GET = withCronRunRecord('finance-snapshot', …)` writes `bos_cron_runs`; `runtime` nodejs and `maxDuration` 60. The registry entry is `7 0 * * *`, `DAILY`, `MAX_60`, with numeric no-money keys, and `vercel.json` matches. Not a queue drain (HS-W-11) |
| Idempotent write | ✅ One `upsert(…, { onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }).select('id')`, five fields built field by field; written = returned ids, already there = the rest. No update, delete or rpc |
| Budget | ✅ `SNAPSHOT_CREDIT_BUDGET_MS = 30 * 1000` is passed to `readAdminCreditPositions`. A failed or capped walk runs no pass; a non-`ok` pass skips `credit` |
| Aggregates only | ✅ No caller input. Rows are counts and credits; dimensions are group keys, states or `all`; no id, name or reason is read into the builder |
| Refactors | ✅ `walkPlans` and `PlanWalk` are now exported but otherwise unchanged. `payingSetOf` is the same lines, called in the same place. `outstandingBySource` is K-4's loop with the source as a parameter, and `giftedFigures` uses its outputs unchanged. **AC-145 hash green**, and `creditsSection.test.ts` is unedited and green |
| No duplicate logic | ✅ The builder calls `classifyAccounts`, `buildCreditsSection` and `outstandingBySource`; the credit sums are integer micro over `rowByAccount` |
| Seven pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a` |
| SA re-run | ✅ The 8.2 suites, `app/api/cron`, `lib/cron`, the finance guard, `creditsSection`, the finance route (AC-145) and `qa-slice5-pr2.route.test.ts`: **20 suites, 1720 passed** |

### Deviation rulings

| # | Ruling |
|---|---|
| D-1 | Approved: the `PlanWalk` export is type only |
| D-2 | Approved: `ClassifyInput['rows'][number]` keeps RC-15 untouched |
| D-3 | **Approved, with this instruction to RM.** Set `addedOn` to **the UTC date of the first scheduled 00:07 run after the production deploy**: the deploy's UTC date if it deploys before 00:07 UTC, otherwise the next day. RM sets it in the last commit before the PR merges, and changes it again if the merge slips. A date later than the first run is harmless (the job shows "No run yet"); an earlier one is not (it shows "Stopped"). `2026-10-18` is a placeholder only |
| D-4 | Approved: the 8.1-tip baseline plus the unedited suites suffice |
| D-5 | **Unrelated.** `qa-slice5-pr2.route.test.ts` is a 5 s deadline test that flakes under parallel load, the known chip `task_d3dcf2de`. 8.2 does not touch it; it reads the registry by length only. It passed in SA's run |

### Code Approved for QA: Yes

## QA Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:**
- **A + B + C:** Jest builder, job, repository, route, registry and guard suites, run one at a time.
- A code read of the route, job, builder and repository against every edge case.
- **The real builder's rows written into a local PGlite 0.5.8 database** with `20261011` (cron runs) and `20261078` applied, in the QA scratchpad and never production:
  - a temporary untracked probe test reused the builder test's fixtures verbatim, dumped the real rows to JSON, and was deleted;
  - `qa82db.mjs` wrote the rows as `service_role` the way PostgREST's `upsert(…, { onConflict, ignoreDuplicates: true }).select('id')` translates (`INSERT … ON CONFLICT (as_of_date, metric, dimension) DO NOTHING RETURNING id`), then ran check 33.
- A scoped tsc with a canary.

**Focus:** pipeline (cron), security, schema
**Skipped:** the production first night and checks 33 and 34 on production (user, L-156 to L-158 below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-health-8-2`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/finance` | 19/19, 649/649 |
| `lib/business-os/finance` | 18/18, 1788/1788 |
| `app/api/admin/business-os/finance` (AC-145 baseline) | 1/1, 106/106 |
| Cron: `lib/cron` + `app/api/cron` (registry, `vercel.json`, the adoption test with the new route, route tests) | 13/13, 495/495 |
| Jobs: `lib/admin/jobs`, `lib/admin/health`, `app/api/admin/jobs-queues`, `app/admin/__tests__/jobsQueues*` | 31/31, 1182/1182 |
| `lib/repositories` + `lib/business-os/credits` (the caller lists unedited) | 136/136, 3497/3497 |
| `app/admin/components` | 25/25, 824/824 |
| Vocabulary guard | 1/1, 182/182; unedited |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 285/285, 8742/8742 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts. The cron and jobs total is 44 suites and 1,677 tests. The `qa-slice5-pr2` flake (D-5) did not show.

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅.

**Untouched set:** `git diff --quiet HEAD` is clean on all of `app/admin`, `app/api/admin`, `lib/admin`, `financeHealthDeps.ts`, `supabase/` and `lib/business-os/entitlements`. The only test-file deletions are the two ruled 17 → 18 edits (`bosCronJobs.test.ts` 2, `vercelCrons.test.ts` 2).

**Scoped tsc:**
- Config in the scratchpad covering 24 files: the changed and new files plus the recorder, the `credit-leak-check` route, `financeHealthDeps`, the finance route and the Jobs view.
- A canary in `financeSnapshot.ts` gave `(256,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

### PGlite: the real builder's rows, written twice

| Check | Result |
|---|---|
| Rows from the full-night fixture | 36 rows, `familiesSkipped` 0, `metricsSkipped` 0 |
| First night (`as_of_date` = yesterday UTC) | `written 36, alreadyThere 0` as `service_role` ✅ |
| Second run, same day | `written 0, alreadyThere 36`: **idempotent** ✅ |
| Re-run with different figures | written 0; the first night's values stand ✅ |
| Stored values | every value equals the builder's (`numeric(18,6)`, no loss), e.g. `credit_used` 1700.35 ✅ |
| Credit sums | `credit_outstanding_total` 6529.65 = included-left 2399.65 + gifted 130 + bought 4000, exactly. Included-left is clamped per account (allowance 3500 − used 1700.35 would be 1799.65) ✅ |
| Groups | Σ `accounts_in_group` = `accounts_total` (3) ✅ |
| A row dated today | refused `23514` by `day_ended`: the table backs the job's D − 1 rule ✅ |
| PII | no stored dimension has a uuid shape ✅ |
| **Check 33** on the same database | 1 day: `snapshot_rows` 36, `credit_rows` 12, `groups_match_total` **true**, `taken_after_day_end` **true** (no run record yet, as expected) ✅ |

### Edge cases

| Case | Result | Evidence |
|---|---|---|
| Missing or wrong `CRON_SECRET` is refused (fail closed) | ✅ | route: production without a secret gives 401 and an `error` log, and the job never runs; a wrong bearer and no header each give 401; development runs. The code is the `credit-leak-check` copy |
| Table missing: 503, no reads, one log line | ✅ | job "not installed: zero reads, no insert"; route "503 … one error line `{ tableMissing: true }`". In the code the probe comes before every read, and the late gate before the probe |
| Second run the same day writes nothing new | ✅ | job test, plus PGlite (above) |
| A bad tier key skips only the plan figures | ✅ | builder "a tier key outside the shape skips the plan family only"; `familyRows` checks every emitted row (8.2-R1) |
| Paying unknown is never 0 | ✅ | `payingSetOf(null).payingIds === null` skips `plan` (8.2-R3); "never a 0 in place of a missing figure" |
| Credit totals are exact sums | ✅ | integer micro-credits, one division; PGlite sums exact |
| Nothing crosses currencies | ✅ | no money at all: units are `accounts` / `credits` only; the metric list is pinned with no money token (AC-285) |
| No per-account PII in rows or logs | ✅ | dimensions are shape-checked (a bare uuid is refused); "no log line carries a figure, an account id or a name". Logs carry counts and family names only. Five-field writer, no spread |
| The 30 s budget | ✅ | job: the pass gets `budgetMs: 30000`, below `maxDuration` 60, and the page keeps 2 s; a timeout skips `credit` only |
| Registry and `vercel.json` at 00:07 UTC | ✅ | `schedule: '7 0 * * *'`, "Daily at 00:07 UTC", path `/api/cron/finance-snapshot`, last in `vercel.json`; `bosCronJobs` and `vercelCrons` tests green |
| Finance page payload unchanged (AC-145) | ✅ | route test green; `app/api/admin` and `app/admin` untouched; the §2 refactors keep the existing finance tests green unedited |
| Only the job can reach the writer | ✅ | grep: the repository is named only by `financeSnapshotDeps.ts` and `financeSnapshotJob.ts` (plus itself); the 8.2-R2 guard with a planted control |

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-278 | PASS | route secret cases; the adoption test records the new job `succeeded` |
| AC-279 | PASS | job: D − 1 with month and year rolls; 01:59:59 runs; 02:00 is late with `lateRun` 1 and no reads |
| AC-280 | PASS (code), production owed | builder against `buildFinanceHealth`; check 34 on production is L-158 |
| AC-281 | PASS | repository E-88 call; job second run; PGlite idempotency |
| AC-282 | PASS | builder and job skip matrix |
| AC-283 | PASS | builder test; PGlite check 33 `groups_match_total` |
| AC-284 | PASS | builder isolation; repository five fields; log test; PGlite no uuid |
| AC-285 | PASS | metric list pin; units |
| AC-286 | PASS (code), L-156 owed | registry and `vercel.json` tests |
| AC-293 (8.2) | PASS | 7 pins; AC-145; vocabulary unedited; no new CI job |
| AC-294 (8.2) | NOT-TESTED (user) | L-156 to L-158 below |

### Issues Found
- **Bugs:** none.
- **Performance:** none. `durationMs` is to be recorded on the first night (L-157).
- **Edge cases / notes (nice to fix):**
  1. **RM, per SA-CR-8.2 D-3:** `addedOn: '2026-10-18'` (`lib/cron/bosCronJobs.ts:634`) is a placeholder. Set it to the UTC date of the first scheduled 00:07 run after the production deploy. An earlier date shows the job as "Stopped".
  2. **Low:** checks 33 and 34 exist only inside the requirement (§11M.9), not as `scripts/*.sql` files as checks 31 and 32 do. The user copies them from the MD (both are paste-safe: ASCII, 0 "into", 0 apostrophes in comments, one `;`, no `SET`).
  3. **Low, by design:** the dimension shape's tier branch (`tier:[a-z0-9_-]{1,40}`) would admit `tier:<uuid>`. Tier keys come from the entitlements config, never from an account, so no account id can reach it. A bare uuid is always refused.

### Manual live steps (user, after the deploy; read-only)

- **L-156, deploy day.** Open Jobs & queues. "Finance history snapshot" is listed, "Daily at 00:07 UTC", with no run yet. It is not red.
- **L-157, the morning after** (after 00:07 UTC):
  - The run is green ("Last run succeeded").
  - The counts show `metricsWritten` (about 30 to 40), `metricsAlreadyThere` 0, `familiesSkipped` **0** and `lateRun` 0.
  - From the Vercel log line "Finance snapshot recorded", note `durationMs`; it should be well under 60 s.
  - If the run is amber, `familiesSkipped` or `lateRun` is at least 1: send the counts to the session.
  - If it is red with "not installed", `20261078` is not applied.
- **L-158, checks 33 and 34** (Supabase SQL editor, each in a new tab; copy from requirement §11M.9):
  - **Check 33:** one row for yesterday, with `groups_match_total` **true**, `taken_after_day_end` **true**, and the run outcome succeeded.
  - **Check 34:** the rebuilt gifted and bought outstanding equal the snapshot's `gifted_outstanding` and `bought_outstanding`, and the plan totals match.
  - Any false or mismatch: stop and send the rows. Do not delete snapshot rows; the table is append-only.

### Final Status
- [x] All code-level 8.2 acceptance criteria pass. AC-294, and the production halves of AC-280 and AC-286, are the user's L-156 to L-158. No bugs. **Ready for RM:** open the PR only after #452 merges, merge main in, set `addedOn` per D-3 (BD-33).
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Dev: workplan written | From §11M (8.2 parts) with E-85 to E-93 and SA-WR-8.1, read against `1eaa8f3d`. VL-1 to VL-18. Eight questions for SA: the wiring built from `financeHealthDeps()` so that no caller list changes (-1), the credit sums (-2), bought outstanding (-3), the adoption-test clock (-4), the missing table (-5), no Run now (-6), the far-over line (-7) and the classifier window (-8). No code changed |
| 2026-10-17 | Dev: 8.2 implemented (uncommitted) | Builder, job, wiring, clock, repository, route, registry and schedule; refactors `walkPlans` / `payingSetOf` / `outstandingBySource`; 8.2-R1 to R4 met; 57 new tests plus the 8.2 guard; deviations D-1 to D-5; seven pins equal |
| 2026-10-17 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-8.2): SA-W-8.2-1 to -8 accepted; 8.2-R1 to R4; requirement E-94 to E-97 applied by SA. No code changed |
| 2026-10-17 | SA code review | Code Approved (SA-CR-8.2); addedOn rule for RM; D-5 flake unrelated |
