# Requirement: Admin Module Reorganisation for Business OS

> **Last Updated**: 2026-10-02

**Created by:** BA
**Date:** 2026-09-24
**Status:** Slices 1, 2, 4 and 5 are shipped; slice 3 was superseded. Roadmap items after slice 5 are proposals for the user to prioritise.

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
7. [Phased Plan: Shippable Slices](#7-phased-plan-shippable-slices) (includes [Slice 5: Scheduled jobs & queues](#slice-5-scheduled-jobs--queues-roadmap-r-2-plus-health-fixes-and-the-agentspilot-cron-retirement))
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

> **Update 2026-09-27 (slice 5 research):** confirmed from the code. None of the 12 BOS cron routes writes a run record (details in [slice 5 §S5.4](#s54-the-key-finding-no-job-records-its-runs)). There are **five** §8.1 queues, not two: payment reminders, payment automation executions, daily briefing sends, lead responses and insight actions. The 3 AP schedules are being retired (OQ-4, answered).

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
| **Monitor** | **Health** (landing) | `/admin` | ✅ Shipped (slice 4, PR #115) |
| | AI cost & usage | `/admin/analytics` | Exists (renamed; BOS lens added in slice 2) |
| | AI activity | *new route* | Approved, not built (Gap B) |
| | Scheduled jobs & queues | *new route* | New (**slice 5**, this document) |
| | Audit trail | `/admin/audit-trail` | Exists |
| **Businesses** | Businesses | `/admin/users` (renamed, BOS panel in slice 2) → later the 360 view | Partial |
| | Plans & entitlements | `/admin/business-os-tiers` (today's "Business OS Tiers") | Exists, read-only. Writes are API-only (R-6) |
| | Messages | `/admin/messages` | Exists |
| **Settings** | Business OS AI | `/admin/business-os-llm` | Exists |
| | Model pricing & billing | `/admin/system-config` | Exists (renamed) |
| | Free tier & onboarding | `/admin/onboarding` | Exists (renamed) |
| | Admin users | `/admin/settings` | Exists (renamed) |
| **AgentsPilot (parked)** *hidden (PR #108)* | Platform dashboard (legacy), Agent execution queue, System flow, Agent generation, Orchestration, AIS config, Agent memory config, Agent memory dashboard, Reward config, Storage config, Executions config, UI config, HelpBot config | unchanged routes | Exists |

The daily path is 4 visible sections, about 12 items, plus one collapsed group. A new item appears only once its page ships, so no link leads to an empty page.

### 4.3 How parked AgentsPilot pages are tucked away

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. One collapsed sidebar group, "AgentsPilot (parked)", at the bottom** *(recommended)* | Sidebar data only. Collapsed by default, **auto-expanded when the current page is inside it** so the active highlight stays visible | Zero route or code moves. One click to reach any page. Trivially reversible. Makes "parked" visible rather than mysterious | The group still costs one row of sidebar space |
| B. A single "AgentsPilot" hub page with a card per page | One sidebar entry leads to a page of links | Smallest sidebar | Needs a new page. Every visit takes two clicks. The active state is lost on sub-pages |
| C. Remove the links and keep the routes reachable by URL | Sidebar deletion | Cleanest sidebar | Pages become undiscoverable, and "parked" drifts into "forgotten" |

**Recommendation: Option A.** It meets D-3 and D-6 with the smallest change, keeps every route one click away, and can be undone in one line.

> **Superseded 2026-09-25:** at the user's request the parked section is **hidden** (`hidden: true`, PR #108), not collapsed. The routes are unchanged and reachable by URL.

**Exchange Rates stays unlisted.** It was already unlisted, and it writes directly from the browser to the database, bypassing the admin API pattern. Surfacing it would increase exposure. It is recorded here for SA and is not added to any group.

### 4.4 Assumptions (technical forks decided by BA, to be confirmed by SA)

| # | Assumption |
|---|---|
| A-1 | Sidebar grouping and collapse are implemented in the existing `AdminSidebar` component and styles, with no new component library (D-4). |
| A-2 | Until the Health page ships, `/admin` keeps showing today's dashboard. When Health ships, the old dashboard moves to a route inside the parked group, with its code kept intact. The exact route is SA's call. *(Resolved in slice 4: `/admin/platform-dashboard`, URL-only, U-6.)* |
| A-3 | The fake status footer is **removed** in slice 1, not rewired. A real indicator comes back only once Health produces real signals (R-12). |
| A-4 | "Business" = one BOS account (the `accountId` the entitlements module keys on). See OQ-3. |
| A-5 | Renames change labels and descriptions only, never routes. The existing `nav.test.ts` pin on the Business OS AI entry's description stays satisfied. |

Slice 5's own assumptions (A-6 to A-13) are in [§S5.10](#s510-assumptions-technical-forks-decided-by-ba-for-sa-to-confirm).

---

## 5. Benchmark: AgentsPilot Admin to BOS Equivalent

| AgentsPilot capability | Operator need it served | BOS needs an equivalent? | BOS equivalent | State |
|---|---|---|---|---|
| Platform dashboard (totals) | "How is the platform doing?" | **Yes, redesigned** | Health at a glance: signals, not totals | ✅ Shipped (slice 4) |
| Queue Monitor (live execution queue, failures, detail) | "Is work getting done?" | **Yes, the biggest gap** | Scheduled jobs & queues: 12 BOS crons, five §8.1 queues (payment reminders, payment automations, daily briefing sends, lead responses, insight actions), dead-lettered rows | New (slice 5) |
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
- As a platform admin, I want a tile to be green only when it has checked everything it covers and found nothing wrong, so that green means "healthy", not "not looked at".
- As a platform admin, I want the entitlements tile to tell me in plain words what the current mode means for customers, so that I don't have to remember what "Shadow" does.

---

## 7. Phased Plan: Shippable Slices

Each slice ships alone, needs no later slice to make sense, and deletes no code or route. Slices 1 to 3 follow the user's suggested order (a) → (b) → (c). Slice 4 onwards is where the monitoring gaps are closed.

| Slice | State |
|---|---|
| 1. Put BOS up front | ✅ Shipped (PR #107, verified on production 2026-09-25) |
| 2. BOS lens on shared screens | ✅ Shipped (PR #112, decisions U-1 to U-5 in the Change History) |
| 3. Consolidate AgentsPilot (collapse) | ⏭ **Superseded** by hiding the parked section (PR #108, 2026-09-25). Not built as written |
| 4. Health at a glance | ✅ Shipped (PR #115, 2026-09-26). Live checks L-2 to L-6 passed; L-1 (route timing after deploy) still owed |
| 5. Scheduled jobs & queues, Health fixes, AP cron retirement | ✅ Shipped (PR #122 and PR #123, 2026-09-27). Migration applied and verified; the next-day proof that all 12 jobs record (L-5.8) is still owed |
| Next: admin cleanup for Business OS | ⬜ Specified in [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md) (2026-10-02): R-6, R-18, R-20 and the first R-3 sub-slices, plus the Settings clean-up. Slice order awaits the user |

### Slice 1: Put BOS up front (navigation only)

**State:** ✅ Shipped (PR #107).

| Field | Detail |
|---|---|
| **Scope** | Sidebar data and labels only. (1) Reorder into **Monitor / Businesses / Settings / AgentsPilot (parked)** using **only pages that exist today**: Monitor = Dashboard, AI cost & usage, Audit trail; Businesses = Users, Plans & entitlements (the existing Business OS Tiers page), Messages; Settings = Business OS AI, Model pricing & billing, Free tier & onboarding, Admin users; the other 12 AP items go into the parked group, **still expanded** in this slice. (2) Honest renames (e.g. "Queue Monitor" becomes "Agent execution queue"; descriptions say "AgentsPilot" where true). (3) **Remove the hardcoded status footer.** |
| **What the user sees** | The same look. BOS and shared pages are at the top, and every AP page sits under one clearly labelled heading at the bottom. The fake green "OK" block is gone. |
| **Effort** | S |
| **Risk** | Low. No route, API, data or page-content change. Tests that pin the sidebar (`business-os-llm/__tests__/nav.test.ts`) must still pass. |
| **Acceptance criteria** | ☐ All 22 existing routes are reachable from the sidebar in at most one click ☐ No file under `app/admin/*/page.tsx` or `app/api/admin/**` is changed or deleted ☐ Section order is Monitor, Businesses, Settings, AgentsPilot (parked) ☐ Business OS AI appears in the first screen of the sidebar without scrolling at 1080p ☐ The status footer is gone and no other element claims system status ☐ The active-page highlight works for every item ☐ The existing nav tests pass ☐ Exchange Rates remains unlisted |

### Slice 2: Give the shared screens a BOS lens (reuse)

**State:** ✅ Shipped (PR #112).

| Field | Detail |
|---|---|
| **Scope** | (2a) **AI cost & usage:** a "Business OS only" preset that uses the platform's existing definition of a BOS row (the `business-os` prefix **plus** the five legacy feature values, per B0 workplan V-6). **Not** a hand-written `business-os-%` filter. (2b) **Users → "Businesses":** add a BOS panel to the expanded detail (business name/vertical, entitlement snapshot from the existing API, BOS AI spend 30 d, recent BOS AI failures linked to the Audit trail). Agent facts remain, collapsed. (2c) **Audit trail:** a one-click "BOS AI failures" view, **and a Business OS-only Action Type filter**. The Action Type dropdown lists only the event types relevant to operating Business OS: BOS events plus the shared ones (sign-in, admin, billing and subscription). The long list of AgentsPilot-only event types (agents, executions, memory, templates and so on) is hidden from the dropdown. It is **not** removed from the audit catalogue, and it is not filtered out of the results: "All Actions" still returns every row. *Constraint for Dev and SA:* the dropdown is catalogue-driven (FR-A3), and a test asserts that the label map can never silently drop an event. Hiding must therefore be an **explicit, tested classification** (each event or event group marked BOS / shared / AgentsPilot, with a test failing on any unclassified event), never an ad-hoc exclusion list. A newly registered event must not disappear without a decision. The Entity Type dropdown may follow the same rule if it is equally AgentsPilot-heavy (Dev to report). |
| **What the user sees** | Cost Analytics opens on BOS spend with one click. Opening a user shows their business and plan first. |
| **Effort** | M (2a S, 2b M, 2c S; can ship as three PRs) |
| **Risk** | Low–Med. 2b reads another account's data on an admin path: it must follow the cross-account read conventions (admin-gated, metadata only, no owner text) and SA reviews it. The routes touched still carry `console.*` and error-detail debt, and fixing that is part of touching them (CLAUDE.md rule 3). |
| **Acceptance criteria** | ☐ BOS preset totals match the BOS spend for the same window from the existing LLM usage report ☐ Legacy-tagged BOS rows are included ☐ The detail panel shows plan/cohort and "which layer decided" exactly as the entitlements API returns them ☐ No prompt, message body or owner text is displayed ☐ Non-admin access is refused (inherited guard) ☐ The Action Type dropdown shows no AgentsPilot-only event types, "All Actions" still returns every row, and every catalogue event is classified (test fails on an unclassified one) ☐ Happy path plus one failure path tested |

### Slice 3: Consolidate AgentsPilot (hide)

**State:** ⏭ **Superseded, not built as written.** On 2026-09-25 the user asked for the parked AgentsPilot section to be **hidden** rather than collapsed. PR #108 set `hidden: true` on the whole section. Every parked route still loads by URL; none has a visible link. The collapsed-group design below is kept for the record only.

| Field | Detail |
|---|---|
| **Scope** | The "AgentsPilot (parked)" group becomes **collapsed by default** and auto-expands when the current page is inside it. Group label: "AgentsPilot (parked)", with a one-line note that pages are kept for revival. |
| **What the user sees** | The daily sidebar is about 10 items plus one collapsed row. |
| **Effort** | S |
| **Risk** | Low |
| **Acceptance criteria** | ☐ Group is collapsed on first load ☐ Visiting any parked route shows the group expanded with the item highlighted ☐ Every parked route still loads and works unchanged ☐ Keyboard-operable expand/collapse with an accessible label |

### Slice 4: Health at a glance (new landing)

**State:** ✅ **Shipped** (PR #115, merged 2026-09-26). Workplan: [ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md](/docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md). Pre-merge live checks L-2 to L-6 all passed (§15.8 of the workplan); L-1 (route timing after deploy) is still owed.

| Field | Detail |
|---|---|
| **Scope** | A new `/admin` landing built **only from signals that already exist**. (1) BOS AI areas: any switched off, any setting with issues. (2) BOS AI failures in the last 24 h / 7 d (audit trail). (3) BOS AI spend in the last 24 h / 7 d against the previous period. (4) Critical-severity audit events. (5) Entitlements mode (off / shadow / enforce). Tiles for cron/queue health are shown as **"Not measured yet"** until R-2 ships, never as green. The old dashboard moves into the parked group (A-2). |
| **What the user sees** | One screen of red, amber or neutral tiles. Each links to its full page. |
| **Effort** | M |
| **Risk** | Med. Aggregating over `token_usage` across accounts has no suitable index today (B0 workplan V-3). A 24 h/7 d window must be measured, or wait for B0's index. SA decides. *(Closed by live check L-5: production has `idx_token_usage_created_at`, created outside the repo; the read is an index range scan of 1.6 ms.)* |
| **Acceptance criteria** | ☐ Every tile links to a page that shows the same number ☐ No tile shows green for something that is not measured ☐ Page loads within the NFR budget (§9) at current volumes ☐ ~~The old dashboard is still reachable in one click from the parked group~~ **Replaced (U-6):** the old dashboard still loads at `/admin/platform-dashboard` with its code intact, and has one entry in the hidden parked section; nothing links to it |

**As shipped (amendments recorded from the slice 4 workplan, T14):**

| # | Amendment | Source |
|---|---|---|
| S4-a | Each tile is coloured by an **ordered list of rules held as data** (`lib/admin/health/rules.ts`). The first matching rule sets the colour and its description is the headline; no match gave grey "Normal". *Slice 5 changes the no-match result to green under strict conditions (see RC-5.1).* | U-1 |
| S4-b | The old dashboard is at `/admin/platform-dashboard`, URL-only, with a hidden parked sidebar entry. | U-6 |
| S4-c | Documented link exceptions: the scheduled-jobs and queues tiles (no page yet), and the entitlements tile's "enforce requested but refused" reason (the linked page shows only the mode in effect). *Slice 5 removes the first exception.* | SA C-8 |
| S4-d | Critical audit events are amber, never red. | U-5 |

### Slice 5: Scheduled jobs & queues (roadmap R-2), plus Health fixes and the AgentsPilot cron retirement

**State:** ⬜ Draft, 2026-09-27. Business requirement only; the design is Dev's workplan and SA's review. RC-5.1 below **reverses an SA condition from slice 4 (C-10)** and needs SA to re-rule it. Nothing in this slice is committed until the user has reviewed the code (standing rule).

#### S5.1 Why this slice

- The two Health tiles for jobs and queues say "Not measured yet". Of all the failures an admin can miss, a **silent stop** matters most before launch. A reminder that is never sent is invisible to both the business and the admins.
- OQ-2 was answered on 2026-09-25: `CRON_SECRET` is set and the jobs run "as far as I know". **Nothing in admin can confirm that today.** This slice turns "as far as I know" into something visible on a page.
- Two of the cron routes say the problem in their own comments: *"a queue that silently stops draining looks identical to a queue with nothing in it"* (`app/api/cron/insight-actions/route.ts:63-64`, `app/api/cron/lead-response/route.ts:59-60`).

#### S5.2 Scope at a glance

| Part | What | Needs a database change? |
|---|---|---|
| **A** | Retire the 3 AgentsPilot cron schedules (OQ-4) | No |
| **B** | A minimal **run record** for the 12 BOS jobs (the prerequisite for measuring jobs) | **Yes**: one hand-applied production change, run by the user |
| **C** | New page **"Scheduled jobs & queues"** under Monitor | No (reads B's record and the existing queue tables) |
| **D** | Health tiles 6 (Scheduled jobs) and 7 (Queues) become measured, with ordered rules | No |
| **E** | Health fixes: green for healthy (RC-5.1), a clearer entitlements tile (RC-5.2), correcting the docs on the entitlements mode (RC-5.3) | No |

**Suggested delivery (Dev and SA may change it):** one PR for A + E, which needs no database change and can merge first. Then one PR for B + C + D, which waits for the user to apply the database change.

#### S5.3 Part A: retire the AgentsPilot crons (OQ-4, answered by Offir)

| # | Requirement |
|---|---|
| FR-A1 | Remove **exactly three** entries from `vercel.json`: `/api/run-scheduled-agents` (`*/5 * * * *`), `/api/cron/update-template-scores` (`0 3 * * *`) and `/api/cron/memory-consolidation` (`0 4 * * 0`). The 12 BOS entries are unchanged. |
| FR-A2 | **No code is deleted or edited.** The three route files stay as they are, so re-enabling one is a one-line change to `vercel.json`. |
| FR-A3 | The retirement and how to reverse it are recorded where a future reader will find them: this document, the Dev workplan, and the Change History of any AgentsPilot doc that describes these jobs (Dev to identify). |
| FR-A4 | Before merge, the user records one number (read-only SQL, see L-5.6): how many AgentsPilot agents are currently scheduled, active and enabled. **These agents stop running on schedule when this merges.** It is recorded so that nobody discovers it later by surprise. |

`app/api/run-scheduled-agents/route.ts` still logs with `console.*`. It is **not** touched by this slice, so the Pino conversion rule (CLAUDE.md rule 3) does not apply to it.

#### S5.4 The key finding: no job records its runs

I read all 12 BOS cron routes on 2026-09-27 (`app/api/cron/*/route.ts`). **None of them writes a record of its own run anywhere a page could read.** Each one logs a Pino "completed" or "failed" line, which goes to Vercel's runtime logs. That log is not readable from admin and is kept only as long as the Vercel plan allows. There is no table in `supabase/migrations` for run history (searched for `cron`, `job_run`, `run_log` and `heartbeat`: no match).

What each job leaves behind today, and why that is not enough:

| Job (`vercel.json` path) | Run record? | Indirect trace today | Is a trace left on a run with nothing to do? |
|---|---|---|---|
| calendar-sync | No | Per-business sync state (the route picks businesses "stale after 5 minutes") | No |
| insight-metrics | No | Metric rows for businesses with recent activity | No |
| insight-detect | No | Insight rows tagged with the run's id; one AI audit entry per business that had AI work (`runAiAction`, trigger `scheduled`) | No |
| insight-automations | No | Rows it queues into `insight_actions` | No |
| insight-actions | No | Claim times on `insight_actions` rows | No |
| channel-metrics-sync | No | Per-connection sync state | No |
| payment-reminders | No | Claim times on `payment_reminders` rows; the overdue-invoice sweep | No |
| intake-reminders | No | A stamp on each booking it reminded | No |
| payment-retry | No | Claim times on `payment_automation_executions` rows | No |
| daily-briefing | No | Rows in `daily_briefing_sends` for opted-in businesses | No |
| lead-response | No | Claim times on `lead_responses` rows | No |
| abandoned-proposal-invoices | No | `sent_at` on the invoices it emailed | No |

**Conclusion.** A trace appears only when a job had work to do. A job with nothing to do and a job that has stopped look identical. So the requirement needs a **minimal run record**. That is a database change, applied by hand in production by the user.

Two further facts from the same read, recorded for SA (not in this slice's scope):
- **Two jobs run without authentication if `CRON_SECRET` is ever missing in production.** `calendar-sync` and `channel-metrics-sync` check the secret only `if (CRON_SECRET && …)`. The other ten refuse ("fail closed"). With the secret set (OQ-2), this is dormant. It is logged as roadmap item R-19.
- The current proof that `CRON_SECRET` works is indirect: code comments say payment reminders were seen sending in production (`insight-metrics/route.ts:44-46`, `insight-actions/route.ts:32-34`).

#### S5.5 How job runs could be recorded: options

| Option | What it means for you | For | Against |
|---|---|---|---|
| **A. Each job writes a one-line run record to the database** *(recommended)* | Each time a job runs, it notes when it started and finished, whether it worked, and a few counts. You apply one small database change by hand in production. | Works for every job, including runs that had nothing to do. It is the only option that can prove a job is running. It stays inside our own system and admin pattern. Cheap to read. | One hand-applied production change. Twelve job files each gain a small, shared step. The history needs a size limit (FR-R6). |
| B. Read Vercel's own cron history | The page asks Vercel which cron calls happened. No database change. | No schema work. | Needs a Vercel access token with project rights; you do not have Vercel admin and Offir does. It shows only "called, and what HTTP answer came back", not what the job did. History is limited by the plan. It adds an outside dependency to an admin page. |
| C. Work it out from side effects | The page guesses from queue rows, audit entries and stamps. No change at all. | Nothing to build or apply. | It cannot tell a quiet day from a stopped job (§S5.4), so it fails the core acceptance criterion. Most jobs would show "unknown" most of the time. |
| D. An outside heartbeat-monitoring service | Each job pings a third-party service, which emails when a ping is missing. | Alerts by email without building alerts (R-13). | A new vendor and a new cost. Nothing appears in admin. It still says nothing about queues. |

**Recommendation: Option A** (OQ-6 asks for your approval). The queues need **no** new record. Their rows already are the record, as §8.1 of the event-driven plan says ("Tracking = the table").

#### S5.6 Part B: the run record (business requirements; Dev and SA design it)

| # | Requirement |
|---|---|
| FR-R1 | Every scheduled BOS job records **every** run, including runs that found nothing to do. It records which job, when the run started and finished, the outcome (succeeded, failed, or partly done), how long it took, and the job's own counts. Counts are **numbers only** (for example: businesses processed, items sent, items failed, items left for the next run). |
| FR-R2 | A run that started but never recorded a finish (for example, killed by the platform time limit) shows as **"did not finish"** once its time limit plus a margin has passed. It counts as a failure. |
| FR-R3 | A run is recorded **only after** the job has confirmed the caller is Vercel. So a stranger calling the URL cannot write records. And a Vercel call that the job refuses (for example, a wrong or missing secret) leaves **no** record, so the job shows as late, then stopped. **This is how OQ-2 becomes verifiable.** |
| FR-R4 | Recording **never blocks or fails a job.** If the record cannot be written, the job still does its work. The page then shows that job as "Could not check", never as healthy. |
| FR-R5 | **No owner or client data**: no business names, no client names or addresses, no message text, no error messages. The outcome is a fixed word. A failure may carry an error **class** (for example, a timeout), never an error message. |
| FR-R6 | **Bounded history.** Keep 30 days (proposed, OQ-6); older records are removed automatically. For scale: at today's schedules the 12 jobs run about **1,080 times a day** (three every-5-minute jobs at 288 each, one every-15-minute job at 96, six hourly at 24 each, three daily). That is about 32,000 records per 30 days. |
| FR-R7 | Server-only: business owners can never read or write it. |
| FR-R8 | **One** database change, **applied by hand in production by the user**, safe to run twice, with a written way to undo it. The code must be safe to deploy **before** the change is applied: jobs keep running normally and the page says "Could not check". |
| FR-R9 | The list of jobs and their schedules on the page must come from, or be tested against, `vercel.json`. A job added to `vercel.json` without appearing on the page makes a test fail. |

#### S5.7 Part C: the "Scheduled jobs & queues" page

**Place:** Monitor section of the sidebar, in the order of §4.2: Health, AI cost & usage, **Scheduled jobs & queues**, Audit trail. It is visible, not hidden. Dev and SA choose the route. It sits under `app/admin/`, so the admin layout guard protects it, and any new `/api/admin/*` route calls `requireAdmin` first.

**Read-only in this slice.** There are no retry, requeue, cancel or "drain now" buttons (roadmap R-18). There is a Refresh button and an "As of HH:mm UTC" line. It does not refresh itself, as on Health.

##### Jobs section

One row per BOS job. The 12 jobs and their schedules, as in `vercel.json` today (all times UTC):

| Job | What it does (plain words) | Schedule | Interval | **Late** (amber) if no run started for more than | **Stopped** (red) if no run started for more than | Drains queue |
|---|---|---|---|---|---|---|
| calendar-sync | Pulls external calendar events for businesses with sync on | every 5 min | 5 min | 15 min | 20 min | — |
| lead-response | Sends queued replies to new enquiries | every 5 min | 5 min | 15 min | 20 min | `lead_responses` |
| insight-automations | Checks standing insight automations and queues their actions | every 5 min | 5 min | 15 min | 20 min | — (feeds `insight_actions`) |
| insight-actions | Sends actions that insight automations queued | every 15 min | 15 min | 25 min | 40 min | `insight_actions` |
| payment-retry | Retries failed payments; runs scheduled payment automations | hourly at :00 | 60 min | 70 min | 130 min | `payment_automation_executions` |
| daily-briefing | Queues and sends morning briefing emails, per business timezone | hourly at :10 | 60 min | 70 min | 130 min | `daily_briefing_sends` |
| intake-reminders | Reminds clients to fill in intake forms before tomorrow's meeting | hourly at :15 | 60 min | 70 min | 130 min | — (stamps bookings; not a queue) |
| abandoned-proposal-invoices | Emails the invoice to clients who accepted a quote and left | hourly at :20 | 60 min | 70 min | 130 min | — |
| channel-metrics-sync | Pulls Facebook, Instagram, Google Business and GA4 stats | hourly at :30 | 60 min | 70 min | 130 min | — |
| insight-metrics | Rebuilds the metrics the insight detectors read | daily 03:00 | 24 h | 25 h | 49 h | — |
| insight-detect | Runs the insight detectors for every active business | daily 03:30 | 24 h | 25 h | 49 h | — |
| payment-reminders | Finds overdue invoices, queues and sends payment reminders | daily 08:00 | 24 h | 25 h | 49 h | `payment_reminders` |

**What "late" and "stopped" mean.** Measured from the start of the most recent recorded run, whatever its outcome:
- **Late** = more than **one interval plus a grace period** has passed. One expected run is missing.
- **Stopped** = more than **two intervals plus the grace period** has passed. Two consecutive expected runs are missing.
- **Grace period** = 10 minutes for jobs that run hourly or more often, 60 minutes for daily jobs. Vercel runs crons on a best-effort basis and they can start late, which the event-driven plan §8.2 also notes. The grace period absorbs that, so a slightly late start is not an alarm.
- A job with **no recorded run at all** is treated the same way, measured from when recording began. Before one "late" period has passed since recording began, it shows **"No run recorded yet"** (grey, not measured).

Each job row shows:

| Column | Content |
|---|---|
| Job | Plain name, one-line description, schedule in words (UTC) |
| Status | One of: **Healthy**, **Late**, **Stopped**, **Last run failed**, **Keeps failing**, **Partly done**, **No run recorded yet**, **Could not check** |
| Last run | Start time, finish time (or "did not finish"), duration, outcome word |
| Expected by | When the next run should have started, and the late and stopped thresholds |
| Last 24 h / 7 days | Number of runs, number of failed or unfinished runs |
| Work done (last run) | The job's own counts, numbers only (for example "12 businesses synced, 1 failed"; "3 businesses left for the next run") |
| Recent failures | Up to 10 per job: time, outcome word and error class. **Never an error message** |

**Per-job status rules** (first match wins):
1. **Stopped** (red): past the stopped threshold.
2. **Keeps failing** (red): the last 3 runs all failed or did not finish. For daily jobs, the last 2.
3. **Late** (amber): past the late threshold.
4. **Last run failed** (amber): the most recent finished run failed or did not finish.
5. **Partly done** (amber): the most recent run succeeded but reported failed items, or work left for the next run. Examples: calendar-sync `failed > 0`; insight-detect `usersRemaining > 0`; channel-metrics-sync `hitLimit`.
6. Otherwise **Healthy** (green), under RC-5.1.

##### Queues section

The five durable queues that follow §8.1 of the event-driven plan (verified in `supabase/migrations`). They all share the claim, lease, reaper and dead-letter shape, but their status words differ:

| Queue (table) | Migration | Drained by | Waiting | In progress | Done | Failed | Dead-lettered | Other end states | "Due" is decided by |
|---|---|---|---|---|---|---|---|---|---|
| Payment reminders (`payment_reminders`) | `2026-08-14_payment_reminders_claim.sql` | payment-reminders, daily 08:00 | `pending` | `processing` | `sent` | `failed` | `failed` **with** the fixed marker `dead-letter: max attempts` | `cancelled` | `scheduled_at` and `next_attempt_at` |
| Payment automations (`payment_automation_executions`) | `2026-08-14_payment_automation_executions_claim.sql` | payment-retry, hourly | `pending` | `running` | `completed` | `failed` (*also used for guardrail skips*, per the migration) | `dead_letter` | `cancelled` | `scheduled_at` and `next_attempt_at` |
| Daily briefing sends (`daily_briefing_sends`) | `20260911_daily_briefing.sql` | daily-briefing, hourly | `pending` | `processing` | `sent` | `failed` | `failed` with the marker | `skipped` (expected: a quiet day) | `next_attempt_at` |
| Lead responses (`lead_responses`) | `20260914_lead_responses.sql`, kinds extended in `20260923_meeting_reminder.sql` | lead-response, every 5 min | `pending` | `processing` | `sent` | `failed` | `failed` with the marker | `skipped` | `next_attempt_at` (it also holds the 15-minute "not before" delay) |
| Insight actions (`insight_actions`) | `20260917_insight_actions.sql` | insight-actions, every 15 min | `pending` | `processing` | `sent` | `failed` | `failed` with the marker | `skipped` | `next_attempt_at` |

For each queue the page shows the following, across all businesses (counts only; per-business breakdown is R-3/R-15):

| Figure | Definition |
|---|---|
| **Due now** | Waiting, and its due time has passed. This is the real backlog. |
| **Scheduled for later** | Waiting, but not yet due: a reminder set for a future date, a lead reply inside its 15-minute window, or a retry backing off. **Not a backlog**, and it never colours a tile. |
| **In progress** | Claimed by a running job. |
| **Stuck** | In progress, claimed longer ago than the lease (90 seconds in all five migrations) plus a margin of 10 minutes (proposed). The reaper should have recovered it, so a stuck item means the job that drains it is not running. |
| **Failed** (24 h / 7 days) | Ended in failure, excluding dead-letters. For payment automations the migration says `failed` also covers guardrail skips; Dev must separate those if the data allows, or label the figure as including them. |
| **Dead-lettered** (24 h / 7 days) | Gave up after the maximum number of attempts. For four queues this is `failed` plus the fixed marker; for payment automations it is `dead_letter`. |
| **Skipped** (7 days) | Information only: an expected outcome. |
| **Oldest due item** | Age of the oldest "due now" item. |

**Never displayed:** `payload`, `recommendation`, `error_message`, `skip_reason`, or any contact, invoice or booking detail. `error_message` may be **compared** with the fixed dead-letter marker, but never shown. This slice lists no individual items, only counts.

**Known context:** the payment automations migration says that table has "no live producer today", so zeros there are expected. The page says so in one line rather than implying health.

#### S5.8 Part D: the two Health tiles (ordered rules, the slice 4 style)

The tiles lose "Not measured yet" and link to the new page. Their numbers are the same numbers the page shows (A-9). These are **starting rules**; like slice 4's, they are data and can be changed later (OQ-7).

**Tile 6: Scheduled jobs.** Figures: jobs healthy / late / stopped / failing (counts out of 12), and the name of the worst job.

| Order | Colour | Headline | Condition |
|---|---|---|---|
| 1 | red | "A job has stopped" | Any job past its stopped threshold |
| 2 | red | "A job keeps failing" | Any job whose last 3 runs (daily jobs: 2) failed or did not finish |
| 3 | amber | "A job is late" | Any job past its late threshold |
| 4 | amber | "A job's last run failed" | Any job whose most recent run failed or did not finish |
| 5 | amber | "A job finished with work left or partly failed" | Any job whose most recent run was partly done |
| — | **green** | "All clear" | No rule matched **and** every one of the 12 jobs has a recorded run **and** the run-record read succeeded |
| — | grey | "Not measured yet" / "Could not check" | Some job has no run yet inside its first late period, or the read failed |

**Tile 7: Queues.** Figures: due now, stuck, dead-lettered (24 h) and failed (24 h), summed across the five queues. Plus the oldest due item and which queue it is in.

For each queue, "behind" and "stopped draining" use the drain interval of the job that drains it: payment reminders 24 h, payment automations 1 h, daily briefing sends 1 h, lead responses 5 min, insight actions 15 min. The grace periods are the same as for jobs.

| Order | Colour | Headline | Condition |
|---|---|---|---|
| 1 | red | "Items stuck in progress" | Any stuck item in any queue |
| 2 | red | "A queue has stopped draining" | Any queue's oldest due item has waited more than 2 drain intervals plus grace |
| 3 | red | "A message was dead-lettered in the last 24 hours" | Any dead-lettered item in the last 24 h *(proposed; OQ-7 asks whether this should be amber until launch)* |
| 4 | amber | "A queue is behind" | Any queue's oldest due item has waited more than 1 drain interval plus grace |
| 5 | amber | "Dead-lettered items this week" | Any dead-lettered item in the last 7 days |
| 6 | amber | "Failures in the last 24 hours" | Any failed item in the last 24 h |
| — | **green** | "All clear" | No rule matched and all five queue reads succeeded with exact counts |
| — | grey | "Could not check" | Any queue read failed |

**When a stop shows up.** The page computes on load; nothing runs in the background until alerts exist (R-13, OQ-1). So "shows within" means "on the first page load after":

| Job type | Amber by | Red by |
|---|---|---|
| Every 5 minutes | 15 min after the last run started | 20 min |
| Every 15 minutes | 25 min | 40 min |
| Hourly | 70 min | 130 min |
| Daily | 25 h | 49 h |

#### S5.9 Part E: Health fixes (user feedback, 2026-09-26/27)

##### RC-5.1 Green for healthy (a requirement change; it reverses slice 4's C-10)

**What the user said.** The Business OS AI settings tile, with "areas configured off = 0", should be **green** when everything is correct, not grey "Normal".

**New rule, for every Health tile.** A tile is **green** only when all three hold:
1. it is **measured**, meaning its read succeeded;
2. **every figure on it is exact** (complete, not "at least");
3. **no rule matched**.

**Grey stays** for "Not measured yet", "Could not check" and "No run recorded yet". A **lower-bound figure can never be green**. Where slice 4's C-18 already makes a lower bound amber (the spend tile), it **stays amber**. This document does not weaken C-18; SA confirms.

**Rationale.**
- At a glance, grey "Normal" looks the same as grey "Not measured" and grey "Could not check". The page cannot say "all is well" in the one colour people read that way.
- C-10 existed to stop green appearing for something **not** checked. That was the lesson of the fake sidebar footer. The three conditions keep that protection: a failed read, a partial read and a missing measurement can never be green.

**What changes (for Dev and SA):**
- The tile status gains a green state, and the "no green" source guard and fuzz test are re-ruled, not deleted. They now prove "green only under the three conditions".
- The page's intro sentence ("Nothing here is ever green") is rewritten.
- The rule "no description may say OK" stays.
- Whether the old grey "Normal" state disappears or stays for purely informational tiles is SA's call.
- The green state carries a text label (proposed: **"Healthy"**, headline **"All clear"**), because colour alone is not enough (the slice 4 accessibility rule, C-16).
- The §9 Honesty NFR is updated to match.

##### RC-5.2 The entitlements tile says what it means

**What the user saw.** The tile shows "Shadow". Clicking it opens Plans & entitlements (by design, but nothing says so). And there was a "0" the user could not explain.

| # | Requirement |
|---|---|
| FR-E1 | The mode is explained in plain words on the tile. **Off:** "Plans are not checked." **Shadow:** "Plans are checked and logged; nothing is blocked." **Enforce:** "Plan limits are applied to customers." The refused-enforce case keeps its existing note. |
| FR-E2 | The link says where it goes, for example "Open Plans & entitlements (plans and account lookup)". |
| FR-E3 | **Every number on the tile is labelled.** Dev must **identify what the "0" is**. Code evidence (2026-09-27): the Health evaluator gives this tile **one** figure, "Mode", whose value is a word (`lib/admin/health/evaluateHealth.ts`, `entitlementsMeasurement`). The tile component renders no other number (`app/admin/components/health/HealthTile.tsx`). So the "0" is most likely on the **page the link opens** (Plans & entitlements), for example a count of configured plans or accounts, or it belongs to a neighbouring tile. Dev reproduces it, names it in the workplan, and labels it wherever it is. If it is on the linked page, the tile's link text says what that page shows. |
| FR-E4 | With RC-5.1, the tile is green when the mode in effect is the mode that was asked for and no rule matched. OQ-9 asks whether Shadow should count as "healthy". |

##### RC-5.3 Correct the docs on the entitlements mode

- **Fact:** production resolves `BOS_ENTITLEMENTS_MODE` to **shadow**, as the Health tile showed. `CLAUDE.md` (Key Documentation, entitlements row) says it is "unset in production", which would mean **off**.
- **Requirement:** Dev corrects `CLAUDE.md`. Dev also searches for the same claim elsewhere and corrects it too, starting with [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) and [BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md). Each touched doc gets a Change History entry.
- **Caveat to state in the docs:** "shadow" is also what a **refused** `enforce` becomes (`lib/business-os/entitlements/mode.ts`). If the tile showed Shadow **without** the amber "Enforcement requested but not active" headline, the setting is `shadow` itself.
- **Question for Offir (OQ-8), not a blocker:** was setting shadow in production deliberate?

#### S5.10 Assumptions (technical forks decided by BA, for SA to confirm)

| # | Assumption |
|---|---|
| A-6 | The queues are read straight from the five queue tables as counts. No new record and no change to the queues. The reads are admin-only, across all businesses, and made from `app/api/admin/**` through the admin repository pattern that slice 4 used. |
| A-7 | The run record is written through **one shared step** that all 12 jobs use, not twelve hand-written copies. That fixes it at the root (CLAUDE.md). How the step is shaped is SA's decision. |
| A-8 | The page and the two Health tiles share **one computation**, so a tile's figure cannot disagree with the page. This is the same principle as slice 4's F-5. |
| A-9 | "Late" and "stopped" are computed from each job's `vercel.json` schedule (FR-R9). The thresholds are data, in the same style as slice 4's `rules.ts`. |
| A-10 | Cron routes that exist but are not scheduled (`app/api/cron/process-queue`, `app/api/cron/check-free-tier-expiration`) and the 3 retired AgentsPilot routes are not shown. |
| A-11 | No auto-refresh. The page loads on open and on Refresh, as Health does. |
| A-12 | The 12 BOS cron routes already log with Pino (verified). Adding the run-record step does not create `console.*` debt. |
| A-13 | The run record stores no business id, because no figure in this slice needs one. If a later item (R-8, R-15) needs per-business run detail, that is its own decision. |

#### S5.11 Live checks owed by the user (read-only SQL; Dev runs none of them)

The live database can differ from the repo: slice 4 found indexes that exist only in production. So these are **checks, not assumptions**. Dev writes the exact SQL into the workplan.

| # | When | Check | Why |
|---|---|---|---|
| L-5.1 | Before merge | The five queue tables exist in production with the columns the migrations add (`status`, `claimed_at`, `attempts`, `next_attempt_at`, `created_at`, plus `scheduled_at` on the two payment tables) | The page reads them. None of the five tables' own creation was verified live |
| L-5.2 | Before merge | The status values actually present in each queue table, with counts | `payment_reminders` and `payment_automation_executions` have **no** constraint on `status`. Legacy values may exist |
| L-5.3 | Before merge | The indexes on the five queue tables | Only the "waiting" partial indexes are in the repo. Counts by other statuses may scan the table (small tables today) |
| L-5.4 | Before merge | Row counts per queue table | Sizes the page's reads |
| L-5.5 | Before merge | The payment reminders dead-letter marker is exactly `dead-letter: max attempts` in live rows, if any | The page relies on that fixed text |
| L-5.6 | Before merge (part A) | The number of AgentsPilot agents that are scheduled, active and enabled | FR-A4: what stops running |
| L-5.7 | After the database change is applied | The run-record table exists as specified and is not readable by an ordinary signed-in user | FR-R7, FR-R8 |
| L-5.8 | After deploy, within 2 hours, and again the next day at 09:00 UTC | Every one of the 12 jobs shows a recorded run, and no job is "late" | **The OQ-2 verification.** The daily jobs need the next morning |
| L-5.9 | After deploy | Vercel's cron list shows 12 jobs, none of them AgentsPilot | Part A |

#### S5.12 Non-functional requirements specific to slice 5

| Area | Requirement |
|---|---|
| Security | The page is protected by the admin layout. Any new admin route calls `requireAdmin` first (the CI guard applies). Queue and run reads are cross-account, metadata only, and never show owner text (§S5.7). The run-record write happens only after the cron's own authorisation (FR-R3). |
| Honesty | Nothing is green unless it is measured and exact (RC-5.1). A read that fails shows "Could not check". A job that has not had time to run yet shows "No run recorded yet". |
| Performance | The page is usable within ~3 s at current volumes (the same budget as §9). Each read has a deadline. A slow read makes only its own part "Could not check", never the whole page (the slice 4 pattern). |
| Reliability | Adding the run record must not change what any job does, or when. It must not make any job fail (FR-R4). |
| Money | No money figure is shown on this page. |
| Stability | Part A can be reversed with one line per job. The run record can be removed with its written rollback, and the jobs still work. |

#### S5.13 Acceptance criteria

**Part A (AP cron retirement)**
- ☐ `vercel.json` has exactly 12 crons, all BOS. The three AgentsPilot entries are gone and the other 12 are byte-identical.
- ☐ The three AgentsPilot route files are unchanged.
- ☐ L-5.6 is recorded before merge, and L-5.9 after deploy.

**Part B (run record)**
- ☐ Every one of the 12 jobs writes a record on every authorised run, including runs with nothing to do (tested per job).
- ☐ An unauthorised call writes nothing (tested).
- ☐ A failed record write leaves the job's work and response unchanged (tested).
- ☐ A run with no finish is shown as "did not finish" once its time limit plus margin has passed.
- ☐ Records hold no owner text and no error messages (tested on the written row).
- ☐ History older than the retention period is removed.
- ☐ The database change is safe to run twice and has a written undo, and the code is safe before it is applied.
- ☐ A job added to `vercel.json` without appearing on the page fails a test.

**Part C (page)**
- ☐ The page is under Monitor, in the §4.2 order, and a non-admin is refused (page and API).
- ☐ All 12 jobs and all 5 queues are listed with the figures in §S5.7.
- ☐ "Due now" and "Scheduled for later" are separate, and future-dated items never colour anything.
- ☐ No payload, recommendation, error message, skip reason or client detail appears anywhere on the page or in its API response (tested on the serialised response).
- ☐ No retry, requeue, cancel or drain button exists.

**Part D (Health tiles)**
- ☐ **Every number on the two tiles matches the page** at the same moment (same computation, A-8). Each tile links to the page.
- ☐ **A job that silently stops shows amber, then red, on the first page load after the times in the §S5.8 table.** It is tested with a simulated clock for one job of each schedule type.
- ☐ A queue item stuck in progress, or a due item waiting past its threshold, turns the Queues tile red (tested).
- ☐ **Nothing is green unless it is measured and exact.** A failed read gives "Could not check", and a job with no run yet gives "No run recorded yet". Neither is ever green (tested, including a fuzz over rules and inputs).

**Part E (Health fixes)**
- ☐ A measured, exact, no-match tile is green with a text label, including the Business OS AI settings tile with zero areas off.
- ☐ A lower-bound spend figure is never green.
- ☐ The entitlements tile explains the mode in plain words, its link says where it goes, and every number on it is labelled. The "0" is identified in the workplan.
- ☐ `CLAUDE.md` and every other doc found saying the mode is unset are corrected, each with a Change History entry.
- ☐ SA has re-ruled C-10 in writing before Part E is implemented.

**All parts**
- ☐ Happy path plus at least one failure path tested for each new route, repository method and the shared run-record step (CLAUDE.md Testing).
- ☐ QA records a manual check of the page as a platform admin, because there is no E2E tooling.

#### S5.14 Effort and risk

| | |
|---|---|
| **Effort** | M–L. Part A: S. Part B: M (one shared step in 12 routes, one database change, retention). Part C: M. Part D: S–M (it reuses the slice 4 rule engine). Part E: S. |
| **Risk** | **Med.** (1) A hand-applied production database change, sequenced before part B's value appears. (2) Twelve production job files are touched, including four that send email to real clients (payment reminders, lead responses, insight actions, abandoned invoices). This is mitigated by FR-R4 (recording can never fail a job) and a test per job. (3) RC-5.1 reverses an SA condition, so it needs SA's re-ruling first. (4) Retiring the AgentsPilot schedule stops any scheduled agents (FR-A4). |

---

## 8. Future Roadmap

State: **Exists** = in code and usable; **Partial** = data or API exists, the admin UI does not; **New** = nothing found; **Done** = shipped.

| # | Item | Description | State | Effort | Impact | Dependencies / notes |
|---|---|---|---|---|---|---|
| R-1 | Health at a glance | Slice 4 above | ✅ **Done** (slice 4, PR #115) | M | **High** | L-1 (route timing after deploy) still owed. Green-for-healthy and the entitlements-tile fixes follow in slice 5 (RC-5.1, RC-5.2) |
| R-2 | Scheduled jobs & queues | Per BOS cron: last run, outcome, duration, items processed/left (e.g. insight-detect `usersRemaining`). Per durable queue: pending, stuck, dead-lettered | ⬜ **Now slice 5** (§7). No run record exists; five §8.1 queues exist | M–L | **High** | OQ-2 answered (unverified; slice 5 L-5.8 verifies it). Needs one hand-applied database change (OQ-6). Reuses the §8.1 queue columns |
| R-3 | Business 360 | Search by name/email and see one page: profile, plan and entitlements, modules in use, recent AI actions and failures, spend, bookings/invoices counts, reminders sent, audit history | Partial (users detail, entitlements GET, llm-usage per business) | L | **High** | Slice 2b done. OQ-3 answered (account = business) |
| R-4 | AI spend by business | Ranked list of businesses by BOS AI cost over a window, with drill-down to area and call | Partial (analytics by user; llm-usage businesses API) | M | **High** | Gap B B0 (RPC + index); `(session_id, user_id)` key rule |
| R-5 | AI activity view | Gap B B1–B3: AI actions joined to their cost lines | Approved, not built | M–L | Med | B0 → B1 → B2 → B3 as specified |
| R-6 | Plans & entitlements page | Add write actions (the 7 existing audited ops), the shadow report and the launch dry run to the existing read-only Business OS Tiers page | Partial (read-only page exists; writes API only) | M | Med now, **High at launch** | Mode in production is **shadow**, not off (RC-5.3); **no tiers configured**; gate G-1 (key rotation) before enforce |
| R-7 | Credit adjustment | Grant or deduct a customer's credits with a mandatory reason, audited | New (no admin credit endpoint found) | M | **High at launch** | Money path: needs its own requirement (user's queued credits/expiry questions); `user_subscriptions` is server-write-only. OQ-5 answered |
| R-8 | Insight pipeline health | Last detection run, businesses processed vs remaining, detectors fired, LLM failures per run | New | M | Med | Slice 5 run records (R-2); insight run-group-per-business fix (PR #111) |
| R-9 | Business OS AI writer | Change model/temperature/on-off from the screen instead of the script | Planned (model settings requirement, slice 3) | M | Med | Fail-open kill-switch caveat stays on screen |
| R-10 | LLM usage verification into admin | Move the `/test-business-os` LLM Usage tab behind `/admin` | Partial (API + harness UI) | S | Low | Its route is one of the 7 inline admin checks (slice 4 of admin unification) |
| R-11 | Business data reset/purge in admin | Per-business Danger Zone | Partial (harness only, inert) | M | Low now | Data-purge cycle parked; key rotation |
| R-12 | Real sidebar status indicator | Small live dot fed by Health | New | S | Med | R-1 done; better after slice 5 so jobs and queues are included |
| R-13 | Alerts | Email the two admins when a Health tile turns red | New | M | **High** for the endgame | R-1 done, R-2 (slice 5); OQ-1 answered (before launch) |
| R-14 | Integration health | Stripe, Google calendar sync, channel metrics sync: last success and error rate per business | New | M | Med | Slice 5 run records |
| R-15 | Outbound delivery log | Reminders, briefings and lead replies sent or failed per business | New | M | Med | Slice 5; overlaps R-3 |
| R-16 | Admin actions log preset | Audit trail filtered to actions taken by admins (entitlement ops are already audited with actor and reason) | Partial | S | Low | — |
| R-17 | Retire AP pages | Remove parked pages that are confirmed dead | — | S each | Low | Explicit user decision per page; not before AP's future is decided. AP **cron schedules** are retired in slice 5 part A (code kept) |
| R-18 | Queue actions | Retry, requeue or cancel a dead-lettered or stuck item, and "drain now" (the event-driven plan §8.2 describes a manual drain endpoint that reuses the claim path) | New | M | Med, **High at launch** | Slice 5 (read-only first). Every action is audited with a reason; SA reviews double-send risk |
| R-19 | Consistent cron authentication | `calendar-sync` and `channel-metrics-sync` run unauthenticated if `CRON_SECRET` is ever missing in production; the other ten refuse | New (found 2026-09-27) | S | Low now (secret is set, OQ-2) | SA to decide; a small security change, separate from slice 5 |
| R-20 | Admin phantom-column fixes | Three admin reads ask for tables or columns that don't exist (schema check, 2026-09-27): the audit trail's `users` lookup (user names empty, OI-18), the AI cost drill-down's `workflow_executions.input_data`, and the Businesses detail stats' `agent_executions.total_tokens_used` / `user_subscriptions.plan_name` | Partial (screens exist, reads broken) | S | Med | Recommended as the next admin slice |
| R-21 | Business OS / Stripe phantom-column fixes | Six product reads ask for columns that don't exist: Stripe checkout (`profiles.display_name`), Stripe invoices and webhook (`ais_system_config.pilot_credit_cost_usd`), the contact statement (`payment_invoices.description`), BizQL scheduling edits (`scheduling_services.name`) and landing-page generation (`business_profiles.target_audience`). Not an admin item; tracked here so it isn't lost | New (fix) | M | **High** (money paths) | Suggested as its own task, 2026-09-27; money paths first |

---

## 9. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Security** | Every new page lives under `app/admin/` and inherits `requireAdminPage`. Every new admin route calls `requireAdmin` first (CI-enforced). Never `profiles.role`. Cross-account reads show metadata only, never owner text. |
| **Honesty** | No indicator shows "OK" for something it does not measure. "Not measured" is a distinct, visible state. *(Amended 2026-09-27, RC-5.1:)* **Green is allowed only when a tile is measured, every figure is exact and no rule matched.** A failed read, a lower-bound figure or a missing measurement is never green. |
| **Performance** | Health landing is usable within ~3 s at current volumes. No unbounded cross-account scan on page load (see B0 V-3). |
| **Money** | Spend is never summed across currencies. AI cost is USD by definition of the pricing table and labelled as such. |
| **Accessibility** | The collapsible group is keyboard-operable and announces its state. Every status colour, green included, also carries a text label. |
| **Stability** | Every slice is revertible alone. No route URL changes in slices 1–3. |

---

## 10. Out of Scope

- Visual redesign (colours, fonts, components) (D-4).
- Deleting any AgentsPilot page, route, API or table (D-3).
- Fixing the existing debt inside reused pages, except where a slice already touches the file (Pino conversion, error-detail leaks, the 7 inline admin checks).
- ~~Deciding whether AP background jobs keep running (OQ-4 raises it; any change is a separate decision).~~ *Decided 2026-09-25 (OQ-4): the 3 AP schedules are retired in slice 5 part A; their code stays.*
- Owner-facing BOS screens (`/business-os/*`).
- In slice 5: retry, requeue, cancel or "drain now" actions (R-18); per-business breakdown of jobs and queues (R-3, R-15); email alerts (R-13); the cron authentication inconsistency (R-19); moving the jobs to a different scheduler (`pg_cron`, event-driven plan §8.2).

---

## 11. Open Questions

- [x] **OQ-1: Being told vs looking.** Before the first customer, is checking the admin page enough, or do you want an email when something turns red? *Suggested:* page-only until launch, with email alerts (R-13) as a launch prerequisite. (raised by: BA | status: ✅ answered 2026-09-25: agreed, page-only until launch, email alerts before launch)
- [x] **OQ-2: Are BOS scheduled jobs live in production today?** Records disagree. The payment work says the jobs are dormant until Offir sets the cron secret. The Insights doc (2026-09-23) says payment reminders were seen sending in production. *Suggested:* confirm with Offir. Either way, R-2 exists so this never needs asking again. (raised by: BA | status: ✅ answered by Offir 2026-09-25: `CRON_SECRET` is set in Vercel production, and the crons are running "as far as I know". **Caveat: unverified.** No run record exists to confirm it (§S5.4). Slice 5 makes it verifiable: check L-5.8 shows a recorded run for each of the 12 jobs after deploy, and any job Vercel calls but that refuses the call goes late, then stopped.)
- [x] **OQ-3: One login = one business?** Will a person ever own several businesses, or will a business have several staff logins, before launch? This decides what the "Businesses" list and the 360 view are keyed on. *Suggested:* assume one account = one business for now (A-4). (raised by: BA | status: ✅ answered 2026-09-25: yes, one login = one business)
- [x] **OQ-4: Is anyone still using AgentsPilot?** Three AP jobs still run on schedule, one of them every 5 minutes (scheduled agents). If no real user depends on them, they are cost and noise. *Suggested:* check for active scheduled agents, then decide separately. This doesn't block any slice. (raised by: BA | status: ✅ answered by Offir, relayed 2026-09-26: **"sunset them for now".** `run-scheduled-agents` (every 5 min), `update-template-scores` (daily) and `memory-consolidation` (weekly) are removed from `vercel.json` in slice 5 part A. Their code stays, so re-enabling one is a one-line change. The count of affected scheduled agents is recorded before merge (FR-A4, L-5.6).)
- [x] **OQ-5: Credit adjustments.** When an admin grants or deducts credits, should the reason ever be visible to the customer, or stay internal? *Suggested:* internal only, mandatory, audited. This will feed the R-7 requirement. (raised by: BA | status: ✅ answered 2026-09-25: agreed, internal only, mandatory, audited)
- [x] **OQ-6: Recording job runs.** Measuring the jobs needs each run written to a small new database record (§S5.5, option A). **You would apply one database change by hand in production.** How long should run history be kept? *Suggested:* approve option A and keep 30 days (about 32,000 small records). Options B to D are weaker; C cannot tell a quiet job from a stopped one. (raised by: BA | status: open, user) **✅ Answered 2026-09-27: option A approved, with 30 days of history. The user applies the one production database change by hand.**
- [x] **OQ-7: Starting alarm rules for jobs and queues.** Are the proposed thresholds right (§S5.7, §S5.8)? Most debatable: (a) daily payment reminders turn amber after 25 h without a run and red after 49 h; (b) a dead-lettered client message is **red** within 24 h. Since there are no customers yet, it could be amber until launch. *Suggested:* accept them as starting rules (a data edit to change later, as with slice 4), with (b) red, because a dead-letter is a client message that never went out. (raised by: BA | status: open, user) **✅ Answered 2026-09-27: starting rules accepted as proposed, including red for a dead-letter in the last 24 h.**
- [x] **OQ-8: Was shadow mode deliberate?** Production resolves `BOS_ENTITLEMENTS_MODE` to **shadow** (plans are checked and logged, nothing is blocked). The docs say it is unset (off). *Suggested:* ask Offir. Not a blocker: the docs are corrected to say what production does either way (RC-5.3). If it was not deliberate, switching it is Offir's one-line environment change. (raised by: BA | status: open, for the user to ask Offir) **✅ Answered 2026-09-27: yes, deliberate. Shadow was set to collect data first. Docs must say production runs in shadow on purpose.**
- [x] **OQ-9: Should Shadow count as "healthy" (green)?** Under the new green rule the entitlements tile turns green when the mode in effect is the one asked for. *Suggested:* yes. Green here means "working as set up", and the tile's words say what Shadow means. The alternative is to keep this tile always grey, as information only. (raised by: BA | status: open, user) **✅ Answered 2026-09-27: no. Shadow shows NEUTRAL (grey), not green. It is a chosen mode, not a health signal. Green applies only to measured health tiles.**

---

## 12. Notes on Integration Points

| System | Touched by | Note |
|---|---|---|
| `app/admin/components/AdminSidebar.tsx` | Slices 1, 3, 4, **5** | Data and labels only. Pinned by `app/admin/business-os-llm/__tests__/nav.test.ts` and `app/admin/components/__tests__/AdminSidebar.nav.test.ts`. Slice 5 adds a fourth Monitor entry, so the Monitor pin and the entry count (23 today) move |
| `app/admin/layout.tsx` / `requireAdminPage` | All new pages | Unchanged; protection by inheritance |
| `/api/admin/analytics` sources (`token-usage*`) | Slice 2a | BOS row definition: `lib/business-os/llm/callCatalog.ts` `bosRowFilter` |
| `/api/admin/users/**` | Slice 2b | Service-role reads; carries `console.*` and a 500 response that returns `error.message` |
| `/api/admin/business-os/entitlements/**` | Slice 2b, R-6 | Already `requireAdmin`-gated and audited |
| `/api/admin/business-os/llm-usage/**` | R-4, R-10 | One of the 7 inline admin checks |
| `token_usage`, `audit_trail` | Slice 4, R-4, R-5 | Live DB has `idx_token_usage_created_at` and `idx_audit_trail_created_at` (created outside the repo; slice 4 L-3) |
| `lib/admin/health/**`, `app/api/admin/health-summary`, `app/admin/components/health/**` | Slice 4, **slice 5 parts D and E** | Rule engine, evaluator and tiles. Slice 5 adds jobs and queues inputs, a green state (RC-5.1) and the entitlements tile wording (RC-5.2) |
| `lib/business-os/entitlements/mode.ts` | Slice 4, slice 5 RC-5.2/5.3 (read only) | Defines what off / shadow / enforce mean, and that a refused enforce becomes shadow |
| `payment_reminders`, `payment_automation_executions`, `daily_briefing_sends`, `lead_responses`, `insight_actions` | **Slice 5** | The five §8.1 queues, read as counts only. Status words differ per table (§S5.7). Live columns, values and indexes to be verified (L-5.1 to L-5.5) |
| `app/api/cron/*/route.ts` (12 BOS jobs) | **Slice 5 part B** | Each gains the shared run-record step after its authorisation check. All already use Pino |
| New run-record table | **Slice 5 part B** | One hand-applied production change (FR-R8); server-only; 30-day retention (OQ-6) |
| `vercel.json` crons | R-2, **slice 5 part A** | 15 → 12 schedules: the 3 AP entries are removed; the 12 BOS entries are the source of the jobs list (FR-R9) |
| `CLAUDE.md`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` | **Slice 5 RC-5.3** | Correct "unset in production" to "shadow in production" |
| `/test-business-os` (LLM Usage, Danger Zone) | R-10, R-11 | Admin-like capabilities outside `/admin` |

Related: [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) · [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) · [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) · [BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md) · [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) · [BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md) · [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) · [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) · [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) · [ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md](/docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | Created | Code-verified inventory of 22 admin pages and BOS admin APIs; assessment; target IA with a collapsed parked group; AP→BOS benchmark; four shippable slices; 17-item roadmap; five open questions |
| 2026-09-25 | Open questions answered | OQ-1, OQ-3 and OQ-5 answered (suggested defaults accepted). OQ-2 (CRON_SECRET) and OQ-4 (AP crons) sent to Offir. Work parked until he replies |
| 2026-09-25 | Re-baselined on main `b613bb97` | Added the Business OS Tiers page (merged 2026-09-24) to the inventory, the target IA, the slice 1 scope and R-6. Main now has 2 BOS sidebar items out of 22, not 1 of 21 |
| 2026-09-25 | Slice 1 shipped, slice 2c extended | Slice 1 merged (PR #107) and verified on production. At the user's request the parked AgentsPilot section is **hidden** (`hidden: true`, PR #108) rather than collapsed, which supersedes the slice 3 collapsed-group design. Slice 2c now also limits the audit trail's Action Type filter to BOS and shared events. Fixed the route count (22, not 21) |
| 2026-09-26 | Slice 2 decisions recorded (PR #112) | **U-1:** "Users" renamed "Businesses"; every row shows the business name **and** the user name (rows without a business say "No Business OS business"). **U-2:** borderline audit-event tags approved (plugin connections, test harness, onboarding and boost packs are shared; effort estimate is AgentsPilot). **U-3:** only the agents list and agent executions fold away. **U-4:** the AI cost & usage "Business OS only" toggle is on by default. **U-5:** the 1,000-row cutoff and the "vs previous period" filter gap are **parked** (workplan OI-P1 / OI-P2). Consequence: the slice 2 criterion "BOS preset totals match the LLM usage report" holds only below 1,000 rows in the window; live 30-day volume is already about 7,658 rows, so the page shows its totals may be incomplete |
| 2026-09-27 | **Slice 5 drafted; OQ-2 and OQ-4 answered; slice states updated** | Re-baselined on main `546f6110` (branch `feature/admin-bos-jobs-queues`). **Slice 5** (roadmap R-2) specified: (A) retire the 3 AgentsPilot cron schedules, code kept (OQ-4, Offir: "sunset them for now"); (B) a minimal run record for the 12 BOS jobs, because **no cron records its runs today** (all 12 routes read), with four options in business terms and option A recommended (one hand-applied database change); (C) a "Scheduled jobs & queues" page under Monitor covering 12 jobs and the **five** §8.1 queues found in migrations (payment reminders, payment automations, daily briefing sends, lead responses, insight actions), read-only; (D) ordered rules for the two Health tiles, with late/stopped thresholds per schedule; (E) user feedback: **RC-5.1 green for healthy** (measured, exact, no rule matched; reverses slice 4 C-10, needs SA re-ruling), **RC-5.2** a clearer entitlements tile (the "0" is not emitted by the tile's code; Dev to identify it), **RC-5.3** correct the docs: production mode is shadow, not unset. **OQ-2** answered (CRON_SECRET set; unverified, slice 5 verifies). New questions OQ-6 to OQ-9. §7: slice states table; slice 3 marked superseded by PR #108; slice 4 marked shipped (PR #115) with its as-shipped amendments (U-1, U-6, link exceptions, U-5) and the replaced acceptance criterion. §8: R-1 done, R-2 = slice 5, new R-18 (queue actions) and R-19 (two crons run unauthenticated without the secret). §2.3, §4.2, §5, §6, §9, §10 and §12 updated to match |
| 2026-09-27 | OQ-6 to OQ-9 answered | Option A run record with 30-day history approved; starting rules accepted (a dead-letter in 24 h is red); shadow mode confirmed deliberate (collect data first); Shadow is neutral, not green, on the entitlements tile |
| 2026-09-27 | Slice 5 shipped; R-20 and R-21 added | PR #122 and PR #123 merged, migration applied and verified. The schema check found 32 pre-existing broken reads: the three admin ones become R-20 (next admin slice), the six Business OS / Stripe ones become R-21 (separate fix, money first) |
| 2026-10-02 | Next slice cross-linked | Added a row to §7 pointing to the admin cleanup requirement, which carries R-6, R-18, R-20, the first R-3 sub-slices and the Settings clean-up |
