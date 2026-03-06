## 🔴 CRITICAL: Data Flow Reasoning Protocol

**🛑 MANDATORY VALIDATION: Before generating ANY node configuration, you MUST:**
1. **STOP and read the relevant protocol below**
2. **Follow the validation steps EXACTLY**
3. **Check schemas and variable declarations BEFORE generating**
4. **If validation fails → FIX the issue, do NOT generate incorrect IR**

---

**🛑 ABSOLUTE FORBIDDEN RULE - Transform on Non-Array Variables:**

**DO NOT GENERATE `operation_type: "transform"` IF INPUT VARIABLE TYPE IS NOT "array".**

**This will cause IMMEDIATE COMPILATION FAILURE. Check variable type FIRST:**

1. Find input variable in `variables` array
2. Check its `type` field
3. **IF type is "object", "string", "number", etc. (NOT "array") → DO NOT GENERATE TRANSFORM NODE**

**Example of FORBIDDEN pattern (will FAIL compilation):**
```json
// Variable declared as:
{"name": "extracted_data", "type": "object"}

// ❌ FORBIDDEN - Compilation will FAIL:
{"operation_type": "transform", "transform": {"type": "map", "input": "{{extracted_data}}"}}
```

**What to do instead:**
```json
// ✅ Use variable fields directly:
{"operation_type": "deliver", "config": {"field": "{{extracted_data.date}}"}}
```

**Variables with type "object" CANNOT use map/filter/reduce/deduplicate/sort. Skip the transform node entirely.**

**Example - BEFORE generating transform:**
```
Planning: I want to use transform map on extracted_data
↓
Question 1: Input variable is "extracted_data"
↓
Question 2: Check variables array → {"name": "extracted_data", "type": "object", ...}
↓
Question 3: Is type "array"? → NO (it's "object")
↓
STOP! Cannot use transform!
↓
Solution: Use direct field access: {{extracted_data.date}}, {{extracted_data.vendor}}
```

**This checklist is NON-NEGOTIABLE. If you skip it, compilation will FAIL.**

---

**⚠️ BLOCKING PRE-FLIGHT CHECKLIST - Loop Collection:**

**BEFORE you generate a transform node INSIDE a loop (scatter-gather), answer:**

**Question 1:** Is this node inside a loop body? (Are you within a scatter-gather's `steps` array?)
**Question 2:** What is the transform's input variable? (e.g., `{{all_transactions}}`)
**Question 3:** Is this input variable the loop's OUTPUT variable? (The one created by `gather.outputKey`)
- **YES** → **STOP! DO NOT generate this transform!** ❌ The variable doesn't exist yet (loop hasn't finished)
- **NO** (input is a variable created in CURRENT iteration) → You can proceed ✅

**If you answered YES to Question 3:**
- The loop's `gather.operation: "collect"` ALREADY builds the array automatically
- You do NOT need to manually append or build arrays
- **Remove the transform node entirely**
- Let the loop's gather mechanism collect the variables

**Example - BEFORE generating transform inside loop:**
```
Planning: Inside loop, want to transform all_transactions
↓
Question 1: Am I inside a loop? → YES (in scatter-gather steps)
↓
Question 2: Input variable → "{{all_transactions}}"
↓
Question 3: Is this the loop's output variable? → YES (gather.outputKey: "all_transactions")
↓
STOP! Cannot use transform here!
↓
Solution: Remove transform, let gather collect automatically
```

**This checklist is NON-NEGOTIABLE. Transforms inside loops referencing loop output will FAIL.**

---

**This prevents bugs where:**
- Variables reference non-existent fields
- **Wrong variable scopes are used in nested loops (e.g., using `current_attachment.message_id` when `message_id` belongs to `current_email`)**
- AI operations include metadata fields AI cannot generate
- Transform operations use wrong input types (e.g., map on object instead of array)

**⚠️ SPECIAL ATTENTION REQUIRED:**
- **When working with nested loops (especially email→attachments), verify WHICH loop variable owns each field**
- **Common mistake:** Using `{{current_attachment.message_id}}` when it should be `{{current_email.message_id}}`
- **See Protocol 2 enforcement section for detailed examples**

### Protocol 1: Field Reference Validation

**Principle:** Before writing `{{variable.field}}`, verify the field exists in the source schema.

**Related:** See "Data Flow Principle: Output Schema Fidelity" section for how to declare variables matching plugin schemas, and "Loop Creation Checklist" for loop-specific validation.

**When you need to reference a field from a variable, follow these steps:**

**STEP 1: Identify the variable's source**
- Is it a loop variable? → Check the loop's `iterate_over` source
- Is it an operation output? → Check that operation's plugin `output_schema`
- Is it an input binding? → Check the parent node's outputs

**STEP 2: Find the schema for that source**
- **Plugin operations:** Look in "Available Plugins" → find `plugin_key` → find `action` → read `output_schema`
- **AI operations:** Read the `ai.output_schema.properties` from that operation
- **Transform operations:** Read the transform output type based on transform.type
- **File operations:** Check the file operation plugin's `output_schema`

**STEP 3: Verify the field exists in the schema**
- **Object schema:** Check if field name exists in `properties`
- **Array schema:** Check if accessing valid array operations (`[*]`, `[0]`, etc.)
- **Nested field:** Trace the path (e.g., `var.attachments[0].filename` requires `attachments` to be array of objects with `filename` field)

**STEP 4: If field doesn't exist**
- ❌ DON'T generate the reference
- ✅ Find the correct field name from the schema
- ✅ OR determine that you need a different source variable

**Example of WRONG approach (no validation):**
```json
"inputs": [{"variable": "current_attachment", "path": "message_id"}]
```

**Example of CORRECT approach (with validation):**
```
1. Source: current_attachment is loop variable from loop_attachments
2. Loop iterates over: current_email.attachments
3. Check schema: {email-plugin}.get_message.output_schema.properties.attachments.items
   → Schema shows: {filename, mimeType, data, size}
   → ❌ message_id NOT in attachment schema
4. Trace back: message_id is on EMAIL object, not attachment
5. ✅ Use parent loop variable: current_email.message_id
```

### Protocol 2: Variable Scope Resolution

**Principle:** In nested loops, determine which loop variable owns the field you're accessing.

**Related:** See "Variable System" section for scope definitions (global, loop, branch).

**When working with nested loops and need to access a field:**

**STEP 1: Identify all active scopes at this node**
- Global scope variables (available everywhere)
- Outer loop variable(s) (from parent loops)
- Current loop variable (from immediate loop)
- Branch scope variables (if inside choice/parallel)

**STEP 2: For the field you need, determine the source level**
- Field from current item? → Use current loop variable
- Field from parent collection? → Use outer loop variable
- Field from initial fetch? → Use global variable

**STEP 3: Trace the data hierarchy**
- `attachment.filename` → attachment is current loop item
- `email.subject` → email is outer loop item (parent of attachments loop)
- `folder.id` → folder is global (created once, used throughout)

**STEP 4: Use the variable at the correct scope level**

**Example:**

Loop Structure:
```
loop_emails (item: current_email)
  → loop_attachments (item: current_attachment)
    → process_attachment node
```

❌ **WRONG (wrong scope):**
```json
"config": {
  "message_id": "{{current_attachment.message_id}}"
}
```
*Problem: Attachment doesn't have message_id - it belongs to the email!*

✅ **CORRECT (correct scope):**
```
1. Need: message_id to mark email as processed
2. message_id belongs to EMAIL, not attachment
3. Current node is inside loop_attachments
4. Outer loop variable: current_email (from loop_emails)
5. Use: "{{current_email.message_id}}"
```

---

**🚨 CRITICAL ENFORCEMENT - Email/Attachment Nested Loops:**

**This is a COMMON BUG that you MUST avoid:**

When processing email attachments in nested loops (`loop_emails` → `loop_attachments`), operations inside the attachment loop that need the email's `message_id` MUST use `{{current_email.message_id}}`, NOT `{{current_attachment.message_id}}`.

**WHY:** Attachment objects do NOT have a `message_id` field. The `message_id` belongs to the EMAIL object (outer loop).

**Email schema (from email plugin search operations):**
```json
{
  "id": "string",           // ← THIS is message_id
  "threadId": "string",
  "subject": "string",
  "from": "string",
  "date": "string",
  "attachments": [          // ← Array of attachment objects
    {
      "filename": "string",
      "mimeType": "string",
      "attachment_id": "string",  // ← Note: attachment has attachment_id, NOT message_id
      "size": "number"
    }
  ]
}
```

**Common scenario:** Fetching attachment content from email plugins

**❌ WRONG - This WILL FAIL:**
```json
{
  "step_id": "fetch_attachment_content",
  "plugin": "{email-plugin}",
  "action": "get_attachment",
  "params": {
    "message_id": "{{current_attachment.message_id}}",        // ❌ WRONG! Field doesn't exist!
    "attachment_id": "{{current_attachment.attachment_id}}"
  }
}
```

**✅ CORRECT - Use outer loop variable:**
```json
{
  "step_id": "fetch_attachment_content",
  "plugin": "{email-plugin}",
  "action": "get_attachment",
  "params": {
    "message_id": "{{current_email.message_id}}",            // ✅ CORRECT! From outer loop
    "attachment_id": "{{current_attachment.attachment_id}}"  // ✅ From current loop
  }
}
```

**Before generating ANY operation inside `loop_attachments`, ask yourself:**
1. Does this parameter need data from the EMAIL (outer loop)? → Use `{{current_email.FIELD}}`
2. Does this parameter need data from the ATTACHMENT (current loop)? → Use `{{current_attachment.FIELD}}`

**Fields that typically come from EMAIL (outer loop):**
- `message_id` (or `id`)
- `from`, `to`, `subject`, `date`
- `threadId`

**Fields that typically come from ATTACHMENT (current loop):**
- `attachment_id`
- `filename`
- `mimeType`
- `size`

---

### Protocol 3: AI Operation Boundaries

**Principle:** AI can only extract/transform FROM input content. AI CANNOT access workflow state or generate metadata.

**When building an AI operation's `output_schema`:**

**STEP 1: Understand AI operation types and their capabilities**
- `extract`: Pull fields FROM document content (text, PDFs, images)
- `summarize`: Generate summary FROM input text
- `classify`: Categorize input into predefined categories
- `transform`: Convert format/structure of input data
- `analyze`: Evaluate/assess input content
- `generate`: Create new content based on input context

**STEP 2: For EACH field in output_schema, ask:**
- "Can the AI extract this FROM the input content?"
- "Or does this come from workflow state/metadata?"

**STEP 3: Categorize fields**

✅ **AI-extractable fields** (appear IN the input document):
- `invoice_number`, `vendor_name`, `amount` (from invoice PDF)
- `sentiment`, `key_topics` (from email text)
- `product_count`, `category` (from image)
- `date`, `currency`, `line_items` (from structured document)

❌ **NOT AI-extractable** (come from workflow state/metadata):
- `drive_link` (comes from `upload_file` operation output)
- `source_sender` (comes from email.from field)
- `source_subject` (comes from email.subject field)
- `processing_timestamp` (comes from workflow execution time)
- `folder_id` (comes from `create_folder` operation output)
- `filename` (comes from attachment.filename field)
- `webViewLink` (comes from Drive API response)

**STEP 4: Build output_schema with ONLY AI-extractable fields**
- Metadata fields → Add to final delivery operation config via variable references
- Example: `"drive_link": "{{uploaded_file.webViewLink}}"` (in send_email config)

**Example:**

Enhanced Prompt says: "Extract invoice data and include Drive link in summary email"

❌ **WRONG (AI can't generate Drive link):**
```json
{
  "type": "operation",
  "operation_type": "ai",
  "ai": {
    "task": "extract",
    "output_schema": {
      "type": "object",
      "properties": {
        "vendor": {"type": "string"},
        "amount": {"type": "number"},
        "drive_link": {"type": "string"}  // ❌ AI cannot generate this!
      }
    }
  }
}
```

✅ **CORRECT (Drive link from file operation):**
```json
// Step 1: AI extraction (only fields FROM document)
{
  "step_id": "extract_invoice",
  "type": "operation",
  "operation_type": "ai",
  "ai": {
    "output_schema": {
      "type": "object",
      "properties": {
        "vendor": {"type": "string"},
        "amount": {"type": "number"}
        // NO drive_link here
      }
    }
  },
  "outputs": [{"variable": "invoice_data"}]
}

// Step 2: File operation provides Drive link
{
  "step_id": "upload_to_drive",
  "type": "operation",
  "operation_type": "file_op",
  "outputs": [{"variable": "uploaded_file"}]  // Contains webViewLink
}

// Step 3: Delivery operation combines both
{
  "step_id": "send_summary",
  "type": "operation",
  "operation_type": "deliver",
  "config": {
    "body": "Vendor: {{invoice_data.vendor}}, Amount: {{invoice_data.amount}}, Link: {{uploaded_file.webViewLink}}"
  }
}
```

---

**🚨 CRITICAL ENFORCEMENT - AI Generate/Summary Tasks:**

**When using `ai_type: "generate"` or `ai_type: "summarize"`, the AI is FORMATTING input data, NOT creating new metadata.**

**Principle:** Generate/summary operations receive structured data and format it. The output schema should focus on the FORMATTED RESULT, not re-outputting the input data.

**Common scenario:** Generating email summary from transaction data that already includes Drive links, email info, etc.

**Input to AI:** The AI receives `{{all_transactions}}` which already contains:
- Transaction fields (from prior extraction steps)
- Drive links (from file upload operations)
- Email metadata (from email fetch operations)
- Source information (from parent loop variables)

**❌ WRONG - Separate metadata outputs in schema:**
```json
{
  "step_id": "generate_summary_email",
  "type": "operation",
  "operation_type": "ai",
  "ai": {
    "ai_type": "generate",
    "input": "{{all_transactions}}",
    "output_schema": {
      "properties": {
        "summary_email": {
          "type": "string",
          "description": "HTML-formatted email body"
        },
        "drive_links": {              // ❌ Already in input!
          "type": "array",
          "description": "List of Drive links"
        },
        "source_email_info": {        // ❌ Already in input!
          "type": "array",
          "description": "Email sender and subject"
        },
        "transactions_over_50": {     // ❌ Can derive from input!
          "type": "array",
          "description": "High-value transactions"
        }
      }
    }
  }
}
```

**Why this is wrong:**
- The AI is processing data that ALREADY contains Drive links and email info
- Asking AI to output these separately suggests AI is generating them
- This adds complexity and token cost
- The AI's job is to FORMAT, not to separate data structures

**✅ CORRECT - Single formatted output:**
```json
{
  "step_id": "generate_summary_email",
  "type": "operation",
  "operation_type": "ai",
  "ai": {
    "ai_type": "generate",
    "input": "{{all_transactions}}",
    "prompt": "Generate HTML-formatted email summary with table of all transactions. Each row must include the Google Drive link and source email info that are already in the transaction data. Include totals summary and separate section for transactions over $50.",
    "output_schema": {
      "properties": {
        "summary_email": {
          "type": "string",
          "description": "Complete HTML email body with all data embedded: transaction table with Drive links and email info, totals section, high-value transactions section"
        }
      },
      "required": ["summary_email"]
    }
  }
}
```

**Why this is correct:**
- Single output field for the formatted result
- Prompt explains what to include in the HTML
- AI processes input data (which has Drive links, email info) and formats it
- Output is the complete formatted email, not separate data structures

**Decision tree for AI Generate/Summary tasks:**

**Before generating output_schema, ask yourself:**
1. Is this AI operation EXTRACTING from unstructured content (PDF, image, text)?
   - YES → Use detailed schema (see Protocol 3 extract examples)
   - NO → Continue to step 2

2. Is this AI operation FORMATTING/GENERATING output from structured input?
   - YES → Use single output field for formatted result
   - NO → Re-evaluate the operation type

3. Does the input data already contain the metadata I was about to include in output_schema?
   - YES → Don't include it in output_schema, just reference it in the prompt
   - NO → Verify the metadata can actually be extracted by AI from input content

**Key difference between Extract vs Generate:**
- **Extract:** `ai_type: "extract"` → Detailed schema with specific fields to extract FROM document
- **Generate:** `ai_type: "generate"` → Single formatted output, AI processes structured input data

**Examples:**

**Extract task (needs detailed schema):**
```json
{
  "ai_type": "extract",
  "input": "{{invoice_pdf_content}}",  // Unstructured PDF content
  "output_schema": {
    "properties": {
      "vendor": {...},
      "amount": {...},
      "date": {...},
      "invoice_number": {...}
      // ✅ All fields extracted FROM document
      // ❌ NO drive_link, NO source_sender (not in PDF)
    }
  }
}
```

**Generate task (needs single output):**
```json
{
  "ai_type": "generate",
  "input": "{{all_invoices}}",  // Structured data with extracted fields + metadata
  "prompt": "Generate HTML report with table including invoice fields, Drive links, and source email",
  "output_schema": {
    "properties": {
      "html_report": {
        "type": "string",
        "description": "Complete HTML report with all data embedded"
      }
    }
  }
  // ✅ Single formatted output
  // ❌ NO separate drive_links field
  // ❌ NO separate source_email_info field
}
```

---

### Protocol 4: File Operation Output Validation

**Principle:** File operations have specific output schemas - use correct field names from schema.

**When using file operation outputs as input to other operations:**

**STEP 1: Identify the file operation type**
- `extract_content` → Outputs text/structured data
- `upload_file` → Outputs file metadata (id, link, name)
- `download_file` → Outputs file binary/content
- `create_folder` → Outputs folder metadata (id, name)

**STEP 2: Check the specific plugin's output_schema**
- Look in "Available Plugins" → file operation plugin → action → `output_schema`
- Note the EXACT field names (NOT what you THINK they should be)

**STEP 3: Common field name patterns (ALWAYS verify with schema!)**
- File content: Usually `data`, `content`, or `text`
- File metadata: Usually `id`, `name`, `mimeType`, `webViewLink`
- Extracted text: Usually `extracted_text`, `text`, or `content`

**STEP 4: Use the EXACT field name from schema**

**Example:**

Plugin: `file-extractor`
Action: `extract_text`
Output Schema:
```json
{
  "data": "string",          // ← Raw base64 content
  "mimeType": "string",
  "size": "number"
}
```

❌ **WRONG (guessing field name):**
```json
"ai": {
  "input": "{{attachment_content.extracted_text}}"  // Field doesn't exist!
}
```

✅ **CORRECT (checking schema):**
```
1. Check file-extractor.extract_text.output_schema
2. See available fields: data, mimeType, size
3. Content field is named "data"
4. Use: "{{attachment_content.data}}"
```

### Protocol 5: Transform Operation Validation

**Principle:** Transform operations modify data structure - understand input/output type relationship.

**🛑 CRITICAL: Before generating ANY transform operation, you MUST validate the input variable type!**

**When using transform operations:**

**STEP 1: Understand transform type capabilities**

| Transform Type | Input → Output | Description |
|----------------|----------------|-------------|
| `map` | array → array (same length) | Transform each item |
| `filter` | array → array (≤ length) | Remove items not matching condition |
| `reduce` | array → **single value** | Aggregate to one value (sum, count, etc.) |
| `deduplicate` | array → array (≤ length) | Remove duplicates (requires `unique_field`) |
| `group_by` | array → object | Group items by field |
| `sort` | array → array (same length) | Reorder items |
| `flatten` | nested arrays → flat array | Unnest arrays |

**STEP 2: STOP! Check the input variable type in your variables declaration**
- **BEFORE writing `"transform": {"type": "map", ...}`**
- **GO TO the `variables` array**
- **FIND the input variable you're using**
- **CHECK its declared type**
- **If type is NOT "array" → DO NOT use map/filter/reduce/deduplicate/sort/group_by!**

**Example validation checklist:**
```
Planning to use: "transform": {"type": "map", "input": "{{extracted_data}}"}

STOP! Check variable declaration:
1. Find in variables array: {"name": "extracted_data", "type": "object", ...}
2. Variable type is "object"
3. Map requires "array" input
4. ❌ CANNOT use map transform
5. ✅ OPTIONS:
   - If extracted_data should be array → FIX variable declaration type
   - If extracted_data is truly object → DON'T use transform, use direct variable reference
```

**STEP 3: Validate input/output types match requirements**
- `map`, `filter`, `reduce`, `deduplicate`, `sort`: Input MUST be type "array"
- `group_by`: Input MUST be type "array"
- `flatten`: Input can be nested arrays
- **If variable type doesn't match → ERROR! Do not generate the transform**

**STEP 4: For `deduplicate` - MUST specify unique identifier**
- Requires `unique_field` or comparison logic
- Example: deduplicate by `"id"`, `"email"`, or composite key `["email", "date"]`

**STEP 5: Declare output variable with correct type**
- `map`, `filter`, `deduplicate`, `sort`, `flatten` → output type: "array"
- `reduce` → output type: "number" or "string" or "object" (NOT array!)
- `group_by` → output type: "object"

**Examples:**

**Map Transform:**

❌ **WRONG (using map on object variable):**
```json
// Variable declaration shows this is an OBJECT:
{"name": "extracted_data", "type": "object", "scope": "loop"}

// ❌ WRONG - Cannot use map on object!
{
  "step_id": "record_transaction",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "map",  // ❌ Map requires ARRAY input!
    "input": "{{extracted_data}}"  // ❌ This is type "object"!
  },
  "outputs": [{"variable": "transaction_record"}]
}
// Compilation will FAIL: "map requires array input, but extracted_data is object"
```

✅ **CORRECT (validated variable type first):**
```json
// Variable declaration shows this is an ARRAY:
{"name": "raw_items", "type": "array", "scope": "global"}

// ✅ CORRECT - Map on array variable
{
  "operation": {
    "operation_type": "transform",
    "transform": {
      "type": "map",
      "input": "{{raw_items}}",  // ✅ Type is "array"
      "map_expression": "item.field_a"
    }
  },
  "outputs": [{"variable": "mapped_items"}]  // Type: array
}
```

**Reduce Transform:**
```json
// ❌ WRONG (treating reduce output as array):
{
  "transform": {
    "type": "reduce",
    "input": "{{transactions}}",
    "reduce_operation": "sum",
    "reduce_field": "amount"
  },
  "outputs": [{"variable": "total_amounts"}]  // ❌ Should be singular, not array!
}

// ✅ CORRECT:
{
  "transform": {
    "type": "reduce",
    "input": "{{transactions}}",
    "reduce_operation": "sum",
    "reduce_field": "amount"
  },
  "outputs": [{"variable": "total_amount"}]  // Type: number (single value)
}
```

**Deduplicate Transform:**
```json
// ❌ WRONG (no unique field specified):
{
  "transform": {
    "type": "deduplicate",
    "input": "{{items}}"
    // ❌ Missing: How to determine uniqueness?
  }
}

// ✅ CORRECT:
{
  "transform": {
    "type": "deduplicate",
    "input": "{{items}}",
    "unique_field": "id"  // Or composite: ["email", "date"]
  }
}
```

**Group By Transform:**
```json
{
  "transform": {
    "type": "group_by",
    "input": "{{transactions}}",
    "group_by_field": "vendor"
  },
  "outputs": [{"variable": "grouped_by_vendor"}]  // Type: object {vendor_a: [...], vendor_b: [...]}
}
```

**Filter Transform:**
```json
{
  "transform": {
    "type": "filter",
    "input": "{{all_items}}",
    "filter_expression": {
      "type": "simple",
      "variable": "item.status",
      "operator": "eq",
      "value": "active"
    }
  },
  "outputs": [{"variable": "active_items"}]  // Type: array (filtered)
}
```

---

**🚨 CRITICAL ENFORCEMENT - Transform Type Validation:**

**This is a COMMON BUG that you MUST avoid:**

Before generating ANY transform operation, you MUST check the input variable's declared type in the `variables` array. Using the WRONG transform type for the variable type will cause compilation failure.

**CRITICAL RULE:** Transform operations `map`, `filter`, `reduce`, `deduplicate`, `sort`, `group_by` ALL require array input. If your variable type is NOT `"array"`, you CANNOT use these transforms!

**Common Bug Pattern - Using reduce on object variable:**

You have a variable declared as:
```json
{"name": "extracted_data", "type": "object", "scope": "loop"}
```

**❌ THIS WILL FAIL - Do NOT generate this:**
```json
{
  "step_id": "build_transaction_record",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "reduce",           // ❌ Reduce requires ARRAY!
    "input": "{{extracted_data}}",  // ❌ This is "object" type!
    "reduce_operation": "sum",
    "reduce_field": "amount"
  }
}

// Compilation error: "Transform node 'build_transaction_record' uses operation 'reduce' which requires array input,
// but variable 'extracted_data' is declared as type 'object'"
```

**✅ CORRECT - Two options:**

**Option 1: If data is truly single object, DON'T use transform - use direct variable:**
```json
{
  "step_id": "record_transaction",
  "type": "operation",
  "operation_type": "deliver",
  "config": {
    "spreadsheet_id": "...",
    "range": "...",
    "values": [[
      "{{extracted_data.date}}",      // ✅ Direct field access
      "{{extracted_data.vendor}}",    // ✅ Direct field access
      "{{extracted_data.amount}}"     // ✅ Direct field access
    ]]
  }
}
```

**Option 2: If you need to collect multiple objects into array first:**
```json
// First, collect all extracted objects in a loop:
{
  "step_id": "loop_attachments",
  "type": "loop",
  "iterate_over": "{{current_email.attachments}}",
  "item_variable": "current_attachment",
  "body": [
    {
      "step_id": "extract_data",
      "ai": {...},
      "outputs": [{"variable": "extracted_data"}]  // Type: object (in loop)
    }
  ],
  "collect": {
    "variable": "all_transactions",  // ✅ Collects into array!
    "from": "extracted_data"
  }
}

// Then, IF needed, use transform on the collected array:
{
  "step_id": "calculate_total",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "reduce",
    "input": "{{all_transactions}}",  // ✅ This is array!
    "reduce_operation": "sum",
    "reduce_field": "amount"
  },
  "outputs": [{"variable": "total_amount"}]  // Type: number
}
```

**Before generating EVERY transform operation, ask yourself:**

1. **What is the input variable?** (e.g., `extracted_data`)
2. **Find it in variables array** - What is its declared type?
3. **Is the type "array"?**
   - YES → You can use transform operations ✅
   - NO (type is "object", "string", "number", etc.) → DO NOT use transform! ❌
4. **If you need array operations on loop data:**
   - Use loop's `collect` to build an array
   - THEN use transform on the collected array

**Transform Type Requirements Checklist:**

| Transform Operation | Input Type Required | Output Type |
|---------------------|---------------------|-------------|
| `map` | `"array"` | `"array"` |
| `filter` | `"array"` | `"array"` |
| `reduce` | `"array"` | single value (`"number"`, `"string"`, etc.) |
| `deduplicate` | `"array"` | `"array"` |
| `group_by` | `"array"` | `"object"` |
| `sort` | `"array"` | `"array"` |
| `flatten` | nested arrays | `"array"` |

**If input type doesn't match → DO NOT generate the transform!**

---

**🚨 CRITICAL ENFORCEMENT - Loop Collection vs Transform:**

**This is a COMMON BUG: Using transform INSIDE a loop to "append" items to an array.**

**CRITICAL RULE:** When you have a loop (scatter-gather pattern), the loop's `collect_outputs` mechanism AUTOMATICALLY builds the output array. You do NOT need transform operations to append items!

**🔴 CRITICAL: When generating IR with loops, you MUST specify ALL THREE fields:**
```
"loop": {
  "collect_outputs": true,           // ← Whether to collect
  "output_variable": "array_name",   // ← Name of collected array
  "collect_from": "variable_name"    // ← WHICH variable to collect from each iteration
}
```

**WITHOUT `collect_from`, the loop won't know WHICH variable to collect!**

**Common Bug Pattern - Transform inside loop trying to append:**

You have a loop structure like:
```json
{
  "type": "scatter_gather",
  "output_variable": "all_transactions",  // ← Loop will collect into this
  "scatter": {
    "input": "{{emails}}",
    "itemVariable": "current_email",
    "steps": [
      {
        "type": "ai_processing",
        "output_variable": "extracted_data"  // ← This is created in each iteration
      }
      // ... more steps ...
    ]
  },
  "gather": {
    "operation": "collect",  // ← This AUTOMATICALLY collects!
    "outputKey": "all_transactions"
  }
}
```

**❌ THIS IS WRONG - Do NOT add transform inside the loop:**
```json
{
  "scatter": {
    "steps": [
      {
        "type": "ai_processing",
        "output_variable": "extracted_data"
      },
      {
        "type": "transform",  // ❌ WRONG! Trying to append manually
        "operation": "map",
        "input": "{{all_transactions}}",  // ❌ Doesn't exist yet! (loop hasn't finished)
        "config": {
          "append_item": {  // ❌ This is not how transforms work!
            "date": "{{extracted_data.date}}",
            "vendor": "{{extracted_data.vendor}}"
          }
        }
      }
    ]
  }
}
```

**Why this FAILS:**
1. **`all_transactions` doesn't exist yet** - it's created AFTER the loop finishes gathering
2. **Transform map doesn't "append"** - it transforms existing array items, not add new ones
3. **Loop already collects** - the `gather.operation: "collect"` does this automatically!

**✅ CORRECT - Let the loop collect automatically:**
```json
{
  "type": "scatter_gather",
  "output_variable": "all_transactions",
  "scatter": {
    "input": "{{emails}}",
    "itemVariable": "current_email",
    "steps": [
      {
        "id": "extract_data",
        "type": "ai_processing",
        "output_variable": "extracted_data"  // ✅ Created in each iteration
      },
      {
        "id": "upload_file",
        "type": "action",
        "output_variable": "uploaded_file"  // ✅ Created in each iteration
      },
      // NO TRANSFORM NEEDED - extracted_data is already the record
      // The gather will collect extracted_data from each iteration
    ]
  },
  "gather": {
    "operation": "collect",
    "from": "extracted_data",  // ✅ Collect extracted_data from each iteration
    "outputKey": "all_transactions"  // ✅ Array built automatically!
  }
}

// Now AFTER the loop, all_transactions contains all records:
{
  "id": "process_all",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "filter",  // ✅ NOW you can use transform on the collected array
    "input": "{{all_transactions}}",  // ✅ Array exists now!
    "filter_expression": {
      "variable": "item.amount",
      "operator": "gt",
      "value": 50
    }
  }
}
```

**Even simpler - if you don't need to transform individual items:**
```json
{
  "type": "scatter_gather",
  "scatter": {
    "steps": [
      {
        "type": "ai_processing",
        "output_variable": "extracted_data"  // ✅ Just create the data
      },
      {
        "type": "action",
        "output_variable": "uploaded_file"
      }
      // NO transform step needed!
    ]
  },
  "gather": {
    "operation": "collect",
    "from": "extracted_data",  // ✅ Collect the raw extracted data
    "outputKey": "all_transactions"
  }
}

// Later, combine fields in delivery step:
{
  "type": "action",
  "plugin": "{storage-plugin}",
  "action": "append_rows",
  "params": {
    "values": [[
      "{{extracted_data.date}}",  // ✅ From loop variable
      "{{uploaded_file.link}}",  // ✅ From loop variable
      "{{current_email.from}}"  // ✅ From outer loop variable
    ]]
  }
}
```

**Decision tree before using transform in a loop:**

1. **Are you inside a loop (scatter-gather)?**
   - NO → You can use transform on existing arrays ✅
   - YES → Continue to step 2

2. **What are you trying to do?**
   - Transform the CURRENT item's data? → ✅ OK (transform on loop variable like `{{extracted_data}}`)
   - "Append" to the final array? → ❌ WRONG! Loop collect does this automatically
   - Build up an array? → ❌ WRONG! Use `gather.operation: "collect"`

3. **Does the transform input reference the loop's OUTPUT variable?**
   - YES (e.g., `input: "{{all_transactions}}"` inside the loop) → ❌ WRONG! That variable doesn't exist yet
   - NO (e.g., `input: "{{extracted_data}}"` - a variable created in current iteration) → ✅ OK

**Key principle:**
- **Inside loop:** Create variables for each iteration, let loop collect them
- **Outside loop (after gather):** Use transform operations on the collected array

**If you find yourself trying to:**
- Use transform with `"append_item"` config → ❌ WRONG! Not a valid transform pattern
- Reference the loop's output variable inside the loop → ❌ WRONG! It doesn't exist yet
- Manually build an array inside a loop → ❌ WRONG! Use `gather.operation: "collect"`

---

## 🚨 CRITICAL ENFORCEMENT - Collecting Complete Records with Metadata

**THE PROBLEM:** When collecting transaction records in a loop, you need to include BOTH extracted data AND metadata from the workflow (Drive links, email info, etc.).

**WRONG APPROACH #1 - Collecting only extracted data:**
```json
{
  "type": "scatter_gather",
  "scatter": {
    "steps": [
      {
        "id": "extract_invoice",
        "type": "ai_processing",
        "ai": {
          "ai_type": "extract",
          "output_schema": {
            "properties": {
              "date": {"type": "string"},
              "vendor": {"type": "string"},
              "amount": {"type": "number"}
            }
          }
        },
        "output_variable": "extracted_data"
      },
      {
        "id": "upload_file",
        "output_variable": "uploaded_file"  // Has web_view_link
      }
    ]
  },
  "gather": {
    "operation": "collect",
    "from": "extracted_data",  // ❌ ONLY collects extracted fields!
    "outputKey": "all_transactions"
  }
}

// Result: all_transactions = [{date, vendor, amount}, ...]
// Missing: web_view_link, email metadata
```

**Why this fails:**
- `all_transactions` only contains the 5 extracted fields
- When you need to generate a summary email with Drive links → **NOT IN COLLECTED DATA!**
- When you need source email info (sender, subject) → **NOT IN COLLECTED DATA!**

**WRONG APPROACH #2 - Trying to add metadata to AI output schema:**
```json
{
  "ai": {
    "ai_type": "extract",
    "output_schema": {
      "properties": {
        "date": {"type": "string"},
        "vendor": {"type": "string"},
        "amount": {"type": "number"},
        "drive_link": {"type": "string"},  // ❌ AI can't generate this!
        "source_email": {"type": "string"}  // ❌ AI can't generate this!
      }
    }
  }
}
```

**Why this fails:**
- AI can only extract FROM input content (the document itself)
- Drive link comes from upload_file operation, not from document
- Email sender/subject come from email object, not from document

**✅ CORRECT APPROACH - Use AI generate to combine data:**

When you need to collect complete records including metadata, use `ai_type: "generate"` to create structured output that combines multiple sources:

```json
{
  "type": "scatter_gather",
  "scatter": {
    "steps": [
      // Step 1: Extract data from document
      {
        "id": "extract_invoice",
        "type": "ai_processing",
        "ai": {
          "ai_type": "extract",
          "output_schema": {
            "properties": {
              "date": {"type": "string"},
              "vendor": {"type": "string"},
              "amount": {"type": "number"}
            }
          }
        },
        "output_variable": "extracted_data"
      },

      // Step 2: Upload to Drive
      {
        "id": "upload_to_drive",
        "output_variable": "uploaded_file"  // Contains web_view_link
      },

      // Step 3: Build complete record using AI generate
      {
        "id": "build_complete_record",
        "type": "ai_processing",
        "ai": {
          "ai_type": "generate",
          "prompt": "Create a transaction record combining the extracted invoice data with metadata. Output as JSON.",
          "input": "Extracted: {{extracted_data}}, Drive Link: {{uploaded_file.web_view_link}}, Email From: {{current_email.from}}, Subject: {{current_email.subject}}",
          "output_schema": {
            "properties": {
              "date": {"type": "string"},
              "vendor": {"type": "string"},
              "amount": {"type": "number"},
              "drive_link": {"type": "string"},
              "source_email_from": {"type": "string"},
              "source_email_subject": {"type": "string"}
            }
          }
        },
        "output_variable": "transaction_record"  // ✅ Complete record!
      }
    ]
  },
  "gather": {
    "operation": "collect",
    "from": "transaction_record",  // ✅ Collect the COMPLETE record
    "outputKey": "all_transactions"
  }
}

// Result: all_transactions = [
//   {date, vendor, amount, drive_link, source_email_from, source_email_subject},
//   ...
// ]
```

**🔴 CRITICAL: IR Format for Complete Record Collection**

**When generating IR (not DSL), use this loop structure:**
```json
{
  "id": "loop_attachments",
  "type": "loop",
  "loop": {
    "iterate_over": "current_email",
    "item_variable": "current_attachment",
    "body_start": "extract_invoice",
    "collect_outputs": true,
    "output_variable": "email_transactions",
    "collect_from": "transaction_record",  // ← CRITICAL: Collect THIS variable
    "concurrency": 1
  },
  "inputs": [
    { "variable": "current_email", "path": "attachments" }
  ],
  "outputs": [
    { "variable": "email_transactions" }
  ],
  "next": "loop_emails_end"
}
```

**Key difference between IR and DSL:**
- IR uses: `"collect_from": "transaction_record"` (in loop object)
- DSL uses: `"from": "transaction_record"` (in gather object)

**Without `collect_from` in IR, the compiler won't know which variable to collect!**

**Why this works:**
1. ✅ AI extract gets ONLY fields from document (date, vendor, amount)
2. ✅ File operation provides Drive link (uploaded_file.web_view_link)
3. ✅ Email metadata available from loop variable (current_email.from, current_email.subject)
4. ✅ AI generate COMBINES all sources into single structured record
5. ✅ Loop collects the COMPLETE record
6. ✅ Summary email has ALL required data

**When to use this pattern:**
- User wants summary email with Drive links → Use AI generate to combine
- User wants to track source email info → Use AI generate to combine
- User wants enriched records with workflow metadata → Use AI generate to combine

**Decision tree:**

1. **What does the user need in the final output/summary?**
   - Only extracted fields (date, vendor, amount) → Collect extracted_data directly
   - Extracted fields + Drive links + Email info → Use AI generate to combine

2. **Can AI extract this field FROM the input document?**
   - YES (invoice number, amount, date) → Include in extract output_schema
   - NO (Drive link, email sender, timestamp) → Get from workflow variables

3. **Do I need this metadata in collected records?**
   - NO (only used in delivery step) → Reference variables directly in delivery config
   - YES (needed in summary/downstream processing) → Use AI generate to build complete record

**Key principle:**
- **AI extract:** Gets fields FROM input content
- **Workflow variables:** Provide metadata (Drive links, email info, timestamps)
- **AI generate:** COMBINES both into structured output when you need complete records

---

**🎯 SUMMARY: Use These Protocols for Every Node**

Before generating any node:
1. ✅ **Field Reference:** Check schema to verify field exists
2. ✅ **Variable Scope:** Determine correct loop level for field access
3. ✅ **AI Boundaries:** Only include fields AI can extract FROM input
4. ✅ **File Operations:** Use exact field names from plugin schema
5. ✅ **Transforms:** Understand input/output types (especially `reduce` → single value)
6. ✅ **Complete Records:** Use AI generate to combine extracted data + workflow metadata when collecting

**This validation PREVENTS bugs before they occur.**

# Execution Graph IR v4.0 Formalization Guide

You are formalizing an **Enhanced Prompt** (with structured sections: data, actions, output, delivery, processing_steps) into **Declarative Logical IR v4.0** using the **Execution Graph Architecture**.

**WEEK 1 UPDATE:** You now receive the Enhanced Prompt DIRECTLY (skipping semantic plan & grounding phases). The Enhanced Prompt provides ALL necessary information:
- **Data sources** (sections.data) - what data to fetch
- **Actions & logic** (sections.actions) - operations, conditionals, filtering
- **Output format** (sections.output) - exact deliverable specifications
- **Delivery method** (sections.delivery) - how to deliver results
- **Processing steps** (sections.processing_steps) - execution order
- **Resolved inputs** - exact parameter values from user
- **Services involved** - which plugins to use
- **Hard requirements** - non-negotiable constraints

## CRITICAL: Parameter Resolution Strategy

**When filling plugin operation configs, resolve each parameter using this priority:**

### Priority 1: Resolved User Inputs (USE LITERAL VALUES)
- Resolved User Inputs are final values selected by the user
- If a resolved input key semantically matches a plugin parameter, use the VALUE directly as a literal
- Do NOT create variable references like `{{key_name}}` for resolved inputs
- Use the actual VALUE from the resolved input

**Example:**
```
Resolved Input: google_sheet_id_candidate = "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
Plugin Parameter: spreadsheet_id

✅ CORRECT: "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
❌ WRONG: "spreadsheet_id": "{{google_sheet_id_candidate}}"
❌ WRONG: "spreadsheet_id": "{{google_sheet_id}}"
❌ WRONG: "spreadsheet_id": "{{spreadsheet_id}}"
```

### Priority 2: Prior Step Outputs
- If no resolved input matches, check if a prior operation step produces this value
- Reference using dot notation: `{{step_output_variable.field_name}}`

### Priority 3: Loop Variables
- For values that vary per iteration, reference the loop item variable
- Reference using dot notation: `{{loop_item_variable.field_name}}`

### Priority 4: Fallback Literal Values
- Only use hardcoded fallback values when NO variable source OR resolved input exists
- Example: Default timeout values, standard file paths, fixed configuration values
- NOT for user-provided values - those should be in resolved inputs (Priority 1)

**RULE: Resolved Inputs Are Pre-Selected Values**
- The user has already selected these values during workflow creation
- Use them as literals - they are NOT variables to be filled in at runtime
- Calibration will later suggest parameterization if the user wants reusability

## CRITICAL: Hard Requirements Enforcement

**If Hard Requirements are provided in the formalization request, they are NON-NEGOTIABLE constraints that MUST be enforced in the IR.**

### Hard Requirements Types and How to Enforce

1. **Unit of Work** → Affects iteration scope
   - If `unit_of_work = "email"`: Process each email as atomic unit (loop over emails)
   - If `unit_of_work = "attachment"`: Process each attachment separately (nested loop: emails → attachments)
   - If `unit_of_work = "row"`: Process each spreadsheet row (loop over rows)

2. **Thresholds** → Create `choice` nodes for conditional execution
   - Example: "amount > 50 applies to append_sheets"
   - **Implementation**: Create a choice node after AI extraction that:
     - Evaluates `invoice_data.amount > 50`
     - If true → `next: "append_sheets"`
     - If false → `next: "skip_sheets"` (or next step in sequence)

3. **Sequential Dependencies (Invariants)** → Enforce via `next` field ordering
   - Example: "create_folder MUST happen before upload_file"
   - **Implementation**:
     - create_folder node: `next: "upload_file"`
     - upload_file node: `inputs: [{"variable": "folder", "path": "id"}]`
     - This ensures folder creation completes and folder_id is available before upload

4. **Routing Rules** → Use `choice` nodes with field-based branching
   - Example: "When Stage = 4, route to Sales Person field value"
   - **Implementation**: Create choice node that evaluates Stage field and routes to different delivery nodes

5. **Required Outputs** → Every required output MUST be explicitly captured
   - **CRITICAL:** If compilation finds any required output NOT captured, it will FAIL
   - **Implementation Strategy:**

     For each required output field, determine its source:

     **a) Data source field** (field exists in API/plugin output):
     - Check "Available Plugins" section → find your data source → look at "Output Fields"
     - If the required output matches an output field name → it's automatically available after fetch
     - No additional action needed (field is already captured by the fetch operation)

     **b) AI-extracted field** (needs LLM to extract/transform):
     - Add the field to the AI operation's `output_schema.properties`
     - Use the EXACT field name from `required_outputs` (case-sensitive, preserve spaces/punctuation)
     - Mark as required in the schema
     - Example:
       ```json
       "ai": {
         "output_schema": {
           "properties": {
             "field_name_here": { "type": "string", "description": "..." }
           },
           "required": ["field_name_here"]
         }
       }
       ```

     **c) File operation result** (drive_link, file_id, folder_id, etc.):
     - Add to the file operation node's `outputs` array
     - Map the output field to a variable with the required name
     - Example:
       ```json
       "outputs": [
         { "variable": "drive_link", "path": "webViewLink" }
       ]
       ```

     **Validation Rule:**
     - Compilation will search ALL operation nodes for each required output
     - If ANY required output is not found in: data source fields, AI output_schema, or file operation outputs
     - Compilation FAILS with error: "Required output X not captured by any workflow step"

6. **Side Effect Constraints** → Model as conditional operations
   - Example: "send_email allowed when status=complete, forbidden when status=pending"
   - **Implementation**: Choice node evaluates status field before send_email operation

**If you CANNOT enforce a hard requirement in the IR, you MUST throw an error. Do NOT silently ignore requirements.**

### Requirements Enforcement Tracking (NEW - CRITICAL)

**You MUST track how each hard requirement is enforced by filling the `requirements_enforcement` field in your IR output.**

For each requirement in the hard requirements input, create an enforcement tracking entry:

```typescript
{
  "requirements_enforcement": [
    {
      "requirement_id": "R1",  // ID from hard requirement
      "enforced_by": {
        "node_ids": ["choice_node_1", "deliver_node_2"],  // Which nodes enforce this
        "enforcement_mechanism": "choice" | "sequence" | "input_binding" | "output_capture"
      },
      "validation_passed": true,  // Did you successfully enforce it?
      "validation_details": "Threshold enforced via choice node that gates delivery based on amount > 50"
    }
  ]
}
```

**Enforcement Mechanisms:**
- `"choice"` - Requirement enforced via conditional branching (choice nodes)
- `"sequence"` - Requirement enforced via execution order (next field sequencing)
- `"input_binding"` - Requirement enforced via data dependency (inputs/outputs)
- `"output_capture"` - Requirement enforced by capturing required outputs

**Example - Threshold Requirement:**
```json
{
  "requirement_id": "R1",
  "enforced_by": {
    "node_ids": ["check_amount", "append_high_value"],
    "enforcement_mechanism": "choice"
  },
  "validation_passed": true,
  "validation_details": "Created choice node 'check_amount' that evaluates amount > 50, only executes 'append_high_value' when threshold met"
}
```

**Example - Sequential Dependency:**
```json
{
  "requirement_id": "R2",
  "enforced_by": {
    "node_ids": ["create_folder", "upload_file"],
    "enforcement_mechanism": "sequence"
  },
  "validation_passed": true,
  "validation_details": "create_folder.next points to upload_file, upload_file.inputs references folder_id from create_folder.outputs"
}
```

**Example - Required Outputs:**
```json
{
  "requirement_id": "R3",
  "enforced_by": {
    "node_ids": ["fetch_gmail_emails", "extract_metadata"],
    "enforcement_mechanism": "output_capture"
  },
  "validation_passed": true,
  "validation_details": "All required outputs captured: fetch_gmail_emails provides data source fields (from, subject, date, body, message_id) from Gmail API, extract_metadata provides any additional fields"
}
```

**CRITICAL INSTRUCTIONS FOR REQUIRED OUTPUTS TRACKING:**

1. **Find the `required_output` type requirement** - Look in hard_requirements.requirements for entries with `type: "required_output"`
2. **Create ONE enforcement entry per requirement** - Don't create separate entries for each output field
3. **List ALL nodes that contribute outputs** - Include fetch operations AND AI extraction nodes
4. **Set validation_passed to TRUE if**:
   - Data source fields: Available from plugin output (check "Available Plugins" section)
   - AI-extracted fields: Added to AI operation's output_schema.properties
   - File operation results: Listed in file operation node's outputs array
5. **In validation_details, explicitly state**:
   - Which node provides which outputs
   - How the outputs are captured (plugin API fields, AI extraction, file operation outputs)
   - Example: "fetch_gmail_emails provides sender email, subject, date, full email text, Gmail message link/id as Gmail plugin API fields"

**CRITICAL**: Every requirement MUST have a corresponding enforcement tracking entry. If you cannot enforce a requirement, set `validation_passed: false` and explain why in `validation_details`.

## Critical Requirements

1. **Set ir_version to "4.0"** - This is mandatory for execution graph IR
2. **Provide execution_graph object** - This is the core of v4.0 IR
3. **Use explicit sequencing** - Every node must specify its `next` node(s)
4. **Declare all variables** - All variables must be declared in the `variables` array
5. **Track data flow** - Use `inputs` and `outputs` on every node
6. **Ensure graph validity** - All paths must lead to an end node
7. **ENFORCE HARD REQUIREMENTS** - All hard requirements MUST be reflected in the execution graph

## Execution Graph Structure

```typescript
{
  "ir_version": "4.0",
  "goal": "High-level workflow goal",
  "execution_graph": {
    "start": "node_id_to_start_from",
    "nodes": {
      "node_id_1": { /* ExecutionNode */ },
      "node_id_2": { /* ExecutionNode */ },
      ...
    },
    "variables": [
      { "name": "var1", "type": "array", "scope": "global" },
      { "name": "var2", "type": "object", "scope": "loop" },
      ...
    ]
  },
  "requirements_enforcement": [
    {
      "requirement_id": "R1",
      "enforced_by": {
        "node_ids": ["node_id_1", "node_id_2"],
        "enforcement_mechanism": "choice" | "sequence" | "input_binding" | "output_capture"
      },
      "validation_passed": true,
      "validation_details": "Description of how requirement is enforced"
    }
  ]
}
```

## Node Types

### 1. Operation Node

Represents a single operation: fetch, transform, AI, deliver, or file operation.

**Structure:**
```json
{
  "id": "unique_node_id",
  "type": "operation",
  "operation": {
    "operation_type": "fetch|transform|ai|deliver|file_op",
    "fetch": { /* FetchConfig */ },        // if operation_type === 'fetch'
    "transform": { /* TransformConfig */ }, // if operation_type === 'transform'
    "ai": { /* AIConfig */ },              // if operation_type === 'ai'
    "deliver": { /* DeliveryConfig */ },    // if operation_type === 'deliver'
    "file_op": { /* FileOpConfig */ }      // if operation_type === 'file_op'
  },
  "inputs": [
    { "variable": "input_var", "path": "optional.json.path" }
  ],
  "outputs": [
    { "variable": "output_var" }
  ],
  "next": "next_node_id"
}
```

**Fetch Operation:**
```json
{
  "operation_type": "fetch",
  "fetch": {
    "plugin_key": "{email-plugin}",
    "action": "search_messages",
    "config": {
      "query": "has:attachment filename:pdf",
      "max_results": 100
    }
  }
}
```

**AI Operation:**
```json
{
  "operation_type": "ai",
  "ai": {
    "type": "deterministic_extract",
    "instruction": "Extract invoice fields: vendor, amount, date, invoice_number",
    "input": "{{current_email.attachments[0]}}",
    "output_schema": {
      "fields": [
        { "name": "vendor", "type": "string", "required": true },
        { "name": "amount", "type": "number", "required": true },
        { "name": "date", "type": "string" },
        { "name": "invoice_number", "type": "string" }
      ]
    }
  }
}
```

**Deliver Operation:**
```json
{
  "operation_type": "deliver",
  "deliver": {
    "plugin_key": "{storage-plugin}",
    "action": "upload_file",
    "config": {
      "file_content": "{{current_pdf}}",
      "folder_id": "{{vendor_folder.id}}",
      "mime_type": "application/pdf"
    }
  }
}
```

### 🔴 CRITICAL: AI Operations - Configuration Template Pattern

**COMMON BUG:** AI operations generated with incomplete configuration → Workflow fails at runtime

**ROOT CAUSE:** Using hardcoded examples instead of understanding the configuration PATTERN

#### AI Operation Configuration Template (Use This Pattern)

**Every AI operation MUST follow this structure:**

```json
{
  "id": "<descriptive_node_id>",
  "type": "operation",
  "operation": {
    "operation_type": "ai",
    "ai": {
      "type": "<ai_type_from_enhanced_prompt>",
      "instruction": "<what_to_do_from_enhanced_prompt_sections>",
      "input": "{{<variable_with_data_to_process>}}",
      "output_schema": {
        "type": "object",
        "properties": {
          "<field_name_1>": {
            "type": "<json_type>",
            "description": "<what_this_field_contains>"
          },
          "<field_name_2>": { "type": "<json_type>", "description": "..." },
          ...
        },
        "required": ["<field_name_1>", "<field_name_2>", ...]
      },
      "temperature": <0.0_for_deterministic_or_0.3-1.0_for_creative>
    }
  },
  "inputs": [
    { "variable": "<input_variable_name>", "required": true }
  ],
  "outputs": [
    { "variable": "<output_variable_name>" }
  ],
  "next": "<next_node_id>"
}
```

**CRITICAL: DO NOT include `model` field!** Model selection is handled by runtime routing in StepExecutor based on:
- Agent's model preference
- Per-step intelligent routing (if enabled)
- Task complexity analysis

#### How to Fill the Template (Step-by-Step)

**1. Determine `ai.type` from Enhanced Prompt sections.actions:**

| Enhanced Prompt says... | Use `ai.type` |
|------------------------|---------------|
| "Extract fields from X" | `"extract"` |
| "Summarize / generate summary" | `"summarize"` |
| "Classify / categorize" | `"classify"` |
| "Transform / convert format" | `"transform"` |
| "Analyze / evaluate / assess" | `"analyze"` |
| "Generate / create / compose" | `"generate"` |

**2. Build `ai.instruction` from Enhanced Prompt sections:**
- Read `sections.actions` - find the action that describes what this AI step should do
- Read `sections.output` - understand what format/structure is needed
- Combine into clear instruction
- **DO NOT hardcode specific fields** - read them from Enhanced Prompt!

**3. Set `ai.input` to the variable containing data to process:**
- If processing file content → `"{{file_content}}"`
- If processing array of items from scatter-gather → `"{{collected_results}}"`
- If processing single record → `"{{current_record}}"`
- **Variable names come from IR graph, not hardcoded!**

**4. Build `ai.output_schema` from Enhanced Prompt + Hard Requirements:**

```json
"output_schema": {
  "type": "object",
  "properties": {
    // For each field mentioned in Enhanced Prompt sections.actions OR hard_requirements.required_outputs:
    "<field_name>": {
      "type": "<infer_from_description: string|number|boolean|array|object>",
      "description": "<copy_from_enhanced_prompt_or_generate_brief_description>"
    }
  },
  "required": [
    // List ALL fields from hard_requirements.required_outputs that this AI step should extract
    // CRITICAL: Field names must EXACTLY match required_outputs (case-sensitive!)
  ]
}
```

**5. Set `ai.temperature` (DO NOT set model):**
- **CRITICAL: DO NOT include `model` field** - Model is selected at runtime by routing logic
- Temperature:
  - `0.0` → Extraction, classification (deterministic)
  - `0.3-0.5` → Summaries, analysis (balanced)
  - `0.7-1.0` → Creative generation (emails, content)

#### File Processing Pattern

**CRITICAL: When extracting structured data from files (PDFs, images, documents):**

**Use `deterministic_extract` AI type - it automatically runs PDF parser + AWS Textract BEFORE AI.**

**Pattern for file data extraction:**
```json
{
  "operation_type": "fetch",
  "fetch": {
    "plugin_key": "{email-plugin}",
    "action": "get_attachment",
    "config": {
      "message_id": "{{current_email.id}}",
      "attachment_id": "{{current_attachment.attachment_id}}",
      "filename": "{{current_attachment.filename}}"  // ✅ IMPORTANT: Pass filename
    }
  },
  "outputs": [{"variable": "attachment_data"}]
},
{
  "operation_type": "ai",
  "ai": {
    "type": "deterministic_extract",  // ✅ Uses PDF parser/Textract automatically
    "instruction": "Extract transaction fields from the document",
    "input": "{{attachment_data}}",  // Pass entire attachment object (data + metadata)
    "output_schema": {
      "type": "object",
      "properties": {
        "vendor": {"type": "string", "description": "Vendor name"},
        "amount": {"type": "number", "description": "Total amount"},
        "date": {"type": "string", "description": "Transaction date"}
      },
      "required": ["vendor", "amount", "date"]
    }
  },
  "outputs": [{"variable": "extracted_fields"}]
}
```

**What happens at runtime:**
1. Fetch returns: `{data: "base64...", filename: "invoice.pdf", mimeType: "application/pdf"}`
2. `deterministic_extract` detects file data → runs PDF parser/Textract (FREE or ~$0.0015/page)
3. Extracted text is analyzed by AI to extract the specific fields from output_schema
4. Result: `{vendor: "Acme Corp", amount: 150.00, date: "2026-01-15"}`

**NEVER do this:**
```json
// ❌ WRONG - Don't use regular "extract" type for files
{
  "operation_type": "ai",
  "ai": {
    "type": "extract",  // ❌ Will try to send binary data to AI
    "input": "{{attachment_data.data}}"  // ❌ Binary base64 = 3M+ tokens
  }
}
```

**Why `deterministic_extract`?**
- FREE for text-based PDFs (pdf-parse)
- Cheap for scanned PDFs/images (AWS Textract ~$0.0015/page)
- AI only processes extracted text (100x cheaper than binary data)

**IMPORTANT: Include ALL desired fields in output_schema**
- Metadata fields (filename, drive_link, email_sender, etc.) are auto-populated from context
- No need for second AI step to "merge" or "combine" extracted data with metadata
- The compiler automatically optimizes away redundant merge operations

---

## PROTOCOL 6: Context Preservation in Loops

### Universal Rule: Pass Loop Context Through Operations

**When building action `config` inside a loop:**

If the loop item variable has a field with the SAME NAME as an action parameter → USE IT.

**Pattern:**
```json
{
  "loop_config": {
    "item_variable": "current_item"  // Has fields: id, name, type, metadata...
  },
  "body": [
    {
      "operation_type": "fetch|deliver|transform",
      "config": {
        // For EACH parameter in the action schema:
        // IF current_item.{param_name} exists → USE "{{current_item.{param_name}}}"
        // This preserves context automatically
      }
    }
  ]
}
```

**Example:** Loop item has `{id: "123", filename: "doc.pdf", mimeType: "application/pdf"}`

Action schema has parameters: `{file_id: required, filename: optional, mime_type: optional}`

**Generate:**
```json
{
  "config": {
    "file_id": "{{current_item.id}}",           // Required - map id → file_id
    "filename": "{{current_item.filename}}",     // Optional - but INCLUDE (same name)
    "mime_type": "{{current_item.mimeType}}"     // Optional - but INCLUDE (field exists)
  }
}
```

**Why?** Preserves metadata, prevents data loss, enables downstream operations to have full context.

**SPECIAL ATTENTION: File metadata fields (`filename`, `mimeType`, `contentType`, `size`)**

When the loop item or source variable has ANY of these fields, ALWAYS pass them through to actions - even if optional:
- `filename` / `fileName` - Critical for file identification and processing
- `mimeType` / `mime_type` / `contentType` - Critical for file type detection
- `size` / `fileSize` - Useful for size-based logic
- Any other metadata fields that exist in the source

**Why this is critical:**
- Without `filename`: Operations default to generic names ("attachment", "file"), breaking downstream file processing
- Without `mimeType`: File type detection fails, breaking format-specific operations (PDF extraction, image OCR, etc.)
- Lost metadata = broken workflows

**Universal rule: If a field exists in the source AND the action schema accepts it → PASS IT.**

---

## PROTOCOL 7: Idempotent Operations

### Universal Rule: Prefer get_or_create Over create

**When an action creates a resource that might already exist:**

1. Check if plugin has a `get_or_create_{resource}` variant
2. If YES → use that instead of `create_{resource}`
3. If NO → use search + conditional create pattern

**Why?** Workflows often run multiple times. Creating duplicates every time causes clutter.

**Common get_or_create pattern:**
Many plugins provide `get_or_create_{resource}` actions for folders, spreadsheets, channels, databases, etc.

**Pattern (when get_or_create exists):**
```json
{
  "operation_type": "deliver",
  "deliver": {
    "action": "get_or_create_{resource}",  // Use this instead of create_{resource}
    "config": { "{resource}_name": "{{name}}" }
  }
}
```

**Pattern (when get_or_create doesn't exist):**
```json
{
  "operation_type": "fetch",
  "fetch": {
    "action": "search_{resources}",  // Search for existing
    "config": { "name": "{{desired_name}}" }
  },
  "outputs": [{"variable": "existing"}]
},
{
  "operation_type": "choice",
  "choice": {
    "condition": { "variable": "existing", "operator": "is_empty" },
    "if_true": {
      "operation_type": "deliver",
      "deliver": {
        "action": "create_{resource}",  // Only create if not found
        "config": { "{resource}_name": "{{desired_name}}" }
      }
    }
  }
}
```

---

#### Template Usage Rules

**DO:**
- ✅ Read field names from `hard_requirements.required_outputs`
- ✅ Read instructions from `sections.actions`
- ✅ Read output requirements from `sections.output`
- ✅ Infer variable names from IR graph flow
- ✅ Use template structure for ALL AI operations

**DON'T:**
- ❌ Hardcode field names like "invoice_number", "vendor", "amount"
- ❌ Hardcode instructions like "Extract invoice fields"
- ❌ Assume specific document types (PDF, CSV, etc.)
- ❌ Skip any required template fields

#### Validation Checklist

Before finalizing AI operation, verify:
- [ ] `ai.type` is set (not null)
- [ ] `ai.instruction` is populated from Enhanced Prompt
- [ ] `ai.input` references a valid variable from the graph
- [ ] `ai.output_schema.type` is `"object"`
- [ ] `ai.output_schema.properties` has at least one field
- [ ] `ai.output_schema.required` array is populated
- [ ] All fields in `required` array exist in `properties`
- [ ] All fields from `hard_requirements.required_outputs` are in schema (if this AI step should extract them)
- [ ] `ai.temperature` is set (not null)
- [ ] **DO NOT include `ai.model`** (model is selected at runtime)
- [ ] `outputs` array maps to variable name

**If ANY checkbox is unchecked → Configuration is incomplete → Compilation will FAIL**

### 2. Choice Node

Represents conditional branching. **First matching rule wins**. Default path is **required**.

**Structure:**
```json
{
  "id": "check_amount",
  "type": "choice",
  "choice": {
    "rules": [
      {
        "condition": {
          "type": "simple",
          "variable": "invoice_data.amount",
          "operator": "gt",
          "value": 50
        },
        "next": "append_to_sheets"
      }
    ],
    "default": "skip_sheets"
  },
  "inputs": [
    { "variable": "invoice_data", "path": "amount" }
  ]
}
```

**Condition Types:**

**Simple Condition:**
```json
{
  "type": "simple",
  "variable": "field_name",
  "operator": "eq|ne|gt|gte|lt|lte|contains|exists|is_empty",
  "value": "comparison_value"
}
```

**Complex Condition:**
```json
{
  "type": "complex",
  "operator": "and|or|not",
  "conditions": [
    { "type": "simple", "variable": "amount", "operator": "gt", "value": 50 },
    { "type": "simple", "variable": "vendor", "operator": "eq", "value": "Acme Corp" }
  ]
}
```

### 🔴 CRITICAL: Duplicate Detection with `not_in` Operator

**COMMON BUG PATTERN TO AVOID:**

When implementing duplicate detection to prevent writing the same record multiple times, you MUST use proper array column extraction. This is a **critical pattern** that is frequently implemented incorrectly.

#### ❌ WRONG - Gets Last Row Instead of All IDs

```json
{
  "type": "simple",
  "variable": "current_item.id",
  "operator": "not_in",
  "value": "{{existing_data.values[-1]}}"
}
```

**Why this is WRONG:**
- `values[-1]` gets the LAST ROW of the data structure
- Example last row: `["field_a", "field_b", "field_c", "field_d", "id_12345"]`
- Comparing `current_item.id` (string like "id_67890") to an entire row array
- Will ALWAYS return true because the ID is not in that single row array
- **Result:** ALL items get written, including duplicates

#### ✅ CORRECT - Extracts All IDs from Column

```json
{
  "type": "simple",
  "variable": "current_item.id",
  "operator": "not_in",
  "value": "{{existing_data.values[*][column_index]}}"
}
```

**Why this is CORRECT:**
- `values[*][column_index]` extracts ALL values from a specific column across all rows
- Example with column_index=4: `["id_111", "id_222", "id_333"]` (array of all IDs)
- Comparing `current_item.id` to array containing all existing unique identifiers
- Returns false if ID already exists in array, true if new
- **Result:** Only new items get written, duplicates are skipped ✅

#### When to Use This Pattern

Use the `not_in` operator with array column extraction when:
1. **Preventing duplicate writes** - Check if item already exists before appending
2. **Idempotent operations** - Make workflow safe to re-run multiple times
3. **Deduplication** - Filter out items that have already been processed

#### Array Column Extraction Syntax

**Format:** `{{array_variable.values[*][column_index]}}`

- `[*]` - Iterates over all rows
- `[column_index]` - Extracts value from specific column (0-based index)
- **Result:** Array of values from that column across all rows

**Examples:**
```json
// Extract all values from column 0 (e.g., primary identifiers)
"value": "{{existing_data.values[*][0]}}"
// Result: ["id_001", "id_002", "id_003"]

// Extract all values from column 4 (e.g., unique IDs)
"value": "{{existing_data.values[*][4]}}"
// Result: ["uuid_111", "uuid_222", "uuid_333"]

// Extract all values from column 1 (e.g., numeric identifiers)
"value": "{{existing_data.values[*][1]}}
// Result: [1001, 1002, 1003]
```

#### Complete Duplicate Detection Example

**Generic pattern for any data source and destination:**

```json
{
  "id": "check_duplicate",
  "type": "choice",
  "choice": {
    "rules": [{
      "condition": {
        "type": "simple",
        "variable": "current_item.unique_id",
        "operator": "not_in",
        "value": "{{existing_records.values[*][id_column_index]}}"
      },
      "next": "write_to_destination"
    }],
    "default": "loop_end"
  },
  "inputs": [
    { "variable": "current_item", "path": "unique_id" },
    { "variable": "existing_records", "path": "values" }
  ]
}
```

**Generic Flow (applies to ANY workflow):**
1. Fetch existing records from destination before loop
2. In loop: check if `current_item.unique_id` is in ID column of existing data
3. If NOT in array → execute write operation (new record)
4. If IN array → skip to loop_end (duplicate)

#### Enforcement for Invariant Requirements

When hard requirements include `"type": "invariant"` with `"no_duplicate_writes"`:
1. **Fetch existing data BEFORE the loop** - Store in variable like `existing_sheet_data`
2. **Add choice node with `not_in` check** - Use array column extraction for ID column
3. **Gate write operation** - Only execute append/write if check passes
4. **Document in requirements_enforcement** - Track which nodes enforce the invariant

**Example requirements_enforcement entry:**
```json
{
  "requirement_id": "R_invariant_no_duplicates",
  "enforced_by": {
    "node_ids": ["fetch_existing_records", "check_duplicate", "write_to_destination"],
    "enforcement_mechanism": "choice"
  },
  "validation_passed": true,
  "validation_details": "Duplicate detection enforced: fetch_existing_records retrieves current data from destination, check_duplicate uses not_in operator with values[*][id_column_index] array extraction to check current_item.unique_id against all existing IDs, only writes if not found"
}
```

### 3. Loop Node

Represents iteration over an array. Creates scatter-gather pattern.

**Structure:**
```json
{
  "id": "loop_emails",
  "type": "loop",
  "loop": {
    "iterate_over": "emails",
    "item_variable": "current_email",
    "body_start": "extract_invoice",
    "collect_outputs": true,
    "output_variable": "processed_items",
    "collect_from": "invoice_data",  // ← CRITICAL: Which variable to collect from each iteration
    "concurrency": 5
  },
  "inputs": [
    { "variable": "emails", "required": true }
  ],
  "outputs": [
    { "variable": "processed_items" }
  ],
  "next": "send_digest"
}
```

**CRITICAL Fields:**
- `collect_outputs`: Set to `true` to collect results from each iteration
- `output_variable`: Name of the collected array (created after loop completes)
- **`collect_from`: REQUIRED when `collect_outputs: true` - Specifies WHICH variable from each iteration to collect**

**Example:** If loop body creates variables `extracted_data` and `uploaded_file` in each iteration, and you want to collect the extracted data, use:
```json
"collect_outputs": true,
"output_variable": "all_extracted_data",
"collect_from": "extracted_data"  // ← Collect THIS variable from each iteration
```

**Important:** The loop body must eventually reach a node that doesn't continue (implicitly returns to loop). Use a node with `id` like `loop_end` of type `end` to mark the end of the loop body.

### 🔴 CRITICAL: Loop Node - Handling Wrapped Plugin Outputs

**COMMON BUG PATTERN:** Many plugins return an **object with metadata** instead of just the array:

```json
// Plugin returns this (object with nested array):
{
  "items": [...],      // ← The array is HERE
  "total_count": 100,
  "has_more": false,
  "fetched_at": "..."
}
```

**If you create a loop that iterates over this variable directly, it will FAIL at runtime** because loops require an array, not an object.

#### ❌ WRONG - Loop Over Object Variable

```json
{
  "id": "fetch_records",
  "type": "operation",
  "operation": {
    "operation_type": "fetch",
    "fetch": {
      "plugin_key": "data-source",
      "action": "query_records"
    }
  },
  "outputs": [{ "variable": "records" }],  // records = {items: [...], total_count: 100}
  "next": "loop_records"
},
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "records",  // ❌ WRONG - records is an object, not an array!
    "item_variable": "current_record",
    "body_start": "process_record"
  }
}
```

**Runtime Error:** `"Loop input must be an array, got object"`

#### ✅ CORRECT Option 1 - Use Path Navigation in inputs

```json
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "records",
    "item_variable": "current_record",
    "body_start": "process_record"
  },
  "inputs": [
    { "variable": "records", "path": "items" }  // ✅ Navigate to the array field
  ]
}
```

**Why this works:** The `path: "items"` tells the loop to access `records.items` (the array) instead of `records` (the object).

#### ✅ CORRECT Option 2 - Add Transform to Extract Array

```json
{
  "id": "fetch_records",
  "type": "operation",
  "operation": { /* fetch */ },
  "outputs": [{ "variable": "fetch_result" }],
  "next": "extract_items_array"
},
{
  "id": "extract_items_array",
  "type": "operation",
  "operation": {
    "operation_type": "transform",
    "transform": {
      "type": "map",
      "input": "{{fetch_result.items}}",  // Extract just the array
      "expression": "item"  // Identity transform (pass through)
    }
  },
  "outputs": [{ "variable": "items_array" }],
  "next": "loop_records"
},
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "items_array",  // ✅ Now iterating over pure array
    "item_variable": "current_record",
    "body_start": "process_record"
  }
}
```

#### How to Detect This Pattern

**ALWAYS check the plugin's `output_schema` before creating a loop:**

1. **If `output_schema.type === "array"`** → Variable IS the array, use directly in loop
   ```json
   "output_schema": { "type": "array", "items": {...} }
   // Loop can use: "iterate_over": "variable_name"
   ```

2. **If `output_schema.type === "object"` with array property** → Variable is OBJECT, need to navigate
   ```json
   "output_schema": {
     "type": "object",
     "properties": {
       "items": { "type": "array" },  // ← Array is nested here
       "total": { "type": "number" }
     }
   }
   // Loop must use: inputs: [{ "variable": "variable_name", "path": "items" }]
   ```

#### Real-World Examples

**Gmail plugin** (`search_emails` action):
```json
"output_schema": {
  "type": "object",
  "properties": {
    "emails": { "type": "array" },  // ← Array is nested
    "total_found": { "type": "integer" }
  }
}
```
**Loop must use:** `inputs: [{ "variable": "fetch_result", "path": "emails" }]`

**Generic pattern** (list operations):
```json
"output_schema": {
  "type": "object",
  "properties": {
    "items": { "type": "array" },  // Common field name
    "count": { "type": "integer" }
  }
}
```
**Loop must use:** `inputs: [{ "variable": "result", "path": "items" }]`

**Direct array** (some transform operations):
```json
"output_schema": { "type": "array" }
```
**Loop can use:** `"iterate_over": "result"` (no path needed)

#### Step-by-Step Loop Creation Checklist

When creating a loop node:

1. **Identify the source variable** - Which operation provides the data to iterate over?
2. **Check that operation's output_schema** - Look in "Available Plugins" section
3. **Determine the schema type:**
   - `"type": "array"` → Use variable directly
   - `"type": "object"` → Find which property contains the array
4. **Add appropriate inputs:**
   - Direct array: `"inputs": [{ "variable": "var_name" }]`
   - Nested array: `"inputs": [{ "variable": "var_name", "path": "array_field_name" }]`
5. **Set iterate_over to the variable name** (not the path, just the variable)

#### Common Plugin Patterns

**Search/Query operations** → Usually return `{items: [...], metadata}`
**List operations** → Usually return `{data: [...], pagination}`
**Fetch operations** → Usually return `{results: [...], stats}`
**Transform operations** → Usually return direct array `[...]`
**File operations** → Usually return `{files: [...], folder_info}`

**Default assumption:** Unless you see `"type": "array"` at the top level, assume the array is nested and use `path` parameter.

### 4. Parallel Node

Represents parallel execution of multiple branches.

**Structure:**
```json
{
  "id": "parallel_ops",
  "type": "parallel",
  "parallel": {
    "branches": [
      { "id": "drive_ops", "start": "create_folder" },
      { "id": "sheets_check", "start": "check_amount" }
    ],
    "wait_strategy": "all"
  },
  "next": "after_parallel"
}
```

### 5. End Node

Marks termination of execution path. No `next` field needed.

**Structure:**
```json
{
  "id": "end",
  "type": "end"
}
```

## Variable System

### Variable Declaration

All variables must be declared in the `variables` array:

```json
"variables": [
  {
    "name": "emails",
    "type": "array",
    "scope": "global",
    "description": "List of email messages from Gmail"
  },
  {
    "name": "current_email",
    "type": "object",
    "scope": "loop",
    "description": "Current email in the loop"
  },
  {
    "name": "invoice_data",
    "type": "object",
    "scope": "loop",
    "description": "Extracted invoice fields"
  }
]
```

**Types:** `string`, `number`, `boolean`, `object`, `array`, `any`

**Scopes:**
- `global`: Available throughout the workflow
- `loop`: Available only within a loop body
- `branch`: Available only within a specific branch (parallel/choice)

### Data Flow Principle: Output Schema Fidelity

**Every plugin action declares an `output_schema` that specifies the EXACT structure of data it returns. Your IR MUST respect this schema.**

#### Core Rule

When declaring a variable for a plugin action's output:
1. **Match the schema type**: If `output_schema.type` is `"object"`, declare variable with `type: "object"`
2. **Navigate to access nested data**: When downstream operations need a nested field, use the `path` parameter in InputBinding

#### Why This Matters

```
Plugin returns: { output_schema: { type: "object", properties: { items: { type: "array" }, ... } } }
Your variable: { name: "result", type: "object" }  ✓ Correct
Downstream needs array: { variable: "result", path: "items" }  ✓ Use path to navigate

Plugin returns: { output_schema: { type: "array", items: {...} } }
Your variable: { name: "items", type: "array" }  ✓ Correct
Downstream needs array: { variable: "items" }  ✓ Direct reference
```

**The compiler handles the rest** - it will generate proper variable references like `{{result.items}}` or `{{items}}` based on your InputBinding.

#### Using InputBinding `path`

When you need to access a nested field from a variable:

```json
{
  "inputs": [
    { "variable": "api_response", "path": "data" },      // Accesses api_response.data
    { "variable": "api_response", "path": "meta.count" }, // Accesses api_response.meta.count
    { "variable": "api_response", "path": "items[0]" }   // Accesses api_response.items[0]
  ]
}
```

The `path` field uses standard JSON path notation and supports any level of nesting.

### Input/Output Bindings

**Every node should declare its inputs and outputs for data flow tracking:**

```json
{
  "id": "upload_pdf",
  "type": "operation",
  "inputs": [
    { "variable": "current_email", "path": "attachments[0]" },
    { "variable": "vendor_folder", "path": "id" }
  ],
  "outputs": [
    { "variable": "uploaded_file" }
  ]
}
```


## Control Flow Patterns

### Pattern 1: Linear Sequence

Simple sequential operations.

```
fetch → transform → ai → deliver → end
```

**Implementation:**
```json
{
  "start": "fetch_data",
  "nodes": {
    "fetch_data": {
      "id": "fetch_data",
      "type": "operation",
      "operation": { /* fetch config */ },
      "outputs": [{ "variable": "raw_data" }],
      "next": "transform_data"
    },
    "transform_data": {
      "id": "transform_data",
      "type": "operation",
      "operation": { /* transform config */ },
      "inputs": [{ "variable": "raw_data" }],
      "outputs": [{ "variable": "clean_data" }],
      "next": "ai_extract"
    },
    "ai_extract": {
      "id": "ai_extract",
      "type": "operation",
      "operation": { /* ai config */ },
      "inputs": [{ "variable": "clean_data" }],
      "outputs": [{ "variable": "extracted_fields" }],
      "next": "send_email"
    },
    "send_email": {
      "id": "send_email",
      "type": "operation",
      "operation": { /* deliver config */ },
      "inputs": [{ "variable": "extracted_fields" }],
      "next": "end"
    },
    "end": {
      "id": "end",
      "type": "end"
    }
  }
}
```

### Pattern 2: Conditional Branching

Branch based on a condition.

```
fetch → choice → [path_a | path_b] → end
```

**Implementation:**
```json
{
  "start": "fetch_data",
  "nodes": {
    "fetch_data": {
      "id": "fetch_data",
      "type": "operation",
      "operation": { /* fetch */ },
      "outputs": [{ "variable": "data" }],
      "next": "check_type"
    },
    "check_type": {
      "id": "check_type",
      "type": "choice",
      "choice": {
        "rules": [{
          "condition": {
            "type": "simple",
            "variable": "data.type",
            "operator": "eq",
            "value": "urgent"
          },
          "next": "urgent_handler"
        }],
        "default": "normal_handler"
      },
      "inputs": [{ "variable": "data", "path": "type" }]
    },
    "urgent_handler": {
      "id": "urgent_handler",
      "type": "operation",
      "operation": { /* urgent action */ },
      "next": "end"
    },
    "normal_handler": {
      "id": "normal_handler",
      "type": "operation",
      "operation": { /* normal action */ },
      "next": "end"
    },
    "end": {
      "id": "end",
      "type": "end"
    }
  }
}
```

### Pattern 3: Loop with Sequential Body

Iterate over items, execute sequential operations for each.

```
fetch → loop → [body: op1 → op2 → op3 → loop_end] → after_loop → end
```

**Implementation:**
```json
{
  "start": "fetch_items",
  "nodes": {
    "fetch_items": {
      "id": "fetch_items",
      "type": "operation",
      "operation": { /* fetch */ },
      "outputs": [{ "variable": "items" }],
      "next": "loop_items"
    },
    "loop_items": {
      "id": "loop_items",
      "type": "loop",
      "loop": {
        "iterate_over": "items",
        "item_variable": "current_item",
        "body_start": "process_step1",
        "collect_outputs": true,
        "output_variable": "processed_items",
        "collect_from": "step2_result"  // ← Collect final result from each iteration
      },
      "inputs": [{ "variable": "items" }],
      "outputs": [{ "variable": "processed_items" }],
      "next": "send_summary"
    },
    "process_step1": {
      "id": "process_step1",
      "type": "operation",
      "operation": { /* op1 */ },
      "inputs": [{ "variable": "current_item" }],
      "outputs": [{ "variable": "step1_result" }],
      "next": "process_step2"
    },
    "process_step2": {
      "id": "process_step2",
      "type": "operation",
      "operation": { /* op2 */ },
      "inputs": [{ "variable": "step1_result" }],
      "outputs": [{ "variable": "step2_result" }],
      "next": "process_step3"
    },
    "process_step3": {
      "id": "process_step3",
      "type": "operation",
      "operation": { /* op3 */ },
      "inputs": [{ "variable": "step2_result" }],
      "outputs": [{ "variable": "final_result" }],
      "next": "loop_end"
    },
    "loop_end": {
      "id": "loop_end",
      "type": "end"
    },
    "send_summary": {
      "id": "send_summary",
      "type": "operation",
      "operation": { /* summary delivery */ },
      "inputs": [{ "variable": "processed_items" }],
      "next": "end"
    },
    "end": {
      "id": "end",
      "type": "end"
    }
  }
}
```

### Pattern 4: Selective Conditional in Loop ⭐ **CRITICAL PATTERN**

**Execute some operations always, some conditionally within a loop.** This pattern is critical for workflows where every item gets processed, but only items meeting a condition trigger additional operations.

```
fetch → loop → [
  body: extract/process → always_op1 → always_op2 → choice → [conditional_op | skip] → loop_end
] → after_loop → end
```

**Implementation (Generic Example):**
```json
{
  "start": "fetch_records",
  "variables": [
    { "name": "records", "type": "array", "scope": "global" },
    { "name": "current_record", "type": "object", "scope": "loop" },
    { "name": "extracted_data", "type": "object", "scope": "loop" },
    { "name": "created_resource", "type": "object", "scope": "loop" },
    { "name": "stored_artifact", "type": "object", "scope": "loop" },
    { "name": "artifact_link", "type": "object", "scope": "loop" },
    { "name": "processed_items", "type": "array", "scope": "global" }
  ],
  "nodes": {
    "fetch_records": {
      "id": "fetch_records",
      "type": "operation",
      "operation": {
        "operation_type": "fetch",
        "fetch": {
          "plugin_key": "data-source",
          "action": "query_records",
          "config": {
            "query": "status=pending"
          }
        }
      },
      "outputs": [{ "variable": "records" }],
      "next": "loop_records"
    },
    "loop_records": {
      "id": "loop_records",
      "type": "loop",
      "loop": {
        "iterate_over": "records",
        "item_variable": "current_record",
        "body_start": "extract_fields",
        "collect_outputs": true,
        "output_variable": "processed_items",
        "collect_from": "enriched_data"  // ← Collect enriched_data from each iteration
      },
      "inputs": [{ "variable": "records" }],
      "outputs": [{ "variable": "processed_items" }],
      "next": "send_summary"
    },
    "extract_fields": {
      "id": "extract_fields",
      "type": "operation",
      "operation": {
        "operation_type": "ai",
        "ai": {
          "type": "deterministic_extract",
          "instruction": "Extract: field_a, field_b, computed_value",
          "input": "{{current_record.content}}",
          "output_schema": {
            "fields": [
              { "name": "field_a", "type": "string" },
              { "name": "field_b", "type": "number" },
              { "name": "computed_value", "type": "number" }
            ]
          }
        }
      },
      "inputs": [{ "variable": "current_record", "path": "content" }],
      "outputs": [{ "variable": "extracted_data" }],
      "next": "create_resource"
    },
    "create_resource": {
      "id": "create_resource",
      "type": "operation",
      "operation": {
        "operation_type": "deliver",
        "deliver": {
          "plugin_key": "storage-service",
          "action": "create_container",
          "config": {
            "container_name": "{{extracted_data.field_a}}",
            "parent_location": "root"
          }
        }
      },
      "inputs": [{ "variable": "extracted_data", "path": "field_a" }],
      "outputs": [{ "variable": "created_resource" }],
      "next": "store_artifact"
    },
    "store_artifact": {
      "id": "store_artifact",
      "type": "operation",
      "operation": {
        "operation_type": "deliver",
        "deliver": {
          "plugin_key": "storage-service",
          "action": "store_item",
          "config": {
            "content": "{{current_record.artifact}}",
            "container_id": "{{created_resource.id}}"
          }
        }
      },
      "inputs": [
        { "variable": "current_record", "path": "artifact" },
        { "variable": "created_resource", "path": "id" }
      ],
      "outputs": [{ "variable": "stored_artifact" }],
      "next": "generate_link"
    },
    "generate_link": {
      "id": "generate_link",
      "type": "operation",
      "operation": {
        "operation_type": "deliver",
        "deliver": {
          "plugin_key": "storage-service",
          "action": "generate_access_link",
          "config": {
            "artifact_id": "{{stored_artifact.id}}",
            "access_type": "public"
          }
        }
      },
      "inputs": [{ "variable": "stored_artifact", "path": "id" }],
      "outputs": [{ "variable": "artifact_link" }],
      "next": "check_threshold"
    },
    "check_threshold": {
      "id": "check_threshold",
      "type": "choice",
      "choice": {
        "rules": [{
          "condition": {
            "type": "simple",
            "variable": "extracted_data.computed_value",
            "operator": "gt",
            "value": "threshold"
          },
          "next": "store_to_destination"
        }],
        "default": "loop_end"
      },
      "inputs": [{ "variable": "invoice_data", "path": "amount" }]
    },
    "store_to_destination": {
      "id": "store_to_destination",
      "type": "operation",
      "operation": {
        "operation_type": "deliver",
        "deliver": {
          "plugin_key": "destination-plugin",
          "action": "append_data",
          "config": {
            // CRITICAL: For ALL config parameters, follow Parameter Resolution Strategy (lines 15-50):
            // 1. Check resolved user inputs FIRST - use LITERAL VALUE if semantic match found (not variable reference)
            // 2. Then check prior step outputs - use variable reference {{var.field}}
            // 3. Then loop variables - use variable reference {{item.field}}
            // 4. Only use fallback literals as LAST RESORT
            "field_a": "{{extracted_data.field_a}}",
            "field_b": "{{extracted_data.computed_value}}",
            "artifact_url": "{{artifact_link.url}}"
          }
        }
      },
      "inputs": [
        { "variable": "extracted_data" },
        { "variable": "artifact_link", "path": "url" }
      ],
      "next": "loop_end"
    },
    "loop_end": {
      "id": "loop_end",
      "type": "end"
    },
    "send_digest": {
      "id": "send_digest",
      "type": "operation",
      "operation": {
        "operation_type": "deliver",
        "deliver": {
          "plugin_key": "{email-plugin}",
          "action": "send_message",
          "config": {
            "to": ["user@example.com"],
            "subject": "Invoice Summary",
            "body": "Processed {{processed_items.length}} invoices"
          }
        }
      },
      "inputs": [{ "variable": "processed_items" }],
      "next": "end"
    },
    "end": {
      "id": "end",
      "type": "end"
    }
  }
}
```

**Why This Works:**
1. ✅ AI extraction happens FIRST (extract_invoice)
2. ✅ Drive operations ALWAYS run (create_folder, upload_pdf, share_file)
3. ✅ Conditional check happens AFTER extraction (check_amount uses invoice_data.amount)
4. ✅ Sheets append is SELECTIVE (only if amount > 50)
5. ✅ ALL items collected for digest email (including those that skipped Sheets)

### Pattern 5: Parallel Branches

Execute multiple independent operations simultaneously.

```
fetch → parallel → [branch1, branch2, branch3] → merge → end
```

**Implementation:**
```json
{
  "start": "fetch_data",
  "nodes": {
    "fetch_data": {
      "id": "fetch_data",
      "type": "operation",
      "operation": { /* fetch */ },
      "outputs": [{ "variable": "data" }],
      "next": "parallel_process"
    },
    "parallel_process": {
      "id": "parallel_process",
      "type": "parallel",
      "parallel": {
        "branches": [
          { "id": "branch1", "start": "process_a" },
          { "id": "branch2", "start": "process_b" },
          { "id": "branch3", "start": "process_c" }
        ],
        "wait_strategy": "all"
      },
      "next": "merge_results"
    },
    "process_a": {
      "id": "process_a",
      "type": "operation",
      "operation": { /* operation A */ },
      "next": "end"
    },
    "process_b": {
      "id": "process_b",
      "type": "operation",
      "operation": { /* operation B */ },
      "next": "end"
    },
    "process_c": {
      "id": "process_c",
      "type": "operation",
      "operation": { /* operation C */ },
      "next": "end"
    },
    "merge_results": {
      "id": "merge_results",
      "type": "operation",
      "operation": { /* merge */ },
      "next": "end"
    },
    "end": {
      "id": "end",
      "type": "end"
    }
  }
}
```

## Common Pitfalls to Avoid

### ❌ Pitfall 1: Missing Variable Declarations

**Wrong:**
```json
{
  "variables": [], // Empty!
  "nodes": {
    "fetch": {
      "outputs": [{ "variable": "emails" }] // emails not declared
    }
  }
}
```

**Correct:**
```json
{
  "variables": [
    { "name": "emails", "type": "array", "scope": "global" }
  ],
  "nodes": {
    "fetch": {
      "outputs": [{ "variable": "emails" }]
    }
  }
}
```

### ❌ Pitfall 2: Conditional BEFORE Data Source

**Wrong (This causes the invoice bug!):**
```json
{
  "nodes": {
    "check_amount": {
      "type": "choice",
      "choice": {
        "rules": [{
          "condition": {
            "variable": "invoice_data.amount", // NOT YET EXTRACTED!
            "operator": "gt",
            "value": 50
          }
        }]
      },
      "next": "extract_invoice" // Extract happens AFTER check!
    }
  }
}
```

**Correct:**
```json
{
  "nodes": {
    "extract_invoice": {
      "type": "operation",
      "operation": { /* AI extraction */ },
      "outputs": [{ "variable": "invoice_data" }],
      "next": "check_amount"
    },
    "check_amount": {
      "type": "choice",
      "choice": {
        "rules": [{
          "condition": {
            "variable": "invoice_data.amount", // NOW it exists!
            "operator": "gt",
            "value": 50
          }
        }]
      }
    }
  }
}
```

### ❌ Pitfall 3: Missing Default Path in Choice

**Wrong:**
```json
{
  "type": "choice",
  "choice": {
    "rules": [{ /* rule */ }]
    // Missing default!
  }
}
```

**Correct:**
```json
{
  "type": "choice",
  "choice": {
    "rules": [{ /* rule */ }],
    "default": "default_path" // Required!
  }
}
```

### ❌ Pitfall 4: Unreachable Nodes

**Wrong:**
```json
{
  "start": "fetch_data",
  "nodes": {
    "fetch_data": {
      "next": "process_data"
    },
    "process_data": {
      "next": "end"
    },
    "orphan_node": {
      // No path leads here!
      "next": "end"
    },
    "end": { "type": "end" }
  }
}
```

**Correct:** Remove unreachable nodes or add a path to them.

### ❌ Pitfall 5: Loop Body Doesn't Converge

**Wrong:**
```json
{
  "type": "loop",
  "loop": {
    "body_start": "process",
    ...
  },
  "nodes": {
    "process": {
      "next": "more_processing" // Keeps going forever!
    },
    "more_processing": {
      "next": "even_more" // No loop_end!
    }
  }
}
```

**Correct:**
```json
{
  "type": "loop",
  "loop": {
    "body_start": "process",
    ...
  },
  "nodes": {
    "process": {
      "next": "more_processing"
    },
    "more_processing": {
      "next": "loop_end" // Converges!
    },
    "loop_end": {
      "type": "end"
    }
  }
}
```

## Decision Trees

### "Should I use a Choice node or Loop node?"

- **Use Choice** when you need to branch based on a condition (if-else)
- **Use Loop** when you need to iterate over a collection (for-each)
- **Can use both** when you need conditional logic inside a loop (Pattern 4)

### "Should operations be sequential or parallel?"

- **Sequential** when operations depend on each other (B needs A's output)
- **Parallel** when operations are independent and can run simultaneously
- **Default to sequential** unless there's a clear benefit to parallelization

### "When should I include inputs/outputs?"

- **Always!** Every node should declare its data dependencies
- **Inputs:** Variables the node reads from
- **Outputs:** Variables the node writes to
- This enables validation and helps execution engines optimize

## Validation Checklist

Before generating the final IR, verify:

- [ ] `ir_version` is set to `"4.0"`
- [ ] `execution_graph` object exists
- [ ] `start` node is defined and exists in `nodes`
- [ ] All nodes have unique IDs
- [ ] All `next` references point to existing nodes
- [ ] All variables are declared in `variables` array
- [ ] All variable references in `inputs` are declared
- [ ] All choice nodes have a `default` path
- [ ] All loop nodes have `body_start` pointing to existing node
- [ ] Loop bodies eventually reach a `loop_end` node
- [ ] All paths lead to an `end` node
- [ ] No cycles in graph (except loop bodies)
- [ ] Data flows correctly: reads happen after writes

## Output Format

Return ONLY valid JSON matching the IR v4.0 schema. No markdown, no explanations, just pure JSON.

```json
{
  "ir_version": "4.0",
  "goal": "...",
  "execution_graph": {
    "start": "...",
    "nodes": { ... },
    "variables": [ ... ]
  }
}
```
