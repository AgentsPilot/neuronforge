# Requirement: Admin View of Business OS AI Activity

> **Last Updated**: 2026-09-23

**Created by:** BA
**Date:** 2026-09-22
**Status:** **Approved — 2026-09-22.** All seven open questions are answered and recorded as [Decisions](#decisions). Slice A was approved on the first pass (SA-7 to SA-12 applied) and its workplan is in review. **Gap B is now cleared** on the SA re-check (SA-1 to SA-6, SA-14), with three non-blocking corrections to carry into the B1/B3 workplans — see [SA Re-Check Notes](#sa-re-check-notes).

## Overview

Layers 1, 1.1, 1.5, 2 and 3 of the Business OS LLM work made every Business OS AI call **recorded**: attributed to the right business, catalogued with an area and a call name, grouped by the action that caused it, cost-tracked in the usage ledger (`token_usage`), model-configured from the database, and summarised into one audit entry per AI action. The user then asked the obvious next question: **"is there a view page where an admin can see these calls?"**

The answer today is *partially*. The data is all there and an admin can reach it — but only through three screens that were each built for a different job, and never in one place that answers "what did this business's AI do, did it work, and what did it cost?". This requirement covers two related gaps:

- **Gap A — AI actions can be seen but not filtered.** Business OS AI audit entries land in the existing `/admin/audit-trail` page and their details are readable, but the page's Action and Entity Type dropdowns are hardcoded lists that were never extended, so there is no way to isolate AI activity from every other audited event.
- **Gap B — the two halves of the record are never joined.** The audit entry says *what the product did and whether it worked*; the ledger rows say *what each underlying call cost*. No screen puts them together, so an admin cannot click one AI action and see the calls behind it, or go the other way.

This requirement is **read-only operator visibility**. It changes nothing about what is recorded, attributed, charged or configured. It does, however, need **one database migration** — a grouping query the ledger cannot answer today (F-14) — which is now its own first slice.

**Sits alongside:**
[Layer 1 — Call Attribution](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) ·
[Layer 1.1 — Usage Verification](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md) ·
[Layer 1.5](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) ·
[Layer 2 — Model Settings](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md) ·
[Layer 3 — AI Audit Trail](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md).
Layer 1's roadmap lists "Admin UI for usage or model configuration" and Layer 3 lists "An admin UI for browsing AI audit entries" as *later layers* — **this is that layer**, for the audit and usage halves only. Model configuration keeps its [operator runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) and stays out of scope.

---

## Table of Contents

- [As-Built Findings](#as-built-findings)
- [Personas and the Questions They Ask](#personas-and-the-questions-they-ask)
- [User Stories](#user-stories)
- [Scope](#scope)
- [Decisions](#decisions)
- [Gap A — Make AI Actions Filterable](#gap-a--make-ai-actions-filterable)
- [Gap B — A Combined AI Activity View](#gap-b--a-combined-ai-activity-view)
- [Where Gap B Should Live](#where-gap-b-should-live)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Suggested Slicing](#suggested-slicing)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review Notes](#sa-review-notes)
- [Response to the SA Review](#response-to-the-sa-review)
- [SA Re-Check Notes](#sa-re-check-notes)
- [Change History](#change-history)

---

## As-Built Findings

Read on 2026-09-22 against branch `chore/test-tiering`. These are the facts this requirement is built on; Dev and SA should not have to re-derive them.

**F-1 to F-12** were written in the first draft and **independently re-derived by SA on 2026-09-22 — all twelve hold**. **F-13 to F-18** were added in this revision: F-13, F-14, F-16 and F-18 come from SA's review, F-15 and F-17 were confirmed and extended by BA while applying it.

| # | Finding | Evidence |
|---|---|---|
| **F-1** | **An admin audit browser exists and is properly gated.** `/admin/audit-trail` is a client page backed by `GET /api/admin/audit-trail`, which reads the whole `audit_trail` table with a service-role client and gates itself: 401 signed out → 403 not an admin, via `AdminAccessService`, failing closed when the check throws. The page is also guarded server-side by inheritance from the admin layout | `app/admin/audit-trail/page.tsx`; `app/api/admin/audit-trail/route.ts:23-43`; `app/admin/layout.tsx:40`; sidebar link `app/admin/components/AdminSidebar.tsx:181` |
| **F-2** | **Business OS AI actions DO land in that table and their details ARE readable.** Each action queues one entry with action `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`, entity type `ai_action` and entity id = the grouping id. Its `details` carry area, areas, action type, grouping id, trigger, call count, failed-call count, input/output/total tokens, `estimatedCostUsd`, call names, models, outcome, error code and correlation id. The page's generic key/value fallback renders them — as a flat, unformatted list | `lib/business-os/llm/aiActionAudit.ts:103-121` (the closed `details` shape), `:186-218` (the builder), `:316` (the queued write); `app/admin/audit-trail/page.tsx:788-802` |
| **F-3** | **The dropdowns are hardcoded and stop at AIS / User / Agent events.** The Action `<option>` list offers six `AIS_*`, four `USER_*` and four `AGENT_*` values plus "All Actions". The Entity Type list offers only `agent` and `system`. Neither AI value can be selected | `app/admin/audit-trail/page.tsx:289-309` (actions), `:358-360` (entity types) |
| **F-4** | **The event catalogue could drive those dropdowns today.** `AUDIT_EVENTS` and `EVENT_METADATA` are exported registries with a human description per event, and `AUDIT_ENTITY_TYPES` is a **runtime array** the write routes already validate against. The hand-maintained JSX duplicates both, so this gap recurs every time an event is added — it already has | `lib/audit/events.ts:20+`, `EventMetadata` `:10-14`; `lib/audit/types.ts:21-70` |
| **F-5** | **The free-text search box is not a reliable substitute for a filter.** With a search term the route fetches only `pageSize × 5` rows from the current offset and filters them in memory, while the returned `total` is still the **unfiltered** count. So a search neither scans the whole table nor reports honest totals | `app/api/admin/audit-trail/route.ts:96-102`, `:114-145`, `:172-174` |
| **F-6** | **AI spend IS visible and groupable in the analytics page**, which breaks `token_usage` down by provider, model, activity, user, agent, execution, call, request type, **feature, component and endpoint**. Business OS calls write `feature = business-os-<area>` and a catalogue `component`, so the area and call-name dimensions work. It is gated with `requireAdmin` | `app/admin/analytics/page.tsx`; `app/api/admin/token-usage/drill-down/route.ts:5` (`requireAdmin`), `:48` (the dimension union); `lib/business-os/llm/callCatalog.ts` |
| **F-7** | **The `/test-business-os` "LLM Usage" tab is a correctness harness, not a cost browser.** It answers "is every call attributed?" for **one** business over a window (Layer 1.1 checks), not "what happened and what did it cost?" across the platform | `app/test-business-os/page.tsx:470`; `components/test-business-os/llm-usage/LlmUsageVerification.tsx`; `app/api/admin/business-os/llm-usage/route.ts` |
| **F-8** | **Nothing joins the two halves.** The audit entry (what the action was, outcome, group id, estimated cost) and the ledger rows (the per-call spend) share the grouping id — `entity_id` on the entry, `session_id` in `token_usage` — but no UI follows that link in either direction. **The shared key is not sufficient on its own: see F-13.** There is also no AI view inside the Business OS app itself; an operator must leave it for `/admin` | F-2, F-6, F-13; Layer 3 FR-2 |
| **F-9** | **Two independently-computed cost numbers exist for the same event.** `estimatedCostUsd` in the audit entry is the in-process accumulator's sum of `costUsd` per call; the ledger's `cost_usd` is written per row by the tracker. Layer 3 FR-8 requires them to be equal, with two permitted exceptions: a fire-and-forget row written after the action ended, and a ledger insert that silently failed | `aiActionAudit.ts:184`, `:199`; Layer 3 FR-8, AC-1 |
| **F-10** | **Audit entries are best-effort.** Layer 3 D-4 kept the queued, batched write path unchanged, so an AI audit entry can be **delayed or lost** (KI-B) while its ledger rows survive. Any "one row per action" view built only on `audit_trail` will therefore under-report | Layer 3 KI-B, F-1 to F-3 |
| **F-11** | **Repository-pattern debt on both existing admin routes.** `app/api/admin/audit-trail/route.ts` and `app/api/admin/token-usage/drill-down/route.ts` each construct their own `createClient(... SERVICE_ROLE_KEY)` inline instead of using the repository layer — although suitable repositories now exist: `AuditTrailRepository` (owner-scoped reads only, no cross-account method) and `TokenUsageRepository` (read-only, allow-listed columns, account required by signature, one deliberately-named all-accounts method) | `audit-trail/route.ts:11-14`; `drill-down/route.ts:9-12`; `lib/repositories/AuditTrailRepository.ts:1-31`; `lib/repositories/TokenUsageRepository.ts:1-27` |
| **F-12** | **Two defects on the audit route to fix while it is open.** Its 500 handler returns `error.message` to the client unconditionally (and the 500 on a failed query concatenates `error.message`), against the CLAUDE.md error-response rule; and a stale `// TODO: Add admin role check here` sits directly below the admin check that now exists | `app/api/admin/audit-trail/route.ts:45`, `:106-111`, `:189-195` |
| **F-13** | ✅ **Insights half FIXED 2026-09-25** (`fix/insight-run-group-id-per-business`; cut-over date — see [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) H11). **A grouping id does NOT identify one AI action — and joining on it alone leaks cost across tenants.** ~~`insight-detect` mints `runId = crypto.randomUUID()` **once per cron run, outside the per-business loop**, and passes that same value as `groupId` for **every** business it processes, so one `session_id` spans N businesses and a join on `session_id` alone returns other accounts' cost rows.~~ **Fixed for insights:** a fresh `crypto.randomUUID()` is now minted per business **inside** the loop, so the ledger's `session_id` and the entry's `entity_id` are unique per (run, business); an `InsightRunIds { runId, groupId }` object keeps `insights.detection_run_id` run-level, and passing one where the other belongs no longer compiles. **Still open — the briefing half:** `bosBriefingGroupId(userId, date)` is a **deterministic UUID v5** of user + day, so a re-narration on the same day reuses the group and two audit entries share one `entity_id`. **The row key does NOT change: `(session_id, user_id)` is permanent, not a stopgap** — pre-cut-over rows still carry a shared `session_id` with no discriminator but `user_id`, they are not backfilled, and a query cannot separate the two populations except by date. **Post-fix note for B0:** the audit sub-query's `a.user_id = g.user_id` predicate is load-bearing precisely because of this finding — it is what makes `audit_entry_count` 1 rather than N for historical shared-id groups. Do not "simplify" it away (SA X-2) | `app/api/cron/insight-detect/route.ts:343` (the per-business mint, **inside** the loop at `:294`), `:372` (passed as `runAiAction`'s `groupId`), `:227` (the run-level `runId`, still minted once per invocation); `lib/business-os/llm/callCatalog.ts:362` (briefing — still open); `InsightRepository.ts:1008`, `:2344`, `:2974` (written as `session_id`, all three from `ids.groupId`) |
| **F-14** | **The grouping query Gap B needs does not exist, and cannot be done from the client.** **PostgREST aggregate functions are disabled on this project** (`PGRST123: Use of aggregate functions is not allowed`), so there is no client-side `GROUP BY session_id, user_id` + `SUM(cost_usd)` — the only alternatives are a SQL function or paging every matching row into Node to sum it there, which is the exact defect the usage-summary migration was written to undo (measured: 1,991 rows / 1.77 MB / ~1,190 ms **for one account over 30 days**; this view is cross-account). And **`token_usage` has no index that supports this read** — the only one on the table is `(user_id, created_at DESC)`; there is nothing on `session_id` and nothing on `feature`. **So "no schema change is expected" was wrong: Gap B needs an RPC plus an index** | `supabase/migrations/20260929_usage_summary.sql:20-27` (aggregates disabled, with the measurement at `:6-18`), `:34-40` (the INVOKER reasoning), `:92-93` (the REVOKE), `:98-99` (the only index) |
| **F-15** | **"No audit entry" has four causes and only one of them is KI-B.** (1) **A cache-served chat turn** deliberately writes a zero-token, zero-cost ledger row with `provider: 'cache'`, `model_name: 'cache'` or `cache:<original>` and `activity_type: 'cache_hit'` for a turn that made **no LLM call** — and `runAiAction` writes no entry when `calls.length === 0` (Layer 3 FR-7). (2) **An action that made no call at all** — same FR-7 rule. (3) **`validateIdentities` refuses the entry** when the grouping id or the account is not a UUID, **or when the account is the platform account** — so a ledger row attributed to the platform account is, by design, **permanently unauditable**. (4) **A genuinely lost or delayed entry** — the actual KI-B. **BA's refinement of SA-3:** cause (2) produces no ledger row either, so in a ledger-first view it cannot inflate the count — the only no-call case that does is the deliberate cache row. Cause (3) is self-identifying on both sides and coincides exactly with the buckets in F-16 | (1) `lib/business-os/bizql/telemetry/turnUsage.ts:85` (the function), `:98` (`provider`), `:101` (`model_name`), `:107-110` (`feature`, a known non-catalog `component`, `activity_type: 'cache_hit'`); (2) `aiActionAudit.ts:304`; (3) `aiActionAudit.ts:255` (`isPlatformAccount(accountId)` → `null`), `:306-310` (nothing written); (4) Layer 3 KI-B |
| **F-16** | **Business OS ledger rows exist with no group and with no real account, by design.** `session_id` is **NULL** on two independent paths: `GroupIdFor<'chat'>` is `string \| undefined`, so chat may legitimately call without a turn id; and the tracker **nulls any `session_id` that is not a UUID**. Separately the tracker **diverts any invalid `user_id` to the platform account**. A grouped, ledger-first view will silently drop or nonsensically merge all three unless they are given explicit buckets | `lib/analytics/aiAnalytics.ts:140-146` (session nulled, with the warning), `:131-137` (platform-account fallback, with the warning); `lib/business-os/llm/callCatalog.ts` (`GroupIdFor<'chat'>`) |
| **F-17** | **The two cost numbers are computed from the same in-memory records, so arithmetic can never make them disagree.** `buildAiAuditEntry` reduces `calls: UsageCallRecord[]` and rounds to a micro-dollar; the ledger rows are written per call from those same records. **A mismatch beyond rounding therefore never means "the sums drifted" — it always means one of the two independent writes failed or was diverted**: `trackAICall` logs and swallows every insert failure, a non-UUID `session_id` is nulled, an invalid `user_id` is diverted to the platform account. This is why FR-B6's marker is worth having — it is the only self-check the attribution instrumentation has | `aiActionAudit.ts:182-184` (the reduce), `:198-199` (rounded to 1e-6); `lib/analytics/aiAnalytics.ts:215-226` (insert failure logged and swallowed), `:140-146`, `:131-137` |
| **F-18** | **`TokenUsageRepository` is pinned by contract, and its existing column list does not cover this view.** `tokenUsageRepository.contract.test.ts` asserts the **exact public method set** and each method's arity, so adding a method fails the test unless `EXPECTED_ARITY` is extended in the same commit — and no method can gain an optional account filter. The same test asserts by source text that the repository **imports nothing from `lib/business-os/**`** (Layer 1.1 RC-7). And the existing `LedgerCallRow` allow-list carries no `user_id`, `model_name` or `provider` — **all three are required by FR-B1/FR-B2** — so a new named column list is needed, still excluding `request_payload`, `response_metadata` and `error_message` (the row does carry all three) | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts`; `lib/repositories/TokenUsageRepository.ts:13-17` (the one named all-accounts read), `:19-22` (the import ban), `:24-25` (the allow-list rule), `:51-64` (`LedgerCallRow`); `lib/analytics/aiAnalytics.ts:170-176` (the payload columns that exist) |

---

## Personas and the Questions They Ask

| Persona | Who they are | What they are trying to do |
|---|---|---|
| **Investigating admin** | A platform operator responding to something specific — a complaint, a support ticket, a suspicion | Understand one business's AI behaviour: what ran, in what order, whether it worked |
| **Sweeping admin** | A platform operator doing a periodic cost or health review | Find where the money went and what is failing, across all businesses, without knowing in advance which one to look at |
| **Business owner** | The Business OS customer | **Out of scope for v1** — see [D-2](#decisions) |

The questions these two personas actually ask, and what it takes to answer each today:

| Question | Persona | Today |
|---|---|---|
| "Why did this owner's website copy generation fail yesterday?" | Investigating | Possible, awkwardly: browse `/admin/audit-trail` under "All Actions", scroll or free-text search (F-5), expand a row, read a flat key/value list |
| "What did we spend on insights for this account last week?" | Investigating | Possible: `/admin/analytics`, filter to the user, group by feature. Gives a number, but no list of what ran |
| "Which action burned those tokens?" | Sweeping | **Not answerable in any UI.** The analytics page can reach an expensive `component`, but nothing turns that back into the action it belonged to |
| "Show me every failed AI action in the last 24 hours" | Sweeping | **Not answerable in any UI.** The `_FAILED` event cannot be selected (F-3) |
| "Was this expensive run one big call or forty small ones?" | Investigating | **Not answerable in any UI.** Needs the audit entry and its ledger rows side by side (F-8) |
| "Is anything running that we are not seeing in the audit trail?" | Sweeping | **Not answerable in any UI** — and this is exactly what KI-B (F-10) makes possible |

---

## User Stories

- As a **platform admin**, I want to filter the audit trail to Business OS AI actions, so that I can see AI activity without scrolling past every other audited event.
- As a **platform admin**, I want the audit trail's filters to keep working when we add new event types, so that this gap does not come back every release.
- As a **platform admin investigating one business**, I want a list of the AI actions that ran for it — what the product was doing, whether it succeeded, and what it cost — so that I can explain a failure or a bill without running a database query.
- As a **platform admin**, I want to open one AI action and see the individual AI calls it made, so that I can tell an expensive run from a chatty one.
- As a **platform admin doing a cost sweep**, I want to sort or filter AI actions by cost and by outcome across all businesses in a window, so that I can find the outliers and the failures without knowing where to look first.
- As a **platform admin**, I want to be told when an action's recorded cost and the sum of its underlying calls disagree, so that I do not quote a number that is wrong.
- As a **platform admin**, I want a row to contain **only** the business it belongs to, so that a number I quote to one customer never includes another customer's spend.
- As a **platform admin**, I want spend that has no action record, no group or no real account to be **shown and labelled** rather than dropped or lumped together, so that the screen's totals are the truth and the "we lost an entry" number means something.
- As a **compliance reviewer**, I want this view to show identifiers, counts, labels and numbers only — never a prompt, an owner's words, the model's output or an error message — so that an operator screen does not become a second copy of business content.
- As a **business owner**, I want nothing about this to make my own AI activity or cost visible to me yet, or to anyone outside the platform team.

---

## Scope

### In scope

- **(A)** Making Business OS AI actions selectable in the existing admin audit trail filters, and removing the hand-maintained-list failure mode behind that gap.
- **(B)** A combined, read-only **AI activity** view for platform admins: one row per AI action **per business**, with drill-down to the constituent ledger calls, filterable by business, area, outcome, date window and cost.
- **(B0)** The database migration that view needs — a grouping RPC and a supporting index (F-14).
- Cross-links between the new view and the two existing screens, so an operator is never stranded.
- Fixing the two F-12 defects on the audit route, and routing any new database access through the repository layer.

### Out of scope

| Item | Why |
|---|---|
| **Any owner-facing view of AI activity or AI cost** | Layer 3 **D-6** decided AI entries stay operator-only until the charging decision, and Layer 1.5 KI-A kept AI cost operator-only. **Decided for v1 ([D-2](#decisions)): keep it that way** — this requirement adds no owner-visible surface. Deferred, not rejected |
| Changing what is recorded, attributed, grouped or costed | Layers 1–1.5 own the ledger; Layer 3 owns the entry. This view only reads |
| **Fixing the shared insight `runId` (F-13) at its root** | Minting a per-business group id in `insight-detect` is the root-cause fix, but it changes what is *recorded* and would re-key existing rows. Recorded as a finding for the Layer 3 owners; **this view must be correct against the data as it is** |
| Changing the audit write path (awaited writes, retries, flushing) | Layer 3 D-4 / OI-A / OI-D. The view must cope with KI-B, not fix it |
| **Fixing the free-text search defect (F-5)** | A separate item with real design content: an honest search needs a **DB-level** predicate and a filtered count. Spun out so Slice A stays a filter fix — see [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap) |
| **Converting `app/api/admin/audit-trail/route.ts` to `requireAdmin`** | Explicit non-goal — see [FR-A8](#gap-a--make-ai-actions-filterable). Parked admin-authz slice 4 |
| Model, provider or temperature configuration screens | Layer 2 shipped with an operator runbook; an admin screen is a separate later item |
| Charging, deduction, allowance enforcement | The deduction layer (Layer 1 OI-1, OQ-7, Layer 1.5 UD-1) |
| Alerting, thresholds, scheduled cost reports, exports to finance | Later — [D-5](#decisions) |
| Agents-side (AgentsPilot) AI activity | The agents product has its own audit events and its own `token_usage` dimensions. This view is Business OS. A shared view is a later question |
| Scheduling the 365-day audit retention job | Layer 3 OI-C, unchanged. It does affect how far back this view can look — [D-3](#decisions) |
| Making the audit entry reliable enough to bill from | Out. The ledger remains the money record ([D-1](#decisions)) |

---

## Decisions

These were open questions in the first draft. **All seven are now answered** — by the user on 2026-09-22, or by SA where the question turned out not to be a business fork at all. They are decisions, not options; changing one is a new conversation, not a Dev choice.

### D-1 — The ledger is the money number, and a disagreement marks the row

*(was OQ-1; first half ruled by SA, second half answered by the user)*

**Settled, not a fork:** the **ledger is the money record**. Layers 1 and 1.5 already established that — owner usage and any future charging are built on `token_usage` — so the audit entry's `estimatedCostUsd` is the "what happened" number and never the authoritative one.

**The user's answer to the rest:** when the two disagree, **mark the row and show both numbers**. Do not average, do not silently prefer one, do not hide the other.

**Tolerance: $0.0001** (one ten-thousandth of a dollar), i.e. just above the rounding floor. `buildAiAuditEntry` rounds its sum to a **micro-dollar** (`aiActionAudit.ts:198-199`) while the ledger sums per-row values, so sub-micro-dollar drift is arithmetic noise and nothing else. A threshold at $0.0001 sits two orders of magnitude above that floor — comfortably clear of false positives, and far below any real loss.

**Why this matters more than it looks (F-17):** both numbers are computed from the *same* in-memory `UsageCallRecord` objects. The arithmetic **cannot** disagree. A mismatch beyond rounding therefore always means one of the two independent writes failed or was diverted — `trackAICall` logs and swallows every ledger insert failure (`aiAnalytics.ts:215-226`), a non-UUID `session_id` is nulled (`:140-146`), an invalid `user_id` is diverted to the platform account (`:131-137`). **The mismatch marker is the only self-check the attribution instrumentation has.** That is the reason to build it, and the reason a generous tolerance would defeat the purpose.

### D-2 — Admin-only for v1; owner-facing is deferred, not rejected

*(was OQ-2)*

**The user's answer: admin-only.** No owner-facing AI activity or cost surface in v1 — the user's words were that *maybe in the future we will add it*, so this is **parked, not refused**. It is revisited with the charging decision, for the reason the draft gave: an owner shown a cost they are not charged for creates support questions we cannot answer yet.

### D-3 — A bounded window, preset ranges, and a hard 100-row cap

*(was OQ-3)*

**The user's answer**, which is more specific than the draft assumed:

| Element | Decision |
|---|---|
| **Explicit range** | An admin can set an arbitrary start and end date |
| **Presets** | **Today, Yesterday, This Week, Last Week, This Month, Last Month** — all six |
| **Cap** | **100 rows returned. No more.** |
| **When the cap is hit** | The UI states that these are **the top 100 for the current filter** |

Two constraints carried in from the conversation, both of which are acceptance criteria, not implementation notes:

- **(a) The cap is enforced server-side, in the RPC** — not by trimming in the UI. A UI trim still makes the database scan everything, which would make the B0 index buy nothing and would put the view straight back into the F-5 failure mode.
- **(b) The "top 100 of N" indicator uses an honestly filtered count.** The existing audit page renders "showing X of Y" from an **unfiltered** count (F-5). Reproducing that defect on a brand-new screen would be a regression we walked into with our eyes open. Either the count reflects the same filters as the rows, or no count is shown.

This answer also **sets the index shape for B0** (SA-3's note), so that slice can now be planned concretely: the access path is a window plus a Business OS feature prefix, grouped by `(session_id, user_id)` and ordered by the sort column, with the limit applied in SQL.

### D-4 — Account id **and** company name; never an email, never a name in a log

*(was OQ-4; demoted to a decision by SA — the precedent already answered it)*

A business is identified by **account id plus company name**, resolved through `BusinessProfileRepository`. **Never an email address.** And **never a business name in a log line** — the existing llm-usage route's rule, unchanged.

This resolves an inconsistency in the first draft, which said "account id, not by name" in NFR-2 while simultaneously suggesting the view reuse the existing admin business picker — a picker that returns **company names** (`app/api/admin/business-os/llm-usage/businesses/route.ts`), by design and documented as such. The picker is the precedent; the draft's NFR-2 wording was the error.

### D-5 — A screen first; automation once we know what "normal" is

*(was OQ-5)*

**The user's answer: build the screen.** *"From there we will build automation as needed."* Alerting, thresholds and digests stay out of scope. The screen should nevertheless **produce the numbers an alert would later key on** — cost per business per window, failure rate, the unaudited count — so that when automation is built, it is reading figures that already exist rather than inventing new ones.

### D-6 — Classify the unaudited rows; do not exclude them and do not lump them

*(was OQ-6; sharpened by SA-3 and F-15)*

**The user's answer: classify.** Not exclude, and not leave undistinguished. Rows whose audit entry is absent are separated into their benign and their genuine causes rather than all landing in one "unaudited" bucket.

The benign classes are self-identifying and cost nothing (F-15). This matters because the first draft's AC-B5 would have reported **cache-hit volume as the audit-loss rate** — a number that would have looked entirely plausible and been wrong by an unknown multiple. The genuine-loss measurement only means anything once the benign classes are separated out. The full classification is [FR-B5](#fr-b5--ledger-first-and-classifying-what-is-not-audited).

### D-7 — Applying the B0 migration by hand on production is accepted

*(was OQ-7, added by SA-14)*

**The user's answer: acceptable.** There is no branch database, so B0 is applied by hand on production — the same constraint the entitlements and Layer 2 work hit. Accepted, with its **scheduling dependency** noted: B1 cannot be verified until B0 is applied, so the apply step is a checkpoint in the plan and not an afterthought.

**Security constraint, carried forward from SA-5 and non-negotiable:** the new function is **INVOKER rights, never `SECURITY DEFINER`**, with `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, following `business_os_usage_summary` exactly (`20260929_usage_summary.sql:34-40`, `:92-93`). This repo already carries a **queued P1 about 50 anon-callable `SECURITY DEFINER` functions** — this must not become the fifty-first.

---

## Gap A — Make AI Actions Filterable

**Size:** small, shippable on its own, no new page, no new API. **SA-approved 2026-09-22**, conditional on the changes below, which are now folded in.

### Functional requirements

1. **FR-A1 — AI actions are selectable.** An admin on `/admin/audit-trail` can filter the list to Business OS AI actions: to completed ones, to failed ones, or to both together.
2. **FR-A2 — The AI entity type is selectable.** The Entity Type filter offers `ai_action` alongside the existing values, so an admin can isolate every AI entry regardless of outcome.
3. **FR-A3 — Filters are generated from the catalogue, not hand-written.** The Action and Entity Type choices are derived from the registries that already exist (`AUDIT_EVENTS` / `EVENT_METADATA` and `AUDIT_ENTITY_TYPES`, F-4), so a newly registered event or entity type appears in the filters **without a UI change**.
   - **SA ruling (2026-09-22), now settled:** `lib/audit/events.ts` imports only `./types`, so it is **client-safe** — import the registries straight into the page. **No new API route.** The catalogue is **149 events** as of 2026-09-23 (SA's first pass said 146, corrected to 148 on the re-check after Dev measured it; Slice A's implementation then registered `AGENT_EXECUTED` at its writer, taking it to 149 — see the workplan's Implementation Note 1). `AUDIT_EVENTS` has 149 entries and `EVENT_METADATA` covers only **122** of them, so **`AUDIT_EVENTS` is the source, never `EVENT_METADATA`**. The totals move every time an event is registered — the load-bearing fact is the **gap of 27**, not the absolute number. ~150 events is fine presented in `<optgroup>`s derived from the key prefix; a searchable control is optional polish. **A curated subset is not acceptable**, because that is the defect being fixed. The rule is backed by a source-level guard test (AC-A3).
4. **FR-A4 — Gap A's filtering is honest, and does not depend on search being fixed.** With an `action` or `entity_type` filter applied **and no search term**, the route already takes the `.eq(...)` + `count: 'exact'` path (`route.ts:72-82`, `:101`, `:172`), so the total and the pagination are already honest. Therefore:
   - **(a)** AI filtering is specified and tested **without a search term**, and the total and paging are asserted honest there.
   - **(b)** The UI must **stop implying the search is table-wide**. Today the page renders "showing X of Y" using the **unfiltered** count while a search term is active (F-5). That line is either suppressed while a search term is present or labelled as a partial result. Gap A does not get to leave a misleading number on screen.
   - **(c)** The search defect itself is **not fixed here** — it is separately tracked (see [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)). Slice A must not grow a half-fix.
5. **FR-A5 — AI details are readable, not just present.** An expanded AI action row presents its recorded fields as labelled values — what ran, for which area, the outcome, the number of calls, the tokens, the estimated cost — rather than only as a raw key/value dump (F-2).
   - **Keep it minimal.** This is a labelled-values pass over the closed, already-safe `AiAuditDetails` shape. It **must not** grow a ledger read — that is Gap B's drill-down (FR-B2), and duplicating it here would put a cross-account cost join on a page that has no bucket for F-13's shared group id.
6. **FR-A6 — Nothing else about the page changes.** Existing filters, search, pagination, the AIS-specific detail renderers and the sidebar entry behave exactly as before.
7. **FR-A7 — The two route defects are fixed while the file is open.**
   - The **unconditional `error.message` returned to the client** (`route.ts:110` and `:193`) is put behind the standard `process.env.NODE_ENV === 'development'` guard. This is a live information leak on a route that reads every account's audit rows, against a non-negotiable CLAUDE.md rule, and it is a two-line fix with no design content.
   - The **stale `// TODO: Add admin role check here`** (`route.ts:45`) is removed. It now sits directly *below* a real, correct admin check and actively misleads the next reader.
8. **FR-A8 — Explicit non-goals for Slice A.** Recording these so the workplan does not quietly absorb them:
   - **Do not convert this handler to `requireAdmin`.** It is allow-listed on **both** `R1_PARKED` and `R2_PARKED` in `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, and those lists are governed by an **equality ratchet** — converting means deleting two entries **and** decrementing `CAPS.R1.parked` 7→6 and `CAPS.R2.parked` 7→6 **in the same commit**, or the required `Admin authz surface guard` check goes red and blocks the merge. There is **no security gain**: the inline check is behaviourally correct and fails closed (`route.ts:29-43`). That work is parked admin-authz slice 4. **Conversely, any new route Gap B adds MUST call `requireAdmin` as its first statement**, and a new admin page must not add a `route.ts` anywhere under `app/admin/**`.
   - **Do not narrow the generic detail renderer.** `page.tsx:788-802` renders *any* entry's `details` / `changes` as a key/value dump, including entity types whose changes carry owner content (`crm_contact`, `proposal`, `website_page`, `intake_form`). That is a pre-existing surface, out of scope for this cycle, and AC-A6 must not be read as a claim about the whole page.
   - **Do not fix the search defect** (FR-A4c).

---

## Gap B — A Combined AI Activity View

**Size:** the real feature. **Revised 2026-09-22 on SA-1 to SA-6.**

### What one row is

**One row = one `(grouping id, account)` pair**, within the window, scoped to `feature LIKE 'business-os-%'`.

The first draft said "one row = one grouping id". **That is false for two of the eight areas** (F-13), and getting it wrong is not a cosmetic error — it is a **cross-tenant cost leak on an operator screen**:

- **insights** — one cron run mints a single `runId` and passes it as the `groupId` for **every** business it processes. Keyed on `session_id` alone, one row would merge every business's insight spend, and a drill-down from one business's audit entry would list **other accounts' calls**.
- **briefing** — the group id is a deterministic UUID v5 of user + day, so a re-narration on the same day reuses it and **two audit entries share one `entity_id`**.

Therefore:

| Rule | Statement |
|---|---|
| **Row key** | `(session_id, user_id)` — **never `session_id` alone** |
| **Audit join** | `audit_trail.entity_id = token_usage.session_id` **AND** `audit_trail.user_id = token_usage.user_id` |
| **Drill-down** | Filters on `session_id` **and** `user_id` (FR-B2), or it lists another business's calls |
| **More than one entry per group** | Legitimate (briefing). **The newest entry supplies the row's action-level fields; every entry for the group is listed in the drill-down, and the row is marked as carrying more than one.** Silently picking one without saying so is not acceptable |

Fixing the shared `runId` at its source is out of scope (see [Scope](#scope)) — it changes what is recorded. **This view must be correct against the data as it is.**

### FR-B1 — Columns that matter

| Column | Why an admin needs it |
|---|---|
| When | Orientation and windowing |
| Business / account | Who it ran for — the primary investigative filter. Account id **and** company name ([D-4](#decisions)) |
| Area | Chat, insights, briefing, website, intake, leads, onboarding, images |
| Action type | What the product was actually doing, in words |
| Trigger | Whether the owner asked for it, a schedule ran it, or an outside visitor caused it — this is what separates "the owner is using us a lot" from "our cron is expensive" |
| Outcome | Succeeded or failed — and, on failure, the error **code** only |
| Calls / failed calls | Chatty vs. single-shot; silent repair activity |
| Tokens | The volume behind the cost |
| Estimated cost | The number the sweep is looking for |
| Models used | Whether an area is running on the model we think it is (the Layer 2 question) |
| Grouping id | The handle that links to the ledger and to the audit entry — **always shown with its account**, never on its own |
| Record state | Audited / not audited (with its class, FR-B5) / cost mismatch (FR-B6) / multiple entries |

An **unaudited** row is necessarily thinner: the ledger cannot supply action type, outcome or trigger. Those cells read as unknown — they are never guessed, and never left blank in a way that looks like "none".

### FR-B2 — Drill-down to the calls

Opening a row shows the individual `token_usage` calls that action made: time, call name (the catalogue `component`), model, provider, input/output tokens, cost, success. This is what answers "one big call or forty small ones?".

**The drill-down query filters on `session_id` AND `user_id`** (F-13). A drill-down keyed on the group id alone would list other businesses' calls for every insight run on the platform.

### FR-B3 — Filtering

At minimum: **business/account**, **area**, **outcome**, **date window**, and a **minimum cost** threshold. Sorting by cost and by time.

The date window is **required and bounded**, and offers both an explicit range and the six preset ranges in [D-3](#decisions) — Today, Yesterday, This Week, Last Week, This Month, Last Month. The bound is a **schema constraint** (NFR-10), not a UI convention, so it cannot be bypassed by calling the route directly.

### FR-B4 — Both directions

The view is reachable from a specific AI action and from a cost figure:
- from an AI audit entry in `/admin/audit-trail` (after Gap A) to its calls — carrying **both** the group id and the account, since the group id alone does not identify the row (F-13);
- from the view back out to `/admin/analytics` for the aggregate picture.

The precise linking mechanism is Dev's call; the requirement is that an admin never has to copy identifiers between screens by hand.

### FR-B5 — Ledger-first, and classifying what is not audited

**The row list is built from the ledger**, and the audit entry is attached to it where one exists — not the other way round. **SA confirmed this axis** (2026-09-22): audit writes are queued and never awaited (`aiActionAudit.ts:316`), so an audit-first list silently under-reports real spend. An action with no audit entry appears with its cost and calls intact rather than vanishing.

But "no audit entry" has **four causes and only one of them is KI-B** (F-15, [D-6](#decisions)). The view **classifies**; it must not lump:

| Class | Identified by | Counts as audit loss? |
|---|---|---|
| **Cache-served chat turn** | `provider = 'cache'`, `model_name` `cache` / `cache:<model>`, `activity_type = 'cache_hit'`, zero tokens, zero cost | **No.** By design — the turn made no LLM call |
| **Platform-account attribution** | `user_id` = the platform account | **No — never auditable by design.** `validateIdentities` refuses the entry for a platform account (`aiActionAudit.ts:255`). Its own bucket (FR-B8), because it is a Layer 1 *attribution* failure and hiding it defeats the reason Layer 1 exists |
| **Ungrouped** | `session_id IS NULL` | **No** — it is not a group at all. Its own bucket (FR-B8) |
| **Too recent** | Within the trailing exclusion window | **Not yet countable.** The audit write is queued and batched, so a very recent action is legitimately unaudited for a while. The exclusion window's exact length is set by Dev/SA from the audit service's batch and flush behaviour — it is not a business decision, but **it must exist**, or the measurement counts the live edge of the window as loss |
| **Genuine loss or delay** | Everything else | **Yes. This, and only this, is the KI-B number** |

**BA's refinement of SA-3:** SA listed "actions that made no call at all" as a second benign cause. It is a real class, but in a **ledger-first** view it cannot inflate anything — no call means no ledger row means no group, so such an action is invisible from this side entirely. The only no-call case that *does* produce a ledger group is the deliberate cache row. Worth stating precisely, because it is the difference between a KI-B number we can defend and one we merely hope is right.

### FR-B6 — Reconcile the two cost numbers

Where both exist, the view compares the audit entry's `estimatedCostUsd` with the sum of the action's ledger `cost_usd` (F-9) and **marks the row, showing both numbers**, when they differ by **more than $0.0001** ([D-1](#decisions)). It never averages them and never silently prefers one. The **ledger is the money number**; the audit figure is the "what happened" number.

Because both are computed from the same in-memory records (F-17), a mismatch beyond rounding is never arithmetic drift — it is always a failed or diverted write. The marker is the instrumentation's only self-check, which is why the tolerance is set just above the rounding floor rather than somewhere comfortable.

### FR-B7 — Read-only

No action on this screen changes anything: no retry, no re-run, no delete, no configuration change, no export that leaves the platform. (An operator CSV export is a reasonable later ask — [D-5](#decisions).)

### FR-B8 — Ungrouped and platform-account spend get labelled buckets

Business OS ledger rows legitimately exist with **no group** and with **no real account** (F-16). A grouped, ledger-first view would either drop them silently or collapse them into one nonsense row. Neither is acceptable:

- **Ungrouped spend** (`session_id IS NULL`) in the window is reported as a **single labelled bucket with its total and its call count** — never merged into a group, never dropped.
- **Platform-account rows** are reported as their **own labelled bucket**, visible by default and not filtered out. These are rows where attribution failed and the tracker fell back to the platform account (`aiAnalytics.ts:131-137`) — hiding them would hide exactly the failure Layer 1 exists to catch.

Both buckets state plainly that they are *not* audit loss (FR-B5).

### FR-B9 — The reverse pass: audited but unledgered

Ledger-first fixes one blind spot and opens another. F-9 names **two** permitted divergences, and the second — a ledger insert that silently failed — is invisible to a ledger-first list. This is not theoretical: `trackAICall` logs and swallows **every** insert failure (`aiAnalytics.ts:215-226`).

The view therefore also runs a **second, cheap reconciliation pass**: audit entries in the window whose `(entity_id, user_id)` has **no ledger rows**, surfaced as an **"audited, unledgered"** row. Without it, the view is not the complete record it claims to be, and FR-B5's stated purpose — that this is the only way KI-B becomes measurable — is only half true.

### FR-B10 — The cap is server-side, and the count is honest

Per [D-3](#decisions):

- **At most 100 rows are returned**, and the limit is applied **in the RPC**, not by trimming in the UI. A UI trim leaves the database scanning everything, which makes the B0 index pointless.
- When the cap is reached, the UI states that these are **the top 100 for the current filter**, against the current sort.
- The **"of N" figure is filtered the same way the rows are**. The existing audit page's "showing X of Y" is built from an unfiltered count (F-5); this view does not repeat that. If an honest filtered count is not available, **no count is shown** — a missing number is better than a wrong one.

### FR-B11 — The read is answered in the database

The grouping this view needs **cannot be done from the client** (F-14): PostgREST aggregates are disabled, and `token_usage` has no index on `session_id` or `feature`. So Gap B requires, as its **first** slice (B0):

- **A SQL function** returning the grouped rows — `LANGUAGE sql STABLE`, `SET search_path = public`, **INVOKER rights (never `SECURITY DEFINER`)**, with `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — following `business_os_usage_summary` exactly, including its header reasoning ([D-7](#decisions)).
- **At least one supporting index** on `token_usage` for the access path in [D-3](#decisions): window + Business OS feature prefix, grouped by `(session_id, user_id)`.
- The alternative — paging every matching row into Node and summing there — is **explicitly rejected**. It is the defect F-5 documents and the one the usage-summary migration exists to undo, and it would be far worse here because this read is cross-account.

---

## Where Gap B Should Live

| Option | What it would mean | Trade-off |
|---|---|---|
| **1. Extend `/admin/audit-trail`** | Add an AI mode to the existing compliance browser | Cheapest to reach, but the page's job is *one row per audited event of any kind*. Bolting a cost-ledger join onto it makes the general-purpose log slower and more confusing for its existing users, and it still cannot show unaudited spend (FR-B5) — the page is, by definition, a view of the audit table |
| **2. New `/admin/ai-activity` page** | A purpose-built, action-first screen in the admin area, linked from the sidebar | Most work, but it is the only option whose *unit* is the AI action. It can be built on the ledger and enriched with the audit entry (FR-B5), it owns its own filters and its own buckets (FR-B8), and neither existing page has to change shape |
| **3. A tab on `/admin/analytics`** | Sits next to the token-usage breakdowns | Natural home for cost, and it already knows the feature/component dimensions. But that page is aggregate-first and money-first: it has no concept of an action, an outcome or a trigger, and the page is already very large. The tab would be a different kind of thing wearing the page's clothes |
| **4. Inside the Business OS app (`/business-os/*`)** | Where the AI actually runs | Rejected for v1. The audience is the **platform team**, not the business; putting a cross-account operator view inside the owner-facing product is exactly the mixing Layer 3 D-6 avoided |

### Recommendation

**Option 2 — a new `/admin/ai-activity` page — with Option 1 (Gap A) shipped first as an immediate stopgap.**

In business terms: the audit trail is *the log of everything that happened*, and the analytics page is *the bill*. The question an operator keeps asking — "what did our AI do for this business, did it work, and what did that cost?" — is neither of those; it is a list of things the product did, with the money attached. Giving it its own page is the only option where the thing on screen is the thing the operator is thinking about, and it is the only option that can show AI spend whose audit entry never made it to the database.

A new page at `app/admin/ai-activity/page.tsx` inherits its server-side guard from `app/admin/layout.tsx` — it is protected before a line of it is written.

Gap A ships first regardless: it is small, it makes AI activity findable within days, and it is useful even after the new page exists, because the compliance browser should be able to filter to AI events like it filters to everything else.

---

## Non-Functional Requirements

These carry forward from the attribution work and are **non-negotiable**.

1. **NFR-1 — Admin-only, gated in the route, fails closed.** Every new or changed API route gates itself before reading anything: 401 signed out → 403 not an admin → 400 invalid input, with an admin check that throws treated as "no". Identity comes from the `admin_users` source of truth — **`requireAdmin` as the first statement** in any new route, `requireAdminPage` / the admin layout for pages. **Never `profiles.role`, never `app_metadata.role`, never a hand-rolled `AdminAccessService` call inside a `route.ts`** (that fails the CI guard). See [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md).
   - Converting the **existing** audit-trail handler is an explicit non-goal — see FR-A8.
2. **NFR-2 — Cross-account reads are deliberate, and limited to metadata. *(Scoped to the new Gap B view.)*** This view deliberately reads across accounts. It must therefore read and display **identifiers, company names, counts, labels, models, timestamps and numbers only** — **never prompts, request or response payloads, owner-entered text, AI output, error message bodies, or email addresses**. Only allow-listed columns are selected. The posture is already set out well in the header of `app/api/admin/business-os/llm-usage/route.ts:1-22` and in `lib/repositories/TokenUsageRepository.ts:24-26`; this view follows them.
   - **Identification** is account id + company name via `BusinessProfileRepository`, never email, and never a business name in a log line ([D-4](#decisions)).
   - **Cross-account *cost* mixing is part of this rule, not only a correctness concern.** A row that contains another business's spend (F-13) is the same class of mistake as a row that contains another business's text. The row key is `(session_id, user_id)`; a join on the group id alone is a privacy defect.
   - **Scope note (SA-10).** This clause governs the **new Gap B view**. It does **not** apply retroactively to `/admin/audit-trail`, which already joins the `users` table and returns `email` and `full_name` (`audit-trail/route.ts:153-167`) and renders the email as each row's primary identifier (`page.tsx:533, 568`). That display is **pre-existing, out of scope and unchanged**; a compliance browser needs it. On the audit page the privacy rule applies **only to the new AI detail renderer** (FR-A5), where the closed `AiAuditDetails` shape makes it genuinely checkable.
3. **NFR-3 — Read-only, and no AI.** No writes (other than an admin service's own bookkeeping), no LLM calls, no embeddings, no audit event written by the view itself. Accountability for who looked at what is a **structured Pino log** on the route, with a correlation id and the admin's user id — never a business name ([D-4](#decisions)).
4. **NFR-4 — Repository pattern, with four named constraints.** All new database access goes through `lib/repositories/`, reusing `TokenUsageRepository` and `AuditTrailRepository`. **Repository pattern is mandatory for new DB access — "the existing file's convention" does not waive it** (F-11 is recorded debt, not a precedent to follow). Concretely (F-18):
   1. **The method-set pin.** `tokenUsageRepository.contract.test.ts` asserts the exact public method set and each method's arity. **Adding a method fails that test** unless `EXPECTED_ARITY` is extended **in the same commit**. The new all-accounts read must carry **`AllAccounts` in its name**, matching `listChatCallsAllAccountsInWindow` — "all accounts" is reached by calling a differently *named* method, **never by leaving an argument out or adding an optional filter**.
   2. **The import ban.** `TokenUsageRepository` **may not import from `lib/business-os/**`** (Layer 1.1 RC-7, enforced by source-text assertion). Feature prefixes, area names and account ids are passed in **as plain data**; the repository must not learn about the call catalogue.
   3. **A new column allow-list.** The existing `LedgerCallRow` has no `user_id`, `model_name` or `provider`, and FR-B1/FR-B2 need all three. A **new, named** column list is required, and it must keep excluding `request_payload`, `response_metadata` and `error_message` — the `token_usage` row does carry all three (`aiAnalytics.ts:170-176`).
   4. **`AuditTrailRepository`'s header invariant.** Its file header states that AI entries "are excluded IN THE QUERY, so the page, its counts and its CSV export can never see one." **That must stay true of `listOwnerEntries`.** A new admin method returning **only** AI entries must be explicitly named, carry its own column list (the existing `OWNER_COLUMNS` deliberately omits `hash` and `user_email`), and **the file header must be amended in the same commit** — otherwise the next reader trusts a stale invariant.
   - Converting the routes this work touches is expected; converting the rest is not required here.
5. **NFR-5 — Logging.** Pino only, via `createLogger`, with a correlation id on request paths. Any file touched that still logs through `console.*` is flagged to the user per CLAUDE.md rule 3 and converted once approved.
6. **NFR-6 — Performance and volume.** The table this view actually scans is **`token_usage`**, not `audit_trail`. That matters: the ledger grows **per call** rather than per action, and Business OS chat writes a row on **every turn, including cache hits** (F-15). Layer 3's estimate — up to ~730,000 audit entries a year at 1,000 businesses — is therefore a **floor**, not the figure to design to. Consequently: a bounded, required date window; the server-side 100-row cap (FR-B10); a grouping RPC and a supporting index (FR-B11); honest counts; and a visible indication whenever results are capped. The Layer 1.1 report already sets the precedent of warning on truncation rather than silently under-reporting.
7. **NFR-7 — Accessibility.** Keyboard-reachable filters and drill-down, labelled controls, and no information conveyed by colour alone (outcome, the "not audited" classes, the bucket rows and the cost-mismatch marker especially).
8. **NFR-8 — Errors.** No internal error text reaches the client outside development, using the standard `NODE_ENV === 'development'` guard. This includes fixing F-12 on the existing audit route (FR-A7).
9. **NFR-9 — Testability.** Filtering, the audit-to-ledger join, the reconciliation rule, the unaudited classification and the privacy rule (NFR-2) must be testable without a live provider and without production data. Per CLAUDE.md, a new API route needs an integration test covering happy path, auth failure and invalid input; E2E is not set up, so QA records a manual check of the critical path.
10. **NFR-10 — Input validation with Zod.** Per CLAUDE.md's mandatory rule, **every API route input is validated with Zod before any business logic**. The precedent to copy is `BusinessListQuerySchema` in `lib/business-os/usage/llmUsageVerification.ts`. Specifically: the **required, bounded date window is a schema constraint**, as is the row cap — both must hold when the route is called directly, not only when the UI behaves.

---

## Acceptance Criteria

### Gap A

- [ ] **AC-A1** (FR-A1) — On `/admin/audit-trail`, an admin can filter to completed AI actions, to failed AI actions, and to both, and the list shows only those.
- [ ] **AC-A2** (FR-A2) — The Entity Type filter offers `ai_action`, and selecting it returns every AI action entry in the window regardless of outcome.
- [x] **AC-A3** (FR-A3) — A test registers a new event in the catalogue and asserts it becomes selectable in the UI **with no change to the page's markup**. The same holds for a new entity type. **Backed by a source-level guard test asserting the page's JSX contains no hardcoded event or entity-type literal** — that is what makes this criterion real rather than aspirational.
- [ ] **AC-A4** (FR-A4a) — With an AI filter applied **and no search term**, the reported total and the page count describe the filtered set, and paging through reaches every matching row exactly once.
- [ ] **AC-A5** (FR-A5) — An expanded AI action row shows, as labelled values: area, action type, trigger, outcome (with the error code when failed), call count and failed-call count, input/output/total tokens, estimated cost, call names, models and the grouping id. **No ledger read is performed.**
- [ ] **AC-A6** (FR-A6, NFR-2) — Regression: existing severity, date, entity and search filters, the AIS detail renderers and pagination behave as before. **Scoped privacy check:** code review confirms the **new AI detail renderer** shows only the closed `AiAuditDetails` fields — no prompt, payload, owner text or error message body. The page's pre-existing `user_email` display and its generic detail fallback are explicitly **unchanged and out of scope**.
- [x] **AC-A7** (NFR-1) — Signed out → 401; signed in but not an admin → 403; an admin check that throws → denied. No data is read before all three pass.
- [x] **AC-A8** (FR-A7, NFR-8) — A forced failure returns no internal error text outside development, on **both** 500 paths (`route.ts:110` and `:193` — SA re-check corrects the first draft's `:111` / `:194`, which are the `{ status: 500 }` lines); in development the detail is still available. The stale `// TODO: Add admin role check here` is gone.
- [ ] **AC-A9** (FR-A4b) — With a search term active, the page no longer displays a total drawn from the unfiltered count: it is either suppressed or labelled as partial. Verified against a table where the filtered and unfiltered counts differ visibly.
- [x] **AC-A10** (FR-A8) — `Admin authz surface guard` passes unchanged: the audit-trail route stays on both parked allow-lists, and `CAPS.R1.parked` / `CAPS.R2.parked` are untouched.

> **Slice A evidence (Dev, 2026-09-23 — `feature/admin-ai-activity-slice-a`).** Ticked above are the criteria an automated test settles end-to-end: **AC-A3** (`lib/audit/__tests__/filterOptions.test.ts` asserts the offered set *equals* `AUDIT_EVENTS` / `AUDIT_ENTITY_TYPES`, which is stronger than "a new event appears"; `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` is the source-level literal guard), **AC-A7** (`app/api/admin/__tests__/auditAdminGate.test.ts`, plus two new ordering tests proving an invalid query from a non-admin still returns 403 and from a signed-out caller 401), **AC-A8** (four `NODE_ENV` tests over both 500 paths and the new 400 path; the TODO is gone) and **AC-A10** (`lib/admin/__tests__/admin-authz-surface.guard.test.ts` green, `CAPS` untouched).
> **AC-A1, AC-A2, AC-A4, AC-A5, AC-A6 and AC-A9 are left for QA** — each needs a real table with AI rows. Code-level evidence for AC-A5/AC-A6's privacy clause is in the guard test (the renderer names its fields explicitly and the generic dump is suppressed for AI rows). One behaviour change to check against AC-A6: `?severity=` values outside `info|warning|critical` now return 400 instead of 200-with-no-rows, and a dead `USER_UPDATED` option was dropped while `AGENT_EXECUTED` was registered into the catalogue — see the workplan's Implementation Notes.

### Gap B

- [ ] **AC-B1** (FR-B1) — For a test business with a known set of AI actions in a window, the view lists exactly one row per `(grouping id, account)` pair, with every column in FR-B1 populated, and each row's totals equal to the sum of **that business's** ledger calls for that group.
- [ ] **AC-B2** (FR-B2) — Opening a row lists that action's individual calls (time, call name, model, provider, tokens, cost, success), and the listed calls sum to the row's totals.
- [ ] **AC-B3** (FR-B3) — Each filter narrows the list correctly and they combine: one business, one area, failures only, a date window, a minimum cost. Each of the six preset ranges resolves to the correct window. Sorting by cost returns the most expensive action first.
- [ ] **AC-B4** (FR-B4) — From an AI entry in `/admin/audit-trail`, an admin reaches that action's calls in one step, with no manual copying of an id — and the link carries **both** the group id and the account.
- [ ] **AC-B5** (FR-B5, [D-6](#decisions)) — **Cross-tenant regression, the one that must not fail.** A seeded insight run whose **single group id spans two businesses** produces **two rows, one per business**; each row's totals include **only its own** business's calls; and neither row's drill-down lists the other's calls. Repeated for a briefing group with **two audit entries on one day**: one row, newest entry supplying the action fields, both entries listed in the drill-down, row marked as carrying more than one.
- [ ] **AC-B6** (FR-B5, [D-6](#decisions)) — **Classification, not lumping.** Seeded fixtures covering each class produce the correct label: a cache-served turn (`provider = 'cache'`, `activity_type = 'cache_hit'`, zero cost) is **not** counted as audit loss; a platform-account row is **not** counted as audit loss; an ungrouped row is **not** counted as audit loss; an action inside the trailing exclusion window is **not** counted; and a genuinely entry-less group **is**. QA records the resulting KI-B figure for the live window — **the first production measurement of KI-B**, and the first that is defensible.
- [ ] **AC-B7** (FR-B6, [D-1](#decisions)) — A seeded action whose audit cost and ledger cost differ by more than **$0.0001** is marked as a mismatch and shows **both** numbers; one differing by less than that is **not** marked. The ledger figure is the one presented as the money number.
- [ ] **AC-B8** (FR-B7, NFR-3) — Code review confirms the view performs no write, no LLM call and no audit write, and that every read is scoped and column-allow-listed. Every request writes one structured log line naming the admin, the correlation id and the filters — and **no business name**.
- [ ] **AC-B9** (FR-B8) — Seeded ledger rows with `session_id IS NULL`, and seeded rows attributed to the platform account, each appear as their **own labelled bucket** with an accurate total and call count. Neither is dropped, neither is merged into a group, and neither is counted as audit loss.
- [ ] **AC-B10** (FR-B9) — A seeded audit entry whose group has **no** ledger rows appears as an "audited, unledgered" row. Removing the entry's ledger rows after the fact flips a normal row into that state.
- [ ] **AC-B11** (FR-B10, [D-3](#decisions)) — With more than 100 matching groups: **at most 100 rows are returned**; the limit is applied **in the RPC** (verified by inspecting the SQL and by asserting the route does not fetch more than it returns); the UI states these are the top 100 for the current filter; and the "of N" figure **matches the same filters as the rows**. A test in which the filtered and unfiltered counts differ proves the count is the filtered one.
- [ ] **AC-B12** (FR-B11, [D-7](#decisions)) — The migration creates the function with **INVOKER rights** and `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. A test or a recorded manual check confirms an `anon` and an `authenticated` caller **cannot execute it**. The function is **not** `SECURITY DEFINER`.
- [ ] **AC-B13** (NFR-2) — With a seeded action whose prompt, owner text, model output and error message each contain a unique marker string, **no marker appears anywhere** in the view's API response or rendered page. No email address is returned. Company names are permitted ([D-4](#decisions)); business names appear in **no** log line.
- [ ] **AC-B14** (NFR-1, NFR-9, NFR-10) — Integration tests cover: signed out → 401; non-admin → 403; a missing date window → 400; a window **wider than the bound** → 400 **when the route is called directly**; a row-limit parameter above the cap → rejected or clamped server-side; happy path. Admin identity comes from the `admin_users` path via `requireAdmin` as the handler's first statement, and the admin-authz CI guard passes.
- [ ] **AC-B15** (NFR-4) — Code review confirms no new inline service-role Supabase client: all new reads go through `lib/repositories/`. The new all-accounts read is a distinctly **named** method carrying `AllAccounts`, never an omitted or optional account argument; `EXPECTED_ARITY` in the contract test is extended **in the same commit**; the repository still imports nothing from `lib/business-os/**`; the new column list excludes `request_payload`, `response_metadata` and `error_message`; and `AuditTrailRepository`'s file header is amended in the same commit as its new admin method.
- [ ] **AC-B16** (NFR-6) — With the largest window the UI allows, against a realistically sized ledger, the page returns within an acceptable time and either returns complete results or displays the cap indicator. The measured figures — rows scanned, bytes, latency — are recorded in the workplan, alongside the same measurement taken **before** the B0 index, so the index's value is evidenced rather than assumed.
- [ ] **AC-B17** (NFR-7) — The view is operable by keyboard, controls are labelled, and outcome / unaudited-class / bucket / mismatch / multiple-entry states are distinguishable without colour.
- [ ] **AC-B18** (Scope, [D-2](#decisions)) — No owner-facing surface changed: `/monitoring`, its CSV export and the owner usage card are unaffected, and no owner-scoped read returns an AI entry (Layer 3 FR-27 regression).

---

## Suggested Slicing

Re-sliced 2026-09-22 per SA-5 and SA-14: **B0 is new and comes first**, and B1 absorbs the "not audited" marker, because under ledger-first that is a row's default state rather than an extra feature.

| Slice | Content | Ships alone? | Notes |
|---|---|---|---|
| **A** | Gap A: catalogue-driven filters, `ai_action` entity type, minimal formatted AI details, the two F-12 fixes (FR-A7), the honest-totals rewrite (FR-A4), the recorded non-goals (FR-A8) | **Yes** | Small, low risk, immediately useful. **SA-approved.** Do not wait for Gap B |
| **B0** | **The migration: the grouping RPC + the supporting index** (FR-B11). INVOKER rights, REVOKE from `anon`/`authenticated` | Not user-visible | **Must come first — B1 is not buildable at NFR-6 volumes without it.** Applied by hand on production ([D-7](#decisions)), so the apply step is a checkpoint in the plan |
| **B1** | The AI activity list: one row per `(group id, account)` (F-13), core columns, business / area / outcome / date filters with the six presets, the server-side 100-row cap and honest count (FR-B10), the **unaudited classification** (FR-B5) and the **ungrouped / platform-account buckets** (FR-B8) | Yes | The usable core of Gap B. Depends on B0 |
| **B2** | Drill-down to the constituent ledger calls — filtered on `session_id` **and** `user_id` — plus cost sorting and the cost threshold | Yes | The "one big call or forty small ones?" answer |
| **B3** | Cost reconciliation (FR-B6), the **audited-but-unledgered reverse pass** (FR-B9), and the cross-links (FR-B4) | Yes | Completes the record in both directions |

### What is ready to plan

**All seven open questions are answered.** There is no longer any slice waiting on a business decision:

| Slice | Blocked by | State |
|---|---|---|
| **A** | Nothing, and never was | **Ready to plan now.** SA-approved 2026-09-22 |
| **B0** | Needed [D-3](#decisions) (window and cap → index shape) and [D-7](#decisions) (hand-applied migration) | **Both answered. Ready to plan**, pending the SA re-check of this revision |
| **B1** | Needed [D-3](#decisions), [D-4](#decisions), [D-6](#decisions) | **All answered.** Ready once B0 is applied |
| **B2** | Nothing | Ready after B1 |
| **B3** | Needed [D-1](#decisions) (tolerance) | **Answered.** Ready after B1 |

---

## Out of Scope / Future Roadmap

| Item | Where it goes |
|---|---|
| Owner-facing AI activity or cost detail | Parked with the charging decision (Layer 3 D-6, Layer 1.5 KI-A). Deferred, not rejected — [D-2](#decisions) |
| **The free-text search defect (F-5)** | **Spun out of Slice A into its own item.** An honest search needs a **DB-level** predicate — text columns via `.or(...ilike...)` plus a JSONB strategy (note `idx_audit_trail_details` is a GIN index, so containment is available but `ILIKE` over stringified JSON is not indexable) — **and** a filtered count. Its own cycle, its own acceptance criteria |
| **The shared insight `runId` (F-13)** | ✅ **DONE 2026-09-25** on `fix/insight-run-group-id-per-business` — a fresh `crypto.randomUUID()` per business, minted inside the loop, with `InsightRunIds { runId, groupId }` keeping `detection_run_id` run-level. **This does not change anything required of this view:** historical rows keep the shared id permanently (no backfill), so every consumer of `session_id` must still key on `(session_id, user_id)` — this view was never the only one that could get that wrong. What it does change is that post-cut-over insight runs stop producing N rows that look like one action. ~~Originally recorded as a finding for the Layer 3 / insights owners, to be fixed at the mint in `insight-detect`.~~ |
| Alerting on cost spikes or failure rates; scheduled digests | Later item — [D-5](#decisions) |
| CSV / finance export of AI activity | Later item — [D-5](#decisions) |
| An admin screen for Layer 2 model settings | Later layer; the [runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) covers it for now |
| Making AI audit entries durable (awaited or retried writes) | Layer 3 OI-D (AI entries) and OI-A (service-wide). This view **measures** the loss (FR-B5); it does not fix it |
| Narrowing the audit page's generic detail renderer | Pre-existing surface (`page.tsx:788-802`), out of scope — FR-A8 |
| Scheduling the 365-day audit retention job | Layer 3 OI-C |
| Converting the remaining inline service-role admin routes to repositories | Repo-conformance sweep, tracked separately (F-11) |
| Moving the 7 hand-rolled admin checks onto `requireAdmin` | Admin-authz slice 4, parked. Whoever does it must drop `CAPS.R1.parked` 7→6 and `CAPS.R2.parked` 7→6 in the same commit |
| A unified AI activity view spanning Business OS **and** the agents product | Later question; different events and dimensions |
| chat-v2's unledgered spend | Known from Layer 2; it will simply not appear in this view |

---

## Open Questions

**None open.** All seven were answered on 2026-09-22 — six by the user, and OQ-1's first half and OQ-4 ruled by SA as settled precedent rather than genuine forks. The answers are recorded in full as [Decisions](#decisions); the questions are kept here for traceability.

| # | Question | Outcome |
|---|---|---|
| **OQ-1** | When the two cost numbers disagree, which one do we quote, and do we want to be told? | **Answered.** First half was never a fork — the ledger is the money record (SA ruling). The user's answer to the rest: **mark the row and show both**, tolerance **$0.0001** → [D-1](#decisions) |
| **OQ-2** | Should a business owner ever see their own AI activity in this detail? | **Answered: admin-only.** Not now; *"maybe in the future we will add it"* — deferred, not rejected → [D-2](#decisions) |
| **OQ-3** | How far back should an admin be able to look? | **Answered:** explicit range **plus** six presets, a hard **100-row cap** enforced **server-side**, and a **"top 100 of N"** indicator built on an **honestly filtered** count → [D-3](#decisions) |
| **OQ-4** | By name or only by account id? | **Not a real fork** (SA): the admin business picker already returns company names and never emails. **Account id + company name via `BusinessProfileRepository`**, never email, never a name in a log → [D-4](#decisions) |
| **OQ-5** | A place to look, or a thing that tells us? | **Answered: the screen first.** *"From there we will build automation as needed."* → [D-5](#decisions) |
| **OQ-6** | Do we show AI spend whose action record never arrived? | **Answered: classify.** Show it, but separate the benign causes from the genuine loss — not excluded, not lumped → [D-6](#decisions) |
| **OQ-7** | Is applying the B0 migration by hand on production acceptable? *(added by SA-14)* | **Answered: acceptable**, with the scheduling dependency noted and the INVOKER + REVOKE constraint carried forward → [D-7](#decisions) |

---

## Notes on Integration Points

| Area | What is affected |
|---|---|
| **Existing pages** | `app/admin/audit-trail/page.tsx` (Gap A), `app/admin/components/AdminSidebar.tsx` (a new entry for the Gap B page), `app/admin/analytics/page.tsx` (cross-link only), `app/admin/layout.tsx` (the server-side guard a new admin page inherits — nothing to change) |
| **Existing routes** | `app/api/admin/audit-trail/route.ts` (Gap A filters; the two F-12 fixes; **not** converted to `requireAdmin` — FR-A8), `app/api/admin/token-usage/drill-down/route.ts` (cross-link only; no change expected) |
| **Catalogues to read from** | `lib/audit/events.ts` (`AUDIT_EVENTS`, `EVENT_METADATA` — **client-safe**, imports only `./types`), `lib/audit/types.ts` (`AUDIT_ENTITY_TYPES`), `lib/audit/requestSchemas.ts` (`AI_ACTION_ENTITY_TYPE`, `AI_ACTION_EVENT_PREFIX`), `lib/business-os/llm/callCatalog.ts` (areas, call names, and `bosBriefingGroupId` at `:362`), `lib/business-os/usage/usageCategories.ts` |
| **Entry shape to render** | `lib/business-os/llm/aiActionAudit.ts` — `AiAuditDetails` is a **closed** set of keys, so the view can rely on it. Note `:255` (`validateIdentities`) and `:304` (zero calls) for the two paths that write **no** entry at all |
| **Data access** | `lib/repositories/TokenUsageRepository.ts` — extend by a **named `...AllAccounts...`** method, never an optional account filter, extending `EXPECTED_ARITY` in the same commit, with a **new column list** covering `user_id`, `model_name` and `provider` (F-18). `lib/repositories/AuditTrailRepository.ts` — owner-scoped only today; an admin AI-only read is a new, explicitly-named method **with its file header amended in the same commit**. `BusinessProfileRepository` for the company name ([D-4](#decisions)) |
| **Tables read** | `audit_trail` (AI entries: action `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`, entity type `ai_action`, entity id = grouping id) and `token_usage` (`feature`, `component`, `session_id` = grouping id, `user_id`, tokens, `cost_usd`, `provider`, `model_name`). **The join is `entity_id = session_id` AND `audit_trail.user_id = token_usage.user_id`** — the group id alone is not unique per action (F-13) |
| **Schema change** | **Required.** ~~No schema change is expected~~ — corrected 2026-09-22. Gap B needs a **grouping RPC plus at least one index** on `token_usage` (F-14, FR-B11, slice B0), applied by hand on production ([D-7](#decisions)). Precedent and header reasoning: `supabase/migrations/20260929_usage_summary.sql` |
| **Must not change** | `AuditTrailService` (Layer 3 D-4), anything the owner sees (`/monitoring` and its export, `components/business-os/UsageCard.tsx`), the `/test-business-os` LLM Usage verification tab, `AuditTrailRepository.listOwnerEntries`' exclusion of AI entries, and what any layer records |
| **Prior art to copy** | `app/api/admin/business-os/llm-usage/route.ts` — its route header documents the exact admin-gating, cross-account and metadata-only posture this view must adopt. `app/api/admin/business-os/llm-usage/businesses/route.ts` — the business picker ([D-4](#decisions)). `lib/business-os/usage/llmUsageVerification.ts` — `BusinessListQuerySchema`, the Zod precedent (NFR-10) |

---

## SA Review Notes

**Reviewed by SA — 2026-09-22**
**Status:** 🔄 Revision Required — **Gap A approved with the changes in SA-8 to SA-12; Gap B sent back** on SA-1 to SA-6 before a workplan is written.

> **BA note, 2026-09-22:** this section is preserved **verbatim** as the review record. Everything in it has been applied — see [Response to the SA Review](#response-to-the-sa-review) for the point-by-point map.

Every as-built claim F-1 to F-12 was re-derived against the tree on branch `chore/test-tiering`. **All twelve hold.** The route defects (F-5, F-12) and the hardcoded dropdowns (F-3) are exactly as described, and `token_usage.session_id` really is the grouping id (`buildBosCallContext` maps `groupId` → `sessionId` → the ledger's `session_id`, `lib/business-os/llm/callCatalog.ts:305`; `lib/ai/providers/baseProvider.ts:115`). The document is unusually well-evidenced, and BA was right to flag the ledger-first choice for SA.

What follows is what the document gets **wrong or leaves out**, in the order it matters. Six of these are load-bearing: left as written they would propagate straight into the workplan.

---

### Ruling 1 — The ledger-first axis is CORRECT, but the key is not the grouping id

**SA-1 (Gap B, blocking) — "one row = one grouping id" is false for two of the eight areas.**

FR-B1 and F-8 assume a grouping id identifies one AI action. It does not:

| Area | Evidence | Consequence |
|---|---|---|
| **insights** | `app/api/cron/insight-detect/route.ts:143` mints `runId = crypto.randomUUID()` **once per cron run, outside the per-business loop**, and line 217 passes that same `runId` as `groupId` for **every** business. `InsightRepository.ts:757, 1783, 2185` write it as `session_id`. | One `session_id` spans **N businesses**. A ledger-first row keyed on `session_id` alone merges every business's insight spend into one row; a join from an audit entry's `entity_id` back to `token_usage` returns **other accounts' cost rows**. That is a cross-account attribution failure on an operator screen, and it breaks AC-B1 ("each row's totals equal the sum of that action's ledger calls") and AC-B6 (insights would flag as a mismatch on every run). |
| **briefing** | `bosBriefingGroupId(userId, date)` (`callCatalog.ts:362`) is a **deterministic UUID v5** of user + day. | A re-narration on the same day reuses the group: **two audit entries share one `entity_id`** over one ledger group. "One row per action" and "attach the audit entry" both break. |

**Required:** the row key is **`(session_id, user_id)` scoped to `feature LIKE 'business-os-%'`**, never `session_id` alone, and the audit join is **`entity_id = session_id AND audit_trail.user_id = token_usage.user_id`**. The requirement must also say what the view does when a group legitimately carries **more than one** audit entry (SA suggestion: newest wins for the row, both listed in the drill-down).

Minting a per-business group id in `insight-detect` would be the root-cause fix, but it changes what is *recorded* — explicitly out of scope here, and it would re-key existing rows. **Do not pull it in.** Record it as a finding for the Layer 3 owners; this view must be correct against the data as it is.

**SA-2 (Gap B, blocking) — ledger-first alone swaps one blind spot for another.**

BA's reasoning for ledger-first is right and I confirm it: audit writes are queued and never awaited (`aiActionAudit.ts:316`, `void AuditTrail.log(...)`), so an audit-first list silently under-reports spend. But F-9 names *two* permitted divergences, and the second — **a ledger insert that silently failed** — is invisible to a ledger-first list. `AIAnalyticsService.trackAICall` swallows every insert failure (`lib/analytics/aiAnalytics.ts:213-226` logs and returns), so this is a real class, not a theoretical one.

**Required:** ledger-first as the **primary** axis (approved), plus a **second, cheap reconciliation pass** — audit entries in the window whose group has no ledger rows — surfaced as an "audited, unledgered" row. Without it the view is not the complete record it claims to be, and FR-B5's stated purpose ("the only way KI-B ever becomes measurable") is only half true.

**SA-3 (Gap B, blocking) — "no audit entry" has three causes, and two of them are benign.**

AC-B5 asks QA to record the unaudited row count as "the first production measurement of KI-B". As specified that measurement will be **wrong by a large margin**:

1. **Cache-hit chat turns.** `recordCachedTurn` (`lib/business-os/bizql/telemetry/turnUsage.ts`) deliberately writes a zero-token `token_usage` row with `feature = business-os-chat`, `provider = 'cache'`, `session_id = turnId` — for a turn that **made no LLM call**. `runAiAction` writes no entry when `calls.length === 0` (FR-7). Every cache hit is therefore a ledger group with no audit entry, **by design**.
2. **Actions that made no call at all** — the same FR-7 rule (e.g. a business with no detections in an insight run).
3. **Genuinely lost or delayed entries** — the actual KI-B.

**Required:** the view must classify, not lump. At minimum exclude `provider = 'cache'` / zero-call groups from the "not audited" marker, and state that the KI-B count is `(3)` only. Note also that the audit write is *queued and batched*, so a very recent action is legitimately unaudited for a while: the KI-B measurement needs a trailing exclusion window, not the live edge of the window.

**SA-4 (Gap B, blocking) — ungrouped Business OS ledger rows exist by design, and the requirement has no bucket for them.**

Two independent paths produce a Business OS `token_usage` row with **`session_id = NULL`**:

- `GroupIdFor<'chat'>` is `string | undefined` (`callCatalog.ts`): chat may legitimately call without a turn id.
- `aiAnalytics.ts:139` nulls any `session_id` that is not a UUID (`'Invalid session_id; recording with no session'`).

A ledger-first grouped view will either drop these rows silently or collapse them into one nonsense row. Add an explicit requirement: **ungrouped Business OS spend in the window is reported as a single labelled bucket with its total, never merged into a group and never dropped.** Same treatment for rows whose `user_id` is the **platform-account fallback** (`aiAnalytics.ts:131-137` records against the platform account when attribution failed) — those must be visible, not filtered out, or the view hides exactly the failure Layer 1 exists to catch.

---

### Ruling 2 — "No schema change is expected" is wrong, and it changes the slicing

**SA-5 (Gap B, blocking) — Gap B needs a migration, and it belongs in the first slice, not the last.**

The Integration Points table asserts *"No schema change is expected — the join key already exists on both sides."* The join key does exist. The **query does not**:

- **PostgREST aggregate functions are disabled on this project** (`PGRST123`), recorded in `supabase/migrations/20260929_usage_summary.sql`. There is no client-side `GROUP BY session_id, user_id` + `SUM(cost_usd)`. The alternatives are a SQL function, or paging every matching row into Node and summing there — which is precisely the defect F-5 documents, and precisely what that migration was written to undo (measured: 1,991 rows / 1.77 MB / ~1,190 ms **for one account over 30 days**; this view is cross-account).
- **`token_usage` has no index that supports this read.** The only indexes in the tree are `(user_id, created_at DESC)`, `(execution_id)` and `(agent_id, execution_id)` (`20260929_usage_summary.sql:98`; `supabase/SQL Scripts/20250113_add_execution_id_to_token_usage.sql`). There is **no index on `session_id` and none on `feature`**. A window-scoped, cross-account, feature-prefixed group-by is an unindexed scan of the whole ledger.

**Required:**
- Gap B gets a **new SQL function plus at least one index**, following the `business_os_usage_summary` precedent exactly: `LANGUAGE sql STABLE`, `SET search_path = public`, **INVOKER rights (never `SECURITY DEFINER`)**, and `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. That precedent's header gives the reasoning; it also matters because this repo already carries a queued P1 about anon-callable `SECURITY DEFINER` functions — do not add to it.
- **Re-slice:** insert **B0 = the migration** ahead of B1. B1 is not buildable at NFR-6 volumes without it.
- Correct the Integration Points row, and add an open question (SA-14) about applying a migration by hand on production.

**SA-6 (Gap B, blocking) — NFR-4 is right in principle and under-specified in practice.** Four concrete constraints the requirement must name, all verified:

1. **`TokenUsageRepository` has a method-set pin.** `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` asserts `expect(publicMethods.sort()).toEqual(Object.keys(EXPECTED_ARITY).sort())`. **Adding any method fails that test** unless `EXPECTED_ARITY` is extended in the same commit, and the same test pins arity so no optional account filter can appear. BA's "a differently *named* method" is correct — add that the contract test must be extended alongside it, and that the new all-accounts read must carry `AllAccounts` in its name, matching `listChatCallsAllAccountsInWindow`.
2. **`TokenUsageRepository` may not import from `lib/business-os/**`** — enforced by a source-text assertion in the same test (Layer 1.1 RC-7). Feature prefixes and area names are passed in **as plain data**; the repository must not learn about the call catalogue.
3. **The existing column allow-list does not cover this view.** `TOKEN_USAGE_COLUMNS.call` has no `user_id`, `model_name` or `provider` — all three are needed by FR-B1/FR-B2. A **new named column list** is required, and it must keep excluding `request_payload`, `response_metadata` and `error_message` (the `token_usage` row does carry all three — `aiAnalytics.ts:170-174`).
4. **`AuditTrailRepository`'s file header states an invariant this work brushes against.** Its header says AI entries "are excluded IN THE QUERY, so the page, its counts and its CSV export can never see one." That must stay true of `listOwnerEntries`. A new admin method that returns **only** AI entries must be explicitly named, carry its own column list (the existing `OWNER_COLUMNS` deliberately omits `hash` and `user_email`), and **the file header must be amended in the same commit** — otherwise the next reader trusts a stale invariant.

---

### Ruling 3 — Scope boundary against the parked admin-authz slice

**SA-7 — Gap A must NOT convert `app/api/admin/audit-trail/route.ts` to `requireAdmin`. Any new Gap B route MUST use it.**

Verified in `lib/admin/__tests__/admin-authz-surface.guard.test.ts`:

- The audit-trail route is allow-listed on **both** `R1_PARKED` (line 226) and `R2_PARKED` (line 240), each dated 2026-09-20 and pointing at parked slice 4. Touching the file for an unrelated reason does **not** trip the guard — entries are keyed per file, not per diff.
- The lists are governed by an **equality ratchet**: `CAPS = { R1: { parked: 7 }, R2: { parked: 7, permanent: 1 }, ... }` and *"the caps match the lists exactly — a slack cap is as bad as no cap"*. So converting the route means deleting **two** allow-list entries **and** decrementing **two** caps in the same commit, or the required `Admin authz surface guard` check goes red and **blocks the merge**.

That is not hard, but it is the wrong cycle for it: it mixes a security-surface decision (parked deliberately, tracked in `docs/workplans/admin-authz-unification.md`) into a read-only UI change, and it turns Slice A's diff into a security review rather than a filter fix. The inline check in that route is behaviourally correct and fails closed (`route.ts:29-43`) — there is no security gain, only consistency.

**SA position:** leave it. Record it in the workplan as an explicit **non-goal**, noting that whoever does slice 4 must drop `CAPS.R1.parked` 7→6 and `CAPS.R2.parked` 7→6. Conversely, **any new route Gap B adds must call `requireAdmin` as its first statement** — R1 has zero open violations today and the guard is a required check, so an ungated new admin route is blocked from merging, by design. A new page at `app/admin/ai-activity/page.tsx` inherits the server guard from `app/admin/layout.tsx` (R6 is empty, and that is a real result) — and **must not** add a `route.ts` anywhere under `app/admin/**` (R3, also zero).

---

### Ruling 4 — The two route defects: split them

**SA-8 — Fold the error leak and the stale TODO into Slice A. Spin the search defect out.**

They are not the same kind of thing:

- **`error.message` returned unconditionally** (`route.ts:110` and `:193`) is a **live production information leak** on an admin route that reads every account's audit rows, against a non-negotiable CLAUDE.md rule. It is a two-line fix behind the standard `process.env.NODE_ENV === 'development'` guard, with zero design content, in a file Slice A is opening anyway. **Fold it in.** Same for the stale `// TODO: Add admin role check here` at `:45`, which now sits *below* a real admin check and actively misleads.
- **The search defect (F-5)** is a behavioural change with genuine design content: an honest search needs a **DB-level** predicate (text columns via `.or(...ilike...)` plus a JSONB strategy — note `idx_audit_trail_details` is a GIN index, so containment is available but `ILIKE` over stringified JSON is not indexable), and the count has to become a filtered count. That is a separate cycle with its own acceptance criteria. **Do not fold it into Slice A**, and do not let Slice A grow a half-fix.

**SA-9 — Consequence for FR-A4/AC-A4, and this must change in the document.** As written, FR-A4 ("totals are honest") reads as though Gap A has to fix something. It does not — *provided Gap A's acceptance never leans on search*. With an `action` or `entity_type` filter applied and no search term, the route already takes the `.eq(...)` + `count: 'exact'` path (`route.ts:72-82`, `:101`, `:172`), so the total and the pagination are already honest. **Rewrite FR-A4/AC-A4 to:** (a) AI filtering is tested **without** a search term, and the total and paging are asserted honest there; (b) the UI must stop implying the search is table-wide — either suppress the total while a search term is active, or label it, because today it renders "showing 3 of 14,332" using the *unfiltered* count; (c) the search fix is referenced as a separately tracked item.

---

### Ruling 5 — Security posture: holds, with three doors left open

NFR-1, NFR-3 and the metadata-only rule are correctly carried forward and match the established precedent (`app/api/admin/business-os/llm-usage/route.ts:1-22`; `TokenUsageRepository`'s header). Pino-only accountability with no audit event is **consistent** with that precedent, not a gap. Three things do leave a door open:

**SA-10 — NFR-2 says "never emails or business names", but the precedent it cites does not say that, and AC-A6 applies the rule to a page that already breaks it.**
- `app/api/admin/business-os/llm-usage/businesses/route.ts` — the picker BA proposes reusing — returns **account ids and company names** (never emails), by design and documented as such.
- `app/api/admin/audit-trail/route.ts:153-167` joins the `users` table and returns **`email` and `full_name`**, and `app/admin/audit-trail/page.tsx:533, 568` renders the email as the primary identifier for every row.

So AC-A6's regression clause *"Code review confirms no ... email is rendered"* is **unsatisfiable on the page Gap A is changing**, and would either fail review or force an unintended removal of the identifier a compliance browser needs. **Required:** scope NFR-2 explicitly to the **new Gap B view**; state that the audit page's existing `user_email` display is pre-existing, out of scope and unchanged; and restrict AC-A6's privacy clause to the **AI detail renderer** (which is what FR-A5 adds, and where the closed `AiAuditDetails` shape makes it genuinely checkable).

**SA-11 — the generic detail renderer is the actual privacy surface on the audit page, and it is untouched.** `page.tsx:788-802` renders *any* entry's `details` / `changes` as a key/value dump — including entity types whose changes carry owner content (`crm_contact`, `proposal`, `website_page`, `intake_form`). FR-A5 adds a formatted AI renderer, which is good, but it does not narrow the generic fallback and the requirement should not imply it does. Out of scope for this cycle; worth one line so nobody reads AC-A6 as a claim about the whole page.

**SA-12 — Zod is never named.** NFR-1 mentions a 400 and AC-B9 tests invalid input, but CLAUDE.md's mandatory rule ("all API route inputs validated with Zod before any business logic") is not stated. Name it, with the precedent to copy (`BusinessListQuerySchema` in `lib/business-os/usage/llmUsageVerification.ts`) — and make the **required, bounded date window** a schema constraint, not a UI convention, so the bound cannot be bypassed by calling the route directly.

**SA-13 — cross-account cost mixing is a posture issue, not only a correctness one.** SA-1's shared `runId` means a naive join shows one business's row containing another business's spend. That belongs under NFR-2 alongside the content rules, because on a cross-account operator screen it is the same class of mistake.

Noted, not blocking: a service-role cross-account read with no rate limit or cache. Acceptable for an admin screen behind a required gate; revisit if the window bound grows.

---

### Ruling 6 — Open questions, slicing, and what else is missing

**On the six open questions:**

| OQ | SA position |
|---|---|
| **OQ-1** | **Half of it is not a business question.** "Which number is authoritative" is already settled by Layers 1/1.5: the **ledger is the money record**. Do not put that to the user as a fork. What *is* genuine is the second half — do we want to be told about a mismatch, and at what tolerance. **Collapse OQ-1 to that**, and state the ledger ruling as a decision, not an option. |
| **OQ-2** | Genuine business question, correctly framed, and BA's suggestion (stay operator-only) is right. Keep. |
| **OQ-3** | Genuine. Note for the user that the answer also sets the migration's index shape (SA-5), so it is cheaper to answer before B0 than after. |
| **OQ-4** | **Not a real fork — the precedent already answers it.** The admin business picker returns company names today, and emails never. **SA ruling: account id + company name (via `BusinessProfileRepository`), never email, and never a business name in a log line** (the llm-usage route's existing rule). BA's own suggestion — "reuse the existing picker" — is inconsistent with "id only", because that picker returns names. Demote OQ-4 to a stated decision. |
| **OQ-5** | Genuine, and BA's "ship the screen first" is right. Keep. |
| **OQ-6** | **Already answered by the ledger-first ruling** — showing unaudited spend *is* ledger-first. Keep it only as a confirmation of the noisier UI, and reword it with SA-3's finding, because the honest version is "you will also see cache hits and no-call actions unless we classify them". |

**SA-14 — missing question (add as OQ-7):** Gap B needs a **database migration applied by hand on production** (no branch DB — the same constraint the entitlements and Layer 2 work hit). That is a real process cost and a real scheduling dependency, and the user should be asked before B0 is planned, not after.

**On the slicing:**

| Slice | SA verdict |
|---|---|
| **A** | **Sound and approved**, with SA-7's non-goal recorded, SA-8's two fixes folded in, SA-9's FR-A4 rewrite, and SA-10/SA-11's narrowing of AC-A6. Ships alone; needs no open question answered. **FR-A3 ruling** (BA asked SA to rule): `lib/audit/events.ts` imports only `./types`, so it is **client-safe** — import `AUDIT_EVENTS` / `EVENT_METADATA` and `AUDIT_ENTITY_TYPES` straight into the page. **No new API route.** 146 events is fine in `<optgroup>`s derived from the key prefix; a searchable control is optional polish, a curated subset is not acceptable. Back it with a source-level guard test asserting the page's JSX contains **no hardcoded event or entity-type literal** — that is what makes AC-A3 real rather than aspirational. |
| **B0 (new)** | **The migration: RPC + index.** Must exist, and must come first (SA-5). |
| **B1** | Sound once B0 exists — and it **absorbs the "not audited" marker** from B3, because under ledger-first that is the default state of a row, not an extra feature. B1 must carry SA-1 (the composite key), SA-3 (classification) and SA-4 (ungrouped / platform-account buckets). |
| **B2** | Sound as-is. |
| **B3** | Now = cost reconciliation (FR-B6) + cross-links (FR-B4) + SA-2's audited-but-unledgered pass. |

**Other corrections to make in the document:**
- Integration Points → "Tables read": strike *"No schema change is expected"* (SA-5), and correct the join key to `(entity_id = session_id, user_id)` (SA-1).
- F-8 and FR-B1: state that a grouping id is **not** unique per action, with the insights and briefing evidence.
- FR-B2's drill-down must filter on `user_id` as well as `session_id` (SA-1), or it lists other businesses' calls.
- NFR-6: the volume estimate covers `audit_trail` only. Add `token_usage`, which is the table this view actually scans, which grows *per call* rather than per action, and to which Business OS chat writes a row on **every turn, including cache hits**.
- FR-A5 vs FR-B2: a formatted AI detail renderer in Slice A partially duplicates Gap B's drill-down. Acceptable (it is a labelled-values pass over a closed, already-safe `AiAuditDetails`) — keep it **minimal**, and do not let it grow a ledger read.

---

### Approval

- [x] **Slice A approved to proceed to workplan**, conditional on SA-7, SA-8, SA-9, SA-10, SA-11 and the FR-A3 ruling being reflected first.
- [ ] **Gap B not approved yet.** Revise SA-1 to SA-6 (row key, reconciliation pass, unaudited classification, ungrouped/platform rows, the migration + re-slice, and the repository constraints), demote OQ-1's first half and OQ-4 to decisions, and add OQ-7 (SA-14). Re-submit for a short SA re-check — no second full review needed.

---

## Response to the SA Review

**Revised by BA — 2026-09-22.** Every SA point is applied. Two of SA's findings were independently re-verified in the tree before being written in as settled fact (F-13, F-14). Nothing in the review is disputed; two points are **extended** rather than merely accepted, and both extensions are flagged below so the re-check can focus there.

| SA point | Where it now lives | Note |
|---|---|---|
| **SA-1** — row key | **F-13**; [What one row is](#what-one-row-is); FR-B1, FR-B2, FR-B4; NFR-2; **AC-B5** | Verified independently: `insight-detect:143` mints `runId` outside the loop at `:206` and passes it at `:217`. Key is `(session_id, user_id)`; multi-entry rule stated (newest wins, all listed, row marked). AC-B5 is now an explicit **cross-tenant regression test** |
| **SA-2** — reverse pass | **FR-B9**; AC-B10; slice **B3** | "Audited, unledgered" row added as a second, cheap pass |
| **SA-3** — unaudited classification | **F-15**; **FR-B5**; [D-6](#decisions); **AC-B6** | **Extended.** Old AC-B5 is replaced. See the two refinements below |
| **SA-4** — ungrouped / platform rows | **F-16**; **FR-B8**; AC-B9; slice **B1** | Both get labelled buckets, visible by default, explicitly not counted as audit loss |
| **SA-5** — migration + re-slice | **F-14**; **FR-B11**; [D-7](#decisions); slice **B0**; Integration Points corrected | Verified independently: `PGRST123` at `20260929_usage_summary.sql:24-25`, the only index at `:98-99`. "No schema change is expected" struck |
| **SA-6** — repository constraints | **F-18**; **NFR-4** (all four, numbered); AC-B15 | `LedgerCallRow:51-64` confirmed to lack `user_id`, `model_name`, `provider`. Mandatory-rule framing added: existing file convention does not waive the repository pattern |
| **SA-7** — `requireAdmin` non-goal | **FR-A8**; NFR-1; AC-A10; roadmap | Recorded with the exact ratchet cost (two entries, two caps) |
| **SA-8** — split the defects | **FR-A7** (fold in); [Scope](#scope) + roadmap (spin out) | Error leak and stale TODO folded into Slice A; search defect is its own item |
| **SA-9** — FR-A4 rewrite | **FR-A4** (a/b/c); **AC-A4**, **AC-A9** | Gap A no longer leans on search; the misleading "showing X of Y" must go |
| **SA-10** — NFR-2 scope | **NFR-2** (scope note); **AC-A6** | Scoped to the new Gap B view; the audit page's `user_email` is pre-existing and unchanged; company names permitted per [D-4](#decisions) |
| **SA-11** — generic renderer | **FR-A8**; roadmap | One line, as asked, so AC-A6 is not read as a whole-page claim |
| **SA-12** — Zod | **NFR-10** (new); FR-B3; AC-B14 | Window bound **and** row cap are schema constraints, tested by calling the route directly |
| **SA-13** — cost mixing is a posture issue | **NFR-2**, second bullet | Stated as the same class of mistake as leaking text |
| **SA-14** — OQ-7 | [D-7](#decisions); Open Questions table | Answered: acceptable, with the scheduling dependency and the INVOKER + REVOKE constraint |
| **FR-A3 ruling** | **FR-A3**; AC-A3; Integration Points | Registries imported directly (client-safe), no new route, `<optgroup>`s, curated subset rejected, guard test required |
| **OQ demotions** | [D-1](#decisions), [D-4](#decisions) | Ledger-as-money-record and id+name are stated as decisions, not forks |

### Two extensions to SA-3, offered for the re-check

1. **One of SA-3's three causes cannot actually distort the number.** SA listed "actions that made no call at all" as a benign cause to exclude. It is real, but in a **ledger-first** view it produces no row at all — no call means no ledger row means no group — so it can never inflate the unaudited count from this side. The only no-call case that *does* write a ledger row is the deliberate cache-hit row. Stated precisely in **F-15** and **FR-B5**, because a defensible KI-B number depends on knowing which classes are actually in the denominator.
2. **There is a fourth cause SA did not list, and it ties SA-3 to SA-4.** `validateIdentities` (`aiActionAudit.ts:255`) refuses to write an entry when the grouping id or the account is not a UUID **or when the account is the platform account**. So a ledger row attributed to the platform account — the fallback at `aiAnalytics.ts:131-137` that SA-4 asks us to surface — is **permanently unauditable by design**, not lost. The same holds for a non-UUID group id, whose ledger row is simultaneously nulled to `session_id IS NULL` (`:140-146`) and so lands in SA-4's ungrouped bucket. **SA-4's two buckets and SA-3's benign classes are the same rows**, which is why FR-B5 and FR-B8 are written to agree with each other.

### Requested re-check scope

Short re-check only, per SA's own note. The focused questions:

1. Is `(session_id, user_id)` + "newest entry wins, all entries listed, row marked" the right handling for the briefing multi-entry case, or should a multi-entry group split into one row per entry?
2. Does the FR-B5 classification table match SA's intent, including the two extensions above?
3. Is FR-B11 specific enough for B0 to be planned — or does SA want the function signature and the index columns pinned in the requirement rather than left to the workplan?
4. Is the trailing exclusion window (FR-B5) correctly left to Dev/SA to size from the audit service's batch and flush behaviour, rather than fixed here?

---

---

## SA Re-Check Notes

**Re-checked by SA — 2026-09-22**
**Status:** ✅ **Approved — Gap B cleared.** Short re-check only, as agreed. SA-1 to SA-6 and SA-14 are properly addressed; the four queued questions are ruled below. **Three corrections** come out of the re-check — none of them blocks planning, all three belong in the B1/B3 workplans.

### 1. SA-1 to SA-6 and SA-14 — verified as applied

Each point was checked against the tree again, not just against the document.

| SA point | Where it landed | Re-check verdict |
|---|---|---|
| **SA-1** — row key | F-13, [What one row is](#what-one-row-is), FR-B1/B2/B4, NFR-2, **AC-B5** | ✅ **Fully addressed.** `(session_id, user_id)` is stated as a rule, carried into the join, the drill-down and the cross-link, and AC-B5 is now a real cross-tenant regression test rather than a description. This is the single most important change in the revision |
| **SA-2** — reverse pass | FR-B9, AC-B10, slice B3 | ✅ Addressed. AC-B10's "remove the ledger rows and watch a normal row flip" is a better test than the one SA asked for |
| **SA-3** — unaudited classification | F-15, FR-B5, D-6, AC-B6 | ✅ Addressed, **with one correction** — see §3 below. The classification table is right; the residual bucket's *name* is not |
| **SA-4** — ungrouped / platform buckets | F-16, FR-B8, AC-B9 | ✅ Addressed. "Visible by default and not filtered out" is the right posture and is stated as such |
| **SA-5** — migration + re-slice | F-14, FR-B11, D-7, slice B0, Integration Points | ✅ Addressed. `PGRST123` and the single `(user_id, created_at DESC)` index re-confirmed in `supabase/migrations/20260929_usage_summary.sql`. "No schema change is expected" is struck |
| **SA-6** — repository constraints | F-18, NFR-4 (four numbered), AC-B15 | ✅ Addressed. Re-verified: `tokenUsageRepository.contract.test.ts:90` asserts by source text that the repository imports nothing from `@/lib/business-os`, and `LedgerCallRow` carries no `user_id` / `model_name` / `provider`. The "existing file convention does not waive the mandatory rule" framing is exactly right |
| **SA-14** — OQ-7 | D-7, Open Questions table | ✅ Addressed, with the INVOKER + REVOKE constraint carried forward and the scheduling dependency made a checkpoint |

**Correction to SA's own first pass:** the FR-A3 ruling said "146 events". The catalogue is **148** (`AUDIT_EVENTS`), of which **121** have an `EVENT_METADATA` entry. Dev measured this; SA re-measured and confirms it. FR-A3 above is corrected, and the consequence is load-bearing — see the Slice A workplan's Decision 1.

> **Superseded figure, 2026-09-23 (QA EDGE-2).** Correct **as of the 2026-09-22 re-check**. Slice A's implementation then registered `AGENT_EXECUTED` in `AUDIT_EVENTS` at its writer, so the live figures are **149 / 122**. The gap of **27** — the part SA called load-bearing — is unchanged. FR-A3 carries the current numbers; this paragraph is kept as the record of the 146 → 148 correction.

### 2. Ruling on BA's extension 1 (no-call actions cannot distort the count) — **CONFIRMED**

BA is right, and the reasoning is sound. Verified end-to-end:

- `runAiAction` → `emitAiAuditEntry` returns early when `calls.length === 0` (`aiActionAudit.ts:304`), so an action that called nothing writes no entry — and it also wrote no ledger row, because a ledger row is only written by `trackAICall` from inside a call. In a **ledger-first** list it is not merely benign, it is **absent**. It cannot be in the denominator.
- The cache row is genuinely the exception: `recordCachedTurn` (`lib/business-os/bizql/telemetry/turnUsage.ts:85`) calls `trackAICall` **directly**, outside the usage scope, with `provider: 'cache'`, zero tokens and zero cost — and it early-returns unless the turn id is a UUID (`:88-94`), so such a row always *has* a group. That is precisely the shape that would have been read as audit loss.

FR-B5 and F-15 may stand as written on this point. The refinement is worth the words it takes.

### 3. Ruling on BA's extension 2 (the fourth cause) — **CONFIRMED, with one correction**

**The finding is correct and was missed on SA's first pass.** Verified: `validateIdentities` (`aiActionAudit.ts:252-258`) returns `null` when `!isUuid(spec.groupId) || !isUuid(accountId) || isPlatformAccount(accountId)`, and `emitAiAuditEntry` then writes nothing (`:306-310`). So:

- a **platform-account** ledger row is **permanently unauditable by design**, not lost — SA-4's bucket and SA-3's benign class really are the same rows;
- a **non-UUID grouping id** is refused by `validateIdentities` *and* nulled by the tracker (`aiAnalytics.ts:140-146`), so it lands in FR-B8's ungrouped bucket on the other side.

FR-B5 and FR-B8 agreeing with each other on that basis is correct.

**The correction — there is a fifth cause, and it lands in the residual bucket.** The audit account and the ledger account are **two independent parameters**, not one value: the ledger's `user_id` comes from `attribution.userId` through `buildBosCallContext` (`callCatalog.ts:283`, `:302`), while the entry's account comes from `spec.accountId` or `handle.setAccount`. `AiActionHandle.setAccount` exists **precisely because the account is sometimes discovered mid-action** (`aiActionAudit.ts:96-97`; exercised at `lib/business-os/llm/__tests__/aiActionAudit.test.ts:238`). If an action's calls carry a valid account but the spec's account is never set — or is set late, after a throw — the ledger rows have a **real `user_id` and a real `session_id`** and **no entry is written**. Nothing was lost; the write was refused.

That group is indistinguishable, *from the data*, from a genuinely lost entry. Two consequences, both for the **B1 workplan**, neither blocking:

1. **Rename FR-B5's residual class.** "Genuine loss or delay" overclaims. Call it **"No entry found — lost, delayed, or refused at write time"**, and state plainly that the view cannot separate a refusal from a loss. AC-B6's recorded figure is then honestly **an upper bound on KI-B** — still the first defensible measurement we have ever had, and a far better thing to publish than a number that quietly includes instrumentation bugs.
2. **The refusals are recoverable from the logs, cheaply.** Every refusal writes one error line — `AI audit entry not written: invalid grouping id or account, or the platform account` (`aiActionAudit.ts:308`) — carrying area, actionType, groupId and accountId. If B1's QA step counts those lines for the measured window, the residual can be split and KI-B becomes exact. Record as a **note in B1's QA procedure**, not as a functional requirement: the screen must not start reading logs.

### 4. Answers to BA's four queued questions

**Q1 — Briefing same-day re-narration: one row or split? → One row, as written. Confirmed.**

The ledger cannot attribute a call to one of the two entries: both entries share `entity_id` *and* `user_id`, and `token_usage` carries no discriminator that would separate run 1's rows from run 2's. Splitting would therefore require **inventing an allocation** (by timestamp, most likely) and presenting a guess as a fact. "Newest entry supplies the action fields, every entry listed in the drill-down, the row marked as carrying more than one" is the honest presentation, and it is what the data supports.

**But one thing must change in FR-B6, or this decision creates a permanent false-positive generator.** Where a group carries more than one entry, the cost reconciliation must compare the ledger sum against the **sum of every entry's `estimatedCostUsd`**, never the newest entry's alone. The ledger holds both runs' calls; the newest entry holds only its own. Compared against the newest alone, **every** multi-entry briefing group marks as a mismatch — by construction, forever — which would discredit the one self-check the attribution instrumentation has (D-1, F-17). Add that sentence to FR-B6 and an assertion to AC-B7.

**Q2 — Does FR-B5's classification match SA-3's intent? → Yes**, including both of BA's extensions, subject only to the residual-class rename in §3. The table is better than what SA asked for: SA asked for the benign causes to be separated, BA separated them *and* tied each one to a self-identifying marker in the data. The trailing-exclusion-window row is the part SA would have forgotten.

**Q3 — Should FR-B11 pin the function signature and index columns? → No. Leave them to the B0 workplan.**

FR-B11 already pins everything that is **non-negotiable**: INVOKER rights, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, grouping by `(session_id, user_id)`, the window + Business OS feature prefix as the access path, the limit applied in SQL, and the explicit rejection of summing in Node. Those are *properties*, and properties belong in a requirement. The exact column list and index shape are a **measured** decision — AC-B16 already demands a before/after measurement of rows scanned, bytes and latency — and pinning them here would freeze the answer that the measurement exists to produce. A requirement that dictates an index definition also quietly moves ownership of the query plan from Dev to BA, which is not where it belongs.

**One addition to FR-B11 instead**, because it is a property and not an implementation detail: **the 100-row cap is enforced inside the function**, not only by the route's Zod schema, so a caller reaching the RPC directly cannot widen it. AC-B11 currently says "rejected or clamped server-side" — make it say *where*. The mechanism stays Dev's choice.

**Q4 — Is the trailing exclusion window correctly left to Dev/SA? → Yes, correctly left. With two conditions, and one warning.**

Correct to leave it: it is a property of the audit write path, not a business preference.

- **Condition (a) — it must not be a magic number.** It derives from `AuditTrailService`'s batching: `batchSize: 100` and `batchIntervalMs: 5000` (`lib/services/AuditTrailService.ts:43-44`), flushed by a lazily-started, `unref`'d interval (`:260-265`).
- **Condition (b) — the boundary must be on screen.** "Actions in the last N minutes are not yet counted." A cut-off an operator cannot see is a cut-off they will misread. NFR-7 applies.
- ⚠️ **The warning, and it is the important half: do not size this window from `batchIntervalMs`.** Five seconds is an in-process timer. This runs on Vercel, where the function instance can be frozen or torn down before the timer fires and the queued entries are simply gone — **that is KI-B**, which is why Layer 3 recorded it as a known issue rather than a latency. A window derived from 5 s would be a rigorous-looking number that is wrong by orders of magnitude. Size it **conservatively, in minutes**, document it as a deliberately generous floor rather than a derivation, and put the reasoning in the code comment.

### 5. Carry-forward list for the Gap B workplans

Nothing here blocks B0 from being planned now.

| # | Change | Goes into |
|---|---|---|
| 1 | Rename FR-B5's residual class to "No entry found — lost, delayed, or refused at write time"; AC-B6's figure is an **upper bound** on KI-B | **B1** |
| 2 | Count the "AI audit entry not written…" log lines for the measured window so the residual can be split | **B1** — QA procedure only, never a screen feature |
| 3 | FR-B6 compares the ledger sum against the **sum of all** entries for a multi-entry group, never the newest alone; assert it in AC-B7 | **B3** |
| 4 | The row cap is enforced **inside** the RPC, not only in the route schema | **B0** |
| 5 | The trailing exclusion window is sized conservatively in minutes, **not** derived from `batchIntervalMs`; its boundary is stated on screen | **B1** |

### Approval

- [x] **Gap B approved.** SA-1 to SA-6 and SA-14 are addressed. B0 is ready to plan now; B1/B2/B3 carry the five items above.
- [x] **Slice A** remains approved from the first pass. Its workplan is reviewed separately in [BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_A_WORKPLAN.md).
- [x] **No second full review needed.** The next SA gate is the B0 workplan.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-23 | **FR-A3 catalogue count corrected: 148 → 149 (QA EDGE-2)** | Slice A's implementation registered `AGENT_EXECUTED` in `AUDIT_EVENTS` at its writer (539 live rows carried it under an unregistered name), so the catalogue SA measured at **148 / 121** is now **149 / 122**. FR-A3 carries the current figures and now says explicitly that the totals move on every registration — the load-bearing fact is the **gap of 27** events with no `EVENT_METADATA` entry, which is unchanged and is what makes `AUDIT_EVENTS` the source. SA's 146 → 148 correction paragraph is kept as the record, with a dated "superseded figure" note beneath it. Documentation only; no requirement changes meaning |
| 2026-09-22 | **SA re-check — Gap B approved** | SA Re-Check Notes added. SA-1 to SA-6 and SA-14 verified as applied, against the tree. BA's extension 1 (a no-call action cannot inflate a ledger-first count) **confirmed**, with `recordCachedTurn` re-verified as the one no-call path that does write a ledger row. BA's extension 2 (the fourth cause: `validateIdentities` refusing platform-account and non-UUID identities) **confirmed, with one correction** — a **fifth cause** exists, because the audit account (`spec.accountId` / `setAccount`) and the ledger account (`attribution.userId`) are independent parameters, so an action can have real ledger rows and a refused entry; FR-B5's residual class is renamed and AC-B6's figure becomes an upper bound on KI-B. Four queued questions ruled: one row for a multi-entry briefing group — **with FR-B6 required to sum all entries, or every such group marks as a cost mismatch by construction**; FR-B5's classification accepted; FR-B11 left un-pinned by design, **plus the cap is enforced inside the RPC**; the trailing exclusion window correctly left to Dev/SA but **explicitly not to be derived from `batchIntervalMs`** — on Vercel the instance can die before the 5 s flush. SA's own "146 events" corrected to **148** |
| 2026-09-22 | **Revised after SA review; all open questions answered** | Applied SA-1 to SA-14. **New findings F-13 to F-18** (grouping id not unique per action, verified at `insight-detect:143`/`:217`; aggregates disabled + no supporting index, verified at `20260929_usage_summary.sql:24-25`/`:98-99`; four causes of a missing audit entry; ungrouped and platform-account ledger rows; both cost numbers from the same in-memory records; the `TokenUsageRepository` contract pin). **New [Decisions](#decisions) section D-1 to D-7** replacing the open questions — mark the row at a $0.0001 tolerance; admin-only with owner-facing deferred; explicit range + six presets + a server-side 100-row cap with an honestly filtered count; account id + company name, never email; screen first; classify the unaudited rows; hand-applied migration accepted with INVOKER + REVOKE. Gap B rewritten: row key `(session_id, user_id)`, drill-down scoped by account, **new FR-B8** (ungrouped / platform buckets), **FR-B9** (audited-but-unledgered reverse pass), **FR-B10** (server-side cap, honest count), **FR-B11** (the read is answered in the database). Gap A: FR-A4 rewritten off search, **FR-A7** (the two route defects) and **FR-A8** (three non-goals) added. NFR-2 scoped to the new view, NFR-4 given four named constraints, NFR-6 re-based on `token_usage`, **NFR-10** (Zod) added. Re-sliced to **A, B0, B1, B2, B3** with a readiness table. Acceptance criteria renumbered and extended (A: 10, B: 18). Search defect and the shared `runId` spun out to the roadmap |
| 2026-09-22 | SA review | SA Review Notes added. All 12 as-built findings re-verified and confirmed. Slice A approved with changes; Gap B sent back on six points — the grouping id is not unique per action (insights share one run id across businesses; briefing ids are deterministic per day), ledger-first needs a reverse reconciliation pass, "not audited" has two benign causes, ungrouped and platform-account rows need a bucket, a migration (RPC + index) is required and becomes a new B0 slice, and the repository constraints are under-specified. OQ-1 (first half) and OQ-4 demoted to decisions; OQ-7 added |
| 2026-09-22 | Created | First draft. As-built findings F-1 to F-12 verified in the tree; Gap A (catalogue-driven audit filters) and Gap B (a combined AI activity view) specified; a new `/admin/ai-activity` page recommended over extending the audit trail or the analytics page; six open questions raised for the user |
