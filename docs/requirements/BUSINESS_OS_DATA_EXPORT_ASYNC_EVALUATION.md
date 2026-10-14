# Evaluation: Business OS Data Export: Background Job + Email vs Direct Download

> **Last Updated**: 2026-10-14

**Created by:** BA
**Date:** 2026-10-14
**Status:** Draft. This is input to DX-4 / DE-8 / SQ-E4 / SQ-E8 of [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md). Nothing here is decided until the user answers §8 and SA reviews §9.

## Overview

The user asked on 2026-10-13: *"exporting all the data will take some time to run, so I wonder if we will need to evaluate spinning a job that does that when user selects export data, but then they get a message saying once data will be ready it will be sent to their email — async job vs sync."* This document compares three ways of delivering the full export (a zip of one CSV per section, `data.json`, a README and the stored files, per DX-3). It estimates how long an export takes against our hosting limits, describes what the owner sees in each option, covers export-before-delete, the admin path and privacy, and lists what we reuse and what is new. **Recommendation (§6): one background engine for every export. If it finishes quickly, the owner downloads on the spot. If not, they get an email.** That keeps the hybrid experience DX-4 recommends without building two different export engines.

> **Which copy was read.** The main working copy's requirement file is **modified and uncommitted**, and it **does contain §0.1** (SA ruling of 2026-10-13), so it matches the GitHub `main` content this brief refers to. Its header still says `Last Updated: 2026-10-05`. DX-3, DX-4, DX-6 (§9.1), DE-8 and DE-10 (§5) were read from that copy and were not changed by §0.1.

---

## Table of Contents

1. [How long does a full export take?](#1-how-long-does-a-full-export-take)
2. [Hosting limits that decide the answer](#2-hosting-limits-that-decide-the-answer)
3. [The three options](#3-the-three-options)
4. [Export before delete, and the admin path](#4-export-before-delete-and-the-admin-path)
5. [Privacy and security of the file](#5-privacy-and-security-of-the-file)
6. [Recommendation](#6-recommendation)
7. [What we reuse vs what is new](#7-what-we-reuse-vs-what-is-new)
8. [New business questions](#8-new-business-questions)
9. [Questions for SA](#9-questions-for-sa)
10. [What must be measured before DE-8 is planned](#10-what-must-be-measured-before-de-8-is-planned)
11. [Change History](#change-history)

---

## 1. How long does a full export take?

These are order-of-magnitude estimates, not measurements. §10 lists what must be measured.

The export reads about **65 included sections** out of roughly 130 tables. The rest are excluded (caches, secrets, platform tables, §3.2 of the requirement). It turns them into CSV and JSON, then **copies every stored file** (contact documents, images, website assets) into the zip.

| Work | Small account (new or light user) | Large account (years of use) |
|---|---|---|
| Rows across all sections | hundreds to a few thousand | 100,000+ (e-mail sends, CRM activities, bookings, audit history, page views dominate) |
| Reading the rows | about 65 reads at roughly 0.05–0.2 s each: **~3–10 s** sequential, less in parallel | many reads must be **paged** (1,000 rows a page): **tens of seconds to a few minutes** |
| Building CSV + JSON | under 1 s | seconds to tens of seconds; file size tens to hundreds of MB |
| Stored files | none to a few MB | **hundreds of MB to several GB** (scanned documents, generated images) |
| Copying files into the zip | seconds | **the dominant cost:** minutes, limited by download speed from Storage and by memory |
| **Total** | **~5–20 s** | **~2–15+ min**, and possibly more than one function run can hold |

**What that means:** the records alone are usually fast. **The files are what make an export slow and large.** A business with a few thousand client documents cannot be zipped inside a normal web request.

---

## 2. Hosting limits that decide the answer

| Limit (Vercel Functions) | Value | Effect on export |
|---|---|---|
| Plan | We run crons every 5 minutes (`vercel.json`), which the Hobby plan does not allow, so we are on **Pro** (SA to confirm) | The values below assume Pro |
| Run time | **300 s default, up to 800 s** when configured per function. Past that the run is killed (504) | A large export with files can exceed it, so the work must be **resumable in parts** |
| Response size | **4.5 MB** for a normal response. Only a **streamed** response avoids it | Even a medium zip fails as a direct download unless it is streamed |
| Memory | about 2 GB by default, configurable | A multi-GB zip **cannot be built in memory**. It must be streamed to Storage |
| Browser wait | The owner's browser and network give up long before 800 s; mobile users switch apps | A direct download of a large export is unreliable even when the server holds out |

Sources: Vercel's functions limitations and duration docs (see the end of §10). The exact interaction of streaming with the 4.5 MB limit under Fluid compute is **not confirmed** (SQ-A1).

---

## 3. The three options

### 3.1 Side by side

| | **A. Direct download for everything** | **B. Always background + email** | **C. Hybrid: direct when small, background when large** (DX-4 today) |
|---|---|---|---|
| **What the owner sees** | Clicks, the browser shows "downloading…" until done. A large account sees a spinner for minutes, then often an error | Clicks, sees "We're preparing your export. We'll email you a link when it's ready." Leaves. An email arrives, the owner opens the link and downloads | Small: like A. Large: like B. The owner does not know in advance which they get |
| **Works for the largest accounts** | **No.** Run time, 4.5 MB and memory limits | Yes, if the job is resumable in parts | Yes, for the large path |
| **Small accounts** | Best: instant | Worse: an email for a 10-second job, and an extra step | Best: instant |
| **Failure handling** | The owner sees an error and retries by hand. Nothing records it | The job retries itself (backoff). After N failures it is marked failed, the owner is told by email and on screen, and we see it | Two different failure paths to build and test |
| **"Don't run two at once"** | Hard: two tabs means two heavy runs | Natural: one open job per account, a second click shows the one in progress | Needs both: a lock on the direct path and the job rule |
| **Where the file lives** | Nowhere: streamed to the browser | A private Storage bucket, deleted after the expiry | Both |
| **Link security** | Not needed (the owner's session) | Needed: see §5 | Needed for the large path |
| **Fits export-before-delete** | Poorly for large accounts | Well, with a status to wait on (§4) | Well for large, two paths for small |
| **Admin "send to owner"** | **Impossible:** the admin is not the owner and must not receive the file | Natural: the admin starts the job, the owner gets the email | Needs the background path anyway |
| **Build effort** | Lowest, but it does not meet DX-1 (files) or DX-8 (all history) for large accounts | Medium: queue, worker, bucket, email, cleanup | **Highest:** both engines, plus a size estimate to choose between them |
| **Running cost** | Lowest | Cents per export (§3.3) | Same as B |

### 3.2 Why "hybrid" as two engines is a trap

Option C as written needs a **size guess before the work starts** (rows + file bytes). A wrong guess picks the direct path for an account that then times out. It also means two code paths for the same file, which can drift apart: one might include a section the other forgot. And the background engine is needed **anyway**, for the admin path and for large accounts. So the background engine is the one that must exist. The question is only whether a small export also uses it.

### 3.3 Cost (order of magnitude)

| Item | Small export | Large export |
|---|---|---|
| Function time | seconds: well under a cent | ~10 min at 2 GB is about 0.3 GB-hours: **a few cents** |
| Storage while it waits for download | negligible (MB for a day or so) | a few GB for a day or so: **cents** |
| Download egress | negligible | a few GB, within or slightly over plan quota: **cents to tens of cents** |
| Email | one transactional email | one transactional email |

Cost is not a deciding factor. **Repeated large exports** are, which is why a cool-down is proposed (§8, BQ-3).

---

## 4. Export before delete, and the admin path

### 4.1 Customer delete (purge slice 5, DX-6)

DX-6 says the export is step 1 of the customer's delete: download it, or tick "I don't want a copy", before reaching the delete preview.

With a background export:
- Step 1 shows **"Prepare my export"** and **"I don't want a copy"**.
- After "Prepare", the step shows the job status on screen (preparing, ready, failed). The owner can wait on the page or come back from the email.
- **The delete cannot continue until the export was downloaded at least once, or the owner ticked "I don't want a copy".** "Ready" or "sent" is not enough. If the account is deleted before the download, the owner can no longer sign in to fetch the file, and the file goes with the account.
- The delete itself also removes any export file still in the bucket. A deleted business's client data must not survive in an export file.

### 4.2 Admin delete (DE-10, DX-6 admin rule)

- The admin preview shows **"Last export: date / never"**, and the export status if one is in progress: requested, ready, downloaded by the owner, expired, failed.
- **"Send this account its export"** starts the same background job. The result is emailed **only to the account's own email address**. The admin never gets the file, a link, or the contents. They see status only.
- DX-6 keeps the admin delete **non-blocking**, because an erasure request must be answerable even if the owner never downloads. The admin preview warns: "An export was sent on <date> and has not been downloaded. Deleting now also deletes it."
- **Open issue:** the owner of an account being deleted may not be able to sign in when the email arrives. See BQ-2.

---

## 5. Privacy and security of the file

The file holds **clients' personal data in bulk** (requirement §2, Group B). It is as sensitive as the whole CRM.

| Rule | How |
|---|---|
| **Only the owner can download** | The email does **not** carry a raw file link. It links to the export page **in the app**. The owner signs in, the server checks the export belongs to them, then issues a **signed Storage link valid for a few minutes**. A forwarded email is useless without the owner's login |
| **Never to an admin** | No admin route can issue a download link for another account's export. The admin "send" path delivers to the target account's own email only (`tenant-isolation-guard` skill: target from the path, delivery to the target's email) |
| **Private storage** | A dedicated **private** bucket (no public URLs). Objects are keyed by account and job id. Service role access only, from server code |
| **Short life** | The file is deleted after the expiry (BQ-1: 24 h recommended, or longer), on account delete, and when a newer export replaces it. A cleanup cron removes anything left past its expiry |
| **Audit every step** | Non-blocking `DATA_EXPORTED`-family audit rows: **requested** (who: owner or admin, the admin as `operator`), **ready** (section counts, size, never contents), **each download** (IP, user agent), **failed**, **expired / deleted**. "Last exported" (DE-9) reads from these |
| **Logs** | Ids, counts and sizes only. No file contents, no client names or emails (requirement §7) |
| **Email content** | Transactional. Says an export is ready and links to the app. **No data in the email body and no attachment** |

---

## 6. Recommendation

**Build one background export engine and use it for every export. Make it feel instant when it is quick.**

1. The owner clicks **"Download my data"**. A job is created (one per account at a time) and **started right away**, not on the next cron tick.
2. The screen shows "Preparing your export…" with the status.
3. **If it is ready within about 30–60 seconds** (most accounts), a **Download** button appears on the same screen. No email is needed, though a short "your export is ready" email can still be sent as a record (BQ-4).
4. **If it takes longer**, the screen says: "This is a large export. You can leave this page. We'll email you when it's ready." The email links to the export page in the app (§5).
5. The same engine serves the **admin "send to owner"** action and the **export step of the delete flow**.

**Why:**
- The owner gets DX-4's experience: instant for small, email for large. **No size guess, and one engine**, so the export cannot differ by size.
- It is the only option that handles the largest accounts, the admin path and export-before-delete with one design.
- It reuses infrastructure we already run (§7). New parts are limited to one queue table, one worker, one bucket and one email.
- It can ship in two slices, matching DE-8's own split: **8a** the engine plus records only (CSV, JSON, README); **8b** files in the zip, resumable parts and the email.

Option A is rejected because it cannot serve large accounts or the admin path. Option C as two engines is rejected for the drift and the size-guess risk (§3.2).

---

## 7. What we reuse vs what is new

| Piece | Reused or new | Notes |
|---|---|---|
| Queue + drain pattern | **Reused:** `durable-queue-drain` skill, [§8.1](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) (claim with `FOR UPDATE SKIP LOCKED`, reaper, dead-letter, idempotency). The payment queue-drain (PR #27) is the template | New **table** for export jobs, following the pattern |
| Retries / "failed after N tries" | **Reused** from the same pattern (attempts, backoff, dead-letter) | |
| Backstop cron | **Reused:** Vercel crons + `CRON_SECRET`, like the 17 existing crons | New cron entry: pick up stuck jobs, and **clean up expired files** |
| Starting the job immediately | **SA to choose** among existing means (e.g. `@upstash/qstash`, already a dependency, or a direct call to the worker). No new provider | So the owner does not wait up to 5 minutes for the cron |
| Section readers | **Reused:** the DE-1…DE-7 export repositories (`...ForUserDataExport`) | The engine only packages what they read |
| Private storage | **Reused:** Supabase Storage (already holds documents and media) | New **private bucket** for exports |
| Signed download link | **Reused:** Supabase Storage signed URLs | Issued only after an owner check |
| Email | **Reused:** `lib/notifications/emailTransport.ts`, `kind: 'transactional'` | New email template (Hebrew and English) |
| Audit | **Reused:** `AuditTrailService` (non-blocking) | New event names next to `DATA_EXPORTED` |
| Zip writer | **New dependency** (none in `package.json` today; `xlsx` does not write general zips). Needs SA review (rule 7) | Must **stream** to Storage, not build in memory |
| Export page / status UI | **New** (part of DE-9) | One "Download my data" control |

---

## 8. New business questions

| # | Question | BA recommendation |
|---|---|---|
| **BQ-1** | **How long do we keep a ready export?** The user suggested 24 h. Owners who don't read email daily will miss it | **3 days**, then deleted, with a one-click "prepare again". The file is sensitive, so not longer. Accept 24 h if you prefer stricter. The **download link itself** always lasts minutes, issued after sign-in |
| **BQ-2** | **Account being deleted by an admin:** the owner may not be able to sign in once the email arrives. Do we email a **direct** link that works without sign-in, for this case only? | **No direct link.** The admin sends the export, and the delete waits until the owner has downloaded or the export has expired (BQ-1). The admin may override with the warning in §4.2. That keeps "only the owner, signed in" without exceptions |
| **BQ-3** | **How often can an owner export?** | **One in progress at a time; at most 3 a day.** A second click shows the export in progress. Admin sends count toward the same limit |
| **BQ-4** | **Email when the owner waited on the page and downloaded at once?** | **No.** Email only when the export was not downloaded from the screen (the owner left, or it took long), and always for admin-started exports. Exports always appear under "Last exported" anyway |
| **BQ-5** | **Very large file collections:** one zip of several GB, or records and files as separate downloads? | **Two downloads when the files are large:** "Your records" (always small, opens in Excel) and "Your files" (one or more parts). An owner who wants their client list should not have to wait for 3 GB of images |

---

## 9. Questions for SA

- [ ] **SQ-A1** Confirm our Vercel plan, `maxDuration` and memory per function, and whether a streamed response escapes the 4.5 MB limit under Fluid compute. That decides whether even the "instant" download is streamed from Storage or from the function. (raised by: BA | status: open)
- [ ] **SQ-A2** How to start the job immediately (QStash, direct worker call, or another existing mechanism) with the cron as backstop. No new provider. (raised by: BA | status: open)
- [ ] **SQ-A3** Resumable parts: one queue row per section or file batch, then a final "assemble" step, so a run killed at 800 s resumes instead of restarting. (raised by: BA | status: open)
- [ ] **SQ-A4** Zip library choice (rule 7): it must stream to Storage. Also the bucket's maximum object size on our Supabase plan, and resumable upload for large objects. (raised by: BA | status: open)
- [ ] **SQ-A5** Consistency: rows change while a long export runs. Is "as of the start time, best effort" acceptable, stated in the README? BA recommends yes. (raised by: BA | status: open)
- [ ] **SQ-A6** The export bucket and the jobs table must be in the purge descriptors (deleted with the account) and in the export classification (excluded, reason "the export itself"). (raised by: BA | status: open)

Together these answer the delivery part of SQ-E4 and SQ-E8 in the main requirement.

---

## 10. What must be measured before DE-8 is planned

| Measure | How | Why |
|---|---|---|
| Rows per included table, for the **largest real account** and a seeded large fixture | read-only count query per table (user runs on PROD) | Read time and CSV size |
| **Stored file bytes and count per account**, per bucket | Storage listing per account | Files are the dominant cost (§1) |
| Time for one full records pass (DE-1…DE-7 readers) | timed run on the largest account | Sets the "instant" window (§6 step 3) |
| Zip-and-upload throughput inside a function | spike on a Preview deploy | Sets the size of a resumable part |
| Peak memory of one part | same spike | Confirms streaming works |

**Sources (hosting limits):** [Vercel Functions limitations](https://vercel.com/docs/functions/limitations) · [Configuring maximum duration](https://blog.vercel.com/docs/functions/configuring-functions/duration) · [Bypassing the body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (BA, draft) | Async vs sync evaluation for the user's 2026-10-13 question. Estimates, Vercel limits, options A/B/C, export-before-delete and admin path, privacy, reuse map. Recommendation: one background engine, instant on screen when quick, email when long. BQ-1…BQ-5, SQ-A1…SQ-A6, measurement list. Main requirement not edited (BA has no Edit tool). Its DX-4 / DE-8 / SQ-E4 / SQ-E8 should point here when next updated |
