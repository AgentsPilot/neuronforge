# Requirement: Admin Cleanup for Business OS

> **Last Updated**: 2026-10-02

**Created by:** BA
**Date:** 2026-10-02
**Status:** Draft. The scope below was approved by the user on 2026-10-02. The slice order (§6) is a **proposal for the user to confirm**. Technical assumptions (§10) are for SA to confirm.
**Follows:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) (slices 1–5 shipped). Roadmap items cited here (R-3, R-6, R-18, R-20) are defined in its §8.

## Overview

The admin reorganisation put Business OS (BOS) first in the sidebar. It did not change what the pages say or do. On 2026-10-02 the main session reviewed all 27 admin pages. Several visible pages still show AgentsPilot (AP) data, read tables or columns that do not exist, or claim things that are false. The most serious case is the **Admin users** page: it "adds admins" to a store that grants nothing. This requirement covers the cleanup the user approved, as small slices that each ship alone. The look does not change (D-4), and no AgentsPilot page is deleted (D-3).

---

## Table of Contents

1. [Decisions this requirement rests on](#1-decisions-this-requirement-rests-on)
2. [Verification of the review's claims](#2-verification-of-the-reviews-claims)
3. [New findings from verification](#3-new-findings-from-verification)
4. [Scope: requirements per page](#4-scope-requirements-per-page)
5. [Effort, impact and BOS impact](#5-effort-impact-and-bos-impact)
6. [Proposed slice order (for the user to confirm)](#6-proposed-slice-order-for-the-user-to-confirm)
7. [User stories](#7-user-stories)
8. [Non-functional requirements](#8-non-functional-requirements)
9. [Acceptance criteria](#9-acceptance-criteria)
10. [Technical assumptions (for SA to confirm)](#10-technical-assumptions-for-sa-to-confirm)
11. [Deferred and backlog items (in this area, not in a slice yet)](#11-deferred-and-backlog-items-in-this-area-not-in-a-slice-yet)
12. [Related items, not in this slice](#12-related-items-not-in-this-slice)
13. [Out of scope](#13-out-of-scope)
14. [Open questions](#14-open-questions)
15. [Notes on integration points](#15-notes-on-integration-points)
16. [SA Review — slices 1 and 5a (2026-10-02)](#sa-review--slices-1-and-5a-2026-10-02)
17. [Change History](#change-history)

---

## 1. Decisions this requirement rests on

Decisions carried over from the reorganisation requirement (§1):

| # | Decision | How it applies here |
|---|---|---|
| D-1 | There are two platform admins, both technical owners. | Plain wording is fine. No support-staff workflow is needed. |
| D-2 | The job is to monitor, find issues, and adjust a customer's plan or credits. | This drives the Businesses, Plans & entitlements and queue-action work. |
| D-3 | AgentsPilot pages are parked. **No code is deleted.** | AP sections that move go to the hidden parked group. Their routes stay. |
| D-4 | **The look stays.** Colours, fonts and components do not change. | Every slice reuses existing admin components and styles. |
| D-5 | Every item gets an effort (S/M/L) and an impact (High/Med/Low). | See §5. |
| D-6 | Slices are incremental and each ships alone. | See §6. |

New user decisions (2026-10-02, relayed by the main session):

| # | Decision |
|---|---|
| UC-1 | The ten recommendations in §4 are approved as scope. |
| UC-2 | **Messages is kept for now.** Its defects are backlog items, not scope (§11). |
| UC-3 | The entitlements **shadow report and launch dry run are low priority**. They are deferred and are not part of the entitlements write slice (§11). |
| UC-4 | **Items that affect the Business OS app come first.** The user sets the final priority after reading this document. |

---

## 2. Verification of the review's claims

I checked each claim against the code on `main` (`34d665b4`) on 2026-10-02. **Nothing has been checked against the live database.** Any table or column below marked "phantom" is a code reading. Dev or SA must confirm it with the `business-os-schema-check` skill before relying on it.

| # | Claim | Result | Evidence |
|---|---|---|---|
| V-1 | AI cost & usage shows the Creation, Execution and Memory category cards, even in BOS scope | ✅ Verified | `app/admin/analytics/page.tsx:695-780` (the System card is at `:782-809`). No `scope` condition. |
| V-2 | The page offers "Agent" and "Execution" group-bys | ✅ Verified | `BREAKDOWN_OPTIONS`, `page.tsx:161-172`. No `scope` condition. |
| V-3 | The drill-down reads `workflow_executions.input_data` | ✅ Verified in code. **Phantom status: to verify (Dev/SA).** | `app/api/admin/token-usage/drill-down/route.ts:993-997`. The error is not checked, so a failed read leaves the execution detail empty without any message. |
| V-4 | The audit-trail route reads `.from('users')` for `full_name` and swallows the error | ✅ Verified in code. **Phantom status: to verify (Dev/SA).** | `app/api/admin/audit-trail/route.ts:182-189`. On error, `usersMap` silently stays empty. |
| V-5 | The audit-trail search placeholder mentions agents | ✅ Verified | `app/admin/audit-trail/page.tsx:573`: "Search by agent, user email, or name..." |
| V-6 | The archiving page header says runs cannot happen yet, but runs are on | ✅ Verified | `app/admin/archiving/page.tsx:14-22` ("Starting a run, and why it cannot happen yet"). `lib/archiving/config.ts:64`: `ARCHIVE_RUNS_ENABLED = true`. |
| V-7 | The archiving confirm dialog copy is accurate | ✅ Verified accurate while runs are on | `app/admin/archiving/components/ArchiveConfirmDialog.tsx:86-140`. "Not switched on yet" appears only when runs are off. The dialog's own header comment (`:11-13`) is written conditionally and is still true. **Only the page header comment is stale.** |
| V-8 | The Businesses detail has a collapsed "AgentsPilot details" section | ✅ Verified | `app/admin/users/page.tsx:951-956` onwards (agents, executions; token-by-model and plugins follow in the same fold, to verify by Dev). |
| V-9 | The Businesses stats route reads `agent_executions.total_tokens_used` and `user_subscriptions.plan_name` | ✅ Verified in code. **Phantom status: to verify (Dev/SA).** | `app/api/admin/users/[id]/stats/route.ts:56` and `:72`. |
| V-10 | A stale comment on the Businesses page says the admin surface is unauthenticated | ✅ Verified | `app/admin/users/page.tsx:408-411`. This is false since 2026-09-21: the admin layout guard and `requireAdmin` cover every page and route ([ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md)). |
| V-11 | The entitlements POST supports 7 audited operations with a reason | ✅ Verified | `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts:177-263`. The op union lives in `lib/business-os/entitlements/adminOps.ts`. The route writes an audit row with `details.reason` and flushes it before responding. **To verify (Dev):** that `reason` is mandatory and non-empty in `adminOpSchema` for all 7 ops. |
| V-12 | Messages: the page posts to `.../reply`, but the route folder is `replay` | 🟡 Partly verified | The route is `app/api/admin/messages/[id]/replay/route.ts`. The page's fetch path is **to verify (Dev)**. |
| V-13 | Messages: sending email is a TODO | ✅ Verified | `replay/route.ts:69-73` |
| V-14 | Nothing posts to `/api/contact` | 🟡 To verify (Dev) | `app/api/contact/route.ts` exists. Its callers were not searched. |
| V-15 | `ai_model_pricing` drives BOS cost and credit reports | ✅ Verified | `lib/business-os/llm/modelOptions.ts:33` (via `listPricedModels`). The sync route header says the table is the one "every credit charge is computed from" (`pricing/sync/route.ts:34-35`). |
| V-16 | "Sync" does not fetch anything. It writes a hard-coded catalogue. | ✅ Verified | `app/api/admin/system-config/pricing/sync/route.ts:49-51` ("Complete pricing catalog - June 2026"). **The page says the opposite:** `app/admin/system-config/page.tsx:350` reads "since it fetches from external API". |
| V-17 | The pricing page has about 20 `console.*` calls | ✅ Verified (at least 19) | 19 calls in `page.tsx:1-400` alone. Dev counts the full file. |
| V-18 | Boost packs, pilot credit cost, calculator config and grace period are AgentsPilot | 🟡 Mostly verified | Boost packs: yes. The BOS top-up packages are configuration in code with no admin UI in v1 ([credits boost requirement](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) §3, FR-1/FR-2), and the AP boost checkout is being retired (FR-40). Calculator: yes (agent runs, plugins). **Grace period (`payment_grace_period_days`) and pilot credit cost: which code reads them is to verify (Dev).** If any BOS path reads one of them, that setting stays in Settings. |
| V-19 | The `free_tier_*` keys are not read by BOS | 🟡 To verify (Dev) | The keys are confirmed in `app/api/admin/onboarding-config/route.ts:31`. Their readers were not searched. Moving the page is a sidebar change only, so the move is safe either way. |
| V-20 | The Admin users page writes `system_settings_config.admin_users`, which grants nothing | ✅ Verified | `app/api/admin/settings/admin-users/route.ts:8-18` says so itself. Real access is the `admin_users` table via `AdminAccessService` ([ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) OI-2b). |
| V-21 | The page's GET bootstraps the caller as super_admin when the list is empty | ✅ Verified, with a qualification | `admin-users/route.ts:56-98`. The GET **writes** (upserts) the caller as `super_admin`. Since 2026-09-21 only an admin can reach it, and it writes to the store that grants nothing. **So it cannot grant anyone access today.** It is still a GET that writes, and it makes the page look populated and authoritative. |
| V-22 | HelpBot's `helpbot_embedding_model` is used by BOS chat | ✅ Verified | `lib/services/EmbeddingService.ts:111-115, 168-172`. The warning is at `lib/business-os/llm/modelSettingsPolicy.ts:84-88`. |
| V-23 | UI config's `v2_custom_tokens` styles all of `/business-os` | ✅ Verified | `lib/design-system-v2/theme-provider.tsx:62-69`. It wraps BOS at `app/business-os/layout.tsx:68`. |
| V-24 | There are 27 admin pages, and 11 parked AP pages besides HelpBot and UI config | ✅ Verified | 26 `app/admin/*/page.tsx` files plus `/admin`. The hidden parked section has 13 entries (`AdminSidebar.tsx:192-278`). |

---

## 3. New findings from verification

These came up while checking the claims. They change how the slices are scoped.

| # | Finding | Consequence |
|---|---|---|
| NF-1 | **A phantom column fails the whole read, not just that column.** PostgREST rejects the entire `select` if one named column does not exist. | If V-9 is confirmed, the stats route returns **no executions and no subscription at all**, not just a missing field. The same applies to V-3 (no execution detail) and V-4 (no names on any audit row). The defects are bigger than "one field is blank". |
| NF-2 | **The "Sync" button can change what every BOS customer is charged.** It overwrites the pricing table with a June 2026 catalogue built into the code and re-stamps every effective date. The page tells the operator it fetches live prices. | This is the most money-relevant item in the review. Its wording is in scope (FR-PR3). Whether to keep the button is a business question (OQ-2). |
| NF-3 | **The AI cost execution detail sends AgentsPilot owner text to the browser.** `drill-down/route.ts:1002-1020` returns each agent's `user_prompt` and `system_prompt`, and `:1147-1148` returns execution input and output, for any account. | This conflicts with the reorganisation's rule that cross-account admin reads show metadata only (§9 there). The data is AP, and the BOS lens hides the path (FR-AC2). Whether to strip it from the route is for SA (TA-8). |
| NF-4 | **The real `admin_users` table has no role.** All admins are equal (`is_active` only). The current page offers "admin" and "super_admin". | If the page is pointed at the real table (option A, §4.10), the role picker goes away. This is a visible change for the user. |
| NF-5 | **User lookups by email may only see the first page of users.** `auth.admin.listUsers()` is called with no paging in the admin-users, platform-users and drill-down routes. Supabase returns one page by default (to verify (Dev): the page size). | "Add admin by email" may fail to find a real user once there are more users than one page. Any new admin write should use `AdminUserRepository.upsertByEmail`, which is keyed on email and needs no user list (TA-5). |
| NF-6 | **The Messages reply route logs the customer's email address and the reply text** with `console.log` (`replay/route.ts:72`). It saves `admin_id: 'admin-user-id'`, a placeholder (`:48`). It also records `email_sent` as whatever was requested, although no email is sent (`:63`). | Added to the Messages backlog item (§11). Not in scope (UC-2). |
| NF-7 | In BOS scope, BOS rows probably fall into the **System** card. The category classifier uses AgentsPilot categories (`drill-down/route.ts:1161-1300`), and BOS rows match none of them. | If that is true, hiding only Creation, Execution and Memory leaves a System card that repeats the Total. Dev measures this; SA decides (TA-7). |
| NF-8 | The Businesses detail shows "Role: {profiles.role}" with a shield icon (`users/page.tsx:839-845`). `profiles.role` is a persona label, not access. | It could be misread as admin status. It is offered as an optional relabel in slice 5a (FR-BU6). |

---

## 4. Scope: requirements per page

Each page lists what changes, its effort, impact and BOS impact, and what to verify first. Line numbers are from `main` `34d665b4`.

### 4.1 Monitor → AI cost & usage (`/admin/analytics`)

**Why:** in "Business OS only" scope (on by default, U-4), the page still invites the operator into agent categories, agent and execution group-bys, and an agent execution detail. None of these mean anything for BOS. The execution detail also exposes AgentsPilot owner text (NF-3).

| ID | Requirement |
|---|---|
| FR-AC1 | In BOS scope, hide the **Creation, Execution and Memory** category cards. With "All" scope they stay as they are. |
| FR-AC2 | In BOS scope, hide the **Agent** and **Execution** group-bys, the Agent and Execution filter chips and breadcrumbs, and the execution detail view. With "All" scope they stay as they are. |
| FR-AC3 | Switching to BOS scope while an agent or execution filter or group-by is active clears it, with no error and no blank page. |
| FR-AC4 | A hand-edited URL cannot bring the hidden views back in BOS scope (TA-6). |
| FR-AC5 | **R-20:** the execution detail no longer asks for `workflow_executions.input_data` (or any other column the schema check finds missing). An "All" scope execution detail shows its timing and status again. |
| FR-AC6 | A failed execution-detail read is logged, not silently ignored. |

**Effort** S–M · **Impact** Med · **BOS impact:** changes what a BOS operator sees (less noise, no AP owner text). FR-AC5 itself is AP cleanup.

### 4.2 Monitor → Scheduled jobs & queues (`/admin/jobs-queues`): queue actions (R-18)

**Why:** today the page is read-only. When a client message dead-letters, or a queue item is stuck, the only fix is SQL. R-18 is **required before launch**.

| ID | Requirement |
|---|---|
| FR-Q1 | For each of the five §8.1 queues, an admin can act on **one item at a time**: **retry** a dead-lettered or failed item, **release** a stuck in-progress item, and **cancel** a waiting, failed or dead-lettered item. |
| FR-Q2 | An admin can press **"Drain now"** for one queue. It runs the same drain the cron runs, through the same claim path, never around it. |
| FR-Q3 | **Every action requires a written reason** and writes one audit row: actor, queue, item, action, before status, after status, reason. Like the entitlements writes, the audit row is flushed before the response. |
| FR-Q4 | **No action can cause a double send.** An action changes an item only if it is still in the state the admin saw (for example, "retry" does nothing if a drain has picked the item up meanwhile). The admin is told that the item changed under them. SA reviews this against the `durable-queue-drain` skill and the §8.1 claim pattern (TA-9). |
| FR-Q5 | To act, the page must list individual items. The list shows **metadata only**: queue, item id, status, attempts, due time, claim time, age, the business name, and whether the item is dead-lettered. **Never** payload, recommendation, error message, skip reason, or any client name, address or message text. This keeps slice 5's rule (§S5.7 there). |
| FR-Q6 | Retry respects the business rule for old items in OQ-3 (suggested: a client message more than 72 hours past its due time can be cancelled but not retried). |
| FR-Q7 | After any action, the page and the Health tiles show the new counts on the next refresh. |

**Effort** M–L · **Impact** Med now, **High at launch** · **BOS impact:** changes what BOS customers' clients receive (reminders, lead replies, briefings, insight actions). This is the only item in this document that can send a message to a real client.

### 4.3 Monitor → Audit trail (`/admin/audit-trail`)

| ID | Requirement |
|---|---|
| FR-AT1 | **R-20 / OI-18:** user names appear on audit rows. The route stops reading the `users` table and gets names from a source the schema check confirms (TA-10). |
| FR-AT2 | A failed name lookup is logged and the page still loads. It must never swallow the error silently again. |
| FR-AT3 | The search placeholder describes what search actually matches, without "agent". The proposed text is "Search by email, name, action or ID…". Dev confirms it against the route's search fields (`route.ts:155-170`). |

**Effort** S · **Impact** Med · **BOS impact:** changes what a BOS operator sees. Names on rows matter when investigating a business's complaint.

### 4.4 Monitor → Archiving (`/admin/archiving`)

| ID | Requirement |
|---|---|
| FR-AR1 | Correct the page header comment (`page.tsx:14-22`) to say runs are on, what switches them off (`ARCHIVE_RUNS_ENABLED`), and what the page does when they are off. |
| FR-AR2 | No change to the confirm dialog. Its copy was checked and is accurate while runs are on (V-7). |

**Effort** XS · **Impact** Low · **BOS impact:** none visible. It is a code-comment fix that prevents a wrong belief about the most destructive button in admin.

### 4.5 Businesses → Businesses (`/admin/users`): toward Business 360 (R-3)

Scoped as numbered sub-slices. **5a is the cleanup. 5b onward are proposals the user picks from, one at a time.**

**5a: cleanup**

| ID | Requirement |
|---|---|
| FR-BU1 | Remove the collapsed **"AgentsPilot details"** section from the Businesses detail: agents, agent executions, plugins and token-by-model (`page.tsx:951` onward). The user approved this on 2026-10-02. The API route stays (D-3). |
| FR-BU2 | **R-20:** the stats route stops asking for `agent_executions.total_tokens_used` and `user_subscriptions.plan_name`, or for any other column the schema check finds missing. |
| FR-BU3 | Fix the stale comment at `page.tsx:408-411`. The admin surface is guarded (V-10). |
| FR-BU4 | The page states plainly that the list holds **every login**, not only businesses. Rows with no business already say "No Business OS business" (U-1). |
| FR-BU5 | If removing the fold leaves nothing on the page that reads the stats route, the page stops calling it. Dev reports which. |
| FR-BU6 | *(Optional, Dev's call within 5a)* Relabel "Role" as "Persona (from profile)" so it cannot be read as admin status (NF-8). |

**Proposed 360 sub-slices (each S–M, user picks the order)**

| Sub-slice | What the operator gets | Reuses | Effort |
|---|---|---|---|
| 5b | A **"Businesses only / All logins"** toggle, defaulting to Businesses only (OQ-5), with a count of each | The business name the list already joins (slice 2b) | S |
| 5c | **Outbound delivery for this business:** reminders, briefings, lead replies and insight actions, sent, failed and dead-lettered over 7 and 30 days. Counts only. Links to the queue page. | The five queue tables and the slice 5 counting rules (overlaps R-15) | M |
| 5d | **Activity counts:** bookings, invoices (by currency, never summed across currencies), contacts, over 30 days | Existing BOS repositories | M |
| 5e | **Credits:** plan allowance, balance and a link to the credit diary for this business | Credit deduction ledger and diary (credit deduction slice 7 and later); read-only | S–M, **depends on the credit diary shipping** |

**Effort** 5a: S · **Impact** Med (5a), High (R-3 overall) · **BOS impact:** changes what a BOS operator sees when a business complains.

### 4.6 Businesses → Plans & entitlements (`/admin/business-os-tiers`): write UI (R-6)

| ID | Requirement |
|---|---|
| FR-EN1 | After an account lookup, the page offers the **7 existing operations**: `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state`. Each calls the existing `POST /api/admin/business-os/entitlements/accounts/[accountId]`. **No new write route.** |
| FR-EN2 | Every operation requires a **reason**. Submit stays disabled until one is entered. The server refuses an empty reason too (V-11). |
| FR-EN3 | Before submitting, a confirm step shows the account, the operation and what will change, in plain words. After success, the page reloads the account's entitlements so the admin sees the result. It says the change applies within the cache window the API returns (`effectiveWithinSeconds`). |
| FR-EN4 | A refused operation (404 not a BOS account, 409, invalid body) shows the server's reason in plain words. Raw error text is never shown. |
| FR-EN5 | Destructive operations (`reset_plan_state`, `end_override`) use a stronger confirm that names the account. |
| FR-EN6 | The banner about the entitlements mode stays and stays accurate. Production runs **shadow** on purpose (OQ-8 there): a change is recorded and logged, but blocks nothing until enforce. |
| FR-EN7 | The sidebar description changes from "Business OS plans, read-only" to match. |
| FR-EN8 | Any import from `lib/business-os/entitlements/`, type-only included, follows the `business-os-entitlements` skill's registration rule. |

**Effort** M · **Impact** Med now, **High at launch** · **BOS impact:** changes what BOS customers experience (their plan, trial expiry, overrides), although nothing is enforced while the mode is shadow.

### 4.7 Businesses → Messages (`/admin/messages`)

**Kept as it is (UC-2).** No change in this requirement. Its defects are recorded in §11 so they are not lost.

### 4.8 Settings → Model pricing & billing (`/admin/system-config`): split

**Why:** one page mixes the price table that sets every BOS credit charge with four AgentsPilot settings. One Sync button rewrites BOS prices while claiming to fetch live ones (NF-2).

| ID | Requirement |
|---|---|
| FR-PR1 | `/admin/system-config` keeps **only the AI model pricing table** (`ai_model_pricing`). Sidebar label: **"Model pricing"**. Description: something like "AI cost per model; sets Business OS charges" (wording is Dev's, within the sidebar's length). |
| FR-PR2 | **Pilot credit cost, boost packs (`boost_packs`), the calculator config (`ais_system_config`) and the billing grace period** move, unchanged in behaviour, to one new page in the **hidden AgentsPilot (parked)** group. It is reachable by URL and has one hidden sidebar entry (TA-2). **Exception:** if Dev finds that any BOS code reads the grace period or the pilot credit cost (V-18), that setting stays on the pricing page and the finding is reported. |
| FR-PR3 | **Sync tells the truth.** Its label, helper text and success message say that it **replaces prices with the list built into the app (dated June 2026), and that this changes what Business OS customers are charged.** It asks for confirmation first. The false comment at `page.tsx:350` is corrected. Whether the button stays at all is OQ-2. |
| FR-PR4 | Every price change (single edit or Sync) is audited with who, when, before and after. The sync already audits (`logAIPricingSynced`). **To verify (Dev):** that the single-price PUT audits too. If it does not, it starts to. |
| FR-PR5 | The moved boost-pack section is labelled **"AgentsPilot boost packs"**, so nobody confuses it with the BOS top-up packages. Those packages are configured in code with no admin UI in v1 (credits boost requirement §3). |
| FR-PR6 | **CLAUDE.md rule 3:** every `console.*` call in the files this slice touches is converted to the Pino standard (at least 19 on the pricing page, V-17). The moved sections carry their converted logging with them. |

**Effort** M · **Impact** High · **BOS impact:** changes what BOS customers are charged if an operator presses Sync or edits a price. After the split, the pricing page holds only the setting that matters to BOS.

### 4.9 Settings → Free tier & onboarding (`/admin/onboarding`): move to parked

| ID | Requirement |
|---|---|
| FR-FT1 | The "Free tier & onboarding" entry moves from Settings to the **hidden AgentsPilot (parked)** group. Its route and behaviour are unchanged. |
| FR-FT2 | The Plans & entitlements description makes clear that the **BOS** free plan (trial) lives there. |

**Effort** XS · **Impact** Low · **BOS impact:** AP cleanup. It removes a page an operator could mistake for the BOS free plan. It can ride along with slice 2 (§6).

### 4.10 Settings → Admin users (`/admin/settings`): URGENT

**Why:** the page answers "who can open admin" wrongly. It lists, adds and removes people in a store that grants nothing (V-20). An operator who "removes" an admin there believes access is revoked when it is not. **That is the dangerous direction.** The page's first load also writes to that store (V-21).

**The business trade-off.** All three options stop the page lying.

| Option | What you get | For | Against | Effort |
|---|---|---|---|---|
| **A. Real management** | The page lists the real admins and lets you **add** one by email and **deactivate** one, each with a reason and an audit row | Self-service. No script or SQL needed to add an admin. | This is a **security path**: a mistake or a stolen admin session could add an admin. It needs SA review and more tests. The "super admin" role disappears, because the real list has no roles (NF-4). | M |
| **B. Show the truth, read-only** *(recommended now)* | The page lists the **real** admins (from the table, plus any set by environment), says how to add or remove one (the seed script or SQL, with a link to the runbook section), and has **no add or remove buttons** | Fixes the lie immediately at the lowest risk. Adds no new way to become an admin. Two admins rarely change. | Adding a third admin still needs the script. | S |
| C. Hide the page | The sidebar entry goes. The route stays. | Smallest change | You lose the one place that shows who has admin access | XS |

**Recommendation: B now; A later, as its own slice, when a third admin or a quicker revoke is needed** (OQ-1).

| ID | Requirement (option B; option A's additions are marked) |
|---|---|
| FR-AU1 | The page lists every **active** admin from the `admin_users` table: email, whether the account has signed in yet (user id bound), and date added. Admins granted only by the `ADMIN_EMAILS` environment setting are listed separately and labelled as such. |
| FR-AU2 | The page shows **no admin/super_admin role**. |
| FR-AU3 | The page no longer calls `GET` or `POST /api/admin/settings/admin-users`. So opening the page never writes anything (V-21). The old route itself is **not** deleted here. Deleting it belongs to admin-authz slice 7, which SA may fold in (TA-4). |
| FR-AU4 | The page says in one line how access is granted and revoked, and points to [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) § Bootstrapping Admins. |
| FR-AU5 | The sidebar description, "Who can open admin", becomes true. |
| FR-AU6 *(A only)* | Add an admin by email, and deactivate one, each with a **mandatory reason**. Each writes an audit row, flushed before the response. It is impossible to deactivate yourself or the last active admin. Environment-granted admins cannot be removed from the page. A change takes effect immediately for the next request (TA-5). |

**Effort** B: S (A: M) · **Impact** High · **BOS impact:** none for customers, but it controls **who can see and change every BOS business**. Of the items here, it has the highest trust impact.

---

## 5. Effort, impact and BOS impact

"BOS impact" answers the question: does this change what a **BOS operator sees**, what **BOS customers (or their clients) experience**, or is it **AP cleanup**?

| Item | Page | Effort | Impact | BOS impact |
|---|---|---|---|---|
| Admin users: show the truth (option B) | Admin users | S | **High** | Operator sees. It controls who can access every BOS business |
| Admin users: real management (option A) | Admin users | M | Med | Operator sees. Security path |
| Pricing split, honest Sync, audit, Pino | Model pricing & billing | M | **High** | **Customers experience.** Prices set every BOS credit charge |
| Free tier move to parked | Free tier & onboarding | XS | Low | AP cleanup |
| BOS lens: hide AP cards, group-bys and execution detail | AI cost & usage | S | Med | Operator sees |
| Drill-down phantom column (R-20) | AI cost & usage | XS | Low | AP cleanup (an "All" scope execution detail) |
| Audit names (R-20, OI-18) and placeholder | Audit trail | S | Med | Operator sees |
| Archiving header comment | Archiving | XS | Low | None visible (code honesty) |
| Businesses 5a: remove AP fold, phantom stats, comment, list honesty | Businesses | S | Med | Operator sees |
| Businesses 5b–5e: 360 additions | Businesses | S–M each | **High** (R-3) | Operator sees |
| Entitlements write UI | Plans & entitlements | M | Med now, **High at launch** | **Customers experience** (plans), once enforced |
| Queue actions (R-18) | Scheduled jobs & queues | M–L | Med now, **High at launch** | **Customers' clients experience** (messages sent) |
| *Deferred:* shadow report and launch dry run | Plans & entitlements | M | Low (UC-3) | Operator sees |
| *Backlog:* Messages defects | Messages | S–M | Low | Shared |

---

## 6. Proposed slice order (for the user to confirm)

**This is a proposal. The user confirms or reorders it (OQ-7).** **User decision, 2026-10-02: slices 1 and 5a go first. The rest of the order stays open.** It applies the user's rule that BOS-affecting items come first. Each slice ships alone, takes a few days at most, and reuses existing infrastructure. I start from the main session's suggested order and make two changes, with reasons.

| # | Slice | Effort | Impact | Why here |
|---|---|---|---|---|
| **1** | **Admin users: show the truth** (option B, §4.10) | S | High | Urgent. The page is wrong about access in the dangerous direction (a "removed" admin keeps access). Smallest fix, no new security path. |
| **2** | **Model pricing split + honest Sync**, with the **free tier move riding along** (§4.8, §4.9) | M | High | The only setting on these pages that changes what BOS customers pay. *Change from the suggested order:* the free tier move is a one-line sidebar change of the same kind (AP config to parked), so it rides along instead of being slice 8. Both moves update the sidebar tests once instead of twice. |
| **3** | **AI cost & usage BOS lens + drill-down phantom** (§4.1) | S–M | Med | Daily-use BOS screen. It also stops AP owner text from being one click away. |
| **4** | **Small honesty fixes:** audit names and placeholder, archiving comment (§4.3, §4.4) | S | Med | Quick. Audit names help every investigation from now on, including the 360 work. *Slices 3 and 4 can swap* if a quick win is wanted first. |
| **5a** | **Businesses cleanup** (§4.5) | S | Med | Clears the ground for the 360 view. |
| **5b–5e** | **Business 360 additions**, one per slice, in the order the user picks | S–M each | High | R-3. 5e waits for the credit diary. |
| **6** | **Plans & entitlements write UI** (§4.6) | M | Med now, High at launch | Needed before enforce. Today the mode is shadow, so a change blocks nothing yet. |
| **7** | **Queue actions** (§4.2) | M–L | Med now, High at launch | Required before launch. It is last only because it needs the most SA design (double-send). *If launch is near, move it ahead of 5b–6.* |

*Second change from the suggested order:* the suggested slice 8 (free tier move) is folded into slice 2, as above. If the user prefers it separate, it ships as an XS slice at any time.

---

## 7. User stories

- As a platform admin, I want the Admin users page to show exactly who has admin access, so that I never believe I revoked access when I did not.
- As a platform admin, I want the pricing page to show only the prices that drive Business OS charges, and to warn me before anything overwrites them, so that I cannot change what customers pay by accident.
- As a platform admin, I want the AI cost page in Business OS mode to show only Business OS views, so that I am not led into agent screens that mean nothing for BOS.
- As a platform admin, I want names on audit rows, so that I can tell who did what without looking up IDs.
- As a platform admin, when a business complains, I want its delivery history, activity and credits on its Businesses entry, so that I can diagnose it without SQL.
- As a platform admin, I want to change a business's plan, cohort, expiry or overrides from the screen with a recorded reason, so that I don't need the API by hand.
- As a platform admin, I want to retry, release or cancel a stuck or dead-lettered queue item, with a reason, without any risk of sending a client the same message twice, so that I can recover a failure before a customer notices.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | Any new admin route calls `requireAdmin` as its first statement (the required CI guard applies). Every **write** in this document (queue actions, entitlement ops, option A admin changes, price changes) needs a reason where stated, writes an audit row with the actor, and does not let an audit failure fail the request. Exception: entitlement and admin-access writes flush the audit before responding, the existing WC-7 pattern. Never `profiles.role`. Any write to `admin_users` is SA-reviewed. |
| **Privacy** | Cross-account admin views show **metadata only**: never message text, prompts, payloads, error messages or client contact details (reorganisation §9). NF-3 is the known exception, and TA-8 addresses it. |
| **Honesty** | No label, comment or success message claims something the code does not do (Sync, Admin users, archiving, Businesses). |
| **Look (D-4)** | No new colours, fonts or component library. Reuse the admin shell's existing dialog, table and button styles (for example, the archiving confirm dialog). |
| **Stability (D-3, D-6)** | No AgentsPilot route or API is deleted. Moved sections keep their behaviour. Every slice can be reverted alone. Every admin page keeps exactly one sidebar entry (pinned by `AdminSidebar.nav.test.ts`). |
| **Money** | No figure sums across currencies (CLAUDE.md). AI cost is USD by definition of the pricing table and is labelled as such. |
| **Logging** | Every file touched is converted from `console.*` to Pino (CLAUDE.md rule 3). Client pages use the existing client logger. |
| **Data access** | New reads and writes go through `lib/repositories/` (rule 1). Cross-account admin reads follow the `AdminTokenUsageAnalyticsRepository` template ([ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) OI-9). |

---

## 9. Acceptance criteria

**Slice 1: Admin users (option B)**
- ☐ The page lists exactly the active rows of `admin_users`, plus environment admins labelled separately (tested against a seeded list).
- ☐ Loading the page performs **no write** (tested: neither the GET nor the POST of `settings/admin-users` is called).
- ☐ There is no add, remove or role control on the page.
- ☐ A non-admin is refused (page and any new route). A happy path and one failure path are tested.

**Slice 2: Model pricing split (+ free tier move)**
- ☐ `/admin/system-config` shows only the model pricing table. Editing a price still works and is audited with before and after.
- ☐ The four AP sections load and save unchanged at their new URL-only page, which has one hidden sidebar entry.
- ☐ The Sync control's wording says it replaces prices with the built-in June 2026 list and affects BOS charges, and it asks for confirmation (or it is gone, per OQ-2).
- ☐ The page and the moved sections contain no `console.*`.
- ☐ "Free tier & onboarding" is in the hidden parked group, and its route still loads.
- ☐ The sidebar tests are updated in the same change and pass.

**Slice 3: AI cost & usage**
- ☐ In BOS scope: no Creation, Execution or Memory card, no Agent or Execution group-by, no execution detail, and a URL cannot bring them back. "All" scope is unchanged (tested both ways).
- ☐ An "All" scope execution detail shows its status and timing again (schema-check confirmed).

**Slice 4: Small honesty fixes**
- ☐ Audit rows show user names for users who have a profile name. A failed name lookup is logged and the page still loads (tested).
- ☐ The placeholder no longer mentions agents.
- ☐ The archiving header comment matches `ARCHIVE_RUNS_ENABLED`.

**Slice 5a: Businesses cleanup**
- ☐ No "AgentsPilot details" section. The stats route makes no phantom read (schema-check confirmed), or the page no longer calls it.
- ☐ The stale "unauthenticated" comment is gone. The page says the list is every login.

**Slice 6: Entitlements write UI**
- ☐ Each of the 7 operations can be run from the page with a reason, and is refused without one (client and server).
- ☐ After success, the shown entitlements match a fresh GET, and an audit row exists with actor and reason.
- ☐ Refusals show plain-language reasons. No raw error text appears.

**Slice 7: Queue actions**
- ☐ Each action works on each of the five queues and writes an audit row with a reason.
- ☐ **Double-send test:** an action racing a drain on the same item never results in two sends (tested with a simulated concurrent claim).
- ☐ "Drain now" uses the same claim path as the cron (tested).
- ☐ No payload, message text, error message, skip reason or client detail appears in the page or its API responses (tested on the serialised response).
- ☐ The old-item rule (OQ-3) is enforced on the server.

**All slices**
- ☐ CLAUDE.md Testing: a happy path and at least one failure path for each new route and repository method. QA records a manual check of each changed page as a platform admin.

---

## 10. Technical assumptions (for SA to confirm)

These are technical forks I have decided as BA, so that the user is not asked them. SA confirms or overrules each one.

| # | Assumption |
|---|---|
| TA-1 | No new visual components (D-4). Confirmation steps reuse the dialog pattern already used by the archiving page. |
| TA-2 | The four AP billing sections move **verbatim** to one new client page under `app/admin/` (route name is SA's call), listed only in the hidden parked section. The pricing page keeps its route. The admin layout guard protects the new page by inheritance. |
| TA-3 | Client pages log through the existing client Pino logger (the onboarding chat page precedent, PR #168). |
| TA-4 | Admin users option B reads through `AdminAccessService.listAdmins()` behind a new `requireAdmin`-gated read route (this is OI-3 in the access doc). The old `settings/admin-users` and `settings/platform-users` routes are left in place for admin-authz slice 7. SA may fold slice 7 (deleting them) into this slice. The two R4 parked exemptions sit in files slice 7 would delete. |
| TA-5 | *(Option A only)* Writes go through `AdminUserRepository.upsertByEmail` and `deactivateByEmail` (they already exist), followed by `AdminAccessService.invalidateCache()`, and are audited with the WC-7 flush. No `auth.admin.listUsers()` lookup (NF-5). Other server instances catch up within the 60-second cache, and the page says so. |
| TA-6 | The AI cost route **refuses** `breakdownBy=agent`, `breakdownBy=execution` and the `execution` parameter when `scope=bos`, with a 400. Hiding them in the UI alone is not enough (FR-AC4). |
| TA-7 | Dev measures how BOS-scope rows split across the four categories. If System equals Total in BOS scope (NF-7), the System card is hidden too, and the user is told. |
| TA-8 | The execution-detail response stops returning agent prompts and execution input and output (NF-3). It returns timing, status, the agent name and per-call metadata. This is a small, safe reduction on an AP path, recommended because it is cross-account owner text. SA decides whether it belongs in slice 3 or stays as recorded debt. |
| TA-9 | Queue actions are **conditional updates on the item's current state** (compare-and-set), so a concurrent drain wins cleanly and the admin is told the item changed. "Drain now" invokes the existing drain function through the §8.1 claim and lease, never a direct status update. New write routes are registered in `adminGate.writes`. SA reviews this against the `durable-queue-drain` skill. |
| TA-10 | Audit-trail names come through an existing repository read. The candidate is `findAdminIdentitiesByUserIds`, already used on this route, if it returns a person's name. Otherwise a `profiles` name read is added to an admin repository method. Never the `users` table. The route's other inline service-role read (OI-9 debt) is moved only if it is the read being fixed. |
| TA-11 | Every phantom-column fix is confirmed with the `business-os-schema-check` skill **before** coding, and the result is recorded in the workplan. |
| TA-12 | The entitlements UI reads its option lists (tiers, cohorts, capabilities) from the existing `GET .../entitlements/plans` and account `GET` responses. It does not import `lib/business-os/entitlements/**` into client code. Any import that is unavoidable is registered per the skill. |
| TA-13 | Files known to need Pino conversion if touched: `app/admin/system-config/page.tsx`, `app/api/admin/users/[id]/stats/route.ts` (also returns `error.message` unguarded), and `app/api/admin/onboarding-config/route.ts` (the same, but it is **not** touched by the free tier move, which changes the sidebar only). |

---

## 11. Deferred and backlog items (in this area, not in a slice yet)

| Item | Why deferred | Notes for when it is picked up |
|---|---|---|
| **Entitlements shadow report** and **launch dry run** UI | User decision UC-3: low priority | Both APIs exist and are admin-gated (`GET .../entitlements/shadow-report`, `POST .../entitlements/launch`, dry run only). M. |
| **Messages defects** | User decision UC-2: keep the page as it is for now | (1) Reply probably posts to `.../reply` while the route is `.../replay`, so replies may 404 silently (V-12). (2) Email sending is a TODO, but `email_sent` is still recorded as true when requested (NF-6). (3) The reply route logs the customer's email and reply text with `console.log`, and saves a placeholder `admin_id` (NF-6). (4) Whether anything posts to `/api/contact` is unknown (V-14). If nothing does, the inbox can never receive a message. **Item (3) writes customer data to logs today**, so it is the first to fix if the page is kept long-term. |
| **Admin users option A** (real management) | Recommended after option B (OQ-1) | See §4.10. M, security path. |
| **Businesses 5b–5e** | One at a time, in the user's order | §4.5 |

---

## 12. Related items, not in this slice

Recorded so they are not lost. **Each needs a user decision before any work.** The first two **affect Business OS** even though their pages are in the hidden AgentsPilot group.

| Item | BOS-impacting? | What was found | Recommendation |
|---|---|---|---|
| **HelpBot config** (hidden page) | ⚠️ **Yes** | Its `helpbot_embedding_model` field is read by `lib/services/EmbeddingService.ts:111-115, 168-172`, which BOS chat's plan cache and verified questions use. `lib/business-os/llm/modelSettingsPolicy.ts:84-88` warns that changing it **invalidates every stored vector**. Anyone who opens the hidden page by URL can change it. | Lock the field (read-only, with the warning) or remove it from the page. |
| **UI config** (hidden page) | ⚠️ **Yes** | It writes `v2_custom_tokens`, which `lib/design-system-v2/theme-provider.tsx:62-69` applies to **all of `/business-os`** (`app/business-os/layout.tsx:68`). Its sidebar description, "AgentsPilot app UI version", is wrong about its reach. `ui_version` is dead. | Surface it as "Theme (affects Business OS)", or lock it. |
| **Exchange rates** (unlisted) | No (AP display) | It writes `exchange_rates` from the browser Supabase client with no admin route, and calls a third-party API from the browser. | Drop it (R-17). The table's RLS state must be checked first (`business-os-schema-check`). |
| **The other 11 parked AP pages** | No | Platform dashboard, Agent execution queue, System flow, Agent generation, Orchestration, AIS config, Agent memory config, Agent memory dashboard, Reward config, Storage config, Executions config | Drop candidates for R-17 once AgentsPilot's future is decided. D-3 stands until then. |

---

## 13. Out of scope

- Visual redesign (D-4).
- Deleting any AgentsPilot page, route, API or table (D-3). This includes the old `settings/admin-users` route, unless SA folds admin-authz slice 7 in (TA-4).
- Messages changes (UC-2). The defects are in §11.
- The shadow report and launch dry run UI (UC-3).
- Admin credit grant or deduct (R-7). It belongs to credit deduction slice 11.
- BOS top-up package editing. It is configuration in code in v1 (credits boost requirement §3).
- The six non-admin phantom reads (R-21). They are tracked separately, money paths first.
- Per-business AI spend ranking (R-4) and the AI activity view (R-5).
- The page-guard header bypass and other parked admin-authz work ([ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md)).

---

## 14. Open questions

Business questions only. Technical forks are in §10, for SA.

- [x] **OQ-1: Admin users. Read-only truth now, or full management?** **Answered by the user, 2026-10-02: option B, read-only now.** Option B shows the real admins and explains how to change them. You keep adding admins by script, which is rare with two admins. Option A lets you add and remove admins from the page, but it is a new way to become an admin and needs security review. *Suggested:* B now, A later when a third admin is needed. (raised by: BA | status: answered — B)
- [ ] **OQ-2: The pricing "Sync" button.** It replaces every model price with a list built into the app (June 2026), which changes what Business OS customers are charged. Should it (a) stay, clearly worded and with a confirmation, or (b) be removed, so prices change only by editing one model at a time? *Suggested:* (a) stay, reworded and with a confirmation. It is the quickest way to restore known-good prices after a bad edit. (raised by: BA | status: pending user input)
- [ ] **OQ-3: Re-sending old client messages.** When a reminder, lead reply or briefing failed days ago, a late send may confuse the client: a payment reminder for an invoice already paid, or a "thanks for your enquiry" three days late. May an admin retry such an item at any age? *Suggested:* retry allowed up to **72 hours** after the item was due. After that, cancel only. (raised by: BA | status: pending user input)
- [ ] **OQ-4: "Drain now" before launch?** Without it, after a fix you wait for the next scheduled run. That is up to 24 hours for daily payment reminders. *Suggested:* include it in slice 7. (raised by: BA | status: pending user input)
- [ ] **OQ-5: Businesses list default.** Should the list open on businesses only, or on every login? *Suggested:* businesses only, with a toggle to show all logins. (raised by: BA | status: pending user input)
- [ ] **OQ-6: A second pair of eyes for plan changes?** Should changing a business's plan, expiry or overrides need a second admin's approval? *Suggested:* no. There are two admins, both owners, and a mandatory reason plus an audit row is enough. Revisit if support staff join. (raised by: BA | status: pending user input)
- [ ] **OQ-7: Slice order.** Confirm or reorder §6. In particular: should queue actions (slice 7) move earlier because of the launch date? (raised by: BA | status: pending user input)

---

## 15. Notes on integration points

| System | Slices | Note |
|---|---|---|
| `app/admin/components/AdminSidebar.tsx` | 1, 2, 6 | Data and labels only. Pinned by `app/admin/components/__tests__/AdminSidebar.nav.test.ts` and `app/admin/business-os-llm/__tests__/nav.test.ts`. Slice 2 adds one hidden parked entry and moves one entry. |
| `admin_users`, `AdminAccessService`, `AdminUserRepository` | 1 (A later) | The source of truth for access. Writes are a security path (SA review). |
| `system_settings_config` (`admin_users` key) | 1 | No longer read or written by the page. The rows stay. |
| `ai_model_pricing`, `lib/ai/pricing`, `AiModelPricingRepository` | 2 | Drives BOS charges and the Business OS AI model picker (`modelOptions.ts`). |
| `boost_packs`, `ais_system_config`, billing keys in `system_settings_config` | 2 | Moved to the parked page unchanged. Readers of the grace period and the pilot credit cost are to be verified (V-18). |
| `app/api/admin/token-usage/drill-down`, `AdminTokenUsageAnalyticsRepository` | 3 | BOS row definition is `bosRowFilter()`. Execution detail inline reads are OI-9 debt. |
| `app/api/admin/audit-trail` | 4 | Name source per TA-10. |
| `app/admin/archiving/page.tsx`, `lib/archiving/config.ts` | 4 | Comment only. |
| `app/admin/users/**`, `app/api/admin/users/[id]/stats` | 5a | Fold removed. Route kept and phantom columns fixed (or the page stops calling it). |
| The five §8.1 queue tables, `app/api/admin/jobs-queues`, the cron drain functions | 5c, 7 | Read-only in 5c. Conditional writes in 7 (TA-9). |
| `POST/GET /api/admin/business-os/entitlements/**`, `lib/business-os/entitlements/**` | 6 | Existing API only. Skill registration for any import. |
| `lib/services/EmbeddingService.ts`, `lib/design-system-v2/theme-provider.tsx` | §12 only | BOS-affecting settings on hidden AP pages. Not changed here. |

Related: [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) · [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) · [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) · [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) · [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md)

---

## SA Review — slices 1 and 5a (2026-10-02)

**Reviewed by SA — 2026-10-02.** **Scope: slices 1 and 5a only** (§4.10 FR-AU1..AU5 under OQ-1 = B; §4.5 FR-BU1..BU6), and the parts of §2, §3, §8, §9 and §10 that touch them. Every other slice is **not reviewed** here and needs its own SA pass.
**Status: APPROVED WITH CONDITIONS.** Dev may write the workplans once conditions C-1..C-15 are carried into them. Two FR texts are corrected below (FR-BU1, TA-4), so the workplan follows this section where they differ.

### A. Schema check (TA-11), measured live and read-only

**Ref:** `main` @ `34d665b4` (working tree dirty with untracked docs only). **Method:** `npm run schema:check` (zero-row `limit(0)` selects), then a one-column-at-a-time zero-row probe of every column the two slices rely on. No rows read, nothing written, no DDL.

| Table.column | Live | Used by | Rule 5 shape |
|---|---|---|---|
| `agent_executions.total_tokens_used` | ❌ **missing** (42703) | stats route `:56` | Phantom in a select whose result feeds only the AgentsPilot fold. The whole executions read has always failed, so the fold always showed 0 executions. After FR-BU1 the read has no consumer: **delete the query** |
| `user_subscriptions.plan_name` | ❌ **missing** (42703) | stats route `:72` | **Never worked** |
| `user_subscriptions.subscription_status` | ❌ **missing**. **NEW, not in V-9.** The real column is `status` | stats route `:72` | **Never worked.** PostgREST names only the first unknown column, so a whole-select check reports `plan_name` and hides this one |
| All other columns of those two selects, `agents.*` (5 used), `token_usage.*` (6 used), `plugin_connections.plugin_key/connected_at/status` | ✅ exist | stats route | — |
| `admin_users.id, user_id, email, granted_by, notes, is_active, created_at, updated_at` | ✅ exist | slice 1 | — |
| `admin_users.role` | ❌ missing | — | Confirms NF-4: the real table has no role |

**Consequence (NF-1 confirmed):** on the live database the **Subscription card on the Businesses detail has never rendered** (`subscriptionResult.data` is always null), and the fold's execution figures have always been 0.

### B. As-built facts that change the requirement

| # | Finding | Effect |
|---|---|---|
| B-1 | **The AgentsPilot fold holds only agents and agent executions** (`users/page.tsx:951-1022`). Three other cards sit **outside** it and are always visible: **Subscription** (`:1026`), **Plugins** (`:1083`) and **"AI spend, all products"** (token-by-model, `:1115`). FR-BU1 says the fold includes "plugins and token-by-model". It does not. | FR-BU1 corrected (C-10, C-11). The user approved removing *the fold*. That approval does not cover the two visible cards that hold BOS data. |
| B-2 | Plugins (`plugin_connections`) is a business-owned table (`lib/business-os/businessOwnedTables.ts`). `token_usage` carries every BOS AI call (`callCatalog.ts`). | Both cards show BOS facts and **stay**. |
| B-3 | `user_subscriptions` is the AgentsPilot **Pilot-Credit** table. BOS charging is pinned **never** to read it (`chargeResolver.test.ts` source guard). | The Subscription card is AP, and it has never rendered (A). Retire it. Do not repair it (C-11). |
| B-4 | **FR-BU5 answer:** after 5a the page **still calls** the stats route, for Plugins and AI spend. | The route stays, trimmed (C-12). |
| B-5 | **Guard rule R2 fails any `route.ts` whose code mentions `AdminAccessService`** (`admin-authz-surface.guard.test.ts:1654-1660`, substring match on comment-stripped code). TA-4's "read through `AdminAccessService.listAdmins()` behind a new route" **would turn the required check red**, and raising the R2 cap to pass it is forbidden by the ratchet rule. | TA-4 overruled in part (C-1). |
| B-6 | `AdminAccessService.listAdmins()` **returns `[]` on a database error** and serves a cache up to 60 s old. | A page built on it would show **"no admins"** when the read failed. That is the same lie this slice exists to remove (C-1). |
| B-7 | `ADMIN_EMAILS` **grants admin even when that email's table row is deactivated** (`isAdmin` step 3 runs after the table check). | The page must say so, or "deactivate the row" looks like a revoke when it is not (C-3). This is the dangerous direction again. |
| B-8 | R4's two parked exemptions are `app/admin/settings/page.tsx` (4 `role` comparisons) and `settings/admin-users/route.ts` (2). Slice 1 removes the page's four **whatever happens**, so that entry goes stale in this slice regardless. | Folding the route deletion in takes R4 to an **empty allow-list** (C-6). That was admin-authz slice 7's goal, and it unblocks that programme's slice 6. |
| B-9 | `app/admin/users/__tests__/businessOsPanel.render.test.tsx:209` **pins the fold's presence** (`findByTestId('agentspilot-details')`). | It must be inverted in the same change (C-14). |

### C. Technical rulings (SA, not for the user)

| # | Ruling |
|---|---|
| **TA-4** | **Overruled in part.** (a) The list is served by a **new** `GET /api/admin/admins` (`app/api/admin/admins/route.ts`), which is OI-3 in the access doc. It reads the table through `AdminUserRepository.listActive()`, **not** through `AdminAccessService`: R2 forbids that (B-5), and `listAdmins()` hides errors (B-6). This is not an authz decision, so R2's intent ("no route resolves admin identity for itself") is respected, not dodged. (b) **Admin-authz slice 7 is folded in for its two routes only**: `settings/admin-users` and `settings/platform-users` are deleted. Once the page stops calling them they have no caller left, and one of them is still a GET that writes (V-21). The **page is not deleted** (slice 7 planned to delete it). It is rewritten, and the sidebar entry and the `AdminHeader` link stay. Slice 7's precondition (7.1, "re-confirm BQ-2 = B with the user") is met by OQ-1 = B on 2026-10-02. |
| **TA-5** | Not applicable (option A only). Recorded for when FR-AU6 is picked up. |
| **TA-11** | Done here for both slices (§A). The workplans cite §A and do not re-measure, unless their branch changes a select. |
| **TA-13** | Confirmed and narrowed to these slices. `console.*` counts in files the two slices touch: **`app/api/admin/users/[id]/stats/route.ts`: 1** (`console.error` at the catch, which also returns `error.message` unguarded). **0** in `app/admin/settings/page.tsx`, `app/admin/users/page.tsx`, `BusinessOsPanel.tsx`, `AdminSidebar.tsx`, `AdminAccessService.ts`, `AdminUserRepository.ts` and the two routes being deleted. The one call is converted (C-12). |
| **ADMIN_EMAILS** | Server-only env (Vercel), read at process start. Listing these addresses **to an authenticated admin** is safe: they are admin emails, shown only behind `requireAdmin`, and admins already see every customer's email on Businesses. They must **never** reach a non-admin route, and the route **logs counts only, never addresses** (the `requireAdmin` precedent). |
| **Data access (rule 1)** | Slice 1's new read uses the existing repository. Slice 5a **reduces** the stats route's inline service-role reads from 5 to 2. It adds none. Moving those two reads into repositories is **not** folded in. It is OI-9 debt, and the existing `PluginConnectionRepository` methods `select('*')` on a table holding OAuth tokens, so they are not a drop-in replacement. Record it in the 5a workplan as debt, by name. |
| **D-4** | Both slices remove elements and change copy only. The new text uses classes already on the same page (`text-sm text-slate-400`, the existing blue info box). No new component, colour or icon set. |
| **PR split** | **Two PRs**, see §E. |

### D. Conditions

**Slice 1: Admin users (option B)**

1. **C-1: New route, repository read, no service import.** Create `app/api/admin/admins/route.ts` with `GET` only. `requireAdmin(requestLogger)` is its **first statement**, using the `correlationId` child logger pattern of its neighbours. It reads `adminUserRepository.listActive()` directly. Its code must not mention `AdminAccessService` (R2). It takes no query parameters and no body, so there is nothing for Zod to validate. If a parameter is ever added, it gets a Zod schema first.
2. **C-2: One env parser.** Move `parseEnvAdminEmails` out of `AdminAccessService.ts` into a small shared module whose name does not contain `AdminAccessService` (suggested `lib/admin/adminEmailsEnv.ts`). Both the service and the new route import it. The service change is **behaviour-identical**, and `lib/services/__tests__/AdminAccessService.test.ts` must pass **unedited**. Two parsers would drift, the same way a second `profiles.role` normaliser would.
3. **C-3: What the page shows, and what the API returns.**
   - **Table admins:** email; **"Linked to a login: yes / not yet"** (from `user_id`), not "has signed in", because a row binds on the admin's first admin request or at seeding, not at sign-in; **Added** (`created_at`); `notes` if present.
   - **Environment admins:** addresses in `ADMIN_EMAILS` that are not an active table row, compared case-insensitively, labelled **"Granted by the ADMIN_EMAILS environment setting"**.
   - **Overlap:** a table admin whose email is also in `ADMIN_EMAILS` is listed **once**, with the marker **"Also in the environment setting: removing the row alone does not revoke access"** (B-7).
   - **The response never contains** `user_id`, `granted_by`, profile data, or anything from `auth.admin.listUsers()` (NF-5).
   - **On a repository error:** a 500 with `{ success: false, error: 'Failed to load admin list' }` and `details` behind the `NODE_ENV === 'development'` guard. The page shows an **error state, never an empty list**.
4. **C-4: Page rewrite, read-only.** `app/admin/settings/page.tsx` stays `'use client'` (R8). Remove the Add Admin button, the add form, the role picker, the platform-user browser, the remove buttons, the Crown/Super Admin badge and the "About Admin Roles" box. The header subtitle "Manage admin users and system settings" is false; replace it with something like "Who can open admin. Read-only." Reuse the existing blue info box for **FR-AU4**. In one or two lines: access comes from the `admin_users` table or `ADMIN_EMAILS`; to add or remove an admin, run the seed script or SQL; see `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` § Bootstrapping Admins; changes reach every server within about a minute. Show the doc path as **text**: the app does not serve `/docs`, and a link would 404. **FR-AU5** then holds with no sidebar change. The sidebar and both nav tests are untouched in slice 1.
5. **C-5: Fold in slice 7's route deletions.** Delete `app/api/admin/settings/admin-users/route.ts` and `app/api/admin/settings/platform-users/route.ts`. In `app/api/admin/__tests__/adminGate.writes.test.ts`, remove their three cases and add the new route's case, so that the four denial cases run against it. The pinned total goes **59 → 57**. `git grep "settings/admin-users\|settings/platform-users"` must return nothing outside `.next/`. The orphaned `system_settings_config.admin_users` key is **not** deleted. It is recorded (OI-7 of the authz workplan).
6. **C-6: The ratchet.** Delete **both** R4 parked entries and set `CAPS.R4.parked` **2 → 0** in the same commit. The page's entry must go even though the file still exists: the existence assertion will not force it, but the ratchet rule does. Run slice 7's deliberate-breakage check: a new `role === 'admin'` comparison fails R4 with an empty allow-list. No other cap moves. The new handler adds no exemption.
7. **C-7: Documentation, same PR.** In `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`:
   - mark register rows 47-49 deleted and add a row for `admins#GET`;
   - re-measure the census **from disk** (the doc already says the last two rows were not re-derived);
   - set R4 in the caps table to 0/0;
   - restate the "admin Settings screen" row in *What is NOT true*: it is now a truthful read-only list, and the management routes are deleted;
   - restate OI-2b as done in its new form, and mark OI-3 done;
   - add a Change History row.

   In `docs/workplans/admin-authz-unification.md`, mark slice 7 "routes folded into ADMIN_BOS_CLEANUP slice 1; page kept, read-only". The PR body carries the how-to-add-an-admin steps verbatim.
8. **C-8: Tests.**
   - **Route:** the happy path, with rows plus the env split, case-insensitive overlap and the overlap marker; a repository error gives a 500, **not** an empty list; the response has no `user_id`; 401 and 403 come through the shared case list.
   - **Page render:** no add, remove or role control; `fetch` is **never** called with `settings/admin-users` or `settings/platform-users`; the environment section label shows; the error state shows when the route fails.
   - **Env parser:** comma, semicolon, whitespace, mixed case.
   - `ts-jest` does not type-check in this repo, so run `tsc` on the touched files with `NODE_OPTIONS=--max-old-space-size=8192` and check its exit code, not a grep count.

**Both slices**

9. **C-9: Reading the §9 acceptance criteria.** The slice 1 acceptance criterion "lists exactly the active rows of `admin_users`, plus environment admins labelled separately" is read together with C-3, including the overlap marker. The slice 5a criterion "or the page no longer calls it" resolves to "**the page still calls it, and it makes no phantom read**" (B-4).
**Slice 5a: Businesses cleanup**

10. **C-10: FR-BU1 corrected: remove the fold only.** Delete the `<details data-testid="agentspilot-details">` block (`users/page.tsx:951-1022`) and its types. **Plugins and "AI spend, all products" stay** (B-1, B-2). That matches what the user approved, "the collapsed AgentsPilot details section", not the BA's description of its contents.
11. **C-11: Retire the Subscription card.** Remove the card (`:1026-~1080`) and the `user_subscriptions` read. Under the skill's Rule 5 this is the "never worked" shape, and the decision is to **retire**, not patch. Patching (`status` for `subscription_status`, dropping `plan_name`) would make an **AgentsPilot Pilot-Credit** card appear on BOS businesses for the first time, which goes the opposite way to this cleanup. The operator sees no change, because the card has never rendered (§A). BOS credits arrive in 5e.
12. **C-12: Stats route trimmed and brought to standard.**
    - Drop the `agents`, `agent_executions` and `user_subscriptions` queries. Keep `token_usage` and `plugin_connections` with their current explicit columns.
    - The response carries `tokens` and `plugins` only.
    - **Bind and check `error` on both reads** (skill Rule 4). A failed read is logged with `{ err }` and returns `success: false`, or a section set to `null` that the page renders as "could not load". It never returns zeros, because zero spend looks like a real answer.
    - Validate `id` with Zod (`z.string().uuid()`) before any read. Return 400 `{ success: false, error }`.
    - Replace `console.error` with `requestLogger.error({ err }, …)` and put the 500's `message` behind the `NODE_ENV` guard.
    - Update the file header comment.
    - The route stays (D-3, FR-BU5).
13. **C-13: Page copy.**
    - **FR-BU3:** replace the stale "This whole admin surface is unauthenticated" paragraph (`:408-411`) with the true statement (layout guard plus `requireAdmin`). Keep the terminate-route history.
    - **FR-BU4:** add one line under the `Businesses` heading in the existing `text-sm text-slate-400` style, along the lines of "Every login on the platform. Logins with no business show 'No Business OS business'." Do **not** touch `countLabels`: the list's labels belong to 5b.
    - **FR-BU6 is required, not optional:** relabel "Role" to **"Persona (from profile)"** and **drop the Shield icon** beside it. The shield is what makes it read as access. This is a display change, not a comparison, so R4 is unaffected.
    - Update the detail-loaded check (`:301`) so it no longer depends on fields that were removed.
14. **C-14: Tests.**
    - Invert `businessOsPanel.render.test.tsx:185-212`: no `agentspilot-details`, no "Subscription" heading, the AI spend card still present, and the stats mock in the new shape.
    - Add `app/api/admin/users/[id]/stats` route tests: the happy path, a token-usage read error that does not return zeros, and an invalid `id` that returns 400 before any read. The gate cases already sit in the shared case list.
    - `users/__tests__/source.guard.test.ts` stays green unchanged.
15. **C-15: Record the phantoms.** Add the three stats-route findings, including the new `subscription_status`, to `docs/workplans/business-os-phantom-column-remediation.md` with ref `34d665b4` and their Rule 5 shapes, and cite §A in the 5a workplan.

### E. PR split and effort

**Two PRs. Slice 1 first.** They touch disjoint files. The only shared file is `adminGate.writes.test.ts`, which 5a does not edit. Each reverts alone (D-6).

| PR | Contents | Effort | Why separate |
|---|---|---|---|
| **1** | Slice 1: new route, env parser extraction, page rewrite, slice 7 route deletions, R4 ratchet to 0, access doc and authz workplan updates, tests | **S**, about 1 to 1.5 days. The page is mostly deletion; most of the time goes on the guard, tests and doc | It touches the **admin authz surface** and the required CI guard. It deserves a focused security review and a revert that does not take the Businesses cleanup with it |
| **2** | Slice 5a: fold and Subscription card removed, stats route trimmed (Zod, Pino, error checks), copy fixes, tests, phantom register | **S**, about 0.5 to 1 day | A display cleanup on a different screen. It needs no authz review |

### F. Question for the user (business terms, non-blocking)

- **Q-SA-1: Plugins and AI spend stay on a business's detail.** The cleanup list named "plugins" and "AI spend by model" as part of the AgentsPilot section being removed. They are actually separate cards, always visible, and both show Business OS facts: which Google account a business connected, and what its AI use cost. SA keeps them. **Default if you say nothing: they stay.** Tell us if you wanted them gone too. **Answered by the user, 2026-10-02: keep them.**

### Approval
- [x] Requirement for slices 1 and 5a approved, **with conditions C-1..C-15**. Dev writes one workplan per PR, and SA reviews each workplan before any code.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created | Built from the main session's review of all 27 admin pages and the user's approvals (UC-1 to UC-4). Each claim was checked against code on `main` `34d665b4` (§2: 20 verified, 4 partly verified or left to Dev; none checked against the live database). Eight new findings (§3), notably: a phantom column fails the whole read; the pricing Sync overwrites the prices that set BOS charges while claiming to fetch them; the AI cost execution detail returns AgentsPilot owner text across accounts; the real admin list has no roles. Requirements for 10 pages (§4), effort, impact and BOS impact (§5), and a proposed order of 7 slices (§6, free tier move folded into slice 2). There are 13 technical assumptions for SA and 7 business questions for the user. |
| 2026-10-02 | User decisions | OQ-1 answered: option B, read-only. Slices 1 and 5a go first; the rest of §6 stays open. The admin credit add/remove capability is **not** added here: credit-deduction slice 11 (FR-30, FR-31) already owns it, and the user chose not to document it twice. |
| 2026-10-02 | SA review: slices 1 and 5a | **APPROVED WITH CONDITIONS (C-1..C-15).** Live read-only schema check on `34d665b4`: `agent_executions.total_tokens_used` and `user_subscriptions.plan_name` are confirmed missing, and `user_subscriptions.subscription_status` is a **third phantom** (the Subscription card has never rendered). FR-BU1 is corrected: the fold holds only agents and executions; Plugins and AI spend stay, and the AP Subscription card is retired. TA-4 is overruled in part: the new `GET /api/admin/admins` reads the repository, because guard R2 forbids importing `AdminAccessService` in a route. Slice 7's two routes are folded in and R4 goes to 0/0. Two PRs. Other slices not reviewed. |
| 2026-10-02 | Q-SA-1 answered | The user keeps the Plugins and AI spend cards on the Businesses detail (SA's recommendation). Slice 1 workplan requested. |
