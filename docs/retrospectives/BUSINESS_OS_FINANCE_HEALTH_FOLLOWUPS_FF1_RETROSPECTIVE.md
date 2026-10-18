# Retrospective: Finance follow-ups FF-1b, FF-1c and FF-1d

> **Last Updated**: 2026-10-18

## Overview

This is a small bundle of low-risk leftovers that SA and QA flagged across the finance slices, taken now that every slice through 8.3 is merged.
- **FF-1b** adds the missing exact-pattern row for the metric CHECK to check 32 (QA-81-N1).
- **FF-1c** extracts checks 33 and 34 from the requirement into script files (the 8.2 follow-up).
- **FF-1d** adds a source guard against one-shot reads wider than the PostgREST 1,000-row cap (the 8.3 lesson).

**FF-1a** (making the redundant Exchange rates page read-only, FU-M8-1) is technically approved but held for the user's BQ-20. It is split out and does not ship here. There is no migration, no API route and no change to any money or figure. This runs under BD-33.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md)

**Branch:** `feature/bos-finance-followups` (from main `f7429b57`), worktree `neuronforge-finance-m8`

---

## What went well

- **Follow-ups were collected and closed in one cycle.** Items from the 8.1, 8.2, 8.3 and M-8 retrospectives were inventoried against the code and closed in one small bundle, instead of drifting.
- **The business question was kept apart from the technical work.** SA-WR-FF1 approved with conditions. FF-1a's only open point is BQ-20, a business call. SA found that nothing in use depends on editing the rates, so holding FF-1a costs nothing.
- **The new guard has already paid off.** FF-1d surfaced two latent defects in other streams:
  - **B-1:** BizQL's truncation never fires above 1,000 rows.
  - **B-2:** the purge preview and snapshot under-read. Purge itself is not live.

  Both were handed to separate tasks, not fixed here.
- **The allow-list can only shrink.** SA-CR-FF1 approved the guard's 20 allow-listed entries (14 files, each tagged FF-3).
- **QA passed, and its one Low bug was fixed with proof.** QA-FF1-1 found that the allow-list could still grow. It is now pinned at 14 files / 20 entries, and a test shows that adding an entry fails.
- **All seven frozen pins are unchanged.**

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. SA-WR-FF1 approved with conditions; SA-CR-FF1 approved first time.
- Number of Dev ↔ QA bug fix cycles: 1 (QA-FF1-1, Low).
- Any blocked handshake and why: FF-1a is held for BQ-20 (the user's call), by design.
- **The 1,000-row cap had been hitting other streams silently.** B-1 and B-2 predate this work and were invisible until a mechanical check existed. C-1 in 8.3 was not a one-off.

## Conclusions & process improvements

- **A guard beats a skill note for silent caps.** New one-shot wide reads now fail CI. The 20 existing entries are burn-down debt (FF-3).
- **Any allow-list in a guard must be pinned, with a test proving that it cannot grow** (QA-FF1-1).
- **Open items:** BQ-20 (the user's call; FF-1a ships separately once answered), B-1 and B-2 (separate tasks), and the FF-3 burn-down.

### Status: COMMITTED — feature/bos-finance-followups — commit `0a50f14a`, PR #463 (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (TL) | FF-1b to FF-1d retrospective after SA-WR-FF1 (FF-1a held for BQ-20), SA-CR-FF1 approved and a QA pass (QA-FF1-1 Low, fixed); B-1 and B-2 handed off; 7 pins unchanged; no migration |

TL approval: APPROVED for RM (commit, PR, auto-merge)
