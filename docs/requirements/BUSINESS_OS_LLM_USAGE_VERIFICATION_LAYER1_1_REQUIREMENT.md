# Requirement: Business OS LLM Usage Verification — Layer 1.1

> **Last Updated**: 2026-09-17

**Created by:** BA
**Date:** 2026-09-17
**Status:** SA approved — changes applied, ready for Dev workplan (SA review 2026-09-17; RC-1 to RC-14 applied and OQ-U1 answered by the user 2026-09-17)

## Overview

Layer 1 (PR #47, merged) records every in-scope Business OS LLM call in the usage ledger (`token_usage`):
- under the business account it ran for;
- with an area in `feature` (`business-os-<area>`);
- with a stable call name in `component`;
- with a UUID grouping id in `session_id`.

Today the only way to confirm that attribution is correct is a direct database query.

Layer 1.1 gives platform admins a read-only **LLM Usage** tab on the internal Business OS test page (`/test-business-os`):
- A team member runs the Business OS flows under their own account (chat, briefing, website, intake, leads, insights).
- An admin selects that business, sets a start time, and refreshes to see, per check, whether the attribution is correct. No SQL or Supabase access is needed.

Behind the tab sits an admin-only report API. It is the "extended usage report" previously planned for Layer 1.5, which is now delivered here.

**Evidence and context:**
- [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md): ledger mapping, catalog, AC-18/AC-19 QA queries.
- [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md) §I: existing reporting, silent truncation, the admin-gated `chat-usage` pattern.
- [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md): admin identity.
- [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md): test page conventions.
- The [SA Review](#sa-review) below: code evidence for every decision.

---

## Table of Contents

- [User Decisions](#user-decisions)
- [User Stories](#user-stories)
- [Scope](#scope)
- [Definitions](#definitions)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## User Decisions

Recorded 2026-09-17, relayed through the coordinator.

| # | Decision |
|---|---|
| D-1 | **Merge with Layer 1.5's report.** Layer 1.1 takes over the Layer 1.5 "extended usage report" item: it builds the report API now, and this tab is its first UI. Layer 1.5 keeps only the onboarding conversation calls and AI image tracking |
| D-2 | **Admins only.** The API checks admin rights on the server through `AdminAccessService` (the `admin_users` table), never `profiles.role`. The test page being internal is not a protection |
| D-3 | **Start now,** on top of merged `main` (Layer 1, PR #47) |
| D-4 | **One business at a time is enough (OQ-U1).** One selected business per view, plus the platform-wide "nothing on the platform account" check, replaces the planned all-businesses report for now. An all-businesses overview may come later if needed; it would need a database change (SA follow-up F-2) |

---

## User Stories

- As a **platform admin**, I want to pick a business and a start time and see that business's Business OS AI calls since then, so that I can confirm a test session was recorded against the right account with the right area and call names.
- As a **platform admin**, I want each check to show a clear status, so that I can tell at a glance whether attribution is correct without reading raw rows.
- As a **platform admin**, I want to see whether any Business OS AI calls landed on the platform account, so that I know no spend is being lost to the system user.
- As a **platform admin**, I want calls grouped by the action that caused them, so that I can see the full cost of one chat question, one website generation or one insight run.
- As a **platform admin**, I want to see the usage-card breakdown computed exactly as the business owner's card computes it, so that I know the new areas show under the right categories.
- As a **team member running the flows**, I want the admin to refresh while I test, so that problems are spotted during the session, not after it.
- As a **platform operator**, I want this view to be impossible to reach without admin rights, so that one business's usage can't be read by another user.

---

## Scope

### In scope

- An admin-only, read-only **report API** that answers the five checks below for one business account and one time window.
- A read-only **business list API** for the tab's business selector.
- A new **LLM Usage** tab on `/test-business-os`: business selector, start-time controls, refresh and auto-refresh, and the five checks with a status for each.
- A new read-only **`TokenUsageRepository`** (FR-24).
- Extracting the usage card's per-feature totals into a shared module, **`lib/business-os/usage/usageSummary.ts`**, and moving the owner usage route's two `token_usage` reads onto the repository, with no behaviour change to the card (FR-23).
- New shared constants in **`lib/business-os/llm/callCatalog.ts`** (FR-4 to FR-6).
- A new **`BusinessProfileRepository.searchForAdmin`** method (FR-2).
- A new **LLM Usage** section in `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` (FR-21).
- Unit tests for the pure check logic, the constants, the repository guards and `usageSummary.ts`; integration tests for the API routes.

### Out of scope

See [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap). In short:
- no writes, other than `AdminAccessService`'s own admin binding (FR-19);
- no LLM calls;
- no database migration;
- no audit event;
- no all-businesses overview (D-4);
- no admin UI outside the test page;
- no fixes to Layer 1 known issues;
- no change to what the owner's usage card shows;
- no changes to the unauthenticated `/api/admin/**` routes;
- no change to `usageReport.ts` (F-1).

---

## Definitions

All constants below live in `lib/business-os/llm/callCatalog.ts` (SA decision OQ-3), the module that already declares itself "the one place those names exist".

| Term | Meaning | Source of truth |
|---|---|---|
| **Business account** | The `user_id` a business's usage is recorded under. A business is an account | `token_usage.user_id` |
| **Platform account** | The all-zero UUID `00000000-0000-0000-0000-000000000000`, plus `SYSTEM_ADMIN_USER_ID` when set **and a valid UUID** (read at call time; compared case-insensitively). This is where the tracker puts calls with no valid account | `isPlatformAccount(id)` (existing, now exported) and a new `platformAccountIds(): string[]`, both from the same two sources; mirrors `aiAnalytics.ts:121-126` |
| **Current Business OS feature values** | `business-os-<area>` for each area in `BOS_LLM_AREAS` (`chat`, `insights`, `briefing`, `website`, `intake`, `leads`) | `BOS_LLM_AREAS` + `bosFeature()` |
| **Legacy Business OS feature values** | Feature values Business OS calls wrote before Layer 1, keyed by area: insights `insight-generation`, `correlated-insight-generation`, `health-summary-generation`; briefing `business-os`; website `landing-page-generation`; leads `lead-reply`; chat and intake none | New `BOS_LEGACY_FEATURES` (`as const satisfies Record<BosLlmArea, readonly string[]>`) plus a derived flat list. `usageCategories.ts` builds each category from `[bosFeature(area), ...BOS_LEGACY_FEATURES[area]]` |
| **Business OS row filter** | A row is a Business OS row if `feature LIKE 'business-os%'` (covers every current value, unknown `business-os-<typo>` values, and the legacy `business-os`) **or** `feature IN` the flat legacy list. The filter is built only from the constants, never from request input (RC-4) | Derived from the constants above |
| **Unknown area** | A `business-os-<x>` feature value where `<x>` is not in `BOS_LLM_AREAS` and the value is not a legacy value | Derived |
| **Catalog call names** | The call names allowed for an area | `BOS_LLM_CALLS` |
| **Known non-catalog components** | Chat rows that are expected but aren't catalog calls, each with its exemption: `BizQLPlanCache` (zero-token cache-hit row; carries the turn id) is exempt from the **unknown call name** flag only. `IntentParser` (excluded chat v1; no session id) is exempt from **both** the unknown call name flag and the missing grouping id flag (RC-2) | New `BOS_KNOWN_NON_CATALOG_COMPONENTS` (one entry per component, with its reason and its exemptions). `turnUsage.ts` switches its literal to this constant; `IntentParser.ts` is not touched |
| **Legacy helper label** | `feature = 'onboarding'`, `component = 'simple-complete'`: the default of `getProviderFactory().complete()` when no context is passed | New `BOS_LEGACY_HELPER_LABEL`; `providerFactory.ts` may keep its literal, and a unit test asserts the two agree |
| **Window** | From the chosen start time to a **fixed end** = the server time when the request is received. The same end is used for every read in that request, **except Check 5**, which uses the card's computation and has no end bound (open end, shown as such) | FR-9, OQ-4 |
| **Status** | **Pass** (green), **Fail** (red), **Incomplete** (amber: the check couldn't read all rows, never shown as Pass), **Info** (grey: informational or no data), **Not checked** (no refresh yet). Always shown with its text label | FR-11 |

---

## Functional Requirements

### Access control and API

1. **FR-1 — Admin-only report API.** A new route (proposed `GET /api/admin/business-os/llm-usage`) returns the check results for one business account and one window. **Order of checks (RC-3):**
   1. `getUser()`: `401` if not signed in;
   2. `AdminAccessService.getInstance().isAdmin({ id, email })` in an explicit `try/catch`: `403` if not an admin **or if the admin check throws** (fail closed; the route's outer catch alone would return 500);
   3. Zod validation (FR-3): `400` on invalid input.
   - No `token_usage` or `business_profiles` read happens before all three pass.
   - It follows the gate in `app/api/admin/chat-usage/route.ts:37-62`, never reads `profiles.role`, and gates itself in the route (middleware doesn't protect `/api`).
   - It must not extend the existing unauthenticated `app/api/admin/token-usage/**` routes.
2. **FR-2 — Admin-only business list API.** A new route (proposed `GET /api/admin/business-os/llm-usage/businesses`), with the same order of checks as FR-1, returns the businesses the selector can choose from (SA decision OQ-6).
   - **Source:** business profiles, through a new `BusinessProfileRepository.searchForAdmin(search?, limit)`.
   - **Returned per entry:** only `user_id` and `company_name` (nullable). No email or any other personal data.
   - **Also returned (top level):** `platformAccountIds` (ids only), so the tab can warn when "My account" or a pasted id is a platform account (FR-8).
   - **Limits:** optional name search, at most **50** entries, sorted by name.
   - **Search safety (RC-6d):** search text is capped at 100 characters (Zod). It is applied with `.ilike('company_name', …)` after escaping `%`, `_` and `\`, and is never built into an `.or()` filter string.
   - **Documented bypass (RC-6e):** the method carries a code comment that this is an intentional cross-account read (CLAUDE.md Rule 4) and that its only caller is admin-gated.
   - Accounts with no business profile are reached through the pasted-id field (FR-8). There is no "recent usage" list.
3. **FR-3 — Input validation.** Both routes validate all query parameters with Zod, after the admin check (FR-1), and return `400` on invalid input.
   - **Account id:** must be a UUID. It must **not** be a platform account (`isPlatformAccount`): that returns `400` with "This is the platform account; its Business OS rows are shown in Check 2" (RC-5).
   - **Start time:** a valid ISO 8601 timestamp. A start time up to **60 seconds** ahead of server time is clamped to now; more than 60 s ahead returns `400`. It must not be older than the 7-day maximum window, with the same 60 s tolerance (RC-3).
   - **`trigger`:** optional, `manual` or `auto`, default `manual` (FR-10, NFR Logging).
   - **Search (list route):** at most 100 characters.
   - Response shapes follow the project format (`{ success, data }` / `{ success: false, error }`).

### Shared definitions (no hand-typed labels)

4. **FR-4 — Business OS feature values defined once.** In `callCatalog.ts`:
   - current values are derived from `BOS_LLM_AREAS`/`bosFeature()`;
   - legacy values come from `BOS_LEGACY_FEATURES` (per area) and its derived flat list;
   - the Business OS row filter (Definitions) is built from these constants.

   `usageCategories.ts` switches to building its Business OS categories from the same constants, with its output unchanged (the existing `usageCategories.test.ts` must still pass). No check, route or component hand-types a feature, area or call name.
5. **FR-5 — Platform account defined once.** The existing `isPlatformAccount` is exported, and a new `platformAccountIds()` returns the list the repository queries. Both read the same two sources (all-zero UUID; `SYSTEM_ADMIN_USER_ID` at call time). The checks, FR-3 and the attribution builder all use them; nothing copies the rule.
6. **FR-6 — Catalog as the call-name reference.** Whether a row's call name is valid for its area is decided by `BOS_LLM_CALLS`. Exemptions come only from `BOS_KNOWN_NON_CATALOG_COMPONENTS`, applied with the per-component rule in Definitions (RC-2). The legacy helper label comes only from `BOS_LEGACY_HELPER_LABEL`.

### Tab: controls

7. **FR-7 — New tab.** `/test-business-os` gains a tab labelled **LLM Usage**, added the way the page documents (`TABS` array plus a tab block, `app/test-business-os/page.tsx`). Its content lives in a new component under `components/test-business-os/`.
   - If the signed-in user is not an admin, the tab shows a clear "Admins only" message when the API returns `403`, and renders no data.
   - If not signed in, it shows the page's existing sign-in message.
   - **Client/server boundary (RC-8):** the component is a client component. It must not import any runtime value from `lib/business-os/llm/**`, `lib/business-os/usage/**` or `lib/repositories/**`. Response types come from a runtime-free types file imported with `import type` only. Area labels, statuses and "legacy / unknown / expected" flags are computed on the server and returned in the response.
8. **FR-8 — Business selector.** The admin chooses the business account to inspect:
   - a searchable list of businesses from FR-2 (company name, or "(no name)", and a short account id);
   - a **"My account"** shortcut that selects the signed-in user's own account. If that account is a platform account, the tab warns that it can't be used as the test business (RC-5);
   - a field to paste an account id (UUID) directly, for an account without a business profile.
   - **Test page exception:** this tab reads a business other than the session user's. That is an explicit exception to the page's "session user only" model, allowed because it only **reads** ledger metadata and the API is admin-gated on the server (D-2). It must be stated in the tab and in the scope doc.
9. **FR-9 — Start time and window.**
   - A date-time input in the admin's local time zone, sent to the API as UTC ISO 8601.
   - A **"Start now"** button that sets the start time to the current moment. The team member then runs the flows, and later refreshes show only the calls made since.
   - When the tab is first opened, the start time defaults to 1 hour ago.
   - **Maximum window: 7 days.** An older start time is rejected with a clear message (FR-3 tolerances apply).
   - **Fixed end:** the server fixes the end of the window at the time it receives the request, and uses that same end for every read in the request, except Check 5 (open end; `business_os_usage_summary` takes only a start time).
10. **FR-10 — Refresh and auto-refresh.**
    - A **Refresh** button re-runs all checks (`trigger=manual`).
    - An optional **auto-refresh** toggle with a choice of interval: 10, 30 or 60 seconds (`trigger=auto`). It is off by default.
    - **Auto-refresh stops** when the admin leaves the tab, turns it off, changes the business or start time (until the next manual refresh), or a request fails.
    - **Auto-refresh pauses** while the browser tab is hidden (`document.visibilityState === 'hidden'`) and resumes on the next manual refresh (RC-11).
    - While a request is in flight, a new automatic one isn't started.
11. **FR-11 — Status summary.** Above the checks the tab shows:
    - the selected business (name and account id; if the name lookup fails, the report still returns and shows the id only);
    - the window (start time → the server's fixed end; Check 5 marked "open end");
    - the **platform account ids that were checked** (ids only), so a mismatch between the reporting server's environment and the environment that wrote the rows is visible (RC-5);
    - one status per check: **Pass**, **Fail**, **Incomplete**, **Info** or **Not checked**, each with its text label (Definitions).
    - The page's shared Debug Logs panel records manual refreshes and every error. Successful automatic refreshes don't add a log line each time, so auto-refresh can't flood the 50-entry panel.

### The checks

All checks use the same window and the same fixed end. "Selected account" means the validated, non-platform account id.

12. **FR-12 — Check 1: Calls.**
    - **What is read (RC-1, OQ-4):** one bounded paged read of the selected account's Business OS rows (Business OS row filter) in the window:
      - narrow columns only (FR-20);
      - stable order `created_at DESC, id DESC`;
      - 1,000 per page;
      - hard ceiling of **5,000 rows**.
    - **Status** is computed from **all rows read**, not from the displayed rows:
      - **Pass:** at least one row and none flagged.
      - **Fail:** any row flagged.
      - **Info:** no rows ("no Business OS calls for this account in the window").
      - **Incomplete:** the ceiling was reached, the status can't be proven, and it is never Pass.
    - **Flags** (exemptions per Definitions, RC-2):
      - legacy feature value;
      - **unknown area** (RC-4);
      - call name not in the catalog for its area, unless its component is exempt from that flag (`BizQLPlanCache`, `IntentParser`);
      - missing grouping id, unless its component is exempt from that flag (`IntentParser` only). A `BizQLPlanCache` row with no grouping id **is** flagged.
    - **Displayed list:** newest first, capped at **500 rows**, with `rowsTruncated` and a warning when more rows were read than displayed (FR-18).
    - **Columns:**
      - time (local);
      - area (server-derived: area name, "legacy" or "unknown");
      - call name (`component`) with its flags;
      - grouping id (`session_id`, shortened, with a copy action);
      - tokens (input + output);
      - estimated cost (USD, labelled "estimated");
      - success.
13. **FR-13 — Check 2: Nothing on the platform account.**
    - **Count:** the number of Business OS rows (Business OS row filter) under any `platformAccountIds()` in the window, from an exact count (`count: 'exact', head: true`).
    - **Status:** Pass when the count is 0; Fail otherwise.
    - **Breakdown:** by feature and call name, from a capped row read (500, narrow columns). It is marked truncated when fewer rows were read than the count.
    - It is platform-wide, not limited to the selected business, because a mis-attributed call has lost its account. The tab states this and shows the platform ids checked (FR-11).
14. **FR-14 — Check 3: No legacy labels.**
    - **(a) Fail if any are found:** rows with a legacy Business OS feature value.
      - The selected account's part comes from Check 1's paged read (Incomplete if that read hit its ceiling).
      - The platform account's part comes from an exact count.
    - **(b) Fail if any are found (a mislabelled call, RC-9):** rows under the **selected account** with the legacy helper label, from an exact count. The helper's default always records the platform account (`userId: 'system'` → platform account), and `feature`/`component` are required in the call context. So such a row can't come from a dropped context: it means a caller explicitly passed those labels with a real account. This is a cheap guard.
    - **(c) Info only, never Fail:** rows under the **platform account** with the legacy helper label.
      - **Shown:** an exact count, plus the timestamps of up to **50** of those rows (timestamps and labels only), so the admin can match them to their own test actions.
      - **Why Info:** since Layer 1 the only live source of these rows is the onboarding conversation (4 calls per session, excluded until Layer 1.5). A website or intake call that lost its context would look identical.
      - **Stated plainly in the tab:** such a lost-context call is only visible here, and the tab can't prove its absence.
    - **Overall status:** Fail if (a) or (b) finds anything; Incomplete if (a)'s selected-account part is incomplete and nothing else failed; otherwise Pass, with (c) shown alongside.
15. **FR-15 — Check 4: Grouped by action.** Computed from Check 1's full paged read (RC-1). One row per grouping id (`session_id`), newest first, showing:
    - area (or "mixed" if calls in the group have more than one area);
    - call count;
    - call names in the order they ran, with counts for repeats (e.g. `planner ×2, analysis`);
    - total tokens and total estimated cost;
    - first and last call time.

    **Ungrouped rows:** Business OS rows with **no** grouping id are listed separately as "ungrouped" and flagged, except components exempt from that flag (`IntentParser`), which are shown as expected (RC-2).

    **Status:** Fail if any flagged ungrouped row exists; Incomplete if the read hit its ceiling and nothing failed; Pass otherwise (Info when no calls).

    **Display:** at most 500 groups, with a warning when truncated.

    **Notes shown in the tab:**
    - insight runs share one grouping id across businesses, so only the selected account's calls are counted (Layer 1 FR-16);
    - a chat turn may lack the plan-cache store embedding (Layer 1 KI-2), which isn't a failure.
16. **FR-16 — Check 5: Usage card view.**
    - **Same computation as the card** (SA decision OQ-2):
      - per-feature totals from `lib/business-os/usage/usageSummary.ts` (FR-23): the `business_os_usage_summary` function first, reading rows only when the function isn't available;
      - categorised by `summariseUsageByCategory`;
      - credits rounded exactly as the card rounds.
    - **Display:** per category: key, calls, tokens and credits. Also the list of feature values that fell into `other`.
    - **Window caveat (RC-10):** this uses the admin's window, while the owner's card uses fixed ranges (24 h to 90 d). The figures match the owner's card on screen only when the windows match. The tab says so.
    - **Status:** Fail if any feature value **observed in the account's data** that matches the Business OS row filter maps to `other`; Info when the account has no usage in the window; otherwise Pass.
    - **Static rules are unit tests, not runtime checks (AC-10):** every current and legacy Business OS value maps to its area's category, and `onboarding` maps to `help`.
    - This check covers all of the account's usage, not only Business OS, because that's what the card shows.
17. **FR-17 — Area totals.** Computed from Check 1's full paged read (RC-1):
    - calls, tokens and estimated cost for each area in `BOS_LLM_AREAS`;
    - one "legacy" line;
    - one "unknown area" line when present.

    Marked Incomplete when the read hit its ceiling. This replaces the "per business × area" figures planned for the Layer 1.5 report (D-1, D-4).

### Truncation and correctness of counts

18. **FR-18 — Exact checks, capped display, no silent failures (RC-1).**
    - **Pass/Fail comes from all rows:**
      - Checks 1 and 4, Check 3(a)'s selected-account part and FR-17 are computed from the full bounded paged read (up to 5,000 rows);
      - Check 2's count and Check 3(a) platform part, (b) and (c) come from exact counts;
      - Check 5 comes from `usageSummary.ts`.
    - **Only what is displayed is capped:**
      - Check 1 rows and Check 4 groups at 500;
      - Check 2's breakdown at 500 rows;
      - Check 3(c)'s timestamps at 50.
      - The response carries `rowsTruncated` (or an equivalent per list) and the cap, and the tab shows a warning on each affected list.
    - **Ceiling:** if the paged read reaches 5,000 rows, the response carries `incomplete: true`. The affected checks show **Incomplete** (never Pass), with the text "more than 5,000 Business OS calls in this window; narrow the start time".
    - **No silent failures:** a read that fails returns an error for that check, shown as **Fail** with a safe error message, never as zero or Pass. A failure in one check doesn't hide the others.

### Read-only and data handling

19. **FR-19 — Read-only.**
    - **No writes:** neither the APIs nor the tab write to any table, **other than `AdminAccessService`'s own admin binding** (the first-time `bindUserId` write to `admin_users`) (RC-12).
    - **No side effects:** no LLM call and no Business OS flow is triggered.
    - **No audit event (SA decision OQ-5):** viewing the tab writes no `AuditTrailService` event and no usage row. Accountability is structured Pino logging (NFR Logging). A `DATA_ACCESSED` event is follow-up F-3.
20. **FR-20 — Minimal data returned.** The report API returns only what the checks display:
    - timestamps, feature, component, `session_id`, token counts, estimated cost, success flag;
    - for failed calls, the error code but **not** the error message text;
    - no prompts, responses, request payloads or metadata;
    - no emails;
    - no names beyond the selected business's name (and company names in the business list).
    - **Column allow-list (RC-6b):** `TokenUsageRepository` selects only the columns needed. `request_payload`, `response_metadata`, `metadata` and `error_message` are never selected.

### Documentation

21. **FR-21 — Test page scope doc.** `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` gains a **Tab: LLM Usage** section in the page's standard structure (Purpose / Features / API Endpoints Used / Use Cases). It states:
    - the admin-only access;
    - the business-selection exception to the session model;
    - the checks, their statuses (including Incomplete) and pass rules;
    - the display caps and the 5,000-row ceiling;
    - the Check 5 window caveat;
    - a step-by-step "verify a test session" use case, **to be run in a non-production environment only**, because the insight run step spends LLM tokens for every active business (RC-13).

    Its Table of Contents and Change History are updated. The existing statement that Overview is the only tab, and the tab list, are corrected so they are not false; documenting the Danger Zone tab in depth is a follow-up, not part of 1.1 (TL ruling 2026-09-17).
22. **FR-22 — Roadmap update (verify and finish, RC-14).** The Layer 1.1 roadmap edits to the Layer 1 requirement and the investigation doc were already made in this worktree. The workplan verifies that both:
    - show Layer 1.1;
    - no longer list the extended usage report under Layer 1.5;
    - record the D-4 (OQ-U1) decision.

    It finishes any gap; it doesn't rewrite them.

### Shared data access

23. **FR-23 — Usage summary extracted, card unchanged (SA decision OQ-2).** The per-feature totals logic in `app/api/business-os/usage/route.ts` moves into **`lib/business-os/usage/usageSummary.ts`**.
    - **The module owns:**
      - the `UsageSummary` type;
      - the "database function first, rows as fallback" rule, including null meaning "not migrated";
      - the BIGINT-as-string coercion;
      - no double-counting of day buckets;
      - reading tokens per Pilot Credit (through `ConfigRepository.getSystemConfig('tokens_per_pilot_credit')`, keeping the rule "positive integer, else 10");
      - the credit rounding.
    - **Raw reads:** the module gets its `token_usage` reads (the `business_os_usage_summary` RPC and the paged fallback) from `TokenUsageRepository`.
    - **The usage route after the change:**
      - it calls the module;
      - its response shape is **byte-for-byte unchanged**;
      - its `summedBy` log field is kept;
      - `readAllowanceCredits` stays in the route.
24. **FR-24 — `TokenUsageRepository` (SA decisions OQ-1, OQ-4).** A new read-only repository in `lib/repositories/`, exported from the repositories barrel.
    - **(a) Methods:** only those 1.1 needs:
      - the usage summary RPC and paged fallback (FR-23);
      - the selected account's bounded paged Business OS read;
      - exact counts;
      - capped breakdown and timestamp reads.
    - **(b) Required account filter (RC-6a):** every method takes a **required** `userId: string` or a **required non-empty** `userIds: readonly string[]`. No method has an optional account filter, and no "omitted means all accounts".
    - **(c) Column allow-list (RC-6b):** FR-20.
    - **(d) Gate first (RC-6c):** an account id reaches the repository only after the admin gate and Zod.
    - **(e) No catalog import (RC-7):** the repository must **not** import `callCatalog.ts`. Feature lists, prefixes and account ids are passed in as parameters; the catalog-aware logic lives in `lib/business-os/usage/`. This keeps `lib/repositories/index.ts` out of the Business OS typecheck scope.
    - **(f) Aggregates:** no database migration and no new function. Exact numbers come from `count: 'exact', head: true` (the `Prefer: count=exact` header, which works on this project), the bounded paged read, and the existing `business_os_usage_summary`.
    - **Not moved in 1.1:** `usageReport.ts` (`getChatUsage`, `getChatPricing`) stays as is (follow-up F-1).

---

## Non-Functional Requirements

- **Security:**
  - Server-side admin gate on both routes through `AdminAccessService`, in the order 401 → 403 → 400, failing closed (FR-1 to FR-3).
  - The target account comes from a validated query parameter, can't be a platform account, and is used only after the gate.
  - Every `token_usage` read is scoped to an explicit account id or the platform ids (FR-24b).
  - No endpoint returns data for more than one business per request. The exceptions are Check 2 and Check 3's platform-account parts, which read only platform-account rows, and the business list, which returns names and ids only.
  - The routes don't rely on middleware, which doesn't protect `/api` (investigation §I.3).
  - The Business OS row filter string is built only from constants (RC-4). Search text is escaped (FR-2).
- **Repository pattern:**
  - All `token_usage` and business-profile reads go through `lib/repositories/` (FR-2, FR-23, FR-24).
  - No direct Supabase calls in the new routes, the new `lib/business-os/usage/` modules, the usage route after FR-23, or the tab component.
- **Performance and caps:**
  - One refresh makes one report API request.
  - **Target:** under **1.5 s** server time for a 7-day window on the busiest known account. For reference, that account had 1,991 rows over 30 days across all features, well under the 5,000 ceiling.
  - **Limits:** paged read 1,000 per page, ceiling 5,000. Display caps 500 rows, 500 groups, 50 timestamps. Business list 50. Maximum window 7 days. Minimum auto-refresh interval 10 s.
  - **Indexes:** queries filter `user_id` (one id or the platform ids) and a `created_at` range first, using the existing `idx_token_usage_user_created`. `feature` is a residual filter over that range. No new index.
- **Logging:**
  - Both routes use `createLogger` with a child logger carrying `correlationId` (from `x-correlation-id` or generated).
  - **Log level by trigger (RC-11):** each report request logs at **info** for `trigger=manual` and at **debug** for `trigger=auto`, with admin user id, selected account id, window start and end, row counts, `incomplete`, truncation flags and each check's status. **Never business names.**
  - Denied access logs at **warn** with the caller's user id.
  - No `console.*` in any new or touched file.
- **Type safety and CI (RC-7):**
  - New files that import the catalog fall under `npm run typecheck:bos-llm` automatically and must pass it. **The baseline JSON must be unchanged.**
  - The Dev runs `npm run typecheck:bos-llm -- --list` before and after and records the scope delta in the workplan. Expected additions: the new usage modules, the two new routes and their tests. The usage route and `turnUsage.ts` are already in scope.
  - TypeScript strict; no implicit `any`.
- **Bundle boundary (RC-8):** the client tab imports only types from server modules (FR-7).
- **Privacy:** only account ids and business names are shown, with no emails. The error message column is never selected (FR-20). Logs carry ids, never names.
- **Usability:** statuses use both colour and a text label. Times are shown in the admin's local zone with the zone named.
- **Reliability:** a failure in one check doesn't hide the others. Each check reports its own error (FR-18).

---

## Acceptance Criteria

**Access and validation (integration tests):**

- [ ] **AC-1** (FR-1, FR-2) — Both routes return `401` with no session and `403` for a signed-in non-admin, and the non-admin case logs at warn level. A signed-in admin (per `AdminAccessService`) gets `200`. A user with `profiles.role = 'admin'` but no `admin_users` entry gets `403`. A non-admin sending invalid parameters gets `403`, not `400` (order of checks).
- [ ] **AC-2** (FR-1) — If the admin check throws, the route returns `403` (fail closed), not `200` or `500`.
- [ ] **AC-3** (FR-3) — For an admin, each of these returns `400` with **no `token_usage` or `business_profiles` read performed**:
  - a non-UUID account id;
  - a platform account id (all-zero UUID, or `SYSTEM_ADMIN_USER_ID` when set), with the "platform account" message;
  - a malformed start time;
  - a start time more than 60 s in the future;
  - a start time older than 7 days (plus 60 s);
  - a search longer than 100 characters.

  A start time up to 60 s in the future is clamped to now and returns `200`.

**Shared definitions (unit tests and code review):**

- [ ] **AC-4** (FR-4, FR-6) — Current Business OS values are derived from `BOS_LLM_AREAS`/`bosFeature()`, and legacy values come from `BOS_LEGACY_FEATURES`.
  - Adding an area to the catalog adds it to every check without any other change (tested with the derived lists).
  - `usageCategories.test.ts` passes unchanged.
  - A code review of the new files finds no hand-typed `business-os-*` feature, area, call-name, known-component or helper-label literal outside `callCatalog.ts`.
- [ ] **AC-5** (FR-5, FR-6) — The exported `isPlatformAccount` and `platformAccountIds()` agree, with `SYSTEM_ADMIN_USER_ID` set and unset. A unit test calling `getProviderFactory().complete()` with a mocked provider and no context shows the recorded feature and component equal `BOS_LEGACY_HELPER_LABEL`.

**Check logic (unit tests on pure functions, no database):**

- [ ] **AC-6** (FR-12) — Given rows covering each case, Check 1 flags exactly:
  - legacy feature values;
  - unknown-area values (e.g. `business-os-webiste`);
  - call names not in the catalog for their area;
  - missing grouping ids.

  Exemptions:
  - a `BizQLPlanCache` row isn't flagged as an unknown call name, but **is** flagged when its grouping id is missing;
  - an `IntentParser` row with no grouping id isn't flagged at all.

  The status is Pass / Fail / Info as specified, computed from all rows, not just the displayed 500. Displayed rows are newest first.
- [ ] **AC-7** (FR-13, FR-11) — Check 2 is Pass for a count of 0 and Fail for any other count. The breakdown sums to the count when not truncated, and is marked truncated when fewer rows were read than the count. The response lists the platform account ids that were checked.
- [ ] **AC-8** (FR-14) — Check 3:
  - fails for a legacy feature value under the selected or platform account;
  - fails for `onboarding`/`simple-complete` under the selected account;
  - reports `onboarding`/`simple-complete` under the platform account as Info only, never Fail, with a count and at most 50 timestamps.
- [ ] **AC-9** (FR-15) — Check 4 groups rows by `session_id` with the correct area (or "mixed"), call count, ordered call names with repeat counts, token and cost totals, and first/last time.
  - It lists and flags ungrouped Business OS rows.
  - An ungrouped `IntentParser` row is shown as expected, not flagged.
  - An ungrouped `BizQLPlanCache` row is flagged.
  - The status is set accordingly.
- [ ] **AC-10** (FR-16) — Check 5 produces the same category totals as `summariseUsageByCategory` for the same per-feature input. It fails when an observed Business OS value maps to `other` (tested by injecting an unmapped `business-os-*` value), and passes when all map correctly. Separate static unit tests assert that every current and legacy Business OS value maps to its area's category and `onboarding` maps to `help`.
- [ ] **AC-11** (FR-17) — Area totals sum calls, tokens and cost per area in `BOS_LLM_AREAS`, with "legacy" and "unknown area" lines, and the lines add up to the total of all rows read.
- [ ] **AC-12** (FR-18) — Truncation and completeness:
  - (a) With more than 500 rows (but under 5,000), Check 1 and Check 4 statuses reflect a flagged row that falls **outside** the displayed 500, and `rowsTruncated` is set.
  - (b) When the paged read reaches 5,000 rows, `incomplete` is set and Checks 1, 3 and 4 and the area totals show Incomplete, never Pass.
  - (c) Exact counts and Check 5 are unaffected by display caps.
  - (d) A failing read yields a Fail with an error for that check, never zero or Pass, and the other checks still return.

**API behaviour, repository and data access (integration tests and code review):**

- [ ] **AC-13** (FR-12–FR-18, NFR Security) — For an admin request, the API returns all five checks, the area totals and the checked platform ids for the requested account and window only. Rows of another business account in the same window don't appear in Check 1, Check 3(a)/(b), Check 4, Check 5 or the area totals. All reads use the same fixed window end, except Check 5 (open end).
- [ ] **AC-14** (FR-19, FR-20) — With the report's repositories and the provider layer mocked, the route makes no insert, update or delete and no provider or LLM call. It writes no `AuditTrailService` event. `AdminAccessService`'s own binding write is out of this check (RC-12). The response contains none of `request_payload`, `response_metadata`, `metadata`, `error_message`, email or prompt text.
- [ ] **AC-15** (FR-2) — The business list:
  - returns at most 50 entries, each containing only account id and company name, plus the top-level `platformAccountIds`;
  - honours the name search;
  - treats `%`, `_` and `\` in the search as literal characters (escaping tested);
  - contains no email.

  Code review finds `searchForAdmin` selects only `user_id, company_name`, builds no `.or()` string from input, and carries the documented-bypass comment.
- [ ] **AC-16** (NFR Repository, RC-7, RC-8) — Code review finds:
  - no direct `supabaseServer.from(`, `.rpc(` or `createClient(` call in the new routes, the new `lib/business-os/usage/` modules, the usage route after FR-23, or the tab component;
  - `TokenUsageRepository` doesn't import `callCatalog.ts`;
  - the tab component imports no runtime value from `lib/business-os/llm/**`, `lib/business-os/usage/**` or `lib/repositories/**` (type-only imports allowed);
  - the workplan records the `typecheck:bos-llm --list` scope before and after, and the baseline JSON is unchanged.

**Tab (component tests or QA run; the workplan states which):**

- [ ] **AC-17** (FR-7, FR-8) — The LLM Usage tab appears on `/test-business-os`.
  - A non-admin sees "Admins only" and no data.
  - An admin can select a business by search, by "My account" or by pasted account id.
  - "My account" warns when it is a platform account.
  - The tab states that it reads a business other than the session user's, and why.
- [ ] **AC-18** (FR-9, FR-10) — Controls:
  - "Start now" sets the start time to the current moment.
  - Auto-refresh is off by default, runs at the chosen interval with `trigger=auto`, and never overlaps requests.
  - It pauses while the browser tab is hidden, and stops on leaving the LLM Usage tab, on a failed request, or on changing business or start time.
  - Manual refreshes send `trigger=manual`.
- [ ] **AC-19** (FR-11, NFR Logging) — Each check shows a text status and colour, including Incomplete. The platform account ids checked are shown. Successful automatic refreshes add no Debug Logs entries; manual refreshes and errors do. Server logs are at info for manual and debug for auto, and contain no business names.
- [ ] **AC-20** (FR-18) — When a displayed list is capped, the tab shows the truncation warning on that list. When the read is incomplete, the affected checks show Incomplete with the "narrow the start time" message.

**Shared data access (unit tests):**

- [ ] **AC-23** (FR-23) — `usageSummary.ts` has a regression test covering:
  - the database path;
  - the fallback path when the RPC errors;
  - BIGINT-as-string coercion;
  - no double-counting of day buckets;
  - the tokens-per-credit rule (positive integer, else 10).

  The usage route's response for the same inputs is unchanged (asserted by test or by a documented before/after comparison in the workplan). Its `summedBy` log field is present.
- [ ] **AC-24** (FR-24) — Each `TokenUsageRepository` method has a unit test asserting that its account filter (one id, or a non-empty id list) is always applied. The type signature makes the account parameter required, and an empty id list is rejected. A test asserts the `select` string excludes `request_payload`, `response_metadata`, `metadata` and `error_message`.

**End-to-end QA run (non-production environment only):**

- [ ] **AC-21** (all checks) — **In a non-production environment only** (the insight run spends LLM tokens for every active business; RC-13), a team member, as a test business, clicks "Start now", then runs:
  - a chat question (cache miss and cache hit);
  - the daily briefing;
  - a full website generation;
  - a landing page;
  - testimonial enhance;
  - an intake form generation and a question inference;
  - an incoming lead enquiry;
  - an insight run.

  An admin refreshes the tab and sees:
  - Check 1 listing those calls with correct areas and call names;
  - Check 2 Pass;
  - Check 3 Pass (with (c) Info and timestamps reflecting any onboarding sessions);
  - Check 4 with one group per action;
  - Check 5 Pass;
  - area totals matching Check 1.

  The results match a direct ledger query for the same account and the **same fixed window start and end** as the report (Layer 1 AC-18/AC-19 queries); Check 5 is compared with an open end. Known Layer 1 caveats apply: a missing plan-cache store row (KI-2) and intake forms falling back (KI-6) are not failures of this tab.
- [ ] **AC-22** (FR-21, FR-22) — Documentation:
  - `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` has the LLM Usage section (including the non-production note and the Check 5 window caveat), a ToC entry and a Change History row.
  - The Layer 1 requirement and the investigation doc show Layer 1.1, no longer list the extended usage report under Layer 1.5, and record D-4.

*AC-23 and AC-24 were added when the SA's required changes were applied; existing AC numbers are kept.*

---

## Out of Scope / Future Roadmap

| Item | Where it goes |
|---|---|
| An all-businesses × areas overview | Not now (D-4, user decision 2026-09-17). If needed later it requires a read-only database function (F-2) |
| An admin page for usage outside the internal test page | Later layer (admin UI) |
| Any write, reset or backfill of usage rows | Not planned |
| Audit event for admin usage views | F-3 (when usage viewing moves to a real admin UI) |
| Database migration or new function for Business OS usage | F-2, only if the 5,000-row ceiling is hit in practice or an all-businesses view is requested |
| Moving `usageReport.ts` onto `TokenUsageRepository` and fixing its two silent failures (unflagged 10,000 cap; error returned as a zeroed report) | F-1 |
| Updating `.claude/skills/new-api-route/SKILL.md:118` (admin routes should use `AdminAccessService`, not `app_metadata.role`) | F-4 |
| Onboarding conversation attribution | Layer 1.5 |
| AI image generation tracking | Layer 1.5 (OQ-7 in Layer 1) |
| Model configuration per call | Layer 2 |
| Dollar-cost accuracy (the estimated cost shown here inherits Layer 1's known pricing gaps) | Later layer |
| Per-action audit events for Business OS AI activity | Later layer |
| Fixing Layer 1 known issues (KI-1 to KI-6, OI-1 to OI-3) | Separate items |
| Authentication on the existing unauthenticated `/api/admin/**` routes | Separate security fix |
| Changing what the owner's usage card shows | Not in 1.1 (FR-23 is a no-behaviour-change extraction) |
| Touching `IntentParser.ts` (excluded chat v1) | Not in 1.1 |

---

## Open Questions

All questions are resolved. Details and code evidence are in the [SA Review](#open-question-decisions).

### For SA (resolved 2026-09-17)

- [x] **OQ-1 — Repository scope.** Resolved: create `TokenUsageRepository` now and move the usage route's two `token_usage` reads onto it; leave `usageReport.ts` for F-1. Applied in FR-23, FR-24.
- [x] **OQ-2 — Reusing the usage card's totals.** Resolved: extract to `lib/business-os/usage/usageSummary.ts`, with no behaviour change and its own regression test. Applied in FR-16, FR-23, AC-23.
- [x] **OQ-3 — Where the shared constants live.** Resolved: `callCatalog.ts`. Export `isPlatformAccount`, and add `platformAccountIds`, `BOS_LEGACY_FEATURES` (per area), `BOS_KNOWN_NON_CATALOG_COMPONENTS` and `BOS_LEGACY_HELPER_LABEL`. Applied in Definitions, FR-4 to FR-6, AC-4, AC-5.
- [x] **OQ-4 — Exact counts and aggregates.** Resolved: no migration. Exact head counts, one bounded paged read (5,000 ceiling), and the existing usage summary function. Applied in FR-12 to FR-18, FR-24(f).
- [x] **OQ-5 — Audit of admin cross-tenant reads.** Resolved: Pino only, no audit event (F-3 later). Applied in FR-19, NFR Logging, AC-14.
- [x] **OQ-6 — Business list source.** Resolved: business profiles via `searchForAdmin`, capped at 50, plus "My account" and a pasted id. Applied in FR-2, FR-8, AC-15.
- [x] **OQ-7 — Truncation flag in `getChatUsage`.** Resolved: not in 1.1; F-1 (two silent failures). Applied in Out of Scope.

### For the user (resolved 2026-09-17)

- [x] **OQ-U1 — Is a single-business view enough to replace the Layer 1.5 report?** Resolved: **yes, for now.** One business at a time, plus the platform-wide "nothing on the platform account" check, is enough. An all-businesses overview may come later if needed and would need a database change (F-2). Recorded as D-4.

---

## Notes on Integration Points

| Area | Files |
|---|---|
| New (final paths in the workplan) | `app/api/admin/business-os/llm-usage/route.ts`, `app/api/admin/business-os/llm-usage/businesses/route.ts`, `lib/repositories/TokenUsageRepository.ts`, `lib/business-os/usage/usageSummary.ts`, a pure check module (e.g. `lib/business-os/usage/llmUsageVerification.ts`), a runtime-free response types file, `components/test-business-os/LlmUsageVerification.tsx`, tests |
| Changed | `lib/business-os/llm/callCatalog.ts` (export `isPlatformAccount`; add `platformAccountIds`, `BOS_LEGACY_FEATURES`, `BOS_KNOWN_NON_CATALOG_COMPONENTS`, `BOS_LEGACY_HELPER_LABEL`); `lib/business-os/usage/usageCategories.ts` (build Business OS categories from the constants, same output); `lib/business-os/bizql/telemetry/turnUsage.ts` (use the component constant, no behaviour change); `app/api/business-os/usage/route.ts` (calls `usageSummary.ts`, response unchanged); `lib/repositories/BusinessProfileRepository.ts` (`searchForAdmin`); `lib/repositories/index.ts` (export the new repository); `app/test-business-os/page.tsx` (new tab entry) |
| Reused, read only | `lib/services/AdminAccessService.ts`, `lib/repositories/ConfigRepository.ts` (`getSystemConfig`), `lib/business-os/usage/usageCategories.ts` (`summariseUsageByCategory`) |
| Not touched | `lib/business-os/IntentParser.ts`, `lib/business-os/bizql/telemetry/usageReport.ts`, `app/api/admin/chat-usage/route.ts`, `app/api/admin/token-usage/**`, `lib/analytics/aiAnalytics.ts` |
| Pattern reference | `app/api/admin/chat-usage/route.ts` (admin gate, Zod, Pino) |
| Docs | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` (new section); Layer 1 requirement and investigation doc (verify roadmap edits, FR-22) |
| DB | `token_usage` (reads only); existing function `business_os_usage_summary` and index `idx_token_usage_user_created`; `business_profiles`, `ais_system_config` (reads only); `admin_users` (read, plus `AdminAccessService`'s own binding write). **No migration** |
| CI | `npm run typecheck:bos-llm` covers new files that import the catalog; baseline unchanged |

---

## SA Review

**Reviewed by SA — 2026-09-17**
**Worktree:** `neuronforge-llm-attribution`, branch `feature/business-os-llm-usage-layer1-1` (off `main` 56fb7dbd, Layer 1 PR #47 merged)
**Status:** 🔄 **APPROVED WITH CHANGES.** The architecture is sound: a read-only, admin-gated report; the repository pattern; reuse of the catalog; no migration. Apply RC-1 to RC-14 before the Dev workplan. None of them changes scope or the user's decisions D-1 to D-3. **BA applied RC-1 to RC-14 on 2026-09-17; OQ-U1 answered by the user on 2026-09-17 (D-4).**

### Summary of the architectural fit

| Area | Verdict | Evidence |
|---|---|---|
| Admin gate | ✅ Correct. It follows CLAUDE.md, not the stale skill. `.claude/skills/new-api-route/SKILL.md:118` still says `app_metadata.role === 'admin'`, which is outdated (SA follow-up F-4). The requirement is right to use `AdminAccessService` | `app/api/admin/chat-usage/route.ts:37-52`; `lib/services/AdminAccessService.ts:98-133` (already fails closed and returns `false` on error) |
| Route location | ✅ `app/api/admin/business-os/llm-usage[/businesses]`. This is the Layer 1.5 admin report (D-1), so it belongs with admin APIs and can be reused by a later admin UI, not tied to the test page. Middleware skips `/api` (investigation §I.3), so each route must gate itself. Do **not** extend the existing unauthenticated `app/api/admin/token-usage/**` routes (they use `createClient` with no gate) | `app/api/admin/token-usage/drill-down/route.ts:2-11` |
| Tenant isolation (`tenant-isolation-guard`) | ✅ With RC-6. Skill Step 1 applies: service-role reads plus a caller-supplied account id. The isolation boundary here is **authorisation** (the admin gate before any read), not ownership. Steps 2–4 (ownership pre-check, field allow-list, trigger/upsert) don't apply because nothing is written. The residual risks are a repository method whose account filter is *optional* (so leaving it out reads every tenant, as `usageReport.ts:194` does) and an unscoped business-name list. RC-6 closes both | skill §Step 1; `usageReport.ts:176-194` |
| Test page model | ✅ The exception is acceptable because it is read-only and enforced on the server. FR-8 already requires it to be stated. The page's "session-based, no impersonation" rule (`docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:43-48`) is about *acting as* a user. This tab only *reads* ledger metadata for an admin | — |
| Provider factory / LLM | ✅ N/A. There are no LLM calls. AC-14 verifies this with mocks | — |
| Zod | ✅ With RC-3 (clock skew, order of checks) | — |
| Scope | ✅ Proportional. There is one scope risk: the status model on truncated data (RC-2). RC-1 settles it without a migration | — |

### Open question decisions

- [x] **OQ-1 — Repository scope. Decision: create `TokenUsageRepository` now, and move the usage route's two `token_usage` reads onto it (the `business_os_usage_summary` RPC and the paged fallback). Leave `usageReport.ts` as a follow-up (F-1).**
  - **Correctness reason for moving the route's reads now:** Check 5 must use the *same source* as the card (FR-16). The only way to share that code without a new route calling `supabaseServer` directly (Mandatory Rule 1, AC-16) is through the repository. Those reads are today at `app/api/business-os/usage/route.ts:113-116` (RPC) and `:180-186` (paging).
  - **Not moving `usageReport.ts`:** `getChatUsage`/`getChatPricing` serve only `/api/admin/chat-usage` and `scripts/chat-usage-report.ts`. Layer 1.1 neither reads nor changes them, and there's no correctness dependency. Track it under the Business OS repo-conformance sweep.
  - `readAllowanceCredits` (`route.ts:246-266`) stays in the route: Check 5 doesn't need it.
- [x] **OQ-2 — Reusing the card's totals. Decision: extract into a new module, `lib/business-os/usage/usageSummary.ts`, with no behaviour change.** This follows the precedent in `usageCategories.ts:4-5` ("Extracted from `app/api/business-os/usage/route.ts` so it can be tested").
  - The module owns:
    - the `UsageSummary` type (`route.ts:91-98`);
    - the "database first, rows as fallback" rule, including the null-means-not-migrated semantics (`:103-107`) and the BIGINT coercion (`:139-142`);
    - `readTokensPerCredit` (`:215-228`) and the `toCredits` rounding (`:313`).
  - The raw reads come from `TokenUsageRepository`. Tokens-per-credit comes from `ConfigRepository.getSystemConfig('tokens_per_pilot_credit')` (`lib/repositories/ConfigRepository.ts:25-38`, same `ais_system_config` table), keeping the route's rule of "positive integer, else 10".
  - The usage route then calls the module. Its response shape is byte-for-byte unchanged, and the "summedBy" log field is kept.
  - A unit test for `usageSummary.ts` covers: database path, fallback path when the RPC errors, BIGINT-as-string coercion, and no double-counting of day buckets. **No test covers the usage route today**, so this test is the regression guard for the refactor.
- [x] **OQ-3 — Where shared constants live. Decision: `lib/business-os/llm/callCatalog.ts`.** The module already declares itself "the one place those names exist" (`callCatalog.ts:10`), and `usageCategories.ts:25` already imports from it. Add:
  1. **Export the existing `isPlatformAccount`** (`callCatalog.ts:125-129`; the builder uses it at `:144`). Add a `platformAccountIds(): string[]` next to it (the all-zero UUID, plus `SYSTEM_ADMIN_USER_ID` when set, read at call time). The repository needs a list to query, and the predicate and the list must come from the same two sources. This mirrors the tracker fallback exactly (`lib/analytics/aiAnalytics.ts:121-126`).
  2. **`BOS_LEGACY_FEATURES` keyed by area** (`as const satisfies Record<BosLlmArea, readonly string[]>`): `insights: ['insight-generation','correlated-insight-generation','health-summary-generation']`, `briefing: ['business-os']`, `website: ['landing-page-generation']`, `leads: ['lead-reply']`, `chat: []`, `intake: []`. Also add a derived flat list. `usageCategories.ts:48-61` switches to `[bosFeature(area), ...BOS_LEGACY_FEATURES[area]]`, so the legacy lists can't drift. Keying by area rather than a flat list is what keeps the category map and the checks in step. The category map's output is unchanged; the existing `usageCategories.test.ts` must still pass.
  3. **`BOS_KNOWN_NON_CATALOG_COMPONENTS`**, with one entry per known component and the reason for each. `BizQLPlanCache` is the cache-hit row: it carries a session id and isn't exempt from grouping (`telemetry/turnUsage.ts:106-111`). `IntentParser` is excluded chat v1: it has no session id and is exempt from grouping (`lib/business-os/IntentParser.ts:120-126`). `turnUsage.ts` switches its literal to the constant: no behaviour change, and it is already in the typecheck scope. `IntentParser.ts` is **not** touched: it is an excluded call, and touching it would widen the diff and pull it into the typecheck scope.
  4. **`BOS_LEGACY_HELPER_LABEL = { feature: 'onboarding', component: 'simple-complete' }`**. Its source is `lib/ai/providerFactory.ts:340-344`, which may keep its literal. A unit test asserts the two agree by calling `complete()` with a mocked provider and no context.
- [x] **OQ-4 — Exact counts and aggregates. Decision: no migration.**
  - **Verified:** PostgREST aggregate functions are disabled (`supabase/migrations/20260929_usage_summary.sql:24-27`, PGRST123). `count: 'exact', head: true` is **not** an aggregate function: it is the `Prefer: count=exact` header and already works on this project (`lib/repositories/BusinessPurgeRepository.ts:117`, `:143`).
  - **Verified:** `business_os_usage_summary` returns only `tokens` and `calls` per feature and per day (`:49-54`). It has **no cost column**, so it can't give per-area cost.
  - **Verified:** the only `token_usage` index in migrations is `idx_token_usage_user_created (user_id, created_at DESC)` (`:98-99`). There is no index on `feature`. Every query below filters `user_id` (one id, or `IN` the two platform ids) plus a `created_at` range first, so `feature` is a residual filter over a small, indexed range. No new index is needed.
  - **How each figure is computed:**

    | Figure | Method | Exact? |
    |---|---|---|
    | Check 2 count | `count: 'exact', head: true`; `user_id IN platformAccountIds()`, window, Business OS feature filter (RC-4) | Yes |
    | Check 2 breakdown | Capped row read (500, narrow columns); breakdown flagged `truncated` when rows < count | Count exact, breakdown may be capped |
    | Check 3(a) platform part, 3(b), 3(c) | `count: 'exact', head: true` each | Yes |
    | Check 1, Check 3(a) selected-account part, Check 4, FR-17 area totals incl. cost | **One bounded paged read** of the selected account's Business OS rows: narrow columns only (FR-20), fixed upper bound `created_at <= requestTime`, stable order `created_at DESC, id DESC`, 1,000 per page, the same paging as `route.ts:177-209`, **hard ceiling 5,000 rows** (RC-1) | Yes, up to the ceiling |
    | Check 5 | `usageSummary.ts` (RPC, falling back to rows) | Yes, same as the card |

  - A new database function is justified only if the ceiling is hit in practice. At the measured busiest account (1,991 rows in 30 days across *all* features, `20260929_usage_summary.sql:10`), a 7-day Business OS-only window is far below 5,000.
- [x] **OQ-5 — Audit of admin cross-tenant reads. Decision: structured Pino logging only in 1.1, no `AuditTrailService` event.**
  - **Precedent:** `/api/admin/chat-usage` already reads across tenants (all accounts, or any `userId`) with Pino only (`route.ts:67-70`). `AUDIT_EVENTS.DATA_ACCESSED` (`lib/audit/events.ts:119`) is defined but has no caller in `lib/` or `app/`, so there is no established cross-tenant read-audit pattern to follow.
  - **Data sensitivity:** FR-20 limits the response to ledger metadata: token counts, labels, timestamps and error codes. It includes no content, emails or prompts. The Requirement already lists per-action audit events as a later layer (Out of Scope).
  - Condition: see RC-11 (log level by trigger), so the manual selection is always an info-level record while auto-refresh doesn't flood the logs. When the admin UI layer is built outside the test page, revisit this as one `DATA_ACCESSED` per (admin, account, start time) selection (F-3).
- [x] **OQ-6 — Business list source. Decision: business profiles (searchable, capped at 50), plus "My account" and a pasted id. No "recent usage" list.**
  - A "recent usage" list needs a distinct `user_id` over `token_usage`. Aggregates are disabled (OQ-4), so that means a new function or paging the table: rejected.
  - `business_profiles` has one row per account (`findByUserId` uses `.single()`, `BusinessProfileRepository.ts:344-348`), and `company_name TEXT` is nullable (`20260721_create_business_profiles.sql:14`).
  - Add a new method, e.g. `BusinessProfileRepository.searchForAdmin(search?, limit)`, that selects **only** `user_id, company_name`. It must carry a code comment documenting the intentional cross-account read (CLAUDE.md Rule 4) and that its only caller is admin-gated. See RC-6 for search escaping.
  - Accounts with no profile are covered by the pasted-id field. That is enough for a verification tool.
- [x] **OQ-7 — `getChatUsage` truncation. Decision: leave for follow-up F-1. Not in 1.1.** 1.1 doesn't call or change it. For the record, it has **two** silent failures, not one: the 10,000-row cap without a flag (`usageReport.ts:192`), and a read error that returns a **zeroed report** (`:198-201`), which breaks the same "never zero on failure" rule this requirement's FR-18 enforces. Fix both together when `usageReport.ts` moves onto `TokenUsageRepository`.

### Required changes

1. **RC-1 (FR-12, FR-15, FR-17, FR-18, AC-12): make the checks exact, and cap only what is displayed.**
   - **Problem:** as written, Check 1 and Check 4 compute Pass/Fail from the newest 500 rows. A bad row outside the cap would still show **Pass**, a false green in a verification tool. And FR-17 area cost has no exact source without paging (OQ-4).
   - **Change:** compute Check 1, Check 3(a) for the selected account, Check 4 and FR-17 from the single bounded paged read (OQ-4 table). Cap only the **rows returned** for display at 500 (`rowsTruncated`), with the existing warning.
   - **Ceiling:** if the paged read reaches its 5,000-row ceiling, the response carries `incomplete: true`. The affected checks show a new status, **Incomplete** (amber, with text), and **never Pass**; FR-17 is marked incomplete.
   - Update FR-11's status list and AC-12 to match. Keep AC-12's "a failing read yields a check error, never zero".

   — **Applied 2026-09-17:** Definitions (Status, Window), FR-11, FR-12, FR-14, FR-15, FR-17, FR-18, AC-6, AC-9, AC-11, AC-12, AC-20, NFR Performance.
2. **RC-2 (FR-12 / FR-15 consistency with Layer 1 §6.4): align the grouping-id exemption.** FR-15 exempts ungrouped `IntentParser` rows, but FR-12 still highlights them as "missing grouping id". Use one rule for both checks, from `BOS_KNOWN_NON_CATALOG_COMPONENTS` (OQ-3):
   - `IntentParser` rows are exempt from both "unknown call name" and "missing grouping id";
   - `BizQLPlanCache` rows are exempt from "unknown call name" **only**, because the cache-hit row carries the turn id (`turnUsage.ts:106-111`; workplan §6.4 pass rule, line 461 onward: "a chat cache-hit row carries the turn id too").

   Update AC-6 and AC-9 to cover a null-session `BizQLPlanCache` row (flagged) and a null-session `IntentParser` row (not flagged).

   — **Applied 2026-09-17:** Definitions (Known non-catalog components), FR-6, FR-12, FR-15, AC-6, AC-9.
3. **RC-3 (FR-1, FR-3, AC-2, AC-3): fix the order of checks and clock-skew tolerance.**
   - **Order:** 401, then 403 (admin), then 400 (Zod), matching `chat-usage/route.ts:37-62`. This also keeps request-shape information away from non-admins.
   - **AC-3 wording:** "with no `token_usage` or `business_profiles` read performed". The admin check itself reads `admin_users`.
   - **AC-2:** needs an explicit `try/catch` around the admin call in the route that returns 403. `AdminAccessService.isAdmin` already swallows errors (`:129-133`); the route's outer catch alone would return 500, as `chat-usage/route.ts:73-76` does.
   - **Skew:** "not in the future" allows **60 s** of skew; a start time up to 60 s ahead of server time is clamped to now. "Start now" uses the browser clock, and a slightly fast client would otherwise get a 400. Apply the same tolerance to the 7-day boundary.

   — **Applied 2026-09-17:** FR-1, FR-2, FR-3, FR-9, AC-1, AC-2, AC-3.
4. **RC-4 (FR-12, FR-13, Definitions): match Layer 1's QA filter, not just the known list.**
   - Layer 1's AC-18 query and pass rule use `feature like 'business-os-%'` (workplan `:450`, `:469`). So an unknown `business-os-<typo>` area fails there, but would be **invisible** to a check that filters only on the known current and legacy values.
   - **Change:** Check 1's paged read and Check 2's count/breakdown select `feature LIKE 'business-os%'` (the prefix also covers the legacy `business-os`) **OR** `feature IN BOS_LEGACY_FEATURES_FLAT`. Check 1 flags any `business-os-*` value whose area is not in `BOS_LLM_AREAS` as "unknown area".
   - The filter string is built only from the constants, never from request input. Add a case for this to AC-6.

   — **Applied 2026-09-17:** Definitions (Business OS row filter, Unknown area), FR-4, FR-12, FR-13, FR-16, FR-17, NFR Security, AC-6, AC-10, AC-11.
5. **RC-5 (FR-8, FR-3): don't accept a platform account as the selected business.**
   - If `isPlatformAccount(accountId)`, return `400` with "This is the platform account; its Business OS rows are shown in Check 2". Otherwise every "wrong account" row would show as correct in Check 1.
   - The tab also warns if the admin's own account ("My account") is a platform account. If `SYSTEM_ADMIN_USER_ID` is a real admin's id, that admin can't be the test business, because the Layer 1 builder already logs an error for those calls (`callCatalog.ts:144-149`).
   - The report response includes the list of platform account ids that were checked, so a mismatch between the reporting server's env and the environment that wrote the rows is visible. Ids only, no names.
   - Add to AC-3 and AC-7.

   — **Applied 2026-09-17:** FR-3, FR-8, FR-11, FR-13, AC-3, AC-7, AC-13, AC-17, AC-19.
6. **RC-6 (NFR Security, NFR Repository, FR-2; tenant-isolation-guard):**
   - (a) Every `TokenUsageRepository` method takes a **required** `userId: string` or a **required non-empty** `userIds: readonly string[]`. No optional account filter, and no "omitted means all accounts" (the anti-pattern at `usageReport.ts:176-194`). Each method has a unit test that the account filter is always applied.
   - (b) Only the columns FR-20 allows are selected. A unit test asserts the `select` string excludes `request_payload`, `response_metadata`, `metadata` and `error_message`.
   - (c) The account id reaches the repository only after the admin gate and Zod.
   - (d) `searchForAdmin` uses `.ilike('company_name', …)` with `%`, `_` and `\` escaped in the user's search text, and never builds an `.or()` filter string from input (PostgREST filter-syntax injection). Search length is capped (e.g. 100 chars) in Zod.
   - (e) The unscoped profile read carries the documented-bypass comment (OQ-6).

   — **Applied 2026-09-17:** FR-2, FR-3, FR-20, FR-24(b–d), NFR Security, AC-15, AC-24.
7. **RC-7 (NFR Type safety and CI): no baseline growth. Watch the repositories barrel.**
   - `scripts/typecheck-bos-llm.ts` pulls in: core files; catalog importers; **barrels that re-export them**; and every **direct importer** of those (`:37-49`). Today the scope is 96 files, and `lib/repositories/index.ts` is **not** in it (`npm run typecheck:bos-llm -- --list`, run 2026-09-17).
   - The `new-repository` skill requires exporting the new repository from `lib/repositories/index.ts` (`SKILL.md:261-262`). If `TokenUsageRepository` imports `callCatalog`, the barrel becomes in-scope, and all **19** files importing `@/lib/repositories` join the scope, bringing pre-existing errors.
   - **Rule:** `TokenUsageRepository` must not import the catalog. It takes feature lists, prefixes and account ids as parameters. The catalog-aware code lives in `lib/business-os/usage/` (core scope, already covered).
   - The Dev runs `npm run typecheck:bos-llm -- --list` before and after and records the scope delta in the workplan. The expected additions are the new usage modules, the usage route (already in scope), the two new routes, and their tests. The baseline JSON must be unchanged.

   — **Applied 2026-09-17:** FR-24(e), NFR Type safety and CI, AC-16.
8. **RC-8 (FR-7, integration table): keep server code out of the client bundle.**
   - The tab component is `'use client'` (it lives in `app/test-business-os/page.tsx`). It must **not** runtime-import `callCatalog.ts`, which imports Node `crypto` and the Pino logger (`:28-30`), nor any repository or `usageSummary.ts`.
   - Area labels, statuses and "legacy/unknown/expected" flags are computed on the server and returned in the response. Response types live in a runtime-free types file, imported with `import type` only.
   - Add to AC-16's code review: "the component imports no runtime value from `lib/business-os/llm/**`, `lib/business-os/usage/**` or `lib/repositories/**`".

   — **Applied 2026-09-17:** FR-7, FR-12 (server-derived area), NFR Bundle boundary, AC-16, Integration Points.
9. **RC-9 (FR-14(b), wording): correct the rationale.**
   - The helper default always records `userId: 'system'` (`providerFactory.ts:340-344`), which the tracker turns into the platform account (`aiAnalytics.ts:121-126`). `feature`/`component` are required in `CallContext` (`baseProvider.ts:8-9`).
   - So an `onboarding`/`simple-complete` row under a business account **can't** come from a dropped context. It can only come from a caller explicitly passing those labels with a real account. Keep 3(b) as a cheap guard, but reword it as "mislabelled call".
   - State plainly in FR-14(c) and in the tab that **a website/intake call that lost its context is only visible as 3(c) Info**; the tab can't prove its absence. To help the admin match those rows with their own test actions, 3(c) lists the capped timestamps (≤ 50) of those platform rows alongside the count. Timestamps and labels only.

   — **Applied 2026-09-17:** FR-14(b), FR-14(c), FR-18, AC-8.
10. **RC-10 (FR-16): clarify what Check 5's window means.** Check 5 uses the **same computation** as the card over the admin's window. The card itself uses fixed ranges (`route.ts:49-51`, 24 h to 90 d), so the figures match the owner's card on screen only when the windows match. Say this in the tab. Also make Check 5's runtime rule concrete:
    - Fail if any feature value **observed in the account's data** that matches the Business OS filter (RC-4) maps to `other`;
    - the static checks (every value in `BOS_LLM_AREAS` + `BOS_LEGACY_FEATURES` maps to its area's category, and `onboarding` maps to `help`) are unit tests (AC-10), not runtime checks, because they can only change with a code change.

    — **Applied 2026-09-17:** FR-16, FR-21, AC-10, AC-22.
11. **RC-11 (NFR Logging, OQ-5):**
    - **Log level by trigger:** the report route takes an optional `trigger` query parameter (`z.enum(['manual','auto']).default('manual')`). Log the cross-account read at `info` for `manual` and at `debug` for `auto`. At a 10 s interval, info-level logging would otherwise produce about 360 lines an hour per open tab.
    - **Log content:** the log carries admin user id, account id, window start and check statuses (as already specified). Never business names.
    - **Pause when hidden:** auto-refresh also pauses while `document.visibilityState === 'hidden'`, and resumes on the next manual refresh. Add to FR-10 and AC-18.

    — **Applied 2026-09-17:** FR-3 (`trigger`), FR-10, NFR Logging, AC-18, AC-19.
12. **RC-12 (FR-19, AC-14): exempt the admin self-heal write.** `AdminAccessService.isAdmin` may write to `admin_users` (`bindUserId`, `:109-113`) the first time an email-matched admin is seen. Word FR-19/AC-14 as "no write other than `AdminAccessService`'s own admin binding". AC-14's mocks cover the report's own repositories and provider layer. — **Applied 2026-09-17:** FR-19, AC-14, Scope, Integration Points (DB).
13. **RC-13 (AC-21): carry over the Layer 1 environment warning.** The insight run step spends LLM tokens for **every** active business (Layer 1 workplan §6.4 environment note, `insight-detect/route.ts:167-203`). Run AC-21 in a non-production environment only. Say so in AC-21 and in FR-21's "verify a test session" use case. Also note that AC-21's direct-query comparison uses the same fixed window end as the report. — **Applied 2026-09-17:** FR-21, AC-21, AC-22.
14. **RC-14 (FR-22, housekeeping):** `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` and the Layer 1 requirement already have uncommitted Layer 1.1 roadmap edits in this worktree (`git status`). The workplan should treat FR-22 as "verify and finish", not "write". Also add the SA follow-ups F-1 to F-4 below to Out of Scope. — **Applied 2026-09-17:** FR-22 ("verify and finish"), AC-22, Out of Scope (F-1 to F-4).

### SA follow-ups (tracked, not in 1.1)

| # | Item | Evidence |
|---|---|---|
| F-1 | Move `usageReport.ts` (`getChatUsage`, `getChatPricing`) onto `TokenUsageRepository`. Fix both silent failures: unflagged 10,000 cap, and error returned as a zeroed report. Make the `userId` filter explicit for the all-accounts case | `usageReport.ts:183-203` |
| F-2 | A DB function for Business OS per-area cost totals, **only if** the 5,000-row ceiling (RC-1) is hit in practice, or if OQ-U1 later asks for an all-businesses view | OQ-4 |
| F-3 | `DATA_ACCESSED` audit event per (admin, account, window) selection when usage viewing moves to a real admin UI | OQ-5; `lib/audit/events.ts:119` |
| F-4 | `.claude/skills/new-api-route/SKILL.md:118` tells admin routes to check `app_metadata.role`; update it to `AdminAccessService` per CLAUDE.md § Security Rules | CLAUDE.md; `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` |

All four are listed in [Out of Scope](#out-of-scope--future-roadmap).

### Technical note on OQ-U1 (user decision, not decided by SA)

This design works whichever way the user answers. If the user later wants an **all-businesses × areas** table, it can't be built the same way: aggregates are disabled and paging every account's rows doesn't scale. It would need a new read-only database function (one migration, F-2), built on the same `TokenUsageRepository` and catalog constants. The single-business view doesn't need one.

**User decision 2026-09-17 (D-4):** one business at a time, plus the platform-wide check, is enough for now; an all-businesses overview may come later and would need F-2.

### Testability

- All ACs are testable once the RCs are applied.
- The pure check logic is in `lib/business-os/usage/`, tested without a database.
- The routes use mocked `getUser`, `AdminAccessService` and repositories.
- `usageSummary.ts` gets its own regression test (OQ-2).
- AC-17 to AC-20 may be QA-run rather than component-tested; the workplan should state which applies. *(Corrected 2026-09-17 by SA: the earlier note said the repo has no React test harness. It has one — `jest-environment-jsdom` and `@testing-library/react`, e.g. `hooks/useSideConsole.test.tsx` — so component and hook tests apply; workplan M-8.)*

### Approval

- [x] Requirement approved for Dev workplan **after** BA applies RC-1 to RC-14. OQ-U1 doesn't block the workplan.
- [x] Conditions met 2026-09-17: RC-1 to RC-14 applied by BA; OQ-U1 answered by the user (D-4). **Ready for Dev workplan.**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created (Draft) | Layer 1.1 requirement from the user's goal and decisions of 2026-09-17: admin-only LLM Usage tab on `/test-business-os` with five checks (calls, nothing on the platform account, no legacy labels, grouped by action, usage card view), area totals and truncation warnings; takes over the Layer 1.5 extended usage report (D-1); admin gate via `AdminAccessService` (D-2); read-only repository; 22 FRs, 22 ACs; 7 SA open questions and 1 user question |
| 2026-09-17 | SA review — approved with changes | SA resolved OQ-1 to OQ-7: `TokenUsageRepository` now, plus the usage route's two reads (usageReport.ts deferred as F-1); totals extracted to `lib/business-os/usage/usageSummary.ts`; constants in `callCatalog.ts` (exported `isPlatformAccount` + `platformAccountIds`, per-area `BOS_LEGACY_FEATURES`, `BOS_KNOWN_NON_CATALOG_COMPONENTS`); no migration (exact head counts + bounded paged read); Pino only, no audit event; business-profile search list; getChatUsage fix deferred. RC-1 to RC-14 for BA to apply: exact checks with display-only cap and an Incomplete status, one exemption rule for IntentParser/BizQLPlanCache, gate/validation order and clock skew, `business-os%` prefix filter, reject platform account selection, required account filters and escaped search, repository must not import the catalog (typecheck barrel), no server imports in the client tab, FR-14(b) rationale, Check 5 window, log level by trigger and pause when hidden, admin self-heal write exemption, non-production AC-21, FR-22 already partly done. Follow-ups F-1 to F-4 |
| 2026-09-17 | RCs applied + OQ-U1 decided — ready for Dev workplan | BA applied RC-1 to RC-14 (each marked in the SA Review): exact Pass/Fail from a bounded paged read with a 5,000-row ceiling and a new Incomplete status, display-only caps; one exemption rule (IntentParser exempt from both flags, BizQLPlanCache from the call-name flag only); 401 → 403 → 400 with an explicit admin-check catch and 60 s skew; `business-os%` row filter with unknown-area flag; platform account rejected as the selected business and the checked platform ids shown; required account filters, column allow-list and escaped search; repository doesn't import the catalog; type-only imports in the client tab; FR-14(b) reworded and 3(c) timestamps; Check 5 window caveat and static rules as unit tests; `trigger=manual|auto` log levels and pause when hidden; admin binding write exempted; AC-21 non-production only; FR-22 as verify-and-finish; F-1 to F-4 in Out of Scope. SA's OQ decisions recorded in the FRs (new FR-23 usage summary extraction, FR-24 `TokenUsageRepository`; constants in `callCatalog.ts`; no migration; Pino only; business-profile list). New AC-23 (usageSummary regression) and AC-24 (repository guards). User decision OQ-U1 recorded as D-4: one business at a time plus the platform-wide check is enough; an all-businesses overview may come later and would need F-2. Status → SA approved, ready for Dev workplan. Final count: 24 FRs, 24 ACs |
| 2026-09-17 | SA wording alignment from the Dev workplan review | Applied SA rulings on workplan Q-1/Q-2/Q-3/Q-5/Q-12 as wording only, no scope change: Check 5 uses an open window end (Definitions Window, FR-9, FR-11, AC-13, AC-21); platform account id from `SYSTEM_ADMIN_USER_ID` only when it is a UUID, compared case-insensitively (Definitions); business list also returns `platformAccountIds` (FR-2, AC-15); name lookup failure doesn't fail the report (FR-11); Check 5 is Info with no usage (FR-16); FR-21 corrects the stale "only tab" statement per TL ruling, Danger Zone documentation is a follow-up; corrected the SA Testability note (a jsdom React test setup exists). Still 24 FRs, 24 ACs |
