# Delta Migration: Document Extractor from feature/offir-dev

> **Last Updated**: 2026-04-03
> **Author**: BA Agent
> **Status**: DRAFT - Pending user approval after diff investigation

## Overview

Migrate only the new/changed document extractor code from the co-worker's branch `feature/offir-dev` into the current working branch `feature/v6-intent-contract-data-schema`. This is a delta migration (not a full merge) -- we bring over only what is new or changed, avoiding unrelated work on `feature/offir-dev`.

---

## Context

| Item | Value |
|------|-------|
| **Target branch** | `feature/v6-intent-contract-data-schema` (current) |
| **Source branch** | `feature/offir-dev` (co-worker's latest extractor code) |
| **Scope** | Document extractor system only |
| **Strategy** | Cherry-pick / file-level diff and apply deltas |

---

## Current State on Target Branch

The following extraction files already exist on `feature/v6-intent-contract-data-schema`:

### Core Extraction Files (exist)

| File | Status |
|------|--------|
| `lib/extraction/index.ts` | Exists -- barrel export, includes deprecated re-exports |
| `lib/extraction/types.ts` | Exists -- full type definitions |
| `lib/extraction/DeterministicExtractor.ts` | Exists -- main orchestrator, schema-driven, 3-tier fallback |
| `lib/extraction/SchemaFieldExtractor.ts` | Exists -- pattern-based field extraction with LLM fallback |
| `lib/extraction/PdfTypeDetector.ts` | Exists -- pdfjs-dist + pdf-parse + Textract fallback |
| `lib/extraction/TextractClient.ts` | Exists -- AWS Textract wrapper |
| `lib/extraction/LLMFieldMapper.ts` | Exists -- Claude-based field mapping fallback |
| `lib/extraction/UniversalExtractor.ts` | Exists -- multi-format extraction router |
| `lib/extraction/DocumentTypeClassifier.deprecated.ts` | Exists -- deprecated |
| `lib/extraction/SchemaMapper.deprecated.ts` | Exists -- deprecated |
| `lib/extraction/extractors/` | Exists -- deprecated extractors |

### Plugin Files (exist)

| File | Status |
|------|--------|
| `lib/plugins/definitions/document-extractor-plugin-v2.json` | Exists -- plugin definition |
| `lib/server/document-extractor-plugin-executor.ts` | Exists -- executor with MIME detection, file object handling |
| `lib/server/plugin-executer-v2.ts` | Exists -- registry includes `document-extractor` mapping |

### Known Missing File

| File | Status |
|------|--------|
| `lib/extraction/utils/SchemaAwareDataExtractor.ts` | **DOES NOT EXIST** on current branch |
| `lib/extraction/utils/` directory | **DOES NOT EXIST** on current branch |

### Documentation (on current branch)

| File | Status |
|------|--------|
| `docs/EXTRACTOR_CODE_GUIDE.md` | Exists -- comprehensive guide referencing `feature/offir-dev` |

---

## Investigation Required (Dev Agent Pre-Work)

Before implementation, the Dev agent must run the following commands to produce the actual diff. These commands must be run as the first step of the workplan.

### Step 1: Fetch the remote branch

```bash
git fetch origin feature/offir-dev
```

### Step 2: Diff each relevant path

```bash
# Core extraction directory
git diff feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/extraction/

# Plugin executor
git diff feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/server/document-extractor-plugin-executor.ts

# Plugin definition
git diff feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/plugins/definitions/document-extractor-plugin-v2.json

# Plugin registry
git diff feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/server/plugin-executer-v2.ts

# Check for new files (scripts, test-files)
git diff --name-status feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- scripts/
git diff --name-status feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- test-files/

# Check for new doc files
git diff --name-status feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- docs/DOCUMENT_EXTRACTION*.md

# Full summary of all changed files
git diff --stat feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/extraction/ lib/server/document-extractor-plugin-executor.ts lib/plugins/definitions/document-extractor-plugin-v2.json lib/server/plugin-executer-v2.ts scripts/ test-files/ docs/DOCUMENT_EXTRACTION*.md
```

### Step 3: Check for SchemaAwareDataExtractor.ts on offir-dev

```bash
git show origin/feature/offir-dev:lib/extraction/utils/SchemaAwareDataExtractor.ts
```

### Step 4: Check for any new files on offir-dev not present on current branch

```bash
git diff --name-only --diff-filter=A feature/v6-intent-contract-data-schema...origin/feature/offir-dev -- lib/extraction/ lib/server/ lib/plugins/definitions/
```

---

## Files in Scope for Migration

Based on the extractor code guide (`docs/EXTRACTOR_CODE_GUIDE.md`), the following files are in scope. The "Action" column will be filled after the diff investigation.

### Core Extraction Files

| File | Expected Action | Notes |
|------|----------------|-------|
| `lib/extraction/index.ts` | Diff and merge delta | May have new exports |
| `lib/extraction/types.ts` | Diff and merge delta | May have new types |
| `lib/extraction/DeterministicExtractor.ts` | Diff and merge delta | Core orchestrator |
| `lib/extraction/SchemaFieldExtractor.ts` | Diff and merge delta | Field extraction logic |
| `lib/extraction/PdfTypeDetector.ts` | Diff and merge delta | PDF analysis |
| `lib/extraction/TextractClient.ts` | Diff and merge delta | AWS Textract |
| `lib/extraction/LLMFieldMapper.ts` | Diff and merge delta | LLM fallback |
| `lib/extraction/UniversalExtractor.ts` | Diff and merge delta | Multi-format |
| `lib/extraction/utils/SchemaAwareDataExtractor.ts` | **NEW FILE -- copy over** | Does not exist on current branch |

### Plugin Files

| File | Expected Action | Notes |
|------|----------------|-------|
| `lib/plugins/definitions/document-extractor-plugin-v2.json` | Diff and merge delta | Plugin schema |
| `lib/server/document-extractor-plugin-executor.ts` | Diff and merge delta | Plugin executor |
| `lib/server/plugin-executer-v2.ts` | Diff and merge delta | Only extractor-related changes |

### Test/Script Files (optional -- user to decide)

| File | Expected Action | Notes |
|------|----------------|-------|
| `scripts/test-invoice-extraction.ts` | Copy if new | Test script |
| `scripts/test-full-extraction.ts` | Copy if new | Test script |
| `scripts/test-llm-extraction.ts` | Copy if new | Test script |
| `test-files/*.pdf` | Copy if new | Test PDFs |
| `scripts/debug-*.ts` | Copy if new | Debug scripts |

### Documentation Files (optional -- user to decide)

| File | Expected Action | Notes |
|------|----------------|-------|
| `docs/DOCUMENT_EXTRACTION_FINAL_STATUS.md` | Copy if new | Status doc |
| `docs/DOCUMENT_EXTRACTION_FILES_FOR_DEVELOPER.md` | Copy if new | File listing |
| `docs/DOCUMENT_EXTRACTION_SUMMARY.md` | Copy if new | Summary |
| `docs/DOCUMENT_EXTRACTION_SMART_MODE.md` | Copy if new | Smart mode doc |
| `docs/DOCUMENT_EXTRACTION_STATUS.md` | Copy if new | Implementation status |

---

## Potential Conflicts

| Area | Risk | Mitigation |
|------|------|------------|
| `lib/server/plugin-executer-v2.ts` | Current branch may have added new plugins to the registry that offir-dev does not have | Only take extractor-related changes from this file |
| `lib/extraction/index.ts` | Current branch has exports for `UniversalExtractor` which may not exist on offir-dev | Keep current branch exports, add any new ones from offir-dev |
| `lib/extraction/types.ts` | Both branches may have modified types | Merge carefully, keep all types from both |
| General imports | New files from offir-dev may import modules not present on current branch | Verify all imports resolve after migration |

---

## Acceptance Criteria

1. **All new files** from `feature/offir-dev` related to the extractor are present on the target branch (especially `SchemaAwareDataExtractor.ts`)
2. **All changed files** have the latest improvements from `feature/offir-dev` merged in without losing current branch work
3. **No unrelated changes** from `feature/offir-dev` are brought over (only extractor-related code)
4. **TypeScript compiles** -- `npm run build` passes (or at minimum, no new type errors in extraction files)
5. **Imports resolve** -- all imports in migrated files point to valid modules
6. **Plugin registry** still contains all plugins that exist on the current branch (no regressions)
7. **Existing functionality preserved** -- no changes to non-extraction code

---

## Out of Scope

- Merging any non-extractor changes from `feature/offir-dev`
- Refactoring the extraction system
- Adding new features beyond what exists on `feature/offir-dev`
- Modifying the V6 pipeline or any other system

---

## Recommended Approach

1. **Fetch** `origin/feature/offir-dev`
2. **Diff** all files listed above between the two branches
3. **Present diff summary** to user for review before applying
4. **Apply new files** (files that exist only on offir-dev) by copying them
5. **Apply deltas** (files that differ) using selective merge or manual patching
6. **Skip unchanged files** (files identical on both branches)
7. **Verify** TypeScript compilation and import resolution
8. **Test** basic extraction flow if test scripts are available

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-03 | Created | Initial requirements based on user request and code investigation |
