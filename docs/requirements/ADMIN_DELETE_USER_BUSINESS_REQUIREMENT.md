# Requirement: Admin — Delete a User / Business from the Businesses page

> **Last Updated**: 2026-10-06

**Created by:** BA
**Date:** 2026-10-04
**Status:** **SA: APPROVED WITH CONDITIONS (2026-10-04)** · ✅ **AD-1 COMPLETE (2026-10-05)** — AD-1a PR #216, AD-1b PR #220, AD-1c PR #222 (the dialog; #221 had merged into the AD-1b branch, so #222 landed the same commit `4563fd69` on main). Read-only preview live on `/admin/users`. **Next: purge slice 3 (built inactive), then AD-2…AD-4** — AD-2 runs only after the user rotates the `service_role` key and the held `purge_business_data` RPC is applied (B-1, B-2; user deferred 2026-10-05). UD-11 (customer-delete parity) stays deferred until AD-3. The Business OS data export ([BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md)) runs after AD-2…AD-4; **until it ships, do not admin-delete a real customer holding business data** (export DX-12). **2026-10-06: AD-2 in progress, INACTIVE** — AD-2a (server commit path) code complete on `feature/admin-delete-ad2-commit`, uncommitted; AD-2b (dialog: typed confirmation, commit call, result screen) code complete on `feature/admin-delete-ad2b-dialog`, uncommitted, awaiting SA + QA. Inactive twice over: admin delete has its **own off switch, default off** (UD-12), and the held RPC makes every commit refuse `rpc_not_applied`. Decisions UD-12…UD-15 recorded below.

## Overview

The owner wants a **Delete** button on the admin **Businesses** page (`/admin/users`). An admin would use it to delete one login and its Business OS business, after a confirmation, and it should behave like the customer's own "delete my account". As built, **neither delete exists.** The customer button only shows a "contact us to erase" message. The deletion engine it is meant to use (the Business Data Purge) is parked. Its destructive function is held until the `service_role` key is rotated, and its Purge level has not been built.

So this requirement does **not** invent new deletion code. It adds an **admin target** to the existing purge engine. The purge requirement deliberately left this out of v1 (D5, follow-up FU-4). The work is planned as small slices, and the first one is read-only and can ship now.

> **Where this belongs.** This is a new **surface and a decision change** on top of the purge requirement ([BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md)). It is not a new engine. It is kept as its own document because that requirement is 1,200 lines, is parked, and is self-contained by its own rule O-4. Three short splices into it are needed after SA review. Their text is in [Appendix A](#appendix-a--splice-text-for-the-purge-requirement).

---

## Table of Contents

1. [Discovery — what exists today](#1-discovery--what-exists-today)
2. [What "behave like the user delete" can mean today](#2-what-behave-like-the-user-delete-can-mean-today)
3. [Decisions this requirement changes](#3-decisions-this-requirement-changes)
4. [User stories](#4-user-stories)
5. [Delivery slices](#5-delivery-slices)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Acceptance criteria](#8-acceptance-criteria)
9. [Decisions and open questions](#9-decisions-and-open-questions)
10. [Out of scope / future roadmap](#10-out-of-scope--future-roadmap)
11. [Notes on integration points](#11-notes-on-integration-points)
12. [Appendix A — splice text for the purge requirement](#appendix-a--splice-text-for-the-purge-requirement)
13. [SA Review Notes](#sa-review-notes)
14. [Change History](#change-history)

Evidence tags: ✅ read in code or docs on 2026-10-04 · 🧠 taken from project memory, not re-verified · ❓ needs SA live verification.

---

## 1. Discovery — what exists today

### 1.1 The page

| Fact | Tier |
|---|---|
| The page the owner calls "admin/business-os/users" is **`app/admin/users/page.tsx`**. Its heading is **"Businesses"** and it lists "every login on the platform". There is no `app/admin/business-os/users` route | ✅ |
| Each row shows business name, user, credits left, contact, login activity, last sign-in and joined date. Expanding a row shows the `BusinessOsPanel`, user info, plugins, AI spend and the audit trail | ✅ |
| **A delete button existed here and was removed on purpose.** The page comment (≈ lines 398–413) says `POST /api/admin/users/[id]/terminate` "hard-deleted an arbitrary `auth.users` row from the URL parameter with no authentication of any kind". The route became a 410 tombstone and the button was taken out. Neither route file exists any more | ✅ |
| The page is guarded server-side: `app/admin/layout.tsx` calls `requireAdminPage()`, and every `/api/admin` handler calls `requireAdmin` (CI-enforced) | ✅ (comment) |
| ADMIN_BOS_CLEANUP slice 1 (OQ-1 = B) made the **Admin users** page (the `admin_users` list) read-only. That is a different page. It is relevant here only because **admins are managed by SQL, not from the UI** | 🧠 |

### 1.2 The customer's "delete my account" today

| Fact | Tier |
|---|---|
| `POST /api/user/delete-account` used to delete `auth.users`. For every onboarded user it failed partway through and left a half-deleted account (purge req §1.3). It has been retired, and the route file is gone | ✅ |
| All live Danger Zones now render `components/business-os/purge/DangerZonePanel.tsx` / `ErasureRequestContent`. It offers **Export Data** and a **Contact us** mailto (a temporary personal address, marked `TEMP-ERASURE-CONTACT`). **Nothing is deleted** | ✅ |
| The comment says the real flow (dry-run → pre-flight gate → typed confirmation → commit) lands in that component when `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` is turned on (D9) | ✅ |

**So today, a customer who wants to be deleted emails the owner, and the owner has no tool to do it.** The owner currently does it by hand in SQL. Deleting an auth user directly fails with `23503`, because `profiles_id_fkey` and about 22 other foreign keys to `auth.users` are `NO ACTION`. 🧠 (measured 2026-10-04)

### 1.3 The purge requirement — the one the owner remembers

[BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) is **PARKED since 2026-09-17**. 🧠✅

| Slice | What | State |
|---|---|---|
| 0 | Repo-wide deletion-path guard | ✅ merged (PR #41) |
| 1 | Read-only census / preview, admin-gated, on `/test-business-os` → Danger Zone | ✅ merged (PR #43), live |
| 2 | **Reset** level (keeps the business profile and the login, wipes operational data), internal only | ✅ merged (PR #46). **INERT.** `purge_business_data` sits in `supabase/held/` and is not applied |
| 3 | **Purge** level (deletes the business itself), internal | ⬜ not started. **Blocked**: PR #45 added a second account-deletion design (its own 55-table list, its own money check, and CASCADE FKs from `business_profiles`) that has to be reconciled first 🧠 |
| 4 | Stripe pre-flight gate, enumerated from Stripe | ⬜ not started |
| 5 | Customer surface behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | ⬜ not started. Needs 2 + 3 + 4 |

**What the engine can do now:** count, per table and per storage bucket, everything one business owns. It does this for **the signed-in admin's own account only**, through `POST /api/business-os/purge/preview`.

**What it cannot do now:**

1. Delete anything. The Reset RPC is held, and Purge is not built.
2. Target **another** user. FR-2 / AC-28 forbid a caller-supplied `user_id` by design. D5 says: "No admin-purge-of-another-business in v1". That was deferred as **FU-4**.
3. Delete or close the **login**. D3 says `auth.users` and `profiles` are "never deleted, at any level". Closing the account was deferred as **FU-9**.
4. Handle a business that has a Stripe Connect account. Slice 2 refuses outright (SA-S5) until slice 4 exists.

**What blocks it, in order:**

| # | Blocker | Owner | Tier |
|---|---|---|---|
| B-1 | 🔴 **Rotate the `service_role` key.** It is published in public git history. Until it is rotated, applying the delete RPC creates a remote "delete any business by id" endpoint (`supabase/held/README.md`) | User (ops) | ✅ README · 🧠 not yet done as of 2026-10-02 |
| B-2 | Apply `20260916b_purge_business_data.sql`, following the README's 11-step checklist | User | ✅ |
| B-3 | Purge **slice 3** (the Purge level), which needs the **PR #45 reconciliation** first | Purge requirement / SA | 🧠 |
| B-4 | **Classification re-sweep, and the fail-closed check that was never built.** The runtime AC-37 check (purge T7 `SchemaReconciler`) does not exist, so the preview does **not** refuse when a table is unclassified. **The risk is silent under-counting, not refusal.** Measured on prod 2026-10-04 (SA-2): 2 unclassified tenant tables (`insight_actions`, `auth_handoff_codes`) and 7 more under FR-1's union predicate. AD-1 builds the reconciler and does the classification pass (SC-7, SC-8) | Dev (AD-1) | ✅ measured by SA |
| B-5 | AC-29 (a signed preview → commit token) is not built. The purge requirement calls it a slice-5 prerequisite. **An admin deleting someone else's business needs it more than a self-delete does** | This requirement | ✅ |

### 1.4 Other relevant facts

| Fact | Tier |
|---|---|
| **There are two kinds of Stripe money.** (a) The **business's own** Stripe Connect, where its clients pay it. This is the purge gate C1–C3. (b) The **platform plan**, where the business pays us: `business_os_billing_accounts`, a live Stripe subscription. Its table comment says "**Never purged**. Detached from the person on account deletion by ON DELETE SET NULL". The purge requirement predates (b) | ✅ |
| ~~Plan payments include "friend pays" (5c). One login can pay for another business's plan~~ **Corrected by SA (SA-7, SC-11):** "friend pays" means the **invited friend pays for their own plan**. `business_os_billing_accounts` has one `user_id` and no payer column, and lineage records who invited whom, not who pays. **No cross-account payer exists as built.** The risk of a subscription charging for nothing is covered by R-3 on the target's own subscription | ✅ (SA-7) |
| Money and ledger tables (`credit_transactions`, `user_subscriptions`, `billing_events`, `boost_pack_purchases`, `token_usage`, the newer credit and charge tables) are classified **`never`**. They are the platform's commercial record and survive any purge | ✅ (§8.5, §8.11) / ❓ for tables added after 2026-09-26 |
| One login = one business (`business_profiles.user_id` UNIQUE). **There are no team members inside a business.** "Invited members" are separate logins, linked only by invites and payer relationships | ✅ |
| Admin Archiving slice 3 shipped an **audit-trail erasure / anonymise** capability. Memory says "account deletion never calls erasure", a backlog item that this feature would close | 🧠 |
| Since BD-26 / UC-9, an **admin action recorded against an owner's account** must use the `operator` entity class, or the owner can read the admin's notes | 🧠 |

---

## 2. What "behave like the user delete" can mean today

The user delete is itself parked, so "similar" can only mean **the same engine, the same safety sequence and the same retention rules**, run by an admin against a chosen business:

| Property of the planned user delete | Admin delete |
|---|---|
| Same engine (`lib/business-os/purge/`), same classification, same retained set (`email_unsubscribes`, `user_preferences`, the money ledger) | **Same** |
| Dry-run preview first, showing what will go and what stays | **Same**, shown in the admin dialog |
| Pre-flight money gate (C1–C3), with no override | **Same**, plus the platform-plan and payer checks in §6.3 |
| Typed confirmation | **Stronger**: the admin types the target's business name (or email) |
| Hard delete plus a 7-day forensic snapshot, no undo (D4, D7) | **Same** (UD-6) |
| Target = the signed-in user only | **Changes**: the target is a business chosen by an admin (D13) |
| Login is never deleted (D3) | **Changes**: the login is **closed**, not deleted (D14 / UD-1) |

**Consequence:** admin delete can actually delete only after **B-1, B-2 and B-3**. Slice AD-1 (a read-only preview from the Businesses page) needs none of them and ships first (UD-9).

---

## 3. Decisions this requirement changes

These contradict the purge requirement. The owner approved D13 and D14 on 2026-10-04. The purge requirement itself is amended only after SA review (Appendix A).

| # | Existing decision | Change | Status |
|---|---|---|---|
| **D13** (new, amends **D5**) | "Caller's own session user only. No admin-purge-of-another-business in v1" | A **third surface**, `/admin/users`, may target **another** business. It is restricted to `requireAdmin`, and **any** admin may use it (UD-10). The target id comes from the route path, is validated with Zod as a UUID, and **never from the body**. The self-only rule (FR-2 / AC-28) **stays in force for the other two surfaces**. FU-4 is promoted into scope | ✅ **User-approved 2026-10-04** |
| **D14** (new, partial **D3** / FU-9) | `auth.users` and `profiles` are never deleted | The login is **closed**: sign-in disabled, sessions revoked, personal fields anonymised. **The email cannot be reused** for a new sign-up. The login is **not** hard-deleted, and financial records are kept (UD-1). Hard deletion stays FU-9, because ~23 `NO ACTION` FKs include ledger tables that must be kept | ✅ **User-approved 2026-10-04** |
| **OX-1** (operator exception, D3 / D14) | — | OX-1: operator-only hard delete of `auth.users` for accounts carrying the test marker (the email contains the test tag), by `scripts/test-account-cleanup-delete.sql`. Not a product path. D3, D14 and UD-1 are unchanged for every other account. Runbook: [TEST_ACCOUNT_CLEANUP_RUNBOOK.md](/docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md) | ✅ SA-approved 2026-10-06 |
| **OX-1r** (operator exception, D3 / D14, revises OX-1) | — | OX-1r: operator-only hard delete of `auth.users` for accounts whose email contains the test tag, run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`, both generated from the same builders. No other RPC, no other caller. Replaces the "no route may ever call it" part of OX-1. Requirement: [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md) §12 R-7 | ✅ SA-approved 2026-10-07 (re-ruling R-7) |
| **D15** (new) | The opt-in extras (integrations, agents, activity history) are off by default | On the admin surface: integrations are disconnected and AgentsPilot agents deleted. Activity history is kept, with the name removed when the account closes (UD-7) | Accepted default — user may revisit |
| **D15 amended** (2026-10-06, UD-14) | D15 above: "AgentsPilot agents deleted" | **AgentsPilot agents are KEPT** on the admin surface too (a purge never deletes agents: purge OQ-1 (c), 2026-10-05). The admin delete's fixed options are `integrations: true, agents: false, activityHistory: false` (SA amended SC-2); agents are listed under "what is kept" | ✅ **Decided by user 2026-10-06** |

---

## 4. User stories

- As a **platform admin**, I want to open a business on the Businesses page and see exactly what deleting it would remove and keep, so I can answer an erasure request without SQL.
- As a **platform admin**, I want the platform to refuse the delete when money is still moving (an active plan subscription, a Stripe Connect account, unpaid invoices, a friend-pays link) and to tell me what to resolve.
- As a **platform admin**, I want to confirm by typing the business's name, so I cannot delete the wrong row by mis-clicking.
- As the **product owner**, I want every admin deletion recorded: who did it, to which business, when, and what was removed. The owner of the deleted business must not be able to read the admin's notes.
- As a **platform admin**, I must not be able to delete my own account, or another admin's.

---

## 5. Delivery slices

Each slice is a few days and ships alone. AD-1 has no prerequisites. AD-2 onward wait for the purge prerequisites.

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **P (not this doc)** | B-1 key rotation, B-2 apply the held RPC (user, ops). B-3 purge **slice 3** incl. PR #45 reconciliation (purge requirement) | — | ops + purge slice 3 |
| **AD-1 — Preview from the Businesses page (read-only)** ✅ **approved to ship now (UD-9)** | A **Delete…** button in the expanded row, opening a dialog. A new admin route runs the existing preview for the **target**: per-area counts, storage counts, what is **kept** and why, and **every refusal reason** from §6.3 evaluated in advance. **Also: the `SchemaReconciler` and the classification pass (B-4, SC-7, SC-8)**, so the preview stops silently under-counting. No destructive code path. The confirm button is shown disabled, with "Deletion not yet available: [reason]" | D13 (approved), SA review | 🟡 ~2–3 d |
| **AD-2 — Delete the business's data** | The admin-targeted commit at **Purge** level: signed preview token (B-5 / AC-29, built so purge slice 5 reuses it), typed confirmation, re-checking every refusal right before commit, snapshot, advisory lock, write-ahead and outcome audit rows (`operator` class), result screen. Pending invites the target sent are revoked | P, AD-1 | 🟡 ~3 d |
| **AD-3 — Close the login** (in scope, UD-1) | Sign-in disabled and sessions revoked, `profiles` personal fields anonymised, audit-trail erasure called (archiving slice 3 capability, flushed), result names what was kept. Login **not** hard-deleted; the email stays taken. *Added 2026-10-06 (AD-2b, SA-2):* switch the dialog's kept lines (`DELETION_KEPT_CATEGORIES`: preferences, activity history, the login) and the result's login line back to "closed" wording, since AD-2 says the login stays open | AD-2 | 🟡 ~2 d |
| **AD-4 — Businesses with Stripe Connect** | Lifts AD-2's Connect refusal once the purge **slice 4** Stripe gate exists | Purge slice 4 | — (rides slice 4) |

**Recommendation.** Ship AD-1 now. It gives the owner the "what would this delete" answer and surfaces B-4 drift on prod with zero blast radius. Use AD-2 only on test accounts until AD-3 lands. A real customer whose data is wiped but who can still sign in lands in onboarding with no explanation.

---

## 6. Functional requirements

### 6.1 Surface

1. **FR-A1** A **Delete…** action appears in the expanded row on `/admin/users`, in a visually separated danger area. It does not appear in the collapsed row, to avoid mis-clicks.
2. **FR-A2** The dialog always runs the preview first and shows: business name, email, user id, joined date; per-area counts in plain language (contacts, bookings, invoices, website, files…) with a technical expander listing tables; **what is kept and why** (money ledger, unsubscribes, preferences, and the closed login); and every refusal (§6.3) with the action that clears it.
3. **FR-A3** If any refusal applies, **no confirmation input is offered** (purge §10.6.3).

### 6.2 Commit (AD-2 / AD-3)

4. **FR-A4** The target comes from the route path (`/api/admin/users/[id]/…`), validated with Zod as a UUID. Bodies are `.strict()` and carry **no** user id.
5. **FR-A5** The commit requires a **signed preview token** from the preview, bound to admin, target, level, options and expiry. Without a matching token it is rejected (AC-29).
6. **FR-A6** Typed confirmation: the admin types the target's **business name**, or the account email if there is none. It is compared server-side against a value the server looks up (same rule as the existing commit route). (UD-10)
7. **FR-A7** All §6.3 refusals are **re-evaluated immediately before the RPC**. Both evaluations are logged.
8. **FR-A8** The commit uses the **existing** engine (`purge_business_data`, snapshot, ordering, storage removal, advisory lock). **No second deletion path.** The slice-0 guard must keep passing.
9. **FR-A9** The result screen shows rows removed per area, storage removed or failed, what was kept, and the snapshot reference. The row then refreshes to show "No Business OS business" (AD-2) or "Account closed" (AD-3).
10. **FR-A10** (AD-3) Closing the login means: sign-in disabled, all sessions revoked, `profiles` personal fields anonymised, audit-trail erasure run for the user (with the audit queue flushed first), and the `business_os_billing_accounts` row and all financial records kept. The login row is **not** deleted and the email **cannot be reused** for a new sign-up (UD-1).

### 6.3 Refusals (protections)

Each refusal is a **hard block with no override**, evaluated in the preview and again before commit.

| # | Refuse when | Why |
|---|---|---|
| R-1 | Target = the acting admin | No self-delete from the admin console. Self-delete is the customer surface |
| R-2 | Target is in `admin_users` (by id **or** email, using `isAdmin({id,email})`) | Protects every admin, so "last admin" cannot arise. Removing an admin stays a manual SQL step (OQ-1 = B) |
| R-3 | Target has a **platform plan subscription** in a live state (`active`, `trialing`, `past_due`, `unpaid`, `paused`, or not yet ended) | Otherwise we keep charging a deleted business. Message points to the **Stripe dashboard** in the mode shown (test or live) and says in-app cancel arrives with plan-payments P-7a (cross-ref PF-14). *(SA 2026-10-04: no Business OS plan cancel exists on main; `/api/stripe/cancel-subscription` and `/api/payments/plans/[id]/cancel` are the wrong targets.)* No automatic cancel and no automatic refund (UD-3) |
| R-4 | **Any** friend-pays link, in **either direction**: the target pays for another business's plan, or another login pays for the target's plan (UD-4). **As built no cross-account payer exists (SA-7), so R-4 is evaluated and rendered as *not applicable*: "No cross-account payment relationship exists".** It stays in the list with a code comment. Any future slice that lets one login pay for another must wire R-4 in the same PR | Otherwise someone keeps paying for nothing. Today R-3 covers this on the target's own subscription |
| R-5 | Target has any Stripe **Connect** account | The existing slice-2 control (SA-S5), until AD-4 (UD-2) |
| R-6 | Local money-in-flight: C1 / C2 / C3 (active client subscriptions, pending payments or refunds, sent or overdue invoices) | The existing purge gate (§10.5) (UD-2) |
| R-7 | Another delete or purge for the same target is already running | Advisory lock (FR-28) |
| R-8 | The schema has a user-scoped table with no classification | AC-37 fails closed. The message tells the admin it is a platform problem, not something wrong with the business |

### 6.4 Audit

11. **FR-A11** A **write-ahead** audit row is written before the RPC, and an outcome row after it (success, partial storage residue, or failure). Blocked attempts are recorded too. Each row carries actor admin id, target id, business name, level, options, refusal or gate outcome, counts, snapshot path and timestamps, plus the correlation id from the preview. (UD-10: full audit)
12. **FR-A12** The rows use the **`operator`** entity class, so the deleted owner cannot read them (BD-26 / UC-9). Severity is `critical` for the commit and `warning` for blocked attempts. The rows are **not** removed by the activity-history option or by AD-3's erasure. The record that the account was deleted must survive.
    *Amended 2026-10-06 (UD-15, SA T-1 option A):* the rows are **admin-owned (operator-only by placement)** rather than an `operator` entity type: `user_id = actor_id = the admin`, `entity_type = 'user'`, `entity_id = the target`. The owner cannot read them on any path (every owner read keys on `user_id`), and AD-3's erasure (which selects the target's `user_id`) cannot reach them, so they survive by construction. No migration. Side effect accepted: an admin who also owns a business sees these rows in their own activity feed.
13. **FR-A13** No automatic email is sent to the deleted person in v1 (UD-8).

---

## 7. Non-functional requirements

- **Security:** `requireAdmin` is the first statement in every new handler (CI guard). Service-role use is documented in code. The delete RPC must not be applied before B-1. A target from the path plus an admin gate is a deliberate exception to FR-2; it is limited to `/api/admin/**` and needs SA sign-off under rule 7 (new pattern).
- **Tenant isolation:** the engine already scopes every delete to one id. The new risk is **a wrong id**. Typed confirmation against a server-side value plus the signed token are the controls. Use the `tenant-isolation-guard` skill.
- **Data retention:** financial records are kept unchanged (UD-5). The legal retention period is confirmed separately and does not block this work.
- **Performance:** the preview completes within the existing 60 s `maxDuration`. The dialog shows progress during the commit.
- **Logging:** Pino `createLogger`, with a correlation id carried from preview to commit. No PII in logs beyond ids.
- **Accessibility:** a keyboard-operable dialog. The blocked state is announced to assistive technology, not conveyed by colour alone.
- **Copy:** English (the admin console is English-only). Plain language first, table names behind an expander.

---

## 8. Acceptance criteria

**AD-1**
- [ ] AC-A1 A non-admin calling the admin preview route gets 403. An unauthenticated caller gets 401.
- [ ] AC-A2 The preview for a seeded test business returns non-zero counts and the kept-list. It deletes nothing (row counts are identical before and after).
- [ ] AC-A3 Each of R-1 to R-3, R-5, R-6 and R-8 is shown when it applies, each with its clearing action, and the confirm input is then absent. **R-4 always renders as *not applicable*** ("No cross-account payment relationship exists"), per SA-7.
- [ ] AC-A4 A malformed or non-UUID id gets 400 before any lookup. A body containing `userId` gets 400.
- [ ] AC-A5 On prod, after the classification pass (SC-8), the `SchemaReconciler` reports **zero unclassified tables and zero missing deletable (`reset` / `purge` / `optional:*`) tables**. Missing `never` tables are listed as limitations and do not block (SC-7). The AC-37c drift checks pass, and each new entry carries its review note. Re-measured just before merge.

**AD-2**
- [ ] AC-A6 A commit without a matching signed token is rejected. So is a token for a different target, level or options, and an expired token.
- [ ] AC-A7 A commit with a wrong typed name is rejected, and zero rows are deleted.
- [ ] AC-A8 A refusal that appears between preview and commit (e.g. a subscription activated) blocks the commit, and zero rows are deleted.
- [ ] AC-A9 After a commit, the purge requirement's AC-2, AC-4, AC-22, AC-23 and **AC-24 (a second business untouched)** pass for the target.
- [ ] AC-A10 Write-ahead and outcome audit rows exist with the `operator` class. The target owner's session cannot read them.
  - *Amended 2026-10-06 (UD-15):* read "with the `operator` class" as "**admin-owned** (`user_id` = the admin, entity = the target)". The test is unchanged: the rows exist, an admin can read them, the target owner's session cannot.
- [ ] AC-A11 Two concurrent commits for the same target: exactly one runs.

**AD-3**
- [ ] AC-A12 The closed login cannot sign in by any provider. Existing sessions are rejected on their next request. A new sign-up with the same email is refused.
- [ ] AC-A13 `profiles` personal fields are anonymised. Ledger and billing rows still exist and still sum to the same totals.
- [ ] AC-A14 The target's audit rows are anonymised by the archiving erasure, **except** the admin-delete rows.

**All slices:** happy path + auth failure + invalid input integration tests (CLAUDE.md § Testing). No `console.*`.

---

## 9. Decisions and open questions

### 9.1 Business decisions (owner, 2026-10-04)

| # | Question | Decision | Status |
|---|---|---|---|
| **UD-1** (Q-1) | What should "delete" leave behind? | **B: wipe the business and close the login.** Sign-in disabled, profile anonymised, email **not** reusable. Financial records kept. Hard deletion of the login is not done (FU-9) | ✅ Decided by user |
| **OX-1** | Does UD-1 stop an operator freeing a test email? | No. OX-1: operator-only hard delete of `auth.users` for accounts carrying the test marker (the email contains the test tag), by `scripts/test-account-cleanup-delete.sql`. Not a product path. D3, D14 and UD-1 are unchanged for every other account. Runbook: [TEST_ACCOUNT_CLEANUP_RUNBOOK.md](/docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md) | ✅ User-approved option A, 2026-10-06 |
| **OX-1r** | Can the admin Danger Zone free a test email? | Yes, for a test account only. OX-1r: operator-only hard delete of `auth.users` for accounts whose email contains the test tag, run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`, both generated from the same builders. No other RPC, no other caller. Replaces the "no route may ever call it" part of OX-1. Requirement: [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md) §12 R-7 | ✅ User decision 2026-10-07 (§8.1), SA-approved |
| **UD-2** (Q-2) | First version only for businesses without Stripe Connect and with no money in flight? | **Yes.** Others show "resolve first" until the Stripe gate (purge slice 4 → AD-4) lands | Accepted default — user may revisit |
| **UD-3** (Q-3) | Business paying us for a plan? | **Block until the plan is cancelled.** Point the admin to the existing cancel. No automatic cancellation, no automatic refund | ✅ Decided by user |
| **UD-4** (Q-4) | Friend-pays links? | **Block on any friend-pays link, in both directions**, until the link ends | ✅ Decided by user |
| **UD-5** (Q-5) | Financial records after deletion? | **Kept unchanged.** The legal retention period is confirmed separately and does not block this work | Accepted default — user may revisit |
| **UD-6** (Q-6) | Undo window? | **None**, the same as the customer delete. The preview and typed name are the safeguards; the 7-day snapshot is forensic, not a restore | Accepted default — user may revisit |
| **UD-7** (Q-7) | What is included by default? | **Disconnect integrations** and **delete AgentsPilot agents**. **Keep activity history**, with the name removed on account close (D15) | Accepted default — user may revisit |
| **UD-7 amended** (2026-10-06) | Agents | **Superseded for agents by UD-14: agents are kept.** Integrations disconnected and activity history kept, as above | ✅ Decided by user 2026-10-06 |
| **UD-8** (Q-8) | Automatic "account deleted" email? | **Not in v1.** The admin replies to the erasure request personally | Accepted default — user may revisit |
| **UD-9** (Q-9) | Sequencing | **Ship AD-1 (read-only preview) now.** Real deletion waits for the key rotation and purge slice 3 | ✅ Decided by user |
| **UD-10** (Q-10) | Who may delete? | **Any admin**, with typed business-name confirmation and a full audit record | ✅ Decided by user |
| **UD-11** | Customer-delete parity: should the customer's own "delete my account" (purge slice 5) also close the login, like the admin delete (D14)? | **Deferred until AD-3 ships.** Until then the customer self-delete stays as currently planned in the purge requirement: the login is kept (D3). **Not in scope for AD-1…AD-4**; D14 applies to the admin surface only | ⏸️ Deferred by user 2026-10-04 |
| **UD-12** (BQ-1, AD-2) | Once the key is rotated and the delete function installed, should admin delete switch on immediately? | **No: its own off switch.** `isAdminBusinessDeleteEnabled()` (server-only `ADMIN_BUSINESS_DELETE_ENABLED`, **default off**), checked before the commit token is verified (SA AC2-6). Even after the RPC is applied, admin delete stays off for real customers until "close the login" (AD-3) and the data export ship, and is then **flipped deliberately**. While off, the preview mints no commit token and the commit refuses `admin_delete_disabled`. Do not flip it on in prod to test it | ✅ **Decided by user 2026-10-06** |
| **UD-13** (BQ-3, AD-2) | Pending invites the deleted business sent: what about one a friend is **in the middle of signing up with**? | **Leave mid-signup invites alone**, and report how many in the result. All other pending invites are revoked (status update, `revoked_by_admin_id` set). **Accepted invites (friends who already joined) are never touched** | ✅ **Decided by user 2026-10-06** |
| **UD-14** (BQ-2, AD-2) | Does the admin delete keep AgentsPilot agents, consistent with purge OQ-1 (c)? | **Keep agents.** Amends D15 / UD-7 (see "D15 amended"). Agents appear under "what is kept" | ✅ **Decided by user 2026-10-06** |
| **UD-15** (BQ-4, AD-2) | Record the deletion on the **admin's** account (owner-unreadable, survives "close the login") instead of an `operator` entity type? | **Yes** (SA T-1 option A). FR-A12 / AC-A10 amended in place | ✅ **Decided by user 2026-10-06** |

### 9.2 Technical questions for SA

> All seven are answered in [SA Review Notes](#sa-review-notes) § Answers (2026-10-04).

- [x] **SA-1** PR #45 reconciliation (CASCADE from `business_profiles`): is it applied live, and does it bypass ordering and the snapshot? This is a precondition of purge slice 3.
- [x] **SA-2** Measure B-4: which live user-scoped tables are unclassified today, and does the prod preview already fail closed?
- [x] **SA-3** Shape of the admin-target exception to FR-2 (a separate route family vs a parameter on the existing service), and the signed-token design shared with purge slice 5.
- [x] **SA-4** `migration 20260928_contact_delete_handled_in_app.sql` may have changed trigger T1 / ordering constraint B4. Re-verify the ordering census.
- [x] **SA-5** How a login is disabled so that the email stays taken (Supabase auth ban vs app-level flag), and whether middleware and every sign-in provider honour it.
- [x] **SA-6** Classification of `business_os_billing_accounts`, credit lots and charges, and invite tables: `never`, or detach-only?
- [x] **SA-7** How R-4 detects friend-pays links in both directions from the plan-payments data model.

---

## 10. Out of scope / future roadmap

- Hard deletion of `auth.users` / `profiles`, with the email freed for re-sign-up (purge FU-9). Needs a ledger-detach design for ~23 `NO ACTION` FKs.
- Restore from snapshot (purge FU-5), and any undo or grace period (UD-6).
- Automatic cancellation of Stripe subscriptions, refunds, or voiding invoices (purge FU-1 / FU-1a; UD-3).
- An automatic notification email to the deleted person (UD-8).
- Bulk delete and scheduled clean-up of stale test businesses (purge FU-8).
- The customer self-service delete (purge slice 5). AD-2's signed token is built to be reused there.
- Replacing the temporary erasure contact address (tracked elsewhere, N2).

---

## 11. Notes on integration points

| System | Impact |
|---|---|
| `app/admin/users/page.tsx` + `components/` | Delete action and dialog (AD-1). The page is `'use client'`; data comes through admin routes only |
| `app/api/admin/users/[id]/…` (new) | Preview (AD-1), commit (AD-2), close (AD-3). `requireAdmin` first, registered in the admin authz census/guard |
| `lib/business-os/purge/` (`PreviewService`, `ResetService`, `descriptors.ts`, `purgeAuthz.ts`, `SnapshotWriter`) | Reused. Needs an admin-target entry point (SA-3) and the Purge level (purge slice 3) |
| `supabase/held/20260916b_purge_business_data.sql` | Must be applied (B-2) after the key rotation (B-1) |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | Must keep passing: no new deletion path |
| `business_os_billing_accounts`, plan payments, friend-pays | Refusals R-3 / R-4; existing plan cancel is where R-3 points |
| `lib/payments/stripeAccountContext.ts` | R-5 (`resolveUserConnectAccounts`) |
| `AdminAccessService` / `admin_users` | R-2, and the gate |
| `AuditTrailService` + `lib/audit/events.ts` | `BUSINESS_DATA_PURGED` / `_BLOCKED` reused or extended with an admin actor. `operator` class. Audit erasure from Admin Archiving slice 3 (AD-3) |
| Invites | Revoke the target's pending invites (AD-2) |
| `components/business-os/purge/DangerZonePanel.tsx` | Unchanged by this work. The customer surface stays "contact us" until purge slice 5 |

---

## Appendix A — splice text for the purge requirement

D13 and D14 are user-approved (2026-10-04). Apply this splice **only after SA review** of this requirement. Do not edit the purge doc before then.

**A.1 — §9 table, add after D12:**

> | **D13** | **Admin-targeted surface (amends D5)** | A third surface, `/admin/users`, may purge **another** business. Restricted to `requireAdmin` (any admin); target from the route path only; typed business-name confirmation and signed preview token mandatory. FR-2 / AC-28 remain in force on the other two surfaces. Promotes FU-4. User-approved 2026-10-04. See [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) | AD-1…AD-3 |
> | **D14** | **Account closure (partial FU-9)** | On the admin surface the login is closed (sign-in disabled, sessions revoked, profile anonymised, email not reusable), never hard-deleted; financial records kept. User-approved 2026-10-04 | AD-3 |

**A.2 — §0.4, add after slice 5:**

> ### Admin-targeted slices (AD-1…AD-4)
> Specified in [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) §5. AD-1 (read-only preview) depends on nothing here; AD-2 depends on slices 2 **and 3** and the held RPC; AD-4 rides slice 4. AD-2 builds AC-29's signed token, which slice 5 then reuses.

**A.3 — §10.11, FU-4 and FU-9 rows:** append "→ promoted by D13 / D14 (admin delete requirement)".

**A.4 — Change History row:** `| <date> | D13/D14 — admin-targeted delete | FU-4 promoted; FU-9 partially; user-approved 2026-10-04; see ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md |`

---

## SA Review Notes

**Requirement review by SA — 2026-10-04**
**Status:** ✅ **APPROVED WITH CONDITIONS.** AD-1 may go to Dev for a workplan now, under SC-1…SC-12 below. AD-2, AD-3 and AD-4 are approved **in shape only**, not to build: they wait on P (B-1, B-2, B-3) and on the design items in SA-1 and SA-5. The §9.1 business decisions stand. One is **technically vacuous as written** (UD-4 / R-4, see SA-7). That is a wording fix, not a reopening.

**Evidence.** Repo read on 2026-10-04: descriptors, PreviewService, ResetGuard, localPrecondition, BusinessPurgeRepository, the purge routes, all 200 migrations, and `accountDeletionPolicy.ts`. Live schema read the same day at 18:03 UTC by calling `purge_schema_introspect()` with the service role. That function is read-only (no DML, no DDL), and nothing was written to the database.

### Headline finding: the prod preview will **not** refuse, and that is the problem

The BA's B-4 worry is that the preview "may already refuse on prod". It cannot, because **the runtime fail-closed check was never built.** Purge workplan T7 (`SchemaReconciler`, AC-37) is still ⬜. Nothing in `lib/` or `app/` calls `purge_schema_introspect()`. `buildPurgePreview` counts the descriptor list and never compares it with the live schema. The failure mode today is therefore the reverse of "refuses": **the preview under-reports, silently.** Measured against prod:

| Measure | Result |
|---|---|
| Live tables with a `user_id` column (the RPC's `user_scoped_tables`) | 125, of which **2 are unclassified**: `insight_actions`, `auth_handoff_codes` |
| Add FR-1(iv)'s union predicate (an `owner_user_id` column **or** any FK to `auth.users`) | **7 more** are unclassified. All are actor columns on platform or config tables, not tenancy: `ais_scoring_weights`, `ais_system_config`, `exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events`, `shared_agent_imports`. The RPC never implemented the union predicate; it filters on `user_id` only |
| Descriptors that name a table that is **not live** | 3, all `never`: `intake_form_templates`, `website_templates`, `subscriptions`. AC-37's "expected table absent" rule would block on these |
| Migrations vs descriptors (repo-only check) | Same 2 tenant tables. The other 7 unknown `CREATE TABLE`s in migrations carry no `user_id` and need no descriptor |
| `insight_actions` | Business data (chase-invoice and follow-up actions aimed at clients). FK to `business_profiles` is **CASCADE**. It is the only cascade child of `business_profiles` that a purge run does not list (SA-1) |

**What AD-1 must include to fix this:** see SC-7 and SC-8.

### Answers to SA-1 … SA-7

| # | Answer |
|---|---|
| **SA-1** | **Applied live.** 56 FKs reference `business_profiles` and all 56 are `ON DELETE CASCADE` (measured). **The snapshot is not bypassed for classified tables**, because phase 1 snapshots every descriptor before the RPC. **There are two real defects, both in purge slice 3's scope, not AD-1's:** (a) any **unclassified** cascade child is deleted with no snapshot and no count. Today that is `insight_actions`. (b) `business_profiles` sits in the CONFIG band (700) and sorts alphabetically **before** `channel_connections`, `crm_pipeline_stages`, `marketing_consent_settings`, `payment_processors`, `stripe_connect_accounts`, `user_capabilities` and `user_intake_settings`, and before `crm_activities` (LAST, which also cascades). The cascade empties those tables first, so they report **0 rows removed**, and FR-A9 / purge AC-2 counts are wrong. **Slice 3 must:** move `business_profiles` to its own final band after `crm_activities` (its cascade then also clears the residue path), and add an invariant that every FK child of `business_profiles` is classified `reset` or `purge`. `accountDeletionPolicy.ts` (PR #45's second design, 55-table list) currently has only script and test consumers. Slice 3 must retire it or derive it from the descriptors; two registries is the root cause of the `insight_actions` drift. **Precondition of AD-2, not AD-1** |
| **SA-2** | Measured above: 2 unclassified tenant tables plus 7 under the union predicate, and 3 dead `never` descriptors. **The prod preview does not fail closed today, because no fail-closed check exists.** It would under-count `insight_actions` and not say so |
| **SA-3** | **A separate route family**, `app/api/admin/users/[id]/deletion/…` (preview in AD-1, commit in AD-2, close in AD-3). Not a parameter on the existing route. `buildPurgePreview` already takes `userId` as a parameter, so **no service change and no fork is needed.** The self-only rule lives in the existing routes, which stay untouched, so FR-2 / AC-28 hold for both existing surfaces by construction. Rule-7 new-pattern sign-off is given here, **scoped to `/api/admin/users/[id]/**` only**. **Signed token:** designed in the AD-2 workplan, not AD-1. Constraints: HMAC with a server-only key, and a missing key returns 500, never "no token needed" (purge workplan C-7). It binds admin id, target id, level, options, a gate version, and a **schema/descriptor fingerprint from the reconciler**, so a schema change between preview and commit voids it. TTL of 10 minutes or less, `timingSafeEqual` comparison, and the same module reused by purge slice 5. **AD-1 mints no token**: nothing would consume it, which matches the existing PreviewService note |
| **SA-4** | **Verified.** `20260928_contact_delete_handled_in_app.sql` drops `delete_future_bookings_on_contact_delete_trigger`. Live, `crm_contacts` has no BEFORE DELETE trigger (4 triggers: insert/update stamps and a subscriber link). **B4 no longer exists.** `TRIGGER_ORDERING` is now a stale but harmless extra constraint. Slice 3 retires it with a review note and corrects the `crm_contacts` / `scheduling_bookings` descriptor notes. The FK-edge census (B1, B2, B3, B6, B7) is unchanged as far as this measurement shows. Not AD-1 work |
| **SA-5** | Use a **Supabase Auth ban** (`auth.admin.updateUserById(id, { ban_duration })` with a very long duration), through a server-only auth-admin wrapper. The `auth.users` row stays, so **the email stays taken** without any app-level uniqueness logic, and GoTrue refuses new password, OTP / magic-link and OAuth grants and refresh for a banned user. **The ban alone is not enough:** access JWTs already issued stay valid until they expire. So AD-3 must also (i) revoke the user's sessions and refresh tokens, and (ii) **prove on a throwaway account** that `middleware.ts` (which calls `supabase.auth.getUser(accessToken)`) rejects the banned user. If it does not, an app-level "closed" check in middleware is mandatory. Invite flows (invite to an existing account, friend invites) must refuse a closed account's email. `auth.users.email` is **kept by necessity** and must appear in the result's "kept and why" list. ❓ Verified in the AD-3 workplan, not now |
| **SA-6** | **Already classified `never`** in `descriptors.ts` and the baseline: `business_os_billing_accounts`, `business_os_credit_charges`, `_credit_totals`, `_credit_lots`, `_credit_lot_draws`, `business_os_invites`, `business_os_account_lineage`. They stay `never` at every level. **Not detach-only in this feature:** D14 keeps the login, so `user_id` stays valid. The SET NULL detach applies only at FU-9 hard delete. AD-2's "revoke the target's pending invites" is an **UPDATE** to a status. It must not delete invite rows, and the slice-0 guard will catch it if it does |
| **SA-7** | **There is no cross-account payer in the as-built model.** "Friend pays" (invite 5c, plan-payments F2) means the **invited friend pays for their own plan**. `business_os_billing_accounts` has one `user_id` and no payer column, and lineage records who invited whom, not who pays. So neither direction of R-4 can occur today, and the risk UD-4 guards against ("someone keeps paying for nothing") is fully covered by **R-3** on the target's own subscription. **Ruling:** R-4 stays in the refusal list, is evaluated as *not applicable* ("No cross-account payment relationship exists"), and carries a code comment. Any future slice that introduces payer ≠ beneficiary must wire R-4 in the same PR. §1.4's 🧠 claim ("one login can pay for another business's plan") is incorrect and should be corrected (SC-11) |

### AD-1 conditions (all mandatory)

| # | Condition |
|---|---|
| **SC-1** | **Route:** `POST /api/admin/users/[id]/deletion/preview`. `requireAdmin` is the **first statement** in the handler. `[id]` is Zod `uuid()`, and an invalid id returns 400 before any lookup. Body is `z.object({}).strict()`, so `userId` or any other key returns 400. `runtime = 'nodejs'`, `maxDuration = 60`. Register the route in the admin authz census / caps **in the same PR** (the required `Admin authz surface guard` check) |
| **SC-2** | **Level and options are fixed server-side:** `purge`, `integrations: true`, `agents: true`, `activityHistory: false` (D15 / UD-7). The caller chooses nothing in AD-1 |
| **SC-3** | **Order of evaluation:** target exists (else 404, using a repository or auth-admin wrapper, no direct client in the route), then **R-1 and R-2 first**. R-2 uses `isAdmin({ id, email })` with the target's email looked up server-side. If R-1 or R-2 applies, return the refusal **without counting** (there is no reason to enumerate an admin's data). Otherwise call `buildPurgePreview({ userId: target })` and evaluate R-3…R-6 and R-8 |
| **SC-4** | **Every refusal is returned, not just the first.** `evaluateResetGuard` short-circuits, so do not reuse it as the evaluator. Reuse its **repository reads** and the `localPrecondition` condition data (purge's literal-subset rule) instead. Do not re-type status predicates, and leave ResetService's behaviour unchanged. **A failed read is a refusal** ("could not verify"), never a pass |
| **SC-5** | **R-3** reads through `BusinessOsBillingAccountRepository`, both `livemode` rows. "Live" means the status is in R-3's list, **or** `stripe_subscription_id` is set and `ended_at` is null. **No import from `lib/business-os/entitlements/`.** If the dialog wants to show the tier through that module, the import (type-only included) must be registered per the `business-os-entitlements` skill in the same PR |
| **SC-6** | **No `.from('<table>')` in `lib/business-os/purge/**`** (B-2 invariant). All reads go through repositories. Service-role use is documented at each repository call site. Nothing in the composition may import a Supabase client (B-1) |
| **SC-7** | **Build the `SchemaReconciler` (purge T7), read-only, and wire it into the admin preview as R-8.** It calls `purge_schema_introspect()` through `BusinessPurgeRepository` (already applied and service-role-only, so no migration). It applies FR-1(iv)'s union predicate **in TypeScript** over the returned `columns` + `foreign_keys` (no `public.users` exists today, so `references = 'users'` is unambiguous; assert that). An **unclassified** table, or a **missing `reset` / `purge` / `optional:*`** table, raises R-8. A **missing `never`** table is listed under limitations and **does not block**: it cannot lose data. This is an SA narrowing of AC-37 for `never` rows. It also removes the need to delete the 3 dead descriptors now. The result exposes a fingerprint for AD-2's token. Wiring it into the existing internal preview as well is allowed, but must not change that route's contract |
| **SC-8** | **Classification pass in the same PR** (adding a table is not drift, per FR-32). Add `insight_actions` as `reset`, LEAF, `user_id` scope, snapshot `rows`, with a note on its `business_profiles` CASCADE. Add `auth_handoff_codes` as `never` (ephemeral sign-in handoff, identity-level, not business data). Add the 7 actor-column tables as `never`, each noting it is an actor reference on platform data and that 4 of them (`exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events`) hold **NO ACTION** FKs to `auth.users` that FU-9 must handle. Extend `classification-baseline.json` with each entry and its review note. After that, AC-A5 means the reconciler reports **zero unclassified on prod**. Re-run the measurement just before merge |
| **SC-9** | **No destructive path:** no commit route, no token, no **destructive** RPC call. *(Clarified by SA workplan review 2026-10-04, D-2: the existing preview's existence probe on the held `purge_business_data` — null user id, empty table list, both pinned by tests — is allowed; a test proving no destructive method is called is mandatory.)* The confirm control renders disabled with its reason. The slice-0 `no-deletion-paths` guard and the descriptor invariant suite must stay green |
| **SC-10** | **Tenant isolation (read-only form):** the target comes only from the path. Every count stays equality-scoped to the target (`user_id = target`, `via` scopes through the parent's `user_id`), as `BusinessPurgeRepository` already does. Do not add a broader predicate. Logs carry **ids only** (no email, no business name) and a `correlationId`. Errors use the dev-only `details` guard. The response may show the target's email and business name to the admin (FR-A2) |
| **SC-11** | **Doc fixes before the workplan (BA):** correct §1.4's friend-pays claim, R-4's text and AC-A3 to say R-4 renders *not applicable* (SA-7). Reword AC-A5 to say the reconciler reports zero unclassified and zero missing deletable tables on prod. Reword B-4 to say the risk is silent under-counting, not refusal |
| **SC-12** | **Tests, with no added CI time:** Jest only, inside the existing sharded gate, with no new workflow and no DB in CI. Route integration tests: 401, 403, 400 (non-UUID id, body containing `userId`), 404, happy path. Reconciler unit tests on a fixture JSON: unclassified, missing deletable, missing `never`, union predicate. Refusal-evaluator unit tests: one per R, read-failure refusal, R-4 not applicable. AC-A2's "nothing deleted" is proved by the absence of any delete call (mocked repository) **plus** QA's manual check on prod against a throwaway account. The UI (`'use client'` page, 0 `console.*` today) fetches through the admin route only. The dialog is keyboard-operable, and the blocked state is announced to assistive technology |

### Notes for AD-2 / AD-3 (not conditions on AD-1)

- AD-2 is blocked on B-1, B-2 and B-3 (including the SA-1 band and invariant fixes and retiring or aligning `accountDeletionPolicy.ts`), and on the token design in SA-3. The audit uses the `operator` class, written **awaited and flushed** before the response (WC-7 pattern), because the audit queue only enqueues. Re-evaluate every refusal **and the reconciler fingerprint** immediately before the RPC.
- AD-3 is blocked on AD-2 and on the SA-5 proof. Audit erasure must exclude the admin-delete rows (AC-A14). Flush the audit queue before erasure.
- UD-11: customer-delete parity is deferred until AD-3 ships. Nothing in AD-1…AD-4 may change the customer surface or D3.

### Optimisation suggestions (non-blocking)

- A non-blocking `operator`-class info audit row for "admin opened a deletion preview" would make the later commit trail complete. It is optional in AD-1.
- `purge_schema_introspect()` returns the whole catalogue. That is fine for a manual admin action. Do not call it on page load; call it only when the dialog opens.

### Approval
[x] Requirement approved with conditions. AD-1 → Dev workplan after the SC-11 doc fixes. Appendix A splice may now be applied to the purge requirement by BA (not by SA).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created (BA, draft) | Discovery: the admin Businesses page had a delete button removed for being unauthenticated. The customer delete is a "contact us" panel. The purge engine is parked (Reset inert pending key rotation; Purge blocked on PR #45). Proposes D13 (admin target, amends D5) and D14 (account closure), refusals R-1…R-8, slices AD-1…AD-4, and 10 business questions |
| 2026-10-04 | Owner answers recorded; **Ready for SA review** | Decided by user: UD-1 (Q-1 = B, wipe and close the login, email not reusable, financial records kept), UD-3 (block until plan cancelled, existing cancel, no auto-refund), UD-4 (block on any friend-pays link, both directions), UD-9 (ship AD-1 now), UD-10 (any admin, typed business-name confirmation, full audit). Accepted defaults, user may revisit: UD-2, UD-5, UD-6, UD-7 (D15), UD-8. D13 and D14 marked user-approved. Purge requirement **not** edited; the Appendix A splice is applied after SA review. Added FR-A13 (no email), SA-7 (friend-pays detection) |
| 2026-10-04 | **SA requirement review: APPROVED WITH CONDITIONS** | Answered SA-1…SA-7 (repo plus a read-only live call to `purge_schema_introspect()`, nothing written). Headline: the prod preview does **not** refuse, because the runtime AC-37 check (purge T7 `SchemaReconciler`) was never built. It silently under-counts: 2 unclassified tenant tables (`insight_actions`, `auth_handoff_codes`), 7 more under FR-1's union predicate, and 3 dead `never` descriptors. PR #45's 56 CASCADE FKs are live; the slice-3 band and invariant fix is noted. B4 trigger confirmed dropped. R-4 is vacuous as built (no cross-account payer), so it renders not applicable. AD-1 → Dev workplan under SC-1…SC-12 (incl. building the reconciler and the classification pass in AD-1). AD-2…AD-4 approved in shape only. Appendix A splice released to BA |
| 2026-10-04 | UD-11 recorded (deferred) | User decision relayed by the coordinator: the customer self-delete stays as planned (login kept, D3). Whether it should also close the login like D14 is decided **after AD-3 ships**. Out of scope for AD-1…AD-4 |
| 2026-10-04 | SC-11 doc fixes (BA) | §1.4's friend-pays claim corrected (no cross-account payer as built, SA-7). R-4 and AC-A3 now say R-4 renders *not applicable*. AC-A5 reworded: the reconciler reports zero unclassified and zero missing deletable tables on prod. B-4 and the AD-1 row reworded: the risk is silent under-counting, not refusal. Appendix A splice applied to the purge requirement (D13, D14, §0.4, §0.10, FU-4, FU-9, Change History) |
| 2026-10-04 | SC-9 and R-3 wording (SA workplan review) | SC-9 = no *destructive* RPC; the held-RPC existence probe is allowed (D-2). R-3's clearing action points to the Stripe dashboard until plan-payments P-7a ships an in-app cancel (cross-ref PF-14). AD-1 split into AD-1a/1b/1c, one PR each (workplan SA section) |
| 2026-10-04 | AD-1a code complete (Dev) | SchemaReconciler (purge T7, read-only half) and the SC-8 classification pass built on `feature/admin-delete-ad1a-reconciler`, uncommitted. 9 tables classified (`insight_actions` reset; `auth_handoff_codes` and 7 actor-reference tables never), baseline 135 → 144 with review notes. AC-A5 measured on prod (read-only): `ok`, 0 unclassified, 0 missing deletable, 3 missing `never` listed (non-blocking). B-4's silent under-count of `insight_actions` is closed for the descriptor set; R-8 wiring lands in AD-1b. Re-measure before merge |
| 2026-10-04 | AD-1b code complete (Dev) | Refusal evaluator (R-1…R-8, every refusal returned, failed reads `unverified`, R-4 not applicable, R-7 deferred), the admin preview composition and `POST /api/admin/users/[id]/deletion/preview` (`requireAdmin` first, path uuid, strict empty body, fixed Purge level and options) built on `feature/admin-delete-ad1b-preview-route`, uncommitted. R-2 uses the new read-only tri-state `checkAdminStatus` (SA D-3); the target's identity comes from `AuthAccountRepository.findUserIdentity` (D-1). R-3's clearing action points to the Stripe dashboard in the mode shown until P-7a. Registered as admin authz row 97. The user-added "admin opened a deletion preview" audit row (`BUSINESS_DELETION_PREVIEWED`) is written against the admin's own id, not as an `operator`-class row: that class needs an owner-policy migration, left to AD-2 for SA |
| 2026-10-05 | AD-1c code complete (Dev) | The **Delete…** button in a separated danger area at the bottom of the expanded row on `/admin/users` (FR-A1), opening a read-only dialog that POSTs `{}` to the AD-1b preview route each time it opens. Shows business name, email, user id, joined date; per-area counts in plain language (uncounted = "unknown", never 0) with a technical table expander; what is kept and why; every refusal with its clearing action (R-4 "Not applicable", R-7 "Checked at the moment of deletion"). No confirmation input; the confirm button is always disabled with "Deletion not yet available: [reason]" (FR-A3, SC-9). Built on `feature/admin-delete-ad1c-dialog`, stacked on AD-1b, uncommitted. AD-1b follow-ups carried: R-6's thrown-read reason is a fixed string (QA Low-1). AC-A2 live half and the rendered AC-A3 owe QA's manual prod check |
| 2026-10-05 | AD-1 complete; next steps | AD-1a #216, AD-1b #220, AD-1c #222 merged (stacked #221 merged into the AD-1b branch by mistake; #222 re-landed the same commit). User deferred the key rotation (B-1); purge slice 3 starts next, built with its RPC held. Data export requirement added and scheduled after AD-2…AD-4 |
| 2026-10-06 | AD-2a: business decisions recorded; AD-2 in progress, inactive | User answers to the AD-2 workplan's BQ-1…BQ-4, recorded as **UD-12** (own off switch `ADMIN_BUSINESS_DELETE_ENABLED`, server-only, default off, checked before the token; stays off for real customers until AD-3 + the data export; flipped deliberately), **UD-13** (mid-signup invites left alone and counted; accepted invites never touched), **UD-14** (agents kept; amends D15 / UD-7, SA amended SC-2 to `agents: false`) and **UD-15** (admin-owned audit rows, SA T-1 option A; FR-A12 / AC-A10 amended). AD-2a (server commit path) code complete on `feature/admin-delete-ad2-commit`, uncommitted, per [ADMIN_DELETE_AD2_COMMIT_WORKPLAN.md](/docs/workplans/ADMIN_DELETE_AD2_COMMIT_WORKPLAN.md); inactive (off switch + held RPC), nothing in `supabase/migrations/` changed |
| 2026-10-06 | AD-2b code complete (Dev) | The Delete… dialog offers the typed confirmation (FR-A6: business name, else account email) only when the preview returned a commit token and nothing blocks (FR-A3); Delete enables on a match (server normalisation; the server re-checks) and POSTs `{ token, confirmText }`. Result screen (FR-A9): rows per area, storage removed / still stored, invites revoked and mid-signup left alone (UD-13) or "unknown", what was kept incl. agents (UD-14), audit recorded yes/no, snapshot reference; every refusal one plain sentence, an unconfirmed outcome says the result is not known. The row refreshes when the dialog closes. Inactive: with the switch off (UD-12) no token is minted, so no input appears. Per [ADMIN_DELETE_AD2_COMMIT_WORKPLAN.md](/docs/workplans/ADMIN_DELETE_AD2_COMMIT_WORKPLAN.md) |
| 2026-10-06 | OX-1 operator exception noted (insert-only) | Operator test-account cleanup (SA approval of TEST_ACCOUNT_CLEANUP_SCRIPT_WORKPLAN.md, TQ-1): pasted SQL may hard-delete `auth.users` for a test account only. Rows added after D14 and after UD-1. No existing text changed |
| 2026-10-07 | OX-1r noted (insert-only) | SA re-ruling R-7 of TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md: the same generated cleanup logic may also run from the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`. Rows added after the OX-1 rows next to D14 and UD-1. No existing text changed |
