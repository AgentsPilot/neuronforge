# Workplan: PERF-1 / PERF-2 / PERF-3 bundle slices

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [PERFORMANCE_IMPROVEMENT_SCOPING.md](/docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md): §0 Decision point 1, §6, §8, §9, §11.2 (PC-1, PC-2, PC-3 and the "BA final §6 verdicts" table), §11.1 R22
**Date:** 2026-10-13
**Status:** Code Complete (PERF-1, PERF-2). PERF-3: no change, see §PERF-3
**Branch:** none yet. Per the TL instruction these changes sit **uncommitted in the main checkout**; RM creates the branches and splits the slices using the file lists below.
**Path:** short path (UI and bundle only): Dev → SA code review + QA in parallel → the user sees the diff → RM.

## Overview

Three bundle slices picked at Decision point 1. PERF-1 lazy-loads the configuration and scheduling dialogs. PERF-2 loads the owner-side phone-number library on demand. PERF-3 asked to preload the phone library on the public booking widget, but that file is not served by any route, so PERF-3 has nothing to change (details below).

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [PERF-1: lazy ConfigurationDialog and SchedulingDialog](#perf-1-lazy-configurationdialog-and-schedulingdialog)
- [PERF-2: phone library on demand on owner pages](#perf-2-phone-library-on-demand-on-owner-pages)
- [PERF-3: public booking widget](#perf-3-public-booking-widget)
- [Measurement](#measurement)
- [Verification](#verification)
- [New patterns for SA review](#new-patterns-for-sa-review)
- [Flags for the user](#flags-for-the-user)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

What the static import graph actually is (traced from each page entry, type-only and dynamic imports excluded):

| Route | Carried `ConfigurationDialog` via | Carried the phone library via |
|---|---|---|
| every `/business-os/*` page | layout → `ConfigurationDialogProvider` → `ConfigurationDialog` | layout → `ConfigurationDialog` → `BusinessProfileSection`; layout → `BusinessOSHeader` → `SchedulingDialog` → `SchedulingBookingModal` |
| `/business-os` | also `page.tsx` (both dialogs) | also `CRMContactModal` |
| `/business-os/crm` | layout | also `CRMContactModal`, `CRMContactDrawerV2` → `ClientDetailsSection` and `SchedulingBookingModal` |
| `/business-os/website` | also `page.tsx` and `WebsiteSetupWizard` | `ContactFormBlock` in the editor preview (BIZ-7, out of scope, stays) |
| `/scheduling`, `/payments` (outside the BOS layout) | `SchedulingBookingModal` / `InvoiceModal` → `ConfigurationDialogProvider` (they import its hooks) → `ConfigurationDialog` | `SchedulingBookingModal`, plus the dialog chain |
| `/onboarding-build` | `page.tsx` | via `ConfigurationDialog` → `BusinessProfileSection` |
| `/site/[subdomain]/book` | — | **nothing** (see PERF-3) |

Findings beyond the requirement's site list:
- **`WebsiteSetupWizard.tsx:26` also imported `ConfigurationDialog` statically** and is on `/business-os/website`. Converted too, or the chunk would have stayed on that page.
- **The provider was the real culprit for pages outside the layout.** `/scheduling` and `/payments` carried the whole configuration dialog only because `SchedulingBookingModal` and `InvoiceModal` import the provider's *hooks*. Making the provider lazy fixes them as a side effect.
- **PERF-2 depends on PERF-1.** On every BOS page the phone library also arrived through the two dialogs (`BusinessProfileSection`, `SchedulingBookingModal`). PERF-2 alone removes nothing from those pages; it must merge after PERF-1.
- **`components/crm/CRMContactDrawer.tsx` has no importers** (superseded by `CRMContactDrawerV2`). It was converted because the requirement lists it, so all four phone sites behave the same, but it has no bundle effect.

---

## PERF-1: lazy ConfigurationDialog and SchedulingDialog

### Approach

One `next/dynamic(…, { ssr: false })` per dialog in a new `components/business-os/lazyDialogs.tsx`, used by **every** site. Every site keeps rendering its dialog where it did, closed.

- **Prefetch after first paint, no click (AC-1.1).** A closed lazy instance renders nothing on the server (the dialogs drew nothing while closed anyway) and requests its chunk as soon as it mounts on the client.
- **First open identical (AC-1.2).** React resolves a lazy component once per `dynamic()` call, not per instance. The layout's always-mounted closed instances (provider, header) resolve it right after hydration, so every later open, on any site of the page, renders in the same frame as before: no spinner, no empty frame, same animation, same starting tab. This is why the `dynamic()` calls are shared rather than written at each site.
- **`/onboarding-build` sits outside the BOS layout**, so nothing warmed the dialog there. Its two dialogs mount only on click, so a closed `<LazyConfigurationDialog isOpen={false} />` was added to warm it. It draws nothing and fetches nothing: every effect in `ConfigurationDialog` is gated on `isOpen`, which is the same reasoning the provider already relies on.
- **AC-1.3:** My Day's chat-driven dialog and the onboarding dialogs pass exactly the same props as before (pre-filled services, `visibleTabs`, callbacks), and they render the same component.
- **AC-1.4 (opens at first render).** No site opens a dialog at first render. The closest is `/business-os/settings?section=business|invoice`, which calls `openConfiguration` once the settings data has loaded. The dialog chunk starts downloading at hydration, in parallel with that data load, so in practice it is resolved first. If the data won the race on a very slow network, the dialog would appear when its chunk arrives, still with no spinner or empty frame. **QA: check this link under Fast 3G with cache off.**
- **AC-1.5:** props and `onClose` pass straight through; the provider's capability refresh, `onClose`-once and closing grace are untouched.
- **Chunk-load failure** (offline after the page loaded): the lazy loader catches it, logs a Pino error and renders nothing. Throwing would have taken the whole owner page down through its error boundary because a *closed* dialog failed to prefetch. Before this change there was no such failure point (the code came with the page), so this is noted for SA under §6 Q5.

### Tasks

- ✅ Create `components/business-os/lazyDialogs.tsx` (`LazyConfigurationDialog`, `LazySchedulingDialog`, type-only imports of the real components)
- ✅ `ConfigurationDialogProvider.tsx`: render `LazyConfigurationDialog`
- ✅ `BusinessOSHeader.tsx`: render `LazySchedulingDialog`
- ✅ `app/business-os/page.tsx`: both dialogs lazy
- ✅ `app/business-os/website/page.tsx`: lazy
- ✅ `components/business-os/WebsiteSetupWizard.tsx`: lazy (not in the requirement's list; found by the import trace)
- ✅ `app/onboarding-build/page.tsx`: lazy, plus the closed warm-up instance
- ✅ Guard `components/business-os/__tests__/lazyDialogs.guard.test.ts`: scans `app/`, `components/`, `lib/`, `hooks/` for any static value import of either dialog (mutation-checked: re-adding a static import in the header fails it)

### Files (PERF-1)

| File | Action |
|---|---|
| `components/business-os/lazyDialogs.tsx` | create |
| `components/business-os/__tests__/lazyDialogs.guard.test.ts` | create |
| `components/business-os/ConfigurationDialogProvider.tsx` | modify |
| `components/business-os/BusinessOSHeader.tsx` | modify |
| `app/business-os/page.tsx` | modify |
| `app/business-os/website/page.tsx` | modify |
| `components/business-os/WebsiteSetupWizard.tsx` | modify |
| `app/onboarding-build/page.tsx` | modify (also: 2 `console.*` → Pino, SA R1) |
| `components/business-os/ConfigurationDialog.tsx` | modify (one comment only, SA O-2) |

### §6 filter (PERF-1)

| # | Question | Answer |
|---|---|---|
| Q1 Output | Would anyone see something different? | **No.** Both dialogs are closed at first paint and drew nothing closed; they are resolved before any click can open them; same props, same component |
| Q2 Money | Would anyone's bill or balance change? | **No.** No pricing, credit or charge code touched |
| Q3 Timing | Would anything arrive later or show older data? | **No.** No schedule or freshness change. The only timing note is the settings deep-link race under AC-1.4 above (QA check) |
| Q4 Scope | Would a feature go away or get worse? | **No.** Same dialogs, same tabs, same entry points |
| Q5 Failures and records | Would errors or kept records change? | **No change to records.** One new, narrow failure point exists by construction (the chunk can fail to download after the page loaded); it is contained: logged, the dialog does not open, the page stays up. For SA to confirm |

### Metric and baseline (PERF-1)

Metric: First Load JS per route (R22 method, `next build`, deterministic). Threshold (§5A.3): down ≥ 5 % or ≥ 10 kB on the affected route, whichever is smaller. Affected routes: every `/business-os/*` page, plus `/onboarding-build`, `/scheduling`, `/payments`. Results: [Measurement](#measurement).

---

## PERF-2: phone library on demand on owner pages

### Approach

- **`components/crm/phoneLib.ts`** re-exports what an owner-side phone field needs: `PhoneInput`, the English country labels, `SearchableCountrySelect`, and `phoneFieldCountry` / `phoneFieldValue` / `applyCountryToPhone`. It is only ever loaded with a dynamic `import()`.
- **`components/crm/usePhoneLib.ts`** is a tiny module holder: `loadPhoneLib()` starts or joins one download, and `usePhoneLib()` reads the loaded module **synchronously** through `useSyncExternalStore`, starting the download on mount. Not `next/dynamic`: a lazy component first rendered when a modal opens would suspend for at least one frame even with the chunk on disk, which breaks AC-2.2. A holder has no such frame.
- **The four components** (`CRMContactModal`, `CRMContactDrawer`, `ClientDetailsSection`, `SchedulingBookingModal`) keep their JSX and comments; `SearchableCountrySelect` / `PhoneInput` become `phoneLib.SearchableCountrySelect` / `phoneLib.PhoneInput`, and while `phoneLib` is null a `PhoneFieldPlaceholder` (same classes, so same height and border, inert) holds the place.
- **The starting country is unchanged (AC-2.4).** It was `useState(() => phoneFieldCountry(formData.phone))`, which needs the library at mount. It is now `phoneSeed = formData.phone` captured at mount (a plain string) plus `chosenPhoneCountry` (undefined until the owner picks); the effective country is `chosenPhoneCountry ?? phoneFieldCountry(phoneSeed)`. Same input, same pure function, same answer; `onChange` still rewrites the number through `applyCountryToPhone`. `phoneField.ts` itself is untouched.
- **The stylesheet stays a static import** in each component, so the cascade is identical. CSS is not First Load JS.
- **Prefetch after first paint (AC-2.1).** Any mounted component that may show a phone field starts the download on mount (the dashboard's always-mounted `CRMContactModal`, the booking modal inside the warmed `SchedulingDialog`). Pages whose phone surfaces mount only on click start it themselves: `/business-os/crm` (`usePhoneLibSettled`) and `/scheduling` (`usePrefetchPhoneLib`).
- **Deep link (AC-2.3).** `/business-os/crm?contact=…` opens the drawer at load with the details section (and the phone field) expanded. The deep-link effect now also waits for the library to **settle**, so the field is drawn with the rest of the section. Settled includes a failed download, so a network error never stops the drawer opening. Because the library starts downloading at hydration and the page itself is ~50 kB lighter, the drawer should not open later than on main; QA verifies under throttling.
- **Failure:** `loadPhoneLib()` never rejects; it logs a Pino warning, resolves to null, and does not cache the failure. Retry is on interaction (SA O-1): every re-render of a host while the library is missing (the modal opening, typing) and pressing the placeholder try again, so the always-mounted modals that never remount recover without a reload.
- **AC-2.5:** `BusinessProfileSection.tsx` is not modified. It now arrives with the lazy configuration dialog (PERF-1).

### Tasks

- ✅ Create `components/crm/phoneLib.ts`, `components/crm/usePhoneLib.ts`, `components/crm/PhoneFieldPlaceholder.tsx`
- ✅ Convert `CRMContactModal.tsx`, `CRMContactDrawer.tsx`, `contact-drawer/ClientDetailsSection.tsx`, `scheduling/SchedulingBookingModal.tsx`
- ✅ `app/business-os/crm/page.tsx`: start the download; gate the `?contact=` deep link on "settled"
- ✅ `app/(protected)/scheduling/page.tsx`: start the download
- ✅ Guard `components/crm/__tests__/phoneLibLazy.guard.test.ts` (no static import of `phoneLib.ts` anywhere; the four components import no value from the library, `phoneField.ts` or `SearchableCountrySelect.tsx`; prefetch and deep-link gate present)
- ✅ Loader tests: `usePhoneLib.client.test.tsx` (placeholder → field; a component mounted after the load gets the field on its **first** render, AC-2.2; one download) and `usePhoneLib.failure.test.ts` (resolves null, logs, retries)

### Files (PERF-2)

| File | Action |
|---|---|
| `components/crm/phoneLib.ts` | create |
| `components/crm/usePhoneLib.ts` | create |
| `components/crm/PhoneFieldPlaceholder.tsx` | create |
| `components/crm/__tests__/phoneLibLazy.guard.test.ts` | create |
| `components/crm/__tests__/usePhoneLib.client.test.tsx` | create |
| `components/crm/__tests__/usePhoneLib.failure.test.ts` | create |
| `components/crm/__tests__/usePhoneLib.retry.client.test.tsx` | create (SA O-1) |
| `components/crm/CRMContactModal.tsx` | modify |
| `components/crm/CRMContactDrawer.tsx` | modify (no importers; consistency only) |
| `components/crm/contact-drawer/ClientDetailsSection.tsx` | modify |
| `components/scheduling/SchedulingBookingModal.tsx` | modify |
| `app/business-os/crm/page.tsx` | modify |
| `app/(protected)/scheduling/page.tsx` | modify |

Disjoint from PERF-1's files. **Merge order: PERF-1 first** (see Analysis Summary).

### §6 filter (PERF-2)

| # | Question | Answer |
|---|---|---|
| Q1 Output | Would anyone see something different? | **No**, once the library has arrived, which happens right after paint. Same starting country (same pure function on the same mount-time value), same stored value, same validation. The placeholder appears only if a surface is opened before the after-paint download finishes; QA checks the first open under throttling (AC-2.2) |
| Q2 Money | Would anyone's bill or balance change? | **No** |
| Q3 Timing | Would anything arrive later or show older data? | **No.** The CRM deep link waits for the library, which downloads in parallel with the contact list it already waited for |
| Q4 Scope | Would a feature go away or get worse? | **No.** `BusinessProfileSection` untouched (AC-2.5) |
| Q5 Failures and records | Would errors or kept records change? | **No change to records.** New contained failure point: the library can fail to download after the page loaded. The download starts at hydration, so only a failure in the first seconds after load is exposed. While it is missing the field shows its placeholder and is logged with Pino (devtools only). Because the phone field is required, a **new** contact cannot be saved from that surface while the placeholder shows; editing other fields and existing contacts is unaffected. Recovery needs no reload: the next interaction retries (the surface opening or re-rendering, or pressing the placeholder), including on the dashboard's `CRMContactModal` and the header's `SchedulingBookingModal`, which are mounted once and never remount (SA R2, fixed by O-1) |

### Metric and baseline (PERF-2)

Metric: First Load JS (R22 method). Threshold: down ≥ 5 % or ≥ 10 kB on the affected route. Affected routes: `/business-os/crm`, `/business-os`, `/scheduling` (and every BOS page through the dialogs, once PERF-1 is in). Results: [Measurement](#measurement).

---

## PERF-3: public booking widget

**Not implemented: the target is not served by any route.**

- `app/site/[subdomain]/book/BookingWidget.tsx` (the file named in PC-3 and the brief) **has no importers anywhere** in `app/`, `components/` or `lib/`. `app/site/[subdomain]/book/page.tsx` renders `PublicBookingPage` → `StandaloneBookingWidget` → `BookingModal` → `ProcessFlowSection`, whose details step uses a plain `<input type="tel">` with no phone library.
- The baseline build confirms it: the First Load chunks of `/site/[subdomain]/book` contain **no** phone-library code (marker `PhoneInputCountry`: 0 chunks), while `/site/[subdomain]` does (2 chunks, from `ContactFormBlock`, which is BIZ-7 and out of scope).
- Changing a dead file cannot move any route's First Load JS, so under §8 ("no measured gain, no merge") there is nothing to ship. The file was left untouched.
- **For the TL / BA:** PC-3's evidence line ("book pages 207 kB, −50 kB gz") rested on this file. The phone library that remains on public pages is `ContactFormBlock` on `/site/[subdomain]`, `/[slug]` and the contact pages, which is exactly the BIZ-7 item. If PERF-3's slot is to be reused, that is the candidate, and it needs the BA's call because that field is visible at first paint. Separately, the dead `BookingWidget.tsx` (1,558 lines, 11 `console.*` calls) could be deleted in a cleanup slice.

§6 filter (PERF-3): not applicable, nothing changed.

---

## Measurement

Method (same as R22): `next build` (Next 14.2.35), route table "First Load JS". A dev server was running in the main checkout, so every build ran in a scratch copy (`git archive HEAD` plus the slice files, `node_modules` junctioned to the main checkout, `.env.local` copied in and deleted afterwards).

- **Before:** `HEAD` = `468845cc` (fresh baseline, same machine and method; R22 itself was taken on `f99249b3`, so its absolute numbers are older).
- **After PERF-1:** `HEAD` + PERF-1 files only.
- **After PERF-1 + PERF-2:** `HEAD` + both slices.

### Route table, First Load JS (the R22 metric)

| Route | R22 (`f99249b3`) | Before (`468845cc`) | After PERF-1 | After PERF-1 + PERF-2 | PERF-1 effect | PERF-2 effect | Clears §5A.3? |
|---|---|---|---|---|---|---|---|
| `/business-os` | 651 kB | 663 kB | 520 kB | **472 kB** | −143 kB (−21.6 %) | −48 kB (−9.2 %) | yes, both |
| `/business-os/crm` | 655 kB | 670 kB | 561 kB | **512 kB** | −109 kB (−16.3 %) | −49 kB (−8.7 %) | yes, both |
| `/business-os/website` | 658 kB | 668 kB | 531 kB | **531 kB** | −137 kB (−20.5 %) | 0 | PERF-1 yes |
| `/business-os/orders` | 556 kB | 572 kB | 393 kB | **393 kB** | −179 kB (−31.3 %) | 0 | PERF-1 yes |
| `/business-os/settings` | 542 kB | 552 kB | 387 kB | **387 kB** | −165 kB (−29.9 %) | 0 | PERF-1 yes |
| `/scheduling` | 554 kB | 564 kB | 452 kB | **403 kB** | −112 kB (−19.9 %) | −49 kB (−10.8 %) | yes, both |
| `/payments` | 547 kB | 558 kB | 381 kB | **381 kB** | −177 kB (−31.7 %) | 0 | PERF-1 yes |
| `/onboarding-build` | 549 kB | 559 kB | 450 kB | **450 kB** | −109 kB (−19.5 %) | 0 | PERF-1 yes |
| `/business-os/reports` | — | 342 kB | 343 kB | 343 kB | +0.8 kB (see note) | 0 | see layout row below |
| `/business-os/email-automation` | — | 97 kB | 97.8 kB | 97.8 kB | +0.8 kB (see note) | 0 | see layout row below |
| `/site/[subdomain]/book` (PERF-3) | 207 kB | 160 kB | 161 kB | 161 kB | +0.8 kB | 0 | n/a, nothing to remove |
| `/site/[subdomain]` | 285 kB | 285 kB | 286 kB | 286 kB | +0.8 kB | 0 | n/a |
| Shared by all | 87.8 kB | 87.9 kB | 88.7 kB | 88.7 kB | +0.8 kB | 0 | regression, below every threshold |

### What a Business OS page actually downloads up front

Next's route table does not count a segment layout's own chunks, which is why `/business-os/reports` and `/business-os/email-automation` look unaffected above even though they sit under the layout that carried both dialogs. This table sums the gzipped JS of the root layout + the `/business-os` layout + the page, from `app-build-manifest.json` (gzip level 9, so a few kB off Next's own figures):

| Entry | Before | After PERF-1 | After PERF-1 + PERF-2 |
|---|---|---|---|
| `/business-os` layout alone | 588.3 kB | 350.8 kB | 350.8 kB |
| `/business-os` | 698.7 kB | 556.1 kB | 507.8 kB |
| `/business-os/crm` | 718.7 kB | 605.3 kB | 556.8 kB |
| `/business-os/reports` | 609.6 kB | 385.0 kB | 384.9 kB |
| `/business-os/email-automation` | 597.4 kB | 359.9 kB | 359.9 kB |
| `/(protected)/scheduling` | 584.7 kB | 478.3 kB | 429.8 kB |

So every Business OS page sheds about 225–240 kB of up-front JS, the layout alone 237 kB.

### Notes on the numbers

- **Phone library gone from first loads:** the libphonenumber metadata marker (`country_calling_codes`) appears in the First Load chunks of `/business-os`, `/crm`, `/scheduling`, `/settings`, `/website`, `/orders`, `/onboarding-build` and the layout before, and in **none** of them after PERF-1 + PERF-2. After PERF-1 alone it is still on `/business-os`, `/crm` and `/scheduling` (the modals), which is exactly what PERF-2 removes. It stays on `/site/[subdomain]` (`ContactFormBlock`, BIZ-7).
- **The +0.8 kB on every route** is webpack's runtime gaining its CSS-chunk loader (4.3 → 6.2 kB raw, 2.1 → 2.9 kB gz): the dialog chunk is the first lazily loaded chunk that carries a stylesheet (`react-phone-number-input/style.css`, via `BusinessProfileSection` and `SchedulingBookingModal`). It is the inherent cost of the split, it comes from PERF-1, and it is below every §5A.3 threshold. It is called out because it touches routes outside the slices, including public pages.
- **Cascade check for that stylesheet:** on pages where it now arrives with the dialog chunk instead of the page, it lands later in the cascade. Every product override of it (`.phone-input-settings …`, `.phone-input-crm …`, `.phone-input-scheduling …`) has higher specificity than the library's single-class rules, or sets the same value (`.phone-input-settings { display: flex }` vs `.PhoneInput { display: flex }`), so the order does not change what is drawn. QA's visual check covers it.
- **R22 vs the fresh baseline:** the R22 figures are 10–16 kB lower because main moved between `f99249b3` and `468845cc`. The before/after comparison uses the fresh baseline so both sides come from the same commit, machine and method.

---

## Verification

| Check | Result |
|---|---|
| Type check | `tsc --noEmit -p .` on the whole repo runs out of memory locally (the repo carries thousands of pre-existing errors; CI uses scoped checks). Ran a scoped `tsc` over every touched file and its import closure, before (HEAD copy) and after: **identical error sets, zero new errors** (42 pre-existing in both, none on a changed line) |
| New tests | `lazyDialogs.guard` 11/11, `phoneLibLazy.guard` 13/13, `usePhoneLib.client` 4/4, `usePhoneLib.failure` 2/2 |
| Related suites | `components/crm`, `components/scheduling`, `components/business-os`, `app/business-os`, `app/onboarding-build`, `app/(protected)/scheduling`, `app/site`, `components/website`, `components/public`: 77 suites, 1,210 passed, 1 failed. The failure is `contact-drawer/__tests__/bookingsSearchAndPaging.guard.test.ts`, which reads `BookingsTab.tsx` (not touched) and matches a multi-line string that this Windows checkout holds with CRLF endings; pre-existing and environment-specific |
| `phoneField.test.ts`, `SchedulingBookingModal.client.test.tsx` | pass unchanged (6 suites, 54 tests together with the new ones) |
| Bundle | three `next build` runs, see [Measurement](#measurement); every affected route clears the §5A.3 threshold for its slice |

---

## New patterns for SA review

1. **Shared `next/dynamic` module for dialogs** (`components/business-os/lazyDialogs.tsx`). `next/dynamic` itself is already used (`components/PlatformChrome.tsx`). New are: one shared `dynamic()` per dialog so the layout's closed instance warms every site, `ssr: false`, and a loader that catches a chunk failure and renders nothing instead of throwing.
2. **Module holder for a lazily loaded library** (`components/crm/usePhoneLib.ts`): `import()` + module-level cache + `useSyncExternalStore`, chosen over `next/dynamic` so a field first rendered on open does not suspend for a frame. No existing utility does this (searched for `requestIdleCallback`, `prefetch`, `preload`). It is phone-specific on purpose; it was not generalised because PERF-3 turned out to have no consumer for it.
3. **Closed warm-up instance** on `/onboarding-build`, the same idea the provider already used, written down.

---

## Flags for the user

**`console.*` in touched files: converted to `createLogger` after SA R1** (see "Dev fixes after review"):

| File | `console.*` calls | Slice |
|---|---|---|
| `components/crm/CRMContactDrawer.tsx` | 20 → 0 (the file has no importers) | PERF-2 |
| `components/crm/CRMContactModal.tsx` | 3 → 0 | PERF-2 |
| `app/(protected)/scheduling/page.tsx` | 3 → 0 | PERF-2 |
| `app/onboarding-build/page.tsx` | 2 → 0 | PERF-1 |
| `app/business-os/website/page.tsx` | 0 (the earlier "1" was a comment at `:2583`; corrected) | — |

New code logs through `createLogger` only.

**Master doc:** §0 and §11.3 of the scoping doc are not updated by this change: the PERF-3 finding changes the plan, so the TL should decide the wording.

---

## SA Review Notes

**Code Review by SA — 2026-10-13**
**Status:** 🔄 APPROVED WITH CHANGES. Code approved for QA now. RM is blocked until R1 and R2 below are done.

Scope reviewed: `git diff -- app components` (12 files) and the 8 new files. Short path, so this is the only SA pass.

### What SA checked itself

| Check | Result |
|---|---|
| Static value imports of `ConfigurationDialog` / `SchedulingDialog` | **None left.** The only references are the `import type` and the dynamic `import()` in `lazyDialogs.tsx` (grep of `app components lib hooks`) |
| `react-phone-number-input` value importers | Left: `phoneField.ts`, `SearchableCountrySelect.tsx`, `phoneLib.ts` (dynamic only), `BusinessProfileSection.tsx` (intended), plus the out-of-scope `ContactFormBlock` / `WebsiteCountrySelect` (BIZ-7), dead `BookingWidget.tsx`, and locale-label JSON in `lib/geo/countries.ts`. The four converted components keep only `import type { Country }` and the stylesheet. A transitive trace of the static graph from `app/business-os/layout.tsx`, `/business-os`, `/business-os/crm` and `/scheduling` finds no value import of the library |
| `ssr: false` | **Correct.** Read `next@14.2.35` `lazy-dynamic/loadable.js`: one `React.lazy` per `dynamic()` call, so the result is cached per module and the "shared warm-up" claim holds. `ssr: true` would SSR the dialogs and pull their client chunks into the hydration set, which defeats the slice. Both dialogs render nothing while closed (`ConfigurationDialog.tsx:594`; `SchedulingDialog` is a closed Radix root), so the server output does not change. The default `loading` renders `null`, so there is never a spinner |
| Hook rules | `npm run lint:hooks`: clean. `usePhoneLib*` is called unconditionally in all six call sites |
| Tests | The 4 new suites plus `phoneField.test.ts`: 5/5 suites, 50/50 tests |
| Starting country (AC-2.4) | **Identical.** The old code was `useState(() => phoneFieldCountry(formData.phone))`, with no `businessCountry` argument and only set again from the country picker. The new code is `chosen ?? phoneFieldCountry(phoneSeed)`, with `phoneSeed` captured by a mount-time initialiser. Same pure function, same mount-time input, same picker override. No other `setPhoneCountry` call existed. `undefined` only happens while the library is null, and the field is not rendered then |
| `?contact=` deep link (AC-2.3) | **Correct, and never blocked by a failure.** `settled` = `loaded \|\| failed`. Both URL-clearing paths (`router.replace` on the in-list path, and `finally` in `fetchContactById`) clear the param, so a later status flip (a retry started by the drawer's own `usePhoneLib`) cannot reopen the drawer. One residual point: on a stalled network the wait is bounded only by webpack's chunk timeout. That is acceptable, see O-3 |
| `/onboarding-build` warm-up | Safe. Every `ConfigurationDialog` effect with side effects is gated on `isOpen` (`:116`, `:184-218`). The closed branch only resets local state. `useAuth` / `useLanguage` were already required by the on-click instances |
| Prefetch coverage (AC-1.1 / AC-2.1) | The header's closed `SchedulingDialog` always mounts `SchedulingBookingModal` (`SchedulingDialog.tsx:784`, a sibling inside the Radix root), so every BOS page starts the phone download after paint. `/business-os/crm` and `/scheduling` start it themselves |
| AC-2.5 | `BusinessProfileSection.tsx` is unchanged. **Note for TL/BA:** its only importer is `ConfigurationDialog.tsx:14`, so the requirement's premise that the settings page shows the field at first paint does not hold. It arrives with the lazy dialog and draws in the same frame as the dialog, so AC-2.5 holds in substance |
| PERF-3 | **Confirmed nothing to ship.** `app/site/[subdomain]/book/BookingWidget.tsx` has no importers. `book/page.tsx` imports `PublicBookingPage` / `StandaloneBookingWidget`, and the trace finds no value import of the library on that route, only the country-name JSON from `lib/geo/countries.ts` (not libphonenumber, and not PC-3's item) |
| +0.8 kB on every route | **Accepted.** It is webpack's CSS-chunk loader, a structural, one-time cost of the first lazily loaded chunk that carries CSS. It is below every §5A.3 threshold and a small fraction of the 109-179 kB removed per affected route. Do not try to engineer it away |
| Pino in client code | `createLogger` in the browser is Pino's browser build (`lib/logger.ts`, `browser.asObject`). It writes to the devtools console at `info` and above in production, and nothing is shipped to the server. `@/lib/logger/client` is only a re-export of the same instance. `createLogger({ module })` in `'use client'` files is the established BOS convention (59 files, including `crm/page.tsx` and `SchedulingBookingModal.tsx`), so the new code complies. Consequence: the chunk-failure logs are visible only to the owner's own devtools, not to operators (fine for Q5, stated so nobody assumes otherwise) |

### Rule 7: rulings on the three new patterns

1. **Shared `next/dynamic` module with log-and-render-null on chunk failure: APPROVED.** The shared module is required for correctness: the warm-up only works because there is one `React.lazy` per dialog. Conditions: (a) `components/business-os/lazyDialogs.tsx` is the single home, and any new site renders `Lazy*` from it (the guard enforces this); (b) it is understood that `React.lazy` caches the `renderNothing` fallback for the page's lifetime, so after a failure that dialog's entry points do nothing until reload. That is acceptable because the fetch starts at hydration, so the failure window is seconds, not the session. Not to be copied as a generic "lazy anything" helper without SA review.
2. **Module-cached `usePhoneLib` with synchronous reads: APPROVED, phone-specific.** `useSyncExternalStore` with a `null` / `'idle'` server snapshot is the correct hydration-safe shape, and the reasoning against `next/dynamic` (the one-frame suspend on first render) is sound. Do not generalise it into a shared utility without SA review.
3. **Closed warm-up instance on `/onboarding-build`: APPROVED.** It relies on the invariant the provider already relies on: a closed `ConfigurationDialog` has no side effects. See O-2.

### Code Review Comments

1. **R1 (required, before RM): `console.*` in touched files.** CLAUDE.md § Logging and the SA checklist: a touched file may not stay non-compliant unless the user explicitly declines. Actual counts (SA re-counted): `components/crm/CRMContactDrawer.tsx` 20, `components/crm/CRMContactModal.tsx` 3, `app/(protected)/scheduling/page.tsx` 3, `app/onboarding-build/page.tsx` 2. `app/business-os/website/page.tsx` has **0** real calls (the "1" in *Flags for the user* is a comment at `:2583`; correct the table). Do one of these per file: convert to `createLogger` (errors as `{ err }`), or record the user's explicit decline in this workplan. For `CRMContactDrawer.tsx`, which has no importers, it is acceptable for the user to choose a deletion slice instead of converting dead code; record that choice. The conversions go into the slice that owns the file (PERF-1: `onboarding-build`; PERF-2: the other three). Priority: High (process gate)
2. **R2 (required, doc-only): §6 Q5 for PERF-2 overstates recovery.** "Retried on the next mount; the rest of the form keeps working" is not true for the **always-mounted** instances: the dashboard's `CRMContactModal` and the `SchedulingBookingModal` inside the header's `SchedulingDialog` never remount. After a failed download they keep the placeholder until reload. The phone field is required (`CRMContactModal.tsx:587` disables Save while `!formData.phone`), so on that page a **new** contact cannot be saved until reload (editing an existing contact still works). Reword Q5 to say this and the actual exposure (the fetch starts at hydration, so only a failure in the first seconds after load triggers it). No code change is required. If the Dev prefers, O-1 removes the issue. Priority: Medium

### Optimisation Suggestions (non-blocking)

- **O-1:** retry on interaction instead of only on mount. For example, have `usePhoneLib` call `loadPhoneLib()` from an effect without the `[]` deps while the library is `null`. `loadPhoneLib` already dedupes in-flight loads and does not cache failures, and the hook does not re-render on status changes, so this retries only when the host re-renders (open, typing). That closes R2's dead end for the always-mounted modals.
- **O-2:** add a one-line comment at `ConfigurationDialog`'s effects block: "closed instances are mounted as warm-ups (provider, `/onboarding-build`): keep every side effect gated on `isOpen`". That way the invariant behind patterns 1 and 3 is stated where it could be broken.
- **O-3:** the CRM deep link could open anyway after a short cap (for example 1.5 s) if the library has not settled, so a stalled chunk cannot delay the drawer by up to webpack's 120 s timeout. QA's AC-2.3 throttled check decides whether this is needed.
- **O-4:** `PhoneFieldPlaceholder` stands in for the input only. The country picker beside it is absent while loading, so the row's internal layout shifts when the library arrives. This is only visible in the pre-load window, so it is cosmetic.

### Slice split (for RM)

- File sets are **disjoint**. SA checked both lists against the diff: PERF-1 = 8 files plus this workplan; PERF-2 = the 12 listed files. Each slice compiles and passes its own guard without the other. Both guards scan the whole tree but only assert their own slice's files.
- **Merge order: PERF-1 first.** This is for the evidence, not correctness: on BOS pages the library also rides in through the dialogs, so PERF-2 alone shows no First Load gain (§8).
- **How to cut it:** two branches, **both from `origin/main`** (no stacked PR, see the stacked-PR hazard). `feature/perf-1-lazy-dialogs`: the 8 PERF-1 files, this workplan and R1's `onboarding-build` change. `feature/perf-2-lazy-phone-lib`: the 12 PERF-2 files and R1's changes to those files. Open the PERF-2 PR after PERF-1 merges, then update it from main (strict up-to-date is required anyway).
- Stage **by explicit path only**. The main checkout also holds unrelated work (`.claude/settings.local.json`, `zz.probe.test.tsx`, `lib/audit/__tests__/__probe.test.ts`, other docs) that must not be swept in. No `git add -A` and no `git stash`.

### Code Approved for QA: Yes. RM may proceed once R1 and R2 are closed (SA re-check of R1 is a diff glance, no new pass needed)

---

## QA Testing Report

**QA — 2026-10-13**
**Test mode:** full (PERF-1 and PERF-2; PERF-3 has no code)
**Strategy used:** A (Jest: new guards, loader tests, related suites), A+ (a temporary equivalence test of the old and new phone paths with the real library, deleted afterwards), guard mutation probes, and a review of the Dev's bundle figures. D (throttled browser checks) is **not yet done**; it is listed below for the main session.
**Focus:** ui, performance
**Skipped:** the rebuild (the Dev's `next build` figures were reviewed, not reproduced, per the brief); browser checks (handed to the main session)
**Input source:** TL prompt

### Test Coverage

| Acceptance criterion | Status | Evidence |
|---|---|---|
| AC-1.1 both chunks prefetched after first paint, no click | ⚠️ Logic level only; **needs a browser check (M1)** | Every site renders a closed `next/dynamic(…, { ssr: false })` instance, which requests its chunk on client mount. The layout's provider and header mount on every `/business-os/*` page; `/onboarding-build` has its own closed warm-up instance. The guard pins all of it |
| AC-1.2 first open identical under throttling | ❌ Not verifiable in Jest; **needs a browser check (M2)** | Logic: one shared `dynamic()` per dialog, so the layout's instance resolves it for every site. `ConfigurationDialog` returns `null` while closed (`:594`) and `SchedulingDialog` is a Radix `Dialog open={isOpen}`, so a closed lazy instance draws nothing, the same as before |
| AC-1.3 My Day chat dialog and onboarding-build dialogs on first open | ⚠️ Logic level only; **needs a browser check (M3)** | The diff swaps the component name only; every prop (`initialTab`, `visibleTabs`, service prefill, `onClose`) is unchanged |
| AC-1.4 open-at-load paths stay eager or look identical | ⚠️ Logic level only; **needs a browser check (M4)** | Grep of every `openConfiguration(` / `setIsConfigOpen(true)` / `setIsSchedulingDialogOpen(true)`: all are click- or chat-driven except `app/business-os/settings/page.tsx:157` (`?section=business|invoice`), which opens after the settings data loads. That is the race the Dev flagged |
| AC-1.5 close behaviour unchanged | ⚠️ Logic level only; **needs a browser check (M5)** | `ConfigurationDialogProvider` changes only the rendered component; `handleClose`, the capability refresh and the closing grace are untouched; `next/dynamic` passes props through |
| AC-2.1 phone library prefetched after first paint | ⚠️ Logic level only; **needs a browser check (M6)** | `usePhoneLib` / `usePhoneLibSettled` / `usePrefetchPhoneLib` start `loadPhoneLib()` in a mount effect. `usePhoneLib.client.test` proves one download per page. The guard pins the prefetch on `/business-os/crm` and `/scheduling` |
| AC-2.2 field drawn in the same frame on first open | ✅ Verified at loader level; **frame-level check in the browser (M7)** | `usePhoneLib.client.test`: a component mounted after the load sees the library on its **first** render (`renders[0] === true`), with no placeholder render in between |
| AC-2.3 deep link opens with the field drawn | ⚠️ Logic level only; **needs a browser check (M8)** | `?contact=` effect is gated on `phoneLibSettled` (pinned by the guard). Settled includes a failure (`usePhoneLib.failure.test`), so the drawer can never be blocked. `?task=` opens on the tasks tab, where the details section is not shown |
| AC-2.4 stored value and validation identical for 5 inputs | ✅ **Verified** (unit level, real library) | See "AC-2.4 equivalence run" below: 26/26 identical. Validation on these surfaces is "required" only (`!formData.phone` disables submit), and the stored value is whatever the same `PhoneInput` emits |
| AC-2.5 `BusinessProfileSection` unchanged | ✅ **Verified** (code); business-tab use in M10 | `git diff --quiet HEAD -- components/business-os/settings/BusinessProfileSection.tsx` → exit 0; it still imports `react-phone-number-input` statically (`:53-56`) |
| PERF-3 nothing to ship | ✅ Finding accepted | Not re-traced by QA beyond reading the Dev's analysis; no code changed |
| Bundle gain clears §5A.3 | ✅ **Verified** (review of the Dev's figures, arithmetic re-checked) | See "Bundle review" below |

### Tests run

| Run | Result |
|---|---|
| `npx jest components/business-os/__tests__/lazyDialogs.guard.test.ts components/crm/__tests__` | 8 suites, **102/102 pass** |
| The four new suites alone, twice | 30/30 pass both times (`lazyDialogs.guard` 11, `phoneLibLazy.guard` 13, `usePhoneLib.client` 4, `usePhoneLib.failure` 2), no open-handle warning |
| Related suites: `components/crm components/scheduling components/business-os app/business-os app/onboarding-build app/(protected)/scheduling app/site components/website components/public` | 77 suites, **1,210 pass, 1 fail**, the same as the Dev's numbers |
| The one failure, `contact-drawer/__tests__/bookingsSearchAndPaging.guard.test.ts` › "searches the status word the owner can actually see" | **Pre-existing and unrelated; confirmed.** `BookingsTab.tsx` is identical to HEAD (`git diff --quiet HEAD` exit 0). The assertion looks for `'one.booking.start_time\n      ).text;'` with a bare `\n`. The committed blob (`git show HEAD:…`, 0 CR) contains it → would pass; this checkout's working copy (`core.autocrlf=true`, 4,647 CR) does not → fails. Checked without `git stash` and without touching the file. Linux CI checks out LF, so it is a Windows-checkout-only failure of an existing test |
| "A worker process has failed to exit gracefully" (seen once in the `components/crm/__tests__` run) | Not caused by the new tests: absent when they run alone |

### Guard mutation probes (each file backed up byte-exact, restored, `sha256sum -c` OK)

| Probe | Guard result |
|---|---|
| `ConfigurationDialogProvider.tsx` + `import { ConfigurationDialog as __Probe } from '@/components/business-os/ConfigurationDialog'` | `lazyDialogs.guard` **fails**: offender listed |
| `WebsiteSetupWizard.tsx` + `import { SchedulingDialog as __Probe2 } from './SchedulingDialog'` (relative specifier) | `lazyDialogs.guard` **fails**: offender listed |
| `CRMContactModal.tsx` + `import PhoneInput from 'react-phone-number-input'` | `phoneLibLazy.guard` **fails** |
| `app/business-os/crm/page.tsx` + `import { PhoneInput as __P } from '@/components/crm/phoneLib'` | `phoneLibLazy.guard` **fails** ("nothing statically imports phoneLib") |
| `SchedulingBookingModal.tsx` + `import { phoneFieldCountry as __pf } from '@/components/crm/phoneField'` (the long way round) | `phoneLibLazy.guard` **fails** |

After restoring: `git diff --stat` is identical to the starting state (13 files, +182/−78), with no probe text in the diff, and both guards pass 24/24.

### AC-2.4 equivalence run

A temporary Jest file (deleted after the run) rendered two harnesses side by side with the **real** `react-phone-number-input`. One copied the old code path exactly (static `phoneField` imports, `useState(() => phoneFieldCountry(formData.phone))`); the other copied the new path (`usePhoneLib`, `phoneSeed`, `chosenPhoneCountry ?? phoneLib.phoneFieldCountry(phoneSeed)`). For each input it compared the starting country, the value passed to `PhoneInput`, the text in the `<input>`, the stored value after a country pick (GB, IL, US), the stored value after typing, and `isValidPhoneNumber` of the stored value. It also asserted that `phoneLib` re-exports **the same function objects** as `phoneField.ts` and the same `PhoneInput`.

| Input | Starting country | Display | Pick GB → stored | Pick IL → stored | Pick US → stored |
|---|---|---|---|---|---|
| IL `+972501234567` | IL | `+972 50 123 4567` | `+44501234567` (invalid) | `+972501234567` (valid) | `+1501234567` (invalid) |
| US `+12015550123` | US | `+1 201 555 0123` | `+442015550123` (valid) | `+97212015550123` (valid) | `+12015550123` (valid) |
| UK `+447911123456` | GG | `+44 7911 123456` | `+447911123456` (valid) | `+9727911123456` (invalid) | `+17911123456` (invalid) |
| invalid `12345` | US | `+1 1 234 5` | `+4412345` | `+97212345` | `+112345` |
| empty `''` | US | `` | `''` | `''` | `''` |

**Old = new in every cell: 26/26 tests pass.** Some cells look surprising (UK starts on `GG`; US switched to IL gives `+97212015550123`), but they are identical on both paths, so this is how `phoneField.ts` behaves on main, not a change from this slice.

What the seed actually is: in `CRMContactModal` and `SchedulingBookingModal`, `formData` starts as the literal `''`, and the contact or booking is copied in later by an effect. So both the old initialiser and the new `phoneSeed` always read `''`, and the starting country is `'US'` on both main and this branch. Only `ClientDetailsSection` (where `formData` is a prop) seeds from the real number. Equivalent either way; see Edge Case 1.

### Bundle review (§5A.3: down ≥ 5 % or ≥ 10 kB per affected route, whichever is smaller)

Re-checked the Dev's deltas and percentages from the table in [Measurement](#measurement). Every one is arithmetically correct.

| Route | PERF-1 | PERF-2 (on top of PERF-1) | Clears? |
|---|---|---|---|
| `/business-os` | −143 kB (−21.6 %) | −48 kB (−9.2 %) | both |
| `/business-os/crm` | −109 kB (−16.3 %) | −49 kB (−8.7 %) | both |
| `/scheduling` | −112 kB (−19.9 %) | −49 kB (−10.8 %) | both |
| `/business-os/website`, `/orders`, `/settings`, `/payments`, `/onboarding-build` | −109 to −179 kB (−19.5 to −31.7 %) | 0 (not a PERF-2 route) | PERF-1 |
| Layout-only pages (`/reports`, `/email-automation`) | not visible in Next's route table; the Dev's manifest sum shows the layout −237 kB gz | 0 | PERF-1 (by the manifest method, not R22's table) |
| Shared by all | **+0.8 kB** (webpack CSS-chunk loader) | 0 | A regression, below every threshold; accepted as the cost of the split |

Notes: (a) PERF-2's gain was measured **on top of** PERF-1; the Dev states PERF-2 alone removes nothing. RM must merge PERF-1 first, and PERF-2 must not merge without it. (b) The gains are 2–3× the requirement's estimate (~61 kB), because `SchedulingDialog` and the phone library came along. That is plausible, since the libphonenumber marker disappears from every first-load chunk set. QA did not rebuild.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The +0.8 kB shared runtime is documented and below threshold.

#### Edge Cases (nice to fix, or for SA to rule on)
1. **Pre-existing, not a regression: the starting country is always `US` in `CRMContactModal` and `SchedulingBookingModal`.** The "seeded from the number itself" comments are not true for these two: `formData.phone` is `''` at mount, and the contact's number is copied in after mount by an effect. An Israeli contact therefore opens on `US` (the display still shows `+972 …` because the value carries its `+`). PERF-2 keeps this exactly as it was, as AC-2.4 requires. Fixing it changes visible behaviour, so it belongs in its own slice. Files: `components/crm/CRMContactModal.tsx:75`, `components/scheduling/SchedulingBookingModal.tsx:610`. Severity: Low.
2. **A dialog chunk that fails once stays dead for that page view.** `lazyDialogs.tsx` resolves a failed `import()` to `renderNothing`, and `next/dynamic` caches that result. After a network blip at hydration (mobile, flaky Wi-Fi), every Configuration or Calendar button on that page silently does nothing until the page is reloaded: no message, no retry. The phone loader, by contrast, retries on the next mount. Contained (the page stays up, a Pino error is logged), but it is a new silent failure mode. SA to rule under §6 Q5: accept, or retry on the next open, or show a "reload" hint. Severity: Low–Medium.
3. **`phoneLibLazy.guard` only checks the four converted components** for direct library imports, plus the whole tree for `phoneLib.ts`. A new owner-page component that imports `react-phone-number-input` statically would put the library back without failing any test; only a `next build` comparison would show it. Severity: Low.
4. **Housekeeping for RM:** (a) two untracked probe tests that are not part of this slice sit in the checkout (`app/admin/audit-trail/__tests__/zz.probe.test.tsx`, `lib/audit/__tests__/__probe.test.ts`). They predate this QA run and must not be swept into either PERF commit. (b) Four PERF-1 files are LF in this CRLF checkout (`app/business-os/page.tsx`, `app/business-os/website/page.tsx`, `app/onboarding-build/page.tsx`, `components/business-os/WebsiteSetupWizard.tsx`); git normalises them on commit, and the diff is small, so there is no effect.

### Manual browser checks still owed (main session, in-app browser)

**Setup.** Prefer a production build (`next build && next start`) or a Vercel preview. Under `next dev`, the first request for a lazy chunk triggers compilation, which can fake a slow first open. Disable the cache. Throttle to "Fast 3G" (newer Chrome calls it "3G"). If the in-app browser cannot throttle, run the checks unthrottled and say so in the result. To list lazy chunks without DevTools, run this in the console after load:
`performance.getEntriesByType('resource').filter(e => /ConfigurationDialog|SchedulingDialog|phoneLib|react-phone/i.test(e.name)).map(e => [e.name.split('/').pop(), Math.round(e.startTime)])`
(dev chunk names contain the source path; in a production build, use the Network panel's initiator column instead). Compare looks against production (main).

| # | AC | Page and steps | Pass if |
|---|---|---|---|
| M1 | AC-1.1 | Load `/business-os/reports` (layout only) and `/business-os`; do not click | The `ConfigurationDialog` and `SchedulingDialog` chunks are requested **after** the page chunks, with no click |
| M2 | AC-1.2 | Throttled, cache off, on `/business-os/crm`: wait until the network is idle, then (a) the tab bar's configuration button, (b) the header calendar button, (c) on `/business-os` My Day, a readiness or setup chip (e.g. availability) | Each dialog appears in its first frame, fully drawn: no spinner, no blank or partial frame, the same open animation and the same starting tab as on production. Also, once: click the header calendar **immediately** after paint, before the chunk has arrived. The click must not be lost (the dialog opens when the chunk lands) and nothing must error |
| M3 | AC-1.3 | `/business-os` My Day chat: a request that opens the service dialog in create mode with a name and price, then one that opens availability. `/onboarding-build`: click the Availability step, then the Intake step | Each opens on first try with one tab only and the prefill in place. On save, exactly **one** POST in the Network panel. Close returns to the same screen |
| M4 | AC-1.4 | Throttled, cache off: `/business-os/settings?section=business`, then `?section=invoice` | The dialog opens on the right tab, fully drawn. Record whether it appears noticeably later than on production; any spinner or empty frame is a fail |
| M5 | AC-1.5 | (a) From the tab bar, open Configuration, change availability, close: the readiness chips or capabilities update without a reload. (b) Close with X, with Esc, and with an outside click: closes once. (c) `/scheduling` → open a booking → its configure link (opens Configuration over the booking modal) → close Configuration: the booking modal stays open. (d) `/payments` → InvoiceModal → open invoice settings → close: InvoiceModal stays | All as on production |
| M6 | AC-2.1 | Load `/business-os`, `/business-os/crm`, `/scheduling`; no click | The phone-library chunk (`phoneLib` / `react-phone-number-input`) is requested after load, once per page |
| M7 | AC-2.2 | Throttled, cache off, after the network is idle: `/business-os/crm` → Add contact; `/business-os/crm` → open a contact → expand Details; `/scheduling` → new booking; header calendar → new booking; My Day chat → open contact dialog | The flag selector and phone input are drawn in the **same frame** as the name and email fields: no grey disabled box first. Then once, open Add contact immediately after paint: a grey inert box of the same height may show, must not shift the layout when the field arrives, and the field must work once it arrives |
| M8 | AC-2.3 | Throttled, cache off: `/business-os/crm?contact=<id of a contact with a phone>`, and with `&section=details` | The drawer opens with the phone field already drawn (no placeholder flash), not noticeably later than on production. `?task=<id>` still opens on the tasks tab |
| M9 | AC-2.4 (spot check) | Edit an Israeli contact: change the country to US, then back to IL, and save. Reopen it | The stored number matches what production produces for the same steps (the logic-level run already proves equality) |
| M10 | AC-2.5 | `/business-os/settings` → business tab (inside the Configuration dialog): change the phone country, type, and save | Works as on production |
| M11 | Cascade | Light and dark mode: the phone field on the contact modal, the drawer details, the booking modal, and the settings business tab | Flag size, border, focus ring and spacing identical to production (the phone stylesheet now arrives with the dialog chunk on some pages) |
| M12 | Failure (Q5) | (a) `/business-os/crm`: after load, block the phone chunk (DevTools request blocking, or go offline before it arrives) → Add contact. (b) Block the `ConfigurationDialog` chunk → click the configuration button | (a) Grey placeholder, the rest of the form usable, no crash; unblock → close and reopen → the field appears (retry). (b) The page stays up and the click does nothing (Edge Case 2): record this for the SA ruling |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Automated checks pass, and no bugs were found. **Not yet ready for commit:** AC-1.1–1.5, AC-2.1–2.3 and the visual checks still need the manual throttled checks M1–M12 above. AC-2.4 and AC-2.5 are verified, and the bundle gains clear §5A.3. Edge Case 2 needs an SA ruling

---

## Dev fixes after review

- **R1 (done):** all 28 `console.error` calls in the four touched files are now `logger.error({ err }, '<message>')`, with a module-scoped `createLogger({ module })` per file (`CRMContactModal`, `CRMContactDrawer`, `SchedulingPage`, `OnboardingBuildPage`). Context first, errors as `{ err }`. `onboarding-build` stays in PERF-1; the other three stay in PERF-2. The flag table above is corrected (`website/page.tsx` has 0).
- **R2 via O-1 (done):** `usePhoneLib` now retries on every host re-render while the library is missing (an effect with no dependency list; `loadPhoneLib` dedupes in-flight loads and does not cache failures, and a failure only changes `status`, which the hook does not read, so no loop). `PhoneFieldPlaceholder` retries on pointer-down. New test `usePhoneLib.retry.client.test.tsx`: one mounted host that fails, retries on press, does **not** retry by itself, then recovers on a re-render without remounting. The §6 Q5 answer for PERF-2 now describes this, plus the exposure (new contacts cannot be saved while the placeholder shows).
- **O-2 (done):** one-line comment above `ConfigurationDialog`'s first effect: closed instances are mounted as warm-ups, so every side effect must stay gated on `isOpen`. This adds `ConfigurationDialog.tsx` to PERF-1's file list.
- **Not done (not asked):** O-3 (deep-link cap) and O-4 (placeholder without the country picker) are left for QA's throttled checks to decide. QA Edge Case 2 (a failed dialog chunk stays dead for the page view) is still awaiting the SA ruling.
- **Re-runs:** the 5 new suites (guards included): 31/31. `components/crm components/scheduling components/business-os app/business-os app/onboarding-build app/(protected)/scheduling`: 62 suites, 980 passed, 1 failed (the same pre-existing CRLF-only `bookingsSearchAndPaging.guard`). `npm run lint:hooks`: clean. Scoped `tsc` over every touched file: identical to the earlier error set, no new errors.

---

## Commit Info

*(RM to populate)* Suggested split: PERF-1 = the 9 files in "Files (PERF-1)"; PERF-2 = the 13 files in "Files (PERF-2)", merged after PERF-1. This workplan goes with PERF-1.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created | PERF-1 and PERF-2 implemented, PERF-3 found to target dead code |
| 2026-10-13 | SA code review | APPROVED WITH CHANGES: approved for QA; R1 (`console.*` in touched files) and R2 (PERF-2 Q5 wording) required before RM; the three new patterns approved under rule 7; PERF-3 finding and slice split confirmed |
| 2026-10-13 | Dev fixes after review | R1: 28 `console.*` → Pino in 4 files; R2 fixed in code via O-1 (retry on interaction, new retry test) and Q5 reworded; O-2 comment in `ConfigurationDialog`; flag table corrected |
