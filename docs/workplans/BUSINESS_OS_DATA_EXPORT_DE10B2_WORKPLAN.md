# Workplan: DE-10b.2 — Customer self-delete (every account without a running plan)

> **Last Updated**: 2026-10-21

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md). Binding, in this order: *User decisions 2026-10-18 (after SA Review 2)* → *TL SQL results 2026-10-18* → *SA Review 2* (R-1, R-4, TQ-10, TQ-11, TQ-19, TQ-21, C2-5, C2-10, C2-12, §F DE-10b.2 row) → the rest. §3 (drawer, statement, server check) and §10.1 DE-10b.2 stand, except where R-1 changed them: there is no "never paid only" path and no hard delete for customers.
**Depends on:** [DE-10b.1](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B1_WORKPLAN.md) **merged, with 20261080 + 20261081 applied on prod**. This slice calls `runAccountAnonymise` and the `anonymise` modes and adds no migration.
**Branch:** `feature/data-export-de10b2`, cut by RM from `origin/main` after DE-10b.1 (PR #468) merged. Not stacked.
**Date:** 2026-10-18
**Status:** Code Complete (uncommitted, waiting for SA code review)
**Gate:** manual (no auto-merge). It ships behind `isAccountSelfDeleteEnabled()`, **default off**.

## Overview

Settings → Danger Zone → **Delete my account** opens a drawer. The drawer warns the customer to download their data from Settings → Download my data first. It has **no download button**. A read-only pre-check runs when it opens and lists any blockers in plain words. A running plan, a connected Stripe account, running client payment plans, and pending client payments or refunds block; sent or overdue invoices do not (TL-6). With no blockers the customer types one statement (English, Hebrew, or Spanish draft). The server checks it against its own list and runs the DE-10b.1 `anonymise` mode on the **session user**: everything is deleted, our billing stays nameless, and the login becomes a closed tombstone. The customer is signed out and lands on a public "Your account has been deleted" page. One confirmation email goes to the address the account had. That address is held in memory only.

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Design](#2-design)
3. [Files to create / modify](#3-files-to-create--modify)
4. [Test plan](#4-test-plan)
5. [Rollout and user steps](#5-rollout-and-user-steps)
6. [Task list](#6-task-list)
7. [Risks](#7-risks)
8. [Open items for SA](#8-open-items-for-sa)
9. [Points that differ from the requirement text](#9-points-that-differ-from-the-requirement-text)
10. [Estimate](#10-estimate)
11. [Implementation notes](#11-implementation-notes-dev-2026-10-21)
12. [SA Review Notes](#sa-review-notes)
13. [QA Testing Report](#qa-testing-report)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## 1. Analysis summary

Read on `origin/main` `399070d4`.

| Area | What exists | DE-10b.2 changes |
|---|---|---|
| `components/business-os/purge/DangerZonePanel.tsx` (`ErasureRequestContent`) | The single Danger Zone body for `/business-os/settings` (in a dialog), `/v2/settings` (`SecurityTabV2`) and legacy `/settings` (`SecurityTab`). Shows `DownloadMyDataButton` + a mailto to `PLACEHOLDER_ERASURE_CONTACT` | When the pre-check says `enabled`, it renders the delete drawer entry instead. When the switch is off (or the deployment is not configured), today's body stays, so nothing changes while it is off |
| `lib/business-os/purge/confirmation.ts` | `normaliseConfirmation` (case, outer and repeated spaces) | Reused unchanged |
| `lib/supabaseServerAuth.ts` | `createAuthenticatedServerClient()`. Its cookie `set` / `remove` are **no-ops** | The session is read with `getUser()` only. Cookies are cleared on the response by hand (§2.6) |
| `lib/security/rateLimit.ts` | `rateLimit(request, route, rule, outcome)`, keyed on the hashed IP + route. `RATE_LIMITS.write` = 20 / 10 failures per 5 min. Fails open when degraded | Statement throttling (§2.4) |
| `lib/notifications/emailTransport.ts` | Transactional send. `.invalid` refusal added by DE-10b.1 | Confirmation email, no `ownerUserId` (the profile is gone) |
| `/api/admin/users` | Lists from `profiles`, then enriches from `auth.admin.listUsers()` | A tombstone has no profile, so it **already** drops out of the list. Nothing to hide (§9 X-3) |
| `/api/admin/user-emails`, `/api/admin/token-usage/drill-down` | Resolve account id → login email for admin pages. Finance pages pass ids only (`financeLinks.ts`) | Label "Deleted account {ref}" via `isClosedAccountEmail` |
| `middleware.ts` | Public-path allow-list | `/account-deleted` must pass without a session |
| Platform privacy notice | **No platform privacy page exists in the repo.** Only each business's own site privacy pages (`app/site/[subdomain]/privacy`, `app/c/[userCode]/privacy`) | §9 X-4 |
| BOS plan cancel | **No customer cancel route** for the BOS plan (TQ-15) | The G-6 blocker can only say "contact support" (§9 X-2) |

Every file to be touched holds **0** `console.*` calls today (counted on `origin/main`). No import from `lib/business-os/entitlements/`.

---

## 2. Design

### 2.1 Off switch

`isAccountSelfDeleteEnabled()` in `lib/utils/featureFlags.ts`: server-only, reads `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED === 'true'`, default **off**. Never named `use…` (`npm run lint:hooks`). The browser learns the state only from the pre-check response, so there is no `NEXT_PUBLIC_` flag. Row in `docs/feature_flags.md`.

### 2.2 Statements and matching

`lib/business-os/account-deletion/acknowledgement.ts` (pure, safe in the client bundle, because the drawer shows the statement):

- `DELETION_STATEMENTS = { en, he, es }`, verbatim from §3.2.
- `normaliseAcknowledgement(s)`: `normalize('NFC')` → strip bidi marks (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) and zero-width marks (U+200B–U+200D, U+FEFF) → strip Hebrew points and cantillation (U+0591–U+05C7) → `normaliseConfirmation`.
- `matchStatement(typed): 'en' | 'he' | 'es' | null`: any supported language is accepted, whatever the UI language (§3.2).
- The client uses it only to enable the button. The server never compares against text from the browser except the typed statement itself (§3.3).

### 2.3 Routes

Both follow the `new-api-route` skill: Pino `createLogger` + `correlationId`, Zod `.strict()`, structured JSON, the dev-only `details` guard. There is no `requireAdmin` (customer routes). Identity comes **only** from `createAuthenticatedServerClient().auth.getUser()`: never `getSession`, never the body (C2-10). Both routes import `TestAccountCleanupRepository` only through `runAccountAnonymise`, and they are added to the DE-10b.1 importer allow-list (family 5).

**`GET /api/business-os/account/deletion-check`** (the drawer pre-check, read-only)

1. Off → `200 { enabled: false }` (the drawer keeps today's body). This is not a 404, so the UI does not show an error.
2. `getUser()` fails → 401.
3. `rateLimit(…, RATE_LIMITS.read)`.
4. Cleanup secret or fingerprint key missing → `200 { enabled: true, available: false }`. The drawer says "not available right now" and shows the support address.
5. `anonymiseCheck({ email: user.email, subject: user.id })` (read-only transaction) → version check (R-6).
6. Map the guard rows (§2.5). Response: `{ enabled, available, blockers: [{ code, count? }], willKeepBilling: boolean, exportFacts: { lastReadyAt, downloaded } }`. Never the email, never guard SQL text.

**`POST /api/business-os/account/delete`**, body `{ statement: string (1–500), language: 'en' | 'he' | 'es' }`, `.strict()`. A body carrying `email`, `userId` or any other key → 400.

1. Off → 404 `not_found`.
2. `getUser()` fails → 401.
3. Zod → 400.
4. `rateLimit(…, 'account-delete', RATE_LIMITS.write)`.
5. `matchStatement` fails → 400 `statement_mismatch`, counted under the **failure** bucket. Nothing is called. Audit `ACCOUNT_DELETION_REFUSED` (reason only).
6. Cleanup secret or fingerprint key missing → 503 `not_available`. Nothing is called.
7. `findDeletionFacts(user.id)` (DE-10b.1 repository method).
8. Build `p_receipt`: origin `owner`, executor `self_service`, fingerprint of `user.email`, statement language (the matched one) and the exact typed text, export facts, `requested_at`, `retain_until`, correlation id. No reason.
9. `runAccountAnonymise({ email: user.email, subject: user.id, confirmEmail: user.email, receipt }, null)`:
   - blocked on the check → 409 `blocked` + mapped blockers, nothing removed;
   - blocked after the storage step → 409 + "Your files were removed but your account was kept. Contact support" (C2-11), audit with `files_removed`;
   - unavailable → 503, failed → 500 (sentence says whether files went).
10. Success:
    - the function has already deleted the sessions and refresh tokens, so `getUser()` fails from now on;
    - the response **expires every `sb-*-auth-token*` cookie** (§2.6);
    - the email is sent from the local `user.email` variable, best-effort, once, and a failure is logged with ids only (N-8);
    - the response is `200 { success: true, data: { redirect: '/account-deleted?lang=<language>' } }`.

Audit (C2-10): every row through `logAndFlush`, `user_id = NULL`, `entity_type 'user'`, `entity_id` = subject id, `details.source = 'self_service'`. Never the email, statement text or fingerprint. The success row is the in-function `ACCOUNT_PSEUDONYMISED` row, so the route writes **no** extra success row (O2-3).

Logs: `{ correlationId, subjectId, outcome, guards, filesRemoved, serverMs }` only.

### 2.4 Throttling

The route key embeds a short sha256 of the user id (`account-delete:<16 hex>`), so attempts count per account **and** per IP, and no raw id sits in the rate-limit table. Wrong statements count under the failure budget (10 / 5 min). `rateLimit` fails open when degraded (its documented rule). That is acceptable here: the statement is public text, and the session plus the statement is the gate (BQ-11 no). See O2-2.

### 2.5 Guard → plain words

`lib/business-os/account-deletion/blockerCopy.ts` maps guard rows to codes. The drawer renders the copy keys. Unknown guards fail safe to `contact_support`.

| Guard | Code | English draft |
|---|---|---|
| G-6 | `plan_running` | "Your plan is still running. Contact us at {support} to cancel it before deleting." (§9 X-2) |
| G-8 | `stripe_connected` | "Your Stripe account is still connected for client payments. Disconnect it in Settings → Payments." |
| G-9 C1 | `client_plans_running` | "{n} client payment plans are still running. End them first." |
| G-9 C2 | `client_payments_pending` | "{n} client payments or refunds are still pending. Wait for them to finish." |
| G-4 | `admin_account` | "Admin accounts cannot be deleted here." |
| G-12 | (none) | handled by the storage step |
| G-1, G-2a, G-10, G-11, G-13, G-16 … G-22 | `contact_support` | "We need to finish something on our side first. Contact us at {support}." |

G-5 / G-7 / G-14 / G-15 / G-9 C3 are notes, never blockers. `willKeepBilling` is true when G-5 or G-7 counted rows. Then the drawer adds "We keep your payment history with us, with your personal details removed."

### 2.6 Sign-out and after-delete

- Server: expire the auth cookies on the `NextResponse` (`maxAge: 0`, same path / domain attributes as `@supabase/ssr` writes, including the chunked `.0` / `.1` names). `createAuthenticatedServerClient` cannot do it: its `remove` is a no-op (§9 X-1).
- Client: on 200, `supabaseClient.auth.signOut({ scope: 'local' })` (no network revoke; the sessions are already gone), then `window.location.replace(redirect)`.
- `app/account-deleted/page.tsx`: a public server component, no session read, no data. Copy in en / he / es from `?lang=` (default en, `dir="rtl"` for he). It has a link to the sign-up / home page. `middleware.ts` lets it through without a session (the task checks whether it already does).

### 2.7 The drawer

`components/business-os/account-deletion/DeleteAccountDrawer.tsx` + hook `hooks/useAccountDeletionCheck.ts` (hooks in their own file). It uses the existing Radix dialog / drawer primitive the settings drawers use. Order as §3.1:

1. the warning (text names Settings → Download my data, **no** `DownloadMyDataButton`, no export control);
2. "Your account will be deleted now" (+ the billing-kept line when `willKeepBilling`);
3. the blockers (when any) with **no** statement box;
4. the statement shown, the box (`dir="rtl"` in Hebrew, paste allowed, labelled, error in `role="alert"`), and the Delete button disabled until `matchStatement` is not null.

States: loading, `available: false`, error, blockers, ready, deleting (button busy, no double submit), refused (server blockers re-rendered).

Copy keys `settings.account_delete.*` in `lib/business-os/translations/{en,he,es}.ts` (Spanish draft), and English fallbacks in `DangerZonePanel`'s `FALLBACK_COPY` for `/v2/**` (kept byte-identical, as the file requires). The mailto stays **only** in the blocker and not-available lines (§F: "mailto removed except for blockers").

### 2.8 Confirmation email

`lib/business-os/account-deletion/deletionEmail.ts`: subject + HTML + text in the statement language. "Your AgentPilot account was deleted on {date}. If this was not you, contact {support}." No name, no business name. `kind: 'transactional'`, no `ownerUserId`, no unsubscribe header.

### 2.9 "Deleted account {ref}" and the privacy paragraph

- `isClosedAccountEmail` / `closedAccountRef` (from DE-10b.1) applied where an admin page shows a login email: `/api/admin/user-emails` and `/api/admin/token-usage/drill-down`. The task step 1 greps for every other `listUsers` / `getUserById` consumer under `app/api/admin` and records the list in the workplan.
- Privacy paragraph: written per §6.7 and amended by C2-12 and the user's decisions:
  - it **may** say the sign-in log is cleaned (SQL-4b decision);
  - it **must not** claim the Stripe Customer object was cleaned;
  - it **must** say that clients' marketing-consent records are kept (NBQ-3).
  
  Where it lives is §9 X-4. Dev default: `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` for the lawyer, plus a one-line "what we keep" link in the drawer.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/utils/featureFlags.ts` + test, `docs/feature_flags.md` | modify | `isAccountSelfDeleteEnabled()` |
| `lib/business-os/account-deletion/acknowledgement.ts` + `__tests__/acknowledgement.test.ts` | create | statements, normaliser, matcher, guard |
| `lib/business-os/account-deletion/blockerCopy.ts` + test | create | guard → code |
| `lib/business-os/account-deletion/deletionEmail.ts` + test | create | email body |
| `lib/business-os/account-deletion/authCookies.ts` + test | create | expire the `sb-*` cookies on a response |
| `app/api/business-os/account/deletion-check/route.ts` + `__tests__/route.test.ts` | create | pre-check |
| `app/api/business-os/account/delete/route.ts` + `__tests__/route.test.ts` | create | delete |
| `lib/business-os/account-deletion/schemas.ts` | create | Zod bodies / responses |
| `hooks/useAccountDeletionCheck.ts` | create | drawer data |
| `components/business-os/account-deletion/DeleteAccountDrawer.tsx` + render tests | create | the drawer |
| `components/business-os/purge/DangerZonePanel.tsx` + `__tests__/DangerZonePanel.test.ts` | modify | switch between today's body and the drawer entry. Fallback copy |
| `app/business-os/settings/page.tsx` | modify (if needed) | the dialog that hosts `ErasureRequestContent` hosts the drawer entry |
| `lib/business-os/translations/{en,he,es}.ts` | modify | copy keys |
| `app/account-deleted/page.tsx` + render test | create | public page |
| `middleware.ts` (+ its test if one exists) | modify if needed | public path |
| `app/api/admin/user-emails/route.ts`, `app/api/admin/token-usage/drill-down/route.ts` + tests | modify | label |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | family 5 allow-list: the self route |
| `lib/audit/events.ts` | none expected | events came with DE-10b.1 |
| `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` | create (pending X-4) | privacy paragraph |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | modify | status splice |

---

## 4. Test plan

Inside the existing Jest gate.

### 4.1 Unit and guard tests

- **Statement guard (§10.1):**
  - every language has a non-empty statement;
  - no statement holds punctuation or a geresh / gershayim;
  - each statement matches itself;
  - each statement matches with: different case; doubled and outer spaces; an inserted U+200F / U+202B / U+200B; NFD input; niqqud added to the Hebrew;
  - the English statement matches while the UI is Hebrew;
  - a near-miss (one word dropped) does not match;
  - `normaliseConfirmation` is unchanged (its existing tests stay green).
- `blockerCopy`: every guard the generator can emit has a code (built from the generator's guard id list, so a new guard without a mapping fails). An unknown guard → `contact_support`.
- `isAccountSelfDeleteEnabled`: off when unset, `'false'`, `'1'`, `'TRUE '`. On only for `'true'`. The `lint:hooks` naming rule holds.
- `authCookies`: expires the base cookie and its chunked variants, nothing else.
- `deletionEmail`: no placeholder left; the Hebrew body is RTL; no personal field is interpolated except the date.

### 4.2 Routes (integration, mocked repository and auth)

Happy path, auth failure and invalid input for each (CLAUDE.md coverage rule), plus the orderings. Each case asserts which calls did **not** happen.

| # | Case | Expected |
|---|---|---|
| R-1 | switch off | check: `{ enabled: false }`, no `getUser`. Delete: 404, no `getUser` |
| R-2 | no session | 401, no repository call |
| R-3 | body with `email` / `userId` / extra key | 400, no repository call |
| R-4 | wrong statement | 400, failure bucket hit, no fingerprint read, no check, refusal audit without the text |
| R-5 | statement differs only by case, marks or niqqud; English typed with `language: 'he'` | accepted |
| R-6 | fingerprint key missing / cleanup secret missing | 503 `not_available`, no check |
| R-7 | `plan_running` / `stripe_connected` / `client_plans_running` | 409 with codes, no storage, no anonymise |
| R-8 | only notes (sent invoice, consent rows, paid in the past) | proceeds. The receipt mode follows G-5 / G-7 |
| R-9 | repository gets `subject = user.id` and `email = user.email` from `getUser()` | even when the body tries to smuggle others (rejected at Zod anyway) |
| R-10 | receipt built from the matched language and the exact typed text, export facts copied | "said downloaded / no export on record" is recorded when facts are empty (N-3) |
| R-11 | blocked after storage | 409 with the files-removed sentence, audit `files_removed` |
| R-12 | success | 200 + redirect, `Set-Cookie` expiring each `sb-*` cookie, `sendEmail` called once with `[user.email]` |
| R-13 | `sendEmail` rejects / returns `sent: false` | still 200. The log has ids only |
| R-14 | rate limit exceeded | 429 before the statement check |
| R-15 | privacy scan | no logger or `logAndFlush` argument contains the email, the statement text or a 64-hex fingerprint. Audit rows have `user_id: null` |

### 4.3 Render

- Drawer:
  - no `DownloadMyDataButton` and no button or link that starts an export (§10.1);
  - the warning renders in en and he, with `dir="rtl"` in he;
  - the button stays disabled until the statement matches, and is enabled on a pasted match (no `onPaste` block);
  - blockers → no statement box;
  - `available: false` → the not-available line with the support address;
  - the input has a label, and errors render in `role="alert"`;
  - keyboard: the button is reachable and activates with Enter.
- `DangerZonePanel`: with `{ enabled: false }`, today's body is byte-equivalent (existing pins green). With `enabled`, the drawer entry shows and no mailto appears outside blockers.
- `/account-deleted`: renders with no session, en / he, with no data fetch.

### 4.4 Manual QA (prod, C2-5)

Self-delete answers "not available" on Preview (the cleanup secret is Production-only), so QA runs on prod with the switch on and **disposable, non-`+test` accounts** created for the purpose:

| Scenario | Expected |
|---|---|
| N-1 | free account, nothing connected → deleted, signed out, `/account-deleted`, one email, receipt `completed` (mode `anonymised`) |
| N-2 | wrong statement (forced through devtools) → refused, nothing changes |
| N-3 | never exported → deleted. The receipt records "no export on record" |
| N-4 | Stripe connected → blocker in plain words, no box |
| Invoices (TL-6) | one sent invoice → **not** a blocker. Deleted with the account |
| Paid in the past | an account with a test-mode boost only (no live money exists to test with) → deleted. The kept rows are blanked |
| Running plan | → the `plan_running` blocker |
| Afterwards | the old email signs up again. The old password is refused. `/admin/users` no longer lists the account. Token-usage drill-down shows "Deleted account {ref}" |
| Hebrew | the drawer is RTL, and the Hebrew statement is accepted typed with niqqud |
| Accessibility | one keyboard-only pass |

---

## 5. Rollout and user steps

1. DE-10b.1 merged and applied. `DELETION_RECEIPT_FINGERPRINT_KEY` already set (DE-10b.1 user step).
2. Merge DE-10b.2 (manual gate) with `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` **unset**. Production behaves exactly as today.
3. **User:** set `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED=true` in Vercel **Production** and redeploy, for the QA window.
4. QA runs §4.4. Then the user decides to keep it on, or unset it (off again on redeploy).
5. **User (business):** decides where the privacy paragraph is published (X-4) and sends it to the lawyer and CPA. The support address stays `PLACEHOLDER_ERASURE_CONTACT` until Offir supplies a mailbox (BQ-8).

No migration in this slice. Rollback = unset the switch and redeploy.

---

## 6. Task list

- [x] 1. ✅ Branch confirmed (`feature/data-export-de10b2`). Admin consumers of `listUsers` / `getUserById` recorded in §11.1
- [x] 2. ✅ `isAccountSelfDeleteEnabled()` + test + `feature_flags.md`
- [x] 3. ✅ `acknowledgement.ts` + statement guard tests
- [x] 4. ✅ `blockerCopy.ts` + the guard-coverage test (reads the 20261081 function file)
- [x] 5. ✅ `schemas.ts` (bodies and responses, `.strict()`)
- [x] 6. ✅ `authCookies.ts` + test
- [x] 7. ✅ `deletionEmail.ts` + test
- [x] 8. ✅ `GET /api/business-os/account/deletion-check` + route tests
- [x] 9. ✅ `POST /api/business-os/account/delete` + route tests R-1 … R-15
- [x] 10. ✅ `no-deletion-paths` family 5: the self-service runner (not a route, V-2) + its test added; both customer routes pinned as non-importers; new negative fixture
- [x] 11. ✅ `hooks/useAccountDeletionCheck.ts`
- [x] 12. ✅ `DeleteAccountDrawer.tsx` + render tests
- [x] 13. ✅ `DangerZonePanel` / `ErasureRequestContent` switch + fallback copy + existing pins green
- [x] 14. ✅ Translations en / he / es (Spanish marked draft). Native check of Hebrew and Spanish owed by the user
- [x] 15. ✅ `/account-deleted` page + render test + middleware public path + `PlatformChrome` public list
- [x] 16. ✅ "Deleted account {ref}" in `user-emails` and `token-usage/drill-down` + tests (other sites: §11.1)
- [x] 17. ✅ Privacy paragraph draft at `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` (V-9 wording)
- [x] 18. ✅ Requirement status splice
- [x] 19. ✅ Type-check of the touched files (clean), lint of touched files (no new findings), `npm run lint:hooks` (clean), touched + guard suites (§11.3). `git diff --stat` reviewed
- [x] 20. ✅ Handed to SA (uncommitted). SA code review 2026-10-21: approved for QA
- [x] 21. ✅ SA code review fixes N-1, N-2, N-3, N-4, N-6, N-9 applied (2026-10-21); N-5, N-7, N-8 left as recorded. See §11.4
- [x] 22. ✅ QA B-1 and E-1 fixed per the SA addendum (2026-10-21), uncommitted. See §11.5. Waiting for SA re-review of the fix diff and the QA re-run

**20 tasks.**

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| K2-1 | Cookies not cleared → the browser keeps a dead session and loops on protected pages | Server expiry + client `signOut({ scope: 'local' })` + `location.replace`. QA checks |
| K2-2 | The access JWT stays valid ≤ 1 h for PostgREST reads of kept rows (SQL-5) | Accepted (TQ-19). Nothing personal is left after the blanks |
| K2-3 | A customer on a running plan cannot self-cancel, so the blocker always sends them to support | §9 X-2. Release 2 (`cancel_at_period_end`) removes it |
| K2-4 | The `rateLimit` failure bucket fails open when the counter is down | Acceptable (O2-2). The session plus the server-held statement is the gate |
| K2-5 | Pre-check and run disagree (a payment lands in between) | The `anonymise` run re-checks every guard and refuses. The drawer re-renders the server blockers |
| K2-6 | Hebrew / Spanish copy unchecked by a native speaker | Flagged to the user. Spanish marked draft |
| K2-7 | Self-delete of the only owner of an organisation others belong to | G-13 blocks → `contact_support` |

---

## 8. Open items for SA

| # | Question | Dev default |
|---|---|---|
| O2-1 | The check route answers `200 { enabled: false }` when off. The delete route answers 404 | yes |
| O2-2 | Statement throttle: per account + IP via the route key, failure bucket, fail-open as `rateLimit` documents | yes |
| O2-3 | No route-level success audit row: the in-function `ACCOUNT_PSEUDONYMISED` (source `self_service`) is the record | yes |
| O2-4 | Audit a wrong statement as `ACCOUNT_DELETION_REFUSED` (reason only), or only log it? | audit (R-3) |
| O2-5 | Cookie expiry on the response (helper) rather than `signOut` through `createAuthenticatedServerClient`, whose `remove` is a no-op | helper |
| O2-6 | `/account-deleted?lang=` for the language (no session, no preference to read) | yes |
| O2-7 | "Show deleted" toggle on `/admin/users` deferred to release 3 (the list is profile-driven, so tombstones are already hidden) | defer |

---

## 9. Points that differ from the requirement text

| # | Requirement says | Found in code | Proposal |
|---|---|---|---|
| X-1 | TQ-19: the route "clears the auth cookies (`signOut({ scope: 'local' })`)" | `createAuthenticatedServerClient`'s cookie `set` / `remove` are no-ops, so a server `signOut` clears nothing | Expire the cookies on the response + client-side local sign-out (§2.6) |
| X-2 | NBQ-5 / R-4: "Cancel your plan first, or contact support" | There is no customer cancel path for the BOS plan (TQ-15 confirms) | Copy says "contact us to cancel it". **Business call for TL / user:** accept until release 2 |
| X-3 | TQ-21: "Admin users list: hide closed accounts by default, with a 'show deleted' toggle" | The list is built from `profiles`, and `anonymise` deletes the profile | Hiding is automatic. The toggle moves to release 3 (O2-7) |
| X-4 | §F: "privacy paragraph" in this slice | No platform privacy notice page exists in the repo | **Business call:** where the notice lives. Dev drafts the paragraph in `docs/legal/` until then |
| X-5 | §10.1 DE-10b.2 "never-paid only; a paid account is sent to the paid flow"; N-5 | Superseded by R-1 / R-4: any account without a running plan self-deletes, paid ones with billing kept | Tests follow R-1 / R-4 |
| X-6 | §F places the `.invalid` refusal in DE-10b.2 | Tombstones first appear in DE-10b.1 (admin anonymise) | Moved to DE-10b.1 (its D-7 / O-11) |

---

## 10. Estimate

| Part | Days |
|---|---|
| Statements, flag, blocker map, schemas, cookies, email | 0.5 |
| Two routes + integration tests | 0.75 |
| Drawer, hook, panel switch, translations, render tests | 1.0 |
| `/account-deleted`, middleware, label sites, privacy draft, guard update | 0.5 |
| **Total** | **🟡 ~2.75 d** (SA §F: ~2.5 d. +0.25 d for the cookie handling and the label-site sweep) |

Release 1 total (DE-10b.1 + DE-10b.2): **~7 d** (SA: ~6.5 d).

---

## 11. Implementation notes (Dev, 2026-10-21)

### 11.1 Task 1: admin sites that resolve an account id to a login email

| Site | Labelled "Deleted account {ref}"? | Why |
|---|---|---|
| `app/api/admin/user-emails/route.ts` | ✅ yes | Feeds the finance and admin pages that show a login per account id |
| `app/api/admin/token-usage/drill-down/route.ts` (both maps) | ✅ yes | The token-usage drill-down (QA "Afterwards" row) |
| `app/api/admin/users/route.ts`, `app/api/admin/onboarding-users/route.ts` | no | Built from `profiles`; the anonymise deletes the profile, so a tombstone never appears (X-3) |
| `app/api/admin/agents/route.ts` | no | Agents of a closed account are deleted with it |
| `app/api/admin/execution-stats/route.ts`, `app/api/admin/storage-stats/route.ts` | no (follow-up) | List every auth user. A tombstone shows its placeholder `deleted-{ref}@deleted.invalid`, which is non-personal and self-explanatory. Small follow-up if SA wants the label there too |
| `app/api/admin/dashboard/route.ts` | no | Counts only |

Both labelled files hold pre-existing direct Supabase calls (rule 1), and `user-emails` has no Zod body schema. Flagged, not refactored (out of scope).

### 11.2 Decisions taken while building (for SA)

| # | Point | What was done |
|---|---|---|
| D2-1 | V-2 engine access | The routes import `lib/business-os/account-deletion/selfServiceDeletion.ts` (`runAccountDeletionCheck`, `runSelfAccountAnonymise`, `errorKindFacts`). That runner and its test are the only family-5 additions; no route file was added. The guard now also pins both customer routes as non-importers |
| D2-2 | V-5 and the client bundle | `normaliseConfirmation` lives in `lib/business-os/purge/confirmation.ts`, which imports a server repository. So `acknowledgement.ts` **mirrors** the one-line rule instead of importing it, and a parity test pins the two together. `normaliseConfirmation` itself is unchanged |
| D2-3 | V-6 order | The export facts are read in the route (step 7) before the engine, as V-6 lists. The receipt callback then asserts that the login the check resolved is the session's, else the run stops at the receipt stage before any file goes |
| D2-4 | V-8 dialog nesting | The "drawer" is rendered inline by `ErasureRequestContent` inside the dialog (`/business-os/settings`) or the expanded panel (`/v2/settings`, `/settings`) that already exists. No second Radix dialog. `app/business-os/settings/page.tsx` needed no change |
| D2-5 | V-4 sign-out | The client uses the shared `signOutUser({ scope: 'local', method: 'account_deleted' })` (deadlines, cookie clear by shape, never rejects), then `location.replace` to the server redirect only if it is `/account-deleted[?…]`, else to `/account-deleted` |
| D2-6 | V-3 cookies | Expired: `sb-<ref>-auth-token`, its `.N` chunks, and `-code-verifier` (+ chunks), only when present on the request: `Path=/`, `SameSite=Lax`, no `Secure`, no `Domain`, not `httpOnly` (the `@supabase/ssr` 0.6.1 defaults). `-user` is not in V-3's list and this client does not write it; the browser-side `signOutUser` clears it by shape anyway |
| D2-7 | Session read | `createAuthenticatedServerClient().auth.getUser()` in `sessionSubject.ts`, not the cached `getUser()` in `lib/auth` (a deleted account must not be served from a cache) |
| D2-8 | Throttle | `account-delete:<16 hex of sha256(user id)>` on the `write` rule. A wrong statement also hits the failure bucket and answers 429 once that is spent. The check route uses `account-deletion-check:<hash>` on the `read` rule |
| D2-9 | Logging (DE-10b.1 QA E-1) | The customer routes log an engine error as `{ kind, code, name }` only, never its message |
| D2-10 | DE-10b.1 QA E-2 | `isInvalidDomainRecipient` now strips a trailing `>` and spaces, so `Dana <x@deleted.invalid>` is refused. Tests added |
| D2-11 | DE-10b.1 QA I-a | The drawer's billing line ("We keep your payment history with us, with your personal details removed") shows for G-5 or G-7 and never claims real money was paid. A render test pins it |
| D2-12 | Email | Sent after the deletion committed, once, `redactRecipientInLogs: true`, bounded at 5 s. The outcome is logged as a word (`sent` / `not_sent` / `timeout` / `threw`) |
| D2-13 | `/account-deleted` | Added to both public lists (the middleware skip list and `PlatformChrome` `PUBLIC_EXACT`), as `PlatformChrome.tsx` requires. The copy lives in `accountDeletedCopy.ts`, because a `page.tsx` may export only Next's own fields |
| D2-14 | Hook without `fetch` | `useAccountDeletionCheck` starts in `error` (today's body) when `fetch` is missing, so the existing jsdom pins render synchronously as before |

### 11.3 Test results (this worktree, Windows)

Counts are in the SA hand-off message. Pre-existing failures, not caused by this slice: `lib/__tests__/supabaseFetch.test.ts` (the dev ceiling case), `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` (three routes with Windows paths: `book/manage/[token]/calendar`, `public/consent-copy` and `public/invoice/[id]/pay`; corrected per SA N-9), and `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` (negative control (j), Windows CRLF). A whole-project `tsc` runs out of memory locally. The touched files type-check clean in a scoped config; the only errors it reports are the pre-existing duplicate keys in `translations/en.ts` and `es.ts` (TS1117).

### 11.4 SA code review fixes (Dev, 2026-10-21)

| # | Fix |
|---|---|
| N-1 | `delete/route.ts`: a refusal whose rows all map to nothing answers `[{ code: 'contact_support' }]`. The drawer's `parseBlockers` returns the same for an empty, unreadable or unknown list. Tests in both suites |
| N-2 | `no-store` set on the 429 **at both routes**. `tooManyRequests` is shared by about 30 other callers, so it was left unchanged. Tests |
| N-3 | A counted blocker without a count uses new `…_uncounted` copy (en / he / es + English fallback), never an empty `{n}`. Tests |
| N-4 | Comment in `acknowledgement.ts`: the mark ranges are literal on purpose (Tailwind scans `lib/`, CSS-escape hazard) |
| N-6 | `delete/route.ts`: 413 `body_too_large` above 4 KB, by `content-length` before reading, and by byte length after reading (a chunked body declares none). The check route is a GET and reads no body. Tests |
| N-9 | §11.3 corrected: three `publicEndpointsAreThrottled` routes |

### 11.5 QA B-1 and E-1 fixes, per the SA addendum (Dev, 2026-10-21)

| # | Fix |
|---|---|
| B-1 | `delete/route.ts` `auditRefused`: every `ACCOUNT_DELETION_REFUSED` row now has `userId` = `actorId` = `entityId` = the session user. `details` keep `source: 'self_service'`, the reason code, guard ids, `files_removed` and the correlation id, and never the email, statement or fingerprint. `AuditTrailService` is unchanged. The success row (in-function `ACCOUNT_PSEUDONYMISED`, `user_id` NULL) is unchanged |
| B-1 tests | New `app/api/business-os/account/delete/__tests__/refusalAudit.realService.test.ts` goes through the real `logAndFlush` → `buildLogEntry` → insert, with only `@supabase/supabase-js` faked and `SYSTEM_ADMIN_USER_ID` set to a distinct uuid. (a) wrong statement; (b) a refusal after the storage step (`files_removed` 2) and `not_available`; (c) negative control: a direct `userId: null` row is captured as `SYSTEM_ADMIN_USER_ID` with `system_action: true`. In `route.test.ts`, R-4 and R-15 now expect `userId` / `actorId` (and `entityId`) to be `SUBJECT` |
| E-1 | The pre-check moved out of `ErasureRequestContent` (which now takes `state` as a prop, and with no prop renders today's body and fetches nothing) into two host children in `DangerZonePanel.tsx`: `ErasureDialogBody` (rendered inside the `/business-os/settings` `DialogContent`, holding its header, warning and body) and `ErasureRegion` (the boxed panel's expanded region). Each mounts on open, so there is one check per open and no second dialog |
| E-1 ready state | The description / region heading reads the new `settings.account_delete.title` ("Delete my account" / "מחיקת החשבון שלי" / "Eliminar mi cuenta"), in en / he / es and `FALLBACK_COPY`, with C-26 parity green. The host `delete_warning` is not rendered: in the dialog it is dropped, and in the boxed panel the header box is hidden while the region is open and ready, and comes back on close. `DialogTitle` and `DialogDescription` stay |
| E-1 other states | Off, loading, error and unexpected shape render exactly today's text and markup. The header and warning markup moved verbatim from `app/business-os/settings/page.tsx` into `ErasureDialogBody`. `delete_dialog_title` was added to `FALLBACK_COPY` (byte-identical to `en`) because it now resolves through the shared `tr` |
| E-1 tests | `DangerZonePanel.selfDelete.test.tsx` was rewritten as per-host render tests. Settings dialog: off, ready, failed check. Boxed panel: off with reopen, ready with close, blockers, unexpected shape. They check the heading text, the warning shown exactly once, the accessible name and description, and one fetch per open. The QA keyboard harness and the settings page test mock now use `ErasureDialogBody` |

## SA Review Notes

*(SA to populate.)*

## QA Testing Report

*(QA to populate.)*

## Commit Info

*(RM to populate. Manual gate: no auto-merge.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Workplan created (Dev) | Against requirement SA Review 2 + user decisions 2026-10-18; 20 tasks, ~2.75 d; O2-1 … O2-7 for SA; X-1 … X-6 differences from the requirement text |
| 2026-10-18 | SA workplan review: approved with conditions | O2-1 … O2-7 ruled; X-1 … X-6 accepted (X-2 / X-4 go to the user as business defaults); conditions V-1 … V-10. Start only after DE-10b.1 merges and 20261080 / 20261081 are applied |
| 2026-10-21 | Code complete (Dev) | Tasks 1–19 done, uncommitted. Notes in §11: D2-1 … D2-14 for SA (V-2 runner, mirrored normaliser, inline drawer for V-8, E-2 / I-a / E-1 follow-ups) |
| 2026-10-21 | SA code review fixes (Dev) | N-1, N-2, N-3, N-4, N-6, N-9 applied, uncommitted; N-5, N-7, N-8 left as recorded (§11.4) |
| 2026-10-21 | QA B-1 and E-1 fixed (Dev) | B-1: refusal rows on the session user, real-`buildLogEntry` test with negative control. E-1: host-owned pre-check per open, "Delete my account" heading, one warning. Uncommitted (§11.5) |
| 2026-10-21 | SA code review: ✅ Code Approved for QA | V-1 … V-10 met; D2-1 … D2-14 accepted; no blocking items; non-blocking N-1 … N-9, follow-ups F-1 … F-3; QA plan split pre-merge local / post-deploy prod. See § SA Code Review — 2026-10-21 |
| 2026-10-21 | SA addendum: QA B-1 and E-1 ruled | B-1: the refusal row goes on the session user (userId = actorId = entityId), amending O2-4 / C2-10 for refusals; test through the real `buildLogEntry`. E-1: the host heading and warning follow the switch, with one pre-check per open. Both required before merge |
| 2026-10-21 | QA pre-merge pass | Every pre-merge item exercised (Jest + a local dev server on dummy Supabase settings, no live DB). Only the 3 known pre-existing suites fail. 3 QA test files added (27 tests). One Medium bug (B-1: the refused-attempt audit row gets the platform admin as `user_id`, not NULL). Post-deploy prod checklist written. See § QA Report — 2026-10-21 (pre-merge) |
| 2026-10-21 | QA re-test of B-1 and E-1 | Both fixed and verified through the real `buildLogEntry` and per-host render tests. 2 more QA test files (16 tests). Only the 3 known pre-existing suites fail. Post-deploy N-2 amended. Ready for SA re-review of the fix diff, then commit. See § QA re-test — 2026-10-21 |

---

## SA Workplan Review — 2026-10-18

**Reviewed by SA — 2026-10-18**
**Status:** ⚠️ Approved with conditions (V-1 … V-10). Hard dependency: DE-10b.1 merged **and** 20261080 + 20261081 applied on prod. No branch is cut before then (no stacking).
**Evidence:** `lib/supabaseServerAuth.ts` read: its cookie `set` / `remove` are `async () => {}`, so X-1 is correct. A server-side `signOut({ scope: 'local' })` makes no network call and clears nothing through that client. `lib/supabaseClient.ts` is `createBrowserClient` from `@supabase/ssr` (cookie storage), so a client-side local sign-out does clear the browser's copy. `rateLimit(request, route, …)` takes a free route string, so the per-account key in §2.4 fits. `emailTransport` `{ kind: 'transactional' }` needs no `ownerUserId`. `featureFlags.ts` readers are all `is…Enabled`.

### Rulings on the open items

| # | Ruling |
|---|---|
| O2-1 | **Yes.** Check route `200 { enabled: false }` before `getUser()`; delete route 404 when off. The flag state is not a secret |
| O2-2 | **Yes.** Per account + IP via the hashed route key, wrong statements in the failure budget, fail-open accepted (the session plus the server-held statement is the gate; BQ-11 no) |
| O2-3 | **Yes.** The in-function `ACCOUNT_PSEUDONYMISED` row is the success record. It commits with the deletion, so a route-level row would be a second, weaker copy |
| O2-4 | **Audit it** as `ACCOUNT_DELETION_REFUSED`, reason code only, `user_id = NULL`, `entity_id` = subject (C2-10). The rate limit bounds the volume |
| O2-5 | **Helper approved (X-1).** Conditions in V-3 |
| O2-6 | **Yes**, with `lang` validated against `en` / `he` / `es`, default `en`, never echoed raw |
| O2-7 | **Defer to release 3: yes.** The list is built from `profiles`, which anonymise deletes, so TQ-21 "hidden by default" already holds. The toggle comes with the receipts lookup |

### Rulings on the differences from the requirement (§9)

| # | Ruling |
|---|---|
| X-1 | Accepted (O2-5). TQ-19's "`signOut({ scope: 'local' })`" is met on the client. The server expires the cookies |
| X-2 | Technically accepted. **Business default for TL below (a)** |
| X-3 | Accepted (O2-7) |
| X-4 | Technically accepted: draft in `docs/legal/`, with the docs header block. **Business default for TL below (b)** |
| X-5 | Accepted: R-1 / R-4 supersede §10.1's never-paid split. Tests follow R-1 / R-4 |
| X-6 | Accepted (DE-10b.1 O-11) |

### Conditions

- **V-1 Identity.** Both routes take `user.id` and `user.email` from `createAuthenticatedServerClient().auth.getUser()` only. If `user.email` is missing (a phone-only login), answer `available: false` / 503, never call the engine. Route test.
- **V-2 Engine access.** The routes do not import `TestAccountCleanupRepository`. The check route goes through a runner function next to `runAccountAnonymise` (for example `runAccountDeletionCheck`), so the family-5 allow-list grows by **no** route file. Keep that list to real importers only.
- **V-3 Cookie helper.** Expire only cookies present on the request whose names match `^sb-<project-ref>-auth-token(\.\d+)?$` and the matching `-code-verifier`, with `path: '/'`, `maxAge: 0`, and the same `sameSite` / `secure` that `@supabase/ssr` writes. Derive `<project-ref>` from `NEXT_PUBLIC_SUPABASE_URL`, never from a cookie name. Set `Cache-Control: no-store` on the success response. Test: an unrelated cookie (for example the language cookie) is left alone.
- **V-4 Client order.** On 200: `signOut({ scope: 'local' })`, then `window.location.replace(redirect)`. The redirect is built only from the server response, and the client checks it starts with `/account-deleted`.
- **V-5 Statement.** `acknowledgement.ts` is pure and has no server import. The server matches against its own `DELETION_STATEMENTS`, and the receipt stores the **matched language** plus the typed text (≤ 500). A `language` in the body that disagrees with the matched one is not an error (R-5 case), but the receipt records the matched one.
- **V-6 Order in the delete route** exactly as §2.3: flag → `getUser` → Zod → rate limit → statement → secret / key → facts → engine. Each step's test asserts the later calls did not happen (R-1 … R-15 as written).
- **V-7 Email after commit**, once, from the local variable, never stored or logged. A send failure never changes the 200 (R-13).
- **V-8 Dialog nesting.** On `/business-os/settings` the Danger Zone body already sits in a dialog. Do not open a second Radix dialog on top: render the drawer steps inside the existing one, or replace it. The keyboard QA pass checks focus and Escape.
- **V-9 Privacy paragraph wording** (C2-12 as amended by SQL-4b): it may say the sign-in log entries **that name the account** are removed. It must not claim the Stripe Customer object was cleaned. It must say that clients' marketing-consent records are kept, and that our billing records are kept without personal details. It must also say that invitations the account sent and that were never used are deleted.
- **V-10 Manual QA note.** Business OS signup is invite-only, so "the old email signs up again" (§4.4 Afterwards) needs an invite for that address. QA records how it was tested.

### CLAUDE.md compliance

| Rule | Finding |
|---|---|
| 1 Repositories | ✅ No direct Supabase call. `findDeletionFacts` and the engine via the DE-10b.1 repository |
| 2 Zod | ✅ `.strict()` `{ statement, language }`, extra keys → 400 (R-3) |
| 3 Pino | ✅ `createLogger` + `correlationId`, ids only. 0 `console.*` in touched files (Dev counted) |
| 4 / security | ✅ Session user only (C2-10), no body id. Dev-only `details` guard |
| Admin gate | n/a (customer routes). The admin label sites keep `requireAdmin` first |
| Audit non-blocking | ✅ `logAndFlush`. The success row is in-function (O2-3) |
| Flags | ✅ `isAccountSelfDeleteEnabled()`, server env, default off, not `use…`. `lint:hooks` in task 19 |
| Entitlements | ✅ No import |
| Tests | ✅ Each route: happy + auth failure + invalid input, plus the ordering cases. Unit tests for every new module. Render tests for drawer, panel and page. Manual QA on prod recorded. All inside the existing Jest gate |

### Business calls (plain language, for TL)

- **(a) Customers on a running plan.** There is no button for a customer to cancel their own plan yet. So in the first release the message must say "Your plan is still running. Contact us to cancel it, then you can delete your account", not "cancel it yourself". The second release adds self-cancel and changes the message. **SA agrees with the TL default: accept.**
- **(b) Where the privacy text lives.** AgentPilot has no platform privacy page today, only each business's own site privacy page. The developer writes the paragraph as a document for the user and the lawyer to place (on a future privacy page, in the terms, or in the sign-up flow). Until then customers see only a short "what we keep" line in the delete drawer. **SA agrees with the TL default: accept.** It does not block the release, because the switch stays off until the user turns it on.

### New business questions (plain language)

- **NQ-1 Should a customer whose account an admin deleted get the same "your account was deleted" email?** In the first release, only a customer who deletes their own account gets that email. When an admin deletes it at the customer's request, nobody emails them automatically, and the admin tells them by hand. Adding it is small once this slice exists. **SA suggestion:** yes, send it, as a small follow-up after this slice.
- **NQ-2 Unused invitations.** When an account is deleted, invitations it sent that were never used stop working (decided in the DE-10b.1 review). Is that what you want? **SA suggestion:** yes.

### Approval

[x] Workplan approved with conditions V-1 … V-10. Implementation starts only after DE-10b.1 is merged and both migrations are applied on prod.

---

## SA Code Review — 2026-10-21

**Code Review by SA — 2026-10-21**
**Status:** ✅ Code Approved for QA. Nothing blocks. N-1 … N-9 below are non-blocking. Dev may take N-1 and N-2 in the same PR if they are cheap.
**Scope reviewed:** the uncommitted diff on `feature/data-export-de10b2` (HEAD = `origin/main` `ff4a676f`, DE-10b.1 #468 included). That is 20 modified files (+447 / −45; the 26 deletions in this workplan are only task-list checkbox flips) and 34 untracked files. Every new file was read in full.

### Evidence (re-run by SA in this worktree, on Windows)

| Check | Result |
|---|---|
| Touched suites (`app/account-deleted`, `app/api/business-os/account`, both admin label routes, `lib/business-os/account-deletion`, `lib/business-os/purge` incl. `no-deletion-paths` family 5, `components/business-os/purge`, `components/business-os/account-deletion`, `emailTransport*`, `featureFlags`, `test-account-cleanup`) | **53 / 53 suites and 947 / 947 tests pass** |
| Guard / neighbour suites (`lib/security`, `lib/__tests__/supabaseFetch`, `components/business-os/settings`, `app/invite`, `lib/business-os/__tests__`, translations, hooks) | 92 pass and 3 fail (5 tests). `supabaseFetch` fails on the dev ceiling. `publicEndpointsAreThrottled` fails on **3** routes with Windows paths: `book/manage/[token]/calendar`, `public/consent-copy` and `public/invoice/[id]/pay` (Dev's §11.3 names only the first). `upgradeModal.guard` fails on (j), CRLF. **All pre-existing:** HEAD equals `origin/main`, and this diff touches neither those test files nor the files they assert on. So they fail the same way on `origin/main` |
| Scoped `tsc --noEmit` (all new and touched source files, 8 GB heap) | Clean, apart from the pre-existing TS1117 duplicate keys in `translations/en.ts` / `es.ts`. No new `settings.account_delete.*` key is duplicated in any language |
| `eslint` on every new or touched source file | Clean |
| `console.*` in new or touched source files | 0 |
| Entitlements import | None |
| `@supabase/ssr` in `node_modules` | Version 0.6.1, `DEFAULT_COOKIE_OPTIONS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 d }`. The helper's attributes match |
| Regex bytes in `acknowledgement.ts` (checked with `od`) | U+200E, U+200F, U+202A–U+202E, U+2066–U+2069; U+200B–U+200D, U+FEFF; U+0591–U+05C7. The ranges are correct |

### Conditions V-1 … V-10

| # | Verdict |
|---|---|
| V-1 Identity | ✅ `readSessionSubject()` uses `createAuthenticatedServerClient().auth.getUser()`, not the cached `lib/auth` reader (D2-7). A phone-only login gets `available: false` / 503 and the engine is not called (tested in both routes). The `.strict()` body rejects `email` / `userId`. The check route ignores the query string (tested) |
| V-2 Engine access | ✅ Neither route imports `TestAccountCleanupRepository`. Family 5 grew only by `selfServiceDeletion.ts` and its test. Both routes are pinned as non-importers, with a negative fixture on the real delete-route path |
| V-3 Cookies | ✅ Expires only cookies on the request that match `^sb-<ref>-auth-token(-code-verifier)?(\.\d+)?$`, with `<ref>` taken from `NEXT_PUBLIC_SUPABASE_URL`. Attributes: `Path=/`, `Max-Age=0`, `SameSite=Lax`, no `Secure`, no `Domain`, so an existing non-Secure cookie can be overwritten. `bos_language` and `-auth-token-user` are left alone (tested). Every JSON answer is `no-store` |
| V-4 Client order | ✅ `signOutUser({ scope: 'local' })` runs first and never rejects. Then `location.replace` goes only to `/account-deleted` or `/account-deleted?…`, and any other redirect falls back to the bare path (tested with a foreign redirect) |
| V-5 Statement | ✅ Pure module with no server import (tested). It mirrors `normaliseConfirmation`, and a parity test pins the two. D2-2 is accepted because `confirmation.ts` pulls in a server repository. The receipt stores the **matched** language and the exact typed text (tested with English typed under `language: 'he'`) |
| V-6 Order | ✅ flag → `getUser` → JSON + Zod → throttle → statement → email / secret / key → facts → engine → cookies → email. The ordering test asserts this sequence. Each refusal test asserts that the later calls did not run |
| V-7 Email | ✅ Sent once, after the anonymise has committed, from the local variable. It uses `redactRecipientInLogs` and a 5 s cap, and the outcome is logged as a word. A rejected send and `sent: false` both keep the 200 (R-13) |
| V-8 Dialog nesting | ✅ `ErasureRequestContent` swaps its body for `DeleteAccountDrawer` in place, with no second Radix dialog. While loading, off, failed or given an unexpected shape, it keeps today's body (4 tests) |
| V-9 Privacy paragraph | ✅ `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` says the sign-in log entries that name the account are removed. It does not claim the Stripe Customer was cleaned (it says Stripe keeps its own records). It says clients' consent records are kept, that billing is kept without personal details, and that unused invitations are deleted. The docs header block and Change History are present |
| V-10 Manual QA note | Carried to the QA list below |

### Points checked on request

- **Receipt callback (D2-3).** The callback throws when the login the check resolved is not the session user. `runAccountAnonymise` then stops at the `receipt` stage, before `emptyStorage`. A route test drives the route's own callback with another id and gets 500 with `filesRemoved: false`. `runAccountDeletionCheck` also refuses `canDelete` when `targetUserId` does not match.
- **Throttle.** The key is `account-delete:<16 hex sha256(user id)>`, and the limiter adds the hashed IP, so attempts count per account and per IP. Wrong statements also hit the failure bucket. It fails open, as `rateLimit` documents (O2-2).
- **Refused audit.** `ACCOUNT_DELETION_REFUSED` with `userId: null`, `actorId: null` and `entityId` = subject. Details hold the reason, guard ids, file count and correlation id, written through `logAndFlush`. R-15 scans every log and audit argument for the email, the statement text and any 64-hex string, across a success, a storage failure and a thrown engine.
- **Logs.** Engine errors are logged as `{ kind, code, name }` only, which closes QA E-1.
- **Blocker copy.** The coverage test reads `'G-…'::text AS guard` from the 20261081 file: 22 ids, all mapped. Unknown ids and `__proto__` map to `contact_support`. G-9 is split by its item text. The "unpaid invoice(s) owed to this business" row is `blocked = false, info = true` in both anonymise variants of the SQL, so sent and overdue invoices show as notes (TL-6). The G-6 copy says "Contact us at {support} to cancel it, then you can delete your account" (X-2 / business call (a)). The billing line shows for G-5 **or** G-7 and does not say money was paid (G-7 / I-a, render test).
- **`.invalid`.** `Dana <x@deleted.invalid>` and trailing spaces are now refused (E-2, tested).
- **`/account-deleted`.** Matched exactly in the middleware skip list (before the `/v2` rewrite) and in `PlatformChrome` `PUBLIC_EXACT`. `?lang=` is validated and never echoed. The page reads no session and is `noindex`.
- **Translations.** The 20 `settings.account_delete.*` keys are the same set in en / he / es. The existing C-26 test pins `FALLBACK_COPY` ↔ `en` equality.
- **Admin labels.** `adminAccountLabel` is applied in `user-emails` and in both drill-down maps. Joins and ids are unchanged. This slice adds no Supabase call and no new input to either route, so it does not widen their pre-existing rule-1 / Zod gaps (follow-up F-1).

### Code Review Comments

None blocking.

### Optimisation Suggestions (non-blocking)

1. **N-1** `app/api/business-os/account/delete/route.ts:269-270`: if the anonymise refuses and every row maps to `null` (G-12 only), `toBlockerViews` returns `[]`. The client then gets a 409 with no blockers and shows the statement box again with no message. This cannot happen today, because `checkAllowsRun` passes a G-12-only check. Still, mirror the runner's rule: an empty view list becomes `[{ code: 'contact_support' }]`. Apply the same fallback in the drawer's `parseBlockers` when it returns `[]`. Priority: Low
2. **N-2** `tooManyRequests()` answers without `Cache-Control: no-store` on both customer routes. A 429 carries no data, so this is hygiene only. Priority: Low
3. **N-3** `DeleteAccountDrawer.tsx:187`: `{ n: blocker.count ?? '' }` renders "  client payment plans…" when a counted blocker arrives without a count, which happens on a guard-id-only refusal after the check. In that case use copy without `{n}`, or fall back to `contact_support`. Priority: Low
4. **N-4** `acknowledgement.ts` writes the bidi and zero-width ranges as literal invisible characters. That is right: Tailwind scans `lib/`, so `\u` escapes would risk the CSS-escape hazard. Say so in the comment, so nobody later "fixes" them into escapes. Priority: Low
5. **N-5** The failure bucket is checked only after a wrong statement, so a correct statement still goes through once that bucket is spent. This is accepted (the statement is public text and the session is the gate, BQ-11). It is recorded here so it is not reported as a bug later.
6. **N-6** `request.text()` reads the whole body, with no size limit, before Zod caps the statement at 500. The route is authenticated, so the risk is low. A one-line `content-length` cap (for example 4 KB → 413) would close it.
7. **N-7** Copy for the user's native check. The Hebrew email line "אם לא את או אתה ביקשתם זאת" mixes singular and plural. The `/account-deleted` page says the confirmation "is on its way", but the send is best-effort. The Spanish is a draft throughout.
8. **N-8** The support address is still `PLACEHOLDER_ERASURE_CONTACT`, which is a personal mailbox, and it now also goes out in the confirmation email. This was decided (BQ-8). It is a go-live item for the user, not a code change.
9. **N-9** §11.3 lists one `publicEndpointsAreThrottled` failure, but SA sees three on Windows (see Evidence). Same cause, pre-existing. Correct the note.

### Follow-ups (not this slice)

- **F-1** `app/api/admin/user-emails/route.ts` and `app/api/admin/token-usage/drill-down/route.ts` make direct `createClient` Supabase calls (rule 1), and `user-emails` has no Zod body schema (rule 2). Both gaps were there before this slice, which does not make them worse. Backlog item.
- **F-2** Label sites in `execution-stats` and `storage-stats` (§11.1). The placeholder address is not personal, so the label there is a nicety. Backlog, Low.
- **F-3** NQ-1 (send the same email when an admin deletes the account at the customer's request) stays open for the user.

### What QA must exercise

**Before merge, locally (Jest, plus a dev server with the switch unset and then set):**
- The full touched + guard suite list above. Confirm the same 3 pre-existing failures and no new one.
- Switch **unset**, no session: `GET /api/business-os/account/deletion-check` returns `200 { success: true, data: { enabled: false } }` and `POST /api/business-os/account/delete` returns 404. The Danger Zone on `/business-os/settings`, `/v2/settings` and `/settings` is unchanged (export button + Contact us).
- Switch **set** locally, where a dev machine has no cleanup secret: the drawer shows "not available right now" with the support address, and the delete returns 503 and calls nothing. A body with an extra key (`email`, `userId`) returns 400. No session returns 401.
- `/account-deleted` with `?lang=he` (RTL) and `?lang=xx` (English), while signed out: no redirect to login or onboarding, no platform shell.
- A drawer render pass in en and he: the statement box is RTL in Hebrew, pasting enables the button, and the English statement is accepted under the Hebrew UI. One keyboard-only pass: Tab reaches the box, Enter submits, Escape closes the one dialog, and focus returns.

**After deploy, on prod.** The switch is set in Vercel Production for the QA window. Use disposable non-`+test` accounts. Run §4.4 N-1 … Accessibility, plus V-10:
- N-1 happy path end to end. The account is deleted and signed out, and lands on `/account-deleted`. One email arrives. The receipt is `completed` / `anonymised`. An `ACCOUNT_PSEUDONYMISED` row exists and there is no route-level success row. Afterwards the browser holds no `sb-<ref>-auth-token*` cookie (check in devtools), and a protected page sends you to login.
- N-2, a wrong statement forced through devtools: 400, and one `ACCOUNT_DELETION_REFUSED` row with `user_id` NULL and no statement text. Nothing changes.
- N-4, a connected Stripe account and a running plan: a plain-word blocker and no statement box. The plan blocker uses the "contact us to cancel" wording.
- TL-6: one sent invoice does not block. An account with only a past test-mode boost is deleted, its kept rows are blanked, and the billing line shows.
- Afterwards: the old password is refused, and `/admin/users` no longer lists the account. The token-usage drill-down and the user-emails consumers show "Deleted account {ref}". The same address signs up again through a fresh invite (V-10; record how it was tested).
- Vercel logs for each run hold only ids, codes and words: no email, no statement, no 64-hex string.
- Then the user decides whether to keep the switch on or unset it.

### Code Approved for QA: Yes

### Addendum — SA ruling on QA B-1 and E-1 (2026-10-21)

**Status:** ⚠️ The approval above now carries two fixes, **required in this PR before merge**: B-1 and E-1. The off state stays byte-identical, so nothing else in the approval changes. SA reviews the fix diff again, and QA re-runs the affected cases.

**B-1, the refusal row is attributed to the platform. Confirmed, and SA missed it.** `AuditTrailService.buildLogEntry` (`lib/services/AuditTrailService.ts:210-212` in this tree) does `userId = input.userId || SYSTEM_ADMIN_USER_ID || null` and `actorId = input.actorId || input.userId || SYSTEM_ADMIN_USER_ID || null`, and then sets `details.system_action: true`. So `userId: null` writes the row **as the platform admin**. `lib/audit/recordRefusedAccess.ts` documents the same trap. R-15 passed only because it mocks `logAndFlush` and never reaches `buildLogEntry`.

- **Ruling: accept the TL recommendation.** For every `ACCOUNT_DELETION_REFUSED` row the delete route writes, set `userId` = `actorId` = `entityId` = the session user. `details` keeps `source: 'self_service'`, the reason code, guard ids, `files_removed` and the correlation id. The email, the statement text and the fingerprint never go in. No change to `AuditTrailService` (rule 7).
- **This amends O2-4 and C2-10 for refusals only.** A refused attempt leaves the account in place, so the row belongs to the account, as in `recordRefusedAccess` and the purge path. The success row (`ACCOUNT_PSEUDONYMISED`, written in-function with `user_id` NULL) is unchanged.
- **Consequence, accepted.** The 20261081 function deletes `audit_trail` rows by `user_id` (wave 13). So if a refused attempt is followed by a successful delete, the refusal rows go with the account, like every other row of it. The in-function success row is the durable record. A refusal after the storage step (C2-11, files gone, account kept) stays, because the account stays.
- **Prod check N-2 amended:** the refusal row has `user_id` = `actor_id` = the subject, and no `system_action`.
- **Tests Dev must add:**
  1. A new file `app/api/business-os/account/delete/__tests__/refusalAudit.realService.test.ts`. It goes **through the real `buildLogEntry`**: do **not** mock `@/lib/audit/boundedAuditFlush` or `AuditTrailService`. Mock only `@supabase/supabase-js` `createClient` so that `from('audit_trail').insert(rows)` captures the rows, following `lib/services/__tests__/AuditTrailService.writeNow.test.ts`. Set `process.env.SYSTEM_ADMIN_USER_ID` to a distinct uuid. Mock session, rate limit, facts and runner as the route test does.
     - (a) A wrong statement. Exactly one captured `ACCOUNT_DELETION_REFUSED` row with `user_id === SUBJECT`, `actor_id === SUBJECT`, `entity_id === SUBJECT`, `details.reason === 'statement_mismatch'` and `details.system_action === undefined`. Neither id equals `SYSTEM_ADMIN_USER_ID`. The serialised row does not contain the email, the statement text or a 64-hex string.
     - (b) The same assertions for an engine refusal (`blocked` with `filesRemovedThenRefused: true`, so `details.files_removed > 0`) and for `not_available`.
     - (c) Negative control, so the test can fail: through the same harness, a direct `logAndFlush({ …, userId: null, actorId: null })` captures a row with `user_id === SYSTEM_ADMIN_USER_ID` and `details.system_action === true`.
  2. In the existing `route.test.ts` R-15, change `expect(entry.userId).toBeNull()` / `actorId` to `toBe(SUBJECT)` for every refusal row.

**E-1, with the switch on, the `/business-os/settings` dialog still says "Request account erasure" and shows the warning twice.** TL is right: once the switch is on, the host copy contradicts the drawer. **Ruling: required in this PR.**
- **Shape:** one pre-check per open, owned by the host surface. Move the `useAccountDeletionCheck()` call out of `ErasureRequestContent` into a small client child rendered **inside** the open dialog's content (on `/business-os/settings`) or the expanded region (in `DangerZonePanel`). Either way it mounts only when opened, as today. It passes `state` down as a prop to `ErasureRequestContent`, so there is no second fetch and no second dialog (V-8 still holds).
- **Switch on (`ready`):**
  - the dialog description / region heading reads a new key `settings.account_delete.title` ("Delete my account"), in en / he / es and `FALLBACK_COPY`, with the C-26 parity kept;
  - the host's own `delete_warning` box is not rendered, so the drawer's warning is the only one;
  - `DialogTitle` and `DialogDescription` stay present (Radix a11y).
- **Off, loading, error or unexpected shape:** byte-identical to today ("Request account erasure" + the host warning). The existing pins stay green.
- **Tests:** a render test per host (`/business-os/settings` dialog body and `DangerZonePanel`), each in the off state and the ready state: the heading text, the warning shown exactly once, and one fetch of the check route per open.

### SA re-review — 2026-10-21 (B-1 and E-1 fixes, §11.5)

**Status:** ✅ Code Approved for QA re-run. Both addendum conditions are met, and nothing blocks.

- **B-1, approved.** All 7 `auditRefused` call sites go through one helper, which now sets `userId` = `actorId` = `entityId` = the session user. `details` has not changed and still holds no email, statement or fingerprint. `AuditTrailService` is untouched. The success row is unchanged.
- **B-1 test, approved.** `refusalAudit.realService.test.ts` runs the real `logAndFlush` → `buildLogEntry` → insert, with only `createClient` faked and a distinct `SYSTEM_ADMIN_USER_ID`. It covers:
  - (a) a wrong statement;
  - (b) a refusal after the storage step (`files_removed` 2, guards kept) and `not_available` (engine never called);
  - (c) the negative control: a NULL user is recorded as the platform admin with `system_action: true`, so the harness can fail.

  Each case asserts `user_id`, `actor_id` and `entity_id` = SUBJECT, no `system_action`, and no email, statement or 64-hex string. R-4 and R-15 in `route.test.ts` now expect SUBJECT.
- **E-1, approved.**
  - **One check per open, in both hosts.** `ErasureRequestContent` takes `state` as a prop, and without one it renders today's body and fetches nothing. The pre-check is owned by `ErasureDialogBody` (inside `DialogContent` on `/business-os/settings`) or `ErasureRegion` (the boxed panel's expanded region). Each mounts on open, so there is one check per open and no second dialog (V-8).
  - **Ready state.** The description and the region heading read `settings.account_delete.title`, and the host warning is not rendered. `DialogTitle` and `DialogDescription` stay, and the test asserts the accessible name and description.
  - **Off, loading, error.** The header and warning markup moved verbatim from `page.tsx`.
  - **Copy.** `delete_dialog_title` now resolves through the shared `tr`, which prefers the provider, so the BOS page renders the same text. Its `FALLBACK_COPY` entry is byte-equal to `en`. The new key exists once in en / he / es, and the C-26 parity is green.
- **Tests and checks.**
  - **Jest:** the touched suites (account routes, `components/business-os/purge`, account-deletion, data-export, `app/business-os/settings`, `components/business-os/settings`, `lib/business-os/account-deletion`, `no-deletion-paths`) give 70 / 71 suites and 1225 / 1226 tests. The only failure is the pre-existing `upgradeModal.guard` (j, CRLF).
  - **eslint:** one warning, the `page.tsx:228` `exhaustive-deps`, which is pre-existing and also on `origin/main`.
  - **Scoped `tsc`:** the only errors are in `JourneyGapNotice.tsx` and `StripeConnectStatus.tsx`, which this diff does not touch (pre-existing).
- **Non-blocking.** `DangerZonePanel.tsx` now imports the Dialog header primitives for `ErasureDialogBody`. That is fine while it is only rendered inside a `DialogContent`, and the JSDoc says so.
- **QA re-run:** the N-2 prod check uses the amended expectation (`user_id` = `actor_id` = subject, no `system_action`). Re-run the local keyboard pass on both hosts with the switch set: the heading reads "Delete my account", one warning shows, Escape closes, and focus returns.

---

## QA Report — 2026-10-21 (pre-merge)

**QA — 2026-10-21**
**Test mode:** full, for everything that can be proven before merge on a local machine
**Strategy used:** A + B (Jest unit, route and render tests, plus 3 new QA files). C: a local `next dev` on port 3123, started twice (switch unset, then set). It ran with **dummy** `NEXT_PUBLIC_SUPABASE_URL` / anon / service keys and no `.env.local`, so it could not reach the live database. Nobody signed in. D: the keyboard pass and the en / he passes ran as user-event render tests inside the real Radix dialog primitive (a dev-server UI pass needs a signed-in session, which this round may not use).
**Focus:** all (api, ui, security)
**Skipped:** every prod scenario (§4.4 N-1 … Accessibility, V-10). They need the switch on in Vercel Production and disposable accounts. See the checklist below.
**Input source:** prompt (TL: "everything provable BEFORE merge") + SA "What QA must exercise"

### Test runs (this worktree, Windows, HEAD = `origin/main` `ff4a676f` + the uncommitted diff)

| Run | Suites | Tests | Result |
|---|---|---|---|
| Touched suites: `app/account-deleted`, `app/api/business-os/account`, `app/api/admin/user-emails`, `app/api/admin/token-usage` (whole dir), `lib/business-os/account-deletion`, `lib/business-os/purge`, `components/business-os/purge`, `components/business-os/account-deletion`, `emailTransport*`, `featureFlags`, `test-account-cleanup` | 55 / 55 | 1032 / 1032 | ✅ Pass. This is wider than SA's 53 / 947: it includes the whole token-usage folder |
| Guard sweep: `lib/security`, `lib/__tests__/supabaseFetch`, `components/business-os/settings`, `app/invite`, `lib/business-os/__tests__`, `lib/business-os/translations`, `hooks`, `middleware`, `components/__tests__` | 93 / 96 | 1636 / 1641 | ⚠️ Only the 3 known pre-existing suites fail (5 tests), see below |
| `npm run test:bos-entitlements` | 301 / 301 | 9162 / 9162 | ✅ Pass. The diff imports nothing from `entitlements/`, and the run is green anyway |
| New QA files (below) | 3 / 3 | 27 / 27 | ✅ Pass. ESLint clean |
| Re-run of guards + new QA files together (`no-deletion-paths`, `lib/security`, `lib/business-os/__tests__`, the account-deletion folders) | 52 / 53 | 829 / 832 | ⚠️ Only `publicEndpointsAreThrottled` (the known 3 routes). The new files trip no guard |

**Why the 3 failures are pre-existing:**

| Suite | Failing case | Proof |
|---|---|---|
| `lib/__tests__/supabaseFetch.test.ts` | "the ceiling on one request › is more generous in development" | It fails the same way on the main checkout `C:\…\neuronforge` (HEAD `e49a4719`, an older main) |
| `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` | `app\api\book\manage\[token]\calendar`, `app\api\public\consent-copy`, `app\api\public\invoice\[id]\pay` (Windows backslash paths) | The same 3 cases fail on the main checkout `e49a4719` |
| `components/business-os/settings/__tests__/upgradeModal.guard.test.ts` | negative control (j) "a button for Current plan" | The file is not on `e49a4719`, so it could not be run there. `git diff --name-only origin/main` shows 0 changed files under `components/business-os/settings`, `lib/security`, `app/api/book`, `app/api/public` and `lib/supabaseFetch*`. The working copy has CRLF line endings (`core.autocrlf=true`), which is the known Windows CRLF source-scan pattern. CI (Linux, LF) is unaffected |

### Local dev-server checks (dummy Supabase settings, nothing signed in)

| Check | Result |
|---|---|
| Switch **unset**: `GET /api/business-os/account/deletion-check` | ✅ `200`, `cache-control: no-store, no-cache, must-revalidate`, body `{"success":true,"data":{"enabled":false},"correlationId":…}` |
| Switch **unset**: `POST /api/business-os/account/delete` | ✅ `404 {"success":false,"error":"not_found"}` |
| `/account-deleted?lang=he`, signed out | ✅ `200`, no redirect. `<main dir="rtl" lang="he">`, Hebrew title. `<body>` opens straight into `<main>` (no platform shell). `robots: noindex, nofollow` |
| `/account-deleted?lang=xx` | ✅ `200`, `<main dir="ltr" lang="en">`, English title |
| `/account-deleted?lang=es` | ✅ `200` |
| `/account-deleted?lang=he` with a stale `sb-…-auth-token` cookie | ✅ `200`, no redirect to login or onboarding |
| Switch **set**, no session: the check route, a valid delete body, an extra `userId` key, an 8 KB body, and a forged auth cookie | ✅ `401 Unauthorized` each time, with `no-store` on the check route. Per V-6 the session is read before the body, so the unauthenticated 8 KB body gets 401 and not 413. That is expected. The 400 / 413 / 503 cases need a session, so the route tests cover them |
| Dev log | No email, no 64-hex string, no error line |

### Test coverage against "What QA must exercise" (pre-merge part)

| Item | Tested? | Result | Where |
|---|---|---|---|
| Touched + guard suites, same 3 pre-existing failures, no new one | ✅ | Pass | runs above |
| Switch unset → check `200 { enabled: false }` without reading the session | ✅ | Pass | dev server. `route.qa.test.ts`, for `unset`, `'false'`, `'1'`, `'TRUE'`, `'true '`, `'yes'`: no session read, no throttle, no engine, no facts, no email, no audit; `data` has only `enabled` |
| Switch unset → delete 404 | ✅ | Pass | dev server. `route.qa.test.ts` (same 6 values, even with an extra `userId` key: still 404, nothing read) |
| Danger Zone unchanged when off, on `/business-os/settings` (dialog) and `/v2/settings` + `/settings` (boxed `DangerZonePanel`) | ✅ | Pass | `DeleteAccountDrawer.qa.keyboard.test.tsx`: inside the Radix dialog, and inside the boxed panel's region, the body is export + Contact us and has no drawer. The check runs only once the panel opens. Existing `DangerZonePanel.*` pins green. `SecurityTabV2` / `SecurityTab` both render the shared `DangerZonePanel`, by source |
| Switch set + no cleanup secret → drawer "not available" with the support address; delete 503, nothing called | ✅ | Pass | new boxed-panel test (`role="status"` + mailto, no box). `delete/route.test.ts` R-6 (secret, key, short key, no email → 503, no facts, no engine) |
| Extra body key → 400 | ✅ | Pass | R-3 (`email`, `userId`, `extra`, missing language, `fr`, empty, 501 chars) |
| No session → 401 | ✅ | Pass | dev server + R-2 + check route |
| Body > 4 KB → 413 | ✅ | Pass | N-6 tests (declared and undeclared length, plus the boundary) |
| `/account-deleted` he (RTL), xx (English), public, no chrome | ✅ | Pass | dev server + `page.qa.test.tsx` (`xx`, `HE`, `''`, `he-IL` → English; es; he has one link and no form, button, nav or aside) + middleware test |
| Drawer en / he: box RTL in Hebrew, paste enables, English accepted under the Hebrew UI | ✅ | Pass | existing render tests + new: the Hebrew statement **typed** key by key with niqqud and a leading U+200F enables the button, and Enter sends the typed text as it is |
| Keyboard-only: Tab reaches the box, Enter submits, Escape closes the one dialog, focus returns | ✅ | Pass | new user-event test inside the real `@/components/ui/dialog`: Enter on the trigger opens it, Tab reaches the box, typing enables the button, Enter POSTs once, the refusal shows in `role="alert"`, there is still exactly one `role="dialog"`, Tab reaches the button, Escape closes it, focus is back on the trigger. Enter with a wrong statement sends nothing |
| Translations: same key set, placeholders kept | ✅ | Pass | new: en / he / es hold the same `settings.account_delete.*` set, and every `{support}` / `{n}` line keeps its placeholder in each language. Spanish has the N-3 uncounted keys (the Dev test says "all three dictionaries" but checks only en and he) |

### Test quality review (against the SA list)

The Dev suites are strong. They cover every V-6 ordering step with "did not run" assertions, the R-15 privacy scan, the receipt callback's other-login stop, and N-1 / N-2 / N-3 / N-6. QA added what was missing:

1. `components/business-os/account-deletion/__tests__/DeleteAccountDrawer.qa.keyboard.test.tsx` (9 tests): keyboard pass in the real dialog, boxed panel off / on / not-available, Hebrew niqqud typed, dictionary parity incl. es.
2. `app/account-deleted/__tests__/page.qa.test.tsx` (6 tests): the `?lang=` fallback values, es, and no interactive chrome in he.
3. `app/api/business-os/account/deletion-check/__tests__/route.qa.test.ts` (12 tests): every non-`'true'` switch value on both routes, with no edge touched.

One gap the mocked tests cannot see is now B-1. The route tests mock `logAndFlush`, so they prove that the route **passes** `userId: null`, not what row is **written**.

### Issues Found

#### Bugs (must fix before commit)

1. **B-1 The refused-attempt audit row is attributed to the platform admin, not written with `user_id` NULL.** — File: `app/api/business-os/account/delete/route.ts` (`auditRefused`), via `lib/services/AuditTrailService.ts` `buildLogEntry`. — Severity: **Medium**
   - Steps to reproduce: build the entry the route passes (`userId: null, actorId: null`, action `ACCOUNT_DELETION_REFUSED`) with `SYSTEM_ADMIN_USER_ID` set. QA ran this as a throw-away Jest probe against the real `buildLogEntry`, and the probe file was then deleted.
   - Expected (C2-10, O2-4, the route's own header, SA post-deploy N-2 check): `user_id` NULL, `actor_id` NULL.
   - Actual: `{"user_id":"<SYSTEM_ADMIN_USER_ID>","actor_id":"<SYSTEM_ADMIN_USER_ID>","system_action":true}`. `buildLogEntry` does `input.userId || systemAdminId || null`. `lib/audit/recordRefusedAccess.ts:78-83` documents this exact trap ("would attribute a customer's refusal to the platform"). `SYSTEM_ADMIN_USER_ID` is set in the local `.env.local` and is probably set in Production. A refusal (wrong statement, not available, blocked, failed) would then show as a platform-admin action, and the prod N-2 check "`user_id` NULL" would fail. Nothing personal leaks (the subject stays in `entity_id`). It is a record-attribution defect.
   - For Dev / SA: how a NULL `user_id` row is written is a shared-service choice (an explicit opt-out of the fallback, or a documented acceptance of the system-admin row with `system_action: true`). That is SA's call (rule 7). Add a test that runs through the real `buildLogEntry` rather than a mocked `logAndFlush`.

#### Performance Issues (should fix)

None found. The check route makes one read-only engine call plus one facts read. The email is capped at 5 s.

#### Edge Cases (nice to fix)

1. **E-1 (Low, copy).** With the switch on, the `/business-os/settings` dialog keeps its own header "Request account erasure" and its "This will delete all your data…" box above the self-delete steps, so the warning appears twice. The boxed panel's region heading is also "Request account erasure". Deletion is now immediate, not a request. This is a copy decision for TL / the user, together with the N-7 native check.
2. **E-2 (Low, a11y).** While deleting, the textarea is `disabled`. In a real browser, focus leaves a control when it becomes disabled, so after a refusal a keyboard user may have to Tab back from the start of the dialog. The `role="alert"` is still announced. jsdom does not model this, so check it in the prod keyboard pass.
3. **E-3 (Low).** Once the failure budget is spent, a wrong statement still writes its `ACCOUNT_DELETION_REFUSED` row before answering 429. The write rule bounds this at 20 per 5 min per account + IP. Hygiene only. (N-5, a correct statement after the failure budget is spent, is accepted by SA and not reported.)

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **B-1 (Medium)**, or an SA ruling that accepts the system-admin attribution and updates C2-10 / the post-deploy N-2 check. Everything else provable before merge passes. No High bug is open.

### Post-deploy prod checklist (owed after merge; the switch is ON in Vercel Production only for the QA window)

**The user provides:**
- (a) **At least 6 disposable accounts** with addresses that are **not** `+test`. Business OS signup is invite-only, so each needs an invite: N-1, N-3, N-4 Stripe, Running plan, TL-6 invoice, Paid-in-the-past. One account can serve N-2 and then the Hebrew pass, because N-2 changes nothing.
- (b) **`BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED=true`** in Vercel Production, then a redeploy. Afterwards, keep it or unset it and redeploy.
- (c) Confirmation that **`DELETION_RECEIPT_FINGERPRINT_KEY`** (≥ the length `isFingerprintKeyAvailable` requires) and **`TEST_CLEANUP_SECRET`** are set in Production. If either is missing, every drawer says "not available".
- (d) A mailbox QA can read for each disposable address (the confirmation email).
- (e) Access to the SQL editor (read-only selects), to Vercel logs, and to an admin login for `/admin/users` and the token-usage drill-down.

| # | Steps | Pass when |
|---|---|---|
| P-0 | Before the switch is set: open Settings → Danger Zone on `/business-os/settings` and `/v2/settings` with any account | Today's body (Download my data + Contact us). `GET /api/business-os/account/deletion-check` answers `{enabled:false}` |
| N-1 | Account A (free, nothing connected, has exported once): Settings → Danger Zone → Delete → type the English statement → Delete my account forever | The browser lands on `/account-deleted?lang=en` without passing through login. Devtools → Application → Cookies: no `sb-<ref>-auth-token*` cookie is left. Opening `/business-os` sends you to login. Exactly **one** email arrives, with no name or business name. SQL: `select status, mode, origin, executor_kind, statement_language, owner_last_export_ready_at from business_os_deletion_receipts where subject_user_id = '<A id>'` → one row: `completed`, `anonymised`, `owner`, `self_service`, `en`, timestamp present. `audit_trail`: one `ACCOUNT_PSEUDONYMISED` row for `entity_id = <A id>` and **no** route-level success row |
| N-2 | Account B: open the drawer, then in devtools run `fetch('/api/business-os/account/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({statement:'nope',language:'en'})})` | `400 statement_mismatch`. One `ACCOUNT_DELETION_REFUSED` row, `entity_id = <B id>`, `details.reason = 'statement_mismatch'`, no statement text. **`user_id` NULL only once B-1 is fixed.** If B-1 is accepted instead, the expected value is the system admin + `system_action: true`. B still signs in and has all its data |
| N-2b | Account B, devtools: the same call with `{statement:'…',language:'en',userId:'<another id>'}` | `400 invalid_body`, nothing changes |
| N-3 | Account C, which has **never** exported: delete with the statement | Deleted as N-1. The receipt has `owner_last_export_ready_at` and `owner_export_downloaded_at` NULL and `admin_export_existed` false ("no export on record") |
| N-4 | Account D with a connected Stripe (Connect) account: open the drawer | The plain-word line "Your Stripe account is still connected…", **no** statement box, no Delete button. A forced POST answers `409 blocked` with `stripe_connected`, and nothing is removed |
| Running plan | Account E on a running BOS plan: open the drawer | "Your plan is still running. Contact us at {support} to cancel it, then you can delete your account." with the mailto. No box |
| TL-6 | Account F with one **sent** invoice to a client: delete | Not blocked, deleted. The invoice rows are gone with the account |
| Paid in the past | Account G with only a past **test-mode** boost: open the drawer, then delete | The billing line "We keep your payment history with us, with your personal details removed" shows. Deleted. The kept billing rows for G have their personal fields blanked (spot-check one row) |
| Afterwards | For A (and C): sign in with the old password · `/admin/users` · the token-usage drill-down and a finance page that resolves login emails · a **fresh invite** to A's old address, then sign up | Password refused · A not listed · shown as "Deleted account {ref}" (12 hex), never the old email · the sign-up succeeds as a new account with an empty business (V-10: record that it went through a new invite) |
| Hebrew | Account B with the UI in Hebrew: open the drawer, then type the Hebrew statement with niqqud added (e.g. `הוֹרַדְתִּי`) and delete | The drawer and box are RTL, the button enables, the account is deleted, and it lands on `/account-deleted?lang=he` (RTL). The email is in Hebrew (N-7 native wording check) |
| Accessibility | Any ready account, keyboard only: Tab to Danger Zone → Enter → Tab to the box → type a wrong statement → Enter → read the error → Escape | Focus stays inside the one dialog. The error is announced (`role="alert"`). E-2: after the refusal, note where focus is. Escape closes the dialog and focus returns to the Delete button. No second dialog at any point |
| Logs | Vercel → logs for `/api/business-os/account/*` over every run above | Only ids, guard ids, codes and words (`sent` / `not_sent`). Search for each disposable address, the statement words and `[0-9a-f]{64}`: 0 hits |
| Close | The user keeps the switch on, or unsets it and redeploys | P-0 holds again if it was unset |

---

## QA re-test — 2026-10-21

**QA — 2026-10-21.** This re-tests B-1 and E-1 after Dev §11.5 and the SA addendum. Same rules as before: no live DB, no Vercel, no stash, no commit.

| Item | Result | Evidence |
|---|---|---|
| **B-1** every `ACCOUNT_DELETION_REFUSED` row is on the session user | ✅ Fixed | `auditRefused` now passes `userId` = `actorId` = `entityId` = `subjectId`. It is the route's only `logAndFlush` site, and the check route writes no audit. Dev's `refusalAudit.realService.test.ts` (4 tests, incl. the negative control that a NULL user becomes `SYSTEM_ADMIN_USER_ID` + `system_action`) passes. The QA probe is now kept as `refusalAudit.qa.allPaths.test.ts` (10 tests). It goes through the real `logAndFlush` → `buildLogEntry` → insert with `SYSTEM_ADMIN_USER_ID` set and covers **every** refusal path: wrong statement past the failure budget (429), no login email, missing fingerprint key, facts unreadable, blocked on the check (G-8), unavailable after storage (`files_removed` 3), storage-stage failure, engine throw (its message holds the email), and the receipt callback that resolved another login. Each writes exactly one row with `user_id` = `actor_id` = `entity_id` = subject, `entity_type 'user'`, no `system_action`, and no email, statement (en or he), 64-hex string or other id. The success path writes **no** route-level row |
| **E-1** the host heading and warning follow the switch | ✅ Fixed | Dev's per-host `DangerZonePanel.selfDelete.test.tsx` passes, as do the keyboard harness (now on `ErasureDialogBody`, all 9 green, incl. one dialog, Escape, and focus back on the trigger) and `downloadMyData.render.test.tsx`. New `DangerZonePanel.qa.e1.test.tsx` (6 tests): the settings dialog checks **once per open** (open 1, close 1, reopen 2). While the check is loading, both hosts show exactly today's text (one host warning, export button, "Request account erasure"). Hebrew, ready: the dialog's accessible description is "מחיקת החשבון שלי", no host warning, exactly one warning (the drawer's), drawer RTL. Hebrew, off: today's Hebrew description and one host warning. Boxed panel in Hebrew: ready → the region is named "מחיקת החשבון שלי" with one warning, and closing brings the host warning back. The off-state markup was compared with the `origin/main` block in `app/business-os/settings/page.tsx`: the classes, `DialogTitle` / `DialogDescription` and the warning box are the same |
| Touched suites (+ `app/business-os/settings`, `AuditTrailService` tests) | ✅ 70 / 70 suites, 1235 / 1235 tests | + `DangerZonePanel.qa.e1.test.tsx` run separately: 6 / 6 |
| Guard sweep | ⚠️ 93 / 96 suites, 1636 / 1641 tests | Only the 3 known pre-existing suites fail (`supabaseFetch` dev ceiling, `publicEndpointsAreThrottled` × 3 Windows paths, `upgradeModal.guard` (j) CRLF), same cases as the first pass |
| `npm run test:bos-entitlements` | ✅ 301 / 301 suites, 9162 / 9162 tests | |
| New QA files | ESLint clean | `app/api/business-os/account/delete/__tests__/refusalAudit.qa.allPaths.test.ts`, `components/business-os/purge/__tests__/DangerZonePanel.qa.e1.test.tsx` |

**Post-deploy checklist amendments** (they supersede the rows above where they differ):

| # | Steps | Pass when |
|---|---|---|
| N-2 (amended) | As above: the wrong statement forced through devtools | `400 statement_mismatch`. SQL: `select user_id, actor_id, entity_id, details from audit_trail where action = 'ACCOUNT_DELETION_REFUSED' and entity_id = '<B id>' order by created_at desc limit 1` → `user_id` = `actor_id` = `entity_id` = B's id. `details.source = 'self_service'`, `details.reason = 'statement_mismatch'`, **no** `details.system_action`, no statement text, no email. B is unchanged |
| N-1 (addition) | After A is deleted | Any earlier refusal rows of A are gone with the account (wave 13 deletes by `user_id`, SA addendum). The in-function `ACCOUNT_PSEUDONYMISED` row remains |
| P-0 / E-1 | With the switch off: open the `/business-os/settings` delete dialog and the `/v2/settings` Danger Zone | Today's text: "Request account erasure" + one red warning + Download my data + Contact us |
| E-1 (on) | With the switch on, a ready account, en and he | Dialog description / region heading "Delete my account" / "מחיקת החשבון שלי". The red warning appears **once** (the drawer's). Closing and reopening runs one check per open (devtools Network: one `deletion-check` per open) |

**Open (Low, unchanged):** E-2 (focus after a refusal, check it in the prod keyboard pass) and E-3 (refusal rows past the failure budget, bounded).

**Verdict:** ✅ B-1 and E-1 are fixed and every pre-merge item passes. No bug is open. Ready for commit once SA has re-reviewed the fix diff, as the addendum requires. The prod checklist is owed after merge.
