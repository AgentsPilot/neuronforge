# Retrospective: MK-9, paying exactness and trial-to-paid (with MK-10 folded in)

> **Last Updated**: 2026-10-26

**MD links:** [ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md) | **Branch:** `feature/admin-money-mk9-paying-trial`, worktree `neuronforge-finance-m9`. This is the last Page 1 slice of the Money restructure.

## Overview

MK-9 makes the paying figures exact and adds trial-to-paid. It reuses MK-5b's read (SA-Q-MK9-1, option 1; the user was told this as information).

MK-10 is folded in from the user's comment of 2026-10-25, quoted verbatim: "have the open of the business line similar to the business lines, clicking on the line should open as well, and have the same button as we have there." The line now opens the same way as the business lines, through one shared `rowOpenTarget` (SA-Q-MK10-1, option A).

## What went well

- **The workplan conditions were met before code.** SA-WP-MK9 approved with conditions R1 to R5, and all five were met.
- **Reuse kept the read cost flat.** Sharing MK-5b's read added no new read.
- **The user's comment became a ruled slice quickly.** MK-10 was ruled the same way (option A, MK10-R1 to R5 met), so every row opener now shares one target.
- **SA-CR-MK9 caught two defects, and both were fixed.** The final verdict is Code Approved:
  - C-1: trials ending later today were counted twice.
  - C-2: the SQL used the wrong platform id.
- **QA passed with no bugs.**
- **AC-145 moved only as ruled, to `33340751`.** Removing the change gives main's `5e911c70` (re-frozen by `fe6941d2`). No pin file changed.

## What did not go well

- Dev ↔ SA back-and-forths: 2 (C-1 and C-2 at code review; MK-10's ruling). Dev ↔ QA bug fix cycles: 0.
- **Parallel annotation dropped a heading again.** SA's and QA's parallel edits to the same workplan lost the QA heading, and it was restored. This is the second time, after 4b.2.
- **A blocked handshake outside the team.** The GitHub suspension on 2026-10-21 delayed the MK-8 push by four days.

## Conclusions & process improvements

- **From now on, annotators append to the workplan, or SA and QA run in sequence.** Never run parallel rewrites of one MD.
- **"Ends today" boundaries need an explicit test.** C-1 slipped past the plan.
- **Follow-ups (QA, Low, optional):**
  - MK9-FU-1: "Paid: Unknown" is shown twice.
  - MK9-FU-2: Comped has no "at least" when its read hits a cut-off.
  - MK9-FU-3: a comment claims a paying account in Comped "is not hidden", but the builder cannot produce that case. Correct or remove the comment.
- **Owed by the user:** a production run of the two SQL checks.
- **After merge:** Page 1 is complete, and the user reviews it before Page 2 starts.

### Status: APPROVED FOR COMMIT — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
