# Workplan: V6 Data Schema Open Items (O11, O14, O16, O18, O19, O20)

**Developer:** Dev
**Requirement:** [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) -- Open Items section
**Date:** 2026-03-24
**Status:** Code Complete

## Analysis Summary

This workplan addresses 6 open items from the V6 Workflow Data Schema workplan. All items touch the ExecutionGraphCompiler (compiler-level fixes), with O11 also touching the intent system prompt and O18 also touching StepExecutor (runtime-level).

**Files affected:**
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` -- all 6 items
- `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` -- O11 Layer A
- `lib/pilot/StepExecutor.ts` -- O18 runtime check

## Implementation Approach

Each fix follows the project's platform design principle of generic, plugin-agnostic compiler logic. No plugin-specific hardcoding. All fixes add structured Pino logging via the compiler's existing `log()` and `warn()` helpers.

**Key constraints from SA:**
- O11: WARNING-ONLY for unreferenced config keys. Do NOT auto-replace hardcoded values.
- O16: Detection + warning ONLY. No fallback syntax.
- O19: Binary field blocklist approach (simplest).

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | modify | O19, O14, O11-B, O16, O20, O18 compiler fixes |
| `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | modify | O11-A prompt instruction for config references |
| `lib/pilot/StepExecutor.ts` | modify | O18 runtime empty results check |
| `docs/workplans/v6-data-schema-open-items-workplan.md` | create | This workplan |

## Task List

- [x] Task 1 (O19 - Critical): Add binary field blocklist to scatter-gather merge operations
- [x] Task 2 (O14 - High): Detect single-object merge disguised as map, compile as "set"
- [x] Task 3 (O11 - Medium): Layer A prompt + Layer B warning-only config validation
- [x] Task 4 (O16 - Medium): Warn when nullable extraction fields feed required params
- [x] Task 5 (O20 - Medium): Recursive field path resolution in checkSingleRef
- [x] Task 6 (O18 - Medium): Compiler assertions + runtime empty results check

## SA Review Notes

**Code Review by SA -- 2026-03-24**
**Status:** 🔄 Fix Required

### Constraint Verification

| Item | Constraint | Verdict |
|------|-----------|---------|
| O11 | WARNING-ONLY, no auto-replacement | PASS -- `enforceConfigReferences` returns workflow unchanged, uses `this.warn()` only |
| O16 | Detection + warning only, no fallback syntax | PASS -- `detectNullableToRequiredMappings` is void, emits warnings only |
| O19 | Binary field blocklist approach | PASS -- `BINARY_FIELD_BLOCKLIST` static Set with `isBinaryBlockedField` check |
| O18 | `warn` default, `throw` only before scatter-gather | PASS -- compiler sets `_on_empty: 'throw'` only when `nextStep?.type === 'scatter_gather'`, defaults to `'warn'` |

### Code Review Comments

1. **StepExecutor.ts: `collectExecutionMetadata` -- 12 `console.log`/`console.warn` calls** -- Priority: **High (Blocking)**
   - Lines 4801, 4805, 4811, 4817, 4819, 4853, 4856, 4861: The newly added `collectExecutionMetadata` method uses `console.log` and `console.warn` throughout instead of the structured Pino `logger` already available in this file. This directly violates CLAUDE.md mandatory rule: "All API routes use correlationId and structured Pino logging -- no console.log". The `logger` instance is already imported and initialized at module level in StepExecutor.ts. Replace all `console.log` with `logger.debug` and `console.warn` with `logger.warn`.

2. **ExecutionGraphCompiler.ts:231 -- Stale inline comment** -- Priority: **Low**
   - Line 231 comment says `"auto-replace hardcoded values"` but the implementation is warning-only per SA directive. The method JSDoc (line 3438) correctly says "does NOT auto-replace". Update the inline comment at line 231 to say `"warn about hardcoded values"` for consistency.

3. **ExecutionGraphCompiler.ts:4256-4263 -- Plugin-specific rename map in `buildMergeFieldMapping`** -- Priority: **Medium (Advisory)**
   - The `renameMap` contains hardcoded plugin-specific field mappings: `drive_link` -> `web_view_link`, `email_sender` -> `_parentData.from`, etc. This violates the Platform Design Principle "No Hardcoding in System Prompts" / "Fix Issues at the Root Cause". These mappings are Google Drive and Gmail specific. Acceptable for now as a pragmatic short-term solution since this is existing code from O14 (not newly introduced in this cycle), but flag it for future refactoring. The correct fix is for the IntentContract to produce output_schema field names that match the actual plugin output fields, eliminating the need for rename maps.

4. **ExecutionGraphCompiler.ts:4164 -- JSON.stringify full node for regex scanning** -- Priority: **Medium (Advisory)**
   - `collectDownstreamReferencedFields` serializes every graph node via `JSON.stringify(n)` to scan for variable references. For large graphs this could be slow. Acceptable for now since graphs are typically small (< 50 nodes), but worth noting for future optimization if performance issues arise.

5. **StepExecutor.ts:4829-4835 -- Filesystem read in `collectExecutionMetadata`** -- Priority: **Medium (Advisory)**
   - The method uses `await import('fs')` and reads plugin definition JSON from disk at runtime for every action step during batch calibration. This is not part of the O18 implementation per se (it is batch calibration metadata collection), but since it was added in this diff: consider caching plugin definitions or using the existing `pluginManager` pattern to avoid repeated filesystem reads. Not blocking since it only runs in `batchCalibrationMode`.

6. **StepExecutor.ts:4816 -- Unsafe cast `(context as any).executionSummaryCollector`** -- Priority: **Low**
   - Uses `as any` cast to access `executionSummaryCollector`. Add a comment explaining why this is necessary (e.g., context interface does not expose calibration internals). Per CLAUDE.md: "if any is unavoidable, add a comment explaining why".

### Items Requiring Fix Before QA

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | `lib/pilot/StepExecutor.ts` | Replace all `console.log`/`console.warn` in `collectExecutionMetadata` with structured Pino `logger` calls | **Blocking** |
| 2 | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:231` | Update stale comment from "auto-replace" to "warn about" | Non-blocking |
| 6 | `lib/pilot/StepExecutor.ts:4816` | Add `// any: context interface does not expose calibration internals` comment | Non-blocking |

### Optimisation Suggestions

- O19 `findCurrentMergeNodeId`: The current heuristic (find first transform node inside a loop) may return the wrong node if there are multiple transform nodes in the loop body. Consider passing the current node ID through `CompilerContext` during compilation instead of guessing via iteration. Not blocking -- current behavior is safe (worst case: no downstream filtering applied, all fields included).
- O14 `buildMergeFieldMapping` rename map: Long-term, migrate these to a schema-driven approach where the IntentContract output_schema uses canonical plugin field names. Track as technical debt.
- O18 runtime check: The `_on_empty` property is added as a dynamic property via `stepAny._on_empty`. Consider adding it to the `WorkflowStep` type definition (optional field) to make it type-safe. Not blocking.

### Code Approved for QA: No

Fix blocking item #1 (console.log violations in StepExecutor.ts `collectExecutionMetadata`), then SA will approve for QA.
Items #2 and #6 are non-blocking but should be fixed in the same pass.

## QA Testing Report
[QA will populate this section]

## Commit Info
[RM will populate this section]
