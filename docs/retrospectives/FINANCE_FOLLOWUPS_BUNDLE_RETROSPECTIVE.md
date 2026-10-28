# Retrospective: Finance follow-ups bundle

> **Last Updated**: 2026-10-27

**Branch:** `chore/finance-followups-bundle`, worktree `neuronforge-finfu` | **Workplan:** [FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md](/docs/workplans/FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md)

## Overview

One commit for the user's approved follow-ups (the user's numbering, 2026-10-27):
- **2, MK2-FU-1:** F-K3 and A-K1 are identical on This month, through one shared read.
- **3, MK9-FU-1:** "Paid: Unknown" now shows once.
- **5, MK9-FU-3:** a comment fix.
- **6, MK3A-FU-1:** an exact two-way type check.
- **9, R4-FU-1:** R-d and `revenue.state` removed.
- **10, FF-3 tranche A:** AuditTrail, SmartLink and Insight now read in pages of at most 1,000 rows, ordered with an id tie-break. The range-cap list drops from 14/20 to 11/17.
- **11, CPU1A-FU-1:** the leak guard now catches function-parameter forms.

Item 1, the SQL checks, was run on production by the coordinator. Test mode has 1 paying Pro account; live mode has 1 comped account and 1 trial with 0 paid.

**The user's decisions:**
- BQ-FU-1: "identical" means identical for data read at the same moment.
- BQ-FU-2: remove R-d.
- BQ-FU-3: take FF-3 tranche A only; the rest becomes FF-3b, together with B-1 and B-2.

## What went well

- **The workplan review corrected the plan before code.** SA-WP-FU approved with FU-C1 to FU-C7. FU-C1 corrected the pin table (Pin B moves by one line), and FU-C2 added the nested parameter form.
- **QA proved each item with fakes that behave like the real thing.**
  - Item 2: a fake that filters by range gave 7.75 on all three tiles.
  - Item 6: the planted proof is recorded.
  - Item 10: fakes that shuffle tied rows. Without the id tie-break, the read lost rows (1,779 of 2,500). With it, the counts are exact, and an error on page 2 gives no partial figure.
  - Item 11: the guard catches 10 of 10 forms, against 2 of 10 on main.
- **SA-CR-FU approved, and QA passed with no bugs.**
- **The pins moved only as ruled:**
  - AC-145: `aebc22cb` → `38897cd3`, with the restore proof.
  - Pin B: `a1b3db0c` → `eac3590a`.
  - Finance tables: 9 → 8. Billing readers: 3 → 2.
  - Unchanged: AC-173, Pins A, C and D, T-12 and the bos-llm baseline.

## What did not go well

- Dev ↔ SA back-and-forths: 1 (the workplan conditions). Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **One follow-up's description was stale.** R4-FU-1 had already been neutralised. The Step 0 check found the real remaining read, R-d.
- **The overlap with 1b:** #532 merged first and also edits `financeCopy.ts`, in a different hunk. RM merges main in before the PR.

## Conclusions & process improvements

- **Re-verify a follow-up against the code before planning it.** Its description can be stale.
- **Paging needs a total order.** Without a tie-break, rows are dropped silently.
- **New follow-ups:**
  - INS-FU-1: `InsightRepository.getVectorMaturity`'s visitor count has always been null, so maturity never credits page views. It needs its own requirement.
  - BLL-FU-1: shrink the `typecheck:bos-llm` baseline, since 16 entries are now fixed. This is a one-file PR after merge.
  - FU-SL-1 (QA Q-1): SmartLink returns `{}` when page 2 fails. This is its existing never-fatal behaviour, but it is worth a look.
  - QA Q-2: the wording of FU-AC-11 is superseded by FU-C1. No action needed.
- **Still open:** FF-3b (the rest of FF-3), plus B-1 and B-2.

### Status: APPROVED FOR COMMIT — chore/finance-followups-bundle — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
