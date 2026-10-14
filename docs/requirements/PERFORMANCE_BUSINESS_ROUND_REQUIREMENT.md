# Requirement: Performance Business Round (BR-1, BR-2, BR-3)

> **Last Updated**: 2026-10-14

**Created by:** BA
**Date:** 2026-10-13
**Status:** Approved: ready for workplans (SA §12.3 changes applied, user answered §9 on 2026-10-14). BR-1b's workplan is still gated on the SA-3 spike

## Overview

Round 1 of the performance stream changed nothing users could see except speed. The product owner has now opened the **business round** and picked three items that do change what users see. Each one is a small numbered slice. **BR-1:** owners see their own language and reading direction from the very first frame, and each owner page loads only that one language. **BR-2:** the public website contact form loads its phone-number component on demand. **BR-3:** owners see honest progress while a website image is generated, instead of a bare spinner for about a minute. The baseline numbers, ranking and filter rules come from the stream's master scoping document, `PERFORMANCE_IMPROVEMENT_SCOPING.md`. That document stays local and is referenced here by name only. This requirement cites only bundle sizes, timings and code locations.

---

## Table of Contents

- [§0 Status and Decisions Log](#0-status-and-decisions-log)
- [§1 Summary of the Three Slices](#1-summary-of-the-three-slices)
- [§2 Rules Carried Over from the Scoping Document](#2-rules-carried-over-from-the-scoping-document)
- [§3 BR-1: The Owner's Language from the First Frame](#3-br-1-the-owners-language-from-the-first-frame)
- [§4 BR-2: Phone Field on Demand in the Public Contact Form](#4-br-2-phone-field-on-demand-in-the-public-contact-form)
- [§5 BR-3: Honest Progress While a Website Image Is Generated](#5-br-3-honest-progress-while-a-website-image-is-generated)
- [§6 Non-Functional Requirements (all slices)](#6-non-functional-requirements-all-slices)
- [§7 Recommended Slice Order](#7-recommended-slice-order)
- [§8 Out of Scope / Future Roadmap](#8-out-of-scope--future-roadmap)
- [§9 Open Business Questions for the User](#9-open-business-questions-for-the-user)
- [§10 Technical Questions for SA](#10-technical-questions-for-sa)
- [§11 Notes on Integration Points](#11-notes-on-integration-points)
- [§12 SA Review](#12-sa-review)
- [Change History](#change-history)

---

## §0 Status and Decisions Log

Newest entries at the bottom. Every stage of these slices adds a row: user answers, SA review, workplans, PRs, merges, measurements, deferrals.

| Date | Stage | Entry | By |
|---|---|---|---|
| 2026-10-13 | Business round: user decision | The user opened the business round. **Pursue:** BIZ-8 → **BR-1** (owner's language before first render), BIZ-7 → **BR-2** (phone library on demand in the public contact-form block), BIZ-1 → **BR-3** (**progressive-preview option only**; model, quality, size and format changes stay parked). Everything else on the parked list stays parked. These slices change behaviour, so each takes the **full cycle**: BA requirement → SA → Dev workplan → SA → Dev → SA code review → QA → user sees the diff → RM | User |
| 2026-10-13 | BA requirement drafted | This document. Findings from reading the code: (1) The three dictionaries are now separate modules (`lib/business-os/translations/en`, `es`, `he`), but `LanguageContext.tsx:21-23` still imports all three statically, so every owner page still downloads all three. (2) The provider is mounted by three server layouts (`app/business-os/layout.tsx`, `app/onboarding-build/layout.tsx`, `app/onboarding-chat/layout.tsx`). The business-os layout already reads the session on the server for every request (`force-dynamic`), and public pages have their own pre-paint language mechanism (`PublicDirScript`) that does **not** use this provider. (3) The contact-form block reaches the phone library through **four** paths, not one (§4.2). (4) The image picker shows only a spinner and the word "working" for about a minute. (5) True partial image previews are **not** cost-neutral, so BR-3 asks for honest progress (§5.3). **Next:** the user answers §9, SA reviews §10 | BA |
| 2026-10-13 | SA review | **APPROVED WITH CHANGES** (§12), code read on `origin/main` @ `ffb598ac`. **BR-1:** server-resolved first language from `user_preferences.preferred_language` in the existing layouts (no cookie), an owner-side pre-paint `lang`/`dir` script (a sibling of `PublicDirScript`, which cannot be reused as-is), and removal of the nested `LanguageProvider` in `app/business-os/crm/layout.tsx`. BR-1b delivers the dictionary as a server-chosen per-language client chunk. That needs a Dev spike before its workplan; delivering it in the page payload is rejected. **BR-2:** the PERF-2 loader fits, with three changes (§12.2 SA-7). **BR-3:** the server finishes the picture if the picker or tab closes, so §9 BQ-8 can be offered. 14 required changes for the BA (§12.3). The slice order BR-2 → BR-3 → BR-1a → BR-1b is confirmed. BR-2 and BR-3 may go to workplan once §12.3 is applied. BR-1a may go to workplan after that too. BR-1b waits for the spike | SA |
| 2026-10-14 | User answers + SA changes applied | The user answered "defaults, go ahead" to every business question in its SA-revised form: BQ-1 to BQ-8 accepted, plus the new **BQ-9** (closing the picker also cancels the automatic placement into the slot; the server still finishes and saves the picture). All 14 SA changes C-1 to C-14 (§12.3) applied in the sections they target. New FR-3.10 / AC-3.11 for BQ-9. The double-charge race (the same description generated again while the first is still running) logged as a separate fix item in §8; BR-3 only warns about it. **Status: Approved, ready for workplans.** BR-2, BR-3 and BR-1a may go to workplan; BR-1b still waits for the SA-3 spike | BA |
| 2026-10-14 | BR-3 workplan: SA review | **APPROVED WITH CHANGES** (R-1 to R-7, in the BR-3 workplan). **R-7 applied here:** the picker is reachable only from the five website-editor slots, so AC-3.9 and AC-3.11 are checked there, and the dialog, wizard and testimonial hosts are N/A on main. **SF-1 in scope for BR-3:** the "depicts people" refusal currently shows a raw translation key; the fix renames `media.generate.no_people` to `media.generate.depicts_people` in en/es/he. BR-3 implementation started | SA / main session |
| 2026-10-14 | BR-3 code + QA | SA code review: **APPROVED**, no changes. QA automated: 22/22 new plus 315 related tests pass, and mutation probes are caught. **Browser, on a production build:** every check passes, including **one real charged generation** (user-approved): picker closed after 5 s, slot unchanged, picture in the library, exactly 1 usage row ($0.25), 1 charge and 1 audit row. Panel-to-screen median ≈ 0.9 s in the in-app browser (DOM in ≈ 11 ms). **Side finding:** `/business-os/website` is 396 px wide on a 360 px screen, so in Hebrew RTL the page and dialogs are cut about 20–36 px on the left. This is pre-existing and not BR-3. BR-3 is ready for the user to see the diff | QA / main session |
| 2026-10-14 | BR-2 code + QA | SA code review: **APPROVED**, no changes. QA automated: 65/65 new and extended plus 562/563 related tests pass (the failure is the known Windows CRLF guard), and mutation probes are caught except an untested "never steal focus" branch (Low; a test was suggested). The manual browser checklist (M-1 to M-8, which includes one real form submission plus cleanup) is still to do | QA / SA |
| 2026-10-14 | BR-2 browser checks | The user chose **no real form submission**: every send went through a fetch trap, and nothing was stored or emailed. Production build: four gated routes at 239/239/140/140 kB (from 286/286/184/184). Placeholder-to-real swap identical to the pixel, with no layout shift. The label and focus hand off correctly. Send before arrival shows today's "required" message and sends nothing. A blocked library shows "please try again", sends nothing, and recovers on the next keystroke. The trapped post carries the same phone value as on main. The missing never-steal-focus test was added (31/31, proven by probe). Not run: Hebrew/dark template, iOS keyboard, Fast 3G timing. **BR-2 is ready for the user to see the diff** | main session |
| 2026-10-14 | BR-2 workplan: SA review | **APPROVED WITH CHANGES** (RC-1 to RC-7, in the BR-2 workplan; code read at `d769b9e3`). Design approved as planned: extended `phoneLib.ts` barrel, library-free `publicFormCountry.ts` with a test-pinned calling-code lookup, a focusable public placeholder, submit that waits while loading, CSS kept static. The +~4 kB browser logger on the two contact routes is accepted (net still ≈ −42 kB). **Amendment applied here (O-5):** `/business-os/website` does not render the block and has no phone library in First Load at base, so SA-9 / C-10 were wrong. FR-2.8, AC-2.1 and the §4.6 metric now say "measured, reported, no gate" for that route. The gate is the four public routes (O-6). **AC-2.6 note:** the phone is always empty before the field arrives, so Send-before-arrival ends in today's "required" message with nothing sent | SA |

---

## §1 Summary of the Three Slices

| Slice | Source | Who notices | What changes | Success metric | Baseline |
|---|---|---|---|---|---|
| **BR-1** | BIZ-8 (PC-5) | Business owners, mainly Hebrew and Spanish | Hebrew and Spanish owners stop seeing an English, left-to-right flash before their language appears. Every owner page downloads one language instead of three | Zero English or LTR frames for he/es owners. Dictionary bytes per cold owner page load | Dictionary chunk 159.5 kB gz on every owner page (R22). Expected: two of the three dictionaries no longer downloaded per cold load, per-language figures in §3.7 (`he` is about 10% larger than `en`/`es`) |
| **BR-2** | BIZ-7 | Clients (visitors) on business websites | The phone field in the contact form may appear a moment after the rest of the form, in a same-size placeholder | First Load JS on public site and contact pages | `/site/[subdomain]` and `/[slug]` 285 kB, contact pages 231 kB First Load (R22). Expected ≈ −50 kB gz |
| **BR-3** | BIZ-1, progressive option only | Business owners building their website | While a picture is generated, the owner sees a placeholder in the picture's shape, how long it usually takes, and how long it has been running | Time to the first useful feedback after pressing Generate | Today the only feedback is a spinner, until the finished picture arrives at p50 53.4 s / p95 58.1 s (R13). Target ≤ 1 s |

---

## §2 Rules Carried Over from the Scoping Document

These apply to every slice here. They are summarised from the scoping document (§6, §8, §9 there).

**§6 filter.** Round 1 took only items where all five questions came out "No": (1) Output, (2) Money, (3) Timing users rely on, (4) Scope, (5) Failures and records. Business-round items fail at least one question, and the user has accepted that by picking them. Each slice below records which questions it fails, why, and why the user accepted it. **Any question not listed as failing must still be answered "No" in the slice's workplan.**

**Definition of done per slice** (adapted from scoping §8):
1. The §6 answers in this document are restated in the workplan, and SA confirms them.
2. **Same-output proof** for everything the slice does *not* mean to change: stored values, records, charges and copy.
3. Before/after numbers from the same source and method as the baseline, beating the noise threshold. For bundle size: down ≥ 5% or ≥ 10 kB on the affected route, whichever is smaller (deterministic `next build`). **No measured gain, no merge**, unless the user keeps the slice for its visible benefit alone. Two slices take that exception: **BR-1a** (§3.9) and **BR-3** (§5.7). BR-3's ≤ 1 s metric is an acceptance check, not a speed gain, and it is recorded in the scoping document §11.3 as "no speed change, kept for visible benefit" (SA C-12).
4. Full cycle complete. The user sees the diff before any commit.
5. This requirement and the scoping document are both updated (§0 row, plus the result).

**Guardrails** (scoping §9): small slices that reuse existing infrastructure, and anything new goes to SA first (CLAUDE.md rule 7). No added CI time. Nothing committed before the user sees the diff. Repository pattern and `user_id` scoping. BOS LLM call standards on any LLM path. Pino logging with no PII. **Currency and timezone rules do not move** (CLAUDE.md "Currency & Timezone").

---

## §3 BR-1: The Owner's Language from the First Frame

### §3.1 User stories

- As a **Hebrew-speaking business owner**, I want Business OS to appear in Hebrew, right to left, from the first moment it is drawn, so that I never see a flash of English laid out the wrong way.
- As a **Spanish-speaking owner opening Business OS on a new phone**, I want my saved language used immediately, so that I do not watch the page change language after it loads.
- As an **English-speaking owner**, I want owner pages to download only the English text, so that they load faster, especially on mobile.
- As the **product owner**, I want the currency and the business clock to behave exactly as they do today, so that this change cannot affect money or times.

### §3.2 How it works today (verified in code)

| Step | Where | What happens |
|---|---|---|
| 1 | `app/business-os/layout.tsx:69` (also `app/onboarding-build/layout.tsx:25`, `app/onboarding-chat/layout.tsx:24`) | A server layout mounts the client `LanguageProvider`. The root layout renders `<html lang="en" dir="ltr">` (`app/layout.tsx:55`) |
| 2 | `lib/business-os/LanguageContext.tsx:181` | The provider starts as `useState<Language>('en')`, so the server render and the first paint are **English for everyone** |
| 3 | `:205-219` (after mount) | It reads `business-os-language` from this browser's localStorage and switches to `he`/`es` if found. This is the first visible language change |
| 4 | `:225-272` | It checks the session, then calls `GET /api/business-os/preferences`, which returns `user_preferences.preferred_language` and `timezone` plus `business_profiles.currency` (`app/api/business-os/preferences/route.ts:59-103`). A valid saved language wins and is copied into localStorage. This can be a **second** visible change |
| 5 | `:273-282` | If nothing is saved but this browser has a pick, that pick is written back to the server (the backfill). A failed read does not trigger the backfill |
| 6 | `:294-298` | `document.documentElement.dir`/`lang` are set only after the language state changes, so the page is **LTR until then** |
| 7 | `:21-23`, `:127` | All three dictionaries are imported statically and composed into `translations`, so every owner page downloads `en`, `es` and `he`. `t()` (`:420-428`) has **no English fallback**: a missing key shows the key itself, so only the active dictionary is ever read |

**Result:** a Hebrew or Spanish owner on a new device, or after clearing site data, sees English LTR until step 4 finishes. With localStorage set, they still see English LTR until step 3, which runs after hydration. Both are visible flashes.

**Server-side language is a separate path.** Emails and insights resolve the language through `lib/business-os/userLanguage.ts`, which prefers `business_profiles.language` over `user_preferences.preferred_language`. The settings picker writes both columns together (`preferences/route.ts:140-147`). BR-1 does not touch the server-side path (§3.8).

### §3.3 What changes, for whom

| Who | Today | After BR-1 |
|---|---|---|
| Hebrew owner, any device | English LTR flash, then Hebrew RTL | Hebrew RTL from the first frame |
| Spanish owner, any device | English flash, then Spanish | Spanish from the first frame |
| English owner | English | English. The page no longer downloads the Spanish and Hebrew dictionaries (BR-1b) |
| Any owner switching language (Settings, the header menu, or the onboarding-chat auto-switch) | Switch is instant | The page keeps the current language until the new one has loaded (up to about 1 s), then changes all at once (§9 BQ-3, answered) |
| Owner with no saved language | English (or this browser's last pick, after a flash) | Per §9 BQ-2 (answered 2026-10-14): the same answer as today. If this browser has a pick, the very first load shows English once, then the pick after mount; the pick is then saved, so later loads are right from the first frame. No cookie is added |
| Clients on public pages | Unchanged (separate mechanism) | Unchanged |

### §3.4 Business rule: which language is drawn first

The first frame must show the language the page **settles on today**, so the only change is that the flash goes away. In order:

1. **The owner's saved language**, if it is a supported value (`en`, `es`, `he`). This decides even when this browser last showed something else. Today the saved value wins once it arrives, so the final result is the same.
2. If nothing is saved, **this browser's last pick**, as today. This rule applies **after mount, not at the first frame** (SA-1, C-2): the server cannot see this browser's pick without a cookie, and no cookie is added. In this rare state the first frame is English, then the page switches once, as today. The backfill then saves the pick, so the next cold load is correct from the first frame.
3. Otherwise **English**, as today.

The browser's own language setting is **not** used (§9 BQ-1 and BQ-2, answered 2026-10-14). The backfill rule (step 5 in §3.2) is unchanged.

### §3.5 Functional requirements

| # | Requirement |
|---|---|
| FR-1.1 | For every surface that mounts `LanguageProvider` (the three layouts in §3.2; SA confirmed no other page mounts it), the language is chosen **before the first render** using the rule in §3.4, and the server render uses it. The language is resolved on the server by a `server-only` helper (§12.1 P-1). The **nested** provider in `app/business-os/crm/layout.tsx:14` is **removed** in BR-1a (its CSS import stays), because a client layout cannot receive the server language and it also makes a duplicate preferences request (SA-1, C-1) |
| FR-1.2 | The document's `lang` and `dir` are correct **before first paint**, not after mount. This uses an owner-side pre-paint script that is a **sibling** of `PublicDirScript`, not a reuse of it (§12.1 P-2). The layout wrapper also carries `dir`/`lang` in the server HTML |
| FR-1.3 | Each owner page downloads **only the active language's dictionary** on a cold load. A different dictionary is downloaded only when the owner switches language |
| FR-1.4 | **Switching language:** the page keeps showing the current language until the new dictionary has arrived (up to about 1 s, §9 BQ-3), then changes completely. No frame mixes two languages, and no frame shows translation keys. This applies to **every** `setLanguage` caller: the header menu (`components/business-os/BusinessOSHeader.tsx:183-197`), Settings (`app/business-os/settings/page.tsx:868`) and the onboarding-chat auto-switch (`app/onboarding-chat/page.tsx:473-479`) (C-6) |
| FR-1.5 | **Switching language, failure:** if the new dictionary cannot be loaded, the page stays in the current language and shows a short message in that language, with a way to try again. The new language is **not saved** until it can be shown. This is a small change from today, where the save is immediate (see §3.7, Q5). The retry message has a defined home for **each** caller in FR-1.4 (header menu, Settings, onboarding-chat auto-switch); the workplan names it per caller (C-6) |
| FR-1.6 | Saving a language is otherwise unchanged: the same route, both columns written together, the same audit event |
| FR-1.7 | **Currency and timezone resolution does not change.** The display currency still follows this device's pin, then the business currency, then the language default. `businessCurrency` stays undefined until loaded. The timezone stays `UTC` until the preferences row arrives. Both are still read through `/api/business-os/preferences`. Delivering them earlier is **out of scope** (§8) |
| FR-1.8 | `useOptionalLanguage` and `useBusinessTimezone` keep their behaviour outside the provider (`/v2/**` and public pages) |
| FR-1.9 | No production module may import all three dictionaries at once. Tests may (the `translations` export at `:127` is used by tests and the cancellation-label pairing test). A guard enforces this (§10 SA-5) |

### §3.6 Acceptance criteria (QA)

Run on a production build (`next build && next start`). Use Fast 3G with cache disabled where stated, plus a DevTools performance filmstrip or screen recording.

- [ ] **AC-1.1** Signed-in owner with saved language **Hebrew**, fresh browser profile (no site data), cold load of `/business-os` under Fast 3G: every frame from first paint shows Hebrew text and RTL layout. Zero English frames and zero LTR frames in the filmstrip.
- [ ] **AC-1.2** Same as AC-1.1 for **Spanish** (LTR).
- [ ] **AC-1.3** Same as AC-1.1 with this browser's localStorage set to `en` while the saved language is `he`: the first frame is Hebrew, and localStorage ends as `he`, matching today's end state.
- [ ] **AC-1.4** Owner with **no saved language** and localStorage `es` (§9 BQ-2, C-2): the first frame is English, then Spanish after mount. The backfill writes `es` once, as today. **The next** cold load is Spanish from the first frame.
- [ ] **AC-1.5** Preferences read fails, in two parts (C-3). No error shown to the owner in either (as today).
  - **(a) Server-side read fails:** a unit test of the server helper shows it returns `source: 'unknown'` and English, and does not throw.
  - **(b) Client `GET /api/business-os/preferences` returns 500** (simulated): no backfill write, and the localStorage pick applies after mount (DevTools).
- [ ] **AC-1.6** On `/business-os`, `/onboarding-build` and `/onboarding-chat` (C-4): with JavaScript disabled, the layout **wrapper's** `dir`/`lang` are correct in the server HTML. `document.documentElement.lang`/`dir` are set by the pre-paint script and are checked with the filmstrip or the DOM at first paint.
- [ ] **AC-1.7** English owner: owner pages look identical to main.
- [ ] **AC-1.8** Switching `en → he → es → en` from **each** caller (Settings, the header menu, and the onboarding-chat auto-switch; C-6): each switch completes with no mixed-language frame and no visible keys. Under unthrottled conditions each switch appears complete within 1 s. Both language columns and one audit entry are written per switch, as today.
- [ ] **AC-1.9** Switching while the new dictionary is blocked (DevTools request blocking), from **each** caller in AC-1.8: the page stays in the current language, shows the retry message in that caller's defined home, and **no** save request is sent. Unblock and retry: the switch completes and is saved.
- [ ] **AC-1.10** **Currency and timezone same-output check.** For four owners (business currency set or unset × device pin set or unset), the currency symbol shown on the dashboard, an invoice modal's default currency and the displayed times are identical to main, including the brief `UTC` window before the preferences row arrives. Two further cases (SA-6, C-5), both identical to main:
  - saved `he`, localStorage `es`, no pin, no business currency → default display currency **EUR**;
  - saved `he`, no localStorage → **USD**.
  
  The default display currency is still derived from the localStorage language, never from the new server-supplied initial language.
- [ ] **AC-1.11** Network tab on a cold load: exactly **one** dictionary is downloaded for `en`, `es` and `he` owners respectively.
- [ ] **AC-1.12** `/v2/settings` and a public `/site/[subdomain]` page are unchanged. No missing-provider error.
- [ ] **AC-1.13** The language of emails and insights is unchanged (server-side resolution untouched; covered by existing tests).
- [ ] **AC-1.14** A signed-out visit to `/business-os` redirects exactly as today.

### §3.7 Success metric and §6 filter

**Metrics**

| Metric | Source and method | Baseline | Target |
|---|---|---|---|
| English or LTR frames before the owner's language (he/es) | QA filmstrip, Fast 3G, cache off, 5 runs per language | At least one, on every cold load | **0** in every run |
| **BR-1b gate:** dictionary bytes transferred per cold owner page load, per language | DevTools transfer size for the dictionary chunks, 1 run per language (deterministic) | All three dictionaries, about 159.5 kB gz (R22 chunk, re-measure at the slice's base commit, because the dictionaries have since been split into modules) | Down ≥ 10 kB **and** exactly one dictionary chunk, for each of `en`, `es` and `he` (C-7). Expected per language: the other two dictionaries' gz size no longer transferred. Raw sizes are `en` 257,602, `es` 252,809, `he` 282,963 bytes, so `he` is about 10% larger and its own load saves less than `en`/`es` (the workplan records the gz figure per language at the base commit) |
| First Load JS per owner route (**informative only**, not a gate) | `next build` route table at the same base commit (R22 method) | Post-PERF-2: `/business-os` 473, `/business-os/crm` 513, `/scheduling` 404, `/business-os/orders` 393, `/business-os/settings` 387, `/payments` 381, `/business-os/website` 531, `/onboarding-build` 450 kB | Reported, not gated (C-7). Depending on the SA-3 outcome the route table can count client references that are never rendered, or drop all three dictionaries and overstate the gain by one dictionary. The dictionary-bytes gate above is the one that counts. The dictionary may not move into the page payload (rejected, SA-3) |
| Owner page server response time (guard) | Median HTML document response time over **10 interleaved** before/after runs (same host, same network, production build) | Measured at the base commit | No worse than **max(10%, 30 ms)** (SA-4, C-14) |

**§6 filter**

| Q | Answer | Why, and why the user accepted it |
|---|---|---|
| Q1 Output | **Yes** | The first frame now shows the owner's language instead of English. That is the purpose of the slice, accepted by the user at the business-round decision. The settled language is unchanged (AC-1.3, AC-1.4) |
| Q2 Money | No | Currency resolution is untouched (FR-1.7, AC-1.10) |
| Q3 Timing | No | No schedule or freshness change. The timezone window is untouched |
| Q4 Scope | No | No feature is removed. A language switch can now take up to about 1 s (FR-1.4), from any caller. Accepted by the user under §9 BQ-3 (2026-10-14) |
| Q5 Failures and records | **Yes (small)** | A new failure case: a switch whose dictionary cannot load stays in the current language and saves nothing (FR-1.5). Accepted, because saving a language the device cannot show would leave the owner on a broken page. Audit records are unchanged |

### §3.8 Risks

| Risk | Mitigation |
|---|---|
| A new pattern on shared infrastructure: the provider every owner page uses, and the one that carries the currency and clock authority | SA designs the mechanism before the workplan (§10). FR-1.7 and AC-1.10 pin currency and timezone |
| Hydration mismatch if the server and the client choose different languages | One source of the initial language, passed from server to client. QA watches the console for hydration warnings on every AC run |
| An extra server read on every full owner page load | Run it after `redirectIfAwaitingPayment()` and in parallel with `readPlanBadge()` (SA-4). Guard metric in §3.7: no worse than max(10%, 30 ms) |
| Two stored language columns can disagree (`user_preferences` vs `business_profiles`) | BR-1 reads the same column the provider settles on today, so the result does not change. Aligning the two is out of scope (§10 SA-2) |
| A language value reaching the page's `<head>` script | No cookie is introduced (SA-1), so the value is server-resolved, never client-supplied. It is still restricted to the closed enum `en`/`es`/`he` and serialised with `JSON.stringify` (P-2) |
| The nested CRM provider keeps the flash on every CRM page | It is removed in BR-1a (FR-1.1, C-1) |
| Language switching is slower on a poor connection | FR-1.4: the current language stays until the new one is ready. §9 BQ-3 |
| Any production import of `translations` pulls all three dictionaries back in | Guard test (FR-1.9) |

### §3.9 Suggested split

BR-1 is the largest slice. It may ship as two PRs under one requirement:
- **BR-1a: right language and direction at first paint** (P-1 server helper, P-2 pre-paint script, removal of the nested CRM provider, C-1 to C-6 and C-14). All three dictionaries still load. The gain is visual (AC-1.1 to AC-1.6, AC-1.10). It has no bundle gain, so the user keeps it for its visible benefit (§2, done rule 3).
- **BR-1b: load only the active dictionary**, plus the switch behaviour (FR-1.3 to FR-1.5, FR-1.9). The gain is in bytes.

SA confirmed the split (SA-3). BR-1a ships first, because BR-1b relies on the server choosing the language. BR-1b's workplan waits for the SA-3 spike result to be recorded here.

### §3.10 Out of scope (BR-1)

- Public and client pages (`/site`, `/book`, `/c`, `/invoice`, `/proposal` and others). They do not use this provider and already set language and direction before paint through `PublicDirScript`.
- `/v2/**` and admin pages (no provider).
- Delivering the timezone or currency at first render (§8).
- Detecting the browser's language (§9 BQ-1/BQ-2 default; §8).
- Changing which column server-side features (emails, insights) trust.
- Adding a language, or changing translation text.

---

## §4 BR-2: Phone Field on Demand in the Public Contact Form

### §4.1 User stories

- As a **visitor on a business's website**, I want the page to load quickly on my phone, so that I get in touch instead of leaving.
- As a **visitor**, I want the contact form to stay where it is while it loads, so that nothing jumps under my finger.
- As a **business owner**, I want every lead captured exactly as today: the same phone format, validation and country default, so that my CRM data stays clean.

### §4.2 How it works today (verified in code)

`components/website/blocks/ContactFormBlock.tsx` always renders a **required** phone field. If the configured fields lack one, the block adds it (`:159-167`). The field is visible at first paint. The phone library reaches the block through **four** paths, and all four must go on demand for the library to leave the page:

| Path | Where | Used for |
|---|---|---|
| `PhoneInput` component plus `react-phone-number-input/style.css` | `ContactFormBlock.tsx:6`, `:8`, `:424-437` | The number input |
| `isValidPhoneNumber` | `:7`, `:198` | Validation on submit |
| `applyCountryToPhone`, `phoneFieldValue`, `publicFormCountry` | `components/crm/phoneField.ts:39-44` (imports the library at module level), used at `:178`, `:416`, `:429` | Initial country from the page language, and applying a country change to the number |
| `WebsiteCountrySelect` (`getCountries`, `getCountryCallingCode`, the English country-name list) | `components/website/blocks/WebsiteCountrySelect.tsx:4-5` | The custom country dropdown |

The merged PERF-2 loader `components/crm/usePhoneLib.ts` (PR #344, approved by SA as phone-specific) is the starting point for reuse. It is on `origin/main` but not in the checkout this requirement was read from. SA confirms whether it covers the public block (§10 SA-7).

### §4.3 What changes, for whom

| Who | Today | After BR-2 |
|---|---|---|
| Visitor on a site with a contact form | The page downloads the phone library before anything appears | The page appears about 50 kB gz lighter. The library is fetched right after the page appears, without waiting for a click |
| Visitor who reaches the form quickly on a slow connection | Real phone field | For a moment, a **same-size placeholder** (country box plus number box, in the site's colours, with the localised label), then the real field in the same spot |
| Business owner | Leads stored as validated international numbers | **Unchanged**: same stored format, same validation, same default country (IL for Hebrew pages, ES for Spanish, US for English) |

### §4.4 Functional requirements

| # | Requirement |
|---|---|
| FR-2.1 | All four JavaScript paths in §4.2 load on demand in the public contact-form block. **The library CSS stays a static import** (the PERF-2 decision; it costs no First Load JS, and lazy CSS would cause an unstyled frame) (SA-7, SA-8, C-8). Reuse the PERF-2 loader, which SA confirmed fits, with the three changes in §12.2 SA-7 (extend the existing `phoneLib.ts` barrel, move `publicFormCountry` into a library-free module, add a public placeholder variant) |
| FR-2.2 | The download starts **when the page has painted**, with no interaction needed (the same rule the BA set for PC-3: preload at paint, not at the step before) |
| FR-2.3 | Until the library arrives, the phone row shows a **placeholder of exactly the same size and position** as the real row, in the template's colours (dark templates included), with the localised label and the required asterisk. It stays LTR inside RTL pages, as today. **The PERF-2 `PhoneFieldPlaceholder` is not reused as-is**: it is `disabled`, `aria-hidden` and `tabIndex={-1}`, which fails the label association here and FR-2.4. A **public variant** is required: focusable (read-only), the target of the field label's `htmlFor`, with a country-box stub of the same size (SA-7 item 3, C-9) |
| FR-2.4 | Tapping or focusing the placeholder before the library arrives does not lose the tap. Focus moves into the real number box when it appears. This is provided by the public placeholder variant in FR-2.3, not by the PERF-2 placeholder (C-9) |
| FR-2.5 | Submitting before the library arrives waits for it (the button shows its normal "sending" state), then validates exactly as today. An unvalidated phone is never sent, and "invalid phone" is never shown just because the library has not arrived |
| FR-2.6 | **Library fails to load:** retry automatically when the visitor interacts with the form (the PERF-2 pattern). If it still fails (§9 BQ-5, answered 2026-10-14): a short "please try again" message in the page's language, the other fields keep what was typed, and nothing is sent without a valid phone (the same rule as today). An unchecked number is **never** sent |
| FR-2.7 | Everything else in the block is unchanged: fields, labels, the consent checkbox, the success state, the contact-info sidebar and the submit payload |
| FR-2.8 | The owner-side preview of this block behaves the same way. Dev lists every place the block renders. **Amended by SA 2026-10-14 (BR-2 workplan O-5):** the website editor `/business-os/website` does **not** render the block. It imports only `blocks/types` (type-only), and its First Load at `d769b9e3` holds no phone-library chunk, so SA-9's "reaches the editor through `blocks/index.tsx:28`" was wrong. The route is measured and reported as "nothing to remove", with no gate. The owner previews that do render the block, `/website-preview/[id]` and `/landing-preview`, get the change and are reported as side routes |

### §4.5 Acceptance criteria (QA)

- [ ] **AC-2.1** `next build`: the phone library is no longer in First Load JS for `/site/[subdomain]`, `/[slug]`, `/site/[subdomain]/contact` and `/c/[userCode]/contact`. Each is down ≥ 10 kB (expected about 50 kB gz; the net figure is measured, since `usePhoneLib` brings the browser logger, SA-7). Dev confirms that no other public block on those routes still imports the library statically. `/business-os/website` is measured and reported only: it has no phone library in First Load at base, so there is nothing to remove and no gate (SA amendment 2026-10-14, BR-2 workplan O-5; replaces C-10).
- [ ] **AC-2.2** The library chunk is requested after first paint with no click (Network tab).
- [ ] **AC-2.3** **No layout shift.** Under Fast 3G with cache off, the placeholder and the real phone row have identical bounding boxes, and the elements below do not move when it swaps (DevTools Layout Shift regions: none on swap).
- [ ] **AC-2.4** **Swap time.** Unthrottled desktop: the real field is in place before the form is scrolled into view. Fast 3G, cache off, form in the first screen: the real field appears within **2 s of hydration** (the page becomes usable), **not** first paint (§9 BQ-4, answered; C-11). On Fast 3G, hydration alone can take longer than 2 s after first paint, which is unrelated to this slice. The limit is confirmed after measuring the base commit.
- [ ] **AC-2.5** Focusing the placeholder under throttling puts the cursor in the real number box once it appears.
- [ ] **AC-2.6** Pressing Send before the library arrives: the form sends once, after validation, and the stored lead matches main. *SA note 2026-10-14:* the placeholder is read-only, so the phone is always empty at that moment. The expected result is the normal "sending" state, then today's "This field is required" on the phone field and **nothing sent**. Never an "invalid phone" message. Once the real field is in place and filled, Send sends exactly once.
- [ ] **AC-2.7** **Same-output.** On a Hebrew, an English and a Spanish page, five inputs (Israeli mobile, US number, UK number, invalid, empty) produce the same stored phone value and the same validation message as main. The default country is IL, US and ES respectively.
- [ ] **AC-2.8** Country dropdown: search, selection and "a country change rewrites the number" behave as on main.
- [ ] **AC-2.9** Library blocked (request blocking): the FR-2.6 behaviour appears, the other fields are kept, and no lead is sent with an unvalidated phone. Unblock and interact again: the field loads and the form sends.
- [ ] **AC-2.10** Dark template and RTL page: the placeholder matches the template and the row stays LTR.
- [ ] **AC-2.11** Consent checkbox, success screen and sidebar are identical to main.

### §4.6 Success metric and §6 filter

**Metrics**

| Metric | Source and method | Baseline | Target |
|---|---|---|---|
| First Load JS | `next build` route table at the slice's base commit (R22 method) | `/site/[subdomain]` and `/[slug]` 285 kB, contact pages 231 kB, `/business-os/website` 531 kB (R22, re-measure at base) | Down ≥ 10 kB on each of `/site/[subdomain]`, `/[slug]` and the two contact pages. Expected ≈ −50 kB gz (net of the logger, SA-7). `/business-os/website`: reported, no gate (no phone library at base; SA amendment 2026-10-14) |
| Optional: Lighthouse mobile, a test account's public site | 5 runs, median LCP and TBT (R25 method) | Measured at base | Not worse. A ≥ 10% gain is reported as a bonus |

**§6 filter**

| Q | Answer | Why, and why the user accepted it |
|---|---|---|
| Q1 Output | **Yes** | On a slow connection a visitor may see the placeholder for up to 2 s after the page becomes usable, before the real phone field. Accepted by the user (§9 BQ-4, 2026-10-14), with the limits in FR-2.3 and AC-2.3/2.4. The stored lead is identical (AC-2.7) |
| Q2 Money | No | No charges are involved |
| Q3 Timing | No | Leads arrive when submitted, as today |
| Q4 Scope | No | The field, validation and country picker are all kept |
| Q5 Failures and records | **Yes (small)** | A new, rare failure: the phone component cannot load. The default (§9 BQ-5) keeps today's "valid phone required" rule and adds a retry path. Leads are stored as today |

### §4.7 Risks

| Risk | Mitigation |
|---|---|
| The library stays in the page through one of the four paths, or through another block | AC-2.1 checks the build output, not just the edited file |
| Layout shift on swap hurts trust and scoring | FR-2.3, AC-2.3 |
| A visitor types or submits during the gap and loses input | FR-2.4, FR-2.5, AC-2.5, AC-2.6 |
| The global CSS for `.phone-input-contact` stops matching the lazily loaded library's markup | SA-8 confirmed the block's global style applies to the lazy component and the placeholder; the library CSS stays static (FR-2.1). AC-2.10 visual check |
| A lost lead if the library fails to load | FR-2.6. The user chose "please try again", never an unchecked number (§9 BQ-5) |

### §4.8 Out of scope (BR-2)

- The public booking flow. It has no phone library today; PERF-3 found the target was unused code.
- Owner-side phone fields (done in PERF-2), and the settings page's phone field.
- Changing phone validation, the default-country rule or the stored format.
- Removing the unused `app/site/[subdomain]/book/BookingWidget.tsx` (a separate clean-up candidate).

---

## §5 BR-3: Honest Progress While a Website Image Is Generated

### §5.1 User stories

- As a **business owner** generating a picture for my website, I want to see right away that it is being made and roughly how long it takes, so that I do not think the button is broken and press it again.
- As a **business owner**, I want the finished picture to be exactly as good as today and to cost the same, so that the waiting experience is the only thing that changes.

### §5.2 How it works today (verified in code)

| Step | Where | What happens |
|---|---|---|
| 1 | `components/website/MediaLibraryPicker.tsx:185-223`, `:373-390` | The owner types a description and presses Generate. The button shows a spinner and the "working" label. Nothing else changes until the answer arrives |
| 2 | `app/api/website/media/generate/route.ts:31-107` | A single JSON request. It goes through `runAiAction` (one audit entry) and returns the picture's URL plus the remaining daily allowance |
| 3 | `lib/services/GeneratedImageService.ts:281-470` | Reuse check (the same prompt and shape returns the stored picture for free), then the images area on/off switch (DB-resolved settings), then the daily cap, then one provider call |
| 4 | `lib/ai/providers/openaiProvider.ts:292-330` | `images.generate` with `n: 1`, run through `callWithTracking`. One ledger row per image, priced per image from the quality the provider reports. The model is DB-resolved through `resolveBosLlmSettings('images', 'image_generation')` with `withModelFallback` |
| 5 | Picker | On success, the picture is applied to the slot and the picker closes. On failure, a reason-specific message appears |

Measured (R13, all accounts, 30 days, small sample): p50 53.4 s, p95 58.1 s, $0.25 per image. Image generation is the largest real-account AI cost line (scoping §12 BIZ-1).

### §5.3 Can we show true partial images? Assessment and decision

The provider's image API can **stream up to three partial images** before the final one. That option was assessed against the user's constraints (same final image, same cost):

| Constraint | Finding |
|---|---|
| Cost must not change | **Fails.** The provider bills extra image output tokens for each partial image (third-party reports put this at roughly 100 tokens per partial; SA must confirm against the provider's pricing page and the `usage` object of a test call). Our ledger prices images **per image by quality** (`priceFor`), so either the extra spend goes unrecorded or the price must change. Both are money changes (§6 Q2) |
| Final image identical | Probably met (same model, size and quality), but not provable. Generation is not repeatable, so "identical" can only mean identical request parameters |
| BOS LLM call standards | Would need a **new tracked streaming path**. `callWithTracking` wraps a single promise and `generateImage` returns one response. It would also need a streamed route response to the browser. That is two new patterns (rule 7) |
| Owner experience | Partial images are rough drafts. An owner might judge, reject or re-run a picture from a draft that does not look like the result |

**Decision for this requirement:** BR-3 delivers **honest progress, not partial images**. It changes **only the picker UI**. The route, the service, the provider call, the request parameters, pricing, ledger rows, audit and credit charges are all untouched. True partial previews go to the roadmap (§8), with the cost question attached. The user confirmed this under §9 BQ-6 (2026-10-14). The one exception to "picker UI only" is that closing the picker now also cancels the automatic placement into the slot (FR-3.10, §9 BQ-9). That is still a picker-side change: the request is not aborted and the server path is untouched.

### §5.4 What changes, for whom

| Who | Today | After BR-3 |
|---|---|---|
| Owner pressing Generate in the media picker (from any block, the dashboard's configuration dialog, or the wizard) | A spinner on the button for about a minute | Within a second: a placeholder in the picture's shape (wide, portrait or square), "Creating your picture, this usually takes about a minute", and a running timer. After 75 s: "Taking longer than usual, still working". Then the picture, exactly as today. The copy also says the picker can be closed (the picture is still saved to the library) and warns against requesting the same picture again while one is being made |
| Owner who closes the picker while a picture is being made | The picture is still made and saved, and when it arrives it may be placed into the slot anyway, depending on the host | The picture is still made and saved to the library, but it is **not** placed into the slot automatically (FR-3.10) |
| Everyone else | — | Nothing |

### §5.5 Functional requirements

| # | Requirement |
|---|---|
| FR-3.1 | Within **1 s** of pressing Generate (or Enter), the picker shows a placeholder in the requested aspect, a localised message that the picture is being created and usually takes about a minute (§9 BQ-7), and the elapsed seconds |
| FR-3.2 | **Honest progress only.** No percentage, and no bar that fills as if progress were measured. An indeterminate animation is allowed. The "about a minute" wording comes from the measured p50/p95, not from a guess |
| FR-3.3 | After **75 s** (above today's p95 of 58 s) the message changes to "taking longer than usual, still working". There is **no new timeout, cancel or retry**: the request runs exactly as today |
| FR-3.4 | Generate stays disabled while a picture is being made (as today), so the owner cannot start a second paid request from the same picker |
| FR-3.5 | Outcomes are unchanged: success applies the picture and closes the picker. Refusals (`depicts_people`, `limit_reached`, `unavailable`) and `failed` show today's messages. The allowance line updates as today. `notifyCreditUsageChanged` fires as today |
| FR-3.6 | A reuse hit or an immediate refusal ends the progress state as soon as the answer arrives. There is no minimum display time |
| FR-3.7 | **Closing the picker during generation: the copy** (§9 BQ-8, answered 2026-10-14; SA-11, C-13). SA confirmed the server finishes the work when the browser disconnects: the picture is uploaded and recorded in the library, and the ledger row and credit charge are written, before the route returns. The progress message therefore says: (a) the owner **can close** the picker, and the picture is **still saved to their library**; (b) **do not request the same picture again** while one is being made, because that can charge twice (§8, the double-charge item). The SA-11 note that the picture "may also be placed in the slot" no longer applies to the copy, because FR-3.10 cancels that placement |
| FR-3.10 | **Closing the picker cancels the automatic placement** (§9 BQ-9, answered 2026-10-14). If the owner closes the picker while a picture is being made, the result of that pending request is **not** applied to the slot when it arrives: the closed picker's handler must not call `onSelect(url)` (today it still does, `components/website/MediaLibraryPicker.tsx:191-205`). The request is **not aborted**: the server-side generation, the save to the library, the ledger row, the credit charge and the audit entry all complete exactly as today. Dev verifies this on **every host that can reach the picker on main**: the five website-editor slots (hero, about, team, gallery, logo cloud). The dashboard configuration dialog's logo uploader, the wizard logo and the testimonial photo do not reach the picker, so for them this is N/A on main (amended 2026-10-14 to match AC-3.9 / SA R-7). This is a picker-side change only and does not breach FR-3.9 |
| FR-3.8 | All new copy exists in `en`, `es` and `he` and renders RTL in Hebrew |
| FR-3.9 | **No server change.** `GeneratedImageService`, the generate route, `openaiProvider.generateImage`, the images area settings, image configuration, pricing, `callWithTracking`, `runAiAction` and credit charging are not modified. If SA finds that any server change is needed, this requirement returns to the BA |

### §5.6 Acceptance criteria (QA)

- [ ] **AC-3.1** Pressing Generate: placeholder, message and timer appear within 1 s (5 runs, production build). The placeholder's shape matches the slot's aspect for wide, portrait and square.
- [ ] **AC-3.2** No percentage or fill-as-progress bar appears anywhere in the flow.
- [ ] **AC-3.3** With the response held past 75 s (a mocked slow response in a test, or a throttled run), the "taking longer" message appears, and the request is neither cancelled nor repeated (Network tab: one request).
- [ ] **AC-3.4** On success the picture is applied to the slot and the picker closes, as on main.
- [ ] **AC-3.5** **Same-output, request side.** A unit test pins the provider request (model from settings, `prompt` with the style suffix, `size`, `quality`, `n: 1`) as unchanged from main. Code review confirms that no file under §5.5 FR-3.9 changed.
- [ ] **AC-3.6** **Same records.** One real generation on a test account: one ledger row, one audit entry and one credit charge, with the same price basis as on main.
- [ ] **AC-3.7** A reuse hit (the same prompt again) and each refusal (a description with people in it, the daily limit, generation switched off) end the progress state immediately and show today's message.
- [ ] **AC-3.8** Hebrew and Spanish copy is present, RTL renders correctly, and no keys are shown.
- [ ] **AC-3.9** The same experience appears in every host that can reach the picker on main: the five website-editor slots (hero, about, team, gallery, logo cloud), which between them cover the wide, portrait and square shapes. *Amended 2026-10-14 (SA R-7):* the dashboard configuration dialog's logo uploader, the wizard logo and the testimonial photo do **not** reach the picker (`MediaUploader` shows Library and Generate only when `section` is passed), so for them this criterion is **N/A: picker not reachable on main**. AC-3.11 is checked on the same five slots.
- [ ] **AC-3.10** The progress copy (FR-3.7) tells the owner they can close the picker and the picture is still saved to their library, and warns against requesting the same picture again while one is being made. Present in `en`, `es` and `he`.
- [ ] **AC-3.11** **Close during generation** (FR-3.10, §9 BQ-9), in each host of the picker: press Generate, close the picker before the answer arrives. (a) The Network tab shows one request, not cancelled. (b) When it completes, the slot is **unchanged** (the picture is not placed). (c) The picture appears in the owner's media library. (d) One ledger row, one credit charge and one audit entry are written, as on main. (e) Reopening the picker and generating normally still places the picture and closes the picker (AC-3.4).

### §5.7 Success metric and §6 filter

**Metrics**

| Metric | Source and method | Baseline | Target |
|---|---|---|---|
| Time to first useful feedback (shape, expected duration, elapsed time) after pressing Generate | QA, production build, DevTools performance recording, 5 runs, median | None before the finished picture: p50 53.4 s / p95 58.1 s (R13; small sample) | ≤ 1 s. This is an **acceptance check, not a speed gain**: BR-3 is kept for its visible benefit under the §2 rule-3 exception (C-12) |
| Guard: generation time | `token_usage.latency_ms` for `image_generation` (R13 method), the first 14 days after merge | p50 53.4 s / p95 58.1 s | Unchanged (no server change; sample is small, so reported, not gated) |
| Guard: cost per image | `token_usage.cost_usd` and credit charges for `image_generation` (R13/R16 method) | $0.25 per image | **Identical** |

**§6 filter**

| Q | Answer | Why, and why the user accepted it |
|---|---|---|
| Q1 Output | **Yes** | The owner sees a new waiting experience. The picture itself is unchanged (identical request, AC-3.5). Accepted by the user as the purpose of the slice. Also: closing the picker during generation no longer places the picture into the slot (FR-3.10). Accepted by the user under §9 BQ-9 (2026-10-14); the picture is still saved to the library |
| Q2 Money | No | No server change. Pricing, ledger and charges are identical (AC-3.6). This is why true partial images were not chosen (§5.3) |
| Q3 Timing | No | Generation takes as long as today |
| Q4 Scope | No | No feature is removed or degraded |
| Q5 Failures and records | No | No new timeout, retry or fallback, and no request is cancelled (FR-3.3, FR-3.10: closing the picker cancels only the placement, not the request). Same records (AC-3.6, AC-3.11) |

### §5.8 Risks

| Risk | Mitigation |
|---|---|
| "About a minute" becomes untrue if the provider or model slows down or changes | The 75 s "taking longer" message covers the tail. The wording is reviewed when the images model changes |
| The owner closes the picker thinking the picture is lost, and generates again | FR-3.7: the copy says the picture is still saved to the library. A different description is a new, separately charged picture, as today |
| The owner generates the **same** description again while the first is still running, and is charged twice | **Not fixed by BR-3.** The reuse check (`GeneratedImageService.ts:315`) finds nothing until the first picture is recorded (`:434`), so the second request is a new paid generation (SA-11 (b)). BR-3 only warns against it in the copy (FR-3.7). The fix is a separate item (§8) |
| A closed picker still places a late picture into the slot, surprising the owner | FR-3.10, AC-3.11, verified per host |
| Scope creep into a server or streaming change | FR-3.9: any server change sends the requirement back to the BA |

### §5.9 Out of scope (BR-3)

- True partial or streamed image previews (§8).
- Any change to the image model, quality, size, format, prompt style, daily limit or price (the rest of BIZ-1 stays parked).
- Background generation with a notification when ready (§8).
- Text generation progress for the website (`full_site`, `landing_page`).
- Fixing the double charge when the same description is generated again while the first is still running (§8). BR-3 only warns about it in the copy.

---

## §6 Non-Functional Requirements (all slices)

- **Performance:** each slice must meet its §1 metric with the §2 noise rule. BR-1 must not slow owner pages' server response beyond the SA threshold.
- **Security:** BR-1 never trusts a client-supplied language value without checking it against `en`/`es`/`he`, and never writes one into the page unescaped. No change to auth, `user_id` scoping, or the preferences route's validation. No PII in logs.
- **Accessibility:** `lang` and `dir` are correct for screen readers from the first frame (BR-1). The BR-2 placeholder carries the same label association as the real field. BR-3 progress text is announced politely (`aria-live="polite"`), and the timer is not announced every second.
- **Localisation:** all new copy is in `en`, `es` and `he`. Missing keys render as the key (`t()` behaviour), so QA checks every new key in all three languages.
- **Logging:** Pino through `createLogger` on the server; the client logger on the client. No new `console.*`.
- **CI:** no added CI time. Guard tests are Jest unit tests in the existing suite.

---

## §7 Recommended Slice Order

| Order | Slice | Why this position |
|---|---|---|
| 1 | **BR-2** | Smallest. It reuses the SA-approved PERF-2 loader, adds no new pattern, has a deterministic bundle metric, and reaches clients (audience b). It can start as soon as SA confirms §10 SA-7 |
| 2 | **BR-3** | UI only, no server or LLM change, no new pattern. It removes the most visible wait in the owner product |
| 3 | **BR-1** (BR-1a, then BR-1b) | Highest owner value, but a new pattern on the shared provider that also carries currency and timezone. **SA designs it while BR-2 and BR-3 are built**, so it does not wait behind them. BR-1a (no flash) ships before BR-1b (bytes) |

---

## §8 Out of Scope / Future Roadmap

| Item | Note |
|---|---|
| Deliver the business timezone (and business currency) at first render as well | Removes the brief `UTC` window before the preferences row arrives. It touches the CLAUDE.md "Currency & Timezone" authorities, so it needs its own requirement |
| Browser-language detection for owners with no saved language | A product decision for onboarding (§9 BQ-2) |
| Align `user_preferences.preferred_language` and `business_profiles.language` into one source of truth | Server features and the provider prefer different columns today. A data clean-up, not a performance item |
| True partial image previews (BIZ-1, streamed option) | Needs a cost decision (extra provider tokens per partial), a tracked streaming path in the provider (new pattern), and a streamed route |
| Generate images in the background and notify the owner when ready | A larger UX change |
| The rest of BIZ-1 (model, quality, size, format) and BIZ-2..BIZ-6 | Stay parked per the user's business-round decision |
| **Side finding, recommended as a separate fix item:** generating the same description again while the first is still running bypasses the reuse check and can charge twice | Known issue found in the SA review (SA-11 (b)): the reuse check (`lib/services/GeneratedImageService.ts:315`) finds nothing until the first picture is recorded (`:434`), so a second identical request makes a second paid generation. **BR-3 does not fix this**; it only warns against it in the picker copy (FR-3.7). It is a money issue (§6 Q2) on the server path, so it needs its own requirement and SA review |

---

## §9 Open Business Questions for the User

**All answered on 2026-10-14.** The user said "defaults, go ahead" to every question, in its SA-revised form (BQ-2, BQ-3, BQ-4 and BQ-8 were revised after the SA review, and BQ-9 was added). The question text below is the revised wording the user accepted.

| # | Question | Recommended default | Why we ask | Answer |
|---|---|---|---|---|
| BQ-1 | When an owner who has **already chosen a language** opens Business OS on a new phone or computer, which language should appear first? (a) the language they chose, or (b) the language their phone or browser is set to | **(a) The language they chose.** It is what they see a second later today anyway, so only the flash disappears | Decides the first-paint rule (§3.4) | ✅ **Answered 2026-10-14: (a).** The saved language shows first on a new device |
| BQ-2 (revised) | An owner who has **never saved a language** (for example, a brand-new signup in onboarding) but whose browser has a last pick: may they see English once, on the very first load only, before their pick appears? Adding a cookie to avoid that is not proposed, because it would be a second, client-writable source of the language. Browser-language detection is not used | **Yes.** It happens once; the pick is then saved, so every later load is right from the first frame | Avoids changing onboarding as a side effect, and avoids a second source of truth (SA-1) | ✅ **Answered 2026-10-14: accepted.** English flash once on the very first load; no cookie added |
| BQ-3 (revised) | When an owner **switches language**, from Settings, the header menu, or the onboarding-chat auto-switch, may the change take up to about a second while the new language loads (the page stays fully in the old language until then)? | **Yes** | This is how the page avoids downloading all three languages every time | ✅ **Answered 2026-10-14: accepted** for all three switch points |
| BQ-4 (revised) | On a business's website, may a visitor on a **slow mobile connection** see a same-size, placeholder phone box for **up to about 2 seconds, counted from when the page becomes usable** (not from when it first appears) before the real one appears? On normal connections it is in place before they scroll to the form | **Yes, up to 2 seconds from when the page is usable**, with no movement of the page | Sets the BR-2 acceptance limit (AC-2.4). Counting from first appearance would fail for reasons unrelated to this change (C-11) | ✅ **Answered 2026-10-14: accepted.** Up to 2 s from usable, no layout movement |
| BQ-5 | In the rare case that the phone box **cannot load at all** (a network failure on the visitor's side), should the visitor (a) see a short "please try again" message, with nothing sent without a checked phone number (today's rule), or (b) be allowed to send with the number as typed, unchecked, so the lead is never lost? | **(a) Try again; keep today's rule.** Your CRM keeps only checked numbers. (b) would capture more leads but store some numbers that cannot be dialled | A trade-off between lead capture and data quality | ✅ **Answered 2026-10-14: (a).** "Please try again"; never send an unchecked number |
| BQ-6 | For website pictures: (a) **honest progress** (a picture-shaped placeholder, "usually about a minute", a running timer), at no extra cost, or (b) **real rough previews** of the picture as it forms, which the AI provider bills extra for, adding to the cost of every picture | **(a) Honest progress now.** (b) goes on the roadmap for a separate cost decision | You asked that cost not change | ✅ **Answered 2026-10-14: (a).** Honest progress now; real rough previews on the roadmap as a separate cost decision (§8) |
| BQ-7 | Should the picker say how long a picture **usually takes** ("about a minute")? | **Yes.** Measured: half finish within 54 seconds, and nearly all within a minute | Sets expectations, so owners do not press again | ✅ **Answered 2026-10-14: yes.** "Usually takes about a minute" |
| BQ-8 (revised) | Should the picker tell owners they **may close it** while the picture is made, that the picture is still saved to their library, and warn them **not to request the same picture again** while one is being made, because that can charge twice? | **Yes.** Our architect confirmed the picture is still saved when the picker is closed (SA-11) | We must not promise something the system does not guarantee, and owners should not pay twice | ✅ **Answered 2026-10-14: yes** (FR-3.7, AC-3.10). The SA-revised wording also said the picture "may be placed automatically"; BQ-9 (same day) cancels that placement, so the copy does not promise it |
| BQ-9 (new) | Today, a picture finished after the owner closed the picker may still be placed into the slot automatically. Should closing the picker **cancel that automatic placement**, while the picture is still made and saved to the library? | **Yes, in scope for BR-3** | Placing a picture the owner walked away from is surprising (SA-11 (a)) | ✅ **Answered 2026-10-14: yes, in scope for BR-3** (FR-3.10, AC-3.11) |

---

## §10 Technical Questions for SA

| # | Question | BA suggestion |
|---|---|---|
| SA-1 | **BR-1 mechanism (new pattern, rule 7).** Should the initial language be resolved on the server in the layouts that mount the provider (the business-os layout is already `force-dynamic` and reads the session), with a cookie as a cache, or both? How are `lang`/`dir` set before paint: reuse the `PublicDirScript` approach, or set attributes on the layout's wrapper? | Server-resolved from the saved preference in the existing layouts, with no cookie unless needed. Reuse the `PublicDirScript` approach for the document attributes. Both lean on existing precedents |
| SA-2 | **Which stored column** decides the first paint? The provider settles on `user_preferences.preferred_language` today. `resolveUserLanguage` (server features) prefers `business_profiles.language` | Use the provider's current column, so the settled language is provably unchanged (AC-1.3). Aligning the two is roadmap (§8) |
| SA-3 | **Dictionary delivery** so that the active dictionary is available synchronously at server render and hydration: a per-language client chunk chosen by the server (preloaded), or the dictionary passed from a server component in the page payload. Which one keeps total bytes down (the §3.7 guard)? Confirm or merge the BR-1a/BR-1b split | SA decides. The metric counts dictionary bytes wherever they travel |
| SA-4 | **Server cost** of the language read on every full owner page load. Combine it with the existing reads (payment hold, plan badge) or run it in parallel, and set the regression threshold for the §3.7 guard | — |
| SA-5 | **Guard** that no production client chunk contains more than one dictionary, and that production code does not import `translations` (`LanguageContext.tsx:127`). Tests and the cancellation-label pairing test may keep importing it | A Jest source-level guard in the existing suite (no CI time added) |
| SA-6 | Confirm that FR-1.7 holds: currency and timezone keep their sources, order and initial values, even though the same server read could deliver them | Keep them untouched in BR-1 (§8) |
| SA-7 | **BR-2 reuse.** Can the PERF-2 loader (`components/crm/usePhoneLib.ts`, approved as phone-specific for owner surfaces) serve the public block, covering all four paths in §4.2, `phoneField.ts` helpers and the library's CSS? Or does the public surface need a variant? | Reuse it. Extending its scope to one public block is a scope note on an approved pattern, not a new pattern |
| SA-8 | **BR-2 styling.** The block's global `style jsx` targets `.PhoneInput*` classes. Confirm that it applies to the lazily loaded component and that the library CSS arrives with it, with no unstyled frame | — |
| SA-9 | **BR-2 build check.** Do any other blocks on the public site or contact routes import the library statically (which would cancel the gain)? | Dev lists them in the workplan, with the R22 route table before and after |
| SA-10 | **BR-3 partial images.** Confirm the §5.3 assessment: the provider's per-partial billing, and that streaming would need a new tracked path in `openaiProvider` plus a streamed route. That evidence is attached to the roadmap item | — |
| SA-11 | **BR-3 disconnect behaviour.** If the browser closes the picker (or the tab) during generation, does the generate route still finish, store the picture and write the ledger and audit rows on our hosting? The route sets no `maxDuration`, and current runs of about 55 s succeed. This decides FR-3.7 and §9 BQ-8 | — |
| SA-12 | **Not part of this requirement; flagged for the model-settings owner.** Third-party pricing sites (unverified) list the first-generation image model as retiring around 2026-10-23. The images area model is DB-resolved, so please check which model is live and whether that affects image generation | Route to the BOS LLM settings owner if confirmed |

---

## §11 Notes on Integration Points

| Area | Files | Slice | Change |
|---|---|---|---|
| Language provider | `lib/business-os/LanguageContext.tsx`, `lib/business-os/translations/{en,es,he}` | BR-1 | Initial language from the server; per-language loading; switch behaviour |
| Layouts mounting the provider | `app/business-os/layout.tsx`, `app/onboarding-build/layout.tsx`, `app/onboarding-chat/layout.tsx`, plus any page mounting it directly | BR-1 | Supply the initial language and pre-paint `lang`/`dir` |
| Nested CRM provider | `app/business-os/crm/layout.tsx:14` | BR-1a | **Removed** (the layout's CSS import stays) (SA-1, C-1) |
| Root layout | `app/layout.tsx` (`lang="en" dir="ltr"`, `suppressHydrationWarning`) | BR-1 | Possibly none. SA-1 decides |
| Preferences | `app/api/business-os/preferences/route.ts`, `UserPreferencesRepository`, `BusinessProfileRepository` | BR-1 | Read path reused. Write path unchanged. Any new server read goes through the repositories (rule 1) |
| Server-side language | `lib/business-os/userLanguage.ts` | — | Unchanged |
| Public contact form | `components/website/blocks/ContactFormBlock.tsx`, `WebsiteCountrySelect.tsx`, `components/crm/phoneField.ts`, `components/crm/usePhoneLib.ts` | BR-2 | On-demand library and placeholder |
| Contact form API | `/api/website/forms/contact` | — | Unchanged |
| Image picker | `components/website/MediaLibraryPicker.tsx` | BR-3 | Progress UI, new copy keys, and no placement after the picker is closed (FR-3.10) |
| Image generation server path | `app/api/website/media/generate/route.ts`, `lib/services/GeneratedImageService.ts`, `lib/ai/providers/openaiProvider.ts`, `lib/business-os/llm/*` | — | **Unchanged** (FR-3.9) |
| DB tables | `user_preferences`, `business_profiles` (read only, as today) | BR-1 | No schema change in any slice |
| Master scoping document | `PERFORMANCE_IMPROVEMENT_SCOPING.md` (local) | All | §0 rows and results mirrored there |

---

## §12 SA Review

**Reviewed by SA, 2026-10-13.** Code read on `origin/main` @ `ffb598ac` (PR #342 and PR #344 included). The line numbers below are from that commit.
**Status:** APPROVED WITH CHANGES. The BA applies §12.3. BR-2 and BR-3 can then go to workplan, and BR-1a can follow. BR-1b's workplan waits for the spike in SA-3.

### §12.1 New patterns (CLAUDE.md rule 7)

| # | Pattern | Ruling |
|---|---|---|
| P-1 | **Initial language resolved on the server** in the layouts that mount the provider, passed to the client provider as a prop | **Approved, scoped.** It follows `readPlanBadge` (`lib/business-os/entitlements/readPlanBadge.ts:53-67`, called at `app/business-os/layout.tsx:64`). It must be a `server-only` helper module, not code in the layout, so its guarantees are testable. It returns the **language only** and never throws: `{ language, source: 'saved' \| 'none' \| 'unknown' }`. It reads through `userPreferencesRepository.findLocale(user.id)` with the session user, so no caller-supplied id is involved. It is allowed only in `force-dynamic` segments (all three layouts are: `app/business-os/layout.tsx:20`, `app/onboarding-build/layout.tsx:8`, `app/onboarding-chat/layout.tsx:8`), so a per-user render can never be cached for another user |
| P-2 | **Owner pre-paint `lang`/`dir` script** | **Approved as a sibling of `PublicDirScript`. Do not reuse that component.** `PublicDirScript` also sets `data-public-surface` and `colorScheme` (`components/public/PublicDirScript.tsx:24`), and `data-public-surface` switches on the public theme CSS (`components/public/PublicThemeStyle.tsx:108`). The owner script sets `lang` and `dir` only. Its value comes from the closed enum `en`/`es`/`he` and is serialised with `JSON.stringify`. The layout wrapper also carries `dir`/`lang` in the server HTML, as `PublicBrandFrame` does |
| P-3 | **Per-language dictionary delivery** (BR-1b) | **Approved in principle, subject to the SA-3 spike.** Putting the dictionary into the page payload is **rejected** (SA-3) |
| P-4 | `usePhoneLib` used by a public block | **Scope extension of the approved PERF-2 pattern, not a new pattern** (SA-7) |
| — | BR-3 | No new pattern (UI only) |
| — | Cookie for the language | **Not introduced** (SA-1) |

### §12.2 Answers to §10

**SA-1: mechanism. Server-resolved, no cookie.**
- The business-os layout already resolves the session on every request (`redirectIfAwaitingPayment` at `app/business-os/layout.tsx:62`, `readPlanBadge` at `:64`). The two onboarding layouts do the same (`:21` / `:20`). `getUser()` is memoised per session (30 s TTL plus in-flight dedup, `lib/auth.ts:60-131`), so the language read costs one single-row repository query and no extra auth round trip.
- **No cookie.** It would be a second, client-writable source that can disagree with the saved value. The only case it would help is "nothing saved, but this browser has a pick", and that state is rare and heals itself:
  - `business-os-language` is written only inside the signed-in provider (`LanguageContext.tsx:272`, `:317`), and `setLanguage` saves to the server in the same step (`:337`).
  - Sign-out clears the key (`lib/client/auth-actions.ts:52`).
  - The backfill (`:273-282`) turns that state into a saved value on its first load.
  
  Consequence: §3.4 rule 2 ("this browser's last pick") **cannot be honoured at the first frame**. In that rare state, the first frame is English, then the page switches once, as today. From the next load it is correct from the first frame. AC-1.4 changes (§12.3 C-2).
- **Client behaviour by `source`:**
  - **`saved`:** start in that language and **skip** the localStorage override at `:208-211`, which would otherwise flash the old language (AC-1.3). Write localStorage to match.
  - **`none` or `unknown`:** start in English, then apply the localStorage pick after mount, as today.
  
  The client `GET /api/business-os/preferences` stays. It remains the **only** authority for the backfill decision and for currency and timezone (`:238-282`), so AC-1.5 is unchanged.
- **The nested provider must go.** `app/business-os/crm/layout.tsx:14` mounts a **second** `LanguageProvider` inside the business-os one. It is a client layout and cannot receive the server language, so every CRM page would keep the flash, and it also makes a duplicate preferences `GET`. Remove the nested provider and keep that layout's CSS import. No other page mounts the provider: the only mounts are those four layouts.
- Keep the provider's `dir`/`lang` effect (`:294-298`). The script runs only on a full document load. A soft navigation into `/onboarding-*` from a surface without the provider still relies on the effect.

**SA-2: column.** `user_preferences.preferred_language`, through `userPreferencesRepository.findLocale`. This is the same read the client settles on today (`app/api/business-os/preferences/route.ts:69-100`, applied at `LanguageContext.tsx:270-272`). Agreed with the BA. Aligning it with `business_profiles.language` stays on the roadmap.

**SA-3: dictionary delivery. A per-language client chunk chosen by the server. Not the page payload.**
- **Rejected: passing the dictionary as a prop from the server layout.** That serialises roughly 250–280 kB of raw text per language (`translations/{en,es,he}.ts` are 257,602 / 252,809 / 282,963 bytes) into the RSC payload of every full load **and every `router.refresh()`**, and the browser cannot cache it. It moves the bytes rather than removing them, which is the trap §3.7 names.
- **Preferred:** three thin `'use client'` wrapper modules, one per language. Each statically imports exactly one dictionary and renders the shared provider core with it. The server layout picks one. React's flight client preloads only the client references actually rendered, so on a cold load one dictionary chunk should be requested, and it is a static, cacheable, hashed file. A language switch then loads the new dictionary with `import()` and swaps `{ language, dictionary }` in **one** state update, so no frame mixes two languages (FR-1.4).
- **Mandatory spike before the BR-1b workplan** (a production build on Next 14.2):
  - (a) the Network tab shows exactly one dictionary chunk per language on a cold load;
  - (b) no hydration warning;
  - (c) what the `next build` route table reports.
  
  If (a) fails, the fallback is a `next/dynamic` SSR'd gate per language (the PERF-1 primitive). With that gate, hydration of the subtree waits for the chunk, so the spike must also report time to interactive. The spike result goes into this document before Dev starts BR-1b.
- **The split is confirmed.** BR-1a is P-1 + P-2 + the CRM layout fix, with all three dictionaries still loaded. BR-1b is P-3 + FR-1.3–FR-1.5 + FR-1.9. BR-1a must ship first, because BR-1b relies on the server choosing the language.

**SA-4: server cost.** Run the language read **after** `redirectIfAwaitingPayment()`, which must stay first (`app/business-os/layout.tsx:59-62`), and **in parallel** with `readPlanBadge()` (`Promise.all`). The onboarding layouts run it after their payment hold. **Guard threshold:** the median HTML document response time over 10 **interleaved** before/after runs (same host, same network, production build) must be no worse than **max(10%, 30 ms)**.

**SA-5: guard.** A Jest source-level guard in the existing suite, so no CI time is added. It asserts three things:
- `LanguageContext.tsx` imports no dictionary value.
- No production file (`app`, `components`, `lib`, `hooks`, excluding `__tests__`) imports the all-three `translations` export.
- Only the three per-language wrappers and the switch loader import a dictionary module.

The `translations` export (`LanguageContext.tsx:127`) moves to a test-facing module. Its three importers are all tests and are updated: `lib/business-os/__tests__/dictionariesStayInStep.guard.test.ts:20`, `lib/business-os/credits/__tests__/creditAreaNames.test.ts:14` and `lib/email/__tests__/clientFacingCancelReason.test.ts:24`. Whether a built chunk holds more than one dictionary cannot be checked without `next build`. QA checks it once (AC-1.11), not CI.

**SA-6: currency and timezone.** FR-1.7 holds, with one trap the workplan must pin. The default display currency on mount comes from the **localStorage** language (`LanguageContext.tsx:208-218`), not from the language the page settles on. A later server language does not re-derive it: `:270-271` calls `setLanguageState`, not `setLanguage`. So today:
- saved `he`, localStorage `es`, no pin and no business currency: **EUR**;
- saved `he`, no localStorage: **USD**.

BR-1 must keep deriving that default from the localStorage value, **never** from the new server-supplied initial language. That case is added to AC-1.10 (§12.3 C-5). Initial values stay as they are: `currencyCode = 'USD'`, `businessCurrency = undefined`, `timezone = 'UTC'` (`:182`, `:197`, `:202`). The server helper must not return the timezone, even though `findLocale` reads it. Note that the brief currency-symbol change on first load remains, now under a correctly-languaged frame (roadmap §8).

**SA-7: BR-2 reuse.** Yes. `usePhoneLib` / `loadPhoneLib` (`components/crm/usePhoneLib.ts:69-123`) fit the public block, and **all four paths can go lazy**, with three changes:
1. **Extend the existing barrel** `components/crm/phoneLib.ts` with `isValidPhoneNumber` and `WebsiteCountrySelect`. Do not create a second public barrel, which would mean a second module holder and a second download on `/business-os/website`. `applyCountryToPhone` and `phoneFieldValue` are already exported (`:28`).
2. **Move `publicFormCountry` into a library-free module.** It runs in a `useState` initialiser at first render (`ContactFormBlock.tsx:178`), but it lives in `phoneField.ts`, which imports the library at module scope (`:39-44`). The function itself needs no library (`:232-241`). Update `phoneField.test.ts`.
3. **A public placeholder variant.** The PERF-2 `PhoneFieldPlaceholder` is `disabled`, `aria-hidden` and `tabIndex={-1}` (`components/crm/PhoneFieldPlaceholder.tsx:28`). That fails FR-2.3 (label association) and FR-2.4 (focus hand-off). The public variant is focusable (read-only), is the target of the field label's `htmlFor`, includes a country-box stub of the same size, and moves focus into the real input when it mounts.
   
`handleSubmit` awaits `loadPhoneLib()` before validating (FR-2.5). A `null` result triggers the FR-2.6 path. Retry on interaction comes for free, because the hook's effect runs on every render while the library is missing (`usePhoneLib.ts:119-121`). Extend `components/crm/__tests__/phoneLibLazy.guard.test.ts` so that `CONVERTED` includes `ContactFormBlock.tsx` and `HEAVY_FOR_CONVERTED` includes `components/website/blocks/WebsiteCountrySelect`. `import type { Country }` stays, because it is erased. **The CSS stays a static import** (the PERF-2 decision, `phoneLib.ts:18-21`). It is not JavaScript and costs no First Load JS, and lazy CSS is what would cause an unstyled frame. FR-2.1 changes (§12.3 C-8). Observation: `usePhoneLib` imports `@/lib/logger` (Pino's browser build). If public routes do not already carry it, a few kB come back. AC-2.1 measures the net figure.

**SA-8: styling.** Confirmed. The block's `<style jsx global>` (`ContactFormBlock.tsx:622` onward) is rendered by the block itself, unconditionally, and targets `.phone-input-contact .PhoneInput*` class names. It therefore applies to the lazily rendered `PhoneInput`, and to a placeholder that reuses those classes inside `.phone-input-contact`, the same technique as `PhoneFieldPlaceholder`. With the CSS static, there is no unstyled frame.

**SA-9: other static importers.** None on the public routes beyond the block itself. On `origin/main` the importers are:
- `ContactFormBlock.tsx:6-8,10-16`, which reaches `WebsiteCountrySelect.tsx:4-5` and `phoneField.ts:39-44`;
- `app/site/[subdomain]/book/BookingWidget.tsx:13-20`, which is **unreferenced** (PERF-3);
- `lib/geo/countries.ts:55-57`, which imports only the country-name lists and is reached only from owner settings, through `components/ui/CountrySelect`.

The block also reaches `/business-os/website` through `components/website/blocks/index.tsx:28`, so the website editor's First Load drops too. Report that route under FR-2.8 / AC-2.1.

**SA-10: partial images.** The assessment is confirmed on the code side:
- `generateImage` wraps one `images.generate` promise in `callWithTracking`, and its metrics function prices **per image by quality** from the final response (`lib/ai/providers/openaiProvider.ts:302-327`). A stream of partial events has no place in that path, so streaming needs a new tracked path and a streamed route (two new patterns).
- The provider documents partial images as billed extra output image tokens (stated as 100 per partial image for `gpt-image-1`). Our per-image price would leave those tokens unrecorded.

SA did not re-check the live pricing page in this review. Whoever opens the roadmap item re-verifies it then, with the `usage` object of a test call.

**SA-11: disconnect.** **Yes, the server finishes.**
- **Nothing observes the abort.** The route never reads `request.signal`, and neither do `generateImage` or the SDK call (`app/api/website/media/generate/route.ts:54-66`, `openaiProvider.ts:308-314`). The handler runs to completion.
- **The picture, the ledger row and the charge are written before the response.** The picture is uploaded and recorded in `user_media` **before** the route returns (`lib/services/GeneratedImageService.ts:423-436`). The ledger row is written by `callWithTracking`, and the credit charge is awaited inside `runAiAction` (`lib/business-os/llm/aiActionAudit.ts:535`).
- **The audit entry is queued, not flushed** (`aiActionAudit.ts:9-10`, `:613`). That is the same in the normal path, so a disconnect adds no new loss.
- **Duration limit:** no `maxDuration` export and no `functions` block in `vercel.json`. Runs of about 55 s succeed, so the effective limit is at least 60 s. That is consistent with the platform's fluid-compute default, but it is **not set in the repo**. The R24 export or the Vercel dashboard confirms it.

Two facts for the FR-3.7 copy:
- **(a) Closing the picker does not abandon the request.** The fetch is not aborted. When it resolves, the closed picker's handler still calls `onSelect(url)` and `onClose()` (`components/website/MediaLibraryPicker.tsx:191-205`). Depending on the host, the picture may be **placed in the slot anyway**. Dev verifies this for each host, and BR-3 must not change it (no abort is added).
- **(b) A second paid picture is possible.** If the owner re-generates the **same** description while the first is still running, the reuse check (`GeneratedImageService.ts:315`) finds nothing until the first is recorded (`:434`). The copy should discourage generating again.

**SA-12: image model.** The code fallback and the seed are `gpt-image-1` (`lib/repositories/SystemConfigRepository.ts:47`, `supabase/migrations/20261003_seed_bos_llm_area_settings.sql:111`), and the in-code fallback price table is specific to `gpt-image-1` (`SystemConfigRepository.ts:69-77`). The $0.25 per image measured in R13 matches `gpt-image-1` high quality at 1536x1024. SA could not verify the retirement claim. **Routed to the BOS LLM model-settings owner.** If the model changes, the "about a minute" copy (BR-3) and the prices (model price review flow) both need re-checking. It does not block BR-3.

### §12.3 Required changes (BA applies before the workplans)

| # | Where | Change |
|---|---|---|
| C-1 | FR-1.1, §11 | Name `app/business-os/crm/layout.tsx` (nested provider) as **removed** in BR-1a (SA-1) |
| C-2 | §3.4, AC-1.4 | Rule 2 applies **after mount**, not at the first frame. AC-1.4 becomes: the first frame is English, then Spanish after mount, the backfill writes `es` once, and **the next** cold load is Spanish from the first frame |
| C-3 | AC-1.5 | Split it. (a) The server-side read fails: a unit test of the helper returns `source: 'unknown'` and English. (b) The client `GET` returns 500: no backfill, and localStorage applies after mount (DevTools) |
| C-4 | AC-1.6 | With JavaScript disabled, check the layout **wrapper's** `dir`/`lang` in the server HTML. `<html>` is set by the script and is checked by the filmstrip or the DOM at first paint |
| C-5 | AC-1.10 | Add the case "saved `he`, localStorage `es`, no pin, no business currency → **EUR**, as on main" and the case "saved `he`, no localStorage → **USD**" (SA-6) |
| C-6 | FR-1.4, FR-1.5, AC-1.8, AC-1.9 | Cover **every** `setLanguage` caller: the header menu (`components/business-os/BusinessOSHeader.tsx:183-197`), Settings (`app/business-os/settings/page.tsx:868`) and the onboarding-chat auto-switch (`app/onboarding-chat/page.tsx:473-479`). The retry message must have a home on each |
| C-7 | §3.7 metrics | The BR-1b **gate** is "dictionary bytes transferred per cold load, per language" (DevTools, deterministic), at ≥ 10 kB down **and** exactly one dictionary chunk. The `next build` route table is **informative only**: depending on the SA-3 outcome it can count unrendered client references, or drop all three dictionaries and overstate the gain by one dictionary. Replace "≈ −106 kB for every language" with per-language expectations (`he` is about 10% larger) |
| C-8 | FR-2.1 | "CSS included" becomes "**the library CSS stays a static import**" (SA-7, SA-8) |
| C-9 | FR-2.3, FR-2.4 | State that the PERF-2 placeholder is not reused as-is. A public variant is required (SA-7 item 3) |
| C-10 | AC-2.1, FR-2.8 | Add `/business-os/website` to the routes measured (SA-9). *Superseded 2026-10-14 (BR-2 workplan O-5): the editor does not render the block. The route is reported only, with no gate* |
| C-11 | AC-2.4, BQ-4 | Measure the swap from **hydration** (the page becomes interactive), not first paint. On Fast 3G, hydration alone can take longer than 2 s after first paint, so the AC would fail for reasons unrelated to the slice. Fix the limit after measuring the base commit |
| C-12 | §2 rule 3 | Add **BR-3** to the "kept for its visible benefit" exception beside BR-1a. Its ≤ 1 s metric is an acceptance check, not a §5A.3 speed gain, so under "no measured gain, no merge" it would otherwise be unmergeable. Record it in the scoping document §11.3 as "no speed change, kept for visible benefit" |
| C-13 | FR-3.7, BQ-8 | Rewrite using SA-11: the server finishes and the picture lands in the library, and it may also be placed in the slot (verified per host). Add copy that discourages generating the same picture again while one is running |
| C-14 | §3.7 guard metric, SA-4 | Set the server-response threshold to max(10%, 30 ms) on the median of 10 interleaved runs |

**Applied by the BA on 2026-10-14:** C-1 (FR-1.1, §3.8, §11), C-2 (§3.4, §3.3, AC-1.4), C-3 (AC-1.5), C-4 (AC-1.6), C-5 (AC-1.10), C-6 (FR-1.4, FR-1.5, AC-1.8, AC-1.9), C-7 (§1, §3.3, §3.7 metrics), C-8 (FR-2.1), C-9 (FR-2.3, FR-2.4), C-10 (FR-2.8, AC-2.1, §4.6), C-11 (AC-2.4, BQ-4), C-12 (§2 rule 3, §5.7), C-13 (FR-3.7, BQ-8; plus FR-3.10/AC-3.11 for the new BQ-9), C-14 (§3.7, §3.8).

### §12.4 Slice order

**Confirmed:** BR-2 → BR-3 → BR-1a → BR-1b.
- BR-2 and BR-3 have no new pattern and can be planned in parallel.
- BR-1a goes to workplan once C-1 to C-6 and C-14 are in.
- BR-1b needs the SA-3 spike result recorded here first.
- The order between BR-2 and BR-3 is not load-bearing.

### §12.5 Optimisation suggestions (non-blocking)

- Run the provider's `dir`/`lang` effect as a layout effect, so a soft navigation flips before paint.
- BR-1b removes the dictionaries from every route that imports `LanguageContext` only for `useOptionalLanguage` or `useBusinessTimezone`, such as `/v2/settings` through `DangerZonePanel`. Report those routes as a side gain.

### Approval

[x] Requirement approved with the conditions above. BR-1b's workplan is additionally gated on the SA-3 spike.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created | BA draft covering BR-1 (BIZ-8), BR-2 (BIZ-7) and BR-3 (BIZ-1 progressive option). Code read on the local checkout. Partial image previews assessed as not cost-neutral, so BR-3 specifies honest progress. Eight business questions with defaults, and twelve SA questions |
| 2026-10-13 | SA review | §12 added: APPROVED WITH CHANGES. Rule-7 rulings P-1 to P-4, answers SA-1 to SA-12 grounded on `origin/main` @ `ffb598ac`, 14 required changes (C-1 to C-14), slice order confirmed. BR-1b is gated on a spike. §0 row and status updated |
| 2026-10-14 | User answers + SA changes applied | User accepted all defaults ("defaults, go ahead"): BQ-1 to BQ-8 marked answered with SA-revised wording for BQ-2, BQ-3, BQ-4 and BQ-8, and new BQ-9 added (closing the picker cancels automatic placement) with FR-3.10 and AC-3.11. C-1 to C-14 applied in the sections they target. Double charge on a repeated identical description logged in §8 as a separate fix item (BR-3 only warns). Status set to Approved: ready for workplans |
| 2026-10-14 | SA amendment (BR-2 workplan O-5) | `/business-os/website` taken out of the BR-2 gate: the editor does not render the contact-form block and has no phone library in First Load at base. FR-2.8, AC-2.1, §4.6 metric and C-10 updated; SA note added to AC-2.6 (Send before arrival ends in today's "required" message, nothing sent); §0 row added |
