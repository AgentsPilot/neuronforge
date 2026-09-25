# Requirement: Admin Module Reorganisation for Business OS

> **Last Updated**: 2026-09-24

**Created by:** BA
**Date:** 2026-09-24
**Status:** Draft (a proposal for user review; nothing is built from this document until the user approves it and SA reviews the slices)

## Overview

`/admin` was built for the AgentsPilot agent platform, which is now parked. Business OS (BOS) is the live product, but in the admin sidebar it has **one entry out of 21**, and that entry sits second in "Configuration". The landing page, the "Queue Monitor" and the per-user detail all describe agents. This document proposes a new **information architecture (IA)** for the two platform admins (the user and Offir, both technical owners) whose job is to **monitor the system and find issues**. It sets out a sequence of small, independently shippable slices and a short roadmap towards the endgame: *monitor everything from admin*. No code is deleted. AgentsPilot pages stay reachable in one collapsed group. The visual design does not change.

---

## Table of Contents

1. [Decisions Already Made (user, 2026-09-24)](#1-decisions-already-made-user-2026-09-24)
2. [Current-State Inventory](#2-current-state-inventory)
3. [Assessment](#3-assessment)
4. [Target Information Architecture](#4-target-information-architecture)
5. [Benchmark: AgentsPilot Admin to BOS Equivalent](#5-benchmark-agentspilot-admin-to-bos-equivalent)
6. [User Stories](#6-user-stories)
7. [Phased Plan: Shippable Slices](#7-phased-plan-shippable-slices)
8. [Future Roadmap](#8-future-roadmap)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Out of Scope](#10-out-of-scope)
11. [Open Questions](#11-open-questions)
12. [Notes on Integration Points](#12-notes-on-integration-points)
13. [Change History](#change-history)

---

## 1. Decisions Already Made (user, 2026-09-24)

| # | Decision |
|---|---|
| D-1 | Audience: two platform admins, both technical owners. Neither is support staff. |
| D-2 | Job to be done: monitor and find issues. That means looking up one business when it complains, cron/queue/AI health, spend, and adjusting a customer's credits or plan. There are no live customers yet. The endgame is to monitor everything from admin. |
| D-3 | AgentsPilot pages are parked. **No code is deleted.** Hiding them, or consolidating them into one compact area, is acceptable. |
| D-4 | The look stays: colours, fonts and components are unchanged. The priority is IA reordering plus a short-term roadmap. |
| D-5 | Every roadmap item gets an effort size (S/M/L) and an impact rating (High/Med/Low). |
| D-6 | Incremental slices, each shippable on its own, with no big bang. Suggested order: (a) BOS up front, (b) reuse generic screens, (c) hide or consolidate AgentsPilot. |

---

## 2. Current-State Inventory

Read from the code on 2026-09-24 (branch `feature/business-os-llm-admin-screen-refinements`). Sources are `app/admin/components/AdminSidebar.tsx`, every `app/admin/*/page.tsx` and `app/api/admin/**`.

**Sidebar today:** 5 sections, **21 items**: Overview 4, Users 4, AI System 5, Configuration 6, Admin 2. There are **22 pages**. **Verified: `/admin/exchange-rates` has no sidebar entry.** The sidebar footer's "System: API OK / Queue OK / DB OK" block is **hardcoded text**. It checks nothing and is always green (`AdminSidebar.tsx:331-353`).

Audience legend: **BOS** = Business OS; **AP** = AgentsPilot; **Shared** = serves both.

### 2.1 Pages

| # | Page (sidebar label) | Route | Audience | What it actually shows / does | R/W | Verdict |
|---|---|---|---|---|---|---|
| 1 | Dashboard | `/admin` | AP (mostly) | Period-selectable totals: users, **agents**, token cost, **memory ROI**, **agent execution queue**, **AIS** metrics (`/api/admin/dashboard`) | Read | Consolidate-hidden (after a BOS landing replaces it) |
| 2 | Queue Monitor | `/admin/queues` | **AP** | Live `agent_executions` by status, 5 s auto-refresh, detail modal (`/api/agent-executions/stats`). **Not a BOS queue**, despite the generic name | Read | Consolidate-hidden |
| 3 | System Flow | `/admin/system-flow` | AP | Static animated explainer of the V6 agent pipeline. Hardcoded steps, no live data | Read | Candidate-retire-later |
| 4 | Cost Analytics | `/admin/analytics` | **Shared** | Token-usage cost drill-down over `token_usage`: provider, model, activity, user, agent, execution, call. Filters include `feature` / `component`, which BOS calls populate | Read | **Reuse-for-BOS** |
| 5 | User Management | `/admin/users` | Shared (AP-shaped detail) | User list with search and active/inactive filter. Expanded detail shows **agents, agent executions**, token spend by model, subscription balance, plugins, login stats and audit log. **No business profile, plan or BOS module facts** | Read | **Reuse-for-BOS** |
| 6 | Onboarding | `/admin/onboarding` | Shared | Free-tier config (pilot tokens, storage, executions, duration) plus a per-user onboarding status list | **Write** (`PUT /api/admin/onboarding-config`) | Reuse-for-BOS (config tab only) |
| 7 | Messages | `/admin/messages` | Shared | Contact-form inquiries, with status, reply, admin notes and delete | **Write** | Keep-front |
| 8 | Reward Config | `/admin/reward-config` | AP | Credit rewards for sharing agents (min executions, agent age, per-month caps) | **Write** | Consolidate-hidden |
| 9 | Agent Generation | `/admin/agent-generation-config` | AP | Provider/model/temperature per V6 phase | **Write** | Consolidate-hidden |
| 10 | Orchestration | `/admin/orchestration-config` | AP | Model tiers, AIS routing thresholds, compression | **Write** | Consolidate-hidden |
| 11 | AIS Config | `/admin/ais-config` | AP | Agent-intensity ranges, best-practice vs dynamic mode | **Write** | Consolidate-hidden |
| 12 | Memory & Insights | `/admin/memory-config` | AP | Agent memory injection, summarisation and embedding config. **Not BOS Insights** (name collision) | **Write** | Consolidate-hidden |
| 13 | Memory Dashboard | `/admin/learning-system` | AP | Agent memory learnings, growth and ROI (browser Supabase client) | Read | Consolidate-hidden |
| 14 | System Config | `/admin/system-config` | **Shared** | Model **pricing** table and sync, billing grace period, **boost packs** (credit purchase), and the AP cost calculator. The pricing table determines BOS AI cost | **Write** | Reuse-for-BOS |
| 15 | Business OS AI | `/admin/business-os-llm` | **BOS** | What each of the 8 BOS AI areas and 22 catalogued calls resolves to (provider, model, temperature, on/off state). Refinements are in flight on this branch | Read-only | **Keep-front** |
| 15b | Business OS Tiers | `/admin/business-os-tiers` | **BOS** | *(Merged to main 2026-09-24, after the first draft of this inventory.)* The four BOS plans and their allowances, a banner stating that enforcement is off, account lookup ("what is this account entitled to"), and a panel naming the write operations that exist only as API | Read-only | **Keep-front** (becomes the Businesses → Plans & entitlements item) |
| 16 | Storage Config | `/admin/storage-config` | AP | Token-threshold storage tiers, per-user storage usage | **Write** | Consolidate-hidden |
| 17 | Executions Config | `/admin/executions-config` | AP | Token-threshold agent-execution quota tiers | **Write** | Consolidate-hidden |
| 18 | UI Config | `/admin/ui-config` | AP | App UI version (v1/v2) and design-token overrides | **Write** | Consolidate-hidden |
| 19 | HelpBot Config | `/admin/helpbot-config` | AP | In-app help assistant model, prompts, cache and theme | **Write** | Consolidate-hidden |
| 20 | Audit Trail | `/admin/audit-trail` | **Shared** | Full `audit_trail`, with catalogue-driven filters and a renderer for **BOS AI action** entries (Slice A, PR #100) | Read | **Keep-front** |
| 21 | Settings | `/admin/settings` | Shared | Admin users (`admin_users`): add and remove | **Write** | Keep (bottom) |
| 22 | *(no entry)* Exchange Rates | `/admin/exchange-rates` | AP / display | Currency `rate_to_usd` editing and history. **Reads and writes from the browser via the Supabase client** (no admin API route) | **Write** | Consolidate-hidden, leave unlisted (see §4.3) |

**Totals:** 3 BOS-useful as-is (15, 20, 7), 5 Shared that could serve BOS (4, 5, 6, 14, 21), and 14 AP-only.

### 2.2 BOS admin capabilities with no admin page

| Capability | Where it exists | UI today |
|---|---|---|
| **Entitlements: inspect one account** ("what is this account entitled to, and which layer decided") | `GET /api/admin/business-os/entitlements/accounts/[accountId]` | None |
| **Entitlements: change one account** (`ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state`), audited with reason | `POST` same route | None |
| **Entitlements shadow report** (open-ended accounts, "what would tier X cost", setup-AI sizing) | `GET …/entitlements/shadow-report` | None |
| **Launch dry run** (how many accounts would become champions) | `POST …/entitlements/launch` (dry run only) | None |
| **Per-business LLM usage verification** | `GET /api/admin/business-os/llm-usage` and `…/llm-usage/businesses` | Only in the `/test-business-os` **LLM Usage** tab, outside `/admin` |
| **Ledger corroboration check** | `GET …/llm-settings/ledger` | Parked panel (refinements FR-3) |
| **Business data reset / purge preview** | `/test-business-os` **Danger Zone** tab | Outside `/admin`; the reset is inert (data-purge cycle parked) |

### 2.3 Background jobs relevant to monitoring

`vercel.json` schedules 15 crons. **12 are BOS**: calendar-sync, insight-metrics, insight-detect, insight-automations, insight-actions, channel-metrics-sync, payment-reminders, intake-reminders, payment-retry, daily-briefing, lead-response, abandoned-proposal-invoices. **3 are AP and still scheduled**: `run-scheduled-agents` (every 5 min), `update-template-scores` and `memory-consolidation`. The payment reminder and payment automation drains use the §8.1 durable-queue pattern (claim, reaper, dead-letter). **Admin shows none of these jobs.** I found no record of cron runs that a page could read. SA to confirm.

---

## 3. Assessment

**For two technical owners whose job is "find what is wrong", the current layout is both overkill and insufficient.**

| Finding | Why it matters |
|---|---|
| **1 of 21 sidebar items is BOS, and it is buried** (Configuration, 2nd) | The live product is the hardest thing to find. |
| **14 of 22 pages configure or display a parked product** | This is mostly config sprawl. Eleven of them write settings for agents nobody is building. Each one is a chance to change something by mistake. |
| **The landing page answers the wrong question** | It reports agent counts, AIS and memory ROI. It cannot tell you whether a BOS reminder failed to send or an insight run stalled. |
| **"Queue Monitor" is misleading** | It monitors agent executions only. The BOS queues (payment reminders, automations) and the 12 BOS crons have **no admin surface**. |
| **The sidebar status footer is fake** | A hardcoded green "OK" in a console meant for finding issues is worse than no indicator. It teaches you to trust a light that never changes. |
| **The per-user view has no business in it** | When a business complains, you see its agents and plugins. You don't see its plan, BOS modules, AI spend or failed AI actions. |
| **BOS admin power already exists but lives in APIs, scripts and a test harness** | Entitlements (7 audited ops), the shadow report and the LLM usage report are built and admin-gated but have no page. Model settings change through `npm run bos:llm-settings`. |
| **What is good** | The admin gate is sound: every `/admin` page is guarded by `app/admin/layout.tsx`, so a new page is protected automatically. Audit Trail and Business OS AI are recent, careful and BOS-aware. Cost Analytics already has the `feature`/`component` dimensions BOS writes. |

**Bottom line:** the problem is priority and visibility, not visual design. Most of the fix is **subtraction and reordering** (cheap). The real gaps are **three monitoring surfaces that don't exist yet**: health at a glance, cron/queue health, and a business 360 view.

---

## 4. Target Information Architecture

### 4.1 Design rules

1. **The landing page answers "is anything wrong?"** in one screen. Every tile links to the full page in one click.
2. **Sections follow the job, not the system.** Monitor comes first, then Businesses (look one up, act on it), then Settings, with parked AP last.
3. **Names are honest.** A label says what the page covers. For example, the current "Queue Monitor" becomes "Agent execution queue" and moves into the AP group.
4. **Nothing is removed and every route keeps its URL.** Parking is a navigation change, not a code change.

### 4.2 Target sidebar (end state)

| Section | Item | Route | State today |
|---|---|---|---|
| **Monitor** | **Health** (landing) | `/admin` | New (slice 4) |
| | AI cost & usage | `/admin/analytics` | Exists (renamed; BOS lens added in slice 2) |
| | AI activity | *new route* | Approved, not built (Gap B) |
| | Scheduled jobs & queues | *new route* | New (roadmap R-2) |
| | Audit trail | `/admin/audit-trail` | Exists |
| **Businesses** | Businesses | `/admin/users` (renamed, BOS panel in slice 2) → later the 360 view | Partial |
| | Plans & entitlements | `/admin/business-os-tiers` (today's "Business OS Tiers") | Exists, read-only. Writes are API-only (R-6) |
| | Messages | `/admin/messages` | Exists |
| **Settings** | Business OS AI | `/admin/business-os-llm` | Exists |
| | Model pricing & billing | `/admin/system-config` | Exists (renamed) |
| | Free tier & onboarding | `/admin/onboarding` | Exists (renamed) |
| | Admin users | `/admin/settings` | Exists (renamed) |
| **AgentsPilot (parked)** *collapsed* | Platform dashboard (legacy), Agent execution queue, System flow, Agent generation, Orchestration, AIS config, Agent memory config, Agent memory dashboard, Reward config, Storage config, Executions config, UI config, HelpBot config | unchanged routes | Exists |

The daily path is 4 visible sections, about 12 items, plus one collapsed group. A new item appears only once its page ships, so no link leads to an empty page.

### 4.3 How parked AgentsPilot pages are tucked away

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. One collapsed sidebar group, "AgentsPilot (parked)", at the bottom** *(recommended)* | Sidebar data only. Collapsed by default, **auto-expanded when the current page is inside it** so the active highlight stays visible | Zero route or code moves. One click to reach any page. Trivially reversible. Makes "parked" visible rather than mysterious | The group still costs one row of sidebar space |
| B. A single "AgentsPilot" hub page with a card per page | One sidebar entry leads to a page of links | Smallest sidebar | Needs a new page. Every visit takes two clicks. The active state is lost on sub-pages |
| C. Remove the links and keep the routes reachable by URL | Sidebar deletion | Cleanest sidebar | Pages become undiscoverable, and "parked" drifts into "forgotten" |

**Recommendation: Option A.** It meets D-3 and D-6 with the smallest change, keeps every route one click away, and can be undone in one line.

**Exchange Rates stays unlisted.** It was already unlisted, and it writes directly from the browser to the database, bypassing the admin API pattern. Surfacing it would increase exposure. It is recorded here for SA and is not added to any group.

### 4.4 Assumptions (technical forks decided by BA, to be confirmed by SA)

| # | Assumption |
|---|---|
| A-1 | Sidebar grouping and collapse are implemented in the existing `AdminSidebar` component and styles, with no new component library (D-4). |
| A-2 | Until the Health page ships, `/admin` keeps showing today's dashboard. When Health ships, the old dashboard moves to a route inside the parked group, with its code kept intact. The exact route is SA's call. |
| A-3 | The fake status footer is **removed** in slice 1, not rewired. A real indicator comes back only once Health produces real signals (R-12). |
| A-4 | "Business" = one BOS account (the `accountId` the entitlements module keys on). See OQ-3. |
| A-5 | Renames change labels and descriptions only, never routes. The existing `nav.test.ts` pin on the Business OS AI entry's description stays satisfied. |

---

## 5. Benchmark: AgentsPilot Admin to BOS Equivalent

| AgentsPilot capability | Operator need it served | BOS needs an equivalent? | BOS equivalent | State |
|---|---|---|---|---|
| Platform dashboard (totals) | "How is the platform doing?" | **Yes, redesigned** | Health at a glance: signals, not totals | New |
| Queue Monitor (live execution queue, failures, detail) | "Is work getting done?" | **Yes, the biggest gap** | Scheduled jobs & queues: 12 BOS crons, payment reminder and automation queues, dead-lettered rows | New |
| Cost Analytics drill-down | "Where is the money going?" | **Yes** | Same page with a BOS lens: by business, by area, by call | Partial |
| User Management plus per-user stats | "Who is this customer and what is happening to them?" | **Yes** | Business 360 | Partial |
| Storage / Executions quota tiers | "What may this customer use?" | **Yes, in a different form** | Plans & entitlements (tiers, cohorts, overrides, expiry) | Partial (API only) |
| Onboarding free-tier config and status | "What does a new signup get, and did they finish setup?" | **Partly** | Free-tier config stays shared. BOS setup progress belongs in the 360 view | Partial |
| Agent Generation / Orchestration / AIS model config | "Which model runs what?" | **Yes, already done** | Business OS AI | Exists (read-only; writer planned) |
| Memory config / Memory dashboard | "Is the learning layer working and worth it?" | **Yes, as an analogue** | Insight pipeline health (runs, businesses left unprocessed, detectors firing) | New |
| Reward config (share-an-agent credits) | Growth incentive for agents | **No** | None | — |
| System Flow explainer | Onboarding engineers to the pipeline | **No** | Architecture docs cover it | — |
| UI Config / HelpBot Config | App look and in-app assistant | **No, not now** | None | — |
| Exchange rates | Display of credits in local currency | **No** | BOS rule: never sum or convert money across currencies (CLAUDE.md) | — |
| Model pricing, boost packs | "What does a call cost us / what do we sell?" | **Yes, shared** | System Config, unchanged | Exists |
| Audit trail, Admin users, Messages | Accountability, access, inbound contact | **Yes, shared** | Unchanged | Exists |

---

## 6. User Stories

- As a platform admin, I want to open `/admin` and see at a glance whether anything in BOS is failing, so that I don't have to visit six pages to know all is well.
- As a platform admin, when a business complains I want to find it by name or email and see its plan, modules, recent AI actions, failures and spend on one page, so that I can diagnose it without SQL.
- As a platform admin, I want to see whether each scheduled job ran, succeeded, and how much work is waiting or dead-lettered, so that a silent stop is noticed before a customer notices.
- As a platform admin, I want AI spend broken down by business and by area, so that I can spot a runaway business or feature.
- As a platform admin, I want to change a customer's plan or credits with a recorded reason, so that support actions are safe and auditable.
- As a platform admin, I want AgentsPilot screens out of the way but still reachable, so that the parked product doesn't clutter daily work and can be revived.

---

## 7. Phased Plan: Shippable Slices

Each slice ships alone, needs no later slice to make sense, and deletes no code or route. Slices 1 to 3 follow the user's suggested order (a) → (b) → (c). Slice 4 onwards is where the monitoring gaps are closed.

### Slice 1: Put BOS up front (navigation only)

| Field | Detail |
|---|---|
| **Scope** | Sidebar data and labels only. (1) Reorder into **Monitor / Businesses / Settings / AgentsPilot (parked)** using **only pages that exist today**: Monitor = Dashboard, AI cost & usage, Audit trail; Businesses = Users, Plans & entitlements (the existing Business OS Tiers page), Messages; Settings = Business OS AI, Model pricing & billing, Free tier & onboarding, Admin users; the other 12 AP items go into the parked group, **still expanded** in this slice. (2) Honest renames (e.g. "Queue Monitor" becomes "Agent execution queue"; descriptions say "AgentsPilot" where true). (3) **Remove the hardcoded status footer.** |
| **What the user sees** | The same look. BOS and shared pages are at the top, and every AP page sits under one clearly labelled heading at the bottom. The fake green "OK" block is gone. |
| **Effort** | S |
| **Risk** | Low. No route, API, data or page-content change. Tests that pin the sidebar (`business-os-llm/__tests__/nav.test.ts`) must still pass. |
| **Acceptance criteria** | ☐ All 21 existing routes are reachable from the sidebar in at most one click ☐ No file under `app/admin/*/page.tsx` or `app/api/admin/**` is changed or deleted ☐ Section order is Monitor, Businesses, Settings, AgentsPilot (parked) ☐ Business OS AI appears in the first screen of the sidebar without scrolling at 1080p ☐ The status footer is gone and no other element claims system status ☐ The active-page highlight works for every item ☐ The existing nav tests pass ☐ Exchange Rates remains unlisted |

### Slice 2: Give the shared screens a BOS lens (reuse)

| Field | Detail |
|---|---|
| **Scope** | (2a) **AI cost & usage:** a "Business OS only" preset that uses the platform's existing definition of a BOS row (the `business-os` prefix **plus** the five legacy feature values, per B0 workplan V-6). **Not** a hand-written `business-os-%` filter. (2b) **Users → "Businesses":** add a BOS panel to the expanded detail (business name/vertical, entitlement snapshot from the existing API, BOS AI spend 30 d, recent BOS AI failures linked to the Audit trail). Agent facts remain, collapsed. (2c) **Audit trail:** a one-click "BOS AI failures" view. |
| **What the user sees** | Cost Analytics opens on BOS spend with one click. Opening a user shows their business and plan first. |
| **Effort** | M (2a S, 2b M, 2c S; can ship as three PRs) |
| **Risk** | Low–Med. 2b reads another account's data on an admin path: it must follow the cross-account read conventions (admin-gated, metadata only, no owner text) and SA reviews it. The routes touched still carry `console.*` and error-detail debt, and fixing that is part of touching them (CLAUDE.md rule 3). |
| **Acceptance criteria** | ☐ BOS preset totals match the BOS spend for the same window from the existing LLM usage report ☐ Legacy-tagged BOS rows are included ☐ The detail panel shows plan/cohort and "which layer decided" exactly as the entitlements API returns them ☐ No prompt, message body or owner text is displayed ☐ Non-admin access is refused (inherited guard) ☐ Happy path plus one failure path tested |

### Slice 3: Consolidate AgentsPilot (hide)

| Field | Detail |
|---|---|
| **Scope** | The "AgentsPilot (parked)" group becomes **collapsed by default** and auto-expands when the current page is inside it. Group label: "AgentsPilot (parked)", with a one-line note that pages are kept for revival. |
| **What the user sees** | The daily sidebar is about 10 items plus one collapsed row. |
| **Effort** | S |
| **Risk** | Low |
| **Acceptance criteria** | ☐ Group is collapsed on first load ☐ Visiting any parked route shows the group expanded with the item highlighted ☐ Every parked route still loads and works unchanged ☐ Keyboard-operable expand/collapse with an accessible label |

### Slice 4: Health at a glance (new landing)

| Field | Detail |
|---|---|
| **Scope** | A new `/admin` landing built **only from signals that already exist**. (1) BOS AI areas: any switched off, any setting with issues. (2) BOS AI failures in the last 24 h / 7 d (audit trail). (3) BOS AI spend in the last 24 h / 7 d against the previous period. (4) Critical-severity audit events. (5) Entitlements mode (off / shadow / enforce). Tiles for cron/queue health are shown as **"Not measured yet"** until R-2 ships, never as green. The old dashboard moves into the parked group (A-2). |
| **What the user sees** | One screen of red, amber or neutral tiles. Each links to its full page. |
| **Effort** | M |
| **Risk** | Med. Aggregating over `token_usage` across accounts has no suitable index today (B0 workplan V-3). A 24 h/7 d window must be measured, or wait for B0's index. SA decides. |
| **Acceptance criteria** | ☐ Every tile links to a page that shows the same number ☐ No tile shows green for something that is not measured ☐ Page loads within the NFR budget (§9) at current volumes ☐ The old dashboard is still reachable in one click from the parked group |

Slices after 4 are the roadmap items below, taken in the order the user prioritises. The suggested next steps are R-2 (jobs & queues), then R-3 (Business 360), then R-6 (plans page).

---

## 8. Future Roadmap

State: **Exists** = in code and usable; **Partial** = data or API exists, the admin UI does not; **New** = nothing found.

| # | Item | Description | State | Effort | Impact | Dependencies / notes |
|---|---|---|---|---|---|---|
| R-1 | Health at a glance | Slice 4 above | Partial | M | **High** | B0 index for cheap spend windows |
| R-2 | Scheduled jobs & queues | Per BOS cron: last run, outcome, duration, items processed/left (e.g. insight-detect `usersRemaining`). Per durable queue: pending, stuck, dead-lettered | New (queue rows exist; no run record found) | M–L | **High** | **`CRON_SECRET` status** (evidence conflicts, see OQ-2). SA decides how runs are recorded. Reuses the §8.1 queue columns |
| R-3 | Business 360 | Search by name/email and see one page: profile, plan and entitlements, modules in use, recent AI actions and failures, spend, bookings/invoices counts, reminders sent, audit history | Partial (users detail, entitlements GET, llm-usage per business) | L | **High** | Slice 2b first. OQ-3 (account = business) |
| R-4 | AI spend by business | Ranked list of businesses by BOS AI cost over a window, with drill-down to area and call | Partial (analytics by user; llm-usage businesses API) | M | **High** | Gap B B0 (RPC + index); `(session_id, user_id)` key rule |
| R-5 | AI activity view | Gap B B1–B3: AI actions joined to their cost lines | Approved, not built | M–L | Med | B0 → B1 → B2 → B3 as specified |
| R-6 | Plans & entitlements page | Add write actions (the 7 existing audited ops), the shadow report and the launch dry run to the existing read-only Business OS Tiers page | Partial (read-only page exists; writes API only) | M | Med now, **High at launch** | Enforcement **off** in prod; **no tiers configured**; gate G-1 (key rotation) before enforce |
| R-7 | Credit adjustment | Grant or deduct a customer's credits with a mandatory reason, audited | New (no admin credit endpoint found) | M | **High at launch** | Money path: needs its own requirement (user's queued credits/expiry questions); `user_subscriptions` is server-write-only |
| R-8 | Insight pipeline health | Last detection run, businesses processed vs remaining, detectors fired, LLM failures per run | New | M | Med | R-2 run records; insight run-group-per-business fix |
| R-9 | Business OS AI writer | Change model/temperature/on-off from the screen instead of the script | Planned (model settings requirement, slice 3) | M | Med | Fail-open kill-switch caveat stays on screen |
| R-10 | LLM usage verification into admin | Move the `/test-business-os` LLM Usage tab behind `/admin` | Partial (API + harness UI) | S | Low | Its route is one of the 7 inline admin checks (slice 4 of admin unification) |
| R-11 | Business data reset/purge in admin | Per-business Danger Zone | Partial (harness only, inert) | M | Low now | Data-purge cycle parked; key rotation |
| R-12 | Real sidebar status indicator | Small live dot fed by Health | New | S | Med | R-1 |
| R-13 | Alerts | Email the two admins when a Health tile turns red | New | M | **High** for the endgame | R-1, R-2; OQ-1 |
| R-14 | Integration health | Stripe, Google calendar sync, channel metrics sync: last success and error rate per business | New | M | Med | R-2 |
| R-15 | Outbound delivery log | Reminders, briefings and lead replies sent or failed per business | New | M | Med | R-2; overlaps R-3 |
| R-16 | Admin actions log preset | Audit trail filtered to actions taken by admins (entitlement ops are already audited with actor and reason) | Partial | S | Low | — |
| R-17 | Retire AP pages | Remove parked pages that are confirmed dead | — | S each | Low | Explicit user decision per page; not before AP's future is decided |

---

## 9. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Security** | Every new page lives under `app/admin/` and inherits `requireAdminPage`. Every new admin route calls `requireAdmin` first (CI-enforced). Never `profiles.role`. Cross-account reads show metadata only, never owner text. |
| **Honesty** | No indicator shows "OK" for something it does not measure. "Not measured" is a distinct, visible state. |
| **Performance** | Health landing is usable within ~3 s at current volumes. No unbounded cross-account scan on page load (see B0 V-3). |
| **Money** | Spend is never summed across currencies. AI cost is USD by definition of the pricing table and labelled as such. |
| **Accessibility** | The collapsible group is keyboard-operable and announces its state. |
| **Stability** | Every slice is revertible alone. No route URL changes in slices 1–3. |

---

## 10. Out of Scope

- Visual redesign (colours, fonts, components) (D-4).
- Deleting any AgentsPilot page, route, API or table (D-3).
- Fixing the existing debt inside reused pages, except where a slice already touches the file (Pino conversion, error-detail leaks, the 7 inline admin checks).
- Deciding whether AP background jobs keep running (OQ-4 raises it; any change is a separate decision).
- Owner-facing BOS screens (`/business-os/*`).

---

## 11. Open Questions

- [x] **OQ-1: Being told vs looking.** Before the first customer, is checking the admin page enough, or do you want an email when something turns red? *Suggested:* page-only until launch, with email alerts (R-13) as a launch prerequisite. (raised by: BA | status: ✅ answered 2026-09-25: agreed, page-only until launch, email alerts before launch)
- [ ] **OQ-2: Are BOS scheduled jobs live in production today?** Records disagree. The payment work says the jobs are dormant until Offir sets the cron secret. The Insights doc (2026-09-23) says payment reminders were seen sending in production. *Suggested:* confirm with Offir. Either way, R-2 exists so this never needs asking again. (raised by: BA | status: ⏳ asked Offir by email 2026-09-25: is `CRON_SECRET` set on Vercel Production, and do the BOS crons return 200?)
- [x] **OQ-3: One login = one business?** Will a person ever own several businesses, or will a business have several staff logins, before launch? This decides what the "Businesses" list and the 360 view are keyed on. *Suggested:* assume one account = one business for now (A-4). (raised by: BA | status: ✅ answered 2026-09-25: yes, one login = one business)
- [ ] **OQ-4: Is anyone still using AgentsPilot?** Three AP jobs still run on schedule, one of them every 5 minutes (scheduled agents). If no real user depends on them, they are cost and noise. *Suggested:* check for active scheduled agents, then decide separately. This doesn't block any slice. (raised by: BA | status: ⏳ user 2026-09-25: AgentsPilot is parked, though some kernel capabilities may be reused. Asked Offir by email 2026-09-25 whether `run-scheduled-agents` (every 5 min), `update-template-scores` (daily) and `memory-consolidation` (weekly) can be removed from the cron schedule, keeping the code)
- [x] **OQ-5: Credit adjustments.** When an admin grants or deducts credits, should the reason ever be visible to the customer, or stay internal? *Suggested:* internal only, mandatory, audited. This will feed the R-7 requirement. (raised by: BA | status: ✅ answered 2026-09-25: agreed, internal only, mandatory, audited)

---

## 12. Notes on Integration Points

| System | Touched by | Note |
|---|---|---|
| `app/admin/components/AdminSidebar.tsx` | Slices 1, 3 | Data and labels only. Pinned by `app/admin/business-os-llm/__tests__/nav.test.ts` |
| `app/admin/layout.tsx` / `requireAdminPage` | All new pages | Unchanged; protection by inheritance |
| `/api/admin/analytics` sources (`token-usage*`) | Slice 2a | BOS row definition: `lib/business-os/llm/callCatalog.ts` `bosRowFilter` |
| `/api/admin/users/**` | Slice 2b | Service-role reads; carries `console.*` and a 500 response that returns `error.message` |
| `/api/admin/business-os/entitlements/**` | Slice 2b, R-6 | Already `requireAdmin`-gated and audited |
| `/api/admin/business-os/llm-usage/**` | R-4, R-10 | One of the 7 inline admin checks |
| `token_usage`, `audit_trail` | Slice 4, R-4, R-5 | No cross-account time index yet (B0) |
| `payment_reminders`, `payment_automation_executions` | R-2 | §8.1 claim/dead-letter columns |
| `vercel.json` crons | R-2 | 12 BOS and 3 AP schedules |
| `/test-business-os` (LLM Usage, Danger Zone) | R-10, R-11 | Admin-like capabilities outside `/admin` |

Related: [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) · [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) · [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) · [BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md) · [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) · [BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md) · [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) · [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) · [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | Created | Code-verified inventory of 22 admin pages and BOS admin APIs; assessment; target IA with a collapsed parked group; AP→BOS benchmark; four shippable slices; 17-item roadmap; five open questions |
| 2026-09-25 | Open questions answered | OQ-1, OQ-3 and OQ-5 answered (suggested defaults accepted). OQ-2 (CRON_SECRET) and OQ-4 (AP crons) sent to Offir. Work parked until he replies |
| 2026-09-25 | Re-baselined on main `b613bb97` | Added the Business OS Tiers page (merged 2026-09-24) to the inventory, the target IA, the slice 1 scope and R-6. Main now has 2 BOS sidebar items out of 22, not 1 of 21 |
