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

The shared chrome is visible on every tab (it is account-level, not tab-specific).

### Current User (session) panel

Read-only display of the authenticated session user:
- **User ID** and **Email**, or a "Loading session…" state, or a "Not signed in" warning.
- Serves as the single source of truth for *which account* every request on the page runs as.

### Account Setup (seed profile)

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

> **Why this belongs in the shell:** a profile + seeded pipeline stages is a precondition for basically every Business OS capability (CRM, scheduling, insights, stats), so it is account-level setup rather than a feature under any single tab.

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

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-09 | Initial version | Created `/test-business-os` shell: session-based account model, Current User panel, Account Setup (seed profile) helper, shared Last API Response viewer + Debug Logs, and a placeholder Overview tab. Added the route to the middleware `skipOnboardingCheck` allowlist. Also fixed `POST /api/onboarding/build` (which Account Setup depends on): it wrote a non-existent `tools` column to `business_profiles`, causing PostgREST `PGRST204` → 500; the write was removed (the request still accepts `tools` for backward-compat but no longer persists it). No feature tabs yet. |
