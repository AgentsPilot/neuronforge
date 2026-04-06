# Workflow End-to-End Review (Feb 19, 2026)

**Purpose:** Verify data flow correctness before production deployment
**Workflow:** Invoice/Expense extraction from Gmail attachments

---

## Data Flow Analysis

### Step 1: Fetch Unread Emails
```json
{
  "plugin": "google-mail",
  "action": "search_emails",
  "output_variable": "emails_result",
  "params": {
    "query": "is:unread has:attachment",
    "include_attachments": true
  }
}
```

**Output Schema (google-mail.search_emails):**
```json
{
  "emails": [
    {
      "id": "string",
      "threadId": "string",
      "subject": "string",
      "from": "string",
      "to": "string",
      "date": "string",
      "snippet": "string",
      "attachments": [
        {
          "filename": "string",
          "mimeType": "string",
          "attachment_id": "string",
          "size": "number"
        }
      ]
    }
  ],
  "total_count": "number"
}
```

**✅ Output:** `emails_result` contains object with `emails` array

---

### Step 2: Create Drive Folder
```json
{
  "plugin": "google-drive",
  "action": "create_folder",
  "output_variable": "drive_folder",
  "params": {
    "folder_name": "Email Attachments - Expenses"
  }
}
```

**Output Schema (google-drive.create_folder):**
```json
{
  "folder_id": "string",
  "folder_name": "string",
  "web_view_link": "string"
}
```

**✅ Output:** `drive_folder` with `folder_id`

---

### Step 3: Loop Over Emails
```json
{
  "type": "scatter_gather",
  "output_variable": "all_transactions",
  "scatter": {
    "input": "{{emails_result.emails}}",  // ← Accessing .emails array
    "itemVariable": "current_email"
  }
}
```

**✅ Correct:** Navigating to `emails_result.emails` array

---

### Step 4: Loop Over Attachments (Nested)
```json
{
  "type": "scatter_gather",
  "output_variable": "email_transactions",
  "scatter": {
    "input": "{{current_email.attachments}}",  // ← From outer loop
    "itemVariable": "current_attachment"
  }
}
```

**✅ Correct:** Accessing attachments from current_email

---

### Step 5: Check Attachment Type
```json
{
  "type": "conditional",
  "condition": {
    "conditionType": "complex_or",
    "conditions": [
      {
        "field": "current_attachment.mimeType",
        "operator": "equals",
        "value": "application/pdf"
      },
      {
        "field": "current_attachment.mimeType",
        "operator": "contains",
        "value": "image/"
      }
    ]
  }
}
```

**✅ Correct:** Filtering PDF and image attachments only

---

### Step 6: Fetch Attachment Content
```json
{
  "plugin": "google-mail",
  "action": "get_email_attachment",
  "output_variable": "attachment_content",
  "params": {
    "message_id": "{{current_email.id}}",
    "attachment_id": "{{current_attachment.attachment_id}}"
  }
}
```

**Output Schema (google-mail.get_email_attachment):**
```json
{
  "data": "string (base64)",
  "filename": "string",
  "mimeType": "string",
  "size": "number"
}
```

**✅ Correct:** Using `current_email.id` (outer loop) and `current_attachment.attachment_id` (current loop)

---

### Step 7: Upload to Drive
```json
{
  "plugin": "google-drive",
  "action": "upload_file",
  "output_variable": "uploaded_file",
  "params": {
    "file_content": "{{attachment_content.data}}",
    "file_name": "{{attachment_content.filename}}",
    "folder_id": "{{drive_folder.folder_id}}",
    "mime_type": "{{attachment_content.mimeType}}"
  }
}
```

**⚠️ POTENTIAL ISSUE:** Using `attachment_content.filename` but schema shows field is `filename` (should work)

**Output Schema (google-drive.upload_file):**
```json
{
  "file_id": "string",
  "file_name": "string",
  "web_view_link": "string",
  "mime_type": "string",
  "size": "number",
  "created_time": "string"
}
```

**✅ Output:** `uploaded_file` with `web_view_link`

---

### Step 8: AI Extract Transaction Data
```json
{
  "type": "ai_processing",
  "output_variable": "extracted_data",
  "input": "{{attachment_content.data}}",
  "config": {
    "ai_type": "extract",
    "output_schema": {
      "properties": {
        "date": {"type": "string"},
        "vendor": {"type": "string"},
        "amount": {"type": "number"},
        "currency": {"type": "string"},
        "invoice_receipt_number": {"type": "string"}
      }
    }
  }
}
```

**✅ Correct:** Extracting from attachment content
**✅ Output:** `extracted_data` with 5 fields (no metadata)

---

### Step 9: Check Amount Exists
```json
{
  "type": "conditional",
  "condition": {
    "field": "extracted_data.amount",
    "operator": "exists",
    "value": true
  }
}
```

**✅ Correct:** Checking if amount was extracted

---

### Step 10: Check Amount > $50
```json
{
  "type": "conditional",
  "condition": {
    "field": "extracted_data.amount",
    "operator": "greater_than",
    "value": 50
  }
}
```

**✅ Correct:** Threshold check

---

### Step 11: Append to Sheets
```json
{
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
    "range": "Expenses",
    "values": [[
      "{{extracted_data.date}}",
      "{{extracted_data.vendor}}",
      "{{extracted_data.amount}}",
      "{{extracted_data.currency}}",
      "{{extracted_data.invoice_receipt_number}}",
      "{{current_email.from}}",
      "{{current_email.subject}}",
      "{{uploaded_file.web_view_link}}"
    ]]
  }
}
```

**✅ Correct:** All fields exist in their respective scopes
**✅ Data Flow:** Combining AI extraction + email metadata + Drive link

---

### Step 3 Gather (Outer Loop)
```json
{
  "gather": {
    "operation": "collect",
    "outputKey": "all_transactions"
  }
}
```

**❌ CRITICAL ISSUE:** What variable is being collected?

**Problem:** The scatter-gather doesn't specify `from` field!
- It should collect a specific variable from each iteration
- But there's no explicit variable being created that represents a "transaction record"
- The inner loop has `email_transactions` but the outer loop just says "collect"

**Expected behavior:** Should collect `extracted_data` from each attachment iteration?

**BUT:** `extracted_data` is in the INNER loop (attachments), not directly in outer loop (emails)

---

## 🚨 CRITICAL DATA FLOW ISSUE FOUND

### The Problem: Nested Scatter-Gather Collection

**Current structure:**
```
Outer Loop (emails) → gather: all_transactions
  Inner Loop (attachments) → gather: email_transactions
    Steps create: extracted_data
```

**Question:** What does `all_transactions` contain?
- Option A: Collects `email_transactions` from each email (array of arrays)
- Option B: Should collect `extracted_data` but it's in inner loop

**What we WANT:**
- A flat array of all transaction records across all emails and attachments
- Each record should have: extraction data + email metadata + Drive link

**What we're GETTING:**
- Unclear! The gather doesn't specify what to collect

---

## Analysis: What Gets Collected?

**Inner loop gather:**
```json
"gather": {
  "operation": "collect",
  "outputKey": "email_transactions"
}
```

**What this collects:** All `extracted_data` objects from attachments in ONE email
**Result:** `email_transactions` = array of transaction objects for one email

**Outer loop gather:**
```json
"gather": {
  "operation": "collect",
  "outputKey": "all_transactions"
}
```

**What this should collect:** `email_transactions` from each email
**Result:** `all_transactions` = array of arrays (grouped by email)

**⚠️ PROBLEM:** Step 12 expects a flat array, but gets array of arrays!

---

## Step 12: Generate Summary Email

```json
{
  "type": "ai_processing",
  "input": "{{all_transactions}}",
  "prompt": "Generate summary... The input is an array of transaction records..."
}
```

**❌ ISSUE:** Prompt says "array of transaction records" but `all_transactions` is array of arrays!

**Expected structure:**
```json
[
  {date: "...", vendor: "...", amount: 100, ...},
  {date: "...", vendor: "...", amount: 50, ...},
  ...
]
```

**Actual structure:**
```json
[
  [{date: "...", vendor: "...", amount: 100}],  // Email 1's transactions
  [{date: "...", vendor: "...", amount: 50}],   // Email 2's transactions
  ...
]
```

---

## Additional Issues Found

### Issue #1: Missing Email Metadata in Transaction Records

**Step 11 (Sheets append) includes:**
- `{{current_email.from}}`
- `{{current_email.subject}}`
- `{{uploaded_file.web_view_link}}`

**✅ This works for Sheets** (executed inside loop)

**❌ But for Step 12 (Summary):**
- `all_transactions` contains only `extracted_data` objects
- It does NOT contain `current_email.from`, `current_email.subject`, or `uploaded_file.web_view_link`
- **The AI cannot include email metadata or Drive links in the summary!**

---

### Issue #2: Skipped Attachments Not Tracked

**When amount is missing:**
- The workflow skips to next attachment (no then block in Step 9)
- **Nothing is collected** for skipped attachments
- Step 12 prompt mentions "skipped attachments note" but has no data for them!

---

## Root Cause Analysis

**The workflow assumes scatter-gather will collect a "complete transaction record" but:**
1. Only `extracted_data` is collected (5 fields from AI)
2. Email metadata (`from`, `subject`) is NOT in `extracted_data`
3. Drive link (`web_view_link`) is NOT in `extracted_data`
4. Skipped attachments are NOT tracked anywhere

**This means the summary email will be incomplete!**

---

## Required Fixes

### Fix #1: Flatten Nested Arrays

**Option A: Use flatten transform AFTER loops**
```json
{
  "id": "flatten_transactions",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "flatten",
    "input": "{{all_transactions}}",  // Array of arrays
    "depth": 1
  },
  "outputs": [{"variable": "flat_transactions"}]
}
```

**Option B: Change outer loop to NOT collect, let inner loop collect to global array**
- This is complex and may not be supported

---

### Fix #2: Include Metadata in Transaction Records

**Need to create a "complete transaction record" that includes:**
- AI extraction: date, vendor, amount, currency, invoice_receipt_number
- Email metadata: from, subject
- Drive link: web_view_link

**BUT:** Can't use transform (object type), so need to...

**Option A: Create in delivery step and collect that**
- Not possible (delivery doesn't create output variable)

**Option B: Use AI to create the record** (wasteful)

**Option C: Accept that summary won't have full metadata** (not acceptable)

**Option D: Transform after collection** (requires array)

---

### Fix #3: Track Skipped Attachments

**Add an else block to Step 9:**
```json
{
  "condition": {
    "field": "extracted_data.amount",
    "operator": "exists",
    "value": true
  },
  "then": [...],
  "else": [
    {
      "type": "operation",
      "operation_type": "deliver",  // Or create a "skipped record"
      "config": {
        "note": "Amount missing for {{current_attachment.filename}}"
      }
    }
  ]
}
```

---

## Recommended Solution

**Since we can't use transform on objects, and the structure is complex, I recommend:**

### Approach: Enrich Transaction Data AFTER Collection

**Step 1:** After loops complete, we have `all_transactions` (array of arrays)

**Step 2:** Add flatten transform:
```json
{
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "flatten",
    "input": "{{all_transactions}}",
    "depth": 1
  },
  "outputs": [{"variable": "flat_transactions"}]
}
```

**Step 3:** Modify Step 12 input:
```json
{
  "input": "{{flat_transactions}}",
  ...
}
```

**BUT:** This still doesn't include email metadata or Drive links!

---

## Alternative Solution: Reconstruct in AI Prompt

**Update Step 12 prompt to work with nested structure:**
```json
{
  "prompt": "You are given an array of email groups. Each group contains transaction records extracted from that email's attachments. Each transaction has: date, vendor, amount, currency, invoice_receipt_number. FLATTEN this into a single summary table of all transactions across all emails..."
}
```

**BUT:** Still missing email metadata and Drive links!

---

## CRITICAL FINDING

**The current workflow will produce an incomplete summary email:**
- ✅ Will have transaction data (date, vendor, amount, etc.)
- ❌ Will NOT have source email info (sender, subject)
- ❌ Will NOT have Drive links
- ❌ Will NOT list skipped attachments

**This contradicts the user's requirements!**

---

## User's Requirements (from Enhanced Prompt)

**Required in summary email:**
1. All transactions table ✅ (has data)
2. Over $50 section ✅ (has amounts)
3. **Google Drive links** ❌ (NOT in collected data)
4. **Source email info** ❌ (NOT in collected data)
5. Totals summary ✅ (can calculate from amounts)
6. **Skipped attachments note** ❌ (NOT tracked)

**Conclusion: Workflow is missing critical data for summary email!**

---

## Status

❌ **WORKFLOW WILL FAIL USER REQUIREMENTS**

**Issues:**
1. `all_transactions` is array of arrays (needs flatten)
2. Transaction records missing email metadata (from, subject)
3. Transaction records missing Drive links (web_view_link)
4. Skipped attachments not tracked

**Next Steps:**
1. Fix data structure (flatten or restructure loops)
2. Include metadata in collected records
3. Track skipped attachments
4. Test end-to-end before production

---

## Recommendations

**I cannot approve this workflow for production.** It needs fixes to match user requirements.

**Would you like me to:**
1. Propose IR fixes to include metadata in transaction records?
2. Add a transform step to enrich collected data?
3. Restructure the loops to collect complete records?
