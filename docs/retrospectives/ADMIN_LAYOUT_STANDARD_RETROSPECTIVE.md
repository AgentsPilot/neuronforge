# Retrospective: Admin Layout Standard

> **Last Updated**: 2026-10-11

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

---

## L-1d: table constants, drawer, Open-row button with Audit trail (part 2) as pilot — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-1d workplan](/docs/workplans/ADMIN_LAYOUT_L1D_WORKPLAN.md)

### What went well
- The business picker was split out to L-1e at workplan time (pre-authorised by SA), keeping L-1d at about 4 days.
- The drawer generalises the Activity drill-down; light-OS title and close-X contrast are fixed by inline colour and child-selector specificity without editing components/ui/sheet.tsx.
- Mutation checks (a)–(k) all bit; one (h) initially did not, which exposed a jsdom accessible-name padding quirk and led to a stronger assertion.
- QA's edge-case probe found a real reachable bug (B-1: drawer could reopen unasked and drop focus to the body after the open row left the list); fixed with a regression test before commit.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-4; code approved).
- Number of Dev ↔ QA bug fix cycles: 1 (B-1, Medium; SA had rated it Low as "outside URL change only" — QA showed it reachable via in-flight reads, search and Back/Forward).
- Browser checks (D-B1..D-B13, plus L-1a..L-1c owed checks) still not done: no signed-in admin browser.

### Conclusions & process improvements
- When a component's open state is derived from data that can change underneath it, test "the item disappears while open" explicitly — carry this into the Businesses and Activity drawer slices.
- Low note for L-1e: the focus fallback (content area) has no visible ring.

### Status: COMMITTED — feature/admin-layout-l1d — 63704ac5, PR #292

---

## L-1e: shared business picker with Audit trail as pilot — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-1e workplan](/docs/workplans/ADMIN_LAYOUT_L1E_WORKPLAN.md)

### What went well
- The split from L-1d kept both slices small; L-1e landed at about 1.5 days.
- SA caught at workplan stage that moving reads to readJsonBody would turn a cancelled request into a visible error (M-1), and specified aria-activedescendant precisely (M-2).
- A guard now pins the picker as the only shared file allowed to fetch, with self-tests for near-miss names.
- Nine mutation checks, plus two more for the QA fixes, all bit.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-4; code approved).
- Number of Dev ↔ QA bug fix cycles: 1 (QA-1 Enter after Escape — inherited from the original picker; QA-2 blank names) — fixed before commit because every later page reuses this file.
- Browser checks still owed (E-B1..E-B11 plus L-1a..L-1d).

### Conclusions & process improvements
- Fix inherited behaviour bugs in a shared component when it is first extracted; later adopters multiply the cost.

### Status: COMMITTED — feature/admin-layout-l1e — a58ee4b5, PR #293

---

## L-2a: AI cost & usage, part 1 (header, KPI strip, filter bar, URL, states) — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-2a workplan](/docs/workplans/ADMIN_LAYOUT_L2A_WORKPLAN.md)

### What went well
- First page migration on the finished building blocks; every inbound link (Health, Businesses, Activity cutover) still produces a byte-identical request, and no link builder was edited.
- SA checked the route's own Zod rules with the installed version before ruling on what the page may send, and caught the breadcrumb reset semantics (M-1) and the lost All-scope token total (M-2) at workplan stage.
- The page shrank from 1,690 to about 1,030 lines by extracting only what the slice rewrote; the owner-text guard was widened to the folder so the split could not weaken it.
- Twelve mutation checks bit, including one run under a non-UTC time zone.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-4; code approved, nothing to fix).
- Number of Dev ↔ QA bug fix cycles: 1 (B-1: a read after a failure showed zeros as if real — a regression vs main's spinner; fixed with a regression test).
- 19 pre-existing type errors remain in the table half of page.tsx (identical on main); L-2b rewrites those lines.
- Browser checks still owed (A-B1..A-B20 plus L-1a..L-1e).

### Conclusions & process improvements
- State machines with "has loaded" flags need an explicit test for success → failure → retry; add it to the default QA probe list for the remaining pages.

### Status: COMMITTED — feature/admin-layout-l2a — 61681eef, PR #295

---

## L-2b: AI cost & usage, part 2 (table, call drawer, run card, summary cards) — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-2b workplan](/docs/workplans/ADMIN_LAYOUT_L2B_WORKPLAN.md)

### What went well
- The page went from about 1,030 to 547 lines; the 19 pre-existing type errors in its table half are gone (typed `readMeta`, no casts).
- Reuse over copy: SA had the existing `isPlainLeftClick` exported instead of duplicated (Q-3).
- The drawer reused the L-1d B-1 pattern from day one; QA's disappearing-row and success → failure → retry probes all passed first time.
- Fifteen mutation checks bit, one after adding a mounted-marker pin that SA accepted.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-4; code approved).
- Number of Dev ↔ QA bug fix cycles: 1 small (QA-B1, Low: focus lost after a drill because drill links are new) — fixed before commit, plus SA C-1 type tidy.
- Browser checks still owed (B-B1..B-B11, B-QA1..B-QA7, plus earlier slices).

### Conclusions & process improvements
- Making something newly focusable (rows → links) creates a focus-after-action obligation; add "where does focus go after the action" to QA's default probe list.

### Status: COMMITTED — feature/admin-layout-l2b — 1357ad92, PR #296

---

## L-3: Archiving — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-3 workplan](/docs/workplans/ADMIN_LAYOUT_L3_WORKPLAN.md)

### What went well
- Last Monitor page; first consumer of the header badge and the neutral chip, both added with type-level guarantees (icon still required for every other tone).
- SA kept the deliberate "clear on failed refresh" behaviour because the confirm dialog shows numbers before an irreversible move — a reasoned exception to the standard, recorded.
- QA probed seven failure kinds × retry and all twelve run outcomes; no bugs.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-5; code approved).
- Number of Dev ↔ QA bug fix cycles: 0.
- Focus after "Try again" lands on the body on every migrated page (shared component) — follow-up candidate, not L-3 specific.
- Browser checks still owed (L-B1..L-B10 plus earlier slices).

### Conclusions & process improvements
- Shared AdminError "Try again" focus handling should be fixed once in the shared component rather than per page.

### Status: COMMITTED — feature/admin-layout-l3 — 4bcf33d1, PR #298

---

## L-4a: Businesses list + shared filter-bar alignment fix — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-4a workplan](/docs/workplans/ADMIN_LAYOUT_L4A_WORKPLAN.md)

### What went well
- The user's alignment report (Audit trail picker hint making the field taller) was folded into the next slice and fixed once in the shared bar: top-aligned fields, visible "Window" label, picker hint moved to one help line under the bar; every page using the bar benefits.
- The only product question (empty search should reload) was asked in plain words and answered immediately (D-16).
- The 420-line row detail was left byte-identical for L-4b, so every source-guard position check passed unedited.
- Four Businesses dialogs (not two — the boost slices had added two more) moved to the shared dialog class.
- Fifteen mutation checks bit; QA found no bugs. TL fixed QA's cosmetic note (the "BOS AI failures" button 4 px shorter than the fields) before commit.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-5; code approved).
- Number of Dev ↔ QA bug fix cycles: 0.
- Browser checks still owed: the Chrome extension shows no connected browser from this session.

### Conclusions & process improvements
- User-reported visual glitches on a shared component are cheapest folded into the very next slice that touches the bar.
- L-4b carries a user request: the per-business audit section starts collapsed.

### Status: COMMITTED — feature/admin-layout-l4 — 38c35a37, PR #300

---

## L-4b: Businesses row detail into the drawer — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-4b workplan](/docs/workplans/ADMIN_LAYOUT_L4B_WORKPLAN.md)

### What went well
- Two user requests landed in the same slice: the per-business audit section starts collapsed (folded mid-flight), and the whole row stays clickable (D-17), built with six explicit safety rules (controls and text selection ignored, opener always the row's Open button).
- page.tsx went from 1,249 to 662 lines; the destructive-flow source guard was re-expressed with an explicit old→new assertion map instead of being loosened.
- SA caught at workplan stage that mounting the audit fold on expand would fire the archive-notice request (M-2) — fixed by always mounting it hidden.
- Nineteen mutation checks bit; QA's 24 probes (disappearing open row in four ways, nine control kinds, cache across accounts, nested dialogs) found no bugs.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-5; code approved).
- Number of Dev ↔ QA bug fix cycles: 0.
- M-5 only partly met: nested credit/boost dialogs open from state with no trigger, so focus falls to the body after their Escape (pre-existing). Fixing needs five money-UI files — recorded as F-108, its own short slice.
- Browser checks still owed (B-1..B-12 plus earlier slices).

### Conclusions & process improvements
- When a slice moves destructive-flow code, require an explicit old→new guard assertion map in the workplan; it made the review mechanical.

### Status: COMMITTED — feature/admin-layout-l4b — cae9eea0, PR #309

---

## L-5: Plans & entitlements — 2026-10-11

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-5 workplan](/docs/workplans/ADMIN_LAYOUT_L5_WORKPLAN.md)

### What went well
- First page migrated with no shared export at all — the building blocks covered everything.
- Dev caught at planning that the requirement's amber Enforcement tile would contradict the Health page's tile for production's normal state; SA verified against the Health rules and ruled it neutral.
- SA re-ruled the INACTIVE chip to warn (not danger): FYI, but still unmistakable as the user asked on 2026-09-29.
- Entitlements rules respected: no import from the entitlements module, no tier or capability literals; the shared contract fixtures untouched.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1, M-2; code approved, three doc nits).
- Number of Dev ↔ QA bug fix cycles: 0.
- "Try again" focus loss is now recorded on three pages — worth a single shared fix.
- Browser checks still owed.

### Conclusions & process improvements
- Cross-check any new KPI colour rule against the Health page's rule for the same fact before building it.

### Status: COMMITTED — feature/admin-layout-l5 — 0e40bd0c, PR #310

---

## L-6: Signup Invites — 2026-10-12

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-6 workplan](/docs/workplans/ADMIN_LAYOUT_L6_WORKPLAN.md)

### What went well
- The user removed the outdated "internal demos only" note (D-18); SA found the note also carried one true, live fact (plans not enforced) required by the invite-signup GR-5 rule, and kept it as a neutral header chip — nothing true was lost.
- The shown-once invite link is protected by a new transitive import walker (G-7) that proves no Invites file can reach URL, history or storage code; SA cross-checked it with an independent TypeScript-based walker.
- QA's create → filter → refresh → four failure kinds → retry → remount sequence confirmed the link never leaves memory.
- Twenty-five mutation checks bit, including four added for the pre-commit fixes.

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-5; code approved with two Low guard hardenings, folded in).
- Number of Dev ↔ QA bug fix cycles: 1 small (QA-1: a plain-object lookup of the server's mode word could crash the badge on a prototype key) — fixed with Object.hasOwn before commit.
- Focus after "Try again" / "Clear filters" still falls to the page body on every migrated page (shared states) — the shared follow-up keeps growing.

### Conclusions & process improvements
- Any lookup keyed by a server-supplied string uses Object.hasOwn — add to the standard's coding notes.
- Do the shared "Try again" focus fix soon; it now affects every page.

### Status: COMMITTED — feature/admin-layout-l6 — 4d241b1e, PR #315

---

## L-7: Messages — 2026-10-12

**MD links:** [Requirement](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [L-7 workplan](/docs/workplans/ADMIN_LAYOUT_L7_WORKPLAN.md)

### What went well
- Characterisation first: the page had no tests, so Dev pinned today's behaviour (B-1..B-15) green on the unchanged page before migrating, and the final diff against that baseline contains only the four planned flips.
- The broken Reply (D-14 b) is gone entirely — no dead code, no reply route call; routes untouched.
- User decision D-19: failed saves, read changes and deletes now say so in plain words, without ever reading the route's error body.
- The six console.error calls in the page were converted to the client logger with facts-only context (CLAUDE.md logging rule).
- Dev caught that the list route answers without a success flag, so the shared helper would have shown every good read as a failure; handled in the page and recorded (F-111).

### What did not go well
- Number of Dev ↔ SA back-and-forths: 0 on code (workplan approved with conditions M-1..M-4; code approved).
- Number of Dev ↔ QA bug fix cycles: 0.
- Focus after an action removes its own button (Delete, Mark All Read, Try again) still falls to the page body — part of the shared focus follow-up.

### Conclusions & process improvements
- Pages with no tests get a characterisation suite before any layout change; it made the review of a 780-line rewrite mechanical.

### Status: COMMITTED — feature/admin-layout-l7 — 07198656, PR #316
