# Tracked migration fails halfway in the SQL editor — `COMMENT ON POLICY` / 42501

> **Last Updated**: 2026-09-16

## Overview

`supabase/migrations/20260722_create_contact_documents_bucket.sql` cannot run to completion in the Supabase SQL editor. It creates four storage policies successfully and then **fails at the end** on four `COMMENT ON POLICY … ON storage.objects` statements, which require table ownership the SQL-editor role does not have.

The failure is cosmetic in its effect — the comments are decoration, and the policies the file creates are live and correct — but the *shape* is the problem: an operator running it sees `ERROR: 42501` and has no way to know from the output that the important statements already landed. It is the "errors halfway, operator guesses what landed" defect, sitting in a tracked migration today.

Found out-of-band while fixing the same defect in a new migration during Business OS purge slice 2. **Not fixed here** — it is outside that slice's scope, and the policies it creates are already live, so there is no urgency. Recorded so it is not lost.

## Table of Contents

1. [What fails, and what does not](#1-what-fails-and-what-does-not)
2. [Evidence](#2-evidence)
3. [Why it matters despite being cosmetic](#3-why-it-matters-despite-being-cosmetic)
4. [Suggested fix](#4-suggested-fix)
5. [Change History](#change-history)

---

## 1. What fails, and what does not

Measured against the live project, 2026-09-16. The distinction is narrower than "storage DDL doesn't work in the SQL editor", and getting it wrong leads to removing statements that were fine:

| Statement | From the SQL-editor role | Evidence |
|---|---|---|
| `INSERT INTO storage.buckets` | ✅ **Works** | `business-purge-snapshots` was created this way |
| `CREATE POLICY … ON storage.objects` | ✅ **Works** | The `contact-documents` policies exist live and were created by exactly this file |
| `DROP POLICY … ON storage.objects` | ✅ Evidently works | Same file, same run |
| **`COMMENT ON TABLE storage.buckets`** | ❌ **`ERROR: 42501: must be owner of table buckets`** | Observed directly |
| **`COMMENT ON POLICY … ON storage.objects`** | ❌ Same class — `COMMENT` checks ownership | 4 occurrences in the file below |

`storage.buckets` and `storage.objects` are owned by `supabase_storage_admin`. `COMMENT` requires ownership specifically; `CREATE POLICY` / `DROP POLICY` evidently resolve through a grant or role membership that the SQL-editor role does have.

## 2. Evidence

**File:** `supabase/migrations/20260722_create_contact_documents_bucket.sql`

```
$ grep -c "^COMMENT ON POLICY" supabase/migrations/20260722_create_contact_documents_bucket.sql
4
```

The four statements sit at the end of the file, after the bucket `INSERT`, four `DROP POLICY` and four `CREATE POLICY` statements. So on a fresh run the bucket and all four policies are created, and *then* the script aborts.

**Not affected:** `supabase/migrations/20260726_fix_website_images_rls.sql` uses the same `DROP`/`CREATE POLICY` pattern but contains no `COMMENT ON`, so it should complete cleanly.

## 3. Why it matters despite being cosmetic

Nothing is broken in production — the policies are live and the comments were never load-bearing. The cost is entirely in what the file teaches the next operator:

- **A red error implies nothing landed.** The natural response to `ERROR: 42501` is to assume the script failed and re-run or investigate, when in fact every functional statement succeeded.
- **It makes the migration untrustworthy as documentation.** `20260722` is the reference example anyone copies when adding a bucket — which is exactly what happened during purge slice 2, reproducing the `COMMENT ON` failure in a new file before it was caught.
- **It is the same class as O-1** (a live database object with no working DDL in the repo). A migration that cannot run is that defect wearing a file extension.

## 4. Suggested fix

Delete the four `COMMENT ON POLICY` statements. Their content — what each policy is for — belongs in the file's own header comment, where it is readable without querying the database and without needing ownership of anything.

If a database-visible comment is genuinely wanted, it has to be applied by a role that owns `storage.objects`, which is not available through the SQL editor.

**Precedent for the shape of the fix:** `supabase/migrations/20260916a_purge_snapshots_bucket.sql` (purge slice 2) hit this and resolved it by moving the rationale into the header and replacing the ownership-requiring statements with a read-only `pg_policies` assertion — which needs no ownership and additionally *verifies* the intended state rather than asserting it in prose.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-16 | Recorded | Found while fixing the identical `COMMENT ON TABLE` failure in a new bucket migration during Business OS purge slice 2. Establishes the narrow distinction: `INSERT`, `CREATE POLICY` and `DROP POLICY` all work from the SQL-editor role; only `COMMENT ON` checks ownership. Not fixed — out of slice scope, and the policies it creates are already live. |
