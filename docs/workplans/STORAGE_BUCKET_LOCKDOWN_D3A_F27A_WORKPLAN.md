# Workplan: Storage Bucket Lockdown (D-3a + F-27a)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Branch:** `fix/storage-bucket-lockdown-d3a-f27a` (from `origin/main` `68c5f235`, which includes D-3 #428 and F-27 #427)
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §7 F-26 / F-27. Rulings: [D-3 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D3_WORKPLAN.md) → "SA Workplan Review (2026-10-16)" → "LC-2 ruling" items 1-8; [F-27 workplan](/docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md) → SA-F27-7 and U-F27-1
**Date:** 2026-10-16
**Status:** SA APPROVED WITH CONDITIONS (SA-LK-1..SA-LK-9). Dev applied SA-LK-1..SA-LK-5 and the SA-LK-7 note on 2026-10-16 (see [Dev response to SA conditions](#dev-response-to-sa-conditions-2026-10-16)). **Not applied, not committed.** Next: SA delta re-check (SA-LK-9), then QA. **This PR never auto-merges.**
**Applied:** D-3a and F-27a applied to production 2026-10-16 by TL; all checkers, probes and gates passed. See [Applied to production](#applied-to-production-2026-10-16-tl). User app checks F6 / F10 / F11 pending.

## Overview

Two production storage changes, applied by TL by hand in one sitting, each with its own file, checker and rollback. **D-3a (F-26)** removes all eight policies on `storage.objects` that cover the `avatars` bucket. Any signed-in account can currently delete, overwrite or upload any file there. After D-3a the bucket is written only by the service role (`AvatarService`, D-3), and the bucket refuses anything that is not PNG, JPEG, WebP or GIF up to 4 MB. **F-27a (FU-2)** removes all four policies on `website-images` (three signed-in writes and, by SA ruling Q-1, the public read policy) and removes SVG from its type list, keeping the 5 MB limit. Public picture URLs keep working, because the bucket stays public. The live checks showed the SQL editor role does not own `storage.objects`, so the policy removals are done in **Dashboard → Storage → Policies**. Each migration file then sets the bucket limits and asserts that the policies are already gone.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Live Pre-Apply Checks (TL, 2026-10-16)](#live-pre-apply-checks-tl-2026-10-16)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [Order of Operations (TL runbook)](#order-of-operations-tl-runbook)
- [Stop Rules](#stop-rules)
- [Functional Check](#functional-check)
- [Rollback](#rollback)
- [Risks](#risks)
- [Questions for SA](#questions-for-sa)
- [Task List](#task-list)
- [SA Review Notes](#sa-review-notes)
- [Applied to production (2026-10-16, TL)](#applied-to-production-2026-10-16-tl)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| Area | Finding (verified on `68c5f235`) |
|---|---|
| Browser writers to `avatars` | **None.** Only `lib/services/AvatarService.ts` names the bucket (`AVATAR_BUCKET`), on `supabaseServer`. The SA-D3-5 guard (`components/onboarding/hooks/__tests__/useAvatarUpload.guard.test.ts`) pins this |
| Writers to `website-images` | **Three, all service role:** `app/api/website/upload/route.ts` (F-27, `WEBSITE_IMAGE_BUCKET`), `lib/services/GeneratedImageService.ts` (`<uid>/generated/<id>.png`, `image/png`, `upsert: true`), `lib/services/StockImageService.ts` (`<uid>/stock/<id>.jpg`, `image/jpeg`). Each imports `supabaseServer`, and none is `'use client'`. The new test pins this set |
| Browser storage calls at all | One: `CRMContactDrawerV2.tsx:3853` `uploadToSignedUrl` to `contact-documents` (signed by the server, bucket is a server constant). Not affected |
| Anything that **lists** either bucket | Only `BusinessPurgeRepository` (`.list()`, service role, purge/export walk). No browser `list()`. `getPublicUrl` is computed locally and makes no request |
| Public URLs without a SELECT policy | A **public** bucket serves `/storage/v1/object/public/…` without RLS. SELECT policies govern `list()` and authenticated `download()`, and no app path uses either. This is the `business-purge-snapshots` precedent (20260916a), which has no policy and an assertion |
| Bucket limits and the service role | Bucket `file_size_limit` / `allowed_mime_types` bind every upload, the service role included, and are checked on upload only. Existing objects are untouched |
| Fit of the 5 MB `website-images` limit | Unchanged by F-27a, so there is no regression. Generated pictures are PNGs at 1024² / 1536×1024 / 1024×1536; the pre-check row `O generated pictures in website images` reports the largest stored one. The upload route caps at 4 MB itself. Stock JPEGs (`large2x`) are far below 5 MB |
| Fit of the 4 MB `avatars` limit | `AVATAR_MAX_BYTES` is 4 MB (D-3), and LC-3's largest existing object is 1.6 MB |
| Migration number | `20261070` and `20261071`: `origin/main` ends at `20261069`, and no remote branch or local worktree adds a `2026107x` file (checked 2026-10-16) |

---

## Live Pre-Apply Checks (TL, 2026-10-16)

Run read-only on production by TL and recorded here verbatim. These are the **rollback source**.

### LC-8 (ownership)

| Item | Result |
|---|---|
| Owner of `storage.objects` | `supabase_storage_admin` |
| Owner of `storage.buckets` | `supabase_storage_admin` |
| SQL-editor role | `postgres`. **Not** a member of `supabase_storage_admin`, not superuser |
| `postgres` UPDATE on `storage.buckets` | **Yes** (the `20261058` precedent ran) |
| **Reading** | The bucket-limit `UPDATE` runs as SQL. `DROP POLICY` / `CREATE POLICY` on `storage.objects` will most likely fail `42501 must be owner` from the SQL editor. **Primary path: Dashboard → Storage → Policies.** The SQL drops are kept as a documented alternative (one transaction each, so a 42501 leaves nothing applied) |

### Capture: buckets

| Bucket | public | file_size_limit | allowed_mime_types |
|---|---|---|---|
| `avatars` | true | NULL | NULL |
| `website-images` | true | 5242880 | `{image/jpeg,image/png,image/gif,image/webp,image/svg+xml}` |

### Capture: policies on `storage.objects` (all PERMISSIVE)

| # | Policy | Cmd | Roles | Expression | D-3a / F-27a |
|---|---|---|---|---|---|
| 1 | Avatar images are publicly accessible | SELECT | {public} | USING `(bucket_id = 'avatars'::text)` | **remove** (D-3a) |
| 2 | Public can view avatars | SELECT | {public} | USING `(bucket_id = 'avatars'::text)` | **remove** (D-3a) |
| 3 | Users can delete avatars | DELETE | {public} | USING `((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL))` | **remove** (D-3a) |
| 4 | Users can delete their own avatar | DELETE | {public} | USING `((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))` | **remove** (D-3a) |
| 5 | Users can update avatars | UPDATE | {public} | USING `((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL))` | **remove** (D-3a) |
| 6 | Users can update their own avatar | UPDATE | {public} | USING `((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))` | **remove** (D-3a) |
| 7 | Users can upload avatars | INSERT | {public} | WITH CHECK `((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL))` | **remove** (D-3a) |
| 8 | Users can upload their own avatar | INSERT | {public} | WITH CHECK `((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))` | **remove** (D-3a) |
| 9 | Users can delete their website images | DELETE | {authenticated} | USING `((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` | **remove** (F-27a) |
| 10 | Users can update their website images | UPDATE | {authenticated} | USING `((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` | **remove** (F-27a) |
| 11 | Users can upload website images | INSERT | {authenticated} | WITH CHECK `((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))` | **remove** (F-27a) |
| 12 | Website images are publicly readable | SELECT | {public} | USING `(bucket_id = 'website-images'::text)` | **remove** (F-27a; SA Q-1 / SA-LK-1) |

The `alt-sql-recreate-*` files reproduce rows 1-12 exactly; the Jest test pins them against this table. The extra outer parentheses that `pg_policies` prints do not change the meaning.

### Post-deploy gates

| Gate | State |
|---|---|
| D-3 deployed, user's post-deploy checks Q1-Q13 incl. **Q13** (no browser request to `storage/v1/object/avatars`) | **PASSED** (user, reported by TL 2026-10-16) |
| F-27 deployed, its post-deploy checks (items 1, 4, 5) | **PASSED** (user, reported by TL 2026-10-16) |
| U-1 (D-3a approved; TL applies) | Approved |
| **U-F27-1** (approve F-27a) | **Yes** (user, via TL, 2026-10-16; SA-LK-5) |
| U-4 (a) (ask Offir whether unmerged work writes logos to `avatars`) | **Offir emailed; TL proceeds without a reply** (SA-LK-5). No repo code writes to `avatars` except `AvatarService` (four types, service role). An unmerged branch sending an SVG would be refused, and that is the intended effect (RK-3) |
| Q-1 (also remove the `website-images` public read policy) | **SA security call, not a user decision** (SA-LK-5). TL **informs** the user: nothing a user or website visitor sees changes |
| SA-LK-2 (owner of `public.operator_test_account_cleanup` bypasses RLS) | Checked at runbook step 1. If it is not `true`, F-27a still runs but **keeps** the public read policy (back to SA) |
| SA-LK-6 (D-3a proved on production first) | F-27a starts only after D-3a step 7 passes: **F5** 200 with zero `avatars` policies, the D-3a probe's editor row unchanged and non-zero, and SA-LK-2 = `true` |

---

## Implementation Approach

- **Policy removal in the dashboard, limits in SQL (LC-8).** `postgres` holds UPDATE on `storage.buckets` but does not own `storage.objects`. Each migration file is therefore `BEGIN; SET LOCAL lock_timeout; UPDATE storage.buckets …; DO $$ assertion $$; COMMIT;`. The assertion reads `pg_policies` (readable by any role) and **raises if any policy is still present**, which aborts the transaction and leaves the bucket unchanged. The file is idempotent (re-running it sets the same values), and it doubles as proof that the dashboard step happened. It follows the `20260916a` rule: no file that fails halfway.
- **SQL drops are the documented alternative** (`scripts/alt-sql-drop-*.sql`, `DROP POLICY IF EXISTS`, one transaction). They are for a future session in which the SQL role can do it. A 42501 leaves nothing applied.
- **D-3a assertion:** zero policies on `storage.objects` whose `qual || with_check` contains `avatars` (every command), then the bucket row is public, 4194304 bytes, and the four types. This is SA item 5 (c).
- **F-27a assertion (SA-LK-1):** zero policies of **any** command naming `website-images` (the same shape as D-3a), then the bucket row is public, still 5242880 bytes, and the four types (no SVG).
- **Read-only scripts and the editor batch (SA-LK-4).** `SET default_transaction_read_only = on` only takes effect for the **next** transaction. Within its own multi-statement batch, a read-only script is therefore not read-only. That is harmless, because the test pins that none of them contains a write keyword. After it runs, the tab's session is read-only, so every write step goes in a NEW tab. A write step that lands in such a session fails with `cannot execute UPDATE in a read-only transaction` and applies nothing (Stop Rules).
- **Rollback = capture, verbatim**, split the same way: re-create policies in the dashboard (or `alt-sql-recreate-*`), then the rollback SQL restores the captured bucket row and asserts that the policies are back.
- **No comments in pasted SQL**, no word "into" anywhere, no `SELECT … INTO` (assignment by `:=` sub-select instead), and no single-letter aliases. These rules follow the `20261068` / `20261040` precedents and are pinned by the test.
- **Website-images writer guard** (in the migration test, mirroring SA-D3-5): every non-test file under `app/`, `components/`, `lib/` and `hooks/` that names the bucket **and** makes a `.storage` call is one of the three known server files, on `supabaseServer`, not `'use client'`. A new browser writer would otherwise fail only in production after F-27a.
- No `console.*`, no app code, and no plugin or V6 code are touched. No entitlements import.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261070_avatars_bucket_lockdown.sql` | create | D-3a: `avatars` limits + assertion that no policy names `avatars` |
| `supabase/migrations/20261071_website_images_bucket_lockdown.sql` | create | F-27a: `website-images` type list without SVG + assertion that no policy names it (any command); 5 MB kept |
| `scripts/precheck-storage-bucket-lockdown.sql` | create | LC-8 (owners, membership, UPDATE privilege, editor-role RLS bypass, RLS on), SA-LK-2 (owner of `public.operator_test_account_cleanup` and whether it bypasses RLS), both bucket rows, the 12 expected policies (present, command, bucket), unlisted or bucket-less policies, object sizes / SVG counts, largest generated picture. Read-only |
| `scripts/capture-storage-bucket-lockdown-rollback-source.sql` | create | Every `storage.objects` policy (name, permissive, cmd, roles, qual, with_check) plus a ready `CREATE POLICY` line, and both bucket rows plus a ready `UPDATE`. Read-only |
| `scripts/alt-sql-drop-avatars-policies.sql` | create | Alternative to the dashboard: the eight drops, one transaction |
| `scripts/alt-sql-drop-website-images-policies.sql` | create | Alternative: the four drops, one transaction (renamed from `…-write-policies` once the read policy joined it, SA-LK-1 c) |
| `scripts/check-avatars-bucket-lockdown.sql` | create | D-3a checker, `VERDICT` + PASS/FAIL rows. Read-only |
| `scripts/check-website-images-bucket-lockdown.sql` | create | F-27a checker. Read-only |
| `scripts/probe-avatars-bucket-lockdown.sql` | create | Read-only SQL probe: rows visible to `anon`, and to `authenticated` with the JWT claims of an existing object's owner |
| `scripts/probe-website-images-bucket-lockdown.sql` | create | Same for `website-images` |
| `scripts/alt-sql-recreate-avatars-policies.sql` | create | Rollback alternative: the eight captured policies, verbatim |
| `scripts/alt-sql-recreate-website-images-policies.sql` | create | Rollback alternative: the four captured policies (rows 9-12), verbatim (renamed, as above) |
| `scripts/rollback-avatars-bucket-lockdown.sql` | create | Restores `avatars` to NULL / NULL; asserts all eight policies are back |
| `scripts/rollback-website-images-bucket-lockdown.sql` | create | Restores the five-type list (SVG); asserts all four policies are back |
| `supabase/migrations/__tests__/storage-bucket-lockdown.migration.test.ts` | create | Static guard over all 14 SQL files (139 tests) + the website-images writer guard |
| `docs/workplans/STORAGE_BUCKET_LOCKDOWN_D3A_F27A_WORKPLAN.md` | create | This file |

Splicing into the requirement's F-26 / F-27 rows and §0 is TL's job (it lives on the settings-drawer docs stream).

---

## Order of Operations (TL runbook)

Every SQL step is pasted into the Supabase SQL editor. **Read-only scripts set `default_transaction_read_only = on` for the session, so each write step runs in a NEW tab.**

| Step | What | Expected | Done |
|---|---|---|---|
| 0 | Gates: SA-LK-9 delta re-check done; U-F27-1 = yes; U-4 (a) recorded (see [Post-deploy gates](#post-deploy-gates)) | All yes | ⬜ |
| 1 | **Pre-check** `scripts/precheck-storage-bucket-lockdown.sql` (read-only) | LC-8 rows as recorded above; `LC8 current user bypasses rls` recorded; **`LK2 owner of public operator_test_account_cleanup bypasses rls expected true`** shows `bypassrls true` (SA-LK-2; `MISSING` or `false` = F-27a keeps the read policy, back to SA); both bucket rows as captured; `P policies naming avatars` 8 found, `website-images` 4 found; all 12 `P present` = `yes <cmd>`; `P policies naming a watched bucket that this slice does not list` = none; `P policies on storage objects naming no bucket id` = none. Record the `O …` rows here | ⬜ |
| 2 | **Capture** `scripts/capture-storage-bucket-lockdown-rollback-source.sql` (read-only) | Identical to the capture tables above (diff by eye; any difference is a stop) | ⬜ |
| 3 | Probe "before" `scripts/probe-avatars-bucket-lockdown.sql` (read-only) | anon = owner = editor = object count (public SELECT today): the probe works | ⬜ |
| 3b | Probe "before" `scripts/probe-website-images-bucket-lockdown.sql` (read-only, SA-LK-3) | anon = owner = editor = object count: the probe sees rows before the policy goes | ⬜ |
| **D-3a** | | | |
| 4 | **Dashboard → Storage → Policies.** Under `avatars` (or "Other policies under storage.objects"), delete exactly: `Users can upload avatars`, `Users can update avatars`, `Users can delete avatars`, `Users can upload their own avatar`, `Users can update their own avatar`, `Users can delete their own avatar`, `Avatar images are publicly accessible`, `Public can view avatars` | 8 removed; no `avatars` entry remains | ⬜ |
| 5 | NEW tab: **migration** `20261070_avatars_bucket_lockdown.sql` | `Success. No rows returned.` An error naming policies means step 4 missed one: see Stop Rules | ⬜ |
| 6 | NEW tab: **checker** `scripts/check-avatars-bucket-lockdown.sql` | `VERDICT PASS` (C1-C8) | ⬜ |
| 7 | **Probe after** (`probe-avatars…`) and **functional check** F1-F6 | Probe: `anon` 0, owner 0, editor count unchanged. F1-F6 as below | ⬜ |
| **Gate (SA-LK-6)** | F5 = 200 with zero `avatars` policies; the D-3a probe's editor row unchanged and non-zero; step 1's SA-LK-2 row = `true` | Otherwise **stop before F-27a** | ⬜ |
| **F-27a** | | | |
| 8 | **Dashboard → Storage → Policies → `website-images`:** delete exactly `Users can upload website images`, `Users can update their website images`, `Users can delete their website images`, `Website images are publicly readable` | 4 removed; no `website-images` policy remains | ⬜ |
| 9 | NEW tab: **migration** `20261071_website_images_bucket_lockdown.sql` | `Success. No rows returned.` | ⬜ |
| 10 | NEW tab: **checker** `scripts/check-website-images-bucket-lockdown.sql` | `VERDICT PASS` (C1-C8) | ⬜ |
| 11 | **Probe** (`probe-website-images…`) and **functional check** F7-F11 | Probe: anon 0, owner 0, editor count unchanged. F7-F11 as below, and an existing website picture URL still loads | ⬜ |
| 12 | Record every result in this workplan; the user merges the PR **by hand** (never auto-merge) | — | ⬜ |

**Alternative path for steps 4 / 8** (only if a later LC-8 shows the SQL role can manage `storage.objects` policies): run `scripts/alt-sql-drop-avatars-policies.sql` / `scripts/alt-sql-drop-website-images-policies.sql` in a new tab, then continue at step 5 / 9. A `42501 must be owner` error leaves nothing applied; switch to the dashboard.

### The exact SQL, in order

<details>
<summary>1. Pre-check: <code>scripts/precheck-storage-bucket-lockdown.sql</code></summary>

See the file. It is read-only from its first statement and returns `sort_order, item, detail` rows: `READ ME`, `LC8 …` (current user, owners, membership, UPDATE on buckets, current user's RLS bypass, RLS on), `LK2 …` (owner of `public.operator_test_account_cleanup`, its `bypassrls` / `superuser`, and `security definer`; `MISSING` if absent), `B bucket …`, `P policies naming …`, `P present …` × 12, `P … does not list`, `P … naming no bucket id`, `O objects in …` (count, largest, over 4 MB, over 5 MB, SVG), `O generated pictures in website images`, and `checked at utc`.
</details>

**5. Migration D-3a**, `supabase/migrations/20261070_avatars_bucket_lockdown.sql`:

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE storage.buckets
SET file_size_limit = 4194304,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
WHERE id = 'avatars';

DO $$
DECLARE
  lockdown_offenders text;
  lockdown_bucket_rows bigint;
BEGIN
  lockdown_offenders := (
    SELECT string_agg(pg_policies.policyname, ', ' ORDER BY pg_policies.policyname)
    FROM pg_policies
    WHERE pg_policies.schemaname = 'storage'
      AND pg_policies.tablename = 'objects'
      AND (COALESCE(pg_policies.qual, '') || COALESCE(pg_policies.with_check, '')) LIKE '%avatars%'
  );
  IF lockdown_offenders IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Avatars lockdown still sees these policies so nothing was applied: ' || lockdown_offenders;
  END IF;

  lockdown_bucket_rows := (
    SELECT count(*)
    FROM storage.buckets
    WHERE storage.buckets.id = 'avatars'
      AND storage.buckets.public
      AND storage.buckets.file_size_limit = 4194304
      AND storage.buckets.allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
  );
  IF lockdown_bucket_rows <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Avatars lockdown bucket row is missing, not public, or its limits did not take so nothing was applied';
  END IF;
END
$$;

COMMIT;
```

**9. Migration F-27a**, `supabase/migrations/20261071_website_images_bucket_lockdown.sql`: the same shape, with `SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[] WHERE id = 'website-images'`. The assertion has `LIKE '%website-images%'` with no command filter (SA-LK-1), and the bucket row must be public, `file_size_limit = 5242880` and the four types.

**6 / 10. Checkers**: `VERDICT` first, then:

| D-3a check | Expected |
|---|---|
| C1 bucket exists / C2 still public | PASS |
| C3 `file_size_limit` = 4194304 / C4 types = the four (set-equal) | PASS |
| C5 policies naming `avatars` = 0 | PASS |
| C6 each of the eight names absent | PASS × 8 |
| C7 policies on `storage.objects` with no `bucket_id` = 0 (they would reach `avatars`) | PASS |
| C8 RLS still on `storage.objects` | PASS |

| F-27a check | Expected |
|---|---|
| C1 / C2 exists, public | PASS |
| C3 `file_size_limit` still 5242880 / C4 types = the four, no SVG | PASS |
| C5 policies of any command naming `website-images` = 0 | PASS |
| C6 each of the four names absent (incl. `Website images are publicly readable`) | PASS × 4 |
| C7 no bucket-less policy / C8 RLS on | PASS |

---

## Stop Rules

| When | Then |
|---|---|
| Step 1: an LC-8 row differs from the record above (e.g. `postgres` became a member) | Continue on the dashboard path anyway; record it |
| Step 1: `P present` says `NO`, a different command, or `names no …`; or an unlisted policy names a watched bucket; or a bucket-less policy exists | **Stop.** Back to SA: the live state is not what the capture says |
| Step 2: the capture differs from the tables above | **Stop.** Dev updates `alt-sql-recreate-*`, the rollbacks and the test from the new capture; SA re-checks |
| Step 4 / 8: the dashboard shows a policy with a different name for the bucket, or will not delete | **Stop** (do not run the migration) |
| Step 5 / 9 errors `… still sees these policies …` | Nothing was applied. If the named policy is one of the listed ones, delete it in the dashboard and re-run; otherwise **stop**, back to SA |
| Step 5 / 9 errors `bucket row is missing …` | Nothing was applied. **Stop**, back to SA (the bucket is not public or a concurrent change happened) |
| Step 5 / 9 errors `lock timeout` | Nothing was applied; re-run once. If it fails twice, stop and retry off-peak |
| Step 5 / 9 (or a rollback step) errors `cannot execute UPDATE in a read-only transaction` (SA-LK-4) | Nothing was applied: the tab's session was left read-only by a read-only script. Open a fresh tab (reload the editor if the error repeats) and re-run |
| Step 1: SA-LK-2 row is `false` or `MISSING` | D-3a goes ahead. F-27a runs **keeping** the public read policy (the Dev's original shape), which needs the earlier file version: back to SA before step 8 |
| SA-LK-6 gate not met after step 7 | **Stop before F-27a**; record it; back to SA |
| Step 6 / 10: `VERDICT FAIL` | Stop, record the failing rows, back to SA |
| Step 7 / 11: any direct Storage write **succeeds** (2xx with a key) | Stop; remove the probe object (dashboard, service role) and back to SA |
| Step 7 / 11: an **app** path fails (picture upload, website upload, image generation) | Roll that slice back (see [Rollback](#rollback)) only if the failure is the bucket's (Vercel logs show a storage MIME / size / RLS refusal); otherwise it is unrelated: record it, do not roll back |

---

## Functional Check

Use a **test account** only (TL's own, or a dedicated test business). Never act on another account's object.

Setup: `SUPABASE_URL` = the project URL; `ANON` = the public anon key; `JWT` = the test account's `access_token` (browser DevTools → Application → Local Storage → `sb-<ref>-auth-token`); `UID` = its user id; `probe.png` = any small PNG. Do not paste these values into any doc.

| # | Bucket | Action | Command (shape) | Expected after the slice |
|---|---|---|---|---|
| F1 | avatars | Direct upload into own folder | `curl -X POST "$SUPABASE_URL/storage/v1/object/avatars/$UID/d3a-probe.png" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Content-Type: image/png" --data-binary @probe.png` | 4xx, "row-level security" (refused). Before D-3a this succeeded |
| F2 | avatars | Overwrite own current picture | the same with `-X PUT` (or `-H "x-upsert: true"`) on the path in the test account's `profiles.avatar_url` | 4xx (refused) |
| F3 | avatars | Delete own current picture | `curl -X DELETE "$SUPABASE_URL/storage/v1/object/avatars" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"prefixes":["<own path>"]}'` | `[]` (nothing deleted); the picture URL still loads |
| F4 | avatars | Anonymous list | `curl -X POST "$SUPABASE_URL/storage/v1/object/list/avatars" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"prefix":"","limit":100}'` | `[]` |
| F5 | avatars | An existing public avatar URL | open it | 200, image |
| F6 | avatars | App: `/business-os/settings` upload, replace, remove picture (`POST` / `DELETE /api/user/avatar`) | browser | All work (service role). A 4.5 MB PNG is refused by the app (413) |
| F7 | website-images | Direct upload into own folder | F1 with `website-images/$UID/f27a-probe.png` | 4xx (refused). Before F-27a this succeeded |
| F8 | website-images | Overwrite / delete own object | F2 / F3 on an object under `$UID/` | 4xx / `[]` |
| F9 | website-images | Anonymous list | F4 on `website-images` | `[]` |
| F10 | website-images | App: website media upload (`POST /api/website/upload`, MediaUploader) and one logo upload; plus an **existing** website picture URL | browser | Both work and their URLs load; the existing picture URL still loads (200) |
| F11 | website-images | App: one **AI image generation** (writes `<uid>/generated/<id>.png`, `image/png`, service role) | browser | Works. PNG is on the list, and 5 MB is unchanged; the pre-check `O generated…` row gives the largest stored one for reference |

---

## Rollback

**Order (SA-D3-1): roll D-3a back BEFORE reverting D-3.** The old browser hook uploads at the bucket root with `upsert: true` and needs the broad INSERT and UPDATE policies. F-27a has no ordering constraint with F-27: the old route uses the service role, so an F-27 revert under F-27a only loses SVG uploads, which fail closed.

| Slice | Step 1: policies | Step 2: SQL (new tab) | Check |
|---|---|---|---|
| D-3a | Dashboard → Storage → Policies → New policy → "For full customization": re-create the eight rows 1-8 of the capture table (name, operation, target roles = default/public, expression exactly as captured). **Or**, if the SQL role can, `scripts/alt-sql-recreate-avatars-policies.sql` | `scripts/rollback-avatars-bucket-lockdown.sql`: sets `file_size_limit = NULL, allowed_mime_types = NULL` on `avatars`, then asserts that all eight names are back (else nothing is applied) | Pre-check: `P policies naming avatars` 8; bucket row NULL / NULL |
| F-27a | Re-create rows 9-12 (rows 9-11 target role `authenticated`; row 12 target role default/public), or `scripts/alt-sql-recreate-website-images-policies.sql` | `scripts/rollback-website-images-bucket-lockdown.sql`: restores `{image/jpeg,image/png,image/gif,image/webp,image/svg+xml}` (5 MB untouched), then asserts all four names are back | Pre-check: `website-images` 4 found; types with SVG |

The dashboard may prefix its own `bucket_id = '…'` to an expression created under a bucket. The meaning is unchanged, and the rollback assertion checks names only.

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| RK-1 | Between the dashboard step and the migration, policies are gone but the limits are not set | Low | Only removal: no access is widened. The migration follows in minutes and is idempotent |
| RK-2 | A missed or misnamed policy | Low | The migration's assertion refuses (nothing applied); checker C5/C6 |
| RK-3 | Offir's unmerged work sends SVG logos to `avatars` through a service-role path | Low | U-4 (a) before D-3a. The bucket refusal is the intended effect |
| RK-4 | Reverting D-3 after D-3a breaks picture upload on three surfaces | Medium (operational) | Rollback order above; recorded in the D-3 workplan |
| RK-5 | A future browser writer to either bucket fails only in production | Low | SA-D3-5 guard (avatars) + the new website-images writer guard |
| RK-6 | A generated PNG over 5 MB | Low, pre-existing | Unchanged by F-27a (limit kept). The `O generated…` pre-check row shows the largest; `GeneratedImageService` logs the upload failure |
| RK-7 | `DROP POLICY` takes an exclusive lock on `storage.objects` (dashboard or SQL) | Low | Instant on a small table; SQL alternatives carry `lock_timeout = '5s'` |
| RK-8 | Existing SVG / `.ico` objects stay public | Low, pre-existing | Limits apply on upload only; cleanup is the F-15 sweep (U-4 b) |
| RK-9 | Public read on `website-images` lets anyone list every account's folder (user ids, every file name incl. unpublished generated pictures) | **Closed** | SA Q-1 accepted: F-27a removes the policy (SA-LK-1) |
| RK-10 | `20261070` / `20261071` fit **production as it is now** (an `avatars` bucket created in the dashboard; the `20260726` policies removed by hand). Replayed in order on an empty database, nothing creates `avatars` and `20260726` re-creates the website-images policies, so **both assertions raise** (SA-LK-7) | Low (no environment replays today) | Replaying migrations on an empty database needs the dashboard drops, or a pre-created `avatars` bucket, before these two files. **TL carries this note to the environments / staging workplan** |

---

## Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q-1 | **Drop `Website images are publicly readable` too?** Nothing lists `website-images` from the browser (grep: no browser `.list()`; the only `list()` is `BusinessPurgeRepository` on the service role), and public object URLs do not need it. Kept, it lets anyone with the public anon key `list()` every account's folder: user ids and every file name, including generated or stock pictures never published | **Drop it** in F-27a (the 12th removal). The migration assertion would then tighten to "0 policies naming `website-images`" (same shape as D-3a), checker C7 flips to "absent", and the rollback re-creates row 12. That is about ten lines, and covered by U-F27-1's "same way as D-3a" wording; SA decides whether the user must be asked |
| Q-2 | Dashboard path as primary, SQL drops as documented alternative, migrations hold the bucket UPDATE + assertion only. This deviates from the brief's "migration with `drop policy if exists`", per LC-8 and SA item 3 | Accept |
| Q-3 | The website-images writer guard in the migration test (mirrors SA-D3-5): acceptable there, or move it next to the F-27 route tests? | Keep it with the migration it protects |
| Q-4 | The read-only SQL probe sets `request.jwt.claims` to the owner of an existing object (first by `created_at`) to read as that owner, then `RESET`s. Acceptable on production, or use the test account's id only? | Acceptable (read-only, no data leaves the editor); the HTTP functional check uses the test account only |
| Q-5 | Migration numbers `20261070` / `20261071` (free on every remote branch and worktree on 2026-10-16) | Accept |

---

## Task List

- ✅ 1. Read the F-26 / F-27 rows, SA LC-2 ruling items 1-8, SA-F27-7, U-F27-1, and the precedents `20260916a`, `20261040`, `20261058`, `20261068` and their tests
- ✅ 2. Grep writers and listers of both buckets (all service role; no browser `list()`)
- ✅ 3. Pick migration numbers (no `2026107x` anywhere)
- ✅ 4. Write both migrations (bucket UPDATE + assertion) and the alternative SQL drops
- ✅ 5. Write the pre-check (LC-8), capture, checkers and probes
- ✅ 6. Write the rollbacks (dashboard / alternative SQL re-create from the capture + bucket restore with assertion)
- ✅ 7. Record TL's LC-8 and capture (2026-10-16); align the re-create files and the test with the capture
- ✅ 8. Static Jest test: 138 pass; mutation check (5 MB on avatars + SVG left on website-images): 3 fail, restored, 138 pass
- ✅ 9. SA review: APPROVED WITH CONDITIONS SA-LK-1..SA-LK-9
- ✅ 9a. Dev applied SA-LK-1..SA-LK-5 and the SA-LK-7 note; test 139 pass; SA-LK-1 (g) mutation check (6 mutations, each caught) — see below
- ⬜ 9b. SA delta re-check (SA-LK-9)
- ⬜ 10. QA review of the scripts and the functional plan
- ⬜ 11. User sees the diff; RM commits and opens the PR with **auto-merge off**
- ⬜ 12. TL applies per the runbook; records results; the user merges by hand

**Verification run:** `npx jest supabase/migrations/__tests__/storage-bucket-lockdown.migration.test.ts`: 139 passed (after SA-LK-1..5).

---

## SA Review Notes

### SA Review (2026-10-16)

**Reviewed by SA — 2026-10-16**
**Status:** **APPROVED WITH CONDITIONS** (SA-LK-1 to SA-LK-9). The design is right and the SQL is correct. Q-1 is accepted, so F-27a also removes the public SELECT policy, which changes four files and the test. **Before TL's session:** Dev makes SA-LK-1 to SA-LK-5, then SA checks only that change (SA-LK-9). D-3a's migration does not change. This PR never auto-merges.

**Verified on the worktree (`68c5f235`; `origin/main` re-fetched at `bc067640`):**
- All 14 SQL files read line by line. `npx jest supabase/migrations/__tests__/storage-bucket-lockdown.migration.test.ts` gives 138/138.
- The word "into" appears nowhere. There are no comments, quotes are balanced, there are no single-letter aliases, and the files contain no GRANT, REVOKE, ALTER or SECURITY DEFINER.
- The 11 `alt-sql-recreate-*` statements match capture rows 1-11 exactly: names, commands, roles and expressions.
- The bucket lists match the app's own lists. `AVATAR_MIME_TYPES` (`lib/validation/avatar.ts:27`) has the same four types as 20261070. `WEBSITE_IMAGE` types (`lib/validation/websiteImage.ts:33-36`) have the same four as 20261071. `GeneratedImageService` sends `image/png` and `StockImageService` sends `image/jpeg`, both on the list. `AvatarService` uploads `<uid>/<uuid>.<ext>` with `upsert: false`, and the website upload route sends the type it sniffed, with `upsert: false`.
- Every storage call in `app/`, `components/`, `lib/` and `hooks/` that reads either bucket uses the service role. That covers `AvatarService`, `GeneratedImageService`, `StockImageService`, the upload route, and `BusinessPurgeRepository` (`list` and `download` on the default `supabaseServer`; its only instance is `new BusinessPurgeRepository()`). `TestAccountCleanupRepository` also uses `supabaseServer`.
- No code calls `createSignedUrl`, `download` or `list` on either bucket with a user or anon client. No code uses `/object/sign/` or `/object/authenticated/` URLs. Nothing uses `/render/image/` transforms, and `next.config.js` has no `images` config, so `<img>` loads the public URL directly.
- `20261070` / `20261071`: `origin/main` ends at `20261069`. No `2026107x` file exists on `origin/main`.

#### Rulings on Q-1..Q-5

| # | Ruling |
|---|---|
| **Q-1** | **Accepted: drop `Website images are publicly readable` in F-27a.** <br>**Why nothing breaks:** a **public** bucket serves `GET /storage/v1/object/public/…`, and the image-transform and `info/public` routes, through Storage's own privileged connection. RLS is never consulted. A SELECT policy only matters for `list()`, for authenticated `download()` / `info`, for `createSignedUrl` and for user `upsert`. No user or anon client does any of these on `website-images` (see Verified above). The service-role paths (purge, preview, export walk, `upsert: true` in the two image services) bypass RLS. <br>**The one path that needs checking:** `public.operator_test_account_cleanup` (`20261041`..`20261047`, SECURITY DEFINER) counts and lists `website-images` objects (guard G-12) as the **function owner**. If that owner did not bypass RLS, G-12 would count 0 once the policy is gone and the guard would pass silently. That owner is almost certainly `postgres`, which has `BYPASSRLS` on Supabase, but nothing has checked it, so SA-LK-2 checks it before the drop. <br>**Same basis as the avatars SELECT drop?** Yes, with one difference. `avatars` is not in G-12's bucket list, so the avatars drop needs no such check. D-3a's F5 (an existing avatar URL still loads with **zero** SELECT policies on the bucket) also proves the "public URL needs no policy" claim on production before F-27a starts. That is why F-27a's SELECT drop is gated on F5 (SA-LK-6). <br>**User question?** No. U-F27-1 asked to lock the store "the same way as the profile-picture store (D-3a)", and D-3a drops its SELECT policies. Nothing a user or a website visitor sees changes, and there is no business trade-off. TL **informs** the user and does not ask (the BA→SA rule for raw technical forks). Closes RK-9 |
| **Q-2** | **Accepted.** LC-8 shows `postgres` neither owns nor is a member of `supabase_storage_admin`. Dashboard drops first, then a migration holding the bucket `UPDATE` plus an assertion inside one transaction. A failed assertion leaves nothing applied, and that is the `20260916a` "never fails halfway" rule. Both assertions do real work: on production today, D-3a's would match 8 policies and F-27a's 3 (4 after SA-LK-1), so a migration run before the dashboard step aborts. The bucket-row check catches a missing or non-public bucket and an `UPDATE` that matched 0 rows. `pg_policies.cmd` can also be `ALL`, and the `<> 'SELECT'` filter correctly counts it as a write (this becomes moot after SA-LK-1). Keep the `alt-sql-*` drops as the documented alternative. |
| **Q-3** | **Accepted, keep the guard in the migration test.** It protects the precondition of this migration, not of the route. It cannot see a writer whose bucket name arrives through a variable (`BusinessPurgeRepository.from(bucket)`), but every such path today uses the service role, so this is proportionate. Optimisation O-2 below hardens it cheaply. |
| **Q-4** | **Accepted.** The probe is read-only. It returns counts only, never names or contents. `set_config` / `SET ROLE` run inside the editor's single implicit transaction, so an error mid-script rolls them back, and the script ends with `RESET ROLE` and `RESET "request.jwt.claims"`. Borrowing an existing owner's id is what makes the "owner sees 0" row meaningful, because a test account may own no object in `avatars`. Conditions: run it exactly as committed, and never edit it to select `name` or `metadata`. |
| **Q-5** | **Accepted**, `20261070` / `20261071`. Before the PR opens, RM re-checks that no other `2026107x` file has landed on `origin/main` (SA-LK-8). |

#### Other checks

| Item | Finding |
|---|---|
| Limits | `avatars` gets 4194304 bytes and png/jpeg/webp/gif. The app caps at 4 MB (`AVATAR_MAX_BYTES`), and the largest stored file is 1.6 MB. `website-images` keeps 5242880 and drops SVG, which matches SA-F27-7. Limits apply on upload only. The existing SVG / `.ico` objects keep being served by public URL (F-26 (c) / RK-8 unchanged) |
| Existing objects | No `UPDATE` touches `storage.objects`. The pre-check `O …` rows are informational |
| Rollback | **Complete and correctly ordered.** Policies are re-created first (dashboard or `alt-sql-recreate-*`). The bucket SQL then restores the captured row and asserts that the names are back. D-3a is rolled back **before** any D-3 revert (SA-D3-1). F-27a has no ordering constraint with F-27. After SA-LK-1, the F-27a rollback must also restore row 12 |
| "New tab" rule | Correct and fail-safe. If a write step lands on a session the read-only scripts set to `default_transaction_read_only = on`, the `UPDATE` errors and nothing is applied. SA-LK-4 adds that error to Stop Rules. Accuracy note: in the editor's multi-statement batch, the read-only scripts are **not** read-only for that batch itself, because the setting only takes effect for the next transaction. They remain harmless, since the test pins that they contain no write keyword |
| Stop rules | Complete apart from SA-LK-4 and the F-27a gate (SA-LK-6) |
| Fresh database | `20261070` / `20261071` only fit production as it is. On an empty database run in order, `20260726_*` re-creates the website-images policies and nothing creates `avatars`, so both assertions would raise. Recorded as SA-LK-7 for the environments / staging stream. It does not block this apply |

#### Conditions

| # | Condition | Owner | Blocks |
|---|---|---|---|
| **SA-LK-1** | **Q-1 in the files.** (a) `20261071`: remove `pg_policies.cmd <> 'SELECT'` from the assertion, making it "0 policies naming `website-images`", the same shape as D-3a; adjust the message ("still sees these policies"). (b) `check-website-images…`: C5 counts every command; C6 covers the four names; C7 "kept" becomes part of C6 (absent). (c) `alt-sql-drop-website-images-…`: add the 4th drop, and rename the file **or** keep the name and record why. (d) `alt-sql-recreate-website-images-…`: add row 12 verbatim, `CREATE POLICY "Website images are publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'website-images'::text))`. (e) `rollback-website-images…`: assert all **four** names. (f) `probe-website-images…`: expected `0` / `0` / editor count unchanged. (g) Test: flip the "keeps the public read policy" and "never re-creates the read policy" pins, then re-run the mutation check (put the SELECT filter back in the assertion, and leave row 12 out of the re-create: both must fail). (h) Workplan: capture row 12 → **remove** (F-27a), Overview, Implementation Approach, runbook step 8 (4 names), C-tables, F9 → `[]`, RK-9 closed, rollback row F-27a (rows 9-12; row 12 target role default/public) | Dev | F-27a |
| **SA-LK-2** | **Owner bypass check.** Add rows to `precheck-storage-bucket-lockdown.sql`: `rolbypassrls` of `current_user`, and the owner of `public.operator_test_account_cleanup` with its `rolbypassrls` (via `pg_proc` → `pg_roles`; `MISSING` if absent). Pin the rows in the test. **Gate:** if the function owner does not bypass RLS, F-27a still runs but **keeps** the SELECT policy (the Dev's original file shape). Record the result, and back to SA | Dev, then TL at step 1 | F-27a SELECT drop |
| **SA-LK-3** | **A "before" probe for website-images** in the runbook (step 3b). `anon` and owner counts must equal the editor count, which shows the probe can see rows before the policy goes | Dev (doc) | — |
| **SA-LK-4** | **Stop rule:** a write step that errors `cannot execute UPDATE in a read-only transaction` has applied nothing. Open a fresh tab (reload the editor if the error repeats) and re-run. Also add the accuracy note above to Implementation Approach | Dev (doc) | — |
| **SA-LK-5** | **Record the gates in the workplan:** U-F27-1 = **yes** (user, via TL, 2026-10-16). U-4 (a): Offir emailed. TL proceeds without a reply because no repo code writes to `avatars` except `AvatarService` (four types, service role), and an unmerged branch sending an SVG would be refused, which is the intended effect (RK-3). The Q-1 decision is an SA security call: the user is informed, not asked | Dev (doc) | — |
| **SA-LK-6** | **Order gate between the slices.** F-27a starts only after D-3a's step 7 passes, and specifically: **F5** (existing avatar URL 200 with zero `avatars` policies), the D-3a probe's editor row unchanged and non-zero, and SA-LK-2's owner bypass = `true`. This is the production proof that a public bucket with no SELECT policy still serves its URLs | TL | F-27a |
| **SA-LK-7** | **Fresh-database note.** Add RK-10: `20261070` / `20261071` assume production as it is now (an `avatars` bucket created in the dashboard; the `20260726` policies removed by hand). Replaying migrations on an empty database needs the dashboard drops, or a pre-created `avatars` bucket, before these two files. TL carries the note to the environments / staging workplan | Dev (doc), TL | — |
| **SA-LK-8** | Before RM opens the PR, re-check that `origin/main` has no other `2026107x` migration. On a clash, renumber and update the test paths | RM | PR |
| **SA-LK-9** | **SA delta re-check** of SA-LK-1 to SA-LK-4 (four SQL files, the pre-check, the test and the workplan) before TL's session. It is a check of the change only, not a re-review | SA | TL session |

#### Final ordered runbook for TL (after SA-LK-9)

Each write step goes in a **NEW** SQL-editor tab. Use the test account only. Record every result in this workplan.

| Step | Action | Expected |
|---|---|---|
| 0 | Gates: SA-LK-9 done; U-F27-1 yes; U-4 (a) recorded (SA-LK-5) | All yes |
| 1 | `scripts/precheck-storage-bucket-lockdown.sql` | LC-8 as recorded; owners `supabase_storage_admin`; UPDATE on buckets `true`; both bucket rows as captured; `avatars` 8 found, `website-images` 4 found; 12 × `yes <cmd>`; unlisted = none; bucket-less = none; **owner of the cleanup function bypasses RLS = true** (SA-LK-2). Record the `O …` rows |
| 2 | `scripts/capture-storage-bucket-lockdown-rollback-source.sql` | Identical to the capture tables (any difference is a stop) |
| 3 | `scripts/probe-avatars-bucket-lockdown.sql` | anon = owner = editor = object count |
| 3b | `scripts/probe-website-images-bucket-lockdown.sql` | anon = owner = editor = object count |
| **D-3a** | | |
| 4 | Dashboard → Storage → Policies: delete `Users can upload avatars`, `Users can update avatars`, `Users can delete avatars`, `Users can upload their own avatar`, `Users can update their own avatar`, `Users can delete their own avatar`, `Avatar images are publicly accessible`, `Public can view avatars` | 8 gone; no `avatars` policy remains |
| 5 | NEW tab: `supabase/migrations/20261070_avatars_bucket_lockdown.sql` | `Success. No rows returned.` |
| 6 | NEW tab: `scripts/check-avatars-bucket-lockdown.sql` | `VERDICT PASS` |
| 7 | `probe-avatars…` + F1-F6 | anon 0, owner 0, editor unchanged; F1/F2 refused, F3 `[]`, F4 `[]`, **F5 200**, F6 app works |
| **Gate** | SA-LK-6 | F5 200, editor row unchanged, owner bypass `true`. Otherwise stop before F-27a |
| **F-27a** | | |
| 8 | Dashboard → Storage → Policies: delete `Users can upload website images`, `Users can update their website images`, `Users can delete their website images`, `Website images are publicly readable` | 4 gone; no `website-images` policy remains |
| 9 | NEW tab: `supabase/migrations/20261071_website_images_bucket_lockdown.sql` (SA-LK-1 version) | `Success. No rows returned.` |
| 10 | NEW tab: `scripts/check-website-images-bucket-lockdown.sql` | `VERDICT PASS` |
| 11 | `probe-website-images…` + F7-F11 | anon 0, owner 0, editor unchanged; F7/F8 refused; F9 `[]`; F10 upload + logo work and their URLs load; F11 generation works; an existing website picture URL still loads |
| 12 | Record the results; the user merges the PR by hand | — |

**Rollback** (only for a bucket-caused app failure): re-create that slice's policies in the dashboard (D-3a rows 1-8; F-27a rows 9-12), then in a NEW tab run `scripts/rollback-avatars-bucket-lockdown.sql` / `scripts/rollback-website-images-bucket-lockdown.sql`, which assert that the names are back. Roll D-3a back before any D-3 revert.

#### Optimisation Suggestions (non-blocking)

- **O-1:** Pin in the test that the bucket lists equal the app constants (`AVATAR_MIME_TYPES`; the website-image type list). Then a type added to the app but not the bucket fails CI instead of failing as a production upload error.
- **O-2:** In the writer guard, also flag any non-test file that imports `GeneratedImageService` / `StockImageService` / `WEBSITE_IMAGE_BUCKET` from a `'use client'` file.
- **O-3:** Both migrations could also assert "no bucket-less policy on `storage.objects`", the same as checker C7. Low value now that the pre-check and C7 stop on it.

### Approval
[x] Workplan and files approved with conditions. D-3a files are final. F-27a proceeds after SA-LK-1 to SA-LK-5 and the SA-LK-9 delta check. TL applies per the runbook above.

---

### Dev response to SA conditions (2026-10-16)

| Condition | What changed |
|---|---|
| **SA-LK-1 (a)** | `20261071`: the assertion no longer filters `pg_policies.cmd <> 'SELECT'`, so it now counts **any** policy naming `website-images`. Message: "Website images lockdown still sees these policies so nothing was applied: …". The bucket UPDATE and the bucket-row check are unchanged. `20261070` is unchanged |
| **SA-LK-1 (b)** | `check-website-images-bucket-lockdown.sql`: C5 counts every command; C6 covers four names (adds `Website images are publicly readable`); the old C7 "kept" row is removed; the bucket-less and RLS rows are now C7 / C8 |
| **SA-LK-1 (c)** | Renamed `alt-sql-drop-website-images-write-policies.sql` → `alt-sql-drop-website-images-policies.sql`, because it now also drops the read policy (a "write" name would mislead). It holds 4 drops |
| **SA-LK-1 (d)** | Renamed `alt-sql-recreate-website-images-write-policies.sql` → `alt-sql-recreate-website-images-policies.sql` and added row 12 verbatim: `CREATE POLICY "Website images are publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'website-images'::text))` (preceded by its `DROP POLICY IF EXISTS`) |
| **SA-LK-1 (e)** | `rollback-website-images-bucket-lockdown.sql` asserts all **four** names (`<> 4`); the message says "all four policies" |
| **SA-LK-1 (f)** | `probe-website-images-bucket-lockdown.sql`: expected after apply is `0` / `0` / editor count unchanged |
| **SA-LK-1 (g)** | Test: `WEBSITE_POLICIES` (4) and `WEBSITE_CMDS` replace the write-only lists; `CAPTURED_WEBSITE` gains row 12; the "keeps the read policy" and "never re-creates the read policy" pins are flipped (the assertion must have no `cmd` filter, the drop file must contain the read drop, the re-create file must contain row 12 verbatim, the checker must not filter on `cmd`); the probe pin requires `0` / `0`. **139 pass.** Mutation check, each run alone and then restored: (1) SELECT filter put back in the `20261071` assertion → 1 fail; (2) row 12 left out of the re-create file → 2 fail; (3) 4th drop removed → 2 fail; (4) rollback asserts 3 → 1 fail; (5) checker C6 back to three names → 1 fail; (6) pre-check names the wrong function → 1 fail. Restored: 139 pass |
| **SA-LK-1 (h)** | This workplan: Status, Overview, capture row 12 → **remove**, Implementation Approach, Files table, runbook step 8 (4 names) and 10–11, the "exact SQL" note, the F-27a C-table, F9 → `[]`, F10 adds an existing picture URL, RK-9 closed, rollback row F-27a (rows 9-12; row 12 default/public) |
| **SA-LK-2** | `precheck-storage-bucket-lockdown.sql`: row 135 `LC8 current user bypasses rls` (`rolbypassrls`, `rolsuper` of `current_user`); row 136 `LK2 owner of public operator_test_account_cleanup bypasses rls expected true` (owner via `pg_proc.proowner` → `pg_roles`, its `rolbypassrls`, `rolsuper`, and `prosecdef`; one entry per overload; `MISSING` if absent). Pinned in the test. Runbook step 1 and Stop Rules carry the gate |
| **SA-LK-3** | Runbook step 3b: the website-images "before" probe |
| **SA-LK-4** | Stop rule for `cannot execute UPDATE in a read-only transaction`; the batch accuracy note is in Implementation Approach |
| **SA-LK-5** | Post-deploy gates: U-F27-1 = yes; U-4 (a) Offir emailed, proceeding without a reply; Q-1 is an SA call, and the user is informed. SA-LK-2 and SA-LK-6 gates added to the same table |
| **SA-LK-6** | Gate row between step 7 and step 8 in the runbook, plus a stop rule (TL owns it) |
| **SA-LK-7** | RK-10 added; TL carries it to the environments / staging workplan |
| SA-LK-8 / SA-LK-9 | RM / SA. Not Dev actions. Optimisations O-1..O-3 are not taken (non-blocking) |

Every pasted SQL file still contains no comments and never the word "into".

### SA-LK-9 delta re-check (2026-10-16)

**Status:** **PASSED.** SA-LK-1 to SA-LK-5 and SA-LK-7 are applied as required. TL may run the session once QA has passed. This PR never auto-merges. I checked the delta only: read-only, no production query, nothing committed.

| Item | Result |
|---|---|
| `20261070` | Unchanged (bucket UPDATE and assertion as approved) |
| `20261071` | The assertion now counts **any** policy whose expression names `website-images` (no `cmd` filter), the same shape as D-3a. The bucket UPDATE is unchanged and the bucket-row check still requires public, 5242880 and the four types. Correct and not vacuous: on production today it would match 4 policies, so a run before step 8 aborts and nothing is applied |
| Checker | C5 counts every command; C6 covers the four names; C7 (no bucket-less policy) and C8 (RLS on) renumbered. The VERDICT logic is unchanged |
| `alt-sql-drop-website-images-policies.sql` | One transaction, 4 `DROP POLICY IF EXISTS`. The rename is accepted, and no stale reference to the old `…-write-policies` names remains outside the Dev response table |
| `alt-sql-recreate-website-images-policies.sql` | Rows 9-11 unchanged; row 12 verbatim against the capture (SELECT, `public`, `(bucket_id = 'website-images'::text)`) |
| Rollback | Restores the five-type list, 5 MB untouched; asserts all four names back (`<> 4`) |
| Probe | Expects `0` / `0` / editor count unchanged. The role and claims reset is unchanged |
| Pre-check | Row 135 shows `rolbypassrls` / `rolsuper` for `current_user`. Row 136 shows the owner of every `public.operator_test_account_cleanup` overload with `rolbypassrls`, `rolsuper` and `prosecdef`, or `MISSING`. Both are read-only catalog reads |
| Workplan | Capture row 12 → remove; step 3b; step 8 (4 names); SA-LK-6 gate row and stop rule; read-only-transaction stop rule and accuracy note; F9 `[]`; rollback rows 9-12; RK-9 closed; RK-10; gates U-F27-1 / U-4 (a) recorded |
| Test | `npx jest supabase/migrations/__tests__/storage-bucket-lockdown.migration.test.ts`: **139/139** (re-run by SA). The Dev's six mutations cover each changed file |
| "into" / comments | None in any pasted file |

**One reading note for TL at step 1 (no file change):** the LK2 gate passes if, for every listed owner, `bypassrls true` **or** `superuser true`, because a superuser also bypasses RLS. `false`/`false`, or `MISSING`, means F-27a keeps the read policy and comes back to SA, as the runbook says.

**Final runbook:** unchanged from "Final ordered runbook for TL" in the SA Review above. The workplan's own Order of Operations now matches it step for step (0, 1, 2, 3, 3b, 4-7, Gate, 8-12). SA-LK-8 (RM renumber check) remains before the PR opens.

---

## Applied to production (2026-10-16, TL)

**Gates:** SA review and SA-LK-9 delta re-check PASSED. U-1 and U-F27-1 answered yes. The user's D-3 and F-27 post-deploy checks PASSED (Q13 included). Offir emailed.

| Step | Result |
|---|---|
| 1. Pre-check | LC8: `postgres` is not owner or member of the `storage.objects` owner, and may UPDATE `storage.buckets`. `current_user` bypassrls `true`. LK2: cleanup function owner `postgres`, bypassrls `true`, secdef `true`. Policies present: avatars 8/8, website-images 4/4; none unlisted, none bucket-less. Objects: avatars 6 (largest 1599896, 1 svg), website-images 70 (largest 2674392, 6 svg), generated 8 (largest 2674392); none over 4 MB |
| 2. Capture | Matched the recorded 12 rows |
| 3 / 3b. Before probes | anon / owner / editor = 6/6/6 (avatars), 70/70/70 (website-images). Public URLs 200 |
| 4. Dashboard | User deleted the 8 `avatars` policies in Dashboard → Storage → Policies |
| 5. Migration | `20261070_avatars_bucket_lockdown.sql` applied via SQL; no error |
| 6 / 7. Checker + probe | 0 avatar policies. Bucket public, `file_size_limit` 4194304, `allowed_mime_types` {png,jpeg,webp,gif}. anon 0, owner 0, editor 6. anon list `[]`. anon upload 403 "new row violates row-level security policy". Existing avatar public URL 200. website-images policies untouched (4) |
| Gate SA-LK-6 | Met |
| 8. Dashboard | User deleted the 4 `website-images` policies in the Dashboard |
| 9. Migration | `20261071_website_images_bucket_lockdown.sql` applied; no error |
| 10 / 11. Checker + probe | 0 policies naming either bucket; 0 policies on `storage.objects` at all. website-images public, 5242880, {jpeg,png,gif,webp}. anon 0, owner 0, editor 70. anon list `[]`. anon upload 403. Existing website picture public URL 200. avatars still 0/6, URL 200 |

**Pending (user, live site):** F6 profile picture upload / replace / remove; F10 website picture and logo upload; F11 AI image generation.

**Rollback order:** roll back D-3a (`scripts/rollback-avatars-bucket-lockdown.sql`, or `scripts/alt-sql-recreate-avatars-policies.sql`) **before** reverting D-3. F-27a rolls back with `scripts/rollback-website-images-bucket-lockdown.sql`.

---

## QA Testing Report

*(QA to populate.)*

---

## Commit Info

*(RM to populate. Auto-merge OFF: the PR is merged by the user after TL's apply and checker.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan + files created | Dev, on `fix/storage-bucket-lockdown-d3a-f27a` at `68c5f235`. Migrations `20261070` (D-3a) and `20261071` (F-27a), pre-check, capture, checkers, probes, alternative SQL drops / re-creates, rollbacks, static test (138). TL's LC-8 and capture recorded: `postgres` does not own `storage.objects`, so policies go in the dashboard and the migrations hold the bucket UPDATE + assertion. Q-1..Q-5 for SA. Not applied, not committed |
| 2026-10-16 | SA review | SA: **APPROVED WITH CONDITIONS** SA-LK-1..SA-LK-9. Q-1 accepted: F-27a also drops `Website images are publicly readable`, because public URLs, transforms and `<img>` need no SELECT policy and no user or anon client lists, downloads or signs either bucket. The drop is gated on the cleanup function's owner bypassing RLS (SA-LK-2) and on D-3a's F5 (SA-LK-6). Q-2..Q-5 accepted. Added: a website-images "before" probe, a read-only-session stop rule, gates recorded, a fresh-database note (RK-10), and an RM renumber check. SA re-checks the change before TL's session. Final ordered runbook in the SA review |
| 2026-10-16 | Dev applies SA-LK-1..SA-LK-5, SA-LK-7 | F-27a now also removes `Website images are publicly readable`: migration assertion over any command, checker C5/C6 (4 names), the drop and re-create files renamed and given the 4th policy (row 12 verbatim), the rollback asserts 4, the probe expects 0/0. Pre-check gains the editor-role and cleanup-function-owner RLS-bypass rows (SA-LK-2). Runbook: step 3b, SA-LK-6 gate, read-only-session stop rule. Gates recorded (U-F27-1 yes; U-4 (a) proceeding without a reply). RK-9 closed, RK-10 added. Test 139 pass; 6 mutations each caught. `20261070` unchanged. Not applied, not committed |
| 2026-10-16 | SA-LK-9 delta re-check | SA: **PASSED**. `20261070` is unchanged. `20261071` now asserts any policy, and the checker, alt-sql drop / re-create (renamed; row 12 verbatim), rollback (4), probe (0/0), pre-check rows 135/136 and workplan updates are correct. Test 139/139. Reading note: LK2 passes on bypassrls OR superuser. Runbook unchanged |
| 2026-10-16 | Applied to production; committed | TL applied D-3a (`20261070`) and F-27a (`20261071`) to production after the user removed the 8 + 4 policies in the Dashboard. Pre-check, capture, before/after probes and checkers recorded in [Applied to production](#applied-to-production-2026-10-16-tl): 0 policies on `storage.objects`, avatars 4 MB PNG/JPEG/WebP/GIF, website-images 5 MB without SVG, anon upload 403, public URLs 200. SA-LK-8 renumber check clean. RM committed on `fix/storage-bucket-lockdown-d3a-f27a`; PR opened without auto-merge. User app checks F6 / F10 / F11 pending |
