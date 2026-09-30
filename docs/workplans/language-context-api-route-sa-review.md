# SA Code Review: LanguageContext via API route

> **Last Updated**: 2026-09-30

## Overview

Code review of the uncommitted change on `fix/language-context-via-api-route` (base `origin/main` f75e491d). The change moves the five browser-side Supabase table calls in `lib/business-os/LanguageContext.tsx` behind the new `GET/PATCH /api/business-os/preferences` route and five new repository methods.

**Code Review by SA, 2026-09-30**
**Status:** ✅ Code Approved (with notes)

**Verdict: APPROVED WITH NOTES.** Nothing blocks. The notes below are Low priority and none needs fixing before QA.

---

## Checks performed

| Area | Result |
|---|---|
| Rule 1: no table access left in the client | ✅ No `supabase.from`/`rpc` left in `LanguageContext.tsx`. Only `supabase.auth.getUser()` remains, which is auth, not table access |
| Rule 2: Zod before logic | ✅ `z.union` of two `.strict()` objects, parsed before any write. Enums: `SUPPORTED_LANGUAGES` and the four currencies, which match `business_profiles_currency_check` (20261004) |
| Rule 3: Pino + correlationId | ✅ Route uses `logger.child({ correlationId })`. Errors are logged as `{ err }` |
| Rule 4 and tenant isolation | ✅ Every repository query filters `.eq('user_id', userId)`, and `userId` always comes from `getUser()` (the cookie session). `.strict()` rejects a smuggled `userId`, and a test proves it. No body field can redirect a write. The service-role client is justified: the route writes only the session user's own rows |
| Rule 6: types | ✅ No `any`. The narrowing casts on the DB rows are guarded with `typeof` |
| Security: error leakage | ✅ 409 and 500 bodies are fixed strings. `details` appears only under the `NODE_ENV === 'development'` guard, or as a Zod `flatten()` of the client's own input. The raw PostgREST error from `BusinessProfileRepository` is logged server-side only and never returned. A test covers the case where the 500 must not leak the message |
| Currency rules | ✅ `setCurrency` sends `code` (the owner's pick), never `currencyCode`. The rollback fix is correct: each value is restored from its own previous value, and the pin is removed when it was absent before. The old code's rollback wrote the display value into `businessCurrency`, which broke the Currency rules outright |
| 409 mapping | ✅ The trigger raises `ERRCODE = 'check_violation'` (23514). The only other 23514 source on this column is `business_profiles_currency_check`, and Zod makes it unreachable. So 23514 here means the lock |
| Audit | ✅ Non-blocking `.catch`. Both event names exist in `lib/audit/events.ts` |
| Behaviour preservation | ✅ Load order is unchanged: localStorage first, then getUser, then server values. Currency display seeding (only when there is no pin) is unchanged. A user with no business row is still a no-op, because the updates use no `.single()`. `.single()` on `user_preferences` became `maybeSingle`, and a missing row still falls through to the backfill |
| Tests | ✅ 3 suites, 45 tests, all pass locally. They cover the happy path, 401, invalid input (including a smuggled userId and both keys at once), bad JSON, 409, a 500 that does not leak, a partial language failure, audit failure, and the repository filter/column assertions |
| Rule 7: new route vs. extending `business-profile` | ✅ Warranted. `app/api/business-os/business-profile/route.ts` still calls `supabase.from(...)` directly (lines 155 and 190), so it breaks rule 1 itself. Its PUT also replaces the whole profile. Extending it would build on code that breaks the rule, and would make one PATCH per setting a second contract on it. The new route follows the existing `new-api-route` pattern, so it adds no new pattern |

---

## Code Review Comments

1. **`app/api/business-os/preferences/route.ts` (GET, the `localeResult.error \|\| currencyResult.error` branch). Priority: Low.** The two reads are now coupled. If only the `business_profiles` read fails, the stored language and timezone are thrown away as well, and the client keeps its localStorage values. On main the two reads were independent. The effect is benign: the client falls back safely, and the no-backfill-on-failure change keeps this from being destructive. *Suggested (optional):* return whichever half succeeded, with the failed field as `null` plus a flag, or accept the coupling and note it in the route header.

2. **`app/business-os/settings/page.tsx:913`. Priority: Low (pre-existing).** The picker shows `settings.profile.currency_locked` on **any** failure, including a network error or a 500. `setCurrency` now has `result.code === 'CURRENCY_LOCKED'` available but does not return it. *Suggested follow-up (not this PR):* pass `code` through `setCurrency`'s return value and show a generic save error for anything that is not the lock.

3. **`route.ts`, PATCH `{ language }`. Priority: Low (pre-existing).** The two writes in `Promise.all` are not atomic. If one succeeds and one fails, the columns disagree and the route returns 500. This is the same as main. The fix would be an RPC, which is out of scope. Noted so it stays visible.

4. **`LanguageContext.tsx` (backfill branch). Priority: Info.** Tightening `else if (savedLang)` to the three supported codes is correct. Without it, an unsupported value would now draw a 400 from the route instead of being written.

## Optimisation Suggestions

- In the `CHECK_VIOLATION` branch, `(error as Error & { code?: string }).code` could use a small `hasCode(error)` guard. This is style only.

## Out of scope (pre-existing, as the caller stated)

TS1117 duplicate keys in the translation table, the unused `currencyInitialized` warning, and the 32 `schema:check` failures on main. The file keeps no `console.*` calls.

### Code Approved for QA: Yes

---

## QA Report

**QA, 2026-09-30.** Mode: full. Strategy: A and B (Jest unit and route tests with mocked repositories), plus a code read of the client load and rollback logic. E2E skipped because no tooling exists. Input source: the caller's prompt.

### Test runs

| Run | Result |
|---|---|
| `npx jest app/api/business-os/preferences lib/repositories/__tests__/UserPreferencesRepository.test.ts lib/repositories/__tests__/BusinessProfileRepository.languageCurrency.test.ts` | 3/3 suites, **46/46 tests pass** |
| Wider regression: `lib/repositories/__tests__`, `app/api/business-os/business-profile`, `app/api/business-os/purge`, `app/business-os`, and every test that references `UserPreferencesRepository`, `BusinessProfileRepository` or `LanguageContext` (96 suites) | 93/96 suites, 1990/1992 tests pass. All 3 reds are unrelated (below) |
| `eslint` on the changed files | 0 errors. 4 warnings, all on lines this change does not touch |
| `tsc --noEmit`, filtered to the changed files | Only the TS1117 duplicate-key errors in the translation table, which were already there. No new errors |

**Reds that are not caused by this change:**
- `app/api/cron/__tests__/runRecord.adoption.test.ts` (payment-reminders, 500 instead of 200) and `app/api/business-os/chat-v4/__tests__/route.audit.test.ts` (the worker crashes on an unhandled rejection). Both fail the same way in `neuronforge-invite-s1` at `fe7f6410`. Their paths and `BusinessProfileRepository.ts` are identical there to `origin/main` `f75e491d`. Both use a factory `jest.mock` for `BusinessProfileRepository`, so adding methods cannot affect them.
- `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx`: this one timed out under the full-run load and **passes on its own**. It is flaky, and it does not use any touched module.

### CLAUDE.md minimum coverage for the new route

| Case | Covered by |
|---|---|
| Happy path | GET full and all-null. PATCH language writes both tables. PATCH currency writes currency only. An audit failure is non-blocking |
| 401 | GET and PATCH both return 401 and do not read or write |
| 400 | Unsupported language or currency, lowercase currency, empty body, both keys at once, a smuggled `userId`, an unknown field, a body that is not JSON. None of these write anything |
| Failure paths | 409 `CURRENCY_LOCKED` on 23514 with no audit. 500 on any other currency error, with no message leaked. 500 when either language write fails. GET returns a half as null on a single read failure, and 500 only when both reads fail |

Repository methods: `findLocale`, `upsertPreferredLanguage`, `findDefaultCurrency`, `updateLanguage` and `updateDefaultCurrency` each have a happy-path test that checks the user filter, and an error test. The `business_currency_lock` trigger (`BEFORE UPDATE OF currency`) fires under the service role too, so the 409 path is reachable in production.

### Client load logic (code read of `LanguageContext.tsx`)

| GET outcome | Behaviour | OK |
|---|---|---|
| Full | Sets `businessCurrency`. Seeds the display currency only when nothing is pinned. Applies the timezone, applies the language and mirrors it to localStorage. Backfills the language only when none is stored and `savedLang` is supported | ✅ |
| `locale: null` | The currency is still applied. Then it hits `if (!locale) return`, so no timezone, no language and **no backfill** | ✅ |
| `currency: null` | `businessCurrency` stays `undefined` (not collapsed to a default), the display keeps its localStorage value, and the locale is applied normally | ✅ |
| Whole fetch fails (network, 500, or a bad body) | `loadPreferencesFromServer` returns `null`. Every value keeps its localStorage fallback and nothing is written | ✅ |
| 401 | `!res.ok` returns `null`, handled the same as above. `userId` is still set from the auth call, which is the same as main | ✅ |

### `setCurrency` rollback

- `previousDisplay`, `previousBusiness` and `previousPinned` are captured before the optimistic write. On failure, `businessCurrency` is restored from `previousBusiness` (which may be `undefined`), **never** from `currencyCode`. ✅
- When `previousPinned === null`, `localStorage.removeItem('business-os-currency')` runs, so a failed save does not leave a pin behind. Otherwise the old pin is put back. ✅
- `code` goes through to the settings page. The page shows `settings.profile.currency_locked` only for `CURRENCY_LOCKED`, and `settings.business.error` otherwise. Both keys exist in en, es and he. The dependency array includes `businessCurrency`. ✅
- The payload sent is `{ currency: code }`, the picker value, never `currencyCode`. ✅

### Issues

**Bugs:** none.

**Edge cases (nice to fix, pre-existing, not blocking):**
1. PATCH `{ currency }` or `{ language }` for a user with **no `business_profiles` row** updates 0 rows and returns 200. The client then treats the currency as saved, although nothing was stored. Main behaved the same way with its direct update. A later fix could return 404 or 409 when no row was affected (use `{ count: 'exact' }`; see the PostgREST update+select note).
2. SA note 3 (the two language writes are not atomic) still applies, as SA recorded.

### Manual check still owed (by the user, signed in)

This cannot be automated here: there is no E2E tooling, and the browser session is not signed in.
1. `/business-os/settings`: change the language, reload, and confirm it sticks. Confirm both `user_preferences.preferred_language` and `business_profiles.language` changed.
2. Change the currency on an account with no invoices. It should save and survive a reload.
3. On an account with invoices or payments, attempt a currency change. The picker should snap back and show the "currency locked" message. It should not show the generic error.
4. Optionally, go offline and change the currency. It should show the generic `settings.business.error`, not the lock message.

### Verdict

**PASS WITH NOTES.** All acceptance points hold and there are no bugs. The notes are the pre-existing no-row edge case and the owed signed-in click-through.
