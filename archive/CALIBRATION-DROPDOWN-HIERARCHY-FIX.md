# Calibration Form Fixes - February 17, 2026

## Issues Fixed

### 1. Cascading Dropdowns Not Working (Critical Bug)
**Problem:** The `range` dropdown in calibration form was always empty (0 options) even after selecting a spreadsheet.

**Root Cause:** The `AgentInputFields` component was looking for dependency values using the base field name (`spreadsheet_id`) but the actual form values used prefixed names (`step2_spreadsheet_id`).

**Example:**
- Form has fields: `step2_spreadsheet_id` and `step2_range`
- Schema says: `range` depends on `spreadsheet_id`
- Old code looked for: `values["spreadsheet_id"]` ❌
- Actual value was in: `values["step2_spreadsheet_id"]` ✅

**Fix Applied:** [components/v2/AgentInputFields.tsx:64-76](components/v2/AgentInputFields.tsx#L64-L76)
```typescript
// Extract step prefix from current field name (e.g., "step2_" from "step2_range")
const stepPrefixMatch = field.name.match(/^(step\d+_)/)
const stepPrefix = stepPrefixMatch ? stepPrefixMatch[1] : ''

dynamicOptions.depends_on.forEach((depField: string) => {
  // Try both the base field name and the prefixed version
  const prefixedDepField = stepPrefix + depField
  const depValue = values[prefixedDepField] || values[depField]

  if (depValue) {
    dependentValues[depField] = depValue
  }
})
```

**How It Works Now:**
1. User selects a spreadsheet in `step2_spreadsheet_id` dropdown (e.g., "AgentsPilot Test Data")
2. The `step2_range` field extracts the step prefix: `"step2_"`
3. It looks for `values["step2_spreadsheet_id"]` (prefixed) OR `values["spreadsheet_id"]` (base)
4. Passes `{ spreadsheet_id: "selected_id" }` to the API
5. API fetches sheet names for that spreadsheet
6. Range dropdown populates with options ✅

---

### 2. Hierarchical Form Layout
**Problem:** All input fields were rendered in a flat list, making it hard to distinguish which fields belong to which workflow step.

**Fix Applied:** [components/v2/AgentInputFields.tsx:162-184](components/v2/AgentInputFields.tsx#L162-L184)

**New Layout:**
- Fields are grouped by step prefix (`step2_`, `step7_`, etc.)
- Each group is rendered in a bordered card with a header
- Fields without step prefixes are rendered at the top ungrouped

**Visual Example:**
```
┌─ Step 2 ────────────────────┐
│ Spreadsheet Id: [Dropdown ▼]│
│ Range: [Dropdown ▼]         │
└─────────────────────────────┘

┌─ Step 7 ────────────────────┐
│ Spreadsheet Id: [Dropdown ▼]│
│ Range: [Dropdown ▼]         │
└─────────────────────────────┘
```

---

### 3. Approve for Production Navigation Issue
**Problem:** When clicking "Approve for Production", the page navigated away to `/v2/agents/{agentId}` instead of staying on the calibration page to show the "Production Ready" badge.

**Fix Applied:** [app/v2/sandbox/[agentId]/page.tsx:733-750](app/v2/sandbox/[agentId]/page.tsx#L733-L750)

**Changes:**
1. **Update local state** so the UI immediately reflects the change:
   ```typescript
   if (updateData && updateData.length > 0) {
     setAgent(prev => prev ? { ...prev, production_ready: true } : null)
   }
   ```

2. **Remove navigation** - stay on calibration page:
   ```typescript
   // DON'T navigate - stay on calibration page to show the production ready badge
   console.log('[Calibration] Agent approved for production - staying on calibration page')
   ```

**Result:** The "Approve for Production" button is replaced with a "Production Ready" badge without leaving the page.

---

## Testing Checklist

### Cascading Dropdowns
- [x] Navigate to calibration page
- [x] Apply fixes to get input form
- [x] Verify step groups are shown (Step 2, Step 7, etc.)
- [ ] Select a spreadsheet in step2_spreadsheet_id dropdown
- [ ] Verify step2_range dropdown populates with sheet names
- [ ] Select a different spreadsheet
- [ ] Verify step2_range dropdown updates with new sheet names
- [ ] Repeat for step7 fields

### Hierarchical Layout
- [x] Verify fields are grouped by step number
- [x] Verify groups have borders and headers
- [x] Verify groups are sorted by step number (Step 2 before Step 7)

### Approve for Production
- [ ] Complete calibration with no issues
- [ ] Click "Approve for Production" button
- [ ] Verify page does NOT navigate away
- [ ] Verify button is replaced with "Production Ready" badge
- [ ] Verify database field `production_ready` is set to `true`
- [ ] Refresh page and verify badge persists

---

## Files Modified

1. **components/v2/AgentInputFields.tsx**
   - Added step prefix extraction logic for dependent values
   - Added hierarchical grouping by step ID
   - Extracted field rendering into `renderFieldInput()` function

2. **app/v2/sandbox/[agentId]/page.tsx**
   - Updated `handleApproveForProduction()` to update local state
   - Removed navigation after approval
   - Agent stays on calibration page after approval

---

## Technical Details

### Dependency Resolution Algorithm
```typescript
// For field: "step2_range" with dependency: "spreadsheet_id"
const stepPrefix = "step2_"  // Extracted from field name
const prefixedDep = "step2_spreadsheet_id"  // Prefix + dependency name
const depValue = values["step2_spreadsheet_id"] || values["spreadsheet_id"]
```

### Grouping Algorithm
```typescript
// Group fields by regex: /^(step\d+)_/
"step2_range" → group: "step2"
"step2_spreadsheet_id" → group: "step2"
"step7_range" → group: "step7"
"value_complaint" → ungrouped (no step prefix)
```

---

## Regression Risk: **LOW**

**Why:**
1. Backward compatible - works with both prefixed and unprefixed field names
2. Only affects calibration form rendering - no workflow execution changes
3. No database schema changes
4. Falls back gracefully if dependencies not found

---

**Status:** ✅ Complete
**Tested:** Manual testing required (see checklist above)
**Impact:** Critical bug fix + UX improvement
