# Requirement: Business OS Module Repository Layer

> **Last Updated**: 2026-08-05

**Created by:** BA
**Date:** 2026-08-05
**Status:** Draft

## Overview

Every Business OS (BOS) module and table must be accessed **only** through a repository in `lib/repositories/` — no direct Supabase/DB access from API routes, services, components, or module logic. This requirement applies and enforces the platform's existing mandatory repository pattern (CLAUDE.md rule #1) specifically for the ~42 BOS tables, guarantees every BOS table has a conformant repository (mandatory `user_id` scoping, `RepositoryResult` shape, singleton export), remediates the direct-DB-access that exists in BOS code today, and adds a lint/CI guard so violations become build errors rather than review catches.

**Relationship to the plugin abstraction ([Document 2](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md)):** the user has decided that internal BOS modules (CRM, Scheduling, …) become **internal plugins** whose executors are **repository-backed** rather than external-HTTP-backed. Repositories are therefore the **data layer behind internal-plugin executors** — an internal plugin's executor calls a repository, never the DB directly. That makes this requirement a hard prerequisite for Document 2: an internal plugin can only be repository-backed if a conformant repository exists for every table it touches.

> **Pilot scope (agreed 2026-08-05).** The user has agreed a **phased, CRM-first pilot** (see [Document 2 → Agreed Implementation Approach & Status](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md#agreed-implementation-approach--status-2026-08-05) and the [SA feasibility review](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md)). **Step 1 of that pilot is this requirement, scoped to CRM:** all CRM data access goes through the CRM repositories with no direct DB access, so the internal CRM plugin (Step 2) has a conformant data layer. The **full-BOS scope** of this document (all 42 tables, the `lib/business-os/insight/**` remediation, the two misplaced repositories, and the repo-wide lint guard) remains the target end-state but is **tracked as separate tasks beyond the pilot** — the pilot only requires CRM to be conformant.

## Table of Contents

1. [Why This Requirement](#why-this-requirement)
2. [User Stories](#user-stories)
3. [Current State](#current-state)
4. [Functional Requirements](#functional-requirements)
5. [Enforcement Requirement (Lint/CI Guard)](#enforcement-requirement-lintci-guard)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Acceptance Criteria](#acceptance-criteria)
8. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
9. [Open Questions](#open-questions)
10. [Notes on Integration Points](#notes-on-integration-points)
11. [Change History](#change-history)

---

## Why This Requirement

**In plain terms:** BOS shipped fast (~421 files, 42 tables, PR #10). Most of its data access already goes through repositories, but not all — and the ones that exist are not uniformly conformant. Four forces make closing that gap worth doing now rather than after the monorepo migration:

| Force | Rationale |
|---|---|
| **Platform consistency** | CLAUDE.md rule #1 is non-negotiable: all DB access via `lib/repositories/`. BOS is currently a partial exception, which normalizes drift. |
| **Security** | Rule #4 requires `.eq('user_id', userId)` on every query. Repositories are the single place to guarantee that. Direct `.from()` calls in services (esp. those instantiated with `supabaseServer`, the service-role client that bypasses RLS) are where cross-user leakage risk concentrates. |
| **Plugin-readiness** | Under Document 2, internal-plugin executors are repository-backed. A table whose only access path is an inline `.from()` inside a service cannot cleanly back an internal plugin — the query has to live in a repository the executor can call. |
| **Monorepo-readiness** | The migration ([BUSINESS_OS_MONOREPO_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md) §4, §13.2) designates `packages/repositories` as the **single writer** across both apps. A repository that only exists as an inline `.from()` inside a service cannot be extracted into that package. Every direct DB call is a future extraction blocker. |

This is largely an **apply-and-enforce** requirement, not a new pattern. The pattern already exists ([REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md)); this requirement makes BOS fully conform to it and makes conformance mechanically enforced.

---

## User Stories

- As a **platform engineer**, I want every BOS table reachable only through a repository, so that `user_id` scoping and query patterns are guaranteed in one place and cannot be forgotten per-call-site.
- As a **security reviewer**, I want no direct `supabase.from(...)` / `supabaseServer` usage outside `lib/repositories/` in BOS code, so that RLS-bypass and cross-user leakage risk is confined to an auditable layer.
- As a **developer building an internal plugin** (Document 2), I want the CRM tables already behind conformant repositories, so that my repository-backed executor calls a repository method instead of writing SQL.
- As the **developer executing the monorepo migration**, I want all BOS data access already behind repositories, so that Phase 3 can `git mv` the repositories into `packages/repositories` without hunting inline queries across routes and services.
- As a **developer adding a new BOS feature**, I want a lint rule that fails my build if I write a direct DB call outside a repository, so that I learn the boundary immediately instead of at review.
- As the **System Architect**, I want a documented conformance checklist for BOS repositories, so that "has a repository" also means "conforms to the pattern," not just "a file exists."

---

## Current State

### Repositories that already exist (18 BOS repositories)

Grounded in [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) §1 and `lib/repositories/`:

| Domain | Repository (in `lib/repositories/`) | Tables covered |
|---|---|---|
| Business Profile | `BusinessProfileRepository` | `business_profiles` |
| CRM | `CRMContactRepository`, `CRMActivityRepository`, `CRMTaskRepository`, `CRMPipelineStagesRepository`, `ContactDocumentsRepository` | `crm_contacts`, `crm_activities`, `crm_tasks`, `crm_pipeline_stages`, `contact_documents` |
| Website | `WebsitePageRepository`, `WebsiteBlockRepository`, `WebsiteContentRepository`, `WebsiteAnalyticsRepository` | `website_pages`, `website_blocks`, `website_content`, `website_page_views` (+ `website_analytics_summary` view) |
| Scheduling | `SchedulingRepository`, `ExternalCalendarEventRepository` | `scheduling_services`, `scheduling_bookings`, `scheduling_availability_exceptions`, `external_calendar_events` |
| Payments | `PaymentRepository`, `PaymentPlanRepository` | 12 payment tables (`payment_invoices`, `payment_transactions`, `payment_methods`, `stripe_connect_accounts`, `payment_processors`, `payment_plans`, `payment_plan_installments`, `payment_events`, `payment_automation_rules`, `payment_automation_executions`, `payment_reminders`, `saved_payment_methods`) |
| Email | `EmailAutomationRepository` | 6 email tables |
| Intake | `IntakeRepository` | `intake_form_templates`, `user_intake_settings` |
| Onboarding | `OnboardingConversationRepository` | `onboarding_conversations` |
| Capabilities | `UserCapabilityRepository` | `user_capabilities`, `user_capability_blocks`, read of `capabilities` / `capability_building_blocks` |

### Gaps identified in a high-level audit (BA)

This audit was a manual read of BOS code, not an exhaustive grep; the implementation phase must run a full scan (see Acceptance Criteria). The scale is **moderate but concentrated** — most routes and the chat engine already use repositories cleanly; the violations cluster in two areas.

| # | Gap | Evidence | Severity |
|---|---|---|---|
| G1 | **Repositories located outside `lib/repositories/`.** Two data-access classes live under `lib/business-os/`, so they cannot be extracted into `packages/repositories` as-is and are not discoverable as repositories. | `lib/business-os/chat/CommandSessionRepository.ts`; `lib/business-os/insight/repository/InsightRepository.ts` | 🟡 |
| G2 | **Direct DB access inside a service cluster.** The entire `lib/business-os/insight/**` subsystem constructs services with a raw `SupabaseClient` and runs `.from()` queries directly against CRM/scheduling/payments/event tables, bypassing `lib/repositories/`. | `insight/metrics/MetricsComputeService.ts` (`private supabase: SupabaseClient`), `insight/metrics/BaselineCalculator.ts`, `insight/events/BusinessEventService.ts`, `insight/detectors/**` | 🔴 |
| G3 | **`WebsiteBlockRepository` scopes by `page_id` only, not `user_id`.** Relies on RLS + caller passing an owned `pageId`. Tension with mandatory rule #4. **Already tracked** as a data-model cleanup item — reference, do not re-diagnose. | [BUSINESS_OS_DATA_MODEL.md §13 obs #3](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#13-data-model-observations--risks); `lib/repositories/WebsiteBlockRepository.ts` | 🟡 |
| G4 | **Non-uniform `RepositoryResult` shape.** Each BOS repository defines its own local result type (e.g. `CRMContactRepositoryResult<T>`) rather than a shared shape, and `lib/repositories/types.ts` is not consistently used. Harms extractability and cross-repo consistency. | `CRMContactRepository.ts` local `CRMContactRepositoryResult<T>`; `lib/repositories/types.ts` | 🟢 |
| G5 | **Service-role singleton reliance.** BOS repositories export a singleton bound to `supabaseServer` (service role, bypasses RLS) and rely entirely on manual `.eq('user_id', userId)` for isolation. Correct today, but it makes the `user_id`-scoping guarantee (FR-2) load-bearing for security, not merely stylistic. | `export const crmContactRepository = new CRMContactRepository(supabaseServer)` | 🟢 (note) |

> **Note — API routes and the chat engine are mostly clean.** Spot-checks of `app/api/website/analytics/track/route.ts`, `lib/business-os/chat/CapabilityEngine.ts`, and `lib/business-os/ai-data-layer/SafeExecutionLayer.ts` show correct repository usage (repos instantiated with `supabaseServer`, all calls carrying `userId`). The problem area is the **insight subsystem** (G2) and the **two misplaced repositories** (G1), not the request layer broadly. The implementation audit must confirm this scope.

---

## Functional Requirements

1. **Every BOS table has a conformant repository in `lib/repositories/`.** For each of the ~42 BOS tables, all read and write access goes through a repository class in `lib/repositories/`. Tables with no current repository (e.g. some payment/website satellite tables accessed inline today) get one or an explicit, documented exception.
2. **Mandatory `user_id` scoping.** Every repository query includes `.eq('user_id', userId)` unless the table has no `user_id` column, in which case scoping is derived through the owning parent (e.g. `website_blocks` via `page_id` → owned `website_pages`) and that derivation is documented in the repository. This closes G3.
3. **Repositories relocated into `lib/repositories/`.** `CommandSessionRepository` and `InsightRepository` (and any other data-access class found under `lib/business-os/`) move to `lib/repositories/` (or are otherwise made extractable into `packages/repositories`), preserving behavior. This closes G1.
4. **Direct DB access remediated.** All `supabase.from(...)` / `supabaseServer.from(...)` calls in BOS code outside `lib/repositories/` are replaced with repository calls. The `lib/business-os/insight/**` subsystem consumes repositories instead of a raw `SupabaseClient`. This closes G2.
5. **Conformant repository shape.** Every BOS repository conforms to the pattern in [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md): a `RepositoryResult<T>`-style `{ data, error }` return, structured Pino logging via `createLogger`, a singleton export, and soft-delete handling **where the table supports it** (many BOS tables hard-delete or are append-only — see data-model §13 obs #9; those keep their documented behavior). This addresses G4.
6. **No behavior change for end users.** This is a refactor-and-enforce effort. Existing BOS features (chat commands, website publishing, booking, payments, insights) behave identically after remediation.
7. **New BOS code must comply by construction.** After this requirement lands, any new BOS table or feature must access data only through a repository — enforced by the guard in the next section.

> **Pilot sequencing.** For the CRM-first pilot (Step 1), FR-1/FR-2/FR-5 must hold **for the CRM tables** (`crm_contacts`, `crm_activities`, `crm_tasks`, `crm_pipeline_stages`, `contact_documents`) — which is already largely true, since the chat `CapabilityEngine` CRM branch routes exclusively through the CRM repositories. FR-3/FR-4 (relocating `CommandSessionRepository`/`InsightRepository` and remediating the `insight/**` cluster) and the full-BOS sweep are **tracked as separate tasks beyond the pilot**, not pilot blockers.

---

## Enforcement Requirement (Lint/CI Guard)

A lint rule must forbid direct Supabase table access (`supabase.from(...)`, `supabaseServer.from(...)`, `supabaseServerAuth.from(...)`) in any file **outside** `lib/repositories/` (and its monorepo successor `packages/repositories`), and it must run as a **CI gate**, not merely local lint.

- **Reuse, do not duplicate, the planned boundary work.** The monorepo architecture already mandates an ESLint `no-restricted-imports` boundary plus a **required CI `lint` job** (currently `next.config.js` sets `eslint.ignoreDuringBuilds: true`, so lint is not yet a build gate). See [BUSINESS_OS_MONOREPO_ARCHITECTURE.md §6.4](/docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md#64-eslint-import-boundary-enforcement--the-one-that-actually-works) and Phase 0 tasks 0.3/0.4. This "no direct DB access" rule should be **added to that same ESLint config and CI job**, so there is one enforcement mechanism, not two.
- **Rule shape is an SA/implementation decision.** Whether it is a `no-restricted-syntax` rule matching `.from(` on a Supabase client, a `no-restricted-imports` rule banning `@/lib/supabaseServer` / `@/lib/supabaseClient` outside repositories, or a custom rule, is for the workplan to specify.
- **The guard is only real if CI runs it.** This requirement is not met by adding a rule that `next build` ignores. The acceptance criteria below require a green/red CI signal.

---

## Non-Functional Requirements

- **Security:** No BOS query may run without user scoping. The guard plus FR-2 must make an unscoped BOS query impossible to introduce silently. Service-role (`supabaseServer`) usage stays confined to repositories and documented service-role paths (e.g. `external_calendar_events` sync cron, `website_page_views` public insert — data-model §13 obs #11).
- **Performance:** Remediation must not add round-trips. Where the insight subsystem currently issues aggregate/analytical queries directly, the repository methods it moves to must preserve the same query shape (e.g. count/sum aggregates), not fan out into N calls.
- **Maintainability:** One `RepositoryResult` shape and one logging convention across BOS repositories.
- **Monorepo-compatibility:** Every repository must be headless (no React, no BOS/app imports) so it can move to `packages/repositories` unchanged — this is already verified true for the existing 18 (architecture §13.3) and must hold for the relocated/remediated ones.

## Acceptance Criteria

- [ ] A full, mechanical audit (grep for `\.from(` on Supabase clients and for `supabaseServer`/`supabaseClient` imports) across `app/api/{crm,scheduling,payments,website,email,intake,business-os,book,insights,capabilities}/**`, `components/**` (BOS), and `lib/business-os/**` is produced, listing every direct-DB-access site. (The audit itself is an acceptance step; BA's high-level audit above is the starting hypothesis, not the final list.)
- [ ] Every BOS table maps to exactly one owning repository in `lib/repositories/` (documented as a table→repository matrix), or has a written, SA-approved exception.
- [ ] `CommandSessionRepository` and `InsightRepository` relocated into `lib/repositories/` (or confirmed extractable to `packages/repositories`) with no behavior change.
- [ ] Zero direct `.from(...)` calls remain outside `lib/repositories/` in BOS code (verified by the guard failing on a deliberately introduced violation, then passing once removed).
- [ ] `WebsiteBlockRepository` either scopes by `user_id` or documents and enforces parent-derived ownership (G3 closed).
- [ ] Every BOS repository returns a `{ data, error }` result, logs via `createLogger`, exports a singleton, and includes `.eq('user_id', userId)` (or documented parent-derived scoping) on every query.
- [ ] The ESLint "no direct DB access outside repositories" rule is added to the shared config and runs in CI as a required check; a PR introducing a direct `.from()` in a BOS route fails CI.
- [ ] Existing BOS integration/happy-path behavior is unchanged (QA regression on chat commands, booking creation, invoice creation, insight computation).

> **Pilot gate.** For Step 1 of the CRM pilot, only the CRM-scoped subset of the above must pass: the CRM tables map to their repositories, CRM data access carries no direct `.from()` outside `lib/repositories/`, and CRM repositories are conformant. The remaining criteria (full audit, relocations, insight remediation, repo-wide guard) are tracked as separate follow-up tasks.

## Out of Scope / Future Roadmap

- The actual monorepo `git mv` of repositories into `packages/repositories` — that is migration Phase 3, tracked in the architecture doc. This requirement only ensures the repositories are **ready** to move.
- The broader data-model hygiene items (corrupt `20260722_add_currency_to_scheduling_services.sql` migration, duplicate CRM/website migrations, RLS-off global catalog tables) — tracked in [BUSINESS_OS_DATA_MODEL.md §13](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#13-data-model-observations--risks). Reference only.
- The internal-plugin abstraction that sits **above** repositories (repository-backed plugin executors, access strategies, plugin-based provider selection) — [Document 2](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md).
- Converting any non-BOS direct DB access — out of scope; this requirement is BOS-only.

## Open Questions

- [ ] **Q1 — Insight subsystem: repositories vs. an approved analytical exception?** (raised by: BA | status: for SA) The `lib/business-os/insight/**` services run cross-table aggregate/analytical queries. Forcing every aggregate through a per-table repository may be awkward. **Suggested resolution:** create repository methods that own these aggregate queries (e.g. an `InsightMetricsRepository` or aggregate methods on the existing domain repositories) so the query still lives in `lib/repositories/`, rather than granting the subsystem a raw-client exception. SA to confirm the repository boundary for read-only analytics. *(Beyond the CRM pilot — the insight subsystem is not a pilot blocker.)*
- [ ] **Q2 — Parent-derived scoping as a sanctioned pattern.** (raised by: BA | status: for SA) For tables with no `user_id` (`website_blocks`, `user_capability_blocks`), is parent-derived ownership (verify owned parent, then query by parent key) an accepted alternative to a literal `.eq('user_id', ...)`, and should the lint guard understand that exception? **Suggested resolution:** yes — accept parent-derived scoping when documented in the repository and when the parent lookup is itself `user_id`-scoped; the guard targets raw client `.from()` calls, not the scoping column.
- [ ] **Q3 — Shared `RepositoryResult` type adoption.** (raised by: BA | status: for SA) Should G4 be fixed now (migrate all BOS repos to a shared `lib/repositories/types.ts` result type) or deferred to the monorepo extraction to avoid a large low-risk diff? **Suggested resolution:** standardize the shape opportunistically on repositories already being touched for FR-3/FR-4; defer a repo-wide sweep to Phase 3.

## Notes on Integration Points

- **Tables/schemas:** all ~42 BOS tables + `website_analytics_summary` view ([BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)).
- **Existing repositories:** the 18 listed above, plus the two to relocate (`CommandSessionRepository`, `InsightRepository`).
- **Callers to remediate:** `lib/business-os/insight/**` (primary), plus any route/service surfaced by the full audit.
- **Enforcement infra:** shared ESLint config + CI `lint` job ([architecture §6.4](/docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md#64-eslint-import-boundary-enforcement--the-one-that-actually-works), Phase 0.3/0.4).
- **Monorepo target:** `packages/repositories` (single writer, both apps — architecture §8).
- **Relationship to Document 2:** repositories are the data layer of the **repository-backed internal-plugin executors** in the unified plugin abstraction. Document 2 depends on this requirement being met for CRM first.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-05 | Initial draft | BA authored the BOS repository-layer requirement: enforce repository-only DB access across the 42 BOS tables, remediate the `lib/business-os/insight/**` direct-DB-access cluster and two misplaced repositories, close the `WebsiteBlockRepository` `user_id` gap, and add a CI-enforced lint guard reusing the monorepo boundary work. Grounded in a high-level BA audit; full mechanical audit is an acceptance step. |
| 2026-08-05 | Reframed for Option B (unified plugin abstraction) | Updated to reflect the user's decision that internal BOS modules become **internal plugins with repository-backed executors** (Document 2). Repositories are now framed as the **data layer behind internal-plugin executors** (an executor calls a repository, never the DB directly); added a "plugin-readiness" driver and a corresponding user story; re-pointed the out-of-scope and Document 2 cross-references to the unified-plugin framing. Substance of the requirement (repository conformance, insight-subsystem remediation, relocations, CI lint guard) unchanged. |
| 2026-08-05 | Recorded CRM-pilot-first scope | Added a **Pilot scope** callout (Overview), pilot-sequencing notes (FR + Acceptance), and a pointer to Document 2's agreed phased approach + the SA feasibility review: **Step 1 of the pilot is this requirement scoped to CRM** (CRM tables conformant, no direct DB access), while the full-BOS scope (insight remediation, misplaced-repo relocation, repo-wide guard) remains the end-state but is tracked as separate follow-up tasks. No change to the underlying requirement substance. |
