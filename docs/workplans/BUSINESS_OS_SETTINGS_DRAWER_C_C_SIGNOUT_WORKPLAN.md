# Workplan: Business OS settings drawers, Phase C slice C-c (log-out hardening, F-23 / C-8)

> **Last Updated**: 2026-10-16

## Overview

`signOutUser` (`lib/client/auth-actions.ts`) is the one sign-out used by every sign-out control in the product. It has three defects (F-23): no deadline, so a request that never settles leaves the spinner on forever; it clears two storage keys that Supabase never writes; and when the server answers a sign-out with anything other than 401, 403 or 404 (a 5xx, or a network failure), auth-js keeps the session, so the person is sent to the login page while this browser is still signed in. Offir fixed the settings copy of this in `c1a427e6` (2026-09-22). The fix was lost when that commit was merged over the `31976f13` refactor (2026-09-20), which had moved log-out into `signOutUser`. This slice puts the fix into `signOutUser` itself, so every caller gets it. It also goes further than the original in one respect: in this app the session lives in **cookies**, not in `localStorage`, so a shape-matched clear of storage alone would not have signed anyone out.

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md), §0.6 item C-8 and §7 F-23
**Branch:** `fix/signout-hardening-c-c` (worktree `neuronforge-c-c`, from `origin/main` `962f1398`; `origin/main` `09e2d3ad` merged in before code)
**Date:** 2026-10-16
**Status:** SA-approved with conditions (SA-CC-1..16, applied). **Code complete 2026-10-16, not committed.** **SA code review 2026-10-16: ✅ Code Approved for QA** (no blocking findings; CR-CC-1..7 are Low / informational). Awaiting QA.
**Cycle:** Full cycle (auth code shared by seven call sites). No migration, no route, no server change.

---

## Table of Contents

1. [What reading the code found](#1-what-reading-the-code-found)
2. [Analysis summary](#2-analysis-summary)
3. [The new signOutUser behaviour](#3-the-new-signoutuser-behaviour)
4. [Callers and per-caller impact](#4-callers-and-per-caller-impact)
5. [Logging and audit](#5-logging-and-audit)
6. [Files to create or modify](#6-files-to-create-or-modify)
7. [Tests](#7-tests)
8. [Mutation results](#8-mutation-results)
9. [Manual QA](#9-manual-qa)
10. [Risks](#10-risks)
11. [Rollback](#11-rollback)
12. [Hand-offs and out of scope](#12-hand-offs-and-out-of-scope)
13. [Questions for SA and rulings](#13-questions-for-sa-and-rulings)
14. [Task list](#14-task-list)
15. [Verification](#15-verification-code-complete-2026-10-16)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. What reading the code found

Verified against `origin/main` `962f1398` and the installed packages: `@supabase/auth-js` 2.75.1, `@supabase/ssr` 0.6.1.

| # | Finding | Evidence | Effect on the plan |
|---|---|---|---|
| K-1 | **The session is stored in cookies, not `localStorage`.** `lib/supabaseClient.ts` is `createBrowserClient` from `@supabase/ssr`, and in a browser that client's storage is `document.cookie` (`path=/`, `SameSite=Lax`, **not** `httpOnly`, no `domain`, `max-age` 400 days). The key is `sb-<ref>-auth-token`, written whole when it fits or as chunks `.0`, `.1`, … when it does not, with a `base64-` value prefix. | `@supabase/ssr/dist/main/cookies.js` lines 92–103, `utils/constants.js` `DEFAULT_COOKIE_OPTIONS`; `supabase-js` `SupabaseClient.js:52` default `storageKey` | Offir's `clearSessionKeys` only looked in `localStorage` / `sessionStorage`. In this app that clears nothing, so the 5xx case would still have left the browser signed in. **The shape-matched clear must expire cookies.** The storage scan stays as a cheap clean-up of any copy an older build left. |
| K-2 | **auth-js keeps the session on 5xx and on network errors.** `_signOut` calls `admin.signOut(accessToken, scope)`; if that returns an error that is not an `AuthApiError` with status 401, 403 or 404 it returns `{ error }` **before** `_removeSession()`. A network failure is an `AuthRetryableFetchError` (status 0), so it is kept too. | `GoTrueClient.js` lines 1498–1522 | Confirms F-23 (c). |
| K-3 | **`scope: 'local'` still calls the server.** It POSTs `/logout?scope=local` whenever a session exists. So a 5xx on a *local* sign-out also keeps the session; the two invite callers that use `local` have the same defect. | `GoTrueClient.js` line 1508 | The fallback cannot simply be "call `signOut({ scope: 'local' })`": with a session in storage it makes the same failing request. |
| K-4 | **A local sign-out with no session in storage is network-free.** `_useSession` → `__loadSession` re-reads the storage on every call. With no session there is no access token, the server call is skipped, and `_removeSession()` runs: it removes the keys, clears the in-memory state and fires `SIGNED_OUT` to every `onAuthStateChange` listener. | `GoTrueClient.js` lines 1107–1126, 1506–1520, 1986–1995 | **Order of the fallback:** expire the cookies first, *then* call `signOut({ scope: 'local' })`. That call cannot fail on the network, and it tells the rest of the page (`useAuth`, `TestAuthPanel`) that the person has left. |
| K-5 | **`signOut` waits for the auth lock with no timeout.** `signOut` is `_acquireLock(-1, …)`, and in a browser the lock is `navigator.locks`. While a hung global sign-out holds it, a second `signOut` call queues behind it forever. | `GoTrueClient.js` lines 1492–1497, 112–124 | The fallback local sign-out needs its own deadline, and after a **timeout** of the first call it will usually not run at all. The cookie expiry, done outside auth-js, is therefore the step that guarantees the outcome. |
| K-6 | **No server code writes the auth cookie.** `createAuthenticatedServerClient` has no-op `set` / `remove`; the middleware only reads `sb-<ref>-auth-token.N`; no route sets it. The only writer is the browser client. | `lib/supabaseServerAuth.ts:23–26`, `middleware.ts:266–290` | Expiring it from `document.cookie` with `path=/` and no `domain` removes the exact cookie the server reads. SSR is signed out on the next request. No server change is needed. |
| K-7 | **`signOutUser` never redirects; each caller does.** Four callers navigate after `await signOutUser(...)` with no `try/finally`; their redirect runs only if `signOutUser` returns. | §4 below | The "redirect in `finally`" guarantee is delivered as a **contract**: `signOutUser` never rejects and always resolves within a fixed bound. No caller changes, so `page.tsx` is not touched (one-PR rule, C-a works there). |
| K-8 | **There are seven call sites, not three.** `app/(protected)/layout.tsx`, `components/v2/UserMenu.tsx`, `app/admin/components/AdminHeader.tsx`, `app/business-os/settings/page.tsx`, `app/invite/awaiting-payment/SignOutButton.tsx`, `app/invite/useSignedInVisitor.ts`, and the test harness `components/test-business-os/TestAuthPanel.tsx`. No production code calls `supabase.auth.signOut` directly (only comments mention it). | `grep -rn "signOutUser\|auth.signOut"` over `app components lib hooks contexts` | All covered by the guard in §7 G. |
| K-9 | `sb-auth-token` and `supabase.auth.token` are never **written** anywhere in the repo. Three legacy readers still **read** them (`lib/client/agent-api.ts:78`, `components/agent-creation/EditAgentWrapper.tsx:49`, `SmartAgentBuilder.tsx:588`). | grep | Out of scope (AgentsPilot app, parked). Recorded as an observation in §12. |

---

## 2. Analysis summary

| Area | What this slice touches |
|---|---|
| Client auth module | `lib/client/auth-actions.ts`: `signOutUser` (now a single-flight wrapper around `runSignOut`), `PERSON_SCOPED_STORAGE_KEYS` (two wrong literals removed), private `LEGACY_SESSION_KEYS`, private helpers `withDeadline`, `clearSessionByShape`, `countSessionLeft`, `clearPersonScopedKeys`, `describeAuthError`; exported types `SignOutOutcome`, `SignOutResult`, `SignOutOptions`. Sign-in functions are unchanged. |
| Callers | `app/invite/awaiting-payment/SignOutButton.tsx`: proceeds when `ok \|\| clearedLocally` (SA-CC-7). `app/business-os/settings/page.tsx`: **comment only** inside `handleLogout` (SA-CC-1). The other five are unchanged; success behaviour is identical for all seven (§4). |
| API routes, DB, migrations | None. The audit write still goes to `POST /api/audit/log` with the same body. |
| Providers / LLM | None. |
| Entitlements | No import from `lib/business-os/entitlements/`. |
| Tests | New `lib/client/__tests__/auth-actions.signOut.test.ts` (jsdom, fake timers), new guard `lib/client/__tests__/signOutCallers.guard.test.ts`, new `app/admin/components/__tests__/AdminHeader.signOutDeadline.test.tsx`, two cases added to `app/invite/__tests__/awaitingPayment.render.test.tsx`. |

**Pipeline phase:** not applicable (no V6 / pilot code).

---

## 3. The new signOutUser behaviour

### 3.1 Contract

1. **Never rejects.** Every step is wrapped; an unexpected throw anywhere is logged and the function still resolves.
2. **Bounded.** It resolves within `AUDIT_DEADLINE_MS + SIGN_OUT_DEADLINE_MS + LOCAL_FALLBACK_DEADLINE_MS` = 2 s + 5 s + 2 s = **9 s** worst case (test C-3: pending at 8 999 ms, settled at 9 000 ms). `signOut`'s own wait for `initializePromise` is inside the 5 s. Normal case: one audit round trip plus one sign-out round trip, as today.
3. **This browser ends signed out, and says whether that was verified.** After the final clear, cookies, `localStorage` and `sessionStorage` are re-read; `clearedLocally` is true only if no session name is left (SA-CC-3). If one survives (a parent-domain cookie from another writer, say), a `warn` is logged with the count only.
4. **Shape frozen (SA-CC-2).** The parameter object is unchanged; `ok` keeps its meaning ("the server confirmed the requested sign-out") and `error` its meaning; the only new `error` value is `'timeout'`. Two fields are added: `outcome`, `clearedLocally`.
5. **Single flight (SA-CC-6).** One module-level `Promise<SignOutResult> | null`, assigned synchronously before anything awaits and cleared in `finally`. A concurrent second call gets the same promise whatever options it passed (logged at `debug` with its `method`).

The three deadlines are private module constants; the tests use the literal milliseconds (SA Q-6).

### 3.2 Order of operations

| Step | What happens | Deadline | On timeout / error |
|---|---|---|---|
| 1. Audit | If `user?.id`: `auditAuthEvent(USER_LOGOUT, { method, scope })`, body unchanged. Before the sign-out, while a session can attribute it. | **2 s** | Logged `warn`, continue. The timed-out `fetch` is left to finish or die with the navigation. |
| 2. Requested sign-out | `supabase.auth.signOut({ scope })` with the caller's scope. | **5 s** | Classify the outcome (§3.3), continue. |
| 3. Local clear (fallback) | **Only when step 2 was not clean** (`server_error`, `timeout`, `threw`): expire every session cookie and remove matching storage keys (K-1). | — (synchronous) | Storage or cookies disabled: caught. |
| 4. Local sign-out (fallback) | **Only when step 2 was not clean**: `supabase.auth.signOut({ scope: 'local' })`. Storage is already empty, so it makes **no** network call (K-4); it clears the client's memory and fires `SIGNED_OUT`. | **2 s** | After a step-2 `timeout` it usually waits on the auth lock (K-5) and times out here: logged `warn`, continue. Step 3 has already done what matters. |
| 5. Always | Clear by shape again (idempotent; covers a cookie an in-flight refresh re-wrote), then `PERSON_SCOPED_STORAGE_KEYS`, `LEGACY_SESSION_KEYS` and `onboarding_preview_data` from both storages, then re-read and set `clearedLocally`. | — | Storage disabled: caught. |
| 6. Return | `{ ok, error?, outcome, clearedLocally }`. The caller then navigates, as today. | — | — |

**Pattern (SA-CC-4):** `^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier|-user)?(?:\.(?:0|[1-9]\d*))?$`: the default storage key is `sb-<first hostname label>-auth-token`; the chunk suffix mirrors `@supabase/ssr`'s `isChunkLike`. **Expiry string:** `name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`, never `SameSite=None`. The JSDoc next to the clear states the K-6 assumption (the browser client is the only writer; host-only, `Path=/`, not `httpOnly`) and that any future `cookieOptions.domain` must be mirrored there. The optional `Domain=` retry SA allowed was **not** built: `clearedLocally` reports a surviving cookie instead.

**Why not "always local first":** on the success path auth-js already removes the session and fires `SIGNED_OUT`, so steps 3–4 are skipped and success behaves exactly as today. Step 5 runs on success too, but finds nothing to clear.

### 3.3 Outcome classification of step 2

| Step-2 result | `outcome` | Server session | This browser after return | `ok` |
|---|---|---|---|---|
| `{ error: null }` (200, or 401/403/404, which auth-js already treats as signed out) | `signed_out` | Ended (or already gone) | Signed out by auth-js; step 5 no-op | `true` |
| `{ error }`: 5xx `AuthApiError`, `AuthRetryableFetchError` (network, status 0), session read error | `server_error` | **Still alive** on the server (global: every device; local: this refresh token) until it expires | Signed out by steps 3–5 | `false` |
| Promise did not settle in 5 s | `timeout` | Unknown | Signed out by steps 3 and 5 | `false` |
| Promise rejected, or the call threw synchronously | `threw` | Unknown | Signed out by steps 3–5 | `false` |

`error` is the auth-js message, `'timeout'`, or the thrown error's message, as today. On `server_error` with `scope: 'global'`, other devices stay signed in. That is unavoidable from the client and is now visible in the log (§5).

### 3.4 Type change

```typescript
export type SignOutOutcome = 'signed_out' | 'server_error' | 'timeout' | 'threw';

export interface SignOutResult extends AuthActionResult {
  outcome: SignOutOutcome;
  /** True when no session cookie or storage key was found in this browser afterwards. */
  clearedLocally: boolean;
}
```

`signOutUser(opts: SignOutOptions = {}): Promise<SignOutResult>`. `SignOutOptions` is the same `{ scope?, user?, method? }` object, now named. It is no longer an `async function` (it returns the single-flight promise), which changes nothing for an `await`ing caller.

### 3.5 Storage key list

`PERSON_SCOPED_STORAGE_KEYS` drops `'sb-auth-token'` and `'supabase.auth.token'` (F-23 b). They are kept as a private `LEGACY_SESSION_KEYS`, removed from both storages on every path (SA-CC-8), because three legacy readers still look for them (K-9).

---

## 4. Callers and per-caller impact

| Caller | Options | After `signOutUser` | Behaviour on success | Behaviour on failure: today → after C-c |
|---|---|---|---|---|
| `app/(protected)/layout.tsx` `handleLogout` | `scope: 'global'`, `user`, `method: 'app-sidebar'` | Logs if `!ok`, clears local state, `location.replace(marketingLogoutUrl())`; its `catch` also redirects | Unchanged | **Hung:** stuck forever → redirected after ≤ 9 s. **5xx:** redirected while still signed in → redirected and signed out. Not edited. |
| `components/v2/UserMenu.tsx` `handleLogout` | `scope: 'global'`, `user`, `method: 'user-menu'` | Logs if `!ok`, `location.replace(marketingLogoutUrl())` | Unchanged | Same as above. A double click now joins the first run (single flight). Not edited. |
| `app/admin/components/AdminHeader.tsx` `handleSignOut` | `scope: 'global'`, `user`, `method: 'admin-header'` | `setSigningOut(true)`, logs if `!ok`, `location.replace(marketingLogoutUrl())` | Unchanged | Same as above; proven end to end by `AdminHeader.signOutDeadline.test.tsx` (SA-CC-9). Not edited. |
| `app/business-os/settings/page.tsx` `handleLogout` | `scope: 'global'`, `user`, `method: 'settings'` | `setLoggingOut(true)` (dialog cannot close while true), logs if `!ok`, `location.replace(marketingLogoutUrl())` | Unchanged | **The F-23 (a) case:** spinner forever → redirected after ≤ 9 s. **Comment-only edit (SA-CC-1):** the paragraph that claimed "nothing it does can trap someone… cleared regardless" now describes the contract (never rejects, about 9 s, always clears this browser, other devices may stay signed in after a server failure). No line outside a comment changes. |
| `app/invite/awaiting-payment/SignOutButton.tsx` | `scope: 'local'`, no `user` (no audit), `method: 'awaiting-payment'` | **Modified (SA-CC-7):** proceeds to `signInUrl` when `result.ok \|\| result.clearedLocally`; shows the failure and re-enables the button only when `clearedLocally` is false | Unchanged | **Hung or 5xx:** stuck "busy" forever or "failed" while still signed in → goes on to sign-in, signed out. A retry would not help after a hang (the hung call holds the auth lock, K-5). |
| `app/invite/useSignedInVisitor.ts` `signOut` | `scope: 'local'`, `user: { id, email }`, `method: 'invite-page'` | `finally` → `setSigningOut(false)`, visitor `signed_out` (no navigation) | Unchanged | Its `finally` comment becomes true. Previously a 5xx left the visitor signed in while the page showed them signed out, and the signup routes then refused them for carrying a session. See R-9. Not edited. |
| `components/test-business-os/TestAuthPanel.tsx` | `scope: signOutScope`, `user`, no `method` (`'in-app'`) | Reports `ok` / error, stays on the page | Unchanged | Reports the failure; the panel now actually shows "signed out" through `SIGNED_OUT` (K-4). Not edited. |

**Redirect targets are unchanged** (`marketingLogoutUrl()` for four, `signInUrl` for the awaiting-payment page, none for the invite visitor and the harness). `scope`, `user` and `method` are unchanged at every call site.

---

## 5. Logging and audit

**Logger:** the existing `clientLogger.child({ module: 'AuthActions' })` from `@/lib/logger/client` (the browser Pino logger; `createLogger` is the server one). No `console.*`.

| Event | Level | Fields | Message |
|---|---|---|---|
| Second call joins the first | `debug` | `{ method }` | `Sign-out already in progress; joining it` |
| Audit write past 2 s | `warn` | `{ step: 'audit', deadlineMs }` | `Sign-out audit exceeded its deadline; continuing` |
| Requested sign-out not clean | `warn` (`server_error`, `timeout`) / `error` (`threw`) | `{ scope, method, outcome, authStatus, authName, durationMs }` | `Sign-out not confirmed by the server; clearing this browser locally` |
| Local fallback past 2 s, error or threw | `warn` | `{ step: 'local-fallback', outcome }` | `Local fallback sign-out did not complete; session keys already cleared` |
| Unexpected throw inside the flow | `error` | `{ step: 'unexpected', authStatus, authName }` | `Unexpected sign-out failure; clearing locally` |
| Cookies or storage cleared by shape | `info` (only when the count is > 0) | `{ cookies, storageKeys }` | `Session keys cleared by shape` |
| Something survived the clear | `warn` | `{ left }` | `Session keys survived the sign-out clear` |
| Storage unavailable | `warn` | `{ step }` | `Browser storage unavailable during sign-out` |
| Done | `info` | `{ scope, method, outcome, clearedLocally, durationMs }` | `Sign-out finished` |

**Never logged (SA-CC-14):** the email, the access or refresh token, cookie values, cookie or key **names**, the `user` object, `userId`, and the raw error object. The old `logger.error({ err }, 'Sign-out call failed…')` is gone; auth errors are reduced to `authStatus` / `authName`. L-1 seeds a real-shaped `base64-` cookie whose decoded JSON carries an `access_token`, plus a thrown error whose message contains the token, and asserts none of them (nor the email, the cookie name or the user id) appears in any entry, and that no entry has an `err` field. The shared `auditAuthEvent` keeps its existing `warn({ err, action })` for a failed `fetch` (a network `TypeError`, shared with sign-in); not changed in C-c.

**Audit:** unchanged. Same `USER_LOGOUT` body (`details: { method, scope, timestamp }`, `severity: 'info'`, `complianceFlags: ['SOC2']`), same position (before the sign-out), same "only with a `user.id`" rule. The only difference is the 2 s deadline. No new audit event for a failed sign-out (SA Q-5).

---

## 6. Files to create or modify

| File | Action | Reason |
|---|---|---|
| `lib/client/auth-actions.ts` | modify | §3: single-flight `signOutUser` + `runSignOut`; `withDeadline`, `clearSessionByShape`, `countSessionLeft`, `clearPersonScopedKeys`, `describeAuthError` (private); `PERSON_SCOPED_STORAGE_KEYS` fix; `LEGACY_SESSION_KEYS`; `SignOutResult` / `SignOutOutcome` / `SignOutOptions` |
| `app/invite/awaiting-payment/SignOutButton.tsx` | modify | SA-CC-7: proceed when `ok \|\| clearedLocally`; comment updated |
| `app/business-os/settings/page.tsx` | modify, **comment only** | SA-CC-1: the `handleLogout` comment states the contract |
| `lib/client/__tests__/auth-actions.signOut.test.ts` | create | Unit tests §7 |
| `lib/client/__tests__/signOutCallers.guard.test.ts` | create | Source guard §7 G (QA S-5 gap 4, SA-CC-12) |
| `app/admin/components/__tests__/AdminHeader.signOutDeadline.test.tsx` | create | SA-CC-9 caller-level deadline proof |
| `app/invite/__tests__/awaitingPayment.render.test.tsx` | modify | SA-CC-7: two cases; `signOutResult` type widened |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify (Edit) | C-c progress paragraph after C-8, F-30 row in §7, Change History rows |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_C_SIGNOUT_WORKPLAN.md` | create | This file |

**Not modified:** the five other callers and their tests (they mock `signOutUser` and read only `ok` / `error`).

---

## 7. Tests

`lib/client/__tests__/auth-actions.signOut.test.ts`, `@jest-environment jsdom`, `jest.useFakeTimers()`. `@/lib/supabaseClient` is mocked with a controllable `auth.signOut`; `global.fetch` is mocked for the audit; the logger is captured. Cookies are seeded **without** `Secure` (jsdom on `http://localhost` would drop them silently, SA-CC-4).

| # | Case | Asserts |
|---|---|---|
| A-1 | Success, global | one `signOut` with `{ scope: 'global' }`; `{ ok: true, error: undefined, outcome: 'signed_out', clearedLocally: true }`; no fallback; audit POSTed **before** `signOut` with the unchanged body; `jest.getTimerCount() === 0` (SA-CC-5) |
| A-2 | Success, local | `{ scope: 'local' }` passed through |
| A-3 | No `user` | no audit `fetch`; default scope `local` |
| E-1 | 401 (auth-js resolves `{ error: null }` after removing the session itself) | `ok: true`, no fallback |
| D-4 | 403, modelled as E-1 (SA-CC-10) | `signed_out`, one call |
| B-1 | Hung audit | at 1 999 ms `signOut` not called; at 2 000 ms called; `warn` with `step: 'audit'` |
| B-2 | Audit rejects | continues at once |
| C-1 | Hung sign-out, hung fallback (the lock) | pending at 4 999 ms; session gone at 5 000 ms; pending at 6 999 ms; `{ ok: false, error: 'timeout', outcome: 'timeout', clearedLocally: true }` at 7 000 ms; no timer left |
| C-2 | Hung sign-out, fallback completes | fallback `{ scope: 'local' }` sees no session cookie at call time |
| C-3 | Audit, sign-out and fallback all hung (SA-CC-10) | pending at 8 999 ms, settled at 9 000 ms |
| — | A rejection after the deadline (SA-CC-5) | no `unhandledRejection` |
| D-1 | 5xx | `{ ok: false, error: 'Internal Server Error', outcome: 'server_error', clearedLocally: true }`; order `audit → global → local`; `warn` with `authStatus: 500`, `authName: 'AuthApiError'` |
| D-2 | Network error (status 0) | as D-1 |
| D-3 / D-3b | Rejected / synchronous throw | `outcome: 'threw'`, logged at `error`, resolves, cleared |
| — | Fallback fails too | logged `step: 'local-fallback'`; still cleared |
| F-1 | Keys by shape | `sb-abcd-auth-token`, `.0`, `.1`, `.2`, `-code-verifier`, `-code-verifier.0`, `-user` as cookies and in both storages → all gone |
| F-2 | Not a session | `app-theme`, `v2-theme-mode`, `sb-abcd-other`, `my-sb-abcd-auth-token`, `sb-auth-token-backup`, `sb--auth-token`, `sb-a.b-auth-token`, `sb-abcd-auth-token.x` survive, on failure and on success |
| F-3 | Person-scoped + legacy keys | gone from both storages on success and failure; the two literals are not in `PERSON_SCOPED_STORAGE_KEYS` |
| F-4 | `localStorage` getter throws | resolves; cookies cleared |
| SA-CC-3 | A `document.cookie` getter that keeps returning a session chunk | `clearedLocally: false`; `warn` with `{ left: 1 }` only |
| F-5 | Never rejects, one injected failure per row: audit `fetch` throws synchronously, sign-out rejects, sign-out resolves with no value (a throw inside the flow), fallback throws, `document.cookie` getter throws, `sessionStorage` getter throws | resolves every time |
| S-1 | Two concurrent calls (SA-CC-6) | same promise and result object; one audit, one `signOut`; `debug` with the second `method` |
| S-2 | A call after settlement | runs again |
| S-3 | After an injected throw | the slot is cleared; the next call runs |
| L-1 | Logs | see §5 |

`lib/client/__tests__/signOutCallers.guard.test.ts` (SA-CC-12):

| # | Case | Asserts |
|---|---|---|
| — | Roots exist | `app/`, `components/`, `lib/`, `hooks/` are directories (a typo cannot scan nothing); more than 500 files scanned |
| G-1 | No direct sign-out | no `.auth.signOut(` (whitespace-tolerant) outside `lib/client/auth-actions.ts`, comments stripped, skipping `node_modules`, `.next`, `__tests__`, `*.test.*` |
| G-2 | Seven explicit surfaces | each file exists, imports `signOutUser` from `@/lib/client/auth-actions` and calls `signOutUser(`; the settings page contains `signOutUser({ scope: 'global'` |
| G-3 | Negative controls | the scanner flags three direct-call shapes and ignores them inside `//`, `/* */` and JSDoc comments; the import matcher rejects another module |

`app/admin/components/__tests__/AdminHeader.signOutDeadline.test.tsx` (SA-CC-9): real `signOutUser`, `signOut` and `fetch` never settle; at 8 999 ms `location.replace` not called; at 9 000 ms called once with the marketing URL; scopes `['global', 'local']`; no session cookie left.

`app/invite/__tests__/awaitingPayment.render.test.tsx` (SA-CC-7): `{ ok: false, clearedLocally: true }` → `location.assign` to `/login`, no alert; `{ ok: false, clearedLocally: false }` → alert, button enabled, no navigation. The existing `{ ok: false }` case still shows the failure.

---

## 8. Mutation results

One mutation at a time; the named test file(s) run against each.

**Result: 25 of 25 killed, 0 survived** (M-1..M-23; M-9 and M-14 split into a and b). The runner, its mutation table and the raw output are in the Dev scratchpad (`c-c/mutate.py`, `mutations-final.txt`); every source file was restored byte for byte after each run (`git diff --stat` unchanged).

| # | Mutation | File | Killed by |
|---|---|---|---|
| M-1 | Audit deadline 2000 → 20000 | `auth-actions.ts` | B-1, C-3 |
| M-2 | No deadline on the requested sign-out | `auth-actions.ts` | C-1, C-2 |
| M-3 | No deadline on the local fallback | `auth-actions.ts` | C-1, C-3 |
| M-4 | Fallback only on timeout (skipped on `server_error`) | `auth-actions.ts` | D-1, D-2, fallback-fails |
| M-5 | Fallback runs on success too | `auth-actions.ts` | A-1, A-2, A-3, E-1 |
| M-6 | Local fallback before the cookie clear | `auth-actions.ts` | C-1, C-2 |
| M-7 | Cookie expiry removed (Offir's storage-only clear) | `auth-actions.ts` | C-1, C-2, F-1 |
| M-8 | Pattern loses the chunk suffix | `auth-actions.ts` | A-1, C-1, F-1 |
| M-9a | Pattern loses the `^` anchor | `auth-actions.ts` | F-2 |
| M-9b | Pattern makes `-auth-token` optional | `auth-actions.ts` | F-2 |
| M-10 | Person-scoped keys cleared only on success | `auth-actions.ts` | F-3 |
| M-11 | Outer `catch` rethrows | `auth-actions.ts` | F-5 "resolves with no value" |
| M-12 | Audit after the sign-out | `auth-actions.ts` | A-1, A-2, B-1 |
| M-13 | `ok` true after a successful fallback | `auth-actions.ts` | D-1, D-2 |
| M-14a | Raw error object logged | `auth-actions.ts` | L-1 |
| M-14b | Cookie names logged | `auth-actions.ts` | L-1 |
| M-15 | A caller calls `supabase.auth.signOut()` directly | `SignOutButton.tsx` | G-1 |
| M-16 | Scope not passed through (always global) | `auth-actions.ts` | A-2, A-3 |
| M-17 | Single-flight slot not cleared in `finally` | `auth-actions.ts` | S-2, F-3 (later tests join the stale run) |
| M-18 | `clearedLocally` hard-coded `true` | `auth-actions.ts` | SA-CC-3 |
| M-19 | `withDeadline` leaves its timer | `auth-actions.ts` | A-1 (`getTimerCount`) |
| M-20 | `SignOutButton` back to `ok`-only | `SignOutButton.tsx` | awaiting-payment "cleared locally" case |
| M-21 | Chunk suffix widened to `.*` | `auth-actions.ts` | F-2 (`sb-abcd-auth-token.x`) |
| M-22 | Single flight removed | `auth-actions.ts` | S-1 |
| M-23 | Sign-out deadline 5000 → 50000, seen from the caller | `auth-actions.ts` | `AdminHeader.signOutDeadline` |

**Test-hygiene fix found by the mutation run:** the first runs of M-1/M-2/M-3/M-6/M-7/M-8/M-12 were killed, but every test then showed as failed. A failing test left a run hanging in the single-flight slot, so each later test joined it and timed out. The F-4 storage override was then never restored, so the suite crashed while shutting down. The unit test now loads a fresh module per test (`jest.isolateModules`) and restores every property override in `afterEach`. The final run (above) names the real killing tests.

---

## 9. Manual QA

On `next build && next start` (or a Vercel preview), DevTools open on Application → Cookies and Console. "Signed out" means: no `sb-…-auth-token*` cookie on the app origin, and a **reload** of a protected page lands on sign-in. Each row records the `outcome` seen in the `Sign-out finished` console log (SA-CC-11).

**How to make each failure (SA-CC-11):** DevTools **request blocking** and **Offline** fail the request at once (a network error, `AuthRetryableFetchError`), so they exercise `server_error`, **not** a hang. A real hang needs a custom throttling profile with a latency of at least 15 000 ms, applied after the page has loaded. A true 500 is covered by unit test D-1 (Chrome local overrides do not reliably change the status of a `POST`).

| # | Surface | Steps | Expected |
|---|---|---|---|
| Q-1 | Business OS settings → Log out | Normal | Lands on the marketing sign-out → sign-in; reload of `/business-os/settings` → sign-in; Back does not show the app; one `USER_LOGOUT` audit row with `method: 'settings'`; `outcome: signed_out` |
| Q-4 | `/admin` header → Sign out | Normal | As Q-1, `method: 'admin-header'` |
| Q-5 | `/invite/awaiting-payment` → Sign out | Normal | Goes to the sign-in URL; reload stays signed out |
| Q-6 | `/invite?…` signed-in visitor → Sign out | Normal, then again with `*/auth/v1/logout*` **blocked** | Page shows the signed-out state; reload still signed out; the invite can still be accepted after the blocked case (`outcome: server_error`) |
| Q-7 | **Hung sign-out**, settings | Custom throttling ≥ 15 000 ms latency after load, press Log out | Spinner for about 7–9 s, then redirect; cookies gone; reload → signed out; `outcome: timeout` |
| Q-8 | **Failed audit**, settings | Request blocking on `*/api/audit/log*` only (a hang of the audit alone cannot be made in the browser: throttling slows every request; the 2 s audit deadline is unit test B-1) | Redirect with no extra wait; signed out; `outcome: signed_out`; no `USER_LOGOUT` row |
| Q-9 | **Server failure** on sign-out, settings | Request blocking on `*/auth/v1/logout*` | Redirect at once; cookies gone; reload signed out; `outcome: server_error`. Another browser signed in to the same account **stays** signed in (expected, §3.3) |
| Q-10 | Hung sign-out, awaiting-payment | As Q-7 | After about 7–9 s, goes on to sign-in (not "failed"); signed out |
| Q-12 | Theme survives | Sign out, sign back in | Theme unchanged; language/onboarding keys cleared |

Skipped (SA Q-7 ruling): Q-2 user menu, Q-3 sidebar, Q-11 double click. They are AgentsPilot-app surfaces; the shared-function tests, G-2 and single-flight test S-1 cover them.

---

## 10. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | **Double sign-out.** `UserMenu` and the layout have no busy guard. | Low | Single flight (SA-CC-6): a second call joins the first; one audit row, one auth call. |
| R-2 | **Redirect loop.** The marketing site is another origin with its own copy, cleared by its own `/logout` (unchanged). On the app origin, middleware with no cookie sends to sign-in, as after any sign-out today. `SessionRecheckOnRestore` uses `replace`. | Very low | Q-1, Q-4..Q-6 reload checks |
| R-3 | **SSR cookie not cleared.** K-6: the server reads the very cookie the browser writes, `Path=/`, host-only, not `httpOnly`. If a future change sets `cookieOptions.domain`, or another app writes a parent-domain copy, the host-only expiry would not remove it. | Low | JSDoc states the assumption; `clearedLocally` is measured and a survivor is logged (SA-CC-3). |
| R-4 | **Token refresh re-writes the cookie** between the clear and the navigation. | Very low | Step 5 clears again; step 4 clears auth-js's memory; navigation follows. |
| R-5 | **A server failure on global sign-out leaves other devices signed in.** Unavoidable from the client. | Medium (only during an auth outage) | Logged with `outcome: 'server_error'`; no server-side retry in scope. |
| R-6 | **Slower failure paths.** A hung sign-out now ends at ≤ 9 s instead of never. Success path unchanged. | — | — |
| R-7 | **Conflict with C-a** in the requirement MD (both append Change History rows; C-a adds §0.6.1) and on `page.tsx` (C-c: one comment paragraph). | Certain, trivial | Whichever PR opens second merges `origin/main` first (SA-CC-1). |
| R-8 | `navigator.locks` absent (older browsers): auth-js uses a no-op lock, so the fallback is not blocked. | — | Behaviour only improves. |
| R-9 | **Pages that stay put after a hung sign-out.** On the invite page (`useSignedInVisitor`, no navigation) and the test harness, the hung call keeps the auth lock, so a later `getSession` there waits until the browser drops the request. The cookies are already gone, so the person is signed out; the page may just be slow to see it. | Low (needs a hung, not failed, auth request) | Accepted (SA). Recorded so nobody reads a slow `getSession` after a hang as a new defect. |

---

## 11. Rollback

One PR, no migration, no data, no configuration. Revert the merge commit: `signOutUser` returns to today's behaviour, `SignOutButton` to `ok`-only, the settings comment to its old text. The other callers only read `ok` / `error`, so a revert needs no follow-up edits. The new test files go with the revert.

---

## 12. Hand-offs and out of scope

| Item | Where it goes |
|---|---|
| `middleware.ts:273` hard-codes the project ref and reads only chunked `.N` cookies | **F-30** in requirement §7 (Low, not in C-c; with the environment-readiness work). |
| Legacy readers of `sb-auth-token` / `supabase.auth.token` (K-9) | AgentsPilot app, parked. Observation only. |
| `lib/hooks/useUser.ts` (an `auth-helpers-nextjs` client with no importer, SA K-6 note) | Dead file; not this slice. |
| Server-side retry of a failed global sign-out | Not in scope. |

The `handleLogout` comment fix (SA S-5 finding 3) is **in** C-c (SA-CC-1), not handed to C-b.

---

## 13. Questions for SA and rulings

| # | Question | SA ruling (2026-10-16) | Applied |
|---|---|---|---|
| Q-1 | Single-flight? | Yes, with SA-CC-6 | ✅ `inFlightSignOut`; tests S-1..S-3 |
| Q-2 | `SignOutButton` on `clearedLocally`? | Yes, in C-c (a retry does not succeed after a hang) | ✅ SA-CC-7 |
| Q-3 | `LEGACY_SESSION_KEYS`? | Yes, private, both storages, every path | ✅ SA-CC-8 |
| Q-4 | Caller-level integration test? | Yes, a new `AdminHeader` file | ✅ SA-CC-9 |
| Q-5 | Audit a failed sign-out? | No | ✅ none added |
| Q-6 | Deadlines | 2 / 5 / 2 s, private | ✅ |
| Q-7 | Manual QA on parked surfaces | Skip Q-2, Q-3, Q-11 | ✅ §9 |
| Q-8 | Widen to `SignOutResult` | Yes | ✅ |

---

## 14. Task list

- ✅ Step 0: SA workplan review (approved with SA-CC-1..16); conditions applied to this workplan.
- ✅ Step 0b: `git fetch origin && git merge origin/main` (fast-forward to `09e2d3ad`) before touching `page.tsx`.
- ✅ Step 1: Tests written: `auth-actions.signOut.test.ts`, `signOutCallers.guard.test.ts`, `AdminHeader.signOutDeadline.test.tsx`, two `awaitingPayment` cases.
- ✅ Step 2: `withDeadline`, `clearSessionByShape`, `countSessionLeft`, `clearPersonScopedKeys`, `describeAuthError`.
- ✅ Step 3: `signOutUser` per §3.2 with single flight; `SignOutResult`; key-list fix; `LEGACY_SESSION_KEYS`; JSDoc.
- ✅ Step 4: `SignOutButton` (SA-CC-7); settings `handleLogout` comment (SA-CC-1, comment only).
- ✅ Step 5: Checks and mutations (§8, §15 below).
- ✅ Step 6: Requirement MD: progress paragraph updated, F-30 row, Change History.
- ⬜ Step 7: SA code review, then QA (§9), then the user sees the diff. No commit by Dev.

---

## 15. Verification (code complete, 2026-10-16)

Run on `fix/signout-hardening-c-c` at `09e2d3ad` + working tree, 2026-10-16.

| Check | Result |
|---|---|
| New unit test `auth-actions.signOut.test.ts` | ✅ 31 / 31 |
| New guard `signOutCallers.guard.test.ts` | ✅ 17 / 17 (scans 500+ files in about 6 s, inside the existing Jest job) |
| New `AdminHeader.signOutDeadline.test.tsx` | ✅ 1 / 1 |
| Related suites: `lib/client`, `app/invite` (incl. `awaitingPayment`, `page`, `page.payment`, `SignupForm`, `GoogleSignupButton`, `middleware.invite`), `app/admin/components` (incl. `AdminHeader.render`), `app/business-os/settings` guards, `components/test-business-os`, `components/v2`, `anon-default-repositories.guard` | ✅ 50 suites, 1 296 tests (final run, after the isolation fix) |
| Full `npx tsc --noEmit -p tsconfig.json` (SA-CC-13) | ✅ **0 errors in any touched file.** The repo has 1 852 pre-existing errors. The only hits in the caller set are `app/(protected)/layout.tsx:399` (`marketingLoginUrl`, file untouched) and `awaitingPayment.render.test.tsx:426` (an `s` regex flag, the same line as `:398` on `origin/main`, moved by the 28 added lines). Both pre-exist on `origin/main`. A heap of 12 GB was needed (`NODE_OPTIONS=--max-old-space-size=12288`); the default heap runs out of memory |
| `npx eslint` on the touched files | ✅ 0 errors; 1 pre-existing warning (`page.tsx:167`, `react-hooks/exhaustive-deps` on `loadData`, not in the C-c lines) |
| `npm run lint:hooks` | ✅ clean |
| `page.tsx` diff | ✅ comment lines only (SA-CC-1) |
| Mutations | ✅ 25 / 25 killed (§8) |
| `typecheck:bos-llm` | Not run: it does not cover `lib/client/` or `app/invite/` (SA-CC-13); the full `tsc` above replaces it |

**Deviations from the workplan as approved:**
- **Optional `Domain=` retry (SA-CC-3) not built.** A survivor is reported through `clearedLocally: false` and a `warn` with the count.
- **`signOutUser` is no longer an `async function`.** It returns the single-flight promise directly, so the slot is assigned synchronously (SA-CC-6). The signature is unchanged for callers.
- **`SignOutOptions` is now an exported, named interface.** It is the same object type as before.
- **Unit test isolation** (§8 note): a fresh module per test, plus an `afterEach` restorer list.
- **Extra cases beyond the plan:** D-3b (a synchronous throw), "the fallback fails too", and an F-5 row "sign-out resolves with no value". The F-5 row is what kills M-11.
- **Manual QA Q-8** now uses request blocking on the audit only. A hang of the audit alone cannot be produced in the browser, so unit test B-1 covers it.

---

## SA Review Notes

## SA Workplan Review (2026-10-16)

**Reviewed by SA, 2026-10-16**
**Status:** ✅ Approved with conditions SA-CC-1..16. Dev applies them to this workplan (Step 0) before writing code. No halt: the design is right, and the cookie finding (K-1) is the part the original fix got wrong.

### What SA verified

Checked against the installed `@supabase/auth-js` 2.75.1 (`dist/main/GoTrueClient.js`), `@supabase/ssr` 0.6.1 (`dist/main/cookies.js`, `utils/constants.js`, `utils/chunker.js`), `lib/supabaseClient.ts`, `lib/supabaseServerAuth.ts`, `middleware.ts` and all seven callers on `962f1398`.

| Finding | SA result |
|---|---|
| K-1 cookies, not storage | ✅ Confirmed. `createBrowserClient` with no `cookies` option uses `document.cookie` (`cookies.js` browser branch); `DEFAULT_COOKIE_OPTIONS` = `path:'/'`, `sameSite:'lax'`, `httpOnly:false`, 400-day `maxAge`, no `domain`, no `secure`; chunk size 3180, chunk names `key.N` (`isChunkLike`). Offir's storage-only clear would have cleared nothing here. |
| K-2 5xx / network error keeps the session | ✅ Confirmed (`_signOut`: anything other than an `AuthApiError` 401/403/404 returns `{ error }` before `_removeSession`). |
| K-3 `local` still calls `/logout` | ✅ Confirmed (`admin.signOut(accessToken, scope)` runs whenever an access token exists). |
| K-4 local sign-out with no stored session is network-free and fires `SIGNED_OUT` | ✅ Confirmed (`__loadSession` re-reads storage; no token, no call; `_removeSession` notifies). |
| K-5 no lock timeout | ✅ Confirmed, and stronger than stated: `_acquireLock(-1)` while `lockAcquired` chains the new call onto `pendingInLock` behind the hung one. After a step-2 timeout, **every** later auth call on this page (`signOut`, `getSession`) waits until the browser itself drops the hung request (minutes). See SA-CC-7 and R-9. |
| K-6 no server writer | ✅ Confirmed in this repo: `createAuthenticatedServerClient` has no-op `set`/`remove`; the middleware only reads; the marketing handoff arrives through `SessionHandler` → `supabase.auth.setSession` on the browser client, so the cookie is host-only. `lib/hooks/useUser.ts` creates an `auth-helpers-nextjs` client but has **no importer** (dead file; not this slice). The one thing SA cannot see is the marketing app: if it ever set a parent-domain cookie, a host-only expiry would not remove it. SA-CC-3 makes that visible instead of assumed. |
| K-8 callers | ✅ Seven files, as listed (the K-8 heading says "six"; fix the wording). No production `auth.signOut(` outside `auth-actions.ts`. `contexts/` does not exist (SA-CC-12). |
| Cookie expiry details | ✅ `name=; Max-Age=0; Path=/; SameSite=Lax` deletes the cookie: matching is on name + domain + path. Never write `SameSite=None` (rejected without `Secure`). `Secure` is not needed to delete a non-`Secure` cookie, and the app's cookie is not `Secure`. |
| Regex | Acceptable in effect, tightened by SA-CC-4. It cannot reach another site's cookies (`document.cookie` is this host only). On `localhost` the app and the marketing site share cookies across ports, so a local sign-out also clears the marketing copy; that is the same project and the wanted result. |
| Behaviour table, 9 s bound | ✅ 2 + 5 + 2. `signOut` first awaits `initializePromise`; that wait is inside the 5 s. Success path: auth-js removes the session itself, steps 3–4 are skipped, step 5 finds nothing. Unchanged for the user. |
| Return-type widening vs R-2 | ✅ Within R-2. Parameter object unchanged, `ok` / `error` keep their meaning, two fields added. The two caller tests that mock `signOutUser` declare their own local result types, so nothing breaks. |
| Callers' mocks | ✅ `AdminHeader.render.test.tsx`, `awaitingPayment.render.test.tsx`, `page.*.render.test.tsx` mock the module; unaffected. |

### Rulings on the Dev questions

| Q | Ruling |
|---|---|
| Q-1 single-flight | ✅ **Yes**, with SA-CC-6. A module-level in-flight promise has a precedent (`onboardingVerdict` shares one in-flight lookup); this ruling is the rule-7 review. |
| Q-2 `SignOutButton` | ✅ **Yes, in C-c** (reverses the Dev recommendation). The plan's premise "a second press finds no session and succeeds" is false after a **timeout**: the hung first call still holds the auth lock (K-5), so the second press also times out, for as long as the browser keeps the dead request open. The friend would see "failed" twice while already signed out. See SA-CC-7. |
| Q-3 `LEGACY_SESSION_KEYS` | ✅ Yes. Private, not exported; removed from both storages in step 5 on every path. |
| Q-4 integration test | ✅ Yes, one through `AdminHeader`, in a **new file** (SA-CC-9), plus the `SignOutButton` cases from SA-CC-7. |
| Q-5 audit on failure | ✅ No new audit event. The log line carries the outcome. |
| Q-6 deadlines | ✅ Keep 2 s / 5 s / 2 s, private constants; tests use literal milliseconds. Add the worst-case test in SA-CC-10. |
| Q-7 manual QA on parked surfaces | ✅ Skip Q-2 and Q-3 (user menu and sidebar are AgentsPilot-app surfaces: `V2Header` is used only under `app/v2/*` and onboarding; the protected layout is the agent app). Q-11 is a user-menu check too: drop it from manual QA, the single-flight unit test covers it. QA runs Q-1, Q-4..Q-10, Q-12 with the corrections in SA-CC-11. |
| Q-8 `SignOutResult` | ✅ Widen, as planned. |

### Conditions

1. **SA-CC-1 — R-3 reconciled: the `handleLogout` comment edit stays in C-c.** The Dev's hand-off to C-b contradicts SA ruling R-3 (§0.6.1 on the C-a branch). C-c edits the comment inside `handleLogout` in `app/business-os/settings/page.tsx` (the "Nothing it does can trap someone… cleared regardless" paragraph) to describe the contract: `signOutUser` never rejects, returns within about 9 seconds, and always clears this browser's session; on a server failure other devices may stay signed in. **Comment-only**: the `page.tsx` diff must contain no line outside a comment (SA code review checks this). Whichever of C-a and C-c opens its PR second merges `origin/main` first. Update §4 (settings row), §6 (`page.tsx`: modify, comment only), §12 (remove the C-b hand-off row), and the requirement progress line and Change History row, which currently say "handed to C-b".
2. **SA-CC-2 — R-2 holds.** No change to the parameter object or to the meaning of `ok` / `error`. The only new `error` value is `'timeout'`. If code review finds any other shape change, C-c stops being parallel (R-2).
3. **SA-CC-3 — `clearedLocally` is measured, not assumed.** After step 5, re-read `document.cookie`, `localStorage` and `sessionStorage`; `clearedLocally` is true only if no name matching the pattern is left. If one survives (a parent-domain cookie from another writer, or an unknown writer), log `warn` with the count only. Dev may additionally retry the expiry with `Domain=` set to `location.hostname` and its parent domains; optional, test it if built. The JSDoc next to the clear states the K-6 assumption (browser client is the only writer; host-only, `Path=/`, not `httpOnly`) and that any future `cookieOptions.domain` must be mirrored here. Test: a stubbed `document.cookie` getter that keeps returning a match → `clearedLocally: false` plus the `warn`.
4. **SA-CC-4 — Tighten the pattern.** Use `^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier|-user)?(?:\.(?:0|[1-9]\d*))?$`. The default storage key is `sb-<first hostname label>-auth-token`, and a hostname label is letters, digits and hyphens; the chunk suffix mirrors `@supabase/ssr`'s `isChunkLike`. Expiry string: `name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`, never `SameSite=None`. Add to F-1: `sb-abcd-auth-token-code-verifier.0` is cleared. Add to F-2: `sb--auth-token`, `sb-a.b-auth-token` and `sb-abcd-auth-token.x` survive. Seed test cookies **without** `Secure`: jsdom on `http://localhost` would drop them silently and the test would pass for the wrong reason.
5. **SA-CC-5 — `withDeadline` hygiene.** It clears its timer when the inner promise settles first. It attaches a no-op rejection handler to the inner promise, so a sign-out that rejects after its deadline cannot raise an `unhandledrejection`. It returns a discriminated result and never throws. A-1 asserts `jest.getTimerCount() === 0` after a successful sign-out.
6. **SA-CC-6 — Single-flight (Q-1).** One module-level `Promise<SignOutResult> | null`, assigned synchronously before the first `await` and cleared in `finally`. A concurrent second call gets the same promise whatever options it passed (log at `debug` with its `method`). Tests: two concurrent calls → one audit `fetch`, one `signOut`, the same result object; a third call after settlement runs again; after an injected throw the slot is still cleared.
7. **SA-CC-7 — `SignOutButton` (Q-2).** Proceed to `signInUrl` when `result.ok || result.clearedLocally`; show the failure message only when `clearedLocally` is false. Update its "Local state is cleared either way" comment to match. Add two cases to `awaitingPayment.render.test.tsx`: `{ ok: false, clearedLocally: true }` → `location.assign` called; `{ ok: false, clearedLocally: false }` → failure shown, button re-enabled. Update §4, §6 (one caller now modified) and the "callers untouched" lines. No other caller changes.
8. **SA-CC-8 — `LEGACY_SESSION_KEYS` (Q-3).** As ruled: private, both storages, every path; F-3 asserts the two literals are gone from `PERSON_SCOPED_STORAGE_KEYS` and removed by the legacy list.
9. **SA-CC-9 — Caller-level deadline proof (Q-4).** New file `app/admin/components/__tests__/AdminHeader.signOutDeadline.test.tsx` (`jest.mock` is per file and the existing render test mocks `signOutUser`): real `signOutUser`, `@/lib/supabaseClient` mocked with a `signOut` that never settles, `fetch` never settles. At 8 999 ms of fake time `location.replace` has not been called; at 9 000 ms it has, with the marketing URL, and no session cookie is left.
10. **SA-CC-10 — Worst-case bound.** Add C-3: audit, requested sign-out and local fallback all hung → resolves at 9 000 ms, not before (assert pending at 8 999 ms). Add D-4: `signOut` resolves `{ error }` with a 403 `AuthApiError` → auth-js treats it as signed out, so it reaches us as `{ error: null }`; model it as E-1 (no separate code path; documents the 401/403/404 set).
11. **SA-CC-11 — Manual QA corrections.** DevTools **request blocking** and **Offline** fail the request at once (a network error, `AuthRetryableFetchError`), so they exercise `server_error`, **not** a hang. Q-7, Q-8 and Q-10 need a real hang: a custom throttling profile with latency of at least 15 000 ms, applied after the page has loaded. Q-9: Chrome local overrides do not reliably change the status of a `POST`; use request blocking on `*/auth/v1/logout*` (same `server_error` branch, status 0) and rely on D-1 for a true 500. Each Q-row records the `outcome` seen in the console log. Q-6 also checks that the invite can still be accepted after a **blocked** (not hung) sign-out. Skip Q-2, Q-3 and Q-11 (Q-7 ruling).
12. **SA-CC-12 — Guard.** Roots are `app/`, `components/`, `lib/`, `hooks/` (drop `contexts/`, which does not exist). The guard asserts each root exists, so a typo cannot quietly scan nothing. It skips `node_modules`, `.next`, `__tests__` and `*.test.*`. G-2 lists the seven files explicitly and fails if one is missing (a rename becomes a deliberate edit). For `app/business-os/settings/page.tsx` it also asserts `signOutUser({ scope: 'global'` (QA S-5 gap 4 is about this control). The guard only **reads** `page.tsx` (R-3).
13. **SA-CC-13 — Type check.** `typecheck:bos-llm` does not cover `lib/client/` or `app/invite/`, and CI has no TypeScript gate outside it. Run `npx tsc --noEmit -p tsconfig.json` and show zero new errors in the touched files, compared with `origin/main`. Also run `npx eslint` on the touched files and `npm run lint:hooks`.
14. **SA-CC-14 — Logging.** §5 as written. The existing `logger.error({ err }, …)` in the catch is replaced by `{ authName, authStatus }` (never the raw error object). L-1 also seeds a real-shaped `base64-` cookie value with an `access_token` inside and asserts the decoded token is absent from every log entry. No `userId`, email, cookie names or values.
15. **SA-CC-15 — More mutations.** Add M-17 single-flight slot not cleared in `finally` (SA-CC-6 third call), M-18 `clearedLocally` hard-coded `true` (SA-CC-3), M-19 `withDeadline` leaves its timer (A-1 timer count), M-20 `SignOutButton` back to `ok`-only (SA-CC-7), M-21 regex chunk suffix widened to `.*` (F-2 `sb-abcd-auth-token.x`). Record all results in §8.
16. **SA-CC-16 — Records.** Add **F-30** to requirement §7 (one row, from this review; see below). Fix the K-8 heading count. Add R-9 (below) to §10. Record these rulings in §13 and set Status to "SA-approved with conditions".

### Additional risk (add to §10)

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-9 | **Pages that stay put after a hung sign-out.** On the invite page (`useSignedInVisitor`, no navigation) and the test harness, the hung call keeps the auth lock, so a later `getSession` there waits until the browser drops the request. The cookies are already gone, so the person is signed out; the page may just be slow to see it. | Low (needs a hung, not failed, auth request) | Accepted. Recorded so nobody reads a slow `getSession` after a hang as a new defect. |

### Dev observation: `middleware.ts:273`, recorded as **F-30**

Real. The onboarding check builds the cookie name from the **hard-coded** production project ref and reads only the chunks `.0`, `.1`, …. Two consequences: (a) in any other Supabase project (a local stack, or the planned Preview/staging environment) the onboarding redirect never fires; (b) when a session is small enough to be stored **unchunked** (one cookie under 3 180 characters), the check finds nothing and skips the redirect. Both fail **open** on an onboarding redirect only. Access control is not affected: the token is verified by `auth.getUser` in `onboardingVerdict`, and pages and routes authenticate on their own. `app/invite/__tests__/middleware.invite.test.ts` also hard-codes the ref.

**Severity: Low.** **Not in C-c**: it is server code in another file and has nothing to do with sign-out. The fix: derive the key from `NEXT_PUBLIC_SUPABASE_URL` the way supabase-js does, and read the whole cookie or its chunks. Best done with the environment-readiness work, which a staging project would trip over first. F-30 is the next free number: §7 on `origin/main`, on this branch, on the C-a branch and in every drawer-review worktree stops at F-29. (The F-30 in `ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` belongs to a different document.)

### Approval
[x] Workplan approved, proceed to implementation once SA-CC-1..16 are applied to this workplan. SA code review then checks the conditions against the diff.

## SA Code Review (2026-10-16)

**Code Review by SA, 2026-10-16**
**Status:** ✅ Code Approved for QA. No High or Medium finding. CR-CC-1..7 below are Low or informational; none blocks QA or the commit, and none needs to be fixed in C-c.

Reviewed on `fix/signout-hardening-c-c` at `09e2d3ad` + working tree: `lib/client/auth-actions.ts` (whole file, against `HEAD`), `SignOutButton.tsx`, the `page.tsx` diff, the `awaitingPayment.render.test.tsx` edits, the three new test files, the requirement-MD diff, `.github/workflows/tests.yml` / `build.yml`, and the C-a working tree (`neuronforge-phase-c`) for overlap.

### Conditions checked against the diff

| Condition / claim | Result |
|---|---|
| Order: audit (2 s) → requested sign-out (5 s) → on non-confirmation clear by shape → local sign-out (2 s) → always final clear + person-scoped + `LEGACY_SESSION_KEYS` (both storages) + `onboarding_preview_data` → `clearedLocally` re-read | ✅ `runSignOut` lines 494–579 in exactly this order. The cookie clear precedes the local `signOut` (K-4), pinned by C-2 / M-6 |
| Never rejects, ≤ 9 s | ✅ Every network step goes through `withDeadline`; every storage / cookie touch is in its own `try`. C-3 pins pending at 8 999, settled at 9 000. See CR-CC-1 for the one residual assumption (the logger) |
| Success path identical to today | ✅ Same audit body and position, same `signOut({ scope })`, steps 3–4 skipped, `{ ok: true, error: undefined }` as before. Two intended differences: the audit wait is capped at 2 s (Q-6, see CR-CC-4), and `onboarding_preview_data` is now removed from `localStorage` too (superset, harmless) |
| SA-CC-2 shape freeze | ✅ Parameter object unchanged (now named, deviation 3). `ok` = server confirmed; `error` = auth-js message / thrown message / new `'timeout'`. Only `outcome` and `clearedLocally` added. `SignOutResult extends AuthActionResult`, so every caller that reads `ok` / `error` compiles and behaves as before. R-2 holds |
| SA-CC-3 measured `clearedLocally` | ✅ `countSessionLeft()` re-reads cookies and both storages after the final clear; survivor → `warn({ left })`. Test pins it; M-18 killed |
| SA-CC-4 regex + expiry string | ✅ Pattern is the exact SA string. Expiry `name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`; no `SameSite=None`, no `Domain`. F-1 / F-2 cover the named positives and negatives; test cookies seeded without `Secure` |
| SA-CC-5 `withDeadline` | ✅ Synchronous throw → `threw`; `settled` absorbs a late rejection (no `unhandledrejection`, tested); timer cleared in `finally` (A-1 / C-1 `getTimerCount() === 0`, M-19); neither raced promise can reject, so it never throws |
| SA-CC-6 single flight | ✅ Slot assigned synchronously, cleared in `.finally`; join logs `debug({ method })`; S-1..S-3 + M-17 / M-22 |
| SA-CC-7 `SignOutButton` | ✅ Proceeds when `ok \|\| clearedLocally`; failure + re-enabled button only when both are false; comment rewritten; two cases added; the legacy `{ ok: false }` case still shows the failure (`clearedLocally` undefined); M-20 |
| SA-CC-8 legacy keys | ✅ Private constant, removed from both storages on every path; F-3 |
| SA-CC-9 caller-level proof | ✅ `AdminHeader.signOutDeadline.test.tsx`: real `signOutUser`, `replace` not called at 8 999 ms, called once at 9 000 ms with the marketing URL, scopes `['global', 'local']`, no session cookie left |
| SA-CC-1 `page.tsx` comment-only | ✅ Verified mechanically: `git diff -U0` of `page.tsx` has 6 + / 3 − lines, every one a ` * ` JSDoc line inside `handleLogout`. No code line changed |
| SA-CC-12 guard | ✅ Roots asserted to exist, > 500 files, comments stripped, skips `node_modules` / `.next` / `__tests__` / `*.test.*`, seven explicit surfaces, `signOutUser({ scope: 'global'` for settings, negative controls |
| SA-CC-13 types / lint | Accepted on Dev's evidence (full `tsc` 0 errors in touched files; eslint, `lint:hooks` clean). Not re-run by SA (12 GB heap) |
| SA-CC-14 logging | ✅ No raw error object anywhere on the sign-out path (`describeAuthError` → `authStatus` / `authName` only); no email, user id, cookie names or values, tokens. L-1 checks it with a real-shaped `base64-` cookie and a token-bearing thrown message, and asserts no `err` field. No `console.*` in any touched file (`auth-actions.ts`, `SignOutButton.tsx`, `page.tsx`: 0) |
| Standards | No API route, repository, plugin, migration, LLM call or entitlements import in the diff, so those skill checklists do not apply. No `any` added |
| Related suites (SA re-run) | ✅ **50 suites, 1 296 tests, all passed** (same command scope as §15), matches Dev |

### Rulings

| Item | Ruling |
|---|---|
| Deviation 1: no `Domain=` retry | ✅ **Accepted.** It was optional in SA-CC-3. A surviving parent-domain cookie is reported (`clearedLocally: false` + `warn`) rather than guessed at, and K-6 says no such writer exists in this repo. Revisit only if the marketing app ever shares the cookie across subdomains |
| Deviation 2: `signOutUser` no longer `async` | ✅ **Accepted, and it is the correct way to meet SA-CC-6.** `runSignOut` is `async`, so it cannot throw synchronously; `.finally` is always attached; the returned object is a native `Promise`, so every `await` / `.then` caller is unaffected. Joining callers get the identical promise (S-1 asserts `toBe`) |
| Deviation 3: exported `SignOutOptions` | ✅ **Accepted.** Same structural type as the old inline parameter; type-only export; no new pattern |
| Deviation 4: `jest.isolateModules` + restorer list | ✅ **Accepted.** Necessary with module-level single-flight state; without it one failing test poisons the rest (found by the mutation run). `afterEach` restores storage / cookie overrides even when a test fails |
| Deviations 5–6 (extra cases, Q-8 method) | ✅ Accepted. The F-5 "resolves with no value" row is what kills M-11 |
| Deviation 7 / Dev Q: `auditAuthEvent` still logs `{ err }` | ✅ **Leave it; do not change it in C-c.** On the sign-out path the only thing that reaches that `catch` is a same-origin `fetch` failure (a `TypeError` with no token, email or cookie in it), and `{ err }` is the CLAUDE.md standard form. It is shared with the sign-in functions, which C-c does not touch (they also log `{ err: error }` and `{ userId }`); any tightening there is a sign-in concern for a separate slice, not a C-c defect. SA-CC-14 asked only for the sign-out `catch` to stop logging the raw error, and it has |
| SA-CC-12 guard vs the no-added-CI-time rule | ✅ **Fits.** The Jest gate is its own workflow (`tests.yml`), runs in parallel with `Build (next build)` (`build.yml`), and is sharded three ways specifically so it finishes before the build. The guard adds about 3 s (SA warm run, Windows; Dev measured ~6 s cold) to one shard, against a 3–7 min `next build`. It is off the critical path. See CR-CC-3 for the comment wording |
| Merge order with C-a | **No code conflict:** C-a's `page.tsx` hunks are at lines ~44, 93, 134, 1041, 1054; C-c's single hunk is the `handleLogout` comment at ~525. Git merges them cleanly. **The requirement MD will conflict** (both append Change History rows after the same line; C-c's progress paragraph and C-a's §0.6.1 insert land next to each other near line 100). Ruling: **C-a lands first if both are ready at once**, because C-c's progress paragraph says it belongs under §0.6.1 once C-a lands. C-c then merges `origin/main`, moves its paragraph under §0.6.1, keeps both sets of Change History rows, re-runs the related suites, and opens its PR. If C-c is ready first, it may go first; C-a then does the same doc merge. Either way the second PR re-runs its suites after the merge (SA-CC-1) |

### Code Review Comments

1. **CR-CC-1** `lib/client/auth-actions.ts:556, 581` — The never-reject contract rests on one unwrapped assumption: the `logger.error` inside the outer `catch` and the final `logger.info('Sign-out finished')` sit outside any `try`. If either threw, `runSignOut` would reject and `signOutUser` would pass the rejection through. The browser Pino logger writes synchronously to `console` and does not throw in practice, so this is theoretical. Optional hardening (not required): a `.catch` in `signOutUser` that resolves `{ ok: false, error: 'Sign-out failed', outcome: 'threw', clearedLocally: false }`. — Priority: Low
2. **CR-CC-2** `lib/client/auth-actions.ts:515–553` — If something throws **after** step 2 settled but before steps 3–4 (only the F-5 "resolves with no value" row can do it), the outer `catch` skips the cookie-first clear and the local `signOut`. Step 5 still expires the cookies, so this browser is signed out, but no `SIGNED_OUT` is fired, which matters only on the two pages that do not navigate (R-9 surfaces). Unreachable with auth-js 2.75.1, which always resolves an object. Accept; no change needed. — Priority: Low (informational)
3. **CR-CC-3** `lib/client/__tests__/signOutCallers.guard.test.ts:15` — The header says "no added CI time". Accurate wording is "a few seconds inside one Jest shard, which runs in parallel with and finishes before `next build`". Fix the comment if the file is touched again; not worth a cycle. — Priority: Low
4. **CR-CC-4** `lib/client/auth-actions.ts:497–510` — A slow audit (> 2 s) is now abandoned; the four navigating callers then leave the page, and the browser may cancel the still-running `POST /api/audit/log`, losing that `USER_LOGOUT` row where today the person waited for it. This is the accepted Q-6 trade-off (leaving beats a perfect audit), and today's behaviour was worse when the audit hung. Follow-up suggestion only, outside C-c because `auditAuthEvent` is shared with sign-in: `keepalive: true` on that `fetch` lets the request outlive the navigation. — Priority: Low
5. **CR-CC-5** `lib/client/auth-actions.ts:555` — When the outer `catch` runs after a `server_error` classification, `outcome` becomes `threw` but `error` keeps the server message. Cosmetic; the log line carries the step. No change. — Priority: Low (informational)
6. **CR-CC-6** `lib/client/__tests__/auth-actions.signOut.test.ts:440–443` — F-2's success half asserts only `localStorage`; cookies and `sessionStorage` are asserted only on the failure half. The final clear runs the same function on both paths and M-9a / M-9b / M-21 are killed, so coverage is adequate. Optional extra assertions; QA may add them. — Priority: Low
7. **CR-CC-7** Requirement MD — the C-c progress paragraph and Change History row still read "awaiting SA code review". Update both when QA reports and again at commit (TL / RM), and relocate the paragraph under §0.6.1 per the merge-order ruling. — Priority: Low

### Optimisation Suggestions
- `keepalive: true` on the audit `fetch` (CR-CC-4), as a separate small slice that also covers sign-in.
- If F-30 is fixed later, derive the session key from `NEXT_PUBLIC_SUPABASE_URL` in one shared helper that both `middleware.ts` and `SESSION_KEY_PATTERN`'s JSDoc can point at, so the two never disagree about the cookie name.

### Code Approved for QA: Yes

---

## QA Testing Report

## QA Report (2026-10-16)

**QA, 2026-10-16**
**Test mode:** full
**Strategy used:** A (Jest unit, jsdom + fake timers) for `signOutUser`; A at caller level (`AdminHeader` with the real `signOutUser`, `SignOutButton` render cases); source guard; mutation testing. D (manual browser) **not run**: no browser in this session.
**Focus:** security (session left behind, log content), performance (deadlines), ui (the two callers whose behaviour changed)
**Skipped:** manual Q-list (no browser; steps below). Q-2, Q-3, Q-11 skipped by SA ruling Q-7.
**Input source:** prompt (TL trigger) + workplan §7–§9
**Verdict:** ✅ **PASS WITH NOTES.** No bug. Four of 17 new mutations survived; one is equivalent, three are test gaps (Low), each with a probe showing a small test would close it. Manual checks owed.

Run on `fix/signout-hardening-c-c` at `09e2d3ad` + working tree. Production code was not modified; every mutation was restored in `try/finally`. SHA-1 before and after: `auth-actions.ts` `1b26d037…`, `SignOutButton.tsx` `94b65b21…` (match). `git diff --numstat` identical before and after (6/3, 29/1, 9/2, 5/0, 349/41). Probe test files were temporary and deleted. No entitlements import in the diff, so `test:bos-entitlements` does not apply.

### Test runs

| Run | Result |
|---|---|
| Related suites (`lib/client`, `app/invite`, `app/admin/components`, `app/business-os/settings/__tests__`, `components/test-business-os`, `components/v2`, `anon-default-repositories.guard`) | ✅ **50 suites, 1 296 tests passed** (113 s). Matches Dev and SA. One "worker failed to exit gracefully" notice in this run; it does not appear when the four C-c files run alone, and the slowest suite in the run was `SignupForm.render` (92 s, untouched). Not a C-c issue |
| The four C-c files alone (`auth-actions.signOut`, `signOutCallers.guard`, `AdminHeader.signOutDeadline`, `awaitingPayment.render`) | ✅ 4 suites, 116 tests, no open-handle notice |

### Code-level paths (item 3 of the trigger)

| Path | Test that pins it | Result |
|---|---|---|
| Success, global (audit first, unchanged body, no fallback, no timer left) | A-1 | ✅ |
| Success, local scope passed through | A-2 | ✅ |
| No user → no audit, default scope `local` | A-3 | ✅ |
| 401 / 403 (auth-js returns `{ error: null }` after removing the session) | E-1, D-4 (modelled; the auth-js mapping was verified by SA in the source) | ✅ |
| Hung audit: sign-out starts at 2 000 ms, not 1 999 | B-1 | ✅ |
| Hung sign-out: cookies gone at 5 000 ms, result at 7 000 ms, `timeout` | C-1, C-2 | ✅ |
| Everything hung: pending at 8 999, settled at 9 000 | C-3; caller level `AdminHeader.signOutDeadline` (`replace` at 9 000, not 8 999) | ✅ |
| 5xx → `server_error`, cookies first, then local fallback | D-1 | ✅ |
| Network error (status 0) | D-2 | ✅ |
| Rejected / synchronous throw → `threw`, logged at `error` | D-3, D-3b | ✅ |
| Chunks `.0/.1/.2`, `-code-verifier`, `-code-verifier.0`, `-user` cleared (cookies + both storages) | F-1 | ✅ |
| Lookalikes (`my-sb-…`, `sb--auth-token`, `sb-a.b-…`, `….x`, `sb-auth-token-backup`, `sb-abcd-other`) and theme keys kept | F-2 | ✅ (success half checks `localStorage` only, SA CR-CC-6) |
| Second call while one runs joins it (same promise, one audit, one `signOut`) | S-1 | ✅ |
| A later call after completion runs fresh; slot cleared after a throw | S-2, S-3 | ✅ |
| Never rejects (six injected failures) | F-5 | ✅ |
| No token, decoded token, email, cookie name or value, user id, or `err` field in logs | L-1 | ✅ for the `server_error` and `threw` paths. **Not** for the unexpected-throw path (QA-CC-3 below) |
| `SignOutButton`: `{ ok: false, clearedLocally: true }` → sign-in; both false → alert + retry | `awaitingPayment.render` | ✅ |
| Pattern matches `@supabase/ssr` chunk naming | Read `@supabase/ssr` `utils/chunker.js` `CHUNK_LIKE_REGEX = /^(.*)[.](0\|[1-9][0-9]*)$/` | ✅ same chunk suffix |

### QA mutations (QM-1..QM-16, 17 runs, beyond Dev's M-1..M-23)

Runner and raw output: QA scratchpad `qa-cc-signout/mutate.py`, `mutations.txt`. Each mutation applied alone, the three behaviour files run (`auth-actions.signOut`, `AdminHeader.signOutDeadline`, `awaitingPayment.render`), source restored byte for byte.

**Result: 13 killed, 4 survived (1 equivalent, 3 test gaps).**

| # | Mutation | Result | Killed by |
|---|---|---|---|
| QM-1 | Pattern loosened to `^sb-.*` | ✅ Killed | F-2 (lookalikes must survive) |
| QM-2 | Cookie expiry with `SameSite=None` | ❌ **Survived** | None: jsdom accepts it; Chrome rejects `SameSite=None` without `Secure`, so the cookie would not be expired. See QA-CC-1 |
| QM-3 | Cookie expiry without `Path=/` | ❌ **Survived** | None: jsdom runs at `http://localhost/`, where the default path is already `/`. On `/business-os/settings` the default path would be `/business-os` and the `Path=/` cookie would survive. See QA-CC-1 |
| QM-4 | Final clear skipped on the success path | ✅ Killed | A-1, E-1 |
| QM-5 | Single-flight slot never cleared | ✅ Killed | S-2, S-3, F-3 |
| QM-6 | Audit and sign-out deadlines swapped (5 000 / 2 000) | ✅ Killed | B-1, C-1 |
| QM-7 | `clearedLocally` assumed true on success (`left === 0 \|\| outcome === 'signed_out'`) | ✅ Killed | SA-CC-3 |
| QM-8a | Error message added to the "not confirmed" log fields | ✅ Killed | L-1 |
| QM-8b | Raw `err` added to the unexpected-throw log | ❌ **Survived** | None: L-1 does not drive that path. See QA-CC-2 |
| QM-9 | Local fallback uses the caller's scope (a second network call) | ✅ Killed | C-1, C-2, D-1, `AdminHeader.signOutDeadline` |
| QM-10 | Audit awaited with no deadline | ✅ Killed | B-1, C-3, `AdminHeader.signOutDeadline` |
| QM-11 | `SignOutButton` inverted (`!ok && clearedLocally` → fail) | ✅ Killed | all three `awaitingPayment` sign-out cases |
| QM-12 | First (pre-fallback) cookie clear skipped on timeout | ✅ Killed | C-1, C-2 |
| QM-13 | Audit gate `user?.id` → `user !== undefined` | Survived, **equivalent** | `user` defaults to `null`, so the closure throws inside `withDeadline`, which swallows it: no `fetch`, same observable behaviour |
| QM-14 | `sessionStorage` dropped from the scan | ✅ Killed | A-1, C-1, D-1, F-1, F-3 |
| QM-15 | Local fallback run on success too | ✅ Killed | A-1..A-3, E-1, D-4, B-1, B-2, S-1..S-3 |
| QM-16 | Timeout reported as `ok: true` | ✅ Killed | C-1, C-2, C-3 |

**Probe for QM-2 / QM-3** (temporary file, deleted afterwards): two tests: (a) `history.pushState` to `/business-os/settings`, seed `sb-abcd-auth-token.0` at `Path=/`, 5xx sign-out, assert the cookie is gone and `clearedLocally`; (b) spy the `document.cookie` setter and assert every expiry write has `Path=/` and no `SameSite=None`. Baseline: both pass. QM-2: (b) fails. QM-3: (a) and (b) fail. A test like this closes both gaps.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None. Success path unchanged (A-1: one audit, one `signOut`, no timer left). Failure paths bounded at 9 s (C-3, caller-level test).

#### Edge Cases / test gaps (nice to fix; none blocks commit)
1. **QA-CC-1, test gap: the cookie expiry attributes are not pinned** — `lib/client/__tests__/auth-actions.signOut.test.ts` — Low. Dropping `Path=/` or switching to `SameSite=None` passes the suite but would leave the session cookie in a real browser (any page under a sub-path, which is every sign-out surface). Add the two probe cases above (nested `pushState` path + setter spy). The code is correct today; this protects it from a future edit.
2. **QA-CC-2, test gap: L-1 does not cover the unexpected-throw log** — same file — Low. Adding `err` to `logger.error({ step: 'unexpected', … })` passes. Fix: in L-1 (or the F-5 table), also run the "sign-out resolves with no value" case and assert no `err` field / no secret across every entry.
3. **QA-CC-3, observation: callers log the returned message** — `AdminHeader.tsx:46`, `app/(protected)/layout.tsx:294`, `UserMenu.tsx:106`, `settings/page.tsx:534` log `{ err: result.error }`. For `outcome: 'threw'`, `result.error` is the thrown message verbatim, so whatever a thrown error carries reaches the log through the caller, outside L-1's reach. Pre-existing pattern, not changed by C-c; auth-js and fetch messages carry no token in practice. Low; no change in C-c.
4. **QA-CC-4, observation: `clearedLocally` is `true` when `document.cookie` cannot be read** — `countSessionLeft` treats an unreadable jar as empty (F-5 "cookie getter throws" resolves `clearedLocally: true`). In a browser that only happens where no cookie can be stored either, so no session can be there. Informational.
5. Already recorded by SA and agreed: CR-CC-1 (logger calls outside `try`), CR-CC-2 (no `SIGNED_OUT` after an unexpected throw), CR-CC-6 (F-2 success half).

### Manual QA (§9): NOT RUN, no browser in this session

Setup for every row: `npm run build && npm run start` in the C-c worktree (or a Vercel preview), Chrome, DevTools open on **Application → Cookies** (app origin) and **Console** (level Verbose, to see `Sign-out finished` with `outcome`). "Signed out" = no `sb-…-auth-token*` cookie on the app origin **and** a reload of a protected page lands on sign-in.

**Custom hang profile (Q-7, Q-10):** DevTools → Network → throttling dropdown → **Add…** → **Add custom profile**: name `hang-15s`, download 1 000 kbit/s, upload 1 000 kbit/s, **latency 15000 ms**. Load the page first, **then** select `hang-15s`, then press the control. (Request blocking and Offline give a network error, i.e. `server_error`, not a hang.)

| # | Surface | Steps | Expected | Status |
|---|---|---|---|---|
| Q-1 | Business OS settings → Log out | Signed in, `/business-os/settings`, Log out, confirm | Marketing sign-out → sign-in; reload `/business-os/settings` → sign-in; Back does not show the app; one `USER_LOGOUT` row `method: 'settings'`; `outcome: signed_out` | ⬜ NOT RUN |
| Q-4 | `/admin` header → Sign out | Admin account, `/admin`, Sign out | As Q-1, `method: 'admin-header'` | ⬜ NOT RUN |
| Q-5 | `/invite/awaiting-payment` → Sign out | Account in the payment hold, press Sign out | Goes to the sign-in URL; reload stays signed out; `outcome: signed_out` | ⬜ NOT RUN |
| Q-6 | `/invite?…` signed-in visitor → Sign out | (a) normal; (b) sign in again, Network → **Request blocking** `*/auth/v1/logout*`, Sign out | (a) signed-out state, reload still signed out. (b) `outcome: server_error`, cookies gone, invite can still be accepted | ⬜ NOT RUN |
| Q-7 | Hung sign-out, settings | Load settings, select `hang-15s`, Log out, confirm; watch the clock | Spinner ~7–9 s, then redirect; cookies gone (switch throttling back to No throttling before the reload); reload → sign-in; `outcome: timeout` | ⬜ NOT RUN |
| Q-8 | Failed audit, settings | Request blocking on `*/api/audit/log*` only, Log out | Redirect with no extra wait; signed out; `outcome: signed_out`; no `USER_LOGOUT` row | ⬜ NOT RUN |
| Q-9 | Server failure, settings | Request blocking on `*/auth/v1/logout*`, Log out. Keep a second browser (other profile) signed in to the same account | Redirect at once; cookies gone; reload signed out; `outcome: server_error`; the second browser **stays** signed in (expected, §3.3) | ⬜ NOT RUN |
| Q-10 | Hung sign-out, awaiting-payment | As Q-7 on `/invite/awaiting-payment` | After ~7–9 s goes on to sign-in, no "failed" message; signed out | ⬜ NOT RUN |
| Q-12 | Theme survives | Set a non-default theme, sign out, sign back in | Theme unchanged; `business-os-language`, `onboarding_*` keys gone from Local Storage after sign-out | ⬜ NOT RUN |
| Q-2, Q-3, Q-11 | User menu, sidebar, double click | — | Skipped by SA ruling Q-7 (parked AgentsPilot-app surfaces; S-1 and G-2 cover them) | — |

### Test Coverage against the requirement (F-23 / C-8)

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| (a) A sign-out that never settles cannot leave the spinner on: bounded | ✅ | Pass | C-1, C-3, `AdminHeader.signOutDeadline`; QM-6, QM-10, QM-16 killed. Q-7 / Q-10 manual owed |
| (b) The two wrong storage keys are gone from the list; real session keys cleared | ✅ | Pass | F-1, F-3; QM-14 killed |
| (c) A 5xx / network failure no longer leaves the browser signed in | ✅ | Pass | D-1, D-2, C-2; QM-9, QM-12 killed. Real-browser cookie expiry attributes unpinned (QA-CC-1). Q-6b / Q-9 manual owed |
| Every caller goes through `signOutUser` | ✅ | Pass | Guard G-1..G-3 (17 tests) |
| `SignOutButton` proceeds when cleared locally | ✅ | Pass | Two new cases; QM-11 killed |
| No secrets in logs | ⚠️ | Partial | L-1 passes; the unexpected-throw path is not covered (QA-CC-2) |

### Final Status
- [x] All acceptance criteria pass at code level, no bug. **Ready for the user's diff review and commit**, with QA-CC-1 / QA-CC-2 recommended as small test additions (Dev's call whether in C-c or a follow-up) and the manual Q-list owed after deploy.
- [ ] Issues found — Dev must address before commit

### QA gap closure (2026-10-16)

**By Dev.** Test files only, plus the optional CR-CC-1 change, which was a one-line change. No test exposed a defect.

| Item | Change | Proof |
|---|---|---|
| **QA-CC-1 (a)** | New test in `auth-actions.signOut.test.ts`, "cookie expiry attributes": it spies the `document.cookie` setter (an own accessor over `Document.prototype.cookie`, restored in `afterEach`). Every expiry write (`sb-…=;`) must contain `Max-Age=0`, `Expires=Thu, 01 Jan 1970 00:00:00 GMT`, `Path=/` and `SameSite=Lax`, and never `SameSite=None` or `Domain=` | QM-2 (`SameSite=None`) **killed**; QM-3 (no `Path=/`) **killed** |
| **QA-CC-1 (b)** | New test: `history.pushState` to `/business-os/settings`, seed `sb-abcd-auth-token.0` / `.1` at `Path=/`, 5xx sign-out → both cookies gone and `clearedLocally: true` | QM-3 **killed** |
| **QA-CC-2** | L-1 now also drives the unexpected-throw path: the answer's `error` getter throws an error whose message carries the access token and the email. Asserts `outcome: 'threw'`, and that the `step: 'unexpected'` entry is exactly `{ step, authStatus: 599, authName: 'Error' }`. The existing no-secret and no-`err` checks run over every entry | QM-8b (raw `err` on that log) **killed** |
| **CR-CC-1** (optional, done) | `signOutUser` adds a final `.catch` that resolves `{ ok: false, error: 'Sign-out failed', outcome: 'threw', clearedLocally: false }`, so a throwing logger cannot make it reject. New test "a throwing logger" (the logger mock's `info` throws on demand) | Removing the `.catch` (QM-CR1) **killed** |

**Mutations:** QA's runner (`scratchpad/qa-cc-signout/mutate.py`) was copied to the Dev scratchpad so that QA's own result files were not overwritten. One mutation, QM-CR1, was added. QM-2, QM-3, QM-8b and QM-CR1 were run: **4 / 4 killed**. SHA-1 of `auth-actions.ts` and `SignOutButton.tsx` matches before and after (`5df4652b…`, `94b65b21…`).

**Re-run after the change:**

| Check | Result |
|---|---|
| The 4 C-c test files | 119 / 119 |
| Related suites | 50 suites, 1 299 tests (+3 new tests over QA's 1 296) |
| Unit file | 34 tests (was 31) |
| Full `tsc` | 1 852 errors, all pre-existing; 0 in touched files |
| eslint on the two changed files | clean |
| `lint:hooks` | clean |

---

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan created (Dev) | Planning only, no code. Read `c1a427e6` and `31976f13`, auth-js 2.75.1 and `@supabase/ssr` 0.6.1. Key finding K-1: the session is in cookies, so the original storage-only clear would not have signed anyone out; the fallback expires cookies first, then runs a network-free local sign-out. Seven call sites, none changed. Questions Q-1..Q-8 for SA. |
| 2026-10-16 | SA workplan review | ✅ Approved with conditions SA-CC-1..16. K-1..K-8 verified against auth-js 2.75.1 / ssr 0.6.1 (K-5 is stronger than stated: later auth calls queue behind a hung one). R-3 reconciled: the `handleLogout` comment edit stays in C-c (comment-only). Q-1 yes (single-flight), Q-2 **yes in C-c** (`SignOutButton` proceeds when `clearedLocally`; a second press does not succeed after a timeout), Q-3..Q-8 as recommended. `clearedLocally` measured, regex tightened, manual-QA hang method corrected (blocking/Offline is a network error, not a hang). New R-9; Dev's middleware observation recorded as F-30 (Low, not in C-c). |
| 2026-10-16 | SA conditions applied + code complete (Dev) | SA-CC-1..16 applied (§2–§14; K-8 count fixed; R-9 added; rulings in §13). `signOutUser` hardened; `SignOutButton` (SA-CC-7); settings `handleLogout` comment only (SA-CC-1). 4 test files (3 new). 31 + 17 + 1 new tests green, related suites green, full `tsc` 0 errors in touched files, eslint and `lint:hooks` clean, 25 / 25 mutations killed. Requirement: progress paragraph, F-30 row, Change History. Not committed; awaiting SA code review |
| 2026-10-16 | SA code review | ✅ Code Approved for QA. SA-CC-1..14 verified against the diff (order, 9 s bound, shape freeze, regex + expiry string, `withDeadline`, single flight, `SignOutButton`, comment-only `page.tsx`, guard, logging); related suites re-run by SA: 50 suites / 1 296 tests green. Deviations 1–7 accepted; `auditAuthEvent` `{ err }` left as is. Guard fits the no-added-CI-time rule (Jest workflow parallel to `next build`, sharded). Merge order: C-a first if both ready; requirement-MD conflict only. Findings CR-CC-1..7, all Low / informational, none blocking |
| 2026-10-16 | QA report | ✅ PASS WITH NOTES. Related suites 50 / 1 296 green; C-c files 4 / 116. Code-level paths all pinned. QA mutations QM-1..QM-16 (17 runs): 13 killed, 4 survived (QM-13 equivalent; QM-2 `SameSite=None` and QM-3 no `Path=/` invisible to jsdom; QM-8b raw `err` on the unexpected-throw log not covered by L-1). A probe proved small tests catch QM-2 / QM-3. No bug. Test gaps QA-CC-1 / QA-CC-2 (Low), observations QA-CC-3 / QA-CC-4. Manual Q-1, Q-4..Q-10, Q-12 NOT RUN (no browser), steps recorded incl. a 15 s-latency custom throttling profile |
| 2026-10-16 | QA gap closure (Dev) | QA-CC-1 (expiry-attribute setter spy + nested-path removal) and QA-CC-2 (unexpected-throw log in L-1) closed; CR-CC-1 hardened (final `.catch` in `signOutUser`, + test). QM-2, QM-3, QM-8b, QM-CR1 killed (4 / 4, SHA-1 restored). C-c files 119 / 119, related 50 / 1 299, `tsc` 0 in touched files, eslint and `lint:hooks` clean. Ready to commit |
