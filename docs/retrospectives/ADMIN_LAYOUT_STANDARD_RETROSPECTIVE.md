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

### Status: COMMITTED — feature/admin-layout-standard — 4655d6c5, PR #285

---

## L-1b: KPI strip, status chip, admin dialog class with Scheduled jobs & queues as pilot — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-1b workplan](/docs/workplans/ADMIN_LAYOUT_L1B_WORKPLAN.md)

### What went well
- Reuse-first check paid off: the finance page (PR #284, another session) had shipped its own KPI strip and date presets; SA confirmed both tiles derive from Health's STATUS_STYLES and set the finance adoption as a later pass-through, and leaned on reusing adminWindowPresets.ts in L-1c instead of building a second preset module.
- SA's specificity analysis fixed the dialog close-X contrast without editing components/ui/dialog.tsx, and caught the "flex" trap in the primitive (M-2) before it shipped.
- The green-constant guard was tightened with a planted-violation proof (CR-1, M-3).
- Jobs' very strict pins (11 buttons, single fetch literal, Drain once, panel buttons) all held unedited.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-3, code approved with no must-fix).
- Number of Dev ↔ QA bug fix cycles: 0.
- The browser check (light + dark, dialog X computed style) is still owed for L-1a and L-1b: no signed-in admin browser was available to TL.

### Conclusions & process improvements
- Before planning a shared component, scan main for what other sessions merged since the requirement was written.
- Get a signed-in admin browser (in-app pane or Chrome extension) set up before L-1c, so the owed checks are cleared together.

### Status: COMMITTED — feature/admin-layout-l1b — ea6f4ce9, PR #287

---

## L-1c: URL filter state, date presets, filter bar with Audit trail (part 1) as pilot — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-1c workplan](/docs/workplans/ADMIN_LAYOUT_L1C_WORKPLAN.md)

### What went well
- SA caught at workplan stage that `replaceState(window.history.state, ...)` would be invisible to Next 14's `useSearchParams` (it carries `__NA`), and switched the mechanism to `replaceState(null, ...)` before any code was written (M-1); five mutation checks then proved the tests bite.
- Health's minute-form links, the cutover link and every legacy alias round-trip byte for byte; the route accepts the new end-of-day instant (checked against its Zod schema).
- RC-8 applied early: the shared picker moved to L-1d to keep L-1c at about 5 days.
- First slice under the user's fast-track rule (commit + PR after SA + QA, no approval wait).

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-5; code approved, two optional comment fixes applied by TL).
- Number of Dev ↔ QA bug fix cycles: 0.
- Browser checks B-1..B-14 (the only real-browser proof of M-1) are still owed: no signed-in admin browser available. Now owed for L-1a, L-1b and L-1c.

### Conclusions & process improvements
- Framework-behaviour claims (here: Next's history handling) must be checked against the installed version's source at workplan review — it saved a slice.
- Carry QA E-1 (URL not cleaned after an outside change that resolves to current filters) into L-1d.

### Status: COMMITTED — feature/admin-layout-l1c — 1752d93d, PR #291
