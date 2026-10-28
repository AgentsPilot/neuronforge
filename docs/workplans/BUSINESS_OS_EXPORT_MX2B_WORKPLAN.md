# Workplan: Business OS Export — MX-2b Header labels en/he/es (step E3)

> **Last Updated**: 2026-10-28

**Developer:** Dev (EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §4.2, §4.3 (Language row), §6.2 MX-2b, §7 MX-2a / MX-2b, §9 BQ-31 (answered 2026-10-28), §11 boundary, `## SA Split Review — 2026-10-25` (binding)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §2, §3 (CC-1, CC-5, CC-8), §4.2 MX-2a, §4.3 MX-2b, §8 SA-P3
**Previous slice:** [BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md) (§2.4 label seam, SA conditions C-1…C-11, merged)
**Branch:** `feature/bos-export-mx2b-column-labels` (RM-created from `main` `7d641ac2`; confirmed by Dev with `git branch --show-current` on 2026-10-28)
**Worktree:** `neuronforge-mx2b`
**Date:** 2026-10-28
**Status:** Code Complete (SA workplan review APPROVED WITH CHANGES 2026-10-28, R-1…R-3 folded in; awaiting SA code review; not committed)

---

## Overview

MX-2b gives the module CSV its words. MX-2a built the joined CSV with a small label seam (`JoinedCsvLabels`: the four fixed headers, a record-type name per section, a header per column) and a key-echo default. This slice adds the server-only, pure `lib/business-os/data-export/columnLabels.ts`. It holds `{ en, he, es }` for the four fixed headers ("Record type", "Belongs to", "Record ID", "Parent ID"), for the singular record-type name of each of the 39 sections (SA-P3), and for every include column of every section. The builder then takes these labels in the owner's language. Two CI rules guard the file: every column has a label in every language, and no two different keys in one module share a label. Each rule has negative controls. The user answered BQ-31 on 2026-10-28: "headers, record types and fixed labels only, not the owner's values." No cell value changes in this slice. Two follow-up questions about which cell values count as "fixed labels" go back to the user (§8). No migration, no route, no UI, no DB access, no shared hotspot file, no translation bundle.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Implementation approach](#2-implementation-approach)
3. [Files to create / modify](#3-files-to-create--modify)
4. [Task list](#4-task-list)
5. [Tests](#5-tests)
6. [Acceptance criteria](#6-acceptance-criteria)
7. [Coordination](#7-coordination)
8. [Open items for SA and questions for the user](#8-open-items-for-sa-and-questions-for-the-user)
9. [Risks](#9-risks)
10. [SA Review Notes](#sa-review-notes)
11. [QA Testing Report](#qa-testing-report)
12. [Commit Info](#commit-info)
13. [Change History](#change-history)

---

## 1. Analysis summary

Read on `main` `7d641ac2` (this branch's base). CC-1: the coordination file was read in full. No lock is held that touches this slice, no migration number is needed, and the E3 start line is already in the log (2026-10-28).

| Piece | What is there today | Use in MX-2b |
|---|---|---|
| `joinedCsv.ts` (MX-2a) | Pure. `JoinedCsvLabels { fixed(key, lang), recordType(section, lang), column(section, key, lang) }`, `JOINED_CSV_FIXED_COLUMNS`, `KEY_ECHO_LABELS`. `JoinedCsvInput { moduleId, language: ExportModuleLanguage, rowsBySection, lookupRowsBySection?, labels?, map?, classification? }`, and `labels` defaults to `KEY_ECHO_LABELS`. A header is named by `labels.column(firstSection, key, language)`, where `firstSection` is the section in which the key first appears in module order. Record-type cells come from `labels.recordType(section, language)`. Data cells never pass through the labels | Implement the interface. **Signature change:** `labels` becomes required (§2.3) |
| `__tests__/joinedCsv.test.ts` T-17 | Pins `joinedCsv.ts` imports to five pure export modules and forbids `server-only`, repositories, the logger and Supabase | Unchanged. Because of this pin `joinedCsv.ts` must **not** import the server-only `columnLabels.ts`. That is why the labels are passed in rather than defaulted (§2.3, MX2B-1) |
| `exportModules.ts` (MX-0) | `ExportModuleLanguage = 'en' \| 'he' \| 'es'`; `EXPORT_MODULES` (13 modules, 39 sections, en/he/es names); R-7 checks names: non-empty, a Hebrew letter in `he` written as a literal range (no backslash escape), unique per language | Same language type. Same "literal letters, never a backslash escape" technique for the Hebrew test (Tailwind scans `lib/`) |
| `classification.ts` / `joinedCsv.classifiedColumnsOf` | The include columns of a section, in descriptor order (`account_identity`: `id, email, created_at`) | The **one** source of "every include column" for the coverage rule. The test passes `classifiedColumnsOf` in, so the rule file needs no descriptor import |
| `csv.ts` | `csvHeaderLine` passes every label through `neutralise` (BC-1) and RFC 4180 quoting. `csvPartText` puts the BOM in front of every part | Not edited. The BOM is what makes Excel read Hebrew headers as UTF-8 (§2.5) |
| `joinedCsvReferences.ts` | Lookup targets and their label columns (client name and email, `service_name`, `stage_label`, `invoice_number`, plan / sequence `name`, page `title`/`slug`, quote `title`) | Read for the BQ-31 investigation (§1.2). Not edited |
| Owner's language, server side | `app/api/business-os/export-requests/route.ts` (MX-1b) calls `userPreferencesRepository.findPreferredLanguage(userId)`. That returns `SupportedLanguage` (`lib/business-os/userLanguage.ts`, the same `'en' \| 'es' \| 'he'` union, normalised). On a read error the route logs `code: 'language_unreadable'` at warn and uses `'en'` | **The existing pattern.** MX-2b reads no DB. The MX-3 worker resolves the language this way, once per module job, and passes it to the builder (§2.3) |
| `exportRequestedEmail.ts` | Pure copy table per language, with FSI/PDI isolates in the RTL plain-text email | Precedent for bidi handling in email text. CSV headers deliberately take **no** isolates (§2.5) |
| `lib/business-os/stageLabels.ts` | `localizeStageLabel` re-translates a stage label the platform seeded and the owner never changed. For a custom label in the wrong script it falls back to the stage type's name | Relevant to BQ-31 (§1.2, MX2B-Q2). Not imported in this slice |

**Size of the label set** (counted on `7d641ac2` through `classifiedColumnsOf` for every section of `EXPORT_MODULES`):

| Count | Value |
|---|---|
| Sections | 39 (in 13 modules) |
| Include columns, `id` included | 637 |
| Distinct column keys without `id` | 383 |
| Keys in more than one section | 63 (e.g. `created_at` 37, `updated_at` 29, `status` 15, `contact_id` 13, `currency` 10, `description` 10) |
| Strings to write | about 383 keys + a few section overrides, plus 39 record types and 4 fixed headers, each × 3 languages ≈ 1,300 |

### 1.1 What "every include column" means here

- `id` is never a header: the builder always writes it under "Record ID". The coverage rule counts `id` as covered by the fixed `record_id` label (MX2B-3).
- A section's parent column (e.g. `client_documents.contact_id`) leaves the header when no other section of the module uses that key as an ordinary column (MX-2a C-2). **It still gets a label**, so that a later change to the map or to the references cannot produce an unlabelled header.
- `account_identity` is not a table. Its three columns come from `classifiedColumnsOf`, as in the builder.

### 1.2 BQ-31 — what is translated, and the investigation of the lookups

**The user's answer (2026-10-28, verbatim):** "headers, record types and fixed labels only, not the owner's values."

**Working definition used in this workplan:**

| Term | Meaning | Translated? |
|---|---|---|
| Header | The text in the CSV's first row: the four fixed headers and one per column | ✅ Yes (this slice) |
| Record type | The singular name of a section on each row ("Client", "Document") | ✅ Yes (this slice) |
| Fixed label | A word from a vocabulary the **platform** defines and the owner cannot type or rename, e.g. a status code such as `paid` / `cancelled` or an activity type, when shown as a word | ⚠️ Defined; **which cells**, and whether they are translated in this slice, is MX2B-Q1 (user) |
| Owner's value | Anything the owner, or their client, typed or renamed: client names, emails, phones, service names, stage names they created or renamed, notes, titles, descriptions, form questions, website text, invoice numbers with the owner's prefix | ❌ Never. Written exactly as stored |

**The lookups (MX-2a, `joinedCsvReferences.ts`) all return owner text.** A lookup replaces an id with the referenced record's stored text. It is not a translation and stays untranslated.

| Lookup | Source column | Who writes the text | Verdict |
|---|---|---|---|
| client (Belongs to, `contact_id`, `promoted_contact_id`) | `clients.first_name`, `last_name`, `email` | Owner or their client | Owner's value: as stored |
| service (`service_id`) | `services.service_name` | Owner (onboarding may suggest it, and the owner can edit it) | Owner's value: as stored |
| stage (`clients.stage`) | `pipeline_stages.stage_label` | **Mixed.** Onboarding seeds the label from a platform list in the language the owner used at the time (`OnboardingConfigurationService`), and the owner can rename it. The app already re-translates an *untouched* seeded label in the UI (`localizeStageLabel`) | ⚠️ **Ambiguous: flagged as MX2B-Q2.** Default in this workplan: as stored |
| invoice (`payments.invoice_id`, refunds' parent) | `invoices.invoice_number` | Generated number with the owner's prefix | As stored (an identifier, not a word) |
| payment plan, email sequence, website page, quote | `name`, `title` / `slug`, `title` | Owner | Owner's value: as stored |

**The joiner** in a client label ("First Last (email)") is punctuation, not a word. It stays as MX-2a built it.

**Cells that hold platform words today.** The builder writes them as stored codes, e.g. `paid`, `no_show`, `stripe`, `true`. Under the working definition these are the "fixed labels" candidates. Translating them is **not** in the approved MX-2b scope (plan §4.3 Goal and Done when: headers, record types and the fixed headers only; "Not the client translation bundles"). This is flagged to the user as MX2B-Q1 rather than decided here. Examples of such columns, all to be checked against the live schema before any translation:

- `status` (15 sections), `activity_type`, `priority`, `payment_status`, `payment_method`, `booking_source`, `cancelled_by`, `cancel_reason` (structured code, `20260928c`), `exception_type`, `document_type`, `processor_type`, `method_type`, `refund_status`, `trigger_type`, `trigger`, `channel`, `purpose`, `decision`, `method`, `page_type`, `block_type`, `stage_type`, `vertical`, `collection`, `sale_mode`, `payment_type`, `installment_frequency`, `frequency`, `email_frequency`, `destination_type`, `privacy_policy_mode`.
- Booleans, written `true` / `false` by the shared `csv.ts` encoder (MX2B-Q3).

**Ambiguous columns** (owner text mixed with platform text in the same column; flagged, not decided):

| Column | Why it is ambiguous |
|---|---|
| `pipeline_stages.stage_label`, and `clients.stage` through the lookup | A platform-seeded default (e.g. "Inquiry", "Active Client") until the owner renames it. The app shows untouched defaults in the reader's language. MX2B-Q2 |
| `bookings.cancellation_reason` | Prose. The platform writes English prose into it ("Cancelled by client…", per `20260928c_structured_cancellation_reasons.sql`), and owners write their own reasons. It cannot be translated safely: recommended to keep as stored even if MX2B-Q1 says yes |
| `clients.source`, `newsletter_subscribers.source`, `smart_links.source` / `medium` / `campaign`, `images.source` | Some values are platform codes (e.g. `smart_link`, `website_intake`); UTM-style values are owner- or visitor-typed. Needs a per-column check if MX2B-Q1 says yes |
| `time_off.reason`, `refunds.reason`, `installments.label` | Look like free text; a per-column check is needed before treating any as a vocabulary |
| `services.status`, `quotes.status`, … | Platform enums; clear "fixed labels" if MX2B-Q1 says yes |
| Content the platform generated in the owner's language (intake form questions, website text, email sequence bodies) | Generated once, then the owner's to edit: owner's value, as stored |

---

## 2. Implementation approach

### 2.1 The file `columnLabels.ts` (server-only, pure)

```typescript
import 'server-only';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import type { ExportModuleLanguage } from '@/lib/business-os/data-export/exportModules';
import type { JoinedCsvFixedColumn, JoinedCsvLabels } from '@/lib/business-os/data-export/joinedCsv';

/** One label in every export language. es may be a draft (requirement §4.3). */
export type LabelText = Readonly<Record<ExportModuleLanguage, string>>;

/** "Record type", "Belongs to", "Record ID", "Parent ID". */
export const FIXED_COLUMN_LABELS: Readonly<Record<JoinedCsvFixedColumn, LabelText>>;

/** Singular record-type name per section (SA-P3). A full Record, so a new section without a name fails tsc. */
export const RECORD_TYPE_LABELS: Readonly<Record<ExportSectionId, LabelText>>;

/** A column key's label wherever the key appears (`created_at` -> "Created at"). */
export const COLUMN_LABELS_BY_KEY: Readonly<Record<string, LabelText>>;

/** Only where one key means something different in another module (e.g. `content`, `services`, `name`). */
export const SECTION_COLUMN_LABELS: Readonly<Partial<Record<ExportSectionId, Readonly<Record<string, LabelText>>>>>;

/** The label of `section.column`: the section's entry, else the key's entry, else undefined. */
export function columnLabelText(section: ExportSectionId, key: string): LabelText | undefined;

/** The `JoinedCsvLabels` the worker passes to `buildJoinedCsv` (§2.3). */
export const EXPORT_COLUMN_LABELS: JoinedCsvLabels;

/** The CI rule (§2.4). Pure: every input passed in, run over the real set and planted bad sets. */
export function columnLabelProblems(set: ColumnLabelSet, inputs: ColumnLabelRuleInputs): string[];
```

- **Key shape.** The plan says `{en, he, es}` per `section.column`. Writing 637 entries would repeat "Created at" 37 times, and repetition is where copies drift apart. Resolution is still per `section.column`: a section entry wins, then the key entry. In practice almost every key lives in `COLUMN_LABELS_BY_KEY`, and `SECTION_COLUMN_LABELS` holds only the few keys whose meaning differs between modules. Deviation from the plan's wording, put to SA as MX2B-2.
- **Imports.** `server-only` plus three **type-only** imports. No runtime import: no descriptors, no module map, no repository, no logger. A pure data file has nothing to log, so there is no Pino gap (as `joinedCsv.ts`). `server-only` keeps about 1,300 strings out of any browser bundle (requirement §4.2: server-only, not the client bundles).
- **No backslash escapes.** Hebrew is written as literal text. Any bidi-control check builds its characters with `String.fromCharCode`, so no backslash-hex sequence appears in a file under `lib/` (Tailwind scans it; PR #180).

### 2.2 Resolution and the fallback rule

```text
fixed(key, lang)          -> FIXED_COLUMN_LABELS[key][lang]        -> .en -> key
recordType(section, lang) -> RECORD_TYPE_LABELS[section][lang]     -> .en -> section id
column(section, key, lang)-> columnLabelText(section, key)?.[lang] -> .en -> key
```

A value counts as missing when it is not a string or is blank after trim.

**Decision: missing language → English → the raw key. Never throw.**

- en and he must be complete, and es non-empty (L-1, L-2), so for every real column the fallback can never be reached. It only covers the impossible case, e.g. a section added to the map while the CI rule is skipped.
- English before the key, because a readable English header beats `stage_entered_at` for any owner. For a Spanish draft that is missing, English is the nearest a Spanish owner can read.
- Never throw, because a header is presentation. What may leave the system is decided by the classification (fail closed in `classifiedColumnsOf`). A label must never fail an export the classification allowed.
- No logging in the fallback: the file is pure. CI is the guard.

### 2.3 How the builder takes the language and the labels (signature change)

**Change in `joinedCsv.ts`:** `JoinedCsvInput.labels` becomes **required** (`labels: JoinedCsvLabels`). The `KEY_ECHO_LABELS` default goes. `buildJoinedCsv` also checks at runtime that `labels` has the three functions, and throws `Error('Joined CSV labels are required')` otherwise. Jest is transpile-only, so the type alone proves nothing; this is fail-closed, as with the unknown-module throw. **SA R-1:** the `KEY_ECHO_LABELS` export is **deleted** from `joinedCsv.ts`; the key-echo labels are defined inline in `__tests__/joinedCsv.test.ts`, so no production module can import them and no repo scan is needed.

Why not keep a default and point it at the new labels (as MX-2a workplan §2.4 assumed):

- `joinedCsv.ts` would then import a `server-only` module. MX-2a's T-17 pin (an SA-checked purity condition) forbids that.
- Keeping the key-echo default would let the MX-3 worker forget the labels and ship `stage_entered_at` headers with every test green.
- Required labels make the omission a type error and a runtime throw. `KEY_ECHO_LABELS` lives only in the test file (SA R-1), so the former guard scan (T-L15) is dropped.

**Callers of `buildJoinedCsv` after the change:**

| Caller | Change |
|---|---|
| `__tests__/joinedCsv.test.ts` `build()` helper (the only call path besides T-15) | Passes the test-local `labels: KEY_ECHO_LABELS` before `...rest`, so every MX-2a assertion on keys is unchanged |
| `__tests__/joinedCsv.test.ts` T-15 "key echo by default" | Replaced by "labels are required: a call without them throws". The injected-Hebrew test and the repeat-boundary test stay |
| `__tests__/columnLabels.test.ts` (new) | Calls the builder with `EXPORT_COLUMN_LABELS` in en, he and es |
| Production | **None today.** The MX-3 worker will be the first. It calls `buildJoinedCsv({ moduleId, language, labels: EXPORT_COLUMN_LABELS, rowsBySection, lookupRowsBySection })`. `language` comes from `userPreferencesRepository.findPreferredLanguage(userId)`, with `'en'` and a `language_unreadable` warn on error, as the MX-1b route does. It is resolved **once per module job, before `parts_total` is fixed**: the header repeats in every part and its bytes count toward the budget, so all parts must share one language (note for the MX-3 workplan, MX2B-11) |

`language` was already a required input in MX-2a, so it is unchanged. No other file imports `buildJoinedCsv`.

### 2.4 The CI rule `columnLabelProblems` (L-1…L-9)

It has the same shape as `exportModuleProblems` and `joinedReferenceProblems`: data in a file, every input passed in, and a run over the real set and over one planted bad set per rule. The test passes in `{ modules: EXPORT_MODULES (id + sections), registeredSections: EXPORT_SECTIONS ids, columnsOf: classifiedColumnsOf }`.

| Rule | What it checks |
|---|---|
| **L-1 Coverage** | Every include column of every section in the map, except `id`, resolves through `columnLabelText`. Every section in the map has a record type |
| **L-2 Every language present** | Every fixed, record-type and column label has `en`, `he` and `es`, each non-empty after trim. es may be a draft, but never blank |
| **L-3 Hebrew reads right-to-left** | Every `he` text contains a Hebrew letter, and **no Latin letter comes before the first Hebrew letter**. The first strong character then sets the cell's direction, so the header renders right-to-left in Excel (§2.5) |
| **L-4 Clean text** | No CR, LF, TAB or `"`; no leading or trailing space; no first character `=` `+` `-` `@` (BC-1 would add an apostrophe to the header); no bidi control character (LRM, RLM, the embeddings and overrides, the isolates). Built from char codes, no backslash escape |
| **L-5 Unique headers per module** | For each module and language: the four fixed labels, plus each distinct non-`id` key labelled as at its first section in module order (exactly as the builder names it). Compared trimmed, NFC and lower-cased, all distinct. Parent-only keys are included (§1.1), so the result does not depend on C-2. A collision with a fixed header ("Record ID") counts |
| **L-6 A shared key has one meaning in its module** | When several sections of one module share a key, `columnLabelText` gives the same text for each. They share one column, so a header reading "Campaign name" over sequence rows would mislead |
| **L-7 Record types unique per module** | Per module and language, no two sections share a record-type name |
| **L-8 No stale entries** | Every `SECTION_COLUMN_LABELS` entry names a registered section and one of its include columns, and is not `id`. Every `COLUMN_LABELS_BY_KEY` entry is used by at least one include column that has no section entry. A removed column cannot leave a label behind to be picked up later by a different column of the same name |
| **L-9 Fixed keys** | `FIXED_COLUMN_LABELS` has exactly the keys of `JOINED_CSV_FIXED_COLUMNS` (the test passes them in) |

The plan's two "Done when" CI tests are L-1 + L-2 (coverage, "every include column has en and he, es non-empty") and L-5 (uniqueness). L-3, L-4 and L-6…L-9 are small additions of the same pure shape, put to SA as MX2B-5 / MX2B-6.

### 2.5 Hebrew, RTL and Excel

- **BOM.** `csvPartText` (csv.ts) writes the UTF-8 BOM at the start of every part, and MX-2a T-14 pins it. Excel uses the BOM to read the file as UTF-8. Without it, Hebrew headers turn into mojibake. Nothing changes here. A test checks that a Hebrew part starts with `CSV_BOM` and that the Hebrew header comes back intact.
- **Cell direction.** Excel keeps the sheet left-to-right (column A on the left) whatever the language, and sets each cell's direction from its first strong character. L-3 makes every Hebrew header start with a Hebrew letter, so it renders right-to-left. Latin words inside a Hebrew label ("חשבון Stripe", "מקור (UTM)") are fine after a Hebrew word. Data cells are not affected.
- **No bidi isolates in headers.** The "Export requested" email uses FSI/PDI (SA CR-4) because it is prose. A header is a key: an invisible control character would break column matching in Excel formulas, Power Query and any import tool, and a reader could not see why. L-4 forbids them.
- **Mixed rows.** A Hebrew header above Latin data (emails, codes, ids) is normal and needs nothing.
- **Comma separator (note, not this slice).** Excel set to a Spanish (Spain) region uses `;` as its list separator, so a comma CSV opened by double-click can land in one column. Hebrew and English regions use `,`. This affects the whole file, not the labels, so it goes to MX-3 / MX-4 as MX2B-9.

### 2.6 Record-type names (SA-P3) — proposed text

Hebrew and Spanish are drafts for native review. The bookings word follows MX-0's choice "הזמנות", which is still the user's call (MX0-8).

| Section | en | he | es |
|---|---|---|---|
| `clients` | Client | לקוח | Cliente |
| `pipeline_stages` | Pipeline stage | שלב בפייפליין | Etapa del embudo |
| `client_documents` | Document | מסמך | Documento |
| `client_activities` | Activity | פעילות | Actividad |
| `client_tasks` | Task | משימה | Tarea |
| `bookings` | Booking | הזמנה | Reserva |
| `time_off` | Time off | זמן חסום | Tiempo no disponible |
| `services` | Service | שירות | Servicio |
| `quotes` | Quote | הצעת מחיר | Presupuesto |
| `invoices` | Invoice | חשבונית | Factura |
| `payments` | Payment | תשלום | Pago |
| `refunds` | Refund | החזר | Reembolso |
| `client_payment_methods` | Saved payment method | אמצעי תשלום שמור | Método de pago guardado |
| `payment_plans` | Payment plan | תוכנית תשלום | Plan de pago |
| `client_payment_plans` | Client payment plan | תוכנית תשלום של לקוח | Plan de pago del cliente |
| `installments` | Installment | תשלום בתוכנית | Cuota |
| `intake_settings` | Intake form settings | הגדרות טופס לקוח | Ajustes del formulario de admisión |
| `intake_forms` | Intake form | טופס לקוח | Formulario de admisión |
| `email_campaigns` | Email campaign | קמפיין אימייל | Campaña de email |
| `email_sequences` | Email sequence | רצף אימיילים | Secuencia de emails |
| `email_sequence_steps` | Sequence step | שלב ברצף | Paso de la secuencia |
| `email_sequence_enrollments` | Sequence enrollment | רישום לרצף | Inscripción en la secuencia |
| `newsletter_subscribers` | Newsletter subscriber | מנוי לניוזלטר | Suscriptor del boletín |
| `consent_records` | Consent record | תיעוד הסכמה | Registro de consentimiento |
| `consent_settings` | Consent settings | הגדרות הסכמה | Ajustes de consentimiento |
| `email_unsubscribes` | Email unsubscribe | הסרה מרשימת התפוצה | Baja de emails |
| `website_content` | Website content | תוכן האתר | Contenido del sitio web |
| `website_pages` | Page | עמוד | Página |
| `website_blocks` | Page block | רכיב בעמוד | Bloque de página |
| `images` | Picture | תמונה | Imagen |
| `smart_links` | Smart link | קישור חכם | Enlace inteligente |
| `account_identity` | Sign-in account | חשבון כניסה | Cuenta de acceso |
| `user_profile` | Profile | פרופיל | Perfil |
| `preferences` | Preferences | העדפות | Preferencias |
| `notification_settings` | Notification settings | הגדרות התראות | Ajustes de notificaciones |
| `business_profile` | Business profile | פרופיל העסק | Perfil del negocio |
| `business_addresses` | Business address | כתובת העסק | Dirección del negocio |
| `payment_account` | Stripe account | חשבון Stripe | Cuenta de Stripe |
| `payment_providers` | Payment provider | ספק תשלומים | Proveedor de pagos |

**Fixed headers:** Record type / סוג רשומה / Tipo de registro · Belongs to / שייך ל־ / Pertenece a · Record ID / מזהה רשומה / ID del registro · Parent ID / מזהה רשומת האב / ID del registro principal.

### 2.7 Wording conventions for column labels

- Plain words the owner uses in the app. Where the app's own Hebrew already names something (e.g. "פייפליין", "טופס לקוח", "קישור חכם"), the label uses the same word. The bundles are read for wording only and never imported.
- Sentence case in en and es ("Created at", "Fecha de creación").
- A unit or code goes in brackets when it matters: "Duration (minutes)", "Amount (minor units)", "Stripe charge ID".
- A key that differs from a sibling only by a suffix must say how: `cancel_reason` "Cancellation reason (code)" and `cancellation_reason` "Cancellation reason (text)"; `refund_fee` and `fee_returned`; `paid_at` and `payment_received_at`; `notes`, `internal_notes` and `payment_notes`. L-5 catches any that are missed.
- Shared keys keep a generic label because they share a column (L-6). Account & business example: `email` is both the sign-in email and the business email, so the header is "Email"; `theme` is both the app theme and the website theme, so the header is "Theme". The Record type column tells the rows apart.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/data-export/columnLabels.ts` | create | Labels, resolution, `EXPORT_COLUMN_LABELS`, `columnLabelProblems` (§2.1–2.4) |
| `lib/business-os/data-export/__tests__/columnLabels.test.ts` | create | L-1…L-9 over the real set, negative controls, builder end-to-end en/he/es, purity and escape scan, `KEY_ECHO_LABELS` guard (§5) |
| `lib/business-os/data-export/joinedCsv.ts` | modify | `labels` required + runtime check; header comment and JSDoc ("MX-2b fills it", "until MX-2b") brought up to date; `KEY_ECHO_LABELS` export **deleted** (SA R-1). **No builder logic change**; T-17 import list unchanged |
| `lib/business-os/data-export/__tests__/joinedCsv.test.ts` | modify | `KEY_ECHO_LABELS` defined inline (SA R-1); `build()` passes it; T-15 "key echo by default" becomes "labels are required" |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify (found in implementation) | One entry in the DE-8b `LOWER_CASE_EXEMPT` list for `columnLabels.ts`, with its reason (L-5 case-insensitive header comparison, SA MX2B-5). See Implementation Notes D-1 |
| `docs/workplans/BUSINESS_OS_EXPORT_MX2B_WORKPLAN.md` | create | This file |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` | modify (done with this workplan) | BQ-31 ticked with the user's answer; §4.3 Language row aligned; Change History. §6 stage lines later (memory: always update the main requirement) |
| `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` | modify (done with this workplan) | §4.3 and §6 BQ-31 answered, workplan link, Change History |

Not touched: `csv.ts`, `joinedCsvReferences.ts`, `exportModules.ts`, any translation bundle (`lib/business-os/translations/*`), `stageLabels.ts`, any route, repository, migration or hotspot file. `console.*`: none of the touched code files has any (counted: `joinedCsv.ts` 0, `joinedCsv.test.ts` 0); the new files will have none.

---

## 4. Task list

- ✅ Step 0: Branch `feature/bos-export-mx2b-column-labels` confirmed (`git branch --show-current`, base `7d641ac2`); CC-1 coordination file read; BQ-31 recorded in the requirement and the plan.
- ✅ Step 1: SA ruling received (APPROVED WITH CHANGES, R-1…R-3); user answered MX2B-Q1…Q3 2026-10-28 (§8.2: all cells as stored).
- ✅ Step 2: `joinedCsv.ts`: `labels` required, runtime check, comments updated, `KEY_ECHO_LABELS` export deleted (R-1). `joinedCsv.test.ts`: inline `KEY_ECHO_LABELS`, helper + T-15 → T-L13.
- ✅ Step 3: `columnLabels.ts`: types, four fixed labels, 39 record types (§2.6), resolution and fallback (§2.2), `EXPORT_COLUMN_LABELS`, `columnLabelProblems` L-1…L-9.
- ✅ Step 4: `columnLabels.test.ts` with a negative control per rule; each control asserts the exact problem string, so a rule that does not bite fails.
- ✅ Step 5: Column labels en / he / es for every key (with 3 section overrides). The real set passed L-1…L-9 on the first run.
- ✅ Step 6: Builder end-to-end en/he/es over all 13 modules (39 cases) + Clients detail + BOM round trip.
- ✅ Step 7: Checks run (see Implementation Notes).
- ✅ Step 8: Review table generated outside the repo (session scratchpad `mx2b-labels.md`).
- [ ] Step 9: CC-5 log line + message to DELETE; requirement §6 stage line via BA / general-purpose agent (TL to route; not done by Dev in this run).

Effort: 🟢 1.5 d as planned. About half of it is writing and checking the ~1,300 strings, which is the risk (§9).

---

## 5. Tests

All in `lib/business-os/data-export/__tests__/`. `jest.config.js` collects `**/__tests__/**/*.ts`, and the PR gate (`npm run test:gate`, `.github/workflows/tests.yml`) runs everything `npm test` collects minus the quarantine list. The new file is therefore in the required gate without any config edit. Pure, no I/O, small: milliseconds (no added CI time).

| # | Test | Negative control |
|---|---|---|
| T-L1 | `columnLabelProblems(REAL, realInputs)` is `[]` | — |
| T-L2 | L-1 coverage | Remove the `he` of one column → reported; delete one key entry → reported; add a planted include column with no label → reported; remove one record type → reported |
| T-L3 | L-2 every language | Blank `es` (spaces) → reported; missing `en` on a fixed label → reported |
| T-L4 | L-3 Hebrew direction | `he: 'Stripe חשבון'` (Latin first) → reported; `he: 'Client'` (no Hebrew letter) → reported |
| T-L5 | L-4 clean text | A label starting `=`; one with LF; one with an RLM built from a char code → each reported |
| T-L6 | L-5 uniqueness | Two keys of one module given the same `en` → reported; same text differing only in case or spacing → reported; a column labelled "Record ID" → reported; the same text in two **different** modules → **not** reported |
| T-L7 | L-6 shared key | A section entry giving a shared key a different text in one section → reported |
| T-L8 | L-7 record types | Two sections of one module with the same `he` record type → reported |
| T-L9 | L-8 stale | A section entry for a non-include column; a key entry used by no section → each reported |
| T-L10 | L-9 fixed keys | A missing or extra fixed key → reported |
| T-L11 | Builder end-to-end | For each of en / he / es: Clients module header starts with the fixed "Record type" / "Belongs to" text and ends with "Record ID" / "Parent ID"; record-type cell "Client" / "לקוח" / "Cliente"; `first_name` cell `Dana` unchanged; `clients.stage` shows the stored label `Lead` (stages passed) and the raw key `lead` (none passed) in **every** language (BQ-31: the owner's values are not translated); `it.each` over all 13 modules × 3 languages: every header cell non-empty, header unique, width = union + 4; a Hebrew part from `csvPartText` starts with `CSV_BOM` and parses back to the same Hebrew header |
| T-L12 | Fallback | Planted set: missing `es` → English; missing everywhere → raw key; `fixed` / `recordType` likewise; never throws |
| T-L13 | Labels required | `buildJoinedCsv` without `labels` throws (in `joinedCsv.test.ts`, replacing "key echo by default") |
| T-L14 | Purity + escapes | `columnLabels.ts` imports exactly `server-only` plus the three type-only imports; no repository / logger / Supabase / translation bundle; no backslash-u / backslash-x sequence (same scanner as MX-2a T-17); negative control with a planted import |
| ~~T-L15~~ | ~~`KEY_ECHO_LABELS` stays in tests~~ | **Dropped (SA R-1):** the export is deleted from `joinedCsv.ts` and defined inline in the test file |

Source scans normalise CRLF before matching (memory: Jest local-vs-CI CRLF patterns).

---

## 6. Acceptance criteria

- ✅ Every include column of every section has a label in en and he, and es is non-empty (CI L-1 / L-2, with negative controls).
- ✅ No two different keys in one module share a label in any language, fixed headers included (CI L-5, with negative controls).
- ✅ The builder emits the headers and record-type names in the language passed (en / he / es); data cells, lookups included, are unchanged in every language.
- ✅ `buildJoinedCsv` cannot be called without labels (type + runtime); `KEY_ECHO_LABELS` exists only inside `joinedCsv.test.ts` (SA R-1).
- ✅ `columnLabels.ts` is `server-only`, has no runtime import, and contains no backslash-hex sequence.
- ✅ `npx jest lib/business-os/data-export` and `npm run test:gate -- lib/business-os/data-export` green; typecheck clean for touched files; nothing outside §3 changed (§3 updated for the one exemption entry, D-1).
- ✅ Requirement AC (§7 MX-2a / MX-2b): "Headers are in the owner's language; every exported column has a label in en and he (CI); no two keys in one module share a label (CI)."

---

## 7. Coordination

| Step | Action |
|---|---|
| CC-1 | ✅ Done 2026-10-28 (coordination file read; no lock, no reservation touches E3) |
| CC-5 | Log line + `SendMessage` to `Admin user/business deletion button` (`[EXPORT→DELETE] MX-2b <event>`) on: workplan approved, PR opened, PR merged |
| CC-8 | After merge: EXPORT status row updated. No lock to release |
| Shared files | None. Every touched file is under `lib/business-os/data-export/**` (EXPORT, B.1) or EXPORT's own docs. The translation bundles are not edited, so the CC-6 anchor is not needed |

---

## 8. Open items for SA and questions for the user

### 8.1 For SA

| # | Item | Proposal |
|---|---|---|
| MX2B-1 | How the builder gets the labels. MX-2a §2.4 said "MX-2b passes it as the default", but a default would make `joinedCsv.ts` import a `server-only` file and break MX-2a's T-17 purity pin | `labels` **required**, no default; runtime check; `KEY_ECHO_LABELS` tests-only with a guard (T-L15). Alternative: a server-only wrapper `buildModuleCsv` next to the labels that fills them in; rejected because it adds a second entry point MX-3 could bypass |
| MX2B-2 | Key shape: the plan says "per `section.column`" | Resolution per `section.column` (section entry → key entry); storage by key with a few section overrides, so a common column is written once. L-6 / L-8 keep overrides honest |
| MX2B-3 | Coverage of `id` and of parent-only columns | `id` covered by the fixed "Record ID"; parent-only columns labelled anyway (§1.1) |
| MX2B-4 | Fallback | language → en → raw key, never throw (§2.2) |
| MX2B-5 | Uniqueness normalisation | trim + NFC + lower-case; fixed headers included; parent-only keys included |
| MX2B-6 | Extra rules beyond the plan's two (L-3 Hebrew first, L-4 clean text, L-6, L-7, L-8, L-9) | Accept: same pure-rule pattern as `exportModuleProblems`, milliseconds, each with a control |
| MX2B-7 | Scope of the `KEY_ECHO_LABELS` scan (T-L15) | `lib/business-os/data-export/` and `app/api/` (where the MX-3 worker lands). Drop it if SA finds the required type + runtime check enough |
| MX2B-8 | Native review of ~400 Hebrew labels | Generated review table in the scratchpad for the user before the PR; Hebrew is correctable later as a data-only edit; Spanish ships as a draft (requirement §4.3) |
| MX2B-9 | Spanish-region Excel uses `;` (§2.5) | Not this slice; note for the MX-3 / MX-4 email copy ("open with Data → From text") or a later option. No `sep=` line: it defeats the BOM in Excel |
| MX2B-10 | Record types unique per module (L-7) or across all modules | Per module (what a reader sees in one file); today's names are also globally unique |
| MX2B-11 | Note for MX-3 | Resolve the language once per module job, before `parts_total`, with the MX-1b pattern (`findPreferredLanguage`, `'en'` + `language_unreadable` warn) |
| MX2B-12 | Superseded text | MX-2a workplan §2.4 "passes it as the default" and `joinedCsv.ts` comments "until MX-2b" are updated by this slice (code comments) and noted here; the merged MX-2a workplan is not edited |

### 8.2 For the user (BQ-31 follow-ups) — ✅ ANSWERED 2026-10-28

**User decision 2026-10-28 (verbatim):** "Q1–Q3: keep all cell values as stored (status codes, stage names, true/false)."

So no cell value is translated in this slice: status codes, pipeline stage names (seeded or renamed) and `true` / `false` are written exactly as stored, in every language. The questions as they were put are kept below for the record.

- **MX2B-Q1 Status words in the file.** Many columns hold words the platform chose, not the owner: a booking's status ("cancelled", "no_show"), an invoice's status ("paid"), an activity's type, a payment method ("card"). Today they appear in the file as these short English codes, in every language. Should they be translated into the owner's language, like the headers? **Recommendation: not in this step.** Keep the codes now. If you want them translated, it is a separate small step (about 1.5–2 days): every such column must be checked against the database for its exact list of values, and each value needs three translations. A code the list does not know stays as stored. Columns that mix platform and owner text (e.g. a booking's free-text cancellation reason) stay as stored either way.
- **MX2B-Q2 Pipeline stages the platform created.** When you set up your account, the platform created your pipeline stages (e.g. "Inquiry", "Active client") in the language you used then. If you never renamed a stage, the app already shows it in your current language. Should the export do the same, or show the stage name exactly as stored? **Recommendation: exactly as stored** (simplest, and it never touches a stage you renamed). Alternative: translate only stages you never renamed, as the app does. This affects the client's stage column and the stage rows in the Clients file.
- **MX2B-Q3 Yes / no cells.** On / off settings appear as `true` / `false`. Keep them like that? **Recommendation: yes.** They are the same in every language and every spreadsheet tool reads them; changing them would also change the shared CSV writer.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| ~1,300 strings in 1.5 d; Hebrew quality | Common keys written once (MX2B-2); CI checks completeness and collisions, not quality, so the review table (Step 8) goes to the user; risk of +0.5 d noted |
| A column added to a descriptor later has no label | L-1 fails CI in the PR that adds it; the runtime fallback (English, then key) never breaks an export |
| MX-3 forgets the labels | `labels` required (type + runtime throw) + T-L15 |
| A Hebrew header renders left-to-right or jumbled | L-3 (Hebrew first strong letter), L-4 (no bidi controls); BOM per part already pinned |
| A shared key's header misdescribes another section's rows | L-6 forces a generic label for a key shared inside one module |
| Tailwind build break from an escape | Literal Hebrew; char codes for controls; T-L14 scan |
| Scope creep into cell values | BQ-31 working definition (§1.2); MX2B-Q1/Q2/Q3 go to the user; no cell value changes in this slice |

---

## SA Review Notes

## SA Workplan Review — 2026-10-28

**Reviewed by SA — 2026-10-28** (read on branch `feature/bos-export-mx2b-column-labels`; checked `joinedCsv.ts`, `joinedCsv.test.ts` T-17, `app/api/business-os/export-requests/route.ts`, `UserPreferencesRepository.findPreferredLanguage`, `jest.gate.config.js`, `jest.config.js` `server-only` mapping)
**Status:** APPROVED WITH CHANGES — proceed to implementation once R-1 is folded into §2.3 / §3 / §5. No user answer blocks the slice: the defaults (every cell as stored) are the approved scope.

### Rulings on §8.1

| # | Ruling |
|---|---|
| MX2B-1 | **Approved.** `labels` required, no default, plus the runtime throw (Jest is transpile-only, so the type alone proves nothing). This is the only shape that keeps `joinedCsv.ts` inside its T-17 import pin; the five-module import list must stay byte-identical. The `buildModuleCsv` wrapper is correctly rejected (second entry point). `columnLabels.ts` importing `JoinedCsvLabels` / `JoinedCsvFixedColumn` from `joinedCsv.ts` must be `import type` (erased; no runtime edge). **Change R-1 below on `KEY_ECHO_LABELS`.** |
| MX2B-2 | **Approved: storage by key with section overrides.** The plan's "per `section.column`" is a contract on *resolution* (what label a given section.column gets), not on storage layout; `columnLabelText(section, key)` satisfies it. The coverage rule (L-1) must iterate every section.column pair from `classifiedColumnsOf` (the 637), never the key list, so the plan's Done-when is tested literally. Overrides are allowed only where one key means different things **across** modules; within a module L-6 forbids divergence anyway. |
| MX2B-3 | **Approved.** `id` covered by the fixed `record_id`; parent-only columns labelled anyway (removes the C-2 dependency). |
| MX2B-4 | **Approved.** language, then en, then raw key; never throw; no logging (pure file, CI is the guard). |
| MX2B-5 | **Approved.** trim + NFC + lower-case, fixed headers and parent-only keys included. Use `toLowerCase()` (not locale-sensitive). |
| MX2B-6 | **Approved, with a cap.** L-1, L-2 and L-5 are the plan's required rules, each with negative controls (mandatory). L-3, L-4, L-6, L-7, L-8, L-9 are accepted because they live in the one pure `columnLabelProblems` function, run in milliseconds and each guards a real failure (RTL rendering, BC-1 apostrophe, misleading shared column, stale override). Cap: one negative control per extra rule is enough; do not grow beyond L-9 in this slice. If the strings run late, the extras are the first thing to defer, never L-1/L-2/L-5. |
| MX2B-7 | **Replaced by R-1.** Drop T-L15. |
| MX2B-8 | **Approved.** Review table in the session scratchpad, not the repo. Hebrew native review is not a merge gate (labels are a data-only edit later); Spanish ships as a draft per the plan. |
| MX2B-9 | **Approved as a note** for MX-3 / MX-4. No `sep=` line (it defeats the BOM). |
| MX2B-10 | **Approved.** Per module. |
| MX2B-11 | **Approved; the pattern matches MX-1b** (`route.ts` line ~98: `findPreferredLanguage`, warn `code: 'language_unreadable'`, fall back to `'en'`; `SupportedLanguage` is the same union as `ExportModuleLanguage`). Note for the MX-3 workplan: prefer resolving once **per request** (or persisting it on the job row) rather than per module job, so two modules of one request cannot come out in different languages if the owner changes language mid-run. MX-3's call, not this slice's. |
| MX2B-12 | **Approved.** Update the `joinedCsv.ts` comments ("until MX-2b", "key echo by default"); do not edit the merged MX-2a workplan. |

### Required changes

- **R-1 (Medium) — move `KEY_ECHO_LABELS` out of production code.** Instead of keeping it exported from `joinedCsv.ts` as "tests only" and guarding it with a repo scan (T-L15), delete the export and define the key-echo labels inside `__tests__/joinedCsv.test.ts` (inline, not a separate helper under `__tests__/`, which the testMatch would collect as an empty suite). A production module then cannot import it at all, and T-L15 (with its `app/api/` scan scope question) is not needed. Adjust §2.3, §3, §5 (T-L13 stays; T-L15 removed) and §6 AC 4 accordingly.
- **R-2 (Low) — CI gate confirmation.** The new suite lands in the required gate with no config edit (confirmed: `jest.gate.config.js` spreads `jest.config.js`; `server-only` is mapped to `__mocks__/server-only.js`, so the test can import `columnLabels.ts`). Do not add it to the quarantine list. Record in the implementation notes that `npm run test:gate -- lib/business-os/data-export` was run, not only `npx jest`.
- **R-3 (Low) — standards.** No `console.*` in any touched file (currently 0, keep it so); strict TS, no `any` (`COLUMN_LABELS_BY_KEY` is `Record<string, LabelText>`, so index lookups must handle `undefined`; `noUncheckedIndexedAccess` may be off, so write the `?.` explicitly as §2.2 shows). Literal Hebrew; the bidi-control set for L-4 built with `String.fromCharCode`; T-L14 byte scan over both new files.

### Technical note on MX2B-Q1…Q3 (for the user via TL; SA states cost/risk only, the choice is the user's)

- **Q1 (translate platform status codes in cells):** cost about 1.5–2 d as Dev says. It breaks the pinned MX-2a invariant "data cells never pass through the labels", so it needs a new per-column value-vocabulary path in the builder, each column's value set verified against the live schema (CHECK constraints / enums), a fallback for unknown codes, and a new CI rule for vocabulary drift. Risk: translated codes make the file language-dependent for filtering, formulas and any re-import, and mixed platform/owner columns (`cancellation_reason`, `source`) can never be translated safely.
- **Q2 (pipeline stages the platform seeded):** about 0.5 d. Needs `localizeStageLabel` (or its data) reachable from a pure path, and must be applied identically to `pipeline_stages` rows and to the `clients.stage` lookup, or the two disagree in one file. Risk: an owner who deliberately kept a seeded name in another language sees it changed in the export.
- **Q3 (true/false):** changing it touches the shared `csv.ts` encoder (every CSV, BC-1-pinned) or adds a per-column builder rule; low value, and `true`/`false` is the most tool-readable form. Lowest-risk option is keeping it.

### Approval
[x] Workplan approved with R-1…R-3 — proceed to implementation

## Implementation Notes

**Dev, 2026-10-28, worktree `neuronforge-mx2b`, branch `feature/bos-export-mx2b-column-labels`. Not committed.**

### SA review items folded in

| Item | How |
|---|---|
| R-1 | `KEY_ECHO_LABELS` export deleted from `joinedCsv.ts`; defined inline in `joinedCsv.test.ts`. T-L15 dropped. T-17's five-import list for `joinedCsv.ts` is unchanged (the test passes as written) |
| R-2 | `columnLabels.test.ts` is collected by the gate with no config edit and is not in the quarantine. Ran `npm run test:gate -- lib/business-os/data-export` (the gate config restricted to the export folder, not the full gate): 21 suites, 718 tests, all passed |
| R-3 | 0 `console.*` in all touched files; no `any`; keyed lookups go through an own-property helper (`own`), and all optional reads use explicit `?.`; Hebrew written literally; the bidi-control set for L-4 is built with `String.fromCharCode`; T-L14 scans both new files for backslash-u / backslash-x (0 hits, also checked with grep) |
| MX2B-1 | `labels` required + runtime throw `'Joined CSV labels are required'` (also when one of the three functions is missing). `columnLabels.ts` imports `JoinedCsvFixedColumn` / `JoinedCsvLabels` with `import type` |
| MX2B-2 | L-1 iterates every section.column pair from `classifiedColumnsOf` (passed in as `columnsBySection`), not the key list. Three section overrides, each where one key means something different in another module: `website_content.services` ("Services section"), `smart_links.source` ("UTM source"), `smart_links.content` ("UTM content") |
| MX2B-5 | Plain `toLowerCase()` after trim + NFC |
| MX2B-6 | L-1, L-2, L-5 have several negative controls; L-3, L-4, L-6…L-9 have one each (L-3 and L-4 test two or three planted values in their one control). Nothing beyond L-9 |
| MX2B-11 | **Note for the MX-3 workplan (not built here):** resolve the owner's language once **per request**, or store it on the job row, rather than per module job, so two modules of one request cannot come out in different languages if the owner changes language mid-run. Pattern: `findPreferredLanguage`, `'en'` + warn `code: 'language_unreadable'` on error (MX-1b route) |

### Deviations

- **D-1: one line added to `exportClassification.test.ts` (outside the original §3).** The DE-5 M-5 currency guard bans `.toLowerCase(` in every file under `lib/business-os/data-export/`, except files on the reviewed `LOWER_CASE_EXEMPT` list (DE-8b). L-5 uses `toLowerCase()` as SA ruled (MX2B-5), so the gate failed until `columnLabels.ts` was added to that list with its reason ("CI rule L-5 compares CSV header labels case-insensitively; labels only, never a cell value"). The exemption covers only `.toLowerCase(`; every other currency pattern still applies to the file. The DE-8b control's test title said "its two files"; it now says "its listed files". **SA to confirm the exemption entry.** Rejected alternative: a case-fold that avoids the literal call, which would dodge the guard instead of declaring the exception.
- **D-2: own-property lookups.** The label tables are plain objects, so a column named `constructor` or `toString` would otherwise resolve to an `Object.prototype` member. Resolution uses `hasOwnProperty`; T-L12 has a case for it.
- **D-3: `REAL_COLUMN_LABELS` and `joinedCsvLabelsFrom(set)` exported** (not in §2.1): the rule and the fallback test need the real set and a planted set in one loose shape, as `REAL_JOINED_REFERENCES` does.
- **D-4: L-8 also reports a record type for an unregistered section** (one line, within L-8).

### Checks

| Check | Result |
|---|---|
| `npx jest lib/business-os/data-export/__tests__/columnLabels.test.ts` | 69 passed |
| `npx jest …/joinedCsv.test.ts` | 101 passed (170 together with columnLabels) |
| `npm run test:gate -- lib/business-os/data-export` | 21 suites, 718 tests passed (after D-1; before D-1, 1 failure: the M-5 scan) |
| `npx tsc --noEmit -p .` filtered to the touched files | Full run finished (exit 2, 1,864 pre-existing errors repo-wide, no OOM / V8 trace). 0 errors in `columnLabels.ts`, `joinedCsv.ts` or their tests. The one hit in a touched file, `exportClassification.test.ts:2030` (TS2353 `scope`), is the same line on HEAD (2029), so it predates this slice. Re-checked after the last edit with a tsconfig limited to the four MX-2b files: exit 0, 0 errors |
| `npx eslint` on the 5 touched code files | 0 errors, 0 warnings |
| Backslash-hex and `console.` grep over touched files | 0 / 0 |

### Label review

A review table (fixed headers, record types, and each column key once per module as the header shows it) is in the session scratchpad as `mx2b-labels.md`, outside the repo. Hebrew is for the user's (or a native speaker's) review; Spanish is a draft. Wording choices worth a look: `is_scheduled` "Needs a booking", `source_surface` "Collected on", `proposal_id` "Proposal ID", `amount_minor` "סכום (ביחידות הקטנות)", `invoice_tax_id` "NIF en las facturas" (Spain-specific).

## SA Code Review — 2026-10-28

**Reviewed by SA — 2026-10-28** (uncommitted diff vs `7d641ac2`, worktree `neuronforge-mx2b`)
**Status:** APPROVED. Code approved for QA: **Yes**. No blocking findings.

### Rulings carried from the workplan review

| Item | Verified |
|---|---|
| R-1 | `KEY_ECHO_LABELS` is gone from `joinedCsv.ts` and defined inline in `joinedCsv.test.ts`; no production import exists. T-17 import list for `joinedCsv.ts` is unchanged |
| R-2 | Suite collected by the gate with no config edit. SA reran `npx jest lib/business-os/data-export`: 21 suites, 718 tests passed |
| R-3 | 0 `console.*`, no `any`, no backslash-hex in either new file; Hebrew is literal; bidi set built with `String.fromCharCode`; optional reads use explicit `?.` |
| MX2B-1 | `labels` required in the type plus a runtime throw that also catches a partial object (T-L13 covers both). `columnLabels.ts` imports from `joinedCsv.ts` with `import type` only, so there is no runtime cycle and `joinedCsv.ts` stays pure |
| MX2B-2 | L-1 iterates `classifiedColumnsOf` section.column pairs (via `columnsBySection`), not the key list |
| MX2B-5 | `trim()` + `normalize('NFC')` + plain `toLowerCase()` |
| MX2B-6 | L-1/L-2/L-5 with several controls; L-3, L-4, L-6…L-9 with one each; nothing beyond L-9 |

### Code Review Comments

1. `columnLabels.ts:27` — `import 'server-only'` is the first import; the module is pure (type-only imports, no I/O, no logger). Correct. — Info
2. `joinedCsv.ts:335-350` — labels reach only the header row (`labels.fixed`, `labels.column`) and the record-type cell (`labels.recordType`, a label the builder chooses, not stored data). Every data cell still goes through `csvLine` as stored. The user decision of 2026-10-28 (no cell translation) holds. — Info
3. Section overrides, checked against the live classification: `website_content.services` is a page-section column, while `business_profile.services` is the business's list of services, so "Services section" is a genuine different meaning. `smart_links.source` / `smart_links.content` sit beside `medium` / `campaign` (already "UTM medium" / "UTM campaign" by key) and are UTM parameters, while `source` elsewhere (clients, services, refunds, newsletter_subscribers, images) is a record's origin and `content` in `website_blocks` is block content. All three are genuine. — Info
4. Hebrew spot-check (about 400 entries read): no wrong-meaning labels found. One wording for the native reviewer: `installment_amount` "סכום לתשלום" reads as "amount to pay"; "סכום כל תשלום" is closer to "Installment amount". Data-only, not blocking. — Low
5. Spanish `invoice_tax_id` "NIF en las facturas" is Spain-specific (already flagged by Dev); acceptable for a draft per requirement §4.3. — Low

### Deviation rulings

- **D-1 — Confirmed.** The `LOWER_CASE_EXEMPT` entry is the right mechanism: it declares the exception in the reviewed list with a reason, and it is scoped to `.toLowerCase(` only, so every other M-5 currency pattern still applies to `columnLabels.ts`. A case-fold that avoids the literal call (for example `localeCompare` with `sensitivity`) would dodge the guard and is locale-sensitive, which MX2B-5 ruled out. The DE-8b title change ("its listed files") is correct.
- **D-2 — Approved.** Own-property lookups stop a column named `constructor` or `toString` from resolving to an `Object.prototype` member; the test case is the right control.
- **D-3 — Approved.** Exporting `REAL_COLUMN_LABELS` and `joinedCsvLabelsFrom` follows the `REAL_JOINED_REFERENCES` precedent; both live in a server-only file, so nothing reaches a browser bundle. MX-3 must pass `EXPORT_COLUMN_LABELS`, never build its own set.
- **D-4 — Approved.** Reporting a record type for an unregistered section is the same staleness rule as the section-override check: one line, within L-8 and the MX2B-6 cap.

### Optimisation Suggestions

- None for code. Items 4 and 5 go into the native review of `mx2b-labels.md`.

### Code Approved for QA: Yes

## QA Testing Report

## QA Report — 2026-10-28

**QA — 2026-10-28** (uncommitted diff vs `7d641ac2`, worktree `neuronforge-mx2b`, including TL's post-SA edit `columnLabels.ts:277` he `installment_amount` = 'סכום כל תשלום')
**Test mode:** full
**Strategy used:** A (Jest unit: pure label data, CI rules, builder) + C (a throwaway Jest file that built a real Hebrew CSV part, deleted afterwards)
**Focus:** schema, api (builder)
**Skipped:** DB and live UI. There are none in this slice; the live checks are E6.1 (plan R-4)
**Input source:** TL prompt + plan §4.3 Done when + workplan §6

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Every include column of every section has en + he, es non-empty (CI L-1/L-2) | ✅ | Pass | T-L1 green on the real set. Own negative control: blanked he of `installment_amount` gave 8 failures (T-L1 + L-1/L-2 controls) |
| No two keys in one module share a label in any language (CI L-5) | ✅ | Pass | Own negative control: en `installment_amount` set to 'Total amount' (same module as `total_amount`) failed T-L1, the T-L6 group and `payment_plans in en` unique-header |
| Negative controls actually bite | ✅ | Pass | Both breaks were made in place and the file restored from a scratch copy. sha256 before and after is identical (`6f307a35…5064`); `git status` shows no residue |
| Builder emits owner-language headers en/he/es | ✅ | Pass | T-L11 (13 modules × 3 languages) + own sample (below) |
| Missing or partial labels throw | ✅ | Pass | `joinedCsv.test.ts:510-514`: missing and partial `labels` both throw 'Joined CSV labels are required' |
| Data cells never translated (user decision 2026-10-28) | ✅ | Pass | Own check: clients module built in he and en with a Hebrew first name; every data line is identical after the record-type cell (`דנה`, `Levi`, `Lead`, `lead`, ids). Only the record-type label differs ('לקוח' / 'Client') |
| `columnLabels.ts` is server-only, has type-only imports and no backslash-hex | ✅ | Pass | Lines 27-30: `server-only` + 3 `import type`. Backslash-u/x grep over the 3 code files: 0; `console.` 0 |
| Happy path + failure path (CLAUDE.md) | ✅ | Pass | Happy: T-L1/T-L11. Failure: T-L13 throw, T-L2…T-L10 controls, fallback T-L12 |
| Jest + gate green | ✅ | Pass | `npx jest lib/business-os/data-export`: 21 suites, 718 passed. `npm run test:gate -- lib/business-os/data-export`: 21 suites, 718 passed |
| Callers of joinedCsv | ✅ | Pass | A repo grep for `joinedCsv`/`buildJoinedCsv` found only files in `lib/business-os/data-export/` (columnLabels, joinedCsv, joinedCsvReferences + their 3 tests). All are in the 718 above; no production caller |
| Typecheck of touched files | ✅ | Pass | A tsconfig limited to the 5 touched code files (scratchpad, 8 GB heap) completed with no OOM or V8 trace. 1 error: `exportClassification.test.ts:2030` TS2353 `scope`, which is the identical line 2029 on `7d641ac2`, so it predates this slice. 0 errors in `columnLabels.ts`, `joinedCsv.ts` or their tests |

### Hebrew CSV sample (throwaway test, deleted)

The clients module was built in `he` with `EXPORT_COLUMN_LABELS` and passed through `csvPartText`, then checked:

- The first 3 bytes are `EF BB BF` (BOM).
- The rest decodes with `TextDecoder('utf-8', { fatal: true })` without error.
- The decoded header equals `csv.header` and contains Hebrew letters.

First header line:

```text
סוג רשומה,שייך ל־,שם פרטי,שם משפחה,אימייל,טלפון,שלב,מועד הכניסה לשלב,תגיות,שדות מותאמים,הערות,מקור,פרטי המקור,אתר מפנה,מקור (UTM),מדיום (UTM),קמפיין (UTM),תאריך יצירה,תאריך עדכון,תחום,מפתח השלב,שם השלב,מיקום,צבע,סוג השלב,שלב הלקוח הראשי,שם,סוג המסמך,שם הקובץ,גודל הקובץ (בתים),פורמט הקובץ,תיאור,סטטוס,מזהה רשומה,מזהה רשומת האב
```

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The new suite runs in about 7 s locally inside the existing Jest gate.

#### Edge Cases (nice to fix)
1. Wording only, carried from SA for the native review: es `invoice_tax_id` "NIF en las facturas" is Spain-specific. The he `installment_amount` note is resolved by TL's edit, and that edit is covered by the run above. Severity: Low.

### Leftover check
The throwaway test file was deleted and `columnLabels.ts` restored byte-identical. `git status` shows exactly the 8 slice paths (5 modified, 3 untracked) and no QA residue. The QA scratch files are outside the repo.

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

## Commit Info

_(RM to populate.)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-28 | Created (Dev, EXPORT session, E3) | Workplan for MX-2b: server-only `columnLabels.ts` (fixed headers, 39 record types, column labels by key with section overrides), required `labels` on `buildJoinedCsv`, CI rules L-1…L-9 with negative controls, builder end-to-end en/he/es, Hebrew/RTL notes. BQ-31 recorded (user 2026-10-28) with a working definition of "fixed labels"; lookups investigated (all owner text, untranslated; stage labels ambiguous). Open items MX2B-1…12 for SA; MX2B-Q1…Q3 for the user |
| 2026-10-28 | SA workplan review (SA) | APPROVED WITH CHANGES: MX2B-1…12 ruled (required labels and storage by key + section overrides approved; extra rules L-3…L-9 accepted with a cap); R-1 move `KEY_ECHO_LABELS` into the test file and drop T-L15; R-2 gate confirmation; R-3 standards. Technical cost/risk notes on MX2B-Q1…Q3 for the user |
| 2026-10-28 | Implemented (Dev) — Code Complete | `columnLabels.ts` + `columnLabels.test.ts` created; `joinedCsv.ts` labels required + runtime throw, `KEY_ECHO_LABELS` moved into `joinedCsv.test.ts` (R-1); one `LOWER_CASE_EXEMPT` entry in `exportClassification.test.ts` (D-1, for SA). User answer to MX2B-Q1…Q3 recorded in §8.2 (all cells as stored). MX2B-11 note for MX-3 recorded. Implementation Notes added |
| 2026-10-28 | SA code review (SA) | APPROVED, code approved for QA. R-1…R-3 and MX2B-1/2/5/6 verified; D-1 exemption confirmed, D-2…D-4 approved; three section overrides confirmed genuine; no cell value passes through labels. Two Low wording notes (he `installment_amount`, es `invoice_tax_id`) for the native review. SA reran the export suite: 21 suites, 718 tests passed |
