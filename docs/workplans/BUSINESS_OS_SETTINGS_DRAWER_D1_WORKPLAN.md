# Workplan: Business OS Settings Drawer, D-1 (Timezone write behind the preferences route)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.2, §4.2, §9.1 (P-2 to P-5), §9.2, §9.3 D-1, SA Review of §9 ruling 2, conditions C-13 (narrowed C-9 lift), C-14, C-15, C-16, C-23, C-24, C-25
**Branch:** `feature/settings-drawer-d1-timezone` (created by RM from `origin/main` `70b609f2`, which contains all of Phase A and the F-13 fix #387)
**Path:** Full cycle (data write that governs the publish gate): workplan → SA workplan review → Dev → SA code review + QA → user sees the diff → RM. The user merges.
**Date:** 2026-10-15
**Status:** Code Complete (2026-10-15), **not committed**. SA workplan review APPROVED WITH CONDITIONS (SA-D1-1 to SA-D1-9), all applied ([Implementation Notes](#implementation-notes-2026-10-15)). Live checks SA-D1-7 all PASS ([Live checks](#live-checks-sa-d1-7-2026-10-15)). Next: SA code review + QA, then the user sees the diff.

## Overview

The settings page saves the business timezone from the browser: it upserts `user_preferences`, updates the `profiles.timezone` mirror, then reads the row back to prove the value stored (§9.1 P-3 to P-5). It also reads the timezone from the browser on load (P-2). That breaks CLAUDE.md rule 1, and the upsert carries the browser's current UI language into `preferred_language`. D-1 moves all four calls behind the existing `PATCH /api/business-os/preferences` (a third, strict `{ timezone }` option) and `GET /api/business-os/preferences`, with two new repository methods. The three steps (authority write, best-effort mirror, read-back) stay, in that order, and move to the server. Success is still defined by the read-back of the authority. `NULL` ("not asked") stays distinct from `'UTC'` ("chose UTC"): the route never defaults, and an empty or unknown zone is a 400, not a write.

**Code verified against:** `app/business-os/settings/page.tsx` at `b848e267` (S-5, the last commit touching the file; blob `cba7451c`), worktree HEAD `70b609f2`. Locations below are by symbol and anchor, not line (C-13).

**F-13 check (C-25):** `findTimezone` is present on this branch (restored by #387, header note in `UserPreferencesRepository.ts`). D-1 keeps it and does not touch it.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Schema Verification](#schema-verification)
3. [Route Contract](#route-contract)
4. [Repository Methods](#repository-methods)
5. [`isValidTimezone`](#isvalidtimezone)
6. [Page Change](#page-change)
7. [Files to Create / Modify](#files-to-create--modify)
8. [Task List](#task-list)
9. [Test Plan](#test-plan)
10. [Mutation Candidates](#mutation-candidates)
11. [Manual QA Checklist](#manual-qa-checklist)
12. [Risks](#risks)
13. [Rollback](#rollback)
14. [Questions for SA](#questions-for-sa)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## Analysis Summary

| Area | What D-1 touches |
|---|---|
| Page | `app/business-os/settings/page.tsx`: the **body** of `persistTimezone` (signature `(zone: string) => Promise<string \| null>` and "zone or null" contract kept) and the **timezone half** of `loadData`. Nothing else |
| Route | `app/api/business-os/preferences/route.ts`: third union member `{ timezone }` and its handler branch in `PATCH`. `GET` unchanged (already returns `locale.timezone` raw) |
| Repositories | `UserPreferencesRepository.saveConfirmedTimezone` (new), `UserProfileRepository.updateTimezoneMirror` (new), both headers rewritten. `findLocale` (read-back) and `BusinessProfileRepository.findLanguage` (new-row language) reused unchanged |
| Pure helper | `lib/scheduling/businessTime.ts`: new `isValidTimezone`. `safeTimezone` unchanged |
| Tables | `user_preferences` (`timezone`, `timezone_confirmed_at`, `updated_at`, `preferred_language` on insert only); `profiles` (`timezone`, `updated_at`, update only); `business_profiles.language` (read only). **`business_profiles.timezone` is never named** |
| Consumers of what D-1 writes (read, unchanged) | `lib/business-os/journeyReadiness.ts` (timezone gap: `timezone_confirmed_at` and a non-blank `timezone`), `app/api/business-os/my-day/route.ts` (same pair), `lib/business-os/journeyGapFix.ts` → `?section=timezone` |
| Not touched (frozen, C-13) | The Language, Currency and Timezone **rows** byte for byte, including the timezone option's `onClick` that calls `saveProfile({ timezone: tz.value })`, the `id="settings-section-timezone"` anchor, the three guarded option rows, the timezone option list (`timezoneOptions`), `saveProfile` (D-2), the profile half of `loadData` (D-2), `handleExportData` (DE-0a), `LanguageContext.tsx` (C-16), `ProfileTab.tsx` / `ProfileTabV2.tsx`, `CRMContactDrawerV2.tsx`, `findTimezone` (C-25) |

**Call inventory removed by D-1:** P-2 (`loadData` `user_preferences` select), P-3 (`persistTimezone` upsert), P-4 (`profiles` mirror update), P-5 (read-back select). Left for D-2: P-1, P-6. Left for DE-0a: P-7 to P-9.

**Logging:** `page.tsx`, the route and both repositories have 0 `console.*` (re-checked with grep on `70b609f2`). New code uses the files' existing loggers: `requestLogger` (child with `correlationId`) in the route, `methodLogger` with `{ dbError: safeDbError(…) }` in `UserPreferencesRepository`, `{ err }` in `UserProfileRepository`, the page's module `logger`.

**Behaviour change to note (intended, from SA ruling 2):** today every timezone save upserts `preferred_language` with the browser's current UI language, so an existing row's language is overwritten by whatever language the screen happens to be in. After D-1 an existing row's `preferred_language` is never written by a timezone save; only a newly created row gets one, from `business_profiles.language` server-side. The language picker still writes both columns together (unchanged).

---

## Schema Verification

Per the `business-os-schema-check` skill, against migration bodies on `70b609f2`. **I did not query production.** `user_preferences` and `profiles` have **no DDL in the repo** (dashboard-created; recorded in `20261003_codify_create_user_settings_trigger.sql` and the `UserPreferencesRepository` header), so several facts are evidence from live code paths rather than a migration.

| Column / object | Evidence in repo | Confidence | Needs a live check? |
|---|---|---|---|
| `user_preferences.timezone` | `20261006_timezone_default_is_not_an_answer.sql` (`ALTER COLUMN timezone DROP DEFAULT`, nullable kept); read by `findLocale`, `journeyReadiness`, `my-day` | High | No |
| `user_preferences.timezone_confirmed_at` (TIMESTAMPTZ, nullable) | `20261007_timezone_confirmed.sql` `ADD COLUMN IF NOT EXISTS`; selected by `journeyReadiness` and `my-day` today (both would fail with 42703 if absent) | High | Optional (L-2) |
| `user_preferences.updated_at` | Written by today's page upsert and `upsertPreferredLanguage`; read by the 20261007 backfill | High | No |
| `user_preferences.preferred_language` and its `'en'` default | Written by `upsertPreferredLanguage`; the `'en'` default is described in `userLanguage.ts` (F-3) and the page comment, not in any migration | Medium (default value) | **Yes (L-2)** |
| `user_preferences.user_id` UNIQUE (needed for the `23505` race retry) | Implied: `upsert(…, { onConflict: 'user_id' })` succeeds today, which PostgREST rejects (42P10) without a unique or primary key on `user_id`. Signup trigger inserts exactly one row per user | High (implied) | **Yes (L-1)** |
| Triggers on `user_preferences` | None in any migration | Unknown | **Yes (L-3)** |
| `profiles.timezone` | Selected by `UserProfileRepository.findById`; written by today's page mirror | High | No |
| `profiles.updated_at` | Written by today's page; `update_profiles_updated_at` BEFORE UPDATE trigger named in `20261002_profiles_role_privilege_guard.sql` | High | No |
| Triggers on `profiles` UPDATE | `profiles_role_privilege_guard` (acts on `role` only) and `update_profiles_updated_at` (`20261002`) | High | No (mirror never sends `role`) |
| `business_profiles.language` | Read by `findLanguage` today | High | No |

`npm run schema:check` replays `.select()` calls only, and D-1 adds **no new select** (`findLocale` is reused). It was not run (it queries the live database).

**Live checks for the user (read-only, before merge; any SQL editor):**

```sql
-- L-1: user_id must be unique (primary key or unique constraint)
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.user_preferences'::regclass;

-- L-2: defaults and nullability of the columns D-1 writes
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'user_preferences'
  and column_name in ('user_id', 'timezone', 'timezone_confirmed_at', 'preferred_language', 'updated_at');

-- L-3: triggers on user_preferences (expect none, or an updated_at stamp)
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.user_preferences'::regclass and not tgisinternal;
```

Expected: L-1 shows a `p` or `u` constraint on `(user_id)`; L-2 shows `timezone` nullable with no default, `timezone_confirmed_at` timestamptz nullable, `preferred_language` default `'en'::text` (or similar); L-3 shows no trigger that writes another table. If L-1 shows no unique key on `user_id`, stop: the insert branch could create a second row in a race, and the design needs SA again.

---

## Route Contract

**`PATCH /api/business-os/preferences`** (existing route; `GET` unchanged).

### Zod schema

```typescript
// File: app/api/business-os/preferences/route.ts
const TIMEZONE_SHAPE = /^[A-Za-z0-9_+\-/]+$/; // C-14 as written; see Q-1

const timezoneValue = z
  .string()
  .min(1)
  .max(64)
  .regex(TIMEZONE_SHAPE)
  .refine(isValidTimezone, 'Unknown timezone');
// No .trim(), no .default(), no .nullable(), no .optional(): the stored value
// is exactly what was picked, and "unset" is not something this route writes.

const preferencesSchema = z.union([
  z.object({ language: z.enum(SUPPORTED_LANGUAGES) }).strict(),
  z.object({ currency: z.enum(BUSINESS_CURRENCIES) }).strict(),
  z.object({ timezone: timezoneValue }).strict(),
]);
```

**Combination with existing fields:** still one setting per request. Each member is `.strict()`, so `{ language, timezone }`, `{ currency, timezone }`, `{ timezone, user_id }`, `{ timezone, id }`, `{ timezone, userId }` match no member and are 400. `LanguageContext.savePreference` sends exactly `{ language }` or `{ currency }` (its parameter type allows nothing else), so it cannot reach the timezone branch and the timezone branch cannot be reached with a language. The branch is selected with `'timezone' in validated` **before** the existing `'language' in validated` test, and the currency path is reached only by elimination as today, so the new member cannot fall into the currency handler.

### Handler order (timezone branch)

| Step | Action | On failure |
|---|---|---|
| 1 | `getUser()` (existing). User id from the session only (C-23) | 401 `{ success: false, error: 'Unauthorized' }`, nothing read or written |
| 2 | Parse JSON (existing) | 400 `Invalid JSON body` |
| 3 | `preferencesSchema.parse(body)` (existing) | 400 `{ success: false, error: 'Invalid input', details: error.flatten() }` (F-12 closed: unchanged) |
| 4 | `requestLogger.info({ userId, timezone }, 'Timezone update requested')` | — |
| 5 | Resolve the new-row language: `businessProfileRepository.findLanguage(user.id)` inside its own `try/catch` (it can reject). `languageForNewRow = normalizeLanguage(data)` or `null` | Error, rejection or an unsupported value → `null`, `requestLogger.warn({ userId, err? }, 'No business language for a new preferences row; the column default would apply')`. **Never fails the save** |
| 6 | `userPreferencesRepository.saveConfirmedTimezone(user.id, timezone, { languageForNewRow })` | `error` → `requestLogger.error(…, 'Timezone save failed')`, 500 `{ success: false, error: 'Failed to save the timezone' }`. **No mirror, no read-back, no audit** |
| 7 | `userProfileRepository.updateTimezoneMirror(user.id, timezone, stamp)` | `error` → `requestLogger.error({ userId }, 'Timezone mirror onto the profile failed (best-effort)')`, continue |
| 8 | Read-back: `userPreferencesRepository.findLocale(user.id)`; success only if `data?.timezone === timezone` (strict, no trimming) | Read error or mismatch → `requestLogger.error({ userId, timezone, readFailed, stored }, 'The timezone did not persist')`, 500 `Failed to save the timezone`. No audit |
| 9 | Audit `AUDIT_EVENTS.SETTINGS_PREFERENCES_UPDATED`, `entityType: 'settings'`, `entityId: user.id`, `userId: user.id`, `changes: { after: { timezone } }`, `request`, `.catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`. Not awaited, no flush (not a WC-7 money/access write; same as the language branch; Q-5) | Never fails the request |
| 10 | 200 `{ success: true, data: { timezone } }` | — |

The outer `catch` (existing) maps anything thrown to 500 with the development-only `details` guard. No error message, database code or stored value ever reaches the client in production.

### Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ success: true, data: { timezone } }` | Authority written and read back equal |
| 400 | `{ success: false, error: 'Invalid JSON body' }` | Body not JSON |
| 400 | `{ success: false, error: 'Invalid input', details }` | Empty, over 64 chars, bad characters, whitespace (no trim), `null`, a number, an unknown zone, any extra key (`user_id`, `id`, `userId`, `language` …) |
| 401 | `{ success: false, error: 'Unauthorized' }` | No session |
| 500 | `{ success: false, error: 'Failed to save the timezone' }` | Authority write failed, read-back failed or differed |
| 500 | `{ success: false, error: 'Internal server error', details: dev only }` | Anything thrown |

Route header comment gains a `{ timezone }` paragraph: what it writes, the order, that success is the read-back, that the browser never sends a language, and that `business_profiles.timezone` does not exist.

---

## Repository Methods

### `UserPreferencesRepository.saveConfirmedTimezone`

```typescript
// File: lib/repositories/UserPreferencesRepository.ts
async saveConfirmedTimezone(
  userId: string,
  zone: string,
  options: { languageForNewRow: SupportedLanguage | null }
): Promise<RepositoryResult<true>>
```

The caller validates `zone`; the repository writes it as given (no trim, no default).

| Step | Query | Result handling |
|---|---|---|
| A. Update | `from('user_preferences').update({ timezone: zone, timezone_confirmed_at: stamp, updated_at: stamp }, { count: 'exact' }).eq('user_id', userId)`. **No `.select()`** (the PostgREST update + select 42703 hazard). No `preferred_language` | `error` → fail. `count >= 1` → `{ data: true }`. `count === 0` → step B. `count === null` → fail closed (`'Update count unavailable'`), no insert (Q-3) |
| B. Insert | `from('user_preferences').insert(payload)`, payload built field by field: `{ timezone: zone, timezone_confirmed_at: stamp, updated_at: stamp, ...(languageForNewRow ? { preferred_language: languageForNewRow } : {}), user_id: userId }` (`user_id` last, `tenant-isolation-guard` allow-list). No `.select()` | Success → `{ data: true }`; when `languageForNewRow` is `null`, `methodLogger.warn('Created the preferences row without a language; the column default applies')`. `error.code === '23505'` → step C. Other error → fail |
| C. Retry once | Step A again, same payload | `count >= 1` → `{ data: true }`. Error, `0` or `null` → fail. **No second retry** |

`stamp = new Date().toISOString()`, one per call (Q-2). Every failure: `safeDbError` → `methodLogger.error({ dbError })` → `{ data: null, error }` with `code` kept, as the file's other methods. Never throws. **Never upserts** (an upsert would overwrite `preferred_language` on existing rows if sent, and land on `en` for new ones if not: SA ruling 2).

### `UserProfileRepository.updateTimezoneMirror`

```typescript
// File: lib/repositories/UserProfileRepository.ts
async updateTimezoneMirror(userId: string, zone: string, stamp: string): Promise<RepositoryResult<true>>
```

One query: `from('profiles').update({ timezone: zone, updated_at: stamp }, { count: 'exact' }).eq('id', userId)`. No `.select()`, no upsert, no insert: **never creates a `profiles` row**. `count === 0` is not an error: `logger.info({ userId }, 'No profile row to mirror the timezone onto')` and `{ data: true }`. Error → `logger.error({ err, userId }, …)`, `{ data: null, error }`. Never throws. `stamp` is the route's `new Date().toISOString()`.

### Header rewrites (C-15)

- `UserPreferencesRepository`: "One writer" becomes "Two writers, each with one caller": `upsertPreferredLanguage` (language, always with `business_profiles.language`) and `saveConfirmedTimezone` (timezone + `timezone_confirmed_at`, `PATCH /api/business-os/preferences` `{ timezone }` only). States: update then insert, never upsert, and why; the new-row language comes from the server; the F-13 `findTimezone` note stays word for word.
- `UserProfileRepository`: "intentionally read-only" becomes "read access plus one targeted write, `updateTimezoneMirror`, which only updates an existing row and never creates one; `profiles` rows are created by the signup trigger". Service-role reason documented (session user's own row, `.eq('id', userId)`).

---

## `isValidTimezone`

```typescript
// File: lib/scheduling/businessTime.ts
/** True when `Intl` can resolve `zone` exactly as given. No trimming, no fallback. */
export function isValidTimezone(zone: unknown): boolean
```

`typeof zone === 'string' && zone.length > 0`, then `new Intl.DateTimeFormat('en-US', { timeZone: zone })` must not throw. Not `Intl.supportedValuesOf` (the browser's list and Node's differ, and Node 22's list omits `UTC`: verified locally, `supportedValuesOf('timeZone').includes('UTC') === false`). Pure, no logging. `safeTimezone` stays as it is (it trims and falls back; the route must not).

**Measured on Node 22.19.0 (local):** `UTC`, `Asia/Jerusalem`, `Etc/GMT+5` pass; `Foo/Bar`, `" UTC"` throw. **Also passing:** `utc`, `asia/jerusalem`, `EST`, `GMT`, and offset IDs `+05`, `+0500`, `+05:00`. The C-14 regex already rejects `+05:00` (colon) but lets `+05` and `+0500` through. See Q-1.

---

## Page Change

`app/business-os/settings/page.tsx`, two places only.

### `persistTimezone` (body only)

```typescript
// File: app/business-os/settings/page.tsx (shape, not final text)
const persistTimezone = async (zone: string): Promise<string | null> => {
  if (!user) return null;
  try {
    const res = await fetch('/api/business-os/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: zone }),
    });
    const payload = await res.json().catch(() => null);
    if (res.ok && payload?.success === true && payload?.data?.timezone === zone) return zone;
    logger.error({ userId: user.id, zone, status: res.status }, 'The server did not confirm the timezone');
    return null;
  } catch (err) {
    logger.error({ err, userId: user.id, zone }, 'Failed to save the timezone');
    return null;
  }
};
```

- The doc comment keeps its history ("three silent failures") and gains: the write, the mirror and the read-back now run on the server; `success: true` means the server read the value back.
- No `language` / `preferred_language` is sent (C-16). The `language` variable stays in the page (the Language row uses it).
- Callers unchanged: `saveProfile` still calls `persistTimezone(next.timezone)` after the profile upsert and shows `settings.profile.error` on `null`. So a profile-row failure still blocks the timezone save, as today (C-18 note; D-2 changes that half). No new translation keys.
- Never throws, so `saveProfile`'s `try/finally` and `setSaving(false)` behave as today.

### `loadData` (timezone half only)

The `user_preferences` select is replaced by `GET /api/business-os/preferences`, read as `data.locale.timezone`. The two reads still run in parallel and are **independent** (C-13): each half has its own `try/catch` (or `Promise.allSettled`), so a rejected fetch cannot blank the profile fields and a failed profile read cannot blank the timezone.

| GET outcome | `profile.timezone` | Log |
|---|---|---|
| `locale.timezone` is a string | that string, raw | — |
| `locale.timezone` is `null` (not asked) | `''` (placeholder shown, as today) | — |
| `locale` half is `null`, non-200, or the fetch rejects | `''` (unknown, as today: today a failed select also left `''`) | `logger.warn({ userId, status }, 'Could not read the stored timezone')` |

The profile half (`supabase.from('profiles')…`, P-1) is unchanged; D-2 moves it. `setProfile` keeps the "not gated on the profile row" comment. Settings pages therefore make a second preferences GET (`LanguageContext` already makes one); `LanguageContext` cannot be reused because its `timezone` is `safeTimezone`'d to `'UTC'`, which would erase "not asked" (Q-8).

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/scheduling/businessTime.ts` | modify | Add `isValidTimezone` (C-14) |
| `lib/scheduling/__tests__/isValidTimezone.test.ts` | create | Unit test for the helper |
| `lib/repositories/UserPreferencesRepository.ts` | modify | `saveConfirmedTimezone`; header (C-15). `findTimezone` untouched |
| `lib/repositories/__tests__/UserPreferencesRepository.saveConfirmedTimezone.test.ts` | create | One test group per C-15 case |
| `lib/repositories/UserProfileRepository.ts` | modify | `updateTimezoneMirror`; header (C-15) |
| `lib/repositories/__tests__/UserProfileRepository.updateTimezoneMirror.test.ts` | create | Unit tests |
| `app/api/business-os/preferences/route.ts` | modify | `{ timezone }` member, handler branch, header |
| `app/api/business-os/preferences/__tests__/route.test.ts` | modify | Timezone cases (C-15); mocks extended with `saveConfirmedTimezone`, `findLanguage`, `updateTimezoneMirror` (all real members, so the G-1 `mockedRepositoryMethods` guard stays green) |
| `app/business-os/settings/page.tsx` | modify | `persistTimezone` body and the timezone half of `loadData` only (C-13, C-16) |
| `app/business-os/settings/__tests__/timezoneWrite.guard.test.ts` | create | Source guard: the timezone path no longer touches the browser client |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | §0.2 D-1 progress line, Change History row |

No migration, no new table or column (no export classification change), no new translation key, no new route, no new pattern.

---

## Task List

- ✅ 1. SA workplan review; resolve Q-1 to Q-8 and record rulings here (SA, 2026-10-15)
- ✅ 2. Live checks L-1a, L-1b, L-2, L-3, L-4 (read-only), all PASS (run by TL at the user's request, 2026-10-15; see [Live checks](#live-checks-sa-d1-7-2026-10-15))
- ✅ 3. `isValidTimezone` + unit test
- ✅ 4. `UserPreferencesRepository.saveConfirmedTimezone` + header + unit tests
- ✅ 5. `UserProfileRepository.updateTimezoneMirror` + header + unit tests
- ✅ 6. Route: schema member, handler branch, header comment
- ✅ 7. Route integration tests (all C-15 cases plus SA-D1-3 / SA-D1-8 additions)
- ✅ 8. Page: `persistTimezone` body, timezone half of `loadData`; frozen rows re-verified with `git diff`
- ✅ 9. Source guard `timezoneWrite.guard.test.ts` with negative controls
- ✅ 10. New tests + must-stay-green set; full `tsc` before/after; `typecheck:bos-llm`; eslint on touched files; `lint:hooks`
- ✅ 11. Mutations M-1 to M-19 (scratchpad backup, restored in `finally`, SHA-1 verified)
- ✅ 12. `git diff --stat` check; this workplan and requirement §0.2 updated. **Not committed.** Hand to TL for SA code review + QA

---

## Test Plan

### New: route (`app/api/business-os/preferences/__tests__/route.test.ts`, new `describe('PATCH { timezone }')`)

| # | Case | Expect |
|---|---|---|
| R-1 | Happy path `{ timezone: 'Asia/Jerusalem' }` | 200 `{ success: true, data: { timezone } }`; `saveConfirmedTimezone(SESSION_USER.id, 'Asia/Jerusalem', { languageForNewRow: 'he' })`; mirror called with the session id; `findLocale` called after both (call order asserted); audit `SETTINGS_PREFERENCES_UPDATED` with `changes.after = { timezone }`; `upsertPreferredLanguage`, `updateLanguage`, `updateDefaultCurrency` not called |
| R-2 | `UTC` accepted | 200, written as `'UTC'` |
| R-3 | 401 with no session | Nothing read or written, no audit |
| R-4 | `''`, `'   '`, `' UTC'` (no trim), `'Foo/Bar'`, `null`, `42`, 65 chars, `'Asia/Jerusalem;drop'` | Each 400, nothing written |
| R-5 | Body carries `user_id` / `id` / `userId` beside a valid zone | Each 400 (strict), nothing written |
| R-6 | `{ timezone, language }` | 400 (one setting per request) |
| R-7 | New row carries the business language: `findLanguage` → `'he'` | `languageForNewRow: 'he'`; never taken from the body or `findPreferredLanguage` |
| R-8 | `findLanguage` returns `null`, an error, an unsupported `'fr'`, or **rejects** | Save proceeds with `languageForNewRow: null`, warn logged, 200 |
| R-9 | Authority write fails | 500 `Failed to save the timezone`; mirror, read-back and audit **not** called; no database message in the body |
| R-10 | Mirror fails | Still 200 and audited; error logged |
| R-11 | Read-back mismatch (`findLocale` → `'UTC'` after writing `'Asia/Jerusalem'`) | 500, no audit |
| R-12 | Read-back error | 500, no audit |
| R-13 | Read-back returns `null` timezone | 500 (`null` never equals a zone) |
| R-14 | Audit rejects | Still 200 |
| R-15 | Language and currency branches | Existing tests unchanged and green (regression) |

### New: repositories

`UserPreferencesRepository.saveConfirmedTimezone` (recording client in the style of `UserPreferencesRepository.test.ts`, extended with `count` in the result and a per-call result queue):

| # | Case | Expect |
|---|---|---|
| P-1 | Update hits (count 1) | Exactly one `update` with `{ timezone, timezone_confirmed_at, updated_at }` (same stamp, no `preferred_language`), options `{ count: 'exact' }`, `.eq('user_id', USER)`; no `select`, `insert`, `upsert`; `{ data: true }` |
| P-2 | Count 0, then insert with a language | Insert payload exactly `{ timezone, timezone_confirmed_at, updated_at, preferred_language: 'he', user_id }`, `user_id` is the argument |
| P-3 | Count 0, then insert without a language | No `preferred_language` key at all; warn logged |
| P-4 | Count 0, insert `23505`, retry update count 1 | Calls: update, insert, update; `{ data: true }` |
| P-5 | Count 0, insert `23505`, retry count 0 | Error, no third write |
| P-6 | Update error | `{ data: null, error }` with `code`; no insert; logged via `safeDbError` (no raw message fields beyond `code`/`message`) |
| P-7 | Insert error other than `23505` | Error, no retry |
| P-8 | Count `null` | Error, no insert (Q-3) |
| P-9 | Zone written exactly as given (`'Etc/GMT+5'`) | No trimming or rewriting |

`UserProfileRepository.updateTimezoneMirror`:

| # | Case | Expect |
|---|---|---|
| U-1 | Row updated | One `update({ timezone, updated_at: stamp }, { count: 'exact' })`, `.eq('id', USER)`; no `upsert`/`insert`/`select`; `{ data: true }` |
| U-2 | Count 0 (no profile row) | `{ data: true }`, info logged, **no insert** |
| U-3 | Error | `{ data: null, error }`, logged with `{ err }` |

### New: helper

`isValidTimezone`: `UTC`, `Asia/Jerusalem`, `America/Argentina/Buenos_Aires`, `Etc/GMT+5` → true; `''`, `' UTC'`, `'Foo/Bar'`, `null`, `undefined`, `42` → false. Plus whatever Q-1 rules for offsets.

### New: source guard (`app/business-os/settings/__tests__/timezoneWrite.guard.test.ts`)

Comments stripped (as `greetingUsesTheEditedName.guard.test.ts` does). Extracts the `persistTimezone` body (from `const persistTimezone` to `const saveProfile`) and the `loadData` body.

- `persistTimezone` contains no `supabase.` and no `.from(`; contains `fetch('/api/business-os/preferences'`, `method: 'PATCH'` and `timezone: zone`; contains no `preferred_language` and no `language`.
- `loadData` contains no `'user_preferences'` and reads `/api/business-os/preferences`.
- The whole page (comments stripped) contains no `from('user_preferences')`.
- Signature pin: `const persistTimezone = async (zone: string): Promise<string | null>`.
- Negative controls: the same matchers on synthetic snippets (the old upsert body; a body that sends `preferred_language`) must fail.

### Must stay green

| Suite | Why |
|---|---|
| `app/api/business-os/preferences/__tests__/route.test.ts` (existing cases) | Language / currency branches |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | C-2 timezone anchor + branch, frozen comment |
| `lib/business-os/__tests__/journeyReadiness.test.ts` | Timezone gap and `?section=timezone` href |
| `lib/repositories/__tests__/UserPreferencesRepository.test.ts`, `UserPreferencesRepository.findTimezone.test.ts`, `lib/services/__tests__/packageAcceptance.test.ts` | F-13 (C-25) |
| `lib/repositories/__tests__/mockedRepositoryMethods.guard.test.ts` | G-1: every mocked repository member exists |
| `lib/business-os/__tests__/readInitialLanguage.test.ts`, `userLanguage.test.ts` | Same repository mocked; language resolution rule |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | `user_preferences` / `profiles` identity tables: D-1 adds no delete |
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | Pins `saveProfile`'s `profiles` upsert, untouched by D-1 |
| `components/ui/__tests__/darkModeTokens.guard.test.ts` | Exactly three guarded option rows |
| `lib/business-os/entitlements/__tests__/planBadge.test.ts`, `app/business-os/settings/__tests__/accountCard.guard.test.ts`, `components/business-os/settings/__tests__/*` | Phase A pins on `page.tsx` |
| `lib/scheduling/__tests__/*`, `components/scheduling/__tests__/businessClock.guard.test.ts` | `businessTime.ts` edited |
| `app/api/user/profile/__tests__/route.test.ts` | Same tables, other route; must be unaffected |

---

## Mutation Candidates

Each applied to a scratchpad copy, restored in `finally`, hash-verified; each must be caught by at least one test.

| # | Mutation | Caught by |
|---|---|---|
| M-1 | Drop `{ count: 'exact' }` from the update | P-1 |
| M-2 | Treat `count === null` as 0 (insert) | P-8 |
| M-3 | Insert never carries `preferred_language` | P-2 |
| M-4 | Remove the `23505` retry | P-4 |
| M-5 | Replace update/insert with `upsert(…, { onConflict: 'user_id' })` | P-1, P-2 |
| M-6 | `user_id` placed before a spread / taken from elsewhere | P-2 |
| M-7 | Mirror becomes `upsert` | U-1, U-2 |
| M-8 | `isValidTimezone` returns `true` always | R-4 (`Foo/Bar`), helper test |
| M-9 | `.trim()` added to the schema | R-4 (`' UTC'`) |
| M-10 | Remove `.strict()` from the timezone member | R-5 |
| M-11 | Skip the read-back (return 200 after the mirror) | R-11, R-12 |
| M-12 | Mirror failure returns 500 | R-10 |
| M-13 | Mirror runs after a failed authority write | R-9 |
| M-14 | Language from `findPreferredLanguage` or a body field instead of `findLanguage` | R-7 |
| M-15 | Un-caught `findLanguage` rejection | R-8 (rejects) |
| M-16 | Page `persistTimezone` restored to the browser upsert | Source guard |

---

## Manual QA Checklist

On a test account, desktop and phone, English and Hebrew. No production data is changed beyond the test account's own timezone.

| # | Check | Expected |
|---|---|---|
| Q1 | Settings → Timezone → pick `Asia/Jerusalem` | "Saved" banner; reload shows `Jerusalem — Asia/Jerusalem` |
| Q2 | Pick `UTC` | Saved; reload shows UTC (a choice, not the placeholder) |
| Q3 | Network tab during a pick | One `PATCH /api/business-os/preferences` with body exactly `{"timezone":"…"}`; **no** request to `…supabase.co/rest/v1/user_preferences`; the `profiles` upsert from `saveProfile` is still there (D-2) |
| Q4 | Network tab on page load | `GET /api/business-os/preferences` (two: `LanguageContext` and the page); no `user_preferences` REST call |
| Q5 | Publish gate: account with no confirmed timezone → publish a booking page → "Set your timezone" | Lands on `/business-os/settings?section=timezone`, scrolled to the timezone row; after picking a zone the gate clears on the publish screen |
| Q6 | Hebrew: same as Q1 and Q5 | Banner and row text in Hebrew; nothing else on the row changed |
| Q7 | Language untouched: Hebrew account, pick a timezone, reload | Interface still Hebrew; the PATCH body (Q3) carries no language |
| Q8 | Offline (DevTools offline) → pick a zone | Red error banner; nothing saved; picker shows the picked value until reload (as today) |
| Q9 | Signed-out `curl -X PATCH …/api/business-os/preferences -d '{"timezone":"UTC"}'` | 401 |
| Q10 | Signed-in request with `{"timezone":"UTC","user_id":"<other>"}` | 400, nothing written |
| Q11 | Signed-in request with `{"timezone":"Foo/Bar"}` and `{"timezone":""}` | 400 |
| Q12 | Language and Currency pickers | Unchanged behaviour, including `CURRENCY_LOCKED` |
| Q13 | My Day timezone nudge after Q1 | Not shown (it reads `timezone_confirmed_at`) |

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| RK-1 | Browser offers a zone the server's ICU does not know (different Node / browser ICU data) | Low | Constructor check, not list membership; result is a visible error, never a wrong save. Logged with the zone |
| RK-2 | Offset or alias forms (`+05`, `utc`, `EST`) accepted from a hand-crafted request | Low (the picker never offers them) | Q-1 |
| RK-3 | `count` comes back `null` in some environment | Low (7 repositories rely on it) | Fail closed (P-8) instead of inserting a duplicate attempt |
| RK-4 | No unique key on `user_preferences.user_id` live | Very low (today's upsert needs one) | L-1 before merge; stop if absent |
| RK-5 | Existing `preferred_language` no longer refreshed by a timezone save | Intended | Recorded in Analysis; the language picker writes both columns |
| RK-6 | `LanguageContext`'s in-memory timezone stays stale until reload after a save | Pre-existing (today identical) | Out of scope (C-16 freezes `LanguageContext`) |
| RK-7 | Extra GET on the settings page load | Certain, small | Q-8 |
| RK-8 | Two tabs save different zones at once | Low | Last write wins; each tab's read-back proves its own value or fails visibly |
| RK-9 | Semantic merge with DE-0a or D-2 on `page.tsx` | Medium | One open `page.tsx` PR at a time (C-24); whichever merges second merges `origin/main` in |

---

## Rollback

Code only: no migration, no data backfill, no new column. Revert the PR. Rows written by D-1 have the same shape the old browser path wrote (`timezone`, `timezone_confirmed_at`, `updated_at`; `preferred_language` only on a new row), so the reverted page reads them unchanged. Nothing to undo in the database.

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Node 22 `Intl` accepts offset IDs (`+05`, `+0500`), lowercase (`utc`, `asia/jerusalem`) and legacy aliases (`EST`, `GMT`). The C-14 regex lets `+05`/`+0500` through. A stored offset would pass the readiness gate but `safeTimezone` in an older browser engine could reject it and show UTC times | Require a letter first: `^[A-Za-z][A-Za-z0-9_+\-/]*$`. Keep lowercase and aliases (Intl resolves them; requiring the canonical form would reject legitimate picks where the browser's and Node's ICU canonicalise differently, e.g. `Asia/Kolkata` vs `Asia/Calcutta`) |
| Q-2 | Ruling 2's signature has no stamp, but the mirror takes one, so the two tables get stamps milliseconds apart (today the page used one) | Add `confirmedAt: string` to the options bag so the route passes one stamp to both. Otherwise keep the exact signature; the difference is cosmetic |
| Q-3 | `count === null` after the update (should not happen with `{ count: 'exact' }`) | Fail closed: error, no insert |
| Q-4 | Where the "column default applied" warn lives | Route warns when the language lookup fails; the repository warns only when it actually inserts without a language, so a normal update does not log noise |
| Q-5 | Audit flush | No flush: not a WC-7 write, and the language branch does not flush |
| Q-6 | `findLanguage` runs on every timezone save, though only the rare insert branch needs it (the signup trigger creates the row) | Keep it eager: one small indexed read, matches the ruled signature |
| Q-7 | The behaviour change in RK-5 (existing rows' `preferred_language` no longer overwritten) | Confirm intended |
| Q-8 | The page makes its own preferences GET, duplicating `LanguageContext`'s mount GET | Accept: `LanguageContext.timezone` is `safeTimezone`'d to `'UTC'`, which erases "not asked", and C-16 freezes it |

---

## SA Review Notes

See [SA Workplan Review (2026-10-15)](#sa-workplan-review-2026-10-15) below.

---

## SA Workplan Review (2026-10-15)

**Reviewed by SA — 2026-10-15**
**Status:** APPROVED WITH CONDITIONS (conditions SA-D1-1 to SA-D1-9 below). Implementation may start now. **Merge (RM) is gated on SA-D1-7** (the user's live-check results).

**Verified against code on `70b609f2`:** `page.tsx` (`loadData`, `persistTimezone`, `saveProfile`, the profile card's `onClick={() => saveProfile()}` and the timezone option's `saveProfile({ timezone: tz.value })`, `timezoneOptions`), `preferences/route.ts` (GET returns `localeResult.data?.timezone ?? null`, raw), `UserPreferencesRepository.ts` (`findTimezone` present, F-13), `UserProfileRepository.ts` (header "intentionally read-only"), `BusinessProfileRepository.findLanguage` (no `try/catch`: it can reject), `businessTime.ts` (`safeTimezone`), `LanguageContext.tsx` (`savePreference` body type, `setTimezone(safeTimezone(…))`, initial `'UTC'`), `journeyReadiness.ts` and `my-day/route.ts` (both: `timezone_confirmed_at` truthy AND non-blank `timezone`), `onboarding/build/route.ts`, migrations `20261003`, `20261006`, `20261007`, existing `preferences/__tests__/route.test.ts`, skills `new-api-route`, `new-repository`, `tenant-isolation-guard`, `business-os-schema-check`.

### Architectural fit

Sound and proportional. It reuses the existing route, its one-setting-per-request union, two existing repositories and `findLocale`; no new route, table, migration or pattern (rule 7). The order (authority, then mirror, then read-back), the no-upsert rule, the server-resolved new-row language and `user_id` last in the insert payload all match SA ruling 2, C-14, C-15 and C-23. Tenant isolation: the user id comes only from `getUser()`; every query is scoped (`.eq('user_id')` / `.eq('id')`); strict members reject `user_id`, `id`, `userId`. Service-role use is documented in both headers. No `console.*` in any touched file. No entitlements import. Rollback (revert, no data step) is correct: rows written by D-1 have the shape the old browser path wrote.

### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| Q-1 | **Approved: `^[A-Za-z][A-Za-z0-9_+\-/]*$`, amending C-14.** No IANA identifier starts with a digit or a sign, so nothing the picker offers is lost. Offset IDs (`+05`, `+0500`) are rejected: Node 22 resolves them to `+05:00`, older browser engines reject them (`safeTimezone` would then show UTC while the readiness gate says "answered"), and Postgres reads POSIX offsets with the sign inverted if one is ever used in SQL. **Aliases and lowercase stay accepted, stored verbatim, no canonicalisation.** Measured on Node 22.19: `Asia/Kolkata` resolves to `Asia/Calcutta` and `Europe/Kyiv` to `Europe/Kiev`, so canonicalising would store a different string than the one picked and break the strict read-back. **`'UTC'` and `'Etc/UTC'` both pass** and both are legitimate. **Downstream is safe for `EST`, `utc` and the like:** every consumer goes through `Intl` (`safeTimezone`, `businessTime.ts`, which accept them; `EST` resolves to a fixed UTC-5); `journeyReadiness` and My Day only test that the value is non-blank; no SQL function uses `user_preferences.timezone` (`AT TIME ZONE` appears only in usage and credit migrations, on fixed zones); `onboarding/build` compares `=== 'UTC'` and would treat `utc` as already set, which is correct (it means somebody chose it). The only visible effect is cosmetic and only for a hand-crafted request: `currentTimezone` finds no option matching `utc`, so the picker label falls back. The picker never sends those forms |
| Q-2 | **Approved.** Signature becomes `saveConfirmedTimezone(userId, zone, { languageForNewRow, confirmedAt })`, `confirmedAt: string` required. The route makes one `new Date().toISOString()` and passes it to both repositories, which keeps today's single stamp and makes the tests deterministic. This is a compatible extension of ruling 2, not a change of shape |
| Q-3 | **Approved: fail closed.** `count === null` is an error, logged, no insert. Additionally (suggestion, not a condition): `count > 1` is still success but `methodLogger.warn` it; that would be the only signal of duplicate rows in production |
| Q-4 | **Approved with a change (SA-D1-4).** The repository's warn on an insert without a language is the one authoritative "column default applied" signal. The route logs at **warn only when `findLanguage` errors or rejects** (a real failure), with wording that does not claim a default was applied (for example `'Could not read the business language (used only if a preferences row must be created)'`). A `null` or unsupported value is logged at `debug`. Otherwise every save from an account with no business language would warn about a default that, on the normal update path, never applies |
| Q-5 | **Confirmed: no flush.** The `new-api-route` checklist requires an awaited `flush()` only for money, access, entitlement or price writes (WC-7). A timezone setting is none of these, and the language branch of the same route does not flush. `.catch(…)`, not awaited, as planned |
| Q-6 | **Keep it eager.** A lazy callback would make a repository call back into route-supplied code for a second table, which is a new shape for one indexed read on a rare user action. The signature ruled in item 2 stands. Q-4's logging change removes the only cost of being eager (log noise) |
| Q-7 | **Intended, confirmed.** No consumer relied on it. Server-side language resolution (`resolveUserLanguage`) prefers `business_profiles.language`, which the timezone save never touched. On the client, `LanguageContext` sets the screen language from the stored `preferred_language` on load, so for an existing row the old overwrite wrote back the same value, except in one case: when the locale read had failed and the screen ran on `localStorage`, the old save could write that browser's language over a real stored one. D-1 removes that. The language picker still writes both columns |
| Q-8 | **Accepted.** `LanguageContext.timezone` starts as `'UTC'` and is set through `safeTimezone`, so it cannot express "not asked", and C-16 freezes it. The GET already returns the value raw and null-preserving: `findLocale` returns `null` for no row or a non-string, and the route passes `?? null`. A stored `''` comes back as `''`, which the page treats like `null` (placeholder), as today. One extra small GET per settings load is an acceptable cost; RK-7 stands |

### Other checks

| Check | Result |
|---|---|
| One-setting-per-request strictness vs existing callers | Safe. The only caller is `LanguageContext.savePreference`, whose body type is `{ language } \| { currency }`. Branch order (`'timezone' in validated` first, currency by elimination) is correct. **But one existing test changes:** `route.test.ts` "invalid input" pins `['an unknown field', { timezone: 'UTC' }]` as a 400. After D-1 that is a valid 200. R-15 "existing tests unchanged" is therefore wrong (SA-D1-3) |
| Zod and `.refine` | In Zod 3.25, a failed `min`/`max`/`regex` marks the value dirty, not aborted, so `.refine(isValidTimezone)` still runs on an over-long or malformed string. `isValidTimezone` must never throw and should return `false` for anything over 64 characters before calling `Intl` (SA-D1-1) |
| Read-back proof | Correct: strict `===` on the raw `findLocale` value, no trim, after the mirror, through the same service-role client. A trigger that rewrote the value (L-3) would show up as a visible failure, not a false success |
| The profile card's Save re-sends the stored zone | `saveProfile()` (the card's Save, no overrides) calls `persistTimezone(profile.timezone)` whenever a zone was loaded. So after D-1, **every stored value is re-validated by the new route on a name or job-title save.** A stored value the new validator refuses (other writers do not validate: `onboarding/build`, `/api/user/profile`, `app/(protected)/settings/page.tsx`, `useOnboarding.ts`) would make a name save show an error after the profile row was already written. Hence live check L-4 (SA-D1-7) and manual check Q14 (SA-D1-8) |
| Duplicate-key retry and L-1 | The retry needs a unique **constraint or unique index** on `user_id`. Today's `upsert(…, { onConflict: 'user_id' })` from the page and `upsertPreferredLanguage` would fail with 42P10 without one, and both work in production, so absence is very unlikely. L-1 as written reads `pg_constraint` only, which **does not list a unique index created with `CREATE UNIQUE INDEX`**, so it could come back empty on a healthy table and stop the slice for nothing. Revised below. **If truly absent:** stop. A race in the insert branch could create a second row, and every `.maybeSingle()` reader (`findLocale`, `journeyReadiness`, My Day, `findTimezone`) would then error on that account. The fix would be a migration adding the unique key, which is its own slice, not D-1 |
| Should D-1 be blocked on L-checks? | **Coding: no.** The code and tests do not depend on the results. **Merge: yes**, on L-1, L-2 and L-4. L-3 blocks only if it shows a trigger that writes another table or rewrites `timezone` |
| Test plan | Good coverage of C-15. Additions in SA-D1-3 and SA-D1-8 |
| Mutations | M-1 to M-16 are the right set. Add M-17 to M-19 (SA-D1-8) |
| Manual QA | Adequate for the publish gate (Q5) and the network proof (Q3, Q4, Q7). Add Q14 (SA-D1-8). Q9 to Q11 need a signed-in request with a session cookie; QA records how it was made |
| Repository headers | "Two writers, each with one caller" is accurate only within the repository. Other code still writes `user_preferences.timezone` directly (see the row above). The header must say so (SA-D1-5) |

### New finding (pre-existing, not D-1's): F-24 for D-2

**F-24 (Medium). The profile card's Save confirms the timezone on the owner's behalf.** `saveProfile()` with no overrides calls `persistTimezone(profile.timezone)` whenever a zone was loaded, and the timezone save stamps `timezone_confirmed_at`. So an owner who only edits their name "answers" the timezone question. The cases where that is wrong are the ones `20261007` exists for: the legacy default `'UTC'` (9 of 12 accounts at the time) and the unconfirmed IP-guessed zone stored by `onboarding/build`. The readiness gate then stops asking. This is on `main` today and D-1 neither causes nor worsens it. C-13 freezes `saveProfile` for D-1. **Fix in D-2**, which rewrites `saveProfile` anyway: call the timezone route only when the timezone was passed as an override (the timezone row's pick), never on the card's Save. TL adds F-24 to requirement §7 and to the D-2 workplan's scope.

### Conditions

1. **SA-D1-1 Validation (Q-1).** Zod: `.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/).refine(isValidTimezone, …)`, no trim, default, nullable or optional. `isValidTimezone` returns `false` for a non-string, empty, or over-64-character value before calling `Intl`, and never throws. Tests (helper and route): `'+05'`, `'+0500'` give false / 400; `'UTC'`, `'Etc/UTC'`, `'utc'`, `'EST'` give true / 200 and are stored verbatim (asserted on the `saveConfirmedTimezone` argument).
2. **SA-D1-2 Stamp (Q-2).** `saveConfirmedTimezone(userId, zone, { languageForNewRow, confirmedAt })`. The route creates one stamp and passes it to both repository calls. R-1 asserts the mirror's stamp equals `confirmedAt`; P-1 asserts `timezone_confirmed_at === updated_at === confirmedAt`.
3. **SA-D1-3 Existing route tests.** Replace the "invalid input" case `['an unknown field', { timezone: 'UTC' }]` with a field that is still unknown (for example `{ theme: 'dark' }`), and add `{ timezone: 'UTC', currency: 'USD' }` beside R-6. Extend the file's `noWrites()` helper to also assert `saveConfirmedTimezone` and `updateTimezoneMirror` were not called, so every existing 400/401 case covers the new writers. Correct R-15's wording: one existing case changes on purpose.
4. **SA-D1-4 Logging (Q-4).** Route: warn only when `findLanguage` errors or rejects (`{ err }`), with the wording above; `debug` for null or unsupported. Repository: warn when it actually inserts without a language. The read-back failure log carries `stored` only as a length or a boolean match flag, not as free text (a hand-edited row could hold anything).
5. **SA-D1-5 Headers (C-15).** `UserPreferencesRepository`: "two writers in this repository" plus one sentence naming the direct writers that remain outside it (`app/api/onboarding/build/route.ts`, `app/api/user/profile/route.ts`, `app/(protected)/settings/page.tsx`, `components/onboarding/hooks/useOnboarding.ts`) as known debt that D-1 does not move. The F-13 `findTimezone` paragraph stays word for word. `UserProfileRepository`: as planned.
6. **SA-D1-6 Page.** As planned. `loadData`'s two halves are independent (`Promise.allSettled` or separate `try/catch`), and the profile half's code is unchanged byte for byte. `git diff` of `page.tsx` shows changes only inside `persistTimezone`'s body and the timezone half of `loadData`.
7. **SA-D1-7 Live checks: merge gate.** The user runs the revised L-1, L-2, L-4 (and L-3) below, read-only, and posts results before RM merges. Expected: L-1 shows a primary key, unique constraint or unique index on `(user_id)` **and** the duplicate query returns no rows; L-2 shows no NOT NULL column without a default other than `user_id` (and the key column, if it has a default); L-3 shows no trigger that writes another table or changes `timezone`; L-4 returns no rows. **Stop rules:** L-1 fails, then stop and back to SA (needs a migration slice first). L-4 returns rows, then SA rules per value before merge (options: leave as is with the name-save risk recorded until F-24 lands, or a one-off data fix by the user). Results are recorded in this workplan.
8. **SA-D1-8 Tests, mutations, QA additions.** R-11b: `findLocale` returns `' Asia/Jerusalem'` after writing `'Asia/Jerusalem'`, expect 500 (read-back is strict). R-16: zone with a leading letter but unknown to `Intl` (`'Mars/Olympus'`) gives 400. Mutations: M-17 `persistTimezone` sends `language` (source guard); M-18 regex back to the C-14 form (R-4 `'+05'`); M-19 read-back compares trimmed values (R-11b). Manual QA **Q14**: on an account with a stored zone, edit the name on the profile card and Save: "Saved" shows, and the network tab shows a `PATCH` carrying the stored zone (that is F-24, recorded, not fixed here).
9. **SA-D1-9 Records.** The Q-1 regex amendment to C-14 and F-24 are recorded in the requirement (TL adds F-24 to §7 and the D-2 scope). No commit by Dev; the user sees the diff first.

### Live checks for the user (read-only; replaces L-1 to L-3 above)

```sql
-- L-1a: keys on user_preferences, including unique indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'user_preferences';

-- L-1b: any account with more than one preferences row (expect no rows)
select user_id, count(*) as row_count
from public.user_preferences
group by user_id
having count(*) > 1;

-- L-2: every column, its nullability and default
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'user_preferences'
order by ordinal_position;

-- L-3: triggers on user_preferences
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.user_preferences'::regclass and not tgisinternal;

-- L-4: stored zones the new route would refuse or that need a look (expect no rows)
select timezone, count(*) as accounts, count(timezone_confirmed_at) as confirmed
from public.user_preferences
where timezone is not null
  and (timezone !~ '^[A-Za-z][A-Za-z0-9_+/-]*$'
       or length(timezone) > 64
       or timezone not in (select name from pg_timezone_names))
group by timezone
order by accounts desc;
```

L-4 note: Postgres's zone list and the server's ICU list are close but not identical, so a row listed by L-4 is "to review", not automatically invalid. An empty string `''` shows up here and is harmless (the page treats it as unset).

### Optimisation suggestions (not conditions)

- Q-3: warn when `count > 1`.
- Follow-up after D-4: once no browser code writes `user_preferences`, the table's browser-side write policies can be tightened. The other direct writers listed in SA-D1-5 must move first. Not in this feature.

### Approval

[x] Workplan approved with conditions SA-D1-1 to SA-D1-9: proceed to implementation. Merge gated on SA-D1-7.

---

## Live checks (SA-D1-7, 2026-10-15)

Run read-only on the production database (project AgentsPilot-dev, `jgccgkyhpwirgknnceoh`) by TL at the user's request, 2026-10-15. **All PASS; the merge gate is met. No change to the plan.**

| Check | Result | Detail |
|---|---|---|
| L-1a keys and unique indexes | ✅ PASS | `user_preferences_pkey` UNIQUE (`id`) and `user_preferences_user_id_key` UNIQUE INDEX (`user_id`): the `23505` retry has its unique key |
| L-1b duplicate rows | ✅ PASS | No `user_id` with more than one row |
| L-2 columns | ✅ PASS | Only `id` (default `gen_random_uuid()`) and `user_id` are NOT NULL; `preferred_language` default `'en'`; `timezone` and `timezone_confirmed_at` nullable, no default; `updated_at` default `now()` |
| L-3 triggers | ✅ PASS | One trigger, `update_user_preferences_updated_at` BEFORE UPDATE → `update_updated_at()`: sets `updated_at` only, writes no other table, does not touch `timezone`. Note: on the UPDATE path the trigger overrides the repository's explicit `updated_at`, so `updated_at` and `timezone_confirmed_at` can differ by milliseconds in the stored row (harmless; the read-back compares `timezone` only). On the INSERT path both carry `confirmedAt` |
| L-4 stored zones the route would refuse | ✅ PASS | No rows |

---

## Implementation Notes (2026-10-15)

**Status:** code complete, **not committed** (the user reviews the diff first). Worktree `neuronforge-settings-drawers`, branch `feature/settings-drawer-d1-timezone`, base `70b609f2`.

### Files

| File | Change |
|---|---|
| `lib/scheduling/businessTime.ts` | `+40`: `MAX_TIMEZONE_LENGTH`, `TIMEZONE_SHAPE` (SA-D1-1 regex), `isValidTimezone`. `safeTimezone` untouched |
| `lib/scheduling/__tests__/isValidTimezone.test.ts` | new |
| `lib/repositories/UserPreferencesRepository.ts` | `saveConfirmedTimezone`; header rewritten per SA-D1-5 (two writers, known-debt sentence naming the four direct writers); the F-13 `findTimezone` paragraph and the method itself unchanged |
| `lib/repositories/__tests__/UserPreferencesRepository.saveConfirmedTimezone.test.ts` | new (P-1..P-10 + "never upserts/selects") |
| `lib/repositories/UserProfileRepository.ts` | `updateTimezoneMirror`; header ("read access plus one targeted write", service-role reason) |
| `lib/repositories/__tests__/UserProfileRepository.updateTimezoneMirror.test.ts` | new (U-1..U-3) |
| `app/api/business-os/preferences/route.ts` | `{ timezone }` member (strict), handler branch first, header paragraph. GET, language and currency branches unchanged |
| `app/api/business-os/preferences/__tests__/route.test.ts` | mocks extended (`saveConfirmedTimezone`, `findPreferredLanguage`, `updateTimezoneMirror`, `findLanguage`, all real members); `noWrites()` extended; unknown-field case now `{ theme: 'dark' }`; new `describe('PATCH { timezone }')` R-1..R-16 incl. R-11b |
| `app/business-os/settings/page.tsx` | `persistTimezone` body (plus its doc comment gaining one paragraph) and the timezone half of `loadData` only |
| `app/business-os/settings/__tests__/timezoneWrite.guard.test.ts` | new source guard with three negative controls |

`git diff --stat` (tracked files): 7 files, 625 insertions, 57 deletions. The only notable deletions are `page.tsx` (45 lines: the browser upsert, mirror and read-back replaced by one `fetch`, as intended) and the requirement doc (1 line: TL's pre-existing F-23 row edit, not mine). No deletion without a matching insertion; no unexpected files.

### Conditions applied

| Condition | How |
|---|---|
| SA-D1-1 | Zod `.string().min(1).max(64).regex(TIMEZONE_SHAPE).refine(isValidTimezone)`, no trim/default/nullable/optional. `isValidTimezone` returns false for a non-string, empty or >64-char value before `Intl`, never throws (tested with a spy that `Intl.DateTimeFormat` is not called for 65 chars). `+05`, `+0500` → false / 400; `UTC`, `Etc/UTC`, `utc`, `EST` → true / 200, asserted verbatim on the `saveConfirmedTimezone` and mirror arguments |
| SA-D1-2 | `saveConfirmedTimezone(userId, zone, { languageForNewRow, confirmedAt })`; route makes one stamp; R-1 asserts the mirror's stamp equals `confirmedAt`; P-1 asserts `timezone_confirmed_at === updated_at === confirmedAt` |
| SA-D1-3 | Unknown-field case replaced; `{ timezone, currency }` added (R-6); `noWrites()` covers both new writers; R-15 wording: the existing suite is green with **one case changed on purpose** (the unknown-field body) |
| SA-D1-4 / Q-3 / Q-4 | Route warns only when `findLanguage` errors or rejects, with the SA wording; `debug` for null/unsupported (R-8 asserts warn count 1 vs 0). Repository warns only when it inserts without a language (P-3, P-3b). Read-back failure log carries `readFailed` and `storedLength` (number or null), never the stored text (R-11 asserts the stored string appears in no log call). `count === null` → error, no insert (P-8); `count > 1` → success + warn (P-10) |
| SA-D1-5 | Both headers as ruled |
| SA-D1-6 | `Promise.allSettled` for the two halves; the profile query line and the three `profileRes.data?.…` lines byte-identical; `git diff` of `page.tsx` touches only `loadData`'s timezone half (and the destructuring needed for `allSettled`) and `persistTimezone` |
| SA-D1-8 | R-11b, R-16, M-17..M-19 added; Q14 left for QA |
| SA-D1-9 | Records below and in requirement §0.2. F-24 not fixed (`saveProfile` frozen) |

**Additional decisions to note:**
- **`TIMEZONE_SHAPE` lives in `businessTime.ts` and is shared by the route and `isValidTimezone`.** SA-D1-1 requires the *helper* to return false for `+05`/`+0500`, and Node's `Intl` accepts both, so the helper has to apply the shape too. One constant keeps the two from drifting, and M-18 (mutating it) is killed by both the helper and the route tests.
- **`loadData` profile half on rejection:** with `allSettled`, a rejected profile read is now logged (`'Failed to load the profile row'`) and the page still sets the timezone with blank name fields, where before the whole `setProfile` was skipped. supabase-js returns `{ error }` rather than rejecting, so this path is practically unreachable; the profile-half code itself is unchanged.
- The route reads `findLanguage` eagerly (Q-6), before the stamp is made.

### Verification

| Check | Result |
|---|---|
| New + modified suites (route, 2 repository, helper, source guard) | ✅ all pass (route file 81 tests incl. existing) |
| Must-stay-green set from the Test Plan, plus every other test that references a touched file (`adminReadMethods`, `userDataExportReads`, data-export, admin audit-trail/users/finance/invites routes, `my-plan`, invites deps, `pluginConnectionsBrowserAccess`, reminder services, `quickPickLabels`, `AdminHeader`, …) | ✅ 49 suites / 1023 tests + 23 suites / 437 tests, 0 failures; post-mutation re-run 10 suites / 191 tests green |
| Full `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`) | 1852 errors before, 1852 after; **0 in any touched file** before or after |
| `npm run typecheck:bos-llm` | ✅ passed: 541 files, 28 errors, **0 new** (it also reports one stale baseline entry in `app/api/onboarding/build/route.ts`, a file D-1 does not touch) |
| eslint on the 10 touched files | 0 errors, 1 warning: `page.tsx` `react-hooks/exhaustive-deps` on the mount `useEffect` (line 165), pre-existing, not in D-1's lines |
| `npm run lint:hooks` | ✅ clean |
| `console.*` in touched files | 0 |

### Mutations (M-1..M-19)

Scratchpad runner: backup per mutation, anchor must match exactly once, the five D-1 suites run, file restored in `finally` and SHA-1 verified. **19 / 19 killed, all restored.**

| # | Mutation | Killed by |
|---|---|---|
| M-1 | update without `{ count: 'exact' }` | saveConfirmedTimezone (2) |
| M-2 | `null` count treated as 0 | P-8 |
| M-3 | insert without `preferred_language` | P-2 |
| M-4 | no `23505` retry | P-4, P-5 |
| M-5 | update → upsert | 9 repository tests |
| M-6 | `user_id` first in the insert row | P-2 (key order) |
| M-7 | mirror → upsert | U-1, U-2 |
| M-8 | `isValidTimezone` always true | helper + route (16) |
| M-9 | `.trim()` in the schema | R-4 (`' UTC'`, `'UTC '`) |
| M-10 | timezone member not `.strict()` | R-5, R-6 (5) |
| M-11 | read-back skipped | R-11, R-11b, R-12, R-13 |
| M-12 | mirror failure → 500 | R-10 |
| M-13 | mirror after a failed authority write | R-9 |
| M-14 | language from `findPreferredLanguage` | R-1, R-7, R-8 (6) |
| M-15 | `findLanguage` rejection uncaught | R-8 (rejects) |
| M-16 | page `persistTimezone` writes through the browser client | source guard (2) |
| M-17 | page sends `language` | source guard |
| M-18 | regex back to the C-14 form | helper + route `+05`/`+0500` (4) |
| M-19 | read-back compared trimmed | R-11b |

### Questions for SA (code review)

1. `TIMEZONE_SHAPE` and `MAX_TIMEZONE_LENGTH` are exported from `businessTime.ts` and imported by the route, rather than the regex living only in the route as the workplan sketched. Acceptable?
2. The `allSettled` profile-rejection log line (see above) is the only new statement in the profile half. Within SA-D1-6?
3. L-3 shows a BEFORE UPDATE trigger that resets `updated_at`, so P-1's "same stamp" holds for the payload, not necessarily for the stored row on the update path. Record only, or does SA want a comment in the repository?

---

## SA Code Review (2026-10-15)

**Code Review by SA — 2026-10-15**
**Status:** ✅ APPROVED (no conditions). Code approved for QA: **Yes**. The merge gate SA-D1-7 is already met (live checks recorded above). Manual QA Q1 to Q14 is still owed by QA; Q14 is the F-24 observation and is recorded, not fixed.

**Reviewed (uncommitted, base `70b609f2`):** full diffs of `lib/scheduling/businessTime.ts`, `lib/repositories/UserPreferencesRepository.ts`, `lib/repositories/UserProfileRepository.ts`, `app/api/business-os/preferences/route.ts` (read in full, incl. GET and the outer `catch`), `app/business-os/settings/page.tsx`, `app/api/business-os/preferences/__tests__/route.test.ts`, and the four new test files. Cross-checked `findLocale`, `BusinessProfileRepository.findLanguage`, `normalizeLanguage`, `safeDbError`.

### Checklist against the brief and the skills

| Check | Result |
|---|---|
| User id from the session only (C-23, `tenant-isolation-guard`) | ✅ Every repository call takes `user.id` from `getUser()`. Nothing is read from the body |
| Strict schemas reject `user_id` / `id` / `userId`, `{ timezone, language }`, `{ timezone, currency }` | ✅ Each union member is `.strict()`; R-5 and R-6 pin all five, with `noWrites()` covering both new writers |
| Never a default; no trim | ✅ `timezoneValue` has no `.trim()`, `.default()`, `.nullable()`, `.optional()`; the repository writes `zone` as given (P-9); route tests reject `''`, `'   '`, `' UTC'`, `'UTC '` |
| `isValidTimezone` safe on any input (Zod runs `.refine` after a failed `.max()`/`.regex()`) | ✅ Type, empty, >64 and shape checks before `Intl`; `try/catch`; spy test proves `Intl` is not reached at 65 chars; "never throws" test covers symbols and functions |
| Leading-letter regex (SA-D1-1, amended C-14) | ✅ `+05`, `+0500`, `+05:00` refused in helper and route; `UTC`, `Etc/UTC`, `utc`, `EST` accepted and stored verbatim |
| NULL vs `'UTC'` on GET and on load | ✅ GET unchanged (`timezone ?? null`, raw). `loadData` maps a non-string or missing locale to `''` (placeholder), never `'UTC'`; a string is taken raw. Same behaviour as the old browser select |
| Write order and failure handling | ✅ Language lookup → authority → mirror → read-back (R-1 asserts invocation order). Authority failure returns before mirror, read-back and audit (R-9) |
| Read-back proof, strict | ✅ `stored !== timezone`, no trim; read error, `null`, mismatch, whitespace-only difference all 500 with no audit (R-11, R-11b, R-12, R-13) |
| Same `confirmedAt` stamp | ✅ One `new Date().toISOString()` in the route, passed to `saveConfirmedTimezone` (both columns) and `updateTimezoneMirror` (R-1, P-1) |
| `{ count: 'exact' }`, no `.select()` on any UPDATE (PostgREST 42703 hazard) | ✅ Both repositories; the "never upserts and never selects, on any path" test also asserts the option on every update |
| `null` count fails closed | ✅ `COUNT_UNAVAILABLE` thrown → error, no insert (P-8). `count > 1` succeeds and warns (P-10) |
| Duplicate-key retry exactly once | ✅ `23505` → one `updateExisting()`; count 0 after it is `NO_ROW_AFTER_RETRY` (P-4, P-5); other insert errors are not retried (P-7). L-1a confirmed the unique index on `user_id` |
| `user_id` last in the insert row | ✅ Asserted by key order in P-2 |
| Mirror update-only, best-effort | ✅ `update … .eq('id', userId)`, no insert/upsert; count 0 is info, not error (U-2); the route logs and continues on a mirror error (R-10) |
| `findTimezone` (F-13) untouched | ✅ The diff touches only the header text above the F-13 paragraph; the paragraph and the method are unchanged |
| No stored value in logs | ✅ Read-back failure logs `readFailed` and `storedLength` only; R-11 asserts the stored text appears in no log call. Repository errors go through `safeDbError` (P-6 asserts `details` never reach a log) |
| Audit non-blocking, no flush (Q-5) | ✅ `.catch(…)`, not awaited; R-14 |
| Error details dev-only | ✅ Timezone 500s carry a fixed message only; the outer `catch` keeps the `NODE_ENV === 'development'` guard. The 400 `details: error.flatten()` is the pre-existing F-12 behaviour (messages only, no input values) |
| No `console.*`; Pino conventions | ✅ 0 in all touched files; `requestLogger` (correlationId child) in the route, `methodLogger` + `{ dbError }` / `{ err }` in the repositories |
| CLAUDE.md rule 1 / rule 4 | ✅ The page's timezone path has no browser Supabase call (source guard with three negative controls); both new queries are scoped by the user's id; service-role use documented in both headers |
| Currency & Timezone rules | ✅ `user_preferences.timezone` is the authority; `business_profiles.timezone` is never named; nothing reads `LanguageContext` values for the write |
| Page scope (SA-D1-6, C-13) | ✅ Two hunks only: `loadData` (the `Promise.allSettled` destructuring, the timezone fetch, the `timezone:` line) and `persistTimezone` (body plus one doc paragraph). The profile query line and the three `profileRes.data?.…` lines are byte-identical; the frozen Language/Currency/Timezone rows, `saveProfile`, `handleExportData` and `timezoneOptions` are not in the diff. `persistTimezone` keeps its signature and "zone or null, never throws" contract, and sends no language (C-16) |
| Entitlements import | None |
| Edge runtime | No `runtime` export; Node APIs not used in client code |

### Findings

| # | File | Finding | Severity |
|---|---|---|---|
| CR-1 | `lib/repositories/UserProfileRepository.ts` `updateTimezoneMirror` | Logs and returns the raw PostgREST error (`{ err: error }`), where `UserPreferencesRepository` uses `safeDbError`. It follows this file's existing convention (every other method does the same) and the route does not log the returned error, so no new exposure in practice: the mirror sends only `timezone` and `updated_at`, so a "Failing row contains …" detail is very unlikely. Optimisation, not a condition; if this file is touched again (D-2), move it to `safeDbError` as a whole | Low |
| CR-2 | `lib/repositories/UserPreferencesRepository.ts` `saveConfirmedTimezone` doc | "One `confirmedAt` stamp is used for both `timezone_confirmed_at` and `updated_at`" is true of the payload; on the UPDATE path the L-3 trigger overwrites `updated_at`. Harmless (nothing compares the two). See the Q-3 ruling | Info |
| CR-3 | `app/business-os/settings/page.tsx` `loadData` | A rejected profile read now still sets the timezone with blank name fields, where before the whole `setProfile` was skipped. That is exactly the independence C-13 asked for, and supabase-js returns `{ error }` rather than rejecting, so it is practically unreachable. Accepted | Info |

No High or Medium findings.

### Rulings on the Dev questions

| # | Ruling |
|---|---|
| Q-1 | **Accepted.** Exporting `TIMEZONE_SHAPE` and `MAX_TIMEZONE_LENGTH` from `businessTime.ts` is the right home: SA-D1-1 requires the helper itself to refuse `+05`/`+0500`, so the helper needs the shape, and one constant shared by the helper and the route prevents drift (M-18 killed on both sides). They are pure constants in a pure module, safe for client and server import. Not a new pattern |
| Q-2 | **Within SA-D1-6.** The `allSettled` destructuring and the rejection log line are the minimum change needed to make the halves independent, which SA-D1-6 required. The profile query and its three consumers are byte-identical, which is what "unchanged" meant |
| Q-3 | **Record only; no comment is required.** The L-3 row in [Live checks](#live-checks-sa-d1-7-2026-10-15) is the record. Optional (not a condition): add half a sentence to the `saveConfirmedTimezone` doc ("on the UPDATE path the `update_user_preferences_updated_at` trigger restamps `updated_at`") if Dev is in the file anyway for another reason. No re-review is needed for that wording |

### Verification (re-run by SA)

D-1 suites plus the must-stay-green set: route test, both new repository tests, `UserPreferencesRepository.test.ts`, `findTimezone` test, `packageAcceptance`, `isValidTimezone` and all `lib/scheduling/__tests__/*`, `timezoneWrite.guard`, `settingsDeepLinks.guard`, `accountCard.guard`, `mockedRepositoryMethods.guard` (G-1), `journeyReadiness`, `readInitialLanguage`, `userLanguage`, `no-deletion-paths.guard`, `greetingUsesTheEditedName.guard`, `darkModeTokens.guard`, `planBadge`, all `components/business-os/settings/__tests__/*`, `businessClock.guard`, `app/api/user/profile` route test: **44 suites, 856 tests, all pass.** `grep` for `console.*` and a `runtime` export in the five touched source files: none.

### Optimisation suggestions

- CR-1, when `UserProfileRepository` is next touched.
- Carried from the workplan review: once D-2..D-4 and the four known direct writers have moved, the browser write policies on `user_preferences` can be tightened. Not in this feature.

### Code Approved for QA: Yes

---

## QA Testing Report

See [QA Report (2026-10-15)](#qa-report-2026-10-15) below.

---

## QA Report (2026-10-15)

**QA — 2026-10-15**
**Test mode:** full (code-level); manual browser checks NOT RUN (no browser or test account in this session)
**Strategy used:** A + B (Jest unit and route integration with mocked repositories), source-level guards, plus 23 new QA mutations (N-1..N-19, scratchpad runner). D (manual browser) not run.
**Focus:** api, security, schema, ui (source level)
**Skipped:** manual Q1–Q14 (no browser or account), production queries (not allowed), `tsc` / eslint re-run (Dev's results stand; SA reviewed in parallel)
**Input source:** TL prompt + this workplan's Test Plan and SA conditions
**Verdict:** **PASS WITH NOTES.** No bugs. Three test gaps and one equivalent mutation, recorded as edge cases (none is a defect in the code as written). Manual Q1–Q14 owed by a human before merge.

**Worktree integrity:** SHA-1 of all 7 modified tracked files and the 4 new test files identical before and after the mutation run; `git diff --numstat` unchanged across the run (7 tracked files, +626/−57). The brief's baseline said +625: the extra line is in `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` (+10/−1), not D-1 code, and was there before QA started. This workplan changed during the run only through SA's concurrent code-review section; QA changed only this section and its Change History row.

### Test runs

| Run | Suites | Tests | Result |
|---|---|---|---|
| D-1 suites + the Test Plan's must-stay-green list (same set SA re-ran) | 44 | 856 | ✅ all pass |
| Broader set: every test that names `UserPreferencesRepository`, `UserProfileRepository`, `businessTime`, `business-os/preferences`, `journeyGapFix`, `LanguageContext` or the settings page, plus the list above and `app/api/business-os/my-day` | 109 | 2867 | ✅ all pass |
| Post-mutation re-run (D-1 suites + settings guards + greeting guard) | 8 | 161 | ✅ all pass |

Dev reported 49 / 1023 for a differently drawn set; QA's two sets cover the Test Plan list and every test that names a touched module. No failures in either.

### Mutations (QA, beyond Dev's M-1..M-19)

Runner: scratchpad backup per mutation, anchor must match exactly once, 7 suites run (route, saveConfirmedTimezone, updateTimezoneMirror, isValidTimezone, timezoneWrite guard, settingsDeepLinks guard, greeting guard), restore in `finally`, SHA-1 verified. **19 of 23 killed; 4 survived (1 equivalent, 3 test gaps).** All restored.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| N-1 | Route passes `body.user_id ?? user.id` to `saveConfirmedTimezone` (strict member kept) | Survived, **equivalent** | Unreachable: `.strict()` rejects any body carrying `user_id` before the branch runs. See N-1b |
| N-1b | Same, **and** the timezone member loses `.strict()` | Killed | R-5 (×3), R-6 (×2) |
| N-2 | `.eq('user_id')` dropped from the authority UPDATE | Killed | P-1 |
| N-3 | Insert branch becomes `upsert(row, { onConflict: 'user_id' })` | Killed | P-2, P-3, P-4, P-5, P-7, P-9 |
| N-4 | `23505` on insert treated as success, no retry UPDATE | Killed | P-4, P-5 |
| N-5 | Read-back compares lowercased values | **Survived** | Gap: no case-only mismatch test (EC-1) |
| N-5b | Read-back compares trimmed + lowercased | Killed | R-11b |
| N-6 | Mirror gets its own stamp, not `confirmedAt` | Killed | R-1 |
| N-7 | Mirror repository throws instead of returning the error | Killed | U-3 |
| N-8 | Mirror inserts a `profiles` row when count is 0 | Killed | U-2 |
| N-9 | Audit awaited without `.catch` (its failure fails the request) | Killed | R-14 |
| N-10 | GET coerces a null timezone to `'UTC'` | Killed | GET "returns nulls, not defaults" |
| N-11 | Page sends `{ timezone, preferredLang: language }` | Killed | timezoneWrite guard |
| N-11b | Page sends `user_id` beside the timezone | Killed | timezoneWrite guard |
| N-12 | Page `loadData` maps a null stored timezone to `'UTC'` instead of `''` | **Survived** | Gap: guard does not pin the null fallback (EC-2) |
| N-13 | Outer `catch` returns `details` outside development (both handlers) | **Survived** | Gap, pre-existing code: no test drives the thrown-error path (EC-3) |
| N-13b | Timezone save-failure 500 carries `details: saved.error.message` | Killed | R-9 (no leak) |
| N-14 | `isValidTimezone` throws a `RangeError` on >64 chars | Killed | helper ">64 without Intl", helper "never throws", R-4 (65 chars) |
| N-15 | `.eq('id')` dropped from the `profiles` mirror | Killed | U-1 |
| N-16 | Page returns the zone on any 2xx without checking `data.timezone === zone` | Killed | timezoneWrite guard |
| N-17 | `count > 1` on the first UPDATE treated as failure | Killed | P-10 |
| N-18 | `.refine(isValidTimezone)` replaced by `() => true` | Killed | R-4 (`Foo/Bar`, `Mars/Olympus`) |
| N-19 | PATCH auth check removed (falls through with a placeholder user) | Killed | existing 401 test, R-3 |

### Code-level paths

| Path | Result | Evidence |
|---|---|---|
| Happy path: valid zone → `user_preferences` then `profiles` mirror, same stamp, strict read-back, 200, audited | ✅ Pass | R-1 (call order, one stamp to both), R-2 (`UTC`, `Etc/UTC`, `utc`, `EST`, `Etc/GMT+5`, `America/Argentina/Buenos_Aires` stored verbatim), P-1; N-6 killed |
| Auth failure: 401, nothing read or written, no audit | ✅ Pass | R-3, existing 401 test; N-19 killed |
| Invalid inputs → 400, no writes: `''`, `'   '`, `' UTC'`, `'UTC '`, 65 chars, `+05`, `+0500`, `+05:00`, `Foo/Bar`, `Mars/Olympus`, `null`, `42`, `;drop` | ✅ Pass | R-4 (13 cases; `noWrites()` covers both new writers) |
| Extra fields: `user_id`, `id`, `userId`, `language`, `currency` beside a valid zone → 400 | ✅ Pass | R-5, R-6; N-1b killed |
| User id only from the session | ✅ Pass | R-1 asserts `SESSION_USER.id` on every call; N-1 shown unreachable through `.strict()` |
| First-time user: no row → insert with the server-resolved language, `user_id` last; no language → no key, warned | ✅ Pass | P-2, P-3, R-7, R-8; N-3 killed |
| `23505` race → one retry UPDATE, no third write | ✅ Pass | P-4, P-5; N-4 killed |
| Read-back mismatch / error / null / whitespace → 500, no audit, stored text never logged | ✅ Pass | R-11, R-11b, R-12, R-13; N-5b killed (case-only mismatch untested: EC-1) |
| Mirror failure best-effort; mirror never creates a row | ✅ Pass | R-10, U-2, U-3; N-7, N-8 killed |
| Audit non-blocking | ✅ Pass | R-14; N-9 killed |
| NULL ("not asked") stays NULL on load | ✅ Pass (code); ⚠️ page half not test-pinned | GET returns `null` raw (N-10 killed); the page maps `null` to `''` by reading (`typeof locale.timezone === 'string' ? … : ''`), but no test fails if that becomes `'UTC'` (EC-2) |
| No production `details` leak on the new 500s | ✅ Pass | R-9, R-12; N-13b killed. Outer-catch guard unchanged by D-1 and untested (EC-3) |
| Publish gate / `journeyReadiness` and the "Set your timezone" deep link | ✅ Pass (unaffected) | `journeyReadiness.ts`, `journeyGapFix.ts`, `my-day/route.ts` not in the diff; `journeyReadiness.test.ts`, `settingsDeepLinks.guard.test.ts` green. D-1 writes the same pair (`timezone`, `timezone_confirmed_at`) the gate reads |
| `LanguageContext` language / currency PATCHes | ✅ Pass | Existing language/currency happy, 409 `CURRENCY_LOCKED`, 500 and invalid-input cases green; `LanguageContext*` suites green; `LanguageContext.tsx` not in the diff |
| `page.tsx` changed only in `loadData`'s timezone half and `persistTimezone` (SA-D1-6) | ✅ Pass | `git diff -U0` hunks all fall between lines 253 and 350 (`loadData` and `persistTimezone`) |

### Manual QA (Q1–Q14): NOT RUN

No browser, no test account and no session cookie in this session. A human must run these on a test account before merge:

| # | What the human must check |
|---|---|
| Q1 | Pick `Asia/Jerusalem`: "Saved" banner; reload shows `Jerusalem — Asia/Jerusalem` |
| Q2 | Pick `UTC`: saved; reload shows UTC as a choice, not the placeholder |
| Q3 | Network tab on a pick: one `PATCH /api/business-os/preferences`, body exactly `{"timezone":"…"}`; no `…/rest/v1/user_preferences`; the `profiles` upsert from `saveProfile` still present |
| Q4 | Page load: two `GET /api/business-os/preferences` (LanguageContext + page), no `user_preferences` REST call |
| Q5 | Publish gate on an account with no confirmed zone → "Set your timezone" lands on `?section=timezone`, scrolled to the row; picking a zone clears the gate |
| Q6 | Hebrew: Q1 + Q5, banner and row text in Hebrew |
| Q7 | Hebrew account: pick a zone, reload; UI still Hebrew; PATCH body has no language |
| Q8 | DevTools offline → pick: red error banner, nothing saved |
| Q9 | Signed-out PATCH `{"timezone":"UTC"}` → 401 (record how the request was made) |
| Q10 | Signed-in `{"timezone":"UTC","user_id":"<other>"}` → 400, nothing written |
| Q11 | Signed-in `{"timezone":"Foo/Bar"}` and `{"timezone":""}` → 400 |
| Q12 | Language and Currency pickers unchanged, including `CURRENCY_LOCKED` |
| Q13 | My Day timezone nudge gone after Q1 |
| Q14 | Account with a stored zone: edit the name on the profile card, Save → "Saved", and the network tab shows a `PATCH` carrying the stored zone. That is **F-24, recorded, not fixed** (D-2 owns it) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The extra settings-page GET (RK-7, Q-8) is accepted by SA.

#### Edge Cases (nice to fix; test gaps, not defects)
1. **EC-1 Read-back case sensitivity not pinned** — `app/api/business-os/preferences/__tests__/route.test.ts` — Low. N-5 (compare lowercased) survives. Add an R-11c: write `'Asia/Jerusalem'`, `findLocale` returns `'asia/jerusalem'`, expect 500.
2. **EC-2 Page null fallback not pinned** — `app/business-os/settings/__tests__/timezoneWrite.guard.test.ts` — Low/Medium (it is the "NULL is not UTC" rule on the one page that asks). N-12 (`: ''` → `: 'UTC'`) survives. Add a guard assertion that `loadData` contains no `'UTC'` literal, or that the non-string fallback is `''`.
3. **EC-3 Outer-catch `details` guard untested** — `app/api/business-os/preferences/route.ts` — Low, pre-existing (D-1 does not change the catch). N-13 survives. A test that makes a repository mock throw and asserts `details` is undefined outside development would pin it for all three branches.
4. **N-1 is equivalent, by design** — the session-only user id rests on `.strict()` (R-5 kills its removal). Recorded so a future relaxation of `.strict()` is understood to reopen it.

### Final Status
- [x] All code-level acceptance criteria pass; no bugs; QA mutations 19/23 killed (1 equivalent, 3 test gaps above)
- [ ] Manual Q1–Q14 NOT RUN — a human must run them on a test account before merge (Q14 records F-24, not a D-1 failure)

### QA gap closure (2026-10-15)

**Dev, test files only.** No source file changed: SHA-1 of `route.ts`, `page.tsx`, both repositories and `businessTime.ts` identical before and after, and `git diff --numstat` on them unchanged.

| Gap | Test added | Mutation | Result |
|---|---|---|---|
| EC-1 | `route.test.ts` R-11c: writes `'Asia/Jerusalem'`, read-back `'asia/jerusalem'` → 500, no audit, `storedLength` logged | N-5 (lowercased compare) | ✅ Killed by R-11c |
| EC-2 | `timezoneWrite.guard.test.ts`: `nullFallbackProblems(loadData)` on comment-stripped source — no `'UTC'` literal, `''` for a non-string timezone, a missing locale half and a rejected read; two negative controls | N-12 (`: ''` → `: 'UTC'`) | ✅ Killed by the EC-2 guard |
| EC-3 | `route.test.ts` "unexpected errors": a thrown repository error in GET and each PATCH branch (timezone, language, currency) → 500 with no `details` under `production` and `test`; positive control returns `details` under `development` | N-13 (guard → `true`, both handlers) | ✅ Killed by all 4 "outside development" cases |

QA mutations now 22 of 23 killed (N-1 equivalent). Re-run: D-1 + must-stay-green set **44 suites / 868 tests** (856 + 12 new), all pass; eslint 0 on both test files; `tsc` 0 errors in them. Manual Q1–Q14 still owed.

---

### Live manual QA by TL (2026-10-15)

Run by TL at the user's request, in the in-app browser against a dev server on this worktree (port 3005), signed in as the walla **test** account; database state read back read-only from production (`jgccgkyhpwirgknnceoh`). The test account was left on `Asia/Jerusalem`, as found.

| # | Result | Evidence |
|---|---|---|
| Q1 | ✅ PASS | Picked `Asia/Jerusalem`: one `PATCH /api/business-os/preferences` 200; DB `user_preferences.timezone` and `profiles.timezone` both `Asia/Jerusalem`, `timezone_confirmed_at` restamped |
| Q2 | ✅ PASS | Picked `UTC`: both tables `UTC`, confirmed; reload shows `UTC` |
| Q3 | ✅ PASS (partial) | The pick sends one PATCH to our route; no `supabase.co/rest` request at all. Request body not inspectable in the pane; covered by the page guard test |
| Q4 | ✅ PASS | Page load: `GET /api/business-os/preferences` only (4 = 2 callers x dev StrictMode); no `user_preferences` REST call |
| Q7 | ✅ PASS | `preferred_language` stayed `en` across both picks |
| Q9 | ✅ PASS | Signed-out PATCH `{timezone:"UTC"}` → 401 |
| Q10 | ✅ PASS | `{timezone:"UTC", user_id:<other>}` → 400; no row for the other id; test account unchanged (stamp unchanged) |
| Q11 | ✅ PASS | `Foo/Bar`, `""`, `+05`, and `{timezone, language}` → 400 each; nothing written |
| Q12 | ✅ PASS | `{language:"en"}` and `{currency:"USD"}` (current values, no change) → 200; GET returns `locale.timezone` raw |
| Q5, Q6, Q8, Q13, Q14 | ⬜ NOT RUN | Q5/Q13 need an account with no confirmed timezone; Q6 would switch the account to Hebrew; Q8 offline; Q14 = F-24 (D-2). Covered by unit/route tests where possible |

Note: the "saved" message after a pick is shown for 3 s by `saveProfile`, which D-1 does not change; it was not captured in time by the tooling.

## Commit Info

*RM to populate. Not committed: the user reviews the diff first; the user merges.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | Dev workplan for D-1, verified against `page.tsx` at `b848e267` on `70b609f2`. Route contract, repository methods, `isValidTimezone`, page change, tests, mutations M-1 to M-16, manual QA Q1 to Q13, risks, rollback, live checks L-1 to L-3 for the user, questions Q-1 to Q-8. Awaiting SA workplan review |
| 2026-10-15 | SA workplan review | APPROVED WITH CONDITIONS (SA-D1-1 to SA-D1-9). Q-1 leading-letter regex approved (amends C-14), aliases and lowercase kept verbatim, no canonicalisation; Q-2 `confirmedAt` in the options bag; Q-3 fail closed; Q-4 route warns only on a lookup failure; Q-5 no flush confirmed; Q-6 eager; Q-7 intended; Q-8 accepted (GET is raw and null-preserving). Found: the existing route test pins `{ timezone: 'UTC' }` as a 400 (must change); the profile card's Save re-sends the stored zone, so live check L-4 added; L-1 revised to read unique indexes and duplicate rows; new finding F-24 (card Save confirms the timezone on the owner's behalf; fix in D-2). Merge gated on the user's live checks |
| 2026-10-15 | Live checks recorded | L-1a, L-1b, L-2, L-3, L-4 all PASS (run read-only by TL at the user's request). Merge gate SA-D1-7 met. The L-3 trigger resets `updated_at` on UPDATE (harmless) |
| 2026-10-15 | Implemented (Dev) | All tasks done per SA-D1-1..SA-D1-9; not committed. `TIMEZONE_SHAPE` is shared by the route and `isValidTimezone`. Tests green; full `tsc` 1852 → 1852 (0 in touched files); `typecheck:bos-llm` 0 new; eslint 0 errors; `lint:hooks` clean; mutations 19/19 killed. Three questions for SA code review |
| 2026-10-15 | SA code review | APPROVED, no conditions; code approved for QA. No High/Medium findings: CR-1 (Low, mirror logs the raw PostgREST error per the file's convention; optimisation), CR-2 and CR-3 (Info). Q-1 shared constants accepted; Q-2 within SA-D1-6; Q-3 record only (optional doc half-sentence). SA re-ran D-1 and must-stay-green suites: 44 suites / 856 tests pass |
| 2026-10-15 | QA report | PASS WITH NOTES. 44 suites / 856 tests (Test Plan set) and 109 / 2867 (every test naming a touched module), all green. 23 QA mutations N-1..N-19: 19 killed, 1 equivalent (N-1, behind `.strict()`), 3 test gaps (EC-1 case-only read-back, EC-2 page null→'' fallback, EC-3 outer-catch `details`, pre-existing). No bugs. Manual Q1–Q14 NOT RUN (no browser or account) |
| 2026-10-15 | QA gap closure (Dev) | Test files only. EC-1 R-11c (case-only read-back), EC-2 guard (`loadData` null → `''`, never `'UTC'`, with negative controls), EC-3 outer-catch `details` only in development (GET + 3 PATCH branches, positive control). N-5, N-12, N-13 now killed (QA 22/23, N-1 equivalent). 44 suites / 868 tests pass; source SHA-1s unchanged |
| 2026-10-15 | Live manual QA (TL) | Q1, Q2, Q3 (partial), Q4, Q7, Q9, Q10, Q11, Q12 PASS on the walla test account via a dev server on this worktree; Q5, Q6, Q8, Q13, Q14 not run. |
