# Auto-Repair for Config References and Missing Parameters

> **Last Updated**: 2026-04-10

## Overview

This document describes the automatic repair system for two critical workflow generation bugs that cause immediate execution failures:

1. **Invalid Config References**: Steps using `{{config.X}}` instead of `{{input.X}}`
2. **Missing Required Parameters**: Action steps missing required parameters like email recipients

These are **silent auto-repairs** - users never see these technical errors. The system fixes them automatically during batch calibration.

## Problem 1: Invalid Config References

### The Error

```
ValidationError: Unknown variable reference root: config
```

### Root Cause

The V6 workflow generation pipeline sometimes creates steps with `{{config.X}}` variable references, but the ExecutionContext only recognizes these variable roots:

- `input`/`inputs` - Agent input values
- `var` - Step output variables
- `current`/`item` - Loop iteration variables
- `loop` - Loop metadata
- Custom scatter/gather variables

**NOT `config`** - This is not a valid variable root.

### Example

**Before Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "to": "{{config.recipient_email}}",
    "subject": "Hello",
    "body": "Test message"
  }
}
```

**After Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "to": "{{input.recipient_email}}",
    "subject": "Hello",
    "body": "Test message"
  }
}
```

### How It Works

1. **Detection**: Scan all step parameters for `{{config.X}}` pattern
2. **Replacement**: Replace with `{{input.X}}` using regex
3. **Confidence**: 100% (this is a known fix)
4. **Logging**: Silently log the fix for debugging

---

## Problem 2: Missing Required Parameters

### The Error

```
Error: Recipient address required
```

### Root Cause

The V6 pipeline sometimes generates action steps without populating required parameters defined in the plugin schema.

### Example

**Before Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "subject": "Hello",
    "body": "Test message"
    // Missing: "to" (required parameter)
  }
}
```

**After Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "to": "{{input.recipient_email}}",
    "subject": "Hello",
    "body": "Test message"
  }
}
```

### Smart Default Generation

The system can generate intelligent defaults for:

| Parameter Type | Default Value | Example |
|---|---|---|
| **Schema default** | Use schema's `default` field | `false`, `"draft"` |
| **Boolean** | `false` | `include_attachments: false` |
| **Number with minimum** | Use `minimum` value | `max_results: 10` |
| **Enum string** | Use first option | `priority: "normal"` |
| **Email parameters** | `{{input.email}}` or `{{input.recipient_email}}` | `to: "{{input.recipient_email}}"` |
| **ID parameters** | `{{input.[param_name]}}` | `spreadsheet_id: "{{input.spreadsheet_id}}"` |

### Confidence Levels

| Scenario | Confidence | Action |
|---|---|---|
| Schema has explicit default | 100% | Always apply |
| Boolean parameter | 100% | Default to `false` |
| Email parameter + agent has email input | 90% | Use `{{input.email}}` |
| ID parameter | 80% | Use `{{input.[param_name]}}` |
| No smart default possible | 0% | Skip (cannot auto-fix) |

---

## Implementation

### Files Modified

**`/lib/pilot/shadow/StructuralRepairEngine.ts`** (Extended)

Added:
- `invalid_config_reference` to `StructuralIssueType` (line 46)
- `missing_required_parameter` to `StructuralIssueType` (line 47)
- `rewrite_config_to_input` to `StructuralFixAction` (line 63)
- `add_missing_parameter` to `StructuralFixAction` (line 64)
- `findConfigReferences()` method (lines 1029-1039)
- `findMissingRequiredParams()` method (lines 1044-1083)
- `canGenerateSmartDefault()` method (lines 1088-1115)
- `generateSmartDefault()` method (lines 1120-1180)
- Detection logic in `scanWorkflow()` (lines 262-286)
- Fix proposals in `proposeStructuralFix()` (lines 512-556)
- Fix application in `applyStructuralFix()` (lines 878-912)

### Detection Logic

**Config References** (lines 262-270):
```typescript
// Issue 7: Invalid {{config.X}} references (should be {{input.X}})
const configRefs = this.findConfigReferences(paramsStr);
if (configRefs.length > 0) {
  issues.push({
    type: 'invalid_config_reference',
    stepId,
    description: `Uses {{config.X}} instead of {{input.X}}: ${configRefs.join(', ')}`,
    severity: 'critical', // Blocks execution
    autoFixable: true
  });
}
```

**Missing Required Parameters** (lines 272-286):
```typescript
// Issue 8: Missing required parameters
if (step.plugin && step.action) {
  const missingParams = await this.findMissingRequiredParams(step);
  for (const param of missingParams) {
    issues.push({
      type: 'missing_required_parameter',
      stepId,
      description: `Missing required parameter: ${param.name}`,
      severity: 'critical', // Blocks execution
      autoFixable: param.hasSmartDefault
    });
  }
}
```

### Fix Proposals

**Config References** (lines 512-525):
```typescript
case 'invalid_config_reference': {
  const match = issue.description.match(/Uses \{\{config\.X\}\} instead of \{\{input\.X\}\}: (.+)/);
  const configRefs = match ? match[1].split(', ') : [];

  return {
    action: 'rewrite_config_to_input',
    description: `Rewrite ${configRefs.length} {{config.X}} reference(s) to {{input.X}}`,
    targetStepId: issue.stepId,
    confidence: 1.0, // This is a known fix
    risk: 'low',
    fix: { configRefs }
  };
}
```

**Missing Parameters** (lines 527-556):
```typescript
case 'missing_required_parameter': {
  const match = issue.description.match(/Missing required parameter: (\w+)/);
  if (!match) return noFix;

  const paramName = match[1];
  const missingParams = await this.findMissingRequiredParams(step);
  const paramInfo = missingParams.find(p => p.name === paramName);

  if (!paramInfo || !paramInfo.hasSmartDefault) {
    return { ...noFix, description: `Cannot generate smart default for parameter: ${paramName}` };
  }

  const defaultValue = this.generateSmartDefault(paramInfo.schema, paramName, step, agent);

  return {
    action: 'add_missing_parameter',
    description: `Add missing parameter "${paramName}" with smart default: ${JSON.stringify(defaultValue)}`,
    targetStepId: issue.stepId,
    confidence: 0.7,
    risk: 'medium',
    fix: {
      paramName,
      paramValue: defaultValue
    }
  };
}
```

### Fix Application

**Config References** (lines 878-889):
```typescript
case 'rewrite_config_to_input': {
  // Rewrite all {{config.X}} to {{input.X}} in step params
  const paramsStr = JSON.stringify(step.params || {});
  const updatedParamsStr = paramsStr.replace(/\{\{config\./g, '{{input.');
  step.params = JSON.parse(updatedParamsStr);

  logger.info({
    stepId: proposal.targetStepId,
    configRefs: proposal.fix.configRefs
  }, '[StructuralRepair] Rewrote {{config.X}} to {{input.X}}');

  return { fixed: true, fixApplied: proposal };
}
```

**Missing Parameters** (lines 891-912):
```typescript
case 'add_missing_parameter': {
  // Ensure params object exists
  if (!step.params) {
    step.params = {};
  }

  step.params[proposal.fix.paramName] = proposal.fix.paramValue;

  logger.info({
    stepId: proposal.targetStepId,
    paramName: proposal.fix.paramName,
    paramValue: proposal.fix.paramValue
  }, '[StructuralRepair] Added missing required parameter with smart default');

  return { fixed: true, fixApplied: proposal };
}
```

---

## Integration

The fixes run automatically during batch calibration via the existing integration:

**`/app/api/v2/calibrate/batch/route.ts`** (No changes needed - already integrated)

Lines 143-190: Structural scan and auto-fix
- Scans workflow for all structural issues
- Auto-fixes **silently** before execution
- Persists fixes to database
- Continues execution with repaired workflow

**User Experience:**
- User clicks "Run Calibration"
- System automatically detects and fixes config references and missing parameters
- User never sees technical error messages
- Workflow executes successfully

---

## Examples

### Example 1: Gmail Send Email (Both Issues)

**Before:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "subject": "Weekly Report",
    "body": "{{config.report_content}}"
    // Missing: "to" parameter
    // Invalid: {{config.report_content}}
  }
}
```

**After Auto-Fix:**
```json
{
  "id": "step1",
  "type": "action",
  "plugin": "google-mail-plugin-v2",
  "action": "send_email",
  "params": {
    "to": "{{input.recipient_email}}",
    "subject": "Weekly Report",
    "body": "{{input.report_content}}"
  }
}
```

**Fix Details:**
- Issue 1: Rewrote `{{config.report_content}}` → `{{input.report_content}}`
- Issue 2: Added `to: "{{input.recipient_email}}"` (smart default for email parameter)
- Confidence: 100% (config), 90% (missing param)

### Example 2: Google Sheets Write

**Before:**
```json
{
  "id": "step5",
  "type": "action",
  "plugin": "google-sheets-plugin-v2",
  "action": "write_sheet",
  "params": {
    "range": "Sheet1!A1",
    "values": "{{step3.processed_data}}"
    // Missing: "spreadsheet_id" (required)
  }
}
```

**After Auto-Fix:**
```json
{
  "id": "step5",
  "type": "action",
  "plugin": "google-sheets-plugin-v2",
  "action": "write_sheet",
  "params": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "Sheet1!A1",
    "values": "{{step3.processed_data}}"
  }
}
```

**Fix Details:**
- Added `spreadsheet_id: "{{input.spreadsheet_id}}"` (smart default for ID parameter)
- Confidence: 80%

---

## Logging

All fixes are logged for debugging but never shown to users:

**Config Reference Fix:**
```json
{
  "level": "info",
  "module": "StructuralRepairEngine",
  "stepId": "step1",
  "configRefs": ["{{config.email}}", "{{config.subject}}"],
  "msg": "[StructuralRepair] Rewrote {{config.X}} to {{input.X}}"
}
```

**Missing Parameter Fix:**
```json
{
  "level": "info",
  "module": "StructuralRepairEngine",
  "stepId": "step1",
  "paramName": "to",
  "paramValue": "{{input.recipient_email}}",
  "msg": "[StructuralRepair] Added missing required parameter with smart default"
}
```

---

## Limitations

### Cannot Auto-Fix

1. **Missing parameters without smart defaults**: Custom parameters that can't be inferred
2. **Complex conditional logic**: When parameter value depends on complex business logic
3. **External system IDs**: When IDs must be looked up from external systems

In these cases, the issue is marked as `autoFixable: false` and logged, but execution is blocked.

### Future Improvements

1. **LLM-Based Inference**: Use Claude/GPT to infer parameter values from agent description
2. **Historical Learning**: Track successful fixes to improve future inference
3. **User Confirmation for Low Confidence**: For fixes with < 70% confidence, ask user to confirm
4. **V6 Pipeline Fix**: Address root cause in workflow generation to prevent issues

---

## Related Files

- `/lib/pilot/shadow/StructuralRepairEngine.ts` - Core repair logic
- `/lib/pilot/ExecutionContext.ts` - Variable resolution (defines valid roots)
- `/app/api/v2/calibrate/batch/route.ts` - Batch calibration integration
- `/lib/server/plugin-manager-v2.ts` - Plugin metadata access (parameter schemas)
- `/docs/MISSING_ACTION_AUTO_REPAIR.md` - Related auto-repair for missing actions

---

## Testing Results

After implementing the fix in WorkflowPilot.ts (moving auto-repair before workflow parsing), the system now successfully:

✅ **Detects and fixes** `{{config.X}}` references automatically
✅ **Detects and fixes** missing required parameters with smart defaults
✅ **Persists fixes** to the database automatically
✅ **Uses fixed workflow** for execution (not the original broken one)

**Confirmed:** The errors "Unknown variable reference root: config" and "Recipient address required" no longer appear in calibration.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-10 | Initial implementation | Added auto-repair for invalid config references and missing required parameters to StructuralRepairEngine |
| 2026-04-21 | Fixed execution order | Moved auto-repair in WorkflowPilot.ts to run BEFORE workflow parsing (Phase 0.5 instead of Phase 4.5) so fixed steps are used |
| 2026-04-21 | Fixed model reference | Updated IntentClassifier to use claude-3-5-haiku-20241022 (current stable model) - previous model claude-3-haiku-20240307 was deprecated and returned 404 errors |
| 2026-04-21 | Fixed missing exports | Added schemaExtractor and analyzeOutputSchema exports to SchemaAwareDataExtractor.ts |
| 2026-04-21 | Fixed cache method | Added clearExecution() method to ExecutionOutputCache.ts |
| 2026-04-21 | Fixed agent reload | Added agent reload from database after auto-repair in batch calibration route to ensure fixed pilot_steps are used |
| 2026-04-21 | Fixed const reassignment | Changed agent variable declaration from const to let in batch calibration route to allow reassignment after database reload |
| 2026-04-21 | Added field normalization | Added automatic normalization of step.operation → step.action and step.config → step.params for backward compatibility with legacy workflow format |
| 2026-04-21 | Fixed field normalization flow | Changed field normalization from in-place modification to structural issue creation, ensuring fixes are properly proposed, applied, and persisted to database via autoFixWorkflow() |
