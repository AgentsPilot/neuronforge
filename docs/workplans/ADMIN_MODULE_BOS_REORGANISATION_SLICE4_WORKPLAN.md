# Workplan: Admin Module BOS Reorganisation, Slice 4 (Health at a glance) + Businesses-screen fixes

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) §4 (target IA), §7 Slice 4, §9 NFRs, A-2; plus the user's feedback on Slice 2 production check M-2 (Businesses screen)
**Branch:** `feature/admin-bos-health-landing` (worktree `neuronforge-admin-bos-reorg`, cut from `main` @ `8ff11095`, which includes PR #112)
**Delivery:** one PR covering Part A (Businesses-screen fixes) and Part B (Health landing), per the user's instruction
**Process:** full cycle, not the UI-only short path. Part B adds a new `/api/admin/*` route and new cross-account admin reads. Order: Dev workplan, SA workplan review, Dev implements, SA code review, QA, user review of the diff, user approval, RM.
**Standing user rule:** **nothing is committed**, now or during implementation. All changes stay uncommitted in the worktree until the user has reviewed the code.
**Status:** Code Complete, user-approved (2026-09-26). SA approved with nits, QA passed (conditional); the review follow-ups (§15.7) and the user's last three choices U-7 to U-9 (§9) are applied. Everything is uncommitted in the worktree, for RM. **Merge stays gated on L-2 to L-6** (C-14, owed by the user)

## Overview

This slice does two things in one PR. **Part A** fixes the Businesses screen (`/admin/users`), following the user's Slice 2 production checks:
- the status filter opens on **Active users**;
- a login with **no name** shows a red "No name — needs attention" instead of a green tick;
- the "Email verified" tick moves beside the email;
- the Active/Inactive badge moves beside the name.

**Part B** replaces the `/admin` landing with **Health**: one screen of red, amber or neutral tiles, built only from signals that already exist (Business OS AI settings, audited AI failures, Business OS AI spend, critical audit events and the entitlements mode).
- Each tile is coloured by an **ordered list of rules held as data** (U-1). The first rule that matches sets the colour and the text shown. If none matches, the tile shows grey "Normal".
- The scheduled-job and queue tiles say **"Not measured yet"**. No tile is ever green.
- The old AgentsPilot dashboard moves to `/admin/platform-dashboard`. It is kept only as an entry in the hidden parked section, **with no visible link anywhere** (U-6).

This document records what was verified in the code, the exact read and rule list behind each tile, the test plan, the SA's forks and conditions, and the user's decisions.

---

## Table of Contents

1. [Verification Log (what the code actually says)](#1-verification-log-what-the-code-actually-says)
2. [Analysis Summary](#2-analysis-summary)
3. [Facts That Changed Since the Requirement](#3-facts-that-changed-since-the-requirement)
4. [Part A: Businesses-Screen Fixes](#4-part-a-businesses-screen-fixes)
5. [Part B: Health Landing](#5-part-b-health-landing)
6. [Tiles: Data Sources, Exact Reads and Rule Lists](#6-tiles-data-sources-exact-reads-and-rule-lists)
7. [Performance: Measuring Against the §9 Budget](#7-performance-measuring-against-the-9-budget)
8. [Files to Create / Modify](#8-files-to-create--modify)
9. [User Decisions (U-1 to U-6)](#9-user-decisions-u-1-to-u-6)
10. [Technical Forks for SA](#10-technical-forks-for-sa)
11. [Risks](#11-risks)
12. [Test Plan](#12-test-plan)
13. [Non-Compliant Files (CLAUDE.md rule 3)](#13-non-compliant-files-claudemd-rule-3)
14. [Task List](#14-task-list)
15. [Implementation Record (Dev, 2026-09-26)](#15-implementation-record-dev-2026-09-26)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Verification Log (what the code actually says)

Measured on `feature/admin-bos-health-landing` @ `8ff11095`. The live database has **not** been queried, per the instruction. Everything live is listed as a check owed by the user (§7.3).

| # | Finding | Evidence | Effect on the plan |
|---|---|---|---|
| V-1 | The status filter defaults to `'all'`. The page sends it to the list route as `status` on every fetch | `app/admin/users/page.tsx:152` (`useState<'all' \| 'active' \| 'inactive'>('all')`), `:176-179`; the select is at `:508-517` and casts with `as any` | Part A changes the initial state only. **The first request now carries `status=active`** (see V-3) |
| V-2 | "Active" means **signed in within the last 30 days** (`auth.users.last_sign_in_at`), not "used the product" | Route `app/api/admin/users/route.ts:70-75` (`isRecentlyActive`), page `:273-278` | A daily user with a long-lived session can count as inactive. Recorded as R-6, not changed |
| V-3 | The list route already accepts `status=active` and filters server-side. Its own default stays `'all'` (Zod) | `route.ts:46`, `:193-199` | **No route change is needed.** But `stats.totalUsers` is the **filtered** count (`route.ts:203-206`), so the "Total Users" card will show the active count once the default changes. UI-only relabel proposed (A-3) |
| V-4 | The **green indicator next to the name** is the "Email verified" tick (`CheckCircle`, green) rendered beside the user's name whenever `email_confirmed` is true, including on rows that say "No name" | `page.tsx:664-673` | This is the indicator Part A replaces on a no-name row. The green **"Active"** pill in the Status column (`:699-715`) is a different element (the user moved both: the tick beside the email, the badge beside the name, U-3) |
| V-5 | What "no name" is in the data: `profiles.full_name`, typed `string \| null`. The page renders `user.full_name \|\| 'No name'`, so `null` and `''` show "No name", but a **whitespace-only** name renders as a blank line | `UserProfileRepository.ts:32-40` (`ADMIN_PROFILE_LIST_COLUMNS`), `page.tsx:666` | "No name" is defined as **null, empty or whitespace-only** (`trim() === ''`) |
| V-6 | **Signup never writes a name.** The signup trigger inserts `profiles (id)` only. The name is set only when the owner saves it in Settings, and that form can save `''` | `supabase/migrations/20261003_codify_create_user_settings_trigger.sql:57-61, 94`; `app/api/user/profile/route.ts:164`; `app/business-os/settings/page.tsx:173, 269, 719` | **Every login that never saved its profile will turn red**, including Google sign-ins whose display name exists in auth metadata but was never copied. This may be most accounts. Accepted by the user (U-3); saving the Google name is follow-up FU-1 |
| V-7 | The business line has three separate states, none of them about the person: `undefined` = "Business unknown" (lookup failed), `null` = "No Business OS business", a business with no `company_name` = "Unnamed business". All are muted grey italic | `page.tsx:59-64` (`businessLabel`) | **Unchanged.** Red applies to the person's name only, never to the business fallbacks |
| V-8 | The parked AgentsPilot section is **hidden** (`hidden: true`), not collapsed. The Monitor entry for `/admin` is "Dashboard / Totals, mostly AgentsPilot" | `app/admin/components/AdminSidebar.tsx:70-81, 155-160, 240` | Requirement acceptance "old dashboard reachable in one click from the parked group" cannot hold as written (§3, fact 1) |
| V-9 | The sidebar test reads every `app/admin/<dir>/page.tsx` from disk and requires **exactly one** sidebar entry per page (Exchange Rates excepted), pins 22 entries, 12 parked, Monitor = `/admin`, `/admin/analytics`, `/admin/audit-trail`, and requires every parked description to contain "AgentsPilot" | `app/admin/components/__tests__/AdminSidebar.nav.test.ts:61-72, 86-104, 107-124, 128-135, 169-176` | A moved dashboard at `app/admin/platform-dashboard/page.tsx` needs one parked entry: 22 → 23, parked 12 → 13, on-disk ≥ 24 |
| V-10 | The old dashboard page is a client component calling `/api/admin/dashboard`, and it has **1 `console.error`** | `app/admin/page.tsx:91, 112` | Moving it means touching it, so it is converted to Pino (§13). `/api/admin/dashboard` is not touched (0 `console.*`) |
| V-11 | The header titles `/admin` as "Dashboard Overview" and `/admin/queues` as "Queue Monitor" (stale since Slice 1) | `app/admin/components/AdminHeader.tsx:24-29` | `/admin` → "Health"; new entry for the moved dashboard; "Queue Monitor" → "Agent execution queue" (one-word honesty fix in a file already touched) |
| V-12 | Business OS AI settings: `buildAdminSettingsView()` returns, per area, `switchable`, `configuredEnabled`, `calls[].resolved.enabled`, `calls[].issues` and `areaIssues` (rejected + adjusted). It is `server-only` and is what the Business OS AI page reads | `lib/business-os/llm/adminSettingsView.ts:120-160, 208-255, 263-321`; `app/api/admin/business-os/llm-settings/route.ts` | Tile 1 reuses it, so it cannot disagree with the page (F-5) |
| V-13 | The Business OS AI page's own "off" rule is `areaShowsOff = area.switchable && !area.configuredEnabled`, and "calls configured off" is counted **only when the area is not off**. The kill switch **fails open**, so the page says "Configured: off", never "Off" | `app/admin/business-os-llm/components/AreaCard.tsx:7-33, 98-102, 142-165` | Tile 1 uses the **same predicate** (extracted to one shared pure function) and the same "configured off" wording |
| V-14 | Issue kinds are `rejected \| locked \| unknown \| adjusted`. Everything except `adjusted` means the resolver **ignored** a stored setting; `adjusted` means it was accepted and changed by a model rule | `lib/business-os/llm/modelSettings.ts:145-160, 971-996` | Tile 1 counts `adjusted` for information only; the others can colour the tile |
| V-15 | Audited AI failures: `BUSINESS_AI_ACTION_FAILED` (severity `warning`) and `BUSINESS_AI_ACTION_COMPLETED`. A failure is audited only "after making at least one LLM call"; audit writes are batched and never awaited | `lib/audit/events.ts:133-134, 554-563`; `lib/business-os/llm/aiActionAudit.ts` | Tile 2 says "failed AI actions (audited)", not "all AI failures" |
| V-16 | **26 events carry `severity: 'critical'`**, including routine ones: `USER_PASSWORD_CHANGED`, `USER_EMAIL_CHANGED`, `AGENT_DELETED`, `DATA_EXPORTED`, `PAYMENT_REFUNDED`, `AI_PRICING_DELETED`, alongside `SECURITY_BREACH_DETECTED` / `SECURITY_UNAUTHORIZED_ACCESS` | `lib/audit/events.ts` (26 matches of `severity: 'critical'`) | "Critical" does not mean "broken". Red on any critical event would be red most days. The user chose amber, never red (U-5) |
| V-17 | The audit trail page accepts deep links for `action`, `severity`, `date_from`, `date_to`, `entity_type`, `user_id`, and shows `pagination.total` (the route's exact count) | `app/admin/audit-trail/page.tsx:88-97, 232-240, 614`; route `app/api/admin/audit-trail/route.ts:84-131` | Tiles 2 and 4 link there with the same filters, and the page's total is the tile's number |
| V-18 | The audit date filters are `datetime-local` strings with **no timezone**, passed through unchanged, so Postgres resolves them in the **session timezone** (UTC on Supabase unless changed) | `lib/audit/requestSchemas.ts:102-119`; page `:520-540` | Health links pass **UTC wall-clock minutes** (`YYYY-MM-DDTHH:mm`) that equal the instants the tile counted. Correct only if the DB timezone is UTC: owed check L-4 |
| V-19 | `audit_trail` has single-column indexes on `action`, `severity`, `created_at DESC` and `(user_id, created_at DESC)` **in the repo script**; the table was dashboard-created, so live indexes are unverified (B0 SA correction 3) | `supabase/SQL Scripts/create_audit_trail.sql:39-47` | Audit head-counts should be index-served. Owed check L-3 lists the live indexes |
| V-20 | **Cost Analytics' drill-down is capped at 1,000 rows** (unpaged, OI-P1, parked) and its "vs previous period" ignores most filters (OI-P2, parked). Under `scope=bos` the comparison read *is* BOS-scoped (Slice 2 D-5) | `lib/repositories/AdminTokenUsageAnalyticsRepository.ts:32-36, 162-200`; `app/api/admin/token-usage/drill-down/route.ts:211-250, 409-441`; Slice 2 workplan §13 | The spend tile must not reuse that read or copy its comparison (§3, facts 2-3) |
| V-21 | The "existing aggregate" reads do **not** fit a cross-account window: `business_os_usage_summary` is an RPC keyed on **one** `p_user_id`; the LLM usage report is per account, at most 7 days, paged to a 5,000 ceiling; the one existing all-accounts ledger read is `listChatCallsAllAccountsInWindow` (chat only), paged with ceiling 10,000 and a `reachedCeiling` flag. PostgREST aggregates are disabled (`PGRST123`) | `supabase/migrations/20260929_usage_summary.sql:44-80`; `lib/business-os/usage/llmUsageReport.ts:100-130`; `lib/repositories/TokenUsageRepository.ts:13-17, 118-135, 441-480` | No existing aggregate can answer "BOS spend, all accounts, last 7 days". The plan follows the chat report's proven shape: **paged narrow read + exact count + ceiling + honest "at least"** (F-1) |
| V-22 | `token_usage` has **no index usable for a cross-account window** (only `(user_id, created_at DESC)`, `(execution_id)`, `(agent_id, execution_id)` in the repo) | `20260929_usage_summary.sql:98-99`; B0 workplan V-3 (on branch `docs/ai-activity-b0-workplan`, commit `5bea0b5b`) | Every spend page is a sequential scan today. Bounded by the ceiling and the stop rule (§7) **Superseded 2026-09-26 by L-3/L-5 (§15.8): the live DB has `idx_token_usage_created_at`; the read is an index range scan (1.6 ms).** |
| V-23 | Last measured volume: **7,658** `token_usage` rows in 30 days, **3,015** Business OS (≈100/day) | Slice 2 workplan T0b | A 14-day BOS window is ≈1,400 rows today: **2 pages** of 1,000. The 7-day window (≈700) is still under Cost Analytics' 1,000 cap, so "same number" holds today and will stop holding as volume grows |
| V-24 | Cost Analytics reads `?scope` and `?user` from the URL but **not a period or a window**; its presets are 24h / 7d / 30d / 90d / Custom (date-only) | `app/admin/analytics/page.tsx:152-158, 219-243, 284-289` | For the spend tile's link to land on the same window, the page gains a `dateFrom`/`dateTo` deep link (F-8) |
| V-25 | Entitlements mode: `getEntitlementMode()` returns the **effective** mode; it downgrades a refused `enforce` to `shadow` and an unrecognised value to `off`, logging at `error`. The raw value is not exported | `lib/business-os/entitlements/mode.ts:44-89` | Tile 5 shows the effective mode. Detecting "enforce was asked for and refused" needs one small new export (F-6) |
| V-26 | Every file outside the entitlements module that imports it must be registered in `KNOWN_NON_GATE_IMPORTERS` **with the exact symbols**, or CI's "Business OS entitlements invariants" fails. That is what failed Slice 2's CI | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:195-249, 294-304`; commit `9ffdf05b` | The Health route registers `getEntitlementMode` (plus the F-6 symbol if approved). Local runs **include `lib/business-os/entitlements`** |
| V-27 | Admin cross-account repositories may be imported **only from `app/api/admin/**`** (source guards) | `AdminTokenUsageAnalyticsRepository.ts:5-34`; `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts:180-205`; `lib/repositories/__tests__/adminReadMethods.guard.test.ts:1-11` | The reads are orchestrated in the route; the colour logic is a pure function in `lib/admin/health/` that receives numbers and does no I/O |
| V-28 | Admin authz: 80 handlers over 51 files, 74 via `requireAdmin`, 6 hand-rolled. The guard counts are enforced by equality caps on the *parked* lists, not on the total | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:34-45, 249-295, 402`; `CLAUDE.md` admin row | A new handler that calls `requireAdmin` first changes no cap. The CLAUDE.md prose (80/74/6) becomes 81/75/6 and is refreshed in the docs task |
| V-29 | Crons: `vercel.json` has 15 schedules (12 BOS, 3 AgentsPilot). No run record exists anywhere a page could read. `CRON_SECRET` in production is unanswered (OQ-2) | `vercel.json`; requirement §2.3, OQ-2 | Cron and queue tiles are static "Not measured yet". Nothing is inferred |

---

## 2. Analysis Summary

| Area | What this slice touches |
|---|---|
| **Pages** | `app/admin/page.tsx` becomes Health. The old dashboard moves, unchanged apart from its one `console.error`, to `app/admin/platform-dashboard/page.tsx`. `app/admin/users/page.tsx` (Part A). `app/admin/analytics/page.tsx` gains one deep link (window) |
| **Components** | New Health tile component and page body under `app/admin/components/health/`. One pure predicate extracted from `AreaCard.tsx` so the page and the tile share it. One small user-name component for Part A |
| **API routes** | **New** `GET /api/admin/health-summary` (`requireAdmin` first, Zod, Pino + correlationId, no error detail in production). No existing route changes |
| **Repositories** | `AdminTokenUsageAnalyticsRepository`: two new admin-only, all-accounts methods (exact count; paged narrow cost read). `AuditTrailRepository`: one new admin-only, all-accounts head count |
| **Pure logic** | New `lib/admin/health/` module: the ordered rule lists held as data (`rules.ts`, U-1), the pure evaluator (first matching rule wins; no match = "Normal") and runtime-free wire types |
| **Database** | **None.** No migration, no index, no RPC in this slice (F-1 records the alternative) |
| **Entitlements** | The route imports `getEntitlementMode` (and possibly one new read-only export, F-6), registered in `enforcementPoints.test.ts` |
| **Sidebar** | "Dashboard" → "Health". New hidden parked entry for the old dashboard. Tests updated |
| **Providers / LLM** | None. No LLM call; the route imports `bosRowFilter()` from the call catalog, so it enters the `typecheck:bos-llm` and literal-gate scope (it contains no model or temperature literal) |

---

## 3. Facts That Changed Since the Requirement

### Fact 1 — the parked section is hidden, so "one click from the parked group" cannot hold

**Decision (A-2 resolved by the user, U-6, 2026-09-26): URL-only, no visible link.**

| What | Detail |
|---|---|
| Route | **`/admin/platform-dashboard`** (`app/admin/platform-dashboard/page.tsx`). The old page's code moves there verbatim, except the `console.error` → Pino conversion (§13). `/api/admin/dashboard` is untouched |
| Sidebar | One new entry in the **hidden** parked section: name "Platform dashboard (legacy)", description "AgentsPilot totals (old landing)" (contains "AgentsPilot", as the test requires). The section stays `hidden: true`, so the entry is **not rendered**. Every admin page still has exactly one sidebar entry in the data |
| Reach | **By URL only.** The Health page has **no** link to it, and nothing else in the product links to it. The user will decide later whether the old dashboard is used at all |
| Header | `AdminHeader` titles the new route "Platform dashboard (legacy)" (it shows only if someone opens the URL) |
| Acceptance criterion | The requirement's "old dashboard reachable in one click from the parked group" is **replaced** by "the old dashboard still loads at `/admin/platform-dashboard`, with its code intact, and has one entry in the hidden parked section". BA amends §7 Slice 4 via TL (T14) |

Sidebar test updates (`AdminSidebar.nav.test.ts`):
- Monitor stays `['/admin', '/admin/analytics', '/admin/audit-trail']`, and the `/admin` item's name becomes "Health".
- **23** entries in total (was 22), **13** parked (was 12). Both "twelve" assertions and the "23 pages today" comment move together (SA spot check); the on-disk scan floor goes 23 → 24.
- A new assertion that `/admin/platform-dashboard` is in the parked section.
- The existing "only the parked section carries `hidden: true`" assertion stays, so all 13 parked entries, the dashboard included, are hidden.
- A new Health source guard (§12.3) asserts that the Health page and its components contain **no** `platform-dashboard` link.

### Fact 2 — OI-P1 (the 1,000-row cutoff) is parked, so the spend tile cannot reuse Cost Analytics' read

- The spend tile does **not** call the drill-down route or `listRowsAllAccountsInWindow`.
- It uses a **new paged read of three narrow columns** (`id, created_at, cost_usd`) plus an **exact head count** over the same filter and a **fixed** window (§6, tile 3). Exactness is decided **per sub-window** (C-1): a figure is exact when the read completed naturally, or when the oldest row read is strictly older than that sub-window's start. Otherwise it shows **"at least $X"**, and the spend tile's lower-bound rule makes the tile amber, never neutral.
- **"Links to a page that shows the same number"**: the link opens Cost Analytics with Business OS only and the **exact same window** (F-8). Below 1,000 calls in the window the page shows the same figure. Above 1,000 it cannot, because of OI-P1. The tile then says so in words: *"AI cost & usage reads at most 1,000 calls per period (known issue OI-P1), so it will show less than this."* The tile knows the count, so this note appears exactly when it applies.
- I checked what `lib/business-os/usage` and the LLM usage report use (V-21). The only aggregate is per-account (`business_os_usage_summary`), and the report pages one account. Neither can answer a cross-account window without a new database function. That is F-1(b), held for SA.

### Fact 3 — OI-P2 ("vs previous period" ignores filters) is parked, so the comparison is not copied

The tile computes current and previous from **one** read that spans both periods with **one** filter (`bosRowFilter()`), so both halves are filtered identically by construction. Nothing from the drill-down's comparison code is used. The tile shows "vs previous 24 h" and "vs previous 7 days" as its own numbers. Its link carries no promise about Cost Analytics' "vs previous period" percentage. The tile's footnote says the comparison there is computed differently (OI-P2).

### Fact 4 — no index on `token_usage` for cross-account windows (B0 V-3)

See §7: what is measured, where, the budget, the stop rule, and what happens if it is slow. No production query is run by Dev. Live numbers are checks owed by the user (§7.3).

### Fact 5 — cron health (OQ-2 open with Offir)

Two static tiles, **"Scheduled jobs"** and **"Queues"**, status `not_measured`: grey, dashed border, the words "Not measured yet", and one line explaining that job runs and queue depth are not recorded anywhere yet (roadmap R-2). They have no link, and say so ("No page yet: planned as R-2"). Their rule lists are **empty by design** (§6.2), and the evaluator has no input for them, so no code path can colour them. A test pins that. Documented link exceptions: (1) these two tiles; (2) the entitlements tile's "requested but refused" reason, whose linked page shows only the effective mode (C-8). The reason text says the requested value lives in `BOS_ENTITLEMENTS_MODE` on Vercel and in the `error` log.

---

## 4. Part A: Businesses-Screen Fixes

All UI-only. **No route change.**

### A-1 — Status filter defaults to Active users

- `app/admin/users/page.tsx:152`: initial state `'active'` instead of `'all'`. The select's option labels are unchanged ("All Users", "Active (30 days)", "Inactive (30+ days)"). The `as any` cast on the select (`:510`) is replaced with a typed guard (CLAUDE.md rule 6: the file is touched).
- **What the list route receives changes:** the first request now carries `status=active` instead of `status=all`. The route already supports it (`route.ts:46, 195-196`) and its own default stays `all`, so other callers are unaffected.

### A-2 — Searching while the filter is Active

**Decided (U-4):** a search does **not** silently widen to everyone. With Active as the default, searching for a business that has not signed in for 30 days returns nothing, which is exactly the "a business complains" case. So: when a search is active, the filter is not "All", and the result is empty, the empty state says "No match among active users" (or "…inactive users") and offers a one-click **"Search all users"** button that sets the filter to All and re-runs the same search. Nothing changes until the admin clicks.

### A-3 — The "total" labels under the new default

`stats.totalUsers` is the filtered count (V-3). Under Active it would read the same as "Active Users" and be mislabelled. **UI-only, in both places (C-15 (a)):**
- the stat card (`:469-471`): its label follows the filter ("All users", "Users shown (active)", "Users shown (inactive)");
- the header pill (`:438`, "`{stats.totalUsers} total`"): it reads "`N shown`" unless the filter is All.

The route's `stats` is not changed. Also in this touched file (C-15 (b)): `logger.debug({ result }, 'Admin users raw response')` (`:205`) logs every login's name and email from the browser, so it is replaced with counts only.

### A-4 — Row layout: name, status badge, no name

**Decided (U-3):**

- **Definition:** a login has no name when `full_name` is `null`, `''` or whitespace-only. One pure helper, `hasPersonName(fullName)`, lives in a client-safe file, is used by the row, and is tested.
- **Name line (`page.tsx:664-673`):**
  - **With a name:** the name, then the **Active/Inactive status badge moved here** from the Status column. The badge keeps its existing classes and icons.
  - **No name:** visible red text "No name", followed by a visually hidden " — needs attention" in the same container; the red `AlertCircle` is `aria-hidden`. This follows C-16: not `title`-only, and not `role="img"` plus visible text. The status badge follows, as on every row. **No green mark sits beside a no-name.**
  - `data-testid="row-user"` stays on the name **text** only (C-15 (c)).
- **Email line:** the "Email verified" tick moves here, beside the email, on **every** row (U-3 (c)). It gets an accessible name via visually hidden "Email verified" text, replacing today's `title`-only `span` (C-16).
- **Status column:** it keeps the role badge (`authenticated`, etc.), which is the column's other content today (`:716-721`). The Active/Inactive badge leaves it. The column heading stays "Status". Whether the column should go or be renamed once only the role remains is a visual choice, recorded for the user's diff review, not decided here.
- **Business fallbacks are untouched (V-7):** "No Business OS business", "Unnamed business" and "Business unknown" stay muted grey. A business with no name is a different state, and whether the person has a name has nothing to do with it.
- The row's search, sort and data are unchanged. Nothing new is fetched.
- **Follow-up, not in this PR (U-3 (b)):** signup never saves a name, so every login that never saved its profile will show red. Saving the Google display name at signup (or exposing it in the list) is **FU-1**, recorded in §9.

The name line moves into a small component, `app/admin/users/components/UserNameLine.tsx`, so it can be render-tested without mounting the 1,279-line page. It renders the name (or "No name"), the status badge, and the email line with the verified tick.

---

## 5. Part B: Health Landing

### 5.1 Shape

```
/admin (client page, inherits requireAdminPage from app/admin/layout.tsx)
  └── GET /api/admin/health-summary (requireAdmin FIRST → Zod → reads in parallel → pure evaluator → JSON)
        ├── buildAdminSettingsView()                          → tile 1
        ├── auditTrailRepository.countAdminEventsAllAccountsInWindow(...) ×6 → tiles 2, 4
        ├── adminTokenUsageAnalyticsRepository.countAllAccountsInWindow(...) → tile 3 (completeness)
        ├── adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(...) → tile 3
        └── getEntitlementModeSetting()                       → tile 5 (F-6 (b), C-8)
  pure: route builds HealthInputs → evaluateHealth(inputs, HEALTH_RULES) → HealthTile[]
  tiles 6, 7: static "Not measured yet" (no input, empty rule list)
```

- **One route, per-read isolation.** `Promise.allSettled`. A failed or timed-out read makes **its tile** `unavailable` ("Could not check just now"), grey, with no error text. It never makes a tile neutral and never fails the page. Each read gets a timeout (proposed 5 s, F-4) so one slow read cannot hold the page past the budget.
- **Windows are fixed per request (C-3).** `end` = now, floored to the minute (UTC), computed **once in the route** and passed in; the evaluator never calls `Date.now()`. The current windows are 24 h = `[end − 24 h, end]` and 7 d = `[end − 7 d, end]`, inclusive on both ends to match the linked pages' `.gte/.lte`. The previous periods are `[prevStart, start)`, so a row on the boundary is counted once. Every link carries the current window's exact bounds, so the linked page counts the same rows (except rows written with a back-dated `created_at`, which should not exist).
- **Response shape** (runtime-free types in `lib/admin/health/healthTypes.ts`, imported with `import type` by the page):

```typescript
type TileStatus = 'red' | 'amber' | 'neutral' | 'not_measured' | 'unavailable'; // no 'green', by type

interface HealthFigure {
  label: string;          // e.g. "Last 24 h"
  value: string;          // formatted on the server, e.g. "$3.41" or "at least $12.10"
  exact: boolean;         // false = a lower bound; the page never drops the "at least"
  href: string | null;    // the page that shows the same number
  note: string | null;    // e.g. the OI-P1 sentence when calls > 1,000
}

interface HealthTile {
  id: 'bos_ai_settings' | 'bos_ai_failures' | 'bos_ai_spend' | 'critical_audit'
    | 'entitlements_mode' | 'scheduled_jobs' | 'queues';
  title: string;
  status: TileStatus;
  /** The matching rule's description; "Normal" when none matched; fixed text for not_measured / unavailable. */
  headline: string;
  /** Id of the rule that matched, or null (none matched / not evaluated). For tests and the log. */
  matchedRuleId: string | null;
  figures: HealthFigure[];
  /** The tile's rule list, in order, rendered as "How this tile is coloured" (built from the config). */
  rules: Array<{ colour: 'red' | 'amber'; description: string }>;
}

interface HealthSummary {
  generatedAt: string;
  windows: { end: string; last24hStart: string; last7dStart: string; previous7dStart: string };
  tiles: HealthTile[];
}
```

- **The page:**
  - Title "Health", with one line: "Is anything wrong in Business OS? Red needs action, amber needs a look, grey is normal or not measured. Nothing here is ever green."
  - A grid of tiles, reusing the existing card classes (`bg-slate-800 border rounded-xl p-5`, as on the Businesses stat cards) and `lucide-react` icons. No new UI library.
  - Each tile shows its **headline** (the matching rule's description, or "Normal"), its figures, and a collapsed "How this tile is coloured" list of its rules in order.
  - Colour by status:
    - red: `border-red-500/40` + `text-red-300`, label "Needs action";
    - amber: `border-amber-500/40` + `text-amber-300`, label "Needs a look";
    - neutral: `border-slate-700` + `text-slate-300`, label "Normal";
    - not measured: `border-dashed border-slate-600` + `text-slate-400`, label "Not measured yet";
    - unavailable: `border-slate-600`, label "Could not check".
  - An "As of HH:mm UTC" line with the window bounds (SA optimisation note), and a Refresh button: `cache: 'no-store'` with no cache-busting parameter (F-9), `aria-busy` while loading. There is no auto-refresh, which would multiply load.
  - **No link to the legacy dashboard** (U-6).
- **No owner text anywhere.** The tiles carry counts, sums, area names (platform labels), the mode word and fixed sentences. The audit reads are head counts, so no `details` is read at all.
- **Money:** every spend figure is labelled "USD (estimated)" and is `cost_usd` from the ledger (pricing-table USD). Nothing touches a business currency.

### 5.2 The new route

**File:** `app/api/admin/health-summary/route.ts`

1. `const gate = await requireAdmin(requestLogger)` is the **first statement**, as the guard requires.
2. Zod: `HealthSummaryQuerySchema = z.object({}).strict()` over `Object.fromEntries(searchParams)`. An unknown parameter returns 400 with a fixed message, and details only in development. (The route takes no input; strict parsing means no hidden parameter can ever start to mean something, F-9.)
3. Reads in parallel with timeouts, then the pure evaluator.
4. One `info` log line: `{ adminUserId, totalMs, reads: [{ read, ms, ok, rows?, pages? }] }`. No values from rows, no names.
5. Response: `{ success: true, data: HealthSummary }`. An unexpected throw returns 500 `{ success: false, error: 'Could not build the health summary' }`, with `details` only when `NODE_ENV === 'development'`.
6. `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';` (as the sibling admin routes).

---

## 6. Tiles: Data Sources, Exact Reads and Rule Lists

**Design decided by the user (U-1, 2026-09-26): ordered rule lists, held as data.** This replaces the first version's fixed amber/red columns.

### 6.1 How a tile is coloured

- Each tile has an **ordered list of rules**. A rule has an `id`, a `priority`, a `condition`, a `colour` (`'red' | 'amber'` only) and a short plain-English `description`.
- Rules are evaluated **top to bottom** (ascending `priority`). The **first** rule that matches sets the tile's colour, and **its description is the tile's headline**.
- If **no rule matches**, the tile is grey `neutral` with the headline **"Normal"**.
- If the tile's input read failed, no rule is evaluated: the tile is `unavailable` ("Could not check just now"). A failed read is never "Normal".
- The scheduled-jobs and queues tiles have **no rules** and are always `not_measured`.
- **No green state exists** (C-10): `TileStatus` has no `'green'` member, and a rule's `colour` type admits only `'red' | 'amber'`.

**Where the rules live:** `lib/admin/health/rules.ts`. It exports one constant, `HEALTH_RULES: Record<MeasuredTileId, readonly HealthRule[]>`, as plain data. It replaces the first version's `thresholds.ts` (C-11 now applies to `rules.ts`, see below).

**Condition kinds**: a small closed union, interpreted by the pure evaluator (C-6):

```typescript
// lib/admin/health/rules.ts (shape; values in §6.2)

/** One number the route measured. `exact: false` = a lower bound (C-1). */
type MetricId =
  | 'spend24h' | 'spendPrev24h' | 'spend7d' | 'spendPrev7d'
  | 'failed24h' | 'completed24h'
  | 'critical24h'
  | 'settingsIgnored' | 'settingsOff'; // settingsOff = areas off + calls off (areaOffSummary)

type FlagId = 'entitlementEnforceRefused';

type HealthCondition =
  /** metric >= value. MAY fire on a lower bound: "at least $25" >= $20 is true (C-2). */
  | { kind: 'atLeast'; metric: MetricId; value: number }
  /** metric >= factor x baseline AND metric >= floor. Fires ONLY when BOTH operands are exact (C-2).
   *  baseline = 0 and metric > 0 counts as an unbounded ratio, so only the floor decides ("new spend"). */
  | { kind: 'ratioAtLeast'; metric: MetricId; baseline: MetricId; factor: number; floor: number }
  /** numerator / (numerator + other) >= rate, only when (numerator + other) >= minTotal. Exact operands only. */
  | { kind: 'shareAtLeast'; numerator: MetricId; other: MetricId; rate: number; minTotal: number }
  /** any listed metric is a lower bound */
  | { kind: 'anyLowerBound'; metrics: readonly MetricId[] }
  | { kind: 'flag'; flag: FlagId };

interface HealthRule {
  id: string;             // stable, e.g. 'spend.ceiling24h'
  priority: number;       // unique within a tile; list order must equal priority order (tested)
  colour: 'red' | 'amber';
  description: string;    // shown on the tile when this rule is first to match
  condition: HealthCondition;
}
```

**C-2 is built into the condition kinds, not left to each rule's author:**
- `ratioAtLeast` and `shareAtLeast` evaluate to *no match* unless every operand is exact.
- `atLeast` may fire on a lower bound, because a lower bound above the value proves the value is exceeded. A lower bound *below* the value does not match, since it proves nothing.
- The spend tile's last rule, `anyLowerBound`, then catches every case where a ratio could not be evaluated. That is SA's C-2 fallback ("the tile gets the lower-bound amber reason instead"), expressed as data.
- A figure that is a lower bound never prints a "vs previous" multiple.

**What is a data edit, and what is not (C-11 as it now applies):**
- **A data edit, no SA re-review:** changing a value, factor, floor, colour, description or order, or adding a rule that uses an existing condition kind and existing metrics. Tests read `HEALTH_RULES`; they do not repeat its literals.
- **Code, and SA re-review:** a new condition kind, a new metric (it needs a new read) or a new flag. The user's "only security alarms red" idea (Q-5, not in this PR) is of this kind.

### 6.2 The tiles, their reads and their starting rules

The starting rules are the user's (U-1), and "we can change later". All amounts are USD, estimated.

**Tile 1 — Business OS AI settings**
- **Read:** `buildAdminSettingsView()` (8 `system_settings_config` rows plus active admins, then the pure resolver).
  - The route reduces it to numbers with the shared `areaOffSummary()`: areas off, calls off (counted only when their area is not off), settings ignored (issues with kind ≠ `adjusted`) and adjusted.
  - Area labels travel with the numbers. No email and no `lastChangedBy` leaves the route (C-7).
- **Figures (each links to `/admin/business-os-llm`):**
  - "Areas configured off: N (names)"
  - "Calls configured off: N"
  - "Settings not being applied: N"
  - "Adjusted by a model rule: N" (information only)
- **Rules (first match wins):**
  1. amber · `atLeast settingsIgnored 1` · "A setting isn't being applied"
  2. amber · `atLeast settingsOff 1` · "AI switched off somewhere"
- **No match:** Normal.

**Tile 2 — Failed AI actions (audited)**
- **Read:** 4 head counts on `audit_trail`, all accounts: `BUSINESS_AI_ACTION_FAILED` and `BUSINESS_AI_ACTION_COMPLETED`, each over 24 h and 7 d. Audit counts are always exact.
- **Figures:**
  - "Failed, last 24 h: N of M actions" → `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&date_from=<24h start>&date_to=<end>`
  - "Failed, last 7 days: N" → the same link with the 7-day start
- **Rules:**
  1. red · `atLeast failed24h 5` · "5+ AI failures in the last 24 hours"
  2. red · `shareAtLeast failed24h / (failed24h + completed24h) ≥ 0.20, minTotal 10` · "1 in 5 AI actions failing"
  3. amber · `atLeast failed24h 1` · "AI failures in the last 24 hours"
- **No match:** Normal. The 7-day figure is context only.

**Tile 3 — Business OS AI spend**
- **Read:**
  - (a) An exact head count of BOS rows over the 14 days `[previous7dStart, end]`.
  - (b) A paged read of `id, created_at, cost_usd` over the same filter (`bosRowFilter()`) and window: ordered `created_at DESC, id DESC`, 1,000 rows a page, **ceiling 10,000**, de-duplicated by `id`, with the deadline checked between pages (C-4).
  - Sums per sub-window, with exactness per sub-window (C-1).
- **Figures:**
  - "Last 24 h: $X (previous 24 h: $Y)" and "Last 7 days: $X (previous 7 days: $Y)", each → `/admin/analytics?scope=bos&dateFrom=<ISO>&dateTo=<ISO>` (C-9).
  - A lower bound shows "at least $X".
  - The OI-P1 note appears when a window's calls exceed 1,000, and only while the count is known (C-4).
- **Rules:**
  1. red · `atLeast spend24h 20` · "Over $20 in the last 24 hours"
  2. red · `ratioAtLeast spend24h vs spendPrev24h ×3, floor 5` · "Spend tripled vs yesterday"
  3. amber · `ratioAtLeast spend24h vs spendPrev24h ×2, floor 1` · "Spend doubled vs yesterday"
  4. amber · `ratioAtLeast spend7d vs spendPrev7d ×1.5, floor 5` · "Week up 50% or more"
  5. amber · `anyLowerBound [spend24h, spendPrev24h, spend7d, spendPrev7d]` · "Total is a minimum; not all calls counted"
- **No match:** Normal.

**Tile 4 — Critical audit events (all products)**
- **Read:** 2 head counts on `audit_trail`, `severity = 'critical'`, over 24 h and 7 d.
- **Figures:** "Last 24 h: N" → `/admin/audit-trail?severity=critical&date_from=…&date_to=…`, and "Last 7 days: N" with the same link shape.
- **Rules:**
  1. amber · `atLeast critical24h 1` · "Critical events in the last 24 hours"
- **Never red** (U-5).
- **No match:** Normal.

**Tile 5 — Entitlements mode**
- **Read:** `getEntitlementModeSetting()` (C-8): the effective mode plus `refused`. The raw environment string never leaves `mode.ts`.
- **Figure:** "Mode: Off / Shadow / Enforce" with its one-line meaning → `/admin/business-os-tiers`.
- **Rules:**
  1. amber · `flag entitlementEnforceRefused` · "Enforcement requested but not active"
- **No match:** Normal, and the figure shows the mode (Off / Shadow / Enforce).
- The refused reason names `BOS_ENTITLEMENTS_MODE` on Vercel and the `error` log, because the linked page shows only the effective mode (C-8, a documented link exception).
- An unrecognised value is effective `off`. The first version proposed amber for it. That is **not** in the user's starting rules, so it is recorded as a candidate rule (`flag entitlementModeUnrecognised`, a code change) rather than added.

**Tile 6 — Scheduled jobs**
- **Read:** none.
- **Figure:** "Not measured yet. Job runs are not recorded anywhere yet (roadmap R-2)", with no link ("No page yet").
- **Rules:** none, by design. The status is always `not_measured`.

**Tile 7 — Queues** (payment reminders, automations)
- The same as tile 6.

**Every measured tile, on a failed read:** `unavailable`, with the fixed text "Could not check just now". Rules are not evaluated, and there is no error text (C-7).

**Accessibility (C-16):**
- Every status has its text label ("Needs action", "Needs a look", "Normal", "Not measured yet", "Could not check"), and icons are `aria-hidden`.
- Each figure link has a descriptive accessible name ("Failed AI actions, last 24 hours: 3, open in audit trail").
- Each tile is a `section` with `aria-labelledby`.

### 6.3 The evaluator

**File:** `lib/admin/health/evaluateHealth.ts`. It is pure (C-6): no I/O, no `Date.now()`, no import from `app/**`, no server-only module, and it never names `AdminTokenUsageAnalyticsRepository`.

```typescript
interface Metric { value: number; exact: boolean }

interface HealthInputs {
  windows: HealthWindows;                  // computed once in the route (C-3)
  settings: { ok: true; metrics: {...}; offAreaLabels: string[] } | { ok: false };
  failures: { ok: true; failed24h: number; failed7d: number; completed24h: number } | { ok: false };
  spend:    { ok: true; spend24h: Metric; spendPrev24h: Metric; spend7d: Metric; spendPrev7d: Metric;
              calls: { last24h: number; last7d: number } | null /* null when only the count failed (C-4) */ }
          | { ok: false };
  critical: { ok: true; last24h: number; last7d: number } | { ok: false };
  entitlements: { ok: true; effective: 'off' | 'shadow' | 'enforce'; refused: boolean } | { ok: false };
}

export function evaluateHealth(inputs: HealthInputs, rules = HEALTH_RULES): HealthTile[];
/** First match, in priority order; null = Normal. Exported for the tests. */
export function firstMatchingRule(rules: readonly HealthRule[], metrics: MetricValues, flags: FlagValues): HealthRule | null;
```

- The route turns the raw reads into `HealthInputs`. It sums spend per sub-window and applies C-1 exactness. The evaluator only reads numbers and flags.
- `rules` is a parameter (defaulting to `HEALTH_RULES`), so tests can prove first-match ordering with small synthetic lists. They do not depend on the starting values.
- `firstMatchingRule` sorts nothing. It asserts, and the config test pins, that each list is already in ascending unique `priority` order, so "top to bottom" in the file is exactly the evaluation order.

---

## 7. Performance: Measuring Against the §9 Budget

### 7.1 Budget

| Item | Budget (proposed) | Basis |
|---|---|---|
| Page usable | ≤ ~3 s at current volume | Requirement §9 |
| `GET /api/admin/health-summary` server time | ≤ 1.5 s p50, ≤ 3 s worst | Leaves room for cold start and render |
| Spend read (count + pages) | ≤ 1 s, ≤ 3 pages at today's volume | Two pages expected (≈1,400 rows, V-23) |
| Any single read | 5 s timeout, then that tile shows `unavailable` | F-4 |

### 7.2 How it is measured (no production query by Dev)

1. **Instrumentation in the route:** one Pino `info` line with the correlationId, carrying per-read `ms`, `rows`, `pages`, which reads failed (as an error class or code, never a message, C-7) and `totalMs`. It is permanent: it is also how growth becomes visible later.
2. **Locally:** route tests only (mocked). **No timing claim is made from a local run.** Timings against mocks mean nothing, and running against the shared database would be a production query.
3. **Owed by the user:** L-2 to L-6 **before merge**, L-1 after deploy (§7.3, C-14). QA records all of them in its report.

### 7.3 Live checks owed by the user (read-only SQL; Dev runs none of them)

**Pre-merge gate (C-14): L-2 to L-6 must be recorded before the PR is merged.** No deploy is needed for them.

| # | When | Check | How | Pass |
|---|---|---|---|---|
| L-1 | After deploy | Health route timing | Open `/admin` 3 times (one cold). DevTools → Network → `health-summary`, or the Vercel log line `Health summary served` → `totalMs` and per-read `ms` | p50 ≤ 1.5 s, and no read > 1 s except on a cold start. A miss triggers §7.4 step 1 (pre-approved UI-only split) |
| L-2 | **Before merge** | BOS rows in the 14-day window | `SELECT count(*) FROM token_usage WHERE created_at >= now() - interval '14 days' AND (feature LIKE 'business-os%' OR feature IN ('insight-generation','correlated-insight-generation','health-summary-generation','landing-page-generation','lead-reply'));` | ≤ 10,000 (the ceiling). Record the number |
| L-3 | **Before merge** | Live indexes | `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename IN ('token_usage','audit_trail') ORDER BY 1,2;` Record the result; do not assert a count (B0 SA correction 3) | Recorded. Nothing is added in this slice |
| L-4 | **Before merge** | Database timezone | `SHOW timezone;` | `UTC`. Otherwise the audit links (offsetless, V-18) change before merge |
| L-5 | **Before merge** | Spend read plan | `EXPLAIN (ANALYZE, BUFFERS) SELECT id, created_at, cost_usd FROM token_usage WHERE created_at >= now() - interval '14 days' AND created_at <= now() AND (…same filter…) ORDER BY created_at DESC, id DESC LIMIT 1000;` | Execution ≤ ~1 s per page. A miss escalates §7.4 **before** merge |
| L-6 | **Before merge** | Whole-table size (a scan costs the whole table, not the window) | `SELECT count(*) FROM token_usage;` and `SELECT pg_size_pretty(pg_total_relation_size('token_usage'));` | Recorded, and read together with L-5 |

### 7.4 Stop rule and what to do if it is slow

Same discipline as Slice 2's C-2: **do not raise the ceiling.** If L-1 misses the budget, or L-2 exceeds 10,000, or any single spend page takes more than about 1 s:

1. **First, UI-only:** split the spend tile into its own request, so the other six tiles render immediately and spend fills in when ready. No data change.
2. **Then the real fix:** B0's index on `token_usage (created_at DESC, feature, user_id, session_id)`, built `CONCURRENTLY` in its own file (already designed in the B0 workplan §E), which turns the window into an index range scan.
3. **If still slow, or once volume passes the ceiling:** a service-role-only SQL function that returns the four sums in one round trip (F-1 (b)), invoker rights, `REVOKE`d from `anon`/`authenticated`, in the `20260929_usage_summary.sql` house style. That is a migration and needs SA approval plus the user applying it by hand.

Until then, a window that reaches the ceiling shows "at least $X" and amber. It is never silently exact.

---

## 8. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/users/page.tsx` | modify | A-1: default `'active'`, and a narrowing function replaces `as any` (C-15 (d)). A-2: the "Search all users" empty state. A-3: both "total" labels follow the filter (C-15 (a)). C-15 (b): the raw-response debug log is reduced to counts. A-4: the row uses `UserNameLine`; the Active/Inactive badge leaves the Status column |
| `app/admin/users/components/UserNameLine.tsx` | create | Name (or red "No name" + visually hidden "needs attention", icon `aria-hidden`), then the Active/Inactive badge; the email line carries the verified tick with a visually hidden "Email verified" (C-16). `data-testid="row-user"` on the name text only (C-15 (c)) |
| `app/admin/users/userName.ts` | create | `hasPersonName(fullName)` (null / empty / whitespace), client-safe and pure |
| `app/admin/users/__tests__/userNameLine.render.test.tsx` | create | jsdom: named vs null / '' / '   '; no green class on a no-name line; accessible text present and the icon hidden; the status badge beside the name; the verified tick's accessible name beside the email; business fallbacks unaffected |
| `app/admin/users/__tests__/defaultFilter.render.test.tsx` | create | The first fetch carries `status=active`; an empty search under Active shows "Search all users", and clicking it refetches with `status=all` and the same search; the card and pill labels follow the filter; no search widens without the click |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | Add the two new files to `SCREEN_FILES` (no server module imports) |
| `app/admin/page.tsx` | **replace** | The Health page (client). Fetches `/api/admin/health-summary` with `cache: 'no-store'`. **No link to the legacy dashboard** (U-6) |
| `app/admin/platform-dashboard/page.tsx` | create (moved content) | The old dashboard verbatim, with `console.error` → `createLogger` (§13). Reachable by URL only |
| `app/admin/components/health/HealthTile.tsx` | create | One tile: status → classes and text label; headline (the matching rule's description, or "Normal"); figures with descriptive link names; the collapsed "How this tile is coloured" list; never green |
| `app/admin/components/health/HealthGrid.tsx` | create | The tile grid, loading / error / as-of with the window bounds / Refresh (`aria-busy`) |
| `app/admin/components/AdminSidebar.tsx` | modify | The `/admin` item becomes "Health", described "Is anything wrong? Business OS" (no "OK", C-16). A new entry in the hidden parked section, "Platform dashboard (legacy)" → `/admin/platform-dashboard`. Header comment updated |
| `app/admin/components/AdminHeader.tsx` | modify | Titles: `/admin` → "Health"; `/admin/platform-dashboard` → "Platform dashboard (legacy)"; `/admin/queues` → "Agent execution queue" |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | **23** entries, **13** parked (both "twelve" assertions and the "23 pages" comment), scan floor 24; the Monitor item is named "Health"; the dashboard is in the parked section; still exactly one `hidden: true`, so all 13 parked entries are hidden |
| `app/admin/__tests__/health.render.test.tsx` | create | jsdom, from a fixture: the headline per status; `not_measured` / `unavailable` / `neutral` class sets differ (C-10); not-measured tiles have no anchor; "at least" kept; descriptive link names; `aria-busy` on Refresh |
| `app/admin/__tests__/health.source.guard.test.ts` | create | The Health page and `app/admin/components/health/**` import no `lib/business-os`, repository, `callCatalog` or `server-only` module; contain no `/\bOK\b/`, no `green-`/`emerald-` class, and **no `platform-dashboard` link** (U-6). Scoped to those files only, so the moved legacy page keeps its green classes (C-10) |
| `app/admin/business-os-llm/areaState.ts` | create | `areaOffSummary(area)` → `{ areaShowsOff, offCalls }`, the one copy of the AreaCard rule. Structurally typed, no `'use client'`, no `@/lib/` import, no `adminSettingsView` import (C-6) |
| `app/admin/business-os-llm/components/AreaCard.tsx` | modify | Uses `areaOffSummary` instead of its inline copy. Existing render tests pass **unedited** |
| `app/admin/analytics/page.tsx` | modify | The `dateFrom`/`dateTo` deep link, and nothing more (C-9) |
| `app/admin/analytics/__tests__/linkedWindow.render.test.tsx` | create | The first request carries the linked bounds verbatim with `scope=bos`; one missing, offset-less or reversed bound → both ignored; a preset change clears the chip. `scope.render.test.tsx` passes unedited |
| `app/api/admin/health-summary/route.ts` | create | The route (§5.2): builds `HealthInputs`, applying C-1 exactness and the C-3 intervals, then calls the evaluator |
| `app/api/admin/health-summary/__tests__/route.test.ts` | create | §12.2 |
| `lib/admin/health/healthTypes.ts` | create | Runtime-free wire types (`export type` only) |
| `lib/admin/health/rules.ts` | create | **`HEALTH_RULES`**: the ordered rule lists as data (§6.1-6.2), plus the rule and condition types. Replaces the first version's `thresholds.ts` |
| `lib/admin/health/evaluateHealth.ts` | create | Pure: `HealthInputs` + rules → `HealthTile[]`; `firstMatchingRule`; condition interpreter (C-2 inside `ratioAtLeast` / `shareAtLeast`); link builders; notes |
| `lib/admin/health/__tests__/evaluateHealth.test.ts` | create | §12.1 (evaluator) |
| `lib/admin/health/__tests__/rules.config.test.ts` | create | §12.1 (config invariants) |
| `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` | modify | `countAllAccountsInWindow` and `listCostPointsAllAccountsInWindow` (columns `id, created_at, cost_usd`; paged, ordered, de-duplicated, `reachedCeiling`, deadline between pages, `.abortSignal()` where supported, C-4); `ADMIN_ANALYTICS_COLUMNS.cost`; `ADMIN_HEALTH_READ_LIMITS = { PAGE_SIZE: 1000, CEILING: 10000 }`; the header now names two callers (F-2) |
| `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts` | modify | Column allow-list, filter marshalling, paging stop at ceiling, de-dup, deadline stop, error → `{ data: null, error }`, context required |
| `lib/repositories/AuditTrailRepository.ts` | modify | `countAdminEventsAllAccountsInWindow(context, { action?, severity? }, window)` (C-5); the header states it is the second admin exception and **the first unscoped read** |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | modify | Added to `ADMIN_METHODS`; pins `head: true`, `select('id')`, filters, window, and that only `app/api/admin/**` calls it |
| `lib/business-os/entitlements/mode.ts` | modify | F-6 (b) approved: one internal parser; `getEntitlementMode()` unchanged in behaviour and logs; `getEntitlementModeSetting()` → `{ effective, requested, refused }`, never the raw string, no logging (C-8) |
| `lib/business-os/entitlements/__tests__/mode.test.ts` | modify | Existing cases unchanged; a table-driven equivalence test (C-8) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | `KNOWN_NON_GATE_IMPORTERS` entry for `app/api/admin/health-summary/route.ts`, symbols `['getEntitlementMode', 'getEntitlementModeSetting']`, or only the second if the route does not import the first (the list must equal the imports exactly) |
| `CLAUDE.md`, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify (docs) | C-13: register row 81, re-measured handler and page counts, Change History |
| `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` | modify (BA, via TL) | Slice 4 acceptance: the legacy dashboard is URL-only, with a hidden parked entry (U-6); the link exceptions (cron tiles, the entitlements "refused" reason); the rule-list design (U-1); change history |

**Not changed:**
- `app/api/admin/users/route.ts`, `app/api/admin/dashboard/route.ts`, `app/api/admin/token-usage/drill-down/route.ts`, `app/api/admin/audit-trail/route.ts`.
- `TokenUsageRepository.ts`: its contract test pins its surface.
- Any migration.

---

## 9. User Decisions (U-1 to U-6)

The user's answers of 2026-09-26 to the first version's Q-1 to Q-6. These decisions are binding.

| # | Question | Decision | Where it lands |
|---|---|---|---|
| **U-1** | Q-1 alarm levels | **A new design:** each tile has an ordered list of rules (priority, condition, red or amber colour, plain-English description), held as data in one module. The first match sets the colour and the headline; no match gives grey "Normal". There is still no green. Ratio rules need exact operands (C-2); absolute floors may fire on a lower bound. The starting rules are in §6.2, and "we can change later" | §6, §8 (`rules.ts`), §12.1 |
| **U-2** | Q-2 tiles | Keep the entitlements tile for now. The seven tiles stay | §6.2 tile 5 |
| **U-3** | Q-3 the name mark | (a)/(c) The verified tick moves beside the email, on every row. **Also:** the Active/Inactive badge moves next to the name. A no-name user shows a red "No name — needs attention", with the C-16 accessibility treatment. (b) Saving the Google name at signup is **not** in this PR (FU-1) | §4 A-4 |
| **U-4** | Q-4 searching under Active | When a search under Active (or Inactive) finds nothing, show a one-click "Search all users" button. **Never widen silently** | §4 A-2 |
| **U-5** | Q-5 critical events | Any critical event → amber, **never red**. "Security-only red" is not in this PR | §6.2 tile 4 |
| **U-6** | Q-6 the old dashboard | **Changed:** no link on the Health page. The old dashboard moves to `/admin/platform-dashboard` and is kept only as a hidden entry in the hidden parked AgentsPilot section. It is reachable by URL, with no visible link anywhere. The user decides later whether it is used. Sidebar tests: 23 entries, 13 parked, all hidden | §3 fact 1, §8, §12.3 |

**The user's last three choices (2026-09-26, after SA's code review and QA):**

| # | Question | Decision | Where it lands |
|---|---|---|---|
| **U-7** | C-17: the Active badge colour | **`'neutral'`** (option a): the Active badge is never green, anywhere. The **email-verified tick stays green**, which the user chose explicitly. The other modes stay as options; a test pins `'neutral'` | `app/admin/users/userName.ts`, `UserNameLine.tsx`; B-2 re-worded |
| **U-8** | The rule wording | "today" → **"in the last 24 hours"** in every rule description: "5+ AI failures in the last 24 hours", "AI failures in the last 24 hours", "Critical events in the last 24 hours". A data edit in `rules.ts`, plus the tests that assert those strings. No other description used "today"; "Spend tripled/doubled vs yesterday" is unchanged (not asked) | `lib/admin/health/rules.ts`, §6.2 |
| **U-9** | The "Auth role" column | **Removed entirely**: the header, the cell, its tooltip, and the colSpans (7 → 6). **C-23 is now satisfied by removal**: nothing on a row can read as an admin indicator. The expanded detail panel still shows "Role: authenticated" with a shield icon (pre-existing, outside the row, not asked); flagged for the user | `app/admin/users/page.tsx`, `defaultFilter.render.test.tsx` |

**Follow-ups recorded (not in this PR):**

| # | Follow-up | Why deferred |
|---|---|---|
| FU-1 | Save the Google display name into `profiles.full_name` at signup (or expose the auth-metadata name in the admin list), so fewer accounts show "No name" | User decision U-3 (b). A production signup-path or admin-route change, needing its own review |
| FU-2 | A "security alarms only → red" rule for the critical-events tile | User decision U-5. It is a new condition kind and an event list (C-11 rule-shape change) |
| FU-3 | An amber rule for an **unrecognised** `BOS_ENTITLEMENTS_MODE` value | Not in the user's starting rules; it needs a new flag (a code change, C-11) |
| FU-4 | Whether the old dashboard stays at all | User decision U-6: decided later |

---

## 10. Technical Forks for SA

**SA has ruled on all ten forks** (see SA Review Notes → Fork rulings): F-1 (a), F-2 (a), F-3 (a), F-4 (a), F-5 (a), F-6 (b), F-7 `/admin/platform-dashboard`, F-8 (a), F-9 strict empty object, F-10 client helper only. One point moved after the user's answers: F-6's "unrecognised value → amber" is **not** in the user's starting rules and is recorded as FU-3. The table below is the original proposal, kept for the record.

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F-1 | **Spend source** (fact 2, V-21, V-22) | (a) **paged narrow read** (`id, created_at, cost_usd`) + exact head count + ceiling 10,000 + "at least" labelling, no migration; (b) new service-role-only SQL function returning the four sums in one round trip (migration, manual prod apply, deployment-order fallback needed); (c) wait for B0's function and index | **(a)** for this slice: no schema change, follows the proven `listChatCallsAllAccountsInWindow` shape, exact at today's ~1,400 rows (2 pages), honest above. (b)/(c) are the §7.4 escalation path |
| F-2 | **Where the new ledger methods live** | (a) `AdminTokenUsageAnalyticsRepository` (admin-only, cross-account, already guarded to `app/api/admin/**`); (b) `TokenUsageRepository` | **(a).** `TokenUsageRepository` pins "one all-accounts read" in its contract test and must not grow a second |
| F-3 | **Audit counts** | (a) one admin-only method on `AuditTrailRepository` (`countAdminEventsAllAccountsInWindow`), guarded like `listAdminAiFailures`; (b) a new `AdminAuditTrailRepository` | **(a)** for now: one method, same pattern and guard as Slice 2. (b) makes sense once the audit route's inline client moves (OI-9) |
| F-4 | **One route vs several** | (a) one route, `allSettled`, per-read 5 s timeout; (b) one route per tile | **(a)**. Split spend out only if L-1 misses the budget (§7.4 step 1) |
| F-5 | **Settings tile source** | (a) reuse `buildAdminSettingsView()` (identical to the page; also computes model options it does not need); (b) a slimmer loop over `validateAreaRow` | **(a)**: the tile cannot disagree with the page. Its extra cost is visible in L-1's per-read `ms`. Plus the shared `areaOffSummary()` so the page and tile use one rule |
| F-6 | **Entitlements mode detail** | (a) effective mode only (`getEntitlementMode`); (b) add `getEntitlementModeSetting()` to `mode.ts` so a refused `enforce` or an unrecognised value turns the tile amber | **(b)**: "we think we are enforcing and we are not" is exactly what a health page is for, and the addition is pure and obeys `mode.ts`'s import rule. If SA prefers not to touch `mode.ts` in this slice, (a) ships and (b) is recorded |
| F-7 | **Legacy dashboard route name** | `/admin/platform-dashboard` vs `/admin/agentspilot-dashboard` | `/admin/platform-dashboard` (the IA's own label, "Platform dashboard (legacy)") |
| F-8 | **Link windows** | (a) exact bounds: audit links as UTC offsetless minutes (V-18), Cost Analytics via a new `dateFrom`/`dateTo` deep link; (b) presets only (`?period=1/7`, approximate by the seconds between loads) | **(a)**: "shows the same number" should be literally true where it can be. Depends on L-4 (DB timezone is UTC) |
| F-9 | **Zod on a route with no input** | strict empty object (unknown parameter → 400) vs no validation | Strict empty object. It makes the 400 path real and stops a parameter from silently gaining meaning later |
| F-10 | **"No name" definition location** | client helper only, no route change (auth-metadata fallback not used) vs expose a display name from the route | Client helper only in this PR (U-3 (b): FU-1) |

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Spend read cost grows with the whole ledger: no `created_at` index (V-22), and every page and the count scan the whole table | Med | Narrow columns; ceiling 10,000 (≤ 11 scans); per-read deadline (C-4); timing logs; pre-merge L-5/L-6 (C-14); the §7.4 escalation path **Closed 2026-09-26: live index exists, L-5 = 1.6 ms (§15.8).** |
| R-2 | "Same number" drift: offsetless audit links resolved in the DB timezone; Cost Analytics' 1,000 cap | Med | Fixed minute-floored windows (C-3); exact-bound links (F-8, C-9); L-4 before merge; the OI-P1 note appears exactly when calls exceed 1,000 |
| R-3 | "Configured off" is not "off": the AI kill switch fails open | Med | Figures say "configured off"; the rule description ("AI switched off somewhere") is amber, never red |
| R-4 | The critical-events tile is amber most days (routine critical events, V-16) | Low–Med | Accepted by the user (U-5); the link shows which events; FU-2 |
| R-5 | Red "No name" appears on most rows (names never saved at signup, V-6) | Med (perception) | Accepted by the user (U-3); FU-1 |
| R-6 | The Active default hides an inactive complaining business from search. "Active" means signed in within 30 days, not "used the product" | Med | A-2 one-click "Search all users" (U-4); never widened silently |
| R-7 | Bookmarks to `/admin` now land on Health, and the old dashboard has **no visible link** (U-6) | Low | Reachable at `/admin/platform-dashboard`. Nothing else in the product linked to `/admin` as "the dashboard" (SA verified) |
| R-8 | Entitlements-guard CI failure (Slice 2's CI break) | Med, avoidable | Registered in the same change; `npm run test:bos-entitlements` in the local run (C-12) |
| R-9 | Audit writes are batched and never awaited, so a lost write under-counts failures | Low | The tile title says "audited"; not fixable here |
| R-10 | A slow read holds the page | Med | A deadline that stops paging (C-4) → `unavailable` tile |
| R-11 | The route imports the call catalog, so it enters the BOS-LLM gates' scope | Low | No model or temperature literals; both gates in the local run |
| R-12 | The AreaCard refactor changes the Business OS AI page's behaviour | Low | A pure extraction; existing render tests pass unedited (C-6) |
| R-13 | A rule list edited as data produces an unreachable or mis-ordered rule (e.g. an amber rule placed above a red one that should win) | Low–Med | Config tests pin ascending unique priorities, non-empty descriptions and non-empty lists. The rule list renders on each tile, so the order is visible. Ordering is a business choice: tests prove it is **applied**, not that it is **wise** |
| R-14 | Moving the Active/Inactive badge next to the name leaves the Status column with only the role badge | Low | Recorded for the user's diff review (§4 A-4); no column is removed without asking |

---

## 12. Test Plan

### 12.1 Unit

**Rule config (`rules.config.test.ts`, reads `HEALTH_RULES`, no literals repeated):**
- Every measured tile (settings, failures, spend, critical, entitlements) has a **non-empty** rule list.
- The scheduled-jobs and queues tiles have **no** rule list, or an empty one.
- Every rule has a **non-empty `description`** and a unique `id`.
- Within a tile, `priority` values are unique and the list order equals ascending priority.
- Every `colour` is `'red'` or `'amber'` (**no-green guard**, runtime half).
- Every metric or flag a rule names exists in the evaluator's metric table (no rule can reference a value that is never measured).

**Evaluator (`evaluateHealth.test.ts`):**
- **First-match ordering:** a synthetic list where rules 1 and 2 both match → rule 1's colour and description win. The same list reversed → the other rule wins. A red rule placed after a matching amber rule → amber (order, not severity, decides).
- **The description shown is the matching rule's description:** `headline === rule.description` and `matchedRuleId === rule.id`, for each starting rule on each tile, driven from `HEALTH_RULES`. Inputs are built from each rule's own values: just below does not match, at matches, above matches.
- **No match → `neutral`, headline "Normal"**, `matchedRuleId: null`, for every measured tile.
- **C-2:**
  - A ratio rule with an inexact operand never matches.
  - `atLeast` on a lower bound matches when the bound is ≥ the value, and does not match when it is below.
  - With the ratio rules blocked, the spend tile falls to the lower-bound rule.
  - A previous period of 0 → an unbounded ratio, so only the floor decides.
  - `shareAtLeast` below `minTotal` never matches.
- **C-1 (via the route's input builder, unit-tested where it lives):** ceiling hit but the 24 h figure exact; ceiling hit inside the 24 h window; a boundary tie with a strict `<`.
- **C-3:** the minute floor; inclusive current windows; half-open previous windows (a boundary row counted once); no `Date.now()` in the evaluator (source check).
- A failed input → `unavailable`, no rule evaluated. Tiles 6 and 7 → always `not_measured`, `href: null`.
- **No green:** fuzzed inputs never yield a status outside `'red' | 'amber' | 'neutral' | 'not_measured' | 'unavailable'` (C-10). The type half is `TileStatus` and `HealthRule['colour']`.
- Link builders: audit links use offsetless UTC minutes; analytics links use ISO with an offset.

**Other units:**
- `userName`: `null`, `''`, `'   '`, `'\t\n'` → no name; `'Dana'`, `' Dana '` → a name.
- `areaState`: area off → `offCalls` 0; area on with 2 calls off → 2; a non-switchable area with `configuredEnabled: false` → not off.
- Repositories:
  - `countAllAccountsInWindow` and `listCostPointsAllAccountsInWindow`: columns, the `or` expression from the builder, order, paging to the ceiling, de-dup, `reachedCeiling`, the deadline stops page 2, the error shape, context required.
  - `countAdminEventsAllAccountsInWindow`: context required, `head: true`, typed filters, action or severity required, the error shape.
- `mode.test.ts`: existing cases unchanged, plus the equivalence table (C-8).

### 12.2 Route (`app/api/admin/health-summary/__tests__/route.test.ts`, mocked repositories)

| Case | Expectation |
|---|---|
| Signed out; auth lookup **throws** | 401, no read called |
| Signed in, not admin; admin check **throws** | 403, no read called |
| Unknown query parameter | 400, fixed message, no read called; 401/403 still win over 400 |
| Happy path | 200; 7 tiles in order; each status and headline come from the rule that the fixture triggers; links carry the window bounds; spend sums equal the fixture's per-window sums; `bosRowFilter()` reaches the repository unchanged |
| No rule matches anywhere | Every measured tile is `neutral` / "Normal"; tiles 6 and 7 are `not_measured` |
| One read fails | 200; only that tile is `unavailable`; the others are unaffected |
| Spend: page read fails / only the count fails | `unavailable` / figures follow C-1, with no "N calls" and no OI-P1 note (C-4) |
| Deadline passed after page 1 | No page 2 request; the spend tile is `unavailable`; no unhandled rejection |
| Spend ceiling reached inside a window | That figure reads "at least"; the ratio rules do not fire; the lower-bound rule does, unless the absolute floor fires first |
| Unexpected throw | 500; `details` absent in production and present in development |
| C-7 leak check | The serialised body and every logger argument contain no email, `lastChangedBy`, `details` or error message |

### 12.3 Render and source guards

- **Health render:**
  - the headline per status (a rule description, "Normal", "Not measured yet", "Could not check");
  - distinct class sets for `neutral`, `not_measured` and `unavailable`;
  - no anchor on the not-measured tiles;
  - "at least" is kept;
  - descriptive link names;
  - the rule list is rendered in order;
  - no link to `/admin/platform-dashboard`.
- **Health source guard:** see §8 (no `OK`, no green classes, no legacy link, no server imports), scoped to the Health files.
- **Users:** the `UserNameLine` render; the default-filter render; `source.guard` extended; `businessOsPanel.render.test.tsx` passes **unedited** (C-15 (c)).
- **Analytics:** the linked-window render; `scope.render.test.tsx` passes unedited.
- **Sidebar nav test:** 23 entries, 13 parked, all hidden (one `hidden: true`), and `/admin/platform-dashboard` in the parked section. The existing `business-os-llm` render tests pass unedited.
- `enforcementPoints.test.ts`: the new route is registered with exactly its symbols.
- `admin-authz-surface.guard.test.ts`: the new handler is found and calls `requireAdmin` first (no cap change).

### 12.4 Local commands (all run; real output pasted in the Implementation Record)

```bash
npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage lib/business-os/entitlements
npx jest lib/business-os/llm            # AreaCard refactor + adminSettingsView consumers
npm run test:bos-entitlements           # the CI job's exact script (C-12)
npm run test:authz-guard
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npx eslint app/admin app/api/admin/health-summary lib/admin lib/repositories/AdminTokenUsageAnalyticsRepository.ts lib/repositories/AuditTrailRepository.ts lib/business-os/entitlements/mode.ts
npm run lint:hooks
npm run build                           # the route imports a server-only module; the client page must not
```

The only accepted pre-existing failure is the parked C-13 contract assertion, **named by its test name** in the record (C-12). Any other failure is new.

### 12.5 Manual checks for QA and the user (as a platform admin)

**Before merge:** L-2 to L-6 (§7.3, C-14).

**After deploy:**
1. **H-1** `/admin` shows Health: 7 tiles, none green. Each coloured tile's headline is one of its rule descriptions; a quiet tile says "Normal"; the job and queue tiles say "Not measured yet", with no link.
2. **H-2** Click each figure link. The audit trail's total equals the tile's count for the same window. Cost Analytics shows the same spend (at display precision) while calls are ≤ 1,000, and the tile shows the OI-P1 note when they are not.
3. **H-3** No link anywhere on screen leads to the old dashboard. Typing `/admin/platform-dashboard` opens it, with the old totals.
4. **H-4** L-1 recorded.
5. **B-1** `/admin/users` opens on Active users; the card and the header pill say "shown"; a search with no active match offers "Search all users", and nothing widens without the click.
6. **B-2** A no-name login shows a red "No name" (a screen reader announces "No name — needs attention") next to a **neutral (not green) Active/Inactive badge**; nothing on the name line is green. The badge sits next to the name on every row. The **green** verified tick sits beside the **email**. There is no status or role column. A login with no business still says "No Business OS business" in grey.
7. **B-3** Non-admin: `/admin` is refused; `GET /api/admin/health-summary` returns 403 (401 when signed out).

---

## 13. Non-Compliant Files (CLAUDE.md rule 3)

| File | `console.*` calls | Proposal |
|---|---|---|
| `app/admin/page.tsx` → moved to `app/admin/platform-dashboard/page.tsx` | **1** (`console.error` at `:112`) | Convert to `createLogger({ module: 'AdminPlatformDashboard' })` + `logger.error({ err }, 'Failed to fetch dashboard data')`, as `app/admin/users/page.tsx` does client-side. SA approved; **proceeding unless the user declines** |
| `app/admin/users/page.tsx` | 0 `console.*`, but `logger.debug({ result })` logs every name and email (C-15 (b)) | Reduce to counts |
| Every other file this slice modifies | 0 | — |

`/api/admin/dashboard/route.ts` has 0 and is not touched.

---

## 14. Task List

- [x] T0a: SA workplan review: APPROVED WITH CONDITIONS C-1 to C-16
- [x] T0b: The user answers Q-1 to Q-6 → U-1 to U-6 (§9)
- [x] T0c: **SA checks the revision** (the rule-list design U-1 and the URL-only legacy dashboard U-6) before implementation starts
- [x] T1: `lib/admin/health/healthTypes.ts`, **`rules.ts`** (`HEALTH_RULES`, the starting rules of §6.2), `evaluateHealth.ts` (`firstMatchingRule`, condition interpreter with C-2 built in) + `rules.config.test.ts` + `evaluateHealth.test.ts`
- [x] T2: `AdminTokenUsageAnalyticsRepository`: `countAllAccountsInWindow`, `listCostPointsAllAccountsInWindow` (C-4 deadline), constants, header; tests
- [x] T3: `AuditTrailRepository.countAdminEventsAllAccountsInWindow` (C-5); header; guard test
- [x] T4: `mode.ts`: one parser + `getEntitlementModeSetting()` (C-8); `mode.test.ts` equivalence table
- [x] T5: `app/admin/business-os-llm/areaState.ts`; `AreaCard.tsx` uses it; existing tests unedited and green
- [x] T6: `app/api/admin/health-summary/route.ts` (`requireAdmin` first, strict Zod, `allSettled` + deadlines, `HealthInputs` builder with C-1/C-3, Pino timings, C-7); route tests
- [x] T7: Register the route in `enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`, exact symbols)
- [x] T8: Move the old dashboard to `app/admin/platform-dashboard/page.tsx`; Pino conversion; **no link to it anywhere**
- [x] T9: The Health page (`app/admin/page.tsx`) + `HealthTile` / `HealthGrid` (headline, rule list, C-16); render + source guard tests (incl. no legacy link)
- [x] T10: The Cost Analytics `dateFrom`/`dateTo` deep link (C-9) + render test
- [x] T11: Sidebar + header; the nav test at 23 / 13 parked / all hidden
- [x] T12 (**except the badge colour: TODO C-17, pending the user; §15.2**): Part A: `hasPersonName`, `UserNameLine` (badge beside the name, tick beside the email, C-16), default `'active'`, narrowing select guard, "Search all users", both "total" labels, the debug-log fix; tests
- [x] **T12b (U-7, 2026-09-26):** `ACTIVE_BADGE_MODE = 'neutral'` in `app/admin/users/userName.ts`; the TODO is removed; B-2 is re-worded; a test pins the value
- [x] **T12c (U-8, U-9, 2026-09-26):** "today" → "in the last 24 hours" in the rule descriptions; the "Auth role" column is removed
- [x] T13: Run every command in §12.4; paste real output; name the C-13 baseline failure by test name
- [x] T14 (docs done; the BA hand-off is for TL): C-13 docs (register row 81, re-measured counts in `ADMIN_IDENTIFICATION_AND_ACCESS.md` and `CLAUDE.md`); hand the requirement amendments (U-1, U-6, link exceptions) to BA via TL
- [x] T15: Implementation record, deviations, "what SA should look at first"; notify TL. **No commit** (standing user rule)
- [x] T16 (user): L-2 to L-6 recorded 2026-09-26, just after merge; all pass (§15.8)

---

## 15. Implementation Record (Dev, 2026-09-26)

**Nothing is committed** (standing user rule). Every change is uncommitted in the worktree `neuronforge-admin-bos-reorg`, on branch `feature/admin-bos-health-landing`.

### 15.1 What was built

| Task | Done | Where |
|---|---|---|
| T1 | ✅ | `lib/admin/health/healthTypes.ts` (runtime-free), `rules.ts` (`HEALTH_RULES`, per-tile metric types, `TILE_VOCABULARY`), `evaluateHealth.ts` (pure, never throws), `windows.ts` (C-1 / C-3, pure) and their tests |
| T2 | ✅ | `AdminTokenUsageAnalyticsRepository`: `countAllAccountsInWindow`, `listCostPointsAllAccountsInWindow`, `ADMIN_ANALYTICS_COLUMNS.cost`, `ADMIN_HEALTH_READ_LIMITS`; header names both callers |
| T3 | ✅ | `AuditTrailRepository.countAdminEventsAllAccountsInWindow` (context first, typed filter, head count); header says it is the first unscoped read; `ADMIN_METHODS` guard |
| T4 | ✅ | `mode.ts`: one pure parser; `getEntitlementMode()` keeps its behaviour and logs; `getEntitlementModeSetting()` returns `{ effective, requested, refused }`, no raw string, no log. Equivalence table in `mode.test.ts` |
| T5 | ✅ | `app/admin/business-os-llm/areaState.ts`; `AreaCard.tsx` uses it. The five `business-os-llm` suites pass **unedited** (197 tests) |
| T6 | ✅ | `app/api/admin/health-summary/route.ts` + 22 route tests |
| T7 | ✅ | `KNOWN_NON_GATE_IMPORTERS` entry, symbols `['getEntitlementModeSetting']` (the route imports only that one) |
| T8 | ✅ | `app/admin/platform-dashboard/page.tsx`: the old page verbatim, plus a header comment and the Pino conversion |
| T9 | ✅ | `app/admin/page.tsx`, `components/health/HealthGrid.tsx`, `HealthTile.tsx` + render test + source guard |
| T10 | ✅ | `app/admin/analytics/linkedWindow.ts` + page wiring + render test; `scope.render.test.tsx` passes unedited |
| T11 | ✅ | Sidebar "Health"; hidden parked entry for the old dashboard; header titles; nav test at 23 / 13 parked / one hidden section |
| T12 | ✅ **except the badge colour (C-17, pending the user)** | `userName.ts` (`hasPersonName`, `toStatusFilter`, `countLabels`, **`ACTIVE_BADGE_MODE`**), `components/UserNameLine.tsx`, page edits, two new test files, source guard extended |
| T13 | ✅ | §15.4 |
| T14 | ✅ (docs) / ⬜ (BA hand-off) | Register row 81 and re-measured counts in `ADMIN_IDENTIFICATION_AND_ACCESS.md` and `CLAUDE.md`. The requirement amendments (U-1, U-6, link exceptions) are for BA via TL |
| T15 | ✅ | This section |

### 15.2 C-17 (the Active badge colour): DECIDED, U-7 = `'neutral'`

✅ **Resolved 2026-09-26.** The user chose option (a), `'neutral'`: the Active badge is never green, anywhere. The email-verified tick stays green (also the user's explicit choice). The table below is kept for the record: the other two modes remain options in code and stay tested. `userNameLine.render.test.tsx` pins that the active value is `'neutral'`.

*(Original note:)* the Active/Inactive badge now sits beside the name. Until the user chose, it kept the previous styling (green for Active): option (c).

**The one switch** is `ACTIVE_BADGE_MODE` in `app/admin/users/userName.ts`:

| Value | Option | Effect |
|---|---|---|
| `'green'` *(current)* | (c) | Green Active on every row, including beside a red "No name" |
| `'neutral'` | (a) | Active is never green (blue-grey) |
| `'neutral-on-no-name'` | (b) | Green Active only on rows that have a name |

`userNameLine.render.test.tsx` pins all three modes, so the user's choice is a one-word edit with no test change. **Manual check B-2 must be re-worded once the user picks.** Under (c), a red "No name" does sit next to a green "Active".

### 15.3 Deviations (for SA code review)

| # | Deviation | Why |
|---|---|---|
| D-1 | The failures tile runs **3** audit counts, not 4: failed 24 h, failed 7 d and completed 24 h. There is no completed-7 d count | No rule or figure uses a 7-day share. One fewer scan |
| D-2 | `evaluateHealth.ts` also builds the figures, links and notes, and `windows.ts` holds the C-1/C-3 maths. The workplan put the input builder "in the route" | Both are pure and unit-tested. The route only reads and hands over numbers. SA C-6's line (no I/O or clock in the evaluator, no repository named) holds, and is pinned by a source test |
| D-3 | C-20's `onRuleError` callback is how the evaluator "logs at error with the rule id": the evaluator itself imports no logger, and the route logs at `error` | It keeps the evaluator free of side effects. Tested |
| D-4 | **Users list, pre-existing bug fixed:** the page's client-side search filter did not look at the Business OS business name. A row the route found **by business name** was then hidden again, so the "Search all users" flow could never show a business found only by its name | Found by the U-4 test. It is a one-line addition to `getFilteredUsers`, in a file already touched |
| D-5 | *(Superseded by U-9: the column is removed; C-23 is satisfied by removal.)* **C-23:** the column heading "Status" became **"Auth role"**. The pill lost its shield icon and blue colour (now slate) and gained a tooltip: "Supabase sign-in role. Not admin access: admins are listed under Admin users." | C-23 requires that the pill never read as an admin indicator. A shield under "Status" did. The heading wording is the user's call at diff review (R-14) |
| D-6 | `AdminHeader`'s `/admin/queues` title changed from "Queue Monitor" to "Agent execution queue". The two pages' own `<h1>`s (`queues/page.tsx`, the moved dashboard) are untouched | As planned (V-11). The moved page is verbatim by design |
| D-7 | The entitlements "unrecognised value" amber is **not** built | Not in the user's starting rules. Recorded as FU-3 |
| D-8 | The health route logs a **warn** (not shown on screen) when the exact count and a completed read disagree | A cross-check SA asked for. Rows written between the two reads can cause it |
| D-9 | Rule descriptions are **exactly the user's wording**, including "today" over a rolling 24 h | The SA's "in the last 24 hours" wording is pending the user. It is a data edit in `rules.ts` |
| D-10 | Not done: the SA's optional one-line fix for "clearing the search box does not refetch" | Recorded only. The empty-state button covers the U-4 case |

### 15.4 Verification (real output, 2026-09-26)

| Command | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage lib/business-os/entitlements` | **114 suites: 113 passed, 1 failed; 2,533 tests: 2,532 passed, 1 failed.** The one failure is the parked baseline (C-13): `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` › "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional". It is the same missing `summariseFeatureAllAccountsInWindow`, and `TokenUsageRepository.ts` is untouched |
| `npx jest lib/business-os/llm` | 18 suites / 413 tests, all passed |
| `npm run test:bos-entitlements` (the CI job's script) | 57 suites / 1,106 tests, all passed |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | 251 files in scope, 28 errors, **0 new**, passed. It also reports "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, which this slice did not touch: pre-existing, left for whoever owns the baseline |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, **0 violations**, passed |
| Scoped `tsc` over the 36 touched `.ts/.tsx` files | 30 diagnostics, **0 new**. 24 are the pre-existing ones in `app/admin/analytics/page.tsx` (none on a changed line). 6 are in `lib/analytics/aiAnalytics.ts`, which is untouched and pulled in transitively. A full-project `tsc` ran out of memory at the default 4 GB heap (not re-checked on `main`), hence the scoped run |
| `npx eslint <touched files>` | **0 errors**, 15 warnings. All are pre-existing lines (unused icons, `any`, hook dependencies) in `analytics/page.tsx`, `users/page.tsx` and the moved dashboard |
| `npm run lint:hooks` | exit 0 |
| `npm run build` (with the CI job's placeholder env from `.github/workflows/build.yml`: `https://ci.invalid`, no real key) | **exit 0**, `✓ Compiled successfully`, 303/303 pages. `/admin` 6.28 kB, `/admin/platform-dashboard` 7.61 kB, `ƒ /api/admin/health-summary`. The first attempt, with no env at all, failed collecting page data for untouched routes (`execution-stats`, `stripe/cancel-subscription`) that need env at import time: environmental, not this slice |

Suites run on their own while building: `lib/admin/health` 3 suites / 124 tests; the route 22; the Health page render + source guard 28; `app/admin/analytics` 2 suites / 18; `app/admin/users` 5 suites / 59; `mode.test.ts` 27 (+15); the two repository suites 48.

### 15.5 What SA should look at first

1. `lib/admin/health/evaluateHealth.ts`, `colourTile`: first match, the C-18 invariant, the C-20 isolation.
2. `matchCondition`: C-2 inside `ratioAtLeast` / `shareAtLeast`.
3. `app/api/admin/health-summary/route.ts`, `underDeadline`: C-4. The signal goes to the repository, the timer is cleared, and a late settle is swallowed.
4. `lib/admin/health/windows.ts`, `summariseSpend`: C-1's strict `<` and C-3's half-open previous windows.
5. `AuditTrailRepository.countAdminEventsAllAccountsInWindow`: the first unscoped read (C-5).
6. `mode.ts`: the shared parser; `getEntitlementMode()`'s behaviour and logs are unchanged (C-8).
7. `users/page.tsx`: D-4 and D-5.

### 15.6 Live checks owed by the user: L-2 to L-6, **before merge** (C-14)

Read-only. Paste each block into the Supabase SQL editor on its own and record the result. L-1 (route timing) is after deploy.

```sql
-- L-2: Business OS rows in the spend tile's 14-day window (pass: <= 10,000)
SELECT count(*) AS bos_rows_14d
FROM public.token_usage
WHERE created_at >= now() - interval '14 days'
  AND created_at <= now()
  AND (feature LIKE 'business-os%'
       OR feature IN ('insight-generation', 'correlated-insight-generation',
                      'health-summary-generation', 'landing-page-generation', 'lead-reply'));
```

```sql
-- L-3: live indexes on the two tables the Health page reads (record; do not assert a count)
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('token_usage', 'audit_trail')
ORDER BY tablename, indexname;
```

```sql
-- L-4: the database timezone (pass: UTC; the audit links are offsetless UTC)
SHOW timezone;
```

```sql
-- L-5: the spend read's first page, as the route issues it (pass: execution <= ~1 s)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.token_usage
WHERE created_at >= now() - interval '14 days'
  AND created_at <= now()
  AND (feature LIKE 'business-os%'
       OR feature IN ('insight-generation', 'correlated-insight-generation',
                      'health-summary-generation', 'landing-page-generation', 'lead-reply'))
ORDER BY created_at DESC, id DESC
LIMIT 1000;
```

```sql
-- L-6: whole-table size (each spend page scans the whole table, not the window)
SELECT count(*) AS token_usage_rows,
       pg_size_pretty(pg_total_relation_size('public.token_usage')) AS token_usage_total_size;
```

**Note on L-5:** `EXPLAIN ANALYZE` runs the `SELECT` for real, and it is still read-only.

---

### 15.8 Live check results (user, 2026-09-26, recorded after merge of PR #115)

The PR was merged before these were recorded; the user ran them immediately after. **All pass.**

| Check | Result | Verdict |
|---|---|---|
| L-2 | 512 BOS rows in the 14-day window | ✅ ≤ 10,000 (exact, 1 page) |
| L-3 | `token_usage` **has** `idx_token_usage_created_at` (btree `created_at`), plus `(feature, created_at DESC)`, `(user_id, created_at DESC)` and others; `audit_trail` has `idx_audit_trail_created_at` (btree `created_at DESC`), plus `action`, `severity`, `user_id` and others | ✅ Recorded; see correction below |
| L-4 | `SHOW timezone` = `UTC` | ✅ Audit links are correct as built |
| L-5 | `Index Scan Backward using idx_token_usage_created_at`, 512 rows, 47 removed by filter, **Execution Time 1.637 ms** | ✅ ≪ ~1 s |
| L-6 | 25,453 rows, 34 MB total | ✅ Recorded |

**Correction to V-22, R-1 and the SA's F-1 caveat:** the claim that `token_usage` has no index usable for a cross-account window was derived from repo migration files. The live database has `idx_token_usage_created_at`, created outside the repo (B0's SA review had warned that the repo is not the source of truth for this table's indexes). The spend read is therefore an index range scan over the window, not a whole-table scan, and its cost grows with the window, not with the ledger. The ceiling, deadline and scan cap stay as defence in depth. L-1 (route timing after deploy) is still owed.

---

### 15.7 Review follow-ups (Dev, 2026-09-26, uncommitted)

After SA's "approved with nits" and QA's conditional PASS. `ACTIVE_BADGE_MODE`, the rule descriptions and the "Auth role" label are untouched (they wait on the user).

| Finding | Fix | Test |
|---|---|---|
| **B-1 / SA-1** (Medium) | `readSettings` wraps the reduction in its own `try`. A view of an unexpected shape makes only the settings tile `unavailable`, and its timing entry is marked failed. It never 500s | `route.test.ts`: 4 malformed shapes (no `areas`, no `areaIssues`, no `calls`, `null`). 200, settings `unavailable`, the others Normal |
| **SA-2 / E-4a** | The rule list's closing line is now data from the evaluator (`HealthTile.otherwise`). The spend tile, which can carry a lower bound, says "Otherwise: Normal, unless a figure is only a minimum; then amber: …". Always-exact tiles say "Otherwise: Normal.". Tiles with no rules show no line. The client no longer hard-codes it | `evaluateHealth.test.ts` (it still holds when the redundant lower-bound rule is deleted); `health.render.test.tsx` |
| **SA-3** | Header now reads "THE FIRST ADMIN EXCEPTION" | — |
| **SA-4** | While a linked window applies, no preset is highlighted. Clearing the chip, or picking a preset or custom range, also removes `dateFrom`/`dateTo` from the URL (`history.replaceState`; `scope` and `user` are kept). URL-only: the drill-down route, OI-P1 and OI-P2 are untouched, and `scope.render.test.tsx` passes unedited | `linkedWindow.render.test.tsx`: +3 page cases, +2 `urlWithoutLinkedWindow` cases |
| **SA-5** | `countAdminEventsAllAccountsInWindow` logs a failed read at `warn`, like the sibling admin reads | — |
| **E-1** | Comparisons run in integer micro-units. `atLeast` and the floor compare `round(x·10⁶)`. A ratio compares against `round(factor·baseline·10⁶)`: the threshold is rounded, not the baseline, because rounding the baseline first scales its error by the factor. A share is integer cross-multiplication. Resolution is $0.000001 | `evaluateHealth.test.ts`: $2.39 + $2.75 → $15.42 matches "tripled" (and $15.419999 does not); end to end the tile is red "tripled"; a floor reached by 0.7 − 0.4; shares 1 of 5 and 3 of 15 |
| **E-3** | `users/page.tsx`: the fetch log now carries `{ status, hasSearch, searchLength }`, not the query string. The detail log carries `{ success, agents, plugins }` counts, not the stats payload. The per-plugin debug line is removed | `defaultFilter.render.test.tsx`: a search for an email never reaches the log |

QA's three probe files are kept in the working tree, uncommitted: `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts`, `lib/admin/health/__tests__/qa-edge.test.ts` and `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.qa-edge.test.ts`. All pass.

**Verification after the fixes (real output):**

| Command | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage lib/business-os/entitlements lib/business-os/llm` | **135 suites: 134 passed, 1 failed; 3,006 tests: 3,005 passed, 1 failed.** The one failure is the parked baseline (C-13), "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" |
| `npm run test:bos-entitlements` | 58 suites / 1,111 tests, all passed |
| `npm run test:authz-guard` | 119 / 119 passed |
| `npm run typecheck:bos-llm` | 252 files in scope, 0 new, passed |
| `npm run check:bos-llm-literals` | 0 violations, passed |
| `npm run lint:hooks` | exit 0 |
| ESLint, touched files | 0 errors, 15 warnings (the same pre-existing lines) |
| Scoped `tsc` | 0 new (the same 24 pre-existing in `analytics/page.tsx`, plus 6 in the untouched `lib/analytics/aiAnalytics.ts`) |
| `next build`, CI placeholder env | exit 0, 303/303 pages |

## SA Review Notes

**Reviewed by SA — 2026-09-26** (workplan review, worktree `neuronforge-admin-bos-reorg`, branch `feature/admin-bos-health-landing` @ `8ff11095`; no code exists yet, nothing committed)
**Status:** ✅ **APPROVED WITH CONDITIONS.** Implementation may start once the user has answered Q-1 to Q-6. Conditions C-1 to C-16 below are binding: each must be met in the code or recorded as a deviation in the Implementation Record. The merge gate is C-14 (live checks L-2 to L-6 run **before** merge, not after deploy).

### What SA re-verified in the code (spot checks of the Verification Log)

| Claim | Result |
|---|---|
| V-8/V-9: parked section `hidden: true`; nav test pins 22 entries, 12 parked (asserted **twice**: `parks the other twelve…` and `keeps all twelve parked items…`), on-disk floor 23, every parked description contains "AgentsPilot", nothing in the sidebar matches `/\bOK\b/` | ✅ Holds. Both "twelve" assertions and the "23 pages today" comment must move together |
| R-7: nothing else links to `/admin` expecting the old dashboard | ✅ Holds. Across `app`, `lib`, `components`, `hooks` and `middleware.ts`, only `AdminSidebar.tsx:75` and `AdminHeader.tsx:26` name `'/admin'`. `adminGate.writes.test.ts` references `/api/admin/dashboard` (the API, which is untouched), not the page. The old page has no relative imports, so a verbatim move to `app/admin/platform-dashboard/` compiles |
| V-28: a new gated handler changes no guard cap | ✅ Holds. `CAPS` are equality caps on the **parked** R1/R2 lists (6/6); `ADMIN_API_ROUTES` is a floor (≥ 40). A handler calling `requireAdmin` needs no guard edit. R8 requires every `app/admin/**` render entry point to be `'use client'` or to guard itself: the Health page and the moved dashboard are both client pages |
| V-26: entitlements registration | ✅ Holds, and the CI job runs `npm run test:bos-entitlements`, which is **wider** than the local list (it also runs `lib/repositories/__tests__`, `supabase/migrations/__tests__` and two purge/business-owned invariants). See C-12 |
| V-21 / Slice 2 OI-P1: the 10,000 ceiling and the `created_at DESC, id DESC` + de-dup shape | ✅ It is the fix shape SA already ruled for OI-P1 (Slice 2 §13), and `listChatCallsAllAccountsInWindow` is the working precedent (`TokenUsageRepository.ts:537-578`) |
| V-17/V-18: audit deep links | ✅ `filtersFromUrl` reads `date_from`/`date_to` verbatim into `datetime-local` inputs, and the route passes them to `.gte/.lte` unchanged. An offsetless `YYYY-MM-DDTHH:mm` is the **only** form the input can display; a `Z`-suffixed value would apply a filter the admin cannot see in the form. Offsetless is therefore the right choice, which makes L-4 load-bearing (C-14) |
| V-24: Cost Analytics dates | ✅ Confirmed, plus one trap: the custom range builds `new Date(to + 'T23:59:59')` in **browser-local** time (`analytics/page.tsx:285-286`). The linked window must bypass that path (C-9) |
| **New:** the `business-os-llm` source guard allows **no `@/lib/` import at all** except `ledgerCheckCopy`, and forbids any import whose path contains `adminSettingsView` (type-only imports included) | Constrains `areaState.ts` (C-6) |
| **New:** the `AdminTokenUsageAnalyticsRepository` isolation test flags **any** file outside `app/api/admin/**` whose code names the class, **including a type-only import** | Constrains `lib/admin/health/**` (C-6) |
| **New:** `app/admin/users/page.tsx:438` renders `{stats.totalUsers} total` in the header pill, a second place where the filtered count is called "total" | A-3 must cover it (C-15) |
| **New:** `app/admin/users/page.tsx:205` logs the **entire** list response (`logger.debug({ result }, …)`: names and emails of every login) from the browser | Touched file; C-15 |
| B0 status | Its workplan (`5bea0b5b`) is **planning, not approved or built**. Waiting on it (F-1 (c)) would block this slice on an unscheduled migration |

### Fork rulings

| # | Ruling | Reason / conditions |
|---|---|---|
| **F-1** | **(a) APPROVED**, with C-1 to C-4 and C-14. (b) and (c) **rejected for this slice**; they stay the §7.4 escalation path | (c) waits on an unbuilt, unapproved migration. (b) adds a hand-applied migration for one tile before anyone has measured a problem. That is the wrong order: measure first. (a) is exact at today's volume (≈1,400 rows, 2 pages) and honest above it. **What (a) does not bound:** the 10,000 ceiling bounds rows *returned*, not rows *scanned*. With no `created_at` index every page and the count is a full scan of **the whole `token_usage` table**, so cost grows with total ledger size, not window size. That is why §9's "no unbounded cross-account scan" is satisfied only by (i) a hard cap on the **number** of scans (≤ 11), (ii) the per-read deadline (C-4), and (iii) a table-size measurement **before merge** (C-14, new L-6). If L-5/L-6 show a page costs more than ~1 s, the §7.4 escalation happens **before** merge, not after |
| **F-2** | **(a) APPROVED** | `TokenUsageRepository`'s contract test pins its all-accounts reads; the admin repository is the agreed OI-9 template. Update its header: "the ONLY permitted caller is the drill-down route" becomes a two-caller list |
| **F-3** | **(a) APPROVED**, with C-5 | One method, and the same guard as `listAdminAiFailures`. Note that it is the **first unscoped** read in `AuditTrailRepository` (`listAdminAiFailures` is still `.eq('user_id', accountId)`). The header must say so in those words |
| **F-4** | **(a) APPROVED**, with C-4 | One route, `allSettled`, per-read deadline. Splitting spend into its own request (§7.4 step 1) is pre-approved as a UI-only fallback if L-1 misses |
| **F-5** | **(a) APPROVED**, with C-6 and C-7 | Identical to the page by construction. `buildAdminSettingsView()` also resolves admin **emails** (`lastChangedBy`). None of that may reach the response or the log line |
| **F-6** | **(b) APPROVED**, with C-8 | "We think we are enforcing and we are not" is the textbook health signal. But `mode.ts` is the one file the chat route must never break on (RC-7), so the change is held to one parser shared by both functions, with an equivalence test |
| **F-7** | **`/admin/platform-dashboard` APPROVED** | Matches the IA's own label (§4.2) |
| **F-8** | **(a) APPROVED, in scope, and held to a narrow change** (C-9) | "Every tile links to a page that shows the same number" is a Slice 4 acceptance criterion, so the deep link is in scope. It must **not** become a fix for OI-P1/OI-P2: the drill-down route is untouched, the 1,000 cutoff and the "vs previous period" behaviour stay exactly as parked, and the tile's own note carries the honesty. The audit links rely on L-4 (DB timezone = UTC), which is now a pre-merge check |
| **F-9** | **Strict empty object APPROVED** | Because `requireAdmin` runs first, 401/403 always win over 400, and the route test must pin that ordering. The client's Refresh must not add a cache-buster query parameter (use `cache: 'no-store'`), or the strict schema will 400 it |
| **F-10** | **Client helper only APPROVED** | A route change for the Google display name is a separate follow-up, and only if the user asks (Q-3 (b)) |

### Conditions (binding)

1. **C-1 (F-1) Exactness per sub-window, not per read.** The read is newest-first, so a ceiling-truncated read drops the **oldest** rows. A sub-window's figure is exact when the read completed naturally (last page short, ceiling not reached), **or** when the oldest row read is strictly older than that sub-window's start. With a strict `<` a tie on the boundary timestamp cannot sneak in. The global `rowsRead === count` flag is not enough: it would print "at least" on a 24 h figure that is provably complete. The count is kept for the "N calls" display, the OI-P1 note and a cross-check. Unit tests cover: ceiling hit but 24 h exact; ceiling hit inside the 24 h window; a boundary tie.
2. **C-2 (F-1) Comparison rules only on exact operands.** An absolute floor may fire on a lower bound ("at least $25" ≥ $20 is true). A **ratio** rule (2×, 3×, 1.5×) fires only when **both** operands are exact, because a truncated previous period inflates the ratio. When a ratio cannot be evaluated, the tile gets the lower-bound amber reason instead, and the figure does not print a "vs previous" multiple.
3. **C-3 (F-1) Interval algebra, written down and tested.** The current windows are `[start, end]`, inclusive on both ends to match the linked pages' `.gte/.lte`. Previous periods are `[prevStart, start)`, so a row on the boundary is counted once. The minute floor is applied once, in the route, and passed to the evaluator (the evaluator never calls `Date.now()`). Spend is formatted at the **same display precision as Cost Analytics**, or H-2 compares at display precision and says so.
4. **C-4 (F-1/F-4) The deadline stops work, not just the wait.** The paging loop checks the deadline **between pages** and stops issuing pages once it has passed. Use supabase-js `.abortSignal()` where available. Timers are cleared, and a read that settles after its deadline must not surface as an unhandled rejection. A route test pins "deadline passed after page 1 → no page 2 request, tile `unavailable`". Behaviour on partial failure, defined and tested: **page read fails → tile `unavailable`**; **only the count fails → figures follow C-1 (the natural-completion rule still proves exactness), with no "N calls" number and no OI-P1 note**.
5. **C-5 (F-3) `countAdminEventsAllAccountsInWindow`** takes an `AdminReadContext` **first and required** (the same rule as the admin analytics repository: an unattributed cross-tenant read is what the accountability trail exists to prevent), logs at `info` with counts only, and types its filters (`action` from `AUDIT_EVENTS` values, `severity: AuditSeverity`), with at least one of the two required. It selects `id` with `{ count: 'exact', head: true }`, so no `details` is read. It is added to `ADMIN_METHODS` in `adminReadMethods.guard.test.ts`, and the file header lists it as the second admin exception and the first unscoped one.
6. **C-6 Layering.** `lib/admin/health/**` is pure. It imports nothing from `app/**`, nothing server-only, and **does not name `AdminTokenUsageAnalyticsRepository` even in a type import** (the isolation test would fail). It defines its own window and input types. The route calls `areaOffSummary()` and hands the evaluator **numbers and area labels**. `app/admin/business-os-llm/areaState.ts` has no `'use client'` directive, imports nothing from `@/lib/` and nothing whose path contains `adminSettingsView` (the existing `business-os-llm` source guard enforces both, unchanged), and is typed structurally. The existing `business-os-llm` render tests must pass **unedited** (R-12).
7. **C-7 No leaks in the response or the log.** The response carries counts, sums, area labels, the mode word, fixed sentences and links: no email, no `lastChangedBy`, no `details`, no error text (`unavailable` is a fixed string). The single `info` line carries timings, row and page counts, and which reads failed (an error **class/code**, not a message). The route test asserts this on the serialised body and on every logger argument.
8. **C-8 (F-6) One parser in `mode.ts`.** Introduce one pure internal parser. `getEntitlementMode()` keeps its exact behaviour and its error logs, built on the parser. `getEntitlementModeSetting()` returns `{ effective, requested: 'off'|'shadow'|'enforce'|'unrecognised', refused }`, **never the raw environment string**, and does not log (so Health does not double-log). No new import in `mode.ts`. `mode.test.ts`: existing cases unchanged and green, plus a table-driven equivalence test (`getEntitlementMode() === getEntitlementModeSetting().effective` for `''`, `off`, `shadow`, `enforce` allowed and refused, mixed case, whitespace, garbage). `KNOWN_NON_GATE_IMPORTERS` lists **both** symbols for the Health route. The tile's link target (`/admin/business-os-tiers`) shows only the effective mode, so a "refused" amber tile says in its reason where the requested value lives (`BOS_ENTITLEMENTS_MODE` in Vercel, and the `error` log). Record this as a second documented link exception, alongside the cron tiles.
9. **C-9 (F-8) Cost Analytics deep link, and nothing more.** Read `dateFrom` and `dateTo` only when **both** are present, parse as ISO **with an offset**, and satisfy `from ≤ to`; otherwise ignore both (tested). Send them verbatim, never through the `T23:59:59` local-time path. A removable "Linked window … UTC" chip is shown, and any preset or custom-range change clears it. `scope=bos` stays as it is. No change to the drill-down route, the 1,000 banner or the "vs prev period" block. The existing `scope.render.test.tsx` passes unedited.
10. **C-10 No green, enforced three ways.** (i) `TileStatus` has no `'green'` member. (ii) The evaluator test fuzzes inputs and asserts the status is never outside the union. (iii) The Health source guard forbids `green-`/`emerald-` classes and `/\bOK\b/` in the Health page and `app/admin/components/health/**`. The guard is scoped to those files only: the moved legacy dashboard keeps its green classes verbatim. `not_measured` and `unavailable` render distinctly from `neutral` (a render test compares their class sets). No code path can turn tiles 6 and 7 into anything but `not_measured`.
11. **C-11 Thresholds are constants and tests reference them.** Edge tests (below / at / above) are written against the named constants in `thresholds.ts`, not literals. That is what makes "the user may adjust thresholds without re-review" true: a value change needs no test edit. A **rule-shape** change (e.g. Q-5 "only security alarms red", which needs an event allow-list and one more head count) **is** a re-review.
12. **C-12 Local run matches CI.** Add `npm run test:bos-entitlements` (the CI job's exact script) and `npm run test:authz-guard` to §12.4, alongside the path list. Keep `lib/business-os/entitlements` in the path list. Paste real output. The only accepted pre-existing failure is the parked C-13 contract assertion, and it must be named by test name.
13. **C-13 Docs, re-measured, not assumed.** `ADMIN_IDENTIFICATION_AND_ACCESS.md`: add **register row 81** (`health-summary` `GET`, gated from birth) to "Every admin handler and its state". Update the truth-table figures (80/74/6 → as measured) and the page counts (the doc says "21 pages" in one place and R8 "22" in another; there will be one more page, so re-count). Add a Change History entry. `CLAUDE.md` admin row: same figures. (The register fell behind silently once before; do not let it again.)
14. **C-14 Pre-merge measurement gate (owed by the user, read-only SQL, no deploy needed).** L-2, L-3, L-4 and L-5 move from "after deploy" to **before merge**. Add **L-6**: `SELECT count(*) FROM token_usage;` and `SELECT pg_size_pretty(pg_total_relation_size('token_usage'));` (the scan cost is whole-table, not window). Pass criteria: L-2 ≤ 10,000; L-4 = `UTC` (otherwise the audit links change before merge); L-5 execution ≤ ~1 s per page. If L-5 misses, §7.4 escalates before merge. L-1 (route timing) stays post-deploy and is recorded by QA. **Dev runs none of these.**
15. **C-15 Part A.** (a) A-3 covers **both** places the filtered count is called "total": the stat card (`:469-471`) **and** the header pill (`:438`). (b) Replace `logger.debug({ result }, 'Admin users raw response')` (`:205`) with counts only. It logs every login's name and email from the browser, and the file is touched. (c) Keep `data-testid="row-user"` on the name **text** only, so `businessOsPanel.render.test.tsx` (`users` = `['Dana Cohen', 'Agent Only']`) passes unedited. (d) The typed select guard replaces `as any` with a narrowing function, not a cast.
16. **C-16 Accessibility.** No-name row: visible red "No name" text, the `AlertCircle` `aria-hidden`, and a visually-hidden "(needs attention)" in the same text node's container. Not `title`-only (not announced reliably, not keyboard-reachable), and not `role="img"` plus visible text (announced twice). The verified tick beside the email gets an accessible name (visually-hidden "Email verified"), because today it is `title`-only on a `span`. Health: every status has its text label; icons are `aria-hidden`; each figure link has a descriptive accessible name ("Failed AI actions, last 24 hours: 3, open in audit trail"), never a bare number; Refresh sets `aria-busy` while loading; `section` + `aria-labelledby` as planned. The Health sidebar description must not contain "OK" (nav test regex).

### Comments on specific areas

1. **§3 Fact 1 / Q-6: moving the old dashboard.** Safe, as verified above. Nothing links to `/admin` expecting totals, the API is untouched, and a hidden parked entry keeps the "exactly one entry per page" invariant. The acceptance-criterion amendment ("one click **from the Health page**") is a requirement change and goes through BA via TL, as planned (T14). — SA: resolved
2. **§5.2 route.** Pattern-conformant: `requireAdmin` first (nothing, not even Zod, above it), `runtime = 'nodejs'`, `force-dynamic`, no detail outside development. Route tests must also include the admin-check-**throws** → 403 and auth-lookup-**throws** → 401 cases (the gate's fail-closed contract), with no repository call recorded on any denial. — SA: pending (C-7)
3. **Tile 2/4 audit reads.** Six head counts on a ~58k-row table (B0 V-17) are cheap even as sequential scans. L-3 records the live indexes; no index is added in this slice. The failure-rate denominator is `COMPLETED + FAILED`. State that in the tile's threshold text. — SA: resolved
4. **Tile 3 wording.** "USD (estimated)" on every figure; never summed with anything else; no business currency touched (CLAUDE.md Currency rule). — SA: resolved
5. **§13 Pino.** Converting the moved page's single `console.error` is approved and is a basic standard; proceed unless the user declines. Every other touched file has 0 `console.*` (SA counted all nine). — SA: resolved
6. **Revertibility (§9 Stability).** No migration, no route removed. Reverting the PR restores the old landing. — SA: resolved

### Technical implications of the user's questions (SA does not decide these)

| Q | Technical implication only |
|---|---|
| Q-1 | Values are constants (C-11): any value is a no-re-review change. The $20/day placeholder interacts with C-2: absolute floors still work when a figure is a lower bound, ratios do not |
| Q-2 | Dropping the entitlements tile removes the only reason to touch `mode.ts` (F-6/C-8) and one `KNOWN_NON_GATE_IMPORTERS` entry. Dropping any tile is otherwise a pure evaluator/test change |
| Q-3 (a)(c) | UI-only either way. (b) "a Google name counts": the list route already reads the auth user per row, so exposing a display name is a small change to one admin route (Zod unchanged, one more field, tests). It is a follow-up with its own SA pass, not this PR |
| Q-4 | Both options are UI-only. "Always search everyone" means the page sends `status=all` whenever the search box is non-empty, so the filter select would be silently overridden while searching; it needs a visible note. The recommended button keeps the filter truthful |
| Q-5 | "Only security alarms red" needs a code list of event names (a second classification beside `EVENT_METADATA` severities) and one more head count with `.in('action', …)`. That is a rule-shape change (C-11), so SA sees it again. Keeping "any critical → amber" needs nothing |
| Q-6 | If the user wants the legacy dashboard visible in the sidebar, it would have to go into a visible section (the parked section is hidden as a whole). That changes the Monitor pin in the nav test and the "hidden, not removed" assertions. The Health-page link needs neither |

### Optimisation Suggestions (non-blocking)

- A pre-existing quirk in `app/admin/users/page.tsx:161-169`: clearing the search box does not refetch (the effect only fires on a non-empty term), so the list stays filtered by the old term until the status changes. The new "Search all users" button works around it, but the file is open; a one-line fix is reasonable if Dev wants it. Record it either way.
- Offset paging is fine at two pages. If the ceiling is ever approached, keyset paging (`created_at < last OR (= AND id < last)`) removes the offset re-sort, but the real fix remains the index (§7.4).
- The as-of line could also show the window bounds ("last 24 h = 08:14–08:14 UTC") so an admin comparing numbers with a linked page sees the same bounds.

### Approval

[x] Workplan approved, **with conditions C-1 to C-16**. Proceed to implementation once the user has answered Q-1 to Q-6. C-14 (live checks L-2 to L-6, read-only, run by the user) must be recorded before the PR is merged. SA's code review will walk C-1 to C-16 against the diff.

### Addendum: delta review of the revision (T0c)

**Reviewed by SA — 2026-09-26.** Scope: only what changed since the first verdict. That is U-1 (the rule lists), U-3/U-4 (the Businesses row and search), U-6 (the URL-only legacy dashboard), FU-1 to FU-4 and T16.
**Status:** ✅ **APPROVED WITH CONDITIONS.** C-1 to C-16 stand, and C-17 to C-23 are added. **C-17 blocks T12 only.** The other tasks may start now.

**What holds, checked against the revision**

| Area | Verdict |
|---|---|
| **C-10 no green** | Holds, and the type half is stronger: `HealthRule['colour']` admits only `'red' \| 'amber'`, and `TileStatus` has no green. The runtime half (config test on colours) and the fuzz test are kept. The fuzz now has to cover rule lists as well as inputs, because rules are data (C-20) |
| **C-6 purity** | Holds. `rules.ts` is data plus types; the evaluator takes rules as a parameter, never calls `Date.now()`, and imports nothing from `app/**`. The C-1/C-3 work stays in the route's input builder, which is the right side of the line. One addition: the client must not import `rules.ts` or the evaluator at runtime (C-21) |
| **C-1 / C-2 in rule form** | Sound. Every condition kind is **monotone increasing** in its metric, which is exactly why "`atLeast` may fire on a lower bound" is safe. The exact-operands requirement is inside `ratioAtLeast`/`shareAtLeast` rather than left to each rule's author, which is the right place. The baseline-0 case ("new spend", only the floor decides) is well defined. The **one gap** is that the lower-bound catch-all is a *data* rule, so a data edit can delete it (C-18) |
| **C-11 data vs code boundary** | Sound in principle. Values, colours, descriptions, order and new rules over existing kinds are data; new kinds, metrics and flags are code and come back to SA. Two leaks remain: a rule can reference **another tile's** metric (C-19), and a description can go stale when its value is edited (C-22). Any future **non-monotone** kind (e.g. "at most", "dropped below") is by definition a new kind, so it returns to SA, which must then decide how lower bounds behave for it. Record that sentence in `rules.ts`'s header |
| **Tests** | The plan is good: first-match in both orders, headline equals the matched description driven from `HEALTH_RULES`, below/at/above from each rule's own values, "Normal" on no match, and the C-2 cases. The additions are in C-18 to C-21 |
| **U-6 legacy dashboard** | Safe. The page stays client-rendered (R8), is guarded by the layout, and has exactly one data entry in the still-hidden parked section. "Exactly one `hidden: true`" keeps all 13 hidden. The Health-scoped "no `platform-dashboard` link" guard plus H-3 are enough. The acceptance-criterion change goes to BA via TL (T14), as planned |
| **U-4 search** | Matches the ruling. The test "no search widens without the click" is the right pin |
| **FU-1 to FU-4, T16** | Correctly recorded. **FU-1 touches the production signup path**, so it gets its own full cycle (BA → SA), not a short path. **T16 is a merge gate:** QA copies the L-2 to L-6 results into its report, and RM must not merge without them |

**New conditions**

17. **C-17 (blocks T12) The row contradicts itself on the user's original complaint.** A-4 says the Active/Inactive badge moves beside the name "on every row" and also that "no green mark sits beside a no-name". The Active badge **is** green (`bg-green-500/20 text-green-300` + `UserCheck`, `users/page.tsx:699-715`). An active login with no name would therefore show a red "No name" next to a green "Active", which is the exact thing the user reported. The planned test ("no green class on a no-name line") and manual check B-2 would contradict each other. This is a **visual/business choice for the user, via TL, before T12**. SA does not pick. The technical options are all UI-only:
    - (a) render the Active badge in a non-green style everywhere;
    - (b) render it non-green only on no-name rows;
    - (c) the user accepts green Active beside a red No name, and the test and B-2 are reworded.

    Whichever is chosen, the render test pins it.
18. **C-18 "A lower bound is never Normal" is a code invariant, not only a data rule.** In the evaluator: if no rule matched and **any** of the tile's figures is inexact, the tile is amber with a fixed headline ("Total is a minimum; not all calls counted"), never `neutral`. The spend tile's `anyLowerBound` data rule may stay, and it is then redundant but harmless. Without this, deleting or reordering that rule (a permitted data edit) would let a truncated spend tile read "Normal", which C-1 forbids. Test: an empty spend rule list plus a lower-bound input gives amber.
19. **C-19 A tile's rules may name only that tile's own metrics and flags.** Type `HEALTH_RULES` as a mapped type (e.g. `{ spend: HealthRule<SpendMetric>[]; failures: HealthRule<FailureMetric>[]; … }`), and have the config test also assert it at runtime. Otherwise a data edit could colour the settings tile from spend. It would also break per-tile failure isolation: a failed spend read would feed a missing metric into another tile instead of making only the spend tile `unavailable`.
20. **C-20 Config validity at runtime, and the fuzz test.** The evaluator never throws across tiles. If a tile's list fails its checks (order, unique priority, unknown metric), **that tile** is `unavailable` and the evaluator logs at `error` with the rule id. It is never `neutral`, and the page never 500s. CI's `rules.config.test.ts` stays the primary protection. The no-green fuzz generates random **valid rule lists** (any order, any values, both colours, every kind) as well as random inputs, and asserts the status union.
21. **C-21 One source of truth for rules on the client.** The Health page renders the `rules` array from the response. The Health source guard also forbids runtime imports of `lib/admin/health/rules` and `lib/admin/health/evaluateHealth` in the client files; `import type` from `healthTypes` stays allowed.
22. **C-22 Descriptions cannot silently lie after a value edit.** The evaluator generates a plain condition summary from each rule's condition (e.g. "24 h spend ≥ $20", "24 h spend ≥ 3× previous 24 h and ≥ $5", "failure share ≥ 20% of ≥ 10 actions"). The tile's "How this tile is coloured" list shows it beside each description, so the displayed rule is always the applied one. `rules.ts`'s header says that editing a value means re-reading its description in the same diff. `rules.config.test.ts` also asserts that no description matches `/\bOK\b/` (the §9 honesty rule, now that descriptions are data rendered on the page).
23. **C-23 Status column.** Once the badge moves, the column holds only `user.role`, which comes from `authUser.role` (almost always `authenticated`), not `profiles.role`. Leaving the heading "Status" over a near-constant pill is recorded for the user's diff review as planned (R-14). Whatever the user decides, the pill must never be read or labelled as an admin indicator (admin identity is `admin_users` only).

**Optimisation suggestions (non-blocking)**
- Several starting descriptions say "today" ("5+ AI failures today", "Critical events today") over a rolling 24 h window. "In the last 24 hours" is more exact. It is a data edit, so it's the user's wording to change.
- `priority` duplicates list order. Keeping both is fine because the config test ties them, but one of them could go later.

[x] **Revision approved with conditions C-1 to C-23.** T12 waits on the user's C-17 choice; everything else may proceed. SA's code review will walk C-1 to C-23 against the diff.

---

**Code Review by SA — 2026-09-26** (worktree `neuronforge-admin-bos-reorg`, branch `feature/admin-bos-health-landing`, uncommitted on top of `8ff11095`)
**Status:** ✅ **Code Approved (APPROVED WITH NITS).** No High finding. Two gates stay open, and neither is a code defect: **C-17** (the user picks `ACTIVE_BADGE_MODE`) and **C-14** (the user records L-2 to L-6 before merge). RM must not merge until both are closed.

#### Integrity of the diff

- `git diff --stat`: 17 tracked files, +768 / −657. The only large deletion is `app/admin/page.tsx` (−577), and it is matched. The old page (563 lines at `HEAD`) is present at `app/admin/platform-dashboard/page.tsx` (578 lines). A `diff` against `git show HEAD:app/admin/page.tsx` shows exactly three changes: the `createLogger` import, the header comment plus logger constant, and `console.error(…)` → `logger.error({ err: error, period }, 'Failed to fetch dashboard data')`. Nothing else was deleted.
- `grep platform-dashboard` over `app`, `lib`, `components`, `hooks` and `middleware.ts` (tests excluded) finds three hits: the `AdminHeader` title, the sidebar comment, and the hidden parked entry. **No link to it exists anywhere.**
- Note for QA/RM: `lib/admin/health/__tests__/qa-edge.test.ts` and `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.qa-edge.test.ts` appeared **during** this review, presumably QA's. They are not part of the code reviewed here.

#### Conditions, walked against the code

| # | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ | `windows.ts:126`: `completed \|\| oldest < start`, applied **per sub-window**, strict `<`. `completed` is set only on a short page (`AdminTokenUsageAnalyticsRepository.ts`, paging loop), so a read of exactly 10,000 rows, or one cut by de-dup, is never "completed". Tie and ceiling cases tested (`windows.test.ts`) |
| C-2 | ✅ | `evaluateHealth.ts:204, 212`: the exact-operand check sits inside `ratioAtLeast` / `shareAtLeast`. `atLeast` may fire on a lower bound. Figures print "(previous: $Y)", never a multiple |
| C-3 | ✅ | `computeHealthWindows` floors once and is called once, in the route (`route.ts:206`). Current windows are inclusive, previous windows half-open (`windows.ts:109-121`). `grep Date.now\|new Date()` over `lib/admin/health/*.ts` finds nothing. `formatUsd` matches Cost Analytics' `formatCost` (2 to 4 decimals), so H-2 compares like with like |
| C-4 | ✅ | The repository checks `signal.aborted` **before each page** and attaches `.abortSignal()` to every request. `underDeadline` (`route.ts:102-145`) aborts the controller, clears the timer in `finally`, and swallows both a late settle and the deadline promise. Scans are bounded at 10 pages + 1 count = 11. Tests: repository "no further page is requested"; route "signal is aborted", fake timers advanced past the late settle |
| C-5 | ✅ | `AuditTrailRepository.countAdminEventsAllAccountsInWindow`: context first and required; typed `action` / `severity` with a runtime severity allow-list; one of the two required; `select('id', { count: 'exact', head: true })`, so no `details` is read; `info` log carries the filter and the count only. Added to `ADMIN_METHODS`, and the guard pins "no `user_id` filter" as deliberate. Service-role client, as documented in the file header. See comment 3 on the header |
| C-6 | ✅ | `lib/admin/health/**` imports only its own siblings, and nothing names `AdminTokenUsageAnalyticsRepository` (the isolation test passes). `areaState.ts` has no directive and no import, and is typed structurally. The five `business-os-llm` suites pass unedited (18 suites / 413 tests in `lib/business-os/llm` as well) |
| C-7 | ✅ | Response: counts, sums, area keys, the mode word, fixed sentences. `readSettings` reduces the view to numbers and area names, so `lastChangedBy` never leaves the function. The `info` line carries `failure: error.name` (a class), never a message. The route test serialises the body and every `info` / `warn` / `error` argument and asserts no email, no `lastChangedBy` and no DB error text. The 500 path logs `{ err }` server-side, which is the house pattern, and `details` appears only in development |
| C-8 | ✅ | `mode.ts`: one pure `parseModeSetting()`. `getEntitlementMode()` has the same outcomes and the same two `error` logs, with identical payloads. `getEntitlementModeSetting()` drops `raw` and does not log. No new import. The equivalence table covers `undefined`, `''`, whitespace, case, `enforcing`, garbage and refused enforce. `KNOWN_NON_GATE_IMPORTERS` lists only `getEntitlementModeSetting`, which is correct: the route imports only that one, and the test requires the list to equal the imports exactly (§8 allowed this) |
| C-9 | ✅ | `linkedWindow.ts`: both bounds or neither, ISO with an offset, `from ≤ to`. Sent verbatim, ahead of the `T23:59:59` path. A preset or custom-range change clears it, and so does the chip's ✕. The diff touches nothing else on the page, and nothing in the drill-down route, the 1,000 banner or the "vs prev" block. `scope.render.test.tsx` passes unedited. See comment 4 |
| C-10 | ✅ | There is no `'green'` in `TileStatus` or `HealthRule['colour']`. The fuzz runs over random valid rule lists × inputs. The source guard is scoped to the three Health files. `STATUS_STYLES` gives distinct class sets for neutral, not measured and unavailable. Tiles 6 and 7 are built by `notMeasuredTile`, with no rule path |
| C-11 | ✅ | Tests read `HEALTH_RULES`. The header of `rules.ts` states the data/code boundary and the monotonicity sentence |
| C-12 | ✅ | Re-run by SA; see below |
| C-13 | ✅ | SA's own census: **52 route files, 81 exported handlers, 75 `await requireAdmin(` call sites; 24 `page.tsx` under `app/admin`.** This matches `CLAUDE.md` and `ADMIN_IDENTIFICATION_AND_ACCESS.md` (row 81, truth table, Change History) |
| C-14 | ✅ Closed 2026-09-26 | L-2 to L-6 recorded by the user just after merge; all pass. See §15.8 |
| C-15 | ✅ | (a) The pill and the card follow `countLabels(filter)`. (b) The debug line logs only `success` and `rows`. (c) `row-user` is on the name text only (on the "No name" span when there is no name). (d) `toStatusFilter` narrows the select value, so there is no cast |
| C-16 | ✅ | No-name row: red visible text, an `aria-hidden` icon and an `sr-only` " — needs attention". The verified tick has an `sr-only` "Email verified". Health: a text label per status, `aria-hidden` icons, `aria-label` = `linkLabel` (which keeps "at least"), `aria-busy` on Refresh, and `section` + `aria-labelledby`. The sidebar description has no "OK" |
| C-17 | ⬜ **Open: user decision** | `userName.ts:46` `ACTIVE_BADGE_MODE = 'green'` (option c) until the user picks. All three modes are render-tested. Note for the user's choice: the email-verified tick (`UserNameLine.tsx:84`, `text-green-400`) is also green, on the line under a red "No name". It is beside the email, as U-3 asked, but the user should see both greens in the diff review |
| C-18 | ✅ | `evaluateHealth.ts:370-373`: when no rule matches and any metric is inexact, the tile is amber with `LOWER_BOUND_HEADLINE`, whatever the list says. Tested with an empty spend list |
| C-19 | ✅ | `HealthRuleSet` is a mapped type per tile, and `TILE_VOCABULARY` is checked at runtime in `conditionProblem` |
| C-20 | ✅ | `validateRuleList` turns a bad list into `unavailable` for that tile only, via `onRuleError`, which the route logs at `error`. `colourTile` and `safe()` each catch. Nothing throws across tiles |
| C-21 | ✅ | The client files import only `import type` from `healthTypes`. The guard's reader is self-tested against a runtime import |
| C-22 | ✅ | `describeCondition` builds a summary of each condition, and the tile renders it beside the description. The config test and `validateRuleList` both reject "OK" |
| C-23 | ✅ | The heading is "Auth role". The pill is slate, has no shield, and its tooltip says it is not admin access. It is read from `user.role` (auth), never `profiles.role`. The heading wording is still the user's call at diff review (D-5) |

**Deviations D-1 to D-10:** all accepted.
- **D-4**, the one-line business-name match in `getFilteredUsers` (`users/page.tsx:246-248`), is a correct fix inside a touched file. `RowBusiness.companyName` is typed `string | null`, and the optional chaining covers `null` / `undefined`. Without it, U-4's "Search all users" could never show a business found only by its name.
- **D-2**, the input builder in `windows.ts` / `evaluateHealth.ts` rather than in the route, is on the right side of C-6.

#### The new route: specific checks

- `requireAdmin` is the first awaited statement (`route.ts:185`). Only the correlation id and the child logger are built above it, and neither touches a request body, the DB, a queue or a message. Zod runs after the gate, so 401/403 beat 400 (tested). The schema is `z.object({}).strict()` over the search params.
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and the `x-correlation-id` header is used or generated.
- There are no model or temperature literals, and the route is inside both BOS-LLM gates.

#### Verification re-run by SA (real output, 2026-09-26)

| Command | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage lib/business-os/entitlements` | **114 suites: 113 passed, 1 failed; 2,533 tests: 2,532 passed, 1 failed.** The one failure is the accepted parked baseline: `tokenUsageRepository.contract.test.ts` › "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" |
| `npx jest lib/business-os/llm` | 18 suites / 413 tests, all passed |
| `npm run test:bos-entitlements` | 57 suites / 1,106 tests, all passed, exit 0 |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | 251 files in scope, 28 errors, **0 new**, passed. It also reports "1 baseline entry is fixed" (`app/api/onboarding/build/route.ts`), which is pre-existing and not this slice |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, 0 violations, passed |

#### Code Review Comments

1. `app/api/admin/health-summary/route.ts:161-175, 224`: the reads are combined with `Promise.all`, not `allSettled`. Every `underDeadline` call is non-rejecting, so reads are isolated. But `readSettings`' post-processing (the `areaOffSummary` loop and `area.areaIssues` / `call.issues` spreads) runs **outside** `underDeadline`. A malformed view (for example a missing `areaIssues`) would reject `Promise.all` and 500 the whole page instead of making the settings tile `unavailable`. That contradicts §5.1's per-read isolation. The fix is to wrap the reduction in `try`, returning `{ ok: false }`, or to switch to `allSettled`, plus one route test. — Priority: **Medium** (fix before merge recommended; no SA re-review needed)
2. `app/admin/components/health/HealthTile.tsx:130`: the rule list always ends with "Otherwise: Normal." Under C-18, a tile with a lower-bound figure is never Normal. The line is accurate today only because the spend list keeps its redundant `spend.lowerBound` rule; a permitted data edit that deletes that rule would make it false. Suggest "Otherwise: Normal (a total that is only a minimum is never Normal)", or omit the line for tiles that can carry lower bounds. — Priority: Low
3. `lib/repositories/AuditTrailRepository.ts:14`: the header still reads "THE ONE ADMIN EXCEPTION", and the new block below it says "THE SECOND". Reword line 14 to "THE FIRST ADMIN EXCEPTION". — Priority: Low
4. `app/admin/analytics/page.tsx:568`: while a linked window applies, the preset buttons still highlight the default period (30 days), which contradicts the chip. Clearing the chip also leaves `dateFrom` / `dateTo` in the URL, so a reload re-applies it. The chip makes the state visible, so this is cosmetic. — Priority: Low
5. `lib/repositories/AuditTrailRepository.ts:257-260` logs a failed read at `error`, while the sibling admin reads in `AdminTokenUsageAnalyticsRepository` log at `warn`. The route already records the failure in its timings. Pick one level for admin read failures. — Priority: Low

#### Optimisation Suggestions

- `buildAdminSettingsView()` cannot take the abort signal, so its queries run on past the 5 s deadline. That is acceptable at 8 rows; revisit only if L-1 shows it slow.
- Offset paging plus de-dup is correct at two pages. Keyset paging stays the upgrade if the ceiling is ever approached (as noted in the workplan review).

#### Code Approved for QA: **Yes**

The findings above do not block QA. Comment 1 should be fixed before merge (Dev, with one route test; SA does not need to re-review). Merge remains blocked on **C-17** (the user's badge choice) and **C-14** (L-2 to L-6 recorded in QA's report).

---

## QA Testing Report

**QA — 2026-09-26**
**Test mode:** full
**Strategy used:** A (unit: evaluator, windows, rules, helpers) + B (route and repository integration with mocked Supabase/auth) + source guards + a local `next build`. D (Playwright) is not set up in this repo (CLAUDE.md § Testing), so the browser journeys are listed below as manual checks. No live or production database was queried.
**Focus:** all (api, ui, schema, security, performance-by-design)
**Skipped:** E2E (not installed); live checks L-1 to L-6 (owed by the user, C-14); runtime timing (§7.2: no timing claim from mocks)
**Input source:** TL's QA brief (prompt) + this workplan's §12 and the SA conditions C-1 to C-23

**Worktree:** `neuronforge-admin-bos-reorg`, branch `feature/admin-bos-health-landing` @ `8ff11095`, all changes uncommitted. QA changed no production code. It added three probe test files (listed below), which are also uncommitted.

### Verdict: ✅ PASS (conditional)

Every Slice 4 acceptance criterion that can be tested locally passes. There is no High issue. **One Medium bug** (B-1 below, the same finding as SA's code-review comment 1) should be fixed before merge. It needs no SA re-review; QA will re-run the route suite. The merge also stays gated on:
1. **T16: L-2 to L-6** (C-14), which the user runs before merge. The load-budget criterion cannot be judged without them and L-1.
2. **C-17: the Active badge colour.** `ACTIVE_BADGE_MODE` is still `'green'` (`app/admin/users/userName.ts:46`), so an active login with no name shows a red "No name" next to a green "Active". All three modes work and are tested.

### Local run (real output, 2026-09-26)

| Command | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage lib/business-os/entitlements lib/business-os/llm` | **132 suites: 131 passed, 1 failed. 2,946 tests: 2,945 passed, 1 failed.** 23 snapshots passed. Took 50.9 s. This run is before QA's probes were added |
| The only failure | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` › "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional". The diff is the extra `summariseFeatureAllAccountsInWindow`. **Identical on `8ff11095`**, checked in a temporary detached worktree outside the repo (same test fails with the same one-line diff). The worktree was then removed |
| QA probe files (3 new) | **3 suites / 39 tests, all passed** |
| `npm run test:bos-entitlements` | 57 suites / 1,106 tests, all passed |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | 251 files in scope, 28 errors, **0 new**, passed. It also reports "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, which this slice does not touch |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, **0 violations**, passed |
| `npm run lint:hooks` | exit 0 |
| `npx eslint` on the 39 touched and new `.ts/.tsx` files | **0 errors**, 15 warnings. Every warning is on a pre-existing line in `analytics/page.tsx`, `users/page.tsx` or the moved dashboard (unused imports, `any`, hook dependencies) |
| `npm run build` with the CI placeholder env from `.github/workflows/build.yml` | **exit 0**, `✓ Compiled successfully`, 303/303 pages. `ƒ /admin` 6.28 kB, `ƒ /admin/platform-dashboard` 7.61 kB, `ƒ /api/admin/health-summary`. The level-50 lines in the build log are the usual static-render noise from `requireAdminPage` and untouched routes |

### Test Coverage

**Requirement §7 Slice 4 acceptance criteria**

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Every tile links to a page that shows the same number | ⚠️ | Partial (local pass) | Links carry the exact window: audit links use offsetless UTC minutes, and Cost Analytics gets `scope=bos&dateFrom&dateTo` in ISO. The admin audit route does **not** exclude `BUSINESS_AI_ACTION_*` rows (only the owner-scoped repository read does), so the failures link can show the same count. The spend precision matches Cost Analytics (2 to 4 decimals, C-3). **Owed:** H-2 after deploy, and L-4 (DB timezone = UTC) before merge. Documented exceptions: the cron and queue tiles, and the entitlements "refused" reason |
| No tile shows green for something that is not measured | ✅ | Pass | `TileStatus` has no green. Rule colours are only red or amber (the type, the config test, and runtime validation, which QA probed with `colour: 'green'`). The fuzz passes. The Health source guard passes, and `grep` finds no `green-`/`emerald-`/`OK` in the Health files. Tiles 6 and 7 are always `not_measured`, with no link and no rules |
| Page loads within the §9 budget | ⬜ | Not verifiable locally | By design there is one route, a 5 s deadline per read, paging that stops at the deadline (probed), and a ceiling of 10,000. Timing needs L-1 after deploy; L-2, L-5 and L-6 come before merge |
| Old dashboard reachable (as amended by U-6: URL-only, hidden parked entry) | ✅ | Pass | `app/admin/platform-dashboard/page.tsx` is the old page verbatim. Diffed against `8ff11095:app/admin/page.tsx`, the only changes are the header comment, the `createLogger` import and `console.error` → `logger.error`. There are 23 sidebar entries and 13 parked, and the parked section is the only `hidden: true`. The only references to `platform-dashboard` outside tests are the hidden sidebar entry, its comment and the `AdminHeader` title. The Health guard forbids a link. BA amendment of the criterion via TL is still pending (T14) |

**TL brief checks**

| Check | Result | Evidence |
|---|---|---|
| Health route: 401 signed out / 403 non-admin, no read before the gate | ✅ | `route.test.ts` (including the cases where the auth lookup or admin check throws). QA probe: signed out **with** a parameter → 401, and neither `isAdmin` nor any read is called. `requireAdmin` is the first statement (`route.ts:185`); `test:authz-guard` passes |
| 400 for any query parameter | ✅ | QA probe with `?_=<ts>`, `?refresh=`, `?a=1&a=2`, `?scope=bos` and `?dateFrom=…`: each returns 400 with the fixed message, and no read and no mode lookup happens. The page fetches with `cache: 'no-store'` and no parameter |
| A single failed read makes only its own tile unavailable | ✅ / B-1 | `route.test.ts` isolation cases. QA probe: all three read kinds fail at once and the response is still 200. **Gap:** a settings view that *succeeds* with an unexpected shape 500s the whole page (B-1) |
| Nothing leaks in the response or the logs | ✅ | QA probe: a repository error message containing a marker string never appears in the body or in any `info`/`warn`/`error` argument. The response has no email and no `lastChangedBy` (`route.test.ts`). The route logs error **names** only |
| First match wins, and the headline is that rule's description | ✅ | `evaluateHealth.test.ts` (both orders). QA probes at exact thresholds hit the expected `matchedRuleId` |
| No match → "Normal" | ✅ | Unit and route tests. QA boundary probe → `neutral` / "Normal" |
| A lower-bound figure is never "Normal" (C-18) | ✅ | Unit test with an empty rule list. QA probes: the count fails and the read is ceiling-truncated → amber, every figure "at least", no "calls", no OI-P1 note. "At least $25" → red `spend.ceiling24h` (a red absolute rule correctly wins over the amber invariant). A lower bound with an invalid rule list → `unavailable`, not Normal |
| An invalid rule list marks the tile unavailable, without throwing | ✅ | QA probes with 8 bad shapes (missing, `null`, null condition, NaN priority, green colour, another tile's metric, "OK" in a description, unknown kind). Each one: no throw; only the spend tile is `unavailable`; the others stay `neutral`; `onRuleError` is called once with `tile: 'bos_ai_spend'` |
| No green in the Health files | ✅ | Source guard plus `grep` |
| The cron and queue tiles always read "Not measured yet" | ✅ | Unit and render tests; `notMeasuredTile` takes no input |
| Edge: zero previous spend | ✅ | QA probes: $0 against $0 → Normal. $0.99 against $0 → Normal. $1 against $0 → amber "doubled". $5 against $0 → red "tripled". The floor decides, as designed (see E-4 on the wording) |
| Edge: values exactly at a threshold | ✅ / E-1 | QA probes: $20 → red. $6 against $2 → tripled. $2 against $1 → doubled. $7.50 against $5 → week50. 5 failed → red. 2 of 10 → red share. 1 of 10 → amber. 2 of 9 (under minTotal) → amber. Critical = 1 → amber. **But** a float-summed baseline can miss an exact multiple (E-1) |
| Edge: rows on a window boundary | ✅ | QA probe with 8 rows at `end`, `end−24h`, `end−24h−1ms`, `end−48h`, `end−48h−1ms`, `end−7d`, `end−7d−1ms` and `end−14d`. The costs are powers of two, and every sum identifies its rows exactly: 24 h $3 / previous $12, 7 d $63 / previous $192. Row timestamps newer than `end` and unparseable ones are skipped. When the oldest row sits exactly on the 7-day start, the 7-day figure is not exact (strict `<`) |
| Edge: deadline hit partway through paging | ✅ | QA repository probe: the signal aborts while page 1 is in flight → no page 2 request, `{ data: null, error }`. An already-aborted signal → no request at all. A page error on page 3 → no partial figures |
| Edge: the count fails while the rows succeed | ✅ | `route.test.ts` (completed read: exact, no "calls"/note) plus the QA probe above (truncated read: amber, lower bounds) |
| Businesses: defaults to Active | ✅ | `defaultFilter.render.test.tsx`: the first request carries `status=active` |
| Businesses: the counts are relabelled | ✅ | Card and pill say "shown" under a filter and "total" only under All (`countLabels`, render test) |
| Businesses: "No name" is red, with accessible hidden text | ✅ | `userNameLine.render.test.tsx`: null, `''` and whitespace give red "No name" plus sr-only " — needs attention", and the icon is `aria-hidden` |
| Businesses: the tick sits by the email, the badge by the name | ✅ | Render tests (`row-email-verified` with sr-only "Email verified"; `row-activity` inside `row-name-line`). The Status column is now "Auth role" with no shield (D-5 / C-23) |
| Businesses: "Search all users" only when a filtered search returns nothing | ✅ | Render tests: shown only with a search term, a non-All filter and zero rows; never widens without the click; the click re-fetches with `status=all` and the same search |
| Businesses: D-4, a business found by name is shown | ✅ | The U-4 render test searches "acme", which matches only the business name "Acme Therapy", and "Dana Cohen" is shown after the click |
| Businesses: the debug log no longer prints names or emails | ✅ (see E-3) | The raw list-body log is now counts only, pinned by a test. Two other pre-existing debug lines in the same file remain (E-3) |
| Businesses: all three `ACTIVE_BADGE_MODE` values work | ✅ | Render tests pin `'green'`, `'neutral'` and `'neutral-on-no-name'`, and that Inactive is never green. The shipped value is still `'green'` (C-17, open) |
| Cost Analytics: a deep link opens on the exact window | ✅ | `linkedWindow.render.test.tsx`: the bounds are sent verbatim with `scope=bos`; an invalid, offsetless or reversed pair is ignored; a period change or the chip's clear button drops the window. The drill-down route's Zod (`datetime({ offset: true })`, zod 3.25.76) accepts every form the parser allows |
| Cost Analytics: `scope.render.test.tsx` passes unedited | ✅ | No diff against `8ff11095`; it passes. `businessOsPanel.render.test.tsx` and the `business-os-llm` tests are also unedited and passing |

### Issues Found

#### Bugs (must fix before commit)

1. **B-1: A malformed settings view fails the whole page instead of one tile.** File: `app/api/admin/health-summary/route.ts:161-175` (combined at `:225`). Severity: **Medium**. This is the same finding as SA's code-review comment 1, found independently by QA.
   - Steps to reproduce: `buildAdminSettingsView()` resolves with an object whose `areas` (or an area's `areaIssues` / `calls`) is missing.
   - Expected: the settings tile is `unavailable` and the other six tiles render (§5.1 per-read isolation).
   - Actual: the reduction loop runs **after** `underDeadline` has succeeded and outside its guard, so the `TypeError` rejects `Promise.all` and the route returns 500 "Could not build the health summary".
   - Fix: wrap the reduction in `try`, returning `{ ok: false }` (or use `allSettled`), and add one route test.

#### Performance Issues (should fix)

None found locally. Performance is unverified until L-1 to L-6 are done (§7.3).

#### Edge Cases (nice to fix)

1. **E-1: A ratio rule can miss an exact multiple because of float summation.** File: `lib/admin/health/evaluateHealth.ts:207` (and `:215` for share). Severity: Low.
   - Steps to reproduce: the previous 24 h rows cost $2.39 and $2.75 (summed to `5.140000000000001`). The current 24 h costs $15.42, exactly 3×.
   - Expected: red "Spend tripled vs yesterday".
   - Actual: `15.42 >= 3 × 5.140000000000001` is false, so the tile falls to amber "Spend doubled".
   - A random search found such cases quickly. Real `cost_usd` values have 6 or more decimals, so exact ties are rare.
   - Fix shape: compare in integer micro-dollars, or with a small epsilon.
2. **E-2: A window holding exactly 10,000 rows is labelled a lower bound.** File: `lib/repositories/AdminTokenUsageAnalyticsRepository.ts:351-354`. Severity: Informational.
   - When the total equals the ceiling, the loop stops without the empty page that would prove completion, so the figures read "at least".
   - This is conservative and honest, and SA noted the same under C-1. No change is needed.
3. **E-3: Two pre-existing debug lines in the touched users page still carry user data.** File: `app/admin/users/page.tsx:183` logs the admin's search term, which may be an email, inside `queryParams`. `:328-330` logs the whole per-user detailed-stats payload. Severity: Low.
   - This is outside C-15 (b), which covered only the raw list body. It is recorded because the file is touched and the brief asks that the debug log print no names or emails.
4. **E-4: Wording.** Severity: Low (cosmetic).
   - (a) The tile's rule list ends with "Otherwise: Normal." (`app/admin/components/health/HealthTile.tsx:130`). Under C-18 a lower-bound tile with no match is amber, not Normal. This is the same as SA comment 2.
   - (b) With $0 spent the previous day, new spend of $1 or more reads "Spend doubled vs yesterday", and $5 or more reads "tripled". This is correct by design (the floor decides), but the text may confuse. It is a data edit in `rules.ts` if the user wants to change it.

### QA probe tests added (uncommitted, for Dev/RM to keep or drop)

| File | Tests | What it pins |
|---|---|---|
| `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts` | 20 | 400 on 5 parameter shapes with no read; 401 beats 400; the spend and audit windows handed to the repositories; 8 boundary rows; zero previous spend (4 cases); exactly-at thresholds for spend, failures and critical; count fails with a truncated read; error text never leaks to the body or logs |
| `lib/admin/health/__tests__/qa-edge.test.ts` | 14 | 8 invalid rule-list shapes isolate to their tile; a lower bound with an invalid list is unavailable; a red absolute rule beats the lower-bound invariant; the OI-P1 note boundary at 1,000/1,001; `summariseSpend` junk rows, future rows and a strict-`<` tie on the 7-day start |
| `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.qa-edge.test.ts` | 5 | Deadline during page 1 → no page 2; an already-aborted signal → no request; 2,000 rows → completion proven by an empty third page; exactly 10,000 → not completed (E-2); a page-3 error → no partial result |

### Test Outputs / Logs

```text
npx jest <path list incl. lib/business-os/llm>
  FAIL lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts
    ● TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional
        +   "summariseFeatureAllAccountsInWindow",
  Test Suites: 1 failed, 131 passed, 132 total
  Tests:       1 failed, 2945 passed, 2946 total
Same test on a detached worktree of 8ff11095: 1 failed / 4 passed, identical one-line diff.
QA probes: Test Suites: 3 passed, 3 total; Tests: 39 passed, 39 total
test:bos-entitlements: Test Suites: 57 passed; Tests: 1106 passed
test:authz-guard:      Test Suites: 1 passed; Tests: 119 passed
typecheck-bos-llm: 251 files in scope, 28 errors, 0 new (153.3s) — passed
check-bos-llm-literals: 46 files in scope, 2 exempt, 0 violations — passed
lint:hooks: exit 0
eslint (39 files): ✖ 15 problems (0 errors, 15 warnings)
next build (CI placeholder env): ✓ Compiled successfully; ✓ Generating static pages (303/303); EXIT 0
```

### Manual checks for the user

**Before merge (T16, C-14: RM must not merge without these; the SQL is in §15.6):**
1. **L-2**: the number of Business OS rows in the 14-day window. Pass: ≤ 10,000. Record the number.
2. **L-3**: the live indexes on `token_usage` and `audit_trail`. Record them; do not assert a count.
3. **L-4**: `SHOW timezone;`. Pass: `UTC`. Anything else means the audit links must change before merge.
4. **L-5**: `EXPLAIN (ANALYZE, BUFFERS)` of the first spend page. Pass: ≤ ~1 s. A miss escalates §7.4 before merge.
5. **L-6**: the row count and total size of `token_usage`. Record them, and read them together with L-5.
6. **C-17**: choose the Active badge colour ((a) `'neutral'`, (b) `'neutral-on-no-name'`, (c) keep `'green'`), then re-word B-2 below. SA's note: the email-verified tick is also green, one line below a red "No name".

**After deploy (as a platform admin):**
7. **H-1**: `/admin` shows Health with 7 tiles and nothing green. Each coloured tile's headline is one of its listed rules. A quiet tile says "Normal". The job and queue tiles say "Not measured yet" and have no link.
8. **H-2**: click every figure link. The audit trail's total equals the tile's count. Cost Analytics shows the "Linked window … UTC" chip and the same spend at display precision while the calls are ≤ 1,000. When they are above 1,000, the tile shows the OI-P1 note.
9. **H-3**: nothing on screen links to the old dashboard. Typing `/admin/platform-dashboard` opens it with the old totals, titled "Platform dashboard (legacy)".
10. **H-4 / L-1**: open `/admin` three times (one of them cold). Record `totalMs` and the per-read `ms` from DevTools or the `Health summary served` log line. Pass: p50 ≤ 1.5 s.
11. **H-5**: open `/api/admin/health-summary?x=1` while signed in as an admin. Expect 400, "This endpoint takes no parameters".
12. **B-1 (manual)**: `/admin/users` opens on Active users, and the card and pill say "shown". Search for a business that has not signed in for 30 days: you see "No match among active users" and a "Search all users" button, nothing widens until you click it, and after the click the business appears (including when it is found only by its business name).
13. **B-2** A no-name login shows a red "No name" (a screen reader announces "No name — needs attention") next to a **neutral (not green) Active/Inactive badge**; nothing on the name line is green. The badge sits next to the name on every row. The **green** verified tick sits beside the **email**. There is no status or role column. A login with no business still says "No Business OS business" in grey. *(Re-worded for U-7 and U-9, 2026-09-26.)*
14. **B-3**: as a non-admin, `/admin` is refused and `GET /api/admin/health-summary` returns 403. When signed out, it returns 401.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit. The verdict is **PASS (conditional)**: no High issue, and every locally testable criterion passes. **B-1 (Medium)** should be fixed first, with one route test; QA then re-runs the route suite. Merge stays blocked on T16 (L-2 to L-6) and C-17. The load-budget criterion is confirmed only by L-1 after deploy

---

## Commit Info

_(RM to populate. Nothing is committed until the user has reviewed the code and approved.)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Live checks recorded (§15.8) | PR #115 merged, then the user ran L-2 to L-6: 512 BOS rows in 14 days, UTC, 1.637 ms via `idx_token_usage_created_at`, 25,453 rows / 34 MB. All pass. V-22 and R-1 corrected: a `created_at` index exists live (not in the repo), so the spend read is an index range scan. T16 and C-14 closed. L-1 still owed after deploy |
| 2026-09-26 | User choices applied (Dev), uncommitted | **U-7:** `ACTIVE_BADGE_MODE = 'neutral'` (the Active badge is never green; the email tick stays green), TODO removed, B-2 re-worded, the value pinned by a test. **U-8:** "today" → "in the last 24 hours" in three rule descriptions and their tests. **U-9:** the "Auth role" column is removed (header, cell, tooltip, colSpan 7 → 6); C-23 is satisfied by removal. Jest (app/admin, lib/admin, health-summary, entitlements), authz guard, ESLint and next build re-run |
| 2026-09-26 | Review follow-ups (Dev), uncommitted | B-1/SA-1 (settings reduction isolated), SA-2/E-4a (closing line from the evaluator, honest about lower bounds), SA-3 (header wording), SA-4 (no preset highlight under a linked window; clearing strips it from the URL), SA-5 (`warn`), E-1 (integer micro-unit comparisons; $2.39 + $2.75 → $15.42 test), E-3 (users-page debug logs reduced to facts). QA's 3 probe files kept. Jest 134/135 suites (only the C-13 baseline), bos-entitlements 58/58, authz 119/119, typecheck:bos-llm 0 new, literal gate 0, lint:hooks 0, ESLint 0 errors, next build exit 0 (§15.7) |
| 2026-09-26 | QA testing (full) | PASS (conditional). Jest 131/132 suites, 2,945/2,946 tests; the only failure is the parked contract assertion, identical on `8ff11095`. bos-entitlements 57/57, authz guard 119/119, typecheck:bos-llm 0 new, literal gate 0, lint:hooks 0, ESLint 0 errors, next build exit 0 (303/303). 39 QA probe tests added, uncommitted, all passing. One Medium bug (B-1, the same as SA comment 1: a malformed settings view 500s the page); four edge cases (float ratio boundary, exact-ceiling lower bound, two leftover debug lines, wording). Merge still gated on T16 (L-2 to L-6) and C-17 |
| 2026-09-26 | SA code review | APPROVED WITH NITS: C-1 to C-23 walked against the diff, and all are met except C-17 (the user's badge choice) and C-14 (L-2 to L-6 before merge), which stay merge gates. The dashboard move was verified intact: only the Pino conversion and a header comment changed, and nothing links to it. SA's census: 52 files / 81 handlers / 75 `requireAdmin`, 24 pages. Re-run: Jest 113/114 suites (only the parked contract baseline), bos-entitlements 57/57, authz guard 119/119, typecheck:bos-llm 0 new, literal gate 0. One Medium finding: settings post-processing sits outside the per-read isolation (`Promise.all`), so fix it before merge. Four Low findings |
| 2026-09-26 | Implemented (Dev), uncommitted | T1 to T15 done, except the Active badge colour (**C-17, pending the user**): one constant, `ACTIVE_BADGE_MODE`, currently `'green'` (option c); all three options tested (§15.2). C-18 to C-23 applied: a lower bound is never Normal in code; per-tile metric typing plus a runtime check; invalid rule lists → that tile unavailable, a fuzz over rule lists and inputs; no client import of the rules or the evaluator; generated condition summaries, and no "OK" in descriptions; "Status" column → "Auth role" with no admin marker. Deviations D-1 to D-10, including a pre-existing users-list bug fixed (a business-name match was hidden by the client filter). Verification: Jest 113/114 suites (only the parked C-13 baseline), bos-entitlements 57/57, authz guard 119/119, typecheck:bos-llm 0 new, literal gate 0, ESLint 0 errors, next build exit 0 (CI placeholder env). The exact L-2 to L-6 SQL is in §15.6 |
| 2026-09-26 | SA delta review of the revision (T0c) | APPROVED WITH CONDITIONS, adding C-17 to C-23. The rule-list design keeps C-1, C-2, C-6 and C-10 (every condition kind is monotone; the exact-operand checks live inside the kinds). Added: a code-level "lower bound is never Normal" invariant (C-18); per-tile metric typing (C-19); runtime config isolation and a fuzz over rule lists (C-20); no client import of the rules or the evaluator (C-21); generated condition summaries and a no-"OK" description check (C-22). **C-17 blocks T12:** the green Active badge beside a red "No name" contradicts the no-green-beside-no-name rule, so the user decides. U-6 URL-only dashboard: safe. FU-1 needs its own full cycle; T16 is a merge gate |
| 2026-09-26 | Revised after the user's answers (Dev) | U-1 to U-6 recorded (§9). **U-1:** fixed thresholds replaced by ordered rule lists held as data in `lib/admin/health/rules.ts` (`HEALTH_RULES`); first match sets the colour and the headline, no match = grey "Normal"; a closed set of condition kinds with C-2 built in (ratio and share rules need exact operands, `atLeast` may fire on a lower bound, the spend tile's last rule catches lower bounds); the user's starting rules in §6.2; C-11 now applies to `rules.ts` (value, description and order edits are data; a new condition kind, metric or flag is code and re-review). **U-3:** the Active/Inactive badge moves beside the name, the verified tick beside the email, and the no-name treatment follows C-16. **U-4:** "Search all users" button, never a silent widen. **U-5:** critical → amber only. **U-6:** no link to the old dashboard anywhere; URL-only at `/admin/platform-dashboard`, with a hidden parked entry (23 entries, 13 parked, all hidden). Also folded in from SA's conditions: C-14 pre-merge L-2 to L-6 (new L-6), C-12 `test:bos-entitlements`, C-15 both "total" labels and the debug-log fix. Follow-ups FU-1 to FU-4. **Awaits SA's check of the revision (T0c)** |
| 2026-09-26 | SA workplan review | APPROVED WITH CONDITIONS C-1 to C-16. F-1 (a) paged narrow read approved, (b)/(c) kept as the escalation path; F-6 (b) approved with a single shared parser; F-8 (a) in scope and held to a URL-only change. Pre-merge live checks L-2 to L-6 (new L-6: whole-table size). Per-sub-window exactness, ratio rules on exact operands only, deadline stops paging, register row 81 in the admin doc |
| 2026-09-26 | Created (Dev) | Slice 4 (Health landing) plus the Businesses-screen fixes from Slice 2 check M-2, planned as one PR on `feature/admin-bos-health-landing` @ `8ff11095`. 29-point verification log. Seven tiles (five measured, two "Not measured yet"), no green state by type. Spend from a new paged narrow read with exact count and "at least" labelling (no migration). Old dashboard moved to `/admin/platform-dashboard` (hidden parked entry + link from Health). 10 SA forks, 6 user questions, 5 live checks owed by the user |
