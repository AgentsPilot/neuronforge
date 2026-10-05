# Workplan: Admin Header Identity and Logo Alignment

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** none (UI-only short path; the user's request below is the requirement)
**Branch:** `fix/admin-header-identity` (worktree `neuronforge-admin-header`, from origin/main `9a7c4fb3`)
**Date:** 2026-10-02
**Status:** Code Complete

## Overview

The admin console header and sidebar carry three leftovers from the AgentsPilot template: an old logo that does not match the Business OS app, a hard-coded "Admin User" with a dropdown whose items are a duplicate link and a dead Sign Out, and a search box that searches nothing. This change aligns the logo, shows the signed-in admin's real name, and removes the dead controls.

---

## The user's requests and decisions (2026-10-02)

| # | Request | Decision |
|---|---|---|
| 1 | Logo on admin pages should match the Business OS app | Sidebar uses the shared `<Logo>` (same assets as `BusinessOSHeader`), always in the dark-background variant because the admin console is always dark. "Admin" badge kept. |
| 2 | Replace hard-coded "Admin User" with the signed-in admin's name | Display = `profiles.full_name` if set, else the auth email. Resolved on the server in `app/admin/layout.tsx`; only the display string crosses to the client. |
| 3 | Profile dropdown has no value | Removed (accepted recommendation: "Settings" duplicates the sidebar's Admin users entry; "Sign Out" had no onClick). Replaced by the name plus a working **Sign out** button. |
| 4 | "Search admin..." box searches nothing | Removed (approved). |

Kept as-is: page title + date on the left, mobile menu button, existing colours/fonts (D-4: alignment, not a redesign).

---

## Implementation Approach

- **Always-dark logo.** `<Logo>` swaps variants via the `dark` class on `<html>`, which follows the user's theme; the admin shell is dark regardless. Add one prop to `Logo`, `surface?: 'theme' | 'dark'` (default `'theme'`, so every existing call site is unchanged). `'dark'` renders the single dark-background asset (`WORDMARK.dark`, falling back to `WORDMARK.light` if it is ever null) with no theme classes. No fork, no new image. Placement `compact` (22px), non-responsive: the 28px header lockup plus the badge plus the mobile close button overflows the 256px sidebar.
- **Name.** `requireAdminPage()` already returns `{ id, email }`. The layout calls `userProfileRepository.findById(id)` (existing repository, rule 1) for `full_name`, falls back to email, then to `'Admin'`. A profile read failure is logged by the repository and degrades to the email; it never blocks the admin page. Only `adminName: string` is passed to `AdminChrome` → `AdminHeader`.
- **Sign out.** `AdminHeader` calls the shared `signOutUser({ scope: 'global', user, method: 'admin-header' })`, where `user` is the browser's own session from `useAuth()` (the admin tree is inside `PlatformShell` → `UserProvider`), so no id is sent from the server. Afterwards `window.location.replace(marketingLogoutUrl())`, the same landing as `UserMenu` and the Business OS settings page.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `components/brand/Logo.tsx` | modify | Add `surface` prop for always-dark surfaces |
| `lib/brand/__tests__/logo.guard.test.ts` | modify | Pin the `surface="dark"` path |
| `app/admin/components/AdminSidebar.tsx` | modify | Old `<Image>` → `<Logo surface="dark">` |
| `app/admin/layout.tsx` | modify | Resolve the display name, pass it down |
| `app/admin/components/AdminChrome.tsx` | modify | Thread `adminName` through |
| `app/admin/components/AdminHeader.tsx` | modify | Name + Sign out; remove dropdown and search |
| `app/admin/components/__tests__/AdminHeader.render.test.tsx` | create | Render test |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Pin the shared logo |

## Task List

- ✅ 1. `Logo` `surface` prop + guard test
- ✅ 2. Sidebar uses `<Logo surface="dark" placement="compact">`, badge kept
- ✅ 3. Layout resolves display name via `userProfileRepository`; chrome threads it
- ✅ 4. Header: name + Sign out; dropdown and search removed
- ✅ 5. Tests, ESLint, lint:hooks, scoped tsc

## Test Plan

| Check | How |
|---|---|
| Header shows the given name; email fallback is resolved server-side and shown verbatim | `AdminHeader.render.test.tsx` |
| No search input, no dropdown / Settings link | `AdminHeader.render.test.tsx` |
| Sign out calls `signOutUser` (global, `admin-header`) then replaces location with the marketing logout URL | `AdminHeader.render.test.tsx` |
| Layout display-name fallback (full name → email → "Admin") | `adminDisplayName` unit test in the same file |
| Logo `surface="dark"` renders only the dark asset with no theme classes | `logo.guard.test.ts` |
| Sidebar uses the shared Logo, not the legacy PNG; badge kept | `AdminSidebar.nav.test.ts` |
| Manual (QA) | Sign in as admin in light theme: sidebar logo is light-ink on dark; header shows own name; Sign out lands on the marketing logout and `/admin` then redirects |

## Implementation Notes

- `console.*` count in every touched file: 0 before, 0 after.
- The fallback chain lives in `app/admin/adminDisplayName.ts` (`pickAdminDisplayName` is pure and unit-tested) rather than inline in the layout. The layout's first statement is now `const admin = await requireAdminPage();`, a shape the R6 guard (`tests/helpers/admin-page-guard.ts`) accepts explicitly; the authz-surface guard suites stay green.
- `requireAdminPage()` returns `{ id, email }` only, so `full_name` comes from `userProfileRepository.findById` (`profiles`; service-role repository, filtered by `.eq('id', userId)`, the admin's own row).
- Sign out attributes the audit entry from the browser's session (`useAuth()`), so the server passes no id. Landing matches `UserMenu` and Business OS settings: `window.location.replace(marketingLogoutUrl())`.
- Sidebar logo is `compact` (22px, about 121px wide). The old PNG rendered about 18px tall, so the size is close to before.
- Results: 3 directly affected suites, 42 tests green; wider admin/brand/authz-guard run: 26 suites, 650 tests green. ESLint clean on touched files, `lint:hooks` clean, scoped `tsc` 0 errors.
- Not browser-verified by Dev: `/admin` needs a signed-in admin session, and this worktree has no DB access. QA should run the manual check in the Test Plan.

## SA Review Notes

**SA Code Review (2026-10-02)**
**Status:** ✅ Code Approved (short path, UI change)

Checked:
- **Layout guard.** `await requireAdminPage()` is still the first statement and is not in a try/catch. The name lookup runs after it, so a non-admin never reaches the profile read. `admin-authz-surface.guard` (R6) passes.
- **Profile read.** `findById` uses the service-role default client, which is acceptable here. The id is the server-verified admin's own id from `requireAdminPage`, not a value the client supplies, and the query is `.eq('id', admin.id)` (the `profiles` key is the auth user id), so rule 4 holds in substance. `findById` catches its own errors and returns `{ data: null }`, so a failed read falls back to the email and does not block the page. The repository is imported only by the server layout via `adminDisplayName.ts`. Only a display string crosses to the client, never an id or token.
- **Sign out.** It matches `UserMenu` and the Business OS settings page: `scope: 'global'`, its own `method` for audit attribution, and `location.replace(marketingLogoutUrl())`. `/admin` sits under `PlatformShell` → `UserProvider`, so `useAuth()` is available. If clicked before the provider has loaded, `user` is null. The sign-out still happens, but the `USER_LOGOUT` audit row is skipped. The other callers behave the same way.
- **Logo.** The default is `surface='theme'`, so the Business OS and `/v2` call sites are untouched. `public/images/brand/wordmark-dark.png` exists. The guard test isolates the dark branch, so a theme-swap class leaking into it would fail the test.
- Targeted suites re-run: 5 suites, 167 tests green, including the authz-surface guard. `tsc` shows no errors in the touched files.

### Code Review Comments
1. `app/admin/adminDisplayName.ts:14` — the module does not declare itself server-only, so a future client import would pull the service-role repository into a client bundle. Optional: split `pickAdminDisplayName` into a pure file and add `import 'server-only'` to the resolver. — Priority: Low
2. `app/admin/adminDisplayName.ts:29` — add a one-line comment that `findById` runs on the service role and why that is safe (own id, server-verified), per the "document why" rule. — Priority: Low
3. `app/admin/components/AdminHeader.tsx:89` — the name is `hidden md:block`, and its `title` is on that hidden span, so on a small screen the avatar gives no hint of who is signed in. This is acceptable as it stands. — Priority: Low
4. `app/admin/components/AdminHeader.tsx:99` — the Sign out button is accessible: `type="button"`, a stable `aria-label`, and `disabled` while signing out. Optional: add `aria-busy={signingOut}`. — Priority: Low

### Docs
- The only doc that mentions the old dropdown's Settings link is the historical slice-1 workplan. It is a record, so no update is needed.

### Code Approved for QA: Yes. Comments 1 and 2 are optional and do not block.

## QA Testing Report

### QA Report (2026-10-02)

**Test mode:** smoke + targeted edge cases (UI short path) · **Strategy:** A (Jest render + source guards) + D (browser checklist for the user; QA cannot sign in) · **Verdict:** PASS WITH NOTES

**Test runs (uncommitted worktree)**
| Scope | Result |
|---|---|
| `app/admin/**` + `lib/brand/__tests__` + `lib/admin/__tests__` + `components/business-os/**` + `components/public/**` (55 suites, run together) | 1291 / 1293. The 2 failures are invite copy-button tests in files this change does not touch (`InviteFriendsSection.render`, `business-os-invites/page.render`). Both pass alone (72/72), so they are flakes under parallel load |
| `app/admin/components/__tests__` + `lib/brand/__tests__` + new QA test | 53 / 53 |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (authz surface + R6 layout guard), rerun alone | 119 / 119 |
| `tsc --noEmit`, filtered to the touched files | no errors |

**Test added by QA:** `app/admin/__tests__/adminDisplayName.resolve.test.ts` (5 tests). It covers the layout's call to `resolveAdminDisplayName`, which had no direct test: no profile row, blank name, a failed profile read (degrades to the email and does not throw), no name and no email.

**Edge cases checked**
| Case | Result |
|---|---|
| Blank or whitespace full_name | ✅ Falls back to the email, because of `trim()` |
| No profile row | ✅ Falls back to the email |
| Profile read error | ✅ `findById` catches the error and returns `data: null`, so the page still renders with the email |
| Very long name | ✅ `truncate max-w-[16rem]` plus a `title` tooltip on md+. Below md the name is hidden (unchanged from before) |
| Sign-out failure | ✅ `signOutUser` never throws, because its audit and signOut calls are both caught. A failure is logged and the redirect still happens (tested) |
| Sign-out before `useAuth` has loaded | ⚠️ Works: the session is signed out and the page redirects. But `user` is null, so no USER_LOGOUT audit row is written. Low, and the same as the other sign-out controls |
| Double click | ✅ The button is disabled once signing out starts |
| Logo default path (Business OS) | ✅ The change only adds code. The `surface='theme'` path is byte-identical, and `BusinessOSHeader` passes no `surface`. `wordmark-dark.png` exists |
| Removed Settings link and search box | ✅ No code references them. `/admin/settings` is still reachable from the sidebar. The PR #176 QA checklist item "header Settings link" is now **obsolete** |

**Bugs:** none.

**Notes (Low, non-blocking):** (1) `AdminHeader.tsx:31,53`: sign-out before the session has loaded writes no audit row. (2) The two invite render tests are flaky under the full parallel run; they are outside this change.

**Browser checklist (user, signed in as an admin)**
1. Open `/admin`. The sidebar shows the Business OS wordmark with light ink, readable on dark, next to the "Admin" badge. No old PNG.
2. Toggle the app theme light/dark (in Business OS), then return to `/admin`. The logo stays readable in both.
3. The header shows your profile name, or your email if the profile has no name. It never says "Admin User".
4. The header has no search box and no dropdown chevron. Clicking the name or avatar does nothing.
5. Narrow the window below about 768px. The name hides, the avatar and Sign out stay, and nothing overflows. On a phone width, Sign out is icon-only.
6. Click Sign out. The button shows "Signing out…" and you land on the marketing sign-out page. Pressing Back does not show the admin console.
7. Open `/admin` again. You are sent to sign-in.
8. Optional: in `/admin/audit-trail`, check for a USER_LOGOUT row with `method: admin-header`.
9. Check that `/admin/settings` still opens from the sidebar.

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Created | Workplan + implementation (Dev) |
