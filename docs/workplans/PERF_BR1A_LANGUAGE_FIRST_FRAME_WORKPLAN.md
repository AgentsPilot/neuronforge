# Workplan: BR-1a, the Owner's Language and Direction on the First Frame

> **Last Updated**: 2026-10-14

## Overview

Today every owner page draws its first frame in English, left to right. The page then switches to the owner's language after it mounts, and switches again when the saved preference arrives. BR-1a removes that flash. The server reads the owner's saved language in the layouts that mount `LanguageProvider`, the provider starts in that language, and a small pre-paint script sets `lang`/`dir` on `<html>` before anything paints. The nested CRM provider is removed. All three dictionaries still load, so this slice has no bundle gain; BR-1b covers the bytes. Currency and timezone resolution do not move.

**Developer:** Dev
**Requirement:** [PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md](/docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md) §3 (BR-1), §9, §11, §12. The master copy is uncommitted in the main checkout and ships in PR #364. A reference copy sits untracked in this worktree and **is not committed by this slice**.
**Branch:** `feature/perf-br1a-language-first-frame` (worktree `neuronforge-br1a`)
**Base commit:** `origin/main` @ `5e44871d` (SA reviewed the requirement at `ffb598ac`; drift noted in §10)
**Date:** 2026-10-14
**Status:** Code Complete, RC-6b design change applied. Awaiting the server-response re-measurement (main session) and SA re-approval

---

## Table of Contents

- [§1 Analysis Summary](#1-analysis-summary)
- [§2 Implementation Approach](#2-implementation-approach)
- [§3 Files to Create / Modify](#3-files-to-create--modify)
- [§4 Task List](#4-task-list)
- [§5 FR / AC Mapping](#5-fr--ac-mapping)
- [§6 §6 Filter Answer](#6-6-filter-answer)
- [§7 Metrics and Baseline](#7-metrics-and-baseline)
- [§8 Test Plan](#8-test-plan)
- [§9 Risks](#9-risks)
- [§10 Requirement vs Code: Mismatches Found](#10-requirement-vs-code-mismatches-found)
- [§11 Questions for SA](#11-questions-for-sa)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## §1 Analysis Summary

| Area | What it is today (read at `5e44871d`) |
|---|---|
| Provider | `lib/business-os/LanguageContext.tsx`. `useState<Language>('en')` at `:181`, so the server render and the first paint are English. Mount effect `:205-291`: localStorage override `:208-211`, display-currency default from the **localStorage** language `:213-219`, then `GET /api/business-os/preferences` `:238`; the saved language wins at `:270-272` (also writes localStorage), and the backfill runs at `:273-282`. `<html>` `dir`/`lang` are set by an effect at `:294-298` |
| Mounts | Server layouts `app/business-os/layout.tsx:69`, `app/onboarding-build/layout.tsx:25`, `app/onboarding-chat/layout.tsx:24`, all `force-dynamic`. A **nested** client provider at `app/business-os/crm/layout.tsx:14`. Nothing else mounts the provider, and no Jest test renders the real provider |
| Session reads already in the layouts | `redirectIfAwaitingPayment()` is the first statement in all three (pinned by `paymentHold.test.ts:253-264`). `/business-os` then awaits `readPlanBadge()` at `:64`. `getUser()` is memoised for 30 s with in-flight dedup (`lib/auth.ts`) |
| Saved-language read | `userPreferencesRepository.findLocale(userId)` (`lib/repositories/UserPreferencesRepository.ts:88-115`) uses the service-role client scoped by `.eq('user_id', userId)`. It never throws, returns `{ data, error }`, and returns the **raw** `preferred_language` string, not normalised |
| Root `<html>` | `app/layout.tsx:55`, `lang="en" dir="ltr" suppressHydrationWarning` |
| Public precedent | `components/public/PublicDirScript.tsx` also sets `data-public-surface` and `colorScheme`, so it is **not** reused (P-2) |
| Switch callers | Header `components/business-os/BusinessOSHeader.tsx:183/190/197`, Settings `app/business-os/settings/page.tsx:857`, onboarding-chat auto-switch `app/onboarding-chat/page.tsx:473/476/479`. All call `setLanguage`, which is unchanged in BR-1a |
| `router.refresh()` | No caller under `app/business-os`, `app/onboarding-*`, `components`, `hooks`, `lib/client` |
| DB | `user_preferences` read only, through the existing repository method and column. No schema change, no new column claim |

**Domain skills checked:**
- `tenant-isolation-guard`: does not apply. It is a service-role **read**, and the id comes from the session (`getUser()`), never from the caller. The helper header documents this.
- `business-os-entitlements`: `app/business-os/layout.tsx` imports `readPlanBadge` and is registered in `KNOWN_NON_GATE_IMPORTERS` with `symbols: ['readPlanBadge']`. Its import set from the module stays exactly the same, so no registry edit is needed. `npm run test:bos-entitlements` runs before handover anyway.
- `business-os-schema-check`: no new select. The `findLocale` select is unchanged and already replayed by `npm run schema:check`.

**`console.*` count in files this slice touches:** `LanguageContext.tsx` 0, `app/business-os/layout.tsx` 0, `app/onboarding-build/layout.tsx` 0, `app/onboarding-chat/layout.tsx` 0, `app/business-os/crm/layout.tsx` 0. Nothing to flag. New files use `createLogger` (server) and add no `console.*`.

---

## §2 Implementation Approach

### §2.1 The server helper (P-1)

`lib/business-os/readInitialLanguage.ts` is `server-only` and shaped like `readPlanBadge`:

```typescript
export async function readInitialLanguage(): Promise<InitialLanguage>
// InitialLanguage = { language: 'en' | 'es' | 'he'; source: 'saved' | 'none' | 'unknown' }
```

| Situation | Result |
|---|---|
| Session user, `findLocale` OK, `preferredLanguage` is exactly `en`/`es`/`he` | `{ language: <it>, source: 'saved' }` |
| Session user, `findLocale` OK, value null, blank or anything else | `{ language: 'en', source: 'none' }` |
| `findLocale` returns `error` | `{ language: 'en', source: 'unknown' }`, logged `warn` with `{ err }` only |
| No session, or `getUser()`/`findLocale` throws | `{ language: 'en', source: 'unknown' }`. It never throws |

- **Exact match, not `normalizeLanguage`.** The client accepts only `=== 'en' | 'es' | 'he'` (`LanguageContext.tsx:209`, `:270`). If the helper normalised `'HE'` to `he`, the client GET would treat the same row as "nothing saved" and backfill this browser's pick, so the settled language would differ from the first frame. Mirroring the client keeps the §3.4 rule ("the language the page settles on today").
- **The timezone is never returned** (SA-6), although `findLocale` reads it.
- The id is always `user.id` from `getUser()`. No parameter is accepted.

### §2.2 The shared, client-safe module

`lib/business-os/ownerLanguage.ts` has no `server-only`, no React and no imports. It holds:
- `OwnerLanguage`, `OwnerLanguageSource` and `InitialLanguage`;
- `isOwnerLanguage(v): v is OwnerLanguage` (exact match);
- `ownerDir(lang)`;
- `INITIAL_LANGUAGE_DEFAULT = { language: 'en', source: 'none' }`.

The server helper, the script and the provider all import it, so the client provider never imports, even type-only, from a `server-only` file.

### §2.3 The owner pre-paint script (P-2)

`components/business-os/OwnerDirScript.tsx` is a sibling of `PublicDirScript`, with no `'use client'`. It renders:

```typescript
`document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(ownerDir(lang))};`
```

- It sets `lang` and `dir` **only**: no `data-public-surface`, no `colorScheme`.
- `language` is re-checked with `isOwnerLanguage` and falls back to `en`, so a bad value can never reach the `<head>`/body script. It is also always `JSON.stringify`-serialised.
- It is rendered as the **first** element each layout returns, before any provider. Each layout awaits everything before returning and there is no `loading.tsx` above or in these segments. `PlatformShell` renders nothing visible before `children`. So the script runs while the HTML is parsed, before any body content paints.
- It always renders, including for `en`. It is uniform and test-pinned, and for `en` it is a no-op.
- On a soft navigation, React inserts the `<script>` but the browser does not execute it. The provider's existing effect (`:294-298`, kept as SA-1 requires) covers that case, exactly as today.

### §2.4 The provider (`LanguageContext.tsx`)

1. **New optional prop** `initial?: InitialLanguage`, defaulting to `INITIAL_LANGUAGE_DEFAULT`. This keeps today's behaviour wherever the prop is absent (tests, any future mount). A guard test makes the three layouts pass it.
2. **Initial state:** `useState<Language>(() => isOwnerLanguage(initial.language) ? initial.language : 'en')`. Because it is a `useState` initialiser, a later prop change (layout re-render, `router.refresh`) is ignored after mount. That is deliberate (§9 R-3).
3. **Mount effect, the one-line behavioural change:** the localStorage override at `:209-211` runs only when `initial.source !== 'saved'`. `savedLang` is still **read**, because `:213-219` derives the default display currency from it (SA-6).
4. **localStorage write timing.** The plan keeps the existing write at `:272` (when the GET confirms the saved value) and does **not** add a write at mount. A mount-time write would make the second StrictMode run (dev) read the server language back out of localStorage and derive ILS where main derives EUR, which is the SA-6 trap. AC-1.3's end state ("localStorage ends as `he`") is reached at `:272` as today. See §11 Q-2.
5. **The `dir`/`lang` wrapper (FR-1.2, amended by SA RC-1).** The provider renders its children inside `<div dir={…} lang={…} style={{ display: 'contents' }} data-owner-locale>`, computed from the **state**, not from the server prop.
   - **It is on the first rendered content frame, not in the server HTML.** `V2ThemeProvider` (`lib/design-system-v2/theme-provider.tsx:260-262`) returns `null` until it mounts, and all three layouts mount `LanguageProvider` inside it. So nothing from the provider down is server-rendered or hydrated, on main and on this branch. The provider's first render is a client render whose state is the `useState` initialiser (the saved language), so the wrapper's `dir`/`lang` are right on the first commit, before any passive effect runs.
   - It follows every switch. A wrapper written by the layout from the prop would keep the **old** `dir` after a switch and, as a closer ancestor, override `<html dir>`. Outside `V2ThemeProvider` it would also be an empty `div` in the server HTML. SA approved the provider placement (Q-1).
   - `display: contents` adds no box, so sizing and percentage heights resolve as today. `dir` and `lang` still inherit through it.
   - **`<html>` is the only element the server HTML sets**, through `OwnerDirScript`, which must sit **outside** `V2ThemeProvider` and `UserProvider` (RC-2, pinned by G-1).
6. Everything else is unchanged: the GET (still the only authority for backfill, currency and timezone), `setLanguage`, `setCurrency`, `t()`, the `dir` effect, `useOptionalLanguage` and `useBusinessTimezone`. The initial values `currencyCode = 'USD'`, `businessCurrency = undefined` and `timezone = 'UTC'` stay as they are.

**Client behaviour by `source` (SA-1):**

| `source` | First render | After mount |
|---|---|---|
| `saved` | saved language | localStorage override **skipped**; the GET re-confirms and writes localStorage at `:272` |
| `none` / `unknown` | `en` | localStorage pick applies, then the GET / backfill, exactly as today |

### §2.5 Layouts

- **`app/business-os/layout.tsx`** (amended by the SA ruling on RC-6b): `const initialLanguagePending = readInitialLanguage();` is **started** before the gate, then `await redirectIfAwaitingPayment();` (the first **awaited** statement), then `const [planBadge, initialLanguage] = await Promise.all([readPlanBadge(), initialLanguagePending]);`. The language round trip overlaps the hold's lineage read instead of following it. Nothing reads or awaits the pending value before the gate returns, and leaving it dangling on a redirect is safe because `readInitialLanguage` never rejects. Return `<><OwnerDirScript language={initialLanguage.language} /><UserProvider>…<LanguageProvider initial={initialLanguage}>…</>`.
- **`app/onboarding-build/layout.tsx` and `app/onboarding-chat/layout.tsx`:** the same start before the gate, then the gate, then `const initialLanguage = await initialLanguagePending;`, then the same script and prop.
- **`app/business-os/crm/layout.tsx` (C-1):** remove the `LanguageProvider` import and element. Keep `V2ThemeProvider` and the `globals-v2.css` import, and leave the file otherwise as is.

**Root-cause phase / pattern note (rule 7):** P-1 and P-2 are SA-approved patterns. The one shape SA has not ruled on is the provider-rendered `display: contents` wrapper (§2.4 item 5), which is raised as Q-1.

---

## §3 Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/ownerLanguage.ts` | create | Client-safe type, exact-match guard, `dir` mapping and default, shared by the server helper, the script and the provider |
| `lib/business-os/readInitialLanguage.ts` | create | P-1 `server-only`, never-throwing helper over `findLocale(user.id)`, returning `{ language, source }` |
| `components/business-os/OwnerDirScript.tsx` | create | P-2 owner pre-paint `lang`/`dir` script, a sibling of `PublicDirScript` |
| `lib/business-os/LanguageContext.tsx` | modify | `initial` prop, initial state from it, skip the localStorage override when `saved`, state-driven `dir`/`lang` wrapper |
| `app/business-os/layout.tsx` | modify | Read the language in parallel with the plan badge, render the script, pass `initial` |
| `app/onboarding-build/layout.tsx` | modify | Read after the gate, render the script, pass `initial` |
| `app/onboarding-chat/layout.tsx` | modify | Same |
| `app/business-os/crm/layout.tsx` | modify | Remove the nested `LanguageProvider` (C-1); the CSS import stays |
| `lib/business-os/__tests__/readInitialLanguage.test.ts` | create | Helper unit tests (AC-1.5a and the P-1 guarantees) |
| `components/business-os/__tests__/OwnerDirScript.test.tsx` | create | The script sets only `lang`/`dir`, for each language, with a safe fallback |
| `lib/business-os/__tests__/LanguageContext.initialLanguage.render.test.tsx` | create | jsdom: first render, source handling, backfill, GET 500, currency cases (AC-1.10), StrictMode, hydration, wrapper follows a switch |
| `lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts` | create | Source guard: layout wiring, the CRM provider stays gone, `force-dynamic` importers only, no cookie |
| `docs/workplans/PERF_BR1A_LANGUAGE_FIRST_FRAME_WORKPLAN.md` | create | This document |
| `docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` | **not committed here** | Ships in PR #364. The §0 rows for BR-1a are added to the **master copy** in the main checkout, never committed on this branch |

No migration, no API route, no repository change.

---

## §4 Task List

- [ ] **T-0** Measure the baseline at `5e44871d` before any code (§7): filmstrip runs (he/es, `/business-os` and `/business-os/crm`) and 10 server-response runs for `/business-os`. **Not done by Dev:** it needs a signed-in owner session and Dev does not sign in (coordinator's instruction). The method is handed to the main session. The base is the fixed SHA `5e44871d`, so it can still be measured after the code change.
- ✅ **T-1** Create `lib/business-os/ownerLanguage.ts`.
- ✅ **T-2** Create `lib/business-os/readInitialLanguage.ts`, with a header covering the guarantees, service role and session id, exact match, and no timezone.
- ✅ **T-3** Write `readInitialLanguage.test.ts` and make it pass, with mutation probes: drop the `catch`, return the timezone, use `normalizeLanguage`.
- ✅ **T-4** Create `OwnerDirScript.tsx` and its test.
- ✅ **T-5** Modify `LanguageContext.tsx` (§2.4 items 1–5).
- ✅ **T-6** Write `LanguageContext.initialLanguage.render.test.tsx` and make it pass, with mutation probes: remove the `saved` skip, derive currency from `initial.language`, move the localStorage write to mount, and build the wrapper from the prop.
- ✅ **T-7** Wire the three layouts. Remove the CRM nested provider.
- ✅ **T-8** Write `ownerLanguageFirstFrame.guard.test.ts`.
- ✅ **T-9** Run the regression suites: `paymentHold.test.ts`, `readPlanBadge.test.ts`, `npm run test:bos-entitlements`, `dictionariesStayInStep.guard.test.ts`, `app/api/business-os/preferences/__tests__`, `UserPreferencesRepository.test.ts`, and every render test that mocks `LanguageContext`. Also run `npx tsc --noEmit` on the touched files and `npm run lint`.
- 🔄 **T-10** Production build plus the after measurements (§7). Record before/after in this workplan and in the master requirement §0, uncommitted. **Branch production build done** (compiles; route table in the Implementation Notes). The after measurements are owed by the main session, as for T-0.
- ✅ **T-11** Hand to SA for code review. Leave everything uncommitted (no commit before the user sees the diff).

---

## §5 FR / AC Mapping

### §5.1 Functional requirements

| FR | In BR-1a? | How it is met / where |
|---|---|---|
| FR-1.1 language chosen before first render, server-resolved; CRM nested provider removed | ✅ | §2.1, §2.5. Guard test pins the three layouts and that `<LanguageProvider` appears only there |
| FR-1.2 `lang`/`dir` before first paint; wrapper carries them in server HTML | ✅ | §2.3 script, §2.4 item 5 wrapper |
| FR-1.3 one dictionary per cold load | ⬜ BR-1b | All three still load (accepted for BR-1a) |
| FR-1.4 switching keeps current language until the new one has loaded | ⬜ BR-1b | In BR-1a a switch stays instant, as today. Regression check below |
| FR-1.5 switch failure / retry home per caller | ⬜ BR-1b | No new failure case in BR-1a |
| FR-1.6 saving unchanged | ✅ (no change) | `setLanguage`/`savePreference` untouched; AC-1.8 regression |
| FR-1.7 currency and timezone unchanged | ✅ pinned | §2.4 items 3, 4, 6; render test cases C-1..C-6 |
| FR-1.8 `useOptionalLanguage` / `useBusinessTimezone` outside the provider | ✅ (no change) | Untouched; AC-1.12 |
| FR-1.9 no production import of all three dictionaries | ⬜ BR-1b | — |

### §5.2 Switching paths (C-6) in BR-1a

`setLanguage` is unchanged, so each path behaves as on main and is checked as a regression. Two things are new and are checked per path:
- the `data-owner-locale` wrapper and `<html>` follow the switch;
- a reload afterwards starts in the new language on the first frame.

| Path | Where | BR-1a check |
|---|---|---|
| Header menu | `BusinessOSHeader.tsx:183/190/197`, on `/business-os` **and** `/business-os/crm` | Switch `en → he → es → en`: content, wrapper `dir` and `<html dir>` flip together, and both columns plus one audit row are written per switch. **CRM:** with the nested provider gone, CRM content now follows a header switch at once. By code reading it did not on main, because the inner provider held its own state; QA confirms on base |
| Settings | `app/business-os/settings/page.tsx:857` | Same as the header, plus a reload shows the new language from the first frame |
| Onboarding-chat auto-switch | `app/onboarding-chat/page.tsx:473-479` | Type "עברית" / "español" / "english": the provider state, wrapper and `<html>` follow; the page's own `selectedLanguage` regions behave as today (§10 M-2). Then navigate to `/onboarding-build`: a **new** provider mounts from the server value, so once the save has landed it is correct on the first frame |

Retry-message homes per caller (FR-1.5) are BR-1b and are not built here.

### §5.3 Acceptance criteria

| AC | In BR-1a? | Verified by |
|---|---|---|
| AC-1.1 he, fresh profile, Fast 3G: zero English/LTR frames | ✅ | QA filmstrip, 5 runs (§7) |
| AC-1.2 es | ✅ | QA filmstrip, 5 runs |
| AC-1.3 saved `he`, localStorage `en` → first frame he, localStorage ends `he` | ✅ | Render test P-2 + QA DevTools |
| AC-1.4 no saved, localStorage `es` → en then es, one backfill, next cold load es | ✅ | Render test P-3 + QA (reload shows es from first frame) |
| AC-1.5 (a) server read fails → `unknown` + en, no throw | ✅ | `readInitialLanguage.test.ts` H-4..H-7 |
| AC-1.5 (b) client GET 500, split by `source` (amended) | ✅ | `none`/`unknown`: render test P-4 (no backfill, the localStorage pick applies). `saved` (R-5): render test **P-4b** (stays on the saved language, no PATCH, localStorage untouched, currency from localStorage). Plus QA DevTools |
| AC-1.6 (amended by RC-1) `OwnerDirScript` in view-source with the right value on all three routes; `<html>` `lang`/`dir` correct at the first painted frame; `[data-owner-locale]` correct on the first content frame. **The JS-disabled check is dropped** (the page is blank with JS off, on main too) | ✅ | QA (view-source, filmstrip + DOM) + render test P-7 (first client mount, layout-effect probe) + `OwnerDirScript.test.tsx` + G-1 (script position) |
| AC-1.7 English owner identical to main | ✅ | QA side by side (incl. CRM, which lost its nested provider) |
| AC-1.8 switching from each caller | ✅ regression (instant, as main) | QA, §5.2 |
| AC-1.9 blocked dictionary | ⬜ BR-1b | — |
| AC-1.10 currency and timezone, 4 cases + the 2 SA-6 cases | ✅ | Render tests C-1..C-6 + QA on the dashboard and invoice modal |
| AC-1.11 one dictionary on the network | ⬜ BR-1b | — |
| AC-1.12 `/v2/settings`, `/site/[subdomain]` unchanged | ✅ | QA; untouched code paths |
| AC-1.13 email/insight language unchanged | ✅ | Existing `userLanguage` tests; `userLanguage.ts` untouched |
| AC-1.14 signed-out `/business-os` redirects as today | ✅ | QA; helper returns `unknown` with no session and never throws, and middleware is untouched |

---

## §6 §6 Filter Answer

Restated for BR-1a (requirement §2, §3.7). SA confirms.

| Q | Answer for BR-1a | Why |
|---|---|---|
| Q1 Output | **Yes** | The first frame shows the owner's saved language and direction instead of English/LTR. That is the purpose of the slice, and the settled language is unchanged (AC-1.3, AC-1.4). **Two small side effects, both toward the saved value.** (a) On CRM pages a header switch now reaches the page content immediately (§5.2). (b) If the server read succeeds but the client GET fails, the page stays in the saved language, where main showed this browser's localStorage pick (§9 R-5) |
| Q2 Money | **No** | Display-currency derivation still reads the **localStorage** language and never `initial.language`. The initial `USD` / `undefined` and the GET path are unchanged. Pinned by tests C-1..C-6 (AC-1.10) |
| Q3 Timing | **No** | The timezone stays `UTC` until the GET arrives. The helper never returns it. No schedule change |
| Q4 Scope | **No** | No feature is removed. **In BR-1a a switch stays instant**: the up-to-1 s switch accepted under BQ-3 arrives only with BR-1b |
| Q5 Failures and records | **No** | No new failure case. A server read failure falls back to exactly today's path (`unknown` → English → localStorage after mount). Audit is unchanged per action. **One note for SA:** by code reading, a first CRM load in the rare "nothing saved, browser has a pick" state ran the backfill in **both** providers, giving two PATCHes and two audit rows. After C-1 it runs once. That removes a duplicate, and creates no record that did not exist before |

---

## §7 Metrics and Baseline

All measured on production builds (`next build && next start`): base `5e44871d` and this branch.

The base is built from a scratch `git archive` export with the shared `node_modules` junction, and the junction is removed with `cmd /c rmdir` afterwards. Both builds use the same local env file, which is never committed. The test owner is a QA account with a saved language set per run through Settings.

| Metric | Method | Base (T-0) | Target |
|---|---|---|---|
| **English or LTR frames before he/es** | DevTools Performance filmstrip, Fast 3G, cache disabled, fresh profile (no site data), cold load. 5 runs per language on `/business-os`. Plus 1 run per language on `/business-os/crm`, `/onboarding-build` and `/onboarding-chat` (the last is document attributes and provider strings only, §10 M-2) | Expected ≥ 1 per run; recorded at T-0 | **0 in every run** for he and es |
| **Server response guard (SA-4, C-14)** | Base on `:3001`, branch on `:3002`, run simultaneously. 1 discarded warm-up request each, then **10 interleaved** pairs A, B, A, B… of `curl -s -o /dev/null -w '%{time_total}'` on `GET /business-os` with the same owner's session cookie. Median of each | Base median, recorded at T-0 | Branch median ≤ base median + **max(10% × base median, 30 ms)** |
| Hydration warnings | Console on every AC run, and render test P-8 | 0 expected | 0 |
| `/onboarding-build` server response (RC-6a, **reported, not a gate**) | Same as the `/business-os` guard: 10 interleaved pairs. Its read is sequential, after the payment hold | Recorded at T-0 | Reported only |
| First Load JS per owner route | `next build` route table | Recorded | Informative only. Expected to be flat (a few hundred bytes for the helper and script). BR-1a takes the "visible benefit" exception (§2 rule 3) |

---

**Measurement notes (SA RC-6):**
- **(a)** `/onboarding-build` is reported with its own 10 interleaved pairs; it is not a gate.
- **(b)** From a workstation, the language read includes the workstation-to-Supabase round trip. After warm-up, `readPlanBadge` is served from the 30 s `EntitlementService` cache, so the language read is the critical path of the `Promise.all`. **If the `/business-os` guard fails, record the measured `findLocale` round trip and bring it to SA. The threshold is not loosened.**
- **(c)** The session cookie expires after about 1 h. Check it is still valid across both runs; a redirect to sign-in would show up as a fast, wrong response.

## §8 Test Plan

All Jest, in the existing suite, so no CI time is added. The jsdom files use the `@jest-environment jsdom` docblock, as the existing render tests do.

### §8.1 `lib/business-os/__tests__/readInitialLanguage.test.ts` (node)

`@/lib/auth` and `@/lib/repositories/UserPreferencesRepository` are mocked, as in `readPlanBadge.test.ts`.

| # | Case | Expect |
|---|---|---|
| H-1 | Saved `he` / `es` / `en` | `{ language, source: 'saved' }` |
| H-2 | `preferredLanguage: null` | `{ en, none }` |
| H-3 | `'fr'`, `'HE'`, `' he'`, `''` | `{ en, none }` (exact match, like the client) |
| H-4 | `findLocale` returns `{ error }` | `{ en, unknown }`, one `warn` |
| H-5 | `findLocale` throws | `{ en, unknown }`, no throw |
| H-6 | `getUser()` returns null | `{ en, unknown }`, `findLocale` **not** called |
| H-7 | `getUser()` throws | `{ en, unknown }`, no throw (**AC-1.5a**) |
| H-8 | Called with the session user's id only | `findLocale` called once with `user.id` |
| H-9 | Result shape | Exactly `['language', 'source']`, with no `timezone` even when the row has one (SA-6) |
| H-10 | Source | File begins with `import 'server-only'`; reads through `userPreferencesRepository.findLocale(user.id)`; no `supabase` import, no `cookies(` |

### §8.2 `components/business-os/__tests__/OwnerDirScript.test.tsx` (jsdom)

- **S-1:** `renderToStaticMarkup` for `he`, `es` and `en`. Evaluate the script body in jsdom: `<html>` gets `lang`/`dir` = `he/rtl`, `es/ltr`, `en/ltr`.
- **S-2:** after it runs, `<html>` has **no** `data-public-surface` and no inline `colorScheme`, and the script text contains neither.
- **S-3:** an invalid value, `'</script><script>x()'` cast through `as never`, falls back to `en/ltr`, and the markup contains no `</script>` beyond its own closing tag.

### §8.3 `lib/business-os/__tests__/LanguageContext.initialLanguage.render.test.tsx` (jsdom)

The real provider runs. `@/lib/supabaseClient` (`auth.getUser`) and `global.fetch` are mocked, and a probe component records `language`, `currencyCode`, `businessCurrency` and `timezone` on **every** render.

| # | Case | Expect |
|---|---|---|
| P-1 | `initial: { he, saved }`, localStorage `en`, GET returns `he` | Every recorded render is `he`; `en` never appears |
| P-2 | Same as P-1, at the end | localStorage is `he` (**AC-1.3**) |
| P-3 | `initial: { en, none }`, localStorage `es`, GET returns `preferredLanguage: null` | Renders `en` then `es`; exactly one PATCH with `{ language: 'es' }` (**AC-1.4**) |
| P-4 | `initial: { en, unknown }`, localStorage `es`, GET 500 | Ends `es`, **no** PATCH (**AC-1.5b**) |
| P-4b | (RC-3, R-5) `initial: { he, saved }`, localStorage `es`, no pin, GET 500 | Every render `he`; **no** PATCH; localStorage still `es`; `currencyCode === 'EUR'` |
| P-5 | No `initial` prop | Identical to main: starts `en`, localStorage applies |
| P-6 | `initial: { he, saved }`, then `setLanguage('en')` | Wrapper `[data-owner-locale]` and `<html>` become `en/ltr` (the wrapper follows state, R-3) |
| P-7 | (RC-1) First **client** mount, as production does it after `V2ThemeProvider` mounts, with `initial: { he, saved }` and localStorage `en`. A child's `useLayoutEffect` probe runs on the first commit, before any passive effect | `[data-owner-locale]` already has `dir="rtl" lang="he"`, and a Hebrew `t()` string is in the DOM (**AC-1.6**, first content frame) |
| P-8 | **Defensive only, labelled so:** `renderToString` + `hydrateRoot` with the same props, `console.error` spied | No hydration warning. This guards the day `V2ThemeProvider` starts server-rendering. On today's production path the provider is never hydrated (R-1) |
| P-9 | P-1 inside `<React.StrictMode>` | Still all `he`; currency case C-5 still `EUR` (R-2) |
| C-1..C-4 | **AC-1.10** four owners: business currency `ILS` set or unset × device pin `GBP` set or unset, with `initial: { he, saved }` and localStorage `he` | The final `currencyCode` / `businessCurrency` equal main's rule: the pin, else the business currency, else the localStorage-language default. `businessCurrency` is `undefined` until the GET |
| C-5 | Saved `he`, localStorage `es`, no pin, no business currency | `currencyCode === 'EUR'` (SA-6) |
| C-6 | Saved `he`, no localStorage, no pin, no business currency | `currencyCode === 'USD'` (SA-6) |
| T-1 | Any case | `timezone === 'UTC'` on every render before the GET resolves, then the row's zone |

The expected values for C-1..C-6 come from main's code path. The same test file is run once against `5e44871d`'s `LanguageContext.tsx` with the `initial` prop omitted, to prove main produces the same values.

### §8.4 `lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts` (node, source)

- **G-1:** each of the three layouts imports `readInitialLanguage`, renders `<OwnerDirScript`, and passes `initial=` to `<LanguageProvider`. **(RC-2)** In each layout's returned JSX, `<OwnerDirScript` comes **before** `<V2ThemeProvider` and, in `/business-os`, before `<UserProvider>`. That keeps it outside every client provider that can render `null` on the server.
- **G-2 (rewritten for the SA ruling on RC-6b): started before the payment hold, used only after it.** For each layout: (i) `const initialLanguagePending = readInitialLanguage();` comes before `await redirectIfAwaitingPayment();`; (iv) `readInitialLanguage()` appears exactly once; (v) the first use of `initialLanguagePending` after its declaration comes after the gate. `/business-os`: (ii) `await Promise.all([readPlanBadge(), initialLanguagePending])` comes after the gate; (iii) `readPlanBadge()` appears once, after the gate. Onboarding: (ii) `await initialLanguagePending` comes after the gate. `paymentHold.test.ts` allows only that one un-awaited start ahead of the gate in the three provider layouts; `/test-business-os` stays strictly gate-first.
- **G-3:** `<LanguageProvider` appears in production code only in those three layouts. `app/business-os/crm/layout.tsx` does not import `LanguageContext` and still imports `globals-v2.css`.
- **G-4:** every `app/**` importer of `readInitialLanguage` has `export const dynamic = 'force-dynamic'` (P-1 constraint).
- **G-5:** no cookie. Neither `readInitialLanguage.ts`, `OwnerDirScript.tsx` nor `LanguageContext.tsx` contains `document.cookie`, `cookies().set` or `cookies(`.
- **G-6:** in `LanguageContext.tsx`, the display-currency default still indexes `DEFAULT_CURRENCY_BY_LANGUAGE` with `savedLang` and never with `initial`. This is a source tripwire for SA-6, in addition to C-5.

### §8.5 Existing suites that must stay green

`lib/business-os/invites/__tests__/paymentHold.test.ts` pins the gate as the first statement and `force-dynamic`. `npm run test:bos-entitlements` includes `enforcementPoints` with the `readPlanBadge` symbol list. Also run:
- `readPlanBadge.test.ts`;
- `dictionariesStayInStep.guard.test.ts`;
- `creditAreaNames.test.ts` and `clientFacingCancelReason.test.ts` (both still import `translations`, which is unchanged in BR-1a);
- the preferences route and `UserPreferencesRepository` tests;
- every render test that mocks `@/lib/business-os/LanguageContext`, about 30 files listed by `grep -rl LanguageContext --include=*.test.tsx`.

### §8.6 Manual QA (production build)

AC-1.1, AC-1.2, AC-1.3, AC-1.4 (including the next cold load), AC-1.5b, AC-1.6 (JS disabled on all three routes), AC-1.7 (including CRM), AC-1.8 per §5.2, AC-1.10 on the dashboard and invoice modal, AC-1.12, AC-1.14. QA watches the console for hydration warnings on every run.

---

## §9 Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Hydration mismatch** between server and client language | On today's production path the provider is **never hydrated**: `V2ThemeProvider` renders `null` on the server (SA finding). The only server-rendered piece is the script, which mutates only `<html>`, and `<html>` already has `suppressHydrationWarning`. Defensively: one source (the prop is the `useState` initialiser), localStorage is read only in the effect, and the wrapper is built from state. P-8 is a labelled defensive test; QA watches the console on every run |
| R-2 | **StrictMode double effects** (dev; App Router defaults strict mode on) | No localStorage write at mount (§2.4 item 4), so the second run reads the same localStorage as the first and currency derivation cannot drift to the server language. The existing double GET in dev is unchanged. Test P-9 |
| R-3 | **`router.refresh()` / layout re-render** delivering a stale server language after a switch | The prop is consumed only by `useState`'s initialiser, so re-renders cannot reset the state. The wrapper is built from state, never from the prop. A server-built wrapper would pin the old `dir` after a switch, so it is rejected (Q-1). The script's text may update on a refresh but is never re-executed. No `router.refresh()` caller exists in owner surfaces today. Test P-6 |
| R-4 | **Owner with no saved language** | `source: 'none'` → English first frame, then the localStorage pick after mount and the backfill, as today. The next cold load is correct (BQ-2). **F-3 caveat** (`UserPreferencesRepository` header): a row created by a timezone save carries the column default `en`, so it counts as saved `en`. Main also lets that `en` win at `:270`, so the settled language is the same, with no flash now |
| R-5 | Server read OK but client GET fails | The page stays in the saved language, where main showed the localStorage pick. The backfill is still skipped (no `locale`), and currency still comes from localStorage. It moves toward the saved value, the §3.4 rule. Raised as Q-2 |
| R-6 | Extra server work on every full owner load | **Measured, failed, redesigned.** The first version ran `findLocale` after the hold's uncached lineage read, adding one serial Supabase round trip: base 251.5 ms vs branch 408.5 ms median (+157 ms against a 30 ms allowance). Per the SA ruling on RC-6b, the read is now **started before** the hold and awaited after it, so the two round trips overlap. `getUser()` is shared through its in-flight map. **Re-measured, passes** (SA, 2026-10-14): pooled 20 pairs, base 244.5 ms vs branch 239.5 ms (Δ −5 ms); lower quartiles level (221.5 vs 222). The branch tail is heavier (max of two parallel reads), so a post-deploy p75/p90 check is owed. It is not a gate |
| R-7 | A language value in an inline script | Server-resolved, never client-supplied, no cookie. Re-validated against the closed enum inside `OwnerDirScript` and `JSON.stringify`-serialised. Test S-3 |
| R-8 | Per-user HTML cached for another user | All three segments are `force-dynamic`; G-4 pins that every importer is |
| R-9 | Removing the CRM nested provider changes CRM state sharing | Currency and timezone derivation are identical in both providers, so the values are the same. Two side effects: one fewer GET and one fewer backfill per CRM load (Q5 note), and header switches now reach CRM content (Q1 note). AC-1.7 and AC-1.10 are run on a CRM page too |
| R-10 | The `display: contents` wrapper changes layout | No box is generated, so percentage heights and flex/grid children resolve against the same parents. Only child-combinator CSS through the provider could notice. AC-1.7 side-by-side covers it, and jsdom cannot |
| R-11 | Soft navigation into an owner segment from a surface without the provider | The script is not executed on soft navigations. The kept `dir` effect sets `<html>` after mount, as today. A fresh provider now starts in the server language, so the wrapper is right at once. SA §12.5's layout-effect suggestion is not included; Q-3 |
| R-12 | Entitlements registry drift | The import set from the module is unchanged. `npm run test:bos-entitlements` before handover |

---

## §10 Requirement vs Code: Mismatches Found

| # | Requirement says | Code at `5e44871d` | Effect on the plan |
|---|---|---|---|
| M-1 | Settings caller at `app/business-os/settings/page.tsx:868` (FR-1.4, C-6) | It is at **`:857`** (drift since `ffb598ac`). Other cited lines (`LanguageContext.tsx:181/208-211/270-272/294-298`, layouts `:62/:64/:69`, `:24/:25`, header `:183-197`, onboarding-chat `:473-479`) match | None; cite `:857` |
| M-2 | "Owners see their own language from the very first frame" on `/onboarding-chat` (FR-1.1, AC-1.6) | The onboarding-chat **page** keeps its own `selectedLanguage`, deliberately starting at `'en'` (`page.tsx:241-243`, "Always start in English (LTR)"). It puts an explicit `dir` on its root and every region (`:1233`, `:1260`, `:1281`, …). Only the `t()` strings follow the provider | For a saved-`he` owner on `/onboarding-chat`, BR-1a makes `<html>`, the wrapper and the `t()` strings Hebrew/RTL from the first frame. The chat body stays English/LTR **by its own design**, as it does on main after the GET. QA should not count that as a failed frame. Changing it is out of scope |
| M-3 | `/onboarding-build` follows the owner's language | `?lang=` in the URL overrides the context language (`onboarding-build/page.tsx:133-134`) | Unchanged; QA tests without `?lang=` |
| M-4 | "The layout wrapper also carries `dir`/`lang` in the server HTML, as `PublicBrandFrame` does" (P-2) | Public brand language never changes at runtime; the owner's does (three switch callers) | The wrapper is rendered by the provider from **state** (still in server HTML), not by the layout from the prop (Q-1) |
| M-5 | Nested CRM provider: "a duplicate preferences request" (SA-1) | It is also a separate **state**: the header switch (outer provider) does not reach CRM content until remount, and in the none-state both providers backfill (two PATCHes) | Removal fixes both. Recorded under §6 Q1 and Q5 |
| M-6 | "The owner's saved language, if it is a supported value" (§3.4) | `findLocale` returns the raw string. `normalizeLanguage` (trim + lowercase) is what server features use; the client uses exact equality | The helper uses exact match to match the settled language (§2.1) |

---

## §11 Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | The FR-1.2 wrapper: provider-rendered `<div style="display:contents" dir lang>` from state, instead of a layout-rendered wrapper from the server prop (§2.4 item 5, R-3, M-4). Approve as part of P-2? | Approve. A prop-built wrapper goes stale after any switch and overrides `<html dir>` |
| Q-2 | "Write localStorage to match" for `saved`: keep the write at `:272` (on GET confirmation) rather than at mount (§2.4 item 4, R-2, R-5)? | Keep it at `:272`. A mount-time write breaks SA-6 under StrictMode |
| Q-3 | SA §12.5: switch the `dir` effect to a layout effect (isomorphic) for soft navigations? | Leave it out of BR-1a to keep the diff minimal; a one-line follow-up if SA wants it |
| Q-4 | Confirm the §6 answers, especially the Q1 side effects and the Q5 duplicate-backfill note | — |

---

## Implementation Notes

**Implemented 2026-10-14 on `5e44871d`. Uncommitted.** SA RC-1 to RC-3 were folded into §2.4, §5.3, §8 and R-1 before coding. RC-4 to RC-6 were applied during implementation.

| Item | What was done |
|---|---|
| RC-4 | `LanguageContext.tsx`: `type Language = OwnerLanguage`, imported from `lib/business-os/ownerLanguage.ts`. The client never imports `userLanguage.ts` (G-5) |
| RC-5 | `const initialSource = useRef(initial.source).current;` is read inside the mount effect. The effect lists `[initialSource]`, which never changes after mount, so it runs once as before and satisfies exhaustive-deps |
| RC-6 | Metric notes added to §7 |
| Layout JSX | The `/business-os` layout wraps its existing tree in a fragment, with `OwnerDirScript` first. The existing tree was **not** re-indented, to keep the diff readable |
| Tests: TextEncoder | jsdom lacks `TextEncoder`, which the browser build of `react-dom/server` needs. The two tests that server-render polyfill it from Node's `util`, the same way `GoogleSignupButton.render.test.tsx` does |
| Tests: currency parity | The currency cases C-1..C-6 run twice in the render test: with `initial: { he, saved }` and **without** `initial` (the pre-BR-1a path). Equal answers prove the server language cannot move the currency. This replaces the planned separate run against `5e44871d`'s file |

### Test results

| Run | Result |
|---|---|
| New: `readInitialLanguage.test.ts`, `OwnerDirScript.test.tsx`, `LanguageContext.initialLanguage.render.test.tsx`, `ownerLanguageFirstFrame.guard.test.ts` | First round: 4 suites, **69** tests pass (64 was an undercount; corrected per QA). After the RC-6b change (G-2 rewritten): **4 suites, 79 tests pass, 0 act() warnings** |
| `paymentHold.test.ts` (gate first **awaited** statement, `force-dynamic`), `dictionariesStayInStep.guard.test.ts`, `readPlanBadge.test.ts`, `app/api/business-os/preferences`, `UserPreferencesRepository.test.ts`, `clientFacingCancelReason.test.ts`, `creditAreaNames.test.ts` | After RC-6b: 7 suites, 130 tests pass |
| `npm run test:bos-entitlements` | After RC-6b: **259/259 suites, 7604/7604 tests pass**. In the first round, `creditsBlock.render.test.tsx` failed once under load and passed alone; QA and SA confirmed it is unrelated |
| Every test file referencing `LanguageContext` (`app components lib hooks tests`, 45 files) | After RC-6b: 45 suites, 1305 tests pass |
| `npm run lint:hooks` | Clean |
| ESLint on the 12 touched/new files | 0 errors. 2 warnings in `LanguageContext.tsx`, both already on main: the unused `CREDIT_EXPLANATION` import and the unused `currencyInitialized` |
| Scoped `tsc` (temporary tsconfig over the 12 files, since removed; a full `tsc` runs out of heap) | **0 errors in touched files.** 27 lines of errors are reported in untouched files reached through imports: duplicate keys in `translations/en.ts`/`es.ts`, `<style jsx>` typing, and others. All are on main |
| `next build` (branch, production) | Compiles. The first attempt hit the known `next/font` download flake; the retry passed. `.env.local` was copied in for the build and deleted afterwards |

### Mutation probes (each restored from a backup copy afterwards)

| Probe | Result |
|---|---|
| M1 drop the `saved` skip of the localStorage override | 3 tests fail |
| M2 derive the currency default from the server language | 4 tests fail |
| M3 write localStorage from the server value at mount | 2 tests fail |
| M4 build the wrapper from the prop instead of state | 1 test fails |
| H1 normalise the stored value (trim + lowercase) | 3 tests fail |
| H2 return the timezone | 4 tests fail |
| H3 drop the helper's `catch` | 2 tests fail |
| L1 move `OwnerDirScript` inside `V2ThemeProvider` | 1 test fails (G-1, RC-2) |
| **M-a** (RC-6b) `await initialLanguagePending;` before the gate in `/business-os` | 2 tests fail: G-2(v), plus paymentHold "first awaited statement" |
| **M-b** (RC-6b) move `readPlanBadge()` before the gate (`const planPending = readPlanBadge()`, used in the `Promise.all`) | 3 tests fail: G-2(ii), G-2(iii), paymentHold |
| **M-c** (RC-6b) any other statement (`const extra = 1`) before the gate | 1 test fails: paymentHold "only the language start may precede it" (R-2) |
| **M-d** (RC-6b) drop the outer `catch` in `readInitialLanguage` | 2 tests fail: "a throwing repository", "a throwing session read" (H-5, H-7). This pins the never-reject property the dangling promise now depends on |
| **G-6 broadened** (QA Edge Case 1): a mount write of `language` (QA's Q-M2a) | Now also fails G-6 "localStorage is written only from the confirmed GET value or a switch" |

### RC-6b change and QA low items (2026-10-14, second round)

| Item | Done |
|---|---|
| Layouts | All three start `readInitialLanguage()` before `await redirectIfAwaitingPayment()` and use it only after. The Slice 5b comments say "first **awaited** statement" |
| `paymentHold.test.ts` | Header updated. The first-statement case is split: the three provider layouts may have exactly `const initialLanguagePending = readInitialLanguage()` first, with the gate as the next statement; `/test-business-os` stays strictly gate-first |
| G-2 | Rewritten per SA (i)–(v); described in §8.4 |
| G-6 | Broadened. The `business-os-language` writes in `LanguageContext.tsx` must be exactly two: the GET confirmation (`locale.preferredLanguage`) and `setLanguage` (`lang`) |
| SA O-1 / QA Edge Case 2 | `releaseAndSettle()` (act + `waitFor` + flush) ends P-7 and P-8, which hold the GET. 0 act() warnings |
| Scoped tsc (tsconfig removed) | 0 errors in touched files, including `paymentHold.test.ts`. 19 errors are in untouched files reached through imports, all on main |
| `npm run lint:hooks` | Clean. ESLint on the 6 changed files: clean |
| `next build` (branch, after RC-6b) | **Exit 0**, first attempt, BUILD_ID `Yn-Bja5lGUt-DIWlHvfzR`. Route table unchanged: `/business-os` 476, `/business-os/crm` 519, `/onboarding-build` 454, `/onboarding-chat` 406 kB. No server started; `.env.local` left in place for the main session's re-measurement |

### Route table (informational, not a gate; branch build only)

`/business-os` 476 kB, `/business-os/crm` 519 kB, `/onboarding-build` 454 kB, `/onboarding-chat` 406 kB First Load. No base build was made at `5e44871d`, so there is no like-for-like delta. The requirement's post-PERF-2 figures (473 / 513 / 450) come from an older base. The slice adds only the helper (server), the script (server) and about 20 lines to the provider.

### Owed by the main session (Dev does not sign in)

1. **T-0 / T-10 server-response guard:**
   - Build `5e44871d` and this branch for production and run both at once, the base on `:3001` and the branch on `:3002`.
   - Send each one discarded warm-up `GET /business-os` with the same owner's session cookies.
   - Then make 10 interleaved pairs, A then B: `curl -s -o /dev/null -w '%{time_total}\n' -H 'Cookie: <session cookies>' http://localhost:300X/business-os`.
   - Compare the medians. The gate: branch ≤ base + max(10% × base, 30 ms).
   - Repeat for `/onboarding-build`, reported only.
   - Apply the RC-6 (b) and (c) notes in §7.
2. **Filmstrip metric** (§7): base and branch, he and es, including the CRM and onboarding runs.
3. **QA manual list** (§8.6), including the AC-1.7 side-by-side on CRM, Settings and onboarding (R-10).

### Files

| File | Change |
|---|---|
| `lib/business-os/ownerLanguage.ts` | new |
| `lib/business-os/readInitialLanguage.ts` | new |
| `components/business-os/OwnerDirScript.tsx` | new |
| `lib/business-os/LanguageContext.tsx` | `initial` prop, `Language = OwnerLanguage`, `saved` skip, state-driven wrapper |
| `app/business-os/layout.tsx`, `app/onboarding-build/layout.tsx`, `app/onboarding-chat/layout.tsx` | read + script + prop |
| `app/business-os/crm/layout.tsx` | nested provider removed, comment added |
| 4 test files | new |

---

## SA Review Notes

**Reviewed by SA — 2026-10-14** (code read in this worktree at `5e44871d`)
**Status:** 🔄 APPROVED WITH CHANGES. Implementation may start once RC-1 to RC-3 are folded into §2, §4 and §8 of this plan. RC-4 to RC-6 can be applied during implementation.

### Key finding the plan missed: the provider subtree is never server-rendered

`V2ThemeProvider` (`lib/design-system-v2/theme-provider.tsx:52-57`, `:260-262`) returns `null` until its own mount effect runs ("Prevent SSR flash"). All three layouts mount `LanguageProvider` **inside** it (`app/business-os/layout.tsx:68-69`, `app/onboarding-build/layout.tsx:24-25`, `app/onboarding-chat/layout.tsx:23-24`). Consequences:

- **Nothing from `LanguageProvider` down is in the server HTML**, on main and on this branch. With JavaScript disabled an owner page is blank. The planned `data-owner-locale` wrapper therefore can never be "in the server HTML" (§2.4 item 5, AC-1.6 as written).
- **The provider is never hydrated.** It mounts client-side on the render after `V2ThemeProvider`'s effect. R-1 (hydration mismatch) cannot occur on the production path. P-7/P-8 test the provider in isolation, so they would pass while proving nothing about production.
- **The slice still works, and the premise still holds.** On main, the first content render is `en`, and the switch happens in a passive effect afterwards, so an English frame can paint. On this branch, the first content render is the `useState` initialiser, which is the saved language. The **wrapper's `dir`** is correct on that very first commit, before the passive `dir` effect runs. The **script** puts `<html>` right while the document is parsed. So the first frame with content is correct.
- **The script must sit outside `V2ThemeProvider`.** Inside it, the script would never reach the HTML. §2.3 already puts it first, and RC-2 pins that.

### Rulings on §11

| # | Ruling |
|---|---|
| Q-1 | **Approved: the provider renders the wrapper from state.** Given the finding above, it is the only placement that does work. A layout-written wrapper outside `V2ThemeProvider` would be an empty `div` in the server HTML, because its children render nothing on the server, and it would go stale after a switch (M-4). `display: contents` is accepted. R-10 stands, so QA checks CRM, Settings and onboarding side by side under AC-1.7. This amends P-2: "server HTML" becomes "the first rendered content frame" (requirement FR-1.2 / AC-1.6 amended). |
| Q-2 | **Approved: keep the write at `:272`.** The StrictMode analysis is correct: both effect runs read localStorage synchronously, and the `:272` write comes after an `await`. A mount write would let run 2 derive currency from the server language, which is the SA-6 trap. **R-5 accepted.** If the server read returns `saved` but the client GET fails, the page stays on the saved language. That follows §3.4 rule 1 (the saved value decides), and on main a successful read would have overruled the device pick anyway. Currency is still derived from the localStorage language, and there is no backfill (no `locale`). AC-1.5(b) was written assuming `none`/`unknown`, so it is amended in the requirement to split by `source`. Test: RC-3. |
| Q-3 | **Agreed: leave the layout-effect change out.** With the state-built wrapper, page content has the right `dir` on its first commit even on a soft navigation. Only `<html>` (portals, the Toaster) waits for the passive effect, which is today's behaviour. The suggestion stays a follow-up. |
| Q-4 | **§6 answers confirmed:** Q1 Yes, Q2 No, Q3 No, Q4 No, Q5 No. The two Q1 side effects (CRM content follows a header switch at once; R-5) both move toward the saved value and are accepted. The Q5 note is accepted: removing the CRM duplicate takes away a duplicate GET, PATCH and audit row and creates no new record. Both are recorded in requirement §3.7. |

### Rulings on §10

| # | Ruling |
|---|---|
| M-1 | Cite `:857`. Requirement FR-1.4 updated. |
| M-2 | **Yes, exclude the chat body.** `/onboarding-chat` starting its chat in English is a deliberate design (`page.tsx:241-243`) and outside BR-1. On that route the metric counts `<html>` `lang`/`dir`, the `data-owner-locale` wrapper and the provider's `t()` strings. The page's own `selectedLanguage` regions are excluded. Requirement §3.7 metric, AC-1.6 and §3.10 now say so. |
| M-3 | Agreed. QA tests `/onboarding-build` without `?lang=`. |
| M-4 | See Q-1. |
| M-5 | **Accepted within BR-1a.** C-1 already mandates the removal. The behaviour changes are the CRM content following a header switch at once, and one GET / backfill / audit row fewer per CRM load in the `none` state. Both are fixes toward intended behaviour, not new behaviour, so no new business question is needed. Recorded in requirement §3.7 (Q1 and Q5). |
| M-6 | **Exact match, approved.** The helper must agree with the client's settle rule (`LanguageContext.tsx:209`, `:270`), or the first frame and the settled language diverge on a non-canonical row. Normalising is part of the column-alignment roadmap item (§8), not this slice. H-3 pins it. |

### Other checks

| Check | Result |
|---|---|
| Payment hold first | ✅ The plan keeps `await redirectIfAwaitingPayment();` as the first statement in all three layouts. `paymentHold.test.ts:253-264` splits on the first `;` of the body, so the `Promise.all` line after it is safe. G-2 pins the order in `/business-os`. Onboarding runs the read sequentially after the gate, which is accepted (there is nothing to run it in parallel with). |
| `server-only` | ✅ `readInitialLanguage.ts` is `server-only` and is imported only by server layouts. `ownerLanguage.ts` has no imports, and the client provider imports only that. `OwnerDirScript` has no `'use client'` and is rendered only from server layouts. H-10 and G-5 cover this. |
| Timezone / currency authority | ✅ No authority moves. The helper never returns the timezone (H-9). The display-currency default stays keyed on `savedLang` (G-6, C-5/C-6). The initial values stay `USD` / `undefined` / `UTC`. |
| Entitlements | ✅ No new import from `lib/business-os/entitlements/`. The `/business-os` layout's import set stays `readPlanBadge` only, which matches the `enforcementPoints.test.ts:272-276` registration. The helper must not import anything from that module. |
| Tenant isolation | ✅ A read only, through the service-role repository, scoped by `user.id` from `getUser()`. There is no id parameter (H-8). |
| Hook rules | ✅ The new readers (`isOwnerLanguage`, `ownerDir`, `readInitialLanguage`) are not `use…`. The `useState` initialiser is pure. See RC-5 for the effect dependency. |
| Logging | ✅ 0 `console.*` in the touched files (verified). The helper uses `createLogger` and logs `{ err }`. |
| Test plan | Strong mutation-probe design. The P-7/P-8 scope is corrected by RC-1, and P-4b is added by RC-3. |
| Metric method | Filmstrip method approved. Blank frames before the provider mounts are not "English" frames, but they **are** checked for `<html dir>`. The server guard is approved, with RC-6. |

### Required changes

1. **RC-1 (High): re-scope the server-HTML claims.** In §2.4 item 5, §5.3 AC-1.6, R-1 and §8.3, replace "in the server HTML" with "on the first rendered content frame". Re-scope **P-7**: render the provider for the first time on the client (as `V2ThemeProvider` does after mount). Assert, from a `useLayoutEffect` probe in a child, which runs on the first commit before any passive effect, that `[data-owner-locale]` already has `dir="rtl" lang="he"` and that a Hebrew `t()` string is in the DOM. Keep **P-8** only as a labelled defensive test (it protects the day `V2ThemeProvider` starts SSR'ing), or drop it. QA's AC-1.6 is now: view-source shows `OwnerDirScript` with the right value on all three routes; `<html>` `lang`/`dir` are correct at the first painted frame (filmstrip plus DOM); and `[data-owner-locale]` is correct on the first content frame. The JavaScript-disabled check is dropped: the page is blank with JS off on main too.
2. **RC-2 (High): pin the script's position.** G-1 must also assert that, in each layout's returned JSX, `<OwnerDirScript` comes **before** `<V2ThemeProvider` and before `<UserProvider>` (`/business-os`), i.e. outside every client provider that can render `null` on the server.
3. **RC-3 (Medium): test R-5.** Add **P-4b**: `initial: { he, saved }`, localStorage `es`, no pin, GET 500. Expect every render to be `he`; no PATCH; localStorage still `es`; `currencyCode === 'EUR'`. Add it to the AC-1.5(b) row in §5.3.
4. **RC-4 (Low): one language enum.** Define `Language` in `LanguageContext.tsx` as (or assert it is identical to) `OwnerLanguage` from `ownerLanguage.ts`, so that the server helper, the script and the provider cannot drift. Do not import `userLanguage.ts` into the client.
5. **RC-5 (Low): make the effect's mount-time read explicit.** Capture `initial.source` once (`useRef(initial.source)` or a `useState` initialiser) and read that inside the `[]` mount effect. This avoids an exhaustive-deps finding on a prop, and it makes R-3 (props after mount are ignored) visible in the code.
6. **RC-6 (Low): metric notes.**
   - (a) Also record 10 interleaved runs for `/onboarding-build`. Its read is sequential. Report it, but it is not a gate.
   - (b) Measuring from a workstation adds the workstation-to-Supabase round trip to the language read. Because `readPlanBadge` is served from the 30 s `EntitlementService` cache after warm-up, the language read is now the critical path of the `Promise.all`. If the `/business-os` guard fails, record the measured `findLocale` round trip and bring it to SA. **Do not loosen the threshold.**
   - (c) Watch the session cookie's expiry (about 1 h) across the T-0 and T-10 runs.

### Adjusted items (marked by SA)
- §2.4 item 5 / Q-1: the wrapper is approved, but it lives on the first **client** frame, not in the server HTML (RC-1).
- §8.3 P-7/P-8: re-scoped (RC-1); P-4b added (RC-3).
- §8.4 G-1: extended with the script position (RC-2).

### Optimisation suggestions (non-blocking)
- **Out of scope, for the performance scoping document:** `V2ThemeProvider` returning `null` until mount means every owner page paints **no content** until hydration plus one more render. That is likely a larger first-paint cost than the language flash. It is now logged in requirement §8 as a candidate. It is **not** for BR-1a: rendering that subtree on the server would make hydration risk (R-1) real.
- `/business-os/crm/layout.tsx` still nests a second `V2ThemeProvider`, so CRM content waits one more mount. Leave it (C-1 scoped the change to the language provider) and note it with the item above.

### Approval
[x] Workplan approved with the changes above. Proceed to implementation after RC-1 to RC-3 are reflected in the plan.

---

**Code Review by SA — 2026-10-14** (uncommitted diff in `neuronforge-br1a` on `5e44871d`)
**Status:** ✅ Code Approved

SA re-ran the 4 new suites, `paymentHold.test.ts` and `creditsBlock.render.test.tsx` together: 6 suites, 177 tests pass. SA also ran a scoped `tsc` over the 12 touched and new files.

### Checks

| # | Check | Result |
|---|---|---|
| 1 | RC-1..RC-6 | ✅ RC-1: §2.4, AC-1.6 and R-1 are re-worded, P-7 is a first-client-mount layout-effect probe, and P-8 is labelled defensive. RC-2: the G-1 second case orders `<OwnerDirScript` before `<V2ThemeProvider`, `<UserProvider` and `<LanguageProvider` in each layout's `return (`; mutation probe L1 shows it bites. RC-3: P-4b is present and mapped to AC-1.5(b). RC-4: `type Language = OwnerLanguage`, one `OWNER_LANGUAGES` list. RC-5: `useRef(initial.source).current`. RC-6: the §7 notes are present |
| 2 | Payment hold first | ✅ `await redirectIfAwaitingPayment();` is still the first statement in all three layouts. `paymentHold.test.ts` passes, and G-2 pins the read after it |
| 3 | Script position | ✅ The script is the first child of a fragment, a sibling of `UserProvider` (`/business-os`) and of `V2ThemeProvider` (onboarding), so it is outside both |
| 4 | `server-only` | ✅ `readInitialLanguage.ts` starts with `import 'server-only'` and is imported only by the three server layouts (G-4). `ownerLanguage.ts` has no imports. `OwnerDirScript` has no `'use client'` and imports only `ownerLanguage.ts`. The client provider imports nothing server-side (G-5) |
| 5 | Timezone / currency authority | ✅ The helper returns `{ language, source }` only (H-9). The display-currency default is still `DEFAULT_CURRENCY_BY_LANGUAGE[savedLang]` (G-6, C-5/C-6). The initial values `USD` / `undefined` / `UTC` are unchanged. Currency parity is proven by running C-1..C-6 with and without `initial` |
| 6 | localStorage write | ✅ The only `setItem('business-os-language', …)` in the mount path is still inside the branch where the GET returned a valid `preferredLanguage`. Nothing is written at mount (M3 probe, G-6 second case) |
| 7 | `useRef` capture | ✅ `[initialSource]` is constant after mount, so the effect runs once as before, and a later prop cannot re-run it. See O-2 |
| 8 | Wrapper from state | ✅ `dir={isRTL …}` and `lang={language}` come from state, with `display: contents` (M4 probe, P-6) |
| 9 | CRM layout (C-1) | ✅ Only the `LanguageProvider` import and element are gone. `'use client'`, the `globals-v2.css` import and `V2ThemeProvider` stay. G-3 pins the CSS import and the absence of the language context |
| 10 | Script safety | ✅ The value is re-checked against the closed `OWNER_LANGUAGES` list, falls back to `en`, and only two `JSON.stringify`-ed literals from `{en, es, he}` / `{ltr, rtl}` reach `__html`. The value is server-resolved and never client-supplied. Injection is not possible. S-3 pins the fallback |
| 11 | Entitlements | ✅ No new import from `lib/business-os/entitlements/`. The `/business-os` layout's import from it is still `readPlanBadge` only |
| 12 | Hook rules | ✅ The new readers are not `use…`. The `useState` initialiser is pure and `lint:hooks` is clean |
| 13 | `console.*` | ✅ None in the 12 touched or new files. The helper uses `createLogger` and logs `{ err }` at `warn` |

### Rulings

- **Un-re-indented `/business-os` fragment: acceptable.** The JSX is valid and the guard tests read it correctly. A whitespace-only re-indent would turn a 13-line diff into a ~45-line one and hide the real change. Nothing in the repo enforces formatting on it. RM may re-indent in the commit if the user prefers. It is not a blocker.
- **Claim 1, `creditsBlock.render` is a load-related flake: accepted.** It imports nothing this slice touches (no `LanguageContext`, layout or `ownerLanguage`). SA ran it alongside the BR-1a suites and it passed (51 s, all green). That fits the request-id timing case (OP-32) under full-suite load. It is not a regression from this slice.
- **Claim 2, the tsc errors are pre-existing: confirmed.** In SA's scoped `tsc`, the touched and new files have 0 errors. The 23 errors reported are all in files this diff does not change: 16 duplicate keys in `translations/en.ts` / `es.ts`, 4 `<style jsx>` typings, and one each in `JourneyGapNotice`, `StripeConnectStatus` and `InvoiceSettingsSection`. None involve `Language`, whose union is unchanged.

### Code Review Comments

None blocking.

### Optimisation Suggestions (non-blocking)

- **O-1:** the render test prints React `act(...)` warnings from the GET's `setLanguageState`. They are noise, not failures. Wrapping the awaited settle in `waitFor`/`act` would keep the output clean. A follow-up is fine.
- **O-2:** `useState(() => initial.source)[0]` says "mount-time value" as clearly as `useRef(…).current`, and it avoids reading a ref during render, which a future React Compiler `react-hooks/refs` rule would flag. It is optional.
- **Out of scope, for TL. A real defect on main, not caused by BR-1a:** `components/business-os/settings/InvoiceSettingsSection.tsx:779` calls `setAddressPicked(false)`, which is not defined (TS2552, unchanged since `7411b2e6`). At runtime, picking an autocomplete address in invoice settings throws a `ReferenceError` after `setReusedAddress(null)` and before `setSettings(…)`, so the picked address is probably not applied. It should get its own fix ticket.

### Still owed (unchanged from the Implementation Notes, not SA blockers)

- The T-0/T-10 server-response guard (§7, with RC-6). If it fails, it comes back to SA, and the threshold is not loosened.
- The filmstrip metric.
- QA §8.6, including the AC-1.7 side-by-side on CRM, Settings and onboarding for R-10 (`display: contents`).

### Code Approved for QA: Yes

---

**SA ruling on the failed server-response guard (RC-6b), 2026-10-14**  
**Status:** 🔄 Fix Required (design change, option b). The threshold is unchanged. Code Approved for QA is **suspended** until the change below is in and the guard is re-measured.

**Measured (main session):** base `5e44871d` median 251.5 ms, branch median 408.5 ms, Δ +157 ms (+62%) against an allowance of 30 ms. **Fails.** Branch `GET /api/business-os/preferences` median 212 ms; raw TLS to the Supabase REST endpoint from the workstation 83–123 ms.

**Diagnosis.** The guard did its job. It measured one extra *sequential* Supabase round trip per render, and that is a structural cost, not a local artefact. On the warm path, `getUser()` is served from its session cache and `readPlanBadge()` from the 30 s `EntitlementService` cache. The hold's lineage read (`findHoldFactsForAccount`) has no cache, so the base layout already pays **one** round trip, and the branch adds `findLocale` as a **second** one after it. A workstation magnifies the round trip, but in production on Vercel it would still be a second serial hop on every owner page, in every region pairing.

**Option (a) rejected.** Moving the gate to a Vercel preview would let a serial round trip through because that round trip is shorter there. It would also make the gate noisier (cold starts, shared runners), and previews point at the prod project anyway. The local, interleaved, same-host comparison stays the gate. Its value is that it counts serial round trips.

**Other (b) candidates rejected:**
- **A per-user server cache for the language (like the plan pill's).** Rejected. Under serverless, the PATCH and the next render can land on different instances, and an instance cannot invalidate another's memory. After a switch, a hard reload or a new tab inside the TTL would paint the *old* language first, and then the client GET would flip it. That brings back the mixed frame BR-1a exists to remove, and it breaks consistency with what the GET settles on. Soft navigation is safe either way: the provider ignores `initial` after mount (R-3). Hard loads are not safe.
- **Folding the locale into an existing query.** No existing query fits. The only uncached read is the hold's lineage read, on a different table behind a different repository. Joining them (an RPC or a view) would couple the payment gate to language. That is a new pattern for a 1-column read.
- **Reusing a read the layout already does.** None carries the language. `user_preferences.preferred_language` is the single source (SA-1), and auth metadata is not.

**Ruling: start the language read before the hold, so that its round trip overlaps the lineage read instead of following it.** Only the *start* moves. Nothing awaits it or uses it before the gate returns. On the warm path the layout then costs max(lineage, locale) instead of lineage + locale, which is about one round trip, as on base.

**Exact change for the Dev (three layouts and two guard tests):**

1. **`app/business-os/layout.tsx`.** Replace the gate line and the `Promise.all` line with:
   ```tsx
   // BR-1a (SA ruling on RC-6b): STARTED before the payment hold so its round
   // trip overlaps the hold's lineage read rather than following it. Nothing
   // awaits or uses it until the gate has returned. Safe to leave dangling when
   // the gate redirects, because readInitialLanguage never rejects (its
   // contract, readInitialLanguage.test.ts). The plan read stays after the gate (F5b-4).
   const initialLanguagePending = readInitialLanguage();
   await redirectIfAwaitingPayment();
   const [planBadge, initialLanguage] = await Promise.all([readPlanBadge(), initialLanguagePending]);
   ```
   Update the Slice 5b comment above it to say: the gate is the first **awaited** statement, and no plan read and no render happens before it decides.
2. **`app/onboarding-build/layout.tsx` and `app/onboarding-chat/layout.tsx`.** The same pattern: `const initialLanguagePending = readInitialLanguage();`, then `await redirectIfAwaitingPayment();`, then `const initialLanguage = await initialLanguagePending;`. Replace the "Nothing else here to run it in parallel with" comment with the same reason as item 1. This also removes the RC-6a serial cost on `/onboarding-build`.
3. **`lib/business-os/invites/__tests__/paymentHold.test.ts`, "awaits the gate as the first statement".** Narrow amendment. The first statement must be `await redirectIfAwaitingPayment()`, **or** exactly `const initialLanguagePending = readInitialLanguage()` followed by `await redirectIfAwaitingPayment()` as the second statement. No other statement may precede the gate. Allow the prefix only for the three provider layouts. `app/test-business-os/layout.tsx` stays strictly first. Update the file header (R-1, R-2) to read "first awaited statement; the only permitted predecessor is the un-awaited BR-1a language start".
4. **`lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts`, G-2.** Replace both cases:
   - `/business-os`: (i) `const initialLanguagePending = readInitialLanguage();` comes before `await redirectIfAwaitingPayment();`. (ii) `await Promise.all([readPlanBadge(), initialLanguagePending])` comes after the gate. (iii) `readPlanBadge()` appears once, after the gate. (iv) `readInitialLanguage()` appears exactly once. (v) The first occurrence of `initialLanguagePending` after its declaration comes after the gate, so nothing awaits or reads it before the gate decides.
   - Onboarding layouts: (i), plus `await initialLanguagePending` after the gate, plus (iv) and (v).
   - Rename the describe to "started before the payment hold, used only after it".
5. **Mutation probes (record in Implementation Notes).** M-a: `await` the language start before the gate. G-2(v) must fail. M-b: move `readPlanBadge()` before the gate. G-2(iii) must fail. M-c: insert any other statement before the gate in `/business-os`. paymentHold R-2 must fail. M-d: drop the outer `catch` in `readInitialLanguage`. The existing H-4..H-7 cases must fail. This proves the never-reject property that the dangling promise now depends on.

**P-1 rules, checked against the change:**
- **Never throws.** Unchanged, and now load-bearing. A rejection while the gate redirects would be an unhandled rejection. The function body is one `try/catch` that returns `UNKNOWN`. M-d pins it.
- **Session user only.** Unchanged. `readInitialLanguage()` takes no argument. Its `getUser()` call runs synchronously up to its first `await`, so `cookies()` is read inside the request scope. It shares the gate's `getUser()` through the in-flight map, so the session is verified once, not twice.
- **Exact match, no timezone.** Unchanged. The helper's body is not touched.
- **Consistency with the client GET.** Unchanged. It is still a fresh per-request read of the same column the GET returns. No cache is introduced, so there is no staleness window to reconcile. A language switch sets state and PATCHes, and nothing in the provider calls `router.refresh`. Any later re-render's `initial` is ignored after mount (R-3), and the next hard load reads the committed row. A reload *during* an in-flight PATCH can paint the old value, exactly as on base. This change does not introduce that.
- **The payment hold (F5b-4, R-1, R-2).** Still satisfied in substance. The redirect throws before any JSX is built. No entitlement or plan read runs before the gate. A held friend's language result is discarded, and it was only ever their own language. The cost is one wasted 1-column read per held-friend request, which is negligible.

**Re-measure (same protocol, §7, unchanged threshold).** The expected residual is the max of two parallel round trips minus one round trip: a few ms to ~20 ms locally. If the guard still fails, bring the numbers back to SA with `findLocale` and `findHoldFactsForAccount` timed separately. The threshold is still not loosened. Report `/onboarding-build` as well; it should now be roughly level with base.

### Code Approved for QA: No (suspended pending the change above and a passing guard). *Superseded by the re-measure ruling below.*

---

**SA ruling on the re-measured server-response guard (RC-6b), 2026-10-14**  
**Status:** ✅ Code Approved. The guard passes. The threshold is unchanged.

**Change checked against the ruling.** The diff of the three layouts and `paymentHold.test.ts` matches items 1 to 3 exactly. Each layout runs `const initialLanguagePending = readInitialLanguage();`, then `await redirectIfAwaitingPayment();`, and touches the pending value only after the gate. `/business-os` awaits `Promise.all([readPlanBadge(), initialLanguagePending])` after the gate, so the plan read still follows the gate (F5b-4). The R-2 test allows the language start only as statement one, with the gate as statement two, and only in the three provider layouts. `/test-business-os` still has its own strict gate-first case. The Dev reports 79/79 tests passing, probes M-a to M-d caught, and the build at exit 0.

**Measured (main session, same protocol: production builds, base `5e44871d` on :3011 vs branch on :3012, same owner, in-browser `fetch` with `no-store`, one warm-up each, interleaved pairs; allowance = max(10% × base, 30 ms) = 30 ms):**

| Set | Base median | Branch median | Δ | Against +30 ms |
|---|---|---|---|---|
| 1 (10 pairs) | 244.5 | 300 | +55.5 | fails alone |
| 2 (10 pairs, run immediately after) | 244.5 | 222 | −22.5 | passes |
| **Pooled, all 20 pairs** | **244.5** | **239.5** | **−5** | **passes** |
| Before RC-6b (10 pairs) | 251.5 | 408.5 | +157 | failed |

**Verdict: the gate is the median of all 20 pairs collected, and it passes.** The rule is not loosened. Three reasons, and the first is what stops this being a cherry-pick:
1. **No set was discarded.** The pooled median includes the failing set 1. Re-running until a 10-pair set happened to pass and keeping only that set would not have been acceptable. That is not what was done here.
2. **A 10-pair median is too noisy for a 30 ms allowance at this workstation's noise level.** Both base sets landed on exactly 244.5, yet the branch median moved 78 ms between two back-to-back sets, with no change in between. A single 10-pair set can neither pass nor fail reliably on a 30 ms margin. Twenty pairs is the smallest sample collected that answers the question, and its result is far from the line (−5 against +30).
3. **What the guard exists to catch is gone, and that shows without medians.** A serial round trip (83–123 ms raw TLS from this workstation) shifts the *whole* distribution, minimum included. Before RC-6b it did: +157 at the median. Now the lower halves match. The pooled lower quartile is 221.5 for base and 222 for branch, and the minimum is 206 for base and 212 for branch. A second serial hop would have put the branch's fastest runs near 300 ms.

**Protocol amendment, for every remaining BR measurement (BR-1b included):** the server-response guard is the median of **20 interleaved pairs**, run as one measurement and fixed before it is run. If a measurement is split into sets, every set is pooled and none is dropped. The threshold, max(10% × base, 30 ms), is unchanged.

**Observation, not gating: the branch has a heavier tail.** 6 of 20 branch runs were ≥ 455 ms, against 2 of 20 base runs (580, 661), and the pooled upper quartile is 273 for base vs 393 for branch. Part of this is expected and real. The layout now waits on the slower of two parallel reads instead of on one read, and the maximum of two jittery round trips hits the jitter more often than one does. A second concurrent request to Supabase may also sometimes open a new keep-alive connection, which costs a TLS handshake. The gate is median-based by design, and nothing here is a serial hop, so this does not block. **Owed after deploy (RM / main session):** compare the owner-page server-response p75/p90 on Vercel for a few days before and after BR-1a. If p90 grows by more than the allowance, bring it to SA. Vercel to Supabase is a same-region hop with far less jitter than this workstation, so the tail is expected to shrink there.

**Still owed (reported only, not a gate):** the `/onboarding-build` figure that RC-6b asked for (it should now be about level with base). Record it with the browser checks in M-5. It does not hold approval.

### Code Approved for QA: Yes (restored). QA's M-5 row can be closed with the figures above; the remaining §8.6 browser checks are unchanged.

---

## QA Testing Report

**QA — 2026-10-14**
**Test mode:** full (automated part); manual part handed to the main session (§QA.6)
**Strategy used:** A (Jest unit, render and source-guard suites) plus mutation probes. D (manual browser check) is written below as a checklist, because QA has no signed-in browser. Playwright is not installed.
**Focus:** ui, schema, security (server-only, cookie-free, session-scoped read), performance (server-response guard method)
**Skipped:** the browser run itself (owed by the main session, below)
**Input source:** prompt keywords (coordinator brief) and workplan §8.6
**Tree under test:** worktree `neuronforge-br1a`, branch `feature/perf-br1a-language-first-frame`, base `5e44871d`, uncommitted. After all probes, `git diff` is byte-identical to the Dev's version (sha256 of the full diff and of each probed file checked before and after).

### QA.1 Test runs (re-run by QA)

| Run | QA result | Dev's figure | Note |
|---|---|---|---|
| 4 new suites | **4 suites, 69 tests pass** (`readInitialLanguage` 20, `OwnerDirScript` 5, `ownerLanguageFirstFrame.guard` 20, `LanguageContext.initialLanguage.render` 24) | 64 | Doc drift only: the Implementation Notes count is stale. Nothing fails. **Dev: update the figure to 69** |
| `paymentHold`, `dictionariesStayInStep.guard`, `readPlanBadge`, `preferences/route`, `UserPreferencesRepository`, `clientFacingCancelReason`, `creditAreaNames` | **7 suites, 130 tests pass** | 5 suites / 106 | QA added the repository and `creditAreaNames` suites (§8.5) |
| Every test file referencing `LanguageContext` (`grep -rl` over `app components lib hooks tests`) | **45 suites, 1295 tests pass** | 43 / 1251 | A wider grep: it includes the 2 new files and the admin source guards |
| `userLanguage.test.ts` (AC-1.13) | 1 suite, 9 pass | — | `userLanguage.ts`, the preferences route and `UserPreferencesRepository.ts` have no diff against `5e44871d` |
| `npm run test:bos-entitlements` | **259/259 suites, 7604/7604 tests pass** | 258/259 (load flake) | Dev's `creditsBlock` flake did not recur |
| ESLint, 12 touched/new files | 0 errors, 2 warnings | same | Both warnings already on main (`CREDIT_EXPLANATION`, `currencyInitialized`) |
| `console.*` in new/touched source | 0 | 0 | — |

### QA.2 Mutation probes (QA-repeated; each restored from a scratch backup, hash-verified)

| Probe | Mutation | Result |
|---|---|---|
| Q-M1 | Drop the saved-source check (`initialSource !== 'saved' &&` removed) | **Caught.** 3 fail: P-1/P-2, P-4b, P-9 |
| Q-M2a | Write localStorage at mount, **after** the read: `if (initialSource === 'saved') localStorage.setItem('business-os-language', language)` | **Caught.** 2 fail: P-9 (StrictMode), P-4b. **G-6 does not fire** (see Edge Case 1) |
| Q-M2b | Same write, **before** the read | **Caught.** 4 fail: P-9, P-4b, C-5, C-6. G-6 does not fire |
| Q-M3a | Move `<OwnerDirScript>` inside `<V2ThemeProvider>` in `app/business-os/layout.tsx` | **Caught.** G-1 "renders the script before every client provider" |
| Q-M3b | Same, in `app/onboarding-build/layout.tsx` | **Caught.** G-1 for that layout |

### QA.3 Acceptance criteria → evidence (requirement §3.6)

| AC | Tested? | Result | Evidence / what is still owed |
|---|---|---|---|
| AC-1.1 he, zero English/LTR frames | ⚠️ | Logic pass, **browser owed** | P-1 (every render `he`), P-7 (wrapper `he/rtl` and Hebrew `t()` on the first client commit), S-1 (script sets `he/rtl`), G-1 + Q-M3 (script outside every null-rendering provider). Real frames: M-3 |
| AC-1.2 es | ⚠️ | Logic pass, **browser owed** | S-1 `es/ltr`. The provider path is language-agnostic (`isOwnerLanguage`), but the render tests use `he` only. M-3 |
| AC-1.3 saved he + localStorage en | ✅ logic / ⚠️ browser | Pass | P-1/P-2 (never `en`, localStorage ends `he`). Q-M1 proves the test bites. M-4 |
| AC-1.4 nothing saved + localStorage es | ✅ logic / ⚠️ browser | Pass | P-3 (en → es, exactly one PATCH `{language:'es'}`). The browser check needs a DB edit (M-6 d-2) |
| AC-1.5(a) server read fails | ✅ | Pass | H-4..H-7: `{en, unknown}`, never throws; H-6 makes no read without a session |
| AC-1.5(b) client GET 500 | ✅ logic only | Pass | P-4 (`unknown` → localStorage pick, no PATCH), P-4b (`saved` → stays `he`, no PATCH, localStorage untouched, EUR). Q-M1/Q-M2 bite. **The browser check needs DevTools request blocking, which the in-app browser lacks. Logic-level only unless the user runs it in desktop Chrome** |
| AC-1.6 script in HTML; `<html>` and wrapper right on first frames, 3 routes | ✅ logic / ⚠️ browser | Pass | S-1..S-3 (lang/dir only, safe fallback, no `</script>` escape), G-1 + Q-M3, P-7. M-2 (server HTML) and M-3 (frames) |
| AC-1.7 English owner identical to main | ⚠️ | **Browser owed** | P-5 (no `initial` = main behaviour). The `display: contents` wrapper (R-10) and the CRM change need eyes: M-9 |
| AC-1.8 switching from each caller | ⚠️ | Header/Settings **browser owed**; onboarding-chat **logic only** | `setLanguage` has no diff. P-6 (wrapper and `<html>` follow a switch). The onboarding-chat auto-switch cannot be reached with an onboarded account without `?reset=true`, which **deletes** `onboarding_conversations` and starts a new LLM conversation (M-8) |
| AC-1.9 / AC-1.11 | — | N/A | BR-1b |
| AC-1.10 currency and timezone | ✅ logic / ⚠️ browser | Pass | C-1..C-6 run **with and without** `initial`, with equal answers; T-1 (UTC until the row arrives); Q-M2b caught by C-5/C-6. Browser: M-7, partial (business currency "unset" cannot be produced through the UI) |
| AC-1.12 `/v2/settings`, `/site/[subdomain]` | ⚠️ | **Browser owed** | `useOptionalLanguage`/`useBusinessTimezone` have no diff. M-10 |
| AC-1.13 email/insight language | ✅ | Pass | `userLanguage.ts` untouched; `userLanguage.test.ts` 9/9 |
| AC-1.14 signed-out redirect | ✅ logic / ⚠️ browser | Pass | H-6 (no session → `unknown`, no read, no throw); middleware untouched. M-10 (no sign-out needed) |
| Metric: server-response guard | ⚠️ | **Owed** | M-5 |

### QA.4 Issues found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None measurable in Jest. The server-response guard (M-5) is the open gate.

#### Edge Cases (nice to fix)
1. **The G-6 second case is narrower than the SA code review states (check 6).** Its regex only matches `localStorage.setItem('business-os-language', initial…)`. A mount write of `language` (Q-M2a/b) passes G-6. The behavioural tests (P-9, P-4b, C-5, C-6) still catch it, so no protection is lost. Optional: widen the regex to any `setItem('business-os-language'` outside the GET branch, or credit the behavioural tests instead. — File: `lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts:128-131` — Severity: Low
2. **`act()` warnings in the render test output** (same as SA O-1). The tests pass, so this is noise only. — File: `lib/business-os/__tests__/LanguageContext.initialLanguage.render.test.tsx` — Severity: Low
3. **Stale test count in the Implementation Notes:** 64, where the suites now have 69. — Severity: Low (doc)

### QA.5 Test outputs

```text
4 new suites ............................ Test Suites: 4 passed   | Tests: 69 passed
7 regression suites ..................... Test Suites: 7 passed   | Tests: 130 passed
45 LanguageContext-referencing files .... Test Suites: 45 passed  | Tests: 1295 passed
npm run test:bos-entitlements ........... Test Suites: 259 passed | Tests: 7604 passed
Q-M1  -> 3 failed (P-1/P-2, P-4b, P-9)
Q-M2a -> 2 failed (P-9, P-4b)        Q-M2b -> 4 failed (P-9, P-4b, C-5, C-6)
Q-M3a -> 1 failed (G-1 business-os)  Q-M3b -> 1 failed (G-1 onboarding-build)
After restore: all probed files sha256 OK; full `git diff` sha256 identical
```

### QA.6 Manual checklist for the main session (production builds, in-app browser)

**Facts that shape this checklist**
- **Cookies are per host, not per port.** The session signed in on `localhost` is sent to both `:3001` and `:3002`, so one sign-in serves both servers. **localStorage is per origin** (port included), so set and clear it on each port separately.
- The app's localStorage keys are `business-os-language` and `business-os-currency` (the device pin). "Fresh profile" below means **remove those two keys on that origin**. Do not clear cookies.
- Every UI language switch (header menu or Settings) PATCHes `/api/business-os/preferences`. That writes **both** `user_preferences.preferred_language` **and** `business_profiles.language` and adds one audit row. **After every he/es test, switch back to English and confirm with S-0 that `preferredLanguage` is `"en"`.**
- The in-app browser has no throttling and no request blocking, so the runs are unthrottled. The sampler (S-2) records **every rendered frame**, so even a one-frame flash shows up.
- A completed owner is bounced off both onboarding routes (`/onboarding-build` → `/onboarding-chat` → `/business-os`). Their first frames are still sampled before the bounce. **Never use `/onboarding-chat?reset=true`**: it deletes the account's `onboarding_conversations` and starts a new LLM conversation.

**M-0 Setup**
1. Build the base `5e44871d` from a scratch `git archive` export (§7: shared `node_modules` junction, removed with `cmd /c rmdir`; **never** `git worktree remove --force`). Build the branch from `neuronforge-br1a`. Use the same local env file for both, delete the copies afterwards, and never commit them.
2. Run `next start -p 3001` (base) and `next start -p 3002` (branch).
3. Open `http://localhost:3001/test-icons.html` (a static public page; it mounts no provider) as the host page for all snippets. Use `:3002/test-icons.html` for the branch.
4. Run **S-0** on both origins. Expect `status 200` and `preferredLanguage: "en"`, and note `businessCurrency` and `timezone`. If the status is 401, the session is not shared: sign in on that origin.
5. Optional, read-only: run `select preferred_language, timezone from user_preferences where user_id = '<test owner id>';` and `select language, currency from business_profiles where user_id = '<test owner id>';` to record the starting values for the restore check.

**S-0: state probe** (run on the host page of either origin)
```javascript
(async () => {
  const r = await fetch(location.origin + '/api/business-os/preferences', { credentials: 'include', cache: 'no-store' });
  const j = await r.json().catch(() => null);
  return { origin: location.origin, status: r.status, data: j && j.data,
           lsLang: localStorage.getItem('business-os-language'), lsPin: localStorage.getItem('business-os-currency') };
})()
```

**S-1: set this origin's browser state** (edit the two values first; `null` removes the key)
```javascript
((lang, pin) => {
  lang === null ? localStorage.removeItem('business-os-language') : localStorage.setItem('business-os-language', lang);
  pin === null ? localStorage.removeItem('business-os-currency') : localStorage.setItem('business-os-currency', pin);
  return { lsLang: localStorage.getItem('business-os-language'), lsPin: localStorage.getItem('business-os-currency') };
})(null, null)
```

**S-2: first-frame sampler** (`requestAnimationFrame` on the host page; it loads the owner page cold in a same-origin iframe)

A new iframe document is a full document load, so `OwnerDirScript` executes exactly as on a cold load. The parent's `rAF` runs once per rendered frame, just before that frame paints, so each sample is what that frame showed. Only changes are logged. Results are kept on `window.__qaFrames`, so they can be read later if the tool does not await the promise.
```javascript
window.__qaFrames = null;
(async (path, ms = 12000) => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;inset:0;width:1280px;height:800px;border:0;background:#fff;z-index:99999';
  document.body.appendChild(f);
  const blank = f.contentDocument, frames = [], t0 = performance.now();
  let n = 0;
  const tick = () => {
    n++;
    const d = f.contentDocument;
    if (d && d !== blank && d.documentElement) {
      const w = d.querySelector('[data-owner-locale]');
      const root = w || d.body;
      const text = root ? (root.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70) : '';
      const s = { frame: n, t: Math.round(performance.now() - t0), path: d.location.pathname,
        html: d.documentElement.lang + '/' + d.documentElement.dir,
        wrap: w ? w.getAttribute('lang') + '/' + w.getAttribute('dir') : '-',
        hebrew: /[֐-׿]/.test(text), text };
      const p = frames[frames.length - 1];
      if (!p || p.path !== s.path || p.html !== s.html || p.wrap !== s.wrap || p.text !== s.text) frames.push(s);
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  f.src = path;
  await new Promise(r => setTimeout(r, ms + 300));
  const prefs = f.contentWindow.performance.getEntriesByType('resource')
    .filter(e => e.name.includes('/api/business-os/preferences')).length;
  window.__qaFrames = { path, frames, preferencesRequests: prefs };
  f.remove();
  return window.__qaFrames;
})('/business-os')
```
**How to read it.**
- A sample with empty `text` is a blank frame: `V2ThemeProvider` has not mounted yet. It is **not** an English frame, but record its `html` value.
- **`he` owner, fail:** any sample with non-empty `text` where `html` ≠ `he/rtl`, `wrap` ≠ `he/rtl`, or `hebrew` is false. Judge the UI chrome, not business or user names. Also report any **blank** sample with `html` ≠ `he/rtl` that comes after the first `he/rtl` sample.
- **`es` owner:** use `es/ltr`, and read the text for English UI strings.
- **Base** has no wrapper (`wrap: "-"`). Judge it on `html` and `text`.
- `preferencesRequests` is the count of GET + PATCH entries for the preferences URL from that load (used in M-6).

**M-1 Test owner in `he` and `es` (how to set and restore)**
- **Set:** on the origin under test, open `/business-os` → header language menu → עברית (or Español). Run S-0: `preferredLanguage` must be `he` (or `es`). The saved value is shared by both servers (same DB), so **set it once, then test base and branch back to back**.
- **Restore (mandatory after each language block):** header language menu → English. Run S-0 on both origins: `preferredLanguage` must be `"en"`. Run S-1 `(null, null)` on both origins. If M-0.5 was run, re-run those reads: `business_profiles.language` should be back to its starting value. If it was not `en` at the start, report it to the user rather than fixing it.

**M-2 AC-1.6, server HTML on all three routes** (S-3; run on each origin while the saved language is `he`, then `es`, then `en`)
```javascript
(async () => {
  const out = {};
  for (const p of ['/business-os', '/onboarding-build', '/onboarding-chat']) {
    const r = await fetch(location.origin + p, { credentials: 'include', cache: 'no-store', redirect: 'manual' });
    const b = r.type === 'opaqueredirect' ? '' : await r.text();
    out[p] = { status: r.status, redirected: r.type === 'opaqueredirect',
               script: (b.match(/document\.documentElement\.lang=[^<]*/) || [null])[0] };
  }
  return out;
})()
```
Expect on the **branch**: `status 200` on all three routes, with `script` = `document.documentElement.lang="he";document.documentElement.dir="rtl";`. For `es` it is `"es"`/`"ltr"`; for `en` it is `"en"`/`"ltr"`. Expect `script: null` on the **base**.

**M-3 AC-1.1 / AC-1.2 / AC-1.6, first frames**

For each language (`he`, then `es`) and each origin (base, then branch):
1. Run S-1 `(null, null)` (fresh profile).
2. Run S-2 on `/business-os` **5 times**, with S-1 `(null, null)` before each run.
3. Run S-2 once each on `/business-os/crm`, `/onboarding-build` and `/onboarding-chat`.

Expected results:
- **Branch:** 0 failing samples. The first non-blank sample is already `he/rtl` (or `es/ltr`) in both `html` and `wrap`.
- **Base:** at least one non-blank English/LTR sample per run. This is the baseline (T-0).

Rules:
- **Onboarding:** the samples end on `/business-os` after the bounce, so judge only the samples whose `path` is the onboarding route.
- **`/onboarding-chat`:** check only `html`, `wrap` and the provider's `t()` strings. **Ignore the chat body's own English** (M-2, by design).
- **`/onboarding-build`:** do not add `?lang=` (M-3).
- **Console:** watch it on every load. Neither build may show "Minified React error #418/#423/#425" (hydration).
- **Record** a table per run: run #, samples, failing samples, and the first non-blank `html`/`wrap`.

**M-4 AC-1.3** (saved `he`, this browser `en`)
1. With the saved language `he`, run S-1 `('en', null)` on the origin under test.
2. Run S-2 on `/business-os`.
3. Run S-0.

Expected:
- **Branch:** no English sample, and `lsLang` ends as `he`.
- **Base:** English samples first, then Hebrew. `lsLang` also ends as `he` (the same end state).

**M-5 Server-response guard** (SA-4 / C-14; same-origin `fetch`, so no cookie leaves the browser)

Run **S-4** on `:3001/test-icons.html` and `:3002/test-icons.html` alternately (A, B, A, B…), **11 times each**. The first call on each origin is the discarded warm-up. Each origin keeps its own list in its own localStorage, so one tab that navigates between the two host pages works.
```javascript
(async (path = '/business-os') => {
  const K = 'qa-br1a-times', t0 = performance.now();
  const r = await fetch(location.origin + path, { credentials: 'include', cache: 'no-store', redirect: 'manual' });
  const body = r.type === 'opaqueredirect' ? '' : await r.text();
  const ms = Math.round(performance.now() - t0);
  const row = { path, ms, valid: r.type !== 'opaqueredirect' && r.status === 200,
                hasOwnerScript: body.includes('document.documentElement.dir='), at: new Date().toISOString() };
  const all = JSON.parse(localStorage.getItem(K) || '[]'); all.push(row); localStorage.setItem(K, JSON.stringify(all));
  return { ...row, n: all.filter(x => x.path === path).length };
})('/business-os')
```
**S-5: median** (run on each origin)
```javascript
((path = '/business-os') => {
  const rows = JSON.parse(localStorage.getItem('qa-br1a-times') || '[]').filter(x => x.path === path);
  const bad = rows.filter(x => !x.valid).length;
  const v = rows.filter(x => x.valid).slice(1).map(x => x.ms).sort((a, b) => a - b);
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { path, invalid: bad, n: v.length, median: m, runs: v };
})('/business-os')
```
- **Validity:** every row must be `valid: true`. An invalid row is a redirect to sign-in (RC-6c, session expiry): sign in again and redo the block.
- **Right server per port:** `hasOwnerScript` must be `false` on base and `true` on branch.
- **Gate:** branch median ≤ base median + max(10% × base median, 30 ms).
- **If the gate fails,** do not loosen the threshold. Record the `findLocale` round trip and bring it to SA (RC-6b).
- **`/onboarding-build`:** repeat with `'/onboarding-build'` in S-4 and S-5. It is reported, not a gate.
- **Clean up:** run `localStorage.removeItem('qa-br1a-times')` on both origins.

**M-6 CRM checks (part d) and AC-1.4**

**(d-1) A header switch reaches CRM content** (saved language `en`). On each origin:
1. Open `/business-os/crm` in the top-level tab, not the iframe.
2. Header menu → עברית. Note whether the CRM page body (headings, column labels, buttons below the header) turns Hebrew/RTL **immediately**.
3. Switch back to English, then restore per M-1.

Expected:
- **Branch:** the CRM body flips at once, together with the header.
- **Base:** by code reading, the CRM body stays English until reload. Record what you actually see; this is the base confirmation the workplan asks for (§5.2, M-5).

**(d-2) One preferences PATCH in the "nothing saved" state, plus AC-1.4.**
- This needs `preferred_language` to be NULL. **No UI can set NULL:** the PATCH schema accepts only `en`/`es`/`he`.
- So it needs a DB write on the test owner's row, and **the user must authorise it first** (prod connector).
- Without that authorisation, mark (d-2) and the browser half of AC-1.4 as logic-level only (P-3, G-3).

If authorised, run these steps for each server, base first:
1. Run `update user_preferences set preferred_language = null where user_id = '<test owner id>';`
2. Run S-0. Expect `preferredLanguage: null`.
3. Run S-1 `('es', null)` on that origin.
4. Run S-2 on `/business-os/crm` and read `preferencesRequests`. Expected: **base 4** (2 GET + 2 PATCH, one pair per provider) and **branch 2** (1 GET + 1 PATCH). The samples must show English first, then Spanish.
5. Run S-0. Expect `preferredLanguage: "es"`, from the backfill.
6. **AC-1.4, branch only:** run S-2 on `/business-os` again. The first content frame must be `es/ltr`: the next cold load is right from the first frame.

Restore: switch to English in the header menu, check that S-0 shows `"en"`, then run S-1 `(null, null)` on both origins. If the request count is ambiguous, the PATCH count is also visible as language-change audit rows on the test account.

**M-7 AC-1.10 currency and timezone** (saved `he`; compare base and branch side by side)
1. Run S-1 `('es', null)` and open `/business-os`. Read the currency symbol on the dashboard money figures.
2. Open an invoice modal (Payments → new invoice, or the CRM contact drawer → Payments) and read its default currency. Both readings must equal base.
3. Repeat steps 1–2 with S-1 `('es', 'GBP')` (pin set), then with S-1 `(null, null)`.
4. Compare the times shown, such as a meeting time on the dashboard. They must equal base.

- **Logic-level only:** the two "no business currency" cases (C-5 EUR, C-6 USD) need `business_profiles.currency` to be unset, and the UI cannot unset it. They are covered by C-5/C-6, run with and without `initial`. The exception is a test account that already has no business currency (S-0 shows `businessCurrency: null`).
- **Restore** per M-1, then run S-1 `(null, null)`.

**M-8 AC-1.8 switching** (branch; base for comparison)
1. On `/business-os`, use the header menu: `en → he → es → en`. After each switch, run in the console: `[document.documentElement.lang, document.documentElement.dir, document.querySelector('[data-owner-locale]')?.getAttribute('lang'), document.querySelector('[data-owner-locale]')?.getAttribute('dir')]`. All four must agree with the chosen language, with no visible keys and no mixed frames.
2. Repeat from **Settings** (`/business-os/settings` → language).
3. After the `he` step, reload: the first frame must be Hebrew (S-2).

- **Onboarding-chat auto-switch:** logic-level only for an onboarded account (see "Facts" above). Do not use `?reset=true`.
- End on English, then restore per M-1.

**M-9 AC-1.7 English owner, side by side** (saved `en`, S-1 `(null, null)`)
- Compare base and branch at the same window size on `/business-os`, `/business-os/crm`, `/business-os/settings`, one Payments screen and `/onboarding-build` (before its bounce).
- Look for any layout difference from the `display: contents` wrapper (R-10): full-height panels, the sticky header, page scroll, modals and toasts.
- Check the console for hydration errors on both builds.

**M-10 AC-1.12 / AC-1.14**
- `/v2/settings` and one public `/site/<test business subdomain>` page open on the branch with no console error. Public `<html lang/dir>` follows the **business** language, as on base.
- **Signed-out redirect, with no sign-out needed.** Run this on both origins: `fetch(location.origin + '/business-os', { credentials: 'omit' }).then(r => ({ status: r.status, redirected: r.redirected, url: r.url }))`. Base and branch must give the same `url` (the sign-in page) and the same `status`.

**Final restore check (mandatory)**
1. Run S-0 on both origins: `preferredLanguage` must be `"en"`.
2. Run S-1 `(null, null)` on both origins.
3. Run `localStorage.removeItem('qa-br1a-times')` on both origins.
4. If you took the optional M-0.5 reads, re-run them.
5. Stop both servers and delete the env-file copies.
6. Remove the scratch base export's `node_modules` junction with `cmd /c rmdir` before you delete the export.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Automated part: PASS.** No bugs. 3 low edge cases (G-6 regex narrow, `act()` noise, stale count).
- **Not yet ready for commit.** The main session still owes, per §QA.6:
  - the browser half of AC-1.1, AC-1.2, AC-1.3, AC-1.6, AC-1.7, AC-1.8, AC-1.10, AC-1.12 and AC-1.14;
  - the server-response guard (M-5).
- AC-1.4 (browser) and the CRM check (d-2) also need the user's authorisation for one DB write.
- The browser half of AC-1.5(b) and the onboarding-chat auto-switch can only be checked at logic level.

---

## Commit Info

*RM to populate. Nothing is committed before SA code review, QA and the user's view of the diff. The requirement file in this worktree is a reference copy and is not part of this branch's commit.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | SA ruling: server guard re-measured, passes | After RC-6b: set 1 Δ +55.5 ms, set 2 Δ −22.5 ms, pooled 20 pairs Δ −5 ms (base 244.5, branch 239.5). The verdict pools every pair and drops none. Lower quartiles are level, so no serial hop remains. Protocol amended for the remaining BR measurements: 20 interleaved pairs, fixed in advance, threshold unchanged. Heavier branch tail recorded, with a post-deploy p75/p90 check owed (not gating). `/onboarding-build` figure still owed (reported only). Code approval restored |
| 2026-10-14 | SA ruling: server guard failed (RC-6b) | Measured +157 ms (+62%) against a 30 ms allowance. The cause is one extra serial Supabase round trip. Ruling (b): start `readInitialLanguage()` before `redirectIfAwaitingPayment()` in all three layouts and await it only after the gate. The paymentHold R-2 first-statement guard is narrowly amended, and G-2 is rewritten. Per-user cache, query folding and preview-only measurement are rejected. Threshold unchanged. Code approval suspended until the guard is re-measured |
| 2026-10-14 | RC-6b design change (SA ruling on the failed server-response guard) | The language read is started before the payment hold in all three layouts and awaited after it. `paymentHold.test.ts` first-statement guard narrowed to allow only that start. G-2 rewritten (i)–(v), G-6 broadened, act() warnings removed (O-1), test count corrected to 69 (79 after G-2). Probes M-a..M-d all caught. Suites re-run green; branch rebuilt for re-measurement |
| 2026-10-14 | SA review applied, implemented | RC-1 (first-content-frame wording, P-7 re-scoped to a first-client-mount probe, P-8 defensive only, AC-1.6 amended), RC-2 (G-1 script position) and RC-3 (P-4b) folded into §2.4, §5.3, §8 and R-1. Implemented with RC-4, RC-5 and RC-6. Implementation Notes added: tests, mutation probes, branch build. The server-response baseline and the browser checks are owed by the main session |
| 2026-10-14 | Created | Dev workplan for BR-1a on `5e44871d`: P-1 helper, P-2 owner script, provider `initial` prop with state-driven wrapper, CRM nested provider removed. FR/AC mapping, §6 answer, metrics, test plan, risks, six requirement-vs-code mismatches and four SA questions |
| 2026-10-14 | SA review | APPROVED WITH CHANGES. Finding: `V2ThemeProvider` renders `null` until mount, so the provider is never server-rendered or hydrated. The wrapper is re-scoped to the first client frame (RC-1) and the script position is pinned outside it (RC-2). P-4b is added for R-5 (RC-3), plus RC-4 to RC-6. Q-1 to Q-4 and M-1 to M-6 ruled. The master requirement was amended (FR-1.2, FR-1.4, AC-1.5(b), AC-1.6, §3.7, §3.10, §8, §0) |

### Manual browser checks: main session, 2026-10-14

Production builds: base `5e44871d` (localhost:3011) and this branch (localhost:3012), both signed in to the user's test owner account, which starts with saved language `en`. The language was switched only through the header menu, and the account was restored to `en` at the end; the server preference was confirmed as `en`, and both ports' `business-os-language` and `business-os-currency` keys were cleared.

| Check | Result |
|---|---|
| First frames, saved `he`, this browser's stored language `en` (AC-1.3 / zero English frames), same-origin iframe sampler on `/business-os` | **Base:** the first content frame is `en/ltr` English ("English My day Business Setup…") and stays **English for ~4.3 s** before flipping to `he/rtl`. **Branch (before and after the RC-6b change):** `<html>` is `he/rtl` before any content, and the first content frame is `he/rtl`, wrapper `rtl`, Hebrew text. **No English or LTR content frame** ✅ |
| CRM, header switch he → en on the branch (C-1 / M-5) | ✅ CRM content changed to "Contacts list" at once, without a reload |
| Server-response guard (M-5 / SA-4) | First measurement +157 ms ❌ → SA ruling (b) applied (start the read before the hold) → re-measured with 20 interleaved pairs: base median 244.5 ms, branch 239.5 ms, Δ −5 ms ✅. SA restored approval. The protocol is now 20 pooled pairs. Post-deploy p75/p90 check owed (SA) |
| Not run | Spanish first frame (covered by the script test), `/onboarding-build` timing (report-only), side-by-side `display:contents` visual sweep, AC-1.4 "nothing saved" (needs a DB write) |

**QA final status:** ✅ Ready for the user to see the diff.
