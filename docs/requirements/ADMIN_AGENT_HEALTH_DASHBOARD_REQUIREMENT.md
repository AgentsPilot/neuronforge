# Requirement: Admin Agent Health Dashboard & Failure Notifications

> **Last Updated**: 2026-06-30

**Created by:** BA
**Date:** 2026-06-30
**Status:** Draft

## Overview

This requirement defines a system-wide **admin operator view** that lets the platform owner monitor the health of all agents across all users once AgentPilot goes live. It combines (1) a "big dashboard" that surfaces overall agent statuses, execution outcomes (success / failure / pending) and trends, and calibration statuses — with a **per-user health breakdown** so the operator can tell at a glance which users are having a bad experience (failing agents) versus a good one (working agents); and (2) **reactive email notifications** that alert the admin when agent executions fail, each carrying a **call-to-action (CTA)** deep link to investigate the failing agent/user.

This is a requirements document only. It describes the business problem, goals, actors, and acceptance criteria — it does not prescribe a technical design. Architectural decisions (data aggregation strategy, real-time vs. polled refresh, notification delivery topology, admin authz model) are flagged for the SA.

---

## Table of Contents

1. [Problem & Motivation](#problem--motivation)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Actors / Personas](#actors--personas)
4. [User Stories](#user-stories)
5. [Functional Requirements](#functional-requirements)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Success Metrics / KPIs](#success-metrics--kpis)
8. [Existing System Grounding](#existing-system-grounding)
9. [Assumptions](#assumptions)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
12. [Open Questions](#open-questions)
13. [Notes on Integration Points](#notes-on-integration-points)
14. [References](#references)
15. [Change History](#change-history)

---

## Problem & Motivation

Today, agent health is only observable per-user (each user sees their own agents). Once the platform is live with many users creating their own agents, the operator has **no system-wide way to know who is succeeding and who is failing**. A user whose agents repeatedly fail may churn silently before anyone notices. The operator needs:

1. A single operator surface that answers "is the platform healthy right now, and which users are in trouble?" at a glance.
2. A push mechanism so the operator is told about failures **reactively** (without having to keep the dashboard open), with a direct link to act.

There is already a partial admin dashboard endpoint (`/api/admin/dashboard`) that aggregates some system-wide figures (users, agents, token usage, queue/execution success rate, memory). This requirement **extends that operator capability** with the two missing dimensions the owner called out — a **per-user health breakdown**, **calibration-status visibility**, and **reactive failure notifications** — rather than starting from zero.

---

## Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| 1 | Give the operator one system-wide ("big dashboard") view of overall agent health across ALL users. |
| 2 | Surface execution outcomes (success / failure / pending / running) and their trend over a selectable recent window. |
| 3 | Surface calibration statuses across the system (passed / failed / running / skipped / needs-review). |
| 4 | Provide a **per-user health breakdown** that makes failing users visually distinct from healthy users. |
| 5 | Reactively notify the admin by email when executions fail, including a CTA deep link to investigate. |
| 6 | Reuse the existing email transport, notification service, and admin-config patterns rather than building new infrastructure. |

### Non-Goals

| # | Non-Goal |
|---|---------|
| 1 | Per-user (end-user-facing) health dashboards — this is an operator/admin view, not a feature for regular users. |
| 2 | Auto-remediation of failing agents (no automatic retries, fixes, or pausing driven by this feature). |
| 3 | Replacing or redesigning the existing `/api/admin/dashboard` figures that are unrelated to agent health (memory, AIS, token cost cards). |
| 4 | Building a new general-purpose alerting/observability platform (e.g., Slack/Teams/PagerDuty integration) — email only for v1. |
| 5 | Billing / quota enforcement decisions based on failure rates. |

---

## Actors / Personas

| Actor | Description | Primary need |
|-------|-------------|--------------|
| **Platform Admin / Operator** (primary) | The platform owner (initially Barak) or a small trusted operations group. Has elevated, cross-tenant visibility. | See system-wide agent health at a glance; be told about failures proactively. |
| **End User** (indirect) | A regular user who creates and runs their own agents. Not a direct user of this feature; their agents' health is what the admin observes. | (Indirect) benefit from faster operator intervention when their agents fail. |

> **Open question:** what exactly defines an "admin" today is unresolved — see [Open Questions](#open-questions) Q1. The current admin API routes rely on the service-role key with no explicit admin authorization gate.

---

## User Stories

- As a **platform admin**, I want a single dashboard showing overall agent and execution health across all users, so that I can judge platform health at a glance without querying the database.
- As a **platform admin**, I want to see execution outcomes broken down by status and as a recent trend, so that I can tell whether failures are spiking.
- As a **platform admin**, I want to see calibration statuses across the system, so that I know how many newly created agents are stuck, failing, or successfully calibrated.
- As a **platform admin**, I want a per-user health breakdown that highlights users whose agents are failing, so that I can identify and reach out to at-risk users before they churn.
- As a **platform admin**, I want to drill from a flagged user into the specific failing agent/execution, so that I can investigate root cause quickly.
- As a **platform admin**, I want to receive an email when executions fail, with a button that takes me straight to the failing agent/user, so that I can act without constantly watching the dashboard.
- As a **platform admin**, I want to control how noisy these failure emails are (and whether they batch), so that high-volume failures don't bury me in mail.

---

## Functional Requirements

### A. System-Wide Overview Dashboard

| # | Requirement |
|---|-------------|
| A1 | Provide an operator-only dashboard surface that aggregates agent-health data across **all users** (cross-tenant). |
| A2 | Show overall **agent status** counts across the system (e.g., total agents, active, and other lifecycle states from the `agents.status` field). |
| A3 | Show **execution outcome** counts — success / failure / pending / running — sourced from `agent_executions.status`. |
| A4 | Show an **execution trend** over a recent, selectable time window (e.g., last 24h / 7d / 30d). The exact windows are to be confirmed — see Q5. |
| A5 | Show **calibration status** distribution across the system — `passed` / `failed` / `running` / `skipped` / legacy-NULL (from `agents.calibration_status`), and optionally calibration-run outcomes from `calibration_history` (`success` / `failed` / `needs_review` / `verification_only`). |
| A6 | Surface **at-a-glance health signals** (e.g., overall execution success rate and a simple health indicator) consistent with the health banding already used by `/api/admin/dashboard` (excellent / good / warning / critical). |

### B. Per-User Health Breakdown

| # | Requirement |
|---|-------------|
| B1 | Provide a per-user list/table where each row represents one user and summarizes that user's agent health (e.g., agent count, recent execution success rate, failed-execution count, agents currently in a failed/needs-review calibration state). |
| B2 | Visually distinguish **failing/at-risk users** from **healthy users** (e.g., sortable by failure rate, with a clear status indicator). The precise "at-risk" threshold definition is to be confirmed — see Q4. |
| B3 | Allow the operator to **drill down** from a user to the specific failing agent(s) and execution(s) for investigation. The depth of drill-down (agent-level vs. execution-log-level) is to be confirmed — see Q6. |
| B4 | Associate each user row with an identifier the operator can act on (e.g., email / display name), reusing the existing admin user-enrichment approach (`profiles` + `auth.users`). |

### C. Reactive Failure Email Notifications

| # | Requirement |
|---|-------------|
| C1 | When an agent execution **fails**, the system sends an email notification to the configured admin recipient(s). |
| C2 | The email MUST include a **CTA** — a deep link / button that opens the relevant investigation context (the failing agent, execution, or the flagged user). The exact deep-link target is to be confirmed — see Q7. |
| C3 | The email content MUST include enough context to triage without opening the app first (at minimum: which user, which agent, failure summary/time). |
| C4 | Notification volume MUST be controllable — the admin should be able to configure throttling, grouping/digest, or a minimum-severity trigger so that failure storms don't produce unbounded email. The exact model (per-failure vs. periodic digest vs. throttled) is to be confirmed — see Q2/Q3. |
| C5 | Notification behavior (recipient list, on/off, cadence, model used for any LLM-generated summary) SHOULD be **admin-configurable** following the existing DB-config admin pattern (a GET/PUT admin route backed by `system_settings_config` via `SystemConfigService`), mirroring `calibration-email-config`. |
| C6 | Email delivery MUST reuse the existing provider-agnostic transport (`lib/notifications/emailTransport.ts` via `NotificationService.sendTransactionalEmail`) and must be **best-effort / non-blocking** — a failure to send the notification must never block or break agent execution. |
| C7 | (If an LLM-generated failure summary is used) the model/provider MUST be DB-config-driven and default to a cheap, reliable model — no hardcoded model names (CLAUDE.md rule #5), consistent with how the calibration-result email was made configurable. |

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Access control** | The dashboard and notification-config endpoints MUST be restricted to admins/operators only. The current admin routes do not enforce an explicit admin gate (they use the service-role key directly) — this gap MUST be resolved as part of, or as a prerequisite to, this feature. See Q1. |
| **Security / multi-tenant** | This feature intentionally reads across all users (cross-tenant), which is a deliberate exception to the standard `.eq('user_id', userId)` rule and MUST be implemented via the service-role path with that intent documented in code (per Security Rules). No end-user-facing surface may expose another user's data. |
| **Notification latency** | Failure notifications should reach the admin promptly. Target latency is to be confirmed (e.g., near-real-time within minutes vs. a scheduled digest) — see Q3. |
| **Performance** | The dashboard aggregation MUST remain responsive as agent/execution volume grows. Aggregating raw `agent_executions` on every page load may not scale; the SA should assess whether pre-aggregation/caching is needed. This is a design concern, not a prescribed solution. |
| **Reliability** | Notification dispatch is best-effort and non-blocking; failure to notify must be logged (structured Pino) but must never affect execution or dashboard availability. |
| **Observability / logging** | All new server code MUST use structured Pino logging with a `correlationId` (CLAUDE.md rule #3). Note: the existing admin routes this feature builds near use `console.*` — this should be flagged and, with user approval, converted as those files are touched. |
| **Data access** | All new DB reads/writes MUST go through the repository layer per REPOSITORY_STRATEGY.md (no direct Supabase calls in routes/components). |
| **Input validation** | Any new API inputs (e.g., notification-config PUT, dashboard filters) MUST be validated with Zod. |

---

## Success Metrics / KPIs

| # | KPI | Why it matters |
|---|-----|----------------|
| 1 | Time-to-detect a failing user (from first failure to operator awareness) drops materially versus today's "no visibility" baseline. | The core problem is silent failure. |
| 2 | % of failing-agent incidents the operator is notified about (notification coverage). | Confirms the reactive path works. |
| 3 | Operator can identify the top N at-risk users in under ~X seconds on the dashboard. | Validates the "at a glance" goal. |
| 4 | Notification email volume stays within a tolerable bound (no failure-storm flooding). | Confirms throttling/digest is effective. |
| 5 | (Outcome) Reduction in churn among users who experienced agent failures, via faster operator intervention. | Ultimate business value. |

> Exact numeric targets (X, N) are to be set with the user once a baseline exists.

---

## Existing System Grounding

What already exists and should be reused vs. what is net-new.

| Capability | Status | Where |
|------------|--------|-------|
| System-wide admin aggregation (users, agents, token usage, **queue/execution success rate & health banding**, memory) | **Exists** | `app/api/admin/dashboard/route.ts` |
| Per-user admin listing with `profiles` + `auth.users` enrichment | **Exists** | `app/api/admin/users/route.ts` |
| Execution / quota stats per user | **Exists** | `app/api/admin/execution-stats/route.ts` |
| Provider-agnostic email transport with CTA-capable HTML body (Resend → env Gmail → owner google-mail plugin → console) | **Exists** | `lib/notifications/emailTransport.ts` |
| Transactional email wrapper (best-effort) | **Exists** | `lib/pilot/NotificationService.ts` (`sendTransactionalEmail`) |
| CTA email pattern (subject, summary, primary button/`ctaUrl`, best-effort, LLM summary w/ deterministic fallback) | **Exists** — directly reusable as a template | `lib/calibration/calibrationResultEmail.ts` |
| Admin DB-config GET/PUT pattern (`system_settings_config` via `SystemConfigService`) | **Exists** — reuse for notification config | `app/api/admin/calibration-email-config/route.ts` |
| Notification test harness (send a test system email, see which provider delivered) | **Exists** | `app/api/test/notification/route.ts`, `app/test-plugins-v2` Notification Service tab, `docs/workplans/notification-service-test-tab-workplan.md` |
| Execution outcome data | **Exists** | `agent_executions.status` (`completed` / `failed` / `pending` / `running`), `started_at`, `completed_at`; step detail in `agent_logs` |
| Agent lifecycle status | **Exists** | `agents.status` |
| Calibration lifecycle status | **Exists** | `agents.calibration_status` (`running`/`passed`/`failed`/`skipped`/NULL), `agents.is_calibrated`, `agents.last_successful_calibration_id` |
| Calibration run history + analytics view | **Exists** | `calibration_history` (status `success`/`failed`/`needs_review`/`verification_only`, `issues_found/fixed/remaining`, `user_id`), `calibration_success_metrics` view |
| **Per-user agent-health roll-up (failing vs. healthy users)** | **Net-new** | — |
| **Calibration-status surfacing inside the operator dashboard** | **Net-new** (data exists; aggregated operator view does not) | — |
| **Reactive failure-triggered admin email + CTA** | **Net-new** (transport exists; the trigger, recipient config, and throttling do not) | — |
| **Explicit admin authorization gate on admin routes** | **Net-new / gap** | — |

**Net-new summary:** the data and the email plumbing largely exist. The genuinely new work is (a) a per-user health roll-up, (b) folding calibration status into an operator view, (c) a failure-triggered notification path with recipient config + throttling, and (d) an admin authz gate.

---

## Assumptions

| # | Assumption |
|---|------------|
| 1 | The operator audience is small (initially one person), so v1 can favor simplicity over fine-grained role management. |
| 2 | `agent_executions.status` is the authoritative source for execution success/failure and is written reliably on every run. |
| 3 | `agents.calibration_status` and `calibration_history` are the authoritative sources for calibration state. |
| 4 | Email is an acceptable v1 notification channel; Slack/Teams/push are future roadmap. |
| 5 | The existing email transport's fallback chain is sufficient for admin notifications (no new transport needed). |
| 6 | Cross-tenant reads via the service role are acceptable here because the surface is admin-only and documented as an intentional RLS bypass. |

---

## Acceptance Criteria

- [ ] **AC-1** An admin can open one operator surface that shows system-wide agent-status, execution-outcome, and calibration-status summaries across all users.
- [ ] **AC-2** The dashboard shows execution outcomes broken down as success / failure / pending / running, plus a trend over a selectable recent window.
- [ ] **AC-3** The dashboard shows a calibration-status distribution sourced from `agents.calibration_status` (and/or `calibration_history`).
- [ ] **AC-4** The dashboard shows a per-user breakdown in which failing/at-risk users are visually distinct from healthy users and the list can be ordered to put at-risk users first.
- [ ] **AC-5** From a flagged user, the admin can drill down to the specific failing agent(s)/execution(s).
- [ ] **AC-6** When an agent execution fails, the configured admin recipient(s) receive an email containing failure context and a working CTA deep link.
- [ ] **AC-7** Notification volume is bounded by an admin-configurable throttle/digest/severity setting (failure storms do not produce unbounded email).
- [ ] **AC-8** Notification dispatch is non-blocking and best-effort — a delivery failure is logged but never breaks execution.
- [ ] **AC-9** Notification config (recipients, on/off, cadence, any LLM model used) is admin-configurable via a GET/PUT route backed by `system_settings_config`, with no hardcoded model names.
- [ ] **AC-10** The dashboard and notification-config endpoints are accessible to admins/operators only (admin authz gate enforced).

---

## Out of Scope / Future Roadmap

| # | Item | Note |
|---|------|------|
| 1 | Slack / Teams / push / SMS notification channels | Email only for v1. |
| 2 | Auto-remediation (auto-retry, auto-pause, auto-fix failing agents) | Operator acts manually in v1. |
| 3 | End-user-facing health dashboards | This feature is operator-only. |
| 4 | Fine-grained admin roles / multi-operator RBAC | v1 assumes a small trusted operator set. |
| 5 | Calibration-failure-triggered notifications (vs. execution-failure) | Possible extension; v1 focuses on execution failures. The calibration-result email already covers the owner-facing case. |
| 6 | Historical analytics / BI reporting beyond the recent-window trend | Out of scope; `calibration_success_metrics` already offers some of this. |
| 7 | Configurable per-user notification rules (e.g., notify only for specific users/agents) | Future. |

---

## Open Questions

- [ ] **Q1** What defines an "admin" in this system, and how should the admin gate be enforced? Today's admin routes use the service-role key with **no explicit admin authorization check**. (raised by: BA | status: pending user input) — *Suggested resolution:* introduce an explicit admin allow-list or role check (e.g., an `is_admin`/role flag on `profiles` or an env/DB allow-list of admin user IDs/emails) and require it on all admin routes; SA to choose the mechanism. Treat closing this gap as a prerequisite, since the new surface exposes cross-tenant data.
- [ ] **Q2** Should failure notifications be **per-failure (real-time)**, a **periodic digest**, or **throttled/grouped**? (raised by: BA | status: pending user input) — *Suggested resolution:* default to a throttled/grouped model (e.g., one email per agent-or-user per cooldown window) with an admin-configurable digest option, to avoid failure-storm flooding while keeping latency low for isolated failures.
- [ ] **Q3** What is the acceptable **notification latency** (near-real-time within minutes vs. scheduled digest every N minutes/hours)? (raised by: BA | status: pending user input) — *Suggested resolution:* target near-real-time (minutes) for the first failure in a window, with batched follow-ups; confirm with user.
- [ ] **Q4** How is an **"at-risk / failing" user** defined for the per-user breakdown (e.g., failure rate threshold over a window, absolute failed-execution count, or any agent in `failed`/`needs_review` calibration)? (raised by: BA | status: pending user input) — *Suggested resolution:* start with execution success rate below a configurable threshold over the selected window OR ≥1 agent stuck in failed calibration; make the threshold DB-configurable.
- [ ] **Q5** What **time windows** should the dashboard trend and per-user roll-up support (24h / 7d / 30d / custom)? (raised by: BA | status: open) — *Suggested resolution:* 24h / 7d / 30d presets, defaulting to 7d, matching windows already used by `/api/admin/dashboard`.
- [ ] **Q6** What is the required **drill-down depth** — agent-level, execution-level, or full step-by-step logs (`agent_logs`)? (raised by: BA | status: pending user input) — *Suggested resolution:* agent + execution level in v1, with a link out to existing execution detail; full `agent_logs` rendering deferred.
- [ ] **Q7** What should the failure email **CTA deep-link** point to (an admin agent/execution detail page, the flagged user's breakdown, or the existing app's agent page)? (raised by: BA | status: pending user input) — *Suggested resolution:* link to an admin drill-down for the failing agent/execution; if no admin detail page exists yet, link to the user breakdown row as an interim target. SA to confirm available routes.
- [ ] **Q8** Who are the **notification recipients** — only the owner, or a configurable list? (raised by: BA | status: pending user input) — *Suggested resolution:* a DB-configurable recipient list (default: the owner's email), following the `calibration-email-config` config pattern.
- [ ] **Q9** Is **multi-tenant cross-user reading** via the service role acceptable for this admin surface (confirming the documented RLS-bypass exception)? (raised by: BA | status: pending user input) — *Suggested resolution:* yes, admin-only with the bypass documented in code per Security Rules; never expose cross-user data to a non-admin surface.

---

## Notes on Integration Points

| System / Table | Affected how |
|----------------|--------------|
| `agent_executions` | Primary source of execution-outcome counts/trends and the failure trigger. |
| `agent_logs` | Potential source for drill-down failure detail (depth per Q6). |
| `agents` (`status`, `calibration_status`, `is_calibrated`, `last_successful_calibration_id`) | Source of agent-status and calibration-status aggregation. |
| `calibration_history` + `calibration_success_metrics` view | Source of calibration-run outcomes and analytics. |
| `profiles` + `auth.users` | Per-user identity/enrichment for the breakdown (reuse existing admin enrichment approach). |
| `system_settings_config` (via `SystemConfigService`) | Stores notification config (recipients, cadence, throttle, any LLM model) — mirror `calibration-email-config`. |
| `lib/notifications/emailTransport.ts` / `lib/pilot/NotificationService.ts` | Reused for delivery (best-effort, provider-agnostic). |
| `lib/calibration/calibrationResultEmail.ts` | Template/reference for the CTA email (subject + summary + primary button + best-effort send). |
| `app/api/admin/dashboard/route.ts` | Existing operator aggregation to extend rather than duplicate. |
| `app/api/test/notification/route.ts` + `/test-plugins-v2` Notification Service tab | Existing harness to verify the email path during development. |
| Repository layer (`lib/repositories/`) | New cross-tenant reads must be added here, not inline in routes (REPOSITORY_STRATEGY.md). |
| AI Provider Factory (`lib/ai/providerFactory.ts`) | If an LLM failure-summary is used, route through the factory with DB-config model (no hardcoding). |

---

## References

- [CLAUDE.md](/CLAUDE.md) — project rules (logging, repository, provider factory, security)
- [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) — repository pattern
- [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md) — Pino logging standards
- `docs/workplans/notification-service-test-tab-workplan.md` — notification transport + DB-config email model precedent
- `app/api/admin/calibration-email-config/route.ts` — admin DB-config GET/PUT precedent
- `app/api/admin/dashboard/route.ts` — existing operator aggregation

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-30 | Initial draft | BA authored requirement for an admin agent-health dashboard (system-wide overview + per-user health breakdown + calibration-status surfacing) and reactive failure email notifications with CTA. Grounded in existing systems: `agent_executions`, `agents.calibration_status`, `calibration_history`, the provider-agnostic email transport, and the `calibration-email-config` admin DB-config pattern. 9 open questions flagged (admin definition/authz, notification cadence/latency/throttle, at-risk-user definition, time windows, drill-down depth, CTA target, recipients, multi-tenant read). |
