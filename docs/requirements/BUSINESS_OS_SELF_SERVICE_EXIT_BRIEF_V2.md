# High-level requirement v2: Customer self-service for leaving Business OS (cancel, delete, reinstate, export)

> **Last Updated**: 2026-10-25
> Source: the user's revised brief, pasted 2026-10-25, recorded verbatim below. It supersedes `BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF.md` (v1, 2026-10-24) where they differ. TL review notes are in the last section; the brief itself is unchanged.

## Why
We compared Business OS with HubSpot's cancel/delete and export flows. Our safety rules are as strict as theirs, or stricter: a running plan, connected Stripe payouts and money in flight all block deletion, finance records are kept, and there is no undo after the final delete. The gap is the customer-facing half. Today a customer cannot cancel their plan, request deletion or change their mind without writing to us, the "Contact us" fallback goes to a personal Gmail address, and export is one instant ZIP rather than a choice of what to take.

## Goal
A Business OS owner can cancel their plan, export the data they choose, request deletion of their account and reinstate it while the deletion is still pending, all by themselves, without contacting support.

---

## Scope (in priority order)

### 1. Account deletion lifecycle: request, grace period, lock, delete
One rule for every account, paid or free.

| Stage | When | What the owner has | Emails (to the owner, in their language) |
|---|---|---|---|
| **A. Request** | Owner confirms "delete my account" | Everything as normal. The paid plan is set not to renew. | "Deletion requested". Says the plan runs to <date>, then 14 more days on the free tier, then the account closes. Includes a "Keep my account" link. |
| **B. Rest of billing cycle** (paid accounts only) | Until the paid period ends | The full plan, as normal | — |
| **C. 14-day grace** | Starts at the end of the billing cycle, or immediately for free accounts | Moved to the free tier; can still sign in, use the account and export | "Your account moves to the free tier for 14 days before it is closed on <date>". BA decides on a reminder email before the lock (suggested: 3 days before). |
| **D. Locked** | Day 14 ends | Can no longer sign in | "Your account is closed". This must be sent before the anonymise runs, because tombstoned addresses get no mail. |
| **E. Deleted** | An admin runs "close and anonymise" (existing DE-10b.1) | — | — (no undo, UD-6; the email address is free to sign up again) |

- **Confirmation.** The owner types one sentence, checked on the server, in en/he/es: *"I have exported my data and downloaded my documents"*. It follows the existing DE-10b.2 design: rate limit, session user only, fails closed.
- **The deletion drawer** points to the export drawer (item 3), and says that client documents are downloaded one by one from each contact's record.
- **The final delete is manual for now:** `/admin/users` needs a list of locked accounts that are ready to delete. The admin runs the existing anonymise engine, and its guards still apply at that moment (G-6 plan ended, G-8 no Stripe Connect, G-9 no money in flight).
- **Change to what is built:** DE-10b.2 (local branch `feature/data-export-de10b2`, commit `9f9285da`, unpushed, behind an off switch) deletes immediately. It must be reworked to "request + grace" for all accounts. It was built before about 30 later merges to `main`, so rebasing it is real work.
- Covers and replaces DE-10b.3 (scheduled delete plus "Cancel deletion").

### 2. Reinstating an account ("Keep my account")
- **Self-service in stages A–C** (billing cycle and the 14 days): a "Keep my account" button in Settings, plus the link in the request email.
  - Undo during the billing cycle: the paid plan goes back to renewing as normal.
  - Undo during the 14-day grace: the account stays on the free tier, and the owner can buy a plan again.
- **Stage D (locked): through support only.** An admin unlocks the account, which lands on the free tier, until the admin delete runs.
- **Stage E (deleted): never.** The owner can sign up fresh with the same email; nothing is restored.
- Every request, reinstatement, lock and delete writes an audit entry. Reinstating sends a "your account is kept" email.

### 3. Self-service plan cancellation (without deleting): "cancel at end of period", with undo
- There is no cancel or downgrade route for the Business OS plan today. Only a cancellation made directly in Stripe is picked up.
- Cancelling means "don't renew". It takes effect at the end of the paid period and never mid-period. The owner can undo it ("keep my plan") until that date. After that, the account falls back to the free/cohort tier, and data is kept.
- The flow has a reason picker, a "features you'll lose" screen (from the entitlements catalogue), a review step and a confirmation email. It is a plain cancel, with no offer to stay.
- It shares the "don't renew" mechanism with deletion stage A. BA decides how the two flows sit side by side in Settings.
- Out of scope: mid-period downgrades and refunds.

### 4. Data export redesign: per-module export, delivered by email
This replaces today's "Download my data" instant ZIP, which is retired.

**What the owner sees**
1. In Settings, "Export data" opens a side drawer listing the modules allowed for export (e.g. Clients, Activities & tasks, Bookings, Services, Quotes, Invoices & payments, Payment plans, Forms, Email campaigns, Newsletter subscribers, Website, Smart links). The module list is built from the existing export classification (`export` field in `lib/business-os/purge/descriptors.ts`), never hardcoded in the UI.
2. The owner ticks the modules they want, or "Select all", then clicks Export.
3. On click: a confirmation in the drawer ("Your export has started. Each module will arrive in its own email") plus one "export requested" email listing the chosen modules, with the request date and time. There is no download in the browser.
4. Each module runs as its own independent background job and emails **one joined CSV for that module, attached to the email**. The email states which module, when it was requested and when it was produced (date and time in the account's timezone). If a CSV is too big for one email, it is split across several emails, each marked "email 1 of X". If one module fails, the others still arrive, and the failed one sends a "this export failed" email.
5. Every module export writes its own audit entry (requested, completed or failed, delivered). The drawer shows an export history (module, requested at, status, delivered at, number of emails), kept until the account is deleted and removed with it.

**Decided**
- The CSV is attached to the email, not sent as a link. The owner accepted that client data sits in the mailbox.
- One joined CSV per module, even when the module spans several tables.
- Limit: **2 export requests a day** per account, each covering any number of modules, and one request running at a time. For comparison, HubSpot allows 300 a day, three at once.
- Emails and CSV column headers follow the user's language preference (en/he/es).
- Emails go to the account owner's login email.
- Files (client documents, website images) are not exported. Client documents can be downloaded one by one from each contact's record.
- The full-account ZIP, the 72 h download link and the "download again" route are retired. The Danger Zone's "Download my data" opens the new drawer.
- Export must stay available on the free tier, so it works during the 14-day grace.

**What changes in what is built today**
- Exports move from built-on-the-spot to background jobs (export Phase 2, see `BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md`), on the standard claim-pattern queue (`durable-queue-drain` skill).
- Export history moves from "latest only" to a full list.
- The admin export (DE-10a) is built on the ZIP. BA decides what it becomes.

**Suggested slicing:** (a) drawer and module selection; (b) background job per module plus email with split attachments; (c) history and audit; (d) retire the ZIP routes.

### 5. Prerequisite (ops check, not a build): confirm admin "close and anonymise" is live on prod
- DE-10b.1 (PR #468) is merged, but the last notes say migrations `20261080` (deletion receipts) and `20261081` (cleanup function) were not applied. Verify on prod and apply them if missing, per `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` §7.2. Stage E depends on this.

### 6. Later (record here, don't build now)
- Exporting a filtered list from the screen the owner is on.
- A bulk download for client documents and images.
- Automatic final delete after the lock, instead of the admin running it.
- Removing the person's details from the Stripe Customer object after deletion.
- Admin receipt lookup and the retention sweep (DE-10b.4).

---

## Rules to keep (already decided, do not reopen)
- No undo after the final delete (UD-6).
- Personal details are removed, but money records are kept for the retention period. The 7-year placeholder is pending the CPA (BQ-13).
- The admin delete guards (G-4, G-6, G-8, G-9) stay as they are.
- The export never blocks a delete request.
- Export never includes our own billing/credit tables, secrets, tokens or bank details (DX-1 and existing exclusions).

## Open issues
1. **Support / sender address:** use `notifications@agentspilot.ai` for now, both as the sender and as the support contact replacing the personal Gmail (BQ-8). This stays open until a dedicated support address exists.
2. **Leaving files out vs GDPR:** as processor we must return the business's client data before deletion (Art. 28(3)(g)). Legal to confirm that one-by-one document download plus the typed confirmation is enough.
3. **Stripe Connect or money in flight at request time:** block the request at stage A (recommended, so the owner isn't surprised at stage E), or only at the admin delete?

## References
- `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` (deletion design, SA Review 2, BQ list)
- `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md`
- `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md`, `docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md`
- `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md`
- `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §9
- `lib/business-os/billing/planUpgrade.ts`, `planSubscriptionMirror.ts`
- `app/api/crm/contacts/[id]/documents/[documentId]/route.ts` (one-by-one document download)
- Note: read from `origin/main`. The local `main` checkout may be behind.

---

## TL review notes (2026-10-25) — facts that differ from the brief

| # | Brief says | Actual (verified) | Effect |
|---|---|---|---|
| R-1 | Item 5: 20261080/81 not applied | All applied; the cleanup function is now **20261092** (applied 2026-10-25, checker 1–7 ok), PR #504 merging | Item 5 is done |
| R-2 | DE-10b.2 is local, unpushed, needs a real rebase | **Merged** as PR #503 (2026-10-24), deployed, behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` (off) | No rebase; the rework is a normal change on main. Since it is off, nobody can delete immediately today |
| R-3 | "free tier" in stages C and after cancel | **There is no free tier** (SA K-1, 2026-10-24): when a paid plan ends the account gets 5 days read-only after a 24 h margin, then paused; only a still-running Founding Partner cohort falls back to something free. Enforcement mode is `shadow` (nothing is actually limited today) | Stage C and item 3 need a product decision on what "free tier" means |
| R-4 | Stage D: "can no longer sign in" | No account lock exists today; it needs a new mechanism (e.g. the Auth ban field) and an admin unlock | New build in slice D |
| R-5 | Item 4: files not exported; Danger Zone opens the new drawer | Today's ZIP includes client documents and website images; the user decided earlier (2026-10-14) "content incl. files" | Reversal — record it; legal open issue 2 covers it |
| R-6 | Item 4 retires the ZIP | Retires DE-8a/8b/9 (jobs table, bucket, cron, zip builder) and the admin export DE-10a; the export-switches + Excel requirement (branch docs/data-export-flags-xlsx, SA-approved, not built) is superseded or folded in | BA to state what is retired vs reused (jobs table, classification, readers, switches) |
| R-7 | Attachments | `emailTransport` (Resend) already supports attachments; Resend caps a message at 40 MB including attachments; base64 adds ~33% | Split rule needs a byte budget per email |
| R-8 | Sender `notifications@agentspilot.ai` | Sender comes from `RESEND_FROM_EMAIL`; whether `agentspilot.ai` is a verified Resend domain is not known from the repo | Ops check before go-live |
| R-9 | Limit 2/day | Today's limit is 1 at a time, 3 per rolling 24 h (DB start function) | Lower it, or replace with the new request model |
| R-10 | Admin export | DE-10a (admin prepares + audited download) is live | BA decides: keep a ZIP for admins, or admin triggers the same emailed export to the owner |
