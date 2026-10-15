# Retrospective: Business OS Finance & Business Health — Money M-4 (two measures, one vocabulary)

> **Last Updated**: 2026-10-15

## Overview

This is the retrospective for Money **M-4** on the read-only admin page `/admin/finance` and the admin pages around it. M-4 answers one question: "what did AI cost us, and how much of it did we not charge for?" It shipped as **two PRs under one workplan** (SA-Q57):

- **Part A — OV-1, one vocabulary.** **Merged as PR #398.** 37 visible labels across 13 source files now use two names only. **"Charged AI cost"** comes from the credit ledger, and **"Recorded AI cost"** comes from the usage log. The Health tile is now "Recorded AI cost (USD)". A new TypeScript-AST vocabulary guard (`app/admin/__tests__/aiCostVocabulary.source.guard.test.ts`) found **21 offences** in the old code and finds **0** now. Short path for copy.
- **Part B — OV-5, the two measures side by side.** It is ready to commit on `feature/bos-money-m4b` (cut by RM from `main` `bd7beabd`, after PR #398) in worktree `neuronforge-finance-health`. **Committed as `cde25b99`** (merge of `origin/main` `ee1471e9`); PR [#407](https://github.com/AgentsPilot/neuronforge/pull/407) open. Finance Section 3 shows "Recorded AI cost (USD)" and **"Recorded above charged (USD)"** (recorded − charged) beside the charged total, and never adds it to that total. The M-1 account summary shows the same line. Part B reuses two existing reads (`listCostPointsAllAccountsInWindow`, `listCallsInWindow`) and adds no repository method, no migration and no write. Full cycle.

**How the cycle ran.**

1. BA requirement §11F (AC-150 to AC-168, checks 21 and 22).
2. SA requirement review: findings F-1 to F-9, edits E-53 to E-57, SA-Q51 to SA-Q57.
3. RM cut `feature/bos-money-m4` from `main` `b20da2cc`.
4. Dev workplan for both parts, with 15 questions (SA-W90 to SA-W104).
5. SA workplan review: approved with conditions SA-WR-46 to SA-WR-50 and edits E-58 and E-59.
6. Part A: implementation, then SA code review (approved), QA (pass, no bug), then RM merged PR #398.
7. Part B: RM cut a new branch from `main` after #398. Then implementation with nine deviations (BD-1 to BD-9), SA code review (approved, one Low comment), QA (pass with issues, no bug), and fix round 1 (the SA Low comment).
8. RM committed Part B (`cde25b99`), merged `origin/main` (`ee1471e9`) and opened PR [#407](https://github.com/AgentsPilot/neuronforge/pull/407) under the user's go-ahead given in chat.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (§11F) | [BUSINESS_OS_FINANCE_HEALTH_M4_TWO_MEASURES_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M4_TWO_MEASURES_WORKPLAN.md) | [Slice 6a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_RETROSPECTIVE.md)

---

## What went well

- **SA's requirement review caught F-1 before any code was written.** The all-accounts read can stop short **below** the ceiling (for example, when its signal fires) without reporting it, so `reachedCeiling` alone would print a truncated sum as exact. E-53 made exactness come from `completed` for the all-accounts read and from `reachedCeiling` for the one-account read. The rule lives in one place (`recordedCost.ts`), is pinned by guard rule (g), and is tested by AC-168 (`completed` false with fewer rows than the ceiling gives "At least" and Unknown).
- **The name was chosen to avoid confusion.** Finance's line is **"Recorded above charged"** (E-54), a difference of two totals. It is not "Recorded, not charged", which is the Leak check's per-call figure. The two pages cannot be read as the same measure.
- **The vocabulary guard is real.** It reads the AST, folds `+` chains, collapses whitespace, scans `aria-label`, `title`, `placeholder` and `label` values (SA-WR-47), and skips ids, hrefs and class names. It has 10 must-find and 12 must-not-find planted controls. SA re-ran its scanner over `git show HEAD:` copies and reproduced the Dev's count: 21 offences, then 0. QA planted "Total spend" and the guard caught it twice.
- **The Dev found three label slips the spec had missed** (SA-W90 to SA-W93). The first was a **". ," join**: W-3's new two-sentence source text would have rendered "…are not in it., This month". The second was a fourth ledger "Cost (USD)" in Activity's corrections table. The third was the drawer's "Estimated cost" purpose line and the M-1 cut-over note naming the old Section 3 title. All were ruled before code (E-58, E-59), and the subtitle got its own render pin (SA-WR-46).
- **D1: the page-local `FinanceSection` gained an `alsoWhenUnknown` slot.** The frame hides its children when Unknown, so SA-W98 ("the recorded figure still shows when the charged side is Unknown") could not be met inside `AiCostSection` alone. The slot is optional and renders only in the Unknown state. With no prop, the DOM is unchanged. SA approved it without a layout ruling, because the component is local to Finance, not shared.
- **Never added, and proven.** No payload field, export or element holds recorded + charged. Guard (f) has a planted `recordedUnits + chargedUnits` control, and K-1 and AI margin are deep-equal with and without a recorded fixture. The difference is taken in integers at `COST_SCALE`, so 0.1 + 0.2 gives exactly 0.3.
- **The Overview change was measured to the byte.** The AC-145 baseline changed only in the E-55 hunks. A new proof deletes `aiCost.recorded` and gets the 6a hash `b4d10bc1…` back.
- **The 6a lessons held.** Pins were named before code (the finance `token_usage` rule split, W103's `codeOf`, W104's `Omit<>`). Every new guard has a planted control. Dev, SA and QA each ran a scoped `tsc` canary and saw TS2322 before the clean run. Checks 21 and 22 were ported to TypeScript (`checkTwentyOne`, `checkTwentyTwo`). Load flakes were cited to FU-5a-3, not re-investigated.
- **Part A merged with no bug and no fix round.** Part B's QA found no bug.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with five conditions. Both code reviews approved with no condition. Part B had one Low comment.
- Number of Dev ↔ QA bug fix cycles: **0** (no QA bug in either part). Part B had **one fix round**, for the SA Low comment: the failure notice "The charged figures above are unaffected" now appears only when charged figures were shown, and a plain notice appears otherwise.
- Any blocked handshake and why: **none blocked.** The release gate was **ambiguous** (below).
- **The user's go-ahead was not on the record.** The user gave the go-ahead to commit and open the PR with no diff review **in chat**, after the SA Workplan Review had already written "the user has **not** given a no-diff-review go-ahead for M-4". TL's briefs said pre-authorised, and the workplan said the opposite. QA flagged the conflict **twice** (Part A and Part B) and correctly did not treat it as its own finding. No harm was done, but two agents spent effort on a question one line in the requirement would have settled.
- **QA could not time the 92-day read.** QA's read-only timing script against the live database was refused by the session's permission guard ("Production Reads"). QA did not work around it. SA-WR-49 wanted that figure before the PR. It is now a user manual step (**L-104**), and SA rules on `RECORDED_DEADLINE_MS` if the read is near or past 2 s. A slow read shows Unknown, never a wrong figure.
- **QA's recorded runs predate fix round 1.** QA's finance run shows 2,239 tests. The fix round's re-run (2,242) and its canary were Dev's. The change is copy plus one prop with three render cases, which is in proportion, but QA's report does not cover it.
- **Load-sensitive render suites failed again under a full run** (`creditsBlock.render`, `jobsQueues.layout.render`, three audit-trail suites). All are untouched and pass alone. This is the third slice where SA and QA have had to re-run them one by one.
- **The manual QA backlog grew again**, to **L-1 to L-105**, plus checks 21 and 22. The sitting from 5a and 6a has still not happened.

### Slice 6a lessons: what happened in M-4

| 6a conclusion | M-4 outcome |
|---|---|
| 1. Check where a new row kind leads | ✅ Applied to the new link: SA-W99 settled the Leak check `account` key before code |
| 2. Name the pins a slice will trip in requirement review | ✅ The `token_usage` rule split, `codeOf`, the `Omit<>` and the AC-145 hunks were all named before code |
| 3. State bounds with the arithmetic | ✅ `MAX_SAFE_INTEGER / 1e10` (about USD 900,719), with safe-integer checks on the sum and the difference |
| 4. Port each SQL check to TypeScript | ✅ `checkTwentyOne` and `checkTwentyTwo` agree with the builder (0.329938) |
| 5. Write the "unchanged" baseline first | ✅ AC-145 was changed only under E-55, and the 6a hash is restored with `recorded` removed |
| 6. Dev writes "see QA report" with no numbers | ✅ Done: QA's L-89 to L-105 is the only list |
| 7. Schedule the manual QA sitting | ⬜ Not done. The backlog is now L-1 to L-105 |

## Conclusions & process improvements

1. **Record the user's go-ahead in the requirement as soon as it is given.** A release authorisation given in chat must be written into the requirement (§0) and the workplan's release-gate line the same day, with its date and scope (which parts, diff review or not). Any later agent then reads one answer, not a conflict.
2. **Live-database steps go to the user from the start.** The session guard refuses production reads, so a workplan step that needs a live timing or SQL check should be written as a user manual step, not as a QA step that will be refused.
3. **Have QA re-run the changed files after a fix round, even a small one.** A one-line re-run of the touched suites keeps QA's report the record of what ships.
4. **Name a difference by what it is.** "Recorded above charged" versus "Recorded, not charged" is the model: when two figures look alike, the label says which arithmetic made it.
5. **Ask the Dev to read every consumer of a copy constant, not only the constant.** The ". ," join was in the JSX that used W-3, not in the copy file. The Dev's habit of reading the render site found it; make it a workplan checklist line for copy work.
6. **Treat the load-sensitive suites as a real follow-up.** Three slices of one-by-one re-runs cost time each cycle. FU-5a-3 should get a slot.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-M4-1 | The Health rule descriptions and metric labels (`lib/admin/health/rules.ts`, "spend") and the Jobs page description of the Leak check cron (`lib/cron/bosCronJobs.ts:452`, "Business OS AI spend"). Reword them in **M-5** | BA / Dev (M-5) | ⬜ Recorded |
| FU-M4-2 | **The 92-day timing (L-104).** If `counts.aiRecorded.ms` is near 2,000 or `outcome` is `'deadline'`, report to SA. SA alone rules on `RECORDED_DEADLINE_MS` (SA-WR-49) | User → SA | ⬜ Owed |
| FU-M4-3 | `npm run typecheck:bos-llm` reports a **stale baseline entry** ("1 baseline entry is fixed") for `app/api/onboarding/build/route.ts` (TS18047). That file is outside this diff. Drop the entry in its own small change | Dev | ⬜ Recorded |
| FU-M4-4 | **Merge queue and auto-merge.** A peer session (CI gating) reports that `main` now has a merge queue, and asked that PRs be set to auto-merge. That needs the **user's own confirmation**, which has not been given. RM does not enable auto-merge on PR 2 until it is | User | ⬜ Awaiting user |
| FU-M4-5 | Manual QA **L-89 to L-105**, including **checks 21 and 22** with the October literal. Plus the owed **L-1 to L-88** from earlier slices | User | ⬜ Owed |
| FU-M4-6 | RM: commit Part B on `feature/bos-money-m4b` and open PR 2, under the user's chat go-ahead. Record PR 1 (#398) and PR 2 in the workplan's Commit Info and in the requirement §0 | RM / TL | ⬜ Next |
| FU-5a-3 | Load-sensitive render suites (`creditsBlock.render`, `jobsQueues.layout.render`, three audit-trail suites) fail under full runs and pass alone | Dev | ⬜ Still open |
| FU-5a-2 | `app/admin/finance/useFinanceData.ts` uses the server `createLogger` in a client file. Fix it with the shell migration in **M-6** | Dev (M-6) | ⬜ Still open |
| FU-6a-1 to FU-6a-3, FU-5a-1, FU-4a-2, FU-4a-3 and earlier | Carried from earlier slices | As before | ⬜ Unchanged |

**Next:** **M-5**, a Money section in the admin sidebar (BD-21, BD-24). It takes FU-M4-1 with it.

### Status: Part A COMMITTED — `feature/bos-money-m4` — merged as PR #398. Part B READY TO COMMIT (user go-ahead in chat, no diff review) — `feature/bos-money-m4b` — not yet committed

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created (TL) | One retrospective for both parts of Money M-4. Part A (OV-1) merged as PR #398: 37 labels in 13 files, the AST vocabulary guard (21 offences at HEAD, 0 now), no bug and no fix round. Part B (OV-5) ready on `feature/bos-money-m4b`, uncommitted: "Recorded above charged" beside the charged figure, never added, two reused reads, no new method, one fix round for the SA Low comment. Records F-1 caught before code (`completed`), the E-54 naming, the three label slips the Dev found (including the ". ," join), the D1 `alsoWhenUnknown` slot, the chat go-ahead that QA flagged twice, the refused 92-day timing (L-104, SA-WR-49), and the unconfirmed auto-merge request. Follow-ups FU-M4-1 to FU-M4-6. Next: M-5 |
