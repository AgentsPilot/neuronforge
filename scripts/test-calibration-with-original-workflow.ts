/**
 * Test calibration with original workflow (has file_url bug)
 * This should trigger the scatter-gather error detection and auto-fix
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const originalWorkflow = [
  {
    "step_id": "step1",
    "type": "action",
    "description": "Search Gmail for invoice/expense emails with PDF attachments from last 24 hours",
    "plugin": "google-mail",
    "operation": "search_emails",
    "config": {
      "query": "{{config.gmail_search_query}}",
      "max_results": "{{config.gmail_search_max_results}}",
      "include_attachments": true
    },
    "output_variable": "matching_emails"
  },
  {
    "step_id": "step2",
    "type": "transform",
    "operation": "flatten",
    "input": "{{matching_emails.emails}}",
    "description": "Extract PDF attachments array from emails",
    "config": {
      "type": "flatten",
      "field": "attachments",
      "input": "matching_emails",
      "custom_code": "Extract attachments array from each email, preserving email metadata (sender, subject, message_id)"
    },
    "output_variable": "all_attachments"
  },
  {
    "step_id": "step3",
    "type": "transform",
    "operation": "filter",
    "input": "{{all_attachments}}",
    "description": "Keep only PDF attachments (mime_type check)",
    "config": {
      "type": "filter",
      "input": "all_attachments",
      "custom_code": "Filter for PDF attachments only",
      "condition": {
        "operator": "eq",
        "value": "application/pdf",
        "field": "mimeType",
        "conditionType": "simple"
      }
    },
    "output_variable": "pdf_attachments"
  },
  {
    "step_id": "step4",
    "type": "scatter_gather",
    "description": "Loop over pdf_attachments",
    "scatter": {
      "input": "{{pdf_attachments}}",
      "steps": [
        {
          "step_id": "step5",
          "type": "action",
          "description": "Download PDF attachment content for extraction and storage",
          "plugin": "google-mail",
          "operation": "get_email_attachment",
          "config": {
            "message_id": "{{attachment.message_id}}",
            "attachment_id": "{{attachment.attachment_id}}",
            "filename": "{{attachment.filename}}"
          },
          "output_variable": "attachment_content"
        },
        {
          "step_id": "step6",
          "type": "action",
          "description": "Extract structured invoice/expense fields from PDF",
          "plugin": "document-extractor",
          "operation": "extract_structured_data",
          "config": {
            "file_url": "{{attachment_content.data}}",  // ❌ BUG: Should be file_content
            "fields": [
              { "name": "type", "type": "string", "required": false },
              { "name": "vendor", "type": "string", "required": false },
              { "name": "date", "type": "date", "required": false },
              { "name": "amount", "type": "number", "required": false },
              { "name": "invoice_number", "type": "string", "required": false },
              { "name": "category", "type": "string", "required": false }
            ]
          },
          "output_variable": "extracted_fields"
        },
        {
          "step_id": "step7",
          "type": "action",
          "description": "Get or create vendor subfolder under base folder",
          "plugin": "google-drive",
          "operation": "get_or_create_folder",
          "config": {
            "folder_name": "{{extracted_fields.vendor}}",
            "parent_folder_id": "{{config.base_folder_id}}"
          },
          "output_variable": "vendor_folder"
        },
        {
          "step_id": "step8",
          "type": "action",
          "description": "Upload PDF attachment to vendor folder in Drive",
          "plugin": "google-drive",
          "operation": "upload_file",
          "config": {
            "file_content": "{{attachment_content.data}}",
            "file_name": "{{attachment_content.filename}}",
            "folder_id": "{{vendor_folder.folder_id}}",
            "mime_type": "application/pdf"
          },
          "output_variable": "drive_file"
        },
        {
          "step_id": "step9",
          "type": "action",
          "description": "Generate shareable link for uploaded PDF",
          "plugin": "google-drive",
          "operation": "share_file",
          "config": {
            "file_id": "{{drive_file.file_id}}",
            "permission_type": "anyone_with_link",
            "role": "reader"
          },
          "output_variable": "shared_file"
        },
        {
          "step_id": "step10",
          "type": "ai_processing",
          "input": {
            "extracted_fields": "{{extracted_fields}}",
            "shared_file": "{{shared_file}}"
          },
          "prompt": "Create a structured record combining extracted fields with email metadata and Drive link",
          "description": "Build complete item record",
          "config": {
            "ai_type": "generate"
          },
          "output_variable": "item_record"
        }
      ],
      "itemVariable": "attachment"
    },
    "gather": {
      "operation": "collect"
    },
    "output_variable": "processed_items"
  },
  {
    "step_id": "step11",
    "type": "transform",
    "operation": "filter",
    "input": "{{processed_items}}",
    "description": "Filter items where amount > threshold",
    "config": {
      "type": "filter",
      "input": "processed_items",
      "condition": {
        "conditionType": "complex_and",
        "conditions": [
          { "operator": "exists", "field": "amount", "conditionType": "simple" },
          { "operator": "gt", "value": "{{config.amount_threshold}}", "field": "amount", "conditionType": "simple" }
        ]
      }
    },
    "output_variable": "high_value_items"
  },
  {
    "step_id": "step15",
    "type": "ai_processing",
    "input": "{{processed_items}}",
    "prompt": "Create an HTML email digest with a table",
    "description": "Generate digest email content",
    "config": {
      "ai_type": "generate"
    },
    "output_variable": "digest_content"
  },
  {
    "step_id": "step16",
    "type": "action",
    "description": "Send digest email to recipient",
    "plugin": "google-mail",
    "operation": "send_email",
    "config": {
      "recipients": { "to": ["{{config.digest_recipient}}"] },
      "content": {
        "subject": "{{digest_content.subject}}",
        "html_body": "{{digest_content.body}}"
      }
    }
  }
];

async function main() {
  console.log('=== TESTING CALIBRATION WITH ORIGINAL WORKFLOW ===\n');
  console.log('Workflow has known bug: step6 uses "file_url" instead of "file_content"\n');

  // Find the test agent (most recent one)
  const { data: agents, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (agentError || !agents || agents.length === 0) {
    console.error('Error finding agent:', agentError);
    return;
  }

  const agent = agents[0];
  console.log(`Found agent: ID=${agent.id}, User=${agent.user_id}\n`);

  // Update agent with original workflow
  console.log('Updating agent with original workflow (contains file_url bug)...');
  const { error: updateError } = await supabase
    .from('agents')
    .update({
      pilot_steps: originalWorkflow,
      updated_at: new Date().toISOString()
    })
    .eq('id', agent.id);

  if (updateError) {
    console.error('Error updating agent:', updateError);
    return;
  }

  console.log('✅ Agent updated\n');

  // Trigger calibration
  console.log('Triggering calibration...');
  const response = await fetch('http://localhost:3000/api/v2/calibrate/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agentId: agent.id,
      userId: agent.user_id,
      config: {
        gmail_search_query: 'has:attachment filename:pdf newer_than:1d',
        gmail_search_max_results: 5,
        base_folder_id: '1234567890',
        amount_threshold: 50,
        spreadsheet_id: '1234567890',
        sheet_tab_name: 'Expenses',
        digest_recipient: 'test@example.com'
      }
    })
  });

  const result = await response.json();

  console.log('\n=== CALIBRATION RESULT ===\n');
  console.log(JSON.stringify(result, null, 2));

  if (result.issues && result.issues.length > 0) {
    console.log('\n=== ISSUES DETECTED ===\n');
    for (const issue of result.issues) {
      console.log(`Issue: ${issue.title}`);
      console.log(`  Category: ${issue.category}`);
      console.log(`  Severity: ${issue.severity}`);
      console.log(`  Message: ${issue.message}`);
      console.log(`  Auto-repair available: ${issue.autoRepairAvailable}`);

      if (issue.autoRepairProposal) {
        console.log(`  Repair type: ${issue.autoRepairProposal.type}`);
        console.log(`  Confidence: ${issue.autoRepairProposal.confidence}`);
        console.log(`  Changes:`, JSON.stringify(issue.autoRepairProposal.changes, null, 4));
      }
      console.log('');
    }
  }

  // Check if file_url was fixed
  const { data: updatedAgent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agent.id)
    .single();

  if (updatedAgent) {
    const step6 = updatedAgent.pilot_steps[0]?.scatter?.steps?.find((s: any) => s.step_id === 'step6');
    if (step6) {
      console.log('\n=== STEP6 CONFIG AFTER CALIBRATION ===\n');
      console.log(JSON.stringify(step6.config, null, 2));

      if ('file_content' in step6.config && !('file_url' in step6.config)) {
        console.log('\n✅ SUCCESS! Parameter was renamed from "file_url" to "file_content"');
      } else if ('file_url' in step6.config) {
        console.log('\n❌ FAILED: "file_url" still present, auto-fix did not work');
      }
    }
  }
}

main().catch(console.error);
