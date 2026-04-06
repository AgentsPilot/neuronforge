# Catalog of Workflow Logic Issues

## Overview

Beyond duplicate data routing, workflows can have many other logic issues that don't cause errors but produce incorrect or inefficient results. This document catalogs potential logic issues we might want to detect.

---

## Category 1: Data Routing Issues

### ✅ **Issue 1.1: Duplicate Data Routing (IMPLEMENTED)**
**Pattern:** Same data sent to multiple destinations without filtering
```json
{
  "type": "parallel",
  "steps": [
    { "id": "step1", "params": { "values": "{{data}}", "destination": "Invoices" } },
    { "id": "step2", "params": { "values": "{{data}}", "destination": "Expenses" } }
  ]
}
```
**Problem:** Both sheets get all data mixed together
**Detection:** Already implemented in SmartLogicAnalyzer
**Fix:** Insert filter steps based on classification field

---

### **Issue 1.2: Partial Data Loss**
**Pattern:** Filters that might exclude too much data
```json
{
  "steps": [
    { "id": "step1", "output": { "data": [100 rows] } },
    {
      "id": "step2",
      "type": "transform",
      "operation": "filter",
      "config": { "field": "status", "value": "approved" }
    },
    { "id": "step3", "input": "{{step2.data}}", "output": { "data": [5 rows] } }
  ]
}
```
**Problem:** Filter reduced 100 rows to 5 rows - is 95% data loss intentional?
**Detection:**
- Compare input/output row counts
- Flag if reduction > 80%
**Evidence:**
```json
{
  "inputCount": 100,
  "outputCount": 5,
  "reductionPercent": 95,
  "filterField": "status",
  "filterValue": "approved",
  "droppedCount": 95
}
```
**Suggested Fix:**
- Ask user: "95% of data was filtered out. Is this intentional?"
- Options: "Yes, this is correct" / "Review filter criteria"

---

### **Issue 1.3: Missing Data Destination**
**Pattern:** Data is transformed but never sent anywhere
```json
{
  "steps": [
    { "id": "step1", "type": "action", "action": "search_emails" },
    { "id": "step2", "type": "transform", "input": "{{step1.data}}" },
    { "id": "step3", "type": "transform", "input": "{{step2.data}}" }
    // No step4 that sends data to sheets/database/etc
  ]
}
```
**Problem:** User processes data but doesn't save/send it anywhere
**Detection:**
- Find transform chains that don't end in an action step
- No delivery action (append, create, send, etc.)
**Evidence:**
```json
{
  "chainSteps": ["step1", "step2", "step3"],
  "dataSource": "step1",
  "finalStep": "step3",
  "hasDelivery": false,
  "processedRows": 45
}
```
**Suggested Fix:**
- Ask: "Your workflow processes 45 rows but doesn't send them anywhere. Where should the data go?"
- Options: "Add delivery step" / "This is intentional (testing)"

---

## Category 2: Inefficiency Issues

### **Issue 2.1: Sequential Operations That Could Be Parallel**
**Pattern:** Multiple independent operations running sequentially
```json
{
  "steps": [
    { "id": "step1", "action": "fetch_emails" },
    { "id": "step2", "action": "append_to_invoices", "input": "{{step1.data}}" },
    { "id": "step3", "action": "append_to_expenses", "input": "{{step1.data}}" },
    { "id": "step4", "action": "send_slack_notification", "input": "{{step1.data}}" }
  ]
}
```
**Problem:** step2, step3, step4 are independent but run one after another
**Detection:**
- Find consecutive steps that:
  - Use the same input source
  - Don't depend on each other's output
  - Could execute simultaneously
**Evidence:**
```json
{
  "sequentialSteps": ["step2", "step3", "step4"],
  "sharedInput": "step1.data",
  "executionTime": "15 seconds",
  "potentialSavings": "10 seconds (if parallelized)"
}
```
**Suggested Fix:**
- Ask: "Steps 2-4 could run in parallel to save ~10 seconds. Would you like to optimize?"
- Auto-fix: Wrap in parallel block

---

### **Issue 2.2: Redundant Data Fetching**
**Pattern:** Same data fetched multiple times
```json
{
  "steps": [
    { "id": "step1", "action": "search_emails", "params": { "query": "invoice" } },
    { "id": "step2", "action": "process_data", "input": "{{step1.data}}" },
    { "id": "step3", "action": "search_emails", "params": { "query": "invoice" } },
    { "id": "step4", "action": "send_to_sheets", "input": "{{step3.data}}" }
  ]
}
```
**Problem:** step1 and step3 fetch the exact same data (waste of API calls)
**Detection:**
- Find action steps with identical:
  - Plugin + action
  - Parameters
  - Executed more than once
**Evidence:**
```json
{
  "duplicateFetches": [
    { "stepId": "step1", "action": "search_emails", "params": {...} },
    { "stepId": "step3", "action": "search_emails", "params": {...} }
  ],
  "wastedAPICalls": 1,
  "suggestion": "Reuse step1.data in step4"
}
```
**Suggested Fix:**
- "step3 fetches the same data as step1. Would you like to reuse step1's data?"
- Auto-fix: Change step4 input to `{{step1.data}}`, remove step3

---

### **Issue 2.3: Unnecessary Loops**
**Pattern:** Loop over items when batch operation available
```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{emails}}",
    "steps": [
      { "id": "step1", "action": "append_row", "params": { "row": "{{item}}" } }
    ]
  }
}
```
**Problem:** Appending rows one-by-one instead of batch append
**Detection:**
- scatter_gather with single delivery action
- Plugin supports batch operation (append_rows vs append_row)
**Evidence:**
```json
{
  "loopType": "scatter_gather",
  "itemCount": 100,
  "singleItemAction": "append_row",
  "batchAlternative": "append_rows",
  "estimatedSpeedup": "20x faster"
}
```
**Suggested Fix:**
- "You're appending 100 rows one-by-one. Would you like to use batch append (20x faster)?"
- Auto-fix: Replace loop with single batch action

---

## Category 3: Data Quality Issues

### **Issue 3.1: Missing Data Validation**
**Pattern:** Data sent to destination without validation
```json
{
  "steps": [
    { "id": "step1", "action": "extract_invoice_data" },
    { "id": "step2", "action": "append_to_sheets", "input": "{{step1.data}}" }
    // No validation that required fields exist
  ]
}
```
**Problem:** If extraction fails, might send incomplete/invalid data
**Detection:**
- Extraction/AI step followed immediately by delivery
- No validation/filter step in between
- Execution trace shows some rows missing required fields
**Evidence:**
```json
{
  "extractionStep": "step1",
  "deliveryStep": "step2",
  "totalRows": 50,
  "rowsWithMissingFields": 8,
  "missingFields": ["amount", "date", "vendor"],
  "requiresReview": true
}
```
**Suggested Fix:**
- "8 out of 50 rows have missing required fields. Would you like to:"
  - Options: "Add validation step" / "Filter out incomplete rows" / "Send all anyway"

---

### **Issue 3.2: Data Type Mismatches**
**Pattern:** Sending wrong data format to destination
```json
{
  "steps": [
    { "id": "step1", "output_schema": { "amount": { "type": "number" } } },
    {
      "id": "step2",
      "action": "append_to_sheets",
      "params": {
        "columns": ["Date", "Amount"],
        "values": "{{step1.data}}"
      }
    }
  ]
}
```
**Problem:** step1 outputs numbers, but sheets column might expect currency format
**Detection:**
- Compare output schema types with destination expectations
- Execution shows data works but might need formatting
**Evidence:**
```json
{
  "sourceField": "amount",
  "sourceType": "number",
  "destinationColumn": "Amount",
  "suggestedFormat": "currency",
  "currentFormat": "1234.56",
  "suggestedFormat": "$1,234.56"
}
```
**Suggested Fix:**
- "The 'amount' field is sent as a plain number. Would you like to format it as currency?"
- Auto-fix: Add transform step to format numbers

---

## Category 4: Conditional Logic Issues

### **Issue 4.1: Always-True Conditions**
**Pattern:** Conditional that always evaluates the same way
```json
{
  "type": "conditional",
  "condition": "{{step1.data.length}} > 0",
  "then": [...],
  "else": [...]
}
```
**Problem:** If step1 always returns data, the else branch never executes
**Detection:**
- Analyze execution history
- Conditional always takes same branch (100% of time)
**Evidence:**
```json
{
  "conditionStep": "step5",
  "condition": "data.length > 0",
  "executionHistory": [
    { "date": "2026-02-01", "result": "then" },
    { "date": "2026-02-02", "result": "then" },
    { "date": "2026-02-03", "result": "then" }
  ],
  "thenBranchCount": 10,
  "elseBranchCount": 0
}
```
**Suggested Fix:**
- "Your condition has taken the same branch 10 times in a row. Is the condition correct?"
- Options: "Review condition" / "This is expected" / "Remove conditional"

---

### **Issue 4.2: Unreachable Steps**
**Pattern:** Steps that can never execute
```json
{
  "type": "conditional",
  "condition": "{{amount}} > 1000",
  "then": [
    { "id": "step1", "action": "send_to_large_invoices" }
  ],
  "else": [
    { "id": "step2", "action": "send_to_small_invoices" },
    { "id": "step3", "action": "archive" }  // ← Never reached if step2 succeeds
  ]
}
```
**Problem:** Steps after successful action in conditional might never run
**Detection:**
- Execution trace shows certain steps have 0% execution rate
- Steps exist but never appear in any execution
**Evidence:**
```json
{
  "unreachableSteps": ["step3"],
  "reason": "Previous step terminates branch",
  "executionRate": "0% (0 out of 10 runs)"
}
```

---

## Category 5: Error Handling Issues

### **Issue 5.1: No Error Handling for Critical Steps**
**Pattern:** Critical operations without fallback
```json
{
  "steps": [
    { "id": "step1", "action": "charge_customer_payment" },
    { "id": "step2", "action": "send_receipt" }
    // No error handling if payment fails
  ]
}
```
**Problem:** If payment fails, workflow stops and receipt isn't sent
**Detection:**
- Critical financial/database operations
- No conditional/error handling around them
**Evidence:**
```json
{
  "criticalStep": "step1",
  "action": "charge_customer_payment",
  "hasErrorHandling": false,
  "executionHistory": {
    "failures": 2,
    "total": 10
  }
}
```
**Suggested Fix:**
- "Payment step failed 2 out of 10 times. Would you like to add error handling?"
- Options: "Add retry logic" / "Add notification on failure" / "Skip if payment fails"

---

### **Issue 5.2: Silent Failures**
**Pattern:** Steps fail but workflow continues without notification
```json
{
  "steps": [
    { "id": "step1", "action": "send_email" },
    { "id": "step2", "action": "log_success" }
  ]
}
```
**Problem:** If email fails to send, step2 still logs "success"
**Detection:**
- Step failures in execution trace
- No notification/logging step after failures
**Evidence:**
```json
{
  "failedStep": "step1",
  "action": "send_email",
  "failureRate": "15%",
  "hasNotification": false,
  "suggestion": "Add notification on failure"
}
```

---

## Category 6: Resource Optimization

### **Issue 6.1: Excessive AI Processing**
**Pattern:** AI extraction on all items when only some need it
```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{emails}}",
    "steps": [
      { "id": "step1", "type": "ai_processing", "instruction": "Extract invoice data" }
    ]
  }
}
```
**Problem:** Running expensive AI on 100 emails when only 20 are actually invoices
**Detection:**
- AI/LLM step in loop
- Execution shows many items return "not applicable"
- Could filter before AI processing
**Evidence:**
```json
{
  "aiStep": "step1",
  "totalItems": 100,
  "applicableItems": 20,
  "wastedAICalls": 80,
  "costWasted": "$0.80",
  "suggestion": "Filter items before AI processing"
}
```
**Suggested Fix:**
- "You're running AI on 100 items but only 20 are relevant. Would you like to filter first?"
- Auto-fix: Add filter step before AI processing

---

## Implementation Priority

### **High Priority (Common & Impactful)**
1. ✅ Duplicate data routing (DONE)
2. Partial data loss (>80% reduction)
3. Missing data destination
4. Sequential operations that could be parallel
5. Missing data validation

### **Medium Priority (Good to Have)**
6. Redundant data fetching
7. Unnecessary loops (batch alternatives)
8. Always-true conditions
9. Excessive AI processing

### **Low Priority (Nice to Have)**
10. Data type mismatches
11. Unreachable steps
12. Silent failures

---

## Detection Framework

All logic issues should follow this pattern:

```typescript
interface LogicIssue {
  id: string;
  type: string;  // 'duplicate_routing', 'partial_data_loss', etc.
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;

  // Evidence to show user
  evidence: {
    // Specific to each issue type
    // Should include numbers, percentages, examples
  };

  // Options for user
  userOptions: Array<{
    id: string;
    label: string;
    description: string;
    autoFixAvailable: boolean;
  }>;

  // Estimated impact
  impact?: {
    timeSaved?: string;
    costSaved?: string;
    dataQualityImprovement?: string;
  };
}
```

---

## Next Steps

1. **Prioritize** which issues to implement next based on user feedback
2. **Extend SmartLogicAnalyzer** with new detection methods for each issue type
3. **Create UI components** for each new issue category
4. **Implement auto-fix logic** for issues that have clear solutions
5. **Add telemetry** to track which issues users encounter most often

---

## Conclusion

The logic fix system can be extended to catch many types of issues beyond duplicate data routing. The key is to:

1. **Analyze execution traces** (not just workflow structure)
2. **Compare actual results** with expected patterns
3. **Provide clear evidence** to users
4. **Offer actionable fixes** (not just warnings)
5. **Learn from user decisions** to improve detection

Each new issue type follows the same pattern:
- **Detect** during calibration
- **Present** with evidence
- **Suggest** fix options
- **Apply** user's choice
- **Verify** in next run
