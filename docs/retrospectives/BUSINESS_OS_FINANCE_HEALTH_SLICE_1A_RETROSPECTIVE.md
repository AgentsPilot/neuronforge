# Retrospective: Business OS Finance & Business Health — Slice 1a

> **Last Updated**: 2026-10-10

## Overview

Retrospective for slice 1a of the read-only admin page `/admin/finance`: the menu entry, a filter bar kept in the URL, tiles K-1 / K-3 / K-5, the "Our revenue: none yet" panel, Section 1 (accounts by plan) and Section 3 (AI cost). The slice has no migration, no write and no audit entry. It ran the full cycle: discovery, live-schema check, BA requirement, SA review, Dev workplan, SA workplan review, implementation, SA code review, QA, fix round 1, and the user's diff review. The user approved the diff on 2026-10-10. Commit and PR are next (RM).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md) | [Discovery](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_DISCOVERY.md) | [Live schema](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md)

---

## What went well

- **Measuring the live schema before writing the requirement.** The check found 0 rows in the platform billing and boost tables. Slice 1 was then scoped to data that has real rows today (accounts, AI cost, credits). Revenue became an honest "None yet" panel instead of a $0 chart.
- **The business questions were cleared in one pass.** The BA framed BQ-1 to BQ-12 with proposed defaults, and the user accepted all twelve as written (BD-1 to BD-12). No technical fork reached the user.
- **SA caught a silent undercount before any code existed.** The planned ledger read (`listChargesAllAccountsInWindow`) returns one page of at most 100 charge rows and drops adjustments and deleted accounts. Summing it would have undercounted AI cost with no warning (265 rows exist today). SA-F1 / SA-Q6 replaced it with a paged read (R-a) that has a 20,000-row ceiling and shows "at least" when it is reached. SA approved the requirement with conditions F1 to F14, and split slice 1 into 1a / 1b (SA-F3).
- **The workplan found contradictions while they were still cheap.** SA-W1 (with a business picked, AC-42 forbade a read that Section 1 needs) and SA-W2 (the paying-status constant would have tripped two guards listed as "not tripped") were raised before code. SA ruled both in a single review.
- **The code review and QA passed on the first try.** SA approved the code with 3 Low findings and no re-review. QA gave PASS WITH ISSUES with no bugs. Every 1a AC that Jest can test passes: 608 tests in the finance suites, Health unchanged at 249, `test:bos-entitlements` at 5,837, the authz guard at 203. A scoped `tsc` with a planted canary was run (AC-44).
- **Security held throughout.** `requireAdmin` runs first. Every response is `no-store`. Admin override `reason` text is stripped in the wiring (SA-WR-1). With a business picked, every read is scoped to it (AC-42). There are no tier literals and no `console.*`.
- **Fix round 1 was small and focused.** It fixed four findings (SA-1/QA-1, SA-2, SA-3, QA-3). QA-2 was resolved by correcting the requirement (AC-9 reconciled with §7.1), not by changing correct code.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The requirement was approved with conditions (F1 to F14) plus one re-check. The workplan was approved with conditions (SA-WR-1 to SA-WR-7). The code was approved first time.
- Number of Dev ↔ QA bug fix cycles: **0 bug cycles.** One fix round for Low findings, with no QA re-run required.
- Any blocked handshake and why: none was blocked. Requirement upkeep lagged behind the code, though. Dev was told not to edit the requirement while the BA was working on it in parallel, so workplan task 20 (the §0.1 status) stayed open through the code review.
- **The BA rewrote the whole requirement file twice.** The BA has no Edit tool, so both edit passes (SA-F1 to F14, then E-1 to E-4) replaced all ~890 lines. SA then had to read the file to confirm nothing was lost. That was fine this time, but an earlier subagent did blank a 428-line document and still report success. The same risk applied to TL's status edit in this cycle.
- **The requirement contradicted itself (SA-W1, SA-W2) after it had been SA-cleared.** The requirement review did not test "business picked" against the guard lists. The workplan did.
- **The SQL cross-checks and the live browser path are still unrun.** AC-9, AC-10 and AC-32 depend on the user's manual steps (below).

## Conclusions & process improvements

1. **Give the BA an Edit tool, or route its edits through an agent that has one.** Rewriting a whole living document to change a few rows risks silent truncation. Until that changes, any whole-file rewrite must be followed by a line-count check (the count may not shrink) and `git diff --stat` (a deletion with no insertion is a stop), and SA's "verified intact" read stays mandatory.
2. **The requirement review should test each scoping rule against each mode.** For every "with `accountId` set" rule, check that each section can still be produced from scoped reads. Also run every new constant or import against the exact-list guards. This catches SA-W1 / SA-W2-type contradictions one stage earlier.
3. **Keep measuring the live schema before writing the requirement.** It reshaped this slice for the better and should be standard for any page that reports on money.
4. **Name a single owner for requirement upkeep.** When BA and Dev work in parallel, TL should give the §0 status edits to one owner rather than leave a task open across stages.
5. **Make an AC that matches a SQL figure depend on the SQL result at test time, not on a fixed number.** SA-F9 and QA-2 both arose from an AC that pinned a value or definition the code had a different reason to compute.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-1 | Manual QA steps L-1 to L-13 (below), which close AC-3 (manual confirm), AC-9, AC-10, AC-24 (reload) and AC-32 | User | ⬜ Owed |
| FU-2 | RM: commit, push and open the PR for `feature/bos-finance-health-1a`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ✅ Done 2026-10-10: commit `946653a1`, PR [#284](https://github.com/AgentsPilot/neuronforge/pull/284); workplan Commit Info left to TL |
| FU-3 | Slice 1b: Section 4 credits, K-2, K-4, R-b, the SA-Q7 refactor and the G3 / lot caller lists | BA → Dev | ⬜ After 1a merges |
| FU-4 | Perf note: with `this_month`, Section 3 and K-1 read almost the same ledger range twice. Share one read if the ledger grows (QA) | Dev (later slice) | ⬜ Parked |
| FU-5 | Record `durationMs` from L-13. If a section's p95 goes above 1 s, split the route (SA-Q8) | User → SA | ⬜ Owed |
| FU-6 | The requirement's header Status line (line 7) still says "Slice 1a workplan is with Dev". BA should refresh it at the next requirement edit | BA | ⬜ Open |

### Owed manual QA steps (user)

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for the read-only checks in requirement §13.

| # | Step | Expected |
|---|---|---|
| L-1 | Open `/admin` and look at the Monitor group | "Finance" sits directly after Health, with the description "Revenue, AI cost and credits, Business OS". Clicking it opens `/admin/finance` |
| L-2 | Load the page with no query | Title "Finance & business health" and its purpose line. The header shows "This month, 2026-10-01 to <today> UTC". The order is tiles K-1, K-3, K-5, then "Our revenue", Accounts by plan and AI cost. There is no Credits, Revenue-by-month, Funnel or Payment problems heading |
| L-3 | Click Today, 7d, 30d and This month in turn. Then pick Custom with a valid range of up to 92 days and click Apply. Reload after each | The URL changes in place (`replace`, so Back does not step through each click). 7d / 30d include today. After a reload the same view shows. A pasted custom URL in a new tab gives the same view |
| L-4 | Edit the URL by hand: `?preset=nonsense`, then `?preset=custom&from=2026-01-01&to=2026-12-31`, then `?foo=1` | The first two fall back to This month / All businesses with an amber notice and no crash. `foo` is dropped silently |
| L-5 | In the business picker, choose one business, then go back to All businesses | The URL gains and loses only `accountId=<uuid>`, never a name. Section 1 shows Total 1 in that business's group. K-3 shows 1 or 0. AI cost and K-1 narrow to the business. The revenue panel does not change |
| L-6 | Check tile colours and text | K-1 is grey "Not enough history" (the previous span is before the 2026-09-29 cut-over). K-3 is amber with the reason "Founding Partners with no end date". K-5 is grey "None yet". Every tile shows a text state |
| L-7 | Check the "Our revenue" panel; run SQL check 6 | "None yet…" with no $0 and no chart. `plan_invoice_paid_live` and `boost_paid_live` are both 0 |
| L-8 | Compare SQL check 1 with Accounts by plan (AC-9) | The sum of `accounts` equals Total. The champion rows equal Founding Partner. K-3 equals `no_cohort_end_date` on the champion rows while no champion has a tier |
| L-9 | Compare SQL check 2 with AI cost, This month, All businesses (AC-10) | Total USD and credits match the `(all)` row. Charged actions equal the `kind = 'charge'` rows. The deleted bucket matches. The trigger split matches while there are no adjustments |
| L-10 | Compare SQL check 3 with the top 10 | Same accounts in the same order. A platform account shows "Platform account" |
| L-11 | Set a custom window entirely before 2026-09-29, then one that straddles it | Entirely before: the cut-over notice instead of the figures (no USD 0.00). Straddling: the notice and the figures |
| L-12 | As a non-admin, or signed out, open `/admin/finance` and `/api/admin/business-os/finance` | The page redirects and shows no figure. The API gives 401 signed out and 403 for a non-admin, both with `Cache-Control: no-store` |
| L-13 | Read the dev-server log | One `info` line, "Admin read the Business OS finance page", per load, with `correlationId`, `adminId`, filters, statuses, counts and `durationMs`, and no name or figure. Note `durationMs` |

### Status: APPROVED BY USER — COMMITTED, PR OPEN — `feature/bos-finance-health-1a` — commit `946653a1` (merge of `origin/main`: `2cc6814b`), PR [#284](https://github.com/AgentsPilot/neuronforge/pull/284)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-10 | Created (TL) | Slice 1a retrospective after the user approved the diff. It records the cycle counts, process lessons (including the BA whole-file rewrite risk), follow-ups and the user's owed manual steps L-1 to L-13. Commit pending (RM). |
| 2026-10-10 | Commit recorded (RM) | Commit `946653a1`, PR [#284](https://github.com/AgentsPilot/neuronforge/pull/284). |
