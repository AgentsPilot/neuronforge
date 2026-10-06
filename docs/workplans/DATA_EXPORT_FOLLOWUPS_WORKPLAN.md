# Workplan: Data Export Follow-ups (FU-1, FU-P1, FU-P2)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** none of its own. Closes FU-1 in [BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md](/docs/workplans/BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md) §10, and FU-P1 / FU-P2 in [DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md](/docs/workplans/DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md). Carries one requirement row update (item 18).
**Branch:** `fix/data-export-history-and-columns` (off `origin/main` 82cf7b14, which includes #206 and BD-26)
**Date:** 2026-10-04
**Status:** Code Complete (SA workplan review approved with conditions C-1 to C-4, all met; BQ-1 / BQ-2 decided by the user; uncommitted, awaiting SA code review)

## Overview

`GET /api/user/data-export` (GDPR Art. 15 / 20) has three known defects. **FU-1:** the audit read filters and orders on `audit_trail.timestamp`, which does not exist, so the export has never held audit history. **FU-P2:** the 500 response sends `error.message` in production. **FU-P1:** most reads use `select('*')`, so whatever column anyone adds to these tables lands in a customer's download. A live-schema check while planning found a **second phantom column**: the plugin connection read selects `plugin_connections.metadata`, which does not exist, so the export has never listed plugin connections either (new finding NF-1, fixed under FU-P1). This plan fixes all of it and keeps the export's top-level keys unchanged.

---

## 1. Live schema evidence

Measured 2026-10-04 on branch `fix/data-export-history-and-columns` at 82cf7b14, against the live project (PostgREST OpenAPI column lists plus zero-row selects, service role, read-only). Nothing was written.

| Probe | Result |
|---|---|
| `audit_trail?select=*&order=timestamp.desc&limit=0` | **400 42703** "column audit_trail.timestamp does not exist" (FU-1 confirmed) |
| `audit_trail?select=*&created_at=gte.…&order=created_at.desc&limit=0` | 200 (fix column confirmed) |
| `plugin_connections?select=user_id,plugin_key,created_at,updated_at,metadata&limit=0` | **400 42703** "column plugin_connections.metadata does not exist" (**NF-1**) |
| same without `metadata` | 200 |
| `plugin_connections.profile_data` holding `token` / `signed_access_token` | **2 live rows** (a provider's access token stored inside the profile JSON) |
| `credit_transactions.metadata->>actual_cost_usd` not null | 0 of 564 rows |
| `audit_trail.hash` not null | 0 rows |
| `plugin_connections.settings` not `{}` | 0 rows |

Key names inside the JSON columns were scanned (names only, no values): `profiles.onboarding_data`, `agents.agent_config`, `agent_configurations.input_values`, `agent_executions.result` / `logs` and `credit_transactions.metadata` hold no secret-looking keys ("token" there means usage counts). Only `plugin_connections.profile_data` holds credentials.

---

## 2. Analysis Summary

| Touches | Detail |
|---|---|
| Route | `app/api/user/data-export/route.ts`: plugin connection mapping (NF-1), 500 body (FU-P2), header comment |
| Repositories | The 8 `…ForUserDataExport` / `listOwnerEntriesForExport` methods in `UserProfileRepository`, `AgentRepository`, `ExecutionRepository`, `AgentConfigurationRepository`, `PluginConnectionRepository`, `UserSubscriptionRepository`, `CreditTransactionRepository`, `AuditTrailRepository` |
| Tests | `app/api/user/data-export/__tests__/route.characterization.test.ts`, `route.test.ts`, `lib/repositories/__tests__/userDataExportReads.test.ts` — all already in `test:bos-entitlements` (CI) |
| Docs | This workplan; BD-26 workplan §10; refactor workplan follow-ups; deduction requirement slice 11 table + §19 |
| Not touched | DB schema, migrations, RLS, the `auditLog(...)` call, auth block, `lib/audit/ownerVisibility.ts` logic (comment line only if needed), the purge, any UI (the only consumer is a plain link in `DangerZonePanel.tsx`) |

`console.*` count in every touched code file: **0** (route and all 8 repositories). Nothing to flag.

---

## 3. Implementation Approach

### 3.1 FU-1: audit history

In `AuditTrailRepository.listOwnerEntriesForExport`: `.gte('timestamp', since)` → `.gte('created_at', since)` and `.order('timestamp', …)` → `.order('created_at', { ascending: false })`. The 90-day window (computed by the route), `.limit(10000)`, `.eq('user_id', userId)` and **both** BD-26 exclusions (`OWNER_HIDDEN_ENTITY_TYPES` and the `AI_ACTION_EVENT_PREFIX` guard, written as today) stay character for character. The select becomes the existing `OWNER_COLUMNS` constant (§4.8). The JSDoc "known and deliberately unchanged" paragraph and the route header's FU-1 paragraph are rewritten to say the read now works.

**Behaviour change, intended:** exports start containing up to 10,000 audit rows of the last 90 days. The repository stops logging 42703 at `error` on every export.

### 3.2 FU-P2: 500 body

```typescript
return NextResponse.json(
  {
    success: false,
    error: 'Data export failed',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  },
  { status: 500 }
);
```

The Pino error line (`{ err }`) is unchanged, so the real cause stays in the logs. `catch (error: any)` becomes `catch (error: unknown)` with an `instanceof Error` narrowing (rule 6; it is the line being changed). The 401 body `{ error: 'Unauthorized' }` is left as is (out of scope, OP-4).

### 3.3 FU-P1: explicit columns

Each method replaces `'*'` with a module constant `…_DATA_EXPORT_COLUMNS` next to the method, the pattern `PluginConnectionRepository.USER_DATA_EXPORT_COLUMNS` and `AuditTrailRepository.OWNER_COLUMNS` already use. Rule for each column: **include** the person's own data, things they typed, things the platform derived about them or their automations, and their own payment references; **exclude** credentials, internal hashes, queue / scheduler plumbing, internal throttles and admin-side policy values. JSDoc "every column" wording is updated in each method. Filters, order, limits and `.single()` are unchanged.

**NF-1 (plugin connections):** the route's mapping reads `conn.metadata`, which never existed, so the per-connection object changes. New mapping (top-level key `plugin_connections` unchanged):
`{ plugin_key, plugin_name, account_username: username, account_email: email, scope, status, connected_at: connected_at ?? created_at, last_updated: updated_at, last_used, disconnected_at }`. The `metadata` key is dropped: it has never been delivered to anyone, because the whole select has always failed (OP-2).

### 3.4 Item 18 and doc follow-ups

- `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md`, slice 11 delivery status (§ "7. Slice 11 delivery status"): replace **only** the 11d row's status cell with "✅ Merged PR #213 (2026-10-04, 9d19bc77)"; add one §19 Change History row "Slice 11 complete". **Do not touch the 8b or 11c rows:** the slice 7 / 8 session refreshes those on its own branch, and editing them here would conflict.
- BD-26 workplan §10: mark FU-1 closed by this PR (Edit only). Refactor workplan "Not changed" list and §"When this merges": mark FU-1, FU-P1 and FU-P2 closed by this PR (Edit only). The `any` typing note: `catch` is fixed here; `exportData: any` stays open (OP-5).

---

## 4. Per-table column proposal

Totals are live column counts. "BQ" points to §5.

### 4.1 `profiles` (18 → 18)

Include all: `id, full_name, avatar_url, plan, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data, hourly_rate_usd, org_id`. Every column is the person's own profile or onboarding answer; `onboarding_data` holds only goal / mode / role / domain / profile (verified). The list still matters: a future column is no longer exported by default.

### 4.2 `agents` (56 → 52)

| Excluded | Reason |
|---|---|
| `qstash_schedule_id` | Third-party scheduler handle (plumbing) |
| `workflow_hash` | Internal SHA-256 used to detect workflow changes |
| `schedule_version` | Optimistic-lock counter for the schedule RPC |
| `last_successful_calibration_id` | Internal pointer into `calibration_history` (that table is not exported) |

Included: everything else, deleted and archived agents still included (no status filter, unchanged). Includes the AI-derived fields (`ai_reasoning`, `business_entity_type`, `entity_desirability`, `items_per_week_baseline`, …) because derived data about the person's automations is in scope, and `intensity_score` / `last_intensity_update` because they decided what the person was charged (BQ-1).

### 4.3 `agent_executions` (28 → 24, or 26 if BQ-1 = include)

| Excluded | Reason |
|---|---|
| `job_id` | Queue job handle (plumbing) |
| `queue_name` | Queue routing (plumbing) |
| `total_cost_usd` | BQ-1: the platform's own provider cost, not a charge to the person |
| `models_used` | BQ-1: carries per-model provider cost |

Included: status, timings, `result`, `logs`, `error_message`, retry fields, `run_mode`, `execution_type`, `primary_model`, `primary_provider` (which AI service processed their data: a transparency item), `routing_tier`, `complexity_score`.

### 4.4 `agent_configurations` (16 → 16)

Include all: `id, agent_id, user_id, status, input_values, input_schema, total_logs, confidence, quality_score, duration_ms, plugins_used, business_context, data_processed, completed_at, created_at, updated_at`. `input_values` are values the person typed (search keywords, sheet ids, recipient emails).

### 4.5 `plugin_connections` (19 → 12 read; route outputs 10 keys)

Read: `user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at` (12 incl. `user_id`, which the route does not output).

| Excluded | Reason |
|---|---|
| `access_token`, `refresh_token` | Credentials |
| `profile_data` | Holds a provider access token for 2 live connections (§1); the person's name / email from it are already covered by `username` / `email` (OP-3) |
| `settings` | Empty `{}` on every live row; free-form, so a future secret could land there unseen (OP-3) |
| `expires_at`, `last_refreshed_at` | Token lifecycle plumbing |
| `id` | Internal row id, never output by the mapping |
| `metadata` | Does not exist (NF-1) |

### 4.6 `user_subscriptions` (47 → 45)

| Excluded | Reason |
|---|---|
| `last_low_balance_alert_at` | Internal throttle for alert emails |
| `grace_period_days` | Admin-configured policy value, not a fact about the person |

Included: balances, totals, status, period dates, `payment_method_last4` / `payment_method_brand` (already shown to the person in the app), plan amounts, quotas, trial / free-tier fields, `account_frozen`, `agents_paused`, `last_calculator_inputs`, and the Stripe identifiers `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id` (BQ-2).

### 4.7 `credit_transactions` (18 → 18)

Include all: `id, user_id, credits_delta, transaction_type, description, related_agent_id, created_at, token_usage_id, activity_type, balance_before, balance_after, boost_pack_id, reward_config_id, stripe_payment_intent_id, metadata, activity_name, agent_id, session_id`. `metadata` holds token counts, multiplier, `amount_paid_cents` and Stripe session / invoice ids; no `actual_cost_usd` on any live row (§1). If BQ-1 is answered "exclude cost", nothing to scrub today; a future cost key inside `metadata` would need a scrub (OP-6).

### 4.8 `audit_trail` (17 → 15)

Use the existing `OWNER_COLUMNS` (the owner audit read already serves exactly this set): `id, user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, ip_address, user_agent, session_id, severity, compliance_flags, created_at`.

| Excluded | Reason |
|---|---|
| `hash` | Internal tamper-detection hash (null on every live row today) |
| `user_email` | Denormalised search copy of the person's email; already in `user_profile.email` |

`ip_address` and `user_agent` are kept: they are the person's own request data. Hidden types and AI action events stay out (BD-26).

---

## 5. Business questions

| # | Question (plain words) | Options | Recommendation |
|---|---|---|---|
| **BQ-1** | When a customer downloads their data, should it show **what each automation run cost us** at the AI provider (in dollars, per model)? | **A.** Leave our internal dollar cost out; keep which AI service and model processed their data, and everything used to work out their charge (credits, token counts, intensity score). **B.** Include our dollar cost too | **A.** Our provider cost is our commercial information, not information about the customer; the Business OS owner card already never shows dollars or cost. The customer still sees which AI processed their data and why they were charged what they were |
| **BQ-2** | Should the download include the **payment processor's reference numbers** for the customer (customer, subscription, price and payment ids at Stripe)? | **A.** Include. **B.** Leave out | **A.** They are references to the customer's own payments, are useless without our Stripe secret key, and help if the customer raises a dispute with us or their bank. Leaving them out would also mean scrubbing them from inside the transaction details |

Neither blocks the work: Dev builds the recommendations and flips one list per answer.

**User decisions (2026-10-04, via TL):**
- **BQ-1 = A, decided:** our provider cost stays out. `agent_executions.total_cost_usd` and `models_used` are not exported (`EXECUTION_DATA_EXPORT_COLUMNS`); which provider / model processed the data stays in. The residual risk (a future cost key inside `credit_transactions.metadata`) is written in the `CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS` JSDoc (SA OP-6 / C-3).
- **BQ-2 = A, decided:** the Stripe reference ids are exported (`stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id` on the last line of `SUBSCRIPTION_DATA_EXPORT_COLUMNS`; `stripe_payment_intent_id` and the ids inside `metadata` on `credit_transactions`).

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/user/data-export/route.ts` | modify | NF-1 mapping, FU-P2 500 body + `catch (error: unknown)`, header comment |
| `lib/repositories/AuditTrailRepository.ts` | modify | FU-1 `created_at`; select `OWNER_COLUMNS`; JSDoc |
| `lib/repositories/PluginConnectionRepository.ts` | modify | `USER_DATA_EXPORT_COLUMNS` per §4.5; `PluginConnectionExportRow` type; JSDoc |
| `lib/repositories/UserProfileRepository.ts`, `AgentRepository.ts`, `ExecutionRepository.ts`, `AgentConfigurationRepository.ts`, `UserSubscriptionRepository.ts`, `CreditTransactionRepository.ts` | modify | Explicit column constant; JSDoc |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin (§7) |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | `created_at`, rows appear, hidden rows dropped, 500 body |
| `lib/repositories/__tests__/userDataExportReads.test.ts` | modify | Column pins, deny-list, `created_at` |
| `docs/workplans/BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md` | edit | FU-1 closed |
| `docs/workplans/DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md` | edit | FU-1 / FU-P1 / FU-P2 closed |
| `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` | edit | 11d row only + one §19 row |
| `docs/workplans/DATA_EXPORT_FOLLOWUPS_WORKPLAN.md` | create | This file |

---

## 7. Tests (all in `test:bos-entitlements`, which CI runs)

| Test | Change |
|---|---|
| Characterization pin | **Deliberately updated, marked as intended behaviour changes:** R8 now `gte` / `order` on `created_at` with `OWNER_COLUMNS`; R1–R7 pinned to their new column constants; plugin connection call and mapped body per §3.3; 500 body `{ success: false, error: 'Data export failed' }` with no `message` and no `details` outside development. Everything else (headers, auth, order of reads, audit write, logs) unchanged and still pinned |
| Route: audit rows appear (new) | The fake builder returns seeded audit rows; they land in `audit_logs` and `summary.total_audit_logs` |
| Route: hidden types still excluded (new) | The fake builder **applies** the recorded `.not('entity_type','in',…)` and `.not('action','like',…)` filters to a seed holding one visible row, one `business_os_credit_lot` row and one `BUSINESS_AI_ACTION_…` row; only the visible row is exported |
| Route: 500 body (new) | Production: no `message`, no `details`, error text absent from the body; development: `details` equals the message |
| Repository: no `*` and deny-list (new) | Every export read selects an explicit list; none contains `access_token`, `refresh_token`, `profile_data`, `hash`, `user_email`, `qstash_schedule_id`, `workflow_hash`, `job_id`, `last_low_balance_alert_at`, … (the §4 exclusions) |
| Repository: audit read | `created_at` for filter and order, limit 10000, both BD-26 exclusions (existing guard test unchanged) |
| Live probe (not in repo) | Before handover Dev runs a zero-row select of every new column list against the live schema (scratch script, read-only) and pastes the 8 results into §9. Needed because `npm run schema:check` does not replay column lists held in constants |

Also run: `lib/audit/__tests__/ownerAuditReads.guard.test.ts` (in the suite) and `npx tsc --noEmit` on touched files.

---

## 8. Task List

- [x] 1. SA workplan review; record BQ-1 / BQ-2 answers if given ✅ (both decided by the user, §5)
- [x] 2. FU-1 in `AuditTrailRepository` + JSDoc ✅
- [x] 3. FU-P1 column constants in the 8 repositories + JSDoc ✅
- [x] 4. NF-1 mapping (+ C-1 `account_profile`), FU-P2 500 body, header comment in the route ✅
- [x] 5. Tests per §7; `npm run test:bos-entitlements` green ✅
- [x] 6. Live zero-row probe of all 8 lists; paste into §9 ✅
- [x] 7. Doc edits (§3.4) ✅
- [x] 8. `git diff --numstat` check (no deletion-only files); hand to SA code review; leave uncommitted ✅

**Estimate:** about 1 day (0.4 d code, 0.4 d tests, 0.2 d probe and docs).

---

## 9. Implementation results

**Dev, 2026-10-04. Branch `fix/data-export-history-and-columns`, uncommitted.**

### 9.1 What changed

| Item | Where | Result |
|---|---|---|
| FU-1 | `AuditTrailRepository.listOwnerEntriesForExport` | `.gte` / `.order` on `created_at`; select `OWNER_COLUMNS`; `.eq('user_id')`, both BD-26 `.not(...)` lines and `.limit(10000)` unchanged character for character; JSDoc rewritten; `OWNER_COLUMNS` JSDoc notes the export now shares it |
| FU-P1 | 8 repositories | `PROFILE_DATA_EXPORT_COLUMNS` (18), `AGENT_DATA_EXPORT_COLUMNS` (52), `EXECUTION_DATA_EXPORT_COLUMNS` (24), `AGENT_CONFIGURATION_DATA_EXPORT_COLUMNS` (16), `USER_DATA_EXPORT_COLUMNS` (13 incl. `user_id` and `profile_data`), `SUBSCRIPTION_DATA_EXPORT_COLUMNS` (45), `CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS` (18), `OWNER_COLUMNS` (15). Filters, order, limits, `.single()` unchanged. Each method's cast became `as unknown as …` (the pattern `OWNER_COLUMNS` already uses at `listOwnerEntries`): a concatenated column string types the result as `GenericStringError`, which scoped `tsc` caught |
| NF-1 + C-1 | `route.ts` | Per-connection keys `plugin_key, plugin_name, account_username, account_email, account_profile, scope, status, connected_at (?? created_at), last_updated, last_used, disconnected_at`; `metadata` dropped (OP-2). `account_profile` = module-private `accountProfile(profile_data)`: the SA's 21-key allow-list, top-level only, value kept only if a string or an array of strings, anything else (non-object, array, nested object, mixed array, unknown key, `id` / `sub` / `token*`) dropped. The raw column never reaches the body |
| FU-P2 | `route.ts` | 500 body `{ success: false, error: 'Data export failed', details: dev only }`; `catch (error: unknown)` with `instanceof Error` narrowing; Pino `{ err }` line unchanged. 401 body unchanged (OP-4) |
| C-2 | `route.characterization.test.ts` | Every changed expectation carries a comment naming this workplan: the header note, `SELECTS`, each select, the audit `created_at` pair, the plugin seed, `MAPPED_CONNECTIONS`, the 500 test title and body. Nothing else in the pin changed (auth, read order, client, headers, empty-section and all-fail bodies, audit write, log lines) |
| C-3 | JSDoc | Every new constant: "Changing this changes what the export holds: a privacy decision." `CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS`: `metadata` exported whole, a provider-cost key written there would leak, nothing scrubs it (OP-6 / BQ-1). Route header's "fails on every export until FU-1" paragraph rewritten (now says the read works, and why earlier exports had no audit history or plugin connections) |
| BQ-1 / BQ-2 | `ExecutionRepository`, `UserSubscriptionRepository` | Built as decided (§5); each reversal is a one-line list change, said so in the JSDoc |

### 9.2 C-4 live probe (read-only, zero rows)

Run 2026-10-04 from a scratch script outside the repo, service role, `GET …/rest/v1/<table>?select=<list>&limit=0`, the list extracted from the repository source so the probe checks what ships. Same filters / order as the method. Nothing written.

| Table | Constant | Columns | Result |
|---|---|---|---|
| `profiles` | `PROFILE_DATA_EXPORT_COLUMNS` | 18 | **200** `[]` |
| `agents` | `AGENT_DATA_EXPORT_COLUMNS` | 52 | **200** `[]` |
| `agent_executions` | `EXECUTION_DATA_EXPORT_COLUMNS` | 24 | **200** `[]` |
| `agent_configurations` | `AGENT_CONFIGURATION_DATA_EXPORT_COLUMNS` | 16 | **200** `[]` |
| `plugin_connections` | `USER_DATA_EXPORT_COLUMNS` (incl. `profile_data`) | 13 | **200** `[]` |
| `user_subscriptions` | `SUBSCRIPTION_DATA_EXPORT_COLUMNS` | 45 | **200** `[]` |
| `credit_transactions` | `CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS` | 18 | **200** `[]` |
| `audit_trail` | `OWNER_COLUMNS`, `created_at` filter + order | 15 | **200** `[]` |
| Control: `audit_trail?select=id&order=timestamp.desc` | — | — | 400 42703 "column audit_trail.timestamp does not exist" |
| Control: `plugin_connections?select=metadata` | — | — | 400 42703 "column plugin_connections.metadata does not exist" |

No 42703 on any shipped list; the two controls prove the probe would have shown one. Column names for the lists came from the PostgREST OpenAPI description (metadata only, no rows), counts matching §4 (18 / 56 / 28 / 16 / 19 / 47 / 18 / 17).

### 9.3 Tests and checks

| Check | Result |
|---|---|
| `route.characterization.test.ts` | **27 / 27** |
| `route.test.ts` (7 → 14: production / development 500 body, audit rows exported and counted, hidden rows dropped by the applied `.not` filters, C-1 allow-list with token / `signed_access_token` / `id` / `sub` / nested objects / mixed array / unknown key, raw `profile_data` absent from the body, non-object `profile_data`) | **14 / 14** |
| `userDataExportReads.test.ts` (+ plugin select pin, audit `created_at` / limit, per-read explicit list + deny-list ×8) | **29 / 29** |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` (OP-8) | **14 / 14** |
| `npm run test:bos-entitlements` | **180 suites, 4,605 tests, green** (65 s) |
| `npm run test:authz-guard` | **119 / 119** |
| `npm run typecheck:bos-llm` | passed: 419 files, 28 errors, 0 new (reports one baseline entry fixed in `app/api/onboarding/build/route.ts`, not touched here) |
| Scoped `tsc` (8 GB heap, the 12 touched TS files + `next-env.d.ts`) | **0 errors** (the first run found the 8 `GenericStringError` casts, fixed) |
| ESLint, 12 touched TS files | 0 errors, 3 warnings, all pre-existing lines (`exportData: any` OP-5, `AgentConfigurationRepository` :240, `AgentRepository` :134) |
| Tailwind escape guard | **6 / 6** |
| Backslash + hex scan, every changed file | 0 |
| `console.*` in touched files | 0 |

### 9.4 Deviations

1. **§7 deny-list:** `profile_data` is not in the repository deny-list, because C-1 makes the read select it on purpose. Instead `route.test.ts` asserts the text `profile_data` never appears in the body and that no non-allow-listed value does.
2. **Casts:** `as X` → `as unknown as X` in the 8 export methods (type-only, see 9.1). Not in the plan; required by the column constants.
3. **Requirement 11d row:** the status cell now starts "✅ Merged PR #213 (2026-10-04, 9d19bc77)" and keeps the SA / BQ history after it (the 11c row's form), instead of dropping that history.
4. **Doc edits:** besides the requested rows, one Change History row each in the BD-26 and refactor workplans (living-doc standard). In the refactor workplan, FU-P3 sits in a new small "Follow-up status" table under §2's "Not changed" list, as the file had no follow-up table.

---

## 10. Open points for SA

1. **OP-1 Column constants vs inline literals.** Constants (proposed) match `OWNER_COLUMNS` / `USER_DATA_EXPORT_COLUMNS` and are easy to pin, but `schema:check` skips them; hence the one-off live probe in §7. Alternative: single-line inline `.select('…')` literals that `schema:check` replays (agents' list is ~52 names on one line). SA picks.
2. **OP-2 Plugin connection mapping (NF-1).** Approve the new per-connection keys in §3.3 and dropping `metadata` (never delivered). Top-level keys unchanged.
3. **OP-3 `profile_data` and `settings` excluded whole.** Alternative: export `profile_data` with known credential keys stripped. Proposed whole-column exclusion: key-stripping is a deny-list and fails open when a new provider stores a token under a new name.
4. **OP-4 401 body** `{ error: 'Unauthorized' }` is not the CLAUDE.md format. Leave (proposed, not in FU-P2's scope) or align in the same PR.
5. **OP-5 `exportData: any`** stays (typing follow-up); only the `catch` is typed here.
6. **OP-6 Cost inside JSON.** If BQ-1 = A, `credit_transactions.metadata` has no cost key today (0 / 564). No scrub proposed; a deny-list test cannot see into live JSON, so a future writer adding `actual_cost_usd` there would leak it. Accept, or require a route-level scrub.
7. **OP-7 Export completeness (out of scope, recorded).** The export covers only the 8 agent-platform tables. Business OS data (CRM contacts, bookings, invoices, credit charges / lots, …) is not in it at all. A GDPR Art. 15 gap for Business OS customers; suggest a BA follow-up rather than growing this PR.
8. **OP-8 Guard test.** Confirm `ownerAuditReads.guard.test.ts` accepts `OWNER_COLUMNS` instead of `'*'` in `listOwnerEntriesForExport` (it checks the two exclusions; Dev will confirm by running it).

---

## SA Review Notes

## SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04**
**Status:** ✅ Approved with conditions (C-1 to C-4). Dev may start; the conditions are checked at code review.

**Independently checked:** live column lists of all 8 tables (PostgREST OpenAPI, read-only) match §4's counts (18 / 56 / 28 / 16 / 19 / 47 / 18 / 17); key names (no values) of `credit_transactions.metadata` (564 rows), `agent_executions.models_used` (1000 rows) and `plugin_connections.profile_data` (35 rows); the route, `AuditTrailRepository.listOwnerEntriesForExport` / `OWNER_COLUMNS`, `PluginConnectionRepository.USER_DATA_EXPORT_COLUMNS`, the BD-26 guard test and `scripts/schema-check.ts`. Not re-checked: the requirement's 11d row text (taken from §3.4 as written).

### OP rulings

| OP | Ruling |
|---|---|
| OP-1 | **Constants.** `schema:check` is not in any CI workflow, so the literal alternative buys only a manual check and costs a 52-name line. Constants plus the §7 live zero-row probe (pasted into §9) is the gate. |
| OP-2 | **Approved.** New per-connection keys per §3.3; dropping `metadata` is not a regression (the select has always failed, so nothing was ever delivered). Top-level `plugin_connections` key unchanged. Mark it in the characterization re-pin as an intended change. |
| OP-3 | **Raw `profile_data` stays out (approved); `settings` stays out (approved). But see C-1:** the stated reason ("name / email already covered") is incomplete. Live key names show the provider profile also holds the person's given / family name, picture, locale, job title, mobile and business phone, office location, country, address. Dropping all of that is dropping the owner's own personal data. Fix with a fail-closed **allow-list** (not the deny-list stripping Dev rightly rejected). |
| OP-4 | **Leave the 401 body.** Out of FU-P2 scope; it leaks nothing. |
| OP-5 | **Accepted.** `exportData: any` stays an open typing follow-up; `catch (error: unknown)` is done here. |
| OP-6 | **Accept, no route-level scrub.** Today's `credit_transactions.metadata` keys are: agent_name, multiplier, raw_tokens, adjusted_tokens, pilot_tokens, intensity_score, execution_type, execution_id, boost_pack_id, amount_paid_cents, stripe_* ids, period_start / period_end, is_prorated. None is our provider cost. Record the risk in the `CreditTransactionRepository` export constant's JSDoc (C-3). |
| OP-7 | **Out of scope here; record it, do not build it.** See "OP-7 recording" below. |
| OP-8 | **Confirmed by reading.** The guard (`exportReadAppliesBothExclusions`) only matches the two `.not(...)` calls inside the method body; it does not look at `.select`. `OWNER_COLUMNS` passes. Dev still runs it (§7). |

### Column list check (§4)

| Table | Verdict |
|---|---|
| `profiles` | ✅ All 18; nothing secret. |
| `agents` | ✅ 4 plumbing exclusions are reasonable; deleted / archived rows still exported. |
| `agent_executions` | ✅ `job_id` / `queue_name` plumbing. `total_cost_usd` / `models_used` per BQ-1. Note: `models_used` is `{}` on all 1000 sampled rows, so excluding it loses nothing today. |
| `agent_configurations` | ✅ All 16. |
| `plugin_connections` | ✅ `access_token`, `refresh_token`, raw `profile_data`, `settings`, token lifecycle excluded. 🔄 C-1 adds the allow-listed profile fields. |
| `user_subscriptions` | ✅ `last_low_balance_alert_at`, `grace_period_days` excluded; acceptable. Stripe ids per BQ-2. |
| `credit_transactions` | ✅ All 18. |
| `audit_trail` | ✅ `OWNER_COLUMNS` reused (no new list, no `hash`, no `user_email`); `created_at` for filter and order; 90 days, `limit(10000)`, `.eq('user_id')` and both BD-26 exclusions unchanged character for character. |

Top-level export keys: unchanged ✅ (so the audit write's `data_categories` is unchanged too).

### Conditions

1. **C-1 (OP-3) Allow-listed provider profile.** In the route's per-connection mapping, add one key (e.g. `account_profile`) built from `profile_data` by an **allow-list of top-level keys whose value is a string or an array of strings**; everything else is dropped. The read selects `profile_data` but the raw column never reaches the body. Suggested list, from live key names: `name, given_name, family_name, email, mail, picture, avatar_url, locale, language, country, displayName, givenName, surname, jobTitle, mobilePhone, businessPhones, officeLocation, preferredLanguage, userPrincipalName, nickname, preferred_username`. No `id` / `sub` / `token*` / nested objects. Tests: a seed containing `token`, `signed_access_token`, a nested object and an unknown key exports only the allow-listed strings; the deny-list test asserts the raw `profile_data` key never appears in the body. Small (one pure helper plus two tests); if it pushes the estimate past ~1 day, Dev says so before building instead of dropping it.
2. **C-2 Characterization re-pin is deliberate and marked.** Each changed expectation (R1 to R8 selects, R8 `created_at`, plugin mapping, 500 body) carries a short comment naming this workplan; everything else in the pin stays byte-identical. At code review SA diffs the test file: an unmarked change is Fix Required.
3. **C-3 JSDoc records the limits.** The `credit_transactions` constant says `metadata` is exported whole and a writer adding a provider-cost key there would leak it (OP-6 / BQ-1). Each new constant says "changing this changes what the export holds: a privacy decision", matching the existing wording. The route header's "fails on every export until FU-1" paragraph is rewritten, not left stale.
4. **C-4 Live probe in §9 before handover.** All 8 lists (including `profile_data` in the plugin list) return 200 on a zero-row select. A 42703 on any list is a stop: it would empty that section silently, which is how FU-1 and NF-1 hid for months.

### BQ-1 / BQ-2 (the user's decisions; SA notes on constraints only)

- **BQ-1 (provider dollar cost per run):** no compliance constraint against option A. GDPR Art. 15 / 20 covers personal data about the person; our per-run provider cost is the controller's commercial figure, and Art. 15(4) / Recital 63 allow withholding trade secrets. The person still gets what determined their charge (credits, token counts, multiplier, intensity score) and which provider / model processed their data. Technical note: under A, the only residual leak path is a future cost key inside `credit_transactions.metadata` (C-3 records it). Under B, Dev adds two columns back; nothing else changes.
- **BQ-2 (Stripe reference ids):** no technical or security constraint against option A. The ids are not credentials (useless without our secret key). Compliance leans toward A: they are identifiers linked to the person, so they are arguably personal data in scope of Art. 15, and excluding them would also need a scrub inside `credit_transactions.metadata` (`stripe_session_id`, `stripe_invoice_id`, `stripe_subscription_id`, `stripe_payment_intent_id` live there today). Option B is the one that needs justifying.

### OP-7 recording (Business OS data not in the export)

Recommend TL routes it to BA as its own requirement, not this PR:
- Add a follow-up row **FU-P3 "Business OS data is not in the GDPR export"** to `DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md`'s follow-up list (Dev may add the row in this PR's doc edits, text only, no scope).
- BA requirement must settle, in business terms: which Business OS data is the owner's own personal data (their account, plan, credit charges / lots, invoices they paid us) versus data the owner holds about **their** clients (CRM contacts, bookings, intake answers), where we are the processor and the request belongs to the owner, not to us; size and pagination limits; and whether it is the same download or a second one.
- Until then, a Business OS owner's access request is answered by hand; worth stating in the requirement so nobody assumes the button covers it.

### Approval
[x] Workplan approved — proceed to implementation, with C-1 to C-4 checked at code review. BQ-1 / BQ-2 do not block: build the recommendations, flip a list per answer.

## SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04**
**Status:** ✅ Code Approved (no blocking findings; CR-1 to CR-4 all Low)

`git diff --stat` / `--numstat` checked first: 15 files, 589 insertions / 100 deletions, no deletion-only file; this workplan untracked as expected.

### Conditions and focus items

| Item | Verdict |
|---|---|
| No credential reaches the body | ✅ The plugin read never names `access_token`, `refresh_token`, `settings`, `expires_at`, `last_refreshed_at`. `profile_data` is read but the mapping outputs only `accountProfile(...)`; no other code path (logs carry counts and `{ err }` only) touches it |
| C-1 allow-list, fail-closed | ✅ `accountProfile` iterates the 21 allow-listed keys (exactly the SA list), own properties only (no prototype keys), keeps a value only if it is a string or an array of all strings; non-object / null / array input gives `{}`. Tests cover `token`, `signed_access_token`, `id`, `sub`, a nested object on an unknown key (`address`) and on an allow-listed key (`locale`), a mixed array, an unknown key, `null` / string / array input, and assert the text `profile_data` and every non-allowed value are absent from the body |
| FU-1 audit read | ✅ `.gte` / `.order` on `created_at`; select `OWNER_COLUMNS`; `.eq('user_id', userId)`, both BD-26 `.not(...)` lines and `.limit(10000)` unchanged character for character; guard test green |
| Column lists vs workplan and live schema (C-4) | ✅ Counts re-derived from source: 18 / 52 / 24 / 16 / 13 / 45 / 18 / 15, no duplicates, exclusions exactly §4 (BQ-1 A, BQ-2 A as decided). Live: §9.2 pasted with two 42703 negative controls. See CR-3 |
| Top-level export keys | ✅ Unchanged; only the per-connection object changed (OP-2), so `data_categories` in the audit write is unchanged (pinned) |
| C-2 characterization re-pin | ✅ Diffed the test file: every changed expectation (header note, `SELECTS`, each chain's select, the audit `created_at` pair, plugin seed, `MAPPED_CONNECTIONS`, 500 test title and body) carries a comment naming this workplan. No unmarked change; auth, read order, client, headers, empty-section / all-fail bodies, audit write and log lines untouched |
| FU-P2 500 body | ✅ `{ success: false, error: 'Data export failed', details: dev only }`; `catch (error: unknown)` with `instanceof Error` narrowing; Pino `{ err }` line unchanged. Production and development both tested |
| C-3 JSDoc | ✅ Every constant carries "Changing this changes what the export holds: a privacy decision"; `CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS` records that `metadata` is exported whole and the provider-cost leak path (OP-6 / BQ-1); route header FU-1 paragraph rewritten |
| Repositories read-only, user-scoped | ✅ Only `.select` arguments and casts change; every read keeps `.eq('user_id', userId)` (profiles `.eq('id', userId)`); no write added |
| Tests in CI | ✅ All three files are under `test:bos-entitlements`, which `.github/workflows/bos-entitlements.yml` runs |
| Standards | ✅ 0 `console.*` in touched files; no backslash-hex escape in any changed file |

### Dev deviations (§9.4)

1. `profile_data` not in the repository deny-list: **accepted**; it is read on purpose, and the body-level test is the right place for that assertion.
2. `as unknown as` casts: **accepted**; type-only, forced by the concatenated column string (`GenericStringError`), matches the existing `OWNER_COLUMNS` usage.
3. 11d row keeps its history: **accepted**; matches the 11c row's form; 8b / 11c rows untouched.
4. Extra Change History rows and the FU-P3 table: **accepted**; living-doc standard, and the FU-P3 text matches the SA OP-7 recording.

### Code Review Comments
1. `route.ts` `accountProfile` — an allow-listed key's string value passes through as is; if a provider ever stored a credential under an allow-listed name (for example a signed `picture` URL), it would be exported. Live key names reviewed at workplan time show no such case; accepted, no action. — Priority: Low
2. `route.test.ts` — no case for a bare number / boolean on an allow-listed key (for example `name: 5`). The code drops it (string or string array only) and the mixed-array / nested-object cases exercise the same branch; optional extra assertion. — Priority: Low
3. C-4 — SA did not re-run the live zero-row probe at code review (a read of the live project was refused by the session's permission classifier). Relied on Dev's §9.2 (8 / 8 = 200 with two 42703 controls, lists extracted from source) plus SA's own workplan-time OpenAPI check of the same 8 tables; the counts re-derived from source above match. If an independent re-probe is wanted, the user runs it. — Priority: Low
4. `BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` — Git warns LF will become CRLF; numstat is 2 / 1, so no whole-file churn today. RM: confirm the committed diff stays 2 / 1. — Priority: Low (info)

### Optimisation Suggestions
- None blocking. `exportData: any` stays the open typing follow-up (OP-5).

### QA-style re-run (SA, 2026-10-04)

| Run | Result |
|---|---|
| `route.characterization.test.ts`, `route.test.ts`, `userDataExportReads.test.ts`, `ownerAuditReads.guard.test.ts` | 4 suites, **84 / 84** (27 + 14 + 29 + 14) |
| `npm run test:bos-entitlements` | **180 suites, 4,605 tests, green** (62.5 s) |

Separate QA: **not needed** (proportionate effort: a read-only export change, fully covered by CI-run suites, re-run green by SA). QA folded into this pass.

### Code Approved for QA: Yes (QA folded in; ready for the user's diff view)

## QA Testing Report

*(QA populates.)*

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Workplan written (Dev) | FU-1, FU-P1, FU-P2 and item 18 planned; live schema verified for all 8 tables; new finding NF-1 (`plugin_connections.metadata` does not exist, so plugin connections were never exported); BQ-1 / BQ-2 raised |
| 2026-10-04 | SA workplan review | Approved with conditions C-1 to C-4; OP-1 constants, OP-2 approved, OP-3 raw `profile_data` out but an allow-listed profile subset in (C-1), OP-4 leave, OP-5 accept, OP-6 accept + JSDoc, OP-7 to BA as FU-P3, OP-8 confirmed; no compliance constraint on BQ-1 A or BQ-2 A |
| 2026-10-04 | User decisions BQ-1 / BQ-2 (via TL) | BQ-1 = A (provider cost out), BQ-2 = A (Stripe ids in), recorded in §5 |
| 2026-10-04 | Implemented (Dev) | FU-1, FU-P1 (8 column constants), NF-1 + C-1 `account_profile` allow-list, FU-P2; C-2 re-pin marked; C-3 JSDoc; C-4 live probe 8 / 8 = 200 with two 42703 controls (§9.2); `test:bos-entitlements` 180 suites / 4,605 tests green; doc edits (requirement 11d + §19, BD-26 §10, refactor follow-ups + FU-P3). Status Code Complete, uncommitted |
| 2026-10-04 | SA code review | Code Approved, no blocking findings (CR-1 to CR-4, all Low). C-1 to C-4 met; §9.4 deviations 1–4 accepted. QA-style re-run folded in: 4 export suites 84 / 84, `test:bos-entitlements` 180 suites / 4,605 tests green; separate QA not needed |
