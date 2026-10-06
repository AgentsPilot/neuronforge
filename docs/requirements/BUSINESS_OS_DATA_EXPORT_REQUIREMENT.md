# Requirement: Business OS — Export My Data

> **Last Updated**: 2026-10-05

**Created by:** BA
**Date:** 2026-10-05
**Status:** Draft, **PARKED until the admin delete (AD-2, AD-3, AD-4) is finished** — the whole export scope, **including DE-0 (token exposure)**, runs LAST (user decisions 2026-10-05, DX-11 = no). Open business questions DX-1 to DX-10 and DX-12 are asked when the work resumes, then SA review (§9.2). **Re-baseline §1 against main first** (PR #218 merged 2026-10-05; see SQ-E10).

## Overview

A Business OS owner who presses "Export data" today gets a file built for the agent platform in November 2025: agents, runs, configurations, plugin connections and old Pilot-Credit transactions. It contains **none** of their Business OS data: no business profile, plan, credit usage, extra credits, contacts, notes, documents, services, bookings, payments, invoices, ledger, intake forms, website, images, onboarding or emails sent. Three of the export buttons also build the file **in the browser** with `select('*')` on `plugin_connections`. That puts the owner's live OAuth access and refresh tokens into a downloaded JSON file (measured live, §1.2).

This requirement covers four things:
- make the export complete for a Business OS owner, and safe;
- a CI-enforced rule that every new table is classified for export;
- the export offered **before** any delete (the customer delete in the purge requirement, and the admin delete in [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md));
- delivery in small numbered slices.

---

## Table of Contents

0. [Status and sequencing](#0-status-and-sequencing)
1. [Discovery: what exists today](#1-discovery-what-exists-today)
2. [GDPR roles: whose data is in the file](#2-gdpr-roles-whose-data-is-in-the-file)
3. [Proposed scope: what goes in, what never goes in](#3-proposed-scope-what-goes-in-what-never-goes-in)
4. [User stories](#4-user-stories)
5. [Delivery slices](#5-delivery-slices)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Acceptance criteria](#8-acceptance-criteria)
9. [Decisions and open questions](#9-decisions-and-open-questions)
10. [Out of scope / future roadmap](#10-out-of-scope--future-roadmap)
11. [Notes on integration points](#11-notes-on-integration-points)
12. [Appendix A: proposed skill rule text](#appendix-a-proposed-skill-rule-text)
13. [Change History](#change-history)

Evidence tags: ✅ read in code or docs, or measured live, on 2026-10-05 · 🧠 relayed by the coordinator or taken from project memory, not re-read · ❓ needs SA / Dev live verification (`npm run schema:check`).

> **Which checkout.** The `main` working copy here is behind. The repository refactor of the export route exists in worktree `vigilant-mccarthy-63566f` (branch `refactor/data-export-repositories`, SA code-approved 2026-10-04), and discovery below is read from that worktree. Whether that branch has merged is ❓. `docs/workplans/DATA_EXPORT_FOLLOWUPS_WORKPLAN.md`, named in the brief, **was not found in any local checkout** on 2026-10-05. Its two user decisions (our AI provider cost is excluded; Stripe ids are included) are taken from the brief 🧠.

---

## 0. Status and sequencing

| Item | State |
|---|---|
| **Export feature (DE-1 … DE-10)** | **Scheduled last, after admin delete AD-2, AD-3 and AD-4 are finished** (user decision, 2026-10-05). The requirement is written now so that SA can review it and the classification design (SQ-E1) can be settled alongside AD-1a's `SchemaReconciler` |
| **DE-0 — security (token exposure)** | **Separate from the feature.** The finding (§1.2) is independent of export: the browser can read and write the owner's own OAuth tokens, whether or not anyone presses Export. **User decision pending:** does DE-0 jump the queue? BA recommends yes (DX-11) |
| **Consequence of the order** | Admin delete AD-2…AD-4 will ship **before** the business data can be exported. Until DE-3/DE-4 ship, a deleted owner can take away only today's agent-platform export. See DX-12 |

---

## 1. Discovery: what exists today

### 1.1 The server export: `GET /api/user/data-export`

| Fact | Tier |
|---|---|
| One GET with no parameters. Auth is `createServerClient` + `getUser()`. 401 if signed out | ✅ |
| Answers with one JSON file: `Content-Disposition: attachment; filename="neuronforge-data-export-<userId>-<ms>.json"`, `Cache-Control: no-store` | ✅ |
| Eight reads, all with the service role (`supabaseServer`), each keyed on `user.id` from `getUser()` (never from the request). They go through purpose-named repository methods `...ForUserDataExport` (refactor workplan, SA-approved) | ✅ worktree / ❓ merged |
| **Sections:** `user_profile` (profiles `*`, spread over auth id/email/created_at), `agents` (`*`, incl. deleted), `agent_executions` (`*`, last 90 days, max 1,000), `agent_configurations` (`*`), `plugin_connections` (**5 explicit columns**, credentials never selected), `subscriptions` (`user_subscriptions *`), `transactions` (`credit_transactions *`, last 12 months, max 5,000), `audit_logs` (`audit_trail *`, BD-26 exclusions, last 90 days, max 10,000), plus `summary` | ✅ |
| **Every read error is ignored** and gives an empty section (SA C-5, deliberate) | ✅ |
| **`audit_logs` is always empty.** It filters on `timestamp`, which does not exist (42703, error swallowed). **FU-1** | ✅ |
| **BD-26:** internal admin audit entries (`OWNER_HIDDEN_ENTITY_TYPES`: `ai_action`, `business_os_account_plan`, `business_os_credit_lot`, `business_os_credit_period`, plus any `BUSINESS_AI_ACTION_%` action) are excluded inside `AuditTrailRepository.listOwnerEntriesForExport`, pinned by `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | ✅ |
| Seven of the eight reads use `select('*')` (**FU-P1**). The 500 body returns `error.message` in production (**FU-P2**). `exportData: any` (rule 6). All three were left for a follow-up | ✅ |
| `credit_transactions` / `user_subscriptions` are agent-platform (Pilot-Credit) tables. `CreditTransactionRepository` is read-only, with "no Business OS use" (SA C-3) | ✅ |
| `export_metadata.data_controller` = `'NeuronForge'`. The route writes a `DATA_EXPORTED` audit row (`info`, GDPR/SOC2 flags, IP and user agent) | ✅ |

**So for a Business OS owner the file holds:** their profile row, plugin connection metadata, and agents and runs if they ever used the agent platform. Nothing from the 60+ Business OS tables.

### 1.2 The client-side export buttons and the token exposure

| Surface | What it does | Tier |
|---|---|---|
| `app/business-os/settings/page.tsx` `handleExportData` (≈ L429) | In the browser: `profiles select('*')`, `user_preferences select('*')`, **`plugin_connections select('*')`**, then builds `my-data-<date>.json` from a Blob | ✅ |
| `components/settings/SecurityTab.tsx` | Same pattern, plus `notification_settings` | 🧠 (coordinator) |
| `components/v2/settings/SecurityTabV2.tsx` | Same pattern, plus `notification_settings` | 🧠 (coordinator) |

**Live measurement (user, 2026-10-05) ✅:**

| Measure | Result |
|---|---|
| Column privileges on `public.plugin_connections.access_token` and `refresh_token` | **`anon` and `authenticated` both hold SELECT, INSERT, UPDATE, REFERENCES** |
| RLS | ON. Policies: "Users can manage own plugin connections" (ALL, `{public}`, `USING auth.uid() = user_id`) and "Users can only see own connections" (SELECT, `{public}`, `auth.uid() = user_id`) |
| Rows holding a refresh token | 27 |

**What that means:**
- A signed-in user's browser can **read and write** their **own** OAuth access and refresh tokens. `anon` gets no rows, because RLS filters on `auth.uid()`.
- The three client "Export data" buttons put those tokens into a plain downloaded JSON file.
- **Beyond the export, any script running on our origin (an XSS) can read them**, and so can a browser extension with page access. The tokens grant access to the owner's Google/other accounts.
- This is direct client DB access to a credential table (CLAUDE.md rule 1, Security Rules).
- **The finding is independent of the export feature.** Removing the buttons (DE-0a) closes the file leak. Only the privilege revoke (DE-0b) closes the browser read/write.

### 1.3 The Danger zone link

`components/business-os/purge/DangerZonePanel.tsx` → `ErasureRequestContent` renders a plain `<a href="/api/user/data-export">Export Data</a>` next to the erasure "Contact us" mailto, with the hint "We recommend downloading a copy of your data first — erasure cannot be undone." ✅ The erasure path already points at the server export. That export just doesn't contain the business.

### 1.4 Per-screen exports

| Export | Where | What | Reuse? | Tier |
|---|---|---|---|---|
| **Ledger** | `GET /api/payments/ledger/export` → `lib/payments/ledgerService` (`buildLedgerReport`, `ledgerToCsv`, `ledgerToWorkbook`) + `lib/payments/ledgerExport.ts`; UI `components/payments/LedgerExportModal.tsx` | Server-side, Zod-validated, xlsx or csv, date range, refunds as their own dated rows, tax/fee splits, per-currency totals, ISO dates | **Yes, for the shaping rules.** The full export's money sections follow the same conventions. The accountant workbook could also be included as an extra file (SQ-E6). It also proves an xlsx writer is already a dependency | ✅ |
| Orders page "save what is on screen" | Described in the ledger route header: exports the loaded rows, capped by pagination | Not reusable as a full export | ✅ (comment) |
| CRM contacts CSV, money list CSV | Named in the brief. **Not located** with the tools BA had (no grep) | Dev locates them in DE-1. Reuse their **column choice and CSV escaping**, not page-capped client builders | ❓ |
| `/monitoring` CSV | `app/(protected)/monitoring/page.tsx`, from `GET /api/audit/query` (BD-26 F-3) | Agent-platform audit view, not reused | ✅ |
| `AuditTrailService.exportUserData()` | Reads every audit row. **No production caller** (BD-26 F-5) | **Do not reuse.** It would bypass BD-26 | ✅ |

### 1.5 Registries that already classify tables

| Registry | What it classifies | Enforcement | Tier |
|---|---|---|---|
| `lib/business-os/businessOwnedTables.ts` | `BUSINESS_OWNED_TABLES` (≈ 60) vs `USER_OWNED_TABLES` (≈ 45, each with a reason). Its header names "what an export includes" as one of its purposes | `businessOwnedTables.test.ts` reads **migration text**, with no DB in CI. Every `CREATE TABLE` with `user_id` must be in exactly one list, and the TS list must equal the SQL array | ✅ |
| `lib/business-os/account/accountDeletionPolicy.ts` | Per account-level table: `delete` / `minimise` / `keep`, plus a reason | Its own test. SA-1 (admin delete): only script/test consumers. Purge slice 3 must **retire it or derive it from the descriptors**: "two registries is the root cause of the `insight_actions` drift" | ✅ |
| `lib/business-os/purge/descriptors.ts` | Per table: `level` (`reset` / `purge` / `never` / `optional:*`), scope, order, snapshot, storage buckets | Invariant test. The **`SchemaReconciler`** (AD-1a, SC-7) compares the descriptors with the live schema through `purge_schema_introspect()`, which returns **columns** and FKs | ✅ / reconciler merge ❓ |

A fourth independent list for export would repeat the exact failure SA-1 diagnosed (§6.4, SQ-E1).

---

## 2. GDPR roles: whose data is in the file

| | **A. The owner's own data** | **B. Data the owner holds about their clients** |
|---|---|---|
| Examples | Login email, profile, preferences, plan, billing account, credits used and added, onboarding chat, own activity history | Contacts, notes, documents, bookings, invoices, payments, intake answers, subscribers, consent records, emails sent to clients |
| Our role | **Controller** | **Processor**, acting for the owner, who is the controller |
| Basis for exporting it | Art. 15 (access) and Art. 20 (portability), the owner's own rights against us | Art. 28(3)(g): we **return** the controller's data on request and at the end of the service, before deleting it. The owner needs it before any delete |
| Who may ask | The owner, about themselves | The owner only. **A client of the business cannot ask us.** They ask the business, which answers with this export or its screens |

**What that means for the export:**

1. **Both kinds go in the file, in separately labelled groups.** The README and metadata say which group is which and who the controller is for each: us for the account, the business for its client records.
2. **Group B is third-party personal data, often in bulk.** The file is as sensitive as the whole CRM. That is why the NFRs require owner-only access, no caching, an audit row, short-lived links and nothing in logs (§7).
3. **We do not filter Group B "for the client's sake".** It is the owner's data to take away. We remove only what is **ours** (internal admin notes, our AI provider cost, caches, platform counters) or **dangerous** (tokens and secrets).
4. **A client's access request goes to the business, not to us.** A per-contact export is the precise tool for that, and is on the roadmap (§10).
5. **`data_controller: 'NeuronForge'` is wrong for Group B** and stale as a brand for Group A (DX-10).

---

## 3. Proposed scope: what goes in, what never goes in

### 3.1 Groups

Table names are as classified in `businessOwnedTables.ts` ✅. **Every column is ❓ until verified live** by `npm run schema:check` in the slice that adds it.

| Group | Contents (tables) | GDPR role | Slice |
|---|---|---|---|
| **A1 Account & profile** | `profiles`, `user_preferences`, `notification_settings` 🧠, `business_profiles`, `business_addresses`, `onboarding_conversations`, `plugin_connections` (metadata only) | Controller | DE-3 |
| **A2 Plan, billing & credits** | `business_os_account_plans`, `business_os_billing_accounts` (Stripe ids **included** 🧠), `business_os_credit_charges` (credits charged, **without our AI provider cost** 🧠), `business_os_credit_totals`, `business_os_credit_lots` / `_credit_lot_draws` (extra credits, DX-9), invites sent (`business_os_invites`) | Controller | DE-3 |
| **A3 Own activity** | `audit_trail` owner-visible rows (BD-26 kept, FU-1 fixed) | Controller | DE-1 |
| **B1 Clients (CRM)** | `crm_contacts`, `crm_activities` (notes, history), `crm_tasks`, `crm_pipeline_stages`, `contact_documents` (metadata; files in DE-8) | Processor | DE-4 |
| **B2 Scheduling** | `scheduling_services`, `scheduling_bookings`, `scheduling_availability_exceptions`, `external_calendar_events` | Processor | DE-4 |
| **B3 Money** | `payment_transactions`, `payment_refunds`, `payment_invoices`, `payment_plans`, `payment_plan_subscriptions`, `payment_plan_installments`, `payment_reminders`, `payment_events`, `proposals`, `payment_automation_rules` / `_executions`, `saved_payment_methods` and `payment_methods` (brand / last 4 / Stripe ids only), `stripe_connect_accounts` (ids and status only), `payment_processors` (**name and status only, never keys**) | Processor | DE-5 |
| **B4 Intake, leads & email** | `business_intake_forms`, `user_intake_settings`, `lead_responses`, `business_subscribers`, `marketing_consent_settings`, `marketing_consent_events`, `marketing_consent_state`, `email_unsubscribes`, `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `email_sends` | Processor | DE-6 |
| **C Content** | `websites`, `website_pages`, `website_content`, `smart_links`, `user_media` (generated and uploaded images: metadata; files in DE-8) | Mostly controller | DE-7 |
| **D Insight & assistant activity** | `business_chat_conversation`, `business_chat_saved_plans`, `business_chat_verified_questions`, `daily_briefings`, `insights`, `insight_outcomes`, `insight_actions`, `insight_automations`, `business_health_summaries`, `owner_insight_history`, `channel_connections` (no tokens), `channel_metrics_daily`, `website_page_views` (aggregated, SQ-E7) | Mixed | DE-7 |
| **E Agent platform (existing)** | `agents`, `agent_executions`, `agent_configurations`, `user_subscriptions`, `credit_transactions`, kept as today with explicit columns | Controller | DE-1 |

### 3.2 Never in the export (each needs a recorded reason in the registry)

| Category | Examples | Reason |
|---|---|---|
| Tokens, secrets, keys | `plugin_connections.access_token` / `refresh_token`, processor API keys, webhook secrets, `auth_handoff_codes` | Security. Never selected, not even to drop later |
| Our internal notes about the account | BD-26 operator entity types; admin actor ids and internal reasons on grants (DX-9) | BD-26 user decision |
| Our cost | AI provider cost columns on charges, `token_usage` cost fields, `ai_model_pricing` | User decision 🧠 |
| Caches and platform counters | `business_chat_plan_cache`, `business_os_entitlement_shadow_events`, `derived_metrics`, `daily_briefing_sends` bookkeeping (SQ-E7) | Not the owner's data, or fully derived from exported data |
| Other accounts | Rows of other users, even if linked | Tenant isolation |
| Platform tables with an actor column | `ais_scoring_weights`, `exchange_rates`, `system_settings_config`, … (admin delete SC-8) | Platform data; the owner only appears as "who edited" |

---

## 4. User stories

- As a **Business OS owner**, I want one button that gives me a copy of **everything** I and my business have in the platform, so I can keep it, move to another tool, or answer my accountant.
- As an **owner about to delete my business**, I want the export offered as the first step, so I do not lose my client list by accident.
- As an **owner whose client asks "what do you hold about me?"**, I want my client records in a form I can search and hand over.
- As a **platform admin answering an erasure request**, I want to see whether the account exported recently, and to send the owner an export before I delete. **I never download it myself.**
- As the **product owner**, I want a new table or column to fail CI until someone decides whether it is exported, so the export cannot fall behind again.
- As the **security owner**, I want no browser code able to read or write OAuth token columns, and no export path ever to select them.

---

## 5. Delivery slices

Small, numbered and independent, a few days each. Every slice leaves the export **more** complete and never less safe. Nothing is committed before the user has seen the diff. **DE-0 is security work and is sequenced on its own (§0). DE-1…DE-10 run after admin delete AD-2…AD-4.**

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **DE-0a — Security: buttons go through the server** 🔴 user decision pending on jumping the queue | The three buttons (`business-os/settings`, `SecurityTab`, `SecurityTabV2`) stop reading the DB from the browser. Each downloads `GET /api/user/data-export` (no tokens, explicit 5-column plugin read), like `ErasureRequestContent` already does. The client `handleExportData` builders are deleted. Toasts adapted (SQ-E2). Jest source guard: no `'use client'` file calls `.from('plugin_connections')`, with a negative control. `console.*` count in the three files flagged per CLAUDE.md § Logging | Nothing | 🟢 ~0.5 d |
| **DE-0b — Security: revoke browser access to token columns** 🔴 SA to rule | A migration revokes SELECT, INSERT, UPDATE (and REFERENCES) on `plugin_connections.access_token` and `refresh_token` from `anon` and `authenticated`. **Only after proving** no browser code reads or writes them, e.g. connect/refresh flows (SQ-E3). Server code uses the service role and is unaffected. Checker + rollback scripts and a runbook (user applies to PROD by hand, as for 20261018). Includes a probe: signed in as an owner, reading the token column fails with 42501 | DE-0a, SQ-E3 inventory | 🟡 ~1 d |
| **DE-1 — Make the current export honest** | Explicit column lists on the 7 `*` reads (FU-P1). Audit filter `timestamp` → the real column (FU-1), BD-26 unchanged. Production 500 without `error.message` (FU-P2). Typed payload (rule 6). A **section model** (id, group, GDPR role, columns, row source), so DE-3…DE-7 only add sections. Locate the CRM / money per-screen CSVs (§1.4) | Refactor branch merged ❓ | 🟢 ~1 d |
| **DE-2 — Export classification + CI check + skills rule** | Every registered table carries `include` (section + explicit columns), `exclude` (reason), or temporary `planned` (slice id). The existing migration-reading test fails on an unclassified table: inside the existing Jest gate, **no added CI time**. Skill rule in `new-repository`, `new-api-route`, `new-plugin` (Appendix A). **Location of the classification is SA's ruling** (SQ-E1) | DE-1 | 🟡 ~1–1.5 d |
| **DE-3 — Account, plan, billing, credits** | Groups A1 + A2 | DE-2 | 🟡 ~1.5 d |
| **DE-4 — Clients & scheduling** | Groups B1 + B2 (records; files in DE-8) | DE-2 | 🟡 ~1.5 d |
| **DE-5 — Money** | Group B3, with the ledger export's conventions | DE-2 | 🟡 ~1.5 d |
| **DE-6 — Intake, leads, email & consent** | Group B4 | DE-2 | 🟡 ~1.5 d |
| **DE-7 — Content & insight activity** | Groups C + D. Closes all `planned` entries | DE-2 | 🟡 ~1.5 d |
| **DE-8 — Format, size & files** | Format per DX-3 (recommended: zip of one CSV per section, plus `data.json`, a README and the files) and the large-account path per DX-4: a background job builds the file into a private bucket, then a short-lived signed link. Contact documents and images included. `durable-queue-drain` skill if queued. May split into 8a (sync zip) / 8b (async + files) | DE-3…DE-7 | 🔴 ~3 d |
| **DE-9 — One export entry point** | One "Download my data" control with a "what's included" list, in Settings and the Danger zone (DX-5). "Last exported on …" from the `DATA_EXPORTED` audit row | DE-8 | 🟢 ~0.5–1 d |
| **DE-10 — Export before delete** | Customer: the purge slice-5 flow starts with the export step (DX-6). Admin: the admin delete preview gains "last export: date / never" and an action "send this account its export" (delivered only to the account's own email). **Retrofitted onto the already-shipped admin delete**, given the order in §0 | DE-8/DE-9; purge slice 5; AD-1/AD-2 | 🟡 ~1–1.5 d |

**Order:** DE-0a + DE-0b as soon as the user allows (recommended now). After admin delete: DE-1 → DE-2 → DE-3…DE-7 (any order; DE-3 and DE-4 first, as they matter most to an owner leaving) → DE-8 → DE-9 → DE-10.

---

## 6. Functional requirements

### 6.1 Access and safety (all slices)

1. **FR-E1** The export is produced **only on the server**, for the authenticated owner. The user id comes from `getUser()`, never from the request. No `'use client'` file reads any table for export (DE-0a).
2. **FR-E2** Every export read uses an **explicit column list**. `select('*')` is forbidden in export reads (guard).
3. **FR-E3** **No token, secret, key or credential column is ever selected.** A column the registry marks `secret` cannot appear in any export column list (guard).
4. **FR-E4** The browser roles (`anon`, `authenticated`) hold no privilege on OAuth token columns (DE-0b).
5. **FR-E5** BD-26 stays in force: owner-hidden audit types and AI-action events are never exported. Admin actor ids and internal reasons on grants are not exported (DX-9).
6. **FR-E6** Our AI provider cost is never exported. Stripe ids **are** exported 🧠.
7. **FR-E7** All reads go through `lib/repositories/` (rule 1), keyed on the owner's id (rule 4). Service-role use is documented at each call site.

### 6.2 Content

8. **FR-E8** The file is organised by the §3.1 groups. Each group carries its GDPR role and a plain-language description. A README states what each section is, who the controller is, what was left out and why (§3.2 in plain words), the export time in UTC and the owner's timezone (`user_preferences.timezone`).
9. **FR-E9** Timestamps are ISO 8601 UTC. Amounts are bare numbers with an ISO 4217 currency column. Totals are per currency, **never summed across currencies**.
10. **FR-E10** Soft-deleted rows: included or not per section, stated in the README (SQ-E5).
11. **FR-E11** The 2025 windows and caps (90 days, 12 months, 1,000/5,000/10,000) are removed or justified per section. A remaining cap is stated in the file (DX-8).
12. **FR-E12** A section that fails to read is **marked as failed in the file**, not silently emptied. The response is still 200 if the account group was read.

### 6.3 Delivery

13. **FR-E13** Format per DX-3, delivery per DX-4. If a link is used, it is a private bucket, a signed URL valid ≤ 24 h, owner-only, and the file is deleted after expiry.
14. **FR-E14** One export control in the UI (DX-5). Settings, the Danger zone, `SecurityTab` and `SecurityTabV2` all use it.
15. **FR-E15** Every export writes a `DATA_EXPORTED` audit row, non-blocking, with section counts and never contents. An admin-triggered send (DE-10) also writes an `operator`-class row.
16. **FR-E16** Rate limit: one export in progress per account, plus a cool-down (SQ-E8).

### 6.4 Classification and enforcement (DE-2)

17. **FR-E17** Every table in `BUSINESS_OWNED_TABLES` and `USER_OWNED_TABLES` (and every table the purge descriptors classify) has exactly one export classification: `include` (section + explicit columns), `exclude` (reason required), or `planned` (slice id, allowed only until DE-7).
18. **FR-E18** CI fails when a migration creates a table with `user_id` that has no export classification. This extends the existing migration-reading test: no new job, no DB in CI, no added critical-path time.
19. **FR-E19** Column drift: a live column on an `include` table that is in neither its column list nor its `excludedColumns` (with a reason) is **reported** by the live check (`SchemaReconciler` / `schema:check`), run pre-merge by Dev and SA. It never fails the export at runtime (SQ-E1).
20. **FR-E20** The skill rule (Appendix A) is added to the three skills.
21. **FR-E21** **One source of classification.** No fourth independent table list. SA rules where it lives and how `accountDeletionPolicy.ts` relates (SQ-E1).

### 6.5 Export before delete (DE-10)

22. **FR-E22** Customer delete (purge slice 5): the first step offers the export. The owner downloads it or ticks "I don't want a copy" before reaching the preview (DX-6).
23. **FR-E23** Admin delete: the preview shows the last export date (or "never"), plus an action that sends the export to the account's **own** email only. It is not blocking unless DX-6 says so.
24. **FR-E24** The purge 7-day forensic snapshot is **not** an export and is never offered to the customer.

---

## 7. Non-functional requirements

- **Security:** owner-only and server-only. No tokens or secrets. `Cache-Control: no-store`. Signed links are short-lived and single-account. Logs carry no file contents and no client PII, only ids and counts. Use the `tenant-isolation-guard` skill for the admin send path (target from the path, delivery to the target's own email).
- **CSV injection:** cells beginning `=`, `+`, `-`, `@`, tab or CR are neutralised in CSV/xlsx output.
- **Performance:** a typical account completes synchronously. Large accounts take the DX-4 path. Serverless size and duration limits go to SA (SQ-E4).
- **Logging:** Pino `createLogger`, `correlationId`, `{ err }`. No `console.*` in touched files.
- **Accessibility:** the control and the "preparing" state are keyboard-operable and announced, not shown by colour alone.
- **i18n:** button and README copy through `LanguageContext` (Hebrew, English). Column names stay English.
- **CI:** no added critical-path time. New checks are Jest inside existing jobs.
- **Verification:** every column is verified against the live schema (`npm run schema:check`) in the slice that adds it, and recorded in the workplan.

---

## 8. Acceptance criteria

**DE-0a**
- [ ] AC-E1 None of the three settings surfaces sends a browser request to `profiles`, `user_preferences`, `plugin_connections` or `notification_settings` for export. Each export button downloads `GET /api/user/data-export`.
- [ ] AC-E2 A Jest guard fails if any `'use client'` file calls `.from('plugin_connections')` (negative control included).
- [ ] AC-E3 The downloaded file contains no `access_token`, `refresh_token` or other credential key (test account with a connected plugin).

**DE-0b**
- [ ] AC-E4 After the migration, `column_privileges` shows no SELECT / INSERT / UPDATE / REFERENCES for `anon` or `authenticated` on the two token columns. Signed in as an owner, reading `access_token` fails (42501).
- [ ] AC-E5 Connecting a plugin, refreshing a token and every browser feature that lists connections still work (QA manual check, named flows from the SQ-E3 inventory).
- [ ] AC-E6 The rollback script restores the previous privileges exactly, and the checker reports both states.

**DE-1**
- [ ] AC-E7 No export read uses `*` (guard). The audit section contains the owner's visible rows and none of the BD-26 hidden types (fixture with one of each).
- [ ] AC-E8 A forced 500 in production mode returns no internal detail.
- [ ] AC-E9 A section whose read fails is marked failed in the file, and the response is still 200.

**DE-2**
- [ ] AC-E10 A migration creating a `user_id` table with no export classification fails the Jest gate; removing it passes. An `exclude` with no reason fails.
- [ ] AC-E11 Export classification and the ownership / purge classification are one source (per SQ-E1), and a test proves they cannot disagree.
- [ ] AC-E12 The three skills contain the Appendix A rule.
- [ ] AC-E13 The CI critical path is not longer (measured on the PR run).

**DE-3 … DE-7**
- [ ] AC-E14 For a seeded business with a row in every `include` table, every section is present with the expected count and only its listed columns.
- [ ] AC-E15 A second business's rows never appear (two-tenant fixture).
- [ ] AC-E16 No provider cost, token, secret or BD-26 row appears (negative fixtures).
- [ ] AC-E17 Money sections: refunds negative, currency on every amount, no cross-currency total.
- [ ] AC-E18 After DE-7, no `planned` classification remains.

**DE-8 … DE-10**
- [ ] AC-E19 The output opens in a spreadsheet, and the JSON parses. A cell starting with `=` is neutralised.
- [ ] AC-E20 An account above the threshold gets the DX-4 path. The link works for the owner only, and expires.
- [ ] AC-E21 Files in the zip match that account's storage objects (count and size).
- [ ] AC-E22 One export control. "Last exported" shows the latest `DATA_EXPORTED` date.
- [ ] AC-E23 The customer delete flow cannot reach the preview without an export or an explicit decline. The admin preview shows last export. The admin send goes only to the target's own email and writes an `operator` audit row.

**All slices:** route integration tests for happy path + 401 + invalid input where there is input. QA records a manual download check on a real test account.

---

## 9. Decisions and open questions

### 9.1 Business questions (for the user, via TL)

| # | Question | BA recommendation |
|---|---|---|
| **DX-1** | **What goes in?** (a) account (profile, plan, billing, credits used and added); (b) business records about clients; (c) content (website, images, documents); (d) activity (assistant chats, briefings, insights) | **All four.** (c) includes the actual **files**, not just names. (d) leaves out caches and counters |
| **DX-2** | **One download, or pick sections?** | **One download of everything**, organised into labelled sections. The accountant already has the ledger export |
| **DX-3** | **Format: one JSON file, or a zip of spreadsheets?** | **A zip:** one CSV per section (opens in Excel/Sheets, imports into another CRM), a `data.json`, a plain-language README, and the files. JSON keeps working until DE-8 |
| **DX-4** | **Large accounts: limits, or "we'll prepare it and send a link"?** | **Prepare and link.** Small accounts download at once. Large ones are built in the background, shown as "ready" in Settings and emailed as a link valid 24 h. Never a silently truncated export |
| **DX-5** | **Merge the buttons into one?** | **Yes.** One "Download my data" control in Settings and the Danger zone. The old settings pages link to the same thing |
| **DX-6** | **Export before delete: offer or require?** | **Customer:** the export is step 1; download or tick "I don't want a copy" to continue. **Admin:** show "last export"; the admin can send it to the owner's own email; not blocking, because an erasure request must be answerable even if the owner never downloads |
| **DX-7** | **Who may see the client data in the file?** | Only the owner. An admin can trigger delivery but **never** downloads another account's export |
| **DX-8** | **History depth: keep the 90-day / 12-month windows?** | **Everything we still hold**, with DX-4 handling size |
| **DX-9** | **Extra credits from an admin: show the admin's internal reason?** | **No.** Amount, date and "added by AgentsPilot" / "purchased". No admin identity or note (BD-26) |
| **DX-10** | **Name in the file** ("NeuronForge" in the filename and controller field) | Use the name customers know (user to choose). Controller stated per group: us for the account, the business for its client records |
| **DX-11** | **Does the security fix (DE-0) jump the queue?** Today any signed-in browser can read and write its own Google/plugin tokens, and three Export buttons write them into a downloaded file | **Yes, now.** DE-0a is about half a day and closes the file leak. DE-0b (revoke browser access to the token columns) follows once SA confirms nothing in the browser needs it. Neither depends on the export feature **➜ Decided by user 2026-10-05: NO — DE-0 runs LAST together with the export, after the admin delete. Tokens stay browser-readable until then (risk accepted by the user).** |
| **DX-12** | **Admin delete ships before the export (your order).** Until DE-3/DE-4, a deleted owner can take away only the old agent-platform file, not their clients, bookings or invoices. Accept? | **Accept the order, with one guard:** do not use admin delete on a **real** customer with business data until at least DE-3 + DE-4 have shipped, or until the admin has sent the customer the relevant per-screen exports (ledger, contacts) by hand. Test accounts are unaffected (admin delete already recommends test accounts only until AD-3) |

### 9.2 Technical questions for SA

- [ ] **SQ-E1** Where does export classification live: (i) an export map in `businessOwnedTables.ts` keyed by both lists (like `accountDeletionPolicy`), or (ii) an `export` field on the purge `descriptors.ts`, which the `SchemaReconciler` already checks against live columns (making FR-E19 almost free)? BA leans to (ii), or (i) **derived** from one source, given SA-1's "two registries" finding. How is column drift checked with no DB in CI? (raised by: BA | status: open)
- [ ] **SQ-E2** DE-0a UX: with a plain `<a href>` there is no success/error promise. Use `fetch` + blob from the server route (keeps the toasts, still no DB in the browser), or drop the toasts? BA leans to `fetch` + blob. (raised by: BA | status: open)
- [ ] **SQ-E3** DE-0b: inventory every browser read and write of `plugin_connections` (connect, OAuth callback, token refresh, connection lists, plugin tester) and confirm none touches the token columns, or move them server-side first. Also: should `anon`'s table-level privileges on `plugin_connections` go entirely? Should the 27 refresh tokens be rotated? BA's view is no forced rotation without evidence of misuse, since exposure was to each owner's own browser, but SA rules. Column-level REVOKE with table-level grants in place has a known Postgres subtlety: a table-level SELECT grant still covers every column. The migration may need to revoke at table level and re-grant the other columns. (raised by: BA | status: open)
- [ ] **SQ-E4** Serverless limits on our Vercel plan: maximum synchronous response size and duration, streaming vs buffered, and the background threshold. Does a zip need a new dependency (rule 7), or is the existing xlsx writer enough? (raised by: BA | status: open)
- [ ] **SQ-E5** Soft-deleted rows per section (the `agents` "includes deleted" precedent). (raised by: BA | status: open)
- [ ] **SQ-E6** Reuse of `lib/payments/ledgerService`: include its workbook as an extra file, or only follow its conventions? (raised by: BA | status: open)
- [ ] **SQ-E7** Classify the borderline tables: `website_page_views` (visitor IP or user agent?), `derived_metrics`, `daily_briefing_sends`, `external_calendar_events`, `business_events`, and where `email_sends` bodies are stored. (raised by: BA | status: open)
- [ ] **SQ-E8** DE-8 background job (queue + drain per `durable-queue-drain`, or on-demand), private bucket, link TTL, cleanup, and the rate-limit mechanism. (raised by: BA | status: open)
- [ ] **SQ-E9** Admin send-export (DE-10): route under the `/api/admin/users/[id]/…` family. Does it fit SA-3's admin-target exception? (raised by: BA | status: open)
- [x] **SQ-E10** Merge state of `refactor/data-export-repositories` and of AD-1a's `SchemaReconciler`. DE-1 and DE-2 build on both. (raised by: BA | status: answered 2026-10-05 by coordinator — both are on main: `refactor/data-export-repositories` (38f527f0) and AD-1a PR #216. **Also merged today: PR #218 `fix(export): include audit history and plugin connections, explicit columns, no raw error (FU-1, FU-P1, FU-P2)`.** This discovery was read from an older worktree, so §1 and DE-1 must be re-baselined against main before the work starts — parts of DE-1 are likely already done.)

---

## 10. Out of scope / future roadmap

- **Per-contact export** ("everything about this one client"), the precise tool for a client's request to the business.
- Import from another tool (the reverse of portability).
- Scheduled or periodic exports and backups.
- Agent-platform tables beyond today's sections (logs, calibration, memories): classified in DE-2 with a reason, not built here.
- Changing what the purge deletes or keeps, and the customer delete itself (purge slice 5).
- Replacing the temporary erasure contact address (N2).

---

## 11. Notes on integration points

| System | Impact |
|---|---|
| `app/api/user/data-export/route.ts` + `__tests__` (characterization pin) | Extended slice by slice. The pin is updated deliberately in DE-1 |
| `lib/repositories/*` (`...ForUserDataExport`, `PluginConnectionRepository`, `CreditTransactionRepository`, `AuditTrailRepository.listOwnerEntriesForExport`) + `lib/repositories/__tests__/userDataExportReads.test.ts` | New export reads per section, explicit columns |
| `app/business-os/settings/page.tsx`, `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx` | DE-0a: client-side export removed |
| `public.plugin_connections` privileges; every browser reader/writer of it | DE-0b: column privilege migration, checker, rollback, runbook |
| `components/business-os/purge/DangerZonePanel.tsx` | DE-9 shared control; DE-10 export step |
| `lib/business-os/businessOwnedTables.ts` + test, `lib/business-os/purge/descriptors.ts`, `SchemaReconciler`, `lib/business-os/account/accountDeletionPolicy.ts` | DE-2 classification (SQ-E1) |
| `lib/audit/ownerVisibility.ts`, `ownerAuditReads.guard.test.ts` | BD-26 exclusions stay green |
| `lib/payments/ledgerExport.ts`, `ledgerService`, `/api/payments/ledger/export` | DE-5 conventions, possible reuse |
| Supabase Storage (contact documents, user media, website assets) | DE-8 files; private export bucket |
| `AuditTrailService` / `AUDIT_EVENTS.DATA_EXPORTED` | Every export; "last exported" |
| Admin delete (AD-1…AD-4) and purge slice 5 | DE-10, retrofitted after admin delete ships |
| `.claude/skills/new-repository`, `new-api-route`, `new-plugin` | DE-2 skill rule |
| CI Jest gate | New guards inside existing jobs |

---

## Appendix A: proposed skill rule text

To be added by Dev in DE-2, with the same wording in `.claude/skills/new-repository`, `new-api-route` and `new-plugin`:

> **Data export classification (mandatory).** If your change adds a table, or adds a column to a table, that stores customer or business data, classify it for the "export my data" file in the same PR ([BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §6.4). Either **include** it with an explicit column list (never `*`), or **exclude** it with a written reason (secret, cache, platform-only, our cost…). Token, secret and key columns are always excluded and must never be granted to `anon` / `authenticated`. An unclassified new table fails CI. A new column on an included table goes into its list or its excluded columns, with a reason. Verify column names against the live schema (`npm run schema:check`).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-05 | Created (BA, draft) | As-built discovery: the export (Nov 2025, agent platform) holds none of the Business OS data; three client-side buttons read `plugin_connections *`; the Danger zone links to the server export; the ledger export is reusable for conventions; three overlapping table registries. GDPR controller / processor split. Groups A–E and the never-export list. Slices DE-0 to DE-10, FR-E1…E24, AC-E1…E23, business questions DX-1…DX-12, SA questions SQ-E1…SQ-E10, skill rule text. `DATA_EXPORT_FOLLOWUPS_WORKPLAN.md` not found locally; its two user decisions taken from the brief |
| 2026-10-05 | Live token finding + sequencing (coordinator input) | User's live check recorded ✅: `anon` and `authenticated` hold SELECT/INSERT/UPDATE/REFERENCES on `plugin_connections.access_token` / `refresh_token`; RLS on (owner-only); 27 refresh tokens. DE-0 split into 0a (buttons through the server) and 0b (revoke browser privileges, SA to rule), and marked independent of the feature. User decision: the export feature runs **last, after admin delete AD-2…AD-4**. DE-0 queue position pending (DX-11). Added DX-12 (admin delete before export) |
| 2026-10-05 | DX-11 decided; parked; SQ-E10 answered | User: DE-0 does **not** jump the queue — the whole scope incl. the token fix runs last, after AD-2…AD-4 (risk accepted). SQ-E10: the repository refactor and AD-1a are on main; PR #218 (FU-1, FU-P1, FU-P2) also merged today, so the as-built discovery must be re-baselined before DE-1 |
| 2026-10-06 | `business_addresses` added to A1 | New business-owned table from PR #229 (the address book behind `business_profiles.address_parts` / `invoice_address`). Registered alongside its purge descriptor |
