// Verify the complete invoice extraction workflow
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyInvoiceExtraction() {
  console.log('=== VERIFYING INVOICE EXTRACTION WORKFLOW ===\n');

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('❌ No executions found');
    return;
  }

  const execution = executions[0];
  console.log(`Execution ID: ${execution.id}`);
  console.log(`Status: ${execution.status}`);
  console.log(`Started: ${execution.started_at}`);
  console.log(`Completed: ${execution.completed_at}\n`);

  // Get execution trace
  const { data: traces } = await supabase
    .from('execution_trace')
    .select('*')
    .eq('execution_id', execution.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!traces || traces.length === 0) {
    console.log('❌ No trace found');
    return;
  }

  const trace = traces[0];
  const cachedOutputs = trace.cached_outputs || {};

  console.log('=== STEP OUTPUTS ===');
  const stepKeys = Object.keys(cachedOutputs).sort((a, b) => {
    const numA = parseInt(a.replace('step', ''));
    const numB = parseInt(b.replace('step', ''));
    return numA - numB;
  });

  console.log(`Total steps executed: ${stepKeys.length}\n`);

  // Check step1: search_emails
  if (cachedOutputs.step1) {
    const emails = cachedOutputs.step1;
    console.log(`✅ STEP1 (search_emails): Found ${Array.isArray(emails) ? emails.length : 0} emails`);
    if (Array.isArray(emails) && emails.length > 0) {
      const firstEmail = emails[0];
      const attachmentCount = firstEmail.attachments?.length || 0;
      console.log(`   First email has ${attachmentCount} attachment(s)`);
    }
  }

  // Check step2: flatten attachments
  if (cachedOutputs.step2) {
    const attachments = cachedOutputs.step2;
    console.log(`✅ STEP2 (flatten): Extracted ${Array.isArray(attachments) ? attachments.length : 0} attachments`);
  }

  // Check step3: filter PDF invoices
  if (cachedOutputs.step3) {
    const invoices = cachedOutputs.step3;
    console.log(`✅ STEP3 (filter): Found ${Array.isArray(invoices) ? invoices.length : 0} PDF invoices`);
  }

  // Check step4: download attachments
  if (cachedOutputs.step4) {
    const downloaded = cachedOutputs.step4;
    console.log(`✅ STEP4 (download): Downloaded ${Array.isArray(downloaded) ? downloaded.length : 0} attachments`);
    if (Array.isArray(downloaded) && downloaded.length > 0) {
      const firstDownload = downloaded[0];
      const hasData = firstDownload.data && firstDownload.data.length > 0;
      console.log(`   First download has data: ${hasData ? 'YES' : 'NO'}`);
      if (hasData) {
        console.log(`   Data preview: ${firstDownload.data.substring(0, 30)}...`);
      }
    }
  }

  // Check step5: find or create folder
  if (cachedOutputs.step5) {
    const folder = cachedOutputs.step5;
    console.log(`✅ STEP5 (find_or_create_folder): Folder ID = ${folder.id || 'N/A'}`);
  }

  // Check step7: upload files to Drive (inside scatter-gather loop)
  if (cachedOutputs.step7) {
    const uploads = cachedOutputs.step7;
    console.log(`✅ STEP7 (upload_file): Uploaded ${Array.isArray(uploads) ? uploads.length : 0} files`);
    if (Array.isArray(uploads) && uploads.length > 0) {
      const firstUpload = uploads[0];
      console.log(`   First file: ${firstUpload.name || 'N/A'}`);
      console.log(`   File size: ${firstUpload.file_size || 'N/A'}`);
      console.log(`   Web link: ${firstUpload.web_view_link ? 'YES' : 'NO'}`);
    }
  }

  // Check step8: extract structured data (inside scatter-gather loop)
  if (cachedOutputs.step8) {
    const extractions = cachedOutputs.step8;
    console.log(`✅ STEP8 (extract_structured_data): Extracted data from ${Array.isArray(extractions) ? extractions.length : 0} documents`);
    if (Array.isArray(extractions) && extractions.length > 0) {
      const firstExtraction = extractions[0];
      console.log(`   First extraction confidence: ${firstExtraction.confidence || 'N/A'}`);
      console.log(`   Extracted fields:`, Object.keys(firstExtraction.extracted_fields || {}).join(', '));
      console.log(`   Sample data:`, JSON.stringify(firstExtraction.extracted_fields, null, 2));
    }
  }

  // Check step9: combine invoice data (inside scatter-gather loop)
  if (cachedOutputs.step9) {
    const combined = cachedOutputs.step9;
    console.log(`✅ STEP9 (combine data): Created ${Array.isArray(combined) ? combined.length : 0} invoice records`);
    if (Array.isArray(combined) && combined.length > 0) {
      console.log(`\n=== SAMPLE INVOICE RECORD ===`);
      console.log(JSON.stringify(combined[0], null, 2));
    }
  }

  // Check step11: find or create spreadsheet
  if (cachedOutputs.step11) {
    const sheet = cachedOutputs.step11;
    console.log(`\n✅ STEP11 (find_or_create_spreadsheet): Sheet ID = ${sheet.id || 'N/A'}`);
    console.log(`   Sheet URL: ${sheet.web_view_link || 'N/A'}`);
  }

  // Check step13: append to sheet
  if (cachedOutputs.step13) {
    const result = cachedOutputs.step13;
    console.log(`✅ STEP13 (append_to_sheet): Rows appended = ${result.rows_appended || 'N/A'}`);
  }

  // Final summary
  console.log('\n=== WORKFLOW SUMMARY ===');
  if (execution.status === 'completed') {
    console.log('✅ Workflow completed successfully!');
  } else if (execution.status === 'failed') {
    console.log('❌ Workflow failed');
    console.log('Error:', execution.error);
  } else {
    console.log(`⚠️ Workflow status: ${execution.status}`);
  }

  console.log(`\nTotal steps: ${stepKeys.length}`);
  console.log('Steps executed:', stepKeys.join(', '));
}

verifyInvoiceExtraction().catch(console.error);
