# Workplan: Admin Module BOS Reorganisation, Slice 1 (navigation only)

> **Last Updated**: 2026-09-25

**Developer:** Dev
**Requirement:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) §4, §7 Slice 1
**Branch:** `feature/admin-module-bos-reorganisation` (worktree `neuronforge-admin-bos-reorg`, based on main `b613bb97`)
**Process:** UI-only short path: Dev, then SA code review and QA in parallel, then user diff review, then RM
**Status:** Code Complete (uncommitted, awaiting SA + QA)

## Overview

Slice 1 reorders the admin sidebar so Business OS and shared pages come first and every AgentsPilot page sits under one labelled group at the bottom. It also renames labels honestly and removes the hardcoded "API / Queue / DB OK" footer. Only sidebar data, labels and structure change. No page, route, API or data changes.

---

## What Changed

| File | Action | Reason |
|------|--------|--------|
| `app/admin/components/AdminSidebar.tsx` | modify | New sections and labels; footer removed; `icon: any` becomes `LucideIcon`; two already-unused icon imports (`Sliders`, `Database`) dropped |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | create | Pins section order, one entry per admin page on disk (except Exchange Rates), honest labels and the footer removal |
| `app/admin/business-os-llm/__tests__/nav.test.ts` | modify | Placement pin updated: the entry now leads Settings, ahead of System Config (was: after it). Description pin unchanged |
| `app/admin/business-os-tiers/__tests__/nav.test.ts` | modify | Rename to "Plans & entitlements" and move to Businesses; "Business OS" now carried by the description, which the test pins |

### Sidebar before and after

| Before (5 sections, 22 items) | After (4 sections, 22 items) |
|---|---|
| **Overview:** Dashboard, Queue Monitor, System Flow, Cost Analytics | **Monitor:** Dashboard, AI cost & usage, Audit trail |
| **Users:** User Management, Onboarding, Messages, Reward Config | **Businesses:** Users, Plans & entitlements, Messages |
| **AI System:** Agent Generation, Orchestration, AIS Config, Memory & Insights, Memory Dashboard | **Settings:** Business OS AI, Model pricing & billing, Free tier & onboarding, Admin users |
| **Configuration:** System Config, Business OS AI, Business OS Tiers, Storage Config, Executions Config, UI Config, HelpBot Config | **AgentsPilot (parked)**, expanded: Agent execution queue, System flow, Agent generation, Orchestration, AIS config, Agent memory config, Agent memory dashboard, Reward config, Storage config, Executions config, UI config, HelpBot config |
| **Admin:** Audit Trail, Settings | *(merged into the sections above)* |
| Footer: "System: API OK / Queue OK / DB OK" (hardcoded) | *(removed)* |

Every href is unchanged. Exchange Rates is still unlisted.

### Decisions and deviations

| # | Item | Note |
|---|---|---|
| D-1 | "Users" keeps its name | §4.2 renames it "Businesses", but only once slice 2 adds the business panel. Today the detail view shows agents and plugins, so "Businesses" would not be honest yet |
| D-2 | Dashboard stays in Monitor | As the slice 1 scope says. Its description is now "Totals, mostly AgentsPilot" until Health replaces it (slice 4) |
| D-3 | Two existing nav tests changed their placement pins | Acceptance criterion "existing nav tests pass" is met, but two assertions had to change because the requirement moves both entries: Business OS AI now comes **before** System Config (was pinned after it), and Business OS Tiers moves to Businesses under a new name (was pinned by name, beside Business OS AI). Each pin still protects its original intent (same group as configuration; the entry names the product) |
| D-4 | No `console.*` in `AdminSidebar.tsx` | Nothing to convert |

---

## How to Verify

**Automated**

```bash
npx jest app/admin/components app/admin/business-os-llm/__tests__/nav.test.ts app/admin/business-os-tiers/__tests__/nav.test.ts
```

Result at hand-off: 3 suites, 24 tests, all passing. The new test was mutation-checked: a wrong href, the footer restored, and two sections swapped each made it fail.

A scoped `tsc` over the four files passes, and it did flag a deliberately planted type error. The full-project `npx tsc --noEmit` ran out of memory at the default 4 GB heap before it reported anything. ESLint over the four files is clean.

**Manual (QA)**

| # | Check | Expected |
|---|---|---|
| M-1 | Open `/admin` at 1920x1080 | Sections read Monitor, Businesses, Settings, AgentsPilot (parked). Business OS AI is visible without scrolling |
| M-2 | Click each of the 22 items | Each page loads, and only that item is highlighted |
| M-3 | Look below the nav | No status block and no "OK" anywhere |
| M-4 | Open `/admin/exchange-rates` by URL | Page still loads, and no sidebar item is highlighted |
| M-5 | Mobile width: open and close the sidebar | Behaviour unchanged |
| M-6 | `git diff --stat` | Only the four files above plus this workplan. No `app/admin/*/page.tsx` or `app/api/admin/**` |

## SA Review Notes

**Code Review by SA — 2026-09-25**
**Status:** ✅ Code Approved (with nits, none blocking)

UI-only short path, so there was no workplan review stage. I reviewed the uncommitted diff on `feature/admin-module-bos-reorganisation` on top of `b1b79b44`.

### Verification performed

| Check | Result |
|---|---|
| `git diff --stat` | 3 modified files, 150 insertions and 131 deletions (the sidebar went from 5 sections to 4 and lost the footer). No deletion without matching insertions. The untracked files are only the new test and this workplan |
| Scope | Only `AdminSidebar.tsx` and tests changed. No `app/admin/*/page.tsx`, no `app/api/**`, no route and no href changed. All 22 hrefs are byte-identical to before |
| Reachability | 23 `page.tsx` files are on disk and 22 are listed. `/admin/exchange-rates` is the only one left out, and the file does not contain the string `exchange-rates` |
| Footer | Fully removed (the old lines 337-361). No state or hooks belonged to it, so nothing is orphaned. `Sliders` and `Database` were already unused and are now dropped. Every one of the 20 remaining lucide imports is used |
| `icon: any` → `LucideIcon` | Correct type for every icon here, and it removes an unexplained `any` (CLAUDE.md rule 6). Accepted |
| `console.*` | None in `AdminSidebar.tsx`. Nothing to convert |
| ESLint (4 files) | Clean, exit 0 |
| `node_modules` junction | It is a link to the main checkout's `node_modules`. `git check-ignore -v` matches `.gitignore:4:/node_modules`, and `git status --ignored` lists it as `!!`. Nothing from it would be committed |
| Jest (run by SA) | `npx jest app/admin/components app/admin/business-os-llm/__tests__/nav.test.ts app/admin/business-os-tiers/__tests__/nav.test.ts`: **3 suites passed, 24 tests passed, 0 failed** (2.5 s) |

### Deviations

| # | Deviation | SA verdict |
|---|---|---|
| D-1 | "Users" was not renamed to "Businesses" | **Accepted.** It matches requirement §4.2, where the rename belongs to slice 2, and the label would not be honest until the business panel exists |
| D-3 | Two existing placement pins were edited | **Accepted: they were not weakened.** `business-os-llm/nav.test.ts:54-65` still pins "same group as System Config" (no `title:` in between) and adds "first in Settings", so it is stricter than before. The description pin at :37-45 is untouched. `business-os-tiers/nav.test.ts:31-38` now scopes "Business OS" to the entry's own description (name to next name), which is as tight as the old name-to-href+60 window. `:40-51` replaces "beside Business OS AI" (no longer true by design) with "in Businesses, and a section boundary separates it from `/admin/onboarding`". That tests the file's stated purpose, keeping the two free-tier concepts apart, more directly than the old adjacency did |
| — | `any` icon type replaced | Accepted (see above) |

### New test robustness (`app/admin/components/__tests__/AdminSidebar.nav.test.ts`)

- Reading dirs from disk is fine on Windows and in CI. It uses `path.join` plus `process.cwd()`, the same idiom as the existing nav tests, and the page list is compared as route strings. Parsing survives CRLF because the `\s*` between `name:` and `href:` absorbs `\r\n`. Two guards (scan count ≥ 23 at :109, and one `href: '` literal per parsed item) make the scan and the parser fail loudly rather than pass vacuously. Good design.
- It is sensitive to edits by design. A new admin page must get a sidebar entry, or be added to `UNLISTED`, and the count at :117 must be bumped. That friction is intended.

### Code Review Comments

1. `app/admin/components/AdminHeader.tsx:28`, `:95`: the header still titles `/admin/queues` "Queue Monitor", and its profile menu still labels `/admin/settings` as "Settings". Labels now drift between the header and the sidebar, and one of them is the old misleading "Queue Monitor" name. **Out of slice 1 scope (sidebar-only), so do not expand this PR.** Log it for slice 3. — Priority: Low
2. `app/admin/components/AdminSidebar.tsx:137-140`: "Free tier & onboarding" / "Free-tier grant & signups" is the only Settings item that does not say whose free tier it is. Its BOS counterpart names its product ("Business OS plans"), and the tiers nav test exists specifically to stop the two being confused. Consider naming the product in the description. Per requirement §2.1 the page is classed Shared, but it grants pilot tokens, storage and executions, which are AgentsPilot concepts. — Priority: Low (optional)
3. `app/admin/components/__tests__/AdminSidebar.nav.test.ts:161`: `/\bOK\b/` runs over the whole file, so a future comment containing "OK" would break it for the wrong reason. Scoping it to the JSX after `navBlock` would be tighter. — Priority: Low
4. `app/admin/components/__tests__/AdminSidebar.nav.test.ts:62`: the scan is top-level only, so a nested page (`app/admin/x/y/page.tsx`) or a route group would not be seen. None exist today. A comment noting the limit would suffice. — Priority: Low

### Optimisation Suggestions

- `AdminSidebar.tsx:300`: `globalIndex = sectionIndex * 10 + itemIndex`. The parked section has 12 items, so its entrance-animation delays overlap. This is cosmetic, it predates this diff, and it is not worth touching now.
- Reminder, not a finding: no CI workflow runs Jest yet (parked finding 2026-09-24). These pins protect only when someone runs them locally or in QA.

### Code Approved for QA: Yes

Nits 1-4 are non-blocking and do not need to be resolved before QA or RM. They belong to the user and Dev to take or defer.

## QA Testing Report

**QA — 2026-09-25**
**Test mode:** full (slice 1 acceptance criteria and a regression run over `app/admin`)
**Strategy used:** A (Jest source-scan suites), plus static code review against each criterion. Browser checks are not possible in this session (no signed-in admin), so M-1 to M-5 are split into what was verified statically and what the user still owes.
**Focus:** ui
**Skipped:** E2E. Playwright is not set up (CLAUDE.md § Testing).
**Input source:** prompt from TL, plus this workplan's manual checks

### Test Coverage

| Acceptance criterion (requirement §7, slice 1) | Tested? | Result | Notes |
|---|---|---|---|
| Section order is Monitor, Businesses, Settings, AgentsPilot (parked) | ✅ | Pass | Read in `navigationSections` and pinned by `AdminSidebar.nav.test.ts` › section order. Items per section match §7: Monitor 3, Businesses 3, Settings 4, parked 12 |
| Every existing route is reachable in at most one click | ✅ | Pass | 23 `page.tsx` under `app/admin`, none nested. The sidebar lists 22 unique hrefs, which is all of them except `/admin/exchange-rates`. No duplicates and no dangling hrefs. The parked group is still expanded, so every item is one click away. (§7 says "21 routes". That count predates Business OS Tiers. The correct figure is 22.) |
| No file under `app/admin/*/page.tsx` or `app/api/admin/**` changed | ✅ | Pass | `git status`: only `AdminSidebar.tsx`, two `nav.test.ts` files, the new `components/__tests__/` and this workplan. The branch's one commit on top of main (`b1b79b44`) is the requirement doc only |
| Business OS AI appears without scrolling at 1080p | ⚠️ | Static pass, owed | It is the 7th item, in the 3rd section. Estimated from the Tailwind spacing, its top edge sits at about 650–700 px, well inside a 1080p viewport. Needs a browser to confirm (M-1) |
| The status footer is gone and nothing else claims system status | ✅ | Pass | The footer JSX is deleted. The sidebar has no `OK`, `System Status` or API/Queue/DB rows (test-pinned). `AdminHeader.tsx` and `AdminChrome.tsx` make no status claim either |
| Active-page highlight works for every item | ⚠️ | Static pass, owed | `isActive = pathname === item.href` is unchanged from `HEAD`. Every href is unchanged and there are no nested admin pages, so behaviour is identical to before. Visual check owed (M-2) |
| Existing nav tests pass | ✅ | Pass (with D-3 caveat) | Both pass. Their placement assertions were re-pinned because the requirement moves both entries. QA agrees with SA that neither was weakened |
| Exchange Rates remains unlisted | ✅ | Pass | The string `exchange-rates` does not appear in `AdminSidebar.tsx` (test-pinned) |
| Labels are honest (§7 scope item 2) | ✅ | Pass | "Queue Monitor" is now "Agent execution queue". "Memory & Insights" is now "Agent memory config", which removes the clash with BOS Insights. All 12 parked descriptions say "AgentsPilot" (test-pinned). Dashboard says "Totals, mostly AgentsPilot". D-1 (keeping "Users" until slice 2) is reasonable. See SA nit 2 on "Free tier & onboarding" |
| No href changes | ✅ | Pass | QA independently extracted `href:` literals from `git show HEAD:app/admin/components/AdminSidebar.tsx` and from the working copy, sorted and diffed them: **identical 22 = 22**, no duplicates |

### Automated Results

| Run | Result |
|---|---|
| `npx jest app/admin/components app/admin/business-os-llm/__tests__/nav.test.ts app/admin/business-os-tiers/__tests__/nav.test.ts` | **3 suites, 24 tests, all pass** (re-run after the baseline stash was restored: same result) |
| `npx jest app/admin` | **13 suites, 299 tests, all pass.** No failures, so no pre-existing-vs-new triage was needed |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | Completed in ~267 s without running out of memory. Exit 2 with **2,077 errors, all pre-existing**. The same command on a clean tree (`git stash -u`, run, `git stash pop`; the working tree was restored exactly) gives an **identical sorted error list**. **Zero errors** in any of the four touched files |
| `npx eslint` on the four touched files | Clean |

### Manual Checks

| # | Status | How it was covered / exact steps owed by user |
|---|---|---|
| M-1 | **Owed by user** | Sign in as an admin, open `/admin` in a desktop browser at 1920x1080 (window maximised, zoom 100%). Confirm the section headings read MONITOR, BUSINESSES, SETTINGS, AGENTSPILOT (PARKED), in that order, and that "Business OS AI" is visible without scrolling the sidebar |
| M-2 | **Owed by user** (logic verified statically) | Click each of the 22 sidebar items in turn. For each one, confirm the page loads (no 404 or blank page) and that only the clicked item has the blue/purple highlight and left bar |
| M-3 | **Verified statically**; visual glance owed | Footer JSX removed; tests assert no `OK` or status rows. User: scroll to the bottom of the sidebar and confirm the last element is the "HelpBot config" item, with no status box below it |
| M-4 | **Verified statically** (no href matches, so nothing can highlight); load owed | Type `/admin/exchange-rates` into the address bar. Confirm the page loads and no sidebar item is highlighted |
| M-5 | **Owed by user** (JSX and classes for the backdrop/toggle are unchanged from `HEAD`) | Narrow the window below 1024 px (or use DevTools device mode). Tap the header menu button: the sidebar slides in over a dimmed backdrop. Tap the backdrop: it closes. Open it again, tap any item: the page navigates and the sidebar closes. Open it again, tap X: it closes |
| M-6 | **Verified** | `git diff --stat` shows only the 3 modified files. Untracked: `app/admin/components/__tests__/AdminSidebar.nav.test.ts` and this workplan. No `page.tsx` and no `app/api/admin/**` |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The change is static data only.

#### Edge Cases (nice to fix)
1. **Page titles still use the old names.** This extends SA nit 1. Besides `AdminHeader.tsx:28`, three page files still show old names: the queue page's `<h1>` says "Queue Monitor" (`app/admin/queues/page.tsx:286`), and so does the Dashboard quick link (`app/admin/page.tsx:555`); the tiers page `<h1>` still says "Business OS Tiers" (`app/admin/business-os-tiers/page.tsx:76`). They are out of slice 1 scope by design (no page changes), so log them for slice 3. — Severity: Low
2. **Repeated icons.** `Settings` is used for both "Admin users" and "AIS config", `Brain` for both "Orchestration" and "Agent memory config", and `BarChart3` for both memory dashboard and executions config. This predates the change and is cosmetic. — Severity: Low
3. **Stale count in the requirement.** §7 slice 1 says "All 21 existing routes"; the correct figure is 22, as §2.1 row 15b shows. The workplan and tests correctly use 22. — Doc nit for BA

### Final Status
- [x] All acceptance criteria pass statically and in automated tests. **Verdict: PASS**, conditional on the user's browser checks M-1, M-2, M-3 (glance), M-4 (load) and M-5 before RM commits
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-25 | Created | Slice 1 implemented, uncommitted, handed to SA and QA |
| 2026-09-25 | QA report | PASS: 24/24 sidebar tests, 299/299 `app/admin` tests, and tsc shows no new errors against a clean baseline. Browser checks M-1 to M-5 owed by user |
