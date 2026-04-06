# Current vs Fixed DSL - Invoice/Expense Workflow

## Current DSL Output (BROKEN - Without execution_scope)

```json
[
  {
    "id": "step1",
    "name": "Fetch Gmail Messages",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_messages",
    "params": {
      "query": "newer_than:1d has:attachment filename:pdf"
    }
  },
  {
    "id": "step2",
    "name": "Deduplicate by Message ID",
    "type": "transform",
    "operation": "deduplicate",
    "config": {
      "key_field": "id"
    }
  },
  {
    "id": "step3",
    "name": "Extract Attachments",
    "type": "transform",
    "operation": "extract_attachments",
    "config": {
      "attachment_field": "attachments",
      "filter": {
        "mime_type": "application/pdf"
      }
    }
  },
  {
    "id": "step4",
    "name": "AI Extract Invoice Data",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{step3.data}}",
      "itemVariable": "attachment"
    },
    "gather": {
      "mode": "array",
      "outputVariable": "extracted_data"
    },
    "steps": [
      {
        "id": "step4a",
        "type": "action",
        "plugin": "ai-inference",
        "action": "extract",
        "params": {
          "model": "gpt-4o",
          "instruction": "Extract: type, vendor, date, amount, invoice_receipt_number, category",
          "input": "{{attachment.content}}",
          "output_schema": {
            "type": "object",
            "fields": [
              { "name": "type", "type": "string", "required": true },
              { "name": "vendor", "type": "string", "required": true },
              { "name": "date", "type": "string", "required": true },
              { "name": "amount", "type": "number", "required": false },
              { "name": "invoice_receipt_number", "type": "string", "required": true },
              { "name": "category", "type": "string", "required": false }
            ]
          }
        }
      }
    ]
  },
  {
    "id": "step7",
    "name": "Conditional: Amount > 50",
    "type": "conditional",
    "condition": {
      "type": "complex",
      "combineWith": "AND",
      "conditions": [
        {
          "field": "amount",
          "operator": "is_not_empty",
          "value": null
        },
        {
          "field": "amount",
          "operator": "greater_than",
          "value": 50
        }
      ]
    },
    "then": [],
    "else": []
  },
  {
    "id": "step13",
    "name": "Create Drive Folder",
    "type": "action",
    "plugin": "google-drive",
    "action": "create_folder",
    "params": {
      "folder_name": "{{vendor}}",
      "parent_folder_id": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-"
    }
  },
  {
    "id": "step14",
    "name": "Upload File to Drive",
    "type": "action",
    "plugin": "google-drive",
    "action": "upload_file",
    "params": {
      "folder_id": "{{step_result.folder_id}}",
      "file_content": "{{attachment_content}}",
      "file_name": "{{attachment_filename}}",
      "mime_type": "application/pdf"
    }
  },
  {
    "id": "step15",
    "name": "Share Drive File",
    "type": "action",
    "plugin": "google-drive",
    "action": "share_file",
    "params": {
      "file_id": "{{step_result.file_id}}",
      "permission_type": "anyone",
      "permission_role": "reader"
    }
  },
  {
    "id": "step16",
    "name": "Append to Google Sheets",
    "type": "action",
    "plugin": "google-sheets",
    "action": "append_rows",
    "params": {
      "spreadsheet_id": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE",
      "range": "Sheet1!A:G",
      "values": [
        "{{type}}",
        "{{vendor}}",
        "{{date}}",
        "{{amount}}",
        "{{invoice_receipt_number}}",
        "{{category}}",
        "{{drive_link}}"
      ]
    }
  },
  {
    "id": "step17",
    "name": "Send Digest Email",
    "type": "action",
    "plugin": "google-mail",
    "action": "send_message",
    "params": {
      "to": ["meiribarak@gmail.com"],
      "subject": "Daily invoice/expense digest (last 24 hours)",
      "body": {
        "format": "html",
        "content": "Processed {{count}} documents..."
      }
    }
  }
]
```

### Problems with Current DSL:

1. ❌ **step7**: Conditional is in wrong position (BEFORE AI extraction - `amount` doesn't exist yet!)
2. ❌ **step13-16**: Drive/Sheets operations are **top-level steps** (should be INSIDE a loop)
3. ❌ **step13**: References `{{vendor}}` but vendor only exists inside loop as `{{invoice.vendor}}`
4. ❌ **step14**: References `{{attachment_content}}` but attachment only exists inside loop
5. ❌ **step16**: References `{{type}}`, `{{vendor}}`, etc. but these only exist inside loop
6. ❌ **step16**: References `{{drive_link}}` but this was never captured from step15's output
7. ❌ **step17**: Empty/generic params - should include table data from loop
8. ❌ **Conditional scope**: Amount > 50 check should only control Sheets append, not Drive operations

**Result**: This workflow will FAIL at runtime because:
- Step13 will fail: `{{vendor}}` is undefined
- Step14 will fail: `{{attachment_content}}` is undefined
- Step16 will fail: All field references are undefined
- Step17 will send empty email

---

## Fixed DSL Output (CORRECT - With execution_scope)

```json
[
  {
    "id": "step1",
    "name": "Fetch Gmail Messages",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_messages",
    "params": {
      "query": "newer_than:1d has:attachment filename:pdf",
      "max_results": 100
    },
    "output_variable": "gmail_messages"
  },
  {
    "id": "step2",
    "name": "Deduplicate by Message ID",
    "type": "transform",
    "operation": "deduplicate",
    "input": "{{step1.data}}",
    "config": {
      "key_field": "id"
    },
    "output_variable": "unique_messages"
  },
  {
    "id": "step3",
    "name": "Filter: Only Emails with PDF Attachments",
    "type": "transform",
    "operation": "filter",
    "input": "{{step2.data}}",
    "config": {
      "conditions": [
        {
          "field": "attachments",
          "operator": "is_not_empty"
        },
        {
          "field": "attachments",
          "operator": "contains",
          "value": { "mime_type": "application/pdf" }
        }
      ]
    },
    "output_variable": "messages_with_pdfs"
  },
  {
    "id": "step4",
    "name": "Extract PDF Attachments",
    "type": "transform",
    "operation": "extract_attachments",
    "input": "{{step3.data}}",
    "config": {
      "attachment_field": "attachments",
      "filter": {
        "mime_type": "application/pdf"
      },
      "preserve_metadata": true,
      "metadata_fields": ["sender", "subject", "received_date", "message_id"]
    },
    "output_variable": "pdf_attachments"
  },
  {
    "id": "step5",
    "name": "AI Extract Invoice/Expense Data",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{step4.data}}",
      "itemVariable": "attachment"
    },
    "gather": {
      "mode": "array",
      "outputVariable": "extracted_invoices"
    },
    "steps": [
      {
        "id": "step5a",
        "name": "Extract Financial Data from PDF",
        "type": "action",
        "plugin": "ai-inference",
        "action": "extract",
        "params": {
          "model": "gpt-4o",
          "instruction": "Extract financial document information from this PDF. Determine: (1) Document type - is this an expense/receipt or an invoice, (2) Vendor or merchant name, (3) Date of the document/transaction, (4) Total amount as a numeric value, (5) Invoice number or receipt number, (6) Expense category if determinable. If amount cannot be confidently determined, set amount to null but still extract all other fields.",
          "input": "{{attachment.content}}",
          "context": {
            "filename": "{{attachment.filename}}",
            "email_subject": "{{attachment.email_subject}}",
            "sender": "{{attachment.email_sender}}"
          },
          "output_schema": {
            "type": "object",
            "fields": [
              {
                "name": "type",
                "type": "string",
                "required": true,
                "description": "Document type: 'expense' or 'invoice'"
              },
              {
                "name": "vendor",
                "type": "string",
                "required": true,
                "description": "Vendor or merchant name"
              },
              {
                "name": "date",
                "type": "string",
                "required": true,
                "description": "Document or transaction date"
              },
              {
                "name": "amount",
                "type": "number",
                "required": false,
                "description": "Total amount as numeric value, null if not confidently extractable"
              },
              {
                "name": "invoice_receipt_number",
                "type": "string",
                "required": true,
                "description": "Invoice number or receipt number"
              },
              {
                "name": "category",
                "type": "string",
                "required": false,
                "description": "Expense category if determinable"
              }
            ]
          }
        },
        "output_variable": "extracted_data"
      },
      {
        "id": "step5b",
        "name": "Merge Extracted Data with Attachment Metadata",
        "type": "transform",
        "operation": "merge",
        "input": "{{attachment}}",
        "config": {
          "merge_with": "{{step5a.data}}",
          "strategy": "extend"
        },
        "output_variable": "invoice_with_metadata"
      }
    ]
  },
  {
    "id": "step6",
    "name": "Process Each Invoice/Expense",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{step5.data}}",
      "itemVariable": "invoice"
    },
    "gather": {
      "mode": "array",
      "outputVariable": "processed_items"
    },
    "steps": [
      {
        "id": "step6a",
        "name": "Create Vendor Folder in Drive",
        "type": "action",
        "plugin": "google-drive",
        "action": "create_folder",
        "params": {
          "folder_name": "{{invoice.vendor}}",
          "parent_folder_id": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-"
        },
        "output_variable": "vendor_folder"
      },
      {
        "id": "step6b",
        "name": "Upload PDF to Vendor Folder",
        "type": "action",
        "plugin": "google-drive",
        "action": "upload_file",
        "params": {
          "folder_id": "{{step_result.folder_id}}",
          "file_content": "{{invoice.content}}",
          "file_name": "{{invoice.filename}}",
          "mime_type": "application/pdf"
        },
        "output_variable": "uploaded_file"
      },
      {
        "id": "step6c",
        "name": "Generate Shareable Link",
        "type": "action",
        "plugin": "google-drive",
        "action": "share_file",
        "params": {
          "file_id": "{{step_result.file_id}}",
          "permission_type": "anyone",
          "permission_role": "reader"
        },
        "output_variable": "shared_file"
      },
      {
        "id": "step6d",
        "name": "Capture Drive Link",
        "type": "transform",
        "operation": "set_field",
        "input": "{{invoice}}",
        "config": {
          "field": "drive_link",
          "value": "{{step_result.web_view_link}}"
        },
        "output_variable": "invoice_with_link"
      },
      {
        "id": "step6e",
        "name": "Conditional: Append to Sheets if Amount > 50",
        "type": "conditional",
        "condition": {
          "type": "complex",
          "combineWith": "AND",
          "conditions": [
            {
              "field": "invoice.amount",
              "operator": "is_not_empty",
              "value": null
            },
            {
              "field": "invoice.amount",
              "operator": "greater_than",
              "value": 50
            }
          ]
        },
        "then": [
          {
            "id": "step6e1",
            "name": "Append Row to Google Sheets",
            "type": "action",
            "plugin": "google-sheets",
            "action": "append_rows",
            "params": {
              "spreadsheet_id": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE",
              "range": "Sheet1!A:G",
              "values": [[
                "{{invoice.type}}",
                "{{invoice.vendor}}",
                "{{invoice.date}}",
                "{{invoice.amount}}",
                "{{invoice.invoice_receipt_number}}",
                "{{invoice.category}}",
                "{{invoice.drive_link}}"
              ]]
            }
          }
        ],
        "else": []
      }
    ]
  },
  {
    "id": "step7",
    "name": "Build Digest Table",
    "type": "transform",
    "operation": "render_table",
    "input": "{{step6.data}}",
    "config": {
      "type": "html",
      "columns": [
        { "field": "type", "header": "Type" },
        { "field": "vendor", "header": "Vendor / merchant" },
        { "field": "date", "header": "Date" },
        { "field": "amount", "header": "Amount" },
        { "field": "invoice_receipt_number", "header": "Invoice/receipt #" },
        { "field": "category", "header": "Category" },
        { "field": "drive_link", "header": "Drive link", "format": "link" }
      ],
      "empty_message": "No invoices/expenses were found in the last 24 hours"
    },
    "output_variable": "digest_table"
  },
  {
    "id": "step8",
    "name": "Send Digest Email",
    "type": "action",
    "plugin": "google-mail",
    "action": "send_message",
    "params": {
      "to": ["meiribarak@gmail.com"],
      "subject": "Daily invoice/expense digest (last 24 hours)",
      "body": {
        "format": "html",
        "content": "<h2>Invoice/Expense Processing Summary</h2><p>Processed {{step6.data.length}} documents in the last 24 hours.</p>{{step7.data}}"
      }
    },
    "conditional_send": {
      "send_when_empty": true,
      "empty_message": "<p>No invoices/expenses were found in the last 24 hours.</p>"
    }
  }
]
```

### What's Fixed in the Corrected DSL:

1. ✅ **step5**: AI extraction happens FIRST (creates the data)
2. ✅ **step6**: NEW scatter-gather loop wraps ALL per-item operations
3. ✅ **step6a-d**: Drive operations INSIDE loop with correct variable scoping (`{{invoice.vendor}}`, `{{invoice.content}}`)
4. ✅ **step6d**: Explicit data capture step adds `drive_link` to invoice object
5. ✅ **step6e**: Conditional INSIDE loop, AFTER data exists, ONLY controls Sheets append
6. ✅ **step7**: Table rendering AFTER loop, uses `{{step6.data}}` (all processed items)
7. ✅ **step8**: Email summary AFTER loop, includes table with ALL items
8. ✅ **Variable scoping**: All references use correct loop context (`{{invoice.*}}`)
9. ✅ **Sequential dependencies**: `step6a → step6b → step6c → step6d` with proper `{{step_result.*}}`
10. ✅ **Conditional scope**: Amount > 50 check ONLY affects Sheets, not Drive/Email

### Execution Flow:

```
Fetch Gmail (100 messages)
  ↓
Deduplicate (90 unique)
  ↓
Filter PDFs (60 with PDFs)
  ↓
Extract attachments (80 PDFs)
  ↓
AI extraction LOOP (for each PDF):
  - Extract: type, vendor, date, amount, etc.
  - Merge with attachment metadata
  ↓
Processing LOOP (for each extracted invoice):
  - Create Drive folder (or reuse existing)
  - Upload PDF to folder
  - Generate shareable link
  - Capture drive_link field
  - IF amount > 50: Append to Sheets
  - ELSE: Skip Sheets
  ↓
Build HTML table (all items with drive_link)
  ↓
Send digest email (includes table)
```

### Data Flow Preservation:

| Requirement | Current DSL | Fixed DSL |
|-------------|-------------|-----------|
| **R1**: Search Gmail | ✅ step1 | ✅ step1 |
| **R2**: Extract fields | ✅ step4 | ✅ step5 (better structure) |
| **R3**: Create folder | ❌ Wrong scope | ✅ step6a (inside loop) |
| **R4**: Upload PDF | ❌ Wrong scope | ✅ step6b (inside loop) |
| **R5**: Generate link | ❌ Wrong scope | ✅ step6c (inside loop) |
| **R6**: Capture link | ❌ Missing | ✅ step6d (explicit) |
| **R7**: Conditional Sheets | ❌ Wrong position | ✅ step6e (inside loop, correct position) |
| **R8**: Build table | ❌ No drive_link | ✅ step7 (has drive_link) |
| **R9**: Send email | ❌ Empty params | ✅ step8 (includes table) |

---

## Key Differences Summary

| Aspect | Current (Broken) | Fixed (Correct) |
|--------|------------------|-----------------|
| **Loop structure** | No per-item loop for Drive ops | `step6`: scatter-gather wraps Drive/Sheets |
| **Variable scope** | `{{vendor}}` (undefined) | `{{invoice.vendor}}` (correct) |
| **Conditional position** | Before AI extraction | After extraction, inside loop |
| **Conditional scope** | Empty actions (useless) | Only controls Sheets append |
| **Drive link capture** | Missing | Explicit transform step |
| **Email params** | Empty/generic | Includes rendered table |
| **Sequential deps** | ✅ Has `{{step_result.*}}` | ✅ Has `{{step_result.*}}` (same) |
| **Execution order** | Wrong (Drive before loop) | Correct (Drive inside loop) |

---

## Implementation Required

To generate the fixed DSL, we need to:

1. **Add `execution_scope` to IR schema** ([declarative-ir-types.ts:272](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts#L272))
2. **Update Phase 3 prompt** to set `execution_scope: "per_item"` for Drive/Sheets operations
3. **Update compiler** to detect `per_item` scope and wrap operations in scatter-gather
4. **Update validators** to check loop structure and variable scoping

Expected result: Phase 3 generates IR with:
```json
{
  "delivery_rules": {
    "multiple_destinations": [
      {
        "plugin_key": "google-drive",
        "operation_type": "create_folder",
        "execution_scope": "per_item",  // ← NEW FIELD
        "config": { "folder_name": "{{vendor}}", ... }
      }
    ]
  }
}
```

Compiler sees `execution_scope: "per_item"` → wraps in scatter-gather → generates fixed DSL.
