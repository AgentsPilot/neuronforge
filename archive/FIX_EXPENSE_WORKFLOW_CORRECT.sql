-- Fix the Expense Processing Agent workflow in agents table
-- Agent ID: ee7f1270-6ba4-4787-a5ae-55e47ecfb155

-- First, check the current structure
SELECT id, name, jsonb_typeof(workflow) as workflow_type
FROM agents
WHERE id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155';

-- Update the workflow with corrected variable references
UPDATE agents
SET
  workflow = '[
    {
      "id": "step1",
      "name": "Search Gmail for Expense Emails",
      "type": "action",
      "action": "search_emails",
      "params": {
        "query": "subject:expenses has:attachment",
        "max_results": 50
      },
      "plugin": "google-mail"
    },
    {
      "id": "step2",
      "name": "Check if Expense Emails Found",
      "type": "conditional",
      "condition": {
        "field": "step1.data.emails.length",
        "value": 0,
        "operator": ">",
        "conditionType": "simple"
      },
      "trueBranch": "step3",
      "falseBranch": "step8"
    },
    {
      "id": "step3",
      "name": "Process All Expense Emails in Parallel",
      "type": "scatter_gather",
      "gather": {
        "operation": "collect"
      },
      "scatter": {
        "input": "{{step1.data.emails}}",
        "steps": [
          {
            "id": "extract_attachments",
            "name": "Get Email Attachments",
            "type": "action",
            "action": "get_attachments",
            "params": {
              "message_id": "{{email.id}}"
            },
            "plugin": "google-mail"
          },
          {
            "id": "process_attachments",
            "name": "Extract Expense Data from Attachments",
            "type": "ai_processing",
            "input": "{{extract_attachments.data}}",
            "prompt": "Analyze these email attachments for expense information. For each attachment that contains expense/receipt data, extract: date_time (ISO format), vendor (company/merchant name), amount (numeric value only), currency, expense_type (categorize as: Travel, Meals, Office Supplies, Software, Marketing, Other). Return as array of objects with these exact fields. If no expense data found, return empty array."
          }
        ],
        "itemVariable": "email",
        "maxConcurrency": 5
      }
    },
    {
      "id": "step4",
      "name": "Flatten and Clean Expense Data",
      "type": "transform",
      "input": "{{step3.data}}",
      "config": {
        "flatten": true,
        "filter_empty": true
      },
      "operation": "map"
    },
    {
      "id": "step5",
      "name": "Check if Valid Expenses Found",
      "type": "conditional",
      "condition": {
        "field": "step4.data.length",
        "value": 0,
        "operator": ">",
        "conditionType": "simple"
      },
      "trueBranch": "step6",
      "falseBranch": "step8"
    },
    {
      "id": "step6",
      "name": "Format Data for Sheets",
      "type": "transform",
      "input": "{{step4.data}}",
      "config": {
        "columns": [
          "date_time",
          "vendor",
          "amount",
          "expense_type"
        ],
        "add_headers": true
      },
      "operation": "map"
    },
    {
      "id": "step7",
      "name": "Update Google Sheets with Expense Data",
      "type": "action",
      "action": "append_rows",
      "params": {
        "range": "{{input.sheet_name}}",
        "values": "{{step6.data}}",
        "spreadsheet_id": "{{input.spreadsheet_id}}"
      },
      "plugin": "google-sheets"
    },
    {
      "id": "step8",
      "name": "Generate Processing Summary",
      "type": "ai_processing",
      "input": "Emails found: {{step1.data.total_found}}, Valid expenses processed: {{step4.data.length}}, Sheets updated: {{step7.data}}",
      "prompt": "Generate a brief summary of the expense processing results including: total emails scanned, number of valid expenses found and processed, and status of Google Sheets update. If no expenses were found, explain this clearly.",
      "executeIf": {
        "field": "step1.data.total_found",
        "value": 0,
        "operator": ">=",
        "conditionType": "simple"
      }
    },
    {
      "id": "step9",
      "name": "Send Processing Summary Email",
      "type": "action",
      "action": "send_email",
      "params": {
        "content": {
          "body": "{{step8.data.result}}",
          "subject": "Expense Processing Complete - {{step4.data.length}} expenses processed"
        },
        "recipients": {
          "to": [
            "{{input.notification_email}}"
          ]
        }
      },
      "plugin": "google-mail"
    }
  ]'::jsonb,
  updated_at = NOW()
WHERE id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155';

-- Verify the update
SELECT
  id,
  name,
  workflow->2->'scatter'->>'input' as step3_scatter_input,
  workflow->3->>'input' as step4_transform_input,
  updated_at
FROM agents
WHERE id = 'ee7f1270-6ba4-4787-a5ae-55e47ecfb155';

-- Expected results:
-- step3_scatter_input: {{step1.data.emails}}
-- step4_transform_input: {{step3.data}}
