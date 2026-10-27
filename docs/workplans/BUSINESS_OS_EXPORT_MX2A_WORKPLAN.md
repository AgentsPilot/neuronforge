# Workplan: Business OS Export — MX-2a Joined CSV builder + lookups (step E2)

> **Last Updated**: 2026-10-26

**Developer:** Dev (EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §4.2, §4.3, §6.2 MX-2a, §7 MX-2a/MX-2b, XC-8, XC-10, BQ-26 (answered), BQ-31, §11 boundary, `## SA Split Review — 2026-10-25` (binding)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §2, §3 (CC-1, CC-5, CC-8), §4.2 MX-2a, §4.3 MX-2b, §7, §8
**Format template:** [BUSINESS_OS_EXPORT_MX0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md)
**Branch:** `feature/bos-export-mx2a-joined-csv` (RM-created from `origin/main` `6e19cbe4`; confirmed by Dev with `git branch --show-current` on 2026-10-26)
**Worktree:** `neuronforge-mx2a`
**Date:** 2026-10-26
**Status:** Code Complete (uncommitted, awaiting SA code review + QA)

> **Start gate (dependency on E1).** This slice imports `exportModules.ts` from MX-0, which is **PR #515, not yet on `main`** (open, auto-merge on, at the time of writing). Implementation starts **only after #515 has merged and this branch is rebased on the `main` that holds it**. This is not a stacked PR: nothing here is branched from `feature/bos-export-mx0-module-map`. The MX-0 API used below was read from the `neuronforge-mx0` worktree and its workplan; task 2 re-reads it on `main` after the rebase and stops if it differs.

---

## Overview

MX-2a adds the pure builder that turns one module's section rows into **one joined CSV**, delivered as an **array of lines**, never one big string (XC-8). The user decided the shape on 2026-10-26 (BQ-26): one table per module with a "Record type" column, a "Belongs to" column with the parent's readable name on every child row, the union of the sections' columns in module section order (blank where a record type lacks a column), and the record and parent ids last. Ids in the module's own sections, and stage, service and client ids, become readable labels. A label is never used when its target is excluded from the export or sits in a switched-off module: then the id stays. Every cell goes through the existing BC-1 formula rule in `data-export/csv.ts`, extended with one line helper (no second writer). The header and record-type text is read through a small label interface that MX-2b fills with en/he/es; until then a key-echo default keeps the builder fully testable. No migration, no route, no UI, no DB access, no shared hotspot file. Nothing calls the builder until MX-3.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Implementation approach](#2-implementation-approach)
3. [Files to create / modify](#3-files-to-create--modify)
4. [Task list](#4-task-list)
5. [Tests](#5-tests)
6. [Acceptance criteria](#6-acceptance-criteria)
7. [Coordination](#7-coordination)
8. [Risks](#8-risks)
9. [Open items for SA](#9-open-items-for-sa)
10. [SA Review Notes](#sa-review-notes)
11. [QA Testing Report](#qa-testing-report)
12. [Commit Info](#commit-info)
13. [Change History](#change-history)

---

## 1. Analysis summary

Read on `origin/main` `6e19cbe4` (this branch's base) and, for MX-0, in `neuronforge-mx0` (PR #515).

| Piece | What is there today | Use in MX-2a |
|---|---|---|
| `lib/business-os/data-export/csv.ts` (EXPORT-owned, B.1) | Pure. `cellText` (null → empty, number/bigint → `String`, never neutralised; boolean; string → `neutralise`; object → JSON text then `neutralise`), `neutralise` (BC-1: `^[=+\-@\t\r]` gets `'`), `quoteCell` (RFC 4180), `toCsvText` / `toCsv` (BOM + CRLF, header order, a row key outside the header is never written). Private `BOM`, `CRLF` | Add **one line helper** next to `cellText` / `quoteCell` and export the BOM / line-end constants; `toCsvText` is refactored to call the helper so there is exactly one line encoder (XC-10). ZIP output stays byte-identical (`csv.test.ts` is the proof) |
| `lib/payments/csv.ts` | A different, client-safe writer (`toCsvFile`, LX-1 / CRM) | **Not touched, not merged, not imported** (plan §4.2 note) |
| `exportModules.ts` (MX-0, #515) | Pure. `EXPORT_MODULE_IDS`, `ExportModuleId`, `ExportModuleDefinition { id, name, sections, on }`, `EXPORT_MODULES`, `enabledModules`, `isModuleEnabled(id, map?)`, `moduleOfSection(section, map?)`, `sectionsOfModule(id, map?)`; every helper takes an injectable map | Section order = column order (its own doc comment says so); `moduleOfSection` + `isModuleEnabled` decide whether a lookup target is switched on; tests inject a map with a module off |
| `classification.ts` | Pure (imports descriptors + types only). `exportDescriptorOfSection(section)` (exactly one include, else throws), `exportColumnsOf(table)` (include columns in order; request-time deny check, fail closed), `exportClassificationOf`, `viaParentOf` | The **only** source of a section's columns and of a lookup's label columns. Never a column outside them |
| `classificationTypes.ts` | `ExportSectionId` (39), `NON_TABLE_SECTIONS` (`account_identity`) | Types; `account_identity` has no descriptor |
| `zipExport.ts` `sectionColumns(id)` | `account_identity` → `['id','email','created_at']`, else `exportColumnsOf(exportDescriptorOfSection(id).table)` | Same rule re-stated in the new builder file (`classifiedColumnsOf`); zipExport is **not** edited (removed in MX-6). Open item MX2A-6 |
| `sections.ts` | Server-only. `EXPORT_SECTIONS`; readers go through `BusinessDataExportRepository.listOwnedRowsForExport` (the "classified reader": include columns only, row filters, `viaParent`, paging, ceiling); row mappers reshape `source_metadata`, `metadata`, `attribution`, `evidence` | **Not imported.** MX-2a is pure: rows arrive already read and mapped by that reader (MX-3 calls it). The tests use literal fixture rows |
| `ownerClock.ts` | Server-only (imports `UserPreferencesRepository`) | **Not used by MX-2a.** Cell values stay as stored (BQ-31 suggestion, §4.3 "values stay as stored"); the only owner-clock dates in this feature are the emails' requested-at / produced-at, which are MX-3. Importing it would break purity. Open item MX2A-5 |
| `purge/descriptors.ts` | Include columns per section; one `viaParent` (`website_blocks` → `website_pages`, fk `page_id`) | Read through `classification.ts` only; never edited (S-2) |

### 1.1 References found in the include columns (what can become a label)

Read from the include `columns` of every section on `6e19cbe4`. Only these are candidates. XC-10 allows a label for a reference into **the module's own sections**, or to **stage, service and client**; anything else keeps the id.

| Target (label from) | Label columns (all in the target's include columns) | Key | Referencing columns |
|---|---|---|---|
| **client** (`clients`) | `first_name`, `last_name`, `email` → "Dana Levi (dana@x.com)" | `id` | `contact_id` on activities, tasks, documents, bookings, quotes, invoices, payments, client_payment_plans, installments, client_payment_methods, email_sequence_enrollments, email_unsubscribes, consent_records; `promoted_contact_id` on newsletter_subscribers |
| **service** (`services`) | `service_name` | `id` | `service_id` on bookings, quotes, invoices, payments, payment_plans, client_payment_plans |
| **stage** (`pipeline_stages`) | `stage_label` | **`stage_key`** (unique per user: `UNIQUE(user_id, stage_key)`, 20260722) | `clients.stage` |
| own: invoice (`invoices`) | `invoice_number` | `id` | `payments.invoice_id`, `refunds.invoice_id` (Invoices & payments) |
| own: payment plan (`payment_plans`) | `name` | `id` | `client_payment_plans.payment_plan_id`, `installments.payment_plan_id` (Payment plans) |
| own: email sequence (`email_sequences`) | `name` | `id` | `email_sequence_steps.sequence_id`, `email_sequence_enrollments.sequence_id` (Email campaigns) |
| own: website page (`website_pages`) | `title` (fallback `slug`) | `id` | `website_blocks.page_id` (Website) |
| own: quote (`quotes`) | `title` | `id` | `quotes.supersedes_id` (Quotes) |

**Stay ids (out of XC-10's list, or no readable label; C-10 corrected):** `booking_id` (on payments, invoices, quotes, client_payment_plans, installments), `parent_booking_id`, `package_booking_id`, `document_id` (quotes → Clients module: cross-module, not stage/service/client), `bookings.invoice_id`, `bookings.payment_id`, `bookings.payment_plan_id` (Bookings → other modules), `installments.invoice_id` / `transaction_id` / `proposal_id` (cross-module), `installments.subscription_id` (points to `client_payment_plans`, the **same** module, but a client payment plan has no readable name), `refunds.transaction_id` (a payment has no readable name), `quotes.created_invoice_id` / `created_plan_id`, `client_activities.source_entity_id`, `client_tasks.source_entity_id`, `template_id`, `address_id`, `invoice_address_id`, every `stripe_*` / `processor_*` id. The declared list is the whole rule: nothing is inferred from a column name ending in `_id`; `STAYS_ID` in `joinedCsvReferences.ts` lists them so a new `_id` column is a conscious decision (SA optimisation, adopted).

### 1.2 "Belongs to" (the parent of a child row)

| Section | Parent (via) | Section | Parent (via) |
|---|---|---|---|
| `client_documents`, `client_activities`, `client_tasks` | client (`contact_id`) | `refunds` | invoice (`invoice_id`) |
| `bookings`, `quotes`, `invoices`, `payments`, `client_payment_methods` | client (`contact_id`) | `email_sequence_steps`, `email_sequence_enrollments` | email sequence (`sequence_id`) |
| `client_payment_plans`, `installments` | client (`contact_id`) | `website_blocks` | website page (`page_id`, the `viaParent` link) |
| `consent_records`, `email_unsubscribes` | client (`contact_id`, nullable) | every other section | none (top-level row: "Belongs to" blank) |

The Clients module (the requirement's own example) yields client rows, stage rows and document rows in one table; each document row shows its client's name and email in "Belongs to".

**Not touched:** the export classification, descriptors, the readers and `BusinessDataExportRepository`, the ZIP builder, any route, translations, `featureFlags.ts`, `events.ts`, `vercel.json`, any DELETE-owned file (plan §7). **Deprecated patterns found:** none in the files read. `console.*`: none in `csv.ts` (the one existing file touched).

---

## 2. Implementation approach

### 2.1 The decided shape (BQ-26, user 2026-10-26)

One table per module. The user declined the alternative (one CSV per record type inside the module). Columns, left to right (XC-10):

| # | Column | Content |
|---|---|---|
| 1 | Record type | The section's record-type name in the owner's language (label interface, §2.4) |
| 2 | Belongs to | Child rows: the parent's readable label (§1.2). Top-level rows: blank |
| 3…n | The records' own columns | Union of column keys, walking the module's sections in `ExportModuleDefinition.sections` order and each section's include columns in descriptor order, each key **at its first appearance**. The same key is always the same column (e.g. one `created_at`, one `status`). A row whose section lacks a column leaves it blank. Excluded from the union: `id` (goes to Record ID) and the section's **parent reference column** (its label is "Belongs to", its raw value is Parent ID) |
| n+1 | Record ID | The row's `id` (blank for a section with no `id` column, e.g. `consent_settings`, `rowKey: 'user_id'`) |
| n+2 | Parent ID | The raw parent reference (e.g. the `contact_id`), blank for top-level rows |

The modules where "Belongs to" and Parent ID are always blank are Services, Smart links, Forms and Account & business details (C-10). Quotes is a one-section module **with** a parent (client), so its "Belongs to" is filled. Open item MX2A-3 / Q-A asks whether to drop the always-empty columns there; the default keeps all modules the same shape.

**Parent rule (C-10, stated in `joinedCsvReferences.ts`):** a section's parent is its structural owner record when that owner has a readable label (pages for blocks, sequences for steps and enrollments, invoices for refunds); otherwise the client. Installments and client payment plans fall back to the client because their structural owner (a client payment plan) has no name.

**Row order:** sections in module order, rows within a section in the order received (the reader's keyset order). Children are not interleaved under their parent; the owner can sort by "Belongs to" or Parent ID. Open item MX2A-4.

### 2.2 Lookups (XC-10)

A non-parent reference (e.g. `bookings.service_id`, `clients.stage`) has its cell **replaced in place** by the target's label. A parent reference fills "Belongs to" (label) and Parent ID (raw). Every lookup fails back to the raw value:

| Situation | Cell |
|---|---|
| Reference null / empty | blank |
| Target **available** and the key found | label (built from the target's include columns only) |
| Target available, key not found (e.g. a deleted client) | raw id |
| Target section **excluded** (no single include descriptor / not exportable) | raw id |
| Target section's module **switched off** in the map (`on: false`) | raw id, even if its rows were passed in |
| Target is cross-module and not stage / service / client | never declared, so raw id |

"Available" is decided by one pure function, `lookupTargetAvailable(section, map)`: the section has exactly one include descriptor (or is non-table) **and** `isModuleEnabled(moduleOfSection(section, map), map)`. Whether the owner **ticked** the target's module in this request does not matter: switches are a product decision (map), ticks are a delivery choice, and the client name is the owner's own data either way.

**Where lookup rows come from (pure; MX-3 reads them).** The builder receives `rowsBySection` for the module's own sections and `lookupRowsBySection` for the cross-module targets it may need. A helper `lookupSectionsFor(moduleId, map)` returns which cross-module sections (`clients`, `services`, `pipeline_stages`, minus those already in the module, minus unavailable ones) MX-3 must read, **through the same classified reader** (`listOwnedRowsForExport`), so a label can never come from a column outside the classification. Any extra section passed in is ignored (test). Label columns are taken by name from those rows and are checked against the target's include columns by a CI rule (§2.5).

### 2.3 Output: an array of lines (XC-8)

```typescript
// lib/business-os/data-export/joinedCsv.ts (shape, names are proposals)
export interface JoinedCsvInput {
  moduleId: ExportModuleId;
  language: ExportModuleLanguage;                       // 'en' | 'he' | 'es' (MX-0 type)
  rowsBySection: Partial<Record<ExportSectionId, readonly Record<string, unknown>[]>>;
  lookupRowsBySection?: Partial<Record<ExportSectionId, readonly Record<string, unknown>[]>>;
  labels?: JoinedCsvLabels;                             // default: KEY_ECHO_LABELS (§2.4)
  map?: readonly ExportModuleDefinition[];              // default EXPORT_MODULES (tests inject)
  columnsOf?: (section: ExportSectionId) => readonly string[]; // default classifiedColumnsOf
}

export interface JoinedCsv {
  /** The header row, already encoded (no BOM, no line end). */
  header: string;
  /** One encoded line per record (no line end). */
  lines: string[];
  /** Data rows per section, for MX-3's row count and audit. */
  rowCountBySection: Partial<Record<ExportSectionId, number>>;
}

export function buildJoinedCsv(input: JoinedCsvInput): JoinedCsv;
```

The BOM and the CRLF are **not** in the lines: MX-3 cuts parts at row boundaries and prefixes every part with BOM + header (requirement §4.3, XC-9). `csv.ts` exports the constants and a tiny `csvPartText(header, lines)` (BOM + header + CRLF-joined lines + final CRLF), so MX-3 never assembles CSV framing itself and the BOM/CRLF rule stays in one file. The builder never concatenates all lines into one string. A row whose section is not in the module, or a key outside the column list, is never written.

**`csv.ts` additions** (no second writer, XC-10):

| Export | What |
|---|---|
| `CSV_BOM`, `CSV_EOL` | The existing private constants, exported |
| `csvLine(cells: readonly unknown[]): string` | `cells.map(c => quoteCell(cellText(c))).join(',')`: every value through BC-1, numbers untouched |
| `csvHeaderLine(labels: readonly string[]): string` | Header cells: `quoteCell(neutralise(label))`. Today's header is not neutralised (keys are safe identifiers); labels are free text from MX-2b, so they get BC-1 too (open item MX2A-2) |
| `csvPartText(header, lines)` | BOM + lines joined by CRLF + trailing CRLF (for MX-3 and the tests) |
| `toCsvText` | Refactored to `csvPartText(csvHeaderLine(columns), rows.map(r => csvLine(columns.map(c => r[c]))))` — byte-identical output for identifier headers; `csv.test.ts` unchanged and green is the proof |

Labels ("Belongs to", looked-up names, record types) are strings, so they pass through `cellText` → BC-1: a client named `=HYPERLINK("x")` shows as `'=HYPERLINK("x")` in "Belongs to" as in its own row.

### 2.4 Labels: a placeholder interface MX-2b fills (SA-P3)

```typescript
export interface JoinedCsvLabels {
  /** "Record type", "Belongs to", "Record ID", "Parent ID". */
  fixed(key: 'record_type' | 'belongs_to' | 'record_id' | 'parent_id', language: ExportModuleLanguage): string;
  /** Singular record-type name of a section ("Client", "Document"). */
  recordType(section: ExportSectionId, language: ExportModuleLanguage): string;
  /** Header of a column, named by the section where the key first appears. */
  column(section: ExportSectionId, key: string, language: ExportModuleLanguage): string;
}

/** MX-2a default until MX-2b: echoes keys (`record_type`, the section id, the column key). */
export const KEY_ECHO_LABELS: JoinedCsvLabels;
```

- MX-2a writes **no translated text**. `KEY_ECHO_LABELS` returns the raw key / section id, so the header is unique by construction and every MX-2a test asserts on keys, independent of wording. Tests also inject a fake labels object (e.g. Hebrew strings) to prove the builder uses what it is given, in the right language, for header and record type only (never for data cells, BQ-31).
- MX-2b creates `columnLabels.ts` (server-only) implementing `JoinedCsvLabels`, passes it as the default, and adds its CI tests (every include column has en + he; no two keys in one module share a label). MX-2a only defines the interface and its call sites, so MX-2b changes no builder logic.
- The joiner text in a client label ("Name (email)") is punctuation, not a translation; MX-2b may move it behind the interface if the user wants it localised.

### 2.5 The declared references and their CI rule

Pure data in a new file `joinedCsvReferences.ts` (type-only imports), so MX-3 and MX-2b read the same list:

```typescript
export interface LookupTarget { section: ExportSectionId; key: string; labelColumns: readonly string[] }
export const LOOKUP_TARGETS: Readonly<Record<'client' | 'service' | 'stage' | 'invoice' | 'payment_plan' | 'email_sequence' | 'website_page' | 'quote', LookupTarget>>;
export const COLUMN_REFERENCES: readonly { section: ExportSectionId; column: string; target: keyof typeof LOOKUP_TARGETS }[];
export const PARENT_REFERENCES: Readonly<Partial<Record<ExportSectionId, { column: string; target: keyof typeof LOOKUP_TARGETS }>>>;
```

`joinedReferenceProblems(inputs)` (pure, inputs passed in, like `exportModuleProblems`) reports:

| # | Problem |
|---|---|
| J-1 | A reference's `column` is not in its section's include columns |
| J-2 | A target's `key` or a label column is not in the target section's include columns (**no column outside the classification**) |
| J-3 | A target is in a different module from the referencing section **and** is not `clients`, `services` or `pipeline_stages` (XC-10 scope) |
| J-4 | A section has two parent references, or a parent reference column is also a column reference |
| J-5 | A `viaParent` link (derived from the descriptors via `viaParentOf`) is not declared as that section's parent |
| J-6 | A referenced or referencing section is not registered / not exportable |

Run over the real lists (empty) and over planted bad inputs (each must report).

### 2.6 Purity and size

`joinedCsv.ts` imports: `csv.ts`, `exportModules.ts`, `joinedCsvReferences.ts`, `classification.ts` (pure: descriptors + types), types. **No** `server-only`, repository, `sections.ts`, `ownerClock.ts`, Supabase or logger: a pure function has nothing to log. It is still server-side only in use (descriptors are not for the browser); nothing client imports it. A purity test (as MX-0 T-13) pins the import list. Expected size: builder ~200 lines, references ~80, csv.ts +~30.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/data-export/csv.ts` | modify | Line helper + exported constants + `csvPartText`; `toCsvText` routed through them (one encoder) |
| `lib/business-os/data-export/joinedCsvReferences.ts` | create | Declared lookup targets, column references, parent references; `joinedReferenceProblems` |
| `lib/business-os/data-export/joinedCsv.ts` | create | `buildJoinedCsv`, `JoinedCsvLabels`, `KEY_ECHO_LABELS`, `classifiedColumnsOf`, `lookupTargetAvailable`, `lookupSectionsFor` |
| `lib/business-os/data-export/__tests__/joinedCsv.test.ts` | create | Builder tests (§5) |
| `lib/business-os/data-export/__tests__/joinedCsvReferences.test.ts` | create | Reference CI rule + controls |
| `lib/business-os/data-export/__tests__/csv.test.ts` | modify (add only) | `csvLine`, `csvHeaderLine`, `csvPartText` cases; existing cases unchanged |
| `docs/workplans/BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md` | modify | Task ticks, SA / QA notes |

Nothing else. Not `lib/payments/csv.ts`, not `zipExport.ts`, not `exportModules.ts` (MX-0's file; read only), not `columnLabels.ts` (MX-2b), not descriptors, translations or any hotspot. The requirement's §6 status is spliced by BA / a general-purpose agent.

---

## 4. Task list

- [ ] 1. *(parent session, not Dev)* Coordination (parent session, CC-1/CC-5): read `SELF_SERVICE_EXIT_COORDINATION.md`; log + `[E→D] E2 workplan approved` once SA approves. Dev sends no messages
- [x] 2. ✅ **Start gate:** confirm #515 merged; RM/TL rebases this branch on that `main` (no stash); Dev re-confirms `git branch --show-current` and re-reads `exportModules.ts` on `main`; stop if its API differs from §1
- [x] 3. ✅ `csv.ts`: export `CSV_BOM` / `CSV_EOL`; add `csvLine`, `csvHeaderLine`, `csvPartText`; route `toCsvText` through them; run `csv.test.ts` + `zipExport.test.ts` unchanged → green (byte-identical ZIP CSVs)
- [x] 4. ✅ `joinedCsvReferences.ts`: targets, column and parent references per §1.1 / §1.2, `joinedReferenceProblems` J-1…J-6
- [x] 5. ✅ `joinedCsv.ts`: `classifiedColumnsOf` (account_identity's three, else classification), `lookupTargetAvailable`, `lookupSectionsFor`, column union, row encoding, lookups, `JoinedCsvLabels` + `KEY_ECHO_LABELS`
- [x] 6. ✅ Tests T-1…T-17 (§5), each with its negative control
- [x] 7. ✅ `npx jest lib/business-os/data-export`; filtered `npx tsc --noEmit -p .` (8 GB heap, confirm no OOM) on the touched files; no `console.*`, no `any`, `@/` imports; no backslash-hex escapes (Tailwind scans `lib/`)
- [x] 8. ✅ `git status` = exactly the files of §3; hand to SA (code review) + QA; uncommitted for the user's diff (unless a fast-track is agreed)

### 4.1 Implementation record (Dev, 2026-10-26)

**Start gate (task 2).** TL fast-forwarded the branch to `origin/main` `a105fa4a`, which holds #515 (no rebase by Dev, no stash). `git branch --show-current` = `feature/bos-export-mx2a-joined-csv`. `exportModules.ts` / `exportModuleSchema.ts` re-read on `main`: `EXPORT_MODULE_IDS`, `ExportModuleId`, `ExportModuleLanguage`, `ExportModuleDefinition { id, name, sections, on }`, `EXPORT_MODULES`, `enabledModules`, `isModuleEnabled`, `moduleOfSection`, `sectionsOfModule`, injectable `map`: **matches §1, no stop**. C-10 text corrections applied to §1.1 and §2.1 before coding.

**SA conditions, as built.**

| # | Where | How |
|---|---|---|
| C-1 | branch | Not rebased by Dev; no stash. The parent's uncommitted requirement edit is left untouched |
| C-2 | `buildJoinedCsv` | A parent column leaves the union only when no other module section has that key as an ordinary column; the parent section's rows then fill it with the parent target's label. Test "C-2 …" (refund `invoice_id` = `INV-1`, plus Belongs to and Parent ID) + negative control |
| C-3 | `labelOfRow`, `buildLabelMap`, `resolve` | Empty label → raw; a key seen twice → ambiguous → raw. Client: "First Last (email)" / name / email / raw id. Tests for each, plus a draft invoice with no number and page title → slug → id |
| C-4 | `JoinedCsvClassification { columnsOf, isExportableSection }`, default `CLASSIFIED` | One injected seam. `lookupTargetAvailable` catches a throw → keep id; a target's `columnsOf` throw or a missing label column → keep id; an own section's `columnsOf` throw propagates. All pinned |
| C-5 | `lookupSectionsFor` | Derived from `COLUMN_REFERENCES` / `PARENT_REFERENCES` of the module's sections, minus in-module and unavailable targets, in `LOOKUP_TARGET_IDS` order. One test per module over the real map + a switched-off case |
| C-6 | `csv.test.ts` | Existing cases unchanged; T-17 pre-refactor literal (captured from the old `toCsvText` before the edit); guard: `neutralise(k) === k` for every include column, the three `account_identity` columns and `FILE_INDEX_COLUMNS`, with a negative control; `csvPartText(header, [])` = BOM + header + CRLF |
| C-7 | `csv.ts` | The literal BOM line is unchanged; `CSV_BOM = BOM` re-exports it. A test checks `csv.ts` and the two new files contain no backslash-u / backslash-x escape (regex built from char codes, so the test file holds none either), with a negative control |
| C-8 | `joinedCsv.test.ts` | No include column of any module section is a fixed key; planted `services.record_id` is reported |
| C-9 | `joinedCsv.test.ts` | `classifiedColumnsOf(s)` equals `zipExport.sectionColumns(s)` for every map section (39 cases); comment in `classifiedColumnsOf` names zipExport and MX-6 |
| C-10 | workplan §1.1, §2.1; `joinedCsvReferences.ts` header | Text corrected; the parent rule is stated in the file |
| C-11 | `buildLabelMap` | One `Map<key, label>` per target from the declared label columns; no row reference kept. T-12's `phone` case is the proof |

**Built defaults (owner questions, non-blocking):** Q-A same layout in every module file; Q-B rows section by section; Q-C client "First Last (email)" with the C-3 fallbacks.

**SA optimisation adopted:** `STAYS_ID` plus rule J-7 (every include `_id` column is a reference, a parent or a declared stay-id; a stay-id is an include column and not also a reference). J-7 found one non-reference `_id` column, `business_profile.invoice_tax_id` (the business's tax number), now listed in `STAYS_ID` with a comment.

**Deviations from the workplan body (none change behaviour SA approved):**

| # | Deviation | Why |
|---|---|---|
| D-1 | `PARENT_REFERENCES` is an array of `{ section, column, target }`, not a `Partial<Record<…>>` | So J-4 "two parents on one section" can be planted and reported |
| D-2 | T-16's J-2 control plants `user_id` on the client target, not `phone` | `phone` IS an include column of `clients`, so J-2 rightly does not report it. The `phone` case stays in T-12 / C-11 (a non-label column never reaches a label) |
| D-3 | Added `LOOKUP_TARGET_IDS`, `JOINED_CSV_FIXED_COLUMNS`, `isClassifiedExportable`, `labelOfRow`, `CLASSIFIED`, `REAL_JOINED_REFERENCES`, `CROSS_MODULE_TARGET_SECTIONS` exports | Seams for tests and for MX-2b / MX-3; avoids an `Object.keys` cast |
| D-4 | `buildJoinedCsv` throws for an unknown module id | Fail closed, as `sectionsOfModule` returns `[]` |
| D-5 | `csv.test.ts`'s import line now uses `@/` paths | The line was edited anyway (CLAUDE.md import rule) |

**Verification (2026-10-26).**

| Check | Result |
|---|---|
| `npm test -- lib/business-os/data-export` | **17 suites, 620 tests, all green**, incl. untouched `zipExport.test.ts`, `exportClassification.test.ts`, `exportModules.test.ts` |
| New / changed suites | `joinedCsv.test.ts` 100 tests; `joinedCsvReferences.test.ts` 14; `csv.test.ts` 32 (24 existing unchanged + 8 new) |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` | Completed, no OOM (diagnostics printed, 1852 pre-existing errors elsewhere). **0 errors in the touched files**; `--listFilesOnly` confirms they are in the program |
| ESLint on the 6 touched files | Clean |
| `console.*`, `any`, relative imports, backslash-hex escapes in touched files | None |

---

## 5. Tests

Pure Jest, literal fixture rows, existing job: no added CI time (two small files, milliseconds).

| # | Test | Negative control (must fail on a planted input) |
|---|---|---|
| T-1 | **Clients module (requirement AC):** fixture with 2 clients, 2 stages, 3 documents → one header + 7 lines; column 1 is the record type per section; every document line's "Belongs to" is its client's label; client and stage lines have it blank | A document whose `contact_id` matches no client → "Belongs to" falls back to the raw id (not blank, not another client's name) |
| T-2 | **Column union:** header = `record_type, belongs_to, <clients cols minus id>, <new pipeline_stages cols>, <new client_documents cols minus id, contact_id>, record_id, parent_id`; `created_at` / `updated_at` / `tags` / `notes` appear **once**; a document's `created_at` lands in the same column as a client's | Planted duplicate key in a second section → still one column (asserting header length) |
| T-3 | **Blanks:** a stage line has empty cells under every client-only column, the same count of commas as the header | — |
| T-4 | **Ids last:** the last two header cells are `record_id`, `parent_id`; record id = row `id`; parent id = raw `contact_id`; `consent_settings` (no `id`) → blank record id | — |
| T-5 | **BC-1 (the rule, reused):** a string cell starting `=`, `+`, `-`, `@`, TAB, CR → leading `'`; also in "Belongs to" and in a looked-up label (`=HYPERLINK("x")` client name) | Same values as numbers (`-5`, `5`) → **not** prefixed: numbers untouched; `'-5'` as a string → prefixed |
| T-6 | **Numbers / jsonb / booleans** go through `cellText` exactly as the ZIP: `price: 12.5` → `12.5`, `tags: ['a']` → `"[""a""]"`, `true` → `true`, `NaN` → empty | — |
| T-7 | **Stage lookup:** `clients.stage = 'lead'` → the stage's `stage_label` via `stage_key` | Unknown key → raw `lead` stays |
| T-8 | **Service lookup (cross-module):** Bookings module with `lookupRowsBySection.services` → `service_id` cell = `service_name`; contact → client label in "Belongs to" | No services rows passed → raw id |
| T-9 | **Switched-off target keeps the id:** injected map with `services` module `on: false` (rows still passed) → raw `service_id`; map with `clients` off → Bookings "Belongs to" shows the raw `contact_id` | Same input with the real (all-on) map → labels (proves the switch, not the data, decides) |
| T-10 | **Excluded target keeps the id:** inject a `columnsOf`/classification input where the target section has no include descriptor → raw id | — |
| T-11 | **Own-module lookups only:** `payments.invoice_id` → `invoice_number` (own); `installments.invoice_id` (Invoices is another module) → raw id even when invoices rows are passed as lookup rows | — |
| T-12 | **No column outside the classification:** a row carrying `user_id`, `storage_path`, `secret` keys → none appears in header or lines; a lookup row carrying `phone` cannot leak into a label | Planted label column `phone` on the client target via `joinedReferenceProblems` input → J-2 |
| T-13 | **Rows of another section are ignored:** `rowsBySection.invoices` passed to the Clients module → not written; `lookupRowsBySection.quotes` ignored | — |
| T-14 | **Array of lines (XC-8):** `lines` is a `string[]`; no element contains an unquoted CR or LF; a cell with a newline is quoted inside its one line; `csvPartText(header, lines)` starts with the BOM bytes and ends with CRLF | — |
| T-15 | **Labels interface:** with `KEY_ECHO_LABELS` the header is keys; with an injected fake Hebrew `JoinedCsvLabels` the header and the record-type cells are the Hebrew strings for `language: 'he'`, and **data cells are unchanged** (BQ-31) | Fake labels returning the same text for two keys → builder does not de-duplicate (that is MX-2b's CI test; asserted here so the boundary is explicit) |
| T-16 | **References CI rule:** real lists → `[]`; derived `viaParent` link `website_blocks → website_pages` is declared | Planted: column not in source (J-1), label not in target (J-2), cross-module invoice reference from Payment plans (J-3), two parents (J-4), viaParent undeclared (J-5), unknown section (J-6) — each reports exactly |
| T-17 | **Purity + csv.ts single writer:** `joinedCsv.ts` / `joinedCsvReferences.ts` import no `server-only`, repository, `sections`, `ownerClock`, logger or `lib/payments/csv` (CRLF-normalised source check, as MX-0 T-13); `toCsvText` output for a fixed fixture equals today's bytes (snapshot of the pre-refactor string) | Planted import string → check fails |

Existing suites `csv.test.ts` (unchanged cases), `zipExport.test.ts`, `exportClassification.test.ts` and MX-0's `exportModules.test.ts` must stay green untouched.

---

## 6. Acceptance criteria

From requirement §7 MX-2a / MX-2b (the MX-2a half) and plan §4.2 "Done when":

- [ ] The Clients CSV holds client, document and stage rows in one table, with "Record type" and the client's name and email on each document row (T-1).
- [ ] Same key → same column; union in module section order; ids last (T-2, T-4).
- [ ] Every text cell starting with `=`, `+`, `-`, `@`, TAB or CR is neutralised, through the existing BC-1 rule only; numbers stay numbers (T-5, T-6, T-17).
- [ ] A lookup whose target section is excluded or in a switched-off module keeps the id (T-9, T-10); lookups only for own sections + stage / service / client (T-11, T-16 J-3).
- [ ] No column outside the classification appears; no secret, token or bank detail (T-12, T-16 J-2).
- [ ] Output is an array of lines, never one big string; BOM/CRLF framing in `csv.ts` only (T-14).
- [ ] Headers and record types go through `JoinedCsvLabels`; data cells are never translated (T-15). *Translated labels and their CI tests are MX-2b.*
- [ ] ZIP export output unchanged (`csv.test.ts`, `zipExport.test.ts` green, T-17 snapshot).
- [ ] No migration, route, UI, DB access or shared hotspot edit; no added CI time.

---

## 7. Coordination

Plan §3. For MX-2a:

| Item | MX-2a |
|---|---|
| Dependency | **#515 (E1) merged and branch rebased on it before task 3** (§ start gate). Not stacked |
| Cleanup-regen lock / migration numbers | None |
| Shared hotspot files | None. `csv.ts` and the new files are EXPORT-owned (`lib/business-os/data-export/**`, B.1) |
| Frozen interfaces | Not touched (`findDeletionFacts`, `DownloadMyDataButton`) |
| Messages | Parent session: `[E→D] E2 workplan approved` / `E2 PR opened` / `E2 merged` + log lines (CC-5); status row after merge (CC-8) |
| Files not to edit | Plan §7; also `lib/payments/csv.ts` (LX-1's writer) |

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| #515 changes before merge (e.g. SA asks a rename) | Low | Task 2 re-reads `exportModules.ts` on `main` and stops on a difference |
| `toCsvText` refactor changes ZIP bytes | Medium (live ZIP until MX-6) | Unchanged `csv.test.ts` + a pre-refactor snapshot (T-17); header still un-neutralised for identifier keys (`neutralise` is a no-op on them) |
| A label leaks a column the classification excludes | High (privacy) | Labels read only declared columns; J-2 checks them against include columns; T-12 |
| Wide Clients / Website tables (union of ~40–50 columns) | Low (readability) | Accepted by BQ-26; MX-2b headers make it readable |
| Cross-module lookup rows add read volume in MX-3 | Low | Only label columns are used; MX-3 decides whether they count to the ceiling (noted for MX-3, open item MX2A-7) |
| BQ-27 moves a section between modules later | Low | Union and J-3 are derived from the map at run time; a move re-runs these tests (a cross-module reference may then fall back to the id, which J-3 makes visible) |
| BQ-31 answered "translate values too" | Low | Only MX-2b's label file grows; builder unchanged |

---

## 9. Open items for SA

| # | Item | Proposal |
|---|---|---|
| MX2A-1 | Parent reference columns (`contact_id` on a child) out of the union | Yes: its label is "Belongs to", raw value is Parent ID; repeating it would show the same client twice per row. Non-parent references (e.g. `service_id`) stay in place as labels |
| MX2A-2 | BC-1 on header labels (`csvHeaderLine` neutralises) | Yes: labels become free text in MX-2b; byte-identical for today's identifier headers |
| MX2A-3 | One-section modules (Services, Quotes, Smart links): keep an always-blank "Belongs to"? | Keep, so every module CSV has the same first two and last two columns. Requirement says "that table with friendly headers"; if SA reads that as "no extra columns", drop "Belongs to" / Parent ID only when no section of the module declares a parent |
| MX2A-4 | Row order: section order vs children under their parent | Section order (simple, streaming-friendly, deterministic) |
| MX2A-5 | `ownerClock.ts` not used in MX-2a (plan §4.2 listed it) | Agreed with BQ-31's suggestion: cell values (timestamps included) stay as stored; ownerClock is server-only and belongs to MX-3's email text |
| MX2A-6 | `account_identity`'s three columns restated in `classifiedColumnsOf` (also in `zipExport.sectionColumns`) | Accept the duplicate until MX-6 deletes zipExport; alternative: move `sectionColumns` into `classification.ts` and have zipExport import it (touches zipExport) |
| MX2A-7 | Lookup rows for cross-module targets: count toward `ROW_CEILING`? | MX-3's call; MX-2a only reports `lookupSectionsFor` |
| MX2A-8 | The declared reference list (§1.1) — confirm each own-module target and the client label format "First Last (email)" | As listed; anything not listed keeps its id |
| MX2A-9 | Enrollments' parent: sequence (structural, as MX-0's R-9 pair) or client | Sequence; the client appears in place via `contact_id` → client label |

**Business questions:** **BQ-26 answered by the user on 2026-10-26: one joined table per module, as §4.2** ("Record type", "Belongs to" with the parent's readable name on child rows, union of columns in section order, blanks where a type lacks a column, ids last). The alternative, one CSV per record type inside the module, was **declined**; nothing in this workplan depends on it. **BQ-31** (headers only vs values too) is due before MX-2b; MX-2a assumes its suggestion (headers, record types and lookup labels only) and is unaffected either way, because data cells never pass through the label interface. No new business question.

---

## SA Review Notes

**Reviewed by SA — 2026-10-26**
**Status:** ⚠️ Approved with conditions (C-1…C-11 below). No re-review of the workplan is needed. Dev folds the conditions into the implementation, and SA checks them at code review.

### What was checked

| Item | Result |
|---|---|
| `csv.ts` (BC-1) | Pure and EXPORT-owned (B.1). Its only runtime caller is `zipExport.ts` (`toCsv`, both for section CSVs and for `files-index.csv`). Refactoring `toCsvText` onto `csvLine` / `csvHeaderLine` / `csvPartText` is safe and byte-identical **if** two things hold: (a) an empty `lines` array gives `BOM + header + CRLF` (already pinned by `csv.test.ts` "an empty (or failed) section is its header row only"); (b) `neutralise` is a no-op on every header key the ZIP writes. Today it is: every key is a snake_case identifier. C-6 pins (b) so it cannot drift |
| Classified reader | `sections.ts` → `listOwnedRowsForExport` selects include columns only. The row mappers (`clientRow`, `paymentRow`, `subscriberRow`, `consentEventRow`) only reshape include columns in place. The builder writes only `columnsOf(section)` keys, so a stray key cannot reach a cell (T-12) |
| `classification.ts` | `exportColumnsOf` throws `ExportClassificationError` on a denied column (request-time fail-closed). `exportDescriptorOfSection` throws unless there is exactly one include. `viaParentOf` takes a descriptor and returns the parent descriptor, so J-5 can be derived from it |
| MX-0 (`neuronforge-mx0`, PR #515 head `dde1b234`, **OPEN, not merged** at review time) | The API matches §1: `EXPORT_MODULES`, `ExportModuleLanguage`, `isModuleEnabled`, `moduleOfSection`, `sectionsOfModule`, injectable `map`. It is pure (one type-only import). Section lists match requirement §4.1 |
| Lookup columns (business-os-schema-check approach: descriptors' include lists are reconciled with the live schema by the DE-3…DE-7 CI; migrations spot-read) | Every label and key column is in its target's **include** columns: `clients.first_name/last_name/email` ✅, `services.service_name` ✅, `pipeline_stages.stage_key/stage_label` ✅, `invoices.invoice_number` ✅, `payment_plans.name` ✅, `email_sequences.name` ✅, `website_pages.title/slug` ✅, `quotes.title/supersedes_id` ✅ (`20260913_proposals.sql`). Every referencing column listed in §1.1 / §1.2 is in its section's include columns ✅. **No label column outside the classification.** Stage key uniqueness: `UNIQUE(user_id, stage_key)` in both `20260721` and `20260722_create_crm_tables.sql` (not per `vertical`), and `crm_contacts.stage` holds the `stage_key` (`DEFAULT 'lead'`) ✅ |
| Fixed header keys vs columns | No include column today is named `record_type`, `belongs_to`, `record_id` or `parent_id`, so key-echo headers are unique today. C-8 pins this |
| XC-8 / memory | An array of lines is the shape XC-8 asks for. One part string is built per part (≤ 7 MB, or 10 MB if BQ-42 says so), never the whole module. At the 100,000-row ceiling the lines array is about the size of the CSV (UTF-16 in memory, so up to about 2× the bytes), alongside the rows MX-3 already holds. That fits the "< 1 GB" XC-8 estimate. Lookup rows are reduced to key→label maps (C-11) |
| CI time | Two small pure Jest files in the existing job. Milliseconds. ✅ (no added CI time) |
| Rule 7 (new patterns) | The declared reference list plus `joinedReferenceProblems` (J-1…J-6) has the same shape as the existing pure "problems" rules (`exportModuleProblems`, `tableExportProblems`, `viaParentProblems`: data in a file, inputs passed in, run over real and planted inputs). **Accepted as an extension of an existing pattern, not a new one.** `JoinedCsvLabels` with a key-echo default is a small injected seam that SA-P3 asks for. Accepted |
| Purity / runtime | No `server-only`, repository, logger, Supabase or `ownerClock` import. A pure function has nothing to log, so no Pino gap. Server-side use only (descriptors). No Edge concern |
| Zod / RLS / entitlements / tenant isolation | No API boundary, no DB access, no entitlements import (XC-19 holds). Rows are supplied by MX-3 through the session-scoped classified reader. Nothing applies at this slice |
| `console.*` | None in `csv.ts` (the one existing file touched) ✅ |
| §11 boundary | Every touched file is under `lib/business-os/data-export/**` (EXPORT, B.1). `lib/payments/csv.ts` is not touched ✅. No hotspot, no frozen interface |
| Dependency gate | Correct and not stacked. #515 is still OPEN: **do not start task 3 until it has merged** |

### Conditions (fold into implementation; SA checks at code review)

1. **C-1 Start gate, rebase hygiene.** Start only after #515 is merged on `main`. The rebase must not use `git stash` or `--autostash` (`rebase.autoStash` is unset here; keep it that way). The requirement file in this worktree holds the parent session's **uncommitted** BQ-26 edit, and `git rebase` refuses to run on a dirty tracked file. Before the rebase, TL / the parent session decides how that edit lands (its own commit or PR, or carried as an explicit hunk). Dev and RM must not silently fold it into the MX-2a commit, and must not discard it.
2. **C-2 "The same key always maps to the same column" (XC-10) wins over the parent-column exclusion (MX2A-1).** A section's parent column is dropped from the union **only when no other section in the module contributes that key as an ordinary column**. If another section does, the parent section's rows fill that column too, with the same in-place label. The one case today is the Invoices & payments module: `payments.invoice_id` is an in-place reference and `refunds.invoice_id` is a parent. The `invoice_id` column therefore shows the invoice number on payment rows **and** on refund rows. A refund row also has "Belongs to" and Parent ID. Add a test for this, with the negative control "refund row leaves `invoice_id` blank" → fail.
3. **C-3 Empty or ambiguous labels fall back to the raw value.** A label that comes out empty falls back to the raw id. Examples: a draft invoice with a null `invoice_number`, a page with neither title nor slug, a client with no name and no email. A key that appears twice in the lookup rows is ambiguous and also falls back to the raw id: it cannot happen for primary keys or for `stage_key` (UNIQUE per user), but the rule must not depend on that. For the client label, state the fallbacks in code: name and email → "First Last (email)"; name only → "First Last"; email only → "email"; neither → raw id. Add tests for each.
4. **C-4 One injectable "is this target exportable" seam.** Route `lookupTargetAvailable` through the same injected dependency as `columnsOf`, for example an `isExportableSection` input defaulting to "exactly one include descriptor, or non-table". That makes T-10 testable without editing descriptors or mocking modules. That check must **catch** the classification throw and treat it as "not available, keep the id". For the module's **own** sections, `columnsOf` errors (e.g. `ExportClassificationError` for a denied column) must **propagate**: that path fails closed and must never be swallowed. Pin both behaviours.
5. **C-5 `lookupSectionsFor` is derived from the declared references.** Compute it from `COLUMN_REFERENCES` / `PARENT_REFERENCES` of the module's sections: the targets outside the module that are available. Do not hard-code the clients/services/stages trio. For example, Website and Smart links need none, and Bookings needs `clients` and `services`. Add a test per module over the real map.
6. **C-6 Byte-identity proof for the live ZIP.** Keep `csv.test.ts` cases unchanged and green, and add the T-17 pre-refactor literal. Add one guard test: `neutralise(key) === key` for every include column of every section, the three `account_identity` columns, and `FILE_INDEX_COLUMNS`. That makes the `csvHeaderLine` change (MX2A-2) provably a no-op for the ZIP. Also add `csvPartText(header, [])` = BOM + header + CRLF.
7. **C-7 Keep the BOM as the existing literal character.** When the BOM constant is exported, do **not** rewrite it as a backslash-u escape: `lib/` is scanned by Tailwind, and a backslash+hex sequence in a scanned file has broken `next build` before (PR #180). Write no other backslash-hex escapes in the new files.
8. **C-8 Fixed header keys never collide with a column.** A test over the real map checks that no include column of any module is named `record_type`, `belongs_to`, `record_id` or `parent_id`. Without it, the key-echo header is unique "by construction" only by luck, and MX-2b's duplicate-label test would be the first to notice. Add a negative control with a planted column.
9. **C-9 Parity with the ZIP's columns (MX2A-6).** The duplicate `account_identity` rule is accepted until MX-6. Add a test asserting `classifiedColumnsOf(s)` equals `zipExport.sectionColumns(s)` for every section in `EXPORT_MODULES` (`zipExport.test.ts` already loads that module under Jest), and a comment in `classifiedColumnsOf` naming zipExport and MX-6. This catches drift in either copy. Do not edit zipExport.
10. **C-10 Correct the workplan text before coding** (doc-only, no re-review):
    - §1.1 "stay ids": `installments.subscription_id` points to `client_payment_plans`, which is the **same** module (Payment plans), not cross-module. It stays an id because a client payment plan has no readable name. Also list `bookings.invoice_id`, `bookings.payment_id`, `bookings.payment_plan_id`, `payments.booking_id`, `invoices.booking_id`, `quotes.created_invoice_id` / `created_plan_id`, `client_activities.source_entity_id` and `client_tasks.source_entity_id` explicitly.
    - §2.1: Quotes is a one-section module **with** a parent (client), so its "Belongs to" is not blank. The modules where "Belongs to" and Parent ID are always blank are Services, Smart links, Forms and Account & business details.
    - State the parent rule in `joinedCsvReferences.ts`: a section's parent is its structural owner record when that owner has a readable label (pages for blocks, sequences for steps and enrollments, invoices for refunds); otherwise the client. Installments and client payment plans fall back to the client because their structural owner (a client payment plan) has no name.
11. **C-11 Lookup rows are reduced to key→label maps.** The builder builds one `Map<key, label>` per target from the declared label columns only, and keeps no reference to the lookup rows or their other columns. This keeps memory small when MX-3 passes a large client list to a Bookings or Payments export. T-12's `phone` case is the proof.

### Rulings on open items

| # | Ruling |
|---|---|
| MX2A-1 | ✅ Agreed, **refined by C-2** (dropped from the union only when no other section of the module uses that key as an ordinary column). Non-parent references stay in place as labels |
| MX2A-2 | ✅ Agreed: header labels go through `neutralise`. C-6 proves it is a no-op for the ZIP |
| MX2A-3 | **Owner-visible: business question Q-A below, non-blocking.** Build the default: every module has the same first two and last two columns, as the workplan proposes. Changing it later is one flag derived from `PARENT_REFERENCES` (and from section count, for Record type), so the builder logic does not move. Note: the always-blank modules are Services, Smart links, Forms and Account & business details (C-10), not Quotes |
| MX2A-4 | **Owner-visible: business question Q-B, non-blocking.** SA recommends section order on technical grounds. It is deterministic, which matters for XC-9's fixed part boundaries. It streams, while grouping would need every parent held and a cross-section sort. The owner can sort by "Belongs to" in Excel. Build the default |
| MX2A-5 | ✅ Agreed: MX-2a does not import `ownerClock.ts`. It is server-only, does I/O, and would break purity. SA reads XC-10's "`ownerClock.ts` formats the dates" together with requirement §4.3's Dates row (requested-at and produced-at, MX-3's email text). Cell timestamps stay as stored, as the ZIP does today. This deviates from plan §4.2's "reuses `ownerClock.ts`" wording; SA rules it intended. **The ZIP's README tells the owner "times inside the files are in UTC"; the module CSV has no README.** That is business question Q-D for MX-3 (non-blocking here) |
| MX2A-6 | ✅ Accept the duplicate until MX-6, **with the parity test of C-9**. Do not move `sectionColumns` (it would touch zipExport for no gain) |
| MX2A-7 | Deferred to the MX-3 workplan, as proposed. SA guidance for MX-3: lookup rows are **not** exported records, so they should not count toward the module's `ROW_CEILING`. They do add read time and memory, so MX-3 must bound them (e.g. the same paging and ceiling as a section read) and reduce them to maps (C-11) |
| MX2A-8 | The reference list is **confirmed as listed** in §1.1 / §1.2, with the C-10 text corrections. No missing own-module target with a readable label was found. Every listed label column is an include column. The **client label format** is owner-visible: business question Q-C, non-blocking. Build "First Last (email)" with the C-3 fallbacks as the default |
| MX2A-9 | ✅ Agreed: an enrollment's parent is its sequence (structural, matching steps). The client appears in place via `contact_id` → client label. Record the general parent rule (C-10) |

### Business questions for the user (plain terms; none blocks MX-2a; defaults are built and are cheap to change)

TL to put these to the user together with BQ-31, before MX-2b.

- **Q-A (MX2A-3).** Some exports hold only one kind of record that belongs to nothing: Services and Smart links. Forms and Account & business details hold several kinds, none belonging to another. Should those files still carry the "Belongs to" and "Parent ID" columns, always empty there, so every export file has the same layout? For Services and Smart links, should they also keep "Record type", which would say the same word on every row? **Recommended: yes, keep the same layout in every file.** It is predictable for anyone who opens several files or loads them into another tool.
- **Q-B (MX2A-4).** In a file that mixes kinds (e.g. Clients: clients, stages, documents), should rows be listed kind by kind (all clients, then all stages, then all documents), or should each client be followed by its documents? **Recommended: kind by kind.** It is simpler and keeps very large exports reliable, and the owner can sort by "Belongs to" in Excel to group them.
- **Q-C (MX2A-8).** How should a client be named in "Belongs to" and wherever a client is referred to? **Recommended: "Dana Levi (dana@example.com)"**, falling back to the name only or the email only when one is missing. The email tells apart two clients with the same name.
- **Q-D (MX2A-5, for MX-3).** Dates and times inside the files are kept exactly as stored, which is UTC (the time carries a "+00:00" marker). Is that acceptable, provided the export email says "times in the file are in UTC"? **Recommended: yes.** Converting every time to the owner's clock changes the data values, which BQ-31 suggests leaving as stored.

### Optimisation suggestions (non-blocking)

- An explicit `STAYS_ID` list in `joinedCsvReferences.ts`, plus a test that every include column ending in `_id` (and `stage`) is in `COLUMN_REFERENCES`, `PARENT_REFERENCES` or `STAYS_ID`. A future referencing column then becomes a conscious decision rather than a silent raw id. Cheap; recommended.
- MX-3 cuts parts by bytes, so it will need each line's UTF-8 length (`Buffer.byteLength(line) + 2`). The builder does not need to compute it.
- Keep `buildJoinedCsv` free of `JSON.stringify` on whole rows. Everything goes through `cellText` per cell, as planned.

### Approval

[x] Workplan approved with conditions C-1…C-11. Implementation may start **after #515 has merged and the branch is rebased (C-1)**. Code review checks every condition.

## SA Code Review — 2026-10-27

**Code Review by SA — 2026-10-27**
**Status:** ✅ Code Approved (no blocking finding; two Low items below are optional and may be fixed before commit or left)

### Verification run by SA

| Check | Result |
|---|---|
| `npx jest lib/business-os/data-export` (worktree) | 17 suites, **620/620 green** (incl. untouched `zipExport`, `exportClassification`, `exportModules` suites) |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` | Completed (exit 2, 1,852 diagnostics, **no OOM / no V8 trace**). **0 errors** in `csv.ts`, `joinedCsv.ts`, `joinedCsvReferences.ts` or the three test files |
| **ZIP byte identity (main regression risk)** | Proven three ways: (1) by reading: rows go through the same `quoteCell(cellText(v))`; the framing `BOM + [header, ...rows].join(CRLF) + CRLF` equals `csvPartText`'s two branches; the only change is `neutralise` on the header, a no-op for every key the ZIP writes (C-6 guard over every include column, the `account_identity` three and `FILE_INDEX_COLUMNS`; `toCsv` has exactly two callers, both in `zipExport.ts`). (2) T-17 pre-refactor literal. (3) SA ran an independent differential fuzz: the `HEAD` `csv.ts` vs the worktree `csv.ts`, 200,000 random tables (formula prefixes, quotes, commas, CR/LF, BOM char, NaN/Infinity, bigint, jsonb, leading/trailing spaces, Hebrew, empty row sets): **0 mismatches**, `toCsv` bytes equal |
| CSV injection / escaping | Every data cell, the record-type cell, "Belongs to" and every looked-up label go through `csvLine` → `cellText` → BC-1 → RFC 4180 quoting; headers through `csvHeaderLine` (BC-1 + quoting). Numbers untouched. A multi-line cell stays quoted inside one line (T-14). BOM appears once per part, only in `csvPartText` |
| Tailwind hazard (C-7) | Byte scan: no backslash-u / backslash-x escape in any touched file (the only hits under `__tests__/` are pre-existing, untouched files). BOM kept as the literal character |
| CRLF safety | All six files are LF; source scans normalise CRLF (`read()`); value assertions compare generated strings, not source text |
| CLAUDE.md | Pure modules (no logger needed: no I/O, nothing to log); no `console.*`; no `any`; `@/` imports throughout; no DB, route, Zod boundary, entitlements import or hotspot file. Rule 7: the reference list + `joinedReferenceProblems` extends the existing pure "problems" rule pattern (accepted at workplan review) |
| Scope | `git status`: exactly the §3 files plus the parent session's requirement edit (C-1, see below) |

### Conditions C-1…C-11

| # | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ | Branch on `a105fa4a` (holds #515), no stash. The parent's requirement edit is still an **unstaged, separate** change (`docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md`, +2/−1). **RM note:** do not fold it into the MX-2a code commit by accident; TL decides where it lands |
| C-2 | ✅ | `joinedCsv.ts:283-301` (`ordinaryKeys`), filled via `joinedCsv.ts:347`. Test "C-2 …" pins refund `invoice_id` = `INV-1` + Belongs to + Parent ID, and `contact_id` correctly absent from the Invoices & payments header (parent in every section that has it). No second C-2 case exists in today's map (enrollments' in-place `contact_id` and the unsubscribes/consent parent `contact_id` are in different modules) |
| C-3 | ✅ | `labelOfRow` (`joinedCsv.ts:201-210`), `buildLabelMap` ambiguity (`:219-223`), `resolve` (`:319-324`). All fallbacks tested, incl. draft invoice, title → slug → id |
| C-4 | ✅ | Seam `JoinedCsvClassification` (`:83-88`); `lookupTargetAvailable` catches (`:133-137`); target `columnsOf` throw → keep id (`:309-313`); own-section `columnsOf` is called outside any try (`:275`) so it propagates. Both directions pinned |
| C-5 | ✅ | `lookupSectionsFor` (`:155-172`) derived from the references; per-module expectation table over the real map + switched-off case |
| C-6 | ✅ | See byte-identity row above |
| C-7 | ✅ | `csv.ts:27` literal BOM; `CSV_BOM = BOM`; escape scan test with negative control |
| C-8 | ✅ | Collision test over the real map + planted `services.record_id` |
| C-9 | ✅ | Parity `it.each` over every map section; comment in `classifiedColumnsOf` names zipExport and MX-6 |
| C-10 | ✅ | §1.1 / §2.1 corrected; parent rule stated in `joinedCsvReferences.ts:17-21` |
| C-11 | ✅ | `buildLabelMap` keeps only `Map<key,label>` + ambiguous set; no row reference retained |

### Deviations

| # | Ruling |
|---|---|
| D-1 `PARENT_REFERENCES` as an array | ✅ Accepted: makes J-4 plantable; the builder builds its own `Map` per module |
| D-2 J-2 control plants `user_id` | ✅ Accepted: correct, `phone` is an include column of `clients` |
| D-3 extra exports | ✅ Accepted: all are seams MX-2b / MX-3 / tests use; no behaviour |
| D-4 throw on unknown module | ✅ Accepted: fail closed. Note the message says "Unknown" also for a known module with zero sections, which cannot happen in today's map |
| D-5 `@/` imports in `csv.test.ts` | ✅ Accepted |

### Code Review Comments

1. `lib/business-os/data-export/csv.ts:34` — the diff also changed an untouched line: `const FORMULA_START = /…/` became `const FORMULA_START =/…/` (space lost). Behaviour identical; it is a noise hunk on the BC-1 regex in a security-relevant file. Restore the space. — Priority: Low
2. `lib/business-os/data-export/__tests__/joinedCsv.test.ts` C-2 block — the payment row's own `invoice_id` cell (in-place label `INV-1`) is not asserted in this block (T-11 covers it elsewhere). Adding `expect(payment.invoice_id).toBe('INV-1')` would make the "same column, same label on both row types" claim self-contained. — Priority: Low

### Optimisation Suggestions (non-blocking, for MX-3 / later)

- J-7 checks `_id` columns only; `clients.stage` (a non-`_id` reference) is covered by its declaration, but a future non-`_id` reference column would not be forced into a decision. Acceptable now; revisit if such a column appears.
- `buildJoinedCsv` builds a module even if the map has it `on: false` (and then its own in-module targets give no label, since `lookupTargetAvailable` says off). MX-3 must keep gating on `isModuleEnabled` before calling it; consider asserting that in MX-3's tests.
- MX-3: per SA's MX2A-7 ruling, read lookup sections through the classified reader with paging/ceiling, and compute part sizes with `Buffer.byteLength(line) + 2`.

### Code Approved for QA: Yes

## QA Testing Report

*(QA to populate)*

## Commit Info

*(RM to populate)*

---

## QA Report — 2026-10-27

**QA — 2026-10-27**
**Test mode:** full
**Strategy used:** A (Jest unit). The slice is pure, with no DB, route or UI, so B, C and D do not apply. A scratch differential suite and an edge-case suite ran under the repo's Jest config, outside the repo (session scratchpad `qa-mx2a/`). Nothing was added to the worktree.
**Focus:** schema, security (BC-1 / CSV injection, no column outside the classification), regression (ZIP CSV bytes)
**Skipped:** e2e (no UI); integration (no DB access in MX-2a)
**Input source:** TL prompt (steps 1–4) + QA judgment

### Test runs

| Run | Result |
|---|---|
| `npx jest lib/business-os/data-export` | **17 suites, 620/620 green** (re-run after the `FORMULA_START` whitespace fix landed: still 620/620) |
| `npx jest lib/business-os` (anything else importing `csv.ts`) | 462 suites: 459 pass, **3 fail (5 tests), all pre-existing and unrelated**: `bookingNextStep.test.ts`, `onboarding/servicesAreDraftsWithWords.guard.test.ts`, `onboarding/theChainHoldsEndToEnd.test.ts`. These are source-text scans of onboarding/booking files that fail on Windows, the known CRLF / `\n` source-scan class. The same 5 fail on the main checkout (`1baf1f9b`), and none imports `data-export`. The only importers of `data-export/csv` are `zipExport.ts` (`toCsv`) and `joinedCsv.ts`, plus their tests |
| QA differential: `toCsvText` / `toCsv` vs `git show origin/main:…/csv.ts` (7 tests) | **Byte-identical.** Covered: 50 values (Hebrew, emoji, BOM char inside a cell, `"`, `,`, CR, LF, CRLF, leading/trailing space, leading `= + - @ TAB CR`, `'`, `0/-0/-5/12.5/1e21/NaN/±Infinity`, bigint, booleans, objects/arrays (incl. `=` inside), `Date`, ISO strings, null/undefined); empty sections, empty column lists, keys outside the header, missing keys; 5,000 random rows; **every real section header** (all map sections' include columns, `account_identity`, `FILE_INDEX_COLUMNS`) × 50 random rows + 0 rows; `cellText` / `neutralise` / `quoteCell` agree on every value. `csv.ts` is unchanged between the branch base `a105fa4a` and current `origin/main` |
| QA edge cases for `buildJoinedCsv` (13 tests) | **All pass** (table below) |

### Edge cases exercised (QA scratch suite)

| Case | Result |
|---|---|
| Every module (13) with no rows | Header only, keys unique, `record_type, belongs_to … record_id, parent_id`; `csvPartText(header, [])` = BOM + header + CRLF ✅ |
| Unknown module id | Throws `Unknown export module` (fail closed) ✅ |
| Missing lookup target (client and service not among the lookup rows) | Belongs to = raw `contact_id`, Parent ID raw, `service_id` raw ✅ |
| Row with no references (`contact_id: null`, `service_id: undefined`) | Belongs to, Parent ID and `service_id` blank; Record ID kept ✅ |
| One section only (Clients with clients rows only; Services module) | 1 line; `stage` stays raw `lead` when no stage rows; Services row has blank Belongs to / Parent ID ✅ |
| Duplicated ids in own-section rows (two `c1` clients) | Both rows written; a document pointing to `c1` keeps the raw id (ambiguous, C-3) ✅ |
| Duplicated ids in lookup rows (two `s1` services) | Raw id ✅ |
| Numeric reference `7` vs string id `'7'`; whitespace-only label | Resolves to the label; whitespace-only → raw id ✅ |
| Hebrew client name + injected Hebrew labels (`he`) | Belongs to `דנה לוי (dana@il.com)`; header and record type use the injected strings; data cells (`מסמך, "א"`, `דנה`) untranslated and correctly quoted ✅ |
| Header label / record type starting with `=` / `-` | Neutralised (`'=cmd`, `'-services`) ✅ |
| Client named `=HYPERLINK("x")` in Belongs to; service label with `,` + CRLF | `'=HYPERLINK("x")`; label quoted inside its one line ✅ |
| Column order stability, all 13 modules | Header identical with no rows, with rows whose keys are in reverse order, and across repeated builds; every cell lands under its own key ✅ |
| 100,000 bookings + 100,000 client lookup rows | 100k lines, correct label on the last row, no bare CR/LF in any line, **built in ~2.1 s** ✅ |

### Committed coverage (CLAUDE.md "happy path + one failure path")

✅ Present. Happy path: T-1 (Clients module, 7 lines, Belongs to labels). Failure paths: T-1's negative control (orphan document → raw id), C-4 "an own section's classification error propagates", the T-7/T-8/T-9/T-10 negative controls, and `joinedReferenceProblems` planted J-1…J-7.

### CRLF safety (Windows)

✅ The new source files and the two new test files are LF. `csv.test.ts` is CRLF on disk (tracked, `core.autocrlf=true`), and its suite passes. No test holds a multi-line template literal. Every value assertion compares generated strings built with explicit `\r\n`. The only source-text scans (T-17 imports, C-7 escape scan) read through `read()`, which normalises `\r\n` → `\n`, and their patterns (`from '…'`, a one-line `toContain`, the backslash-hex regex) do not depend on line ends.

### Acceptance criteria

| Criterion (§6) | Tested? | Result | Notes |
|---|---|---|---|
| Clients CSV: client, document and stage rows, Record type, client name + email on document rows | ✅ | Pass | T-1 + QA Hebrew case |
| Same key → same column; union in section order; ids last | ✅ | Pass | T-2, T-4, C-2, QA column-order case |
| BC-1 on every text cell via the existing rule; numbers stay numbers | ✅ | Pass | T-5, T-6, QA formula cases |
| Excluded / switched-off target keeps the id; own + stage/service/client only | ✅ | Pass | T-9, T-10, T-11, J-3 |
| No column outside the classification | ✅ | Pass | T-12, J-2 |
| Array of lines; BOM/CRLF framing only in `csv.ts` | ✅ | Pass | T-14, QA 100k case |
| Headers / record types via `JoinedCsvLabels`; data untranslated | ✅ | Pass | T-15 + QA Hebrew labels |
| ZIP output unchanged | ✅ | Pass | `csv.test.ts`, `zipExport.test.ts`, T-17 + QA differential vs `origin/main` |
| No migration / route / UI / DB / hotspot; no added CI time | ✅ | Pass | `git status` = §3 files + the parent's requirement edit (C-1); new suites run in ms (`joinedCsv.test.ts` ~100 tests) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None. 100k rows with a 100k-row lookup build in about 2 s.

#### Edge Cases (nice to fix / note only)
1. **A duplicated id inside a module's own section is written twice without a signal.** References to that id then fall back to the raw id (correct per C-3). It cannot happen for primary keys from the classified reader, so no action is needed. — Low
2. **SA comment 1 (`csv.ts:34` whitespace) is already resolved in the worktree.** The line now reads `const FORMULA_START = /^[=+\-@\t\r]/;`, and the suite was re-run green after the change. SA comment 2 (C-2 payment-row assertion) is still optional. — Info

### Final Status
- [x] All acceptance criteria pass — ready for commit (subject to the user's diff review and TL's decision on the separate requirement edit, C-1)
- [ ] Issues found — Dev must address before commit

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Created (Dev, EXPORT session) | MX-2a workplan on BQ-26 as answered by the user (one joined table per module): pure `buildJoinedCsv` returning header + array of lines, `csv.ts` line helper (one encoder, BC-1 reused), declared lookup / parent references with CI rule J-1…J-6, label interface `JoinedCsvLabels` with a key-echo default until MX-2b, tests T-1…T-17 with negative controls; start gate on #515 merged + rebase (no stacking); open items MX2A-1…MX2A-9 |
| 2026-10-26 | SA workplan review (SA) | ⚠️ Approved with conditions C-1…C-11: rebase hygiene, with no stash and the parent's uncommitted requirement edit handled (C-1); same key → same column beats the parent-column exclusion (refund `invoice_id`, C-2); empty or ambiguous label → raw id, plus client label fallbacks (C-3); an injectable exportable seam, with own-section classification errors propagating (C-4); `lookupSectionsFor` derived from the references (C-5); ZIP byte-identity guard over every header key (C-6); BOM literal, no backslash-hex (C-7); fixed header key collision test (C-8); `classifiedColumnsOf` parity with zipExport (C-9); §1.1 / §2.1 text corrections and the parent rule (C-10); lookup rows reduced to maps (C-11). Rulings on MX2A-1…9. Owner-visible business questions Q-A…Q-D (layout, row order, client label, UTC times), non-blocking, with defaults. Start still gated on #515 merging |
| 2026-10-26 | Implemented (Dev, EXPORT session) | Start gate met (#515 on `main` `a105fa4a`, API unchanged). C-10 text fixes; `csv.ts` line helpers (`csvLine`, `csvHeaderLine`, `csvPartText`, `CSV_BOM`, `CSV_EOL`), `toCsvText` routed through them (byte-identical); new `joinedCsvReferences.ts` (targets, references, parents, `STAYS_ID`, J-1…J-7) and `joinedCsv.ts` (`buildJoinedCsv`, labels seam, classification seam, `lookupSectionsFor`); C-1…C-11 folded in; deviations D-1…D-5 (§4.1). 620/620 data-export tests green; scoped tsc clean. Uncommitted |
