# Workplan: Business OS Export — MX-0 Module map + per-module switches

> **Last Updated**: 2026-10-25

**Developer:** Dev (written by the DELETE session's Dev for hand-off to the EXPORT session)
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §4.1, §6.2 MX-0, §7 MX-0, XC-21; `## SA Split Review — 2026-10-25` (BQ-25 / BQ-27 moved to before MX-4 switch-on)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §4.1
**Prior design reused:** export switches requirement slice 1 (`exportFlags.ts`), branch `docs/data-export-flags-xlsx`, file `docs/requirements/BUSINESS_OS_DATA_EXPORT_FLAGS_AND_SPREADSHEET_REQUIREMENT.md` §2–§3 and its SA review 2026-10-21 (SA-2, SA-8, C-1, C-2, C-3). Excel (its slices 3–5) is dropped
**Branch:** `feature/bos-export-mx0-module-map` (RM-created from `origin/main` `10761291`; confirmed by Dev with `git branch --show-current` on 2026-10-25 before the first edit)
**Worktree:** `neuronforge-mx0` (EXPORT prefix `neuronforge-mx*`)
**Date:** 2026-10-25
**Status:** Code Complete (uncommitted, awaiting SA code review + QA)

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

Read on `origin/main` at `7e51af5b`; re-checked on the branch base `10761291` (SA C-9): no section or descriptor change.

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

### 2.1 Two pure files: `exportModules.ts` (map) and `exportModuleSchema.ts` (Zod) — as built (SA C-1…C-3)

`exportModules.ts` is pure: its only import is the `ExportSectionId` **type** from `classificationTypes`. No zod, no `server-only`, no descriptors, no repositories, so the MX-1b drawer (a client component) can import ids, names and switches without pulling zod or the descriptors into the browser bundle. The Zod schemas live in `exportModuleSchema.ts` (pure, no `server-only`; imports `zod` and `exportModules.ts` only), which the route uses.

**File:** `lib/business-os/data-export/exportModules.ts` (shape)

```typescript
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

export const EXPORT_MODULE_IDS = ['clients', 'activities_tasks', /* … 13, drawer order */ 'account_business'] as const;
export type ExportModuleId = (typeof EXPORT_MODULE_IDS)[number];
export type ExportModuleLanguage = 'en' | 'he' | 'es';

export interface ExportModuleDefinition {
  /** Durable id: stored in module jobs, audit details and file names from MX-1a. Never rename. */
  id: ExportModuleId;
  name: Readonly<Record<ExportModuleLanguage, string>>;
  /** Section order is the column order of the joined CSV (MX-2a, XC-10). */
  sections: readonly ExportSectionId[];
  /** Product switch: off = not offered in the drawer, refused by the route. Code edit + deploy only. */
  on: boolean;
}

export const EXPORT_MODULES: readonly ExportModuleDefinition[] = [ /* 13 rows, §2.3 */ ];
```

**File:** `lib/business-os/data-export/exportModuleSchema.ts` (shape)

```typescript
import { z } from 'zod';
import { EXPORT_MODULE_IDS, EXPORT_MODULES, isModuleEnabled, type ExportModuleDefinition } from '@/lib/business-os/data-export/exportModules';

export const ExportModuleIdSchema = z.enum(EXPORT_MODULE_IDS); // a real tuple, no cast
export function requestedModulesSchema(map: readonly ExportModuleDefinition[] = EXPORT_MODULES) { /* … */ }
```

Helpers, each taking the map as `readonly ExportModuleDefinition[]` (default `EXPORT_MODULES`) so tests inject a map with a module off (old SA-2 dependency-injection ruling; SA C-3):

| Helper | File | Returns |
|---|---|---|
| `enabledModules(map?)` | `exportModules.ts` | Modules with `on: true`, in map order (what the drawer offers) |
| `isModuleEnabled(id: string, map?)` | `exportModules.ts` | `true` only for a known id with `on: true` |
| `moduleOfSection(sectionId: string, map?)` | `exportModules.ts` | The module id that holds the section; `null` if none (fail closed) |
| `sectionsOfModule(id: string, map?)` | `exportModules.ts` | The module's section ids in map order; `[]` for an unknown id (fail closed) |
| `exportModuleProblems(map, inputs)` | `exportModules.ts` | Pure CI rule (§2.2) over a looser `ExportModuleRuleModule[]` shape. `inputs = { registeredSections, includeSections, nonTableSections, viaParentLinks, declaredRequires }`, all passed in, so the file never imports descriptors |
| `requestedModulesSchema(map?)` | `exportModuleSchema.ts` | `z.array(ExportModuleIdSchema).min(1).max(map.length)` + refinements: no duplicates, every id enabled. MX-1b uses it inside its `.strict()` body schema |

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
| `lib/business-os/data-export/exportModules.ts` | create | The module map, switches, `EXPORT_MODULE_IDS` tuple, helpers, `exportModuleProblems`. Pure: one type-only import, no zod (SA C-1) |
| `lib/business-os/data-export/exportModuleSchema.ts` | create | `ExportModuleIdSchema` (`z.enum(EXPORT_MODULE_IDS)`, no cast) + `requestedModulesSchema` (SA C-1, C-2) |
| `lib/business-os/data-export/__tests__/exportModules.test.ts` | create | CI rules over the real map + negative controls; helper and schema tests |
| `docs/workplans/BUSINESS_OS_EXPORT_MX0_WORKPLAN.md` | modify | Task ticks, SA / QA notes |

Nothing else. In particular **not** `exportClassification.test.ts`, `descriptors.ts`, `sections.ts`, `classificationTypes.ts`, translations, `featureFlags.ts` or `docs/FEATURE_FLAGS.md`. The requirement's §6 status line is spliced by BA / a general-purpose agent, not by Dev in this PR.

---

## 4. Task list

- [x] 1. Coordination: handled by the parent (EXPORT) session per the brief (SA C-8 `[E→D] E1 …` format); Dev sent no messages
- [x] 2. ✅ Branch `feature/bos-export-mx0-module-map` confirmed with `git branch --show-current` (base `10761291`); recorded above
- [x] 3. ✅ Re-read `classificationTypes.ts`, `sections.ts`, `descriptors.ts` on `10761291`: 39 sections, one `viaParent` (`website_blocks` → table `website_pages`), no change since `7e51af5b` (as SA re-checked)
- [x] 4. ✅ `exportModules.ts`: header comment, `EXPORT_MODULE_IDS` tuple (`as const`), `ExportModuleId`, `ExportModuleDefinition` (`id: ExportModuleId`, `on: boolean`), `EXPORT_MODULES: readonly ExportModuleDefinition[]` (13 rows, §2.3, "הזמנות" default) (SA C-2)
- [x] 5. ✅ Helpers `enabledModules`, `isModuleEnabled(string)`, `moduleOfSection(string)`, `sectionsOfModule(string)`, map injectable as `readonly ExportModuleDefinition[]` (SA C-3). `ExportModuleIdSchema` (`z.enum(EXPORT_MODULE_IDS)`, no cast) + `requestedModulesSchema` in the separate `exportModuleSchema.ts` (SA C-1)
- [x] 6. ✅ `exportModuleProblems(map, inputs)` R-1…R-9 over the loose `ExportModuleRuleModule` shape; R-4 covers registered ∪ include ∪ non-table (SA C-4)
- [x] 7. ✅ `exportModules.test.ts` T-1…T-13 (34 tests): repository `jest.mock` lines copied (C-7); `viaParentLinks` resolved through `viaParentOf` (C-5); no descriptor counts (C-6); T-13 is a pure check over a CRLF-normalised string with a planted-string control (C-7)
- [x] 8. ✅ Tests and tsc run, results in [Implementation results](#implementation-results-dev-2026-10-25)
- [x] 9. ✅ No `console.*`, no `any`, `@/` imports only; `git status` shows exactly the three new files plus this workplan
- [ ] 10. Hand to SA (code review) and QA; changes left **uncommitted** for the user's diff review; after merge (RM): `[E→D] E1 merged` (parent session) and status row updated

### Implementation results (Dev, 2026-10-25)

| Check | Result |
|---|---|
| `npm test -- lib/business-os/data-export` | 15 suites, 498 tests, all pass (new suite: 34 pass, 0 fail). `exportClassification.test.ts` untouched and green |
| Full `npm test` (local, Windows) | 1680 suites pass, 24 fail; 43227 tests pass, 146 fail, 65 skipped. All 24 failing suites are outside `data-export` and none imports or scans the new files: V6 / pilot / orchestration legacy suites, `supabaseFetch`, and source-scanning guards that fail on Windows backslash path separators and CRLF (memory: Jest local-vs-CI flake patterns). Nothing imports the new files, so none of these can be caused by this change |
| `npx tsc --noEmit -p .` (`--max-old-space-size=8192`) | Ran to completion (exit 2, 1847 pre-existing diagnostics, no OOM / V8 trace). **0 diagnostics** in `exportModules.ts`, `exportModuleSchema.ts`, `exportModules.test.ts` |
| Purity | `exportModules.ts`: one `import type` from `classificationTypes`, nothing at runtime (T-13). `exportModuleSchema.ts`: `zod` + `exportModules` only, no `server-only` |
| Hebrew-letter check | Literal-character range `/[֐-׿]/` (U+0590–U+05FF), no backslash escape (Tailwind-scan hazard) |

**Deviations / notes for SA:**
- `sectionsOfModule` takes a plain `string` (as `isModuleEnabled` / `moduleOfSection`) and returns `[]` for an unknown id (fail closed).
- T-3's control appends a planted section to `includeSections`, which is exactly what a descriptor copy with one extra `include` produces, instead of building a `PurgeDescriptor` whose `section` is not an `ExportSectionId` (that would need a cast, against C-3).
- The T-13 `server-only` check matches the quoted module name (`'server-only'`), not the bare word, because both new headers explain in prose why they have no `server-only` import.
- `requestedModulesSchema(map).max` is `map.length` (as §2.1), not the number of enabled modules; a switched-off id is refused by the enabled refinement.
- Drawer-hides and route-refuses tests for a switched-off module are MX-1b's (SA C-9).

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
| T-13 | Purity: the source of `exportModules.ts` has one **type-only** import from `classificationTypes` and nothing at runtime (no zod, no `server-only`); `exportModuleSchema.ts`, where zod lives, imports only `zod` and `exportModules.ts`. Read each file as text, normalise CRLF first (Windows CRLF flake note) | Planted string with an extra import → fails the check function |

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
| Messages to `Admin user/business deletion button` | `[E→D] E1 <event>` (C-8), e.g. `[E→D] E1 workplan approved`, `[E→D] E1 PR opened`, `[E→D] E1 merged` (each also a log line) |
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

**Reviewed by SA — 2026-10-25** (workplan review, pre-implementation; tree: `feature/bos-export-mx0-module-map` at `10761291`)
**Status:** ⚠️ Approved with conditions C-1…C-9

### Facts re-checked against the current tree (main moved from `7e51af5b` to `10761291`)

| Check | Result |
|---|---|
| Changes since `7e51af5b` under `lib/business-os/data-export/` and `lib/business-os/purge/` | **None.** LX-1 (#509) changed `lib/crm/contactsCsv.ts`, its tests and three translation lines only; #507 is entitlements; #506 is docs. No section or descriptor moved |
| `ExportSectionId` union / `EXPORT_SECTIONS` | 39 ids, 39 registry entries, same set, order as §2.3 assumes |
| §2.3 placement vs the 39 ids | Scripted check: 39 placements, no duplicate, set-equal to the union and to the registry. Identical to requirement §4.1 |
| `include` descriptors | 38, one per section; the 39th (`account_identity`) is the only `NON_TABLE_SECTIONS` entry |
| `viaParent` links | One: `website_blocks` → parent **table** `website_pages` (whose include section is also `website_pages`). Both in module 11 |
| Descriptor count | 161 (`exportClassification.test.ts` lines 303, 1358–1367). DL-1a (D1) will make it 162. MX-0 must not assert or edit any count (C-6) |
| Shared hotspots / DELETE-owned files (plan §7, SR-10, SR-11) | None touched by the plan. `data-export/**` new files are EXPORT's |
| Entitlements imports | None. Pure file, so Pino and `correlationId` do not apply; no `console.*` allowed in either new file |
| SR-12 (CC-2) | Done per the coordination log (§11 splice identical in both files) |

### Conditions

1. **C-1 (MX0-7, ruling: split).** Zod must **not** live in the client-importable map file. The premise "zod is already used client-side" is only narrowly true: the one client use is the admin price form, "approved narrowly for this admin form" (SA O-6, RC-1, `ManualPriceEntryForm.tsx`). An owner-facing drawer pulling zod in would be a new pattern (rule 7) and a bundle cost for no gain: the drawer needs ids, names and `on`, never the schema, and the server stays the authority. Create **three** files: `exportModules.ts` (pure data + helpers + `exportModuleProblems`; imports only the `ExportSectionId` **type**), `exportModuleSchema.ts` (pure, no `server-only`: `ExportModuleIdSchema` + `requestedModulesSchema`, importing from `exportModules.ts`), and the test. T-13 checks `exportModules.ts` imports nothing at runtime; the schema file may import `zod` and `./exportModules` only. §3 and task 9's "exactly two new files" become three.
2. **C-2 (typing, replaces the `as const satisfies` + cast shape).** With `as const`, every `on` is the literal `true`, so code that reads `typeof EXPORT_MODULES` directly cannot compare `on === false` (TS2367), and the `as [ExportModuleId, ...ExportModuleId[]]` cast is an unchecked assertion. Use the repo precedent instead (`PRICE_PROVIDERS` → `z.enum(PRICE_PROVIDERS)`; `QUEUE_ITEM_ACTIONS`): declare `export const EXPORT_MODULE_IDS = ['clients', …13] as const;`, `export type ExportModuleId = (typeof EXPORT_MODULE_IDS)[number];`, `ExportModuleDefinition` with `id: ExportModuleId` and `on: boolean`, and `export const EXPORT_MODULES: readonly ExportModuleDefinition[] = [...]`. `z.enum(EXPORT_MODULE_IDS)` then takes a real tuple with no cast. A test asserts `EXPORT_MODULES.map(m => m.id)` equals `EXPORT_MODULE_IDS` in order (folds into T-8).
3. **C-3 (helper signatures).** Every helper and `exportModuleProblems` takes the map as `readonly ExportModuleDefinition[]` (default `EXPORT_MODULES`), never `typeof EXPORT_MODULES`, so an injected `on: false` map compiles. `isModuleEnabled` and `moduleOfSection` take a plain `string`, so an unknown id is a runtime `false` / `null`, not a cast in the test. `exportModuleProblems` takes a looser structural input (`{ id: string; sections: readonly string[]; name: …; on: boolean }[]`) so the negative controls plant bad ids and sections without `as unknown as`. No `any` anywhere, including the tests.
4. **C-4 (R-4 is not enough for T-3).** As written, R-4 checks registered sections only and R-5 checks map sections only, so T-3's planted `include` on a new section id that is neither registered nor mapped fires **neither** rule: the control would pass vacuously. R-4 must report any section in `registeredSections ∪ includeSections ∪ keys(nonTableSections)` that is in no module. T-3 asserts the exact message.
5. **C-5 (R-8 input).** `viaParent.parent` is a **table name**, not a section id. The test builds `viaParentLinks` as `{ childSection, parentSection }` by resolving the parent table through the descriptors (reuse `viaParentOf` from `classification.ts`, which already fails closed), never by assuming table name = section id. T-9 is non-vacuous: assert at least one link exists and that it is `website_blocks → website_pages`.
6. **C-6 (no count lines).** The test asserts 13 modules and 39 mapped sections, and nothing about `PURGE_DESCRIPTORS.length` or include / exclude totals (coordination log, SA CR-3: DL-1a moves 161 → 162). Derive `includeSections` from the descriptors at run time.
7. **C-7 (test harness).** `sections.ts` imports two repositories. Copy `exportClassification.test.ts`'s two `jest.mock` lines (`UserProfileRepository`, `BusinessDataExportRepository`) before importing `EXPORT_SECTIONS`; the `server-only` mapping alone is not enough. T-13: read the source with `fs`, `.replace(/\r\n/g, '\n')` first, and run the check as a pure function over a string, so its control is a planted string. Match multi-line and `import type` forms; treat `import type { … } from '…classificationTypes'` as the only allowed import of `exportModules.ts`.
8. **C-8 (coordination format).** The coordination file now fixes the message format: first line `[E→D] E1 <event>` (step numbering, log 2026-10-25). Use that, not `[EXPORT→DELETE] MX-0 …`, in task 1, task 10 and §7. The EXPORT session row is already filled in; task 1's "fill in" step is a no-op.
9. **C-9 (record the split acceptance criterion).** Requirement §7 MX-0's "refused by the route / not offered in the drawer" is only half testable here (no route, no drawer). Accepted: MX-0 proves the helper and schema half (T-11, T-12). The MX-1b workplan must carry the route-refusal and drawer-hides tests against an injected map with a module off. Update §1's "Read on `origin/main` at `7e51af5b`" to `10761291` (re-checked, no change).

### Rulings on open items

| # | Ruling |
|---|---|
| MX0-1 | ✅ `exportModules.ts`. Do not create `exportFlags.ts` |
| MX0-2 | ✅ Names in the pure map file (plan SA-P2 agreed). Drawer chrome copy still goes to translations at EXPORT's anchor in MX-1b |
| MX0-3 | ✅ Module-level only (plan SA-P7 agreed). A section trim is a move or a descriptor `exclude`, both SA-reviewed |
| MX0-4 | ✅ No locked module in MX-0. If the user later wants one, it is an additive rule; nothing here blocks it |
| MX0-5 | ✅ Declared `requires` pairs in the test inputs. With module-level switches the same-module rule is all that matters |
| MX0-6 | ✅ Keep the ids that equal a section id. Separate types; no `mod_` prefix |
| MX0-7 | 🔄 **Changed:** zod moves to a separate `exportModuleSchema.ts` (C-1) |
| MX0-8 | **Business question for the user; not SA's call. Does not block MX-0.** Ship "הזמנות" as the default. Nothing is visible until MX-1b, and the change is one line. SA fact for the user: "הזמנות" is today's Hebrew label for the Orders/payments screen (`nav.payments`), while bookings show as "פגישות" across the app (`dashboard.bookings`, `kpi.bookings`, `stats.bookings`, the CRM drawer). Decide before MX-1b's drawer copy review |

**Business questions (user), none blocking MX-0:** BQ-27 (module list and placement) and BQ-25 (keep switches, drop Excel) are due **before MX-4 switch-on** (SA Split Review); MX0-8 (Hebrew word for Bookings) is due before the MX-1b copy review; the Spanish names are drafts. Module ids can be renamed freely while no stored row exists (first real rows come with MX-4 switch-on); after that a rename needs SA (T-8).

### Optimisation suggestions (not blocking)
- The Hebrew-letter check: use the existing `/[֐-׿]/` form (precedent `ChatCommandExecutor.ts`); `lib/` is Tailwind-scanned, and that form already builds.
- `name` could be typed `Record<'en' | 'he' | 'es', string>`, reusing the Business OS language type if one is pure.
- Task 8: a full `npx tsc --noEmit -p .` can OOM. Filter its output to the three new files and check the command did not die (ship drill step 1).
- CI time: one pure test file in the existing Jest job adds milliseconds. No new job (meets XC-21 and the no-added-CI-time rule).

### Approval
[x] Workplan approved with conditions C-1…C-9. Proceed to implementation. Code review will walk C-1…C-9 against the diff.

### Code review

**Code Review by SA — 2026-10-25** (worktree `neuronforge-mx0`, uncommitted: `exportModules.ts`, `exportModuleSchema.ts`, `__tests__/exportModules.test.ts`)
**Status:** ⚠️ Code approved, with two doc-only fixes (F-1, F-2) to make before RM commits. No code change required.

#### Conditions walked against the diff

| # | Result |
|---|---|
| C-1 | ✅ Split into three files. `exportModules.ts` has one `import type` (classificationTypes) and nothing at runtime; `exportModuleSchema.ts` imports `zod` + `exportModules` only; neither has `server-only` |
| C-2 | ✅ `EXPORT_MODULE_IDS` tuple `as const` (the only `as` in the diff); `ExportModuleDefinition.id: ExportModuleId`, `on: boolean`; `EXPORT_MODULES: readonly ExportModuleDefinition[]`; `z.enum(EXPORT_MODULE_IDS)` with no cast; T-8 asserts map order = tuple order |
| C-3 | ✅ Helpers take `readonly ExportModuleDefinition[]`; `isModuleEnabled` / `moduleOfSection` / `sectionsOfModule` take `string`; `exportModuleProblems` takes the loose `ExportModuleRuleModule`, so every control plants without a cast. No `any`, no `as unknown as` in any file |
| C-4 | ✅ R-4 runs over registered ∪ include ∪ non-table; T-3 control asserts the exact `in no module` message |
| C-5 | ✅ `inputsFrom` resolves the parent table through `viaParentOf` and throws if the parent is not an include; T-9 asserts ≥1 link and `website_blocks → website_pages` |
| C-6 | ✅ Asserts 13 modules / 39 mapped sections only; no descriptor or include/exclude count |
| C-7 | ✅ Both repository `jest.mock` lines precede the `sections.ts` import; T-13 is a pure function over a CRLF-normalised string; the control is a CRLF-joined planted string covering multi-line, runtime-from-classificationTypes, `server-only`, `zod`, `export * from` |
| C-8 | 🔄 Task 1 and task 10 use `[E→D] E1 …`; §7's table row still says `[EXPORT→DELETE] MX-0 …` (F-1) |
| C-9 | ✅ §1 now says `10761291`; §6 records that the drawer/route halves are MX-1b's |

#### Rulings on the Dev's deviations

| # | Ruling |
|---|---|
| D-1 `sectionsOfModule(string)` → `[]` for unknown | ✅ Accepted. Fail closed and consistent with the other two helpers; MX-3 filters the registry by it, so an unknown id reads nothing |
| D-2 T-3 control plants into `includeSections` | ✅ Accepted. `inputsFrom` adds exactly `d.export.section` per include, so a planted string is the same input the rule would see, and building a descriptor with a non-`ExportSectionId` section would need the cast C-3 forbids. The descriptor path itself is exercised by the T-4 flip-to-exclude control |
| D-3 T-13 matches the quoted `'server-only'` | ✅ Accepted. Probed with a scratch script: `/['"]server-only['"]/` matches `import 'server-only'`, `import "server-only"` and `require("server-only")` (the last is also caught by the `require(` rule), and does not match the headers' backtick prose. The import-statement regex also catches `import "server-only"` as a disallowed import. Optional: add a double-quoted line to the control (S-1) |
| D-4 `requestedModulesSchema` max = `map.length` | ✅ Accepted. With the duplicate and enabled refinements the effective ceiling is the enabled count anyway; `max` is only the cheap first guard |
| D-5 No messages sent | ✅ Accepted: the parent EXPORT session owns coordination per the brief |

#### Other checks

| Check | Result |
|---|---|
| Hebrew regex | `HEBREW_LETTER` is literal U+0590–U+05FF (code points read from the file); T-7's `/[א-ת]/` is literal U+05D0–U+05EA. Both correct |
| Tailwind CSS-escape hazard | `lib/` **is** scanned (`app/globals.css` excludes only docs, scripts, .claude, root *.md, archive, supabase). No `\u` / `\x` in any new file. Ran the guard's decoder (`app/__tests__/tailwind-css-escape.guard.test.ts`) over the three files: the only hex-led escapes are two `\b` (U+000B, decodable) in the test; nothing undecodable. The guard scans tracked files only, so it will see these once committed; they pass |
| Controls fail on planted input | Every rule control asserts the exact problem list (`toEqual`), except T-5 and the duplicate-id case (`toContain`, still non-vacuous). Mentally mutated R-4 (registered only) → T-3 control gets `[]`; R-6 always true → both T-4 controls fail; `HEBREW_LETTER` always true → the Latin-he control fails. Independently, a parallel QA mutation planting `plugin_connections` into the real Smart links module turned T-1/T-2/T-4 and nine controls red while it was in place |
| `npm test -- …/exportModules.test.ts` | 34/34 pass (run twice on stable file hashes after QA's transient mutation was reverted) |
| Logging / console / `any` | None in any file; pure files, so Pino / correlationId do not apply |
| Dead code | None |
| Runtime behaviour | Nothing imports the new files; ZIP export untouched |

#### Code Review Comments

1. **F-1** `BUSINESS_OS_EXPORT_MX0_WORKPLAN.md` §7, "Messages to …" row — still `[EXPORT→DELETE] MX-0 workplan approved / PR opened / merged`. Change to the `[E→D] E1 <event>` format (C-8). — Priority: Low (doc only)
2. **F-2** `BUSINESS_OS_EXPORT_MX0_WORKPLAN.md` §2.1 — the code block still shows the superseded shape (`import { z }` in the map file, `as const satisfies`, the `as [ExportModuleId, …]` cast, `ExportModuleIdSchema` in this file) and the helper table lists `requestedModulesSchema` under `exportModules.ts`. MX-1b's Dev will read §2.1 first. Replace the block with the as-built shape or mark it "superseded by SA C-1/C-2, see the files". — Priority: Low (doc only)

#### Optimisation Suggestions
- S-1: T-13 control: add `import "server-only";` (double quotes) so the double-quote branch of D-3 is pinned, not just probed.
- S-2: `inputsFrom` relies on `viaParentOf(...)[0]` returning `undefined` for a missing parent and then throwing a `TypeError` on `.export`. It fails closed, but an explicit `if (!parent) throw` would give a readable message.

### Code Approved for QA: Yes (F-1, F-2 before the RM commit; no re-review needed for them)

## QA Testing Report

**QA — 2026-10-25**
**Test mode:** full
**Strategy used:** A (Jest unit). Pure config, helpers, Zod schema and a CI rule: no route, no DB, no UI, so no integration or browser check applies.
**Focus:** schema, security (never-exported tables), purity
**Skipped:** B/C/D/E: nothing to integrate or click in MX-0 (route and drawer halves are MX-1b, SA C-9). `test:bos-entitlements` not needed: no file imports `lib/business-os/entitlements/`.
**Input source:** prompt (TL) + workplan §5/§6

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Every `include` section in exactly one module; unknown or missing section fails CI (T-2, T-3, T-5) | ✅ | Pass | Real map clean (T-1). Mutation in the real file: drop `images` from Website → 13 tests fail incl. T-1, T-2, T-3; `clients` added to Services → 12 fail incl. T-1, T-2. Reverted, md5 unchanged |
| A never-exported table cannot be placed / switched on; reclassify to `exclude` fails CI (T-4) | ✅ | Pass | Mutation in the real file: `plugin_connections` planted into Smart links → 13 fail incl. T-4. In-test controls cover `website_page_views` and the `smart_links` → `exclude` flip |
| Switched-off module not returned by `enabledModules`, refused by `requestedModulesSchema` (T-11, T-12) | ✅ | Pass | Real file edited to Website `on: false`: probe shows `enabledModules` = 12, `isModuleEnabled('website')` false, `['website']` refused, `['clients']` still accepted, all 13 refused. Reverted |
| Module ids validated by a Zod enum built from the map (T-12) | ✅ | Pass | `z.enum(EXPORT_MODULE_IDS)`, no cast. Probe: accepts `['clients']`, all 13 (and reversed); refuses `[]`, unknown, duplicate, 14 entries, `null`, object, `'Clients'`, `' clients'`, `'__proto__'`; `ExportModuleIdSchema` refuses `'toString'`; `isModuleEnabled('constructor')` false |
| Every module has en, he and es names (T-7) | ✅ | Pass | T-7 + R-7 controls |
| File is pure and client-importable (T-13) | ✅ | Pass | `exportModules.ts` has one `import type` from `classificationTypes`, no zod, no `require`, no `'server-only'`. `exportModuleSchema.ts` imports only `zod` + `exportModules`. No backslash escapes in either file (Tailwind hazard); LF line endings |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Turning a real switch off breaks three helper/schema tests** — `__tests__/exportModules.test.ts` — Severity: Low. With Website `on: false` in the real map, these fail: `enabledModules keeps map order…`, `isModuleEnabled … switched-off module` and `requestedModulesSchema accepts one module and all 13`. They assert the real map is all on (`enabledModules()` equals all 13 ids, `isModuleEnabled('website')` true). Turning a switch off is a supported product action ("code edit + deploy"), so it would also need a test edit. That may be a deliberate pin, but nothing says so. Either point those assertions at an injected all-on map, or add a comment that the pin is deliberate.
2. **§5 T-13 row is stale** — the row still says the map "imports nothing but `zod` and a type-only import". After SA C-1 the map imports no zod, and the test enforces that. Doc wording only.
3. `requestedModulesSchema` `.max(map.length)` counts switched-off modules too. That does no harm, because the duplicate and switched-on refinements already refuse anything longer than the enabled set. Noted only.

### Test Outputs / Logs
```text
npx jest lib/business-os/data-export
Test Suites: 15 passed, 15 total
Tests:       498 passed, 498 total      (exportModules.test.ts: 34/34; exportClassification.test.ts PASS, untouched)

Mutations (real exportModules.ts, restored from a byte copy; md5 174b009b… before and after each):
  drop 'images' from website           → Tests: 13 failed, 21 passed
  'clients' also in services           → Tests: 12 failed, 22 passed
  'plugin_connections' in smart_links  → Tests: 13 failed, 21 passed
  website on:false                     → probe {enabled:12, isWebsiteEnabled:false, acceptsWebsite:false, acceptsClients:true, acceptsAll13:false}
                                         main suite: 3 failed (Edge Case 1)

tsc --noEmit (full project, 8 GB heap, completed — no OOM): 0 errors in exportModules.ts / exportModuleSchema.ts / exportModules.test.ts
  (only data-export hit: exportClassification.test.ts(2025) TS2353, pre-existing, file untouched)

Importers of the new files (repo-wide grep, excl. node_modules/.next/.claude): only the 3 new files themselves
```
The 24 full-suite failures Dev saw outside data-export are pre-existing, for two reasons. No other file imports the new modules, and the worktree diff touches only the 4 MX-0 paths. Nothing outside this folder can change behaviour. Per the brief, they were not re-run on the main checkout.

### Final Status
- [x] All acceptance criteria pass — ready for commit (Edge Case 1 recommended, not blocking)
- [ ] Issues found — Dev must address before commit

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/bos-export-mx0-module-map` |
| Commit | `feat(business-os): export module map with per-module switches (MX-0)` |
| PR | see PR |
| Merge | auto-merge (merge queue, merge commit) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev, DELETE session, for hand-off) | MX-0 workplan: pure `exportModules.ts` (13 modules, 39 sections, en/he/es names, per-module `on`, Zod enum, helpers, `exportModuleProblems` R-1…R-9), one new test file T-1…T-13 incl. "every section in exactly one module" and "never-exported table cannot be switched on"; no migration, no shared file; open items MX0-1…MX0-7 |
| 2026-10-25 | SA workplan review (SA) | ⚠️ Approved with conditions C-1…C-9, re-checked on `10761291` (no section/descriptor change since `7e51af5b`; 39/38/161 confirmed; placement scripted). Zod split into `exportModuleSchema.ts`; id tuple instead of `as const satisfies` + cast; R-4 widened so T-3 is non-vacuous; R-8 resolves parent table → section; no count lines; repository mocks + CRLF in T-13; `[E→D] E1` message format. MX0-8 left to the user (non-blocking) |
| 2026-10-25 | Implemented (Dev, EXPORT session) | Three new files per SA C-1 (`exportModules.ts`, `exportModuleSchema.ts`, `exportModules.test.ts`, 34 tests green); C-2…C-7, C-9 applied; base `10761291`; uncommitted for diff review |
| 2026-10-25 | SA code review (SA) | ⚠️ Code approved for QA. C-1…C-7, C-9 met; C-8 partly (§7 row). Deviations D-1…D-5 accepted (D-3 probed: catches single- and double-quoted `server-only`). Hebrew ranges correct, no undecodable CSS escape (lib/ is Tailwind-scanned), 34/34 pass. Doc-only fixes F-1 (§7 message format), F-2 (§2.1 superseded code block) before commit |
