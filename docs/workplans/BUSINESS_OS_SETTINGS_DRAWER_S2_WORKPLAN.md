# Workplan: Business OS Settings Drawer, S-2 (Change password drawer)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §3 row 10, §4.1, §4.4, §5 S-2, SA conditions C-2, C-3, C-7, C-9, C-10, C-12, C-13; SA-3 (b); SA S-1 code review findings 2 and 3
**Branch:** `feature/settings-drawer-s2` (created by RM from `feature/settings-drawer-s1`, PR #388, not yet merged; rebases on `main` once #388 merges)
**Path:** UI short path (SA-5): short workplan, implementation in the same run, then SA code review and QA
**Date:** 2026-10-15
**Status:** Code Complete 2026-10-15 (uncommitted). Awaiting SA code review, then QA

## Overview

S-2 moves **Change password** from an expand-in-place row into the settings drawer that S-1 built. The row stays on the page as the opener (`aria-haspopup="dialog"`, focus returns to it). The three fields, the show/hide toggle, the in-flight state and the success and error messages all live inside a new `ChangePasswordDrawer`, so closing the drawer unmounts the form and clears the fields (C-7). While the change request is in flight the drawer refuses to close (`isBusy`, C-4). The Google / provider notice stays inline, and accounts that sign in with a provider still get no form. `?section=password` keeps opening the password drawer, and closing a link-opened drawer takes `section` off the address. That "link flag + replace on close" pair, which S-1 wrote inline for the plan drawer, is extracted into a small hook used by both drawers (SA S-1 finding 2). The password change itself is untouched: same `changePassword` client, same `/api/user/change-password` route, same validation messages. No server, database or translation change.

**Code verified against:** `app/business-os/settings/page.tsx` at `d6078f8b` (S-1). Locations are by symbol or anchor (C-13).

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [Task List](#task-list)
5. [Test Plan](#test-plan)
6. [Manual QA Checklist (C-10)](#manual-qa-checklist-c-10)
7. [Open Questions for SA](#open-questions-for-sa)
8. [Implementation Notes](#implementation-notes)
9. [SA Review Notes](#sa-review-notes)
10. [QA Report (2026-10-15)](#qa-report-2026-10-15)
11. [Commit Info](#commit-info)
12. [Change History](#change-history)

---

## Analysis Summary

| Area | As found on `d6078f8b` |
|---|---|
| Password state | `passwordForm` (`current`, `new`, `confirm`), `showPassword`, `changingPassword` are `useState` in `BusinessOSSettingsContent`, so typed values outlive a collapse of the row |
| Handler | `handlePasswordChange`: required → mismatch → length < 8 checks, then `changePassword(current, new)` (`lib/client/change-password.ts` → `POST /api/user/change-password`). Failure shows `result.error` (server text) or `settings.security.password_error`; success shows `settings.security.password_updated`, clears the form, collapses the row. Messages go to the **page banner** at the top, which an open drawer would hide |
| Logging | One `logger.error({ err }, 'Failed to change the password')` in the catch. No field values logged today |
| Row | Inside `signsInWithProvider ? providerNotice(…) : (…)`. A `<button>` toggling `expandedSection === 'password'`; no `id`, so `scrollToSection('password')` never found an anchor |
| Provider notice | `usesOAuthSignIn(user)` → notice (two wordings via `hasBothSignInMethods`), no form |
| Deep link | The effect's tail: `if (requested !== 'password') return; setExpandedSection(requested); scrollToSection(requested)` |
| Sender of `?section=password` | None in the repo (SA-3 (b)). Kept because it is cheap; nothing else built for it |
| Plan drawer (S-1) | `planDrawerOpen` state + `planOpenedByLink` ref + `handlePlanDrawerChange` (`router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false })` when link-opened). Pinned by `settingsDeepLinks.guard.test.ts` |
| i18n | Every string needed exists in en / he / es: `settings.security.change_password`, `current_password`, `new_password`, `confirm_password`, `update_password`, `password_updated`, `password_error`, `password_mismatch`, `password_short`, `password_required`, `common.close`, `common.show`, `common.hide`. **No new keys** |
| Tests touching the password flow | None render the page. `lib/audit/__tests__/passwordChangeSeverity.guard.test.ts` pins the route and the V1 `SecurityTab`, not this page |

---

## Implementation Approach

### A. `useLinkOpenedDrawer` (new, `components/business-os/settings/useLinkOpenedDrawer.ts`)

SA S-1 finding 2: a second link-opened drawer arrives, so the pair is extracted rather than copied.

```typescript
export function useLinkOpenedDrawer(): {
  open: boolean;
  openFromRow: () => void;   // never writes the address
  openFromLink: () => void;  // marks link-opened EVERY time (SA Q-2 / W-3), then opens
  onOpenChange: (next: boolean) => void; // on close of a link-opened drawer: router.replace(section removed, { scroll: false })
};
```

It owns `useRouter`, `usePathname`, `useSearchParams` and the flag ref, and reuses `settingsUrlWithoutSection` (C-3: replace only, only `section` removed, `checkout` / `tab` kept). `openFromRow` and `openFromLink` are stable (`useCallback` with no deps), so the page's deep-link effect can list them without re-running. The plan drawer moves onto it with identical behaviour; the page then needs no router of its own.

### B. `ChangePasswordDrawer` (new, `components/business-os/settings/ChangePasswordDrawer.tsx`)

- Props: `open`, `onOpenChange`, `returnFocusRef`. Reads `t` / `isRTL` from `useLanguage()` (as `PlanSection` does); renders `SettingsDrawer` with `title = t('settings.security.change_password')`, `closeLabel = t('common.close')`, `isBusy`, `testId="settings-password-drawer"`.
- The outer component holds only `isChanging` (it must sit above `SettingsDrawer` to feed `isBusy`). An inner `ChangePasswordForm`, a child of the sheet content, holds the three fields, show/hide, and the drawer's own success / error message. Radix unmounts the content on close (no `forceMount`), so **closing clears every typed value** (C-7). `isChanging` cannot be true on close because the drawer refuses to close while busy.
- The handler is `handlePasswordChange` moved as is: same three checks in the same order, same `changePassword(current, new)`, same messages and keys. Differences, all forced by the move: messages render **inside the drawer** (`role="alert"` / `role="status"`) instead of the page banner; on success the fields clear and the success line stays in the drawer (no 3 s timer: the owner closes the drawer when they have read it); no row collapse because there is no row to collapse.
- A `<form onSubmit>` wraps the fields so Enter submits; the show/hide button is `type="button"`. Inputs get `aria-label` (their placeholder text) and `autoComplete` (`current-password` / `new-password`) so password managers and screen readers handle them. The confirm field stays always masked, as today.
- Logging: module logger `createLogger({ module: 'ChangePasswordDrawer' })`, one `logger.error({ err }, …)` in the catch. **No field value is ever put in a log call** (C-7); a render test checks the logged arguments.

### C. Page (`app/business-os/settings/page.tsx`)

1. Imports: drop `useRouter`, `usePathname` (now in the hook) and `settingsUrlWithoutSection`; add `useLinkOpenedDrawer`, `ChangePasswordDrawer`; drop `Eye` / `EyeOff` if unused. The header comment about the router moves to the hook.
2. State: remove `planDrawerOpen`, `planOpenedByLink`, `passwordForm`, `showPassword`, `changingPassword`; add `const planDrawer = useLinkOpenedDrawer()`, `const passwordDrawer = useLinkOpenedDrawer()`, `passwordRowRef`.
3. The provider block (`signsInWithProvider`, `signsInWithBoth`, `providerName`, `providerSecurityUrl` and their comment) moves **above** the deep-link effect, unchanged, so the effect can read `signsInWithProvider`.
4. Deep-link effect, plan and password branches only (C-2): `if (requested === 'plan') { openPlanFromLink(); return; }` (literal kept for `planBadge.test.ts`); `if (requested === 'password') { if (!signsInWithProvider) openPasswordFromLink(); return; }`. The `business` / `invoice`, `timezone` and `preferences` handling stays byte for byte. A provider account landing on `?section=password` sees the page unchanged, as today (no form exists for them; nothing scrolled before either).
5. Remove `handlePasswordChange` and `handlePlanDrawerChange` from the page.
6. Plan row: `onClick={planDrawer.openFromRow}`, `aria-expanded={planDrawer.open}`; drawer `open={planDrawer.open} onOpenChange={planDrawer.onOpenChange}`.
7. Password row (non-provider branch): `ref={passwordRowRef}`, `type="button"`, `aria-haspopup="dialog"`, `aria-expanded={passwordDrawer.open}`, `onClick={passwordDrawer.openFromRow}`, static `ChevronRight` (as the plan row), then `<ChangePasswordDrawer open onOpenChange returnFocusRef={passwordRowRef} />`. The provider notice branch is unchanged.

Untouched (C-9): `loadData`, `persistTimezone`, `saveProfile`, the export handler, the profile card, Language / Currency / Timezone rows (incl. `id="settings-section-timezone"` and the three guarded option rows), consent row, Invite friends, Export, Log out, Delete, both dialogs, the page banner (still used by every inline function). `expandedSection` stays for the consent row until S-3.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/useLinkOpenedDrawer.ts` | create | Extracted link-opened pair (SA S-1 finding 2; C-3) |
| `components/business-os/settings/__tests__/useLinkOpenedDrawer.test.tsx` | create | Hook unit test |
| `components/business-os/settings/ChangePasswordDrawer.tsx` | create | Password drawer, form state inside (C-7) |
| `components/business-os/settings/__tests__/ChangePasswordDrawer.render.test.tsx` | create | Open, clears on close, busy refuses close, messages inside, no field values logged |
| `components/business-os/settings/__tests__/SettingsDrawer.layers.test.tsx` | create | Each busy-refusal layer pinned on its own (SA finding 3 / QA E-1), now that `isBusy` has a real caller |
| `app/business-os/settings/page.tsx` | modify | As §C |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | modify | Plan pins follow the hook; password branch, row and C-7 pins with negative controls |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | S-1 status (PR #388), S-2 progress, Change History |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S1_WORKPLAN.md` | modify | Status header MERGE PENDING, Change History |

**Not modified:** `SettingsDrawer.tsx`, `settingsSectionUrl.ts`, `lib/client/change-password.ts`, `/api/user/change-password`, translations, `greetingUsesTheEditedName.guard.test.ts` (its `router.push(` ban still holds, the page now has no router at all), `planBadge.test.ts`, `darkModeTokens.guard.test.ts`, `CRMContactDrawerV2.tsx`.

---

## Task List

- ✅ T0. Housekeeping: S-1 status in the requirement and the S-1 workplan (MERGE PENDING, PR #388), Change History rows.
- ✅ T1. `useLinkOpenedDrawer.ts` + unit test.
- ✅ T2. `ChangePasswordDrawer.tsx`.
- ✅ T3. `ChangePasswordDrawer.render.test.tsx`.
- ✅ T4. `SettingsDrawer.layers.test.tsx`.
- ✅ T5. `page.tsx`: plan drawer onto the hook; provider block moved up; deep-link plan / password branches; password row + drawer; remove password state and handler.
- ✅ T6. `settingsDeepLinks.guard.test.ts` updated.
- ✅ T7. Verification: Jest set below, `npm run typecheck:bos-llm`, eslint on touched files, `npm run lint:hooks`, `git diff --stat` (no unexpected shrinkage).
- ✅ T8. Requirement S-2 progress line + Change History; this workplan's Implementation Notes.

---

## Test Plan

### New

| File | Asserts |
|---|---|
| `useLinkOpenedDrawer.test.tsx` | Starts closed; row open + close never touches the router; link open + close calls `router.replace` once with only `section` removed (`checkout`, `tab` kept) and `{ scroll: false }`; never `push`; the flag is used once (a later row open + close does not replace); link open while already row-open still marks it (W-3); `onOpenChange(true)` never replaces; `openFromRow` / `openFromLink` identities stable across renders. Source pins: no `router.push(`, no `window.history` |
| `ChangePasswordDrawer.render.test.tsx` (jsdom) | Closed renders nothing; opening shows the title as the dialog name and three fields; typed values and "show" are gone after close and reopen; validation (required, mismatch, short) shows inside the drawer and never calls `changePassword`; calls `changePassword(current, new)`; a server refusal shows the server's message inside the drawer (`role="alert"`) and keeps the typed fields; success shows the success line inside the drawer and clears the fields; **busy**: while the request is pending the submit is disabled, the X is disabled, Escape does not close, and after it settles the drawer closes again; a thrown error is logged with no field value in any logged argument; focus returns to the opener on close |
| `SettingsDrawer.layers.test.tsx` | With `@/components/ui/sheet` replaced by prop-capturing stand-ins: (1) the `onOpenChange` gate alone refuses `false` while busy, passes it when not busy, passes `true` always; (2) `onEscapeKeyDown` alone calls `preventDefault` iff busy; (3) `onInteractOutside` alone the same; (4) the X alone is `disabled` iff busy. Each layer is now caught on its own (SA finding 3 / QA E-1) |

### Edited (C-12)

| File | Edit |
|---|---|
| `settingsDeepLinks.guard.test.ts` | Plan pins move from the page's inline flag / handler to the hook: page plan branch is `openPlanFromLink()` with no `if`; the hook's `openFromLink` sets the flag before opening with no condition; the hook's close handler gates on the flag, clears it, then `router.replace(… { scroll: false })` through `settingsUrlWithoutSection`; page and hook never `router.push(` / `window.history` / write `checkout`. New: the password branch opens the drawer (gated only on `signsInWithProvider`) with a negative control against the old `setExpandedSection(requested)` shape; the password row is a dialog opener; the page holds no `passwordForm`, `showPassword`, `changingPassword`, `changePassword(` (C-7); the provider notice stays inline. Timezone, business / invoice pins unchanged |

### Must stay green

```bash
npx jest components/business-os/settings app/business-os/settings \
  app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts \
  lib/business-os/entitlements/__tests__/planBadge.test.ts \
  lib/business-os/entitlements/__tests__/enforcementPoints.test.ts \
  lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts \
  lib/business-os/__tests__/journeyReadiness.test.ts \
  lib/email/templates/__tests__/invite-accepted.test.ts \
  components/ui/__tests__/darkModeTokens.guard.test.ts \
  lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts \
  lib/business-os/billing/__tests__/planCheckout.test.ts \
  lib/audit/__tests__/passwordChangeSeverity.guard.test.ts
```

The S-1 set plus the change-password severity guard. Then `npm run typecheck:bos-llm`, eslint on the touched files, `npm run lint:hooks`.

---

## Manual QA Checklist (C-10)

Each on **desktop and phone width (≤ 640 px)**, in **English and Hebrew**, with a **password account** unless stated.

| # | Check | Expected |
|---|---|---|
| P1 | Password row | "Change Password" with a chevron; announced as opening a dialog |
| P2 | Click the row | Drawer opens on the same side as the plan drawer; title "Change Password"; three empty fields; URL unchanged |
| P3 | Type in all three, close (X, Escape, overlay), reopen | Fields empty, "Show" reset; focus returned to the password row on close |
| P4 | Mismatch, short (< 8), empty | The message appears **inside the drawer**, not at the top of the page; no request sent (Network) |
| P5 | Wrong current password | The server's message inside the drawer; fields kept so they can be corrected |
| P6 | Correct change | "Password updated successfully!" inside the drawer; fields cleared; signing in with the new password works |
| P7 | Close while the request is in flight (throttle the network) | X greyed and refuses, Escape and overlay refuse; after the answer the drawer closes normally |
| P8 | Enter in a field | Submits the form |
| P9 | `?section=password` | Drawer opens; close → `section` removed via replace, Back does not reopen, reload shows the page closed; other params (`?section=password&tab=x`) keep `tab` |
| P10 | Google-only account (and Google + password) | Inline notice exactly as before, no row, no drawer; `?section=password` shows the page unchanged |
| P11 | Plan drawer regression | Row open / close, `?section=plan` close removes only `section` (S-1 Q2, Q3, Q5, Q6) |
| P12 | `?section=timezone`, `business`, `invoice`, `preferences` | As before |
| P13 | Layering | Drawer and overlay above the page header; browser password-manager popups usable inside the drawer |
| P14 | Hebrew | Fields and messages right-aligned; side matches the plan drawer; record the side observed |

C-10's `Select` popover, `SavedAddressPicker` and invite `<select>` checks have no subject in the password drawer; they stay with S-3 and S-4.

---

## Open Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | After a successful change, should the drawer close itself? | No: the success line is shown inside the drawer (BA §3 row 2, row 10) with the fields cleared; the owner closes it. Closing it automatically would put the confirmation nowhere (the page banner is the alternative, but §3 row 2 moves drawer messages into the drawer) |
| Q-2 | The page's `scrollToSection('password')` had no anchor to land on (no `id="settings-section-password"`). Add one? | No: the drawer is what the link now opens; the provider-only case keeps today's no-op (SA-3 (b): build nothing for an unsent link) |

---

## Implementation Notes

### Files changed

| File | Change |
|---|---|
| `components/business-os/settings/useLinkOpenedDrawer.ts` | new, 75 lines |
| `components/business-os/settings/ChangePasswordDrawer.tsx` | new, 220 lines |
| `components/business-os/settings/__tests__/useLinkOpenedDrawer.test.tsx` | new, 11 tests |
| `components/business-os/settings/__tests__/ChangePasswordDrawer.render.test.tsx` | new, 20 tests |
| `components/business-os/settings/__tests__/SettingsDrawer.layers.test.tsx` | new, 9 tests |
| `app/business-os/settings/page.tsx` | +69 / −166 (password form, its state and handler moved to the drawer; plan drawer onto the hook; router imports dropped) |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | rewritten for the hook and the password branch, 15 → 29 tests |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | S-1 status MERGE PENDING (PR #388), S-2 progress line, two Change History rows |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S1_WORKPLAN.md` | Status MERGE PENDING (PR #388), one Change History row |

`git diff --stat` on tracked files: 4 files, 232 insertions, 209 deletions. The only net shrink is `page.tsx` (−97), and every removed line is accounted for: the password inputs, toggle and submit markup, `handlePasswordChange`, the three password `useState`s, `handlePlanDrawerChange` and the plan flag, which now live in the two new files.

### Deviations from the workplan

| Item | Deviation | Why |
|---|---|---|
| None of substance | The build followed §A to §C | — |
| `cn()` | Not used in `ChangePasswordDrawer` | It has no conditional class; `cn()` of one literal string would be noise |
| Success message | No 3-second auto-hide, unlike the page banner | The success line sits inside the drawer and goes with it on close; a timer on unmounting content adds nothing (Q-1) |
| Effect dependencies | The deep-link effect now lists `openPlanFromLink`, `openPasswordFromLink` (both stable) and `signsInWithProvider` (a boolean) | Needed for the password branch's provider gate; none of them changes after load, so the effect does not re-run on its own |

### Verification results

| Check | Result |
|---|---|
| Jest must-stay-green (the command above: S-1's set + the 3 new suites + `passwordChangeSeverity.guard`) | ✅ 21 suites, 611 tests passed |
| `npm run typecheck:bos-llm` | ✅ 530 files, 28 errors, **0 new**, passed (it also reports one baseline entry fixed in `app/api/onboarding/build/route.ts`, unrelated to this slice) |
| `npx tsc --noEmit -p .` (12 GB heap) | 1,856 errors repo-wide, the same count as S-1's baseline; **0 in any touched or new file** (the only `components/business-os/settings/` hits are the 2 pre-existing ones in `MarketingConsentPanel.tsx`) |
| `eslint` on the 7 touched code and test files | ✅ 0 errors; the same 3 pre-existing warnings S-1 recorded in `page.tsx` (`loadData` dep, unused `withDeadline`, unused `clearSessionKeys`) |
| `npm run lint:hooks` | ✅ exit 0 |
| `npm run test:bos-entitlements` | Not run: nothing in the diff imports from `lib/business-os/entitlements/` (the deep-link guard only reads files) and no catalog or tier change; `tierLiteral.forbidden` and `enforcementPoints` are in the set above and green |
| Mutation spot-checks (backup, mutate, run, restore by copy; SHA-1 identical after) | ✅ 5 / 5 caught: drop the `onOpenChange` busy gate alone (layers test, 1 failed); pass `isBusy={false}` from the password drawer (1 failed); stop clearing the fields on success (1 failed); drop `{ scroll: false }` in the hook (3 failed); stop clearing the link flag (1 failed) |
| T10-style browser walk | Not done by Dev (no browser in this run); QA's P1 to P14 |

### SA S-1 findings taken up

| Finding | Done |
|---|---|
| 2 (extract the link-opened pair when a second drawer arrives) | `useLinkOpenedDrawer`, unit-tested; both drawers use it; the page has no router left. The `greetingUsesTheEditedName` guard's `router.push(` ban still applies to the page and now passes trivially; the replace-only rule for the hook is pinned in the hook's test and in the deep-link guard |
| 3 / QA E-1 (busy layers pinned only together) | `SettingsDrawer.layers.test.tsx` pins each of the four layers alone with a mocked `Sheet`. The mutation "drop only the gate" (S-1's M5, not caught then) is now caught |

## SA Review Notes

## SA Code Review (2026-10-15)

**Reviewed by SA — 2026-10-15** (UI short path: the only SA gate before commit)
**Status:** ✅ Code Approved
**Verdict:** APPROVED. No required changes. Code approved for QA: **Yes**

Diff reviewed: `git diff feature/settings-drawer-s1` (4 tracked files) plus the 5 untracked files, all read in full.

### What was verified

| Item | Result |
|---|---|
| Rule 7 (new pattern) | Not a new pattern needing a separate note. The hook is exactly what SA S-1 finding 2 sanctioned ("extract the link flag + replace on close pair into a small hook in `components/business-os/settings/` with its own unit test" once a second link-opened drawer arrives). It owns only `useState` + one ref + `router.replace`; no provider, no context, no `window.history`. C-5's ban on "a shared hook/provider" is about the S-3 discard guard, not this |
| `page.tsx` removals | Exactly the moved code: `passwordForm` / `showPassword` / `changingPassword` state, `handlePasswordChange`, the inline form markup, `planDrawerOpen` / `planOpenedByLink` / `handlePlanDrawerChange`, `useRouter` / `usePathname`, `settingsUrlWithoutSection`, `changePassword`, `Eye` / `EyeOff` imports. Nothing else removed |
| Moved provider block | `signsInWithProvider`, `signsInWithBoth`, `providerName`, `providerSecurityUrl` and their comment moved above the deep-link effect unchanged (one comment paragraph added explaining why). The `providerNotice` render branch is unchanged |
| Plan drawer (W-3, C-3, C-11) | Behaviour identical through the hook: `openFromLink` sets the flag unconditionally then opens (W-3); close replaces only when link-opened, flag cleared, `settingsUrlWithoutSection` keeps `checkout` / `tab`, `{ scroll: false }`, never `push`. `checkout` untouched. Pinned in both `useLinkOpenedDrawer.test.tsx` and the deep-link guard |
| Reopen on re-render | Not vulnerable. `openFromRow` / `openFromLink` are `useCallback([])` (identity pinned in the hook test); `openConfiguration` is `useCallback([])` in `ConfigurationDialogProvider`; `signsInWithProvider` is a boolean and `user` is loaded before `loading` clears; `loading` only flips inside `loadData`, which runs only on `user?.id` change. So the effect re-runs only on `searchParams` change, and after a link-opened close the `replace` removes `section` before any re-run can see it. Closing a row-opened drawer changes no dependency |
| C-2 | Only the plan / password branches changed; literal `requested === 'plan'` kept; `business` / `invoice`, `timezone` byte-for-byte; `preferences` and unknown values still fall through to a no-op (the old trailing `requested !== 'password'` return is gone, same effect) |
| C-7 | Form state lives only in `ChangePasswordForm` under `SheetContent` (no `forceMount`, pinned); the page holds none of it (pinned). The one log call is `logger.error({ err: error }, …)`; no field reaches any log, message, URL or storage. The render test checks the actual logged arguments for both secrets. Provider notice inline; `?section=password` honoured for password accounts |
| Handler equivalence | Same three checks in the same order with the same keys; same `changePassword(current, new)` call; same `result.error ?? password_error` fallback; same catch path. The audit is server-side in `/api/user/change-password`, untouched, so the audit path is unchanged. Differences, all accepted (see finding 1) |
| C-4 | `isChanging` feeds `isBusy`; behavioural busy test plus the new per-layer test (SA S-1 finding 3 / QA E-1 closed) |
| C-9 / C-13 | `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, Language / Currency / Timezone rows, `id="settings-section-timezone"`, the three guarded option rows and `CRMContactDrawerV2.tsx` untouched. No new option rows |
| C-12 | Edited test (`settingsDeepLinks.guard.test.ts`) is planned in the workplan; the C-12 list stays green |
| Standards | Pino via `createLogger`, 0 `console.*` in touched files; no `any`; no DB access; no entitlements import (no registration needed); i18n keys all pre-existing |

**SA Jest re-run (must-stay-green set as listed above):** 21 suites / 611 tests passed.

### Code Review Comments

1. `ChangePasswordDrawer.tsx` `handlePasswordChange` — not byte-identical to the old handler, and need not be: messages are cleared at the start of every submit (old code cleared only after validation, and validation overwrote anyway); an `if (isChanging) return` guard; `setShowPassword(false)` on success; no 3 s timer; no row collapse. Each is either forced by the move (drawer-local messages, no row) or a safe tightening. Checks, call and server/audit path are unchanged. Accepted. — Priority: Low (informational)
2. `ChangePasswordDrawer.tsx` `if (isChanging) return` reads the prop from the render closure, so two submits fired in the same tick before a re-render (e.g. a very fast double Enter) could both pass it. The disabled submit button covers clicks, the old page had no guard at all, and the worst case is cosmetic (the second request may be refused by the server because the current password has just changed, so an error line replaces the success line; the server still verifies and audits each attempt), so no change is required. If it is ever tightened, a ref is the fix. — Priority: Low (optional)
3. `page.tsx` deep-link effect — the old password branch returned a `clearTimeout` cleanup for its scroll; the new one schedules nothing, so no cleanup is needed. Correct. — Priority: Informational
4. `SettingsDrawer.layers.test.tsx` mocks `@/components/ui/sheet`. That is the right tool to isolate each layer; the behavioural render test still exercises the real Radix sheet, so the mock cannot hide a real-sheet regression on its own. — Priority: Informational

### Rulings on Dev's questions

- **Q-1 (drawer stays open after success, fields cleared): ACCEPTED.** It matches BA §3 rows 2 and 10 (drawer messages live in the drawer), and auto-closing would discard the only confirmation. Clearing the fields and resetting "show" on success satisfies C-7 while the drawer is still open. Dropping the 3 s timer is fine: the message unmounts with the drawer.
- **Q-2 (no `id="settings-section-password"` anchor): ACCEPTED.** The link now opens the drawer, nothing in the repo sends it (SA-3 (b)), and a provider account lands on an unchanged page exactly as before (the old scroll found no anchor either). Do not add one.

### Optimisation Suggestions

- None required. Finding 2's ref is optional.

### Code Approved for QA: Yes

## QA Report (2026-10-15)

**QA — 2026-10-15**
**Test mode:** full at code level. The browser walk was not run.
**Strategy used:** A (Jest unit, jsdom render and source guards) plus mutation testing. D (manual browser) could not run because this session had no browser and no account.
**Focus:** ui, security (C-7 field handling), URL behaviour (C-3)
**Skipped:** D, browser checks P1 to P14 (see the NOT RUN list below)
**Input source:** TL prompt
**Tree under test:** worktree `neuronforge-settings-drawers`, branch `feature/settings-drawer-s2`, with uncommitted S-2 work on top of `96c7400b`

### 1. Must-stay-green Jest set (re-run independently)

QA ran the exact command from [Test Plan](#test-plan): the S-1 set, `useLinkOpenedDrawer`, `ChangePasswordDrawer.render`, `SettingsDrawer.layers` and `passwordChangeSeverity.guard`.

| Result | Count |
|---|---|
| Test suites | ✅ 21 passed / 21 |
| Tests | ✅ 611 passed / 611 |

This matches Dev's and SA's counts. Every C-12 suite passed. `npm run test:bos-entitlements` was not needed: the diff imports nothing from `lib/business-os/entitlements/`.

### 2. Mutation checks (11, none overlapping Dev's 5)

For each mutation: back the file up to the scratchpad, apply the change with a script, run the relevant suites, then restore by copying the backup back. After the run (and again after the session restart), the SHA-1 hashes of `page.tsx`, `ChangePasswordDrawer.tsx`, `useLinkOpenedDrawer.ts` and `SettingsDrawer.tsx` matched the pre-QA baseline, and `git diff --stat` was byte-identical (4 files, +232 / −209).

| # | Mutation | File | Caught? | Failing tests |
|---|---|---|---|---|
| M1 | Password state lifted back into the page (`useState({ current, new, confirm })`) | `page.tsx` | ✅ | 1 (guard, C-7) |
| M2 | Form values survive unmount (module-level store), so closing no longer clears | `ChangePasswordDrawer.tsx` | ✅ | 2 (render, clears on close) |
| M3 | A field value added to the `logger.error` call | `ChangePasswordDrawer.tsx` | ✅ | 2 (runtime log-args check + source pin) |
| M4 | `router.replace` changed to `router.push` in the hook | `useLinkOpenedDrawer.ts` | ✅ | 9 |
| M5 | `openFromLink` marks the flag only when the drawer is not already open (W-3) | `useLinkOpenedDrawer.ts` | ✅ | 2 |
| M6 | `aria-haspopup="dialog"` removed from the password row only | `page.tsx` | ✅ | 1 |
| M7 | `isBusy` wiring dropped (`onChangingChange(true)` removed) | `ChangePasswordDrawer.tsx` | ✅ | 1 (busy test) |
| M8 | Provider gate removed, so `?section=password` opens the drawer for provider accounts | `page.tsx` | ✅ | 1 |
| M9 | Mismatch validation disabled | `ChangePasswordDrawer.tsx` | ✅ | 1 |
| M10 | A server refusal clears the typed fields | `ChangePasswordDrawer.tsx` | ✅ | 1 |
| M11 | A row open marks the drawer as link-opened (closing would rewrite the URL) | `useLinkOpenedDrawer.ts` | ✅ | 3 |

All 11 were caught. Together with Dev's 5, that is 16 of 16.

### 3. Code-level happy path and failure paths

| Acceptance point | Tested? | Result | Evidence |
|---|---|---|---|
| Change succeeds: success line inside the drawer, fields cleared | ✅ | Pass | render test; code: `setPasswordForm(EMPTY_FORM)` and `role="status"` |
| Change goes through `changePassword(current, new)`, never `supabase.auth.updateUser` | ✅ | Pass | render test + source pin |
| Wrong current password: server message inside the drawer (`role="alert"`), fields kept | ✅ | Pass | render test; M10 |
| Refusal with no message falls back to `password_error` | ✅ | Pass | render test |
| Validation (required, mismatch, short) refuses and sends no request | ✅ | Pass | render test; M9 |
| Thrown error logged as `{ err }` only, with no field value | ✅ | Pass | render + source; M3 |
| Closing clears the fields, "show" and messages (C-7) | ✅ | Pass | render test; M2 |
| No password state in `page.tsx` (C-7) | ✅ | Pass | guard; M1 |
| Busy drawer refuses to close (X disabled, Escape and overlay refused) and closes after the answer | ✅ | Pass | render busy test + `SettingsDrawer.layers`; M7 |
| Enter submits | ✅ | Pass | render test |
| `?section=password` opens the drawer; closing removes only `section` with `replace` and no scroll | ✅ | Pass | guard + hook test; M4, M5, M11 |
| Provider-only account: inline notice, no row, no drawer; `?section=password` does nothing | ✅ | Pass | guard; M8. The effect waits for `loading`, which clears only after `loadData` runs with a loaded `user`, so the gate never reads a `null` user |
| Plan drawer still works through the hook (row open, link open, close keeps `checkout` / `tab`) | ✅ | Pass | hook test + guard + PlanSection / PlanPurchase / PlanUpgrade suites |
| `?section=timezone`, `business`, `invoice` unchanged | ✅ | Pass | guard pins with negative controls; those branches are untouched in the diff |
| Opener row has `aria-haspopup="dialog"`; focus returns on close (C-10) | ✅ | Pass (jsdom only) | guard + render focus test; M6. Real-browser focus is P3 |
| Hebrew: RTL and Hebrew title | ⚠️ | Partial | render test only; the visual side and alignment are P14 |

### 4. Manual browser checks P1 to P14: NOT RUN

This session had no browser and no account. A human must run each check on desktop and on phone width (≤ 640 px), in English and in Hebrew, with a password account unless stated otherwise.

| # | Status | What a human must check |
|---|---|---|
| P1 | NOT RUN | The row reads "Change Password" with a chevron, and a screen reader announces that it opens a dialog |
| P2 | NOT RUN | Clicking opens the drawer on the same side as the plan drawer, titled "Change Password", with three empty fields and the URL unchanged |
| P3 | NOT RUN | Type in all three fields, close with X, then Escape, then the overlay, and reopen each time: fields empty, "Show" reset, focus back on the row |
| P4 | NOT RUN | Mismatch, fewer than 8 characters, empty: the message shows inside the drawer, and DevTools Network shows no request |
| P5 | NOT RUN | Wrong current password: the server's message shows inside the drawer and the fields are kept |
| P6 | NOT RUN | Correct change: "Password updated successfully!" inside the drawer, fields cleared; sign out and sign in with the new password |
| P7 | NOT RUN | With the network throttled, submit and then try X, Escape and the overlay: all refuse and X is greyed; the drawer closes normally after the answer |
| P8 | NOT RUN | Pressing Enter in a field submits |
| P9 | NOT RUN | `?section=password` opens the drawer. Closing removes `section`, Back does not reopen it, and a reload shows it closed. `?section=password&tab=x` keeps `tab` |
| P10 | NOT RUN | Google-only and Google + password accounts: inline notice as before, no row, no drawer; `?section=password` shows the page unchanged |
| P11 | NOT RUN | Plan drawer: row open and close; closing after `?section=plan` removes only `section` (S-1 Q2, Q3, Q5, Q6) |
| P12 | NOT RUN | `?section=timezone`, `business`, `invoice` and `preferences` behave as before |
| P13 | NOT RUN | The drawer and overlay sit above the page header, and browser password-manager popups work inside the drawer |
| P14 | NOT RUN | Hebrew: fields and messages are right-aligned and the side matches the plan drawer; record the side observed |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None.

#### Edge Cases / Notes (no fix required for S-2)

1. **A provider-only account on `?section=password` keeps `section` in the address.** Nothing opens, so nothing removes it. This is the same as before S-2, and nothing in the repo sends that link (SA-3 (b)). Low, informational.
2. **The double-submit guard reads the prop from the render closure** (SA finding 2). QA agrees with SA: it is optional, and the effect would only be cosmetic.
3. **Some browser behaviour is only covered in jsdom:** focus return, Radix overlay click, password-manager popups and the RTL side. Checks P3, P7, P13 and P14 cover these.

### Final Status

- [x] All code-level acceptance points pass (611 / 611 Jest tests, 11 / 11 mutations caught) and no bugs were found
- [ ] Manual browser checks P1 to P14 are NOT RUN: a human must walk them

**Verdict: PASS WITH NOTES.** The happy path and every failure path are tested at code level and confirmed by mutation testing. The notes are the browser walk (P1 to P14), which has not been done, and two low informational edge cases.

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | Dev workplan for S-2 (UI short path), verified against `page.tsx` at `d6078f8b`. Password form into `ChangePasswordDrawer` (C-7); the link-opened pair extracted into `useLinkOpenedDrawer` (SA S-1 finding 2); busy layers pinned one by one (finding 3); two questions for SA |
| 2026-10-15 | Code complete | T0 to T8 done. Must-stay-green 21 suites / 611 tests green; `typecheck:bos-llm` 0 new; full `tsc` 0 errors in touched files; eslint 0 errors (3 pre-existing warnings); `lint:hooks` clean; 5 mutation spot-checks all caught. Uncommitted, awaiting SA code review and QA |
| 2026-10-15 | SA code review | APPROVED, code approved for QA, no required changes. Hook is within SA S-1 finding 2 (no separate rule-7 note); not vulnerable to reopen on re-render; plan drawer W-3 / C-3 / C-11 behaviour preserved; C-2, C-4, C-7, C-9, C-12, C-13 verified; handler equivalent (checks, call, server audit path). Q-1 and Q-2 accepted. 4 Low / informational findings. SA Jest re-run: 21 suites / 611 tests green |
| 2026-10-15 | QA | PASS WITH NOTES. Must-stay-green re-run 21 suites / 611 tests green; 11 further mutations all caught (SHA-1 and diff stat unchanged after restore); code-level happy and failure paths pass; no bugs; browser checks P1 to P14 NOT RUN (no browser / account) |
