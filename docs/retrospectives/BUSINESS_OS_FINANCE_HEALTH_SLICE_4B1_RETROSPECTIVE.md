# Retrospective: Business OS Finance & Business Health — Slice 4b.1 (Boost reversal events, writer)

> **Last Updated**: 2026-10-17

## Overview

Slice 4b.1 is the writer half of BD-17: refunds and lost disputes count in the month we recorded them, and finished months never change. It adds the append-only table `business_os_boost_reversal_events` and replaces the money function `business_os_transition_boost_purchase`. The signature stays the same. The body is the `20261031` body plus six `INSERT … SELECT … ON CONFLICT DO NOTHING` statements, so every refund step and dispute stage gets one dated row. A second migration, `20261073`, is the regenerated test-account cleanup. Both migrations are applied to production by hand. This slice has no UI, no finance read, and no webhook or repository change.

**MD links:** [Requirement §11I](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [Workplan 4b.1](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md) | [Refund timing scoping](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md)

**Branch:** `feature/bos-finance-health-4b` (worktree `neuronforge-finance-health`), cut from `main` `f0b5e9d4`. Uncommitted at the time of writing.

---

## Cycle Summary

| Step | Outcome |
|---|---|
| BA requirement (§11I) | Written. SA requirement review SA-Q65 to SA-Q74, E-65 to E-69 |
| SA workplan review | ✅ Approved with conditions B1-R1 to B1-R3 (all Low, all applied). Rulings SA-W105 to SA-W115. E-70 applied to the requirement |
| Dev implementation | Code Complete 2026-10-17 |
| SA code review | ✅ Code Approved, **no conditions** |
| QA | ✅ PASS (AC-204 to AC-215). One merge-readiness bug: QA-4B1-1 (Medium) |
| Go-ahead | Standing user go-ahead BD-32/33: slices proceed once SA, QA and TL approve. This slice stops for its production migrations |

---

## What went well

- **No test-mode refund was needed.** PGlite 0.5.8 (PostgreSQL 18.3, in-process) was the local database, and SA-W110 ruled that it satisfies E-66. The local-only self-check passed **20/20** (S-01 to S-20, 16 events written, all rolled back). Dev got that result and QA reproduced it on its own.
- **The original function lines are byte-identical, and this is proven.** Because the six points are `INSERT … SELECT` from the locked, just-updated row, no original line had to change. Both the migration test and SA's own script remove the six inserts and get a body byte-equal to `20261031`. Old md5 `b9a5fe318eb25cdc65ba0402b23d7241`, new md5 `018c4447f2b52dd87e4ae3b229e5b42c`.
- **A fail-closed md5 gate on the live function.** The live body could not be read through PostgREST (V-8). So `20261072` takes its lock and then refuses unless the live body hashes to the `20261031` body. This means a hand hotfix can never be dropped silently. PGlite showed the gate refusing on a second apply and on a hand-changed body.
- **The E-65 lock closes the in-flight refund gap.** `LOCK … IN EXCLUSIVE MODE` with a 5 s `lock_timeout` comes before the "no undated refund or dispute" assertion. Reads keep working. A transition already in flight makes the lock wait, and then the assertion sees its refund and refuses. Check 24's E-65 row covers the remaining window.
- **G-18 was handled up front.** The new CASCADE edge would have blocked every Danger Zone check at G-18. The regenerated cleanup `20261073` reviews that edge as parent-owned and adds no delete step (SA-Q66, SA-W105). QA confirmed it is genuine generator output.
- **Three re-pins, all legitimate.** These were the export totals 155 → 156, the no-deletion-paths allow-list adding `20261046`, and the L8 credit-lots allow-list adding `20261047`. SA checked each one: the files are applied history, pinned by sha256 and never edited, so no new deletion path opens.
- **Mutation testing was thorough.** Dev ran 5 mutations and QA ran 4 more. Every one was caught. The bare-arbiter mutation is caught only by the migration-test text pin, and SA accepted that.
- **Rollback is safe.** The order is 73 then 72, both or neither, with a row count first. The `20261072` rollback refuses once dated money history exists (AC-215, proven in PGlite).

---

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0** rejections. The workplan was approved with three Low conditions, which Dev applied before code review. The code review was approved with no conditions.
- Number of Dev ↔ QA bug fix cycles: **0** code defects. One merge-readiness bug (QA-4B1-1) is carried to RM.
- **Merge drift with DE-7 (QA-4B1-1, Medium).** DE-7 (PR #446, `5c214310`) merged during QA. It rewrote `lib/business-os/data-export/__tests__/exportClassification.test.ts`, and the 4b.1 hunk no longer applies. The fix, which QA proved on a scratch export of main (69/69 suites, 3304/3304 tests): both `toHaveLength(155)` become 156, the `:296` title becomes "156", and the totals become `156 = 38 include + 0 planned + 118 exclude`. **RM applies this while merging origin/main.**
- **9 Windows-only `test:gate` failures.** 9 suites and 18 tests fail locally: `contact-drawer` (3), `supabaseFetch`, `openaiPricingAdapter`, `onboarding` (2), `publicEndpointsAreThrottled`, `oneAddressPolicy`. QA showed that the same 9 suites and 18 test names fail on an LF export of origin/main. The causes are backslash and `C:\` paths and a `NODE_ENV` ceiling. None are from 4b.1. Linux CI is the judge. They still add noise to every local verification bar.
- **Pre-existing TS2353** in `exportClassification.test.ts` (`:1960` on main). It is not from this slice, but it means scoped tsc never exits 0 on that file.
- Blocked handshakes: none.

---

## Conclusions & process improvements

- **Rebase before QA signs off on long slices.** The DE and finance streams both edit `exportClassification.test.ts` totals. When a slice changes a shared count pin, QA should do a rebase dry run against the latest origin/main as a standard step (QA did it here and caught the drift).
- **Use the md5 gate and lock pattern again.** For any future `CREATE OR REPLACE` of a live money function whose body cannot be read through PostgREST, fail closed on the expected body hash, and assert after an `EXCLUSIVE` lock.
- **The Windows `test:gate` failures should be tracked once,** so they stop being re-diagnosed in every slice. This is a candidate for the Jest local-vs-CI flake work.
- **Order for the hand-applied migration (QA addition):** the user runs step 1 only once the rebased PR is open and green. Otherwise production could hold 72 and 73 while the PR cannot merge, and the Danger Zone stays blocked on the stamp.

---

## Release and apply plan

1. RM commits, merges origin/main applying the QA-4B1-1 fix, pushes, and opens the PR. **Auto-merge stays OFF.**
2. Once the PR is green, the user runs:
   1. check 23 (8 rows ok);
   2. apply `20261072`;
   3. apply `20261073`;
   4. check 24 (23 rows ok);
   5. says "applied" with the UTC time and the result.
3. RM records AC-216 under the workplan's Commit Info and merges by hand.
4. No Danger Zone use from applying `20261072` until the 4b.1 deploy (B1-R1).

---

## Follow-ups

| ID | Item | Owner |
|---|---|---|
| FU-4B-1 | A late `dispute.created` for an already closed dispute reopens a paid row. Its `dispute_opened` insert conflicts, so check 25 shows `dispute_ok = false`. This is existing `20261031` behaviour, recorded only (SA-W112, RV-8) | Later slice |
| Post-apply checks | User runs checks 23 and 24 on production around the apply (AC-216). The first real G-18 run happens on the first Danger Zone use after the deploy (AC-214 live part) | User |
| 4b.2 | Finance reads and UI over the events table (E-68 Pin B, E-69 two reads in 100-id chunks, AC-173) | Next slice |
| BQ-13 | **Still open.** There is no credit take-back: 4b.1 writes no credit lot or lot draw | User (business decision) |
| QA edge 1 (Low) | Give the full rollback paths in the §10 rollback note | RM / Dev |

---

### Status: PENDING RM COMMIT — feature/bos-finance-health-4b — (hash to be recorded by RM)

TL approval: approved for RM commit + PR (auto-merge OFF until the user applies 20261072 and 20261073)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-17 | Created (TL) | Retrospective for slice 4b.1 after SA code approval and QA pass; QA-4B1-1 merge drift carried to RM |
