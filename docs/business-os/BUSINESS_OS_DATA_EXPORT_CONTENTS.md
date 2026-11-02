# Business OS Data Export — Contents and Delivery

> **Last Updated**: 2026-11-02

## Overview

This is the reference for **exactly what "Export data" sends and how it is sent**, written from the code (`lib/business-os/data-export/`, the purge descriptors, the owner route, the worker and its cron, `lib/audit/events.ts`). **The code is the source of truth**; where this page and the code disagree, the code wins and this page is stale. The decisions behind each choice live in [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (the module export: MX-n, XC-n, BQ-n) and, for what each table and column holds, [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §0.2–§0.15 (BC-n, SA-Qn, DX-n); this page cites them by id.

The owner ticks **modules** in the export drawer. Each module becomes **one joined CSV** in the owner's language, cut into parts of at most 7,000,000 bytes; **each part arrives as its own email**, with the CSV attached, at the account's **login email**. Nothing downloads in the browser, and documents and pictures are not exported. A background worker, run by a cron every 5 minutes, builds and sends the modules.

The ZIP export ("Download my data": one zip with `data.json`, a README, the CSVs and the files, behind a signed link) was **retired in MX-3.1 (#574)**: its code, routes, bucket objects and daily sweep are gone. Its old job rows stay in `business_os_data_exports` until MX-7 drops that table. The ZIP-era version of this page (zip layout, file name, `data.json`, README, buckets, signed URLs, sweep cron) is in git history: `git show 4a6c22f8:docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md`.

---

## Table of Contents

- [1. Where the code lives](#1-where-the-code-lives)
- [2. Modules](#2-modules)
- [3. The module CSV](#3-the-module-csv)
- [4. Lookups](#4-lookups)
- [5. Every section, by module](#5-every-section-by-module)
- [6. Every table not exported](#6-every-table-not-exported)
- [7. Files are not exported](#7-files-are-not-exported)
- [8. Parts and sizes](#8-parts-and-sizes)
- [9. Delivery](#9-delivery)
- [10. Audit events](#10-audit-events)
- [11. How to change it](#11-how-to-change-it)
- [Change History](#change-history)

---

## 1. Where the code lives

| File | Owns |
|---|---|
| `lib/business-os/purge/descriptors.ts` | **What may be exported.** Every table descriptor's required `export` field: `include` (section, explicit `columns`, `excludedColumns` with reasons, optional `rowFilter` / `rowKey` / `viaParent`) or `exclude` (reason). Reason constants `EXPORT_REASON` and `EXPORT_COLUMN_REASON`. `STORAGE_DESCRIPTORS` still carries a bucket classification, checked by CI only; nothing exports files (§7) |
| `lib/business-os/data-export/classificationTypes.ts` | `ExportSectionId` (every section id), the classification types, `NON_TABLE_SECTIONS` |
| `lib/business-os/data-export/classification.ts` | Reading the classification: `exportColumnsOf`, `exportDescriptorOfSection`, the secret-column deny list (§11.3), the CI rule functions, `exportColumnDrift` / `exportColumnsMissing` |
| `lib/business-os/data-export/sections.ts` | The section registry `EXPORT_SECTIONS` (order, group, GDPR role), the row mappers and jsonb allow-lists, `runExportSections` (row ceiling) |
| `lib/repositories/BusinessDataExportRepository.ts` | The one read path for table sections (`listOwnedRowsForExport`): first filter `.eq('user_id', userId)`, keyset paging on `id` ascending (`PAGE_SIZE` 1,000, ends on an empty page), the `rowKey` single-row read and the `viaParent` read |
| `lib/business-os/data-export/exportModules.ts` | **The module map** `EXPORT_MODULES`: 13 modules, their sections, names (en / he / es) and the `on` switch; helpers `enabledModules`, `isModuleEnabled`, `sectionsOfModule`; the CI rule `exportModuleProblems` (R-1…R-9) |
| `lib/business-os/data-export/exportModuleSchema.ts` | Zod: `ExportModuleIdSchema`, `requestedModulesSchema` (what a request may ask for) |
| `lib/business-os/data-export/joinedCsv.ts` | The module CSV builder `buildJoinedCsv`, `classifiedColumnsOf`, `lookupSectionsFor`, `lookupTargetAvailable` |
| `lib/business-os/data-export/joinedCsvReferences.ts` | Which ids become labels: `LOOKUP_TARGETS`, `COLUMN_REFERENCES`, `PARENT_REFERENCES`, `STAYS_ID`; the CI rule `joinedReferenceProblems` (J-1…J-7) |
| `lib/business-os/data-export/columnLabels.ts` | The header words in en / he / es: `FIXED_COLUMN_LABELS`, `RECORD_TYPE_LABELS`, `COLUMN_LABELS_BY_KEY`, `SECTION_COLUMN_LABELS`, `EXPORT_COLUMN_LABELS`; the CI rule `columnLabelProblems` (L-1…L-9). Server-only |
| `lib/business-os/data-export/csv.ts` | CSV encoding (`csvLine`, `csvHeaderLine`, `csvPartText`) |
| `lib/business-os/data-export/csvParts.ts` | Cutting a module CSV into email parts (`cutCsvParts`) |
| `lib/business-os/data-export/moduleExportSending.ts` | The worker's numbers (part size, parts per module, send gap, tries, timeouts, claim cutoff), the idempotency keys, the frozen send payloads, `classifyKeyedSend`, the failure and retry codes |
| `lib/business-os/data-export/moduleExportPolicy.ts` | The request and job rules mirrored from the database (`MODULE_EXPORT_POLICY`), the status words |
| `lib/business-os/data-export/moduleExportEmails.ts` | The part email, the failure notices, the attachment name `partFileName` |
| `lib/business-os/data-export/exportRequestedEmail.ts` | The "Export requested" email and `formatRequestedAt` |
| `lib/business-os/data-export/moduleExportWorker.ts` · `moduleExportWorkerDeps.ts` | The worker run (`runModuleExportWorker`) and its production wiring |
| `lib/business-os/data-export/exportHistory.ts` | The history the drawer shows (`assembleExportHistory`) |
| `lib/business-os/data-export/nextOwnerExportAt.ts` | MX-4b: "you can export again at" on open (a hint; the start function decides) |
| `lib/business-os/data-export/exportHistoryCursor.ts` | MX-4b: history page size (`HISTORY_PAGE_SIZE` 20) and the "Show older" cursor rules (strict Zod; the timestamp is passed back exactly as the database returned it) |
| `lib/business-os/data-export/ownerClock.ts` | The owner's timezone (`user_preferences.timezone`, NULL / invalid → UTC) |
| `lib/business-os/data-export/limits.ts` | `EXPORT_LIMITS`: `ROW_CEILING` 100,000, `PAGE_SIZE` 1,000, `VIA_PARENT_CHUNK` 100 |
| `lib/business-os/data-export/jobPolicy.ts` | The old ZIP table's rules (`EXPORT_JOB_POLICY`), kept for its rows until MX-7 |
| `lib/repositories/BusinessOsExportRequestRepository.ts` · `BusinessOsExportModuleJobRepository.ts` | The two export tables: start, history reads, claim, reap and the compare-and-set job writes |
| `supabase/migrations/20261095_business_os_export_requests.sql` | The two tables, the start function `business_os_export_request_start` and the claim / reap functions (the limits are SQL literals here) |
| `app/api/business-os/export-requests/route.ts` | Owner: `POST` start an export, `GET` the history |
| `app/api/cron/data-export-modules/route.ts` | The worker cron, `*/5 * * * *` (`vercel.json`) |
| `lib/client/businessOsDataExport.ts` | The browser seam: the only client file that names the route |
| `components/business-os/data-export/` | The entry button (`DownloadMyDataButton`, `ModuleExportEntry`), the drawer (`ExportDrawer`, `useExportDrawer`, `exportDrawerCopy`) |
| `lib/audit/events.ts` · `eventAudience.ts` · `ownerEventPresentation.ts` | The audit events, their audience and the owner's labels for them (§10) |

---

## 2. Modules

`EXPORT_MODULES` in `exportModules.ts`, in drawer order. A module is a **product label**, not a privacy decision: whether a table may be exported at all is its descriptor's `export` field (§5, §6). The map can only take away what the classification allows; the CI rule refuses a section that no `include` descriptor backs.

| # | Id | Name (en) | Sections, in CSV order | On |
|---|---|---|---|---|
| 1 | `clients` | Clients | `clients`, `pipeline_stages`, `client_documents` | ✅ on |
| 2 | `activities_tasks` | Activities & tasks | `client_activities`, `client_tasks` | ✅ on |
| 3 | `bookings` | Bookings | `bookings`, `time_off` | off |
| 4 | `services` | Services | `services` | off |
| 5 | `quotes` | Quotes | `quotes` | ✅ on |
| 6 | `invoices_payments` | Invoices & payments | `invoices`, `payments`, `refunds`, `client_payment_methods` | ✅ on |
| 7 | `payment_plans` | Payment plans | `payment_plans`, `client_payment_plans`, `installments` | off |
| 8 | `forms` | Forms | `intake_settings`, `intake_forms` | off |
| 9 | `email_campaigns` | Email campaigns | `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` | off |
| 10 | `newsletter_subscribers` | Newsletter subscribers | `newsletter_subscribers`, `consent_records`, `consent_settings`, `email_unsubscribes` | off |
| 11 | `website` | Website | `website_content`, `website_pages`, `website_blocks`, `images` | off |
| 12 | `smart_links` | Smart links | `smart_links` | off |
| 13 | `account_business` | Account & business details | `account_identity`, `user_profile`, `preferences`, `notification_settings`, `business_profile`, `business_addresses`, `payment_account`, `payment_providers` | ✅ on |

**5 on, 8 off** (user decision 2026-10-31, BQ-27 re-answered; pinned by `exportModules.test.ts` "the shipped switches", so a switch flipped by accident fails CI). Each off module is switched back on by a **one-line edit** of its `on` in `exportModules.ts`, then a deploy: no helper takes a switch from a request, a query, a body or an environment variable.

What **off** means:

| Where | What happens |
|---|---|
| Drawer | Not offered (`enabledModules()`) |
| `POST /api/business-os/export-requests` | A request naming it is a 400 `invalid_input` (`requestedModulesSchema`: every module must be on) |
| Worker | A stored job for it (started while it was on) is failed **before any section read**, `failure_code` `module_switched_off` (an id not in the map: `module_unknown`), and its owner gets the "not available" notice (D-7) |
| Other modules' CSVs | **Not affected.** Its sections still give labels to other modules (§4): a service name still shows in a quote with Services off. To hide them, exclude the section in the classification |

Module ids are **durable**: they are stored in job rows, audit `details.modules` and attachment names. Renaming one after rows exist is a data change that needs SA (pinned by `exportModules.test.ts` T-8).

---

## 3. The module CSV

`buildJoinedCsv` in `joinedCsv.ts`, one per module job. Every module CSV has the same shape (BQ-26):

| # | Column | Content |
|---|---|---|
| 1 | Record type | The section's singular name in the owner's language (`RECORD_TYPE_LABELS`, e.g. "Client", "Document") |
| 2 | Belongs to | The label of the row's parent record (§4), else its raw id; blank for a top-level row |
| 3 … | The union of the sections' columns | Every include column of the module's sections, in module section order; a key that appears in two sections is **one** column (headed by the section where it first appears), blank where a record type lacks it. `id` is never here; a section's parent column leaves the union unless another section of the module has the same key as an ordinary column |
| last − 1 | Record ID | The row's `id` (blank for a section with no `id`: `consent_settings`) |
| last | Parent ID | The raw value of the parent column (the id the "Belongs to" label came from) |

| Rule | As built |
|---|---|
| Rows | Section by section in module section order; inside a section in the order read: `id` ascending (the keyset reader; `website_blocks` re-sorted by `id` in code-unit order), not date order. A section with no rows writes no line |
| Header language | The owner's `user_preferences` preferred language (en / he / es; unreadable → en). Fallback per label: that language, then English, then the raw key. Spanish is a draft. CI (L-1…L-9) keeps every real column out of the fallback |
| Values | **Never translated** (BQ-31, user 2026-10-28): status codes, stage keys, `true` / `false` and every cell are written as stored. Only the headers, the record types and the looked-up labels are text the export chooses |
| Encoding (`csv.ts`) | UTF-8 with a BOM on **every part**; CRLF line ends (RFC 4180), after the last row too |
| Quoting | A cell is quoted when it holds `,` `"` CR or LF, or begins or ends with a space; `"` is doubled. Header cells follow the same rule |
| NULL / undefined | Empty cell |
| Numbers | `String(n)`, **never** neutralised (so `-5` stays a number); a non-finite number is an empty cell; `bigint` → its decimal text |
| Booleans | `true` / `false` |
| jsonb objects and arrays | `JSON.stringify` text in **one** cell; an unserialisable value is empty |
| Formula injection (DE-8b BC-1, OWASP) | A **string** cell (and every header label) whose first character is `=` `+` `-` `@` TAB or CR gets a leading apostrophe `'`. Applied after JSON conversion and before quoting. Nothing keeps the un-prefixed value (`data.json` left with the ZIP) |
| Columns | Exactly the classification's include columns (`classifiedColumnsOf`): `exportColumnsOf(table)`, or `id, email, created_at` for `account_identity`. A row key outside them is never written |
| Fail closed | An unknown module or missing labels throws; a classification error on one of the module's **own** sections propagates (that module fails, it is never written with a guessed column list) |

---

## 4. Lookups

Some id columns are written as a **readable label** instead of the id (XC-10). The lists in `joinedCsvReferences.ts` are the whole rule: nothing is inferred from a column ending in `_id`, and CI rule J-7 fails on an include `_id` column that is neither a reference, a parent, nor in `STAYS_ID`.

### 4.1 Targets

| Target | Section | Matched on | Label |
|---|---|---|---|
| `client` | `clients` | `id` | "First Last (email)"; name only → "First Last"; email only → email (`first_name`, `last_name`, `email`) |
| `service` | `services` | `id` | `service_name` |
| `stage` | `pipeline_stages` | `stage_key` | `stage_label` |
| `invoice` | `invoices` | `id` | `invoice_number` |
| `payment_plan` | `payment_plans` | `id` | `name` |
| `email_sequence` | `email_sequences` | `id` | `name` |
| `website_page` | `website_pages` | `id` | `title`, else `slug` |
| `quote` | `quotes` | `id` | `title` |

A reference may reach outside its module **only** to `clients`, `services` or `pipeline_stages` (`CROSS_MODULE_TARGET_SECTIONS`, J-3); anything else stays the id.

### 4.2 Two kinds of reference

| Kind | List | Where the label goes | Raw id kept? |
|---|---|---|---|
| In place | `COLUMN_REFERENCES` | The column itself holds the label instead of the id | No |
| Parent | `PARENT_REFERENCES` (at most one per section, J-4) | "Belongs to" | Yes, in Parent ID |

Per section, both are listed in §5 ("Belongs to", "Labels in place").

### 4.3 When the id is kept

The raw value is written, never a guess, when: the reference is not found; the label is empty; the key appears twice in the target rows (ambiguous); the target section is not classified exportable; a target's key or label column is not among its include columns; or the lookup read failed or passed its row ceiling (logged as `lookup_unreadable`; the module is still sent).

### 4.4 Lookups do not depend on the module switch

`lookupSectionsFor(moduleId)` returns the sections **outside** the module that the worker must read for labels: the targets the module's references use, minus targets inside the module, minus targets that are not classified exportable. **The module map does not decide this** (SA Option A, PR #596; user decision 2026-10-31): `lookupTargetAvailable` asks only the classification, so service names appear in quotes, invoices and payments even with the Services module off. Ticks in the request do not matter either.

The worker reads the lookup sections through the same classified reader, after the module's own sections, with a row ceiling of their own (100,000). Lookup rows are reduced to `key → label` maps from the declared label columns only; no other lookup cell reaches the file.

| Module | Lookup sections read |
|---|---|
| `clients` | none (stage and client labels come from its own sections) |
| `activities_tasks` | `clients` |
| `quotes` | `clients`, `services` |
| `invoices_payments` | `clients`, `services` |
| `account_business` | none |
| Off: `bookings`, `payment_plans` | `clients`, `services` |
| Off: `email_campaigns`, `newsletter_subscribers` | `clients` |
| Off: `services`, `forms`, `website`, `smart_links` | none |

### 4.5 Ids that stay ids (`STAYS_ID`)

Out of XC-10's scope (another module, not client / service / stage), a target with no readable name (a payment, a booking, a client payment plan), an outside system's id (Stripe, a processor), or not a reference at all (`invoice_tax_id`, the business's tax number):

| Section | Stays the id |
|---|---|
| `business_profile` | `address_id`, `invoice_address_id`, `template_id`, `invoice_tax_id` |
| `client_activities` | `source_entity_id` |
| `client_tasks` | `source_entity_id` |
| `website_pages` | `template_id` |
| `bookings` | `parent_booking_id`, `payment_id`, `invoice_id`, `payment_plan_id` |
| `refunds` | `transaction_id`, `processor_refund_id`, `stripe_connect_account_id` |
| `client_payment_plans` | `booking_id`, `stripe_subscription_id`, `stripe_schedule_id`, `stripe_price_id`, `stripe_customer_id`, `stripe_connect_account_id` |
| `payments` | `booking_id`, `processor_refund_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_customer_id`, `stripe_connect_account_id` |
| `invoices` | `booking_id`, `processor_checkout_id`, `processor_payment_id`, `processor_customer_id`, `processor_payment_method_id`, `stripe_invoice_id` |
| `installments` | `subscription_id`, `booking_id`, `proposal_id`, `invoice_id`, `transaction_id`, `stripe_invoice_id` |
| `client_payment_methods` | `processor_customer_id`, `processor_method_id` |
| `payment_account` | `stripe_account_id` |
| `quotes` | `booking_id`, `package_booking_id`, `document_id`, `created_invoice_id`, `created_plan_id` |

---

## 5. Every section, by module

39 sections: 38 from one `include` descriptor each, `account_identity` from the account's identity. Section ids, columns and exclusion reasons below were re-checked one by one against `descriptors.ts` (the `export` field of all 164 descriptors) on 2026-11-02; the reasons are the descriptor's strings, verbatim.

**Rules common to every table section** (unless the entry says otherwise):

- Read through `BusinessDataExportRepository.listOwnedRowsForExport(sectionId, userId, { maxRows })` (except `user_profile`), service role, first filter `.eq('user_id', userId)` with the **job's** `user_id`, columns only from `exportColumnsOf()`, keyset paged on `id` (DE-4 SA-Q1, E-1…E-6).
- `user_id` is never a column: it is always the exported account. ⚠️ Its recorded reason, "it is in export_metadata.user_id" (`EXPORT_COLUMN_REASON.OWNER_ID`), predates the module export: `data.json` left with the ZIP and the module CSV carries no account id. The reason string is code and is quoted as it stands.
- No status filter: archived, cancelled, inactive, draft and failed rows are all in ("everything we hold", DX-8). The only row filter is the soft delete of `contact_documents`.
- Ids and foreign-key ids are in: they are how rows point at each other. In the module CSV, `id` is the Record ID column, and some references become labels (§4).
- jsonb goes out whole unless a row mapper is named.
- The deny list (§11.3) is re-checked at read time; a denied column fails its section closed, and a failed own section means the module job is retried, then failed (§9.4).
- The group (`account`, `client_records`, `content`) and GDPR role on each registry entry are carried over from the ZIP; the module CSV does not show them.

### 5.1 Modules switched on

#### Module `clients` — Clients

Sections in CSV order: `clients`, `pipeline_stages`, `client_documents`. Lookup sections read: none.

##### `clients` — Client

| Field | Value |
|---|---|
| Source table | `crm_contacts` |
| Columns included (18) | `id`, `first_name`, `last_name`, `email`, `phone`, `stage`, `stage_entered_at`, `tags`, `custom_fields`, `notes`, `source`, `source_metadata`, `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | `clientRow`: `source_metadata` → `sourceMetadata()`: only the string values of `SOURCE_METADATA_KEYS` (`capture_page_url`, `referrer_url`, `referrer_domain`, `capture_channel`, `device_type`, `capture_timestamp`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`); `capture_page_url` and `referrer_url` cut at the first `?` or `#` (`withoutQueryOrFragment`). Dropped: `ip_hash`, `user_agent`, `session_id`, `smart_link_id` and every unnamed key |
| Record type | Client |
| Belongs to | blank (a top-level row) |
| Labels in place | `stage` → the stage label |
| Decisions | DE-4 BC-4 (user 2026-10-15, allow-list); F-DE6-1 (TL 2026-10-16, URLs cut) — §0.7, §0.10 |

##### `pipeline_stages` — Pipeline stage

| Field | Value |
|---|---|
| Source table | `crm_pipeline_stages` |
| Columns included (9) | `id`, `vertical`, `stage_key`, `stage_label`, `position`, `color`, `stage_type`, `is_primary_client_stage`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Pipeline stage |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-4 SA-Q5: `stage_key` passes the deny list via `DENY_EXCEPTIONS['crm_pipeline_stages.stage_key']` — §0.7 |

##### `client_documents` — Document

| Field | Value |
|---|---|
| Source table | `contact_documents` |
| Columns included (12) | `id`, `contact_id`, `name`, `document_type`, `file_name`, `file_size`, `mime_type`, `description`, `tags`, `status`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`storage_path`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS<br>`storage_bucket`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS |
| Row filter | `status` NOT IN ('deleted'): SQ-E5: soft-deleted documents are not exported (user BC-3, 2026-10-15: archived ones are) |
| Row mapper | none: every cell goes out as held. The files themselves are not exported (§7) |
| Record type | Document |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-4 BC-3 (user 2026-10-15: archived in, deleted out) — §0.7 |

#### Module `activities_tasks` — Activities & tasks

Sections in CSV order: `client_activities`, `client_tasks`. Lookup sections read: `clients`.

##### `client_activities` — Activity

| Field | Value |
|---|---|
| Source table | `crm_activities` |
| Columns included (10) | `id`, `contact_id`, `activity_type`, `title`, `description`, `activity_date`, `auto_logged`, `source_capability`, `source_entity_id`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Activity |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-4 — §0.7 (every activity type in) |

##### `client_tasks` — Task

| Field | Value |
|---|---|
| Source table | `crm_tasks` |
| Columns included (15) | `id`, `contact_id`, `title`, `description`, `priority`, `status`, `due_date`, `reminder_at`, `completed_at`, `created_by`, `source_entity_type`, `source_entity_id`, `tags`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Task |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-4 BC-2 (user 2026-10-15: completed and cancelled tasks in) — §0.7 |

#### Module `quotes` — Quotes

Sections in CSV order: `quotes`. Lookup sections read: `clients`, `services`.

##### `quotes` — Quote

| Field | Value |
|---|---|
| Source table | `proposals` |
| Columns included (32) | `id`, `contact_id`, `service_id`, `booking_id`, `package_booking_id`, `document_id`, `supersedes_id`, `created_invoice_id`, `created_plan_id`, `title`, `description`, `currency`, `total`, `prices_include_tax`, `tax_rate`, `tax_label`, `payment_shape`, `payment_terms_days`, `sessions`, `status`, `valid_until`, `decline_reason`, `decline_note`, `stop_reason`, `stop_note`, `accepted_snapshot`, `sent_at`, `viewed_at`, `decided_at`, `stopped_at`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Quote |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `service_id` → the service name; `supersedes_id` → the quote title |
| Decisions | DE-5 BC-2 (every status in), BC-7 (sent / viewed dates in) — §0.9 |

#### Module `invoices_payments` — Invoices & payments

Sections in CSV order: `invoices`, `payments`, `refunds`, `client_payment_methods`. Lookup sections read: `clients`, `services`.

##### `invoices` — Invoice

| Field | Value |
|---|---|
| Source table | `payment_invoices` |
| Columns included (35) | `id`, `contact_id`, `booking_id`, `service_id`, `invoice_number`, `amount`, `currency`, `status`, `line_items`, `due_date`, `payment_terms`, `notes`, `internal_notes`, `sent_at`, `paid_at`, `payment_method`, `payment_received_at`, `payment_notes`, `processor_type`, `processor_checkout_id`, `processor_payment_id`, `processor_customer_id`, `processor_payment_method_id`, `stripe_invoice_id`, `stripe_hosted_invoice_url`, `stripe_invoice_pdf`, `client_name`, `client_email`, `client_address`, `refunded_amount`, `refund_status`, `refunded_at`, `allow_online_payment`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`retry_count`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`last_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`next_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Invoice |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `service_id` → the service name |
| Decisions | DE-5 BC-3 (user 2026-10-16: `stripe_hosted_invoice_url`, `stripe_invoice_pdf` IN, overriding SA-Q5), BC-7 (`internal_notes` in), SA-Q12 (retry counters out) — §0.9 |

##### `payments` — Payment

| Field | Value |
|---|---|
| Source table | `payment_transactions` |
| Columns included (28) | `id`, `contact_id`, `invoice_id`, `booking_id`, `service_id`, `amount`, `currency`, `status`, `payment_method`, `description`, `metadata`, `failure_reason`, `paid_at`, `refund_status`, `refunded_amount`, `refunded_at`, `refund_reason`, `processor_type`, `processor_refund_id`, `processor_fee`, `net_amount`, `fee_currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_customer_id`, `stripe_connect_account_id`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`account_resolution`: which Stripe account our refund path must target; internal routing state (DE-5 SA-Q7)<br>`charge_account_kind`: which Stripe account our refund path must target; internal routing state (DE-5 SA-Q7) |
| Row filter | none |
| Row mapper | `paymentRow`: `metadata` → `paymentMetadata()`: only the string values of `PAYMENT_METADATA_KEYS` = `notes`, `source` |
| Record type | Payment |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `service_id` → the service name; `invoice_id` → the invoice number |
| Decisions | DE-5 SA-Q3, BC-7 (user 2026-10-16), BC-8…BC-10 (fees, net, Stripe ids in), SA-Q7 (`account_resolution`, `charge_account_kind` out), SA-Q9 — §0.9 |

##### `refunds` — Refund

| Field | Value |
|---|---|
| Source table | `payment_refunds` |
| Columns included (20) | `id`, `transaction_id`, `invoice_id`, `amount`, `amount_minor`, `currency`, `status`, `reason`, `reason_note`, `processor_type`, `processor_refund_id`, `stripe_connect_account_id`, `source`, `failure_code`, `failure_message`, `fee_returned`, `refund_fee`, `created_at`, `updated_at`, `succeeded_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`idempotency_key`: our internal dedupe key for the refund request, not the owner's data (and a secret deny-list name)<br>`initiated_by`: the id that started the refund inside our system, which can be an AgentPilot operator; `source` says how it was started (DE-5 SA-Q15)<br>`metadata`: processor plumbing (Stripe object ids already in their own columns, routing bits); no key the owner entered on live rows (DE-5 SA-Q3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Refund |
| Belongs to | `invoice_id` → the invoice number; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-5 SA-Q3 (`metadata` out whole), SA-Q4 (positive amounts as stored), SA-Q6 (`fee_returned` / `refund_fee` have no currency), SA-Q15 — §0.9 |

##### `client_payment_methods` — Saved payment method

| Field | Value |
|---|---|
| Source table | `saved_payment_methods` |
| Columns included (12) | `id`, `contact_id`, `processor_type`, `processor_customer_id`, `processor_method_id`, `method_type`, `brand`, `last_four`, `is_default`, `is_valid`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`expiry_month`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`expiry_year`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Saved payment method |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-5 BC-1 (user 2026-10-16: brand and last 4 only) — §0.9 |

#### Module `account_business` — Account & business details

Sections in CSV order: `account_identity`, `user_profile`, `preferences`, `notification_settings`, `business_profile`, `business_addresses`, `payment_account`, `payment_providers`. Lookup sections read: none.

##### `account_identity` — Sign-in account

| Field | Value |
|---|---|
| Source | not a table (`NON_TABLE_SECTIONS`); the worker builds the one row from the job's `user_id` and the account's identity read at send time (`authAccountRepository.findUserIdentity`) |
| Columns included (3) | `id`, `email` (the login email), `created_at` (hard-coded in `classifiedColumnsOf()` in `joinedCsv.ts`) |
| Columns excluded | — |
| Row mapper | none: every cell goes out as held |
| Record type | Sign-in account |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-1 (§0.5); SA-Q8 (§0.6): the only non-table section |

##### `user_profile` — Profile

| Field | Value |
|---|---|
| Source table | `profiles` |
| Columns included (15) | `id`, `full_name`, `avatar_url`, `company`, `job_title`, `timezone`, `language`, `created_at`, `updated_at`, `role`, `domain`, `onboarding`, `onboarding_goal`, `onboarding_mode`, `onboarding_data` |
| Columns excluded (3) | `plan`: DX-1a / DE-1 SA Q-3: no plan or billing data<br>`org_id`: DE-2 BC-2 (user 2026-10-15): the agent-platform organisation record is not exported; its id alone points at nothing in the file<br>`hourly_rate_usd`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none. Read by `UserProfileRepository.findForUserDataExport` (`.eq('id', userId).maybeSingle()`, columns from `exportColumnsOf('profiles')`), not the shared section repository; no row is an `ok` section with 0 rows |
| Record type | Profile |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-1; DE-2 BC-2 (user 2026-10-15: `org_id` out); DE-3 BC-A (user 2026-10-16: `hourly_rate_usd` out); BC-G (`role` kept) — §0.6, §0.8 |

##### `preferences` — Preferences

| Field | Value |
|---|---|
| Source table | `user_preferences` |
| Columns included (16) | `id`, `preferred_language`, `timezone`, `timezone_confirmed_at`, `preferred_currency`, `theme`, `sidebar_collapsed`, `compact_mode`, `show_timestamps`, `enable_sounds`, `keyboard_shortcuts`, `data_retention_days`, `analytics_enabled`, `telemetry_enabled`, `created_at`, `updated_at` |
| Columns excluded (7) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`default_model`: user 2026-10-16: agent-platform setting, Business OS data only<br>`max_tokens`: user 2026-10-16: agent-platform setting, Business OS data only<br>`temperature`: user 2026-10-16: agent-platform setting, Business OS data only<br>`auto_save_conversations`: user 2026-10-16: agent-platform setting, Business OS data only<br>`debug_mode`: user 2026-10-16: agent-platform setting, Business OS data only<br>`beta_features`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Preferences |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-3 BC-A (user 2026-10-16, agent-platform settings out); R-3; SA-Q8 (timezone is the authority) — §0.8 |

##### `notification_settings` — Notification settings

| Field | Value |
|---|---|
| Source table | `notification_settings` |
| Columns included (20) | `id`, `email_enabled`, `email_frequency`, `email_system_alerts`, `email_security_alerts`, `email_marketing`, `push_enabled`, `push_system_alerts`, `push_mentions`, `desktop_enabled`, `desktop_system_alerts`, `inapp_enabled`, `inapp_sounds`, `inapp_popups`, `quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_timezone`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only<br>`push_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only<br>`desktop_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Notification settings |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-3 BC-A / R-3 (user 2026-10-16: the three `*_agent_updates` toggles out) — §0.8 |

##### `business_profile` — Business profile

| Field | Value |
|---|---|
| Source table | `business_profiles` |
| Columns included (68) | `id`, `vertical`, `sub_vertical`, `company_name`, `company_size`, `clients_per_week`, `revenue_tier`, `description`, `services`, `pain_points`, `goals`, `tools`, `payment_mode`, `online_presence_mode`, `primary_crm`, `primary_calendar`, `primary_payment`, `phone`, `email`, `address`, `address_parts`, `address_id`, `invoice_address_id`, `website_url`, `landing_pages`, `logo_url`, `show_logo_on_smart_links`, `theme`, `template_id`, `subdomain`, `user_code`, `scheduling_availability`, `process_steps`, `language`, `currency`, `invoice_company_name`, `invoice_address`, `invoice_tax_id`, `invoice_footer_text`, `invoice_number_prefix`, `invoice_document_type`, `invoice_prices_include_tax`, `invoice_tax_rate`, `invoice_tax_label`, `invoice_payment_terms_days`, `collection_method`, `default_payment_processor`, `payment_retry_enabled`, `payment_retry_intervals`, `payment_max_retries`, `payment_reminder_enabled`, `payment_reminder_days_before`, `payment_overdue_reminder_days`, `payment_reminder_channels`, `daily_briefing_email_enabled`, `lead_alert_email_enabled`, `lead_autosend_enabled`, `chase_invoices_enabled`, `chase_intake_enabled`, `chase_quotes_enabled`, `automations_declined`, `meeting_reminder_enabled`, `meeting_reminder_hours_before`, `meeting_reminder_notify_client`, `meeting_reminder_notify_owner`, `auto_complete_meetings_enabled`, `created_at`, `updated_at` |
| Columns excluded (17) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`website_analysis`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): scraped website data and the assistant's analysis of it<br>`extracted_data`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): what the assistant extracted from the onboarding bio<br>`onboarding_conversation`: DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported: the onboarding chat<br>`connected_plugins`: connected apps are not exported (user DE4-U2, 2026-10-15)<br>`calendar_sync_enabled`: calendar sync plumbing<br>`calendar_sync_provider`: calendar sync plumbing<br>`calendar_last_synced_at`: calendar sync plumbing<br>`onboarding_completed`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`profile_completeness`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`setup_checklist_dismissed`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`dismissed_setup_steps`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`needs_stripe_connect`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16): derived from the onboarding answers<br>`invoice_bank_name`: user 2026-10-16: bank details left out of the file<br>`invoice_bank_account`: user 2026-10-16: bank details left out of the file<br>`invoice_bank_routing`: user 2026-10-16: bank details left out of the file<br>`invoice_payment_instructions`: user 2026-10-16: bank details left out of the file (free-text payment instructions; the product treats them as the same thing as bank details: SA DE-3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Business profile |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-3 BC-B (user 2026-10-16: bank details out), R-1 (`invoice_tax_id` in), R-2 (`invoice_payment_instructions` out), BC-C…BC-F, SA-Q3 (`subdomain`, `user_code` in), SA-Q4, SA-Q5 (jsonb travels whole) — §0.8 |

##### `business_addresses` — Business address

| Field | Value |
|---|---|
| Source table | `business_addresses` |
| Columns included (6) | `id`, `label`, `parts`, `is_default`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Business address |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-3 — §0.8. Read by its own `user_id`, never by following `address_id` |

##### `payment_account` — Stripe account

| Field | Value |
|---|---|
| Source table | `stripe_connect_accounts` |
| Columns included (13) | `id`, `stripe_account_id`, `stripe_account_type`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_completed`, `country`, `currency`, `business_type`, `stripe_email`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Stripe account |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-5 SA-Q1 (group `account`), SA-Q13 (`stripe_email`, `currency` in) — §0.9 |

##### `payment_providers` — Payment provider

| Field | Value |
|---|---|
| Source table | `payment_processors` |
| Columns included (8) | `id`, `processor_type`, `is_active`, `is_default`, `connection_status`, `last_verified_at`, `created_at`, `updated_at` |
| Columns excluded (6) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`credentials`: secrets and credentials are never exported (§3.2)<br>`supports_checkout`: what the payment provider can do: a product fact, not the owner's data<br>`supports_saved_methods`: what the payment provider can do: a product fact, not the owner's data<br>`supports_refunds`: what the payment provider can do: a product fact, not the owner's data<br>`supports_partial_refunds`: what the payment provider can do: a product fact, not the owner's data |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Payment provider |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-5 BC-12 (provider name and status in, keys never), SA-Q15 — §0.9 |

### 5.2 Modules switched off

These sections are classified `include` and the code can read them, but no owner can ask for them while their module is off (§2). `clients` and `services` rows are still read as lookups for other modules (§4.4).

#### Module `bookings` — Bookings

Sections in CSV order: `bookings`, `time_off`. Lookup sections read: `clients`, `services`.

##### `bookings` — Booking

| Field | Value |
|---|---|
| Source table | `scheduling_bookings` |
| Columns included (27) | `id`, `service_id`, `contact_id`, `parent_booking_id`, `occurrence_number`, `start_time`, `end_time`, `timezone`, `status`, `cancellation_reason`, `cancel_reason`, `cancel_note`, `cancelled_by`, `booking_source`, `notes`, `internal_notes`, `payment_status`, `payment_method`, `payment_amount`, `payment_currency`, `payment_id`, `invoice_id`, `payment_plan_id`, `intake_responses`, `intake_completed_at`, `created_at`, `updated_at` |
| Columns excluded (9) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`reminder_24hr_sent`: DX-1d: a reminder email sent is activity (user BC-6, 2026-10-15)<br>`reminder_2hr_sent`: DX-1d: a reminder email sent is activity (user BC-6, 2026-10-15)<br>`intake_sent_at`: DX-1d: when the intake email was sent is activity (user BC-6, 2026-10-15)<br>`intake_reminded_at`: DX-1d: when the intake email was sent is activity (user BC-6, 2026-10-15)<br>`external_calendar_event_id`: calendar sync plumbing<br>`calendar_sync_provider`: calendar sync plumbing<br>`calendar_synced_at`: calendar sync plumbing<br>`calendar_sync_error`: the calendar provider's error text from our integration |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Booking |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `service_id` → the service name |
| Decisions | DE-4 BC-1 (`internal_notes` in), BC-2 (every status in), BC-6 (reminder / intake-sent markers out) — §0.7. `intake_responses` (the client's answers) is in |

##### `time_off` — Time off

| Field | Value |
|---|---|
| Source table | `scheduling_availability_exceptions` |
| Columns included (7) | `id`, `exception_type`, `start_date`, `end_date`, `custom_hours`, `reason`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Time off |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-4 — §0.7 |

#### Module `services` — Services

Sections in CSV order: `services`. Lookup sections read: none.

##### `services` — Service

| Field | Value |
|---|---|
| Source table | `scheduling_services` |
| Columns included (24) | `id`, `service_name`, `description`, `duration_minutes`, `price`, `currency`, `buffer_minutes`, `max_bookings_per_day`, `advance_booking_days`, `min_notice_hours`, `availability`, `is_active`, `status`, `is_scheduled`, `collection`, `sale_mode`, `payment_type`, `installment_count`, `installment_frequency`, `first_payment_due`, `first_payment_days`, `source`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`ai_suggestions`: assistant output kept to pre-fill the service form, not a setting the owner chose (DX-1d; user BC-7, 2026-10-15) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Service |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-4 BC-7 (user 2026-10-15: `ai_suggestions` out) — §0.7 |

#### Module `payment_plans` — Payment plans

Sections in CSV order: `payment_plans`, `client_payment_plans`, `installments`. Lookup sections read: `clients`, `services`.

##### `payment_plans` — Payment plan

| Field | Value |
|---|---|
| Source table | `payment_plans` |
| Columns included (15) | `id`, `service_id`, `name`, `description`, `total_amount`, `currency`, `supported_currencies`, `installment_count`, `installment_amount`, `installment_frequency`, `allowed_processors`, `preferred_processor`, `is_active`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Payment plan |
| Belongs to | blank (a top-level row) |
| Labels in place | `service_id` → the service name |
| Decisions | DE-5 — §0.9 |

##### `client_payment_plans` — Client payment plan

| Field | Value |
|---|---|
| Source table | `payment_plan_subscriptions` |
| Columns included (29) | `id`, `contact_id`, `booking_id`, `service_id`, `payment_plan_id`, `stripe_subscription_id`, `stripe_schedule_id`, `stripe_price_id`, `stripe_customer_id`, `stripe_connect_account_id`, `installment_count`, `installment_amount`, `currency`, `frequency`, `periods_paid`, `status`, `next_charge_at`, `next_charge_amount`, `last_failure_code`, `last_failure_at`, `card_brand`, `card_last4`, `cancel_reason`, `cancel_note`, `cancelled_by`, `created_at`, `updated_at`, `completed_at`, `cancelled_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`card_exp_month`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`card_exp_year`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`metadata`: processor plumbing (Stripe object ids already in their own columns, routing bits); no key the owner entered on live rows (DE-5 SA-Q3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Client payment plan |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `service_id` → the service name; `payment_plan_id` → the payment plan name |
| Decisions | DE-5 BC-1 (user 2026-10-16: card brand and last 4 only), SA-Q3 (`metadata` out) — §0.9 |

##### `installments` — Installment

| Field | Value |
|---|---|
| Source table | `payment_plan_installments` |
| Columns included (26) | `id`, `payment_plan_id`, `subscription_id`, `booking_id`, `contact_id`, `proposal_id`, `invoice_id`, `transaction_id`, `installment_number`, `label`, `trigger`, `amount`, `currency`, `due_date`, `status`, `paid_at`, `payment_method`, `processor_type`, `stripe_invoice_id`, `completed_at`, `cancel_reason`, `cancel_note`, `cancelled_by`, `cancelled_at`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`retry_count`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`last_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`next_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Installment |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | `payment_plan_id` → the payment plan name |
| Decisions | DE-5 SA-Q12 (retry counters out) — §0.9 |

#### Module `forms` — Forms

Sections in CSV order: `intake_settings`, `intake_forms`. Lookup sections read: none.

##### `intake_settings` — Intake form settings

| Field | Value |
|---|---|
| Source table | `user_intake_settings` |
| Columns included (5) | `id`, `is_enabled`, `send_after_booking`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Intake form settings |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-6 — §0.10 |

##### `intake_forms` — Intake form

| Field | Value |
|---|---|
| Source table | `business_intake_forms` |
| Columns included (8) | `id`, `version`, `status`, `questions`, `generated_at`, `published_at`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`generated_from`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): how the assistant built the form (model, inputs) (TL default BC-4, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Intake form |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-6 BC-4 (TL default 2026-10-16: every version in, `generated_from` out); SA-Q4 (`questions` whole) — §0.10 |

#### Module `email_campaigns` — Email campaigns

Sections in CSV order: `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`. Lookup sections read: `clients`.

##### `email_campaigns` — Email campaign

| Field | Value |
|---|---|
| Source table | `email_campaigns` |
| Columns included (11) | `id`, `name`, `subject`, `body_html`, `body_text`, `segment_filter`, `status`, `scheduled_at`, `sent_at`, `created_at`, `updated_at` |
| Columns excluded (6) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`recipients_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`sent_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`opened_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`clicked_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`failed_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Email campaign |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-6 BC-3 (TL default 2026-10-16: counters out); SA-Q4 (`segment_filter` whole) — §0.10 |

##### `email_sequences` — Email sequence

| Field | Value |
|---|---|
| Source table | `email_sequences` |
| Columns included (8) | `id`, `name`, `description`, `trigger_type`, `trigger_config`, `is_active`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`total_sent`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`total_opened`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`total_clicked`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Email sequence |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-6 BC-3 (counters out); SA-Q4 (`trigger_config` whole) — §0.10 |

##### `email_sequence_steps` — Sequence step

| Field | Value |
|---|---|
| Source table | `email_sequence_steps` |
| Columns included (8) | `id`, `sequence_id`, `step_number`, `delay_minutes`, `subject`, `body_html`, `body_text`, `created_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`sent_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`opened_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`clicked_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Sequence step |
| Belongs to | `sequence_id` → the sequence name; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-6 BC-3 (counters out) — §0.10 |

##### `email_sequence_enrollments` — Sequence enrollment

| Field | Value |
|---|---|
| Source table | `email_sequence_enrollments` |
| Columns included (7) | `id`, `sequence_id`, `contact_id`, `status`, `current_step_number`, `enrolled_at`, `completed_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`next_send_at`: when the next email is scheduled to go: sending machinery, not a record (DE-6 SA-Q6) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Sequence enrollment |
| Belongs to | `sequence_id` → the sequence name; the raw id in Parent ID |
| Labels in place | `contact_id` → the client label |
| Decisions | DE-6 SA-Q6 (`next_send_at` out, `current_step_number` in) — §0.10 |

#### Module `newsletter_subscribers` — Newsletter subscribers

Sections in CSV order: `newsletter_subscribers`, `consent_records`, `consent_settings`, `email_unsubscribes`. Lookup sections read: `clients`.

##### `newsletter_subscribers` — Newsletter subscriber

| Field | Value |
|---|---|
| Source table | `business_subscribers` |
| Columns included (12) | `id`, `email`, `name`, `status`, `source`, `attribution`, `subscribed_at`, `confirmed_at`, `promoted_contact_id`, `promoted_at`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_normalized`: a generated lower-case copy of email, which is in (DE-6 SA-Q8) |
| Row filter | none |
| Row mapper | `subscriberRow`: `attribution` → `sourceMetadata()` (the same `SOURCE_METADATA_KEYS` allow-list and URL cut as `clients`) |
| Record type | Newsletter subscriber |
| Belongs to | blank (a top-level row) |
| Labels in place | `promoted_contact_id` → the client label |
| Decisions | DE-6 BC-5 (TL default: unconfirmed and unsubscribed in), SA-Q4, SA-Q7, SA-Q8 — §0.10 |

##### `consent_records` — Consent record

| Field | Value |
|---|---|
| Source table | `marketing_consent_events` |
| Columns included (17) | `id`, `contact_id`, `email`, `channel`, `purpose`, `decision`, `method`, `statement_text`, `statement_locale`, `statement_version`, `privacy_policy_url`, `source_surface`, `source_page_url`, `evidence`, `redacted_at`, `occurred_at`, `created_at` |
| Columns excluded (7) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_normalized`: a generated lower-case copy of email, which is in (DE-6 SA-Q8)<br>`ip_hash`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`ip_hash_salt`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`user_agent`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`session_id`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`recorded_by`: the id that recorded the decision inside our system (the owner on every live row); `method` says how it was recorded (DE-6 SA-Q10; as DE-5 SA-Q15) |
| Row filter | none |
| Row mapper | `consentEventRow`: `source_page_url` → `withoutQueryOrFragment()`; `evidence` → `consentEvidence()`: only the string values of `CONSENT_EVIDENCE_KEYS` = `client_statement`, `confirmed_via`, `note`. `privacy_policy_url` kept as held |
| Record type | Consent record |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-6 BC-1 (TL default 2026-10-16: visitor evidence out), BC-8 (redacted rows in as held), SA-Q4, SA-Q5, SA-Q7, SA-Q8, SA-Q10 — §0.10 |

##### `consent_settings` — Consent settings

| Field | Value |
|---|---|
| Source table | `marketing_consent_settings` |
| Columns included (13) | `capture_enabled`, `statement_en`, `statement_es`, `statement_he`, `statement_version`, `privacy_policy_mode`, `privacy_policy_url`, `privacy_policy_body`, `privacy_policy_updated_at`, `postal_address`, `label_as_advertisement`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id; it is also the row key (one row per owner) |
| Row filter | none |
| Read key | `rowKey: 'user_id'`: one row read by `user_id` (`.limit(2)`, two rows fail the section); no `id` column |
| Row mapper | none: every cell goes out as held |
| Record type | Consent settings |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-6 BC-7 (TL default: in), SA-Q1 (`rowKey`) — §0.10 |

##### `email_unsubscribes` — Email unsubscribe

| Field | Value |
|---|---|
| Source table | `email_unsubscribes` |
| Columns included (5) | `id`, `contact_id`, `email`, `reason`, `unsubscribed_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Email unsubscribe |
| Belongs to | `contact_id` → the client label; the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-6 — §0.10 |

#### Module `website` — Website

Sections in CSV order: `website_content`, `website_pages`, `website_blocks`, `images`. Lookup sections read: none.

##### `website_content` — Website content

| Field | Value |
|---|---|
| Source table | `website_content` |
| Columns included (22) | `id`, `hero`, `about`, `services`, `testimonials`, `faq`, `team`, `contact`, `process`, `features`, `stats`, `pricing`, `gallery`, `cta`, `newsletter`, `logo_cloud`, `video`, `booking_widget`, `payment_button`, `intake_form`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Website content |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-7 SA-Q7 (jsonb whole), BC-4 (TL default 2026-10-17: assistant-drafted text in) — §0.11 |

##### `website_pages` — Page

| Field | Value |
|---|---|
| Source table | `website_pages` |
| Columns included (22) | `id`, `page_type`, `slug`, `title`, `meta_description`, `seo_keywords`, `published`, `published_at`, `template_id`, `theme`, `created_at`, `updated_at`, `subdomain`, `custom_domain`, `custom_domain_verified`, `status`, `last_published_at`, `favicon_url`, `og_image_url`, `client_flow`, `website_language`, `content_generated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Page |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-7 BC-3 (TL default 2026-10-17: draft / unpublished / archived in), BC-6 (public addresses in), SA-Q12 — §0.11. In a Website export it is read twice: its section, then the parent ids for `website_blocks` |

##### `website_blocks` — Page block

| Field | Value |
|---|---|
| Source table | `website_blocks` (no `user_id`; read through `website_pages` by `page_id`) |
| Columns included (9) | `id`, `page_id`, `block_type`, `position`, `content`, `styles`, `created_at`, `enabled`, `capability_config` |
| Columns excluded (0) | — (the table has no other column) |
| Row filter | none |
| Read path | `viaParent: { parent: 'website_pages', fk: 'page_id' }`: the owner's page ids first (`website_pages` by `user_id`), then the blocks by `.in('page_id', chunk)`, 100 ids per chunk (`EXPORT_LIMITS.VIA_PARENT_CHUNK`); every returned block is checked against its chunk; rows re-sorted by `id` |
| Row mapper | none: every cell goes out as held |
| Record type | Page block |
| Belongs to | `page_id` → the page title (else slug); the raw id in Parent ID |
| Labels in place | none |
| Decisions | DE-7 SA-Q1 (new pattern, the parent-scoped read), SA-Q2 (two-key opt-in), BC-7 (TL default: hidden blocks in, `enabled` shows it) — §0.11 |

##### `images` — Picture

| Field | Value |
|---|---|
| Source table | `user_media` |
| Columns included (9) | `id`, `public_url`, `source`, `section`, `aspect`, `description`, `width`, `height`, `created_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`storage_path`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS<br>`source_ref`: our lookup key that stops the same picture being fetched or paid for twice (a stock library id, or a hash of a picture request); `source` says where the picture came from (DE-7 SA-Q6) |
| Row filter | none |
| Row mapper | none: every cell goes out as held. The picture files are not exported (§7) |
| Record type | Picture |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-7 BC-5 (TL default 2026-10-17: every `source`, `description` in), SA-Q5 (`storage_path` out, `public_url` in), SA-Q6 (`source_ref` out) — §0.11 |

#### Module `smart_links` — Smart links

Sections in CSV order: `smart_links`. Lookup sections read: none.

##### `smart_links` — Smart link

| Field | Value |
|---|---|
| Source table | `smart_links` |
| Columns included (13) | `id`, `code`, `name`, `destination_url`, `destination_type`, `source`, `medium`, `campaign`, `content`, `is_active`, `created_at`, `updated_at`, `metadata` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`click_count`: DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)<br>`conversion_count`: DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)<br>`revenue_cents`: a running total derived from payments already in the file, with no currency of its own (DX-1d; CLAUDE.md § Currency; TL default BC-1, 2026-10-17) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Record type | Smart link |
| Belongs to | blank (a top-level row) |
| Labels in place | none |
| Decisions | DE-7 BC-1 (TL default 2026-10-17: counters and revenue out), BC-2 (switched-off links in), SA-Q8, SA-Q11 — §0.11 |

---

## 6. Every table not exported

164 table descriptors = **38 `include` + 126 `exclude`** (0 `planned`: forbidden on tables since DE-7, `PLANNED_TABLES_ALLOWED = false`; the totals are pinned in `exportClassification.test.ts`). The reasons below are the descriptor's `reason` string, verbatim (built from `EXPORT_REASON` plus a table-specific detail). An excluded table is never read by the export, not even for a lookup.

### 6.1 Activity (DX-1d) — 29 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `payment_events` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; payment event log feeding the automation engine; the payments, invoices and refunds it records are exported themselves (user BC-5, 2026-10-16; as business_events, §0.3.1 SQ-E7) |
| `payment_automation_executions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; automation run history and its claim / lease columns (user BC-5, 2026-10-16) |
| `payment_reminders` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; payment reminders scheduled and sent to clients: emails sent are activity (user BC-4, 2026-10-16; as DE-4 BC-6) |
| `email_sends` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `onboarding_conversations` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `onboarding_prompt_ideas` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `command_sessions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_conversation` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_action_log` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_saved_plans` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_verified_questions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `channel_connections` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; and it holds account_token |
| `channel_metrics_daily` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_automations` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insights` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_actions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `owner_insight_history` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_hypotheses` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_measurements` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_events` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_health_summaries` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `kernel_executions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `kernel_action_log` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `lead_responses` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; queued and sent automatic messages to leads and clients (invitations, chases, reminders) with their claim / lease columns: messages sent are activity (TL default BC-2, 2026-10-16; as payment_reminders, DE-5 BC-4) |
| `daily_briefings` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `daily_briefing_sends` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `audit_trail` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |
| `archived_records` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |
| `audit_logs` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |

### 6.2 Visitor tracking (DX-1d / SQ-E7) — 2 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `website_page_views` | DX-1d / SQ-E7: visitor tracking, not exported |
| `smart_link_clicks` | DX-1d / SQ-E7: visitor tracking, not exported |

### 6.3 Billing and money paid to AgentPilot (DX-1) — 20 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `subscriptions` | DX-1: billing and credits are not exported |
| `user_subscriptions` | DX-1: billing and credits are not exported |
| `subscription_invoices` | DX-1: billing and credits are not exported |
| `billing_events` | DX-1: billing and credits are not exported |
| `credit_transactions` | DX-1: billing and credits are not exported |
| `boost_pack_purchases` | DX-1: billing and credits are not exported |
| `token_usage` | DX-1: billing and credits are not exported; usage and our provider cost |
| `business_os_account_plans` | DX-1: billing and credits are not exported |
| `business_os_entitlement_overrides` | DX-1: billing and credits are not exported |
| `business_os_credit_charges` | DX-1: billing and credits are not exported |
| `business_os_credit_totals` | DX-1: billing and credits are not exported |
| `business_os_credit_lots` | DX-1: billing and credits are not exported |
| `business_os_credit_lot_draws` | DX-1: billing and credits are not exported |
| `business_os_billing_accounts` | DX-1: billing and credits are not exported |
| `business_os_billing_events` | DX-1: billing and credits are not exported |
| `business_os_boost_purchases` | DX-1: billing and credits are not exported |
| `business_os_boost_cap_overrides` | DX-1: billing and credits are not exported |
| `business_os_invites` | DX-1: billing and credits are not exported |
| `user_rewards` | DX-1: billing and credits are not exported |
| `business_os_boost_reversal_events` | DX-1: billing and credits are not exported |

### 6.4 Agent platform (BQ-SA-1, user 2026-10-14) and its organisation record — 37 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `agent_logs` | not Business OS data (user 2026-10-14) |
| `agent_scheduler_state` | not Business OS data (user 2026-10-14) |
| `agents` | not Business OS data (user 2026-10-14) |
| `agent_executions` | not Business OS data (user 2026-10-14) |
| `agent_memory` | not Business OS data (user 2026-10-14) |
| `agent_memories` | not Business OS data (user 2026-10-14) |
| `run_memories` | not Business OS data (user 2026-10-14) |
| `user_memory` | not Business OS data (user 2026-10-14) |
| `agent_prompt_threads` | not Business OS data (user 2026-10-14) |
| `agent_prompt_workflow_generation_sessions` | not Business OS data (user 2026-10-14) |
| `data_decision_requests` | not Business OS data (user 2026-10-14) |
| `organizations` | PLATFORM: agent-platform organisation record (user 2026-10-15) |
| `organization_members` | PLATFORM: agent-platform organisation record (user 2026-10-15) |
| `advisor_reports` | not Business OS data (user 2026-10-14) |
| `automation_slas` | not Business OS data (user 2026-10-14) |
| `metric_baselines` | not Business OS data (user 2026-10-14) |
| `group_metrics_rollup` | not Business OS data (user 2026-10-14) |
| `calibration_history` | not Business OS data (user 2026-10-14) |
| `error_patterns` | not Business OS data (user 2026-10-14) |
| `execution_anomalies` | not Business OS data (user 2026-10-14) |
| `execution_baselines` | not Business OS data (user 2026-10-14) |
| `plugin_performance` | not Business OS data (user 2026-10-14) |
| `intent_examples` | not Business OS data (user 2026-10-14) |
| `agent_configurations` | not Business OS data (user 2026-10-14) |
| `agent_execution_logs` | not Business OS data (user 2026-10-14) |
| `agent_templates` | not Business OS data (user 2026-10-14) |
| `agentkit_analytics` | not Business OS data (user 2026-10-14) |
| `calibration_sessions` | not Business OS data (user 2026-10-14) |
| `workflow_executions` | not Business OS data (user 2026-10-14) |
| `pilot_step_routing_history` | not Business OS data (user 2026-10-14) |
| `shadow_failure_snapshots` | not Business OS data (user 2026-10-14) |
| `shared_agents` | not Business OS data (user 2026-10-14) |
| `execution_insight_runs` | not Business OS data (user 2026-10-14) |
| `execution_insights` | not Business OS data (user 2026-10-14) |
| `agent_stats` | not Business OS data (user 2026-10-14) |
| `agent_intensity_metrics` | not Business OS data (user 2026-10-14) |
| `shared_agent_imports` | not Business OS data (user 2026-10-14) |

### 6.5 Connected apps and the synced outside calendar (user 2026-10-15) — 2 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `external_calendar_events` | user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data |
| `plugin_connections` | user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1 |

### 6.6 Secrets and credentials (§3.2) — 3 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `auth_handoff_codes` | secrets and credentials are never exported (§3.2); short-lived sign-in codes |
| `security_settings` | secrets and credentials are never exported (§3.2); security configuration, not in the DX-1a set (may hold second-factor material) |
| `api_keys` | secrets and credentials are never exported (§3.2) |

### 6.7 Cache or derived data — 4 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `marketing_consent_state` | cache or derived data, not the owner's data; the current consent per address, rebuilt by trigger from marketing_consent_events, which is exported whole as consent_records; no id column to page on (TL default BC-6, 2026-10-16; DE-6 SA-Q3) |
| `business_chat_plan_cache` | cache or derived data, not the owner's data |
| `derived_metrics` | cache or derived data, not the owner's data |
| `business_os_entitlement_shadow_events` | cache or derived data, not the owner's data; platform counters |

### 6.8 Platform data and module setup — 23 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `payment_automation_rules` | platform data, not this account's data; the built-in payment rules the platform seeds; the owner cannot create or edit them (defaultPaymentRules.ts; user BC-6, 2026-10-16) |
| `payment_methods` | platform data, not this account's data; dead table superseded by saved_payment_methods: no app reads or writes it, 0 rows (live 2026-10-16); drop migration pending |
| `user_capabilities` | PLATFORM: module setup, not data the owner entered (user 2026-10-15) |
| `user_capability_blocks` | PLATFORM: module setup, not data the owner entered (user 2026-10-15) |
| `capabilities` | platform data, not this account's data |
| `capability_building_blocks` | platform data, not this account's data |
| `website_templates` | platform data, not this account's data |
| `intake_form_templates` | platform data, not this account's data |
| `storage_usage` | platform data, not this account's data; quota accounting |
| `admin_users` | platform data, not this account's data; platform authorization |
| `archive_runs` | platform data, not this account's data |
| `bos_cron_runs` | platform data, not this account's data |
| `bos_cron_run_recording` | platform data, not this account's data |
| `business_os_account_lineage` | platform data, not this account's data |
| `ais_scoring_weights` | platform data; the account appears only as who changed a row |
| `ais_system_config` | platform data; the account appears only as who changed a row |
| `exchange_rates` | platform data; the account appears only as who changed a row |
| `exchange_rate_history` | platform data; the account appears only as who changed a row |
| `system_settings_config` | platform data; the account appears only as who changed a row |
| `sla_events` | platform data; the account appears only as who changed a row |
| `processed_webhook_events` | platform data, not this account's data; webhook idempotency |
| `business_os_finance_snapshots` | platform data, not this account's data |
| `business_os_deletion_receipts` | platform data, not this account's data |

### 6.9 Not yet a section of its own (product decision, DE-4 follow-up) — 2 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `abandoned_bookings` | enquiries that were never completed into a booking; a section of its own is a product decision (DE-4 follow-up) |
| `scheduling_meetings` | the appointments are represented by their bookings in the bookings section; a section of its own is a product decision (DE-4 follow-up) |

### 6.10 The export itself (the old ZIP table until MX-7, and the module export history) — 3 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `business_os_data_exports` | the export itself: a short-lived copy of this account's data |
| `business_os_export_requests` | the export history itself: which modules were asked for, when, and by whom; never content |
| `business_os_export_module_jobs` | the export history itself: module, dates, counts and a send state; never content, file names or email addresses |

### 6.11 The deletion request itself — 1 table

| Table | Recorded `reason` (verbatim) |
|---|---|
| `business_os_account_closures` | the deletion request itself: process state shown in the app; dates, a language code and guard codes, never the typed statement |

---

## 7. Files are not exported

Documents (`contact-documents` bucket) and website pictures (`website-images` bucket) are **not exported** (BQ-35). The owner downloads them one by one: client documents from each client's record. The drawer says so (`exportDrawerCopy.ts` `filesNotIncluded`: "Files (client documents, website pictures) are not included. Download client documents from each client's record.").

What the CSVs still carry: the **records** about the files. `client_documents` has the name, type, original file name, size and MIME type of each live document; `images` has each picture's `public_url`. Our storage keys (`storage_path`, `storage_bucket`) stay out.

⚠️ Three code facts left over from the ZIP, recorded here so nobody reads them as current behaviour:

| Fact | Where | What it means now |
|---|---|---|
| `contact-documents` and `website-images` are still `export: { kind: 'include', folder }` | `STORAGE_DESCRIPTORS` in `descriptors.ts` | Classification only; `storageExportProblems` checks its shape in CI. No export code reads it |
| The `storage_path` / `storage_bucket` exclusion reason says "the file itself arrives in 'Your files' (DE-8b)" | `EXPORT_COLUMN_REASON.DOCUMENT_STORAGE` | Stale wording: there is no "Your files" any more. The columns are out all the same |
| The `business-data-exports` bucket descriptor (reason "the export itself") | `STORAGE_DESCRIPTORS` | The bucket that held the zips; emptied 2026-10-31. Nothing writes to it |

---

## 8. Parts and sizes

`csvParts.ts` cuts a module's CSV; the numbers are in `moduleExportSending.ts` and `limits.ts`.

| Rule | Value | Over it |
|---|---|---|
| Part size | `PART_BYTES_MAX` **7,000,000 bytes** (BQ-42 "7 MB per email", decimal, SA Q-11), measured in UTF-8 bytes of the whole part: BOM + header + CRLF + every line + CRLF (a Hebrew letter is 2 bytes, an emoji 4). A part may be exactly the budget. About 9.33 MB once base64-encoded | The next row starts a new part |
| Parts per module | `MAX_PARTS_PER_MODULE` **10** (BQ-28 "max 10 emails per module") | Job `failed`, `failure_code` `too_large`, **nothing sent**, the "too large" notice (`cutCsvParts` reason `part_count`) |
| One row | Must fit in a part beside the header | `too_large` (reason `line_too_large`) |
| The header | Must fit in a part | `too_large` (reason `header_too_large`) |
| Rows of a module's own sections | `ROW_CEILING` **100,000**, across all the module's sections; reading stops the moment the total passes it. Exactly at the ceiling is exported | Job `failed`, `failure_code` `over_ceiling`, nothing sent, the "too large" notice |
| Rows of its lookup sections | Their own 100,000 | The ids are kept (§4.3); the module is still sent |
| Zero rows | One part with the header only, so the owner still gets a file | — |
| Reads | `PAGE_SIZE` 1,000 rows per keyset page; `VIA_PARENT_CHUNK` 100 page ids per `website_blocks` query | — |

The cut is done **in full before anything is sent**, at row boundaries only, so the number of parts is fixed (`parts_total`) before the first email and "email n of X" is always true (XC-9). Every part repeats the BOM and the header row, so each file opens on its own. A part's text is built only for its own send and then dropped (XC-8).

Each part is one email with **one attachment**: `{module_id}_{YYYY-MM-DD}_part-{n}-of-{X}.csv` (`partFileName`; the date is the business date of the moment the module was built, on the owner's clock, UTC when no timezone is set), content type `text/csv; charset=utf-8`. The module's localised name is in the subject and body; the file name holds only the ASCII module id.

---

## 9. Delivery

### 9.1 The drawer and the owner route

The entry is `DownloadMyDataButton` (the Business OS settings page, the Danger zone, the plan-cancel drawer and the two security settings tabs), which opens the export drawer. The drawer offers the modules that are on, with their names in the owner's language, and calls the route only through `lib/client/businessOsDataExport.ts`.

| Route | What |
|---|---|
| `POST /api/business-os/export-requests` | `getUser()` (the only account id; 401 without a session) → strict body `{ modules }` (`requestedModulesSchema`: at least 1, no more than the map holds, no duplicates, every one on; any other key, a `userId` included, is a 400 `invalid_input`; invalid JSON is a 400) → throttle `RATE_LIMITS.create` (10 per 900 s, key `export-request-start`) → a usable login email, else 409 `export_no_login_email` and nothing written → the database start function (§9.2): 409 `export_in_progress`, or 409 `export_daily_limit` with `retryAt` → `DATA_EXPORT_REQUESTED` with `logAndFlush` → the "Export requested" email (awaited, best effort, `REQUESTED_EMAIL_TIMEOUT_MS` 10 s guard) → `requested_email_sent_at` marked when it went → **201** `{ requestId, sentTo, requestedEmailSent }`. `maxDuration = 30`. There is no kick to the worker: the cron picks the jobs up |
| `GET /api/business-os/export-requests` | The history (§9.6). `getUser()` (401 without a session) → strict query: nothing, or the whole "Show older" cursor `?before=<requestedAt>&beforeId=<uuid>` (both or neither; any other key, a `userId` included, a repeated key, a bad uuid or a time of another shape is a 400 `invalid_input`) → throttle `RATE_LIMITS.read` (120 per 300 s, key `export-request-history`) → **200** `{ requests, hasMore, nextExportAt }`: 20 requests per page (21 read, `hasMore` when the 21st exists), and on the first page only the owner's "export again at" hint (`null` when under the limit, on an older page, or when the hint could not be read); not audited |

The account is always the session's; never a body, query or header value. Nothing in the route or the worker reads a plan, tier or lifecycle state, and nothing imports `lib/business-os/entitlements` (XC-19, pinned by `exportNotEnforced.test.ts`): export works in every account state.

### 9.2 Limits (the database is the authority)

`public.business_os_export_request_start` (migration `20261095`), under a per-account advisory lock. Mirrored in `MODULE_EXPORT_POLICY` (`moduleExportPolicy.ts`) and pinned by `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts`.

| Rule | Value |
|---|---|
| One at a time | No new request while any job of a request **of the same origin** is `waiting` or `working` → `in_progress` |
| Per day | `OWNER_DAILY_LIMIT` **2** owner requests per rolling `DAILY_WINDOW_HOURS` **24**. A request counts when at least one of its jobs is **not** `failed` / `interrupted` (`MODULE_JOB_NOT_COUNTED`); a request whose every module failed does not count. Refused → `daily_limit` with `retryAt` = the counted request at offset `limit − 1`, newest first, + 24 h |
| Admin | `ADMIN_DAILY_LIMIT_PER_OWNER` 2 per owner per 24 h, counted apart from the owner's own (XC-20). No admin route exists yet (MX-5) |
| Request size | 1 to `MAX_MODULES_PER_REQUEST` 32 module ids, each matching `CODE_SHAPE`, no duplicates (a sanity ceiling; the route allows at most the 13 of the map, and only those that are on) |
| Rows written | One `business_os_export_requests` row (origin `owner`, the modules array) and one `business_os_export_module_jobs` row per module, status `waiting` |

"You can export again at {time}" is shown after a refused click from the 409's `retryAt` (D-13) and, from MX-4b, on open from the GET answer's `nextExportAt` (`nextOwnerExportAt.ts`, reading the same anchor row as the start function). Either way it is a hint: the POST still decides.

### 9.3 The worker and its cron

`GET /api/cron/data-export-modules`, schedule **`*/5 * * * *`** (`vercel.json`), `maxDuration = 300`, fail-closed `CRON_SECRET` (in production a missing secret refuses every call with a 401), `withCronRunRecord('data-export-modules', …)`; the run record keeps counts only. No input is read. The route is the worker's only runtime caller. A queue drain on the claim pattern (`durable-queue-drain`).

| Step | What |
|---|---|
| 1 Reap | First. Stale `working` jobs (claim older than `LEASE_SECONDS` 420) end `sent` (every part accepted), `interrupted` (any part recorded), `failed` `attempts_exhausted` (3 attempts spent), or go back to `waiting` after `RETRY_BACKOFF_SECONDS` 60 × attempts. A notice claimed 5 times is given up. At most `REAP_BATCH_MAX` 100 rows per call. Every job the reaper **ended** is audited |
| 2 Claim | One job at a time, and only while the run is under `BUILD_CLAIM_CUTOFF_SECONDS` **90** (a claim always spends an attempt, so nothing is claimed after it). The claim function clamps its batch to 1..10 |
| 3 Build and send | Module switch (before any read) → owner facts (login email at send time, language, timezone, the request's time and origin; cached per user **and** request) → the module's own sections → its lookup sections → `buildJoinedCsv` with `EXPORT_COLUMN_LABELS` → `cutCsvParts` → `parts_total` written → per part: marked `sending`, sent with its key, marked `accepted`; after the last, the job is `sent` |
| 4 Notices | A `failed` / `interrupted` job whose notice is due gets its one notice email (§9.5) |

Run budget: the worker stops taking new work after `WORKER_BUDGET_SECONDS` **270**; a part try starts only if, timed out at `PART_SEND_TIMEOUT_MS` 45 s, it still ends `SEND_DEADLINE_MARGIN_MS` 5 s before the 300 s `maxDuration`. Every send of a run, parts and notices, is at least `SEND_GAP_MS` **600 ms** after the last (Resend's 2-per-second team limit). Every write after a claim is a compare-and-set on the row's id, `user_id` and the run's runner id; every read is keyed on the claimed row's `user_id`. The worker reads no feature flag.

### 9.4 Statuses, retries and failure codes

| Status | Meaning |
|---|---|
| `waiting` | Queued, or released for a retry |
| `working` | Claimed by a run |
| `sent` | Every part accepted by the mail provider; `sent_at` set |
| `failed` | Ended without sending all of it (`failure_code` below) |
| `interrupted` | A part had reached `sending` and the job could not finish; **never sent again**, so a delivered part is never duplicated |

| Retry rule | Value |
|---|---|
| Build attempts | `BUILD_MAX_ATTEMPTS` **3** claims. A job is released for a retry only while **no part** has reached `sending`; after the third, `failed` `attempts_exhausted` |
| Backoff | `RETRY_BACKOFF_SECONDS` 60 × the job's attempts |
| Retry codes (`last_error_code`) | `section_read_failed` (an own section could not be read), `owner_unreadable`, `budget_spent`, `send_refused` (before the first part), `build_failed` (a throw or failed write before any part); `lease_expired` (set by the reaper) |
| Part tries | `PART_SEND_TRIES` **3** inside one run, with the **same frozen payload** and the same key; a 429 waits its `retry-after` (default 1 s) |
| Notice attempts | `NOTICE_MAX_ATTEMPTS` **5** claims, then `given_up`; a notice that failed in a retryable way is released only at the end of the run, so the next run retries it |

| `failure_code` | When | Notice |
|---|---|---|
| `attempts_exhausted` | 3 build attempts spent | failed ("Please try again") |
| `too_large` | More than 10 parts, or a row or the header does not fit a part (§8) | too large |
| `over_ceiling` | The module's own sections passed 100,000 rows | too large |
| `module_switched_off` / `module_unknown` | The module is off / not in the map (§2) | not available |
| `recipient_unavailable` | The account has no usable login email at send time | none (given up) |
| `request_mismatch` | The job's `user_id` does not own its request | none (given up; nothing is sent) |
| `interrupted` | The only code of an `interrupted` job | interrupted |

Idempotency keys (Resend): `export:{module_job_id}:{n}` per part, `export-notice:{module_job_id}` per notice. The design relies on the key holding for at most one hour (a part key is re-sent only inside one 300 s run; a notice key across at most five notice claims).

### 9.5 The emails

All go to the account's **login email** (the drawer says which), in the owner's language (en / he / es; Hebrew and Spanish are drafts), with dates and times on the owner's clock and "(UTC)" when no timezone is set; date and time are isolated in right-to-left text. Every send passes `redactRecipientInLogs: true`. No body holds the business name, the owner's name, a row count, a file name or any address but the support contact.

| Email | Sent by | Attachment |
|---|---|---|
| Export requested | The route, once per request | none |
| Part "n of X" | The worker, one per part | The part's CSV (§8) |
| Notice: failed / not available / interrupted / too large | The worker, one per failed or interrupted job (`noticeKindFor`) | none |

### 9.6 History

`GET /api/business-os/export-requests` returns the newest requests (`HISTORY_REQUEST_LIMIT` 20, clamped 1..50; ordered `requested_at DESC, id DESC` by the database) and every module job of exactly those requests, joined by `assembleExportHistory`: per request its modules in the request's own order, each with its status, sent time and email count. No Resend id, claim field, error code or failure code is in the answer; `origin` is kept for MX-5. From MX-4b the drawer pages back with "Show older": the GET takes both `before` (the last request's `requested_at`, exactly as returned) and `beforeId`, or neither, and answers the next `HISTORY_PAGE_SIZE` (20) strictly older requests plus `hasMore` (`exportHistoryCursor.ts`); any other query key, or half a cursor, is a 400.

The two tables are kept as the export history (§6.10); they hold dates, counts and a send state, never content, file names or email addresses.

---

## 10. Audit events

Defined in `lib/audit/events.ts`; every row `entityType 'user'`, `entityId` = `userId` = the owner, `resourceName 'Data export'`, audience `shared` (`eventAudience.ts`), so the owner sees them under the labels of `ownerEventPresentation.ts`. Details carry ids, module ids, counts and codes only: never an address, a file name, a business name or any exported content (XC-13).

| Event | Severity | Flags | Written by | Details |
|---|---|---|---|---|
| `DATA_EXPORT_REQUESTED` | info | GDPR, SOC2 | The owner route after the start function, `logAndFlush` | `request_id`, `modules` (module ids), `origin` (`owner`). Old ZIP rows carry `job_id` instead |
| `DATA_EXPORT_MODULE_SENT` | info | GDPR, SOC2 | The worker when a job ends `sent`; the reaper for a job it ended `sent` | `request_id`, `job_id`, `module`, `origin`, `rows`, `parts`, `parts_accepted` |
| `DATA_EXPORT_MODULE_FAILED` | warning | GDPR | The worker when a job ends `failed` or `interrupted`; the reaper for a job it ended with its notice due | The same, plus `failure_code` and `interrupted` (true when the code is `interrupted`) |

Owner labels (en): "Data export requested", "One area of your export was sent by email", "One area of your export could not be sent" (he and es in the file).

**The ZIP's events, old rows only.** `DATA_EXPORT_READY` (info), `DATA_EXPORT_FAILED` (warning), `DATA_EXPORT_DOWNLOADED` (info), `DATA_EXPORT_EXPIRED` (info) and `DATA_EXPORT_DOWNLOADED_BY_ADMIN` (critical) belong to the ZIP export, retired in MX-3.1. The constants and their metadata stay for the rows already written; **nothing writes them any more**. `DATA_EXPORTED` is historical too. Severities are pinned by `lib/audit/__tests__/dataExportSeverity.guard.test.ts`.

---

## 11. How to change it

### 11.1 Cheat-sheet

| To … | Edit | Also update / expect |
|---|---|---|
| **Switch a module on or off** | Its `on` in `EXPORT_MODULES` (`exportModules.ts`), one line | `exportModules.test.ts` "the shipped switches" fails until its list is updated in the same edit. A product decision: record it in the requirement. Off does not hide the module's labels in other modules (§2) |
| **Move a section to another module** | The two `sections` arrays in `exportModules.ts`; the order in `sections` is the column order of the CSV | `exportModuleProblems`: a section in exactly one module (R-3), `website_blocks` stays with `website_pages` (R-8, `viaParent`). `joinedReferenceProblems` J-3: a reference that now crosses modules must target client, service or stage |
| **Add or rename a module** | `EXPORT_MODULE_IDS` and `EXPORT_MODULES` | Ids are durable (T-8: a rename after rows exist needs SA); names in en, he (with a Hebrew letter) and es, unique per language (R-7); no empty module (R-2) |
| **Add or remove a column** of an exported table | The table's `*_EXPORT` constant in `lib/business-os/purge/descriptors.ts`: move the name between `columns` and `excludedColumns` (an excluded column needs a reason; reuse `EXPORT_COLUMN_REASON`). Order in `columns` = select order = column order within the module union | The literal pins in `exportClassification.test.ts` (`DE3_PINS` … `DE7_PINS`) fail until updated. A new column needs a label in en and he (`columnLabels.ts`, L-1). A new `_id` column must be a reference, a parent or in `STAYS_ID` (J-7). A name on the deny list fails CI unless an SA-reviewed `DENY_EXCEPTIONS` entry excuses it. Run `npm run schema:reconcile` (read-only, needs DB env): expect 0 `exportColumnDrift` and 0 `exportColumnsMissing`; a declared column that is not live makes PostgREST reject the whole select, so the section and every module job that needs it would fail. A privacy decision: record it in the requirement |
| **Export a new table** | Its descriptor's `export` → `include` with a new section id; the id in `ExportSectionId` (`classificationTypes.ts`); one entry in `EXPORT_SECTIONS` (`sections.ts`); the section in one module (`exportModules.ts`); its record type in `RECORD_TYPE_LABELS` (a full Record: `tsc` fails without it) and labels for its columns | R-4 fails on a section in no module; `sectionRegistryProblems` needs exactly one `include` per section; the 164 / 38 / 126 totals in `exportClassification.test.ts`. No `user_id` column → `viaParent` (SA item); no `id` column → `rowKey: 'user_id'` (SA item) |
| **Stop exporting a table** | Its descriptor → `exclude` with a reason (reuse `EXPORT_REASON`); remove the section from `ExportSectionId`, `EXPORT_SECTIONS`, its module and the label maps; drop or move any lookup target and references to it | The pins and totals; R-6 (a mapped section must be exportable); J-6. If it was a lookup target, other modules lose its labels and keep the ids. This is the way to hide labels of a module that is off |
| **Add a new database table** (any feature) | It needs a purge descriptor **with** an `export` classification on the spot (`planned` is forbidden) | `exportClassification.test.ts` fails on a descriptor without `export`; `descriptors.invariant.test.ts` applies as for any purge descriptor |
| **Change what a jsonb cell keeps** | The allow-lists in `sections.ts`: `SOURCE_METADATA_KEYS`, `SOURCE_METADATA_URL_KEYS`, `PAYMENT_METADATA_KEYS`, `CONSENT_EVIDENCE_KEYS`, or the row mappers `clientRow`, `paymentRow`, `subscriberRow`, `consentEventRow` | `sections.test.ts` pins each allow-list and the URL cut; a privacy decision |
| **Turn an id into a label, or keep it** | `COLUMN_REFERENCES`, `PARENT_REFERENCES`, `LOOKUP_TARGETS`, `STAYS_ID` (`joinedCsvReferences.ts`) | J-1…J-7 in `joinedCsvReferences.test.ts`; `joinedCsv.test.ts` |
| **Change a header word** | `columnLabels.ts` (en and he always; es a draft) | `columnLabelProblems` L-1…L-9 in `columnLabels.test.ts` |
| **Change CSV encoding** | `csv.ts` | `csv.test.ts` |
| **Change the part size or count** | `PART_BYTES_MAX`, `MAX_PARTS_PER_MODULE` (`moduleExportSending.ts`) | `csvParts.test.ts`, `moduleExportSending.test.ts`; the part must stay under the mail provider's limit once base64-encoded |
| **Change the row ceiling** | `EXPORT_LIMITS.ROW_CEILING` (`limits.ts`) | `sections.test.ts`, `moduleExportWorker.test.ts` |
| **Change the daily limit, lease, attempts or backoff** | A **migration** (the SQL literals of the start, claim and reap functions are the authority), then `MODULE_EXPORT_POLICY` | `business-os-export-requests.migration.test.ts` fails when the two disagree. `maxDuration` must stay at least 60 s under the lease |
| **Change the worker's timing** | `moduleExportSending.ts` (`BUILD_CLAIM_CUTOFF_SECONDS`, `SEND_GAP_MS`, tries, timeouts) | `moduleExportSending.test.ts` checks `MODULE_EXPORT_SENDING_BOUNDS`; `moduleExportWorker.test.ts` |
| **Change an email** | `moduleExportEmails.ts`, `exportRequestedEmail.ts` (en, he, es) | `moduleExportEmails.test.ts`, `exportRequestedEmail.test.ts`; a re-sent notice must give the same bytes under its key |

### 11.2 CI checks that will fail, and why

| Check | File | Fails when |
|---|---|---|
| Classification | `lib/business-os/data-export/__tests__/exportClassification.test.ts` | A descriptor has no `export`; `exclude` has no reason; `include` has an empty / malformed / duplicate column, or a column both included and excluded; a `planned` table or bucket; a denied column without an exception; a stale `DENY_EXCEPTIONS` entry; the registry and descriptors disagree; `rowKey` / `viaParent` / `rowFilter` shape rules; an `include` without `rowKey` that does not list `id`; a pinned column list or the 164 / 38 / 126 totals changed |
| Module map | `lib/business-os/data-export/__tests__/exportModules.test.ts` | R-1…R-9 (ids, empty modules, a section in no or two modules, an unregistered or unexportable section, names, `viaParent` across modules); the five shipped switches; the module ids (T-8); purity (no runtime import, so the drawer bundle stays small) |
| References | `joinedCsvReferences.test.ts` | J-1…J-7 |
| Module CSV | `joinedCsv.test.ts` | Shape, union, lookups, fallbacks, fail-closed |
| Labels | `columnLabels.test.ts` | L-1…L-9 (every real column labelled, no collisions, Hebrew present) |
| CSV and parts | `csv.test.ts`, `csvParts.test.ts` | Encoding rules; part cut and byte counts |
| Section registry and mappers | `sections.test.ts` | Registry order / group / role, allow-lists, URL cutting, the row ceiling |
| Repository | `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | The E-1…E-6 bounds: `user_id` first filter, columns only from the descriptor, keyset paging, the `viaParent` read |
| Export repositories | `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` and the two repository suites | Who may name the two export repositories or `.from()` their tables |
| Worker, sending, emails | `moduleExportWorker.test.ts`, `moduleExportSending.test.ts`, `moduleExportEmails.test.ts`, `exportRequestedEmail.test.ts`, `moduleExportPolicy.test.ts` | Run order, retries, budget, keys, payloads, notices |
| Routes | `app/api/business-os/export-requests/__tests__/route.test.ts`, `route.qa.test.ts`, `app/api/cron/data-export-modules/__tests__/route.test.ts` | Auth, strict body, status codes, audit, the cron secret, the worker's only caller |
| Migration mirror | `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` | `MODULE_EXPORT_POLICY` and the SQL literals disagree |
| Audit | `lib/audit/__tests__/dataExportSeverity.guard.test.ts` | The export events' severity, flags or audience changed |
| No entitlement gate | `lib/business-os/entitlements/__tests__/exportNotEnforced.test.ts` | An export route is put in `ENFORCEMENT_POINTS`, or export code imports the entitlements module (XC-19) |
| Purge invariants | `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | No table name may appear outside `descriptors.ts` in the purge feature; ordering bands |
| Drift (report-only, not CI) | `npm run schema:reconcile` (`scripts/purge-schema-reconcile.ts`) | Reports `exportColumnDrift` (a live column in neither list) and `exportColumnsMissing` (a declared column not live). Run before merging any column change |

### 11.3 The secret-column deny list

`classification.ts`, checked in CI **and** at read time (`exportColumnsOf` throws; the section fails closed):

- Exact: `access_token`, `refresh_token`, `token`, `credentials`, `secret`, `api_key`, `password`, `password_hash`, `account_token`, `cost_usd`, `provider_cost_usd`, `card_number`, `cvc`, `cvv`, `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint`.
- Patterns: `/_token$/`, `/_secret$/`, `/_key$/`, `/_credentials$/`, `/_hash$/`, `/cost_usd$/`, `/_salt$/`.
- `DENY_EXCEPTIONS` (one entry): `crm_pipeline_stages.stage_key` — "the stage's short name (e.g. lead), which crm_contacts.stage refers to; not a credential" (DE-4 SA-Q5). Every new exception is an SA item.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created | Generated from the code on `origin/main` (DE-1 … DE-9) and the DE-10a admin additions on `origin/feature/data-export-de10a`: zip layout, file name, CSV, `data.json`, README, all 39 sections, all 118 excluded tables, files, ceilings, delivery, change cheat-sheet |
| 2026-11-02 | Rewritten for the module export (export MX-4b) | Written from the code after MX-3.1 retired the ZIP (#574): the 13 modules and their switches (5 on), the module CSV, lookups independent of the switch (SA Option A, #596), every section by module (re-checked one by one against the descriptors), all 126 excluded tables (8 new since the last version), files not exported, parts and sizes, delivery, audit, how to change it. ZIP-only sections removed; the ZIP-era page is commit `4a6c22f8`. The flags-and-spreadsheet requirement (`BUSINESS_OS_DATA_EXPORT_FLAGS_AND_SPREADSHEET_REQUIREMENT.md`) is **superseded** by the export redesign (MX-0 module map, no Excel, BQ-25); it was never committed in this repo |
