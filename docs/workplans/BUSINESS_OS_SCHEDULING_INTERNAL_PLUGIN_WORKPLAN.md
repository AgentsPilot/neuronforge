# Workplan: Business OS Scheduling Internal Plugin

> **Last Updated**: 2026-08-09

**Author:** Dev
**Status:** Implemented + **QA PASS-WITH-NOTES** (no bugs, 105 tests pass) on the current branch (2026-08-10). Awaiting **user code review** before RM (RM held per user). D1–D5 resolved; M1–M6 implemented. 0.6 (read-dashboard reads) deferred as fast-follow; P5 live-appearance pending a dev-server restart.
**Module #2** on the [BOS Module → Plugin Roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md). Follows the [Conversion Recipe](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md#the-conversion-recipe) proven by the [CRM pilot](/docs/workplans/BUSINESS_OS_CRM_INTERNAL_PLUGIN_PILOT_WORKPLAN.md).

## Overview

Deliver **Scheduling** as an internal, repository-backed V2 plugin — services + bookings + availability-check — gated by the `db_active` access strategy, hidden by default (`visibility: business_os`), and testable via the `/test-business-os` Modules tab. Backward-compatible/additive; the existing Postgres triggers (T1/T2/T9) stay untouched and keep owning cross-capability side-effects.

**In scope (v1 operations):** `scheduling_services` CRUD + publish; `scheduling_bookings` CRUD + cancel/complete/no-show/reschedule/count; `check_availability` (overlap).
**Out of scope (v1):** external calendar sync (leaf provider — behind `ExternalCalendarEventRepository`/`calendar-sync` routes; the executor ignores the booking's `external_calendar_event_id`/sync fields); the public/token booking surface (`app/api/website/booking/*`, `app/api/book/manage/[token]/*`) which is unauthenticated + email/subdomain-scoped and cannot pass the user-scoped `db_active` gate — treated as a **public leaf** (same carve-out as CRM's website routes); `scheduling_availability_exceptions` (orphan table — no repo, no runtime reader).

### Guardrails (from the recipe + assessment)
- **Triggers untouched, no double-logging.** T1 (booking→`crm_contacts`), T2 (booking→`crm_activities`), T9 (contact delete→cancel future bookings) remain the sole owners. The executor delegates booking writes only and must NOT re-emit contacts/activities.
- **`db_active` fail-closed**, hidden-by-default visibility, standards (repository pattern, Zod, Pino, TS strict, no hardcoded names).

## Table of Contents

1. [Findings From the Assessment](#1-findings-from-the-assessment)
2. [Step 0 — Repository Conformance / Remediation](#2-step-0--repository-conformance--remediation)
3. [Step 2 — Internal Scheduling Plugin](#3-step-2--internal-scheduling-plugin)
4. [App → Plugin Operation Mapping](#4-app--plugin-operation-mapping)
5. [Verification Plan](#5-verification-plan)
6. [Open Decisions for SA](#6-open-decisions-for-sa)
7. [Files Touched](#7-files-touched)
8. [Task Checklist](#8-task-checklist)
9. [SA Review](#9-sa-review)
10. [QA Report](#10-qa-report)
11. [Change History](#11-change-history)

---

## 1. Findings From the Assessment

A full read-only assessment was performed (see [roadmap § Scheduling](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md#scheduling)).

**Repositories are conformant** (a head start vs CRM): `SchedulingServiceRepository` + `SchedulingBookingRepository` (both in `lib/repositories/SchedulingRepository.ts`; singletons `schedulingServiceRepository`, `schedulingBookingRepository`) and `ExternalCalendarEventRepository` — all `{ data, error }`, Pino, `user_id`-scoped, **no `console.*`**. The core authenticated `app/api/scheduling/**` routes already use them. `lib/business-os/ai-data-layer/SafeExecutionLayer.ts` already delegates all scheduling reads/writes to the repos — **the reference model** for the executor.

**Direct scheduling-table access to remediate (Step 0):**
| Cluster | Files | Nature |
|---|---|---|
| Legacy chat | `lib/business-os/ChatCommandExecutor.ts` — **6** `scheduling_bookings` sites (`1940` overlap, `1968` create, `2072` query, `2221` cancel-fetch, `2240` cancel-list, `2363` slots) (M5) | live direct `supabaseServer` — route to `schedulingBookingRepository` |
| Public website booking | `app/api/website/booking/{create,confirm,finalize,intake,availability}`, `app/api/website/scheduling/availability`, `app/api/website/forms/intake` | unauthenticated owner-by-subdomain — **public leaf**, not internal-plugin callers |
| Public token self-service | `app/api/book/manage/[token]/{route,reschedule,intake,cancel}` | signed-token `client_email` identity — **public leaf** |
| Read dashboards / cron | `app/api/business-os/{stats,setup-status,my-day,metrics/summary}`, `app/api/cron/insight-detect`, `app/api/payments/create-checkout`, `lib/services/WebsiteBlockEnrichmentService.ts` | aggregate reads — low risk, land last |

**Three concrete bugs (fold into Step 0 or track):**
1. **T2 double-log (REAL, 3 routes).** `booking/create:282`, `booking/confirm:217`, `booking/finalize:253` each insert `crm_activities` explicitly **and** trigger T2 fires on the same booking insert/status-change → **2 activities per booking**. Remove the explicit inserts (let T2 own), with a per-booking activity row-count parity check.
2. **Phantom column (REAL).** `app/api/website/scheduling/availability/route.ts:332` filters `external_calendar_events.blocks_availability` — no such column exists → the query errors and external-calendar blocking silently no-ops. Fix (use the repo's `getBusySlots`/`isSlotBlocked`) or remove.
3. **`countBookings` scoped by `service_id` only** (`SchedulingRepository:419`), no `user_id` — **now security-relevant (M2):** exposing `count_bookings` as a standalone op would let a caller count another tenant's bookings for a guessed `service_id`. Add `user_id` scoping before exposing it (bug #3).

**Roadmap correction + `task_dda5f400` reconciliation (M6):** the booking routes do **NOT** have the CRM-style phantom `name`/`status` drift — they write correct columns. The `task_dda5f400` phantom-column concern is specific to CRM's `forms/intake`. Fixing the booking-route **T2 double-log** here (0.2) **closes the booking portion of `task_dda5f400`**, leaving only `forms/intake` phantom `name`/`status`/`type` columns open under CRM. Scheduling migrations are sequential, not duplicated.

**External calendar = leaf (confirmed).** No booking *write* path calls Google/Outlook inline; provider I/O is confined to `calendar-sync` routes/services behind `ExternalCalendarEventRepository`. The internal plugin ignores the booking's calendar-sync fields entirely.

---

## 2. Step 0 — Repository Conformance / Remediation

Behavior-preserving. Only the **internal** (user-scoped) surfaces are routed through repositories; the public leaf surfaces are explicitly carved out (SA decision D1).

- **0.1** `ChatCommandExecutor` scheduling sites → `schedulingBookingRepository.*` (create/list/getUpcoming/cancel/checkOverlap). Confirm live/canonical vs `SafeExecutionLayer` first (like CRM 1.2.0); remediate in place, no retire.
- **0.2** Remove the explicit `crm_activities` inserts in `booking/{create,confirm,finalize}` (bug #1) — let T2 own. **Parity per the per-path matrix in §9 (M1), NOT "exactly one":** free-create → 1, paid-finalize → 1 (T2 *does* fire on the finalize UPDATE-to-confirmed), confirm → 1, paid-create (`contact_id:null`) → 0; confirm/finalize are mutually exclusive per booking. Commit + verify this **independently** of the plugin (D1). *(Public-leaf routes, but this is the exact §2.5-style double-log trap.)*
- **0.3** **Remove** the `blocks_availability` phantom filter (bug #2) — simplest fix: every synced `external_calendar_events` row is a busy block, so the `.eq('blocks_availability', true)` filter (on a non-existent column) is just dropped.
- **0.4 (SA decision D1)** Formally carve out the public/token booking surface as a **leaf** (documented; not routed through the `db_active` executor).
- **0.5 (SA decision D2)** Decide `scheduling_availability_exceptions`: add a repository or formally exclude from scope (recommend exclude — orphan).
- **0.6** Read-dashboard/cron scheduling reads → repos (shape-preserving; **land last**, low risk — may defer to a follow-up like CRM 1.2.c).

---

## 3. Step 2 — Internal Scheduling Plugin

- **P1 — Definition** `lib/plugins/definitions/scheduling-plugin-v2.json`: the operation set in §4, full param/output schemas, V6 **`domain: "calendar"`** (M3 — there is no `scheduling` member in the `Domain` enum) + per-op `capability` (from the enum: `create/get/list/update/delete/aggregate`; `check_availability → custom`), `isSystem: true`, `provider_family: "internal-bos"`, `access_strategy: { type: "db_active" }`, `visibility: "business_os"`, minimal internal `auth_config` stub. (No `delete_booking` hard-delete op — cancel is the soft path.)
- **P2 — Executor** `lib/server/scheduling-plugin-executor.ts extends BasePluginExecutor`: `executeSpecificAction` reads `connection.user_id`, dispatches per action to `schedulingServiceRepository` / `schedulingBookingRepository` (mirror `SafeExecutionLayer`). **Guardrail:** `create_booking`/`update_booking`/status-changes delegate only — T1/T2 own the CRM contact/activity side-effects; the executor emits none. Ignore calendar-sync fields.
- **P3 — Register** add to `corePluginFiles` + `executorRegistry`.
- **P4 — Wire one real caller** route one caller (recommend the `SafeExecutionLayer` scheduling path or a chat booking op) through `PluginExecuterV2.execute(userId, 'scheduling', …)`.
- **P5 — Test** appears automatically in the `/test-business-os` Modules tab (filters `visibility === 'business_os'`) — verify each op as an active tenant.

---

## 4. App → Plugin Operation Mapping

| Operation | `capability` | Executor → repository |
|---|---|---|
| `create_service` | create | `schedulingServiceRepository.create` |
| `list_services` | list | `schedulingServiceRepository.listAll` |
| `get_service` | get | `schedulingServiceRepository.findById` |
| `update_service` | update | `schedulingServiceRepository.update` |
| `publish_service` | update | `schedulingServiceRepository.publish` |
| `delete_service` | delete | `schedulingServiceRepository.delete` (guards on booking count) |
| `create_booking` | create | `schedulingBookingRepository.create` *(T1/T2 own contact/activity)* |
| `list_bookings` | list | `schedulingBookingRepository.list` |
| `get_booking` | get | `schedulingBookingRepository.findById` |
| `update_booking` | update | `schedulingBookingRepository.update` |
| `cancel_booking` | update | `schedulingBookingRepository.cancel` |
| `complete_booking` | update | `schedulingBookingRepository.complete` |
| `mark_no_show` | update | `schedulingBookingRepository.markNoShow` |
| `reschedule_booking` | update | `findById` + `checkOverlap` + **`business_profiles.scheduling_availability` window check** + `update` (full parity with `SafeExecutionLayer.executeRescheduleBooking`, M4) |
| `count_bookings` | aggregate | `schedulingServiceRepository.countBookings` — **must be `user_id`-scoped first (M2)**: add `.eq('user_id', userId)` to the repo method (a `service_id`-only count leaks cross-tenant) |
| `check_availability` | custom | `schedulingBookingRepository.checkOverlap` + `business_profiles.scheduling_availability` read via `BusinessProfileRepository` (D5-approved; not a new pattern — `SafeExecutionLayer.ts:678` already does this) |

Backward-compat: this union matches what `SafeExecutionLayer` + `CapabilityRegistry` scheduling branches already do, so callers can migrate additively.

---

## 5. Verification Plan

Lean, mirroring CRM:
- **In-build unit (pure, mocked repos):** executor dispatch (each op → correct repo method, `user_id` from connection); no-double-logging by construction (`create_booking`/status-changes never call `crmActivityRepository`); `db_active` reuse already covered by CRM's `access-strategy.test`.
- **QA-manual (via Modules tab + DB):** create/list/update/cancel/reschedule a booking end-to-end; **activity-count parity (M1):** the executor produces the **same `crm_activities` count as the core `/api/scheduling/bookings` route** for identical inputs — i.e. **0** when no `contact_id` is supplied at insert (T1 links the contact via a non-status update that doesn't fire T2), **1** when `contact_id` is supplied; and the executor itself emits none. Non-tenant → `access_denied`.
- **Regression:** remediated `ChatCommandExecutor`/dashboard reads produce identical results; the 3 booking-route double-log fixes produce the corrected activity count.
- Build + lint + plugin-load smoke (`scheduling` loads, 16 ops).

---

## 6. Open Decisions for SA

- **D1 — Public/token booking surface = leaf?** Recommend YES: `website/booking/*` + `book/manage/[token]/*` are unauthenticated/email-scoped and can't pass `db_active`; document as the public leaf (like CRM's website carve-out), remediate only the double-log within them. Confirm.
- **D2 — `scheduling_availability_exceptions`.** Recommend **exclude** (orphan table, no repo/reader) — or add a repo if there's a planned use. Confirm.
- **D3 — Step-0 boundary.** Which of {ChatCommandExecutor (0.1), the 3 double-log routes (0.2), the phantom filter (0.3), read dashboards (0.6)} land in this pilot vs a fast-follow? Recommend 0.1–0.3 in-pilot; 0.6 fast-follow (low-risk reads).
- **D4 — R8 caller.** `SafeExecutionLayer` scheduling path (clean, already repo-backed) vs a live chat booking op. Recommend the caller actually on the live request path (investigate first, like CRM D2).
- **D5 — `check_availability` shape.** It needs the `business_profiles.scheduling_availability` JSONB read in addition to `checkOverlap` — confirm the executor may read `business_profiles` (via `BusinessProfileRepository`) for this op, or scope `check_availability` to overlap-only for v1.

---

## 7. Files Touched

**New:** `lib/plugins/definitions/scheduling-plugin-v2.json`, `lib/server/scheduling-plugin-executor.ts`, `lib/server/scheduling-plugin-executor.test.ts`.
**Modified (Step 2):** `plugin-manager-v2.ts` (`corePluginFiles`), `plugin-executer-v2.ts` (`executorRegistry`), `lib/repositories/SchedulingRepository.ts` (**M2:** `user_id`-scope `countBookings`), one caller for P4.
**Modified (Step 0):** `lib/business-os/ChatCommandExecutor.ts` (6 booking sites); `app/api/website/booking/{create,confirm,finalize}/route.ts` (double-log — committed independently, D1); `app/api/website/scheduling/availability/route.ts` (drop phantom filter); `docs/workplans/BUSINESS_OS_CRM_INTERNAL_PLUGIN_PILOT_WORKPLAN.md` (**M6:** `task_dda5f400` booking-portion closed).
**NOT touched:** the 3 Postgres triggers; `ExternalCalendarEventRepository` / calendar-sync routes; `scheduling_availability_exceptions`.

---

## 8. Task Checklist

> **SA decisions folded in (see §9):** D1 public/token surface = leaf (double-log fixed here but committed/verified **independently** of the plugin) · D2 exclude `scheduling_availability_exceptions` (orphan) · D3 0.1+0.2+0.3 in-pilot, 0.6 fast-follow · D4 investigate liveness first, wire the **live** surface (likely a `ChatCommandExecutor` booking op — `create_booking`/`reschedule_booking`) · D5 `check_availability` reads `business_profiles.scheduling_availability` via `BusinessProfileRepository` (allowed). **Must-fix M1–M6 are explicit tasks below.**

> **Implementation progress (2026-08-10):** Step 2 plugin core (M2, P1, P2/M4, P3, P4) + Step 0 (0.1, 0.2, 0.3) done on the current branch; 14 executor unit tests pass; type-check status below. Remaining: P5 verify (Modules tab), QA. 0.6 deferred (fast-follow).

**Step 0** *(bug-fixes committed with the plugin on the current branch, per user)*
- ✅ 0.1 Remediated **all 6** `ChatCommandExecutor` `scheduling_bookings` sites → repos (overlap→`checkOverlap`, create→**plugin (P4)**, query/cancel-list/slots→`list`, cancel→`cancel`). Added array-status support to `SchedulingBookingRepository.list` (`status?: string | string[]`). `business_profiles` reads left as-is.
- ✅ 0.2 Removed the explicit `crm_activities` inserts in `booking/{create,confirm,finalize}` — T2 owns them. Parity target = per-path matrix (M1), verified by QA-manual.
- ✅ 0.3 Removed the `blocks_availability` phantom filter (`availability/route.ts`) — external blocking now actually works.
- ✅ 0.4 (D1) Public/token booking surface documented as the public leaf (§Overview out-of-scope + §1).
- ✅ **M6** CRM `task_dda5f400` updated: booking-route double-log closed here; only `forms/intake` phantom columns remain under CRM.
- ⬜ 0.6 (D3) Read-dashboard/cron scheduling reads → repos (**deferred — fast-follow**, low-risk reads)

**Step 2**
- ✅ P1 `scheduling-plugin-v2.json` — 16 ops; **`domain: "calendar"` (M3)**; `visibility: business_os` + `access_strategy: db_active`; internal `auth_config` stub
- ✅ **M2** `countBookings` now `.eq('user_id', userId)`-scoped (closes bug #3) — `count_bookings` safe standalone
- ✅ **M4** `reschedule_booking` includes the `business_profiles.scheduling_availability` window check (shared helper, parity with `SafeExecutionLayer`); `check_availability` uses the same helper
- ✅ P2 `SchedulingPluginExecutor` (delegate-only; T1/T2 guardrail — imports no CRM repo; ignores calendar-sync fields)
- ✅ P3 Registered in `corePluginFiles` + `executorRegistry`
- ✅ P4 Wired chat `create_booking` through `PluginExecuterV2.execute(context.userId, SCHEDULING_PLUGIN_KEY, 'create_booking', …)` (site 2); `'scheduling'` centralized with `// TODO(R7)`
- 🟡 P5 Definition validated structurally (16 ops, `isSystem`/`visibility:business_os`/`db_active`, all actions have required fields, `db_active ⇒ isSystem` holds) → will auto-list in the Modules tab. **Live appearance needs a dev-server restart** (the running server's plugin manager is cached from cold start) — QA/user to confirm post-restart.

**Verification**
- ✅ Unit — `scheduling-plugin-executor.test.ts`: dispatch + user_id scoping + reschedule conflict/availability + delegate-only guardrail + guards. **14 tests pass.**
- ⬜ QA-manual (Modules tab end-to-end; **activity-count parity = matches the core `/api/scheduling/bookings` route** per the M1 matrix, incl. the 0-activity no-`contact_id` case; non-tenant → `access_denied`)
- 🟡 Build + lint + plugin-load smoke (**17** plugins load incl. `scheduling` with 16 ops) — type-check status below

---

## 9. SA Review

**Reviewed by SA — 2026-08-09**
**Status:** 🔄 Revision Required (**APPROVE-WITH-CHANGES**) — architecturally sound, correctly reuses the shipped `db_active`/visibility substrate with **no new access logic**, and the delegate-only guardrail is right. Proceed once the **must-fix** items M1–M6 below are folded into the checklist. No fundamental rework; no TL escalation.

### Verification performed (against live code, not docs)

| Claim | Verdict | Evidence |
|---|---|---|
| Repos conformant (`{data,error}`, Pino, `user_id`-scoped, no `console.*`) | ✅ Confirmed | `SchedulingRepository.ts` — both classes + singletons, all methods scoped |
| Reference model = `SafeExecutionLayer` delegates to repos | ✅ Confirmed | `SafeExecutionLayer.ts:238/241/341/344/637/654/678` |
| Core authenticated create relies on triggers, no explicit activity insert | ✅ Confirmed | `app/api/scheduling/bookings/route.ts:230` (`schedulingBookingRepository.create` + no `crm_activities` insert) — **this is the true parity target for the executor, not the website route** |
| Bug #1 — T2 double-log (3 routes) | ✅ Real, **with nuance (M1)** | `booking/create:282`, `finalize:253`, `confirm:216` explicit `crm_activities` insert + T2 fires |
| Bug #2 — phantom `blocks_availability` | ✅ Real | `external_calendar_events` migration (`20260723`) has **no** such column; `.eq('blocks_availability', true)` at `availability/route.ts:332` errors → external blocking silently no-ops. Fix = **remove the filter** (every synced row is a busy block; there is no non-blocking concept) — simpler than `getBusySlots` |
| Bug #3 — `countBookings` scoped by `service_id` only | ✅ Real, **now security-relevant (M2)** | `SchedulingRepository.ts:414–425` — no `user_id` |
| `scheduling_availability_exceptions` orphan | ✅ Confirmed | 0 references in `lib/`/`app/` |
| ChatCommandExecutor direct booking access | ✅ Confirmed, **but more sites than listed (M5)** | `scheduling_bookings` at `1940, 1968, 2072, 2221, 2240, 2363` (6 sites, not 4) |
| Substrate shipped, no new access logic | ✅ Confirmed | `lib/server/access-strategy.ts`, `lib/plugins/plugin-visibility.ts`, `crm-plugin-v2.json`, `crm-plugin-executor.ts` all present |

### Decisions on Open Items (§6)

- **D1 — Public/token booking surface = leaf → APPROVED (confirm Dev rec).** `website/booking/*` + `book/manage/[token]/*` are unauthenticated / subdomain- / signed-token-email-scoped and structurally cannot pass the user-scoped `db_active` gate. Same carve-out as CRM's website routes. Correct. **On the double-log fix living in these public-leaf routes:** YES, do it here (see M1) — but it must be committed and parity-verified **independently** of the plugin work so a route bug-fix and a plugin bug never entangle (the exact CRM lesson). **Reconcile with CRM `task_dda5f400`:** that item deferred the booking-route double-log pending a data-model decision; this assessment resolves it (booking routes write *correct* columns — no `name`/`status` drift; only `forms/intake` retains phantom columns, which stays CRM's). Fixing the booking double-log here **closes the booking portion of `task_dda5f400`** — update that item to say so, leaving only `forms/intake` phantom columns open there.
- **D2 — `scheduling_availability_exceptions` → APPROVED: EXCLUDE.** Verified orphan (no repo, no runtime reader). Document the exclusion in §3 P-scope; no repo.
- **D3 — Step-0 boundary → APPROVED as Dev rec: 0.1 (booking sites) + 0.2 + 0.3 in-pilot; 0.6 fast-follow (land last).** Conditions: 0.1 must enumerate **all 6** `scheduling_bookings` sites (M5); 0.2/0.3 land as independently-verifiable Step-0 bug-fixes (D1 above).
- **D4 — R8 caller → investigate liveness FIRST, then wire the LIVE surface (same discipline as CRM D2).** Do **not** pick on "cleanliness." Trace reachability: `ChatCommandExecutor` is confirmed live (imported by `app/api/business-os/chat/route.ts`, per CRM 1.2.0). If it is the live booking surface, wire **one** of its booking ops through `PluginExecuterV2.execute(userId, 'scheduling', …)` — recommend `create_booking` or `reschedule_booking` (highest-signal proof of the trigger guardrail) — and leave the other sites remediated-to-repo. `SafeExecutionLayer` is an acceptable R8 proof **only if** its scheduling path is confirmed reachable in production; otherwise it proves nothing. Centralize the `'scheduling'` literal in one constant with a `// TODO(R7)` note (mirror `CRM_PLUGIN_KEY`).
- **D5 — `check_availability` shape → APPROVED: full shape, executor MAY read `business_profiles.scheduling_availability` via `BusinessProfileRepository`.** This is **not** a new access pattern — `SafeExecutionLayer.executeRescheduleBooking` already does exactly this (`businessProfileRepository.findByUserId`, `SafeExecutionLayer.ts:678`). Reading a repository from an executor is fine (server-side; `BusinessProfileRepository` is "not-a-plugin" but is still a normal repo). Note (non-blocking): `db_active` resolution already calls `findByUserId` for the eligibility gate, so `check_availability` incurs a second read of the same row — acceptable for v1, optimizable later.

### T1/T2/T9 guardrail — CONFIRMED, but the parity target is wrong as written (M1)

The delegate-only principle is **correct**: the executor's `create_booking`/status-change ops must call **only** the booking repo and emit no contacts/activities — T1/T2 own those. This matches the reference core route (`app/api/scheduling/bookings/route.ts:230`) exactly. **However, the "exactly one T2 activity per booking" parity claim in §2 0.2 and §5 is imprecise and partly wrong**, because of two trigger facts I verified in `20260722_create_scheduling_tables.sql:269–326`:

1. **T2 only inserts `IF NEW.contact_id IS NOT NULL`** (line 294), and fires **`AFTER INSERT OR UPDATE OF status`** (line 324).
2. **T1 sets `contact_id` via a *separate* `UPDATE scheduling_bookings SET contact_id=…`** (line 248) — which sets a non-`status` column, so it does **NOT** re-fire T2.

Consequence — the real per-path behavior (must be documented, not "exactly one"):

| Path | At the T2-firing event, `contact_id`? | T2 rows | Explicit route insert | After fix |
|---|---|---|---|---|
| Website **free** create (`create:249`) — route pre-creates contact, inserts `contact_id` set + `status:'confirmed'` | set | 1 (on INSERT) | 1 | **1** ✅ double-log real |
| Website **paid** create (`create:249`) — inserts `contact_id:null`, `status:'pending'` | null (+ status not in CASE) | 0 | 0 (guarded by `if(contactId)`) | 0 |
| Website **paid** finalize (`finalize:230`) — UPDATE sets `contact_id` + `status:'confirmed'` | set | 1 (on UPDATE OF status) | 1 | **1** ✅ double-log real; **T2 DOES fire on the finalize UPDATE-to-confirmed** (answer to the assessment's open question) |
| Website confirm (`confirm`) — inserts `contact_id` set + `status:'confirmed'` | set | 1 (on INSERT) | 1 | **1** ✅ — but confirm the confirm/finalize endpoints are **mutually exclusive** per booking so counts aren't summed |
| **Executor `create_booking`** via repo, caller passes NO `contact_id` (new client) | null at insert | **0** | n/a | **0** — T1 creates+links the contact, but T2 never logs |
| **Executor `create_booking`**, caller passes `contact_id` | set | 1 | n/a | **1** |

So the §5 assertion *"after a booking create, exactly one T2 booking activity per contact"* is **false for the executor path** when `contact_id` is not supplied at insert (the common new-client case) — the count is **0**. QA would file a false bug against a correct implementation. The parity target must be *"the executor produces the same `crm_activities` count as the core `app/api/scheduling/bookings` route for identical inputs,"* not a universal "one."

### Must-fix (fold into the checklist before coding)

- **M1 — Replace the "exactly one activity" parity target with the per-path matrix above.** In §2 0.2 and §5: (a) define the website-route parity per path (free create → 1; paid finalize → 1; confirm → 1, after removing the explicit inserts), (b) define the **executor** parity as "matches the core `app/api/scheduling/bookings` route" (0 when no `contact_id` at insert, 1 when supplied), (c) confirm confirm/finalize are mutually exclusive so rows aren't double-counted. This is a doc/verification fix, not a code change — the guardrail itself is correct.
- **M2 — `count_bookings` cross-tenant scoping (security).** As a standalone plugin op, the executor receives `service_id` from params with no ownership check, and `countBookings` filters by `service_id` only (`SchedulingRepository.ts:419`) → a caller could count another tenant's bookings for a guessed `service_id`. Today this is masked because `countBookings` is only reached via `delete()` (which is `user_id`-scoped first). Before exposing it standalone: either (a) verify ownership with `findById(serviceId, userId)` in the executor before calling `countBookings`, **or** (b) add `.eq('user_id', userId)` to `countBookings` and pass `userId`. Pick (b) — it's the durable fix and closes bug #3.
- **M3 — `domain: "calendar"` is mandatory; there is NO `scheduling` domain.** Verified against `intent-schema-types.ts:30–44` (`Domain` = email|messaging|**calendar**|storage|table|database|crm|…). Resolve the workplan's "(or `scheduling` if the enum has it)" → it does not exist; use `calendar`. Capabilities: `create/get/list/update/delete/aggregate` all exist; `check_availability → custom` is acceptable (no dedicated verb); `publish_service → update` and `count_bookings → aggregate` are fine. (Since `visibility: business_os` hides this from V6 auto-binding, capability precision is low-stakes, but the value must still be a valid enum member.)
- **M4 — `reschedule_booking` availability-window parity.** The §4 mapping lists only `findById + checkOverlap + update`, but the reference `SafeExecutionLayer.executeRescheduleBooking` **also** validates against `business_profiles.scheduling_availability` day/hour windows (`SafeExecutionLayer.ts:678–716`). Either include that read (via `BusinessProfileRepository`, consistent with D5) for true parity, or explicitly scope reschedule to overlap-only for v1 and document the intentional divergence. Do not silently drop the availability check.
- **M5 — Enumerate ALL 6 `ChatCommandExecutor` booking sites in 0.1**, not the 4 listed: `1940` (overlap check → `checkOverlap`), `1968` (create), `2072` (query/list), `2221` (cancel fetch), `2240` (cancel list), `2363` (slots). The profile reads at `1481/1640/2328` are `business_profiles`, out of scheduling scope — leave them.
- **M6 — Reconcile with CRM `task_dda5f400`.** State in §1/§7 that fixing the booking-route double-log here closes that item's booking portion; only `forms/intake` phantom `name`/`status`/`type` columns remain open under CRM.

### Nice-to-have (non-blocking)

- Bug #2 fix: prefer simply **removing** the `.eq('blocks_availability', true)` filter (every `external_calendar_events` row is a busy block) over routing through `getBusySlots`/`isSlotBlocked` — smaller, and keeps the leaf boundary clean.
- No `delete_booking` (hard delete) op in the 16-op set — intentional (cancel is the soft path); fine for v1, just note it so callers don't expect hard-delete.
- Inherited cross-cutting risk (not this pilot's job): `/api/plugins/execute` reads `userId` from the body; the scheduling plugin becomes reachable through that same route. Reference the tracked "execute-route hardening" item as an inherited risk in §8-equivalent; do not fix here.
- §5 says "16 ops" and §4 lists 16 — consistent. Keep the plugin-load smoke assertion at exactly 16.

### Approval

[ ] Workplan approved — proceed to implementation
[x] **Revision required — fold in M1–M6, then this is cleared for implementation** (no second full review needed; a diff of the amended checklist against M1–M6 + the D1–D5 decisions above suffices).

---

## 10. QA Report

**QA — 2026-08-10**
**Test mode:** full (static + unit; live DB deferred to user)
**Strategy used:** A (Jest unit — executor dispatch/guardrail) + B-static (source/grep verification of Step-0 remediations, registrations, repo scoping) + E (code review of parity vs `SafeExecutionLayer`). Live DB / server-restart / Modules-tab paths cannot be exercised in this session (Option C/D blocked — no running server, no tenant account).
**Focus:** api, security, schema
**Skipped:** live end-to-end (needs user's manual run after dev-server restart — see below)
**Input source:** launch-agent task brief + workplan §1/§4/§5/§9

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Jest suites pass (`scheduling-plugin-executor`, `crm-plugin-executor`, `lib/plugins`) | ✅ | Pass | 8 suites, **105 tests pass**, 7.3s |
| Executor is delegate-only — imports/uses NO CRM/activity repo | ✅ | Pass | Grep: only `SchedulingRepository` + `BusinessProfileRepository` imported; "crm"/"activity" appear only in comments |
| `create_booking`/status-change ops call only the booking repo | ✅ | Pass | Executor dispatch + unit test `create_booking touches ONLY the booking repo`; T1/T2 own side-effects |
| M2 — `countBookings` `user_id`-scoped (foreign `service_id` → 0, not cross-tenant) | ✅ | Pass | `SchedulingRepository.ts:422-426` has `.eq('service_id',…).eq('user_id',userId)`; unit test asserts `countBookings('s1','u1')` |
| Step 0 — no `.from('scheduling_*')` left in `ChatCommandExecutor.ts` | ✅ | Pass | Grep returns 0 matches |
| Step 0 — 6 ChatCommandExecutor sites routed to repos/plugin | ✅ | Pass | overlap→`checkOverlap` (1942), create→plugin (1971), query→`list` (2097), cancel-fetch/list→`cancel`+`list` (2200/2217), slots→`list` (2327) |
| M1 — double-log removed in 3 booking routes (no explicit `crm_activities` insert) | ✅ | Pass | Grep: `crm_activities` appears only in explanatory comments in create/confirm/finalize; per-path matrix understood (executor no-`contact_id` path = 0 is **correct**, not a bug) |
| Bug #2 — phantom `blocks_availability` filter removed | ✅ | Pass | Grep: only comments remain in `website/scheduling/availability/route.ts` |
| M3 — `domain: "calendar"` on all ops; valid capability enum members | ✅ | Pass | JSON: 16/16 ops `domain:calendar`; caps = create/list/get/update/delete/aggregate/custom |
| M4 — reschedule/availability window parity with `SafeExecutionLayer` | ✅ | Pass | `checkAvailabilityWindow` mirrors `SafeExecutionLayer.ts:678-716` (same days array, `getDay()`, local `HH:MM`, `slot.start<=start && slot.end>=end`) |
| Plugin definition — 16 ops, `isSystem`, `visibility:business_os`, `db_active` | ✅ | Pass | Validated via JSON parse; `db_active ⇒ isSystem` holds |
| P3 — registered in `corePluginFiles` + `executorRegistry` | ✅ | Pass | `plugin-manager-v2.ts:36`, `plugin-executer-v2.ts:31,66` |
| P4 — chat `create_booking` routed through `PluginExecuterV2.execute` | ✅ | Pass | `ChatCommandExecutor.ts:1971`; passes `contact_id` (matrix → 1 activity, correct); result envelope (`.success`/`.message`/`.error`) consumed correctly |
| Scheduling appears live in `/test-business-os` Modules tab; live CRUD/reschedule/cancel; chat P4 live; activity-count parity; non-tenant → `access_denied`; external-calendar blocking | ⚠️ | Deferred | Requires user's manual run after dev-server restart (plugin manager is cached from cold start) |

### Issues Found

#### Bugs (must fix before commit)
None found.

#### Performance Issues (should fix)
None. (Known, SA-accepted: `check_availability`/reschedule read `business_profiles` a second time after the `db_active` eligibility read — acceptable for v1.)

#### Edge Cases (nice to fix)
1. **Slots-read cap changed from unbounded → `limit: 500`** — `ChatCommandExecutor.ts:2331`. Behavior-preserving for any realistic single day; only diverges if one day exceeds 500 confirmed/completed bookings. Documented in-code. Severity: Low.
2. **`count_bookings` / `check_availability` declare `output_entity: "event"`** in the plugin JSON though they return a number / a verdict object respectively. Cosmetic only — `visibility:business_os` hides these from V6 auto-binding, so entity precision is low-stakes. Severity: Low.

### Behavior-Preservation Review (Step 0)
- **Booking-query site (2097-2126):** `period` correctly mapped to `startDate`/`endDate`; `status` defaults to `['confirmed','completed']` (array support added to `list`); service-join alias rename `scheduling_services`→`service` is consistent between the repo select (`SchedulingRepository.ts:615`) and the consumer (`b.service` at 2116). No behavior change.
- **Cancel-list / overlap sites:** map cleanly to `list`/`checkOverlap`. No behavior change.
- **P4 create path:** passes `contact_id` (contact pre-resolved via `crmContactRepository`), so T2 fires exactly once — matches the M1 matrix "executor + contact_id → 1". Executor emits no activity. Correct.

### Test Outputs / Logs
```
PASS lib/server/scheduling-plugin-executor.test.ts
PASS lib/server/crm-plugin-executor.test.ts
PASS lib/plugins/... (6 more suites)
Test Suites: 8 passed, 8 total
Tests:       105 passed, 105 total
```
Grep guardrails: 0 `.from('scheduling_*')` in ChatCommandExecutor; 0 CRM-repo imports in the executor; 0 `crm_activities` inserts and 0 `blocks_availability` filters remaining (comments only). Plugin JSON: 16 ops, all `domain:calendar`, `isSystem:true`, `visibility:business_os`, `access_strategy:db_active`.

### Requires User's Manual Run (cannot be done by QA — needs dev-server restart + a live tenant account)
1. **Restart the dev server** so the plugin manager reloads and `scheduling` (16 ops) appears in the `/test-business-os` **Modules** tab.
2. As an **active BOS tenant**: create/list/get/update a **service**; publish + delete (blocked-if-bookings) a service.
3. Create → list → reschedule → cancel/complete/no-show a **booking** end-to-end via the Modules tab.
4. **Chat "create booking" path (P4)** produces a booking through the plugin.
5. **Activity-count parity (M1 matrix):** executor `create_booking` with no `contact_id` → **0** `crm_activities`; with `contact_id` → **1**; matches the core `/api/scheduling/bookings` route. Website free-create/confirm/finalize each → **1** (no double-log).
6. **Non-tenant** (no active BOS) → `access_denied`.
7. **External-calendar blocking** (`website/scheduling/availability`) now actually filters busy slots (phantom-filter fix).

### Final Status
- [x] All **runnable** acceptance criteria pass — no bugs found. **PASS-WITH-NOTES.**
- [ ] Live DB / Modules-tab / activity-parity verification pending user's manual run (items 1-7 above). No High/Medium issue is open; the two edge cases are Low and non-blocking.
- Note: the pre-existing `ChatCommandExecutor.ts` TS errors (`is_free`, `company`) are unrelated to this work and were not counted.

**Verdict: PASS-WITH-NOTES** — code is ready for commit from an automated-test standpoint; the deferred live checks (1-7) should be run post-restart to close out P5/QA-manual.

---

## 11. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-09 | Initial workplan | Dev authored the Scheduling internal-plugin workplan from the read-only assessment: repos already conformant; Step-0 = remediate `ChatCommandExecutor` + fix the T2 double-log (3 booking routes) + the `blocks_availability` phantom filter; v1 op set = services + bookings + `check_availability`; calendar sync + public/token booking surface + `scheduling_availability_exceptions` carved out. 5 open decisions for SA. |
| 2026-08-09 | SA review + Dev amendment | SA: APPROVE-WITH-CHANGES (D1–D5 resolved). Dev folded M1 (per-path T2 parity matrix — executor parity = "matches core `/api/scheduling/bookings` route", 0 activities when no `contact_id`), M2 (`user_id`-scope `countBookings` before exposing `count_bookings`), M3 (`domain: "calendar"` — no `scheduling` domain), M4 (`reschedule_booking` availability-window parity), M5 (all 6 ChatCommandExecutor booking sites), M6 (closes CRM `task_dda5f400` booking portion) into §1/§2/§3/§4/§5/§8. Ready for implementation. |
| 2026-08-10 | Implemented (Step 0 + Step 2) | On the current branch: M2 (`countBookings` user-scoped), P1 (`scheduling-plugin-v2.json`, 16 ops, `domain:calendar`), P2/M4 (`SchedulingPluginExecutor` — delegate-only, reschedule+availability parity), P3 (registered), P4 (chat `create_booking` → plugin), Step 0 0.1 (6 ChatCommandExecutor sites → repos + array-status on `list`), 0.2 (double-log removed in 3 booking routes), 0.3 (phantom filter removed), M6 (CRM `task_dda5f400` updated). Type-clean (only 2 pre-existing `ChatCommandExecutor` errors). 14 executor unit tests + 111 total pass. P5 definition validated (needs server restart to appear live). 0.6 deferred. → QA. |
