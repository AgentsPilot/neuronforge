# Workplan: Business OS Settings Drawer, S-1 (Wrapper + Plan drawer pilot)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §1.3, §3 row 7, §4, §5 S-1, SA conditions C-1 to C-12 (C-3, C-8, C-12 as amended in "Re-sequencing (2026-10-14): UI first")
**Branch:** `feature/settings-drawer-s1` (created by RM from `origin/main` `d05eb0a4`)
**Path:** Full cycle (new shared component, rule 7)
**Date:** 2026-10-14
**Status:** Code Complete 2026-10-15 (uncommitted), W-1 to W-8 applied. Awaiting SA code review, then QA. SA workplan review 2026-10-14: APPROVED WITH CONDITIONS (W-1 to W-8)

## Overview

S-1 adds one small settings-only drawer component (`SettingsDrawer`) on the existing `components/ui/sheet.tsx`, using `MoneyDetailDrawer`'s shell classes, and uses it for the first function: **Your plan**. The plan row on the settings page stops expanding in place and opens the plan drawer instead. `?section=plan` (the plan pill and the plan checkout return) opens the drawer, and closing a link-opened drawer removes only `section` from the address with `router.replace`. Nothing else on the page changes. No API, database, repository or translation change.

**Code verified against:** `app/business-os/settings/page.tsx` at commit `f7301fad` (last commit touching the file, DE-0a). Worktree base `d05eb0a4`; `origin/main` re-checked at `7a63446a`, no change to any file this slice touches. All locations below are by **symbol or anchor** (C-13), not line number.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Resolution of the C-3 / C-12 router conflict](#resolution-of-the-c-3--c-12-router-conflict)
4. [Plan-payments state (C-11)](#plan-payments-state-c-11)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Task List](#task-list)
7. [Test Plan](#test-plan)
8. [Manual QA Checklist (C-10)](#manual-qa-checklist-c-10)
9. [Risks](#risks)
10. [Open Questions for SA](#open-questions-for-sa)
11. [Condition Traceability](#condition-traceability)
12. [SA Review Notes](#sa-review-notes)
13. [Implementation Notes](#implementation-notes-dev-2026-10-15)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## Analysis Summary

| Area | As found on `f7301fad` |
|---|---|
| Plan row | `<div id="settings-section-plan">` in the right-column account card: a `<button>` toggling `setExpandedSection('plan')`, `CreditCard` icon, `t('plan.section_title')`, a rotating `ChevronRight`; when expanded renders `<PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} />` |
| Deep-link effect | The `useEffect` on `[searchParams, loading, openConfiguration]` that reads `searchParams.get('section')`: `business`/`invoice` → `openConfiguration`; `timezone` → `scrollToSection('timezone')`; then `if (requested !== 'password' && requested !== 'plan') return;` → `setExpandedSection(requested)` + `scrollToSection(requested)` |
| Router | `page.tsx` imports only `useSearchParams` from `next/navigation`. A header comment says `useRouter` left with the back button |
| `PlanSection` | Fetches `/api/business-os/entitlements/my-plan` on mount (and on language change). Contains `PlanPurchase` (P-4.2, Stripe embedded checkout) and `PlanUpgrade` (P-7b.1b). Uses `createLogger`; 0 `console.*` |
| `PlanPurchase` | On Stripe `onComplete` calls `router.replace('/business-os/settings?section=plan&checkout=<id>', { scroll: false })` (`settingsPlanReturnPath`) |
| `PlanSection` "taking longer" link | `<a href={SETTINGS_PLAN_PATH}>` = `/business-os/settings?section=plan` (full navigation, reopens the drawer by link) |
| Senders of `?section=plan` | `PLAN_SECTION_HREF` (`planBadge.ts`, the pill), `planCheckout.ts` `settings_plan` return, `planPurchaseCopy.ts` `SETTINGS_PLAN_PATH` / `settingsPlanReturnPath` |
| Shell reference | `MoneyDetailDrawer.tsx`: `Sheet` + `SheetContent side={isRTL ? 'left' : 'right'}`, `dir`, `w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden`, fixed header with own X, scroll body `flex-1 overflow-y-auto p-6 space-y-3`. Takes `t` and `isRTL` as **props** |
| Focus-return precedent | `BoostPackagesPanel.tsx`: same `Sheet`, `onCloseAutoFocus` → `returnFocusRef.current.focus()`. It also already hosts a Stripe `EmbeddedCheckout` inside a Sheet |
| i18n | `useLanguage().t(key)`, dictionaries in `lib/business-os/translations/{en,es,he}.ts`. Keys needed: `plan.section_title` and `common.close`, both present in all three. **No new keys** |
| Logging | `page.tsx` and `PlanSection.tsx`: Pino via `createLogger`, 0 `console.*`. The new wrapper has nothing to log (like `sheet.tsx`), so it has no logger |
| Data access | None added. S-1 does not touch `loadData`, `persistTimezone`, `saveProfile`, the export handler (now `downloadUserDataExport`, DE-0a) or any row in the left column (C-9, SA-4) |

---

## Implementation Approach

### A. `SettingsDrawer` (new, `components/business-os/settings/SettingsDrawer.tsx`)

A `'use client'` presentational component. **Props only**: it reads no context, creates no context or provider, and imports nothing from `lib/business-os/entitlements/` (type-only included) (C-1).

```typescript
interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional key-facts line under the title; rendered as SheetDescription. */
  meta?: React.ReactNode;
  /** While true the drawer refuses to close (C-4). */
  isBusy?: boolean;
  /** Side and direction; passed in, as MoneyDetailDrawer does, so the wrapper reads no context. */
  isRTL: boolean;
  /** Accessible name of the X, already translated by the caller. */
  closeLabel: string;
  /** Where focus goes on close; covers the link-opened case where nothing was focused before. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  testId?: string;
  children: React.ReactNode;
}
```

Shell, class for class with `MoneyDetailDrawer`:

| Part | Implementation |
|---|---|
| Root | `<Sheet open={open} onOpenChange={handleOpenChange}>` |
| Content | `SheetContent side={isRTL ? 'left' : 'right'} dir={isRTL ? 'rtl' : 'ltr'} data-side=…` with `cn('w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden')`. `aria-describedby={undefined}` when there is no `meta`, so Radix does not warn about a missing description |
| Header (fixed) | `flex-shrink-0 border-b border-[var(--v2-border)] p-6`; `SheetTitle` (`text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start`); optional `SheetDescription` meta line (`text-xs text-[var(--v2-text-muted)]`); own close `<button type="button">` with `X` icon, `aria-label={closeLabel}`, Money drawer's classes |
| Body | One scroll area: `scrollbar-thin flex-1 overflow-y-auto p-6 space-y-3`, `aria-busy={isBusy || undefined}` |
| Focus return | `onCloseAutoFocus`: if `returnFocusRef?.current`, `preventDefault()` and focus it (BoostPackagesPanel's pattern). Otherwise Radix's default return to the previously focused element |

**Busy refusal (C-4), exactly as SA-2 ruled:**

- `handleOpenChange(next)`: when `next === false && isBusy`, ignore; otherwise forward to `onOpenChange`.
- `onEscapeKeyDown` and `onInteractOutside`: `event.preventDefault()` while `isBusy`.
- Own X: `disabled={isBusy}` and routed through `handleOpenChange(false)`.

**Deliberately not in S-1** (designed, built in the slice that first needs it, so S-1 ships no dead code):

- `isDirty` and the discard dialog: S-3 (C-5). Design: same `handleOpenChange` gate; when `isDirty`, a `components/ui/dialog` confirmation rendered inside the `SheetContent` tree; Escape / outside / X route through it.
- Fixed footer slot: S-3. Design: reuse the existing `TabFooterSlot` + `TabFooterSlotProvider` from `TabFooter.tsx`, with the slot rendered as a sibling **after** the scroll body, so `TabFooter` portals into it unchanged. See Q-3 for whether SA counts that existing provider against C-1.

### B. Page changes (`app/business-os/settings/page.tsx`)

Only the plan row, the plan/password branch of the deep-link effect, and the router import. Everything else is byte-for-byte.

1. **Imports.** `useRouter`, `usePathname` added to the existing `next/navigation` import; `useRef` added to the React import; `SettingsDrawer` imported. The header comment about `useRouter` is rewritten to say the router is used for `replace` only (URL cleanup), never `push`.
2. **State.** `const [planDrawerOpen, setPlanDrawerOpen] = useState(false);`, `const planOpenedByLink = useRef(false);`, `const planRowRef = useRef<HTMLButtonElement>(null);`. `expandedSection` stays (consent and password still use it until S-2 / S-3).
3. **Deep-link effect, plan and password branch only (C-2).** The `business`/`invoice`, `timezone` and `preferences` handling and their comments stay byte-for-byte. The final block becomes:

   ```typescript
   if (requested === 'plan') {
     // Opened by the link: closing must take `section` back off the address (C-3).
     planOpenedByLink.current = true;
     setPlanDrawerOpen(true);
     return;
   }

   if (requested !== 'password') return;

   setExpandedSection(requested);
   const timer = scrollToSection(requested);
   return () => clearTimeout(timer);
   ```

   `requested === 'plan'` is a literal, so `planBadge.test.ts` stays green with no edit. Password behaviour is unchanged (S-2 owns it). The existing comment block above the branch is updated for the plan wording only.

4. **Closing (C-3, C-11).** One handler:

   ```typescript
   const handlePlanDrawerChange = (next: boolean) => {
     setPlanDrawerOpen(next);
     if (next || !planOpenedByLink.current) return;
     planOpenedByLink.current = false;
     router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false });
   };
   ```

   `settingsUrlWithoutSection` is a new pure helper (below) that deletes **only** `section`; `checkout`, `tab` and any other parameter survive. The page never reads, sets or deletes `checkout` itself; it only keeps passing it to `PlanSection` as today. Opening from the row never writes the URL. After the replace the effect re-runs, finds no `section`, and does nothing.

   **Checkout completed inside a row-opened drawer:** `PlanPurchase` itself replaces the URL with `?section=plan&checkout=…`. The effect sees `section=plan` and marks the drawer link-opened, so closing it later removes `section` and a reload does not reopen the drawer (Q-6 (a)), while `checkout` stays. This is the C-3 rule applied to the URL as it stands, recorded here for SA (Q-2).

5. **Plan row (C-8, C-10).** The `id="settings-section-plan"` wrapper stays. The button gets `ref={planRowRef}`, `type="button"`, `aria-haspopup="dialog"`, `aria-expanded={planDrawerOpen}`, `onClick={() => setPlanDrawerOpen(true)}`. It shows the **title only**, as today, with a static `ChevronRight` (no rotation; RTL mirroring per the existing rows, unchanged). The row's class string is unchanged and is **not** the guarded dropdown-row string, so `darkModeTokens.guard.test.ts` still counts exactly three (C-9).
6. **Drawer.** Rendered next to the row:

   ```tsx
   <SettingsDrawer
     open={planDrawerOpen}
     onOpenChange={handlePlanDrawerChange}
     title={t('plan.section_title')}
     isRTL={isRTL}
     closeLabel={t('common.close')}
     returnFocusRef={planRowRef}
     testId="settings-plan-drawer"
   >
     <PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} />
   </SettingsDrawer>
   ```

   `PlanSection` mounts only while the drawer is open (no `forceMount`), so the plan is fetched on open (C-8). No `isBusy` for the plan drawer in S-1: `PlanSection` exposes no in-flight state today, and collapsing the row already unmounts it mid-checkout. See Q-1.

### C. URL helper (new, `components/business-os/settings/settingsSectionUrl.ts`)

```typescript
/** The current settings URL with only `section` removed (C-3). Every other parameter survives. */
export function settingsUrlWithoutSection(pathname: string, params: URLSearchParams | ReadonlyURLSearchParams | null): string
```

Pure, no imports beyond types, so it is unit-tested directly. Copies the params, `delete('section')`, returns `pathname` alone when nothing is left, otherwise `pathname?rest`. It never touches `checkout`.

---

## Resolution of the C-3 / C-12 router conflict

`greetingUsesTheEditedName.guard.test.ts`, describe "the settings header", test "dropped the router it existed for", bans any `useRouter` in `page.tsx`. C-3 needs `router.replace`. **Chosen: SA's preferred option**, an edit to that test in S-1:

| Assertion | Before | After |
|---|---|---|
| `not.toContain('ArrowLeft')` | kept | kept, unchanged |
| `not.toContain("router.push('/business-os')")` | kept | kept, unchanged |
| `not.toContain('const router = useRouter()')` | present | **removed** |
| `not.toContain('useRouter')` | present | **removed** |
| new | — | `expect(settings).not.toMatch(/router\.push\(/)`: the page never pushes a route (comments already stripped by `codeOf`) |
| ~~new~~ | — | ~~positive `router.replace` pin~~: **not added here** (SA W-1 / O-1). The planned regex was wrong; the corrected pin `/router\.replace\([\s\S]*?,\s*\{\s*scroll:\s*false\s*\}\s*\)/` lives only in `settingsDeepLinks.guard.test.ts`, which owns the behaviour |

The test is renamed "uses the router only to replace, never to push" and its comment says why (C-3: the address cleanup must not add a Back entry). The "Settings writes the profile row" test and every My Day assertion are untouched (D-2 owns that rewrite, C-18). The alternative (cleanup outside `page.tsx`) is not used: it would move the decision about which parameter to drop away from the effect that set it.

---

## Plan-payments state (C-11)

Recorded as BA §4.7 and C-11 ask, checked 2026-10-14:

| Item | State on `main` | Effect on S-1 |
|---|---|---|
| P-4.2 "buy a plan in Settings → Plan" (`2ac84086`) | Merged. `PlanSection` → `PlanPurchase` → shared `PlanEmbeddedCheckout` (Stripe `EmbeddedCheckout`) | Moving `PlanSection` into the drawer puts the existing checkout iframe inside the sheet's focus trap. See Q-1 |
| P-7b.1b "upgrade to Autopilot in Settings → Plan" (`92cb568f`) | Merged. `PlanUpgrade` inline confirm, no nested dialog | Renders inside the drawer unchanged |
| P-5b.1 / P-5b.2 / P-9.1 / P-9.2 | Merged (#359, #363, #382 …) | Do not touch the settings files |
| Open PRs touching `page.tsx`, `components/business-os/settings/`, `planBadge`, the greeting guard | None (`gh pr list`, 2026-10-14) | No collision |
| Return path | `planCheckout.ts` `settings_plan` and `settingsPlanReturnPath` both `…?section=plan[&checkout=…]` | Opens the drawer after S-1 (C-11). `checkout` is left in place and only passed through to `PlanSection` as today |

Precedent for a Stripe embedded checkout inside this `Sheet`: `BoostPackagesPanel.tsx` (top-up), already shipped.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/SettingsDrawer.tsx` | create | The shared settings-only wrapper (C-1, C-4) |
| `components/business-os/settings/settingsSectionUrl.ts` | create | Pure `section`-only URL cleanup (C-3, C-11) |
| `components/business-os/settings/__tests__/SettingsDrawer.render.test.tsx` | create | Wrapper behaviour + source guard |
| `components/business-os/settings/__tests__/settingsSectionUrl.test.ts` | create | Helper unit test |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | create | C-2 timezone guard, plan-branch and URL-cleanup pins |
| `app/business-os/settings/page.tsx` | modify | Plan row → drawer opener; plan/password branch; router import; header comment |
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | modify | C-3 / C-12 conflict, as above |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | Record the S-1 workplan, SA ruling, PR and merge (standing rule) |

**Not modified (C-9, C-12):** `PlanSection.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `planPurchaseCopy.ts`, `TabFooter.tsx`, `components/ui/sheet.tsx`, `MoneyDetailDrawer.tsx`, `CRMContactDrawerV2.tsx`, `InviteFriendsSection.tsx`, `MarketingConsentPanel.tsx`, translations, `planBadge.test.ts`, `darkModeTokens.guard.test.ts`, any API route or repository. In `page.tsx`: `loadData`, `persistTimezone`, `saveProfile`, the export handler, the profile card, the Language / Currency / Timezone rows (including `id="settings-section-timezone"` and the three guarded option rows), the consent and password rows, Log out, Delete and both dialogs.

---

## Task List

- ✅ T1. Create `settingsSectionUrl.ts` and its unit test.
- ✅ T2. Create `SettingsDrawer.tsx` (shell, busy refusal, focus return, no context, no entitlements import, no logger).
- ✅ T3. Create `SettingsDrawer.render.test.tsx`.
- ✅ T4. `page.tsx`: imports, header comment, `planDrawerOpen` / `planOpenedByLink` / `planRowRef`, `router` + `pathname`.
- ✅ T5. `page.tsx`: plan/password branch of the deep-link effect (plan → drawer; password unchanged in behaviour).
- ✅ T6. `page.tsx`: plan row as opener (`aria-haspopup="dialog"`, title only) and the `SettingsDrawer` around `PlanSection`; `handlePlanDrawerChange` with link-only `router.replace`.
- ✅ T7. Edit `greetingUsesTheEditedName.guard.test.ts` (router assertions only).
- ✅ T8. Create `settingsDeepLinks.guard.test.ts` (C-2 timezone guard with negative control).
- ✅ T9. Run the test set below, `npx tsc --noEmit`, `npm run lint`, `npm run lint:hooks`; `git diff --stat` check (no deletion-only diff). Results in [Implementation Notes](#implementation-notes-dev-2026-10-15).
- ⬜ T10. Local manual smoke (row open/close, `?section=plan`, `?section=plan&checkout=x&tab=y` close, `?section=timezone`, Hebrew). **Not done by Dev:** this run had no browser. Behaviour is covered by the render test and the source guards; the browser walk is QA's Q1 to Q13.
- ✅ T11. Update the requirement MD (S-1 progress line under the header, two Change History rows) — everything left uncommitted for the user's diff review. The W-2 (d) go-live row is **conditional on QA's result** and is not added yet.

---

## Test Plan

### New tests

| File | Asserts |
|---|---|
| `settingsSectionUrl.test.ts` | Removes `section` only; keeps `checkout` and `tab` and their order; `?section=plan` alone → bare pathname; no `section` → unchanged; encoded values survive; never adds or drops `checkout` |
| `SettingsDrawer.render.test.tsx` (jsdom) | Closed renders nothing; open renders title (as dialog name) and children; `isRTL` → `data-side="left"` and `dir="rtl"`, otherwise right / ltr; own X has `closeLabel` and calls `onOpenChange(false)`; Escape calls `onOpenChange(false)`; **busy**: Escape and X do not call it, X is disabled, outside pointer-down does not call it; focus returns to `returnFocusRef` on close; meta renders as description when given. **Source guard** (comment-stripped): no import from `@/lib/business-os/entitlements`, no `createContext`, no `useContext`, no `Provider`, no `console.`, no `forceMount`, contains `[&>button]:hidden` and `sm:max-w-xl` |
| `settingsDeepLinks.guard.test.ts` | *(As built, per W-1, W-3, W-6: positive pins on comment-stripped source; three negative controls for the timezone matcher: anchor without branch, scroll in another block, branch only in a comment; W-3 link flag set before `setPlanDrawerOpen(true)` with no `if` in the branch; the corrected `router.replace` pin inside `handlePlanDrawerChange`, after the link-only gate.)* **C-2:** `page.tsx` contains `id="settings-section-timezone"` and matches `requested === 'timezone'` followed by `scrollToSection('timezone')` within the same branch; negative control: the same matcher fails on a snippet without the branch. Also: `business`/`invoice` → `openConfiguration(requested)` still present; the plan branch sets the drawer and **no** `setExpandedSection('plan')` / `expandedSection === 'plan'` remains; the plan row carries `aria-haspopup="dialog"`; cleanup uses `settingsUrlWithoutSection` and `router.replace(… { scroll: false })`; the page never writes `checkout` (no `.set('checkout'`, no `.delete('checkout'`); no `window.history` |

### Edited tests (C-12)

| File | Edit |
|---|---|
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | Router test only, as in [the resolution](#resolution-of-the-c-3--c-12-router-conflict). No other edit |

No other test is edited. `planBadge.test.ts` stays as is because the literal `requested === 'plan'` is kept.

### Must stay green (run before handing over)

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
  lib/business-os/billing/__tests__/planCheckout.test.ts
```

Covers the seven C-12 tests (`PlanSection.render`, `InviteFriendsSection.render`, `journeyReadiness`, `planBadge`, `invite-accepted`, `greetingUsesTheEditedName`, `darkModeTokens`) plus `PlanPurchase.render`, `PlanUpgrade.render`, the export guard that scans `page.tsx`, and `enforcementPoints` (UI files must not import the entitlements module). Then `npx tsc --noEmit`, `npm run lint`, `npm run lint:hooks`. `npm run test:bos-entitlements` is not required (nothing imports from `lib/business-os/entitlements/`), but is run once as a check because the slice sits next to plan code.

---

## Manual QA Checklist (C-10)

Each on **desktop and phone width (≤ 640 px)**, in **English and Hebrew**. Hebrew (SA W-8): the drawer opens on **the same side, and slides the same way, as the Money detail drawer and the Top up panel** in Hebrew (`sheet.tsx` uses logical insets, so `side="left"` likely resolves to the physical right under `dir="rtl"`); **record the side observed**. Header X at the far end, text right-aligned. S-1 does not change `sheet.tsx`.

| # | Check | Expected |
|---|---|---|
| Q1 | Plan row | Shows "Your plan" title only with a chevron; screen reader announces it opens a dialog (`aria-haspopup="dialog"`) |
| Q2 | Click the row | Drawer opens from the reading end; full width on phone, about 576 px on desktop; fixed header with title and X; body scrolls on its own; URL unchanged |
| Q3 | Close by X, Escape, overlay | Drawer closes; **focus returns to the plan row**; URL unchanged |
| Q4 | Plan loads on open | Network shows `my-plan` only after opening (not on page load); loading line then plan contents |
| Q5 | `?section=plan` (plan pill in the header) | Page loads, drawer opens; close → address becomes `/business-os/settings` via replace; **Back does not reopen it**; reload shows the page with the drawer closed; focus lands on the plan row |
| Q6 | `?section=plan&checkout=cs_test_x&tab=foo` | Drawer opens, plan shows "Payment processing" as today; close → `?checkout=cs_test_x&tab=foo` (only `section` gone) |
| Q7 | Choose a plan in the drawer (test Stripe), complete checkout, **with `4242 4242 4242 4242` and with the 3-D Secure card `4000 0027 6000 3184`**, on desktop and phone width (SA W-2 (a)) | Embedded checkout works inside the drawer (typing, card fields); for the 3-D Secure card the challenge can be clicked and typed into, focus is not pulled back into the sheet, the drawer stays open; address becomes `?section=plan&checkout=…`; "processing" then "You're on …"; closing removes only `section`. **Record each card × width as pass / fail / not run** |
| Q8 | Upgrade in the sandbox on a paying `basic` test owner (P-7b.1 demo (3) setup) with Stripe's "always requires authentication" card, if available (SA W-2 (b)) | Inline confirm works inside the drawer; the 3-D Secure challenge is usable as in Q7, and abandoning it leaves the drawer usable. **Record pass / fail / not run** |
| Q7/Q8 gate | W-2 (c), (d) | If Q7's 3-D Secure result or Q8 is **fail or not run**, Dev adds to `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5: "3-D Secure (checkout and upgrade) verified inside the Settings plan drawer". Neither payment switch goes on in production until it is ticked. Both switches are off in production today |
| Q9 | Layering | Drawer and overlay above the page header; nothing from the page shows through; any popover or toast that appears is above the overlay |
| Q10 | `?section=timezone` (publish gate "Set your timezone") | Scrolls to the Timezone row exactly as before; no drawer opens |
| Q11 | `?section=business`, `?section=invoice`, `?section=preferences`, `?section=password` | Configuration window / nothing / password row expands, all as before |
| Q12 | Unchanged rows | Language, Currency, Timezone, profile card, Invite friends, Marketing permission, Password, Export, Log out, Delete behave as before |
| Q13 | Hebrew switch while the drawer is open | Plan names re-read (existing behaviour) and nothing breaks; after closing and reopening the side matches the language |

C-10's `Select` popover, `SavedAddressPicker` and invite native `<select>` checks have no subject in the Plan drawer; they are carried in the checklist for S-3 and S-4.

---

## Risks

| Risk | Mitigation |
|---|---|
| Stripe embedded checkout inside the sheet's focus trap (C-11) | Same pattern already ships in `BoostPackagesPanel`; Q7 tests it live; SA to rule (Q-1) |
| Closing the drawer mid-checkout or mid-upgrade unmounts the in-page state | Same as collapsing the row today; the URL marker restores "processing" on reopen. Busy refusal for the plan drawer is Q-1 |
| Effect re-runs after `router.replace` and reopens the drawer | The replaced URL has no `section`, so the plan branch is not reached; covered by Q5 |
| Row-opened drawer becomes "link-opened" after `PlanPurchase` writes `?section=plan` | Intended (Q-6 (a)): close then removes `section`; Q-2 asks SA to confirm |
| Radix "missing Description" warning in dev / tests | `aria-describedby={undefined}` when there is no meta |
| Guard tests pinning `page.tsx` text break | Every pin was read; only the router test changes, listed under C-12 |
| Two PRs editing `page.tsx` | None open today; DE-0a merged; rebase rule in C-24 applies |

---

## Open Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | C-11 says putting the Stripe embedded checkout inside the sheet's focus trap is a plan-payments decision needing SA. It is unavoidable in S-1: `PlanSection` already contains `PlanPurchase` (P-4.2). Is S-1 cleared to host it, and should the plan drawer pass `isBusy` while a checkout or upgrade is in flight? | Clear it on the `BoostPackagesPanel` precedent; **no `isBusy`** for the plan drawer in S-1 (`PlanSection` exposes no busy state and changing it is plan-payments scope; behaviour equals today's collapse). If SA wants it, a plan-payments follow-up adds an `onBusyChange` to `PlanSection` |
| Q-2 | "Opened by the link" when `PlanPurchase` itself writes `?section=plan&checkout=…` into a row-opened drawer | Treat it as link-opened (the URL now carries `section`), so close removes `section` and keeps `checkout` |
| Q-3 | C-1 lists the props as `open`, `onOpenChange`, `title`, meta, `isBusy`, `isDirty`. S-1 adds `isRTL`, `closeLabel`, `returnFocusRef`, `children`, `testId` so the wrapper reads no context (as `MoneyDetailDrawer` takes `isRTL` and `t`). And for S-3: does wrapping the body in the **existing** `TabFooterSlotProvider` count as a "provider" under C-1? | Accept the extra props; defer `isDirty` and the footer slot to S-3, where they are first used, and rule on the provider question then |
| Q-4 | The `id="settings-section-plan"` anchor no longer has a scroll target in the code | Keep it on the row wrapper (no sender found, but harmless and S-5 re-checks every link) |

---

## Condition Traceability

| Condition | Where met |
|---|---|
| C-1 wrapper scope | §A; source guard in `SettingsDrawer.render.test.tsx`; Q-3 |
| C-2 deep-link handler | §B.3; `settingsDeepLinks.guard.test.ts` |
| C-3 URL cleanup | §B.4, §C; helper test; guard test; QA Q5, Q6 |
| C-4 busy refusal | §A; render test |
| C-5 discard guard | S-3; design noted only |
| C-8 row values | §B.5 title only; §B.6 fetch on open; QA Q4 |
| C-9 untouchables | Files not modified list; QA Q12 |
| C-10 QA layering | Manual QA checklist |
| C-11 plan payments | Plan-payments state; §B.4; Q-1; QA Q6, Q7 |
| C-12 test edits | Edited tests table; must-stay-green list |
| C-13 locate by symbol, record commit | Header (`f7301fad`); all references by symbol |

---

## SA Review Notes

See [SA Workplan Review (2026-10-14)](#sa-workplan-review-2026-10-14) below.

## SA Workplan Review (2026-10-14)

**Reviewed by:** SA, against the worktree at `d05eb0a4`. Diff to `origin/main` `7a63446a` is empty for every path this slice touches. `page.tsx` was last changed in `f7301fad`.
**Verdict:** **APPROVED WITH CONDITIONS.** The approach is right: the wrapper on `Sheet` with `MoneyDetailDrawer`'s shell, props only, the plan branch as a literal, and replace-only cleanup of `section`. Apply W-1, W-6 and W-7 before or while implementing. W-2 adds a QA step and a recorded go-live gate, and it does not block S-1 from merging. Everything else is a ruling or a low-priority item.

### Verified against the code

| Claim in the workplan | Result |
|---|---|
| Plan row, deep-link effect, `useSearchParams`-only import, header comment about `useRouter` (`page.tsx`) | ✅ As described |
| `MoneyDetailDrawer` shell classes, own X, fixed header, `scrollbar-thin flex-1 overflow-y-auto p-6 space-y-3` body, `t`/`isRTL` as props | ✅ Class for class. (Money has no `data-side`; adding it is harmless) |
| `BoostPackagesPanel` = same `Sheet`/`SheetContent` from `components/ui/sheet.tsx`, `onCloseAutoFocus` → `returnFocusRef`, Stripe `EmbeddedCheckoutProvider` + `EmbeddedCheckout` rendered **inside** the `SheetContent` tree, no busy refusal | ✅ Same primitive, same Stripe component, same tree position. One difference: Boost widens to `sm:max-w-2xl` while the checkout shows, and the Plan drawer stays `sm:max-w-xl` (C-1). QA Q7 checks the layout |
| `PlanPurchase` `onComplete` → `router.replace(settingsPlanReturnPath(id), { scroll: false })` | ✅ |
| `PlanUpgrade` | ⚠️ **Not mentioned in Q-1.** It runs 3-D Secure with Stripe.js `stripe.handleNextAction({ clientSecret })` (phase `authenticating`). That is not the embedded checkout, so the Boost precedent does not cover it. See W-2 |
| `plan.section_title`, `common.close` in en/es/he | ✅ Present in all three |
| Tests that read `page.tsx` source | ✅ `planBadge.test.ts` (raw source, literal kept), `greetingUsesTheEditedName`, `darkModeTokens`, `pluginConnectionsBrowserAccess`. No test pins `settings-section-plan` or `expandedSection` |
| Payment switches | `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` / `BUSINESS_OS_PLAN_PRICES_ENABLED` default `false` (`planCheckoutFlag.ts`, `planPricesFlag.ts`), off in production, so Choose and Upgrade do not render live today |

### C-3 / C-12 resolution (greeting guard)

This matches the ruling. `ArrowLeft` and `router.push('/business-os')` are kept, only the blanket `useRouter` ban goes (both of its assertions), and `not.toMatch(/router\.push\(/)` is added on comment-stripped source. The extra positive `router.replace` pin is allowed, but its regex is wrong. See W-1.

### Rulings on the open questions

| # | Ruling |
|---|---|
| **Q-1** | **Embedded checkout (`PlanPurchase`) inside the drawer: cleared.** The Boost precedent is verified to be the same `Sheet` and the same `EmbeddedCheckout` in the same tree position. Its iframe sits inside the focus scope, so Radix neither steals focus from it nor dismisses on it. **No `isBusy` for the Plan drawer in S-1: accepted.** Closing mid-checkout matches today's collapse. The Stripe session and the checkout lock expire or are replaced as P-4.1 built, and `my-plan` is the only source of the shown plan. **Not cleared on that precedent: `PlanUpgrade`'s 3-D Secure.** `handleNextAction` shows Stripe's challenge outside the sheet's React tree. That is a known problem class with modal Radix layers: body `pointer-events: none`, the focus trap pulling focus back out of the challenge frame, and a focus-outside dismissal closing the drawer mid-authentication. Nobody has tested this here, Boost included (its 3-D Secure check is still on the user's go-live list). It is handled by **W-2**. It does not block S-1, because both switches are off in production |
| **Q-2** | **Accepted as proposed.** The C-3 rule keys on the URL as it stands. Once `PlanPurchase` has written `section=plan`, a reload would reopen the drawer (against Q-6 (a)) unless closing removes it. So the drawer counts as link-opened from then on. Closing leaves `?checkout=…` only, and the page ignores it until the drawer is reopened, where `PlanSection` shows it display-only as today. The plan branch must set `planOpenedByLink.current = true` **unconditionally**, even when the drawer is already open (as written). Do not guard it with `if (!planDrawerOpen)` |
| **Q-3** | **Extra props accepted** (`isRTL`, `closeLabel`, `returnFocusRef`, `children`, `testId`). They are what keeps the wrapper context-free, and they mirror `MoneyDetailDrawer` and `BoostPackagesPanel`. C-1's list named the behavioural props, not an exhaustive signature. **`TabFooterSlotProvider` (ruled now, so S-3 need not come back):** rendering the **existing** `TabFooterSlotProvider` around the drawer body does **not** count as a provider under C-1. C-1 forbids the wrapper from **defining** shared context or state (open, dirty or page-level state, or a `ConfigurationDialogProvider`-style opener). The slot provider holds only a DOM node for a portal, is scoped to the drawer subtree, and is exactly the "reused, not copied" `TabFooter` that C-1 asks for. When S-3 adds it, S-3 narrows this slice's source guard to allow exactly that one import from `./TabFooter`. `createContext` stays banned. `isDirty` and the footer slot are deferred to S-3: agreed |
| **Q-4** | **Keep** `id="settings-section-plan"`. It costs nothing, an old `#settings-section-plan` hash still lands on the row, and S-5 re-checks every link and decides whether to keep it |

### Conditions

1. **W-1 (High) The `router.replace` pin regex fails on the planned code.** `/router\.replace\([^)]*\{\s*scroll:\s*false\s*\}\)/` stops at the first `)`, which closes `settingsUrlWithoutSection(pathname, searchParams)`, so it never reaches `{ scroll: false }`. Checked with node against the exact call in §B.4: `false`. Use a form that tolerates the nested call, for example `/router\.replace\([\s\S]*?,\s*\{\s*scroll:\s*false\s*\}\s*\)/` (checked: `true`). This applies both in `greetingUsesTheEditedName.guard.test.ts` and in `settingsDeepLinks.guard.test.ts`. Better still, keep the positive pin **only** in `settingsDeepLinks.guard.test.ts` and leave the greeting test to the two bans (Optimisation O-1).
2. **W-2 (High, QA + record; does not block merge) 3-D Secure inside the drawer.**
   - (a) **Q7** uses a 3-D Secure test card (`4000 0027 6000 3184`) as well as `4242`, on desktop and on phone width. Pass means the challenge can be clicked and typed into, focus is not pulled back into the sheet, the drawer stays open, and the result reaches "processing" and then "You're on …".
   - (b) **Q8** in the sandbox, with Stripe's "always requires authentication" card on a paying `basic` test owner (the P-7b.1 demo (3) setup) if one is available. Pass has the same meaning as (a), plus: abandoning the challenge leaves the drawer usable.
   - (c) The QA report states each result explicitly as pass, fail or not run.
   - (d) If either result is a fail or not run, Dev adds a row to the plan-payments go-live checklist (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5) in T11: "3-D Secure (checkout and upgrade) verified inside the Settings plan drawer". Neither payment switch goes on in production until it is ticked. The fix then belongs to plan-payments scope with its own SA review. A likely shape is an `onBusyChange` from `PlanUpgrade` and `PlanPurchase` into `isBusy`, plus whatever the challenge needs from the sheet's modality. S-1 does not pre-build it.
3. **W-3 (Medium) Q-2 pin.** `settingsDeepLinks.guard.test.ts` also asserts that the plan branch assigns `planOpenedByLink.current = true` before `setPlanDrawerOpen(true)`, with no condition on the current open state.
4. **W-4 (Medium) Q-3 in the source guard.** The wrapper source guard bans `createContext`, `useContext`, `Provider` and the entitlements import, as planned. Add a comment in the test saying that S-3 may allow exactly `TabFooterSlotProvider` from `./TabFooter` (SA ruling Q-3), so the S-3 edit is expected and not a surprise.
5. **W-5 (Low) Q-4.** Leave a one-line comment on the row wrapper saying the id is kept for old hash links and that S-5 decides.
6. **W-6 (Medium) C-2 guard robustness.** All positive pins in `settingsDeepLinks.guard.test.ts` run on **comment-stripped** source (the `codeOf` used by `greetingUsesTheEditedName`), so a commented-out branch cannot satisfy them. The `id="settings-section-timezone"` pin may use raw source, because it is JSX and not a comment. The negative control runs the same timezone-branch matcher on a synthetic snippet that has the anchor but no branch, and expects it to fail.
7. **W-7 (Medium) Must-stay-green list.** Add `lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts`. It scans `app/` and `components/`, including the new `SettingsDrawer.tsx`, `settingsSectionUrl.ts` and `app/business-os/settings/__tests__/`, which is **not** on its exempt list. The new files must contain no quoted tier literals.
8. **W-8 (Low) Hebrew side expectation in QA.** `components/ui/sheet.tsx` uses logical insets: `left` is `start-0` and `right` is `end-0`, with `rtl:` slide variants. `LanguageContext` also sets `document.documentElement.dir = 'rtl'`. So `side={isRTL ? 'left' : 'right'}` probably resolves to the inline **start**, which is the physical right, in Hebrew. The checklist's "Hebrew: drawer opens from the left" may therefore be wrong about the as-built shell. Change the expectation to "opens on the same side, and slides the same way, as the Money detail drawer and the Top up panel in Hebrew", and record the side observed. S-1 copies the shell and does **not** change `sheet.tsx`. If the user wants a different side, that is a product-wide decision outside this feature.

### Test plan adequacy

| Area | Verdict |
|---|---|
| C-2 timezone guard incl. negative control | ✅ Adequate with W-6 |
| C-12 seven tests | ✅ All seven are in the run command: `PlanSection.render` and `InviteFriendsSection.render` through the `components/business-os/settings` path, plus `journeyReadiness`, `planBadge`, `invite-accepted`, `greetingUsesTheEditedName` and `darkModeTokens`. Add W-7 |
| Wrapper render test | ✅ Covers C-4 (Escape, X, outside, X disabled), focus return, RTL attributes and the description. Radix's outside-pointer handler registers asynchronously, so wait a tick before the outside `pointerDown` or the "does not call" assertion passes vacuously. Pair it with a non-busy outside click that **does** call `onOpenChange(false)` |
| Helper unit test | ✅ |
| C-10 manual QA | ✅ Adequate with W-2 and W-8. The `Select`, `SavedAddressPicker` and invite `<select>` checks are correctly carried to S-3 and S-4 |
| `tsc`, `lint`, `lint:hooks`, `git diff --stat` deletion check | ✅ |

### Optimisation suggestions (non-blocking)

- O-1: Keep the greeting test negative-only (the bans). Positive pins for the cleanup belong in the new deep-link guard, which owns that behaviour.
- O-2: `settingsUrlWithoutSection` can take `{ toString(): string } | null` and build `new URLSearchParams(params?.toString() ?? '')`, so it needs no type import from `next/navigation`.

### Approval

[x] Workplan approved. Proceed to implementation under W-1 to W-8. Leave everything uncommitted for the user's diff review, then SA code review.

## Implementation Notes (Dev, 2026-10-15)

### SA conditions, as applied

| Condition | How it was met |
|---|---|
| W-1 | The wrong `[^)]*` regex was not used anywhere. The corrected `/router\.replace\([\s\S]*?,\s*\{\s*scroll:\s*false\s*\}\s*\)/` is pinned **only** in `settingsDeepLinks.guard.test.ts`, scoped to the body of `handlePlanDrawerChange`, with a non-vacuity check (matches the real call, rejects the same call without `{ scroll: false }`) |
| W-2 | QA checklist Q7, Q8 and a "Q7/Q8 gate" row rewritten with the test cards, widths, pass / fail / not run, and the conditional §9.5 go-live row. The row itself is added by Dev only after QA, if a result is fail or not run |
| W-3 | The plan branch sets `planOpenedByLink.current = true` then `setPlanDrawerOpen(true)` on every `?section=plan`, with no condition. Pinned: order, no `if (` inside the branch, no `planDrawerOpen` read in it, no `if (!planDrawerOpen)` anywhere |
| W-4 | Comment in the wrapper's source guard saying S-3 may allow exactly `TabFooterSlotProvider` from `./TabFooter`; `createContext` stays banned |
| W-5 | One-line JSX comment above `id="settings-section-plan"`: kept for old hash links, S-5 decides |
| W-6 | Every positive pin in the deep-link guard runs on comment-stripped source (the anchor id alone reads raw). Negative controls: anchor with no timezone branch (fails), branch present but the scroll in another block (fails), branch only in a comment (matches raw, fails stripped) |
| W-7 | `tierLiteral.forbidden.test.ts` added to the must-stay-green command and run: green. New files contain no quoted tier literal |
| W-8 | QA checklist preamble now expects "same side and slide as the Money detail drawer and the Top up panel in Hebrew", side to be recorded; `sheet.tsx` untouched |
| Render-test note | `letRadixSettle()` waits 20 ms (inside `act`) before an outside `pointerDown`, and the busy "does not close" test is paired with a non-busy outside press that **does** call `onOpenChange(false)` |
| O-1 | Applied: the greeting guard keeps bans only (`router.push(`, plus the unchanged `ArrowLeft` / `router.push('/business-os')`) |
| O-2 | Applied: `settingsUrlWithoutSection(pathname, params: { toString(): string } \| null \| undefined)`; no `next/navigation` type import |

### Deviations from the workplan

| Item | Deviation | Why |
|---|---|---|
| Render test close label | The harness names the drawer's X "Close this drawer", not "Close" | The sheet's built-in Radix X (hidden by `[&>button]:hidden` in a browser, but present in jsdom) is also named "Close", so `getByRole('button', { name: 'Close' })` found two. Using a distinct label also proves the name comes from `closeLabel` |
| Render test extras | Added "focus goes to the return target even when another element held focus before opening" (the link-opened case) and "the body is `aria-busy` while busy" | Cheap, and they cover the reason `returnFocusRef` exists |
| Deep-link guard extras | Added a pin that `?section=business` / `invoice` still call `openConfiguration(requested)` and return; a pin that the replace comes after the link-only gate and the flag reset | Both were in the planned test plan's prose; written as explicit assertions |
| Busy X styling | The disabled X adds `opacity-50 cursor-not-allowed` through `cn()` | Visible feedback that the X is refusing; Money drawer's X never disables, so it has no disabled style to copy |
| T10 | Not done by Dev | No browser in this run; left to QA's checklist (Q1 to Q13) |

### Files changed

| File | Change |
|---|---|
| `components/business-os/settings/SettingsDrawer.tsx` | new, 154 lines |
| `components/business-os/settings/settingsSectionUrl.ts` | new, 21 lines |
| `components/business-os/settings/__tests__/SettingsDrawer.render.test.tsx` | new, 258 lines (20 tests) |
| `components/business-os/settings/__tests__/settingsSectionUrl.test.ts` | new, 60 lines (7 tests) |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | new, 171 lines (15 tests) |
| `app/business-os/settings/page.tsx` | +72 / −17 |
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | +8 / −3 |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | S-1 progress line, two Change History rows (file is untracked on this branch) |

`git diff --stat` on tracked files: 2 files, 80 insertions, 20 deletions. No file shrank; every deletion is matched by its replacement.

### Verification results

| Check | Result |
|---|---|
| Jest must-stay-green set (command above, incl. the new tests, the seven C-12 tests, `tierLiteral.forbidden`, `PlanPurchase.render`, `PlanUpgrade.render`, `enforcementPoints`, `planCheckout`, `pluginConnectionsBrowserAccess.guard`) | ✅ 17 suites, 542 tests passed |
| `npm run test:bos-entitlements` (once, as planned) | ✅ 267 suites, 7,982 tests passed |
| `npx tsc --noEmit -p .` (needs `NODE_OPTIONS=--max-old-space-size=12288`; default heap OOMs) | 1,856 pre-existing errors repo-wide; **0 in any touched or new file**. The only hits under `components/business-os/settings/` are two pre-existing errors in `MarketingConsentPanel.tsx` (untouched, `SavedAddressPicker` types) |
| `npm run typecheck:bos-llm` (the CI gate) | ✅ 530 files, 28 errors, **0 new**, passed |
| `eslint` on the 7 touched code files | ✅ 0 errors; 3 warnings, all pre-existing and outside the changed lines (`loadData` missing from the load effect's deps, unused `withDeadline`, unused `clearSessionKeys`) |
| `npm run lint:hooks` | ✅ exit 0 |

## SA Code Review (2026-10-15)

**Reviewed by:** SA, against the uncommitted worktree on `feature/settings-drawer-s1` (`git diff` on the 2 tracked files plus the 5 new files, all read in full).
**Verdict:** **APPROVED.** Code approved for QA. No required changes. The findings below are Low or informational and none blocks QA or the PR.

### Checked

| Area | Result |
|---|---|
| C-1 props-only wrapper | ✅ `SettingsDrawer.tsx` imports only React, `lucide-react`, `@/components/ui/sheet` and `cn`. No context read or defined, no provider, no entitlements import (type-only included), no logger (nothing to log), no `forceMount`. Q-3's extra props are exactly as ruled |
| Shell parity with `MoneyDetailDrawer` | ✅ Same classes, own X, fixed header, `scrollbar-thin flex-1 overflow-y-auto p-6 space-y-3` body. The built-in Radix X is a direct child `button`, so `[&>button]:hidden` hides it and not the nested own X. `cn()` and V2 tokens are used throughout |
| C-4 busy refusal | ✅ All close routes go through one `handleOpenChange` gate. Escape and outside interaction are also `preventDefault`ed and the X is `disabled`. This is defence in depth, see finding 3 |
| C-3 URL cleanup | ✅ `router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false })`, only when link-opened. The flag is cleared before the replace. The helper deletes only `section`, keeps order and encoding, and does not mutate its input. Row-opened closes never write the address. After the replace the effect re-runs, finds no `section` and does nothing. `openConfiguration` is a `useCallback` with `[]` deps, so the effect does not re-run on render and cannot reopen a just-closed drawer |
| W-3 / Q-2 flag | ✅ Set unconditionally before `setPlanDrawerOpen(true)` on every `?section=plan`, including the `PlanPurchase` `?section=plan&checkout=…` rewrite into a row-opened drawer |
| C-11 `checkout` | ✅ The page only reads it (`searchParams?.get('checkout')` → `PlanSection`, as before). No `set`/`delete` of `checkout` and no `window.history` |
| C-9 / C-13 frozen code | ✅ The diff hunks are imports, three state lines, the plan/password tail of the deep-link effect, the new close handler and the plan row only. `loadData`, `persistTimezone`, `saveProfile`, the export handler, the Language / Currency / Timezone rows, `id="settings-section-timezone"`, the consent and password rows, Log out and Delete are byte-for-byte unchanged. The `business`/`invoice`, `timezone` and `preferences` handling is unchanged. Password behaviour is unchanged |
| Focus return | ✅ `onCloseAutoFocus` → `returnFocusRef`. The row is always rendered before the effect runs (the effect waits for `loading`), so the link-opened case has a target. The render test proves the target wins over the previously focused element |
| RTL | ✅ `isRTL` from the page, `side` / `dir` / `data-side` set as Money does, `text-start` on the title. Side observation is left to QA (W-8) |
| a11y | ✅ Row is `type="button"`, `aria-haspopup="dialog"`, `aria-expanded`. Dialog is named by `SheetTitle`. `aria-describedby` is omitted without meta. The X has a translated `aria-label` (`common.close`) |
| i18n, `@/` imports, TS strict, no `any`, no `console.*` | ✅ No new keys, no implicit `any`. Both touched code files are Pino-compliant or have nothing to log |
| O-1 greeting guard | ✅ As intended. The "has no back button" test is untouched and still bans `ArrowLeft` and `router.push('/business-os')`. The renamed test replaces only the blanket `useRouter` ban with `not.toMatch(/router\.push\(/)` on comment-stripped source, which also subsumes the specific push ban. The positive `replace` pin lives only in `settingsDeepLinks.guard.test.ts` with the corrected W-1 regex and a non-vacuity pair |
| Guard quality | ✅ The negative controls are real. Each timezone control is a distinct regression shape (no branch, scroll in another block, comment-only branch, which matches raw and fails stripped). The plan-branch pin cannot be satisfied by `if (requested === 'plan' && !planDrawerOpen)`, because the branch regex then finds no match and the test fails. The outside-press busy test waits for Radix to register its listener and is paired with a non-busy press that does close |
| Dev deviations 1–3 (+ busy X style, T10) | ✅ All accepted. (1) A distinct close label is the right fix for jsdom's visible built-in X, and it proves the name comes from the prop. (2) and (3) add coverage. The disabled-X style via `cn()` is a reasonable addition. T10 is correctly left to QA |
| Jest (SA re-run) | ✅ Must-stay-green set: 17 suites / 542 tests green. First run: 2 timeouts in the untouched `PlanSection.render.test.tsx` (`waitFor`, line 423) while QA was running in parallel. The re-run was fully green. See finding 1 |

### Code Review Comments

1. `components/business-os/settings/__tests__/PlanSection.render.test.tsx:423` — Timed out once under parallel load (QA running in the same worktree), green on re-run. The file is untouched by S-1 and the slice changes nothing it renders. If QA or CI sees it again, raise it as a separate flake ticket. Do not fix it in S-1. Priority: Low
2. `app/business-os/settings/page.tsx` `handlePlanDrawerChange` and the plan branch — The page-level open/close/replace behaviour is pinned by source guards only, not by a behavioural render of the page. Acceptable for S-1: the page has no render harness today, building one is out of proportion for this slice, and QA Q5/Q6 cover it live. If S-2/S-3 add more link-opened drawers, extract the "link flag + replace on close" pair into a small hook in `components/business-os/settings/` with its own unit test rather than copying it per drawer. Priority: Low
3. `components/business-os/settings/SettingsDrawer.tsx` busy refusal — Each refusal path is guarded twice (event `preventDefault` plus the `handleOpenChange` gate, and `disabled` plus the gate). The busy tests therefore stay green if any single layer is removed. This is intentional defence in depth and not a defect. Noted so S-3, when it adds `isDirty` through the same gate, does not read a green busy test as proof that both layers exist. Priority: Low
4. `app/business-os/settings/page.tsx` plan row `ChevronRight` — Not mirrored in RTL. This is pre-existing and identical on every row of the page, and the workplan said "unchanged". Leave it for S-5 or a page-wide RTL pass. Priority: Low (informational)
5. `greetingUsesTheEditedName.guard.test.ts` — `/router\.push\(/` would not catch `router?.push(` or a destructured `const { push } = useRouter()`. Neither form exists in the page, and review catches them. No change needed. Priority: Low (informational)

### Optimisation Suggestions

- Finding 2's hook extraction, when the second link-opened drawer arrives (S-2/S-3), not now.

### Code Approved for QA: Yes

## QA Testing Report

See [QA Report (2026-10-15)](#qa-report-2026-10-15).

## QA Report (2026-10-15)

**QA — 2026-10-15**, against the uncommitted worktree `feature/settings-drawer-s1` (`neuronforge-settings-drawers`), after SA code review APPROVED.
**Test mode:** full (automated); manual checklist recorded as NOT RUN.
**Strategy used:** A (Jest unit + jsdom render) and source guards, mutation spot-checks, code reading for the page-level paths. D (manual browser) **not run**: no browser and no logged-in account in this session.
**Focus:** ui, URL contract (C-2, C-3, C-11).
**Skipped:** manual browser checks Q1–Q13 (see NOT RUN list). `tsc` / lint not re-run by QA (Dev's results above, not contested).
**Input source:** TL prompt + workplan Test Plan and Manual QA Checklist.

### 1. Jest (independent re-run)

Command: the workplan's must-stay-green command, unchanged.

| Suite | Result |
|---|---|
| `SettingsDrawer.render` (new) | ✅ 20/20 |
| `settingsSectionUrl` (new) | ✅ 7/7 |
| `settingsDeepLinks.guard` (new) | ✅ 15/15 |
| C-12 seven: `PlanSection.render`, `InviteFriendsSection.render`, `journeyReadiness`, `planBadge`, `invite-accepted`, `greetingUsesTheEditedName.guard`, `darkModeTokens.guard` | ✅ all pass |
| `tierLiteral.forbidden` (W-7), `PlanPurchase.render`, `PlanUpgrade.render`, `enforcementPoints`, `planCheckout`, `pluginConnectionsBrowserAccess.guard` | ✅ all pass |
| `InvoiceSettingsSection.render` (picked up by the folder path) | ✅ pass |
| **Total** | ✅ **17 suites, 542 tests passed, 0 failed** (matches Dev and SA) |

QA's run saw no `PlanSection.render` timeout. SA's one-off timeout (SA finding 1) happened while QA's run was in flight in the same worktree, which supports SA's "parallel load" reading.

`test:bos-entitlements` not re-run: the diff imports nothing from `lib/business-os/entitlements/` and touches neither `catalog.ts` nor `tierMatrix.ts` (checked in the diff); Dev ran it green.

### 2. Mutation spot-checks

Method: each production file was backed up to the QA scratch dir, mutated in place, the relevant suite run, then **restored by copying the backup** (not `git checkout`, which would have reverted Dev's uncommitted `page.tsx` edits). After all runs: SHA-1 of `page.tsx`, `SettingsDrawer.tsx`, `settingsSectionUrl.ts` identical to before; `git diff --stat` identical to before (`2 files changed, 80 insertions(+), 20 deletions(-)`: greeting guard 11, `page.tsx` 89).

| # | Mutation | Suite(s) run | Result |
|---|---|---|---|
| M1 | Drop `{ scroll: false }` from the close `router.replace` | deep-link guard | ✅ caught (1 failed) |
| M2 | `router.replace` → `router.push` in the close handler | deep-link + greeting guard | ✅ caught (4 failed) |
| M3 | Delete the `requested === 'timezone'` branch | deep-link guard, `planBadge`, `journeyReadiness` | ✅ caught (1 failed) |
| M4 | Drop `aria-haspopup="dialog"` from the plan row | deep-link guard | ✅ caught (1 failed) |
| M8 | Drop `disabled={isBusy}` from the X | render | ✅ caught (1 failed) |
| M9 | Guard the link flag: `if (!planDrawerOpen) planOpenedByLink.current = true` (SA Q-2 / W-3) | deep-link guard | ✅ caught (1 failed) |
| M10 | Remove `planOpenedByLink.current = true` | deep-link guard | ✅ caught (1 failed) |
| M11 | Helper also deletes `checkout` | helper test | ✅ caught (3 failed) |
| M12 | Remove `target.focus()` in `onCloseAutoFocus` | render | ✅ caught (2 failed) |
| M13 | Swap the RTL side | render | ✅ caught (2 failed) |
| M14 | Remove `[&>button]:hidden` | render (source guard) | ✅ caught (2 failed) |
| M15 | Replace on every close (drop the link-only gate) | deep-link guard | ✅ caught (1 failed) |
| M16 | Row goes back to toggling `setExpandedSection('plan')` | deep-link guard | ✅ caught (2 failed) |
| M17 | Remove all busy refusal (handler guard + Escape/outside prevent + X `disabled`) | render | ✅ caught (3 failed) |
| M5 | Remove only the `handleOpenChange` busy guard | render | ⚠️ not caught (20/20): Escape/outside prevents and the disabled X still refuse |
| M6 | Remove only the Escape `preventDefault` while busy | render | ⚠️ not caught: the handler guard still refuses |
| M7 | Remove only the outside `preventDefault` while busy | render | ⚠️ not caught: the handler guard still refuses |
| M18 | Remove both Escape and outside prevents (handler guard kept) | render | ⚠️ not caught: the handler guard alone refuses |

M5–M7 and M18 leave behaviour correct: the busy refusal is layered, and the tests pin the observable result (no `onOpenChange(false)`). This confirms SA finding 3 empirically. See E-1.

### 3. Code-level verification (happy path + failure paths)

| Path | Verified by | Result |
|---|---|---|
| Row click opens the drawer, URL untouched | `onClick={() => setPlanDrawerOpen(true)}` (pinned, M16); `handlePlanDrawerChange` returns before any replace when `planOpenedByLink` is false (pinned, M15) | ✅ |
| `?section=plan` opens it; flag set unconditionally | Plan branch: flag then `setPlanDrawerOpen(true)`, no `if` (pinned, M9/M10); the effect waits for `loading` to clear first | ✅ |
| Close of a link-opened drawer removes only `section`, keeps `checkout` and `tab`, no Back entry, no scroll | `settingsUrlWithoutSection` unit tests (M11); `router.replace(…, { scroll: false })` pinned (M1, M2); no `router.push`, no `.set/.delete('checkout')`, no `window.history` | ✅ |
| After the replace the drawer does not reopen | The effect re-runs on the new `searchParams`, `section` is null, falls through to `if (requested !== 'password') return;` | ✅ (code reading) |
| Busy refuses close (failure path) | Render tests: X disabled and no call, Escape no call, outside press no call (after Radix settles), paired with the non-busy control; M17 | ✅ |
| `?section=timezone` still scrolls to the row, no drawer | Branch + anchor pinned with three negative controls (M3) | ✅ |
| `?section=business` / `invoice` → configuration window | Pinned | ✅ |
| `?section=password` unchanged | Same `setExpandedSection` + `scrollToSection` path as before | ✅ (code reading) |
| Plan fetched on open only | `PlanSection` is a child of `SheetContent`, no `forceMount` (the source guard bans it), so it mounts on open | ✅ (code reading; live network check is Q4) |
| Focus returns to the plan row, including the link-opened case | Render tests (M12) + `returnFocusRef={planRowRef}` | ✅ in jsdom; live check is Q3/Q5 |
| Layering above the page header | `sheet.tsx` overlay and content are `z-50`; the business-os chrome components found also use `z-50`, so the order relies on the portal coming later in the DOM | ⚠️ needs the live Q9 check |

### 4. Manual browser checks: NOT RUN

No browser and no logged-in account in this session. **Every row below is NOT RUN** and must be walked by a human on desktop and phone width (≤ 640 px), in English and Hebrew.

| # | Status | What a human must check |
|---|---|---|
| Q1 | NOT RUN | Row shows "Your plan" + chevron only; a screen reader announces that it opens a dialog |
| Q2 | NOT RUN | Drawer opens from the reading end, full width on phone / about 576 px on desktop, fixed header, body scrolls alone, URL unchanged |
| Q3 | NOT RUN | Close by X, Escape, overlay: focus back on the plan row, URL unchanged |
| Q4 | NOT RUN | `my-plan` request appears only after opening (Network tab) |
| Q5 | NOT RUN | Plan pill → drawer opens; close → `/business-os/settings` via replace; Back does not reopen; reload shows it closed; focus on the plan row |
| Q6 | NOT RUN | `?section=plan&checkout=cs_test_x&tab=foo` → "Payment processing"; close → `?checkout=cs_test_x&tab=foo` |
| Q7 | **NOT RUN**: `4242 4242 4242 4242` desktop not run; `4242` phone not run; **3-D Secure `4000 0027 6000 3184` desktop not run; 3-D Secure phone not run** | Embedded checkout usable in the drawer; the 3-D Secure challenge can be clicked and typed into, focus is not pulled back into the sheet, the drawer stays open, "processing" then "You're on …", close removes only `section` |
| Q8 | **NOT RUN**: upgrade 3-D Secure ("always requires authentication" card, paying `basic` test owner) not run | Inline confirm usable; challenge usable as in Q7; abandoning it leaves the drawer usable |
| Q9 | NOT RUN | Drawer and overlay above the page header (both `z-50`, see §3); popovers and toasts above the overlay |
| Q10 | NOT RUN | `?section=timezone` scrolls to Timezone, no drawer |
| Q11 | NOT RUN | `?section=business` / `invoice` / `preferences` / `password` behave as before |
| Q12 | NOT RUN | Language, Currency, Timezone, profile card, Invite friends, Marketing permission, Password, Export, Log out, Delete unchanged |
| Q13 | NOT RUN | Switch to Hebrew with the drawer open: plan names re-read, nothing breaks; record the side observed and compare it with the Money detail drawer and the Top up panel (W-8) |

**W-2 (c)/(d): the 3-D Secure checks (Q7 with the 3-D Secure card, Q8 upgrade) are NOT RUN.** Per W-2 (d), a go-live row is therefore owed in `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5 "Go-live checklist (P-12): switching to real money", as the next row after row 19. Dev adds it in T11; QA did not edit that file. Proposed row:

> | 20 | **3-D Secure (checkout and upgrade) verified inside the Settings plan drawer** (settings drawer S-1, SA W-2). Checkout with `4000 0027 6000 3184` and the upgrade with Stripe's "always requires authentication" card, each on desktop and phone width: the challenge can be clicked and typed into, focus is not pulled back into the sheet, the drawer stays open, and abandoning leaves it usable. Neither payment switch goes on in production until this is ticked | User; QA records | Before row 15 | ☐ |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. The plan is still fetched on open only (no `forceMount`), as it was when the row expanded.

#### Edge Cases (nice to fix / note)

1. **E-1 (Low) Busy refusal layers are not pinned one by one.** Same as SA finding 3, now shown by M5–M7 and M18. Correct behaviour today, and `isBusy` has no caller in S-1. When S-3 gives it a real caller (and adds `isDirty` through the same gate), either assert each layer in isolation or record the layering as accepted. File: `components/business-os/settings/__tests__/SettingsDrawer.render.test.tsx`.
2. **E-2 (Low) `checkout` outlives the drawer.** After a link-opened close, the address keeps `?checkout=…` (by design, SA Q-2), so every later row-open in that tab, and a reload, passes the marker to `PlanSection` again. This was the same before S-1, because the URL kept it then too. Worth watching in Q6 to confirm that the "processing" state settles to the plan and does not look stuck. File: `app/business-os/settings/page.tsx`.
3. **E-3 (Low, theoretical) Close/replace race.** `setPlanDrawerOpen(false)` is synchronous and `router.replace` is not. SA confirmed that `openConfiguration` is a `useCallback` with `[]` deps, and `loading` does not flip back after the first load, so QA found no trigger. If Q5 ever shows a reopen right after closing, this is the cause.
4. **E-4 (Low) No page-level render test.** Same as SA finding 2. The mutations show the source guards are tight. No change in S-1.
5. **E-5 (Low) Side flips while open on a language switch.** `isRTL` changes the `side` of an open sheet. Q13 should record whether it jumps or animates oddly.

### Final Status

- [x] All automated checks pass (17 suites / 542 tests). 14 of 18 mutations caught; the other 4 remove one redundant layer and leave behaviour correct (E-1)
- [x] Happy path and failure paths (busy refusal, link-only cleanup, timezone guard) are tested, which meets the CLAUDE.md minimum
- [ ] Manual browser checks Q1–Q13: **NOT RUN**, owed by a human (C-10)
- [ ] W-2 (d): §9.5 go-live row owed (3-D Secure not run)

**Verdict: PASS WITH NOTES.** No bugs. The automated evidence supports the user's diff review. The manual checklist (Q1–Q13) is still open, and the W-2 go-live row has to be added to the plan-payments requirement.

## Commit Info

*(RM to populate)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Dev workplan for S-1 (wrapper + Plan drawer pilot), verified against `page.tsx` at `f7301fad`; C-3 / C-12 resolved by editing the greeting guard's router test; four questions for SA (embedded checkout in the drawer and busy state, link-opened after checkout, extra wrapper props, plan anchor) |
| 2026-10-14 | SA workplan review | APPROVED WITH CONDITIONS W-1 to W-8. Q-1: embedded checkout cleared on the verified Boost precedent, and no `isBusy` in S-1. `PlanUpgrade`'s `handleNextAction` 3-D Secure is not covered by that precedent, so it gets a QA step and, if it is not proven, a plan-payments go-live gate (W-2). Q-2 accepted. Q-3: extra props accepted, and the existing `TabFooterSlotProvider` is not a C-1 "provider". Q-4: keep the anchor. W-1: the `router.replace` pin regex fails on the planned call and needs a fix. W-7: add `tierLiteral.forbidden`. W-8: the Hebrew side expectation needs correcting (logical insets) |
| 2026-10-15 | Code complete | T1 to T9 and T11 done, T10 left to QA (no browser). W-1 to W-8 applied, O-1 and O-2 applied. Must-stay-green 17 suites / 542 tests green; `test:bos-entitlements` green; `typecheck:bos-llm` 0 new; full `tsc` 0 errors in touched files; lint 0 errors; `lint:hooks` clean. QA checklist updated for W-2 and W-8. Uncommitted, awaiting SA code review |
| 2026-10-15 | SA code review | APPROVED, code approved for QA, no required changes. C-1, C-3, C-4, C-9, C-11, C-13, W-1 to W-8, O-1, O-2 and Dev deviations verified. 5 Low/informational findings: a `PlanSection.render` flake under parallel load (untouched file), page close logic guarded by source pins only (extract a hook when a second link-opened drawer arrives), busy refusal is double-layered, pre-existing unmirrored chevron, `router.push` ban regex scope. SA Jest re-run: 17 suites / 542 tests green |
