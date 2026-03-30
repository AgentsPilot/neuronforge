import { WorkflowValidator } from '../lib/pilot/WorkflowValidator';

const workflow = [
  {
    "id": "step4",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{pdf_attachments}}",
      "steps": [
        {
          "id": "step5",
          "config": {
            "filename": "{{attachment.filename}}",
            "message_id": "{{attachment.message_id}}",
            "attachment_id": "{{attachment.attachment_id}}"
          },
          "output_variable": "attachment_content"
        },
        {
          "id": "step10",
          "type": "ai_processing",
          "description": "Build complete item record with extracted fields, email metadata, and Drive link"
        }
      ],
      "itemVariable": "attachment"
    }
  }
];

console.log('=== ANALYZING SCATTER-GATHER STEP ===\n');

console.log('Step5 config references:');
console.log('  - {{attachment.filename}}');
console.log('  - {{attachment.message_id}}');
console.log('  - {{attachment.attachment_id}}');

console.log('\nStep3 output (pdf_attachments) structure:');
console.log('Each item has:');
console.log('  - filename ✓');
console.log('  - message_id ✓');
console.log('  - attachment_id ✓');
console.log('  - mimeType, size, etc.');

console.log('\n=== POTENTIAL ISSUES ===\n');

console.log('Issue 1: Step10 (AI processing) references');
console.log('  Input: { shared_file, extracted_fields }');
console.log('  Problem: AI step needs email metadata (sender, subject, received_date)');
console.log('  Available in loop: Only attachment fields + step outputs');
console.log('  Missing: Email-level fields (from, subject, date) are NOT in attachment items');

console.log('\nIssue 2: Attachment flatten preserves parent data?');
console.log('  Step2 flattens emails.attachments');
console.log('  Question: Does it preserve _parentData with email fields?');
console.log('  If NO: Step10 cannot access sender/subject/received_date');

console.log('\n=== ROOT CAUSE ===');
console.log('Step2 flatten operation extracts attachments but may not preserve');
console.log('email-level metadata (sender, subject, date) that Step10 needs.');
console.log('\nThis would cause Step10 AI processing to fail or produce incomplete data.');

console.log('\n=== SOLUTION ===');
console.log('Step2 flatten should preserve parent data with _parentData field');
console.log('containing: { id, from, subject, date }');
console.log('\nThen Step10 can access:');
console.log('  - {{attachment._parentData.from}} → sender');
console.log('  - {{attachment._parentData.subject}} → subject');
console.log('  - {{attachment._parentData.date}} → received_date');
