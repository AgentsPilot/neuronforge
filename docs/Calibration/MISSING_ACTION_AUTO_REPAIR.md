# Missing Action Auto-Repair

> **Last Updated**: 2026-04-10

## Overview

This document describes the automatic repair system for workflow steps that are missing the required `action` field. This is a workflow generation bug where the V6 pipeline creates action steps without specifying which action to execute.

## Problem

The error manifests as:
```
ValidationError: Workflow validation failed: Action step step1 missing action, Action step step16 missing action
```

This occurs when `pilot_steps` contains steps like:
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2"
  // Missing: "action" field!
}
```

Instead of the correct format:
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "search_emails"
}
```

## Solution: Automatic Action Inference

The `StructuralRepairEngine` has been extended to automatically detect and fix missing action fields by analyzing step context and matching against available plugin actions.

### How It Works

1. **Detection**: During workflow scan, identify action steps missing the `action` field
2. **Context Analysis**: Extract step context from `name` and `description` fields
3. **Action Matching**: Score each available action based on:
   - Exact name matches
   - Partial word matches
   - Keyword matches from action descriptions
   - Semantic similarity (verb synonyms)
4. **Confidence Scoring**: Calculate confidence based on match quality
5. **Application**: Apply the highest-scoring action with appropriate confidence level

### Confidence Levels

| Scenario | Confidence | Risk | Example |
|----------|-----------|------|---------|
| Plugin has only one action | 95% | Low | ChatGPT Research plugin |
| Exact action name in step name | 80-95% | Low | "search emails" → `search_emails` |
| Strong keyword matches | 60-80% | Medium | "get sheet data" → `read_sheet` |
| Weak/no matches | 20-30% | High | No context → first action |

### Semantic Matching

The engine recognizes common action verbs and their synonyms:

```typescript
{
  search: ['search', 'find', 'query', 'lookup', 'get'],
  create: ['create', 'add', 'new', 'insert', 'make'],
  update: ['update', 'edit', 'modify', 'change'],
  delete: ['delete', 'remove', 'trash'],
  send: ['send', 'deliver', 'forward'],
  list: ['list', 'get', 'fetch', 'retrieve']
}
```

## Implementation

### Files Modified

**`lib/pilot/shadow/StructuralRepairEngine.ts`** (Extended)
- Added `missing_action` to `StructuralIssueType`
- Added `infer_action` to `StructuralFixAction`
- Added `PluginManagerV2` dependency
- Added `initialize()` method to load plugin manager
- Added detection in `scanWorkflow()` at line ~220
- Added `inferActionFromContext()` method (147 lines)
- Added `extractKeywords()` helper method
- Made `proposeStructuralFix()` async
- Added `infer_action` case in `applyStructuralFix()`

### Integration

The fix is automatically applied during batch calibration:

**`app/api/v2/calibrate/batch/route.ts`** (No changes needed - already integrated)
- Line 143-190: Structural scan and auto-fix
- Persists fixes to database before execution
- Continues even if some issues can't be auto-fixed

## Usage

### Automatic (Production)

The repair runs automatically during batch calibration:

1. User runs calibration
2. StructuralRepairEngine scans workflow
3. Missing actions detected
4. Auto-fix attempts inference
5. Fixed workflow persisted to database
6. Execution continues with repaired workflow

### Manual Testing

**Conceptual Demo:**
```bash
node scripts/test-action-repair.ts
```

The demo script shows how the inference algorithm works for three scenarios:
1. **Clear context**: "Search for urgent emails" → `search_emails` (75% confidence)
2. **Ambiguous context**: "Get sheet data" → `read_sheet` (25% confidence)
3. **Single action plugin**: ChatGPT Research → `research` (95% confidence)

**Production Testing:**

To see the actual auto-repair in action:
1. Run batch calibration on an agent with missing actions
2. Check server logs for `[StructuralRepair] Inferred missing action`
3. Verify the agent's `pilot_steps` were updated in the database
4. Confirm execution continues without validation errors

## Examples

### Example 1: Gmail Search

**Before:**
```json
{
  "id": "step1",
  "type": "action",
  "name": "Search for urgent emails",
  "plugin": "google-mail-plugin-v2",
  "params": { "query": "is:urgent" }
}
```

**After Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "name": "Search for urgent emails",
  "plugin": "google-mail-plugin-v2",
  "action": "search_emails",
  "params": { "query": "is:urgent" }
}
```

**Fix Details:**
- Inferred action: `search_emails`
- Confidence: 85%
- Reasoning: "Matched: word: search, keyword: emails, verb: search→search"

### Example 2: Google Sheets Read

**Before:**
```json
{
  "id": "step5",
  "type": "action",
  "name": "Get spreadsheet data",
  "plugin": "google-sheets-plugin-v2",
  "params": { "spreadsheet_id": "abc123" }
}
```

**After Auto-Fix:**
```json
{
  "id": "step5",
  "type": "action",
  "name": "Get spreadsheet data",
  "plugin": "google-sheets-plugin-v2",
  "action": "read_sheet",
  "params": { "spreadsheet_id": "abc123" }
}
```

**Fix Details:**
- Inferred action: `read_sheet`
- Confidence: 75%
- Reasoning: "Matched: word: get, keyword: data, verb: list→get"

### Example 3: ChatGPT Research (High Confidence)

**Before:**
```json
{
  "id": "step3",
  "type": "action",
  "name": "Research AI trends",
  "plugin": "chatgpt-research-plugin-v2",
  "params": { "prompt": "What are AI trends?" }
}
```

**After Auto-Fix:**
```json
{
  "id": "step3",
  "type": "action",
  "name": "Research AI trends",
  "plugin": "chatgpt-research-plugin-v2",
  "action": "research",
  "params": { "prompt": "What are AI trends?" }
}
```

**Fix Details:**
- Inferred action: `research`
- Confidence: 95%
- Reasoning: "Only one action available for plugin chatgpt-research-plugin-v2"

## Logging

All inference attempts are logged with full context:

```json
{
  "level": "info",
  "module": "StructuralRepairEngine",
  "stepId": "step1",
  "stepName": "search for urgent emails",
  "plugin": "google-mail-plugin-v2",
  "inferredAction": "search_emails",
  "confidence": 0.85,
  "score": 85,
  "matches": ["word: search", "keyword: emails", "verb: search→search"]
}
```

## Limitations

1. **Low Confidence Cases**: If step has no context (empty name/description), defaults to first action with 20-30% confidence
2. **Ambiguous Actions**: Multiple similar actions may cause incorrect inference
3. **Plugin Not Found**: Cannot fix if plugin is not in registry
4. **No Fallback**: If inference fails, issue remains unfixed (requires regeneration)

## Future Improvements

1. **LLM-Based Inference**: Use Claude/GPT to infer action from full step context
2. **Historical Learning**: Track successful inferences to improve future matches
3. **User Confirmation**: For low-confidence fixes, ask user to confirm before applying
4. **V6 Pipeline Fix**: Address root cause in workflow generation to prevent issue

## Related Files

- `/lib/pilot/shadow/StructuralRepairEngine.ts` - Core repair logic
- `/lib/pilot/shadow/PreFlightValidator.ts` - Pre-flight validation
- `/app/api/v2/calibrate/batch/route.ts` - Batch calibration integration
- `/app/api/v2/calibrate/inspect/route.ts` - Diagnostic endpoint
- `/lib/server/plugin-manager-v2.ts` - Plugin metadata access
- `/scripts/test-action-repair.ts` - Test script

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-10 | Initial implementation | Added missing action auto-repair to StructuralRepairEngine with context-based inference |
