# Requirement: Admin Cleanup for Business OS

> **Last Updated**: 2026-10-04

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
17. [SA Review — slice 2 (2026-10-03)](#sa-review--slice-2-2026-10-03)
18. [SA Review — slice 3 (2026-10-03)](#sa-review--slice-3-2026-10-03)
19. [SA Review — slice 7 (2026-10-04)](#sa-review--slice-7-2026-10-04)
20. [Change History](#change-history)

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

> **SA note (slice 4 review, 2026-10-03):** FR-AT3's proposed text is superseded by **"Search by email, action, resource or entity ID…"**. Search matches `user_email`, `action`, `resource_name`, `entity_id` and the JSON of `details`/`changes`. It does not match person or business names, which are attached after filtering, and it does not match the event id or the account id. "Resource" and "Entity ID" are the page's own labels. See the slice 4 workplan, SA Review O-2.

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
| 5e | **Credits:** plan allowance, balance and a link to the credit diary for this business | Credit deduction ledger and diary (credit deduction slice 7 and later); read-only | S–M, **depends on the credit diary shipping** *(Note 2026-10-03, from credit deduction slice 11, decision S11-D-8 B: the plan allowance / balance part, the grants list and the Give / Take back credits forms are delivered by credit deduction **slice 11c** as one Credits block on this Businesses entry — one screen, not two. **5e: no credit-history link — parked, BD-17 in the deduction requirement** (the owner credit history shipped dark behind `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY`, default off; it is owner-only and has no admin view). Nothing of 5e remains to build.)* |

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
| FR-PR3 | **⏸ PARKED 2026-10-03 (user decision UC-5): not in slice 2.** The Sync button and its wording stay exactly as they are in slice 2; the whole pricing-source question moves to its own session (§11, "Model price source and Sync"). Original text, kept for that session: **Sync tells the truth.** Its label, helper text and success message say that it **replaces prices with the list built into the app (dated June 2026), and that this changes what Business OS customers are charged.** It asks for confirmation first. The false comment at `page.tsx:350` is corrected. Whether the button stays at all is OQ-2. |
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
| **Security** | Any new admin route calls `requireAdmin` as its first statement (the required CI guard applies). Every **write** in this document (queue actions, entitlement ops, option A admin changes, price changes) needs a reason where stated, writes an audit row with the actor, and does not let an audit failure fail the request. Exception: entitlement, admin-access **and model price** writes flush the audit before responding, the existing WC-7 pattern (price writes added by slice 2, C2-7). Never `profiles.role`. Any write to `admin_users` is SA-reviewed. |
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
  - *SA note, 2026-10-03: **out of scope for slice 2.** FR-PR3 and OQ-2 are parked (UC-5). The line above belongs to the separate price-source session (§11). In slice 2 the Sync control, its wording and its route stay exactly as they are (SA Review — slice 2, C2-1).*
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
| **⏸ Model price source and Sync** (was FR-PR3 / OQ-2 / NF-2) | **Parked 2026-10-03, user decision UC-5.** The user will handle it in a separate session as its own fix: look up the providers' real current prices, update the database **and** the code, and decide what Sync should become. | **As-built (verified 2026-10-03 on main):** (1) Sync copies **code → database**: a 42-model list typed into `app/api/admin/system-config/pricing/sync/route.ts` (20 OpenAI, 13 Anthropic, 6 Kimi, 3 Google, dated June 2026) overwrites the matching rows of `ai_model_pricing` via `aiModelPricingRepository.syncMany`; it contacts no provider, although the page says it "automatically fetches current rates". (2) A **second** in-code list, `FALLBACK_PRICING` in `lib/ai/pricing.ts`, holds the same prices and is used when a model is missing from the table or the table cannot be read. (3) Runtime cost lookup order: the table (cached in memory for 1 hour) → `FALLBACK_PRICING` → a flagged conservative charge for an unpriced model (credit deduction FR-12). Every BOS credit charge is computed from this. Slice 2 still does the page split (FR-PR1, FR-PR2, FR-PR4–FR-PR6) and leaves Sync untouched. **Also for that session (SA slice 2 workplan review, 2026-10-03):** the pricing page's info box is false in three places and is frozen with Sync: "Changes affect cost calculations immediately" (the price cache is 1 hour), "per 1,000 tokens" (columns are per token), and an "Intelligent Routing" paragraph that is about AgentsPilot. And a project-wide WC-7 limit: `AuditTrailService.flush()` returns early while another flush runs (`isFlushing`), so an awaited flush can return before this request's row is written. |

---

## 12. Related items, not in this slice

Recorded so they are not lost. **Each needs a user decision before any work.** The first two **affect Business OS** even though their pages are in the hidden AgentsPilot group.

| Item | BOS-impacting? | What was found | Recommendation |
|---|---|---|---|
| **HelpBot config** (hidden page) | ⚠️ **Yes** | Its `helpbot_embedding_model` field is read by `lib/services/EmbeddingService.ts:111-115, 168-172`, which BOS chat's plan cache and verified questions use. `lib/business-os/llm/modelSettingsPolicy.ts:84-88` warns that changing it **invalidates every stored vector**. Anyone who opens the hidden page by URL can change it. | Lock the field (read-only, with the warning) or remove it from the page. |
| **UI config** (hidden page) | ⚠️ **Yes** | It writes `v2_custom_tokens`, which `lib/design-system-v2/theme-provider.tsx:62-69` applies to **all of `/business-os`** (`app/business-os/layout.tsx:68`). Its sidebar description, "AgentsPilot app UI version", is wrong about its reach. `ui_version` is dead. | Surface it as "Theme (affects Business OS)", or lock it. |
| **Exchange rates** (unlisted) | No (AP display) | It writes `exchange_rates` from the browser Supabase client with no admin route, and calls a third-party API from the browser. | Drop it (R-17). The table's RLS state must be checked first (`business-os-schema-check`). |
| **The other 11 parked AP pages** | No | Platform dashboard, Agent execution queue, System flow, Agent generation, Orchestration, AIS config, Agent memory config, Agent memory dashboard, Reward config, Storage config, Executions config | Drop candidates for R-17 once AgentsPilot's future is decided. D-3 stands until then. |

**2026-10-04: HelpBot embedding model locked.** The HelpBot PUT no longer writes `helpbot_embedding_model`, refuses a changed value with a 400, and the page shows it read-only with the warning. See [ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md](/docs/workplans/ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md).

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
- [x] **OQ-2: PARKED 2026-10-03 (UC-5)** — moved to its own session; see §11 "Model price source and Sync". Original question: **The pricing "Sync" button.** It replaces every model price with a list built into the app (June 2026), which changes what Business OS customers are charged. Should it (a) stay, clearly worded and with a confirmation, or (b) be removed, so prices change only by editing one model at a time? *Suggested:* (a) stay, reworded and with a confirmation. It is the quickest way to restore known-good prices after a bad edit. (raised by: BA | status: pending user input)
- [x] **OQ-3: Re-sending old client messages.** **Answered by the user, 2026-10-04: retry allowed up to 72 hours after the item was due; after that, cancel only.** When a reminder, lead reply or briefing failed days ago, a late send may confuse the client: a payment reminder for an invoice already paid, or a "thanks for your enquiry" three days late. May an admin retry such an item at any age? *Suggested:* retry allowed up to **72 hours** after the item was due. After that, cancel only. (raised by: BA | status: pending user input)
- [x] **OQ-4: "Drain now" before launch?** **Answered by the user, 2026-10-04: yes, include it in slice 7.** Without it, after a fix you wait for the next scheduled run. That is up to 24 hours for daily payment reminders. *Suggested:* include it in slice 7. (raised by: BA | status: pending user input)
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

**SA note, 2026-10-02 (5a workplan review): C-13's FR-BU6 bullet is superseded.** The "Role" on the Businesses detail is not `profiles.role`. `app/api/admin/users/route.ts` overwrites the spread profile's `role` with the Supabase auth role (`authUser?.role || 'authenticated'`), which is `'authenticated'` for every login and is also the fallback when the auth lookup fails. Labelling it "Persona (from profile)" would therefore be false. **Ruling:** remove the Role row and its Shield instead of relabelling it. That meets NF-8's goal (nothing on the detail can be read as admin status) and matches the U-9 precedent, which already dropped the same value from the list. NF-8's premise ("`profiles.role`") and FR-BU6's text are read with this note. Details: [5a workplan](/docs/workplans/ADMIN_BOS_CLEANUP_SLICE_5A_WORKPLAN.md), "SA Workplan Review (2026-10-02)", SA-5a-1.

---

## SA Review — slice 2 (2026-10-03)

**Reviewed by SA — 2026-10-03.** **Scope: slice 2 only.** That is §4.8 FR-PR1, FR-PR2, FR-PR4, FR-PR5 and FR-PR6; §4.9 FR-FT1 and FR-FT2; the slice 2 lines of §9; TA-2, TA-3 and TA-13; and V-17, V-18, V-19 and NF-2. FR-PR3 and OQ-2 are **parked** (UC-5) and are not reviewed.
**Ref:** `fix/admin-pricing-split` @ `5061489b`. Code was read; the live database was not (§C, "Schema").
**Status: APPROVED WITH CONDITIONS.** Dev may write the workplan once conditions C2-1..C2-12 are carried into it. The conditions are numbered C2- so they do not collide with slice 1's C-1..C-15.

### A. As-built findings

| # | Finding | Effect |
|---|---|---|
| S2-1 | The page (`app/admin/system-config/page.tsx`, 1,989 lines) has **four** collapsible sections: AI Model Pricing (`:600-830`), Billing Configuration (grace period and boost packs, `:832-~1425`), Calculator Configuration (`:1430-~1925`), and a read-only **Advanced Configuration** JSON dump (`:1929-1985`). The dump prints the calculator config **and** the pricing table. | The requirement does not say where the dump goes. Ruled in C2-3. |
| S2-2 | **"Pilot credit cost" is not an editable control on this page.** The page reads `pilot_credit_cost_usd` from the `billing` rows of `system_settings_config` (`:169-171`). It uses the value only to work out a boost pack's credits in the browser (`calculateBoostPackCredits`, `:441-445`). The pilot credit cost an admin **can** edit is the calculator's `creditCostUsd`, which `calculator-config` writes to the `ais_system_config` key `pilot_credit_cost_usd` (`calculator-config/route.ts:51`). So the same name lives in two stores. | Both move, with the boost-pack and calculator sections. Nothing called "pilot credit cost" stays on the pricing page. The two-store drift is AgentsPilot debt: recorded here, not fixed (D-3). |
| S2-3 | **FR-PR2 exception: who reads the grace period.** Outside the page, `payment_grace_period_days` is read in one place only: `handleInvoicePaymentFailed` in `app/api/stripe/webhook/route.ts:347-445`. That handler updates `user_subscriptions` and sets `agents_paused`, so it is the AgentsPilot platform subscription (Pilot Credits). The BOS grace period is a different thing: it is configured in code (`lib/business-os/entitlements/config/lifecycle.ts` `subscriptionGraceHistory`, `cohorts.ts` `graceHistory`) and stored per account as `grace_ends_at`. Nothing under `lib/business-os`, `app/business-os` or `app/api/business-os` reads the key. | **No BOS reader. The grace period moves.** |
| S2-4 | **FR-PR2 exception: who reads the pilot credit cost (R-21).** The readers are: the Stripe webhook (`webhook/route.ts:113` proration in `handleInvoicePaid`, and `:635` in `handleCheckoutCompleted`; both are Pilot-Credit paths on the platform Stripe account), `stripe/invoices/route.ts:76`, `stripe/sync-subscription/route.ts:124`, `stripe/update-subscription/route.ts:69`, and the AgentsPilot billing UIs (`components/settings/BillingSettings.tsx`, `components/v2/settings/BillingSettingsV2_NEW.tsx`), which are mounted only at `app/(protected)/settings` and `app/v2/billing`. The webhook **file** is shared with BOS. BOS's handlers in it are the Connect ones (`handleConnect*`, `:1129` onward), and none of them reads the key. `lib/business-os/credits/__tests__/ownerCreditSurface.guard.test.ts:69-74` already pins that the BOS owner credit surface never names `pilot_credit_cost_usd`. Also, the webhook and invoices reads select `pilot_credit_cost_usd` as a **column** of the key/value `ais_system_config` table. That is the R-21 phantom, so those reads always fall back to `0.00048` and **ignore the admin setting today**. | **No BOS reader. The pilot credit cost moves.** R-21 stays a separate task (§13). Moving the admin control neither fixes it nor makes it worse. |
| S2-5 | **FR-PR4 verified, with a durability gap.** `PUT /api/admin/system-config/pricing` reads the row first and calls `logAIPricingUpdated(adminId, id, model, { before, after })` (`pricing/route.ts:210-243`), and `pricing/__tests__/route.test.ts:272` tests it. POST and DELETE audit as well. **But** `auditLog` only **queues** the row: `AuditTrailService` writes in batches, every 5 s or at 100 rows, and the route never flushes. A serverless instance frozen after the response can lose the row. The entitlements, invites and archiving routes flush before responding (WC-7). | The audit exists. C2-7 makes it durable. |
| S2-6 | **FR-FT1 and V-19 verified.** Only two places read the `free_tier_*` keys: `app/api/admin/onboarding-config` and `lib/services/FreeTierGrantService.ts`. The service is called only by `POST /api/onboarding/allocate-free-tier`. That route's callers are the AgentsPilot onboarding hook (`components/onboarding/hooks/useOnboarding.ts`, which no page imports) and the `/test-plugins-v2` harness. BOS onboarding is `app/onboarding-chat`, which does not call it. The BOS free plan is the entitlements trial, shown at `/admin/business-os-tiers`. | Safe to park. |
| S2-7 | **FR-PR5 and the exclusions verified.** Only `app/api/admin/boost-packs`, `lib/stripe/StripeService.ts` and the two AgentsPilot billing components read `boost_packs`. A BOS top-up is a `credit_lots` row with `source = 'boost_purchase'` (`lib/business-os/credits/creditAdminOps.ts:315`), and its packages are configured in code. No BOS file reads `boost_packs`. The calculator config (`/api/pricing/config`) is read by `components/billing/PilotCreditCalculator.tsx` and `components/marketing/DevelopmentVsAgentsPilotCalculator.tsx`. Both are AgentsPilot. | Every moved section is AgentsPilot-only. |
| S2-8 | Today, if `GET /api/admin/system-config` fails, `fetchData` throws and blanks the **whole** page, pricing included. If the pricing read fails, the error is swallowed (`:213-215`, "supplementary data") and the table shows empty with no message. | After the split, the pricing page no longer depends on the settings read. C2-4 fixes the empty table on error. |
| S2-9 | **No new route is needed.** The moved sections already call `GET/PUT /api/admin/system-config`, `GET/POST/PUT/DELETE /api/admin/boost-packs`, `PUT /api/admin/calculator-config` and `GET /api/pricing/config`. The pricing table calls `GET/PUT /api/admin/system-config/pricing` and `POST .../pricing/sync`. Every admin route here is gated (access doc register rows 17-21 and 55-61). | No `adminGate.writes` change, no new register row, and no guard cap moves. |
| S2-10 | What the tests pin today. `AdminSidebar.nav.test.ts` pins: Settings as an exact list; the parked section at 13 items (in two assertions); `allHrefs` at 26; at least 27 pages in the disk scan; "AgentsPilot" in every parked description; and unique names. Its parser regex cannot read an apostrophe in a name or description. `business-os-llm/__tests__/nav.test.ts` needs `/admin/system-config` to stay in Settings, after Business OS AI, and needs the pricing page never to contain the string `business-os-llm`. `AdminHeader.tsx` maps only five routes. Every other page shows "Admin Console" in the header and has its own `<h1>`. | See C2-6 and §C, "AdminHeader". |

### B. `console.*` counts (FR-PR6, TA-13) and the scope ruling

Counted with `grep -c 'console\.'` on `5061489b`.

| File | `console.*` | In the slice 2 diff? | Ruling |
|---|---|---|---|
| `app/admin/system-config/page.tsx` | **20** | Yes (split) | Converted. About 9 stay with the pricing page (`:199-214`, `:264`, `:321`, `:356`); the rest go to the parked page. `:264` sits in the shared `fetchData`, so it ends up on both pages. |
| new parked page | inherits ~12 | Yes (new) | Created already converted. |
| `app/admin/components/AdminSidebar.tsx` | 0 | Yes | — |
| `app/api/admin/system-config/pricing/route.ts` | 0 | Yes (C2-7) | Already Pino. |
| `app/api/admin/system-config/route.ts` | 0 | Header comment only (C2-9) | Already Pino. |
| `app/api/admin/boost-packs/route.ts` | **11**, plus 8 responses that return `error.message` without the `NODE_ENV` guard | Only if Q-SA2-1 = yes | See the ruling below. |
| `app/api/admin/calculator-config/route.ts` | **6**, plus 2 unguarded `error.message`. One call logs the whole `updates` body | Only if Q-SA2-1 = yes | See the ruling below. |
| `app/api/pricing/config/route.ts` | **22**, and no `createLogger` at all | No | Recorded as debt (below). |
| `app/api/admin/system-config/pricing/sync/route.ts` | 0 | No (Sync is parked) | — |
| `app/admin/onboarding/page.tsx` | 3 | No (the move is a sidebar change) | TA-13 confirmed: not touched. |
| `app/api/admin/onboarding-config/route.ts` | 3 | No | Not touched. |
| `app/admin/components/AdminHeader.tsx` | 0 | No | — |

**Ruling.**

- **"Touched" means a file in the slice's diff.** FR-PR6 is **mandatory** for the page split and for every file the diff edits.
- **The two admin routes behind the moved sections** (`boost-packs`, 11; `calculator-config`, 6) are reused unchanged in path and contract, so FR-PR6 does not reach them by itself. Dev will still open them to check that the moved sections work, and that brings them under CLAUDE.md § Logging (flag, propose, convert unless the user declines). They are flagged here.
  - **SA recommends converting them in the same PR.** The conversion is logging only, plus the `NODE_ENV` guard on the error details they return. Nothing else in their contract changes.
  - This is asked as Q-SA2-1. CLAUDE.md's default applies: **convert unless the user says no.**
- **`/api/pricing/config`** (22 calls) is a **public**, non-admin AgentsPilot route that builds its own Supabase client inline (a rule 1 debt). A logging pass alone would leave its real defect in place, and it is not part of the admin surface. It is **recorded as debt**, not converted in slice 2.

### C. Technical rulings

| # | Ruling |
|---|---|
| **TA-2** | **Confirmed: a new page, not hidden sections.** If the sections were hidden in place, the BOS pricing page would keep three AgentsPilot fetches, an AgentsPilot save path, and the settings-read failure mode (S2-8). It would also keep one sidebar entry whose label is wrong for half the page. **Route: `/admin/agentspilot-billing`** (`app/admin/agentspilot-billing/page.tsx`). The name puts the product first, as the parked descriptions do, so it cannot be mistaken for future Business OS billing work. **Sidebar name: "AgentsPilot billing".** The description should read something like "AgentsPilot boost packs, grace, calculator". It must contain "AgentsPilot" and no apostrophe. |
| **How to split** | **Cut, do not copy.** Each section's JSX, state, handlers and fetch move to exactly one page. The parked page is the old page minus the pricing section. The pricing page is the pricing section plus the header, the success and error banners, the refresh button and `formatCost`. No shared component is extracted (D-4, proportionality). Every moved control behaves as before, including the boost-pack credit calculation from the `billing`-category `pilot_credit_cost_usd` (S2-2). |
| **Reuse** | Every existing route is reused with its path and contract unchanged. No route moves and none is added. The only route edits are C2-7 (the flush), C2-9 (one header comment) and, if Q-SA2-1 = yes, the logging conversion of the two admin routes. |
| **AdminHeader** | **Not touched.** It maps five routes. The pricing page and the new page fall through to the default, and each carries its own `<h1>`, as every other unmapped admin page does. |
| **Authz** | The new page inherits `requireAdminPage()` from `app/admin/layout.tsx`. It must be `'use client'` with no server props (R8). No route is added, so nothing is registered in `adminGate.writes` and no guard cap moves. |
| **Schema** | Slice 2 rests on no column claim: no select changes, and the moved code is verbatim. The `business-os-schema-check` skill is **not** required. The R-21 phantom (S2-4) is already in the phantom register. |

### D. Conditions

1. **C2-1: Sync stays untouched (UC-5).** On the pricing page, the following stay byte-for-byte the same: the Sync button and its label; its helper text ("Sync to get latest pricing from providers."); the info-box paragraph "Sync Latest Pricing: Automatically fetches…"; `handleSyncPricing`; the comment at `:350`; and `app/api/admin/system-config/pricing/sync/route.ts`.
   - **The one exception:** the single `console.error` in `handleSyncPricing` becomes a `clientLogger` call. That is rule 3, and it changes logging only.
   - The workplan lists these strings, and the code review checks the diff against them.
   - The §9 Sync acceptance line is out of scope (note added in §9).
   - **For the parked Sync session:** the Sync route's audit (`logAIPricingSynced`) is also queued, not flushed (S2-5). Slice 2 leaves it as it is.
2. **C2-2: The pricing page (FR-PR1).** `/admin/system-config` keeps only the AI Model Pricing section.
   - Its `<h1>` becomes "Model pricing". The "System Config" badge goes, and so does the subtitle that names billing, boost packs and the calculator.
   - The new subtitle says that every Business OS credit charge is computed from these per-model costs. It does not describe Sync.
   - The page fetches only `/api/admin/system-config/pricing`, plus `/sync` when the button is clicked. It no longer calls `/api/admin/system-config`, `/api/admin/boost-packs`, `/api/admin/calculator-config` or `/api/pricing/config`.
   - Sidebar: name "Model pricing", description per FR-PR1. It stays in Settings, directly after Business OS AI.
3. **C2-3: The Advanced Configuration dump.** It moves to the parked page and prints only the calculator config. The `pricing_models` half is dropped, because the parked page must not fetch BOS prices only to repeat a table that has its own page. It stays read-only.
4. **C2-4: A failed pricing read is visible.** On the pricing page, a failed or unsuccessful pricing read shows the page's existing error banner (for example, "Could not load model prices"). The table must not render as an empty list. This is the same rule as slice 1's C-3: an empty list never stands in for a failed read. Nothing else on the pricing page changes behaviour.
5. **C2-5: The parked page (FR-PR2, FR-PR5, TA-2).** Create `app/admin/agentspilot-billing/page.tsx` as a `'use client'` page.
   - It holds the Billing section (grace period and boost packs), the Calculator section and the Advanced section, verbatim except for C2-3 and the logging.
   - Its `<h1>` names AgentsPilot. The boost-pack heading becomes **"AgentsPilot boost packs"**, and the add button keeps working.
   - The grace period and the pilot credit cost both move here (S2-3, S2-4: neither has a BOS reader).
6. **C2-6: Sidebar and tests in one change (FR-FT1, FR-FT2).**
   - **`AdminSidebar.tsx`:**
     - Settings becomes `[business-os-llm, system-config, settings]`.
     - The parked section gains `/admin/onboarding` and `/admin/agentspilot-billing`, for 15 items. The onboarding entry's description gains "AgentsPilot" (for example, "AgentsPilot free-tier grant").
     - The Plans & entitlements description says that the BOS free trial lives there (for example, "Business OS plans & trial, read-only").
   - **`AdminSidebar.nav.test.ts`:**
     - Update the Settings list.
     - Change both "thirteen" assertions to 15, and name both new hrefs.
     - Change `allHrefs` from 26 to 27.
     - Raise the disk-scan floor from 27 to 28, with `toContain('/admin/agentspilot-billing')`.
     - Re-count the numbers in the comments.
     - Add a pin that `/admin/system-config` is named "Model pricing".
   - **`business-os-llm/__tests__/nav.test.ts`** must pass unedited.
7. **C2-7: Price-change audits are flushed (FR-PR4).** In `app/api/admin/system-config/pricing/route.ts`, PUT, POST and DELETE flush the audit trail after `logAIPricing*` and before responding. Use the WC-7 line: `await auditTrail.flush().catch(err => requestLogger.error({ err }, 'Audit flush failed'))`.
   - The non-blocking rule stays: a failed audit or flush never fails a write that succeeded.
   - **Route tests:** PUT calls flush after the audit, and a rejected flush still returns 200.
8. **C2-8: Logging (FR-PR6, TA-3).** Both pages log through `clientLogger` from `@/lib/logger/client`: context first, errors as `{ err }`.
   - **No payloads in logs.** Six calls print a whole response or error body: `Settings result`, `Pricing API result`, `Calculator config result`, `Loaded calculator config`, and the two error-text dumps. Each becomes status and count only.
   - Neither page contains `console.`.
   - If Q-SA2-1 = yes, the two admin routes use their existing `requestLogger`, and their 500 responses put `error.message` behind the `NODE_ENV === 'development'` guard.
9. **C2-9: Comments that name the old page.** The header of `app/api/admin/system-config/route.ts` names `app/admin/system-config/page.tsx` as its caller. Change it to the parked page. No code changes in that file.
10. **C2-10: Source guard and type check.** Add one small co-located Jest source test. It asserts that:
    - the pricing page makes no `boost-packs`, `calculator-config`, `/api/pricing/config` or settings (`/api/admin/system-config'`) fetch, and does not contain `payment_grace_period_days`;
    - neither page contains `console.`;
    - the parked page contains "AgentsPilot boost packs";
    - the C2-1 Sync strings are still on the pricing page, verbatim.

    Then run `tsc` on the touched files with `NODE_OPTIONS=--max-old-space-size=8192`, and check the exit code. `ts-jest` does not type-check in this repo.
11. **C2-11: Access doc, in the same PR.** In `ADMIN_IDENTIFICATION_AND_ACCESS.md`:
    - re-count the `/admin` pages **from disk**: 27 on `5061489b` (the doc says 26), and 28 after this slice;
    - add `agentspilot-billing` to the list of pages that "inherited it without an edit";
    - add a Change History row.

    No handler register row, census change or cap change is needed (S2-9). In `docs/BOOST_PACK_ADMIN_INTERFACE.md`, a one-line pointer to the new URL is optional.
12. **C2-12: Manual QA, as a platform admin.**
    - Edit one model price, and check that an `AI_PRICING_UPDATED` audit row appears with before and after.
    - On `/admin/agentspilot-billing`, load and save the grace period, a boost pack and the calculator config.
    - Check that `/admin/onboarding` still loads by URL.
    - Check that neither parked entry appears in the sidebar.
    - Check that Sync looks and behaves exactly as before. Do not press it on production.

### E. PR split and effort

**One PR.** The page split and the free tier move are both sidebar data changes pinned by the same test, so C2-6 updates that test once. The pricing page and the parked page are two halves of one file. Shipping them separately would leave a window in which the AgentsPilot sections exist on neither page, or on both. The PR reverts as a unit (D-6).

**Effort: S to M, about 1 to 1.5 days.**

| Part | Estimate |
|---|---|
| Page split of a 1,989-line file, mostly cut and paste, with the 20 logging conversions | ~0.5 day |
| Sidebar and its tests | ~0.25 day |
| Audit flush and its tests | ~0.1 day |
| Source guard, docs and QA | ~0.5 day |
| Q-SA2-1 = yes (two admin routes converted) | adds ~0.25 to 0.5 day |

### F. Question for the user (business terms)

- **Q-SA2-1: Should this slice also tidy the two AgentsPilot boost-pack and calculator save routes?** They sit behind the page being moved. They still log the old way, and when something fails they can show the admin raw database error text. Fixing them changes nothing anyone sees in normal use, and adds about half a day to this slice. *Recommended: yes, it is the project's standing rule for files we open. **Default if you say nothing: yes.*** Say no to leave them as recorded debt, since they serve the parked AgentsPilot product.

### Approval
- [x] Requirement for slice 2 approved, **with conditions C2-1..C2-12**. FR-PR3 and the §9 Sync line are out of scope (UC-5). Dev writes one workplan for one PR, and SA reviews it before any code.

---

## SA Review — slice 3 (2026-10-03)

**Reviewed by SA — 2026-10-03.** **Scope: slice 3 only.** That is §4.1 FR-AC1..FR-AC6; NF-3 and NF-7 (§3); V-1..V-3 (§2); TA-6, TA-7, TA-8 and TA-11 (§10); the slice 3 lines of §5, §6, §9 and §15; and the Privacy NFR (§8) as it applies here.
**Ref:** `fix/admin-ai-cost-bos-lens` @ `19566036` (origin/main; slices 1, 2 and 5a merged). Code read on that ref. Live schema probed read-only (§A).
**Status: APPROVED WITH CONDITIONS.** Dev may write the workplan once conditions C3-1..C3-12 are carried into it. Where this section differs from §3, §4.1, §5 or §10, **this section governs**.

### A. Schema check (TA-11), measured live and read-only

**Method:** a one-column-at-a-time `select(col).limit(0)` probe against the live database with the service role, then each of the route's whole selects replayed the same way, plus the step-name read with its `.eq()` filter. No rows returned, nothing written, no DDL. `npm run schema:check` was not used: the execution-detail reads are `select('*')` or have a filter column, and both are its blind spots.

| Table.column | Live | Used by (`drill-down/route.ts`) | Rule 5 shape |
|---|---|---|---|
| `workflow_executions.input_data` | ❌ **missing** (42703) | execution detail `:995` | **Never worked.** Its value is rendered (the Input Data section). Retire it (C3-5). Do not rebuild it |
| `workflow_executions.output_data` | ❌ **missing** (42703). **NEW, not in V-3.** PostgREST names only the first unknown column, so the whole-select check reports only `input_data` | execution detail `:995` | **Never worked.** Retire it (C3-5) |
| `workflow_step_executions.execution_id` | ❌ **missing** (42703). **NEW.** It is a **filter** column (`.eq('execution_id', …)`, `:1029`), and the error is discarded. The real key is `workflow_execution_id` (live ✅; `lib/pilot/StateManager.ts:1122` writes it) | step-name lookup `:1027-1029` | **Right idea, wrong column name.** The step names have never loaded, so every call row shows a fallback label. Fix the filter (C3-6) |
| `workflow_executions.id, agent_id, started_at, completed_at, status` | ✅ | execution detail, execution labels | — |
| `workflow_executions.final_output, execution_results` | ✅ exist | not used | The look-alikes of input/output. **Must not** be substituted (C3-5) |
| `agents.id, agent_name, user_prompt, system_prompt, pilot_steps, input_schema, output_schema, connected_plugins, mode, status` | ✅ all exist | execution detail `:1004` | The prompt columns are real. See §B, finding S3-1 |
| `workflow_step_executions.step_id, step_name` | ✅ | step-name lookup | — |
| `profiles.id, full_name` | ✅ | label lookups | — |
| `token_usage`: all 22 columns the route reads from its `select('*')` rows | ✅ all exist | both execution-detail paths | `select('*')` is a schema-check blind spot, so these were probed by hand |
| Whole select `workflow_executions(agent_id, started_at, completed_at, status)` | ✅ runs | — | This is the shape after C3-5 |
| Whole select `workflow_step_executions(step_id, step_name)` with `.eq('workflow_execution_id', …)` | ✅ runs | — | This is the shape after C3-6 |

### B. As-built findings

| # | Finding | Effect |
|---|---|---|
| **S3-1** | **NF-3 is latent today, and FR-AC5 alone would switch it on.** The phantom makes the `workflow_executions` read fail. Its error is discarded, so `executionInfo` is null (`:993-998`). The agent read runs only `if (executionInfo?.agent_id)` (`:1001`), so **no prompt has ever been sent**. Input and output have never been sent either: they are the phantom columns. If FR-AC5 drops the two phantom columns and nothing else changes, the read succeeds, `agent_id` resolves, and **every "All" scope execution detail starts sending that agent's `user_prompt`, `system_prompt` and `pilot_steps`, for any account**. NF-3 says the route "returns" this text. It does not today. It would from the day FR-AC5 ships alone. | **FR-AC5 and TA-8 are one change.** See the ruling in §C. |
| S3-2 | **The page reads no drill state from its URL.** It reads only `scope`, `user` and the linked window (`page.tsx:223-250`). `breakdownBy`, `agent`, `execution` and `category` live in React state only. So a hand-edited **page** URL already cannot open the hidden views. The only way to ask for them is a direct call to the API, which is admin-only and with `scope=all` returns the same data anyway. | TA-6 is a consistency rule, not a security boundary. It is still confirmed, because it is cheap and makes FR-AC4 testable on the route (C3-3). |
| S3-3 | **Default scope.** The page defaults to `bos` unless the URL says `scope=all` exactly (`:223`). The **route** defaults to `all` when `scope` is absent (`:209`), and `wire.qa.test.ts:133` pins that. | Both defaults stay. TA-6 applies only when `scope=bos` is sent. |
| S3-4 | **The execution path ignores `scope` completely.** `if (q.execution) return await getExecutionCalls(…)` (`:228-230`) runs before any scope logic, and the `single-<token_usage id>` path returns any ledger row by id. | Closed by TA-6 (C3-3). |
| S3-5 | **In BOS scope, the page drills into Agent by itself.** A row click under Activity, Request Type, Feature, Component, Endpoint or User sets `nextBreakdown = 'agent'` (`:394-421`). So hiding the Agent group-by in the menu alone does not keep an operator out of it, and after TA-6 that click would get a 400. | C3-2 replaces those transitions in BOS scope. |
| S3-6 | **NF-7 confirmed by code reading.** Business OS calls are built by `buildBosCallContext` (`lib/business-os/llm/callCatalog.ts:279-306`). It sets no `category`, so the tracker records `general` (`lib/ai/providers/baseProvider.ts:142`), which the classifier maps to **System**. Business OS embeddings record `category: 'embedding_generation'` and `activity_type: 'embedding'` (`lib/services/EmbeddingService.ts:124-125`). Neither is in any list, so they fall through to **System** too. The only Business OS `activity_type` extra found is `narration`, which is also System. So in BOS scope the System card is the Total card again, apart from any legacy-tagged rows that carry an AgentsPilot category. | TA-7 is **overruled** in form: hide all four cards in BOS scope, without a measure-then-decide branch (C3-1). |
| S3-7 | **The execution-detail panel renders only when an agent was found** (`page.tsx:1292`, `executionDetails?.agent &&`). Timing and status sit inside that panel. | After C3-5 an "All" scope execution with an agent shows timing and status again (FR-AC5). An execution with no agent still shows none. That is unchanged and accepted. |
| S3-8 | **The per-call view of Business OS calls.** Business OS ledger rows carry no `execution_id`, so in BOS scope the Execution group-by lists each call as its own `single-<id>` row. That is the only thing the Execution group-by did for BOS. | Hiding it loses little. The Business OS per-call view is the AI activity view on the Audit trail page, and per-area costs are on Business OS AI. |
| S3-9 | **Error handling on the execution path.** The executions, agent and step reads all discard `error` (`:993`, `:1002`, `:1026`). `getExecutionCalls` and `getAggregatedData` log through the module `logger`, not the request's `requestLogger`, so those lines carry no `correlationId`. The 500 bodies are `{ success: false, error }`, with no detail, which is compliant. | FR-AC6 and C3-7. |
| S3-10 | **Only one caller.** `/api/admin/token-usage/drill-down` is fetched only by `app/admin/analytics/page.tsx:312`. Nothing else reads `executionDetails`. | Narrowing the response shape (TA-8) breaks no other consumer. |

### C. Technical rulings

| # | Ruling |
|---|---|
| **NF-3 / TA-8** | **In slice 3, in the same PR as FR-AC5, and not optional.** S3-1 is the reason: once the phantom is gone, the prompt read starts working. Shipping FR-AC5 first and TA-8 "later" would turn a latent exposure into a live one for the time in between. Two more reasons. Rule 5 classes `input_data` and `output_data` as **never worked**, and its answer is "rebuild or retire". Rebuilding them from `final_output` or `execution_results` would **start** sending cross-account run payloads, which is exactly what the Privacy NFR (§8) forbids. So retiring them is the TA-8 decision itself. And the user's standing order puts privacy items first. The cost is small: one select narrowed, one response object trimmed, and five page sections deleted. **NF-3's wording is corrected by S3-1:** the text has never reached a browser. |
| **TA-8, exact cut** | The agent block keeps only **`id`, `name`, `mode`, `status` and `connectedPlugins`** (plugin keys are metadata). `pilot_steps` goes as well as the two prompts, because the steps hold the agent's AI instructions as owner text. `input_schema` and `output_schema` go too, because their field descriptions are owner text and cost analysis does not need them. The cut is made **in the `select`**, so the text never leaves the database. Removing keys from the response object alone is not enough. The execution block keeps `executionId`, `startedAt`, `completedAt` and `status`. Per-call metadata is unchanged. |
| **TA-6** | **Confirmed and extended.** When `scope=bos`, the route refuses, with a 400 in the standard error format: `breakdownBy=agent` or `breakdownBy=execution`; any `execution` value, including `single-…`; any `agent` value; and any `category` other than absent or `all`. Implement it as one refinement on `DrillDownQuerySchema`, so it runs before the execution short-circuit (S3-4). With `scope=all`, or with `scope` absent, nothing changes (S3-3). |
| **TA-7** | **Overruled in form. Hide all four category cards in BOS scope: Creation, Execution, Memory and System.** Only the Total card stays. The four categories are AgentsPilot's taxonomy, and the classifier knows no Business OS area. In BOS scope the System card is either the Total repeated (S3-6) or a mislabelled mix. No branch depends on a measurement. **Dev still records one observation in the workplan:** the four card values in BOS scope for the 30-day and 90-day periods, read off the current page. That costs nothing and needs no SQL. The user is told in the slice summary (FYI-3). The route keeps returning `categoryTotals`. It is harmless metadata. |
| **OI-9 (raw `createClient`)** | **Stays recorded debt. Not in scope.** Slice 3 edits two of the inline reads (the executions columns and the step-name filter) and narrows a third (the agents columns). It **adds no inline read**. Moving them would need new admin, all-accounts methods on three AgentsPilot tables (`workflow_executions`, `agents`, `workflow_step_executions`), each with its own source guard. That is the work OI-9 describes, and none of it is BOS-relevant. This is the same ruling as slice 5a. The workplan names the debt. The label lookups' unpaged `auth.admin.listUsers()` (NF-5) and their discarded errors are also left as they are. |
| **Logging and error format** | `console.*` is counted in §D: **0** in both files. The 400 that TA-6 adds uses `details: process.env.NODE_ENV === 'development' ? … : undefined`, as the existing validation 400 does. The new and changed log lines go through `requestLogger`, so they carry the `correlationId`. |
| **Guards and register** | **None move.** The route is a gated `GET` (access doc register row 65), it stays gated, and `requireAdmin` stays its first statement. Nothing is a write, so nothing goes into `adminGate.writes`. No R1/R2 cap changes. No sidebar change, so the nav tests are untouched. The access doc's OI-9 text ("the drill-down route's label lookups and execution-detail path" are still inline) stays true. |
| **Pinned tests** | No test pins `executionDetails`, the prompts, the category cards or the group-by list. `wire.qa.test.ts:133` pins the route default of `all`, and it must pass unedited. `route.test.ts` mocks `@supabase/supabase-js` with a proxy that resolves every chain to `{ data: [] }`. That is enough for the existing tests, but the execution-detail tests in C3-9 need a mock that records the table, the select string and the filters for each call. |
| **R-20 / §5** | §5 calls the phantom fix "XS, Low, AP cleanup". S3-1 changes that: it is coupled to a privacy change and ships with it. The slice stays **S–M** overall. |

### D. `console.*` counts and the scope ruling

Counted with `grep -c 'console\.'` on `19566036`.

| File | `console.*` | In the slice 3 diff? | Ruling |
|---|---|---|---|
| `app/admin/analytics/page.tsx` (1,760 lines) | **0** | Yes | Compliant. If Dev adds a client log line, it uses `clientLogger`. |
| `app/api/admin/token-usage/drill-down/route.ts` (1,375 lines) | **0** | Yes | Already Pino. C3-7 moves the execution path onto `requestLogger`. |
| `app/admin/analytics/linkedWindow.ts` | — | No | Not touched. |
| `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` | — | No | Not touched. Neither of its reads changes. |
| the four existing test files under `app/admin/analytics/__tests__/` and `drill-down/__tests__/` | — | Extended | Test files only. |

**Scope ruling.** Nothing needs converting. No file outside the two above should be in the diff, apart from the tests and the phantom register (C3-11). **No scope expansion.**

### E. Conditions

1. **C3-1: Category cards in BOS scope (FR-AC1, TA-7).**
   - In BOS scope, render **only the Total card**. Creation, Execution, Memory and System are not rendered.
   - In "All" scope, all five render exactly as today.
   - Keep the existing grid and card classes (D-4). Do not restyle the Total card.
2. **C3-2: Group-bys, chips, breadcrumbs and drill path in BOS scope (FR-AC2).**
   - The Group By list omits **Agent** and **Execution**.
   - The Agent and Execution active-filter chips and breadcrumbs, and the Category chip, are not rendered. They cannot be set in BOS scope after C3-3/C3-4. This is defence in depth.
   - The `ContextChips` "N agents" and "N executions" chips are not rendered.
   - **Drill path (S3-5).** Wherever the "All" scope transition in `handleRowClick` would go to `agent` or `execution`, BOS scope goes instead to the first of `feature`, `component`, `user`, `model`, `provider` that is not already filtered and is not the dimension just clicked. If there is none, the group-by stays as it is.
   - Derive the list with one `scope`-aware helper, for example `breakdownOptionsFor(scope)`, so the menu and the drill path cannot disagree.
   - In "All" scope, every transition is unchanged.
3. **C3-3: The route refuses hidden views in BOS scope (FR-AC4, TA-6).** Use one refinement on `DrillDownQuerySchema`, as ruled in §C. The 400 is the existing `'Invalid query parameters'` shape, with the `NODE_ENV` guard on `details`. Log at `warn` with the rejected parameter **names** only, never values. `scope` absent and `scope=all` behave exactly as today.
4. **C3-4: Switching to BOS scope clears hidden state (FR-AC3).** In the toggle's handler, and **in the same event** as `setScope('bos')`:
   - clear `filters.agent`, `filters.execution` and `filters.category`, and their labels;
   - reset `breakdownBy` to `provider` if it is `agent` or `execution`;
   - clear `selectedCall` and `executionDetails`.

   React 18 batches these updates, so the first BOS request never carries a refused parameter, and a 400 or blank page cannot occur. Switching back to "All" restores nothing.
5. **C3-5: The execution read, and the TA-8 cut (FR-AC5, NF-3).** These ship as **one change**.
   - The `workflow_executions` select becomes `agent_id, started_at, completed_at, status`. Do **not** substitute `final_output` or `execution_results`.
   - The `agents` select becomes `id, agent_name, connected_plugins, mode, status`.
   - `executionDetails` loses `inputData` and `outputData`. Its `agent` loses `userPrompt`, `systemPrompt`, `pilotSteps`, `inputSchema` and `outputSchema`.
   - On the page, delete the matching interface fields and the five render sections: Pilot Steps, Input Schema, Output Schema, Input Data, Output Data and User Prompt. Delete any `expandedSections` key that was used only by them, including the `'pilotSteps'` default. No dead UI is left behind.
6. **C3-6: The step-name lookup.** The filter becomes `.eq('workflow_execution_id', executionId)`. The select stays `step_id, step_name`.
7. **C3-7: Failed execution-detail reads are logged (FR-AC6).**
   - Pass `requestLogger` into `getExecutionCalls`.
   - Bind `error` on the executions, agents and step-name reads. A failure logs at `error` with `{ err, executionId }`. "No rows", which is PostgREST code `PGRST116` from `.single()`, logs at `warn` or `info`, not `error`.
   - A failure of those three reads does **not** fail the response. The calls are still returned, and the panel is absent, as S3-7 describes.
   - A failure of the `token_usage` read still returns the existing 500.
   - Log no prompt, payload or step text.
8. **C3-8: No other route change.** The aggregate path, `getAvailableFilters`, the label lookups, the comparison read (OI-P2, parked), the classifier and the `single-` path stay as they are, apart from C3-3. The OI-9 inline client stays, and the workplan names it as debt (§C).
9. **C3-9: Tests.** Every test below is in the same PR.
   - **Route, BOS refusals.** With `scope=bos`, each of `breakdownBy=agent`, `breakdownBy=execution`, `execution=<uuid>`, `execution=single-<uuid>`, `agent=<uuid>` and `category=memory` returns 400 **before any read**.
   - **Route, "All" unchanged.** The same parameters with `scope=all` return 200. `wire.qa.test.ts:133` passes unedited.
   - **Route, execution detail.** With a per-table mock:
     - the `workflow_executions` select names neither `input_data` nor `output_data`;
     - the `agents` select names none of `user_prompt`, `system_prompt`, `pilot_steps`, `input_schema` or `output_schema`;
     - the step read filters on `workflow_execution_id`;
     - **the serialised response contains none of** `userPrompt`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`, `inputData` or `outputData`, even when the mock returns those columns;
     - `startedAt` and `status` come through;
     - a failed executions read is logged and still returns 200 with the calls.
   - **Page, both scopes.** BOS: no Creation, Execution, Memory or System card, and no Agent or Execution group-by. "All": all of them render. Switching from "All" with Agent selected to BOS sends a request whose `breakdownBy` is not `agent` (C3-4). In BOS, a Feature row click does not request `breakdownBy=agent` (C3-2).
   - **Source guard.** Add one small co-located test. It asserts that `route.ts` contains neither `input_data` nor `user_prompt`, and that `page.tsx` contains neither `userPrompt` nor `inputData`. This stops a later "restore the detail" edit from bringing the text back silently.
10. **C3-10: Type check and schema re-check.**
    - Run `tsc` on the two touched files with `NODE_OPTIONS=--max-old-space-size=8192`, and check the tool's own exit code. `ts-jest` does not type-check in this repo.
    - Re-run the §A probes, or `npm run schema:check`, after the change. Record the ref and the result in the workplan.
11. **C3-11: Phantom register, in the same PR.** In `docs/workplans/business-os-phantom-column-remediation.md`, record the three live findings with this ref, their classification (§A) and their resolution (C3-5, C3-6). Add a Change History row. No access-doc change is needed (§C, "Guards and register").
12. **C3-12: Manual QA, as a platform admin.**
    - **BOS scope (the default):** only the Total card; no Agent or Execution group-by; clicking through Provider → Model → Activity → a row never lands on Agent; the page does not error.
    - **"All" scope:** all five cards and every group-by are back. Open one execution with an agent, press "Show details", and check that timing and status show and that no prompt, step, schema, input or output section exists.
    - **Developer tools:** open the same execution-detail response in the Network tab and check that none of the C3-9 keys is present.
    - **Switching:** with Agent selected in "All", switch to BOS. Check that there is no error banner and that the group-by is Provider.

### F. PR split and effort

**One PR.** C3-5 cannot be split from TA-8 (S3-1). The page and the route also have to land together. TA-6 refuses parameters that today's page still sends in BOS scope (S3-5), so a route-first PR would break the page until the page PR landed. The PR reverts as a unit (D-6).

**Effort: S to M, about 1.5 days.**

| Part | Estimate |
|---|---|
| Page: scope-aware cards, menu, chips and drill path (C3-1, C3-2, C3-4), and deleting the five detail sections (C3-5) | ~0.5 day |
| Route: TA-6 refinement, the three select or filter fixes, the TA-8 cut, logging (C3-3, C3-5..C3-7) | ~0.25 day |
| Tests (C3-9) | ~0.5 day |
| Type check, schema re-check, phantom register, QA (C3-10..C3-12) | ~0.25 day |

### G. For the user (business terms)

There is no blocking question. Three things to know, with the default that applies if you say nothing:

- **FYI-1: Agent text will stop being shown in the cost screen.** The cost screen's execution view in "All" mode will show an agent's name, timing, status and plugins. It will no longer show its instructions, steps, inputs or outputs. Today a defect hides them anyway, and fixing that defect without this change would start showing them for every customer. *Default: removed. Say so if you want any of it kept.*
- **FYI-2: Business OS mode drills by area, not by agent.** In Business OS mode, clicking down through the table moves from feature to component to account. It never moves to agents or runs, because Business OS has none. The per-call Business OS view stays on the Audit trail's AI activity view.
- **FYI-3: Business OS mode keeps only the Total card in the top row.** The Creation, Execution, Memory and System cards are AgentsPilot categories. In Business OS mode, almost all of the spend lands in "System", so that card just repeats the Total. All five cards come back in "All" mode. *Default: hide all four in Business OS mode.*

### Approval
- [x] Requirement for slice 3 approved, **with conditions C3-1..C3-12**. TA-8 is **in** slice 3, in the same PR as FR-AC5. TA-6 is confirmed and extended, TA-7 is overruled in form (C3-1), and OI-9 stays debt. Dev writes one workplan for one PR, and SA reviews it before any code.

---

## SA Review — slice 7 (2026-10-04)

**Reviewed by SA — 2026-10-04.** **Status: ✅ APPROVED WITH CONDITIONS (C7-1..C7-16).** **Scope: slice 7 only** (§4.2 FR-Q1..FR-Q7, the slice 7 lines of §9, TA-9, and the §5, §6 and §8 entries that touch them). Measured on `feature/admin-queue-actions` @ `5f10a926` (= `origin/main`). User inputs used: OQ-3 = a 72-hour retry window, then cancel only, enforced on the server; OQ-4 = "Drain now" is in. Both admins are owners. Every action needs a reason and an audit row, and no second-admin approval is needed (OQ-6 spirit; I found no reason to differ).

### A. Schema check (TA-11), live, read-only

Zero-row selects (`limit(0)`) with the service role. No RPC was called and nothing was written.

| Table | Confirmed present | Confirmed **absent** (42703) |
|---|---|---|
| `payment_reminders` | `id, user_id, status, claimed_by, claimed_at, attempts, next_attempt_at, error_message, created_at, scheduled_at, sent_at, invoice_id, installment_id, contact_id, reminder_type, channel` | `skip_reason`, `updated_at` |
| `payment_automation_executions` | the same claim set, plus `scheduled_at, executed_at, rule_id, entity_type, entity_id, trigger_event_id` | `updated_at` |
| `daily_briefing_sends` | the claim set, plus `briefing_date, timezone, skip_reason, sent_at` | `scheduled_at` |
| `lead_responses` | the claim set, plus `kind, contact_id, entity_id, skip_reason, sent_at` | `scheduled_at` |
| `insight_actions` | the claim set, plus `kind, skip_reason, sent_at, dedupe_key` | `scheduled_at` |
| `bos_cron_runs` | `id, job, source, started_at` | — |

Consequences: **no queue table has `updated_at`**, so the compare-and-set version is `status` plus `attempts` (C7-3). `payment_reminders` has no `skip_reason`. The three non-payment tables have **no `scheduled_at`**, and they carry a status CHECK (`pending, processing, sent, skipped, failed`), so `'cancelled'` would be rejected there (C7-6).

### B. As-built findings that shape the design

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| B7-1 | All five claims are `FOR UPDATE SKIP LOCKED` RPCs that select `status = 'pending'` only and bump `attempts`. All five reapers use `claimed_at < now() - lease`, with a 90 s lease against `maxDuration = 60` on every cron route. | the 5 migrations (`2026-08-14_*_claim.sql`, `20260911`, `20260914`, `20260917`). The cron routes for payment reminders, payment retry, the briefing and insight actions export `maxDuration = 60`. | A row that an admin moves to `pending` is sent **only** by the next claim. It cannot be sent inline. |
| B7-2 | **The terminal writes are fenced by `id` only**, not by `claimed_by` or status: `LeadResponseRepository.finish`, `InsightActionRepository.close`, `DailyBriefingSendRepository.markTerminal`, `PaymentAutomationExecutionRepository.complete/fail`, and `PaymentReminderRepository.updateStatus` (`id` + `user_id`). | the repositories | So the **only** thing preventing a double send is "a row is never re-claimed while its runner is alive". That is the lease rule. Any admin action that moves a leased in-progress row back to `pending` breaks it (C7-2). |
| B7-3 | **`payment_automation_executions` does nothing today.** `callBlockExecutor` is a placeholder that returns `{executed: true}` (`PaymentAutomationEngine.ts:129-151`). The block catalogue includes **money-moving blocks** (`charge_saved_method`, `refund_full`, `refund_partial`, `retry_payment`). Its `failed` status also holds guardrail decisions (`max executions reached`, `cooldown active`). | `lib/payments/PaymentBuildingBlocks.ts` | Retrying is meaningless today, and becomes a money action the day blocks are wired. **No retry on this queue** (C7-5). |
| B7-4 | **The briefing renders for "now", not for the row's date.** `dispatchOne(row.user_id, row.timezone, now)` builds today's facts. | `DailyBriefingDispatchService.ts:69-75, 157-160` | Retrying yesterday's row would send **today's** briefing on yesterday's ledger row. Today's enqueue then sends it again, because `UNIQUE(user_id, briefing_date)` sees a different date. That is a double send. Retry is allowed **only on the row's own business date** (C7-7). |
| B7-5 | The payment-reminders cron also **bills stages** (`billDueDatedStages`), **schedules overdue reminders** (`processOverdueItems`, a select-then-insert dedupe over 24 h) and **marks invoices overdue**. The payment-retry cron also runs **`paymentRetryService.processDueRetries()`**, which retries Stripe charges. | `app/api/cron/payment-reminders/route.ts:105-130`, `app/api/cron/payment-retry/route.ts:70-73` | Running those beside a concurrent cron could double-schedule a reminder, double-bill a stage or double-retry a charge. **Drain now calls only the claim-path drain** (C7-10). |
| B7-6 | The dispatchers re-check the world at send time: settled invoice → `cancelled` (payment reminders); owner consent, applicability, booking state and appointment passed (lead responses); daily cap, settled invoice and business exists (insight actions). | `PaymentReminderService.ts:573-579`, `LeadResponseDispatchService.ts:95-130`, `InsightActionDispatchService.ts:150-190` | A retried item is checked again before it is sent. The 72-hour rule is a business limit on top of that, not the only safety net. |
| B7-7 | Payment reminders keep **sending hours** (08:00–20:00, business time zone) by writing them into the due time (`sendableAt`, private). The claim does not check the hour. | `PaymentReminderService.ts:1270-1310` | A retry pressed at 02:00 business time would send at 02:00 unless the retry writes a sendable time (C7-8). |
| B7-8 | Each failure path spends **exactly one attempt** when a row is already at the attempt limit: briefing `markFailed` when `attempts >= 3`; lead rows stay in progress → the reaper dead-letters them; insight `markFailed(retryable = attempts < 5)`; payment reminder → `failed`. | the dispatchers | **A retry that does not reset `attempts` buys exactly one more try.** That bounds a bad retry to one extra message (C7-4). |
| B7-9 | The stuck-row reaper never reaches an in-progress row whose `claimed_at` is NULL (`NULL < x` is not true). The page's "stuck" count includes them (`claimed_at.is.null`). Only legacy or hand-written rows can be in that state: the payment-automation migration remapped `executing` → `running` without a lease. | `AdminJobsQueuesRepository.ts` (stuck filter), `2026-08-14_payment_automation_executions_claim.sql` step 2 | These are the only rows a per-item action is needed for. They are **cancel-only** (C7-2). |
| B7-10 | `withCronRunRecord` records only a proven Vercel call (`source` `vercel_cron`/`other`). The Jobs page uses those rows to show whether a cron is alive. | `lib/cron/cronRunRecorder.ts`, `20261011_bos_cron_runs.sql:323` | If Drain now wrote a run row, it would hide a dead cron. It writes none (C7-11). |
| B7-11 | **Pre-existing, out of scope:** `POST /api/business-os/leads/[id]` calls `dispatchLeadResponses()` **fire-and-forget**, and exports no `maxDuration`. `vercel.json` sets no function default. So the "lease > maxDuration" invariant is **not pinned** on that path. With B7-2, a run longer than 90 s could be re-claimed and re-sent. | `app/api/business-os/leads/[id]/route.ts:80` | Recorded in the §11 backlog note below (BL-7a). It is **not** fixed here, but slice 7 must not copy the pattern (C7-10). |
| B7-12 | The OQ-4 premise is stale: no queue cron is daily any more. Payment reminders run at `:40` every hour, payment retry hourly, the briefing hourly, lead responses every 5 min, insight actions every 15 min. | `vercel.json` | Drain now saves up to an hour, not a day. It is still worth having (recovery while a cron is down or `CRON_SECRET` is missing). |

### C. Ruling 1: the per-queue action matrix

"Retry" = a failed or dead-lettered item goes back to `pending` for the next claim. "Cancel" = a terminal close that never sends. **"Release" and "requeue" are not per-item actions** (C7-2): leased stuck rows are released by Drain now, which runs the queue's own reaper with its provably-dead lease. "Requeue" is the same thing as retry.

| Queue (table) | Retry (failed / dead-lettered → `pending`) | Cancel: from which states → to what | Release a stuck item | Drain now: entry point (only this) |
|---|---|---|---|---|
| **Payment reminders** (`payment_reminders`) | ✅ within 72 h of `scheduled_at`. Next try = the next **sending-hours** time (C7-8) | `pending`, `failed`, orphaned `processing` → **`cancelled`** | via Drain now. Orphaned (no lease): cancel only | `paymentReminderService.processDueReminders()`. **Never** `billDueDatedStages`, `processOverdueItems` or `markAllOverdueInvoices` |
| **Payment automations** (`payment_automation_executions`) | ❌ **Not offered.** The executor is a placeholder, money blocks come later, and `failed` includes guardrail decisions (B7-3) | `pending` (including no due time), `failed`, `dead_letter`, orphaned `running` → **`cancelled`** | via Drain now. Orphaned: cancel only | `paymentAutomationEngine.processScheduledExecutions()`. **Never** `paymentRetryService.processDueRetries()` (Stripe charges) |
| **Daily briefing** (`daily_briefing_sends`) | ✅ **only while `briefing_date` is still today** in the row's `timezone` (B7-4). That is stricter than 72 h | `pending`, `failed`, orphaned `processing` → **`skipped`**, `skip_reason = 'cancelled_by_admin'` | via Drain now. Orphaned: cancel only | `processDueBriefings()`. Its enqueue is idempotent through `UNIQUE(user_id, briefing_date)` |
| **Lead replies** (`lead_responses`) | ✅ `failed` only, within 72 h of `created_at` (C7-9). The dispatcher re-checks consent and applicability | `pending`, `failed`, orphaned `processing` → **`skipped`**, `skip_reason = 'cancelled_by_admin'` | via Drain now. Orphaned: cancel only | `dispatchLeadResponses()`. Its enqueue is an upsert with `ignoreDuplicates` on the unique key |
| **Insight actions** (`insight_actions`) | ✅ `failed` only, within 72 h of `created_at`. The daily cap is re-checked | `pending`, `failed`, orphaned `processing` → **`skipped`**, `skip_reason = 'cancelled_by_admin'` | via Drain now. Orphaned: cancel only | `drainInsightActions()` |

**Never actionable, on any queue:** a leased in-progress row (`claimed_at` not null), and every terminal success or close (`sent`, `completed`, `skipped`, `cancelled`). `skipped` rows are **not retried**: a skip is a decision (paid, cap reached, not approved), not an error (the insight dispatcher header says so). A lead reply whose email failed is closed as `skipped / send_failed`, so it is not retryable in slice 7 (BL-7b).

### D. Ruling 2: double-send design

1. **Compare-and-set (CAS), never a blind update.** Every item action is **one** `UPDATE … WHERE id = $item AND user_id = $owner AND status = $expectedStatus AND attempts = $expectedAttempts [AND the queue's own extra predicate]`. It is issued through PostgREST as `.update(patch, { count: 'exact' })`, and the action won only if `count === 1`. **Never `.or()` together with `.select()`** on an update: on prod PostgREST that fails with a misleading 42703 (known defect, 2026-09-29). One UPDATE statement is atomic against the claim. The claim's `FOR UPDATE SKIP LOCKED` skips a row the admin's UPDATE has locked, and the admin's UPDATE re-checks its WHERE after waiting on a claim's lock (READ COMMITTED), so exactly one of them wins. **No RPC and no migration is needed for this.**
2. **The version is `status` + `attempts`.** There is no `updated_at` (§A). Every claim bumps `attempts` and every reap or close changes `status`, so any drain activity between the admin's page load and the click makes the CAS miss. The client sends `expected: { status, attempts }`, which it was shown. The server **also** checks that `expected.status` is an allowed "from" state for that action on that queue (§C) **before** the UPDATE, so a client cannot widen the matrix by lying about what it saw.
3. **Retry never sends inline.** It writes `status = 'pending'`, `next_attempt_at = <eligible time>` and `claimed_by = claimed_at = NULL`. It does **not** change `attempts`, `error_message`, `skip_reason`, the payload or any target column. The send happens only through the queue's claim RPC, on the next cron run or Drain now.
4. **Drain now reuses the cron's function in-process** (§C last column). It does not call the cron URL. Against a concurrent cron, it behaves exactly like two overlapping cron runs, which Vercel already produces (drift and overlap): `SKIP LOCKED` hands each row to one runner, and the reaper is idempotent. The route exports **`maxDuration = 60`** and **awaits** the drain, so the 90 s lease stays provably dead. Fire-and-forget is forbidden (B7-11).
5. **Double-click and two admins.** The second item action finds the CAS stale (`count = 0`). The server re-reads the row: if it no longer exists in that queue → 404; otherwise → 409 `item_changed` with the current status **label**. **No audit row** is written for a lost CAS, and the refusal is logged at `info`. Two concurrent Drain now calls are safe by (4). The button is disabled while a call is in flight, and no server lock is added.
6. **What remains is at-least-once and cannot be closed here.** If an earlier attempt sent the message and then threw before closing the row, the client already has it, and a retry sends it again. The retry dialog says so in plain words (C7-13). Fencing the terminal writes on `claimed_by` (B7-2) is backlog BL-7a.

### E. Ruling 3: the 72-hour "due" timestamp per queue

| Queue | "Due" anchor | Why | Extra rule |
|---|---|---|---|
| Payment reminders | `scheduled_at` | The intended send time, never rewritten by the reaper (it writes `next_attempt_at`) | The retry's eligible time is the next sending-hours time. **Refuse if that time is later than `scheduled_at + 72 h`** |
| Payment automations | `scheduled_at` | — | Not applicable: no retry |
| Daily briefing | `briefing_date` in the row's `timezone` | The send is for a business day | **Same business day only**, which implies < 72 h |
| Lead replies | `created_at` (queued at) | The real due time lives in `next_attempt_at`, which the reaper overwrites and dead-lettering clears. No column keeps it | Conservative: a chase queued 2 days ahead can be retried until about 1 day after its due time |
| Insight actions | `created_at` | Same reason | — |

**Enforcement:** checked in the route (with a clear refusal) **and** repeated inside the CAS predicate (`.gte('<anchor>', now - 72 h)`, and `.eq('briefing_date', today)`), so the rule also holds if the clock moves between the check and the write. **Refusal:** HTTP **422** with a code (`retry_window_passed`, `briefing_not_today`, `retry_not_offered`) and the anchor time. The UI shows a plain sentence, for example: *"This message was due on 1 Oct at 09:00 (more than 72 hours ago). It can be cancelled but not re-sent."* The list (7a) marks each row "retry available until …" or "cancel only", using the same function, so the button is disabled before the server has to refuse.

**Accepted tail:** the window is checked when the admin acts. The send happens at the next claim (at most one cron interval, at most one hour, or immediately with Drain now). For payment reminders the eligible time already includes sending hours and is checked against the window.

### F. Ruling 4: tenant isolation

- **Request bodies are `.strict()` Zod.** Item action: `{ queue, itemId (uuid), action: 'retry' | 'cancel', expected: { status, attempts }, reason }`. Drain now: `{ queue, reason }`. There is **no `accountId` or `userId` field**, and a strict schema rejects one.
- **The owner comes from the row.** The route first reads the item by `(queue table, id)` through the admin repository (metadata columns only). On no row → 404. The CAS then filters `.eq('user_id', row.user_id)` with **that** value, plus `id`. Per the `tenant-isolation-guard` skill: the admin path is cross-account by design (the gate replaces CLAUDE.md rule 4), the id is caller-supplied, and the defence is to derive the owner server-side and name both keys in the write. **No trigger** exists on any of the five tables (checked), and no upsert is used, so the scope-defeating three do not apply.
- **The patch is an explicit allow-list per action** (§D.3). No body field is copied into it.
- **Drain now acts on whatever is due across accounts**, exactly as the cron does. Every effect inside the drain is already scoped to `row.user_id` by the existing dispatchers.

### G. Ruling 5: audit

| Event (new `AUDIT_EVENTS` keys) | Audience (`eventAudience.ts`) | `entityType` / `entityId` | `userId` / `actorId` | `changes` | `details` |
|---|---|---|---|---|---|
| `BOS_QUEUE_ITEM_RETRIED` | `'bos'` | `'bos_queue_item'` / the item id | **the item's account** / the admin (the entitlements pattern) | `{ before: { status, attempts }, after: { status: 'pending', next_attempt_at } }` | `reason, queue, action, correlationId, dueAnchor, deadLettered` |
| `BOS_QUEUE_ITEM_CANCELLED` | `'bos'` | `'bos_queue_item'` / the item id | the item's account / the admin | `{ before: { status, attempts }, after: { status } }` | the same |
| `BOS_QUEUE_DRAINED` | `'bos'` | `'bos_queue'` / the queue id | the admin / the admin (no single account) | — | `reason, queue, correlationId` and the drain's **numeric** counts (reaped, claimed, sent, skipped, failed, as the function returns them) |

- **Severity `'warning'`**, the same as the entitlement admin ops: an admin changed what a customer's clients receive.
- **The reason is required:** `z.string().trim().min(3).max(500)`, the same rule as `adminOps.ts`. The dialog hint says *"Don't paste client details."*
- **Flushed before responding**, through **`logAndFlush`** (`lib/audit/boundedAuditFlush.ts`), **not** a raw `auditTrail.flush()`. Raw `flush()` returns early while another flush is running (the §11 WC-7 limit). `logAndFlush` serialises and is bounded, and it never throws. This settles the open skill follow-up for these routes.
- **Never in the audit row:** `error_message`, `skip_reason`, payload, recommendation, contact, invoice or booking ids, or client names. Only a lost CAS or a 422 refusal is logged (Pino, `info`), without an audit row.
- **Registering the events** updates `lib/audit/events.ts`, `eventAudience.ts` and its test (an untagged event fails `eventAudience.test.ts`).

### H. Ruling 6: migrations

**None.** The CAS is plain PostgREST (§D.1). Every column used exists (§A). The status values used are already allowed: `cancelled` on the two payment tables (no CHECK), and `skipped` plus `skip_reason` on the three that have a CHECK. The claim and reaper RPCs are reused unchanged. **If** the workplan finds it needs one (it should not), the next free number is **`20261035` or later**. The blocks taken are 20261015–19 (credit deduction), 20261020–24 (invites), 20261025–29 (plan payments) and 20261030–34 (boost). Dev runs `ls supabase/migrations` and records the number with the other sessions before using it. The user applies it by hand, with a check script and a rollback script.

### I. Ruling 8: CRON_SECRET and cron authentication

- Drain now **never calls a cron URL**, never reads `CRON_SECRET`, never imports a cron route module, and adds **no** bypass header or parameter to any cron route. Its only gate is `requireAdmin`, as the first statement. So it creates **no unauthenticated trigger**.
- It works **even when `CRON_SECRET` is unset**. That is the recovery case this feature exists for, and it is safe, because the caller is a proven admin.
- The cron routes' `verifyCronSecret` and `withCronRunRecord` stay **byte-for-byte unchanged**. A source test pins this (C7-10).

### J. Conditions

1. **C7-1: The action matrix in §C is binding.** FR-Q1 is amended: "release a stuck in-progress item" becomes **"Drain now"** for leased stuck rows, plus **cancel** for orphaned in-progress rows (`claimed_at IS NULL`). Payment automations get **no retry**. The workplan's tests include one negative case per ❌ cell.
2. **C7-2: No action ever moves an in-progress row to `pending`.** A row in `processing`/`running` with a non-null `claimed_at` is never actionable. With a null `claimed_at`, it can only be cancelled. (Reasons: B7-2, B7-9.)
3. **C7-3: The CAS shape is that of §D.1–D.2.** It uses `count: 'exact'` with `count === 1`, never `.or()` together with `.select()` on an update. The server validates the "from" state before the write. QA probes the update **once against real PostgREST** with a no-match id (a zero-row update), as required since 2026-09-29.
4. **C7-4: Retry never resets `attempts`**, and never clears `error_message`/`skip_reason` or touches the payload or target columns. One retry = one more try (B7-8).
5. **C7-5: Payment automations get no retry.** The route returns 422 `retry_not_offered`, and the UI shows no button. Revisit when block execution is wired, behind its own SA review, with a per-block idempotency key.
6. **C7-6: Cancel targets per table:** `cancelled` for the two payment tables. `skipped` + `skip_reason = 'cancelled_by_admin'` for the other three (their CHECK rejects `cancelled`). `error_message` is kept for diagnosis.
7. **C7-7: A briefing retry is same-business-day only** (B7-4). The CAS includes `.eq('briefing_date', <today in the row's timezone>)`. Reuse `businessDayFor`.
8. **C7-8: A payment reminder retry respects sending hours.** `next_attempt_at` = the next sendable time, from a small public method on `PaymentReminderService` that wraps the existing private `sendableAt`. Reuse it, never copy it. Refuse if that time is past `scheduled_at + 72 h`.
9. **C7-9: The 72-hour rule follows §E**, in both the route and the CAS predicate, with the 422 codes and plain sentences from §E. One pure function computes eligibility for both the list (7a) and the action route (7c), with a unit test per queue, including the boundary at exactly 72 h.
10. **C7-10: Drain now is exactly the §C last column.** It is `maxDuration = 60`, awaited, and in-process. A **source guard test** asserts that the drain route imports only those five entry points, that it never references `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `processDueRetries`, `CRON_SECRET` or `app/api/cron/**`, and that the cron routes are unchanged.
11. **C7-11: Drain now writes no `bos_cron_runs` row.** It is recorded only as `BOS_QUEUE_DRAINED`. The response carries the drain's counts only.
12. **C7-12: Data access.** Reads (the 7a list) extend `AdminJobsQueuesRepository` with one `listQueueItemsAllAccounts` method. Its column allow-list (`ADMIN_QUEUE_SELECTABLE_COLUMNS` and its guard test) is widened **deliberately** by exactly `user_id, status, attempts, claimed_at` and the per-table `kind` / `reminder_type` / `briefing_date`. Writes go in a **new** `AdminQueueActionsRepository` (`new-repository` skill). It uses the service role, cross-account by design, has `AllAccounts` in its method names and a required `AdminReadContext`-style context first, logs ids and counts only, and its only permitted callers are the new admin routes (a source guard test, as in the existing repository). **No `.from('<queue table>')` in a route.** Business names come from `business_profiles.company_name` through a repository read.
13. **C7-13: Privacy and UI copy.** The list and every response carry metadata only (FR-Q5), plus `kind`/`reminder_type` **mapped server-side to fixed labels** (unknown → "Other"). Never raw text, and never the account id (as slice 5). A serialised-response test seeds sentinel values into `error_message`, `skip_reason`, `payload`, `recommendation` and the contact/invoice/booking ids, and asserts that none appears. The retry dialog says: *"If an earlier attempt reached the client before failing, they will receive it again."* The dialogs reuse the archiving confirm dialog (TA-1, D-4).
14. **C7-14: Admin authz surface.** New routes: `GET /api/admin/jobs-queues/items` (7a), `POST /api/admin/jobs-queues/items/action` (7b; 7c reuses it) and `POST /api/admin/jobs-queues/drain` (7d). Each calls `requireAdmin` as its first statement and attaches a `correlationId`. In `adminGate.writes.test.ts`, the pinned case count goes **57 → 58** (7b) **→ 59** (7d). 7c adds none. The GET route gets its own four denial cases. **No `CAPS` value moves** (R1–R8), and no exemption is added. Each sub-slice runs the guard locally (no CI job runs Jest).
15. **C7-15: Logging and errors.** Pino only. `console.*` count in the touched files: `JobsQueuesView.tsx` 0, `jobs-queues/route.ts` 0, `AdminJobsQueuesRepository.ts` 0. Dev re-counts any other touched file and flags it per CLAUDE.md. Errors use the standard format, and `details` only in development.
16. **C7-16: Tests (on top of the C-items).** For each queue: a happy path per allowed action; a CAS loss caused by a simulated concurrent claim (the update returns `count: 0` → 409, no audit, no second state change), which is the §9 double-send test; a 72 h refusal; a foreign or unknown id → 404; the strict schema rejects an `accountId`; the audit row's shape and `logAndFlush` being awaited before the response; Drain now calls the exact entry point once. FR-Q7 is covered by re-fetching the existing `GET /api/admin/jobs-queues`.

### K. TA-9 and §9

- **TA-9: confirmed and sharpened** by §D. "The §8.1 claim and lease" = the queue's own drain function, which reaps then claims.
- **§9 slice 7 lines, as amended:** "Each action works on each of the five queues" now reads **"each action allowed by the §C matrix works on its queue, and each ❌ cell is refused"**. The other four lines stand as written.

### L. Backlog found here (not slice 7)

- **BL-7a (double-send hardening, recommended soon):** (1) fence every terminal write on `claimed_by = <runner>` and the in-progress status, so a re-claimed row's old runner cannot overwrite it (B7-2); (2) give `POST /api/business-os/leads/[id]` an explicit `maxDuration = 60` and stop fire-and-forget draining there (B7-11). These are small, but they change the live send path of three queues, so they get their own SA-reviewed change.
- **BL-7b:** a lead reply whose email failed is closed as `skipped / send_failed`, so the admin cannot retry it. If wanted, a later slice can offer retry for that one reason code (fixed vocabulary, shown as a label).

### M. Sub-slices and effort

Each one is its own PR, ships alone and can be reverted alone.

| # | Scope | Depends on | Effort |
|---|---|---|---|
| **7a** | Read-only per-item list: `GET …/items?queue=&state=` (waiting, stuck, failed, dead-lettered, cancellable), paged with a 50-row cap, metadata only (C7-12, C7-13); "retry until …" / "cancel only" from the shared eligibility function (C7-9); a table under each queue on the existing page | — | **S–M, about 1.5–2 days** |
| **7b** | **Cancel**: `AdminQueueActionsRepository`, the action route, CAS, audit with `logAndFlush`, the dialog with a reason; registrations (events, audience, writes test 57 → 58) | 7a | **M, about 2 days** |
| **7c** | **Retry**: the same route; per-queue eligibility (72 h, same-day briefing, sending hours); no retry on payment automations | 7b | **M, about 1.5–2 days** |
| **7d** | **Drain now**: the route (writes test 58 → 59), the five entry points, `maxDuration = 60`, the source guards, a button per queue with a reason | none in code (it can ship after 7a, or even first) | **S, about 1–1.5 days** |

**Total: about 6–7.5 days (M–L), as §5 estimated.** If launch is near, **7d is the best value per day**: it recovers every queue while a cron is down, and it is the smallest.

### N. For the user (business terms)

There is no blocking question. One question, and two things to know, each with the default that applies if you say nothing:

- **Q-SA7-1: Should the business owner be told when you re-send or cancel one of their messages?** Today nothing tells them. Their dashboard only shows the new state (for example, a queued reply disappears). *Recommended: no notification for now. Your reason and the audit row are the record. Revisit when support staff join.*
- **FYI-7a: A morning briefing can only be re-sent on its own day.** Re-sending yesterday's would send today's content under yesterday's date, and the business would then get today's briefing twice. After midnight in the business's time zone, a failed briefing can only be cancelled. *Default: as stated.*
- **FYI-7b: Payment automations can be cancelled but not re-sent.** They do not run anything yet. When they do, some of them move money (charges and refunds), and re-running one is a separate decision. *Default: cancel and Drain now only.*

### Approval
- [x] Requirement for slice 7 approved, **with conditions C7-1..C7-16**. **No migration.** Dev writes **one workplan covering 7a–7d** (four PRs). SA reviews it before any code.

**2026-10-04: SA amendments from the 7d workplan review** ([ADMIN_BOS_CLEANUP_SLICE_7D_WORKPLAN.md](/docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7D_WORKPLAN.md), W7D-1..W7D-12; measured on `5b26c361`):
- **C7-14 and §M, ordering:** the `adminGate.writes` counts follow ship order. 7d ships first, so it goes **57 → 58**, census **88 = 82 + 6 + 0, 59 files**, register row 91. 7b goes 58 → 59 later. 7c adds none.
- **§G, Drain now audit:** the event is **`BOS_QUEUE_DRAIN_STARTED`** (it replaces `BOS_QUEUE_DRAINED`). It is written **before** the drain runs (write-ahead), through `logAndFlush`. It is **one row per press**, with `details` = `reason, queue, correlationId` only. Reason: a drain can be killed at `maxDuration` 60 s, which is most likely in a backlog, the case Drain now exists for. An audit row written after the drain would be lost exactly then, and FR-Q3 requires every action to have one. The outcome, the counts and the duration go into the response and the Pino log, keyed by the same `correlationId`. The audience (`'bos'`), the severity (`'warning'`), the entity (`'bos_queue'` / queue id) and the actor (the admin) are unchanged. C7-11's "recorded only as `BOS_QUEUE_DRAINED`" reads `BOS_QUEUE_DRAIN_STARTED`.
- **§I and C7-10, "the cron routes are unchanged":** they are byte-for-byte unchanged **in the PR**, proven by the PR diff. After that, a structural source test pins them: `verifyCronSecret`, `withCronRunRecord('<job id>'`, `maxDuration = 60`, and no admin or bypass reference. There is no hash pin.
- **Backlog BL-7c (new):** a drain killed at 60 s spends one attempt on every row it claimed but did not reach. The reaper backs these off. On the briefing and lead queues (3 attempts), three kills in a row would dead-letter rows that were never tried. This is the same on the cron. Fix it with a smaller batch or an in-drain deadline, as its own SA-reviewed change, ideally with BL-7a.

**2026-10-04: SA amendments from the 7a workplan review** ([ADMIN_BOS_CLEANUP_SLICE_7A_WORKPLAN.md](/docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7A_WORKPLAN.md), W7A-1..W7A-12; measured on `61bda100`):
- **C7-12, allow-list:** `daily_briefing_sends.timezone` is added to the widened list, for that table only. It is read on the server for C7-7 ("today in the row's timezone") and never returned. The row's own zone is the right input, not `user_preferences.timezone`: the enqueue wrote `briefing_date` in that zone and the dispatcher renders with it. Live check (read-only, zero-row selects) confirms every 7a column on all five tables; `reminder_type` holds no value outside the five known (counts only).
- **§M, 7a states:** the list has **four** tabs (waiting, stuck, failed, dead-lettered). "Cancellable" is a per-row mark, not a state; 7b decides whether it needs a filter. 7b also decides whether payment-automation guardrail decisions (status `failed` with a guardrail marker; cancellable under §C) get their own tab, since the 7a Failed tab excludes them as the card does.
- **§E and C7-9, carried to 7c:** (1) the action route calls the shared eligibility function with the **real** clock, not the minute-floored clock the list uses; (2) for payment reminders the CAS bound uses the **eligible time**, `.gte('scheduled_at', retryAt − 72 h)`, not `now`, so the route and the CAS check the same thing; (3) the function's inclusive bound is never looser than the CAS (Postgres microseconds ≥ the parsed milliseconds), which is the safe direction; (4) **7c's workplan must show, from the briefing dispatcher, that a same-day retry pressed outside the morning send window cannot stay `pending` past the business day's end and then be sent under a stale `briefing_date`** (B7-4). If it can, the retry must be refused outside the window or the claim must re-check the date. SA could not verify this in the 7a review.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created | Built from the main session's review of all 27 admin pages and the user's approvals (UC-1 to UC-4). Each claim was checked against code on `main` `34d665b4` (§2: 20 verified, 4 partly verified or left to Dev; none checked against the live database). Eight new findings (§3), notably: a phantom column fails the whole read; the pricing Sync overwrites the prices that set BOS charges while claiming to fetch them; the AI cost execution detail returns AgentsPilot owner text across accounts; the real admin list has no roles. Requirements for 10 pages (§4), effort, impact and BOS impact (§5), and a proposed order of 7 slices (§6, free tier move folded into slice 2). There are 13 technical assumptions for SA and 7 business questions for the user. |
| 2026-10-02 | User decisions | OQ-1 answered: option B, read-only. Slices 1 and 5a go first; the rest of §6 stays open. The admin credit add/remove capability is **not** added here: credit-deduction slice 11 (FR-30, FR-31) already owns it, and the user chose not to document it twice. |
| 2026-10-02 | SA review: slices 1 and 5a | **APPROVED WITH CONDITIONS (C-1..C-15).** Live read-only schema check on `34d665b4`: `agent_executions.total_tokens_used` and `user_subscriptions.plan_name` are confirmed missing, and `user_subscriptions.subscription_status` is a **third phantom** (the Subscription card has never rendered). FR-BU1 is corrected: the fold holds only agents and executions; Plugins and AI spend stay, and the AP Subscription card is retired. TA-4 is overruled in part: the new `GET /api/admin/admins` reads the repository, because guard R2 forbids importing `AdminAccessService` in a route. Slice 7's two routes are folded in and R4 goes to 0/0. Two PRs. Other slices not reviewed. |
| 2026-10-02 | Q-SA-1 answered | The user keeps the Plugins and AI spend cards on the Businesses detail (SA's recommendation). Slice 1 workplan requested. |
| 2026-10-02 | SA note: C-13 FR-BU6 superseded | The 5a workplan review found that the detail's "Role" is the Supabase auth role, not `profiles.role`. Ruling: remove the row and its Shield rather than relabel it. |
| 2026-10-03 | Sync parked (UC-5); slice 1 and 5a shipped | The user parked the pricing Sync question (FR-PR3, OQ-2) for a separate session that will look up real provider prices and update the database and the code; as-built facts recorded in §11. Slice 2 keeps the page split without touching Sync. Slice 1 merged as PR #176, slice 5a as PR #177. |
| 2026-10-03 | SA review: slice 2 | **APPROVED WITH CONDITIONS (C2-1..C2-12).** FR-PR2 exception resolved: neither the grace period nor the pilot credit cost has a BOS reader. Their readers are the AgentsPilot platform-subscription paths, and the R-21 Stripe reads are phantoms that ignore the setting anyway. Both move. New parked page `/admin/agentspilot-billing`; no route is added or moved. FR-PR4: the PUT audits with before and after, but the row is only queued, so price-change audits must be flushed (C2-7). `console.*` counted: page 20, `boost-packs` 11, `calculator-config` 6, `/api/pricing/config` 22. FR-PR6 binds the files in the diff; converting the two admin routes is Q-SA2-1 (default yes). Sync stays untouched (C2-1), and a note is added to the §9 Sync line. One PR, about 1 to 1.5 days. |
| 2026-10-03 | UC-6: slice 2 stays BOS-relevant | The user answered SA's slice 2 question **no**: the AgentsPilot `boost-packs` and `calculator-config` routes are not converted to Pino in slice 2. They are recorded as AgentsPilot debt (11 and 6 `console.*` calls; 8 and 2 unguarded error details). C2-8's page-level conversions still apply. |
| 2026-10-03 | Slice 2 workplan SA-approved (W2-1..W2-9) | §8 Security NFR now names model price writes as a WC-7 flush exception (C2-7). The parked price-source row in §11 gains the three false info-box lines and the `flush()` early-return limit, for the separate pricing session. SA also found that a saved price kept showing its old value (W2-1); it is fixed in slice 2. |
| 2026-10-03 | SA review: slice 3 | **APPROVED WITH CONDITIONS (C3-1..C3-12).** Live read-only schema probe on `19566036`: `workflow_executions.input_data` is confirmed missing, and `output_data` and `workflow_step_executions.execution_id` (a filter column; the real key is `workflow_execution_id`) are **two more phantoms**. **NF-3 is latent:** because the executions read fails, the agent prompt read never runs, so fixing FR-AC5 alone would **start** sending prompts across accounts. TA-8 is therefore **in** slice 3, in the same PR, and the cut is made in the `select` (prompts, steps, schemas, input and output). TA-6 is confirmed and extended (also `agent` and `category`); TA-7 is overruled in form: all four category cards hide in BOS scope; the BOS drill path no longer lands on Agent. OI-9 stays debt. `console.*`: 0 in both files. No guard, register or nav-test change. One PR, about 1.5 days. No blocking user question; three FYIs. |
| 2026-10-03 | SA review: slice 4 (requirement and workplan, one pass) | **Approved with conditions W4-1..W4-9** (in the slice 4 workplan). Live read-only probe: `public.users` is missing (42P01), `profiles(id, full_name)` is valid, and every `audit_trail` search field exists. TA-10 is confirmed: the names come from `profiles` via `UserProfileRepository`. FR-AT3's wording is corrected (note under §4.3). FR-AR1's comment is tied to `ARCHIVE_RUNS_ENABLED` by a symmetric test. |
| 2026-10-04 | HelpBot embedding model locked (§12) | The HelpBot config PUT no longer writes `helpbot_embedding_model` (shared with BOS chat; changing it invalidates every stored vector). A changed value is refused with a 400; the page shows it read-only. Short path, with the audit-row email fallback (Q-SA4-1, user-approved): [ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md](/docs/workplans/ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md). |
| 2026-10-04 | OQ-3 and OQ-4 answered; slice 7 started | The user answered OQ-3 (72-hour retry window, cancel-only after) and OQ-4 (include "drain now"). Slice 7 (queue actions, R-18) starts with an SA requirement review. Slices 1, 2, 3, 4 and 5a are merged (PRs #176, #184, #187, #190, #177). |
| 2026-10-04 | SA review: slice 7 | **APPROVED WITH CONDITIONS (C7-1..C7-16). No migration.** Live read-only schema check on `5f10a926`: no queue table has `updated_at`, `payment_reminders` has no `skip_reason`, and the three non-payment tables have no `scheduled_at`. So the CAS version is `status` + `attempts`. Per-queue matrix: no per-item "release" (a leased row back to `pending` would double-send, because terminal writes are fenced by id only). Stuck rows are released by **Drain now** through the queue's own reaper; orphaned in-progress rows (no lease) are cancel-only. Payment automations: **no retry** (the executor is a placeholder; money blocks come later). Briefing retry is **same business day only** (it renders for "now"). Payment reminder retry respects sending hours. 72-hour anchors: `scheduled_at` (payments), `created_at` (lead replies, insight actions). Drain now calls only the claim-path drain (never stage billing, the overdue scan or Stripe charge retries), with `maxDuration = 60`, awaited, no cron URL, no `CRON_SECRET`, no cron-run row. Audit: `BOS_QUEUE_ITEM_RETRIED` / `_CANCELLED` / `BOS_QUEUE_DRAINED` (audience `bos`, severity warning, through `logAndFlush`). Writes test 57 → 59; no CAPS change. Sub-slices 7a–7d, about 6–7.5 days in total. Backlog BL-7a (fence terminal writes; the lead route's fire-and-forget drain) and BL-7b. One user question (Q-SA7-1) and two FYIs. |
| 2026-10-04 | Slice 7 order decided (UC-7) | The user chose to ship **7d (Drain now) first**; 7a (item list), 7b (cancel) and 7c (retry) follow, each its own PR, under SA's C7-1..C7-16. **BL-7a** (runner-fenced terminal writes, and an explicit `maxDuration` on the lead route) is accepted for **later**, as its own SA-reviewed change. Q-SA7-1 (notify the owner on an admin retry or cancel) is not answered yet; the default is no. |
| 2026-10-04 | SA: 7d workplan review amendments | 7d workplan **APPROVED WITH CONDITIONS (W7D-1..W7D-12)** on `5b26c361`. Amended C7-14 / §M (writes count by ship order: 7d 57 → 58, 7b 58 → 59), §G (the Drain now event becomes `BOS_QUEUE_DRAIN_STARTED`, a write-ahead row before the drain), §I / C7-10 ("unchanged" = PR diff plus a structural pin), and new backlog BL-7c (a killed drain spends an attempt on unreached rows). See the note under the slice 7 Approval. |
| 2026-10-04 | SA: 7a workplan review amendments | 7a workplan **APPROVED WITH CONDITIONS (W7A-1..W7A-12)** on `61bda100`. C7-12 gains `daily_briefing_sends.timezone` (server-only). §M: four tabs; "cancellable" and payment-automation guardrail decisions are 7b decisions. 7c carry-forwards: real clock for eligibility, payment-reminder CAS bound on the eligible time, and proof that a same-day briefing retry cannot be sent under a stale date (B7-4). See the note under the slice 7 Approval. |
| 2026-10-04 | Q-SA7A-1 answered (UC-8) | The user confirmed the business name alone is enough to identify the business behind a queue item; no link to the business page (a link would carry the account id). A link can come with the Business 360 work (R-3). |
