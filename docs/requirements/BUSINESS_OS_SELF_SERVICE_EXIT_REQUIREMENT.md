# Requirement: Business OS — Customer Self-Service Exit v2 (Delete with Grace, Keep My Account, Cancel Plan, Per-Module Export)

> **Last Updated**: 2026-10-25

**Created by:** BA
**Date:** 2026-10-24 (v1) · 2026-10-25 (v2, rewritten)
**Status:** Draft v2. Needs SA review (§13), then the user's answers to §12.
**Source:** [BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md): the user's revised brief and the TL review notes R-1 to R-10, both binding. It supersedes the v1 brief where they differ.
**Related:** [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md) (deletion design, guards G-4/G-6/G-8/G-9, UD-6) · [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) (Phase 1, DE-1 to DE-10a) · [BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md) · [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) §9 · export switches + Excel requirement (branch `docs/data-export-flags-xlsx`, superseded in part, §8.6)

## What changed from v1

| Topic | v1 (2026-10-24) | v2 (this version) |
|---|---|---|
| Deletion | Paid accounts: delete on the plan's end date (DE-10b.3). Free accounts: delete at once (DE-10b.2) | **One lifecycle for every account:** A request → B rest of the paid period → C 14-day grace → D locked → E admin anonymise (§4) |
| Undo | "Cancel deletion" with a renew choice | **"Keep my account"**: self-service in A–C, support in D, never in E (§5) |
| Plan cancel | SX-1 to SX-3 | Unchanged in substance. Now also the "don't renew" engine that deletion stage A uses (§6) |
| Export | Everyday per-list export (contacts, orders) as CSV / Excel; the ZIP stays | **Per-module export, one background job per module, one joined CSV per module sent as an email attachment.** The ZIP, the 72 h link and "download again" are retired. Files are not exported (§7, §8) |
| Per-list export | EX-1 to EX-3 | **Later** (brief item 6). One small safety fix stays now, because the CRM button has a live bug (LX-1, §9) |
| Excel | One `.xlsx` writer, shared | **Dropped.** CSV is decided (§8.6) |
| Admin prerequisite | Cleanup function to be applied | **Done** (R-1: 20261092 applied 2026-10-25) |
| DE-10b.2 | Unpushed branch, needs a rebase | **Merged** as PR #503, behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` (off). Reworked from "delete now" to "request + grace" as a normal change on `main` (R-2) |

---

## Overview

A Business OS owner can cancel their plan, export the data they choose, ask for their account to be deleted, and change their mind while the deletion is pending, all without writing to us. Deletion follows one rule for every account: the paid period runs out, then 14 days of grace to export, then the account is locked, then an admin runs the existing "close and anonymise". Export becomes a choice of modules, each sent as its own email with one CSV attached.

---

## Table of Contents

1. [What exists today](#1-what-exists-today)
2. [Facts from the TL review that change the design](#2-facts-from-the-tl-review-that-change-the-design)
3. [User stories](#3-user-stories)
4. [Deletion lifecycle A to E](#4-deletion-lifecycle-a-to-e)
5. [Keep my account (reinstatement)](#5-keep-my-account-reinstatement)
6. [Cancel the plan at period end](#6-cancel-the-plan-at-period-end)
7. [Per-module export: what the owner sees](#7-per-module-export-what-the-owner-sees)
8. [Per-module export: rules](#8-per-module-export-rules)
9. [Delivery slices](#9-delivery-slices)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Scenarios: paid and free accounts through A to E](#11-scenarios-paid-and-free-accounts-through-a-to-e)
12. [Open business questions](#12-open-business-questions)
13. [Technical questions for SA](#13-technical-questions-for-sa)
14. [Non-functional requirements](#14-non-functional-requirements)
15. [Out of scope / future roadmap](#15-out-of-scope--future-roadmap)
16. [Notes on integration points](#16-notes-on-integration-points)
17. [Carried SA rulings (v1 review, 2026-10-24)](#17-carried-sa-rulings-v1-review-2026-10-24)
18. [Change History](#change-history)

Evidence tags: ✅ read in code or docs on 2026-10-24 / 2026-10-25 (worktree `neuronforge-selfexit`) · 🧠 from the brief, TL notes or memory, not re-read · ❓ for SA or Dev to verify.

---

## 1. What exists today

| Area | As built | Tier |
|---|---|---|
| Plan cancel | **No Business OS route cancels or resumes a plan.** The Stripe portal's cancel is off (SA-P10); only an operator can cancel in the Stripe dashboard, and the mirror picks it up | ✅ v1 + SA C-1 |
| After a plan ends | **No free tier.** A still-running Founding Partner cohort resumes. Everyone else: 24 h margin, then 5 days read-only (website and booking still up, with a warning), then paused (website and new bookings stop). Data is kept | ✅ SA K-1 |
| Enforcement | Mode is `shadow`, and no gate exists (`ENFORCEMENT_POINTS = {}`). Nothing actually limits a lapsed account today | ✅ SA K-2 |
| Self-delete | DE-10b.2 merged (PR #503), off. It anonymises **at once** after a typed sentence, rate limit, session user only, fails closed | 🧠 R-2 |
| Admin delete | DE-10b.1 engine live on prod. Cleanup function 20261092 applied. Guards G-4, G-6 (plan ended), G-8 (no Stripe Connect), G-9 (no money in flight) | 🧠 R-1 |
| Account lock | **None.** No way to stop a person signing in short of deleting them | 🧠 R-4 |
| Export | "Download my data": one ZIP built in a background job (DE-8a table + start function `20261074`, bucket `business-data-exports`, sweep cron), 39 sections as CSVs plus client documents and website pictures, 72 h link, "download again", ready email (DE-8b, DE-9). Admin export DE-10a on the same ZIP | ✅ `lib/business-os/data-export/` |
| Export limits | 1 running, 3 per rolling 24 h, enforced in the DB start function | ✅ `jobPolicy.ts` |
| What can be exported | Every table's `export` field in `purge/descriptors.ts` (`include` with explicit columns, or `exclude` with a reason), CI-checked. Readers page at 1,000 rows to the end, 100,000-row ceiling | ✅ `classificationTypes.ts`, `sections.ts`, `limits.ts` |
| Email | `emailTransport` (Resend) supports attachments. Resend caps one message at 40 MB including attachments; base64 adds about 33% | 🧠 R-7 |
| CRM list export | **Live bug:** the Export button writes only the 20 rows on screen, without saying so, and does not neutralise a leading `=` / `+` / `-` / `@` (a lead form name like `=HYPERLINK(…)` runs in Excel) | ✅ SA K-3 |

---

## 2. Facts from the TL review that change the design

| # | Fact | Effect here |
|---|---|---|
| R-1 | Cleanup function 20261092 applied; brief item 5 is done | Stage E can run today |
| R-2 | DE-10b.2 merged, off | Reworked on `main`; nobody can self-delete today, so nothing live breaks |
| R-3 | No free tier | Stage C and "after cancel" need a decision: BQ-20 (§12). The design below uses the suggested answer |
| R-4 | No lock exists | New build in DL-4; SA-Q2 |
| R-5 | The user decided on 2026-10-14 "content including files". v2 reverses it: **files are not exported** | Recorded as a decision change (§8.5). Legal open issue 2 stays open |
| R-6 | Retiring the ZIP touches DE-8a/8b/9/10a and the export switches + Excel requirement | §8.6 lists what is retired and what is reused |
| R-7 | Resend 40 MB per message, base64 +33% | Byte budget per email: §8.3 |
| R-8 | Sender comes from `RESEND_FROM_EMAIL`; whether `agentspilot.ai` is verified in Resend is unknown | Ops check before any switch goes on (§9.5) |
| R-9 | Today: 1 running, 3 per 24 h | Replaced by the new request model: §8.4 |
| R-10 | Admin export DE-10a is live on the ZIP | BQ-30: admin sends the module export to the owner |

---

## 3. User stories

**Delete**
- As an **owner**, I want to ask for my account to be deleted myself, so that I do not have to email anyone.
- As an **owner on a paid plan**, I want to keep everything I paid for until the period ends, then have time to take my data.
- As an **owner**, I want clear emails with the dates, so that I know when I can no longer sign in.

**Keep**
- As an **owner who changed my mind**, I want one button, "Keep my account", so that nothing is lost.
- As an **owner whose account is locked**, I want support to be able to open it again before it is deleted.

**Cancel**
- As an **owner on a paid plan**, I want to stop it renewing, see what I lose, and undo it until the end date.

**Export**
- As an **owner**, I want to choose which parts of my data to export, and get each part by email, so that I can move to another tool.
- As an **owner**, I want to see what I exported and when, so that I know I have everything before I leave.
- As the **product owner**, I want every request, export, lock and delete in the audit trail.

---

## 4. Deletion lifecycle A to E

### 4.1 The stages

| Stage | Starts | What the owner has | Email (login email, owner's language) |
|---|---|---|---|
| **A. Request** | Owner confirms in the deletion drawer | Everything as normal. A paid plan is set **not to renew** (same engine as §6) | **"Deletion requested"**: the plan runs to {date}, then 14 days to export, then the account closes on {lock date}. "Keep my account" link |
| **B. Rest of the paid period** (paid only) | At once | The full plan | — |
| **C. 14-day grace** | When the paid period ends (Stripe `ended_at`); at once for an account with no paid plan | What the account normally has once a plan ends (BQ-20 suggestion, §4.2). Can always sign in, view and **export** | **"Your plan has ended. Your account closes on {lock date}"** at the start of C (paid only; free accounts got the dates in the A email). **Reminder 3 days before the lock** (BQ-10) |
| **D. Locked** | End of day 14 of C, in the owner's timezone (BQ-24) | Cannot sign in | **"Your account is closed"**, sent **before** the lock and before E, because a tombstoned address gets no mail |
| **E. Deleted** | An admin runs "close and anonymise" from the ready list on `/admin/users` | — | None. No undo (UD-6). The email can sign up again |

### 4.2 What "free tier" means in stage C (R-3, BQ-20)

There is no free tier. **Suggested meaning:** in stage C the account has **what it would normally have once its plan ends**, with no new level built:

| Account | During the 14 days |
|---|---|
| Founding Partner cohort still running | Keeps its free Founding Partner access |
| Everyone else | Today's rule: 5 days read-only (website still up, with a warning), then paused (website and new bookings stop). Data is kept |
| Already lapsed or paused when they asked | Stays as it is |
| **In every case** | Can sign in, see everything and **export** (entitlements §9 "view and export only") |

Because enforcement is off (K-2), nothing is actually limited today. The screens and emails state the configured rule (SA-15). The emails never say "free tier"; they say "your plan has ended" and "you can still sign in and export your data until {date}".

### 4.3 The request (stage A)

- **Where:** Settings → Danger Zone → "Delete my account" opens the deletion drawer.
- **Steps:**
  1. **Before you go:** "Export your data first" with a button that opens the Export drawer (§7). One line: "Client documents are not in the export. Download them one by one from each client's record."
  2. **Why are you leaving?** The same reason list as the plan cancel (BQ-7), required, list only, no free text (C-10, BQ-17, BQ-32).
  3. **What happens:** the dates for this account, worked out on the server: "Your plan runs to {B end}. Then you have 14 days to export. On {lock date} your account closes and you can no longer sign in. After that it is deleted, and that cannot be undone." A free account sees only the 14-day line.
  4. **Blockers** (BQ-21, open issue 3): the existing check runs first. Stripe Connect still linked (G-8) or money in flight (G-9: running client payment plans, pending payments or refunds) → listed with where to fix each, and **no confirm box**. A failed last payment (`past_due` / `unpaid`) → "Update your card, or contact support" (BQ-11).
  5. **Confirm:** the typed sentence, checked on the server in en/he/es: *"I have exported my data and downloaded my documents"*. Same rules as DE-10b.2: rate limit, session user only, fails closed.
- **On confirm:** the closure record is written (SA-Q1) with request time (the GDPR clock), statement language, reason code, the B end date and whether the plan was renewing; the plan is set not to renew; the "Deletion requested" email; an audit row that survives deletion (§14).
- **The immediate delete of DE-10b.2 is removed.** The only delete is stage E.

### 4.4 While deletion is pending (A to C)

- A **banner on every Business OS page**: "Your account closes on {lock date}. [Keep my account]".
- The plan card reads "Ends on {date}. Your account is set to close." It shows no separate "Keep my plan": "Keep my account" is the one undo.
- **Buying a plan or a Boost is refused:** "Keep your account first" (BQ-18, BQ-34). Nobody is charged for an account that is closing.
- **No freeze otherwise** (DE-10b R-5). The owner keeps working. If they create money in flight or reconnect Stripe, the lock waits (§4.5).

### 4.5 The lock (stage D)

- A daily job finds accounts whose lock time has passed (claim pattern, `durable-queue-drain`).
- It **re-runs the blocker check** first. If something blocks (BQ-22): no lock, one email "We can't close your account yet: {what to fix}", the account stays in C, the check runs again each day, and the admin ready list shows it as "blocked".
- If clear: send "Your account is closed", then lock the sign-in (SA-Q2), then record `locked_at` and an audit row.
- **The public website and booking pages go offline at the lock** (BQ-23 suggestion, +1 d). Otherwise they stay up until E.
- The account then appears on the admin **"ready to delete"** list.

### 4.6 The final delete (stage E)

- `/admin/users` shows the ready list: locked accounts, lock date, days since lock, blocked yes/no.
- The admin runs the existing anonymise engine from the row: `origin: 'admin'`, `reason_category: 'customer_asked'`, `requested_at` = the stored request time, statement rebuilt from the stored language (SA-8 pattern). Guards G-4, G-6, G-8, G-9 apply at that moment, unchanged.
- A refused run shows the reason to the admin. The account stays locked; support contacts the owner.
- After success the closure record is closed and the export history goes with the account (§8.4).

---

## 5. Keep my account (reinstatement)

| Stage | How | Result |
|---|---|---|
| A, B | "Keep my account" in Settings, the banner, or the email link (opens Settings; it signs nobody in) | The request is cancelled. The plan renews again **if the deletion request turned renewal off**. If the owner had already cancelled the plan on its own before, it stays cancelled (BQ-33) |
| C | Same button | The request is cancelled. The account stays in its after-plan state (§4.2). The owner can buy a plan through the normal path |
| D | Support only. An admin clicks "Unlock" on the ready list | Sign-in works again; the request is cancelled; the account is in its after-plan state; the website comes back if it went offline |
| E | Never | The owner can sign up fresh with the same email; nothing is restored |

- Every keep sends **"Your account is kept"** and writes an audit row.
- **Stripe operator reactivates the plan in the dashboard during B** (C-3): treated as "Keep my account": the mirror cancels the request in the same update, and the owner gets the "kept" email (BQ-38).
- **Stripe operator cancels at once during B:** stage C starts at that moment; the dates in the next email follow.

---

## 6. Cancel the plan at period end

Carried from v1 §4 with the SA rulings (SA-1, SA-2, SA-3, SA-5, C-4, C-9). Summary:

- Settings → Plan → **"Cancel plan"** (quiet link) opens a drawer: **reason** (list only, BQ-7 / BQ-17) → **what changes** (case A back to Founding Partner, or case B features you'll lose from `planComparison.ts` rows plus the read-only-then-paused sentence; computed by `planEndingView`, SA-5) → **review** ("Last day {date}", "You will not be charged again", "No refund for the current month", link to Export data) → **confirm**.
- Stripe: cancel at period end, never at once. The card shows "Ends on {date}. It will not renew." with **"Keep my plan"** until that date.
- No offer to stay (brief: plain cancel).
- Refused: failed last payment, upgrade waiting for card confirmation, `trialing` (SA-2), already ended, no Stripe subscription (cohort or admin-given access).
- Emails: "Plan cancelled", "Plan kept", and a reminder 3 days before the plan ends (BQ-36).
- At period end nothing is deleted. The account follows the after-plan rule (§4.2).

**How cancel and delete sit side by side in Settings (brief item 3):**

| Place | Shows |
|---|---|
| Plan section | "Cancel plan" (stop renewing, keep the account). While a deletion is pending: "Ends on {date}. Your account is set to close", no own undo |
| Danger Zone | "Delete my account" (§4.3). While pending: "Your account closes on {date}" + "Keep my account" |
| Banner | Only while a deletion is pending |

One engine sets and clears "don't renew" for both (SX-1). The deletion flow calls it; it does not copy it.

---

## 7. Per-module export: what the owner sees

1. Settings → **"Export data"** opens a side drawer. The Danger Zone's "Download my data" opens the same drawer. The deletion drawer links to it.
2. The drawer lists the modules (§8.1), each with a tick box, plus **"Select all"**. One line: "Files (client documents, website pictures) are not included. Download client documents from each client's record."
3. **"Export"**. The drawer shows: "Your export has started. Each part will arrive in its own email at {login email}." No download in the browser.
4. One **"Export requested"** email lists the chosen modules with the request date and time.
5. Each module arrives in **its own email**, with **one CSV attached** (split into "email 1 of X" when large). The email says the module, when it was requested and when it was produced, in the account's timezone (UTC, labelled, if not set).
6. If a module fails, the others still arrive, and the failed one sends **"This part of your export failed. Please try again"**.
7. The drawer shows the **export history**: module, requested at, status (waiting, working, sent, failed), sent at, number of emails. Newest first.
8. When the limit is reached (§8.4): the Export button is off with "You can export again at {time}".

Export works in every lifecycle state, including read-only, paused and stage C (brief: export stays available during the grace).

---

## 8. Per-module export: rules

### 8.1 The modules

Built from the export classification and a **module map** in config (one pure file, §8.6), never written in the UI. Each `include` section belongs to exactly one module; a CI test fails otherwise. Module names in en/he/es.

| # | Module | Sections (today's ids) |
|---|---|---|
| 1 | Clients | `clients`, `pipeline_stages` (as a label), `client_documents` (document details only, no files) |
| 2 | Activities & tasks | `client_activities`, `client_tasks` |
| 3 | Bookings | `bookings`, `time_off` |
| 4 | Services | `services` |
| 5 | Quotes | `quotes` |
| 6 | Invoices & payments | `invoices`, `payments`, `refunds`, `client_payment_methods` |
| 7 | Payment plans | `payment_plans`, `client_payment_plans`, `installments` |
| 8 | Forms | `intake_settings`, `intake_forms` |
| 9 | Email campaigns | `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` |
| 10 | Newsletter subscribers | `newsletter_subscribers`, `consent_records`, `consent_settings`, `email_unsubscribes` |
| 11 | Website | `website_content`, `website_pages`, `website_blocks`, `images` (picture details only, no files) |
| 12 | Smart links | `smart_links` |
| 13 | **Account & business details** (added, BQ-27) | `account_identity`, `user_profile`, `preferences`, `notification_settings`, `business_profile`, `business_addresses`, `payment_account`, `payment_providers` |

The exact section-to-module placement is a BA default; the user can move any line (BQ-27). What a section holds (columns, allow-lists, row filters) does not change.

### 8.2 "One joined CSV per module"

A module can span several tables. **Suggested shape (BQ-26): one table with a "Record type" column.**

| Column group | What |
|---|---|
| Record type | "Client", "Document", "Activity", "Task", … in the owner's language |
| Belongs to | For child records, the parent's readable name (client name and email, page title), repeated on every row, so each row reads on its own |
| The record's own columns | Each record type's columns. A column another type does not have is blank |
| Lookups | Ids that point at another table become labels where the label is in the same module or is a stage / service / client name (for example stage id → stage name) |
| IDs | Record ID and parent ID kept as the last columns, so a tool can re-link the rows |

Why this shape: it is one valid table, so Excel, Google Sheets and import tools open it and can filter by record type. Options not chosen:
- **Stacked blocks** (a heading line, its own header row, rows, a blank line, the next block): easy to read, but not a valid table; import tools break on it.
- **One row per main record, children squeezed in** (all activities in one cell): loses data or makes huge cells.

A one-table module (Services, Quotes, Smart links) is simply that table with friendly headers.

### 8.3 Emails and splitting

| Rule | Value |
|---|---|
| To | The account's **login email** at send time. Never an address from the request |
| From | `RESEND_FROM_EMAIL`, `notifications@agentspilot.ai` for now (open issue 1); domain verified first (R-8) |
| Attachment | One CSV per email: UTF-8 with BOM, CRLF, every text cell formula-neutralised |
| **Byte budget** | **10 MB of CSV per email** (about 13.4 MB after base64), well under Resend's 40 MB and under the ~20–25 MB that many mailboxes accept (BQ-28) |
| Split | At row boundaries. Every part repeats the header row. Subject and body say "email {n} of {X}". File name `{module}_{YYYY-MM-DD}_part-{n}-of-{X}.csv` (business date, no user data in the name) |
| Maximum | 10 emails per module (100 MB of CSV). Above that the module fails with "This part is too large to email. Please contact support" (BQ-28) |
| Language | Email text and CSV **headers** in the owner's language (en/he/es; Spanish as a draft). Cell values stay as stored, except lookups turned into labels and the "Record type" names (BQ-31) |
| Dates | Requested-at and produced-at in `user_preferences.timezone`; NULL shows "UTC" |
| Money | Amount next to its own currency on every row; no totals |

### 8.4 Limits, history and audit

| Rule | Value |
|---|---|
| Limit (BQ-29) | **2 requests per rolling 24 h** per account, any number of modules each; **one request running at a time**. A request where every module failed does not count. Enforced in the database, as today |
| Admin-started | Do not count against the owner (BQ-30) |
| Module job | Each module is its own job, picked up by a claim-pattern worker (`durable-queue-drain`), retried a fixed number of times, then failed with the email |
| History | One row per module job: module, requested at, status, sent at, email count. Kept until the account is deleted and removed with it (needs purge coverage, SA-Q12) |
| Audit | Per module: requested, completed or failed, delivered. Details: module code, row count, email count, failure code. **Never** content, email address or file names with user data |
| No CSV is stored | The CSV is built, sent and dropped. No bucket, no link |

### 8.5 Files are not exported (R-5)

- **Decision change, recorded:** on 2026-10-14 the user decided the export holds "content including files". On 2026-10-25 (brief v2) the user decided files are **not** exported. Client documents are downloaded one by one from each contact's record; website pictures are not offered.
- The document and picture **details** (name, date, type) stay in the Clients and Website CSVs, so the owner can see what to download.
- **Legal open issue 2 stays open:** as processor we must return the business's client data before deletion (Art. 28(3)(g)). Legal to confirm that one-by-one download plus the typed statement is enough. A bulk download is on the later list.

### 8.6 What is retired and what is reused (R-6)

| Piece | Fate |
|---|---|
| Export classification (`export` field, columns, allow-lists, row filters, CI checks) | **Reused** unchanged |
| Section readers (`listOwnedRowsForExport`, paging, ceiling) | **Reused**; each module job reads its sections through them |
| `csv.ts` (BOM, CRLF, formula prefix) | **Reused** or extended for the joined shape (SA-Q8) |
| `ownerClock.ts` (dates in the owner's timezone) | **Reused** |
| Module map and per-module on/off switches from the export switches requirement (its slice 1) | **Folded in** as MX-0, with the brief's 13 modules instead of its 7. The switches also give the "we export too much" trim a one-line edit |
| Excel (`.xlsx`) writer from that requirement (slices 2–3, SA-1, SA-12) | **Dropped**. CSV is decided. The branch `docs/data-export-flags-xlsx` is marked superseded by this document |
| DE-8a job table + start function (`20261074`) | **SA decides** reuse vs a new request + module-job pair (SA-Q7). BA leaning: new tables (one request, many module jobs, email counts), the old table kept read-only, then dropped in a later migration |
| Bucket `business-data-exports`, sweep cron, 72 h retention | **Retired** after the last ZIP expires |
| ZIP builder (`zipExport.ts`, `zipEntries.ts`, `zipWriter.ts`, `fileManifest.ts`, `readme.ts`) | **Retired** |
| Owner routes: start, download, download again; ready email | **Retired**. "Download my data" opens the drawer |
| Admin export DE-10a (prepare + audited download) | **Replaced** by "Send export to owner" (BQ-30) |
| `BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | **Rewritten** for modules (MX-6) |

---

## 9. Delivery slices

Each slice is its own PR from `main`, never stacked, at most 2.5 days. A slice with a migration is a manual gate. The user sees the diff before commit unless a fast-track is agreed for this stream.

### 9.1 Fix now

| # | Slice | Delivers | Effort |
|---|---|---|---|
| **LX-1** | **CRM list export safety fix** | Contacts export: every text cell formula-neutralised (`lib/payments/csv.ts` `csvCell` rule), button label says "Export this page ({n} rows)" so nothing is cut silently. Orders export: when a source hit the 1,000-row read cap, say so instead of a silent cut. The full filtered export stays on the later list. **Ship first: live security bug** (BQ-37) | 🟢 1 d |

### 9.2 Plan cancel track (shared "don't renew" engine)

| # | Slice | Delivers | Depends on | Effort |
|---|---|---|---|---|
| **SX-1** | Cancel and keep engine | `StripeService.setBusinessOsPlanCancelAtPeriodEnd`, `planCancellation.ts`, routes `…/plan/cancel` and `…/plan/keep`, SA-2 eligibility, fresh attempt key (C-4), mirror write (SA-3), audit, `isPlanSelfCancelEnabled()` off | — | 🟡 2.5 d |
| **SX-2** | Cancel drawer | Reason, what changes (`planEndingView`), review, confirm; en/he/es | SX-1 | 🟡 2 d |
| **SX-3** | Cancel emails, switch on | Cancelled, kept, 3-day reminder (BQ-36); R-3 refusal text; P-7a note (C-1) | SX-2 | 🟢 1.5 d |
| **SX-5** | Stripe Connect fixes | C-5: delete only on Stripe's confirmed deletion, OAuth deauthorize for Standard, D-2 refusal via the check, G-8 wording | — | 🟡 2 d |

Track: **8 d.** Plain cancel live after SX-3.

### 9.3 Export track

| # | Slice | Delivers | Depends on | Effort |
|---|---|---|---|---|
| **MX-0** | Module map + switches | Pure config: 13 modules, section → module, en/he/es names, on/off per module; CI test (every `include` section in exactly one module, no unknown section) | — | 🟢 1.5 d |
| **MX-1** | Request + drawer | Migration (request + module-job tables, DB start function: 2 per 24 h, one running); drawer with ticks, Select all, history list (reads); "Export requested" email; `isModuleExportEnabled()` off | MX-0 | 🟡 2.5 d |
| **MX-2** | Joined CSV builder | Per-module builder (§8.2), header labels en/he/es with a CI test that every exported column has a label, formula safety, lookups to labels. Pure, unit-tested | MX-0 | 🟡 2.5 d |
| **MX-3** | Module jobs + email split | Claim-pattern worker per module job, split by byte budget, "email n of X", failed email, retries, per-module audit, status updates | MX-1, MX-2 | 🟡 2.5 d |
| **MX-4** | History, audit, purge, switch on | Full history in the drawer, purge descriptors and anonymise coverage for the new tables, audit registrations, QA, switch on | MX-3 | 🟢 1.5 d |
| **MX-5** | Admin "Send export to owner" | `requireAdmin` route + button on `/admin/users`: starts the same request for the owner's email, audited as admin-started, does not count to the limit; works in stage D | MX-4 | 🟢 1 d |
| **MX-6** | Retire the ZIP | "Download my data" opens the drawer; owner and admin ZIP routes and UI removed; sweep empties the bucket, then the cron is stopped; old table left read-only; contents doc rewritten; flags-xlsx requirement marked superseded | MX-5 | 🟢 1.5 d |

Track: **13 d.** Per-module export live after MX-4.

### 9.4 Deletion track

| # | Slice | Delivers | Depends on | Effort |
|---|---|---|---|---|
| **DL-1** | Closure record + request / keep engine | Migration (closure record, SA-Q1); request route replacing DE-10b.2's immediate delete (typed sentence, blockers at A, reason code); calls SX-1's engine for "don't renew"; "Keep my account" route (A–C); checkout and Boost refusal while pending; mirror clears the request on a dashboard reactivation (C-3); audit rows that survive deletion | SX-1 | 🟡 2.5 d |
| **DL-2** | Deletion drawer + keep screens | Drawer steps (§4.3) with the link to Export; banner on every page; plan card wording; "Keep my account" in Settings; en/he/es | DL-1, MX-1 (drawer to link to), SX-5 (blocker wording) | 🟡 2 d |
| **DL-3** | Lifecycle job + emails | Daily claim-pattern job: stage C start (from `ended_at`), C-start email, 3-day reminder; "Deletion requested" and "Account kept" emails; each email sent once per stage | DL-1 | 🟡 2.5 d |
| **DL-4** | Lock + admin unlock | Lock at end of day 14 (owner timezone); blocker re-check (BQ-22); "Account closed" email first; sign-in lock and session cut (SA-Q2); admin "Unlock" (`requireAdmin`); website offline at lock (+1 d if BQ-23 yes) | DL-3 | 🟡 2.5 d (+1 d) |
| **DL-5** | Ready-to-delete list + switch on | `/admin/users` ready list (locked, blocked, days since lock); run the existing engine with the stored request time (SA-8 pattern); close the record; QA; switch `isAccountSelfDeleteEnabled()` on | DL-4, MX-4 live | 🟢 1.5 d |

Track: **11 d** (+1 d website offline).

### 9.5 Order, totals, ops gates

**Suggested order:** LX-1 → SX-1 → SX-2 → SX-3 (cancel live) and MX-0 → MX-4 (export live) in parallel with SX-5 → DL-1 → DL-5 (deletion live) → MX-5 → MX-6.
Deletion goes live only **after** export is live, because stage C promises export.

**Total: about 33 working days** (LX 1 + cancel 8 + export 13 + deletion 11), **34 with the website-offline step.**

**Ops gates before switch-on (not builds):**
- `agentspilot.ai` verified in Resend (SPF, DKIM, DMARC) and `RESEND_FROM_EMAIL` set (R-8). Before MX-4 and SX-3.
- `DELETION_RECEIPT_FINGERPRINT_KEY` set in Vercel and checked with one deletion-check call (C-12). Before DL-5.
- Support address: `notifications@agentspilot.ai` replaces the personal Gmail (open issue 1). Before SX-3.

---

## 10. Acceptance criteria

**All slices:** integration tests for happy path, auth failure and invalid input; session user only; Zod `.strict()`; Pino with `correlationId`, ids and codes only; no added CI time; QA records a manual check of the critical path.

**LX-1**
- [ ] A contact named `=HYPERLINK("x")` opens as text in Excel.
- [ ] The Contacts button says how many rows it exports, and the file holds exactly those.
- [ ] An Orders export that hit a read cap tells the owner; it never cuts silently.

**SX-1 to SX-3, SX-5** — as v1 §10.1 with the SA conditions (C-1, C-4, C-5, SA-2), plus:
- [ ] The engine is called by DL-1; there is one "don't renew" code path.
- [ ] The 3-day reminder is sent once, only while the plan is still set to end.

**MX-0**
- [ ] Every `include` section is in exactly one module; an unknown or missing section fails CI.
- [ ] A module switched off is not offered in the drawer and is refused by the route.

**MX-1**
- [ ] Ticking 3 modules creates one request and 3 module jobs; one "Export requested" email lists them with the date and time.
- [ ] A third request inside 24 h is refused with the next possible time; a second while one is running is refused.
- [ ] A request where every module failed does not count.
- [ ] No module name from the browser is trusted: unknown or switched-off modules are refused.

**MX-2**
- [ ] The Clients CSV holds client, document and stage rows in one table, with "Record type" and the client name on each child row.
- [ ] Headers are in the owner's language; every exported column has a label in en/he/es (CI).
- [ ] Every text cell starting with `=`, `+`, `-`, `@`, tab or CR is neutralised; numbers stay numbers.
- [ ] No column outside the classification appears; no secret, token or bank detail (DX-1).

**MX-3**
- [ ] Each module arrives in its own email with the CSV attached, module name, requested-at and produced-at in the owner's timezone.
- [ ] A 25 MB module arrives as 3 emails marked 1 of 3, 2 of 3, 3 of 3, each under the byte budget, each with the header row.
- [ ] One module forced to fail sends the failed email; the others arrive.
- [ ] A killed worker's job is picked up again and does not send the same part twice (claim pattern).
- [ ] Over the maximum emails the module fails with the "too large" email.

**MX-4**
- [ ] The history shows every module job with status, sent at and email count.
- [ ] After stage E, the history and request rows for the account are gone.
- [ ] Audit rows: requested, completed / failed, delivered, with no content.

**MX-5**
- [ ] Only an admin can start it; the CSVs go to the owner's login email, never to the admin.
- [ ] It works for a locked account and does not use the owner's limit.

**MX-6**
- [ ] "Download my data" opens the drawer; the old start, download and download-again routes answer 404.
- [ ] No ZIP is built anywhere; the bucket is empty after the last 72 h window.

**DL-1**
- [ ] With the switch off, the request and keep routes answer 404.
- [ ] A paid account's request sets Stripe to not renew, writes the record and the audit row; a free account's request starts C at once.
- [ ] Blockers at A (Connect, money in flight, failed payment) refuse with where to fix them.
- [ ] The typed sentence is checked on the server in all three languages; wrong text is refused.
- [ ] Keep in A/B restores renewal only if the request turned it off.
- [ ] Buying a plan or a Boost is refused while a deletion is pending.
- [ ] Never a pending request in B on a plan that still renews (invariant test, SA-7 pattern).
- [ ] An operator reactivation in Stripe cancels the request.
- [ ] Nothing is deleted by this route.

**DL-2**
- [ ] The drawer shows the right dates for paid, free and Founding Partner accounts, in the owner's timezone.
- [ ] The banner shows on every Business OS page while pending, and goes after Keep.
- [ ] Hebrew is right-to-left; keyboard only works end to end.

**DL-3**
- [ ] Stage C starts when Stripe reports the plan ended; the C email is sent once.
- [ ] The reminder is sent once, 3 days before the lock; not after a Keep.

**DL-4**
- [ ] At the lock time the "closed" email is sent, then sign-in fails, including for a session that was open.
- [ ] With a blocker at the lock, no lock; one email; the admin list shows "blocked".
- [ ] Admin Unlock restores sign-in and cancels the request; it is audited.

**DL-5**
- [ ] The ready list shows only locked accounts; running the delete uses the stored request time; guards still refuse when they should.
- [ ] After E: the email can sign up again; nothing is restored.

---

## 11. Scenarios: paid and free accounts through A to E

Dates use an Essentials plan renewing on the 28th, request on the 10th, owner timezone Asia/Jerusalem.

### 11.1 Paid account

| # | Situation | Expected |
|---|---|---|
| P-1 | Requests on the 10th, no blockers | A: plan set not to renew; email: "plan runs to the 28th, closes on the 14th of next month". B: full plan to the 28th. C from the 28th: after-plan rule (read-only, then paused), export works. Reminder on the 11th. D: "closed" email, lock at the end of the 14th. E: admin deletes |
| P-2 | Keeps on the 12th (stage A/B) | Request cancelled; plan renews on the 28th; "kept" email; banner gone |
| P-3 | Keeps on the 5th of next month (stage C) | Request cancelled; account stays in its after-plan state; can buy a plan |
| P-4 | Writes to support on the 16th (stage D) | Admin unlocks; sign-in works; after-plan state; website back if it went offline |
| P-5 | Signs up again after E | A fresh account; nothing restored |
| P-6 | Had already cancelled the plan on the 3rd, requests deletion on the 10th, then keeps on the 12th | Request cancelled; the plan **stays** cancelled (BQ-33) |
| P-7 | Tries to buy a Boost on the 15th while pending | "Keep your account first" |
| P-8 | Stripe Connect linked on the 10th | Blocked at A with "Delete your Stripe connection in Settings → Payments"; no confirm box |
| P-9 | Starts a client payment plan on the 1st of next month (stage C) | Allowed. At the lock: no lock, one email naming it, admin list shows "blocked"; re-checked daily |
| P-10 | Last payment failed | "Update your card, or contact support"; no request |
| P-11 | Operator reactivates the plan in Stripe on the 20th | Mirror cancels the request; "kept" email |
| P-12 | Founding Partner (cohort to next June) who also bought Autopilot | C: keeps Founding Partner access for the 14 days; then locked as normal |

### 11.2 Free account (no paid plan: lapsed, Test Flight, Founding Partner, or never paid)

| # | Situation | Expected |
|---|---|---|
| F-1 | Requests on the 10th | A and C start together. Email: "closes on the 24th". Reminder on the 21st. D on the 24th. E by admin |
| F-2 | Keeps on the 15th (stage C) | Request cancelled; "kept" email; nothing else changes |
| F-3 | Locked, asks support on the 26th | Admin unlocks; account as before |
| F-4 | Already paused when asking | Stays paused; can sign in and export for the 14 days |
| F-5 | Exports 5 modules on the 11th and 3 more on the 12th, then tries again on the 12th | Two requests used; the third refused until 24 h after the first |

### 11.3 Export

| # | Situation | Expected |
|---|---|---|
| X-1 | Selects all 13 modules | One "requested" email, then 13 module emails (more if any split); history shows 13 rows |
| X-2 | Clients module is 25 MB | 3 emails, 1 of 3 to 3 of 3 |
| X-3 | Invoices module fails | "Failed" email for it; others arrive; history shows "failed"; the request still counts unless all failed |
| X-4 | Hebrew owner | Hebrew email text and headers; values as stored |
| X-5 | Admin sends the export for a locked account | CSVs go to the owner's login email |

---

## 12. Open business questions

Plain language; each has a suggested answer. **Bold = needed before the slice it names.**

### 12.1 New in v2

- [ ] **BQ-20 There is no free tier. What does the account have during the 14 days, and after a plain cancel?** (R-3; raised by: TL/BA | status: pending user input; **before DL-2 and SX-2**) Options: (a) what it normally has once a plan ends (Founding Partners keep free access; others read-only for 5 days, then paused; export always works); (b) build a new "basic free" level (a pricing decision, weeks of work); (c) keep the plan's full access for the 14 days. **Suggestion: (a).** Nothing new to build, honest copy, and since plan limits are not switched on yet, nobody is actually limited today.
- [ ] **BQ-21 Block the request at once if Stripe is connected or money is in flight?** (open issue 3; status: pending user input; **before DL-1**) **Suggestion: yes,** so nobody is surprised two months later. The admin delete checks again anyway.
- [ ] **BQ-22 If money in flight appears during the 14 days, what happens at the lock date?** (raised by: BA; **before DL-4**) **Suggestion:** don't lock; email the owner once with what to fix; check again each day; the admin sees "blocked".
- [ ] **BQ-23 Should the public website and booking pages go offline when the account is locked?** (raised by: BA; **before DL-4**) **Suggestion: yes** (+1 day). A closed account with a live website is confusing for its clients.
- [ ] **BQ-24 When exactly is "day 14 ends"?** (raised by: BA) **Suggestion:** the end of the 14th day in the owner's timezone (UTC if not set).
- [ ] **BQ-25 The export switches + Excel requirement:** keep the switches, drop Excel? (R-6) **Suggestion: yes.** The switches become the module list (MX-0); Excel is not needed now CSV is decided.
- [ ] **BQ-26 What "one joined CSV" looks like.** (raised by: BA; **before MX-2**) **Suggestion:** one table with a "Record type" column and the client's name on every row (§8.2). Stacked blocks look nice but break import tools.
- [ ] **BQ-27 The module list.** (**before MX-0**) **Suggestion:** the brief's 12 plus a 13th, "Account & business details" (your own profile and business settings; you have a right to them too), placed as in §8.1.
- [ ] **BQ-28 How big may one export email be?** (R-7) **Suggestion:** 10 MB of CSV per email (many mailboxes reject over ~20–25 MB), at most 10 emails per module; bigger → "please contact support".
- [ ] **BQ-29 The limit.** (R-9) **Suggestion:** 2 requests per rolling 24 hours, one running at a time; a request that fully failed doesn't count.
- [ ] **BQ-30 The admin export.** (R-10) **Suggestion:** the admin can only send the same module export to the owner's email (also works when locked); the admin ZIP is retired. The admin never receives client data.
- [ ] **BQ-31 Translate only the column headers, or the values too?** **Suggestion:** headers, record types and lookup labels only. Status words stay as stored in release 1.
- [ ] **BQ-32 A reason picker in the deletion drawer too?** **Suggestion:** yes, the same list as cancel, list only.
- [ ] **BQ-33 Owner cancelled the plan earlier, then asked for deletion, then keeps the account. Does the plan renew again?** **Suggestion:** no. Keep only undoes what the deletion request did.
- [ ] **BQ-34 May the owner buy Boost credits while deletion is pending?** **Suggestion:** no, "Keep your account first", like plans (BQ-18). (v1 allowed it with a warning.)
- [ ] **BQ-35 Files reversal, confirm the record.** (R-5) On 2026-10-14 you decided "content including files"; v2 says files are not exported. **Suggestion:** confirm; the drawer says so plainly; legal open issue 2 stays open.
- [ ] **BQ-36 A reminder 3 days before a cancelled plan ends** (the plain cancel, not deletion)? **Suggestion:** yes, half a day.
- [ ] **BQ-37 Fix the CRM export bug now, even though list export is "later"?** **Suggestion:** yes, one day: it exports only 20 rows without saying so, and it can run a formula planted through a public lead form.
- [ ] **BQ-38 If someone at our company reactivates the plan in Stripe while deletion is pending, is that "Keep my account"?** **Suggestion:** yes, with the "kept" email.

### 12.2 Carried from v1, still open

- [ ] **BQ-7 The reason list.** **Suggestion:** Too expensive · Not using it enough · Missing a feature I need · Moving to another tool · My business is closing or pausing · Technical problems · Other.
- [ ] **BQ-9 Credits.** **Suggestion:** monthly credits work through the 5 read-only days and stop when paused (C-9); Boost credits stay until the account is deleted, then are lost, no refund.
- [ ] **BQ-11 Failed last payment.** **Suggestion:** no self-service cancel or deletion request; "update your card, or contact support".
- [ ] **BQ-12 Soft Disconnect of Stripe with running client plans.** **Suggestion:** warn, allow.
- [ ] **BQ-15 Switch on while plan limits are not enforced?** **Suggestion:** yes; the copy states the configured rule.
- [ ] **BQ-17 List only, no free-text reason.** **Suggestion:** yes.
- [ ] **BQ-18 Buy a plan while deletion is pending?** **Suggestion:** no, Keep first.
- [ ] **BQ-19 Stripe connection delete refuses when Stripe won't let go.** **Suggestion:** yes, honest refusal.
- [ ] **Open issue 1 (BQ-3):** `notifications@agentspilot.ai` as sender and support contact for now.
- [ ] **Open issue 2:** legal confirmation on files (§8.5).

### 12.3 Closed by the v2 brief

BQ-1 (no offer to stay: plain cancel) · BQ-2 (login email, owner's language) · BQ-4, BQ-13, BQ-14 (per-list export moved to later) · BQ-5 (replaced by §6 "side by side") · BQ-6 (became BQ-20) · BQ-8 (Keep in A/B renews, refined by BQ-33) · BQ-10 (reminder 3 days before the lock) · BQ-16 (admin reasons page stays later).

---

## 13. Technical questions for SA

Not for the user.

- [ ] **SA-Q1 Where the closure record lives.** SA-8 put the schedule on `business_os_billing_accounts`. A free account may have no billing row. BA leaning: a small server-write-only table, one row per user: `requested_at`, `statement_language`, `reason_code`, `renewal_was_on`, `grace_starts_at`, `lock_at`, `locked_at`, `blocked_at`, `kept_at`, `closed_at`. Or billing-row columns plus a row created on request. Partial unique "one open request per user". Covered by purge and anonymise. (raised by: BA | status: open)
- [ ] **SA-Q2 The lock.** Supabase Auth `ban_duration` through the admin API? How an open session is cut (refresh stops, but the access token lives until expiry: a server check in middleware or `getUser` path?). Unlock = clear the ban. Interaction with the anonymise engine, which closes the login itself. (raised by: BA | status: open)
- [ ] **SA-Q3 Who moves the stages.** One daily claim-pattern job for C start, reminder, lock and re-check? C start from the mirror's `ended_at`, with a fallback from tier dates if the webhook is late? Lock time = end of day 14 in `user_preferences.timezone`. Emails exactly once per stage (stage columns as the dedupe). Vercel cron cadence. (raised by: BA | status: open)
- [ ] **SA-Q4 Write order and invariants.** Adapt SA-7: request = Stripe "don't renew" first, then the record only where `cancel_at_period_end = true`; Keep = clear the record first, then Stripe renew (only if `renewal_was_on`). Invariant: no open request in B with a renewing plan. (raised by: BA | status: open)
- [ ] **SA-Q5 Blockers at A and at the lock.** Reuse `runAccountDeletionCheck` (anonymise_check) at both moments, as SA-14 for D-2; confirm it needs no fingerprint key. (raised by: BA | status: open)
- [ ] **SA-Q6 DE-10b.2 rework.** Keep the typed-sentence checker and rate limit; remove the immediate anonymise from the owner path; reuse `isAccountSelfDeleteEnabled()` as the lifecycle switch. Anything in PR #503 to keep for stage E? (raised by: BA | status: open)
- [ ] **SA-Q7 Export job model.** Reuse the DE-8a table and start function, or a new request + module-job pair with a new DB start function (2 per rolling 24 h, one running, fully-failed requests not counted, admin-started not counted)? Worker trigger: kick on request plus a cron safety net, or cron only? `maxDuration` per module job. (raised by: BA | status: open)
- [ ] **SA-Q8 Joined CSV builder.** Union of columns with "Record type"; parent name columns; which lookups become labels; reuse of `csv.ts` (BC-1 contract) or a new writer beside it; formula rule (leading `'` vs `csvCell`), one rule for both. Header labels: a closed table per module per language with a CI test. (raised by: BA | status: open)
- [ ] **SA-Q9 Splitting and sending.** 10 MB raw per email (confirm against Resend and common mailbox limits); split at row boundaries; at-least-once sending without duplicate parts after a crash (part number in the job state, Resend idempotency key per part?); "delivered" = Resend accepted. (raised by: BA | status: open)
- [ ] **SA-Q10 Size and time.** A module up to the 100,000-row ceiling inside one function run: memory for 100 MB of CSV, or build part by part? Per-module ceiling if needed (that becomes a business question). (raised by: BA | status: open)
- [ ] **SA-Q11 Retirement plan.** Order of removing routes, sweep, bucket and cron; when the old table is dropped (new migration number); DE-10a replacement; what the CI guards around the ZIP become. (raised by: BA | status: open)
- [ ] **SA-Q12 New tables and the anonymise engine.** Closure record, export request and module-job tables need purge descriptors (`export: exclude`) and removal at E. Does adding a table require regenerating the cleanup function (next free number after 20261092)? (raised by: BA | status: open)
- [ ] **SA-Q13 Audit events.** Names for request, keep (source owner / admin / stripe), C start, reminder, blocked, lock, unlock, ready, export requested / completed / failed / delivered. Deletion events with `user_id = NULL`, `entity_id = subject` (TQ-19) so they survive E. `AUDIT_EVENTS`, definitions, `eventAudience`. (raised by: BA | status: open)
- [ ] **SA-Q14 Website offline at the lock.** No enforcement point exists. Where does one "closed" check sit for the public site and booking routes, without starting the general enforcement work? (raised by: BA | status: open)
- [ ] **SA-Q15 Switches and coexistence.** `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()`, new `isModuleExportEnabled()`. While MX is off, the ZIP stays; when MX is on, does the ZIP stop at once or after MX-6? (raised by: BA | status: open)
- [ ] **SA-Q16 LX-1 scope.** Neutralise in the CRM page with the shared `csvCell` (client-safe import?), honest row count; Orders read-cap notice. Does C-11c (rule-1 move in the contacts / money routes) apply if LX-1 touches only the client side? (raised by: BA | status: open)
- [ ] **SA-Q17 Entitlements.** The deletion drawer's dates and after-plan text reuse `planEndingView` (SA-5); the registrations needed for its consumers (C-11a). (raised by: BA | status: open)

---

## 14. Non-functional requirements

- **Security:** session user only (`getUser()`), never an id from the body; Zod `.strict()`; Stripe ids from our row only; module ids checked against the config; admin routes `requireAdmin` first and in the authz registry; emails only to the login email at send time; rate limits on request, keep, cancel and export.
- **Fails closed:** if Stripe, our record or the check cannot be read, nothing changes and the owner is told to try again. A failed email never undoes an action, except the "closed" email, which must be accepted by Resend **before** the lock.
- **Idempotent:** double clicks, retried jobs and replayed webhooks give one result, one email, one audit row.
- **Privacy:** CSVs are never stored; logs and audit hold ids, codes and counts only; no reason text; DX-1 exclusions unchanged; export history and closure data removed at E, except deletion audit rows, which hold no personal data and survive.
- **Logging:** Pino `createLogger` with `correlationId`; no `console.*` (C-11e).
- **Money:** no sums across currencies; plans USD only.
- **Time:** every date in `user_preferences.timezone`; NULL shown with "UTC".
- **Accessibility:** keyboard only, labelled controls, focus kept in the drawer, errors announced.
- **Languages:** en and he (right-to-left) at launch; es as a draft.
- **CI:** Jest only, small fixtures, inside the existing job: no added CI time.

---

## 15. Out of scope / future roadmap

From brief item 6 and v1:
- Exporting a filtered list from the screen the owner is on (v1 EX-1 to EX-3; only the LX-1 safety fix now).
- A bulk download of client documents and website pictures.
- Automatic final delete after the lock.
- Removing personal details from the Stripe Customer after deletion.
- Admin receipt lookup and the retention sweep (DE-10b.4).
- A real free plan (BQ-20 option b).
- Mid-period downgrades, refunds, offers to stay.
- Self-service for a failed payment (BQ-11).
- An admin page of reasons (BQ-16).
- Excel export.
- Annual plans (stage B could then be a year).

---

## 16. Notes on integration points

| System | Impact |
|---|---|
| `lib/stripe/StripeService.ts` | Cancel-at-period-end on/off (SX-1); OAuth deauthorize (SX-5) |
| `lib/business-os/billing/` | `planCancellation.ts` (SX-1); `planSubscriptionMirror.ts` clears a request on reactivation (DL-1, C-3); `planPurchaseOffer` refusal while pending |
| `lib/business-os/entitlements/` | `planEndingView` (SA-5); registrations for consumers (C-11a) |
| DE-10b.2 self-delete route and drawer (PR #503) | Reworked: request + grace (DL-1, DL-2) |
| Closure record (new) | Migration, manual gate (DL-1) |
| Supabase Auth | Ban / unban for the lock (DL-4) |
| `/admin/users` | Ready list, Unlock, run delete, Send export to owner (DL-4, DL-5, MX-5) |
| Public website and booking routes | "Closed" check (DL-4, if BQ-23 yes) |
| `lib/business-os/purge/descriptors.ts` | New tables classified; module map reads `export` (MX-0, MX-4) |
| `lib/business-os/data-export/` | Readers, `csv.ts`, `ownerClock.ts` reused; ZIP files retired (MX-6) |
| DE-8a table / start function / bucket / sweep cron | Retired or reused per SA-Q7 / SA-Q11 |
| `lib/notifications/emailTransport.ts` | Attachments; all new emails |
| Resend / `RESEND_FROM_EMAIL` | Domain verification (ops) |
| `app/business-os/crm/page.tsx`, `components/payments/MoneyList.tsx` | LX-1 |
| `app/api/payments/stripe-connect/{disconnect,delete}` | SX-5 |
| `lib/business-os/purge/adminDeletionRefusals.ts` | R-3 clearing text (SX-3) |
| `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` P-7a | Note per C-1 |
| `BUSINESS_OS_DATA_EXPORT_CONTENTS.md`, flags-xlsx requirement | Rewritten / marked superseded (MX-6) |
| Feature flags | `isPlanSelfCancelEnabled`, `isAccountSelfDeleteEnabled`, `isModuleExportEnabled` + `feature_flags.md` rows |

---

## 17. Carried SA rulings (v1 review, 2026-10-24)

The v1 SA review approved v1 with conditions C-1 to C-12 and ruled SA-1 to SA-16 (code read on `origin/main` `8dfcc179`). Condensed below. ✅ still applies · 🔁 applies, adapted to v2 · ❌ superseded.

### 17.1 Findings

- K-1 confirmed: no free tier; 5-day grace after the 24 h margin; 30 days when a cohort outlived the tier; grace keeps the website up. ✅ (basis for BQ-20)
- K-2: no enforcement gate exists at all. ✅
- K-3: CRM export is page-only and open to formula injection; Orders cut at 1,000 per source by PostgREST. ✅ (LX-1)
- K-4: Connect "Delete account" clears G-8 even when Stripe refuses. ✅ (SX-5)

### 17.2 Conditions

| # | Short | Status |
|---|---|---|
| C-1 | SX-1 to SX-3 are plan-payments P-7a's cancel half; note in P-7a; portal cannot cancel | ✅ |
| C-2 | Schedule not on the deletion receipt | 🔁 Still not on the receipt; where it lives is re-opened for free accounts (SA-Q1) |
| C-3 | Mirror clears the request on a dashboard reactivation | ✅ (DL-1) |
| C-4 | Fresh Stripe idempotency key per attempt | ✅ |
| C-5 | Connect delete only on confirmed deletion; OAuth deauthorize; G-8 wording | ✅ (SX-5) |
| C-6 | List export reads every row, shared builder, formula-safe | 🔁 Formula safety → LX-1 and MX-2; paging via the existing readers; the shared list builder moves to "later" |
| C-7 | v1 slice re-cut | ❌ Replaced by §9 |
| C-8 | Migration numbers | 🔁 20261092 is now used by the cleanup function (R-1); every new migration takes the next free number when its PR opens; 20261089 never back-filled |
| C-9 | Copy states what the code does; credits apply during the read-only days | ✅ |
| C-10 | No free-text reason note | ✅ (cancel and deletion) |
| C-11 | Standards (entitlements registrations, `requireAdmin`, rule-1 moves, rule-4 comments, logging, flag readers) | ✅ (c only where a slice touches those routes, SA-Q16) |
| C-12 | DE-10b.2 rebased and merged; cleanup fix applied; fingerprint key set | 🔁 First two done (R-1, R-2); the key check stays before DL-5 |

### 17.3 SA-1 to SA-16

| # | Short | Status |
|---|---|---|
| SA-1 | New `StripeService` method + `planCancellation.ts` in the `planUpgrade.ts` shape; legacy route untouched | ✅ |
| SA-2 | Eligibility: `active` only; `trialing` refused; failed states refused | ✅ (also for the deletion request on a paid plan) |
| SA-3 | Write our row from Stripe's answer via the mirror compare-and-set | ✅ |
| SA-4 | Reason code in audit details; no note | ✅ |
| SA-5 | `planEndingView` inside the entitlements module | ✅ (also feeds the deletion drawer, SA-Q17) |
| SA-6 | No second subscription while cancelling; checkout refused while deletion pending | 🔁 Extended to stages A–C and to Boosts (BQ-34) |
| SA-7 | Write order and the "never pending on a renewing plan" invariant | 🔁 Adapted in SA-Q4 |
| SA-8 | Schedule columns on the billing row; admin runs the engine with the stored request time; migration numbering | 🔁 The run pattern stays (DL-5); storage re-opened (SA-Q1) |
| SA-9 | Language, timezone and recipient sources; send only on a real change | ✅ |
| SA-10 | Switches | 🔁 Cancel and delete switches stand; "no switch for list export" ❌; new export switch (SA-Q15) |
| SA-11 | Per-list export routes and CSV helper | ❌ Per-list export is later; `csvCell` reused in LX-1 |
| SA-12 | Shared `.xlsx` writer | ❌ Excel dropped |
| SA-13 | 5,000-row list export sizing | ❌ Replaced by SA-Q10 |
| SA-14 | G-8 strict; D-2 via `runAccountDeletionCheck` | ✅ (also SA-Q5) |
| SA-15 | Copy states the configured rule under shadow mode | ✅ |
| SA-16 | Audit event names; deletion events survive (TQ-19) | 🔁 Extended in SA-Q13 |

---

## SA Review — 2026-10-25

**Reviewed by SA — 2026-10-25** (requirement v2 review; code read on `origin/main` `d65c6c60`, which includes #503 self-delete, #504 cleanup function `20261092` stamp `ec34d5604055abfe`, and #501)
**Status:** ⚠️ Approved with conditions XC-1 to XC-21. BA may hand the requirement to the user for §12 once the TL has relayed the new BQ-39 to BQ-43 below. Dev workplans start from the re-cut slice table (XC-17), not §9.

### Findings from the code (things v2 does not say yet)

| # | Finding | Evidence | Effect |
|---|---|---|---|
| F-1 | A free account **cannot** hold a billing row: `stripe_customer_id` is `NOT NULL` with a `cus_` shape check, and the row is unique per `(user_id, livemode)` | `20261025_business_os_billing_accounts.sql` | The closure record is its own table (XC-1) |
| F-2 | The anonymise already writes `banned_until = now() + 100 years`, deletes `auth.sessions`, `refresh_tokens`, identities and factors, and its own after-check counts the login as closed only when `banned_until > now() + 99 years` | `20261092` (the `UPDATE auth.users` and `auth.users closed` blocks) | A lock using a shorter ban never looks like a tombstone, and E overwrites it (XC-3) |
| F-3 | `lib/auth.ts` `getUser()` is the remote GoTrue call with a 30 s per-instance cache, and middleware calls it too. Only `lib/services/workflowService.ts` uses `getSession()`, outside Business OS | `lib/auth.ts` `TTL_MS` | Once the sessions are deleted, a locked user is out within about 30 s, with no new middleware check |
| F-4 | The cleanup plan is generated from `purge/descriptors.ts` (`scripts/generate-test-account-cleanup-sql.ts`), and a drift test fails CI when the committed SQL differs from the generator. A new user-scoped table needs a descriptor (`exportClassification.test.ts`) | `scripts/__tests__/testAccountCleanupSql.test.ts` "drift" | **Every PR that adds a user-scoped table also carries a regenerated cleanup function** (XC-11) |
| F-5 | `findDeletionFacts` (the receipt's export facts: last export ready, downloaded, admin export existed) reads the DE-8a table, in both the owner route and the admin anonymise route | `account/delete/route.ts`, `admin/test-account-cleanup/delete/route.ts` | The receipt facts must be re-sourced before the ZIP goes (XC-12) |
| F-6 | The admin anonymise route stamps `requestedAt = new Date()` and takes the statement from the admin's body | `admin/test-account-cleanup/delete/route.ts` | DL-5 needs a path that reads the stored request time and language from the closure record, on the server (XC-6) |
| F-7 | `emailTransport` (Resend) sends attachments as base64 in the JSON body but has **no idempotency key**, and it logs the attachment `filename` at `info` | `emailTransport.ts` Resend branch | Add an optional `idempotencyKey`. File names stay free of user data (XC-9) |
| F-8 | The ZIP is built **inside** the POST (`maxDuration = 60`, `runZipExport`), so it is not a background job. Next is `^14.2`, and no `after()` or `waitUntil` is used anywhere | `app/api/business-os/data-exports/route.ts`, `package.json` | The per-module export is the platform's first export worker. Its trigger and duration are SA rulings (XC-8) |
| F-9 | `EXPORT_LIMITS.ROW_CEILING` (100,000) is per **export**, read in 1,000-row keyset pages. C-10 measured about 62 MB of CSV for 100,000 rows of real columns, built in 3.6 s. The database read time is still unmeasured (accepted risk, C-10 §2) | `limits.ts`, `BUSINESS_OS_DATA_EXPORT_C10_SPEED_WORKPLAN.md` §1 | Sizing in SA-Q10 |
| F-10 | `/api/payments/money` already returns `truncated` | `app/api/payments/money/route.ts` | LX-1's Orders notice is client-only (SA-Q16) |
| F-11 | `lib/payments/csv.ts` is pure, has no imports, and is already used by client components (`CRMContactList.tsx`, `MoneyList.tsx`). The CRM page's own `handleExportCSV` wraps phones as `="…"` | `app/business-os/crm/page.tsx` | `csvCell` would neutralise the phone wrapper (XC-18) |
| F-12 | `planEndingView` does not exist yet (SA-5 asked for it in SX-2) | grep on `origin/main` | Built inside the entitlements module, with registrations for its importers (XC-19) |
| F-13 | No public "closed" choke point exists. The site renders through `/api/website/public/[subdomain]`, the book and contact pages through `resolveBusinessByPrefix`, and there are 49 public `app/api/{public,website}` routes | tree on `origin/main` | XC-14 |
| F-14 | No branch or PR holds a migration numbered `20261093` or higher (all 378 remote branches scanned, 0 open PRs) | `git log --remotes` | Next free is **20261093**. Still take it when the PR opens (C-8) |
| F-15 | No feature flag gates today's ZIP export | `featureFlags.ts` | The ZIP stops through the new switch (XC-15) |

### Conditions

| # | Condition |
|---|---|
| **XC-1** | **Closure record = new table** `business_os_account_closures`, one row per request. Columns as SA-Q1 plus `status` (`requesting` → `pending` → `grace` → `locked`; terminal `kept` / `closed`), `kept_source` (`owner` / `admin` / `stripe`), `statement_language` (never the text; it is rebuilt from the server list, SA-8), `reason_code`, `blocked_codes text[]`, one `*_email_sent_at` column per email, and the claim columns (XC-4). Partial unique "one open row per user" over `requesting`, `pending`, `grace`, `locked`. Server-write-only: RLS on, no anon or authenticated policy, every access through a repository. Descriptor `export: exclude`. **At E the engine deletes it** (plan step A). It is not "closed in place": after E the deletion receipt and the surviving audit rows are the record. §4.6 "the closure record is closed" is amended to this |
| **XC-2** | **Write order** (adapts SA-7, answers SA-Q4). Request: insert the row as `requesting` with `renewal_was_on` read from our billing row → Stripe "don't renew" (fresh key per attempt, C-4) → mirror compare-and-set → row to `pending`. A Stripe failure deletes the `requesting` row. A `requesting` row older than 15 minutes is settled by the lifecycle job from a fresh Stripe read. Only `pending` counts as open, so the invariant "no open request in B on a renewing plan" holds, and a retry never reads its own cancellation as "renewal was off". Keep: row to `kept` first, then Stripe renew only if `renewal_was_on`. A Stripe failure leaves an honest "Ends on {date} [Keep my plan]" card and an error, never a renewing plan with an open request |
| **XC-3** | **Lock** (answers SA-Q2). Ban through the GoTrue Admin API (`auth.admin.updateUserById(id, { ban_duration: '87600h' })`, 10 years, deliberately under the tombstone's 99-year predicate). Unlock: `ban_duration: 'none'`. Sessions: a new service-role-only `SECURITY DEFINER` function deletes `auth.sessions` and `auth.refresh_tokens` for that one user, the same two steps the engine's closure list runs, `REVOKE`d from anon and authenticated. The Dev's first workplan task is a spike: if GoTrue revokes sessions on ban by itself, drop the function. Both calls sit behind one repository seam (rule 1), never in a route. Unlock refuses when the login is already a tombstone (`isClosedAccountEmail` or `raw_app_meta_data.deleted`). E needs no change: it overwrites the ban and deletes what is left. The login page maps GoTrue's banned error to "This account is closed. Contact {support address}" (XC-21) |
| **XC-4** | **Lifecycle job** (answers SA-Q3). One cron route, **hourly at :50** (no job uses :50 today), on the `durable-queue-drain` claim pattern over the closure table: claim RPC with `FOR UPDATE SKIP LOCKED`, lease 90 s with `maxDuration = 60`, reaper first. One pass per claimed row: settle `requesting`; start C; send the C email; send the reminder; re-check the blockers; send the "closed" email; lock. C starts at the mirror's `ended_at`. If 24 h after `current_period_end` there is still no `ended_at`, the job reads the subscription **fresh from Stripe** (`retrieveBusinessOsSubscription`) rather than guessing from tier dates. `lock_at` is fixed when C starts: the start of local day 15 in `user_preferences.timezone` (UTC when NULL), so the lock lands within the hour after it. A later timezone change does not move it. **Each email exactly once:** the claim, then a Resend idempotency key `closure:{id}:{email}`, then `*_sent_at` set on the claimed row. A "closed" email that Resend refuses is retried hourly and the lock waits (BQ-41). **The job, Keep and admin Unlock run whatever the switch says** whenever an open row exists. The switch only stops new requests (the DE-8b sweep precedent) |
| **XC-5** | **Blockers through `runAccountDeletionCheck`** (answers SA-Q5), filtered the same way at A and at the lock. Shown to the owner and blocking: G-8, G-9, G-4 (an admin login: "contact support"), plus a failed last payment from our billing row (BQ-11). **Ignored at A and at the lock:** G-6 (the plan is expected to be live at A; at the lock it has ended, and E re-checks) and G-12 (E's storage step removes the files). **Engineering guards** (G-10, G-11, G-13 to G-19) block neither the request nor the lock: they show on the ready list as "blocked: engineering", because the owner cannot fix them and refusing would send them back to email. The check itself needs no fingerprint key. Keep the route's "available on this deployment" gate (cleanup secret plus key), because a request that E could never complete must not be accepted |
| **XC-6** | **DE-10b.2 rework** (answers SA-Q6). **Kept:** `acknowledgement.ts`, `schemas.ts`, `sessionSubject.ts` (session and throttle key), `blockerCopy.ts`, `runAccountDeletionCheck`, the deletion-check route (with the XC-5 filter), `DeleteAccountDrawer.tsx` and `DangerZonePanel.tsx` (extended), the translations, and `isAccountSelfDeleteEnabled()`. **Removed from the owner path:** `runSelfAccountAnonymise`, the anonymise call and receipt building in `account/delete/route.ts` (it becomes the request route), and `expireAuthCookies` on that route. `deletionEmail.ts` becomes the "Deletion requested" builder. **Moved to E:** `receiptInput.ts` / `buildOwnerReceipt`, called by a new `requireAdmin` route that reads the user id from the path, then the closure row (requested time, language) **on the server**, never from the body. **Guard:** extend `no-deletion-paths.guard.test.ts` so that no file under `app/api/business-os/**` may import `runAccountAnonymise` or `runSelfAccountAnonymise`. `/account-deleted` stays, re-worded as the landing for a closed account. `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` is re-worded for request, grace and lock (legal open issue 2 also covers it) |
| **XC-7** | **Export job model: a new pair** (answers SA-Q7). `business_os_export_requests` (one per click: origin `owner` / `admin`, admin actor id, modules, requested_at) and `business_os_export_module_jobs` (one per module: the durable-queue-drain claim columns, `parts_total`, a per-part status array of `{n, state: 'sending' / 'accepted', resend_id}`, row count, failure code). A new DB start function carries the limits as SQL literals, as 20261074 does: 2 per rolling 24 h, one request not yet terminal, a request whose every module failed or was interrupted not counted, admin-started not counted. `jobPolicy.ts`-style mirror constants with a migration test that fails CI when they differ. **DE-8a's table is not reused:** its columns, statuses and start-function counting are ZIP-shaped (part paths, ready/expiry, downloaded). It stays read-only until MX-7 drops it |
| **XC-8** | **Worker** (answers SA-Q7 trigger and SA-Q10). **Cron only**, every 5 minutes. No "kick" from the request route: a fire-and-forget fetch on serverless is unreliable, and it would be a new pattern (rule 7). The owner copy says the emails arrive "within a few minutes". The worker route uses `maxDuration = 300` (4 routes already do; Vercel Pro), lease 420 s, and an internal budget of 270 s checked before each part is sent. This is a **ruled exception** to the skill's default of 60 s, because a module at the 100,000-row ceiling (about 100 sequential pages, plus up to 10 sends of about 9 to 13 MB) does not fit in 60 s. The ceiling becomes **per module** (`ROW_CEILING`, unchanged value). The CSV is built from an array of lines and cut into parts. It is never one 100 MB string, and each part buffer is dropped after its send. Expected peak memory is under 1 GB. Sends are sequential, spaced at least 600 ms apart (Resend's default team limit is 2 per second, shared with every other platform email), and a 429 honours `retry-after` inside the budget. QA's ceiling measurement is local only, because preview and production share one database (C-10 §2), and the database read time remains an accepted risk |
| **XC-9** | **Split and send** (answers SA-Q9). Parts are cut at row boundaries, each repeating the header row and the BOM. `parts_total` is fixed before the first send, so "1 of X" is always true. **Never a duplicate part:** before each send the part is marked `sending`; after Resend accepts, `accepted` with the message id. Idempotency key `export:{module_job_id}:{n}` (additive optional `idempotencyKey` on `SendEmailParams`, honoured by the Resend transport only). **A module is retried only while no part has reached `sending`.** Once any part has, a crash ends the module as `interrupted`, with one email ("this part was interrupted, please export it again", BQ-43). Rebuilt data could otherwise shift the part boundaries. "Sent" means Resend accepted the message: the history says "sent", never "delivered", because bounces are not tracked. **Byte budget: SA recommends 7 MB of CSV per email** (about 9.4 MB after base64), so the email fits the 10 MB limit that many business mail servers keep. 10 MB is technically fine against Resend's 40 MB. It is a constant either way (BQ-42). Maximum 10 emails per module stays |
| **XC-10** | **Joined CSV builder** (answers SA-Q8). Extend `data-export/csv.ts` with a line helper next to `cellText` / `quoteCell`; do not write a second writer. The BC-1 rule (a string starting with `=` `+` `-` `@` TAB or CR gets an apostrophe; typed numbers untouched) is **the** rule for the module export. Column union: "Record type", "Belongs to", then each column key in module section order at its first appearance, then the ids last. The same key always maps to the same column. A CI test fails when two different keys in one module get the same header label. Lookups become labels only for the module's own sections and for stage, service and client name, read through the classified reader (never a column outside the classification). When the target section is excluded or switched off, the id stays. **Header labels live in a server-only pure file** (`data-export/columnLabels.ts`, `{en, he, es}` per `section.column`), **not** in the client translation bundles: several hundred strings times 3 would ship to every browser. A CI test checks that every `include` column has en and he, and es may be a draft. `ownerClock.ts` formats the dates |
| **XC-11** | **New tables and the cleanup function** (answers SA-Q12). Yes, it must be regenerated: the descriptor, the generator output and the drift test move together, in the **same PR** as the table. Two regenerations: MX-1a (export tables) and DL-1a (closure table). They are separate PRs merged one after the other, never stacked; the second regenerates on top of the first. A third at MX-7 (drop of `business_os_data_exports`: remove it from `FUNCTION_REQUIRED_TABLES` and the plan). Add a new table to `FUNCTION_REQUIRED_TABLES` only if the generated SQL names it statically. Numbers: **20261093 is next free today**, taken when each PR opens; 20261089 is never back-filled. **Deploy order:** a new `CLEANUP_FUNCTION_VERSION` makes the check and E answer `function_out_of_date` until DB and code agree. That fails closed, but it pauses admin deletes and test-account cleanup, so apply and merge back to back and run the checker. Each is a manual prod gate |
| **XC-12** | **Receipt export facts** re-sourced in MX-4, before the switch goes on. `ownerLastExportReadyAt` = the last owner module job accepted; `ownerExportDownloadedAt` = NULL from then on (no download exists; document the meaning in the DE-10b requirement); `adminExportExisted` = any admin-origin request. Read both the old and the new tables until MX-7. No receipt schema change |
| **XC-13** | **Audit** (answers SA-Q13). New: `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETION_KEPT` (`details.source` owner / admin / stripe), `ACCOUNT_GRACE_STARTED`, `ACCOUNT_CLOSURE_EMAIL_SENT` (`details.email`: requested / grace / reminder / closed / kept; one event, not five), `ACCOUNT_CLOSURE_BLOCKED` (guard codes only), `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`. "Ready" is derived, so it has no event. These are written with `user_id` NULL (rewritten to the system user, as `ACCOUNT_PSEUDONYMISED` is) and `entity_type 'user'`, `entity_id` = subject, `actor_id` = the admin for unlock: they survive E, which deletes `audit_trail` rows **by `user_id` only**. Refusals keep B-1 (`user_id` = subject). Export: reuse `DATA_EXPORT_REQUESTED` (`details.modules`, origin), plus new `DATA_EXPORT_MODULE_SENT` and `DATA_EXPORT_MODULE_FAILED` (`details`: module code, rows, parts, failure code, `interrupted` flag). "Completed" and "delivered" are one moment, so they are one event. These carry `user_id` = owner and go with the account. Keep the ZIP constants for old rows, with no new writes after MX-6. Definitions and `eventAudience` / owner presentation entries for each |
| **XC-14** | **Public site at the lock** (answers SA-Q14, only if BQ-23 is yes). It is **not** an entitlements gate and does not start the enforcement work. A closure repository read `isAccountClosedToPublic(userId)` (status `locked`) is called at four points: `/api/website/public/[subdomain]`, `resolveBusinessByPrefix` (book and contact pages), `website/booking/create` and `website/forms/contact`. The site cache is revalidated at lock and unlock (`siteCache`). A source-scan test lists the four call sites. Client links already sent (`/book/manage/[token]`) show "no longer available online" (BQ-39). Slice DL-4b, 1.5 d |
| **XC-15** | **Switches** (answers SA-Q15). `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()` (now the lifecycle **request** switch, XC-4), and a new `isModuleExportEnabled()`, each with a `feature_flags.md` row and the `is…Enabled` naming. While the export switch is off, nothing changes. When it is on: "Download my data" opens the drawer, and the ZIP **start** routes (owner and admin prepare) answer 404 at once. Ready ZIPs stay downloadable until they expire. MX-6 removes the code. The export worker and the sweep run regardless of their switches |
| **XC-16** | **Retirement order** (answers SA-Q11). (1) MX-4 switch on: owner ZIP start refused. (2) MX-5 live: admin prepare refused; DE-10a becomes "Send export to owner". (3) At least 72 h and one sweep run later: the bucket is empty (the sweep expires and removes the objects). (4) MX-6 removes the start, download and download-again routes, the admin data-exports routes and UI, the ZIP builder files, the ready email, and the `/api/cron/data-export` route and its `vercel.json` entry. ZIP-specific CI guards are deleted with their subjects, never loosened in place. (5) **MX-7** (new, 1 d, manual gate): one migration drops the start function and `business_os_data_exports` and regenerates the cleanup function. The bucket is removed through the Storage API once it is empty |
| **XC-17** | **Slices re-cut** (each ≤ 2.5 d, from `main`, not stacked). Changes from §9: MX-1 → **MX-1a** schema + start function + claim/reap RPCs + descriptors + regen (2.5 d) and **MX-1b** route + drawer + "requested" email + switch (2 d). MX-2 → **MX-2a** builder and lookups (2 d) and **MX-2b** header labels en/he/es + CI test (1.5 d). MX-4 2 d (adds XC-12). MX-5 1.5 d (XC-20). **MX-7** 1 d (new). DL-1 → **DL-1a** closure table + claim RPC + session-cut function + descriptors + regen (2 d) and **DL-1b** request and keep routes, two-phase write, checkout and Boost refusal, mirror C-3 (2.5 d). **DL-4b** website offline 1.5 d (was +1). DL-5 2 d (the E route of XC-6). SX-2 2.5 d (builds `planEndingView`). Totals below |
| **XC-18** | **LX-1** (answers SA-Q16): client-only. The CRM page's export goes through `toCsvFile` from `lib/payments/csv.ts` (client-safe, F-11), with **one documented exception**: the phone column keeps its `="…"` text form outside `csvCell` (inner quotes doubled, so it cannot carry a formula), because otherwise Israeli numbers lose their leading zero. The button says "Export this page ({n} rows)". MoneyList reads the `truncated` the route already returns and tells the owner. No server route is touched, so C-11c (the rule-1 move) does not apply. If the Dev finds a server change is needed, C-11c applies to that route |
| **XC-19** | **Entitlements** (answers SA-Q17). `planEndingView` lives inside `lib/business-os/entitlements/`. Every file outside the module that imports it or `lifecycle.ts` (the cancel and deletion routes or view models, the lifecycle job if it computes the after-plan state, `planCancellation.ts` if it does) is registered in `KNOWN_NON_GATE_IMPORTERS` with its exact symbols, type-only included. The checkout and Boost refusal while a deletion is pending reads the **closure repository**, not entitlements, so it is **not** an `ENFORCEMENT_POINTS` gate. If `planPurchaseOffer` is already registered and gains a symbol, update its entry. Export never imports entitlements: it is available in every tier and state. Add a test asserting that no export route is in `ENFORCEMENT_POINTS`, so future enforcement cannot block it during grace or pause |
| **XC-20** | **Admin "Send export to owner"**: `requireAdmin` as the first statement, an entry in the authz registry, owner id from the path (tenant-isolation-guard), recipient = the owner's login email read at send time, and **its own limit (2 per owner per 24 h)** so an admin cannot flood an owner's mailbox. It does not count against the owner's limit |
| **XC-21** | **Standards across slices:** rule 1 (closure, export and auth-admin access only through repositories; cron claim/complete methods marked `⟨unscoped-by-design⟩`); rule 2 (Zod `.strict()`; module ids validated against a Zod enum built from the module map); rule 3 (Pino; flag and convert any touched file with `console.*`); rule 4 (service-role paths documented; ids from the session, a claimed row or an admin path, never a body); rule 5 (no LLM involved); rule 7 (the exceptions ruled here: the 300 s worker, the session-cut function, the idempotency key option; nothing else new); CI (pure Jest, small fixtures, inside the existing job; the regen drift tests already exist, so **no added CI time**). Ops gates in §9.5 stand, plus: the Resend sending limit and plan quota checked against 13 modules × up to 10 emails, and the support address used in the banned-login copy |

### Answers to SA-Q1 to SA-Q17

| # | Answer |
|---|---|
| SA-Q1 | A new server-write-only table `business_os_account_closures`, because free accounts cannot have a billing row (F-1). One open row per user, deleted by the engine at E (XC-1) |
| SA-Q2 | A 10-year GoTrue Admin ban, plus a service-role-only function that deletes sessions and refresh tokens (or GoTrue's own revoke, if the spike proves it). Unban to unlock, refused on a tombstone. E overwrites both (XC-3, F-2, F-3) |
| SA-Q3 | One hourly (:50) claim-pattern job on the closure table. C starts at `ended_at`, with a fresh Stripe read when it is 24 h late. `lock_at` = start of local day 15 in the owner's timezone, fixed at C start. Each email once, through claim + idempotency key + `*_sent_at` (XC-4) |
| SA-Q4 | Two-phase: a `requesting` row → Stripe → mirror → `pending`. Keep: `kept` first, then Stripe renew only if `renewal_was_on`. Only `pending` is open, so the invariant holds (XC-2) |
| SA-Q5 | Yes, `runAccountDeletionCheck` at both moments, with one filter: G-4/8/9 and a failed payment block; G-6/12 are ignored; engineering guards only flag the ready list. No fingerprint key is needed for the check (XC-5) |
| SA-Q6 | Keep the checker, schemas, session subject, blocker copy, check route, drawer and switch. Remove the owner anonymise. Move the receipt to a new admin E route that reads the closure row on the server. Add a guard against anonymise imports under `app/api/business-os` (XC-6) |
| SA-Q7 | A new request + module-job pair with a new DB start function carrying all the limits. DE-8a's table is left read-only, then dropped in MX-7. Cron-only trigger every 5 minutes, `maxDuration` 300, lease 420 (XC-7, XC-8) |
| SA-Q8 | Extend `csv.ts` (BC-1 is the one rule), column union by key with ids last, lookups only to same-module or stage/service/client labels, labels in a server-only file with a CI test (XC-10) |
| SA-Q9 | Split at row boundaries; `parts_total` fixed first; mark `sending` before and `accepted` after; Resend idempotency key per part; retry only while nothing reached `sending`, else `interrupted`. "Sent" = Resend accepted. Recommend 7 MB raw rather than 10 MB (XC-9, BQ-42) |
| SA-Q10 | Fits with `maxDuration` 300 and a 270 s budget. The 100,000-row ceiling applies per module; lines are built, then cut, never one big string; peak memory under 1 GB; DB read time is an accepted risk, measured locally only (XC-8, F-9) |
| SA-Q11 | Switch-on refuses new ZIPs → MX-5 replaces DE-10a → ≥ 72 h until the sweep empties the bucket → MX-6 removes the code and cron → MX-7 drops the table and regenerates the cleanup function. ZIP guards are deleted with their subjects (XC-16) |
| SA-Q12 | Yes, regenerate in the same PR as each new table (MX-1a, DL-1a, MX-7), merged one after another. Next free number is 20261093 today; take it at PR open; apply and merge back to back (XC-11, F-4, F-14) |
| SA-Q13 | Names as listed in XC-13. Lifecycle events with `user_id` NULL survive E, because E deletes by `user_id`; export events go with the account |
| SA-Q14 | A closure-repository read at four entry points (site API, `resolveBusinessByPrefix`, booking create, contact form) plus a cache revalidate. Not an entitlements gate (XC-14) |
| SA-Q15 | Three `is…Enabled` switches. Switches gate new requests only; jobs always run. Export switch on = ZIP start refused at once; the code goes in MX-6 (XC-15) |
| SA-Q16 | Client-only: `toCsvFile` with the phone `="…"` exception, an honest row label, MoneyList reads `truncated`. C-11c does not apply unless a route is touched (XC-18) |
| SA-Q17 | `planEndingView` inside the module; every outside importer registered as a non-gate with exact symbols; the pending-deletion refusal is not a gate; a test keeps export out of `ENFORCEMENT_POINTS` (XC-19) |

### Revised effort

| Track | Slices (days) | Total |
|---|---|---|
| Fix now | LX-1 1 | 1 |
| Cancel | SX-1 2.5 · SX-2 2.5 · SX-3 1.5 · SX-5 2 | 8.5 |
| Export | MX-0 1.5 · MX-1a 2.5 · MX-1b 2 · MX-2a 2 · MX-2b 1.5 · MX-3 2.5 · MX-4 2 · MX-5 1.5 · MX-6 1.5 · MX-7 1 | 18 |
| Deletion | DL-1a 2 · DL-1b 2.5 · DL-2 2 · DL-3 2.5 · DL-4 2.5 · DL-5 2 | 13.5 |
| Website offline (if BQ-23 yes) | DL-4b 1.5 | +1.5 |

**About 41 working days, 42.5 with the website offline** (BA: 33 / 34). The difference: the cleanup regenerations and schema work split out of MX-1 and DL-1, the header labels (several hundred strings × 3 languages), the E route that reads the stored request (F-6), the receipt re-sourcing (F-5), and MX-7, which v2 left uncosted. **Manual prod gates: 4 migrations** (MX-1a, DL-1a, MX-7, plus SX-5 only if it needs one). Order of §9.5 stands, with MX-1a and DL-1a merged one after the other.

### New business questions (plain language, for the user via TL)

- [ ] **BQ-39 Clients' future bookings when the account closes.** If an owner still has client appointments after the closing date, their clients will not be told anything by us. **Suggestion:** the deletion screen and the 3-day reminder list how many future bookings there are, and the owner tells their clients. We do not cancel or email clients ourselves. Client links show "no longer available online". (raised by: SA | before DL-2)
- [ ] **BQ-40 How long until the final delete.** A paid owner who asks on day 1 of their month is deleted after about 6 weeks (the month, the 14 days, then the admin run). **Suggestion:** we commit to running the final delete within 7 days of the lock, the admin list shows overdue accounts in red, and legal confirms that the total time is acceptable for a deletion request. (raised by: SA | before DL-5)
- [ ] **BQ-41 If the "your account is closed" email cannot be delivered, do we still close the account?** **Suggestion:** try every hour for 24 hours, then close anyway and mark it on the admin list, so an account is never stuck open because of a mailbox problem. (raised by: SA | before DL-4)
- [ ] **BQ-42 Export email size.** Some business mail servers refuse emails over 10 MB. **Suggestion:** about 7 MB of data per email, so it gets through almost everywhere. It means a few more emails for big modules (still at most 10). The alternative is 10 MB: fewer emails, with some owners not receiving them. (raised by: SA | before MX-3)
- [ ] **BQ-43 An export interrupted halfway.** In rare cases (a server restart while sending), an owner may get, say, emails 1 and 2 of 5 for one module. **Suggestion:** we then send one "this part was interrupted, please export it again" email rather than resending, so nobody gets duplicate or mismatched files. (raised by: SA | before MX-3)

### Approval

[x] Requirement approved with conditions XC-1 to XC-21. Conditions are binding on the workplans; BQ-20 to BQ-43 answers are needed before the slices they name.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-24 | Created (BA) | Items 2 and 4 of the self-service exit brief. Cancel at period end with Keep my plan, reason picker, features you'll lose from the plan comparison rows, review, emails. Correction K-1: there is no free tier (only Founding Partners fall back; others go read-only for 5 days, then paused). Cancel and delete at period end (DE-10b.3) as one flow with two doors. Stripe Connect disconnect fixes (G-8 wording, refuse delete with running client plans). Per-list export: contacts (today exports one page only) and orders first, CSV + Excel via the shared writer, 5,000-row cap, audit. Slices SX-1…SX-5 (~9.5 d) and EX-1…EX-3 (~5 d). BQ-1…BQ-16, SA-1…SA-16 |
| 2026-10-24 | SA review | SA requirement review appended (§ SA Review — 2026-10-24): ⚠️ approved with conditions C-1…C-12. K-1 confirmed (5-day grace after the 24 h margin; 30 days when the cohort outlived the tier; grace keeps the website up); K-2 understated (no gate exists, `ENFORCEMENT_POINTS` empty); K-3 confirmed Medium, plus formula injection, and Orders cut at 1,000 by PostgREST; K-4 worse (Connect delete clears G-8 even when Stripe refuses). SX-1…SX-3 = plan-payments P-7a cancel half; schedule on the billing row, not the receipt (SA-8 overrides TQ-17 storage); migrations: cleanup-FK fix 20261092, SX-4 next free, 20261089 never back-filled. SX-4 split 4a/4b/4c; total ~19.5 d. New BQ-17…BQ-19 |
| 2026-10-25 | Rewritten to brief v2 (BA) | Whole file rewritten to `BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md` and TL notes R-1…R-10. One deletion lifecycle A request → B rest of the paid period → C 14-day grace → D locked → E admin anonymise; "Keep my account" self-service A–C, support in D, never in E; plain cancel kept (SX-1…SX-3, SX-5) as the shared "don't renew" engine; per-module export (13 modules incl. Account & business details), one joined CSV per module ("Record type" shape) emailed as an attachment, 10 MB per email, split "n of X", 2 requests / 24 h, history + audit, files not exported (reversal of 2026-10-14 recorded), ZIP / DE-10a retired, Excel dropped, switches folded in. Per-list export moved to later except LX-1 safety fix. Slices LX-1, SX-1…3, SX-5, MX-0…MX-6, DL-1…DL-5, ~33 d (+1 d website offline). New BQ-20…BQ-38, SA-Q1…SA-Q17. v1 SA review condensed into §17 (carried / adapted / superseded) |
| 2026-10-25 | SA review of v2 | SA requirement review appended (§ SA Review — 2026-10-25), code read on `origin/main` `d65c6c60` (incl. #503, #504 / `20261092` `ec34d5604055abfe`, #501): ⚠️ approved with conditions XC-1…XC-21. Closure record in its own server-write-only table (free accounts cannot hold a billing row), deleted at E; two-phase request write; lock = 10-year GoTrue ban + session cut, E unchanged; hourly claim-pattern lifecycle job, emails once via idempotency key; blockers via `runAccountDeletionCheck` (G-6/G-12 ignored, engineering guards flag only); DE-10b.2 kept/removed list and E route reading the stored request; new export request + module-job tables, cron-only worker at `maxDuration` 300, never-duplicate parts, 7 MB recommended; one BC-1 rule, labels server-side with CI test; cleanup regenerated in each table PR (next free 20261093); receipt export facts re-sourced; audit names; four public "closed" call sites; retirement order + new MX-7. SA-Q1…SA-Q17 answered. Effort ~41 d (42.5 with website offline). New BQ-39…BQ-43 |
