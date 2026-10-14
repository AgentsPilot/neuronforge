# Workplan: BR-2, Phone Field on Demand in the Public Contact Form

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md](/docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md): §2, §4 (BR-2), §6, §9 (BQ-4, BQ-5), §11, §12 (P-4, SA-7, SA-8, SA-9, C-8 to C-11)
**Date:** 2026-10-14
**Status:** Code Complete (SA workplan review APPROVED WITH CHANGES, RC-1 to RC-7 folded in and built; awaiting SA code review). Nothing committed
**Branch:** `feature/perf-br2-contact-form-phone` (worktree `neuronforge-br2`, cut from `origin/main` @ `d769b9e3`, fast-forwarded to `0aee8efa` before implementation)
**Path:** full cycle (the slice changes what visitors see): Dev workplan → SA → Dev → SA code review → QA → user sees the diff → RM.

## Overview

The public contact-form block (`ContactFormBlock`) imports the phone-number library statically through four paths, so every public site page and contact page downloads it (about 50 kB gz) before anything appears. BR-2 moves all four paths behind the PERF-2 loader (`usePhoneLib`), starts the download right after the page hydrates, and shows a same-size, focusable placeholder for the phone row until the library arrives. Validation, default country, stored format and the submit payload are unchanged. If the library cannot load, the visitor sees "please try again" and nothing is sent with an unchecked number (BQ-5).

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [How each FR and AC is met](#how-each-fr-and-ac-is-met)
- [§6 filter](#6-filter)
- [Metric and baseline](#metric-and-baseline)
- [Test plan](#test-plan)
- [Failure behaviour (BQ-5)](#failure-behaviour-bq-5)
- [Risks](#risks)
- [Open points for SA](#open-points-for-sa)
- [Required changes RC-1 to RC-7 (folded in)](#required-changes-rc-1-to-rc-7-folded-in)
- [Implementation notes](#implementation-notes)
- [Pino / console audit](#pino--console-audit)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

**Re-read on `origin/main` @ `d769b9e3`.** Line numbers below are from that commit; they match SA's (`ffb598ac`) for every file this slice touches.

### The four library paths in the block (requirement §4.2)

| # | Path | Where today | After BR-2 |
|---|---|---|---|
| 1 | `PhoneInput` | `ContactFormBlock.tsx:6`, rendered `:424-437` | `phoneLib.PhoneInput` (already in the barrel) |
| 2 | `isValidPhoneNumber` | `ContactFormBlock.tsx:7`, used `:198` | `phoneLib.isValidPhoneNumber` (**added to the barrel**) |
| 3 | `applyCountryToPhone`, `phoneFieldValue`, `publicFormCountry` | `phoneField.ts:39-44` imports the library at module level; used `:178`, `:416`, `:429` | `applyCountryToPhone` / `phoneFieldValue` via `phoneLib` (already exported, `phoneLib.ts:28`). `publicFormCountry` **moves to a library-free module**, because it runs in a `useState` initialiser at first render |
| 4 | `WebsiteCountrySelect` (`getCountries`, `getCountryCallingCode`, `locale/en`) | `WebsiteCountrySelect.tsx:4-5`, rendered `ContactFormBlock.tsx:402-422` | `phoneLib.WebsiteCountrySelect` (**added to the barrel**) |
| — | `react-phone-number-input/style.css` | `ContactFormBlock.tsx:8` | **Stays a static import** (FR-2.1 / C-8). Not JS, no First Load JS cost, avoids an unstyled frame |
| — | `import type { Country }` | `ContactFormBlock.tsx:10` | Stays (erased at build) |

### Every place the block renders (FR-2.8)

| Route | How it reaches `ContactFormBlock` |
|---|---|
| `/site/[subdomain]` | `app/site/[subdomain]/page.tsx:11` → `WebsiteBlocks` (`components/website/blocks/index.tsx:28`, registry `contact_form` `:86`) |
| `/site/[subdomain]/[slug]` (the requirement's `/[slug]`) | `app/site/[subdomain]/[slug]/page.tsx:25` → `WebsiteBlocks` |
| `/site/[subdomain]/contact` | `app/site/[subdomain]/contact/page.tsx` → `components/public/PublicContactPage.tsx:17,152` |
| `/c/[userCode]/contact` | `app/c/[userCode]/contact/page.tsx` → `PublicContactPage` |
| `/business-os/website` (owner editor) | **Not reached on `d769b9e3`.** SA-9 expected it through the registry, but the editor imports only `blocks/types` (type-only), and its First Load holds no block or library chunk (baseline build). Measured anyway; see O-5 |
| `/website-preview/[id]`, `/landing-preview` | `WebsiteBlocks` (preview surfaces; measured as side routes) |

The six website templates (`components/website/templates/registry.ts:36-41`) deliberately do **not** re-draw `contact_form`; they keep the block and only restyle it, so there is no second implementation to convert.

### Other static importers of the library (SA-9, AC-2.1)

Grep of `app`, `components`, `lib`, `hooks` on `d769b9e3`:

| Importer | Reaches public routes? | Action |
|---|---|---|
| `components/website/blocks/ContactFormBlock.tsx` | Yes | Converted (this slice) |
| `components/website/blocks/WebsiteCountrySelect.tsx` | Only through the block | Reached only through the barrel after BR-2 |
| `components/crm/phoneField.ts` | Only through the block (`publicFormCountry`) | Block stops importing it; `publicFormCountry` moves out |
| `app/site/[subdomain]/book/BookingWidget.tsx:13-20` | **No**, unreferenced (PERF-3) | None (out of scope §4.8). Allow-listed by name in the new guard |
| `lib/geo/countries.ts:55-57` | No, owner settings only | None |
| `components/business-os/settings/BusinessProfileSection.tsx`, `components/crm/SearchableCountrySelect.tsx` | No (owner, PERF-2 decisions) | None |

No other public block (`ProcessFlowSection`, `IntakeFormStep`, booking, newsletter …) imports the library: `ProcessFlowSection`'s details step uses a plain `<input type="tel">`.

### Logger cost (SA-7 observation)

`usePhoneLib` imports `@/lib/logger` (browser build). `/site/[subdomain]` and `[slug]` already carry it through `components/website/blocks/BookingWidgetBlock.tsx:8` (same registry). The two contact routes do not: `components/public/PublicContactPage.tsx:25` imports `createLogger`, but it is a server component. So up to ~4 kB gz comes back on the contact routes only (measured below).

---

## Implementation Approach

SA's design (§12.2 SA-7), with no new pattern (P-4: scope extension of the approved PERF-2 loader).

1. **Extend the existing barrel** `components/crm/phoneLib.ts` with:
   - `export { isValidPhoneNumber } from 'react-phone-number-input';`
   - `export { WebsiteCountrySelect } from '@/components/website/blocks/WebsiteCountrySelect';`

   No second barrel, so `/business-os/website` keeps one module holder and one download. The barrel's header comment is updated to say it now also serves the public contact-form block.

2. **Move `publicFormCountry` into a library-free module** `components/crm/publicFormCountry.ts` (only `import type { Country }`). It also exports `publicFormCallingCode(country)`, a three-entry lookup (`IL` → `972`, `ES` → `34`, `US` → `1`) for the placeholder's country stub (see 3). Both functions cover exactly the three countries `publicFormCountry` can return, so no new rule is introduced; a unit test pins the calling codes against the library's `getCountryCallingCode`, so they cannot drift. `phoneField.ts` drops the function and its doc block (moved verbatim). `phoneField.test.ts` imports it from the new module.

3. **Public placeholder variant** `components/website/blocks/PublicPhoneFieldPlaceholder.tsx` (the PERF-2 `PhoneFieldPlaceholder` is not reused: it is `disabled`, `aria-hidden`, `tabIndex={-1}`). Renders, inside the same `<div dir="ltr" className="flex gap-2">` row:
   - **Country-box stub** (RC-4): the trigger's **full** structure and class string: wrapper `<div className="relative" dir="ltr">`, then `<button type="button" tabIndex={-1} aria-hidden="true">` with `flex items-center gap-2 px-3 py-2.5 min-w-[110px] ap-card-2 border rounded-lg transition-all text-sm` + `ap-line ap-hover-line` (or `border-red-500` when `hasError`) and `style={{ minHeight: '42px' }}`; flag in `<span className="text-xl leading-none">` (code-point arithmetic, no library), `+{callingCode}` in `<span className="ap-ink font-medium">`, `ChevronDown className="h-4 w-4 ap-ink-3 transition-transform"`. Same element type, same content, same box, so the number box beside it starts at the same x.
   - **Number box**: `<div className="phone-input-contact flex-1 [has-error]"><div className="PhoneInput" aria-busy="true"><input id={fieldId} type="tel" readOnly className="PhoneInputInput" … /></div></div>`. The block's global `style jsx` targets `.phone-input-contact .PhoneInput*` (SA-8), so it gets the real input's padding, border, radius, colours and `min-height: 42px` in every template, dark ones included. It is focusable (read-only, not disabled, no `tabIndex={-1}`, not `aria-hidden`) and is the target of the label's `htmlFor`, so a screen reader announces "Phone, required" exactly where the real field will be.
   - `onFocus` and `onPointerDown` call `loadPhoneLib()` (retry after a failure). `onFocus` tells the block that focus is waiting; `onBlur` cancels that only when `relatedTarget` is set, i.e. focus moved to another element (RC-3).

4. **`ContactFormBlock.tsx`**:
   - Remove the value imports of `react-phone-number-input`, `phoneField` and `./WebsiteCountrySelect`. Keep `import 'react-phone-number-input/style.css'` and `import type { Country }`.
   - `const phoneLib = usePhoneLib();`. The hook's effect runs after hydration, so the download starts with no interaction (FR-2.2), and it re-runs on every render while the library is missing, so typing in any other field retries a failed download (FR-2.6, `usePhoneLib.ts:140-149`).
   - `useState<Country>(() => publicFormCountry(locale))` now imports from the library-free module. Same value as today.
   - `phoneLib ? <real row> : <PublicPhoneFieldPlaceholder …>`. The real row is today's JSX with `phoneLib.WebsiteCountrySelect` / `phoneLib.PhoneInput` / `phoneLib.applyCountryToPhone` / `phoneLib.phoneFieldValue`, and identical props otherwise.
   - **Focus hand-off (FR-2.4, RC-3):** a `phoneFocusPending` ref set by the placeholder's `onFocus`, cleared by its `onBlur` only when `relatedTarget != null`. A `useEffect` on `phoneLib` focuses the real number input only if the ref is set **and** `document.activeElement` is `null` or `document.body` (focus lost by the removal, never taken from another field), then clears it. The input is reached through a ref on its wrapper `div` (`querySelector('input')`), because the library's typings declare `PhoneInput`'s `ref` as a class instance even though it forwards to the input.
   - **Validation:** `validateField` takes the library as an argument and uses `lib.isValidPhoneNumber`. Same order of checks and same messages.
   - **Submit (FR-2.5, RC-1):** when `phoneLib` is already loaded (the normal case), `handleSubmit` runs as today. When it is not, the button enters its existing `submitting` state, awaits `loadPhoneLib()` (a `waitingForPhoneLib` ref makes a second press return instead of waiting again), then validates and sends as today, reading the visitor's **current** values from a `formDataRef` mirrored on every render. Every exit after `setSubmitting(true)` resets it. A `null` result sets only `_form: phoneUnavailable`, no field errors, no `fetch`. An effect on `phoneLib` clears a stale `phoneUnavailable` once the library arrives. **The phone is always empty in the wait path:** the placeholder is read-only and only `PhoneInput.onChange` ever sets `formData.phone`, so after the library arrives the outcome is today's "This field is required" on the phone and nothing is sent. The wait exists so that a load that **fails** shows "could not load, try again" rather than a "required" the visitor cannot satisfy.
   - New copy key `phoneUnavailable` in the block's `LABELS` for `en`, `es`, `he`.
   - The `<style jsx global>` block, consent checkbox, success state, sidebar and the `fetch` body are untouched (FR-2.7).

5. **Guard** `components/crm/__tests__/phoneLibLazy.guard.test.ts`, extended as SA asked (see [Test plan](#test-plan)).

### Why not `next/dynamic`
The same reason PERF-2 gave (`usePhoneLib.ts:66-69`): a lazy component suspends on its first render even with the chunk already cached. The module holder lets a block mounted after the download (a soft navigation to the contact page) draw the real field in its first frame.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/crm/phoneLib.ts` | modify | Add `isValidPhoneNumber` and `WebsiteCountrySelect` exports (SA-7 item 1); update header comment |
| `components/crm/publicFormCountry.ts` | create | Library-free home for `publicFormCountry` plus `publicFormCallingCode` for the stub (SA-7 item 2) |
| `components/crm/phoneField.ts` | modify | Remove `publicFormCountry` (moved) |
| `components/crm/__tests__/phoneField.test.ts` | modify | Import `publicFormCountry` from the new module |
| `components/crm/__tests__/publicFormCountry.test.ts` | create | Default-country cases (moved) + calling codes pinned against the library |
| `components/website/blocks/PublicPhoneFieldPlaceholder.tsx` | create | Public placeholder variant (SA-7 item 3, FR-2.3, FR-2.4) |
| `components/website/blocks/ContactFormBlock.tsx` | modify | All four paths through `usePhoneLib`; placeholder; focus hand-off; submit waits; BQ-5 message |
| `components/crm/__tests__/phoneLibLazy.guard.test.ts` | modify | Cover the public block and the public surface (SA-7) |
| `components/website/blocks/__tests__/contactFormPhoneOnDemand.client.test.tsx` | create | Behaviour tests: placeholder, label, focus hand-off, submit waits, failure path, same payload |
| `components/website/blocks/__tests__/contactFormFields.test.tsx` | modify | React warned (`act`) because the real dynamic import resolved after the tests. The loader is now mocked to stay pending, so the row stays the placeholder (still `input[type="tel"]`) |
| `docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` | modify | §0 rows (workplan, SA, PR, measurements) per the always-update-the-requirement rule |
| `docs/workplans/PERF_BR2_CONTACT_FORM_PHONE_WORKPLAN.md` | create | This file |

Not touched: `components/crm/usePhoneLib.ts`, `components/crm/PhoneFieldPlaceholder.tsx`, `WebsiteCountrySelect.tsx` (its own imports stay; it simply moves behind the barrel), `/api/website/forms/contact`, `BookingWidget.tsx`.

---

## Task List

- [x] 1. Baseline: production build of `origin/main` @ `d769b9e3`, route table and phone-library chunk check. `main` moved to `0aee8efa` (admin-only commits); re-baselined there (RC-6), same numbers on every gated route
- [x] 2. Create `components/crm/publicFormCountry.ts` (+ test); remove the function from `phoneField.ts`; update `phoneField.test.ts`
- [x] 3. Extend `components/crm/phoneLib.ts` (two exports, comment)
- [x] 4. Create `PublicPhoneFieldPlaceholder.tsx`
- [x] 5. Convert `ContactFormBlock.tsx` (imports, `usePhoneLib`, render branch, focus hand-off, `validateField` with the library, submit waits, `phoneUnavailable` copy)
- [x] 6. Extend `phoneLibLazy.guard.test.ts`
- [x] 7. Write `contactFormPhoneOnDemand.client.test.tsx`; run the existing block tests (`contactFormFields`, `publicFormMessages`) and the PERF-2 tests
- [x] 8. `npx tsc --noEmit` on the touched files, `npm run lint` on them, `npm test -- components/crm components/website/blocks`
- [x] 9. After build: route table + chunk check on the branch; fill in the before/after table
- [ ] 10. Manual checks: QA (Fast 3G swap, layout-shift regions, dark template, RTL, request blocking). Not run by Dev: no browser session in this worktree
- [x] 11. Status → Code Complete. Requirement §0 row left to the TL/BA: the master requirement lives uncommitted in the main checkout, and the worktree copy is a mirror of it

---

## How each FR and AC is met

| Item | How |
|---|---|
| **FR-2.1** All four paths on demand; CSS static | Paths 1–4 via `phoneLib` (table above). `style.css` stays static. Guard pins both |
| **FR-2.2** Download starts at paint, no interaction | `usePhoneLib`'s effect runs after hydration on every page that renders the block |
| **FR-2.3** Same-size placeholder in template colours, label, asterisk, LTR | Placeholder reuses the trigger's classes and the `.phone-input-contact .PhoneInput*` styles (SA-8); sits inside the same `dir="ltr"` row; the label and `*` are rendered by the block above both branches, unchanged |
| **FR-2.4** Tap not lost, focus moves to the real box | Placeholder is focusable and the `htmlFor` target; `phoneFocusPending` ref + effect focuses the real input on arrival |
| **FR-2.5** Submit before arrival waits, validates as today | `handleSubmit` awaits `loadPhoneLib()` under the existing `submitting` state; validation is unchanged and runs only with the library; "invalid phone" is never shown for a missing library |
| **FR-2.6** Failure: retry on interaction, then "please try again", fields kept, nothing sent | Hook retries on every render while missing; placeholder `onFocus`/`onPointerDown` retry; `null` from `loadPhoneLib()` on submit → `_form` error `phoneUnavailable`, `formData` untouched, no `fetch` |
| **FR-2.7** Everything else unchanged | Only the phone row's source and `handleSubmit`'s front change. `fetch` body, consent, success, sidebar and styles are byte-for-byte the same lines |
| **FR-2.8** Owner preview behaves the same; every render place listed | Same component everywhere it renders; list in [Analysis Summary](#every-place-the-block-renders-fr-28). `/business-os/website` measured: no block, no library at base (O-5). The owner's preview surfaces (`/website-preview/[id]`, `/landing-preview`) get the change and are measured |
| **AC-2.1** Library out of First Load on the public routes, each ≥ 10 kB down (`/business-os/website`: reported, no gate) | Route table before/after + a chunk-content check on each route's First Load chunks (RC-6; see [Implementation notes](#implementation-notes) for why `PhoneInputCountry` alone is not a clean marker) |
| **AC-2.2** Chunk requested after paint, no click | QA, Network tab |
| **AC-2.3** No layout shift | Same classes and min-heights; QA, DevTools Layout Shift regions under Fast 3G |
| **AC-2.4** Swap within 2 s of hydration on Fast 3G | QA; base commit measured first (C-11) |
| **AC-2.5** Focus hand-off | Jest (simulated late arrival) + QA under throttling |
| **AC-2.6** (as amended by SA) Send before arrival: sending state, then today's phone "required", no send; once loaded and filled, exactly one send | Jest RC-2a (i)–(iii) + QA |
| **AC-2.7** Same-output, he/en/es × five inputs | Jest with the real library; expected values are **literal strings recorded from `main` @ `0aee8efa`** (RC-2b), 15 cases + a Spanish mobile + 2 country-change cases (AC-2.8) + QA on live pages |
| **AC-2.8** Country dropdown unchanged | Same component, same props; QA |
| **AC-2.9** Library blocked | Jest (loader resolves `null`: `phoneUnavailable` in he/en/es, fields kept, no `fetch`, cleared on a later load) + QA with request blocking |
| **AC-2.10** Dark template and RTL | QA visual check |
| **AC-2.11** Consent, success, sidebar identical | Code untouched; QA |

---

## §6 filter

Restated from requirement §4.6 for SA to confirm (§2 definition of done item 1).

| Q | Answer | Why |
|---|---|---|
| Q1 Output | **Yes** | A visitor on a slow connection may see the placeholder phone row for up to 2 s after the page becomes usable. Accepted by the user (BQ-4, 2026-10-14) within FR-2.3 and AC-2.3/2.4. The stored lead is identical (AC-2.7) |
| Q2 Money | **No** | The contact form charges nothing; no credit, ledger or payment path is touched |
| Q3 Timing users rely on | **No** | Leads arrive when submitted, as today. A submit pressed before the library arrives waits for it (normally well under a second), then sends |
| Q4 Scope | **No** | Same field, same validation, same country picker, same default country |
| Q5 Failures and records | **Yes (small)** | New rare failure: the library cannot load. BQ-5 (a): "please try again", today's "valid phone required" rule kept, nothing unchecked is sent. The failed download is logged by the existing loader (Pino browser logger, `logger.warn`, no PII). Lead storage unchanged |

**Same-output proof** (definition of done item 2): stored phone value and validation message for 15 cases (AC-2.7) are pinned in Jest; the submit body's keys and the `/api/website/forms/contact` route are unchanged; no copy changes except the new `phoneUnavailable` message.

---

## Metric and baseline

**Method:** R22 / PERF-2 method. `next build` (Next 14.2.35) in this worktree, `node_modules` junctioned to the main checkout, `.env.local` copied in (gitignored, deleted at the end of the slice). Route table "First Load JS". Plus a content check: which of each route's First Load chunks (from `app-build-manifest.json`) contain the marker `PhoneInputCountry`.

**Base:** `origin/main` @ `d769b9e3`.

**Baseline measured 2026-10-14** (production build of `d769b9e3` in this worktree, exit 0).

| Route | R22 (requirement §4.6) | **Base `d769b9e3`** | Phone-library chunks in First Load (gz, level 9) | Expected after |
|---|---|---|---|---|
| `/site/[subdomain]` | 285 kB | **286 kB** | `6471` 46.2 kB (library) + `5754` 5.3 kB (block + `WebsiteCountrySelect` + `phoneField`) | ≈ 236–240 kB |
| `/site/[subdomain]/[slug]` | 285 kB | **286 kB** | same two chunks | ≈ 236–240 kB |
| `/site/[subdomain]/contact` | 231 kB | **184 kB** | same two chunks | ≈ 138–142 kB |
| `/c/[userCode]/contact` | (not in R22) | **184 kB** | same two chunks | ≈ 138–142 kB |
| `/business-os/website` | 531 kB | **535 kB** | **none** (see O-5) | 535 kB (no change expected) |
| `/website-preview/[id]` (side) | — | 292 kB | same two chunks | ≈ −46 kB |
| `/landing-preview` (side) | — | 290 kB | same two chunks | ≈ −46 kB |
| Shared by all | — | 88.7 kB | — | unchanged |

Notes from the baseline:
- The contact pages are already at 184 kB, not the R22 231 kB: PERF-1/PERF-2 and later merges moved them. The ≥ 10 kB gate is unaffected.
- **Logger, net (SA-7 observation):** `/site/[subdomain]` and `[slug]` already carry the browser logger (chunk `2935`, 3.9 kB gz, through `BookingWidgetBlock`). The two contact routes do **not**: `PublicContactPage` imports `createLogger` but is a server component. So `usePhoneLib` adds up to ~4 kB gz back on the contact routes. Net still ≈ −42 kB, far above the gate.
- **`/business-os/website` carries no phone-library code and no `ContactFormBlock` in its First Load on `d769b9e3`** (zero chunks with `PhoneInputCountry`, `phone-input-contact` or `Search countries...` among its 21 JS files). The editor does not import `components/website/blocks` statically (only `blocks/types`, type-only), so the block is not reached there. The PERF-2 table already recorded "PERF-2 effect 0" for this route. AC-2.1's "down ≥ 10 kB" cannot hold for a route that has nothing to remove: see O-5.
- The block reaches the same two chunks on every public route, so removing them is the whole gain; nothing else on those routes carries the library.

Expected size of the change: the library chunk (46.2 kB) leaves; most of `5754` stays (the block itself), minus `WebsiteCountrySelect` and `phoneField`, plus the small placeholder and `publicFormCountry`. Figures in the table are estimates; the after-build replaces them.

**Gate (requirement §2 rule 3, AC-2.1):** each of `/site/[subdomain]`, `/site/[subdomain]/[slug]`, `/site/[subdomain]/contact` and `/c/[userCode]/contact` down ≥ 10 kB, and zero library chunks in each route's First Load. Expected ≈ −42 to −50 kB gz. `/business-os/website` is reported, not gated (O-5).

**Optional (R25 method):** Lighthouse mobile on a test account's public site, 5 runs, median LCP and TBT, before and after; reported if run, not a gate.

---

## Test plan

### Jest (existing suite, no CI time added)

1. **`phoneLibLazy.guard.test.ts`** (extended):
   - `CONVERTED` gains `components/website/blocks/ContactFormBlock.tsx`; `HEAVY_FOR_CONVERTED` gains `components/website/blocks/WebsiteCountrySelect` (SA-7). So the "imports no value that carries the library" check now covers the block.
   - The existing "draws the field from usePhoneLib" `it.each` asserts `<phoneLib.SearchableCountrySelect` and `<PhoneFieldPlaceholder`, which the public block does not use. It is split: the owner list keeps those assertions, and a new public assertion checks the block for `usePhoneLib`, `<phoneLib.PhoneInput`, `<phoneLib.WebsiteCountrySelect`, `<PublicPhoneFieldPlaceholder`, `phoneLib.isValidPhoneNumber` and the static `style.css` import. **(Open point O-1 for SA.)**
   - New: `components/crm/publicFormCountry.ts` imports no value from the library.
   - New: no file under `components/website`, `components/public`, `app/site`, `app/c` statically imports a value from `react-phone-number-input`, `phoneField`, `SearchableCountrySelect` or `WebsiteCountrySelect`, except `app/site/[subdomain]/book/BookingWidget.tsx` (unreferenced, §4.8; named in the allow-list with the reason) and `WebsiteCountrySelect.tsx` itself.
   - New: the barrel exports `isValidPhoneNumber` and `WebsiteCountrySelect`.
2. **`publicFormCountry.test.ts`** (new): `he` → IL, `es` → ES, `en`/`null`/`de` → US (moved from `phoneField.test.ts`); `publicFormCallingCode(c) === getCountryCallingCode(c)` for each of the three.
3. **`contactFormPhoneOnDemand.client.test.tsx`** (new, jsdom). `@/components/crm/usePhoneLib` is mocked with a controllable store (deferred resolve, `null` for failure) wrapping the **real** `phoneLib` module, so the field under test is the real library:
   - before arrival (he/en/es): the placeholder is the label's target, `type="tel"`, read-only, not disabled, not `aria-hidden`, no `tabindex=-1`, no `name`; the stub shows `+972` / `+1` / `+34`;
   - RC-7: the label resolves to the placeholder before arrival and to the real `PhoneInputInput` after;
   - RC-3: focus the placeholder, the library arrives, the real input has focus; focus the placeholder, move to another field, the library arrives, the other field keeps focus;
   - RC-2a (i): Send before arrival → sending state, then today's phone "required", no `invalidPhone`, no `fetch`, other fields kept, button re-enabled;
   - RC-2a (ii): library loaded, phone typed, Send → exactly one `fetch` with today's keys (`subdomain, name, email, phone, message, page_url`) and values;
   - RC-2a (iii): Send twice before arrival → one wait (`loadPhoneLib` called once), no `fetch`;
   - RC-2c: loader resolves `null` → `phoneUnavailable` in he/en/es, no other message, fields kept, no `fetch`; a later load clears it and shows the real field;
   - RC-2b same-output (AC-2.7, AC-2.8): literal expectations recorded from `main`.
4. **Existing tests that must stay green:** `contactFormFields.test.tsx` (its `input[type="tel"]` check matches the placeholder), `publicFormMessages.test.ts` (`noValidate` kept), `phoneField.test.ts`, `usePhoneLib.client.test.tsx`, `usePhoneLib.failure.test.ts`, `usePhoneLib.retry.client.test.tsx`, `pipelineWorksOnAPhone.guard.test.ts`.

### Manual (QA, recorded in the QA report)

AC-2.2 (Network tab), AC-2.3 (Fast 3G, cache off, Layout Shift regions; compare the stub's and the real trigger's bounding boxes, RC-4), AC-2.4 (swap time from hydration, base commit first), AC-2.5 (on iOS a programmatic focus outside a gesture may place the cursor without opening the keyboard: record what is observed, RC-3), AC-2.8, AC-2.9 (DevTools request blocking on the phone chunk, then unblock and interact), AC-2.10 (a dark template + a Hebrew page), AC-2.11. The `/business-os/website` editor check is dropped (it does not render the block, O-5); the owner previews `/website-preview/[id]` and `/landing-preview` do.

---

## Failure behaviour (BQ-5)

BQ-5 answered (a), 2026-10-14: "please try again"; never send an unchecked number.

| Moment | What the visitor sees | What is sent |
|---|---|---|
| Download fails after paint | The placeholder stays. Nothing else changes. Logged once per attempt (`logger.warn`, existing loader) | Nothing |
| Visitor interacts (types in another field, focuses or taps the placeholder) | A new download attempt starts silently (`usePhoneLib` effect; placeholder handlers) | Nothing |
| Visitor presses Send and the library is still missing | Normal "sending" spinner while one more attempt runs. If it fails: a short message above the button in the page's language, e.g. EN "The phone field could not load. Please try again." (ES / HE equivalents in `LABELS`). The other fields keep what was typed | **Nothing.** No `fetch`. An unchecked number is never sent |
| A later attempt succeeds | The real field replaces the placeholder in place; the visitor enters the number and sends normally | The lead, validated as today |

---

## Risks

| Risk | Mitigation |
|---|---|
| The library stays in First Load through another path | Build check on route chunks, not only the source; new public-surface guard |
| The country stub's width differs from the real trigger and the number box shifts sideways | The stub renders the same classes, the same flag and the same `+code` text (`publicFormCallingCode`, pinned to the library). QA compares bounding boxes (AC-2.3) |
| The barrel now makes `components/crm` import a `components/website` component | SA's chosen design (one holder, one download). Noted in the barrel's comment. The owner pages' lazy chunk grows by `WebsiteCountrySelect` (a few kB, not First Load); measured |
| The placeholder is read-only, so digits typed into it before arrival are not kept | Focus moves into the real box on arrival; on unthrottled connections the field is in place before the form is reachable. Accepted under BQ-4 limits; QA checks AC-2.5 |
| Submit before arrival changes the order of validation messages | When the library is present, `handleSubmit` is today's code path. When absent, every field is validated together after the await, as today |
| React `act` warnings in existing render tests now that a dynamic import runs | Settle the load in the test or mock the loader; no product change |
| A hydration mismatch | `usePhoneLib` returns `null` on the server and on the first client render (`getServerPhoneLib`), so server HTML and the first client frame both show the placeholder |

---

## Open points for SA

| # | Point | Dev proposal |
|---|---|---|
| O-1 | The existing guard's "draws the field" `it.each` asserts owner-only names. Adding the block to `CONVERTED` as-is would fail it | Keep the block in `CONVERTED` for the import check; split the shape check into owner and public assertions |
| O-2 | Today the label's `htmlFor="phone"` points at nothing (`PhoneInput` gets no `id`). The placeholder takes `id={field.name}` so the label works before arrival | Also pass `id={field.name}` to the real `PhoneInput`, so the label keeps pointing at the number box after the swap. Markup-only (an `id` on the input), no visual or payload change. SA to confirm it is within FR-2.7 |
| O-3 | Home of the moved function | `components/crm/publicFormCountry.ts`, beside `phoneField.ts` where its doc and tests come from. Alternative: `components/website/blocks/` since only the block uses it |
| O-4 | `publicFormCallingCode` is a three-entry lookup | Only for the stub's text; pinned to the library by a test. Alternative: render the stub without the code at a fixed width, which risks a sideways shift |
| O-5 | **`/business-os/website` has no phone library in First Load at base** (SA-9 / C-10 expected it to). AC-2.1 asks for ≥ 10 kB down there | Measure and report it as "nothing to remove, still zero after" (as PERF-3 did for the book route), and the BA amends AC-2.1 / FR-2.8 to drop the ≥ 10 kB gate for that route. The editor's behaviour is unaffected because it does not render the block. If SA knows of a runtime path (a lazy chunk), QA checks it in the editor preview |
| O-6 | Gate for the public routes | `/site/[subdomain]`, `[slug]`, `/site/[subdomain]/contact`, `/c/[userCode]/contact` each ≥ 10 kB down and zero `PhoneInputCountry` chunks in First Load. Preview routes reported as side gains |

---

## Required changes RC-1 to RC-7 (folded in)

From the SA workplan review (below). Each is reflected in the sections above and built as stated.

| # | Requirement | Where it lives |
|---|---|---|
| RC-1 | Submit wait path: every exit after `setSubmitting(true)` resets it; current values read through `formDataRef` after the await; `null` sets only `_form: phoneUnavailable` and no `fetch`; a stale `phoneUnavailable` is cleared when the library arrives; **the phone is always empty in the wait path** (read-only placeholder, only `PhoneInput.onChange` sets it), so the wait's purpose is the failure message | `ContactFormBlock.tsx` `handleSubmit` and the effect on `phoneLib`; comment in `handleSubmit` |
| RC-2 | Replace the "valid fields, one fetch before arrival" test with (i) wait → "required", no fetch; (ii) loaded + typed → one fetch with today's body; (iii) double press → one wait. AC-2.7 expectations are literal strings recorded from `main`. `phoneUnavailable` shown in he/en/es and cleared on a later load | `contactFormPhoneOnDemand.client.test.tsx` |
| RC-3 | Blur cancels the hand-off only when `relatedTarget != null`; the effect focuses only if pending **and** `activeElement` is `null`/`body`; never steals focus. iOS keyboard note for QA | `PublicPhoneFieldPlaceholder.tsx` `onBlur`; `ContactFormBlock.tsx` hand-off effect; two Jest cases |
| RC-4 | The stub copies the trigger's full class string and structure, as a `<button type="button" tabIndex={-1} aria-hidden>` | `PublicPhoneFieldPlaceholder.tsx` |
| RC-5 | Guard: the two first-render modules carry no library value; `publicFormCountry.ts` imports the library for types only; each allow-list entry carries its reason; header comment covers BR-2 | `phoneLibLazy.guard.test.ts` |
| RC-6 | First Load content check with both `PhoneInputCountry` and `Search countries...`; re-baseline if `main` moved; report the owner pages' lazy `phoneLib` chunk before/after | [Implementation notes](#implementation-notes) |
| RC-7 | The label resolves to the placeholder before arrival and to the real `<input>` after | `contactFormPhoneOnDemand.client.test.tsx` |

---

## Implementation notes

**Built 2026-10-14 on `0aee8efa`.** Not committed.

### Measurement (RC-6)

`main` had moved from `d769b9e3` to `0aee8efa` (admin-only commits). Re-baselined with a production build of a `git archive` export of `0aee8efa` (scratch directory, `node_modules` junctioned, `.env.local` copied in and removed). After-build in this worktree, `.env.local` copied in and deleted afterwards. Next 14.2.35, route table "First Load JS".

| Route | Base `0aee8efa` | After | Change | Gate (≥ 10 kB down, no library chunk) |
|---|---|---|---|---|
| `/site/[subdomain]` | 286 kB | **239 kB** | **−47 kB (−16.4 %)** | ✅ |
| `/site/[subdomain]/[slug]` | 286 kB | **239 kB** | **−47 kB (−16.4 %)** | ✅ |
| `/site/[subdomain]/contact` | 184 kB | **140 kB** | **−44 kB (−23.9 %)** | ✅ |
| `/c/[userCode]/contact` | 184 kB | **140 kB** | **−44 kB (−23.9 %)** | ✅ |
| `/website-preview/[id]` (side) | 292 kB | 244 kB | −48 kB | reported |
| `/landing-preview` (side) | 290 kB | 243 kB | −47 kB | reported |
| `/business-os/website` (no gate, O-5) | 535 kB | 535 kB | 0 | reported: nothing to remove |
| Shared by all | 88.7 kB | 88.7 kB | 0 | — |

On the contact routes the gain is 3 kB smaller than on the site routes. That is the browser logger `usePhoneLib` brings, which SA accepted.

**Content check on each gated route's First Load chunks** (from `app-build-manifest.json`):

| Marker | What it identifies | Base | After |
|---|---|---|---|
| `PhoneInputCountryIcon`, `libphonenumber` | Library code | in chunk `5820` (46.2 kB gz) on all four routes | **absent** on all four |
| `Search countries...` | `WebsiteCountrySelect` with its country-name list | in chunk `9951` (5.3 kB gz) on all four routes | **absent** on all four |
| `PhoneInputCountry` (SA's marker) | Library class name | in `5820` and `9951` | still matched, by the block's own chunk `3484` (5.2 kB gz) only |

**Why `PhoneInputCountry` still matches.** The only hits in `3484` are the block's own `<style jsx global>` text, `.phone-input-contact .PhoneInputCountry{display:none!important}` and the `.has-error` rule. That stylesheet is unchanged by design (SA-8: the block renders it unconditionally so it styles the lazily loaded field). No library code is in that chunk: `PhoneInputCountryIcon` and `libphonenumber` are absent. So `PhoneInputCountry` is not a clean library marker once the library is lazy. The library-only markers above are the evidence. SA to confirm at code review.

**Owner pages' lazy chunks (informative, not First Load).**
- Base: the `phoneLib` barrel chunk is 23.7 kB gz, with the library in the shared chunk `5820` (46.2 kB).
- After: the barrel chunk `6302` is 25.5 kB gz, **+1.8 kB**, because it now also carries `WebsiteCountrySelect` and `isValidPhoneNumber`. The library itself moved into the lazy chunk `4958` (44.1 kB gz), which is no longer in any route's First Load.
- Owner First Load: `/business-os`, `/business-os/crm` and `/scheduling` are unchanged (476 / 518 / 408 kB).
- `/business-os/website`'s page chunk reads 111 kB instead of 108 kB, with First Load still 535 kB. Next attributes chunks between the page and its shared chunks differently once the library chunk is split differently. The total is unchanged, and the route carries no phone code before or after.

### Same-output recording (RC-2b)

The AC-2.7 expectations were recorded before any product file was edited.
- **How:** a throwaway Jest file rendered `main`'s unchanged block (`0aee8efa`), typed each input with `userEvent`, submitted, and captured the `fetch` body and the visible messages. The file was then deleted.
- **What:** 15 cases (he/en/es × Israeli mobile `0501234567`, US `2015550123`, UK `07400123456`, invalid `123`, empty), plus a Spanish mobile `612345678` on an `es` page, plus two country changes on a `he` page (US, which rewrites to `+12015550123`; UK, invalid).
- **Where:** they are literal strings in `RECORDED_ON_MAIN`.
- **Expected outcomes:** only the page's own country produces a stored number (`+972501234567`, `+12015550123`, `+34612345678`). A foreign national number on another country's page is "invalid", as on `main`.

### Deviations from the workplan text, with reasons

- **Focus target.** The hand-off focuses `phoneBoxRef.current.querySelector('input')`, not a ref on `PhoneInput`. The library's `.d.ts` types `ref` as the class component, so `tsc` rejects an `HTMLInputElement` ref, even though at runtime it forwards to the input.
- **`contactFormFields.test.tsx` touched.** After the change it logged `act` warnings: the real dynamic import resolved after the tests ended. The loader is mocked to stay pending there, which matches its subject (which fields exist).
- **`phoneField.test.ts`.** The moved `publicFormCountry` tests live in `publicFormCountry.test.ts`. A one-line pointer is left in their place.

### Tests run

- **New and extended:** `phoneLibLazy.guard.test.ts` (21), `publicFormCountry.test.ts` (6), `contactFormPhoneOnDemand.client.test.tsx` (30). All pass. The new behaviour file takes about 25 s locally, mostly the real phone field formatting typed keys in jsdom.
- **QA follow-up (RC-3 "never steal focus" branch):** added a 31st case, "is not stolen from a field focused after a blur with no relatedTarget". It fails when the `activeElement` null/body check is removed and passes with it restored. jsdom never reports a null `relatedTarget` on a real blur, so the test sends React a `focusout` with `relatedTarget: null` and keeps the placeholder's native `focusout` from React while focus moves to Name.
- **Guard mutation check:** a probe file in `components/public` importing `isValidPhoneNumber` made the public-surface test fail with that file named. The probe was then deleted.
- **Suites:** `npx jest components/website/blocks components/crm components/scheduling phone` gives 42 of 43 suites and 571 of 572 tests passing. The one failure is `components/crm/contact-drawer/__tests__/bookingsSearchAndPaging.guard.test.ts`. It is **pre-existing and unrelated**: it fails identically on the untouched `0aee8efa` export. The cause is a multi-line `toContain` against a CRLF Windows checkout (`core.autocrlf=true`).
- **Lint:** `npm run lint:hooks` is clean. `eslint` on the touched files shows one warning, `title` unused in `ContactFormBlock.tsx:154`, which was already there.
- **Types:** scoped `tsc` (a temporary tsconfig over the touched files and their tests, since removed) is clean.

### Not done by Dev

- Manual browser checks (AC-2.2 to AC-2.5, AC-2.10, AC-2.11): QA.
- Requirement §0 row: the master copy is uncommitted in the main checkout, so the TL/BA should add the row there.

---

## Pino / console audit

No `console.*` in any file this slice touches (counted on `d769b9e3`): `ContactFormBlock.tsx` 0, `WebsiteCountrySelect.tsx` 0, `phoneLib.ts` 0, `phoneField.ts` 0, `usePhoneLib.ts` 0, `PhoneFieldPlaceholder.tsx` 0, `phoneField.test.ts` 0, `phoneLibLazy.guard.test.ts` 0, `contactFormFields.test.tsx` 0. The only logging on the new path is the loader's existing `logger.warn`.

---

## SA Review Notes

**Reviewed by SA — 2026-10-14** (code read in worktree `neuronforge-br2` @ `d769b9e3`)
**Status:** 🔄 APPROVED WITH CHANGES. Dev may start implementation once RC-1 to RC-7 are folded into this workplan (no second SA pass on the workplan needed; SA checks them at code review).

### Rulings on the design

| Item | Ruling |
|---|---|
| `phoneLib.ts` barrel extension | ✅ Approved as SA-7 item 1. One holder, one download. The `crm → website/blocks` import direction is accepted and must be explained in the barrel's header comment (which today says "owner-side"; update it to name the public block). No re-export of `publicFormCountry` from `phoneField.ts` (one home only) |
| `publicFormCountry.ts`, library-free, in `components/crm/` (O-3) | ✅ Approved. Keeping it beside its origin, doc block and tests is fine; the guard pins it library-free (RC-5) |
| `publicFormCallingCode` 3-entry lookup vs fixed-width box (O-4) | ✅ Lookup approved. A fixed-width box without the code is rejected: `min-w-[110px]` lets the real trigger grow with its content, so a stub with different content shifts the number box sideways (AC-2.3). The pin test against `getCountryCallingCode` is required. Suggestion (non-blocking): type the table as `Record<'IL' \| 'ES' \| 'US', string>` so the compiler, not only the test, keeps it exhaustive against `publicFormCountry`'s return values |
| `PublicPhoneFieldPlaceholder` | ✅ Approved (focusable, `readOnly`, not disabled, not `aria-hidden`, label target, `type="tel"`, inside `.phone-input-contact` so SA-8's global styles apply). No `name` attribute on the placeholder input. Box parity: see RC-4 |
| Submit path | ✅ Approved in principle (loaded: today's code path unchanged; loading: wait under `submitting`; `null`: `phoneUnavailable`, no `fetch`). Corrections in RC-1 and RC-2 |
| CSS static | ✅ Approved (SA-7 / C-8 / PERF-2 decision) |
| No `next/dynamic` | ✅ Agreed, same reasoning as PERF-2 |

### Open points

| # | Ruling |
|---|---|
| O-1 | ✅ Approved. Keep the block in `CONVERTED` for the import check; split the shape `it.each` into owner and public assertions (public list asserts `usePhoneLib`, `<phoneLib.PhoneInput`, `<phoneLib.WebsiteCountrySelect`, `<PublicPhoneFieldPlaceholder`, `phoneLib.isValidPhoneNumber`, static `style.css`). See RC-5 for the additions |
| O-2 | ✅ Approved, within FR-2.7: an `id` on the input is markup-only, changes no pixel and no payload, and fixes a label that today points at nothing. `PhoneInput` spreads unknown props onto its `<input>`; RC-7 pins it in a test |
| O-3 | ✅ `components/crm/publicFormCountry.ts` (above) |
| O-4 | ✅ Lookup (above) |
| O-5 | ✅ Agreed. Verified: `app/business-os/website/page.tsx` imports only `blocks/types` (type-only) and has no `import()` / `dynamic()` of the blocks, so `ContactFormBlock` is not in the editor's bundle at all. SA-9's "reaches `/business-os/website` through `blocks/index.tsx:28`" was wrong. **Applied by SA to the master requirement** (FR-2.8, AC-2.1, §4.6 metric row, §0 row): the route is measured and reported as "nothing to remove, no gate". QA's editor-preview check is dropped from the manual list, since the editor does not render the block (the owner previews `/website-preview/[id]` and `/landing-preview` do, and are side routes) |
| O-6 | ✅ Approved. Gate = `/site/[subdomain]`, `/site/[subdomain]/[slug]`, `/site/[subdomain]/contact`, `/c/[userCode]/contact`, each **≥ 10 kB down** and zero library chunks in First Load (RC-6). Preview routes reported as side gains, not gated. Drop the sentence "the threshold is the smaller of 5 % and 10 kB, so ≤ 10 kB…" from the gate paragraph: it reads as if the gate were ≤ 10 kB; the requirement's gate is ≥ 10 kB down per route |

### Logger cost (+~4 kB on the two contact routes)

✅ **Accepted; the public path keeps the logger.** Net is still ≈ −42 kB on those routes, four times the gate. The alternatives are worse: `console.*` is banned (CLAUDE.md rule 3), and a logger-free copy of the loader would be a second loader (a new pattern) for 4 kB. Optimisation suggestion for a later slice, not BR-2: `usePhoneLib` could `import('@/lib/logger')` inside its failure branch only, which would drop the logger from every route that carries it only for this loader. That edits the PERF-2 file and its tests, so it is out of this slice.

### Required changes

1. **RC-1 — Submit wait path (FR-2.5 / FR-2.6).**
   (a) In the wait path, every exit after `setSubmitting(true)` resets it: validation errors after the await must call `setSubmitting(false)` before returning (today's code validates *before* setting `submitting`, so this exit is new).
   (b) After the await, read the visitor's current values, not the `formData` captured by the `handleSubmit` closure: keep a ref mirroring `formData` (updated on render) and validate/send from it, so keystrokes in name/email/message during the wait are not lost.
   (c) On `null`, set only `_form: phoneUnavailable` (plus any non-phone field errors if you validate them), never a phone "required"/"invalid" message, and no `fetch`. Clear the stale `phoneUnavailable` message when the library later arrives (an effect on `phoneLib`), so a visitor who succeeded on retry does not see "could not load" above a working field.
   (d) State in the workplan that, because the placeholder is read-only and `formData.phone` is only ever set by `PhoneInput.onChange`, **the phone value is always empty in the wait path**; after the library arrives the outcome is therefore today's "This field is required" on the phone field and no send. The wait exists so that a *failed* load shows `phoneUnavailable` instead of an unfillable "required".
2. **RC-2 — Test plan corrections.**
   (a) Replace the case "press Send before arrival with valid fields → exactly one `fetch`": it cannot occur through the UI (RC-1d). New cases: (i) Send before arrival, library resolves → sending state shown, then the phone "required" message (today's text), no `invalidPhone`, no `fetch`, other fields kept; (ii) library resolves, phone typed, Send → exactly one `fetch` with today's body keys and values; (iii) Send twice quickly before arrival → at most one wait, no `fetch`. AC-2.6 was amended in the master requirement to match (see §0).
   (b) AC-2.7 same-output: the expected stored values and messages are **literal strings in the test** (e.g. `'+972501234567'`), written once from a run on `main`, not computed in the test with the same library calls. Computing them with the library the code also uses would make the test agree with itself.
   (c) Add: library resolves `null` → `phoneUnavailable` in he/en/es; then a later successful load clears it (RC-1c).
3. **RC-3 — Focus hand-off robustness (FR-2.4).** Do not depend on `onBlur` *not* firing when the focused placeholder is removed at the swap (browsers differ on blur for removed nodes, and jsdom differs from both). Clear `phoneFocusPending` on blur only when focus moved to another element (`e.relatedTarget != null`), and in the hand-off effect focus the real input only if `phoneFocusPending` is set **and** `document.activeElement` is `null` or `document.body` (focus was lost by the removal, not taken by the visitor). Never steal focus from another field. QA note (not a defect): on iOS a programmatic focus outside a user gesture may place the cursor without opening the keyboard; record what is observed under AC-2.5.
4. **RC-4 — Country-stub box parity (AC-2.3).** The stub must copy the trigger's **full** class string and structure, not the subset listed: wrapper `<div className="relative" dir="ltr">`, and the box `flex items-center gap-2 px-3 py-2.5 min-w-[110px] ap-card-2 border rounded-lg text-sm` + `ap-line` (or `border-red-500` when `hasError`) with `style={{ minHeight: '42px' }}`, flag `<span className="text-xl leading-none">`, code `<span className="ap-ink font-medium">`, `ChevronDown className="h-4 w-4 ap-ink-3"`. Rendering it as the same element type (`<button type="button" tabIndex={-1} aria-hidden>`) is the surest way to match the real `<button>`'s box; a `<div>` is acceptable only if QA's bounding-box comparison passes.
5. **RC-5 — Guard additions (O-1).** Besides the split and the public-surface scan as proposed: (a) `components/website/blocks/PublicPhoneFieldPlaceholder.tsx` and `components/crm/publicFormCountry.ts` import no value from `HEAVY_FOR_CONVERTED` (`publicFormCountry.ts` additionally imports nothing from `react-phone-number-input` except `import type`); (b) the allow-list entries (`BookingWidget.tsx`, `WebsiteCountrySelect.tsx`) each carry their reason in the test; (c) update the guard's header comment (it says "owner-side" and names four components) to cover BR-2.
6. **RC-6 — Metric content check.** The First Load chunk check on each gated route looks for **two** markers: `PhoneInputCountry` (the library) and `Search countries...` (`WebsiteCountrySelect`, which also carries the country-name list). Both must be absent. Re-run the baseline if `main` has moved past `d769b9e3` when implementation starts. Report the owner pages' lazy `phoneLib` chunk before/after (it grows by `WebsiteCountrySelect`; informative, not First Load).
7. **RC-7 — O-2 test.** In `contactFormPhoneOnDemand.client.test.tsx`, `getByLabelText(/phone/i)` resolves to the placeholder before arrival **and** to the real `<input>` after arrival.

### Optimisation suggestions (non-blocking)

- A `submitInFlight` ref beside `submitting` closes the same-tick double-press window (pre-existing; not required).
- The `Record<'IL' | 'ES' | 'US', string>` typing for `publicFormCallingCode` (above).
- Logger-in-failure-branch for `usePhoneLib` (above), as a separate slice.

### Approval

[x] Workplan approved with the conditions above. Proceed to implementation after folding RC-1 to RC-7 into the workplan text.

---

**Code Review by SA — 2026-10-14** (uncommitted diff in worktree `neuronforge-br2` on `0aee8efa`)
**Status:** ✅ Code Approved. No required changes; the suggestions below are non-blocking.

### What SA ran

- Jest: `phoneLibLazy.guard`, `publicFormCountry`, `phoneField`, the three `usePhoneLib*` suites, every suite under `components/website/blocks/__tests__`, and `bookingsSearchAndPaging.guard`. Result: 11 of 12 suites and 166 of 167 tests pass. The one failure is `bookingsSearchAndPaging.guard`, covered below.
- ESLint on the touched files: 0 errors and 1 warning. The warning is the existing unused `title` at `ContactFormBlock.tsx:154`, which this diff does not touch. Full `tsc --noEmit` shows no errors in any touched file.
- `.next` in the worktree (built 10:43; no touched source file is newer): every First Load chunk of the four gated routes was checked for each marker. The results are in the RC-6 row.

### RC-1 to RC-7

| # | Verdict | Evidence |
|---|---|---|
| RC-1 (a) | ✅ | Wait path: `setSubmitting(true)` is reset on the `null` exit and on the validation-error exit (`setSubmitting(false)`, which is a no-op on the loaded path). The send path's own `finally` is unchanged. |
| RC-1 (b) | ✅ | `formDataRef.current = formData` runs on every render. After the await, `current` is read for validation and for every body field. |
| RC-1 (c) | ✅ | `null` sets only `{ _form: phoneUnavailable }` and calls no `fetch`. The clearing effect uses a functional `setErrors` and clears only when `_form` is still that exact message, so an unrelated `labels.error` survives. |
| RC-1 (d) | ✅ | Stated in the workplan and in the `handleSubmit` comment. The test confirms "required" and no send. |
| RC-1, double press | ✅ | The `waitingForPhoneLib` ref returns early, so there is one wait. The test asserts `loadPhoneLib` runs once. |
| RC-2 (a)–(c) | ✅ | Cases (i), (ii) and (iii) are present. `RECORDED_ON_MAIN` holds literal strings: 15 cases, plus an es mobile and 2 country changes. `phoneUnavailable` is tested in he, en and es, then cleared by a later load. |
| RC-3 | ✅ | `onBlur` cancels the hand-off only when `relatedTarget != null`. The effect focuses only when the hand-off is pending **and** focus is on `null` or `body`. Both directions are tested. |
| RC-4 | ✅ | Compared line by line with `WebsiteCountrySelect.tsx:85-107`. Same `div.relative[dir=ltr]` wrapper, same `<button type="button">`, same class string for the closed state (`ap-line ap-hover-line` / `border-red-500`), same `minHeight: 42px`, same flag span, `+code` span and `ChevronDown` classes. Only the `isOpen` branch differs, and it cannot occur on a stub. `aria-hidden` and `tabIndex={-1}` are set. |
| RC-5 | ✅ | Both first-render modules are scanned with `isLibraryValue`. `publicFormCountry.ts` is checked as type-only, and the check asserts at least one such import, so it cannot pass vacuously. Each allow-list entry carries its reason. The header is updated. The public-surface scan was mutation-checked by the Dev. |
| RC-6 | ✅ | See the marker ruling below. Owner lazy-chunk delta is reported: barrel +1.8 kB gz, not First Load. |
| RC-7 | ✅ | `getByLabelText` finds the read-only placeholder before arrival, and a different, editable `PhoneInputInput` after. The `PhoneInput` `id` prop is passed through. |

### Rulings on the questions put to SA

1. **Focus target through the wrapper `querySelector('input')` instead of a ref (deviation 1). ✅ Accepted.**
   - The library's `.d.ts` really does type `ref` as the class instance.
   - Inside `.PhoneInput`, the first `input` is the number box. The library's native country control is a `<select>`, so it does not match.
   - The test asserts that `document.activeElement` is the `PhoneInputInput`, which pins this.
2. **`contactFormFields.test.tsx` mocks the loader as pending (deviation 2). ✅ Accepted.**
   - The suite is about which fields exist. The placeholder is still `input[type="tel"]`, so its existing assertion still means what it did.
   - The real load is covered by the new behaviour file and by the PERF-2 loader suites.
   - The remaining `jsx`/`global` console warnings in both files come from `<style jsx global>` rendering without the styled-jsx Babel plugin under Jest. That predates this change and is not a defect.
3. **RC-6 marker evidence (AC-2.1). ✅ Accepted as AC-2.1 evidence, and SA's original marker is withdrawn.**
   - SA re-ran the check on the worktree's build.
   - On all four gated routes, `PhoneInputCountryIcon`, `libphonenumber` and `Search countries...` are each absent from every First Load chunk.
   - `PhoneInputCountry` matches only `3484`, the block's own 5.2 kB gz chunk. Both of its occurrences are inside the `<style jsx global>` CSS text (`.phone-input-contact .PhoneInputCountry{display:none!important}` and the `.has-error` rule). That stylesheet is unchanged by design (SA-8).
   - SA also checked the library's metadata key `country_calling_codes`. It is present only in the lazy chunk `4958` and in no First Load chunk.
   - `3484` does contain `isValidPhoneNumber`, but only as a property access on the loaded module (`e.isValidPhoneNumber(n)`). Property names survive minification, so this is not library code.
   - For future slices: a CSS class name is not a library marker once the host keeps the library's styles. Use code-only markers.
4. **Sizes. ✅**
   - Gated routes: −47 kB (site routes) and −44 kB (contact routes), each more than 4× the ≥ 10 kB gate.
   - The 3 kB gap between the two is the browser logger on the contact routes, which SA accepted at workplan review.
   - Owner First Load is unchanged. The +1.8 kB on the lazy barrel is the accepted cost of the single-barrel design.
   - `/business-os/website` First Load is unchanged at 535 kB. The 108 → 111 kB page-chunk attribution shift is explained, and the route carries no phone code before or after.
5. **BQ-5 failure behaviour. ✅**
   - Without a loaded library there is no path to `fetch`: `lib` must be non-null to reach validation, and validation runs `lib.isValidPhoneNumber`.
   - Failure shows the "please try again" copy in all three locales, keeps the typed fields, and re-enables Send.
   - A failure retries on any re-render (the PERF-2 hook) and on focusing or pressing the placeholder.
   - The failure is logged once per attempt by the existing Pino `logger.warn` in the loader.
6. **No `name` on the placeholder. ✅** It is absent from the source and asserted absent in the test.
7. **Hook rules. ✅**
   - Every new hook is called unconditionally at the top level, before the `submitted` early return (`:354`): `usePhoneLib`, three `useRef`, two `useEffect`.
   - Effect dependencies are complete (`[phoneLib]`; `[phoneLib, phoneUnavailableMessage]`).
   - The placeholder has no hooks.
8. **No `console.*`. ✅** There are 0 calls in every touched or new file, tests included. Logging stays on the loader's Pino logger.
9. **Pre-existing `bookingsSearchAndPaging.guard` failure. ✅ Unrelated, confirmed.**
   - `components/crm/contact-drawer` has no diff against `origin/main`.
   - `core.autocrlf=true`, and `BookingsTab.tsx` is checked out with CRLF line terminators.
   - The failing assertion is a multi-line `toContain` against the source (`Received string` shows the CRLF-joined slice).
   - It fails only on a Windows checkout, not on the Linux CI. It is not this slice's to fix. It is worth a separate chip so the guard normalises `\r\n`.

### Code Review Comments

None blocking.

### Optimisation Suggestions (non-blocking)

1. `PublicPhoneFieldPlaceholder.tsx` `onBlur`, Low. When the visitor focuses the placeholder and then clicks a non-focusable area, `relatedTarget` is null, so the pending hand-off survives. When the library arrives, focus goes to the phone box. That moves focus to the field the visitor last chose, not away from another field, so RC-3 holds. If QA finds it surprising, the fix is to re-check after a tick: if the placeholder is still connected, the visitor left, so clear the pending hand-off.
2. `phoneLibLazy.guard.test.ts` `PUBLIC_SURFACE_DIRS`, Low. Other unauthenticated trees (`app/book`, `app/invoice`, `app/proposal`, `app/website-preview`, `app/landing-preview`) are not scanned. They hold no library import today, and the gated routes are covered. Adding them would make the "no public file imports it" claim match its name. This can wait for a later slice.
3. `usePhoneLib.ts` header still says "the owner-side phone library". The file is out of this slice's scope; update it whenever that file is next touched. The same goes for the logger-in-failure-branch idea from the workplan review.
4. Add a chip to make `bookingsSearchAndPaging.guard` CRLF-tolerant (`source.replace(/\r\n/g, '\n')`).

### Code Approved for QA: Yes

QA's manual list stands as written in the Test plan: AC-2.2 to AC-2.5, AC-2.8 to AC-2.11, the RC-4 bounding-box comparison, and the iOS keyboard note under AC-2.5.

---

## QA Testing Report

**QA — 2026-10-14** (worktree `neuronforge-br2`, branch `feature/perf-br2-contact-form-phone`, uncommitted on `0aee8efa`)
**Test mode:** full
**Strategy used:** A (Jest unit and jsdom behaviour, plus mutation probes) for logic. D (manual browser check on a production build) for the visual, timing and network criteria, as a checklist for the main session. Jest cannot measure layout, paint or chunk timing.
**Focus:** ui, performance, schema (same-output)
**Skipped:** none. The browser part is handed to the main session (QA has no browser here).
**Input source:** TL prompt

### Automated runs

| Run | Result |
|---|---|
| `npx jest` on `phoneLibLazy.guard`, `publicFormCountry`, `contactFormPhoneOnDemand.client`, `contactFormFields` | **4/4 suites, 65/65 tests pass** |
| `npx jest components/website/blocks components/crm components/scheduling` | 41/42 suites, 562/563 tests. The one failure is `components/crm/contact-drawer/__tests__/bookingsSearchAndPaging.guard.test.ts` › "searches the status word the owner can actually see" |
| The failure is unrelated | Confirmed. `BookingsTab.tsx` is untouched by this branch. It has CRLF line endings on disk (`core.autocrlf=true`; `file` reports "with CRLF line terminators"), and the test does `toContain('one.booking.start_time\n      ).text;')` with a bare `\n`. This is the known Windows CRLF issue (agrees with SA ruling 9) |
| Console noise in the behaviour suite | `Received true for a non-boolean attribute jsx/global`: styled-jsx is not transformed under Jest. This predates BR-2 (agrees with SA ruling 2) |
| First Load content check on the Dev's `.next` (built 10:43, after the last source edit) | Exit 0. None of `libphonenumber`, `PhoneInputCountryIcon` or `Search countries...` appears in the `/layout` + page chunks of the four gated routes. The library is only in lazy chunks `4958.*` (library) and `3205.*` (barrel + `WebsiteCountrySelect`) |

### Mutation probes (all restored)

`ContactFormBlock.tsx` was backed up to the scratchpad before the probes and copied back after each one. Afterwards its sha256 (`06feebfa…`) and the sha256 of the whole `git diff` (`62ba1c5a…`) were identical to the Dev's version. No other file was edited, and `git stash` was not used.

| # | Mutation | Expected | Result |
|---|---|---|---|
| 1a | Static `import PhoneInputStatic from 'react-phone-number-input'` in `ContactFormBlock` | Guard fails | ✅ **Killed.** 2 guard tests fail: "ContactFormBlock.tsx imports no value that carries the library" and "no public-surface file imports the library statically" |
| 1b | Static `import { WebsiteCountrySelect } from './WebsiteCountrySelect'` | Guard fails | ✅ **Killed.** 3 guard tests fail, including "WebsiteCountrySelect is imported only by the phoneLib barrel…" |
| 2a | RC-1: after a failed load, `fetch` the form **and** still show `phoneUnavailable` (so only the no-fetch assertion can catch it) | A test fails | ✅ **Killed.** 3 tests fail (he/en/es "when the library cannot load") at `expect(fetchMock).not.toHaveBeenCalled()`, received 1 call |
| 2b | RC-1: after a failed load, fall through with a permissive `isValidPhoneNumber: () => true` (the "unchecked number" route) | A test fails | ✅ **Killed.** The same 3 tests fail |
| 3 | RC-2a(iii): remove the `waitingForPhoneLib` double-press guard | A test fails | ✅ **Killed.** "pressed twice quickly waits once and sends nothing" fails |
| 4 | RC-3: replace the `activeElement` null/body check with `true` (focus may be stolen) | A test fails | ⚠️ **Survived**, 30/30 pass. See Edge Case 1 |

### Test Coverage

Key: **V** = verified by an automated test (evidence given). **L** = logic-level only (code read). **M** = needs the manual browser check below.

| AC | Tested? | Result | Evidence / what is left |
|---|---|---|---|
| AC-2.1 First Load, ≥ 10 kB down, no library | ✅ V (Dev build + QA content check) / **M** (re-run on the main session's build) | Pass | Dev route table: site routes 286→239 kB, contact routes 184→140 kB. QA script found 0 marker hits in First Load. Guard pins the source (probes 1a/1b). `/business-os/website` reported only (O-5) |
| AC-2.2 Chunk requested after paint, no click | ⚠️ L + **M** | Logic pass | `usePhoneLib` effect runs after hydration. M-2 |
| AC-2.3 No layout shift, identical boxes | ⚠️ L + **M** | Logic pass | The stub copies the real trigger's element, classes, inline `minHeight`, flag and `+code` (QA compared it with `WebsiteCountrySelect.tsx:85-107`). Calling codes are pinned to `getCountryCallingCode`. Pixel parity: M-3 |
| AC-2.4 Swap within 2 s of hydration (Fast 3G) | ⚠️ **M** | Not run | M-2. Real Fast 3G throttling is only possible if the in-app browser offers it |
| AC-2.5 Focus hand-off | ✅ V (jsdom) + **M** | Pass | Tests "moves into the real number box when the library arrives" and "is never stolen back from a field the visitor moved to". The `activeElement` layer is untested (probe 4). M-4 |
| AC-2.6 Send before arrival → sending, then "required", nothing sent; loaded + filled → one send | ✅ V + **M** | Pass | RC-2a (i) and (iii) (probe 3 killed) and (ii) "sends exactly once with today's body". M-5 |
| AC-2.7 Same-output, he/en/es × 5 inputs | ✅ V | Pass | 18 `RECORDED_ON_MAIN` cases with literal strings, real library, values read from the `fetch` body. One live submission in M-7 |
| AC-2.8 Country dropdown unchanged | ✅ V (rewrite on change) / L (search) | Pass | Two country-pick cases (he → US rewrites to `+12015550123`; he → UK invalid). Same component and props, so search is logic-level. Spot-check in M-6 |
| AC-2.9 Library blocked → try again, fields kept, nothing sent; unblock → loads | ✅ V + **M** | Pass | Failure tests in he/en/es: `phoneUnavailable` shown, no required/invalid message, fields kept, no `fetch`, cleared on a later load (probes 2a/2b killed). M-6 |
| AC-2.10 Dark template and RTL | ⚠️ **M** | Not run | M-3, on a dark-template Hebrew page if one exists |
| AC-2.11 Consent, success, sidebar identical | ⚠️ L + **M** | Logic pass | The diff leaves those lines untouched. The `fetch` body now reads `current.*` (from `formDataRef`) instead of `formData.*`: same keys, same values (RC-2a(ii)). Success screen seen in M-7 |

### Issues Found

#### Bugs (must fix before commit)
None found.

#### Performance Issues (should fix)
None. The logger cost on the contact routes (about 3 kB) was accepted by SA.

#### Edge Cases (nice to fix)
1. **The RC-3 "never steal focus" check has no test of its own** — `components/website/blocks/__tests__/contactFormPhoneOnDemand.client.test.tsx` — Severity: Low.
   - SA's RC-3 row reads "both directions are tested", but probe 4 shows that only the first layer is exercised. Probe 4 replaced `if (active === null || active === document.body)` with `if (true)`, and all 30 tests still pass.
   - The "is never stolen back" test moves focus with `.focus()`. That fires a blur with `relatedTarget` set, so `onFocusMovedAway` clears the pending flag and the effect never reaches the `activeElement` check.
   - Suggested test: focus the placeholder, dispatch `blur` with no `relatedTarget`, focus another field, resolve the library, and assert the other field keeps focus. The code is correct today; this only protects it.
2. **While the chunk is blocked, every re-render retries and logs a warning** — `components/crm/usePhoneLib.ts` (PERF-2, unchanged). The warnings go to the browser console only (Pino browser `asObject`, no transmit). Noted only.

### Manual checklist for the main session (production build, in-app browser)

**Setup**
- **S-1.** In the worktree, run `npm run build`. Record "First Load JS" in the route table for `/site/[subdomain]`, `/site/[subdomain]/[slug]`, `/site/[subdomain]/contact` and `/c/[userCode]/contact`. Expected: about 239 / 239 / 140 / 140 kB (base 286 / 286 / 184 / 184). Each must be at least 10 kB down.
- **S-2.** Run this content check from the worktree root with `node -e '<paste>'`, or save it under the scratchpad and run it. Expected: exit 0 and `hits=none` on all four routes. Note the lazy chunk ids it prints (today `4958` and `3205`), because they change with each build.

  ```js
  const fs=require('fs'),p=require('path');const m=require(p.resolve('.next/app-build-manifest.json')).pages;
  const R=['/site/[subdomain]','/site/[subdomain]/[slug]','/site/[subdomain]/contact','/c/[userCode]/contact'];
  const K=['libphonenumber','PhoneInputCountryIcon','Search countries...'];let bad=0;
  for(const r of R){const keys=Object.keys(m).filter(k=>k===r+'/page'||(k.endsWith('/layout')&&(r+'/').startsWith(k.slice(0,-6))));
   const fl=[...new Set(keys.flatMap(k=>m[k]))].filter(f=>f.endsWith('.js'));
   const hits=fl.flatMap(f=>{const s=fs.readFileSync(p.join('.next',f),'utf8');return K.filter(x=>s.includes(x)).map(x=>p.basename(f)+':'+x)});
   if(hits.length)bad++;console.log(r,'chunks='+fl.length,'hits='+(hits.join(' ')||'none'))}
  console.log('lazy:',fs.readdirSync('.next/static/chunks').filter(f=>/\.js$/.test(f)&&/libphonenumber|Search countries\.\.\./.test(fs.readFileSync(p.join('.next/static/chunks',f),'utf8'))).join(' '));
  process.exit(bad?1:0);
  ```

- **S-3.** Run `npm run start`. Pick a **test** business that has a published site with a `contact_form` block, ideally one Hebrew (RTL, dark template if available) and one English or Spanish. Pages: `http://localhost:3000/site/<sub>`, `/site/<sub>/contact`, `/c/<userCode>/contact`. ⚠️ This build talks to the **prod** database. Only M-7 may reach `/api/website/forms/contact`; every other step installs the fetch trap T-2 first.
- **S-4.** The loaded library is kept for the life of the page. Each delay or block run therefore needs a fresh hard load of a page **without** the block (for example `/site/<sub>/privacy`). Then install T-1 and **soft-navigate** to the contact page with `window.next.router.push('/site/<sub>/contact')`. Check first that `window.next?.router` exists; if it does not, click an in-site link to the contact page. The console must print `[BR2]` only after the navigation. If it never prints, the chunk was already loaded: hard-reload and repeat.

**Console helpers**

T-1 delays or blocks the phone chunks, and records layout shifts. Put in the chunk ids from S-2.

```js
(() => {
  const CHUNKS = /\/static\/chunks\/(4958|3205)\./;   // ids from S-2
  window.__br2Mode = 'delay';                          // 'delay' | 'block'
  const DELAY_MS = 20000;
  const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  window.__br2Unpatch = () => Object.defineProperty(HTMLScriptElement.prototype, 'src', d);
  Object.defineProperty(HTMLScriptElement.prototype, 'src', { configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      if (!CHUNKS.test(v)) return d.set.call(this, v);
      console.log('[BR2]', window.__br2Mode, v, Math.round(performance.now()));
      if (window.__br2Mode === 'block') return d.set.call(this, v.replace('/_next/static/', '/_next/static/__blocked__/'));
      setTimeout(() => { console.log('[BR2] released', Math.round(performance.now())); d.set.call(this, v); }, DELAY_MS);
    } });
  window.__shifts = [];
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__shifts.push({ v: e.value, t: Math.round(e.startTime), input: e.hadRecentInput })))
    .observe({ type: 'layout-shift', buffered: true });
})();
```

T-2 is a fetch trap. It does **not** send unless `window.__forward = true`.

```js
(() => { const of = window.fetch; window.__posts = []; window.__forward = false;
  window.fetch = function (u, i) {
    if (String(u).includes('/api/website/forms/contact')) {
      window.__posts.push(i && i.body ? JSON.parse(i.body) : null);
      if (!window.__forward) return Promise.resolve(new Response('{"success":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return of.apply(this, arguments); }; })();
```

T-3 records the phone row's boxes, in page coordinates.

```js
window.__box = () => { const num = document.querySelector('.phone-input-contact input');
  const row = num.closest('[dir="ltr"].flex'); const cc = row.querySelector('div.relative > button');
  const r = el => { const b = el.getBoundingClientRect(); return [b.x, b.y + scrollY, b.width, b.height].map(n => +n.toFixed(1)).join(','); };
  const label = [...document.querySelectorAll('label')].find(l => l.htmlFor === num.id);
  return { readOnly: num.readOnly, id: num.id, labelTargetsIt: !!label && label.control === num, focused: document.activeElement === num,
    row: r(row), country: r(cc), number: r(num), numberBox: r(num.closest('.phone-input-contact')), submit: r(document.querySelector('form button[type="submit"]')) }; };
```

**Checks**

| # | Step | Pass when |
|---|---|---|
| M-1 (AC-2.1) | S-1 and S-2 | All four routes are at least 10 kB down, the content check exits 0, and the lazy chunk ids are recorded |
| M-2 (AC-2.2, AC-2.4) | Hard-load `/site/<sub>/contact` without T-1 and do not touch anything. Run `[performance.getEntriesByName('first-contentful-paint')[0].startTime, ...performance.getEntriesByType('resource').filter(e => /4958\|3205/.test(e.name)).map(e => [e.name.split('/').pop(), Math.round(e.startTime), Math.round(e.responseEnd)])]` (use the ids from S-2) | Both chunks were requested with no click, at a `startTime` after FCP. Unthrottled, the real field is already in place when you scroll to the form. If the browser offers Fast 3G with cache off, record the swap time against hydration (≤ 2 s). Otherwise mark AC-2.4 "not measurable in this browser" |
| M-3 (AC-2.3, AC-2.10) | S-4 with `__br2Mode='delay'`, plus T-2 and T-3. Do not scroll. Before release, run `a=__box()`. After `[BR2] released`, run `b=__box()` | `a.readOnly===true`, `b.readOnly===false`. `row`, `country`, `number`, `numberBox` and `submit` are identical in `a` and `b` (±0.5 px). `__shifts.filter(s=>!s.input)` has no entry near the release time. The placeholder shows the page's default flag with `+972` / `+1` / `+34`, in the template's colours. On a Hebrew (and dark) page the row stays left-to-right, with the flag box on the left |
| M-4 (AC-2.5, RC-7) | Fresh S-4 in delay mode each time. **(a)** Before release, `__box().labelTargetsIt===true`. Click the placeholder number box. After release, run `__box()`, then type `0501234567`. **(b)** Click the placeholder, then click the Name field before release. **(c)** Click the placeholder, then click an empty, non-focusable area of the page before release (SA suggestion 1) | (a) `focused:true, readOnly:false, labelTargetsIt:true`, and the digits appear in the real box. (b) After release the **Name** field still has focus. (c) Record where focus lands. SA's expected result is the real phone box; flag it only if it feels wrong. On iOS, record whether the keyboard opens (RC-3 note) |
| M-5 (AC-2.6) | Fresh S-4 in delay mode, plus T-2. Before release, type a name, email and message, then press Send | The button shows the spinner until release. Then today's "required" message appears under the phone ("שדה זה הוא חובה" / "This field is required" / "Este campo es obligatorio"), there is **no** "invalid phone" message, the typed fields are kept, and `__posts.length===0`. Then type a phone and press Send: `__posts.length===1` and the success screen appears. The trap answered, so nothing was stored |
| M-6 (AC-2.9, AC-2.8) | Fresh S-4 with `__br2Mode='block'`, plus T-2. Fill name, email and message, and press Send. Then run `__br2Unpatch()`, type one more character in Message, and wait | Before unpatching: Send re-enables, and "The phone field could not load. Please try again." (en) / "No se pudo cargar el campo de teléfono. Por favor, inténtalo de nuevo." (es) / "לא ניתן היה לטעון את שדה הטלפון. אנא נסה שוב." (he) appears above the button. The fields are kept, the phone row is still the placeholder, and `__posts.length===0`. After unpatching: the real field appears and the message clears. Open the country box, search "spa", pick Spain, and confirm that a typed national number is rewritten, as on main. Run this in each language that has a test site; Jest covers the rest |
| M-7 (AC-2.7, AC-2.11) — **the only real submission** | Hard-load the contact page (no T-1). Install T-2 and set `window.__forward=true`. Name: `QA BR2 2026-10-14`. Email: a plus-address on a mailbox you own (not `example.com`; the visitor gets a welcome email). Phone on a Hebrew page: `0501234567` (en page: `2015550123`; es page: `612345678`). Leave consent **unticked**. Message: `BR-2 QA, delete me`. Press Send **once** | `__posts[0].phone` is `+972501234567` (en `+12015550123`, es `+34612345678`), the literal values recorded from main. The keys are `subdomain, userCode, name, email, phone, message, service_interest, page_url, consent`. The success screen, consent checkbox and sidebar look as on main. The owner's CRM shows the new contact with the same number |
| M-8 cleanup (straight after M-7) | The route wrote one `crm_contacts` row (`source='website_form'`), or updated an existing contact with that email. It also wrote one `crm_activities` note, sent the owner a lead-alert email, and sent a welcome email to the visitor address. There is no consent or subscriber row, because consent was unticked | Delete the contact `QA BR2 2026-10-14` in that business's CRM (owner UI) and confirm it is gone from the list. Delete the two emails. If the CRM delete is soft, record that the row remains soft-deleted. Record in this report that the cleanup was done |

### Test Outputs / Logs

```text
Test Suites: 4 passed, 4 total
Tests:       65 passed, 65 total            (new + extended)

Test Suites: 1 failed, 41 passed, 42 total
Tests:       1 failed, 562 passed, 563 total (blocks + crm + scheduling)
FAIL bookingsSearchAndPaging.guard.test.ts › searches the status word the owner can actually see  (CRLF, pre-existing)

/site/[subdomain]          keys=/layout,/site/[subdomain]/page                        chunks=17 hits=none
/site/[subdomain]/[slug]   keys=/layout,/site/[subdomain]/[slug]/page                 chunks=17 hits=none
/site/[subdomain]/contact  keys=/layout,/site/[subdomain]/contact/page                chunks=10 hits=none
/c/[userCode]/contact      keys=/layout,/c/[userCode]/layout,/c/[userCode]/contact/page chunks=12 hits=none
lazy (libphonenumber): 4958.27d7662beb04e6f1.js   (barrel with "Search countries...": 3205.5f6da0d04fb802e3.js)
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Automated part passes: no bugs, and one Low edge case (a test gap, not a defect). **Ready for commit once the main session's manual checks M-1 to M-8 pass and the M-8 cleanup is recorded here.**

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Dev workplan for BR-2 on `origin/main` @ `d769b9e3`, with the baseline build. Awaiting SA review |
| 2026-10-14 | SA review folded in, implemented | RC-1 to RC-7 written into the plan and built. Worktree fast-forwarded to `0aee8efa`; re-baselined there. After-build: site routes −47 kB, contact routes −44 kB, previews −47/−48 kB, `/business-os/website` 0 (no gate). Library-only markers absent from every gated route's First Load. Status Code Complete; awaiting SA code review |
| 2026-10-14 | QA gap closed | Added one test for the RC-3 "never steal focus" branch (`activeElement` null/body check), which QA found uncovered. Probe: fails with the check removed, passes with it restored. Test file and workplan only; no product change |
| 2026-10-14 | SA code review | ✅ Code Approved for QA, no required changes. RC-1 to RC-7 verified; both deviations accepted; RC-6 code-only markers accepted as AC-2.1 evidence (SA re-checked the build); `bookingsSearchAndPaging.guard` confirmed pre-existing CRLF-only. 4 non-blocking suggestions |

### Manual browser checks: main session, 2026-10-14

The user chose **option 2: no real form submission**. Every send went through the T-2 fetch trap, so `/api/website/forms/contact` was never reached and nothing was stored or emailed. Production build of this branch on localhost:3005 against the user's test business `/site/<sub>/contact`. The site is a draft; the contact route serves unpublished businesses.

| # | Result |
|---|---|
| M-1 (AC-2.1) | ✅ Route table: `/site/[subdomain]` 239, `/[slug]` 239, `/site/[subdomain]/contact` 140, `/c/[userCode]/contact` 140 kB (base 286/286/184/184). The lazy chunk ids are `4958` (library) and `3205` (country select) |
| M-2 (AC-2.2) | ✅ A plain load with no clicks requests both chunks after hydration, and the real field is in place. FCP timing was not usable: the pane was hidden and the local server took about 90 s to render. AC-2.4 swap time on Fast 3G is **not measurable in this browser** |
| M-3 (AC-2.3) | ✅ Delay mode (20 s). Before the release: `readOnly:true`, the label targets the placeholder, 🇺🇸 +1. After the release, the row, country, number, numberBox and submit boxes are **identical to the pixel**, and there is no layout shift at the release (the only shift is 0.00003, before navigation) |
| M-4 (AC-2.5, RC-7) | ✅ (a) Clicked the placeholder; on arrival focus moved to the real input (`readOnly:false`, label targets it), and typing gave "(201) 555-0123". (b) is covered by the new Jest test (never-steal-focus). (c) was not run |
| M-5 (AC-2.6) | ✅ Send before arrival: the button stays busy and disabled until the release, then shows today's "This field is required" with no "invalid phone". Name, email and message are kept, and `__posts.length===0`. After a phone was typed: one trapped post with `phone: "+12015550123"`, which matches the main value, and the success screen showed |
| M-6 (AC-2.9) | ✅ Block mode: "The phone field could not load. Please try again." Send re-enabled, fields kept, placeholder kept, `__posts.length===0`. After unblocking plus one keystroke, the real field loaded and the message cleared. Note: QA's T-1 helper crashes the page in block mode (`v.replace is not a function`) because webpack passes a URL object; use `String(v)`. This is a harness bug, not a product bug |
| M-7 / M-8 | ⬜ Skipped by the user's decision (no real submission, so no cleanup is needed) |
| Not run | Hebrew or dark template (the test business is English), the iOS keyboard, and the Spanish/Hebrew failure copy (covered by Jest in he/en/es) |

**QA final status:** ✅ Ready for commit after the user sees the diff.
