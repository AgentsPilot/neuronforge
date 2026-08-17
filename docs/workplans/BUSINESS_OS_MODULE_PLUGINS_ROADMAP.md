# Business OS Module → Internal Plugin Roadmap

> **Last Updated**: 2026-08-14

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
| 5 | **Intake** | `Intake` (`intake_form_templates`, `user_intake_settings`) | 🟢 Implemented — SA + QA PASS; awaiting user code review before RM | 🟢 | Small, CRM-adjacent (form templates config). Simplest conversion yet — no cross-capability triggers on the config surface. |
| 6 | **Website** | `WebsitePage`, `WebsiteBlock`, `WebsiteContent`, `WebsiteAnalytics` | 🟢 Implemented — SA + QA PASS; awaiting user code review before RM | 🟡 | Content management — lower "capability to invoke" value for agents. G3 ownership-scoping fix (Option A) + trimmed v1 op set. |
| 7 | **Insights** | `Insight` (+ `lib/business-os/insight/**`) | 🟢 Service (not a plugin, user decision) — **minimal G2 slice** implemented + SA + QA PASS; awaiting user review before RM | 🔴 | Compute-and-persist analytics, not CRUD. Stays a service. Minimal G2 slice done (3 foreign reads → repos, 2 latent bugs fixed). Full plugin revisit deferred to post-Step-3. |

**Priority rationale:** CRM first because it is the side-effect hub. Then **Scheduling** and **Email** — high-value, agent-invokable, repos ready, moderate complexity — to harden the pattern on simpler surfaces. **Payments** after that (highest risk: money + external Stripe). **Intake** is a small CRM-adjacent quick win slot-able anywhere. **Website** is lower priority for the agent-invocation goal and carries a data-scoping gap. **Insights** is a separate, later track that first needs its subsystem moved onto repositories.

---

## Cross-Cutting Open Issues (all modules)

These affect every internal module, not just one. Fix once, benefits all.

- ⬜ **Execute-route hardening.** `POST /api/plugins/execute` reads `userId` from the request **body** with no `getUser()` — impersonation-style. Every internal-module caller inherits this. Harden it to derive identity server-side. (Tracked; flagged by SA on both the CRM pilot and the Modules-tab review.)
- ⬜ **Missing `@/types/database`.** The generated Supabase `Database` type file is absent from the repo. The 2 repos that imported it (`BusinessProfileRepository`, `OnboardingConversationRepository`) are now fixed with **hand-written interfaces** (matching the rest of the codebase). Optional broader fix: **generate** the real file to restore column-level schema checking across all repositories (this is *why* phantom-column writes historically compiled without error).
- ⬜ **Repository / type-hygiene follow-ups.** SA-flagged Low-severity cleanups left by the Insights G2 slice + the `@/types/database`→interfaces change: `BusinessProfileInsert.vertical` nullability, a redundant cast in `OpsUtilizationLowDetector`, the 3 phantom `business_profiles` fields (`currency`/`timezone`/`contact_email`), and an availability-route double cast. Full context: [BUSINESS_OS_REPOSITORY_TYPE_HYGIENE_FOLLOWUPS.md](/docs/workplans/BUSINESS_OS_REPOSITORY_TYPE_HYGIENE_FOLLOWUPS.md).
- 🅿️ **Trigger → rule-engine migration (Step 3).** The 9 cross-capability Postgres triggers (T1–T9) are being migrated to an application-level, config-driven rule engine (durable `business_events` log → distributor → fast/delayed queues → provider-agnostic plugin-op reactions). **Designed + planned + SA-signed-off; not yet built** (only *required* once an external provider arrives, but Phase 0 has standalone value — it lights up Insights). The two authoritative trigger docs:
  - **The locked design (what/why):** [BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md).
  - **The implementation plan (how — T1–T9 cutover playbook, phases, concurrency/rule-engine mechanics, SA final sign-off §16, M0 satisfied):** [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md). Next step = scope **Phase 0** (see §6; the RC1–RC3 build gates). Origin/context: [SA feasibility review §2](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#2-deep-dive--cross-capability-side-effects-q5).
  - **Reusable patterns extracted:** the `durable-queue-drain` and `tenant-isolation-guard` skills (`.claude/skills/`) — pulled automatically when relevant.
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
- 🟢 **Phase-2 (repos for the unowned tables) — implemented + SA + QA PASS (2026-08-12), awaiting user review before RM** ([Payments phase-2 workplan](/docs/workplans/BUSINESS_OS_PAYMENTS_PHASE2_REPOS_WORKPLAN.md)). Added **4 repo files / 6 classes** for 5 clean tables (`payment_processors` + `saved_payment_methods`, `payment_events`, `payment_reminders`, `payment_automation_rules`) + routed 4 services + 1 route through them (zero direct `.from()` on those tables remain outside repos). **Fixed 2 latent bugs:** B1 `PaymentReminderService:405` cross-tenant status update (now `user_id`-scoped); B2 phantom `payment_reminders.updated_at` write (removed — reminder status transitions silently never persisted before). 43 unit tests. **Deferred (user decision):** `payment_automation_executions` repo — `trigger_event_id` phantom column / broken delayed-automation path → own investigation. **`payment_methods`** dead → no repo, flagged for a separate DROP migration; stale docs fixed.
- ⬜ **Insight G2 direct-DB reads** of payment tables (`MetricsComputeService`, `CashArOverdueDetector`, stats/my-day routes) — overlaps this module; tracked under Insights.
- ✅ **No phantom columns** on the payments path (verified). External **Stripe** (Connect/checkout/webhook/`IPaymentProcessorExecutor`) confirmed as the delivery leaf — out of the internal op contract; the webhook remains the legitimate producer of `succeeded` transactions that fires T3/T4.

**Tracked follow-ups from phase-2 (liveness findings — 2026-08-12):** the 5 wrapped tables split by liveness: `payment_events`/`payment_processors`/`saved_payment_methods` are **live** (payment UI blocks: collect_payment/record_manual_payment/refund → `blocks/execute`; + booking events); `payment_reminders` is **half-dark** (rows created on bookings, but the sending cron isn't scheduled); automation is **fully dark**.
> ✅ **F1 + F2 addressed** in the **[Payment Queue-Drain workplan](/docs/workplans/BUSINESS_OS_PAYMENT_QUEUE_DRAIN_WORKPLAN.md)** (`fix/business-os-payment-queue-drain`, PR #27; SA APPROVE + QA PASS-WITH-NOTES) — both drains rebuilt on the durable-queue **claim pattern** ([migration plan §8.1](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md)) then the crons wired; **first application of the `durable-queue-drain` skill.** A few QA notes are deferred to a Phase-0-convergent follow-up (see that workplan §6.6/§12).
- ✅ **Wire the payment crons** (`task_65f25a21`) — done: `payment-reminders`/`payment-retry` drains claim-safe + registered in `vercel.json`. Detail in the queue-drain workplan.
- ✅ **Payment automation engine** (`task_39e0280d`) — build chosen: `processScheduledExecutions` rebuilt on the claim pattern (fixes the unbounded re-execution + guardrail-bypass), pub/sub + `trigger_event_id` addressed. Detail in the queue-drain workplan. (User-rules surface still folds into Step-3 Phase 3.)
- ⬜ **`payment_methods`** dead table → separate DROP migration (F3; confirm no prod rows first).

### Intake

**Status:** 🔵 Assessed (2026-08-10) — **the simplest conversion yet (🟢 confirmed)**. Workplan drafted, awaiting SA review: [Intake internal-plugin workplan](/docs/workplans/BUSINESS_OS_INTAKE_INTERNAL_PLUGIN_WORKPLAN.md).
**Repositories:** `IntakeRepository` owns `intake_form_templates` (global **read-only seed catalog** — no `user_id`, 7 templates across verticals) + `user_intake_settings` (per-user config, `UNIQUE(user_id)`, one row). It also has booking-**response** methods over `scheduling_bookings` — **out of scope** (Scheduling's response flow).
**Triggers to respect:** none of concern — only an `updated_at` timestamp trigger on `user_intake_settings`. **The config surface has ZERO cross-capability side-effects** (no double-log risk).

**Open issues:**
- ⬜ **`IntakeRepository` is not constructor-DI** — uses hardcoded `private supabase = supabaseServer` (`:73`); refactor to `SupabaseClient` injection to match CRM/Scheduling/Payments.
- ⬜ **Dead / unused repo methods** — `saveIntakeResponses` (`:403`, the two public submit routes reimplement it inline) has no callers; `listAllTemplates`, `getTemplateByKey`, `getSettings`, `createSettings`, `updateSettings` are unused. Decide prune vs wire.
- ⬜ **Not declared, not wired** — no `intake` capability in `capabilities-schema.ts` and no `SafeExecutionLayer` caller (more absent than Email). The plugin + Modules tab would be the **first executable surface** — no pre-existing P4 caller to reuse.
- ℹ️ **`user_id` isolation for settings** — the executor must always pass the authenticated `user_id` to `upsertSettings` (the `UNIQUE(user_id)` upsert would otherwise let one user overwrite another's row); and must **NOT** inject a phantom `user_id` filter on the global template catalog (no such column).
- ℹ️ **No template authoring in v1** — users *select* a seed template + toggle settings; custom template CRUD is a future, larger scope.
- ✅ **Owned tables are clean** — accessed exclusively through `IntakeRepository` (no direct `.from()` outside the repo), no phantom columns. The 5 phantom-column writes in `app/api/website/forms/intake/route.ts` (`crm_contacts.name`/`.status`, `crm_activities.type`/`.metadata`, `scheduling_bookings.intake_completed`) belong to **CRM `task_dda5f400`**, not this module.

### Website

**Status:** 🔵 Assessed (2026-08-10) — workplan drafted, awaiting SA review: [Website internal-plugin workplan](/docs/workplans/BUSINESS_OS_WEBSITE_INTERNAL_PLUGIN_WORKPLAN.md). **Complexity: medium.** No cross-capability triggers (only `updated_at` bumps — cleanest trigger picture yet); Page/Content/Analytics repos are clean + `user_id`-scoped; not declared/wired (plugin + Modules tab = first executable surface, like Intake). The work is G3 + trimming a large content-management op surface.
**Repositories:** `WebsitePageRepository` (the **ownership oracle** — `findById(id, userId)` user-scoped ✅), `WebsiteBlockRepository` (**G3 gap** — see below), `WebsiteContentRepository` (user-scoped ✅), `WebsiteAnalyticsRepository` (user-scoped reads ✅; 2 stray `console.log`).
**Triggers to respect:** none of concern — only `updated_at` timestamp triggers on `website_pages`/`website_content`. Publishing is a plain `status='live'` column update (no fan-out). Analytics is a plain insert.

**Open issues:**
- 🔴 **G3 (core work) — `WebsiteBlockRepository` has no ownership scoping.** `website_blocks` has no `user_id` column (ownership is `page_id → website_pages.user_id`, enforced only by RLS — which the service-role plugin **bypasses**). Id-only methods (`findById`/`update`/`updateContent`/`toggleEnabled`/`delete`/`updateCapabilityConfig`) take just a block id; page-scoped methods trust the caller's `pageId`. **Fix = Option A (executor-level ownership pre-check)** via `WebsitePageRepository.findById(pageId, userId)` before delegating — the exact pattern `app/api/website/pages/[id]/blocks/[blockId]/route.ts:83-98` already uses. (Deeper repo-layer fix = threading `userId`/denormalizing `user_id` — deferred follow-up.)
- ⬜ **Trim the v1 op surface** — Website is a large content-management module with low agent-invocation value; v1 exposes ~11 high-value ops (page list/get/create/update/publish/unpublish; block list/toggle/update-content; analytics summary/page) and **defers** reorder, bulkCreate, capability_config wiring, content-section CRUD, domain setters, template apply, upload to the REST/UI layer.
- ⬜ **`clear_block_positions` RPC is phantom** (not defined in any migration) — `reorder` silently runs a slow O(n) fallback. Reason to defer `reorder` from v1.
- ⬜ **`bulkCreate` accepts mixed `page_id`s** — if ever exposed, must validate every page_id; recommend single-page constraint or defer.
- ⬜ **Repo singleton caching** — `get*Repository()` caches the first-injected client; the executor must instantiate `new X(supabaseServer)` directly (as the REST routes do), not the getter.
- ⬜ **Parallel surface** — `lib/business-os/actions/WebsiteActionHandler.ts` (Control Center regex chat handler) duplicates much of the op set; candidate to retire once the plugin lands (avoid drift).
- ℹ️ **Dual publish flags** — `status` vs legacy `published` boolean; `publish()`/`unpublish()` keep both in sync (any new write must too).
- ℹ️ **Analytics `console.log`** — `WebsiteAnalyticsRepository.getSummary` has 2 `console.log` (`:154`,`:242`); convert to Pino if the file is touched (CLAUDE.md standard).

### Insights

**Status:** 🟠 **Assessed (2026-08-11) — go/no-go + shape decision pending user (NOT a clean plugin candidate).** It's a cron-driven **compute-and-persist analytics** subsystem, not user-invokable CRUD. Three decisions are open (below); the assessment **recommends NOT building it as a plugin now** — do the small valuable G2 slice, keep it a service, revisit after Step 3.

**Repositories / subsystem:**
- **The real Business OS insight repo** is `lib/business-os/insight/repository/InsightRepository.ts` (owns `insights` + `owner_insight_history`) — **already fully conformant** ({data,error}, Pino, user_id-scoped, DI). The roadmap previously mis-pointed at `lib/repositories/InsightRepository.ts`, which is a **different, older PILOT execution-insight repo** (non-conformant) — **out of scope for this module.**
- Subsystem `lib/business-os/insight/**`: events, metrics, detectors (5), prioritizer, kernel, automation, projection, reporting. Live via 3 Vercel crons (`insight-detect` 15min, `insight-metrics` daily, `insight-automations` 5min).

**Key findings:**
- **Liveness / build-but-dark:** the event-driven detectors (`SalesStalled`, `SalesReplySlow`, `RetNoShowSpike`) + most of metrics read `business_events`, which has **ZERO emitters** today — they compute over an empty table. Only `CashArOverdueDetector` (payment_invoices) + `OpsUtilizationLowDetector` (scheduling_availability) fire on real data. **Step 3 (event-driven architecture) is what lights this up** and explicitly overrides the insight emission mechanism ([event-driven arch §1 override](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md), lines 37/44-53).
- **G2 quantified:** ~50 direct `.from()` sites, but **no raw client construction** (all DI-clean). Only **3 sites touch FOREIGN modules** — `payment_invoices` ×2 (`CashArOverdueDetector.ts:87`, `MetricsComputeService.ts:404`), `scheduling_availability` ×1 (`OpsUtilizationLowDetector.ts:104`). The other ~42 are the subsystem reading its **own** tables (`business_events` via `BusinessEventService`, `derived_metrics`, `insight_automations`, kernel) — repo-wrapping those is only worth it if Insights becomes a plugin.
- **Not declared/wired** (no `insights` capability, no `SafeExecutionLayer`). Domain enum has no `analytics`/`insights` member (closest: `internal`); `Capability` enum already has `aggregate`.
- ⚠️ **Data-integrity flag:** `CashArOverdueDetector.ts:88` reads `payment_invoices.amount`; `MetricsComputeService.ts:405` reads `payment_invoices.total_amount` — **different column names for the same value; at least one is a phantom column** (masked by the missing `@/types/database`). Verify before routing either through `PaymentRepository`.

**Decisions (RESOLVED — user, 2026-08-11):** **(1) Shape → service, not a plugin.** **(2) G2 scope → minimal slice done** ([Insights G2 minimal workplan](/docs/workplans/BUSINESS_OS_INSIGHTS_G2_MINIMAL_WORKPLAN.md): the 3 foreign reads routed through repos via a generalized `PaymentInvoiceRepository.getOverdueInvoices` + a DI'd `BusinessProfileRepository`, fixing 2 latent bugs — `payment_invoices.total_amount` phantom → `amount`, `scheduling_availability` phantom table → `business_profiles` JSONB. SA + QA PASS). **(3) Timing → full plugin re-evaluation deferred to post-Step-3.** Remaining ~42 subsystem self-reads stay deferred. This **closes the "Insight G2 direct-DB reads" note under Payments** and overlaps CRM 1.2.c.

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
