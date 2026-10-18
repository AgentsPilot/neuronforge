# Workplan: DE-10b.2 — Customer self-delete (every account without a running plan)

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md). Binding, in this order: *User decisions 2026-10-18 (after SA Review 2)* → *TL SQL results 2026-10-18* → *SA Review 2* (R-1, R-4, TQ-10, TQ-11, TQ-19, TQ-21, C2-5, C2-10, C2-12, §F DE-10b.2 row) → the rest. §3 (drawer, statement, server check) and §10.1 DE-10b.2 stand, except where R-1 changed them: there is no "never paid only" path and no hard delete for customers.
**Depends on:** [DE-10b.1](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B1_WORKPLAN.md) **merged, with 20261080 + 20261081 applied on prod**. This slice calls `runAccountAnonymise` and the `anonymise` modes and adds no migration.
**Branch:** a new branch cut from `main` **after** DE-10b.1 merges (RM creates it, proposed `feature/data-export-de10b2`). It is not `feature/data-export-de10b`, and it is not stacked on it (the stacked-PR trap).
**Date:** 2026-10-18
**Status:** Planning (waiting for SA workplan review)
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
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

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

- [ ] 1. After DE-10b.1 merges: RM cuts the branch from `main`. Confirm with `git branch --show-current`. Grep every admin consumer of `listUsers` / `getUserById` and record them here (label sites)
- [ ] 2. `isAccountSelfDeleteEnabled()` + test + `feature_flags.md`
- [ ] 3. `acknowledgement.ts` + statement guard tests
- [ ] 4. `blockerCopy.ts` + the guard-coverage test
- [ ] 5. `schemas.ts` (bodies and responses, `.strict()`)
- [ ] 6. `authCookies.ts` + test
- [ ] 7. `deletionEmail.ts` + test
- [ ] 8. `GET /api/business-os/account/deletion-check` + route tests
- [ ] 9. `POST /api/business-os/account/delete` + route tests R-1 … R-15
- [ ] 10. `no-deletion-paths` family 5: add the delete route (and the check route) to the importer allow-list, with the negative fixture kept
- [ ] 11. `hooks/useAccountDeletionCheck.ts`
- [ ] 12. `DeleteAccountDrawer.tsx` + render tests
- [ ] 13. `DangerZonePanel` / `ErasureRequestContent` switch + fallback copy + existing pins
- [ ] 14. Translations en / he / es (Spanish marked draft). Native-check request noted for the user
- [ ] 15. `/account-deleted` page + render test + middleware public path
- [ ] 16. "Deleted account {ref}" in `user-emails` and `token-usage/drill-down` (+ any site from task 1) + tests
- [ ] 17. Privacy paragraph draft (C2-12 / NBQ-3 / SQL-4b wording) at the location X-4 decides
- [ ] 18. Requirement status splice
- [ ] 19. `npx tsc --noEmit` on touched files, `npm run lint`, `npm run lint:hooks`, the touched suites + guard suites. `git diff --stat` reviewed
- [ ] 20. Hand to SA (uncommitted)

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
