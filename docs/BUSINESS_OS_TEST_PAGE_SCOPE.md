# Business OS Test Page — Scope & Functionality

> **Last Updated**: 2026-08-09

**Location:** `app/test-business-os/page.tsx`
**Route:** `/test-business-os`
**Purpose:** Internal testing interface for the **Business OS** surface — mirrors the infrastructure of the [Test Plugins V2 page](/docs/V2_TEST_PAGE_SCOPE.md) (tab switcher + shared JSON response viewer + debug-log panel), adapted to how Business OS actually runs.

## Overview

The Business OS Test Page is a multi-tabbed harness for exercising Business OS APIs and flows in isolation, the way `/test-plugins-v2` does for the plugin/agent-creation surface. It shares the same look and shared chrome, but differs in **one fundamental way — its account model**:

| | `/test-plugins-v2` | `/test-business-os` |
|---|---|---|
| Target account | A **typed `userId`** (free-text box); routes accept `x-user-id` and can act on any user | The **logged-in session user** (`getUser()`); Business OS routes have **no `userId` override** |
| Identity control | User ID input + status summary | Read-only **Current User (session)** panel |
| Impersonation | Yes (type any userId) | No — to test a persona, log in as them |

Because every `/api/business-os/*` (and `/api/onboarding/*`) route authenticates via `getUser()`, this page acts as whoever you are currently authenticated as, and the current-user panel shows exactly which account that is. This removes the "typed userId vs. session user" mismatch that the Form Tester on `/test-plugins-v2` has to manage.

This document describes the page as it exists today (shared chrome + the Account Setup helper + a placeholder Overview tab) and is intended to grow **one section per feature tab** as tabs are added.

## Table of Contents

- [Account Model](#account-model)
- [Shared Chrome](#shared-chrome)
  - [Current User (session) panel](#current-user-session-panel)
  - [Account Setup (seed profile)](#account-setup-seed-profile)
  - [Last API Response viewer](#last-api-response-viewer)
  - [Debug Logs panel](#debug-logs-panel)
- [Tabs](#tabs)
  - [Tab: Overview (placeholder)](#tab-overview-placeholder)
  - [Tab: Modules](#tab-modules)
- [Adding a New Tab](#adding-a-new-tab)
- [Technical Architecture](#technical-architecture)
- [Related Documentation](#related-documentation)
- [Change History](#change-history)

---

## Account Model

**Session-based, no impersonation.**

- The page reads the current user from the `useAuth()` hook (`@/components/UserProvider`), which is mounted app-wide in the root layout.
- All requests are same-origin `fetch` calls; the Supabase auth cookie is sent automatically, so server-side `getUser()` resolves the logged-in user. **No `userId` is passed** by the client, and the Business OS routes do not accept one.
- To test as a different account, **log in as that account** — there is no user-switching control on this page by design.
- If you are not signed in, the current-user panel says so and Business OS calls will return `401`.

> **Routing note:** `/test-business-os` is in the middleware `skipOnboardingCheck` allowlist (alongside `/test-plugins-v2`). Without it, the V2 UI-routing rule rewrites the path to `/v2/test-business-os` (404). See `middleware.ts`.

---

## Shared Chrome

The **Last API Response viewer** and **Debug Logs** panel are always visible (on every tab). The **Current User** panel and **Account Setup** helper render on the **Overview tab only** — they are account-level setup you do once, not something repeated on each feature tab. Seed a profile from Overview, then switch to a feature tab (e.g. Modules) to use it.

### Current User (session) panel — *Overview tab*

Read-only display of the authenticated session user:
- **User ID** and **Email**, or a "Loading session…" state, or a "Not signed in" warning.
- Serves as the single source of truth for *which account* every request on the page runs as.

### Account Setup (seed profile) — *Overview tab*

A convenience helper to bootstrap the prerequisites most Business OS features need — a business profile and default CRM pipeline stages — in one call.

- **Endpoint:** `POST /api/onboarding/build`
- **Controls:**
  - **Vertical** selector — `coach` / `consultant` / `therapist` / `sales` / `generic`. The vertical decides which default CRM pipeline stages get seeded. `generic` omits the vertical and seeds the default stage set.
  - **Company name** (optional) text input.
  - **Seed Profile** button (disabled until signed in).
- **What it does server-side:** upserts `business_profiles` for the session user and seeds `crm_pipeline_stages` for the chosen vertical (used by CRM stage operations such as `move_stage` / `list_pipeline_stages`).
- **Request shape:**
  ```json
  { "profile": { "vertical": "consultant", "company_name": "Test Co" } }
  ```
  (`generic` sends `{ "profile": { "company_name": "..." } }` with no `vertical`.)

> **Why it lives on Overview:** a profile + seeded pipeline stages is a precondition for basically every Business OS capability (CRM, scheduling, insights, stats), so it is one-time account-level setup — done from Overview — rather than a control repeated on every feature tab.

### Last API Response viewer

- Shows the full JSON of the most recent API response (from any tab or the Account Setup helper), populated by the shared `callApi()` helper.
- **Copy to Clipboard** button; scrollable, height-capped container.

### Debug Logs panel

- Real-time, timestamped, color-coded log of every request the page makes: 🟢 success · 🔴 error · ⚪ info.
- Bounded to the most-recent **50** entries; **Clear Debug Logs** button.
- Client-side only — this panel is independent of the server's `dev.log` (which captures the API routes' Pino output when the dev server is run with a redirecting script such as `npm run dev:pretty`).

---

## Tabs

Feature tabs are added over time; each will be documented here as its own subsection following the same structure as the Test Plugins V2 doc (**Purpose / Features / API Endpoints Used / Use Cases**).

### Tab: Overview (placeholder)

The only tab wired up today. It explains the shared shell and confirms no feature tabs are connected yet. It exists so the page renders meaningfully before the first real tab is built.

_(Feature tabs will be inserted above/around this section as they are implemented.)_

### Tab: Modules

**Purpose:** exercise the internal **Business OS modules** — the repository-backed plugins with `visibility: 'business_os'` — with a schema-driven form, running as the logged-in session user. The module list is **data-driven** (no hardcoded module names): every `business_os`-visibility plugin appears automatically. As of 2026-08-10 that is **CRM**, **Scheduling**, **Payments**, and **Intake**; any future internal module surfaces here with no page changes.

> **Registry caching:** the plugin registry is loaded at server cold-start, so a newly added internal plugin appears in the module list only after a **dev-server restart**.

**Why it's a distinct surface from `/test-plugins-v2`'s Form Tester:** internal modules have **no OAuth/connection gate** (they use the `db_active` access strategy, enforced server-side), and this page is **session-based** — so operations run as *you*, not a typed userId. That pairs with **Account Setup** above: seed a profile, then run modules as the same account.

**Features:**
- **Module selector** — lists only `business_os`-visibility plugins (so the general plugin catalog is not shown here).
- **Operation selector** — the selected module's operations, from its schema.
- **Schema-driven form** — auto-generated from the operation's parameters (reuses the same generic form builders as the Form Tester: `buildFormFields` / `SchemaForm` / `assembleParameters`), with required-field validation, a destructive-action confirm gate, and an **Advanced (raw JSON)** toggle.
- **Run** — executes as the session user; the result flows into the shared **Last API Response** viewer + **Debug Logs**.

**Reuses existing endpoints (no new APIs):**
- `GET /api/plugins/available?includeBusinessOs=true` — the module list, filtered client-side to `visibility === 'business_os'` (the route now returns `visibility` on each plugin).
- `GET /api/plugins/action-schema?plugin=<key>` — the operation schema (read-only, metadata-only).
- `POST /api/plugins/execute` — runs the operation; the page passes the **session user's id** in the body.

> **Security note (by design, tracked):** `/api/plugins/execute` reads `userId` from the request **body** with no server-side `getUser()` — it is an impersonation-style endpoint (the same one `/test-plugins-v2` uses). This tab upholds the page's "session user, no impersonation" model *by convention* (it sends `user.id`), not because the endpoint enforces it. Internal modules gate on `db_active`, so a non-tenant id returns `access_denied`, but a different **active-tenant** id would execute as them. Hardening `execute` to derive identity from `getUser()` is a tracked follow-up (execute-route hardening).

**Component:** `components/test-business-os/BosModuleTester.tsx` (session-model sibling of the Form Tester — no connection gate).

**Use cases:**
- Seed a profile via Account Setup, then in Modules → **CRM** → `create_contact` / `list_contacts` / `add_task` / `move_stage` / `log_activity`.
- **Scheduling** → `create_service` → `create_booking` → `reschedule_booking` / `cancel_booking`; `check_availability`.
- **Payments** → `create_invoice` → `record_manual_payment` (referencing that invoice) → confirm it flips to `paid`; `get_revenue`.
- Confirm the guard: run any module op as an account with **no** profile → `access_denied`.
- Confirm no double-logging: after `create_contact`, inspect the contact's `crm_activities` — exactly one `contact_created` (the trigger's), none added by the executor. The same delegate-only rule holds for Scheduling (booking → CRM activity via T1/T2) and Payments (succeeded payment → CRM activity via T3, invoice paid via T4).

**Per-module user docs:** [crm-plugin.md](/docs/plugins/crm-plugin.md) · [scheduling-plugin.md](/docs/plugins/scheduling-plugin.md) · [payments-plugin.md](/docs/plugins/payments-plugin.md) · [intake-plugin.md](/docs/plugins/intake-plugin.md).

---

## Adding a New Tab

Tabs are intentionally cheap to add (see the `HOW TO ADD A TAB` comment at the top of `app/test-business-os/page.tsx`):

1. Add an entry to the `TABS` array: `{ id: 'my-tab', label: 'My Tab' }`. The `TabId` union widens automatically from `typeof TABS`.
2. Add a `{activeTab === 'my-tab' && ( ...content... )}` block in the tab content region.
3. Use the shared **`callApi(path, { method, body, label })`** helper for requests — it logs to the Debug Logs panel and populates the Last API Response viewer for you, and attaches an `x-correlation-id` that the Business OS routes thread into their structured logs.

After building a tab, add a matching subsection under [Tabs](#tabs) describing its Purpose, Features, API endpoints, and Use Cases.

---

## Technical Architecture

**Component:** single client component (`'use client'`), self-contained (no shared test-framework module), mirroring `/test-plugins-v2`'s inline styling.

**Shared state:**
```typescript
activeTab: TabId            // which tab is active
isLoading: boolean          // request in flight (disables actions)
lastResponse: unknown       // most recent API response (Last API Response viewer)
debugLogs: DebugLog[]       // capped at 50 entries
copySuccess: boolean        // clipboard feedback
// Account Setup
seedVertical: string        // coach | consultant | therapist | sales | generic
seedCompanyName: string
```

**Key helpers:**
- `callApi(path, { method?, body?, label? })` — shared request helper. Sends cookies (session), attaches `x-correlation-id`, parses JSON (falls back to text), logs the outcome, sets `lastResponse`, and returns the parsed body. All tabs should route requests through this.
- `seedProfile()` — Account Setup handler; calls `POST /api/onboarding/build` via `callApi`.
- `addDebugLog(type, message)` / `clearLogs()` — debug panel.
- `copyToClipboard()` — copy `lastResponse`.

**Auth source:** `useAuth()` from `@/components/UserProvider` (root-layout provider) supplies `user` and `loading`.

**Logging:** the client emits no `console.*`; everything is surfaced through the in-page Debug Logs panel. Server-side, the API routes it calls use the standard `createLogger` (Pino → stdout) path.

---

## Related Documentation

- [Test Plugins V2 Page — Scope](/docs/V2_TEST_PAGE_SCOPE.md) — the sibling test page whose infrastructure this mirrors
- [Repository Strategy](/docs/REPOSITORY_STRATEGY.md) — data-access pattern the Business OS routes follow
- [System Logging Guidelines](/docs/SYSTEM_LOGGING_GUIDELINES.md) — Pino logging standard for the routes under test

---

## QA

> **QA — 2026-08-09** · Mode: regression + smoke · Strategy: A (Jest) + B (static/integration review) + E (log/manual gaps) · Focus: api regression + ui correctness · Input source: prompt keywords

### Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Reused tester helpers still pass | ✅ | Pass | `npx jest lib/plugins/tester` → 4 suites, **72/72** green (connection-gate, form-values, schema-to-form, redaction). No regression. |
| `/available` `visibility` field is backward-compatible for `/test-plugins-v2` | ✅ | Pass | Consumer path `plugin-api-client.getAvailablePlugins()` returns `result.plugins` (untyped `any`) → `setAvailablePlugins(PluginInfo[])`. Added field is ignored at runtime; excess-property checks don't apply (not an object literal). No compile or runtime break. |
| Default list (no `?includeBusinessOs`) still hides `business_os`/CRM | ✅ | Pass | `isPluginDiscoverable` unchanged; default `includeBusinessOs=false` filters out `visibility==='business_os'`. Only the new field was added to the response map — the filter predicate is untouched. |
| Module filter is data-driven (no hardcoded `['crm']`) | ✅ | Pass | Page filters `p.visibility === 'business_os'`; grep for `console.`/`'crm'` in both new files → no matches. |
| Session-userId threading | ✅ | Pass | `executeModuleAction` posts `{ userId: user.id }`; tester receives `sessionUserId={user?.id ?? null}` and short-circuits when null (sign-in gate UI). |
| Required-field + destructive gating | ✅ | Pass | `canRun`/`computeMissingRequired` disable Run + show "Required: …"; `confirmation.requiresConfirm` routes through `DestructiveConfirm` before `doRun`. |
| Effect cancel / seed guards | ✅ | Pass | Schema-load effect uses a `cancelled` flag; seed effect keyed on `${module}/${action}` via `lastSeededKey` ref, so a background re-fetch of the same action never wipes typed input. |
| No `console.*` in new files | ✅ | Pass | Grep clean. |

### Findings

- **No bugs found.** SA-approved implementation holds up under static + unit review.
- **Acknowledged (pre-existing, out of scope — not bugs in this work):** `POST /api/plugins/execute` trusts the body `userId` and uses `console.log`. SA already logged these as tracked follow-ups; unchanged here.
- **Minor note (non-blocking):** `PluginInfo` (`lib/types/plugin-types.ts:366`) does not declare the new optional `visibility?` field. Harmless today (extra runtime field, consumers cast through `any`), but adding `visibility?: PluginVisibility` there would keep the type honest with the API contract. Nice-to-have, not required.
- **Minor note (non-blocking):** the auto-load effect sets `modulesLoaded=true` even when `loadModules` returns empty (e.g. a failed `/available` call), so it won't auto-retry — the manual "Reload modules" button covers this. Acceptable for an internal harness.

### Not verifiable in this session (requires the user's logged-in test-page run + DB)

Could not run a live session/DB. The following need a manual pass on `/test-business-os`:

1. **Modules list** — open **Modules** tab → **Load modules** → **CRM** appears in the module dropdown (and nothing else, since CRM is the only `business_os` plugin today).
2. **Happy path** — **Account Setup → Seed Profile** (e.g. vertical *Coach*), then Modules → CRM → `create_contact` with required fields → succeeds.
3. **Access gate** — with **no** seeded profile, run any CRM op → server returns `access_denied` (db_active strategy), surfaced in ResultView.
4. **No double-logging spot check** — after one successful `create_contact`, confirm exactly **one** `contact_created` activity is recorded (not two).

### Verdict

**PASS-WITH-NOTES** — all runnable checks green (72/72 unit tests, `/available` regression backward-compatible, default CRM-hidden preserved, component wiring correct, no `console.*`). No High/Medium bugs. Two non-blocking minor notes above. Live happy-path / access-gate / no-double-log items require the user's authenticated run before final sign-off.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-09 | Initial version | Created `/test-business-os` shell: session-based account model, Current User panel, Account Setup (seed profile) helper, shared Last API Response viewer + Debug Logs, and a placeholder Overview tab. Added the route to the middleware `skipOnboardingCheck` allowlist. Also fixed `POST /api/onboarding/build` (which Account Setup depends on): it wrote a non-existent `tools` column to `business_profiles`, causing PostgREST `PGRST204` → 500; the write was removed (the request still accepts `tools` for backward-compat but no longer persists it). No feature tabs yet. |
| 2026-08-09 | Modules tab | Added the **Modules** tab: a schema-driven tester for internal Business OS modules (`visibility: 'business_os'` plugins; CRM first), running as the session user. Reuses existing endpoints only (Option A — no new APIs): `available?includeBusinessOs=true` (now returns `visibility`), `action-schema`, `execute`. New component `components/test-business-os/BosModuleTester.tsx`. |
| 2026-08-09 | Chrome layout | Moved the **Current User** panel and **Account Setup** helper to render on the **Overview tab only** (previously always-visible chrome) — they are one-time account setup, not repeated per feature tab. The **Last API Response** viewer and **Debug Logs** remain always-visible. |
| 2026-08-10 | Scheduling + Payments modules | The Modules tab now also lists **Scheduling** and **Payments** (both `visibility: business_os`) — no page changes required; the module list is data-driven. Updated the Modules section, use cases (Scheduling/Payments flows + delegate-only trigger notes), and linked the per-module user docs. |
