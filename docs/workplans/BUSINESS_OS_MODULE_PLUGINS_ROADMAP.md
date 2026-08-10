# Business OS Module → Internal Plugin Roadmap

> **Last Updated**: 2026-08-09

**Author:** Dev
**Status:** Living roadmap — grows/updates as each module is converted.

## Overview

This is the **living roadmap** for turning each Business OS (BOS) module into an **internal, repository-backed V2 plugin**, following the pattern proven by the **CRM pilot**. It is two things at once:

1. **The playbook** — a reusable, module-agnostic recipe (["The Conversion Recipe"](#the-conversion-recipe)) for converting any BOS module into an internal plugin the same way CRM was done.
2. **The tracker** — a prioritized [module list](#module-priority--status) plus a per-module section that records **open issues** for that module. As issues are fixed they are **struck through** (~~like this~~) rather than deleted, so the section doubles as a change log.

> **Where the detail lives.** CRM's full implementation detail is in the [CRM pilot workplan](/docs/workplans/BUSINESS_OS_CRM_INTERNAL_PLUGIN_PILOT_WORKPLAN.md). This roadmap is the cross-module index; each future module gets its own workplan when work starts, linked from its section here.

**Source-of-truth references:** [Repository-layer requirement](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md) · [Provider-abstraction requirement](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) · [SA feasibility review](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md) · [Plugin visibility scoping](/docs/PLUGIN_VISIBILITY_SCOPING.md) · [BOS test page](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md).

## Table of Contents

1. [The Conversion Recipe](#the-conversion-recipe)
2. [Module Priority & Status](#module-priority--status)
3. [Cross-Cutting Open Issues (all modules)](#cross-cutting-open-issues-all-modules)
4. [Modules](#modules)
   - [CRM ✅](#crm-)
   - [Scheduling](#scheduling)
   - [Email](#email)
   - [Payments](#payments)
   - [Intake](#intake)
   - [Website](#website)
   - [Insights](#insights)
5. [Not Plugins (orthogonal)](#not-plugins-orthogonal)
6. [Change History](#change-history)

---

## The Conversion Recipe

The generalized steps to turn a BOS module into an internal plugin — exactly what CRM did. Each is module-agnostic; substitute the module's tables/repositories/operations.

| Step | What | CRM reference |
|---|---|---|
| **0. Repository conformance** | Every module table is reached **only** through a repository in `lib/repositories/` — `.eq('user_id', userId)`-scoped, `{ data, error }` return, Pino `createLogger`, singleton export. Remediate any direct `.from()` in routes/services first. | 5 CRM repos + `listBasic`/`getOverdueContactIds` additions |
| **1. Plugin definition** | New `lib/plugins/definitions/<module>-plugin-v2.json`: the **operations are the single source of truth** (full param + output schemas), each with V6 `domain`/`capability` metadata. Set `isSystem: true`, `provider_family: "internal-bos"`, **`access_strategy: { type: "db_active" }`**, and **`visibility: "business_os"`** (hidden from the general catalog, runnable by key). Only **domain operations + I/O schemas** belong here — UI/nav intents and conversational metadata stay in the experience layer. | `crm-plugin-v2.json` (17 ops) |
| **2. Repository-backed executor** | New `lib/server/<module>-plugin-executor.ts extends BasePluginExecutor`: `executeSpecificAction` reads `connection.user_id` and delegates each action **1:1 to the repositories**. **GUARDRAIL:** never re-emit side-effects the Postgres triggers already own (no double-logging). | `crm-plugin-executor.ts` |
| **3. Register** | Add the definition to `corePluginFiles` (`plugin-manager-v2.ts`) and the executor to `executorRegistry` (`plugin-executer-v2.ts`). | — |
| **4. Wire one real caller** | Route one genuine caller through `PluginExecuterV2.execute(userId, '<module>', action, params)` to prove end-to-end; everything else migrates **additively/gradually** (nothing forced at once). | R8: chat `add_task` |
| **5. Test surface** | The module appears **automatically** in the `/test-business-os` **Modules** tab (it filters on `visibility === 'business_os'`). Verify each op there as an active tenant. | Modules tab (PR #19) |

**Standing guardrails (apply to every module):**
- **`db_active` access strategy fails closed** — no `business_profiles` row (or a lookup error) → `access_denied`. Never trust a client-supplied identity.
- **Triggers stay untouched** — the existing Postgres triggers own cross-capability side-effects; executors delegate only. Migrating triggers to events is Step 3 (deferred, out of scope here).
- **Hidden by default** — `visibility: business_os` keeps modules out of the general plugin catalog / V6 auto-binding until deliberately promoted (`visibility: public`).
- **Standards** — repository pattern, Zod at route inputs, Pino logging, no hardcoded model/plugin names, TS strict.

---

## Module Priority & Status

Proposed order (rationale below the table — this is a **recommendation**, re-prioritize as needed).

| # | Module | Repositories | Status | Complexity | Why here |
|---|---|---|---|---|---|
| 1 | **CRM** | `CRMContact`, `CRMActivity`, `CRMTask`, `CRMPipelineStages`, `ContactDocuments` | ✅ **Done** (PR #18/#19) | 🟡 | The hub — most trigger side-effects write to CRM; best repo coverage. |
| 2 | **Scheduling** | `Scheduling`, `ExternalCalendarEvent` | 🟢 Implemented — QA PASS; awaiting user code review before RM | 🟡 | High value ("book an appointment"); the primary feeder of CRM side-effects (triggers T1/T2/T9). Repos exist. Natural successor. |
| 3 | **Email** | `EmailAutomation` | 🅿️ **Parked** (user, 2026-08-10) | 🟡 | Repo-clean but automation engine doesn't exist (no drip cron; chat capability unwired) → v1 would be config-only. Revisit on product demand. See section. |
| 4 | **Payments** | `Payment`, `PaymentPlan` (12 tables) | 🟢 Implemented — SA + QA PASS; awaiting user code review before RM | 🔴 | High value (invoices/checkout) but highest risk — money, Stripe Connect external path, triggers T3/T4. Do after the pattern is proven on 2–3 modules. |
| 5 | **Intake** | `Intake` (`intake_form_templates`, `user_intake_settings`) | ⬜ Not started | 🟢 | Small, CRM-adjacent (form templates config). Quick win or fold into CRM. |
| 6 | **Website** | `WebsitePage`, `WebsiteBlock`, `WebsiteContent`, `WebsiteAnalytics` | ⬜ Not started | 🟡 | Content management — lower "capability to invoke" value for agents. Has a known repo gap to fix first (see its section). |
| 7 | **Insights** | `Insight` (+ `lib/business-os/insight/**`) | ⬜ Blocked | 🔴 | Read-only analytics, not standard CRUD. **Needs insight-subsystem repository remediation first** (direct DB access). Separate track. |

**Priority rationale:** CRM first because it is the side-effect hub. Then **Scheduling** and **Email** — high-value, agent-invokable, repos ready, moderate complexity — to harden the pattern on simpler surfaces. **Payments** after that (highest risk: money + external Stripe). **Intake** is a small CRM-adjacent quick win slot-able anywhere. **Website** is lower priority for the agent-invocation goal and carries a data-scoping gap. **Insights** is a separate, later track that first needs its subsystem moved onto repositories.

---

## Cross-Cutting Open Issues (all modules)

These affect every internal module, not just one. Fix once, benefits all.

- ⬜ **Execute-route hardening.** `POST /api/plugins/execute` reads `userId` from the request **body** with no `getUser()` — impersonation-style. Every internal-module caller inherits this. Harden it to derive identity server-side. (Tracked; flagged by SA on both the CRM pilot and the Modules-tab review.)
- ⬜ **Missing `@/types/database`.** The generated Supabase `Database` type file is absent from the repo, so repositories importing it lose **column-level type safety** — this is *why* phantom-column writes (e.g. the website routes) compile without error. A dedicated fix would restore compile-time schema checking across all module repositories.
- 🅿️ **Trigger → event-driven architecture (Step 3).** The 9 Postgres triggers remain the sole owner of cross-capability side-effects. Migrating them to an application event bus is **deferred** and only becomes necessary when the first *external* provider is introduced for a capability. Designed-not-built. See [SA feasibility review §2](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#2-deep-dive--cross-capability-side-effects-q5).
- 🅿️ **Config-driven capability selection (R7).** Which plugin serves a capability per tenant (`business_profiles.primary_*`) is parked — v1 uses the internal plugin only. Build when the first external provider for a domain is scoped.

---

## Modules

### CRM ✅

**Status:** Done — merged to `main` (PR #18); dedicated test surface + cleanup in PR #19. Live happy-path verified (a real `crm_contacts` row created via the Modules tab). Full detail: [CRM pilot workplan](/docs/workplans/BUSINESS_OS_CRM_INTERNAL_PLUGIN_PILOT_WORKPLAN.md).

**Repositories:** `CRMContactRepository`, `CRMActivityRepository`, `CRMTaskRepository`, `CRMPipelineStagesRepository`, `ContactDocumentsRepository`.

**Delivered (recipe steps complete):**
- ~~Repository conformance for the CRM tables (chat executor + payment-reminder routed through repos)~~ ✅
- ~~Internal CRM plugin: definition (17 ops) + repository-backed executor + `db_active` access strategy (fail-closed) + T8 no-double-logging guardrail~~ ✅
- ~~`visibility: business_os` — hidden from the general catalog, runnable by key~~ ✅
- ~~Registered + one real caller wired (chat `add_task` through the plugin path, R8)~~ ✅
- ~~Dedicated tester on the `/test-business-os` Modules tab~~ ✅
- ~~Live happy-path verification with an active tenant~~ ✅

**Open issues:**
- ⬜ **Website-route schema drift** (`task_dda5f400`) — the 5 public website intake/booking routes (`app/api/website/{forms/intake,forms/contact,booking/create,booking/confirm,booking/finalize}`) can't be cleanly routed through the CRM repos yet: they write **phantom `crm_contacts.name`/`status` + `crm_activities.type` columns** (schema is `first_name`/`last_name`/`stage`, `activity_type`), the booking routes' explicit `activity_type:'booking'` may **double-log** with trigger T2, and there are **duplicate `20260721`/`20260722` migrations**. Needs a BA/SA data-model decision first.
- ⬜ **Read-dashboard remediation (1.2.c)** — 4 read routes (`app/api/business-os/{stats,my-day,metrics/summary}`, `app/api/cron/insight-detect`) still `.from('crm_*')` directly; need ~7 shape-preserving aggregate repo methods. Low risk; grouped with `task_dda5f400`.
- ⬜ **Adjacent pre-existing TS errors** — `lib/business-os/ChatCommandExecutor.ts` has model/schema-drift TS errors (`is_free` not on `SchedulingServiceInsert` :1084; `company` not on `CRMContactInsert` :2530). Pre-existing, not from the pilot; related to the missing `@/types/database` cross-cutting item.

### Scheduling

**Status:** Assessed — workplan drafted, awaiting SA review: [Scheduling internal-plugin workplan](/docs/workplans/BUSINESS_OS_SCHEDULING_INTERNAL_PLUGIN_WORKPLAN.md).
**Repositories:** `SchedulingServiceRepository` + `SchedulingBookingRepository` (both in `lib/repositories/SchedulingRepository.ts`), `ExternalCalendarEventRepository`. **All conformant** (`{data,error}`, Pino, `user_id`-scoped, no `console.*`) — better shape than CRM at pilot start; the core `app/api/scheduling/**` routes + `SafeExecutionLayer` already use them.
**Triggers to respect:** T1 (booking → CRM contact, skips when `payment_status='pending'`), T2 (booking INSERT/status → CRM activity, only if `contact_id` set), T9 (contact delete → cancel future bookings).

**Open issues:**
- ⬜ **T2 double-log (3 routes)** — `app/api/website/booking/{create:282,confirm:217,finalize:253}` insert `crm_activities` explicitly **and** trigger T2 fires on the same booking → 2 activities/booking. Remove the explicit inserts (let T2 own).
- ⬜ **Phantom column** — `app/api/website/scheduling/availability/route.ts:332` filters `external_calendar_events.blocks_availability` (no such column) → the query errors and external-calendar blocking silently no-ops. Fix (use `getBusySlots`/`isSlotBlocked`) or remove.
- ⬜ **Step-0 remediation** — legacy `ChatCommandExecutor` booking sites (create/query/cancel/slots) go direct to `supabaseServer`; route to `schedulingBookingRepository`. Read-dashboard/cron scheduling reads too (land last).
- 🅿️ **Public/token booking surface = leaf** — `website/booking/*` + `book/manage/[token]/*` are unauthenticated/email-scoped, can't pass `db_active`; carve out as the public leaf (SA decision D1).
- 🅿️ **`scheduling_availability_exceptions`** — orphan table (no repo, no runtime reader); recommend exclude from v1 (SA decision D2).
- ✅ **No phantom `name`/`status` drift on the booking routes** (assessment corrected the roadmap's earlier assumption — those routes write correct columns). External calendar sync confirmed cleanly isolated → stays a leaf, out of v1.

### Email

**Status:** 🅿️ **PARKED (2026-08-10, user decision).** Assessed and repo-clean (best Step-0 baseline yet — single clean migration, no double-log, no live phantom-column drift), but the automation engine doesn't exist (no drip cron; chat capability unwired), so a v1 would be a config-only management surface with no live sends. User chose to skip Email for now and revisit once there's product demand for live sequence automation. Assessment findings retained below for when it resumes.
**Repositories:** `EmailAutomationRepository` — 5 classes/singletons (`emailSequenceRepository`, `emailSequenceStepRepository`, `emailCampaignRepository`, `emailSendRepository`, `emailSequenceEnrollmentRepository`) over `email_sequences`, `email_sequence_steps`, `email_campaigns`, `email_sends`, `email_sequence_enrollments`. All conformant.
**Triggers to respect:** T5 `log_email_activity` — fires on `email_sends` INSERT/UPDATE→`sent` (unconditional on contact_id; `contact_id` is NOT NULL), logs a `crm_activities` `email` activity. **No double-log found** (no code path also inserts the activity).

**Open issues:**
- 🅿️ **Scope question (business — for user):** the sequence **drip engine does not exist** (`getPendingSends` uncalled; no cron sends steps) and the chat/AI `email` capability is **declared but not wired** in `SafeExecutionLayer`. So an Email plugin v1 is a **config/management surface** (CRUD sequences/campaigns/enrollments + read send history) that doesn't drive live sends. Decide: ship v1 as the management surface (defer live drip sending) vs. build the drip engine now (much larger).
- ⬜ **`email_unsubscribes` has no repository** — compliance-critical; add `EmailUnsubscribeRepository` before any send/enroll op that delivers.
- ⬜ **Dead code + phantom column** — `lib/services/WebsiteEmailSequenceService.ts` (`createDefaultSequences`/`triggerSequence`) has **zero callers**, does 4 direct `.from()` writes, and inserts a non-existent `email_sequence_enrollments.metadata` column (`:314`, would error). Route through repos or delete.
- ⬜ **Chat capability not wired** — `email/sequences` in `capabilities-schema.ts` is schema-only; `SafeExecutionLayer` excludes it → **no live chat caller** to wire for the P4/"real caller" step (the plugin + Modules tab would be the first executable email surface).
- ⬜ **Read-dashboard** — `stats/route.ts` email counts fold into CRM's 1.2.c aggregate-methods item.
- ✅ **Delivery = leaf.** `emailTransport.sendEmail` (Resend → env Gmail → owner `google-mail` plugin) stays the external delivery leaf — out of the internal op contract (mirrors Payments/Scheduling leaf decisions).

### Payments

**Status:** 🟢 **SA-approved (2026-08-10)** — workplan cleared for implementation (M1–M8 folded in): [Payments internal-plugin workplan](/docs/workplans/BUSINESS_OS_PAYMENTS_INTERNAL_PLUGIN_WORKPLAN.md). Governing rule: **the internal plugin never moves money** — DB-record ops only; all charging/checkout/refund-to-card/Stripe Connect stay external leaves. **M1 (HIGH):** `record_manual_payment` needs a cross-tenant invoice-ownership guard (T4's invoice UPDATE is not `user_id`-scoped).
**Repositories:** `PaymentRepository` (3 classes → `payment_invoices`, `payment_transactions`, `stripe_connect_accounts`) + `PaymentPlanRepository` (`payment_plans`, `payment_plan_installments`). **5 of 12 tables repo-backed**; the other 7 are service-owned automation/processor infra (no repos) or the orphan `payment_methods` — deferred.
**Triggers to respect:** T3 `log_payment_activity` (transaction→`succeeded`, `contact_id`-conditional → CRM activity) + T4 `update_invoice_on_payment` (→ invoice `paid`). Both on `payment_transactions`. **No active double-log** (the only app-side writer, `CRMActivityRepository.logPayment:255`, is dead code).

**Open issues:**
- 🔴 **`CapabilityEngine.ts:508` broken invoice create** — calls `paymentInvoiceRepository.create(this.userId, {...})` with wrong arity (repo takes one `invoice` arg); `userId` passed as the invoice, payload dropped, NOT-NULL `user_id`/`invoice_number` omitted → the call cannot succeed. Fix during Step 0.
- 🟡 **Two rogue direct-DB callers** — `ChatCommandExecutor.ts:3226` (direct `payment_invoices` INSERT) + `:3466` (direct `payment_transactions` `succeeded` INSERT). Route through the plugin (P4).
- 🟡 **Dead double-log vector** — `CRMActivityRepository.logPayment:255` (zero callers). Recommend delete; executor must never wire it.
- 🟢 **`PaymentRepository` DI inconsistency** — 3 classes hardcode `supabaseServer` instead of constructor injection (`:94/372/727`); convert to match `PaymentPlanRepository`.
- ⬜ **7 unowned tables** — `payment_processors`, `saved_payment_methods`, `payment_events`, `payment_reminders`, `payment_automation_rules/executions` (service-owned, no repos) → deferred to a later phase; **`payment_methods`** is an orphan legacy-Stripe table → confirm dead, flag for drop.
- ⬜ **Insight G2 direct-DB reads** of payment tables (`MetricsComputeService`, `CashArOverdueDetector`, stats/my-day routes) — overlaps this module; tracked under Insights.
- ✅ **No phantom columns** on the payments path (verified). External **Stripe** (Connect/checkout/webhook/`IPaymentProcessorExecutor`) confirmed as the delivery leaf — out of the internal op contract; the webhook remains the legitimate producer of `succeeded` transactions that fires T3/T4.

### Intake

**Repositories:** `IntakeRepository` (`intake_form_templates`, `user_intake_settings`).

**Open issues:** _None tracked yet — assess during conversion._ Note: the intake **form-submission** path (which writes CRM contacts/activities) lives in the website routes and is covered by the CRM `task_dda5f400` drift item — this module is the **template/settings config**, which is smaller and cleaner.

### Website

**Repositories:** `WebsitePageRepository`, `WebsiteBlockRepository`, `WebsiteContentRepository`, `WebsiteAnalyticsRepository`.

**Open issues:**
- ⬜ **`WebsiteBlockRepository` scopes by `page_id` only, not `user_id`** (Document 1 gap **G3**) — relies on RLS + the caller passing an owned `pageId`. Must be closed (scope by `user_id`, or documented+enforced parent-derived ownership) **before** this module can be a conformant internal plugin.

### Insights

**Repositories:** `InsightRepository` (now under `lib/repositories/`), plus the `lib/business-os/insight/**` subsystem.

**Open issues (blockers before this can be a plugin):**
- ⬜ **Insight subsystem uses direct DB access** (Document 1 gap **G2**) — `insight/metrics/*`, `insight/events/*`, `insight/detectors/**` construct a raw `SupabaseClient` and run `.from()` against CRM/scheduling/payments/event tables. Must move onto repositories (aggregate methods) first.
- ⬜ **Shape mismatch with the plugin model** — Insights is read-only cross-table analytics, not CRUD; the internal-plugin CRUD shape may not fit. Decide whether it becomes a plugin at all or stays a repository-backed service. (Separate track.)

---

## Not Plugins (orthogonal)

These have repositories but are **not** converted to plugins — they underpin the plugin model rather than being capabilities:

- **`BusinessProfileRepository`** (`business_profiles`) — the **tenant anchor**. It *is* the `db_active` signal (presence of a row = active tenant). Not a capability to invoke.
- **`UserCapabilityRepository`** (`user_capabilities`, `user_capability_blocks`) — the **enablement axis** (which capabilities a tenant has), the internal analog of `plugin_connections`. Orthogonal to the operation contract.
- **`OnboardingConversationRepository`** — onboarding flow state, not a capability module.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-09 | Initial roadmap | Created the module→internal-plugin roadmap: the reusable Conversion Recipe, a prioritized module list (CRM ✅ → Scheduling → Email → Payments → Intake → Website → Insights), cross-cutting open issues, and per-module sections. Seeded CRM's open items (website-route schema drift `task_dda5f400`, read-dashboard remediation, adjacent TS errors) with completed steps struck through. Noted known gaps for Website (G3 user_id scoping) and Insights (G2 direct DB access). |
