# Complete Workflow Analysis: leads-filter

**Deep validation of EVERY aspect against execution layer requirements**

---

## Step 1: Google Sheets read_range

```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-sheets",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": {"kind": "config", "key": "google_sheet_id"},
    "range": "{{config.sheet_tab_name}}"
  },
  "output_variable": "all_leads"
}
```

### Issues Found:

#### 🔴 CRITICAL #1: spreadsheet_id is an OBJECT
- **Current:** `{"kind": "config", "key": "google_sheet_id"}`
- **Runtime expects:** String like `"{{config.google_sheet_id}}"`
- **What happens:** ExecutionContext.resolveAllVariables() returns object unchanged
- **Result:** Google Sheets API receives `{kind: "config", ...}` instead of spreadsheet ID
- **WILL FAIL:** ✅ YES - API error: "Expected string, got object"

#### 🟡 INCONSISTENCY #2: range format differs
- **spreadsheet_id:** Object format
- **range:** String format `"{{config.sheet_tab_name}}"`
- **Why inconsistent?** Bug in parameter mapping (some converted, some not)

### Plugin Schema Check:

```bash
google-sheets.read_range required params: ["spreadsheet_id", "range"]
```
✅ Both present (but wrong format)

### Expected Output:

```javascript
{
  range: "Leads tab!A1:Z1000",
  majorDimension: "ROWS",
  values: [
    ["Date", "Lead Name", "Company", ...],  // Header row
    ["2024-01-15", "John Doe", "Acme Corp", ...],  // Data row 1
    ...
  ]
}
```

**Output variable:** `all_leads`
- Type: Object with `values` array (2D array)
- Used by: step2 (rows_to_objects), step3 (filter)

---

## Step 2: Transform - rows_to_objects

```json
{
  "step_id": "step2",
  "type": "transform",
  "operation": "rows_to_objects",
  "input": "{{all_leads.values}}",
  "output_variable": "all_leads_objects"
}
```

### Issues Found:

#### 🟠 QUESTION #3: Is all_leads_objects used?
- **Declared:** Yes, output_variable set
- **Used by:** NO SUBSEQUENT STEPS reference this variable
- **Impact:** Step is executed but output is UNUSED
- **Optimization:** Could be removed (dead code)

### Data Flow Check:

**Input:** `{{all_leads.values}}`
- ✅ Correct field access (Google Sheets returns `{values: [[...]])}`)
- ✅ Variable exists (from step1)

**Transform operation:** rows_to_objects
- ✅ Supported by DataOperations
- Converts: `[["header1", "header2"], ["val1", "val2"]]`
- To: `[{header1: "val1", header2: "val2"}]`

**Output:** Array of objects
- BUT NOT USED by any subsequent step

---

## Step 3: Transform - filter

```json
{
  "step_id": "step3",
  "type": "transform",
  "operation": "filter",
  "input": "{{all_leads}}",
  "condition": {
    "field": "item.Stage",
    "operator": "contains",
    "value": "{{config.stage_filter_value}}"
  }
}
```

### Issues Found:

#### 🔴 CRITICAL #4: Input is RAW 2D array, not objects
- **Input:** `{{all_leads}}` = `{values: [[...]]}`
- **Filter accesses:** `item.Stage` (expects object with Stage property)
- **Problem:** `all_leads` is Google Sheets response (2D array), NOT array of objects
- **Should use:** `{{all_leads_objects}}` (from step2)
- **WILL FAIL:** ✅ YES - Cannot access `.Stage` on array

#### 🟠 QUESTION #5: What is "item" in "item.Stage"?
- **Runtime behavior:** In filter operations, `item` is the current array element
- **DataOperations.filter()** likely sets up context where `item` is each row
- **But:** If input is 2D array `[["Date", "Name", ...]]`, then `item = ["Date", "Name", ...]`
- **Cannot access:** `item.Stage` on an array!

### Expected Behavior:

**SHOULD BE:**
```json
{
  "input": "{{all_leads_objects}}",  // Array of objects, not 2D array
  "condition": {
    "field": "item.Stage",  // Now item is {Date: "...", Stage: "4"}
    "operator": "contains",
    "value": "{{config.stage_filter_value}}"
  }
}
```

### Config Reference Check:

✅ `{{config.stage_filter_value}}` - Correct format (string with {{}})

---

## Step 4: Transform - select

```json
{
  "step_id": "step4",
  "type": "transform",
  "operation": "select",
  "input": "{{high_qualified_leads}}"
}
```

### Issues Found:

#### 🟠 CASCADING #6: Depends on broken step3
- **Input:** `{{high_qualified_leads}}` from step3
- **But:** Step3 will fail (wrong input type)
- **Impact:** Step4 will never execute OR receive wrong data type

#### 🟡 MISSING #7: Which columns to select?
- **Operation:** "select"
- **Description:** "Select columns: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person, Source"
- **Problem:** NO field list in config!
- **Runtime question:** How does DataOperations.select() know which columns?
- **Likely:** Uses `custom_code` description (fragile)

### Expected Config:

**SHOULD HAVE:**
```json
{
  "config": {
    "fields": ["Date", "Lead Name", "Company", "Email", "Phone", "Stage", "Notes", "Sales Person", "Source"]
  }
}
```

---

## Step 5: Transform - reduce (count)

```json
{
  "step_id": "step5",
  "type": "transform",
  "operation": "reduce",
  "input": "{{high_qualified_leads}}",
  "config": {
    "reduce_operation": "count",
    "reducer": "count"
  },
  "output_variable": "lead_count"
}
```

### Issues Found:

#### 🟠 CASCADING #8: Depends on broken step3
- Same as step4

### Transform Check:

✅ Operation: "reduce" with "count" - Supported
✅ Output: `lead_count` (number)
✅ Used by: step6 condition

**Expected output:** `5` (number of filtered leads)

---

## Step 6: Conditional

```json
{
  "step_id": "step6",
  "type": "conditional",
  "condition": {
    "conditionType": "simple",
    "field": "lead_count",
    "operator": "greater_than",
    "value": 0
  },
  "steps": [...],
  "else_steps": [...]
}
```

### Issues Found:

#### ✅ CORRECT #9: Condition format valid
- ConditionalEvaluator supports "simple" type
- Operator "greater_than" is valid
- Field "lead_count" exists (from step5)
- Value type correct (number)

#### 🟠 CASCADING #10: Depends on broken step5
- If step5 fails, lead_count won't exist
- Condition evaluation will fail

### Branch Analysis:

**Then branch:** 3 steps (step7, step8, step9)
**Else branch:** 1 step (step10)

---

## Step 7: AI Processing (inside conditional)

```json
{
  "step_id": "step7",
  "type": "ai_processing",
  "input": "formatted_leads",
  "prompt": "Create an HTML email body...",
  "config": {
    "output_schema": {
      "properties": {
        "html_body": {"type": "string"}
      },
      "required": ["html_body"]
    }
  },
  "output_variable": "html_content"
}
```

### Issues Found:

#### 🔴 CRITICAL #11: Input is plain string, not {{}}
- **Current:** `"input": "formatted_leads"`
- **Expected:** `"input": "{{formatted_leads}}"` (maybe?)
- **Question:** Does StepExecutor.executeLLMDecision() expect {{}} format?
- **Need to verify:** Execution layer behavior

#### 🟠 SCOPE #12: Can step7 access formatted_leads from step4?
- **step7 is inside conditional (step6)**
- **formatted_leads created in step4 (outside conditional)**
- **Question:** Are outer-scope variables accessible in conditional branches?
- **Runtime:** ExecutionContext should have formatted_leads in scope
- **Likely:** ✅ OK (variables are global in ExecutionContext)

#### 🟡 SCHEMA #13: Output has html_body but...
- **AI outputs:** `{html_body: "<html>...</html>"}`
- **step8/9 reference:** `{{html_content.html_body}}`
- **Match:** ✅ Correct field name

### AI Execution:

**Input data:** Array of lead objects
**Prompt:** Generate HTML table
**Expected output:**
```json
{
  "html_body": "<h1>High Qualified Leads (Stage = 4)</h1><table>...</table>"
}
```

---

## Step 8 & 9: Send Emails (inside conditional)

```json
{
  "step_id": "step8",
  "type": "action",
  "plugin": "google-mail",
  "operation": "send_email",
  "config": {
    "recipients": {"to": ["meiribarak@gmail.com"]},
    "content": {
      "subject": "High Qualified Leads - Stage 4",
      "html_body": "{{html_content.html_body}}"
    }
  }
}
```

### Issues Found:

#### ✅ FIXED #14: Variable reference format correct
- **Previously broken:** Plain string "html_content.html_body"
- **Now correct:** `"{{html_content.html_body}}"`
- **Will resolve:** ✅ YES

#### ✅ CORRECT #15: Plugin and operation valid
- Plugin: google-mail exists
- Operation: send_email exists
- Required params: recipients, content
- ✅ All present

#### ✅ CORRECT #16: Literal subject is OK
- `"subject": "High Qualified Leads - Stage 4"` is a literal string
- ✅ Valid (not all fields need to be variables)

### Data Flow:

**step7 output:** `html_content = {html_body: "<html>..."}`
**step8 access:** `{{html_content.html_body}}` → resolved to HTML string
**Gmail receives:** `{recipients: {...}, content: {subject: "...", html_body: "<html>..."}}`

---

## Step 10: No Results Email (else branch)

```json
{
  "step_id": "step10",
  "type": "action",
  "plugin": "google-mail",
  "operation": "send_email",
  "config": {
    "recipients": {"to": ["{{config.user_email}}"]},
    "content": {
      "subject": "No High Qualified Leads Found",
      "html_body": "No leads with Stage = 4 were found..."
    }
  }
}
```

### Issues Found:

#### ✅ CORRECT #17: Config reference format
- `"{{config.user_email}}"` - Correct format

#### ✅ CORRECT #18: Literal content OK
- Both subject and body are literal strings
- ✅ Valid for static message

---

## Complete Issues Summary

### CRITICAL Issues (WILL FAIL):

1. **🔴 step1: spreadsheet_id is object not string**
   - Impact: Google Sheets API error
   - Fix: Convert `{kind: "config", key: "..."}` to `"{{config....}}"`

2. **🔴 step3: Filter input is 2D array, not objects**
   - Impact: Cannot access `item.Stage` on array
   - Fix: Change input to `{{all_leads_objects}}`

### Cascading Failures:

3. **🟠 step4, step5, step6, step7, step8, step9:** All depend on step3 output
   - If step3 fails, entire then-branch fails

### Optimization Issues:

4. **🟡 step2: Output unused**
   - all_leads_objects is created but never used
   - SHOULD be used by step3

5. **🟡 step4: No field list**
   - Select operation has no explicit fields config

### Uncertain/Need Verification:

6. **🟠 step7: Input format** - Is plain "formatted_leads" correct or needs `{{}}`?
7. **🟠 step3: "item.Stage" syntax** - Does runtime support this?

---

## Correct Data Flow (If Fixed)

```
step1: Google Sheets → all_leads = {values: [[...]]}
step2: Transform → all_leads_objects = [{Date: "...", Stage: "4", ...}]
step3: Filter (FIXED) → high_qualified_leads = [{...}, ...]  (only Stage=4)
step4: Select → formatted_leads = [{Date, Name, Company, ...}]  (subset of fields)
step5: Reduce → lead_count = 5  (number)
step6: Condition → if lead_count > 0:
  step7: AI → html_content = {html_body: "<html>...</html>"}
  step8: Email → Send to user1
  step9: Email → Send to user2
else:
  step10: Email → Send to manager
```

---

## Execution Prediction

### Current State (With Bugs):

```
step1: ❌ FAILS - spreadsheet_id object error
  ↓ (workflow stops)
```

### If step1 Fixed:

```
step1: ✅ Returns 2D array
step2: ✅ Converts to objects
step3: ❌ FAILS - uses all_leads instead of all_leads_objects
  ↓ (workflow stops)
```

### If Both Fixed:

```
step1: ✅ OK
step2: ✅ OK
step3: ✅ OK (if input changed to all_leads_objects)
step4: ✅ OK (if select fields specified or custom_code works)
step5: ✅ OK
step6: ✅ OK
  IF lead_count > 0:
    step7: ❓ UNKNOWN (input format question)
    step8: ✅ OK
    step9: ✅ OK
  ELSE:
    step10: ✅ OK
```

---

## Required Fixes

### Priority 1 (CRITICAL):

1. **Fix step1 config object → string conversion**
2. **Fix step3 input:** Change to `{{all_leads_objects}}`

### Priority 2 (RECOMMENDED):

3. **Fix step4 select:** Add explicit fields list
4. **Verify step7 input format:** Test if {{}} needed

### Priority 3 (OPTIMIZATION):

5. **Remove step2 if truly unused** OR ensure step3 uses it

---

## Real Executability: 0%

**Current state:** Will fail at step1
**With bug fixes:** ~80% likely to work (pending verification of step7 input format)

