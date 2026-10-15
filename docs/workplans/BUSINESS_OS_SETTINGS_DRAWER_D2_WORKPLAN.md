# Workplan: Business OS Settings Drawer, D-2 (Profile card behind `/api/business-os/account-profile`, plus F-24)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.2, §7 F-24, §9.1 (P-1, P-6), §9.2, §9.3 D-2, SA Review of §9 ruling 3 and ruling 9, conditions C-13 (narrowed C-9 lift), C-17, C-18, C-23, C-24; D-1 SA code review finding CR-1 ([D-1 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D1_WORKPLAN.md#sa-code-review-2026-10-15))
**Branch:** `feature/settings-drawer-d2-account-profile`, created by RM from `feature/settings-drawer-d1-timezone` at `06ceab3b` (PR #421, open with auto-merge). D-2 depends on D-1's `persistTimezone` and `UserProfileRepository.updateTimezoneMirror`. Once #421 lands, `origin/main` is **merged** in (not rebased), so the review diff shows D-2 only.
**Path:** Full cycle (new route, personal data, a fix to a publish-gate write): workplan → SA workplan review → Dev → SA code review + QA → user sees the diff → RM. The user merges.
**Date:** 2026-10-15
**Status:** Code Complete (2026-10-15), **not committed**. SA workplan review 2026-10-15: **APPROVED WITH CONDITIONS** (SA-D2-1 to SA-D2-11, [SA Workplan Review](#sa-workplan-review-2026-10-15)), all applied. Live checks L-1 to L-5 run read-only by TL 2026-10-15, all PASS. Built on `origin/main` `8c94767b` (D-1 #421 merged). Next: SA code review + QA, then the user sees the diff. See [Implementation Notes](#implementation-notes).

## Overview

The settings page reads the profile card (`full_name`, `avatar_url`, `job_title`) from the browser with `supabase.from('profiles').select(…).single()` (P-1), and the card's Save upserts `profiles` from the browser with `full_name`, `avatar_url`, `job_title` and `updated_at` (P-6). Both break CLAUDE.md rule 1. D-2 moves them behind a new Business OS route, `GET` and `PATCH /api/business-os/account-profile`, with two new `UserProfileRepository` methods (`findSettingsCard`, `saveSettingsCard`). The PATCH accepts `{ full_name?, job_title? }` only, so `role`, `avatar_url`, the id and the timezone cannot be written through it.

D-2 also fixes **F-24**. Today the card's Save calls `persistTimezone(profile.timezone)` whenever a zone was loaded. That stamps `timezone_confirmed_at`, so an owner who only edits their name "answers" the timezone question with whatever is stored (the legacy `'UTC'` default or the IP-guessed onboarding zone). After D-2 a name save never sends the timezone and never reaches the preferences route. The timezone row still saves the zone through `persistTimezone`, exactly as D-1 built it.

The avatar is not D-2's. D-3 owns `avatar_url` (C-19). The avatar hook keeps writing `profiles.avatar_url` itself at pick time (F-6). D-2 only stops the Save from writing it a second time.

**Code verified against:** `app/business-os/settings/page.tsx` at `e0c49f1f` (D-1, the last commit touching the file; blob `3fe34a86`), worktree HEAD `06ceab3b`. `lib/repositories/UserProfileRepository.ts` at `e0c49f1f`. Locations below are by symbol and anchor, not line (C-13).

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Schema Verification and Live Checks](#schema-verification-and-live-checks)
3. [Route Contract](#route-contract)
4. [Repository Methods and CR-1](#repository-methods-and-cr-1)
5. [Page Change and the F-24 Fix](#page-change-and-the-f-24-fix)
6. [Files to Create / Modify](#files-to-create--modify)
7. [Task List](#task-list)
8. [Test Plan](#test-plan)
9. [Mutation Candidates](#mutation-candidates)
10. [Manual QA Checklist](#manual-qa-checklist)
11. [Risks](#risks)
12. [Rollback](#rollback)
13. [Questions for SA](#questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
    - [SA Workplan Review (2026-10-15)](#sa-workplan-review-2026-10-15)
15. [Implementation Notes](#implementation-notes)
16. [QA Report (2026-10-15)](#qa-report-2026-10-15)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## Analysis Summary

| Area | What D-2 touches |
|---|---|
| Page | `app/business-os/settings/page.tsx`: the **profile half** of `loadData` (P-1), and `saveProfile` (P-6 plus the F-24 timezone split). `persistTimezone` is **not** changed (D-1's body, signature and "zone or null" contract stay) |
| New route | `app/api/business-os/account-profile/route.ts` (`GET`, `PATCH`), built to the `new-api-route` skill's final checklist |
| Repository | `lib/repositories/UserProfileRepository.ts`: new `findSettingsCard`, new `saveSettingsCard`, header rewritten (the file gains a second write). **CR-1:** every method's error logging and return switch to `safeDbError` (see [Q-3](#questions-for-sa)). `updateTimezoneMirror` stays, behaviour unchanged |
| Table | `profiles`: read `full_name, avatar_url, job_title`; write `full_name`, `job_title`, `updated_at`, `id` (upsert on `id`). **Never** `role`, `avatar_url`, `timezone`, `company`, `org_id` |
| Not touched | `user_preferences` (D-2 sends nothing there from the card's Save, which is the F-24 fix); `business_profiles` |
| Consumers of what D-2 writes (read, unchanged) | `app/api/business-os/my-day/route.ts` greeting (`userProfileRepository.findById(user.id)` → `full_name`, trimmed, first word); `lib/user-context/builders.ts` (`findById`); `app/admin/adminDisplayName.ts`; admin users list and audit-trail names; the GDPR export (`findForUserDataExport`) |
| Frozen (C-13) | The Language, Currency and Timezone **rows** byte for byte, including the timezone option's `onClick` that calls `saveProfile({ timezone: tz.value })`, the `id="settings-section-timezone"` anchor and the three guarded option rows; `persistTimezone`; `handleExportData`; the profile card markup (the `<input>`, both `<AvatarUpload>` usages, Cancel and Save buttons); `useAvatarUpload.ts` and `AvatarUpload.tsx` (D-3); `ProfileTab.tsx` / `ProfileTabV2.tsx`; `CRMContactDrawerV2.tsx`; `LanguageContext.tsx`. The `supabase` import in `page.tsx` stays for D-4 (see [Q-4](#questions-for-sa)) |
| Existing profile routes | `/api/user/profile` (F-9) and `/api/business-os/profile` (F-10, reads `business_profiles`) are **not** reused or changed, as SA ruled |

**Call inventory removed by D-2:** P-1 (`loadData` `profiles` select) and P-6 (`saveProfile` `profiles` upsert). After D-2 `page.tsx` contains no `.from(` and no `supabase.` call; only the `supabase` import is left (D-4 removes it and adds the guard, C-22). The avatar hook's A-1 to A-7 stay for D-3.

**Logging:** `page.tsx`, `UserProfileRepository.ts` and the preferences route have 0 `console.*` (grep on `06ceab3b`). The new route uses `createLogger({ module: 'BusinessOsAccountProfileAPI' })` and `logger.child({ correlationId })`; the repository keeps `createLogger({ service: 'UserProfileRepository' })`. **No name or job-title value is ever logged or audited**, only field names and the user id the page already logs.

**F-1 note.** The card has no job-title field (F-1, pre-existing, out of scope). The page can only change `full_name`. The route still accepts `job_title`, as ruling 3 says, so a later job-title field needs no server change.

---

## Schema Verification and Live Checks

Per the `business-os-schema-check` skill, against the repo on `06ceab3b`. **I did not query production.** `profiles` has **no DDL in the repo** (dashboard-created, as `20261002_profiles_role_privilege_guard.sql` records), so most facts are evidence from live code paths.

| Column / object | Evidence in repo | Confidence | Live check? |
|---|---|---|---|
| `profiles.full_name`, `avatar_url`, `job_title` | Selected by the page today (P-1) and written by its upsert (P-6); `full_name` also by `findById`, admin reads and the export | High | **L-1** (lengths), **L-2** (types, any `varchar(n)` limit) |
| `profiles.id` is the auth user id with a unique key | Today's `upsert(…, { onConflict: 'id' })` succeeds, which PostgREST rejects (42P10) without one; the repository header says one row per user | High (implied) | L-5 (confirm) |
| `profiles.updated_at` and its BEFORE UPDATE trigger `update_profiles_updated_at` | Named in `20261002`; written by the page today | High | L-4 |
| `profiles_role_privilege_guard` (BEFORE INSERT/UPDATE) | `20261002`: `service_role` is an exempt caller, and D-2 never sends `role` | High | L-4 |
| NOT NULL columns without a default (matters only on the insert path, for an account with no row) | Unknown | Unknown | **L-2** |
| Accounts with no `profiles` row | The signup trigger creates one (repository header); `findById` documents the no-row case as possible | Medium | **L-3** |

`npm run schema:check` replays `.select()` calls. D-2 adds one select (`full_name, avatar_url, job_title` on `profiles`), the same column list the page reads today. It was not run (it queries the live database). It does not cover the upsert payload (skill blind spot), which is why L-2 exists.

**Live checks for the user (read-only, any SQL editor, before merge).** Every query is a plain `select`. None changes data.

```sql
-- L-1: longest stored values, measured after trimming (the route trims).
-- octet_length is an upper bound on the JavaScript length that Zod measures.
select
  count(*) as profile_rows,
  max(char_length(btrim(full_name)))  as max_full_name_chars,
  max(octet_length(btrim(full_name))) as max_full_name_bytes,
  max(char_length(btrim(job_title)))  as max_job_title_chars,
  max(octet_length(btrim(job_title))) as max_job_title_bytes,
  count(*) filter (where char_length(btrim(full_name)) > 120) as names_over_120_chars,
  count(*) filter (where char_length(btrim(job_title)) > 100) as titles_over_100_chars
from public.profiles;

-- L-2: every profiles column, its type, any length limit, nullability and default
select column_name, data_type, character_maximum_length, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- L-3: accounts that have no profiles row (the PATCH creates one for them)
select count(*) as accounts_without_profile_row
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- L-4: triggers on profiles
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- L-5: keys and CHECK constraints on profiles
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass;
```

**What each result means and the stop rules:**

| Check | Expected | If not |
|---|---|---|
| L-1 | `max_full_name_chars` ≤ 120 and `max_job_title_chars` ≤ 100 (both counts 0) | The limit is raised to at least the live maximum, rounded up to the next 10, so no existing value is refused (C-18). If `max_*_bytes` is above the limit while `max_*_chars` is not, the value has non-ASCII text, which is fine: Zod counts UTF-16 units, and only characters outside the Basic Multilingual Plane (emoji) count twice. Dev re-checks with the exact value if bytes exceed limit × 2 |
| L-2 | `full_name`, `job_title` are `text` (no `character_maximum_length`); no NOT NULL column without a default other than `id` | A `varchar(n)` smaller than the Zod limit: the limit is lowered to `n` (the database would refuse longer anyway, with a 500). A NOT NULL column without a default: the insert path fails for an account with no row (L-3), recorded as a risk and sent to SA |
| L-3 | 0 | Rows: those accounts get a row created on their first name save (today's behaviour, kept). See RK-2 for the avatar edge |
| L-4 | `profiles_role_privilege_guard` and `update_profiles_updated_at` only (the `auto_set_profile_org_id` trigger is on `organizations`, so it does not appear) | Any trigger that writes another table or acts on `full_name` / `job_title`: stop, back to SA |
| L-5 | A primary key on `(id)`; possibly a foreign key to `auth.users`; no CHECK on `full_name` / `job_title` length | A CHECK limit: the Zod limit must be at or below it |

---

## Route Contract

**File:** `app/api/business-os/account-profile/route.ts`. Header comment explains: what the route is for (the settings profile card), why it is not `/api/user/profile` (F-9) or `/api/business-os/profile` (F-10, `business_profiles`), that `avatar_url` is read-only here (D-3 owns its write), that `role` is never writable (CLAUDE.md Security Rules), and that the timezone is never touched (F-24).

### Auth and identity (C-23)

The user id comes from `getUser()` only. Neither handler reads a query string. The PATCH schema is `.strict()`, so a body with `user_id`, `id` or `userId` is a 400 before any repository call. Both repository calls receive `user.id`.

### `GET /api/business-os/account-profile`

| Case | Status | Body |
|---|---|---|
| Signed out | 401 | `{ success: false, error: 'Unauthorized' }` |
| Row found | 200 | `{ success: true, data: { full_name, avatar_url, job_title } }`, each a string; a `null` column becomes `''` |
| No row | 200 | `{ success: true, data: { full_name: '', avatar_url: '', job_title: '' } }` (not 404, C-17) |
| Repository error | 500 | `{ success: false, error: 'Failed to load the profile' }`; logged with `{ userId, err }` (already reduced by `safeDbError`) |
| Unexpected throw | 500 | `{ success: false, error: 'Internal server error', details: <message in development only> }` |

No audit on the read (the `new-api-route` skill: reads are not audited unless sensitive).

### `PATCH /api/business-os/account-profile`

**Zod schema** (in the route file; Next route files may only export handlers, so nothing else is exported):

```typescript
// Final (C-17, C-18): at or above the longest stored value, so a save never
// refuses a name the account already has. Live check L-1, 2026-10-15: the
// longest stored full_name is 11 characters and the longest job_title 17;
// none is over these limits.
const FULL_NAME_MAX_LENGTH = 120;
const JOB_TITLE_MAX_LENGTH = 100;

const accountProfilePatchSchema = z
  .object({
    full_name: z.string().trim().max(FULL_NAME_MAX_LENGTH).optional(),
    job_title: z.string().trim().max(JOB_TITLE_MAX_LENGTH).optional(),
  })
  .strict()
  .refine((v) => v.full_name !== undefined || v.job_title !== undefined, {
    message: 'Nothing to update',
  });
```

- `.strict()`: `role`, `avatar_url`, `id`, `user_id`, `userId`, `timezone`, `timezone_confirmed_at`, `company` and any other key are a 400.
- Trimmed, then measured (Zod 3.25 runs `.trim()` before the following `.max()`). Empty is allowed (today the page can save an empty name).
- `null`, numbers, arrays and objects are a 400. `null` is not "clear": an empty string is.
- No other content rule (no character filtering): D-2 must not be stricter than today's upsert (C-18).

**Handler order:**

1. `correlationId` from `x-correlation-id` or `crypto.randomUUID()`; `requestLogger = logger.child({ correlationId })`.
2. `getUser()`; none → 401.
3. `request.json()` inside its own try; a parse failure → 400 `Invalid JSON body` (the preferences route's pattern).
4. `accountProfilePatchSchema.parse(body)`; a `ZodError` → 400 `{ success: false, error: 'Invalid input', details: error.flatten() }` (F-12 closed: the skill's own pattern; `flatten()` carries messages, not the submitted values).
5. `fields = Object.keys(validated)` (only `full_name` / `job_title` can be present). `requestLogger.info({ userId, fields }, 'Profile card update requested')`. No values.
6. `userProfileRepository.saveSettingsCard(user.id, validated)`. Error → 500 `Failed to save the profile`, logged `{ userId, fields, err }`.
7. Audit, non-blocking: `auditTrail.log({ action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED, entityType: 'user', entityId: user.id, userId: user.id, details: { fields }, request }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`. `SETTINGS_PROFILE_UPDATED` has a metadata entry (`lib/audit/events.ts`, `[AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED]`, now near line 788); `PROFILE_UPDATED` has none, so it is not used (C-17). No `changes`, no name values. Not a money, access, entitlement or price write, so no awaited flush (WC-7 does not apply). `entityType: 'user'` matches the existing `SETTINGS_PROFILE_UPDATED` writers (`ProfileTab`, `ProfileTabV2`); see [Q-6](#questions-for-sa).
8. 200 `{ success: true, data: validated }`: the saved fields as stored (trimmed), so the page can show exactly what was stored.

**The route imports neither `UserPreferencesRepository` nor `updateTimezoneMirror`.** It cannot write `user_preferences` or the timezone mirror. That is the server half of the F-24 fix and is pinned by a test.

| Case | Status | `error` |
|---|---|---|
| Signed out | 401 | `Unauthorized` |
| Body is not JSON | 400 | `Invalid JSON body` |
| Empty object, unknown or forbidden key, wrong type, over the limit | 400 | `Invalid input` (+ `details`) |
| Repository error | 500 | `Failed to save the profile` |
| Unexpected throw | 500 | `Internal server error` (+ `details` in development only) |
| Saved | 200 | — (`data` = saved fields) |

---

## Repository Methods and CR-1

**File:** `lib/repositories/UserProfileRepository.ts` (service-role client, unchanged).

### Header rewrite

The header now says the repository has two kinds of write: `updateTimezoneMirror` (D-1; update only, never creates a row) and `saveSettingsCard` (D-2; upsert on `id`, so it **does** create a row for an account that has none, matching what the page's browser upsert did). The service-role reason stays: the only callers pass the session user's id, every query is scoped with `.eq('id', userId)` or carries `id: userId` as the upsert key, and the write payload is built from an allow-list (the field-level half of `tenant-isolation-guard`). It also states that `role` and `avatar_url` are never written by `saveSettingsCard`.

### Types and constants

```typescript
/** The settings profile card (D-2). Exported for tests. */
export const SETTINGS_CARD_COLUMNS = 'full_name, avatar_url, job_title';

export interface ProfileSettingsCard {
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
}

/** The only fields the card may write. No role, no avatar_url, no id. */
export interface ProfileSettingsCardPatch {
  full_name?: string;
  job_title?: string;
}
```

### `findSettingsCard(userId): Promise<RepositoryResult<ProfileSettingsCard | null>>`

`from('profiles').select(SETTINGS_CARD_COLUMNS).eq('id', userId).maybeSingle()`. No row is `{ data: null, error: null }`, not an error (`.maybeSingle()`, unlike the page's `.single()` today, which turned no row into an error). Errors go through `safeDbError` (below).

### `saveSettingsCard(userId, patch): Promise<RepositoryResult<true>>`

1. Build the payload field by field from the allow-list, never by spreading `patch`:
   - `full_name` only if `typeof patch.full_name === 'string'`;
   - `job_title` only if `typeof patch.job_title === 'string'`.
2. If neither is present, return an error (`code: 'EMPTY_PATCH'`) **without** a query. The route never sends this (its schema refuses `{}`); it is a guard for other callers.
3. `updated_at = new Date().toISOString()` (the BEFORE UPDATE trigger resets it on the update path; it is still needed on the insert path).
4. `id: userId` set **last**, so nothing earlier in the object can override it (tenant-isolation-guard, Step 4).
5. `.from('profiles').upsert(payload, { onConflict: 'id' })`, **no** `.select()` (the PostgREST update + select hazard), awaited as `{ error }`. This matches the page's current upsert for accounts with no row (ruling 3). On an existing row PostgREST's `ON CONFLICT (id) DO UPDATE` sets only the columns in the payload, so `avatar_url`, `role`, `timezone` and the rest are left alone.
6. Never throws.

### CR-1: `safeDbError` in the whole file

D-1's SA code review (CR-1, Low): this file logs and returns the raw PostgREST error, whose `details` can carry row values ("Failing row contains …"), where `UserPreferencesRepository` reduces it first. "If this file is touched again (D-2), move it to `safeDbError` as a whole." D-2 does that:

- A file-local helper, the same shape as `UserPreferencesRepository`'s inline code and the invite repository's private `toError`:
  ```typescript
  /** A fresh Error from the safe projection: no `details`, no `hint`. */
  function toSafeError(error: unknown): Error {
    const safe = safeDbError(error);
    const out = new Error(safe.message) as Error & { code?: string };
    if (safe.code) out.code = safe.code;
    return out;
  }
  ```
- Every method's catch becomes `const safe = safeDbError(error); this.logger.error({ dbError: safe, userId /* or the method's existing count fields */ }, '<existing message>'); return { data: null, error: toSafeError(error) }`. Methods: `findById`, `updateTimezoneMirror`, `listForAdmin`, `findAdminNamesByIds`, `findForUserDataExport`, and the two new ones. Log messages and the non-error fields each method logs today are kept.
- `safeDbError` is imported from `./BusinessOsInviteRepository`, as `UserPreferencesRepository`, `AuthAccountRepository`, `BusinessOsAccountLineageRepository` and `BusinessOsAccountPlanRepository` already do. No new pattern.
- **Callers are unaffected.** Every caller checks `error` for truthiness or logs it as `{ err }` (`my-day`, `builders.ts`, `adminDisplayName.ts`, admin users route, admin audit-trail route, `data-export/sections.ts`, the preferences route). The admin users route's development-only `details: profilesResult.error?.message` still gets the message. Nobody reads `details` or tests `instanceof PostgrestError`.
- **Tests that assert the raw error object** (identity) change to assert the safe projection. Three files, two owned by other streams (see [Q-3](#questions-for-sa)):

| Test | Today | After |
|---|---|---|
| `lib/repositories/__tests__/UserProfileRepository.updateTimezoneMirror.test.ts` U-3 (D-1) | `result.error` is the raw error; log has `err` | `result.error` is an `Error` with the same `message` and `code`, not the same object; log has `dbError: { code, message }` and no `details` |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` N-4 (admin reorganisation) | `expect(result.error).toBe(dbError)` | `toMatchObject({ message: dbError.message })` and `not.toBe(dbError)` |
| `lib/repositories/__tests__/userDataExportReads.test.ts` PostgREST case (data export) | `toEqual({ data: null, error: POSTGREST_ERROR })`; log `{ err: POSTGREST_ERROR, userId }` | `data: null`, `error.message`/`code` equal; log `{ dbError: { code, message }, userId }` |

If SA prefers to keep CR-1 to the methods D-1 and D-2 own (`updateTimezoneMirror`, `findSettingsCard`, `saveSettingsCard`), the second and third rows drop out and the other four methods keep `{ err }`. Either way the two new methods use `safeDbError`.

---

## Page Change and the F-24 Fix

Two pieces of `page.tsx` change: the profile half of `loadData` and `saveProfile`. The order `loadData` → `persistTimezone` → `saveProfile` stays (the D-1 source guard slices the file on those three names).

### `loadData` (profile half only)

The first member of the existing `Promise.allSettled([...])` changes from the browser select to a fetch of the new route. The second member (D-1's timezone read) is untouched. The two halves stay independent: a failed profile read cannot blank the timezone, and the other way round (C-13).

```typescript
const [profileSettled, timezoneSettled] = await Promise.allSettled([
  (async (): Promise<ProfileCardValues | null> => {
    const res = await fetch('/api/business-os/account-profile', { method: 'GET' });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.success !== true || !payload.data) {
      logger.error({ userId: user.id, status: res.status }, 'Failed to load the profile card');
      return null;
    }
    return payload.data as ProfileCardValues;
  })(),
  /* D-1's timezone read, unchanged */
]);
```

`setProfile` then reads `card?.full_name || ''`, `card?.avatar_url || ''`, `card?.job_title || ''` and `timezone: storedTimezone`, as it does today (the "not gated on the profile row" comment stays). `ProfileCardValues` is a local type (`{ full_name: string; avatar_url: string; job_title: string }`). The existing `profileSettled.status === 'rejected'` log line stays.

### `saveProfile`: two paths, decided by what the caller passed

`saveProfile` keeps its signature, `(overrides?: Partial<typeof profile>) => Promise<void>`, because the frozen timezone row calls it as `saveProfile({ timezone: tz.value })` and the card's Save calls it as `saveProfile()`. Inside, it splits on whether a timezone was passed:

```typescript
const saveProfile = async (overrides?: Partial<typeof profile>) => {
  if (!user) return;

  // The timezone row passes { timezone } and must save ONLY the timezone.
  // The card's Save passes nothing and must NEVER touch the timezone:
  // re-sending it stamped timezone_confirmed_at and answered the publish
  // gate's question on the owner's behalf (F-24).
  if (overrides?.timezone !== undefined) {
    const zone = overrides.timezone;
    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');
      const saved = zone ? await persistTimezone(zone) : null;
      if (!saved) {
        setErrorMessage(t('settings.profile.error'));
        return;
      }
      setSuccessMessage(t('settings.profile.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } finally {
      setSaving(false);
    }
    return;
  }

  const next = { ...profile, ...overrides };
  try {
    setSaving(true);
    setSuccessMessage('');
    setErrorMessage('');

    const res = await fetch('/api/business-os/account-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: next.full_name }),   // see Q-2
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.success !== true) {
      logger.error({ userId: user.id, status: res.status }, 'Failed to save the profile card');
      setErrorMessage(t('settings.profile.error'));
      return;
    }
    if (typeof payload.data?.full_name === 'string') {
      setProfile(p => ({ ...p, full_name: payload.data.full_name }));  // the stored (trimmed) value
    }

    setEditingProfile(false);
    setSuccessMessage(t('settings.profile.saved'));
    setTimeout(() => setSuccessMessage(''), 3000);
  } catch (error) {
    logger.error({ err: error }, 'Failed to save the profile');
    setErrorMessage(t('settings.profile.error'));
  } finally {
    setSaving(false);
  }
};
```

What changes, and why:

| Path | Before | After |
|---|---|---|
| Card Save (`saveProfile()`) | Browser upsert of `full_name`, `avatar_url`, `job_title`; then `persistTimezone(profile.timezone)` whenever a zone was loaded (**F-24**) | One `PATCH /api/business-os/account-profile` with `{ full_name }`. **No timezone, no `persistTimezone`, no request to the preferences route**, so `timezone_confirmed_at` is never stamped by a name save. No `avatar_url` (the hook already stored it at pick time, F-6; C-18) |
| Timezone row (`saveProfile({ timezone })`, frozen) | Browser upsert of the whole card first (a failure blocked the timezone), then `persistTimezone(zone)`; on success the edit mode closed | `persistTimezone(zone)` only. The profile card is not re-written. A profile-route failure can no longer block the publish-gate answer. The edit mode is left as it is, so a half-typed name is neither saved nor shown as if saved (see [Q-1](#questions-for-sa)) |
| `saving` / messages | Shared | Shared, unchanged (the Save button is still disabled while either save runs) |

**This changes one sentence of C-18.** C-18 says that, because the timezone row goes through `saveProfile`, "a profile PATCH failure still blocks the timezone save, as today". With the split above it no longer does. That was a side effect of the old shared upsert, and the D-1 SA review's F-24 direction ("call the timezone route only when the timezone was passed as an override") leaves the profile half open. The alternative that keeps C-18 literally is in Q-1.

**`persistTimezone` is unchanged.** It is still the only place that sends a timezone, still sends exactly `{ timezone: zone }`, and still succeeds only on the server's read-back. The timezone row's markup and its `onClick` are byte for byte the same.

**Avatar.** Both `<AvatarUpload>` usages and their `onAvatarChange` (which updates `profile.avatar_url` in state) are unchanged. The hook keeps uploading and writing `profiles.avatar_url` itself (A-1 to A-7, D-3's). The page's state still shows the new picture at once. The only difference: Save no longer writes the same URL a second time. One edge, for an account with no `profiles` row, is RK-2.

**The `supabase` import** is no longer used by any code in `page.tsx` after D-2, which gives one `no-unused-vars` **warning** (the rule is `warn` in `eslint.config.mjs`). C-13 gives the import's removal to D-4, so D-2 leaves it (Q-4).

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/account-profile/route.ts` | create | `GET` + `PATCH`, C-17, ruling 3 |
| `app/api/business-os/account-profile/__tests__/route.test.ts` | create | Route integration tests (happy, 401, 400 set, 500, audit, F-24 server half) |
| `lib/repositories/UserProfileRepository.ts` | modify | `findSettingsCard`, `saveSettingsCard`, types, header; CR-1 `safeDbError` |
| `lib/repositories/__tests__/UserProfileRepository.settingsCard.test.ts` | create | One test group per new method, allow-list and key order, CR-1 for the new methods |
| `lib/repositories/__tests__/UserProfileRepository.updateTimezoneMirror.test.ts` | modify | U-3 asserts the safe projection (CR-1) |
| `app/business-os/settings/page.tsx` | modify | Profile half of `loadData`; `saveProfile` (route + F-24 split) |
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | modify | Test "Settings writes the profile row" rewritten to C-18 (a)(b)(c); My Day and header tests untouched |
| `app/business-os/settings/__tests__/accountProfile.guard.test.ts` | create | Source guard: page profile read/write go through the route; F-24 split; negative controls |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify (Edit only) | §0.2 D-2 progress line, Change History row |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D2_WORKPLAN.md` | create | This workplan |

No migration, no new table or column (so no data-export classification change: `profiles` columns are unchanged), no new dependency, no new pattern.

---

## Task List

- ✅ 1. Wait for the SA workplan review; apply its conditions to this plan.
- ✅ 2. User runs live checks L-1 to L-5 (read-only); record results here; set `FULL_NAME_MAX_LENGTH` / `JOB_TITLE_MAX_LENGTH` from L-1 (and L-2, L-5). (Run by TL; 120 / 100 final, SA-D2-4.)
- ✅ 3. When PR #421 merges: `git fetch` and `git merge origin/main` (no rebase, no stash); confirm `persistTimezone` and `updateTimezoneMirror` are as reviewed. (Branch fast-forwarded to `origin/main` `8c94767b` by RM.)
- ✅ 4. Repository: types, `SETTINGS_CARD_COLUMNS`, `findSettingsCard`, `saveSettingsCard`, header rewrite.
- ✅ 5. Repository: CR-1 `toSafeError` + `safeDbError` in `findById`, `updateTimezoneMirror` and the two new methods (SA-D2-3; CR-1b named in the header).
- ✅ 6. Repository tests: new `settingsCard` file; update U-3. (N-4 and the export case not edited, SA-D2-3.)
- ✅ 7. Route: `GET` + `PATCH` per the contract.
- ✅ 8. Route tests.
- ✅ 9. Page: profile half of `loadData`.
- ✅ 10. Page: `saveProfile` route call and F-24 split.
- ✅ 11. Greeting guard rewrite (C-18 a, b, c) and the new `accountProfile.guard.test.ts`.
- ✅ 12. Run the must-stay-green set, `npx tsc --noEmit` on touched files (`NODE_OPTIONS=--max-old-space-size=12288`, check the exit code, compare error counts before and after), `npm run typecheck:bos-llm`, eslint on touched files, `npm run lint:hooks`, grep `console.` in touched files.
- ✅ 13. Mutation run (scratchpad runner, file restored and hashed after each mutation); record results.
- ✅ 14. Fill Implementation Notes; update requirement §0.2; hand to SA code review + QA. **No commit.**

---

## Test Plan

### New: route (`app/api/business-os/account-profile/__tests__/route.test.ts`)

Mocks as in the preferences route test: `@/lib/auth` `getUser`, `@/lib/logger` (shared recording logger), `AuditTrailService.getInstance().log` (resolves), `@/lib/repositories/UserProfileRepository` (`findSettingsCard`, `saveSettingsCard`, plus `updateTimezoneMirror` as a spy), and `@/lib/repositories/UserPreferencesRepository` as spies that must never be called.

| # | Case | Expect |
|---|---|---|
| G-1 | GET, row found | 200, the three fields; `findSettingsCard` called once with the session id |
| G-2 | GET, no row (`data: null`) | 200, three empty strings |
| G-3 | GET, `null` columns | 200, `''` for each |
| G-4 | GET signed out | 401; repository not called |
| G-5 | GET, repository error (production `NODE_ENV`) | 500 `Failed to load the profile`; body has no database message |
| G-6 | GET `?user_id=<other>` | Repository still called with the session id only |
| P-1 | PATCH `{ full_name: 'Dana Cohen' }` | 200, `data: { full_name: 'Dana Cohen' }`; `saveSettingsCard(SESSION_ID, { full_name: 'Dana Cohen' })`; one audit call, `SETTINGS_PROFILE_UPDATED`, `details: { fields: ['full_name'] }`, `entityId` = session id, and **the serialised audit call does not contain `Dana`** |
| P-2 | `{ job_title: 'founder' }` | Saved with `job_title` only; audit `fields: ['job_title']` |
| P-3 | Both fields | Both saved; audit lists both |
| P-4 | `{ full_name: '  Dana  ' }` | Saved and returned as `'Dana'` |
| P-5 | `{ full_name: '' }` | 200 (empty allowed) |
| P-6 | `full_name` of exactly the limit, and the limit with outer spaces | 200 |
| P-7 | `full_name` limit + 1, `job_title` limit + 1 | 400 each; no save |
| P-8 | PATCH signed out | 401; no save, no audit |
| P-9 | 400 set, each with no save and no audit: `{}`; `{ role: 'admin' }`; `{ full_name: 'x', role: 'admin' }`; `{ avatar_url: 'https://…' }`; `{ id: '<other>' }`; `{ user_id: '<other>' }`; `{ userId: '<other>' }`; `{ timezone: 'UTC' }`; `{ timezone_confirmed_at: '…' }`; `{ company: 'x' }`; `{ full_name: null }`; `{ full_name: 42 }`; `[]`; raw `'not json'` | 400 (`Invalid JSON body` for the last, `Invalid input` for the rest) |
| P-10 | Repository error | 500 `Failed to save the profile`; no audit; no database message in the body |
| P-11 | Audit rejects | Still 200; error logged |
| P-12 | **F-24, server half:** any PATCH (P-1 to P-3) | `UserPreferencesRepository` methods and `updateTimezoneMirror` never called; and the route source contains no `UserPreferencesRepository` import and no `updateTimezoneMirror` |
| P-13 | No value in logs | Across P-1 to P-4 and P-10, no logger call's arguments contain the submitted name or job title |
| P-14 | `x-correlation-id` header | Used for the child logger (as the preferences test checks, if it does; otherwise skipped) |

### New: repository (`lib/repositories/__tests__/UserProfileRepository.settingsCard.test.ts`)

Same recording client as the D-1 mirror test.

| # | Case | Expect |
|---|---|---|
| S-1 | `findSettingsCard` | Calls exactly `from('profiles')`, `select('full_name, avatar_url, job_title')`, `eq('id', USER)`, `maybeSingle()`; returns the row |
| S-2 | No row | `{ data: null, error: null }`; nothing logged at error |
| S-3 | Database error with `details: 'Failing row contains (…secret…)'` | `data: null`; `error.message`/`code` kept; **no `details`** on the returned error; log has `dbError: { code, message }` and the serialised log does not contain `secret` |
| W-1 | `saveSettingsCard(USER, { full_name: 'Dana', job_title: 'founder' })` | One `upsert`, options `{ onConflict: 'id' }`; payload keys in order `full_name`, `job_title`, `updated_at`, `id`; `id === USER`; no `select` call |
| W-2 | `{ job_title: 'founder' }` | Payload has no `full_name` key |
| W-3 | Injected (cast) `{ full_name: 'x', id: 'ATTACKER', user_id: 'ATTACKER', role: 'admin', avatar_url: 'u', timezone: 'UTC', timezone_confirmed_at: 't' }` | Payload keys exactly `full_name`, `updated_at`, `id`; `id === USER` |
| W-4 | `{}` | Error `EMPTY_PATCH`; **no** `from` call |
| W-5 | Database error with `details` | As S-3, never throws |

### Modified: CR-1 tests

U-3 (D-1 mirror test) as in the CR-1 table; N-4 and the export PostgREST case if Q-3 is "whole file". Plus one new case in the settings-card file: `findById` error returns the safe projection and logs `dbError` (covers the method My Day uses).

### Modified: greeting guard (`greetingUsesTheEditedName.guard.test.ts`, C-18)

Test "Settings writes the profile row" is replaced by three assertions, on comment-stripped source:

- (a) `page.tsx` contains `fetch('/api/business-os/account-profile'` with `method: 'PATCH'` inside `saveProfile`, and that body contains `full_name: next.full_name`;
- (b) `app/api/business-os/account-profile/route.ts` contains `userProfileRepository.saveSettingsCard(user.id`;
- (c) in `lib/repositories/UserProfileRepository.ts`, the `saveSettingsCard` body contains `.from('profiles')` and `full_name`.

The header comment's "Settings writes `profiles.full_name`" table gains "through `/api/business-os/account-profile` and `saveSettingsCard`". The My Day assertions and the "settings header" tests are not changed.

### New: page source guard (`app/business-os/settings/__tests__/accountProfile.guard.test.ts`)

Comment-stripped `page.tsx`, sliced with the D-1 guard's `between` helper (`loadData` .. `persistTimezone`, `saveProfile` .. the next top-level `const`):

| # | Assertion |
|---|---|
| A-1 | `loadData` contains `fetch('/api/business-os/account-profile'` and no `from('profiles')` and no `supabase.` |
| A-2 | `loadData` still uses `Promise.allSettled(` and still has the D-1 timezone fetch (independence) |
| A-3 | `saveProfile` contains no `supabase.` and no `.from(` |
| A-4 | `saveProfile`'s PATCH body (the `JSON.stringify({ … })` passed to the account-profile fetch) contains `full_name` and does **not** contain `avatar_url`, `timezone`, `role`, `user_id` or `id:` |
| A-5 | **F-24:** `saveProfile` has exactly one `persistTimezone(` call, and it sits inside the `if (overrides?.timezone !== undefined)` branch, before that branch's `return;`. The code after the branch (the card path) contains no `persistTimezone(` and no `timezone` |
| A-6 | The timezone branch does not call the account-profile route (the timezone row does not re-write the card; drops out if SA picks Q-1 option (a)) |
| A-7 | Nothing in `page.tsx` (code) matches `from\(\s*'profiles'\s*\)` |
| A-8 | The frozen timezone row still calls `saveProfile({ timezone: tz.value })` (so the split stays reachable) |
| N-1..N-4 | Negative controls: the matchers flag (1) the old browser select in `loadData`, (2) the old upsert in `saveProfile`, (3) a card path that calls `persistTimezone(next.timezone)` after the PATCH (today's F-24 shape), (4) a PATCH body carrying `avatar_url` |

**F-24 regression, in summary:** the page side is A-5/A-6 and N-3 (a name save cannot reach `persistTimezone`, the only code that sends a timezone); the server side is P-9 (`timezone` and `timezone_confirmed_at` keys are 400), P-12 (the route never touches preferences or the mirror) and W-3 (the repository drops any timezone key). Together a name save cannot send a timezone or stamp `timezone_confirmed_at`. There is no page render harness for `page.tsx` (every existing settings test is a source guard), so a behavioural render test would be new; see Q-8.

### Must stay green

- `app/business-os/settings/__tests__/timezoneWrite.guard.test.ts` (D-1; the `loadData` / `persistTimezone` / `saveProfile` order is kept)
- `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts`, `accountCard.guard.test.ts`
- `app/api/business-os/my-day/__tests__/*` (My Day half of the greeting guard unchanged)
- `app/api/business-os/preferences/__tests__/route.test.ts`
- `lib/repositories/__tests__/*` (incl. `adminReadMethods`, `userDataExportReads`, the D-1 repository tests)
- `lib/business-os/data-export/__tests__/*`, `app/api/user/data-export/__tests__/*`
- `app/api/admin/users/__tests__/*`, `app/api/admin/audit-trail/__tests__/*`, `app/admin/__tests__/adminDisplayName.resolve.test.ts`, `app/admin/components/__tests__/AdminHeader.render.test.tsx`
- `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (no admin route added)
- `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (no delete added)
- `app/api/audit/__tests__/auditRoutes.test.ts`, `lib/audit/__tests__/*` (event used is already registered)
- `darkModeTokens.guard.test.ts` (three option rows untouched)
- `journeyReadiness.test.ts` and the C-2 timezone guard
- `npm run test:bos-entitlements` is not required: D-2 imports nothing from `lib/business-os/entitlements/` (checked with grep before handover)

---

## Mutation Candidates

| # | Mutation | Expected killer |
|---|---|---|
| M-1 | Remove `.strict()` from the PATCH schema | P-9 (`role`, `avatar_url`, `id`, `timezone` …) |
| M-2 | Add `avatar_url: z.string().optional()` to the schema | P-9 `avatar_url` |
| M-3 | Remove the "at least one field" refine | P-9 `{}` |
| M-4 | Remove `.trim()` | P-4 |
| M-5 | Remove `.max()` on `full_name` | P-7 |
| M-6 | Repository spreads the patch (`{ ...patch, updated_at, id }`) | W-3 |
| M-7 | `id` first in the payload | W-1 (key order) |
| M-8 | `upsert` → `update().eq('id')` | W-1 |
| M-9 | `.select()` chained after the upsert | W-1 |
| M-10 | `findSettingsCard` selects `'*'` or adds `role` | S-1 |
| M-11 | `.maybeSingle()` → `.single()` | S-1 |
| M-12 | GET returns `null` instead of `''` for a missing row | G-2, G-3 |
| M-13 | Audit `details` carries the values | P-1 (serialised audit contains the name) |
| M-14 | Audit without `.catch` | P-11 |
| M-15 | 500 body carries the database message | G-5, P-10 |
| M-16 | `toSafeError` returns the raw error | S-3, W-5, U-3 |
| M-17 | Page card path calls `persistTimezone(next.timezone)` again (F-24 back) | A-5, N-3 |
| M-18 | Page PATCH body sends `avatar_url` | A-4 |
| M-19 | Page `loadData` back to `supabase.from('profiles')` | A-1, A-7 |
| M-20 | Timezone branch also PATCHes the card | A-6 |
| M-21 | Route calls `saveSettingsCard` with an id from the body (via a cast) | P-9 `id` / `user_id` (strict first), G-6 for GET |
| M-22 | Route imports `userPreferencesRepository` and calls it on PATCH | P-12 |

---

## Manual QA Checklist

On a **test account**, desktop and phone, English and Hebrew. No production data is changed beyond the test account's own profile and timezone.

| # | Check | Expected |
|---|---|---|
| Q1 | Settings → pencil → change the name → Save | "Saved"; card shows the new name; reload keeps it; My Day greets the new first name |
| Q2 | Network tab on page load | One `GET /api/business-os/account-profile`; **no** request to `…supabase.co/rest/v1/profiles` from the page (the avatar hook only calls it on an avatar action, D-3) |
| Q3 | Network tab during Q1 | One `PATCH /api/business-os/account-profile` with body exactly `{"full_name":"…"}`; **no** `PATCH /api/business-os/preferences` |
| Q4 | **F-24.** A test account whose timezone is **not confirmed** (fresh account, or one where the publish screen shows "Set your timezone"): edit the name and Save | "Saved". No preferences request (Q3). The publish screen **still** shows "Set your timezone", and the My Day timezone nudge is still shown. (Before D-2, this Save cleared both) |
| Q5 | Timezone row: pick a zone | One `PATCH /api/business-os/preferences` with `{"timezone":"…"}` and **no** account-profile request; "Saved"; the publish gate clears |
| Q6 | Open the name editor, type a new name, then pick a timezone from the row without pressing Save | The timezone saves; the name is **not** saved (reload shows the old name); the editor stays open (Q-1 option (b)) |
| Q7 | Upload a new avatar in view mode; reload | New avatar shown (hook path, unchanged) |
| Q8 | Pencil → upload a new avatar → change the name → Save; reload | New avatar and new name both kept; the Save body has no `avatar_url` |
| Q9 | Remove the avatar, then Save the name; reload | Avatar stays removed |
| Q10 | Hebrew name, a name with an emoji, a name with outer spaces | Saved; outer spaces gone after reload |
| Q11 | Job title (an account that has one) | Still shown unchanged after a name save |
| Q12 | Offline (DevTools) → Save the name | Red error banner; nothing saved; the editor stays open |
| Q13 | Signed out: `curl` GET and PATCH | 401 both |
| Q14 | Signed in (session cookie), PATCH with `{"role":"admin"}`, `{"avatar_url":"x"}`, `{"user_id":"<other>"}`, `{"timezone":"UTC"}`, `{}` | 400 each; nothing changes (reload) |
| Q15 | Signed in, PATCH with a name one character over the limit | 400 |
| Q16 | `/admin` audit trail for the test account | One `SETTINGS_PROFILE_UPDATED` per Save, details show field names only, no name |

QA records how the signed-in requests in Q14 and Q15 were made.

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| RK-1 | The length limit refuses a stored name, so an owner cannot save at all | Low | L-1 sets the limit at or above the live maximum (C-18). Over-length only matters for a value the owner types, and the page then shows the error |
| RK-2 | An account with **no** `profiles` row picks an avatar (the hook's update hits 0 rows, silently) and then saves the name: today the page's upsert also stored `avatar_url`; after D-2 the created row has none, and the picture disappears on reload | Very low. **L-3 (2026-10-15): 1 account has no row** | Accepted for D-2 (SA-D2-8): the loss is "pick the avatar again" between the D-2 and D-3 merges. **Handed to D-3:** C-19's `setAvatarUrl` must store the URL for an account with no `profiles` row (create the row, same allow-list and `id`-last rules, with a no-row test); recorded in requirement F-25. D-2 does not take over `avatar_url` (C-18) |
| RK-3 | The timezone pick no longer re-saves the card, and a pick no longer closes the editor | Intended (F-24, Q-1) | Q6 checks it. Option (a) in Q-1 keeps the old coupling if SA prefers |
| RK-4 | After a failed profile read the page holds empty values; a Save that sent `job_title` would wipe the stored job title, which the page cannot edit (F-1) | Medium if both fields are sent | Q-2: the page sends `full_name` only |
| RK-5 | CR-1 test edits in files owned by other streams (data export DE-4, admin reorganisation) conflict with their open work | Medium | Assertion-only edits; Q-3 offers the narrower scope. Whichever merges second merges `origin/main` in |
| RK-6 | `page.tsx` merge with D-1 (#421) or DE work | Medium | D-2 waits for #421 and merges `origin/main` in; one open `page.tsx` PR at a time (C-24) |
| RK-7 | A trigger on `profiles` acts on the new service-role upsert | Very low | L-4; `profiles_role_privilege_guard` exempts `service_role` and D-2 never sends `role` |
| RK-8 | Trimming changes a stored name with outer spaces on its next save | Certain for such names, harmless | My Day already trims; recorded |
| RK-9 | The leftover `supabase` import gives one lint warning until D-4 | Certain | Warning, not an error (Q-4) |
| RK-10 | Service-role upsert writes a row the caller does not own | Very low | `id` from `getUser()` only, set last; allow-list payload; strict schema; W-3 and P-9 |

---

## Rollback

Code only: no migration, no backfill, no new column. Revert the PR. Rows written by D-2 have the shape the old browser upsert wrote (`full_name`, `job_title`, `updated_at`, `id`; never `avatar_url`), so the reverted page reads them unchanged. A revert also brings F-24 back.

---

## Questions for SA

1. **Q-1 F-24 split, and the C-18 sentence.** Recommended **(b)**: the timezone row saves only the timezone (no card re-write, the editor is left open), and the card's Save saves only the card. It decouples the publish-gate answer from the card, and a pick cannot save a half-typed name or an empty name after a failed load. It contradicts C-18's "a profile PATCH failure still blocks the timezone save, as today", which SA would amend. Alternative **(a)**, closer to C-18 as written: the timezone row still PATCHes the card first and then calls `persistTimezone`; only the card's Save skips the timezone. Which?
2. **Q-2 PATCH body from the page.** C-18 says `{ full_name, job_title }`. The page has no job-title field (F-1), and after a failed profile read it holds `job_title: ''`, so sending it would wipe a stored title on the next Save (RK-4). Recommended: the page sends `{ full_name }` only; the route still accepts both. Agree?
3. **Q-3 CR-1 scope.** "As a whole" means three test files change, two owned by other streams (`adminReadMethods` N-4, `userDataExportReads`; assertion-only). Whole file, or only `updateTimezoneMirror` plus the two new methods?
4. **Q-4 `supabase` import.** After D-2 it is unused (one lint warning). C-13 gives its removal to D-4. Leave it for D-4 (recommended), or remove it here and shrink D-4 to the guard?
5. **Q-5 `maxLength` on the name input.** It would stop a typed over-length name before the request, but the input is profile-card markup outside C-13's lift. Recommended: not in D-2. Agree?
6. **Q-6 Audit shape.** `entityType: 'user'` (as `ProfileTab` / `ProfileTabV2` write this event) with `details: { fields }` and no `changes`. Or `entityType: 'settings'` like the preferences route? C-19 will reuse the same shape for the avatar.
7. **Q-7 PATCH response.** Returns the saved (trimmed) fields, and the page puts `full_name` back in state so the card shows what was stored. OK?
8. **Q-8 F-24 test level.** Covered by source guards (A-5, A-6, N-3) plus route and repository tests. A behavioural render test of `page.tsx` would need a new harness (providers, router, `fetch`), which is a new pattern. Is the source-guard level acceptable?
9. **Q-9 Limit rule.** If L-1 shows a value over 120 / 100, the limit becomes the live maximum rounded up to the next 10. Acceptable, or a fixed larger value (for example 200 / 150)?

---

## SA Review Notes

See [SA Workplan Review (2026-10-15)](#sa-workplan-review-2026-10-15) below.

---

## SA Workplan Review (2026-10-15)

**Reviewed by SA — 2026-10-15**
**Status:** APPROVED WITH CONDITIONS (SA-D2-1 to SA-D2-11 below). Implementation may start once PR #421 has merged and `origin/main` is merged in (Task 3). The live-check gate is already met (results below). Nothing in this review needs a decision from the user.

**Verified against code on `06ceab3b`:** `page.tsx` (`loadData` and its `Promise.allSettled`, `persistTimezone`, `saveProfile`, the card's `onClick={() => saveProfile()}`, the timezone option's `setProfile(…); saveProfile({ timezone: tz.value })`, the Cancel button's `setEditingProfile(false)`), `UserProfileRepository.ts` (all six methods, header), `preferences/route.ts` (pattern: `request.json()` try, `ZodError` → `flatten()`, `entityType: 'settings'`), `20261002_profiles_role_privilege_guard.sql` (trigger function body), `lib/audit/events.ts` (`SETTINGS_PROFILE_UPDATED` metadata), `lib/audit/eventAudience.ts` (`'shared'`), `BusinessOsInviteRepository.safeDbError` / `toError`, `greetingUsesTheEditedName.guard.test.ts`, `timezoneWrite.guard.test.ts`, `adminReadMethods.guard.test.ts` N-4, `userDataExportReads.test.ts` (the shared `it.each(CASES)` PostgREST case), every reader of `profiles.timezone`, skills `new-api-route`, `new-repository`, `tenant-isolation-guard`, `business-os-schema-check`.

### Live check results (run read-only on production by TL, 2026-10-15)

| Check | Result | Verdict |
|---|---|---|
| L-1 | 11 profile rows. Longest `full_name` 11 characters (19 bytes); longest `job_title` 17 characters. 0 names over 120, 0 titles over 100 | **PASS.** 120 / 100 are final (SA-D2-4) |
| L-2 | `id` uuid NOT NULL, no default. Every other column nullable. Defaults: `plan 'free'`, `timezone 'UTC'`, `language 'en'`, `role 'user'`, `onboarding false`, `hourly_rate_usd 50.00`, `created_at` / `updated_at now()`. `full_name`, `avatar_url`, `job_title` are `text`, no length limit | **PASS.** No NOT NULL column without a default other than `id`, so the insert path works; no `varchar(n)` below the Zod limits |
| L-3 | **1** auth user has no `profiles` row | RK-2 applies to one account. Ruled in SA-D2-8 |
| L-4 | `profiles_role_privilege_guard` BEFORE INSERT OR UPDATE OF role → `guard_profiles_role_privilege()`; `update_profiles_updated_at` BEFORE UPDATE | **PASS.** Exactly the two expected; neither writes another table or reads `full_name` / `job_title` |
| L-5 | PK `(id)`; FK `id` → `auth.users`; FK `org_id` → `organizations`; CHECKs on `domain`, `hourly_rate_usd`, `onboarding_mode`, `plan`, `role` | **PASS.** No CHECK on `full_name` / `job_title`. Every CHECKed column is either absent from the D-2 payload or takes a default that already passes (the signup trigger inserts the same defaults every day) |

### The upsert, the role guard and the `'UTC'` default (TL's questions)

- **Upsert, not update-then-insert. Confirmed (ruling 3 stands).** D-1's no-upsert ruling was about one column that needs *different* values on the two paths (`preferred_language`: keep it on an existing row, the business's language on a new one). `saveSettingsCard` has no such column: the payload is identical on both paths, and on a new row every other column should take its default. PostgREST's single-object upsert is `INSERT … ON CONFLICT (id) DO UPDATE SET` *only the payload columns*, so `avatar_url`, `role`, `timezone`, `plan` and the rest of an existing row are untouched. It is one atomic statement, so there is no zero-rows-then-insert race and no `23505` retry to write. Postgres checks NOT NULL and CHECK constraints on the proposed row even when it then conflicts, which is why L-2 / L-5 mattered: both pass.
- **Role guard: safe on both paths.** The repository uses `supabaseServer` (service role). The guard's first statement returns `NEW` unchanged when `current_user` is `service_role`. Even for a non-exempt caller it would pass: the payload never carries `role`, a new row takes the default `'user'` (not on the privileged list), and the `DO UPDATE` half does not fire an `UPDATE OF role` trigger because `role` is not in its SET list. Only `update_profiles_updated_at` fires on the update path.
- **`profiles.timezone 'UTC'` on a row D-2 creates. Accepted, no change.** `profiles.timezone` is only the best-effort mirror (D-1); `user_preferences.timezone` is the authority and `timezone_confirmed_at` lives there, so the publish gate, My Day, `journeyReadiness` and every Business OS clock are unaffected. The only readers of `profiles.timezone` are AgentsPilot paths (`lib/user-context/builders.ts`, `app/api/run-agent/route.ts`), which already see `'UTC'` on every signup-created row, because the signup trigger inserts `profiles (id)` with the same defaults. A row D-2 creates is therefore indistinguishable from a signup row plus a name, which is also exactly what today's browser upsert produces. D-1's mirror is update-only, so the next timezone save fills it. Do not seed the mirror from the authority in `saveSettingsCard`; that would be a second timezone writer, which F-24 exists to remove.

### Rulings on Q-1 to Q-9

| Q | Ruling |
|---|---|
| Q-1 | **(b).** The timezone row saves only the timezone; the card's Save saves only the card. Option (a) keeps a profile-route failure able to block the publish-gate answer, and keeps a pick able to save whatever is in the name field, including a name the owner **cancelled**: the Cancel button only closes the editor and never reverts `profile.full_name` (pre-existing, frozen markup), so under (a) a cancelled edit is saved by the next timezone pick. (b) closes that too. **C-18 is amended in the requirement** (both of its first two bullets; see SA-D2-1 / SA-D2-2) |
| Q-2 | **`{ full_name }` only.** RK-4 is real: `job_title` has no field (F-1), and a failed GET leaves `''` in state. The route keeps accepting `job_title` (ruling 3). The C-18 bullet is amended to match |
| Q-3 | **Narrowed.** `safeDbError` in `findById`, `updateTimezoneMirror`, `findSettingsCard`, `saveSettingsCard`. `listForAdmin`, `findAdminNamesByIds` and `findForUserDataExport` keep `{ err }` for now, recorded as follow-up **CR-1b** (Low). Reason: the value of CR-1 is in the write paths, where Postgres puts row values in `details` ("Failing row contains …"); read errors on those three are schema/permission errors. Moving `findForUserDataExport` means splitting it out of the shared `it.each(CASES)` table in `userDataExportReads.test.ts`, a file the data-export stream changed three times today and is still extending: a near-certain conflict for little gain. `findById` is in, because My Day and the user context call it and no other stream's test pins its raw error |
| Q-4 | **Leave the import for D-4** (C-13: D-4 removes it and adds the guard). The warning is `warn` under `eslint .`; `lint:hooks` (`--max-warnings 0`) uses its own config and does not carry `no-unused-vars`, which Task 12 confirms by running it |
| Q-5 | **No `maxLength` in D-2.** The input is frozen markup (C-13), and L-1 shows the longest stored name is 11 characters against a 120 limit, so the only way to hit the 400 is to type more than 120 characters; the generic error banner is acceptable for that |
| Q-6 | **`entityType: 'user'`, `entityId: user.id`, `details: { fields }`, no `changes` / `before` / `after`.** It matches every existing writer of `SETTINGS_PROFILE_UPDATED` (`ProfileTab`, `ProfileTabV2`, `auditRoutes.test.ts` fixtures), and the event is `'shared'` audience, so the admin trail filter is right. D-3 (C-19) uses the same shape with `fields: ['avatar_url']` |
| Q-7 | **Yes.** Return exactly the parsed object (only the keys sent, trimmed). The page writes `full_name` back to state only when it is a string |
| Q-8 | **Source-guard level is acceptable.** A page render harness would be a new pattern for one assertion that the source guard plus route test P-12, repository test W-3 and manual QA Q3 / Q4 already pin from both ends. Add mutation M-24 (SA-D2-10) |
| Q-9 | **Moot.** L-1: 11 / 17 characters. The limits are 120 / 100 as C-17 set. The "round up to the next 10" rule would have been acceptable; it is not needed |

### Other checks

| Area | Finding |
|---|---|
| Route contract | Matches C-17, C-23 and ruling 3. `.strict()` + refine; `getUser()` only; no query string read; `request.json()` in its own try (preferences pattern); `flatten()` on 400 carries messages and key names, never values (`too_big` / `invalid_type` / `unrecognized_keys` have no input in their message). No audit on GET is right |
| Session-only id | Both handlers pass `user.id`; `id` set last in the payload; allow-list built field by field. `tenant-isolation-guard` Step 4 (upsert conflict target + spread order, payload injection) covered by W-3 and M-6 / M-7. No unscoped trigger (L-4). No caller-supplied id exists, so no ownership pre-check is needed |
| No values in logs / audit | Correct on the happy and 500 paths (P-1, P-13). Not stated for the **400** path, which is where an over-long name arrives: SA-D2-6 |
| Audit | Non-blocking with `.catch`; no awaited flush (not a WC-7 write). Correct |
| Error format | Standard; repository messages never reach the client; `details` only in development on the 500 catch-all. Correct |
| Greeting guard rewrite | (a) must be asserted on the **`saveProfile` slice**, not the whole file, because `loadData` now fetches the same URL (a GET), so a whole-file match would pass even if the Save stopped sending the name. SA-D2-9 |
| F-24 split code | Correct as drafted. `persistTimezone` never throws, so the timezone branch needs no `catch`. The branch must keep its own final `return;`, or a pick falls through to the card PATCH: nothing in A-5 / A-6 as written catches a removed `return;` (SA-D2-10, M-24) |
| Test plan | Complete for C-17's list. Additions in SA-D2-2, SA-D2-6, SA-D2-9, SA-D2-10 |
| Manual QA | Q4 must not require a database write to produce an "unconfirmed" account: SA-D2-7 |
| Rollback | Correct. Rows written by D-2 have the shape the old upsert wrote, minus `avatar_url`, which the old page reads unchanged |
| Entitlements / admin / purge guards | No entitlements import, no admin route, no delete. Correct |
| `console.*` | 0 in all touched files (confirmed on `06ceab3b`) |

### Conditions

1. **SA-D2-1 (Q-1).** Implement the split as drafted: the timezone branch calls only `persistTimezone(zone)`, never the account-profile route and never `setEditingProfile`; the card path never calls `persistTimezone` and never sends a timezone. C-18's second bullet is amended in the requirement (SA, 2026-10-15). Manual QA Q6 stays.
2. **SA-D2-2 (Q-2).** The page PATCHes `JSON.stringify({ full_name: next.full_name })` only. A-4 also asserts the PATCH body has no `job_title`; negative control N-4 gains a case with `job_title`. C-18's first bullet is amended to match.
3. **SA-D2-3 (Q-3).** CR-1 scope is `findById`, `updateTimezoneMirror`, `findSettingsCard`, `saveSettingsCard`: each logs `{ dbError: safeDbError(error), … }` and returns `toSafeError(error)`. The other three methods are unchanged, and `adminReadMethods.guard.test.ts` and `userDataExportReads.test.ts` are **not** edited. The header says which methods use the safe projection and names **CR-1b** (the remaining three, Low) as the follow-up, to be done when the data-export stream is not editing `userDataExportReads.test.ts`. Remove those two files from the Files table. The `findById` case in the settings-card test file stays.
4. **SA-D2-4 (L-1, Q-9).** `FULL_NAME_MAX_LENGTH = 120`, `JOB_TITLE_MAX_LENGTH = 100`, final. Replace "provisional until L-1" with the L-1 fact (2026-10-15: longest stored 11 / 17 characters, none over the limits).
5. **SA-D2-5 (upsert).** Keep `upsert(payload, { onConflict: 'id' })`. The repository header records why (no column needs different values on the two paths, unlike D-1's `preferred_language`), that a created row takes the column defaults exactly as a signup-created row does (`role 'user'`, `timezone 'UTC'` as the mirror only), and that the role guard exempts `service_role` and `role` is never in the payload.
6. **SA-D2-6 (no values on the 400 path).** The 400 branches log at most `{ userId, fields: <top-level key names> }` or nothing: never the body, never `error.issues` / `error.flatten()` (`unrecognized_keys` issues are key names, but an over-long name must not be logged). Extend P-13 to P-7 and to `{ full_name: '<unique marker>', role: 'admin' }` from P-9. Add mutation **M-23**: the 400 branch logs the parsed body → killed by P-13.
7. **SA-D2-7 (Manual QA Q4).** No SQL write to production to manufacture an unconfirmed account. Use a test account whose publish screen already shows "Set your timezone" if one exists. Otherwise Q4 is proven by Q3's network evidence (no preferences request on a name save) plus a read-only `select timezone_confirmed_at from user_preferences where user_id = '<test account>'` before and after the save, run by TL, which must be unchanged.
8. **SA-D2-8 (RK-2).** Accepted for D-2, not folded in: fixing it here would mean D-2 writing `avatar_url`, which C-18 / C-19 give to D-3. L-3 shows one account; its loss is "pick the avatar again" between the D-2 and D-3 merges. **TL carries it into D-3's scope:** C-19's `setAvatarUrl` must store the URL for an account with no `profiles` row (create the row, same allow-list and `id`-last rules, test for the no-row case). Update the RK-2 row with L-3's result and this hand-off.
9. **SA-D2-9 (greeting guard).** All three assertions run on comment-stripped source. (a) is asserted on the `saveProfile` slice (`between(settings, 'const saveProfile', <next top-level const>)`): it contains `fetch('/api/business-os/account-profile'`, `method: 'PATCH'` and `full_name: next.full_name`. (c) is asserted on the `saveSettingsCard` method body, not the whole repository file (`findById` already contains `.from('profiles')` and `full_name`, so a whole-file match proves nothing).
10. **SA-D2-10 (fall-through).** A-5 also asserts the timezone branch's body ends with `return;` before its closing brace. Add mutation **M-24**: delete that `return;` (a pick then also PATCHes the card) → killed by A-5.
11. **SA-D2-11 (order and merge).** Implementation starts only after #421 merges and `origin/main` is merged in (no rebase, no stash). At handover the diff against `origin/main` shows D-2 only, `persistTimezone` is byte-identical to D-1, and `updateTimezoneMirror` differs only in its catch (CR-1). The D-1 guard `timezoneWrite.guard.test.ts` stays green unchanged.

### Optimisation suggestions (not conditions)

- `loadData`: assign each card field as `typeof v === 'string' ? v : ''` instead of casting `payload.data as ProfileCardValues`.
- `saveSettingsCard`'s `EMPTY_PATCH` guard: log at `warn` with `{ userId }` only.
- After a failed card GET the name field is empty, and Save would store an empty name (pre-existing, and narrower than today's upsert, which also blanked the avatar and job title). A "card did not load" ref that makes Save show the error instead of sending would close it; optional, inside `saveProfile` only.
- Pre-existing, not D-2's (frozen markup): Cancel does not restore the name in state, so the card shows a cancelled edit until reload. Worth a line in §7 if TL agrees; after (b) it can no longer be saved by a timezone pick.

### Approval

[x] Workplan approved with conditions SA-D2-1 to SA-D2-11. Proceed to implementation after Task 3. No user decision is required.

---

## Implementation Notes

**Dev, 2026-10-15.** Built on `origin/main` `8c94767b` (D-1 #421 merged; the branch was fast-forwarded by RM, so SA-D2-11's precondition held and the diff against `origin/main` is D-2 only). **Not committed.**

### What was built

| File | Change |
|---|---|
| `app/api/business-os/account-profile/route.ts` (new, 174 lines) | `GET` + `PATCH` per the [Route Contract](#route-contract). `getUser()` only; `.strict()` schema with the refine; limits 120 / 100 with the L-1 fact in the comment (SA-D2-4); the 400 path logs `{ userId, fields: <top-level key names> }` only (SA-D2-6); non-blocking `SETTINGS_PROFILE_UPDATED` audit, `entityType: 'user'`, `details: { fields }` (Q-6); returns the parsed object (Q-7). Imports no preferences repository and no `updateTimezoneMirror` (F-24, server half) |
| `lib/repositories/UserProfileRepository.ts` | `SETTINGS_CARD_COLUMNS`, `ProfileSettingsCard`, `ProfileSettingsCardPatch`, `findSettingsCard` (`maybeSingle`), `saveSettingsCard` (allow-list, `updated_at`, `id` last, `upsert(…, { onConflict: 'id' })`, no `.select()`, `EMPTY_PATCH` logged at `warn` with `{ userId }` only). Header rewritten with the upsert rationale (SA-D2-5), the two write behaviours and the CR-1 / **CR-1b** scope (SA-D2-3). File-local `toSafeError`; `findById`, `updateTimezoneMirror` and the two new methods log `{ dbError: safeDbError(error), userId }` and return `toSafeError(error)`. `listForAdmin`, `findAdminNamesByIds`, `findForUserDataExport` unchanged. `updateTimezoneMirror` differs only in its catch (2 lines) |
| `app/business-os/settings/page.tsx` | `loadData`'s first `allSettled` member is now a `GET` of the route (each field `typeof v === 'string' ? v : ''`, the SA optimisation; no cast to the card type). `saveProfile` split per SA-D2-1: the `overrides?.timezone !== undefined` branch calls only `persistTimezone(zone)` and ends with `return;`, never the route and never `setEditingProfile`; the card path PATCHes `JSON.stringify({ full_name: next.full_name })` only (SA-D2-2) and writes the stored name back to state when it is a string. Module-level `type ProfileCardValues`. **`persistTimezone` is byte-identical to `HEAD`** (checked with `diff` on the extracted function). The `supabase` import is left for D-4 (Q-4) |
| `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` | Test "Settings writes the profile row" rewritten per SA-D2-9, on comment-stripped source: (a) on the `saveProfile` slice (`const saveProfile` .. `const providerNotice`), (b) on the route, (c) on the `saveSettingsCard` body (`async saveSettingsCard` .. `async listForAdmin`). Header table updated. My Day and header tests untouched |
| `app/business-os/settings/__tests__/accountProfile.guard.test.ts` (new) | A-1 to A-8 and negative controls N-1 to N-6. A-5 uses brace matching to isolate the timezone branch and asserts it ends with `return;` (SA-D2-10); N-5 is the removed-`return;` control, N-6 the branch-also-PATCHes control |
| `app/api/business-os/account-profile/__tests__/route.test.ts` (new) | G-1 to G-6, P-1 to P-14. P-9 has 20 refused bodies, including name-plus-forbidden-key forms so the refine cannot be what refuses them (added after M-2 survived the first run). P-7, P-13 and the P-9 refusal case assert no value reaches any log line (SA-D2-6) |
| `lib/repositories/__tests__/UserProfileRepository.settingsCard.test.ts` (new) | S-1 to S-3, W-1 to W-5 (plus W-2b, empty name), and the `findById` CR-1 case |
| `lib/repositories/__tests__/UserProfileRepository.updateTimezoneMirror.test.ts` | U-3 asserts the safe projection (fresh `Error`, same `message` / `code`, no `details`; log `{ dbError, userId }`; no row value in the log) |

Not edited (SA-D2-3, SA-D2-11): `adminReadMethods.guard.test.ts`, `userDataExportReads.test.ts`, `timezoneWrite.guard.test.ts`.

### Verification

| Check | Result |
|---|---|
| New + touched tests (route, both repository files, both page guards, greeting guard, `timezoneWrite`, `settingsDeepLinks`, `accountCard`, preferences route) | 9 suites, **204 / 204** pass |
| Must-stay-green set (`app/api/business-os`, `app/business-os/settings`, `lib/repositories/__tests__`, data-export libs and route, admin users / audit-trail, `adminDisplayName`, `AdminHeader`, admin-authz surface, purge no-deletion, audit routes + `lib/audit`, `darkModeTokens`, `journeyReadiness`) | **163 suites, 3758 / 3758** pass |
| Other tests that import `UserProfileRepository` (admin finance and invites routes, `llm-usage` boundaries) | 4 suites, 217 / 217 pass |
| `npm run typecheck:bos-llm` | **passed**: 546 files, 28 errors, **0 new**. It also reports one baseline entry fixed (`app/api/onboarding/build/route.ts` TS18047, `businessProfileRepository`): not touched by D-2, pre-existing on `main` |
| Full `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`) | Exit 2 both runs (the repo's known baseline). **1853 errors before and after; identical by file:line:code; 0 in any touched file.** Caveat: the "before" run started on the clean tree, but my first edits landed while it was still running, so it is not a strictly clean baseline; the "after" run is clean and has 0 errors in every touched file, which is the result that matters |
| ESLint on the 8 touched code files | 0 errors. 2 warnings in `page.tsx`: `supabase` unused (expected, Q-4, D-4 removes it) and the pre-existing `exhaustive-deps` on the load `useEffect` (present on `HEAD`) |
| `npm run lint:hooks` | Passed (`--max-warnings 0`; confirms the unused import does not trip it, Q-4) |
| `console.` in touched files | 0 |
| Entitlements | No import from `lib/business-os/entitlements/`, so `test:bos-entitlements` not required |

### Mutation run

Scratchpad runner: each mutation backs the file up, applies an exact-anchor edit (fails if the anchor is not unique), runs the six D-2 suites with `--json`, restores in `finally` and verifies the SHA-1. ASCII-only output. All three source files' SHA-1s checked against a pre-run snapshot afterwards: OK.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| M-1 | Remove `.strict()` | Killed | P-9 (name + role / avatar_url / id / user_id / userId / timezone / company …) |
| M-2 | Add `avatar_url` to the schema | Killed (2nd run) | P-9 "a name with avatar_url". **First run survived**: `{ avatar_url }` alone is refused by the refine anyway. Fixed by adding name-plus-key cases |
| M-3 | Refine always true | Killed | P-9 `{}` |
| M-4 | No `.trim()` | Killed | P-4, P-6 |
| M-5 | No `.max()` on `full_name` | Killed | P-7 |
| M-6 | Repository spreads the patch | Killed | W-3 |
| M-7 | `id` first in the payload | Killed | W-1, W-2, W-3, W-4 |
| M-8 | `upsert` → `update().eq('id')` | Killed | W-1 |
| M-9 | `.select()` after the upsert | Killed | W-1 |
| M-10 / M-10b | Card columns add `role` / `select('*')` | Killed | S-1 |
| M-11 | `.maybeSingle()` → `.single()` in `findSettingsCard` | Killed (2nd run) | S-1. **First run hit the docstring occurrence** (runner index, not a test gap); re-anchored on `.maybeSingle();` |
| M-12 | GET `null` instead of `''` | Killed | G-2, G-3 |
| M-13 | Audit `details` carries the values | Killed | P-1, P-2, P-3 |
| M-14 | Audit without `.catch` | Killed | P-11 |
| M-15a / M-15b | 500 body carries the database message (PATCH / GET) | Killed | P-10 / G-5 |
| M-16 | `toSafeError` returns the raw error | Killed | U-3, S-3, W-5, `findById` case |
| M-16b | `findById` logs `{ err }` again | Killed | `findById` CR-1 case |
| M-16c | `saveSettingsCard` also logs `err` | Killed | W-5 |
| M-17 | Card path calls `persistTimezone(next.timezone)` (F-24 back) | Killed | A-5, N-3 |
| M-18 / M-18b | PATCH body sends `avatar_url` / `job_title` | Killed | A-4, N-4 |
| M-19 | `loadData` queries `profiles` from the browser | Killed | A-1, A-7 |
| M-20 | Timezone branch also PATCHes the card | Killed | A-6 |
| M-21a | PATCH saves for a body-supplied id | Killed | Greeting guard (b) |
| M-21b | GET reads a query-string id | Killed | G-6 |
| M-22 | Route imports and calls `userPreferencesRepository` | Killed | P-12 |
| M-23 | The 400 branch logs the body (SA-D2-6) | Killed | P-7, P-9 refusal-logging case |
| M-24 | Timezone branch's final `return;` deleted (SA-D2-10) | Killed | A-5, N-5 |

**29 / 29 killed** (two after a fix, recorded above).

### Diff size

`git diff HEAD --numstat` (tracked files): `page.tsx` +64 / −27, `UserProfileRepository.ts` +127 / −12, greeting guard +34 / −4, U-3 test +11 / −4, requirement +8 / −2 (TL's C-18 amendment, already in the tree before D-2, plus the §0.2 line and Change History row below). New: route 174, route test ~365, page guard 237, repository test 191 lines. **Shrinkage:** the 27 lines removed from `page.tsx` are the browser `profiles` select (P-1), the browser upsert and its error block (P-6), the old F-24 `if (next.timezone) persistTimezone(…)` block, the "Not gated on the profile row" comment (re-worded: it named `.single()`, which is gone) and the `profileRes` lines (renamed `card`); the 12 in the repository are the old header (rewritten) and the four `{ err }` catch lines (CR-1). Nothing else shrank, and no file lost content beyond these.

### Deviations from the plan

1. **`safeParse` instead of `parse` + `catch (ZodError)`** in the PATCH. The 400 branch needs the original `body` to log its top-level key names (SA-D2-6) without ever touching `error.issues`; `safeParse` keeps that in one place. Response shape is the same (`Invalid input` + `details: error.flatten()`).
2. **Extra page-guard checks:** A-6 also asserts the timezone branch does not call `setEditingProfile` (SA-D2-1's "never `setEditingProfile`"); N-5 / N-6 negative controls added for M-24 / M-20.
3. **Extra route cases:** P-9 has name-plus-forbidden-key bodies (needed to kill M-2) and `null` / string bodies; P-7 also asserts the over-long value is not logged.
4. The CR-1 header text names CR-1b inline rather than in a separate section.

### Questions for SA (code review)

1. `toSafeError` is a third copy of the same five lines (invite repository `toError`, `UserPreferencesRepository` inline). Exporting it from `BusinessOsInviteRepository` alongside `safeDbError` would be a small cross-file change; left as is to keep D-2's footprint on files other streams own at zero. Fine to leave, or fold into CR-1b?
2. The GET's repository-error log passes `err: error`, which is already the safe projection (CR-1). Acceptable, or prefer `{ userId }` only?

---

## SA Code Review (2026-10-15)

**Code Review by SA — 2026-10-15**
**Status:** APPROVED. No conditions. Findings CR-D2-1 to CR-D2-3 are Low and do not block commit. Reviewed on the uncommitted tree of `feature/settings-drawer-d2-account-profile` over `origin/main` `8c94767b`.

**Read in full:** `app/api/business-os/account-profile/route.ts` and `__tests__/route.test.ts`, the `UserProfileRepository.ts` diff, the `page.tsx` diff (plus `persistTimezone`, `saveProfile` and the card markup in context), the greeting guard diff, the U-3 edit, `UserProfileRepository.settingsCard.test.ts`, `accountProfile.guard.test.ts`, the requirement diff (§0.2 line, C-18 amendment, F-25), `safeDbError` in `BusinessOsInviteRepository`, and `components/onboarding/hooks/useAvatarUpload.ts` (avatar persistence).

### Verification against SA-D2-1 to SA-D2-11 and the brief

| Check | Result |
|---|---|
| Session-only id (C-23) | PASS. Both handlers use `getUser()` only; no query string read; both repository calls receive `user.id` (G-6, P-9 `id` / `user_id` / `userId`, greeting guard (b)) |
| `.strict()` + forbidden keys | PASS. `role`, `avatar_url`, `id`, `user_id`, `userId`, `timezone`, `timezone_confirmed_at`, `company` are 400 both alone and **with a name** (so the refine cannot be what refuses them). `null`, number, array, string and `null` bodies are 400 |
| ≥ 1 field, limits, trim, echo | PASS. Refine refuses `{}`; 120 / 100 with the L-1 fact in the comment (SA-D2-4); `.trim()` precedes `.max()` (P-6 exact limit with outer spaces passes, P-7 one over refuses); 200 echoes `parsed.data` (only sent keys, trimmed; Q-7) |
| Response bodies | PASS. 401 `Unauthorized`; 400 `Invalid JSON body` / `Invalid input` + `flatten()` (messages and key names only, as ruled in the workplan review; no submitted values); 500 repository paths are fixed strings with no `details`; the catch-all 500 carries `details` in development only |
| 400 logging (deviation 1, SA-D2-6) | PASS. `safeParse` accepted: it keeps the body in scope so only `{ userId, fields: <top-level key names> }` is logged, never `issues` / `flatten()` / values. Proven by P-7, the P-9 refusal-logging case, M-23 |
| Audit | PASS. `SETTINGS_PROFILE_UPDATED`, `entityType: 'user'`, `details: { fields }`, no `changes`; `.catch` non-blocking (P-11, M-14); only on success; none on GET or on failure |
| Repository write | PASS. Payload built field by field (`typeof === 'string'`), `updated_at` then `id` **last**, `upsert(payload, { onConflict: 'id' })`, no `.select()` (W-1, W-3, M-6..M-9). `EMPTY_PATCH` returns before `from()` (W-4) and logs `warn { userId }` only |
| CR-1 scope (SA-D2-3) | PASS. `safeDbError` / `toSafeError` in exactly `findById`, `updateTimezoneMirror`, `findSettingsCard`, `saveSettingsCard`; the three admin / export reads untouched; `adminReadMethods.guard.test.ts` and `userDataExportReads.test.ts` not edited; header names CR-1b. No circular import (`BusinessOsInviteRepository` does not import this file) |
| `updateTimezoneMirror` (SA-D2-11) | PASS. Its hunk touches only the two catch lines |
| F-24 split (SA-D2-1, SA-D2-10) | PASS. Timezone branch calls only `persistTimezone(zone)`, never the route and never `setEditingProfile`, and ends with its own `return;` (A-5, A-6, N-5, M-24). Card path never calls `persistTimezone` and PATCHes exactly `JSON.stringify({ full_name: next.full_name })` (A-4, N-4; no `avatar_url`, `job_title`, timezone, role, id) |
| `persistTimezone` byte-identical | PASS. No diff hunk inside it |
| `loadData` | PASS. Profile half is a GET of the route with each field `typeof v === 'string' ? v : ''` (the SA optimisation, no cast); the `allSettled` timezone half is untouched; a failed card read yields `null` → `''` without blanking the timezone (C-13) |
| Avatar flow until D-3 | PASS. `useAvatarUpload` still persists `avatar_url` itself (browser `update`, D-3's scope); the card no longer re-sends it, so behaviour is unchanged for accounts with a row. RK-2 (one account, no row) is handed to D-3 (F-25 / SA-D2-8) |
| Unused `supabase` import | Left for D-4 as ruled (Q-4); `lint:hooks` unaffected |
| Logging / `console.*` / entitlements | PASS. Pino `createLogger` + `child({ correlationId })`; 0 `console.*` in the three source files; no import from `lib/business-os/entitlements/` |
| Re-run by SA | D-2 + adjacent set: **9 suites, 204 / 204**. Must-stay-green (`app/api/business-os`, `app/business-os/settings`, `lib/repositories/__tests__`, `lib/audit`, `lib/business-os/data-export`, admin users / audit-trail): **154 suites, 3431 / 3431** |

### Code Review Comments

1. **CR-D2-1** `app/api/business-os/account-profile/route.ts` `topLevelKeys` — the refused-body log records every top-level key name, unbounded. An authenticated caller can send a body with very many (or very long) keys and inflate one log line, and a key name can itself be free text. Not a value leak under SA-D2-6 (keys only) and bounded by the platform body limit. Optional hardening: cap to the first ~20 keys and truncate each to ~64 characters. — Priority: Low (not a condition)
2. **CR-D2-2** `app/business-os/settings/page.tsx` `saveProfile` — after a failed card GET the name field is `''`, and Save would store an empty name. Pre-existing and already narrower than the old upsert (which also blanked avatar and job title); in the workplan review's optimisation list. Carry with F-25 when the card markup is next opened. — Priority: Low (not a condition)
3. **CR-D2-3** `lib/repositories/UserProfileRepository.ts` `toSafeError` — third copy of the same five lines (see the Q-1 ruling). — Priority: Low (not a condition)

### Rulings on the Dev questions

| Q | Ruling |
|---|---|
| Q-1 (`toSafeError` copy) | **Leave it in D-2; fold into CR-1b.** When CR-1b lands, export the invite repository's `toError` under a clear name (e.g. `toSafeDbError`) next to `safeDbError` and replace all three copies (`UserProfileRepository`, `UserPreferencesRepository` inline, invite repository). Keeping D-2's footprint off files other streams own is the right trade today |
| Q-2 (GET logs `{ userId, err }`) | **Keep it.** `err` is already the CR-1 projection (an `Error` with `message` + `code` only, no `details` / `hint`), and `{ err }` is the logging standard's error key, so the serializer and log search behave as everywhere else. Dropping it would lose the SQLSTATE needed to diagnose a read failure |

### Optimisation Suggestions

- CR-D2-1's key cap, if the route is touched again.
- The "card did not load" guard on Save (CR-D2-2), together with F-25.

### Code Approved for QA: Yes

Approved for QA and, on QA's pass, for RM commit + PR under the user's standing rule (2026-10-15). No further SA pass is needed unless QA requires a code change.

---

## QA Report (2026-10-15)

**QA — 2026-10-15**
**Test mode:** full
**Strategy used:** A + B (Jest: route integration with a mocked repository, repository unit tests with a recording client, page source guards), plus an independent mutation run. D (manual browser) not run: no browser or test account in this session.
**Focus:** api, ui (source level), security, schema
**Skipped:** Manual Q1–Q16 (NOT RUN, listed below for TL / the user). No production query was made.
**Input source:** prompt keywords (TL brief)
**Verdict:** **PASS WITH NOTES** (no bug; two Low edge cases in the page that only manual QA covers)

### 1. Independent re-run

| Set | Dev | QA |
|---|---|---|
| D-2 + adjacent (route, both repository files, `accountProfile`, `timezoneWrite`, `settingsDeepLinks`, `accountCard`, greeting guard, preferences route) | 9 suites, 204 / 204 | **9 suites, 204 / 204** |
| Must-stay-green (`app/api/business-os`, `app/business-os/settings`, `lib/repositories/__tests__`, data-export lib + route, admin users / audit-trail, `adminDisplayName`, `AdminHeader`, admin-authz surface, purge no-deletion, audit routes, `lib/audit`, `darkModeTokens`, `journeyReadiness`) | 163 suites, 3758 / 3758 | **163 suites, 3761 / 3761**, 0 failed. Same suite count; the +3 tests come from path-pattern differences in the invocation, not from D-2 |

Other: 0 `console.` in the three source files; no import from `lib/business-os/entitlements/` (so `test:bos-entitlements` not required); `useAvatarUpload.ts`, `AvatarUpload.tsx` and `app/api/business-os/my-day/route.ts` are not in the diff.

### 2. Mutation run (QA, 23 new mutations beyond Dev's 29)

Scratchpad runner: unique-anchor edit (skips if the anchor is not unique), the six D-2 suites with `--json`, restore in `finally`, SHA-1 check per mutation. After the run all three source files matched the pre-run SHA-1 and `git diff --numstat` was identical to the baseline. (The workplan's SHA changed during the run because SA's code review was appended in parallel, not by QA.)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| Q-1 | `findSettingsCard` `.eq('id', userId)` → another id | Killed | S-1 |
| Q-2 | `onConflict: 'id'` → `'full_name'` | Killed | W-1 |
| Q-3 | `payload.id = patch.id ?? userId` (caller id wins) | Killed | W-3 |
| Q-4 | `role` slips through the repository allow-list | Killed | W-3 |
| Q-5 | `EMPTY_PATCH` guard never fires (query runs on `{}`) | Killed | W-4 |
| Q-6 | `findById` returns the raw error (loses `toSafeError`) | Killed | `findById` CR-1 case |
| Q-7 | Route schema accepts `role` | Killed | P-9 (name + role), P-9 refusal-logging |
| Q-8 | `full_name` limit off by one (+1) | Killed | P-7 |
| Q-9 | `job_title` limit off by one (−1) | Killed | P-6 |
| Q-10 | `.trim()` removed from `job_title` only | Killed | P-4, P-6 |
| Q-11 | PATCH saves for `?user_id=` from the query string | Killed | Greeting guard (b) only (source match; see EC-3) |
| Q-12 | Audit action → `PROFILE_UPDATED` | Killed | P-1 |
| Q-13 | PATCH 500 body carries `details: error.message` | Killed | P-10 |
| Q-14 | Refine `||` → `&&` (one field no longer enough) | Killed | P-1, P-2, P-5, P-10 |
| Q-15 | GET returns `null` for a missing `avatar_url` | Killed | G-2, G-3 |
| Q-16 | GET reads `?user_id=` from the query string | Killed | G-6 |
| Q-17 | Card path PATCHes `/preferences` with the timezone directly (bypassing `persistTimezone`) | Killed | A-5 |
| Q-18 | Card path calls `persistTimezone(profile.timezone)` | Killed | A-5, N-3 |
| Q-19 | Timezone branch closes the editor | Killed | A-6 |
| Q-20 | Card fetch method `PATCH` → `PUT` | Killed | A-4, greeting guard (a) |
| Q-21 | Card path no longer writes the stored (trimmed) name back to state | **Survived** | none (EC-2) |
| Q-22 | Card path's failure branch loses its `return;` (a failed save closes the editor and shows "Saved") | **Survived** | none (EC-1) |
| Q-23 | Timezone branch also PATCHes the card with `profile.full_name` | Killed | A-6 |

**21 / 23 killed.** Both survivors are page behaviour below the source-guard level SA accepted in Q-8; neither is a defect in the current code.

### 3. Code-level paths (Jest; each test read and exercised by the mutations above)

| Area | Case | Result |
|---|---|---|
| GET | row / no row / NULL columns / 401 / DB error (no DB message in body) / query id ignored | Pass (G-1..G-6; Q-15, Q-16) |
| PATCH | name only / job title only / both / trimmed / at limit incl. outer spaces / limit + 1 for each field / empty `{}` | Pass (P-1..P-7, P-9; Q-8..Q-10, Q-14) |
| PATCH | each forbidden key alone **and** with a valid name (`role`, `avatar_url`, `id`, `user_id`, `userId`, `timezone`, `timezone_confirmed_at`, `company`), `null` / number name, array / string / `null` body, non-JSON | Pass, all 400, no save, no audit (P-9; Q-7) |
| PATCH | 401; DB error (500, no DB message, no audit); audit rejection still 200 | Pass (P-8, P-10, P-11; Q-13) |
| No values in logs / audit | happy, 400 (over-length, forbidden key), 500 | Pass (P-1, P-7, P-9 refusal-logging, P-13) |
| Repository | allow-list, `id` last, upsert on `id`, no `.select()`, `EMPTY_PATCH` with no query, safe error projection | Pass (S-1..S-3, W-1..W-5; Q-1..Q-6) |
| F-24 | Name save: card path has no `persistTimezone` and no `timezone`, PATCH body is `{ full_name }` only; the route imports no preferences repository and no mirror, so `timezone_confirmed_at` cannot change. Timezone pick: the branch calls only `persistTimezone(zone)`, ends with `return;`, never PATCHes the card, never calls `setEditingProfile` (editor stays open) | Pass (A-4..A-6, N-3..N-6, P-12; Q-17..Q-19, Q-23) |
| Greeting / My Day | My Day still reads `full_name` via `userProfileRepository.findById(user.id)` (route unchanged); greeting guard (a)(b)(c) green | Pass |
| Avatar flow | `useAvatarUpload.ts` / `AvatarUpload.tsx` untouched; the PATCH body cannot carry `avatar_url` (A-4) and the schema refuses it (P-9) | Pass at source level; Q7–Q9 manual NOT RUN |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None. One GET on load (replacing one browser select), one PATCH per Save.

#### Edge Cases (nice to fix; all Low)
1. **EC-1 (Q-22 survived)**: `page.tsx` `saveProfile`. Nothing pins the card path's failure `return;`. Without it, a failed save would close the editor and show "Saved". The code is correct today, and only manual Q12 covers it. Suggest one source-guard assertion (the `!res.ok` block ends with `return;`) when the file is next opened (D-3 / D-4).
2. **EC-2 (Q-21 survived)**: the trimmed-name write-back (Q-7 ruling) is unpinned. Losing it would only show untrimmed text until reload. Manual Q10 covers it.
3. **EC-3 (Q-11)**: no behavioural PATCH test with a query-string id; only the greeting guard's source match on `saveSettingsCard(user.id` kills it. Low, since the route never reads the query today. A one-line P-test mirroring G-6 would close it.
4. Already recorded by SA, not re-raised: CR-D2-1 (unbounded refused-key logging), CR-D2-2 (empty-name save after a failed GET), CR-D2-3 (`toSafeError` copy).

### Manual QA: NOT RUN (no browser, no test account in this session)

| # | What a human must check (test account; desktop + phone; EN + HE) |
|---|---|
| Q1 | Edit the name → Save: "Saved", the card shows it, it survives a reload, My Day greets the new first name |
| Q2 | Page-load Network tab: one `GET /api/business-os/account-profile`, no `…/rest/v1/profiles` from the page |
| Q3 | Save Network tab: one `PATCH /api/business-os/account-profile`, body exactly `{"full_name":"…"}`, **no** `/preferences` request |
| Q4 | F-24: on an unconfirmed-timezone test account, a name Save leaves "Set your timezone" and the My Day nudge in place. Otherwise use Q3's evidence plus TL's read-only `timezone_confirmed_at` before/after (SA-D2-7, no production write) |
| Q5 | Timezone pick: one `PATCH /preferences` `{"timezone":"…"}`, no account-profile request, publish gate clears |
| Q6 | Type a name, pick a timezone without Save: the zone saves, the name does not (reload), the editor stays open |
| Q7–Q9 | Avatar: upload in view mode persists; upload + name Save keeps both and the body has no `avatar_url`; a removed avatar stays removed after a name Save |
| Q10 | Hebrew name, emoji name, outer spaces trimmed after reload (also covers EC-2) |
| Q11 | An existing job title is unchanged after a name Save |
| Q12 | Offline Save: red error, nothing saved, the editor stays open (also covers EC-1) |
| Q13 | Signed-out `curl` GET and PATCH: 401 both |
| Q14 | Signed-in PATCH `{"role":"admin"}`, `{"avatar_url":"x"}`, `{"user_id":"<other>"}`, `{"timezone":"UTC"}`, `{}`: 400 each, nothing changes; record how the signed-in requests were made |
| Q15 | Signed in, a 121-character name: 400 |
| Q16 | `/admin` audit trail: one `SETTINGS_PROFILE_UPDATED` per Save, field names only |

### Edge cases closed (Dev, 2026-10-16)

Test files only; no production file changed. Source SHA-1s before and after the mutation run: `UserProfileRepository.ts` `77c1c207…`, `account-profile/route.ts` `94df7c95…`, `settings/page.tsx` `d4e9ca52…`, unchanged; `git diff --numstat` identical before and after.

| Edge case | Test added | File | QA mutation | Result |
|---|---|---|---|---|
| EC-1 | **A-9**: in the comment-stripped card path, the `if (!res.ok …)` block shows the error, ends with `return;`, does not close the editor or show "Saved", and both `setEditingProfile(false)` and the "Saved" message come after the block. Negative controls **N-7** (the block without `return;`) and **N-8** (a block that closes the editor; "Saved" set before the check) | `app/business-os/settings/__tests__/accountProfile.guard.test.ts` | Q-22 | **Killed** (A-9, N-7, N-8) |
| EC-2 | **A-10**: after the failure block, the card path calls `setProfile(p => ({ ...p, full_name: X }))` before the editor closes, and `X` is assigned from `payload.data?.full_name` (the server's trimmed value), not the name the page sent. Negative control **N-9** (no write-back; a write-back of `next.full_name`) | same | Q-21 | **Killed** (A-10, N-9) |
| EC-3 | **P-15**: a PATCH to `…/account-profile?user_id=<other>&id=<other>&userId=<other>` is a 200 that calls `saveSettingsCard` once, with the session id only; no call argument contains the other id; the audit's `userId` and `entityId` are the session id (the PATCH twin of G-6) | `app/api/business-os/account-profile/__tests__/route.test.ts` | Q-11 | **Killed** (P-15, plus the greeting guard's existing source match) |

**Re-run:** D-2 set 9 suites, **210 / 210** (204 + 6 new). Must-stay-green: 236 suites, **5427 / 5427**, 0 failed (a superset of QA's 163-suite invocation: the path patterns matched more admin and audit suites). `eslint` on both touched test files: exit 0. 0 `console.` in either. QA's mutation tally is now **23 / 23 killed**.

### Live manual QA by TL (2026-10-16)

Run by TL in the in-app browser against the dev server on this worktree (port 3005), signed in as the walla TEST account. Database state read back **read-only** from production; no production write other than the two name saves made through the page itself.

| # | Result | Evidence |
|---|---|---|
| Q1–Q3 | **PASS** | The card loads via `GET /api/business-os/account-profile` (response keys `full_name`, `avatar_url`, `job_title`); no `rest/v1/profiles` request from the page. Saving "Barak Walla QA" sent one `PATCH /api/business-os/account-profile` → 200; "Profile updated successfully!" shown; no `/preferences` PATCH. DB `full_name` read back updated. The name was then restored to "Barak Walla" |
| Q4 (F-24) | **PASS** via the SA-D2-7 fallback | `timezone_confirmed_at` was `2026-10-15 19:40:13.72+00` before and after both name saves; `job_title` unchanged (`''`); avatar kept |
| Q13–Q15 | **PASS** | Signed-out GET and PATCH → 401. Signed-in PATCH with `{role:'admin'}`, `{full_name, role}`, `{full_name, avatar_url}`, `{full_name, user_id:<other>}`, `{full_name, timezone}`, `{}`, and a 121-character name → 400 "Invalid input" each; a non-JSON body → 400 "Invalid JSON body" |
| Q5–Q12, Q16 | **NOT RUN** | Q5/Q6 (timezone pick) were re-verified in D-1. Q7–Q9 (avatar), Q10 (Hebrew/emoji/trim; EC-2 now pinned at source level by A-10), Q11 (existing job title; Q4 shows `job_title` unchanged on this account), Q12 (offline Save; EC-1 now pinned by A-9) and Q16 (audit trail) remain for the user |

### Final Status
- [x] Every acceptance criterion that can be verified in code passes, and no High or Medium issue is open. Ready for commit from QA's side (code level)
- [x] EC-1, EC-2, EC-3 closed with tests (2026-10-16)
- [ ] Manual QA: Q1–Q4 and Q13–Q15 PASS (TL, 2026-10-16); Q7–Q12 and Q16 still owed (Q5/Q6 covered by D-1)

---

## Commit Info

*(RM populates. No commit until the user has seen the diff.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | Dev workplan for D-2 on `feature/settings-drawer-d2-account-profile` (from the D-1 branch `06ceab3b`, PR #421), verified against `page.tsx` at `e0c49f1f`. Route contract (`GET` + strict `PATCH { full_name?, job_title? }`), `findSettingsCard` / `saveSettingsCard` (allow-list, `id` last, upsert on `id`), CR-1 `safeDbError` across `UserProfileRepository`, page changes and the F-24 split (the card's Save never sends a timezone; recommended: the timezone row saves only the timezone). Live checks L-1 to L-5 for the user. Questions Q-1 to Q-9 for SA. No code |
| 2026-10-15 | SA workplan review | APPROVED WITH CONDITIONS SA-D2-1 to SA-D2-11. Live checks L-1 to L-5 (run read-only by TL) recorded, all PASS; L-3 = 1 account without a row. Rulings: Q-1 (b), C-18 amended in the requirement; Q-2 `{ full_name }` only; Q-3 CR-1 narrowed to `findById`, `updateTimezoneMirror` and the two new methods (CR-1b follow-up for the other three; cross-stream test files untouched); Q-4 import left for D-4; Q-5 no `maxLength`; Q-6 `entityType: 'user'`; Q-7 echo yes; Q-8 source guards; Q-9 moot, limits 120 / 100 final. Upsert confirmed over update-then-insert; role guard and `'UTC'` default safe. RK-2 accepted, handed to D-3 (`setAvatarUrl` on a no-row account). Added: no values on the 400 path (M-23), timezone-branch fall-through (M-24), greeting guard on slices, Q4 without a production write |
| 2026-10-15 | Code complete (Dev) | On `origin/main` `8c94767b`. Route `GET` + strict `PATCH`, `findSettingsCard` / `saveSettingsCard`, CR-1 narrowed to `findById`, `updateTimezoneMirror` and the two new methods (CR-1b named), page `loadData` / `saveProfile` with the F-24 split (option (b)); `persistTimezone` byte-identical. Tests 204/204 in the D-2 set, 3758/3758 in the must-stay-green set; `typecheck:bos-llm` 0 new; full `tsc` 0 errors in touched files; `lint:hooks` pass; 29/29 mutations killed (M-2, M-11 after a fix). Not committed. See [Implementation Notes](#implementation-notes) |
| 2026-10-15 | SA code review | **APPROVED**, no conditions. SA-D2-1..11 verified in code; deviations 1–3 accepted (`safeParse` keeps the 400 log to key names). Findings CR-D2-1 (cap refused-key logging), CR-D2-2 (empty-name save after a failed GET, with F-25), CR-D2-3 (`toSafeError` copy), all Low. Q-1: leave, fold into CR-1b. Q-2: keep `{ userId, err }`. SA re-run: 204/204 (9 suites) and 3431/3431 (154 suites). See [SA Code Review](#sa-code-review-2026-10-15) |
| 2026-10-15 | QA report | **PASS WITH NOTES.** Re-run: 204/204 (9 suites), must-stay-green 3761/3761 (163 suites). 23 new mutations, 21 killed; survivors Q-21 (trimmed-name write-back) and Q-22 (card failure `return;`) are page behaviour below the source-guard level, recorded as Low edge cases EC-1/EC-2, plus EC-3 (no PATCH query-id behavioural test). No bugs. Manual Q1-Q16 NOT RUN (no browser/account). See [QA Report](#qa-report-2026-10-15) |
| 2026-10-16 | QA gaps closed + TL live manual QA | Test files only. EC-1: A-9 + negative controls N-7/N-8 (card failure branch returns before the editor closes or "Saved" shows); EC-2: A-10 + N-9 (server's trimmed `full_name` written back to state); EC-3: P-15 (PATCH with `?user_id=` writes for the session id only). QA mutations Q-22, Q-21, Q-11 now killed (23/23); source SHA-1s unchanged. D-2 set 210/210 (9 suites); must-stay-green 5427/5427 (236 suites); eslint clean. TL live manual QA on the walla test account (dev server, DB read back read-only): Q1–Q3, Q4 (F-24, `timezone_confirmed_at` unchanged), Q13–Q15 PASS; Q5–Q12, Q16 NOT RUN. See [Edge cases closed](#edge-cases-closed-dev-2026-10-16) and [Live manual QA by TL](#live-manual-qa-by-tl-2026-10-16) |
