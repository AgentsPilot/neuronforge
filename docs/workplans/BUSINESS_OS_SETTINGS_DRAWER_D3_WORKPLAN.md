# Workplan: Business OS Settings Drawer, D-3 + L-1 (Profile picture upload and removal behind `/api/user/avatar`)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.2, §7 F-6 / F-8 / F-14 / F-15 / F-16 / F-25 (D-3 note), §9.1 (A-1 to A-7), §9.3 D-3, §9.4–9.5 L-1, SA Review of §9 ruling 4 and ruling 9, conditions C-13, C-19, C-20, C-21, C-23; D-2 SA condition SA-D2-8 / RK-2 ([D-2 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D2_WORKPLAN.md#conditions))
**Branch:** `feature/settings-drawer-d3-avatar`, created by RM from the D-2 branch at `9d0ab074` (PR #425, open with auto-merge). D-3 extends D-2's `UserProfileRepository` (`safeDbError`, `toSafeError`, the `saveSettingsCard` upsert precedent). Once #425 lands, `origin/main` is **merged** in (not rebased, no stash), so the review diff shows D-3 only.
**Path:** Full cycle (new route, file uploads, a **public** storage bucket, a service-role delete driven by a value the browser can still write): workplan → SA workplan review → Dev → SA code review + QA → user sees the diff → RM. The user merges.
**Date:** 2026-10-16
**Status:** **SA code review APPROVED, QA PASS WITH NOTES (E-1..E-3 closed); committed + PR opened with auto-merge by RM 2026-10-16. Manual checks (U-5 / SA-D3-11) waived pre-merge by the user 2026-10-16 ("let's skip the tests for now, tell me what to test and i will do so after deployment"); the user runs Q1-Q13 incl. Q13 after deploy; D-3a is applied by TL only after those post-deploy checks pass.** Earlier: Code Complete 2026-10-16. SA workplan review 2026-10-16: APPROVED WITH CONDITIONS (SA-D3-1 to SA-D3-12), all applied (see [Implementation Notes](#implementation-notes-2026-10-16)). User decisions U-1 to U-5 recorded in the requirement's Change History. Built on `origin/main` `067c4a3e` (D-2 #425 merged). Next: SA code review + QA (manual checks on `/business-os/settings` per U-5), then the user sees the diff. The bucket-policy fix is a separate slice, D-3a, which runs after D-3 is deployed (SA-D3-1). **No migration and no storage-policy change in this PR.**

## Overview

The profile-picture hook `useAvatarUpload` talks to Supabase from the browser seven times: it reads and writes `profiles.avatar_url` (A-1, A-4, A-5, A-7) and uploads to and removes from the public `avatars` storage bucket (A-2, A-3, A-6). That breaks CLAUDE.md rule 1, accepts any `image/*` including SVG into a public bucket (F-16), and its Remove deletes `avatars/<file>` while uploads live at the bucket root, so a removed picture stays publicly reachable (F-8). It also logs with `console.error`, once as a full `JSON.stringify` dump (L-1).

D-3 moves all of it server-side behind `POST` and `DELETE /api/user/avatar` (C-19). The route checks the file's real type from its first bytes (PNG, JPEG, WebP, GIF only; SVG refused), caps it at 4 MB, stores it at `<userId>/<uuid>.<ext>`, and deletes an old file **only** after an ownership check on the stored URL (C-20). The hook keeps its public shape and calls the route; its three `console.error` calls become Pino (L-1). The three screens that render the picture (`/business-os/settings`, `/settings`, `/v2/settings`) need no change.

**Code verified against:** worktree HEAD `9d0ab074`. `components/onboarding/hooks/useAvatarUpload.ts` and `components/ui/AvatarUpload.tsx` last changed at `50392fbd` (2026-06-18). `app/business-os/settings/page.tsx` at `62c277a8` (D-2). `components/settings/ProfileTab.tsx` / `components/v2/settings/ProfileTabV2.tsx` at `8a681295`. `lib/repositories/UserProfileRepository.ts` at `62c277a8`. Locations are by symbol, not line (C-13).

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Schema, Storage and Live Checks](#schema-storage-and-live-checks)
3. [Implementation Approach](#implementation-approach)
4. [Route Contract](#route-contract)
5. [Storage Paths and the Ownership Check (C-20)](#storage-paths-and-the-ownership-check-c-20)
6. [Repository Methods](#repository-methods)
7. [Hook Changes and L-1](#hook-changes-and-l-1)
8. [The Three Consumers](#the-three-consumers)
9. [Audit and Logging](#audit-and-logging)
10. [Files to Create / Modify](#files-to-create--modify)
11. [Task List](#task-list)
12. [Test Plan](#test-plan)
13. [Mutation Candidates](#mutation-candidates)
14. [Manual QA Checklist](#manual-qa-checklist)
15. [Risks](#risks)
16. [Rollback](#rollback)
17. [Questions for SA](#questions-for-sa)
18. [SA Review Notes](#sa-review-notes)
19. [Implementation Notes (2026-10-16)](#implementation-notes-2026-10-16)
20. [QA Testing Report](#qa-testing-report)
21. [Commit Info](#commit-info)
22. [Change History](#change-history)

---

## Analysis Summary

**Today's hook (`useAvatarUpload.ts`, `50392fbd`):**

| # | Function | Call | Problem |
|---|---|---|---|
| A-1 | `uploadAvatar` | `profiles` select `avatar_url` `.single()` | Browser DB read (rule 1). Error discarded |
| A-2 | `uploadAvatar` | storage `avatars` `remove([last URL segment])` | Runs **before** the upload: a failed upload leaves the profile pointing at a deleted file. Takes the last segment of *any* URL, so a stored URL naming another account's file would ask storage to delete it (only the bucket policy, unknown, stands in the way) |
| A-3 | `uploadAvatar` | storage `upload(<userId>-<ts>.<ext from file name>, upsert: true)` + `getPublicUrl` | Extension comes from the file name; type check is `file.type.startsWith('image/')` (client-claimed, SVG allowed, F-16); 5 MB limit that Vercel's 4.5 MB body limit would never let reach a server route |
| A-4 | `uploadAvatar` | `profiles` update `avatar_url` by `id` | Rule 1. An UPDATE: for an account with **no** `profiles` row (live: 1, D-2 L-3) the picture is uploaded and then silently not saved (RK-2 / SA-D2-8) |
| A-5 | `deleteAvatar` | `profiles` select `avatar_url` | Rule 1 |
| A-6 | `deleteAvatar` | storage `remove(['avatars/<file>'])` | Wrong path: files are at the bucket root, so nothing is removed and the picture stays public (**F-8**) |
| A-7 | `deleteAvatar` | `profiles` update `avatar_url: null` | Rule 1 |
| L-1 | both | `console.error` ×3, one `JSON.stringify(error)` | CLAUDE.md Logging |

**Consumers** (all through `components/ui/AvatarUpload.tsx`, which only calls `uploadAvatar` / `deleteAvatar` and reads `uploading` / `error` / `progress`):

| Surface | File | Renders | Writes `avatar_url` itself? |
|---|---|---|---|
| `/business-os/settings` | `app/business-os/settings/page.tsx` (twice: view and edit mode of the profile card) | `onAvatarChange` → page state only | No (D-2 removed it from the card's Save) |
| `/settings` | `components/settings/ProfileTab.tsx` | `onAvatarChange` → form state | **Yes**, its Save upserts `avatar_url` from form state in the browser (F-14, out of scope, frozen by C-13) |
| `/v2/settings` | `components/v2/settings/ProfileTabV2.tsx` | same | **Yes**, same (F-14) |

**Other `avatar_url` writers** (so the stored value is caller-controlled, which is why C-20 exists): `ProfileTab` / `ProfileTabV2` browser upserts (F-14), and `PUT /api/user/profile` (accepts any `avatar_url` string, F-9). Their pages also seed the form with `user.user_metadata.avatar_url` (a Google photo URL) when the account has no profile row, which a Save then stores. **Readers:** `app/(protected)/layout.tsx`, `components/v2/UserMenu.tsx` (browser selects, `<img src>`), D-2's `GET /api/business-os/account-profile`, the data export and the purge descriptor's `profiles` column list. None builds or parses a storage URL. **No other code touches the `avatars` bucket** (`grep "'avatars'"`: only the hook and one `TestAccountCleanupRepository` test fixture).

**Storage precedents in the repo (reused, no new pattern):**
- Server-side upload with the service role, `crypto.randomUUID()` path, remove-the-new-file-if-the-record-fails: `app/api/book/manage/[token]/intake/upload/route.ts` (C-19 names it).
- A `'server-only'` service that owns one bucket, uploads with `supabaseServer.storage` and returns `getPublicUrl`: `lib/services/GeneratedImageService.ts` (`website-images`, also a public bucket).
- A shared client/server constants module for an upload's size and type list: `lib/business-os/intake/types.ts` (`INTAKE_UPLOAD_MAX_BYTES`, `INTAKE_UPLOAD_MIME_TYPES`).
- A delete that refuses any path outside `<userId>/`: `TestAccountCleanupRepository.emptyStorage`.

**Not reusable:** `lib/services/StorageService.ts` is storage *quota* accounting (`ais_system_config`), not files. No magic-byte helper exists in `lib/` (only a PNG-signature assertion inside `lib/email/__tests__/platformBranding.test.ts`), and `file-type` is not a dependency.

---

## Schema, Storage and Live Checks

Per `business-os-schema-check`, against the repo at `9d0ab074`. **I did not query production.**

| Object | Evidence in repo | Confidence | Live check |
|---|---|---|---|
| `profiles.avatar_url` (`text`, nullable, no limit) | D-2 live check L-2 (2026-10-15) | High (measured) | — |
| `profiles` triggers: `profiles_role_privilege_guard` (exempts `service_role`), `update_profiles_updated_at` | D-2 L-4 | High (measured) | — |
| `profiles` PK `(id)`, FK → `auth.users`; only `id` NOT NULL without a default | D-2 L-2 / L-5 | High (measured) | — |
| 1 account with no `profiles` row | D-2 L-3 | High (measured) | — |
| `avatars` bucket exists and is **public** | The hook's `getPublicUrl` URLs render in `<img>` for anyone today | High (implied) | **LC-1** |
| Bucket `file_size_limit`, `allowed_mime_types` | **No DDL in the repo** (the bucket was dashboard-created; only `contact-documents` and `business-purge-snapshots` have migrations) | Unknown | **LC-1** |
| Storage RLS policies for `avatars` | Not in the repo (SA ruling 4 says so) | Unknown | **LC-2** |
| Object layout (root `<userId>-<ts>.<ext>` only?) | SA F-15: "every avatar so far sits at the root" | Medium | **LC-3**, **LC-4** |
| Stored `avatar_url` shapes and the URL origin | Unknown | Unknown | **LC-5** |
| Triggers on `storage.objects` | Unknown (none in repo migrations) | Unknown | **LC-6** |

`npm run schema:check` replays `.select()` calls; D-3 adds one (`avatar_url` on `profiles`, already selected by D-2's `findSettingsCard`). Not run (it queries the live database).

**Live checks for TL (read-only, any SQL editor, before merge).** Every query is a plain `select`. None changes data.

```sql
-- LC-1: the avatars bucket's own settings
select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
from storage.buckets
where id = 'avatars';

-- LC-2: every policy on storage.objects (a policy with no bucket condition applies to avatars too)
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- LC-3: object layout in the bucket
select
  count(*) as total_objects,
  count(*) filter (where name ~ '^[0-9a-f-]{36}-[0-9]+\.[A-Za-z0-9]+$') as legacy_root_matching,
  count(*) filter (where name !~ '/' and name !~ '^[0-9a-f-]{36}-[0-9]+\.[A-Za-z0-9]+$') as root_other,
  count(*) filter (where name ~ '^avatars/') as under_avatars_folder,
  count(*) filter (where name ~ '/' and name !~ '^avatars/') as in_other_folders,
  max((metadata->>'size')::bigint) as largest_bytes,
  count(*) filter (where (metadata->>'size')::bigint > 4194304) as over_4_mb
from storage.objects
where bucket_id = 'avatars';

-- LC-4: stored content types (is any SVG already public?)
select metadata->>'mimetype' as mimetype, count(*) as objects
from storage.objects
where bucket_id = 'avatars'
group by 1
order by 2 desc;

-- LC-5: what profiles.avatar_url holds, and which origin our URLs use
select
  count(*) filter (where coalesce(avatar_url, '') <> '') as with_avatar,
  count(*) filter (where avatar_url like '%/storage/v1/object/public/avatars/%') as in_our_bucket,
  count(*) filter (where coalesce(avatar_url, '') <> ''
                     and avatar_url not like '%/storage/v1/object/public/avatars/%') as external_url,
  count(*) filter (where avatar_url like '%/storage/v1/object/public/avatars/%'
                     and split_part(avatar_url, '/storage/v1/object/public/avatars/', 2) not like (p.id::text || '%')) as names_another_account
from public.profiles p;

select split_part(avatar_url, '/storage/v1/', 1) as url_origin, count(*) as profiles
from public.profiles
where avatar_url like '%/storage/v1/object/public/avatars/%'
group by 1;

-- LC-6: user triggers on storage.objects
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'storage.objects'::regclass and not tgisinternal;

-- LC-7: files no profile points at (orphans from F-8 and earlier replaces; counted, not swept: F-15)
select count(*) as unreferenced_objects
from storage.objects o
where o.bucket_id = 'avatars'
  and not exists (
    select 1 from public.profiles p
    where p.avatar_url like ('%/storage/v1/object/public/avatars/' || o.name)
  );
```

**Reading the results and stop rules:**

| Check | Expected | If not |
|---|---|---|
| LC-1 | `public = true`. `file_size_limit` null or ≥ 4194304. `allowed_mime_types` null or a superset of png/jpeg/webp/gif | `public = false`: stop, back to SA (every stored URL is a public URL; the design assumes it). A size limit below 4 MB: lower `AVATAR_MAX_BYTES` to it. An allow-list missing one of the four: drop that type from ours. **Null on either is the F-16 / RK-1 exposure** for direct browser writes: feeds Q-7 |
| LC-2 | Recorded as found. Of interest: any `INSERT` / `UPDATE` / `DELETE` policy for `authenticated` or `anon` that covers `avatars` (or names no bucket at all) | Such a policy means the browser can still write or delete in the bucket directly after D-3 (D-3 removes **our** browser path, not the bucket's). Not a D-3 blocker; feeds Q-7 (bucket hardening follow-up) |
| LC-3 | `in_other_folders = 0` (D-3 creates the first folder files). `root_other` small | `root_other > 0`: those files are never deleted by Remove (the legacy pattern does not match them; RK-6). `over_4_mb > 0`: existing pictures are unaffected (only new uploads are capped) |
| LC-4 | No `image/svg+xml` | SVG objects present: already-public SVGs are a pre-existing exposure D-3 does not remove; TL records the count, follow-up with Q-7 |
| LC-5 | `names_another_account = 0`. `url_origin` equals the deployment's `NEXT_PUBLIC_SUPABASE_URL` (TL compares; do not paste the env value in a doc) | `names_another_account > 0`: exactly the case C-20 refuses, record it. A **different origin** (e.g. a custom domain): the ownership check would treat every legacy URL as external and never delete them: stop, SA decides whether a second accepted origin is configured |
| LC-6 | Only Supabase's own triggers, or none | A user trigger that writes elsewhere on delete: back to SA |
| LC-7 | Recorded (count only) | Feeds F-15 (purge stream), not D-3 |

**Results:** run read-only on production by TL on 2026-10-16. They are recorded, with SA's reading, in [SA Workplan Review (2026-10-16)](#sa-workplan-review-2026-10-16) → "Live check results". LC-2 found a pre-existing hole in the bucket's policies (F-26). It is closed by a separate slice, **D-3a**, after D-3 is deployed (SA-D3-1).

---

## Implementation Approach

1. **One route, two handlers:** `app/api/user/avatar/route.ts` (`POST`, `DELETE`), built to `new-api-route`: `getUser()`, validation before any business logic, Pino child logger with `correlationId`, non-blocking audit, the standard error format. User-level path because two of the three consumers are agent-platform screens (SA ruling 4). `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`, as every sibling under `app/api/user/`.
2. **Storage in one server-only service:** `lib/services/AvatarService.ts` (`import 'server-only'`), the only code that names the `avatars` bucket. It uploads, removes, builds the public URL and runs the C-20 ownership check. Shape copied from `GeneratedImageService` (service-role `supabaseServer.storage`, `BUCKET` constant, `getPublicUrl`). The service-role reason is in its header: the bucket policies are unknown and unverifiable from the repo, and the delete must be gated by our own ownership check, not by whatever the bucket allows.
3. **Table access through the repository** (rule 1): `UserProfileRepository.findAvatarUrl`, `setAvatarUrl`, `clearAvatarUrl` (C-19 names the first two; the clear is split out so DELETE never goes through an upsert that could create a row).
4. **Shared rules, pure:** `lib/validation/avatar.ts` holds `AVATAR_MAX_BYTES` (4 MB), `AVATAR_MIME_TYPES`, the MIME → extension map and `sniffImageType(bytes)`, with no server import, so the hook's pre-check and the route cannot disagree (the `intake/types.ts` precedent and its "a file the browser offers and the server then refuses" comment).
5. **Content decides the type.** The route reads the first 12 bytes and recognises PNG, JPEG, GIF and WebP signatures. The stored `contentType` and the extension both come from that result, never from the client's `file.type` or the file name. An SVG, HTML, HEIC or anything else is refused whatever it claims to be.
6. **Order (C-19):** POST = validate → read old URL → upload new → set URL (on failure remove the new file) → delete old under C-20 (failure logged, not fatal). DELETE = read old URL → clear URL → delete old under C-20.
7. **Hook:** same public shape, calls the route with `FormData` / `DELETE`, maps the route's error `code` to its own English sentences (the server's text is never shown), Pino via `createLogger({ module: 'useAvatarUpload' })`.
8. **F-6 kept** (stored at pick, SA C-19).

**Rule 7 (new patterns):** none intended. The service, the shared constants file and the server-side upload each copy an existing precedent named above. The only new code with no precedent is `sniffImageType`, a ~20-line pure function; it avoids adding a dependency (`file-type` is ESM-only and would be the first upload-sniffing library in the repo). SA to confirm (Q-9).

---

## Route Contract

### Auth and identity (C-23)

Both handlers call `getUser()` first; `null` → **401** `{ success: false, error: 'Unauthorized', code: 'unauthorized' }` before the body is read. The user id is never read from the body, a form field or the query string. **Any query string** on either method is a **400** `invalid_request` (nothing is read from it, but a request that tries to name an account is refused rather than ignored). DELETE does not read its body.

### `POST /api/user/avatar`

**Request:** `multipart/form-data` with exactly one field, `file`, holding one file. Sent by the hook as `fetch('/api/user/avatar', { method: 'POST', body: formData })` (the browser sets the boundary).

**Validation, in this order (all before any database or storage call):**

| # | Check | Failure |
|---|---|---|
| V-1 | `Content-Type` starts with `multipart/form-data` | 400 `invalid_request` |
| V-2 | `Content-Length`, when present, ≤ `AVATAR_MAX_BYTES + 64 KiB` (multipart overhead). Checked **before** `request.formData()` so an oversize body is not buffered (matters locally; on Vercel the platform refuses > 4.5 MB first, see RK-2) | **413** `file_too_large` |
| V-3 | `request.formData()` parses | 400 `invalid_request` |
| V-4 | Zod: the form's keys are exactly `['file']`, `getAll('file').length === 1`, and the value is a `Blob` with `size > 0` (`z.instanceof(Blob)`, not `File`, which is not a global on every Node the tests run on) | 400 `invalid_request` (extra field such as `userId` or `path`, two files, a string, an empty file) |
| V-5 | `file.size ≤ AVATAR_MAX_BYTES` (4 194 304, exactly 4 MB allowed) | **413** `file_too_large` |
| V-6 | `sniffImageType(first 12 bytes)` returns one of the four types | 400 `file_type` |

**Then:**

1. `userProfileRepository.findAvatarUrl(user.id)`. Error → 500 `save_failed` (nothing uploaded yet, nothing changed).
2. `avatarService.upload(user.id, bytes, sniffedType)` → path `<userId>/<randomUUID>.<ext>`, `contentType: sniffedType`, `cacheControl: '3600'` (today's value), `upsert: false`. Error → 500 `upload_failed`.
3. `userProfileRepository.setAvatarUrl(user.id, publicUrl)`. Error → `avatarService.removeOwnNew(path)` (the path just created; failure logged at error), then 500 `save_failed`.
4. `avatarService.removeIfOwned(user.id, oldUrl)` under C-20. Any failure is logged at warn and does not change the response.
5. Audit (non-blocking), info log, **200** `{ success: true, data: { avatar_url: publicUrl } }`.

**Extension map:** `image/png → png`, `image/jpeg → jpg`, `image/webp → webp`, `image/gif → gif`.

**Magic bytes (`sniffImageType`):**

| Type | Bytes |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` at 0 |
| JPEG | `FF D8 FF` at 0 |
| GIF | `47 49 46 38 37 61` or `47 49 46 38 39 61` (`GIF87a` / `GIF89a`) at 0 |
| WebP | `52 49 46 46` (`RIFF`) at 0 **and** `57 45 42 50` (`WEBP`) at 8 |

Anything shorter than the signature, or matching none, is `null`. SVG (text, `<svg` / `<?xml`) can never match.

### `DELETE /api/user/avatar`

No body, no query. Steps: `findAvatarUrl` (error → 500 `save_failed`) → `clearAvatarUrl` (error → 500 `save_failed`, nothing deleted) → `removeIfOwned(user.id, oldUrl)` (failure logged, not fatal) → audit → **200** `{ success: true, data: { avatar_url: null } }`. With no stored avatar, or no `profiles` row, it is still a 200 (idempotent; nothing removed).

### Responses

| Status | `code` | `error` (client-safe, English) | When |
|---|---|---|---|
| 200 | — | — | Success |
| 400 | `invalid_request` | `Invalid upload` | V-1, V-3, V-4, any query string |
| 400 | `file_type` | `Please choose a PNG, JPEG, WebP or GIF image` | V-6 |
| 401 | `unauthorized` | `Unauthorized` | No session |
| 413 | `file_too_large` | `Image must be 4 MB or smaller` | V-2, V-5 |
| 500 | `upload_failed` | `Could not store the picture` | Storage upload failed |
| 500 | `save_failed` | `Could not save the picture` | Repository read / set / clear failed |
| 500 | `internal` | `Internal server error`, `details` only when `NODE_ENV === 'development'` | Catch-all |

A storage or database message never reaches the client, in any environment. The `code` field follows the intake upload route's precedent (the hook owns the wording).

---

## Storage Paths and the Ownership Check (C-20)

**New objects:** `<userId>/<uuid>.<ext>`, where `uuid` is `crypto.randomUUID()` and `ext` comes from the sniffed type. Every new file sits in the account's own folder, which makes a later per-account sweep possible (F-15).

**`ownedAvatarObjectPath(storedUrl, userId, supabaseUrl): string | null`** (pure, exported from `AvatarService.ts` for its unit test). Returns the object path to delete, or `null` meaning "do not delete":

1. `storedUrl` empty, or `supabaseUrl` (from `process.env.NEXT_PUBLIC_SUPABASE_URL`, read at call time) missing → `null` (fail closed).
2. Parse with `new URL(storedUrl)`; a parse error → `null`. Require `url.origin === new URL(supabaseUrl).origin`.
3. Require `url.pathname` to start with exactly `/storage/v1/object/public/avatars/`. Signed URLs (`/object/sign/…`), transform URLs (`/render/image/…`), and look-alike buckets (`/public/avatars-old/…`) all fail. The query string and fragment are ignored (they do not name a different object).
4. `decodeURIComponent` the remainder (a decode error → `null`). `getPublicUrl` applies `encodeURI`, so the stored form is encoded.
5. Accept **only** these two exact shapes (the user id is the session id, compared as a string prefix, never built into a regex):
   - **Folder form:** `<userId>/` followed by `^[0-9a-f-]{36}\.(png|jpg|webp|gif)$`.
   - **Legacy root form (C-20):** `<userId>-` followed by `^\d+\.[A-Za-z0-9]+$`.
6. Anything else → `null`.

Because both shapes are anchored and the remainder after the user-id prefix admits no `/`, `.` runs or `%`, a stored value such as `…/avatars/<me>/%2E%2E%2F<other>%2Fx.png` or `…/avatars/<me>-1/../<other>-2.png` cannot pass. This is tighter than C-20's wording `<userId>/…` (Q-2): an odd file in the account's own folder is skipped and logged, never deleted.

**`removeIfOwned(userId, storedUrl)`:** if `ownedAvatarObjectPath` returns `null` and the URL was non-empty, log at **info** with a classification only (`external`, `other_account`, `unrecognised_path`), never the URL; no storage call. Otherwise `storage.from('avatars').remove([path])`; an error or a throw is logged at warn as `{ userId, kind: 'folder' | 'legacy', err: <code and message only> }`.

**Old-file cleanup, fixing F-8:**

| Action | Old value | Result |
|---|---|---|
| Replace | Own folder file | Deleted after the new URL is saved |
| Replace | Own legacy root file | Deleted (today's replace already did this; kept) |
| **Remove** | Own legacy root file | **Deleted** (today: `avatars/<file>`, a path that does not exist; **F-8**) |
| Remove | Own folder file | Deleted |
| Either | Google (or any non-bucket) URL | Not touched; info log `external` |
| Either | Another account's file, any form | Not touched; info log `other_account` |
| Either | Unrecognised path in our bucket | Not touched; info log `unrecognised_path` |

Past orphans are **not** swept (F-15; LC-7 counts them).

---

## Repository Methods

Added to `lib/repositories/UserProfileRepository.ts`, following D-2's conventions (service-role client, `.eq('id', userId)` as the `user_id` equivalent, `safeDbError` in the log and `toSafeError` in the result, never throw, no `.select()` after a write). The header gains a D-3 paragraph and the method list.

| Method | Query | No-row behaviour |
|---|---|---|
| `findAvatarUrl(userId): RepositoryResult<string \| null>` | `select('avatar_url').eq('id', userId).maybeSingle()` | `{ data: null, error: null }` |
| `setAvatarUrl(userId, url): RepositoryResult<true>` | Payload built field by field: `{ avatar_url: url, updated_at: now, id: userId }` (`id` **last**), `upsert(payload, { onConflict: 'id' })` | **Creates the row** (SA-D2-8 / RK-2 / F-25 D-3 note). Same reasoning as `saveSettingsCard` (SA-D2-5): the payload is identical on both paths; a created row takes the column defaults exactly like a signup row; the role guard exempts `service_role` and `role` is never in the payload. `url` must be a non-empty string, else an `EMPTY_VALUE` error with no query |
| `clearAvatarUrl(userId): RepositoryResult<true>` | `update({ avatar_url: null, updated_at: now }, { count: 'exact' }).eq('id', userId)` | Count 0 → info log, `{ data: true }`. Never creates a row (nothing to clear) |

Values (URLs) are never logged by any of the three.

---

## Hook Changes and L-1

`components/onboarding/hooks/useAvatarUpload.ts`, rewritten inside its current public shape (C-21):

- **Removed:** the `@/lib/supabaseClient` import and every `.from(` / `.storage` call (A-1 to A-7); all three `console.error`; the `JSON.stringify(error)` dump; the `any` casts in the error mapping.
- **Kept:** `useAuth()` for the `!user` early return (same message, no request); `useCallback(…, [user])`; return `{ uploading, error, progress, uploadAvatar, deleteAvatar }` with the same types.
- **`uploadAvatar(file)`:**
  1. Client pre-check (convenience only; the server decides): `file.type` in `AVATAR_MIME_TYPES`, else `Please choose a PNG, JPEG, WebP or GIF image`; `file.size > AVATAR_MAX_BYTES` → `Image must be 4 MB or smaller` (replaces "less than 5MB"). No request on either.
  2. `uploading: true, progress: 0`; `FormData` with `file` only; `fetch` POST.
  3. Response received → `progress: 50`. Parse JSON defensively (a Vercel 413 is not JSON).
  4. OK with a string `data.avatar_url` → `progress: 100, uploading: false`, return the URL.
  5. Otherwise map by `code`, then by status (413 → too large, 401 → `Please sign in again`), else `Failed to upload the picture`. Return `null`, `progress: 0`.
- **`deleteAvatar()`:** `fetch` DELETE; OK → `true`; else the mapped message and `false`.
- **L-1:** module-level `const logger = createLogger({ module: 'useAvatarUpload' })` (the pattern of `page.tsx`, `PlanSection.tsx`, `InviteFriendsSection.tsx`, `MarketingConsentPanel.tsx`). A thrown `fetch` → `logger.error({ err }, 'Avatar upload request failed')` / `'Avatar removal request failed'`. A non-OK response → `logger.warn({ status, code }, '…refused')`. No file name, URL, size-with-name or server message in any log context (C-21).

---

## The Three Consumers

| File | D-3 change | Why |
|---|---|---|
| `components/ui/AvatarUpload.tsx` | **None planned.** C-13 allows it to change "only for the size limit and its message", but both live in the hook. Narrowing `accept="image/*"` to the four types would help people pick a valid file; it is outside C-13's wording, so it is **Q-6** | Public props, menu, preview and `onAvatarChange` behave as today |
| `app/business-os/settings/page.tsx` | **None.** Frozen beyond D-1/D-2's handlers (C-13) | `onAvatarChange` updates page state; F-6 stays (stored at pick) |
| `components/settings/ProfileTab.tsx` | **None.** Frozen (C-13) | Its browser `profiles` upsert of `avatar_url` and 2 `console.*` are F-14, out of scope |
| `components/v2/settings/ProfileTabV2.tsx` | **None.** Frozen (C-13) | Same (F-14) |

Behaviour each surface sees after D-3: the same control, the same states; a 4 MB limit instead of 5 MB; SVG / HEIC / non-images refused with a clear message; Remove actually deletes the file.

---

## Audit and Logging

**Audit** (non-blocking, `.catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`, no awaited flush: not a WC-7 write), the shape SA ruled for D-2 Q-6 and C-19:

| Handler | `action` | `entityType` / `entityId` / `userId` | `details` |
|---|---|---|---|
| POST | `SETTINGS_PROFILE_UPDATED` | `'user'` / `user.id` / `user.id` | `{ fields: ['avatar_url'], change: 'uploaded' }` |
| DELETE | `SETTINGS_PROFILE_UPDATED` | same | `{ fields: ['avatar_url'], change: 'removed' }` |

No URL, path, file name, size or type in the audit row (`change` is Q-5).

**Route logging:** `createLogger({ module: 'UserAvatarAPI' })`, `logger.child({ correlationId })`. Info on success `{ userId, change, contentType, bytes }` (type and size are not personal; no name or URL). Info on a refused upload `{ userId, code }`. Error on a repository or upload failure `{ userId, err }` (already reduced by the repository; storage errors reduced to `{ code, message }` by the service). **AvatarService:** `createLogger({ service: 'AvatarService' })`.

**`console.*` in touched files:** the hook has 3 (converted, L-1). `AvatarUpload.tsx` 0. The route, service, constants file and repository: 0. No other touched file.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/user/avatar/route.ts` | create | C-19 route (`POST`, `DELETE`) |
| `app/api/user/avatar/__tests__/route.test.ts` | create | Integration test (C-19, C-20, C-23) |
| `lib/services/AvatarService.ts` | create | The only owner of the `avatars` bucket; upload, remove, public URL, `ownedAvatarObjectPath` (C-19, C-20) |
| `lib/services/__tests__/AvatarService.test.ts` | create | Ownership-check table, remove behaviour |
| `lib/validation/avatar.ts` | create | `AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`, extension map, `sniffImageType` (shared by hook and route) |
| `lib/validation/__tests__/avatar.test.ts` | create | Signature table, constants pinned |
| `lib/repositories/UserProfileRepository.ts` | modify | `findAvatarUrl`, `setAvatarUrl`, `clearAvatarUrl`; header paragraph |
| `lib/repositories/__tests__/UserProfileRepository.avatar.test.ts` | create | One test per method, incl. the no-row account |
| `components/onboarding/hooks/useAvatarUpload.ts` | modify | Calls the route; L-1 |
| `components/onboarding/hooks/__tests__/useAvatarUpload.test.tsx` | create | Hook behaviour (jsdom, `renderHook`) |
| `components/onboarding/hooks/__tests__/useAvatarUpload.guard.test.ts` | create | C-21 source guard + route-side guard |
| `components/ui/AvatarUpload.tsx` | modify **only if SA allows Q-6** | `accept` narrowed to the four types |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify (Edit only) | §0.2 D-3 progress line |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D3_WORKPLAN.md` | create | This workplan |

No migration, no new dependency, no new environment variable, no feature flag. No entitlements import (the `business-os-entitlements` skill does not apply). No `lib/business-os/purge/descriptors.ts` change (the bucket is not new; F-15 stays with the purge stream, Q-12).

---

## Task List

- ✅ 1. SA workplan review; apply conditions to this workplan (SA-D3-1..12 applied: see Implementation Notes).
- ✅ 2. TL runs LC-1 to LC-7 (read-only); results recorded in the SA review. No stop rule fired: 4 MB and the four types stand.
- ✅ 3. After #425 merges: `origin/main` merged in (no rebase, no stash). Diff base `067c4a3e`.
- ✅ 4. `lib/validation/avatar.ts` + tests (constants, `sniffImageType`).
- ✅ 5. `UserProfileRepository`: `findAvatarUrl`, `setAvatarUrl`, `clearAvatarUrl`, header; repository tests (incl. the no-row account).
- ✅ 6. `lib/services/AvatarService.ts` (`'server-only'`, upload, `removeOwnNew`, `removeIfOwned`, `ownedAvatarObjectPath`) + tests (incl. SA-D3-3 round trip).
- ✅ 7. `app/api/user/avatar/route.ts` (`POST`, `DELETE`) + integration tests.
- ✅ 8. Rewrite `useAvatarUpload.ts` (route calls, L-1) + hook tests.
- ✅ 9. Source guards (hook; route; picker SA-D3-4; bucket name SA-D3-5), with negative controls.
- ✅ 10. `AvatarUpload.tsx` `accept` = `AVATAR_MIME_TYPES.join(',')` (Q-6 allowed, SA-D3-4): the import + that attribute only.
- ✅ 11. Run: the new test files, the must-stay-green set, `npm run test:bos-entitlements`, `npm run typecheck:bos-llm` (0 new errors), full `tsc` before/after, `npm run lint:hooks`, ESLint on touched files.
- ✅ 12. Mutation run (list below); kills recorded.
- ✅ 13. `git diff --stat` / `--numstat` check (no deletion-only file, no stray file, `.env.local` untracked).
- ✅ 14. Implementation notes here; §0.2 progress line updated; hand to SA code review + QA. **Not committed.**

---

## Test Plan

### New: route (`app/api/user/avatar/__tests__/route.test.ts`)

Mocks: `@/lib/auth` (`getUser`), `@/lib/logger` (one shared logger), `AuditTrailService`, `UserProfileRepository` (`findAvatarUrl`, `setAvatarUrl`, `clearAvatarUrl`), and `@/lib/supabaseServer` (`storage.from('avatars')` → `upload`, `remove`, `getPublicUrl`). `AvatarService` and `lib/validation/avatar.ts` run **real**, so the route tests exercise the ownership check end to end. `process.env.NEXT_PUBLIC_SUPABASE_URL` set in the test. Requests are `new NextRequest(url, { method: 'POST', body: formData })`.

| # | Case | Asserts |
|---|---|---|
| P-1 | Happy PNG | 200, `data.avatar_url` = bucket prefix + `<session>/<uuid>.png`; upload path matches `^<session>/[0-9a-f-]{36}\.png$`, `contentType 'image/png'`, `upsert: false`; `setAvatarUrl(session, url)`; audit `SETTINGS_PROFILE_UPDATED`, `{ fields: ['avatar_url'], change: 'uploaded' }` |
| P-2 | JPEG, WebP, GIF (`it.each`) | Extension `jpg` / `webp` / `gif` and `contentType` from the bytes |
| P-3 | Real PNG named `photo.svg` and declared `image/svg+xml` | Stored as `.png`, `image/png` (name and claim ignored; Q-1) |
| P-4 | **401** signed out | No `formData` read, no repository call, no storage call |
| P-5 | **SVG** (`<svg …>` bytes, declared `image/svg+xml`, named `a.svg`) | 400 `file_type`; no upload |
| P-6 | **Spoofed MIME**: SVG bytes declared `image/png` named `a.png`; HTML bytes declared `image/jpeg`; text declared `image/gif` | 400 `file_type` each; no upload |
| P-7 | **Oversize**: 4 194 305 bytes of valid PNG | 413 `file_too_large`; no upload. Exactly 4 194 304 → 200 (boundary) |
| P-8 | `Content-Length` header over the cap | 413 before `request.formData()` is called (spy) |
| P-9 | No `file`; `file` as a string; two `file` entries; empty file; extra field `userId`; extra field `path`; JSON body; any query string (`?userId=x`) | 400 `invalid_request`; nothing called |
| P-10 | Replace own folder file | `remove([<session>/<old-uuid>.png])` called **after** `setAvatarUrl` (`invocationCallOrder`) |
| P-11 | Replace own legacy root file `<session>-1700000000000.jpg` | Removed |
| P-12 | Replace when stored URL names **another account's** folder file, and another account's legacy file | `remove` never called; info log `other_account`; 200 |
| P-13 | Replace when stored URL is a **Google photo** | `remove` never called; info log `external` |
| P-14 | Traversal and look-alikes: encoded `%2E%2E%2F`, literal `../`, other origin with the same path, `/object/sign/avatars/…`, `/render/image/public/avatars/…`, `/public/avatars-old/…`, `http` vs `https` mismatch | `remove` never called |
| P-15 | `setAvatarUrl` fails | 500 `save_failed`; the **new** path removed; the old file **not** removed; no audit |
| P-16 | Upload fails | 500 `upload_failed`; `setAvatarUrl` not called; nothing removed; storage message not in body |
| P-17 | Old-file remove returns an error / throws | 200; warn logged |
| P-18 | `findAvatarUrl` fails | 500 `save_failed`; **no upload** |
| P-19 | **No `profiles` row** (`findAvatarUrl` → `{ data: null }`) | Upload, `setAvatarUrl` called, 200, no remove (the row creation itself is pinned in the repository test) |
| D-1 | DELETE happy, own folder file | `clearAvatarUrl(session)` then `remove([path])` (order); 200 `{ avatar_url: null }`; audit `change: 'removed'` |
| D-2 | **DELETE own legacy root file (F-8 regression)** | `remove(['<session>-<ts>.<ext>'])`, i.e. the root path, never `avatars/…` |
| D-3 | DELETE when stored URL is another account's file / Google URL | Cleared, **not** removed |
| D-4 | DELETE with nothing stored / no row | 200; no remove |
| D-5 | `clearAvatarUrl` fails | 500 `save_failed`; no remove; no audit |
| D-6 | DELETE signed out | 401; nothing called |
| D-7 | DELETE with `?userId=other` | 400; nothing called |
| G-1 | No URL, path, file name, or storage / DB message in any log call or response, on every path above (serialised logger calls checked for markers) | — |
| G-2 | Catch-all 500: `details` only when `NODE_ENV === 'development'` | — |

### New: AvatarService (`lib/services/__tests__/AvatarService.test.ts`)

`ownedAvatarObjectPath` table: own folder ✓; own legacy ✓; other account folder ✗; other account legacy ✗; own id as a **prefix** of another id (`<session>0…`) ✗; uppercase extension in folder form ✗; `.svg` in folder form ✗; query and fragment ignored ✓; empty / null / malformed URL ✗; missing `NEXT_PUBLIC_SUPABASE_URL` ✗ (fail closed); every P-14 shape ✗. `removeIfOwned` never calls storage for a `null` path. `upload` builds `<userId>/<uuid>.<ext>` and passes `upsert: false`.

### New: shared rules (`lib/validation/__tests__/avatar.test.ts`)

`AVATAR_MAX_BYTES === 4 * 1024 * 1024`; `AVATAR_MIME_TYPES` is exactly the four (no `image/svg+xml`); `sniffImageType` on each signature, on truncated signatures (`RIFF` without `WEBP`, 2-byte JPEG, `GIF8`), on SVG / XML / HTML / empty bytes → `null`.

### New: repository (`lib/repositories/__tests__/UserProfileRepository.avatar.test.ts`)

Same fake-client style as `UserProfileRepository.settingsCard.test.ts`.

| # | Case |
|---|---|
| R-1 | `findAvatarUrl` selects exactly `'avatar_url'`, `.eq('id', userId)`, `.maybeSingle()`; returns the string; no row → `{ data: null, error: null }` |
| R-2 | `setAvatarUrl` calls `upsert` (not `update`) with keys exactly `avatar_url`, `updated_at`, `id` in that order, `id === userId`, `{ onConflict: 'id' }`; no `.select()` |
| R-3 | **No-row account (SA-D2-8):** a fake client whose `update` would match 0 rows: `setAvatarUrl` still stores the URL because it upserts (the call is an `INSERT … ON CONFLICT` with the full payload). Pins that an `update`-only implementation fails this test |
| R-4 | `setAvatarUrl('')` → error, no query |
| R-5 | `clearAvatarUrl` calls `update({ avatar_url: null, updated_at }, { count: 'exact' })`, `.eq('id', userId)`, no `.select()`, never `upsert`; count 0 → `{ data: true }` + info log |
| R-6 | Each method on a PostgREST error with `details: 'Failing row contains (…secret…)'` → returned error and log hold only `code` / `message` |
| R-7 | No URL value in any log call |

### New: hook (`components/onboarding/hooks/__tests__/useAvatarUpload.test.tsx`, `@jest-environment jsdom`)

Mocks `@/components/UserProvider` (`useAuth`), `@/lib/logger`, `global.fetch`.

| # | Case |
|---|---|
| H-1 | Upload posts to `'/api/user/avatar'`, `method: 'POST'`, a `FormData` whose only key is `file`; returns the URL; ends `uploading: false, progress: 100, error: null` |
| H-2 | `image/svg+xml`, `image/heic`, `text/plain` → message, `null`, **no fetch** |
| H-3 | 4 MB + 1 byte → message, no fetch; exactly 4 MB → fetch |
| H-4 | 400 `file_type`, 413 JSON, 413 non-JSON (Vercel), 401, 500 → the mapped sentence each time; the server's `error` text (a marker) never appears in state |
| H-5 | `fetch` throws → generic message; `logger.error` called with `{ err }`; the file name (a marker) appears in no log call |
| H-6 | No user → `'User not authenticated'`, no fetch (unchanged) |
| H-7 | `deleteAvatar` → `method: 'DELETE'`, `true` on 200; `false` + message on 500 |
| H-8 | Return shape keys are exactly `uploading`, `error`, `progress`, `uploadAvatar`, `deleteAvatar` |

### New: source guard (`components/onboarding/hooks/__tests__/useAvatarUpload.guard.test.ts`)

On comment-stripped source (as `greetingUsesTheEditedName` does):
- the hook has no import of `@/lib/supabaseClient` (static, dynamic, `require`, relative `../supabaseClient`; the regex from `anon-default-repositories.guard.test.ts`), no `.from(`, no `.storage`, no `console.`, no `JSON.stringify(`;
- it contains `createLogger({ module: 'useAvatarUpload' })` and `'/api/user/avatar'`;
- `app/api/user/avatar/route.ts` imports neither `@/lib/supabaseServer` nor `@/lib/supabaseClient` and has no `.from(` (storage only via `AvatarService`, table only via the repository);
- negative controls: each matcher fails on a synthetic snippet that has the forbidden shape.

### Must stay green

`app/api/business-os/account-profile/__tests__/route.test.ts`, `app/business-os/settings/__tests__/accountProfile.guard.test.ts`, `greetingUsesTheEditedName.guard.test.ts`, `timezoneWrite.guard.test.ts`, `UserProfileRepository.settingsCard.test.ts`, `adminReadMethods.guard.test.ts`, `userDataExportReads.test.ts`, `anon-default-repositories.guard.test.ts`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (D-3 adds a non-admin route that imports no `AdminAccessService`), `exportClassification.test.ts` and `descriptors.invariant.test.ts` (unchanged descriptors).

---

## Mutation Candidates

Each must be killed by a named test; results recorded in Implementation Notes.

| # | Mutation | Killed by |
|---|---|---|
| M-1 | Accept `image/svg+xml` in `AVATAR_MIME_TYPES` | validation test, P-5 |
| M-2 | Trust `file.type` instead of `sniffImageType` | P-6 |
| M-3 | Extension from the file name | P-3 |
| M-4 | `contentType: file.type` | P-3 |
| M-5 | `>=` instead of `>` on the size limit | P-7 boundary |
| M-6 | Drop the `Content-Length` pre-check | P-8 |
| M-7 | Allow extra form keys | P-9 |
| M-8 | Drop the `WEBP` check at offset 8 | validation test (bare `RIFF`) |
| M-9 | `upsert: true` on upload | P-1 |
| M-10 | Delete the old file **before** `setAvatarUrl` | P-10 order, P-15 |
| M-11 | No cleanup of the new file when `setAvatarUrl` fails | P-15 |
| M-12 | Old-file remove failure returns 500 | P-17 |
| M-13 | Ownership: drop the origin comparison | P-14 (other origin) |
| M-14 | Ownership: `startsWith(userId)` without the `/` or `-` separator | AvatarService "own id as a prefix" |
| M-15 | Ownership: drop the anchored shape regex (accept any `<userId>/…`) | P-14 encoded traversal |
| M-16 | Ownership: skip `decodeURIComponent` | P-10 (encoded stored URL fixture) |
| M-17 | DELETE removes `avatars/<file>` (today's F-8 bug) | D-2 |
| M-18 | DELETE removes before clearing | D-1 order, D-5 |
| M-19 | `setAvatarUrl` as `update().eq()` | R-2, R-3 |
| M-20 | `setAvatarUrl` payload with `id` first and a spread | R-2 |
| M-21 | `clearAvatarUrl` as upsert | R-5 |
| M-22 | Route reads a `userId` form field | P-9 |
| M-23 | Route logs the stored URL in the skip log | G-1 |
| M-24 | Route returns the storage error message | P-16, G-1 |
| M-25 | Hook shows `payload.error` from the server | H-4 |
| M-26 | Hook logs `file.name` | H-5 |
| M-27 | Hook re-imports `supabase` | guard |
| M-28 | Missing `NEXT_PUBLIC_SUPABASE_URL` treated as "match anything" | AvatarService fail-closed case |
| M-29 | *(SA-D3-3)* The ownership check reads a different base (`SUPABASE_URL`; M-29b a hard-coded origin) | AvatarService round trip (a) |
| M-30 | *(SA-D3-4)* `accept="image/*"` in `AvatarUpload.tsx` | Source guard |
| M-31 | *(SA-D3-5, added by Dev)* A second non-test file names the `avatars` bucket | Source guard |
| M-32 | *(SA-D3-6, added by Dev)* An unparsable `Content-Length` treated as too large | Route "unparsable Content-Length" case |

---

## Manual QA Checklist

C-21: QA records each item on **all three** surfaces: `/business-os/settings` (profile card, view and edit mode), `/settings` (Profile tab), `/v2/settings` (Profile tab). Test account only. Files prepared: `ok.png` (~200 KB), `ok.jpg`, `ok.webp`, `ok.gif`, `exact-4mb.png`, `4.1mb.png`, `6mb.jpg`, `icon.svg`, `icon-renamed.png` (an SVG renamed), `notes-renamed.jpg` (a text file renamed), an iPhone `.heic`.

| # | Step | Expect |
|---|---|---|
| Q1 | Upload `ok.png` | Picture shows; DevTools: one `POST /api/user/avatar` 200, **no** request to `*.supabase.co/storage` or `/rest/v1/profiles` from the browser; returned URL contains `/avatars/<userId>/` |
| Q2 | Replace with `ok.jpg`, then `ok.webp`, then `ok.gif` | Each shows; open the previous public URL in a private window → not served (see RK-3 on CDN caching; append `?x=1` to bypass the cache) |
| Q3 | Remove | Initials show; the removed URL is not served; reload keeps it removed |
| Q4 | Upload `exact-4mb.png` | Accepted |
| Q5 | Upload `4.1mb.png` / `6mb.jpg` | "Image must be 4 MB or smaller", no request (client pre-check). Server path: on a preview deployment, a `curl` of 4.1 MB → 413 (local: route 413; Vercel: platform 413, hook shows the same sentence) |
| Q6 | Upload `icon.svg`, `notes-renamed.jpg`, `.heic` | Refused with the type message, no picture change. **Also (SA-D3-4):** the file picker greys out or hides SVG / HEIC where the OS supports it (`accept` is now the four types) |
| Q7 | Upload `icon-renamed.png` (bypasses the client check because the browser says `image/png`) | Server 400 `file_type`, type message |
| Q8 | Signed out: `curl -X DELETE http://localhost:3005/api/user/avatar` and a multipart `curl -X POST` | 401 both |
| Q9 | **Legacy root avatar:** an account whose stored URL is a root `<userId>-<ts>.<ext>` (from LC-5, or one created with the old code on `main` before switching) → Replace, and on another legacy account Remove | The root file is deleted in both cases (its URL stops being served) |
| Q10 | **Google-photo avatar:** an account whose stored URL is a Google URL → Replace | New picture saved; server log shows `external`, no remove attempted; the Google URL still loads |
| Q11 | `/settings` and `/v2/settings`: upload, then press the tab's own Save | Saved URL unchanged (the tab re-writes the same value, F-14) |
| Q12 | Business OS settings in Hebrew, phone width | Control and messages behave as before (English messages, as today) |
| Q13 | **(SA-D3-10)** On a deployment **after merge**, `/business-os/settings`: open the browser's network panel, then upload and remove a picture | No request to `*/storage/v1/object/avatars` and none to `/rest/v1/profiles`; only `POST` / `DELETE /api/user/avatar`. Confirms the old bundle is gone before D-3a removes the policies it relied on |

**Scope per U-5 (user, 2026-10-16):** manual checks on `/business-os/settings` only, run by TL. `/settings` and `/v2/settings` render the same, unchanged `AvatarUpload` + hook and are covered by the automated tests. D-3 auto-merges only after the `/business-os/settings` checks have actually been run (SA-D3-11).

No SQL write to production for any step. Where Q9 / Q10 need a specific account and none exists, QA records "not run" with the reason and TL decides (SA-D2-7 precedent).

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| RK-1 | *(Rewritten per SA-D3-1 with the LC-1 / LC-2 facts.)* **The bucket accepts direct Storage API writes from any signed-in account, today and after D-3** (F-26, pre-existing). LC-2: broad "Users can upload / update / delete avatars" policies (`bucket_id='avatars' AND auth.uid() IS NOT NULL`, role `public`) are OR'd with the owner-scoped ones, so any account can delete or overwrite anyone's picture, or upload any file at any path; two public SELECT policies allow `list()`. LC-1: `file_size_limit` and `allowed_mime_types` are both NULL. D-3 closes **our** code path (F-16 in the product), not the bucket, and depends on none of these policies (service role) | **High, pre-existing** | **Closed by slice D-3a, not by D-3.** D-3a runs after D-3 is deployed to production (today's hook needs the broad INSERT, so it cannot go first): drop all eight `avatars` policies, set `file_size_limit 4194304` and the four types, LC-8 owner pre-check, the eight policy rows captured for rollback, checker on `pg_policies`; TL applies it (U-1), no auto-merge. D-3 itself ships no migration and no bucket or policy change |
| RK-2 | Vercel refuses bodies over 4.5 MB with a non-JSON 413 before the route runs | Low | Client pre-check at 4 MB; the hook maps a non-JSON 413 to the size sentence (H-4) |
| RK-3 | A deleted file can stay served from the CDN for up to `cacheControl` (3600 s) | Low | Recorded for QA (Q2/Q3 use a cache-busting query). File names are unique, so a long cache is otherwise right |
| RK-4 | Two uploads at once (two tabs) can each read the same old URL; the losing upload's file is orphaned | Low | Accepted; no transaction for a profile picture. The orphan is in the account's folder (sweepable later, F-15) |
| RK-5 | `ProfileTab` / `ProfileTabV2` Save writes `avatar_url` from form state; a stale second tab can write back a URL whose file was already deleted (broken image until the next upload) | Low | Pre-existing in kind (today's replace also deletes); F-14 owns those writes |
| RK-6 | Legacy root files that do not match `<userId>-<digits>.<alnum>` (odd names from the old extension-from-file-name logic) are never deleted | Low | Logged `unrecognised_path`; LC-3 `root_other` counts them |
| RK-7 | Polyglot files (a valid GIF/PNG header followed by other content) pass the signature check | Low | Served as `image/*` by our `contentType`, so a browser renders it as an image, not as a page. SVG, the real script vector, can never match |
| RK-8 | The one account with no `profiles` row gets a row created on its first upload | Low (intended) | SA-D2-8; identical to D-2's `saveSettingsCard` behaviour |
| RK-9 | Cross-site request forgery on POST (a multipart form is a "simple" request) | Low | Supabase auth cookies are `SameSite=Lax`, so a cross-site POST carries no session → 401. DELETE needs a preflight. SA to confirm no extra check is wanted |
| RK-10 | No rate limit on an authenticated route that writes to storage | Low | Each upload replaces the previous file, so storage does not grow; Q-8 |

---

## Rollback

Revert the PR. No migration, flag or data change to undo. Rows written by D-3 have the same shape as the old hook's (`avatar_url` = a public URL in the same bucket). After a rollback, the old hook's Replace and Remove would not delete **folder-form** files (its replace removes the last URL segment at the root; its remove uses `avatars/<file>`), so those become orphans in the account's folder: harmless, publicly reachable only by their unguessable UUID URL, and sweepable later (F-15).

**Rollback order once D-3a is applied (SA-D3-1):** roll **D-3a back first** (its rollback script recreates the eight captured policies and clears the bucket limits), **then** revert D-3. Reverting D-3 alone after D-3a breaks profile-picture upload on all three surfaces, because the old hook uploads from the browser at the bucket root and needs the broad INSERT policy that D-3a removed.

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | The client's MIME claim and file name are ignored entirely; the magic bytes decide the type, the extension and the stored `contentType` (so a real PNG declared as `image/svg+xml` is stored as a PNG). Or also require the claim to be in the allow-list? | Bytes only. The claim is attacker-controlled, so requiring it adds no security and refuses mislabelled real photos |
| Q-2 | C-20 says delete if the path is `<userId>/…`. The plan accepts only `<userId>/<uuid>.(png\|jpg\|webp\|gif)` in the folder (plus the legacy root pattern), skipping anything else. Accept the tighter shape? | Yes: it makes traversal and odd paths impossible by construction, and D-3 is the only writer of folder files |
| Q-3 | Status codes: 413 for too large (the intake route uses 400), 400 for type and malformed input, with a `code` in the body | 413: it is the status Vercel itself sends for the same condition, so the hook handles one status |
| Q-4 | `setAvatarUrl` as `upsert(onConflict: 'id')` (SA-D2-5 reasoning) rather than update-then-insert | Upsert: one atomic statement, identical payload on both paths |
| Q-5 | Audit DELETE too, with `details.change: 'uploaded' \| 'removed'` (C-19 names only uploads) | Yes: a removal is a profile change, and `change` holds no personal data |
| Q-6 | `AvatarUpload.tsx` `accept="image/*"` → `"image/png,image/jpeg,image/webp,image/gif"`. C-13 allows only "the size limit and its message", which both live in the hook | Allow it: one attribute, stops the picker offering HEIC/SVG. If not, `AvatarUpload.tsx` has a zero diff |
| Q-7 | Bucket hardening (LC-1/LC-2): a follow-up slice with a migration (`allowed_mime_types`, `file_size_limit`, drop browser write and delete policies on `avatars`), or inside D-3? | Follow-up: D-3 stays code-only; the migration needs the live results and the user to apply it |
| Q-8 | No rate limit (the existing `rateLimit` helper is IP-based and used only on public routes) | None in D-3 |
| Q-9 | Placement: `lib/services/AvatarService.ts` (`'server-only'`, `supabaseServer.storage`, like `GeneratedImageService`) and `lib/validation/avatar.ts` (pure, shared). Storage stays out of `lib/repositories/` (it is not a table), although `BusinessPurgeRepository` / `TestAccountCleanupRepository` do storage inside repositories | As planned; C-19 names "for example `lib/services/AvatarService.ts`" |
| Q-10 | Any query string on POST / DELETE → 400; DELETE never reads its body | Yes (C-23 strictness) |
| Q-11 | The stored URL's query string and fragment are ignored by the ownership check | Yes: they do not change which object is named |
| Q-12 | No `STORAGE_DESCRIPTORS` row for `avatars` in D-3 (not a new bucket; purge/export is F-15's stream) | Confirm |
| Q-13 | Hook messages stay English literals, as today; no translation keys (the control's own labels are English and frozen) | Yes; an i18n pass on `AvatarUpload` is a separate UI task |

---

## SA Review Notes

See [SA Workplan Review (2026-10-16)](#sa-workplan-review-2026-10-16) below.

---

## SA Workplan Review (2026-10-16)

**Reviewed by SA — 2026-10-16**
**Status:** **APPROVED WITH CONDITIONS** (SA-D3-1 to SA-D3-12 below), for the code slice D-3 as planned. Implementation may start once #425 has merged and `origin/main` is merged in (Task 3), **and** the user has answered U-1 to U-5 (end of this review). None of U-1 to U-5 changes D-3's code. They set the order and scope of the work around it. A **separate slice, D-3a** (a storage migration the user applies by hand), is required **after** D-3 is deployed. It closes a pre-existing hole that LC-2 found (F-26).

**Verified against code on `9d0ab074`:** `components/onboarding/hooks/useAvatarUpload.ts` (upload/replace/remove bodies; `remove` error not checked; `upsert: true`), `components/ui/AvatarUpload.tsx` (`accept="image/*"`, `onAvatarChange(null)` on delete), `ProfileTab.tsx` / `ProfileTabV2.tsx` (browser `profiles` upserts of `avatar_url`; V2 also sends `role`), `app/(protected)/settings/page.tsx:125` and `app/v2/settings/page.tsx:105` (seed `avatar_url` from `user_metadata`), `app/api/user/profile/route.ts:113,166`, `supabase/migrations/20261002_profiles_role_privilege_guard.sql` (silent revert of `role`), `lib/supabaseServer.ts` / `lib/supabaseClient.ts` (both use `NEXT_PUBLIC_SUPABASE_URL`), `app/api/website/upload/route.ts`, `components/website/MediaUploader.tsx` and its 8 call sites, `CRMContactDrawerV2.tsx:3853` (signed-URL upload to `contact-documents`, not `avatars`), the storage migrations `20260726_fix_website_images_rls.sql`, `20260916a_purge_snapshots_bucket.sql` (the `42501 must be owner` note), `20261058_contact_documents_accept_scans_and_phone_photos.sql`, skills `new-api-route`, `new-repository`, `tenant-isolation-guard`. A repo-wide grep (`app/ lib/ components/ hooks/ supabase/ scripts/`) finds exactly one writer to the `avatars` bucket by name: the hook. `git log --all -G "website-logos"` finds **no commit, on any branch, that ever named `website-logos`**. `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` equals LC-5's origin. I compared it without printing the value.

### Live check results (run read-only on production by TL, 2026-10-16)

| Check | Result | SA reading |
|---|---|---|
| LC-1 | `avatars` is **public**; `file_size_limit` NULL; `allowed_mime_types` NULL | **PASS** for D-3 (design assumes public; 4 MB and the four types stand). The NULLs are the F-16 / RK-1 exposure at bucket level. D-3a sets them |
| LC-2 | Owner-scoped INSERT / UPDATE / DELETE (`auth.uid()::text = (storage.foldername(name))[1]`) **and** broad "Users can upload / update / delete avatars" (`bucket_id='avatars' AND auth.uid() IS NOT NULL`, role `public`); two duplicate public SELECT policies. `website-images` is owner-scoped | **Pre-existing hole, F-26 (High).** Not a D-3 blocker: D-3 writes with the service role and depends on none of these policies. Ruling below |
| LC-3 | 6 objects: 5 at the root matching `<uuid>-<ts>.<ext>`, `root_other` 0, **1 under `website-logos/`** (SVG, 2.7 KB, 2026-07-26), 0 under `avatars/`, largest 1.6 MB, 0 over 4 MB | **PASS.** RK-6 is empty today (`root_other = 0`). `in_other_folders = 1` is the `website-logos/` object, ruled below. No existing picture is affected by the 4 MB cap |
| LC-4 | jpeg 3, png 1, `image/x-icon` 1, `image/svg+xml` 1 | One public SVG (the `website-logos/` object) and one `.ico` (a legacy root avatar). Ruled below (U-4) |
| LC-5 | 4 profiles with an avatar, all in our bucket, origin `https://jgccgkyhpwirgknnceoh.supabase.co`; 0 external; 0 naming another account | **PASS.** The origin equals `.env.local`. **Production's** Vercel value cannot be read from the repo. It is not a merge gate, because a mismatch fails closed: legacy files are left in place and nothing wrong is deleted. Manual QA Q9 on a deployment proves it (SA-D3-2) |
| LC-6 | Only Supabase's `protect_objects_delete` (statement-level) and `update_objects_updated_at` | **PASS.** Nothing writes elsewhere on delete |
| LC-7 | 2 unreferenced objects | Recorded for F-15. Given LC-3/LC-5 (6 objects, 4 referenced), these are the `website-logos/` SVG and one root legacy file |

### LC-2 ruling: the bucket hole (F-26)

**What is open today, independent of D-3.** Permissive policies are OR'd. The anon key is public, and anyone can sign up for an account. So any signed-in account can call the Storage API directly and:
- **delete any** object in `avatars` (another person's profile picture), or **overwrite** one in place (an upload with `x-upsert` over an existing name: broad INSERT + broad UPDATE). The victim's stored URL then serves the attacker's image.
- **upload anything** at any path: any MIME type (HTML, SVG), any size up to the project's global limit. That is free public hosting on our Supabase domain.
- **list** the bucket. The public SELECT policies allow `list()`, and every legacy object name starts with its owner's user id, so the list enumerates account ids.

**Severity: High in kind, low in current exposure.** It is a cross-account write/delete, so it is High. Today it covers 4 profile pictures, before launch. Nothing private can be read: the bucket is public anyway, and the listing leaks ids, not content.

**Can D-3 ship before it is closed? Yes, and it must ship first.** D-3 does not use, widen or depend on these policies (service role). And **the hole cannot be closed safely before D-3 is deployed:** today's hook uploads at the bucket **root** (`<uuid>-<ts>.<ext>`). For a root name, `storage.foldername(name)` is an empty array, so the owner-scoped INSERT is false. **The broad INSERT is the only policy that lets today's hook upload.** Dropping it first would break profile-picture upload on all three surfaces. D-3 removes the last browser writer, and that is what makes the fix possible.

**The fix: D-3a, its own slice, right after D-3 is deployed to production. Not inside D-3.** D-3 stays a code-only PR that can auto-merge. D-3a is gated on a migration the user applies by hand, so it never auto-merges. D-3a goes further than "drop the broad ones, keep the owner-scoped ones": after D-3 there is **no** legitimate browser writer, so keeping the owner-scoped INSERT/UPDATE/DELETE would only keep a path around D-3's type check (any MIME, any size, in your own folder). Scope:

1. **Drop all eight `avatars` policies on `storage.objects`:** the three broad, the three owner-scoped and both SELECT duplicates. Public URLs keep working without a SELECT policy, because a **public** bucket serves `/object/public/…` without RLS. Only `list()` and authenticated `download()` need SELECT, and no code does either (D-3 and the cleanup runner use the service role). The bucket becomes **service-role write only**, the `business-purge-snapshots` precedent (no policy, checked by an assertion on `pg_policies`).
2. **Bucket limits:** `UPDATE storage.buckets SET file_size_limit = 4194304, allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif'] WHERE id = 'avatars'`. `public` stays `true`. Bucket limits apply to service-role uploads too, so they also cover the other service-role path into this bucket (F-27, below). Existing objects are not touched. Limits apply on upload only.
3. **Pre-check LC-8 (read-only, before writing the migration):** `select tableowner from pg_tables where schemaname = 'storage' and tablename = 'objects';` and `select current_user;` from the SQL editor. `20260916a` recorded `42501 must be owner of table buckets` for DDL on storage tables from the SQL-editor role, whereas `20261058`'s `UPDATE storage.buckets` ran. If the SQL-editor role is not the owner, the **policy drops are done in Dashboard → Storage → Policies** (a runbook step with the exact eight names from LC-2). The migration file then holds only the bucket `UPDATE` plus the assertion. Do not ship a file that fails halfway (`20260916a`'s rule).
4. **Rollback source captured first:** before applying, TL pastes the eight LC-2 rows (`policyname, cmd, roles, qual, with_check`) verbatim into the D-3a workplan. Rollback = recreate exactly those, plus `UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'avatars'`.
5. **Checker (read-only, after apply):** (a) `select count(*) from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'') like '%avatars%' or coalesce(with_check,'') like '%avatars%')` = **0**; (b) the LC-1 query shows `public = true`, `4194304`, the four types; (c) a DO-block assertion in the migration raises if (a) ≠ 0 (the `20260916a` pattern).
6. **Functional QA after apply (test account only):** upload, replace and remove through the app on `/business-os/settings` still work (service role). With the test account's JWT, a direct Storage API `upload` to `avatars/<test-uid>/x.png` → refused, a `remove` of the test account's own object → refused, and anon `list()` → empty. Existing public avatar URLs still load. No write against any other account's object.
7. A static migration test in `supabase/migrations/__tests__/` (repo pattern) pins no `CREATE POLICY … avatars`, the bucket values, and the assertion block. The SQL must not contain the word "into" inside a string literal (the SQL-editor bug).
8. Path: full cycle, small (BA not needed: this ruling is the spec). RM opens the PR with **auto-merge off**. The user applies, runs the checker, then merges.

**Interim option (user decision U-2):** a one-statement stopgap applied now, `drop policy "Users can delete avatars" on storage.objects`. It is safe before D-3: the hook's `remove` result is never checked (`useAvatarUpload.ts`, the replace branch), so uploads keep working and old root files are simply left behind on a replace until D-3. It stops cross-account **deletion** only. Overwrite and arbitrary upload stay open, because dropping the broad UPDATE or INSERT before D-3 risks breaking the hook's `upsert: true` upload, and that cannot be tested without production. The same ownership caveat (LC-8) applies. SA recommendation: **not needed** if D-3 → D-3a lands within days, given 4 pictures before launch. It is the user's call.

### The `website-logos/` object

- **Who writes there: nobody in the repo, now or ever.** No file on any branch names `website-logos` (`git log --all -G`). The only server path that can put a file into `avatars` besides D-3 is `POST /api/website/upload`. It takes **`bucket` and `folder` from the caller's form** and uploads with the service role (F-27). The object is dated 2026-07-26, two days before the Business OS phases 1-3 commit `a6703535` (2026-07-28) that introduced that route and `MediaUploader`. So it was most likely written by pre-commit development code calling that route with `bucket=avatars, folder=website-logos`, or uploaded by hand in the dashboard. No current `MediaUploader` caller passes `bucket` (all default to `website-images`; logos go to `<uid>/logos` or `logos/` in `website-images`).
- **Does D-3 break it? No.** `AvatarService` deletes only a path derived from the caller's own `profiles.avatar_url` under C-20. A `website-logos/…` path never matches either accepted shape, so it is never deleted.
- **Does D-3a break it? Not in repo code.** Policy drops do not affect the service-role route. The MIME allow-list would refuse a future **SVG** logo sent to `avatars` through that route, and that refusal is the intended effect. If an unmerged branch (Offir's) still sends logos to `avatars`, D-3a would refuse SVGs from it. That is why **U-4 asks the user to confirm with Offir** before D-3a.
- **Yes, bucket-level MIME and size limits belong in the fix** (D-3a item 2). They are the only control that also binds the service-role path.

### Existing public SVG and `.ico`

**Leave both in D-3 and D-3a. Record them for cleanup (F-26 (c)).** A public SVG on `*.supabase.co` runs script only in the Supabase project's origin, which holds none of our app's cookies or storage. That is Low. The `.ico` is a legacy root avatar and is likely a current profile picture (LC-5/LC-7). Deleting the SVG is a user decision (U-4). It needs a read-only check first that no website content or `business_profiles` logo field references the URL. That is an F-15 / purge-stream sweep item, never a D-3 code path.

### Rulings on Q-1 to Q-13

| Q | Ruling |
|---|---|
| Q-1 | **Bytes only.** The claimed MIME type and the file name are ignored on the server. The stored `contentType` and extension come from `sniffImageType`. The client pre-check on `file.type` stays (convenience only) |
| Q-2 | **Tighter shape accepted.** Folder form `<userId>/<uuid>.(png\|jpg\|webp\|gif)` and legacy `<userId>-\d+\.[A-Za-z0-9]+`, anchored, with the user id compared as a string prefix. This **narrows C-20** without contradicting it (C-20 says "delete only if", and a narrower set is still inside it). D-3 is the only writer of folder files. The legacy form deletes the `.ico` correctly when its owner replaces it |
| Q-3 | **413** for size (V-2, V-5), **400** for type and malformed input, `code` in the body. Same status as Vercel's own refusal, so the hook handles one case |
| Q-4 | **Upsert on `id`, as planned** (SA-D2-5 reasoning: identical payload on both paths; role guard exempts `service_role`; `role` never in the payload). R-3 pins the no-row account (F-25 D-3 note / SA-D2-8). `clearAvatarUrl` stays a targeted UPDATE with `{ count: 'exact' }`, no `.select()` (PostgREST update + select hazard) |
| Q-5 | **Yes, audit DELETE too**, `details: { fields: ['avatar_url'], change: 'uploaded' \| 'removed' }`, no URL or path. **C-19 amended** in the requirement |
| Q-6 | **Allowed. C-13 amended** for D-3. `AvatarUpload.tsx` may change exactly one thing, its `accept` attribute, which becomes `AVATAR_MIME_TYPES.join(',')` imported from `lib/validation/avatar.ts` (one source; no hand-typed list). Nothing else in that file. Explicit types also make iOS hand over a JPEG rather than HEIC more often (SA-D3-4) |
| Q-7 | **Follow-up slice D-3a, after D-3 is deployed.** It must come after D-3, not with it and not before it (see the LC-2 ruling). Scope is wider than the Dev proposed: all eight `avatars` policies are dropped, not only the browser write ones |
| Q-8 | **No rate limit in D-3.** It is authenticated, each upload deletes the previous file, and after D-3a the bucket caps size and type. Recorded with RK-10 |
| Q-9 | **Placement accepted.** Rule 1 governs **database** access, and storage objects are not rows. `lib/services/AvatarService.ts` (`import 'server-only'`, service-role reason in its header) follows the majority single-bucket precedent (`GeneratedImageService`, `StockImageService`, `ContactDocumentService`). `BusinessPurgeRepository` / `TestAccountCleanupRepository` do storage inside repositories because they are cross-bucket sweepers next to their table deletes, which is not this case. `lib/validation/avatar.ts` (pure, shared by hook and route) follows `intake/types.ts`. `sniffImageType` instead of `file-type`: accepted, no new dependency (rule 7 satisfied) |
| Q-10 | **Yes.** Any query string → 400 on both methods. DELETE never reads a body |
| Q-11 | **Yes.** Query string and fragment of the stored URL are ignored (they do not name another object) |
| Q-12 | **Confirmed: no `STORAGE_DESCRIPTORS` row in D-3.** The `new-api-route` export-classification item applies to a **new** bucket, and `avatars` is not new. It stays with F-15 (purge / export stream), now easier because new files sit under `<userId>/` |
| Q-13 | **Yes**, English literals as today. i18n of `AvatarUpload` is a separate UI task |

### The Dev's "also found" items

| Item | Real? | Recorded |
|---|---|---|
| `PUT /api/user/profile` stores any `avatar_url` string | **Yes** (`route.ts:113`, `:166`; no Zod, F-9) | **F-28.** D-3's C-20 check makes it harmless to storage. It still lets a browser point its own avatar at any URL (tracking pixel, offensive image) |
| `/settings`, `/v2/settings` store the Google photo URL from `user_metadata` | **Yes** (`(protected)/settings/page.tsx:125`, `v2/settings/page.tsx:105`, then the tab's Save upserts it) | **F-28** (same row). Product behaviour, not a bug. C-20 classifies it `external` and never deletes it. Manual QA Q10 covers it |
| `ProfileTabV2` writes `role` | **Yes** (`ProfileTabV2.tsx:205`) | **F-29 (Low).** The role guard (`20261002`) silently restores the old role and raises a `WARNING` on each such save, so it is not exploitable. It is noise and a misleading UI. Fix with F-14 |

### Other checks

| Area | Finding |
|---|---|
| Route contract | Matches C-19, C-23, `new-api-route`. Identity from `getUser()` only. Strict form keys (V-4) reject `userId` / `path` / `bucket` fields. `runtime = 'nodejs'` correct (Buffer, `formData` on large bodies) |
| Tenant isolation | The only caller-supplied value that reaches a service-role effect is the stored `avatar_url`, which the browser can write (F-14, F-28). C-20 is the guard, with tests P-12/P-14/D-3 and mutations M-13 to M-16, M-28. The new object path is built only from the session id + `randomUUID`. No caller id is used. `upsert: false` means the route never overwrites |
| URL round trip | `getPublicUrl` and the ownership check both derive from `NEXT_PUBLIC_SUPABASE_URL` (`supabaseServer.ts:12`), so a URL D-3 writes is a URL D-3 can delete. Not yet pinned by a test (SA-D3-3) |
| Order of effects | POST: read → upload → set (cleanup on failure) → delete old. DELETE: read → clear → delete. Both are correct for C-19. A failed old-file delete leaves an orphan, never a broken profile |
| Error format / logs | No storage or DB message reaches the client in any environment; `details` only in development on the catch-all. No URL, path or file name in logs (G-1) |
| Audit | Non-blocking `.catch`; no awaited flush (not WC-7). Correct |
| CSRF (RK-9) | Accepted with no extra Origin check: the same posture as every cookie-auth POST in the repo. A cross-site multipart POST carries no `SameSite=Lax` cookie, so it gets a 401 |
| Rollback | Correct. Folder-form files would orphan under the old hook. Harmless. **Note:** if D-3a has been applied, rolling back D-3 alone breaks uploads (the old hook needs the broad INSERT). Roll D-3a back first (its rollback script), then D-3 |
| Entitlements / admin / purge | No entitlements import, no admin route, no new bucket or table |
| `console.*` | Hook 3 → Pino (L-1); every other touched file 0. Correct |
| Manual QA scope | C-21 requires all three surfaces. `/settings` and `/v2/settings` are agent-platform screens, and the user has asked not to be sent through agent-platform flows. They render the **same unchanged** `AvatarUpload` + hook as `/business-os/settings`. See U-5 |

### Conditions

1. **SA-D3-1 (order; D-3a).** The D-3 PR contains **no** migration and no bucket or policy change. D-3a (scope above, items 1-8) is its own slice and starts as soon as D-3 is **deployed to production**. If U-2 is approved, the stopgap goes first. Rewrite **RK-1** with the LC-1/LC-2 facts: severity **High, pre-existing**, closed by D-3a, not by D-3. Update the Rollback section with the D-3a-before-D-3 rollback order. TL adds D-3a to requirement §0.2.
2. **SA-D3-2 (live checks).** LC-1 to LC-7 are met for D-3 (table above). TL confirms, without pasting it, that Vercel **Production** `NEXT_PUBLIC_SUPABASE_URL` has the origin LC-5 measured. Not a merge gate (fails closed). Manual QA Q9 on the deployment is the proof.
3. **SA-D3-3 (round-trip test).** `AvatarService.test.ts` adds: (a) the URL `upload` returns for `<uid>/<uuid>.png` (built by the service's own public-URL code over a `getPublicUrl` mock that returns Supabase's real format, `${base}/storage/v1/object/public/avatars/${encodeURI(path)}`) passes through `ownedAvatarObjectPath` back to exactly that path; (b) the same with `NEXT_PUBLIC_SUPABASE_URL` carrying a trailing slash; (c) a legacy fixture shaped like LC-3 (`<uid>-<13 digits>.jpg`, and `.ico`) → deletable for its owner. Mutation **M-29**: the ownership check reads a different base (e.g. a hard-coded origin, or `SUPABASE_URL`) → killed by (a).
4. **SA-D3-4 (Q-6, `AvatarUpload.tsx`).** Its diff is exactly the `accept` attribute = `AVATAR_MIME_TYPES.join(',')` plus that import. The source guard asserts that `AvatarUpload.tsx` contains no `image/*` and no `svg`. Mutation **M-30**: `accept="image/*"` → killed by the guard. Add a manual QA step to Q6: the picker greys out or hides SVG/HEIC where the OS supports it.
5. **SA-D3-5 (bucket-name guard).** The source guard also asserts that, in non-test `.ts`/`.tsx` files under `app/`, `components/`, `lib/`, `hooks/`, the only file naming the `avatars` bucket (`.from('avatars')` / `.from("avatars")` or a `= 'avatars'` constant) is `lib/services/AvatarService.ts`, with a negative control. This keeps D-3a safe: a new browser writer cannot appear unnoticed after the policies are gone. File reads inside the existing Jest job. No added CI time.
6. **SA-D3-6 (Content-Length).** V-2 applies only to a header that parses as a non-negative integer. If the header is absent or does not parse, the request goes on to V-3, and V-5 is the authoritative size check. Test: an unparsable header with a valid small file → 200. A header claiming 100 bytes with a 4 MB + 1 body → 413 from V-5.
7. **SA-D3-7 (Q-5, audit).** DELETE audited as planned. C-19's audit bullet is amended in the requirement (SA, 2026-10-16).
8. **SA-D3-8 (Q-2 narrowing).** Record in the AvatarService header that the accepted shapes are deliberately narrower than C-20's wording, and why (traversal impossible by construction; the only folder writer is D-3). A skipped file is logged with its classification only.
9. **SA-D3-9 (no value on refused paths).** Every 400/413 branch logs at most `{ userId, code }`, never the claimed type, the file name or form keys' values. G-1 runs on P-5, P-6, P-9 with a marker in the file name and in an extra field's value.
10. **SA-D3-10 (Manual QA).** In addition to Q1-Q12: **Q13**, on a deployment after merge, the browser's network panel on `/business-os/settings` shows no request to `*/storage/v1/object/avatars` or `/rest/v1/profiles` during upload or remove. That confirms the old bundle is gone before D-3a removes the policies it relied on. Agent-platform surfaces per U-5.
11. **SA-D3-11 (auto-merge).** D-3 has no migration, so under the standing rule RM may commit and auto-merge after SA code approval and QA's pass, **provided QA's report records the manual items on `/business-os/settings` as run (not "NOT RUN")**, or the user explicitly waives that in U-5. D-3a never auto-merges.
12. **SA-D3-12 (order and merge).** Implementation starts after #425 merges and `origin/main` is merged in (no rebase, no stash). At handover, the diff against `origin/main` shows D-3 only. The D-2 tests listed under "Must stay green" pass unchanged.

### Optimisation suggestions (not conditions)

- `AVATAR_MIME_TYPES` as a `readonly` tuple with a derived `AvatarMimeType` union, so the extension map is checked for completeness by the compiler.
- `sniffImageType` takes a `Uint8Array` view of the first 12 bytes. Read them with `file.slice(0, 12).arrayBuffer()` before reading the whole body, so a type refusal does not buffer 4 MB.
- In the hook, `progress: 50` on response is coarse but honest. Do not fake intermediate values.

### Decisions for the USER (business terms)

| # | Decision | SA recommendation |
|---|---|---|
| **U-1** | **Approve D-3a**: after D-3 is live, a database change you apply by hand. Profile pictures can then **only** be changed through the app, and the picture store refuses anything that is not a PNG, JPEG, WebP or GIF up to 4 MB. Today any signed-in account can delete or replace anyone's profile picture, or store any file there, by calling the storage service directly | **Approve.** It is High in kind. Few pictures are exposed today, but every new sign-up widens it |
| **U-2** | **Stopgap now, or wait for D-3a?** A one-line change applied today that stops cross-account **deletion** of profile pictures (replace and arbitrary uploads stay open until D-3a). Cost: during the few days until D-3, a replaced old picture is left behind instead of deleted | **Optional.** Not needed if D-3 → D-3a happen this week |
| **U-3** | **Schedule F-27 as its own urgent fix.** The website media upload lets any signed-in account choose **which storage area and which folder** its file goes to, including the private client-documents area and another business's folder. It also accepts SVG on the file's own say-so and returns raw storage errors. Separate from the settings work | **High. Schedule next to D-3a.** It is a small server-only fix: only `website-images`, and only under the caller's own folder |
| **U-4** | **The stray SVG logo in the profile-picture store** (and 2 unreferenced files). (a) Ask Offir whether any unmerged work sends website logos to the profile-picture store (D-3a would refuse SVGs from it). (b) Delete the stray SVG now after a read-only "is it used" check, or leave it for the later cleanup sweep (F-15)? | (a) **Yes, before D-3a.** (b) **Leave it** for the sweep. Low risk |
| **U-5** | **Manual testing scope.** The requirement asks for hand checks on all three settings screens, but two are agent-platform screens you asked not to be sent through. They use the same, unchanged picture control. Accept automated tests plus hand checks on the Business OS settings page for those two? And is auto-merge acceptable only once those Business OS hand checks have actually been run? | **Yes to both.** If no one can run the Business OS hand checks before merge, hold the merge |

### Approval

[x] Workplan approved with conditions SA-D3-1 to SA-D3-12. Proceed to implementation after Task 3 and the user's answers to U-1 to U-5. D-3a is required and follows D-3's deployment.

---

## Implementation Notes (2026-10-16)

**Dev, on `feature/settings-drawer-d3-avatar`, `origin/main` `067c4a3e` merged in (D-2 #425 merged). Not committed.**

### Conditions applied

| Condition | Where it is met |
|---|---|
| SA-D3-1 | The diff has **no** migration, bucket or policy change. RK-1 rewritten (High, pre-existing, closed by D-3a). Rollback section has the D-3a-first order. TL adds D-3a to §0.2 |
| SA-D3-2 | TL's (production `NEXT_PUBLIC_SUPABASE_URL` origin, not a merge gate). Manual Q9 on the deployment is the proof |
| SA-D3-3 | `AvatarService.test.ts` "SA-D3-3: round trip": (a) `upload` → its `publicUrl` (over a `getPublicUrl` mock in storage-js's real format) → `ownedAvatarObjectPath` and `removeIfOwned` give back exactly the uploaded path; also through the **real** supabase-js `getPublicUrl` (no network); (b) the env value with a trailing slash, mock and real client; (c) LC-3-shaped legacy `<uid>-<13 digits>.jpg` / `.ico` / `.png`, deletable by the owner only. M-29 (and M-29b) killed by (a) |
| SA-D3-4 | `AvatarUpload.tsx` diff = one import + `accept={AVATAR_MIME_TYPES.join(',')}` (git diff: 2 insertions, 1 deletion). Guard: no `image/*`, no `svg` in the file. M-30 killed. Q6 step added |
| SA-D3-5 | Guard: in non-test `.ts`/`.tsx` under `app/`, `components/`, `lib/`, `hooks/`, only `lib/services/AvatarService.ts` names the bucket (`.from('avatars')` in any quote style, `= 'avatars'`, `bucket: 'avatars'`). Negative controls included. Pure file reads in the existing Jest job. M-31 killed |
| SA-D3-6 | `declaredBodyTooLarge` checks only a header matching `^\d+$`. Tests: unparsable header + small file → 200; header `100` + 4 MB + 1 body → 413 from V-5 (after `formData()`). M-32 killed |
| SA-D3-7 | Both handlers audit `SETTINGS_PROFILE_UPDATED`, `details: { fields: ['avatar_url'], change: 'uploaded' \| 'removed' }`, non-blocking `.catch` |
| SA-D3-8 | `AvatarService.ts` header, "THE SHAPES A DELETE ACCEPTS": deliberately narrower than C-20, and why. Skips log `{ userId, reason }` only |
| SA-D3-9 | Every 400/413 goes through `refuse()`, which logs exactly `{ userId, code }`. G-1 test runs P-5, P-6, P-9 (+ 413) with markers in the file name and in an extra field's value and asserts the exact log objects |
| SA-D3-10 | Q13 added to the Manual QA checklist (post-merge, deployment) |
| SA-D3-11 | RM / TL: auto-merge only after QA records the `/business-os/settings` manual items as run (U-5) |
| SA-D3-12 | Implementation started after #425 merged and `origin/main` was merged in. Must-stay-green D-2 tests pass unchanged |
| D-3 note (F-25 / SA-D2-8) | `setAvatarUrl` upserts on `id`. R-3 uses an in-memory `profiles` table with PostgREST write semantics: an account with no row gets its URL stored; an `update().eq()` implementation (M-19) fails it |

### Decisions and deviations (for SA)

1. **DELETE with nothing stored makes no write.** The plan's steps were read → clear → remove → audit, and "with no stored avatar it is still a 200". The route returns 200 straight away when `findAvatarUrl` gives `null` or `''`: no `clearAvatarUrl` (it would only bump `updated_at`), no remove, **no audit** (nothing changed). D-4 pins it.
2. **`AvatarService` takes an injectable client** (`constructor(supabaseClient?)`, default `supabaseServer`), the repository convention, so its tests need no module mock. A singleton `avatarService` is exported for the route.
3. **`classifyStoredAvatarUrl` is exported** beside `ownedAvatarObjectPath` (the latter wraps it). It returns the skip reason for the info log (`external`, `other_account`, `unrecognised_path`). A missing env value or an unparsable URL is `unrecognised_path`.
4. **The hook guard's import regex is the anon-default one, widened** to `../../lib/supabaseClient`: that guard scans `lib/` (one hop), this one guards a `components/` file. Its negative control caught the gap.
5. **G-1 split:** URL, path, file-name and field-value markers are asserted absent from **every** log call and response; storage / DB message markers are asserted absent from **responses**. `AvatarService` logs a reduced storage error `{ code, message }` server-side, as the plan's logging section says. If SA wants the storage message out of logs too, it is a one-line change in `safeStorageError` callers.
6. **M-3 cannot be written literally:** the service never receives the file name. It is modelled as the route passing a type derived from the name's extension. A new test, **P-3b** (a real JPEG named `photo.png`, declared `image/png`, stored as `.jpg` / `image/jpeg`), kills it. P-3 (named `.svg`) could not, because `.svg` maps to no allowed type.
7. **Extra mutations:** M-29b (hard-coded origin), M-31 (bucket guard), M-32 (Content-Length parse). Plus round-trip (a) also runs the real supabase-js `getPublicUrl`.
8. **A bare `?` is not a query string** (`nextUrl.search` is `''`), so `POST /api/user/avatar?` is a 200. Tested.
9. **Hook pre-check:** a file whose browser type is empty (some HEIC files on desktop) is refused with the type sentence and no request, as H-2 lists. The server would refuse it anyway unless its bytes are an accepted image.
10. **`findAvatarUrl` returns `null` for a non-string column value**, never a cast.

### Verification

| Check | Result |
|---|---|
| New tests: route (66), AvatarService (64), validation (25), repository avatar (14), hook (21), guard (23) | ✅ all pass |
| Must stay green: account-profile route, `accountProfile` / `timezoneWrite` / `accountCard` / `settingsDeepLinks` guards, `greetingUsesTheEditedName`, `UserProfileRepository.settingsCard` / `.updateTimezoneMirror`, `adminReadMethods`, `userDataExportReads`, `anon-default-repositories`, `admin-authz-surface`, `exportClassification`, `descriptors.invariant` | ✅ 20 suites, 724 tests (with the new ones) |
| `npm run test:bos-entitlements` | ✅ 279 suites, 8254 tests |
| `npm run typecheck:bos-llm` | ✅ 546 files, 28 errors, **0 new** (it also reports one baseline entry fixed on `main`, unrelated: `app/api/onboarding/build/route.ts`) |
| Full `tsc` (`NODE_OPTIONS=--max-old-space-size=12288`) before / after, filtered to touched files | Before: 0 errors in touched files. After: 1 (`route.test.ts`, `Uint8Array<ArrayBufferLike>` not a `BlobPart`), fixed; full re-run: 1853 errors repo-wide, equal to the baseline, 0 in touched files. A scoped `tsc` over the 15 touched files: 0 errors. The rest of the repo's errors are unchanged (only TS's own union ordering in two messages differs) |
| ESLint on touched files | ✅ 0 errors. 2 pre-existing warnings on untouched lines of `AvatarUpload.tsx` (unused `User` import, `<img>`) |
| `npm run lint:hooks` | ✅ 0 warnings |
| Mutations | ✅ **33 / 33 killed** by assertions (none by a compile error); targets restored, SHA-1 verified (table below) |

### Mutation results

Runner: one exact-anchor replacement per mutation (anchor must match once), backups in the scratchpad, restore in `finally`, SHA-1 of all 6 targets checked after the run, ASCII-only output.

| # | Killed by |
|---|---|
| M-1 | validation constants (four types, extension map, `isAvatarMimeType`); hook H-2 |
| M-2 | P-2 (bytes decide) and P-6 (spoofed MIME) |
| M-3 | P-3b |
| M-4 | P-2, P-3 |
| M-5 | P-7 boundary (exactly 4 MB) |
| M-6 | P-8 |
| M-7 | P-9 extra field `userId` / `path` / `bucket` |
| M-8 | validation: RIFF without WEBP (WAV), truncated RIFF |
| M-9 | AvatarService upload options; P-1 |
| M-10 | P-10 order; P-15 |
| M-11 | P-15 |
| M-12 | P-17 (error and throw) |
| M-13 | AvatarService: other origin, http vs https, other port |
| M-14 | AvatarService: own id with no separator; own id then digits |
| M-15 | AvatarService: uppercase / svg / odd file in own folder; P-14 |
| M-16 | P-10 encoded stored URL; AvatarService percent-encoded case |
| M-17 | P-10, P-11, D-2 (F-8 regression) |
| M-18 | D-1 order; D-5 |
| M-19 | R-2; R-3 (no-row account) |
| M-20 | R-2 key order |
| M-21 | R-5 (update with count; no row created) |
| M-22 | P-9 extra field `userId`; G-1 refusal logs |
| M-23 | AvatarService skip-log cases (marker); route P-12 / P-13 |
| M-24 | P-16 |
| M-25 | H-4 |
| M-26 | H-5 |
| M-27 | Guard C-21 |
| M-28 | AvatarService fail-closed (pure and through `removeIfOwned`) |
| M-29 | SA-D3-3 round trip (a), (b), (c) |
| M-29b | SA-D3-3 round trip (a), (b), (c) |
| M-30 | Guard SA-D3-4 |
| M-31 | Guard SA-D3-5 |
| M-32 | SA-D3-6 unparsable Content-Length → 200 |

### Diff

| File | Change |
|---|---|
| `app/api/user/avatar/route.ts` | new, 255 lines |
| `app/api/user/avatar/__tests__/route.test.ts` | new, 679 |
| `lib/services/AvatarService.ts` | new, 254 |
| `lib/services/__tests__/AvatarService.test.ts` | new, 344 |
| `lib/validation/avatar.ts` | new, 73 |
| `lib/validation/__tests__/avatar.test.ts` | new, 97 |
| `lib/repositories/__tests__/UserProfileRepository.avatar.test.ts` | new, 247 |
| `components/onboarding/hooks/__tests__/useAvatarUpload.test.tsx` | new, 238 |
| `components/onboarding/hooks/__tests__/useAvatarUpload.guard.test.ts` | new, 173 |
| `lib/repositories/UserProfileRepository.ts` | +98 / -6 (three methods, header) |
| `components/onboarding/hooks/useAvatarUpload.ts` | +94 / -116 |
| `components/ui/AvatarUpload.tsx` | +2 / -1 |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | §0.2 D-3 line + one Change History row (other uncommitted edits in that file are TL's) |
| `docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D3_WORKPLAN.md` | this file (untracked until RM commits) |

**Shrinkage explained:** only `useAvatarUpload.ts` loses more than it gains (-22 net). It is a rewrite inside the same public shape: the 7 browser Supabase calls (A-1 to A-7), the `any` casts in the error mapping, the 3 `console.error` and the `JSON.stringify` dump are gone, replaced by two `fetch` calls and a code-to-sentence map. No file is deletion-only. `.env.local` is untracked and untouched. The working copy reports CRLF for the two pre-existing files; the index is LF and `core.autocrlf` normalises it, so the diff is content-only.

**Note on the scratchpad:** a parallel F-27 session shares the scratchpad directory and overwrote this slice's `mutate.js` on disk while the run was in progress. The running process had already loaded it, the backups were in a separate folder (`mutation-backup/`), and the SHA-1 check passed. The results are in `mutate-out.txt` there.

### Questions for SA

1. Decision 1 (DELETE with nothing stored: no write, no audit). Acceptable?
2. Decision 5: keep the reduced storage `message` in server logs, or log `code` only?
3. The `console.*` rule: no touched file has any left (the hook's 3 converted). No other file was opened for edit.

---

## SA Code Review (2026-10-16)

**Code Review by SA — 2026-10-16**
**Status:** **APPROVED** (no code change required). One Low documentation item (CR-D3-1) for TL/RM at commit time. Informational notes CR-D3-2..4 need no action in D-3.

**Reviewed (uncommitted, worktree `neuronforge-settings-drawers`, base `origin/main` `067c4a3e`):** `app/api/user/avatar/route.ts`, `lib/services/AvatarService.ts`, `lib/validation/avatar.ts`, the `UserProfileRepository.ts` diff, `components/onboarding/hooks/useAvatarUpload.ts` (full rewrite vs `origin/main`), the `AvatarUpload.tsx` diff, all six new test files, the requirement diff. Skills `new-api-route`, `new-repository`, `tenant-isolation-guard`.

### Verification of the points TL asked for

| Point | Result |
|---|---|
| Session-only id | ✅ `getUser()` only (`lib/auth.ts`, the repo's standard). No id read from form, query or body in either handler |
| Auth before body | ✅ `getUser()` is the first statement in both `try` blocks; 401 before `hasQuery`, headers or `formData()` |
| Query string → 400 | ✅ `nextUrl.search.length > 0` on both methods; a bare `?` is `''` (Dev deviation 8, accepted: nothing is named) |
| Content-Length pre-check, then authoritative size | ✅ `^\d+$` only (SA-D3-6), limit 4 MB + 64 KiB, before `formData()`; V-5 `file.size > AVATAR_MAX_BYTES` after parse, exactly 4 MB allowed |
| Exactly one `file` field | ✅ Zod tuples: keys exactly `['file']`, values exactly one non-empty `Blob`. Two files, a string value, an extra `userId`/`path`/`bucket` key all fail |
| Magic bytes decide type/ext/contentType | ✅ `sniffImageType` over the first 12 bytes (read via `slice` before the whole body, per the optimisation note); `contentType` and extension both come from the sniffed type; `file.type` and the name are never read on the server. WebP requires `RIFF`+`WEBP` |
| SVG/HTML refused | ✅ Text can match no signature; P-3/P-6 pin it |
| Path `<userId>/<uuid>.<ext>`, `upsert:false` | ✅ `randomUUID()` + session id; `cacheControl '3600'` |
| POST order and compensation | ✅ read → upload → set (on failure `removeOwnNew`, which itself refuses a path outside `<userId>/`) → `removeIfOwned` → audit. No storage/DB effect before validation completes |
| `ownedAvatarObjectPath` strictness | ✅ Fails closed on missing env / user id / unparsable URL. Origin equality (scheme, host, port) against `new URL(NEXT_PUBLIC_SUPABASE_URL).origin`. Exact `/storage/v1/object/public/avatars/` prefix (rejects `avatars-old`, `sign`, `render`). WHATWG URL already collapses dot-segments (`..`, `%2e%2e`) before the prefix check, then `decodeURIComponent`, then two anchored shapes with the user id as a plain string prefix; the remainders admit no `/`, `%` or `..`. Look-alikes (own id without separator, own id + digits in folder form, uppercase, `.svg`, odd file in own folder) are skipped. Round-trip tests (SA-D3-3) use the real supabase-js `getPublicUrl` |
| `setAvatarUrl` upsert for no-row accounts | ✅ Upsert on `id`, payload `avatar_url`, `updated_at`, `id` last, no `role`, no `.select()`; empty URL refused without a query. R-3 pins the no-row account |
| `clearAvatarUrl` | ✅ UPDATE only, `{ count: 'exact' }`, no `.select()`; count 0 logged at info, no row created |
| No URLs / file names / values in logs or responses | ✅ Route logs `{ userId, code }` on refusals, `{ userId, change, contentType, bytes }` on success; repository logs `safeDbError` + `userId`; service logs `{ userId, reason \| kind, err: {code,message} }`. Responses carry fixed English strings + `code`; `details` only on the catch-all and only in development. Audit `details` carry `fields` + `change` only |
| Generic client errors | ✅ Hook maps by `code`/status to its own sentences; never shows server text; `readBody` survives a non-JSON platform 413 |
| Hook public shape unchanged | ✅ `{ uploading, error, progress, uploadAvatar(file) → string \| null, deleteAvatar() → boolean }`, same `useCallback([user])`, same `!user` early returns as `origin/main` |
| L-1 Pino | ✅ Module-level `createLogger({ module: 'useAvatarUpload' })` (same client pattern as `app/business-os/settings/page.tsx`); 0 `console.*` in every touched file; no `supabaseClient` import left |
| Only `AvatarService` names the bucket | ✅ Repo grep (non-test `app/ lib/ components/ hooks/`): only `AvatarService.ts:63`. SA-D3-5 guard with positive and negative controls |
| No migration | ✅ No file under `supabase/`; no bucket or policy change (SA-D3-1) |
| Standards | ✅ `runtime = 'nodejs'`, correlationId child logger, non-blocking audit `.catch`, `import 'server-only'` on the service, service-role reason documented in both headers, `RepositoryResult` + never-throw in the repository, no `any` |

### Rulings on the Dev's questions

| Q | Ruling |
|---|---|
| **Q-1** (DELETE with nothing stored → 200, no write, no audit) | **Accepted.** Idempotent and truthful: nothing changed, so there is nothing to audit, and skipping `clearAvatarUrl` avoids a meaningless `updated_at` bump. The response is identical to a real removal, so the hook does not branch. D-4 pins it. The workplan's "with no stored avatar … still a 200" is satisfied |
| **Q-2** (reduced storage `message` in server logs) | **Keep `{ code, message }`.** It mirrors the D-1/D-2 `safeDbError` precedent, it stays server-side only (G-1 proves no storage/DB message reaches a response), and after D-3a the storage message is the only way an operator can tell a MIME/size refusal from an RLS or availability failure. Storage API messages are fixed sentences ("The resource already exists", "Object not found", …) and do not echo the object path. If one is ever found to echo a path, reduce to `code` then |
| Q-3 (`console.*`) | Confirmed: 0 in every touched file |

### Code Review Comments

1. **CR-D3-1 — `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` §0.2 D-3 progress line** — still says "built from the D-2 branch … `origin/main` is merged in once #425 lands. No code yet." The Change History row records code complete, but §0 is the master status and now contradicts it. TL/RM: update that line (code complete, SA approved, QA status, PR number) when committing, per the "always update main requirement" rule. — Priority: **Low** (doc; not a code condition)
2. **CR-D3-2 — `AvatarService.classifyStoredAvatarUrl`, base URL with a path** — the check requires the pathname to begin with `/storage/v1/…`. If `NEXT_PUBLIC_SUPABASE_URL` ever carried a path (a reverse proxy such as `https://x.com/supabase`), `getPublicUrl` would produce `/supabase/storage/…` and every old-file delete would be skipped as `external`. That fails **safe** (orphans, never a wrong delete), production uses a bare `*.supabase.co` origin (LC-5), and SA-D3-2 / manual Q9 prove the round trip on the deployment. — Priority: **Info**, no change
3. **CR-D3-3 — concurrent uploads by the same account** — two overlapping POSTs both read the same old URL; the loser's new file ends up orphaned in the account's own folder. Within C-19's "orphan, never a broken profile" contract and reachable by the F-15 per-folder sweep. — Priority: **Info**, no change
4. **CR-D3-4 — V-2 without a Content-Length** (chunked body) — `formData()` buffers before V-5 refuses. Accepted under SA-D3-6; on Vercel the platform's 4.5 MB cap bounds it. — Priority: **Info**, no change

### Optimisation Suggestions

- None blocking. The hook's coarse `progress: 50` remains honest (as advised in the workplan review).

### Tests re-run by SA (2026-10-16)

| Set | Result |
|---|---|
| D-3 suites: route, `AvatarService`, validation, repository avatar, hook, guard | ✅ 6 suites, 213 tests |
| Must stay green: account-profile route, `accountProfile` / `accountCard` / `settingsDeepLinks` / `timezoneWrite` / `greetingUsesTheEditedName` guards, `UserProfileRepository.settingsCard` / `.updateTimezoneMirror`, `adminReadMethods`, `userDataExportReads`, `anon-default-repositories`, `admin-authz-surface`, `exportClassification`, `descriptors.invariant` | ✅ 14 suites, 512 tests |

Mutation results (33/33) and the typecheck/lint figures are the Dev's; not re-run by SA.

### Merge path

Under SA-D3-11: RM may commit and auto-merge once QA passes **and** QA's report records the `/business-os/settings` manual items as run (U-5), with CR-D3-1 folded into the commit. D-3a remains a separate, manually applied slice after D-3 is deployed, and never auto-merges. Q13 (no browser request to `storage/v1/object/avatars` or `rest/v1/profiles`) must be checked on the deployment **before** D-3a is applied.

### Code Approved for QA: **Yes**

---

## QA Testing Report

### QA Report (2026-10-16)

**QA — 2026-10-16**
**Test mode:** full
**Strategy used:** A + B (Jest unit and route integration, re-run independently), plus 32 new QA mutations and an independent code-level path suite (43 cases, kept in the QA scratchpad, not in the repo). D (manual browser) **not run**: QA has no browser in this session.
**Focus:** api, security, ui (hook), schema (validation)
**Skipped:** Manual Q1–Q13 (see NOT RUN below). `npm run test:bos-entitlements` not needed: the diff imports nothing from `lib/business-os/entitlements/`.
**Input source:** TL trigger prompt + workplan Test Plan / Manual QA Checklist (U-5 scope)
**Worktree state:** code files byte-identical before and after (SHA-1 of route, service, validation, repository, hook, picker); `git diff --numstat` identical to the baseline. The workplan changed during QA only through SA's parallel code-review edit. No production code touched, no production query, nothing committed.

#### Suites re-run

| Set | Result |
|---|---|
| D-3 suites: route 66, `AvatarService` 64, validation 25, repository avatar 14, hook 21, guard 23 | ✅ 6 suites, 213 tests (matches Dev and SA) |
| D-3 suites + must-stay-green (14 suites) | ✅ **20 suites, 725 tests**. Dev recorded 724. SA's 213 + 512 = 725 agrees with QA, so Dev's figure is off by one. Not a defect |
| QA independent path suite (`d3qa.paths.test.ts`, real route + real `AvatarService` + real validation) | ✅ 43 / 43 |

#### Test Coverage

| Acceptance criterion / path | Tested? | Result | Notes |
|---|---|---|---|
| C-19: upload each allowed type (PNG, JPEG, GIF87a, GIF89a, WebP) stored at `<session>/<uuid>.<ext>`, `contentType` from the bytes, `upsert: false`, `cacheControl '3600'` | ✅ | Pass | QA suite: file declared `application/octet-stream` named `.bin`; type and extension still come from the bytes |
| Bytes decide; SVG never accepted (F-16) | ✅ | Pass | SVG declared SVG; SVG with BOM + whitespace declared PNG; HTML as PNG; RIFF/WAVE as WebP; `GIF88a` → 400 `file_type` |
| 4 MB cap | ✅ | Pass | 4 MB + 1 → 413; exactly 4 MB → 200 (Dev P-7, hook H-3) |
| Strict form (C-23) | ✅ | Pass | Empty file, two files, extra `userId`, extra `bucket` sent **before** `file`, `file` as a string, no `file` → 400, no repository or storage call |
| Query string → 400 on both methods | ✅ | Pass | `?userId=…`, `?a`, `?path=x` |
| 401 before anything else | ✅ | Pass | POST, DELETE, and DELETE with `?userId=` signed out → 401 (auth runs before the query check) |
| Replace: own folder file deleted **after** the new URL is saved | ✅ | Pass | `invocationCallOrder` |
| Replace: own legacy root file deleted (`.jpg`, `.ico`) | ✅ | Pass | Root path, never `avatars/…` |
| Replace: foreign / external URL kept | ✅ | Pass | Other account (folder + legacy), Google photo, own id in upper case (fails closed), `%5C` backslash traversal, double-encoded `%252E%252E%252F`, `https://<our-host>@evil.example/…`, our host in another bucket, legacy name + `%00` |
| Remove (F-8 regression) | ✅ | Pass | Own legacy root file removed at the root after the clear; audit `change: 'removed'` |
| Remove: a JSON body naming another account is ignored | ✅ | Pass | Session id only |
| Remove: foreign URL cleared, not deleted; nothing stored → 200, no write, no audit | ✅ | Pass | |
| No-profile-row account (SA-D2-8) | ✅ | Pass | Route: upload + `setAvatarUrl`, 200. Repository R-3 (in-memory table) proves the upsert creates the row |
| DB failure after upload → new file removed, old kept | ✅ | Pass | Also when the compensating remove itself fails: still 500 `save_failed`, no throw |
| Upload failure / clear failure | ✅ | Pass | 500 `upload_failed` / `save_failed`; nothing saved / nothing removed |
| No URL, file name, path or DB/storage text in logs or responses | ✅ | Pass | Markers checked on every QA path. Catch-all in `production`: no `details`, no thrown text |
| Hook: route only, no browser Supabase, Pino (L-1), server text never shown | ✅ | Pass | Dev H-1..H-8 + guard re-run; Q-17/Q-18/Q-22/Q-23 killed |
| Manual Q1–Q13 | ❌ | **NOT RUN** | No browser in the QA session. See below |

#### QA mutations (beyond Dev's 33)

QA runner `d3qa-mutate.js` in its own scratchpad folder (`d3qa-k7q2x9/`), not Dev's `mutate.js`. One mutation at a time, an exact anchor that must match once, backups first, restore in `finally`, SHA-1 of all 5 targets verified after the run (**ALL RESTORED**). Every kill was an assertion failure, none a TypeScript diagnostic.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| Q-1 | Ownership accepts any UUID folder (another account's id) | ✅ Killed | P-12, P-14, D-3, AvatarService "other account folder" |
| Q-2 | Origin check `url.origin.startsWith(ourOrigin)` | ✅ Killed | AvatarService "look-alike host", "other port" |
| Q-3 | Origin check `storedUrl.includes(ourOrigin)` | ✅ Killed | same |
| Q-4 | Legacy regex loosened to `^.*$` | ✅ Killed | "legacy name with letters", "slash after it" |
| Q-5 | Legacy regex without the `$` anchor | ✅ Killed | "legacy name with a slash after it" |
| Q-6 | Folder regex `^.+\.(png\|jpg\|webp\|gif)$` (traversal / odd names) | ✅ Killed | "encoded traversal %2E%2E%2F", "nested path", "odd file" |
| Q-7 | Failed save: compensation runs but a 200 is returned | ✅ Killed | P-15 |
| Q-8 | Failed save also deletes the OLD file | ✅ Killed | P-15 |
| Q-9 | Old file deleted before the upload / save | ✅ Killed | P-10 order, P-15, P-16 |
| Q-10 | Fixed upload path (overwrite, the `upsert: true` effect) | ✅ Killed | AvatarService "two uploads never share a path" |
| Q-11 | GIF89a signature off by one byte (`0x39` → `0x38`) | ✅ Killed | validation GIF89a / GIF88a, P-2 |
| Q-12 | WebP `WEBP` checked at offset 7 | ✅ Killed | validation WebP, P-2 |
| Q-13 | GIF87a dropped | ✅ Killed | validation GIF87a |
| Q-14 | Route size check lets 4 MB + 1 through | ✅ Killed | P-7, SA-D3-6, G-1 |
| Q-15 | Hook size pre-check `>=` (refuses exactly 4 MB) | ✅ Killed | H-3 |
| Q-16 | `setAvatarUrl` upsert with `ignoreDuplicates: true` (an existing row is never updated) | ✅ Killed | R-2 (options pinned exactly) |
| Q-17 | Hook `deleteAvatar` shows the server's `error` text | ✅ Killed | H-7 |
| Q-18 | Hook `uploadAvatar` shows the server's `error` text | ✅ Killed | H-4 |
| Q-19 | DELETE reads its body (`await request.text()`) | ⚠️ **Survived** | No test pins "DELETE never reads its body" (contract, C-23). See E-1 |
| Q-20 | POST audit `details` carry the new URL | ✅ Killed | P-1 |
| Q-21 | DELETE audit `details` carry the old URL | ⚠️ **Survived** | D-1 uses `toMatchObject`, and unlike P-1 has no "details do not contain the URL" check. See E-2 |
| Q-22 | Hook pre-check back to `file.type.startsWith('image/')` | ✅ Killed | H-2 |
| Q-23 | Hook sends an extra `userId` form field | ✅ Killed | H-1 |
| Q-24 | `removeOwnNew` folder guard dropped | ✅ Killed | AvatarService "refuses a path outside the user folder" |
| Q-25 | Query check only for a `userId` param | ✅ Killed | P-9 `?x=1` |
| Q-26 | V-1 (`multipart/form-data` content type) dropped | ⚠️ Survived (equivalent) | V-3 / V-4 still refuse every non-multipart body (JSON fails `formData()`, a urlencoded `file` is a string, not a Blob). No behavioural change, so this is an equivalent mutant, not a gap |
| Q-27 | DELETE with nothing stored still clears and audits | ✅ Killed | D-4 |
| Q-28 | Skip log carries the stored URL | ✅ Killed | AvatarService skip-log cases, P-12 |
| Q-29 | `file_type` refusal logs the file name and claimed type | ✅ Killed | G-1 refusals |
| Q-30 | Query check moved before `getUser()` (signed out + `?x` → 400, not 401) | ⚠️ **Survived** | No test sends a query string while signed out. The QA suite checks it and it passes on the real code. See E-3 |
| Q-31 | `clearAvatarUrl` without the `id` filter | ✅ Killed | R-5, R-6 |
| Q-32 | `findAvatarUrl` with `.single()` (a missing row becomes an error) | ✅ Killed | R-1 |

**Totals:** 32 run: **28 killed**, 1 equivalent (Q-26), 3 survived (Q-19, Q-21, Q-30). All three survivors are test gaps. The production code is correct on each (verified by reading it and by the QA path suite), so none is a Bug.

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **E-1: no test pins "DELETE never reads its body"** (Q-19 survived). File: `app/api/user/avatar/__tests__/route.test.ts`. The route complies today. Fix: a D-case that spies on `request.text` / `json` / `formData` and asserts they are never called. Severity: Low.
2. **E-2: DELETE audit `details` are not pinned exactly** (Q-21 survived). File: `route.test.ts` D-1. Fix: assert `auditLog.mock.calls[0][0].details` with `toEqual({ fields: ['avatar_url'], change: 'removed' })`, or add P-1's "not contain the URL" check. Severity: Low. This is the "audit includes the URL" mutation the TL listed.
3. **E-3: auth-before-query order is not pinned** (Q-30 survived). File: `route.test.ts`. SA's review verified the order by reading the code, but no test fails if it is swapped. Fix: a signed-out request with `?userId=x` expects 401 on both methods. Severity: Low. The only effect of a swap would be a 400 instead of a 401, with nothing read and nothing leaked.
4. **Note (not a defect):** an own-account URL whose user id is in upper case is classified `other_account` and left in place. That fails closed, and Supabase ids are lower case.

### NOT RUN (manual, U-5 scope `/business-os/settings`)

Q1 upload PNG + network panel · Q2 replace jpg/webp/gif + old URL no longer served · Q3 remove · Q4 exact 4 MB · Q5 4.1 MB / 6 MB (client message; server 413 via curl) · Q6 SVG / renamed text / HEIC + picker greys out types · Q7 SVG renamed `.png` → server 400 · Q8 signed-out curl 401 · Q9 legacy root avatar replace/remove (needs a legacy account) · Q10 Google-photo avatar (needs such an account; LC-5 found none) · Q11 `/settings` + `/v2/settings` Save (out of U-5 scope: automated tests only) · Q12 Hebrew + phone width · Q13 post-merge network check on the deployment (SA-D3-10). **Reason:** QA has no browser in this session. TL runs the `/business-os/settings` subset. Under SA-D3-11, auto-merge waits until those are recorded as run.

### Test Outputs / Logs

```text
20 suites: Test Suites: 20 passed, 20 total / Tests: 725 passed, 725 total
QA path suite: Tests: 43 passed, 43 total
Mutations: 28 KILLED, 3 SURVIVED (Q-19, Q-21, Q-30), 1 equivalent (Q-26); SHA check: ALL RESTORED
```

### Final Status

- [x] Automated acceptance criteria pass. No bugs. Three Low test gaps (E-1..E-3) are optional for Dev.
- [ ] Manual Q1–Q13 **NOT RUN**. Under SA-D3-11 / U-5, auto-merge is held until TL records the `/business-os/settings` subset as run.
- [x] **Waiver (user, 2026-10-16):** manual checks waived pre-merge — "let's skip the tests for now, tell me what to test and i will do so after deployment". The user runs the `/business-os/settings` checks incl. Q13 after deploy; D-3a waits for them.

**Verdict: PASS WITH NOTES.**

### QA gap closure (2026-10-16)

**Dev — test file only** (`app/api/user/avatar/__tests__/route.test.ts`, 66 → 70 tests). No production code changed: SHA-1 of route, `AvatarService`, validation, repository and hook identical before and after.

| Gap | Test added | What it pins |
|---|---|---|
| E-1 (Q-19) | D-8 | DELETE with a JSON body naming another account: `json`, `text`, `formData`, `arrayBuffer`, `blob` spied, none called; `bodyUsed` false; session id only |
| E-2 (Q-21) | D-9 | DELETE audit entry pinned with `toEqual` (only `request` split off and checked to be the route's own request); `details` exactly `{ fields: ['avatar_url'], change: 'removed' }`; stored URL, object uuid and `/storage/v1/` absent from the whole entry |
| E-3 (Q-30) | P-4b, D-6b | Signed out with `?userId=<other>` → 401, not 400, on POST and DELETE; no refusal log, nothing called |

**Mutations** (QA's runner copied into Dev's own scratch folder, plus three DELETE-side variants; restore in `finally`, SHA check **ALL RESTORED**): Q-19 killed by D-8; Q-21 killed by D-9; Q-30 (POST) killed by P-4b; Q-30b (DELETE query check before auth) killed by D-6b; Q-19b (DELETE `request.json()`) killed by D-8; Q-21b (DELETE audit carries only the object path) killed by D-9. 6/6 killed, each by exactly one assertion failure, no TS diagnostic.

**Re-run:** D-3 suites 6 suites / **217** tests (213 + 4); D-3 + must-stay-green 20 suites / **729** tests (725 + 4). ESLint on the test file: clean.

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan created | Dev, on `feature/settings-drawer-d3-avatar` at `9d0ab074` (D-2 PR #425 open). Route contract, C-20 ownership check, repository methods incl. the no-row account (SA-D2-8), hook + L-1, tests, 28 mutations, manual QA on three surfaces, live checks LC-1 to LC-7, Q-1 to Q-13. No code |
| 2026-10-16 | SA workplan review | SA: **APPROVED WITH CONDITIONS** SA-D3-1..SA-D3-12. Live checks LC-1..LC-7 (TL, read-only, production) recorded. LC-2 ruling: pre-existing bucket hole F-26 (High), closed by a separate slice **D-3a** (drop all eight `avatars` policies, bucket type/size limits, LC-8 ownership pre-check, rollback captured first, user applies by hand, no auto-merge) **after** D-3 is deployed, because today's hook depends on the broad INSERT. `website-logos/` object: no writer in any commit; the only other service-role path into the bucket is `/api/website/upload` (F-27, High). Q-1..Q-13 ruled (C-13 and C-19 amended in the requirement). Also-found items recorded as F-28, F-29. User decisions U-1..U-5 |
| 2026-10-16 | Code complete (Dev) | On `origin/main` `067c4a3e`. Route, `AvatarService`, `lib/validation/avatar.ts`, three repository methods, hook (L-1), picker `accept`. SA-D3-1..12 applied: RK-1 rewritten, rollback order, Q6 picker step, Q13, U-5 scope; mutations M-29..M-32 (+ M-29b) and test P-3b added. Tests green, 33/33 mutations killed, `typecheck:bos-llm` 0 new. Implementation Notes added. Not committed |
| 2026-10-16 | SA code review | SA: **APPROVED**. All TL verification points met (session-only id, auth first, query → 400, Content-Length then authoritative size, single `file` field, magic bytes decide, upload path + `upsert:false`, POST/DELETE order + compensation, C-20 strictness and fail-closed, no-row upsert, update-only clear, no values in logs/responses, hook shape, L-1, bucket named only in `AvatarService`, no migration). Dev Q-1 accepted (no write/no audit when nothing stored); Q-2 keep reduced `{ code, message }` in server logs. CR-D3-1 (Low, doc): refresh requirement §0.2 D-3 line at commit. CR-D3-2..4 informational. SA re-ran D-3 suites (213 tests) and must-stay-green (14 suites, 512 tests): green |
| 2026-10-16 | QA report | QA: **PASS WITH NOTES**. 20 suites / 725 tests green (Dev's 724 off by one); QA path suite 43/43 (each type, replace / remove, foreign / traversal URLs, no-row account, DB failure compensation, no values in logs or responses). 32 new mutations: 28 killed, 1 equivalent (Q-26), 3 survived (Q-19 DELETE body read, Q-21 DELETE audit URL, Q-30 auth-before-query order). All three are Low test gaps E-1..E-3, not bugs. Manual Q1–Q13 NOT RUN (no browser); TL runs the `/business-os/settings` subset before auto-merge (SA-D3-11) |
| 2026-10-16 | QA gap closure (Dev) | E-1..E-3 closed in `route.test.ts` only (66 → 70): D-8 (DELETE never reads its body), D-9 (DELETE audit pinned exactly, no URL/path), P-4b / D-6b (signed out + query → 401 on both methods). Q-19, Q-21, Q-30 now killed, plus DELETE variants Q-19b, Q-21b, Q-30b (6/6, SHA ALL RESTORED). D-3 suites 217, with must-stay-green 729 (20 suites); ESLint clean. Requirement §0.2 D-3 line refreshed (CR-D3-1). No production code changed, not committed |
