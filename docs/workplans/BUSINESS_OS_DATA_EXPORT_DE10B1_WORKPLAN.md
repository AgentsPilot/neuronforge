# Workplan: DE-10b.1 — Engine anonymise modes, deletion receipt, required admin reason

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md). Binding, in this order: *User decisions 2026-10-18 (after SA Review 2)* (NBQ-1…5, TL-6, BQ-11 no, SQL-4b delete, BQ-8 placeholder stays) → *TL SQL results 2026-10-18* → *SA Review 2* (F-1…F-5, R-1…R-6, TQ-10…TQ-23, §D, §E, C2-1…C2-12) → the rest. The SA Review of 2026-10-17 and option C are superseded where SA Review 2 says so.
**Sibling slice:** [BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md) (customer self-delete). Separate PR, cut from `main` after this one merges. No stacking.
**Branch:** `feature/data-export-de10b` (worktree `neuronforge-de10b`). ⚠️ At planning time the branch sits at `f776bfdc`, **44 commits behind `origin/main` `399070d4`** (it lacks 20261076–20261079 and the generator at 20261077). Before the first code edit, merge `origin/main` into the branch (a fast-forward today). Merges only: never rebase, never `git stash` (the stash list is shared by every worktree).
**Date:** 2026-10-18
**Status:** Code Complete (uncommitted, waiting for SA code review and QA). Nothing applied to any database
**Gate:** manual. Two hand-applied prod migrations (20261080, 20261081), so no auto-merge. The user applies them in the order in §8.

## Overview

The live hard-delete engine (`operator_test_account_cleanup`) gets two new modes, `anonymise_check` and `anonymise`. They close the login and anonymise it in place, in the same transaction that deletes the business's data. The keep-set (our billing, the AI-cost ledger, the consent ledger and the invite chain) stays under the same `user_id`, with the personal columns blanked. Every admin delete, test or real, now needs a reason, and the function writes a **deletion receipt** in the same transaction. A receipt exists if and only if the deletion committed (R-2). On `/admin/users`, an admin can delete a **real** account (paid or never paid) with `anonymise`. The test-account hard delete (OX-1r) keeps working as it does today. No customer-facing surface changes in this slice.

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Decisions this plan takes and where they come from](#2-decisions-this-plan-takes-and-where-they-come-from)
3. [The anonymise mode in detail](#3-the-anonymise-mode-in-detail)
4. [The receipt table (20261080)](#4-the-receipt-table-20261080)
5. [TypeScript side](#5-typescript-side)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Test plan](#7-test-plan)
8. [PROD apply plan](#8-prod-apply-plan)
9. [User steps](#9-user-steps)
10. [Schema check: read-only SQL for TL](#10-schema-check-read-only-sql-for-tl)
11. [Task list](#11-task-list)
12. [Risks](#12-risks)
13. [Open items for SA](#13-open-items-for-sa)
14. [Estimate](#14-estimate)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Analysis summary

Read on `origin/main` `399070d4` (2026-10-18), except where noted.

| Area | What exists | DE-10b.1 changes |
|---|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | Generates the check and delete SQL files, the function migration (now `20261077_…boost_reversal_events`, previous `20261075_…`), the rollback and the version stamp. Modes `check` / `delete`. 6-arg signature `(text, text, text, text, uuid, text)`. G-2 = `strpos(email, tag)`. The audit row is `user_id = actor_id = cleanup.actor_id`. The SQL-editor hygiene test allows exactly one `into` token (`INSERT INTO public.audit_trail (`) | New modes, `p_subject` + `p_receipt`, 8-arg signature, the old one dropped. Keep-set, blank list and auth closure as reviewed constants. G-2a, G-20 (+ proposed G-21 / G-22, §13). Receipt insert for `delete` (admin) and `anonymise`. `FUNCTION_MIGRATION = 20261081_…`, `PREVIOUS_FUNCTION_MIGRATION = 20261077_…` (re-verified on `origin/main`) |
| Migration numbers | `origin/main` holds up to `20261079_ai_price_apply_and_dismiss`. **Nothing at 20261080 or above** on `origin/main`, any local or remote branch (incl. `gh-readonly-queue/*`), or any of the 40 worktree folders (checked 2026-10-18, files untracked in worktrees included) | `20261080` receipt table, `20261081` function. Re-check at PR time (C2-4) |
| `TestAccountCleanupRepository` | One RPC (`CLEANUP_RPC`), service role, secret from `readTestCleanupSecret`. `check`, `remove`, `emptyStorage`. Parses guard rows with status `BLOCKED` | Adds `anonymiseCheck`, `anonymise`; `remove` takes the receipt; parser handles `info` rows and the anonymise report |
| `runCleanupDelete` | G-3 → check → version (R-6) → G-12-only storage step → delete | Takes the receipt input. A sibling `runAccountAnonymise` does the same order for the anonymise modes (shared with DE-10b.2) |
| `/api/admin/test-account-cleanup/{check,delete}` | `requireAdmin` first, Zod `.strict()`, 503 off switch on the second secret, `logAndFlush` refusal rows | Body adds `mode` (`hard` / `anonymise`) and `reason`. Delete refuses with 503 `not_configured` when `DELETION_RECEIPT_FINGERPRINT_KEY` is missing |
| `TestAccountCleanupPanel` | Mounted on `/admin/users` (locked, tag = email, AU-1) and `/test-business-os` (unlocked, tag) | Reason picker (required); on `/admin/users` a choice "Test account (hard delete)" / "Customer account (close and anonymise)" |
| `no-deletion-paths` guard | Family 4: `DELETE FROM auth.users` only in the allow-listed cleanup migrations | Family 4 extended to `UPDATE auth.users` and `DELETE FROM auth.(identities|sessions|refresh_tokens|mfa_factors|one_time_tokens|…|audit_log_entries)`; the new 20261081 and the previous 20261077 allow-listed; 20261075 added as history. New family 5: importer allow-list for `TestAccountCleanupRepository` |
| `descriptors.ts` | Global tables registered `never(table, G, exclude(EXPORT_REASON.PLATFORM), …)` | `business_os_deletion_receipts` registered the same way, plus the classification baseline |
| `emailTransport.sendEmail` | No recipient-domain refusal | Refuses any `.invalid` recipient (moved here from DE-10b.2, §2 D-7) |
| `audit_trail` | Deleted by the plan (`activityHistory`) | Unchanged. The function's own row is written after the deletes |

Not touched: `lib/business-os/entitlements/**` (no import of any kind, so no registration; if one appears during implementation, follow the `business-os-entitlements` skill and run `npm run test:bos-entitlements`). Every file listed in §6 holds **0** `console.*` calls today (counted on `origin/main`).

---

## 2. Decisions this plan takes and where they come from

| # | Decision | Source |
|---|---|---|
| D-1 | One engine, two new modes. `anonymise` never deletes `auth.users`. The test-account hard delete stays byte-for-byte in behaviour | R-1, TQ-13, §D |
| D-2 | The receipt is inserted **inside** the function's transaction, last. No write-ahead hook, no `running` status, no stale sweep. Release 1 statuses: `completed` only | R-2, §E |
| D-3 | Refused and failed attempts are audit rows, never receipts (`BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED` as today, plus `ACCOUNT_DELETION_REFUSED` for anonymise refusals) | R-3 |
| D-4 | G-9 in the anonymise modes blocks only on live money: C1 (running client payment plans) and C2 (pending payments, pending refunds). **C3 (sent / overdue invoices) is informational.** Hard mode unchanged | TL-6 |
| D-5 | Delete the subject's `auth.audit_log_entries` rows inside the function | User decision SQL-4b |
| D-6 | The admin real-account path uses `anonymise`. The admin picks the mode, and the reason is stored in the receipt | §F DE-10b.1 row, BQ-4, §7 |
| D-7 | **Deviation from §F, for SA:** the `.invalid` refusal in `emailTransport` and the C2-9 cron QA cases come into **this** slice, because the first tombstones are made here by the admin path, not in DE-10b.2 | Consequence of D-6 |
| D-8 | The fingerprint is computed in TS and passed in `p_receipt`. The key never reaches the DB. A missing key → every admin delete (hard and anonymise) answers 503 `not_configured` | §5.2 carried, C2-5 |
| D-9 | No new receipt repository in this slice: no TS code reads or writes the table (the function inserts). The read repository comes with the lookup in release 3 | YAGNI; open item O-9 |
| D-10 | Support address stays `PLACEHOLDER_ERASURE_CONTACT` (no change in this slice) | BQ-8 |

---

## 3. The anonymise mode in detail

### 3.1 Signature and entry rules

```sql
public.operator_test_account_cleanup(
  p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text,
  p_subject uuid DEFAULT NULL, p_receipt jsonb DEFAULT NULL)
```

- 20261081 **drops** `operator_test_account_cleanup(text, text, text, text, uuid, text)` and creates the 8-arg one. An old build calling with six named args resolves to the new function through the defaults, gets a different version stamp, and answers 503 `function_out_of_date` before any storage call (R-6, accepted in §D).
- Secret check first, unchanged (42501).
- `p_mode IN ('check', 'delete', 'anonymise_check', 'anonymise')`, else 22023.
- `delete`: needs `p_actor` (unchanged) **and** `p_receipt` (new: the admin page always sends one; the pasted operator file never calls the function).
- `anonymise_check` / `anonymise`: need `p_subject`. `anonymise` needs `p_receipt`. It needs `p_actor` unless `p_receipt->>'origin' = 'owner'` (self-service, used by DE-10b.2).
- `check` and `anonymise_check` set `transaction_read_only` (as `check` today), so the drawer pre-check (DE-10b.2) cannot write.
- New settings: `cleanup.subject_id` and `cleanup.mode`, transaction-local like the rest (SA C-5 pin extended).

### 3.2 Guards in the anonymise modes

| Guard | Anonymise | Note |
|---|---|---|
| G-1 exactly one login | blocks | as today |
| **G-2a** `p_subject` and `p_email` resolve to the same login | blocks | replaces G-2 (the tag is not read in these modes, F-1) |
| G-3 typed confirmation | blocks (`anonymise`) | admin: typed email. Self (DE-10b.2): the server passes the session email |
| G-4 not an admin | blocks | |
| G-5 live-mode money with us | **info** | sets the receipt mode `pseudonymised_billing_kept` |
| G-6 running plan | blocks | R-4 / NBQ-5 |
| G-7 legacy money | **info** | same as G-5 |
| G-8 Stripe connected | blocks | |
| G-9 C1, C2 | blocks | TL-6 |
| G-9 C3 sent / overdue invoices | **info** | TL-6: deleted with the account |
| G-10, G-11, G-12, G-13, G-16, G-17, G-18, G-19 | block | G-12 after the storage step, as today. G-17 / G-18 / G-19 are computed over the **anonymise** plan, so the keep-set tables count as "not removed" |
| G-14 consent ledger | **info** | NBQ-3: rows kept. `trg_mce_guard` lets the `contact_id` SET NULL from the `crm_contacts` delete through (read in 20260930), so deleting contacts does not trip it |
| G-15 invited others | **info** | NBQ-4: lineage row kept |
| **G-20** every `auth.*` column and table the closure writes exists, and every FK from the `auth` schema to `auth.users` / `auth.sessions` is on the reviewed closure list | blocks | fail closed on Supabase schema drift, same shape as G-10 |
| **G-21 (proposed, O-1)** every UPDATE trigger on `auth.users` and on a blanked table is reviewed | blocks | G-17 covers only DELETE triggers. A blank or the email swap fires UPDATE triggers |
| **G-22 (proposed, O-2)** no FK from a keep-set table into an anonymise-plan table with ON DELETE CASCADE / SET NULL on a NOT NULL column | blocks | otherwise deleting, for example, agents could cascade-delete kept `token_usage` rows and break NBQ-2 |

Informational rows return `status = 'info'` and never count towards `BLOCKED`. The repository maps them to a separate `notes` list.

### 3.3 Plan, keep-set and blank list

The anonymise plan is the hard plan **minus the keep-set**, in the same order, with `business_os_account_lineage` dropped from step C. One reviewed list in the generator, each entry with its reason, pinned by test (C2-7).

**Keep-set (rows stay, same `user_id`)** — SA §D, verbatim: `business_os_billing_accounts`, `business_os_billing_events`, `business_os_boost_purchases`, `business_os_boost_reversal_events`, `business_os_credit_charges`, `business_os_credit_lots`, `business_os_credit_totals`, `credit_transactions`, `user_subscriptions`, `billing_events`, `processed_webhook_events`, `marketing_consent_events`, `marketing_consent_state`, `business_os_account_lineage`, `token_usage` (NBQ-2 yes). Proposed additions for SA (O-3): `business_os_credit_lot_draws` (credit ledger detail, needed by `credit-leak-check` and the C2-8 credit-ledger comparison), and legacy `boost_pack_purchases` / `user_rewards` / `subscription_invoices` (children of kept `credit_transactions`; billing evidence).

**Blank list (TL SQL results 2026-10-18)**:

| Table | Column | Set to |
|---|---|---|
| `business_os_billing_accounts` | `action_required_invoice_url`, `open_checkout_session_id` | NULL |
| `business_os_boost_purchases` | `receipt_url` | NULL |
| `business_os_credit_lots` | `reason` | NULL, or `''` if NOT NULL (SQL-W1) |
| `user_subscriptions` | `payment_method_last4`, `payment_method_brand`, `last_calculator_inputs` | NULL |
| `credit_transactions` | `description` | NULL / `''` (SQL-W1) |
| `credit_transactions` | `metadata` | `metadata - 'agent_name'` |
| `billing_events` | `payload`, `error_message` | NULL / `'{}'` (SQL-W1) |
| `token_usage` | `error_message`, `request_payload`, `response_metadata` | NULL / `'{}'` (SQL-W1) |
| `token_usage` | `metadata` | `metadata - 'user_goal' - 'user_role' - 'user_mode' - 'agent_name'` |
| `business_os_account_lineage` | none (ids only, SA to confirm in O-4) | |
| `marketing_consent_events` / `_state` | none: kept whole (NBQ-3, lawyer to confirm). Third-party email addresses stay. This must be written in the privacy paragraph (DE-10b.2) | |

Every blank runs as dynamic SQL behind a G-11-style "column exists" check, so a renamed column refuses the run rather than failing on apply. After the loop the function re-reads each blanked column for the subject and raises if any value is left. The whole run is then rolled back.

### 3.4 Login closure (same transaction)

From SA §D and TL SQL-4. Exact columns are confirmed by SQL-W2 before code:

- `UPDATE auth.users`, exactly one row: `email = 'deleted-' || ref || '@deleted.invalid'` (ref = first 12 hex of the receipt id, which the function generates), `phone = NULL`, `encrypted_password = ''`, `raw_user_meta_data = '{}'`, `raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'deleted', true)`, `banned_until` (see O-5), token columns `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `phone_change_token`, `reauthentication_token`, `email_change`, `phone_change` set to **`''`, not NULL** (O-6: GoTrue scans these as strings, and a NULL in one row has broken `auth.admin.listUsers()` for every user on other projects).
- `DELETE` the subject's rows from every `auth` table that cascades from `auth.users` or `auth.sessions` (SQL-4 list): `identities`, `sessions`, `refresh_tokens` (its `user_id` is text: compare `::text`), `mfa_amr_claims` (via sessions), `mfa_factors` (+ `mfa_challenges` via factors), `mfa_recovery_code_sets`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`, `webauthn_*`. This **extends** SA §D's five tables to the full SQL-4 cascade list (O-7). Without it, a passkey or OAuth consent row would survive under the tombstone. G-20 refuses any auth FK not on the list.
- `DELETE FROM auth.audit_log_entries` where `payload->>'actor_id' = subject` or the payload names the subject as the target (exact keys from SQL-W3).
- `scim_users` (SET NULL from users): G-20 requires zero rows for the subject.
- Rule 7: these direct `auth.*` writes are approved **only inside this generated function**, as an extension of OX-1r (SA §D). The guard in §7.3 enforces it.

### 3.5 Survivor scan, audit row, receipt

- Survivors (anonymise): no row names the login in any FK column **outside the keep-set**. Zero rows in each closed `auth` table. `auth.users` holds exactly one row with the placeholder email, a ban, and no phone. No blanked column still holds a value. Any failure raises and rolls back everything.
- Audit row (the second `INSERT INTO`): action `ACCOUNT_PSEUDONYMISED` (O-8), `entity_type 'user'`, `entity_id` = subject, **`user_id = actor_id = NULL` for `origin = owner`** and the admin's id for admin (F-2 / TQ-19). `details`: source (`self_service` / `admin_page`), receipt id, mode, totals. No email, no reason note.
- The hard `delete` keeps its audit row exactly as 20261047 writes it.
- Receipt (the third `INSERT INTO`, function only, never in the pasted files): from `p_receipt` plus the totals, mode and `placeholder_ref` the function computes. For the hard `delete`: mode `full_delete`, no placeholder.
- Return value for `anonymise`: `{ version, mode, receipt_id, placeholder_ref, receipt_mode, rows_removed, tables_removed, rows_blanked, counts, blanked, server_ms }`. It is built directly in the block, so no audit-row search like the hard report's 15-minute window.

---

## 4. The receipt table (20261080)

`supabase/migrations/20261080_business_os_deletion_receipts.sql`. Same shape as 20261074: precondition `DO` block (refuse when anon / authenticated may CREATE in `public`, or when the table already exists), then the table, then post-conditions that raise and apply nothing.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | the function supplies it (needed for the ref) |
| `status` | text NOT NULL | CHECK `status = 'completed'` (release 2 widens it) |
| `mode` | text NOT NULL | CHECK IN (`full_delete`, `anonymised`, `pseudonymised_billing_kept`) |
| `subject_user_id` | uuid NOT NULL | **no FK**, indexed |
| `placeholder_ref` | text NULL | CHECK `~ '^[0-9a-f]{12}$'`. NULL only for `full_delete` |
| `email_fingerprint` | text NOT NULL | CHECK `~ '^[0-9a-f]{64}$'` |
| `fingerprint_key_version` | smallint NOT NULL | CHECK `>= 1` |
| `origin` | text NOT NULL | CHECK IN (`owner`, `admin`) |
| `executor_kind` | text NOT NULL | CHECK IN (`self_service`, `admin`) |
| `executor_admin_id` | uuid NULL | no FK. NOT NULL when `executor_kind = 'admin'` |
| `executor_admin_email` | text NULL | the admin's email at that moment (§5.1) |
| `reason_category` | text NULL | CHECK IN (`customer_asked`, `test_account`, `other`). NOT NULL when `origin = 'admin'` |
| `reason_note` | text NULL | 5–500 chars, required when `reason_category = 'other'`. Never logged |
| `statement_language` / `statement_text` | text NULL | `en` / `he` / `es`, at most 500 chars. Set by DE-10b.2 only |
| `owner_last_export_ready_at`, `owner_export_downloaded_at` | timestamptz NULL | copied before the delete |
| `admin_export_existed` | boolean NULL | NULL = not recorded |
| `rows_removed`, `rows_blanked`, `files_removed` | bigint NOT NULL default 0 | CHECK `>= 0` |
| `tables_removed` | integer NOT NULL default 0 | |
| `requested_at`, `completed_at` | timestamptz NOT NULL | |
| `retain_until` | timestamptz NOT NULL | CHECK `retain_until >= completed_at + interval '1 year'` (R-6 floor) |
| `correlation_id` | text NULL | |
| `created_at` | timestamptz NOT NULL default now() | |

- **No `user_id` / `owner_user_id` column, no `REFERENCES`, no trigger.** RLS on, no policies. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`. `GRANT SELECT, INSERT ON … TO service_role` (no UPDATE / DELETE in release 1. Release 3 grants DELETE for retention).
- The function inserts **as its owner (`postgres`)**, so the service_role grant is only for the release-3 reads. A post-condition asserts that `postgres` can INSERT.
- Post-conditions (self-verifying, like 20261074): table present, RLS on, zero policies, zero FKs, no column named `user_id` / `owner_user_id`, browser roles hold no table or column privilege, service_role holds exactly SELECT + INSERT, zero triggers, the indexes exist.
- Rollback `supabase/SQL Scripts/20261080_business_os_deletion_receipts_rollback.sql`: **refuses when the table holds any row** (receipts are proof). Otherwise drops it. Run only after the 20261081 rollback.
- `retain_until` comes from one TS constant `DELETION_RECEIPT_RETENTION` (placeholder 7 years, BQ-13), pinned at 1 year or more.

---

## 5. TypeScript side

| Module | Role |
|---|---|
| `lib/business-os/account-deletion/receiptFingerprint.ts` (`server-only`) | `fingerprintEmail(email)`: `HMAC-SHA256(hkdf(KEY, salt, 'neuronforge/deletion-receipt-fingerprint/v1'), lower(btrim(email)))`. Key `DELETION_RECEIPT_FINGERPRINT_KEY`, ≥ 32 chars, else `FingerprintKeyError`. `isFingerprintKeyAvailable()`, `FINGERPRINT_KEY_VERSION = 1`. The raw env value is never the HMAC key (pinned, as `previewToken.ts`) |
| `lib/business-os/account-deletion/receiptInput.ts` | Zod `.strict()` schema and builder for `p_receipt` (no email field at all: the schema has no slot for one). `DELETION_RECEIPT_RETENTION`. `computeRetainUntil(now)` |
| `lib/business-os/account-deletion/runAccountAnonymise.ts` (`server-only`) | `anonymise_check` → version (R-6) → only blocking guards stop it → storage step (only G-12 blocking, as today) → `anonymise` with its own re-check. Outcome union like `CleanupDeleteOutcome`, plus `filesRemovedThenRefused` (C2-11). Used by the admin route here and by the self route in DE-10b.2 |
| `lib/business-os/account-deletion/closedAccount.ts` | `isClosedAccountEmail(email)` (`/^deleted-[0-9a-f]{12}@deleted\.invalid$/`) and `closedAccountRef(email)`. Pure. Used by `emailTransport` now and by labels in DE-10b.2 |
| `lib/business-os/account-deletion/reason.ts` | `ADMIN_DELETE_REASONS`, Zod schema `{ category, note? }` (`other` → note 5–500). Shared by the route and the panel |
| `TestAccountCleanupRepository` | `anonymiseCheck({ email, subject })`, `anonymise(input, actorId \| null, receipt)`, `remove(input, actorId, receipt)`. Parser: `info` rows → `notes`, anonymise report schema. The header gains the anonymise paragraph (why service role, why `tenant-isolation-guard` is met: the target is resolved by email **and** must equal `p_subject`, G-2a) |
| `BusinessOsDataExportJobRepository` | `findDeletionFacts(userId)`: last owner `ready_at`, `owner_downloaded_at`, admin export existed. `.eq('user_id', userId)` |
| `/api/admin/test-account-cleanup/check` | Body `{ email, tag?, mode, subject? }` (`.strict()`; `tag` required when `mode = 'hard'`, `subject` uuid required when `mode = 'anonymise'`). On `/admin/users` the panel sends the drawer row's account id as `subject`, and G-2a proves in the DB that it is the login the email resolves to |
| `/api/admin/test-account-cleanup/delete` | Body `{ email, tag?, confirmEmail, mode, subject?, reason }` (same `tag` / `subject` rules). Order: `requireAdmin` → Zod → cleanup secret (503) → fingerprint key (503 `not_configured`) → export facts → `runCleanupDelete` / `runAccountAnonymise`. Refusals: existing refused row (hard), `ACCOUNT_DELETION_REFUSED` (anonymise), via `logAndFlush`, never the email or the note |
| `TestAccountCleanupPanel` | Required reason (radio, plus a note for "Other" with the hint "Do not write names, emails or client details here", C-9). New prop `lockedAccountId` next to `lockedEmail`. With both set, a mode choice: "Customer account: close and anonymise (keeps our billing)" (default) / "Test account: remove completely". The check result lists the blocking guards and, separately, the informational notes (for example "billing will be kept"). The unlocked `/test-business-os` mount stays hard-only |
| `emailTransport.sendEmail` | First statement: if any recipient's domain is `invalid` or ends in `.invalid` → `{ sent: false, provider: 'none', blocked: 'invalid_recipient' }`, logged with the count only |
| `lib/audit/events.ts`, `eventAudience.ts` | `ACCOUNT_PSEUDONYMISED`, `ACCOUNT_DELETION_REFUSED` (+ severity, flags, audience `bos`), and the event-count pin in `eventAudience.test.ts` |

Logging everywhere: `createLogger` + `correlationId`. Ids and counts only. Never the email, fingerprint, reason note, statement text or rpc arguments.

---

## 6. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | modify | Modes, signature, keep-set, blank list, auth closure, G-2a / G-20 (+ G-21 / G-22), receipt and audit inserts, constants `FUNCTION_MIGRATION = 20261081_operator_account_cleanup_anonymise`, `PREVIOUS_FUNCTION_MIGRATION = 20261077_…`, `PREVIOUS_FUNCTION_SIGNATURE`, `FUNCTION_REQUIRED_TABLES` + receipts, rollback that drops the 8-arg and restores the 6-arg |
| `supabase/migrations/20261080_business_os_deletion_receipts.sql` | create (hand-written) | §4 |
| `supabase/SQL Scripts/20261080_business_os_deletion_receipts_rollback.sql` | create | refuses with rows |
| `supabase/migrations/20261081_operator_account_cleanup_anonymise.sql` | create (generated) | the function |
| `supabase/SQL Scripts/20261081_operator_account_cleanup_anonymise_rollback.sql` | create (generated) | restores the 20261077 function and its 6-arg grants |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | regenerate | the hard plan is unchanged, but G-9 / guard rendering is now mode-aware. The bytes must come out the same or the diff is reviewed |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | regenerate | new stamp |
| `scripts/precheck-de10b-deletion-receipts.sql`, `scripts/check-de10b-deletion-receipts-migration.sql` | create | §8 |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | §7.2 |
| `supabase/migrations/__tests__/deletion-receipts.migration.test.ts` | create | §7.3 |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | §7.3 |
| `lib/business-os/purge/descriptors.ts`, `__tests__/classification-baseline.json` | modify | register `never(G)` |
| `lib/business-os/account-deletion/{receiptFingerprint,receiptInput,runAccountAnonymise,closedAccount,reason}.ts` + `__tests__/` | create | §5 |
| `lib/repositories/TestAccountCleanupRepository.ts` + test | modify | §5 |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` + test | modify | `findDeletionFacts` |
| `lib/business-os/test-account-cleanup/runCleanupDelete.ts`, `schemas.ts`, `cleanupApiTypes.ts` + tests | modify | receipt, mode, reason |
| `app/api/admin/test-account-cleanup/{check,delete}/route.ts` + `__tests__/route.test.ts` | modify | §5 |
| `components/business-os/purge/TestAccountCleanupPanel.tsx` + render tests | modify | reason, mode |
| `app/admin/users/components/BusinessDetail.tsx`, `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx` | modify | comment + pin for the mode choice (AU-1 comment no longer says "hard delete only") |
| `lib/notifications/emailTransport.ts` + test | modify | `.invalid` refusal |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | modify | two events |
| `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` | modify | anonymise mode, receipt, fingerprint key, apply order |
| `docs/feature_flags.md` | modify | `DELETION_RECEIPT_FINGERPRINT_KEY` row (env, not a flag, but listed where operators look) |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | modify | splice slice status (standing rule) |

---

## 7. Test plan

All inside the existing Jest gate (no new CI job, no added CI time).

### 7.1 Unit

- `receiptFingerprint`: same value for any case or outer spacing of one address. Different keys give different values. A key under 32 chars or a missing key throws `FingerprintKeyError`. The raw env value is not the HMAC key (compare with a direct HMAC). No `console.*`.
- `receiptInput`: the schema has no email-shaped key. `retain_until` comes from the constant. **Pin: `DELETION_RECEIPT_RETENTION` ≥ 1 year** (R-6). `other` needs a 5–500 char note.
- `reason`: Zod refuses an unknown category, a short or long note, and extra keys.
- `closedAccount`: matches the placeholder only (not `deleted-x@example.com`, not uppercase hex, not 11 hex).
- `emailTransport`: `x@deleted.invalid`, `x@invalid`, `X@Foo.INVALID` refused before any transport (mocks prove no provider call). A mixed list is refused whole. `x@invalid.com` still sends.

### 7.2 Generator pins (`testAccountCleanupSql.test.ts`, C2-7)

- Drift: the committed 20261081 migration, its rollback, both pasted files and the version module equal the generator output.
- **Hard path unchanged:** the pasted check / delete files and the `check` / `delete` branches still hold G-2 and the full plan, and the C3 G-9 row still blocks in hard mode.
- Keep-set: exactly the reviewed list. No keep-set table appears in the anonymise plan, and each has a reason. Every anonymise-plan table is a hard-plan table.
- Blank list: exactly the reviewed (table, column, target) triples. Each blank is behind a column-exists check, and the re-read after the blanks raises on a leftover value.
- G-2a present in the anonymise modes and absent from `check` / `delete`. G-2 absent from the anonymise modes. G-20 (+ G-21 / G-22 if SA approves) present. G-5 / G-7 / G-14 / G-15 / G-9 C3 rendered as `info` in the anonymise modes.
- Closure columns: the exact `auth.users` SET list. Token columns set to `''`, never NULL. The exact auth DELETE list. `auth.audit_log_entries` predicate.
- **Dropped old signature:** the migration holds `DROP FUNCTION IF EXISTS public.operator_test_account_cleanup(text, text, text, text, uuid, text)` before the CREATE, and the grants name the 8-arg signature. The rollback drops the 8-arg, recreates the 20261077 body byte for byte, and grants the 6-arg to service_role only.
- Entry rules: `delete` without `p_receipt` raises. `anonymise` without `p_subject` / `p_receipt` raises. `anonymise` without `p_actor` raises unless origin is owner.
- Audit row: `NULL` user / actor for owner origin, the admin for admin origin. The hard delete still writes the admin (20261047 pin kept).
- Order inside `anonymise`: every guard and G-3 before the first DELETE. Plan loop → blanks → auth closure → survivor scan → audit insert → receipt insert last.
- SQL-editor hygiene: the allowed `into` tokens are now exactly `INSERT INTO public.audit_trail (` and `INSERT INTO public.business_os_deletion_receipts (`, and the second appears only in the function migration, never in the pasted files.
- `FUNCTION_REQUIRED_TABLES` includes `business_os_deletion_receipts` → `20261080_business_os_deletion_receipts`. The order guard refuses without it.
- Applied-history pins: add the sha256 of `20261077_…` (applied) to the APPLIED list, and keep 20261075.

### 7.3 Guards

- **`deletion-receipts.migration.test.ts`:** the 20261080 SQL has no `REFERENCES`, no `user_id` / `owner_user_id` column, `ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`, the revoke-then-grant lines, and every post-condition. **Negative fixtures:** a copy with `REFERENCES auth.users` and a copy with a `user_id uuid` column both fail the same helper.
- **`no-deletion-paths`, family 4 extended (C2-6):** a new regex set `UPDATE\s+auth\.users`, `DELETE\s+FROM\s+auth\.(identities|sessions|refresh_tokens|mfa_\w+|one_time_tokens|oauth_\w+|webauthn_\w+|audit_log_entries)`. Allowed only in the generated 20261081 file. Negative fixtures for each shape (mixed case, extra spaces, newline). The "every allow-listed file still holds it" check runs per pattern. `PREVIOUS_MIGRATION_FILE` now resolves to 20261077, and 20261075 is added explicitly as history.
- **New family 5, importer allow-list (TQ-10):** `TestAccountCleanupRepository` may be imported only by `app/api/admin/test-account-cleanup/{check,delete}/route.ts`, `lib/business-os/test-account-cleanup/runCleanupDelete.ts`, `lib/business-os/account-deletion/runAccountAnonymise.ts`, the DE-10b.2 self route (added in that PR) and their tests. Negative fixture: an import line in a synthetic `app/api/foo/route.ts` string is detected.
- The R-7 guard (only the repository names the function) still passes.

### 7.4 Integration (routes)

- Check: 401 / 403 (requireAdmin first); 400 for an extra key, `mode` missing, or `tag` missing in hard mode; anonymise happy path returns blockers and notes separately; 503 on a missing secret.
- Delete, happy path: hard with reason → 200, receipt fields sent (fingerprint, `full_delete`, reason). Anonymise → 200 with `receipt_id` and ref.
- Delete, failures and **orderings** (each proves which calls did *not* happen):
  1. reason missing → 400, no repository call;
  2. fingerprint key missing → 503 `not_configured`, no check, no storage, no `remove` / `anonymise`;
  3. cleanup secret missing → 503 before the key is even read;
  4. version mismatch → 503, no storage;
  5. a blocking guard on the check → 409, no storage;
  6. only info notes (G-5, G-14, G-15, G-9 C3) → proceeds;
  7. storage fails → 500 `storage_failed`, no anonymise call;
  8. guard appears between storage and anonymise (P0001) → 409, message "Files removed, account kept", `ACCOUNT_DELETION_REFUSED` with `files_removed` (C2-11);
  9. RPC 42501 after storage → 503 with the files-removed sentence;
  10. `G-3` mismatch → 400 before the check.
- Audit rows: never the email, tag, note or fingerprint (deep scan of the `logAndFlush` mock argument). Logger mocks: the same scan.

### 7.5 Render (panel)

- No reason chosen → Delete disabled. "Other" with fewer than 5 chars → disabled, with the hint text. Locked mode shows the mode choice with "Customer account" as default. Unlocked mode shows no anonymise choice. Info notes render apart from blockers. The existing locked / unlocked pins keep passing.

### 7.6 Manual QA (prod, C2-5, after apply + deploy)

On a disposable, non-`+test` account created for the purpose, with a business, a client, a sent invoice, website consent rows and one test-mode boost:
1. Admin Check (anonymise) on `/admin/users`: G-9 C3 and G-14 show as notes, nothing blocks.
2. Admin delete with reason "Customer asked". Then:
   - the login email is the placeholder;
   - sign-in with the old password is refused, and the old email can sign up again;
   - business data and `profiles` are gone;
   - the kept rows have the same `user_id`, with the blank-list columns empty;
   - `auth.audit_log_entries` has no row for the subject;
   - the receipt row exists with no email in it;
   - the audit row has the admin's id.
3. **C2-8 (narrowed per F-5):** plan revenue, boost revenue, refunds and the credit ledger figures on the finance pages are the same before and after (screenshots of the four figures). Client takings are expected to drop. AI cost (NBQ-2) is unchanged.
4. **C2-9:** run `bos-billing-reconcile`, `credit-leak-check` and `finance-snapshot` by hand (`CRON_SECRET`). No crash, no email sent (the `.invalid` refusal in the log), no new row holding personal data.
5. The test-account hard delete on a `+test` account still works end to end (regression).
6. Admin Check on 3–5 real accounts (read-only): record which guards block. This also completes the "per-account admin Check not yet run" item in the TL SQL results.

---

## 8. PROD apply plan

Manual, by the user, in the Supabase SQL editor (prod `jgccgkyhpwirgknnceoh`), **after** the PR is approved and **before** merging (the build that ships pins the new stamp). The scripts hold no "into" outside the allowed `INSERT INTO` keywords.

| Step | What | Pass condition |
|---|---|---|
| 0 | User sets `DELETION_RECEIPT_FINGERPRINT_KEY` in Vercel Production + Preview (§9) | done before step 5 |
| 1 | `scripts/precheck-de10b-deletion-receipts.sql` (read-only) | every row `ok`: the 6-arg function exists and its body holds the **20261077** stamp; no 8-arg function yet; `business_os_deletion_receipts` absent; anon / authenticated cannot CREATE in `public`; every G-20 `auth` column exists; `postgres` holds UPDATE on `auth.users` and DELETE on each closure table and `auth.audit_log_entries` (SQL-W4) |
| 2 | Apply `20261080_business_os_deletion_receipts.sql` | applies with no exception (its post-conditions are self-verifying) |
| 3 | Apply `20261081_operator_account_cleanup_anonymise.sql` | its order guard passes (needs 20261041 + required tables incl. receipts) |
| 4 | `scripts/check-de10b-deletion-receipts-migration.sql` (read-only) | the table shape and grants as §4; the 8-arg function exists and the 6-arg is gone; EXECUTE is service_role only; SECURITY DEFINER; `search_path`; the body holds the new stamp |
| 5 | Merge → Vercel deploy | the admin Check on `/admin/users` answers (no `function_out_of_date`) |
| 6 | Probe: the admin **Check** in both modes on one `+test` account and one real account (read-only, `transaction_read_only`) | the verdict renders; no write possible |
| 7 | The §7.6 disposable-account run | as listed |

Between steps 3 and 5 the admin cleanup answers 503 `function_out_of_date` (R-6, accepted). Keep the window short.

**Rollback:**
1. Run `supabase/SQL Scripts/20261081_…_rollback.sql`. It drops the 8-arg function, restores the 20261077 function byte for byte with its 6-arg grants, and reloads PostgREST.
2. Redeploy the previous build (it pins the 20261077 stamp).
3. Leave 20261080 in place. Its rollback refuses once any receipt exists, and an empty table is harmless.

Tombstones already made are **not** reversed by a rollback. Nothing can restore them, and that is by design (UD-6).

---

## 9. User steps

1. **Before deploy:** create a random secret of at least 32 characters (for example `openssl rand -base64 48`) and set `DELETION_RECEIPT_FINGERPRINT_KEY` in Vercel **Production and Preview**. Store a copy in the password manager: losing it makes old receipts unsearchable (release 3). Never commit it. Until it is set, every admin delete answers "not configured" (fails closed, C2-5).
2. Run §8 steps 1–4 by hand, and paste the outputs back to TL.
3. Approve the merge (manual gate, no auto-merge).
4. QA runs §7.6 on prod with a disposable account. The user may need to create that login (invite flow).

---

## 10. Schema check: read-only SQL for TL

`business-os-schema-check` (C2-3). Dev cannot run SQL. TL runs these on prod in the SQL editor and pastes the output into §SA Review Notes **before implementation starts**. No statement writes. None uses the word "into".

**SQL-W1: nullability and defaults of every blanked column** (decides NULL vs `''` vs `'{}'`)

```sql
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns AS c
WHERE c.table_schema = 'public'
  AND (c.table_name, c.column_name) IN (
    ('business_os_billing_accounts','action_required_invoice_url'), ('business_os_billing_accounts','open_checkout_session_id'),
    ('business_os_boost_purchases','receipt_url'), ('business_os_credit_lots','reason'),
    ('user_subscriptions','payment_method_last4'), ('user_subscriptions','payment_method_brand'), ('user_subscriptions','last_calculator_inputs'),
    ('credit_transactions','description'), ('credit_transactions','metadata'),
    ('billing_events','payload'), ('billing_events','error_message'),
    ('token_usage','error_message'), ('token_usage','metadata'), ('token_usage','request_payload'), ('token_usage','response_metadata'))
ORDER BY 1, 2;
```

**SQL-W2: full `auth` column list and nullability** (the closure SET list, G-20)

```sql
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns AS c
WHERE c.table_schema = 'auth'
  AND c.table_name IN ('users','identities','sessions','refresh_tokens','mfa_factors','mfa_challenges','mfa_amr_claims',
    'mfa_recovery_code_sets','one_time_tokens','oauth_authorizations','oauth_consents','scim_users','audit_log_entries','flow_state')
   OR (c.table_schema = 'auth' AND c.table_name LIKE 'webauthn%')
ORDER BY 1, c.ordinal_position;
```

**SQL-W3: which payload keys name a user in the auth log** (the delete predicate)

```sql
SELECT k.key, count(*) AS rows_with_key
FROM auth.audit_log_entries AS a
CROSS JOIN LATERAL jsonb_object_keys(a.payload) AS k(key)
GROUP BY k.key ORDER BY 2 DESC;

SELECT t.key, count(*) AS rows_with_key
FROM auth.audit_log_entries AS a
CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(a.payload -> 'traits') = 'object' THEN a.payload -> 'traits' ELSE '{}'::jsonb END) AS t(key)
GROUP BY t.key ORDER BY 2 DESC;
```

**SQL-W4: what the function owner may do in `auth`** (precheck rows)

```sql
SELECT t.tbl, p.priv, pg_catalog.has_table_privilege('postgres', t.tbl, p.priv) AS allowed
FROM (VALUES ('auth.users'), ('auth.identities'), ('auth.sessions'), ('auth.refresh_tokens'), ('auth.mfa_factors'),
             ('auth.mfa_recovery_code_sets'), ('auth.one_time_tokens'), ('auth.oauth_authorizations'), ('auth.oauth_consents'),
             ('auth.audit_log_entries')) AS t(tbl)
CROSS JOIN (VALUES ('UPDATE'), ('DELETE')) AS p(priv)
WHERE pg_catalog.to_regclass(t.tbl) IS NOT NULL
ORDER BY 1, 2;
```

**SQL-W5: UPDATE triggers on `auth.users` and on the blanked tables** (G-21)

```sql
SELECT nsp.nspname || '.' || rel.relname AS tbl, trg.tgname, pg_catalog.pg_get_triggerdef(trg.oid) AS def
FROM pg_catalog.pg_trigger AS trg
JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
  AND ((nsp.nspname = 'auth' AND rel.relname = 'users')
    OR (nsp.nspname = 'public' AND rel.relname IN ('business_os_billing_accounts','business_os_boost_purchases','business_os_credit_lots',
        'user_subscriptions','credit_transactions','billing_events','token_usage')))
ORDER BY 1, 2;
```

**SQL-W6: FKs from keep-set tables to any non-auth table** (G-22, whether a plan delete could cascade into kept rows)

```sql
SELECT child.relname AS kept_table, att.attname AS kept_column, att.attnotnull AS not_null,
       pnsp.nspname || '.' || parent.relname AS parent_table, con.confdeltype AS on_delete, con.conname
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS child ON child.oid = con.conrelid
JOIN pg_catalog.pg_class AS parent ON parent.oid = con.confrelid
JOIN pg_catalog.pg_namespace AS pnsp ON pnsp.oid = parent.relnamespace
JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
WHERE con.contype = 'f' AND pnsp.nspname <> 'auth'
  AND child.relname IN ('business_os_billing_accounts','business_os_billing_events','business_os_boost_purchases',
    'business_os_boost_reversal_events','business_os_credit_charges','business_os_credit_lots','business_os_credit_lot_draws',
    'business_os_credit_totals','credit_transactions','user_subscriptions','billing_events','processed_webhook_events','token_usage',
    'marketing_consent_events','marketing_consent_state','business_os_account_lineage','boost_pack_purchases','user_rewards','subscription_invoices')
ORDER BY 1, 2;
```

**SQL-W7: invites the account issued that others redeemed** (O-4: does deleting issued invites hit G-18 for accounts below it?)

```sql
SELECT c.column_name, c.data_type FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.table_name IN ('business_os_invites','business_os_account_lineage')
ORDER BY c.table_name, c.ordinal_position;
```

---

## 11. Task list

- [x] 1. Merge `origin/main` into `feature/data-export-de10b` (fast-forward). Re-run `git ls-tree origin/main supabase/migrations` and the all-branch / all-worktree scan: 80 and 81 still free. Re-confirm `PREVIOUS_FUNCTION_MIGRATION` on `origin/main` is 20261077 ✅ (W-1 record below)
- [x] 2. TL runs SQL-W1 … SQL-W7. Results pasted into SA Review Notes. Blank targets, closure columns, the auth-log predicate, G-21 / G-22 reviewed lists fixed from them ✅ (TL sections at the end, plus W-2)
- [x] 3. SA rules the open items in §13 (O-1 … O-10) ✅ (SA Workplan Review 2026-10-18)
- [x] 4. Write `20261080` + its rollback + `deletion-receipts.migration.test.ts` (with the negative fixtures)
- [x] 5. Register `business_os_deletion_receipts` in `descriptors.ts` (`never`, G, PLATFORM) + the classification baseline; descriptor / export-classification tests green
- [x] 6. Generator: constants (migration names, signatures, required tables), keep-set and blank-list data with reasons, `buildCleanupPlan(mode)`
- [x] 7. Generator: mode-aware `sharedCtes` / `guardRowsCte` (G-2a, info rows, G-9 C3 info, G-20, plus G-21 / G-22 per SA)
- [x] 8. Generator: `buildAnonymiseBlock` (guards, plan loop, blanks + re-read, auth closure, audit-log delete, survivor scan, audit row, receipt insert, direct report)
- [x] 9. Generator: receipt insert after the hard `delete` in the function only; entry rules; the 8-arg `renderFunctionSql`, `DROP FUNCTION` of the 6-arg; the rollback restoring the 6-arg
- [x] 10. Run the generator. Review the diff of the pasted files (expected: unchanged hard plan). Commit-ready output for 20261081, its rollback and the version module
- [x] 11. Generator test pins (§7.2), incl. the APPLIED sha256 of 20261077
- [x] 12. `no-deletion-paths`: family 4 extension + family 5 importer allow-list, each with negative fixtures
- [x] 13. `receiptFingerprint.ts`, `receiptInput.ts`, `reason.ts`, `closedAccount.ts` + unit tests (incl. the retention ≥ 1 year pin)
- [x] 14. `TestAccountCleanupRepository`: `anonymiseCheck`, `anonymise`, `remove(…, receipt)`, `info` parsing, anonymise report schema, header text + tests
- [x] 15. `BusinessOsDataExportJobRepository.findDeletionFacts` + test
- [x] 16. `runAccountAnonymise.ts` + `runCleanupDelete` receipt input + tests (every ordering in §7.4)
- [x] 17. Admin check / delete routes + schemas + wire types + route tests (§7.4)
- [x] 18. Audit events `ACCOUNT_PSEUDONYMISED`, `ACCOUNT_DELETION_REFUSED` + audience + count pin
- [x] 19. `emailTransport` `.invalid` refusal + test
- [x] 20. `TestAccountCleanupPanel`: reason, mode choice (locked only), notes vs blockers + render tests; `BusinessDetail` comment + pin
- [x] 21. Precheck + checker SQL scripts (§8), free of the word "into" outside `INSERT INTO`
- [x] 22. Runbook + `feature_flags.md` + requirement status splice
- [x] 23. `npx tsc --noEmit` on touched files, `npm run lint`, `npm test` for the touched suites + the full guard suites (`no-deletion-paths`, `admin-authz-surface`, descriptor and export classification). `git diff --stat` reviewed: no file emptied
- [ ] 24. Hand to SA for code review (changes left uncommitted)

**24 tasks.**

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A NULL in a GoTrue token column breaks `auth.admin.listUsers()` for **every** user, and the `/admin/users` list with it | Set the token columns to `''` (O-6). §7.6 opens `/admin/users` after the run |
| K-2 | `banned_until = 'infinity'` may not decode in GoTrue (Go `time.Time`) | O-5: a far-future date. §7.6 tries a sign-in |
| K-3 | `postgres` may lack DML on some `auth` tables after Supabase's auth-schema changes | SQL-W4 + precheck row. G-20 also checks the privilege at run time and refuses |
| K-4 | A plan delete cascades into a **kept** row (for example `token_usage` → agents) and silently breaks NBQ-2 or finance totals | SQL-W6 + G-22 (O-2) + the C2-8 comparison |
| K-5 | Blanking fires an UPDATE trigger that refuses the change (append-only guards) or rewrites data | SQL-W5 + G-21 (O-1) |
| K-6 | Issued invites redeemed by others: deleting them trips G-18, or they keep invitee emails | SQL-W7 + O-4 |
| K-7 | Storage removed, then a guard appears → files gone, account kept (C2-11) | Accepted. The route says so, `ACCOUNT_DELETION_REFUSED` records `files_removed` |
| K-8 | The 15-minute report window of the hard path picks up an anonymise audit row | Different action. The anonymise report is built in-block, not searched |
| K-9 | A self-service owner JWT keeps reading kept rows for ≤ 1 h (SQL-5) | Accepted in TQ-19. Only kept billing rows, none personal after the blanks |
| K-10 | The fingerprint key is lost or rotated without versioning | Version column + runbook. Lookup (release 3) handles old versions |
| K-11 | Branch 44 commits behind `main`. A merge conflict in the generator with a parallel cleanup change | Task 1. The generator's "second branch rebases its numbers" rule. Re-check at PR |
| K-12 | The function body grows. The statement timeout during an anonymise of a large account (24k `token_usage` metadata rows platform-wide) | `lock_timeout 5s` stays. QA measures `server_ms`. The route's `maxDuration = 60` |

---

## 13. Open items for SA

| # | Question | Dev default |
|---|---|---|
| O-1 | Add **G-21** (UPDATE triggers on `auth.users` and blanked tables must be reviewed)? | yes |
| O-2 | Add **G-22** (no FK from a keep-set table into a plan table that would cascade into or NULL a kept row)? | yes |
| O-3 | Keep-set additions: `business_os_credit_lot_draws` (credit ledger), `boost_pack_purchases`, `user_rewards`, `subscription_invoices` (legacy billing)? | yes to all four |
| O-4 | Issued `business_os_invites`: delete the unredeemed ones, keep the redeemed ones with the invitee email blanked? (SQL-W7) | yes |
| O-5 | `banned_until`: `now() + interval '100 years'` instead of `'infinity'` (§D)? | 100 years |
| O-6 | GoTrue token columns `''`, not NULL (deviation in the letter of §D "cleared")? | `''` |
| O-7 | Closure deletes the **full** SQL-4 cascade list (adds `mfa_recovery_code_sets`, `oauth_*`, `webauthn_*`, `mfa_amr_claims`) beyond §D's five tables? Also set `auth.users.deleted_at`? | yes to the list; `deleted_at` no, until shown harmless to GoTrue |
| O-8 | Event names: in-function `ACCOUNT_PSEUDONYMISED` for both origins (source in `details`), route-level `ACCOUNT_DELETION_REFUSED`? | yes |
| O-9 | No receipt repository until release 3 (nothing in TS reads it)? | yes |
| O-10 | Admin path mode choice: "Customer account" (anonymise, default) vs "Test account" (hard), only on `/admin/users`. `/test-business-os` stays hard-only? Should the reason category also restrict the mode ("Test account" reason ⇒ hard)? | yes; no coupling |
| O-11 | `.invalid` refusal and C2-9 cron QA moved from DE-10b.2 into this slice (D-7)? | yes |
| O-12 | `admin_export_downloaded`: drop from release 1 (it lives in audit rows only, and those are deleted with the account)? | drop; `admin_export_existed` kept |

---

## 14. Estimate

| Part | Days |
|---|---|
| Generator modes, keep-set, blanks, closure, guards, receipt / audit inserts, rollback | 1.75 |
| 20261080 + migration guard test + descriptors | 0.5 |
| Repository, runner, fingerprint, routes, events | 0.75 |
| Panel reason / mode + render tests | 0.5 |
| Generator pins, deletion-path guards, emailTransport, precheck / checker SQL, runbook | 0.75 |
| **Total** | **🔴 ~4.25 d** (SA §F: ~4 d. +0.25 d for G-20 … G-22 and the full auth closure) |

Not included: TL's SQL run, SA reviews, and the user's apply and QA windows.

---

## SA Review Notes

*(SA to populate. TL pastes the SQL-W1 … W7 outputs here before task 4.)*

### Dev W-1 record — 2026-10-18 (before task 4)

- `git fetch origin`: `origin/main` = `399070d4` (unchanged since the SA review). The branch `feature/data-export-de10b` sits on it (fast-forward done; no rebase, no stash).
- `git ls-tree origin/main supabase/migrations`: the highest number is `20261079_ai_price_apply_and_dismiss`. Nothing at `2026108*`.
- `git log --all -- 'supabase/migrations/2026108*'`: empty (every local and remote branch, incl. `gh-readonly-queue/*`).
- Every worktree folder under `AgentsPilot/` (33 folders, untracked files included): no `supabase/migrations/2026108*` file.
- `PREVIOUS_FUNCTION_MIGRATION` on `origin/main` is `20261075_…` with `FUNCTION_MIGRATION = 20261077_…`, so this slice moves PREVIOUS to `20261077_operator_test_account_cleanup_boost_reversal_events` as planned.
- **20261080 and 20261081 are free.** To be repeated at PR time (C2-4).

### Dev implementation notes — 2026-10-18 (for SA code review)

**W-10, hard path proof.** After `npx tsx scripts/generate-test-account-cleanup-sql.ts`, `git status` shows **no change** to `scripts/test-account-cleanup-check.sql` or `scripts/test-account-cleanup-delete.sql`: the pasted files are byte-identical (the hard renderers take a `mode` argument that defaults to `'hard'` and renders exactly the 20261077 text; pinned by the drift test and the new "hard path is unchanged" pins). The hard `check` / `delete` branches of the function are the same builders.

**Version stamp.** `CLEANUP_FUNCTION_VERSION = d72232d8fcc75e5e` (was `b78b4579fc6631f8` for 20261077). The checker pins the new one, the pre-check the old one.

**Decisions taken inside the conditions, flagged for SA:**

| # | What | Why |
|---|---|---|
| I-1 | **G-22 has a reviewed allow-list of two links**: `marketing_consent_events_contact_id_fkey` and `marketing_consent_state_contact_id_fkey` (to `crm_contacts`, SET NULL, nullable). Any other kept-to-plan link blocks, and so does an allow-listed one that turns CASCADE / NO ACTION, NOT NULL or multi-column | SA O-2 said "W6 shows zero today", but TL's W6 itself lists these two edges. Without the allow-list G-22 would block every anonymise. `crm_contacts` is in the anonymise plan, and `trg_mce_guard` (20260930) lets exactly the `contact_id` SET NULL through (read). NBQ-3 keeps the consent rows |
| I-2 | **20261081 and its rollback are each one transaction** (`BEGIN` / `COMMIT`) | The file now holds `DROP FUNCTION` before `CREATE`: outside a transaction a failed CREATE would leave no function at all. Earlier versions had no DROP, so they did not need it |
| I-3 | The order guard of 20261081 accepts **either** the 6- or the 8-argument function as proof that 20261041 is applied | A re-run after apply would otherwise say "apply 20261041 first", which is false |
| I-4 | **The hard delete's receipt totals come from its own audit row** (`entity_id` = the login the email resolved to before the block, `created_at = now()`), and the function raises if that row is missing | The hard block is shared byte-for-byte with the pasted file, so it cannot set variables of the function around it (W-10). `now()` is the transaction time and the entity is a login deleted once, so the match is this run only |
| I-5 | The anonymise block is a nested block of the function that sets the function's own variables (receipt mode, reference, totals, report). It exists only in the function, never in a pasted file (pinned) | Keeps the receipt insert in one place, after both branches |
| I-6 | **The receipt is prepared after the check, before the storage step** (`PrepareReceipt` callback in both runners): export facts (`findDeletionFacts`) + fingerprint + Zod. A failure answers 500 `receipt_failed` with nothing removed. New wire code `receipt_failed` (pinned both ways, panel sentence added) | The export facts need the resolved login id (the hard mode has no subject until the check). Before storage so a failure costs nothing |
| I-7 | Closure deletes are dynamic (`DELETE FROM auth.%I`) over the reviewed list, skipped when a table is absent. G-20 refuses a present closure table that lacks its key column. `scim_users` (must be empty) is counted through its own foreign key to `auth.users`, so its column name is not guessed | SQL-W2 confirmed `flow_state.user_id`, `identities`, `sessions`, `refresh_tokens`, `mfa_factors`, `one_time_tokens`; the key columns of `mfa_recovery_code_sets`, `oauth_*` and `webauthn_*` are assumed `user_id`. **Pre-check rows 8, 9, 10 and 11 show the real list on prod**: a mismatch is a FAIL row there, never a silent miss |
| I-8 | G-11 also covers every blank column and the jsonb type of the `{}` / key-strip targets (`credit_transactions.metadata`, `billing_events.payload`, `token_usage.metadata`, `subscription_invoices.metadata`, `user_rewards.metadata`). **If `token_usage.metadata` is `json` rather than `jsonb` on prod, G-11 blocks every anonymise**: pre-check row 13 shows it | `metadata - 'key'` and `?|` need jsonb. Fail closed rather than a raw 42883 mid-run |
| I-9 | The 20261077 sha256 pins are added as `PENDING_PREVIOUS` beside `APPLIED`, not in it | W-3: "do not write the APPLIED sha until the pre-check has passed on prod". The bytes are pinned now (they equal `origin/main`); move the two lines into `APPLIED` after pre-check row 1 says ok |
| I-10 | Hard mode on the unlocked `/test-business-os` mount and on the "Test account" choice sends `reason: { category: 'test_account' }` without a click (the picker shows it locked) | O-10: the hard mode takes only that reason |
| I-11 | `ACCOUNT_PSEUDONYMISED` is `critical`, flags GDPR + SOC2; `ACCOUNT_DELETION_REFUSED` is `warning`, GDPR + SOC2. Both audience `bos` (count pin 58 to 60) | An irreversible erasure of a real account; same flags as `DATA_ANONYMIZED` |
| I-12 | The hard check's kept-invite note (W-12) is corrected in the runbook (section 7.4), not in the generator | Changing `KEPT_RESIDUE[0]` would change the pasted check file bytes (W-10) |
| I-13 | `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` L8 allow-list gains the 20261077 pair | It listed the generator's current files by constant, and 20261077 stopped being "current" |
| I-14 | The checker's row 9 avoids the words of the function attribute in its label | The SECDEF surface guard's O-1 tripwire flags those words in any string of a `.sql` file outside the three migration directories |

**What the code does NOT do (unchanged scope):** no receipt read repository (O-9), no stale sweep (R-2), no customer route (DE-10b.2), no "Deleted account {ref}" label on finance pages (DE-10b.2).

**Test results (Dev, 2026-10-18):** see the Dev section of the QA report below.

## QA Testing Report

*(QA to populate.)*

### Dev self-test — 2026-10-18 (not the QA report)

| Run | Result |
|---|---|
| `npx jest` over the touched and guard suites (generator, purge incl. no-deletion-paths and descriptors, data-export, account-deletion, test-account-cleanup, repositories, lib/server R-7, lib/admin incl. admin-authz-surface, supabase incl. SECDEF surface and every migration test, lib/audit, lib/notifications, app/api/admin, app/admin/users, components/business-os/purge, entitlements) | 398 suites, **11,719 passed, 1 failed**. The failure is `lib/__tests__/supabaseFetch.test.ts` ("more generous in development"), unrelated: it fails the same way on the main checkout |
| `npm run test:bos-entitlements` | 295 suites, 8,929 passed |
| `npm run typecheck:bos-llm` (scoped TS gate, includes the wire-type pins) | passed, 0 new errors |
| `npx tsc --noEmit -p .` (whole repo, 12 GB heap) | 1,851 errors repo-wide, **none in a file this slice adds**; the one hit in a touched file (`exportClassification.test.ts:2021`) is pre-existing on `origin/main` |
| ESLint, `eslint.hooks.config.mjs` (rules-of-hooks) on the touched sources | clean |
| ESLint default config on the touched sources | 0 errors, 4 pre-existing warnings |
| `console.*` in touched files | 0 calls |
| `git diff --numstat` | no file emptied, no whole-file rewrite |

## Commit Info

*(RM to populate. Manual gate: no auto-merge.)*

---

## QA Report — 2026-10-18 (pre-apply)

**QA — 2026-10-18**
**Test mode:** full, the pre-apply round. The prod-only checks are listed at the end as the second round.
**Strategy used:** A + B (Jest: the full suite, plus the touched and guard suites again with one new QA test file). C (the real 20261080 / 20261081 files and both rollbacks, run on a **local PGlite replica**: PGlite 0.5.8 / PostgreSQL 18.3 WASM, in the session scratchpad. Nothing ran against prod or any Supabase project). D (browser) is skipped in this round. There is no build with the migrations applied yet, so the browser check moves to the post-apply round.
**Focus:** all (api, schema, security, the cleanup function)
**Skipped:** anything that needs prod (precheck and checker rows on prod, the 503 window, the disposable real-account run, finance figures, crons, Vercel logs). These are deferred to the post-apply round below.
**Input source:** prompt keywords (TL brief) + SA Code Review "What QA must exercise" + §7.6

### Verdict

**✅ PASS for the pre-apply round. No High or Medium bug.** 3 low edge cases, 2 information notes. The slice can go to the user's diff review and the §8 apply. It is **not yet ready to merge**: CR-1 and the post-apply round below are still owed.

### Test Coverage

| # | Item (SA list / brief) | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | Full Jest gate (`npm test`) | ✅ | Pass with notes | 1,575 suites: **1,547 passed, 20 failed, 8 skipped**. Tests: **39,773 passed, 140 failed, 65 skipped (39,978)**. None of the 20 failing suites is a file this slice touches, and none reads one. The 20 are: **10 quarantined** suites (`.github/ci/jest-quarantine.json`, excluded from the CI gate: v4/v6, pilot, orchestration). **`lib/__tests__/supabaseFetch.test.ts`**, which is also red on the main checkout (`neuronforge`, run alone: FAIL). **8 Windows-checkout failures**: this worktree has `core.autocrlf=true` (`git ls-files --eol` shows `i/lf w/crlf`), so source scans that look for `\n` miss `\r\n`, and one guard lists Windows paths. Those 8 are `bookingsSearchAndPaging`, `jobOverAfterHeldMeeting` and `noIntakeToSendOnADeadJob` (contact-drawer guards), `openaiPricingAdapter` (its fixture is CRLF on disk), `servicesAreDraftsWithWords`, `theChainHoldsEndToEnd`, `publicEndpointsAreThrottled` and `oneAddressPolicy`. Three of the 8 also fail on the main checkout (`bookingsSearchAndPaging`, `publicEndpointsAreThrottled`, `oneAddressPolicy`). The other 5 do not exist at the main checkout's older commit `e49a4719`. **By the letter of the brief, supabaseFetch is not the only red suite**, but every other red one is the quarantine or the Windows checkout, and the slice cannot affect them. CI (Linux, LF) runs `test:gate` and does not see them |
| 1b | Touched and guard suites again, with the new QA file | ✅ | Pass | 10 suites, **497 / 497** (route tests, the new QA file, `no-deletion-paths`, `admin-authz-surface`, account-deletion units, generator pins, `deletion-receipts.migration`). No entitlements import in the diff, so `test:bos-entitlements` is not required. Dev ran it anyway (8,929 passed) |
| 2 | Precheck (§8 step 1) on a 20261077 database | ✅ (replica) | Pass | All **14 rows `ok`**. Row 9 lists the 13 closure tables. After the apply, rows 1–3 turn FAIL, as designed |
| 2b | Checker (§8 step 4) after 80 + 81 | ✅ (replica) | Pass | All **11 rows `ok`**: no FK, no `user_id`, RLS on with no policy, browser roles hold nothing, service_role holds SELECT + INSERT only, the 8-arg function present and the 6-arg gone, SECURITY DEFINER + `search_path`, EXECUTE service_role only, stamp `d72232d8fcc75e5e` |
| 2c | Apply order and one-transaction files | ✅ (replica) | Pass | 81 before 80 refuses ("Apply 20261080 … first") and the 6-arg function survives. A second 80 apply refuses. 81 applies twice in a row cleanly. 81 re-applies after its own rollback (I-3) |
| 3 | Old build against the new function (R-6 window) | ✅ (replica + Jest) | Pass | A 6-named-argument call resolves to the 8-arg function and reads stamp `d72232d8…`, not `b78b4579…`. So the deployed old build answers `function_out_of_date`. Route tests: 503 with no facts, no storage, no delete or anonymise, in both modes |
| 4 | Fingerprint key missing → 503 `not_configured`, nothing removed | ✅ (Jest) | Pass | Both modes, plus a key under 32 chars (new QA case): 503, zero rpc or storage calls, refusal audited without PII. A missing cleanup secret answers 503 before the key is read |
| 5 | anonymise_check: blockers and notes apart, read-only | ✅ (replica + Jest) | Pass | Seeded account: verdict OK, **0 blockers**, notes G-7, G-9 C3, G-14, G-15. Paid account: G-5 is a note too. After the call `transaction_read_only = on`, and a write in the same transaction fails with 25006. Snapshot of every table unchanged. G-2a blocks when the email and the subject differ. The tag (G-2) is not read in the anonymise modes. In the **hard** check, G-9 C3, G-7, G-14 and G-15 still **block**, so the hard path is unchanged |
| 6a | Anonymise closes the login | ✅ (replica) | Pass | Placeholder `deleted-{ref}@deleted.invalid`, where ref is the first 12 hex of the receipt id. Phone NULL, password `''`, the 8 token columns `''` and **never NULL** (K-1), user metadata `{}`, app metadata `{provider:email, providers:[email], deleted:true}`, `banned_until` = now + 100.00 years. No login holds the old email any more, so it can sign up again. A second check on the old email blocks on G-1 |
| 6b | Auth rows deleted | ✅ (replica) | Pass | Zero rows for the subject in identities, sessions, `refresh_tokens` (text `user_id`), `mfa_amr_claims` (through sessions), `mfa_factors`, `mfa_challenges` (through factors), `mfa_recovery_code_sets`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`, `webauthn_*`, **`flow_state`**. `auth.audit_log_entries`: exactly the 4 seeded subject rows went, found by actor id, by `traits.user_id`, by `actor_username` only (UPPER case) and by `traits.user_email` only (mixed case). The `payload` column is `json`, as on prod. Rows of other users and unrelated rows stayed |
| 6c | Keep-set and blanks | ✅ (replica) | Pass | Every keep-set row is still there under the same `user_id` (counts equal before and after). No other table holds the subject. All 24 blanks applied: `token_usage` (3 columns NULL, 4 metadata keys stripped, an unrelated key kept), `credit_transactions` (description NULL, `agent_name` stripped), `user_subscriptions`, `billing_events` (payload `{}`), billing account, boost `receipt_url`, credit lot and draw reasons, `subscription_invoices`, `user_rewards`. The allow-listed `updated_at` triggers fired, and G-21 let them through |
| 6d | Consent rows (NBQ-3) | ✅ (replica) | Pass | The **real** `marketing_consent_events_guard()` from 20260930 was installed. The consent event and state rows are kept with `contact_id` NULL after the contact delete, and the append-only guard let exactly that through |
| 6e | Invites (O-4) | ✅ (replica) | Pass | Every invite the subject issued was deleted, the unredeemed one and the one another account redeemed. The invite the subject redeemed was kept with the placeholder email and NULL `personal_note`, `email_problem_detail` and `redemption_error_message`. The issuer's columns (`inviter_display_name`, `inviter_reply_to`, `internal_reason`, `issuer_account_id`) are intact. Lineage rows are kept |
| 6f | Receipt | ✅ (replica) | Pass | Exactly one row, status `completed`. The id and ref match the report and the placeholder. No part of the email appears in it. It holds the admin id and email, `customer_asked`, origin and executor `admin`, and totals equal to the report (rows, blanked, `files_removed` = 3 as sent, tables). The note is stored for "Other" |
| 6g | Audit row | ✅ (replica) | Pass | `ACCOUNT_PSEUDONYMISED`, `user_id = actor_id =` the admin, entity = the subject, details hold the receipt id and source `admin_page`, with no email and no reason. Owner origin (the DE-10b.2 path): `user_id = actor_id = NULL`, source `self_service`, receipt mode `anonymised`. The subject's own audit rows went with the account |
| 6h | Other accounts untouched | ✅ (replica) | Pass | Every row of another customer, of a `+test` account and of the admin is byte-identical before and after, by md5 per table over `user_id` rows plus `auth.users`. The admin's only change is its new audit row |
| 7 | Failure orderings roll back everything | ✅ (replica + Jest) | Pass | On the replica, each of these changed **0 tables** (md5 snapshot of every table in public, auth, storage and operator_private): G-8, G-6, G-9 C1, G-12, G-20 (an unreviewed auth table with `user_id`, an unreviewed FK into `auth.users`), G-21 (an unreviewed UPDATE trigger on `auth.users`), G-22 (a kept → plan FK, CASCADE), a blank re-read finding a value left, the survivor scan finding a re-created closure row, and the **receipt insert refused by its table** (bad fingerprint, `retain_until` under one year, "other" with a 4-character note, admin without a reason). That last group proves "receipt last, all or nothing" (R-2). G-3 mismatch, all 11 entry-rule refusals (22023 / 42501) and anon / authenticated EXECUTE (42501) also changed nothing. Route level: G-3 mismatch, "Other" with a 4-character note, hard mode + `customer_asked`, an origin in the body, a tag in anonymise mode → all 400, with no repository call |
| 8 | Hard path regression on a `+test` account | ✅ (replica) | Pass | The `+test` login and all its rows are gone. The audit row is unchanged from 20261047 (`user_id = actor_id =` admin). The receipt has mode `full_delete`, NULL ref and `test_account`, and `rows_removed` (126) equals the hard audit row's `rows` (I-4). The pasted `scripts/test-account-cleanup-{check,delete}.sql` are unchanged in `git status` |
| 9 | Rollbacks | ✅ (replica) | Pass | The 80 rollback refuses while 81 is live. The 81 rollback leaves the 6-arg function present and the 8-arg gone. The 20261077 stamp is back. The body is **byte-identical** to 20261077 (`prosrc` = the file's body, 144,168 chars). Grants: `postgres` + `service_role` only. The 80 rollback refuses with receipts present. On a fresh database it drops the empty table, and a second run refuses cleanly |
| 10 | No PII in logs, refused audit rows or bodies | ✅ (Jest) | Pass | New QA file `route.piiEveryRefusal.test.ts` (**21 tests**) walks **every** delete path in anonymise mode (happy path, G-3, secret missing, key missing, key too short, version mismatch, check blocked, check DB error, facts fail, storage fail, guard after storage, 42501 after storage, integrity raise, DB error, unexpected throw), the hard refusals that carry a reason, and the anonymise check. It deep-scans every log argument, every refused-audit entry and every response body for the email (and a typo of it), the note, the tag, the fingerprint, the secret and the key. All clean |
| — | `.invalid` refusal (`emailTransport`) | ✅ (Jest, review) | Pass | Covered by Dev's test (cases, mixed list, before the consent gate, count-only log, `x@invalid.com` still sends). See E-2 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found. The anonymise on the seeded replica account (≈114 rows, 24 blanks, 4 auth-log rows) took `server_ms` 331–426. A replica timing is not a prod figure, so K-12 is measured on prod (post-apply step P-6).

#### Edge Cases (nice to fix)
1. **E-1: a raw database error message is logged** (`err.message` in the `account cleanup failed` / `check failed` log lines, both modes) — File: `app/api/admin/test-account-cleanup/delete/route.ts`, `check/route.ts` (via the runners) — Severity: Low
   - QA's first draft of the new test injected a database error whose message held the email. It reached the log. No message the function or PostgREST raises holds the email today: the function's RAISE texts name guards and tables only, and constraint values travel in DETAIL, which is not logged. The hard path has had the same pattern since 20261041. The test now injects realistic messages and documents this in its header. Suggest: log `code` plus a fixed text, or redact anything shaped like an address, in a later slice.
2. **E-2: `isInvalidDomainRecipient` does not parse a display-name address** (`Dana <deleted-x@deleted.invalid>` reads the domain as `deleted.invalid>`) — File: `lib/notifications/emailTransport.ts` — Severity: Low
   - No caller passes that form today: `to` is `string[]` of bare addresses, and a grep finds no `Name <…>` builder. Suggest: strip a trailing `>` and spaces, or pin the bare-address contract with a test.
3. **E-3 (known, SA comment 4): the hard path still leaves the `+test` account's `auth.audit_log_entries` rows.** Confirmed on the replica: 1 row left. Low risk (test accounts) and frozen by W-10.

#### Information
- **I-a:** a legacy Stripe trace alone (G-7, for example one `billing_events.stripe_event_id`) sets the receipt mode to `pseudonymised_billing_kept`. That is the §3.2 design ("G-7 info, same as G-5"). The user-facing wording in DE-10b.2 should not imply live money.
- **I-b:** SA comment 1 confirmed. An integrity raise inside the anonymise (blank re-read, survivor scan) reaches the route as P0001 and is answered 409 "blocked" with `guards: []`. Everything rolls back, as before.

### Test Outputs / Logs

```text
Full Jest (npm test, this worktree, Windows): Test Suites: 20 failed, 8 skipped, 1547 passed, 1567 of 1575 total
                                              Tests: 140 failed, 65 skipped, 39773 passed, 39978 total (1,046 s)
Main checkout, supabaseFetch.test.ts:         FAIL (same "more generous in development" case)
Targeted re-run incl. the new QA file:        Test Suites: 10 passed; Tests: 497 passed
New QA file route.piiEveryRefusal.test.ts:    Tests: 21 passed
PGlite replica (scratchpad de10bqa/qa.mjs):   106 PASS, 0 FAIL ("FAILURES: 0")
```

**Replica setup:** the public schema comes from the prod read-only introspection of 2026-10-07: 180 tables, their columns and types, 332 FKs with their ON DELETE actions, and NOT NULL on the SET NULL columns. Added on top: the real 20261027 and 20261074 files, and the 20261076 table DDL taken verbatim from the file (its body guard needs the 20261031 transition function, which is not modelled). The Supabase auth schema is modelled in GoTrue's shape, with every closure table and `audit_log_entries.payload` as `json`. Also modelled: roles `anon` / `authenticated` / `service_role` (BYPASSRLS) with Supabase default privileges, the real consent guard trigger, the two allow-listed `updated_at` triggers and the `audit_trail` user-email trigger. Then the real files ran in prod order: 20261041 → secret → **20261077** → precheck → **20261080** → **20261081** → checker → … → both rollbacks. **Not modelled:** the 50+ other prod triggers, real concurrency (one connection), Storage itself (the route does that step), and any table created after 2026-10-07 except the three above. The prod precheck and checker remain the proof for those.

### Deferred to post-apply (second QA round, after the user runs §8)

| # | Step (who) | What to record | Pass condition |
|---|---|---|---|
| P-1 | §8 step 1 precheck on prod (user, read-only) | All 14 rows, especially row 9 (the closure tables that exist on prod) | Every row `ok`. Then **CR-1**: move the two 20261077 sha256 lines from `PENDING_PREVIOUS` to `APPLIED` in `scripts/__tests__/testAccountCleanupSql.test.ts` |
| P-2 | §8 steps 2–4: apply 80, apply 81, checker (user) | The checker's 11 rows | Every row `ok`, stamp `d72232d8fcc75e5e` |
| P-3 | The window between step 3 and step 5 (QA, on the still-old deployment) | One admin Check on `/admin/users` | 503 `function_out_of_date`, and no storage call in the Vercel log. Keep the window short |
| P-4 | Before the key is set, if the order allows (QA) | One hard and one anonymise delete attempt on a `+test` account | Both 503 `not_configured`, nothing removed. Then set `DELETION_RECEIPT_FINGERPRINT_KEY` (Production + Preview) and redeploy |
| P-5 | §8 step 6 read-only probe (QA) | Admin Check in both modes on one `+test` and one real account | The verdict renders. Blockers and notes are listed apart. G-5 / G-7 / G-9 C3 / G-14 / G-15 appear only as notes |
| P-6 | §7.6 disposable non-`+test` account (user creates it via invite; QA runs). Seed: a business, a client, a sent invoice, website consent rows, one test-mode boost, an invite it redeemed, an invite it issued and never used | Before and after, read-only SQL plus screenshots | Check on `/admin/users`: G-9 C3 and G-14 are notes only. Delete with reason "Customer asked". Then: `/admin/users` still lists users (K-1). The old password is refused, and the old email can sign up again (K-2). `auth.users` holds the placeholder, no phone, empty token columns and a ban 100 years out. Zero rows in identities, sessions, refresh tokens, factors, `flow_state` and the auth log, searched by id **and** by old email. Kept rows keep the same `user_id`, with the blank columns empty. The receipt has mode `anonymised` / `pseudonymised_billing_kept`, a 12-hex ref matching the placeholder, no email, the admin's id and email, and the reason. The `ACCOUNT_PSEUDONYMISED` row has `user_id = actor_id =` the admin. The redeemed invite holds the placeholder email and the issuer's columns are intact. The unused issued invite is gone. The consent rows remain with `contact_id` NULL. Record `server_ms` (K-12) |
| P-7 | Failure orderings on prod (QA, one each, `+test` account) | Response plus the refused audit row | G-3 mismatch → 400. "Other" with a 4-char note → 400. Hard mode + `customer_asked` sent by hand → 400. Nothing removed each time |
| P-8 | C2-8 finance (QA) | Screenshots before and after P-6 | Plan revenue, boost revenue, refunds and the credit ledger figures are unchanged. AI cost is unchanged. Client takings may drop |
| P-9 | C2-9 crons by hand with `CRON_SECRET` (QA): `bos-billing-reconcile`, `credit-leak-check`, `finance-snapshot` | Responses plus Vercel logs | No crash. The `.invalid` refusal appears in the log. No email is sent. No new row holds personal data |
| P-10 | Regression (QA) | `+test` hard delete end to end on `/admin/users` and on `/test-business-os` (reason locked to "Test account") | Works. The receipt has mode `full_delete` and no ref |
| P-11 | No PII on prod (QA) | Vercel logs and the `ACCOUNT_DELETION_REFUSED` / `BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED` rows from P-3 … P-10 | No email, note, fingerprint or secret in any of them |
| P-12 | CR-2 at PR time (RM) | The migration-number re-scan | 80 and 81 still free on `origin/main`, every branch and every worktree. Recorded in Commit Info |

### Final Status
- [x] All acceptance criteria that can be proven before the prod apply pass. Ready for the user's diff review and the §8 apply
- [ ] Not ready to merge until CR-1 (after P-1) and the post-apply round P-1 … P-12 pass

**New test file (QA, uncommitted):** `app/api/admin/test-account-cleanup/__tests__/route.piiEveryRefusal.test.ts`. No production code was changed.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Workplan created (Dev) | Against requirement SA Review 2 + user decisions 2026-10-18; 24 tasks, ~4.25 d; open items O-1 … O-12 for SA |
| 2026-10-18 | Dev: W-1 recorded, implementation code complete | Tasks 1 to 23 done, uncommitted. W-10 proof (pasted files unchanged), decisions I-1 to I-14 for SA, Dev self-test. Nothing applied to any database |
| 2026-10-18 | SA workplan review: approved with conditions | O-1 … O-12 ruled (O-4 differs from Dev: delete every invite the account issued; O-10 one-way reason coupling for hard mode). Conditions W-1 … W-14: SQL-W8 for the four added keep-set tables, rollback drops the 8-arg first, widened auth-log predicate and G-20, receipt-input trust, discriminated-union Zod. 20261080 / 20261081 confirmed free |
| 2026-10-18 | SA code review: approved for QA with conditions | W-1 … W-14 verified in the diff; hard path proven byte-identical by diff against 20261077; I-1 G-22 two-link allow-list approved (trigger read); TL prod facts recorded. Conditions CR-1 (APPLIED pins after precheck), CR-2 (number re-scan at PR), CR-3 (`audit_trail.user_id` nullability before DE-10b.2). 5 low-priority comments, QA list of 10 |
| 2026-10-18 | QA pre-apply round: PASS | Full Jest 1,547 / 1,575 suites green, the 20 red ones are the quarantine, `supabaseFetch` (red on main too) and 8 Windows-CRLF scans of untouched files. Touched + guard suites 497 / 497. New QA test `route.piiEveryRefusal.test.ts` (21). PGlite replica: precheck 14 ok, checker 11 ok, anonymise / hard / owner paths, 14 rollback orderings, both rollbacks: 106 PASS, 0 FAIL. No bug; edge cases E-1 … E-3. Post-apply round P-1 … P-12 owed |

---

## TL schema-check results — 2026-10-18 (SQL-W1…W7, prod, read-only)

- **W1 (blanked columns):** every one is nullable. Defaults: `billing_events.payload` and `credit_transactions.metadata` default `'{}'::jsonb`; the rest have no default. NULL is safe for all text columns; for the two jsonb-with-default columns, set `'{}'` (or strip keys with `metadata - 'agent_name'`), not NULL.
- **W2 (auth columns):** `users` text-token columns `phone_change`, `phone_change_token`, `email_change_token_current`, `reauthentication_token` default `''` (keep `''`, never NULL, per O-6). `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change` have no default — set `''` too. `phone` default NULL. `identities.identity_data` is NOT NULL jsonb (we delete identities, so moot). **Extra tables found:** `auth.flow_state` (has `user_id`, `provider_access_token`, `provider_refresh_token`) and `auth.mfa_challenges` (via factor). Add `flow_state` rows for the subject to the delete list. `auth.audit_log_entries.ip_address` NOT NULL default `''`.
- **W3 (auth log keys):** payload keys `actor_id`, `actor_username`, `actor_name` (19,729 rows), `actor_via_sso`, `log_type`, `action`, `traits` (1,176). `traits` holds `user_email`, `user_phone`, `user_id` (36 rows) and provider ids. **Delete predicate:** `payload->>'actor_id' = subject` OR `payload->'traits'->>'user_id' = subject` (the second catches admin actions on the subject). Payload column type is `json`, not `jsonb` — cast.
- **W4:** `postgres` holds UPDATE and DELETE on every listed auth table, including `audit_log_entries`.
- **W5 (UPDATE triggers):** none on `auth.users` or on the blanked billing tables, except `updated_at` touch triggers on `token_usage` and `user_subscriptions` (harmless; G-21 can allow-list them).
- **W6 (FKs from kept tables to non-auth tables):** all point at other kept tables or catalogs. CASCADE edges: `business_os_boost_reversal_events.purchase_id` → boost_purchases (both kept); `boost_pack_purchases.boost_pack_id` → `boost_packs` and `user_rewards.reward_config_id` → `reward_config` (catalogs, not touched by the delete). `marketing_consent_events/state.contact_id` → `crm_contacts` SET NULL (contacts deleted → links cleared, rows kept). `business_os_credit_lot_draws.lot_id` → lots NO ACTION (keep both — supports O-3). No kept row can be cascade-deleted by the plan's deletes. G-22 can be a static pin of this list.
- **W7 (invites):** `business_os_invites` holds personal data — `email`, `inviter_display_name`, `personal_note`, `inviter_reply_to`, `internal_reason`, `email_problem_detail`, `redemption_error_message` — plus `issuer_account_id`, `redeemed_account_id`, `claimed_account_id`, `redemption_failed_account_id`. `business_os_account_lineage` holds ids only plus `first_payment_ref`. For O-4: invites ISSUED by the subject are deleted (the invitee's email goes with them); lineage rows stay as nameless links (NBQ-4). Invites REDEEMED by the subject: blank `email`, `personal_note`, `inviter_reply_to` only if the issuer is another account — SA to rule.

---

## SA Workplan Review — 2026-10-18

**Reviewed by SA — 2026-10-18**
**Status:** ⚠️ Approved with conditions (W-1 … W-14 below). The approach is right: one engine, anonymise as a mode, receipt inside the transaction, hard path unchanged. No phase or pattern problem. Proceed to task 4 once W-1 and W-2 are met.
**Evidence:** read on `feature/data-export-de10b` at `399070d4` (fast-forwarded to `origin/main`). Generator constants (`FUNCTION_MIGRATION = 20261077_…`, `PREVIOUS_FUNCTION_MIGRATION = 20261075_…`), `renderRollbackSql` / `previousFunctionSql`, `FINAL_STEPS` (invites issued by the account deleted), `KEPT_RESIDUE`, the APPLIED sha256 pins and the family-4 guard read. `lib/supabaseServerAuth.ts` cookie `set` / `remove` confirmed no-ops. Invite DDL read (20261012, 20261014, 20261020). **Migration numbers:** `git log --all -- 'supabase/migrations/2026108*'` returns nothing, and none of the 33 sibling worktree folders holds a `2026108*` file: **20261080 and 20261081 are free.** No SQL run by SA; TL's W1 … W7 used as given.

### Rulings on the open items

| # | Ruling |
|---|---|
| O-1 | **Yes, G-21, runtime.** Reviewed allow-list = the two `updated_at` touch triggers W5 found (`token_usage`, `user_subscriptions`). Scope also `public.business_os_invites` (W-6 blanks it), which W5 did not cover: TL re-runs W5 for that table before task 7 |
| O-2 | **Yes, G-22, runtime, not a static pin.** The legacy tables are dashboard-only (no migration), so a Jest pin cannot see them change. Shape: refuse **any** FK from a keep-set table to a table in the anonymise plan, whatever its `ON DELETE` (CASCADE / SET NULL damage kept rows silently; NO ACTION would roll the run back with a raw 23503 instead of a named guard). W6 shows zero today, so it passes |
| O-3 | **Yes to all four** (`business_os_credit_lot_draws`, `boost_pack_purchases`, `user_rewards`, `subscription_invoices`). They are already in the hard plan (generator lines 185–196), and W6 shows their edges point only at kept tables or catalogs. **Condition W-2:** SQL-1 never covered them, so their personal columns are unknown |
| O-4 | **Invites issued by the subject: delete all of them, redeemed or not** (as the hard plan's `FINAL_STEPS` already does, and as TL's W7 reading). Lineage has no FK to invites (`invite_id` is a bare uuid, 20261014), so the nameless link survives for NBQ-4. **Invites redeemed or claimed by the subject (issued by someone else):** keep the row, set `email` to the placeholder address (it is NOT NULL and must pass `email = lower(btrim(email))` and length 3–320, which the placeholder does), and set `personal_note`, `email_problem_detail`, `redemption_error_message` to NULL (all nullable). Leave `inviter_display_name`, `inviter_reply_to`, `internal_reason`: they are the issuer's own data, NOT NULL with length CHECKs, and the issuer still exists |
| O-5 | **Accept `now() + interval '100 years'`.** GoTrue scans `banned_until` into a Go `time.Time`, which cannot hold `infinity`. 100 years matches Supabase's own `ban_duration` convention. Supersedes §D "infinity" |
| O-6 | **Accept `''` for every token column.** W2 confirms four of them already default to `''`. Pin "never NULL" in the generator test, as planned |
| O-7 | **Yes to the full SQL-4 list, plus `auth.flow_state` (W2).** `mfa_challenges` goes by cascade from `mfa_factors`; the survivor scan must still assert zero rows for it. **`deleted_at`: leave unset** (Dev default) until shown harmless to GoTrue's list and lookup paths |
| O-8 | **Yes.** `ACCOUNT_PSEUDONYMISED` in-function for both origins (source in `details`), `ACCOUNT_DELETION_REFUSED` at route level |
| O-9 | **Yes, a DB-function-only writer is acceptable under rule 1.** Rule 1 governs app-side Supabase access. The only app-side path to this write is an RPC already inside `lib/repositories/TestAccountCleanupRepository.ts`, so rule 1 holds. Conditions: the repository header says the RPC writes the receipt; the table is registered `never` (task 5); the R-7 guard stays green; release 3 adds the read repository through the `new-repository` skill |
| O-10 | **Mode choice on `/admin/users` only: yes. `/test-business-os` stays hard-only: yes. Reason-to-mode coupling: one-way, yes** (overrides Dev's "no coupling"). Hard mode on `/admin/users` requires reason category `test_account`; the server answers 400 for any other category in hard mode. Anonymise accepts every category. The panel pre-selects and locks "Test account" when that mode is chosen. Reason: a `full_delete` receipt saying "customer asked" would claim a full erasure that our billing rules forbid, and the cost is one Zod refinement |
| O-11 | **Yes.** The first tombstones appear in this slice, so the `.invalid` refusal and the C2-9 cron cases belong here |
| O-12 | **Yes, drop `admin_export_downloaded`.** Its only source is audit rows that the deletion removes. `admin_export_existed` stays |

### Rulings on Dev's deviations

| Deviation | Ruling |
|---|---|
| G-20 / G-21 / G-22 added | Approved (O-1, O-2). **G-20 widened (W-5)** |
| Ban 100 years, not infinity | Approved (O-5) |
| `''`, not NULL, on auth token columns | Approved (O-6) |
| Full auth cascade list + `flow_state` + `mfa_challenges` | Approved (O-7) |
| `auth.audit_log_entries` delete predicate | Approved with the widened predicate in W-4 |
| Keep-set additions | Approved (O-3), subject to W-2 |
| Invites | O-4 above. This **differs from Dev's default** (Dev kept issued-and-redeemed invites) |
| No receipt repository | Approved (O-9) |
| `admin_export_downloaded` dropped | Approved (O-12) |
| `.invalid` refusal + cron QA moved into 10b.1 | Approved (O-11). Requirement §F to be spliced (task 22) |

### Conditions

- **W-1 (before task 4)** Task 1 re-check recorded in the workplan: 80 and 81 still free on `origin/main`, every branch and every worktree folder. Repeat at PR time (C2-4).
- **W-2 (before task 6)** TL runs one more read-only check, SQL-W8: the columns, types and nullability of `boost_pack_purchases`, `user_rewards`, `subscription_invoices` and `business_os_credit_lot_draws`, and the jsonb object keys of any json / jsonb column on them (same shape as SQL-1b). Anything personal goes on the blank list. TL also re-runs SQL-W5 for `public.business_os_invites` (O-1).
- **W-3 Rollback.** The 20261081 rollback must `DROP FUNCTION IF EXISTS` the **8-arg** signature **before** recreating the 20261077 body, and grant the **6-arg** signature to service_role only. `CREATE OR REPLACE` of the 6-arg alone would leave both overloads live. The generator test pins: drop first, 20261077 body byte for byte (via `previousFunctionSql`), the 6-arg grant, `NOTIFY pgrst`. `PREVIOUS_FUNCTION_MIGRATION` moves to `20261077_…`, its sha256 and its rollback's are added to APPLIED, and 20261075 stays pinned (the drift-test rule in the generator header). Precheck step 1 is the proof that 20261077 is live, so do not write the APPLIED sha until that precheck has passed on prod.
- **W-4 Auth-log predicate (W3).** Cast `payload::jsonb`. Delete where `actor_id = subject` OR `traits.user_id = subject` OR `lower(actor_username) = lower(p_email)` OR `lower(traits.user_email) = lower(p_email)`. The email is known in the transaction, and W3 shows the email on every row, including rows a failed or pre-signup action wrote without the subject's id. All comparisons are `::text`. The survivor scan re-runs the same predicate and expects zero.
- **W-5 G-20 widened.** Besides FKs into `auth.users` / `auth.sessions`, G-20 also refuses any `auth` table that has a `user_id` column and is not on the reviewed closure list. `flow_state` and `audit_log_entries` have no FK, so a FK-only check would miss the next table of that kind.
- **W-6 Invite blanks (O-4)** use the same "column exists + re-read" machinery as the other blanks, keyed on `redeemed_account_id = subject OR claimed_account_id = subject` rather than `user_id`. Pinned in the blank-list test as their own triples. This UPDATE touches a row of another account, so state it in the repository header next to the `tenant-isolation-guard` paragraph: the key is the subject's id, never a caller-supplied id.
- **W-7 Receipt input trust.** The function generates `id`, `status`, `mode`, `placeholder_ref`, the totals and `completed_at` itself and **ignores** those keys if they appear in `p_receipt`. It raises when `origin = 'owner'` comes with a non-NULL `p_actor`, or when `origin` and `executor_kind` disagree. Add a table CHECK: `(origin = 'owner') = (executor_kind = 'self_service')`. The admin route never sends `origin = 'owner'` (route test). `executor_admin_email` comes from the `requireAdmin` session, never the body.
- **W-8 Zod.** The check and delete bodies are `z.discriminatedUnion('mode', [...])` with `.strict()` on **each** branch, not one object with conditional `superRefine`. That way an unknown key in either mode is a 400, and `tag` cannot ride along in anonymise mode.
- **W-9 SQL-editor hygiene.** No PL/pgSQL `SELECT … INTO` in the new block (use `:= (SELECT …)` as the existing body does). The word "into" appears only in the two allowed `INSERT INTO` keywords. No "into" in comments or string literals, including the precheck and checker scripts.
- **W-10 Hard path proof.** Task 10 must show `git diff` of the two pasted files. If the bytes change at all, the reason goes into the workplan before SA code review.
- **W-11 Survivor scan for the closure** includes `mfa_challenges`, `flow_state` and the `audit_log_entries` predicate, alongside the tables listed in §3.5.
- **W-12 Follow-up (not this slice):** `KEPT_RESIDUE[0]` says a redeemed invite "holds only the pseudonymous id", but W7 shows it holds the invitee's email. For the test-account hard path this is low risk. Correct the reason text when the generator is next touched, or record it in the runbook in this slice.
- **W-13 Docs.** The runbook gains the apply order, the fingerprint-key loss warning and the rollback steps. `feature_flags.md` lists `DELETION_RECEIPT_FINGERPRINT_KEY` as an env secret (not a flag). The requirement gets the slice-status splice and the §D amendments (O-5, O-7, O-4) (standing rule).
- **W-14 Manual QA (§7.6) additions:** after the run, open `/admin/users` and confirm it lists users (K-1 proof), and confirm the invite the disposable account redeemed shows the placeholder email.

### CLAUDE.md compliance

| Rule | Finding |
|---|---|
| 1 Repositories | ✅ `findDeletionFacts` in the export-job repository, RPC in the cleanup repository. DB-side receipt write accepted (O-9) |
| 2 Zod | ✅ `.strict()` everywhere, W-8 for the shape |
| 3 Pino | ✅ Every touched file holds 0 `console.*` (Dev counted). Ids and counts only. Never email, note, fingerprint |
| 4 `user_id` / service role | ✅ Service-role path documented in the repository header. `tenant-isolation-guard` met by G-2a (subject from the drawer row must equal the login the email resolves to). W-6 adds the invite note |
| 5 Models | n/a |
| 6 TS strict | ✅ No `any` planned. The anonymise report gets a Zod schema in the parser |
| 7 New patterns | ✅ Direct `auth.*` writes are approved only inside the generated function (SA §D), and the family-4 guard enforces it. The DB-only receipt writer is approved in O-9 |
| 8 V6 | n/a |
| Admin gate | ✅ `requireAdmin` first, unchanged |
| Audit non-blocking | ✅ Route refusals via `logAndFlush`, and the in-function audit row is part of the transaction (by design, R-2) |
| Entitlements | ✅ No import |
| Flags | ✅ No flag reader in this slice; the env key reader is `isFingerprintKeyAvailable()` |
| Tests | ✅ Routes: happy + auth + invalid input + 10 orderings. New modules: unit tests. Generator pins cover C2-7. 20261080 guard with negative fixtures. Manual QA on prod recorded. All inside the existing Jest gate, so no added CI time |

### Business calls (plain language, for TL)

- None new from this slice. One consequence to tell the user with O-4: **if a deleted account had sent invitations that were never used, those invitation links stop working.** People already invited and signed up are not affected. TL default: accept.

### Approval

[x] Workplan approved with conditions W-1 … W-14. Proceed to implementation once W-1 and W-2 are recorded in this file.

## TL W-2 results — 2026-10-18 (SQL-W8 + W5 for invites, prod, read-only)

- `boost_pack_purchases` (2 rows): ids, credits, `price_paid_usd`, Stripe ids, status, dates, `metadata` jsonb default `'{}'` with keys `amount_total`, `boost_pack_id`, `stripe_session_id` — **no personal data**; nothing to blank.
- `user_rewards` (0 rows): ids, counts, `related_entity_type`, `metadata` jsonb default `'{}'` — no personal columns; blank `metadata` to `'{}'` defensively.
- `subscription_invoices` (0 rows): `invoice_number`, amounts, status, `plan_name`, Stripe ids, **`stripe_invoice_pdf` and `stripe_hosted_invoice_url`** (Stripe-hosted documents that show the customer's name/email — blank both, same rule as `receipt_url`), dates, `metadata` jsonb default `'{}'` (blank to `'{}'`).
- `business_os_credit_lot_draws` (1 row): ids, kind, credits, **`reason` text (admin note, 1 non-null)**, `actor_admin_id`, `idempotency_key` — blank `reason` (same rule as `credit_lots.reason`).
- **W5 for `business_os_invites`:** no UPDATE triggers — G-21 allow-list unchanged.

## SA Code Review — 2026-10-18

**Code Review by SA — 2026-10-18**
**Status:** ⚠️ Code Approved for QA, with conditions. CR-1 … CR-3 below are pre-merge or pre-DE-10b.2 items. None of them blocks QA
**Evidence:** read the uncommitted diff in `neuronforge-de10b` on `origin/main` `399070d4`: both migrations and both rollbacks, the precheck and the checker, the generator diff, the repository, both runners, both routes, the schemas, the panel, `emailTransport`, the events, the descriptors and the guard tests. Re-ran 130 touched and guard suites: **4,452 passed, 0 failed**. A scoped `tsc` over every touched source and its dependents: 0 errors in touched files. No SQL run by SA.

### TL facts recorded (prod, SQL-W2 / SQL-1, 2026-10-18)

- `auth.mfa_recovery_code_sets.user_id`, `auth.oauth_authorizations.user_id` (nullable), `auth.oauth_consents.user_id`, `auth.webauthn_challenges.user_id` (nullable) and `auth.webauthn_credentials.user_id` all exist. Dev's I-7 assumption holds. Precheck rows 8 and 11 stay as the run-time proof.
- `public.token_usage.metadata` is **jsonb**. The I-8 / G-11 risk does not materialise.
- `auth.audit_log_entries.payload` is **json**. The function casts `payload::jsonb` in the delete and in the survivor scan (W-4 met).
- W6 lists the two consent `contact_id → crm_contacts` SET NULL links. Ruling on I-1 below.

### Verification of the review focus

| Item | Finding |
|---|---|
| Hard path byte-identical (W-10) | ✅ The pasted check and delete files are unchanged in `git status`. `diff 20261077 20261081`: the `check` block (77:67–874 = 81:115–922) and the hard `delete` block (77:876–2043 = 81:1900–3067) are identical. Only the entry rules, the settings, the new branches and the receipt insert differ. The hard audit row is the 20261047 row, unchanged |
| Rollback 20261081 (W-3) | ✅ One transaction. `DROP FUNCTION IF EXISTS` of the 8-arg comes first. The recreated body is byte-identical to 20261077 (diffed). The 6-arg is granted to service_role only, then `NOTIFY pgrst` |
| 20261080 | ✅ No `REFERENCES`, no `user_id` / `owner_user_id`, RLS on, no policy. Revoke, then grant SELECT + INSERT to service_role. Has the `(origin = 'owner') = (executor_kind = 'self_service')` CHECK (W-7), the `full_delete` ⇔ NULL ref CHECK and the retention-floor CHECK. The post-conditions verify FKs both ways, the columns, browser table and column privileges, service_role holding exactly SELECT + INSERT, `postgres` INSERT, no trigger and both indexes. The rollback refuses when there are rows, or when 20261081 is live |
| Entry rules, receipt trust (W-7) | ✅ `delete` / `anonymise` need an object `p_receipt`. The origin must be known. Origin and executor must agree. Owner ⇒ `p_actor` NULL. Admin ⇒ `p_actor` set. `delete` is admin only. The function computes id, status, mode, ref, totals and `completed_at` itself. `executor_admin_id` is `p_actor`. Route: `executor_admin_email` comes from the `requireAdmin` session, and an `origin` in the body is a 400 (test) |
| G-2a, G-20, G-21, G-22 | ✅ G-2a blocks unless the email resolves to exactly `p_subject`. The tag is blanked in the anonymise modes. G-20 covers missing tables and columns, unreviewed FKs to `auth.users` / `auth.sessions`, any `auth` table with a `user_id` column that is not on the list (W-5), `scim_users` rows, and owner privileges. G-21 allow-lists the two `updated_at` triggers by name and covers the invites table. G-22 as ruled below |
| Login closure | ✅ The exact SET list. The eight token columns are set to `''`, never NULL (O-6). `banned_until = now() + 100 years` (O-5). Exactly one row is updated, or it raises. It covers the full closure list plus `flow_state`. `mfa_amr_claims` / `mfa_challenges` are asserted at zero through the captured session and factor ids (W-11). Auth-log predicate: actor id, traits user id, actor username and traits email, all compared as text on `payload::jsonb`, and re-run in the survivor scan (W-4) |
| Keep-set and blanks | ✅ The anonymise plan is the hard plan minus the 17 keep-set tables in it, in the same order, with lineage dropped from step C. The blank list is TL SQL-W1, plus TL W-2 (`credit_lot_draws.reason`, `subscription_invoices` pdf / hosted URL / metadata, `user_rewards.metadata`), plus the O-4 invite triples keyed on `redeemed_account_id OR claimed_account_id` (W-6). The jsonb columns with a default go to `'{}'` or have keys stripped, never NULL. Every blank is behind G-11 and is re-read after the loop |
| Invites (O-4) | ✅ Every invite the subject issued is in plan step C. Redeemed or claimed invites keep the issuer's columns and get the placeholder email plus three NULLs. Invites have an FK only on `issuer_account_id`, so the survivor scan cannot trip on the kept ones |
| Receipt in-transaction, last | ✅ One `INSERT` after both branches, inside the function. The hard totals come from its own same-`now()` audit row (I-4), and it raises if that row is missing |
| Audit row (F-2 / TQ-19) | ✅ `ACCOUNT_PSEUDONYMISED`, `user_id = actor_id = cleanup.actor_id` (NULL for owner origin, the admin otherwise). The details hold ids, the mode and per-table counts only |
| One transaction | ✅ 20261080, 20261081 and both rollbacks are each `BEGIN` / `COMMIT` (I-2). The new function's `REVOKE … FROM PUBLIC, anon, authenticated` runs in the same transaction, so Supabase's default function grants never get a window |
| Route / Zod / Pino / audit | ✅ `requireAdmin` first. `z.discriminatedUnion('mode', …)` with `.strict()` on each branch (W-8). Hard mode takes only `test_account` (O-10). The missing-secret 503 comes before the missing-key 503, and both come before any repository call. Refusals go through `logAndFlush`. Logs carry ids, guard ids and counts. A deep-scan test proves no email, note, fingerprint, secret or key reaches the logs, the audit rows or the bodies |
| `receipt_failed` ordering | ✅ `prepareReceipt` runs after the check and the version check, before storage, in both runners. It answers 500 `receipt_failed` with "Nothing was removed", and is audited. Route and runner tests prove storage and the delete never ran |
| `.invalid` refusal | ✅ The first statement of `sendEmail`. A mixed list is refused whole, and the log holds the count only. `to` is the only recipient field, and no consumer switches exhaustively on `blocked` |
| no-deletion-paths | ✅ Family 4 is extended (UPDATE `auth.users`, UPDATE any `auth` table, DELETE from any `auth` table but `users`). Only 20261081 is allow-listed, and the older versions are pinned to hold none of these writes. Negative fixtures cover case, spacing, newline, the dynamic `auth.%I` delete and the auth log. Family 5 adds the importer allow-list with three negative fixtures |
| W-9 "into" | ✅ Only `INSERT INTO` tokens: three in 20261081 (hard audit, anonymise audit, receipt), one in the rollback, one in the pasted delete. None in the precheck, the checker, 20261080 or its rollback. No `SELECT … INTO` |
| `supabaseFetch.test.ts` | ✅ Confirmed not this slice. It fails the same way on the main checkout. The test and its module are byte-identical between that checkout and `399070d4`, and untouched here |
| CLAUDE.md rules 1–8, security | ✅ Rule 1: DB access goes through the two repositories, with the DB-side receipt writer per O-9. Rule 2: Zod first. Rule 3: 0 `console.*` in touched sources (the one panel hit is the word inside a comment). Rule 4: `findDeletionFacts` filters on `user_id`, and the service-role RPC is documented with the G-2a and W-6 paragraphs. Rule 6: no `any`. Rule 7: auth writes exist only in the generated function, and the guard enforces it. The admin gate comes first. `details` is dev-only. No entitlements import |

### Rulings on Dev's I-1 … I-14

| # | Ruling |
|---|---|
| I-1 | **Approved: the two-link G-22 allow-list stands.** My O-2 note "W6 shows zero today" was wrong: TL's W6 lists both links. I read `marketing_consent_events_guard()` (20260930 L116–166). It returns NEW only when `contact_id` goes to NULL and every other column is unchanged, which is exactly what the referential action produces. `marketing_consent_state` has no UPDATE trigger (its only trigger is `trg_mce_project`, AFTER INSERT on events). The allow-list is as narrow as it can be: exact constraint name, `SET NULL`, nullable, single column. Anything else blocks. NBQ-3 keeps the rows, detached from the deleted contact |
| I-2, I-3, I-5, I-6, I-10 … I-14 | Approved as written |
| I-4 | Approved. The match key (`action`, `entity_id`, `created_at = now()`) can only find this transaction's row |
| I-7 | Approved. The TL facts above confirm the assumed key columns |
| I-8 | Approved. The TL fact (`token_usage.metadata` is jsonb) closes the risk |
| I-9 | Approved, with CR-1 |

### Conditions

- **CR-1 (before merge, after §8 step 1)** Once precheck row 1 says `ok` on prod, move the two 20261077 sha256 lines from `PENDING_PREVIOUS` to `APPLIED` in `scripts/__tests__/testAccountCleanupSql.test.ts` (W-3), in this PR.
- **CR-2 (at PR time)** Repeat the C2-4 / W-1 migration-number scan (80 and 81 free on `origin/main`, every branch and every worktree), and record it in Commit Info.
- **CR-3 (before DE-10b.2 code, not this slice)** The owner-origin audit row writes `audit_trail.user_id = NULL`. No migration in the repo shows whether that column is nullable, and the admin path never exercises it. DE-10b.2 must confirm on prod that `audit_trail.user_id` is nullable (`business-os-schema-check`) before relying on it.

### Code Review Comments (non-blocking)

1. `TestAccountCleanupRepository.ts`, `anonymise` / `remove`: every P0001 is mapped to `blocked`. So a survivor-scan, blank re-read or closure failure is reported and audited as a guard refusal with `guards: []`. That is safe: everything is rolled back, and the message names tables only. But the audit cannot tell "a guard appeared" apart from "an integrity check failed". Suggest a separate reason when the message holds no guard id — Priority: Low
2. `generate-test-account-cleanup-sql.ts`, receipt insert: O-10 (hard ⇒ `test_account`) is enforced only by the route. A one-line raise in the function, or a table CHECK `mode <> 'full_delete' OR reason_category = 'test_account'`, would make the DB the authority, as it is for W-7. A candidate for release 2, when the table is widened — Priority: Low
3. `delete/route.ts`: `correlationId` comes from the client's `x-correlation-id` header and is stored in the receipt (sliced to 200). That is the repo-wide pattern, but this value is kept for years. Consider a uuid shape check before it goes in a receipt — Priority: Low
4. Hard path: it still leaves the test account's `auth.audit_log_entries` rows (there is no FK, and W-10 froze the bytes). Add the W-4 predicate to the hard plan the next time its bytes may change — Priority: Low
5. `no-deletion-paths`: family 4 does not cover `INSERT INTO auth.` / `TRUNCATE auth.`, and family 5 does not match dynamic `import()` / `require()`. Neither exists today — Priority: Low

### Optimisation Suggestions

- In the anonymise modes, G-17 still scans DELETE triggers on keep-set tables, because they keep their FK to `auth.users`. It fails closed and is harmless. Narrowing it is optional.
- The anonymise casts every `auth.audit_log_entries.payload` twice (once in the delete, once in the survivor scan). That is fine at today's ~20k rows. QA records `server_ms` (K-12).

### What QA must specifically exercise

1. **Jest:** the 130 suites above plus the full gate. Confirm that `supabaseFetch.test.ts` is the only failure, and that it is also red on `main`.
2. **Precheck / checker (§8 steps 1 and 4):** every row says `ok`, and row 9 lists the closure tables that exist on prod. Then CR-1.
3. **Old build vs new function window:** between steps 3 and 5, the admin Check answers 503 `function_out_of_date`, with no storage call.
4. **Fingerprint key missing:** both modes answer 503 `not_configured`, and nothing is removed. Then set the key.
5. **Read-only probe (§8 step 6):** the anonymise Check on a real account shows blockers and notes separately. G-5 / G-7 / G-9 C3 / G-14 / G-15 show as notes only.
6. **§7.6 disposable-account run**, with these additions:
   - `/admin/users` still lists users afterwards (K-1).
   - The old password is refused, and the old email can sign up again (K-2).
   - `auth.users` shows the placeholder, no phone, empty token columns, and a ban 100 years out.
   - Zero rows for the subject in identities, sessions, refresh tokens, factors, `flow_state` and the auth log (searched by id **and** by old email).
   - The kept rows have the same `user_id`, with the blank-list columns empty.
   - The receipt has mode `anonymised` or `pseudonymised_billing_kept`, a 12-hex ref matching the placeholder, no email, the admin's id and email, and the reason.
   - The `ACCOUNT_PSEUDONYMISED` row has the admin as `user_id` and `actor_id`.
   - An invite the account redeemed shows the placeholder email, with the issuer's columns intact (W-14).
   - An invite it issued and never used is gone.
   - The consent rows remain, with `contact_id` NULL.
7. **Failure orderings on prod (one each, on a `+test` account):** a G-3 mismatch (400, nothing removed); the "Other" reason with a 4-character note (400); hard mode with "customer asked" sent by hand (400).
8. **C2-8 and C2-9:** the four finance figures are unchanged before and after. Run the three crons by hand: no crash, the `.invalid` refusal appears in the log, and no email is sent.
9. **Regression:** run the `+test` hard delete end to end on `/admin/users` and on `/test-business-os` (reason locked to "Test account"). Its receipt has mode `full_delete` and no ref.
10. **No PII:** the Vercel logs and the refused audit rows from the runs above hold no email, note, fingerprint or secret.

### Code Approved for QA: Yes (with CR-1 … CR-3)

**CR-3 closed by TL — 2026-10-18 (prod, read-only):** `public.audit_trail.user_id` uuid **nullable = YES** (`actor_id` also nullable). A self-delete audit row with `user_id = NULL` is accepted.

## TL precheck on prod — 2026-10-18 (§8 step 1, read-only)

Rows 2–14 **ok** (row 9: flow_state, identities, mfa_amr_claims, mfa_challenges, mfa_factors, mfa_recovery_code_sets, oauth_authorizations, oauth_consents, one_time_tokens, refresh_tokens, scim_users, sessions, webauthn_challenges, webauthn_credentials). **Row 1 FAIL:** the live cleanup function carries the **20261075** stamp `a824848e0a538477`, not 20261077's `b78b4579fc6631f8`. Finance 4b.1 (PR #447, merged 2026-10-17) applied its table 20261076 (`business_os_boost_reversal_events` exists) but **20261077 — the regenerated cleanup function — is not applied on prod**. **Apply stopped.** Order to resume: apply 20261077 (finance 4b.1's owed step, its own checker) → re-run this precheck (row 1 ok) → CR-1 → 20261080 → 20261081 → checker. 20261081's rollback restores 20261077, so 77 must be live first.

**Resumed — 2026-10-18:** the user applied 20261077. TL confirmed on prod: the 6-argument function carries stamp `b78b4579fc6631f8` and names `business_os_boost_reversal_events`, SECURITY DEFINER, owner postgres, EXECUTE for service_role only; 20261080 and 20261081 not yet applied. Precheck row 1 now passes (rows 2–14 unchanged ok). **CR-1 done:** the 20261077 pins moved from `PENDING_PREVIOUS` to `APPLIED` (testAccountCleanupSql.test.ts 171/171).
