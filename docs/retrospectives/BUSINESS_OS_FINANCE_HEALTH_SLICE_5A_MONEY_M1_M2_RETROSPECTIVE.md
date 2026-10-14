# Retrospective: Business OS Finance & Business Health — Slice 5a (Money M-1 and M-2)

> **Last Updated**: 2026-10-14

## Overview

This is the retrospective for slice 5a of the read-only admin page `/admin/finance`. It is the first slice built after the user paused the slice-by-slice Finance work because that work was not producing a breakthrough. A BA consolidation review (docs PR #375) proposed one **Money** area, built in steps M-1 to M-8. Slice 5a covers the first two steps:

- **M-1 "One account, one screen."** Finance moved to the shared `AdminBusinessPicker`, and the original `BusinessAccountPicker.tsx` was deleted (342 lines, four guard edits). The chip names the business. With a business picked, an **account header** and an **account summary** appear, built only from figures already in the payload. The summary links to Activity, Costs & credits, AI cost & usage and the Businesses drawer, and each link carries the account and the window. The drawer links back with "Open money view", and `/admin/users` reads a one-shot `account` key.
- **M-2 "Plan payments received."** A new read pair, **R-m / R-m′**, on `business_os_billing_events` (`invoice_paid`, dated by `paid_at`, integer cents, ceiling 5,000). A pure builder, `planRevenue.ts`, and a pure combiner, `ourRevenue.ts`, which adds boost net and plans received **within one currency only** and shows K-5 only when both parts are exact. With a business picked, R-d is not called.

**Why it mattered.** When the user tested their own account, its USD 79.00 Basic plan was missing from the page, because plan amounts had never been built. After M-2 the account shows **USD 89.00** for plan plus boost (USD 79.00 + USD 10.00).

**What the slice did not add.** No migration, no new table, no write, no LLM call, no audit entry, no entitlements import, no tier literal and no new query parameter on the finance route.

**How the cycle ran.** The user believed M-1 and M-2 were "all UI". M-2 adds money reads, so it took the **full cycle** rather than the UI short path. The user pre-authorised commit and PR **without a diff review**.

1. BA requirement §11D (AC-108 to AC-129).
2. SA requirement review (SA-Q32 to SA-Q41, SA-RR-5a, findings S5-F1 to S5-F7).
3. RM cut `feature/bos-money-m1-m2` from `main` `392a9b53`.
4. Dev workplan, one for both parts (SA-W55 to SA-W73).
5. SA workplan review: approved with conditions (SA-WR-36 to SA-WR-40). One PR allowed, with a **hard M-1 checkpoint gate**: no `lib/` or `app/api/` change before M-2. Requirement edits E-40 to E-42 applied in place.
6. Implementation: M-1, then the checkpoint (green), then M-2. Deviations D-1 to D-6, all approved.
7. SA code review: **approved, no code condition**. Requirement edit E-43 applied in place.
8. QA: **pass with issues**, no bug, two Low notes.
9. Commit and PR by RM, under the user's pre-authorisation (no diff stop).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md) | [Slice 4a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_RETROSPECTIVE.md)

---

## What went well

- **The user's own gap is closed.** The trigger was concrete: "my $79 plan is not on the page". The slice was scoped to that, and QA's manual list (L-61, L-67, L-72) checks the exact USD 89.00 the user should see.
- **The second slice in a row with no fix round.** SA approved the code with no condition, and QA found no bug. This repeats 4a.
- **SA's corrections landed before code, not after.** S5-F1 (timestamps through `formatUtc`, not `formatUtcDate`, which would have shown "—") and the K-5 exactness rule (a figure only when both parts are exact) were requirement findings. Both were built right the first time and are pinned by tests.
- **The M-1 checkpoint made one PR safe.** One PR for two parts would normally hide whether M-1 touched `lib/` or `app/api/`. Dev recorded the checkpoint before any M-2 file was touched (`git diff --exit-code -- app/api lib` exit 0), and SA and QA each confirmed that every `lib/` and `app/api/` path in the final diff is M-2 content.
- **Deviation D-1 kept the gate honest.** Moving the S5-F7 refund note and its pin widening from M-1 to M-2 was the only way to keep AC-111 literally true at the checkpoint. Dev flagged it at the checkpoint rather than bending the rule.
- **Money stayed impossible to get wrong.** 4a's pattern carried over: integer cents, readability per row (SA-W64, including tax greater than amount), one `/ CURRENCY_SCALE`, no × 100, no cross-currency sum. The boost builder exposed `netMinorByCurrency` so K-5 adds cents, not floats (SA-W59).
- **The workplan found the real gaps.** Nineteen numbered SA questions, seven of them places where the requirement did not fit the code (for example SA-W56: AI cost & usage *can* take the window; SA-W65: `tierLabelForGroup` never returns null). All were settled before code.
- **Picker consolidation finished.** The original picker is gone, and the contract test now holds a deletion pin, which is stronger than the old rule.
- **The canary paid off again.** Dev's and QA's scoped `tsc` canaries both reported TS2322, then zero diagnostics in touched files.
- **No blocked handshake.** Requirement edits E-40 to E-43 were applied in place.
- **Final results:** finance suites 23 / 1,756; Businesses 33 / 733; layout and picker guards 70 / 2,266; billing guards 39 / 3,663; `test:bos-entitlements` 7,913; `test:authz-guard` 203; ESLint and `lint:hooks` clean.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with five conditions (two Medium, three Low). The code was approved with none.
- Number of Dev ↔ QA bug fix cycles: **0.** No fix round of any kind.
- Any blocked handshake and why: **none.**
- **The user's "all UI" expectation did not match the work.** M-1 was UI, but M-2 needed new money reads, so the slice took the full cycle and an estimate of about 4.5 days, above the usual slice size. The mismatch was handled, but it was found at scoping, not raised with the user in business terms up front.
- **The user has not seen this diff.** That was the user's choice, and it is valid. It does mean the live manual steps are now the user's only direct look at the result before merge.
- **Manual-step numbering drifted again.** Dev's notes say L-59 to L-72 with `durationMs` at L-72; QA's report runs L-59 to L-74 with `durationMs` at L-74. 4a's conclusion 5 (QA's list is the one to run) was not applied by Dev. QA's list is the one to run.
- **The manual QA backlog grew again**, now **L-1 to L-74**, across seven slices. 4a's conclusion 6 (one scheduled sitting) still has not happened.
- **Load-sensitive render suites outside this diff** (`activityLayout.render`, `jobsQueues.items.render`) timed out under parallel load in both SA's and QA's runs. Each passes alone. Two reviewers spent time proving they are not 5a.
- **The Jest worker-exit warning (FU-4a-3) appeared on every run.** It was correctly pointed to the existing follow-up this time and not re-investigated, which is 4a's conclusion 4 working.
- **`schema:check` still cannot run from the worktree** (V-11). The R-m columns rest on migration `20261027` and the §11D.1 live column list.

### Slice 4a lessons: what happened in 5a

| 4a item | 5a outcome |
|---|---|
| Conclusion 1: raise requirement gaps as numbered SA questions | ✅ Applied. SA-W55 to SA-W73, all settled before code; no fix round |
| Conclusion 2: make the wrong money path impossible | ✅ Applied. Per-row readability, integer cents, one-currency sums, exact-only K-5, each pinned with planted controls |
| Conclusion 3: isolate open user questions in one place | ✅ DF-5 still lives in one function and one sentence; S5-F7 reused that sentence (pin widened to exactly two users) |
| Conclusion 4: log a recurring warning once | ✅ The worker-exit warning was pointed to FU-4a-3, not re-checked |
| Conclusion 5: QA's manual list is the one to run | ⬜ Not applied by Dev (L-72 vs L-74) |
| Conclusion 6: schedule the manual QA sitting | ⬜ Not done. Backlog is now L-1 to L-74 |
| FU-1c-4 / OV-2: move Finance to the shared picker | ✅ Done in M-1 |

## Conclusions & process improvements

1. **Name the "is it UI?" test in business terms at scoping.** "Does the page show a money figure it could not show before?" is a plain question the user can answer, and a yes means the full cycle. Ask it when a step is described as UI-only.
2. **A checkpoint gate lets one PR replace two, safely.** When the user wants two parts in one PR, record the first part's boundary in the workplan before the second begins, and have SA and QA confirm it against the final diff. Reuse this for later M steps if the user batches them.
3. **When a gate and a requirement collide, move the item, do not bend the gate.** D-1 is the example. Flag it at the checkpoint and let SA rule.
4. **Dev's verification plan must point at QA's manual list**, not keep its own numbering. This is the second slice in a row with drift. Dev should write "see QA report" for the live steps.
5. **Record load-sensitive suites as a follow-up the first time.** As with the worker-exit warning, a named entry saves the next reviewer a re-run.
6. **The manual QA sitting is overdue.** Seventy-four steps across seven slices. L-59 to L-72 confirm the user's own USD 79.00 plan and USD 89.00 total, which was the point of this slice. Schedule it at the user sync.
7. **Stop here for the user sync, as the user asked.** M-3 to M-8 and the consolidation review's ten business questions come after that conversation, not before.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-5a-1 | QA Low note 1: an unreadable plan row with **no currency**, beside a USD boost, would give two total lines (USD and Unknown), so K-5 reads "2 currencies, see Our revenue" instead of a USD figure or Unknown (`lib/business-os/finance/ourRevenue.ts:37, 52-53`). Cannot happen today: plan rows carry a `currency = 'usd'` CHECK. Nothing is summed wrongly | SA / Dev | ⬜ Recorded |
| FU-5a-2 | `app/admin/finance/useFinanceData.ts` uses the server `createLogger` in a client file; it should use `clientLogger`. Pre-existing since 1a (`946653a1`), not a browser break. Fix with the shell migration in **M-6** | Dev (M-6) | ⬜ Deferred |
| FU-5a-3 | Load-sensitive render suites outside this diff: `app/admin/__tests__/activityLayout.render` and `jobsQueues.items.render` time out under parallel load and pass alone. Watch on CI shards | SA / Dev | ⬜ Recorded |
| FU-4a-3 | Jest "A worker process has failed to exit gracefully": pre-existing, printed on every 5a run with all suites passing | SA / Dev | ⬜ Carried |
| FU-5a-4 | Manual QA **L-59 to L-74** (QA report): the chip and header name, "Essentials" with the Founding Partner chip, "Paying", the summary (USD 79.00 plan, USD 10.00 boost, **USD 89.00** total), the links and the deep link, K-5 "USD 89.00", the payment list with `formatUtc` timestamps, **checks 17 and 18** with the October literal, 401 / 403, the log line and `durationMs`. Plus the owed **L-1 to L-58** from 1a, 1b, 2a, 2b, 1c and 4a | User | ⬜ Owed |
| FU-5a-5 | RM: commit, push and open **one** PR for `feature/bos-money-m1-m2`, as the user pre-authorised; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ✅ Done: commit `e8ffc5da`, PR [#383](https://github.com/AgentsPilot/neuronforge/pull/383) |
| FU-5a-6 | **STOP for a user sync**, as the user asked. Then: the remaining Money steps **M-3 to M-8**, and the consolidation review's **10 business questions** | User → BA → SA | ⬜ Next |
| FU-4a-2 | DF-5 decision (refund drop in the purchase month or the refund month) | User | ⬜ Open |
| FU-4a-4, FU-1c-5, FU-2b-5 to FU-2b-10, FU-2a-5 to FU-2a-8, FU-1b-3, FU-1b-4, FU-4 | Carried from earlier slices (currency decimals lists, two-row residual, flaky wall-clock test, `schema:check` from a credentialed checkout, slices 3 and 6 to 8, DF-3, DF-4, layer-B items, earlier typing notes) | As before | ⬜ Unchanged |

### Status: PRE-AUTHORISED BY USER (no diff review) — committed `e8ffc5da`, PR [#383](https://github.com/AgentsPilot/neuronforge/pull/383) open, not merged — `feature/bos-money-m1-m2`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (TL) | Slice 5a (Money M-1 and M-2) retrospective, written before commit under the user's pre-authorisation (no diff review). Records the consolidation context (docs PR #375), the user's missing USD 79.00 plan now shown as USD 89.00 with the boost, the full cycle despite the "all UI" expectation, the hard M-1 checkpoint gate (green), SA's pre-code corrections (S5-F1 `formatUtc`, K-5 exact-only), D-1 to D-6, cycle counts (0 rejections, 0 bug cycles), a comparison with 4a's lessons, and follow-ups FU-5a-1 to FU-5a-6. Next: stop for a user sync. |
| 2026-10-14 | Commit and PR (RM) | Slice 5a committed as `e8ffc5da`; origin/main merged cleanly and suites re-run green; PR [#383](https://github.com/AgentsPilot/neuronforge/pull/383) opened, not merged. FU-5a-5 done. |
