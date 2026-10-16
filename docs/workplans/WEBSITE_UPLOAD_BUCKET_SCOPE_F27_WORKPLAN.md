# Workplan: Website Upload Bucket Scope (F-27)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** F-27 in [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §7 (on branch `feature/settings-drawer-d3-avatar`; not yet on `main`). User decision U-3 (2026-10-16): urgent, its own full-cycle slice.
**Branch:** `fix/website-upload-bucket-scope` (worktree `neuronforge-f27-upload`, cut from `origin/main` at `067c4a3e`)
**Date:** 2026-10-16
**Status:** **SA APPROVED + QA PASS WITH NOTES — committed, PR opened with auto-merge** (2026-10-16). **Manual QA items 1, 4, 5 (SA-F27-9) waived pre-merge by the user on 2026-10-16** ("let's skip the tests for now, tell me what to test and i will do so after deployment") — the user runs them after deployment. SA workplan review: APPROVED WITH CONDITIONS (SA-F27-1 to SA-F27-10), all applied (see [Implementation Notes](#implementation-notes-dev-2026-10-16))

## Overview

`POST /api/website/upload` stores a picture for the website builder. It takes the storage **bucket** and **folder** from the caller's form and uploads with the service role, so Storage RLS does not apply. Any signed-in account can therefore put a file into any bucket whose type list accepts it, including the private `contact-documents` and `avatars` buckets, under any folder, including another account's `<userId>/`. It cannot overwrite an existing file (`upsert: false`). The route also trusts the browser's claimed MIME type (SVG allowed), takes the extension from the file name, and returns raw storage error messages to the client. This slice makes the server decide the bucket, the path, the type and the extension, and makes every client error generic. No migration; no data change.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Decisions](#decisions)
3. [Contract](#contract)
4. [Implementation Approach](#implementation-approach)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Task List](#task-list)
7. [Tests](#tests)
8. [Mutation Candidates](#mutation-candidates)
9. [Manual QA](#manual-qa)
10. [Read-only Live Checks (TL)](#read-only-live-checks-tl)
11. [Risks](#risks)
12. [Rollback](#rollback)
13. [Follow-ups (not in this slice)](#follow-ups-not-in-this-slice)
14. [Questions for SA](#questions-for-sa)
15. [SA Review Notes](#sa-review-notes)
16. [Implementation Notes (Dev, 2026-10-16)](#implementation-notes-dev-2026-10-16)
17. [QA Report (2026-10-16)](#qa-report-2026-10-16)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## Analysis Summary

### The route today (`app/api/website/upload/route.ts`, from `a6703535`, touched by `e9178f0a`)

| Line of behaviour | Today | Problem |
|---|---|---|
| Bucket | `formData.get('bucket') \|\| 'website-images'` | Caller picks any bucket; service role bypasses RLS |
| Folder | `formData.get('folder') \|\| user.id`, interpolated raw into the path | Caller picks any folder, including `<otherUserId>/`; `WebsiteSetupWizard` sends `logos`, so its files sit outside every owner folder |
| Type check | `ALLOWED_TYPES.includes(file.type)` | `file.type` is the browser's claim, attacker-controlled; `image/svg+xml` allowed into a public bucket |
| Stored `contentType` | `file.type` | Same claim, stored as the served type |
| Extension | Last `.` segment of the sanitised file name | Caller-controlled (`x.png.html` stores `.html` under a claimed `image/png`) |
| Size | `file.size > 5 MB` after `request.formData()` buffered everything | Vercel refuses bodies over 4.5 MB first, with a non-JSON 413, so the 5 MB message is never true |
| Errors | `uploadError.message` / `deleteError.message` returned to the client | Raw storage messages in production (CLAUDE.md Security) |
| Logging | `{ fileName, bucket, path }` | `fileName` is a path built from caller input |
| `user_media` row | Written only when `bucket === 'website-images'`; `description: file.name` (unbounded) | Fine once the bucket is fixed; description length unbounded |
| `DELETE` | `bucket` from the query string, `path` must start with `<userId>/` | Caller-chosen bucket on a service-role delete; not cross-account by prefix, but `..` segments are not refused. **No caller in the repo** |
| `section` / `aspect` | Free strings straight to `user_media` | Not validated (the sibling `media/generate` route validates both) |

### Callers (grep `website/upload`)

| Caller | Sends | Reads back |
|---|---|---|
| `components/website/MediaUploader.tsx` (drag-and-drop field) | `file`, `bucket` (always; prop default `website-images`), `folder` (only when set) | `success`, `url`, `error` (shown to the user as-is) |
| `components/website/MediaLibraryPicker.tsx` (picker upload) | `file`, `section` (when set), `aspect` (always: `wide` / `portrait` / `square`) | `success`, `url`, `error` |

`MediaUploader` call sites (8): five in `app/business-os/website/page.tsx` (hero, about, team, gallery, logo_cloud; no `bucket`, no `folder`), `components/website/TestimonialEditor.tsx` (none), `components/business-os/settings/BusinessProfileSection.tsx` (`folder={\`${user?.id || 'shared'}/logos\`}`), `components/business-os/WebsiteSetupWizard.tsx` (`folder="logos"`). **No caller passes a `bucket` prop.** Nobody calls `DELETE`.

### Where website media belongs

`website-images` is the only legitimate bucket. It is public, 5 MB, and its policies are owner-scoped on the first folder segment (`supabase/migrations/20260726_fix_website_images_rls.sql`). Its siblings write there under the owner's folder with the service role: `GeneratedImageService` (`<userId>/generated/<id>.png`) and `StockImageService` (`<userId>/stock/<id>.jpg`), both recording in `user_media`. The purge and export descriptors cover it with `pathPrefix: '{user_id}/'` (`lib/business-os/purge/descriptors.ts`), so a file outside `<userId>/` is invisible to purge, export and account deletion today (the wizard's `logos/` files).

### Precedent for type sniffing

D-3 (unmerged, `feature/settings-drawer-d3-avatar`) adds `lib/validation/avatar.ts` with `sniffImageType(bytes)` for PNG, JPEG, GIF87a/89a and WebP (RIFF + WEBP), SVG refused (F-16), SA ruling Q-1 "bytes only", Q-9 "no new dependency". It is untracked in that worktree today. No magic-byte helper exists on `main`.

### Audit precedent

No `app/api/website/**` route audits, and neither `GeneratedImageService` nor `StockImageService` does. An upload to one's own library is not a WC-7 write (money, access, entitlement, price). `recordRefusedAccess` is the admin-refusal writer with a pinned surface list; it does not fit here.

---

## Decisions

| # | Decision | Why |
|---|---|---|
| DC-1 | **Bucket is a server constant, `website-images`.** The form's `bucket` field, if present, must equal `website-images`; any other value is **rejected** (400 `invalid_request`, warn log, nothing written) | Rejecting rather than ignoring: (a) a stale browser bundle still sends `bucket=website-images`, which stays accepted, so no existing caller breaks; (b) no legitimate caller sends anything else, so the only senders of another value are probes or a future caller that would silently get a file in the wrong place — both should see a failure, not a 200; (c) the warn log is a probe signal. Ignoring silently would also be safe for storage, but hides both |
| DC-2 | **Path is server-built: `<user.id>/<uuid>.<ext>`, or `<user.id>/logos/<uuid>.<ext>`.** The `folder` field is never interpolated. It is read only to choose between two constants: when its last `/`-segment is exactly `logos`, the sub-folder is `logos`; anything else means no sub-folder | Matches SA's "keep a sanitised sub-folder" without passing caller text through. Ignoring (not rejecting) `folder` keeps both logo callers and stale bundles working with no client edit, and moves the wizard's logos under the owner's folder (purge, export and the owner-scoped policies now see them). `<uuid>` is `crypto.randomUUID()`, as D-3 |
| DC-3 | **Type comes from the bytes only** (first 12 bytes), allow-list PNG, JPEG, WebP, GIF. Stored `contentType` and the extension come from the sniffed type. `file.type` and `file.name` are ignored for the decision | Same as D-3 ruling Q-1: the claim is attacker-controlled; a mislabelled real photo still works |
| DC-4 | **SVG is refused.** | (1) SVG is a script document; served from a public bucket it opens as a page on our storage origin (F-16). (2) The logo also goes into emails (`lib/email/branding.ts` via `resolveBusinessLogo`), and the major email clients do not render SVG, so an SVG logo already fails there. (3) Making SVG safe needs a sanitiser dependency or rasterising — a new pattern (rule 7) for a format no flow needs. Only new SVG uploads are refused: existing SVG files keep showing wherever they show today (website pages); SVG logos never showed in most email clients or in the invoice PDF, and still won't (SA-F27-8). Business wording for the user (SA ruling Q-7): *"For security, new logos and website pictures must be PNG, JPEG, WebP or GIF; an SVG logo you already uploaded keeps showing on your website as before."* LC-6/LC-7 size this |
| DC-5 | **Size limit 4 MB** (4 194 304 bytes allowed), checked twice: `Content-Length` before parsing (with 64 KiB multipart allowance) and `file.size` after; **413** `file_too_large` | Vercel refuses request bodies over 4.5 MB before the route runs, so today's 5 MB promise is false for 4.5-5 MB files and the user sees "Upload failed". 4 MB keeps the message true and matches D-3. Q-2 for SA |
| DC-6 | **Every client error is a fixed string with a `code`**; storage, database and parse messages never reach the client; `details` only under `NODE_ENV === 'development'` in the catch-all | CLAUDE.md Security; intake upload route precedent for `code` |
| DC-7 | **`DELETE` is removed.** Next.js answers 405 | No caller anywhere; it takes the bucket from the query on a service-role delete; keeping it means hardening dead code. Q-1 for SA (fallback: pin the bucket and refuse `..` / empty segments) |
| DC-8 | **No audit row.** Warn log on every refusal | Sibling precedent (no website media route or image service audits; not WC-7). Q-4 for SA |
| DC-9 | **Local helper, consolidate later.** New pure `lib/validation/imageSignature.ts` (`sniffImageSignature`), new pure `lib/validation/websiteImage.ts` (limit, allow-list, extension map). Different file names and export names from D-3's `lib/validation/avatar.ts`, so the two branches cannot conflict in git whichever merges first. Consolidation (D-3's `sniffImageType` re-implemented as a call to `sniffImageSignature`) is follow-up FU-1 | D-3 is not merged and its helper is untracked; importing it is impossible, copying it under the same name would conflict |
| DC-10 | **Storage stays in the route**, with a header comment giving the service-role reason | Rule 1 governs database access, not storage (D-3 SA ruling Q-9). A new `'server-only'` service, as D-3 has, is the tidier shape but doubles the diff of an urgent fix. Q-3 for SA |
| DC-11 | **Form fields are a closed set**: `file` (exactly one, non-empty `Blob`), and optional `bucket`, `folder`, `section`, `aspect`. Any other key, a second `file`, or a string `file` is 400 | Closed sets refuse injected fields (`userId`, `path`) outright; the five keys cover every current caller and every stale bundle |
| DC-12 | **`section` / `aspect` validated as the sibling `media/generate` route does**: `section` trimmed, ≤ 40 chars; `aspect` `wide \| portrait \| square`. `description` stored as the file name truncated to 120 characters (unchanged otherwise) | They go to `user_media`; reuse the existing schema rather than invent one |
| DC-13 | **Client change limited to `components/website/MediaUploader.tsx` and `components/website/MediaLibraryPicker.tsx`**: `accept` lists come from `WEBSITE_IMAGE_MIME_TYPES` (drops SVG; picker gains GIF); `MediaUploader` stops sending `bucket` and loses the unused `bucket` prop; its `maxSizeMB` default becomes 4. **`BusinessProfileSection.tsx` and `WebsiteSetupWizard.tsx` are not touched** | So the browser's pre-check never offers a file the server refuses. The two logo call sites keep their `folder` prop because DC-2 reads it; not touching them avoids collisions with the settings-drawer branch, which owns `BusinessProfileSection.tsx` |

---

## Contract

### `POST /api/website/upload` (multipart/form-data)

| Field | Required | Rule |
|---|---|---|
| `file` | yes | Exactly one, a `Blob` with `size > 0` (`z.instanceof(Blob)`) |
| `bucket` | no | If present, must be exactly `website-images` (else 400) |
| `folder` | no | String ≤ 200 chars. Never used in the path; last segment `logos` selects the `logos/` sub-folder |
| `section` | no | Trimmed string ≤ 40 |
| `aspect` | no | `wide` \| `portrait` \| `square` |
| anything else | — | 400 `invalid_request` |

**Order (every check before any storage or database call):**

| # | Check | Failure |
|---|---|---|
| V-0 | `getUser()` | 401 `unauthorized` |
| V-1 | `Content-Type` starts with `multipart/form-data` | 400 `invalid_request` |
| V-2 | `Content-Length`, when present, ≤ `WEBSITE_IMAGE_MAX_BYTES + 64 KiB` (checked before `request.formData()`) | 413 `file_too_large` |
| V-3 | `request.formData()` parses | 400 `invalid_request` |
| V-4 | Zod: closed key set, one `file`, `bucket` literal, `section`, `aspect`, `folder` length | 400 `invalid_request` (a non-default `bucket` also logs warn `reason: 'bucket_not_allowed'`, no value logged) |
| V-5 | `file.size ≤ WEBSITE_IMAGE_MAX_BYTES` | 413 `file_too_large` |
| V-6 | `sniffImageSignature(first 12 bytes)` is in `WEBSITE_IMAGE_MIME_TYPES` (read with `file.slice(0, 12)` before reading the body) | 400 `file_type` |

**Then:** read the body; upload to `website-images` at `<user.id>/[logos/]<uuid>.<ext>` with `contentType: <sniffed>`, `cacheControl: '3600'`, `upsert: false` (error → 500 `upload_failed`); `getPublicUrl`; `userMediaRepository.record({ userId: user.id, storagePath, publicUrl, source: 'upload', section, aspect, description })` (unchanged: non-fatal, it logs and returns null itself); info log; 200.

### Responses

| Status | `code` | `error` | When |
|---|---|---|---|
| 200 | — | — | `{ success: true, url, path, bucket: 'website-images' }` (same top-level shape both callers read today) |
| 400 | `invalid_request` | `Invalid upload` | V-1, V-3, V-4 |
| 400 | `file_type` | `Please choose a PNG, JPEG, WebP or GIF image` | V-6 |
| 401 | `unauthorized` | `Unauthorized` | V-0 |
| 413 | `file_too_large` | `Image must be 4 MB or smaller` | V-2, V-5 |
| 500 | `upload_failed` | `Could not store the picture` | Storage upload failed |
| 500 | `internal` | `Internal server error` (+ `details` in development only) | Catch-all |

The success shape stays top-level (`url`, `path`) rather than `{ data }` because both callers read `result.url`; Q-5 for SA.

### Logging

`createLogger({ module: 'WebsiteUploadAPI' })`, child with `correlationId`. Info on success: `{ userId, contentType, size, subFolder }`. Warn on each refusal: `{ userId, reason, size? }` (`reason` is a fixed code; never the bucket value, folder, file name, path or URL). Error on storage failure: `{ err, userId }`. No `console.*` (the file has none today).

### `DELETE /api/website/upload`

Removed (DC-7); 405 from Next.js.

---

## Implementation Approach

The route is rewritten in place to the `new-api-route` shape, with the `tenant-isolation-guard` rule applied: the target (bucket and path) is derived from `getUser()` and server constants only; no caller-supplied value reaches `.from()` or the object name. The rules live in two pure files so the client components and the route read the same list. Nothing in Storage or the database changes; files already stored stay where they are.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/validation/imageSignature.ts` | create | Pure `sniffImageSignature(bytes)` → `'image/png' \| 'image/jpeg' \| 'image/gif' \| 'image/webp' \| null`; `IMAGE_SIGNATURE_BYTES = 12`. Same signature table as D-3 |
| `lib/validation/websiteImage.ts` | create | `WEBSITE_IMAGE_BUCKET`, `WEBSITE_IMAGE_MAX_BYTES` (4 MB), `WEBSITE_IMAGE_MIME_TYPES`, `WEBSITE_IMAGE_EXTENSIONS`, `websiteUploadPath(userId, folder, ext, uuid)` (pure, so the DC-2 rule is unit-tested) |
| `lib/validation/__tests__/imageSignature.test.ts` | create | Signature table |
| `lib/validation/__tests__/websiteImage.test.ts` | create | Constants pinned; path builder |
| `app/api/website/upload/route.ts` | modify | Rewrite POST per the contract; remove DELETE |
| `app/api/website/upload/__tests__/route.test.ts` | create | Route tests (none exist today) |
| `components/website/MediaUploader.tsx` | modify | `accept` default from the shared list; stop sending `bucket`; drop the unused `bucket` prop; `maxSizeMB` default 4. File has no `console.*` |
| `components/website/MediaLibraryPicker.tsx` | modify | `accept` from the shared list (one line); error shown by `code` (SA-F27-2). File has no `console.*` |
| `components/website/__tests__/websiteUploadClient.test.tsx` | create | SA-F27-2: both callers offer no SVG, `MediaUploader` sends no `bucket`, errors shown by `code` |
| `lib/business-os/translations/en.ts`, `es.ts`, `he.ts` | modify | `media.upload.invalid_type` drops SVG (one line each, SA-F27-2) |
| `docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md` | create | This file |

Not modified: `BusinessProfileSection.tsx`, `WebsiteSetupWizard.tsx` (DC-13), any migration, `descriptors.ts` (no new bucket or table).

---

## Task List

- ✅ 1. SA reviews this workplan; record rulings in [SA Review Notes](#sa-review-notes).
- ✅ 2. `lib/validation/imageSignature.ts` + test.
- ✅ 3. `lib/validation/websiteImage.ts` + test.
- ✅ 4. Rewrite `POST` in `app/api/website/upload/route.ts`; remove `DELETE` (Q-1: removed).
- ✅ 5. `app/api/website/upload/__tests__/route.test.ts`.
- ✅ 6. `MediaUploader.tsx` and `MediaLibraryPicker.tsx` client edits, translation lines, client test (SA-F27-2).
- ✅ 7. Tests, must-stay-green set, `typecheck:bos-llm`, full `tsc` before/after, eslint, `lint:hooks`, mutations M-1..M-16.
- ✅ 8. `git diff --stat` check; hand back uncommitted for SA code review.
- ✅ 9. TL runs the read-only live checks LC-1..LC-7 and LC-2b; results recorded.
- ⬜ 10. SA code review.
- ⬜ 11. QA (tests + Manual QA items 1, 4, 5 run, per SA-F27-9).

---

## Tests

### `lib/validation/__tests__/imageSignature.test.ts`

PNG, JPEG, GIF87a, GIF89a, WebP each recognised; `RIFF` without `WEBP` (WAV) → null; truncated signatures (7-byte PNG, 2-byte JPEG, `GIF8`) → null; `<svg`, `<?xml`, `<!DOCTYPE html`, `%PDF`, empty → null.

### `lib/validation/__tests__/websiteImage.test.ts`

`WEBSITE_IMAGE_BUCKET === 'website-images'`; `WEBSITE_IMAGE_MAX_BYTES === 4 * 1024 * 1024`; the MIME list is exactly the four, no `image/svg+xml`; extension map complete. `websiteUploadPath`: no folder → `u/<uuid>.png`; `logos` → `u/logos/<uuid>.png`; `u/logos` → `u/logos/...`; `shared/logos` → `u/logos/...`; `../other/logos` → `u/logos/...`; `other-user-id` → `u/<uuid>.png`; `logos/../../x` → `u/<uuid>.png`; the result always starts with `<userId>/` and never contains `..`.

### `app/api/website/upload/__tests__/route.test.ts`

Mocks: `@/lib/auth` (`getUser`), `@/lib/logger` (one shared logger with `child` returning it), `@/lib/supabaseServer` (`storage.from` → `upload`, `getPublicUrl`), `@/lib/repositories/UserMediaRepository` (`record`). The validation files run real. Requests are `new NextRequest(url, { method: 'POST', body: formData })`.

| # | Case | Expect |
|---|---|---|
| T-1 | Happy PNG, no extra fields | 200 `{ success, url, path, bucket: 'website-images' }`; `from` called only with `'website-images'`; path matches `^<session>/[0-9a-f-]{36}\.png$`; `contentType 'image/png'`, `upsert: false`; `record` called with `userId: <session>`, `source: 'upload'` |
| T-2 | No session | 401; `from`, `record` never called |
| T-3 | `bucket=contact-documents` / `avatars` / `business-purge-snapshots` (each) | 400 `invalid_request`; `from` never called; warn with `reason: 'bucket_not_allowed'` |
| T-4 | `bucket=website-images` (stale bundle) | 200, same as T-1 |
| T-5 | `folder=<otherUserId>` and `folder=<otherUserId>/x` | 200; path starts with `<session>/`, contains neither the other id nor `x` |
| T-6 | `folder=../<otherUserId>` | Path starts with `<session>/`, no `..` |
| T-7 | `folder=logos`, `folder=<session>/logos`, `folder=shared/logos` | Path `^<session>/logos/<uuid>\.png$` |
| T-8 | SVG bytes declared `image/svg+xml`, name `logo.svg` | 400 `file_type`; `from` never called |
| T-9 | SVG/HTML bytes declared `image/png`, name `x.png` | 400 `file_type` |
| T-10 | Real JPEG declared `image/png`, name `x.png.html` | 200; `contentType 'image/jpeg'`; path ends `.jpg` |
| T-11 | `file.size === 4 MB` exactly | 200 |
| T-12 | `file.size === 4 MB + 1` | 413 `file_too_large`; `from` never called |
| T-13 | `Content-Length` header over limit + 64 KiB | 413 before `formData()` (spy) |
| T-14 | Upload error `{ message: 'new row violates row-level security policy for bucket contact-documents' }` | 500 `upload_failed`; response body (JSON-stringified) contains neither `row-level`, `bucket`, nor `contact-documents` |
| T-15 | `formData()` throws / non-multipart content type | 400 `invalid_request`, fixed body |
| T-16 | Unknown key (`userId`, `path`), two `file`s, string `file`, empty file | 400 `invalid_request` |
| T-17 | `aspect=huge`; `section` 41 chars | 400 `invalid_request` |
| T-18 | `record` returns null | Still 200 (non-fatal, as today) |
| T-19 | Catch-all (`getPublicUrl` throws) with `NODE_ENV=production` | 500 `internal`, no `details` |
| T-20 | Logging | No logger call argument (stringified) contains the file name, the public URL, or a caller-supplied `bucket`/`folder` value |
| T-21 | `DELETE` | The module exports no `DELETE` (if Q-1 = remove) |

---

## Mutation Candidates

| # | Mutation | Caught by |
|---|---|---|
| M-1 | `.from(formBucket ?? WEBSITE_IMAGE_BUCKET)` | T-3 |
| M-2 | Accept and ignore a non-default `bucket` (no 400) | T-3 |
| M-3 | Interpolate `folder` into the path | T-5, T-6 |
| M-4 | `websiteUploadPath` matches `logos` anywhere instead of the last segment | websiteImage test (`logos/../../x`) |
| M-5 | Trust `file.type` instead of the sniff | T-8, T-9 |
| M-6 | `contentType: file.type` | T-10 |
| M-7 | Extension from `file.name` | T-10 |
| M-8 | `<` instead of `≤` on the size limit | T-11 |
| M-9 | Drop the `Content-Length` pre-check | T-13 |
| M-10 | Return `uploadError.message` | T-14 |
| M-11 | Add `image/svg+xml` to the allow-list | websiteImage test, T-8 |
| M-12 | WebP on `RIFF` alone | imageSignature test |
| M-13 | `upsert: true` | T-1 |
| M-14 | Log `file.name` | T-20 |
| M-15 | Drop `.strict()` on the form schema | T-16 |
| M-16 | `MediaLibraryPicker` shows the server's `error` again (added by Dev for SA-F27-2) | `websiteUploadClient.test.tsx` |

---

## Manual QA

On a Preview deployment or local `npm run dev`, signed in as a Business OS test account (TL runs; Business OS screens only):

1. Website editor, hero block: drag a JPEG in → shows in the block; open the picker → it is in the library.
2. Picker "upload": a PNG → appears in the grid; pick it → applied.
3. Settings → Business profile logo: upload a PNG → saved; its URL path is `<your id>/logos/<uuid>.png`.
4. Website setup wizard logo: upload → URL path is `<your id>/logos/<uuid>.<ext>` (was `logos/...`).
5. Try an `.svg` → the file chooser no longer offers it; drag one in → refused with the type message.
6. Rename a `.txt` to `.png` and upload → "Please choose a PNG, JPEG, WebP or GIF image".
7. A 4.2 MB photo → "Image must be 4 MB or smaller" (on Vercel a > 4.5 MB file may show the generic failure; RK-3).
8. DevTools: replay the upload with `bucket=contact-documents` → 400 `Invalid upload`; LC-3 query afterwards shows nothing new.
9. A logo that was an SVG before this change still displays on the site.

---

## Read-only Live Checks (TL)

All `SELECT` only. None contains the word that breaks the Supabase SQL editor. `storage.objects` written by the service role have `owner_id` NULL; the route's names look like `<folder>/<13-digit ms>-<1..6 base36>.<ext>` (hyphen), which no other writer uses (`ContactDocumentService` and the CRM upload-url route use `<ts>_<name>`, intake uses `<uuid>`).

**LC-1 Bucket configuration**
```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;
```

**LC-2 Route-shaped objects outside `website-images` since the route shipped** (the core exposure question)
```sql
select bucket_id, count(*) as objects, min(created_at) as first_seen, max(created_at) as last_seen
from storage.objects
where bucket_id <> 'website-images'
  and name ~ '(^|/)[0-9]{13}-[a-z0-9]{1,6}\.[A-Za-z0-9_]+$'
  and created_at >= '2026-07-26'
group by bucket_id
order by objects desc;
```

**LC-3 `contact-documents` objects with no `contact_documents` row and not an intake file** (anything here was not written by the CRM paths)
```sql
select o.name, o.created_at, o.metadata->>'mimetype' as mimetype, o.metadata->>'size' as size
from storage.objects o
where o.bucket_id = 'contact-documents'
  and o.name not like '%/intake/%'
  and not exists (select 1 from public.contact_documents d where d.storage_path = o.name)
order by o.created_at desc
limit 50;
```

**LC-4 `website-images` objects whose first folder is not an existing account** (the wizard's `logos/`, `shared/`, or a forged folder)
```sql
select (storage.foldername(o.name))[1] as top_folder, count(*) as objects,
       min(o.created_at) as first_seen, max(o.created_at) as last_seen
from storage.objects o
where o.bucket_id = 'website-images'
  and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
group by 1
order by objects desc;
```

**LC-5 Upload rows whose stored path is in another account's folder** (the only trace a cross-account write into `website-images` would leave)
```sql
select count(*) as mismatched
from public.user_media
where source = 'upload'
  and split_part(storage_path, '/', 1) <> user_id::text;
```

**LC-6 SVG objects by bucket** (sizes DC-4)
```sql
select bucket_id, count(*) as svg_objects, max(created_at) as last_seen
from storage.objects
where metadata->>'mimetype' = 'image/svg+xml' or name ilike '%.svg'
group by bucket_id;
```

**LC-7 SVG logos in use** (who is affected by DC-4 if they re-upload)
```sql
select count(*) as svg_logos
from public.business_profiles
where logo_url ilike '%.svg%';
```

**Results:** run read-only on production by TL on 2026-10-16. Recorded, with SA's reading, in [SA Workplan Review (2026-10-16)](#sa-workplan-review-2026-10-16) → "Live check results".

**LC-2b (SA-F27-6), TL, read-only, production, 2026-10-16:** LC-2 re-run with the broader pattern (`\.[^/]+$`, plus names with no extension): **0 rows** — no object written by this route in any bucket other than `website-images` since 2026-07-26. **No evidence the hole was used.** With LC-5 = 0, this is the statement that goes to the user.

Expected for a clean bill: LC-2 empty; LC-3 empty or explainable; LC-4 only `logos` (and possibly `shared`); LC-5 `0`. Anything else is reported to the user before merge and handled as a cleanup decision, not in this slice. LC-7 confirms `business_profiles.logo_url` against the live schema at the same time (`business-os-schema-check`).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | A business that wants an SVG logo can no longer upload one | Existing SVG files keep showing wherever they show today (website pages); SVG logos never showed in most email clients or in the invoice PDF, and still won't (SA-F27-8). LC-6/LC-7 size it (7 SVG objects, 1 SVG logo); business wording in DC-4 for the user |
| RK-2 | Stale browser tabs during deploy | They send `bucket=website-images` (accepted) and `folder` (read only as a selector); no break |
| RK-3 | Files between 4 and 4.5 MB that uploaded before are now refused | They were near the edge already; message is now true. Vercel still answers > 4.5 MB itself with a non-JSON 413 that `MediaUploader` shows as "Upload failed" (unchanged; FU-4) |
| RK-4 | A real image in a format we do not sniff (HEIC, AVIF, BMP) | Refused today by the claimed-MIME check as well (none are in the list), so no regression |
| RK-5 | The authenticated Storage policies on `website-images` still let a user upload any allowed type, SVG included, **directly** to their own folder with their own token | Out of this route's reach; FU-2 (bucket hardening migration) |
| RK-6 | 413 instead of 400 for oversize | Both callers branch on `!response.ok`, not on the status number |
| RK-7 | Collision with the settings-drawer branch | Different validation files and export names; no shared component touched (DC-9, DC-13) |
| RK-8 | Logo uploads still create `user_media` rows (they always have, since logos use the default bucket; the route's comment says otherwise) | Unchanged behaviour; noted as FU-5 |

---

## Rollback

Revert the PR. No migration, no stored object moved, no row changed. Files uploaded under the new paths stay valid public URLs after a revert (the old code serves any path).

---

## Follow-ups (not in this slice)

| # | Item |
|---|---|
| FU-1 | Consolidate: after D-3 and F-27 are both on `main`, make `lib/validation/avatar.ts` call `sniffImageSignature` (one signature table) |
| FU-2 | **Now slice F-27a (SA-F27-7).** Harden `website-images`: drop `image/svg+xml` from `allowed_mime_types` and drop the three authenticated INSERT/UPDATE/DELETE policies (no browser writer exists). **Keep `file_size_limit` at 5 MB** (generated pictures can approach 4 MB). Own migration file, rows captured verbatim for rollback, LC-8 owner pre-check, checker + functional check; applied by TL after F-27 is deployed, in the D-3a session; needs user decision U-F27-1; never auto-merges |
| FU-3 | Cleanup of anything LC-2..LC-5 finds, and of the wizard's ownerless `logos/` objects (outside purge/export today), with the F-15 sweep |
| FU-4 | `MediaUploader`: treat a non-JSON response (Vercel's 413) as `file_too_large` |
| FU-5 | Decide whether logos belong in the picture library (`user_media`); the route comment assumes they do not |
| FU-6 | Splice F-27 status (workplan, SA ruling, PR) into the F-27 row of `BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` §7 — that file lives on the settings-drawer branch, so TL routes it there (SA-F27-10) |
| FU-7 | LC-3's 6 `contact-documents` objects outside `/intake/` with no `contact_documents` row: CRM / F-15 sweep, with a check of why a signed upload left no row. Not written by this route |
| FU-8 | Logo formats per surface: `@react-pdf` `<Image>` takes PNG/JPEG only, so SVG (and likely WebP/GIF) logos are missing from invoice PDFs. Read-only check that the one SVG-logo business's invoice PDF renders without the logo rather than failing. Product question later: should logos be PNG/JPEG only? |
| FU-9 | Simplify the two logo call sites' `folder` props (`BusinessProfileSection.tsx`, `WebsiteSetupWizard.tsx`) to `folder="logos"` after the settings-drawer branch merges |
| FU-10 | `MediaUploader`'s `handleFileSelect` `useCallback` omits `t` from its dependency list (pre-existing `react-hooks/exhaustive-deps` warning; not changed here) |

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | `DELETE` has no caller. Remove it, or keep it with the bucket pinned and `..`/empty segments refused? | Remove (DC-7) |
| Q-2 | Size limit 4 MB (true under Vercel's 4.5 MB body limit, matches D-3) or keep 5 MB (matches the bucket's limit)? | 4 MB |
| Q-3 | Storage in the route (DC-10) or a `'server-only'` `WebsiteImageService` like D-3's `AvatarService`? | In the route for this urgent slice |
| Q-4 | Audit a refused bucket probe? `recordRefusedAccess` is admin-only with a pinned surface list | No; warn log only (DC-8) |
| Q-5 | Keep the top-level success shape `{ success, url, path, bucket }` or move to `{ success, data }`? | Keep (both callers read `result.url`) |
| Q-6 | Reject a non-default `bucket` (DC-1) vs ignore it? | Reject |
| Q-7 | SVG refused (DC-4) — confirm, or route as a business question to the user? | Refuse; tell the user in the DC-4 wording |
| Q-8 | Local helper now, consolidate in FU-1 (DC-9) — acceptable, or should D-3 adopt `imageSignature.ts` before it merges? | Local now, FU-1 later |
| Q-9 | Is the `MediaUploader` / `MediaLibraryPicker` edit (DC-13) in scope for a "server-only" slice? | Yes; otherwise the browser offers SVG and the server refuses it |

---

## SA Review Notes

### SA Workplan Review (2026-10-16)

**Reviewed by SA — 2026-10-16**
**Status:** **APPROVED WITH CONDITIONS** (SA-F27-1 to SA-F27-10 below). Dev may implement now. No user decision blocks this slice. One user decision is needed for the **follow-up** bucket change (U-F27-1, end of this review). It does not gate this PR.

**Verified against code on `067c4a3e`:** `app/api/website/upload/route.ts` (bucket/folder from form, `file.type` trust, extension from name, raw `uploadError.message` / `deleteError.message`, DELETE bucket from query; no `console.*`); the callers (repo-wide grep for `website/upload` in `app/ components/ lib/ hooks/`: only `MediaUploader.tsx:111` and `MediaLibraryPicker.tsx:180`); the 8 `MediaUploader` call sites (none passes `bucket`, `accept` or `maxSizeMB`; only `BusinessProfileSection.tsx:698` `folder={\`${user?.id || 'shared'}/logos\`}` and `WebsiteSetupWizard.tsx:741` `folder="logos"`); `MediaLibraryPicker` (sends `file`, `section` when set, `aspect` always, default `'wide'`; shows `result.error`); `media/generate/route.ts` (`section` trim ≤ 40, `aspect` enum, so DC-12 matches); `UserMediaRepository.record`; `supabase/migrations/20260726_fix_website_images_rls.sql` (owner-scoped INSERT/UPDATE/DELETE for `authenticated`, public SELECT); `lib/business-os/purge/descriptors.ts:824` (`website-images`, `pathPrefix '{user_id}/'`); no browser-side writer to `website-images` (grep `website-images` and `.storage` in `components/ hooks/ app/`); `lib/branding/businessLogo.ts`, `lib/email/templates/base-template.ts:312` (`<img>` logo in email), `lib/pdf/InvoicePDFGenerator.tsx:872` (`@react-pdf` `<Image>`), `components/website/blocks/HeaderBlock.tsx:302` (plain `<img>`; no `next/image` in `components/website`); translations `media.upload.invalid_type` in `en.ts:3808`, `es.ts:3604`, `he.ts:2030` (all three list **SVG**); Jest `testEnvironment: 'node'`. D-3 side (read-only, `neuronforge-settings-drawers`): D-3 file list (no overlap with this plan's files), SA-D3-5 guard wording, D-3a scope, F-26/F-27 rows of the requirement. Skills `new-api-route`, `tenant-isolation-guard`.

**Architectural fit.** Correct shape. The tenant-isolation rule is met the strongest way: there is no caller-supplied target left to check. Bucket and object name come from `getUser()` and server constants, and `upsert: false` is kept. That is better than an ownership pre-check. Zod covers the whole form before any storage or database call. The pure validation files follow the `intake/types.ts` and D-3 precedents. The size of the plan is proportionate for a High-class hole.

#### Live check results (TL, read-only, production, 2026-10-16)

| # | Result | SA reading |
|---|---|---|
| LC-1 | `avatars` public, no size/type limit. `business-purge-snapshots` private, 500 MB, json. `contact-documents` private, 50 MB, images/pdf/office/csv/txt, **no SVG**. **`website-images` public, 5 MB, jpeg/png/gif/webp/svg+xml** | Matches the plan. Through this route, `contact-documents` would have accepted a forged write of any of its types, and `avatars` would have accepted anything. The `website-images` row is what FU-2 changes (see SA-F27-7: **keep 5 MB**) |
| LC-2 | **No object with the route's name pattern in any bucket other than `website-images` since 2026-07-26** | **No evidence the hole was used to write into another bucket.** One caveat: the regex `\.[A-Za-z0-9_]+$` misses names whose "extension" carried a hyphen, or a file name with no dot (the old code took the whole sanitised name as the extension, and the sanitiser keeps `-`). An LC-2b re-run with `\.[^/]+$` closes that gap. TL runs it **before** the "no evidence" statement goes to the user. It does not gate the code (SA-F27-6). Side note for F-26 (c): the stray `website-logos/` SVG in `avatars` does not match this pattern, so the route as committed did not write it. That fits "manual dashboard upload or pre-commit dev code". TL may add this to F-26 (c) |
| LC-3 | 6 `contact-documents` objects outside `/intake/` with no `contact_documents.storage_path` row; none match the route's pattern | **Not F-27.** The route's names are `<13 digits>-<base36>.<ext>`, and the CRM writers use `<ts>_<name>`. Most likely CRM orphans: a signed upload that completed with no row written (abandoned or failed insert). Recorded as **FU-7** for the CRM / F-15 sweep. Not this slice |
| LC-4 | Only `logos` (2 objects) as a non-account top-level folder; no folder named for a non-existent account | The wizard's ownerless path, as expected. No forged folders. The 2 objects stay where they are. Moving them would break the URLs stored in `logo_url` / header blocks. They join FU-3 (F-15 sweep) |
| LC-5 | 0 `user_media` upload rows outside their own user's folder | **No cross-account write into `website-images` through this route.** The route always records the row under the **caller's** id when the bucket is `website-images`. So a write into someone else's folder would show up here, unless `record` failed, which is improbable |
| LC-6 | SVG objects: `avatars` 1, `website-images` 6 | Small. Existing objects are untouched by this slice and by FU-2 (bucket limits apply on upload only) |
| LC-7 | 1 `business_profiles.logo_url` points to an SVG | Confirms the column against the live schema. See the Q-7 ruling for where that logo renders |

#### Rulings on Q-1 to Q-9

| # | Ruling |
|---|---|
| Q-1 | **Remove `DELETE`** (DC-7). No caller in the repo, and it takes a caller-chosen bucket on a service-role delete. Hardening dead code is worse than deleting it. Next.js answers 405. T-21 stands. |
| Q-2 | **4 MB.** It is the only limit the user can actually hit with a true message under Vercel's 4.5 MB body limit, and it matches D-3. The **bucket** stays at 5 MB (SA-F27-7). |
| Q-3 | **Storage stays in the route for this slice** (DC-10). Rule 1 governs database access (D-3 ruling Q-9). Storage in a route has precedent: the intake upload route, and this route today. Accepted for an urgent fix. A `WebsiteImageService` is not required. The route header must give the service-role reason (SA-F27-5). |
| Q-4 | **No audit row.** Not a WC-7 write, and no sibling website-media path audits. `recordRefusedAccess` is admin-only. Warn log with a fixed `reason` is enough. |
| Q-5 | **Keep the top-level shape** `{ success, url, path, bucket }`. This is a justified deviation from `new-api-route`'s `{ success, data }`: both callers and every stale bundle read `result.url`. Say so in a code comment (SA-F27-5). |
| Q-6 | **Reject** a non-default `bucket` (DC-1). Stale bundles send exactly `website-images` and stay accepted. Anything else is a probe or a misdirected future caller, and both should fail loudly. |
| Q-7 | **Refuse SVG. This is an SA call on security grounds and does not need a user decision.** The user is **told**, not asked. Reasons: (a) the route cannot make SVG safe without a sanitiser dependency or rasterising, which is a new pattern for a format no flow needs. (b) The logo goes into emails and the invoice PDF. Major email clients do not render SVG, and `@react-pdf`'s `<Image>` takes PNG/JPEG only. So an SVG logo already fails silently on two of the three surfaces that show it. (c) Exposure is tiny (LC-6/LC-7). (d) Reversal is a one-line allow-list change. The earlier note in the F-27 requirement row ("SVG is a product decision for the website team") is superseded by this ruling. TL tells Offir alongside the U-4 question. **LC-7 confirmation:** the existing SVG logo keeps rendering where it renders today: the website header (plain `<img>`, `HeaderBlock.tsx:302`) and other browser `<img>` surfaces. It **already** does not render in most email clients or in the invoice PDF, and F-27 changes nothing there. So DC-4's "keeps working" must be worded precisely (SA-F27-8). **User message (one line):** *"For security, new logos and website pictures must be PNG, JPEG, WebP or GIF; an SVG logo you already uploaded keeps showing on your website as before."* |
| Q-8 | **Local helper now, consolidate later (FU-1).** D-3 already has `lib/validation/avatar.ts` in progress in its worktree, and making D-3 depend on F-27 landing first would couple two independent slices. The different file and export names mean no git conflict either way. FU-1 is done by whichever slice merges second, or by a small follow-up after both are on `main`. It must not be folded into either PR. |
| Q-9 | **Client edits are in scope** (DC-13), plus the translation lines and the error mapping in SA-F27-2. Otherwise the browser offers SVG, the server refuses it, and the "not an image… or SVG" message tells the user SVG is fine. |

#### Other questions from TL

| Topic | Ruling |
|---|---|
| **Ownerless `logos/` path** | **Confirmed fixed for new uploads.** DC-2 reads only the last `/`-segment of `folder` as a selector. The wizard's `logos`, the profile section's `<uid>/logos`, and its `shared/logos` fallback (rendered before `user` loads) all become `<session uid>/logos/<uuid>.<ext>`. So purge, export and account deletion see them. The 2 existing `logos/` objects are not moved (FU-3). |
| **Leaving `WebsiteSetupWizard` / `BusinessProfileSection` untouched** | **OK.** Their `folder` values become selectors with no path effect, and the settings-drawer branch owns `BusinessProfileSection.tsx`. Simplifying both to `folder="logos"` is **FU-9**, after that branch merges. |
| **`website-images` still allowing SVG; owner-scoped direct upload (FU-2)** | **Separate slice "F-27a", applied in the same TL session as D-3a, after F-27 is deployed. Its own migration file, its own rollback rows, its own checker. Not inside D-3a.** D-3a is already SA-approved with a fixed scope and rollback order, and widening an approved hand-applied migration mid-flight is how rollback scripts go wrong. Batching it into the same SQL-editor session gets the benefit (one LC-8 owner pre-check, one sitting) without the coupling. F-27a scope is in SA-F27-7. It is a new production change that U-1 does not cover, so it needs the user's yes (**U-F27-1**). Residual risk until then is **Low**: a signed-in user can store an SVG only in their own folder of a public bucket on the Supabase origin, which holds no app cookies. That is the same reasoning as D-3's F-26 (c) ruling. |
| **F-27 vs D-3 / D-3a merge order** | **F-27 merges as soon as it passes, with no ordering dependency on D-3 or D-3a.** Before or after D-3a, nothing breaks. D-3a's `avatars` type/size limits and F-27's bucket pin each close the `avatars` path on their own. Landing F-27 first is preferred, because it is the wider hole (any bucket, any folder). |
| **Merge-collision risk with the D-3 branch** | **Low, with SA-F27-1.** No shared files: D-3 creates `lib/validation/avatar.ts`, its tests, `AvatarService`, the hook, `UserProfileRepository`, `AvatarUpload.tsx`. F-27 creates `imageSignature.ts` and `websiteImage.ts` and edits the route and two website components. The translations files are shared territory (SA-F27-2 touches one line in each). Settings-drawer slices edit them too, but a one-line value change far from their keys auto-merges. **SA-D3-5 guard:** it fails on any **non-test** file under `app/ components/ lib/ hooks/` that names `avatars` via `.from('avatars')` or a `= 'avatars'` constant. F-27's allow-list design names no other bucket, so it passes. SA-F27-1 makes that a rule and keeps the test files in a form that does not trip a guard that mis-scopes tests. |

#### Conditions

1. **SA-F27-1 (allow-list only; D-3 guard).** Production code names exactly one bucket, `WEBSITE_IMAGE_BUCKET`. There is **no** denylist and no other bucket name in any non-test file. The check is equality with the constant (`z.literal(WEBSITE_IMAGE_BUCKET).optional()`). In tests, write the probe bucket names only as inline arguments (`it.each(['contact-documents', 'avatars', 'business-purge-snapshots'])` → `form.append('bucket', b)`), never as `= 'avatars'` or `.from('avatars')`. `supabaseServer.storage.from` is called only with the constant, and T-1/T-3 assert that.
2. **SA-F27-2 (user-facing copy).** (a) Update `media.upload.invalid_type` in `en.ts`, `es.ts` and `he.ts` to drop SVG ("…JPEG, PNG, GIF or WebP."). Use Edit, one line per file. No rewrite and no new keys. (b) `MediaUploader` and `MediaLibraryPicker` stop showing `result.error`. They map the response `code` to existing keys instead: `file_type` → `media.upload.invalid_type`, `file_too_large` → `media.upload.too_large` with `{ size: 4 }` (from `WEBSITE_IMAGE_MAX_BYTES`), anything else → `media.upload.failed`. Server strings stay fixed English for API consumers. The browser shows the user's language. (c) `MediaLibraryPicker`'s `accept` gains GIF and loses SVG, from `WEBSITE_IMAGE_MIME_TYPES` (as DC-13).
3. **SA-F27-3 (empty strings).** An empty-string `folder`, `section` or `aspect` is treated as absent, not as a 400 and not stored as `''`. Today's `|| null` keeps working (preprocess `'' → undefined` in the form schema). Add one case to T-16/T-17: `section=''` → 200 with `section: null` passed to `record`.
4. **SA-F27-4 (size pre-check test realism).** T-13 must prove `formData()` is never called. If undici overrides or drops an explicit `content-length` on a `FormData` body, build T-13's request with a small non-multipart body and a declared oversize `content-length` + `multipart/form-data` content type, or with a request stub whose `formData` is a spy. Add **T-13b**: with no `Content-Length` header (chunked), the request proceeds to V-3. The pre-check is "when present" only.
5. **SA-F27-5 (route header comment).** The route header explains: why the service role (the bucket's owner-scoped policies are not used by this path; the server decides the target); why bucket and path are server-derived (F-27, `tenant-isolation-guard`); that `folder` is a selector, not a path (DC-2, naming the two logo call sites); why the success shape is top-level (Q-5); that `DELETE` was removed on purpose (no caller; F-27). Remove the stale "Only for the website bucket… a logo is not one of the pictures" paragraph, or reword it to the truth (logos are recorded too; FU-5).
6. **SA-F27-6 (LC-2b, TL, before the user report).** Re-run LC-2 with `name ~ '(^|/)[0-9]{13}-[a-z0-9]{0,6}\.[^/]+$'` (catches hyphenated or dot-less "extensions"). If it is still empty, "no evidence the hole was used" is safe to report. If not, report the rows to the user as a cleanup decision. This does not gate the code PR.
7. **SA-F27-7 (FU-2 amended → slice F-27a).** Scope: (1) remove `image/svg+xml` from `website-images.allowed_mime_types`. (2) Drop the three `authenticated` INSERT/UPDATE/DELETE policies from `20260726_fix_website_images_rls.sql`. No browser writer exists (verified), and every writer is a service-role path. (3) **Do not lower `file_size_limit` to 4 MB.** Bucket limits bind the service role too, and `GeneratedImageService` stores model PNGs up to 1536×1024 that can approach or exceed 4 MB. Keep 5 MB unless a read-only check of the largest `<uid>/generated/` object first shows a wide margin. (4) Capture the four policy rows and the bucket row verbatim before applying, for rollback. (5) Run the LC-8 owner pre-check (as D-3a). (6) Afterwards, a checker on `pg_policies` and the bucket row, plus a functional check (one website upload and one image generation still work). Applied by TL after F-27 is **deployed**, in the D-3a session, as its own file. It needs **U-F27-1**. It never auto-merges.
8. **SA-F27-8 (wording and follow-ups).** Reword DC-4 and RK-1 to the precise claim: *"existing SVG files keep showing wherever they show today (website pages); SVG logos never showed in most email clients or in the invoice PDF, and still won't."* Add these follow-ups: **FU-7** (LC-3's 6 `contact-documents` orphans → CRM / F-15 sweep, with a check of why a signed upload left no row). **FU-8** (logo formats per surface: `@react-pdf` `<Image>` takes PNG/JPEG only, so SVG, and likely WebP/GIF, logos are missing from invoice PDFs. Read-only check that the one SVG-logo business's invoice PDF renders without the logo rather than failing. Product question later: should logos be PNG/JPEG only?). **FU-9** (simplify the two logo call sites' `folder` props after the settings-drawer branch merges). Amend **FU-2** to point at F-27a / SA-F27-7.
9. **SA-F27-9 (merge path).** Code-only, no migration, so under the standing rule RM may commit and switch on auto-merge after SA **code** approval and QA's pass. QA's report must record Manual QA items **1, 4 and 5** as **run** (a picture upload, the wizard logo path now under the owner, SVG refused). These are the user-visible changes. The other items may be covered by the route tests. Item 8 (DevTools replay) is optional, because T-3 covers it.
10. **SA-F27-10 (requirement splice; FU-6).** TL splices into the F-27 row of `BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` §7, on the settings-drawer branch: this verdict, the Q-7 SVG ruling (superseding "product decision for the website team"), LC-2/LC-5 "no evidence of use" (after SA-F27-6), the PR number, and F-27a. Not edited from this worktree.

#### Optimisation suggestions (non-blocking)

- `websiteUploadPath` takes `uuid` as a parameter (good, deterministic tests). Keep `crypto.randomUUID()` at the single call site in the route.
- T-20: also assert that `description` (the file name) and `section` text never appear in a log argument.
- Read the 12 signature bytes with `new Uint8Array(await file.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer())` before reading the body, as D-3 does, so a type refusal does not buffer 4 MB.
- No rate limit is added. An authenticated user can still fill their own folder with 4 MB files, which is unchanged and pre-existing. Not this slice.

#### User decisions

| # | Decision (business terms) | SA recommendation |
|---|---|---|
| **U-F27-1** | **Lock the website picture store the same way as the profile-picture store (D-3a).** After this fix, every website upload goes through the app's own checks. One side door remains: a signed-in user can still upload a file, an SVG included, straight into **their own** folder of the website picture store by calling the storage service directly. Closing it is a database change that TL applies by hand, in the same sitting as D-3a, after this fix is live. Existing pictures are not touched | **Approve.** Low risk today, and cheap to close while D-3a is being applied anyway. **Does not block this fix** |

None of the rulings above needs the user. The SVG refusal (Q-7) is a security call the user is **informed** of, using the one-line message.

### Approval

[x] Workplan approved with conditions SA-F27-1 to SA-F27-10. Proceed to implementation. Hand back uncommitted for SA code review.

---

## Implementation Notes (Dev, 2026-10-16)

### SA conditions

| # | How it was applied |
|---|---|
| SA-F27-1 | Production code names one bucket, `WEBSITE_IMAGE_BUCKET` in `lib/validation/websiteImage.ts`; the schema is `z.literal(WEBSITE_IMAGE_BUCKET).optional()`; both `.from()` calls use the constant. No deny-list, no other bucket name in any non-test file (grep: none). Probe names appear only inline in `it.each([...])` in `route.test.ts`; no `= 'avatars'` or `.from('avatars')` anywhere. T-1 and T-4 assert every `from` call got `'website-images'` |
| SA-F27-2 | (a) `media.upload.invalid_type` updated in `en.ts`/`es.ts`/`he.ts`, one value per file, no key added. (b) `websiteUploadErrorKey(code)` in `websiteImage.ts` maps `file_type` / `file_too_large` / anything else; both components use it, `too_large` gets `{ size: WEBSITE_IMAGE_MAX_MB }` (4). (c) both `accept` lists are `WEBSITE_IMAGE_ACCEPT` (picker gains GIF, loses SVG) |
| SA-F27-3 | `emptyIsAbsent` preprocess on `folder`, `section`, `aspect`; test "SA-F27-3" proves `''` for all three gives 200 with `section: null`, `aspect: null` |
| SA-F27-4 | T-13 uses a `NextRequest` with a declared oversize `content-length` (asserted present on the request) and a `formData` spy: never called. A second T-13 case at exactly limit + 64 KiB proves `formData` is called. T-13b: a real `FormData` body has no `content-length` header on the request (asserted) and proceeds to parsing (spy called once, 200) |
| SA-F27-5 | Route header rewritten: service-role reason, server-derived bucket and path (F-27, `tenant-isolation-guard`), `folder` as a selector naming both logo call sites, top-level success shape (Q-5), DELETE removed on purpose. The stale "a logo is not one of the pictures" paragraph now says logos are recorded too (FU-5) |
| SA-F27-6 | LC-2b result recorded under [Read-only Live Checks](#read-only-live-checks-tl): 0 rows, no evidence the hole was used |
| SA-F27-7 | No migration in this slice; FU-2 now points to F-27a with the 5 MB bucket limit kept |
| SA-F27-8 | DC-4 and RK-1 reworded to the precise claim; FU-2 amended; FU-7, FU-8, FU-9 added |
| SA-F27-9, SA-F27-10 | For QA / RM / TL; nothing in this worktree |
| Optimisations | `crypto.randomUUID()` at the single call site; T-20 also checks `section` text and the file name (description); the 12 signature bytes are read with `file.slice(0, IMAGE_SIGNATURE_BYTES)` before the body |

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| DV-1 | `websiteUploadErrorKey`, `WEBSITE_IMAGE_ACCEPT`, `WEBSITE_IMAGE_MAX_MB`, `WEBSITE_IMAGE_LOGO_FOLDER` and `WebsiteUploadErrorCode` added to `websiteImage.ts` | The two components and the route share one mapping and one list; pure, unit-tested |
| DV-2 | `MediaUploader`'s `catch` now always shows `media.upload.failed` (it showed `err.message`, the browser's English for a network failure or a non-JSON body); the "no URL" case sets `media.upload.no_url` directly instead of throwing | Same intent as SA-F27-2: the owner sees their language, never raw text |
| DV-3 | New `components/website/__tests__/websiteUploadClient.test.tsx` and mutation M-16 | SA-F27-2 is user-visible and had no test in the plan |
| DV-4 | T-3 also refuses `'website-images '` (trailing space) and `''` as a bucket | `''` used to mean "default"; now it is refused like any other non-constant value. No current caller sends it |
| DV-5 | Every failure response carries `code`, 401 included | One client mapping for all failures |
| DV-6 | `description` is `null` when the part has no file name | A bare `Blob` has none; `record` already accepts `null` |

### Verification

| Check | Result |
|---|---|
| New tests | `route.test.ts` 43 / 43; `imageSignature.test.ts` + `websiteImage.test.ts` 38 / 38; `websiteUploadClient.test.tsx` 9 / 9 |
| `components/website`, `lib/validation`, `app/api/website` | 28 suites, 499 / 499 pass |
| Must-stay-green set (every test importing the translations, or naming `MediaUploader` / `MediaLibraryPicker` / `website/upload` / `media.upload`: 48 suites) | 46 / 48 on the first parallel run; the 2 failures (`PlanSection.render`, `PlanUpgrade.render`, 3 tests) were timeouts under load and pass alone (128 / 128). Neither touches a changed file beyond importing the dictionaries |
| `npm run typecheck:bos-llm` | passed: 546 files, 28 errors, **0 new** (it also reports one unrelated baseline entry, `app/api/onboarding/build/route.ts`, as already fixed) |
| Full `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`) | Before (HEAD versions of the 6 modified files swapped in, restored, SHA-1 verified): 1852 errors. After: 1852. Touched files: the **same 16** errors before and after, all pre-existing `TS1117` duplicate keys in `en.ts`/`es.ts` at lines this slice does not touch. New files: 0 |
| eslint on the 9 touched code files | 0 errors; 4 warnings, all pre-existing (3 `no-img-element`, 1 `exhaustive-deps` on `t` in `MediaUploader`, FU-10) |
| `npm run lint:hooks` | clean |
| `console.*` in touched files | none |
| `git diff --stat` | 6 modified files, 212 insertions, 159 deletions: route 179 / 144 (rewrite, DELETE removed), `MediaUploader` 25 / 10, `MediaLibraryPicker` 5 / 2, translations 1 / 1 each. No deletion without insertion. 7 new files (code 143 lines, tests 662 lines, this workplan) |

### Mutations (scratchpad backup, restore in `finally`, SHA-1 verified after each, ASCII output)

All 16 **killed**, each by the test the plan names, none by a compile error:

| # | Killed by |
|---|---|
| M-1 (schema accepts any bucket and `.from()` uses it) | T-3 (all 5 cases) |
| M-2 (accept and ignore a non-default bucket) | T-3 |
| M-3 (folder interpolated into the path) | T-5, T-6, T-7 |
| M-4 (`logos` matched in any segment) | `websiteImage.test.ts` (`logos/../../x`, `logos/`) |
| M-5 (trust `file.type`) | T-9 (both), T-10 |
| M-6 (`contentType: file.type`) | T-10 |
| M-7 (extension from the file name) | T-10 |
| M-8 (`>=` on the size limit) | T-11 |
| M-9 (`Content-Length` pre-check dropped) | T-13 |
| M-10 (`uploadError.message` returned) | T-14 |
| M-11 (SVG added to the allow-list) | `websiteImage.test.ts` |
| M-12 (WebP on `RIFF` alone) | `imageSignature.test.ts` (WAV, RIFF alone) |
| M-13 (`upsert: true`) | T-1 |
| M-14 (file name logged) | T-20 |
| M-15 (`.strict()` dropped) | T-16 (`userId`, `path`) |
| M-16 (picker shows the server `error`) | `websiteUploadClient.test.tsx` (3 cases) |

On M-11: the route cannot be made to accept SVG by the allow-list alone, because `sniffImageSignature` never returns `image/svg+xml`. The allow-list test is the guard; T-8 is the behavioural backstop.

### Questions for SA (code review)

| # | Question |
|---|---|
| QC-1 | DV-4: `bucket=''` is now refused (it used to mean "default"). Keep, or treat `''` as absent like the other optional fields? Dev: keep; no caller sends it |
| QC-2 | DV-2: the `MediaUploader` catch change slightly widens SA-F27-2. Acceptable in this slice? |

---

## SA Code Review (2026-10-16)

**Code Review by SA — 2026-10-16**
**Status:** **APPROVED** (no conditions on the code). Merge path is SA-F27-9: RM may commit and switch on auto-merge once QA passes **with Manual QA items 1, 4 and 5 recorded as actually run** (TL runs them in a browser).

**Read in full:** `app/api/website/upload/route.ts`, `lib/validation/imageSignature.ts`, `lib/validation/websiteImage.ts`, the `MediaUploader.tsx` / `MediaLibraryPicker.tsx` diffs, the three translation diffs, `route.test.ts`, `websiteUploadClient.test.tsx`; the 8 `MediaUploader` call sites (none passes `bucket`, `accept` or `maxSizeMB`, so dropping the `bucket` prop breaks no caller); the picker's `aspect` prop type (`'wide' | 'portrait' | 'square'`, so the new enum refuses nothing a real caller sends).

### Verified

| Check | Result |
|---|---|
| Identity | `getUser()` session only; `user.id` is the only id used in the path and in `record` |
| Zod before any storage/DB call | V-1..V-6 all precede `.from()`; the whole form is parsed by a `.strict()` schema after a one-value-per-key pass (repeated keys refused) |
| Bucket | One constant, `WEBSITE_IMAGE_BUCKET`; schema `z.literal(WEBSITE_IMAGE_BUCKET).optional()`; both `.from()` calls take the constant; no deny-list; no other bucket name in non-test code |
| Path | `websiteUploadPath` → `<uid>/<uuid>.<ext>` or `<uid>/logos/<uuid>.<ext>`; `folder` only selects via last segment `=== 'logos'`; uuid from `crypto.randomUUID()` at the single call site |
| Type | Content type and extension from `sniffImageSignature` on the first 12 bytes (read via `file.slice` before the body); `file.type` / `file.name` never decide; SVG and HTML have no signature and are refused (T-8, T-9) |
| Size | Content-Length pre-check before `formData()` (T-13 spy proves it), authoritative `file.size` check after; 413 `file_too_large` |
| Write | `upsert: false`, `contentType: sniffed` |
| Errors | Fixed `MESSAGES` + `code` on every failure (401 included); storage error only in the log; catch-all `details` dev-only (T-14, T-19) |
| Logs | Warn `{ userId, reason, size }` with fixed reasons; info `{ userId, contentType, size, subFolder }`; no file name, URL, folder, bucket value or section (T-20); no `console.*` |
| DELETE | Gone; module exports only `POST` (T-21) |
| Success shape | Top-level `{ success, url, path, bucket }`, justified in the header (Q-5) |
| `user_media` failure | Still 200 (T-18); `record` is non-fatal |
| D-3 guard SA-D3-5 | No `avatars` literal in non-test code; the only occurrence is the inline `it.each` argument in `route.test.ts`, and the guard skips `__tests__` and `*.test.*` |
| Translations | Each of `en.ts` / `es.ts` / `he.ts` changes only the `media.upload.invalid_type` value (1 / 1 lines) |
| Header comment | SA-F27-5 met: service-role reason, server-derived target, `folder` as selector naming both logo callers, Q-5 shape, DELETE removed on purpose, logos recorded too (FU-5) |

### Merge-collision check (D-3)

`feature/settings-drawer-d3-avatar` (uncommitted, `../neuronforge-settings-drawers`) touches `useAvatarUpload.ts`, `AvatarUpload.tsx`, `UserProfileRepository.ts`, the settings-drawer requirement, and new `app/api/user/avatar/`, `AvatarService.ts`, `lib/validation/avatar.ts` and tests. **No file in common with F-27, translations included.** `origin/main` has no commit on F-27's files since the base `067c4a3e`. Risk: none.

### Re-run (SA, this worktree)

| Set | Result |
|---|---|
| `app/api/website`, `lib/validation`, `components/website` (incl. all 4 F-27 suites) | 28 suites, **499 / 499** |
| Must-stay-green (44 suites naming translations, `MediaUploader`, `MediaLibraryPicker`, `website/upload` or `media.upload`) | 43 / 44 in the parallel run; `MarketingConsentPanel.picker.render` timed out under load and passes alone (19 / 19). It imports none of the changed code beyond the dictionaries |

### Code Review Comments

| # | File | Finding | Severity |
|---|---|---|---|
| CR-1 | `route.ts:179` | `isLogo` is re-derived from the returned path with `startsWith`. Correct, but indirect; `websiteUploadPath` could return the sub-folder alongside the path. Style only | Low (non-blocking) |
| CR-2 | `MediaLibraryPicker.tsx` upload | No browser-side size check, so a file over Vercel's 4.5 MB body limit gets the platform's non-JSON 413 and lands in `catch` as the generic "Upload failed" instead of "too large". Pre-existing, not a regression (the uploader pre-checks size). Suggest later: map `response.status === 413` to `media.upload.too_large` before `response.json()`, in both components. Add to FU-10's batch | Low (non-blocking) |
| CR-3 | `MediaUploader.tsx` type pre-check | Still compares `file.type` with `accept`, so a real photo with an empty browser type is refused in the browser. Pre-existing; the server is the authority. No action | Info |

No High or Medium findings.

### Rulings on Dev questions

| # | Ruling |
|---|---|
| QC-1 | **Keep `bucket=''` refused.** SA-F27-3's empty-is-absent rule covers `folder`, `section` and `aspect`, which carry meaning. `bucket` is an allow-list of one: the only accepted value is the constant. No caller or stale bundle sends `''` (the old `MediaUploader` always appended its `'website-images'` default and no call site overrode it), so refusing it costs nothing and keeps the check a pure equality |
| QC-2 | **Accepted.** Showing `media.upload.failed` in the `catch` and setting `media.upload.no_url` directly is within SA-F27-2's intent (the owner sees their language, never raw text). The error is still logged with `{ err }` |

### Optimisation Suggestions

- CR-1 and CR-2 above, as a follow-up batch with FU-10. Not this PR.

### Code Approved for QA: Yes

---

## QA Report (2026-10-16)

**QA — 2026-10-16**
**Test mode:** full
**Strategy used:** A + B (Jest unit and route integration with mocked auth, storage and repository; the route is pure request-in / response-out, so this exercises every server path) + mutation testing. D (browser) **NOT RUN**: no browser in this session; TL runs Manual QA items 1, 4, 5.
**Focus:** api, security, ui (client mapping only)
**Skipped:** browser checks (see NOT RUN below); live storage (no production queries by rule)
**Input source:** prompt keywords (TL trigger) + workplan Tests / Manual QA

**Verdict: PASS WITH NOTES.** No bugs. Two test gaps found by mutation (both Low, non-blocking, production code is correct). Merge still waits on Manual QA items 1, 4, 5 being run (SA-F27-9).

### Test runs (independent, this worktree)

| Set | Result |
|---|---|
| `components/website`, `lib/validation`, `app/api/website` | **28 suites, 499 / 499** (matches Dev and SA) |
| Must-stay-green: every test file naming `translations`, `MediaUploader`, `MediaLibraryPicker`, `website/upload` or `media.upload` (git ls-files, `.claude/` excluded) | **48 suites, 1127 / 1127**, first run, no timeouts (`PlanSection.render` / `PlanUpgrade.render` passed in the batch) |
| QA probe suite (temporary `zz-f27qa-probe.test.ts`, 35 cases, run then deleted from the worktree; kept in the QA scratchpad) | **35 / 35** |

### Code-level paths (route tests + QA probes)

| Path | Result | Evidence |
|---|---|---|
| Happy path per type: PNG, JPEG, GIF89a, GIF87a, WebP, each sent as `application/octet-stream` named `a.bin` | ✅ Pass | probe: path `<session>/<uuid>.<png/jpg/gif/webp>`, `contentType` from the bytes, `.from('website-images')` only |
| Logo: wizard `folder=logos`, settings `<uid>/logos`, `shared/logos`, and `<otherUid>/logos` | ✅ Pass | T-7 + probe: all `^<session>/logos/<uuid>.png$` |
| Folder escapes: `<session>/../<other>`, `<session>/../<other>/logos`, `/<other>`, `./<other>`, `..\..\x`, `logos\..\..`, `%2e%2e/logos`, `logos/.`, `logos `, ` logos` | ✅ Pass | probe: all stay under `<session>/`, never contain the other id |
| Stale `bucket=website-images` | ✅ Pass | T-4 + probe: 200 |
| `bucket` = `contact-documents`, `avatars`, `business-purge-snapshots`, `purge-snapshots`, `Website-Images`, `website-images/..`, `website-images ` (space), `''`, a Blob | ✅ Pass | T-3 + probe: 400 `invalid_request`, `from` / `upload` / `record` never called, warn `bucket_not_allowed` |
| SVG declared SVG; SVG and HTML bytes declared `image/png` | ✅ Pass | T-8, T-9: 400 `file_type`, nothing written |
| Oversize: file 4 MB + 1; `Content-Length` over limit + 64 KiB (no parse) | ✅ Pass | T-12, T-13 (formData spy not called) |
| Exactly 4 MB; chunked (no `Content-Length`) | ✅ Pass | T-11, T-13b |
| Empty file, two files, string file, no file, repeated folder, oversize folder, unknown keys (`userId`, `path`, `File`, `user_id`, `contentType`, `upsert`) | ✅ Pass | T-16 + probe: 400, nothing written |
| 401 without a session: no form parse, no storage call, body has `code: 'unauthorized'` | ✅ Pass | T-2 + probe (formData spy not called) |
| `getUser()` throwing | ✅ Pass | probe: 500 `internal`, no `details` outside development |
| `DELETE` | ✅ Pass | T-21 + probe: module exports only `POST` (no `DELETE`/`PUT`/`GET`/`PATCH`), so Next.js answers 405 |
| `user_media` `record` returns null | ✅ Pass | T-18: still 200 |
| Storage error text never in the body | ✅ Pass | T-14 |
| No caller values in logs | ✅ Pass | T-20 + probe: six requests (bucket probe, bad section, SVG, unknown key, success with logos folder and section, storage failure) with a marker in file name, bucket, folder, section and key name; marker absent from every info/warn argument |
| Client: no SVG offered, GIF offered by the picker, no `bucket` sent, errors by `code` → translation key | ✅ Pass | `websiteUploadClient.test.tsx` (9 cases) |
| Static: callers of `website/upload` | ✅ | only `MediaUploader.tsx`, `MediaLibraryPicker.tsx`; no call site passes `bucket` |
| Static: other bucket names / `console.*` in the 5 touched code files | ✅ | none / 0 |

### Acceptance coverage

| Acceptance criterion (F-27 contract) | Tested? | Result | Notes |
|---|---|---|---|
| Writes only to `website-images` | ✅ | Pass | T-1, T-3, T-4, probes; mutations Q-3, Q-4 killed |
| Path server-derived under the session user's folder | ✅ | Pass | T-5..T-7, probes; Q-1, Q-9, Q-10 killed; Q-2 **survived** (test gap TG-1) |
| Type from bytes (PNG/JPEG/WebP/GIF), no SVG | ✅ | Pass | T-8..T-10, probes; Q-5, Q-6 killed |
| 4 MB limit, Content-Length pre-check | ✅ | Pass | T-11..T-13b; Q-7 killed |
| Generic errors with `code`; no storage text; dev-only details | ✅ | Pass | T-14, T-19; Q-8, Q-18 killed |
| DELETE removed (405) | ✅ | Pass | T-21, probe |
| Client accept list and code → translation key | ✅ | Pass | client tests; Q-11, Q-12, Q-15 killed |
| No caller values in logs | ✅ | Pass | T-20, probe; Q-16 killed |
| Manual QA 1, 4, 5 (browser) | ❌ | **NOT RUN** | No browser in this session; TL runs them (steps below). Required before merge (SA-F27-9) |
| Manual QA 2, 3, 6, 7, 8, 9 | ⚠️ | Covered at code level only | 2/3/6/7 by route + client tests; 8 by T-3; 9 is unchanged display of existing files |

### Mutations (QA, new; beyond Dev's M-1..M-16)

Backup in the QA scratchpad subfolder, mutate, run the 4 F-27 suites (91 tests), restore in `finally`, SHA-1 compared after each; after the run every touched code file matched the baseline SHA-1 and `git diff --numstat` matched the baseline exactly.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| Q-1 | `folder` text concatenated into the path (helper) | Killed | `websiteImage.test.ts` (14 cases) |
| Q-2 | Route trusts `folder` when it starts with `<session>/` (lets `<session>/../<other>` through) | **Survived** | none (TG-1) |
| Q-3 | Bucket from the form when it starts with `website-`, used in `.from()` | Killed | T-3 (`'website-images '`) |
| Q-4 | `z.literal` → `z.string()` (storage still pinned) | Killed | T-3 (5 cases) |
| Q-5 | `contentType: file.type \|\| sniffed` | Killed | T-10 |
| Q-6 | Extension from the file name when it has a dot | Killed | T-10 |
| Q-7 | Content-Length check skipped, `formData()` parsed first | Killed | T-13 |
| Q-8 | `details` always returned + storage message passed to it | Killed | T-14, T-19 |
| Q-9 | `userId` form field accepted and used as the path owner | Killed | T-16 (`userId`) |
| Q-10 | Logo selector also matches the first segment (`logos/../x`) | Killed | `websiteImage.test.ts` |
| Q-11 | `MediaUploader` shows the raw server `error` | Killed | client test (4 cases) |
| Q-12 | `websiteUploadErrorKey` returns the raw code string | Killed | `websiteImage.test.ts`, client tests |
| Q-13 | Repeated-field check dropped | Killed | T-16 (two files, repeated folder) |
| Q-14 | Empty `bucket` treated as absent | Killed | T-3 (`''`) |
| Q-15 | `MediaUploader` sends `bucket` again | Killed | client test |
| Q-16 | Success log carries `folder` | Killed | T-20 |
| Q-17 | Body parsed before the auth check (401 still returned) | **Survived** | none (TG-2) |
| Q-18 | `user_media` recorded on the storage-failure path | Killed | T-14 |

**16 / 18 killed, none by a compile error.** The QA probe suite kills both survivors (it has a `<session>/../<other>` folder case and a formData spy on the 401 path).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases / test gaps (nice to fix, non-blocking)
1. **TG-1 — no route test with a `folder` that starts with the session id and then escapes** — File: `app/api/website/upload/__tests__/route.test.ts` — Severity: Low. The code is correct (the helper ignores folder text), but a regression to "trust a folder under my own id" (Q-2) passes every test. Fix: add `` `${SESSION}/../${OTHER}` `` to T-6 (or T-5) asserting the path matches `^<session>/<uuid>.png$`.
2. **TG-2 — T-2 does not prove the body is never parsed for an unauthenticated caller** — same file — Severity: Low. Moving `getUser()` after `formData()` (Q-17) would let anonymous callers make the server buffer up to 4.5 MB per request; no test fails. Fix: in T-2, `jest.spyOn(request, 'formData')` and assert not called.
3. **EC-1 — polyglot head:** a file with a valid PNG header followed by HTML is stored as `image/png` with `.png` (probe confirms). Expected by design (sniff is the first 12 bytes); served as `image/png` a browser renders it as an image, not a page. Info only; no action.
4. SA's CR-2 (no browser size pre-check in the picker; Vercel's non-JSON 413 shows "Upload failed") and CR-3 (uploader still pre-checks `file.type`) reconfirmed by reading; both pre-existing.

### NOT RUN (browser; TL to run before merge, SA-F27-9)

Run on a Preview deployment of this branch or local `npm run dev` from this worktree, signed in as a Business OS test account, DevTools Network tab open.

**Item 1 — picture upload (website editor):**
1. Open Business OS → Website editor; select the hero block's image field.
2. Drag a JPEG (under 4 MB) onto the drop zone.
3. Expect: spinner, then the image shows in the block. Network: `POST /api/website/upload` → 200, body `url` contains `/website-images/<your user id>/<uuid>.jpg`; request form has `file` (and no `bucket`).
4. Open the media picker for the same block → the image is in the library grid.

**Item 4 — wizard logo lands under the owner:**
1. Open the Website setup wizard and reach the logo step.
2. Upload a PNG logo.
3. Expect: logo preview shows. Network: request form has `folder=logos`; response `path` is `<your user id>/logos/<uuid>.png` (before F-27 it was `logos/<...>`), `url` contains `/website-images/<your user id>/logos/`.

**Item 5 — SVG refused:**
1. In any image field (hero block), click to open the file chooser: SVG files are not offered (filter shows image types JPEG/PNG/GIF/WebP only).
2. Drag an `.svg` file onto the drop zone.
3. Expect: the message "That file is not an image. Please upload a JPEG, PNG, GIF or WebP." (no SVG mentioned); no `POST /api/website/upload` in Network.
4. Optional: in the media picker, the "upload" file chooser also offers no SVG and does offer GIF.

### Final Status
- [x] Ready for commit — SA APPROVED, QA PASS WITH NOTES, TG-1/TG-2 closed. **Manual QA items 1, 4, 5 waived pre-merge by the user (2026-10-16); to be run by the user after deployment** (replaces the SA-F27-9 pre-merge condition)
- [x] Code-level criteria pass; no bugs. **Ready for commit once TL records Manual QA items 1, 4, 5 as run and passing** (SA-F27-9). TG-1 / TG-2 are optional test additions (Dev may add them before commit; not required)

### QA gap closure (2026-10-16)

**Dev — test file only** (`app/api/website/upload/__tests__/route.test.ts`); no production file changed (SHA-1 of `route.ts`, `websiteImage.ts`, `imageSignature.ts`, `MediaUploader.tsx`, `MediaLibraryPicker.tsx` identical to the QA baseline before and after).

| Gap | Test change | Mutation proof (QA runner, restore in `finally`, SHA-1 verified) |
|---|---|---|
| TG-1 | T-6 is now `it.each` over `../<other>`, `<session>/../<other>`, `<session>/../<other>/logos`; each asserts the path starts with `<session>/`, has no `..`, never contains `<other>` | Q-2 **killed** (T-6 `<session>/../<other>` fails). The `/logos` case passes under Q-2 because Q-2 itself exempts `/logos` folders; it guards the logo-branch variant of the same regression |
| TG-2 | T-2 spies `formData` and `clone` on the request; both asserted never called on the 401 | Q-17 (`request.clone().formData()` before auth) **killed** by T-2; extra variant Q-17b (`request.formData()` before auth) also killed by T-2 |

Re-run: F-27 suites **28 / 501** (was 499; T-6 gained two cases); route suite 45; eslint on the test file clean. QA verdict and the SA-F27-9 merge condition (Manual QA items 1, 4, 5) are unchanged.

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan created | Dev: analysis of route and callers, decisions DC-1..DC-13, contract, tests T-1..T-21, mutations M-1..M-15, live checks LC-1..LC-7, questions Q-1..Q-9. No code |
| 2026-10-16 | SA workplan review | SA: **APPROVED WITH CONDITIONS** SA-F27-1..SA-F27-10. Live checks LC-1..LC-7 (TL, read-only, production) recorded: no evidence the hole was used (LC-2, LC-5), pending the broadened LC-2b re-run (SA-F27-6). LC-3 orphans are not F-27 (FU-7). Q-1..Q-9 ruled: DELETE removed, 4 MB, storage in route, no audit, top-level success shape, reject non-default bucket, **SVG refused as an SA security call (user informed, not asked)**, local helper + FU-1, client edits in scope plus translation lines and code-to-key error mapping (SA-F27-2). FU-2 becomes slice F-27a (separate migration, same TL session as D-3a, keep the 5 MB bucket limit), which needs user decision U-F27-1. No merge-order dependency on D-3/D-3a. New FU-7, FU-8, FU-9 |
| 2026-10-16 | Implementation (Dev) | Code complete, uncommitted. New `lib/validation/imageSignature.ts`, `lib/validation/websiteImage.ts`; route rewritten (DELETE removed); `MediaUploader` / `MediaLibraryPicker` edits; three translation lines; four new test files. SA-F27-1..SA-F27-10 applied; LC-2b recorded (0 rows, no evidence the hole was used); DC-4, RK-1, FU-2 reworded; FU-7..FU-10 added. Tests, tsc before/after, eslint, lint:hooks, typecheck:bos-llm green; mutations M-1..M-16 all killed. Deviations DV-1..DV-6; questions QC-1, QC-2 |
| 2026-10-16 | SA code review | SA: **APPROVED**, no conditions on the code. Every SA-F27 condition verified in the diff; no High/Medium findings; CR-1, CR-2 Low (non-blocking, follow-up with FU-10), CR-3 Info. QC-1: keep `bucket=''` refused. QC-2: accepted. No file overlap with D-3; no drift on `origin/main`. SA re-run: 28 suites 499/499; must-stay-green 43/44 under load, the one timeout passes alone. Merge per SA-F27-9 after QA records Manual QA items 1, 4, 5 as run |
| 2026-10-16 | QA report | QA: **PASS WITH NOTES**, no bugs. Independent re-run: 28 suites 499/499; must-stay-green 48 suites 1127/1127; 35 temporary QA probe cases 35/35 (GIF/WebP happy paths, folder escapes, bucket variants, 401 without parse, logs). New mutations Q-1..Q-18: 16 killed, 2 survived (TG-1 `<session>/../<other>` folder untested at route level; TG-2 T-2 does not prove no body parse) — Low, optional test additions. Manual QA items 1, 4, 5 **NOT RUN** (no browser); exact steps recorded for TL; merge waits on them (SA-F27-9) |
| 2026-10-16 | QA gap closure (Dev) | TG-1: T-6 adds `<session>/../<other>` and `<session>/../<other>/logos` folder cases. TG-2: T-2 asserts `formData` / `clone` never called on the 401. Mutations Q-2, Q-17 (and variant Q-17b) now killed; production SHA-1s unchanged. F-27 suites 28 / 501; eslint clean. Test file only |
| 2026-10-16 | User waiver + release | User waived the pre-merge Manual QA items 1, 4, 5 (SA-F27-9) on 2026-10-16: "let's skip the tests for now, tell me what to test and i will do so after deployment". RM committed, opened the PR against `main` and switched on auto-merge (merge commit). The user runs items 1, 4, 5 after deployment |
