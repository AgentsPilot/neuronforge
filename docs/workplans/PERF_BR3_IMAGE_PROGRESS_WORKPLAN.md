# Workplan: BR-3, Honest Progress While a Website Image Is Generated

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md](/docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md) §5 (BR-3), §9 BQ-6 to BQ-9, §8, §12 (SA-10, SA-11, C-12, C-13)
**Branch:** `feature/perf-br3-image-progress` (worktree `neuronforge-br3`, cut from `origin/main` @ `d769b9e3`)
**Date:** 2026-10-14
**Status:** Code Complete (awaiting SA code review; nothing committed)

## Overview

While a website picture is being generated (p50 53.4 s, p95 58.1 s), the media library picker shows only a spinner on the Generate button. BR-3 replaces that with honest progress: a placeholder in the slot's shape, "usually takes about a minute", a running timer, a "taking longer than usual" message after 75 s, and copy saying the picker can be closed and the same picture should not be requested again. BR-3 also makes closing the picker cancel the **client-side** automatic placement (`onSelect`) of the pending result. The request is not aborted. The route, service, provider call, pricing, ledger, credit charge and audit are untouched.

---

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Hosts of the picker (FR-3.10, AC-3.9, AC-3.11)](#hosts-of-the-picker-fr-310-ac-39-ac-311)
- [Implementation Approach](#implementation-approach)
- [How each FR and AC is met](#how-each-fr-and-ac-is-met)
- [Copy (en / es / he)](#copy-en--es--he)
- [§6 answer](#6-answer)
- [Metric](#metric)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Risks](#risks)
- [Side findings](#side-findings)
- [Pino / console census](#pino--console-census)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| Area | Finding (code on `origin/main` @ `d769b9e3`) |
|---|---|
| Picker | `components/website/MediaLibraryPicker.tsx` (399 lines). `generate()` (`:185-223`) sets `generating`, awaits `fetch('/api/website/media/generate')`, then on success calls `onSelect(url)` and `onClose()` (`:202-205`). The only feedback is the button's spinner plus `media.generate.working` (`:379-383`) |
| Close paths | Three: the backdrop `onClick={onClose}` (`:229`), the X button (`:250`), and choosing a library item (`onSelect(item.url); onClose()`, `:277-280`). There is no Escape handler |
| Why a closed picker still places the picture | Every host renders the picker conditionally and **unmounts** it on close, but the in-flight `generate()` closure still holds the host's `onSelect`, which calls the host's `onChange(url)`. The host is still mounted, so the picture is written into the slot (SA-11 (a), confirmed) |
| Credit signal | `notifyCreditUsageChanged()` in `finally` (`:221`). `components/business-os/__tests__/creditUsageSignal.raiseSites.test.tsx:179` pins **exactly one** call site in this file. BR-3 keeps exactly one |
| Copy | Owner dictionaries `lib/business-os/translations/{en,es,he}.ts`, read through `useLanguage().t()`. Existing `media.generate.*` keys at `en.ts:3783-3790`, `es.ts:3579-3586`, `he.ts:2031-2038`. A missing key renders as the key itself (`LanguageContext.tsx:421`). Key parity across the three files (both ways) is checked by `lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts` *(corrected per SA R-5)* |
| Server path | `app/api/website/media/generate/route.ts`, `lib/services/GeneratedImageService.ts`, `lib/ai/providers/openaiProvider.ts`, `lib/business-os/llm/*`: **not touched** (FR-3.9) |
| Aspect → size | Configured; defaults wide `1536x1024` (3:2), portrait `1024x1536` (2:3), square `1024x1024` (`GeneratedImageService.ts:70`, `:186-188`). The placeholder uses the same three ratios |
| Request pin today | `openaiProvider.image.test.ts:97-106` pins `size`, `quality`, `n: 1` at the provider. `GeneratedImageService.attribution.test.ts:164-173` pins model, size, quality, `n: 1`, but **not** the prompt with the style suffix (`GeneratedImageService.ts:403`) |

No scaffolding skill applies (no new route, repository or plugin). No entitlements import. No LLM call is added or changed, so `bos-llm-call-standards` does not apply beyond confirming the server path is untouched.

---

## Hosts of the picker (FR-3.10, AC-3.9, AC-3.11)

The requirement names three hosts: the website editor block, the dashboard configuration dialog through the logo uploader, and the wizard. **On `origin/main` only the first one can open the picker.** `MediaLibraryPicker` has a single importer, `components/website/MediaUploader.tsx:355`, and `MediaUploader` offers the Library and Generate buttons only when the caller passes `section` (`MediaUploader.tsx:325`, `{section && !disabled && (...)}`). Those buttons are the only setters of `libraryOpen` / `generateOpen` (`:337`, `:345`).

| Host | `MediaUploader` call site | Passes `section`? | Picker reachable? | Aspect |
|---|---|---|---|---|
| Website editor, hero block | `app/business-os/website/page.tsx:5770` | `hero` | **Yes** | portrait |
| Website editor, about block | `app/business-os/website/page.tsx:6074` | `about` | **Yes** | portrait |
| Website editor, team members | `app/business-os/website/page.tsx:7396` | `team` | **Yes** | square |
| Website editor, gallery | `app/business-os/website/page.tsx:7504` | `gallery` | **Yes** | wide |
| Website editor, logo cloud | `app/business-os/website/page.tsx:7657` | `logo_cloud` | **Yes** | square |
| Dashboard configuration dialog → Business tab → logo (`ConfigurationDialog.tsx:824` → `BusinessProfileSection.tsx:694`) | `BusinessProfileSection.tsx:694` | No | **No** | — |
| Website setup wizard, logo | `components/business-os/WebsiteSetupWizard.tsx:737` | No | **No** | — |
| Testimonial editor, photo | `components/website/TestimonialEditor.tsx:250` | No | **No** | — |

**Consequence (for SA, then BA):** AC-3.9 and AC-3.11 are verified on the five website-editor slots, which cover all three aspects. The configuration-dialog and wizard rows are recorded by QA as "picker not reachable on main, N/A". The picker's own comment (`MediaLibraryPicker.tsx:218-220`, "the dashboard's configuration dialog reaches it through the logo uploader") is stale; the fix lives in the shared picker, so a host added later is covered automatically. I do **not** propose making the picker reachable from the logo hosts (scope). The BA should note this in the requirement's §0 row when the workplan is approved.

---

## Implementation Approach

All changes are client-side, in the picker and the dictionaries.

1. **New presentational component `components/website/ImageGenerationProgress.tsx`** (`'use client'`). Props: `aspect`, `startedAt` (ms). It owns a 1 s `setInterval` that recomputes elapsed seconds from `Date.now() - startedAt` (not a counter, so a throttled background tab still shows the true time when it wakes). Keeping the timer in its own component means only the panel re-renders every second, not the picker's grid. It renders:
   - a picture-shaped placeholder: fixed height (`h-28`), width from the CSS ratio (`aspect-[3/2]` wide, `aspect-[2/3]` portrait, `aspect-square` square), `data-aspect` for tests, an indeterminate `animate-pulse` with `motion-reduce:animate-none`, `aria-hidden`;
   - a `role="status"` / `aria-live="polite"` text block with the main message (or the slow message after 75 s) and the two FR-3.7 lines. The timer is **outside** the live region (`aria-hidden`), so it is not announced every second (§6 accessibility);
   - the timer as `m:ss` inside `<span dir="ltr">`, so the digits read correctly in Hebrew.
   - No percentage and no `role="progressbar"` (FR-3.2).
   The 75 s threshold is a named constant `SLOW_AFTER_SECONDS = 75` with a comment tying it to the measured p95 (58.1 s).
2. **`MediaLibraryPicker.tsx`:**
   - Add `generationStartedAt` state, set in the same handler as `setGenerating(true)` **before** `fetch` is called, so the panel appears in the next frame (FR-3.1). Cleared in `finally`.
   - Render `<ImageGenerationProgress>` in the footer, directly above the prompt row, while `generating` is true. The footer is always visible (the grid scrolls), so the panel cannot be scrolled out of view.
   - **FR-3.10, the closed flag.** `const closedRef = useRef(false)`. One `close()` handler sets `closedRef.current = true` then calls `onClose()`; the backdrop, the X button and the library-item path all use it. A mount effect sets `closedRef.current = false` in its body and `true` in its cleanup, so a host that unmounts the picker by any other route is covered too. Setting `false` in the body matters: React StrictMode (dev) runs mount → cleanup → mount, and a cleanup-only flag would wrongly stay `true` and swallow every placement in development.
   - After `await response.json()`: `setAllowance` as today; then, on success, `if (closedRef.current)` skip `onSelect` and `onClose`. No client log (removed per SA R-4). Otherwise `onSelect(url); onClose()` exactly as today.
   - Refusal / failure paths are unchanged; on a closed picker the state updates are no-ops.
   - `finally` keeps `setGenerating(false)` and the **single** `notifyCreditUsageChanged()` call, so the credits card still refreshes when a closed picker's picture is charged (FR-3.5).
   - No `AbortController`, no `signal`, no timeout, no retry (FR-3.3, FR-3.10).
   - Generate stays disabled while `generating` (FR-3.4, unchanged).
   - Update the stale host comment at `:218-220`.
3. **Dictionaries:** five new keys under `media.generate.progress_*` in all three files, next to the existing `media.generate.*` block.
4. **Test-only pin for AC-3.5:** add the prompt-with-style-suffix assertion to `GeneratedImageService.attribution.test.ts`. This is a test file, not a production file under FR-3.9.

**Why no new pattern:** a client component with a `useEffect` interval and a `useRef` "still wanted?" flag are both ordinary React already used in the codebase. No new hook file is needed; the interval lives in the component that displays it.

---

## How each FR and AC is met

| Item | How |
|---|---|
| FR-3.1 / AC-3.1 | Panel state is set synchronously in the click / Enter handler before `fetch`, so it paints in the next frame. Placeholder ratio comes from the picker's `aspect` prop (wide 3:2, portrait 2:3, square 1:1). Jest asserts the panel is present before the mocked fetch resolves; QA measures ≤ 1 s in a production build |
| FR-3.2 / AC-3.2 | Indeterminate pulse only. No `%`, no `progressbar` role, no width-animated bar. Jest asserts no `progressbar` role and no `%` in the panel text. "About a minute" is from the measured p50 53.4 s / p95 58.1 s |
| FR-3.3 / AC-3.3 | At elapsed ≥ 75 s the main message is replaced by `progress_slow`. Jest with fake timers: absent at 74 s, present at 75 s, `fetch` called once and with no `signal` |
| FR-3.4 | Unchanged `disabled={... generating ...}` on the input and button |
| FR-3.5 / AC-3.4 | Success, refusal and failure branches unchanged for an open picker; `setAllowance` and the one `notifyCreditUsageChanged()` unchanged. Existing `creditUsageSignal.raiseSites` tests keep passing (including the one-call-site census) |
| FR-3.6 / AC-3.7 | The panel is bound to `generating`, which `finally` clears as soon as the answer arrives. No minimum display time. Jest: a refusal reply ends the panel and shows the error |
| FR-3.7 / AC-3.10 | Two lines inside the panel: `progress_can_close` and `progress_no_repeat`. Both promise only what SA-11 confirmed (saved to the library) and do **not** promise placement |
| FR-3.8 / AC-3.8 | Five keys in en / es / he; picker root already sets `dir` from `isRTL`. Jest checks each new key exists and is non-empty in all three dictionaries |
| FR-3.9 / AC-3.5 | No file under FR-3.9 changes. Code review: `git diff --name-only origin/main` lists none of the route, service, provider, `lib/business-os/llm/*` or config files. Existing provider pin (`openaiProvider.image.test.ts:97`) plus the new prompt+style pin in the service test |
| AC-3.6 | QA, one real generation on a test account: one `token_usage` row, one audit entry, one credit charge, same price basis |
| FR-3.10 / AC-3.11 | `closedRef` guard; per-host QA on the five editor slots (see Hosts). Jest: X, backdrop, library-item choice and unmount during generation each lead to no `onSelect` for the late result; `fetch` not aborted; credit signal still raised |
| AC-3.9 | Same shared component in every reachable host; QA checks the five editor slots; configuration dialog and wizard recorded N/A |

---

## Copy (en / es / he)

**Where:** `lib/business-os/translations/en.ts` (after `:3790`), `es.ts` (after `:3586`), `he.ts` (after `:2038`), read with `useLanguage().t()`. `{time}` is substituted by `t()`'s `vars` (`LanguageContext.tsx:422-425`).

| Key | en | es | he |
|---|---|---|---|
| `media.generate.progress_title` | Creating your picture. This usually takes about a minute. | Estamos creando tu imagen. Suele tardar alrededor de un minuto. | יוצרים את התמונה שלכם. זה לוקח בדרך כלל כדקה. |
| `media.generate.progress_slow` | Taking longer than usual, still working. | Está tardando más de lo habitual, seguimos trabajando. | לוקח יותר זמן מהרגיל, עדיין עובדים על זה. |
| `media.generate.progress_elapsed` | Elapsed | Tiempo transcurrido | זמן שעבר |
| `media.generate.progress_can_close` | You can close this window. The picture will still be saved to your library. | Puedes cerrar esta ventana. La imagen se guardará igualmente en tu biblioteca. | אפשר לסגור את החלון. התמונה תישמר בכל זאת בספרייה שלכם. |
| `media.generate.progress_no_repeat` | Please don't ask for the same picture again while this one is being made, or you may be charged twice. | No pidas la misma imagen otra vez mientras se está creando, o podría cobrarse dos veces. | אל תבקשו את אותה תמונה שוב בזמן שהיא נוצרת, אחרת ייתכן שתחויבו פעמיים. |

The existing button label `media.generate.working` stays. Copy wording is reviewable by the user in the diff.

---

## §6 answer

Restated from requirement §5.7 for SA confirmation (definition of done, item 1).

| Q | Answer | Why |
|---|---|---|
| Q1 Output | **Yes** (accepted) | New waiting experience; and closing the picker during generation no longer places the picture in the slot (BQ-9). The picture itself is unchanged: identical request (AC-3.5) |
| Q2 Money | No | No server file changes. Same price basis, one ledger row, one credit charge per picture (AC-3.6). The double-charge race is unchanged and only warned about (§8) |
| Q3 Timing | No | Generation takes as long as today; no client timeout is added |
| Q4 Scope | No | Nothing removed. Closing still saves the picture to the library |
| Q5 Failures and records | No | No timeout, retry, fallback or abort. Same records on success, refusal, failure and close (AC-3.6, AC-3.11) |

---

## Metric

| Metric | Method | Baseline | After (target) |
|---|---|---|---|
| Time to first useful feedback (shape + expected duration + elapsed time) after pressing Generate | QA, production build (`next build && next start`), DevTools Performance recording from the click event to the first frame that paints the panel, 5 runs, median | None until the finished picture: p50 53.4 s / p95 58.1 s (R13). The button spinner is immediate but carries none of the three | ≤ 1 s; expected one to two frames (< 100 ms), since the state is set synchronously before `fetch` |
| Guard: generation time | `token_usage.latency_ms` for `image_generation`, 14 days after merge | p50 53.4 s / p95 58.1 s | Unchanged (reported, not gated) |
| Guard: cost per image | `token_usage.cost_usd` and credit charges for `image_generation` | $0.25 | Identical |

Per §2 rule 3 and C-12, this is an acceptance check, not a speed gain; BR-3 is kept for its visible benefit and recorded in the scoping document §11.3.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/website/ImageGenerationProgress.tsx` | create | Placeholder, messages, timer, 75 s switch, live region; isolates the per-second re-render |
| `components/website/MediaLibraryPicker.tsx` | modify | Start time state, render the panel, `close()` + `closedRef` guard (FR-3.10), stale host comment |
| `lib/business-os/translations/en.ts` | modify | Five new keys |
| `lib/business-os/translations/es.ts` | modify | Five new keys |
| `lib/business-os/translations/he.ts` | modify | Five new keys |
| `components/website/__tests__/MediaLibraryPicker.progress.test.tsx` | create | jsdom behaviour tests (below) |
| `lib/services/__tests__/GeneratedImageService.attribution.test.ts` | modify (test only) | Pin the prompt with the style suffix (AC-3.5) |
| `docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` | modify (docs) | §0 rows for workplan / SA / merge, host-list finding, side finding |
| `docs/workplans/PERF_BR3_IMAGE_PROGRESS_WORKPLAN.md` | create | This file |

**Not modified (FR-3.9):** `app/api/website/media/generate/route.ts`, `lib/services/GeneratedImageService.ts`, `lib/ai/providers/openaiProvider.ts`, `lib/business-os/llm/*`, `lib/repositories/SystemConfigRepository.ts`, any migration. `components/website/MediaUploader.tsx` and every host page are not modified.

---

## Task List

- [ ] 1. SA approves this workplan (including the host-list finding and the side-finding decision)
- [ ] 2. Add the five keys to en / es / he
- [ ] 3. Create `ImageGenerationProgress.tsx`
- [ ] 4. Wire it into `MediaLibraryPicker.tsx`; add `close()` + `closedRef` (with StrictMode-safe effect); keep one `notifyCreditUsageChanged()` call
- [ ] 5. Write `MediaLibraryPicker.progress.test.tsx`; add the prompt+style pin
- [ ] 6. Run the targeted Jest set and `npx tsc --noEmit` (scoped check of touched files); `npm run lint` on touched files
- [ ] 7. Confirm `git diff --name-only origin/main` contains no FR-3.9 file; `git diff --stat` sanity check (no deletion-only file)
- [ ] 8. Hand to SA for code review; changes left uncommitted
- [ ] 9. Update the requirement §0 row

---

## Test Plan

**New:** `components/website/__tests__/MediaLibraryPicker.progress.test.tsx` (`@jest-environment jsdom`, same mocks as `creditUsageSignal.raiseSites.test.tsx`: `t` returns the key, logger mocked). `fetch` is a jest mock; the generate reply is a manually resolved promise so the "in flight" state can be inspected.

| # | Test | Covers |
|---|---|---|
| T1 | After clicking Generate, before the reply resolves: the placeholder and `progress_title`, `progress_can_close`, `progress_no_repeat` are rendered | FR-3.1, FR-3.7 |
| T2 | Placeholder `data-aspect` is `wide` / `portrait` / `square` for each `aspect` prop | AC-3.1 shape |
| T3 | Enter in the prompt starts the same progress state | FR-3.1 |
| T4 | No `role="progressbar"` and no `%` anywhere in the panel | FR-3.2, AC-3.2 |
| T5 | Fake timers: at 74 s no `progress_slow`; at 75 s `progress_slow` replaces `progress_title`; `fetch` for generate called exactly once and its init has no `signal` | FR-3.3, AC-3.3 |
| T6 | Timer text advances (`0:00` → `0:05` after 5 s) and is outside the `aria-live` region; the region has `aria-live="polite"` | §6 accessibility |
| T7 | Success while open: `onSelect('https://x/y.png')` once, then `onClose` once; panel gone | AC-3.4, FR-3.5 |
| T8 | Refusal (`depicts_people`, `limit_reached`, `unavailable`, `failed`) and a thrown fetch: panel gone immediately, error shown, `onSelect` not called | FR-3.6, AC-3.7 |
| T9 | **Closed via X during generation, then success arrives: `onSelect` is NOT called**, `onClose` called once (by the X only), `fetch` not aborted, credit signal raised once | FR-3.10, AC-3.11 |
| T10 | Same as T9 via the backdrop | FR-3.10 |
| T11 | During generation, the owner chooses a library item: `onSelect` called once with the item URL; the late generated URL is never passed | FR-3.10 |
| T12 | Host unmounts the picker during generation (`unmount()`), then success: `onSelect` NOT called | FR-3.10 |
| T13 | Rendered inside `<React.StrictMode>`: a normal success still calls `onSelect` (guards the ref-reset pitfall) | FR-3.10 regression |
| T14 | Each new `media.generate.progress_*` key exists and is non-empty in `en`, `es` and `he` (imports the three dictionary modules directly) | FR-3.8, AC-3.8 |

**Extended:** `lib/services/__tests__/GeneratedImageService.attribution.test.ts`: assert the provider request `prompt` equals `` `${PROMPT}. ${STYLE}` `` with the style string copied as a literal into the test (a deliberate pin: a change to the style fails the test). Together with `openaiProvider.image.test.ts:97` this covers AC-3.5.

**Existing, must stay green:** `components/business-os/__tests__/creditUsageSignal.raiseSites.test.tsx` (behaviour + one-call-site census), `lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts`, `lib/ai/providers/__tests__/openaiProvider.image.test.ts`, `lib/services/__tests__/GeneratedImageService.attribution.test.ts`.

**Command:**

```bash
npx jest components/website/__tests__/MediaLibraryPicker.progress.test.tsx components/business-os/__tests__/creditUsageSignal.raiseSites.test.tsx lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts lib/services/__tests__/GeneratedImageService.attribution.test.ts lib/ai/providers/__tests__/openaiProvider.image.test.ts
```

No CI time is added beyond a handful of jsdom tests in the existing sharded suite.

**Manual (QA):** AC-3.1 (5 runs, production build, three aspects), AC-3.3 (DevTools throttling or a held response; one request in Network), AC-3.6 and AC-3.11 (real generation on a test account, per editor slot), AC-3.8 (he / es, RTL), AC-3.9.

---

## Risks

| Risk | Mitigation |
|---|---|
| StrictMode double-mount leaves `closedRef` stuck at `true`, so pictures never place in development | Effect sets `false` in its body and `true` in its cleanup; T13 pins it |
| A future refactor adds a second `notifyCreditUsageChanged()` for the closed path | Not needed: `finally` already runs on the closed path; the existing census test fails on a second call site |
| Website editor: a late result could land in a **different** block than the one the owner generated for (host `onChange` writes to whichever block is being edited) | Removed by FR-3.10 for any closed picker, which is the only way the editing block can change |
| Owner closes, reopens and generates the same description again (new picker instance, `generating` is false) and is charged twice | Not fixed by BR-3 (§8). The `progress_no_repeat` line warns. Server fix is a separate item |
| "About a minute" goes stale if the images model changes (SA-12) | 75 s message covers the tail; copy re-checked with any model change |
| A per-second re-render of the whole picker (large grid) | Timer lives in `ImageGenerationProgress`, so only that subtree re-renders |
| Throttled background tab makes a counter-based timer lie | Elapsed computed from `Date.now() - startedAt` |
| The panel pushes the footer taller on small screens | Placeholder fixed at `h-28`; dialog already `max-h-[80dvh]` with a scrolling body; QA checks on a narrow viewport |
| Requirement names hosts that cannot open the picker | Recorded above; AC-3.9 / AC-3.11 scoped to reachable hosts, pending SA/BA confirmation |

---

## Side findings

| # | Finding | Proposal |
|---|---|---|
| SF-1 | **A people refusal shows a raw key today.** The service returns `reason: 'depicts_people'` (`GeneratedImageService.ts:219`, `:297`) and the picker renders `t('media.generate.' + reason)` (`MediaLibraryPicker.tsx:211`), but the dictionaries only have `media.generate.no_people` (`en.ts:3786`, `es.ts:3582`, `he.ts:2034`). `t()` falls back to the key, so the owner sees `media.generate.depicts_people`. AC-3.7 asks QA to confirm "today's message" for this refusal, and AC-3.8 says no keys shown | **SA to decide.** Option A (recommended, tiny, client only): add `media.generate.depicts_people` to all three dictionaries with the existing `no_people` text, so the picker shows the sentence that was clearly intended. Option B: leave it and log a separate fix. Either way it is not a server change |
| SF-2 | The picker comment `MediaLibraryPicker.tsx:218-220` and the requirement's host list say the configuration dialog reaches the picker through the logo uploader; on main it does not (no `section`) | Fix the comment in this slice; BA notes it in §0 |

---

## Pino / console census

| File | `console.*` count |
|---|---|
| `components/website/MediaLibraryPicker.tsx` | 0 |
| `lib/business-os/translations/en.ts` | 0 |
| `lib/business-os/translations/es.ts` | 0 |
| `lib/business-os/translations/he.ts` | 0 |
| `components/website/ImageGenerationProgress.tsx` (new) | 0 (no logging needed) |

No logger is added (SA R-4). The picker stays logger-free.

---

## Implementation Notes

**Built 2026-10-14** on `feature/perf-br3-image-progress` @ `d769b9e3`. Nothing committed.

### Task List status

- [x] 1. SA approved the workplan (R-1 to R-7)
- [x] 2. Five keys added to en / es / he; `no_people` renamed to `depicts_people` (R-3)
- [x] 3. `components/website/ImageGenerationProgress.tsx` created
- [x] 4. Wired into `MediaLibraryPicker.tsx`; `close()` + `closedRef`; one `notifyCreditUsageChanged()` call kept
- [x] 5. `MediaLibraryPicker.progress.test.tsx` written (22 cases); prompt+style pin added
- [x] 6. Targeted Jest, `npm run lint:hooks`, scoped `tsc` (results below)
- [x] 7. `git diff --name-only origin/main` has no FR-3.9 file
- [ ] 8. SA code review
- [ ] 9. Requirement §0 row for "code complete" (BA / main session; the R-7 row is already there)

### How each SA change was applied

| # | Applied as |
|---|---|
| R-1 | `ImageGenerationProgress` is **always mounted** in the picker footer with `startedAt: number \| null`. Its `role="status"` / `aria-live="polite"` container is always in the DOM (empty while idle); only its text changes. While idle the wrapper is `display: contents`, so it adds no box and the footer spacing is unchanged, but the region stays in the accessibility tree. T1 asserts the region exists and is empty before Generate |
| R-2 | (a) The timer is outside the live region and **not** `aria-hidden` (T6 asserts both). (b) Option 1: `media.generate.progress_elapsed` holds the **label only** (`Elapsed` / `Tiempo transcurrido` / `זמן שעבר`); the component renders the label plus `<span dir="ltr">m:ss</span>`. No isolate characters |
| R-3 | `media.generate.no_people` renamed to `media.generate.depicts_people` in en / es / he with today's text. T8 covers the refusal; T14 pins the key in all three and that `no_people` is gone |
| R-4 | No logger import or call in the picker or the new component |
| R-5 | Analysis Summary "Copy" row corrected; T14 pins presence and non-empty values only |
| R-6 | (a) `fetch` routed by URL; only `/media/generate` calls are counted (T3, T5, T9, T13). (b) T9 to T11 assert the live region is cleared, and T9 to T12 assert the credit signal is raised exactly once after the late reply. (c) T7 asserts `onSelect` before `onClose` via `invocationCallOrder`. (d) T5 / T6 use modern fake timers and advance inside `act()`, with a note that elapsed is `Date`-derived |
| R-7 | Requirement copied from the master (§0 row and AC-3.9 / AC-3.11 already amended). Stale host comments fixed: the allowance comment (`:75-77`, said "and from the wizard") and the credit-signal comment (`:218-220`, said the configuration dialog reaches the picker). `route.ts` untouched |
| Optional | Kept `generating` beside `generationStartedAt` to keep the diff small (SA said optional). The placeholder pulse is `aria-hidden` with no text |

### Decisions made while building

- **The library-item path uses `close()`.** Choosing a library picture during generation marks the picker closed, so the late generated picture cannot overwrite the owner's choice (T11).
- **A late result on a closed picker skips both `onSelect` and `onClose`** (SA ruling 3). Refusal and failure branches are unchanged.
- **Mutation checks.** Removing `if (closedRef.current) return;` makes T9 to T12 fail (4 failed). Removing `closedRef.current = false` from the effect body makes T13 (StrictMode) fail. Both restored, so the guards are proven to catch the bug.

### Verification results

| Check | Result |
|---|---|
| New suite `components/website/__tests__/MediaLibraryPicker.progress.test.tsx` | **22 / 22 pass** |
| Related suites: `components/website/**`, `app/api/website/**` (incl. `media/generate/__tests__/route.attribution.test.ts`), `creditUsageSignal.raiseSites`, `dictionariesStayInStep.guard`, `GeneratedImageService.attribution` (with the new AC-3.5 pin), `openaiProvider.image`, `aiUnavailableMessages`, `creditAreaNames`, `clientFacingCancelReason`, `serviceJourney`, and the insight / CRM guards that read the dictionaries | **33 suites, 483 tests, all pass** |
| `npm run lint:hooks` | Clean (0 warnings) |
| Scoped `tsc` (temporary tsconfig extending the root, `files` = the 7 touched TS/TSX files; removed afterwards) | **0 errors in touched code.** The only errors are 16 pre-existing TS1117 duplicate-key errors in `translations/en.ts` and `es.ts` (8 duplicated keys each, e.g. `crm.task.priority.low` at `en.ts:2040`), identical on `origin/main` and not on lines this slice touched. A full-project `tsc` ran out of memory (4 GB heap) while another session's `next build` was running |
| `git diff --name-only origin/main` vs the FR-3.9 list | No route, service, provider, `lib/business-os/llm/*`, config or migration file. `MediaUploader.tsx` and the hosts are untouched |
| `console.*` in touched files | 0 in each |

### Metric

**Production build:** `next build` in this worktree (own `.next`, checked unused beforehand) **succeeded** (Next 14.2.35, exit 0; only the usual pre-existing warnings and build-time dynamic-route logs). `/business-os/website`: 109 kB page, 536 kB First Load. No baseline build was taken, because BR-3 is not a bundle-size metric (C-12).

**Time to first feedback: not measured by Dev; owed to QA.** It needs a signed-in owner in a real browser with DevTools Performance, and every press of Generate is a real, charged generation (or a request blocked in DevTools so it never reaches the server). Dev has no browser session here. Evidence so far: the panel state is set synchronously in the click / Enter handler before `fetch` is called, and T1 shows the panel rendered before the reply resolves. Expected: one to two frames (< 100 ms) against the ≤ 1 s target. Baseline: no useful feedback until the finished picture (p50 53.4 s / p95 58.1 s, R13). QA method: production build, record from the click to the first frame painting the panel, 5 runs, median. The temporary `.env.local` copy used for the build was deleted afterwards; QA must provide env to run `next start`.

---

## SA Review Notes

**Reviewed by SA — 2026-10-14** (code read in worktree `neuronforge-br3` @ `d769b9e3`; worktree diff is docs-only)
**Status:** APPROVED WITH CHANGES. Implementation may start; changes R-1 to R-6 are applied during implementation and checked at code review. R-7 goes to the BA and does not block code.

### Rulings

| # | Topic | Ruling |
|---|---|---|
| 1 | `ImageGenerationProgress` component | **Approved.** Presentational, client-only, no new pattern. Isolating the 1 s interval so only the panel re-renders is the right call. Elapsed computed from `Date.now() - startedAt` is correct (throttled tabs, and fake timers mock `Date`). Named `SLOW_AFTER_SECONDS = 75` with the p95 comment: approved |
| 2 | `closedRef` + StrictMode reset | **Approved.** Body sets `false`, cleanup sets `true` is the correct StrictMode-safe shape; a cleanup-only flag would swallow every placement in dev. `close()` setting the ref as well as the unmount cleanup is correct belt-and-braces: it covers the window between `onClose()` and the host's commit, and it is what T9/T10 exercise (the test host never unmounts). Safe because the picker has no `open` prop: every host hides it by unmounting, so a `true` flag can never survive into a reopened picker. Say that in the code comment |
| 3 | Skipping `onSelect` **and** `onClose` on a late result | **Approved.** `onClose` was already called by the close path; a second call into a host that has moved on is exactly the class of bug FR-3.10 removes. Refusal/failure branches unchanged; state setters on an unmounted component are no-ops in React 18 |
| 4 | No abort | **Approved and required** (FR-3.3, FR-3.10, SA-11). No `AbortController`, `signal`, timeout or retry. T5/T9 pin it |
| 5 | Single `notifyCreditUsageChanged()` in `finally` | **Approved.** `finally` runs on the closed path too, so the credits card still refreshes after a charged late picture. The census (`creditUsageSignal.raiseSites.test.tsx:179`, count 1) stays unchanged and must stay green |
| 6 | Live region / timer split | **Approved in principle, with R-1 and R-2.** Status text in a polite region, per-second timer outside it, is the right split for §6. As written, two details defeat it (see R-1, R-2) |
| 7 | Server, cost, ledger, audit untouched | **Confirmed by reading the code.** The route (`app/api/website/media/generate/route.ts`) never reads `request.signal`; the file list excludes the route, `GeneratedImageService.ts`, `openaiProvider.ts`, `lib/business-os/llm/*`, `SystemConfigRepository.ts`, migrations, `MediaUploader.tsx` and all hosts. The only `lib/services` touch is a test file (`GeneratedImageService.attribution.test.ts`), which FR-3.9 does not cover. Code review will re-run `git diff --name-only origin/main` against this list |
| 8 | Host finding (only the website editor reaches the picker) | **Confirmed.** `MediaLibraryPicker` has one production importer (`components/website/MediaUploader.tsx:355`); its Library/Generate buttons are behind `{section && !disabled && …}` (`MediaUploader.tsx:325`); of the 8 `<MediaUploader>` call sites only the 5 in `app/business-os/website/page.tsx` pass `section`. `BusinessProfileSection.tsx:694`, `WebsiteSetupWizard.tsx:737`, `TestimonialEditor.tsx:250` do not. **Yes, amend the requirement** (R-7). Do not make the picker reachable from the logo hosts in this slice |
| 9 | SF-1 (`depicts_people` shows a raw key) | **In scope**, as R-3. Verified: the service and route return `reason: 'depicts_people'` (`GeneratedImageService.ts:297`, `route.ts:75`), the picker renders `t('media.generate.' + reason)` (`MediaLibraryPicker.tsx:211`), and `t()` falls back to the key itself (`LanguageContext.tsx:421`). AC-3.8 ("no keys are shown") and AC-3.7 ("today's message") would otherwise fail or pass on a raw key. Client-only, same screen, same files already being edited |
| 10 | Optional client `logger.info` | **Drop it** (R-4). A client Pino call only reaches the owner's browser console; nobody collects it, and the server already records the generation, ledger row, charge and audit. It adds no observability. The picker stays logger-free (0 `console.*`, census unchanged) |
| 11 | Test plan T1–T14 + attribution pin | **Approved with R-5 and R-6.** Coverage maps cleanly onto FR-3.1–3.10 and AC-3.1–3.11. The prompt+style pin closes the AC-3.5 gap correctly (literal copy of `STYLE`, deliberately brittle) |
| 12 | Metric | **Approved.** Production build, click → first frame painting the panel, 5 runs, median, target ≤ 1 s, recorded as an acceptance check under the C-12 exception, not a speed gain. Generation-time and cost guards reported, not gated. §6 answers Q1 yes / Q2–Q5 no confirmed |

### Required changes

| # | Where | Change | Status |
|---|---|---|---|
| R-1 | `MediaLibraryPicker.tsx` / `ImageGenerationProgress.tsx` | **The live region must exist before its text changes.** A `role="status"` element inserted into the DOM together with its content is often not announced (NVDA/VoiceOver), so the start message, the one that matters most, would be silent; only the 75 s switch would be announced. Render the `role="status"` / `aria-live="polite"` container **permanently** in the picker footer (empty while idle) and put the progress text into it while `generating`. Either keep that container in the picker and pass it children, or always mount the progress component with `startedAt: number \| null`. T6 must assert the region is present **before** Generate is pressed | ✅ done (see Implementation Notes) |
| R-2 | `ImageGenerationProgress.tsx`, `progress_elapsed` key | (a) The timer is **outside** the live region but **not** `aria-hidden`: hiding it removes the elapsed time from screen-reader users altogether; being outside the region already stops the per-second announcements. (b) `t()` returns a plain string with `{time}` already substituted, so a `<span dir="ltr">` cannot wrap only the digits as described. Pick one and state it in code review: either the key holds the label only (`Elapsed` / `Tiempo transcurrido` / `זמן שעבר`, no `{time}`) and the component renders `label` + `<span dir="ltr">m:ss</span>`, or keep `{time}` and drop the span (an `m:ss` run renders correctly in an RTL paragraph). Do not inject Unicode isolate characters into the var | ✅ done (see Implementation Notes) |
| R-3 | `lib/business-os/translations/{en,es,he}.ts` | SF-1, Option A refined: **rename** `media.generate.no_people` to `media.generate.depicts_people` in all three files, keeping today's text. `no_people` has no reader anywhere in the repo (grep: only the three dictionaries), so adding a duplicate would leave a dead key. Add `depicts_people` to T14. Record SF-1 as fixed in the requirement §0 row | ✅ done (see Implementation Notes) |
| R-4 | `MediaLibraryPicker.tsx` | Drop the client `logger.info` and its `createLogger` import. Remove the log line from Implementation Approach step 2 and the census note | ✅ done (see Implementation Notes) |
| R-5 | Analysis Summary, "Copy" row | Correct "No test checks key parity across the three files": `lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts` checks parity **both ways** (es/he have every en key, and no extra). T14 therefore only needs to pin presence and non-empty values of the new keys (+ `depicts_people`); parity is the guard's job | ✅ done (see Implementation Notes) |
| R-6 | Test plan | (a) **T13 (StrictMode):** the library `GET` fires twice under StrictMode, so route `fetch` by URL (as `raiseSites` does) and count only `/media/generate` calls; never assert total `fetch` call counts. (b) **T9/T10/T11:** also assert the panel's live region text is cleared and `notifyCreditUsageChanged` is raised exactly once **after** the late reply (already listed for T9; extend to T10–T12). (c) **T7:** assert `onSelect` is called before `onClose` (order is AC-3.4 behaviour). (d) **T5/T6:** use modern fake timers and advance inside `act()`; note in the test that elapsed is `Date`-derived | ✅ done (see Implementation Notes) |
| R-7 | Requirement (BA, not Dev) | Amend §5.4 ("from any block, the dashboard's configuration dialog, or the wizard"), FR-3.10, AC-3.9 and AC-3.11 to name the **five website-editor slots** (hero, about, team, gallery, logo cloud; covering wide, portrait, square). Record the configuration dialog (logo), the wizard (logo) and the testimonial photo as **N/A: picker not reachable on main** (`MediaUploader` without `section`), with the note that the fix lives in the shared picker so any host wired later inherits it. Dev also fixes the stale host comments in the picker (`:75-77` allowance comment mentions the wizard; `:218-220` mentions the configuration dialog). Do **not** edit the similar comment in `route.ts` (FR-3.9 file) | ✅ applied by BA in the master requirement; copied into the worktree. Dev part (picker comments `:75-77`, `:218-220`) done; `route.ts` untouched |

### Optimisation suggestions (non-blocking)

- `generationStartedAt: number | null` could replace `generating` entirely (`generating === startedAt !== null`), removing a pair of states that must move together. Keep both if it makes the diff smaller; not required.
- Keep the placeholder pulse `aria-hidden` and give it no text; it is decoration.
- QA: check the footer on a narrow viewport (~360 px) with Hebrew copy, since the panel plus the allowance line grows the footer inside `max-h-[80dvh]`.

### Approval

[x] Workplan approved, conditional on R-1 to R-6 being in the implementation and R-7 being applied by the BA before QA runs AC-3.9 / AC-3.11. Code review will check each R item.

---

**Code Review by SA — 2026-10-14** (worktree `neuronforge-br3`, uncommitted diff against `d769b9e3`)
**Status:** APPROVED

### What was checked

| # | Check | Result |
|---|---|---|
| 1 | R-1 to R-7 applied | **All applied.** R-1: `ImageGenerationProgress` always mounted with `startedAt: number \| null`; the `role="status"` / `aria-live="polite"` div is in the DOM while idle (wrapper is `display: contents`, no box), T1 asserts it present and empty before Generate. R-2: elapsed line is a sibling of the live region, not inside it, no `aria-hidden` on it or any ancestor (T6 asserts both); key holds the label only, digits in `<span dir="ltr">`, no isolate characters. R-3: rename in all three dictionaries, T8 covers the refusal, T14 pins presence and absence of `no_people`. R-4: no logger import in picker or component. R-5: Analysis Summary row corrected. R-6: fetch routed by URL, only `/media/generate` counted; T9–T12 assert panel cleared and one credit signal after the late reply; T7 asserts `onSelect` before `onClose` by `invocationCallOrder`; T5/T6 modern fake timers inside `act()` with the `Date` note. R-7: picker comments at the allowance and credit-signal blocks updated; `route.ts` untouched |
| 2 | No FR-3.9 server file changed | **Confirmed.** `git diff --name-only d769b9e3` = `MediaLibraryPicker.tsx`, the three dictionaries, and `GeneratedImageService.attribution.test.ts` (a test). Untracked: the new component, its test, two docs. No route, service, provider, `lib/business-os/llm/*`, `SystemConfigRepository`, migration, `MediaUploader.tsx` or host change |
| 3 | Request never aborted | **Confirmed.** No `AbortController`, `signal`, timeout or retry in the picker or the component. T5 and T9 assert one generate call with `init.signal === undefined` |
| 4 | Single `notifyCreditUsageChanged` call site | **Confirmed.** One call, in `finally` (`MediaLibraryPicker.tsx:263`); `creditUsageSignal.raiseSites` census green. The early `return` on a closed picker is inside `try`, so `finally` still raises the signal (T9–T12) |
| 5 | `closedRef` and StrictMode | **Correct.** Effect body sets `false`, cleanup sets `true` (survives StrictMode mount/cleanup/mount; T13 proves it, and Dev's mutation check shows T13 fails without the body reset). `close()` sets the flag before `onClose()` and is used by X, backdrop and library-item paths. Guard sits after `setAllowance` and skips both `onSelect` and `onClose` (ruling 3). Setters after unmount are no-ops in React 18. No `open` prop, so the flag cannot leak into a reopened picker; the code comment says so |
| 6 | a11y | **Correct.** Live region always mounted; timer outside it and readable; placeholder pulse `aria-hidden` with no text; `motion-reduce:animate-none` on the pulse; no `progressbar` role and no `%` (T4) |
| 7 | RTL | **Correct.** The component inherits `dir` from the picker root (`isRTL`); flex/gap layout has no physical left/right; `m:ss` forced LTR in its own span so it never reorders inside a Hebrew sentence |
| 8 | Keys and rename | **Correct.** Five `progress_*` keys in en/es/he, non-empty (T14), parity guard green. Repo-wide grep (excluding `node_modules`, `.next`, `.git`): `no_people` survives only in the T14 absence assertion and in history text in the requirement and this workplan. The server returns `reason: 'depicts_people'` (`GeneratedImageService.ts:219,297`, `route.ts:75,82`), which now resolves to `media.generate.depicts_people` in all three dictionaries |
| 9 | Hook rules | **Clean.** All hooks are unconditional and before any return; the new `useRef` / `useEffect` sit with the other top-level hooks. `npm run lint:hooks` exit 0 |
| 10 | `console.*` | **0** in `MediaLibraryPicker.tsx` and `ImageGenerationProgress.tsx` |
| — | TS1117 duplicate keys | **Pre-existing, out of scope.** On `d769b9e3` `en.ts` and `es.ts` each already have 8 duplicated keys; the count is unchanged after this diff, and `he.ts` has 0. No new key is a duplicate |
| — | Tests run by SA | `MediaLibraryPicker.progress`, `creditUsageSignal.raiseSites`, `dictionariesStayInStep.guard`, `GeneratedImageService.attribution` (incl. the AC-3.5 pin, whose literal matches `STYLE` at `GeneratedImageService.ts:205-207`), `media/generate` route tests: **5 suites, 87 tests, all pass** |

### Code Review Comments

None blocking.

### Optimisation Suggestions (non-blocking)

- `ImageGenerationProgress.tsx` exports both a named and a `default` export; nothing imports the default. Dropping it keeps one way to import. Style only.
- The optional single-state simplification (`generating` derived from `generationStartedAt`) was not taken; acceptable as stated.
- **BA, docs only:** the requirement FR-3.10 still lists "website editor block, dashboard configuration dialog through the logo uploader, wizard" as hosts and cites `MediaLibraryPicker.tsx:191-205`. AC-3.9 was amended under R-7 but FR-3.10 was not. Align FR-3.10 with AC-3.9 (five editor slots; other hosts N/A on main) before QA reads it. Does not block code.
- QA, as already noted: narrow viewport (~360 px) with Hebrew copy, since the panel adds height inside `max-h-[80dvh]`; and the time-to-first-feedback metric in a production build.

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-10-14**
**Test mode:** full
**Strategy used:** A (Jest, jsdom behaviour + dictionary + service pin), plus independent mutation probes. D (manual browser check) is **owed** to the main session, using the checklist below. Code ran in worktree `neuronforge-br3` @ `d769b9e3`, uncommitted.
**Focus:** ui, schema (copy), money (records unchanged)
**Skipped:** the live browser run (no signed-in browser session here; the main session runs it). The real 75 s wait is skipped: T5 covers it, as agreed.
**Input source:** prompt (TL brief) plus QA judgment

### Test runs

| Run | Result |
|---|---|
| `npx jest components/website/__tests__/MediaLibraryPicker.progress.test.tsx` | **22 / 22 pass** (T1 to T14) |
| Related: `components/website/**`, `app/api/website/**` (incl. `media/generate/__tests__/route.attribution.test.ts`), `creditUsageSignal.raiseSites`, `dictionariesStayInStep.guard`, `GeneratedImageService.attribution` (with the new AC-3.5 pin), `openaiProvider.image` | **21 suites, 315 tests, all pass** |
| `no_people` readers after the R-3 rename | None in `app/`, `components/`, `lib/` (only T14's "is gone" assertion) |
| FR-3.9 file list (`git diff --name-only HEAD`) | Only the picker, the three dictionaries and one **test** file under `lib/services/__tests__/`. No route, service, provider, `lib/business-os/llm/*`, config or migration file. `git diff --name-only origin/main` also lists `app/admin/settings/*` and admin docs: those are **main moving ahead** (PRs #338 to #340), not BR-3. No overlap with BR-3 paths |

### Mutation probes (repeated independently by QA)

| Probe | Expected | Actual |
|---|---|---|
| Remove `if (closedRef.current) return;` (success branch) | T9 to T12 fail | **T9, T10, T11, T12 fail (4 failed, 18 passed).** T13 still passes |
| Remove `closedRef.current = false;` from the effect body (StrictMode reset) | T13 fails | **T13 fails (1 failed, 21 passed)** |
| Restore | File identical to Dev's version | Restored from a scratch copy taken before probing: same SHA-256 (`67957aa4…496c`), `git diff HEAD` of the picker byte-identical to Dev's diff, no `PROBE` text left, suite back to 22 / 22 |

### Test Coverage

| AC | Tested? | Result | Evidence / level |
|---|---|---|---|
| AC-3.1 panel ≤ 1 s, shape per aspect | ⚠️ | Partial | **Logic-level:** T1 (panel and copy before the reply resolves), T2 (`data-aspect` wide / portrait / square), T3 (Enter). State is set synchronously before `fetch`. **Needs manual:** the ≤ 1 s median on a production build and a visual look at the three shapes (checklist steps 2 and 3) |
| AC-3.2 no % / no fill bar | ✅ | Pass | **Verified:** T4 (no `progressbar` role, no `%` in the panel). Code: only `animate-pulse` on a fixed placeholder. Visual glance in step 2 |
| AC-3.3 75 s message, one request, not cancelled | ✅ | Pass | **Verified (mocked slow reply, as the AC allows):** T5, absent at 74 s, present at 75 s, exactly one `/media/generate` call, no `signal`. "Not cancelled" also covered by T9 (no `signal` after close). The real Network "one request" is seen in step 4 |
| AC-3.4 success places, then closes | ⚠️ | Partial | **Logic-level:** T7 (`onSelect` before `onClose`, panel cleared), T13 (still placed under StrictMode). **Needs manual:** step 5 (free reuse hit) |
| AC-3.5 same request | ✅ | Pass | **Verified:** new pin in `GeneratedImageService.attribution.test.ts` (prompt + literal style suffix) plus existing model / size / quality / `n: 1` pins and `openaiProvider.image.test.ts`, all green. No FR-3.9 file in the diff (above; SA confirms the same) |
| AC-3.6 same records | ❌ not yet | Owed | **Needs manual:** one real generation (step 4). Not testable in Jest |
| AC-3.7 reuse hit and refusals end the panel | ⚠️ | Partial | **Logic-level:** T8 for `depicts_people`, `limit_reached`, `unavailable`, `failed` and a thrown fetch; a reuse hit is the success branch (T7). **Needs manual:** the people refusal (step 2, free) and a reuse hit (step 5, free). `limit_reached` and `unavailable` stay logic-level only: reproducing them needs the day's cap used up or the images area switched off, which is not worth the cost |
| AC-3.8 he / es, RTL, no keys | ⚠️ | Partial | **Verified:** T14 (all five keys plus `depicts_people` present and non-empty in en / es / he, `no_people` gone) and `dictionariesStayInStep.guard` (parity both ways). **Needs manual:** Hebrew RTL rendering at ~360 px (step 7) |
| AC-3.9 same experience in every reachable host | ⚠️ | Partial | **Logic-level:** one shared component, one production importer (`MediaUploader.tsx`), five editor slots pass `section`; QA re-checked the aspects in `page.tsx`: hero portrait, about portrait, team square, gallery wide, logo cloud square. Configuration dialog logo, wizard logo, testimonial photo: **N/A, picker not reachable on main** (per amended AC). **Needs manual:** steps 2, 3 and 6 touch all five slots |
| AC-3.10 can-close and no-repeat copy | ✅ | Pass | **Verified:** T1 (both lines rendered in the live region), T14 (present in all three). QA read the en / es / he text: says the window can be closed, the picture is still saved to the library, and not to ask for the same picture again because of a possible double charge. It does not promise placement |
| AC-3.11 close during generation | ⚠️ | Partial | **Logic-level, mutation-proven:** T9 (X), T10 (backdrop), T11 (library choice during generation), T12 (unmount), each: no late `onSelect`, `fetch` not aborted, credit signal raised once. **Needs manual:** (a) to (d) on one slot with the one real generation (step 4); (e) step 5; the other four slots with a free, client-only check (step 6) |
| Metric: time to first feedback ≤ 1 s | ❌ not yet | Owed | **Needs manual** (step 2). Expected one to two frames |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Wide placeholder on a narrow screen (watch item, not yet a finding).** The placeholder is a fixed `h-28` (112 px), so the wide 3:2 shape is about 168 px across. At ~360 px, with the backdrop's `p-4` and the panel's padding, the text column beside it is only about 110 to 130 px wide, and the Hebrew lines are long. Step 7 checks this on the **gallery (wide)** slot. If the text wraps into a tall column that pushes the prompt or the Generate button out of view, record it as a Medium UI bug for Dev (for example, stack the placeholder above the text below `sm`).
2. **The people refusal only matches English words** (`PEOPLE` regex, `GeneratedImageService.ts:210`). Pre-existing and out of scope. It matters only for the checklist: the free refusal prompt has to contain an English word such as "woman", even with the UI in Hebrew.

### Manual checklist for the main session (in-app browser, production build)

**Cost:** exactly **one** charged generation (about $0.25), in step 4. Every other press is free: a people refusal and a reuse hit make no provider call (`route.ts`: "a reuse-cache hit, a refusal or the daily cap makes no provider call, so it writes none"; the people check and the reuse check both run before the provider in `GeneratedImageService.ts`). Step 6 never reaches the server.

**Setup**
1. In the worktree, `next build && next start` with env provided (Dev's build succeeded; `.env.local` was removed afterwards). Sign in as a **test** account with credits. Open `/business-os/website` with the editor showing the hero, about, team, gallery and logo-cloud blocks. Note the credits balance and the "N of M AI images left today" line.

Console helpers (paste as needed; reload the page to remove them):

```javascript
// H1: delay the real generate request by N ms (the panel is visible meanwhile)
window.__of = window.__of || window.fetch;
window.__delay = (ms) => { window.fetch = (u, i) => String(u).includes('/media/generate')
  ? new Promise(r => setTimeout(() => r(window.__of(u, i)), ms)) : window.__of(u, i); };

// H2: fake a successful reply after N ms, no server call. Use a URL already in the library.
window.__fake = (ms, url) => { window.fetch = (u, i) => String(u).includes('/media/generate')
  ? new Promise(r => setTimeout(() => r(new Response(JSON.stringify({ success: true, data: { url } }),
      { headers: { 'content-type': 'application/json' } })), ms)) : window.__of(u, i); };

// H3: time from the click to the frame that paints the placeholder
(() => { let t0; document.addEventListener('click', e => { t0 = e.timeStamp; }, true);
  new MutationObserver(() => { if (t0 !== undefined && document.querySelector('[data-testid="image-generation-placeholder"]')) {
    const s = t0; t0 = undefined;
    requestAnimationFrame(() => requestAnimationFrame(() => console.log('BR3 panel painted after ms', (performance.now() - s).toFixed(1))));
  } }).observe(document.body, { childList: true, subtree: true }); })();
```

**Steps**

| # | What | Presses | Covers | Pass when |
|---|---|---|---|---|
| 2 | English UI. Paste H1, run `__delay(6000)`, paste H3. **Hero** slot, Generate picker, prompt `a woman reading by a window`. Press Generate **5 times** (one at a time, after each refusal shows) | 5 free | Metric, AC-3.1 (portrait), AC-3.2, AC-3.7 people, AC-3.9 | Each H3 value ≤ 1000 ms; record all five and the median. Portrait (tall) placeholder pulses, "Creating your picture. This usually takes about a minute.", the can-close and don't-repeat lines, "Elapsed 0:0x" ticking. No % or filling bar. Generate disabled while waiting. After ~6 s the panel disappears at once and the people message shows as a sentence, **not** `media.generate.depicts_people` |
| 3 | Same helpers. One press each on **gallery** and **team** with the same prompt | 2 free | AC-3.1 (wide, square), AC-3.9 | Gallery placeholder is wide (3:2), team placeholder is square |
| 4 | **The one charged press.** Reload (removes helpers). DevTools Network open. **Hero** slot (note the current picture), prompt with **no** people words: `a ceramic coffee cup on a wooden table, morning light`. Press Generate, wait ~5 s, close with **X** | **1 charged** | AC-3.11 (a) to (d) on hero, AC-3.6, AC-3.3 (one request in a real run) | (a) exactly one `POST /api/website/media/generate`, still pending after the close, completes 200 (not "canceled"), no second request. (b) After it completes (~1 min) the hero picture is **unchanged**. (c) Open the picker again: the new picture is in the library. (d) Credits card refreshed. DB (test account, this minute): exactly one `token_usage` row for `image_generation` at $0.25, one audit entry, one credit charge, same price basis as earlier `image_generation` rows. Allowance went down by one |
| 5 | Same **hero** picker, type the **exact same prompt** as step 4, press Generate | 1 free (reuse hit) | AC-3.11 (e), AC-3.4, AC-3.7 reuse | Panel ends almost at once, the picture is placed in hero and the picker closes. **No** new `token_usage` row or credit charge, allowance unchanged. Then undo the hero change (do not publish) |
| 6 | Paste H1 then `__fake(8000, '<URL of a picture already in the library>')`. On **about**, press Generate then close with **X**. On **gallery**, press then close by the **backdrop**. On **team**, press then choose a **library picture** while it waits. On **logo cloud**, press then close with X. Wait 10 s after each | 4 free (no server call) | AC-3.11 (b) on the other four slots, all close paths | about, gallery, logo cloud: slot unchanged. team: holds the library picture you chose, not the fake. (Client guard only; the server side was proven in step 4) |
| 7 | Reload. Switch to **Hebrew**, viewport **~360 px** wide. Paste H1, `__delay(8000)`. Prompt `a woman reading`. One press on **gallery** (wide, the tightest layout), one on **hero** | 2 free | AC-3.8, the narrow-footer check | Panel is RTL (text right-aligned, placeholder on the right), Hebrew copy, no raw keys. Timer reads `0:05` left to right. Prompt field and Generate button stay visible without scrolling, the dialog stays inside the screen. Then the Hebrew people message. See Edge Case 1 |
| 8 (optional) | Spanish, one press as in step 2 | 1 free | AC-3.8 es | Spanish copy, no raw keys |

Not in the browser run: the 75 s message (T5), `limit_reached` and `unavailable` (T8).

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Automated part passes (22 / 22 new, 315 / 315 related, mutation probes confirmed, no bugs). **Not ready for commit until the manual checklist above passes**: AC-3.6, the metric, and the browser halves of AC-3.1, 3.4, 3.7, 3.8, 3.9 and 3.11 are owed.

---

## Commit Info

*RM populates this section.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Dev workplan for BR-3 on `feature/perf-br3-image-progress` @ `d769b9e3`. Host list verified (only the website editor reaches the picker), side finding SF-1 (raw key on a people refusal) raised for SA |
| 2026-10-14 | SA workplan review | APPROVED WITH CHANGES: R-1 to R-6 (Dev, during implementation), R-7 (BA requirement amendment for the host list). SF-1 in scope as a key rename |
| 2026-10-14 | Implemented | R-1 to R-6 applied; R-7 requirement copied in and the picker host comments fixed. New `ImageGenerationProgress.tsx`, picker `close()` + `closedRef` (FR-3.10), five `progress_*` keys and the `depicts_people` rename in en/es/he, 22 new jsdom tests, AC-3.5 prompt pin. Related suites 33 / 483 green, `lint:hooks` clean, scoped `tsc` clean for touched code. Status: Code Complete, uncommitted |
| 2026-10-14 | SA code review | APPROVED. R-1 to R-7 verified; no FR-3.9 file changed; no abort; one credit-signal call site; StrictMode-safe `closedRef`; a11y/RTL/keys/hooks/console clean; 5 suites / 87 tests re-run green. Non-blocking: drop unused default export; BA to align FR-3.10 host list with amended AC-3.9 |

### Manual browser checks: main session, 2026-10-14

Production build of this branch (`next build && next start`, localhost:3005), signed in to the user's test account, `/business-os/website` → Hero slot → "Your images". The user approved exactly one charged generation.

| Check | Result |
|---|---|
| Panel appears on Generate (metric, ≤ 1 s) | ✅ Panel is in the DOM about 11 ms after the click (synchronous handler 0.4 ms). Click to painted frame: 0.48 / 0.78 / 0.80 / 1.02 / 1.04 / 1.17 s over 6 runs, median ≈ 0.9 s. The extra paint time comes from the in-app browser repainting the picker's large library thumbnails when the footer grows (hidden thumbnails: 0.19 / 0.39 s); normal UI changes in the same browser paint in 35–65 ms. **Passes, but close to the line in this browser**; expected faster in desktop Chrome |
| Copy (en): "about a minute", can-close, don't-repeat, `Elapsed m:ss` ticking, no % or bar | ✅ |
| AC-3.7 people refusal shows a sentence, not `media.generate.depicts_people` (SF-1) | ✅ "Pictures of people are not generated — use your own photograph for those." Refused server-side at no cost |
| AC-3.11 close during generation, simulated reply (no server call) | ✅ Closed with X: the slot keeps the original picture |
| Positive control, picker left open, simulated reply | ✅ The picture is placed and the picker closes |
| **AC-3.11 + AC-3.6, one real charged generation**: prompt "a ceramic coffee cup on a wooden table, morning light", closed with X after 5 s | ✅ One POST, no abort signal, still pending after close, finished **200 after 83.7 s** (local server). The slot is unchanged. The new picture (`wve96w.png`) is in the library. "10 of 10" → "9 of 10 AI images left today". DB, read-only: exactly **1** `token_usage` image row at **$0.25**, **1** credit charge, **1** audit row |
| Hebrew at 360 px (RTL), gallery/hero picker, simulated pending | ✅ The panel copy is in Hebrew with a ticking `זמן שעבר` timer, no raw keys, and the prompt and Generate button are on screen. ⚠️ **Existing page issue, not BR-3:** `/business-os/website` lays out at 396 px wide on a 360 px screen (document scrollWidth 396), so in RTL the page and any fixed dialog are shifted and about 20–36 px is cut on the left. Logged as a separate finding |
| Cleanup | Language restored to English (server preference `en` confirmed). The unsaved editor change was discarded by a reload. DB check: the saved website content still references the original Hero picture and contains neither test picture. Viewport reset, server stopped, `.env.local` removed |

**QA final status:** ✅ Ready for commit after the user sees the diff.
