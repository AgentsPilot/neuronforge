# Requirement: Business OS — Delete My Account, Deletion Receipt and Pseudonymised Billing (DE-10b)

> **Last Updated**: 2026-10-21

**Created by:** BA
**Date:** 2026-10-17 (rewritten 2026-10-18 to the user's simplified flow)
**Status:** SA Review 2 approved with conditions. DE-10b.1 code complete (uncommitted, waiting for SA code review and QA, 2026-10-18); see "Slice status" below.
**Parent:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §0.2 (DX-6), §0.3.5, §0.3.7 (DE-10b row). TL splices a summary into the parent later. This file does not change the parent.

## What changed and why (2026-10-18)

On 2026-10-17 the user chose option C: a customer *request* queue that an admin works through, with a cancel link, a 21-day reminder, two typed phrases and a download button inside the delete drawer. On 2026-10-18 the user **replaced it with a simpler flow**:

- **No download button in the drawer.** The drawer tells the customer to download their data from Settings first.
- **One typed statement**, not two. The customer states that they took their data. If they did not, that is on them.
- **Accounts that never paid us delete themselves at once**, login included, with no admin and no queue.
- **Accounts that paid us** can only ask once nothing is in flight. Their plan stops renewing, the account is frozen for new money, and it is deleted when the paid month ends.
- **For an account that paid us, our payment records stay exactly where they are** and are **pseudonymised in place**: the login becomes a closed "tombstone" with no personal details, personal columns on the billing rows are blanked, and everything else is deleted. Finance totals and history keep working. (A first draft of this rewrite proposed a separate financial archive table; the user rejected it the same day.)

The old decisions are listed in §14 with what replaced them. SA rulings from 2026-10-17 that still apply are carried into §5 and marked **"carried from SA review 2026-10-17, SA to re-confirm"**.

## Overview

A business owner can delete their own account from Settings → Danger Zone. They type one statement confirming that they downloaded their data and want the account deleted forever. An account that never paid us is deleted at once, login and all. An account that paid us is deleted at the end of the month it already paid for, once no money is in flight. Its payment history with us stays in place for accounting and tax, with every personal detail removed. Every deletion, by the owner or by an admin, leaves a small **deletion receipt** that proves it happened without keeping the person's email in clear.

---

## Table of Contents

1. [What exists today](#1-what-exists-today)
2. [User stories](#2-user-stories)
3. [The delete drawer and the typed statement](#3-the-delete-drawer-and-the-typed-statement)
4. [Two paths: never paid, and paid](#4-two-paths-never-paid-and-paid)
5. [The deletion receipt](#5-the-deletion-receipt)
6. [Pseudonymise in place (accounts that paid us)](#6-pseudonymise-in-place-accounts-that-paid-us)
7. [The admin delete path](#7-the-admin-delete-path)
8. [Non-functional requirements](#8-non-functional-requirements)
9. [Delivery slices](#9-delivery-slices)
10. [Acceptance criteria and scenarios](#10-acceptance-criteria-and-scenarios)
11. [Open business questions](#11-open-business-questions)
12. [Technical questions for SA](#12-technical-questions-for-sa)
13. [Out of scope / future roadmap](#13-out-of-scope--future-roadmap)
14. [Superseded decisions](#14-superseded-decisions)
15. [Notes on integration points](#15-notes-on-integration-points)
16. [SA Review — 2026-10-17 (historical)](#sa-review--2026-10-17-historical)
17. [User decisions — 2026-10-17 (historical)](#user-decisions--2026-10-17-historical)
18. [Change History](#change-history)

Evidence tags: ✅ read in code or docs (2026-10-17, re-read in this file 2026-10-18) · 🧠 from project memory or the coordinator's brief, not re-read · ❓ for SA or Dev to verify.

---

## 1. What exists today

| Fact | Tier |
|---|---|
| **The customer cannot delete their account.** The Danger zone (`components/business-os/purge/DangerZonePanel.tsx` / `ErasureRequestContent`) shows a download button and a "Contact us" mailto to `PLACEHOLDER_ERASURE_CONTACT`, which is the product owner's personal Gmail today (DE-9 BC-3) | ✅ |
| **Settings → Download my data exists** (DE-9, DE-10a merged #456). The drawer can point the customer there | ✅ |
| **The one live delete is the admin hard delete on `/admin/users`** (AU-1). It calls the secret-gated `operator_test_account_cleanup` function through the protected direct DB channel. It removes the login, the business and its history, which frees the email. It needs an admin, a typed email tag (G-2) and a second secret | ✅ |
| **It refuses any account that ever paid us in live mode** (G-5), or that has a connected Stripe account (G-8), money in flight (G-9), consent records, an invite circle and other links (G-4…G-19) | ✅ |
| `credit_transactions` and `user_subscriptions` point at the login with **NO ACTION** foreign keys, so the login cannot be removed while those rows exist | ✅ SA 2026-10-17 |
| **The admin finance / health pages read our billing tables** (for example `business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges` / lots / totals, `business_os_boost_purchases`, payment history) by account id. Removing or moving those rows would change finance totals and history | 🧠 |
| **The purge plan already keeps the login** (purge D3). Keeping a closed login for a paid account matches it | ✅ purge req |
| The live delete has **no reason field** and writes `BUSINESS_TEST_ACCOUNT_REMOVED` with counts only. It cannot answer "did you delete jane@example.com?" | ✅ |
| **Export history is deleted with the person** (`business_os_data_exports` is `ON DELETE CASCADE`, migration 20261074) | ✅ |
| No annual plans exist. Our plan subscriptions are monthly (user, 2026-10-18) | ✅ user |

---

## 2. User stories

- As a **business owner**, I want to delete my account myself, so that I do not have to email anyone.
- As a **business owner**, I want a clear warning to download my data first, so that I do not lose it by accident.
- As a **business owner**, I want to state in my own language that I took my data and want the account gone, so that a stray click cannot delete it.
- As a **business owner who pays for a plan**, I want to stop paying and keep using the account until the month I paid for ends, then have it deleted.
- As a **business owner who changed my mind**, I want to cancel a scheduled deletion before it happens.
- As the **product owner**, I want our payment history to stay complete for accounting and tax, with nothing in it that identifies the person.
- As the **product owner**, I want proof of every deletion that holds almost nothing about the person, so that I can answer a regulator or a "did you really delete me?" email without undoing the erasure.
- As a **platform admin**, I want finance pages to keep their totals after a deletion and show "Deleted account {ref}" instead of a name.
- As a **platform admin**, I want to check whether an email address was deleted, and when, without that address being stored.

---

## 3. The delete drawer and the typed statement

### 3.1 The drawer

Settings → Danger Zone → **"Delete my account"** opens a drawer. It has, in order:

1. **A strong warning, in plain words:** "Before you delete, download your data from **Settings → Download my data**. Deleting erases your account, your business, your clients' records, your invoices to clients, your website, your booking pages and your files. It cannot be undone and we cannot recover anything. If you paid us, we keep your payment history with us, with your personal details removed (see our privacy notice)."
2. **No download button.** The text names the place. Whether the place name is also a link is UI detail, but no export control is built into the drawer.
3. **What happens next**, which depends on the path (§4): "Your account will be deleted now" or "Your plan stops renewing. Your account will be deleted on {date}."
4. **For an account with blockers:** the list of blockers (§4.2) and no statement box.
5. **The statement box** and the Delete (or Schedule deletion) button, disabled until the statement matches.
6. **If BQ-11 is answered yes:** a 6-digit email code step after the statement (§3.4).

### 3.2 The one statement

There is one statement. There is no "I don't want a copy" option. The statement has no punctuation and no geresh, so the matching rule is the only tolerance needed. Final wording is UI copy and needs a native check. Spanish is a draft, as in DE-9.

| Language | Statement |
|---|---|
| English | `I have downloaded my data and want my account deleted forever` |
| Hebrew | `הורדתי את הנתונים שלי ואני רוצה למחוק את החשבון שלי לצמיתות` |
| Spanish (draft) | `He descargado mis datos y quiero que mi cuenta se elimine para siempre` |

- The Hebrew is gender-neutral as written (first-person past, and "אני רוצה" reads for both).
- The box is right-to-left in Hebrew. A statement in any supported language is accepted, so a Hebrew user who types the English statement is not refused.
- Pasting is allowed (assistive tools).
- **We do not block a person who never exported.** The statement is their word. The receipt records what they typed **and** what our records show (last ready export and whether they downloaded it). If the two differ, the receipt says so. It does not stop them.

### 3.3 Server check (fails closed)

- The server holds the statement list. It **never** compares against a statement sent by the browser.
- Matching uses `normaliseAcknowledgement` (carried from SA review 2026-10-17 TQ-6, SA to re-confirm): NFC, strip bidi and zero-width marks, strip Hebrew points, then the existing `normaliseConfirmation` (case, outer and repeated spaces). `normaliseConfirmation` itself is not changed.
- **Refuse** when the statement does not match, the language is unknown, the receipt cannot be written, the fingerprint key is missing, or (if BQ-11 is yes) the code is wrong or expired. A refusal changes nothing.
- Repeated wrong attempts are throttled (`lib/security/rateLimit.ts`).
- The route acts on the **signed-in user only**. No account id or email comes from the body.

### 3.4 The email code (open, BQ-11)

TL recommends a 6-digit code sent to the account's email before the delete runs or the deletion is scheduled. It protects against someone using an unlocked, signed-in browser. Suggested rules: valid 10 minutes, 5 tries, one code at a time, a new code cancels the old. The user has **not** decided. SA rules on reusing an existing code mechanism (TQ-18).

---

## 4. Two paths: never paid, and paid

"**Paid us**" means the account has any live-mode billing with us: a plan subscription payment or a credit purchase. It is the same test as the engine's G-5. SA pins the exact definition (TQ-12).

This is about the customer paying **us**. The business's own invoices, payments and payment plans with **its clients** are the owner's data. The owner exports them (Download my data) and they are deleted in full. They are never kept.

### 4.1 Never paid: the owner deletes it now (full delete, login included)

1. The drawer runs a **pre-check** when it opens: the engine's own checks, read-only (TQ-11). If a check would refuse (for example a connected Stripe account), the drawer lists it in plain words and shows no statement box.
2. The owner types the statement (and the code, if BQ-11 is yes).
3. The server checks the statement, then runs the **live hard-delete engine** (`operator_test_account_cleanup` through the protected direct DB channel) with the **session user as the target**. SA rules how a self-service call reuses an engine that today needs an admin and a typed email tag (TQ-10).
4. The **receipt is written first** (status `running`), through the write-ahead hook. If it cannot be written, nothing is deleted.
5. After the run, the receipt becomes `completed` with totals, or `refused` / `failed` with the reason and "nothing was removed".
6. The person is **signed out** and sees a "Your account has been deleted" screen. A **confirmation email** goes to the address the account had. The address is held in memory for that one send and never stored. If the email fails, the deletion stands.
7. If the account turned into a paid one between the pre-check and the run, the engine refuses (G-5). The drawer says so and reloads into the paid path.

### 4.2 Paid: pre-check, freeze, pseudonymise at period end

**Pre-check at request time.** The drawer will not accept the request while any blocker exists. It lists each one in plain words with where to fix it:

| Blocker | Engine guard | Plain words (draft) |
|---|---|---|
| Stripe still connected for client payments | G-8 | "Your Stripe account is still connected for client payments. Disconnect it in Settings → Payments." |
| Pending client payments | G-9 | "{n} client payments are still pending. Wait for them to finish." |
| Sent or overdue invoices | G-9 | "{n} invoices are sent or overdue. Mark them paid or cancel them." |
| Active client payment plans | G-9 | "{n} client payment plans are active. End them first." |
| Any other guard that would refuse | G-4…G-19 | Plain words per guard (TQ-11); if a guard has none, "Please contact support at {support address}" |

Only when the list is empty can the owner type the statement.

**On acceptance:**

1. The **receipt** is written with status `scheduled` and the scheduled date.
2. Our **plan subscription is set to cancel at the end of the period** (Stripe `cancel_at_period_end`). No more charges. The owner keeps access until the paid month ends. The **scheduled date is that period end**.
3. The account is **frozen for new money** until then. It cannot reconnect Stripe, send invoices, start client payment plans, buy credits or change plan (the last two are BA additions, see BQ-16). Everything else keeps working.
4. Settings shows **"Deletion scheduled for {date}"** in the owner's timezone (`user_preferences.timezone`), and a **"Cancel deletion"** button if BQ-12 is yes.
5. A short email confirms the scheduled date.
6. **Cancel deletion** (if BQ-12 is yes): the plan renews again (`cancel_at_period_end` unset), the freeze lifts, the receipt becomes `cancelled`. Allowed until the delete starts.

**No active plan.** An account that paid us in the past but has no running plan (for example it only bought credits once, or its plan already ended) has no period to wait for. Its scheduled date is the day of the request, and the admin runs it in the next working days (BQ-17).

**On the scheduled date:**

1. Admins see a list of scheduled deletions that are due (§7).
2. The admin runs the admin delete, with reason "customer asked", linked to the scheduled receipt. Automatic running is a later slice (§13).
3. For a paid account the delete runs in **"pseudonymise, keep billing" mode** (§6): the business's own data is deleted in full, our billing rows stay in place with personal columns blanked, and the login becomes a closed tombstone. So G-5 "ever paid in live mode" changes from **refuse** to **pseudonymise instead of remove**. SA rules whether this is a mode of the engine or a separate small step (TQ-13).
4. The receipt becomes `completed`. A confirmation email goes to the address the account had (held in memory only).

**Safety net.** If the delete still refuses on the date (a late payment, a refund, a dispute), the admin sees why. The owner is emailed. There is a **7-day grace** to clear it, then the admin tries again or handles it by hand. The receipt stays `scheduled` with the refusal noted.

**Timing.** There are no annual plans, so the wait is at most one month, which fits GDPR's one-month response time.

---

## 5. The deletion receipt

Proof that a deletion was asked for and carried out, with the person's own statement. Not a copy of the account. Written by **both** the owner path and the admin path.

### 5.1 What it keeps

| Kept | Why | Not kept |
|---|---|---|
| Receipt id and status: `scheduled` / `running` / `cancelled` / `completed` / `refused` / `failed` | The life of the deletion | — |
| A keyed fingerprint of the email (HMAC, cannot be reversed by guessing) plus the key version. Recomputed at completion if the email changed while scheduled (at most two values) | Lets an admin answer "was jane@example.com deleted?" | The email in clear, a masked hint, the name, the business name, the phone |
| The old account id (`subject_user_id`) and the short reference shown on finance pages | Links to admin audit rows and, for a paid account, to its kept billing rows | — |
| Mode: **full delete** or **pseudonymised (billing kept)** | Says which happened | — |
| Origin (owner / admin) and executor (self-service / admin id and email at that moment) | Proof of who asked and who did it | IP address, device |
| The admin's reason (category + note) | Why an admin deleted | — |
| The statement language and the exact text typed | DX-6 acknowledgement | — |
| Last ready export date, whether the owner downloaded it, whether an admin export existed and was downloaded (copied before the delete) | "Did they have their data?" | The export file |
| Scheduled date, and times of request, cancel, completion, refusal or failure | The timeline | — |
| Outcome totals (removed, and blanked-in-place), or the guard that refused | Proof the erasure ran | Per-table detail |

### 5.2 Carried SA rulings (carried from SA review 2026-10-17, SA to re-confirm)

| Ruling | Short form |
|---|---|
| Storage | New table `business_os_deletion_receipts`. **No foreign key** and **no `user_id` / `owner_user_id` column**, so no cascade, purge, audit erasure, archiving or the acting admin's own deletion can reach it. RLS on, no policies, service role only, self-verifying grant check. Registered `never(..., exclude(EXPORT_REASON.PLATFORM))` in `descriptors.ts`. A Jest guard fails on `REFERENCES` or a `user_id` column in its migration |
| Fingerprint | `HMAC-SHA256(key, lower(btrim(email)))` with a dedicated key `DELETION_RECEIPT_FINGERPRINT_KEY` (server-only, ≥32 chars, `hkdfSync` with its own info string). A `fingerprint_key_version` per row; old keys kept lookup-only. **A missing key fails closed:** no receipt, so no delete (self-service and admin both off until the key is set in Vercel Production + Preview) |
| Write-ahead | Written through an injected `beforeDestructive` hook in `runCleanupDelete`, after the check passes and before the storage step. Insert fails → 503, nothing removed. A refused check writes a `refused` receipt best-effort |
| Status life | `running` → `completed` / `refused` / `failed`. A **stale sweep** resolves `running` rows older than 10 minutes: login still there → `failed`; login gone → `completed`, "totals unknown, see audit row". **Note:** in pseudonymise mode the login stays, so this test needs a second signal (TQ-22). New in this rewrite: `scheduled` and `cancelled`. One open receipt (`scheduled` or `running`) per account (partial unique index) |
| Hebrew | `normaliseAcknowledgement` as in §3.3 |
| Retention | `retain_until` is set from **one constant** when the row reaches a final state, and is NULL while `scheduled` or `running`. The sweep reads only `retain_until` |
| Sweep | Reuse `/api/cron/data-export` (`runExportSweep`): stale-`running` step and retention step, each with its own time budget, bounded batches. Not a queue drain |
| Lookup | `POST` (email in the body, never a URL), rate-limited per admin. The typed address is never stored or logged. Every lookup is audited with `found` and the receipt id, never the fingerprint |
| Logging and rules | Pino `createLogger` + `correlationId`, ids and counts only; never the email, fingerprint, typed lookup or reason note. `requireAdmin` first statement on admin routes, `requireAdminPage` on admin pages. Zod `.strict()` on every body |
| Migration | **`20261080`** for the receipt table. **Re-verify it is free** at workplan and PR time. Hand-applied on prod, so the PR is **manual gate**, not auto-merged |

### 5.3 Who can see it

Platform admins only, read-only: a recent list and "check an email". The owner sees only their own "Deletion scheduled for {date}" line while it is scheduled. After deletion there is no one to sign in. A person who asks later gets a copy from support.

### 5.4 Retention

The receipt of a completed deletion uses **the same retention setting as the kept billing rows** (§6.5): one documented setting, placeholder **7 years**, confirmed by the user's CPA (BQ-13). Refused and failed attempts and test accounts: still open (BQ-9, SA suggested 90 days).

---

## 6. Pseudonymise in place (accounts that paid us)

### 6.1 The rule

For an account that paid us, **every billing and payment row stays exactly where it is, with the same account id**. Nothing is moved into a separate table and nothing is deleted. The admin finance / health pages keep their totals and history. What changes is that **nothing in those rows, or in the login they point at, identifies the person any more**. Everything else is deleted in full.

This matches purge D3 (the login is kept) and keeps every foreign key working, including the NO ACTION ones on `credit_transactions` and `user_subscriptions`.

### 6.2 The tombstone login

The login is **not removed**. It becomes a closed tombstone:

| Part | After |
|---|---|
| Email | Replaced by a non-identifying placeholder, for example `deleted-{ref}@invalid`. `{ref}` is random or derived from the receipt id, **never** from the email. The original address is free to sign up again |
| Password, linked identities (Google and others), sessions, refresh tokens | Removed |
| Sign-in | Banned permanently |
| Profile and business personal details | Wiped: name, phone, address, avatar, company name, logo, website text and any similar field |
| User id | **Unchanged**, so finance joins and foreign keys keep working |

The tombstone must also be left out of everything that acts on live users: emails, reminders, crons, active-user counts, admin "users" lists by default (TQ-21).

### 6.3 The billing rows

On our billing and payment rows (for example `business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges` / lots / totals, `business_os_boost_purchases`, `credit_transactions`, `user_subscriptions`, payment history):

| Kept as is | Blanked or replaced |
|---|---|
| Invoice number | Billing email |
| Stripe ids (invoice, payment intent / charge, balance transaction, payout or report references) | Customer name |
| Payment date | Billing address |
| Amount and currency (one currency per row, never summed across currencies) | Phone |
| Plan or service, and the billing period | Free-text notes or descriptions that may hold personal details |
| Tax, fees, refunds, chargebacks (dates and amounts) | Any other personal column SA finds |

SA inventories which billing and payment columns actually hold personal details on the live schema (TQ-14). Location (country / state / ZIP only) is **kept only if** the CPA says sales tax needs it (BQ-14); otherwise it is blanked with the address.

### 6.4 What admins see

- Finance and admin pages show **"Deleted account {short ref}"** instead of a name or email. Totals, charts and history are unchanged.
- Access to these rows is purpose-limited to accounting, tax and legal work by platform admins. This is a rule in the privacy notice and the runbook, not a new permission system.

### 6.5 Retention

- **One documented setting**, shared with the receipt. Placeholder **7 years** until the CPA answers (BQ-13). The IRS ordinary period is generally 3 years after filing, longer in some cases. There is no universal 7-year rule, so the placeholder is on the safe side.
- **After retention**, the rows may be deleted or reduced further. That changes historical finance totals, so it is a business decision (BQ-18) and is **not built** in this requirement.

### 6.6 Stripe

The kept Stripe ids still point at a Stripe Customer object that holds the person's details. Redacting that object is a follow-up slice (§13).

### 6.7 Privacy notice paragraph (draft)

> **What we keep after you delete your account.** When you delete your account we erase your profile, your business, your clients' records, your website and your files. If you paid us, we keep your payment history with us, with your personal details removed: invoice and payment numbers, dates, amounts, currency, plan, taxes, fees, refunds and chargebacks. It no longer holds your name, email, phone number or address. We also keep a short deletion receipt that proves we did what you asked: the dates, and a coded fingerprint of your email address that cannot be turned back into the address. We keep these because tax and accounting rules require it and to show we honoured your request. Only our platform administrators can see them, and only for accounting, tax or legal purposes. We keep them for {N} years.

The lawyer and CPA confirm the wording and {N}.

---

## 7. The admin delete path

The admin hard delete on `/admin/users` stays. It now:

1. **Requires a reason** (BQ-4, decided 2026-10-17): "The customer asked", "Test account", or "Other" with a 5–500 character note. The UI says "Do not write names, emails or client details here". The note is not logged or audited.
2. **Writes the same receipt**, write-ahead, with the export facts copied first.
3. For a paid account, **runs in pseudonymise mode** (§6) instead of refusing (from DE-10b.3).
4. **Shows due scheduled deletions** (paid path) with their date, and lets the admin start the delete from that row, which links the receipt.
5. Shows the refusal reason when the engine refuses, and marks the 7-day grace.

Existing audit events (`BUSINESS_TEST_ACCOUNT_REMOVED` and others) stay. The receipt adds to them.

---

## 8. Non-functional requirements

- **Security:** customer routes act on the session user only. Admin routes start with `requireAdmin`. Zod `.strict()` everywhere. Throttling on the statement, the code and the lookup. The self-service delete is a **new deletion path**, so the `no-deletion-paths` guard is updated only with SA approval (TQ-10). A tombstone can never sign in again.
- **Fails closed:** wrong statement, missing key, unwritable receipt, or a failed pre-check → nothing changes. Pseudonymisation is all-or-nothing: if any part fails, nothing is deleted or blanked (TQ-13).
- **Privacy:** no email, name, business name, fingerprint, lookup address or reason note in logs or audit details. After pseudonymisation no kept row or the tombstone holds a personal detail.
- **Finance integrity:** after a paid account is deleted, every finance total and history view shows the same numbers as before.
- **Money:** kept rows keep their own currency. Never summed across currencies (CLAUDE.md § Currency).
- **Time:** the scheduled date is shown in `user_preferences.timezone`. If it is NULL, show it with an explicit "UTC" label.
- **Accessibility:** labelled inputs, announced errors, paste allowed, keyboard only, colour never the only signal.
- **Bilingual / RTL:** English and Hebrew at launch, Spanish draft.
- **Logging:** Pino `createLogger` with a `correlationId`. No `console.*`.
- **Audit:** new `AUDIT_EVENTS` constants (for example `ACCOUNT_DELETION_SCHEDULED`, `ACCOUNT_DELETION_CANCELLED`, `ACCOUNT_SELF_DELETED`, `ACCOUNT_PSEUDONYMISED`, `DELETION_RECEIPT_LOOKUP`), non-blocking, written on rows that survive the deletion (TQ-19).
- **Performance:** the pre-check and the statement check take under a second. The delete is as fast as today's admin delete.
- **CI:** new checks run inside the existing Jest gate (no added CI time).

---

## 9. Delivery slices

Each slice is its own PR from `main`, no stacking, a few days at most. The user sees the diff before commit. Migration slices are manual gate.

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **DE-10b.1 — Receipt + admin reason** | Receipt table (migration `20261080`), repository, writer, fingerprint key (fails closed), write-ahead hook in `runCleanupDelete`, required reason on the `/admin/users` delete, stale-`running` sweep step in the data-export cron | SA re-confirm; schema check; key set in Vercel before deploy | 🟡 ~3 d |
| **DE-10b.2 — Self-delete for never-paid accounts** | Danger Zone drawer (warning, no download button, statement en / he / es draft), read-only pre-check with plain-word blockers, self-service call into the live engine on the session user (full delete, login included), sign-out + "account deleted" screen + confirmation email, removes the personal-Gmail mailto for this case. Email code if BQ-11 is yes (+~0.5 d) | DE-10b.1; SA ruling TQ-10, TQ-11 | 🟡 ~3 d (+0.5 d) |
| **DE-10b.3 — Pseudonymise in place** | "Pseudonymise, keep billing" for paid accounts (engine mode or separate step, TQ-13): tombstone login, blanked personal columns on billing rows per the SA inventory, full delete of the business's own data; G-5 changes from refuse to pseudonymise; "Deleted account {ref}" on finance and admin pages; tombstones left out of live-user processing; privacy notice paragraph. Admin can delete a paid account by hand from here on | DE-10b.1; SA ruling TQ-13, TQ-14, TQ-21; possibly a regenerated cleanup function (hand-applied) | 🔴 ~4 d |
| **DE-10b.4 — Paid-account customer flow** | Drawer pre-check for G-8 / G-9 in plain words, statement, `scheduled` receipt, Stripe `cancel_at_period_end`, freeze for new money, "Deletion scheduled for {date}", Cancel deletion (if BQ-12 is yes), scheduled email, admin list of due deletions, 7-day grace + owner email. Mailto removed for all cases | DE-10b.2, DE-10b.3; SA ruling TQ-15 … TQ-17 | 🟡 ~3.5 d |
| **DE-10b.5 — Admin lookup + receipt retention** | Admin read-only "Deletion receipts" view (recent list, POST "check an email"), every lookup audited, nightly retention delete of receipts from one constant | DE-10b.1 | 🟢 ~1.5 d |

About **15 working days** in total (15.5 with the email code). Slices 1–2 give a working self-delete for never-paid accounts in about 6 days. Retention of the kept billing rows waits on BQ-18 and is not in these slices.

---

## 10. Acceptance criteria and scenarios

### 10.1 Acceptance criteria

**DE-10b.1**
- [ ] The `/admin/users` delete cannot start without a reason. "Other" needs 5–500 characters.
- [ ] A receipt exists before the delete runs. With the insert forced to fail, the delete is refused and nothing is removed (no storage step, no `remove`).
- [ ] With the fingerprint key unset, every delete is refused with "not configured".
- [ ] A clean delete leaves a `completed` receipt with totals and the fingerprint, not the email.
- [ ] A refused delete leaves a `refused` receipt naming the guard.
- [ ] The receipt survives the account cascade, a purge, the audit erasure, the archiving rotation and the deletion of the acting admin.
- [ ] A `running` receipt older than 10 minutes is resolved by the sweep.

**DE-10b.2**
- [ ] The drawer has no download button and shows the warning in English and Hebrew (RTL).
- [ ] The button stays disabled until the statement matches. The server refuses a wrong statement and changes nothing.
- [ ] A statement that differs only in case, spacing, direction marks or niqqud is accepted. The English statement is accepted in the Hebrew UI.
- [ ] A Jest guard: every language has a non-empty statement.
- [ ] For a never-paid account with no blockers, the account and its login are deleted, the person is signed out, sees "account deleted" and gets one email.
- [ ] A never-paid account with a blocker sees it in plain words and no statement box.
- [ ] A paid account is never deleted by this path; it is sent to the paid flow.
- [ ] The receipt shows the typed text and the real export facts, even when they differ.
- [ ] No account id or email in the request body is used.

**DE-10b.3**
- [ ] After a paid account is deleted, every finance total and history view shows the same numbers as before.
- [ ] Every kept billing row has the same account id, and its invoice number, Stripe ids, date, amount, currency, plan, period, tax, fees, refunds and chargebacks are unchanged.
- [ ] No kept billing row holds the email, name, address, phone or a personal free-text note (checked against the SA inventory).
- [ ] The login's email is the placeholder, it has no password, identities or sessions, and sign-in is refused. The original email can sign up again.
- [ ] Profile and business personal fields are empty. The business's own data, clients, invoices to clients and files are gone.
- [ ] If any part fails, nothing is deleted or blanked and the receipt is `failed`.
- [ ] Finance and admin pages show "Deleted account {ref}". The tombstone gets no emails and is not counted as an active user.

**DE-10b.4**
- [ ] With Stripe connected, a pending payment, a sent or overdue invoice or an active client plan, the drawer lists each one and shows no statement box.
- [ ] On acceptance: the receipt is `scheduled`, Stripe shows `cancel_at_period_end`, the date shown is the period end in the owner's timezone, one email is sent.
- [ ] While scheduled, reconnecting Stripe, sending an invoice, starting a client plan, buying credits and changing plan are refused with a plain message.
- [ ] Cancel deletion (if built) unsets `cancel_at_period_end`, lifts the freeze and marks the receipt `cancelled`.
- [ ] Admins see due deletions. A refused delete on the date shows the reason, starts the 7-day grace and emails the owner.

**DE-10b.5**
- [ ] Non-admin gets 403, signed-out 401, on the view and its routes.
- [ ] "Check an email" finds a deleted address whatever its case or spacing, and not one never deleted. The address is in no log, audit row or stored field.
- [ ] Every lookup is audited.
- [ ] Receipts past `retain_until` are deleted nightly. `scheduled` and `running` rows never are.

**All slices:** integration tests for happy path, auth failure and invalid input. QA records a manual check of the critical path.

### 10.2 Scenarios: never paid

| # | Situation | Expected |
|---|---|---|
| N-1 | Free account, nothing connected, types the statement | Deleted now with its login, signed out, "account deleted" screen, email, `completed` receipt |
| N-2 | Types the statement wrong | Button stays disabled; if forced, server refuses, nothing changes |
| N-3 | Never exported, types the statement anyway | Deleted; receipt records "said downloaded / no export on record" |
| N-4 | Has a connected Stripe account but never paid us | Drawer lists "disconnect Stripe", no statement box |
| N-5 | Bought credits in another tab after opening the drawer | Engine refuses (paid); drawer moves to the paid flow; `refused` receipt, nothing removed |
| N-6 | Fingerprint key missing in production | Refused with "not available right now", nothing removed |
| N-7 | Process dies mid-delete | Receipt stays `running`; sweep resolves it on the next run |
| N-8 | Confirmation email fails | Deletion stands; failure logged with ids only |
| N-9 | Email code wrong 5 times (if BQ-11 yes) | Locked out of the code step for a while; nothing deleted |

### 10.3 Scenarios: paid

| # | Situation | Expected |
|---|---|---|
| P-1 | Monthly plan, nothing in flight, types the statement on the 10th; period ends on the 28th | `scheduled` for the 28th, plan set to cancel at period end, frozen for new money, banner with date and Cancel deletion |
| P-2 | Two invoices to clients still "sent" | Drawer lists them; cannot type until they are paid or cancelled |
| P-3 | Clicks Cancel deletion on the 20th | Plan renews again, freeze lifted, receipt `cancelled` |
| P-4 | Tries to send an invoice while scheduled | Refused: "Your account is scheduled for deletion" |
| P-5 | On the 28th, admin runs the delete | Business data deleted; billing rows kept with personal columns blanked; login becomes a tombstone; finance totals unchanged; finance pages show "Deleted account {ref}"; receipt `completed`; email sent |
| P-6 | A refund lands on the 27th | Delete refuses on the 28th; admin sees why; owner emailed; 7-day grace |
| P-7 | Paid once for credits, no plan | Scheduled for the day of the request; admin deletes within the next working days (BQ-17) |
| P-8 | Changes their email while scheduled | Receipt holds fingerprints of both addresses |
| P-9 | Unused paid credits at deletion | Lost, as the drawer warned (BQ-15) |
| P-10 | Tries to sign in with the old email after deletion | No account found; they can sign up fresh. The tombstone is never reachable |

---

## 11. Open business questions

- [ ] **BQ-11 Email code before the delete?** (raised by: TL | status: pending user input) **Suggestion (TL):** yes. A 6-digit code to the account email, valid 10 minutes, for both paths. It stops someone at an unlocked, signed-in computer. Adds about half a day.
- [ ] **BQ-12 "Cancel deletion" button while a paid account waits?** (raised by: TL | status: pending user input) **Suggestion (TL):** yes, until the delete starts. The plan renews again and nothing is lost.
- [ ] **BQ-13 How long do we keep the pseudonymised billing rows and the deletion receipt, and from when?** (raised by: user | status: pending CPA) **Suggestion:** placeholder 7 years from the deletion date until the CPA answers. One setting covers both.
- [ ] **BQ-14 Must we keep the customer's location (country / state / ZIP only) for sales tax?** (raised by: user | status: pending CPA) **Suggestion:** blank it with the address until the CPA says yes.
- [ ] **BQ-18 What happens to the kept billing rows after the retention period?** Deleting them, or reducing them further, changes historical finance totals. (raised by: BA | status: pending user input) **Suggestion:** decide once the CPA answers BQ-13; until then nothing is deleted and nothing is built.
- [ ] **BQ-8 Support mailbox address** for the drawer, the emails and the "contact support" blocker. (raised by: BA | status: still owed by user) **Suggestion:** supply it before DE-10b.2 ships; until then the one swap point in `supportContact.ts` stays.
- [ ] **BQ-9 (remainder) How long do we keep a receipt for a refused or failed attempt, or a test-account deletion?** (raised by: SA | status: pending user input) **Suggestion (SA):** 90 days. Completed customer deletions use BQ-13.
- [ ] **BQ-15 Unused paid credits at deletion.** (raised by: BA | status: pending user input) **Suggestion:** they are lost, no refund, and the drawer says so.
- [ ] **BQ-16 Freeze also blocks buying credits and changing plan?** (raised by: BA | status: pending user input) **Suggestion:** yes. Both are new money to us during the wait.
- [ ] **BQ-17 Paid in the past but no running plan: when is it deleted?** (raised by: BA | status: pending user input) **Suggestion:** no waiting period; the admin deletes it within 7 days of the request.

---

## 12. Technical questions for SA

Not for the user. SA rules during the re-review.

- [ ] **TQ-10 Self-service reuse of the engine.** Today `operator_test_account_cleanup` needs an admin, a typed email tag (G-2) and a second secret. How does a customer route call it with the session user as target: server-supplied full email as the tag, actor recorded as self-service, same secret? What replaces `requireAdmin` (session + statement + code)? How is the `no-deletion-paths` guard updated? Does the target id flow only from the server?
- [ ] **TQ-11 Read-only pre-check.** Can the engine's check (verdict) run without deleting, to list blockers in the drawer? Which of G-4…G-19 would refuse an **ordinary** real account (for example consent records, invite circle)? If most real accounts are refused, self-delete is empty in practice, so this must be answered before DE-10b.2 is sized. Map each guard to plain words.
- [ ] **TQ-12 "Paid us" test.** The exact tables and live-mode test, matching G-5.
- [ ] **TQ-13 "Pseudonymise, keep billing".** A new mode of the live hard-delete engine (regenerated cleanup function, hand-applied migration, G-1…G-19 review, chain with `20261075` and finance 4b.1 `20261076` / `20261077`), or a separate small step that runs before a "keep the login and billing" delete? How G-5 changes from refuse to pseudonymise. All-or-nothing in one transaction. Which tables are deleted versus kept (the business's own data deleted in full; our billing tables kept). How the login is closed (placeholder email, remove password, identities, sessions, refresh tokens, permanent ban) through Supabase Auth.
- [ ] **TQ-14 PII inventory on the live schema.** Which columns on our billing and payment tables (`business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges` / lots / totals, `business_os_boost_purchases`, `credit_transactions`, `user_subscriptions`, payment history, any Stripe event payload or metadata JSON) hold personal details, and what each is set to (NULL, placeholder, or kept). Use `business-os-schema-check`. Include JSON columns that copy Stripe payloads.
- [ ] **TQ-15 Stripe `cancel_at_period_end`.** Through the plan-payments code and its webhook; what if the subscription is already cancelled, past due or in trial; where the period end comes from; undo for Cancel deletion. How later webhooks (a refund after deletion) land on a tombstone account without failing or re-adding personal details.
- [ ] **TQ-16 The freeze.** One flag or state checked by Connect onboarding, invoice send, client plan start, credit purchase and plan change. Where it lives, and whether it touches the entitlements module (registration required).
- [ ] **TQ-17 Scheduled deletions.** State on the receipt (`scheduled`, `scheduled_for`), the admin due list, the 7-day grace and the owner email, and the partial unique index over `scheduled` / `running`.
- [ ] **TQ-18 Email code.** Reuse the invite-signup code mechanism or similar (mind the PostgREST update + or + select bug); dedupe; throttling.
- [ ] **TQ-19 Sign-out and after-delete.** Ending every session; the "account deleted" screen without a session; confirmation email to an address held in memory only; where self-service audit rows live so they survive the deletion.
- [ ] **TQ-20 Re-confirm the carried rulings** in §5.2, including migration `20261080` (no file ≥ `20261076` found in the `neuronforge-de10b` worktree on 2026-10-18; other branches and worktrees not re-checked), the manual gate, and whether DE-10b.3 needs its own migration number.
- [ ] **TQ-21 Tombstones everywhere else.** How the finance and admin pages show "Deleted account {ref}" (where `{ref}` comes from, and that it does not come from the email); which crons, emails, reminders, user counts and admin lists must skip tombstones; how the purge, the data export and the audit erasure treat a tombstone; does the tombstone count against any plan or entitlement.
- [ ] **TQ-22 Stale sweep in pseudonymise mode.** The carried "is the login still there" test cannot tell success from failure when the login is kept. Use the placeholder email or a tombstone marker as the second signal.
- [ ] **TQ-23 Relation to the purge plan.** Confirm that pseudonymise-in-place matches purge D3 and can share code with it, that purge slice 5's customer self-delete is superseded for "delete my account", and that Reset / Purge stay separate.

---

## 13. Out of scope / future roadmap

- **Automatic deletion on the scheduled date** (today the admin runs it).
- **Redacting the customer's personal details on the Stripe Customer object** after deletion. Its own small slice.
- **What happens to kept billing rows after retention** (BQ-18).
- Giving the deleted person a self-service copy of their receipt (support sends it on request).
- A restore or undo window after the delete has run (UD-6: none).
- Annual plans (none exist; if added, the wait could exceed one month and this flow must be revisited).

---

## 14. Superseded decisions

| Old | Replaced by (2026-10-18) |
|---|---|
| BQ-1 Option C: customer request queue worked by an admin | Never-paid accounts delete themselves now; paid accounts are scheduled for period end and deleted by the admin (§4) |
| BQ-2 Receipt 7 years, Israeli limitation period, lawyer confirms | One retention setting for receipt and kept billing rows, placeholder 7 years, CPA confirms (BQ-13) |
| BQ-3 No masked email hint | **Still stands** |
| BQ-4 Admin reason required | **Still stands** (§7) |
| BQ-5 Act within 30 days, admin reminder at day 21 | No queue. Never-paid: immediate. Paid: at period end, at most one month. No reminder |
| BQ-6 Paid customer handled by hand until AD-2 / AD-3 | Pseudonymise in place, run by the admin on the scheduled date (§4.2, §6) |
| BQ-7 Cancel link in the "request received" email | "Cancel deletion" button in Settings for paid accounts (BQ-12); no request email |
| BQ-8 Support mailbox owed | **Still open** (BQ-8 in §11) |
| BQ-9 Retention for refused attempts and test accounts | Completed deletions follow BQ-13; the rest still open (BQ-9 in §11) |
| BQ-10 Account stays active while a request waits | Paid account stays usable until period end, frozen for new money (§4.2) |
| Two typed phrases (A "I have a copy" / B "I don't want a copy") | One statement (§3.2) |
| Download button in the drawer | No button; the drawer points to Settings → Download my data |
| Separate financial archive table, then delete our billing rows (first 2026-10-18 draft) | Rejected by the user the same day: billing rows stay in place, pseudonymised (§6) |
| SA C-4 (DE-10a dependency) | Moot, #456 merged |
| SA C-10 (no request before admins can see it) | No request queue. Its spirit carries: no scheduled deletion ships before admins can see due ones (both in DE-10b.4) |
| SA C-11 (untestable "unreadable phrase list") | Replaced by the statement Jest guard (§10.1 DE-10b.2) |
| SA TQ-7 request email + `request_email_sent_at` | Applies to the confirmation emails instead (dedupe per receipt), SA to re-confirm |
| SA TQ-9 purge slice 5 reuse | Superseded by TQ-23 |

---

## 15. Notes on integration points

| System | Impact |
|---|---|
| `components/business-os/purge/DangerZonePanel.tsx` / `ErasureRequestContent` | Becomes the delete drawer; mailto removed (DE-10b.2 never-paid, DE-10b.4 all) |
| Settings → Download my data (DE-9) | Named by the drawer; unchanged |
| `lib/business-os/purge/confirmation.ts` | `normaliseConfirmation` reused unchanged; new `lib/business-os/account-deletion/acknowledgement.ts` holds the statements and `normaliseAcknowledgement` |
| `/api/admin/test-account-cleanup/delete`, `runCleanupDelete`, `TestAccountCleanupPanel` | Reason, write-ahead hook, receipt outcome (DE-10b.1); pseudonymise mode (DE-10b.3); due list (DE-10b.4) |
| `operator_test_account_cleanup` + `scripts/generate-test-account-cleanup-sql.ts` | Called by self-service (DE-10b.2, TQ-10); possibly a pseudonymise mode (DE-10b.3, TQ-13) |
| Our billing tables (`business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges` / lots / totals, `business_os_boost_purchases`, `credit_transactions`, `user_subscriptions`, payment history) | Kept in place; personal columns blanked (DE-10b.3, TQ-14) |
| Admin finance / health pages and admin user lists | Show "Deleted account {ref}"; totals unchanged; tombstones hidden from live-user lists (DE-10b.3, TQ-21) |
| Supabase Auth | Tombstone: placeholder email, credentials and sessions removed, permanent ban (DE-10b.3) |
| Plan payments (Stripe subscriptions, webhook) | `cancel_at_period_end` and undo; late webhooks on a tombstone (DE-10b.4, TQ-15) |
| Connect onboarding, invoice send, client payment plans, credit purchase, plan change | Freeze check (DE-10b.4) |
| Crons, reminders, notification senders, user counts | Skip tombstones (TQ-21) |
| `/api/cron/data-export` (`runExportSweep`), `bosCronJobs.ts` | Stale sweep (DE-10b.1), receipt retention (DE-10b.5) |
| `lib/notifications/emailTransport.ts` | Confirmation, scheduled and grace emails; code email if BQ-11 |
| `lib/security/rateLimit.ts` | Statement, code and lookup throttling |
| `lib/business-os/supportContact.ts` | Support address swap point (BQ-8) |
| `descriptors.ts` | Receipt registered `never` |
| Privacy notice | One paragraph (§6.7) |
| Parent requirement and purge requirement | TL splices: DE-10b becomes slices 10b.1–10b.5; pseudonymise-in-place aligns with purge D3; purge slice 5 self-delete superseded for this case (TQ-23) |

---

## SA Review — 2026-10-17 (historical)

Kept for the record. It reviewed the superseded option C. The rulings that still apply are carried into §5.2 and wait for SA to re-confirm (TQ-20).

**Status then:** ⚠️ Approved with conditions C-1 … C-12. Evidence read at `origin/main` `f776bfdc`.

| Item | Ruling (short) | Now |
|---|---|---|
| S-1 | Option C approved; no new deletion path; cleanup function not changed; G-2 means "any account that never paid", not a general customer delete | Superseded: the new flow adds a self-service deletion path (TQ-10) and may change the cleanup function (TQ-13) |
| TQ-1 | FK-less `business_os_deletion_receipts`, no `user_id`, service role only, registered `never`, Jest guard | Carried |
| TQ-2 | HMAC on `DELETION_RECEIPT_FINGERPRINT_KEY`, key version, lookup-only old keys, fails closed | Carried |
| TQ-3 | No FK, so G-10 / G-17 / G-18 / survivor scan ignore the table | Carried |
| TQ-4 | Write-ahead hook in `runCleanupDelete`; `running` + stale sweep | Carried; stale test needs a second signal in pseudonymise mode (TQ-22) |
| TQ-5 | `BUSINESS_TEST_ACCOUNT_REMOVED` sits on the admin's `user_id`, counts only | Carried as fact |
| TQ-6 | `normaliseAcknowledgement` | Carried |
| TQ-7 | Request email via `emailTransport`, claim-then-send dedupe | Adapted to confirmation emails |
| TQ-8 | Retention + stale sweep in `/api/cron/data-export` | Carried |
| TQ-9 | One acknowledgement module, one writer, slice 5 reuse | Module and writer carried; slice 5 reuse superseded |
| C-1 | Migration `20261080`, never `20261072` / `20261073`, manual gate | Carried, re-verify |
| C-2 | Schema check before the workplan | Carried |
| C-3 | Missing key turns the delete off; key set in Vercel before deploy | Carried, now covers self-service too |
| C-4 | Do not wait for DE-10a | Moot |
| C-5 | Hook placement and its Jest cases | Carried |
| C-6 | `requireAdmin` first, Zod `.strict()`, session user only, Pino ids only, new audit events | Carried |
| C-7 | Lookup is POST, rate-limited per admin | Carried |
| C-8 | Fingerprint recomputed at completion (max two) | Carried, applies to the scheduled wait |
| C-9 | "No names or emails" hint on the "Other" note | Carried |
| C-10 | No customer request before admins can see it | Superseded (see §14) |
| C-11 | Replace the untestable AC with a phrase guard | Adapted (statement guard) |
| C-12 | Retention from one constant via `retain_until` | Carried, now shared with the kept billing rows |
| BQ-9 / BQ-10 (SA) | Retention for refused / test; account active while waiting | BQ-9 partly open; BQ-10 decided by the new flow |

---

## User decisions — 2026-10-17 (historical)

The user answered BQ-1 … BQ-8 with "go with the suggestions" (option C, 7-year receipt, no masked hint, required admin reason, 30-day response, paid customers by hand, cancel link in email, support mailbox owed). On 2026-10-18 the user replaced most of these with the simplified flow. See §14 for what still stands.

---

## SA Review 2 — 2026-10-18

**Reviewed by SA — 2026-10-18**
**Status:** ⚠️ Approved with conditions (C2-1 … C2-12 below). The flow is approved. The delivery plan is **cut from 5 slices / ~15 d to 4 slices / ~10 d**, and the first release (~6.5 d) lets every account without a running plan delete itself.
**Evidence:** code read at `origin/main` `f7429b57` (read-only). Migration numbers checked on `origin/main`, every local and remote branch, and every worktree folder. **No SQL was run.** The live-schema facts still owed are in §H, as read-only SQL for TL.

### A. Five findings that change the plan

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F-1 | **The live hard delete cannot be reused as-is for a self-delete.** G-2 is `strpos(email, tag)` with a caller-supplied tag. If the server passed the full email as the tag, G-2 would always pass, so it would silently stop being the "test accounts only" boundary that OX-1r rests on | `scripts/generate-test-account-cleanup-sql.ts` `guardRowsCte` G-2; OX-1r header | Self-service needs its own mode with its own guard, not the tag |
| F-2 | **A self-delete through today's function would roll back every time.** The function writes its audit row with `user_id = actor_id = p_actor` *after* it removes the login, and refuses a delete without `p_actor`. With the user as their own actor, the audit insert breaks the `audit_trail.user_id` link to the login (listed as a `tenancy` FK in 20261041), so the whole transaction rolls back | `buildDeleteBlock`, `renderFunctionSql` (`p_mode = 'delete' AND p_actor IS NULL` raises) | The function must change anyway (regenerate + hand-applied migration) |
| F-3 | **G-14 and G-15 refuse ordinary real accounts.** G-14 refuses any account with rows in `marketing_consent_events`. Those rows are the business's *clients'* consent from website forms and subscriber sign-ups. The table is append-only, and its trigger refuses every delete. G-15 refuses any account that invited someone who still exists, which covers every champion. A full hard delete is therefore empty for exactly the accounts that use the product | G-14, G-15 rows; `trg_mce_guard`; descriptors D8 note | Do not build two engines. Use one "close and anonymise" mode for every customer deletion (R-1) |
| F-4 | **Our billing tables hold almost no personal columns.** None of `business_os_billing_accounts`, `_billing_events`, `_boost_purchases`, `_boost_reversal_events`, `_credit_charges`, `_credit_lots` or `_credit_totals` has an email, name, address, phone or Stripe-payload jsonb column. What remains is: two Stripe-hosted links, `billing_accounts.action_required_invoice_url` and `boost_purchases.receipt_url` (anyone holding the link sees the customer's billing details), the admin free text `credit_lots.reason`, and the Stripe Customer id, which is a pseudonymous pointer. The legacy tables (`credit_transactions`, `user_subscriptions`, `billing_events`) are dashboard-only, with no migration, so they need SQL-1 | Migrations 20261015, 20261017, 20261025, 20261027, 20261030, 20261076 | §6.3 shrinks to a short blank list. Most of the "PII inventory" risk is gone |
| F-5 | **"Every finance total unchanged" is not achievable as written.** Finance code also reads `payment_invoices`, `payment_transactions`, `payment_plans` / `_subscriptions` / `_installments`, `payment_refunds`, `payment_reminders` (the business's own client takings) and `token_usage` (our AI cost). The client data is the owner's, and §4 deletes it | `git grep "from('…')"` over `lib/business-os/finance` + `BusinessOsFinanceReadRepository` | Narrow the AC to **our** revenue and credits: plans, boosts, refunds, credit ledger. Client takings drop from live totals, and dated finance snapshots (20261078) keep past months. `token_usage`: NBQ-2 + SQL-1 |

### B. Headline rulings

- **R-1 One mode for every customer deletion: close and anonymise (tombstone).** The customer path never hard-deletes `auth.users`. The login is closed and anonymised inside the same transaction that deletes the business data (§D). It applies to never-paid and paid accounts alike. A paid account simply also keeps its billing rows. **What the customer sees is unchanged:** everything is gone, sign-in is impossible, and the email is free to sign up again. OX-1r and the admin **test-account** hard delete stay exactly as they are. This keeps purge D3 / D14 / UD-1 true for product paths ("the login is kept"). Confirm with the user as NBQ-1 (default yes).
- **R-2 The receipt is inserted inside the function's transaction**, not by a write-ahead hook. The function now changes anyway (F-2), so the 2026-10-17 reason for the hook (S-1, "the function is not changed") no longer holds. A receipt exists **if and only if** the deletion committed. That removes the `running` status, the stale sweep, TQ-22 and the `beforeDestructive` hook. The fingerprint is computed in TS (the key never reaches the DB) and passed in as a parameter.
- **R-3 Refused and failed attempts are audit rows, not receipts.** The existing `BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED` pattern covers them, plus a new `ACCOUNT_DELETION_REFUSED` for the customer path. Receipts are then only completed (and later scheduled / cancelled) deletions, all on one retention constant. **BQ-9 is moot.**
- **R-4 Only a running plan has to wait.** An account that paid us in the past, has no running plan (G-6 clear) and has nothing in flight deletes itself **at once** in release 1, with its billing kept. **BQ-17 is answered: no waiting.** In release 1, a running plan is a plain-word blocker: "Your plan renews on {date}. Cancel it first, or contact support". Scheduling at period end moves to release 2.
- **R-5 No freeze.** Do not build a freeze in any slice. A scheduled account that sends an invoice, reconnects Stripe or starts a client plan is refused by G-8 / G-9 on the date, and the grace and the email handle it. A plan change is already refused while `cancel_at_period_end` is set (`planUpgrade.ts` → `subscription_cancelling`). `account_frozen` must never be used (`lib/__tests__/accountFrozenWriters.guard.test.ts`). **BQ-16 is moot.** The one optional check is a boost purchase while scheduled (BQ-15 lost credits), behind a single helper in release 2.
- **R-6 The lookup UI and the retention sweep move to release 3.** At a placeholder of 7 years, the first `retain_until` falls in 2033. Condition: release 3 ships before any receipt can reach `retain_until`, and a Jest pin keeps the constant at 1 year or more.

### C. TQ answers

| TQ | Ruling |
|---|---|
| TQ-10 | Do not reuse via the tag. The regenerated function adds modes `anonymise_check` / `anonymise` and a param `p_subject uuid`. In these modes **G-2 is replaced by G-2a**: `p_subject` and `p_email` must resolve to the **same** login. The customer route takes both from `supabaseServerAuth().auth.getUser()` (never `getSession`, never the body). `requireAdmin` is replaced by: the session user, the server-held statement match, the rate limit, and a separate off switch `isAccountSelfDeleteEnabled()` (default off, never `use…`). Same second secret, same `TestAccountCleanupRepository`, same pg channel. A second secret adds no protection (both are server env), so one secret plus the flag is enough. `no-deletion-paths`: family 4 allow-lists the generated migration for `UPDATE auth.users` / `DELETE FROM auth.identities|sessions|refresh_tokens|mfa_factors|one_time_tokens`. A new assertion: `TestAccountCleanupRepository` is imported only by an allow-list of routes (admin cleanup check/delete + the one self-delete route). |
| TQ-11 | Yes. `check` and `anonymise_check` already run read-only (`transaction_read_only`) and return **every** guard row, not just the first, so the drawer pre-check is the same call. Would refuse an ordinary real never-paid account under the **hard** delete: **G-2 (always), G-14 (any website / subscriber consent), G-15 (invited someone)**, G-8 (Stripe connected), and rarely G-13 / G-16 / G-10. Schema-drift guards G-11 / G-17 / G-18 / G-19 refuse **everyone** until the generator is regenerated. Under R-1 the mode does not block on G-2 / G-5 / G-7 / G-14 / G-15. Plain words: G-8 / G-9 as in §4.2; G-6 "your plan is still running (renews {date})"; G-4 "admin accounts cannot be deleted here"; G-12 none (the storage step empties it); G-10 / G-11 / G-13 / G-16 / G-17 / G-18 / G-19 "we need to finish something on our side, contact {support}". Measure the real distribution with SQL-3 and the admin **Check** on 3–5 real accounts (read-only; ignore its G-2 row). |
| TQ-12 | "Paid us" = any G-5 row (`livemode` on `business_os_billing_accounts`, `_boost_purchases` or `_billing_events`) **or** any G-7 row (legacy `user_subscriptions.stripe_subscription_id`, `credit_transactions.stripe_payment_intent_id`, `billing_events.stripe_event_id`, treated as real money). Under R-1 this only decides the receipt `mode` label and whether billing rows exist to keep. It no longer picks a path. |
| TQ-13 | A **mode of the engine**, not a separate step. It is the only way to be all-or-nothing, because Supabase Auth admin API calls cannot join the transaction. Regenerate with `PREVIOUS_FUNCTION_MIGRATION = 20261077`. Keep-set, blank list, auth closure and guard table: §D. |
| TQ-14 | Our tables: F-4. Blank `action_required_invoice_url`, `open_checkout_session_id`, `receipt_url`, `credit_lots.reason`. Keep every id, amount, currency, date, tier, status and `livemode`. Legacy tables and any jsonb column: SQL-1 / SQL-1b, to be pasted here before the S1 workplan (C2-2). |
| TQ-15 | Release 2. The BOS plan has no cancel route today. `app/api/stripe/cancel-subscription` is the legacy `user_subscriptions` path, so do not extend it. Add `StripeService` subscription update (`cancel_at_period_end: true/false`) with the account's `livemode` key. `planSubscriptionMirror` already mirrors `cancel_at_period_end` and `ended_at`. Period end comes from the Stripe response, not the mirror. `trialing`: allowed, it ends at trial end. `past_due` / `unpaid` / an open checkout / `pending_tier`: blocker. Already ended: R-4 (immediate). Undo only while `status IN (active, trialing)`, before period end and before the delete starts. **The delete runs only after `ended_at` is set** (G-6 stays blocking), so it never races the `subscription.deleted` webhook. Late webhooks (refund, dispute) resolve the account by Stripe ids, write only ids, amounts and status onto the same `user_id`, and none of their columns is personal (F-4). Nothing to change beyond C2-9. |
| TQ-16 | No freeze (R-5). If the user wants boost purchases blocked while scheduled, use one helper `isDeletionScheduled(userId)` reading the receipt by `subject_user_id`, outside `lib/business-os/entitlements/` (no registration needed). It must not import from that module. |
| TQ-17 | Release 2. Receipt `status = 'scheduled'`, `scheduled_for`. Partial unique index on `subject_user_id WHERE status = 'scheduled'`. Admin due list = scheduled rows whose billing row has `ended_at` set. One owner email on refusal. 7-day grace is a displayed date, not a job. Automatic running stays out of scope. |
| TQ-18 | Recommend **no code in v1** (NBQ). If wanted later: Supabase Auth's own email OTP (`signInWithOtp({ shouldCreateUser: false })` + server `verifyOtp`) needs no new table and is throttled by Supabase, but uses the login email template. The invite code (`lib/business-os/invites/signupCode*.ts`) is bound to invite rows, so reuse would add storage and the PostgREST `update + or + select` trap. |
| TQ-19 | The function deletes the user's sessions and refresh tokens (§D), so `getUser()` fails at once. The route then clears the auth cookies (`signOut({ scope: 'local' })`) and returns. The client goes to a public `/account-deleted` page that needs no session. The email is sent after commit from `user.email` held in a local variable, best-effort, never stored, one send per request (no dedupe column). Audit rows that must survive are written with `user_id = NULL`, `entity_id = subject id`, through `logAndFlush`. The in-function audit row is `user_id = actor_id = NULL`, `details.source = 'self_service'` for self, and the admin's id for admin. Residual: an access JWT stays valid for PostgREST reads for at most its lifetime (≤ 1 h) over rows RLS still shows the owner. Only kept billing rows are left (SQL-5). Accepted. |
| TQ-20 | §5.2 re-confirmed or amended in §E. Migrations: **`20261080`** receipt table, **`20261081`** regenerated function. 76–79 are on `origin/main` (finance 4b.1, finance 8.1, model pricing slice 8). Nothing at 80 or later on any branch or worktree today. Re-verify at PR. Both are manual gate. |
| TQ-21 | Placeholder email `deleted-{ref}@deleted.invalid` (RFC 2606 reserved TLD, never deliverable), `{ref}` = first 12 hex of the receipt id. Marker: `raw_app_meta_data.deleted = true`. One TS helper `isClosedAccountEmail()`. Finance and admin pages label via that helper ("Deleted account {ref}"), so no join changes. **Emails:** `emailTransport.sendEmail` refuses any `.invalid` recipient, which covers every sender at once. **Crons, counts, entitlements:** profiles, preferences, plan rows and all business data are deleted, so business crons find no rows, and profile-based counts (`SystemAnalyticsService`) drop the account. Crons over **kept** tables (`bos-billing-reconcile`, `credit-leak-check`, `finance-snapshot`) must tolerate a closed account: QA case, no code expected. The free-tier expiry cron is permanently disabled. **Admin users list:** hide closed accounts by default, with a "show deleted" toggle. **Purge / export / audit erasure:** need a signed-in owner, so they cannot run on a tombstone. The admin export of a tombstone returns only the kept billing rows, which is acceptable. |
| TQ-22 | Moot (R-2: no `running`). |
| TQ-23 | Confirmed. The tombstone is purge D3 ("the login is kept") taken to its end, and the plan is still generated from the purge descriptors, so the code is shared there. Purge slice 5 customer self-delete is superseded for "delete my account". Reset and Purge stay separate and inert. |

### D. The `anonymise` mode (TQ-13 detail)

| Part | Ruling |
|---|---|
| Signature | `operator_test_account_cleanup(p_mode, p_email, p_tag, p_confirm, p_actor, p_secret, p_subject uuid DEFAULT NULL, p_receipt jsonb DEFAULT NULL)`. The migration **drops the old 6-arg signature** so no old overload stays callable, then re-asserts grants. The R-6 version stamp makes the old build answer 503 between apply and deploy (accepted). |
| Guards that block | G-1, G-2a, G-4, **G-6** (plan must have ended), G-8, G-9, G-10, G-11, G-12 (after the storage step), G-13, G-16, G-17, G-18, G-19, plus a new **G-20**: every `auth.*` column the closure writes exists (schema drift → refuse) |
| Informational, not blocking | G-5, G-7 (sets receipt mode `pseudonymised_billing_kept`), G-14, G-15 (rows kept, NBQ-3 / NBQ-4) |
| Keep-set (rows stay, same `user_id`) | `business_os_billing_accounts`, `_billing_events`, `_boost_purchases`, `_boost_reversal_events`, `_credit_charges`, `_credit_lots`, `_credit_totals`, `credit_transactions`, `user_subscriptions`, `billing_events`, `processed_webhook_events` (stops a replayed event applying twice), `marketing_consent_events` + `_state`, `business_os_account_lineage`; `token_usage` per NBQ-2 / SQL-1. One reviewed list in the generator, each entry with its reason, pinned by test |
| Deleted | Everything else the descriptor plan covers, **including `profiles`, `user_preferences` and the user's `audit_trail` rows**. Do not "wipe" the profile: delete it (SQL-2 must show no keep-set table points at `profiles`) |
| Blanked in place | F-4 list + anything SQL-1 finds. Survivor check becomes "no row names the login outside the keep-set" |
| Login closure (same transaction) | `auth.users`: email → placeholder, `phone`, `encrypted_password`, confirmation / recovery / email-change tokens and `email_change` cleared, `raw_user_meta_data = '{}'`, `raw_app_meta_data` reduced to provider + `deleted: true`, `banned_until = 'infinity'`. Delete the user's `auth.identities`, `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors`, `auth.one_time_tokens`. Exact column list from SQL-4. **Rule 7:** direct writes to `auth.*` are approved **only inside this generated function**, as an extension of OX-1r. This is the same exception class as its existing `DELETE FROM auth.users`. |
| Receipt | Inserted last, inside the transaction, from `p_receipt` (fingerprint, key version, origin, executor, reason category, statement language + text, export facts, mode, totals). The reason **note** is stored but never logged |

### E. Carried rulings (§5.2), re-confirmed or amended

| Ruling | Now |
|---|---|
| Storage | **Confirmed.** Add `subject_user_id uuid` (no FK, indexed) and `placeholder_ref`. Still no `user_id` column, no `REFERENCES`, RLS on with no policies, registered `never` |
| Fingerprint | **Confirmed.** Missing key → every delete off, self and admin |
| Write-ahead | **Amended** by R-2: in-function insert. The `beforeDestructive` hook is dropped |
| Status life | **Amended:** release 1 `completed` only. Release 2 adds `scheduled` / `cancelled`. `running`, `refused`, `failed` removed (R-3) |
| Hebrew | **Confirmed** (`normaliseAcknowledgement`) |
| Retention | **Confirmed** (`retain_until` from one constant). Sweep moves to release 3 (R-6) |
| Sweep | **Amended:** only the retention step, release 3. No stale step |
| Lookup | **Confirmed** design, moved to release 3 |
| Logging and rules | **Confirmed**, plus customer routes: session user only, Zod `.strict()` `{ statement, language }`, `rateLimit` |
| Migration | **Amended:** `20261080` (table) + `20261081` (function). Manual gate. Rollback restores the 20261077 function |

### F. Slimmed slice plan

| Release | Slice | Delivers | Size |
|---|---|---|---|
| 1 | **DE-10b.1 Engine + receipt + admin reason** | 20261080 receipt table, 20261081 regenerated function (`anonymise` modes, keep-set, blank list, login closure, in-function receipt + audit), repository methods, fingerprint key (fails closed), required reason on the `/admin/users` delete, admin delete of a **real** account uses `anonymise` (so admins can handle paid customers from day one, replacing "by hand") | 🔴 ~4 d |
| 1 | **DE-10b.2 Self-delete for every account without a running plan** | Danger Zone drawer (warning, no download button, statement en / he / es draft), `GET` pre-check + `POST` delete on the session user, plain-word blockers (running plan → "cancel first / contact support"), sign-out, `/account-deleted` page, confirmation email, `.invalid` refusal in `emailTransport`, "Deleted account {ref}" label, admin users list hides closed accounts, privacy paragraph, mailto removed except for blockers | 🟡 ~2.5 d |
| 2 | **DE-10b.3 Running plan: schedule at period end** | `cancel_at_period_end` set / undo, `scheduled` receipt, "Deletion scheduled for {date}" + Cancel deletion, admin due list (ended plans), refusal email + grace date | 🟡 ~2.5 d |
| 3 | **DE-10b.4 Lookup + retention** | Admin "Deletion receipts" view, `POST` check-an-email (audited), retention step in `runExportSweep` | 🟢 ~1 d |

**Total ~10 d (was ~15). Release 1 is ~6.5 d** and covers every account except those on a running plan. A smaller safe release does not exist: a "receipt + never-paid hard delete in ~4 d" release is blocked by F-1 / F-2 (it needs the same function change) and would be empty in practice because of F-3. Email code, if wanted: +0.5 d on DE-10b.2.

### G. Conditions

- **C2-1** NBQ-1 … NBQ-5 answered (or defaults accepted) before the DE-10b.1 workplan.
- **C2-2** SQL-1 … SQL-5 run by TL. Results pasted here before the DE-10b.1 workplan. Any personal column added to the blank list. `token_usage` decided.
- **C2-3** `business-os-schema-check` at workplan time for every table and `auth.*` column in §D.
- **C2-4** Apply 20261080 then 20261081 by hand on prod. The PR is manual gate, never auto-merged. Rollback file restores the 20261077 function. Re-check that both numbers are still free at PR time.
- **C2-5** `DELETION_RECEIPT_FINGERPRINT_KEY` set in Vercel Production + Preview before deploy. The cleanup secret is Production-only, so self-delete answers "not available" on Preview. QA runs on prod with a disposable, non-`+test` account created for the purpose.
- **C2-6** `no-deletion-paths` family 4 extended (auth writes) and the repository-importer allow-list (TQ-10), each with a negative fixture.
- **C2-7** Generator tests pin the keep-set, the blank list, G-2a / G-20, the dropped old signature and the closure columns. A Jest guard on the 20261080 migration refuses `REFERENCES` and a `user_id` column.
- **C2-8** Finance AC rewritten per F-5. QA compares plan revenue, boost revenue, refunds and the credit ledger before and after one anonymise run.
- **C2-9** `bos-billing-reconcile`, `credit-leak-check` and `finance-snapshot` tested against a closed account (no crash, no email, no row with personal data).
- **C2-10** Customer routes: `getUser()` only, no id or email from the body, Zod `.strict()`, `rateLimit` on the statement, off switch `isAccountSelfDeleteEnabled()` default off, Pino ids only, audit via `logAndFlush` on `user_id = NULL` rows.
- **C2-11** The storage step still runs first (cleanup SA-6). If a guard appears between the storage step and the delete, the files are gone and the account stays. The route must say so, and an audit row must record it. Accepted for real accounts, because the customer asked for everything to be deleted.
- **C2-12** The privacy paragraph must not claim the Stripe Customer object or Supabase's own auth log (`auth.audit_log_entries`, SQL-4b) were cleaned. Both stay follow-ups.

### H. Read-only SQL for TL (prod `jgccgkyhpwirgknnceoh`, SQL editor)

**SQL-1 — columns of the kept tables (TQ-14)**

```sql
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns AS c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('business_os_billing_accounts','business_os_billing_events','business_os_boost_purchases',
    'business_os_boost_reversal_events','business_os_credit_charges','business_os_credit_lots','business_os_credit_totals',
    'credit_transactions','user_subscriptions','billing_events','processed_webhook_events','token_usage',
    'marketing_consent_events','marketing_consent_state','business_os_account_lineage')
ORDER BY c.table_name, c.ordinal_position;
```

**SQL-1b — for each `json` / `jsonb` column SQL-1 lists**, replace `<table>` and `<column>`:

```sql
SELECT k.key, count(*) AS rows_with_key
FROM public.<table> AS t
CROSS JOIN LATERAL jsonb_object_keys(t.<column>::jsonb) AS k(key)
WHERE jsonb_typeof(t.<column>::jsonb) = 'object'
GROUP BY k.key
ORDER BY 2 DESC;
```

**SQL-2 — foreign keys on the kept tables (keep-set safety, profile delete)**

```sql
SELECT child.relname AS child_table, att.attname AS child_column,
       pnsp.nspname || '.' || parent.relname AS parent_table, con.confdeltype AS on_delete
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS child ON child.oid = con.conrelid
JOIN pg_catalog.pg_class AS parent ON parent.oid = con.confrelid
JOIN pg_catalog.pg_namespace AS pnsp ON pnsp.oid = parent.relnamespace
JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
WHERE con.contype = 'f'
  AND child.relname IN ('business_os_billing_accounts','business_os_billing_events','business_os_boost_purchases',
    'business_os_boost_reversal_events','business_os_credit_charges','business_os_credit_lots','business_os_credit_totals',
    'credit_transactions','user_subscriptions','billing_events','processed_webhook_events','token_usage',
    'marketing_consent_events','marketing_consent_state','business_os_account_lineage')
ORDER BY 1, 2;
```

**SQL-3 — which guards real accounts would hit (TQ-11)**

```sql
WITH real_users AS (
  SELECT u.id FROM auth.users AS u
  WHERE u.email IS NOT NULL AND strpos(lower(u.email), '+test') = 0
    AND NOT EXISTS (SELECT 1 FROM public.admin_users AS a WHERE a.user_id = u.id)
)
SELECT
  (SELECT count(*) FROM real_users) AS real_accounts,
  (SELECT count(*) FROM real_users AS r WHERE
      EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS b WHERE b.user_id = r.id AND b.livemode)
   OR EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS p WHERE p.user_id = r.id AND p.livemode)
   OR EXISTS (SELECT 1 FROM public.business_os_billing_events AS e WHERE e.user_id = r.id AND e.livemode)) AS g5_paid_live,
  (SELECT count(*) FROM real_users AS r WHERE EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS b WHERE b.user_id = r.id
      AND (b.subscription_status IN ('active','trialing','past_due','unpaid','paused')
           OR (b.stripe_subscription_id IS NOT NULL AND b.ended_at IS NULL)))) AS g6_running_plan,
  (SELECT count(*) FROM real_users AS r WHERE
      EXISTS (SELECT 1 FROM public.user_subscriptions AS s WHERE s.user_id = r.id AND s.stripe_subscription_id IS NOT NULL)
   OR EXISTS (SELECT 1 FROM public.credit_transactions AS c WHERE c.user_id = r.id AND c.stripe_payment_intent_id IS NOT NULL)
   OR EXISTS (SELECT 1 FROM public.billing_events AS l WHERE l.user_id = r.id AND l.stripe_event_id IS NOT NULL)) AS g7_legacy_money,
  (SELECT count(*) FROM real_users AS r WHERE
      EXISTS (SELECT 1 FROM public.stripe_connect_accounts AS k WHERE k.user_id = r.id)
   OR EXISTS (SELECT 1 FROM public.plugin_connections AS pc WHERE pc.user_id = r.id AND pc.plugin_key = 'stripe')) AS g8_stripe_connected,
  (SELECT count(*) FROM real_users AS r WHERE
      EXISTS (SELECT 1 FROM public.payment_plan_subscriptions AS m WHERE m.user_id = r.id AND m.status IN ('pending','active','past_due','paused'))
   OR EXISTS (SELECT 1 FROM public.payment_transactions AS m WHERE m.user_id = r.id AND m.status = 'pending')
   OR EXISTS (SELECT 1 FROM public.payment_refunds AS m WHERE m.user_id = r.id AND m.status = 'pending')
   OR EXISTS (SELECT 1 FROM public.payment_invoices AS m WHERE m.user_id = r.id AND m.status IN ('sent','overdue'))) AS g9_money_in_flight,
  (SELECT count(*) FROM real_users AS r WHERE EXISTS (SELECT 1 FROM public.marketing_consent_events AS m WHERE m.user_id = r.id)) AS g14_consent_ledger,
  (SELECT count(*) FROM real_users AS r WHERE EXISTS (SELECT 1 FROM public.business_os_account_lineage AS l
      WHERE (l.parent_account_id = r.id OR l.root_account_id = r.id) AND l.account_id IS DISTINCT FROM r.id)) AS g15_invited_others,
  (SELECT count(*) FROM real_users AS r WHERE EXISTS (SELECT 1 FROM public.shared_agent_imports AS i
      JOIN public.shared_agents AS s ON s.id = i.shared_agent_id
      WHERE s.user_id = r.id AND i.imported_by_user_id IS DISTINCT FROM r.id)) AS g16_shared_imported;
```

Then run the admin **Check** on `/admin/users` for 3–5 real accounts (read-only). It lists G-10 / G-13 / G-17 / G-18 / G-19 too. Ignore its G-2 row.

**SQL-4 — Supabase Auth columns and links the closure touches (TQ-13, G-20)**

```sql
SELECT c.table_name, c.column_name, c.data_type
FROM information_schema.columns AS c
WHERE c.table_schema = 'auth'
  AND c.table_name IN ('users','identities','sessions','refresh_tokens','mfa_factors','one_time_tokens')
ORDER BY c.table_name, c.ordinal_position;

SELECT child.relname AS auth_table, att.attname AS auth_column, con.confdeltype AS on_delete
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS child ON child.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = child.relnamespace
JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
WHERE con.contype = 'f' AND nsp.nspname = 'auth'
  AND con.confrelid IN ('auth.users'::regclass, 'auth.sessions'::regclass)
ORDER BY 1, 2;
```

**SQL-4b — does Supabase's own auth log hold emails (C2-12)**

```sql
SELECT count(*) AS rows_total,
       count(*) FILTER (WHERE payload ? 'actor_username') AS rows_with_actor_username
FROM auth.audit_log_entries;
```

**SQL-5 — can the owner still read kept rows during the ≤ 1 h token window (TQ-19)**

```sql
SELECT p.tablename, p.policyname, p.cmd, p.roles
FROM pg_catalog.pg_policies AS p
WHERE p.schemaname = 'public'
  AND p.tablename IN ('business_os_billing_accounts','business_os_billing_events','business_os_boost_purchases',
    'business_os_credit_charges','business_os_credit_lots','business_os_credit_totals','credit_transactions','user_subscriptions')
ORDER BY 1, 2;
```

### I. New business questions (plain language)

- [ ] **NBQ-1 Close the login rather than erase the record?** When a customer deletes their account, we keep an empty, nameless placeholder in place of their login. It has no email, no name, no password and no way to sign in. Their email is free to sign up again, and to them it looks exactly like a full delete. The reason: it lets every account, including ones that paid us, invited others or collected client consents, delete itself with one safe mechanism. (raised by: SA | status: pending user input) **Suggestion (SA):** yes.
- [ ] **NBQ-2 After a business deletes itself, should the finance pages still count it?** Its clients' payments are the business's own data, so they leave the live "client takings" totals (past months stay in the saved monthly snapshots). Our own revenue from it (plans, boosts, refunds) and its credits stay. Should **our AI cost** for that account also stay in the cost totals? (raised by: SA | status: pending user input) **Suggestion (SA):** yes, keep our AI cost, as long as those records hold nothing personal (SA checks).
- [ ] **NBQ-3 Keep the records of which clients agreed to, or refused, marketing emails?** They prove a person said no. They include those clients' email addresses. Keeping them under the nameless account means nobody can be emailed by mistake and we can show proof, but it is personal data of third parties. (raised by: SA | status: pending lawyer) **Suggestion (SA):** keep them, and ask the lawyer to confirm in the privacy-notice review.
- [ ] **NBQ-4 Keep the "who invited whom" link?** If a deleted account invited other businesses, it stays as a nameless link so the people it invited keep their own history and rewards. (raised by: SA | status: pending user input) **Suggestion (SA):** yes.
- [ ] **NBQ-5 First release: customers on a running plan see "cancel your plan first, or contact support".** Everyone else can delete at once. "Delete at the end of my paid month" comes in the second release. (raised by: SA | status: pending user input) **Suggestion (SA):** yes.
- Effect on §11: **BQ-9 moot** (R-3), **BQ-16 moot** (R-5), **BQ-17 answered** (no wait, R-4). **BQ-11:** SA suggests **no** for release 1; the typed statement and the signed-in session are the gate. **BQ-12:** release 2.

### Approval

[x] Requirement approved with conditions C2-1 … C2-12. Proceed to the DE-10b.1 workplan once C2-1 and C2-2 are met.

---

## TL SQL results — 2026-10-18 (C2-2, prod jgccgkyhpwirgknnceoh, read-only)

**SQL-3 — guards real accounts hit** (10 real, non-`+test`, non-admin logins): G-5 paid live **0** · G-6 running plan **1** · G-7 legacy money **0** · G-8 Stripe connected **3** · G-9 money in flight **4** · G-14 consent ledger **3** · G-15 invited others **0** · G-16 shared agents imported **0**. Per-account admin Check (G-10/G-13/G-17/G-18/G-19) not yet run.

**SQL-1 / SQL-1b — personal data on the kept tables:**
- Our billing tables (`business_os_billing_accounts`, `_billing_events`, `_boost_purchases`, `_boost_reversal_events`, `_credit_charges`, `_credit_lots`, `_credit_totals`): no email / name / phone / address column and no JSON column. Blank per F-4: `action_required_invoice_url`, `receipt_url`, `open_checkout_session_id`, `credit_lots.reason`. `stripe_customer_id` stays (links to the Stripe Customer, which holds name and email → the Stripe redaction follow-up).
- Legacy: `user_subscriptions` has `payment_method_last4`, `payment_method_brand`, `last_calculator_inputs` (jsonb) — blank all three. `credit_transactions.description` (text) and `metadata` keys incl. `agent_name` (554 rows) — blank `description` and `metadata.agent_name`. `billing_events.payload` (no object keys found) and `error_message` — blank.
- `token_usage` (24,353 metadata rows): `metadata` keys incl. `agent_name`, `user_goal`, `user_role`, `user_mode` (3 rows); `error_message`; `request_payload` / `response_metadata` hold no object keys today. Blank `error_message`, `metadata.user_goal|user_role|user_mode|agent_name`, `request_payload`, `response_metadata` if NBQ-2 keeps the AI-cost rows.
- `processed_webhook_events.metadata`: only `created`, `livemode` — nothing personal.
- `marketing_consent_events`: `email`, `email_normalized`, `ip_hash`, `user_agent`, `session_id`, `source_page_url`, `statement_text`, `evidence` (`client_statement`, `confirmed_via`) — third-party personal data; NBQ-3 decides.

**SQL-2 — FKs on kept tables:** none points at `profiles` (the profile delete is safe). To `auth.users`: SET NULL on our billing tables, `billing_events`, `processed_webhook_events`; NO ACTION on `credit_transactions` and `user_subscriptions`; CASCADE on `business_os_credit_totals`, `token_usage`, `marketing_consent_events/state` — harmless because the login is kept (R-1), but **a future hard delete of a tombstone would cascade-delete `credit_totals` and `token_usage`** (note for the retention decision BQ-18).

**SQL-4 — auth:** `auth.users` has `email`, `phone`, `raw_user_meta_data`, `raw_app_meta_data`, `banned_until`, `deleted_at`, `encrypted_password`, tokens. CASCADE from `auth.users`: identities, sessions, mfa_factors, mfa_recovery_code_sets, one_time_tokens, oauth_authorizations/consents, webauthn_*; `refresh_tokens` and `mfa_amr_claims` cascade from sessions; `scim_users` SET NULL. The closure must also clear `phone` and `raw_user_meta_data` and the email-change / recovery token columns.

**SQL-4b — Supabase's own auth log:** `auth.audit_log_entries` = 35,411 rows, **every one with `actor_username` (the email)**. SA to rule: delete the subject's rows inside the function (they are keyed by `payload->>'actor_id'`), or keep them and say so in the privacy notice (C2-12).

**SQL-5 — owner read policies on kept tables:** owner SELECT on `business_os_boost_purchases`, `_credit_charges`, `_credit_lots`, `_credit_totals` (authenticated), `credit_transactions` and `user_subscriptions` (public, three duplicate own-row SELECT policies on the latter). No owner policy on `_billing_accounts` / `_billing_events`. Confirms the ≤ 1 h token-window read accepted in TQ-19.

## User decisions — 2026-10-18 (after SA Review 2)

The user answered "go with the suggestions, including 6".

| # | Decision |
|---|---|
| NBQ-1 | **Yes** — close the login as an empty nameless record (R-1); email free to reuse |
| NBQ-2 | **Yes** — our AI cost for a deleted account stays in finance totals, personal notes blanked |
| NBQ-3 | **Keep** the marketing consent / refusal records under the nameless account; lawyer to confirm in the privacy-notice review |
| NBQ-4 | **Yes** — a deleted account stays as a nameless link in the invite chain |
| NBQ-5 | **Yes** — release 1: running plan sees "cancel your plan first, or contact support"; release 2 removes it |
| TL-6 | **Only Stripe-live money blocks deletion**: Stripe connected (G-8), active client payment plans, pending payments and pending refunds (G-9 rows that are live). **Sent / overdue invoices do NOT block** — they are the business's own data and are deleted with the account. SA to amend the G-9 list for the anonymise modes |
| BQ-11 | **No email code** in release 1 (SA suggestion) |
| SQL-4b | TL recommendation taken: delete the subject's `auth.audit_log_entries` rows inside the function (SA to confirm), so the privacy notice can say the sign-in log is cleaned |
| BQ-8 | Support address: **keep the user's personal email for now** (`PLACEHOLDER_ERASURE_CONTACT`); Offir asked 2026-10-18 for an official support mailbox — swap the one constant when it exists |
| BQ-13 / BQ-14 | Still with the user's CPA; placeholder 7 years; location blanked by default |

## Slice status — DE-10b.1 (Dev, 2026-10-18)

| Item | State |
|---|---|
| Workplan | [BUSINESS_OS_DATA_EXPORT_DE10B1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B1_WORKPLAN.md), SA approved with conditions W-1 to W-14 |
| Code | Complete on `feature/data-export-de10b`, **uncommitted**, waiting for SA code review and QA |
| Migrations | `20261080_business_os_deletion_receipts` (table) and `20261081_operator_account_cleanup_anonymise` (generated function). **Not applied.** Manual gate: the user applies them on prod in the order of runbook section 7.2 |
| Env | `DELETION_RECEIPT_FINGERPRINT_KEY` must be set in Vercel Production and Preview before the deploy |
| §F deviation (O-11, approved) | The `.invalid` refusal in `emailTransport` and the C2-9 cron QA cases moved from DE-10b.2 here, because the admin path makes the first tombstones |

**§D amendments taken in DE-10b.1 (SA workplan review):**

- **O-5** `banned_until = now() + interval '100 years'`, not `'infinity'` (GoTrue reads it as a Go time).
- **O-6** The GoTrue token columns become `''`, never NULL.
- **O-7** The closure deletes the full Supabase cascade list (identities, sessions, refresh tokens, MFA factors and recovery codes, one-time tokens, OAuth authorizations and consents, WebAuthn credentials and challenges) plus `auth.flow_state`; `mfa_challenges` and `mfa_amr_claims` go by cascade and the survivor scan counts them. `deleted_at` stays unset.
- **O-4** Every invite the account issued is deleted. On invites it redeemed or claimed, `email` becomes the placeholder and `personal_note`, `email_problem_detail`, `redemption_error_message` become NULL. The issuer's own columns stay.
- **SQL-4b** The account's rows in `auth.audit_log_entries` are deleted inside the function (by actor id, target id, actor email or target email, W-4), so the privacy paragraph may say the sign-in log is cleaned.

## Slice status — DE-10b.2 (Dev, 2026-10-21)

| Item | State |
|---|---|
| Workplan | [BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md), SA approved with conditions V-1 to V-10 |
| Dependency | DE-10b.1 merged (PR #468); 20261077, 20261080 and 20261081 applied on prod; checker 11/11 ok; function stamp `d72232d8fcc75e5e` live (TL, 2026-10-18) |
| Code | Complete on `feature/data-export-de10b2`, **uncommitted**, waiting for SA code review and QA. No migration |
| Off switch | `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED`, server-only, default off, on only for `true`. Off: the Danger Zone is unchanged and the delete route answers 404 |
| Routes | `GET /api/business-os/account/deletion-check` (read-only pre-check), `POST /api/business-os/account/delete` (session user only, `{ statement, language }` `.strict()`) |
| User decisions applied | One typed statement en / he / es (draft); drawer warns and names Settings → Download my data with no download button; only Stripe-live money blocks (TL-6: sent or overdue invoices do not); a running plan reads "contact us to cancel it" (NBQ-5, X-2); no email code (BQ-11); support address stays `PLACEHOLDER_ERASURE_CONTACT` (BQ-8) |
| Privacy paragraph | Drafted at [ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md](/docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md) for the user, lawyer and CPA. Where it is published is open (X-4) |
| Native check owed | Hebrew and Spanish copy of the drawer, the email and the account-deleted page |
| DE-10b.1 QA follow-ups taken | E-2 (`.invalid` refusal now reads a display-name address); I-a (the drawer's billing line does not imply live money); E-1 (the customer routes log an engine error's kind and code only, never its message) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (BA) | DE-10b requirement: typed acknowledgement (en / he phrases, server check that fails closed), deletion receipt that survives the deletion, receipt and reason on the live admin delete, three options for the customer-delete dependency (recommends C, built as B first), slices DE-10b.1–4, BQ-1…BQ-8, TQ-1…TQ-9 |
| 2026-10-17 | SA review: approved with conditions | Option C approved, with C-10 (no customer request before admins can see it). TQ-1…TQ-9 answered: FK-less platform table `business_os_deletion_receipts` registered `never`; keyed HMAC on its own env key with versioned rotation; the cleanup function is not changed; write-ahead through a hook in `runCleanupDelete`; retention runs in the data-export sweep. Conditions C-1…C-12, migration `20261080`. New BQ-9 (retention for refused attempts and test accounts) and BQ-10 (account stays active while a request waits) |
| 2026-10-17 | User decisions BQ-1 … BQ-8 recorded | All BA suggestions accepted; BQ-8 address owed; BQ-9/BQ-10 open; C-4 moot (#456 merged) |
| 2026-10-18 | Rewritten to the user's simplified flow (BA) | Option C superseded. Drawer with warning and no download button; one typed statement (en / he / es draft); never-paid accounts self-delete at once via the live hard-delete engine, login included; paid accounts: plain-word pre-check (G-8, G-9), `cancel_at_period_end`, freeze for new money, deletion at period end by admin, 7-day grace. **Pseudonymise in place** for paid accounts: billing rows stay with the same account id and personal columns blanked, login becomes a closed tombstone, finance pages show "Deleted account {ref}", G-5 changes from refuse to pseudonymise (a separate archive table was proposed and rejected by the user the same day). One retention setting (placeholder 7 years, CPA confirms); privacy notice paragraph. Slices DE-10b.1–5 (~15 d). New BQ-11…BQ-18, TQ-10…TQ-23. SA rulings carried for re-confirmation; superseded decisions tabled in §14 |
| 2026-10-18 | SA Review 2: approved with conditions | Rewritten flow approved; plan cut from 5 slices / ~15 d to 4 slices / ~10 d (release 1 ~6.5 d). Findings: G-2 tag cannot gate self-service, today's function would roll back a self-delete (audit FK), G-14 consent ledger and G-15 invite circle refuse ordinary real accounts, our billing tables hold almost no personal columns, finance also reads client takings and token_usage. Rulings: one "close and anonymise" engine mode for every customer deletion (tombstone login, no customer hard delete of auth.users), receipt inserted inside the function transaction (no write-ahead hook, no running status, no stale sweep), refused attempts are audit rows only, only a running plan waits, no freeze, lookup and retention moved to release 3. Migrations 20261080 (table) + 20261081 (function, previous 20261077), manual gate. TQ-10 to TQ-23 answered; conditions C2-1 to C2-12; NBQ-1 to NBQ-5; read-only SQL-1 to SQL-5 for TL |
| 2026-10-18 | TL ran SQL-1…SQL-5 (C2-2) | Results recorded; new findings: auth audit log holds the email on every row; legacy/AI-cost columns to blank listed |
| 2026-10-18 | User decisions after SA Review 2 | NBQ-1…5 suggestions accepted; invoices do not block (TL-6); no email code; personal email stays as support until Offir answers |
| 2026-10-18 | DE-10b.1 code complete (Dev) | Slice status spliced in: migrations 20261080 / 20261081 written, not applied; §D amended per O-4, O-5, O-6, O-7 and SQL-4b; `.invalid` refusal moved here (O-11). Uncommitted, waiting for SA code review and QA |
| 2026-10-21 | DE-10b.2 code complete (Dev) | Slice status spliced in: customer self-delete behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` (default off), pre-check + delete routes on the session user, drawer inside the existing Danger Zone surface, `/account-deleted`, confirmation email, "Deleted account {ref}" admin label, privacy paragraph draft. Uncommitted, waiting for SA code review and QA |
