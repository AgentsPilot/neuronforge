# Hardcode Repair System Documentation

## Overview

The Hardcode Repair System automatically detects hardcoded values in agent workflows and provides a user-friendly interface to convert them into parameterized inputs. This solves the critical problem where agents created with hardcoded values in `pilot_workflow` cannot be tested with different data.

## Problem Statement

When agents are created, they often contain hardcoded values in their `pilot_steps`:
- **Resource IDs**: Spreadsheet IDs, file IDs, database IDs
- **Business Logic**: Filter conditions, search queries, status values
- **Configuration**: Limits, thresholds, named ranges

These hardcoded values make it impossible to test agents with different data without manually editing the workflow JSON.

## Solution Architecture

### 1. Generic Detection Algorithm (`HardcodeDetector.ts`)

The detection system is **plugin-agnostic** and uses multiple strategies:

#### Pattern-Based Detection
- Resource IDs: `/^[a-zA-Z0-9_-]{15,}$/`
- Email addresses: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- URLs: `/^https?:\/\/.+/`
- Time ranges: `/\d+\s*(day|hour|minute|week|month|year)s?/i`
- Numeric thresholds: `/^\d+$/`

#### Context-Aware Analysis
Analyzes parent keys to understand semantic meaning:
- **Business Logic Keywords**: condition, filter, where, criteria, rule, value, match
- **Configuration Keywords**: max, limit, count, range, name

#### Statistical Analysis
- Detects values reused across multiple workflow steps
- Higher priority for frequently used values

#### Smart Categorization
Values are grouped by priority:
- **Critical**: Resource IDs (spreadsheets, files, databases)
- **Medium**: Business logic (filters, conditions, search queries)
- **Low**: Configuration (limits, thresholds, labels)

### 2. User Interface (`HardcodeRepairModal.tsx`)

A modal dialog that displays detected values in a user-friendly format:

#### Features
- **Grouped Display**: Values organized by category (Critical/Filters/Optional)
- **Auto-Selection**: Critical and high-priority items auto-selected
- **Input Fields**: Type-aware inputs (text, email, URL, number, select)
- **Live Preview**: Shows how values will be saved as `{{input.X}}`
- **Validation**: Ensures all selected values have new values provided

#### User Experience
1. Modal appears automatically after first calibration failure
2. User sees detected hardcoded values grouped by importance
3. User selects which values to parameterize (critical items pre-selected)
4. User provides new test values
5. Click "Save & Repair Agent" to apply changes

### 3. API Endpoint (`/api/agents/[id]/repair-hardcode`)

Handles the agent repair process:

#### Responsibilities
1. **Apply Parameterization**: Replaces hardcoded values with `{{input.X}}` templates
2. **Update Schema**: Adds new parameters to `agent.input_schema`
3. **Save Configuration**: Stores test values in `agent_configurations`
4. **Database Update**: Persists changes to `agents` table

#### Request Format
```typescript
{
  selections: [
    {
      path: "step2.params.spreadsheet_id",
      param_name: "spreadsheet_id",
      value: "NEW_TEST_ID",
      original_value: "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
    }
  ]
}
```

#### Response Format
```typescript
{
  success: true,
  repaired_steps_count: 3,
  new_parameters: ["spreadsheet_id", "filter_status", "email_to"]
}
```

### 4. Calibration Page Integration

The calibration page automatically triggers detection and repair:

#### Flow
1. **First Execution**: User runs calibration with hardcoded values
2. **Failure Detection**: Execution fails (polling detects `status: 'failed'`)
3. **Auto-Detection**: System automatically runs `HardcodeDetector`
4. **Modal Display**: If hardcoded values found, modal appears
5. **User Action**: User selects values and provides new test values
6. **Repair & Retry**: System repairs agent and automatically retries execution
7. **Success**: Execution succeeds with new parameterized values

#### State Management
- `hasTriedRepair`: Prevents showing modal multiple times in same session
- `detectionResult`: Stores detected values for modal display
- `showRepairModal`: Controls modal visibility
- `isRepairing`: Shows loading state during repair

## Example Workflow

### Before Repair
```json
{
  "id": "step2",
  "name": "Read spreadsheet",
  "params": {
    "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
    "range": "Sheet1!A1:Z"
  }
}
```

### After Repair
```json
{
  "id": "step2",
  "name": "Read spreadsheet",
  "params": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "Sheet1!A1:Z"
  }
}
```

### Updated Input Schema
```json
{
  "name": "spreadsheet_id",
  "type": "text",
  "label": "Spreadsheet ID",
  "description": "Parameterized from workflow (originally: 1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc)",
  "required": true,
  "default_value": "NEW_TEST_ID"
}
```

## Key Design Decisions

### 1. Generic Detection (No Hardcoded Rules)
- **Why**: Must support future plugins without code changes
- **How**: Pattern matching + context analysis + statistical analysis
- **Benefit**: Works for any plugin, any workflow structure

### 2. Smart Auto-Selection
- **Why**: Reduce user friction, guide users to critical fixes
- **How**: Auto-select critical/high priority items
- **Benefit**: Users can click "Save & Repair" for common cases

### 3. Automatic Retry After Repair
- **Why**: Seamless user experience
- **How**: After repair, automatically call `handleRun()`
- **Benefit**: User sees immediate results without manual retry

### 4. Session-Based Detection
- **Why**: Avoid showing modal repeatedly
- **How**: `hasTriedRepair` flag persists during session
- **Benefit**: User can dismiss modal and not be interrupted again

## Files Modified/Created

### Created Files
1. **`lib/pilot/shadow/HardcodeDetector.ts`** (340 lines)
   - Core detection algorithm
   - Pattern matching and categorization
   - Parameterization application

2. **`components/v2/insights/HardcodeRepairModal.tsx`** (247 lines)
   - React modal component
   - Grouped value display
   - Input handling and validation

3. **`app/api/agents/[id]/repair-hardcode/route.ts`** (222 lines)
   - API endpoint for agent repair
   - Schema updates
   - Configuration persistence

### Modified Files
1. **`app/v2/sandbox/[agentId]/page.tsx`**
   - Added hardcode detection state
   - Integrated detection trigger on failure
   - Added repair handlers
   - Added modal rendering

## Testing Instructions

### Manual Testing Flow

1. **Create Agent with Hardcoded Values**
   ```json
   // Ensure pilot_steps contains hardcoded values like:
   {
     "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
     "filter": { "status": "complaint" }
   }
   ```

2. **Navigate to Calibration Page**
   - Go to `/v2/sandbox/[agentId]`

3. **Run Calibration**
   - Click "Run Calibration"
   - Execution should fail (due to hardcoded values or other issues)

4. **Observe Repair Modal**
   - Modal should appear automatically
   - Values should be grouped by category
   - Critical items should be pre-selected

5. **Select and Provide Values**
   - Review detected values
   - Provide new test values
   - Click "Save & Repair Agent"

6. **Verify Auto-Retry**
   - Execution should automatically retry
   - Check that new values are used
   - Verify execution succeeds (or fails for different reason)

7. **Verify Database Updates**
   - Check `agents.pilot_steps` - should contain `{{input.X}}`
   - Check `agents.input_schema` - should contain new parameters
   - Check `agent_configurations.input_values` - should contain test values

### Expected Behavior

#### Detection Triggers
- ✅ Only on first failure (`hasTriedRepair` = false)
- ✅ Only if hardcoded values found
- ✅ Automatically without user intervention

#### Modal Behavior
- ✅ Shows grouped values (Critical/Filters/Optional)
- ✅ Auto-selects critical items
- ✅ Validates all selected values have new values
- ✅ Can be dismissed (won't show again in session)

#### Repair Process
- ✅ Replaces hardcoded values with `{{input.X}}`
- ✅ Updates input_schema with new parameters
- ✅ Saves test values to agent_configurations
- ✅ Automatically retries execution

## Future Enhancements

### Potential Improvements
1. **Machine Learning**: Train model to better detect business logic values
2. **Suggestions**: AI-powered suggestions for parameter names and types
3. **Bulk Repair**: Allow repairing multiple agents at once
4. **Repair History**: Track what was repaired and when
5. **Rollback**: Allow reverting repairs if needed
6. **Export/Import**: Share repair configurations across agents

### Plugin Integration
1. **Schema Annotations**: Plugins can mark fields as `x-configurable: true`
2. **Custom Validators**: Plugins can provide validation logic
3. **Type Inference**: Better type detection based on plugin schemas

## Technical Notes

### Variable Resolution
- Template variables like `{{input.spreadsheet_id}}` are resolved at runtime
- Handled by `ExecutionContext.resolveAllVariables()`
- Supports nested objects and arrays
- Works recursively through entire workflow

### Session Storage
- Calibration input values persist in browser session storage
- Key: `calibration_inputs_${agentId}`
- Survives page refresh
- Cleared when browser tab closes

### Priority Loading
Input values are loaded in this order:
1. **Session Storage** (highest priority - temporary test values)
2. **Agent Configurations** (middle priority - saved production values)
3. **Schema Defaults** (lowest priority - fallback defaults)

## Support and Troubleshooting

### Common Issues

**Modal doesn't appear after failure**
- Check browser console for errors
- Verify `hasTriedRepair` is false
- Ensure `pilot_steps` exists and is array

**Repair fails with error**
- Check API logs for detailed error
- Verify user has permission to update agent
- Check network tab for failed requests

**Execution doesn't retry after repair**
- Check that `handleRun()` is called after repair
- Verify input values are updated
- Check session storage for new values

### Debugging

Enable detailed logging:
```typescript
// In calibration page
console.log('Detection result:', detectionResult)
console.log('Has tried repair:', hasTriedRepair)
console.log('Input values:', inputValues)
```

Check API logs:
```bash
# Look for repair-hardcode logs
grep "repair-hardcode" logs/api.log
```

## Conclusion

The Hardcode Repair System provides a seamless, intelligent way to convert hardcoded workflows into parameterized, testable agents. The system is designed to be:

- **Generic**: Works for any plugin, any workflow
- **Smart**: Understands context and semantic meaning
- **User-Friendly**: Minimal friction, clear guidance
- **Automatic**: Detects and suggests repairs without user intervention

This system dramatically improves the agent calibration experience and makes testing with different data trivial.
