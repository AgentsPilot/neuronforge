# Retrospective: Finance slice 4b.2, refund and dispute display from the reversal events

> **Last Updated**: 2026-10-17

## Overview

Slice 4b.2 is the reader half of BD-17; 4b.1 (#447) is the writer. It adds four reads to `BusinessOsFinanceReadRepository`: R-n and R-n′ for the dated reversal events, and R-l and R-l′ for purchases that need attention now. It also changes the finance builders in these ways:
- Refunds and lost disputes count in the window they were recorded in, whatever month the purchase was paid.
- Open disputes are shown as held now and never subtracted from a window's net.
- Section 6 gains a payment-problems block for boosts.
- K-5 turns red on an open dispute.
- Section 4 shows bought credits beside gifted credits, never combined.
- The Accounts tab and the account summary follow the same rule.

There is no migration, no write, no new route and no new page request. Nothing writes a credit lot or a lot draw (BQ-13).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11I](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-4b2` (cut from the #447 tip `20b4cdf1`, stacked on #447), worktree `neuronforge-finance-health`

---

## What went well

- **No business question had to go to the user.** SA-WR-4b2 approved with conditions 4B2-R1 to 4B2-R4 and edits E-102 to E-104. Held money stays out of net, as BD-17 already decided, so no BQ was raised.
- **Every deviation was written down.** Dev recorded DV-1 to DV-12, and each was ruled at code review.
- **SA's code review caught a user-visible mislabel on a money page (CR-1).** The Section 6 frame is now "Payment problems". "Not ours" appears only on the client block, so our own boost problems are never labelled as someone else's.
- **QA tested at realistic volume.** The PGlite run used 1,205 real events plus 150 synthetic ones. Paging past the cap and tenant isolation (ownership through the parent purchase) were both proven, and there were 0 credit draws (BQ-13 held). QA passed with no bugs.
- **The pins held.** AC-145 moved only by the ruled update, to `39b35743…56ea`. QA re-ran Pin C on a quiet machine: 11/11, three times (CR-3).

## What did not go well

- Number of Dev ↔ SA back-and-forths: 2. SA-WR-4b2 had conditions (4B2-R1 to R4, E-102 to E-104). SA-CR-4b2 approved with conditions CR-1 to CR-3, which were closed without a re-review.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: the PR is held behind #447, which waits for the user to apply `20261076` and `20261077`, by design.
- **The SQL checks lagged the code.** Checks 19 and 20 still used the old purchase-month rule and had to be re-issued on the event rule (CR-2).
- **Two reviewers' parallel edits to one MD lost a heading.** QA and SA edited the workplan at the same time, and the "QA Testing Report" heading was dropped. QA restored it, but a parallel edit like this can just as easily blank a section.

## Conclusions & process improvements

- **When reviewers work in parallel on one MD, each must use targeted Edits on their own section only.** Never rewrite the whole file, and check `git diff --numstat` afterwards (the same lesson as the agent truncation hazard).
- **When a slice changes a money rule, re-issue every SQL check that encodes the old rule in the same slice.** List those checks in the workplan's file table.
- **On a money page, review the labels as carefully as the figures.** A wrong owner word ("not ours") misleads as badly as a wrong number.
- **Timing pins flake under load; re-run them on a quiet machine before calling a pin red** (Pin C, CR-3).
- **Release order for RM:**
  1. Commit and push this branch now.
  2. Once #447 has merged (after the user applies `20261076` and `20261077`), merge `origin/main` into this branch (no rebase) and re-verify.
  3. Open the PR, then turn on auto-merge and Auto-fix.
- **Owed to the user:** the browser steps for AC-107 and AC-232, after deploy.

### Status: COMMITTED — feature/bos-finance-health-4b2 — commit `81d688e3`, main merged `ba6772c8`, PR #459 (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | 4b.2 retrospective after SA-WR-4b2 (4B2-R1 to R4, E-102 to E-104), SA-CR-4b2 approved with conditions (CR-1 relabel, CR-2 checks 19/20 re-issued, CR-3 Pin C re-run) and a QA pass with no bugs; AC-145 ruled update to 39b35743…56ea; stacked on #447 |

TL approval: APPROVED for RM (commit and push branch now; open PR after #447 merges)
