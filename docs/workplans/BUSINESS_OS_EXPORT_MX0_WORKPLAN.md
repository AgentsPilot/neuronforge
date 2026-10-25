# Workplan: Business OS Export — MX-0 Module map + per-module switches

> **Last Updated**: 2026-10-25

**Developer:** Dev (written by the DELETE session's Dev for hand-off to the EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §4.1, §6.2 MX-0, §7 MX-0, XC-21; `## SA Split Review — 2026-10-25` (BQ-25 / BQ-27 moved to before MX-4 switch-on)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §4.1
**Prior design reused:** export switches requirement slice 1 (`exportFlags.ts`), branch `docs/data-export-flags-xlsx`, file `docs/requirements/BUSINESS_OS_DATA_EXPORT_FLAGS_AND_SPREADSHEET_REQUIREMENT.md` §2–§3 and its SA review 2026-10-21 (SA-2, SA-8, C-1, C-2, C-3). Excel (its slices 3–5) is dropped
**Branch:** `feature/bos-export-mx0-module-map` (proposal; **RM creates it** from current `main`; Dev confirms with `git branch --show-current` before the first edit and records it here)
**Worktree:** `neuronforge-mx0` (EXPORT prefix `neuronforge-mx*`)
**Date:** 2026-10-25
**Status:** Planning

---

## Overview

MX-0 adds one pure config file that says which of the 39 export sections belong to which of the 13 modules the owner will tick in the export drawer, the module names in English, Hebrew and Spanish, and an on/off switch per module. It also exports the Zod enum of module ids that every later route uses to validate a request. CI tests prove that every exportable section belongs to exactly one module and that a table the classification never exports cannot be put in a module, and so cannot be switched on. There is no migration, no route, no UI, and nothing a user can see. Today's ZIP export is untouched.

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

Read on `origin/main` at `7e51af5b`.

| Piece | What is there today | Use in MX-0 |
|---|---|---|
| `lib/business-os/data-export/classificationTypes.ts` | Pure. `ExportSectionId` union of 39 ids; `NON_TABLE_SECTIONS` (`account_identity` from the session) | Import the **type** `ExportSectionId` only |
| `lib/business-os/purge/descriptors.ts` | `PURGE_DESCRIPTORS` (161 tables), each with `export: include { section, columns, viaParent?… } \| exclude { reason }` | Read in the **test** only: which sections are backed by an `include`, and `viaParent` links |
| `lib/business-os/data-export/sections.ts` | Server-only. `EXPORT_SECTIONS` registry, 39 entries in a fixed order; `ExportGroupId` (legal groups: account / client_records / content) | Read in the **test** only (Jest maps `server-only` to `__mocks__/server-only.js`) |
| `lib/business-os/data-export/classification.ts` | Pure rule functions taking their inputs (`sectionRegistryProblems`, `viaParentProblems`, …), each with negative controls in `exportClassification.test.ts` | Pattern to copy: the new rule function takes the map, descriptors, section ids and non-table list as arguments |
| `lib/business-os/data-export/readme.ts` | `SECTION_NAMES_EN` / `_HE` per section (ZIP README, removed in MX-6) | Not reused (section names, not module names) |
| `featureFlags.ts` | No export flag (F-15) | Not touched: `isModuleExportEnabled()` is MX-1b |

The 13 modules of requirement §4.1 cover the 39 sections exactly once (3+2+2+1+1+4+3+2+4+4+4+1+8 = 39). The two dependency rules the old SA review asked for (SA-8: `website_blocks` needs `website_pages`; `email_sequence_steps` and `email_sequence_enrollments` need `email_sequences`) both fall inside one module in this placement, so with module-level switches they become a "same module" rule.

**Not touched:** the export classification, the purge engine, the ZIP builder, any route, any shared hotspot file (translations, `featureFlags.ts`, `events.ts`, `vercel.json`, `descriptors.ts`). The old legal groups (`ExportGroupId`) stay as they are: the module is a separate product label, not a replacement.

**Deprecated patterns found:** none in the files read. `exportClassification.test.ts` is shared add-only (S-2); MX-0 does not edit it and puts its tests in a new file.

---

## 2. Implementation approach

### 2.1 One pure file: `lib/business-os/data-export/exportModules.ts`

Pure: imports only the `ExportSectionId` **type** and `zod`. No `server-only`, no descriptors, no repositories, so the MX-1b drawer (a client component) can import it without pulling the descriptors into the browser bundle.

**File:** `lib/business-os/data-export/exportModules.ts` (shape only; final names in review)

```typescript
import { z } from 'zod';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

export interface ExportModuleDefinition {
  /** Durable id: stored in module jobs, audit details and file names from MX-1a. Never rename. */
  id: string;
  name: { en: string; he: string; es: string };
  /** Section order is the column order of the joined CSV (MX-2a, XC-10). */
  sections: readonly ExportSectionId[];
  /** Product switch: off = not offered in the drawer, refused by the route. Code edit + deploy only. */
  on: boolean;
}

export const EXPORT_MODULES = [
  { id: 'clients', name: { en: 'Clients', he: 'לקוחות', es: 'Clientes' },
    sections: ['clients', 'pipeline_stages', 'client_documents'], on: true },
  // … 12 more, in requirement §4.1 order (= drawer order)
] as const satisfies readonly ExportModuleDefinition[];

export type ExportModuleId = (typeof EXPORT_MODULES)[number]['id'];
export const EXPORT_MODULE_IDS = EXPORT_MODULES.map((m) => m.id) as [ExportModuleId, ...ExportModuleId[]];
export const ExportModuleIdSchema = z.enum(EXPORT_MODULE_IDS);
```

Helpers, each taking the map as an optional last argument (default `EXPORT_MODULES`) so tests inject a map with a module off (old SA-2 dependency-injection ruling):

| Helper | Returns |
|---|---|
| `enabledModules(map?)` | Modules with `on: true`, in map order (what the drawer offers) |
| `isModuleEnabled(id, map?)` | `true` only for a known id with `on: true` |
| `moduleOfSection(sectionId, map?)` | The module id that holds the section; `null` if none (fail closed) |
| `sectionsOfModule(id, map?)` | The module's section ids in map order |
| `requestedModulesSchema(map?)` | `z.array(ExportModuleIdSchema).min(1).max(map.length)` + refinements: no duplicates, every id enabled. MX-1b uses it inside its `.strict()` body schema |
| `exportModuleProblems(map, inputs)` | Pure CI rule (§2.2). `inputs = { includeSections, registeredSections, nonTableSections, viaParentLinks, declaredRequires }`, all passed in, so this file never imports descriptors |

**Rule carried from the old SA review (C-1, "switches only remove"):** nothing in this or any later slice builds a section from the map. MX-3 reads `EXPORT_SECTIONS.filter(s => sectionsOfModule(id).includes(s.id))`, so a section in the map but absent from the registry cannot be read.

**Rule carried (C-3, no override):** no helper takes a switch from a request, query, body or environment variable.

### 2.2 The CI rule: `exportModuleProblems`

Returns a list of problem strings (empty = ok), like `sectionRegistryProblems`:

| # | Problem reported when |
|---|---|
| R-1 | A module id is not `^[a-z][a-z0-9_]{1,39}$`, or two modules share an id |
| R-2 | A module has no sections |
| R-3 | A section appears in two modules, or twice in one |
| R-4 | A registered section (`EXPORT_SECTIONS` id) is in no module |
| R-5 | A map section is not registered (unknown section) |
| R-6 | **A map section is not exportable:** it is neither the `section` of exactly one `include` descriptor nor in `NON_TABLE_SECTIONS`. This is the "never-exported table cannot be switched on" rule: an `exclude` table has no section id, so planting its name (or a section whose only descriptor was flipped to `exclude`) is reported |
| R-7 | A name is empty in en, he or es; the he name has no Hebrew letter; two modules share a name in one language |
| R-8 | A `viaParent` child section is not in the same module as its parent section (derived from the descriptors, generic, as the old SA-8) |
| R-9 | A declared `requires` pair is split across modules: `email_sequence_steps` and `email_sequence_enrollments` → `email_sequences` (old SA-8; kept as a small declared list in the test inputs, not in the map file) |

**Why a Jest twin and not only the type:** `sections: readonly ExportSectionId[]` already makes an unknown id a `tsc` error, but no TypeScript gate runs on this path in CI and `next.config.js` ignores TS errors (old SA review "Type safety" finding). R-5 and R-6 are the runtime twins.

### 2.3 The 13 modules (BA default, requirement §4.1)

| # | Proposed id | en | he | es (draft) | Sections, in order |
|---|---|---|---|---|---|
| 1 | `clients` | Clients | לקוחות | Clientes | `clients`, `pipeline_stages`, `client_documents` |
| 2 | `activities_tasks` | Activities & tasks | פעילויות ומשימות | Actividades y tareas | `client_activities`, `client_tasks` |
| 3 | `bookings` | Bookings | הזמנות | Reservas | `bookings`, `time_off` |
| 4 | `services` | Services | שירותים | Servicios | `services` |
| 5 | `quotes` | Quotes | הצעות מחיר | Presupuestos | `quotes` |
| 6 | `invoices_payments` | Invoices & payments | חשבוניות ותשלומים | Facturas y pagos | `invoices`, `payments`, `refunds`, `client_payment_methods` |
| 7 | `payment_plans` | Payment plans | תוכניות תשלום | Planes de pago | `payment_plans`, `client_payment_plans`, `installments` |
| 8 | `forms` | Forms | טפסים | Formularios | `intake_settings`, `intake_forms` |
| 9 | `email_campaigns` | Email campaigns | קמפייני אימייל | Campañas de email | `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` |
| 10 | `newsletter_subscribers` | Newsletter subscribers | מנויי ניוזלטר | Suscriptores del boletín | `newsletter_subscribers`, `consent_records`, `consent_settings`, `email_unsubscribes` |
| 11 | `website` | Website | אתר | Sitio web | `website_content`, `website_pages`, `website_blocks`, `images` |
| 12 | `smart_links` | Smart links | קישורים חכמים | Enlaces inteligentes | `smart_links` |
| 13 | `account_business` | Account & business details | פרטי החשבון והעסק | Datos de la cuenta y del negocio | `account_identity`, `user_profile`, `preferences`, `notification_settings`, `business_profile`, `business_addresses`, `payment_account`, `payment_providers` |

Hebrew terms follow the ZIP README's section names (`readme.ts` `SECTION_NAMES_HE`). ⚠️ "הזמנות" is also the app's Hebrew label for the Orders (payments) screen (`nav.payments`), so "Bookings" may read as "Orders" to a Hebrew owner; the app also uses "פגישות" (meetings) widely. The user picks the word at MX-1b's drawer copy review (open item MX0-8). Spanish is a draft (requirement §4.3). The user can move any line before MX-4 switch-on (BQ-27); a move is a one-line edit and re-runs these tests.

The id list is pinned by a test (T-8): from MX-1a on, ids are stored in module-job rows, audit `details.modules` and file names, so renaming one is a data change that needs SA, not a refactor.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/data-export/exportModules.ts` | create | The module map, switches, Zod enum, helpers, `exportModuleProblems` |
| `lib/business-os/data-export/__tests__/exportModules.test.ts` | create | CI rules over the real map + negative controls; helper and schema tests |
| `docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md` | modify | Task ticks, SA / QA notes |

Nothing else. In particular **not** `exportClassification.test.ts`, `descriptors.ts`, `sections.ts`, `classificationTypes.ts`, translations, `featureFlags.ts` or `docs/FEATURE_FLAGS.md`. The requirement's §6 status line is spliced by BA / a general-purpose agent, not by Dev in this PR.

---

## 4. Task list

- [ ] 1. Coordination: read `SELF_SERVICE_EXIT_COORDINATION.md`; confirm SR-12 is done (TL); fill in the EXPORT session name row if empty; set status row MX-0 → "in progress (EXPORT)"; log + `SendMessage` to `Admin user/business deletion button`: `[EXPORT→DELETE] MX-0 workplan approved`
- [ ] 2. Confirm branch `feature/bos-export-mx0-module-map` (RM-created) with `git branch --show-current`; record it above. If on `main` or another branch, stop and escalate to TL
- [ ] 3. Re-read `classificationTypes.ts`, `sections.ts` (`EXPORT_SECTIONS` order), `descriptors.ts` (`include` sections, `viaParent`) on the branch base; if a section was added or removed since `7e51af5b`, stop and raise it (the 39 / 13 placement is reviewed)
- [ ] 4. Create `exportModules.ts`: header comment (why: product switch vs privacy classification; ids durable; pure so the drawer can import it), `ExportModuleDefinition`, `EXPORT_MODULES` (13 rows, §2.3), `ExportModuleId`, `EXPORT_MODULE_IDS`, `ExportModuleIdSchema`
- [ ] 5. Add helpers `enabledModules`, `isModuleEnabled`, `moduleOfSection`, `sectionsOfModule`, `requestedModulesSchema` (map injectable)
- [ ] 6. Add `exportModuleProblems(map, inputs)` with rules R-1…R-9
- [ ] 7. Write `exportModules.test.ts` (§5): real-map tests, each rule's negative control, helper and schema tests, id pin
- [ ] 8. Run `npm test -- lib/business-os/data-export` and the full `npm test`; `npx tsc --noEmit -p .` scoped check on the two new files (record result; no new CI job)
- [ ] 9. Confirm no `console.*`, no `any`, `@/` imports only; confirm `git diff --stat` shows exactly the two new files plus this workplan (agent file-write hazard)
- [ ] 10. Hand to SA (code review) and QA; leave changes **uncommitted** for the user's diff review; after merge (RM): log + `[EXPORT→DELETE] MX-0 merged`; status row updated

---

## 5. Tests

All in `lib/business-os/data-export/__tests__/exportModules.test.ts`. Pure Jest, small fixtures, existing job: no added CI time. The real inputs are built in the test from `PURGE_DESCRIPTORS`, `EXPORT_SECTIONS` and `NON_TABLE_SECTIONS`.

| # | Test | Negative control (must fail on a planted input) |
|---|---|---|
| T-1 | Real map: `exportModuleProblems` returns `[]` | — (each rule's control below) |
| T-2 | **Every exportable section is in exactly one module:** the set of map sections equals the set of `EXPORT_SECTIONS` ids (39), with no repeats; non-vacuous (asserts 13 modules, 39 sections) | Remove `images` from Website → R-4; add `clients` to a second module → R-3; repeat a section inside one module → R-3 |
| T-3 | Every `include` descriptor's section is in the map | A copy of the descriptors with one extra `include` on a new section id → R-4 / R-5 |
| T-4 | **A never-exported table cannot be switched on:** every map section is backed by exactly one `include` descriptor or by `NON_TABLE_SECTIONS` | Plant `'plugin_connections'` (excluded whole, user 2026-10-15) and `'website_page_views'` (visitor tracking) via a cast into an `on: true` module → R-5 + R-6; flip the `smart_links` descriptor to `exclude` in a copy → R-6 for `smart_links` |
| T-5 | Unknown section id | Plant `'not_a_section'` → R-5 |
| T-6 | Ids well-formed and unique; no empty module | Duplicate id, `'Bad-Id'`, a module with `sections: []` → R-1, R-2 |
| T-7 | Names: en, he, es non-empty; he contains a Hebrew letter; no two modules share a name per language | Empty es; Latin-only he; two modules both "Clients" → R-7 |
| T-8 | **Id pin:** `EXPORT_MODULE_IDS` equals the 13 ids of §2.3 in order (comment: ids are durable from MX-1a; renaming needs SA) | — (the pin itself) |
| T-9 | `viaParent` children share their parent's module (derived from descriptors: `website_blocks` → `website_pages`) | Move `website_blocks` to Smart links → R-8 |
| T-10 | Declared requires: `email_sequence_steps`, `email_sequence_enrollments` with `email_sequences` | Move `email_sequence_steps` to Forms → R-9 |
| T-11 | Helpers: `enabledModules` keeps map order and drops an `on: false` module; `isModuleEnabled` false for unknown and off; `moduleOfSection` for every registry section is non-null, `null` for an unknown; `sectionsOfModule('clients')` order is `clients, pipeline_stages, client_documents` | Injected map with `website` off |
| T-12 | `requestedModulesSchema`: accepts `['clients']` and all 13; refuses `[]`, an unknown id, a duplicate, a non-string, more than 13, and a switched-off module (injected map) | (these are the controls) |
| T-13 | Purity: the source of `exportModules.ts` imports nothing but `zod` and a **type-only** import from `classificationTypes`, and has no `server-only` (read the file as text; normalise CRLF first, per the Windows CRLF flake note) | Planted string with an extra import → fails the check function |

---

## 6. Acceptance criteria

From requirement §7 MX-0, plus the slice's own:

- [ ] Every `include` section is in exactly one module; an unknown or missing section fails CI (T-2, T-3, T-5).
- [ ] A table that is never exported cannot be placed in a module, so cannot be switched on; reclassifying a mapped section's table to `exclude` fails CI until the map drops it (T-4).
- [ ] A module switched off is not returned by `enabledModules` and is refused by `requestedModulesSchema` (T-11, T-12). *The drawer and route halves of the requirement's "not offered in the drawer and is refused by the route" are verified in MX-1b, which consumes these helpers.*
- [ ] Module ids are validated by a Zod enum built from the map (XC-21 rule 2) (T-12).
- [ ] Every module has en, he and es names (T-7).
- [ ] The file is pure and client-importable (T-13).
- [ ] No other file changes; the ZIP export, its tests and `exportClassification.test.ts` are untouched and green.
- [ ] No added CI time (one small test file in the existing Jest job).

---

## 7. Coordination

Standard checklist: plan §3 (CC-1…CC-8). For MX-0 specifically:

| Item | MX-0 |
|---|---|
| Cleanup-regen lock | Not taken (DELETE holds it for DL-1a; MX-0 needs none) |
| Migration numbers | None reserved |
| Shared hotspot files | None edited |
| Frozen interfaces | Not touched (`findDeletionFacts`, `DownloadMyDataButton`) |
| Messages to `Admin user/business deletion button` | `[EXPORT→DELETE] MX-0 workplan approved`, `… PR opened`, `… merged` (each also a log line) |
| Files not to edit | Plan §7 |

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| BQ-27 answered differently after MX-0 merges | Low | One-line moves in the map; tests re-run; ids of moved-between modules unchanged. Must land before MX-4 switch-on |
| A module id renamed after MX-1a stores ids | Medium (orphaned history and audit labels) | T-8 pin + header comment; rename needs SA |
| A new export section added by another stream without a module | Low | T-2 fails CI in that stream's PR, which forces a placement decision |
| The drawer importing the map pulls descriptors into the browser | Medium (bundle size, exposing classification) | The map file imports no descriptors (T-13); the rule function takes its inputs |
| Old flags-xlsx design and this one both land | Low | `exportFlags.ts` was never built (branch is docs only); MX-6 marks that requirement superseded; MX-0 does not create `exportFlags.ts` |
| Hebrew or Spanish names wrong | Low | he reviewed by the user at MX-1b's drawer copy review; es is a draft by requirement |

---

## 9. Open items for SA

| # | Item | Proposal |
|---|---|---|
| MX0-1 | File name: `exportModules.ts` (new) or the old design's `exportFlags.ts` | `exportModules.ts`: it is a module map first, the switch is one field; avoids confusion with env feature flags (`isModuleExportEnabled`, MX-1b) |
| MX0-2 | Module names in this pure file or in the translation bundles (plan SA-P2) | In this file: no shared hotspot edit, one source for drawer, emails and file names |
| MX0-3 | Module-level switches only, or also per-section switches (old `SECTION_SWITCHES`) (plan SA-P7) | Module-level only. The requirement says "on/off per module"; a section switch would let one module's CSV lose a part silently. Trimming a section is a descriptor `exclude` (SA-reviewed) |
| MX0-4 | Should any module be locked on (old BQ-3 locked `account_identity`) | No: the owner picks modules and every email goes to the login email, so "whose data" no longer needs a locked section. No lock rule in MX-0 |
| MX0-5 | Rule R-9's declared requires list: keep in the test inputs or move into the map file as `requires` | In the test inputs (two pairs), so the map stays a plain list; the generic `viaParent` rule covers the rest |
| MX0-6 | Ids that equal a section id (`clients`, `services`, `quotes`, `bookings`, `payment_plans`, `newsletter_subscribers`, `smart_links`) | Keep: they are separate types (`ExportModuleId` vs `ExportSectionId`), and plain words make readable file names (`clients_2026-10-25_part-1-of-2.csv`). If SA prefers no overlap, prefix `mod_` is not proposed because it leaks into owner file names |
| MX0-7 | Is `zod` in a client-importable pure file acceptable | Yes: zod is already used client-side; the drawer can share the enum with the route |
| MX0-8 | Hebrew name for Bookings ("הזמנות" collides with the Orders screen label) | Ship "הזמנות" (README precedent) in MX-0; a business wording call for the user at MX-1b copy review, changed in one line |

---

## SA Review Notes

*(SA populates.)*

## QA Testing Report

*(QA populates.)*

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev, DELETE session, for hand-off) | MX-0 workplan: pure `exportModules.ts` (13 modules, 39 sections, en/he/es names, per-module `on`, Zod enum, helpers, `exportModuleProblems` R-1…R-9), one new test file T-1…T-13 incl. "every section in exactly one module" and "never-exported table cannot be switched on"; no migration, no shared file; open items MX0-1…MX0-7 |
