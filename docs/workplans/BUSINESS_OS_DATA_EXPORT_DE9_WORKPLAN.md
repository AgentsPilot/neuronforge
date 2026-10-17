# Workplan: Business OS Data Export DE-9: One "Download my data" button

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md), the DE-8b version. Binding sections: §0.2 DX-5, §0.4.1 (A, B row DE-9, C, E), §0.7 (DE-4 `too_large`, C-11 body cap, **UI-1**), §0.13 (DE-8b: no env flag, Q-1, C-1, C-7, T-14).
**Built against:** the end state of DE-8b (`feature/data-export-de8b`, worktree `neuronforge-de8b`, uncommitted at the time of writing). The DE-8b routes are read from that worktree.
**Branch:** `feature/data-export-de9` (worktree `neuronforge-de9`, created from `origin/main` `e5bc1e1f`, which is DE-8a. **T-0 below merges `origin/main` again once DE-8b is merged. No stacking on the DE-8b branch.**)
**Date:** 2026-10-17
**Status:** SA code-approved + QA PASS 2026-10-17; committed by RM; MERGE HELD until T-14 recorded

## Overview

DE-9 turns the Phase 1 zip export on for owners. Today four screens have an "Export data" button. All four call the old JSON route through `lib/client/downloadUserDataExport.ts`, and each shows the result in its own style. DE-9 replaces all four with **one shared control**, `DownloadMyDataButton`. It calls the DE-8b zip routes (`POST /api/business-os/data-exports`, then "download again" by `POST …/parts/1/download`) and handles every outcome with clear copy in en / he / es, in **one notification style** (UI-1). It shows "Last export … you can download it again until …". It also retires the JSON route, its 4 MB cap (SA DE-8b Q-1) and the old browser helper.

There is no env flag (SA DE-8b ruling): **merging DE-9 is the owner-facing switch**. So **T-14 (the Preview check DE-8b owes) is a hard T-0 gate.** No button switches until it is recorded.

**Cycle:** full cycle. The slice is mostly UI, but it changes which data path every export button uses, adds a read route and deletes a route. The Data Export fast-track still applies after SA approval and QA pass (RM commit, PR and auto-merge, no wait for the user's diff review). Business calls in §10 and the T-0 gate are stops.

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [T-0 gates](#2-t-0-gates)
3. [Implementation approach](#3-implementation-approach)
4. [Outcome table (every response, what the owner sees)](#4-outcome-table)
5. [Files to create / modify / delete](#5-files-to-create--modify--delete)
6. [Tests](#6-tests)
7. [CI time](#7-ci-time)
8. [Task list](#8-task-list)
9. [Risks](#9-risks)
10. [Business calls (separate; TL applies defaults)](#10-business-calls)
11. [Open questions for SA](#11-open-questions-for-sa)
12. [Requirement splice](#12-requirement-splice)

---

## 1. Analysis summary

### 1.1 What DE-8b gives DE-9 (read from `neuronforge-de8b`)

| Route | Answers DE-9 must handle |
|---|---|
| `POST /api/business-os/data-exports` (strict empty body, `maxDuration = 60`, throttle `create` 10 / 900 s) | **200** `{ data: { jobId, downloadUrl (120 s), fileName, asciiFileName, expiresAt, failedSections[], missingFiles } }` · **401** · **400** · **429** (`tooManyRequests`, `Retry-After`, body has no `code`) · **409** `export_in_progress` / `export_daily_limit` + `retryAt` · **413** `export_too_large` · **503** `export_timeout` · **500** `export_ready_sign_failed` + `jobId` (job stays `ready`, SA C-1) · **500** `export_failed` · **500** no code (unexpected). The platform can also answer **504** with a non-JSON body if the function is killed at 60 s |
| `POST /api/business-os/data-exports/[jobId]/parts/1/download` (strict empty body, throttle `read`) | **200** `{ data: { downloadUrl, fileName, asciiFileName, expiresAt } }` · **401** · **400** · **404** (missing or another account's id) · **410** `export_expired` · **429** · **500** |
| **No status route** | SA DE-8b Q-14: DE-9 adds it with the button |

`BusinessOsDataExportJobRepository` already has `findLatestForUser` (any status, so the newest row may be a failed one) and `listForUser` (max 20). Neither answers "the newest **successful** export" without a status filter. A new export expires the older ready one (`expireOtherReady`), so at most one job is `ready` at a time.

### 1.2 The four entry points today

| # | File | Surface | Copy system | Message style today |
|---|---|---|---|---|
| E1 | `app/business-os/settings/page.tsx` (`handleExportData` ≈ L524, row ≈ L1180) | `/business-os/settings`, the Security list | `useLanguage()` (inside `LanguageProvider`) | Page-level green / red banner with icon (L777–790); success clears after 3 s |
| E2 | `components/business-os/purge/DangerZonePanel.tsx` (`ErasureRequestContent`) | The Danger zone: in a dialog on `/business-os/settings`, boxed on `/v2/settings` and `/settings` | `useOptionalLanguage()` + `FALLBACK_COPY` (English outside the provider) | Grey `text-xs` `role="status"` line |
| E3 | `components/settings/SecurityTab.tsx` | `/settings` (agent-platform app, parked) | Hard-coded English | Emerald / red banner at the foot of the tab |
| E4 | `components/v2/settings/SecurityTabV2.tsx` | `/v2/settings` (agent-platform app, parked) | Hard-coded English | `--v2-success-*` / `--v2-error-*` banner at the foot of the tab |

E3 and E4 **also render `DangerZonePanel`**, so E2's button already appears on the agent-platform screens. If E3 and E4 kept the JSON export, those screens would offer **two different exports**. See BC-1.

### 1.3 Notification styles in the codebase (input to UI-1)

- `sonner`: one `<Toaster richColors position="top-center" />` in `components/PlatformShell.tsx`, mounted on every non-public page (Business OS and `/v2` included). Only **one** Business OS file uses it (`components/business-os/insight/NeedsYouCard.tsx`). No `/v2` or settings file does. The Toaster gets no `dir`.
- Inline banners: E1 (Tailwind green / red), E4 (`--v2-success-*` / `--v2-error-*` tokens, light and dark, loaded by `v2-theme-tokens.css` in both `app/business-os/layout.tsx` and `app/v2/layout.tsx`).
- Inline `role="status"` / `role="alert"` lines: the recent settings drawers (Phase A/B: `ChangePasswordDrawer`, `MarketingConsentPanel`, `PlanSection`, `InviteFriendsSection`).
- No shared Alert / Notice primitive exists in `components/ui/`.

### 1.4 What the JSON route still owns (for its retirement)

- `app/api/user/data-export/route.ts` + `__tests__/route.test.ts` (35 tests) + `__tests__/route.characterization.test.ts` (24 tests).
- `lib/client/downloadUserDataExport.ts` + `lib/client/__tests__/downloadUserDataExport.test.ts`.
- Symbols used only by the JSON route: `EXPORT_LIMITS.JSON_BODY_MAX_BYTES` (also pinned in `sections.test.ts` L411), `exportFileName` (the `.json` name) and `EXPORT_GDPR_ARTICLE` in `payload.ts`. **`buildExportPayload`, `sectionCounts`, `failedSections`, `FILE_INDEX_COLUMNS` stay**: the zip builder uses them for `data.json`.
- References to update: `package.json` `test:bos-entitlements` (lists `app/api/user/data-export/__tests__`), the comment in `.github/workflows/bos-entitlements.yml` L22, the `EXPORT_SCREENS` guard in `lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts` (it asserts `downloadUserDataExport()` in each handler), comments in `lib/audit/ownerVisibility.ts`, `lib/audit/ownerEventPresentation.ts`, `lib/repositories/UserProfileRepository.ts` L469, `lib/business-os/data-export/payload.ts` L3, `ownerClock.ts` L4.
- `AUDIT_EVENTS.DATA_EXPORTED` **stays** as a constant: historical rows carry it, and the owner audit view reads them.

---

## 2. T-0 gates

No code is written before T-0a, and no entry point is switched (T-6 … T-9) before T-0b.

| Gate | What | Who | If it fails |
|---|---|---|---|
| **T-0a** | DE-8b is merged to `main`. Then `git -C neuronforge-de9 merge origin/main` (no rebase, no stash) and `git diff --stat origin/main` shows nothing but this workplan | Dev | Wait. DE-9 is not stacked on the DE-8b branch |
| **T-0b (T-14 recorded)** | The DE-8b workplan holds the T-14 Preview result: Hebrew, English and no-business accounts; the `Content-Disposition` Storage sends for a Hebrew name; the zip opened in Windows Explorer and macOS Archive Utility; a CSV opened in Excel. Dev copies the verdict into §3.2 below | TL (owed by DE-8b) | **Stop.** If T-14 shows a wrong `filename*`, DE-8b's §11 fallback applies first (URL signed with `download: asciiFileName`, a DE-8b fix PR), and DE-9 adds the fetch-and-blob save (§3.2, mode B, about +0.5 d) |
| **T-0c** | `business-os-schema-check` for `business_os_data_exports` (columns of `DATA_EXPORT_JOB_COLUMNS`, the `status` check constraint) on prod, read-only | Dev / TL | Stop and report |
| **T-0d** | The G7 floors in `.github/ci/jest-quarantine.json` (800 suites / 15,500 tests): read the margin on the last main run. DE-9 deletes 3 suites (≈ 59 + helper tests) and adds ≈ 6 suites | Dev | If the margin is under the net loss, raise it with SA before deleting (floors are never lowered without SA) |

---

## 3. Implementation approach

### 3.1 Server: one read route for "Last export"

**`GET /api/business-os/data-exports`**, added to the existing `route.ts` (the same resource; `new-api-route` skill).

- `getUser()` → 401. There is no input. Query parameters are **ignored**, and the only id is the session's (a `?userId=` is pinned as ignored). Throttle `read` under the key `data-export-status`.
- `businessOsDataExportJobRepository.findLatestCompletedForUser(user.id)`: **new method**. `.eq('user_id', userId)`, `.in('status', ['ready', 'expired'])`, `order created_at desc`, `limit 1`, explicit `DATA_EXPORT_JOB_COLUMNS`. It follows the existing class conventions (uuid check, `toError`, `RepositoryResult`), with unit tests per the `new-repository` skill. A `failed` job is never "the last export". It was not delivered, and it does not count against the limit.
- Answer (no-store):
  ```json
  { "success": true, "data": { "lastExport": null } }
  { "success": true, "data": { "lastExport": { "createdAt": "…", "downloadable": { "jobId": "…", "expiresAt": "…" } } } }
  { "success": true, "data": { "lastExport": { "createdAt": "…", "downloadable": null } } }
  ```
  `downloadable` is set only when `status = 'ready'` and `expires_at > now()`. Otherwise no `jobId` leaves the server. No byte, row or file counts are sent (the UI does not need them).
- No audit. It is a read of the owner's own status, and the owner already sees `DATA_EXPORT_*` rows. Pino at `debug` with ids only. Errors: 500 without detail outside development.
- Why a route and not a field on the settings page load: the control is mounted on three surfaces (E2 boxed on `/v2` and `/settings` too). One small route serves all of them, and it is the shape Phase 2's export page will read.

### 3.2 Client: one helper module (replaces `downloadUserDataExport.ts`)

**`lib/client/businessOsDataExport.ts`.** It holds pure `fetch` functions. Each returns a **verdict** and never throws, the same contract as today's helper.

| Function | Calls | Verdict |
|---|---|---|
| `startDataExport()` | `POST /api/business-os/data-exports`, body `{}`, `credentials: 'same-origin'`, `cache: 'no-store'`, `AbortSignal.timeout(75_000)` | `{ kind: 'ready', jobId, downloadUrl, fileName, asciiFileName, expiresAt, partial: boolean }` or `{ kind: 'refused', code }` (see §4). `partial` = `failedSections.length > 0 \|\| missingFiles > 0` |
| `downloadDataExportAgain(jobId)` | `POST …/{jobId}/parts/1/download`, body `{}` | `{ kind: 'ready', … }` or `{ kind: 'refused', code }` |
| `fetchLastDataExport()` | `GET /api/business-os/data-exports` | `{ kind: 'ok', lastExport }` or `{ kind: 'unavailable' }` |
| `saveSignedDownload(verdict)` | Hands the browser the file (below) | `void` |

Codes are read **from the body `code`**, never from the status alone (the DE-4 rule for `too_large`). They are mapped one to one: `in_progress`, `daily_limit` (+ `retryAt`), `too_large`, `timeout`, `ready_sign_failed` (+ `jobId`), `expired`, `not_found`, `throttled`, `unauthorized`, `network`, `client_timeout`, `failed`. A non-JSON body (a platform 504 or 502) maps to `timeout`. An `AbortError` from the 75 s timer maps to `client_timeout`.

**Saving the file.** The browser never receives the zip from our function, only the URL. The Vercel 4.5 MB response cap therefore does not apply.

- **Mode A (default, if T-14 passed):** `window.location.assign(downloadUrl)`. Storage answers with `Content-Disposition: attachment`, so the page stays put and the browser saves the file under the name Storage sends. This is a same-tab navigation, so no popup blocker applies. The call sits behind a one-line module seam so jsdom tests can assert it.
- **Mode B (only if T-14 failed):** `fetch(downloadUrl)` → `blob()` → object URL → `<a download={fileName}>` with the Unicode name from the 200 body. The same pattern as today's helper, bounded by the 45 MB zip ceiling. If Mode B is needed, T-0b records it, and `EXPORT_SAVE_MODE` is a constant in the module, not an env flag.
- **T-14 verdict:** _NOT YET RECORDED (2026-10-17)._ Built in Mode A only (SA Q9). The PR must not merge until TL records T-14. If T-14 fails, Mode A is replaced by Mode B (+0.5 d).

### 3.3 The state machine: `useDownloadMyData`

**`components/business-os/data-export/useDownloadMyData.ts`.** A hook in its own file, so the logic is tested apart from the markup.

States: `idle` → `preparing` → (`downloading` → `done`) | `refused(code)`. In parallel it holds `lastExport` (from the status route, loaded on mount and reloaded after every outcome).

- **Double-click guard:** a `useRef` in-flight flag checked synchronously at the top of `prepare()` and `downloadAgain()`, plus `disabled` and `aria-busy` on the buttons. React state alone is not enough, because two clicks within one render both see `idle`.
- **Unmount while preparing** (the Danger zone dialog is closed, for example): the request is **not** aborted, because the server keeps building and on 200 records the export as handed over (DE-8b BC-6). The hook keeps the promise. On 200 it still calls `saveSignedDownload`, since the owner asked for the file, and it skips every `setState` once unmounted. See SA-Q4.
- **After a refusal of `daily_limit`, `in_progress`, `ready_sign_failed`, `client_timeout` or `expired`:** reload `lastExport`, so that "Download again" appears or disappears as the server now says.
- **Download again** uses `lastExport.downloadable.jobId`. The jobId comes only from our own status route, never from the URL or user input.

### 3.4 The control: `DownloadMyDataButton`

**`components/business-os/data-export/DownloadMyDataButton.tsx`** (`'use client'`). It is the one control, with two presentations that share the same hook, copy and notice:

| `variant` | Used by | Looks like |
|---|---|---|
| `row` | E1 (Business OS settings list) | Today's row: `Download` icon, label, chevron; a spinner while preparing. Under it, the status line and the notice |
| `button` | E2 (Danger zone), E3, E4 | A bordered button in `--v2-*` tokens (today's Danger zone button). E3 / E4's gradient "Export Data" button and their message banners go away (BC-1) |

Below the main action, always in the same order:

1. **Status line** (`text-xs`, muted): "Last export {date}. You can download it again until {until}." followed by a **"Download again"** text button. If the last export has expired: "Last export {date}." If the status route is unavailable, there is no line (a `warn` log only, never an error message about the status).
2. **Notice** (§3.5) for the current outcome.

Dates are formatted with `Intl.DateTimeFormat(language, timeZoneOptions({ dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }))` via `useBusinessTimezone()`. That is the owner's clock (`user_preferences.timezone`) inside the provider, and an explicit UTC outside it. `timeZoneName` makes the UTC fallback visible on `/v2` and `/settings` instead of looking local. The language comes from `useOptionalLanguage()?.language ?? 'en'`. RTL follows `isRTL` (logical `ms-` / `me-` classes, no `flex-row-reverse` hacks).

### 3.5 UI-1: one notification standard (SA picks; Dev default A)

| Option | What | For | Against |
|---|---|---|---|
| **A (Dev default): inline notice inside the control** | One small `DataExportNotice` in the control's folder: icon + text + optional action + dismiss ✕. Tones `success` / `error` / `info` on the existing `--v2-success-*` / `--v2-error-*` tokens (light and dark already defined, loaded on Business OS and `/v2`; `var(--v2-…, <hex>)` fallbacks for `/settings`), the same visual as E4 / E1's banners. `role="status"` (polite) for success / info, `role="alert"` for errors | Identical on every surface, because it lives in the control. It sits next to the button the owner pressed, and it still works inside the Danger zone dialog, where a page banner is hidden behind the dialog. It persists, which the "contact support" message with its email link and the "next export from {time}" message need. RTL comes from the provider. No new dependency and no host to mount | Not app-wide. If SA later standardises a shared `components/ui` Notice, this one moves there (small) |
| B: `sonner` toasts | `toast.success` / `toast.error` | The only app-wide host. Already mounted | Used by 1 Business OS file, so not the de-facto standard. Auto-dismisses (4 s), so a support email or a retry time disappears. Top-centre, far from a dialog's button. No `dir` on the Toaster, so Hebrew is left-aligned. A long message with a link needs `duration: Infinity` + `action`. Harder for screen-reader users to return to |
| C: hybrid | Toast for success, inline for errors and limits | Light success feedback | Two styles for one control: exactly what UI-1 is removing |

Whatever SA picks, E1's page-level banner stops carrying export messages (it keeps every other settings message), and E2's grey `text-xs` line is removed.

### 3.6 Copy (en; he and es written in the same module, drafts for native review)

**`components/business-os/data-export/downloadMyDataCopy.ts`.** Pure data, typed `Record<'en'|'he'|'es', DownloadMyDataCopy>`, following `inviteFriendsCopy.ts`. It is not added to the 4,000-line dictionaries, and it does not need `FALLBACK_COPY`. It works outside the provider because the locale defaults to `en`. The type makes a missing language a compile error. Numbers and dates are interpolated, never typed into a sentence (`{limit}` from `EXPORT_JOB_POLICY.DAILY_LIMIT`).

| Key | en |
|---|---|
| `label` | Download my data |
| `preparing` | Preparing your export. This can take up to a minute. Please keep this page open. |
| `started` | Your download has started. You can download it again until {until}. |
| `partial` | Some items could not be included. The README file in the download lists them. |
| `lastExport` | Last export {date}. You can download it again until {until}. |
| `lastExportExpired` | Last export {date}. |
| `downloadAgain` | Download again |
| `inProgress` | An export is already being prepared. Please try again in a minute. |
| `dailyLimit` | You can prepare {limit} exports in 24 hours. You can prepare the next one from {time}. |
| `tooLarge` | Your account holds more than the on-screen download can package, so nothing was downloaded. Please contact support at {email} and we will prepare your export for you. |
| `timeout` | We could not prepare your export in time. Nothing was downloaded. Please try again. |
| `clientTimeout` | This is taking longer than expected. If your export finishes, "Download again" will appear here. Please check back in a minute. |
| `signFailed` | Your export is ready, but the download link could not be made. Please use "Download again". |
| `expired` | This export is no longer available. Use "Download my data" to prepare a new one. |
| `throttled` | Too many attempts. Please wait a few minutes and try again. |
| `unauthorized` | Your session has ended. Please sign in again and retry. |
| `network` | We could not reach the server. Check your connection and try again. |
| `failed` | We could not prepare your export. Nothing was downloaded. Please try again. |
| `dismiss` | Dismiss |

`tooLarge` deliberately does **not** name "40 MB of files or 150 files". The server's sentence names files only, but a refusal can also be over 100,000 rows (DE-8b QA edge note 4). The client always shows its own copy and never the server's `error` string. `{email}` is rendered as a `mailto:` link to the support contact (BC-3).

### 3.7 Wiring the four entry points

| Entry | Change |
|---|---|
| E1 `app/business-os/settings/page.tsx` | The Export row → `<DownloadMyDataButton variant="row" />`. Remove `handleExportData`, `exporting`, and the `downloadUserDataExport` import. The page's `successMessage` / `errorMessage` banner stays for its other messages. Settings-page keys `settings.security.export_data`, `_desc`, `_button`, `_success`, `_error` are removed from en/he/es if nothing else reads them (grep at the time) |
| E2 `DangerZonePanel.tsx` `ErasureRequestContent` | The export button + status line → `<DownloadMyDataButton variant="button" />`, beside the unchanged "Contact us" mailto. Remove `isExporting`, `exportOutcome`, `handleExport`, the three `export_*` keys in `FALLBACK_COPY` (and the matching `DangerZonePanel.test.ts` pins). Update the hint, if needed, to name the button: "We recommend downloading your data first. Erasure cannot be undone." |
| E3 `components/settings/SecurityTab.tsx` | BC-1 default: the "Export Account Data" card's button → `<DownloadMyDataButton variant="button" />`. Remove `handleExportData` and the helper import. Card title becomes "Download my data" |
| E4 `components/v2/settings/SecurityTabV2.tsx` | As E3 |

E3 and E4 are in the parked agent-platform app. Per the user's standing preference, the user is **not** asked to click through them. They are covered by RTL render tests and QA's source review.

**`console.*` check (CLAUDE.md § Logging):** at T-1, Dev counts `console.` in each of the five touched files and reports any hit to TL (flag → propose → convert). From reading so far, all four use `clientLogger` / `logger` already. To be confirmed by grep.

### 3.8 Retiring the JSON export (BC-2 default: retire)

After T-6 … T-9 (no caller left):

1. Delete `app/api/user/data-export/route.ts` and its `__tests__/` (both files). Default **delete (404)**, not a 410 tombstone. The only callers were our own four buttons, and a stale tab running old JS gets the old helper's generic error. See SA-Q2.
2. Delete `lib/client/downloadUserDataExport.ts` and its test.
3. `limits.ts`: remove `JSON_BODY_MAX_BYTES` and its comment (SA DE-8b Q-1 / C-11 done). Update `sections.test.ts` L411. `payload.ts`: remove `exportFileName` and `EXPORT_GDPR_ARTICLE` **only if** grep shows no other user (the `gdpr_article` field in `data.json` meta keeps its literal if the zip writes it; Dev checks `buildExportPayload` before removing). Fix the header comment ("the typed body of GET /api/user/data-export" → "the typed `data.json` of the zip").
4. `package.json` `test:bos-entitlements`: drop `app/api/user/data-export/__tests__`. Add `app/api/business-os/data-exports/__tests__` **only if** SA wants the audit-registry coverage there (SA-Q6). Update the comment in `bos-entitlements.yml`.
5. Comments that name the old route: `ownerVisibility.ts`, `ownerEventPresentation.ts`, `UserProfileRepository.ts`, `ownerClock.ts` (comment only, no behaviour).
6. Repository methods that existed only for the JSON route: grep `ForUserDataExport` after the deletion. Any method that is still only reached from the deleted route is removed with its tests. A method the zip builder reaches stays.
7. `AUDIT_EVENTS.DATA_EXPORTED` stays (history). The requirement's FR-E15 / AC-E22 wording ("every export writes `DATA_EXPORTED`", "Last exported from the latest `DATA_EXPORTED`") is superseded: `DATA_EXPORT_READY` / the jobs table (§12).

### 3.9 Accessibility

- One live region per control that **exists before** its content changes (an empty `role="status" aria-live="polite"` container rendered from the first paint). Errors render in a `role="alert"` element.
- `preparing` is announced once ("Preparing your export…"). The spinner is `aria-hidden`. The button carries `aria-busy="true"` and `disabled`, and its accessible name stays "Download my data".
- Focus is never moved. The dismiss ✕ has an `aria-label` (`dismiss`). The `mailto:` link and "Download again" are real `<a>` / `<button>` elements reachable by Tab.
- The notice is not colour-only: each tone has its icon (`CheckCircle`, `AlertCircle`, `Info`, all `aria-hidden`), and the text says what happened.

---

## 4. Outcome table

| Server answer | Verdict code | Tone | Copy key | Then |
|---|---|---|---|---|
| start 200 | `ready` | success | `started` (+ `partial` if any failed section or missing file) | `saveSignedDownload`, reload status |
| start 409 `export_in_progress` | `in_progress` | info | `inProgress` | reload status |
| start 409 `export_daily_limit` | `daily_limit` | info | `dailyLimit` with `{time}` = `retryAt` on the owner's clock | reload status ("Download again" if an export is still ready) |
| start 413 `export_too_large` | `too_large` | error | `tooLarge` + support `mailto:` | none |
| start 503 `export_timeout`, a 502 / 504, or non-JSON | `timeout` | error | `timeout` | none |
| client 75 s abort | `client_timeout` | info | `clientTimeout` | reload status after 30 s once |
| start 500 `export_ready_sign_failed` | `ready_sign_failed` | error | `signFailed` | reload status. "Download again" appears |
| start 500 `export_failed` / no code | `failed` | error | `failed` | none |
| any 429 | `throttled` | error | `throttled` | none |
| any 401 | `unauthorized` | error | `unauthorized` | none (no redirect: the screens own their own sign-in handling) |
| fetch rejects | `network` | error | `network` | none |
| again 200 | `ready` | success | `started` | `saveSignedDownload` |
| again 410 `export_expired` / 404 | `expired` | info | `expired` | reload status. "Download again" disappears |
| again 500 | `failed` | error | `failed` | none |
| status GET fails | `unavailable` | none | (no status line) | `warn` log |

A 400 can only come from a bug in our own client, so it maps to `failed` and is logged at `error`.

---

## 5. Files to create / modify / delete

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/data-exports/route.ts` | modify | Add `GET` (§3.1) |
| `app/api/business-os/data-exports/__tests__/route.get.test.ts` | create | 200 ×3 shapes, 401, ignored `?userId=`, 429, 500 without detail |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | modify | `findLatestCompletedForUser` |
| `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` | modify | Method tests: `.eq('user_id')` first, `.in` status filter, bad uuid, error path |
| `lib/client/businessOsDataExport.ts` | create | Verdict helpers + `saveSignedDownload` |
| `lib/client/__tests__/businessOsDataExport.test.ts` | create | Every row of §4 at helper level, non-JSON body, abort |
| `components/business-os/data-export/useDownloadMyData.ts` | create | State machine (§3.3) |
| `components/business-os/data-export/DownloadMyDataButton.tsx` | create | The control (§3.4) |
| `components/business-os/data-export/DataExportNotice.tsx` | create (Option A) | The notice (§3.5) |
| `components/business-os/data-export/downloadMyDataCopy.ts` | create | en/he/es copy (§3.6) |
| `components/business-os/data-export/__tests__/DownloadMyDataButton.test.tsx` | create | RTL feature tests (§6) |
| `components/business-os/data-export/__tests__/downloadMyDataCopy.test.ts` | create | Copy parity |
| `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` | create | Source guards (§6.3) |
| `app/business-os/settings/page.tsx` | modify | E1 |
| `components/business-os/purge/DangerZonePanel.tsx` | modify | E2 |
| `components/business-os/purge/__tests__/DangerZonePanel.export.test.tsx` | modify | Now asserts the shared control is rendered inside `ErasureRequestContent` (no own fetch) |
| `components/business-os/purge/__tests__/DangerZonePanel.test.ts` | modify | Drop the 3 export fallback keys from its pinned set |
| `components/settings/SecurityTab.tsx` | modify | E3 (BC-1) |
| `components/v2/settings/SecurityTabV2.tsx` | modify | E4 (BC-1) |
| `lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts` | modify | `EXPORT_SCREENS`: the screen renders `DownloadMyDataButton` and reads no table; the old `downloadUserDataExport()` expectation goes |
| `lib/business-os/translations/{en,he,es}.ts` | modify | Remove the dead `settings.security.export_*` keys (only if unused) |
| `app/api/user/data-export/route.ts` + `__tests__/*` | **delete** | BC-2 |
| `lib/client/downloadUserDataExport.ts` + test | **delete** | BC-2 |
| `lib/business-os/data-export/limits.ts`, `payload.ts`, `__tests__/sections.test.ts` | modify | Remove `JSON_BODY_MAX_BYTES` (C-11) and JSON-only symbols |
| `package.json`, `.github/workflows/bos-entitlements.yml` | modify | Script path + comment |
| `lib/audit/ownerVisibility.ts`, `lib/audit/ownerEventPresentation.ts`, `lib/repositories/UserProfileRepository.ts`, `lib/business-os/data-export/ownerClock.ts` | modify | Comments only |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | §0.14 splice (§12), Change History |

No migration. No new dependency. No entitlements import. No new bucket or table, so no export classification change.

---

## 6. Tests

### 6.1 Feature tests (React Testing Library, `@jest-environment jsdom`)

`DownloadMyDataButton.test.tsx` mocks `@/lib/client/businessOsDataExport` (the network seam) and renders each variant, once inside a `LanguageProvider` stub (he, RTL) and once without (en). One test per §4 row, each asserting the visible text, the role (`status` vs `alert`), and what happens next:

| # | Case | Asserts |
|---|---|---|
| F-1 | Mount, no last export | No status line. Button enabled |
| F-2 | Mount, ready export | "Last export … until …" in the owner's zone (`Asia/Jerusalem` stub) + "Download again" |
| F-3 | Mount, expired export | "Last export …", no "Download again" |
| F-4 | Click → 200 | `preparing` announced, `aria-busy`, disabled; then `started`, `saveSignedDownload` called once with the URL; status reloaded |
| F-5 | 200 with `missingFiles: 2` | `started` + `partial` |
| F-6 | Double click / two clicks in one tick | `startDataExport` called **once** |
| F-7 | 409 in progress | `inProgress`, `role="status"` |
| F-8 | 409 daily limit | `dailyLimit` with `{limit}` = 3 and the formatted `retryAt`; status reloaded |
| F-9 | 413 | `tooLarge` in `role="alert"`, a `mailto:` link to the support contact, no `saveSignedDownload` |
| F-10 | 503 / 504 non-JSON | `timeout` |
| F-11 | client timeout | `clientTimeout`; status reloaded (fake timers, a fixed advance, no `advanceTimers: true` (CI flake pattern #399)) |
| F-12 | 500 sign failed | `signFailed`; "Download again" appears after the reload |
| F-13 | 500 failed / 429 / 401 / network | One assertion each on the copy |
| F-14 | Download again → 200 | `downloadDataExportAgain` called with the status route's jobId; `saveSignedDownload` |
| F-15 | Download again → 410 | `expired`; "Download again" removed |
| F-16 | Status GET unavailable | No status line, no error notice |
| F-17 | Unmount while preparing, then 200 | No React state-update warning; `saveSignedDownload` still called (SA-Q4 default) |
| F-18 | Dismiss ✕ | The notice is removed; the live region stays mounted |
| F-19 | Hebrew | `dir` inherited, he copy shown, digits and time formatted with `he` |

Entry-point render tests (one each, the control mocked as a marker): E1's Security list, `ErasureRequestContent`, `SecurityTab`, `SecurityTabV2` each render exactly one `DownloadMyDataButton`, and none renders its own export message.

### 6.2 Route and repository

- `route.get.test.ts`: happy (three shapes, `downloadable` only when ready and not past `expires_at`), 401, `?userId=<other>` ignored (the repository is called with the session id), 429, repository error → 500 with no detail in production. Mocked repository, the same harness as DE-8b's `route.test.ts`.
- Repository: as §5.

### 6.3 Source guards (`oneExportControl.guard.test.ts`)

Pure file reads, CRLF-safe (`/\r?\n/`; the #394 pattern), each with a negative control:

1. No file under `app/`, `components/`, `lib/`, `hooks/` (tests excluded) names `/api/user/data-export` or imports `downloadUserDataExport`.
2. `app/api/user/data-export/route.ts` and `lib/client/downloadUserDataExport.ts` do not exist.
3. Each of the four entry files imports `DownloadMyDataButton` and contains no `fetch(` to a data-export path and no `export_success` / `export_error` key.
4. Only `lib/client/businessOsDataExport.ts` names `/api/business-os/data-exports` outside `app/api/` (one client seam).
5. `EXPORT_LIMITS` has no `JSON_BODY_MAX_BYTES`.

### 6.4 Copy parity (`downloadMyDataCopy.test.ts`)

Every key is non-empty in en, he and es. he and es differ from en. Placeholders match (the `settingsDrawerCopy.test.ts` pattern). `tooLarge` contains `{email}` and does not contain "150" or "40 MB" (QA edge note 4).

---

## 7. CI time

All new tests are Jest in the existing required gate (`test:gate`, which already collects `components/**` jsdom suites). No new job, no new workflow, no new step. DE-9 **removes** about 59 route tests and the old helper's tests, and adds about 60 light jsdom and unit tests, so net time is about flat. `test:bos-entitlements` loses one folder (shorter). Measured on the PR run against the last main run, recorded by QA (AC-E13).

---

## 8. Task list

- [x] ✅ **T-0a** DE-8b merged (`4e10ebba`); `git merge origin/main` fast-forwarded; diff was only this workplan
- [ ] ⬜ **T-0b** T-14 verdict **NOT recorded** (owed by TL). Mode A built; merge gate
- [x] ✅ **T-0c** TL, 16 columns incl. `requested_by_kind` (see below)
- [x] ✅ **T-0d** last main run (`4e10ebba`, Tests run 39028164755): suites 1,506 vs 800 (margin 706), tests 38,303 vs 15,500 (margin 22,803). DE-9 net about −110 tests: well inside
- [x] ✅ **T-1** 0 `console.*` in all 12 touched non-test files
- [x] ✅ **T-2** `findLatestCompletedForUser` (+ C-4 `requested_by_kind = 'owner'`) + 4 tests incl. a filtering fake and negative control
- [x] ✅ **T-3** GET + `route.get.test.ts` (11 tests)
- [x] ✅ **T-4** seam + 24 tests (Mode A; C-5 timer; C-6 https-only)
- [x] ✅ **T-5** copy + parity (C-10), `formatExportTime` (C-1), hook, `DataExportNotice` (A), control; F-1 … F-19
- [x] ✅ **T-6** E2 (C-8); contact constant moved (C-3); N2 pin repo-wide
- [x] ✅ **T-7** E1 + render test
- [x] ✅ **T-8** E3 + render test
- [x] ✅ **T-9** E4 + render test
- [x] ✅ **T-10** retired per C-7 (grep-proven); `EXPORT_GDPR_ARTICLE` and `findForUserDataExport` kept
- [x] ✅ **T-11** `oneExportControl.guard.test.ts` (5 checks + negative controls); plugin guard and C-2 owner-read guard re-pointed
- [x] ✅ **T-12** tsc (touched files: 0 new errors), eslint (0 errors), lint:hooks, test:bos-entitlements, test:authz-guard, full gate, numstat
- [ ] ⬜ **T-13** Manual on Preview (Dev, Business OS only), after deploy: en and he account, the row and the Danger zone dialog; one real export downloads; "Download again"; a 4th export in 24 h shows the limit message with a time. Not asked of the user on `/v2` or `/settings`
- [x] ✅ **T-14** Requirement §0.14 + in-place notes + Change History; status → Code Complete

**Effort:** 🟡 about **2 days** (status route + repo 0.25 d; helper 0.25 d; hook + control + notice + copy 0.75 d; four entry points 0.25 d; retirement + guards 0.5 d). **+0.5 d** if T-14 forces Mode B. The requirement's "~1 d" pre-dates the status route (SA Q-14), UI-1, and the retirement work moved here by SA Q-1.

---

## 9. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | T-14 fails (Hebrew name mangled) | Medium / low | T-0b gate; DE-8b ASCII fallback + Mode B |
| R-2 | The owner closes the dialog or tab while preparing; the export is built and marked handed over, but they never got the file | Low / low | The status line offers "Download again" for 3 days; SA-Q4 |
| R-3 | Two instances on one screen (`/v2`: the card and the expanded Danger zone) do not share state | Low / low | The server limit (409 in progress) is the authority; each instance reloads status after any outcome. No shared context (would be a new pattern) |
| R-4 | 120 s URL used late (e.g. Mode B on a slow link) | Low / low | Used immediately on 200; an expired URL is fixed by "Download again" |
| R-5 | Agent-platform users without a business now get a zip (profile only, fallback file name) instead of a JSON file | Certain / low | BQ-SA-1 already removed agents from the file, so the content is the same. BC-1 |
| R-6 | G7 test floor margin too thin for the deletion | Low / medium | T-0d |
| R-7 | A deleted file still imported somewhere (build break) | Low / high | Guard 6.3-1/2, `tsc`, the required build check |

---

## 10. Business calls

Separate from the SA questions. TL applies the defaults (autonomous run authorised). The user may change any of them.

| # | Question (business terms) | TL default 2026-10-17 (user may change) |
|---|---|---|
| **BC-1** | The agent-platform settings screens (`/settings`, `/v2/settings`) have their own "Export Account Data" card, and their Danger zone already shows the new button. What should the card do? (a) the same "Download my data" button (zip; for a user with no business it holds their profile only); (b) a link sending them to Business OS settings; (c) keep the old JSON file | **(a) the same button.** One export everywhere; (c) would leave two different exports on one screen; (b) sends people without a business to a screen that may not apply to them |
| **BC-2** | Retire the old JSON download, now that nothing uses it? | **Yes, retire it** (route, browser helper, its 4 MB limit) |
| **BC-3** | The "too large, contact support" message names an email. Which? | **The same contact the Danger zone already uses** (`PLACEHOLDER_ERASURE_CONTACT`, today the owner's personal address, already flagged for replacement), so there is one place to swap it |
| **BC-4** | If the owner already has an export ready (under 3 days old), does "Download my data" make a fresh one (counts toward the 3 a day and replaces the old one) or hand over the existing one? | **Fresh one.** The data may have changed. "Download again" sits right below for the existing one |
| **BC-5** | Button name | **"Download my data"** (DX-5), in he / es to match. The old "Export Data" labels go |
| **BC-6** | A short "what's included" line under the button? | **No.** The README inside the zip explains it. Keeps the settings row clean |

---

## 11. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| **SA-Q1** | **UI-1: the notification standard** (§3.5). A inline notice in the control (default), B `sonner`, C hybrid? And should the notice be a shared `components/ui` primitive now (rule 7), or stay in the control's folder until a second user appears? | **A**, in the control's folder |
| **SA-Q2** | JSON route: delete (404) or a 410 tombstone like `delete-account`? | Delete; only our own buttons called it |
| **SA-Q3** | Status route: `GET` on the existing `route.ts` with a new `findLatestCompletedForUser` (vs. filtering `listForUser(20)` in the route, which can miss the ready job behind many failures) | New method |
| **SA-Q4** | Unmount while preparing: keep the request and still save the file on 200 (default), or abort and rely on "Download again"? Aborting does not stop the server, which marks the export handed over (DE-8b BC-6) | Keep and save |
| **SA-Q5** | Client timeout at 75 s (above the 60 s `maxDuration`, so only a hung connection trips it) | 75 s |
| **SA-Q6** | `test:bos-entitlements`: drop the deleted folder; add `app/api/business-os/data-exports/__tests__`? (the audit-registry coverage the old folder gave that job) | Drop only; the new route tests run in the Jest gate |
| **SA-Q7** | Owner audit labels (`OWNER_EVENT_LABELS`) for `DATA_EXPORT_REQUESTED` / `READY` / `FAILED` / `DOWNLOADED` / `EXPIRED` (SA DE-8b Q-8 "DE-9 may add labels") | Out of DE-9; follow-up |
| **SA-Q8** | Remove `exportFileName` / `EXPORT_GDPR_ARTICLE` from `payload.ts` if only the JSON route used them, and `ForUserDataExport` repository methods reached only from it | Yes, grep-proven at T-10 |
| **SA-Q9** | Mode B (fetch-and-blob of up to 45 MB) only if T-14 fails, chosen by a module constant (not a flag) | Yes |

---

## 12. Requirement splice

At T-14 Dev adds **§0.14 DE-9 status** to the requirement: what was built; the SA picks (UI-1 standard, SA-Q1…Q9); the TL defaults BC-1…BC-6; the T-14 verdict and the save mode; these supersessions, each marked in place with a note:

- §0.4.1 B row DE-9 "the old GET route is retired": **done**.
- §0.7 C-11 (4 MB body cap): **removed**.
- FR-E14: met by `DownloadMyDataButton` on all four entry points.
- FR-E15 and AC-E22 ("`DATA_EXPORTED`" / "Last exported from the latest `DATA_EXPORTED`"): **superseded**. The zip writes `DATA_EXPORT_READY` / `DOWNLOADED`, and "Last export" reads the jobs table through `GET /api/business-os/data-exports`.
- AC-E1 ("each export button downloads `GET /api/user/data-export`"): superseded by the zip route.
- Change History row.

---

## Dev implementation notes (2026-10-17)

Deviations from the plan text, for SA:

1. **Name kept:** `findLatestCompletedForUser` (SA allowed a rename; TL's brief used this name).
2. **`hasSignFailedFallback`:** after `ready_sign_failed`, "Download again" comes from the status line once it reloads (F-12). If the status read is unavailable, the notice itself offers "Download again" with the refusal's `jobId` (a uuid from our own route, checked again in the seam). Not in the plan; small.
3. **`not_found` (404 on download again)** shows the `expired` copy, as the §4 table says; on the start action it cannot occur and maps to `failed`.
4. **`client_timeout`:** status reloads immediately AND once after 30 s (§3.3 says reload; §4 says after 30 s). Cheap; both covered by F-11.
5. **Agent-platform banners kept.** E3 / E4 keep their success / error banners because password and 2FA messages still use them; only the export messages left. The gradient "Export Data" button is gone.
6. **E3 copy fix:** the "Data Portability" card said the export "includes all agents, conversations, and settings in JSON format", false since BQ-SA-1 and now since the zip. It reads "Your download is one zip file with your records, your files and a README that explains them." (English only, parked screen.)
7. **N2 pin allow-list:** the address literal also appears in `lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler.ts` (example text in a parked V6 prompt, predates N2). The repo-wide pin allow-lists that one file with its reason; SA to confirm.
8. **Clock cases kept:** the retired `exportFileName` block's winter-time and behind-UTC cases were ported to `fileName.test.ts` (`exportStamp`), so no clock coverage is lost.
9. **Characterization coverage:** the 130-test characterization suite of the JSON route goes with it. The zip builder runs the same `runExportSections` (covered by `sections.test.ts`, `userDataExportReads.test.ts`, `zipExport.test.ts`); the per-table chain pin that suite held through the JSON route is not re-created. SA to confirm acceptable.
10. **`console.*`:** 0 in every touched file.
11. **Two more guards the plan missed** (found by the full gate run): `exportClassification.test.ts` (the DE-5 M-5 currency scan read the JSON route; re-pointed at the two zip routes) and `accountCard.guard.test.ts` (counted the export row's chevron on the page; now 5 on the page plus a pin that the control's own chevron mirrors in RTL, through `cn(…, isRTL && 'scale-x-[-1]')`).

## SA Review Notes

_SA populates._

### SA workplan review DE-9 — 2026-10-17

**Reviewed by SA — 2026-10-17**
**Status:** ✅ Approved with conditions (C-1 … C-11 below are binding; Dev applies them in the implementation, no workplan re-review needed)

Read against `origin/main` `4e10ebba` (DE-8b PR #453 is **merged**): the POST zip route, the download-again route, `BusinessOsDataExportJobRepository`, `rateLimit.ts`, `DangerZonePanel.tsx` and its N2 pin, `ownerEventPresentation.ts`, `LanguageContext.tsx` (`useBusinessTimezone`), `package.json`, `bos-entitlements.yml`, `jest-quarantine.json`, and a repo-wide grep of every symbol §3.8 retires.

#### Gates

- **T-0a:** satisfied today. DE-8b is on main as `4e10ebba`. Dev may run `git merge origin/main` now (no rebase, no stash).
- **T-0b: still a hard stop.** The DE-8b workplan on main still marks T-14 as "Owed (TL, after deploy)" (L877). No entry point is switched (T-6 … T-9) until the verdict is copied into §3.2. Remember the QA addition at DE-8b L950: Preview writes to the **PROD** Supabase project, so test accounts only.
- **T-0c:** the 16 columns TL recorded match `DATA_EXPORT_JOB_COLUMNS` and include `requested_by_kind`, which C-4 relies on. Satisfied.
- **T-0d:** stands. The floors are 800 / 15,500 (pinned at 813 / 15,813). Net change ≈ −80 tests (35 + 24 route, the helper's ≈ 10, the `exportFileName` block ≈ 8, the DangerZone pins) and ≈ +60. If the last main run is less than 200 tests above the floor, stop and raise it with SA. Floors are never lowered.

#### Rulings on §11

| # | Ruling |
|---|---|
| **SA-Q1** UI-1 | **Option A, the inline notice inside the control.** It matches the settings pattern the codebase actually uses: inline `role="status"` / `role="alert"` in the Phase A/B drawers, plus E4's `--v2-success-*` / `--v2-error-*` banner. `sonner` appears in only 3 files, its Toaster has no `dir`, and it auto-dismisses, which would lose the retry time and the support email. A toast also renders far from a button that sits inside the Danger zone dialog. Option C is rejected because it puts two styles on one control. **No `components/ui` primitive now** (rule 7: one consumer does not justify a new shared pattern). `DataExportNotice` stays in `components/business-os/data-export/` but is **presentation-only with generic props** (`tone`, `children`, optional `action`, `onDismiss`) and holds no export logic, so promoting it later is a file move. Promotion needs a second consumer and SA review. See C-9 for live regions and persistence. **RTL:** logical classes only, icon at the inline start, and the email inside the `tooLarge` link wrapped in `<bdi>` (or `dir="ltr"`), so a Hebrew sentence cannot reorder the address. **Danger zone dialog:** the notice lives in the dialog content. Closing the dialog drops it, which is acceptable because on reopen the status line ("Last export … Download again") carries the state |
| **SA-Q2** | **Delete (404).** A tombstone is code with no caller to serve: the only callers were our four buttons, and a stale tab's old helper already turns any non-OK answer into its generic error |
| **SA-Q3** | **Approved: new repository method + `GET` on the existing `route.ts`.** Filtering `listForUser(20)` in the route is rejected, for the reason Dev gives. Follow `new-api-route`: a `correlationId` child logger, no-store, the error format, session id only, the query ignored and pinned, `tooManyRequests` on 429. `downloadable.jobId` only when `status = 'ready'` and `expires_at > now`. No counts. No audit (a read of the owner's own status). **Amended by C-4** (owner-requested jobs only) |
| **SA-Q4** | **Keep the request and still save on 200**, skipping `setState` once unmounted. Aborting would not stop the server and would only make the owner wait for "Download again" |
| **SA-Q5** | **75 s approved.** Above `maxDuration = 60`, so it fires only on a hung connection. Implement it per C-5 |
| **SA-Q6** | **Drop only.** Do not add `app/api/business-os/data-exports/__tests__` to `test:bos-entitlements`: those are route tests, and they run in the required Jest gate. The real audit coverage the old folder gave that job is the owner-read guard, and C-2 keeps it (it lives in `lib/audit/__tests__`, already in the job). Update the `bos-entitlements.yml` comment |
| **SA-Q7** | **Out of DE-9, follow-up.** `presentOwnerAuditRow` returns unlabelled rows unchanged, so `DATA_EXPORT_*` rows look exactly like `DATA_EXPORTED` rows do today. Nothing regresses |
| **SA-Q8** | **Partly.** Grep on main: `EXPORT_GDPR_ARTICLE` **stays**, because `buildExportPayload` writes it into `data.json` meta (`payload.ts` L71, L154). `exportFileName` **goes**: only the JSON route and the `sections.test.ts` describe block (L488–516) use it. Delete that block with it, and confirm `fileName.test.ts` pins the zip name's clock behaviour. `findForUserDataExport` **stays** (`sections.ts` L276, the zip builder). No other `ForUserDataExport` method remains to remove. `JSON_BODY_MAX_BYTES` goes, along with `sections.test.ts` L411 |
| **SA-Q9** | **Approved in principle, with one change: ship one save mode, not two.** If T-14 passes, ship Mode A only, with no `EXPORT_SAVE_MODE` constant and no Mode B code (that would be dead code). If T-14 fails, Mode B replaces Mode A and the extra 0.5 d applies. Either way, no env flag |

**Entry points, guards and CI time: approved.** All four switch to the one control (BC-1 a). Each §6.3 guard gets a negative control (a planted string or file the guard must reject), and guard 3 also asserts no `downloadUserDataExport` import. CRLF-safe scans (#394). No new job, workflow or step. Every new suite runs in the existing required Jest gate, and `test:bos-entitlements` gets shorter. **No added critical-path CI time.**

#### Conditions (binding)

1. **C-1 (High), date formatting throws as written (§3.4).** `Intl.DateTimeFormat` with `dateStyle` / `timeStyle` **and** `timeZoneName` throws a `TypeError` (checked in Node: "Invalid option"). Inside render, that blanks the screen. Use explicit fields instead (`year`, `month: 'short'`, `day`, `hour`, `minute`, `timeZoneName: 'short'`) through `timeZoneOptions(…)`. F-2, F-8 and F-19 must run the real `Intl`, not a mock, so a regression fails the test.
2. **C-2 (High), a guard §1.4 / §5 missed.** `lib/audit/__tests__/ownerAuditReads.guard.test.ts` L46 pins `DATA_EXPORT_ROUTE = 'app/api/user/data-export/route.ts'` and asserts `toBeDefined()`. Deleting the route turns it red. **Re-point it, do not delete it:** both zip routes (`app/api/business-os/data-exports/route.ts`, which now includes the GET, and the download-again route) must read no audit rows. Keep the existing negative controls (L237–252). Add the file to §5.
3. **C-3 (High), BC-3 single swap point, and no import cycle.** `DangerZonePanel` will import `DownloadMyDataButton`. If the control then imported `PLACEHOLDER_ERASURE_CONTACT` from `DangerZonePanel`, that is a circular import, and E1 would pull in the whole panel. **Move the constant, unchanged in name and value, together with its `TEMP-ERASURE-CONTACT` comment, to one neutral module** (for example `lib/business-os/supportContact.ts`, no `'use client'` needed). `DangerZonePanel` and the control both import it from there. Re-point the N2 pin in `DangerZonePanel.test.ts` (L101–128): exactly one definition across `app/`, `components/` and `lib/`, the address literal appears in no other source file, and the marker is still greppable. Changing the address is the user's call (see below), not Dev's.
4. **C-4 (Medium), owner-requested jobs only (BQ-SA-2 / §0.13 Q-8).** DE-10a will write admin-prepared jobs onto the target's own `user_id`. As planned, the status route would show the owner "Last export … Download again" for an export an admin made, which is the notice BQ-SA-2 rules out. `findLatestCompletedForUser` (Dev may rename it `findLatestOwnerExportForUser`) adds `.eq('requested_by_kind', 'owner')`. Pin it in the repository test with a negative control: an admin-kind ready row is never returned. **Forward note, binding on DE-10a** (to be spliced into §0.14): the download-again route must answer 404 to the owner for an admin-kind job (today `findById` filters only by `user_id`), and DE-10a must settle how `expireOtherReady` treats owner and admin jobs, so that neither replaces the other's export without a decision.
5. **C-5 (Medium), testable timers.** Build the 75 s timeout with `AbortController` + `setTimeout`, cleared in `finally`, not `AbortSignal.timeout` (Jest fake timers do not drive it, and F-11 would be flaky or hang). The one-shot 30 s status reload after `client_timeout` is cleared on unmount. F-11 keeps the fixed-advance rule (#399).
6. **C-6 (Medium), `saveSignedDownload` trusts no URL blindly.** Parse `downloadUrl` with `new URL()` and accept `https:` only (`http:` only for `localhost` in development). Anything else becomes `failed` with an `error` log and never navigates. A `javascript:` URL must never reach `location.assign`. Add one helper test for this.
7. **C-7 (Medium), §3.8 / SA-Q8 as ruled.** `EXPORT_GDPR_ARTICLE` and `findForUserDataExport` stay. `exportFileName` goes, together with its test block. Grep-prove each removal in T-10, and run `git diff --stat` with the truncation-hazard check.
8. **C-8 (Low), E2 layout.** In the `button` variant the control is one block: the action, then the status line, then the notice, stacked. `ErasureRequestContent` places it on its own line, with the "Contact us" mailto as a sibling. Drop the `flex-row-reverse` wrapper around it, so the control's logical classes are not reversed twice in Hebrew.
9. **C-9 (Low), live regions and persistence.** Two containers are rendered empty from the first paint: `role="status" aria-live="polite"` and `role="alert"`. Text goes into exactly one at a time, so nothing is announced twice. No tone auto-dismisses (E1's 3 s clear does not carry over). A notice stays until dismissed or replaced by the next action, so the retry time and the support email remain readable.
10. **C-10 (Low), copy.** `dailyLimit` `{time}` and `started` / `lastExport` `{until}` use the C-1 formatter. `{limit}` comes from `EXPORT_JOB_POLICY.DAILY_LIMIT`. The parity test adds a check that every `{placeholder}` the component passes exists in all three languages.
11. **C-11 (process).** §5 gains `lib/audit/__tests__/ownerAuditReads.guard.test.ts`, the new contact module and the `DangerZonePanel.test.ts` N2 pin. The §12 splice records C-1 … C-11, the C-4 DE-10a forward note, and that §0.4.1 B's "Flag on after QA" is superseded by §0.13 (no flag: the switch is this merge).

#### Optimisation suggestions (not blocking)

- R-3 (two instances on `/v2`): a module-level in-flight promise in `lib/client/businessOsDataExport.ts`, in the spirit of `lib/utils/request-deduplication.ts`, would let a reopened dialog or a second instance join the running request instead of drawing a 409. Not needed for DE-9.
- Also log the `retryAt` of a `daily_limit` refusal at `info`, ids only, to help support.

#### User business decision to flag (plain terms)

- **The support email shown to customers.** Today the "your account is too big to download, contact support" message, and the Danger zone's "Contact us" button, both show **your personal Gmail address** to any owner. DE-9 will make it appear in one more place. The code keeps a single place to change it (C-3). The user should choose whether to give a support address before DE-9 goes live, or to accept the personal address for now. TL's default (accept for now, swap later) is acceptable technically, and it is a one-line change whenever the user decides.
- No other new business decision. BC-1 … BC-6 as TL defaulted are technically sound.

### Approval
[x] Workplan approved, proceed to implementation once T-0b (T-14 recorded) is satisfied for T-6 … T-9. T-1 … T-5 may start after T-0a.

### SA code review DE-9 — 2026-10-17

**Code Review by SA — 2026-10-17**
**Status:** ✅ Code Approved for QA (no fix required). The merge gate stays T-0b: the PR does not merge until TL records T-14. That gate belongs to TL, not to this review.

Read the uncommitted diff in `neuronforge-de9` (`feature/data-export-de9`, base `origin/main` `4e10ebba`, 33 tracked files +489/−3522, plus the untracked new files). Ran 38 suites, **850/850 pass**: the data-exports routes (POST, GET, download-again), the settings tests, `components/business-os/data-export`, `components/business-os/purge`, the client seam, the owner-read guard, the plugin_connections guard, `lib/business-os/data-export`, and the job and user-export repositories. ESLint on every touched source file: 0 errors. The 13 warnings are all pre-existing on main (checked symbol by symbol in `SecurityTab.tsx` / `SecurityTabV2.tsx`). A full `tsc --noEmit` did not finish locally inside 10 min, so **QA runs it** (or reads the CI Build / type-check result) before passing.

#### Conditions C-1 … C-11: all met
| # | Verdict |
|---|---|
| C-1 | ✅ `formatExportTime`: explicit fields + `timeZoneName: 'short'` through `timeZoneOptions`; never throws (on a bad value it falls back to ISO). Real `Intl` in the render tests |
| C-2 | ✅ `ownerAuditReads.guard` re-pointed at both zip routes via `it.each`, plus a non-vacuity check (the routes' `DATA_EXPORT_*` writes are seen) and a "JSON route stays retired" pin. Negative controls kept and run over both routes. **Stronger, not weaker** |
| C-3 | ✅ `lib/business-os/supportContact.ts`: one definition, same name and value, `TEMP-ERASURE-CONTACT` marker kept. No import cycle (`DangerZonePanel` → control → contact module). The N2 pin is now repo-wide over `app/` `components/` `lib/` code files: one definition, the address in no other code file, a non-vacuity floor (>500 files), and negative controls |
| C-4 | ✅ `findLatestCompletedForUser`: `.eq('user_id')` + `.eq('requested_by_kind','owner')` + `ready`/`expired`, newest first, limit 1. Repo test plants an admin-kind newer ready row and a cross-tenant row, and neither is returned. The DE-10a forward note is in §0.14 |
| C-5 | ✅ `AbortController` + `setTimeout`, cleared in `finally`. The 30 s reload timer is cleared on unmount |
| C-6 | ✅ `isSafeDownloadUrl`: `https:` only; `http:` only for localhost in development. `saveSignedDownload` never navigates otherwise and logs at error. Helper tests cover it |
| C-7 | ✅ `EXPORT_GDPR_ARTICLE`, `findForUserDataExport` and `DATA_EXPORTED` kept. `exportFileName` and `JSON_BODY_MAX_BYTES` gone. Grep over code, configs, scripts, workflows and `jest-quarantine`: the only remaining mentions are retirement comments, guard strings and one workflow comment line. **No caller remains.** `git diff --numstat`: the only 0-insert deletions are the 5 intended files |
| C-8 | ✅ `ErasureRequestContent`: the control sits on its own line, "Contact us" in a sibling `<div>`, no `flex-row-reverse` around it (the panel header keeps its own, which is unrelated) |
| C-9 | ✅ Empty `role="status"` and `role="alert"` regions from the first paint, text in exactly one. Nothing auto-dismisses. `DataExportNotice` has no role of its own, is presentation-only, and uses generic props |
| C-10 | ✅ `{limit}` from `EXPORT_JOB_POLICY.DAILY_LIMIT`. Times go through the C-1 formatter. The placeholder parity map is tested in en/he/es |
| C-11 | ✅ §5 / §0.14 recorded. The requirement diff is **68/0, insert-only** |

GET route against `new-api-route`: ✅. `correlationId` child logger, `getUser()` first, session id only (a `?userId=` is ignored and pinned), its own throttle key on `RATE_LIMITS.read`, the error format with a dev-only `details`, no audit, no counts, no file name. `jobId` is sent only when `ready` and `expires_at > now`; a missing `expires_at` means not downloadable. Logs carry ids only. The client seam reads `code` from the body; 401/429 are status-only; a non-JSON 502/504 is `timeout`; a 200 is Zod-parsed. The signed URL is never logged. The hook's ref guard blocks a double click synchronously. On unmount the 200 is still saved and `setState` is skipped (SA Q4). `<bdi dir="ltr">` wraps the email. `console.*`: 0 in every touched code file. `test:bos-entitlements` only loses a path, and every new suite runs in the existing Jest gate, so **there is no added critical-path CI time**.

#### Rulings on Dev's items
1. **N2 allow-list for `lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler.ts`: approved.** The address appears there as example text inside a V6 prompt (added in `a6703535`, before N2). It is not a contact surface, and the allow-list is narrow (one file, with a reason, and changes need SA review). Follow-up, not DE-9: when the address is swapped, also scrub that example and the `.txt` / `.md` prompt templates the code-file scan does not cover (`app/api/prompt-templates/*`, `lib/agentkit/v6/**/prompts/*.md`). Today they send the owner's personal email to an LLM as sample data.
2. **The lost 130-test JSON characterization suite: equivalent coverage is sufficient. Do not rebuild a per-table chain pin on the zip builder.** The chain the suite pinned through the route (select = `exportColumnsOf`, `eq('user_id')` first, keyset paging, single-row `limit(2)`, parent-scoped `in` chunks, cross-tenant negative controls, every status, secrets never selected) is pinned table by table in `BusinessDataExportRepository.test.ts` (80 cases). Registry order, failure semantics, `account_identity` staying ok, and the URL / metadata allow-lists are in `sections.test.ts`. The zip builder calls the same `runExportSections` (`zipExport.test.ts`: FR-E12 failed section, layout, determinism). What went with the suite (download headers, the `DATA_EXPORTED` details, the `.json` name clock) belonged only to the retired route; the clock cases were ported to `fileName.test.ts`. A second pin of the same chain one layer up would only duplicate it.
3. **Two controls on `/v2` with the Danger zone open (R-3): acceptable for DE-9.** Each instance has its own ref guard. A click on the second while the first is running gets the server's `409 export_in_progress`, which shows the `inProgress` notice (correct, not misleading), and the database limit stays the real guard. The shared in-flight promise stays an optimisation follow-up, as noted at workplan review.
4. **"Download again" inside the notice (deviation 2): approved.** It appears only for `signFailed` when the status line has no downloadable export (status read unavailable), so there is never a second "Download again" next to the status line's. The `jobId` comes only from our own route's refusal and is uuid-checked twice. The control is a generic `action` prop, so the notice stays presentation-only.
- **Deviation 3 (`not_found` → `expired` on "again", `failed` on start): approved**, it matches §4.
- **Deviation 5 (agent-platform banners kept for password and 2FA, only the export messages removed): approved.**
- **Deviation 6 (E3 "Data Portability" copy now describes the zip): approved.** The old sentence (JSON, "all agents, conversations") was false. English only is fine on the parked screen.
- Deviations 1, 4, 7, 8 and items 10, 11: accepted. The two extra re-pointed guards (`exportClassification`, `accountCard`) keep their scope: the M-5 scan now covers both zip routes, and the chevron count of 6→5 is offset by a new pin that the control's own chevron mirrors.

#### Guards: none weakened
`ownerAuditReads` (stronger: two routes plus non-vacuity), N2 pin (repo-wide, stronger), `pluginConnectionsBrowserAccess` (the handler-body check becomes "imports and renders the control, no `handleExportData`, no old helper", plus a new check that the control, hook and seam make no audit call, read no table and send no `x-user-id`), `exportClassification` (re-pointed), `accountCard` (offset as above). `oneExportControl.guard`: CRLF-safe, every check is a function over (file, source), with planted negative controls for the retired path, the helper, own message keys, and the comment-vs-code distinction.

#### Optimisation suggestions (non-blocking)
- R-3 shared in-flight promise in `lib/client/businessOsDataExport.ts` (carried over from the workplan review).
- `SecurityTab.tsx` still calls `supabase` directly for security settings (pre-existing, CLAUDE.md rule 1, on the parked agent-platform screen). Out of scope for DE-9. Logged here so it is not lost.

#### For QA
Run `tsc --noEmit` (or confirm CI). Manually check the critical path on a **test account** (Preview writes to PROD): the four entry points, he RTL for the `tooLarge` email, `dailyLimit` time in the owner's zone, double click, and closing the Danger zone dialog while preparing.

### Code Approved for QA: Yes

## QA Testing Report

_QA populates._

### QA — DE-9 — 2026-10-17

**Test mode:** full
**Strategy used:**
- **A:** Jest unit and RTL jsdom tests for the seam, hook, control, copy and entry points.
- **B:** route and repository tests with a mocked Supabase.
- **Guards:** source guards, each with negative controls run on a scratch copy.
- **D (browser): skipped.** The app's only env points at the PROD Supabase project, so it could not run locally without contacting prod. A QA scratch RTL matrix (below) and the TL manual list replace it.

**Focus:** all (api, ui, security, schema)
**Skipped:** the browser check (reason above). Prod was never contacted.
**Input source:** prompt keywords (TL brief) + workplan §6

#### Runs (worktree `neuronforge-de9`, uncommitted, HEAD = origin/main `4e10ebba`)

| Run | Suites | Tests | Result | Wall time |
|---|---|---|---|---|
| New + touched suites: data-export control, settings `__tests__`, purge `__tests__`, seam, both zip route folders, `lib/business-os/data-export`, `lib/audit`, plugin guard, job repo, `userDataExportReads` | 53 | 1,024 | ✅ all pass | 96 s |
| `npm run test:bos-entitlements` | 284 | 8,575 | ✅ all pass | 193 s |
| `npm run test:authz-guard` | 2 | 203 | ✅ all pass | 67 s |
| Full `npx jest --ci`, DE-9 | 1,532 | 38,573 | 20 suites / 140 tests fail, all pre-existing | 993 s |
| Full `npx jest --ci`, origin/main baseline (git archive + git init) | 1,528 | 38,650 | 21 suites / 141 tests fail | 847 s (ran alongside the negative controls, so not a timing comparison) |
| `eslint` on the 9 touched / new source files | | | 0 errors. 13 warnings, all already on main in `SecurityTab` / `SecurityTabV2` / settings `page.tsx` (same count) | 63 s |
| `tsc --noEmit` (SA's ask): a scratch tsconfig that extends the repo's, every touched / new `.ts(x)` as roots, imports followed | | | **0 errors in any DE-9 line.** No unresolved import of the deleted route or helper. The 23 errors it prints are all on untouched lines and are already on main: duplicate keys in `en.ts` / `es.ts`, `<style jsx>` typings, `exportClassification.test.ts` L2012 (L2010 on HEAD) | 62 s |

**Full-suite diff:** all 20 failing DE-9 suites also fail on the baseline. They are the known Windows-local set:
- V6 / pilot / v4
- onboarding
- the CRM contact-drawer guards
- `supabaseFetch`, `oneAddressPolicy`, `publicEndpointsAreThrottled`
- `IntentClassifier`, `TokenBudgetManager`
- the pricing adapter

The baseline's one extra failure is `tailwind-css-escape.guard`. It fails there only because a `git init` scratch has no tracked files. **DE-9 adds no new failure.**

**CI floor (G7: 800 suites / 15,500 tests):**
- **Suites:** `jest.gate.config.js --listTests` gives 1,506 on main (the same as the last main CI run) and **1,510** with DE-9. Every new suite is in the gate.
- **Tests:** the local delta is −77 (38,650 → 38,573), so the gate projects to about 38,226.
- **Margin:** about **710 suites and about 22,700 tests** above the floors.

**`.github`:** only `bos-entitlements.yml` changed, and only its comment block. It drops the retired folder and records the owner-read guard's new coverage.

**`package.json`:** only `test:bos-entitlements` changed: the deleted folder is removed.

No new job, step or workflow.

#### Negative controls (scratch copy `C:\qa9n`; each mutation restored, scratch diffed back to identical)

| # | Planted defect | Caught by | Result |
|---|---|---|---|
| a1 | `SecurityTab.tsx` calls `fetch('/api/user/data-export')` | `oneExportControl` checks 1 + 3 | red ✅ |
| a2 | settings `page.tsx` imports `downloadUserDataExport` | `oneExportControl` checks 1 + 3 | red ✅ |
| a3 | `lib/client/downloadUserDataExport.ts` recreated | `oneExportControl` checks 1 + 2 | red ✅ |
| b | The address written as a literal in `DownloadMyDataButton.tsx` | `DangerZonePanel.test.ts` N2 pin | red ✅ |
| c | A second `PLACEHOLDER_ERASURE_CONTACT =` in `lib/business-os/` | N2 pin | red ✅ |
| d | `.eq('requested_by_kind','owner')` removed, so an admin job is returned (C-4) | job repository test (chain + filtering fake) | red ✅ |
| e | GET uses `searchParams.get('userId') ?? user.id` | `route.get.test.ts`, the ignored-`?userId=` case | red ✅ |
| f | `isSafeDownloadUrl` accepts `http:` (C-6) | seam test (a javascript:, data: or http URL never reaches `location.assign`) | red ✅ |
| g1 | The notice auto-dismisses after 4 s | C-9 "nothing auto-dismisses", F-11 timer count | red ✅ |
| g2 | The notice is replaced by a `sonner` toast | F-4, F-5, F-7, F-8 … | red ✅ |
| h | `EXPORT_TIME_FIELDS` uses `dateStyle` + `timeStyle` with `timeZoneName` (C-1) | F-2, F-3, F-4 … (real Intl throws) | red ✅ |
| i | The in-flight ref guard removed | F-6 "two clicks start ONE export" | red ✅ |
| j1 | `route.ts` (POST + GET) calls `auditTrailRepository.listOwnerEntries` | `ownerAuditReads` per-route case | red ✅ |
| j2 | The download-again route names `audit_trail` | `ownerAuditReads` table scan + per-route case | red ✅ |
| j3 | The download-again route moved off its path | `ownerAuditReads` `toBeDefined` | red ✅ |
| k | `JSON_BODY_MAX_BYTES` back in `EXPORT_LIMITS` | `oneExportControl` check 5 + `sections.test.ts` | red ✅ |

#### Outcome matrix (QA scratch RTL test, not added to the diff)

**56 of 56 pass:** 14 outcomes × en / he (rendered inside `dir="rtl"`) × the `row` / `button` variants.

The 14 outcomes:
- **Start:** ready, in_progress, daily_limit (with retry time), too_large (with support mailto), timeout, client_timeout, ready_sign_failed, failed, throttled, signed out (401), network.
- **Download again:** expired (410), 404, ready.

Each case asserts:
- The copy appears in the right region: `role="status"` with `aria-live="polite"` for success and info, `role="alert"` for errors. The other region is empty.
- No `{placeholder}` is left unfilled, and no English copy leaks into the Hebrew notice.
- `daily_limit` shows the limit (3) and the retry time on the owner's clock (09:15 UTC → 12:15 Asia/Jerusalem).
- `too_large` carries a `mailto:` link to the one contact.
- **Focus is not moved.**
- Dismiss empties the notice, and both live regions stay mounted.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| FR-E14: one "Download my data" control on all four entry points | ✅ | Pass | Four render tests + guard 3 + controls a1/a2 |
| UI-1 option A: one inline notice style, persistent, correct live regions (C-9) | ✅ | Pass | F-18, C-9 tests, controls g1/g2, QA matrix |
| Every §4 outcome has the right copy and tone; en / he / es parity (C-10) | ✅ | Pass | F-4 … F-15, parity test, QA matrix (en + he) |
| "Last export … Download again" from the status route, owner jobs only (C-4) | ✅ | Pass | F-2/F-3/F-14/F-15, repository tests, control d |
| Status route: session id only, 401, 429, 500 without detail | ✅ | Pass | `route.get.test.ts` (11), control e |
| C-1 date format: real Intl, owner clock, zone named | ✅ | Pass | F-2, F-8, F-19, control h |
| C-5 timers testable and cleared; C-6 https only | ✅ | Pass | F-11 ×2, seam tests, control f |
| Double-click guard | ✅ | Pass | F-6, control i |
| Unmount while preparing still saves the file (SA-Q4) | ✅ | Pass | F-17 |
| C-3 one contact definition, no import cycle | ✅ | Pass | N2 pin, controls b/c |
| C-2 owner-read guard covers both zip routes | ✅ | Pass | controls j1–j3 |
| JSON route, helper and 4 MB cap retired; no dangling reference (C-7) | ✅ | Pass | Guards 1/2/5, control k, repo-wide grep, tsc |
| Real browser download (Mode A), T-14 | ⚠️ | Not run | No local env without prod. **T-0b / T-14 is still the merge gate** |

#### Dangling-reference sweep

**Scope:** `git grep` over the whole repo, including `scripts/`, `tests/`, `supabase/`, `middleware.ts`, `next.config.js` and `public/`.

**Searched for:** `/api/user/data-export`, `downloadUserDataExport`, `JSON_BODY_MAX_BYTES`, `exportFileName`, and the removed `settings.security.export_*` keys.

**Result:** no code reference. The only hits are:
- comments recording the retirement;
- the guards themselves;
- one stale example snippet in `docs/CLIENT_DATA_REMOVAL_IMPLEMENTATION.md` L339, which nothing in code links to (E-3).

`PLACEHOLDER_ERASURE_CONTACT` is imported only from `lib/business-os/supportContact.ts`.

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance (should fix):** none found. The real CI-time delta is still to be read on the PR run, against the last main run (AC-E13). The local timings above overlapped, so they cannot be compared.

**Edge cases (nice to fix):**
1. **E-1 A `daily_limit` refusal with no `retryAt` shows the "already being prepared" copy.**
   - File: `components/business-os/data-export/useDownloadMyData.ts` (`noticeFor`).
   - The route passes `retryAt` straight from the DB's `result_retry_at`, so a null is possible in principle.
   - The owner would then read "an export is already being prepared" when the real cause is the daily limit. A `dailyLimit` sentence without the time would be accurate.
   - Low.
2. **E-2 Keyboard focus after dismiss.**
   - Activating ✕ removes the focused button, so focus falls to `<body>`.
   - Not moving focus is by design (C-9), but returning it to the main action on dismiss would be kinder to keyboard users.
   - Low.
3. **E-3 A stale doc snippet.**
   - `docs/CLIENT_DATA_REMOVAL_IMPLEMENTATION.md` L339 still shows `// API: /api/user/data-export`.
   - Doc only, never built.
   - Low.
4. **E-4 The `--v2-*` tokens are not loaded on `/settings`.**
   - The `button` variant's border uses `var(--v2-border)` with no fallback (the notice does have hex fallbacks).
   - On the parked `/settings` screen the border therefore falls back to `currentColor`, the same as today's Danger zone button there.
   - Cosmetic.

#### Manual checks owed after deploy (TL; Business OS only, not `/v2` or `/settings`, per the user's preference)

1. **Before merge:** T-14 is recorded in §3.2 (the T-0b gate). Preview writes to PROD, so use test accounts only.
2. **English account, the `/business-os/settings` row:**
   - Click it: "Preparing …" appears.
   - The file downloads and the page stays where it is.
   - The "started … until {date}" notice stays until it is dismissed.
3. **Status line:** "Last export … You can download it again until …" appears, and "Download again" downloads the same export.
4. **Hebrew account:**
   - The row is RTL, the chevron is mirrored and the copy is Hebrew.
   - Dates use the owner's clock and show the zone.
   - In the too-large message, the email address stays whole. Check this only if that state can be reached.
5. **Danger zone dialog:**
   - The control is stacked, with "Contact us" below it.
   - Close the dialog while it is preparing, then reopen it: the status line shows the export.
6. **Daily limit:** a 4th export within 24 h shows the limit message with a time, and the message does not dismiss itself.
7. **Signed out:** sign out in another tab, then click. The "session ended" message appears.
8. **Keyboard and screen reader:**
   - Tab reaches "Download my data", "Download again", the mailto link and ✕.
   - A screen reader announces "Preparing" once.
9. **Old route:** `/api/user/data-export` now answers 404.
10. **Business call for the user:** the support / erasure email shown to customers is still the personal Gmail address. It has a single swap point, `lib/business-os/supportContact.ts`.

#### Housekeeping
- **Scratch copies:** `C:\qa9b` (baseline) and `C:\qa9n` (negative controls) are still on disk.
  - Their `node_modules` junctions were removed with `rmdir`, and the shared `node_modules` was checked intact.
  - The sandbox refused `rm -rf` on a root-level folder, so the user or TL should delete both folders by hand.
- **Worktree:**
  - `git diff --numstat` was identical before and after QA. This section is the only addition, and the workplan is untracked.
  - No stash was used and nothing was committed.
  - `tsc` wrote no `tsbuildinfo` (a scratch tsconfig with `incremental: false` was used).

#### Final Status
- [x] Every acceptance criterion that Jest can test passes, and no bugs were found. **QA passes.** The merge is still gated on T-0b (T-14 recorded).
- [ ] Issues found that Dev must address: none blocking. Edge cases E-1 … E-4 are optional.

## Commit Info

_RM populates._

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan written | Dev, against DE-8b's end state; awaiting SA workplan review |
| 2026-10-17 | Code complete | Dev: T-0a/T-0c/T-0d done, T-0b (T-14) owed and gating the merge; T-1 … T-12, T-14 done; SA C-1 … C-11 applied; §5 gains `lib/business-os/supportContact.ts`, `lib/audit/__tests__/ownerAuditReads.guard.test.ts`, `DangerZonePanel.test.ts` (N2), `fileName.test.ts`, `userDataExportReads.test.ts` (comment), two entry-point render tests (C-11); see Dev implementation notes |

### T-0c result — 2026-10-17 (TL, read-only, prod)
`public.business_os_data_exports` live with 16 columns exactly as 20261074: id!, user_id!, requested_by!, requested_by_kind!, status!, failure_reason, bytes:int8, file_count, row_count, created_at!, finished_at, ready_at, expires_at, expired_at, owner_downloaded_at, updated_at!. Rows: 0.

### §10.1 Business calls — TL defaults 2026-10-17 (autonomous run; user may change)
All Dev defaults accepted: BC-1 agent-platform screens get the same new button; BC-2 retire the JSON route + old helper; BC-3 "too large" uses the same contact constant as the Danger zone (`PLACEHOLDER_ERASURE_CONTACT`) — **note: that constant is currently the user's personal email; TL is flagging it to the user, keep a single swap point**; BC-4 "Download my data" always prepares a fresh export, "Download again" below for the last ready one; BC-5 label "Download my data"; BC-6 no "what's included" line (README explains).
