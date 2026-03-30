import { WorkflowValidator } from '../lib/pilot/WorkflowValidator';

const workflow = [
  {
    "id": "step1",
    "step_id": "step1",
    "type": "action",
    "output_variable": "matching_emails",
    "output_schema": {
      "type": "object",
      "properties": {
        "emails": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "labels": {
                "type": "array",
                "items": { "type": "string" }
              },
              "attachments": {
                "type": "array"
              }
            }
          }
        }
      }
    }
  },
  {
    "id": "step2",
    "step_id": "step2",
    "type": "transform",
    "operation": "flatten",
    "input": "{{matching_emails}}",
    "description": "Extract PDF attachments array from emails",
    "config": {
      "type": "flatten",
      "field": "labels",
      "custom_code": "Extract attachments array from each email"
    },
    "output_variable": "all_attachments"
  }
];

console.log('Testing validateFlattenFields() on step2...\n');

const validator = new WorkflowValidator();
const issues = validator.validateFlattenFields(workflow);

console.log(`\nFound ${issues.length} issue(s):\n`);
issues.forEach((issue, i) => {
  console.log(`Issue ${i + 1}:`);
  console.log(`  Step: ${issue.stepId}`);
  console.log(`  Current: ${issue.currentField}`);
  console.log(`  Suggested: ${issue.suggestedField}`);
  console.log(`  Confidence: ${issue.confidence}`);
  console.log(`  Reason: ${issue.reason}`);
  console.log();
});

if (issues.length === 0) {
  console.log('❌ VALIDATION FAILED - No issues detected but step2 has wrong field!');
} else {
  console.log('✅ VALIDATION WORKING - Issues detected correctly');
}
