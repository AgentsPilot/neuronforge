# Business OS — Data Model (as-merged into `main`)

> **Last Updated**: 2026-08-04

## Overview

This document catalogs the database entities the **Business OS** feature introduced into `main` via PR #10 (`feature/ai-business-os-phases-1-2-3`, merge `7c9801d`, 2026-07-28) and follow-up commit `06086dc` (2026-07-31). It is the data-model companion to [BUSINESS_OS_MONOREPO_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md), which covers the app/kernel split and migration plan.

Business OS added **42 tables + 1 view + 2 storage buckets** across 10 capability domains. Every table roots at `auth.users` and is protected by per-user Row-Level Security (RLS) unless explicitly noted. **No Business OS table references the kernel/`agents` schema** — the two schemas are cleanly separable, which underpins the shared-Supabase decision (see architecture doc §8).

> **Scope note.** The same PR also introduced a `20260629_*` batch of **kernel / V6-learning** tables (`behavior_rules`, `error_patterns`, `execution_model_tracking`, `execution_optimization_tables`, `intent_examples`, `platform_learning_tables`, `plugin_performance`, `seed_memory_config_defaults`). Those are **not** Business OS entities and are excluded from this catalog — they are owned by the orchestrator/kernel.

## Table of Contents

1. [Summary Index](#1-summary-index)
2. [Business Profile](#2-business-profile)
3. [CRM](#3-crm)
4. [Website](#4-website)
5. [Scheduling](#5-scheduling)
6. [Payments](#6-payments)
7. [Email Automation](#7-email-automation)
8. [Intake / Forms](#8-intake--forms)
9. [Onboarding](#9-onboarding)
10. [Command / Chat Sessions](#10-command--chat-sessions)
11. [Capabilities / Building-Blocks](#11-capabilities--building-blocks)
12. [Relationships Overview](#12-relationships-overview)
13. [Data-Model Observations & Risks](#13-data-model-observations--risks)
14. [Change History](#14-change-history)

---

## 1. Summary Index

Every Business OS table at a glance. "RLS user-scoped?" is the platform's security boundary — `Y` means policies scope by `auth.uid() = user_id`.

| Entity | Domain | Table | Repository | RLS user-scoped? |
|---|---|---|---|---|
| Business Profile | Business Profile | `business_profiles` | BusinessProfileRepository | Y (1:1 user) |
| Contact | CRM | `crm_contacts` | CRMContactRepository | Y |
| Activity | CRM | `crm_activities` | CRMActivityRepository | Y |
| Pipeline Stage | CRM | `crm_pipeline_stages` | CRMPipelineStagesRepository | Y |
| Task | CRM | `crm_tasks` | CRMTaskRepository | Y |
| Contact Document | CRM | `contact_documents` | ContactDocumentsRepository | Y |
| Website Template | Website | `website_templates` | (none) | **N — global, public read** |
| Website Page | Website | `website_pages` | WebsitePageRepository | Y (+ public live-page read) |
| Website Block | Website | `website_blocks` | WebsiteBlockRepository | **Indirect (via page); no `user_id`** |
| Website Content | Website | `website_content` | WebsiteContentRepository | Y (1:1 user) |
| Page View | Website | `website_page_views` | WebsiteAnalyticsRepository | Y read / **open INSERT** |
| Service | Scheduling | `scheduling_services` | SchedulingRepository | Y |
| Booking | Scheduling | `scheduling_bookings` | SchedulingRepository | Y |
| Availability Exception | Scheduling | `scheduling_availability_exceptions` | SchedulingRepository | Y |
| External Cal Event | Scheduling | `external_calendar_events` | ExternalCalendarEventRepository | Y (+ service-role ALL) |
| Invoice | Payments | `payment_invoices` | PaymentRepository | Y |
| Transaction | Payments | `payment_transactions` | PaymentRepository | Y |
| Payment Method (Stripe) | Payments | `payment_methods` | _(none — dead table, unowned; flagged for a future DROP migration)_ | Y |
| Stripe Connect Acct | Payments | `stripe_connect_accounts` | PaymentRepository | Y (1:1 user) |
| Processor | Payments | `payment_processors` | PaymentRepository | Y |
| Payment Plan | Payments | `payment_plans` | PaymentPlanRepository | Y |
| Installment | Payments | `payment_plan_installments` | PaymentPlanRepository | Y |
| Payment Event | Payments | `payment_events` | PaymentRepository | Y |
| Automation Rule | Payments | `payment_automation_rules` | PaymentRepository | Y |
| Automation Execution | Payments | `payment_automation_executions` | PaymentRepository | Y |
| Payment Reminder | Payments | `payment_reminders` | PaymentRepository | Y |
| Saved Payment Method | Payments | `saved_payment_methods` | PaymentRepository | Y |
| Sequence | Email | `email_sequences` | EmailAutomationRepository | Y |
| Sequence Step | Email | `email_sequence_steps` | EmailAutomationRepository | Y |
| Campaign | Email | `email_campaigns` | EmailAutomationRepository | Y |
| Send | Email | `email_sends` | EmailAutomationRepository | Y |
| Unsubscribe | Email | `email_unsubscribes` | EmailAutomationRepository | Y |
| Enrollment | Email | `email_sequence_enrollments` | EmailAutomationRepository | Y |
| Intake Template | Intake | `intake_form_templates` | IntakeRepository | **N — global, RLS off** |
| Intake Settings | Intake | `user_intake_settings` | IntakeRepository | Y (1:1 user) |
| Onboarding Msg | Onboarding | `onboarding_conversations` | OnboardingConversationRepository | Y (append-only) |
| Command Session | Command/Chat | `command_sessions` | CommandSessionRepository | Y |
| Capability | Capabilities | `capabilities` | (read via UserCapabilityRepository) | **N — global, RLS off** |
| Building Block | Capabilities | `capability_building_blocks` | (read) | **N — global, RLS off** |
| User Capability | Capabilities | `user_capabilities` | UserCapabilityRepository | Y |
| User Cap. Block | Capabilities | `user_capability_blocks` | UserCapabilityRepository | **Indirect (via user_capabilities)** |

Plus one VIEW — `website_analytics_summary` (aggregates `website_page_views`; relies on base-table RLS) — and two storage buckets (`contact-documents`, and the website-images bucket referenced by `20260726_fix_website_images_rls`).

**Total: 42 tables + 1 view + 2 storage buckets.**

---

## 2. Business Profile

### `business_profiles`

Per-user business identity, vertical, onboarding state, and cross-capability settings (calendar/payment prefs). **1:1 with the user** (`user_id UNIQUE`) — the de-facto per-tenant settings row. Sources: `20260721_create_business_profiles.sql` + ALTERs (`20260722_add_scheduling_availability…`, `…add_services…`, `20260723_add_calendar_sync_fields`, `…add_setup_checklist_dismissed`, `20260723_enhance_payments`, `20260728_add_process_steps…`).

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK, `gen_random_uuid()` | |
| user_id | UUID | NOT NULL, **UNIQUE**, FK→`auth.users(id)` | 1:1 with user |
| vertical | TEXT | NOT NULL | therapist/coach/etc. |
| sub_vertical | TEXT | | |
| company_name / company_size | TEXT | | |
| clients_per_week | INT | | |
| revenue_tier | TEXT | | |
| website_url | TEXT | | |
| landing_pages | TEXT[] | `'{}'` | |
| website_analysis | JSONB | | scraped/AI analysis |
| connected_plugins | TEXT[] | `'{}'` | |
| primary_crm / primary_calendar / primary_payment | TEXT | | |
| onboarding_completed | BOOLEAN | `false` | read by middleware onboarding gate |
| onboarding_conversation | JSONB | | |
| profile_completeness | INT | `0` | 0–100 |
| language | TEXT | `'en'` | en/es/he |
| scheduling_availability | JSONB | `'{}'` | GIN-indexed |
| services | TEXT[] | `'{}'` | GIN-indexed |
| calendar_sync_enabled | BOOLEAN | `false` | |
| calendar_sync_provider | TEXT | CHECK ∈ {google_calendar, outlook} or NULL | |
| calendar_last_synced_at | TIMESTAMPTZ | | |
| setup_checklist_dismissed | BOOLEAN | `false` | |
| default_payment_processor | TEXT | `'manual'` | |
| payment_retry_enabled | BOOLEAN | `true` | |
| payment_retry_intervals | INT[] | `'{1,4,24}'` | |
| payment_max_retries | INT | `3` | |
| payment_reminder_enabled | BOOLEAN | `true` | |
| payment_reminder_days_before | INT[] | `'{3,1}'` | |
| payment_overdue_reminder_days | INT[] | `'{1,3,7}'` | |
| payment_reminder_channels | TEXT[] | `'{"email"}'` | |
| process_steps | JSONB | `'[]'` | website "How It Works" |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled. SELECT/INSERT/UPDATE all `auth.uid() = user_id`. **No DELETE policy** (deletes fall to service role).
- **Indexes:** `user_id`, `vertical`, `onboarding_completed`, GIN on `scheduling_availability` and `services`, `(user_id, setup_checklist_dismissed)`.
- **Repository:** `BusinessProfileRepository` (user_id-scoped). **Trigger:** `update_business_profiles_timestamp`.

---

## 3. CRM

> **Reconciliation — two CRM create migrations.** `20260721_create_crm_tables.sql` and `20260722_create_crm_tables.sql` both `CREATE TABLE IF NOT EXISTS` the same three tables. The **20260721 version wins** (runs first). It includes a `notes` column on `crm_contacts` and omits `ON DELETE CASCADE` on the `user_id` FK; the 20260722 duplicate's CASCADE and its omission of `notes` never take effect. Policy names differ between the two files and only self-drop, so **redundant duplicate RLS policies likely coexist** on the CRM tables (harmless — all scope `auth.uid() = user_id`, OR-combined — but worth consolidating).

### `crm_contacts`

The CRM hub. Contact database with pipeline stage, tags, JSONB custom fields. Sources: `20260721_create_crm_tables.sql` (+ `20260722_migrate_contacts_to_pipeline_stages.sql`).

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` | |
| first_name / last_name / email / phone | TEXT | | |
| stage | TEXT | NOT NULL, `'lead'` | soft ref → `crm_pipeline_stages.stage_key` (no FK) |
| tags | TEXT[] | `'{}'` | GIN-indexed |
| custom_fields | JSONB | `'{}'` | vertical-specific |
| source | TEXT | | website_form/manual/booking/… |
| notes | TEXT | | (from 20260721 version) |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |

- **Referenced by:** `crm_activities`, `crm_tasks`, `contact_documents`, `scheduling_bookings`, `payment_invoices`, `payment_transactions`, `payment_plan_installments`, `payment_events`, `payment_reminders`, `saved_payment_methods`, `email_sends`, `email_unsubscribes`, `email_sequence_enrollments`.
- **RLS:** Enabled; full CRUD `auth.uid() = user_id`. **Indexes:** `user_id`, `email`/`(user_id,email)`, `stage`/`(user_id,stage)`, GIN `tags`, `created_at`.
- **Repository:** `CRMContactRepository` (user_id-scoped).
- **Triggers:** `update_crm_contacts_timestamp`; `log_crm_contact_created_trigger` → inserts a `contact_created` activity (SECURITY DEFINER, `20260722_crm_contact_creation_activity.sql`); `delete_future_bookings_on_contact_delete_trigger` → BEFORE DELETE removes future `scheduling_bookings` (`20260727_cancel_bookings_on_contact_delete.sql`).

### `crm_activities`

Timeline of interactions; auto-logged by other capabilities. Source: `20260721_create_crm_tables.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` | |
| contact_id | UUID | NOT NULL, FK→`crm_contacts` ON DELETE CASCADE | |
| activity_type | TEXT | NOT NULL | note/email/call/meeting/booking/payment/contact_created/document_uploaded/task_completed |
| title | TEXT | NOT NULL | |
| description | TEXT | | |
| auto_logged | BOOLEAN | `false` | |
| source_capability | TEXT | | scheduling/payments/email_automation/crm |
| source_entity_id | UUID | | soft link to source row |
| activity_date | TIMESTAMPTZ | `now()` | |
| created_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled; full CRUD `auth.uid() = user_id`. **Indexes:** `user_id`, `contact_id`, `activity_type`, `activity_date`, `auto_logged`, `source_capability`. **Repository:** `CRMActivityRepository`. Written by many cross-capability triggers.

### `crm_pipeline_stages`

Per-user, per-vertical configurable pipeline stages. Source: `20260721_create_crm_tables.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` | |
| vertical | TEXT | NOT NULL | |
| stage_key | TEXT | NOT NULL | referenced by `crm_contacts.stage` |
| stage_label | TEXT | NOT NULL | |
| position | INT | NOT NULL | |
| color | TEXT | | hex |
| created_at | TIMESTAMPTZ | `now()` | |
| — | — | UNIQUE(user_id, stage_key) | |

- **RLS:** Enabled; full CRUD user-scoped. **Indexes:** `user_id`, `vertical`, `(user_id,position)`. **Repository:** `CRMPipelineStagesRepository`.

### `crm_tasks`

Tasks/follow-ups, optionally contact-linked; manual or AI-created. Source: `20260722_create_crm_tasks.sql`. Enums: `task_priority` (low/medium/high/urgent), `task_status` (pending/in_progress/completed/cancelled).

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| contact_id | UUID | FK→`crm_contacts` ON DELETE SET NULL | nullable |
| title | VARCHAR(255) | NOT NULL | |
| description | TEXT | | |
| priority | task_priority | NOT NULL, `'medium'` | |
| status | task_status | NOT NULL, `'pending'` | |
| due_date / reminder_at / completed_at | TIMESTAMPTZ | | |
| created_by | VARCHAR(50) | NOT NULL, `'manual'` | manual/ai_employee/automation |
| source_entity_type | VARCHAR(50) | | |
| source_entity_id | UUID | | |
| tags | TEXT[] | `'{}'` | |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL, `NOW()` | |

- **RLS:** Enabled; full CRUD user-scoped. **Indexes:** `user_id`, `contact_id`, `status`, `due_date`, `(user_id,status)`, partial `(user_id,due_date) WHERE status IN (pending,in_progress)`. **Repository:** `CRMTaskRepository`. **Triggers:** updated_at; `set_task_completed_at`; `log_task_activity` (logs `task_completed`).

### `contact_documents`

Uploaded files (contracts, intake forms, etc.) per contact. Sources: `20260722_create_contact_documents.sql` + bucket `20260722_create_contact_documents_bucket.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| contact_id | UUID | NOT NULL, FK→`crm_contacts` ON DELETE CASCADE | |
| name | VARCHAR(255) | NOT NULL | |
| document_type | VARCHAR(50) | NOT NULL, `'other'` | contract/intake_form/invoice/…/other |
| file_name | VARCHAR(255) | NOT NULL | |
| file_size | INTEGER | NOT NULL | bytes |
| mime_type | VARCHAR(100) | NOT NULL | |
| storage_path | TEXT | NOT NULL | path in bucket |
| storage_bucket | VARCHAR(100) | NOT NULL, `'contact-documents'` | |
| description | TEXT | | |
| tags | TEXT[] | `'{}'` | |
| status | VARCHAR(20) | NOT NULL, `'active'` | active/archived/deleted |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL, `NOW()` | |

- **RLS:** Enabled; full CRUD user-scoped. **Indexes:** `user_id`, `contact_id`, `document_type`, `status`, `created_at`. **Repository:** `ContactDocumentsRepository`.
- **Triggers:** `update_contact_documents_updated_at` (calls shared `update_updated_at_column()` — **defined outside these migrations**, see Observations); `log_document_activity_trigger` → logs `document_uploaded` (SECURITY DEFINER).
- **Storage bucket:** `contact-documents` — **private**, 50 MB limit, whitelisted MIME types (pdf/office/images/text). Object RLS confines users to their own `auth.uid()` top folder.

---

## 4. Website

> **Reconciliation — `website_tables` vs `website_tables_fixed`.** The non-fixed `20260721_create_website_tables.sql` declares `website_pages` (FK→`website_templates`) **before** creating `website_templates` — a broken FK ordering. `20260721_create_website_tables_fixed.sql` creates `website_templates` first and adds extra indexes + a template updated_at trigger. Treat the **fixed** file as authoritative; the broken file should be removed from the migration set.

### `website_templates`

System-provided templates by vertical/type. **No `user_id` — global catalog.** Source: `…_website_tables_fixed.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| name | TEXT | NOT NULL | |
| vertical | TEXT | NOT NULL | |
| template_type | TEXT | NOT NULL | homepage/landing/service |
| thumbnail_url / description | TEXT | | |
| blocks_blueprint | JSONB | NOT NULL | |
| theme_preset | JSONB | NOT NULL | |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled, single **public** SELECT `USING (true)`; no user write policy (writes via service role). **Indexes:** `vertical`, `template_type`. **Trigger:** updated_at.

### `website_pages`

User pages; publishable to subdomain/custom domain. Sources: `…fixed` + `20260726_enhance_website_tables`, `…add_client_flow…`, `…add_website_language`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` | |
| page_type | TEXT | NOT NULL | |
| slug | TEXT | NOT NULL | |
| title | TEXT | NOT NULL | |
| meta_description | TEXT | | |
| seo_keywords | TEXT[] | `'{}'` | |
| published | BOOLEAN | `false` | legacy flag (coexists with `status`) |
| published_at | TIMESTAMPTZ | | |
| template_id | UUID | FK→`website_templates(id)` | |
| theme | JSONB | | |
| client_flow | JSONB | `'{"steps":["booking","confirmation"],"booking_url":"/booking"}'` | |
| website_language | TEXT | `'en'`, CHECK ∈ {en,es,he} | |
| subdomain | TEXT | **UNIQUE** | public hosting |
| custom_domain | TEXT | | |
| custom_domain_verified | BOOLEAN | `false` | |
| status | TEXT | `'draft'`, CHECK ∈ {draft,live,archived} | |
| last_published_at | TIMESTAMPTZ | | |
| favicon_url / og_image_url | TEXT | | |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |
| — | — | UNIQUE(user_id, slug) | |

- **Referenced by:** `website_blocks`, `website_page_views`.
- **RLS:** Enabled. Owner CRUD `auth.uid() = user_id`, **plus** public "view live pages by subdomain" `USING (status='live' AND subdomain IS NOT NULL)`. (Public policy uses `CREATE POLICY IF NOT EXISTS` — newer-Postgres syntax; verify it applied.)
- **Indexes:** `user_id`, `(user_id,slug)`, `published`, `page_type`, partial `subdomain`, partial `custom_domain`, `status`.
- **Repository:** `WebsitePageRepository` (user_id-scoped). **Functions:** `check_subdomain_available()`, `generate_subdomain()` (SECURITY DEFINER). **Trigger:** updated_at.

### `website_blocks`

Ordered content blocks on a page. **No `user_id`** — ownership derived via `page_id`. Sources: `…fixed` + `20260726_enhance_website_tables`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| page_id | UUID | NOT NULL, FK→`website_pages` ON DELETE CASCADE | |
| block_type | TEXT | NOT NULL | |
| position | INT | NOT NULL | |
| content | JSONB | NOT NULL | |
| styles | JSONB | | |
| enabled | BOOLEAN | `true` | |
| capability_config | JSONB | `'{}'` | service_ids/price_id etc. |
| created_at | TIMESTAMPTZ | `now()` | |
| — | — | UNIQUE(page_id, position) | |

- **RLS:** Enabled; owner policies via `EXISTS (… website_pages.user_id = auth.uid())`, **plus** public "view blocks of live pages" `USING (enabled AND page.status='live')`.
- **Indexes:** `page_id`, `(page_id,position)`, `block_type`, `(page_id,enabled)`.
- **Repository:** `WebsiteBlockRepository` — **scopes by `page_id`, not `user_id`** (relies on RLS + caller-supplied page ownership). See Observations.

### `website_content`

Central, template-independent section content. **1:1 with user** (`user_id UNIQUE`). Source: `20260726_create_website_content.sql`.

- **Columns:** `id` PK; `user_id` UUID NOT NULL **UNIQUE** FK→`auth.users`; ~20 JSONB section columns each with rich defaults — `hero, about, services, testimonials, faq, team, contact, process, features, stats, pricing, gallery, cta, newsletter, logo_cloud, video, booking_widget, payment_button, intake_form`; `created_at`/`updated_at`.
- **RLS:** Enabled; SELECT/INSERT/UPDATE user-scoped (no DELETE policy). **Index:** `user_id`. **Repository:** `WebsiteContentRepository`. **Trigger:** updated_at.

### `website_page_views`

Public-site view analytics. Source: `20260731_add_website_page_views.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| page_id | UUID | NOT NULL, FK→`website_pages` ON DELETE CASCADE | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | site owner |
| subdomain | TEXT | NOT NULL | |
| viewed_at | TIMESTAMPTZ | NOT NULL, `NOW()` | |
| user_agent / referer / ip_hash / country_code / device_type / session_id | TEXT | | ip_hash = privacy-safe hash |
| created_at | TIMESTAMPTZ | NOT NULL, `NOW()` | |

- **RLS:** Enabled. Owner SELECT `auth.uid() = user_id`; **INSERT `WITH CHECK (true)`** — any caller can insert view rows (public tracking endpoint). Intentional; validate inputs server-side.
- **Indexes:** `page_id`, `user_id`, `subdomain`, `viewed_at`, `ip_hash`, `(subdomain,viewed_at)`, `(user_id,viewed_at)`.
- **Also creates** VIEW `website_analytics_summary` (per-user/subdomain aggregates; `GRANT SELECT … TO authenticated`; no own RLS — reads the protected base table).
- **Repository:** `WebsiteAnalyticsRepository` (user_id-scoped).

---

## 5. Scheduling

### `scheduling_services`

Bookable service/appointment types. Sources: `20260722_create_scheduling_tables.sql` + `…add_status…`, `…add_payment_options…`. Enum `service_status` (draft/active/inactive). **Note:** `20260722_add_currency_to_scheduling_services.sql` is **corrupt** (a single byte `o`) — no `currency` column was added by it (see Observations).

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| service_name | TEXT | NOT NULL | |
| description | TEXT | | |
| duration_minutes | INT | NOT NULL | |
| price | DECIMAL(10,2) | nullable | |
| buffer_minutes | INT | `15` | |
| max_bookings_per_day | INT | | |
| advance_booking_days | INT | `30` | |
| min_notice_hours | INT | `24` | |
| availability | JSONB | `'{}'` | |
| is_active | BOOLEAN | `true` | superseded by `status` |
| status | service_status | NOT NULL, `'active'` | draft = AI-generated |
| source | TEXT | NOT NULL, `'manual'` | manual/ai_generated/template/imported |
| ai_suggestions | JSONB | | reasoning/confidence |
| payment_type | TEXT | `'full'`, CHECK ∈ {full,installments} | |
| installment_count | INTEGER | `1`, CHECK 1–24 | |
| installment_frequency | TEXT | `'monthly'`, CHECK ∈ {weekly,biweekly,monthly,quarterly} | |
| first_payment_due | TEXT | `'on_booking'`, CHECK ∈ {on_booking,days_after} | |
| first_payment_days | INTEGER | `0`, CHECK 0–365 | |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled; full CRUD user-scoped. **Indexes:** `user_id`, `is_active`, `status`, `source`. **Referenced by:** `scheduling_bookings`, `payment_plans`. **Repository:** `SchedulingRepository`. **Trigger:** updated_at.

### `scheduling_bookings`

Individual bookings; the cross-capability hub. Sources: `20260722_create_scheduling_tables.sql` + calendar-sync/payment/intake ALTERs.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| service_id | UUID | NOT NULL, FK→`scheduling_services` ON DELETE CASCADE | |
| contact_id | UUID | FK→`crm_contacts` ON DELETE SET NULL | |
| client_first_name | TEXT | NOT NULL | |
| client_last_name | TEXT | | |
| client_email | TEXT | NOT NULL | |
| client_phone | TEXT | | |
| start_time / end_time | TIMESTAMPTZ | NOT NULL | |
| timezone | TEXT | `'UTC'` | |
| status | TEXT | NOT NULL, `'confirmed'` | confirmed/cancelled/completed/no_show |
| cancellation_reason | TEXT | | |
| payment_status | TEXT | `'pending'` | pending/paid/refunded |
| payment_id | UUID | | soft link |
| notes / internal_notes | TEXT | | |
| booking_source | TEXT | `'manual'` | manual/widget/campaign |
| reminder_24hr_sent / reminder_2hr_sent | BOOLEAN | `false` | |
| external_calendar_event_id | TEXT | | Google/Outlook |
| calendar_sync_provider | TEXT | CHECK ∈ {google_calendar,outlook} or NULL | |
| calendar_synced_at | TIMESTAMPTZ | | |
| calendar_sync_error | TEXT | | |
| payment_method / payment_amount / payment_currency | TEXT / DECIMAL(10,2) / TEXT | | |
| invoice_id | UUID | FK→`payment_invoices` ON DELETE SET NULL (deferred) | |
| payment_plan_id | UUID | FK→`payment_plans` ON DELETE SET NULL (deferred) | |
| intake_responses | JSONB | | |
| intake_completed_at | TIMESTAMPTZ | | |
| created_at / updated_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled; full CRUD user-scoped (a public widget-INSERT policy exists only as a commented placeholder).
- **Indexes:** `user_id`, `service_id`, `contact_id`, `start_time`, `status`, `client_email`, partial `calendar_sync_error`, partial `external_calendar_event_id`.
- **Referenced by:** `payment_plan_installments`. **Repository:** `SchedulingRepository`.
- **Triggers:** updated_at; `create_crm_contact_from_booking_trigger` (AFTER INSERT — auto-creates/links `crm_contacts`; `20260728_skip_contact_for_pending_payment` makes it skip when `payment_status='pending'` and resolve the active-client stage from the user's pipeline); `log_booking_activity_trigger` (AFTER INSERT/UPDATE OF status).

### `scheduling_availability_exceptions`

Holidays / time-off / custom hours. Source: `20260722_create_scheduling_tables.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| exception_type | TEXT | NOT NULL | unavailable/custom_hours |
| start_date / end_date | DATE | NOT NULL | |
| custom_hours | JSONB | | |
| reason | TEXT | | |
| created_at | TIMESTAMPTZ | `now()` | |

- **RLS:** Enabled; full CRUD user-scoped. **Indexes:** `user_id`, `(start_date,end_date)`. **Repository:** `SchedulingRepository`.

### `external_calendar_events`

Mirror of Google/Outlook events to block availability. Source: `20260723_create_external_calendar_events.sql`.

| Column | Type | Constraints/Default | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | NOT NULL, FK→`auth.users` ON DELETE CASCADE | |
| external_event_id | TEXT | NOT NULL | |
| provider | TEXT | NOT NULL, CHECK ∈ {google_calendar,outlook} | |
| title | TEXT | | nullable for privacy |
| start_time / end_time | TIMESTAMPTZ | NOT NULL | |
| is_all_day | BOOLEAN | `FALSE` | |
| last_synced_at | TIMESTAMPTZ | `NOW()` | |
| created_at / updated_at | TIMESTAMPTZ | `NOW()` | |
| — | — | UNIQUE(user_id, external_event_id, provider) | |

- **RLS:** Enabled; owner CRUD `auth.uid() = user_id` **plus** a `FOR ALL` **service-role** policy (`auth.jwt()->>'role' = 'service_role'`) for the sync cron.
- **Indexes:** `(user_id,start_time,end_time)`, `end_time`, `(user_id,last_synced_at)`. **Repository:** `ExternalCalendarEventRepository`. **Trigger:** updated_at.

---

## 6. Payments

The largest domain — 12 tables. The four original tables (`20260722_create_payment_tables.sql`) use explicit per-command RLS policies; the eight `20260723_enhance_payments.sql` tables use a single `FOR ALL` policy. All scope on `auth.uid() = user_id`.

### `payment_invoices`

Invoices. Sources: `20260722_create_payment_tables.sql` + `20260723_enhance_payments`.

Key columns: `id` PK; `user_id` NOT NULL FK→auth.users ON DELETE CASCADE; `contact_id` FK→crm_contacts ON DELETE SET NULL; `invoice_number` NOT NULL; `amount` DECIMAL(10,2) NOT NULL; `currency` `'USD'`; `status` NOT NULL `'draft'` (draft/sent/paid/overdue/cancelled); `line_items` JSONB `'[]'`; `due_date` DATE; `payment_terms` `'Due upon receipt'`; `notes`/`internal_notes`; `sent_at`/`paid_at`; enhance-added: `payment_method`, `payment_received_at`, `payment_notes`, `processor_type`, `processor_checkout_id`, `processor_payment_id`, `processor_customer_id`, `processor_payment_method_id`, `retry_count` INT `0`, `last_retry_at`, `next_retry_at`; `created_at`/`updated_at`; **UNIQUE(user_id, invoice_number)**.

- RLS enabled, full CRUD user-scoped. Indexes: `user_id`, `contact_id`, `status`, `invoice_number`, `due_date`, partial `next_retry_at`. **Referenced by:** `scheduling_bookings.invoice_id`, `payment_reminders`. Repository: `PaymentRepository`. Trigger: updated_at.

### `payment_transactions`

Actual charges/refunds. Sources: same two files.

Key columns: `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `contact_id` FK→crm_contacts ON DELETE SET NULL; `stripe_payment_intent_id` **UNIQUE**; `stripe_charge_id`; `stripe_customer_id`; `amount` NOT NULL; `currency` `'USD'`; `status` NOT NULL `'pending'` (pending/succeeded/failed/refunded); `payment_method`; `description`; `invoice_id` FK→payment_invoices ON DELETE SET NULL; `metadata` JSONB `'{}'`; `failure_reason`; `paid_at`; enhance-added: `refund_status` `'none'`, `refunded_amount` DECIMAL `0`, `refunded_at`, `refund_reason`, `processor_refund_id`, `processor_type`; `created_at`/`updated_at`.

- RLS enabled, full CRUD user-scoped. Indexes: `user_id`, `contact_id`, `invoice_id`, `status`, `stripe_intent`, `created_at`. **Referenced by:** `payment_plan_installments.transaction_id`. Repository: `PaymentRepository`. Triggers: updated_at; `log_payment_activity` (logs `payment` activity on success); `update_invoice_on_payment` (marks linked invoice paid).

### `payment_methods`

Stripe saved cards (legacy/Stripe-specific). Source: `20260722_create_payment_tables.sql`. `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `stripe_customer_id` NOT NULL; `stripe_payment_method_id` NOT NULL **UNIQUE**; `type` NOT NULL; `card_brand`/`card_last4`/`card_exp_month`/`card_exp_year`; `is_default` `false`; `is_active` `true`; `created_at`. RLS enabled, full CRUD user-scoped. Repository: `PaymentRepository`.

### `stripe_connect_accounts`

Stripe Connect onboarding. **1:1 with user** (`user_id UNIQUE`). Source: `20260722_create_payment_tables.sql`. `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE **UNIQUE**; `stripe_account_id` NOT NULL **UNIQUE**; `stripe_account_type` `'express'`; `charges_enabled`/`payouts_enabled`/`details_submitted`/`onboarding_completed` BOOL `false`; `country`; `currency` `'USD'`; `business_type`; `created_at`/`updated_at`. RLS enabled, user-scoped. Repository: `PaymentRepository`. Trigger: updated_at.

### `payment_processors`

Multi-processor connections (Stripe/PayPal/Square/manual). Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK (no CASCADE); `processor_type` NOT NULL; `is_active` `true`; `is_default` `false`; `credentials` JSONB `'{}'`; capability flags `supports_*`; `connection_status` `'pending'`; `last_verified_at`; timestamps; **UNIQUE(user_id, processor_type)**. RLS enabled, single `FOR ALL` user-scoped.

### `payment_plans`

Installment plan templates. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `service_id` FK→scheduling_services ON DELETE SET NULL; `name` NOT NULL; `total_amount` NOT NULL; `currency` NOT NULL `'USD'`; `supported_currencies` TEXT[] `'{"USD"}'`; `installment_count` INT NOT NULL `1`; `installment_amount` NOT NULL; `installment_frequency` NOT NULL `'monthly'`; `allowed_processors` TEXT[]; `preferred_processor`; `is_active` `true`; timestamps. RLS `FOR ALL` user-scoped. **Referenced by:** `scheduling_bookings.payment_plan_id`, `payment_plan_installments`. Repository: `PaymentPlanRepository`.

### `payment_plan_installments`

Individual installments. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `payment_plan_id` NOT NULL FK→payment_plans ON DELETE CASCADE; `booking_id` FK→scheduling_bookings ON DELETE SET NULL; `contact_id` FK→crm_contacts ON DELETE SET NULL; `installment_number` NOT NULL; `amount` NOT NULL; `currency` NOT NULL; `due_date` DATE NOT NULL; `status` NOT NULL `'pending'` (pending/paid/overdue/cancelled); `paid_at`; `payment_method`; `processor_type`; `transaction_id` FK→payment_transactions ON DELETE SET NULL; `retry_count` `0`; `last_retry_at`/`next_retry_at`; timestamps. RLS `FOR ALL` user-scoped. **Referenced by:** `payment_reminders.installment_id`. Repository: `PaymentPlanRepository`. Also: SECURITY DEFINER `update_overdue_installments()` (cron helper).

### `payment_events`

Payment event log for AI. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `event_type` NOT NULL; `entity_type` NOT NULL; `entity_id` UUID NOT NULL; `contact_id` FK→crm_contacts ON DELETE SET NULL; `processor_type`; `metadata` JSONB `'{}'`; `created_at`. RLS `FOR ALL` user-scoped.

### `payment_automation_rules`

User-configurable triggers→actions. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `name` NOT NULL; `is_active` `true`; `trigger_event` NOT NULL; `trigger_conditions` JSONB `'{}'`; `action_block` NOT NULL; `action_parameters` JSONB `'{}'`; `delay_minutes` `0`; `max_executions_per_entity`; `cooldown_hours`; `processor_filter` TEXT[]; `execution_count` `0`; `last_executed_at`; timestamps. RLS `FOR ALL` user-scoped. **Referenced by:** `payment_automation_executions`.

### `payment_automation_executions`

Rule execution history. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `rule_id` NOT NULL FK→payment_automation_rules ON DELETE CASCADE; `entity_type`/`entity_id` NOT NULL; `processor_type`; `status` NOT NULL `'pending'`; `scheduled_at`/`executed_at`; `result` JSONB; `error_message`; `created_at`. RLS `FOR ALL` user-scoped.

### `payment_reminders`

Scheduled/sent reminders. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `invoice_id` FK→payment_invoices ON DELETE CASCADE; `installment_id` FK→payment_plan_installments ON DELETE CASCADE; `contact_id` FK→crm_contacts ON DELETE SET NULL; `reminder_type` NOT NULL; `scheduled_at` NOT NULL; `sent_at`; `channel` NOT NULL `'email'`; `template_id`; `status` NOT NULL `'pending'`; `metadata` JSONB `'{}'`; `error_message`; `created_at`. RLS `FOR ALL` user-scoped.

### `saved_payment_methods`

Processor-agnostic saved methods per contact. Source: `20260723_enhance_payments.sql`. `id` PK; `user_id` NOT NULL FK; `contact_id` FK→crm_contacts ON DELETE CASCADE; `processor_type` NOT NULL; `processor_customer_id` NOT NULL; `processor_method_id` NOT NULL; `method_type` NOT NULL; `last_four`/`brand`/`expiry_month`/`expiry_year`; `is_default` `false`; `is_valid` `true`; timestamps. RLS `FOR ALL` user-scoped.

---

## 7. Email Automation

All six tables from `20260722_create_email_automation_tables.sql`. RLS enabled, per-command CRUD `auth.uid() = user_id`. Repository: `EmailAutomationRepository` (user_id-scoped).

- **`email_sequences`** — `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `name` NOT NULL; `description`; `trigger_type` NOT NULL; `trigger_config` JSONB `'{}'`; `is_active` `true`; stats `total_sent/opened/clicked` `0`; timestamps. Trigger: updated_at.
- **`email_sequence_steps`** — `id` PK; `sequence_id` NOT NULL FK ON DELETE CASCADE; `user_id` NOT NULL FK ON DELETE CASCADE; `step_number` NOT NULL; `delay_minutes` NOT NULL `0`; `subject` NOT NULL; `body_html` NOT NULL; `body_text`; stats; `created_at`; **UNIQUE(sequence_id, step_number)**.
- **`email_campaigns`** — `id` PK; `user_id` NOT NULL FK; `name`/`subject`/`body_html` NOT NULL; `body_text`; `segment_filter` JSONB `'{}'`; `status` `'draft'`; `scheduled_at`/`sent_at`; stats `recipients/sent/opened/clicked/failed_count`; timestamps. Trigger: updated_at.
- **`email_sends`** — `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `contact_id` NOT NULL FK→crm_contacts ON DELETE CASCADE; `sequence_id`/`sequence_step_id`/`campaign_id` FK ON DELETE SET NULL; `subject`/`body_html`/`to_email` NOT NULL; `status` `'pending'`; timestamps `sent/delivered/opened/clicked_at`; `provider` `'sendgrid'`; `provider_message_id`; `error_message`; `open_count`/`click_count` `0`; `created_at`. **Trigger:** `log_email_activity` → logs `email` activity on send.
- **`email_unsubscribes`** — `id` PK; `user_id` NOT NULL FK; `contact_id` FK ON DELETE SET NULL; `email` NOT NULL; `reason`; `unsubscribed_at`; **UNIQUE(user_id, email)**. (SELECT/INSERT/DELETE only — no UPDATE policy.)
- **`email_sequence_enrollments`** — `id` PK; `user_id` NOT NULL FK; `sequence_id` NOT NULL FK ON DELETE CASCADE; `contact_id` NOT NULL FK→crm_contacts ON DELETE CASCADE; `status` `'active'`; `current_step_number` `0`; `next_send_at`; `enrolled_at`/`completed_at`; **UNIQUE(sequence_id, contact_id)**.

---

## 8. Intake / Forms

From `20260728_create_intake_tables.sql` (+ `seed_intake_templates.sql`).

### `intake_form_templates`

System template catalog. **No `user_id` — global. RLS NOT enabled.** `id` PK; `template_key` NOT NULL **UNIQUE**; `vertical` NOT NULL; multilingual `name_en/es/he` NOT NULL + `description_en/es/he`; `fields` JSONB NOT NULL `'[]'`; `is_default` `false`; `display_order` `0`; `created_at`. Index: `vertical`. Read via `IntakeRepository`. **Referenced by:** `user_intake_settings.template_id`.

### `user_intake_settings`

Per-user intake config. **1:1 with user** (`user_id UNIQUE`). `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE **UNIQUE**; `template_id` FK→intake_form_templates; `is_enabled` `false`; `collect_during_booking` `true`; `send_after_booking` `false`; timestamps. RLS enabled, full CRUD user-scoped. Index: `user_id`. Repository: `IntakeRepository`. Trigger: updated_at. (Also adds `intake_responses`/`intake_completed_at` to `scheduling_bookings`.)

---

## 9. Onboarding

### `onboarding_conversations`

Append-only onboarding chat transcript. Source: `20260721_create_onboarding_conversations.sql`. `id` PK; `user_id` NOT NULL FK→auth.users; `message_sequence` INT NOT NULL; `role` NOT NULL (system/user/assistant); `content` NOT NULL; `metadata` JSONB; `created_at`.

- **RLS:** Enabled; **SELECT + INSERT only** (`auth.uid() = user_id`) — append-only; no UPDATE/DELETE. Indexes: `user_id`, `(user_id,message_sequence)`, `created_at`. Repository: `OnboardingConversationRepository`.

---

## 10. Command / Chat Sessions

### `command_sessions`

Stateful deterministic chat-command state machine. Source: `20260731_add_command_sessions.sql`. `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `capability_id` TEXT NOT NULL; `status` NOT NULL `'gathering_params'` CHECK ∈ {gathering_params, awaiting_confirmation, awaiting_choice, executing, completed, cancelled, failed}; `resolved_params` JSONB NOT NULL `'{}'`; `pending_params` TEXT[] NOT NULL `'{}'`; `entity_context` JSONB; `pending_choices` JSONB; `created_at`/`updated_at` NOT NULL; `expires_at` NOT NULL `NOW()+10min`; `last_user_message`/`last_assistant_response`.

- **RLS:** Enabled, single `FOR ALL` `auth.uid() = user_id`. Indexes: partial `(user_id,status) WHERE status NOT IN (completed,cancelled,failed)`; `expires_at`. **Repository:** `lib/business-os/chat/CommandSessionRepository.ts` (user_id-scoped). Trigger: updated_at.

---

## 11. Capabilities / Building-Blocks

From `20260722_create_capability_building_blocks.sql`.

### `capabilities`

Global capability catalog. **No `user_id`. RLS NOT enabled.** `id` PK; `capability_key` NOT NULL **UNIQUE**; multilingual `name_en/es/he` NOT NULL + `description_*`; `category` NOT NULL (system/ai_assistant); `icon` NOT NULL; `color`; `verticals` TEXT[] `'{}'`; `is_core` `false`; `created_at`. Seeded with crm/scheduling/payments/email_automation. Indexes: `capability_key`, `category`.

### `capability_building_blocks`

Global block catalog. **No `user_id`. RLS NOT enabled.** `id` PK; `capability_id` NOT NULL FK→capabilities ON DELETE CASCADE; `block_key` NOT NULL; multilingual names/descriptions; `is_core` `false`; `is_recommended` `true`; `activation_conditions` JSONB `'{}'`; `provides` JSONB `'{}'`; `depends_on_blocks` UUID[]; `position` `0`; `created_at`; **UNIQUE(capability_id, block_key)**. Seeded with CRM + scheduling blocks. Indexes: `capability_id`, `is_core`, `is_recommended`.

### `user_capabilities`

Which capabilities a user activated. `id` PK; `user_id` NOT NULL FK ON DELETE CASCADE; `capability_id` NOT NULL FK→capabilities ON DELETE CASCADE; `activated_at`; `activation_source` `'onboarding'`; `configuration` JSONB `'{}'`; `is_active` `true`; timestamps; **UNIQUE(user_id, capability_id)**. RLS enabled, full CRUD user-scoped. Repository: `UserCapabilityRepository`. Trigger: updated_at.

### `user_capability_blocks`

Which blocks a user activated. **No `user_id` column.** `id` PK; `user_capability_id` NOT NULL FK→user_capabilities ON DELETE CASCADE; `building_block_id` NOT NULL FK→capability_building_blocks ON DELETE CASCADE; `activated_at`; `activation_reason`; `configuration` JSONB `'{}'`; `is_active` `true`; `created_at`; **UNIQUE(user_capability_id, building_block_id)**. RLS enabled; policies scope **indirectly** via `EXISTS (… user_capabilities.user_id = auth.uid())`.

---

## 12. Relationships Overview

- **`auth.users`** is the root. `business_profiles`, `website_content`, `stripe_connect_accounts`, `user_intake_settings` are each **1:1** with the user (`user_id UNIQUE`).
- **`crm_contacts`** is the CRM hub — referenced by `crm_activities` (CASCADE), `crm_tasks` (SET NULL), `contact_documents` (CASCADE), `scheduling_bookings` (SET NULL), `payment_invoices`/`payment_transactions`/`payment_plan_installments`/`payment_events`/`payment_reminders`/`saved_payment_methods` (SET NULL or CASCADE), `email_sends`/`email_unsubscribes`/`email_sequence_enrollments`.
- **`crm_pipeline_stages.stage_key`** ← `crm_contacts.stage` as a **soft reference (no FK)** — enforced only by triggers/migration logic.
- **Scheduling:** `scheduling_services` ← `scheduling_bookings` (CASCADE) and ← `payment_plans` (SET NULL). `scheduling_bookings` ← `payment_plan_installments` (SET NULL); `scheduling_bookings` → `payment_invoices` and `payment_plans` (deferred FKs, SET NULL). `external_calendar_events` stands alone under the user.
- **Payments:** `payment_invoices` ← `payment_transactions`, `payment_reminders`; `payment_plans` ← `payment_plan_installments` (CASCADE) ← `payment_reminders`; `payment_transactions` ← `payment_plan_installments` (SET NULL); `payment_automation_rules` ← `payment_automation_executions` (CASCADE).
- **Website:** `website_templates` ← `website_pages` ← `website_blocks` (CASCADE) and ← `website_page_views` (CASCADE).
- **Email:** `email_sequences` ← `email_sequence_steps` (CASCADE), `email_sequence_enrollments`, `email_sends`; `email_campaigns` ← `email_sends`.
- **Capabilities:** `capabilities` ← `capability_building_blocks` (CASCADE) and ← `user_capabilities` (CASCADE) ← `user_capability_blocks` (CASCADE, also FK→`capability_building_blocks`).
- **Intake:** `intake_form_templates` ← `user_intake_settings`.

**Cross-capability trigger web** (behavior, not FKs): booking INSERT → creates/links `crm_contacts` + logs `crm_activities`; payment `succeeded` → logs activity + flips `payment_invoices` to paid; email `sent` → logs activity; task completed → logs activity; document upload → logs activity; contact INSERT → logs `contact_created`; contact DELETE → deletes future `scheduling_bookings`.

---

## 13. Data-Model Observations & Risks

Relevant for the shared-DB monorepo migration and for general hygiene. Severity: 🔴 high · 🟡 medium · 🟢 note.

| # | Severity | Observation |
|---|---|---|
| 1 | 🟢 | **No references to kernel/`agents` tables.** Every Business OS table roots at `auth.users` — cleanly separable from the V6/kernel schema. Confirms the shared-DB decision. |
| 2 | 🔴 | **Corrupt migration.** `20260722_add_currency_to_scheduling_services.sql` contains a single byte `o` — so `scheduling_services` never received a `currency` column via this path. Any code reading `scheduling_services.currency` will fail. Needs cleanup/replacement. |
| 3 | 🟡 | **`WebsiteBlockRepository` filters by `page_id` only (no `user_id`)** — relies on RLS + callers passing an owned `pageId`. Tension with the platform's mandatory "always `.eq('user_id', …)`" rule. Review. |
| 4 | 🟡 | **Duplicate/superseded migrations.** (a) `20260721_create_crm_tables` vs `20260722_create_crm_tables` — near-identical; 20260721 wins; redundant duplicate RLS policies likely coexist. (b) `website_tables` vs `website_tables_fixed` — the non-fixed file has a real FK-ordering bug; remove it. |
| 5 | 🟡 | **Global tables with RLS OFF:** `capabilities`, `capability_building_blocks`, `intake_form_templates` never `ENABLE ROW LEVEL SECURITY`. Seed/catalog data — safe to read, but writable by anyone with table grants in a shared DB. Lock writes to service role. |
| 6 | 🟡 | **Open INSERT policy:** `website_page_views` uses `WITH CHECK (true)` (public tracking) — any caller can insert view rows for any `user_id`/`page_id`. Validate server-side. |
| 7 | 🟡 | **External function dependency.** `contact_documents`' updated_at trigger calls `update_updated_at_column()`, **not defined in these migrations**. A clean replay of only the Business OS migrations fails unless that shared function pre-exists. |
| 8 | 🟢 | **RLS style inconsistency.** Original payment/CRM tables use per-command policies; the July-23 payment tables + `command_sessions` + `payment_processors` use a single `FOR ALL`. Both correct and user-scoped; inconsistency makes audits harder. |
| 9 | 🟢 | **Partial-policy / append-only tables:** `onboarding_conversations` (SELECT+INSERT only), `website_content`/`business_profiles` (no DELETE), `email_unsubscribes` (no UPDATE). Intentional immutability; deletes fall to service role. |
| 10 | 🟡 | **`CREATE POLICY IF NOT EXISTS`** in `20260726_enhance_website_tables.sql` for public page/block policies — valid only on newer Postgres. Verify it applied, else live public-site reads silently lack their RLS policy. |
| 11 | 🟢 | **Service-role coupling.** `external_calendar_events` (sync cron) and `website_page_views` (public tracking) add non-user policies. Any DB split must carry the service-role identity/JWT-claim setup. |
| 12 | 🟢 | **`business_profiles` is the natural per-tenant anchor** (1:1 with user, holds calendar-sync + payment-retry + process-steps settings). If Business OS data ever moved to a separate DB, this is the tenant row. |

---

## 14. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-04 | Initial catalog | Documented the 42 Business OS tables + 1 view + 2 storage buckets introduced by PR #10 (`7c9801d`) + `06086dc`. Grouped by 10 capability domains with columns, RLS, FKs, triggers, indexes, and owning repositories. Added relationships overview and a 12-item observations/risk register (incl. one corrupt migration, duplicate migrations, RLS-off global tables, and a repository lacking `user_id` scoping). Excludes the `20260629_*` kernel/V6-learning tables that shipped in the same PR. |
