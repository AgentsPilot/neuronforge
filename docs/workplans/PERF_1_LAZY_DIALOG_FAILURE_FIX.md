# Workplan: PERF-1 lazy dialogs — survive a failed chunk load

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Branch:** `fix/lazy-dialogs-load-failure`
**Parent work:** [PERF_1_2_3_BUNDLE_SLICES_WORKPLAN.md](/docs/workplans/PERF_1_2_3_BUNDLE_SLICES_WORKPLAN.md) (PERF-1)
**Status:** Code Complete (uncommitted, awaiting SA / QA / user diff review)

## Overview

PERF-1 moved `ConfigurationDialog` and `SchedulingDialog` out of every Business OS page's first download. A failed download of either chunk left the control that opens it permanently dead. This fix keeps the lazy loading and its 110–180 kB first-load saving, and changes what happens when the download fails.

**Credit:** Offir found and diagnosed this. He reported a dead "Business Setup" (הגדרות העסק) tab, traced it to a `ChunkLoadError` timeout, and identified the `.catch` → null component → `next/dynamic` cache chain described below.

---

## Problem

`components/business-os/lazyDialogs.tsx` used `next/dynamic` with a `.catch` that resolved to a component rendering `null`. `next/dynamic` caches whatever its loader resolves to, per `dynamic()` call, for the life of the page. One slow load (`ChunkLoadError: Loading chunk …ConfigurationDialog_tsx failed. (timeout)`) therefore cached "nothing". The tab was present, hydrated and correctly wired, but it was inert until a full reload. The only evidence was one console line.

## Fix

The four points promised to Offir:

| # | Promise | How |
|---|---|---|
| 1 | Retry on failure | Each import is retried twice, after 0.5 s and then 1.5 s (`DEFAULT_RETRY_DELAYS_MS`), before the load counts as failed. Webpack forgets a chunk whose download failed, so a second `import()` requests it again. Each retry is logged with `clientLogger.warn({ err })`, and the final failure with `clientLogger.error({ err })`. |
| 2 | Never resolve to "nothing" | An **open** dialog with no code yet shows a loading surface. If the load failed, it shows "Couldn't load this" with a **Try again** button, inside the standard `components/ui/dialog` primitive. The strings use the en/es/he dictionaries (`lazyDialog.*` keys). A **closed** instance, such as the layout's warm-up, renders nothing, whether the load failed or not. |
| 3 | Don't cache the failure | The module-level in-flight promise is cleared when it rejects. The next open, or Try again, starts a fresh load, and a later success replaces the failure for every instance. A closed instance does not retry in a loop: after a failure, only an open triggers a new load. |
| 4 | Test | `components/business-os/__tests__/lazyDialogLoader.test.tsx`. See [Tests](#tests). |

**Design.** `components/business-os/lazyDialogLoader.tsx` exports `createLazyDialog(name, importer, options)`. Each call owns one module-level loader holding the state (`idle | loading | ready | failed`) and the in-flight promise. Components read it with `useSyncExternalStore`. Because there is one loader per dialog, the layout's warm-up instance still warms every site.

**`ssr: false` semantics.** A second `useSyncExternalStore` ("are we past hydration?") returns `false` on the server and during hydration. The component therefore renders nothing there, open or not, and does no component work, so the server HTML and the first client render always agree. A site that mounts after hydration, with the dialog already loaded, renders the dialog in its first frame.

**Unchanged.** `lazyDialogs.tsx` keeps both export names (`LazyConfigurationDialog`, `LazySchedulingDialog`), so none of the six call sites changed. The dialog modules are still type-only imports there. `next/dynamic` is no longer used.

**Out of scope.** Offir's per-tab split is a follow-up.

## Files

| File | Action |
|---|---|
| `components/business-os/lazyDialogLoader.tsx` | create: loader, component, fallback surface |
| `components/business-os/lazyDialogs.tsx` | modify: uses `createLazyDialog`; same exports |
| `components/business-os/__tests__/lazyDialogLoader.test.tsx` | create: behaviour tests |
| `components/business-os/__tests__/lazyDialogs.guard.test.ts` | modify: asserts the retrying loader, no `next/dynamic`, no `.catch` (static-import ban unchanged) |
| `lib/business-os/translations/{en,es,he}.ts` | modify: 4 `lazyDialog.*` keys each |

## Tests

`lazyDialogLoader.test.tsx` has 12 tests:

- retries twice by default
- a load that fails twice and then succeeds renders the dialog with no error shown
- when every attempt fails, an open dialog shows the alert, and **Try again** loads and renders the dialog (the button still responds)
- an open dialog shows a loading surface while downloading
- a closed instance shows nothing on failure and does not re-request
- a failure is not cached: opening after a failed warm-up loads afresh and renders
- one shared loader: a warm-up instance makes a later instance render in its first frame
- Escape on the error surface calls the caller's `onClose`
- Hebrew strings come from the dictionary
- server render is empty, with no component work, both loaded and unloaded, open and closed, and hydration has no mismatch
- the real `LazyConfigurationDialog` export, with its module failing three times under production backoff, shows the error, and Try again opens it
- the real `LazySchedulingDialog` loads

**Mutation probes** (each restored afterwards):

| Probe | Result |
|---|---|
| (a) failure resolves to a null component | 6 tests fail |
| (b) failed promise cached (no `inFlight = null`) | 3 tests fail |
| (c) no retry | 5 tests fail |
| (d) no hydration gate | SSR/hydration test fails |
| (e) closed instance shows the fallback | closed-instance test fails |

**Other checks:**

| Check | Result |
|---|---|
| `lazyDialogs.guard` | passes |
| `components/business-os` (957 tests) | 954 passed. 3 settings-drawer suites timed out while running alongside a full `tsc`; rerun alone, all 130 of their tests pass |
| `dictionariesStayInStep` | passes |
| `npm run test:bos-entitlements` | 8409 tests pass |
| `npm run lint:hooks` | clean |
| Scoped `tsc` on the touched files | no errors in them. 22 errors remain, all in imported files and all already on main: duplicate dictionary keys, styled-jsx `<style jsx>`, a `Button` variant |

## Sizes

`next build` First Load JS. Base is `origin/main` at `09e2d3ad` and branch is this fix, both built in the same worktree on the same day.

| Route | Base | Branch | Δ |
|---|---|---|---|
| `/business-os` | 480 kB | 481 kB | +1 kB |
| `/business-os/crm` | 529 kB | 529 kB | 0 |
| `/business-os/settings` | 410 kB | 411 kB | +1 kB |
| `/business-os/website` | 539 kB | 540 kB | +1 kB |
| `/onboarding-build` | 455 kB | 456 kB | +1 kB |
| `/scheduling` | 412 kB | 413 kB | +1 kB |
| `/payments` | 388 kB | 389 kB | +1 kB |
| Shared by all | 88.7 kB | 88.7 kB | 0 |

The loader, its fallback surface and four strings per language cost about 1 kB per route. The dialogs remain outside the first load, so PERF-1's 110–180 kB saving holds.

## SA Review Notes

**Code Review by SA — 2026-10-16**
**Status:** ✅ Code Approved (no required changes; optional suggestions below)

SA re-ran: `lazyDialogLoader.test.tsx` + `lazyDialogs.guard.test.ts` (23/23 pass), full `components/business-os` (50 suites, 948/948 pass, no concurrent `tsc`), and `eslint` on the three touched/new TS files (clean). There are no `console.*` calls in either source file.

### Code Review Comments
1. `lazyDialogLoader.tsx` `createLoader`: the module-level state and in-flight promise are correct. A concurrent `load()` joins the in-flight promise. A success sets `ready` and short-circuits later calls. A rejection clears `inFlight` and sets `failed`, so nothing is cached. There are at most 3 attempts (1 + `retryDelaysMs.length`) per load, so retries are bounded. Defaults are 500 ms then 1500 ms. — OK
2. `lazyDialogLoader.tsx:236-239` effect: an `idle` load happens on mount. After a failure, a new load starts only when `isOpen` is true, and the deps are `[isOpen]`. A closed instance therefore never re-requests, and an open instance whose load failed does not loop: it waits for "Try again" or a close and reopen. Opening while a warm-up is `loading` joins it without starting a second request. — OK
3. Hydration gate: `useSyncExternalStore(subscribeNever, () => true, () => false)` is the standard "is client" idiom. React uses the server snapshot during hydration and then re-renders with the client value, so server HTML = hydration render = `null`, open or not. The test checks this with `renderToString`, `hydrateRoot` and `onRecoverableError`. The load-state store also uses a stable server snapshot. — OK
4. First open still identical: once `ready`, the component renders `<Loaded {...props} />` with a stable component identity, open or closed, so the warmed path is the same as the `next/dynamic` one. The shared-loader test proves that an instance mounted later renders in its first frame. — OK
5. New "Loading…" surface: it is shown only if the owner clicks before the warm-up finishes. Under `next/dynamic` that click showed nothing, so this is a visible improvement and it is acceptable. When the load lands, the fallback dialog is swapped for the real one, which plays its own enter animation. That is acceptable for a rare path. — OK
6. z-index: the fallback uses the primitive's `z-[60]`, below `ConfigurationDialog`'s `z-[70]`. When it is opened from a `z-[60]` dialog or drawer, the tie is broken by portal order (opened later, so painted later), so it sits on top. No surface found that opens configuration from above `z-[60]`. — OK, see suggestion (a)
7. Accessibility: the surface uses the Radix dialog, so it has a focus trap, Escape, an overlay click and the X close, all routed to the caller's `onClose` (tested). The failed state is `role="alert"` with `DialogTitle`/`DialogDescription`, and focus lands on "Try again". The loading state is `role="status"` with `aria-busy`. — OK, see suggestion (b)
8. Translations: 4 keys in each of en/he/es, and `dictionariesStayInStep` passes. `useOptionalLanguage` with English fallbacks is the right choice, because the failure path must not throw outside a provider. `dir` follows `isRTL`. — OK
9. Logging: `clientLogger.warn` per retry and `clientLogger.error` on the final failure, with `{ err, dialog }` (context first, `err` key). This is the same client logger used across about 99 components. — OK
10. Hook rules: all four hooks are called unconditionally before the early returns. `loader` is closure scope, not component scope, so the deps are complete. — OK
11. Guard test: it now requires two `createLazyDialog<` calls and both `import()` paths, and bans `next/dynamic` and `.catch(`. The static-import ban is unchanged, so the original regression (a null-component fallback) cannot come back silently. — OK

### Rule 7 — new pattern ruling
`createLazyDialog` is **approved as a sanctioned pattern** and may be reused for other lazy surfaces, under these conditions:
- The surface is client-only and closed by default, follows the `isOpen`/`onClose` contract, and does not need to be in the server HTML or the first paint. Anything that must render at first paint stays a normal or server component.
- It is called once, at module scope. Calling it inside a component creates a new loader on every render.
- A failed load is never resolved to a placeholder component, whether through `next/dynamic` with a `.catch` or through this loader. Every new use gets a guard like `lazyDialogs.guard.test.ts`.
- The first reuse **outside** Business OS must move the loader to a shared location and decouple it from `lib/business-os/LanguageContext`. That move needs a short SA check. Reuse inside Business OS needs no further SA ruling.

### Dev's "3 suites failed only under load" claim
**Credible.** SA's full `components/business-os` run, without a concurrent `tsc`, passed 50/50 suites and 948/948 tests. None of the settings-drawer suites imports `lazyDialogs` or the loader. A timeout while running alongside `tsc` is consistent with the known heavy render suites. Minor: the notes say 957 tests and SA counted 948; this is likely a count from a different run and is not a concern.

### Optimisation Suggestions (non-blocking)
- (a) Consider giving the fallback's `DialogContent` (and overlay, if the primitive allows it) the same layer as the dialog it stands in for (`z-[70]`), so it never relies on the portal-order tie-break.
- (b) The loading state reads "Loading…" twice to a screen reader (the title plus an sr-only description with the same text). Drop the description and use `aria-describedby={undefined}` on `DialogContent`, or use a different description.
- (c) The real-export test waits through the real 2 s production backoff. This is acceptable, but `jest.useFakeTimers` could be used here if suite time becomes a concern.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full
**Strategy used:** A (Jest unit/render with mocked chunk failures) + mutation probes. D (browser) deferred to the manual checklist below.
**Focus:** ui
**Skipped:** live browser check (deferred, see checklist)
**Input source:** TL prompt

### Test Coverage
| Promise / criterion | Tested? | Result | Notes |
|---|---|---|---|
| 1. Retry on failure | ✅ | Pass | Probe (c) "no retry" fails 6 tests |
| 2. Visible error + Try again, never nothing | ✅ | Pass | Probe (a) "resolve to null" fails 7 tests |
| 3. Failure not cached | ✅ | Pass | Probe (b) "keep rejected promise" fails 4 tests |
| 4. Tests exist | ✅ | Pass | 13 loader tests (12 Dev + 1 QA) + guard |
| Offir's exact scenario | ✅ | Pass | QA added a test: warm-up fails 3 times, tab click fails 3 more times, "Couldn't load this" + "Try again" shown, Try again renders the real dialog. Fails under all three probes |
| Closed warm-up shows nothing on failure, no loop | ✅ | Pass | Existing test |
| No SSR output / no hydration mismatch | ✅ | Pass | Existing test |
| he/en strings, RTL | ⚠️ | Partial | he strings tested in Jest; RTL layout is in the manual checklist |

### Runs
| Run | Result |
|---|---|
| `lazyDialogLoader` + `lazyDialogs.guard` | 23/23 pass (before the QA test); `lazyDialogLoader` alone 13/13 after it |
| `components/business-os` in full | 947/948. 1 failure: `PlanSection.render` "a network failure is the same message" (`waitFor` timeout, 47 s suite = load) |
| Rerun alone: `MarketingConsentDrawer.*`, `SettingsDrawer.discard`, `PlanUpgrade`, `PlanSection.render` | 175/175 pass |
| Every suite `--findRelatedTests` lists for `lazyDialogs.tsx` / `lazyDialogLoader.tsx` (crm contact-drawer x4, scheduling x2, `BusinessOSHeader.themeIcon`) | 94/94 pass |
| `dictionariesStayInStep` | 9/9 pass |

**Load-only failures and the changed files:** according to `--findRelatedTests`, none of the 4 settings suites imports `lazyDialogs.tsx` or `lazyDialogLoader.tsx`. They reach the change only through the translation dictionaries, where 4 keys were added. They pass when run alone. These are timing flakes under parallel load, not regressions.

**Mutation probes:** QA repeated each probe on `lazyDialogLoader.tsx`, then restored the file from a copy. The SHA-256 matched the original each time (`8699b293…3aae`).

### Issues Found
#### Bugs
None.
#### Edge Cases (nice to fix)
1. The real-export test can only cover the "fail from open" path. Module-level loader state persists for the whole file, so a real-export warm-up-then-click test would need its own test file. QA's Offir test covers that path through `createLazyDialog`.

### Manual browser checklist (owed, run later)
1. `npm run dev`, sign in, go to `/business-os`. In DevTools > Network, block the request URL pattern `*ConfigurationDialog*` (right-click > Block request URL), then hard reload.
2. Wait about 3 s for the warm-up retries to run out. The console shows 2 warnings and 1 error. The page shows no error yet.
3. Click "Business Setup" (הגדרות העסק). A small dialog shows "Couldn't load this" / "Check your connection and try again." / **Try again**. The tab is not dead.
4. Switch the language to Hebrew and repeat. You see "לא הצלחנו לטעון את זה" / "נסו שוב". Text is right-aligned, the dialog is `dir="rtl"`, the icon and button are centred, and the close X is on the RTL side.
5. Press Escape, or the X. The dialog closes and the tab can be clicked again.
6. Unblock the pattern, open the tab again, and press **Try again**. "Loading…" may flash, then the real configuration dialog opens on the Business Setup tab.
7. Normal path: no blocking, hard reload, wait 1–2 s, click the tab. The dialog opens immediately with no "Loading…" flash. Repeat on `/business-os/settings` and on a SchedulingDialog site.
8. Optional: with Network set to Offline after load, click the tab. You see the error, not a dead tab.

### Final Status
- [x] All acceptance criteria pass in Jest. Ready for commit once the user has reviewed the diff. The browser checklist is owed after deploy.

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Fix for the PERF-1 dead-dialog failure mode reported by Offir |
