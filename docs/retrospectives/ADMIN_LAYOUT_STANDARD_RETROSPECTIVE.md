# Retrospective: Admin Layout Standard

> **Last Updated**: 2026-10-10

## Overview

One section per slice of the Admin Layout Standard. Requirement: [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md).

---

## L-0 + L-1a: the standard, and shell / header / states with Health as pilot — 2026-10-10

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-1a workplan](/docs/workplans/ADMIN_LAYOUT_L1A_WORKPLAN.md)

### What went well
- Four parallel read-only surveys (file:line) before the BA wrote anything made the requirement factual, and the BA spot-check caught one survey's wrong line numbers.
- The SA's pilot-per-slice rule (every shared part ships with one real page using it) kept L-1a small and proven on Health, with no unused code merged.
- Health's strict existing tests (single fetch, region count, green confined to one constant, verbatim server text) all stayed green unedited; only the planned test edits were made.
- Honest type check: scoped tsconfig with a deliberate canary error, run independently by Dev and QA.
- Scope discipline held: QA found no bugs; findings outside layout went to the requirement's "Found, not in scope" list (94 items) rather than into code.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions, code approved with no must-fix).
- Number of Dev ↔ QA bug fix cycles: 0.
- Requirement went through BA → SA → BA → user → BA → SA: the first page order put pilots outside the user's priority (Monitor first). Asking for the section priority up front would have saved one re-cut.
- The browser check in light and dark colour scheme was not done before commit: `/admin` needs an admin session, the login lives in a separate app on port 3001, and the in-app browser and Chrome were not signed in / connected. Owed after merge.
- The button label "Re-read" came from the brief's wording; the user preferred "Refresh" at diff review (D-15). Labels deserve an explicit question in the user-decisions list.
- One doc carried a backslash escape in a QA table (harmless, not hex) — caught by TL's scan before commit.

### Conclusions & process improvements
- Ask the user for priority order (which section/pages matter most) in the first decisions round.
- List user-visible labels/wording that the standard fixes as an explicit user decision.
- For admin browser checks, arrange the signed-in browser (in-app pane or Chrome extension) before QA starts.
- Keep scanning every MD for backslashes before commit.

### Status: APPROVED by user 2026-10-10 — commit + PR pending (RM)
