# Retrospective: Business OS Finance & Business Health — Slice 6a (Money M-3: account economics and AI margin)

> **Last Updated**: 2026-10-15

## Overview

This is the retrospective for slice 6a of the read-only admin page `/admin/finance`. It is step **M-3** of the Money area that the consolidation review (docs PR #375) proposed. The user accepted all ten consolidation defaults (BD-18 to BD-27) before the slice started.

The slice answers one question: "across all accounts, who paid us what, what did their AI cost us, and which accounts are worth it?" It adds:

- An **Accounts** tab on Finance, for all businesses only (`tab=accounts` in the URL; absent means Overview, which is unchanged). It holds one row per account with **Paid us, after tax**, **AI cost, charged (USD)**, **AI margin (USD)**, plan group and credits used. Sort, filter and the 200-row cap all run on the server, with an honest "Showing x of N" line.
- A **platform AI margin line** over every account, taken before any filter or cap, and never summed across currencies.
- An **"AI margin (USD)"** line in the M-1 one-account summary, built by the same code as the tab row.
- One pure builder, `lib/business-os/finance/accountEconomics.ts`.

**What the slice did not add.** No migration, no new table, no write, no LLM call, no audit entry, no entitlements import, no tier literal, no new repository method and **no new database read**. Every figure comes from rows the route already reads. The only extra I/O is one names request of at most 200 ids, on the tab only.

**How the cycle ran.** Full cycle, one workplan, one PR (SA-Q50). The user pre-authorised commit and PR **without a diff review** (2026-10-14).

1. BA requirement §11E (AC-130 to AC-149).
2. SA requirement review (SA-Q42 to SA-Q50, SA-RR-6a, findings S6-F1 to S6-F6, edits E-44 to E-48).
3. RM cut `feature/bos-money-m3` from `main` `d05eb0a4`.
4. Dev workplan (SA-W74 to SA-W89).
5. SA workplan review: approved with conditions (SA-WR-41 to SA-WR-45). Requirement edits E-49 to E-51 for BA.
6. Implementation: nine deviations, all approved.
7. SA code review: **approved, no code condition**, three Low follow-ups. Requirement edit E-52 for BA.
8. QA: **pass with issues**, one Low bug (B-1).
9. Fix round 1: B-1 fixed in one line, with a render test and a source guard.
10. Commit and PR by RM, under the user's pre-authorisation (no diff stop).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md) | [Slice 5a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_RETROSPECTIVE.md)

---

## What went well

- **The business decisions were settled before the slice began.** The user accepted all ten consolidation defaults (BD-18 to BD-27). No business question reached the user during the cycle; every open point was a technical one for SA.
- **No new read.** The tab is built entirely from R-a, R-k, R-m, the plan walk and the positions pass, which the route already makes. SA-Q46 made the per-account AI cost come out of the same `summariseAiCost` pass as Section 3, so the tab and Section 3 cannot disagree on readable data.
- **SA caught two guard trips before any code was written.** The boost and plan **export pins** (four names each, becoming five) and the **DF-5 pin extension** to `accountEconomics.ts` (zero tokens, with a planted control) were named in the requirement and workplan reviews, so neither surfaced as a red suite during build.
- **SA corrected the safe range before code.** The workplan said "about USD 90 million". SA showed that the bound is about **USD 900,719 per figure** (`Number.MAX_SAFE_INTEGER / 1e10`), using the exact 1e8 factor that turns cents into ledger cost units. Dev tested both sides of the boundary (SA-WR-41): one minor unit past it gives Unknown on the row and the platform line, never a wrong figure.
- **Margin is exact.** Integer subtraction at the ledger scale, one `* MINOR_TO_COST_UNITS`, one `/ COST_SCALE`, no × 100, all pinned. QA confirmed 8900 minor − USD 1.2345 gives 87.7655 exactly.
- **The Overview was proven unchanged.** The AC-145 baseline route test was written first, run green on unchanged `d05eb0a4` code, and **never edited** afterwards. It pins every read call, the `findNames` calls, the ten top-level keys and a SHA-256 of the whole payload. SA and QA each checked `git diff -U0`: exactly two pure-insertion hunks.
- **Three known differences from SQL check 19, each decided on purpose.** A paid boost with tax above its amount (Unknown on the page), a `paid` boost with a refund recorded (E-45's status-free rule), and a zero plan invoice in a non-USD currency (no line on the page). Dev found the third while porting check 19 to a TypeScript helper. SA ruled the page right in all three, and each is recorded for QA (E-51, E-52).
- **Fix round 1 was one line.** B-1 (a "No plan row" account linked to a "Business not found" view) was fixed with `row.kind !== 'platform' && !row.noPlanRow`, plus a render test, a source guard with a planted control, and a flake fix in the same suite.
- **Lessons from 4a and 5a carried over.** Sixteen numbered SA questions settled before code; planted controls on every new guard; scoped `tsc` canaries (Dev and QA both saw TS2322, then zero); the recurring worker-exit warning was pointed to FU-4a-3, not re-investigated.
- **No blocked handshake.** The session was interrupted once during the TL step; nothing was lost.
- **Final results:** finance suites 25 / 2,032 after fix round 1; Businesses 25 / 601; layout and audit guards 47 / 1,735; billing guards and caller lists 9 / 423; `test:bos-entitlements` 267 / 7,986; `test:authz-guard` 2 / 203; ESLint and `lint:hooks` clean.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with five conditions (two Medium, three Low). The code was approved with none.
- Number of Dev ↔ QA bug fix cycles: **1** (B-1, Low, a one-line fix). It is the first fix round in three slices.
- Any blocked handshake and why: **none.** One session interruption during the TL step, with no loss.
- **B-1 was a gap between two rulings.** SA-Q49 made money-only accounts visible as "No plan row", and SA-W85 decided which rows have no link, but nobody checked whether the M-1 view could open a "No plan row" account. It cannot: the view checks the plan table first. QA found it by reading the route, not a test.
- **Two small places where the tab and the rest of the page can differ** (SA code review Low items 2 and 3). The cost cell reads Unknown on an unreadable or overflow row where Section 3 prints a figure; the group select shows "All plan groups" for a well-formed tier that is not listed. Both are honest, but both need a note or a follow-up.
- **The user has not seen this diff.** That was the user's choice, and the workplan and SA's two reviews were the gate. The live manual steps remain the user's only direct look before merge.
- **Manual-step numbering drifted a third time.** Dev's notes put `durationMs` at L-80; QA's list runs L-75 to L-88 with `durationMs` at L-88. 5a's conclusion 4 was only half applied: Dev said "for QA" but still wrote its own numbers. **QA's list is the one to run.**
- **The manual QA backlog grew again**, now **L-1 to L-88** across eight slices, plus SQL checks 19 and 20. The scheduled sitting (5a conclusion 6) has still not happened.
- **`schema:check` still cannot run from the worktree** (V-11). No new column is read, so the risk is low.

### Slice 5a lessons: what happened in 6a

| 5a item | 6a outcome |
|---|---|
| Conclusion 1: name the "is it UI?" test in business terms | ✅ Not needed: M-3 shows new money figures and took the full cycle from the start |
| Conclusion 2: a checkpoint gate lets one PR replace two | ➖ Not needed: one part. The AC-145 baseline played the same role for the Overview |
| Conclusion 3: move an item, do not bend a gate | ✅ The export pins and the DF-5 pin were widened only with a reason and a planted control |
| Conclusion 4: Dev points at QA's manual list | 🟡 Partly. Dev deferred to QA but kept its own numbers (L-80 vs L-88) |
| Conclusion 5: record load-sensitive suites the first time | ✅ FU-5a-3 cited; no load timeouts in QA's one-at-a-time runs |
| Conclusion 6: schedule the manual QA sitting | ⬜ Not done. Backlog is now L-1 to L-88 |
| Conclusion 7: stop for the user sync | ✅ The user accepted BD-18 to BD-27 before M-3 |

## Conclusions & process improvements

1. **When a ruling adds a new kind of row, check every place that row can be clicked or opened.** B-1 came from SA-Q49 (show money-only accounts) meeting SA-W85 (which rows link). Add "where does this row lead?" to the workplan's questions for any new row kind.
2. **Name the pins a slice will trip during requirement review.** The export pins and the DF-5 extension were found before code, so the build never went red on them. Keep that as a standard line in SA's requirement review for any slice that touches a guarded file.
3. **State numeric bounds with the arithmetic, not a round figure.** "About USD 90 million" was wrong by a factor of 100. Writing the formula (`MAX_SAFE_INTEGER / 1e10`) let SA check it in one line.
4. **Port each SQL check to a TypeScript helper before declaring parity.** Writing `checkNineteen` found a difference the requirement did not list. Keep doing it for checks 20 onward.
5. **Write the "unchanged" baseline test first and prove it untouched with the hunk list.** AC-145 is the model for any later M step that must leave Overview identical.
6. **Dev writes "see QA report" for the live steps, with no numbers.** Third slice with drift; this should be a checklist line in the workplan template.
7. **Schedule the manual QA sitting at this user sync.** L-75 to L-88 check the user's own account: USD 89.00 paid, its October AI cost X, and margin 89 − X.
8. **Stop here for the user sync, as planned.** Then M-4 to M-8 and the paused FIN 4b.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-6a-1 | `FinanceTabs.tsx`: the inactive tab's `aria-controls` names a panel that is not rendered. Render both panels with `hidden` on the inactive one (SA code review Low 1) | Dev | ⬜ Recorded |
| FU-6a-2 | `accountEconomics.ts` `buildCost` vs Section 3: on an unreadable or overflow cost row, the tab reads Unknown while Section 3 prints a figure (counting unreadable as 0). AC-134 holds for readable rows inside the safe range only. Decide whether Section 3 should also show Unknown (SA code review Low 2) | SA / Dev | ⬜ Recorded |
| FU-6a-3 | `AccountsTab.tsx` group select: a well-formed tier from the URL that is not in `groupOptions` shows "All plan groups" while the filter is applied. Add the current value as an option (SA code review Low 3) | Dev | ⬜ Recorded |
| FU-6a-4 | Residual of B-1: with the plan walk incomplete, `noPlanRow` cannot be proved, so such rows stay linked (accepted by QA) | — | ✅ Accepted |
| FU-6a-5 | BA requirement edits E-49 to E-52 (payload keys, formatters, the three check-19 differences): confirm they are in the requirement before RM commits | BA / TL | ⬜ Confirm |
| FU-6a-6 | Manual QA **L-75 to L-88** (QA report), including **checks 19 and 20** with the October literal and `durationMs` for both tabs. Plus the owed **L-1 to L-74** from earlier slices | User | ⬜ Owed |
| FU-6a-7 | RM: commit, push and open **one** PR for `feature/bos-money-m3`, as the user pre-authorised; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Next |
| FU-6a-8 | **STOP for a user sync.** Then the remaining Money steps **M-4 to M-8**, and the paused **FIN 4b** (paused until this PR merges, SA-Q50) | User → BA → SA | ⬜ Next |
| FU-5a-2 | `app/admin/finance/useFinanceData.ts` uses the server `createLogger` in a client file; fix with the shell migration in **M-6** | Dev (M-6) | ⬜ Still open |
| FU-5a-1, FU-5a-3, FU-4a-2, FU-4a-3 and earlier | Carried from earlier slices (Unknown-currency K-5 line, load-sensitive suites, DF-5 decision, worker-exit warning, and the 5a carried list) | As before | ⬜ Unchanged |

### Status: PRE-AUTHORISED BY USER (no diff review) — committed `b8f59db1` (merge of origin/main `bbab0c24`) — `feature/bos-money-m3` — PR [#392](https://github.com/AgentsPilot/neuronforge/pull/392) open

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created (TL) | Slice 6a (Money M-3) retrospective, written before commit under the user's pre-authorisation (no diff review). Records BD-18 to BD-27 accepted up front, no new DB read, SA's two pre-code guard trips (export pins, DF-5 extension), the corrected safe range (about USD 900,719 per figure, 1e8 factor), the unedited AC-145 baseline, the three deliberate check-19 differences, nine approved deviations, cycle counts (0 rejections, 1 bug cycle for B-1), one session interruption with no loss, a comparison with 5a's lessons, and follow-ups FU-6a-1 to FU-6a-8. Next: RM commit and PR, then stop for a user sync. |
