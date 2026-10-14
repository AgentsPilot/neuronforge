# Retrospective: Business OS Finance & Business Health — Slice 4a (boost revenue)

> **Last Updated**: 2026-10-14

## Overview

This is the retrospective for slice 4a of the read-only admin page `/admin/finance`. Slice 4 was split in two: **4a** (revenue, this slice) and **4b** (boost problems and bought credits in Section 4).

**What the slice changed.** No migration, no new table, no write, no LLM call, no audit entry, no entitlements import and no new query parameter.

- One read pair, **R-k / R-k′**, in `BusinessOsFinanceReadRepository`, on `business_os_boost_purchases` (already read for R-d), through the existing pager (`CLIENT_PAGE_SIZE` 1,000, ceiling 5,000, keyset on `id`).
- A new pure builder, `boostRevenue.ts`: per-currency lines (purchases, gross, tax, refunded, held, lost, net, credits sold), a by-package table from the stored `package_id` / `package_version`, and a "Deleted accounts" line.
- "Our revenue" became a real section with its own status. The plans line keeps a placeholder until slice 5.
- **K-5 shows the boost net** for the filter window, always beside its currency, through an optional `money` field on K-5 only.
- Amounts stay **integer cents**. `minorUnitsPerMajor` is the one source for decimals. Cents are never multiplied by 100 and never go through `toUnits`. They are divided by `CURRENCY_SCALE` once, at the edge.
- **DF-5** (refunds and disputes count in the purchase month) lives in one function, `refundsAndDisputesOf`, and one copy line, `REVENUE_REFUND_TIMING_NOTE`. Both are pinned by the source guard.

The cycle ran in this order:

1. BA requirement §11C, with the slice 4 split into 4a and 4b.
2. SA requirement review (SA-Q25 to SA-Q31, SA-RR-4).
3. RM cut `feature/bos-finance-health-4` from `main` `15300d29`.
4. Dev workplan (SA-W47 to SA-W54).
5. SA workplan review: approved with conditions (SA-WR-32 to SA-WR-35). BA applied requirement edits E-30 to E-32.
6. Implementation (deviations D-1 to D-7, all approved).
7. SA code review: **approved, no conditions**.
8. QA: pass, no bug, two Low notes.
9. The user's diff review: approved on 2026-10-14, "commit and open a PR".

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md) | [Slice 1c retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_RETROSPECTIVE.md)

---

## What went well

- **The first slice of this feature with no fix round.** SA approved the code with no conditions, and QA passed with no bug. Every earlier slice, including 1c, needed at least one fix round.
- **The workplan asked the right questions before code.** SA-W47 (K-5 had no slot for a currency) and SA-W51 (check 14 could not verify the deleted-accounts net) were real gaps between the requirement and the code. Both were settled at the workplan stage, so nothing was rebuilt.
- **Money handling was designed to be hard to get wrong.** The main risk was cents shown as hundreds of dollars. One source for decimals, readability decided per purchase (SA-W48), and a source pin with planted controls for `toUnits`, `toHundredths` and `× 100` (SA-W54) leave no path for it. Wire tests check 1000 → 10.00 and 1999 → 19.99.
- **The canary paid off again.** The scoped `tsc` canary run caught **two real type errors** in the builder's `summarise` (the `flatMap` entry typing) before review. QA re-ran the canary on its own config and got 0 diagnostics in changed files.
- **The DF-5 question did not block the build.** The open user question was isolated in one function and one sentence, so switching to option (b) later changes only that function's input and that sentence.
- **1c's behaviour stayed pinned while its wording was replaced** (SA-WR-32). The R-d repository describe was unedited (diff 166 / 0), and a builder test pins that a test-mode plan invoice alone still marks plans as recorded.
- **No blocked handshake.** Edit-capable agents applied all requirement and workplan edits (E-30 to E-32) in place, as in 1c.
- **Scope held.** The Businesses list, the credits module, the webhook placement guards, purge and every boost-module file ran with `git diff --exit-code` 0. The only guard file edited was the finance source guard, with additions only.
- **Final results:** finance suites 17 / 1,438 tests (SA's wider set 21 / 1,576); `test:bos-entitlements` 7,365; `test:authz-guard` 203; the V-5 guard set 75 suites / 3,035; `lint:hooks` and ESLint clean.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with four conditions (one Medium, three Low). The code was approved with none.
- Number of Dev ↔ QA bug fix cycles: **0.** No fix round of any kind.
- Any blocked handshake and why: **none.**
- **Dev left the Jest worker-exit warning uninvestigated.** Dev reported "A worker process has failed to exit gracefully" but did not compare it with `main`. SA and QA then each spent time showing it is not from 4a. It had already appeared in the 1a and 2a reviews, and `--detectOpenHandles` found no open handle. A warning that shows up across slices should be logged as a follow-up the first time, not rediscovered each slice.
- **Manual-step numbering drifted.** The workplan's verification plan numbers the manual steps L-49 to L-56, while QA's report numbers them L-49 to L-58 (QA added checks 15 and 16). QA's list is the one to run.
- **The manual QA backlog grew again**, to **L-1 to L-58**. 1c's conclusion 6 (schedule one sitting) has still not happened. Four slices of live checks are now waiting on one session.
- **The refund-month question (DF-5) is still open with the user.** The default is built, so this costs nothing yet. But it is now the only decision under 4a that has not been settled.
- **`schema:check` still cannot run from the worktree** (V-10). The selected columns rest on migration `20261030` and check 14.

### Slice 1c lessons: what happened in 4a

| 1c item | 4a outcome |
|---|---|
| Conclusion 1: state what the page shows the owner today | ✅ Applied. L-50 and L-51 name the owner's own USD 10.00 test boost, as it should appear on the line, in the package row and on K-5 |
| Conclusion 2: record rules that depend on the platform's stage | ✅ BD-14 carried through: no `livemode` anywhere in R-k / R-k′, pinned by the repository-wide rule |
| Conclusion 3: investigations name the state from the code path | — Not exercised (no investigation in 4a) |
| Conclusion 4: re-check names when a shape changes | ✅ The deleted constants (`K5_NONE_YET`, `K5_RECORDED`, `REVENUE_*`) were grepped out (V-9). The only hit left is the 1c guard's planted control |
| Conclusion 5: welcome simplifying decisions | — None arose. The 4a / 4b split did the same job up front |
| Conclusion 6 / FU-1c-1: manual QA sitting | ⬜ Not done. Backlog is now L-1 to L-58 |
| FU-1c-3: slice 4 now has real rows to show | ✅ 4a built. 4b and slice 5 remain |
| FU-1c-4: AI-cost overlap questions, urgent OV-2 | ⬜ Still open |

## Conclusions & process improvements

1. **Questions raised in the workplan cost far less than fix rounds.** 4a raised eight SA questions before code and needed no fix round. Its two gap findings (SA-W47, SA-W51) would each have been a code-review finding if left to the end. Keep listing every gap between requirement and code as a numbered SA question.
2. **For money, make the wrong path impossible, not just untested.** One decimals source, readability decided per purchase, and a source pin with planted controls are the pattern for slice 5 (plan revenue) and 4b.
3. **Keep isolating open user questions in one place.** DF-5 did not block the build because the rule has one function and one sentence. Use this whenever a business question is still pending at build time.
4. **Log a recurring warning as a follow-up the first time.** The worker-exit warning has now been checked in three reviews. It is recorded below so that later slices point to it rather than re-checking it.
5. **QA's manual list is the one to run.** When QA adds or renumbers manual steps, Dev's verification plan should point to QA's list rather than keep its own numbering.
6. **Schedule the manual QA sitting before 4b merges.** Fifty-eight steps across six slices; L-49 to L-52 confirm the owner's own boost.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-4a-1 | Manual QA **L-49 to L-58** (QA report): Our revenue as a section, the USD 10.00 line and "starter v1" package row against **check 14** (incl. `deleted_account_net_minor`), K-5 "USD 10.00", the plans line, checks 15 and 16, window switching, the picked business, 401 / 403, the log line and `durationMs`. Plus the owed **L-1 to L-48** from 1a, 1b, 2a, 2b and 1c | User | ⬜ Owed |
| FU-4a-2 | **DF-5 decision:** when a boost is refunded, does the drop show in the **purchase month** (a, the default, as built) or in the **refund month** (b, which needs a refund date to be recorded by the boost module)? Choosing (b) changes only `refundsAndDisputesOf`'s input and one sentence, plus a writer-side change | User | ⬜ Open |
| FU-4a-3 | Jest "A worker process has failed to exit gracefully": pre-existing (seen in the 1a and 2a reviews; reproduced on suite sets with no 4a file), intermittent, exit 0; `--detectOpenHandles` found no open handle. Look at it separately if it starts to fail CI | SA / Dev | ⬜ Recorded |
| FU-4a-4 | QA Low note 2: any three-letter code not on `refundMath`'s zero- or three-decimal lists is treated as two-decimal. Boosts are USD only today; a new currency with other decimals must be added to those lists | SA | ⬜ Recorded |
| FU-4a-5 | RM: commit, push and open the PR for `feature/bos-finance-health-4`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Pending (user approved 2026-10-14) |
| FU-4a-6 | **Slice 4b** (boost problems, Section 6 block A, K-5's dispute rule, bought credits in Section 4), then **slice 5** (plan revenue) | BA → SA → Dev | ⬜ Next |
| FU-1c-4 | AI-cost overlap questions BQ-1 to BQ-5; **urgent** OV-2 (move Finance to the shared picker before layout step L-8) | User → BA → SA | ⬜ Open, time-sensitive |
| FU-1c-5, FU-2b-5 to FU-2b-10, FU-2a-5 to FU-2a-8, FU-1b-3, FU-1b-4, FU-4 | Carried from earlier slices (two-row residual, flaky wall-clock test, `schema:check` from a credentialed checkout, slices 3 and 6 to 8, DF-3, DF-4, layer-B items, earlier typing notes) | As before | ⬜ Unchanged |

### Status: APPROVED BY USER — commit pending (RM) — `feature/bos-finance-health-4`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (TL) | Slice 4a retrospective after the user approved the diff. Records the 4a / 4b split, the scope (R-k / R-k′, `boostRevenue.ts`, the revenue section, K-5 with its currency), the integer-cents rules, the cycle counts (0 rejections, 0 bug cycles, the first slice of the feature with no fix round), the canary catching two real type errors, a comparison with 1c's lessons, and follow-ups: manual QA L-1 to L-58, the open DF-5 decision, the pre-existing Jest worker-exit warning, and slice 4b next. Commit pending (RM). |
