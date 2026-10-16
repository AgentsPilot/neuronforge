# Workplan: Business OS data export, DE-3: profile details

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md): §0.2 DX-1a, §0.3.1, §0.3.6, §0.3.7 (DE-3 row), §0.4 / §0.4.1, §0.5, §0.6, §0.7
**Branch:** `feature/data-export-de3` (worktree `neuronforge-de3`, from origin/main `80a142ca`, which holds DE-1 #393, DE-2 #402 and DE-4 #419)
**Date:** 2026-10-16
**Status:** SA code-approved + QA PASS 2026-10-16; committed by RM

## Overview

DE-3 adds the **profile details** of DX-1a to "Download my data": the person's preferences, notification choices, the business profile and the business's saved addresses. These are the four tables DE-2 left `planned('DE-3')` in `lib/business-os/purge/descriptors.ts`. It also makes the three `profiles` decisions DE-1 left open (`hourly_rate_usd`, `role`, `org_id`, §0.5). Everything reuses the DE-4 pattern: one descriptor per table with explicit `columns` and a reason for every column left out, one section per table, all reads through the descriptor-driven `BusinessDataExportRepository` keyed on the session user id, paged to the end and bounded by the Phase 1 row ceiling. No migration, no new route, no new dependency, no flag, no new pattern.

Out, by binding decisions: credits, billing, the plan and anything paid to us (DX-1a); which modules are switched on (DE-2 BC-1); the organisation record (DE-2 BC-2); connected apps (DE4-U2); agents and agent settings (BQ-SA-1); assistant chats and assistant output (DX-1d, DE-4 BC-7).

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. The four tables, and the profiles decisions](#3-the-four-tables-and-the-profiles-decisions)
- [4. JSON columns](#4-json-columns)
- [5. Files to Create / Modify](#5-files-to-create--modify)
- [6. Task List](#6-task-list)
- [7. Tests](#7-tests)
- [8. CI placement and runtime](#8-ci-placement-and-runtime)
- [9. Risks](#9-risks)
- [10. Live schema verification (SQL for TL)](#10-live-schema-verification-sql-for-tl)
- [11. Open questions for SA](#11-open-questions-for-sa)
- [12. Business calls (for the user, via TL)](#12-business-calls-for-the-user-via-tl)
- [SA Review Notes](#sa-review-notes)
- [Dev Implementation Notes](#dev-implementation-notes-2026-10-16)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What DE-3 touches

| Area | Today (origin/main `80a142ca`) | After DE-3 |
|---|---|---|
| Descriptors | `business_profiles`, `business_addresses`, `user_preferences`, `notification_settings` are `planned('DE-3')` (`descriptors.ts` lines 443, 447, 584, 808) | 4 × `include` with `columns` + `excludedColumns` (§3). `level`, `order`, `scope`, `snapshot`, `area` and notes unchanged on all four |
| `profiles` | 17 columns incl. `role`, `hourly_rate_usd`, `org_id`; `plan` excluded | `role` stays in; `org_id` and, by default, `hourly_rate_usd` move to `excludedColumns` with reasons (§3.1). 15 columns |
| Section ids | 10 (`classificationTypes.ts`) | + `preferences`, `notification_settings`, `business_profile`, `business_addresses` |
| Groups | `account` (controller AgentPilot), `client_records` (processor) | unchanged. The four new sections join `account` (§2.3) |
| Reads | `profiles` via `UserProfileRepository.findForUserDataExport`; 8 tables via `BusinessDataExportRepository.listOwnedRowsForExport` | + 4 sections through the same repository method. No new repository |
| Route | `GET /api/user/data-export` runs `EXPORT_SECTIONS` | **unchanged code.** The new sections ride the registry; the audit counts are generic |
| DB | — | **none** |

### 1.2 Facts measured in code

| # | Fact | Where | Consequence |
|---|---|---|---|
| F-1 | All four tables are `scope: { kind: 'user_id' }`. None is a `via` table | `descriptors.ts` | The repository's E-2 bound holds; every read is `.eq('user_id', <session id>)` first |
| F-2 | `user_preferences`, `notification_settings` (and `profiles`, `security_settings`) have **no DDL in this repo**: created in the dashboard, rows made by the `create_user_settings` trigger on `auth.users` | `20261003_codify_create_user_settings_trigger.sql`, `UserPreferencesRepository.ts` header | Their columns are unknown from code. `types/settings.ts` lists a shape that predates the timezone work and is not trusted. Every column is ❓ until §10 |
| F-3 | Both are written with `upsert(…, { onConflict: 'user_id' })`, so `user_id` is unique; whether an `id` column exists is **unknown** | `UserPreferencesRepository.ts`, `app/(protected)/settings/page.tsx:207` | The repository pages by `id` and fails closed without it (`invalid_column`). If §10 Q3 shows no `id`, SA-Q1 decides the read (§2.2) |
| F-4 | `business_profiles` has `id uuid PK` and `user_id UNIQUE NOT NULL`; `business_addresses` has `id uuid PK`, `user_id NOT NULL` | `20260721_create_business_profiles.sql`, `20261036_business_addresses_book.sql` | Both fit the repository as it is |
| F-5 | The physical catalog (live, 2026-09-10) shows 68 `business_profiles` columns. Migrations after it add 17 (`lead_alert_email_enabled`, `lead_autosend_enabled`, `chase_invoices_enabled`, `chase_intake_enabled`, `automations_declined`, `invoice_payment_terms_days`, `meeting_reminder_enabled`, `meeting_reminder_hours_before`, `meeting_reminder_notify_client`, `meeting_reminder_notify_owner`, `currency`, `address_parts`, `auto_complete_meetings_enabled`, `address_id`, `invoice_address_id`, `chase_quotes_enabled`, plus `subdomain`) | `lib/business-os/catalog/catalog.generated.ts`, migration bodies | Expected live count **85**. ⚠️ `subdomain` (20260904) is absent from the 2026-09-10 catalog, and the schema-check skill records 20260904 as once unapplied. §10 decides; a declared column that is not live would fail the whole select (42703) and the section would be `failed` |
| F-6 | `profiles.role` is the onboarding **persona** (`business_owner`, `manager`, `consultant`, …), not a privilege. Nothing authorizes on it; a privilege claim is dropped by the `20261002` guard; admin identity is `admin_users` | `20261002_profiles_role_privilege_guard.sql` header | It is the person's own answer: in (§3.1) |
| F-7 | `profiles.hourly_rate_usd` is the agent-platform ROI rate (value of time saved by agent runs): read by `OrganizationSettingsService.getHourlyRate`, `WorkflowPilot`, `BusinessInsightGenerator`; shown on agent run cards | those files | Not Business OS data (BQ-SA-1). Default out, business call BC-A (§12) |
| F-8 | `profiles.org_id` points at `organizations`, which DE-2 BC-2 excluded | `descriptors.ts` | Out (§3.1) |
| F-9 | `business_profiles` mixes owner-entered details, settings, assistant output (`website_analysis`, `extracted_data`), the onboarding chat (`onboarding_conversation`), connected-app names (`connected_plugins`), calendar sync plumbing and setup-progress state | migration bodies | Column by column in §3.3 |
| F-10 | `user_preferences.timezone` is the clock authority; `profiles.timezone` is a mirror (`UserProfileRepository.updateTimezoneMirror`) | CLAUDE.md § Currency & Timezone | Both are exported as held. DE-8b's README says which is the authority (SA-Q8) |
| F-11 | No file DE-3 touches uses `console.*` (0 in each of `descriptors.ts`, `data-export/*.ts`, `BusinessDataExportRepository.ts`, `UserProfileRepository.ts`, the route) | grep | Nothing to flag |
| F-12 | Tests that name DE-3 tables as "still planned" | `exportClassification.test.ts` lines 208–215 and 371–372 | Re-planted on a DE-5 table (`proposals`) when these go `include` (T-8) |

### 1.3 Live schema status

I had no read-only DB tool in this session and the worktree has no DB env. Every column below is ❓ until TL runs §10. For `user_preferences` and `notification_settings` the lists are **proposals by category**: the final lists are written from §10 Q1, each new column with a reason, and SA approves them at code review (as DE-4 did). `npm run schema:reconcile` cannot run in the worktree; T-9 is the same comparison as read-only SQL (DE-4 precedent, §0.7 T-9).

---

## 2. Implementation Approach

### 2.1 Reuse, not new

- **Descriptors:** four new `const …_EXPORT: TableExportClassification` blocks next to `PROFILES_EXPORT`, with column-reason constants added to `EXPORT_COLUMN_REASON` (`CALENDAR_SYNC` and `OWNER_ID` already exist and are reused).
- **Sections:** the four sections are created by the same factory as DE-4's. `clientRecordsSection(id, mapRow?)` is generalised to `ownedRowsSection(id, group, gdprRole, mapRow?)` with `clientRecordsSection` kept as a one-line wrapper, so the DE-4 lines do not change. No new reader code path.
- **Repository:** `BusinessDataExportRepository.listOwnedRowsForExport` unchanged (unless SA-Q1 rules otherwise). Its header comment widens from "every `client_records` section" to "every descriptor-driven section" (comment only).
- **Ceiling:** the four sections draw on the same `maxRows` budget. They are 1 row each, plus the address book (small).

### 2.2 The two 1:1 settings tables

`user_preferences` and `notification_settings` hold one row per user. If §10 Q3 shows an `id` column, they go through the repository unchanged and `id` is in `columns` (a surrogate key, harmless, needed for paging). **If not**, the repository fails them closed today (`keyset paging needs the id column`), so a choice is needed (SA-Q1):

- **(a) Dev recommendation:** an optional `rowKey: 'user_id'` on the `include` classification for tables whose `user_id` is unique live (proved by §10 Q3). The repository then issues one `.select(columns).eq('user_id', userId).limit(2)`, and **more than one row fails the section closed** (it is not paged because it cannot page past one row). `user_id` stays out of `columns` (OWNER_ID). `tableExportProblems` checks `rowKey` is `'user_id'` only, and a unit test pins that a table with `rowKey` and two rows for the user is `failed`.
- **(b)** a `findForUserDataExport` on `UserPreferencesRepository` and on a new notification-settings method, as `profiles` has. Two more methods, two more tests, and `notification_settings` has no repository today (its route reads it directly), so it would need one.

### 2.3 Sections, order and group

| Section id | Table | Group | GDPR role | Position |
|---|---|---|---|---|
| `preferences` | `user_preferences` | `account` | controller | after `user_profile` |
| `notification_settings` | `notification_settings` | `account` | controller | next |
| `business_profile` | `business_profiles` | `account` | controller | next |
| `business_addresses` | `business_addresses` | `account` | controller | next, then the DE-4 `client_records` sections unchanged |

Plain words, because DE-8b names each CSV after its section. **GDPR role:** these are the account holder's own details given to us to run their account: AgentPilot is the controller (§0.4.1 E "Your account"), the same as `profiles`. The business profile includes details the business shows its clients (address, invoice details), but they are about the business itself, not records it keeps about its clients, so they are not `client_records` (SA-Q2). `payload.ts` needs no change; the `account` description ("Your own account details. AgentPilot is the controller of this data.") covers them. `format_version` stays 2 (additive).

### 2.4 Tenant isolation (tenant-isolation-guard)

Read-only and service role, so RLS does not protect these reads (repository E-5). The rules are DE-4's, unchanged:

- The only id is `ctx.userId = getUser().id`. The route takes no input; the existing route test already proves a planted `?userId=` and `x-user-id` are ignored, and DE-3 extends its assertion to the four new tables.
- First filter on every query: `.eq('user_id', ctx.userId)`. No find-by-id, no caller-supplied entity id.
- `business_profiles.address_id` / `invoice_address_id` are exported as ids only. The addresses themselves are read **by their own `user_id`**, never through those pointers, so a mismatched pointer could only ever carry a foreign uuid, never a foreign address. §10 Q7 measures whether any pointer crosses tenants (the `business_addresses_business_fk` ownership FK should make it 0).
- No write, trigger or upsert, so the skill's "scope-defeating three" do not arise.

### 2.5 Deny list

The proposed lists in §3 match no entry of `SECRET_COLUMN_DENY_EXACT` and no `SECRET_COLUMN_DENY_PATTERNS` pattern (`/_token$/`, `/_secret$/`, `/_key$/`, `/_credentials$/`, `/_hash$/`, `/cost_usd$/`). **No new `DENY_EXCEPTIONS` entry is proposed.** Two watch points for §10 Q1:

- Any `user_preferences` / `notification_settings` column matching a pattern (for example a web-push `push_token` or `*_key`) is **excluded** with `EXPORT_REASON.SECRET`, never excepted.
- A web-push subscription stored as jsonb (`endpoint` + `keys.p256dh` / `keys.auth`) would **not** match the name patterns. If §10 Q1 / Q4 shows one, it is excluded as a secret by reason, and SA-Q6 asks whether the deny list should gain a value-shape rule.

The bank details on the invoice profile (`invoice_bank_account`, `invoice_bank_routing`) do not match the deny list. They are the owner's own details, printed on every invoice they send. Default in, business call BC-B.

### 2.6 Logging and audit

Unchanged: the repository's existing lines (section, table, user id, pages, rows; never content). `DATA_EXPORTED` gains four more section counts through the existing generic `sectionCounts` (counts only).

---

## 3. The four tables, and the profiles decisions

❓ = to be confirmed by §10. "In" = in `columns`, in this order. "Out" = in `excludedColumns` with the reason shown.

### 3.1 `profiles` → `user_profile` (decisions DE-1 left open)

| Column | Decision | Reason |
|---|---|---|
| `role` | **In** | The persona the person picked in onboarding (business owner, manager, …). Their own answer. Not a privilege: nothing authorizes on it (20261002) |
| `org_id` | **Out** | "DE-2 BC-2 (user 2026-10-15): the agent-platform organisation record is not exported; its id alone points at nothing in the file" |
| `hourly_rate_usd` | **Out (default, BC-A)** | "agent-platform ROI rate used to value agent runs, not Business OS data (BQ-SA-1, user 2026-10-14)" |

Result: 15 columns, in this order: `id, full_name, avatar_url, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data`. `excludedColumns`: `plan`, `org_id`, `hourly_rate_usd`. Live count 18 (DE-2 C-3), so all 18 are still accounted for. `domain` and the `onboarding*` columns were kept by DE-1 and are not reopened (SA-Q7).

### 3.2 `user_preferences` → `preferences` (proposal by category; ❓ all)

| Category | Proposed | Columns expected (from code; final from §10 Q1) |
|---|---|---|
| Surrogate key | In, if it exists | `id` |
| The clock, language and money defaults the person chose | **In** | `preferred_language`, `timezone`, `timezone_confirmed_at`, any currency preference column |
| Display and privacy choices | **In** | e.g. `theme`, `sidebar_collapsed`, `compact_mode`, `show_timestamps`, `enable_sounds`, `keyboard_shortcuts`, `data_retention_days`, `analytics_enabled`, `telemetry_enabled`, `auto_save_conversations` |
| Agent-platform AI tuning | **Out (default, BC-A)**, reason `AGENT_SETTING`: "agent-platform setting, not Business OS data (BQ-SA-1, user 2026-10-14)" | e.g. `default_model`, `max_tokens`, `temperature`, `debug_mode`, `beta_features` |
| Owner id | Out, `OWNER_ID` | `user_id` |
| Timestamps | In | `created_at`, `updated_at` |
| Anything matching the deny list | Out, `SECRET` | — |

### 3.3 `notification_settings` → `notification_settings` (proposal by category; ❓ all)

§0.3.1 names this table **in**. Every column is a choice about how we contact the person, including the agent-update toggles (they are contact choices, not agent data). Proposed: **all choice columns in** (expected from code: `email_enabled`, `email_frequency`, `email_agent_updates`, `email_system_alerts`, `email_security_alerts`, `email_marketing`, `push_*`, `desktop_*`, `inapp_*`, `quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end`), `id` if it exists, `created_at` / `updated_at`; `user_id` out (`OWNER_ID`); any token, key or push-subscription column out (`SECRET`, §2.5).

### 3.4 `business_profiles` → `business_profile` (85 expected ❓)

New column-reason constants: `ASSISTANT_OUTPUT` ("assistant output, not something the owner entered (DX-1d; as DE-4 BC-7)"), `ONBOARDING_CHAT` (`EXPORT_REASON.ACTIVITY`), `CONNECTED_APPS` ("connected apps are not exported (user DE4-U2, 2026-10-15)"), `SETUP_STATE` ("setup progress state the product keeps, not data the owner entered"), reused `CALENDAR_SYNC`, `OWNER_ID`.

**In (72):**

| Group | Columns |
|---|---|
| Identity of the row | `id` |
| What the business is | `vertical`, `sub_vertical`, `company_name`, `company_size`, `clients_per_week`, `revenue_tier`, `description`, `services`, `pain_points`, `goals`, `tools`, `payment_mode`, `online_presence_mode`, `primary_crm`, `primary_calendar`, `primary_payment` |
| Contact details and address | `phone`, `email`, `address`, `address_parts`, `address_id`, `invoice_address_id` |
| Public presence | `website_url`, `landing_pages`, `logo_url`, `show_logo_on_smart_links`, `theme`, `template_id`, `subdomain` ❓ (F-5), `user_code` |
| Working hours and how they work | `scheduling_availability`, `process_steps`, `language`, `currency` |
| Invoice profile | `invoice_company_name`, `invoice_address`, `invoice_tax_id`, `invoice_bank_name` (BC-B), `invoice_bank_account` (BC-B), `invoice_bank_routing` (BC-B), `invoice_payment_instructions`, `invoice_footer_text`, `invoice_number_prefix`, `invoice_document_type`, `invoice_prices_include_tax`, `invoice_tax_rate`, `invoice_tax_label`, `invoice_payment_terms_days` |
| Collecting from their clients (the owner's settings, not payments to us) | `collection_method`, `default_payment_processor`, `payment_retry_enabled`, `payment_retry_intervals`, `payment_max_retries`, `payment_reminder_enabled`, `payment_reminder_days_before`, `payment_overdue_reminder_days`, `payment_reminder_channels` |
| Automations and emails the owner switched on or declined | `daily_briefing_email_enabled`, `lead_alert_email_enabled`, `lead_autosend_enabled`, `chase_invoices_enabled`, `chase_intake_enabled`, `chase_quotes_enabled`, `automations_declined`, `meeting_reminder_enabled`, `meeting_reminder_hours_before`, `meeting_reminder_notify_client`, `meeting_reminder_notify_owner`, `auto_complete_meetings_enabled` |
| Timestamps | `created_at`, `updated_at` |

**Out (13):**

| Column | Reason |
|---|---|
| `user_id` | `OWNER_ID` |
| `website_analysis` | `ASSISTANT_OUTPUT`: scraped website data and the assistant's analysis of it |
| `extracted_data` | `ASSISTANT_OUTPUT`: what the assistant extracted from the onboarding bio (the owner's own answers are in their own columns) |
| `onboarding_conversation` | `EXPORT_REASON.ACTIVITY`: the onboarding chat (DX-1d, as `onboarding_conversations`) |
| `connected_plugins` | `CONNECTED_APPS` |
| `calendar_sync_enabled`, `calendar_sync_provider`, `calendar_last_synced_at` | `CALENDAR_SYNC` (consistent with bookings and DE-4 BC-5) |
| `onboarding_completed`, `profile_completeness`, `setup_checklist_dismissed`, `dismissed_setup_steps` | `SETUP_STATE` (as DE-2 BC-1 "module setup") |
| `needs_stripe_connect` | `SETUP_STATE`: derived from the onboarding answers |
| (spare rows for §10) | Any live column not listed here: proposed with a reason at code review |

72 + 13 = 85 = the expected live count. If `subdomain` is not live it is dropped from `columns` (then 71 + 13 = 84).

### 3.5 `business_addresses` → `business_addresses` (7 expected ❓)

In: `id`, `label`, `parts`, `is_default`, `created_at`, `updated_at`. Out: `user_id` (`OWNER_ID`). Not a soft-delete table (a removed address is deleted), so no `rowFilter`.

---

## 4. JSON columns

**Approach (DE-4 precedent):** owner-authored structured settings travel whole (as `custom_fields`, `availability`, `intake_responses` did). A key allow-list is used only where a column mixes in data the owner did not enter or that is sensitive (as `source_metadata`, BC-4). §10 Q4 lists every key actually present; SA decides from it (SA-Q5).

| Column | Proposed | Why / what Q4 must show |
|---|---|---|
| `business_profiles.scheduling_availability` | Whole | Weekly hours the owner set. Expect day keys and time ranges only |
| `business_profiles.process_steps` | Whole | The owner's own steps (an array of objects) |
| `business_profiles.theme` | Whole | The website look the owner chose. Expect colour / font keys only |
| `business_profiles.address_parts`, `invoice_address`, `business_addresses.parts` | Whole | `{line1, line2, city, state, postal_code, country}` by design. Any other key → reported to SA |
| `profiles.onboarding_data` (kept by DE-1) | Whole, observation only | Q4 lists its keys so SA can see what it holds; DE-3 does not change it unless SA asks |
| `website_analysis`, `extracted_data`, `onboarding_conversation` | Out (whole column) | No key census needed for content; Q4 does not read them |
| Any jsonb on `user_preferences` / `notification_settings` (Q1 shows) | Decided after Q4b | A push subscription (`endpoint`, `keys`) → out as a secret |

---

## 5. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | `PROFILES_EXPORT` (§3.1); 4 new `include` consts; new column-reason constants; the four `planned('DE-3')` replaced. Nothing else on those rows |
| `lib/business-os/data-export/classificationTypes.ts` | modify | 4 section ids; `rowKey?: 'user_id'` on `include` only if SA-Q1 (a) |
| `lib/business-os/data-export/classification.ts` | modify only if SA-Q1 (a) | `tableExportProblems` checks `rowKey` |
| `lib/business-os/data-export/sections.ts` | modify | `ownedRowsSection` factory (§2.1); 4 registry entries; header comment |
| `lib/repositories/BusinessDataExportRepository.ts` | modify | Header comment (all descriptor-driven sections); the single-row read only if SA-Q1 (a) |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | DE-3 block + re-plants (§7) |
| `lib/business-os/data-export/__tests__/sections.test.ts` | modify | Registry order, group and role of the four |
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | modify | New sections resolve; cross-tenant; single-row (if (a)) |
| `lib/repositories/__tests__/userDataExportReads.test.ts` | modify | The `profiles` select re-pinned (15 columns); `org_id` / `hourly_rate_usd` now absent |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin: 13 section tables in order, the 4 new select strings byte for byte, body, audit counts |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Line ~367 seeds `hourly_rate_usd: 50` and expects it in the file: now expects it absent |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | New §0.8 "DE-3 status" (decisions, as built, SA rulings), per the always-update-main-requirement rule |
| `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md` | this file | Audit trail |

Not touched: the route, `payload.ts`, `limits.ts`, `accountDeletionPolicy.ts`, any purge file other than `descriptors.ts`, any migration.

---

## 6. Task List

- ✅ T-0 TL runs §10 Q1–Q8 on prod (read-only) and pastes the results here. **Gate:** no descriptor is written before Q1 and Q3
- ✅ T-1 SA workplan review: SA-Q1…SA-Q9; TL takes §12 to the user
- ✅ T-2 Finalise §3.2 / §3.3 / §3.4 from Q1 (every live column in `columns` or `excludedColumns`, nothing else), and §4 from Q4
- ✅ T-3 `descriptors.ts`: `PROFILES_EXPORT` per §3.1 and BC-A; the four `include` consts; reason constants
- ✅ T-4 `classificationTypes.ts`: the four section ids (`rowKey` dropped: SA-Q1 moot, C-4)
- ✅ T-5 `sections.ts`: `ownedRowsSection` factory, `clientRecordsSection` as a wrapper, the four registry entries after `user_profile`
- ✅ T-6 Repository: header comment only (single-row read dropped, C-4)
- ✅ T-7 Tests per §7, including every negative control, and confirm each fails when its rule is removed (mutation check, §7 last row)
- ✅ T-8 Re-plant the "still planned" negative controls on `proposals` (DE-5)
- ✅ T-9 Drift check: TL runs §10 Q8 with the final lists filled in. Expect drift 0, missing 0. Record the SHA (Dev: SQL filled in, 157 names, in the Dev notes; TL to run). Done 2026-10-16: 0 drift / 0 missing over 157 names, all ids uuid (§10.2)
- ✅ T-10 Run `npm test -- lib/business-os/data-export lib/repositories/__tests__/BusinessDataExportRepository.test.ts lib/repositories/__tests__/userDataExportReads.test.ts app/api/user/data-export lib/business-os/purge` and record runtimes (§8)
- ✅ T-11 Requirement §0.8 and this workplan's Dev notes; changes left **uncommitted** for SA code review, QA and the user's diff (RM commits)

---

## 7. Tests

All Jest, in existing files, in the existing required Jest job.

| # | Test | File | Negative control |
|---|---|---|---|
| X-1 | No `planned('DE-3')` row left; the four tables are `include` with the section ids of §2.3 | `exportClassification.test.ts` | Re-plan `business_addresses` → reported |
| X-2 | `profiles`: `role` in `columns`; `org_id`, `hourly_rate_usd`, `plan` in `excludedColumns` with non-empty reasons; 15 columns | same | Move `org_id` back into `columns` → the pin fails |
| X-3 | `business_profiles`: `website_analysis`, `extracted_data`, `onboarding_conversation`, `connected_plugins` and the three calendar-sync columns are in `excludedColumns` and **not** in `columns` (named one by one) | same | Plant `onboarding_conversation` into `columns` → fails; reword the `connected_plugins` reason to empty → `excluded column … has no reason` |
| X-4 | Every proposed column passes the deny list; `DENY_EXCEPTIONS` unchanged (1 entry) | same | Plant `push_token` into `notification_settings` columns → `denied_column` at request time and `… is on the secret deny list` in CI |
| X-5 | Section registry ↔ descriptors agree (existing T-rule) for the 4 new ids | same | Drop the `business_profile` registry entry → reported |
| X-6 | Registry order: `account_identity, user_profile, preferences, notification_settings, business_profile, business_addresses`, then the 8 DE-4 sections unchanged; the 4 new ones are `account` / `controller` | `sections.test.ts` | — |
| X-7 | Each new section reads through `listOwnedRowsForExport` with the session id and its own section id | `BusinessDataExportRepository.test.ts` | — |
| X-8 | **Cross-tenant:** the fake holds rows of user A and user B in all four tables (incl. a B address that A's `address_id` points at); the export for A contains only A's rows, and the B address is absent even though A's profile names its id | same | Remove the `.eq('user_id')` in the fake's filter path → B's rows appear, test red |
| X-9 | Select strings for the four tables equal `exportColumnsOf(table).join(', ')`, pinned literally | `route.characterization.test.ts` | — |
| X-10 | If SA-Q1 (a): a `rowKey: 'user_id'` table with 2 rows for the user is `failed`, 1 row is `ok`, 0 rows is `ok` and empty | `BusinessDataExportRepository.test.ts` | `rowKey: 'id'` → `tableExportProblems` reports it |
| X-11 | Route: 13 section tables read in order on the service-role client, then the timezone; body groups; audit `sectionCounts` has the four new ids (counts only, no row values) | `route.characterization.test.ts` (deliberate re-pin) | — |
| X-12 | Route: seeded `hourly_rate_usd: 50` and `org_id` are **not** in the file; `role` is | `route.test.ts`, `userDataExportReads.test.ts` | — |
| X-13 | Purge baseline: `descriptorsForRun` identical for all level × area combinations; `level/order/scope/snapshot/area/notes` unchanged on the four rows | existing purge invariant suites | — |
| X-14 | A planted `?userId=<B>` and `x-user-id: <B>` on the route change nothing in the four new sections | `route.test.ts` (extend the existing case) | — |
| Mutation check | Before hand-over, each of X-2, X-3, X-4, X-8 is shown red by reverting its rule once (recorded in the Dev notes) | — | — |

---

## 8. CI placement and runtime

No new job, no new script, no new file: the tests extend existing suites in the required Jest gate. Expected cost: a few dozen pure assertions, well under a second. `test:bos-entitlements` is not affected (no import from `lib/business-os/entitlements/`). T-10 records the local runtimes of the touched suites before and after; a material increase is reported to SA.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A declared column that is not live (e.g. `subdomain`, F-5) makes PostgREST reject the whole select: the section is `failed` | T-0 Q1 before writing; T-9 drift check; the failure is visible (`failed`), never silent |
| R-2 | `user_preferences` / `notification_settings` have no `id` | SA-Q1, decided before code |
| R-3 | A dashboard-only table holds a column we did not expect (a push token, an internal flag) | §3.2 / §3.3 are by category; every live column needs a reason at code review; deny list runs at request time |
| R-4 | Bank details in the file widen the impact of a leaked download | Only the signed-in owner downloads; `no-store`; logs and audit carry counts only; BC-B lets the user say no |
| R-5 | `profiles.role` may still hold an old privilege-shaped value ('admin') from before 20261002 | Exported as held; it grants nothing. Q6 counts the values so SA can see it |
| R-6 | Pinned tests that name `business_profiles` as planned break | T-8 re-plants them deliberately |
| R-7 | Two timezone columns (`profiles.timezone`, `user_preferences.timezone`) can disagree in the file | Exported as held; DE-8b README names `user_preferences.timezone` as the authority (SA-Q8) |
| R-8 | Over-reach into agent-platform columns already kept by DE-1 (`domain`, `onboarding*`) | Not reopened here; SA-Q7 |

---

## 10. Live schema verification (SQL for TL)

**Read-only. Run on PROD in the Supabase SQL editor.** Outputs table names, column names, types, constraint names, key names, counts and user ids only: no row content. The editor's word bug is avoided (no such word appears inside any string).

**File:** (pasted by TL; not committed)

```sql
-- Q1: every live column of the five tables (reconcile with §3)
SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, is_generated
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'user_preferences', 'notification_settings',
                     'business_profiles', 'business_addresses')
ORDER BY table_name, ordinal_position;

-- Q2: column count per table (expected: business_addresses 7, business_profiles 85, profiles 18;
--     user_preferences and notification_settings unknown)
SELECT table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'user_preferences', 'notification_settings',
                     'business_profiles', 'business_addresses')
GROUP BY table_name ORDER BY table_name;

-- Q3: primary keys, unique constraints and unique indexes (is there an id? is user_id unique?)
SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('user_preferences', 'notification_settings', 'business_profiles', 'business_addresses')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
ORDER BY 1, 2;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('user_preferences', 'notification_settings', 'business_profiles', 'business_addresses')
  AND indexdef ILIKE '%unique%'
ORDER BY 1, 2;

-- Q4: top-level keys present in the jsonb columns DE-3 exports whole (key names and counts only)
SELECT 'business_profiles.scheduling_availability' AS col, k AS key, count(*) AS rows_with_key
FROM public.business_profiles, LATERAL jsonb_object_keys(scheduling_availability) AS k
WHERE jsonb_typeof(scheduling_availability) = 'object' GROUP BY k
UNION ALL
SELECT 'business_profiles.theme', k, count(*)
FROM public.business_profiles, LATERAL jsonb_object_keys(theme) AS k
WHERE jsonb_typeof(theme) = 'object' GROUP BY k
UNION ALL
SELECT 'business_profiles.address_parts', k, count(*)
FROM public.business_profiles, LATERAL jsonb_object_keys(address_parts) AS k
WHERE jsonb_typeof(address_parts) = 'object' GROUP BY k
UNION ALL
SELECT 'business_profiles.invoice_address', k, count(*)
FROM public.business_profiles, LATERAL jsonb_object_keys(invoice_address) AS k
WHERE jsonb_typeof(invoice_address) = 'object' GROUP BY k
UNION ALL
SELECT 'business_profiles.process_steps[]', k, count(*)
FROM public.business_profiles, LATERAL jsonb_array_elements(process_steps) AS e, LATERAL jsonb_object_keys(e) AS k
WHERE jsonb_typeof(process_steps) = 'array' AND jsonb_typeof(e) = 'object' GROUP BY k
UNION ALL
SELECT 'business_addresses.parts', k, count(*)
FROM public.business_addresses, LATERAL jsonb_object_keys(parts) AS k
WHERE jsonb_typeof(parts) = 'object' GROUP BY k
UNION ALL
SELECT 'profiles.onboarding_data', k, count(*)
FROM public.profiles, LATERAL jsonb_object_keys(onboarding_data) AS k
WHERE jsonb_typeof(onboarding_data) = 'object' GROUP BY k
ORDER BY 1, 3 DESC;

-- Q4a: the shape of those columns (object / array / null / other), so Q4 misses nothing
SELECT 'scheduling_availability' AS col, jsonb_typeof(scheduling_availability) AS shape, count(*) FROM public.business_profiles GROUP BY 2
UNION ALL SELECT 'theme', jsonb_typeof(theme), count(*) FROM public.business_profiles GROUP BY 2
UNION ALL SELECT 'address_parts', jsonb_typeof(address_parts), count(*) FROM public.business_profiles GROUP BY 2
UNION ALL SELECT 'invoice_address', jsonb_typeof(invoice_address), count(*) FROM public.business_profiles GROUP BY 2
UNION ALL SELECT 'process_steps', jsonb_typeof(process_steps), count(*) FROM public.business_profiles GROUP BY 2
UNION ALL SELECT 'parts', jsonb_typeof(parts), count(*) FROM public.business_addresses GROUP BY 2
UNION ALL SELECT 'onboarding_data', jsonb_typeof(onboarding_data), count(*) FROM public.profiles GROUP BY 2
ORDER BY 1, 2;
-- (If profiles.onboarding_data is not jsonb in Q1, drop its lines from Q4 and Q4a.)

-- Q4b: ONLY IF Q1 shows a json/jsonb column on user_preferences or notification_settings.
--      Replace <table> and <col> and run once per column:
-- SELECT k AS key, count(*) FROM public.<table>, LATERAL jsonb_object_keys(<col>) AS k
-- WHERE jsonb_typeof(<col>) = 'object' GROUP BY k ORDER BY 2 DESC;

-- Q5: rows per owner. The 1:1 tables must show max 1; the address book the largest owner
SELECT 'user_preferences' AS t, max(n) AS max_rows_per_user, count(*) FILTER (WHERE n > 1) AS users_with_more_than_one
FROM (SELECT user_id, count(*) AS n FROM public.user_preferences GROUP BY user_id) s
UNION ALL
SELECT 'notification_settings', max(n), count(*) FILTER (WHERE n > 1)
FROM (SELECT user_id, count(*) AS n FROM public.notification_settings GROUP BY user_id) s
UNION ALL
SELECT 'business_profiles', max(n), count(*) FILTER (WHERE n > 1)
FROM (SELECT user_id, count(*) AS n FROM public.business_profiles GROUP BY user_id) s
UNION ALL
SELECT 'business_addresses', max(n), count(*) FILTER (WHERE n > 1)
FROM (SELECT user_id, count(*) AS n FROM public.business_addresses GROUP BY user_id) s;

SELECT user_id, count(*) AS addresses
FROM public.business_addresses GROUP BY user_id ORDER BY 2 DESC LIMIT 5;

-- Q5a: largest owners by approximate bytes across the four tables
WITH s AS (
  SELECT user_id, pg_column_size(x.*) AS b FROM public.user_preferences x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.notification_settings x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.business_profiles x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.business_addresses x
)
SELECT user_id, count(*) AS rows, pg_size_pretty(sum(b)) AS approx_bytes
FROM s GROUP BY user_id ORDER BY sum(b) DESC LIMIT 5;

-- Q6: the profiles decisions, as counts (no values except the persona labels)
SELECT count(*) FILTER (WHERE hourly_rate_usd IS NOT NULL) AS with_hourly_rate,
       count(*) FILTER (WHERE org_id IS NOT NULL) AS with_org_id,
       count(*) AS profiles
FROM public.profiles;
SELECT role, count(*) FROM public.profiles GROUP BY role ORDER BY 2 DESC;

-- Q7: a profile pointing at another tenant's address (expected 0: ownership FK)
SELECT count(*) AS cross_tenant_pointers
FROM public.business_profiles p
JOIN public.business_addresses a ON a.id = p.address_id OR a.id = p.invoice_address_id
WHERE a.user_id <> p.user_id;
```

**Q8 (T-9, after implementation): drift and missing, per table.** Dev fills in the final declared lists (`columns` ∪ `excludedColumns`) from the branch; TL runs it. Expect both result sets empty.

```sql
-- Q8a drift: live columns the descriptor does not account for
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'business_profiles'
  AND column_name NOT IN (/* Dev: the 85 declared names */)
-- repeat per table (user_preferences, notification_settings, business_addresses, profiles)
;
-- Q8b missing: declared names that are not live
SELECT d.name FROM unnest(ARRAY[/* Dev: the declared names */]::text[]) AS d(name)
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'business_profiles' AND c.column_name = d.name);
```

---

## 11. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **SA-Q1** | If `user_preferences` / `notification_settings` have no `id` (Q3): (a) an optional `rowKey: 'user_id'` single-row read in `BusinessDataExportRepository` (fails closed on more than one row), or (b) per-repository `findForUserDataExport` methods? | (a): one tested place stays one tested place; E-1…E-6 still hold. If both tables have `id`, the question falls away |
| **SA-Q2** | `business_profile` and `business_addresses` in the `account` group with AgentPilot as controller (not `client_records` / processor)? | Yes: details about the business itself, given to us to run the account |
| **SA-Q3** | `user_code` (the short code in the public smart-link address) and `subdomain` in? | In: they are the business's own public address |
| **SA-Q4** | `primary_crm`, `primary_calendar`, `primary_payment`, `tools` (onboarding answers naming tools) in, while `connected_plugins` (the app names we connected) is out under DE4-U2? | Yes: answers are what the owner said; connections are plumbing |
| **SA-Q5** | JSON columns whole (no allow-list) for `scheduling_availability`, `process_steps`, `theme`, `address_parts`, `invoice_address`, `parts`, subject to Q4 showing no foreign keys? | Yes, as DE-4 did for owner-authored jsonb |
| **SA-Q6** | Should the deny list gain a rule for a push subscription stored as jsonb (`endpoint` + `keys`), which the name patterns cannot see? Only relevant if Q1 / Q4b shows one | Exclude by reason in DE-3; the general rule is a follow-up if SA wants it |
| **SA-Q7** | `profiles.domain` and `onboarding*` are agent-platform onboarding data kept by DE-1. Fold them into BC-A, or leave as DE-1 decided? | Leave (out of DE-3's mandate); note for SA |
| **SA-Q8** | Two timezone columns in the file (`profiles.timezone` mirror, `user_preferences.timezone` authority): export both as held, README note in DE-8b? | Yes |
| **SA-Q9** | Setup-progress columns (`onboarding_completed`, `profile_completeness`, `setup_checklist_dismissed`, `dismissed_setup_steps`, `needs_stripe_connect`) out as "setup state", by analogy with DE-2 BC-1? | Yes; confirmation-only item for the user (§12 BC-D) |

---

## 12. Business calls (for the user, via TL)

Plain terms. Two are new choices; the rest confirm decisions you already made and need an answer only if you disagree.

**New choices**

| # | Question | Dev default | What changes |
|---|---|---|---|
| **BC-A** | Some settings on the account belong to the **agent platform**, not Business OS: the hourly rate used to show "money saved" on agent runs, and the AI model settings (which model, how creative). You decided "Business OS data only" for agents. Leave these settings out too? | **Leave out** | If "in": they appear in "Your account" in the download |
| **BC-B** | The **bank details printed on the owner's invoices** (bank name, account number, routing number). They are the owner's own details and already appear on every invoice they send, but they are sensitive if a download is lost. Include them? | **Include** | If "out": the invoice settings in the download lack the bank lines; nothing else changes |

**Confirmations of earlier decisions (answer only if you disagree)**

| # | What the download will do | Based on |
|---|---|---|
| BC-C | Include the owner's **answers** about the business (what it does, size, goals, services, which tools they use), but **not** the assistant's analysis of their website, what the assistant extracted from their bio, or the onboarding chat | "No activity / assistant chats" (DX-1) and "the assistant's suggestions on a service are out" (DE-4) |
| BC-D | Leave out **setup-progress markers** (onboarding finished yes/no, profile-completeness %, which setup tips were dismissed) | "Which modules are switched on: no" (DE-2) |
| BC-E | Leave out the **calendar-sync settings** on the business profile | "The synced copy of the outside calendar: out" (DE-4) |
| BC-F | Leave out the **list of connected apps** stored on the business profile | "Connected apps: dropped" (DE-4) |
| BC-G | Leave out the **organisation id** on the person's profile; keep their **role** (the persona they picked, e.g. "business owner") | "Organisation record: no" (DE-2) |

---

## SA Review Notes

_SA populates this section._

### SA workplan review DE-3 — 2026-10-16

**Reviewed by SA — 2026-10-16**
**Status:** ✅ Approved with conditions (C-1…C-9 below are binding on implementation; no re-review of the workplan needed, they are checked at code review)

Inputs: §0.2–§0.7 of the requirement (binding), §10.1 T-0 live results (TL, prod), user decisions 2026-10-16 (below), code read on `80a142ca` (`sections.ts`, `classification.ts` deny list, `profileReadiness.ts`, `invoicePaymentOptions.ts`, `user_preferences` / `notification_settings` readers).

#### User decisions 2026-10-16 (recorded; binding)

| # | Decision | Effect on the descriptors |
|---|---|---|
| BC-A | Agent-platform settings **out**. Reason text, verbatim: `"user 2026-10-16: agent-platform setting, Business OS data only"` (new constant `AGENT_SETTING`; replaces the §3.1 / §3.2 wording Dev proposed) | `profiles.hourly_rate_usd`; `user_preferences.default_model`, `max_tokens`, `temperature`, `auto_save_conversations`, and, by SA application of "any other agent/AI-only settings": `debug_mode`, `beta_features`; `notification_settings.email_agent_updates`, `push_agent_updates`, `desktop_agent_updates` (see R-3) |
| BC-B | Invoice bank details **out**. Reason text, verbatim: `"user 2026-10-16: bank details left out of the file"` (new constant `BANK_DETAILS`) | `business_profiles.invoice_bank_name`, `invoice_bank_account`, `invoice_bank_routing`, and, by SA ruling R-2, `invoice_payment_instructions` |
| BC-C | Confirmed default: owner's answers in; `website_analysis`, `extracted_data`, `onboarding_conversation` out | as §3.4 |
| BC-D | Confirmed default: setup-progress out (`SETUP_STATE`) | `onboarding_completed`, `profile_completeness`, `setup_checklist_dismissed`, `dismissed_setup_steps`, `needs_stripe_connect` |
| BC-E | Confirmed default: calendar-sync settings out (`CALENDAR_SYNC`) | the three `calendar_*` columns |
| BC-F | Confirmed default: `connected_plugins` out (`CONNECTED_APPS`) | as §3.4 |
| BC-G | Confirmed default: `org_id` out, `role` in | as §3.1 |

§12 is therefore closed. Dev's §2.5 last paragraph, §3.2 "auto_save_conversations in", §3.4 "Invoice profile" row and R-4 are superseded by the above.

#### Rulings

| # | Ruling |
|---|---|
| R-1 (BC-B scope: `invoice_tax_id`) | **In.** A tax registration number (VAT / EIN / ע.מ.), printed on every invoice by law, identifies the business, not an account anyone can pay into or draw from. Not a bank detail. SA rule, not a business call |
| R-2 (BC-B scope: `invoice_payment_instructions`) | **Out, `BANK_DETAILS`, reason suffix `" (free-text payment instructions; the product treats them as the same thing as bank details: SA DE-3)"`.** Evidence: `lib/business-os/setup/profileReadiness.ts` `hasPaymentMethod` ("Bank details and written instructions are two ways of saying the same thing, so either satisfies this") and `invoicePaymentOptions.ts` render them in the same "how to pay" block. Exporting the free text would leak, for many owners, exactly the IBAN the user just asked to keep out. This is an application of the user's decision, but it does drop some non-bank text (e.g. "cash on arrival"), so TL states it to the user as a one-line confirmation (see "For the user" below). `invoice_footer_text` stays **in** (closing line, not payment routing) |
| R-3 (BC-A scope) | `debug_mode`, `beta_features` (agent-platform developer flags, no Business OS reader) and the three `*_agent_updates` toggles (about agent runs only) fall under "any other agent/AI-only settings": **out, `AGENT_SETTING`.** The general display and privacy switches on `user_preferences` (`theme`, `sidebar_collapsed`, `compact_mode`, `show_timestamps`, `enable_sounds`, `keyboard_shortcuts`, `data_retention_days`, `analytics_enabled`, `telemetry_enabled`) are **not** AI-only: **in** (they are the person's own choices about the account, harmless, and a privacy choice such as `analytics_enabled` is exactly what an access request expects to see). `notification_settings.push_mentions` and the system / security / marketing toggles are contact choices: **in** |
| SA-Q1 | **Moot** (§10.1 Q3: all four tables have `id` PK). No `rowKey`, no repository change beyond the header comment. `classification.ts` and `classificationTypes.ts` `rowKey` items, X-10 and the "(if (a))" rows of §5 are **dropped** |
| SA-Q2 | **Approved.** `preferences`, `notification_settings`, `business_profile`, `business_addresses` → group `account`, `controller`. The business profile and address book are facts about the account holder's own business given to us to run the account; nothing in them is a record the owner keeps about a third party |
| SA-Q3 | **Approved: `user_code` and `subdomain` in.** Deny-list check: neither matches an exact entry or a pattern (`user_code` ends `_code`, not `_key`/`_token`; `subdomain` has no suffix). Both are the business's public address (unique, shown in every smart link / site URL), not a credential: knowing them grants nothing. `subdomain` is live (§10.1), so F-5 / R-1 are closed |
| SA-Q4 | **Approved.** `primary_crm`, `primary_calendar`, `primary_payment`, `tools` are the owner's answers (codes such as `google_calendar`); `connected_plugins` is our connection plumbing (DE4-U2) |
| SA-Q5 | **Approved: whole, no allow-list**, on the Q4 census: `scheduling_availability` = day keys only; `address_parts` / `invoice_address` / `business_addresses.parts` = the six address parts only; `theme` = design tokens + the design's `id`/`source` (`lib/branding/theme.ts`), owner-chosen look, no personal or foreign data; `process_steps` has no object elements today (owner-authored array). Same rule as DE-4 `custom_fields` / `availability`. `profiles.onboarding_data` (keys `completedAt, domain, goal, mode, profile, role`) stays as DE-1 decided |
| SA-Q6 | **Moot for DE-3** (§10.1: no jsonb and no push-subscription column on either settings table). No deny-list value-shape rule; not raised as a follow-up unless a later slice meets one. `DENY_EXCEPTIONS` stays at 1 entry |
| SA-Q7 | **Leave as DE-1 decided.** `domain` / `onboarding*` are the person's own onboarding answers, not settings, so BC-A ("settings") does not reach them, and BC-C ("owner's answers in") points the same way. Not reopened |
| SA-Q8 | **Approved:** both timezone columns exported as held. DE-8b README names `user_preferences.timezone` as the authority, `profiles.timezone` as a mirror, **and** `notification_settings.quiet_hours_timezone` (live, not in the proposal) as the zone of the quiet hours only. Add that third column to the DE-8b note in requirement §0.8 |
| SA-Q9 | **Approved** (and confirmed by the user as BC-D) |

#### Final column lists (reconciled with §10.1 exactly; these replace §3.2–§3.4)

Reconciliation done by SA: §3.4's 85 names = the 85 live `business_profiles` columns, set-equal, no duplicate, nothing missing; `business_addresses` 7 = 7; `profiles` 18 = 18. `user_preferences` and `notification_settings` below cover all 23 / 24 live columns.

| Table | `columns` (in, this order) | `excludedColumns` (reason) | Total |
|---|---|---|---|
| `profiles` | `id, full_name, avatar_url, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data` (15) | `plan` (as today), `org_id` (DE-2 BC-2 reason, §3.1), `hourly_rate_usd` (`AGENT_SETTING`) | 18 |
| `user_preferences` | `id, preferred_language, timezone, timezone_confirmed_at, preferred_currency, theme, sidebar_collapsed, compact_mode, show_timestamps, enable_sounds, keyboard_shortcuts, data_retention_days, analytics_enabled, telemetry_enabled, created_at, updated_at` (16) | `user_id` (`OWNER_ID`); `default_model, max_tokens, temperature, auto_save_conversations, debug_mode, beta_features` (`AGENT_SETTING`) | 23 |
| `notification_settings` | `id, email_enabled, email_frequency, email_system_alerts, email_security_alerts, email_marketing, push_enabled, push_system_alerts, push_mentions, desktop_enabled, desktop_system_alerts, inapp_enabled, inapp_sounds, inapp_popups, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, created_at, updated_at` (20) | `user_id` (`OWNER_ID`); `email_agent_updates, push_agent_updates, desktop_agent_updates` (`AGENT_SETTING`) | 24 |
| `business_profiles` | §3.4 "In" list **minus** `invoice_bank_name, invoice_bank_account, invoice_bank_routing, invoice_payment_instructions` (68) | §3.4 "Out" 13 **plus** those four (`BANK_DETAILS`; the fourth with the R-2 suffix) (17) | 85 |
| `business_addresses` | `id, label, parts, is_default, created_at, updated_at` (6) | `user_id` (`OWNER_ID`) | 7 |

Deny-list sweep of every `columns` entry above: **0 hits** (checked against `SECRET_COLUMN_DENY_EXACT` and the six patterns; `max_tokens` would not match `/_token$/` either, and is out anyway). No new `DENY_EXCEPTIONS` entry.

#### Tenant isolation (tenant-isolation-guard): approved as §2.4

- Only id = `ctx.userId` (`getUser().id`); the route takes no input. All four reads go through `listOwnedRowsForExport(sectionId, ctx.userId, …)`, whose first filter is `.eq('user_id', userId)` (E-2). No find-by-id.
- Addresses are read by their **own** `user_id`, never by following `address_id` / `invoice_address_id`; those two are exported as bare uuids. §10.1 Q7 = 0 cross-tenant pointers, and X-8 proves that even a crossed pointer would leak only an id. This is the right design; do not "helpfully" join or embed the pointed-to address.
- Read-only, service role, no write path: the guard's write-side rules do not arise.

#### Conditions (binding)

| # | Condition |
|---|---|
| C-1 | Descriptors use exactly the "Final column lists" table above, with the two verbatim user reason strings as named constants (`AGENT_SETTING`, `BANK_DETAILS`). X-2 extends to `hourly_rate_usd` carrying `AGENT_SETTING`; X-3 extends to name the four BC-B columns and the three `*_agent_updates` columns one by one as excluded and absent from `columns` |
| C-2 | **Factory generalisation must not move DE-4.** `ownedRowsSection(id, group, gdprRole, mapRow?)` with `clientRecordsSection(id, mapRow?) = ownedRowsSection(id, 'client_records', 'processor', mapRow)`. The route characterization re-pin (X-11) must be **insert-only** for DE-4: the 8 DE-4 select strings, their relative order, their group/role and the `clients` `source_metadata` reshaping stay byte-identical; the diff of that test may only add the four new tables after `profiles`. Dev states this in the hand-over, with the test diff |
| C-3 | Budget order: the four new sections run before the DE-4 sections and draw on the same ceiling (≤ 1 + 1 + 1 + addresses rows today). Accepted; `runExportSections` already counts every section. No ceiling change |
| C-4 | Drop the SA-Q1 (a) work items (`rowKey`, X-10, `classification.ts` change, repository single-row read). `classification.ts` is **not** touched; the repository change is its header comment only |
| C-5 | Before descriptors are final, Dev records the live `data_type` of every exported `business_profiles` column (TL has Q1). Expected arrays of codes (`text[]`/`integer[]`: `landing_pages`, `services`, `pain_points`, `goals`, `tools`, `payment_retry_intervals`, `payment_reminder_channels`, possibly `automations_declined`) travel whole. Any **jsonb** column there that Q4 did not census is reported at code review with its keys (TL one-line census); not silently exported |
| C-6 | Requirement §0.8 (always-update-main-requirement rule): records the user decisions BC-A…BC-G with date, rulings R-1…R-3 and SA-Q1…SA-Q9 as above, the final lists, and the DE-8b README note of SA-Q8 (three timezone columns) |
| C-7 | **No added CI time** (standing rule): tests only extend existing suites in the existing required Jest job, no new file, job or script. T-10 records before/after runtimes of the touched suites; any increase over ~1 s on a suite is reported to SA |
| C-8 | Rename suggestion is not required, but the row type used by the four account sections must not be documented as a "client record": either a neutral alias (`OwnedRow = Record<string, unknown>`, `ClientRecordRow` kept as alias of it) or a comment fix. No behaviour change |
| C-9 | T-9 drift check runs with the list below; result must be 0 drift / 0 missing on all five tables, SHA recorded |

#### Q8 drift check for TL (T-9) — single query, all five tables

Dev pastes the final `columns ∪ excludedColumns` of each descriptor **from the branch** into the `VALUES` list (one row per table/column; 18 + 23 + 24 + 85 + 7 = **157 rows**). TL compares Dev's list against the "Final column lists" table above before running. Expected result: **0 rows**.

```sql
-- T-9: declared (branch) vs live, both directions, five tables. Expect 0 rows.
WITH declared(table_name, column_name) AS (
  VALUES
    -- Dev: ('profiles','id'), ('profiles','full_name'), … one row per declared name, 157 rows
    ('profiles', 'id')
),
live AS (
  SELECT table_name::text, column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('profiles','user_preferences','notification_settings','business_profiles','business_addresses')
)
SELECT coalesce(l.table_name, d.table_name) AS table_name,
       coalesce(l.column_name, d.column_name) AS column_name,
       CASE WHEN d.column_name IS NULL THEN 'drift: live, not declared'
            ELSE 'missing: declared, not live' END AS problem
FROM live l
FULL OUTER JOIN declared d USING (table_name, column_name)
WHERE l.column_name IS NULL OR d.column_name IS NULL
ORDER BY 1, 2;
```

Plus a count cross-check TL reads off the same run: per table, declared count = 18 / 23 / 24 / 85 / 7.

#### Observations (not blocking)

- §10.1 Q6: `profiles.role` = `'user'` on all 11 rows, so R-5 (old `'admin'` values) is closed; F-6's "persona" description is aspirational on prod today. Still in (BC-G); harmless.
- `business_addresses` holds max 1 row per user today, but the partial unique index only binds the default address; normal keyset paging already handles more. Nothing to do.
- `profiles.onboarding_data.profile` is a nested object kept by DE-1; DE-3 does not open it (SA-Q7).

#### For the user (plain terms, via TL)

One confirmation, answer only if you disagree: following your "leave bank details out", the download will also leave out the free-text **"payment instructions"** line of the invoice settings, because owners usually type their bank account there. The cost: an owner who wrote something like "cash on arrival" will not see that line in their file. Their **tax number** stays in (it is not a bank detail). Nothing else needs a decision.

#### Approval

[x] Workplan approved — proceed to implementation (T-2…T-11) under C-1…C-9. T-1 is done; T-0 is done (§10.1).

### SA code review DE-3 — 2026-10-16

**Code Review by SA — 2026-10-16**
**Status:** ✅ Code Approved

Reviewed: the uncommitted diff on `feature/data-export-de3` (origin/main `067c4a3e` + changes, 12 files), the Dev Implementation Notes (D-1…D-7), §10.1 and §10.2. SA re-ran `lib/business-os/data-export`, `lib/business-os/purge`, `BusinessDataExportRepository.test.ts`, `userDataExportReads.test.ts` and `app/api/user/data-export`: **22 suites, 615 passed**.

#### Conditions

| # | Result |
|---|---|
| C-1 | ✅ SA reconciled the five descriptors against the §10.1 live column lists with a script: `profiles` 15 + 3 = 18, `user_preferences` 16 + 7 = 23, `notification_settings` 20 + 4 = 24, `business_profiles` 68 + 17 = 85, `business_addresses` 6 + 1 = 7. That is **157 names, no duplicates, 0 drift, 0 missing**, which matches TL's prod run (§10.2). The `columns` order is exactly SA's "Final column lists". `AGENT_SETTING` and `BANK_DETAILS` match the user's text word for word, and the R-2 suffix is word for word too. X-2 and X-3 name every ruled column one by one (`DE3_PINS` / ruled list). Only the `export` field changed on the four DE-3 rows: `level`, `order`, `scope`, `snapshot`, `area` and `notes` are untouched (purge invariant suites green) |
| C-2 | ✅ For DE-4, the characterization test only gains lines. The eight DE-4 `SELECTS`, `DE4_ROWS`, `MAPPED_DE4_ROWS` (`source_metadata` reshaping), `DE4_SECTION`, the `section()` group/role rule and the DE-4 read order are unchanged. The DE-3 tables are inserted after `profiles`. **D-4 accepted:** the queue is now drained on await, not on `from()`. Every DE-4 builder is still awaited exactly once and never ends in `maybeSingle`, so each DE-4 read gets the same page as before, and `failRead` still queues the error page for paged tables. That makes it equivalent for DE-4, not weaker. **D-5 accepted:** the `<table>:maybeSingle` error key is narrower than the table-wide key and is used only by the timezone-error case, whose assertions are unchanged. The DE-0a token-free test is not touched |
| C-3 | ✅ The four new sections run before the client records and use the same budget. The new `sections.test.ts` case pins the order 98/97/96/95, then 92 left for `pipeline_stages` |
| C-4 | ✅ `classification.ts` and the route are unchanged against origin/main. The repository change is the header comment only. No `rowKey` |
| C-5 | ✅ Closed by §10.2: `id` is uuid on all four tables, so the repository's string page-key check holds. All five exported jsonb columns are in the Q4 census. Arrays are code/day lists and travel whole |
| C-6 | ✅ Requirement §0.8 inserted (60 / 1 after the SA header bump below) |
| C-7 | ✅ No new file, job or script. The before/after runtimes are within run-to-run noise |
| C-8 | ✅ `OwnedRow` is a neutral alias, kept as `ClientRecordRow = OwnedRow`. No behaviour change |
| C-9 | ✅ §10.2: 0 drift / 0 missing over 157 names on prod |

#### Security and tenant isolation

- The only id is `ctx.userId`. All four reads go through `listOwnedRowsForExport(sectionId, ctx.userId, …)`, and the first filter is `.eq('user_id', …)`. U-6 now checks all 12 owned tables (`calls[1]` = `['eq','user_id',A]`) and requires every table to be read and non-empty. X-14 extends the planted-id case.
- X-8 covers the crossed pointer: B's address id stays on A's row as a bare uuid, no other B value appears, and A's address book holds A's rows only. Its negative control (`ignoreUserIdFilter`) goes red as intended.
- Deny list: 0 hits across all 125 exported columns. `DENY_EXCEPTIONS` is still exactly `['crm_pipeline_stages.stage_key']`. No bank, secret, AI-setting, assistant-output or connected-app column is in any `columns` list, and `route.test.ts` proves the seeded sentinels never reach the body or the audit entry (audit gets counts only).
- No `console.*` in any touched source file. No entitlements import. No migration.

#### Deviations

D-1, D-2, D-3 and D-6 are accepted as written. D-4 and D-5 are accepted (see C-2). **D-7:** SA bumped the requirement's `Last Updated` to 2026-10-16 (that one line only). The §0.3.7 DE-3 row stays as it is, since §0.8 supersedes it.

#### Code Review Comments (non-blocking, for TL/RM at commit)

1. `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.8 — the status line still reads "awaiting SA code review; T-9 … owed". At commit, update it to SA code-approved + QA result + "T-9 done 2026-10-16: 0 drift / 0 missing" (§10.2). Priority: Low
2. This workplan — the header **Status** line and the T-9 checkbox (⬜) do not yet show §10.2. Tick T-9 with the result. Priority: Low

#### Optimisation Suggestions

- None needed. `accountTableSection` / `clientRecordsSection` over `ownedRowsSection` is the right size.

#### Code Approved for QA: Yes

## Dev Implementation Notes (2026-10-16)

Built under SA C-1…C-9 on `feature/data-export-de3` (merged `origin/main` `067c4a3e` first, fast-forward). Uncommitted. No column row differs from SA's "Final column lists" (checked programmatically against §10.1: `columns` ∪ `excludedColumns` = live set, all five tables, no duplicate; 157 names).

### What changed

| File | Change |
|---|---|
| `lib/business-os/purge/descriptors.ts` | `PROFILES_EXPORT` moved below `EXPORT_COLUMN_REASON` (it now uses `AGENT_SETTING`; a `const` cannot be read before its declaration) and re-listed: 15 columns, `org_id` / `hourly_rate_usd` excluded. Five new reason constants: `AGENT_SETTING`, `BANK_DETAILS` (both verbatim user text), `ASSISTANT_OUTPUT`, `CONNECTED_APPS`, `SETUP_STATE`. Four new `include` consts. The four `planned('DE-3')` rows point at them; `level`, `order`, `scope`, `snapshot`, `area`, notes untouched |
| `lib/business-os/data-export/classificationTypes.ts` | + 4 section ids. No `rowKey` (C-4) |
| `lib/business-os/data-export/sections.ts` | `ownedRowsSection(id, group, gdprRole, mapRow?)`; `clientRecordsSection(id, mapRow?) = ownedRowsSection(id, 'client_records', 'processor', mapRow)` (C-2); a one-line `accountTableSection(id) = ownedRowsSection(id, 'account', 'controller')`; `OwnedRow` neutral alias with `ClientRecordRow = OwnedRow` (C-8); 4 registry entries after `user_profile`; header comments |
| `lib/repositories/BusinessDataExportRepository.ts` | Header comment only (C-4) |
| Tests (existing files only) | `exportClassification.test.ts` (DE-3 pins, ruled exclusions, deny list, inline live set, re-plants on `proposals`), `sections.test.ts`, `BusinessDataExportRepository.test.ts` (X-7, X-8), `userDataExportReads.test.ts`, `route.characterization.test.ts`, `route.test.ts`, `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` (included-table list, not in §5: see deviations) |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | New §0.8 + one Change History row. Insert-only (59 / 0) |

`classification.ts`, the route, `payload.ts`, `limits.ts` and every other purge file are untouched. No `console.*` in any touched file (F-11 holds).

### C-2: DE-4 unchanged in the route characterization test

The diff of `route.characterization.test.ts` changes no DE-4 expectation: the eight `SELECTS` strings, `DE4_ROWS`, `MAPPED_DE4_ROWS` (the `source_metadata` reshaping), `DE4_SECTION`, the `section()` group / role rule and the DE-4 read order are byte-identical. It adds `DE3_TABLES` (read after `profiles`, before the DE-4 tables), their four literal selects, `DE3_ROWS`, `DE3_COUNTS`, a `details` body part, and the four ids in the audit expectations. The `profiles` select loses two columns (DE-3's own decision). One harness change, needed because the route now reads `user_preferences` twice (the section, then the DE4-U1 timezone): a paged table's queued page is taken when the query is **awaited**, and `maybeSingle` is answered from `mockResults`. Every DE-4 read is awaited, never `maybeSingle`, so DE-4 tables see the same results as before (all 56 cases green).

### C-5: types of the exported `business_profiles` columns

Source: the physical catalog `catalog.generated.ts` (generated from prod 2026-09-10) for 68 columns, migration DDL for the 17 added later. **Not the live Q1 `data_type`**: §10.1 records names only, and I have no DB access. TL: one line confirms it (below).

| Type | Exported columns |
|---|---|
| `jsonb` | `scheduling_availability`, `process_steps`, `theme`, `invoice_address`, `address_parts`. **All five are in the Q4 census.** No uncensused jsonb is exported. (The other jsonb columns, `website_analysis`, `onboarding_conversation`, `extracted_data`, are excluded) |
| `text[]` | `landing_pages`, `services`, `pain_points`, `goals`, `tools`, `payment_reminder_channels`, `automations_declined` |
| `integer[]` | `payment_retry_intervals`, `payment_reminder_days_before`, `payment_overdue_reminder_days` (the last two are arrays, not in C-5's expected list: arrays of day counts, travel whole) |
| `uuid` | `id`, `address_id`, `invoice_address_id` |
| `integer` | `clients_per_week`, `payment_max_retries`, `invoice_payment_terms_days`, `meeting_reminder_hours_before` |
| `numeric` | `invoice_tax_rate` |
| `boolean` | `show_logo_on_smart_links`, `payment_retry_enabled`, `payment_reminder_enabled`, `invoice_prices_include_tax`, `daily_briefing_email_enabled`, `lead_alert_email_enabled`, `lead_autosend_enabled`, `chase_invoices_enabled`, `chase_intake_enabled`, `chase_quotes_enabled`, `meeting_reminder_enabled`, `meeting_reminder_notify_client`, `meeting_reminder_notify_owner`, `auto_complete_meetings_enabled` |
| `timestamptz` | `created_at`, `updated_at` |
| `character varying` | `user_code` |
| `text` | every other exported column (28) |

```sql
-- C-5 confirmation (read-only): live type of every DE-3 exported column, and of each table's id.
SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_preferences', 'notification_settings', 'business_profiles', 'business_addresses')
  AND (data_type IN ('json', 'jsonb', 'ARRAY') OR column_name = 'id')
ORDER BY table_name, column_name;
```

Expected: `id` uuid on all four; jsonb only the five above plus the three excluded ones and `business_addresses.parts`; no json/jsonb on the two settings tables.

⚠️ **`user_preferences.id` and `notification_settings.id` type is not recorded anywhere** (dashboard-created, F-2). The repository's C-8 check requires every page's last id to be a **string** and strictly increasing; a `bigint`/`serial` id comes back as a JSON number and the section would fail closed (`failed`, never a leak). Q3 shows both have an `id` PK; the query above settles the type. If either is not uuid / text, that is an SA item before merge.

### Tests and runtimes (C-7)

Touched suites, `--runInBand`, per suite (JSON reporter, warm cache). Before = HEAD versions of the same files (swapped in from a scratch backup, then restored and byte-compared).

| Suite | Before (2 runs) | After (3 runs) |
|---|---|---|
| `BusinessDataExportRepository.test.ts` | 9.76 / 7.50 s | 7.90 / 6.70 / 7.00 s |
| `route.characterization.test.ts` | 2.55 / 1.45 s | 1.90 / 1.13 / 1.59 s |
| `exportClassification.test.ts` | 1.39 / 0.69 s | 1.42 / 0.65 / 0.94 s |
| `route.test.ts` | 1.20 / 0.49 s | 0.85 / 0.53 / 0.65 s |
| `SchemaReconciler.test.ts` | 0.91 / 0.58 s | 0.61 / 0.47 / 0.58 s |
| `sections.test.ts` | 0.47 / 0.33 s | 0.59 / 0.29 / 0.42 s |
| `userDataExportReads.test.ts` | 0.35 / 0.39 s | 0.37 / 0.23 / 0.28 s |
| **Tests in these 7** | 251 | 282 |

No suite moved beyond run-to-run noise; no increase near 1 s. No new file, job or script.

Full run of `lib/business-os/data-export lib/business-os/purge lib/repositories/__tests__/BusinessDataExportRepository.test.ts lib/repositories/__tests__/userDataExportReads.test.ts app/api/user/data-export lib/client`: 26 suites, **637 passed** (was 606). `npm run test:bos-entitlements`: 278 suites, 8255 passed. `npm run test:authz-guard`: 2 suites, 203 passed. `tsc` on the 11 touched files (scratch tsconfig extending the root; full-project `tsc` runs out of heap locally): 0 errors. `eslint` on the touched files: clean. NUL-byte scan: none.

### Mutation check (§7 last row)

Each rule reverted once in the source, the named test run, the file restored and byte-compared:

| Rule | Mutation | Result |
|---|---|---|
| X-2 | `org_id` back into `PROFILES_EXPORT.columns` | 5 DE-3 tests red |
| X-3 | `onboarding_conversation` into `BUSINESS_PROFILES_EXPORT.columns` | 6 red |
| X-4 | `push_token` into `NOTIFICATION_SETTINGS_EXPORT.columns` | 3 red (T-4 and DE-3 X-4) |
| X-8 | `.eq('user_id', input.userId)` removed in the repository | 2 red (U-6 and X-8); their negative controls stay green |

### Deviations (for SA)

| # | Deviation | Why |
|---|---|---|
| D-1 | `PROFILES_EXPORT` moved (deleted at the top, re-added in the DE-3 block) | It now references `EXPORT_COLUMN_REASON.AGENT_SETTING`, declared below it. Content changes are exactly §3.1 |
| D-2 | `accountTableSection(id)` helper beside `clientRecordsSection` | Symmetric one-line wrapper over `ownedRowsSection`; no behaviour of its own |
| D-3 | `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` edited (not in §5) | It pins the list of included tables (9 → 13). Pin update only |
| D-4 | Characterization mock: paged result taken on await, `maybeSingle` from `mockResults` | `user_preferences` is read twice now; see C-2 above |
| D-5 | `route.test.ts` mock: `mockErrors['<table>:maybeSingle']` | So the DE-4 "timezone read error" case still fails only the timezone read, not the new preferences section. Its assertion (`failed_sections: []`) is unchanged |
| D-6 | DE-3 live columns inline in `exportClassification.test.ts` (`DE3_LIVE_TABLES`), not a fixture JSON as DE-4 | C-7: no new file |
| D-7 | Requirement `Last Updated` header and §0.3.7 DE-3 row ("+ agents/configurations per BQ-SA-1") left as they are | C-6 is insert-only; §0.8 supersedes them. TL may want the header bumped |

### C-9: T-9 drift SQL (TL runs; expected 0 rows)

Generated from the branch descriptors (`columns` ∪ `excludedColumns`), 157 rows: profiles 18, user_preferences 23, notification_settings 24, business_profiles 85, business_addresses 7. Kept in the hand-over report to TL (not repeated here, to keep this file readable).

## QA Testing Report

_QA populates this section._

### QA — DE-3 — 2026-10-16

**Test mode:** full
**Strategy used:** A + B (Jest unit and route/repository integration with mocked Supabase). Mutation testing (negative controls) was done in a scratch copy. Edge cases ran as scratch-only Jest cases. Option D (a browser check) is left to the user after deploy. A route that sends a file has no UI path that Jest can drive.
**Focus:** api, schema, security (tenant isolation, deny list, ruled exclusions), regression (DE-4 unchanged)
**Skipped:** live DB run. QA has no DB access. T-0 and T-9 (§10.1 / §10.2, TL on prod) are the live evidence.
**Input source:** TL prompt (steps 1–4) + workplan §7 X-1…X-14, SA C-1…C-9, BC-A…BC-G

**Hygiene:** I never ran `git stash`. I never committed. Negative controls and edge tests ran only in `scratchpad/de3qa/{base,mut}`, which are `git archive` exports of HEAD `067c4a3e` with `git init`, and `mut` = HEAD + the DE-3 patch, byte-checked against the worktree. I did not touch the worktree's own `scratchpad/`. `git diff --numstat` is identical before and after for all 11 code/test files. The one change is `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md`, which went 59/0 → 60/1 during the session. That is SA's `Last Updated` bump (recorded as D-7 in the SA code review), not QA. Both scratch `node_modules` junctions were removed with `rmdir`. The shared `node_modules` is intact (842 entries). `.github/` has no change.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| X-1 four tables `include`, no `planned('DE-3')` left | ✅ | Pass | Pinned. Re-plan control in-suite |
| X-2 / BC-A / BC-G `profiles` 15 cols, `role` in, `org_id` / `hourly_rate_usd` / `plan` out | ✅ | Pass | Controls (b1), (c1), (c2) red |
| BC-A `user_preferences` AI settings and `*_agent_updates` out | ✅ | Pass | Control (b2) `default_model` red |
| BC-B / R-2 bank details and payment instructions out, tax id in | ✅ | Pass | Controls (a1), (a2), (a3) red |
| BC-C / BC-F assistant output, onboarding chat, connected apps out | ✅ | Pass | Controls (d1), (d2), (d3) red |
| X-4 deny list holds, `DENY_EXCEPTIONS` = 1 | ✅ | Pass | Controls (g1) `push_token`, (g2) `webhook_secret` red in CI and at request time |
| X-5 / X-6 registry order, group `account`, role `controller` | ✅ | Pass | (h4) moving a DE-3 section after DE-4 goes red |
| X-7 / X-8 / X-14 tenant isolation, crossed pointer | ✅ | Pass | (e) drop `.eq('user_id')` red (28). (f) addresses read without the tenant filter red, including X-8 |
| X-9 / X-11 select strings and route characterization; C-2 DE-4 insert-only | ✅ | Pass | The test diff removes no DE-4 `SELECTS`/rows/mapping line. Controls (h1) column order, (h2) registry order, (h3) DE-4 role, (h5) dropped `source_metadata` mapping all red |
| Token-free body | ✅ | Pass | (i1) token planted in an account row red. (i2) same with the exact-body assertion disabled in scratch: the `not.toContain('never-exported')` assertion itself goes red |
| X-12 seeded `hourly_rate_usd` / `org_id` absent, `role` present | ✅ | Pass | route.test.ts + userDataExportReads |
| X-13 purge baseline unchanged | ✅ | Pass | `lib/business-os/purge` all green; descriptor invariant in entitlements run green |
| C-7 no added CI time | ✅ | Pass | No new file/job/script; suite runtimes in noise (Dev table) |
| Edge: owner with no rows in the four tables | ✅ | Pass | E1: four `ok` sections, 0 rows, no failed section, audit counts 0 |
| Edge: several addresses, past a page | ✅ | Pass | E2: 5 addresses, PAGE_SIZE 2, all exported in id order, no `user_id` |
| Edge: NULL jsonb / array columns | ✅ | Pass | E3: `theme`, `scheduling_availability`, `process_steps`, `invoice_address`, `address_parts`, `services`, `profiles.onboarding_data` null → exported as null, section ok |
| Edge: file name on the owner's clock | ✅ | Pass | E4: 22:30Z + Asia/Jerusalem → `…-2026-07-16-0130.json`, with the preferences section reading the same table first |
| Edge: whole-table `user_preferences` error | ✅ | Pass | E5: `preferences` is `failed` (not empty), file name falls back to UTC, 200, no error text |
| Edge: DE-4 sections unchanged | ✅ | Pass | Characterization pins + (h1)–(h5) |

#### Issues Found

**Bugs:** none.

**Performance:** none. The four sections cost 4 reads, each 1 row on prod today (Q5).

**Edge cases / observations (non-blocking):**
1. When `user_preferences` cannot be read, there are now two outcomes: the `preferences` section is `failed` and the file name falls back to UTC (E5). This is correct by FR-E12. The DE-4 timezone-error test now seeds the error only on the `maybeSingle` read (D-5), so the whole-table case is covered only by E5 in QA scratch and by the characterization `PostgREST error on user_preferences` case. Covered. Noted for awareness only.
2. Line endings: the worktree's `lib/business-os/purge/descriptors.ts` is LF on disk while the checkout is CRLF (git warns "LF will be replaced by CRLF"). The numstat is not whole-file (165/28), so this is harmless. RM should check the commit is not whole-file churn.

#### Test Outputs / Logs

| Run | Result | Wall time |
|---|---|---|
| `jest lib/business-os/data-export lib/business-os/purge lib/repositories/__tests__/BusinessDataExportRepository.test.ts lib/repositories/__tests__/userDataExportReads.test.ts app/api/user/data-export lib/client --ci` (worktree) | 26 suites, **637 passed**, 0 failed | Jest 48.1 s (1 m 51 s wall) |
| `npm run test:bos-entitlements` (worktree) | 278 suites, 8254 passed, 1 failed: `app/admin/users/__tests__/creditsBlock.render.test.tsx` (75.8 s, a load timeout). Rerun alone: **69/69 passed**. Known load flake | Jest 239.7 s (4 m 36 s wall) |
| `npm run test:authz-guard` (worktree) | 2 suites, **203 passed** | Jest 76.7 s |
| Full `npx jest --ci`, baseline `067c4a3e` export | 1466 suites; 36502 tests: 36274 passed, 163 failed, 65 pending; 28 failed suites (run under load from the parallel mutation runs) | 28 m 40 s |
| Full `npx jest --ci`, DE-3 export | 1466 suites; 36533 tests (+31 = Dev's 606 → 637): 36328 passed, 140 failed, 65 pending; 20 failed suites | 19 m 31 s |
| Baseline vs DE-3 | **0 new failing suites, 0 new failing tests.** All 20 DE-3 failing suites also fail on the baseline with the same tests. They are the known list (oneAddressPolicy, publicEndpointsAreThrottled, bookingsSearchAndPaging, supabaseFetch) plus suites that fail in any `git archive` export (v4/v6/pilot/orchestration/onboarding guards and adapters, contact-drawer guards: line-ending or environment related, unrelated to DE-3). 8 render suites failed only on the loaded baseline run (archiving page, messages/activity/bosLens/searchTotals layouts, awaitingPayment, ProposalBuilderPackage, AdminAreaField): load timeouts | — |

Negative controls (scratch `mut`, each applied alone, then reverted; suites = data-export, purge, the 2 repository suites, the route folder; 615 tests):

| Control | Mutation | Red |
|---|---|---|
| (a1) | `invoice_bank_account` moved into `business_profiles.columns` | 8 |
| (a2) | `invoice_payment_instructions` moved into columns | 7 |
| (a3) | `invoice_bank_account` added to columns, still listed as excluded | 11 |
| (b1) | `hourly_rate_usd` into `profiles.columns` | 11 |
| (b2) | `default_model` into `user_preferences.columns` | 7 |
| (c1) | `org_id` into `profiles.columns` | 10 |
| (c2) | `plan` into `profiles.columns` | 10 |
| (d1) / (d2) / (d3) | `website_analysis` / `onboarding_conversation` / `connected_plugins` into columns | 7 / 7 / 7 |
| (e) | `.eq('user_id', …)` removed from the repository read | 28 (incl. X-8, U-6) |
| (f) | `business_addresses` read without the tenant filter (a pointer read, as if following `address_id`) | 5 (incl. X-8, X-14) |
| (g1) / (g2) | `push_token` / `webhook_secret` into `notification_settings.columns` | 46 / 46 |
| (h1) | two DE-4 `scheduling_services` columns swapped | 3 |
| (h2) | DE-4 registry order swapped (`pipeline_stages` ↔ `clients`) | 28 |
| (h3) | DE-4 role `processor` → `controller` | 22 |
| (h4) | `business_addresses` section moved after DE-4 | 29 |
| (h5) | `clients` `source_metadata` mapping dropped | 21 |
| (i1) | `access_token: 'never-exported-qa'` added to every account-table row | 20 |
| (i2) | (i1) with the exact-body assertion disabled | 20 (the token assertion itself fires) |

All 21 controls went red. The scratch tree was clean (`git status`) after each one.

#### Manual check for the user after deploy (Business OS, own account)

1. Business OS → Settings → "Download my data". The file downloads, and its name carries today's date and time on your clock.
2. In the `account` group, after `user_profile`, there are four new sections, `preferences`, `notification_settings`, `business_profile` and `business_addresses`, each `"status": "ok"`.
3. `business_profile` shows your business name, contact details, address, invoice name, tax number and invoice settings. It does **not** show the bank name, account number or routing number, nor the free-text payment instructions.
4. Nowhere in the file: hourly rate (`hourly_rate_usd`), AI model settings (`default_model`, `max_tokens`, `temperature`), the agent-update notification toggles, `org_id`, `plan`, the website analysis, the onboarding chat, or the connected-apps list.
5. `user_profile` still shows `role`. The DE-4 client-record sections (`pipeline_stages`, `clients`, `client_activities`, `client_tasks`, `client_documents`, `services`, `bookings`, `time_off`) look exactly as before.

#### Final Status
- [x] All acceptance criteria pass — ready for commit (no bug; the two observations are non-blocking)
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan created | DE-3 plan: 4 tables, profiles decisions, live SQL Q1–Q8, SA-Q1…SA-Q9, BC-A…BC-G. No code |
| 2026-10-16 | SA workplan review | Approved with conditions C-1…C-9; user decisions BC-A…BC-G recorded; final column lists reconciled with §10.1; single-query T-9 drift check |
| 2026-10-16 | Code complete (Dev) | T-2…T-8, T-10, T-11 done under C-1…C-9; requirement §0.8 inserted; T-9 SQL (157 names) handed to TL; Dev Implementation Notes added (C-2, C-5, C-7 runtimes, mutation check, deviations D-1…D-7) |
| 2026-10-16 | QA (full) | PASS, no bugs: 637 touched-suite tests, entitlements 8255 (1 known load flake, green alone), authz 203; full Jest 0 new failures vs `067c4a3e`; 21/21 negative controls red; 6 edge cases pass |

### 10.1 T-0 live results — 2026-10-16 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)

**Q1/Q2 columns** (`!` = NOT NULL, `(gen)` = generated):
| Table | n | Live columns (in order) |
|---|---|---|
| `business_addresses` | 7 | id!, user_id!, parts:jsonb!, label, is_default!, created_at!, updated_at! |
| `business_profiles` | 85 | id!, user_id!, vertical!, sub_vertical, company_name, company_size, clients_per_week, revenue_tier, website_url, landing_pages, website_analysis, connected_plugins, primary_crm, primary_calendar, primary_payment, onboarding_completed, onboarding_conversation, profile_completeness, language, created_at, updated_at, services, scheduling_availability, calendar_sync_enabled, calendar_sync_provider, calendar_last_synced_at, default_payment_processor, payment_retry_enabled, payment_retry_intervals, payment_max_retries, payment_reminder_enabled, payment_reminder_days_before, payment_overdue_reminder_days, payment_reminder_channels, process_steps, dismissed_setup_steps, invoice_company_name, invoice_address, invoice_tax_id, invoice_bank_name, invoice_bank_account, invoice_bank_routing, invoice_payment_instructions, invoice_footer_text, invoice_number_prefix, logo_url, pain_points, goals, tools, payment_mode, online_presence_mode, needs_stripe_connect, extracted_data, description, user_code, setup_checklist_dismissed, show_logo_on_smart_links!, collection_method, theme, template_id, phone, email, address, invoice_document_type, invoice_prices_include_tax!, invoice_tax_rate, invoice_tax_label, daily_briefing_email_enabled!, invoice_payment_terms_days!, **subdomain (LIVE)**, lead_alert_email_enabled!, lead_autosend_enabled!, chase_invoices_enabled!, chase_intake_enabled!, automations_declined!, currency, meeting_reminder_enabled!, meeting_reminder_hours_before!, meeting_reminder_notify_client!, meeting_reminder_notify_owner!, address_parts!, address_id, invoice_address_id, auto_complete_meetings_enabled!, chase_quotes_enabled! |
| `notification_settings` | 24 | id!, user_id!, email_enabled, email_frequency, email_agent_updates, email_system_alerts, email_security_alerts, email_marketing, push_enabled, push_agent_updates, push_system_alerts, push_mentions, desktop_enabled, desktop_agent_updates, desktop_system_alerts, inapp_enabled, inapp_sounds, inapp_popups, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, created_at, updated_at — **no jsonb, no token/push-subscription column** |
| `profiles` | 18 | id!, full_name, avatar_url, plan, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data:jsonb, hourly_rate_usd, org_id |
| `user_preferences` | 23 | id!, user_id!, theme, sidebar_collapsed, compact_mode, data_retention_days, analytics_enabled, telemetry_enabled, default_model, max_tokens, temperature, auto_save_conversations, show_timestamps, enable_sounds, keyboard_shortcuts, debug_mode, beta_features, created_at, updated_at, preferred_currency, preferred_language, timezone, timezone_confirmed_at — **no jsonb** |

**Q3 keys:** all four tables have `id` PRIMARY KEY → **SA-Q1 moot** (normal keyset paging works). `user_id` UNIQUE on `user_preferences`, `notification_settings`, `business_profiles`. `business_profiles.user_code` UNIQUE; `subdomain` partial-unique. `business_addresses`: partial unique (user_id) WHERE is_default.

**Q4 jsonb keys:** scheduling_availability = monday…sunday; theme = borderRadius, colors, composition, fonts, id, layouts, scale, source, spacing; address_parts / invoice_address / business_addresses.parts = city, country, line1, line2, postal_code, state; process_steps = no object elements present; profiles.onboarding_data = completedAt, domain, goal, mode, profile, role.

**Q5:** max 1 row per user on all four tables (incl. business_addresses today).
**Q6:** 11 profiles; `hourly_rate_usd` set on 11; `org_id` set on 8; `role` = 'user' on all 11.
**Q7:** cross-tenant address pointers = **0**.

T-0 done. §3 lists must be reconciled with Q1 before coding (any difference → workplan fix; SA reviews).

### 10.2 T-9 drift check + C-5 types — 2026-10-16 (TL, read-only, prod `jgccgkyhpwirgknnceoh`)
- **C-9 drift:** Dev's 157 declared names (18 + 23 + 24 + 85 + 7, include ∪ excluded) compared with `information_schema.columns` via FULL OUTER JOIN: **0 drift, 0 missing**.
- **C-5 types:** `id` is **uuid** on `user_preferences`, `notification_settings`, `business_profiles`, `business_addresses` (C-8 string page-key check holds). Live jsonb on business_profiles: address_parts, extracted_data (out), invoice_address, onboarding_conversation (out), process_steps, scheduling_availability, theme, website_analysis (out) — the five exported jsonb columns are all in the Q4 census. Arrays: text[] landing_pages, services, pain_points, goals, tools, payment_reminder_channels, automations_declined, connected_plugins (out), dismissed_setup_steps (out); int4[] payment_retry_intervals, payment_reminder_days_before, payment_overdue_reminder_days. Matches Dev's C-5 notes.
- **R-2:** user confirmed 2026-10-16 that `invoice_payment_instructions` stays OUT.
